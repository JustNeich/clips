import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CommentItem } from "./comments";
import { normalizeComments, sortCommentsByPopularity } from "./comments";
import {
  downloadSourceMedia,
  fetchOptionalYtDlpInfo
} from "./source-acquisition";
import { createStage2CodexExecutorContext } from "./stage2-codex-executor";
import type { Stage2HardConstraints } from "./stage2-channel-config";
import {
  normalizeStage2StyleDirection,
  normalizeStage2StyleProfile,
  normalizeStage2StyleReferenceLink,
  STAGE2_EDITORIAL_EXPLORATION_SHARE,
  STAGE2_STYLE_DISCOVERY_TARGET_COUNT,
  STAGE2_STYLE_MIN_REFERENCE_LINKS,
  type Stage2BootstrapConfidenceLevel,
  type Stage2StyleAudiencePortrait,
  type Stage2StyleBootstrapDiagnostics,
  type Stage2StyleDirection,
  type Stage2StylePackagingPortrait,
  type Stage2StyleProfile,
  type Stage2StyleReferenceLink
} from "./stage2-channel-learning";
import { normalizeStage2StyleDiscoveryReferenceUrls } from "./stage2-style-reference-links";
import type { JsonStageExecutor } from "./viral-shorts-worker/executor";

const execFileAsync = promisify(execFile);

export const STAGE2_STYLE_DISCOVERY_PROMPT_VERSION = "2026-03-21-ru-ui-v4-audience-visual";

const STAGE2_STYLE_DISCOVERY_INTERNAL_TARGET_COUNT = 28;
const STAGE2_STYLE_DISCOVERY_REFERENCE_COMMENT_TARGET = 8;
const STAGE2_STYLE_DISCOVERY_REFERENCE_COMMENT_MAX_CHARS = 180;
const STAGE2_STYLE_DISCOVERY_REFERENCE_DESCRIPTION_MAX_CHARS = 360;
const STAGE2_STYLE_DISCOVERY_REFERENCE_TRANSCRIPT_MAX_CHARS = 900;

type Stage2StyleDiscoveryCommentLane =
  | "praise"
  | "joke"
  | "criticism"
  | "suspicion"
  | "observation";

export type Stage2StyleDiscoveryCommentSignal = {
  id: string;
  author: string;
  text: string;
  likes: number;
  lane: Stage2StyleDiscoveryCommentLane;
  score: number;
};

type Stage2StyleDiscoveryCommentPortrait = {
  summary: string;
  rewards: string[];
  jokes: string[];
  pushback: string[];
  suspicion: string[];
  repeatedLanguage: string[];
  dominantPosture: string;
  tonePreferences: string[];
  rejects: string[];
};

type Stage2StyleDiscoveryReferenceFrameSlot = "setup" | "turn" | "payoff";

type Stage2StyleDiscoveryCollectedReference = {
  referenceLink: Stage2StyleReferenceLink;
  prioritizedComments: Stage2StyleDiscoveryCommentSignal[];
  commentPortrait: Stage2StyleDiscoveryCommentPortrait;
  frameImagePaths: string[];
  frameMoments: Array<{
    slot: Stage2StyleDiscoveryReferenceFrameSlot;
    description: string;
  }>;
  extractionNotes: string[];
  usable: boolean;
  tmpDir: string;
};

export type Stage2StyleDiscoveryEvidence = {
  audienceSeed: Stage2StyleAudiencePortrait;
  packagingSeed: Stage2StylePackagingPortrait;
  diagnosticsSeed: Omit<
    Stage2StyleBootstrapDiagnostics,
    | "summary"
    | "hiddenCandidatePoolSize"
    | "surfacedCandidateCount"
    | "model"
    | "reasoningEffort"
  >;
  imagesManifest: Array<{
    imageIndex: number;
    referenceId: string;
    frameSlot: Stage2StyleDiscoveryReferenceFrameSlot;
    description: string;
  }>;
  referenceExtractionSummary: string;
};

