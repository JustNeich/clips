import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeComments, sortCommentsByPopularity } from "./comments";
import { fetchOptionalYtDlpInfo } from "./source-acquisition";
import { createStage2CodexExecutorContext } from "./stage2-codex-executor";
import type { Stage2HardConstraints } from "./stage2-channel-config";
import {
  normalizeStage2StyleProfile,
  normalizeStage2StyleReferenceLink,
  normalizeStage2StyleDirection,
  STAGE2_EDITORIAL_EXPLORATION_SHARE,
  STAGE2_STYLE_DISCOVERY_TARGET_COUNT,
  STAGE2_STYLE_MIN_REFERENCE_LINKS,
  type Stage2StyleProfile,
  type Stage2StyleReferenceLink
} from "./stage2-channel-learning";
import { normalizeStage2StyleDiscoveryReferenceUrls } from "./stage2-style-reference-links";
import type { JsonStageExecutor } from "./viral-shorts-worker/executor";

export const STAGE2_STYLE_DISCOVERY_PROMPT_VERSION = "2026-03-21-ru-ui-v3-breadth";

const STYLE_DISCOVERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reference_influence_summary", "directions"],
  properties: {
    reference_influence_summary: { type: "string", minLength: 1 },
    directions: {
      type: "array",
      minItems: 16,
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "fitBand",
          "description",
          "voice",
          "topPattern",
          "bottomPattern",
          "humorLevel",
          "sarcasmLevel",
          "warmthLevel",
          "insiderDensityLevel",
          "bestFor",
          "avoids",
          "microExample",
          "sourceReferenceIds",
          "internalPromptNotes",
          "axes"
        ],
        properties: {
          id: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          fitBand: { type: "string", enum: ["core", "adjacent", "exploratory"] },
          description: { type: "string", minLength: 1 },
          voice: { type: "string", minLength: 1 },
          topPattern: { type: "string", minLength: 1 },
          bottomPattern: { type: "string", minLength: 1 },
          humorLevel: { type: "string", enum: ["low", "medium", "high"] },
          sarcasmLevel: { type: "string", enum: ["low", "medium", "high"] },
          warmthLevel: { type: "string", enum: ["low", "medium", "high"] },
          insiderDensityLevel: { type: "string", enum: ["low", "medium", "high"] },
          bestFor: { type: "string", minLength: 1 },
          avoids: { type: "string", minLength: 1 },
          microExample: { type: "string", minLength: 1 },
          sourceReferenceIds: {
            type: "array",
            maxItems: 4,
            items: { type: "string", minLength: 1 }
          },
          internalPromptNotes: { type: "string", minLength: 1 },
          axes: {
            type: "object",
            additionalProperties: false,
            required: [
              "humor",
              "sarcasm",
              "warmth",
              "insiderDensity",
              "intensity",
              "explanationDensity",
              "quoteDensity",
              "topCompression"
            ],
            properties: {
              humor: { type: "number", minimum: 0, maximum: 1 },
              sarcasm: { type: "number", minimum: 0, maximum: 1 },
              warmth: { type: "number", minimum: 0, maximum: 1 },
              insiderDensity: { type: "number", minimum: 0, maximum: 1 },
              intensity: { type: "number", minimum: 0, maximum: 1 },
              explanationDensity: { type: "number", minimum: 0, maximum: 1 },
              quoteDensity: { type: "number", minimum: 0, maximum: 1 },
              topCompression: { type: "number", minimum: 0, maximum: 1 }
            }
          }
        }
      }
    }
  }
} as const;

function sanitizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = sanitizeString(value);
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function hostLabelFromUrl(value: string): string {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname.includes("youtube")) {
      return "YouTube";
    }
    if (hostname.includes("instagram")) {
      return "Instagram";
    }
    if (hostname.includes("facebook")) {
      return "Facebook";
    }
    return hostname.replace(/^www\./, "");
  } catch {
    return "reference";
  }
}