const STYLE_DISCOVERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "reference_influence_summary",
    "audience_portrait",
    "packaging_portrait",
    "bootstrap_confidence",
    "directions"
  ],
  properties: {
    reference_influence_summary: { type: "string", minLength: 1 },
    audience_portrait: {
      type: "object",
      additionalProperties: false,
      required: [
        "summary",
        "rewards",
        "jokes",
        "pushback",
        "suspicion",
        "language_cues",
        "dominant_posture",
        "tone_preferences",
        "rejects"
      ],
      properties: {
        summary: { type: "string", minLength: 1 },
        rewards: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 },
        jokes: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 },
        pushback: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 },
        suspicion: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 },
        language_cues: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 10 },
        dominant_posture: { type: "string", minLength: 1 },
        tone_preferences: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 },
        rejects: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 }
      }
    },
    packaging_portrait: {
      type: "object",
      additionalProperties: false,
      required: [
        "summary",
        "moment_patterns",
        "visual_triggers",
        "top_mechanics",
        "bottom_mechanics",
        "framing_modes"
      ],
      properties: {
        summary: { type: "string", minLength: 1 },
        moment_patterns: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 },
        visual_triggers: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 },
        top_mechanics: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 },
        bottom_mechanics: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 },
        framing_modes: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 }
      }
    },
    bootstrap_confidence: {
      type: "object",
      additionalProperties: false,
      required: ["level", "summary", "evidence_notes"],
      properties: {
        level: { type: "string", enum: ["low", "medium", "high"] },
        summary: { type: "string", minLength: 1 },
        evidence_notes: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 8 }
      }
    },
    directions: {
      type: "array",
      minItems: 20,
      maxItems: 32,
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

const GENERIC_COMMENT_NOISE =
  /\b(first|who'?s here|anyone else|algorithm|underrated|love this|so good|amazing|legend|bro fr|nah bro|w edit)\b/i;
const SUSPICION_COMMENT_PATTERN =
  /\b(fake|staged|scripted|acting|setup|set up|pre[- ]?opened|resealed|tampered|edited|cgi|planted|paid actor)\b/i;
const CRITICISM_COMMENT_PATTERN =
  /\b(cringe|corny|overrated|boring|lame|annoying|mid|dumb|stupid|terrible|not that deep|not that serious)\b/i;
const JOKE_COMMENT_PATTERN =
  /\b(lol|lmao|lmfao|haha|ahah|bro|nah|what is this|ain'?t no way|this man|this girl|mode)\b|[😂😭💀🤣]/i;
const PRAISE_COMMENT_PATTERN =
  /\b(respect|wholesome|adorable|clean|smooth|perfect|beautiful|satisfying|legend|goat|king|queen|amazing|incredible|love how)\b/i;
const PACKAGING_MODE_PATTERNS: Array<{ mode: string; pattern: RegExp; cue: string }> = [
  {
    mode: "reaction-first",
    pattern: /\b(reaction|reacts|face|look on|stares|staring|everyone saw|caught on camera)\b/i,
    cue: "реакция или социальный разрыв заметны сразу"
  },
  {
    mode: "reveal-first",
    pattern: /\b(reveal|turns out|before and after|finally|at the end|ending|twist)\b/i,
    cue: "ценность в повороте или раскрытии"
  },
  {
    mode: "competence-oriented",
    pattern: /\b(build|fix|repair|craft|skill|work|making|restore|restoration|process|precision)\b/i,
    cue: "сильна упаковка через мастерство, ошибку или точность"
  },
  {
    mode: "awkward-social",
    pattern: /\b(awkward|embarrass|crush|date|teacher|boss|friend|social|room)\b/i,
    cue: "важен социальный момент и неловкость"
  },
  {
    mode: "meme-compressed",
    pattern: /\b(meme|funny|insane|wild|chaos|crazy|unhinged|bro)\b/i,
    cue: "клип просится в сжатую мемную упаковку"
  }
];
const SIGNAL_STOPWORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "your",
  "they",
  "them",
  "were",
  "what",
  "when",
  "would",
  "there",
  "about",
  "just",
  "like",
  "really",
  "very",
  "only",
  "into",
  "their",
  "because",
  "here",
  "then",
  "than",
  "also",
  "such",
  "https",
  "www",
  "that’s",
  "thats",
  "это",
  "как",
  "что",
  "когда",
  "просто",
  "очень",
  "только",
  "если",
  "тут",
  "там",
  "потом",
  "снова",
  "видео",
  "ролик",
  "shorts",
  "video"
]);

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

function formatLikes(likes: number): string {
  if (likes >= 1_000_000) {
    return `${(likes / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (likes >= 1_000) {
    return `${(likes / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(Math.max(0, Math.floor(likes)));
}

function normalizePromptKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSignalTokens(text: string): string[] {
  return Array.from(
    new Set(
      normalizePromptKey(text)
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !SIGNAL_STOPWORDS.has(token))
    )
  );
}

function isGenericCommentNoise(text: string): boolean {
  const normalized = normalizePromptKey(text);
  if (!normalized) {
    return true;
  }
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 3) {
    return true;
  }
  return GENERIC_COMMENT_NOISE.test(normalized);
}

function detectCommentLane(text: string): Stage2StyleDiscoveryCommentLane {
  if (SUSPICION_COMMENT_PATTERN.test(text)) {
    return "suspicion";
  }
  if (CRITICISM_COMMENT_PATTERN.test(text)) {
    return "criticism";
  }
  if (JOKE_COMMENT_PATTERN.test(text)) {
    return "joke";
  }
  if (PRAISE_COMMENT_PATTERN.test(text)) {
    return "praise";
  }
  return "observation";
}

function mapLaneToTone(lane: Stage2StyleDiscoveryCommentLane): string[] {
  if (lane === "praise") {
    return ["тёплое одобрение", "уважение к моменту"];
  }
  if (lane === "joke") {
    return ["мемная компрессия", "быстрый ироничный угол"];
  }
  if (lane === "criticism") {
    return ["сухая дистанция", "осторожный сарказм"];
  }
  if (lane === "suspicion") {
    return ["скепсис", "спор или скрытый разбор"];
  }
  return ["наблюдательное чтение момента"];
}

function scoreStage2StyleDiscoveryComment(comment: CommentItem): number {
  const normalized = normalizePromptKey(comment.text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const uniqueTokens = Array.from(new Set(tokens));
  const likesWeight = Math.log10(comment.likes + 10);
  const informationWeight = Math.min(2.1, tokens.length / 5) + Math.min(1, uniqueTokens.length / 12);
  const lane = detectCommentLane(normalized);
  const laneBonus =
    lane === "observation"
      ? 0.2
      : lane === "praise"
        ? 0.28
        : lane === "joke"
          ? 0.32
          : 0.4;
  const genericPenalty = isGenericCommentNoise(normalized) ? 2.1 : 0;
  return Number((likesWeight + informationWeight + laneBonus - genericPenalty).toFixed(4));
}

export function prioritizeStage2StyleDiscoveryComments(
  comments: CommentItem[],
  options?: { maxComments?: number }
): Stage2StyleDiscoveryCommentSignal[] {
  const maxComments = Math.max(4, Math.min(12, Math.floor(options?.maxComments ?? STAGE2_STYLE_DISCOVERY_REFERENCE_COMMENT_TARGET)));
  const perLaneQuota: Record<Stage2StyleDiscoveryCommentLane, number> = {
    praise: 2,
    joke: 2,
    criticism: 2,
    suspicion: 2,
    observation: 2
  };
  const scored = comments
    .map((comment) => {
      const lane = detectCommentLane(comment.text);
      return {
        id: comment.id,
        author: comment.author,
        text: truncateText(comment.text, STAGE2_STYLE_DISCOVERY_REFERENCE_COMMENT_MAX_CHARS),
        likes: comment.likes,
        lane,
        score: scoreStage2StyleDiscoveryComment(comment)
      } satisfies Stage2StyleDiscoveryCommentSignal;
    })
    .filter((comment) => comment.text)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.likes - left.likes;
    });

  const selected: Stage2StyleDiscoveryCommentSignal[] = [];
  const usedIds = new Set<string>();

  (["praise", "joke", "criticism", "suspicion", "observation"] as const).forEach((lane) => {
    const laneComments = scored.filter((comment) => comment.lane === lane);
    for (const comment of laneComments.slice(0, perLaneQuota[lane])) {
      if (selected.length >= maxComments || usedIds.has(comment.id)) {
        continue;
      }
      selected.push(comment);
      usedIds.add(comment.id);
    }
  });

  for (const comment of scored) {
    if (selected.length >= maxComments) {
      break;
    }
    if (usedIds.has(comment.id)) {
      continue;
    }
    selected.push(comment);
    usedIds.add(comment.id);
  }

  return selected.slice(0, maxComments);
}

function pickTopRepeatedPhrases(items: string[], maxItems: number): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const normalized = normalizePromptKey(item);
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([value]) => value)
    .slice(0, maxItems);
}

function summarizeReferenceCommentPortrait(
  prioritizedComments: Stage2StyleDiscoveryCommentSignal[],
  totalComments: number
): Stage2StyleDiscoveryCommentPortrait {
  if (prioritizedComments.length === 0) {
    return {
      summary: "Сигнал по комментариям тонкий: аудитория почти не помогла явно прочитать вкус канала.",
      rewards: [],
      jokes: [],
      pushback: [],
      suspicion: [],
      repeatedLanguage: [],
      dominantPosture: "сигнал слабый или разреженный",
      tonePreferences: [],
      rejects: []
    };
  }

  const laneBuckets: Record<Stage2StyleDiscoveryCommentLane, Stage2StyleDiscoveryCommentSignal[]> = {
    praise: [],
    joke: [],
    criticism: [],
    suspicion: [],
    observation: []
  };
  for (const comment of prioritizedComments) {
    laneBuckets[comment.lane].push(comment);
  }

  const repeatedLanguage = pickTopRepeatedPhrases(
    prioritizedComments.flatMap((comment) => extractSignalTokens(comment.text)),
    6
  );
  const rewards = laneBuckets.praise
    .concat(laneBuckets.observation)
    .map((comment) => truncateText(comment.text, 110))
    .slice(0, 3);
  const jokes = laneBuckets.joke.map((comment) => truncateText(comment.text, 110)).slice(0, 3);
  const pushback = laneBuckets.criticism
    .map((comment) => truncateText(comment.text, 110))
    .slice(0, 3);
  const suspicion = laneBuckets.suspicion
    .map((comment) => truncateText(comment.text, 110))
    .slice(0, 3);
  const dominantLane = (Object.entries(laneBuckets) as Array<
    [Stage2StyleDiscoveryCommentLane, Stage2StyleDiscoveryCommentSignal[]]
  >)
    .sort((left, right) => right[1].length - left[1].length)[0]?.[0] ?? "observation";
  const dominantPosture =
    dominantLane === "praise"
      ? "аудитория больше поддерживает и соглашается с моментом"
      : dominantLane === "joke"
        ? "аудитория быстро уходит в шутку и мемный пересказ"
        : dominantLane === "criticism"
          ? "аудитория охотно спорит и охлаждает слишком прямую подачу"
          : dominantLane === "suspicion"
            ? "аудитория ищет подвох, постановку или скрытый монтаж"
            : "аудитория читает момент наблюдательно и по факту";
  const tonePreferences = Array.from(
    new Set(
      prioritizedComments.flatMap((comment) => mapLaneToTone(comment.lane))
    )
  ).slice(0, 5);
  const rejects = [
    laneBuckets.criticism.length > 0 ? "слишком прямолинейный пафос без дистанции" : "",
    laneBuckets.suspicion.length > 0 ? "наивную доверчивость к постановочному моменту" : "",
    totalComments < 4 ? "чрезмерную уверенность в реакции аудитории при слабом comments signal" : ""
  ].filter(Boolean);

  return {
    summary: [
      `Из ${totalComments} комментариев приоритетно взяты ${prioritizedComments.length}.`,
      dominantPosture,
      repeatedLanguage.length > 0
        ? `Повторяющийся словарь: ${repeatedLanguage.join(", ")}.`
        : ""
    ]
      .filter(Boolean)
      .join(" "),
    rewards,
    jokes,
    pushback,
    suspicion,
    repeatedLanguage,
    dominantPosture,
    tonePreferences,
    rejects
  };
}

export function buildStyleDiscoveryReferenceFramePlan(
  durationSeconds: number | null
): Array<{
  slot: Stage2StyleDiscoveryReferenceFrameSlot;
  timestampSec: number;
  description: string;
}> {
  const safeDuration = durationSeconds && durationSeconds > 0.5 ? durationSeconds : 12;
  const maxTs = Math.max(0.1, safeDuration - 0.1);
  const framePlan: Array<{
    slot: Stage2StyleDiscoveryReferenceFrameSlot;
    ratio: number;
    label: string;
  }> = [
    { slot: "setup", ratio: 0.14, label: "early setup beat" },
    { slot: "turn", ratio: 0.5, label: "middle turn beat" },
    { slot: "payoff", ratio: 0.86, label: "late payoff beat" }
  ];

  return framePlan.map((item, index) => {
    const timestampSec = Math.max(0.1, Math.min(maxTs, safeDuration * item.ratio + index * 0.01));
    return {
      slot: item.slot,
      timestampSec,
      description: `${item.slot} frame: ${item.label} at ${timestampSec.toFixed(2)}s of ${safeDuration.toFixed(2)}s`
    };
  });
}

async function probeVideoDurationSeconds(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        videoPath
      ],
      {
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      }
    );
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function extractReferenceFrames(input: {
  referenceId: string;
  videoPath: string;
  tmpDir: string;
}): Promise<{
  frameImagePaths: string[];
  frameMoments: Array<{
    slot: Stage2StyleDiscoveryReferenceFrameSlot;
    description: string;
  }>;
}> {
  const duration = await probeVideoDurationSeconds(input.videoPath);
  const framePlan = buildStyleDiscoveryReferenceFramePlan(duration);
  const frameImagePaths: string[] = [];
  const frameMoments: Array<{
    slot: Stage2StyleDiscoveryReferenceFrameSlot;
    description: string;
  }> = [];

  for (let index = 0; index < framePlan.length; index += 1) {
    const frame = framePlan[index];
    if (!frame) {
      continue;
    }
    const framePath = path.join(input.tmpDir, `${input.referenceId}-${frame.slot}.jpg`);
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        frame.timestampSec.toFixed(3),
        "-i",
        input.videoPath,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        framePath
      ],
      {
        timeout: 60_000,
        maxBuffer: 1024 * 1024 * 2
      }
    );
    frameImagePaths.push(framePath);
    frameMoments.push({
      slot: frame.slot,
      description: frame.description
    });
  }

  return { frameImagePaths, frameMoments };
}

function summarizeReferencePackagingSignals(input: {
  title: string;
  description: string;
  transcriptExcerpt: string;
  frameMoments: string[];
}): string {
  const combined = [input.title, input.description, input.transcriptExcerpt].filter(Boolean).join(" ");
  const matchedModes = PACKAGING_MODE_PATTERNS.filter((entry) => entry.pattern.test(combined))
    .map((entry) => entry.cue)
    .slice(0, 3);
  const frameSummary =
    input.frameMoments.length > 0
      ? `Есть реальные кадры setup / turn / payoff: ${input.frameMoments.join(" | ")}.`
      : "Реальные кадры не удалось приложить, опираемся на metadata и comments.";
  return [matchedModes.length > 0 ? matchedModes.join(" | ") : "", frameSummary]
    .filter(Boolean)
    .join(" ");
}