async function collectStage2StyleReferenceLink(
  referenceUrl: string,
  index: number
): Promise<Stage2StyleReferenceLink> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "clips-style-ref-"));
  try {
    const info = await fetchOptionalYtDlpInfo(referenceUrl, tmpDir);
    const normalizedComments = sortCommentsByPopularity(normalizeComments(info.infoJson?.comments ?? []))
      .slice(0, 3)
      .map((comment) => truncateText(comment.text, 180));

    return normalizeStage2StyleReferenceLink(
      {
        id: `reference_${index + 1}`,
        url: referenceUrl,
        normalizedUrl: referenceUrl,
        title: sanitizeString(info.infoJson?.title) || `Reference ${index + 1}`,
        description: truncateText(sanitizeString(info.infoJson?.description), 340),
        transcriptExcerpt: truncateText(sanitizeString(info.infoJson?.transcript), 700),
        commentHighlights: normalizedComments,
        sourceHint: hostLabelFromUrl(referenceUrl)
      },
      index
    ) as Stage2StyleReferenceLink;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function mapWithConcurrency<TInput, TResult>(
  values: TInput[],
  concurrency: number,
  mapper: (value: TInput, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results: TResult[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(values[currentIndex] as TInput, currentIndex);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, () =>
    worker()
  );
  await Promise.all(workers);
  return results;
}

export async function collectStage2StyleReferenceLinks(
  referenceLinks: string[]
): Promise<Stage2StyleReferenceLink[]> {
  const normalizedLinks = normalizeStage2StyleDiscoveryReferenceUrls(referenceLinks);
  if (normalizedLinks.length < STAGE2_STYLE_MIN_REFERENCE_LINKS) {
    throw new Error(
      `Добавьте минимум ${STAGE2_STYLE_MIN_REFERENCE_LINKS} поддерживаемых ссылок перед запуском style discovery.`
    );
  }
  return mapWithConcurrency(normalizedLinks, 3, collectStage2StyleReferenceLink);
}

export function buildStage2StyleDiscoveryPrompt(input: {
  channelName: string;
  username: string;
  hardConstraints: Stage2HardConstraints;
  referenceLinks: Stage2StyleReferenceLink[];
}): string {
  const payload = {
    channelSetup: {
      name: sanitizeString(input.channelName) || "Untitled channel",
      username: sanitizeString(input.username),
      hardConstraints: input.hardConstraints
    },
    productRules: {
      targetDirectionCount: STAGE2_STYLE_DISCOVERY_TARGET_COUNT,
      exploratoryShare: STAGE2_EDITORIAL_EXPLORATION_SHARE,
      editorWillChooseFinalDirections: true,
      editorMaySelectManyDirections: true,
      referencesNarrowProposalSpaceButDoNotLockIdentity: true
    },
    references: input.referenceLinks.map((reference) => ({
      id: reference.id,
      source: reference.sourceHint,
      url: reference.normalizedUrl,
      title: reference.title,
      description: reference.description,
      transcriptExcerpt: reference.transcriptExcerpt,
      commentHighlights: reference.commentHighlights
    }))
  };

  return [
    "SYSTEM",
    "You are designing candidate channel style directions for a short-form video editorial team.",
    "The editor-facing product UI is in Russian.",
    "",
    "Critical product rules:",
    "- The reference links inform the proposal space, but they do not define the channel automatically.",
    "- The editor may keep many directions, including most of the pool, if they all feel valid.",
    "- You are building a broad editorial possibility space, not paraphrasing the same references 20 times.",
    "- Do not collapse everything into one obvious mode or one narrow framing cluster.",
    `- Rough target mix: 8-10 core high-fit directions, 6-8 adjacent directions, and 3-5 exploratory directions. Roughly ${Math.round(STAGE2_EDITORIAL_EXPLORATION_SHARE * 100)}% of the pool should stay exploratory.`,
    "- Core directions should feel clearly grounded in recurring signals from the references.",
    "- Adjacent directions should still fit the channel, but widen the likely style space along tone, emotional distance, explanation density, compression, or warmth.",
    "- Exploratory directions should be plausible for this channel family without feeling random or off-brand.",
    "- Abstract repeated signals upward into reusable editorial stances. Do not keep rephrasing the same specific plot beat, gesture, or source narrative.",
    "- If two candidate directions differ only by a tiny wording tweak around the same surface story, merge them into one stronger reusable lane instead.",
    "- Do not rely on a canned preset library or a rigid taxonomy.",
    "- Make the direction names human-readable, editorial, and easy to choose from.",
    "- The output is for a real editor, not for a prompt engineer.",
    "- All editor-facing fields must be written in natural Russian: name, description, voice, topPattern, bottomPattern, bestFor, avoids, microExample, reference_influence_summary.",
    "- Keep the Russian phrasing concise, human, and easy to scan in a card UI.",
    "- internalPromptNotes should stay concise and may remain in English because they are system-side.",
    "",
    "For each direction, describe:",
    "- fitBand: core, adjacent, or exploratory",
    "- the implied voice",
    "- what kind of TOP works",
    "- what kind of BOTTOM works",
    "- how much humor, sarcasm, warmth, and insider density it tends to use",
    "- what clip families it fits",
    "- what it avoids",
    "- a tiny illustrative example",
    "",
    "Also include hidden internal prompt notes and soft numeric axes so the runtime can learn later.",
    "",
    "Naming rules:",
    "- Use natural editorial labels like 'Сухой разбор ремесла' or 'Тёплое уважение к мастерству'.",
    "- Avoid labels that look like internal taxonomies, code names, or one-off poetic metaphors.",
    "- Avoid hyper-local micro-style names that sound like paraphrases of a single source clip.",
    "",
    "Reference anchoring rules:",
    "- sourceReferenceIds may be empty for exploratory lanes and may stay light for adjacent lanes.",
    "- Do not force every direction to map one-to-one onto a specific reference clip.",
    "- reference_influence_summary should explain the dominant signals from the links and where the widened adjacent room is.",
    "",
    "Return strict JSON only.",
    "",
    "USER CONTEXT JSON",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

export function normalizeStage2StyleDiscoveryResult(input: {
  rawResult: unknown;
  referenceLinks: Stage2StyleReferenceLink[];
}): Stage2StyleProfile {
  const candidate =
    input.rawResult && typeof input.rawResult === "object"
      ? (input.rawResult as Record<string, unknown>)
      : {};
  const referenceIds = input.referenceLinks.map((reference) => reference.id);
  const directionsRaw = Array.isArray(candidate.directions) ? candidate.directions : [];
  const candidateDirections = directionsRaw
    .map((direction, index) =>
      normalizeStage2StyleDirection(direction, index, referenceIds)
    )
    .filter((direction): direction is NonNullable<typeof direction> => direction !== null)
    .slice(0, STAGE2_STYLE_DISCOVERY_TARGET_COUNT);

  return normalizeStage2StyleProfile({
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    onboardingCompletedAt: null,
    discoveryPromptVersion: STAGE2_STYLE_DISCOVERY_PROMPT_VERSION,
    referenceInfluenceSummary:
      sanitizeString(candidate.reference_influence_summary) ||
      sanitizeString(candidate.referenceInfluenceSummary) ||
      "Референсы помогли сузить пространство вариантов, но итоговый стартовый стиль всё равно выбирает редактор.",
    explorationShare: STAGE2_EDITORIAL_EXPLORATION_SHARE,
    referenceLinks: input.referenceLinks,
    candidateDirections,
    selectedDirectionIds: []
  });
}

export async function runStage2StyleDiscovery(input: {
  executor: JsonStageExecutor;
  channelName: string;
  username: string;
  hardConstraints: Stage2HardConstraints;
  referenceLinks: Stage2StyleReferenceLink[];
  reasoningEffort?: string | null;
}): Promise<Stage2StyleProfile> {
  const prompt = buildStage2StyleDiscoveryPrompt({
    channelName: input.channelName,
    username: input.username,
    hardConstraints: input.hardConstraints,
    referenceLinks: input.referenceLinks
  });

  const rawResult = await input.executor.runJson<unknown>({
    prompt,
    schema: STYLE_DISCOVERY_SCHEMA,
    reasoningEffort: input.reasoningEffort ?? "high"
  });

  return normalizeStage2StyleDiscoveryResult({
    rawResult,
    referenceLinks: input.referenceLinks
  });
}

export async function discoverStage2StyleProfile(input: {
  workspaceId: string;
  channelName: string;
  username: string;
  hardConstraints: Stage2HardConstraints;
  referenceUrls: string[];
}): Promise<Stage2StyleProfile> {
  const referenceLinks = await collectStage2StyleReferenceLinks(input.referenceUrls);
  const executorContext = await createStage2CodexExecutorContext(input.workspaceId);
  return runStage2StyleDiscovery({
    executor: executorContext.executor,
    channelName: input.channelName,
    username: input.username,
    hardConstraints: input.hardConstraints,
    referenceLinks,
    reasoningEffort: executorContext.reasoningEffort
  });
}