export function buildStage2StyleDiscoveryReferenceSetEvidence(input: {
  references: Array<{
    referenceLink: Stage2StyleReferenceLink;
    prioritizedComments: Stage2StyleDiscoveryCommentSignal[];
    commentPortrait: Stage2StyleDiscoveryCommentPortrait;
    frameMoments: Array<{ slot: Stage2StyleDiscoveryReferenceFrameSlot; description: string }>;
    frameImagePaths: string[];
    extractionNotes: string[];
    usable: boolean;
  }>;
  promptVersion: string;
}): Stage2StyleDiscoveryEvidence {
  const totalReferences = input.references.length;
  const usableReferences = input.references.filter((reference) => reference.usable).length;
  const referencesWithTranscript = input.references.filter((reference) =>
    Boolean(reference.referenceLink.transcriptExcerpt)
  ).length;
  const referencesWithComments = input.references.filter(
    (reference) => reference.prioritizedComments.length > 0
  ).length;
  const referencesWithFrames = input.references.filter(
    (reference) => reference.frameImagePaths.length >= 3
  ).length;
  const imagesUsed = referencesWithFrames > 0;

  const mergeRepeated = (values: string[]) =>
    Array.from(
      values.reduce((accumulator, value) => {
        const key = normalizePromptKey(value);
        if (!key) {
          return accumulator;
        }
        accumulator.set(key, (accumulator.get(key) ?? 0) + 1);
        return accumulator;
      }, new Map<string, number>())
    )
      .sort((left, right) => right[1] - left[1])
      .map(([value]) => value)
      .slice(0, 6);

  const repeatedLanguage = mergeRepeated(
    input.references.flatMap((reference) => reference.commentPortrait.repeatedLanguage)
  );
  const rewards = mergeRepeated(
    input.references.flatMap((reference) => reference.commentPortrait.rewards)
  );
  const jokes = mergeRepeated(
    input.references.flatMap((reference) => reference.commentPortrait.jokes)
  );
  const pushback = mergeRepeated(
    input.references.flatMap((reference) => reference.commentPortrait.pushback)
  );
  const suspicion = mergeRepeated(
    input.references.flatMap((reference) => reference.commentPortrait.suspicion)
  );
  const tonePreferences = mergeRepeated(
    input.references.flatMap((reference) => reference.commentPortrait.tonePreferences)
  );
  const rejects = mergeRepeated(
    input.references.flatMap((reference) => reference.commentPortrait.rejects)
  );

  const dominantPostureCounts = new Map<string, number>();
  for (const reference of input.references) {
    const posture = sanitizeString(reference.commentPortrait.dominantPosture);
    if (!posture) {
      continue;
    }
    dominantPostureCounts.set(posture, (dominantPostureCounts.get(posture) ?? 0) + 1);
  }
  const dominantPosture =
    Array.from(dominantPostureCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ??
    "аудитория смешанная, но всё равно оставляет читаемые повторяющиеся вкусы";

  const packagingModes = mergeRepeated(
    input.references.flatMap((reference) => {
      const combined = [
        reference.referenceLink.title,
        reference.referenceLink.description,
        reference.referenceLink.transcriptExcerpt
      ]
        .filter(Boolean)
        .join(" ");
      return PACKAGING_MODE_PATTERNS.filter((entry) => entry.pattern.test(combined)).map(
        (entry) => entry.mode
      );
    })
  );
  const packagingModeKeys = new Set(packagingModes.map((mode) => normalizePromptKey(mode)));
  const momentPatterns = mergeRepeated(
    input.references.flatMap((reference) => reference.frameMoments.map((frame) => frame.description))
  ).slice(0, 4);
  const visualTriggers = mergeRepeated(
    input.references
      .filter((reference) => reference.frameImagePaths.length > 0)
      .flatMap((reference) => summarizeReferencePackagingSignals({
        title: reference.referenceLink.title,
        description: reference.referenceLink.description,
        transcriptExcerpt: reference.referenceLink.transcriptExcerpt,
        frameMoments: reference.frameMoments.map((frame) => frame.description)
      }).split("|"))
  ).slice(0, 6);
  const topMechanics = [
    packagingModeKeys.has("reaction first")
      ? "TOP может входить через самую заметную реакцию кадра"
      : "",
    packagingModeKeys.has("reveal first")
      ? "TOP может обещать поворот, не пересказывая весь сюжет"
      : "",
    packagingModeKeys.has("competence oriented")
      ? "TOP хорошо работает через точность, навык или ошибку"
      : "",
    packagingModeKeys.has("meme compressed")
      ? "TOP может быть короче и плотнее, если сам кадр уже всё поджигает"
      : ""
  ].filter(Boolean);
  const bottomMechanics = [
    jokes.length > 0 ? "BOTTOM может мягко приземляться в audience joke lane, но без paste comments" : "",
    suspicion.length > 0
      ? "BOTTOM иногда должен оставлять место для скепсиса или hidden-read, если аудитория его ищет"
      : "",
    pushback.length > 0 ? "BOTTOM не должен звучать слишком самодовольно, если аудитория любит спорить" : "",
    rewards.length > 0 ? "BOTTOM может завершать человеческим social read вместо общего пафоса" : ""
  ].filter(Boolean);

  const repeatedCrossReferencePatterns = [
    repeatedLanguage.length >= 2 ? 1 : 0,
    rewards.length >= 2 ? 1 : 0,
    jokes.length >= 2 ? 1 : 0,
    suspicion.length >= 2 ? 1 : 0,
    packagingModes.length >= 2 ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
  const coverageScore =
    (usableReferences / Math.max(totalReferences, 1)) * 0.3 +
    (referencesWithComments / Math.max(totalReferences, 1)) * 0.3 +
    (referencesWithFrames / Math.max(totalReferences, 1)) * 0.22 +
    (referencesWithTranscript / Math.max(totalReferences, 1)) * 0.1 +
    Math.min(1, repeatedCrossReferencePatterns / 4) * 0.08;
  const confidence: Stage2BootstrapConfidenceLevel =
    coverageScore >= 0.72 ? "high" : coverageScore >= 0.45 ? "medium" : "low";
  const evidenceNotes = [
    `${usableReferences}/${totalReferences} references gave usable evidence.`,
    `${referencesWithComments}/${totalReferences} references contributed meaningful comment signal.`,
    `${referencesWithFrames}/${totalReferences} references contributed real sampled frames.`,
    `${referencesWithTranscript}/${totalReferences} references contributed transcript text.`,
    repeatedCrossReferencePatterns >= 2
      ? "Repeated audience patterns show up across multiple references instead of only one outlier clip."
      : "Cross-reference patterns are relatively mixed, so bootstrap should stay a bit more exploratory."
  ];
  const confidenceSummary =
    confidence === "high"
      ? "Bootstrap evidence is strong enough to describe both audience taste and packaging habits with decent confidence."
      : confidence === "medium"
        ? "Bootstrap evidence is usable but mixed, so the proposed lanes should stay broad and avoid overclaiming."
        : "Bootstrap evidence is thin or fragmented, so style discovery should stay honest and keep more exploratory room.";

  const audienceSeed: Stage2StyleAudiencePortrait = {
    summary: [
      rewards.length > 0 ? `Аудитория вознаграждает: ${rewards.join(", ")}.` : "",
      jokes.length > 0 ? `Шутки и мемные чтения крутятся вокруг: ${jokes.join(", ")}.` : "",
      pushback.length > 0 ? `Толчки против подачи: ${pushback.join(", ")}.` : "",
      suspicion.length > 0 ? `Подозрения и hidden-reads: ${suspicion.join(", ")}.` : "",
      repeatedLanguage.length > 0 ? `Повторяющийся словарь: ${repeatedLanguage.join(", ")}.` : "",
      dominantPosture
    ]
      .filter(Boolean)
      .join(" "),
    rewards,
    jokes,
    pushback,
    suspicion,
    languageCues: repeatedLanguage,
    dominantPosture,
    tonePreferences,
    rejects
  };

  const packagingSeed: Stage2StylePackagingPortrait = {
    summary: [
      packagingModes.length > 0
        ? `По metadata и кадрам чаще всего просматриваются modes: ${packagingModes.join(", ")}.`
        : "",
      referencesWithFrames > 0
        ? `Реальные кадры setup / turn / payoff приложены для ${referencesWithFrames} референсов и должны читать упаковку визуально, не только по metadata.`
        : "Кадров мало, поэтому packaging portrait должен быть осторожнее и честнее.",
      topMechanics.length > 0 ? topMechanics.join(" ") : "",
      bottomMechanics.length > 0 ? bottomMechanics.join(" ") : ""
    ]
      .filter(Boolean)
      .join(" "),
    momentPatterns,
    visualTriggers,
    topMechanics: topMechanics.slice(0, 5),
    bottomMechanics: bottomMechanics.slice(0, 5),
    framingModes: packagingModes
  };

  const imagesManifest = input.references.flatMap((reference) =>
    reference.frameMoments.map((frame, index) => ({
      imageIndex:
        input.references
          .slice(0, input.references.indexOf(reference))
          .reduce((sum, item) => sum + item.frameImagePaths.length, 0) + index + 1,
      referenceId: reference.referenceLink.id,
      frameSlot: frame.slot,
      description: frame.description
    }))
  );

  return {
    audienceSeed,
    packagingSeed,
    diagnosticsSeed: {
      confidence,
      totalReferences,
      usableReferences,
      referencesWithTranscript,
      referencesWithComments,
      referencesWithFrames,
      imagesUsed,
      promptVersion: input.promptVersion,
      commentCoverageSummary: `${referencesWithComments}/${totalReferences} references contributed prioritized comment packets; comments are the primary audience signal in this bootstrap run.`,
      extractionSummary: `Reference extraction pulled title / description / transcript excerpt when available, prioritized liked comments, and sampled setup/turn/payoff frames where media download succeeded.`,
      evidenceNotes
    },
    imagesManifest,
    referenceExtractionSummary: confidenceSummary
  };
}

async function collectStage2StyleReferenceLink(
  referenceUrl: string,
  index: number
): Promise<Stage2StyleDiscoveryCollectedReference> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "clips-style-ref-"));
  const extractionNotes: string[] = [];
  let title = `Reference ${index + 1}`;
  let description = "";
  let transcriptExcerpt = "";
  let prioritizedComments: Stage2StyleDiscoveryCommentSignal[] = [];
  let totalCommentCount = 0;
  let frameImagePaths: string[] = [];
  let frameMoments: Array<{
    slot: Stage2StyleDiscoveryReferenceFrameSlot;
    description: string;
  }> = [];

  try {
    const info = await fetchOptionalYtDlpInfo(referenceUrl, tmpDir);
    title = sanitizeString(info.infoJson?.title) || title;
    description = truncateText(
      sanitizeString(info.infoJson?.description),
      STAGE2_STYLE_DISCOVERY_REFERENCE_DESCRIPTION_MAX_CHARS
    );
    transcriptExcerpt = truncateText(
      sanitizeString(info.infoJson?.transcript),
      STAGE2_STYLE_DISCOVERY_REFERENCE_TRANSCRIPT_MAX_CHARS
    );
    const normalizedComments = sortCommentsByPopularity(
      normalizeComments(info.infoJson?.comments ?? [])
    );
    totalCommentCount = normalizedComments.length;
    prioritizedComments = prioritizeStage2StyleDiscoveryComments(normalizedComments);
    extractionNotes.push(
      totalCommentCount > 0
        ? `Comment signal collected from ${totalCommentCount} available comments.`
        : "Comments were unavailable or too thin on the metadata path."
    );
  } catch (error) {
    extractionNotes.push(
      error instanceof Error
        ? `Metadata/comments extraction degraded: ${truncateText(error.message, 180)}`
        : "Metadata/comments extraction degraded."
    );
  }

  try {
    const media = await downloadSourceMedia(referenceUrl, tmpDir);
    const frames = await extractReferenceFrames({
      referenceId: `reference_${index + 1}`,
      videoPath: media.filePath,
      tmpDir
    });
    frameImagePaths = frames.frameImagePaths;
    frameMoments = frames.frameMoments;
    extractionNotes.push(
      frameImagePaths.length > 0
        ? `Sampled ${frameImagePaths.length} real frames from the clip.`
        : "No real frames were sampled from the clip."
    );
  } catch (error) {
    extractionNotes.push(
      error instanceof Error
        ? `Visual frame sampling degraded: ${truncateText(error.message, 180)}`
        : "Visual frame sampling degraded."
    );
  }

  const commentPortrait = summarizeReferenceCommentPortrait(prioritizedComments, totalCommentCount);
  const referenceLink = normalizeStage2StyleReferenceLink(
    {
      id: `reference_${index + 1}`,
      url: referenceUrl,
      normalizedUrl: referenceUrl,
      title,
      description,
      transcriptExcerpt,
      commentHighlights: prioritizedComments.map(
        (comment) => `${formatLikes(comment.likes)} likes · ${comment.text}`
      ),
      totalCommentCount,
      selectedCommentCount: prioritizedComments.length,
      audienceSignalSummary: commentPortrait.summary,
      frameMoments: frameMoments.map((frame) => frame.description),
      framesUsed: frameImagePaths.length > 0,
      sourceHint: hostLabelFromUrl(referenceUrl)
    },
    index
  ) as Stage2StyleReferenceLink;

  return {
    referenceLink,
    prioritizedComments,
    commentPortrait,
    frameImagePaths,
    frameMoments,
    extractionNotes,
    usable:
      Boolean(title) ||
      Boolean(description) ||
      Boolean(transcriptExcerpt) ||
      prioritizedComments.length > 0 ||
      frameImagePaths.length > 0,
    tmpDir
  };
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

async function collectStage2StyleDiscoveryReferences(
  referenceLinks: string[]
): Promise<Stage2StyleDiscoveryCollectedReference[]> {
  const normalizedLinks = normalizeStage2StyleDiscoveryReferenceUrls(referenceLinks);
  if (normalizedLinks.length < STAGE2_STYLE_MIN_REFERENCE_LINKS) {
    throw new Error(
      `Добавьте минимум ${STAGE2_STYLE_MIN_REFERENCE_LINKS} поддерживаемых ссылок перед запуском style discovery.`
    );
  }
  return mapWithConcurrency(normalizedLinks, 2, collectStage2StyleReferenceLink);
}

export async function collectStage2StyleReferenceLinks(
  referenceLinks: string[]
): Promise<Stage2StyleReferenceLink[]> {
  const collected = await collectStage2StyleDiscoveryReferences(referenceLinks);
  try {
    return collected.map((reference) => reference.referenceLink);
  } finally {
    await Promise.all(
      collected.map((reference) =>
        rm(reference.tmpDir, { recursive: true, force: true }).catch(() => undefined)
      )
    );
  }
}

export function buildStage2StyleDiscoveryPrompt(input: {
  channelName: string;
  username: string;
  hardConstraints: Stage2HardConstraints;
  referenceLinks: Stage2StyleReferenceLink[];
  evidence?: Stage2StyleDiscoveryEvidence | null;
}): string {
  const payload = {
    channelSetup: {
      name: sanitizeString(input.channelName) || "Untitled channel",
      username: sanitizeString(input.username),
      hardConstraints: input.hardConstraints
    },
    productRules: {
      visibleDirectionTarget: STAGE2_STYLE_DISCOVERY_TARGET_COUNT,
      internalDirectionTarget: STAGE2_STYLE_DISCOVERY_INTERNAL_TARGET_COUNT,
      exploratoryShare: STAGE2_EDITORIAL_EXPLORATION_SHARE,
      editorWillChooseFinalDirections: true,
      editorMaySelectManyDirections: true,
      referencesNarrowProposalSpaceButDoNotLockIdentity: true
    },
    evidence: input.evidence
      ? {
          extractionSummary: input.evidence.referenceExtractionSummary,
          confidence: {
            level: input.evidence.diagnosticsSeed.confidence,
            summary: input.evidence.diagnosticsSeed.evidenceNotes.join(" ")
          },
          audienceSeed: input.evidence.audienceSeed,
          packagingSeed: input.evidence.packagingSeed,
          imagesManifest: input.evidence.imagesManifest
        }
      : null,
    references: input.referenceLinks.map((reference) => ({
      id: reference.id,
      source: reference.sourceHint,
      url: reference.normalizedUrl,
      title: reference.title,
      description: reference.description,
      transcriptExcerpt: reference.transcriptExcerpt,
      commentCoverage: {
        total: reference.totalCommentCount,
        prioritized: reference.selectedCommentCount
      },
      audienceSignalSummary: reference.audienceSignalSummary,
      commentHighlights: reference.commentHighlights,
      frameMoments: reference.frameMoments,
      framesUsed: reference.framesUsed
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
    `- Internally think wider than the visible UI: aim for roughly 24-30 lanes, then return a strong candidate set that can later be deduped down to the best visible ${STAGE2_STYLE_DISCOVERY_TARGET_COUNT}.`,
    `- Rough target mix: 8-10 core high-fit directions, 6-8 adjacent directions, and 3-5 exploratory directions. Roughly ${Math.round(STAGE2_EDITORIAL_EXPLORATION_SHARE * 100)}% of the pool should stay exploratory.`,
    "- Comments are the primary signal for audience taste in this bootstrap run.",
    "- Real sampled frames are the primary signal for visual/editorial packaging in this bootstrap run.",
    "- Metadata and transcript help, but they should not dominate over comments and images.",
    "- Repeated patterns across multiple references matter more than one isolated outlier comment or one single viral clip.",
    "- Do not flatten mixed comments into one vague vibe if the audience is visibly split.",
    "- Build reusable editorial lanes, not literal retellings of the source clips.",
    "- Do not keep rephrasing the same specific plot beat, gesture, or source narrative.",
    "- If two candidate directions differ only by a tiny wording tweak around the same surface story, merge them into one stronger reusable lane instead.",
    "- Do not rely on a canned preset library or a rigid taxonomy.",
    "- Make the direction names human-readable, editorial, and easy to choose from.",
    "- The output is for a real editor, not for a prompt engineer.",
    "- All editor-facing fields must be written in natural Russian: direction cards, portraits, confidence summary, and reference_influence_summary.",
    "- Keep the Russian phrasing concise, human, and easy to scan in a card UI.",
    "- internalPromptNotes should stay concise and may remain in English because they are system-side.",
    "",
    "How to read the evidence:",
    "- commentHighlights already prioritize liked, more signal-rich comments; generic fandom noise was de-emphasized.",
    "- imagesManifest maps the attached images to reference ids and clip beats. Read the images as actual clip frames, not as OCR-only inputs.",
    "- If visible overlay text appears inside a frame, you may read it naturally, but OCR is not the primary task.",
    "",
    "First synthesize three things from the evidence before naming directions:",
    "1. audience_portrait: what the audience rewards, jokes about, argues about, suspects, and how they phrase it.",
    "2. packaging_portrait: what kinds of moments, visual triggers, framing habits, TOP mechanics, and BOTTOM mechanics the references imply.",
    "3. bootstrap_confidence: how strong or mixed the evidence really is. Be honest if the set is fragmented or weak.",
    "",
    "Then generate reusable style directions that:",
    "- include clear high-fit lanes, adjacent plausible lanes, and a smaller exploratory tail;",
    "- stay grounded in the references without mirroring their exact plots;",
    "- widen the viable editorial space instead of offering 20 poetic paraphrases of the same clip family;",
    "- stay editor-friendly and operational.",
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
    "- reference_influence_summary should explain the dominant signals from the links, the audience posture, and where the widened adjacent room is.",
    "",
    "Return strict JSON only.",
    "",
    "USER CONTEXT JSON",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function pickObjectStringArray(
  candidate: Record<string, unknown> | null,
  key: string,
  fallbackKey?: string
): string[] {
  const value = candidate?.[key] ?? (fallbackKey ? candidate?.[fallbackKey] : undefined);
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function buildFallbackAudiencePortrait(
  evidence: Stage2StyleDiscoveryEvidence | null | undefined
): Stage2StyleAudiencePortrait | null {
  if (!evidence) {
    return null;
  }
  return evidence.audienceSeed;
}

function buildFallbackPackagingPortrait(
  evidence: Stage2StyleDiscoveryEvidence | null | undefined
): Stage2StylePackagingPortrait | null {
  if (!evidence) {
    return null;
  }
  return evidence.packagingSeed;
}

function buildBootstrapDiagnostics(
  input: {
    evidence: Stage2StyleDiscoveryEvidence | null | undefined;
    confidenceSummary: string;
    confidenceNotes: string[];
    hiddenCandidatePoolSize: number;
    surfacedCandidateCount: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }
): Stage2StyleBootstrapDiagnostics | null {
  const evidence = input.evidence;
  if (!evidence) {
    return null;
  }
  return {
    ...evidence.diagnosticsSeed,
    summary: input.confidenceSummary || evidence.referenceExtractionSummary,
    hiddenCandidatePoolSize: input.hiddenCandidatePoolSize,
    surfacedCandidateCount: input.surfacedCandidateCount,
    model: input.model?.trim() || null,
    reasoningEffort: input.reasoningEffort?.trim() || null,
    evidenceNotes:
      input.confidenceNotes.length > 0 ? input.confidenceNotes : evidence.diagnosticsSeed.evidenceNotes
  };
}

function createDirectionDedupKey(direction: Stage2StyleDirection): string {
  return [
    normalizePromptKey(direction.name),
    normalizePromptKey(direction.voice),
    normalizePromptKey(direction.topPattern),
    normalizePromptKey(direction.bottomPattern)
  ].join("|");
}

function dedupeStage2StyleDirections(directions: Stage2StyleDirection[]): Stage2StyleDirection[] {
  const seen = new Set<string>();
  const deduped: Stage2StyleDirection[] = [];
  for (const direction of directions) {
    const key = createDirectionDedupKey(direction);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(direction);
  }
  return deduped;
}

function selectVisibleStage2StyleDirections(directions: Stage2StyleDirection[]): Stage2StyleDirection[] {
  const targetCount = STAGE2_STYLE_DISCOVERY_TARGET_COUNT;
  const fitBandQuotas: Record<Stage2StyleDirection["fitBand"], number> = {
    core: 9,
    adjacent: 7,
    exploratory: 4
  };
  const selected: Stage2StyleDirection[] = [];
  const usedIds = new Set<string>();

  (["core", "adjacent", "exploratory"] as const).forEach((fitBand) => {
    const matches = directions.filter((direction) => direction.fitBand === fitBand);
    for (const direction of matches.slice(0, fitBandQuotas[fitBand])) {
      if (selected.length >= targetCount || usedIds.has(direction.id)) {
        continue;
      }
      selected.push(direction);
      usedIds.add(direction.id);
    }
  });

  for (const direction of directions) {
    if (selected.length >= targetCount) {
      break;
    }
    if (usedIds.has(direction.id)) {
      continue;
    }
    selected.push(direction);
    usedIds.add(direction.id);
  }

  return selected.slice(0, targetCount);
}

export function normalizeStage2StyleDiscoveryResult(input: {
  rawResult: unknown;
  referenceLinks: Stage2StyleReferenceLink[];
  evidence?: Stage2StyleDiscoveryEvidence | null;
  model?: string | null;
  reasoningEffort?: string | null;
}): Stage2StyleProfile {
  const candidate =
    input.rawResult && typeof input.rawResult === "object"
      ? (input.rawResult as Record<string, unknown>)
      : {};
  const referenceIds = input.referenceLinks.map((reference) => reference.id);
  const directionsRaw = Array.isArray(candidate.directions) ? candidate.directions : [];
  const allCandidateDirections = dedupeStage2StyleDirections(
    directionsRaw
      .map((direction, index) =>
        normalizeStage2StyleDirection(direction, index, referenceIds)
      )
      .filter((direction): direction is Stage2StyleDirection => direction !== null)
  );
  const candidateDirections = selectVisibleStage2StyleDirections(allCandidateDirections);
  const audiencePortraitCandidate =
    candidate.audience_portrait && typeof candidate.audience_portrait === "object"
      ? (candidate.audience_portrait as Record<string, unknown>)
      : candidate.audiencePortrait && typeof candidate.audiencePortrait === "object"
        ? (candidate.audiencePortrait as Record<string, unknown>)
        : null;
  const packagingPortraitCandidate =
    candidate.packaging_portrait && typeof candidate.packaging_portrait === "object"
      ? (candidate.packaging_portrait as Record<string, unknown>)
      : candidate.packagingPortrait && typeof candidate.packagingPortrait === "object"
        ? (candidate.packagingPortrait as Record<string, unknown>)
        : null;
  const confidenceCandidate =
    candidate.bootstrap_confidence && typeof candidate.bootstrap_confidence === "object"
      ? (candidate.bootstrap_confidence as Record<string, unknown>)
      : candidate.bootstrapConfidence && typeof candidate.bootstrapConfidence === "object"
        ? (candidate.bootstrapConfidence as Record<string, unknown>)
        : null;
  const fallbackAudiencePortrait = buildFallbackAudiencePortrait(input.evidence);
  const fallbackPackagingPortrait = buildFallbackPackagingPortrait(input.evidence);

  const audiencePortrait: Stage2StyleAudiencePortrait | null =
    audiencePortraitCandidate
      ? {
          summary:
            sanitizeString(audiencePortraitCandidate.summary) ||
            fallbackAudiencePortrait?.summary ||
            "Комментарии помогают увидеть, что аудитория на самом деле вознаграждает, а не только что происходит в самих роликах.",
          rewards: pickObjectStringArray(audiencePortraitCandidate, "rewards").slice(0, 6),
          jokes: pickObjectStringArray(audiencePortraitCandidate, "jokes").slice(0, 6),
          pushback: pickObjectStringArray(audiencePortraitCandidate, "pushback").slice(0, 6),
          suspicion: pickObjectStringArray(audiencePortraitCandidate, "suspicion").slice(0, 6),
          languageCues: pickObjectStringArray(
            audiencePortraitCandidate,
            "language_cues",
            "languageCues"
          ).slice(0, 8),
          dominantPosture:
            sanitizeString(audiencePortraitCandidate.dominant_posture) ||
            sanitizeString(audiencePortraitCandidate.dominantPosture) ||
            fallbackAudiencePortrait?.dominantPosture ||
            "аудитория смешанная, но с повторяющимися читаемыми вкусами",
          tonePreferences: pickObjectStringArray(
            audiencePortraitCandidate,
            "tone_preferences",
            "tonePreferences"
          ).slice(0, 6),
          rejects: pickObjectStringArray(audiencePortraitCandidate, "rejects").slice(0, 6)
        }
      : fallbackAudiencePortrait;

  const packagingPortrait: Stage2StylePackagingPortrait | null =
    packagingPortraitCandidate
      ? {
          summary:
            sanitizeString(packagingPortraitCandidate.summary) ||
            fallbackPackagingPortrait?.summary ||
            "Референсы дают визуальные подсказки по тому, какие моменты и подача реально работают как упаковка.",
          momentPatterns: pickObjectStringArray(
            packagingPortraitCandidate,
            "moment_patterns",
            "momentPatterns"
          ).slice(0, 6),
          visualTriggers: pickObjectStringArray(
            packagingPortraitCandidate,
            "visual_triggers",
            "visualTriggers"
          ).slice(0, 6),
          topMechanics: pickObjectStringArray(
            packagingPortraitCandidate,
            "top_mechanics",
            "topMechanics"
          ).slice(0, 6),
          bottomMechanics: pickObjectStringArray(
            packagingPortraitCandidate,
            "bottom_mechanics",
            "bottomMechanics"
          ).slice(0, 6),
          framingModes: pickObjectStringArray(
            packagingPortraitCandidate,
            "framing_modes",
            "framingModes"
          ).slice(0, 6)
        }
      : fallbackPackagingPortrait;

  const confidenceLevel = sanitizeString(confidenceCandidate?.level).toLowerCase();
  const confidenceNotes = pickObjectStringArray(
    confidenceCandidate,
    "evidence_notes",
    "evidenceNotes"
  ).slice(0, 8);
  const bootstrapDiagnostics = buildBootstrapDiagnostics({
    evidence: input.evidence,
    confidenceSummary:
      sanitizeString(confidenceCandidate?.summary) ||
      input.evidence?.referenceExtractionSummary ||
      "Референсы помогли сузить пространство вариантов, но итоговый стартовый стиль всё равно выбирает редактор.",
    confidenceNotes,
    hiddenCandidatePoolSize: allCandidateDirections.length,
    surfacedCandidateCount: candidateDirections.length,
    model: input.model,
    reasoningEffort: input.reasoningEffort
  });

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
    audiencePortrait,
    packagingPortrait,
    bootstrapDiagnostics:
      bootstrapDiagnostics && confidenceLevel
        ? {
            ...bootstrapDiagnostics,
            confidence:
              confidenceLevel === "high" || confidenceLevel === "medium" || confidenceLevel === "low"
                ? (confidenceLevel as Stage2BootstrapConfidenceLevel)
                : bootstrapDiagnostics.confidence
          }
        : bootstrapDiagnostics,
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
  imagePaths?: string[];
  evidence?: Stage2StyleDiscoveryEvidence | null;
  reasoningEffort?: string | null;
  model?: string | null;
}): Promise<Stage2StyleProfile> {
  const prompt = buildStage2StyleDiscoveryPrompt({
    channelName: input.channelName,
    username: input.username,
    hardConstraints: input.hardConstraints,
    referenceLinks: input.referenceLinks,
    evidence: input.evidence
  });

  const rawResult = await input.executor.runJson<unknown>({
    prompt,
    schema: STYLE_DISCOVERY_SCHEMA,
    imagePaths: input.imagePaths ?? [],
    model: input.model ?? null,
    reasoningEffort: input.reasoningEffort ?? "high"
  });

  return normalizeStage2StyleDiscoveryResult({
    rawResult,
    referenceLinks: input.referenceLinks,
    evidence: input.evidence,
    model: input.model,
    reasoningEffort: input.reasoningEffort
  });
}

export async function discoverStage2StyleProfile(input: {
  workspaceId: string;
  channelName: string;
  username: string;
  hardConstraints: Stage2HardConstraints;
  referenceUrls: string[];
}): Promise<Stage2StyleProfile> {
  const collectedReferences = await collectStage2StyleDiscoveryReferences(input.referenceUrls);
  try {
    const referenceLinks = collectedReferences.map((reference) => reference.referenceLink);
    const evidence = buildStage2StyleDiscoveryReferenceSetEvidence({
      references: collectedReferences,
      promptVersion: STAGE2_STYLE_DISCOVERY_PROMPT_VERSION
    });
    const executorContext = await createStage2CodexExecutorContext(input.workspaceId);
    return runStage2StyleDiscovery({
      executor: executorContext.executor,
      channelName: input.channelName,
      username: input.username,
      hardConstraints: input.hardConstraints,
      referenceLinks,
      imagePaths: collectedReferences.flatMap((reference) => reference.frameImagePaths),
      evidence,
      model: executorContext.resolvedCodexModelConfig.styleDiscovery,
      reasoningEffort: executorContext.reasoningEffort
    });
  } finally {
    await Promise.all(
      collectedReferences.map((reference) =>
        rm(reference.tmpDir, { recursive: true, force: true }).catch(() => undefined)
      )
    );
  }
}
