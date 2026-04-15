import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppShell,
  getWorkspaceLogoutLabel,
  getOverflowActionWrapperProps,
  type AppShellProps
} from "../app/components/AppShell";
import {
  buildHistorySections,
  getHistoryProgressBadge,
  matchesHistoryFilter,
  upsertHistoryItemByMeaningfulUpdate
} from "../app/components/history-panel-support";
import {
  CHANNEL_MANAGER_DEFAULT_SETTINGS_ID,
  canDeleteManagedChannel,
  describeChannelManagerSavePatch,
  listChannelManagerTargets
} from "../app/components/ChannelManager";
import { ChannelManagerStage2Tab } from "../app/components/ChannelManagerStage2Tab";
import { Step1PasteLink } from "../app/components/Step1PasteLink";
import {
  normalizeStage2DiagnosticsForView,
  Stage2RunDiagnosticsPanels,
  Step2PickCaption
} from "../app/components/Step2PickCaption";
import { Step3RenderTemplate } from "../app/components/Step3RenderTemplate";
import type {
  Channel,
  SourceJobDetail,
  SourceJobResult,
  SourceJobSummary,
  Stage2Response,
  Stage2RunSummary,
  Stage3Version
} from "../app/components/types";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  createStage2ProgressSnapshot,
  getStage2DefaultPromptCompatibility,
  markStage2ProgressStageCompleted,
  markStage2ProgressStageFailed,
  markStage2ProgressStageRunning,
  normalizeStage2ProgressSnapshot,
  normalizeStage2PromptConfig,
  prepareStage2PromptConfigForExplicitSave
} from "../lib/stage2-pipeline";
import {
  issueScopedRequestVersion,
  matchesScopedRequestVersion,
  pickPreferredStage2RunId
} from "../lib/stage2-run-client";
import { buildStage2RunRequestSnapshot } from "../lib/stage2-run-request";
import { getRestrictedChannelEditError } from "../lib/channel-edit-permissions";
import { buildStage2SeoPrompt } from "../lib/stage2-seo";
import { buildStage2Spec } from "../lib/stage2-spec";
import {
  buildQuickRegeneratePrompt,
  buildQuickRegenerateResult
} from "../lib/stage2-quick-regenerate";
import {
  pickPreferredSourceJobId,
  resolveSourceFetchBlockedReason,
  shouldReuseActiveChatForSourceFetch
} from "../lib/source-job-client";
import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  formatStage2DelimitedStringList,
  getBundledStage2ExamplesSeed,
  getBundledStage2ExamplesSeedJson,
  normalizeStage2HardConstraints,
  parseStage2DelimitedStringList,
  resolveStage2ExamplesCorpus,
  Stage2CorpusExample,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "../lib/stage2-channel-config";
import {
  createEmptyStage2EditorialMemorySummary,
  normalizeStage2StyleProfile
} from "../lib/stage2-channel-learning";
import { resolveChannelPermissions } from "../lib/acl";
import { prepareCommentsForPrompt, sortCommentsByPopularity } from "../lib/comments";
import { fetchCommentsForUrl } from "../lib/source-comments";
import {
  pickPreferredYtDlpInfoJsonFile,
  readYtDlpMetadataArtifacts
} from "../lib/ytdlp-metadata";
import { fetchTranscriptFromYtDlpInfo } from "../lib/youtube-captions";
import { YouTubeCommentsApiError } from "../lib/youtube-comments";
import { buildLimitedCommentsExtractorArgs } from "../lib/ytdlp";
import { validateStage2Output } from "../lib/stage2-output-validation";
import {
  CandidateLifecycle,
  applyExampleRoutingDecision,
  buildTraceV3,
  decideExampleRouting,
  validateTitle,
  validateTraceV3
} from "../lib/stage2-vnext";
import {
  assertCodexProducedFinalMessage,
  formatCodexExecFailureMessage,
  normalizeCodexReasoningEffort
} from "../lib/codex-runner";
import {
  buildAnalyzerPrompt,
  buildCriticPrompt,
  buildStage2SourceContextSummary,
  evaluateHumanPhrasingSignals,
  evaluateTopHookSignals,
  buildFinalSelectorPrompt,
  buildPromptPacket,
  buildRewriterPrompt,
  buildWriterPrompt,
  resolveStage2PromptTemplate
} from "../lib/viral-shorts-worker/prompts";
import type { Stage2ExamplesAssessment } from "../lib/viral-shorts-worker/types";
import {
  auditStage2WorkerRollout,
  buildAdaptiveFramePlan,
  buildStage2RuntimeVideoContext
} from "../lib/stage2-runner";
import { buildSelectorExamplePool } from "../lib/viral-shorts-worker/selector-example-pool";
import { resolveStage3BackgroundMode } from "../lib/stage3-background-mode";
import { shouldUseCodexPlanner } from "../lib/stage3-agent-autonomous";
import { getTemplateFigmaSpec } from "../lib/stage3-template-spec";
import {
  AMERICAN_NEWS_TEMPLATE_ID,
  getTemplateById,
  HEDGES_OF_HONOR_TEMPLATE_ID,
  SCIENCE_CARD_BLUE_TEMPLATE_ID,
  SCIENCE_CARD_GREEN_TEMPLATE_ID,
  SCIENCE_CARD_RED_TEMPLATE_ID,
  SCIENCE_CARD_TEMPLATE_ID
} from "../lib/stage3-template";
import {
  buildTemplateHighlightSpansFromPhrases,
  createDefaultTemplateHighlightConfig,
  type TemplateHighlightConfig
} from "../lib/template-highlights";
import { prepareCodexSchemaTransport } from "../lib/viral-shorts-worker/executor";
import {
  applyStage2CaptionToStage3Text,
  buildStage2ToStage3HandoffSummary
} from "../lib/stage2-stage3-handoff";
import {
  buildStage3DraftRenderPlanOverride,
  sanitizeStage3DraftRenderPlanOverride
} from "../lib/stage3-draft-render-plan";
import {
  buildVideoContext,
  repairCandidateForHardConstraints,
  ViralShortsWorkerService
} from "../lib/viral-shorts-worker/service";
import type { JsonStageExecutor } from "../lib/viral-shorts-worker/executor";
import { extractStage2Payload, normalizeChatDraft } from "../lib/chat-workflow";
import { createStage2Run, getStage2Run, setStage2RunResultData } from "../lib/stage2-progress-store";
import { fallbackRenderPlan, normalizeRenderPlan } from "../app/home-page-support";
import { hydrateStage3RenderPlanOverride } from "../app/home-page-support";
import {
  getTemplateVariant,
  resolveTemplateBuiltInBackdropAssetPath,
  templateUsesBuiltInBackdropFromRegistry
} from "../lib/stage3-template-registry";
import { resolveTemplateBackdropNode } from "../lib/stage3-template-runtime";
import { Stage3TemplateRenderer } from "../lib/stage3-template-renderer";
import { buildStage3PreviewDedupeKey } from "../lib/stage3-preview-service";
import { enqueueStage3Job } from "../lib/stage3-job-store";
import {
  buildLegacyCameraKeyframes,
  resolveCameraStateAtTime,
  resolveStage3EffectiveCameraTracks,
  resolveStage3EffectiveCameraKeyframes
} from "../lib/stage3-camera";

function nowIso(): string {
  return new Date().toISOString();
}

function makeExample(input: {
  id: string;
  ownerChannelId: string;
  ownerChannelName: string;
  title: string;
  clipType?: string;
  overlayTop?: string;
  overlayBottom?: string;
  whyItWorks?: string[];
  qualityScore?: number | null;
}): Stage2CorpusExample {
  return {
    id: input.id,
    ownerChannelId: input.ownerChannelId,
    ownerChannelName: input.ownerChannelName,
    sourceChannelId: input.ownerChannelId,
    sourceChannelName: input.ownerChannelName,
    title: input.title,
    overlayTop: input.overlayTop ?? `${input.title} top`,
    overlayBottom: input.overlayBottom ?? `${input.title} bottom`,
    transcript: `${input.title} transcript`,
    clipType: input.clipType ?? "mechanical_failure",
    whyItWorks: input.whyItWorks ?? ["clear visual hook"],
    qualityScore: input.qualityScore === undefined ? 0.9 : input.qualityScore
  };
}

function makeExamplesAssessment(
  overrides?: Partial<Stage2ExamplesAssessment>
): Stage2ExamplesAssessment {
  return {
    retrievalConfidence: "high",
    examplesMode: "domain_guided",
    explanation: "Top examples are domain-near and strong enough to guide framing.",
    evidence: ["2/5 top examples are domain-near", "avg semantic fit 0.72"],
    retrievalWarning: null,
    examplesRoleSummary: "Examples can guide semantics, structure, and tone.",
    primaryDriverSummary: "Clip truth stays primary, with strong retrieval support.",
    primaryDrivers: [
      "actual clip truth",
      "retrieval examples as semantic guidance",
      "bootstrap channel style directions",
      "rolling editorial memory"
    ],
    channelStylePriority: "supporting",
    editorialMemoryPriority: "supporting",
    ...overrides
  };
}

function toExamplesJson(examples: Stage2CorpusExample[]): string {
  return JSON.stringify(examples, null, 2);
}

function makeCandidate(candidateId: string, angle: string, index: number) {
  return {
    candidate_id: candidateId,
    angle,
    top: `The frame catches the axle snapping sideways ${index}`,
    bottom: `"He knew it was bad," and the whole crowd hears it ${index}`,
    top_ru: `В кадре видно, как мост уходит набок ${index}`,
    bottom_ru: `"Он уже понял, что это конец", и вся толпа это слышит ${index}`,
    rationale: `Candidate ${index} leans into ${angle}.`
  };
}

function makeFixedLengthText(seed: string, length: number): string {
  const normalizedSeed = seed.trim() || "text";
  return normalizedSeed.repeat(Math.ceil(length / normalizedSeed.length)).slice(0, length);
}

function makeNativeCaptionCandidateFixture(input: {
  candidateId: string;
  topLength: number;
  bottomLength: number;
  angle?: string;
  hookFamily?: string;
  cueUsed?: string;
  laneId?: string;
  retainedHandle?: boolean;
  displayIntent?: "finalist_or_display_safe" | "recovery" | "template_backfill";
  topText?: string;
  bottomText?: string;
}) {
  return {
    candidate_id: input.candidateId,
    angle: input.angle ?? input.laneId ?? "shared_experience",
    lane_id: input.laneId ?? input.angle ?? "shared_experience",
    hook_family: input.hookFamily ?? "contradiction_first",
    cue_used: input.cueUsed ?? "none",
    top:
      input.topText ??
      makeFixedLengthText(`${input.candidateId} TOP `, input.topLength),
    bottom:
      input.bottomText ??
      makeFixedLengthText(`${input.candidateId} BOTTOM `, input.bottomLength),
    retained_handle: input.retainedHandle ?? false,
    display_intent: input.displayIntent ?? "finalist_or_display_safe"
  };
}

function makeNativeCaptionContextPacket() {
  return {
    grounding: {
      observedFacts: ["A visible pause changes the room tone."],
      visibleSequence: ["One person freezes mid-sentence."],
      microTurn: "The pause becomes the clip.",
      firstSecondsSignal: "A casual setup turns tense.",
      uncertainties: [],
      forbiddenClaims: [],
      safeInferences: ["The room reads the pause immediately."]
    },
    audienceWave: {
      exists: true,
      emotionalTemperature: "tense amusement",
      dominantHarmlessHandle: "that pause said enough",
      consensusLane: "Everybody clocked the same awkward turn.",
      jokeLane: "the pause said enough",
      dissentLane: "",
      safeReusableCues: ["the pause said enough"],
      blockedCues: [],
      flatteningRisks: ["generic clean English"],
      mustNotLose: ["the pause said enough"]
    },
    strategy: {
      primaryAngle: "awkward_pause",
      secondaryAngles: ["shared_read"],
      hookSeeds: ["That pause changed the whole room"],
      bottomFunctions: ["sharpen the social read"],
      requiredLanes: [
        {
          laneId: "audience_locked",
          count: 2,
          purpose: "Preserve the dominant harmless public handle."
        },
        {
          laneId: "balanced_clean",
          count: 2,
          purpose: "Keep the clip native and strong without flattening it."
        },
        {
          laneId: "backup_simple",
          count: 1,
          purpose: "Hold a plainer but still alive fallback lane."
        }
      ],
      mustDo: ["land the why-care immediately"],
      mustAvoid: ["recap pacing"]
    }
  };
}

function makeNativeCaptionChannel(
  hardConstraints: Stage2HardConstraints = DEFAULT_STAGE2_HARD_CONSTRAINTS,
  stage2WorkerProfileId: string | null = null,
  options?: {
    templateHighlightProfile?: TemplateHighlightConfig | null;
  }
) {
  return {
    id: "native-channel",
    name: "Native Channel",
    username: "native_channel",
    stage2WorkerProfileId,
    stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
    stage2HardConstraints: hardConstraints,
    templateHighlightProfile: options?.templateHighlightProfile ?? null
  };
}

const RELAXED_NATIVE_HARD_CONSTRAINTS: Stage2HardConstraints = {
  ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
  topLengthMax: 140,
  bottomLengthMax: 170
};

function makeSparseNativeVideoContext() {
  return buildVideoContext({
    sourceUrl: "https://example.com/native-short",
    title: "A pause changes the room",
    description: "",
    transcript: "",
    comments: [],
    frameDescriptions: ["A person stops talking while everyone looks over."],
    userInstruction: null
  });
}

function makeCriticScoreMap(index: number): Record<string, number> {
  const base = 9 - index * 0.1;
  return {
    visual_anchor: Number((base).toFixed(2)),
    hook_strength: Number((base - 0.1).toFixed(2)),
    naturalness: Number((base - 0.2).toFixed(2)),
    brand_fit: Number((base - 0.15).toFixed(2)),
    specificity: Number((base - 0.1).toFixed(2)),
    top_bottom_synergy: Number((base - 0.2).toFixed(2)),
    readability: Number((base - 0.05).toFixed(2)),
    non_ai_feel: Number((base - 0.12).toFixed(2)),
    paused_frame_accuracy: Number((base - 0.08).toFixed(2)),
    comment_vibe_authenticity: Number((base - 0.18).toFixed(2)),
    length_compliance: Number((base - 0.03).toFixed(2)),
    narrative_trigger_strength: Number((base - 0.09).toFixed(2)),
    context_compression_quality: Number((base - 0.11).toFixed(2))
  };
}

type ExecutorCall = {
  prompt: string;
  schema: unknown;
  imagePaths?: string[];
  reasoningEffort?: string | null;
};

function extractPromptJsonPayload(prompt: string): Record<string, unknown> | null {
  const marker = "USER CONTEXT JSON\n";
  const markerIndex = prompt.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  try {
    return JSON.parse(prompt.slice(markerIndex + marker.length)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function looksLikeCaptionTranslationResponse(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.candidate_id === "string" &&
        typeof candidate.top_ru === "string" &&
        typeof candidate.bottom_ru === "string"
      );
    })
  );
}

function synthesizeCaptionTranslationFromPrompt(prompt: string): Array<{
  candidate_id: string;
  top_ru: string;
  bottom_ru: string;
}> {
  const payload = extractPromptJsonPayload(prompt);
  const displayOptions = Array.isArray(payload?.display_options_json)
    ? payload.display_options_json
    : [];
  return displayOptions
    .map((entry) => {
      const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
      const candidateId = typeof item?.candidate_id === "string" ? item.candidate_id.trim() : "";
      const top = typeof item?.top === "string" ? item.top.trim() : "";
      const bottom = typeof item?.bottom === "string" ? item.bottom.trim() : "";
      if (!candidateId || !top || !bottom) {
        return null;
      }
      return {
        candidate_id: candidateId,
        top_ru: `RU ${top}`,
        bottom_ru: `RU ${bottom}`
      };
    })
    .filter((entry): entry is { candidate_id: string; top_ru: string; bottom_ru: string } => Boolean(entry));
}

class QueueExecutor implements JsonStageExecutor {
  readonly calls: ExecutorCall[] = [];

  constructor(private readonly responses: unknown[]) {}

  async runJson<T>(input: {
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T> {
    this.calls.push({
      prompt: input.prompt,
      schema: input.schema,
      imagePaths: input.imagePaths,
      reasoningEffort: input.reasoningEffort ?? null
    });
    const next = this.responses[0];
    if (
      input.prompt.includes("display_options_json") &&
      !input.prompt.includes("template_highlight_profile_json") &&
      !(next instanceof Error) &&
      !looksLikeCaptionTranslationResponse(next)
    ) {
      return synthesizeCaptionTranslationFromPrompt(input.prompt) as T;
    }
    if (this.responses.length === 0) {
      throw new Error("No queued executor response.");
    }
    const queued = this.responses.shift();
    if (queued instanceof Error) {
      throw queued;
    }
    return queued as T;
  }
}

async function runNativeCaptionPipelineFixture(input: {
  responses: unknown[];
  promptConfig?: ReturnType<typeof normalizeStage2PromptConfig>;
  hardConstraints?: Stage2HardConstraints;
  stage2WorkerProfileId?: string | null;
  templateHighlightProfile?: TemplateHighlightConfig | null;
  videoContext?: ReturnType<typeof buildVideoContext>;
  contextPacket?: ReturnType<typeof makeNativeCaptionContextPacket>;
  stage2StyleProfile?: ReturnType<typeof normalizeStage2StyleProfile>;
  editorialMemory?: ReturnType<typeof createEmptyStage2EditorialMemorySummary>;
}) {
  const harness = createNativeCaptionPipelineHarness(input);
  const result = await harness.run();
  return { result, executor: harness.executor };
}

const DEFAULT_NATIVE_TEST_WORKER_PROFILE_ID = "stable_social_wave_v1";

function resolveNativeTestWorkerProfileId(input: {
  stage2WorkerProfileId?: string | null;
}): string | null {
  return Object.prototype.hasOwnProperty.call(input, "stage2WorkerProfileId")
    ? (input.stage2WorkerProfileId ?? null)
    : DEFAULT_NATIVE_TEST_WORKER_PROFILE_ID;
}

async function runNativeCaptionPipelineDirectFixture(input: {
  responses: unknown[];
  promptConfig?: ReturnType<typeof normalizeStage2PromptConfig>;
  hardConstraints?: Stage2HardConstraints;
  stage2WorkerProfileId?: string | null;
  templateHighlightProfile?: TemplateHighlightConfig | null;
  videoContext?: ReturnType<typeof buildVideoContext>;
  stage2StyleProfile?: ReturnType<typeof normalizeStage2StyleProfile>;
  editorialMemory?: ReturnType<typeof createEmptyStage2EditorialMemorySummary>;
}) {
  const service = new ViralShortsWorkerService();
  const executor = new QueueExecutor([...input.responses]);
  const workerProfileId = resolveNativeTestWorkerProfileId(input);
  const channel = input.stage2StyleProfile
    ? {
        ...makeNativeCaptionChannel(input.hardConstraints, workerProfileId, {
          templateHighlightProfile: input.templateHighlightProfile
        }),
        stage2StyleProfile: input.stage2StyleProfile,
        editorialMemory: input.editorialMemory
      }
    : makeNativeCaptionChannel(input.hardConstraints, workerProfileId, {
        templateHighlightProfile: input.templateHighlightProfile
      });
  const result = await service.runNativeCaptionPipeline({
    channel,
    workspaceStage2ExamplesCorpusJson: getBundledStage2ExamplesSeedJson(),
    videoContext: input.videoContext ?? makeSparseNativeVideoContext(),
    imagePaths: [],
    executor,
    promptConfig: input.promptConfig ?? normalizeStage2PromptConfig({}),
    debugMode: "summary"
  });
  return { result, executor };
}

function createNativeCaptionPipelineHarness(input: {
  responses: unknown[];
  promptConfig?: ReturnType<typeof normalizeStage2PromptConfig>;
  hardConstraints?: Stage2HardConstraints;
  stage2WorkerProfileId?: string | null;
  templateHighlightProfile?: TemplateHighlightConfig | null;
  videoContext?: ReturnType<typeof buildVideoContext>;
  contextPacket?: ReturnType<typeof makeNativeCaptionContextPacket>;
  stage2StyleProfile?: ReturnType<typeof normalizeStage2StyleProfile>;
  editorialMemory?: ReturnType<typeof createEmptyStage2EditorialMemorySummary>;
}) {
  const service = new ViralShortsWorkerService();
  const executor = new QueueExecutor([...input.responses]);
  const workerProfileId = resolveNativeTestWorkerProfileId(input);
  const channel = input.stage2StyleProfile
    ? {
        ...makeNativeCaptionChannel(input.hardConstraints, workerProfileId, {
          templateHighlightProfile: input.templateHighlightProfile
        }),
        stage2StyleProfile: input.stage2StyleProfile,
        editorialMemory: input.editorialMemory
      }
    : makeNativeCaptionChannel(input.hardConstraints, workerProfileId, {
        templateHighlightProfile: input.templateHighlightProfile
      });
  return {
    executor,
    run: () =>
      service.runNativeCaptionPipelineFromContext({
        channel,
        workspaceStage2ExamplesCorpusJson: getBundledStage2ExamplesSeedJson(),
        videoContext: input.videoContext ?? makeSparseNativeVideoContext(),
        contextPacket: input.contextPacket ?? makeNativeCaptionContextPacket(),
        executor,
        promptConfig: input.promptConfig ?? normalizeStage2PromptConfig({}),
        debugMode: "summary"
      })
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage2-runtime-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousConcurrency = process.env.STAGE2_MAX_CONCURRENT_RUNS;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.STAGE2_MAX_CONCURRENT_RUNS = "4";
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsSourceRuntimeState__?: unknown }).__clipsSourceRuntimeState__;
  delete (globalThis as { __clipsSourceJobProcessorOverride__?: unknown }).__clipsSourceJobProcessorOverride__;
  delete (globalThis as { __clipsStage2RuntimeState__?: unknown }).__clipsStage2RuntimeState__;
  delete (globalThis as { __clipsStage2RunProcessorOverride__?: unknown }).__clipsStage2RunProcessorOverride__;

  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    delete (globalThis as { __clipsSourceRuntimeState__?: unknown }).__clipsSourceRuntimeState__;
    delete (globalThis as { __clipsSourceJobProcessorOverride__?: unknown }).__clipsSourceJobProcessorOverride__;
    delete (globalThis as { __clipsStage2RuntimeState__?: unknown }).__clipsStage2RuntimeState__;
    delete (globalThis as { __clipsStage2RunProcessorOverride__?: unknown }).__clipsStage2RunProcessorOverride__;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousConcurrency === undefined) {
      delete process.env.STAGE2_MAX_CONCURRENT_RUNS;
    } else {
      process.env.STAGE2_MAX_CONCURRENT_RUNS = previousConcurrency;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await sleep(20);
  }
  throw new Error("Timed out waiting for condition.");
}

function makeRuntimeStage2Response(runId: string, label: string): Stage2Response {
  return {
    source: {
      url: "https://example.com/clip",
      title: `Clip ${label}`,
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0
    },
    output: {
      inputAnalysis: {
        visualAnchors: ["anchor"],
        commentVibe: "observational",
        keyPhraseToAdapt: label
      },
      captionOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        top: `${label} top ${index + 1}`,
        bottom: `"${label}" bottom ${index + 1}`,
        topRu: `${label} верх ${index + 1}`,
        bottomRu: `"${label}" низ ${index + 1}`
      })),
      titleOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `${label.toUpperCase()} ${index + 1}`,
        titleRu: `${label.toUpperCase()} ${index + 1}`
      })),
      finalPick: {
        option: 1,
        reason: `Final pick for ${label}`
      }
    },
    warnings: [],
    stage2Run: {
      runId,
      mode: "manual",
      createdAt: nowIso()
    },
    userInstructionUsed: label
  };
}

function makeCommentsPayload(label: string) {
  return {
    title: `${label} title`,
    totalComments: 1,
    topComments: [
      {
        id: `${label}-1`,
        author: `${label} author`,
        text: `${label} text`,
        likes: 10,
        postedAt: "2026-03-20T10:00:00.000Z"
      }
    ],
    allComments: [
      {
        id: `${label}-1`,
        author: `${label} author`,
        text: `${label} text`,
        likes: 10,
        postedAt: "2026-03-20T10:00:00.000Z"
      }
    ]
  };
}

function makeStep3RenderTemplateProps(overrides?: Partial<React.ComponentProps<typeof Step3RenderTemplate>>) {
  return {
    sourceUrl: "https://example.com/source",
    templateId: "template-road",
    channelName: "Echoes Of Honor",
    channelUsername: "EchoesOfHonor50",
    avatarUrl: null,
    previewVideoUrl: null,
    backgroundAssetUrl: null,
    backgroundAssetMimeType: null,
    backgroundOptions: [],
    musicOptions: [],
    selectedBackgroundAssetId: null,
    selectedMusicAssetId: null,
    versions: [],
    selectedVersionId: null,
    selectedPassIndex: 0,
    previewState: "idle" as const,
    previewNotice: null,
    agentPrompt: "",
    agentSession: null,
    agentMessages: [],
    agentCurrentScore: null,
    isAgentTimelineLoading: false,
    canResumeAgent: false,
    canRollbackSelectedVersion: false,
    topText: "Final top text",
    bottomText: "\"Final bottom\" with edit",
    captionSources: [
      {
        option: 1,
        top: "Option one top",
        bottom: "\"Option one bottom\"",
        highlights: { top: [], bottom: [] }
      },
      {
        option: 2,
        top: "Option two top",
        bottom: "\"Option two bottom\"",
        highlights: { top: [], bottom: [] }
      }
    ],
    selectedCaptionOption: 2,
    handoffSummary: {
      stage2Available: true,
      defaultCaptionOption: 1,
      selectedCaptionOption: 2,
      defaultTitleOption: 1,
      selectedTitleOption: 1,
      caption: {
        option: 2,
        top: "Option two top",
        bottom: "\"Option two bottom\"",
        highlights: { top: [], bottom: [] }
      },
      title: {
        option: 1,
        title: "Title one"
      },
      topText: "Final top text",
      bottomText: "\"Final bottom\" with edit",
      topTextSource: "draft_override",
      bottomTextSource: "selected_caption",
      hasManualTextOverride: true,
      canResetToSelectedCaption: true,
      latestVersionId: null,
      hasStage3Overrides: true
    },
    segments: [],
    compressionEnabled: false,
    renderState: "idle" as const,
    workerState: "not_paired" as const,
    workerLabel: null,
    workerPlatform: null,
    workerLastSeenAt: null,
    workerPairing: null,
    isWorkerPairing: false,
    showWorkerControls: false,
    isOptimizing: false,
    isUploadingBackground: false,
    isUploadingMusic: false,
    clipStartSec: 0,
    clipDurationSec: 6,
    sourceDurationSec: 15,
    focusY: 0.5,
    cameraMotion: "disabled" as const,
    cameraKeyframes: [],
    cameraPositionKeyframes: [],
    cameraScaleKeyframes: [],
    mirrorEnabled: false,
    videoZoom: 1,
    topFontScale: 1,
    bottomFontScale: 1,
    sourceAudioEnabled: true,
    musicGain: 0,
    onRender: () => undefined,
    onExport: () => undefined,
    onOptimize: () => undefined,
    onResumeAgent: () => undefined,
    onRollbackSelectedVersion: () => undefined,
    onReset: () => undefined,
    onTopTextChange: () => undefined,
    onBottomTextChange: () => undefined,
    onApplyCaptionSource: () => undefined,
    onResetCaptionText: () => undefined,
    onUploadBackground: async () => undefined,
    onUploadMusic: async () => undefined,
    onClearBackground: () => undefined,
    onClearMusic: () => undefined,
    onSelectBackgroundAssetId: () => undefined,
    onSelectMusicAssetId: () => undefined,
    onSelectVersionId: () => undefined,
    onSelectPassIndex: () => undefined,
    onAgentPromptChange: () => undefined,
    onFragmentStateChange: () => undefined,
    onClipStartChange: () => undefined,
    onFocusYChange: () => undefined,
    onCameraPositionKeyframesChange: () => undefined,
    onCameraScaleKeyframesChange: () => undefined,
    onMirrorEnabledChange: () => undefined,
    onVideoZoomChange: () => undefined,
    onTopFontScaleChange: () => undefined,
    onBottomFontScaleChange: () => undefined,
    onSourceAudioEnabledChange: () => undefined,
    onMusicGainChange: () => undefined,
    onCreateWorkerPairing: () => undefined,
    ...overrides
  } satisfies React.ComponentProps<typeof Step3RenderTemplate>;
}

function makeSourceJobResult(input: {
  chatId: string;
  channelId: string;
  sourceUrl: string;
  label: string;
  commentsAvailable?: boolean;
}): SourceJobResult {
  const commentsAvailable = input.commentsAvailable ?? true;
  return {
    chatId: input.chatId,
    channelId: input.channelId,
    sourceUrl: input.sourceUrl,
    stage1Ready: true,
    title: input.label,
    commentsAvailable,
    commentsError: commentsAvailable ? null : "comments unavailable",
    commentsPayload: commentsAvailable
      ? {
          title: input.label,
          totalComments: 3,
          topComments: [],
          allComments: []
        }
      : null,
    autoStage2RunId: null
  };
}

function makeBaseChannels() {
  const alphaExamples = [
    makeExample({
      id: "alpha_1",
      ownerChannelId: "alpha",
      ownerChannelName: "Alpha Channel",
      title: "Truck axle snaps in the mud"
    }),
    makeExample({
      id: "alpha_2",
      ownerChannelId: "alpha",
      ownerChannelName: "Alpha Channel",
      title: "Driver keeps rolling after the first wobble"
    })
  ];
  const betaExamples = [
    makeExample({
      id: "beta_1",
      ownerChannelId: "beta",
      ownerChannelName: "Beta Channel",
      title: "Crowd reacts when the wheel folds"
    }),
    makeExample({
      id: "beta_2",
      ownerChannelId: "beta",
      ownerChannelName: "Beta Channel",
      title: "Mechanic points at the exact failure"
    })
  ];
  const targetExamples = [
    makeExample({
      id: "target_1",
      ownerChannelId: "target",
      ownerChannelName: "Target Channel",
      title: "Old pickup bounces into a deep rut"
    })
  ];

  return {
    alphaExamples,
    betaExamples,
    targetExamples,
    workspaceExamples: [...alphaExamples, ...betaExamples, ...targetExamples],
    workspaceExamplesJson: toExamplesJson([...alphaExamples, ...betaExamples, ...targetExamples]),
    allChannels: [
      {
        id: "alpha",
        name: "Alpha Channel",
        examplesJson: toExamplesJson(alphaExamples),
        stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
      },
      {
        id: "beta",
        name: "Beta Channel",
        examplesJson: toExamplesJson(betaExamples),
        stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
      },
      {
        id: "target",
        name: "Target Channel",
        examplesJson: toExamplesJson(targetExamples),
        stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
      }
    ]
  };
}

function makeChannelForManager(input: { id: string; name: string; username: string }): Channel {
  return {
    id: input.id,
    workspaceId: "workspace_1",
    creatorUserId: "user_1",
    name: input.name,
    username: input.username,
    systemPrompt: "",
    descriptionPrompt: "",
    examplesJson: "[]",
    stage2WorkerProfileId: null,
    stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
    stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
    stage2PromptConfig: normalizeStage2PromptConfig({}),
    templateId: "turbo-face",
    avatarAssetId: null,
    defaultBackgroundAssetId: null,
    defaultMusicAssetId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    currentUserCanOperate: true,
    currentUserCanEditSetup: true,
    currentUserCanManageAccess: true,
    currentUserCanDelete: true,
    isVisibleToCurrentUser: true
  };
}

async function runSuccessfulPipeline(options?: {
  promptConfig?: ReturnType<typeof normalizeStage2PromptConfig>;
  stage2ExamplesConfig?: Stage2ExamplesConfig;
  workspaceStage2ExamplesCorpusJson?: string;
  stage2HardConstraints?: Stage2HardConstraints;
  stage2VNextEnabled?: boolean;
  analyzerResponse?: Record<string, unknown>;
  selectedExampleIds?: string[];
  userInstruction?: string | null;
  providerWrappedStageOutputs?: boolean;
  finalSelectorRationale?: string;
  selectorResponse?: Record<string, unknown>;
  criticResponse?: unknown;
  writerCandidates?: Array<Record<string, unknown>>;
  recoveryWriterCandidates?: Array<Record<string, unknown>>;
  recoveryCriticResponse?: unknown;
  rewrittenCandidates?: Array<Record<string, unknown>>;
  rewriterResponse?: unknown;
  finalSelectorResponse?: Record<string, unknown>;
  titleResponse?: unknown;
  comments?: Array<{ author: string; likes: number; text: string }>;
  videoContextOverrides?: Partial<Parameters<typeof buildVideoContext>[0]>;
  debugMode?: "summary" | "raw";
}) {
  const service = new ViralShortsWorkerService();
  const promptConfig = options?.promptConfig ?? normalizeStage2PromptConfig({});
  const {
    allChannels,
    alphaExamples,
    betaExamples,
    targetExamples,
    workspaceExamplesJson
  } = makeBaseChannels();
  const stage2ExamplesConfig =
    options?.stage2ExamplesConfig ??
    {
      version: 1,
      useWorkspaceDefault: false,
      customExamples: [...alphaExamples, ...betaExamples, ...targetExamples]
    };
  const stage2HardConstraints = options?.stage2HardConstraints ?? DEFAULT_STAGE2_HARD_CONSTRAINTS;
  const channel = {
    id: "target",
    name: "Target Channel",
    username: "target_channel",
    stage2ExamplesConfig,
    stage2HardConstraints
  };
  const resolved = service.resolveExamplesCorpus({
    channel: {
      id: channel.id,
      name: channel.name,
      stage2ExamplesConfig
    },
    workspaceStage2ExamplesCorpusJson:
      options?.workspaceStage2ExamplesCorpusJson ?? workspaceExamplesJson
  });
  const selectedExampleIds =
    options?.selectedExampleIds ?? resolved.corpus.slice(0, Math.min(3, resolved.corpus.length)).map((item) => item.id);
  const rankedAngles = [
    { angle: "payoff_reveal", score: 9.4, why: "Visible mechanical payoff is immediate." },
    { angle: "shared_experience", score: 8.7, why: "Audience reaction makes the failure land." },
    { angle: "competence_process", score: 7.9, why: "There is enough detail to narrate the sequence." }
  ];
  const writerCandidates = Array.from({ length: 8 }, (_, index) =>
    makeCandidate(`cand_${index + 1}`, rankedAngles[index % rankedAngles.length]!.angle, index + 1)
  );
  const activeWriterCandidates = options?.writerCandidates ?? writerCandidates;
  const rewrittenCandidates = activeWriterCandidates.map((candidate, index) => ({
    ...candidate,
    top: `The frame catches the axle twisting harder ${index + 1}`,
    rationale: `Rewrite ${index + 1} sharpened the visual hook.`
  }));
  const activeRewrittenCandidates = options?.rewrittenCandidates ?? rewrittenCandidates;
  const defaultCriticResponse = options?.providerWrappedStageOutputs
    ? {
        scores: activeWriterCandidates.map((candidate, index) => ({
          candidate_id: candidate.candidate_id,
          scores: makeCriticScoreMap(index),
          total: 9 - index * 0.2,
          issues: [],
          keep: true
        }))
      }
    : activeWriterCandidates.map((candidate, index) => ({
        candidate_id: candidate.candidate_id,
        scores: makeCriticScoreMap(index),
        total: 9 - index * 0.2,
        issues: [],
        keep: true
      }));
  const defaultRewriterResponse = options?.providerWrappedStageOutputs
    ? { candidates: activeRewrittenCandidates }
    : activeRewrittenCandidates;
  const queuedResponses: unknown[] = [
    {
      visual_anchors: ["axle swings sideways", "mud kicks up", "driver leans forward"],
      specific_nouns: ["pickup", "axle", "rut", "wheel"],
      visible_actions: ["bucks through the rut", "axle twists sideways", "mud kicks up"],
      subject: "old pickup",
      setting: "muddy field",
      first_seconds_signal: "The truck lunges into the rut and the axle already looks wrong.",
      scene_beats: [
        "opening setup with the pickup entering the muddy rut",
        "the axle starts leaning while mud kicks up",
        "the wheel nearly folds once the truck stays under load"
      ],
      reveal_moment: "the wheel almost folds once the axle gives way under load",
      late_clip_change: "the failure becomes obvious only later when the wheel collapses sideways",
      stakes: ["the truck may break completely", "everyone sees it happen"],
      payoff: "the wheel almost folds under the truck",
      core_trigger: "the axle visibly gives way while the truck is still under load",
      human_stake: "everyone watching knows the driver is about to pay for one more push",
      narrative_frame: "a real mechanical failure that feels inevitable once you notice it",
      why_viewer_cares: "the clip turns a common bad decision into an immediate visible payoff",
      best_bottom_energy: "dry humor",
      comment_vibe: "dry reaction",
      slang_to_adapt: ["cooked"],
      hidden_detail: "Several viewers noticed the axle was already bent before the last push.",
      generic_risks: ["calling it just a tool failure", "describing it as vague chaos"],
      uncertainty_notes: [],
      raw_summary: "An old pickup bucks through a muddy rut until the axle twists sideways.",
      ...options?.analyzerResponse
    },
    {
      clip_type: "mechanical_failure",
      primary_angle: "payoff_reveal",
      secondary_angles: ["shared_experience", "competence_process"],
      selected_example_ids: selectedExampleIds,
      rejected_example_ids: ["beta_2"],
      selection_rationale: "These examples match the visible failure and the grounded crowd reaction.",
      writer_brief: "Lead with the axle twisting sideways, then land the crowd reaction in plain language.",
      confidence: 0.86,
      ...options?.selectorResponse
    },
    options?.providerWrappedStageOutputs ? { candidates: activeWriterCandidates } : activeWriterCandidates,
    options?.criticResponse ?? defaultCriticResponse
  ];
  if (options?.recoveryWriterCandidates) {
    queuedResponses.push(
      options.providerWrappedStageOutputs
        ? { candidates: options.recoveryWriterCandidates }
        : options.recoveryWriterCandidates
    );
    queuedResponses.push(options.recoveryCriticResponse ?? defaultCriticResponse);
  }
  queuedResponses.push(
    options?.rewriterResponse ?? defaultRewriterResponse,
    {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_2",
      rationale: options?.finalSelectorRationale ?? "Candidate 2 has the cleanest hook-to-quote transition.",
      ...options?.finalSelectorResponse
    },
    options?.providerWrappedStageOutputs
      ? (options?.titleResponse ?? {
          titleOptions: Array.from({ length: 5 }, (_, index) => ({
            title_id: `title_${index + 1}`,
            title: `HOW AXLE FAILS ${index + 1}`,
            title_ru: `КАК ЛОМАЕТСЯ МОСТ ${index + 1}`,
            rationale: `Title ${index + 1} leans into the failure mystery.`
          }))
        })
      : (options?.titleResponse ?? Array.from({ length: 5 }, (_, index) => ({
          title_id: `title_${index + 1}`,
          title: `HOW AXLE FAILS ${index + 1}`,
          title_ru: `КАК ЛОМАЕТСЯ МОСТ ${index + 1}`,
          rationale: `Title ${index + 1} leans into the failure mystery.`
        })))
  );
  const executor = new QueueExecutor(queuedResponses);
  const progressEvents: Array<{ stageId: string; state: string; detail: string | null | undefined }> = [];
  const videoContext = buildVideoContext({
    sourceUrl: options?.videoContextOverrides?.sourceUrl ?? "https://example.com/short",
    title: options?.videoContextOverrides?.title ?? "Old pickup bucks through a muddy rut",
    description:
      options?.videoContextOverrides?.description ??
      "The axle starts twisting while the crowd sees the truck sink sideways.",
    transcript:
      options?.videoContextOverrides?.transcript ??
      "The driver tries one more time and the wheel almost folds under him.",
    comments:
      options?.comments ??
      options?.videoContextOverrides?.comments ??
      [
        {
          author: "user1",
          likes: 12,
          text: "That axle was cooked before he even hit the rut."
        }
      ],
    frameDescriptions:
      options?.videoContextOverrides?.frameDescriptions ??
      ["mud splashes around the tire", "axle leans hard to the left"],
    userInstruction:
      options?.videoContextOverrides?.userInstruction ??
      options?.userInstruction ??
      "Keep it grounded and avoid slang overload."
  });

  const result = await service.runPipeline({
    channel,
    workspaceStage2ExamplesCorpusJson:
      options?.workspaceStage2ExamplesCorpusJson ?? workspaceExamplesJson,
    videoContext,
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    promptConfig,
    debugMode: options?.debugMode,
    stage2VNextEnabled: options?.stage2VNextEnabled,
    onProgress: async (event) => {
      progressEvents.push({
        stageId: event.stageId,
        state: event.state,
        detail: event.detail ?? null
      });
    }
  });

  return {
    service,
    promptConfig,
    channel,
    allChannels,
    videoContext,
    executor,
    progressEvents,
    result
  };
}

function assertFinalShortlistContract(result: { output: Stage2Response["output"] }): void {
  const visibleIds = result.output.captionOptions.map((option) => option.candidateId ?? "");
  const finalSelector = result.output.pipeline?.finalSelector;
  assert.equal(visibleIds.length, 5);
  assert.ok(finalSelector);
  assert.equal(finalSelector?.candidateOptionMap.length, 5);
  assert.equal(finalSelector?.shortlistCandidateIds.length, 5);
  assert.deepEqual(
    finalSelector?.candidateOptionMap.map((entry) => entry.candidateId),
    visibleIds
  );
  assert.deepEqual(finalSelector?.shortlistCandidateIds, visibleIds);
  assert.ok(finalSelector?.finalPickCandidateId);
  assert.ok(visibleIds.includes(finalSelector?.finalPickCandidateId ?? ""));
}

function assertSchemaRequiredMatchesProperties(schema: unknown): void {
  if (!schema || typeof schema !== "object") {
    return;
  }
  if (Array.isArray(schema)) {
    for (const item of schema) {
      assertSchemaRequiredMatchesProperties(item);
    }
    return;
  }

  const record = schema as Record<string, unknown>;
  const properties =
    record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
      ? (record.properties as Record<string, unknown>)
      : null;
  const required = Array.isArray(record.required)
    ? record.required.map((value) => String(value))
    : null;

  if (properties && required) {
    const propertyKeys = new Set(Object.keys(properties));
    for (const key of required) {
      assert.ok(
        propertyKeys.has(key),
        `Required key ${key} is missing from properties at schema fragment ${JSON.stringify(record)}`
      );
    }
  }

  if ("items" in record) {
    assertSchemaRequiredMatchesProperties(record.items);
  }
  if (properties) {
    for (const value of Object.values(properties)) {
      assertSchemaRequiredMatchesProperties(value);
    }
  }
  if (
    record.additionalProperties &&
    typeof record.additionalProperties === "object" &&
    !Array.isArray(record.additionalProperties)
  ) {
    assertSchemaRequiredMatchesProperties(record.additionalProperties);
  }
}

test("workspace default corpus uses the workspace corpus instead of per-channel legacy examplesJson", () => {
  const { workspaceExamples, workspaceExamplesJson } = makeBaseChannels();
  const resolved = resolveStage2ExamplesCorpus({
    channel: {
      id: "target",
      name: "Target Channel",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
    },
    workspaceStage2ExamplesCorpusJson: workspaceExamplesJson
  });

  assert.equal(resolved.source, "workspace_default");
  assert.equal(resolved.workspaceCorpusCount, workspaceExamples.length);
  assert.equal(resolved.corpus.length, workspaceExamples.length);
  assert.deepEqual(
    resolved.corpus.slice(0, 3).map((example) => example.title),
    workspaceExamples.slice(0, 3).map((example: Stage2CorpusExample) => example.title)
  );
});

test("channel custom corpus replaces the workspace default corpus for the channel", () => {
  const { workspaceExamplesJson, workspaceExamples } = makeBaseChannels();
  const customExamples = [
    makeExample({
      id: "manual_1",
      ownerChannelId: "target",
      ownerChannelName: "Target Channel",
      title: "Only this curated example should be used"
    })
  ];
  const resolved = resolveStage2ExamplesCorpus({
    channel: {
      id: "target",
      name: "Target Channel",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: false,
        customExamples
      }
    },
    workspaceStage2ExamplesCorpusJson: workspaceExamplesJson
  });

  assert.equal(resolved.source, "channel_custom");
  assert.equal(resolved.workspaceCorpusCount, workspaceExamples.length);
  assert.deepEqual(
    resolved.corpus.map((example) => example.id),
    ["manual_1"]
  );
});

test("new channels no longer auto-populate a viral worker profile", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Simplified",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    assert.equal(owner.workspace.stage2ExamplesCorpusJson, getBundledStage2ExamplesSeedJson());

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Fresh Channel",
      username: "fresh_channel"
    });

    assert.equal(channel.stage2WorkerProfileId, null);
    assert.equal(channel.stage2ExamplesConfig.useWorkspaceDefault, true);
    assert.equal(channel.systemPrompt, "");
    assert.equal(channel.descriptionPrompt, "");
  });
});

test("channels persist an explicit Stage 2 platform line when one is chosen", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Platform Line",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "LaunchMind",
      username: "launchmind",
      stage2WorkerProfileId: "stable_skill_gap_v1"
    });
    assert.equal(channel.stage2WorkerProfileId, "stable_skill_gap_v1");

    const updated = await chatHistory.updateChannelById(channel.id, {
      stage2WorkerProfileId: "stable_social_wave_v1"
    });
    assert.equal(updated.stage2WorkerProfileId, "stable_social_wave_v1");

    const reloaded = await chatHistory.getChannelById(channel.id);
    assert.equal(reloaded?.stage2WorkerProfileId, "stable_social_wave_v1");
  });
});

test("existing workspace access seeds the workspace default corpus from bundled examples", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { getDb, newId, nowIso } = await import("../lib/db/client");
    const teamStore = await import("../lib/team-store");
    const db = getDb();
    const stamp = nowIso();
    const workspaceId = newId();

    db.prepare(
      "INSERT INTO workspaces (id, name, slug, stage2_examples_corpus_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(workspaceId, "Legacy Workspace", "legacy-workspace", "", stamp, stamp);

    const corpusJson = teamStore.getWorkspaceStage2ExamplesCorpusJson(workspaceId);
    assert.equal(corpusJson, getBundledStage2ExamplesSeedJson());
  });
});

test("workspace corpus update becomes the effective default corpus for Stage 2 runtime", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Workspace Corpus Update",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const customWorkspaceExamples = [
      makeExample({
        id: "workspace_custom_1",
        ownerChannelId: "workspace-default",
        ownerChannelName: "Workspace default",
        title: "Workspace-level corpus example"
      })
    ];

    teamStore.updateWorkspaceStage2ExamplesCorpusJson(
      owner.workspace.id,
      JSON.stringify(customWorkspaceExamples, null, 2)
    );

    const service = new ViralShortsWorkerService();
    const resolved = service.resolveExamplesCorpus({
      channel: {
        id: "target",
        name: "Target Channel",
        stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
      },
      workspaceStage2ExamplesCorpusJson:
        teamStore.getWorkspaceStage2ExamplesCorpusJson(owner.workspace.id)
    });

    assert.equal(resolved.source, "workspace_default");
    assert.deepEqual(resolved.corpus.map((example) => example.id), ["workspace_custom_1"]);
  });
});

test("workspace prompt defaults persist as the new default source for stage prompt + thinking", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Workspace Prompt Defaults",
      email: "owner-prompts@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const workspacePromptConfig = normalizeStage2PromptConfig({
      stages: {
        selector: {
          prompt: "Workspace selector default prompt.",
          reasoningEffort: "x-high"
        },
        writer: {
          prompt: "Workspace writer default prompt.",
          reasoningEffort: "medium"
        }
      }
    });

    teamStore.updateWorkspaceStage2PromptConfig(owner.workspace.id, workspacePromptConfig);

    const saved = teamStore.getWorkspaceStage2PromptConfig(owner.workspace.id);
    const selectorResolved = resolveStage2PromptTemplate("selector", saved);
    const writerResolved = resolveStage2PromptTemplate("writer", saved);

    assert.equal(saved.stages.selector.prompt, "Workspace selector default prompt.");
    assert.equal(saved.stages.selector.reasoningEffort, "x-high");
    assert.equal(selectorResolved.configuredPrompt, "Workspace selector default prompt.");
    assert.equal(selectorResolved.reasoningEffort, "x-high");
    assert.equal(writerResolved.configuredPrompt, "Workspace writer default prompt.");
    assert.equal(writerResolved.reasoningEffort, "medium");
  });
});

test("workspace reset helper clears incompatible native prompt overrides without touching legacy stages", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const { getDb } = await import("../lib/db/client");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Workspace Native Reset",
      email: "owner-native-reset@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const legacyStoredConfig = JSON.stringify(
      {
        version: 3,
        stages: {
          writer: {
            prompt: "Legacy writer prompt survives for the legacy chain.",
            reasoningEffort: "medium"
          },
          candidateGenerator: {
            prompt: "Write 20 candidates with top_ru and bottom_ru.",
            reasoningEffort: "x-high"
          }
        }
      },
      null,
      2
    );
    getDb()
      .prepare("UPDATE workspaces SET stage2_prompt_config_json = ? WHERE id = ?")
      .run(legacyStoredConfig, owner.workspace.id);

    const beforeReset = teamStore.getWorkspaceStage2PromptConfig(owner.workspace.id);
    const staleResolved = resolveStage2PromptTemplate("candidateGenerator", beforeReset);
    const legacyResolved = resolveStage2PromptTemplate("writer", beforeReset);
    assert.equal(staleResolved.overrideAccepted, false);
    assert.equal(staleResolved.promptSource, "default");
    assert.equal(legacyResolved.promptSource, "workspace_override");

    const reset = teamStore.resetWorkspaceIncompatibleNativePromptOverrides(owner.workspace.id);
    assert.deepEqual(reset.removedStageIds, ["candidateGenerator"]);

    const afterReset = teamStore.getWorkspaceStage2PromptConfig(owner.workspace.id);
    const afterCandidateResolved = resolveStage2PromptTemplate("candidateGenerator", afterReset);
    const afterLegacyResolved = resolveStage2PromptTemplate("writer", afterReset);
    assert.equal(afterCandidateResolved.overrideCandidatePresent, false);
    assert.equal(afterCandidateResolved.promptSource, "default");
    assert.equal(afterLegacyResolved.promptSource, "workspace_override");
    assert.match(afterLegacyResolved.configuredPrompt, /Legacy writer prompt survives/i);
  });
});

test("codex runner normalizes stage reasoning effort aliases to CLI-supported values", () => {
  assert.equal(normalizeCodexReasoningEffort("x-high"), "xhigh");
  assert.equal(normalizeCodexReasoningEffort("extra-high"), "xhigh");
  assert.equal(normalizeCodexReasoningEffort("high"), "high");
  assert.equal(normalizeCodexReasoningEffort("  medium  "), "medium");
  assert.equal(normalizeCodexReasoningEffort(""), null);
  assert.equal(normalizeCodexReasoningEffort(null), null);
});

test("workspace hard constraints persist as owner defaults", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Workspace Hard Constraints",
      email: "owner-hard@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const updatedConstraints: Stage2HardConstraints = {
      topLengthMin: 24,
      topLengthMax: 72,
      bottomLengthMin: 30,
      bottomLengthMax: 96,
      bannedWords: ["literally"],
      bannedOpeners: ["Here is a"]
    };

    teamStore.updateWorkspaceStage2HardConstraints(owner.workspace.id, updatedConstraints);

    const saved = teamStore.getWorkspaceStage2HardConstraints(owner.workspace.id);
    assert.deepEqual(saved, updatedConstraints);
  });
});

test("stage 2 hard constraint list parsing accepts comma, semicolon, and newline separators", () => {
  assert.deepEqual(parseStage2DelimitedStringList("alpha, beta;\ngamma\r\ndelta, alpha"), [
    "alpha",
    "beta",
    "gamma",
    "delta"
  ]);
  assert.deepEqual(
    normalizeStage2HardConstraints({
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      bannedWords: "literal, generic\nsafe",
      bannedOpeners: "Here is a; This is"
    }),
    {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      bannedWords: ["literal", "generic", "safe"],
      bannedOpeners: ["Here is a", "This is"]
    }
  );
  assert.equal(formatStage2DelimitedStringList(["alpha", "beta", "alpha"]), "alpha, beta");
});

test("channel hard constraints persist separately from workspace defaults", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Channel Hard Constraints",
      email: "owner-channel-hard@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const workspaceConstraints: Stage2HardConstraints = {
      topLengthMin: 24,
      topLengthMax: 72,
      bottomLengthMin: 30,
      bottomLengthMax: 96,
      bannedWords: ["literally"],
      bannedOpeners: ["Here is a"]
    };
    teamStore.updateWorkspaceStage2HardConstraints(owner.workspace.id, workspaceConstraints);

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Per Channel Constraints",
      username: "per_channel_constraints"
    });
    assert.deepEqual(channel.stage2HardConstraints, workspaceConstraints);

    const channelConstraints: Stage2HardConstraints = {
      topLengthMin: 135,
      topLengthMax: 180,
      bottomLengthMin: 92,
      bottomLengthMax: 145,
      bannedWords: [],
      bannedOpeners: []
    };

    const updated = await chatHistory.updateChannelById(channel.id, {
      stage2HardConstraints: channelConstraints
    });
    const reloaded = await chatHistory.getChannelById(channel.id);

    assert.deepEqual(updated.stage2HardConstraints, channelConstraints);
    assert.deepEqual(reloaded?.stage2HardConstraints, channelConstraints);
    assert.deepEqual(teamStore.getWorkspaceStage2HardConstraints(owner.workspace.id), workspaceConstraints);

    const nextWorkspaceConstraints: Stage2HardConstraints = {
      topLengthMin: 40,
      topLengthMax: 66,
      bottomLengthMin: 44,
      bottomLengthMax: 88,
      bannedWords: ["generic"],
      bannedOpeners: ["When you"]
    };
    teamStore.updateWorkspaceStage2HardConstraints(owner.workspace.id, nextWorkspaceConstraints);

    const afterWorkspaceChange = await chatHistory.getChannelById(channel.id);
    assert.deepEqual(afterWorkspaceChange?.stage2HardConstraints, channelConstraints);
    assert.deepEqual(
      teamStore.getWorkspaceStage2HardConstraints(owner.workspace.id),
      nextWorkspaceConstraints
    );
  });
});

test("channel creation honors explicit hard constraints instead of workspace snapshot", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Explicit Channel Constraints",
      email: "owner-explicit-channel@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const workspaceConstraints: Stage2HardConstraints = {
      topLengthMin: 24,
      topLengthMax: 72,
      bottomLengthMin: 30,
      bottomLengthMax: 96,
      bannedWords: ["literally"],
      bannedOpeners: ["Here is a"]
    };
    const explicitConstraints: Stage2HardConstraints = {
      topLengthMin: 90,
      topLengthMax: 126,
      bottomLengthMin: 70,
      bottomLengthMax: 115,
      bannedWords: ["average"],
      bannedOpeners: ["This is"]
    };
    teamStore.updateWorkspaceStage2HardConstraints(owner.workspace.id, workspaceConstraints);

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Explicit Constraints Channel",
      username: "explicit_constraints_channel",
      stage2HardConstraints: explicitConstraints
    });

    assert.deepEqual(channel.stage2HardConstraints, explicitConstraints);
    assert.deepEqual(teamStore.getWorkspaceStage2HardConstraints(owner.workspace.id), workspaceConstraints);
  });
});

test("stage 2 launch request snapshots effective channel hard constraints for manual and auto modes", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Launch Snapshot",
      email: "owner-stage2-launch@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const workspaceConstraints: Stage2HardConstraints = {
      topLengthMin: 24,
      topLengthMax: 72,
      bottomLengthMin: 30,
      bottomLengthMax: 96,
      bannedWords: ["workspace"],
      bannedOpeners: ["Workspace"]
    };
    const channelConstraints: Stage2HardConstraints = {
      topLengthMin: 132,
      topLengthMax: 176,
      bottomLengthMin: 84,
      bottomLengthMax: 136,
      bannedWords: ["channel"],
      bannedOpeners: ["Channel"]
    };
    teamStore.updateWorkspaceStage2HardConstraints(owner.workspace.id, workspaceConstraints);

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Launch Snapshot Channel",
      username: "launch_snapshot_channel"
    });
    await chatHistory.updateChannelById(channel.id, {
      stage2HardConstraints: channelConstraints
    });
    const reloaded = await chatHistory.getChannelById(channel.id);
    assert.ok(reloaded);

    const manualRequest = buildStage2RunRequestSnapshot({
      sourceUrl: "https://www.youtube.com/shorts/manual-snapshot",
      userInstruction: "make it sharper",
      mode: "manual",
      channel: reloaded
    });
    const autoRequest = buildStage2RunRequestSnapshot({
      sourceUrl: "https://www.youtube.com/shorts/auto-snapshot",
      userInstruction: null,
      mode: "auto",
      channel: reloaded
    });

    assert.deepEqual(manualRequest.channel.stage2HardConstraints, channelConstraints);
    assert.deepEqual(autoRequest.channel.stage2HardConstraints, channelConstraints);
    assert.notDeepEqual(manualRequest.channel.stage2HardConstraints, workspaceConstraints);
    assert.notDeepEqual(autoRequest.channel.stage2HardConstraints, workspaceConstraints);
  });
});

test("channel Stage 2 tab exposes editable hard constraints including banned words and openers", () => {
  const element = ChannelManagerStage2Tab({
    isWorkspaceDefaultsSelection: false,
    workspaceExamplesCount: 12,
    workspaceExamplesJson: "[]",
    workspaceExamplesError: null,
    stage2HardConstraints: {
      topLengthMin: 135,
      topLengthMax: 180,
      bottomLengthMin: 92,
      bottomLengthMax: 145,
      bannedWords: ["literal", "generic"],
      bannedOpeners: ["Here is a", "This is"]
    },
    bannedWordsInput: "literal, generic,",
    bannedOpenersInput: "Here is a\nThis is",
    workspaceStage2PromptConfig: DEFAULT_STAGE2_PROMPT_CONFIG,
    stage2PromptStages: [],
    autosaveState: {
      brand: { status: "idle", message: null },
      stage2: { status: "idle", message: null },
      stage2Defaults: { status: "idle", message: null },
      render: { status: "idle", message: null }
    },
    canEditWorkspaceDefaults: false,
    canEditHardConstraints: true,
    canEditChannelExamples: true,
    stage2WorkerProfileId: "stable_reference_v6",
    canEditStage2WorkerProfile: true,
    updateStage2WorkerProfileId: () => undefined,
    activeExamplesPreview: {
      source: "channel_custom",
      corpus: [],
      workspaceCorpusCount: 12
    },
    channelStyleProfile: null,
    channelStyleProfileDraft: null,
    channelStyleProfileStatus: "missing",
    channelStyleProfileDirty: false,
    channelStyleProfileFeedbackHistory: [],
    channelStyleProfileFeedbackHistoryLoading: false,
    channelEditorialMemory: null,
    canEditChannelStyleProfile: false,
    channelStyleProfileDiscovering: false,
    channelStyleProfileDiscoveryError: null,
    channelStyleProfileSaveState: { status: "idle", message: null },
    updateChannelStyleProfileReferenceLinks: () => undefined,
    updateChannelStyleProfileExplorationShare: () => undefined,
    toggleChannelStyleProfileDirectionSelection: () => undefined,
    selectAllChannelStyleProfileDirections: () => undefined,
    clearChannelStyleProfileDirectionSelection: () => undefined,
    startChannelStyleProfileDiscovery: async () => undefined,
    saveChannelStyleProfileDraft: async () => undefined,
    discardChannelStyleProfileDraft: () => undefined,
    customExamplesJson: "[]",
    customExamplesError: null,
    updateWorkspaceExamplesJson: () => undefined,
    updateCustomExamplesJson: () => undefined,
    updateStage2HardConstraint: () => undefined,
    updateBannedWordsInput: () => undefined,
    updateBannedOpenersInput: () => undefined,
    updateStage2PromptTemplate: () => undefined,
    updateStage2PromptReasoning: () => undefined,
    resetStage2PromptStage: () => undefined
  });
  const markup = renderToStaticMarkup(element);

  assert.match(markup, /TOP мин\./);
  assert.match(markup, /TOP макс\./);
  assert.match(markup, /BOTTOM мин\./);
  assert.match(markup, /BOTTOM макс\./);
  assert.match(markup, /Формат pipeline/);
  assert.match(markup, /Stable Reference v6/);
  assert.match(markup, /Запрещённые слова/);
  assert.match(markup, /Запрещённые начала/);
  assert.match(markup, /type="number"/);
  assert.match(markup, /value="135"/);
  assert.match(markup, /value="180"/);
  assert.match(markup, /value="92"/);
  assert.match(markup, /value="145"/);
  assert.match(markup, /literal, generic,/);
  assert.match(markup, /Here is a\nThis is/);
  assert.doesNotMatch(markup, /disabled=""/);
});

test("channel manager save notices classify Stage 2 and style-profile saves with visible copy", () => {
  assert.deepEqual(
    describeChannelManagerSavePatch({
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: true,
        customExamples: []
      }
    }),
    {
      saving: "Сохраняем настройки Stage 2…",
      saved: "Настройки Stage 2 сохранены.",
      error: "Не удалось сохранить настройки Stage 2."
    }
  );

  assert.deepEqual(
    describeChannelManagerSavePatch({
      stage2WorkerProfileId: "stable_social_wave_v1"
    }),
    {
      saving: "Сохраняем формат pipeline…",
      saved: "Формат pipeline сохранён.",
      error: "Не удалось сохранить формат pipeline."
    }
  );

  assert.deepEqual(
    describeChannelManagerSavePatch({
      stage2StyleProfile: normalizeStage2StyleProfile(null)
    }),
    {
      saving: "Сохраняем стиль канала…",
      saved: "Стиль канала сохранён.",
      error: "Не удалось сохранить стиль канала."
    }
  );
});

test("channel Stage 2 tab exposes post-onboarding style profile editing and feedback history", () => {
  const styleProfile = {
    version: 1 as const,
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-03-21T10:00:00.000Z",
    onboardingCompletedAt: "2026-03-21T10:00:00.000Z",
    discoveryPromptVersion: "test",
    referenceInfluenceSummary: "Референсы сужают пространство, но редактор выбирает финальную смесь.",
    audiencePortrait: null,
    packagingPortrait: null,
    bootstrapDiagnostics: null,
    explorationShare: 0.25,
    referenceLinks: [
      {
        id: "reference_1",
        url: "https://www.youtube.com/shorts/ref-1",
        normalizedUrl: "https://www.youtube.com/shorts/ref-1",
        title: "Reference 1",
        description: "Description 1",
        transcriptExcerpt: "Transcript 1",
        commentHighlights: ["Comment 1"],
        totalCommentCount: 12,
        selectedCommentCount: 4,
        audienceSignalSummary: "Аудитория быстро считывает момент и уходит в мемный пересказ.",
        frameMoments: [
          "setup frame: early setup beat at 0.90s of 6.00s",
          "turn frame: middle turn beat at 3.00s of 6.00s",
          "payoff frame: late payoff beat at 5.16s of 6.00s"
        ],
        framesUsed: true,
        sourceHint: "YouTube"
      }
    ],
    candidateDirections: [
      {
        id: "direction_1",
        fitBand: "core" as const,
        name: "Direction 1",
        description: "Description 1",
        voice: "Voice 1",
        topPattern: "Top 1",
        bottomPattern: "Bottom 1",
        humorLevel: "medium" as const,
        sarcasmLevel: "low" as const,
        warmthLevel: "medium" as const,
        insiderDensityLevel: "medium" as const,
        bestFor: "Best for 1",
        avoids: "Avoid 1",
        microExample: "Example 1",
        sourceReferenceIds: ["reference_1"],
        internalPromptNotes: "Note 1",
        axes: {
          humor: 0.5,
          sarcasm: 0.3,
          warmth: 0.5,
          insiderDensity: 0.4,
          intensity: 0.5,
          explanationDensity: 0.4,
          quoteDensity: 0.2,
          topCompression: 0.7
        }
      }
    ],
    selectedDirectionIds: ["direction_1"]
  };

  const element = ChannelManagerStage2Tab({
    isWorkspaceDefaultsSelection: false,
    workspaceExamplesCount: 12,
    workspaceExamplesJson: "[]",
    workspaceExamplesError: null,
    stage2HardConstraints: {
      topLengthMin: 135,
      topLengthMax: 180,
      bottomLengthMin: 92,
      bottomLengthMax: 145,
      bannedWords: [],
      bannedOpeners: []
    },
    bannedWordsInput: "",
    bannedOpenersInput: "",
    workspaceStage2PromptConfig: DEFAULT_STAGE2_PROMPT_CONFIG,
    stage2PromptStages: [],
    autosaveState: {
      brand: { status: "idle", message: null },
      stage2: { status: "idle", message: null },
      stage2Defaults: { status: "idle", message: null },
      render: { status: "idle", message: null }
    },
    canEditWorkspaceDefaults: false,
    canEditHardConstraints: true,
    canEditChannelExamples: true,
    stage2WorkerProfileId: "stable_social_wave_v1",
    canEditStage2WorkerProfile: true,
    updateStage2WorkerProfileId: () => undefined,
    activeExamplesPreview: {
      source: "channel_custom",
      corpus: [],
      workspaceCorpusCount: 12
    },
    channelStyleProfile: styleProfile,
    channelStyleProfileDraft: {
      referenceLinksText: "https://www.youtube.com/shorts/ref-1",
      styleProfile,
      selectedStyleDirectionIds: ["direction_1"],
      explorationShare: 0.3
    },
    channelStyleProfileStatus: "fresh",
    channelStyleProfileDirty: true,
    channelStyleProfileFeedbackHistory: [
      {
        id: "feedback_1",
        workspaceId: "workspace_1",
        channelId: "channel_1",
        userId: "user_1",
        chatId: null,
        stage2RunId: "run_1",
        kind: "less_like_this",
        scope: "bottom",
        noteMode: "soft_preference",
        note: "Низ нужно суше.",
        optionSnapshot: {
          candidateId: "cand_1",
          optionNumber: 2,
          top: "Top sample",
          bottom: "Bottom sample",
          angle: "dry read",
          styleDirectionIds: ["direction_1"],
          explorationMode: "aligned"
        },
        createdAt: "2026-03-21T10:15:00.000Z"
      }
    ],
    channelStyleProfileFeedbackHistoryLoading: false,
    onDeleteChannelFeedbackEvent: async () => undefined,
    deletingChannelFeedbackEventId: null,
    channelEditorialMemory: {
      version: 1,
      windowSize: 30,
      recentFeedbackCount: 1,
      recentSelectionCount: 0,
      activeHardRuleCount: 0,
      explorationShare: 0.3,
      directionScores: [],
      angleScores: [],
      preferredTextCues: [],
      discouragedTextCues: [],
      hardRuleNotes: [],
      recentNotes: ["Низ нужно суше."],
      normalizedAxes: {
        humor: 0.5,
        sarcasm: 0.5,
        warmth: 0.5,
        insiderDensity: 0.5,
        intensity: 0.5,
        explanationDensity: 0.5,
        quoteDensity: 0.5,
        topCompression: 0.5
      },
      promptSummary: "Bootstrap directions: Direction 1. Recent explicit feedback: bottom should stay drier."
    },
    canEditChannelStyleProfile: true,
    channelStyleProfileDiscovering: false,
    channelStyleProfileDiscoveryError: null,
    channelStyleProfileSaveState: { status: "idle", message: null },
    updateChannelStyleProfileReferenceLinks: () => undefined,
    updateChannelStyleProfileExplorationShare: () => undefined,
    toggleChannelStyleProfileDirectionSelection: () => undefined,
    selectAllChannelStyleProfileDirections: () => undefined,
    clearChannelStyleProfileDirectionSelection: () => undefined,
    startChannelStyleProfileDiscovery: async () => undefined,
    saveChannelStyleProfileDraft: async () => undefined,
    discardChannelStyleProfileDraft: () => undefined,
    customExamplesJson: "[]",
    customExamplesError: null,
    updateWorkspaceExamplesJson: () => undefined,
    updateCustomExamplesJson: () => undefined,
    updateStage2HardConstraint: () => undefined,
    updateBannedWordsInput: () => undefined,
    updateBannedOpenersInput: () => undefined,
    updateStage2PromptTemplate: () => undefined,
    updateStage2PromptReasoning: () => undefined,
    resetStage2PromptStage: () => undefined
  });
  const markup = renderToStaticMarkup(element);

  assert.match(markup, /Стиль канала/);
  assert.match(markup, /Перегенерировать направления/);
  assert.match(markup, /Последние реакции канала/);
  assert.match(markup, /Низ нужно суше/);
  assert.match(markup, /Удалить реакцию feedback_1/);
  assert.match(markup, /type="range"/);
});

test("stage 2 output validation warns on banned words and banned openers", () => {
  const stage2 = makeRuntimeStage2Response("run_banned_lists", "banned-lists");
  stage2.output.captionOptions[0] = {
    ...stage2.output.captionOptions[0],
    top: "Here is a literal problem",
    bottom: "\"safe\" reaction"
  };
  stage2.output.captionOptions[1] = {
    ...stage2.output.captionOptions[1],
    top: "Clean top",
    bottom: "\"literal\" problem in the bottom"
  };

  const warnings = validateStage2Output(stage2.output, {
    ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
    bannedWords: ["literal"],
    bannedOpeners: ["Here is a"]
  });

  assert.match(
    warnings.map((warning) => `${warning.field}: ${warning.message}`).join("\n"),
    /captionOptions\.option1\.constraintCheck: Caption contains banned words\./
  );
  assert.match(
    warnings.map((warning) => `${warning.field}: ${warning.message}`).join("\n"),
    /captionOptions\.option1\.top: TOP starts with a banned opener\./
  );
  assert.match(
    warnings.map((warning) => `${warning.field}: ${warning.message}`).join("\n"),
    /captionOptions\.option2\.constraintCheck: Caption contains banned words\./
  );
});

test("comments prompt preparation keeps the most-liked comments and caps the payload at 300", () => {
  const comments = Array.from({ length: 350 }, (_, index) => ({
    id: `comment_${index + 1}`,
    author: `user_${index + 1}`,
    text: `comment text ${index + 1}`,
    likes: 350 - index,
    timestamp: index + 1,
    postedAt: null
  }));

  const sorted = sortCommentsByPopularity(comments);
  const prepared = prepareCommentsForPrompt(sorted);

  assert.equal(prepared.included.length, 300);
  assert.equal(prepared.omittedCount, 50);
  assert.equal(prepared.included[0]?.id, "comment_1");
  assert.equal(prepared.included[299]?.id, "comment_300");
});

test("youtube comment extraction args stop yt-dlp at the top 300 comments", () => {
  assert.deepEqual(buildLimitedCommentsExtractorArgs("https://www.youtube.com/watch?v=abc123"), [
    "--extractor-args",
    "youtube:comment_sort=top;max_comments=300,300,0,0"
  ]);
  assert.deepEqual(buildLimitedCommentsExtractorArgs("https://www.instagram.com/reel/abc123/"), []);
});

test("adaptive frame sampling expands clip coverage while staying bounded by clip length", () => {
  const shortPlan = buildAdaptiveFramePlan(7);
  const mediumPlan = buildAdaptiveFramePlan(22);
  const longPlan = buildAdaptiveFramePlan(95);

  assert.equal(shortPlan.length, 4);
  assert.equal(mediumPlan.length, 6);
  assert.equal(longPlan.length, 12);
  assert.ok(shortPlan[0]?.timestampSec < shortPlan[shortPlan.length - 1]!.timestampSec);
  assert.ok(mediumPlan.every((entry, index) => index === 0 || entry.timestampSec > mediumPlan[index - 1]!.timestampSec));
  assert.ok(longPlan.every((entry) => entry.timestampSec > 0));
  assert.match(longPlan[0]?.description ?? "", /opening setup/);
  assert.match(longPlan[longPlan.length - 1]?.description ?? "", /late aftermath/);
});

test("main Stage 2 runtime video context carries transcript and richer frame timeline when available", () => {
  const runtimeContext = buildStage2RuntimeVideoContext({
    sourceUrl: "https://example.com/clip",
    title: "Clip title",
    description: "Clip description",
    transcript: "This is the spoken line that clarifies the late reveal.",
    comments: [{ author: "viewer", likes: 8, text: "that reveal is nasty" }],
    frameDescriptions: buildAdaptiveFramePlan(18).map((entry) => entry.description),
    userInstruction: "Keep the narrator grounded."
  });

  assert.match(runtimeContext.transcript, /late reveal/);
  assert.equal(runtimeContext.frameDescriptions.length, 6);
  assert.match(runtimeContext.frameDescriptions[0] ?? "", /opening setup/);
  assert.match(runtimeContext.frameDescriptions[runtimeContext.frameDescriptions.length - 1] ?? "", /late aftermath/);
});

test("source context summary marks missing speech grounding explicitly when transcript is absent", () => {
  const summary = buildStage2SourceContextSummary(
    buildVideoContext({
      sourceUrl: "https://example.com/silent-clip",
      title: "Silent reaction clip",
      description: "A silent clip with no audio while everyone reacts visually.",
      transcript: "",
      comments: [],
      frameDescriptions: ["frame 1", "frame 2"]
    })
  );

  assert.equal(summary.transcriptChars, 0);
  assert.equal(summary.speechGroundingStatus, "no_speech_detected");
});

test("yt-dlp caption metadata is converted into transcript text for Stage 2 when captions are available", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        events: [
          { segs: [{ utf8: "The crowd hears the crack" }] },
          { segs: [{ utf8: "right before the wheel folds." }] }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  try {
    const transcript = await fetchTranscriptFromYtDlpInfo({
      language: "en",
      automatic_captions: {
        en: [{ ext: "json3", url: "https://example.com/captions.json3" }]
      }
    });
    assert.match(transcript, /The crowd hears the crack/);
    assert.match(transcript, /wheel folds/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("yt-dlp metadata reader loads comments from a separate comments artifact when info json omits them", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "clips-comments-artifact-"));

  try {
    await Promise.all([
      writeFile(
        path.join(tmpDir, "metadata.info.json"),
        JSON.stringify({
          title: "Artifact-backed clip",
          description: "Description from info json"
        }),
        "utf-8"
      ),
      writeFile(
        path.join(tmpDir, "metadata.comments.json"),
        JSON.stringify({
          comments: [
            { id: "comment_1", author: "user_1", text: "first comment", like_count: 7 },
            { id: "comment_2", author: "user_2", text: "second comment", like_count: 2 }
          ]
        }),
        "utf-8"
      )
    ]);

    const resolved = await readYtDlpMetadataArtifacts(tmpDir, "metadata");
    assert.equal(resolved.infoJson?.title, "Artifact-backed clip");
    assert.deepEqual(resolved.comments, [
      { id: "comment_1", author: "user_1", text: "first comment", like_count: 7 },
      { id: "comment_2", author: "user_2", text: "second comment", like_count: 2 }
    ]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("yt-dlp metadata reader prefers metadata info json over source download info json when both exist", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "clips-comments-metadata-"));

  try {
    await Promise.all([
      writeFile(
        path.join(tmpDir, "source.info.json"),
        JSON.stringify({
          title: "Downloaded title",
          description: "Download path metadata",
          comments: []
        }),
        "utf-8"
      ),
      writeFile(
        path.join(tmpDir, "metadata.info.json"),
        JSON.stringify({
          title: "Comments probe title",
          description: "Metadata probe description",
          comments: [{ id: "comment_1", author: "user_1", text: "preferred comment" }]
        }),
        "utf-8"
      )
    ]);

    const preferredInfo = pickPreferredYtDlpInfoJsonFile(
      ["source.info.json", "metadata.info.json"],
      "metadata"
    );
    assert.equal(preferredInfo, "metadata.info.json");

    const resolved = await readYtDlpMetadataArtifacts(tmpDir, "metadata");
    assert.equal(resolved.infoJson?.title, "Comments probe title");
    assert.deepEqual(resolved.comments, [
      { id: "comment_1", author: "user_1", text: "preferred comment" }
    ]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("channel manager adds a dedicated shared settings target only for owners", () => {
  const channels = [
    makeChannelForManager({ id: "alpha", name: "Alpha Channel", username: "alpha" }),
    makeChannelForManager({ id: "beta", name: "Beta Channel", username: "beta" })
  ];

  const ownerTargets = listChannelManagerTargets(channels, true);
  assert.equal(ownerTargets[0]?.id, CHANNEL_MANAGER_DEFAULT_SETTINGS_ID);
  assert.equal(ownerTargets[0]?.label, "Общие настройки");
  assert.equal(ownerTargets[0]?.kind, "workspace_defaults");
  assert.equal(ownerTargets[1]?.id, "alpha");

  const redactorTargets = listChannelManagerTargets(channels, false);
  assert.deepEqual(
    redactorTargets.map((item) => item.id),
    ["alpha", "beta"]
  );
});

test("redactor with channel access can edit setup but still cannot manage access or delete чужой канал", () => {
  const permissions = resolveChannelPermissions({
    membership: {
      id: "member_1",
      workspaceId: "workspace_1",
      userId: "redactor_1",
      role: "redactor",
      createdAt: nowIso(),
      updatedAt: nowIso()
    },
    channel: {
      id: "channel_1",
      creatorUserId: "owner_1"
    },
    explicitAccess: {
      id: "grant_1",
      channelId: "channel_1",
      userId: "redactor_1",
      accessRole: "operate",
      grantedByUserId: "owner_1",
      createdAt: nowIso(),
      revokedAt: null
    }
  });

  assert.equal(permissions.isVisible, true);
  assert.equal(permissions.canOperate, true);
  assert.equal(permissions.canEditSetup, true);
  assert.equal(permissions.canManageAccess, false);
  assert.equal(permissions.canDelete, false);
});

test("limited redactor still cannot edit channel setup", () => {
  const permissions = resolveChannelPermissions({
    membership: {
      id: "member_2",
      workspaceId: "workspace_1",
      userId: "redactor_limited_1",
      role: "redactor_limited",
      createdAt: nowIso(),
      updatedAt: nowIso()
    },
    channel: {
      id: "channel_1",
      creatorUserId: "owner_1"
    },
    explicitAccess: {
      id: "grant_2",
      channelId: "channel_1",
      userId: "redactor_limited_1",
      accessRole: "operate",
      grantedByUserId: "owner_1",
      createdAt: nowIso(),
      revokedAt: null
    }
  });

  assert.equal(permissions.isVisible, true);
  assert.equal(permissions.canOperate, true);
  assert.equal(permissions.canEditSetup, false);
  assert.equal(permissions.canDelete, false);
});

test("editor restrictions block only system prompts and thinking changes", () => {
  assert.equal(
    getRestrictedChannelEditError("redactor", {
      name: "Updated channel",
      username: "updated_channel"
    }),
    null
  );
  assert.equal(
    getRestrictedChannelEditError("redactor", {
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
    }),
    null
  );
  assert.equal(
    getRestrictedChannelEditError("redactor", {
      systemPrompt: "New system prompt"
    }),
    "Редактор не может менять системные промпты канала."
  );
  assert.equal(
    getRestrictedChannelEditError("redactor", {
      descriptionPrompt: "New description prompt"
    }),
    "Редактор не может менять системные промпты канала."
  );
  assert.equal(
    getRestrictedChannelEditError("redactor", {
      stage2PromptConfig: normalizeStage2PromptConfig({})
    }),
    "Только owner может менять Stage 2 prompt defaults."
  );
  assert.equal(
    getRestrictedChannelEditError("manager", {
      systemPrompt: "Manager prompt"
    }),
    null
  );
});

test("channel delete action stays disabled when user may edit setup but may not delete", () => {
  const editableButNotDeletable = {
    ...makeChannelForManager({ id: "alpha", name: "Alpha Channel", username: "alpha" }),
    currentUserCanEditSetup: true,
    currentUserCanDelete: false
  };
  const deletable = {
    ...makeChannelForManager({ id: "beta", name: "Beta Channel", username: "beta" }),
    currentUserCanDelete: true
  };

  assert.equal(canDeleteManagedChannel([editableButNotDeletable, deletable], editableButNotDeletable), false);
  assert.equal(canDeleteManagedChannel([editableButNotDeletable, deletable], deletable), true);
  assert.equal(canDeleteManagedChannel([deletable], deletable), false);
});

test("selector prompt is LLM-driven and receives the active examples corpus plus per-stage prompt config", async () => {
  const promptConfig = normalizeStage2PromptConfig({
    stages: {
      selector: {
        prompt:
          "Custom selector template: inspect available_examples carefully and choose ids from them only.",
        reasoningEffort: "high"
      },
      writer: {
        prompt: "Custom writer template: stay concrete and grounded.",
        reasoningEffort: "x-high"
      }
    }
  });

  const { executor, result } = await runSuccessfulPipeline({ promptConfig });
  const selectorCall = executor.calls[1];
  const writerCall = executor.calls[2];

  assert.ok(selectorCall);
  assert.match(selectorCall!.prompt, /Custom selector template/);
  assert.match(selectorCall!.prompt, /availableExamples/);
  assert.match(selectorCall!.prompt, /Truck axle snaps in the mud/);
  assert.match(selectorCall!.prompt, /Crowd reacts when the wheel folds/);
  assert.ok(!/retrieval stage role/i.test(selectorCall!.prompt));
  assert.equal(selectorCall!.reasoningEffort, "high");
  assert.ok(writerCall);
  assert.match(writerCall!.prompt, /Custom writer template/);
  assert.equal(writerCall!.reasoningEffort, "x-high");
  assert.equal(
    result.diagnostics.effectivePrompting.promptStages.find((stage) => stage.stageId === "selector")
      ?.configuredPrompt,
    "Custom selector template: inspect available_examples carefully and choose ids from them only."
  );
});

test("executor wraps non-object root schemas for Codex transport and unwraps the result payload", () => {
  const transport = prepareCodexSchemaTransport({
    prompt: "Return strict JSON array.",
    schema: {
      type: ["array", "object"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: {
          value: { type: "string" },
          note: { type: "string" }
        }
      }
    }
  });

  assert.deepEqual(transport.schema, {
    type: "object",
    additionalProperties: false,
    required: ["result"],
    properties: {
      result: {
        type: ["array", "object"],
        items: {
          type: "object",
          additionalProperties: false,
          required: ["value", "note"],
          properties: {
            value: { type: "string" },
            note: { type: ["string", "null"] }
          }
        }
      }
    }
  });
  assert.match(transport.prompt, /single JSON object with exactly one key: "result"/);
  assert.deepEqual(transport.unwrap({ result: [{ value: "ok" }] }), [{ value: "ok" }]);
});

test("pipeline summary diagnostics omit raw prompt text but keep token usage", async () => {
  const { result } = await runSuccessfulPipeline();

  assert.ok(result.tokenUsage);
  assert.ok((result.tokenUsage?.totalPromptChars ?? 0) > 0);
  assert.ok((result.tokenUsage?.stages.length ?? 0) >= 6);
  assert.ok(
    result.diagnostics.effectivePrompting.promptStages.every((stage) => stage.promptText === null)
  );
  assert.ok(
    result.diagnostics.effectivePrompting.promptStages.some((stage) => stage.promptTextAvailable === true)
  );
});

test("pipeline raw mode captures executed prompt text in debug artifact", async () => {
  const { result } = await runSuccessfulPipeline({ debugMode: "raw" });

  assert.ok(result.rawDebugArtifact);
  assert.equal(result.rawDebugArtifact?.kind, "stage2-run-debug");
  assert.ok(
    result.rawDebugArtifact?.promptStages.some(
      (stage) => stage.stageId === "writer" && typeof stage.promptText === "string" && stage.promptText.length > 0
    )
  );
  assert.ok(
    result.diagnostics.effectivePrompting.promptStages.every((stage) => stage.promptText === null)
  );
});

test("simple Stage 3 goals skip Codex planner when heuristic ops are available", () => {
  const shouldUse = shouldUseCodexPlanner(
    {
      goalSignal: {
        goalType: "focusOnly",
        confidence: 0.88,
        ambiguity: 0.31,
        constraints: {
          forbidZoom: false,
          forbidAudio: false,
          forbidCrop: false,
          targetZoom: 1.18,
          allowTextRewrite: false
        },
        guidance: {
          tightenFraming: true,
          verticalReframe: false,
          polish: false,
          artifactEdges: [],
          desiredFocusShift: 0,
          preferStrongerIterations: true,
          forceIteration: false,
          useFullSource: false
        },
        rawGoal: "focus on the subject and tighten the framing"
      },
      goalText: "focus on the subject and tighten the framing",
      snapshot: {} as any,
      autoClipStartSec: 0,
      autoFocusY: 0.5,
      iterationIndex: 1,
      planBudget: 4,
      lastTotalScore: 0.52,
      sourceDurationSec: 8,
      codexHome: "/tmp/fake-codex-home"
    } as any,
    {
      rationale: "heuristic",
      strategy: "heuristic",
      hypothesis: "simple focus shift",
      operations: [{ op: "set_focus_y", focusY: 0.44 }],
      magnitudes: [0.5]
    } as any
  );

  assert.equal(shouldUse, false);
});

test("executor strictifies object schemas so every property is required for Codex structured output", () => {
  const transport = prepareCodexSchemaTransport({
    prompt: "Return strict JSON object.",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" },
        meta: {
          type: "object",
          additionalProperties: false,
          required: ["label"],
          properties: {
            label: { type: "string" },
            optionalScore: { type: "number" }
          }
        }
      }
    }
  });

  assert.deepEqual(transport.schema, {
    type: "object",
    additionalProperties: false,
    required: ["id", "meta"],
    properties: {
      id: { type: "string" },
      meta: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["label", "optionalScore"],
        properties: {
          label: { type: "string" },
          optionalScore: { type: ["number", "null"] }
        }
      }
    }
  });
});

test("critic uses a canonical object-root schema and the provider-facing contract stays valid", async () => {
  const { executor } = await runSuccessfulPipeline();
  const criticCall = executor.calls[3];

  assert.ok(criticCall);
  assert.equal((criticCall.schema as { type?: unknown }).type, "object");
  assert.deepEqual((criticCall.schema as { required?: unknown }).required, ["scores"]);

  const transport = prepareCodexSchemaTransport({
    prompt: criticCall.prompt,
    schema: criticCall.schema
  });

  assert.equal((transport.schema as { type?: unknown }).type, "object");
  assert.doesNotMatch(JSON.stringify(transport.schema), /"type"\s*:\s*\[\s*"array"\s*,\s*"object"\s*\]/);
  assertSchemaRequiredMatchesProperties(transport.schema);

  const transportScores =
    ((transport.schema as { properties?: Record<string, unknown> }).properties?.scores as {
      items?: { properties?: Record<string, unknown> };
    })?.items?.properties?.scores as {
      additionalProperties?: unknown;
      properties?: Record<string, unknown>;
      required?: unknown;
    };
  assert.ok(transportScores);
  assert.equal(transportScores.additionalProperties, false);
  assert.deepEqual(
    Object.keys(transportScores.properties ?? {}),
    [
      "visual_anchor",
      "hook_strength",
      "naturalness",
      "brand_fit",
      "specificity",
      "top_bottom_synergy",
      "readability",
      "non_ai_feel",
      "paused_frame_accuracy",
      "comment_vibe_authenticity",
      "length_compliance",
      "narrative_trigger_strength",
      "context_compression_quality"
    ]
  );
  assert.deepEqual(transportScores.required, Object.keys(transportScores.properties ?? {}));
});

test("pipeline accepts provider-native object-wrapped outputs for writer critic rewriter and titles", async () => {
  const { result, executor } = await runSuccessfulPipeline({
    providerWrappedStageOutputs: true
  });

  assert.equal(result.warnings.some((warning) => warning.field === "critic"), false);
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.output.titleOptions.length, 5);

  const writerCall = executor.calls[2];
  const criticCall = executor.calls[3];
  const rewriterCall = executor.calls[4];
  const titlesCall = executor.calls[6];

  assert.equal((writerCall?.schema as { type?: unknown }).type, "object");
  assert.deepEqual((writerCall?.schema as { required?: unknown }).required, ["candidates"]);
  assert.equal((criticCall?.schema as { type?: unknown }).type, "object");
  assert.deepEqual((criticCall?.schema as { required?: unknown }).required, ["scores"]);
  assert.equal((rewriterCall?.schema as { type?: unknown }).type, "object");
  assert.deepEqual((rewriterCall?.schema as { required?: unknown }).required, ["candidates"]);
  assert.equal((titlesCall?.schema as { type?: unknown }).type, "object");
  assert.deepEqual((titlesCall?.schema as { required?: unknown }).required, ["titleOptions"]);
});

test("pipeline unwraps JSON-string title payloads before persisting title options", async () => {
  const { result } = await runSuccessfulPipeline({
    titleResponse: {
      titleOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: JSON.stringify({
          title_id: `${index + 1}`,
          title: `WHO BROKE THE AXLE ${index + 1}`,
          title_ru: `КТО СЛОМАЛ МОСТ ${index + 1}`,
          rationale: `Title ${index + 1} rationale.`
        }),
        title_ru: JSON.stringify({
          title_id: `${index + 1}`,
          title: `WHO BROKE THE AXLE ${index + 1}`,
          title_ru: `КТО СЛОМАЛ МОСТ ${index + 1}`,
          rationale: `Title ${index + 1} rationale.`
        })
      }))
    }
  });

  assert.deepEqual(result.output.titleOptions[0], {
    option: 1,
    title: "WHO BROKE THE AXLE 1",
    titleRu: "КТО СЛОМАЛ МОСТ 1"
  });
  assert.doesNotMatch(result.output.titleOptions[0]?.title ?? "", /^\s*[{[]/);
  assert.doesNotMatch(result.output.titleOptions[0]?.titleRu ?? "", /^\s*[{[]/);
});

test("extractStage2Payload repairs legacy stage2 events whose title strings contain a serialized title array", () => {
  const embeddedTitleArray = JSON.stringify(
    Array.from({ length: 5 }, (_, index) => ({
      title_id: `${index + 1}`,
      title: `WHO THOUGHT THIS MUCH ISSUED GEAR WAS CARRY-ON ${index + 1}`,
      title_ru: `КТО РЕШИЛ, ЧТО СТОЛЬКО ВЫДАННОГО СНАРЯЖЕНИЯ МОЖНО ПРОНЕСТИ КАК РУЧНУЮ КЛАДЬ ${index + 1}`,
      rationale: `Title ${index + 1} rationale.`
    }))
  );

  const payload = extractStage2Payload({
    source: {
      url: "https://example.com/short",
      title: "Legacy titles",
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0
    },
    output: {
      inputAnalysis: {
        visualAnchors: ["anchor"],
        commentVibe: "dry",
        keyPhraseToAdapt: "legacy"
      },
      captionOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        top: `legacy top ${index + 1}`,
        bottom: `"legacy" bottom ${index + 1}`,
        topRu: `legacy верх ${index + 1}`,
        bottomRu: `"legacy" низ ${index + 1}`
      })),
      titleOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: embeddedTitleArray,
        titleRu: embeddedTitleArray
      })),
      finalPick: {
        option: 1,
        reason: "legacy winner"
      }
    },
    warnings: []
  });

  assert.equal(
    payload?.output.titleOptions[0]?.title,
    "WHO THOUGHT THIS MUCH ISSUED GEAR WAS CARRY-ON 1"
  );
  assert.equal(
    payload?.output.titleOptions[0]?.titleRu,
    "КТО РЕШИЛ, ЧТО СТОЛЬКО ВЫДАННОГО СНАРЯЖЕНИЯ МОЖНО ПРОНЕСТИ КАК РУЧНУЮ КЛАДЬ 1"
  );
  assert.equal(
    payload?.output.titleOptions[1]?.title,
    "WHO THOUGHT THIS MUCH ISSUED GEAR WAS CARRY-ON 2"
  );
});

test("stage2 run store repairs persisted title options with embedded JSON title payloads", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Title Repair Workspace",
      email: "owner-title-repair@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Title Repair Channel",
      username: "title_repair_channel"
    });

    const run = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: {
        sourceUrl: "https://example.com/title-repair",
        userInstruction: null,
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2ExamplesConfig: channel.stage2ExamplesConfig ?? DEFAULT_STAGE2_EXAMPLES_CONFIG,
          stage2HardConstraints: channel.stage2HardConstraints ?? DEFAULT_STAGE2_HARD_CONSTRAINTS
        }
      }
    });

    const badTitles = Array.from({ length: 5 }, (_, index) =>
      JSON.stringify({
        title_id: `${index + 1}`,
        title: `HOW IS THIS 5.3 STILL RUNNING ${index + 1}`,
        title_ru: `КАК ЭТОТ 5.3 ВСЕ ЕЩЕ РАБОТАЕТ ${index + 1}`,
        rationale: `Title ${index + 1} rationale.`
      })
    );

    const baseResult = makeRuntimeStage2Response("run_title_fix", "titles");
    const saved = setStage2RunResultData(run.runId, {
      ...baseResult,
      output: {
        ...baseResult.output,
        titleOptions: badTitles.map((title, index) => ({
          option: index + 1,
          title,
          titleRu: title
        }))
      }
    });
    const reloaded = getStage2Run(run.runId);
    const titleOptions = ((reloaded?.resultData as Stage2Response | null)?.output.titleOptions ?? []);

    assert.ok(saved);
    assert.equal(titleOptions[0]?.title, "HOW IS THIS 5.3 STILL RUNNING 1");
    assert.equal(titleOptions[0]?.titleRu, "КАК ЭТОТ 5.3 ВСЕ ЕЩЕ РАБОТАЕТ 1");
    assert.doesNotMatch(titleOptions[0]?.title ?? "", /^\s*[{[]/);
  });
});

test("stage 2 pipeline returns a shortlist for human pick using selector-chosen examples", async () => {
  const { progressEvents, result } = await runSuccessfulPipeline();
  const runningStages = progressEvents
    .filter((event) => event.state === "running")
    .map((event) => event.stageId);

  assert.deepEqual(runningStages, [
    "analyzer",
    "selector",
    "writer",
    "critic",
    "rewriter",
    "finalSelector",
    "titles"
  ]);
  assert.ok(!runningStages.includes("retrieval"));
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.output.titleOptions.length, 5);
  assert.equal(result.output.finalPick.option, 2);
  assertFinalShortlistContract(result);
  assert.equal(result.output.pipeline.mode, "codex_pipeline");
  assert.equal(result.output.pipeline.availableExamplesCount, 5);
  assert.equal(result.output.pipeline.selectedExamplesCount, 3);
  assert.equal(result.output.pipeline.retrievalConfidence, "high");
  assert.equal(result.output.pipeline.examplesMode, "domain_guided");
  assert.ok(result.output.captionOptions.every((option) => option.candidateId));
  assert.ok(result.output.captionOptions.every((option) => option.angle));
  assert.ok(result.output.captionOptions.every((option) => option.constraintCheck?.passed));
  assert.equal(result.diagnostics.examples.activeCorpusCount, 5);
  assert.equal(result.diagnostics.examples.selectorCandidateCount, 5);
  assert.equal(result.diagnostics.examples.retrievalConfidence, "high");
  assert.equal(result.diagnostics.examples.examplesMode, "domain_guided");
  assert.equal(result.diagnostics.examples.selectedExamples.length, 3);
  assert.ok(result.diagnostics.analysis.sceneBeats.length > 0);
  assert.ok(result.diagnostics.analysis.revealMoment.length > 0);
  assert.deepEqual(
    result.diagnostics.examples.selectedExamples.map((example) => example.title).sort(),
    [
      "Crowd reacts when the wheel folds",
      "Driver keeps rolling after the first wobble",
      "Truck axle snaps in the mud",
    ].sort()
  );
});

test("legacy stage 2 progress snapshots are normalized with step status finishedAt and summary", () => {
  const startedAt = "2026-03-19T08:00:00.000Z";
  const updatedAt = "2026-03-19T08:03:00.000Z";
  const snapshot = normalizeStage2ProgressSnapshot(
    {
      runId: "run_legacy",
      status: "completed",
      startedAt,
      updatedAt,
      steps: [
        {
          id: "writer",
          state: "completed",
          detail: "20 candidates drafted.",
          startedAt
        }
      ]
    },
    "run_legacy"
  );

  const writerStep = snapshot.steps.find((step) => step.id === "writer");
  assert.ok(writerStep);
  assert.equal(snapshot.finishedAt, updatedAt);
  assert.equal(writerStep?.status, "completed");
  assert.equal(writerStep?.state, "completed");
  assert.equal(writerStep?.finishedAt, updatedAt);
  assert.equal(writerStep?.completedAt, updatedAt);
  assert.equal(writerStep?.summary, "20 candidates drafted.");
});

test("operator-facing final pick reason is generated from the visible shortlist only", async () => {
  const { result } = await runSuccessfulPipeline({
    finalSelectorRationale:
      "c04 is strongest, but c07 and c08 still matter because they almost beat it on tension."
  });
  const visibleIds = result.output.captionOptions.map((option) => option.candidateId);

  assert.match(result.output.finalPick.reason, /^option 2 is the strongest visible pick/i);
  assert.match(result.output.finalPick.reason, /lands the reaction with/i);
  assert.match(result.output.finalPick.reason, /The rest of the visible shortlist still gives real alternates:/);
  assert.doesNotMatch(result.output.finalPick.reason, /\bc0[78]\b/i);
  assert.doesNotMatch(result.output.finalPick.reason, /\bcand_7\b|\bcand_8\b/i);
  assert.equal(result.output.pipeline.finalSelector?.rationaleRaw, result.output.finalPick.reason);
  assert.equal(
    result.output.pipeline.finalSelector?.rationaleInternalRaw,
    `Final selector evaluated ${visibleIds.length} shortlist candidates: ${visibleIds.join(", ")}. ` +
      "Final visible shortlist is cand_1, cand_2, cand_3, cand_4, cand_5 with cand_2 as the final pick. " +
      "Visible angles: payoff_reveal, shared_experience, competence_process."
  );
  assert.equal(
    result.output.pipeline.finalSelector?.rationaleInternalModelRaw,
    "Sanitized because the model rationale contradicted the persisted shortlist. " +
      `Final selector evaluated ${visibleIds.length} shortlist candidates: ${visibleIds.join(", ")}. ` +
      "Final visible shortlist is cand_1, cand_2, cand_3, cand_4, cand_5 with cand_2 as the final pick. " +
      "Visible angles: payoff_reveal, shared_experience, competence_process."
  );
});

test("shortlist preserves diversity when a same-angle final selector set can be safely widened", async () => {
  const narrowWriterCandidates = [
    makeCandidate("cand_1", "payoff_reveal", 1),
    makeCandidate("cand_2", "payoff_reveal", 2),
    makeCandidate("cand_3", "payoff_reveal", 3),
    makeCandidate("cand_4", "payoff_reveal", 4),
    makeCandidate("cand_5", "payoff_reveal", 5),
    makeCandidate("cand_6", "shared_experience", 6),
    makeCandidate("cand_7", "competence_process", 7),
    makeCandidate("cand_8", "absurdity_chaos", 8)
  ];

  const { result } = await runSuccessfulPipeline({
    writerCandidates: narrowWriterCandidates,
    rewrittenCandidates: narrowWriterCandidates,
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_2",
      rationale: "Keep the strongest payoff lane."
    }
  });

  const shortlistAngles = result.output.captionOptions.map((option) => option.angle);
  assertFinalShortlistContract(result);
  assert.ok(new Set(shortlistAngles).size >= 2);
  assert.ok(result.output.captionOptions.some((option) => option.candidateId === "cand_2"));
  assert.ok(
    result.output.captionOptions.some(
      (option) => option.candidateId === "cand_6" || option.candidateId === "cand_7" || option.candidateId === "cand_8"
    )
  );
});

test("shortlist promotes a strong comment-native candidate into the visible five when comment pressure is high", async () => {
  const stage2HardConstraints: Stage2HardConstraints = {
    topLengthMin: 40,
    topLengthMax: 180,
    bottomLengthMin: 40,
    bottomLengthMax: 150,
    bannedWords: [],
    bannedOpeners: []
  };
  const writerCandidates = [
    {
      candidate_id: "cand_1",
      angle: "tension_danger",
      top: "The armored run looks fine for one second, then the whole vehicle carries too much speed and heads straight for the crowd fence.",
      bottom: "That fence is there for manners, not physics, and everybody by the pickup learns that the hard way.",
      top_ru: "ru 1",
      bottom_ru: "ru 1",
      rationale: "safe generic winner"
    },
    {
      candidate_id: "cand_2",
      angle: "shared_experience",
      top: "The demo stops looking controlled the second the vehicle starts skating wide and the spectator side becomes part of the route.",
      bottom: "That slow shuffle from the crowd tells you exactly when the show stops feeling like a show.",
      top_ru: "ru 2",
      bottom_ru: "ru 2",
      rationale: "crowd read"
    },
    {
      candidate_id: "cand_3",
      angle: "insider_expertise",
      top: "Once that much armored weight misses the line, the rest of the clip is just momentum bullying the fence into surrender.",
      bottom: "Nobody near that pickup needs an announcer to explain what the next bad second is about to do.",
      top_ru: "ru 3",
      bottom_ru: "ru 3",
      rationale: "insider read"
    },
    {
      candidate_id: "cand_4",
      angle: "absurdity_chaos",
      top: "This starts like a military demo and ends like the course suddenly opened a bonus exit straight through the spectators.",
      bottom: "It stops feeling tactical the second the truck chooses local traffic over whatever the plan was supposed to be.",
      top_ru: "ru 4",
      bottom_ru: "ru 4",
      rationale: "absurdity read"
    },
    {
      candidate_id: "cand_5",
      angle: "shared_experience",
      top: "The crowd thinks they are watching a clean pass until the armor slides off line and turns the fence into a suggestion.",
      bottom: "One bad arc and the safe side of the course becomes pure wishful thinking for everybody standing there.",
      top_ru: "ru 5",
      bottom_ru: "ru 5",
      rationale: "safe reserve"
    },
    {
      candidate_id: "cand_6",
      angle: "absurdity_chaos",
      top: "The armored run is supposed to look elite right up until the thing blows through the fence like nobody told elite SADF about braking room.",
      bottom: "This is taxi driver in SANDF energy with eight wheels and a full audience, which is exactly why the whole crowd starts moving at once.",
      top_ru: "ru 6",
      bottom_ru: "ru 6",
      rationale: "comment-native jab"
    },
    {
      candidate_id: "cand_7",
      angle: "tension_danger",
      top: "You can see the line disappear under that vehicle long before the fence gets a vote in how the demonstration should end.",
      bottom: "The panic here is not cinematic, it is everybody at the pickup realizing the heavy part has picked a new route.",
      top_ru: "ru 7",
      bottom_ru: "ru 7",
      rationale: "danger reserve"
    },
    {
      candidate_id: "cand_8",
      angle: "shared_experience",
      top: "The speed sells the demo until the armor starts skating and suddenly the crowd is learning the difference between a show lane and real momentum.",
      bottom: "The crowd-side reaction lands because everyone there can tell the fence was a courtesy, not a plan.",
      top_ru: "ru 8",
      bottom_ru: "ru 8",
      rationale: "safe reserve 2"
    }
  ];
  const criticResponse = writerCandidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    scores: makeCriticScoreMap(index),
    total: candidate.candidate_id === "cand_6" ? 8.25 : 9 - index * 0.15,
    issues: [],
    keep: true
  }));

  const { result } = await runSuccessfulPipeline({
    stage2HardConstraints,
    comments: [
      { author: "viewer_1", likes: 33, text: "The SADF doesn’t need an enemy, they’ll eliminate themselves!" },
      { author: "viewer_2", likes: 14, text: "And I present to you our elite SADF🫡" },
      { author: "viewer_3", likes: 6, text: "Taxi driver in SANDF.....also learned to drive on his play station😂😂" }
    ],
    analyzerResponse: {
      comment_vibe: "mocking disbelief",
      comment_consensus_lane: "Consensus lane keeps gravitating toward The SADF doesn’t need an enemy.",
      comment_joke_lane: "Joke lane keeps phrasing it like Taxi driver in SANDF and elite SADF.",
      slang_to_adapt: ["SADF", "elite SADF", "Taxi driver in SANDF"],
      comment_language_cues: ["The SADF doesn’t need an enemy", "elite SADF", "Taxi driver in SANDF"],
      hidden_detail: "The audience keeps reducing the whole moment to compact SADF jokes."
    },
    writerCandidates,
    rewrittenCandidates: writerCandidates,
    criticResponse,
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_1",
      rationale: "The cleanest five keep the safe visible reads."
    }
  });

  assert.ok(result.output.captionOptions.some((option) => option.candidateId === "cand_6"));
});

test("final pick can override a sanitized winner when a strong comment-native option is equally competitive", async () => {
  const stage2HardConstraints: Stage2HardConstraints = {
    topLengthMin: 40,
    topLengthMax: 180,
    bottomLengthMin: 40,
    bottomLengthMax: 150,
    bannedWords: [],
    bannedOpeners: []
  };
  const writerCandidates = [
    {
      candidate_id: "cand_1",
      angle: "tension_danger",
      top: "The armored run looks controlled until the vehicle drifts off line and turns the crowd fence into the next obstacle.",
      bottom: "That fence is there for manners, not physics, and the whole crowd reads the rest of the clip from the pickup side.",
      top_ru: "ru 1",
      bottom_ru: "ru 1",
      rationale: "sanitized winner"
    },
    {
      candidate_id: "cand_2",
      angle: "shared_experience",
      top: "The crowd only needs one second of that wide slide to understand the course has stopped being the course.",
      bottom: "That spectator shuffle is what tells you the demonstration has already changed categories.",
      top_ru: "ru 2",
      bottom_ru: "ru 2",
      rationale: "crowd read"
    },
    {
      candidate_id: "cand_3",
      angle: "insider_expertise",
      top: "Too much armored weight, not enough room, and the fence learns first why the line stopped mattering.",
      bottom: "This is the point where everyone nearby starts respecting momentum more than whatever the demo brief said.",
      top_ru: "ru 3",
      bottom_ru: "ru 3",
      rationale: "process read"
    },
    {
      candidate_id: "cand_4",
      angle: "absurdity_chaos",
      top: "The clip sells elite timing right until the vehicle takes the crowd fence like it was just another suggestion.",
      bottom: "It stops looking tactical the second the show picks the same route a bad local driver would.",
      top_ru: "ru 4",
      bottom_ru: "ru 4",
      rationale: "absurdity read"
    },
    {
      candidate_id: "cand_5",
      angle: "shared_experience",
      top: "The moment that armor starts skating wide, everybody watching knows the safest thing in frame is the dust cloud.",
      bottom: "The crowd-side panic lands because the course line has already lost the argument by then.",
      top_ru: "ru 5",
      bottom_ru: "ru 5",
      rationale: "reserve"
    },
    {
      candidate_id: "cand_6",
      angle: "absurdity_chaos",
      top: "This is supposed to look like elite SADF control, then the whole machine goes taxi-driver wide and introduces itself to the spectator fence.",
      bottom: "That is pure taxi driver in SANDF energy, which is why this lands harder than another clean generic military-demo joke.",
      top_ru: "ru 6",
      bottom_ru: "ru 6",
      rationale: "comment-native strong alternate"
    }
  ];
  const criticResponse = writerCandidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    scores: makeCriticScoreMap(index),
    total:
      candidate.candidate_id === "cand_1"
        ? 8.8
        : candidate.candidate_id === "cand_6"
          ? 8.65
          : 8.1 - index * 0.1,
    issues: [],
    keep: true
  }));

  const { result } = await runSuccessfulPipeline({
    stage2HardConstraints,
    comments: [
      { author: "viewer_1", likes: 33, text: "The SADF doesn’t need an enemy, they’ll eliminate themselves!" },
      { author: "viewer_2", likes: 14, text: "And I present to you our elite SADF🫡" },
      { author: "viewer_3", likes: 6, text: "Taxi driver in SANDF.....also learned to drive on his play station😂😂" }
    ],
    analyzerResponse: {
      comment_vibe: "mocking disbelief",
      comment_consensus_lane: "Consensus lane keeps gravitating toward The SADF doesn’t need an enemy.",
      comment_joke_lane: "Joke lane keeps phrasing it like Taxi driver in SANDF and elite SADF.",
      slang_to_adapt: ["SADF", "elite SADF", "Taxi driver in SANDF"],
      comment_language_cues: ["The SADF doesn’t need an enemy", "elite SADF", "Taxi driver in SANDF"],
      hidden_detail: "The audience keeps reducing the whole moment to compact SADF jokes."
    },
    writerCandidates,
    rewrittenCandidates: writerCandidates,
    criticResponse,
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_6"],
      final_pick: "cand_1",
      rationale: "cand_1 is cleanest."
    }
  });

  assert.equal(result.output.pipeline.finalSelector?.finalPickCandidateId, "cand_6");
});

test("final pick prefers plain spoken social captions over synthetic editorial phrasing when scores are close", async () => {
  const stage2HardConstraints: Stage2HardConstraints = {
    topLengthMin: 40,
    topLengthMax: 180,
    bottomLengthMin: 40,
    bottomLengthMax: 150,
    bannedWords: [],
    bannedOpeners: []
  };
  const writerCandidates = [
    {
      candidate_id: "cand_1",
      angle: "payoff_reveal",
      top: "The fan throws the Spider-Man sign at the wall and Caleb's half-second pause becomes the whole social question in the room.",
      bottom: "That pause made everyone do instant social math: stay PR-safe or mirror her, then the shared-room nod lands.",
      top_ru: "ru 1",
      bottom_ru: "ru 1",
      rationale: "synthetic editorial winner"
    },
    {
      candidate_id: "cand_2",
      angle: "shared_experience",
      top: "Fan hits him with the Spider-Man sign at the wall and he freezes for a sec like he already knows this could get clipped everywhere.",
      bottom: "Pure \"right now I can't\" for one beat, then he loosens up and matches enough to keep it cute.",
      top_ru: "ru 2",
      bottom_ru: "ru 2",
      rationale: "plain spoken social read"
    },
    {
      candidate_id: "cand_3",
      angle: "shared_experience",
      top: "The whole thing is one tiny fan-service gamble: she throws the sign, he pauses, and the room waits to see how careful he wants to be.",
      bottom: "He buys himself one second, then gives her just enough back to keep the moment sweet instead of awkward.",
      top_ru: "ru 3",
      bottom_ru: "ru 3",
      rationale: "reserve"
    },
    {
      candidate_id: "cand_4",
      angle: "payoff_reveal",
      top: "What makes the clip work is how fast that normal photo-wall beat turns into a tiny 'can he do that?' moment without anybody forcing it.",
      bottom: "The pause is the joke. Everybody can see him doing the risk check in real time before he lets the pose happen.",
      top_ru: "ru 4",
      bottom_ru: "ru 4",
      rationale: "reserve 2"
    },
    {
      candidate_id: "cand_5",
      angle: "insider nerd confirmation meme",
      top: "She throws him a Spider-Man pose and half the room instantly starts acting like they just caught a casting leak in public.",
      bottom: "Nobody can prove anything, but you can feel the Miles crowd clocking that pause like rent is due.",
      top_ru: "ru 5",
      bottom_ru: "ru 5",
      rationale: "comment lane"
    },
    {
      candidate_id: "cand_6",
      angle: "shared_experience",
      top: "It is such a small moment, but the pause matters because everybody knows fan requests only stay cute until the celebrity says no out loud.",
      bottom: "He never has to make it weird. One beat, one half-smile, and the room gets what it came for.",
      top_ru: "ru 6",
      bottom_ru: "ru 6",
      rationale: "reserve 3"
    }
  ];
  const criticResponse = writerCandidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    scores: makeCriticScoreMap(index),
    total:
      candidate.candidate_id === "cand_1"
        ? 8.95
        : candidate.candidate_id === "cand_2"
          ? 8.85
          : 8.25 - index * 0.05,
    issues: [],
    keep: true
  }));

  const { result } = await runSuccessfulPipeline({
    stage2HardConstraints,
    videoContextOverrides: {
      sourceUrl: "https://example.com/spider-sign",
      title: "Caleb's Spider-Sense is tingling too hard",
      description: "A fan asks Caleb to do the Spider-Man sign at a photo wall and he hesitates before matching her.",
      transcript: "",
      frameDescriptions: [
        "photo-op wall with Stranger Fan Meet and PeopleCon branding",
        "fan in white throws a Spider-Man hand sign",
        "Caleb pauses, then loosens up and mirrors the pose"
      ],
      userInstruction: "Keep it simple, social, and meme-native."
    },
    comments: [
      { author: "viewer_1", likes: 188, text: "He needs to be miles morales. Hes the only one" },
      { author: "viewer_2", likes: 20, text: "Yo this is miles morales!!" },
      { author: "viewer_3", likes: 7, text: "Read his lips \"Right now I can't.\"" }
    ],
    analyzerResponse: {
      comment_vibe: "playful approving rumor talk",
      comment_consensus_lane: "People keep reading the pause as actor caution plus fan-service.",
      comment_joke_lane: "Joke lane keeps saying miles morales and right now I can't.",
      slang_to_adapt: ["miles morales", "right now I can't"],
      comment_language_cues: ["miles morales", "right now I can't"],
      hidden_detail: "The room only needs one tiny pause to start treating the moment like soft confirmation bait."
    },
    writerCandidates,
    rewrittenCandidates: writerCandidates,
    criticResponse,
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_1",
      rationale: "cand_1 feels the most polished."
    }
  });

  assert.equal(result.output.pipeline.finalSelector?.finalPickCandidateId, "cand_2");
});

test("selector normalization keeps the primary angle inside ranked angles and mirrors it into diagnostics", async () => {
  const { result } = await runSuccessfulPipeline({
    selectorResponse: {
      primary_angle: "insider_expertise",
      secondary_angles: ["competence_process", "tension_danger"],
      ranked_angles: [
        { angle: "tension_danger", score: 9.3, why: "Visible strain or risk is the clearest framing." },
        { angle: "warmth_reverence", score: 8.7, why: "Respect and timing." },
        { angle: "competence_process", score: 8.1, why: "Concrete process matters." }
      ]
    }
  });

  assert.equal(result.output.pipeline.selectorOutput.primaryAngle, "insider_expertise");
  assert.ok(
    result.output.pipeline.selectorOutput.rankedAngles.some((item) => item.angle === "insider_expertise")
  );
  assert.equal(result.diagnostics.selection.primaryAngle, "insider_expertise");
  assert.ok(result.diagnostics.selection.secondaryAngles.includes("competence_process"));
});

test("caption options retain candidate ids, angles, and pass final constraint checks", async () => {
  const traceLikeConstraints: Stage2HardConstraints = {
    topLengthMin: 140,
    topLengthMax: 210,
    bottomLengthMin: 100,
    bottomLengthMax: 180,
    bannedWords: [],
    bannedOpeners: []
  };
  const writerCandidates = [
    {
      candidate_id: "cand_1",
      angle: "payoff_reveal",
      top: "That hourglass bite in the trunk is the whole story: this beaver gnaws, pauses with his snout against the wood, then walks off like he's heard enough to trust what happens next.",
      bottom:
        "\"Nah, it's committed.\" He leaves with the same energy as a veteran who knows standing there any longer is how you end up in the accident report.",
      top_ru: "ru 1",
      bottom_ru: "ru 1",
      rationale: "valid base"
    },
    {
      candidate_id: "cand_2",
      angle: "shared_experience",
      top: "This beaver has already chewed the standing trunk into a skinny hourglass, plants a paw, checks the bite, then waddles off like the part where the tree stays upright is no longer his problem.",
      bottom:
        "\"Yep, that's cut enough.\" He clocks out with the calm of a guy who heard one tiny crack and decided the next sound should happen from farther away.",
      top_ru: "ru 2",
      bottom_ru: "ru 2",
      rationale: "needs top trim"
    },
    {
      candidate_id: "cand_3",
      angle: "competence_process",
      top: "A chunky beaver is buried into a tree-sized trunk that's pinched to a narrow waist, then suddenly pulls back and leaves like he knows the wood is doing the rest of the work now.",
      bottom:
        "\"My work here is done.\" That's not a cute animal exit, that's a foreman leaving before the whole thing starts moving on its own. Everyone watching knows the safe distance matters now.",
      top_ru: "ru 3",
      bottom_ru: "ru 3",
      rationale: "needs bottom trim"
    },
    {
      candidate_id: "cand_4",
      angle: "tension_danger",
      top: "You can tell this beaver isn't guessing because that trunk is chewed down to a neck, and the second he stops pressing his face into it he heads out like the danger part just changed shifts.",
      bottom:
        "\"I've done my cut, the rest is gravity.\" That little turn-away has the exact confidence of somebody who knows the collapse is no longer a discussion.",
      top_ru: "ru 4",
      bottom_ru: "ru 4",
      rationale: "needs top trim"
    },
    {
      candidate_id: "cand_5",
      angle: "absurdity_chaos",
      top: "The funny part is this beaver looks calm, but that tree trunk is chewed so thin in the middle that every second he stays there feels like he's standing under his own falling sign.",
      bottom:
        "\"That's future me's problem.\" The waddle is hilarious until you realize he may have just left the blast zone before the audience even noticed one existed.",
      top_ru: "ru 5",
      bottom_ru: "ru 5",
      rationale: "needs bottom trim"
    },
    {
      candidate_id: "cand_6",
      angle: "payoff_reveal",
      top: "This little pause only works because the trunk is already almost gone, and the whole frame reads like the tree has more momentum left in it than the beaver does.",
      bottom:
        "\"He heard the crack.\" Everybody watching can feel why he leaves before the audience catches up.",
      top_ru: "ru 6",
      bottom_ru: "ru 6",
      rationale: "valid reserve"
    },
    {
      candidate_id: "cand_7",
      angle: "shared_experience",
      top: "The trunk is already pinched down to a waist, so when the beaver backs off the whole frame feels like everybody watching just realized the fall is no longer a theory.",
      bottom:
        "\"Yeah, that's already gone.\" The little walk-off lands because every person watching can feel why staying there any longer is how you end up under the thing.",
      top_ru: "ru 7",
      bottom_ru: "ru 7",
      rationale: "extra reserve"
    },
    {
      candidate_id: "cand_8",
      angle: "competence_process",
      top: "Once the trunk is chewed down to that skinny middle, the beaver's tiny step back reads like the exact moment the job stops being about teeth and starts being about gravity.",
      bottom:
        "\"He already did the hard part.\" The funny thing is the exit only works because the whole audience instantly understands the danger changed hands.",
      top_ru: "ru 8",
      bottom_ru: "ru 8",
      rationale: "extra reserve"
    }
  ];

  const { result } = await runSuccessfulPipeline({
    stage2HardConstraints: traceLikeConstraints,
    writerCandidates,
    rewrittenCandidates: writerCandidates
  });

  assert.equal(result.output.captionOptions.length, 5);
  for (const option of result.output.captionOptions) {
    assert.ok(option.candidateId);
    assert.ok(option.angle);
    assert.ok(option.constraintCheck?.passed);
    assert.equal(option.top.length >= traceLikeConstraints.topLengthMin, true);
    assert.equal(option.top.length <= traceLikeConstraints.topLengthMax, true);
    assert.equal(option.bottom.length >= traceLikeConstraints.bottomLengthMin, true);
    assert.equal(option.bottom.length <= traceLikeConstraints.bottomLengthMax, true);
  }
  assertFinalShortlistContract(result);
});

test("constraint repair keeps complete sentences instead of chopped endings", async () => {
  const constraints: Stage2HardConstraints = {
    topLengthMin: 24,
    topLengthMax: 70,
    bottomLengthMin: 24,
    bottomLengthMax: 70,
    bannedWords: [],
    bannedOpeners: []
  };
  const candidates = [
    {
      candidate_id: "cand_1",
      angle: "payoff_reveal",
      top: "The axle is already bent before the rut. The whole frame tells you exactly why the driver should stop right now.",
      bottom: "\"Yep, that's already cooked for good.\" Everybody watching already knows the last shove is a bad idea.",
      top_ru: "ru 1",
      bottom_ru: "ru 1",
      rationale: "trace-like repair case"
    },
    ...Array.from({ length: 7 }, (_, index) => makeCandidate(`cand_${index + 2}`, "shared_experience", index + 2))
  ];

  const { result } = await runSuccessfulPipeline({
    stage2HardConstraints: constraints,
    writerCandidates: candidates,
    rewrittenCandidates: candidates
  });

  const repaired = result.output.captionOptions.find((option) => option.candidateId === "cand_1");
  if (repaired) {
    assert.equal(repaired.top, "The axle is already bent before the rut.");
    assert.equal(repaired.bottom, "\"Yep, that's already cooked for good.\"");
    assert.ok(repaired.constraintCheck?.passed);
    assert.equal(repaired.constraintCheck?.repaired, true);
  } else {
    assert.ok(!result.output.captionOptions.some((option) => option.candidateId === "cand_1"));
    assert.ok(
      result.output.captionOptions.every(
        (option) =>
          !option.top.endsWith("why the.") &&
          !option.top.endsWith("everybody.") &&
          !option.top.endsWith("stop being.")
      )
    );
  }
});

test("unrecoverable broken captions are filtered out of the final shortlist", async () => {
  const constraints: Stage2HardConstraints = {
    topLengthMin: 10,
    topLengthMax: 40,
    bottomLengthMin: 10,
    bottomLengthMax: 40,
    bannedWords: [],
    bannedOpeners: []
  };
  const candidates = [
    {
      candidate_id: "cand_1",
      angle: "payoff_reveal",
      top: "The whole frame",
      bottom: "\"Still good.\"",
      top_ru: "ru 1",
      bottom_ru: "ru 1",
      rationale: "broken top"
    },
    {
      candidate_id: "cand_2",
      angle: "shared_experience",
      top: "This part still reads clean enough.",
      bottom: "Everybody",
      top_ru: "ru 2",
      bottom_ru: "ru 2",
      rationale: "broken bottom"
    },
    {
      candidate_id: "cand_3",
      angle: "competence_process",
      top: "The axle folds and the whole crowd sees it.",
      bottom: "\"Yeah, that ended it.\"",
      top_ru: "ru 3",
      bottom_ru: "ru 3",
      rationale: "valid reserve"
    },
    ...Array.from({ length: 5 }, (_, index) => makeCandidate(`cand_${index + 4}`, "payoff_reveal", index + 4))
  ];

  const { result } = await runSuccessfulPipeline({
    stage2HardConstraints: constraints,
    writerCandidates: candidates,
    rewrittenCandidates: candidates,
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_3",
      rationale: "Prefer the clean reserves when the broken ones do not survive."
    }
  });

  assert.ok(!result.output.captionOptions.some((option) => option.candidateId === "cand_1"));
  assert.ok(!result.output.captionOptions.some((option) => option.candidateId === "cand_2"));
  assertFinalShortlistContract(result);
  assert.equal(result.output.captionOptions.length, 5);
  assert.ok(
    result.output.captionOptions.every(
      (option) =>
        !option.top.endsWith("The whole frame") &&
        !option.bottom.endsWith("Everybody") &&
        !option.bottom.endsWith("for everybody") &&
        !option.bottom.endsWith("do combat")
    )
  );
});

test("repair trims current trace-style broken endings instead of leaving chopped tops", async () => {
  const constraints: Stage2HardConstraints = {
    topLengthMin: 170,
    topLengthMax: 185,
    bottomLengthMin: 140,
    bottomLengthMax: 150,
    bannedWords: [],
    bannedOpeners: []
  };
  const traceLikeCandidates = [
    {
      candidate_id: "cand_1",
      angle: "shared_experience",
      top: "A trainee steps out of the green jump tower like it's finally his big airborne moment, then the suspension lines snap tight and turn that clean exit into a harness lesson everybody watching already remembers in their hips and lower back.",
      bottom: "\"Every airborne guy just crossed his legs.\" The tower looks cool for one second, then the harness gives him the part of jump school nobody forgets.",
      top_ru: "ru 1",
      bottom_ru: "ru 1",
      rationale: "trace-like everybody case"
    },
    {
      candidate_id: "cand_2",
      angle: "payoff_reveal",
      top: "That green tower doorway gives you exactly one second to think he's just stepping out clean, then the suspension lines yank the whole scene into a brutal little explanation of why the whole lesson lands in body memory instead of words.",
      bottom: "\"There it is, the reason everybody suddenly walks bowlegged.\" No speech needed, the harness translates the lesson straight into body language.",
      top_ru: "ru 2",
      bottom_ru: "ru 2",
      rationale: "trace-like why the case"
    },
    {
      candidate_id: "cand_3",
      angle: "tension_danger",
      top: "This is why the clip works so well on mute: the trainee leaves the green tower and your brain immediately starts calculating the exact moment that harness is going to stop being theory and start feeling like paperwork in his spine.",
      bottom: "\"That line system is about to become extremely persuasive.\" No explosion, no crash, just one sharp reminder that gravity always brings paperwork.",
      top_ru: "ru 3",
      bottom_ru: "ru 3",
      rationale: "trace-like stop being case"
    },
    {
      candidate_id: "cand_4",
      angle: "shared_experience",
      top: "A trainee steps out of the green jump tower like it's finally his big airborne moment, then the suspension lines snap tight and turn that clean exit into a harness lesson everybody watching already remembers in their hips and lower back.",
      bottom: "\"Every airborne guy just crossed his legs.\" The tower looks cool for one second, then the harness gives him the part of jump school nobody forgets.",
      top_ru: "ru 4",
      bottom_ru: "ru 4",
      rationale: "trace-like everybody reserve"
    },
    {
      candidate_id: "cand_5",
      angle: "payoff_reveal",
      top: "That green tower doorway gives you exactly one second to think he's just stepping out clean, then the suspension lines yank the whole scene into a brutal little explanation of why the whole lesson lands in body memory instead of words.",
      bottom: "\"There it is, the reason everybody suddenly walks bowlegged.\" No speech needed, the harness translates the lesson straight into body language.",
      top_ru: "ru 5",
      bottom_ru: "ru 5",
      rationale: "trace-like why the reserve"
    },
    {
      candidate_id: "cand_6",
      angle: "tension_danger",
      top: "This is why the clip works so well on mute: the trainee leaves the green tower and your brain immediately starts calculating the exact moment that harness is going to stop being theory and start feeling like paperwork in his spine.",
      bottom: "\"That line system is about to become extremely persuasive.\" No explosion, no crash, just one sharp reminder that gravity always brings paperwork.",
      top_ru: "ru 6",
      bottom_ru: "ru 6",
      rationale: "trace-like stop being reserve"
    }
  ];

  const { result } = await runSuccessfulPipeline({
    stage2HardConstraints: constraints,
    writerCandidates: traceLikeCandidates,
    rewrittenCandidates: traceLikeCandidates
  });

  for (const option of result.output.captionOptions) {
    assert.ok(option.constraintCheck?.passed);
    assert.doesNotMatch(option.top, /everybody\.$/);
    assert.doesNotMatch(option.top, /why the\.$/);
    assert.doesNotMatch(option.top, /stop being\.$/);
  }
});

test("rewriter telemetry truthfully reports reserve finalists when critic-approved pool is too narrow", async () => {
  const writerCandidates = Array.from({ length: 8 }, (_, index) =>
    makeCandidate(`cand_${index + 1}`, index < 4 ? "shared_experience" : "payoff_reveal", index + 1)
  );
  const criticResponse = writerCandidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    scores: makeCriticScoreMap(index),
    total: 9 - index * 0.2,
    issues: [],
    keep: candidate.candidate_id === "cand_4"
  }));
  const noisyRewriterResponse = writerCandidates.map((candidate, index) => ({
    ...candidate,
    top: makeCandidate(candidate.candidate_id, candidate.angle, index + 1).top,
    bottom: makeCandidate(candidate.candidate_id, candidate.angle, index + 1).bottom,
    top_ru: makeCandidate(candidate.candidate_id, candidate.angle, index + 1).top_ru,
    bottom_ru: makeCandidate(candidate.candidate_id, candidate.angle, index + 1).bottom_ru
  }));

  const { result, progressEvents } = await runSuccessfulPipeline({
    writerCandidates,
    criticResponse,
    rewriterResponse: noisyRewriterResponse
  });

  const criticEvent = progressEvents.find((event) => event.stageId === "critic" && event.state === "completed");
  const rewriterEvent = progressEvents.find((event) => event.stageId === "rewriter" && event.state === "completed");
  const visibleIds = result.output.captionOptions.map((option) => option.candidateId);

  assertFinalShortlistContract(result);
  assert.equal(criticEvent?.detail, "1 candidates kept for rewrite.");
  assert.equal(
    rewriterEvent?.detail,
    "5 finalists sent to rewrite (1 critic-approved + 4 reserve), 5 usable rewrites applied."
  );
  assert.equal(
    result.output.pipeline.finalSelector?.rationaleInternalRaw,
    `Final selector evaluated ${visibleIds.length} shortlist candidates: ${visibleIds.join(", ")}. ` +
      `Final visible shortlist is ${visibleIds.join(", ")} with cand_2 as the final pick. ` +
      "Visible angles: shared_experience, payoff_reveal."
  );
  assert.ok(visibleIds.includes("cand_2"));
});

test("rewriter reserve finalists can rescue a shortlist when only one critic-approved candidate exists", async () => {
  const stage2HardConstraints: Stage2HardConstraints = {
    ...DEFAULT_STAGE2_HARD_CONSTRAINTS
  };
  const writerCandidates = Array.from({ length: 8 }, (_, index) => ({
    candidate_id: `cand_${index + 1}`,
    angle: index % 2 === 0 ? "shared_experience" : "payoff_reveal",
    top:
      index === 0
        ? "The landing already looks wrong before the whole axle gives up in plain view."
        : `Too short ${index + 1}`,
    bottom:
      index === 0
        ? "\"Yeah, that's cooked.\" The whole landing tells the crowd the repair bill is already locked in."
        : `"Short ${index + 1}."`,
    top_ru: `ru ${index + 1}`,
    bottom_ru: `ru ${index + 1}`,
    rationale: `candidate ${index + 1}`
  }));
  const criticResponse = writerCandidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    scores: makeCriticScoreMap(index),
    total: 9 - index * 0.2,
    issues: [],
    keep: candidate.candidate_id === "cand_1"
  }));
  const rewriterResponse = Array.from({ length: 5 }, (_, index) =>
    makeCandidate(
      `cand_${index + 1}`,
      index % 2 === 0 ? "shared_experience" : "payoff_reveal",
      index + 1
    )
  );

  const { result, progressEvents } = await runSuccessfulPipeline({
    stage2HardConstraints,
    writerCandidates,
    criticResponse,
    rewriterResponse
  });

  assertFinalShortlistContract(result);
  assert.equal(
    progressEvents.find((event) => event.stageId === "rewriter" && event.state === "completed")?.detail,
    "5 finalists sent to rewrite (1 critic-approved + 4 reserve), 5 usable rewrites applied."
  );
  assert.equal(result.output.captionOptions.length, 5);
  assert.ok(result.output.captionOptions.every((option) => option.constraintCheck?.passed));
  assert.deepEqual(
    result.output.captionOptions.map((option) => option.candidateId),
    ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"]
  );
});

test("strict-length channels widen the rewriter reserve pool beyond the critic-approved finalists", async () => {
  const stage2HardConstraints: Stage2HardConstraints = {
    topLengthMin: 160,
    topLengthMax: 180,
    bottomLengthMin: 140,
    bottomLengthMax: 150,
    bannedWords: ["clip"],
    bannedOpeners: []
  };
  const writerCandidates = Array.from({ length: 20 }, (_, index) =>
    makeCandidate(`cand_${index + 1}`, index % 2 === 0 ? "shared_experience" : "payoff_reveal", index + 1)
  );
  const criticResponse = writerCandidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    scores: makeCriticScoreMap(index),
    total: 9 - index * 0.1,
    issues: [],
    keep: index < 7
  }));
  const rewriterResponse = Array.from({ length: 12 }, (_, index) => ({
    candidate_id: `cand_${index + 1}`,
    angle: index % 2 === 0 ? "shared_experience" : "payoff_reveal",
    top:
      "The crew keeps the whole lift steady while the load swings just enough to show who actually trusts the rig and who is only pretending to stay calm under pressure.",
    bottom:
      "\"That is old-school control,\" and the reaction lands because nobody in frame has spare room for sloppy work once the weight starts drifting sideways.",
    top_ru: `ru ${index + 1}`,
    bottom_ru: `ru ${index + 1}`,
    rationale: `strict rewrite ${index + 1}`
  }));

  const { result, progressEvents } = await runSuccessfulPipeline({
    stage2HardConstraints,
    writerCandidates,
    criticResponse,
    rewriterResponse,
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_1",
      rationale: "cand_1 is strongest."
    }
  });

  assertFinalShortlistContract(result);
  assert.equal(
    progressEvents.find((event) => event.stageId === "rewriter" && event.state === "completed")?.detail,
    "12 finalists sent to rewrite (7 critic-approved + 5 reserve), 12 usable rewrites applied."
  );
});

test("rewriter prompt includes every strict-length finalist kept in the expanded rewrite pool", async () => {
  const stage2HardConstraints: Stage2HardConstraints = {
    topLengthMin: 160,
    topLengthMax: 180,
    bottomLengthMin: 140,
    bottomLengthMax: 150,
    bannedWords: ["clip"],
    bannedOpeners: []
  };
  const writerCandidates = Array.from({ length: 20 }, (_, index) =>
    makeCandidate(`cand_${index + 1}`, index % 2 === 0 ? "shared_experience" : "payoff_reveal", index + 1)
  );
  const criticResponse = writerCandidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    scores: makeCriticScoreMap(index),
    total: 9 - index * 0.1,
    issues: [],
    keep: index < 7
  }));
  const rewriterResponse = Array.from({ length: 12 }, (_, index) => ({
    candidate_id: `cand_${index + 1}`,
    angle: index % 2 === 0 ? "shared_experience" : "payoff_reveal",
    top:
      "The crew keeps the whole lift steady while the load swings just enough to show who actually trusts the rig and who is only pretending to stay calm under pressure.",
    bottom:
      "\"That is old-school control,\" and the reaction lands because nobody in frame has spare room for sloppy work once the weight starts drifting sideways.",
    top_ru: `ru ${index + 1}`,
    bottom_ru: `ru ${index + 1}`,
    rationale: `strict rewrite ${index + 1}`
  }));

  const { executor } = await runSuccessfulPipeline({
    stage2HardConstraints,
    writerCandidates,
    criticResponse,
    rewriterResponse,
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_1",
      rationale: "cand_1 is strongest."
    }
  });

  const rewriterPrompt = executor.calls[4]?.prompt ?? "";
  assert.equal((rewriterPrompt.match(/"topRu":/g) ?? []).length, 12);
  assert.equal((rewriterPrompt.match(/"keep":/g) ?? []).length, 12);
  assert.match(rewriterPrompt, /"candidateId": "cand_12"/);
});

test("internal final selector rationale is rebuilt from the actual evaluated pool and visible shortlist", async () => {
  const narrowWriterCandidates = [
    makeCandidate("cand_1", "shared_experience", 1),
    makeCandidate("cand_2", "shared_experience", 2),
    makeCandidate("cand_3", "payoff_reveal", 3),
    makeCandidate("cand_4", "payoff_reveal", 4),
    makeCandidate("cand_5", "tension_danger", 5)
  ];

  const { result } = await runSuccessfulPipeline({
    writerCandidates: narrowWriterCandidates,
    rewrittenCandidates: narrowWriterCandidates,
    finalSelectorResponse: {
      final_candidates: ["cand_4", "cand_1", "cand_3", "cand_5", "cand_2"],
      final_pick: "cand_4",
      rationale:
        "Only one unique candidate appears in the provided pool, and c04 is publishable."
    }
  });

  assert.equal(
    result.output.pipeline.finalSelector?.rationaleInternalRaw,
    "Final selector evaluated 5 shortlist candidates: cand_4, cand_1, cand_3, cand_5, cand_2. Final visible shortlist is cand_4, cand_1, cand_3, cand_5, cand_2 with cand_4 as the final pick. Visible angles: payoff_reveal, shared_experience, tension_danger."
  );
  assert.match(
    result.output.pipeline.finalSelector?.rationaleInternalModelRaw ?? "",
    /^Sanitized because the model rationale contradicted the persisted shortlist\./
  );
  assert.doesNotMatch(
    result.output.pipeline.finalSelector?.rationaleInternalModelRaw ?? "",
    /\bc04\b/i
  );
  assert.match(
    result.output.pipeline.finalSelector?.rationaleInternalModelRaw ?? "",
    /\bcand_4\b/
  );
  assert.match(result.output.finalPick.reason, /^option 1 is the strongest visible pick/i);
});

test("stage 2 fails explicitly when shortlist recovery still cannot produce 5 valid options", async () => {
  const writerCandidates = [
    makeCandidate("c17", "shared_experience", 17),
    makeCandidate("c01", "absurdity_chaos", 1),
    makeCandidate("c11", "payoff_reveal", 11),
    {
      ...makeCandidate("c02", "shared_experience", 2),
      top: "forbidden top that should never survive"
    },
    {
      ...makeCandidate("c05", "competence_process", 5),
      top: "forbidden top that should never survive"
    },
    {
      ...makeCandidate("c08", "tension_danger", 8),
      top: "forbidden top that should never survive"
    },
    {
      ...makeCandidate("c14", "absurdity_chaos", 14),
      top: "forbidden top that should never survive"
    }
  ];
  const criticResponse = writerCandidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    scores: makeCriticScoreMap(index),
    total: 10 - index * 0.25,
    issues: [],
    keep: true
  }));

  await assert.rejects(
    runSuccessfulPipeline({
      stage2HardConstraints: {
        ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
        bannedWords: ["forbidden"]
      },
      writerCandidates,
      rewrittenCandidates: writerCandidates,
      criticResponse,
      finalSelectorResponse: {
        final_candidates: ["c02", "c05", "c08", "c14"],
        final_pick: "c05",
        rationale: "I compared c02, c05, c08, and c14 before trying to pick c05."
      }
    }),
    /Stage 2 final shortlist could not produce 5 valid options after constraint-safe repair and reserve backfill\./
  );
});

test("stage 2 cannot complete successfully with an empty visible shortlist", async () => {
  const invalidWriterCandidates = Array.from({ length: 7 }, (_, index) => ({
    ...makeCandidate(`x${index + 1}`, index % 2 === 0 ? "awe_scale" : "shared_experience", index + 1),
    top: "forbidden top that should never survive",
    bottom: "forbidden bottom that should never survive"
  }));

  await assert.rejects(
    runSuccessfulPipeline({
      stage2HardConstraints: {
        ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
        bannedWords: ["forbidden"]
      },
      writerCandidates: invalidWriterCandidates,
      rewrittenCandidates: invalidWriterCandidates,
      finalSelectorResponse: {
        final_candidates: ["x1", "x2", "x3", "x4", "x5"],
        final_pick: "x3",
        rationale: "x3 is still the strongest editorial read."
      }
    }),
    /Only 0\/5 visible option\(s\) remained/
  );
});

test("stage 2 to stage 3 handoff summary explains whether text comes from selection or overrides", () => {
  const stage2 = makeRuntimeStage2Response("run_handoff", "handoff");
  const latestVersion: Stage3Version = {
    versionNo: 1,
    runId: "version_1",
    createdAt: nowIso(),
    prompt: "Keep the crop steady.",
    baseline: {
      topText: "baseline top",
      bottomText: "baseline bottom",
      captionHighlights: { top: [], bottom: [] },
      clipStartSec: 0,
      clipDurationSec: 6,
      focusY: 0.5,
      renderPlan: {} as any,
      sourceDurationSec: null,
      textFit: {} as any
    },
    final: {
      topText: "latest version top",
      bottomText: "latest version bottom",
      captionHighlights: { top: [], bottom: [] },
      clipStartSec: 1,
      clipDurationSec: 6,
      focusY: 0.42,
      renderPlan: {} as any,
      sourceDurationSec: null,
      textFit: {} as any
    },
    diff: {
      textChanged: true,
      framingChanged: false,
      timingChanged: false,
      segmentsChanged: false,
      audioChanged: false,
      summary: ["Updated text."]
    },
    internalPasses: [],
    recommendedPass: 1
  };

  const handoff = buildStage2ToStage3HandoffSummary({
    stage2,
    draft: {
      id: "draft_1",
      threadId: "chat_1",
      userId: "user_1",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastOpenStep: 3,
      stage2: {
        instruction: "",
        selectedCaptionOption: 3,
        selectedTitleOption: 2
      },
      stage3: {
        topText: "manual top override",
        bottomText: null,
        captionHighlights: null,
        clipStartSec: null,
        focusY: null,
        renderPlan: null,
        agentPrompt: "",
        selectedVersionId: null,
        passSelectionByVersion: {}
      }
    },
    latestVersion,
    selectedCaptionOption: 3,
    selectedTitleOption: 2
  });

  assert.equal(handoff.selectedCaptionOption, 3);
  assert.equal(handoff.selectedTitleOption, 2);
  assert.equal(handoff.topText, "manual top override");
  assert.equal(handoff.bottomText, "latest version bottom");
  assert.equal(handoff.topTextSource, "draft_override");
  assert.equal(handoff.bottomTextSource, "latest_version");
  assert.equal(handoff.hasManualTextOverride, true);
  assert.equal(handoff.canResetToSelectedCaption, true);
  assert.equal(handoff.hasStage3Overrides, true);
});

test("stage 2 to stage 3 handoff summary uses current live text when provided", () => {
  const stage2 = makeRuntimeStage2Response("run_live", "live");

  const handoff = buildStage2ToStage3HandoffSummary({
    stage2,
    draft: null,
    latestVersion: null,
    selectedCaptionOption: 1,
    selectedTitleOption: 1,
    currentTopText: "live manual top",
    currentBottomText: "\"live manual bottom\""
  });

  assert.equal(handoff.topText, "live manual top");
  assert.equal(handoff.bottomText, "\"live manual bottom\"");
  assert.equal(handoff.topTextSource, "draft_override");
  assert.equal(handoff.bottomTextSource, "draft_override");
  assert.equal(handoff.hasManualTextOverride, true);
  assert.equal(handoff.canResetToSelectedCaption, true);
});

test("applyStage2CaptionToStage3Text merges highlight metadata by block", () => {
  const applied = applyStage2CaptionToStage3Text({
    currentTopText: "Current top",
    currentBottomText: "Current bottom",
    currentCaptionHighlights: {
      top: [{ start: 0, end: 7, slotId: "slot2" }],
      bottom: [{ start: 8, end: 14, slotId: "slot3" }]
    },
    caption: {
      top: "Selected top",
      bottom: "Selected bottom",
      highlights: {
        top: [{ start: 0, end: 8, slotId: "slot1" }],
        bottom: [{ start: 9, end: 15, slotId: "slot1" }]
      }
    },
    mode: "top"
  });

  assert.equal(applied.topText, "Selected top");
  assert.equal(applied.bottomText, "Current bottom");
  assert.deepEqual(applied.captionHighlights.top, [{ start: 0, end: 8, slotId: "slot1" }]);
  assert.deepEqual(applied.captionHighlights.bottom, [{ start: 8, end: 14, slotId: "slot3" }]);
});

test("stage 2 to stage 3 handoff blocks an invalid selected caption instead of leaking it downstream", () => {
  const stage2 = makeRuntimeStage2Response("run_invalid_handoff", "invalid");
  stage2.output.finalPick.option = 1;
  stage2.output.captionOptions[0] = {
    ...stage2.output.captionOptions[0],
    constraintCheck: {
      passed: false,
      repaired: false,
      topLength: 170,
      bottomLength: 455,
      issues: ["BOTTOM length is 455, expected 140-150."]
    }
  };

  const handoff = buildStage2ToStage3HandoffSummary({
    stage2,
    draft: null,
    latestVersion: null,
    selectedCaptionOption: 1,
    selectedTitleOption: 1
  });

  assert.equal(handoff.caption, null);
  assert.equal(handoff.selectedCaptionOption, null);
  assert.equal(handoff.captionBlockedReason, "selected_stage2_caption_failed_hard_constraints");
  assert.equal(handoff.topText, null);
  assert.equal(handoff.bottomText, null);
});

test("caption apply helper supports taking all, top only, or bottom only", () => {
  const caption = {
    top: "Picked top",
    bottom: "\"Picked bottom\""
  };

  assert.deepEqual(
    applyStage2CaptionToStage3Text({
      currentTopText: "Current top",
      currentBottomText: "\"Current bottom\"",
      caption,
      mode: "all"
    }),
    {
      topText: "Picked top",
      bottomText: "\"Picked bottom\"",
      captionHighlights: { top: [], bottom: [] }
    }
  );

  assert.deepEqual(
    applyStage2CaptionToStage3Text({
      currentTopText: "Current top",
      currentBottomText: "\"Current bottom\"",
      caption,
      mode: "top"
    }),
    {
      topText: "Picked top",
      bottomText: "\"Current bottom\"",
      captionHighlights: { top: [], bottom: [] }
    }
  );

  assert.deepEqual(
    applyStage2CaptionToStage3Text({
      currentTopText: "Current top",
      currentBottomText: "\"Current bottom\"",
      caption,
      mode: "bottom"
    }),
    {
      topText: "Current top",
      bottomText: "\"Picked bottom\"",
      captionHighlights: { top: [], bottom: [] }
    }
  );
});

test("stage 3 draft render-plan override strips channel-managed template fields", () => {
  const base = fallbackRenderPlan();
  const rawOverride = {
    ...base,
    templateId: "hedges-of-honor-v1",
    authorName: "Changed channel",
    authorHandle: "@changed",
    avatarAssetId: "avatar_1",
    avatarAssetMimeType: "image/png",
    videoZoom: 1.4,
    topFontScale: 1.6,
    musicAssetId: "music_2",
    musicAssetMimeType: "audio/mpeg"
  };

  assert.deepEqual(sanitizeStage3DraftRenderPlanOverride(rawOverride), {
    timingMode: base.timingMode,
    normalizeToTargetEnabled: base.normalizeToTargetEnabled,
    audioMode: base.audioMode,
    sourceAudioEnabled: base.sourceAudioEnabled,
    smoothSlowMo: base.smoothSlowMo,
    mirrorEnabled: base.mirrorEnabled,
    cameraMotion: base.cameraMotion,
    cameraKeyframes: base.cameraKeyframes,
    cameraPositionKeyframes: base.cameraPositionKeyframes,
    cameraScaleKeyframes: base.cameraScaleKeyframes,
    videoZoom: 1.4,
    topFontScale: 1.6,
    bottomFontScale: base.bottomFontScale,
    musicGain: base.musicGain,
    textPolicy: base.textPolicy,
    segments: base.segments,
    policy: base.policy,
    backgroundAssetId: base.backgroundAssetId,
    backgroundAssetMimeType: base.backgroundAssetMimeType,
    musicAssetId: "music_2",
    musicAssetMimeType: "audio/mpeg"
  });
});

test("stage 3 draft render-plan override persists only editable diffs and keeps new channel template", () => {
  const originalBase = normalizeRenderPlan(
    {
      ...fallbackRenderPlan(),
      templateId: "science-card-v1",
      authorName: "Science Snack",
      authorHandle: "@Science_Snack_1"
    },
    fallbackRenderPlan()
  );
  const current = normalizeRenderPlan(
    {
      ...originalBase,
      templateId: "hedges-of-honor-v1",
      videoZoom: 1.35,
      topFontScale: 1.55
    },
    fallbackRenderPlan()
  );

  const persistedOverride = buildStage3DraftRenderPlanOverride(current, originalBase);
  assert.deepEqual(persistedOverride, {
    videoZoom: 1.35,
    topFontScale: 1.35
  });

  const updatedChannelBase = normalizeRenderPlan(
    {
      ...fallbackRenderPlan(),
      templateId: "science-card-v7",
      avatarAssetId: "avatar_next",
      avatarAssetMimeType: "image/jpeg",
      backgroundAssetId: "background_next",
      backgroundAssetMimeType: "video/mp4",
      authorName: "Echoes Of Honor",
      authorHandle: "@EchoesOfHonor50"
    },
    fallbackRenderPlan()
  );

  const hydrated = hydrateStage3RenderPlanOverride(persistedOverride, updatedChannelBase);
  assert.equal(hydrated.templateId, "science-card-v7");
  assert.equal(hydrated.authorName, "Echoes Of Honor");
  assert.equal(hydrated.authorHandle, "@EchoesOfHonor50");
  assert.equal(hydrated.avatarAssetId, "avatar_next");
  assert.equal(hydrated.avatarAssetMimeType, "image/jpeg");
  assert.equal(hydrated.backgroundAssetId, "background_next");
  assert.equal(hydrated.backgroundAssetMimeType, "video/mp4");
  assert.equal(hydrated.videoZoom, 1.35);
  assert.equal(hydrated.topFontScale, 1.35);
});

test("stage 3 draft render-plan hydration keeps channel avatar while preserving explicit asset clears", () => {
  const channelBase = normalizeRenderPlan(
    {
      ...fallbackRenderPlan(),
      templateId: "science-card-v1",
      avatarAssetId: "avatar_live",
      avatarAssetMimeType: "image/jpeg",
      backgroundAssetId: "background_live",
      backgroundAssetMimeType: "video/mp4",
      musicAssetId: "music_live",
      musicAssetMimeType: "audio/mpeg",
      authorName: "Echoes Of Honor",
      authorHandle: "@EchoesOfHonor50"
    },
    fallbackRenderPlan()
  );

  const hydrated = hydrateStage3RenderPlanOverride(
    {
      sourceAudioEnabled: false,
      cameraMotion: "top_to_bottom",
      cameraKeyframes: [
        { id: "camera-a", timeSec: 0, focusY: 0.28, zoom: 1.12 },
        { id: "camera-b", timeSec: 6, focusY: 0.7, zoom: 1.3 }
      ],
      topFontScale: 0.99,
      bottomFontScale: 1.05,
      backgroundAssetId: "background_custom",
      musicAssetId: null,
      musicAssetMimeType: null
    },
    channelBase
  );

  assert.equal(hydrated.avatarAssetId, "avatar_live");
  assert.equal(hydrated.avatarAssetMimeType, "image/jpeg");
  assert.equal(hydrated.backgroundAssetId, "background_custom");
  assert.equal(hydrated.backgroundAssetMimeType, "video/mp4");
  assert.equal(hydrated.musicAssetId, null);
  assert.equal(hydrated.musicAssetMimeType, null);
  assert.equal(hydrated.sourceAudioEnabled, false);
  assert.equal(hydrated.cameraMotion, "top_to_bottom");
  assert.deepEqual(hydrated.cameraKeyframes, [
    { id: "camera-a", timeSec: 0, focusY: 0.28, zoom: 1.12 },
    { id: "camera-b", timeSec: 6, focusY: 0.7, zoom: 1.3 }
  ]);
  assert.deepEqual(hydrated.cameraPositionKeyframes, [
    { id: "camera-a", timeSec: 0, focusY: 0.28 },
    { id: "camera-b", timeSec: 6, focusY: 0.7 }
  ]);
  assert.deepEqual(hydrated.cameraScaleKeyframes, [
    { id: "camera-a", timeSec: 0, zoom: 1.12 },
    { id: "camera-b", timeSec: 6, zoom: 1.3 }
  ]);
  assert.equal(hydrated.topFontScale, 0.99);
  assert.equal(hydrated.bottomFontScale, 1.05);
});

test("legacy camera motion resolves into synthetic position keyframes without affecting scale", () => {
  const tracks = resolveStage3EffectiveCameraTracks({
    cameraKeyframes: [],
    cameraMotion: "top_to_bottom",
    clipDurationSec: 6,
    baseFocusY: 0.5,
    baseZoom: 1.2
  });

  assert.deepEqual(
    resolveStage3EffectiveCameraKeyframes({
      cameraKeyframes: [],
      cameraMotion: "top_to_bottom",
      clipDurationSec: 6,
      baseFocusY: 0.5,
      baseZoom: 1.2
    }),
    buildLegacyCameraKeyframes({
      cameraMotion: "top_to_bottom",
      clipDurationSec: 6,
      baseFocusY: 0.5,
      baseZoom: 1.2
    })
  );
  assert.equal(tracks.positionKeyframes.length, 2);
  assert.deepEqual(tracks.scaleKeyframes, []);
});

test("camera transform interpolation keeps position and scale independent with linear timing", () => {
  const positionKeyframes = [
    { id: "pos-a", timeSec: 1, focusY: 0.22 },
    { id: "pos-b", timeSec: 2, focusY: 0.22 },
    { id: "pos-c", timeSec: 4, focusY: 0.78 }
  ];
  const scaleKeyframes = [
    { id: "scale-a", timeSec: 1, zoom: 1 },
    { id: "scale-b", timeSec: 2, zoom: 1.28 }
  ];

  const beforeFirst = resolveCameraStateAtTime({
    timeSec: 0.5,
    cameraPositionKeyframes: positionKeyframes,
    cameraScaleKeyframes: scaleKeyframes,
    cameraMotion: "disabled",
    clipDurationSec: 6,
    baseFocusY: 0.5,
    baseZoom: 1
  });
  const duringScaleMove = resolveCameraStateAtTime({
    timeSec: 1.5,
    cameraPositionKeyframes: positionKeyframes,
    cameraScaleKeyframes: scaleKeyframes,
    cameraMotion: "disabled",
    clipDurationSec: 6,
    baseFocusY: 0.5,
    baseZoom: 1
  });
  const duringPositionMove = resolveCameraStateAtTime({
    timeSec: 2.5,
    cameraPositionKeyframes: positionKeyframes,
    cameraScaleKeyframes: scaleKeyframes,
    cameraMotion: "disabled",
    clipDurationSec: 6,
    baseFocusY: 0.5,
    baseZoom: 1
  });
  const afterLast = resolveCameraStateAtTime({
    timeSec: 5.2,
    cameraPositionKeyframes: positionKeyframes,
    cameraScaleKeyframes: scaleKeyframes,
    cameraMotion: "disabled",
    clipDurationSec: 6,
    baseFocusY: 0.5,
    baseZoom: 1
  });

  assert.equal(beforeFirst.focusY, 0.5);
  assert.equal(beforeFirst.zoom, 1);
  assert.equal(duringScaleMove.focusY, 0.22);
  assert.equal(duringScaleMove.zoom, 1.14);
  assert.equal(duringPositionMove.focusY, 0.36);
  assert.equal(duringPositionMove.zoom, 1.28);
  assert.equal(afterLast.focusY, 0.78);
  assert.equal(afterLast.zoom, 1.28);
});

test("combined legacy camera keyframes still resolve for compatibility", () => {
  const keyframes = resolveStage3EffectiveCameraKeyframes({
    cameraKeyframes: [],
    cameraMotion: "top_to_bottom",
    clipDurationSec: 6,
    baseFocusY: 0.5,
    baseZoom: 1.2
  });

  assert.deepEqual(keyframes, buildLegacyCameraKeyframes({
    cameraMotion: "top_to_bottom",
    clipDurationSec: 6,
    baseFocusY: 0.5,
    baseZoom: 1.2
  }));
});

test("normalizeChatDraft removes legacy template id from stage 3 render-plan override", () => {
  const draft = normalizeChatDraft({
    id: "draft_1",
    threadId: "chat_1",
    userId: "user_1",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastOpenStep: 3,
    stage2: {
      instruction: "",
      selectedCaptionOption: null,
      selectedTitleOption: null
    },
    stage3: {
      topText: null,
      bottomText: null,
      clipStartSec: null,
      focusY: null,
      renderPlan: {
        ...fallbackRenderPlan(),
        templateId: "hedges-of-honor-v1",
        authorName: "Legacy channel",
        authorHandle: "@legacy",
        videoZoom: 1.2
      },
      agentPrompt: "",
      selectedVersionId: null,
      passSelectionByVersion: {}
    }
  });

  assert.ok(draft);
  assert.deepEqual(draft?.stage3.renderPlan, {
    timingMode: "auto",
    normalizeToTargetEnabled: false,
    audioMode: "source_only",
    sourceAudioEnabled: true,
    smoothSlowMo: false,
    mirrorEnabled: true,
    cameraMotion: "disabled",
    cameraKeyframes: [],
    cameraPositionKeyframes: [],
    cameraScaleKeyframes: [],
    videoZoom: 1.2,
    topFontScale: fallbackRenderPlan().topFontScale,
    bottomFontScale: fallbackRenderPlan().bottomFontScale,
    musicGain: fallbackRenderPlan().musicGain,
    textPolicy: fallbackRenderPlan().textPolicy,
    segments: [],
    policy: fallbackRenderPlan().policy,
    backgroundAssetId: null,
    backgroundAssetMimeType: null,
    musicAssetId: null,
    musicAssetMimeType: null
  });
});

test("science-card-v7 uses the repo-backed spec and matches science-card geometry", () => {
  const baseSpec = getTemplateFigmaSpec("science-card-v1");
  const v7Spec = getTemplateFigmaSpec("science-card-v7");

  assert.equal(v7Spec.source, "generated");
  assert.deepEqual(v7Spec.shell, {
    x: 0,
    y: 0,
    width: 1080,
    height: 1920,
    radius: 0,
    background: "#177FA6"
  });
  assert.equal(v7Spec.card.borderColor, "#000000");
  assert.deepEqual(v7Spec.card.x, baseSpec.card.x);
  assert.deepEqual(v7Spec.card.y, baseSpec.card.y);
  assert.deepEqual(v7Spec.card.width, baseSpec.card.width);
  assert.deepEqual(v7Spec.card.height, baseSpec.card.height);
  assert.deepEqual(v7Spec.sections.top, baseSpec.sections.top);
  assert.deepEqual(v7Spec.sections.media, baseSpec.sections.media);
  assert.deepEqual(v7Spec.sections.bottom, baseSpec.sections.bottom);
  assert.deepEqual(v7Spec.sections.author, baseSpec.sections.author);
  assert.deepEqual(v7Spec.sections.avatar, baseSpec.sections.avatar);
  assert.deepEqual(v7Spec.sections.bottomText, baseSpec.sections.bottomText);
});

test("american-news uses a dark gold news shell with source-friendly background behavior", () => {
  const config = getTemplateById(AMERICAN_NEWS_TEMPLATE_ID);
  const spec = getTemplateFigmaSpec(AMERICAN_NEWS_TEMPLATE_ID);
  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: AMERICAN_NEWS_TEMPLATE_ID,
      content: {
        topText: "Top",
        bottomText: "Bottom",
        channelName: "American News",
        channelHandle: "@amnnews9",
        highlights: { top: [], bottom: [] },
        topFontScale: 1,
        bottomFontScale: 1,
        previewScale: 1,
        mediaAsset: null,
        backgroundAsset: null,
        avatarAsset: null
      }
    })
  );

  assert.equal(getTemplateVariant(AMERICAN_NEWS_TEMPLATE_ID).label, "American News");
  assert.equal(templateUsesBuiltInBackdropFromRegistry(AMERICAN_NEWS_TEMPLATE_ID), false);
  assert.equal(spec.source, "generated");
  assert.equal(config.card.radius, 0);
  assert.equal(spec.card.radius, 0);
  assert.equal(config.card.borderWidth, 4);
  assert.equal(spec.card.borderWidth, 4);
  assert.equal(config.card.borderColor, "#f3b31f");
  assert.equal(spec.card.borderColor, "#f3b31f");
  assert.equal(config.card.fill, "#121820");
  assert.equal(config.palette.topSectionFill, "#121820");
  assert.equal(config.palette.bottomSectionFill, "#121820");
  assert.equal(config.palette.topTextColor, "#f7f8fb");
  assert.equal(config.palette.bottomTextColor, "#f4f6fb");
  assert.equal(config.palette.accentColor, "#f3b31f");
  assert.equal(config.typography.bottom.fontStyle, "italic");
  assert.equal(config.author.checkAssetPath, "/stage3-template-badges/american-news-badge.svg");
  assert.ok(markup.includes("/stage3-template-badges/american-news-badge.svg"));
});

test("science-card runtime config stays aligned with the locked v1 geometry", () => {
  const baseTemplate = getTemplateById(SCIENCE_CARD_TEMPLATE_ID);
  const baseSpec = getTemplateFigmaSpec(SCIENCE_CARD_TEMPLATE_ID);

  assert.equal(baseTemplate.card.x, baseSpec.card.x);
  assert.equal(baseTemplate.card.y, baseSpec.card.y);
  assert.equal(baseTemplate.card.width, baseSpec.card.width);
  assert.equal(baseTemplate.card.height, baseSpec.card.height);
  assert.equal(baseTemplate.card.radius, baseSpec.card.radius);
  assert.equal(baseTemplate.card.borderWidth, baseSpec.card.borderWidth);
  assert.equal(baseTemplate.slot.topHeight, baseSpec.sections.top.height);
  assert.equal(baseTemplate.slot.bottomHeight, baseSpec.sections.bottom.height);
  assert.equal(baseTemplate.slot.bottomMetaHeight, baseSpec.sections.author.height);
  assert.equal(baseTemplate.slot.bottomMetaPaddingX, baseSpec.sections.avatar.x - baseSpec.card.x);
  assert.equal(baseTemplate.slot.bottomTextPaddingLeft, baseSpec.sections.bottomText.x - baseSpec.card.x);
  assert.equal(
    baseTemplate.slot.bottomTextPaddingRight,
    baseSpec.card.x + baseSpec.card.width - (baseSpec.sections.bottomText.x + baseSpec.sections.bottomText.width)
  );
  assert.equal(baseTemplate.author.avatarSize, baseSpec.sections.avatar.width);
  assert.equal(baseTemplate.author.checkSize, baseSpec.typography?.badge?.size);
  assert.equal(baseTemplate.typography.authorName.font, baseSpec.typography?.authorName?.fontSize);
  assert.equal(baseTemplate.typography.authorHandle.font, baseSpec.typography?.authorHandle?.fontSize);
});

test("science-card border variants keep the base geometry and use a thicker colored border", () => {
  const baseTemplate = getTemplateById(SCIENCE_CARD_TEMPLATE_ID);
  const baseSpec = getTemplateFigmaSpec(SCIENCE_CARD_TEMPLATE_ID);
  const variants = [
    {
      templateId: SCIENCE_CARD_BLUE_TEMPLATE_ID,
      label: "Science Card Blue",
      borderColor: "#2057d6"
    },
    {
      templateId: SCIENCE_CARD_RED_TEMPLATE_ID,
      label: "Science Card Red",
      borderColor: "#d33f49"
    },
    {
      templateId: SCIENCE_CARD_GREEN_TEMPLATE_ID,
      label: "Science Card Green",
      borderColor: "#20a35a"
    }
  ];

  for (const variant of variants) {
    const config = getTemplateById(variant.templateId);
    const spec = getTemplateFigmaSpec(variant.templateId);

    assert.equal(getTemplateVariant(variant.templateId).label, variant.label);
    assert.equal(templateUsesBuiltInBackdropFromRegistry(variant.templateId), false);
    assert.equal(spec.source, "generated");
    assert.equal(config.card.borderWidth, 16);
    assert.equal(spec.card.borderWidth, 16);
    assert.equal(config.card.borderColor, variant.borderColor);
    assert.equal(spec.card.borderColor, variant.borderColor);
    assert.equal(spec.card.borderWidth, baseTemplate.card.borderWidth * 2);
    assert.equal(spec.card.x, baseTemplate.card.x);
    assert.equal(spec.card.y, baseTemplate.card.y);
    assert.equal(spec.card.width, baseTemplate.card.width);
    assert.equal(spec.card.height, baseTemplate.card.height);
    assert.equal(spec.card.radius, baseTemplate.card.radius);
    assert.deepEqual(spec.shell, baseSpec.shell);
    assert.deepEqual(spec.sections.top, baseSpec.sections.top);
    assert.deepEqual(spec.sections.media, baseSpec.sections.media);
    assert.deepEqual(spec.sections.bottom, baseSpec.sections.bottom);
    assert.deepEqual(spec.sections.author, baseSpec.sections.author);
    assert.deepEqual(spec.sections.avatar, baseSpec.sections.avatar);
    assert.deepEqual(spec.sections.bottomText, baseSpec.sections.bottomText);
  }
});

test("hedges-of-honor uses the repo-backed spec, renders a built-in backdrop, and keeps science-card geometry", () => {
  const baseSpec = getTemplateFigmaSpec(SCIENCE_CARD_TEMPLATE_ID);
  const hedgesSpec = getTemplateFigmaSpec(HEDGES_OF_HONOR_TEMPLATE_ID);
  const backdropMarkup = renderToStaticMarkup(resolveTemplateBackdropNode(HEDGES_OF_HONOR_TEMPLATE_ID));

  assert.equal(getTemplateVariant(HEDGES_OF_HONOR_TEMPLATE_ID).label, "Hedges of Honor");
  assert.equal(templateUsesBuiltInBackdropFromRegistry(HEDGES_OF_HONOR_TEMPLATE_ID), true);
  assert.equal(
    resolveTemplateBuiltInBackdropAssetPath(HEDGES_OF_HONOR_TEMPLATE_ID),
    "/stage3-template-backdrops/hedges-of-honor-v1-shell.svg"
  );
  assert.deepEqual(hedgesSpec.card.x, baseSpec.card.x);
  assert.deepEqual(hedgesSpec.card.y, baseSpec.card.y);
  assert.deepEqual(hedgesSpec.card.width, baseSpec.card.width);
  assert.deepEqual(hedgesSpec.card.height, baseSpec.card.height);
  assert.equal(hedgesSpec.card.radius, 0);
  assert.equal(hedgesSpec.card.borderWidth, 2);
  assert.equal(hedgesSpec.card.borderColor, "#000000");
  assert.ok((hedgesSpec.card.shadow ?? "").includes("inset"));
  assert.deepEqual(hedgesSpec.sections.top, baseSpec.sections.top);
  assert.deepEqual(hedgesSpec.sections.media, baseSpec.sections.media);
  assert.deepEqual(hedgesSpec.sections.bottom, baseSpec.sections.bottom);
  assert.deepEqual(hedgesSpec.sections.author, baseSpec.sections.author);
  assert.deepEqual(hedgesSpec.sections.avatar, baseSpec.sections.avatar);
  assert.deepEqual(hedgesSpec.sections.bottomText, baseSpec.sections.bottomText);
  assert.ok(backdropMarkup.includes("hedges-of-honor-v1-shell.svg"));
});

test("science-card-v7 and hedges-of-honor use the honor verification badge asset with widened spacing", () => {
  const scienceCardV7 = getTemplateById("science-card-v7");
  const hedges = getTemplateById(HEDGES_OF_HONOR_TEMPLATE_ID);
  const hedgesMarkup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: HEDGES_OF_HONOR_TEMPLATE_ID,
      content: {
        topText: "Top",
        bottomText: "Bottom",
        channelName: "Echoes Of Honor",
        channelHandle: "@EchoesOfHonor50",
        highlights: { top: [], bottom: [] },
        topFontScale: 1,
        bottomFontScale: 1,
        previewScale: 1,
        mediaAsset: null,
        backgroundAsset: null,
        avatarAsset: null
      }
    })
  );

  assert.equal(scienceCardV7.author.checkAssetPath, "/stage3-template-badges/honor-verified-badge.svg");
  assert.equal(hedges.author.checkAssetPath, "/stage3-template-badges/honor-verified-badge.svg");
  assert.equal(scienceCardV7.author.nameCheckGap, 10);
  assert.equal(hedges.author.nameCheckGap, 10);
  assert.ok(hedgesMarkup.includes("/stage3-template-badges/honor-verified-badge.svg"));
});

test("hedges-of-honor renders card chrome on card bounds instead of covering the full shell", () => {
  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: HEDGES_OF_HONOR_TEMPLATE_ID,
      content: {
        topText: "Top",
        bottomText: "Bottom",
        channelName: "Echoes Of Honor",
        channelHandle: "@EchoesOfHonor50",
        highlights: { top: [], bottom: [] },
        topFontScale: 1,
        bottomFontScale: 1,
        previewScale: 1,
        mediaAsset: null,
        backgroundAsset: null,
        avatarAsset: null
      }
    })
  );

  assert.ok(
    markup.includes(
      "left:83px;top:192px;width:907px;height:1461px;border-radius:0;background:#ffffff"
    )
  );
  assert.ok(
    markup.includes(
      "left:83px;top:192px;width:907px;height:1461px;border-radius:0;border:2px solid #000000"
    )
  );
  assert.equal(
    markup.includes(
      "left:0px;top:0px;width:1080px;height:1920px;border-radius:0;border:2px solid #000000"
    ),
    false
  );
  assert.ok(markup.includes("box-shadow:inset 0 0 0 1px rgba(10, 14, 20, 0.1)"));
});

test("stage3 background mode prefers custom and source backgrounds before built-in template backdrops", () => {
  assert.equal(
    resolveStage3BackgroundMode(HEDGES_OF_HONOR_TEMPLATE_ID, {
      hasCustomBackground: true,
      hasSourceVideo: true
    }),
    "custom"
  );
  assert.equal(
    resolveStage3BackgroundMode(HEDGES_OF_HONOR_TEMPLATE_ID, {
      hasCustomBackground: false,
      hasSourceVideo: true
    }),
    "source-blur"
  );
  assert.equal(
    resolveStage3BackgroundMode(HEDGES_OF_HONOR_TEMPLATE_ID, {
      hasCustomBackground: false,
      hasSourceVideo: false
    }),
    "built-in"
  );
});

test("prompt config exposes one direct per-stage prompt and reasoning mode", () => {
  const config = normalizeStage2PromptConfig({
    stages: {
      writer: {
        prompt: "Writer override template",
        reasoningEffort: "medium"
      }
    }
  });

  const resolved = resolveStage2PromptTemplate("writer", config);
  assert.equal(resolved.configuredPrompt, "Writer override template");
  assert.equal(resolved.reasoningEffort, "medium");
  assert.equal(resolved.isCustomPrompt, true);
});

test("seo prompt is part of the same direct per-stage prompt model", () => {
  const config = normalizeStage2PromptConfig({
    stages: {
      seo: {
        prompt: "Custom SEO template",
        reasoningEffort: "high"
      }
    }
  });

  const resolved = resolveStage2PromptTemplate("seo", config);
  assert.equal(resolved.configuredPrompt, "Custom SEO template");
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.isCustomPrompt, true);
});

test("legacy stage prompt configs still migrate into the new direct prompt field", () => {
  const config = normalizeStage2PromptConfig({
    stages: {
      writer: {
        templateOverride: "Writer override template",
        guidance: "Legacy note from older config"
      }
    }
  });

  const resolved = resolveStage2PromptTemplate("writer", config);
  assert.match(resolved.configuredPrompt, /Writer override template/);
  assert.match(resolved.configuredPrompt, /Legacy note from older config/);
  assert.equal(resolved.isCustomPrompt, true);
});

test("legacy writer and critic overrides do not bleed into native_caption_v3 stages", () => {
  const config = normalizeStage2PromptConfig({
    stages: {
      writer: {
        prompt: "Write 20 candidates with top_ru and bottom_ru plus style_direction_ids."
      },
      critic: {
        prompt: "Return a JSON array with keep flags and score totals."
      },
      rewriter: {
        prompt: "Repair finalists using the legacy Russian bilingual contract."
      },
      titles: {
        prompt: "Return title_ru variants."
      }
    }
  });

  const candidateResolved = resolveStage2PromptTemplate("candidateGenerator", config);
  const courtResolved = resolveStage2PromptTemplate("qualityCourt", config);
  const repairResolved = resolveStage2PromptTemplate("targetedRepair", config);
  const titleResolved = resolveStage2PromptTemplate("titleWriter", config);

  assert.equal(candidateResolved.promptSource, "default");
  assert.equal(candidateResolved.overrideCandidatePresent, false);
  assert.doesNotMatch(candidateResolved.configuredPrompt, /20 candidates|top_ru|bottom_ru|style_direction_ids/i);
  assert.equal(courtResolved.promptSource, "default");
  assert.doesNotMatch(courtResolved.configuredPrompt, /json array|keep flags|score totals/i);
  assert.equal(repairResolved.promptSource, "default");
  assert.doesNotMatch(repairResolved.configuredPrompt, /legacy russian|bilingual/i);
  assert.equal(titleResolved.promptSource, "default");
  assert.doesNotMatch(titleResolved.configuredPrompt, /Return title_ru variants\./i);
});

test("stale native workspace overrides are ignored until they carry compatible native metadata", () => {
  const staleConfig = normalizeStage2PromptConfig({
    version: 3 as never,
    stages: {
      candidateGenerator: {
        prompt: "Write 20 candidates with top_ru and bottom_ru.",
        reasoningEffort: "x-high"
      }
    }
  });

  const staleResolved = resolveStage2PromptTemplate("candidateGenerator", staleConfig);
  assert.equal(staleResolved.promptSource, "default");
  assert.equal(staleResolved.overrideCandidatePresent, true);
  assert.equal(staleResolved.overrideAccepted, false);
  assert.equal(staleResolved.overrideRejectedReason, "missing_native_compatibility_metadata");
  assert.doesNotMatch(staleResolved.configuredPrompt, /20 candidates|top_ru|bottom_ru/i);

  const compatibleConfig = prepareStage2PromptConfigForExplicitSave({
    nextConfig: normalizeStage2PromptConfig({
      stages: {
        candidateGenerator: {
          prompt: "Use the runtime hard_constraints_json and write exactly eight punchy candidates.",
          reasoningEffort: "high",
          compatibility: getStage2DefaultPromptCompatibility("candidateGenerator")
        }
      }
    }),
    previousConfig: DEFAULT_STAGE2_PROMPT_CONFIG
  });
  const compatibleResolved = resolveStage2PromptTemplate("candidateGenerator", compatibleConfig);
  assert.equal(compatibleResolved.promptSource, "workspace_override");
  assert.equal(compatibleResolved.overrideAccepted, true);
  assert.match(compatibleResolved.configuredPrompt, /hard_constraints_json/i);
});

test("buildPromptPacket keeps the selector stage as a real prompt stage with active corpus context", () => {
  const service = new ViralShortsWorkerService();
  const { alphaExamples, betaExamples, targetExamples, workspaceExamplesJson } = makeBaseChannels();
  const packet = service.buildPromptPacket({
    channel: {
      id: "target",
      name: "Target Channel",
      username: "target_channel",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: false,
        customExamples: [...alphaExamples, ...betaExamples, ...targetExamples]
      },
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: workspaceExamplesJson,
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/short",
      title: "Old pickup bucks through a muddy rut",
      description: "The axle starts twisting while the crowd sees the truck sink sideways.",
      comments: [
        {
          author: "viewer",
          likes: 4,
          text: "That axle was cooked."
        }
      ],
      frameDescriptions: ["axle leans hard"]
    }),
    promptConfig: normalizeStage2PromptConfig({})
  });

  assert.ok(packet.prompts.selector.length > 0);
  assert.match(packet.prompts.selector, /selected_example_ids/);
  assert.match(packet.prompts.selector, /primary_angle/);
  assert.match(packet.prompts.selector, /why_old_v6_would_work_here/);
  assert.match(packet.prompts.selector, /failure_modes/);
  assert.match(packet.prompts.selector, /availableExamples/);
  assert.equal(packet.context.availableExamples?.length, 5);
  assert.ok(packet.context.selectorOutput.selectedExampleIds?.length);
});

test("selector prompt compacts examples instead of embedding full transcript-heavy corpus objects", () => {
  const packet = buildPromptPacket({
    channelConfig: {
      channelId: "target",
      name: "Target Channel",
      username: "target_channel",
      hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      examplesSource: "workspace_default"
    },
    analyzerOutput: {
      visualAnchors: ["anchor"],
      specificNouns: ["axle"],
      visibleActions: ["twists"],
      subject: "truck",
      action: "twists",
      setting: "field",
      firstSecondsSignal: "signal",
      sceneBeats: ["opening setup", "mid clip escalation", "late payoff"],
      revealMoment: "late payoff",
      lateClipChange: "the later frame makes the failure obvious",
      stakes: ["danger"],
      payoff: "payoff",
      coreTrigger: "trigger",
      humanStake: "stake",
      narrativeFrame: "frame",
      whyViewerCares: "care",
      bestBottomEnergy: "dry humor",
      commentVibe: "crowd reacts",
      commentConsensusLane: "Consensus lane stays on the visible axle failure.",
      commentJokeLane: "Joke lane turns it into a cooked-truck punchline.",
      commentDissentLane: "",
      commentSuspicionLane: "",
      slangToAdapt: ["cooked"],
      commentLanguageCues: ["cooked"],
      extractableSlang: ["cooked"],
      hiddenDetail: "detail",
      genericRisks: ["risk"],
      uncertaintyNotes: ["uncertain late detail"],
      rawSummary: "summary"
    },
    selectorOutput: {
      clipType: "mechanical_failure",
      primaryAngle: "payoff_reveal",
      secondaryAngles: ["shared_experience"],
      rankedAngles: [{ angle: "payoff_reveal", score: 9.4, why: "Strong payoff." }],
      coreTrigger: "trigger",
      humanStake: "stake",
      narrativeFrame: "frame",
      whyViewerCares: "care",
      topStrategy: "contrast-first",
      bottomEnergy: "dry humor",
      whyOldV6WouldWorkHere: "old v6",
      failureModes: ["generic"],
        writerBrief: "brief",
        selectedExampleIds: ["alpha_1"]
      },
    examplesAssessment: makeExamplesAssessment(),
    availableExamples: [
      {
        ...makeExample({
          id: "alpha_1",
          ownerChannelId: "alpha",
          ownerChannelName: "Alpha",
          title: "A very long example title"
        }),
        transcript: "TRANSCRIPT SHOULD NOT APPEAR ".repeat(50)
      }
    ],
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/short",
      title: "Clip",
      description: "desc",
      transcript: "video transcript",
      frameDescriptions: ["frame 1"],
      comments: [{ author: "viewer", likes: 1, text: "comment" }]
    }),
    promptConfig: normalizeStage2PromptConfig({})
  });

  assert.match(packet.prompts.selector, /availableExamples/);
  assert.doesNotMatch(packet.prompts.selector, /TRANSCRIPT SHOULD NOT APPEAR/);
});

test("analyzer prompt carries transcript support and sequence-aware frame coverage without exploding frame count", () => {
  const framePlan = buildAdaptiveFramePlan(38);
  const prompt = buildAnalyzerPrompt(
    {
      channelId: "target",
      name: "Target Channel",
      username: "target_channel",
      hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      examplesSource: "workspace_default"
    },
    buildVideoContext({
      sourceUrl: "https://example.com/short",
      title: "A truck slowly loses the axle while the crowd realizes it late.",
      description: "The early frames hide the failure and the last frames expose it.",
      transcript: "Everybody hears the crack before the wheel finally folds under the truck.",
      frameDescriptions: framePlan.map((entry) => entry.description),
      comments: [{ author: "viewer", likes: 4, text: "that crack told the whole story" }]
    }),
    {
      visualAnchors: ["axle", "rut"],
      specificNouns: ["truck", "axle"],
      visibleActions: ["leans", "folds"],
      subject: "truck",
      action: "leans",
      setting: "muddy trail",
      firstSecondsSignal: "the truck already looks unstable",
      sceneBeats: framePlan.slice(0, 4).map((entry) => entry.description),
      revealMoment: "the wheel folds at the end",
      lateClipChange: "the hidden failure becomes obvious later",
      stakes: ["danger"],
      payoff: "the wheel folds under load",
      coreTrigger: "the late visible failure",
      humanStake: "everyone watching knows the driver pushed too long",
      narrativeFrame: "a failure that only becomes obvious later",
      whyViewerCares: "the viewer waits for the reveal to fully land",
      bestBottomEnergy: "dry humor",
      commentVibe: "crowd reaction",
      commentConsensusLane: "Consensus lane stays with the late visible failure.",
      commentJokeLane: "Joke lane treats it like the truck was cooked from the start.",
      commentDissentLane: "",
      commentSuspicionLane: "",
      slangToAdapt: ["cooked"],
      commentLanguageCues: ["that crack told the whole story", "cooked"],
      extractableSlang: ["cooked"],
      hiddenDetail: "the crack arrives before the collapse",
      genericRisks: ["generic failure talk"],
      uncertaintyNotes: ["far background details remain ambiguous"],
      rawSummary: "The truck looks unstable early and the axle failure becomes obvious only near the end."
    },
    normalizeStage2PromptConfig({})
  );

  assert.match(prompt, /Everybody hears the crack/);
  assert.match(prompt, /opening setup/);
  assert.match(prompt, /late aftermath/);
  assert.ok((prompt.match(/frame \d+:/g) ?? []).length <= 12);
});

test("analyzer prompt asks for mixed comment lanes and carries a compact comment digest", () => {
  const prompt = buildAnalyzerPrompt(
    {
      channelId: "target",
      name: "Target Channel",
      username: "target_channel",
      hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      examplesSource: "workspace_default"
    },
    buildVideoContext({
      sourceUrl: "https://example.com/celeb",
      title: "Scarlett drops one line and the room melts down",
      description: "A polished interview suddenly reads like a school-friends joke landing too hard.",
      transcript: "She's so pretty. What? The room glitches and she stays calm.",
      frameDescriptions: ["smiling answer", "group reaction", "calm aftermath"],
      comments: [
        { author: "fan_1", likes: 440, text: "she's so pretty still destroys the whole room" },
        { author: "fan_2", likes: 318, text: "Lady Hemsworth is still the funniest one here" },
        { author: "fan_3", likes: 210, text: "it feels staged honestly" }
      ]
    }),
    {
      visualAnchors: ["Scarlett smiling", "cast reaction"],
      specificNouns: ["interview couch", "cast", "Scarlett"],
      visibleActions: ["she answers", "the group reacts"],
      subject: "cast interview",
      action: "reacts",
      setting: "press junket",
      firstSecondsSignal: "a basic answer suddenly flips the room dynamic",
      sceneBeats: ["question lands", "compliment slips out", "room melts down"],
      revealMoment: "everyone else glitches while she stays composed",
      lateClipChange: "the calm aftermath makes the teasing look intentional",
      stakes: ["social read"],
      payoff: "the room melts down around one light compliment",
      coreTrigger: "a tiny compliment detonates the group chemistry",
      humanStake: "everyone recognizes the friend-group malfunction instantly",
      narrativeFrame: "a polished interview turning into a private joke",
      whyViewerCares: "the clip humanizes celebrities through a painfully familiar social glitch",
      bestBottomEnergy: "dry amused disbelief",
      commentVibe: "fond chaos with some staged skepticism",
      commentConsensusLane: "Consensus lane loves the friend-group malfunction.",
      commentJokeLane: "Joke lane keeps using Lady Hemsworth as the punchline.",
      commentDissentLane: "A smaller dissent lane says the whole beat feels staged.",
      commentSuspicionLane: "Suspicion lane reads the blocking as too clean to be accidental.",
      slangToAdapt: ["she's so pretty", "Lady Hemsworth"],
      commentLanguageCues: ["she's so pretty", "Lady Hemsworth", "staged honestly"],
      extractableSlang: ["she's so pretty", "Lady Hemsworth"],
      hiddenDetail: "The calm aftermath is what sells the joke.",
      genericRisks: ["flattening it into generic celebrity banter"],
      uncertaintyNotes: [],
      rawSummary: "A simple compliment turns the room into a friend-group glitch while she stays calm."
    },
    normalizeStage2PromptConfig({})
  );

  assert.match(prompt, /comment_consensus_lane/);
  assert.match(prompt, /comment_joke_lane/);
  assert.match(prompt, /comment_dissent_lane/);
  assert.match(prompt, /comment_suspicion_lane/);
  assert.match(prompt, /"commentDigest":/);
  assert.match(prompt, /Consensus read/);
  assert.match(prompt, /joke or meme lane/i);
  assert.match(prompt, /dissent or pushback lane/i);
});

test("writer prompt explicitly carries strong audience shorthand when comment pressure is high", () => {
  const prompt = buildWriterPrompt({
    channelConfig: {
      channelId: "target",
      name: "Echoes Of Honor",
      username: "echoesofhonor50",
      hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      examplesSource: "workspace_default"
    },
    analyzerOutput: {
      visualAnchors: ["armored vehicle near the crowd fence"],
      specificNouns: ["SADF vehicle", "crowd fence", "pickup"],
      visibleActions: ["slides wide", "hits the fence"],
      subject: "armored vehicle demo",
      action: "slides wide",
      setting: "dusty training field",
      firstSecondsSignal: "the vehicle already looks too fast for the line",
      sceneBeats: ["clean setup", "wide slide", "crowd-side near miss"],
      revealMoment: "the vehicle breaks through the fence line",
      lateClipChange: "the crowd realizes the course line is gone",
      stakes: ["danger", "absurdity"],
      payoff: "the armored vehicle ends up on the spectator side",
      coreTrigger: "a military demo turns into a crowd-side self-own",
      humanStake: "everyone watching instantly understands the near-miss and the embarrassment",
      narrativeFrame: "a power demo becoming a public self-own",
      whyViewerCares: "the clip sells both danger and humiliation in one visible move",
      bestBottomEnergy: "dry mocking disbelief",
      commentVibe: "mocking disbelief",
      commentConsensusLane: "Consensus lane keeps circling The SADF doesn’t need an enemy.",
      commentJokeLane: "Joke lane keeps calling it Taxi driver in SANDF and elite SADF.",
      commentDissentLane: "",
      commentSuspicionLane: "",
      slangToAdapt: ["SADF", "elite SADF", "Taxi driver in SANDF"],
      commentLanguageCues: ["The SADF doesn’t need an enemy", "elite SADF", "Taxi driver in SANDF"],
      extractableSlang: ["SADF", "elite SADF", "Taxi driver in SANDF"],
      hiddenDetail: "The audience keeps reducing the whole moment to SADF shorthand.",
      genericRisks: ["sanding the whole joke down into generic military-demo language"],
      uncertaintyNotes: [],
      rawSummary: "An armored vehicle slides out of a demo lane and breaks into the spectator fence."
    },
    selectorOutput: {
      clipType: "military_fail",
      primaryAngle: "tension_danger",
      secondaryAngles: ["shared_experience", "absurdity_chaos"],
      rankedAngles: [{ angle: "tension_danger", score: 9.4, why: "Visible crowd-side danger." }],
      coreTrigger: "demo becomes near miss",
      humanStake: "the crowd suddenly matters",
      narrativeFrame: "military demo turns into self-own",
      whyViewerCares: "danger plus humiliation",
      topStrategy: "danger-first setup",
      bottomEnergy: "dry mocking disbelief",
      whyOldV6WouldWorkHere: "v6 would lean into the self-own immediately",
      failureModes: ["generic military wording"],
      writerBrief: "Lead with the near miss, then let the bottom react like the crowd already has a nickname for it.",
      selectedExampleIds: ["ex_1"]
    },
    examplesAssessment: makeExamplesAssessment({
      retrievalConfidence: "low",
      examplesMode: "style_guided",
      examplesRoleSummary: "Examples are weak support only.",
      primaryDriverSummary: "Clip truth and comment shorthand should drive the run.",
      channelStylePriority: "primary",
      editorialMemoryPriority: "elevated"
    }),
    userInstruction: null,
    promptConfig: normalizeStage2PromptConfig({})
  });

  assert.match(prompt, /"commentCarryProfile":/);
  assert.match(prompt, /SADF/);
  assert.match(prompt, /Taxi driver in SANDF/);
  assert.match(prompt, /at least 2 candidates must cash one of those cues in naturally/i);
});

test("selector prompt uses a curated prompt pool instead of the entire active corpus", () => {
  const service = new ViralShortsWorkerService();
  const highSignalExamples = Array.from({ length: 36 }, (_, index) =>
    makeExample({
      id: `relevant_${index + 1}`,
      ownerChannelId: `source_${(index % 9) + 1}`,
      ownerChannelName: `Source ${(index % 9) + 1}`,
      title: `Axle twist failure ${index + 1}`,
      overlayTop: `The axle twist becomes obvious before the mud fully lets go ${index + 1}`,
      overlayBottom: `"Everybody heard that crack," and the whole crowd already knows the bill ${index + 1}`,
      qualityScore: 0.8 - (index % 4) * 0.05
    })
  );
  const noisyExamples = [
    makeExample({
      id: "broken_json",
      ownerChannelId: "noisy",
      ownerChannelName: "Noisy",
      title: "Broken JSON example",
      overlayTop: "{\"bad\":\"json\"}",
      overlayBottom: "{\"also\":\"bad\"}"
    }),
    makeExample({
      id: "too_short",
      ownerChannelId: "noisy",
      ownerChannelName: "Noisy",
      title: "Too short",
      overlayTop: "oops",
      overlayBottom: "tiny"
    })
  ];

  const packet = service.buildPromptPacket({
    channel: {
      id: "target",
      name: "Target Channel",
      username: "target_channel",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: false,
        customExamples: [...highSignalExamples, ...noisyExamples]
      },
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/short",
      title: "Old pickup axle twists in deep mud",
      description: "The crowd sees the axle give up before the truck stops moving.",
      transcript: "Everybody watching hears the crack before the wheel fully folds.",
      frameDescriptions: ["axle leans hard", "mud sprays off the tire"],
      comments: [{ author: "viewer", likes: 8, text: "That axle was done long before the last push." }]
    }),
    promptConfig: normalizeStage2PromptConfig({})
  });

  assert.equal(packet.context.availableExamples?.length, 24);
  assert.match(packet.prompts.selector, /Axle twist failure/);
  assert.doesNotMatch(packet.prompts.selector, /broken_json|too_short/);
  assert.doesNotMatch(packet.prompts.selector, /"bad":"json"|tiny/);
});

test("selector example pool downranks weak generic examples when richer metadata exists", () => {
  const relevantRichExamples = Array.from({ length: 10 }, (_, index) =>
    makeExample({
      id: `awards_${index + 1}`,
      ownerChannelId: `awards_source_${(index % 4) + 1}`,
      ownerChannelName: `Awards Source ${(index % 4) + 1}`,
      title: `All-time awards lineup payoff ${index + 1}`,
      overlayTop: `The nominee grid keeps stacking heavyweight TV names until the category looks unfair ${index + 1}`,
      overlayBottom: `That lineup makes the winner reveal feel like a finals round ${index + 1}`,
      clipType: "prestige_awards",
      whyItWorks: ["stacked lineup becomes the trigger", "winner reveal lands late"],
      qualityScore: 0.9
    })
  );
  const weakGenericExamples = Array.from({ length: 10 }, (_, index) =>
    makeExample({
      id: `generic_${index + 1}`,
      ownerChannelId: "generic",
      ownerChannelName: "Generic",
      title: `NATURES CRAZY REACTION TIME ${index + 1}`,
      overlayTop: `This buck reacts before the arrow finishes the sound barrier ${index + 1}`,
      overlayBottom: `That is evolution doing all the work ${index + 1}`,
      clipType: "general",
      whyItWorks: [],
      qualityScore: null
    })
  );

  const selectorPool = buildSelectorExamplePool({
    examples: [...relevantRichExamples, ...weakGenericExamples],
    queryText:
      "prestige awards nominee grid stacked lineup winner reveal bryan cranston emmy audience reaction"
  });

  assert.ok(selectorPool.selectorExamples.length > 0);
  assert.ok(selectorPool.selectorExamples.every((example) => example.clipType !== "general"));
  assert.ok(
    selectorPool.selectorExamples.every((example) => example.whyItWorks.length > 0 || example.qualityScore !== null)
  );
});

test("strong domain-near examples produce domain_guided retrieval with high confidence", () => {
  const strongExamples = Array.from({ length: 8 }, (_, index) =>
    makeExample({
      id: `domain_${index + 1}`,
      ownerChannelId: `mud_source_${(index % 4) + 1}`,
      ownerChannelName: `Mud Source ${(index % 4) + 1}`,
      title: `Truck axle crack in deep mud ${index + 1}`,
      overlayTop: `The axle starts twisting before the mud even lets the truck breathe ${index + 1}`,
      overlayBottom: `Everybody there already knows the next crack is going to get expensive ${index + 1}`,
      clipType: "mechanical_failure",
      whyItWorks: ["same trigger structure", "same crowd-side failure read"],
      qualityScore: 0.93
    })
  );

  const selectorPool = buildSelectorExamplePool({
    examples: strongExamples,
    queryText:
      "truck axle crack deep mud wheel folds under load crowd hears it before the driver stops"
  });

  assert.equal(selectorPool.assessment.retrievalConfidence, "high");
  assert.equal(selectorPool.assessment.examplesMode, "domain_guided");
  assert.ok(selectorPool.stats.semanticGuidanceCount >= 2);
  assert.match(selectorPool.assessment.explanation, /domain-near overlap/i);
});

test("structurally useful but semantically weak pools produce form_guided retrieval", () => {
  const structuralExamples = Array.from({ length: 8 }, (_, index) =>
    makeExample({
      id: `form_${index + 1}`,
      ownerChannelId: `awards_source_${(index % 4) + 1}`,
      ownerChannelName: `Awards Source ${(index % 4) + 1}`,
      title: `Awards lineup tension ${index + 1}`,
      overlayTop: `The nominee board keeps stacking heavyweight names until the whole category feels unfair ${index + 1}`,
      overlayBottom: `That lineup turns the reveal into social bloodsport ${index + 1}`,
      clipType: "prestige_awards",
      whyItWorks: ["strong top/bottom split", "late reveal compression"],
      qualityScore: 0.92
    })
  );

  const selectorPool = buildSelectorExamplePool({
    examples: structuralExamples,
    queryText:
      "robot arm solder joint fails under load factory floor everyone hears the crack before it collapses"
  });

  assert.equal(selectorPool.assessment.retrievalConfidence, "medium");
  assert.equal(selectorPool.assessment.examplesMode, "form_guided");
  assert.ok(selectorPool.stats.formGuidanceCount >= 3);
  assert.match(selectorPool.assessment.explanation, /structurally useful/i);
});

test("weak generic pools produce style_guided retrieval with truthful warning", () => {
  const weakGenericExamples = Array.from({ length: 8 }, (_, index) =>
    makeExample({
      id: `weak_${index + 1}`,
      ownerChannelId: "generic",
      ownerChannelName: "Generic",
      title: `Wild reaction clip ${index + 1}`,
      overlayTop: `This whole thing gets crazy right away and everybody starts losing it ${index + 1}`,
      overlayBottom: `That is one of those videos people keep replaying for the vibe ${index + 1}`,
      clipType: "general",
      whyItWorks: [],
      qualityScore: 0.2
    })
  );

  const selectorPool = buildSelectorExamplePool({
    examples: weakGenericExamples,
    queryText:
      "robot arm solder joint fails under load factory floor everyone hears the crack before it collapses"
  });

  assert.equal(selectorPool.assessment.retrievalConfidence, "low");
  assert.equal(selectorPool.assessment.examplesMode, "style_guided");
  assert.match(selectorPool.assessment.retrievalWarning ?? "", /did not find strong domain-near examples/i);
});

test("vnext example router upgrades low-confidence retrieval to disabled and passes zero examples downstream", () => {
  const weakGenericExamples = Array.from({ length: 8 }, (_, index) =>
    makeExample({
      id: `weak_vnext_${index + 1}`,
      ownerChannelId: "generic",
      ownerChannelName: "Generic",
      title: `Wild reaction clip ${index + 1}`,
      overlayTop: `This whole thing gets crazy right away and everybody starts losing it ${index + 1}`,
      overlayBottom: `That is one of those videos people keep replaying for the vibe ${index + 1}`,
      clipType: "general",
      whyItWorks: [],
      qualityScore: 0.2
    })
  );

  const selectorPool = buildSelectorExamplePool({
    examples: weakGenericExamples,
    queryText:
      "robot arm solder joint fails under load factory floor everyone hears the crack before it collapses"
  });
  const decision = decideExampleRouting({
    availableExamples: selectorPool.selectorExamples,
    assessment: selectorPool.assessment
  });
  const passedExamples = applyExampleRoutingDecision({
    availableExamples: selectorPool.selectorExamples,
    decision
  });

  assert.equal(decision.mode, "disabled");
  assert.deepEqual(decision.selectedExampleIds, []);
  assert.equal(passedExamples.length, 0);
});

test("candidate lifecycle rejects hard-rejected reentry transitions", () => {
  const lifecycle = new CandidateLifecycle();
  lifecycle.registerSemanticDraft({
    candidateId: "cand_reject",
    createdAt: "2026-03-31T10:00:00.000Z"
  });
  lifecycle.transition({
    candidateId: "cand_reject",
    toState: "packed_valid",
    stageId: "constraint_packer",
    at: "2026-03-31T10:00:01.000Z"
  });
  lifecycle.transition({
    candidateId: "cand_reject",
    toState: "hard_rejected",
    stageId: "quality_court",
    at: "2026-03-31T10:00:02.000Z",
    reason: "visual_fail"
  });

  assert.throws(
    () =>
      lifecycle.transition({
        candidateId: "cand_reject",
        toState: "visible_shortlist",
        stageId: "ranked_final_selector",
        at: "2026-03-31T10:00:03.000Z"
      }),
    /Invalid candidate lifecycle transition/
  );
});

test("trace validator catches disabled example leaks and hard-rejected shortlist reentry", () => {
  const lifecycle = new CandidateLifecycle();
  lifecycle.registerSemanticDraft({
    candidateId: "cand_1",
    createdAt: "2026-03-31T10:00:00.000Z"
  });
  lifecycle.transition({
    candidateId: "cand_1",
    toState: "packed_valid",
    stageId: "constraint_packer",
    at: "2026-03-31T10:00:01.000Z"
  });
  lifecycle.transition({
    candidateId: "cand_1",
    toState: "judged",
    stageId: "quality_court",
    at: "2026-03-31T10:00:02.000Z"
  });
  lifecycle.transition({
    candidateId: "cand_1",
    toState: "hard_rejected",
    stageId: "quality_court",
    at: "2026-03-31T10:00:03.000Z",
    reason: "native_fluency_fail"
  });

  const trace = buildTraceV3({
    meta: {
      version: "stage2-vnext-trace-v3",
      generatedAt: "2026-03-31T10:01:00.000Z",
      featureFlag: "STAGE2_VNEXT_ENABLED",
      featureFlags: {
        STAGE2_VNEXT_ENABLED: true,
        source: "override",
        rawValue: null
      },
      pipelineVersion: "vnext",
      stageChainVersion: "stage2-vnext",
      workerBuild: {
        buildId: "test-build",
        startedAt: "2026-03-31T09:59:00.000Z",
        pid: 123
      },
      compatibilityMode: "none",
      implementedStages: [
        "clip_truth_extractor",
        "audience_miner",
        "example_router",
        "constraint_packer",
        "quality_court",
        "ranked_final_selector"
      ]
    },
    inputs: {
      source: {
        sourceId: "source_1",
        sourceUrl: "https://example.com/source",
        title: "Clip",
        description: "Description",
        transcript: null,
        durationSec: null,
        frames: [],
        comments: [
          {
            id: "comment_1",
            author: "viewer",
            text: "this joint is cooked",
            likes: 12,
            postedAt: null
          }
        ],
        metadata: {
          provider: "test",
          downloadedAt: "2026-03-31T10:00:00.000Z",
          totalComments: 1
        }
      },
      channel: {
        channelId: "channel_1",
        name: "Channel 1",
        username: "channel_1",
        hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
        userInstruction: null
      }
    },
    stageOutputs: {
      clipTruthExtractor: {
        observedFacts: ["robot arm", "joint fails"],
        visibleAnchors: ["robot arm", "joint"],
        visibleActions: ["joint buckles"],
        sceneBeats: ["arm strains", "joint snaps"],
        revealMoment: "the arm gives way",
        lateClipChange: "the aftermath makes the failure obvious",
        pauseSafeTopFacts: ["robot arm", "joint"],
        inferredReads: ["the setup was already failing"],
        uncertaintyNotes: ["fixture truth packet"],
        claimGuardrails: ["do not overclaim the cause"],
        firstSecondsSignal: "the arm already looks unstable",
        whyViewerCares: "the failure is visible before the full collapse"
      },
      audienceMiner: {
        sentimentSummary: "tense disbelief",
        consensusLane: "people immediately read the joint as cooked",
        jokeLane: "jokes about the arm being done for",
        dissentLane: "",
        suspicionLane: "",
        shorthandPressure: "medium",
        allowedCues: ["cooked"],
        bannedCues: ["not a fact"],
        normalizedSlang: [
          {
            raw: "cooked",
            safeNativeEquivalent: "cooked",
            keepRawAllowed: true
          }
        ],
        moderationFindings: []
      },
      exampleRouter: {
        decision: {
          mode: "disabled",
          confidence: 0.2,
          selectedExampleIds: [],
          blockedExampleIds: ["example_1"],
          reasons: ["retrieval too weak"]
        },
        retrievedExamples: [],
        passedExamples: [],
        blockedExamples: []
      },
      strategySearch: null,
      semanticDraftGenerator: {
        drafts: []
      },
      constraintPacker: {
        packedCandidates: []
      },
      qualityCourt: {
        judgeCards: []
      },
      rankedFinalSelector: {
        visibleCandidateIds: ["cand_1"],
        winnerCandidateId: "cand_1",
        rankingMatches: [],
        rationale: "invalid shortlist"
      },
      titleAndSeo: {
        titles: [],
        seo: null
      },
      exampleUsage: [
        {
          stageId: "semantic_draft_generator",
          exampleMode: "disabled",
          passedExampleIds: ["example_1"]
        }
      ]
    },
    candidateLineage: lifecycle.list(),
    criticGate: {
      evaluatedCandidateIds: ["cand_1"],
      criticKeptCandidateIds: [],
      criticRejectedCandidateIds: ["cand_1"],
      rewriteCandidateIds: [],
      validatedShortlistPoolIds: [],
      visibleShortlistCandidateIds: ["cand_1"],
      invalidDroppedCandidateIds: [],
      reserveBackfillCount: 0
    },
    validation: {
      validatorsRun: [],
      issues: []
    },
    selection: {
      visibleCandidateIds: ["cand_1"],
      winnerCandidateId: "cand_1",
      rankingMatches: [],
      rationale: "invalid shortlist"
    },
    memory: {
      status: "disabled",
      reason: "fixture"
    },
    cost: {
      totalPromptChars: 0,
      totalEstimatedInputTokens: 0,
      totalEstimatedOutputTokens: 0
    }
  });
  const validation = validateTraceV3(trace);

  assert.equal(validation.ok, false);
  assert.match(validation.issues.join(" "), /Disabled example mode still passed examples/i);
  assert.match(validation.issues.join(" "), /hard-rejected candidate/i);
});

test("title validator normalizes all-caps policy after checking opener", () => {
  const validation = validateTitle("How axle fails", {
    requireQuestionWordOpener: true,
    forceAllCaps: true
  });

  assert.equal(validation.normalizedTitle, "HOW AXLE FAILS");
  assert.equal(validation.passed, true);
});

test("selector prompt changes behavior by examples mode instead of treating every pool as semantic guidance", () => {
  const service = new ViralShortsWorkerService();
  const formOnlyExamples = Array.from({ length: 6 }, (_, index) =>
    makeExample({
      id: `form_prompt_${index + 1}`,
      ownerChannelId: `awards_prompt_${(index % 3) + 1}`,
      ownerChannelName: `Awards Prompt ${(index % 3) + 1}`,
      title: `Awards reveal rhythm ${index + 1}`,
      overlayTop: `The lineup keeps stacking names until the reveal feels socially brutal ${index + 1}`,
      overlayBottom: `That board turns a normal category into a public execution ${index + 1}`,
      clipType: "prestige_awards",
      whyItWorks: ["tight reveal compression", "strong top/bottom pacing"],
      qualityScore: 0.9
    })
  );

  const packet = service.buildPromptPacket({
    channel: {
      id: "target",
      name: "Target Channel",
      username: "target_channel",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: false,
        customExamples: formOnlyExamples
      },
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/factory",
      title: "Robot arm joint snaps under load",
      description: "The factory floor clip ends with the arm giving way once the pressure shifts.",
      transcript: "Everyone hears the crack before the arm finally drops.",
      frameDescriptions: ["robot arm strains", "joint gives way"],
      comments: [{ author: "viewer", likes: 9, text: "you could hear that joint begging for mercy" }]
    }),
    promptConfig: normalizeStage2PromptConfig({})
  });

  assert.match(packet.prompts.selector, /"examplesMode": "form_guided"/);
  assert.match(packet.prompts.selector, /form guidance/i);
  assert.match(packet.prompts.selector, /do not let example nouns or background assumptions overrule the actual clip/i);
});

test("writer and critic prompts guard against wrong-market borrowing in low-confidence runs", async () => {
  const weakGenericExamples = Array.from({ length: 8 }, (_, index) =>
    makeExample({
      id: `weak_prompt_${index + 1}`,
      ownerChannelId: "generic",
      ownerChannelName: "Generic",
      title: `Wild reaction clip ${index + 1}`,
      overlayTop: `This whole thing gets crazy right away and everybody starts losing it ${index + 1}`,
      overlayBottom: `That is one of those videos people keep replaying for the vibe ${index + 1}`,
      clipType: "general",
      whyItWorks: [],
      qualityScore: 0.2
    })
  );

  const { executor, result } = await runSuccessfulPipeline({
    stage2ExamplesConfig: {
      version: 1,
      useWorkspaceDefault: false,
      customExamples: weakGenericExamples
    },
    selectedExampleIds: weakGenericExamples.slice(0, 3).map((example) => example.id),
    selectorResponse: {
      selected_example_ids: weakGenericExamples.slice(0, 3).map((example) => example.id)
    }
  });

  const writerCall = executor.calls[2];
  const criticCall = executor.calls[3];

  assert.equal(result.diagnostics.examples.examplesMode, "style_guided");
  assert.equal(result.diagnostics.examples.retrievalConfidence, "low");
  assert.match(writerCall?.prompt ?? "", /"examplesMode": "style_guided"/);
  assert.match(writerCall?.prompt ?? "", /Never import nouns, setting, causal logic, or market assumptions from weak examples/i);
  assert.match(writerCall?.prompt ?? "", /bootstrap channel style directions/i);
  assert.match(criticCall?.prompt ?? "", /candidate borrows the wrong market/i);
  assert.match(criticCall?.prompt ?? "", /Good form is not enough if the semantics were imported from a weak example pool/i);
});

test("vnext low-confidence runs strip examples from selector and downstream prompts", async () => {
  const weakGenericExamples = Array.from({ length: 8 }, (_, index) =>
    makeExample({
      id: `weak_vnext_prompt_${index + 1}`,
      ownerChannelId: "generic",
      ownerChannelName: "Generic",
      title: `Wild reaction clip ${index + 1}`,
      overlayTop: `This whole thing gets crazy right away and everybody starts losing it ${index + 1}`,
      overlayBottom: `That is one of those videos people keep replaying for the vibe ${index + 1}`,
      clipType: "general",
      whyItWorks: [],
      qualityScore: 0.2
    })
  );

  const { executor, result } = await runSuccessfulPipeline({
    stage2VNextEnabled: true,
    stage2ExamplesConfig: {
      version: 1,
      useWorkspaceDefault: false,
      customExamples: weakGenericExamples
    },
    selectedExampleIds: weakGenericExamples.slice(0, 3).map((example) => example.id),
    selectorResponse: {
      selected_example_ids: weakGenericExamples.slice(0, 3).map((example) => example.id)
    }
  });

  const selectorCall = executor.calls[1];
  const writerCall = executor.calls[2];
  const criticCall = executor.calls[3];
  const rewriterCall = executor.calls[4];
  const stageIdsWithNoDownstreamExamples = ["writer", "rewriter", "finalSelector", "titles"] as const;

  assert.equal(result.output.pipeline.vnext?.exampleRouting.mode, "disabled");
  assert.equal(result.output.pipeline.selectedExamplesCount, 0);
  assert.doesNotMatch(selectorCall?.prompt ?? "", /Wild reaction clip/);
  assert.match(writerCall?.prompt ?? "", /"selectedExamples": \[\]/);
  assert.match(criticCall?.prompt ?? "", /"selectedExamples": \[\]/);
  assert.match(rewriterCall?.prompt ?? "", /"selectedExamples": \[\]/);
  for (const stageId of stageIdsWithNoDownstreamExamples) {
    const stage = result.diagnostics.effectivePrompting.promptStages.find(
      (promptStage) => promptStage.stageId === stageId
    );
    assert.equal(stage?.inputManifest?.examples?.passedCount, 0);
    assert.deepEqual(stage?.inputManifest?.examples?.passedExampleIds, []);
    assert.deepEqual(stage?.inputManifest?.examples?.selectedExampleIds ?? [], []);
  }
  assert.equal(result.output.pipeline.vnext?.trace.canonicalCounters.examplesPassedDownstream, 0);
});

test("worker-path env flag activation resolves vnext execution metadata inside runPipeline", async () => {
  const previous = process.env.STAGE2_VNEXT_ENABLED;
  process.env.STAGE2_VNEXT_ENABLED = "true";

  try {
    const { result } = await runSuccessfulPipeline();

    assert.equal(result.output.pipeline.execution?.featureFlags.STAGE2_VNEXT_ENABLED, true);
    assert.equal(result.output.pipeline.execution?.featureFlags.source, "env");
    assert.equal(result.output.pipeline.execution?.pipelineVersion, "vnext");
    assert.equal(result.output.pipeline.execution?.stageChainVersion, "stage2-vnext");
    assert.ok(result.output.pipeline.execution?.workerBuild.buildId);
    assert.ok(result.output.pipeline.execution?.workerBuild.startedAt);
    assert.ok(result.output.pipeline.vnext?.exampleRouting);
    assert.ok(result.output.pipeline.vnext?.canonicalCounters);
    assert.ok(result.output.pipeline.vnext?.validation);
    assert.ok((result.output.pipeline.vnext?.candidateLineage.length ?? 0) > 0);
    assert.ok(result.output.pipeline.vnext?.criticGate);
    assert.ok(result.output.pipeline.vnext?.trace.stageOutputs.clipTruthExtractor);
    assert.ok(result.output.pipeline.vnext?.trace.stageOutputs.audienceMiner);
    assert.equal(result.output.pipeline.vnext?.trace.meta.compatibilityMode, "none");
    assert.equal(result.output.pipeline.vnext?.validation.ok, true);
    assert.deepEqual(auditStage2WorkerRollout(result.output), { ok: true });
  } finally {
    if (previous === undefined) {
      delete process.env.STAGE2_VNEXT_ENABLED;
    } else {
      process.env.STAGE2_VNEXT_ENABLED = previous;
    }
  }
});

test("worker rollout audit rejects legacy fallback before the runner can silently succeed", async () => {
  const { result } = await runSuccessfulPipeline({
    stage2VNextEnabled: false
  });

  const audit = auditStage2WorkerRollout(result.output);
  assert.equal(audit.ok, false);
  if (!audit.ok) {
    assert.match(audit.message, /pipelineVersion=legacy/);
    assert.match(audit.message, /STAGE2_VNEXT_ENABLED=false/);
    assert.match(audit.message, /legacyFallbackReason=/);
  }
});

test("worker rollout audit rejects incomplete canonical vnext payloads", async () => {
  const { result } = await runSuccessfulPipeline({
    stage2VNextEnabled: true
  });

  const audit = auditStage2WorkerRollout({
    ...result.output,
    pipeline: {
      ...result.output.pipeline,
      vnext: result.output.pipeline.vnext
        ? {
            ...result.output.pipeline.vnext,
            candidateLineage: []
          }
        : result.output.pipeline.vnext
    }
  });
  assert.equal(audit.ok, false);
  if (!audit.ok) {
    assert.match(audit.message, /candidateLineage/);
  }
});

test("vnext regenerates fresh candidates instead of backfilling critic rejects into the rewrite pool", async () => {
  const criticResponse = Array.from({ length: 8 }, (_, index) => ({
    candidate_id: `cand_${index + 1}`,
    scores: makeCriticScoreMap(index),
    total: 9 - index * 0.2,
    issues: index < 3 ? [] : ["critic rejected this candidate"],
    keep: index < 3
  }));
  const recoveryWriterCandidates = Array.from({ length: 8 }, (_, index) =>
    makeCandidate(`cand_${index + 1}`, index % 2 === 0 ? "shared_experience" : "payoff_reveal", index + 11)
  );
  const recoveryCriticResponse = Array.from({ length: 8 }, (_, index) => ({
    candidate_id: `regen_1_cand_${index + 1}`,
    scores: makeCriticScoreMap(index),
    total: 8.5 - index * 0.15,
    issues: index < 2 ? [] : ["recovery critic rejected this candidate"],
    keep: index < 2
  }));

  const { result } = await runSuccessfulPipeline({
    stage2VNextEnabled: true,
    criticResponse,
    recoveryWriterCandidates,
    recoveryCriticResponse
  });

  const criticGate = result.output.pipeline.vnext?.criticGate;
  assert.ok(criticGate);
  assert.equal(criticGate?.reserveBackfillCount, 0);
  assert.equal(criticGate?.criticKeptCandidateIds.length, 5);
  assert.deepEqual(criticGate?.rewriteCandidateIds, criticGate?.criticKeptCandidateIds);
  assert.ok(criticGate?.criticKeptCandidateIds.some((candidateId) => candidateId.startsWith("regen_1_")));
  assert.ok(
    result.output.pipeline.vnext?.candidateLineage.some((record) =>
      record.candidateId.startsWith("regen_1_") && record.state !== "semantic_draft"
    )
  );
});

test("vnext rewriter input manifest matches critic-kept ids exactly with no reserve resurrection", async () => {
  const criticResponse = Array.from({ length: 8 }, (_, index) => ({
    candidate_id: `cand_${index + 1}`,
    scores: makeCriticScoreMap(index),
    total: 9 - index * 0.2,
    issues: index < 5 ? [] : ["critic rejected this candidate"],
    keep: index < 5
  }));

  const { result, progressEvents } = await runSuccessfulPipeline({
    stage2VNextEnabled: true,
    criticResponse
  });

  const criticGate = result.output.pipeline.vnext?.criticGate;
  const rewriterStage = result.diagnostics.effectivePrompting.promptStages.find(
    (stage) => stage.stageId === "rewriter"
  );
  const rewriterEvent = progressEvents.find((event) => event.stageId === "rewriter" && event.state === "completed");

  assert.ok(criticGate);
  assert.deepEqual(criticGate?.rewriteCandidateIds, criticGate?.criticKeptCandidateIds);
  assert.deepEqual(
    rewriterStage?.inputManifest?.candidates?.passedCandidateIds,
    criticGate?.criticKeptCandidateIds
  );
  assert.equal(rewriterStage?.inputManifest?.candidates?.passedCount, criticGate?.criticKeptCandidateIds.length);
  assert.doesNotMatch(rewriterEvent?.detail ?? "", /reserve/i);
});

test("vnext critic manifest and judged ids exclude packed-invalid candidates instead of silently drifting", async () => {
  const writerCandidates = Array.from({ length: 8 }, (_, index) =>
    makeCandidate(`cand_${index + 1}`, index % 2 === 0 ? "shared_experience" : "payoff_reveal", index + 1)
  );
  writerCandidates[0] = {
    ...writerCandidates[0]!,
    top: "too short",
    bottom: "still too short"
  };
  const criticResponse = Array.from({ length: 8 }, (_, index) => ({
    candidate_id: `cand_${index + 1}`,
    scores: makeCriticScoreMap(index),
    total: 9 - index * 0.1,
    issues: index < 6 ? [] : ["critic rejected this candidate"],
    keep: index < 6
  }));

  const { result } = await runSuccessfulPipeline({
    stage2VNextEnabled: true,
    writerCandidates,
    criticResponse
  });

  const criticStage = result.diagnostics.effectivePrompting.promptStages.find(
    (stage) => stage.stageId === "critic"
  );
  const criticGate = result.output.pipeline.vnext?.criticGate;

  assert.equal(criticStage?.inputManifest?.candidates?.passedCount, 7);
  assert.equal(criticStage?.inputManifest?.candidates?.criticScoreCount, 7);
  assert.equal(criticGate?.evaluatedCandidateIds.length, 7);
  assert.ok(!criticGate?.evaluatedCandidateIds.includes("cand_1"));
});

test("vnext editorial taste gate rejects editorial abstraction candidates before they reach the shortlist", async () => {
  const editorializedCandidates = Array.from({ length: 8 }, (_, index) => ({
    ...makeCandidate(`cand_${index + 1}`, index % 2 === 0 ? "shared_experience" : "payoff_reveal", index + 1),
    top: `The quiet courtroom energy takes over immediately ${index + 1}`,
    bottom: `It turns into anti-confirmation and micro-drama fast ${index + 1}`
  }));
  const recoveryCriticResponse = Array.from({ length: 8 }, (_, index) => ({
    candidate_id: `regen_1_cand_${index + 1}`,
    scores: makeCriticScoreMap(index),
    total: 8.2 - index * 0.1,
    issues: ["editorial abstraction still present"],
    keep: false
  }));

  await assert.rejects(
    () =>
      runSuccessfulPipeline({
        stage2VNextEnabled: true,
        writerCandidates: editorializedCandidates,
        rewrittenCandidates: editorializedCandidates,
        recoveryWriterCandidates: editorializedCandidates,
        recoveryCriticResponse
      }),
    /after one regeneration pass; failing closed/i
  );
});

test("vnext preserves multiple clip-safe audience-shorthand candidates in the visible shortlist", async () => {
  const commentNativeCandidates = Array.from({ length: 8 }, (_, index) => ({
    ...makeCandidate(`cand_${index + 1}`, index % 3 === 0 ? "payoff_reveal" : "shared_experience", index + 1),
    bottom: `"He knew it was bad," and the whole crowd hears it ${index + 1}`
  }));
  commentNativeCandidates[0] = {
    ...commentNativeCandidates[0]!,
    bottom: `"Miles" is the only read people hear by the end 1`
  };
  commentNativeCandidates[1] = {
    ...commentNativeCandidates[1]!,
    bottom: `That "smart AF" reaction lands without forcing it 2`
  };

  const criticResponse = commentNativeCandidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    scores: makeCriticScoreMap(index),
    total: 8.75 - index * 0.08,
    issues: [],
    keep: true
  }));

  const { result } = await runSuccessfulPipeline({
    stage2VNextEnabled: true,
    analyzerResponse: {
      comment_vibe: "fandom shorthand and excited reaction",
      slang_to_adapt: ["Miles", "smart AF"],
      comment_consensus_lane: "Consensus lane keeps calling him Miles.",
      comment_joke_lane: "Joke lane keeps saying smart AF.",
      comment_dissent_lane: ""
    },
    writerCandidates: commentNativeCandidates,
    rewrittenCandidates: commentNativeCandidates,
    criticResponse,
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_2"
    }
  });

  const visibleCandidateIds = result.output.captionOptions.map((candidate) => candidate.candidateId);
  assert.ok(visibleCandidateIds.includes("cand_1"));
  assert.ok(visibleCandidateIds.includes("cand_2"));
  assert.ok(
    result.output.captionOptions.some((candidate) => /\bmiles\b/i.test(`${candidate.top} ${candidate.bottom}`))
  );
  assert.ok(
    result.output.captionOptions.some((candidate) => /smart af/i.test(`${candidate.top} ${candidate.bottom}`))
  );
});

test("vnext fails closed when the visible shortlist is still dominated by legacy weak-hook patterns", async () => {
  const weakHookCandidates = Array.from({ length: 8 }, (_, index) => ({
    ...makeCandidate(`cand_${index + 1}`, index % 2 === 0 ? "shared_experience" : "payoff_reveal", index + 1),
    top: `The truck, the mud, the wheel all keep moving ${index + 1}`
  }));

  await assert.rejects(
    () =>
      runSuccessfulPipeline({
        stage2VNextEnabled: true,
        writerCandidates: weakHookCandidates,
        rewrittenCandidates: weakHookCandidates
      }),
    /visible shortlist quality gate failed/i
  );
});

test("writer, critic, rewriter, and final selector prompts carry comment lanes plus batch sameness signals", () => {
  const channelConfig = {
    channelId: "target",
    name: "Target Channel",
    username: "target_channel",
    hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
    examplesSource: "workspace_default" as const
  };
  const analyzerOutput = {
    visualAnchors: ["cast reaction", "calm aftermath"],
    specificNouns: ["interview couch", "cast", "Scarlett"],
    visibleActions: ["group glitches", "she stays calm"],
    subject: "celebrity interview",
    action: "reacts",
    setting: "press junket",
    firstSecondsSignal: "a simple answer already feels too loaded",
    sceneBeats: ["question lands", "compliment lands", "room melts down"],
    revealMoment: "everyone else glitches while she stays composed",
    lateClipChange: "the calm aftermath makes it funnier",
    stakes: ["social read"],
    payoff: "the room melts down over one line",
    coreTrigger: "one compliment detonates the group chemistry",
    humanStake: "everyone recognizes the social glitch immediately",
    narrativeFrame: "a tiny friend-group malfunction in a polished interview",
    whyViewerCares: "it turns polished celebrity footage into a painfully familiar social beat",
    bestBottomEnergy: "dry amused disbelief",
    commentVibe: "fond chaos with some staged skepticism",
    commentConsensusLane: "Consensus lane loves the group malfunction.",
    commentJokeLane: "Joke lane keeps using Lady Hemsworth as the punchline.",
    commentDissentLane: "A smaller lane says the whole thing feels staged.",
    commentSuspicionLane: "Suspicion lane thinks the blocking is too clean to be accidental.",
    slangToAdapt: ["Lady Hemsworth"],
    commentLanguageCues: ["Lady Hemsworth", "she's so pretty"],
    extractableSlang: ["Lady Hemsworth"],
    hiddenDetail: "Her calm face after the line is the whole payoff.",
    genericRisks: ["flattening it into generic celebrity banter"],
    uncertaintyNotes: [],
    rawSummary: "A single compliment lands, the room glitches, and she stays calm."
  };
  const selectorOutput = {
    clipType: "celebrity interview glitch",
    primaryAngle: "shared_experience",
    secondaryAngles: ["warmth_reverence", "payoff_reveal"],
    rankedAngles: [
      { angle: "shared_experience", score: 9.4, why: "the social glitch is instantly readable" },
      { angle: "warmth_reverence", score: 8.9, why: "the line still feels fond" },
      { angle: "payoff_reveal", score: 8.3, why: "the aftermath reframes the first beat" }
    ],
    coreTrigger: "one teasing compliment detonates the group chemistry",
    humanStake: "everyone recognizes the social glitch immediately",
    narrativeFrame: "a polished interview turning into a private joke",
    whyViewerCares: "it turns celebrity distance into a familiar human glitch",
    topStrategy: "contrast-first context compression",
    bottomEnergy: "dry amused disbelief",
    whyOldV6WouldWorkHere: "it would lock onto the exact second the room glitches",
    failureModes: ["generic celebrity banter", "bottom repeating the top"],
    writerBrief: "Frame the compliment as a tiny social detonation and keep the bottom clip-specific.",
    rationale: "The social glitch is the whole reason the clip works.",
    selectedExampleIds: ["example_1"],
    retrievalConfidence: "low" as const,
    examplesMode: "style_guided" as const,
    examplesRoleSummary: "Examples are weak support only.",
    primaryDriverSummary: "Clip truth and channel learning carry the run."
  };
  const examplesAssessment = makeExamplesAssessment({
    retrievalConfidence: "low",
    examplesMode: "style_guided",
    explanation: "No strong domain-near examples exist for this clip family.",
    retrievalWarning: "Examples are weak support only for this run."
  });
  const candidates = [
    {
      candidateId: "cand_1",
      angle: "shared_experience",
      top: "A basic hair-and-makeup answer turns into a full cast glitch the second Scarlett says it.",
      bottom: "\"Lady Hemsworth\" is funny because she says it and then lets the room panic for her.",
      topRu: "Обычный ответ про грим внезапно ломает весь состав, как только это говорит Скарлетт.",
      bottomRu: "\"Lady Hemsworth\" смешно именно потому, что она это бросает и даёт комнате паниковать самой.",
      rationale: "comment-language version",
      styleDirectionIds: ["core_lane"],
      explorationMode: "aligned" as const
    },
    {
      candidateId: "cand_2",
      angle: "shared_experience",
      top: "A routine junket answer somehow turns into the exact kind of group-chat joke that ruins everyone else.",
      bottom: "\"She's so pretty\" lands once and then the reaction basically writes itself.",
      topRu: "Рутинный junket-ответ внезапно превращается в тот самый групповой прикол, который ломает всех остальных.",
      bottomRu: "\"She's so pretty\" звучит один раз, а дальше реакция будто пишет себя сама.",
      rationale: "generic-tail version",
      styleDirectionIds: ["core_lane"],
      explorationMode: "aligned" as const
    },
    {
      candidateId: "cand_3",
      angle: "warmth_reverence",
      top: "The line is light, but the room reads it like she just flipped the entire seating chart.",
      bottom: "The whole room feels it immediately, and she still looks like this was the safest sentence in the world.",
      topRu: "Фраза лёгкая, но комната читает её так, будто она перевернула всю рассадку.",
      bottomRu: "Это сразу чувствует вся комната, а она всё ещё выглядит так, будто сказала самую безопасную фразу в мире.",
      rationale: "another generic-tail version",
      styleDirectionIds: ["adjacent_lane"],
      explorationMode: "exploratory" as const
    }
  ];

  const writerPrompt = buildWriterPrompt({
    channelConfig,
    analyzerOutput,
    selectorOutput,
    examplesAssessment,
    userInstruction: null,
    promptConfig: normalizeStage2PromptConfig({})
  });
  const criticPrompt = buildCriticPrompt({
    channelConfig,
    analyzerOutput,
    selectorOutput,
    examplesAssessment,
    candidates,
    promptConfig: normalizeStage2PromptConfig({})
  });
  const rewriterPrompt = buildRewriterPrompt({
    channelConfig,
    analyzerOutput,
    selectorOutput,
    examplesAssessment,
    candidates,
    criticScores: candidates.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      scores: makeCriticScoreMap(index),
      total: 9 - index * 0.2,
      issues: [],
      keep: true
    })),
    userInstruction: null,
    promptConfig: normalizeStage2PromptConfig({})
  });
  const finalSelectorPrompt = buildFinalSelectorPrompt({
    channelConfig,
    analyzerOutput,
    selectorOutput,
    examplesAssessment,
    candidates,
    promptConfig: normalizeStage2PromptConfig({})
  });

  assert.match(writerPrompt, /commentConsensusLane/);
  assert.match(writerPrompt, /commentJokeLane/);
  assert.match(writerPrompt, /commentLanguageCues/);
  assert.match(writerPrompt, /"topHookMode":/);
  assert.match(writerPrompt, /"revealPolicy":/);
  assert.match(writerPrompt, /comma-chained object lists/i);
  assert.match(writerPrompt, /plain spoken English/i);
  assert.match(writerPrompt, /pseudo-slang/i);
  assert.match(writerPrompt, /stock continuations/i);
  assert.match(writerPrompt, /high-like comment shorthand, acronym, or nickname/i);
  assert.match(writerPrompt, /reporting or bridge verb such as says, means, proves, shows, or tells/i);
  assert.match(criticPrompt, /"candidateSetSignals":/);
  assert.match(criticPrompt, /"genericTailCandidateIds": \[/);
  assert.match(criticPrompt, /"inventoryOpeningCandidateIds": \[/);
  assert.match(criticPrompt, /"topHookSignals": \{/);
  assert.match(criticPrompt, /"humanPhrasingSignals": \{/);
  assert.match(criticPrompt, /"repeatedBottomTailSignatures": \[/);
  assert.match(criticPrompt, /"examplesMode": "style_guided"/);
  assert.match(criticPrompt, /dominant audience shorthand/i);
  assert.match(criticPrompt, /generic filler was appended after a weak or incomplete core clause/i);
  assert.match(criticPrompt, /candidate topHookSignals are provided/i);
  assert.match(criticPrompt, /candidate humanPhrasingSignals are provided/i);
  assert.match(rewriterPrompt, /"candidateSetSignals":/);
  assert.match(rewriterPrompt, /"explorationMode": "exploratory"/);
  assert.match(rewriterPrompt, /"topHookSignals": \{/);
  assert.match(rewriterPrompt, /"humanPhrasingSignals": \{/);
  assert.match(rewriterPrompt, /hint-don't-fully-spoil/i);
  assert.match(rewriterPrompt, /synthetic editorial English/i);
  assert.match(rewriterPrompt, /Never leave a sentence ending on a reporting or bridge verb/i);
  assert.match(finalSelectorPrompt, /"candidateSetSignals":/);
  assert.match(finalSelectorPrompt, /"styleDirectionIds": \[/);
  assert.match(finalSelectorPrompt, /"explorationMode": "exploratory"/);
  assert.match(finalSelectorPrompt, /"inventoryOpeningCandidateIds": \[/);
  assert.match(finalSelectorPrompt, /"syntheticPhrasingCandidateIds": \[/);
  assert.match(finalSelectorPrompt, /needed repair and still leans on a generic bottom tail/i);
  assert.match(finalSelectorPrompt, /candidate topHookSignals are provided/i);
  assert.match(finalSelectorPrompt, /candidate humanPhrasingSignals are provided/i);
});

test("evaluateTopHookSignals penalizes descriptive setup lists and rewards early hook context", () => {
  const descriptive = evaluateTopHookSignals(
    "Blue felt, cue bridge, white rack, and a line about bringing their own ball. The cut lands when a tiny hamster shows up near the pocket."
  );
  const beatNarration = evaluateTopHookSignals(
    "Players line up, the scene cuts, then the hamster appears and the whole setup changes."
  );
  const hookFirst = evaluateTopHookSignals(
    "The line about bringing your own ball stops sounding metaphorical the second the table gets a tiny live wildcard."
  );

  assert.equal(descriptive.inventoryOpening, true);
  assert.equal(descriptive.earlyHookPresent, false);
  assert.equal(descriptive.scoreAdjustment, -1.2);

  assert.equal(beatNarration.pureBeatNarration, true);
  assert.ok(beatNarration.scoreAdjustment <= -0.7);

  assert.equal(hookFirst.earlyHookPresent, true);
  assert.equal(hookFirst.inventoryOpening, false);
  assert.equal(hookFirst.scoreAdjustment, 0.4);
});

test("evaluateHumanPhrasingSignals penalizes synthetic editorial phrasing and leaves plain spoken lines alone", () => {
  const synthetic = evaluateHumanPhrasingSignals({
    top: "The fan asks for the Spider-Man sign and that half-second pause becomes the whole social question in the room.",
    bottom:
      "That half-second made everyone do instant social math, then the shared-room nod landed like a full rumor wave."
  });
  const plainSpoken = evaluateHumanPhrasingSignals({
    top: "Fan throws the Spider-Man sign at him and he freezes for a sec before deciding what to do.",
    bottom: "It is pure \"right now i can't\" for one beat, then he softens it and keeps the whole thing cute."
  });

  assert.equal(synthetic.syntheticPhrasing, true);
  assert.ok(synthetic.suspiciousPhrases.some((phrase) => /social math|shared-room|social question|rumor wave/i.test(phrase)));
  assert.equal(synthetic.scoreAdjustment, -0.9);

  assert.equal(plainSpoken.syntheticPhrasing, false);
  assert.equal(plainSpoken.inventedCompound, false);
  assert.equal(plainSpoken.scoreAdjustment, 0);
});

test("reveal-style shortlist replaces descriptive billiards inventory tops with hook-first alternatives", async () => {
  const hamsterCandidates = [
    {
      candidate_id: "cand_1",
      angle: "absurdity_chaos",
      top: "Blue felt, cue bridge, white rack, and a line about bringing their own ball. The scene holds like normal pool footage before the table reveals the literal joke way too late.",
      bottom:
        "Nobody at that table reacts like this is a trick shot. It plays like one throwaway sentence quietly rewrote the rules and everybody somehow agreed to keep a straight face.",
      top_ru: "Синее сукно, мостик, белый ряд шаров и фраза про свой шар. Всё держится как обычный пул, пока стол слишком поздно не раскрывает буквальную шутку.",
      bottom_ru:
        "Никто у этого стола не реагирует так, будто это трюк. Всё выглядит так, будто одна дежурная фраза тихо переписала правила, а все решили не ломать лицо.",
      rationale: "descriptive inventory opening"
    },
    {
      candidate_id: "cand_2",
      angle: "payoff_reveal",
      top: "The 'bring your own ball' line hangs there just long enough to sound normal, which is exactly why the table feels one cut away from a very literal punchline.",
      bottom:
        "That is the kind of dumb reveal people love because nobody oversells it. The room just lets one tiny rule violation walk in and finish the sentence for them.",
      top_ru: "Фраза про свой шар висит ровно столько, чтобы звучать нормально, и именно поэтому стол кажется в одном кадре от слишком буквального панчлайна.",
      bottom_ru:
        "Это тот самый глупый ривил, который люди любят именно потому, что никто его не переигрывает. Комната просто даёт крошечному нарушению правил самой закончить фразу.",
      rationale: "hint-first reveal setup"
    },
    {
      candidate_id: "cand_3",
      angle: "shared_experience",
      top: "The joke works because the pool-table setup stays serious long enough for your brain to lock into normal etiquette before the clip cashes out the wrong kind of substitute.",
      bottom:
        "Everybody instantly gets why that lands. It is not chaos for chaos's sake, it is one deadpan social read turning into the most polite foul you have ever seen.",
      top_ru: "Шутка работает потому, что сетап бильярда остаётся серьёзным ровно столько, чтобы мозг успел поверить в нормальный этикет до неправильной замены.",
      bottom_ru:
        "Все сразу понимают, почему это срабатывает. Это не хаос ради хаоса, а один сухой социальный рид, который превращается в самый вежливый фол в жизни.",
      rationale: "shared-experience hook"
    },
    {
      candidate_id: "cand_4",
      angle: "absurdity_chaos",
      top: "Pool talk is supposed to stay metaphorical, so the whole setup gets funnier once you realize the clip is baiting you into waiting for the most literal version of that sentence.",
      bottom:
        "What sells it is how little anybody has to explain. The table gets one tiny live wildcard, and the joke lands like everybody already knew the house rules were doomed.",
      top_ru: "Разговор про пул должен оставаться метафорой, поэтому сетап становится смешнее, когда понимаешь: клип заманивает тебя в максимально буквальную версию этой фразы.",
      bottom_ru:
        "Продаёт это именно то, как мало кому надо объяснять. Стол получает крошечный живой вайлдкард, и шутка падает так, будто правила дома уже были обречены.",
      rationale: "paradox-first framing"
    },
    {
      candidate_id: "cand_5",
      angle: "insider_expertise",
      top: "If you know pool language, the setup gets better fast because 'bring your own ball' should be harmless banter, not the warning sign that the clip is about to go fully literal.",
      bottom:
        "That is why the reaction stays so calm. Everybody there reads the foul and the punchline at the same time, and neither one needs a dramatic narrator to work.",
      top_ru: "Если ты знаешь язык пула, сетап становится лучше очень быстро: «принеси свой шар» должен быть безобидной шуткой, а не сигналом к полному буквальному ривилу.",
      bottom_ru:
        "Вот почему реакция остаётся такой спокойной. Все одновременно считывают и фол, и панчлайн, и ни одному из них не нужен драматичный рассказчик.",
      rationale: "insider-recognition setup"
    },
    {
      candidate_id: "cand_6",
      angle: "payoff_reveal",
      top: "The 'own ball' line stops sounding metaphorical almost immediately, so the whole table starts feeling like it is waiting for one tiny live punchline to cross the felt.",
      bottom:
        "That is why the reveal feels so clean. Nobody has to scream, because one little wildcard turns a normal pool sentence into the most obvious joke in the room.",
      top_ru: "Фраза про свой шар почти сразу перестаёт звучать как метафора, и весь стол начинает ждать, когда по сукну пройдёт крошечный живой панчлайн.",
      bottom_ru:
        "Вот почему ривил кажется таким чистым. Никому не надо кричать, потому что один маленький вайлдкард превращает обычную пуловую фразу в самую очевидную шутку в комнате.",
      rationale: "clean early-hook replacement"
    },
    {
      candidate_id: "cand_7",
      angle: "shared_experience",
      top: "The setup is funny because it treats a dead-serious pool phrase like something that should survive a very obvious literal reading for even one more second.",
      bottom:
        "The room does the exact right thing by not forcing it. They just let the literal read walk past the balls and trust the audience to catch up on its own.",
      top_ru: "Сетап смешной именно потому, что держит предельно серьёзную фразу из пула так, будто она переживёт ещё секунду буквального прочтения.",
      bottom_ru:
        "Комната делает всё правильно тем, что не форсирует момент. Все просто дают буквальному прочтению пройти мимо шаров и доверяют зрителю догнаться самому.",
      rationale: "reserve reveal option"
    },
    {
      candidate_id: "cand_8",
      angle: "absurdity_chaos",
      top: "The normal billiards rhythm is doing all the work here, because it convinces you the line is harmless right before the clip cashes it out in the dumbest possible way.",
      bottom:
        "That payoff only works because nobody decorates it. The table gets one ridiculous loophole, and the joke lands with the same calm confidence as a legal break shot.",
      top_ru: "Обычный ритм бильярда тут и делает всю работу, потому что убеждает тебя в безобидности фразы прямо перед самым глупым буквальным выходом.",
      bottom_ru:
        "Этот payoff работает только потому, что никто его не украшает. Стол получает одну нелепую лазейку, и шутка ложится с той же спокойной уверенностью, что и легальный брейк.",
      rationale: "reserve absurdity option"
    }
  ];

  const criticResponse = hamsterCandidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    scores: makeCriticScoreMap(index),
    total:
      candidate.candidate_id === "cand_1"
        ? 9.0
        : candidate.candidate_id === "cand_6"
          ? 8.9
          : 8.6 - index * 0.05,
    issues: [],
    keep: true
  }));

  const { result } = await runSuccessfulPipeline({
    videoContextOverrides: {
      sourceUrl: "https://example.com/hamster-pool",
      title: "Someone said they'd bring their own ball to pool",
      description: "A normal billiards setup turns into a literal joke once a white hamster hits the table.",
      transcript: "I'm bringing my own ball. What do you mean? Wait. No way.",
      frameDescriptions: [
        "first-person billiards setup on blue felt",
        "text about bringing your own ball",
        "small white hamster appears near the pocket"
      ],
      userInstruction: "Keep it playful and hook-first."
    },
    comments: [
      { author: "viewer_1", likes: 2100, text: "2500 code" },
      { author: "viewer_2", likes: 1400, text: "bro really brought his own ball" },
      { author: "viewer_3", likes: 900, text: "technically that's a foul and I respect it" }
    ],
    analyzerResponse: {
      visual_anchors: ["blue billiards felt", "cue bridge over the table", "white hamster near the pocket"],
      specific_nouns: ["cue stick", "blue table", "white hamster", "corner pocket"],
      visible_actions: [
        "the pool-table setup holds like a normal game",
        "text says someone brought their own ball",
        "a white hamster appears near the pocket"
      ],
      subject: "pool-table reveal gag",
      action: "turns a pool phrase into a literal joke",
      setting: "billiards hall",
      first_seconds_signal: "It opens like a normal billiards POV clip with casual pool banter.",
      scene_beats: [
        "ordinary billiards setup with text about bringing your own ball",
        "the normal setup holds long enough to sound harmless",
        "the reveal lands when a white hamster appears near the pocket"
      ],
      reveal_moment: "the table suddenly reveals a white hamster as the supposed own ball",
      late_clip_change: "the joke only fully locks once the hamster appears and makes the pool phrase literal",
      stakes: ["absurdity", "shared laugh"],
      payoff: "the phrase about bringing your own ball turns literal",
      core_trigger: "normal pool banter flips into a literal reveal with a live hamster on the table",
      human_stake: "viewers get the joke in one second because the setup feels normal right before the reveal goes too literal",
      narrative_frame: "casual pool language gets turned into a literal visual punchline",
      why_viewer_cares: "the clip makes a normal line feel safe, then cashes it out in a fast absurd reveal",
      best_bottom_energy: "dry amused disbelief",
      comment_vibe: "laughing approval with billiards-rule jokes",
      slang_to_adapt: ["2500 code"],
      comment_language_cues: ["2500 code", "brought his own ball"],
      hidden_detail: "The audience keeps circling one compact punchline: \"2500 code\".",
      generic_risks: ["flattening it into cute-animal randomness and missing the literal wording payoff"],
      raw_summary: "A normal billiards setup holds just long enough before a white hamster appears as the literal own ball."
    },
    selectorResponse: {
      clip_type: "POV billiards reveal gag with literal-misread punchline",
      primary_angle: "absurdity_chaos",
      secondary_angles: ["payoff_reveal", "shared_experience"],
      top_strategy: "contrast-first context compression",
      bottom_energy: "dry amused disbelief",
      selection_rationale: "The best lines set up the normal pool read fast, then let the literal reveal do the punchline work.",
      writer_brief:
        "Set up the normal billiards read fast, make the literal misread feel inevitable, and do not let TOP collapse into a table inventory.",
      confidence: 0.88
    },
    writerCandidates: hamsterCandidates,
    rewrittenCandidates: hamsterCandidates,
    criticResponse,
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_1",
      rationale: "Candidate 1 sounds the most descriptive and grounded."
    }
  });

  const visibleTops = result.output.captionOptions.map((option) => option.top);
  assert.equal(
    result.output.captionOptions.some((option) => option.candidateId === "cand_1"),
    false
  );
  assert.equal(
    result.output.captionOptions.some((option) => option.candidateId === "cand_6"),
    true
  );
  assert.equal(
    visibleTops.some((top) => /Blue felt, cue bridge, white rack/i.test(top)),
    false
  );
  assert.equal(
    visibleTops.some((top) => /stops sounding metaphorical|literal punchline|waiting for one tiny live punchline/i.test(top)),
    true
  );
  assert.ok(
    result.output.pipeline.finalSelector?.shortlistStats?.topSignalSummary?.visibleCandidateSignals.every(
      (signal) => !(signal.inventoryOpening && !signal.earlyHookPresent)
    )
  );
});

test("buildPromptPacket keeps comments-aware slang and generic suspicion details in analyzer context", () => {
  const service = new ViralShortsWorkerService();
  const packet = service.buildPromptPacket({
    channel: {
      id: "target",
      name: "Target Channel",
      username: "target_channel",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: false,
        customExamples: [
          makeExample({
            id: "tcg_pack",
            ownerChannelId: "cards",
            ownerChannelName: "Card Source",
            title: "Insane god pack reveal",
            overlayTop: "The rip goes from normal pack opening to a full art pile instantly.",
            overlayBottom: "You can hear the collector disbelief before the stack even settles.",
            clipType: "tcg_pack_reveal",
            whyItWorks: ["god-pack language is already in the audience read"],
            qualityScore: 0.94
          })
        ]
      },
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/god-pack",
      title: "Pokemon god pack reveal with huge reaction",
      description: "The card pile keeps escalating and viewers start suspecting the pack was pre-opened.",
      transcript: "Bro that is a god pack, no way that was sealed clean.",
      frameDescriptions: [
        "foil card stack starts normal",
        "full art cards keep stacking",
        "money counter overlay jumps fast"
      ],
      comments: [
        { author: "viewer_1", likes: 1200, text: "bro got a literal god pack" },
        { author: "viewer_2", likes: 780, text: "that scooby doo laugh killed me" },
        { author: "viewer_3", likes: 620, text: "pack looked pre-opened not gonna lie" }
      ]
    }),
    promptConfig: normalizeStage2PromptConfig({})
  });

  assert.ok(packet.context.analyzerOutput.slangToAdapt.some((cue) => /god pack/i.test(cue)));
  assert.match(packet.context.analyzerOutput.hiddenDetail, /staging|tampering|fakery|face value/i);
  assert.doesNotMatch(packet.context.analyzerOutput.hiddenDetail, /pre-opened|resealed/i);
  assert.match(packet.prompts.selector, /god pack/i);
  assert.match(packet.prompts.selector, /scooby/i);
});

test("repairCandidateForHardConstraints no longer injects quote wrappers into bottom text", () => {
  const repaired = repairCandidateForHardConstraints(
    {
      candidateId: "cand_quote",
      angle: "payoff_reveal",
      top: "The axle is already twisting before the truck even clears the rut.",
      bottom: "He knew that sound meant the whole weekend just got expensive.",
      topRu: "Мост уже выкручивает, пока машина еще не вышла из колеи.",
      bottomRu: "Он уже понял по звуку, что эти выходные всем обойдутся дороже.",
      rationale: "Bottom should stay readable without forced quote injection."
    },
    DEFAULT_STAGE2_HARD_CONSTRAINTS
  );

  assert.equal(repaired.valid, true);
  assert.equal(repaired.repaired, false);
  assert.equal(
    repaired.candidate.bottom,
    "He knew that sound meant the whole weekend just got expensive."
  );
});

test("repairCandidateForHardConstraints rejects short bottoms instead of padding them with unrelated filler", () => {
  const repaired = repairCandidateForHardConstraints(
    {
      candidateId: "cand_short_bottom",
      angle: "payoff_reveal",
      top: "The nominee grid keeps stacking TV heavyweights until the category looks completely unfair.",
      bottom: "\"That lineup is stupid.\"",
      topRu: "Сетка номинантов становится настолько плотной, что категория выглядит уже просто нечестной.",
      bottomRu: "\"Этот состав просто безумный.\"",
      rationale: "Short quoted bottom needs neutral padding."
    },
    {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 18,
      topLengthMax: 120,
      bottomLengthMin: 120,
      bottomLengthMax: 140
    }
  );

  assert.equal(repaired.valid, false);
  assert.equal(repaired.repaired, false);
  assert.equal(repaired.candidate.bottom, "\"That lineup is stupid.\"");
  assert.doesNotMatch(repaired.candidate.bottom, /jeep|lost that exchange|reaction basically writes itself|whole room feels it/i);
});

test("repairCandidateForHardConstraints removes dangling fragment endings before final validation", () => {
  const repaired = repairCandidateForHardConstraints(
    {
      candidateId: "cand_dangling_fragment",
      angle: "payoff_reveal",
      top: "The money counter spikes so hard it looks like the pack just.",
      bottom: "\"That stack is unreal,\" and the whole table reacts at once.",
      topRu: "Счетчик подпрыгивает так резко, будто эта пачка просто.",
      bottomRu: "\"Эта пачка нереальная\", и это считывает весь стол.",
      rationale: "Broken fragment should not survive."
    },
    {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 18,
      topLengthMax: 120
    }
  );

  assert.equal(repaired.valid, true);
  assert.doesNotMatch(repaired.candidate.top, /just\.$/i);
  assert.doesNotMatch(repaired.candidate.top, /like the pack\.$/i);
});

test("repairCandidateForHardConstraints rejects short bottoms trimmed from reporting-verb cliffhangers", () => {
  const repaired = repairCandidateForHardConstraints(
    {
      candidateId: "cand_reporting_verb",
      angle: "shared_experience",
      top: "The armored vehicle hops so far sideways that the crowd behind the barrier already steps back before the dust even clears.",
      bottom: "That little hop backward from the spectators says.",
      topRu: "Бронемашину так уводит вбок, что толпа за ограждением отшатывается еще до того, как оседает пыль.",
      bottomRu: "Этот маленький шаг назад от зрителей говорит.",
      rationale: "A reporting-verb cliffhanger should not be rescued with stock filler."
    },
    {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 18,
      topLengthMax: 140,
      bottomLengthMin: 120,
      bottomLengthMax: 140
    }
  );

  assert.equal(repaired.valid, false);
  assert.equal(repaired.repaired, true);
  assert.doesNotMatch(repaired.candidate.bottom, /\bsays\.$/i);
});

test("comment intelligence keeps high-like acronym shorthand and self-own punchlines from non-TCG clips", async () => {
  const { result } = await runSuccessfulPipeline({
    comments: [
      {
        author: "viewer_1",
        likes: 3300,
        text: "The SADF doesn't need an enemy, they'll eliminate themselves!"
      },
      {
        author: "viewer_2",
        likes: 1400,
        text: "And I present to you our elite SADF"
      },
      {
        author: "viewer_3",
        likes: 1100,
        text: "Just a normal day in South Africa"
      },
      {
        author: "viewer_4",
        likes: 900,
        text: "Taxi driver in SANDF....also learned to drive on his play station"
      }
    ]
  });

  assert.ok(
    result.diagnostics.analysis.slangToAdapt?.some((cue) => /SADF|SANDF/i.test(cue))
  );
  assert.ok(
    result.diagnostics.analysis.commentLanguageCues?.some((cue) =>
      /SADF|SANDF|normal day in South Africa|Taxi driver/i.test(cue)
    )
  );
  assert.match(
    result.diagnostics.analysis.commentJokeLane ?? "",
    /SADF|SANDF|normal day in South Africa|Taxi driver/i
  );
});

test("final selector falls back to a cleaner visible pick when the requested winner is repaired and generic-tailed", async () => {
  const requestedWinnerBottom =
    "\"That lineup is stupid.\" Once that lands, the reaction basically writes itself.";
  const { result } = await runSuccessfulPipeline({
    writerCandidates: [
      {
        candidate_id: "cand_1",
        angle: "shared_experience",
        top: "The lineup is so overloaded with obvious ringers that the whole room clocks the joke before anyone even gets to pretend otherwise at all.",
        bottom: requestedWinnerBottom,
        top_ru: "Состав настолько перегружен очевидными фаворитами, что зал считывает шутку еще до того, как кто-то пытается сделать вид, будто все честно.",
        bottom_ru: requestedWinnerBottom,
        rationale: "generic-tailed requested winner"
      },
      {
        candidate_id: "cand_2",
        angle: "shared_experience",
        top: "The lineup gets so unfair so fast that everyone watching already knows which name turned the whole category into a joke.",
        bottom: "\"That lineup is stupid\" works because everybody there reaches the exact same conclusion half a second later.",
        top_ru: "Состав становится таким нечестным так быстро, что все уже заранее знают, какое имя превратило всю категорию в прикол.",
        bottom_ru: "\"Этот состав просто безумный\" работает именно потому, что все в зале приходят к тому же выводу через полсекунды.",
        rationale: "cleaner alternative"
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        candidate_id: `cand_${index + 3}`,
        angle: index % 2 === 0 ? "payoff_reveal" : "warmth_reverence",
        top: `Reserve candidate ${index + 3} keeps the lineup tension readable without flattening the joke into filler language for the room.`,
        bottom: `Reserve candidate ${index + 3} stays specific to the clip instead of leaning on a generic reaction tail for the whole batch.`,
        top_ru: `Резервный вариант ${index + 3} сохраняет напряжение состава без того, чтобы сплющивать шутку в шаблонный хвост.`,
        bottom_ru: `Резервный вариант ${index + 3} остается конкретным по клипу и не опирается на универсальную реакцию для всего батча.`,
        rationale: `reserve ${index + 3}`
      }))
    ],
    rewrittenCandidates: [
      {
        candidate_id: "cand_1",
        angle: "shared_experience",
        top: "The lineup is so overloaded with obvious ringers that the whole room clocks the joke before anyone even gets to pretend otherwise.",
        bottom: requestedWinnerBottom,
        top_ru: "Состав настолько перегружен очевидными фаворитами, что зал считывает шутку еще до того, как кто-то успевает сделать вид, будто все иначе.",
        bottom_ru: requestedWinnerBottom,
        rationale: "rewritten generic-tailed requested winner"
      },
      {
        candidate_id: "cand_2",
        angle: "shared_experience",
        top: "The lineup gets unfair so fast that everyone watching already knows which name turned the whole category into a joke.",
        bottom: "\"That lineup is stupid\" works because everybody there reaches the same conclusion half a second later.",
        top_ru: "Состав становится нечестным так быстро, что все уже понимают, какое имя превратило всю категорию в прикол.",
        bottom_ru: "\"Этот состав просто безумный\" работает именно потому, что все в зале приходят к тому же выводу через полсекунды.",
        rationale: "rewritten cleaner alternative"
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        candidate_id: `cand_${index + 3}`,
        angle: index % 2 === 0 ? "payoff_reveal" : "warmth_reverence",
        top: `Reserve rewrite ${index + 3} keeps the lineup readable without flattening the joke into stock filler language for the room.`,
        bottom: `Reserve rewrite ${index + 3} stays specific to the clip instead of leaning on a generic reaction tail for the batch.`,
        top_ru: `Резервный рерайт ${index + 3} сохраняет читаемость состава и не сплющивает шутку в шаблонный хвост.`,
        bottom_ru: `Резервный рерайт ${index + 3} остается конкретным по клипу и не опирается на универсальную реакцию для батча.`,
        rationale: `rewritten reserve ${index + 3}`
      }))
    ],
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_1"
    }
  });

  assert.equal(result.output.pipeline?.finalSelector?.finalPickCandidateId, "cand_2");
  assert.equal(result.output.finalPick.option, 2);
  assertFinalShortlistContract(result);
});

test("pipeline does not invent canned fallback tails when repeated contaminated bottoms remain", async () => {
  const contaminatedTail = "Everybody in that jeep knows exactly who lost that exchange.";
  const writerCandidates = Array.from({ length: 8 }, (_, index) => ({
    candidate_id: `cand_${index + 1}`,
    angle: index < 3 ? "awe_scale" : index < 6 ? "shared_experience" : "warmth_reverence",
    top: `The nominee montage keeps adding heavier names until the whole category feels absurd ${index + 1}.`,
    bottom:
      index < 5
        ? `"This lineup is brutal." ${contaminatedTail}`
        : `"That category had no soft landing." The winner standing up ${index + 1} confirms what the lineup already promised.`,
    top_ru: `Монтаж номинантов становится все тяжелее и тяжелее, пока сама категория не выглядит абсурдной ${index + 1}.`,
    bottom_ru:
      index < 5
        ? `"Этот состав безумный." ${contaminatedTail}`
        : `"В этой категории не было легкой победы." Подъем победителя ${index + 1} подтверждает то, что зал уже понял по самому абсурдному составу.`,
    rationale: `candidate ${index + 1}`
  }));
  const rewrittenCandidates = writerCandidates.slice(0, 5).map((candidate) => ({
    ...candidate,
    top: candidate.top,
    bottom: `"This lineup is brutal." ${contaminatedTail}`
  }));

  const { result } = await runSuccessfulPipeline({
    writerCandidates,
    rewrittenCandidates,
    finalSelectorResponse: {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_1"
    }
  });

  assert.equal(
    result.output.captionOptions.some((option) =>
      /the whole room feels it immediately|nobody there can shrug (?:it|that) off|reaction basically writes itself|everybody in the shot gets the same message/i.test(
        option.bottom
      )
    ),
    false
  );
  assertFinalShortlistContract(result);
});

test("pipeline fails explicitly instead of fabricating new stock-tail variants when reserve pool cannot supply cleaner replacements", async () => {
  const contaminatedTail = "Once that lands, the reaction basically writes itself.";
  const duplicatedBottom = `"That pack is stupid." ${contaminatedTail}`;
  const duplicatedCandidates = Array.from({ length: 8 }, (_, index) => ({
    candidate_id: `cand_${index + 1}`,
    angle: index % 2 === 0 ? "payoff_reveal" : "shared_experience",
    top: `The foil stack keeps escalating until the pull reads like a planted god pack ${index + 1}.`,
    bottom: duplicatedBottom,
    top_ru: `Стопка фойлы продолжает расти, пока вскрытие не начинает выглядеть как подставной god pack ${index + 1}.`,
    bottom_ru: duplicatedBottom,
    rationale: `candidate ${index + 1}`
  }));

  await assert.rejects(
    () =>
      runSuccessfulPipeline({
        writerCandidates: duplicatedCandidates,
        rewrittenCandidates: duplicatedCandidates,
        stage2HardConstraints: {
          ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
          bottomLengthMin: 120,
          bottomLengthMax: 140
        },
        finalSelectorResponse: {
          final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
          final_pick: "cand_1"
        }
      }),
    /could not produce 5 valid options after constraint-safe repair and reserve backfill/i
  );
});

test("no-comments fallback stays truthful and preserves analyzer sequence diagnostics", async () => {
  const { executor, result } = await runSuccessfulPipeline({
    comments: []
  });

  assert.match(result.output.inputAnalysis.commentVibe, /Comments unavailable/i);
  assert.ok(result.warnings.some((warning) => warning.field === "comments"));
  assert.match(executor.calls[0]?.prompt ?? "", /\"commentsAvailable\": false/);
  assert.ok(result.diagnostics.analysis.sceneBeats.length > 0);
  assert.match(result.diagnostics.analysis.commentVibe, /Comments unavailable/i);
  assert.ok(
    result.diagnostics.analysis.uncertaintyNotes.some((note) => /Comments were unavailable/i.test(note))
  );
});

test("TOM-spoiler handle test keeps an audience-locked finalist when the public read is safe", async () => {
  const harness = createNativeCaptionPipelineHarness({
    hardConstraints: RELAXED_NATIVE_HARD_CONSTRAINTS,
    responses: [
      [
        makeNativeCaptionCandidateFixture({
          candidateId: "C01",
          topLength: 80,
          bottomLength: 100,
          laneId: "audience_locked",
          retainedHandle: true,
          topText: "Tom spoiler energy takes over the whole clip the second that pause lands in the room.",
          bottomText: "Everybody already reads the look the same way, so the caption should not pretend the room missed it."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C02",
          topLength: 80,
          bottomLength: 100,
          laneId: "balanced_clean",
          topText: "The pause flips the whole moment from casual setup into something everyone instantly clocks.",
          bottomText: "It lands because the reaction is already there before anyone has to explain what changed."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C03",
          topLength: 80,
          bottomLength: 100,
          laneId: "balanced_clean",
          topText: "That tiny pause becomes the why-care before the clip even has time to move on.",
          bottomText: "The room gives away the social read immediately, which is why the line has to stay human."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C04",
          topLength: 80,
          bottomLength: 100,
          laneId: "human_observational",
          topText: "You can feel the room shift the second the silence gets a little too loud to ignore.",
          bottomText: "Nobody needs extra explanation once the faces in the shot are already doing the talking."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C05",
          topLength: 80,
          bottomLength: 100,
          laneId: "backup_simple",
          topText: "The clip works because the pause itself becomes the whole event almost instantly.",
          bottomText: "It stays readable when the caption trusts the shared reaction instead of sanding it into sludge."
        })
      ],
      {
        finalists: [
          {
            candidate_id: "C02",
            why_chosen: ["Cleaner opening."],
            preserved_handle: false
          },
          {
            candidate_id: "C03",
            why_chosen: ["Balanced and readable."],
            preserved_handle: false
          },
          {
            candidate_id: "C04",
            why_chosen: ["Human observational lane."],
            preserved_handle: false
          }
        ],
        display_safe_extras: [
          {
            candidate_id: "C01",
            why_display_safe: ["Valid but flatter than the cleaner picks."]
          },
          {
            candidate_id: "C05",
            why_display_safe: ["Plain backup."]
          }
        ],
        hard_rejected: [],
        winner_candidate_id: "C02",
        recovery_plan: {
          required: false,
          missing_count: 0,
          briefs: []
        }
      },
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Tom handle title ${index + 1}`
      }))
    ]
  });

  const result = await harness.run();
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(
    (result.output.finalists ?? []).some(
      (finalist) => finalist.candidateId === "C01" && finalist.preservedHandle
    ),
    true
  );
  assert.equal(
    result.output.captionOptions.find((option) => option.candidateId === "C01")?.displayTier,
    "finalist"
  );
  assert.equal(result.output.winner?.candidateId, "C02");
});

test("Echoes audience-wave test keeps the window-seat disbelief lane alive instead of letting flatter clean copy auto-win", async () => {
  const baseContextPacket = makeNativeCaptionContextPacket();
  const contextPacket = {
    ...baseContextPacket,
    audienceWave: {
      ...baseContextPacket.audienceWave,
      emotionalTemperature: "awe and disbelief",
      dominantHarmlessHandle: "window-seat disbelief",
      consensusLane: "Everyone is reacting through that window-seat disbelief read.",
      jokeLane: "window-seat disbelief",
      safeReusableCues: ["window-seat disbelief"],
      flatteningRisks: ["dry generic safety"],
      mustNotLose: ["window-seat disbelief"]
    },
    strategy: {
      ...baseContextPacket.strategy,
      requiredLanes: [
        {
          laneId: "audience_locked",
          count: 3,
          purpose: "Keep the window-seat disbelief lane alive."
        },
        {
          laneId: "balanced_clean",
          count: 2,
          purpose: "Keep the clip native without sanding it flat."
        },
        {
          laneId: "backup_simple",
          count: 1,
          purpose: "Hold one plain fallback."
        }
      ]
    }
  };
  const harness = createNativeCaptionPipelineHarness({
    hardConstraints: RELAXED_NATIVE_HARD_CONSTRAINTS,
    contextPacket,
    responses: [
      [
        makeNativeCaptionCandidateFixture({
          candidateId: "C01",
          topLength: 88,
          bottomLength: 108,
          laneId: "audience_locked",
          retainedHandle: true,
          topText: "Window-seat disbelief is the whole reason this clip lands before anyone can even add commentary.",
          bottomText: "That shared read is already doing the work, so flattening it into cleaner copy would miss the moment."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C02",
          topLength: 88,
          bottomLength: 108,
          laneId: "balanced_clean",
          topText: "The shot gets interesting because the room tips from calm into disbelief in one beat.",
          bottomText: "It stays strong when the caption lets the visible reaction carry the weight instead of overexplaining."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C03",
          topLength: 88,
          bottomLength: 108,
          laneId: "balanced_clean",
          topText: "The whole scene changes the second everyone in frame realizes they are all seeing the same thing.",
          bottomText: "That is why the line has to sound like a person reacting, not a safer rewrite of the obvious."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C04",
          topLength: 88,
          bottomLength: 108,
          laneId: "human_observational",
          topText: "The first reaction tells you why viewers latch onto this clip long before the sequence is over.",
          bottomText: "Once the faces in frame change, the why-care is already locked in without any fake certainty."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C05",
          topLength: 88,
          bottomLength: 108,
          laneId: "backup_simple",
          topText: "The visible turn lands early enough that the clip basically explains its own hold on people.",
          bottomText: "What matters is keeping the crowd read alive without turning it into a pasted joke."
        })
      ],
      new Error("editorial court unavailable"),
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Echoes handle title ${index + 1}`
      }))
    ]
  });

  const result = await harness.run();
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.output.winner?.candidateId, "C01");
  assert.equal(result.output.winner?.displayTier, "finalist");
  assert.equal(
    (result.output.finalists ?? []).some((finalist) => finalist.preservedHandle),
    true
  );
});

test("hard-reject display test keeps hard-rejected candidates out of the visible shortlist", async () => {
  const harness = createNativeCaptionPipelineHarness({
    hardConstraints: RELAXED_NATIVE_HARD_CONSTRAINTS,
    responses: [
      [
        makeNativeCaptionCandidateFixture({
          candidateId: "C01",
          topLength: 84,
          bottomLength: 102,
          laneId: "balanced_clean",
          topText: "The moment matters because the pause changes the social read before anything bigger happens.",
          bottomText: "You can feel everyone land on the same interpretation without the caption needing to overstate it."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C02",
          topLength: 84,
          bottomLength: 102,
          laneId: "balanced_clean",
          topText: "That tiny beat becomes the entire hook once the room realizes where the moment is going.",
          bottomText: "It works because the visible reaction keeps sharpening the line instead of asking for explanation."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C03",
          topLength: 84,
          bottomLength: 102,
          laneId: "human_observational",
          topText: "The clip locks in as soon as the silence gets loud enough that the whole room feels it.",
          bottomText: "Once the faces change together, the caption only needs to stay human and visually honest."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C04",
          topLength: 84,
          bottomLength: 102,
          laneId: "backup_simple",
          topText: "The whole reason this clip travels is that the pause becomes bigger than the setup itself.",
          bottomText: "Viewers do not need a recap when the room already gives the social meaning away."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C05",
          topLength: 84,
          bottomLength: 102,
          laneId: "backup_simple",
          topText: "The visible turn lands early enough that the audience read is basically already sitting on screen.",
          bottomText: "That makes a plainer fallback usable as long as it still sounds like a person and not a report."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C06",
          topLength: 84,
          bottomLength: 102,
          laneId: "audience_locked",
          retainedHandle: true,
          topText: "Tom spoiler energy becomes the whole read here even if a flatter caption would look safer on paper.",
          bottomText: "This one should never surface if the phrase itself crosses into non-native nonsense."
        })
      ],
      {
        finalists: [
          {
            candidate_id: "C01",
            why_chosen: ["Best clean line."],
            preserved_handle: false
          },
          {
            candidate_id: "C02",
            why_chosen: ["Strong backup finalist."],
            preserved_handle: false
          },
          {
            candidate_id: "C03",
            why_chosen: ["Useful observational finalist."],
            preserved_handle: false
          }
        ],
        display_safe_extras: [
          {
            candidate_id: "C04",
            why_display_safe: ["Valid soft reject."]
          },
          {
            candidate_id: "C06",
            why_display_safe: ["Would be tempting if it were not too weird."]
          }
        ],
        hard_rejected: [
          {
            candidate_id: "C06",
            reasons: ["H1 invented_or_non_native"],
            offending_phrases: ["Tom spoiler energy"]
          }
        ],
        winner_candidate_id: "C01",
        recovery_plan: {
          required: false,
          missing_count: 0,
          briefs: []
        }
      },
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Hard reject title ${index + 1}`
      }))
    ]
  });

  const result = await harness.run();
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(
    result.output.captionOptions.some((option) => option.candidateId === "C06"),
    false
  );
  assert.equal(
    (result.output.finalists ?? []).some((finalist) => finalist.candidateId === "C06"),
    false
  );
  assert.equal(
    result.output.captionOptions.some((option) => option.candidateId === "C05"),
    true
  );
});

test("soft-reject display test allows display-safe extras to remain visible without promoting them to finalists", async () => {
  const harness = createNativeCaptionPipelineHarness({
    hardConstraints: RELAXED_NATIVE_HARD_CONSTRAINTS,
    responses: [
      [
        makeNativeCaptionCandidateFixture({
          candidateId: "C01",
          topLength: 82,
          bottomLength: 100,
          laneId: "balanced_clean",
          topText: "The pause becomes the whole hook because the room reacts before the clip can move on.",
          bottomText: "That makes the strongest line feel like commentary from inside the moment rather than a recap."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C02",
          topLength: 82,
          bottomLength: 100,
          laneId: "balanced_clean",
          topText: "The social turn lands fast enough that everybody watching already knows why the clip works.",
          bottomText: "It stays alive when the caption lets the reaction sharpen the read instead of cleaning it flat."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C03",
          topLength: 82,
          bottomLength: 100,
          laneId: "human_observational",
          topText: "The shot gets sticky because one small beat changes the mood of the whole room immediately.",
          bottomText: "Once that visible reaction hits, the caption only has to preserve the human read honestly."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C04",
          topLength: 82,
          bottomLength: 100,
          laneId: "backup_simple",
          topText: "The clip keeps its hold because the silence itself becomes more interesting than the setup.",
          bottomText: "A plainer version can still stay visible as long as it sounds human and clip-specific."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C05",
          topLength: 82,
          bottomLength: 100,
          laneId: "backup_simple",
          topText: "The visible turn lands early enough that viewers are already reacting before the clip finishes.",
          bottomText: "That makes this a usable extra even if the finalists have a little more bite."
        })
      ],
      {
        finalists: [
          {
            candidate_id: "C01",
            why_chosen: ["Best finalist."],
            preserved_handle: false
          },
          {
            candidate_id: "C02",
            why_chosen: ["Second finalist."],
            preserved_handle: false
          },
          {
            candidate_id: "C03",
            why_chosen: ["Third finalist."],
            preserved_handle: false
          }
        ],
        display_safe_extras: [
          {
            candidate_id: "C04",
            why_display_safe: ["S1 near-clone of a stronger finalist."]
          },
          {
            candidate_id: "C05",
            why_display_safe: ["S2 valid but less distinctive."]
          }
        ],
        hard_rejected: [],
        winner_candidate_id: "C01",
        recovery_plan: {
          required: false,
          missing_count: 0,
          briefs: []
        }
      },
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Soft reject title ${index + 1}`
      }))
    ]
  });

  const result = await harness.run();
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(
    result.output.captionOptions.filter((option) => option.displayTier === "display_safe_extra").length,
    2
  );
  assert.equal(
    result.output.captionOptions.find((option) => option.candidateId === "C04")?.displayTier,
    "display_safe_extra"
  );
  assert.equal(
    result.output.captionOptions.find((option) => option.candidateId === "C05")?.displayTier,
    "display_safe_extra"
  );
});

test("template-winner test reserves a visible template slot when only display-safe extras survive", async () => {
  const harness = createNativeCaptionPipelineHarness({
    hardConstraints: RELAXED_NATIVE_HARD_CONSTRAINTS,
    responses: [
      [
        makeNativeCaptionCandidateFixture({
          candidateId: "C01",
          topLength: 84,
          bottomLength: 104,
          laneId: "balanced_clean",
          topText: "The pause lands early enough that a clean extra can still describe the moment honestly.",
          bottomText: "This stays usable, but it is not strong enough to carry winner duty on its own."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C02",
          topLength: 84,
          bottomLength: 104,
          laneId: "balanced_clean",
          topText: "The visible turn keeps the clip readable even when the line stays on the cautious side.",
          bottomText: "It works as display-safe cover, but it does not feel like the winner the clip deserves."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C03",
          topLength: 84,
          bottomLength: 104,
          laneId: "human_observational",
          topText: "A valid observational line can stay on screen here without really being finalist-grade.",
          bottomText: "That is exactly when the runtime has to keep the output alive without pretending this can win."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C04",
          topLength: 84,
          bottomLength: 104,
          laneId: "backup_simple",
          topText: "This is readable enough to display, but it still feels more like a placeholder than a pick.",
          bottomText: "The clip remains processable, so the pipeline still owes the user a real valid winner."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C05",
          topLength: 84,
          bottomLength: 104,
          laneId: "backup_simple",
          topText: "Another safe extra can fill the grid, but it should not silently inherit winner status.",
          bottomText: "That is where deterministic template backfill has to step in and make the degraded path honest."
        })
      ],
      {
        finalists: [],
        display_safe_extras: [
          {
            candidate_id: "C01",
            why_display_safe: ["Valid but not finalist-grade."]
          },
          {
            candidate_id: "C02",
            why_display_safe: ["Valid but less distinctive."]
          },
          {
            candidate_id: "C03",
            why_display_safe: ["Human but weaker."]
          },
          {
            candidate_id: "C04",
            why_display_safe: ["Display-safe fallback."]
          },
          {
            candidate_id: "C05",
            why_display_safe: ["Display-safe fallback."]
          }
        ],
        hard_rejected: [],
        winner_candidate_id: null,
        recovery_plan: {
          required: true,
          missing_count: 1,
          briefs: [
            {
              lane_id: "balanced_clean",
              goal: "Generate one winner-grade fallback without flattening the clip.",
              must_keep: ["land the why-care immediately"],
              must_avoid: ["generic clean English"]
            }
          ]
        }
      },
      [],
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Template reserve title ${index + 1}`
      }))
    ]
  });

  const result = await harness.run();
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.output.winner?.displayTier, "template_backfill");
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.degradedSuccess, true);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.templateBackfillCount, 1);
  assert.equal(
    result.output.captionOptions.some((option) => option.displayTier === "template_backfill"),
    true
  );
  assert.equal(result.output.finalPick.option, result.output.winner?.option);
});

test("template backfill still fills the fifth slot when clip words are banned", async () => {
  const harness = createNativeCaptionPipelineHarness({
    hardConstraints: {
      ...RELAXED_NATIVE_HARD_CONSTRAINTS,
      bannedWords: ["clip", "clips"]
    },
    responses: [
      [
        makeNativeCaptionCandidateFixture({
          candidateId: "C01",
          topLength: 84,
          bottomLength: 104,
          laneId: "balanced_clean",
          topText: "The visible turn lands early enough that this safe extra can stay readable without carrying winner duty.",
          bottomText: "It works as coverage, but the stronger public read still needs a real fallback winner."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C02",
          topLength: 84,
          bottomLength: 104,
          laneId: "balanced_clean",
          topText: "The sequence stays understandable even when the line plays it cautious and only holds the room tone.",
          bottomText: "That makes it display-safe, not the kind of option that should inherit the final pick silently."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C03",
          topLength: 84,
          bottomLength: 104,
          laneId: "human_observational",
          topText: "A human observational read can stay on screen here without really feeling like the option to beat.",
          bottomText: "The degraded path still has to stay honest about that instead of pretending a safe extra can win."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C04",
          topLength: 84,
          bottomLength: 104,
          laneId: "backup_simple",
          topText: "This one is readable enough to display, but it still feels more like grid support than a selection.",
          bottomText: "That is exactly where the deterministic fallback path needs to keep one stronger slot alive."
        }),
        makeNativeCaptionCandidateFixture({
          candidateId: "C05",
          topLength: 84,
          bottomLength: 104,
          laneId: "backup_simple",
          topText: "Another safe extra can keep the shortlist full, but it should not quietly turn into the winner.",
          bottomText: "The system still owes the run one valid fallback pick when finalists and recovery both collapse."
        })
      ],
      {
        finalists: [],
        display_safe_extras: [
          {
            candidate_id: "C01",
            why_display_safe: ["Valid but not finalist-grade."]
          },
          {
            candidate_id: "C02",
            why_display_safe: ["Valid but less distinctive."]
          },
          {
            candidate_id: "C03",
            why_display_safe: ["Human but weaker."]
          },
          {
            candidate_id: "C04",
            why_display_safe: ["Display-safe fallback."]
          },
          {
            candidate_id: "C05",
            why_display_safe: ["Display-safe fallback."]
          }
        ],
        hard_rejected: [],
        winner_candidate_id: null,
        recovery_plan: {
          required: true,
          missing_count: 1,
          briefs: [
            {
              lane_id: "balanced_clean",
              goal: "Generate one winner-grade fallback without flattening the public read.",
              must_keep: ["land the why-care immediately"],
              must_avoid: ["generic clean English"]
            }
          ]
        }
      },
      [],
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Banned word fallback title ${index + 1}`
      }))
    ]
  });

  const result = await harness.run();
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.output.winner?.displayTier, "template_backfill");
  assert.equal(result.output.captionOptions.every((option) => option.constraintCheck.passed), true);
  assert.equal(
    result.output.captionOptions.some((option) => /\bclips?\b/i.test(`${option.top} ${option.bottom}`)),
    false
  );
});

test("native runtime degrades through recovery and template backfill when editorial finalists collapse", async () => {
  const harness = createNativeCaptionPipelineHarness({
    responses: [
      [
        makeNativeCaptionCandidateFixture({ candidateId: "C03", topLength: 170, bottomLength: 705 }),
        makeNativeCaptionCandidateFixture({ candidateId: "C06", topLength: 170, bottomLength: 455 }),
        makeNativeCaptionCandidateFixture({ candidateId: "C07", topLength: 170, bottomLength: 450 })
      ],
      {
        kept: [
          {
            candidate_id: "C03",
            scores: {
              hook_immediacy: 9,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 7,
              bottom_usefulness: 8
            },
            why_it_works: ["good top"]
          },
          {
            candidate_id: "C06",
            scores: {
              hook_immediacy: 9,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 7,
              bottom_usefulness: 8
            },
            why_it_works: ["good top"]
          },
          {
            candidate_id: "C07",
            scores: {
              hook_immediacy: 9,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 7,
              bottom_usefulness: 8
            },
            why_it_works: ["good top"]
          }
        ],
        rejected: [],
        winner_candidate_id: "C06",
        winner_reason: "Judge liked C06 most.",
        needs_repair: false,
        repair_briefs: []
      },
      [],
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Recovered native title ${index + 1}`
      }))
    ],
    hardConstraints: {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 160,
      topLengthMax: 180,
      bottomLengthMin: 140,
      bottomLengthMax: 150
    }
  });

  const result = await harness.run();
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.output.winner?.displayTier, "template_backfill");
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.degradedSuccess, true);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.templateBackfillCount > 0, true);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.recoveryTriggered, true);
  assert.equal(result.output.captionOptions.every((option) => option.constraintCheck.passed), true);
  assert.equal(harness.executor.calls.length, 6);
  assert.match(harness.executor.calls[2]?.prompt ?? "", /recovery_briefs_json/i);
});

test("sparse native clip smoke test still returns a degraded 5-option shortlist", async () => {
  const harness = createNativeCaptionPipelineHarness({
    responses: [
      [
        makeNativeCaptionCandidateFixture({ candidateId: "C01", topLength: 165, bottomLength: 430 }),
        makeNativeCaptionCandidateFixture({ candidateId: "C02", topLength: 164, bottomLength: 460 })
      ],
      {
        kept: [
          {
            candidate_id: "C01",
            scores: {
              hook_immediacy: 8,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 8,
              bottom_usefulness: 8
            },
            why_it_works: ["looks promising"]
          },
          {
            candidate_id: "C02",
            scores: {
              hook_immediacy: 8,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 8,
              bottom_usefulness: 8
            },
            why_it_works: ["looks promising"]
          }
        ],
        rejected: [],
        winner_candidate_id: "C01",
        winner_reason: "Judge liked C01 most.",
        needs_repair: false,
        repair_briefs: []
      },
      [],
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Sparse native title ${index + 1}`
      }))
    ],
    hardConstraints: {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 160,
      topLengthMax: 180,
      bottomLengthMin: 140,
      bottomLengthMax: 150
    },
    videoContext: makeSparseNativeVideoContext()
  });

  const result = await harness.run();
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.output.winner?.constraintCheck?.passed, true);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.degradedSuccess, true);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.templateBackfillCount > 0, true);
  assert.equal(harness.executor.calls.length, 6);
  assert.equal(
    harness.executor.calls.some((call) => /winner_candidate_json/i.test(call.prompt)),
    true
  );
});

test("native caption translation retries missing items once and falls back to English when Russian stays missing", async () => {
  const harness = createNativeCaptionPipelineHarness({
    responses: [
      [
        makeNativeCaptionCandidateFixture({
          candidateId: "C01",
          topLength: 72,
          bottomLength: 100,
          laneId: "audience_locked",
          retainedHandle: true
        }),
        makeNativeCaptionCandidateFixture({ candidateId: "C02", topLength: 72, bottomLength: 100 }),
        makeNativeCaptionCandidateFixture({ candidateId: "C03", topLength: 72, bottomLength: 100 }),
        makeNativeCaptionCandidateFixture({ candidateId: "C04", topLength: 72, bottomLength: 100 }),
        makeNativeCaptionCandidateFixture({ candidateId: "C05", topLength: 72, bottomLength: 100 })
      ],
      {
        finalists: [
          {
            candidate_id: "C01",
            why_chosen: ["Best finalist."],
            preserved_handle: true
          }
        ],
        display_safe_extras: [
          { candidate_id: "C02", why_display_safe: ["Valid reserve."] },
          { candidate_id: "C03", why_display_safe: ["Valid reserve."] },
          { candidate_id: "C04", why_display_safe: ["Valid reserve."] },
          { candidate_id: "C05", why_display_safe: ["Valid reserve."] }
        ],
        hard_rejected: [],
        winner_candidate_id: "C01",
        recovery_plan: {
          required: false,
          missing_count: 0,
          briefs: []
        }
      },
      [],
      [
        {
          candidate_id: "C01",
          top_ru: "Переведенный верх для C01.",
          bottom_ru: "Переведенный низ для C01."
        }
      ],
      [],
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Fallback title ${index + 1}`
      }))
    ]
  });

  const result = await harness.run();

  assert.equal(harness.executor.calls.length, 7);
  const captionTranslationCalls = harness.executor.calls.filter((call) =>
    /display_options_json/i.test(call.prompt)
  );
  assert.equal(captionTranslationCalls.length, 2);
  assert.equal(result.output.captionOptions[0]?.topRu, "Переведенный верх для C01.");
  assert.equal(result.output.captionOptions[1]?.topRu, result.output.captionOptions[1]?.top);
  assert.equal(result.output.titleOptions[0]?.titleRu, result.output.titleOptions[0]?.title);
  assert.equal(result.output.pipeline.nativeCaptionV3?.translation?.coverage.translatedCount, 1);
  assert.equal(result.output.pipeline.nativeCaptionV3?.translation?.coverage.fallbackCount, 4);
  assert.deepEqual(
    result.output.pipeline.nativeCaptionV3?.translation?.coverage.retriedCandidateIds,
    ["C02", "C03", "C04", "C05"]
  );
  assert.equal(
    result.warnings.some((warning) => warning.field === "captionTranslation"),
    true
  );
  assert.equal(result.warnings.some((warning) => warning.field === "titleWriter"), true);
});

test("stable_reference_v6 runs through the one-shot reference baseline and keeps the native Stage 2 contract", async () => {
  const videoContext = buildVideoContext({
    sourceUrl: "https://example.com/reference-one-shot",
    title: "A mechanic pauses before the whole room gets it",
    description: "A short clip where the visible pause changes the read.",
    transcript: "He does not even need to say anything after that pause.",
    comments: [
      {
        author: "viewer-one",
        likes: 120,
        text: "that pause said enough"
      },
      {
        author: "viewer-two",
        likes: 88,
        text: "everyone in that room heard it"
      }
    ],
    frameDescriptions: [
      "A mechanic freezes with the wrench still in his hand.",
      "Everyone nearby turns toward the pause instead of the part."
    ],
    userInstruction: "keep the benchmark density"
  });

  const oneShotResponse = {
    analysis: {
      visual_anchors: [
        "the wrench stops mid-air",
        "everyone turns toward the pause",
        "the room reads it before he speaks"
      ],
      comment_vibe: "dry, impressed side-eye",
      key_phrase_to_adapt: "that pause said enough"
    },
    candidates: Array.from({ length: 5 }, (_, index) => ({
      candidate_id: `ref_${index + 1}`,
      top:
        index === 0
          ? "That wrench stops mid-air because everybody in that bay can hear the whole mistake before he says a word, and the clip turns into the second the room reads the pause."
          : `The room stops watching the part and starts watching him the second that pause lands, because the whole bay already knows what that frozen wrench means ${index + 1}.`,
      bottom:
        index === 0
          ? "That isn't dead air, that's every mechanic in there hearing the repair bill at the same time."
          : `That pause said enough, and the whole bay answered it before he ever did, because every mechanic there already heard the bill in it ${index + 1}.`,
      retained_handle: index < 2,
      rationale:
        index === 0
          ? "Best benchmark-style paradox top with a human release."
          : `Variant ${index + 1}`
    })),
    winner_candidate_id: "ref_1",
    titles: Array.from({ length: 5 }, (_, index) => ({
      title: `PAUSE SAID ENOUGH ${index + 1}`,
      title_ru: `ПАУЗА СКАЗАЛА ВСЁ ${index + 1}`
    }))
  };

  const { result, executor } = await runNativeCaptionPipelineDirectFixture({
    stage2WorkerProfileId: "stable_reference_v6",
    promptConfig: normalizeStage2PromptConfig({
      stages: {
        oneShotReference: {
          reasoningEffort: "x-high"
        }
      }
    }),
    hardConstraints: {
      ...RELAXED_NATIVE_HARD_CONSTRAINTS,
      topLengthMin: 140,
      topLengthMax: 210,
      bottomLengthMin: 80,
      bottomLengthMax: 160
    },
    videoContext,
    responses: [oneShotResponse]
  });

  assert.equal(result.output.pipeline.execution?.pipelineVersion, "native_caption_v3");
  assert.equal(result.output.pipeline.execution?.pathVariant, "reference_one_shot_v1");
  assert.equal(result.output.pipeline.workerProfile?.resolvedId, "stable_reference_v6");
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.output.titleOptions.length, 5);
  assert.equal(result.output.winner?.candidateId, "ref_1");
  assert.equal(result.output.finalists?.length, 5);
  assert.equal(result.output.pipeline.nativeCaptionV3?.repair, null);
  assert.equal(result.output.pipeline.nativeCaptionV3?.hardValidator, null);
  assert.equal(result.output.pipeline.nativeCaptionV3?.qualityCourt, null);
  assert.equal(result.output.pipeline.nativeCaptionV3?.templateBackfill, null);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.displayShortlistCount, 5);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.templateBackfillCount, 0);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.degradedSuccess, false);
  assert.equal(
    result.output.captionOptions.every((option) => option.sourceStage === "oneShotReference"),
    true
  );
  assert.equal(
    result.diagnostics.effectivePrompting.promptStages.some((stage) => stage.stageId === "oneShotReference"),
    true
  );
  assert.equal(
    result.diagnostics.effectivePrompting.promptStages.some((stage) => stage.stageId === "candidateGenerator"),
    false
  );
  assert.equal(
    result.diagnostics.effectivePrompting.promptStages.some((stage) => stage.stageId === "titleWriter"),
    false
  );
  assert.match(executor.calls[0]?.prompt ?? "", /"video_truth_json"/);
  assert.match(executor.calls[0]?.prompt ?? "", /"current_comment_wave_json"/);
  assert.match(executor.calls[0]?.prompt ?? "", /"channel_narrative_json"/);
  assert.match(executor.calls[0]?.prompt ?? "", /"editorial_memory_json"/);
  assert.match(executor.calls[0]?.prompt ?? "", /"publishability_contract_json"/);
  assert.match(executor.calls[0]?.prompt ?? "", /"line_profile_json"/);
  assert.match(executor.calls[0]?.prompt ?? "", /"hard_constraints_json"/);
  assert.match(executor.calls[0]?.prompt ?? "", /even 1 character outside/i);
  assert.match(executor.calls[0]?.prompt ?? "", /that pause said enough/i);
  assert.doesNotMatch(executor.calls[0]?.prompt ?? "", /experimental_contract_json/i);
  assert.equal(executor.calls[0]?.reasoningEffort, "x-high");
  assert.equal(
    result.output.captionOptions.every((option) => Boolean(option.topRu) && Boolean(option.bottomRu)),
    true
  );
});

test("stable_reference_v6_experimental uses the isolated one-shot prompt contract and trims comment-wave pressure under weak grounding", async () => {
  const videoContext = buildVideoContext({
    sourceUrl: "https://example.com/reference-one-shot-experimental",
    title: "A mechanic pauses before the whole room gets it",
    description: "",
    transcript: "",
    comments: Array.from({ length: 12 }, (_, index) => ({
      author: `viewer-${index + 1}`,
      likes: 120 - index,
      text: index % 2 === 0 ? "that pause said enough" : "everybody there heard the bill"
    })),
    frameDescriptions: [
      "A mechanic freezes with the wrench still in his hand.",
      "Everyone nearby turns toward the pause instead of the part."
    ],
    userInstruction: "keep the benchmark density"
  });

  const oneShotResponse = {
    analysis: {
      visual_anchors: [
        "the wrench stops mid-air",
        "everyone turns toward the pause",
        "the room reads it before he speaks"
      ],
      comment_vibe: "dry, impressed side-eye",
      key_phrase_to_adapt: "that pause said enough"
    },
    candidates: Array.from({ length: 5 }, (_, index) => ({
      candidate_id: `ref_exp_${index + 1}`,
      top:
        index === 0
          ? "The wrench freezes after the mistake lands, and the whole bay reads the cost of it before anybody there needs to hear the follow-up out loud."
          : `The mistake lands before the explanation does, and the whole bay starts reading his face instead of the part the second that wrench stops ${index + 1}.`,
      bottom:
        index === 0
          ? "That pause turns a normal repair beat into the exact second everybody in the room realizes what the bill is about to become."
          : `Nobody in that bay needs extra narration after that pause, because the silence already cashes out the repair cost for everybody there ${index + 1}.`,
      retained_handle: index < 2,
      rationale: `Experimental variant ${index + 1}`
    })),
    winner_candidate_id: "ref_exp_1",
    titles: Array.from({ length: 5 }, (_, index) => ({
      title: `PAUSE SAID ENOUGH ${index + 1}`,
      title_ru: `ПАУЗА СКАЗАЛА ВСЁ ${index + 1}`
    }))
  };

  const { result, executor } = await runNativeCaptionPipelineDirectFixture({
    stage2WorkerProfileId: "stable_reference_v6_experimental",
    promptConfig: normalizeStage2PromptConfig({
      stages: {
        oneShotReference: {
          reasoningEffort: "x-high"
        }
      }
    }),
    hardConstraints: {
      ...RELAXED_NATIVE_HARD_CONSTRAINTS,
      topLengthMin: 120,
      topLengthMax: 210,
      bottomLengthMin: 80,
      bottomLengthMax: 160
    },
    videoContext,
    responses: [oneShotResponse]
  });

  const oneShotStage = result.diagnostics.effectivePrompting.promptStages.find(
    (stage) => stage.stageId === "oneShotReference"
  );
  assert.equal(result.output.pipeline.execution?.pathVariant, "reference_one_shot_v1_experimental");
  assert.equal(result.output.pipeline.workerProfile?.resolvedId, "stable_reference_v6_experimental");
  assert.equal(oneShotStage?.promptCompatibilityVersion, "reference_one_shot_v1_experimental@2026-04-12");
  assert.equal(oneShotStage?.inputManifest?.comments?.passedCount, 8);
  assert.match(executor.calls[0]?.prompt ?? "", /experimental_contract_json/);
  assert.match(executor.calls[0]?.prompt ?? "", /comments_secondary_hints_only/);
  assert.match(executor.calls[0]?.prompt ?? "", /Do not talk about "the clip", "the video", "the edit"/);
});

test("caption highlighting skips the model pass when template highlighting is disabled", async () => {
  const disabledHighlightProfile = createDefaultTemplateHighlightConfig({
    accentColor: "#65d46e"
  });

  const { result, executor } = await runNativeCaptionPipelineDirectFixture({
    stage2WorkerProfileId: "stable_reference_v6",
    templateHighlightProfile: disabledHighlightProfile,
    hardConstraints: {
      ...RELAXED_NATIVE_HARD_CONSTRAINTS,
      topLengthMin: 20,
      topLengthMax: 220,
      bottomLengthMin: 20,
      bottomLengthMax: 180
    },
    responses: [
      {
        analysis: {
          visual_anchors: ["anchor 1", "anchor 2", "anchor 3"],
          comment_vibe: "dry disbelief",
          key_phrase_to_adapt: "signed for a fan"
        },
        candidates: Array.from({ length: 5 }, (_, index) => ({
          candidate_id: `skip_${index + 1}`,
          top: `In 1980 John Lennon signed for a fan, and the room changed the second the autograph came back ${index + 1}.`,
          bottom: `It looks harmless until the return note turns the whole exchange into something nobody there can laugh off ${index + 1}.`,
          retained_handle: index === 0
        })),
        winner_candidate_id: "skip_1",
        titles: Array.from({ length: 5 }, (_, index) => ({
          title: `SIGNED FOR A FAN ${index + 1}`
        }))
      }
    ]
  });

  assert.equal(
    executor.calls.some((call) => /template_highlight_profile_json/i.test(call.prompt)),
    false
  );
  assert.equal(
    result.output.captionOptions.every(
      (option) => (option.highlights?.top.length ?? 0) === 0 && (option.highlights?.bottom.length ?? 0) === 0
    ),
    true
  );
});

test("caption highlighting turns phrase annotations into exact spans and drops overlaps deterministically", async () => {
  const highlightProfile = createDefaultTemplateHighlightConfig({
    accentColor: "#f6d24a"
  });
  highlightProfile.enabled = true;
  highlightProfile.topEnabled = true;
  highlightProfile.bottomEnabled = true;
  highlightProfile.slots[0].enabled = true;
  highlightProfile.slots[0].label = "Names";
  highlightProfile.slots[0].guidance = "Use for names and named entities.";
  highlightProfile.slots[1].enabled = true;
  highlightProfile.slots[1].label = "Dates";
  highlightProfile.slots[1].guidance = "Use for years and precise dates.";
  highlightProfile.slots[2].enabled = true;
  highlightProfile.slots[2].label = "Escalation";
  highlightProfile.slots[2].guidance = "Use for the sharpest turn or escalation phrase.";

  const candidateTop = "John Lennon signed the album in 1980, and the room changed immediately.";
  const candidateBottom =
    "The autograph felt harmless until hours later turned the whole exchange dark again.";

  const { result, executor } = await runNativeCaptionPipelineDirectFixture({
    stage2WorkerProfileId: "stable_reference_v6",
    templateHighlightProfile: highlightProfile,
    hardConstraints: {
      ...RELAXED_NATIVE_HARD_CONSTRAINTS,
      topLengthMin: 20,
      topLengthMax: 220,
      bottomLengthMin: 20,
      bottomLengthMax: 180
    },
    responses: [
      {
        analysis: {
          visual_anchors: ["anchor 1", "anchor 2", "anchor 3"],
          comment_vibe: "quiet dread",
          key_phrase_to_adapt: "the room changed"
        },
        candidates: Array.from({ length: 5 }, (_, index) => ({
          candidate_id: `highlight_${index + 1}`,
          top:
            index === 0
              ? candidateTop
              : `A stranger thinks the signature is the whole story until the return note changes the room again ${index + 1}.`,
          bottom:
            index === 0
              ? candidateBottom
              : `The exchange looks harmless until the aftermath makes everybody read the moment differently ${index + 1}.`,
          retained_handle: index === 0
        })),
        winner_candidate_id: "highlight_1",
        titles: Array.from({ length: 5 }, (_, index) => ({
          title: `RETURN NOTE ${index + 1}`
        }))
      },
      [
        {
          candidate_id: "highlight_1",
          top: [
            { phrase: "John Lennon", slotId: "slot1" },
            { phrase: "John", slotId: "slot2" },
            { phrase: "1980", slotId: "slot2" }
          ],
          bottom: [
            { phrase: "autograph", slotId: "slot1" },
            { phrase: "hours later", slotId: "slot3" }
          ]
        }
      ]
    ]
  });

  const highlighted = result.output.captionOptions.find((option) => option.candidateId === "highlight_1");
  assert.ok(highlighted);
  assert.deepEqual(
    highlighted?.highlights?.top,
    buildTemplateHighlightSpansFromPhrases({
      text: candidateTop,
      annotations: [
        { phrase: "John Lennon", slotId: "slot1" },
        { phrase: "John", slotId: "slot2" },
        { phrase: "1980", slotId: "slot2" }
      ]
    })
  );
  assert.deepEqual(
    highlighted?.highlights?.bottom,
    buildTemplateHighlightSpansFromPhrases({
      text: candidateBottom,
      annotations: [
        { phrase: "autograph", slotId: "slot1" },
        { phrase: "hours later", slotId: "slot3" }
      ]
    })
  );
  assert.deepEqual(
    highlighted?.highlights?.top,
    [
      { start: 0, end: 11, slotId: "slot1" },
      { start: 32, end: 36, slotId: "slot2" }
    ]
  );
  assert.equal(
    executor.calls.some((call) => /template_highlight_profile_json/i.test(call.prompt)),
    true
  );
});

test("caption highlighting failures stay fail-open and keep the display shortlist intact", async () => {
  const highlightProfile = createDefaultTemplateHighlightConfig({
    accentColor: "#f6d24a"
  });
  highlightProfile.enabled = true;
  highlightProfile.slots[0].enabled = true;

  const { result } = await runNativeCaptionPipelineDirectFixture({
    stage2WorkerProfileId: "stable_reference_v6",
    templateHighlightProfile: highlightProfile,
    hardConstraints: {
      ...RELAXED_NATIVE_HARD_CONSTRAINTS,
      topLengthMin: 20,
      topLengthMax: 220,
      bottomLengthMin: 20,
      bottomLengthMax: 180
    },
    responses: [
      {
        analysis: {
          visual_anchors: ["anchor 1", "anchor 2", "anchor 3"],
          comment_vibe: "dry disbelief",
          key_phrase_to_adapt: "hours later"
        },
        candidates: Array.from({ length: 5 }, (_, index) => ({
          candidate_id: `failopen_${index + 1}`,
          top: `The autograph looked harmless until the return note landed and changed the whole room ${index + 1}.`,
          bottom: `That delay is what makes the clip feel worse, because everybody there realizes it at once ${index + 1}.`,
          retained_handle: index === 0
        })),
        winner_candidate_id: "failopen_1",
        titles: Array.from({ length: 5 }, (_, index) => ({
          title: `HOURS LATER ${index + 1}`
        }))
      },
      new Error("highlight model down")
    ]
  });

  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(Boolean(result.output.winner), true);
  assert.equal(
    result.output.captionOptions.every(
      (option) => (option.highlights?.top.length ?? 0) === 0 && (option.highlights?.bottom.length ?? 0) === 0
    ),
    true
  );
  assert.equal(
    result.warnings.some((warning) => warning.field === "captionHighlighting"),
    true
  );
});

test("stable_reference_v6 fails hard instead of backfilling meta-leaking one-shot output", async () => {
  await assert.rejects(
    () =>
      runNativeCaptionPipelineDirectFixture({
        stage2WorkerProfileId: "stable_reference_v6",
        hardConstraints: {
          ...RELAXED_NATIVE_HARD_CONSTRAINTS,
          topLengthMin: 40,
          topLengthMax: 220,
          bottomLengthMin: 20,
          bottomLengthMax: 180
        },
        responses: [
          {
            analysis: {
              visual_anchors: ["anchor 1", "anchor 2", "anchor 3"],
              comment_vibe: "dry disbelief",
              key_phrase_to_adapt: "that pause said enough"
            },
            candidates: Array.from({ length: 5 }, (_, index) => ({
              candidate_id: `bad_${index + 1}`,
              top:
                index === 3
                  ? "This is frame 4 where the whole room reads it and the narrator starts explaining the manifest."
                  : `Concrete grounded top ${index + 1} keeps the clip readable without filler and still lands the why-care early enough to publish cleanly.`,
              bottom:
                index === 4
                  ? "At 6.32s the option 5 lane kicks in and the debug wording takes over."
                  : `Concrete grounded bottom ${index + 1} keeps the human reaction natural and publishable without meta leakage.`,
              retained_handle: false
            })),
            winner_candidate_id: "bad_1",
            titles: Array.from({ length: 5 }, (_, index) => ({
              title: `PUBLISHABLE TITLE ${index + 1}`
            }))
          }
        ]
      }),
    /Reference one-shot failed\..*(frame index|seconds timestamp|pipeline slot|debug or schema wording)/i
  );
});

test("stable_reference_v6_experimental fails hard on edit, comment-section, and viewer meta commentary", async () => {
  await assert.rejects(
    () =>
      runNativeCaptionPipelineDirectFixture({
        stage2WorkerProfileId: "stable_reference_v6_experimental",
        hardConstraints: {
          ...RELAXED_NATIVE_HARD_CONSTRAINTS,
          topLengthMin: 40,
          topLengthMax: 240,
          bottomLengthMin: 20,
          bottomLengthMax: 180
        },
        responses: [
          {
            analysis: {
              visual_anchors: ["anchor 1", "anchor 2", "anchor 3"],
              comment_vibe: "dry disbelief",
              key_phrase_to_adapt: "that pause said enough"
            },
            candidates: [
              {
                candidate_id: "bad_1",
                top: "The edit gives you the warning first, then the face, then the funeral, so the whole clip starts feeling like accusation instead of tribute.",
                bottom: "The comments keep landing on the same read, and viewers don't need the narrator to push it once that silence takes over.",
                retained_handle: false
              },
              {
                candidate_id: "bad_2",
                top: "Grounded context top 2 keeps the event readable and specific without slipping into commentary about the media object at all.",
                bottom: "Grounded human bottom 2 keeps the reaction in-world and publishable without audience commentary.",
                retained_handle: false
              },
              {
                candidate_id: "bad_3",
                top: "Grounded context top 3 keeps the event readable and specific without slipping into commentary about the media object at all.",
                bottom: "Grounded human bottom 3 keeps the reaction in-world and publishable without audience commentary.",
                retained_handle: false
              },
              {
                candidate_id: "bad_4",
                top: "Grounded context top 4 keeps the event readable and specific without slipping into commentary about the media object at all.",
                bottom: "Grounded human bottom 4 keeps the reaction in-world and publishable without audience commentary.",
                retained_handle: false
              },
              {
                candidate_id: "bad_5",
                top: "Grounded context top 5 keeps the event readable and specific without slipping into commentary about the media object at all.",
                bottom: "Grounded human bottom 5 keeps the reaction in-world and publishable without audience commentary.",
                retained_handle: false
              }
            ],
            winner_candidate_id: "bad_2",
            titles: Array.from({ length: 5 }, (_, index) => ({
              title: `PUBLISHABLE TITLE ${index + 1}`
            }))
          }
        ]
      }),
    /Reference one-shot experimental failed\..*(media-object commentary|comment-section commentary|audience-reaction commentary)/i
  );
});

test("stable_reference_v6 keeps length-window misses as warnings instead of failing the run", async () => {
  const groundedTopSeed =
    "The contract sounded celebratory until the second detail made the whole room realize what the legend had quietly agreed to, and the clip changes once that lands. ";
  const groundedBottomSeed =
    "That extra clause is what turns the story from clean nostalgia into the kind of public loss fans immediately start arguing over in the comments. ";

  const { result, executor } = await runNativeCaptionPipelineDirectFixture({
    stage2WorkerProfileId: "stable_reference_v6",
    hardConstraints: {
      ...RELAXED_NATIVE_HARD_CONSTRAINTS,
      topLengthMin: 180,
      topLengthMax: 200,
      bottomLengthMin: 140,
      bottomLengthMax: 160
    },
    responses: [
      {
        analysis: {
          visual_anchors: ["anchor 1", "anchor 2", "anchor 3"],
          comment_vibe: "dry disbelief",
          key_phrase_to_adapt: "the contract changed everything"
        },
        candidates: [
          {
            candidate_id: "cand_1",
            top: makeFixedLengthText(groundedTopSeed, 196),
            bottom: makeFixedLengthText(groundedBottomSeed, 150),
            retained_handle: false
          },
          {
            candidate_id: "cand_2",
            top: makeFixedLengthText(groundedTopSeed, 191),
            bottom: makeFixedLengthText(groundedBottomSeed, 149),
            retained_handle: true
          },
          {
            candidate_id: "cand_3",
            top: makeFixedLengthText(groundedTopSeed, 188),
            bottom: makeFixedLengthText(groundedBottomSeed, 152),
            retained_handle: false
          },
          {
            candidate_id: "cand_4",
            top: makeFixedLengthText(groundedTopSeed, 219),
            bottom: makeFixedLengthText(groundedBottomSeed, 155),
            retained_handle: false
          },
          {
            candidate_id: "cand_5",
            top: makeFixedLengthText(groundedTopSeed, 205),
            bottom: makeFixedLengthText(groundedBottomSeed, 151),
            retained_handle: true
          }
        ],
        winner_candidate_id: "cand_5",
        titles: Array.from({ length: 5 }, (_, index) => ({
          title: `THE CONTRACT TURN ${index + 1}`
        }))
      }
    ]
  });

  assert.equal(result.output.captionOptions.length, 5);
  assert.deepEqual(
    result.output.captionOptions
      .filter((option) => option.constraintCheck.passed === false)
      .map((option) => option.candidateId),
    ["cand_4", "cand_5"]
  );
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.validPoolCount, 3);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.invalidPoolCount, 2);
  assert.equal(result.output.winner?.candidateId, "cand_1");
  assert.equal(result.output.finalPick.option, 1);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.winnerValidity, "valid");
  assert.equal(
    result.warnings.some((warning) => /outside the configured length window/i.test(warning.message)),
    true
  );
  assert.equal(
    result.warnings.some((warning) => /promoted valid finalist "cand_1" as final pick/i.test(warning.message)),
    true
  );
  assert.match(executor.calls[0]?.prompt ?? "", /"topLengthMin": 180/);
  assert.match(executor.calls[0]?.prompt ?? "", /"topLengthMax": 200/);
  assert.match(executor.calls[0]?.prompt ?? "", /"bottomLengthMin": 140/);
  assert.match(executor.calls[0]?.prompt ?? "", /"bottomLengthMax": 160/);
  assert.deepEqual(auditStage2WorkerRollout(result.output), { ok: true });
});

test("stable_reference_v6 applies tiny deterministic exact-length polish to near-miss overflows", async () => {
  const groundedTopSeed =
    "The frozen wrench tells the whole bay what kind of mistake just landed, and every mechanic there starts reading his face before he can explain. ";
  const groundedBottomSeed =
    "That pause says enough for the whole bay to hear the repair bill in it, and nobody there needs the softer follow-up to get the point. ";
  const { result } = await runNativeCaptionPipelineDirectFixture({
    stage2WorkerProfileId: "stable_reference_v6",
    hardConstraints: {
      ...RELAXED_NATIVE_HARD_CONSTRAINTS,
      topLengthMin: 160,
      topLengthMax: 185,
      bottomLengthMin: 130,
      bottomLengthMax: 150
    },
    responses: [
      {
        analysis: {
          visual_anchors: ["anchor 1", "anchor 2", "anchor 3"],
          comment_vibe: "dry respect",
          key_phrase_to_adapt: "that pause said enough"
        },
        candidates: [
          {
            candidate_id: "cand_1",
            top: makeFixedLengthText(groundedTopSeed, 181),
            bottom: makeFixedLengthText(groundedBottomSeed, 147),
            retained_handle: false
          },
          {
            candidate_id: "cand_2",
            top: makeFixedLengthText(groundedTopSeed, 178),
            bottom: makeFixedLengthText(groundedBottomSeed, 154),
            retained_handle: true
          },
          {
            candidate_id: "cand_3",
            top: makeFixedLengthText(groundedTopSeed, 176),
            bottom: makeFixedLengthText(groundedBottomSeed, 158),
            retained_handle: false
          },
          {
            candidate_id: "cand_4",
            top: makeFixedLengthText(groundedTopSeed, 173),
            bottom: makeFixedLengthText(groundedBottomSeed, 146),
            retained_handle: false
          },
          {
            candidate_id: "cand_5",
            top: makeFixedLengthText(groundedTopSeed, 187),
            bottom: makeFixedLengthText(groundedBottomSeed, 149),
            retained_handle: true
          }
        ],
        winner_candidate_id: "cand_1",
        titles: Array.from({ length: 5 }, (_, index) => ({
          title: `WHY DID THE ROOM FREEZE ${index + 1}`
        }))
      }
    ]
  });

  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(
    result.output.captionOptions.some((option) => option.constraintCheck.repaired === true),
    true
  );
  assert.equal(
    result.output.captionOptions.every(
      (option) =>
        option.top.length >= 160 &&
        option.top.length <= 185 &&
        option.bottom.length >= 130 &&
        option.bottom.length <= 150
    ),
    true
  );
});

test("stable_reference_v6 trims a one-character punctuation overflow instead of failing the whole one-shot run", async () => {
  const groundedTopSeed =
    "The trade sounds harmless until the second photo makes the whole joke land, and the clip turns into the moment everybody realizes who got thrown under the bus. ";
  const almostMaxBottom = `${makeFixedLengthText(
    "That second picture says enough for everyone in the comments to hear the betrayal before anybody explains the deal out loud and softens the joke",
    150
  )}.`;

  const { result } = await runNativeCaptionPipelineDirectFixture({
    stage2WorkerProfileId: "stable_reference_v6",
    hardConstraints: {
      ...RELAXED_NATIVE_HARD_CONSTRAINTS,
      topLengthMin: 160,
      topLengthMax: 185,
      bottomLengthMin: 140,
      bottomLengthMax: 150
    },
    responses: [
      {
        analysis: {
          visual_anchors: ["anchor 1", "anchor 2", "anchor 3"],
          comment_vibe: "dry betrayal humor",
          key_phrase_to_adapt: "strongest will"
        },
        candidates: [
          {
            candidate_id: "cand_1",
            top: makeFixedLengthText(groundedTopSeed, 176),
            bottom: makeFixedLengthText("cand_1 grounded bottom ", 147),
            retained_handle: false
          },
          {
            candidate_id: "cand_2",
            top: makeFixedLengthText(groundedTopSeed, 178),
            bottom: almostMaxBottom,
            retained_handle: true
          },
          {
            candidate_id: "cand_3",
            top: makeFixedLengthText(groundedTopSeed, 181),
            bottom: makeFixedLengthText("cand_3 grounded bottom ", 149),
            retained_handle: false
          },
          {
            candidate_id: "cand_4",
            top: makeFixedLengthText(groundedTopSeed, 173),
            bottom: makeFixedLengthText("cand_4 grounded bottom ", 145),
            retained_handle: false
          },
          {
            candidate_id: "cand_5",
            top: makeFixedLengthText(groundedTopSeed, 170),
            bottom: makeFixedLengthText("cand_5 grounded bottom ", 148),
            retained_handle: true
          }
        ],
        winner_candidate_id: "cand_2",
        titles: Array.from({ length: 5 }, (_, index) => ({
          title: `WHO GOT THROWN UNDER THE BUS ${index + 1}`
        }))
      }
    ]
  });

  const repairedCandidate = result.output.captionOptions.find((option) => option.candidateId === "cand_2");
  assert.ok(repairedCandidate);
  assert.equal(repairedCandidate?.bottom.length, 150);
  assert.equal(repairedCandidate?.constraintCheck.repaired, true);
  assert.equal(result.output.winner?.candidateId, "cand_2");
});

test("native prompts use the runtime channel hard-constraint windows in generation judging and repair", async () => {
  const customConstraints: Stage2HardConstraints = {
    ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
    topLengthMin: 20,
    topLengthMax: 22,
    bottomLengthMin: 10,
    bottomLengthMax: 12
  };
  const { executor } = await runNativeCaptionPipelineFixture({
    hardConstraints: customConstraints,
    responses: [
      [
        makeNativeCaptionCandidateFixture({ candidateId: "C01", topLength: 30, bottomLength: 18 }),
        makeNativeCaptionCandidateFixture({ candidateId: "C02", topLength: 31, bottomLength: 19 })
      ],
      {
        kept: [
          {
            candidate_id: "C01",
            scores: {
              hook_immediacy: 8,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 8,
              bottom_usefulness: 8
            },
            why_it_works: ["keep C01"]
          },
          {
            candidate_id: "C02",
            scores: {
              hook_immediacy: 8,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 8,
              bottom_usefulness: 8
            },
            why_it_works: ["keep C02"]
          }
        ],
        rejected: [],
        winner_candidate_id: "C01",
        winner_reason: "Judge liked C01 most.",
        needs_repair: true,
        repair_briefs: [
          {
            candidate_id: "C01",
            fix_only: ["length"],
            preserve: ["angle"]
          },
          {
            candidate_id: "C02",
            fix_only: ["length"],
            preserve: ["angle"]
          }
        ]
      },
      [
        {
          candidate_id: "C01",
          top: makeFixedLengthText("C01 FIX ", 21),
          bottom: makeFixedLengthText("C01 ", 11)
        },
        {
          candidate_id: "C02",
          top: makeFixedLengthText("C02 FIX ", 22),
          bottom: makeFixedLengthText("C02 ", 12)
        }
      ],
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Tight title ${index + 1}`
      }))
    ]
  });

  assert.match(executor.calls[0]?.prompt ?? "", /"topLengthMin": 20/);
  assert.match(executor.calls[0]?.prompt ?? "", /"bottomLengthMax": 12/);
  assert.match(executor.calls[1]?.prompt ?? "", /"topLengthMin": 20/);
  assert.match(executor.calls[1]?.prompt ?? "", /candidate_constraint_checks_json/);
  assert.match(executor.calls[2]?.prompt ?? "", /"bottomLengthMin": 10/);
});

test("native prompts carry channel learning through generation judging repair and titles", async () => {
  const styleProfile = normalizeStage2StyleProfile({
    explorationShare: 0.34,
    candidateDirections: [
      {
        id: "dir_absurd",
        fitBand: "core",
        name: "Straight-Faced Absurdity",
        description: "Treat the clip like a real procedure that just happens to look absurd.",
        voice: "Dry, precise, slightly amused.",
        topPattern: "Lead with the serious setup before the absurdity clicks.",
        bottomPattern: "Cash the joke without turning it into a meme caption.",
        humorLevel: "medium",
        sarcasmLevel: "low",
        warmthLevel: "medium",
        insiderDensityLevel: "medium",
        bestFor: "Clips where the crowd joke is obvious but the procedure is still real.",
        avoids: "Broad meme sludge and fake swagger.",
        microExample: "The joke works because nobody has to say it out loud.",
        sourceReferenceIds: [],
        internalPromptNotes: "Carry the joke dry, not broad.",
        axes: {
          humor: 0.66,
          sarcasm: 0.24,
          warmth: 0.48,
          insiderDensity: 0.55,
          intensity: 0.44,
          explanationDensity: 0.32,
          quoteDensity: 0.35,
          topCompression: 0.72
        }
      },
      {
        id: "dir_comment_native",
        fitBand: "adjacent",
        name: "Comment-Native Dryness",
        description: "Preserve one lived-in crowd phrase when it sharpens the read.",
        voice: "Plain spoken, observant, lightly amused.",
        topPattern: "Get to the crowd read early without sounding like a recap.",
        bottomPattern: "Use one clean crowd phrase if it is clip-safe and earned.",
        humorLevel: "medium",
        sarcasmLevel: "low",
        warmthLevel: "medium",
        insiderDensityLevel: "medium",
        bestFor: "Crowd-read clips where the comments already found the clean phrase.",
        avoids: "Invented slang and generic reaction English.",
        microExample: "The room already found the line, so the caption should not sand it down.",
        sourceReferenceIds: [],
        internalPromptNotes: "If the crowd found the phrase, do not flatten it.",
        axes: {
          humor: 0.58,
          sarcasm: 0.18,
          warmth: 0.52,
          insiderDensity: 0.5,
          intensity: 0.4,
          explanationDensity: 0.3,
          quoteDensity: 0.4,
          topCompression: 0.68
        }
      }
    ],
    selectedDirectionIds: ["dir_absurd", "dir_comment_native"]
  });
  const editorialMemory = {
    ...createEmptyStage2EditorialMemorySummary(styleProfile),
    recentFeedbackCount: 4,
    recentSelectionCount: 6,
    promptSummary:
      "Winning lines keep the joke dry and specific, and they do not sand down the crowd phrase when it is clip-safe.",
    recentNotes: ["Keep the joke dry, not broad."]
  };

  const { executor, result } = await runNativeCaptionPipelineFixture({
    stage2WorkerProfileId: "stable_social_wave_v1",
    stage2StyleProfile: styleProfile,
    editorialMemory,
    responses: [
      [
        makeNativeCaptionCandidateFixture({ candidateId: "C01", topLength: 30, bottomLength: 18 }),
        makeNativeCaptionCandidateFixture({ candidateId: "C02", topLength: 31, bottomLength: 19 })
      ],
      {
        kept: [
          {
            candidate_id: "C01",
            scores: {
              hook_immediacy: 8,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 8,
              bottom_usefulness: 8
            },
            why_it_works: ["keep C01"]
          },
          {
            candidate_id: "C02",
            scores: {
              hook_immediacy: 8,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 8,
              bottom_usefulness: 8
            },
            why_it_works: ["keep C02"]
          }
        ],
        rejected: [],
        winner_candidate_id: "C01",
        winner_reason: "Judge liked C01 most.",
        needs_repair: true,
        repair_briefs: [
          {
            candidate_id: "C01",
            fix_only: ["length"],
            preserve: ["angle"]
          },
          {
            candidate_id: "C02",
            fix_only: ["length"],
            preserve: ["angle"]
          }
        ]
      },
      [
        {
          candidate_id: "C01",
          top: makeFixedLengthText("C01 FIX ", 21),
          bottom: makeFixedLengthText("C01 ", 11)
        },
        {
          candidate_id: "C02",
          top: makeFixedLengthText("C02 FIX ", 22),
          bottom: makeFixedLengthText("C02 ", 12)
        }
      ],
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Dry title ${index + 1}`
      }))
    ],
    hardConstraints: {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 20,
      topLengthMax: 22,
      bottomLengthMin: 10,
      bottomLengthMax: 12
    }
  });

  assert.match(executor.calls[0]?.prompt ?? "", /"channel_learning_json"/);
  assert.match(executor.calls[0]?.prompt ?? "", /"line_profile_json"/);
  assert.match(executor.calls[0]?.prompt ?? "", /stable_social_wave_v1/);
  assert.match(executor.calls[0]?.prompt ?? "", /Straight-Faced Absurdity/);
  assert.match(executor.calls[0]?.prompt ?? "", /Winning lines keep the joke dry and specific/i);
  assert.match(executor.calls[1]?.prompt ?? "", /"channel_learning_json"/);
  assert.match(executor.calls[2]?.prompt ?? "", /"channel_learning_json"/);
  assert.match(executor.calls[3]?.prompt ?? "", /display_options_json/);
  assert.match(executor.calls[4]?.prompt ?? "", /"channel_learning_json"/);
  assert.equal(result.diagnostics.channel.workerProfile?.resolvedId, "stable_social_wave_v1");

  const promptStages = result.diagnostics.effectivePrompting.promptStages;
  const candidateStage = promptStages.find((stage) => stage.stageId === "candidateGenerator");
  const courtStage = promptStages.find((stage) => stage.stageId === "qualityCourt");
  const repairStage = promptStages.find((stage) => stage.stageId === "targetedRepair");
  const translationStage = promptStages.find((stage) => stage.stageId === "captionTranslation");
  const titleStage = promptStages.find((stage) => stage.stageId === "titleWriter");
  assert.equal(candidateStage?.inputManifest?.channelLearning?.detail, "compact");
  assert.equal(candidateStage?.inputManifest?.channelLearning?.selectedDirectionCount, 2);
  assert.equal(courtStage?.inputManifest?.channelLearning?.detail, "compact");
  assert.equal(repairStage?.inputManifest?.channelLearning?.detail, "compact");
  assert.equal(translationStage?.inputManifest?.channelLearning, null);
  assert.equal(titleStage?.inputManifest?.channelLearning?.detail, "compact");
});

test("production-shaped native regression fixture keeps prompt-source proof and blocks invalid finalists from surviving", async () => {
  const stalePromptConfig = normalizeStage2PromptConfig({
    version: 3 as never,
    stages: {
      candidateGenerator: {
        prompt: "Write 20 candidates with top_ru and bottom_ru.",
        reasoningEffort: "x-high"
      },
      qualityCourt: {
        prompt: "Return a JSON array with keep flags and total scores."
      },
      titleWriter: {
        prompt: "Return title_ru variants."
      }
    }
  });
  const { result } = await runNativeCaptionPipelineFixture({
    promptConfig: stalePromptConfig,
    hardConstraints: {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 160,
      topLengthMax: 180,
      bottomLengthMin: 140,
      bottomLengthMax: 150
    },
    responses: [
      [
        makeNativeCaptionCandidateFixture({ candidateId: "C03", topLength: 170, bottomLength: 705 }),
        makeNativeCaptionCandidateFixture({ candidateId: "C06", topLength: 170, bottomLength: 455 }),
        makeNativeCaptionCandidateFixture({ candidateId: "C07", topLength: 170, bottomLength: 450 })
      ],
      {
        kept: [
          {
            candidate_id: "C03",
            scores: {
              hook_immediacy: 9,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 7,
              bottom_usefulness: 8
            },
            why_it_works: ["good top"]
          },
          {
            candidate_id: "C06",
            scores: {
              hook_immediacy: 9,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 7,
              bottom_usefulness: 8
            },
            why_it_works: ["good top"]
          },
          {
            candidate_id: "C07",
            scores: {
              hook_immediacy: 9,
              native_fluency: 8,
              visual_defensibility: 8,
              audience_authenticity: 8,
              human_warmth: 7,
              bottom_usefulness: 8
            },
            why_it_works: ["good top"]
          }
        ],
        rejected: [],
        winner_candidate_id: "C06",
        winner_reason: "Judge liked C06 most.",
        needs_repair: false,
        repair_briefs: []
      },
      [
        {
          candidate_id: "C06",
          top: makeFixedLengthText("C06 FIX ", 168),
          bottom: makeFixedLengthText("C06 SAFE ", 145)
        },
        {
          candidate_id: "C07",
          top: makeFixedLengthText("C07 FIX ", 169),
          bottom: makeFixedLengthText("C07 SAFE ", 146)
        }
      ],
      Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Native title ${index + 1}`
      }))
    ]
  });

  assert.equal(result.output.pipeline.execution?.pipelineVersion, "native_caption_v3");
  assert.equal(
    result.output.pipeline.execution?.promptPolicyVersion,
    "native_defaults_authoritative_v2_platform_lines"
  );
  assert.equal(
    result.output.pipeline.execution?.selectorOutputAuthority,
    "derived_non_authoritative"
  );
  assert.equal(result.output.finalists?.every((finalist) => finalist.constraintCheck.passed), true);
  assert.equal(result.output.winner?.constraintCheck?.passed, true);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.displayShortlistCount, 5);
  assert.equal(result.output.pipeline.nativeCaptionV3?.guardSummary.recoveryTriggered, true);
  assert.match(
    result.output.pipeline.nativeCaptionV3?.guardSummary.recoveryReason ?? "",
    /displayable_below_target|winner_missing|audience_handle_missing_in_finalists|finalists_below_target/
  );
  const promptStages = result.diagnostics.effectivePrompting.promptStages;
  const candidateStage = promptStages.find((stage) => stage.stageId === "candidateGenerator");
  const courtStage = promptStages.find((stage) => stage.stageId === "qualityCourt");
  assert.equal(candidateStage?.promptSource, "default");
  assert.equal(candidateStage?.overrideAccepted, false);
  assert.equal(candidateStage?.overrideRejectedReason, "missing_native_compatibility_metadata");
  assert.equal(candidateStage?.legacyFallbackBypassed, true);
  assert.equal(courtStage?.promptSource, "default");
  assert.equal(courtStage?.overrideAccepted, false);
});

test("comments diagnostics distinguish primary success, fallback success, and unavailable states", async () => {
  const primary = await fetchCommentsForUrl("https://www.youtube.com/watch?v=abc123XYZ89", {
    youtubeApiProvider: async () => makeCommentsPayload("primary"),
    ytDlpProvider: async () => makeCommentsPayload("fallback")
  });
  const fallback = await fetchCommentsForUrl("https://www.youtube.com/watch?v=abc123XYZ89", {
    youtubeApiProvider: async () => {
      throw new YouTubeCommentsApiError({
        code: "quota_exceeded",
        message: "API quota exceeded",
        retryable: true,
        status: 403
      });
    },
    ytDlpProvider: async () => makeCommentsPayload("fallback")
  });
  const unavailable = await fetchCommentsForUrl("https://www.youtube.com/watch?v=abc123XYZ89", {
    youtubeApiProvider: async () => {
      throw new YouTubeCommentsApiError({
        code: "comments_disabled",
        message: "Комментарии отключены для этого YouTube-видео.",
        retryable: false,
        status: 403
      });
    },
    ytDlpProvider: async () => makeCommentsPayload("unused")
  });

  assert.equal(primary.status, "primary_success");
  assert.equal(primary.provider, "youtubeDataApi");
  assert.equal(primary.fallbackUsed, false);
  assert.match(primary.note ?? "", /YouTube Data API/i);

  assert.equal(fallback.status, "fallback_success");
  assert.equal(fallback.provider, "ytDlp");
  assert.equal(fallback.fallbackUsed, true);
  assert.match(fallback.note ?? "", /резервный путь yt-dlp/i);

  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.provider, null);
  assert.equal(unavailable.fallbackUsed, false);
  assert.match(unavailable.note ?? "", /Комментарии отключены/i);
});

test("analyzer normalization keeps structured arrays clean and preserves comment-derived detail", async () => {
  const { result } = await runSuccessfulPipeline({
    comments: [
      { author: "viewer_1", likes: 1100, text: "literal god pack" },
      { author: "viewer_2", likes: 850, text: "that scooby laugh got me" },
      { author: "viewer_3", likes: 700, text: "looks pre-opened honestly" }
    ],
    analyzerResponse: {
      visual_anchors: [
        "dark full-art foil character card reveal with red accents and eye motif cards after it','green money total overlay jumping past four hundred dollars"
      ],
      slang_to_adapt: "None",
      hidden_detail: "None",
      generic_risks: ["None", "calling it random luck only"]
    }
  });

  assert.equal(
    result.diagnostics.analysis.visualAnchors.some((anchor) => anchor.includes("','")),
    false
  );
  assert.ok(result.diagnostics.analysis.visualAnchors.length >= 2);
  assert.ok(result.diagnostics.analysis.slangToAdapt?.some((cue) => /god pack/i.test(cue)));
  assert.match(result.diagnostics.analysis.hiddenDetail ?? "", /staging|tampering|fakery|face value/i);
  assert.doesNotMatch(result.diagnostics.analysis.hiddenDetail ?? "", /pre-opened|resealed/i);
  assert.ok(
    (result.diagnostics.analysis.genericRisks ?? []).includes("calling it random luck only")
  );
});

test("stage 2 spec reflects the effective hard constraints truthfully", () => {
  const hardConstraints: Stage2HardConstraints = {
    topLengthMin: 180,
    topLengthMax: 200,
    bottomLengthMin: 120,
    bottomLengthMax: 140,
    bannedWords: ["boring"],
    bannedOpeners: ["watch this"]
  };

  assert.deepEqual(
    buildStage2Spec({
      name: "Stage 2",
      outputSections: ["TOP", "BOTTOM"],
      hardConstraints,
      enforcedVia: "Validated against runtime hard constraints."
    }),
    {
      name: "Stage 2",
      outputSections: ["TOP", "BOTTOM"],
      topLengthRule: "180-200 chars",
      bottomLengthRule: "120-140 chars",
      enforcedVia: "Validated against runtime hard constraints."
    }
  );
});

test("SEO prompt compaction removes low-value duplicated context", async () => {
  const { result } = await runSuccessfulPipeline();
  const comments = Array.from({ length: 80 }, (_, index) => ({
    id: `comment_${index + 1}`,
    author: `viewer_${index + 1}`,
    likes: 500 - index,
    timestamp: null,
    postedAt: null,
    text:
      index % 2 === 0
        ? "This same comment repeats to stress how bloated the prompt used to get around SEO assembly."
        : `Unique comment ${index + 1} about the axle folding sideways under the truck.`
  }));

  const prompt = buildStage2SeoPrompt({
    sourceUrl: "https://example.com/short",
    title: "Old pickup bucks through a muddy rut",
    comments,
    omittedCommentsCount: 0,
    stage2Output: result.output
  });

  assert.ok(prompt.length < 20_000);
  assert.doesNotMatch(prompt, /topRu|bottomRu|reason/i);
  assert.match(prompt, /"totalIncluded":\s*(1\d|2[0-4])/);
});

test("default prompt templates expose the new analyzer and selector contracts", () => {
  const analyzerResolved = resolveStage2PromptTemplate("analyzer", normalizeStage2PromptConfig({}));
  const selectorResolved = resolveStage2PromptTemplate("selector", normalizeStage2PromptConfig({}));
  const writerResolved = resolveStage2PromptTemplate("writer", normalizeStage2PromptConfig({}));
  const rewriterResolved = resolveStage2PromptTemplate("rewriter", normalizeStage2PromptConfig({}));
  const titlesResolved = resolveStage2PromptTemplate("titles", normalizeStage2PromptConfig({}));
  const seoResolved = resolveStage2PromptTemplate("seo", normalizeStage2PromptConfig({}));
  const contextPacketResolved = resolveStage2PromptTemplate("contextPacket", normalizeStage2PromptConfig({}));
  const candidateGeneratorResolved = resolveStage2PromptTemplate("candidateGenerator", normalizeStage2PromptConfig({}));
  const qualityCourtResolved = resolveStage2PromptTemplate("qualityCourt", normalizeStage2PromptConfig({}));
  const targetedRepairResolved = resolveStage2PromptTemplate("targetedRepair", normalizeStage2PromptConfig({}));
  const captionTranslationResolved = resolveStage2PromptTemplate("captionTranslation", normalizeStage2PromptConfig({}));
  const titleWriterResolved = resolveStage2PromptTemplate("titleWriter", normalizeStage2PromptConfig({}));

  assert.match(analyzerResolved.defaultPrompt, /specific_nouns/);
  assert.match(analyzerResolved.defaultPrompt, /visible_actions/);
  assert.match(analyzerResolved.defaultPrompt, /scene_beats/);
  assert.match(analyzerResolved.defaultPrompt, /reveal_moment/);
  assert.match(analyzerResolved.defaultPrompt, /uncertainty_notes/);
  assert.match(analyzerResolved.defaultPrompt, /core_trigger/);
  assert.match(analyzerResolved.defaultPrompt, /best_bottom_energy/);
  assert.match(analyzerResolved.defaultPrompt, /comment_consensus_lane/);
  assert.match(analyzerResolved.defaultPrompt, /comment_joke_lane/);
  assert.match(analyzerResolved.defaultPrompt, /comment_dissent_lane/);
  assert.match(analyzerResolved.defaultPrompt, /comment_suspicion_lane/);
  assert.match(analyzerResolved.defaultPrompt, /Sequence Awareness Rule/);
  assert.match(selectorResolved.defaultPrompt, /primary_angle/);
  assert.match(selectorResolved.defaultPrompt, /top_strategy/);
  assert.match(selectorResolved.defaultPrompt, /why_old_v6_would_work_here/);
  assert.match(selectorResolved.defaultPrompt, /failure_modes/);
  assert.match(selectorResolved.defaultPrompt, /Comments should shape stance, not replace visual truth/);
  assert.match(selectorResolved.defaultPrompt, /hint-don't-fully-spoil/i);
  assert.match(writerResolved.defaultPrompt, /Context Compression Rule/);
  assert.match(writerResolved.defaultPrompt, /Must explain why the viewer should care/);
  assert.match(writerResolved.defaultPrompt, /Treat TOP as a contextual hook, not as a screenshot description/i);
  assert.match(writerResolved.defaultPrompt, /comma-chained object lists/i);
  assert.match(writerResolved.defaultPrompt, /plain spoken English/i);
  assert.match(writerResolved.defaultPrompt, /pseudo-slang/i);
  assert.match(writerResolved.defaultPrompt, /Quoted openers are optional/);
  assert.match(writerResolved.defaultPrompt, /stock continuations/i);
  assert.match(writerResolved.defaultPrompt, /Near misses still fail/i);
  assert.match(writerResolved.defaultPrompt, /The system will not rescue a too-short line with hidden filler/i);
  assert.match(writerResolved.defaultPrompt, /Do not let the batch collapse into one repeated bottom rhythm/i);
  assert.doesNotMatch(writerResolved.defaultPrompt, /Must begin with one quoted sentence/);
  assert.match(resolveStage2PromptTemplate("critic", normalizeStage2PromptConfig({})).defaultPrompt, /Batch audit rules/);
  assert.match(resolveStage2PromptTemplate("critic", normalizeStage2PromptConfig({})).defaultPrompt, /strict exact-length windows/i);
  assert.match(resolveStage2PromptTemplate("critic", normalizeStage2PromptConfig({})).defaultPrompt, /polished-but-interchangeable bottoms/i);
  assert.match(resolveStage2PromptTemplate("critic", normalizeStage2PromptConfig({})).defaultPrompt, /candidate topHookSignals are provided/i);
  assert.match(resolveStage2PromptTemplate("critic", normalizeStage2PromptConfig({})).defaultPrompt, /candidate humanPhrasingSignals are provided/i);
  assert.match(writerResolved.defaultPrompt, /top_ru/);
  assert.match(writerResolved.defaultPrompt, /bottom_ru/);
  assert.match(rewriterResolved.defaultPrompt, /top_ru/);
  assert.match(rewriterResolved.defaultPrompt, /bottom_ru/);
  assert.match(rewriterResolved.defaultPrompt, /screenshot-style openings/i);
  assert.match(rewriterResolved.defaultPrompt, /hint-don't-fully-spoil/i);
  assert.match(rewriterResolved.defaultPrompt, /synthetic editorial English/i);
  assert.match(rewriterResolved.defaultPrompt, /Never leave a tightening fragment or broken truncation behind/i);
  assert.match(rewriterResolved.defaultPrompt, /The system will not auto-pad a short rewrite for you/i);
  assert.match(resolveStage2PromptTemplate("finalSelector", normalizeStage2PromptConfig({})).defaultPrompt, /style_direction_ids/i);
  assert.match(resolveStage2PromptTemplate("finalSelector", normalizeStage2PromptConfig({})).defaultPrompt, /exploration_mode/i);
  assert.match(resolveStage2PromptTemplate("finalSelector", normalizeStage2PromptConfig({})).defaultPrompt, /TOP behaves like a hook instead of a screenshot description/i);
  assert.match(resolveStage2PromptTemplate("finalSelector", normalizeStage2PromptConfig({})).defaultPrompt, /candidate humanPhrasingSignals are provided/i);
  assert.match(titlesResolved.defaultPrompt, /title_ru/);
  assert.match(titlesResolved.defaultPrompt, /real Russian/);
  assert.match(titlesResolved.defaultPrompt, /ALL CAPS/);
  assert.match(seoResolved.defaultPrompt, /Search terms and topics covered:/);
  assert.match(seoResolved.defaultPrompt, /YouTube SEO Architect 2026/i);
  assert.match(seoResolved.defaultPrompt, /High-Value Entities \(HVE\)/i);
  assert.match(seoResolved.defaultPrompt, /LSI keywords/i);
  assert.match(seoResolved.defaultPrompt, /3 broad/i);
  assert.match(seoResolved.defaultPrompt, /5 niche/i);
  assert.match(seoResolved.defaultPrompt, /4 viral/i);
  assert.match(seoResolved.defaultPrompt, /Exactly 17 tags/);
  assert.match(contextPacketResolved.defaultPrompt, /channel_learning_json/);
  assert.match(contextPacketResolved.defaultPrompt, /dominant harmless public handle/i);
  assert.match(candidateGeneratorResolved.defaultPrompt, /channel_learning_json/);
  assert.match(candidateGeneratorResolved.defaultPrompt, /exactly 8 candidates/i);
  assert.match(qualityCourtResolved.defaultPrompt, /hard_validator_json/);
  assert.match(targetedRepairResolved.defaultPrompt, /channel_learning_json/);
  assert.match(captionTranslationResolved.defaultPrompt, /display_options_json/);
  assert.match(captionTranslationResolved.defaultPrompt, /natural Russian/i);
  assert.match(titleWriterResolved.defaultPrompt, /channel_learning_json/);
  assert.match(titleWriterResolved.defaultPrompt, /title_ru/);
  assert.match(titleWriterResolved.defaultPrompt, /ALL CAPS/i);
});

test("writer prompt surfaces exact constraint targets and flags strict-length mode", () => {
  const prompt = buildWriterPrompt({
    channelConfig: {
      channelId: "channel_strict",
      name: "Strict Channel",
      username: "strict_channel",
      examplesSource: "workspace_default",
      hardConstraints: {
        topLengthMin: 160,
        topLengthMax: 180,
        bottomLengthMin: 140,
        bottomLengthMax: 150,
        bannedWords: ["clip"],
        bannedOpeners: []
      },
      styleProfile: normalizeStage2StyleProfile(undefined),
      editorialMemory: createEmptyStage2EditorialMemorySummary(normalizeStage2StyleProfile(undefined))
    },
    analyzerOutput: {
      visualAnchors: ["anchor"],
      specificNouns: [],
      visibleActions: [],
      subject: "subject",
      action: "action",
      setting: "setting",
      firstSecondsSignal: "signal",
      sceneBeats: ["beat"],
      revealMoment: "reveal",
      lateClipChange: "change",
      stakes: ["stakes"],
      payoff: "payoff",
      coreTrigger: "trigger",
      humanStake: "stake",
      narrativeFrame: "frame",
      whyViewerCares: "care",
      bestBottomEnergy: "dry",
      commentVibe: "measured",
      commentConsensusLane: "",
      commentJokeLane: "",
      commentDissentLane: "",
      commentSuspicionLane: "",
      slangToAdapt: [],
      commentLanguageCues: [],
      extractableSlang: [],
      hiddenDetail: "",
      genericRisks: [],
      uncertaintyNotes: [],
      rawSummary: "summary"
    },
    selectorOutput: {
      clipType: "general",
      primaryAngle: "shared_experience",
      secondaryAngles: ["payoff_reveal"],
      rankedAngles: [{ angle: "shared_experience", score: 9, why: "fit" }],
      selectedExampleIds: [],
      rejectedExampleIds: [],
      selectedExamples: [],
      coreTrigger: "trigger",
      humanStake: "stake",
      narrativeFrame: "frame",
      whyViewerCares: "care",
      topStrategy: "top",
      bottomEnergy: "bottom",
      whyOldV6WouldWorkHere: "v6",
      failureModes: ["dead"],
      rationale: "rationale",
      writerBrief: "brief",
      confidence: 0.7
    },
    examplesAssessment: {
      retrievalConfidence: "low",
      examplesMode: "style_guided",
      explanation: "weak examples",
      evidence: [],
      retrievalWarning: "weak",
      examplesRoleSummary: "Examples are weak support only.",
      primaryDriverSummary: "Clip truth and channel style drive the run.",
      primaryDrivers: ["clip_truth", "channel_style"],
      channelStylePriority: "primary",
      editorialMemoryPriority: "primary"
    },
    userInstruction: null,
    promptConfig: normalizeStage2PromptConfig({})
  });

  assert.match(prompt, /"topLengthRule": "160-180 chars"/);
  assert.match(prompt, /"bottomLengthRule": "140-150 chars"/);
  assert.match(prompt, /"strictConstraintMode": true/);
  assert.match(prompt, /Near misses still die; count characters before finalizing each line/);
});

test("stage 2 ui surfaces active corpus and selector picks instead of profile or hot-pool internals", async () => {
  const { result } = await runSuccessfulPipeline();
  let progress = createStage2ProgressSnapshot("run_ui");
  for (const stageId of ["analyzer", "selector", "writer", "critic", "rewriter", "finalSelector", "titles", "seo"] as const) {
    progress = markStage2ProgressStageRunning(progress, stageId, {
      detail: `${stageId} running`
    });
    progress = markStage2ProgressStageCompleted(progress, stageId, {
      detail: `${stageId} done`
    });
  }

  const stage2: Stage2Response = {
    source: {
      url: "https://example.com/short",
      title: "Old pickup bucks through a muddy rut",
      totalComments: 1,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 1
    },
    output: result.output,
    warnings: result.warnings,
    diagnostics: result.diagnostics,
    tokenUsage: result.tokenUsage,
    debugMode: "raw",
    debugRef: {
      kind: "stage2-run-debug",
      ref: "stage2_debug_fixture"
    },
    progress,
    stage2Run: {
      runId: "run_ui",
      mode: "manual",
      createdAt: nowIso()
    }
  };

  const diagnostics = normalizeStage2DiagnosticsForView(stage2.diagnostics, {
    channelName: "Target Channel",
    channelUsername: "target_channel"
  });
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(Step2PickCaption, {
        channelName: "Target Channel",
        channelUsername: "target_channel",
        stage2,
        progress,
        stageCreatedAt: nowIso(),
        commentsAvailable: true,
        instruction: "",
        runs: [
          {
            runId: "run_ui",
            chatId: "chat_1",
            channelId: "target",
            sourceUrl: "https://example.com/short",
            userInstruction: null,
            mode: "manual",
            baseRunId: null,
            status: "completed",
            progress,
            errorMessage: null,
            hasResult: true,
            createdAt: nowIso(),
            startedAt: nowIso(),
            updatedAt: nowIso(),
            finishedAt: nowIso()
          }
        ],
        selectedRunId: "run_ui",
        currentRunStatus: "completed",
        currentRunError: null,
        canRunStage2: true,
        canQuickRegenerate: true,
        runBlockedReason: null,
        quickRegenerateBlockedReason: null,
        isLaunching: false,
        isRunning: false,
        expectedDurationMs: 40_000,
        elapsedMs: 12_000,
        selectedOption: 2,
        selectedTitleOption: 1,
        onInstructionChange: () => undefined,
        onQuickRegenerate: () => undefined,
        onRunStage2: () => undefined,
        onSelectRun: () => undefined,
        onSelectOption: () => undefined,
        onSelectTitleOption: () => undefined,
        onCopy: () => undefined
      }),
      React.createElement(Stage2RunDiagnosticsPanels, { diagnostics, stage2Result: stage2 })
    )
  );

  assert.match(html, /Как этот запуск реально устроен/);
  assert.match(html, /Чтение клипа анализатором/);
  assert.match(html, /Активный корпус и выбор селектора/);
  assert.match(html, /селектор выбрал 3/);
  assert.match(html, /селектор увидел 5/);
  assert.match(html, /Retrieval режим/);
  assert.match(html, /Target Channel/);
  assert.match(html, /Truck axle snaps in the mud/);
  assert.match(html, /Главный триггер:/);
  assert.match(html, /Почему селектор выбрал это/);
  assert.match(html, /LLM budget/);
  assert.match(html, /Raw prompt contexts вынесены из основного Stage 2 payload/);
  assert.ok(!/hot pool/i.test(html));
  assert.ok(!/stable \+ hot \+ anti/i.test(html));
});

test("native Step 2 UI renders RU-first cards without raw editorial or validator strings", () => {
  const stage2 = makeRuntimeStage2Response("run_native_ui", "native");
  stage2.output.captionOptions = [
    {
      option: 1,
      candidateId: "cand_1",
      laneId: "audience_locked",
      angle: "window-seat disbelief",
      top: "English top that keeps the harmless handle alive.",
      bottom: "English bottom that closes on the audience reaction cleanly.",
      topRu: "Русский верх, который сразу звучит как рабочий вариант.",
      bottomRu: "Русский низ, который уже можно отдавать оператору без доперевода.",
      displayTier: "finalist",
      sourceStage: "qualityCourt",
      displayReason: "Valid per hard_validator_json.",
      retainedHandle: true,
      constraintCheck: {
        passed: true,
        repaired: false,
        topLength: 52,
        bottomLength: 63,
        issues: []
      }
    },
    {
      option: 2,
      candidateId: "cand_2",
      laneId: "balanced_clean",
      angle: "balanced",
      top: "Second English top.",
      bottom: "Second English bottom.",
      topRu: "Второй русский верх.",
      bottomRu: "Второй русский низ.",
      displayTier: "display_safe_extra",
      sourceStage: "qualityCourt",
      displayReason: "Bottom Lens",
      retainedHandle: false,
      constraintCheck: {
        passed: true,
        repaired: false,
        topLength: 18,
        bottomLength: 20,
        issues: []
      }
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      option: index + 3,
      candidateId: `cand_${index + 3}`,
      laneId: "backup_simple",
      angle: "backup",
      top: `Backup English top ${index + 3}.`,
      bottom: `Backup English bottom ${index + 3}.`,
      topRu: `Резервный русский верх ${index + 3}.`,
      bottomRu: `Резервный русский низ ${index + 3}.`,
      displayTier: "template_backfill" as const,
      sourceStage: "templateBackfill" as const,
      displayReason: "Best GIFs",
      retainedHandle: false,
      constraintCheck: {
        passed: true,
        repaired: false,
        topLength: 21,
        bottomLength: 24,
        issues: []
      }
    }))
  ];
  stage2.output.finalists = [
    {
      option: 1,
      candidateId: "cand_1",
      laneId: "audience_locked",
      angle: "window-seat disbelief",
      top: "English top that keeps the harmless handle alive.",
      bottom: "English bottom that closes on the audience reaction cleanly.",
      displayTier: "finalist",
      sourceStage: "qualityCourt",
      displayReason: "Valid per hard_validator_json.",
      retainedHandle: true,
      preservedHandle: true,
      constraintCheck: {
        passed: true,
        repaired: false,
        topLength: 52,
        bottomLength: 63,
        issues: []
      },
      whyChosen: ["Best GIFs", "Bottom Lens"],
      translation: {
        topRu: "Русский верх, который сразу звучит как рабочий вариант.",
        bottomRu: "Русский низ, который уже можно отдавать оператору без доперевода.",
        translatedAt: nowIso()
      }
    }
  ];
  stage2.output.titleOptions = Array.from({ length: 5 }, (_, index) => ({
    option: index + 1,
    title: `Winner title EN ${index + 1}`,
    titleRu: `ГОТОВЫЙ ЗАГОЛОВОК RU ${index + 1}`
  }));
  stage2.output.winner = {
    candidateId: "cand_1",
    option: 1,
    reason: "Valid per hard_validator_json.",
    displayTier: "finalist",
    sourceStage: "qualityCourt",
    constraintCheck: {
      passed: true,
      repaired: false,
      topLength: 52,
      bottomLength: 63,
      issues: []
    }
  };
  stage2.output.pipeline = {
    channelId: "channel_native",
    mode: "codex_pipeline",
    execution: {
      featureFlags: {} as never,
      pipelineVersion: "native_caption_v3",
      stageChainVersion: "stage2-native-test",
      workerBuild: {
        buildId: "build-test",
        startedAt: nowIso(),
        pid: 1
      },
      resolvedAt: nowIso(),
      legacyFallbackReason: null
    },
    selectorOutput: {
      clipType: "payoff_reveal",
      primaryAngle: "window-seat disbelief",
      secondaryAngles: [],
      rankedAngles: [],
      coreTrigger: "trigger",
      humanStake: "stake",
      narrativeFrame: "frame",
      whyViewerCares: "care",
      topStrategy: "top",
      bottomEnergy: "bottom",
      whyOldV6WouldWorkHere: "old",
      failureModes: [],
      writerBrief: "brief"
    },
    availableExamplesCount: 0,
    selectedExamplesCount: 0,
    nativeCaptionV3: {
      contextPacket: makeNativeCaptionContextPacket(),
      candidateBatch: [],
      hardValidator: {
        validPool: ["cand_1"],
        invalidPool: []
      },
      qualityCourt: {
        finalists: [
          {
            candidateId: "cand_1",
            whyChosen: ["Best GIFs", "Bottom Lens"],
            preservedHandle: true
          }
        ],
        displaySafeExtras: [],
        hardRejected: [],
        winnerCandidateId: "cand_1",
        recoveryPlan: {
          required: false,
          missingCount: 0,
          briefs: []
        }
      },
      repair: null,
      templateBackfill: null,
      guardSummary: {
        totalCandidateCount: 5,
        validPoolCount: 5,
        invalidPoolCount: 0,
        finalistCount: 1,
        displaySafeExtraCount: 1,
        recoveryCount: 0,
        templateBackfillCount: 3,
        displayShortlistCount: 5,
        winnerCandidateId: "cand_1",
        winnerTier: "finalist",
        winnerValidity: "valid",
        degradedSuccess: false,
        dominantHarmlessHandle: "window-seat disbelief",
        audienceHandlePreservedInFinalists: true,
        recoveryTriggered: false,
        recoveryReason: null,
        failClosedReason: null
      },
      displayOptions: stage2.output.captionOptions,
      titleWriter: {
        titleOptions: stage2.output.titleOptions,
        translationCoverage: {
          requestedCount: 5,
          translatedCount: 5,
          fallbackCount: 0,
          fallbackOptions: [],
          retriedOptions: []
        }
      },
      translation: {
        translatedAt: nowIso(),
        items: stage2.output.captionOptions.map((option) => ({
          candidateId: option.candidateId ?? `cand_${option.option}`,
          topRu: option.topRu ?? option.top,
          bottomRu: option.bottomRu ?? option.bottom,
          source: "llm" as const
        })),
        coverage: {
          requestedCount: 5,
          translatedCount: 5,
          fallbackCount: 0,
          fallbackCandidateIds: [],
          retriedCandidateIds: []
        }
      }
    }
  };

  const html = renderToStaticMarkup(
    React.createElement(Step2PickCaption, {
      channelName: "Native Channel",
      channelUsername: "native_channel",
      stage2,
      progress: null,
      stageCreatedAt: nowIso(),
      commentsAvailable: true,
      instruction: "",
      runs: [],
      selectedRunId: null,
      currentRunStatus: "completed",
      currentRunError: null,
      canRunStage2: true,
      canQuickRegenerate: true,
      runBlockedReason: null,
      quickRegenerateBlockedReason: null,
      isLaunching: false,
      isRunning: false,
      expectedDurationMs: 40_000,
      elapsedMs: 0,
      selectedOption: 1,
      selectedTitleOption: 1,
      onInstructionChange: () => undefined,
      onQuickRegenerate: () => undefined,
      onRunStage2: () => undefined,
      onSelectRun: () => undefined,
      onSelectOption: () => undefined,
      onSelectTitleOption: () => undefined,
      onCopy: () => undefined
    })
  );
  const primaryHtml = html.split("SEO, память канала и диагностика")[0] ?? html;

  assert.match(primaryHtml, /Готовые варианты/);
  assert.match(primaryHtml, /Победитель/);
  assert.match(primaryHtml, /Проверен/);
  assert.match(primaryHtml, /Резерв/);
  assert.match(primaryHtml, /ГОТОВЫЙ ЗАГОЛОВОК RU 1/);
  assert.match(primaryHtml, /Winner title EN 1/);
  assert.ok(
    primaryHtml.indexOf("Русский верх, который сразу звучит как рабочий вариант.") <
      primaryHtml.indexOf("English top that keeps the harmless handle alive.")
  );
  assert.ok(!/Winner-first shortlist/.test(primaryHtml));
  assert.ok(!/Перевести finalists/.test(primaryHtml));
  assert.ok(!/Valid per hard_validator_json\./.test(primaryHtml));
  assert.ok(!/Best GIFs/.test(primaryHtml));
  assert.ok(!/Bottom Lens/.test(primaryHtml));
});

test("legacy diagnostics payload from older runs does not crash the Stage 2 UI", () => {
  const stage2: Stage2Response = {
    source: {
      url: "https://example.com/short",
      title: "Legacy run",
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0
    },
    output: {
      inputAnalysis: {
        visualAnchors: ["anchor"],
        commentVibe: "dry",
        keyPhraseToAdapt: "legacy"
      },
      captionOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        top: `legacy top ${index + 1}`,
        bottom: `"legacy" bottom ${index + 1}`,
        topRu: `legacy верх ${index + 1}`,
        bottomRu: `"legacy" низ ${index + 1}`
      })),
      titleOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Legacy ${index + 1}`,
        titleRu: `Legacy ${index + 1}`
      })),
      finalPick: {
        option: 1,
        reason: "legacy winner"
      }
    },
    warnings: [],
    diagnostics: {
      profile: {
        profileId: "science_snack",
        name: "Science Snack"
      },
      selection: {
        clipType: "engineering_oddity",
        rankedAngles: [{ angle: "visual_payoff", score: 9.1, why: "best fit" }],
        writerBrief: "Stay grounded."
      },
      effectivePrompting: {
        promptStages: [
          {
            stageId: "writer",
            label: "Writer",
            stageType: "llm_prompt",
            defaultTemplate: "writer default",
            channelOverride: null,
            effectiveTemplate: "writer default",
            promptText: "writer prompt",
            promptChars: 42,
            usesImages: false,
            summary: "writer stage"
          }
        ]
      },
      retrieval: {
        stableExamples: [
          {
            sourceChannelId: "alpha",
            sourceChannelName: "Alpha Channel",
            title: "Legacy stable example",
            clipType: "engineering_oddity",
            overlayTop: "legacy top",
            overlayBottom: "legacy bottom",
            whyItWorks: ["legacy why"]
          }
        ],
        hotExamples: [],
        antiExamples: []
      }
    } as never,
    stage2Run: {
      runId: "legacy_run",
      mode: "manual",
      createdAt: nowIso()
    }
  };

  const diagnostics = normalizeStage2DiagnosticsForView(stage2.diagnostics, {
    channelName: "Legacy Channel",
    channelUsername: "legacy_channel"
  });
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(Step2PickCaption, {
        channelName: "Legacy Channel",
        channelUsername: "legacy_channel",
        stage2,
        progress: null,
        stageCreatedAt: nowIso(),
        commentsAvailable: true,
        instruction: "",
        runs: [],
        selectedRunId: null,
        currentRunStatus: null,
        currentRunError: null,
        canRunStage2: true,
        canQuickRegenerate: false,
        runBlockedReason: null,
        quickRegenerateBlockedReason: "Сначала выберите готовый Stage 2 run с результатом.",
        isLaunching: false,
        isRunning: false,
        expectedDurationMs: 40_000,
        elapsedMs: 12_000,
        selectedOption: 1,
        selectedTitleOption: 1,
        onInstructionChange: () => undefined,
        onQuickRegenerate: () => undefined,
        onRunStage2: () => undefined,
        onSelectRun: () => undefined,
        onSelectOption: () => undefined,
        onSelectTitleOption: () => undefined,
        onCopy: () => undefined
      }),
      React.createElement(Stage2RunDiagnosticsPanels, { diagnostics })
    )
  );

  assert.match(html, /Science Snack|Legacy Channel/);
  assert.match(html, /Legacy stable example/);
  assert.match(html, /Эффективные промпты/);
});

test("partial native payload without guardSummary does not crash the Stage 2 UI", () => {
  const stage2 = {
    source: {
      url: "https://example.com/native",
      title: "Partial native run",
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0
    },
    output: {
      inputAnalysis: {
        visualAnchors: ["anchor"],
        commentVibe: "dry",
        keyPhraseToAdapt: "partial native"
      },
      captionOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        candidateId: `C0${index + 1}`,
        top: `native top ${index + 1}`,
        bottom: `native bottom ${index + 1}`,
        topRu: `нативный верх ${index + 1}`,
        bottomRu: `нативный низ ${index + 1}`,
        displayTier: index === 0 ? "finalist" : "display_safe_extra",
        sourceStage: index === 0 ? "qualityCourt" : "targetedRepair",
        displayReason: "Visible option.",
        constraintCheck: { passed: true, hardIssues: [] }
      })),
      finalists: [
        {
          option: 1,
          candidateId: "C01",
          top: "native top 1",
          bottom: "native bottom 1",
          topRu: "нативный верх 1",
          bottomRu: "нативный низ 1",
          constraintCheck: { passed: true, hardIssues: [] }
        }
      ],
      winner: {
        option: 1,
        candidateId: "C01",
        top: "native top 1",
        bottom: "native bottom 1",
        topRu: "нативный верх 1",
        bottomRu: "нативный низ 1",
        displayTier: "finalist",
        sourceStage: "qualityCourt",
        displayReason: "Winner.",
        constraintCheck: { passed: true, hardIssues: [] }
      },
      titleOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Native ${index + 1}`,
        titleRu: `Нативный ${index + 1}`
      })),
      finalPick: {
        option: 1,
        reason: "native winner"
      },
      pipeline: {
        nativeCaptionV3: {
          pipelineVersion: "native_caption_v3",
          promptFamilyVersion: "native_caption_v3@2026-04-02",
          contextPacket: {
            grounding: {
              observedFacts: ["anchor"],
              visibleSequence: ["turn"],
              microTurn: "turn",
              firstSecondsSignal: "signal",
              uncertainties: [],
              forbiddenClaims: [],
              safeInferences: []
            },
            audienceWave: {
              exists: false,
              emotionalTemperature: "dry",
              dominantHarmlessHandle: null,
              consensusLane: "",
              jokeLane: "",
              dissentLane: "",
              safeReusableCues: [],
              blockedCues: [],
              flatteningRisks: [],
              mustNotLose: []
            },
            strategy: {
              primaryAngle: "dry",
              secondaryAngles: [],
              hookSeeds: [],
              bottomFunctions: [],
              requiredLanes: [],
              mustDo: [],
              mustAvoid: []
            }
          },
          generatedCandidates: [],
          hardValidation: { validPool: [], invalidPool: [] },
          editorialCourt: {
            finalists: [],
            displaySafeExtras: [],
            hardRejected: [],
            winnerCandidateId: null,
            recoveryPlan: { required: false, missingCount: 0, briefs: [] }
          },
          titleWriter: {
            options: Array.from({ length: 5 }, (_, index) => ({
              option: index + 1,
              title: `Native ${index + 1}`,
              titleRu: `Нативный ${index + 1}`
            })),
            translationCoverage: {
              requestedCount: 5,
              translatedCount: 5,
              fallbackCount: 0,
              fallbackOptions: [],
              retriedOptions: []
            }
          },
          translation: {
            translatedAt: nowIso(),
            items: [
              {
                candidateId: "C01",
                topRu: "нативный верх 1",
                bottomRu: "нативный низ 1",
                source: "llm"
              }
            ],
            coverage: {
              requestedCount: 5,
              translatedCount: 1,
              fallbackCount: 4,
              fallbackCandidateIds: ["C02", "C03", "C04", "C05"],
              retriedCandidateIds: []
            }
          }
        }
      }
    },
    warnings: [],
    diagnostics: null
  } as unknown as Stage2Response;

  const html = renderToStaticMarkup(
    React.createElement(Step2PickCaption, {
      channelName: "Target Channel",
      channelUsername: "target_channel",
      stage2,
      progress: null,
      stageCreatedAt: nowIso(),
      commentsAvailable: true,
      instruction: "",
      runs: [],
      selectedRunId: null,
      currentRunStatus: null,
      currentRunError: null,
      canRunStage2: true,
      canQuickRegenerate: true,
      runBlockedReason: null,
      quickRegenerateBlockedReason: null,
      isLaunching: false,
      isRunning: false,
      expectedDurationMs: 40_000,
      elapsedMs: 12_000,
      selectedOption: 1,
      selectedTitleOption: 1,
      onInstructionChange: () => undefined,
      onQuickRegenerate: () => undefined,
      onRunStage2: () => undefined,
      onSelectRun: () => undefined,
      onSelectOption: () => undefined,
      onSelectTitleOption: () => undefined,
      onCopy: () => undefined
    })
  );

  assert.match(html, /Готовые варианты/);
  assert.match(html, /нативный верх 1/);
  assert.doesNotMatch(html, /safe fallback-режиме/);
});

test("step 2 keeps an attached running run informational instead of rendering it as a blocking error", () => {
  const html = renderToStaticMarkup(
    React.createElement(Step2PickCaption, {
      channelName: "Target Channel",
      channelUsername: "target_channel",
      stage2: null,
      progress: null,
      stageCreatedAt: nowIso(),
      commentsAvailable: true,
      instruction: "",
      runs: [
        {
          runId: "run_attached",
          chatId: "chat_1",
          channelId: "target",
          sourceUrl: "https://example.com/short",
          userInstruction: null,
          mode: "manual",
          baseRunId: null,
          status: "running",
          progress: createStage2ProgressSnapshot("run_attached"),
          errorMessage: null,
          hasResult: false,
          createdAt: nowIso(),
          startedAt: nowIso(),
          updatedAt: nowIso(),
          finishedAt: null
        }
      ],
      selectedRunId: "run_attached",
      currentRunStatus: "running",
      currentRunError: null,
      canRunStage2: false,
      canQuickRegenerate: false,
      runBlockedReason: "Для этого чата уже идёт Stage 2.",
      quickRegenerateBlockedReason: "Для этого чата уже идёт Stage 2.",
      isLaunching: false,
      isRunning: false,
      expectedDurationMs: 40_000,
      elapsedMs: 12_000,
      selectedOption: null,
      selectedTitleOption: null,
      onInstructionChange: () => undefined,
      onQuickRegenerate: () => undefined,
      onRunStage2: () => undefined,
      onSelectRun: () => undefined,
      onSelectOption: () => undefined,
      onSelectTitleOption: () => undefined,
      onCopy: () => undefined
    })
  );

  assert.match(html, /Stage 2 уже выполняется в фоне/);
  assert.match(html, /Результат этого запуска ещё не готов/);
  assert.doesNotMatch(html, /Результат второго этапа пуст\. Сначала запустите второй этап/);
  assert.doesNotMatch(html, /danger-text[^>]*>Для этого чата уже идёт Stage 2/);
});

test("step 2 marks future stages as not started after a shortlist failure instead of implying they ran", () => {
  let progress = createStage2ProgressSnapshot("run_failed");
  for (const stageId of ["analyzer", "selector", "writer", "critic", "rewriter"] as const) {
    progress = markStage2ProgressStageRunning(progress, stageId, {
      detail: `${stageId} running`
    });
    progress = markStage2ProgressStageCompleted(progress, stageId, {
      detail: `${stageId} done`
    });
  }
  progress = markStage2ProgressStageRunning(progress, "finalSelector", {
    detail: "Selecting shortlist."
  });
  progress = markStage2ProgressStageFailed(
    progress,
    "finalSelector",
    "Stage 2 final shortlist could not produce 5 valid options after constraint-safe repair and reserve backfill."
  );

  const html = renderToStaticMarkup(
    React.createElement(Step2PickCaption, {
      channelName: "Target Channel",
      channelUsername: "target_channel",
      stage2: null,
      progress,
      stageCreatedAt: nowIso(),
      commentsAvailable: true,
      instruction: "",
      runs: [
        {
          runId: "run_failed",
          chatId: "chat_1",
          channelId: "target",
          sourceUrl: "https://example.com/failed",
          userInstruction: null,
          mode: "manual",
          baseRunId: null,
          status: "failed",
          progress,
          errorMessage:
            "Stage 2 final shortlist could not produce 5 valid options after constraint-safe repair and reserve backfill.",
          hasResult: false,
          createdAt: nowIso(),
          startedAt: nowIso(),
          updatedAt: nowIso(),
          finishedAt: nowIso()
        }
      ],
      selectedRunId: "run_failed",
      currentRunStatus: "failed",
      currentRunError:
        "Stage 2 final shortlist could not produce 5 valid options after constraint-safe repair and reserve backfill.",
      canRunStage2: true,
      canQuickRegenerate: false,
      runBlockedReason: null,
      quickRegenerateBlockedReason: null,
      isLaunching: false,
      isRunning: false,
      expectedDurationMs: 40_000,
      elapsedMs: 12_000,
      selectedOption: null,
      selectedTitleOption: null,
      onInstructionChange: () => undefined,
      onQuickRegenerate: () => undefined,
      onRunStage2: () => undefined,
      onSelectRun: () => undefined,
      onSelectOption: () => undefined,
      onSelectTitleOption: () => undefined,
      onCopy: () => undefined
    })
  );

  assert.match(html, /Последний запуск остановился на этапе, отмеченном ниже/);
  assert.match(html, /Ожидает запуска/);
  assert.doesNotMatch(html, /Generating titles/);
  assert.doesNotMatch(html, /Generating SEO/);
});

test("step 2 renders separate quick regenerate and full rerun controls with run mode labels", () => {
  const stage2 = makeRuntimeStage2Response("run_quick_ui", "quick");
  const html = renderToStaticMarkup(
    React.createElement(Step2PickCaption, {
      channelName: "Quick Channel",
      channelUsername: "quick_channel",
      stage2,
      progress: null,
      stageCreatedAt: nowIso(),
      commentsAvailable: true,
      instruction: "make it sharper",
      runs: [
        {
          runId: "run_quick_ui",
          chatId: "chat_1",
          channelId: "target",
          sourceUrl: "https://example.com/quick",
          userInstruction: "make it sharper",
          mode: "regenerate",
          baseRunId: "run_base_ui",
          status: "completed",
          progress: createStage2ProgressSnapshot("run_quick_ui", "regenerate"),
          errorMessage: null,
          hasResult: true,
          createdAt: nowIso(),
          startedAt: nowIso(),
          updatedAt: nowIso(),
          finishedAt: nowIso()
        }
      ],
      selectedRunId: "run_quick_ui",
      currentRunStatus: "completed",
      currentRunError: null,
      canRunStage2: true,
      canQuickRegenerate: true,
      runBlockedReason: null,
      quickRegenerateBlockedReason: null,
      isLaunching: false,
      isRunning: false,
      expectedDurationMs: 20_000,
      elapsedMs: 4_000,
      selectedOption: 1,
      selectedTitleOption: 1,
      onInstructionChange: () => undefined,
      onQuickRegenerate: () => undefined,
      onRunStage2: () => undefined,
      onSelectRun: () => undefined,
      onSelectOption: () => undefined,
      onSelectTitleOption: () => undefined,
      onCopy: () => undefined
    })
  );

  assert.match(html, /Перегенерировать варианты/);
  assert.match(html, /Полный прогон Stage 2/);
  assert.match(html, /Готов · быстрый/);
});

test("pickPreferredStage2RunId reconnects the UI to the active durable run first", () => {
  const runs: Stage2RunSummary[] = [
    {
      runId: "run_done",
      chatId: "chat_1",
      channelId: "target",
      sourceUrl: "https://example.com/done",
      userInstruction: null,
      mode: "manual",
      baseRunId: null,
      status: "completed",
      progress: createStage2ProgressSnapshot("run_done"),
      errorMessage: null,
      hasResult: true,
      createdAt: nowIso(),
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: nowIso()
    },
    {
      runId: "run_active",
      chatId: "chat_1",
      channelId: "target",
      sourceUrl: "https://example.com/active",
      userInstruction: null,
      mode: "manual",
      baseRunId: null,
      status: "running",
      progress: createStage2ProgressSnapshot("run_active"),
      errorMessage: null,
      hasResult: false,
      createdAt: nowIso(),
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: null
    }
  ];

  assert.equal(pickPreferredStage2RunId(runs, null), "run_active");
  assert.equal(pickPreferredStage2RunId(runs, "run_done"), "run_done");
});

test("pickPreferredStage2RunId prefers a completed run over failed history when no run is active", () => {
  const runs: Stage2RunSummary[] = [
    {
      runId: "run_failed_newer",
      chatId: "chat_1",
      channelId: "target",
      sourceUrl: "https://example.com/failed",
      userInstruction: null,
      mode: "manual",
      baseRunId: null,
      status: "failed",
      progress: createStage2ProgressSnapshot("run_failed_newer"),
      errorMessage: "failed",
      hasResult: false,
      createdAt: "2026-03-22T18:20:29.629Z",
      startedAt: "2026-03-22T18:20:30.000Z",
      updatedAt: "2026-03-22T18:24:24.602Z",
      finishedAt: "2026-03-22T18:24:24.602Z"
    },
    {
      runId: "run_completed_older",
      chatId: "chat_1",
      channelId: "target",
      sourceUrl: "https://example.com/completed",
      userInstruction: null,
      mode: "manual",
      baseRunId: null,
      status: "completed",
      progress: createStage2ProgressSnapshot("run_completed_older"),
      errorMessage: null,
      hasResult: true,
      createdAt: "2026-03-22T18:16:11.967Z",
      startedAt: "2026-03-22T18:16:12.000Z",
      updatedAt: "2026-03-22T18:18:57.117Z",
      finishedAt: "2026-03-22T18:18:57.117Z"
    }
  ];

  assert.equal(pickPreferredStage2RunId(runs, null), "run_completed_older");
});

test("pickPreferredStage2RunId heals a stale failed selection when a newer completed run appears", () => {
  const runs: Stage2RunSummary[] = [
    {
      runId: "run_completed_newer",
      chatId: "chat_1",
      channelId: "target",
      sourceUrl: "https://example.com/completed",
      userInstruction: null,
      mode: "manual",
      baseRunId: null,
      status: "completed",
      progress: createStage2ProgressSnapshot("run_completed_newer"),
      errorMessage: null,
      hasResult: true,
      createdAt: "2026-03-22T18:39:26.242Z",
      startedAt: "2026-03-22T18:39:27.000Z",
      updatedAt: "2026-03-22T18:43:56.362Z",
      finishedAt: "2026-03-22T18:43:56.362Z"
    },
    {
      runId: "run_failed_older",
      chatId: "chat_1",
      channelId: "target",
      sourceUrl: "https://example.com/failed",
      userInstruction: null,
      mode: "manual",
      baseRunId: null,
      status: "failed",
      progress: createStage2ProgressSnapshot("run_failed_older"),
      errorMessage: "failed",
      hasResult: false,
      createdAt: "2026-03-22T18:07:31.032Z",
      startedAt: "2026-03-22T18:07:32.000Z",
      updatedAt: "2026-03-22T18:11:15.978Z",
      finishedAt: "2026-03-22T18:11:15.978Z"
    }
  ];

  assert.equal(pickPreferredStage2RunId(runs, "run_failed_older"), "run_completed_newer");
});

test("regenerate runs persist baseRunId and use lightweight progress stages", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Quick Regenerate",
      email: "owner-quick@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Quick Channel",
      username: "quick_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/quick-regenerate",
      channel.id
    );

    const baseRun = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: chat.url,
        userInstruction: null,
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints
        }
      }
    });

    const regenerateRun = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: chat.url,
        userInstruction: "make it shorter",
        mode: "regenerate",
        baseRunId: baseRun.runId,
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints
        }
      }
    });

    assert.equal(regenerateRun.baseRunId, baseRun.runId);
    assert.deepEqual(
      regenerateRun.snapshot.steps.map((step) => step.id),
      ["base", "regenerate", "assemble"]
    );

    const reloaded = getStage2Run(regenerateRun.runId);
    assert.equal(reloaded?.baseRunId, baseRun.runId);
    assert.deepEqual(
      reloaded?.snapshot.steps.map((step) => step.id),
      ["base", "regenerate", "assemble"]
    );
  });
});

test("quick regenerate result preserves base shortlist structure and only rewrites visible options", () => {
  const baseStage2 = makeRuntimeStage2Response("run_base_quick", "base");
  const liveStyleProfile = normalizeStage2StyleProfile(undefined);
  const liveEditorialMemory = {
    ...createEmptyStage2EditorialMemorySummary(liveStyleProfile),
    recentFeedbackCount: 3,
    recentSelectionCount: 2,
    activeHardRuleCount: 1,
    promptSummary: "Recent explicit feedback: keep the dryer tone and avoid grandstanding.",
    recentNotes: ["keep the dryer tone"],
    hardRuleNotes: ["avoid grandstanding"]
  };
  const channelConstraints: Stage2HardConstraints = {
    topLengthMin: 5,
    topLengthMax: 120,
    bottomLengthMin: 5,
    bottomLengthMax: 120,
    bannedWords: [],
    bannedOpeners: []
  };
  baseStage2.source.topComments = [
    {
      id: "quick-1",
      author: "Quick author",
      text: "that axle was done",
      likes: 42,
      postedAt: "2026-03-20T10:00:00.000Z"
    }
  ];
  baseStage2.source.allComments = [...baseStage2.source.topComments];
  baseStage2.source.totalComments = baseStage2.source.topComments.length;
  baseStage2.source.commentsUsedForPrompt = baseStage2.source.topComments.length;
  baseStage2.source.frameDescriptions = [
    "frame 1: axle still holding",
    "frame 2: axle twist becomes visible"
  ];
  baseStage2.output.captionOptions = baseStage2.output.captionOptions.map((option, index) => ({
    ...option,
    candidateId: `cand_${index + 1}`,
    angle: index % 2 === 0 ? "payoff_reveal" : "shared_experience",
    top: `Base option ${index + 1} keeps the axle twist visible for everyone watching.`,
    bottom: `"Nobody in that cab expected the axle to fold," and the whole lane hears it ${index + 1}.`,
    topRu: `Базовый вариант ${index + 1} прямо показывает, как мост уходит под всей машиной.`,
    bottomRu: `"Никто в кабине не ждал такого удара", и это слышит вся колонна ${index + 1}.`
  }));
  baseStage2.output.titleOptions = baseStage2.output.titleOptions.map((option, index) => ({
    ...option,
    title: `BASE FILE ${index + 1}`,
    titleRu: `БАЗОВЫЙ ФАЙЛ ${index + 1}`
  }));
  baseStage2.output.finalPick = {
    option: 2,
    reason: "Base final pick"
  };
  baseStage2.seo = {
    description: "Saved SEO block",
    tags: "alpha,beta"
  };
  baseStage2.diagnostics = {
    channel: {
      channelId: "channel_quick",
      name: "Quick Channel",
      username: "quick_channel",
      examplesSource: "workspace_default",
      hardConstraints: channelConstraints,
      workspaceCorpusCount: 8,
      activeCorpusCount: 3
    },
    selection: {
      clipType: "mechanical_failure",
      primaryAngle: "payoff_reveal",
      secondaryAngles: ["shared_experience"],
      rankedAngles: [
        { angle: "payoff_reveal", score: 9.5, why: "best fit" },
        { angle: "shared_experience", score: 8.8, why: "strong alternate" }
      ],
      coreTrigger: "axle drop",
      humanStake: "the whole cab feels it",
      narrativeFrame: "slow disaster",
      whyViewerCares: "the failure is visible immediately",
      topStrategy: "name the visual failure cleanly",
      bottomEnergy: "quoted reaction",
      whyOldV6WouldWorkHere: "strong visual",
      failureModes: ["too generic"],
      writerBrief: "stay concrete",
      rationale: "base selector rationale",
      selectedExampleIds: ["example_1"]
    },
    analysis: {
      visualAnchors: ["axle twisting under load"],
      specificNouns: ["axle", "mud", "truck"],
      visibleActions: ["rear axle drops", "truck lurches sideways"],
      firstSecondsSignal: "The axle is visibly giving out before the truck clears the rut.",
      sceneBeats: ["truck digs into mud", "axle twists", "rear corner drops"],
      revealMoment: "The wheel folds inward and the failure becomes obvious.",
      lateClipChange: "The truck stops reading as stuck and starts reading as broken.",
      whyViewerCares: "The failure is visible before the run fully ends.",
      bestBottomEnergy: "dry mechanic disbelief",
      commentVibe: "Mechanical disaster with instant crowd recognition.",
      commentConsensusLane: "Consensus lane stays on the visible axle failure.",
      commentJokeLane: "Joke lane frames it like the truck was cooked from the first push.",
      commentDissentLane: "",
      commentSuspicionLane: "",
      commentLanguageCues: ["cooked", "that axle was done"],
      uncertaintyNotes: [],
      rawSummary: "A mud run turns into a visible axle failure once the rear corner collapses."
    },
    sourceContext: {
      sourceUrl: "https://example.com/clip",
      title: "Bridge collapse",
      descriptionChars: 120,
      transcriptChars: 80,
      speechGroundingStatus: "transcript_present",
      frameCount: 4,
      runtimeCommentCount: 6,
      runtimeCommentIds: ["comment_1", "comment_2"],
      userInstructionChars: 0
    },
    effectivePrompting: {
      promptStages: [
        {
          stageId: "writer",
          label: "Writer",
          stageType: "llm_prompt",
          defaultPrompt: "writer default",
          configuredPrompt: "writer default",
          reasoningEffort: "low",
          isCustomPrompt: false,
          promptText: "writer prompt",
          promptChars: 42,
          usesImages: false,
          summary: "writer stage"
        }
      ]
    },
    examples: {
      source: "workspace_default",
      workspaceCorpusCount: 8,
      activeCorpusCount: 3,
      selectorCandidateCount: 3,
      retrievalConfidence: "medium",
      examplesMode: "form_guided",
      explanation: "Examples are structurally useful but only partially domain-near.",
      evidence: ["0/3 top examples are strong semantic guides", "3/3 remain structurally useful"],
      retrievalWarning: "Examples are being used mainly for form guidance.",
      examplesRoleSummary: "Examples help with structure more than semantics.",
      primaryDriverSummary: "Clip truth and channel learning carry more weight than retrieval.",
      primaryDrivers: [
        "actual clip truth",
        "bootstrap channel style directions",
        "rolling editorial memory",
        "retrieval examples as form guidance"
      ],
      channelStylePriority: "elevated",
      editorialMemoryPriority: "elevated",
      availableExamples: [],
      selectedExamples: [
        {
          id: "example_1",
          bucket: "selected",
          channelName: "Quick corpus",
          sourceChannelId: "workspace-default",
          sourceChannelName: "Workspace default",
          videoId: null,
          title: "Quick selected example",
          clipType: "mechanical_failure",
          overlayTop: "Selected example top",
          overlayBottom: "Selected example bottom",
          whyItWorks: ["strong mechanical framing"],
          qualityScore: 0.91,
          retrievalScore: 0.89,
          retrievalReasons: ["same failure beat"],
          guidanceRole: "form_guidance",
          sampleKind: "workspace_default",
          isOwnedAnchor: false,
          isAntiExample: false,
          publishedAt: null,
          views: null,
          ageHours: null,
          anomalyScore: null
        }
      ]
    }
  };
  (baseStage2.output as Record<string, unknown>).pipeline = {
    channelId: "channel_quick",
    mode: "codex_pipeline",
    selectorOutput: {
      clipType: "mechanical_failure",
      primaryAngle: "payoff_reveal",
      secondaryAngles: ["shared_experience"],
      rankedAngles: [
        { angle: "payoff_reveal", score: 9.5, why: "best fit" },
        { angle: "shared_experience", score: 8.8, why: "strong alternate" }
      ],
      coreTrigger: "axle drop",
      humanStake: "the whole cab feels it",
      narrativeFrame: "slow disaster",
      whyViewerCares: "the failure is visible immediately",
      topStrategy: "name the visual failure cleanly",
      bottomEnergy: "quoted reaction",
      whyOldV6WouldWorkHere: "strong visual",
      failureModes: ["too generic"],
      writerBrief: "stay concrete",
      rationale: "base selector rationale",
      selectedExampleIds: ["example_1"]
    },
    availableExamplesCount: 8,
    selectedExamplesCount: 3
  };

  const promptText = buildQuickRegeneratePrompt({
    stage2: baseStage2,
    channel: {
      id: "channel_quick",
      name: "Quick Channel",
      username: "quick_channel",
      stage2HardConstraints: channelConstraints,
      stage2StyleProfile: liveStyleProfile,
      editorialMemory: liveEditorialMemory
    },
    userInstruction: "make it shorter and sneak in one dry joke"
  });
  const quick = buildQuickRegenerateResult({
    runId: "run_quick_regen",
    createdAt: nowIso(),
    mode: "regenerate",
    baseRunId: "run_base_quick",
    baseResult: baseStage2,
    channel: {
      id: "channel_quick",
      name: "Quick Channel",
      username: "quick_channel",
      stage2HardConstraints: channelConstraints,
      stage2StyleProfile: liveStyleProfile,
      editorialMemory: liveEditorialMemory
    },
    userInstruction: "make it shorter and sneak in one dry joke",
    promptText,
    reasoningEffort: "low",
    model: "gpt-test",
    rawOutput: {
      options: baseStage2.output.captionOptions.map((option, index) => ({
        option: option.option,
        candidate_id: option.candidateId,
        angle: option.angle,
        top:
          index === 1
            ? "bad"
            : `Quick rewrite ${index + 1} keeps the axle twist visible and the joke dry.`,
        bottom:
          index === 1
            ? "bad"
            : `"Nobody in that cab had a backup plan," and the whole lane feels it ${index + 1}.`,
        top_ru: `Быстрая версия ${index + 1}.`,
        bottom_ru: `"У них не было плана Б", и это чувствует вся колонна ${index + 1}.`,
        title: index === 1 ? "" : `QUICK FILE ${index + 1}`,
        title_ru: index === 1 ? "" : `БЫСТРЫЙ ФАЙЛ ${index + 1}`
      })),
      final_pick_option: 4,
      selection_rationale: "Option 4 is the cleanest visible winner in this saved shortlist."
    }
  });
  const result = quick.response;

  const pipeline = (result.output as Record<string, unknown>).pipeline as Record<string, unknown>;
  const finalSelector = (pipeline.finalSelector ?? {}) as Record<string, unknown>;
  const candidateIds = result.output.captionOptions.map((option) => option.candidateId);

  assert.equal(result.stage2Run?.mode, "regenerate");
  assert.equal(result.stage2Run?.baseRunId, "run_base_quick");
  assert.equal(result.output.captionOptions.length, baseStage2.output.captionOptions.length);
  assert.equal(result.output.titleOptions.length, baseStage2.output.titleOptions.length);
  assert.deepEqual(
    candidateIds,
    baseStage2.output.captionOptions.map((option, index) => option.candidateId ?? `cand_${index + 1}`)
  );
  assert.equal(result.output.finalPick.option, 4);
  assert.equal(finalSelector.finalPickCandidateId, "cand_4");
  assert.deepEqual(finalSelector.shortlistCandidateIds, candidateIds);
  assert.equal(finalSelector.rationaleRaw, result.output.finalPick.reason);
  assert.equal(result.output.captionOptions[1]?.top, baseStage2.output.captionOptions[1]?.top);
  assert.equal(result.output.titleOptions[1]?.title, baseStage2.output.titleOptions[1]?.title);
  assert.match(result.warnings.map((warning) => warning.message).join(" "), /SEO reused from base run/);
  assert.match(result.warnings.map((warning) => warning.message).join(" "), /restored from the base run/);
  assert.match(promptText, /Preserve style_direction_ids and exploration_mode/i);
  assert.match(promptText, /Remove stock tails like 'the reaction basically writes itself'/i);
  assert.match(promptText, /"retrieval":/);
  assert.match(promptText, /"analysis":/);
  assert.match(promptText, /"channelLearning":/);
  assert.match(promptText, /keep the dryer tone/i);
  assert.ok(
    result.diagnostics?.effectivePrompting.promptStages.some((stage) => stage.stageId === "regenerate")
  );
  const regenerateStage = result.diagnostics?.effectivePrompting.promptStages.find(
    (stage) => stage.stageId === "regenerate"
  );
  assert.equal(regenerateStage?.inputManifest?.comments?.passedCount, 1);
  assert.deepEqual(regenerateStage?.inputManifest?.comments?.passedCommentIds, ["quick-1"]);
  assert.equal(regenerateStage?.inputManifest?.examples?.passedCount, 1);
  assert.deepEqual(regenerateStage?.inputManifest?.examples?.passedExampleIds, ["example_1"]);
  assert.equal(regenerateStage?.inputManifest?.channelLearning?.recentFeedbackCount, 3);
  assert.match(regenerateStage?.inputManifest?.channelLearning?.promptSummary ?? "", /keep the dryer tone/i);
  assert.equal(result.diagnostics?.channel.editorialMemory?.recentFeedbackCount, 3);
  assert.match(result.diagnostics?.channel.editorialMemory?.promptSummary ?? "", /keep the dryer tone/i);
  assert.match(
    result.warnings.map((warning) => warning.message).join(" "),
    /latest channel feedback collected after the base run/i
  );
  assert.equal(pipeline.mode, "regenerate");
});

test("scoped Stage 2 request versions do not let one chat invalidate another chat response", () => {
  const first = issueScopedRequestVersion({}, "chat_a");
  const second = issueScopedRequestVersion(first.nextVersions, "chat_b");
  const third = issueScopedRequestVersion(second.nextVersions, "chat_a");

  assert.equal(first.version, 1);
  assert.equal(second.version, 1);
  assert.equal(third.version, 2);
  assert.equal(matchesScopedRequestVersion(third.nextVersions, "chat_a", first.version), false);
  assert.equal(matchesScopedRequestVersion(third.nextVersions, "chat_b", second.version), true);
  assert.equal(matchesScopedRequestVersion(third.nextVersions, "chat_a", third.version), true);
});

test("pickPreferredSourceJobId reconnects the UI to the active durable source job first", () => {
  const jobs: SourceJobSummary[] = [
    {
      jobId: "job_done",
      chatId: "chat",
      channelId: "channel",
      sourceUrl: "https://example.com/done",
      status: "completed",
      progress: {
        status: "completed",
        activeStageId: null,
        detail: "done",
        createdAt: nowIso(),
        startedAt: nowIso(),
        updatedAt: nowIso(),
        finishedAt: nowIso(),
        error: null
      },
      errorMessage: null,
      hasResult: true,
      createdAt: nowIso(),
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: nowIso()
    },
    {
      jobId: "job_active",
      chatId: "chat",
      channelId: "channel",
      sourceUrl: "https://example.com/active",
      status: "running",
      progress: {
        status: "running",
        activeStageId: "comments",
        detail: "loading comments",
        createdAt: nowIso(),
        startedAt: nowIso(),
        updatedAt: nowIso(),
        finishedAt: null,
        error: null
      },
      errorMessage: null,
      hasResult: false,
      createdAt: nowIso(),
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: null
    }
  ];

  assert.equal(pickPreferredSourceJobId(jobs, null), "job_active");
  assert.equal(pickPreferredSourceJobId(jobs, "job_done"), "job_done");
});

test("new source fetch only reuses active chat when the draft url still targets that same chat", () => {
  assert.equal(
    shouldReuseActiveChatForSourceFetch({
      activeChatId: "chat_active",
      activeChatUrl: "https://example.com/current",
      draftUrl: "https://example.com/current"
    }),
    true
  );
  assert.equal(
    shouldReuseActiveChatForSourceFetch({
      activeChatId: "chat_active",
      activeChatUrl: "https://example.com/current",
      draftUrl: "https://example.com/new"
    }),
    false
  );
  assert.equal(
    resolveSourceFetchBlockedReason({
      activeChannelId: "channel_1",
      fetchSourceAvailable: true,
      fetchSourceBlockedReason: null,
      reusesActiveChat: false,
      hasActiveSourceJob: false,
      hasActiveStage2Run: true
    }),
    null
  );
  assert.equal(
    resolveSourceFetchBlockedReason({
      activeChannelId: "channel_1",
      fetchSourceAvailable: true,
      fetchSourceBlockedReason: null,
      reusesActiveChat: true,
      hasActiveSourceJob: false,
      hasActiveStage2Run: true
    }),
    "Для этого чата уже идёт Stage 2. Дождитесь завершения перед новым получением источника."
  );
});

test("step 1 shows attached source job as neutral live state instead of repeating a red blocking error", () => {
  const sourceJob: SourceJobDetail = {
    jobId: "job_active",
    chatId: "chat",
    channelId: "channel",
    sourceUrl: "https://example.com/active",
    status: "running",
    progress: {
      status: "running",
      activeStageId: "comments",
      detail: "Пробуем загрузить комментарии.",
      createdAt: nowIso(),
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: null,
      error: null
    },
    errorMessage: null,
    hasResult: false,
    createdAt: nowIso(),
    startedAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: null,
    result: null
  };

  const html = renderToStaticMarkup(
    React.createElement(Step1PasteLink, {
      draftUrl: "",
      activeUrl: "https://example.com/active",
      sourceJob,
      sourceJobElapsedMs: 8_000,
      commentsFallbackActive: false,
      fetchBusy: false,
      downloadBusy: false,
      fetchAvailable: false,
      fetchBlockedReason: "Для этого чата уже идёт получение источника.",
      uploadBusy: false,
      uploadAvailable: true,
      uploadBlockedReason: null,
      autoRunStage2Enabled: true,
      downloadAvailable: true,
      downloadBlockedReason: null,
      onDraftUrlChange: () => undefined,
      onPaste: () => undefined,
      onFetch: () => undefined,
      onUploadFiles: () => undefined,
      onAutoRunStage2Change: () => undefined,
      onDownloadSource: () => undefined
    })
  );

  assert.match(html, /Источник уже обрабатывается в фоне/);
  assert.doesNotMatch(html, /danger-text[^>]*>Для этого чата уже идёт получение источника\./);
});

test("step 1 renders hosted retry countdown and provider diagnostics while retry is pending", () => {
  const sourceJob: SourceJobDetail = {
    jobId: "job_retry",
    chatId: "chat_retry",
    channelId: "channel_retry",
    sourceUrl: "https://www.youtube.com/watch?v=qQhqClv6fNo",
    status: "running",
    progress: {
      status: "running",
      activeStageId: "retry",
      detail: "Visolix временно недоступен. Повторяем через 5 с.",
      attempt: 1,
      maxAttempts: 2,
      nextRetryAt: new Date(Date.now() + 1_500).toISOString(),
      retryEligible: true,
      providerErrorSummary: {
        primaryProvider: "visolix",
        primaryProviderError: "Database connection unavailable",
        primaryRetryEligible: true,
        fallbackProvider: null,
        fallbackProviderError: null,
        hostedFallbackSkippedReason:
          "Hosted policy: yt-dlp fallback для YouTube source download пропущен на этом runtime."
      },
      createdAt: nowIso(),
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: null,
      error: null
    },
    errorMessage: null,
    hasResult: false,
    createdAt: nowIso(),
    startedAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: null,
    result: null
  };

  const html = renderToStaticMarkup(
    React.createElement(Step1PasteLink, {
      draftUrl: "",
      activeUrl: sourceJob.sourceUrl,
      sourceJob,
      sourceJobElapsedMs: 2_000,
      commentsFallbackActive: false,
      fetchBusy: false,
      downloadBusy: false,
      fetchAvailable: false,
      fetchBlockedReason: "Для этого чата уже идёт получение источника.",
      uploadBusy: false,
      uploadAvailable: true,
      uploadBlockedReason: null,
      autoRunStage2Enabled: true,
      downloadAvailable: true,
      downloadBlockedReason: null,
      onDraftUrlChange: () => undefined,
      onPaste: () => undefined,
      onFetch: () => undefined,
      onUploadFiles: () => undefined,
      onAutoRunStage2Change: () => undefined,
      onDownloadSource: () => undefined
    })
  );

  assert.match(html, /Попытка 1 из 2/);
  assert.match(html, /следующий запрос через/);
  assert.match(html, /Visolix: Database connection unavailable/);
});

test("step 1 keeps an attached stage 2 run informational instead of rendering it as a blocking error", () => {
  const html = renderToStaticMarkup(
    React.createElement(Step1PasteLink, {
      draftUrl: "",
      activeUrl: "https://example.com/active",
      sourceJob: null,
      sourceJobElapsedMs: 0,
      commentsFallbackActive: false,
      fetchBusy: false,
      downloadBusy: false,
      fetchAvailable: false,
      fetchBlockedReason: "Для этого чата уже идёт Stage 2. Дождитесь завершения перед новым получением источника.",
      uploadBusy: false,
      uploadAvailable: true,
      uploadBlockedReason: null,
      autoRunStage2Enabled: true,
      downloadAvailable: true,
      downloadBlockedReason: null,
      onDraftUrlChange: () => undefined,
      onPaste: () => undefined,
      onFetch: () => undefined,
      onUploadFiles: () => undefined,
      onAutoRunStage2Change: () => undefined,
      onDownloadSource: () => undefined
    })
  );

  assert.match(html, /Второй этап уже выполняется для этого чата/);
  assert.doesNotMatch(html, /danger-text[^>]*>Для этого чата уже идёт Stage 2/);
});

test("step 1 preview makes the source link clickable and embeds a YouTube player when possible", () => {
  const html = renderToStaticMarkup(
    React.createElement(Step1PasteLink, {
      draftUrl: "",
      activeUrl: "https://www.youtube.com/watch?v=qQhqClv6fNo",
      sourceJob: null,
      sourceJobElapsedMs: 0,
      commentsFallbackActive: false,
      fetchBusy: false,
      downloadBusy: false,
      fetchAvailable: true,
      fetchBlockedReason: null,
      uploadBusy: false,
      uploadAvailable: true,
      uploadBlockedReason: null,
      autoRunStage2Enabled: true,
      downloadAvailable: true,
      downloadBlockedReason: null,
      onDraftUrlChange: () => undefined,
      onPaste: () => undefined,
      onFetch: () => undefined,
      onUploadFiles: () => undefined,
      onAutoRunStage2Change: () => undefined,
      onDownloadSource: () => undefined
    })
  );

  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=qQhqClv6fNo"/);
  assert.match(html, /source-link-anchor/);
  assert.match(html, /iframe/);
  assert.match(html, /youtube\.com\/embed\/qQhqClv6fNo/);
});

test("step 1 renders a custom mp4 upload panel and auto-stage2 checkbox", () => {
  const html = renderToStaticMarkup(
    React.createElement(Step1PasteLink, {
      draftUrl: "",
      activeUrl: null,
      sourceJob: null,
      sourceJobElapsedMs: 0,
      commentsFallbackActive: false,
      fetchBusy: false,
      downloadBusy: false,
      fetchAvailable: true,
      fetchBlockedReason: null,
      uploadBusy: false,
      uploadAvailable: true,
      uploadBlockedReason: null,
      autoRunStage2Enabled: true,
      downloadAvailable: true,
      downloadBlockedReason: null,
      onDraftUrlChange: () => undefined,
      onPaste: () => undefined,
      onFetch: () => undefined,
      onUploadFiles: () => undefined,
      onAutoRunStage2Change: () => undefined,
      onDownloadSource: () => undefined
    })
  );

  assert.match(html, /Выбрать mp4/);
  assert.match(html, /Готовый mp4 не выбран/);
  assert.match(html, /Автоматически запускать Stage 2 после завершения Step 1/);
  assert.match(html, /checked=""/);
});

test("step 1 no longer renders an inline next-chat shortcut card inside the workspace", () => {
  const html = renderToStaticMarkup(
    React.createElement(Step1PasteLink, {
      draftUrl: "",
      activeUrl: "https://example.com/ready",
      sourceJob: {
        jobId: "job_ready",
        chatId: "chat_ready",
        channelId: "channel_ready",
        sourceUrl: "https://example.com/ready",
        status: "completed",
        progress: {
          status: "completed",
          activeStageId: null,
          detail: "Источник готов.",
          createdAt: nowIso(),
          startedAt: nowIso(),
          updatedAt: nowIso(),
          finishedAt: nowIso(),
          error: null
        },
        errorMessage: null,
        hasResult: true,
        createdAt: nowIso(),
        startedAt: nowIso(),
        updatedAt: nowIso(),
        finishedAt: nowIso(),
        result: {
          chatId: "chat_ready",
          channelId: "channel_ready",
          sourceUrl: "https://example.com/ready",
          stage1Ready: true,
          title: "Ready clip",
          commentsAvailable: true,
          commentsError: null,
          commentsPayload: null,
          autoStage2RunId: "run_ready"
        }
      },
      sourceJobElapsedMs: 0,
      commentsFallbackActive: false,
      fetchBusy: false,
      downloadBusy: false,
      fetchAvailable: true,
      fetchBlockedReason: null,
      uploadBusy: false,
      uploadAvailable: true,
      uploadBlockedReason: null,
      autoRunStage2Enabled: true,
      downloadAvailable: true,
      downloadBlockedReason: null,
      showCreateNextChatShortcut: true,
      onDraftUrlChange: () => undefined,
      onPaste: () => undefined,
      onFetch: () => undefined,
      onUploadFiles: () => undefined,
      onAutoRunStage2Change: () => undefined,
      onDownloadSource: () => undefined,
      onCreateNextChat: () => undefined
    })
  );

  assert.doesNotMatch(html, /Следующий ролик/);
  assert.doesNotMatch(html, /Создать новый чат/);
});

test("step 2 no longer renders an inline next-chat shortcut card inside the workspace", () => {
  const html = renderToStaticMarkup(
    React.createElement(Step2PickCaption, {
      channelName: "Queue Channel",
      channelUsername: "queue_channel",
      stage2: null,
      progress: null,
      stageCreatedAt: nowIso(),
      commentsAvailable: true,
      instruction: "",
      runs: [],
      selectedRunId: null,
      currentRunStatus: null,
      currentRunError: null,
      canRunStage2: true,
      canQuickRegenerate: true,
      runBlockedReason: null,
      quickRegenerateBlockedReason: null,
      showCreateNextChatShortcut: true,
      isLaunching: false,
      isRunning: false,
      expectedDurationMs: 40_000,
      elapsedMs: 0,
      selectedOption: null,
      selectedTitleOption: null,
      onInstructionChange: () => undefined,
      onQuickRegenerate: () => undefined,
      onRunStage2: () => undefined,
      onSelectRun: () => undefined,
      onSelectOption: () => undefined,
      onSelectTitleOption: () => undefined,
      onCreateNextChat: () => undefined,
      onCopy: () => undefined
    })
  );

  assert.doesNotMatch(html, /Следующий ролик/);
  assert.doesNotMatch(html, /Создать новый чат/);
});

test("chat list items surface active source jobs as live fetching state", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const sourceStore = await import("../lib/source-job-store");
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Source Sidebar",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Source Channel",
      username: "source_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/source-live-state",
      channel.id
    );

    sourceStore.createSourceJob({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: {
        sourceUrl: chat.url,
        autoRunStage2: false,
        trigger: "fetch",
        chat: {
          id: chat.id,
          channelId: channel.id
        },
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username
        }
      }
    });

    const items = await chatHistory.listChatListItems(owner.user.id, channel.id, owner.workspace.id);
    assert.equal(items[0]?.id, chat.id);
    assert.equal(items[0]?.liveAction, "Fetching");
    assert.equal(items[0]?.preferredStep, 1);
  });
});

test("chat list items surface retrying source jobs with dedicated live action", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const sourceStore = await import("../lib/source-job-store");
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Source Retry Sidebar",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Retry Channel",
      username: "retry_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/source-retry-live-state",
      channel.id
    );

    const job = sourceStore.createSourceJob({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: {
        sourceUrl: chat.url,
        autoRunStage2: false,
        trigger: "fetch",
        chat: {
          id: chat.id,
          channelId: channel.id
        },
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username
        }
      }
    });
    sourceStore.markSourceJobRetryScheduled(job.jobId, {
      detail: "Visolix временно недоступен. Повторяем через 5 с.",
      attempt: 1,
      maxAttempts: 2,
      nextRetryAt: new Date(Date.now() + 1_000).toISOString(),
      retryEligible: true,
      providerErrorSummary: {
        primaryProvider: "visolix",
        primaryProviderError: "Database connection unavailable",
        primaryRetryEligible: true,
        fallbackProvider: null,
        fallbackProviderError: null,
        hostedFallbackSkippedReason: null
      }
    });

    const items = await chatHistory.listChatListItems(owner.user.id, channel.id, owner.workspace.id);
    assert.equal(items[0]?.id, chat.id);
    assert.equal(items[0]?.liveAction, "Retrying");
    assert.equal(items[0]?.preferredStep, 1);
  });
});

test("chat list items surface active Stage 2 runs as live Stage 2 state and step 2", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const stage2Store = await import("../lib/stage2-progress-store");
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Sidebar",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Stage 2 Channel",
      username: "stage2_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/stage2-live-state",
      channel.id
    );

    const run = stage2Store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: chat.url,
        userInstruction: null,
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints
        }
      }
    });
    stage2Store.markStage2RunStageRunning(run.runId, "writer", {
      detail: "Writing shortlist."
    });

    const items = await chatHistory.listChatListItems(owner.user.id, channel.id, owner.workspace.id);
    assert.equal(items[0]?.id, chat.id);
    assert.equal(items[0]?.liveAction, "Stage 2");
    assert.equal(items[0]?.preferredStep, 2);
  });
});

test("source job runtime keeps parallel jobs isolated and durable across reload-style rereads", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const runtime = await import("../lib/source-job-runtime");
    const store = await import("../lib/source-job-store");
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    let activeCount = 0;
    let maxActiveCount = 0;

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Source Runtime",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Source Runtime Channel",
      username: "source_runtime_channel"
    });
    const chatA = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/source-runtime-a",
      channel.id
    );
    const chatB = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/source-runtime-b",
      channel.id
    );

    runtime.setSourceJobProcessorForTests(async (job) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      try {
        store.markSourceJobStageRunning(job.jobId, "comments", `comments ${job.chatId}`);
        await sleep(60);
        return makeSourceJobResult({
          chatId: job.chatId,
          channelId: job.channelId,
          sourceUrl: job.sourceUrl,
          label: job.request.channel.name || job.chatId,
          commentsAvailable: job.request.trigger !== "comments"
        });
      } finally {
        activeCount -= 1;
      }
    });

    try {
      const jobA = runtime.enqueueAndScheduleSourceJob({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        request: {
          sourceUrl: chatA.url,
          autoRunStage2: false,
          trigger: "fetch",
          chat: {
            id: chatA.id,
            channelId: channel.id
          },
          channel: {
            id: channel.id,
            name: channel.name,
            username: channel.username
          }
        }
      });
      const jobB = runtime.enqueueAndScheduleSourceJob({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        request: {
          sourceUrl: chatB.url,
          autoRunStage2: false,
          trigger: "comments",
          chat: {
            id: chatB.id,
            channelId: channel.id
          },
          channel: {
            id: channel.id,
            name: channel.name,
            username: channel.username
          }
        }
      });

      await waitFor(() =>
        [jobA.jobId, jobB.jobId].every((jobId) => store.getSourceJob(jobId)?.status === "completed")
      );

      assert.ok(maxActiveCount >= 2);

      delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
      const reloadedA = store.listSourceJobsForChat(chatA.id, owner.workspace.id, 10);
      const reloadedB = store.listSourceJobsForChat(chatB.id, owner.workspace.id, 10);
      assert.equal(reloadedA[0]?.status, "completed");
      assert.equal(reloadedB[0]?.status, "completed");
      assert.equal(reloadedA[0]?.resultData?.chatId, chatA.id);
      assert.equal(reloadedB[0]?.resultData?.chatId, chatB.id);
    } finally {
      runtime.setSourceJobProcessorForTests(null);
    }
  });
});

test("stage 2 runtime keeps parallel runs isolated and durable across reload-style rereads", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const runtime = await import("../lib/stage2-run-runtime");
    const store = await import("../lib/stage2-progress-store");
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    let activeCount = 0;
    let maxActiveCount = 0;

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Runtime",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Parallel Channel",
      username: "parallel_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/parallel-runtime-check",
      channel.id
    );

    runtime.setStage2RunProcessorForTests(async (run) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);

      try {
        store.markStage2RunStageRunning(run.runId, "analyzer", {
          detail: `analyzer ${run.userInstruction ?? run.runId}`
        });
        await sleep(40);
        store.markStage2RunStageCompleted(run.runId, "analyzer", {
          detail: "analyzer done"
        });
        store.markStage2RunStageRunning(run.runId, "writer", {
          detail: `writer ${run.userInstruction ?? run.runId}`
        });
        await sleep(80);
        store.markStage2RunStageCompleted(run.runId, "writer", {
          detail: "writer done"
        });
        store.markStage2RunStageRunning(run.runId, "finalSelector", {
          detail: "final selector"
        });
        await sleep(30);
        store.markStage2RunStageCompleted(run.runId, "finalSelector", {
          detail: "shortlist ready"
        });
        return makeRuntimeStage2Response(run.runId, run.userInstruction ?? run.runId);
      } finally {
        activeCount -= 1;
      }
    });

    try {
      const runs = Array.from({ length: 4 }, (_, index) =>
        runtime.enqueueAndScheduleStage2Run({
          workspaceId: owner.workspace.id,
          creatorUserId: owner.user.id,
          chatId: chat.id,
          request: {
            sourceUrl: `https://example.com/clip-${index + 1}`,
            userInstruction: `instruction ${index + 1}`,
            mode: "manual",
            channel: {
              id: channel.id,
              name: channel.name,
              username: channel.username,
              stage2ExamplesConfig: channel.stage2ExamplesConfig,
              stage2HardConstraints: channel.stage2HardConstraints
            }
          }
        })
      );

      await waitFor(() =>
        runs.every((run) => store.getStage2Run(run.runId)?.status === "completed")
      );

      assert.ok(maxActiveCount >= 2);

      delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
      const reloadedRuns = store.listStage2RunsForChat(chat.id, owner.workspace.id, 10);
      assert.equal(reloadedRuns.length, 4);

      const instructionSet = new Set<string>();
      for (const run of reloadedRuns) {
        assert.equal(run.status, "completed");
        assert.equal(run.snapshot.status, "completed");
        assert.ok(run.snapshot.finishedAt);
        const result = run.resultData as Stage2Response | null;
        assert.ok(result);
        assert.equal(result?.output.captionOptions.length, 5);
        assert.ok(result?.stage2Run?.runId);
        if (result?.userInstructionUsed) {
          instructionSet.add(result.userInstructionUsed);
        }
      }

      assert.equal(instructionSet.size, 4);
    } finally {
      runtime.setStage2RunProcessorForTests(null);
    }
  });
});

test("failed stage 2 run remains inspectable after reload-style DB reopen", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const store = await import("../lib/stage2-progress-store");
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Failure",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Failure Channel",
      username: "failure_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/failure-runtime-check",
      channel.id
    );
    const run = store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: "https://example.com/failure",
        userInstruction: "force failure",
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints
        }
      }
    });

    store.markStage2RunStageRunning(run.runId, "candidateGenerator", {
      detail: "Drafting candidate batch."
    });
    store.markStage2RunStageFailed(run.runId, "candidateGenerator", "candidate generator timeout");

    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    const reloaded = store.getStage2Run(run.runId);
    assert.equal(reloaded?.status, "failed");
    assert.equal(reloaded?.errorMessage, "candidate generator timeout");
    assert.equal(reloaded?.snapshot.activeStageId, "candidateGenerator");
    assert.match(reloaded?.snapshot.error ?? "", /candidate generator timeout/);
    assert.equal(
      store.listStage2RunsForChat(chat.id, owner.workspace.id, 10)[0]?.runId,
      run.runId
    );
  });
});

test("running stage 2 run is re-queued after process restart and completes on the next runtime boot", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const runtime = await import("../lib/stage2-run-runtime");
    const store = await import("../lib/stage2-progress-store");
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    let observedRecoveredSnapshot = false;

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Recovery",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Recovery Channel",
      username: "recovery_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/recovery-runtime-check",
      channel.id
    );
    const run = store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: "https://example.com/recovery",
        userInstruction: "recover me",
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2WorkerProfileId: channel.stage2WorkerProfileId,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints
        }
      }
    });

    store.markStage2RunStageRunning(run.runId, "oneShotReference", {
      detail: "Reference one-shot before restart."
    });

    delete (globalThis as { __clipsStage2RuntimeState__?: unknown }).__clipsStage2RuntimeState__;

    runtime.setStage2RunProcessorForTests(async (claimedRun) => {
      const recovered = store.getStage2Run(claimedRun.runId);
      assert.equal(recovered?.status, "running");
      assert.equal(
        recovered?.snapshot.steps.find((step) => step.id === "oneShotReference")?.state,
        "pending"
      );
      assert.match(
        recovered?.snapshot.steps.find((step) => step.id === "oneShotReference")?.detail ?? "",
        /Recovered after process restart/
      );
      observedRecoveredSnapshot = true;

      store.markStage2RunStageRunning(claimedRun.runId, "oneShotReference", {
        detail: "Recovered reference rerun."
      });
      await sleep(25);
      store.markStage2RunStageCompleted(claimedRun.runId, "oneShotReference", {
        detail: "Recovered reference done."
      });
      store.markStage2RunStageRunning(claimedRun.runId, "captionTranslation", {
        detail: "Recovered translation pass."
      });
      await sleep(25);
      store.markStage2RunStageCompleted(claimedRun.runId, "captionTranslation", {
        detail: "Recovered translation pass ready."
      });
      store.markStage2RunStageRunning(claimedRun.runId, "assemble", {
        detail: "Recovered assembly pass."
      });
      await sleep(25);
      store.markStage2RunStageCompleted(claimedRun.runId, "assemble", {
        detail: "Recovered assembly ready."
      });
      return makeRuntimeStage2Response(claimedRun.runId, "recovered");
    });

    try {
      runtime.scheduleStage2RunProcessing();
      await waitFor(() => store.getStage2Run(run.runId)?.status === "completed");

      const recovered = store.getStage2Run(run.runId);
      assert.equal(observedRecoveredSnapshot, true);
      assert.equal(recovered?.status, "completed");
      assert.equal(recovered?.errorMessage, null);
      assert.ok(recovered?.resultData);
      assert.equal(
        (recovered?.resultData as Stage2Response | null)?.userInstructionUsed,
        "recovered"
      );
    } finally {
      runtime.setStage2RunProcessorForTests(null);
    }
  });
});

test("running stage 2 run is failed instead of re-queued after hosted runtime restart", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const previousRender = process.env.RENDER;
    process.env.RENDER = "true";
    try {
      const runtime = await import("../lib/stage2-run-runtime");
      const store = await import("../lib/stage2-progress-store");
      const teamStore = await import("../lib/team-store");
      const chatHistory = await import("../lib/chat-history");

      const owner = await teamStore.bootstrapOwner({
        workspaceName: "Hosted Stage 2 Recovery",
        email: "owner@example.com",
        password: "Password123!",
        displayName: "Owner"
      });
      const channel = await chatHistory.createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: "Hosted Recovery Channel",
        username: "hosted_recovery_channel"
      });
      const chat = await chatHistory.createOrGetChatByUrl(
        "https://www.youtube.com/shorts/hosted-stage2-recovery-check",
        channel.id
      );
      const run = store.createStage2Run({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        chatId: chat.id,
        request: {
          sourceUrl: "https://example.com/hosted-recovery",
          userInstruction: "hosted recover me",
          mode: "manual",
          channel: {
            id: channel.id,
            name: channel.name,
            username: channel.username,
            stage2WorkerProfileId: channel.stage2WorkerProfileId,
            stage2ExamplesConfig: channel.stage2ExamplesConfig,
            stage2HardConstraints: channel.stage2HardConstraints
          }
        }
      });

      store.markStage2RunStageRunning(run.runId, "oneShotReference", {
        detail: "Reference one-shot before hosted restart."
      });

      delete (globalThis as { __clipsStage2RuntimeState__?: unknown }).__clipsStage2RuntimeState__;
      runtime.scheduleStage2RunProcessing();

      const recovered = store.getStage2Run(run.runId);
      assert.equal(recovered?.status, "failed");
      assert.match(recovered?.errorMessage ?? "", /hosted runtime/i);
      assert.match(recovered?.snapshot.error ?? "", /hosted runtime/i);
    } finally {
      if (previousRender === undefined) {
        delete process.env.RENDER;
      } else {
        process.env.RENDER = previousRender;
      }
    }
  });
});

test("running source job is failed instead of re-queued after hosted runtime restart", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const previousRender = process.env.RENDER;
    process.env.RENDER = "true";
    try {
      const runtime = await import("../lib/source-job-runtime");
      const store = await import("../lib/source-job-store");
      const teamStore = await import("../lib/team-store");
      const chatHistory = await import("../lib/chat-history");

      const owner = await teamStore.bootstrapOwner({
        workspaceName: "Hosted Source Recovery",
        email: "owner@example.com",
        password: "Password123!",
        displayName: "Owner"
      });
      const channel = await chatHistory.createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: "Hosted Source Channel",
        username: "hosted_source_channel"
      });
      const chat = await chatHistory.createOrGetChatByUrl(
        "https://www.youtube.com/shorts/hosted-source-recovery-check",
        channel.id
      );
      const job = store.createSourceJob({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        request: {
          sourceUrl: chat.url,
          autoRunStage2: false,
          trigger: "fetch",
          chat: {
            id: chat.id,
            channelId: channel.id
          },
          channel: {
            id: channel.id,
            name: channel.name,
            username: channel.username
          }
        }
      });

      store.markSourceJobStageRunning(job.jobId, "comments", "Loading comments before hosted restart.");

      delete (globalThis as { __clipsSourceRuntimeState__?: unknown }).__clipsSourceRuntimeState__;
      runtime.scheduleSourceJobProcessing();

      const recovered = store.getSourceJob(job.jobId);
      assert.equal(recovered?.status, "failed");
      assert.match(recovered?.errorMessage ?? "", /hosted runtime/i);
      assert.match(recovered?.progress.error ?? "", /hosted runtime/i);
    } finally {
      if (previousRender === undefined) {
        delete process.env.RENDER;
      } else {
        process.env.RENDER = previousRender;
      }
    }
  });
});

test("chat trace export assembles a full payload, truncates comments, and honors the selected stage 2 run", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    const sourceStore = await import("../lib/source-job-store");
    const stage2Store = await import("../lib/stage2-progress-store");
    const { buildChatTraceExport } = await import("../lib/chat-trace-export");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Trace Export",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const workspaceConstraints: Stage2HardConstraints = {
      topLengthMin: 26,
      topLengthMax: 68,
      bottomLengthMin: 34,
      bottomLengthMax: 102,
      bannedWords: ["workspace"],
      bannedOpeners: ["Workspace"]
    };
    const channelConstraints: Stage2HardConstraints = {
      topLengthMin: 128,
      topLengthMax: 170,
      bottomLengthMin: 88,
      bottomLengthMax: 144,
      bannedWords: ["channel"],
      bannedOpeners: ["Channel"]
    };
    teamStore.updateWorkspaceStage2HardConstraints(owner.workspace.id, workspaceConstraints);
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Trace Channel",
      username: "trace_channel"
    });
    await chatHistory.updateChannelById(channel.id, {
      stage2HardConstraints: channelConstraints
    });
    const traceChannel = await chatHistory.getChannelById(channel.id);
    assert.ok(traceChannel);
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/watch?v=traceExport01",
      channel.id
    );

    await chatHistory.upsertChatDraft(chat.id, owner.user.id, {
      lastOpenStep: 3,
      stage2: {
        instruction: "Make it punchier.",
        selectedCaptionOption: 2,
        selectedTitleOption: 1
      },
      stage3: {
        topText: "Top overlay",
        bottomText: "Bottom overlay",
        captionHighlights: null,
        clipStartSec: 1.25,
        focusY: 0.42,
        renderPlan: null,
        agentPrompt: "Tighten the frame around the subject.",
        selectedVersionId: "version_7",
        passSelectionByVersion: { version_7: 1 }
      }
    });

    const comments = Array.from({ length: 20 }, (_, index) => ({
      id: `comment_${index + 1}`,
      author: `viewer_${index + 1}`,
      text: `Comment ${index + 1}`,
      likes: 20 - index,
      postedAt: null
    }));
    const commentsPayload = {
      title: "Trace Export Clip",
      totalComments: comments.length,
      topComments: comments,
      allComments: comments
    };

    const sourceJob = sourceStore.createSourceJob({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: {
        sourceUrl: chat.url,
        autoRunStage2: false,
        trigger: "fetch",
        chat: {
          id: chat.id,
          channelId: channel.id
        },
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username
        }
      }
    });
    sourceStore.markSourceJobStageRunning(sourceJob.jobId, "comments", "Loading comments.");
    sourceStore.finalizeSourceJobSuccess(sourceJob.jobId, {
      chatId: chat.id,
      channelId: channel.id,
      sourceUrl: chat.url,
      stage1Ready: true,
      title: "Trace Export Clip",
      commentsAvailable: true,
      commentsError: null,
      commentsPayload,
      commentsAcquisitionStatus: "fallback_success",
      commentsAcquisitionProvider: "ytDlp",
      commentsAcquisitionNote:
        "Основной YouTube-провайдер комментариев был недоступен, поэтому комментарии успешно получены через резервный путь yt-dlp.",
      autoStage2RunId: null
    });
    await chatHistory.appendChatEvent(chat.id, {
      role: "assistant",
      type: "comments",
      text: "Комментарии загружены.",
      data: commentsPayload
    });

    const traceStyleProfile = normalizeStage2StyleProfile({
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      onboardingCompletedAt: nowIso(),
      discoveryPromptVersion: "trace-test",
      referenceInfluenceSummary:
        "The bootstrap references point toward dry social reads with a controlled exploratory tail.",
      explorationShare: 0.25,
      referenceLinks: [],
      candidateDirections: [
        {
          id: "direction_1",
          fitBand: "core",
          name: "Dry social side-eye",
          description: "Reads the clip as a social reveal instead of a loud joke.",
          voice: "dry, observant",
          topPattern: "call out the reveal quickly",
          bottomPattern: "land the social read without overselling it",
          humorLevel: "low",
          sarcasmLevel: "medium",
          warmthLevel: "medium",
          insiderDensityLevel: "low",
          bestFor: "socially loaded reveal clips",
          avoids: "cartoon punchlines",
          microExample: "The lineup says more than the app ever does.",
          sourceReferenceIds: [],
          internalPromptNotes: "",
          axes: {
            humor: 0.35,
            sarcasm: 0.58,
            warmth: 0.44,
            insiderDensity: 0.3,
            intensity: 0.46,
            explanationDensity: 0.42,
            quoteDensity: 0.18,
            topCompression: 0.73
          }
        },
        {
          id: "direction_2",
          fitBand: "adjacent",
          name: "Earned social disbelief",
          description: "Lets the crowd reaction feel lived-in rather than meme-pasted.",
          voice: "human, clipped",
          topPattern: "surface the friction",
          bottomPattern: "translate it into a social consequence",
          humorLevel: "medium",
          sarcasmLevel: "low",
          warmthLevel: "medium",
          insiderDensityLevel: "low",
          bestFor: "comment-heavy social clips",
          avoids: "generic hype language",
          microExample: "You can feel exactly why the comments split.",
          sourceReferenceIds: [],
          internalPromptNotes: "",
          axes: {
            humor: 0.42,
            sarcasm: 0.28,
            warmth: 0.51,
            insiderDensity: 0.24,
            intensity: 0.49,
            explanationDensity: 0.46,
            quoteDensity: 0.19,
            topCompression: 0.67
          }
        }
      ],
      selectedDirectionIds: ["direction_1", "direction_2"]
    });
    const traceEditorialMemory = createEmptyStage2EditorialMemorySummary(traceStyleProfile);

    const baseDiagnostics = {
      channel: {
        id: channel.id,
        name: channel.name,
        username: channel.username,
        workerProfile: {
          requestedId: "stable_social_wave_v1",
          resolvedId: "stable_social_wave_v1",
          label: "Stable Social Wave v1",
          description: "Preserve public handles and comment-native wave.",
          summary: "Keep the social wave alive.",
          origin: "channel_setting"
        },
        examplesSource: "workspace_default",
        styleProfile: traceStyleProfile,
        editorialMemory: traceEditorialMemory,
        hardConstraints: channelConstraints,
        workspaceCorpusCount: 5,
        activeCorpusCount: 5
      },
      selection: {
        clipType: "general",
        rankedAngles: [
          { angle: "payoff_reveal", score: 9.4, why: "Strong reveal." },
          { angle: "shared_experience", score: 8.8, why: "Relatable frustration." },
          { angle: "competence_process", score: 7.9, why: "Mechanic logic." }
        ],
        rationale: "Lean into the design contrast and social irritation.",
        writerBrief: "Write it like fake progress versus useful design."
      },
      analysis: {
        visualAnchors: ["screen header", "stacked names", "reaction frame"],
        specificNouns: ["header", "lineup", "reaction"],
        visibleActions: ["names stack", "reaction lands"],
        firstSecondsSignal: "The header already frames the social tension.",
        sceneBeats: ["header appears", "names stack", "reaction lands"],
        revealMoment: "The stacked field turns the reveal into a social bloodbath.",
        lateClipChange: "The social meaning gets clearer as the lineup fills out.",
        whyViewerCares: "The reveal turns a simple lineup into a social read people instantly argue over.",
        bestBottomEnergy: "dry social side-eye",
        commentVibe: "design disbelief and social irritation",
        commentConsensusLane: "Consensus lane treats the reveal like a social bloodbath.",
        commentJokeLane: "Joke lane sharpens the lineup into a punchline.",
        commentDissentLane: "",
        commentSuspicionLane: "",
        commentLanguageCues: ["social bloodbath"],
        uncertaintyNotes: ["This fixture focuses on export truthfulness, not full scene coverage."],
        rawSummary: "A display-driven clip escalates as the lineup fills in and the social reaction becomes obvious."
      },
      sourceContext: {
        sourceUrl: chat.url,
        title: "Selected run clip",
        descriptionChars: 324,
        transcriptChars: 1402,
        frameCount: 6,
        runtimeCommentCount: 20,
        runtimeCommentIds: comments.map((comment) => comment.id),
        userInstructionChars: "selected instruction".length
      },
      examples: {
        source: "workspace_default",
        workspaceCorpusCount: 5,
        activeCorpusCount: 5,
        selectorCandidateCount: 1,
        retrievalConfidence: "medium",
        examplesMode: "form_guided",
        explanation: "Examples are structurally useful but not strong domain-near guides for this clip family.",
        evidence: ["0/1 top examples are domain-near", "1/1 remains structurally useful"],
        retrievalWarning: "Examples are being used mainly for form guidance.",
        examplesRoleSummary: "Examples help with structure more than semantics.",
        primaryDriverSummary: "Clip truth and channel learning carry more weight than retrieval.",
        primaryDrivers: [
          "actual clip truth",
          "bootstrap channel style directions",
          "rolling editorial memory",
          "retrieval examples as form guidance"
        ],
        channelStylePriority: "elevated",
        editorialMemoryPriority: "elevated",
        availableExamples: [
          {
            id: "example_available",
            sourceChannelId: "workspace-default",
            sourceChannelName: "Workspace default",
            title: "Available example",
            overlayTop: "Available top",
            overlayBottom: "Available bottom",
            clipType: "general",
            whyItWorks: ["clear trigger"],
            retrievalReasons: ["same trigger structure"],
            qualityScore: 0.91,
            retrievalScore: 0.86,
            guidanceRole: "form_guidance",
            sampleKind: "workspace_default"
          }
        ],
        selectedExamples: [
          {
            id: "example_available",
            sourceChannelId: "workspace-default",
            sourceChannelName: "Workspace default",
            title: "Selected example",
            overlayTop: "Selected top",
            overlayBottom: "Selected bottom",
            clipType: "general",
            whyItWorks: ["same social trigger"],
            retrievalReasons: ["good top/bottom split"],
            qualityScore: 0.98,
            retrievalScore: 0.94,
            guidanceRole: "form_guidance",
            sampleKind: "workspace_default"
          }
        ]
      },
      effectivePrompting: {
        promptStages: [
          {
            stageId: "analyzer",
            label: "Анализ",
            summary: "Reads frames, transcript, and comments.",
            configuredPrompt: "ANALYZER CONFIGURED PROMPT",
            promptText: "ANALYZER FULL PROMPT WITH CONTEXT",
            reasoningEffort: "medium",
            promptChars: 1180,
            usesImages: true,
            isCustomPrompt: false,
            inputManifest: {
              learningDetail: "minimal",
              description: {
                availableChars: 324,
                passedChars: 324,
                omittedChars: 0,
                truncated: false,
                limit: 1200
              },
              transcript: {
                availableChars: 1402,
                passedChars: 1402,
                omittedChars: 0,
                truncated: false,
                limit: 8000
              },
              frames: {
                availableCount: 6,
                passedCount: 6,
                omittedCount: 0,
                truncated: false,
                limit: 12
              },
              comments: {
                availableCount: 20,
                passedCount: 20,
                omittedCount: 0,
                truncated: false,
                limit: 20,
                passedCommentIds: comments.map((comment) => comment.id)
              },
              examples: null,
              channelLearning: {
                detail: "minimal",
                selectedDirectionCount: 2,
                highlightedDirectionIds: ["direction_1", "direction_2"],
                explorationShare: 0.25,
                recentFeedbackCount: 0,
                recentSelectionCount: 0,
                promptSummary: traceEditorialMemory.promptSummary
              },
              candidates: null,
              stageFlags: ["frames+comments aware", "comment digest included"]
            }
          },
          {
            stageId: "selector",
            label: "Выбор угла",
            summary: "Chooses angle and examples.",
            configuredPrompt: "SELECTOR CONFIGURED PROMPT",
            promptText: "SELECTOR FULL PROMPT WITH CONTEXT",
            reasoningEffort: "high",
            promptChars: 1234,
            usesImages: false,
            isCustomPrompt: true,
            inputManifest: {
              learningDetail: "compact",
              description: {
                availableChars: 324,
                passedChars: 324,
                omittedChars: 0,
                truncated: false,
                limit: 1200
              },
              transcript: {
                availableChars: 1402,
                passedChars: 1402,
                omittedChars: 0,
                truncated: false,
                limit: 6000
              },
              frames: {
                availableCount: 6,
                passedCount: 6,
                omittedCount: 0,
                truncated: false,
                limit: 8
              },
              comments: {
                availableCount: 20,
                passedCount: 12,
                omittedCount: 8,
                truncated: true,
                limit: 12,
                passedCommentIds: comments.slice(0, 12).map((comment) => comment.id)
              },
              examples: {
                availableCount: 1,
                passedCount: 1,
                omittedCount: 0,
                truncated: false,
                limit: null,
                activeCorpusCount: 5,
                promptPoolCount: 1,
                passedExampleIds: ["example_available"],
                selectedExampleIds: ["example_available"],
                rejectedExampleIds: [],
                retrievalConfidence: "medium",
                examplesMode: "form_guided",
                examplesRoleSummary: "Examples help with structure more than semantics.",
                primaryDriverSummary: "Clip truth and channel learning carry more weight than retrieval."
              },
              channelLearning: {
                detail: "compact",
                selectedDirectionCount: 2,
                highlightedDirectionIds: ["direction_1", "direction_2"],
                explorationShare: 0.25,
                recentFeedbackCount: 0,
                recentSelectionCount: 0,
                promptSummary: traceEditorialMemory.promptSummary
              },
              candidates: null,
              stageFlags: ["curated prompt pool", "retrieval-mode aware", "comment digest included"]
            }
          }
        ]
      }
    } as any;

    const traceExecution: NonNullable<
      NonNullable<NonNullable<Stage2Response["output"]>["pipeline"]>["execution"]
    > = {
      featureFlags: {
        STAGE2_VNEXT_ENABLED: false,
        source: "default_false",
        rawValue: null
      },
      pipelineVersion: "native_caption_v3",
      pathVariant: "modular_native_v1",
      stageChainVersion: "native_caption_v3@trace-fixture",
      workerBuild: {
        buildId: "trace-fixture-build",
        startedAt: nowIso(),
        pid: null
      },
      resolvedAt: nowIso(),
      legacyFallbackReason: null
    };

    const selectedRunBase = makeRuntimeStage2Response("selected_run", "selected");
    const selectedRunResponse: Stage2Response = {
      ...selectedRunBase,
      output: {
        ...selectedRunBase.output,
        pipeline: {
          execution: traceExecution
        } as any
      },
      source: {
        ...selectedRunBase.source,
        url: chat.url,
        title: "Selected run clip",
        totalComments: comments.length,
        topComments: comments,
        allComments: comments,
        commentsUsedForPrompt: 20,
        downloadProvider: "ytDlp",
        primaryProviderError: "Visolix: upstream вернул HTTP 502 (Bad gateway).",
        downloadFallbackUsed: true,
        commentsAcquisitionStatus: "fallback_success",
        commentsAcquisitionProvider: "ytDlp",
        commentsAcquisitionNote:
          "Основной YouTube-провайдер комментариев был недоступен, поэтому комментарии успешно получены через резервный путь yt-dlp.",
        commentsExtractionFallbackUsed: true
      },
      diagnostics: {
        ...baseDiagnostics,
        selection: {
          ...baseDiagnostics.selection,
          rationale: "Selected run rationale."
        }
      },
      stage2Run: {
        runId: "selected_run",
        mode: "manual",
        createdAt: nowIso(),
        startedAt: nowIso(),
        finishedAt: nowIso()
      }
    };

    const latestRunBase = makeRuntimeStage2Response("latest_run", "latest");
    const latestRunResponse: Stage2Response = {
      ...latestRunBase,
      output: {
        ...latestRunBase.output,
        pipeline: {
          execution: traceExecution
        } as any
      },
      source: {
        ...latestRunBase.source,
        url: chat.url,
        title: "Latest run clip",
        totalComments: comments.length,
        topComments: comments,
        allComments: comments,
        commentsUsedForPrompt: 20,
        downloadProvider: "visolix",
        primaryProviderError: null,
        downloadFallbackUsed: false,
        commentsAcquisitionStatus: "primary_success",
        commentsAcquisitionProvider: "youtubeDataApi",
        commentsAcquisitionNote: "Комментарии загружены через YouTube Data API.",
        commentsExtractionFallbackUsed: false
      },
      diagnostics: {
        ...baseDiagnostics,
        selection: {
          ...baseDiagnostics.selection,
          rationale: "Latest run rationale."
        },
        effectivePrompting: {
          promptStages: [
            {
              stageId: "writer",
              label: "Черновики",
              summary: "Drafts 20 options.",
              configuredPrompt: "WRITER CONFIGURED PROMPT",
              promptText: "WRITER FULL PROMPT WITH CONTEXT",
              reasoningEffort: "medium",
              promptChars: 2345,
              usesImages: true,
              isCustomPrompt: false
            }
          ]
        }
      },
      stage2Run: {
        runId: "latest_run",
        mode: "manual",
        createdAt: nowIso(),
        startedAt: nowIso(),
        finishedAt: nowIso()
      }
    };

    const selectedRun = stage2Store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: chat.url,
        userInstruction: "selected instruction",
        mode: "manual",
        channel: {
          id: traceChannel.id,
          name: traceChannel.name,
          username: traceChannel.username,
          stage2WorkerProfileId: "stable_social_wave_v1",
          stage2ExamplesConfig: traceChannel.stage2ExamplesConfig,
          stage2HardConstraints: traceChannel.stage2HardConstraints,
          stage2StyleProfile: traceStyleProfile,
          editorialMemory: traceEditorialMemory,
          editorialMemorySource: {
            strategy: "same_line_only",
            requestedWorkerProfileId: "stable_social_wave_v1",
            resolvedWorkerProfileId: "stable_social_wave_v1",
            sameLineExplicitCount: 2,
            fallbackExplicitCount: 0,
            sameLineSelectionCount: 1,
            fallbackSelectionCount: 0,
            supplementedWithFallback: false,
            explicitThreshold: 2
          }
        }
      }
    });
    stage2Store.setStage2RunResultData(selectedRun.runId, {
      ...selectedRunResponse,
      stage2Run: { ...selectedRunResponse.stage2Run, runId: selectedRun.runId }
    });
    stage2Store.finalizeStage2RunSuccess(selectedRun.runId);

    const latestRun = stage2Store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: chat.url,
        userInstruction: "latest instruction",
        mode: "manual",
        channel: {
          id: traceChannel.id,
          name: traceChannel.name,
          username: traceChannel.username,
          stage2WorkerProfileId: "stable_social_wave_v1",
          stage2ExamplesConfig: traceChannel.stage2ExamplesConfig,
          stage2HardConstraints: traceChannel.stage2HardConstraints,
          stage2StyleProfile: traceStyleProfile,
          editorialMemory: traceEditorialMemory,
          editorialMemorySource: {
            strategy: "same_line_only",
            requestedWorkerProfileId: "stable_social_wave_v1",
            resolvedWorkerProfileId: "stable_social_wave_v1",
            sameLineExplicitCount: 2,
            fallbackExplicitCount: 0,
            sameLineSelectionCount: 1,
            fallbackSelectionCount: 0,
            supplementedWithFallback: false,
            explicitThreshold: 2
          }
        }
      }
    });
    stage2Store.setStage2RunResultData(latestRun.runId, {
      ...latestRunResponse,
      stage2Run: { ...latestRunResponse.stage2Run, runId: latestRun.runId }
    });
    stage2Store.finalizeStage2RunSuccess(latestRun.runId);

    await chatHistory.appendChatEvent(chat.id, {
      role: "assistant",
      type: "stage2",
      text: "Stage 2 completed.",
      data: {
        ...latestRunResponse,
        stage2Run: { ...latestRunResponse.stage2Run, runId: latestRun.runId }
      }
    });
    await chatHistory.appendChatEvent(chat.id, {
      role: "assistant",
      type: "note",
      text: "Stage 3 export finished: trace.mp4 (title Trace Export, clip 0.0-6.0s, focus 42%)",
      data: {
        kind: "stage3-render-export",
        fileName: "trace.mp4",
        renderTitle: "Trace Export",
        clipStartSec: 0,
        clipEndSec: 6,
        focusY: 0.42,
        templateId: "science-card-v1",
        createdAt: nowIso()
      }
    });
    await chatHistory.appendChatEvent(chat.id, {
      role: "assistant",
      type: "note",
      text: "Stage 3 session running.",
      data: {
        kind: "stage3-agent-session",
        sessionId: "session_1",
        status: "running",
        finalVersionId: "version_7",
        bestVersionId: "version_5"
      }
    });

    const trace = await buildChatTraceExport({
      workspace: owner.workspace,
      userId: owner.user.id,
      chatId: chat.id,
      selectedRunId: selectedRun.runId
    });

    assert.ok(trace);
    assert.equal(trace?.version, "clip-trace-export-v3");
    assert.equal(trace?.comments.totalComments, 20);
    assert.equal(trace?.comments.includedCount, 15);
    assert.equal(trace?.comments.items.length, 15);
    assert.equal(trace?.comments.status, "fallback_success");
    assert.equal(trace?.comments.provider, "ytDlp");
    assert.equal(trace?.comments.fallbackUsed, true);
    assert.equal(trace?.comments.runtimeUsage.totalExtractedCount, 20);
    assert.equal(trace?.comments.runtimeUsage.runtimeAvailableCount, 20);
    assert.equal(trace?.comments.runtimeUsage.analyzer.passedCount, 20);
    assert.equal(trace?.comments.runtimeUsage.selector.passedCount, 12);
    assert.deepEqual(
      trace?.comments.runtimeUsage.selector.passedCommentIds,
      comments.slice(0, 12).map((comment) => comment.id)
    );
    assert.equal(trace?.comments.exportUsage.includedCount, 15);
    assert.equal(trace?.comments.exportUsage.omittedCount, 5);
    assert.equal(trace?.sourceJobs.length, 1);
    assert.equal(trace?.sourceJobs[0]?.request.trigger, "fetch");
    assert.equal(trace?.stage2.runs.length, 2);
    assert.equal(trace?.stage2.runs[0]?.request.channel.username, channel.username);
    assert.deepEqual(trace?.stage2.workspaceDefaults.hardConstraints, workspaceConstraints);
    assert.deepEqual(trace?.channel.stage2HardConstraints, channelConstraints);
    assert.equal(trace?.stage2.selectedRunId, selectedRun.runId);
    assert.equal(trace?.traceContract.canonicalSections.stage2CausalInputs, "stage2.causalInputs");
    assert.equal(trace?.traceContract.canonicalSections.stage2Execution, "stage2.execution");
    assert.equal(trace?.traceContract.canonicalSections.stage2VNext, "stage2.vnext");
    assert.match(trace?.traceContract.note ?? "", /canonical/i);
    assert.equal(trace?.stage2.causalInputs.run.mode, "manual");
    assert.equal(trace?.stage2.causalInputs.run.userInstruction, "selected instruction");
    assert.equal(trace?.stage2.causalInputs.channelSnapshotUsed.stage2WorkerProfileId, "stable_social_wave_v1");
    assert.equal(trace?.stage2.causalInputs.workerProfile.resolvedId, "stable_social_wave_v1");
    assert.equal(trace?.stage2.causalInputs.editorialMemorySource?.strategy, "same_line_only");
    assert.equal(
      trace?.stage2.causalInputs.editorialMemorySource?.resolvedWorkerProfileId,
      "stable_social_wave_v1"
    );
    assert.deepEqual(trace?.stage2.causalInputs.stylePrior.selectedDirectionIds, ["direction_1", "direction_2"]);
    assert.equal(trace?.stage2.causalInputs.stylePrior.selectedDirections.length, 2);
    assert.equal(trace?.stage2.causalInputs.editorialMemory?.recentFeedbackCount, 0);
    assert.equal(trace?.stage2.causalInputs.sourceContext.transcriptChars, 1402);
    assert.equal(trace?.stage2.causalInputs.sourceContext.runtimeCommentsAvailable, 20);
    assert.equal(trace?.stage2.causalInputs.sourceContext.commentsOmittedFromPrompt, 0);
    assert.ok(trace?.stage2.stageManifests.some((stage) => stage.stageId === "selector"));
    assert.equal(
      trace?.stage2.stageManifests.find((stage) => stage.stageId === "selector")?.inputManifest?.comments?.passedCount,
      12
    );
    assert.equal(
      trace?.stage2.stageManifests.find((stage) => stage.stageId === "selector")?.inputManifest?.examples?.promptPoolCount,
      1
    );
    assert.equal(trace?.stage2.outcome.retrievalConfidence, "medium");
    assert.equal(trace?.stage2.execution.exporterVersion, "clip-trace-export-v3");
    assert.equal(trace?.stage2.execution.pipelineVersion, "native_caption_v3");
    assert.equal(trace?.stage2.execution.pathVariant, "modular_native_v1");
    assert.equal(trace?.stage2.vnext.present, false);
    assert.equal(trace?.stage2.outcome.examplesMode, "form_guided");
    assert.equal(trace?.stage2.outcome.examplesRoleSummary, "Examples help with structure more than semantics.");
    assert.equal(trace?.stage2.outcome.primaryDriverSummary, "Clip truth and channel learning carry more weight than retrieval.");
    const expectedVisibleOptionMap =
      trace?.stage2.currentResult?.output.pipeline?.finalSelector?.candidateOptionMap ??
      trace?.stage2.currentResult?.output.captionOptions.map((option) => ({
        option: option.option,
        candidateId: option.candidateId ?? `option_${option.option}`
      })) ??
      [];
    assert.deepEqual(
      trace?.stage2.outcome.candidateOptionMap,
      expectedVisibleOptionMap
    );
    assert.deepEqual(
      trace?.stage2.outcome.visibleOptionToCandidateMap,
      expectedVisibleOptionMap
    );
    assert.equal(
      trace?.stage2.outcome.finalPickCandidateId,
      trace?.stage2.currentResult?.output.pipeline?.finalSelector?.finalPickCandidateId ?? null
    );
    assert.deepEqual(
      trace?.stage2.outcome.topSignalSummary,
      trace?.stage2.currentResult?.output.pipeline?.finalSelector?.shortlistStats?.topSignalSummary ?? null
    );
    assert.equal(trace?.stage2.currentResult?.output.finalPick.reason, "Final pick for selected");
    assert.equal(trace?.stage2.currentResult?.source.topComments.length, 15);
    assert.equal(trace?.stage2.currentResult?.source.allComments.length, 15);
    assert.equal(trace?.stage2.currentResult?.source.primaryProviderError, "Visolix: upstream вернул HTTP 502 (Bad gateway).");
    assert.equal(trace?.stage2.currentResult?.source.downloadFallbackUsed, true);
    assert.equal(trace?.source.primaryProviderError, "Visolix: upstream вернул HTTP 502 (Bad gateway).");
    assert.equal(trace?.source.downloadFallbackUsed, true);
    assert.equal(trace?.source.commentsAcquisitionStatus, "fallback_success");
    assert.equal(trace?.source.commentsAcquisitionProvider, "ytDlp");
    assert.equal(trace?.source.commentsFallbackUsed, true);
    assert.equal(trace?.stage2.examplesRuntimeUsage.activeCorpusCount, 5);
    assert.equal(trace?.stage2.examplesRuntimeUsage.selectorPromptPoolCount, 1);
    assert.deepEqual(trace?.stage2.examplesRuntimeUsage.promptPoolExampleIds, ["example_available"]);
    assert.deepEqual(trace?.stage2.examplesRuntimeUsage.selectedExampleIds, ["example_available"]);
    assert.deepEqual(trace?.stage2.examplesRuntimeUsage.rejectedExampleIds, []);
    assert.deepEqual(trace?.stage2.examplesRuntimeUsage.guidanceRoleBuckets.formGuidanceIds, ["example_available"]);
    assert.equal(trace?.stage2.exportOmissions.comments.exportLimit, 15);
    assert.ok(
      trace?.stage2.exportOmissions.comments.sections.some(
        (section) =>
          section.path === "stage2.currentResult.source.allComments" &&
          section.availableCount === 20 &&
          section.exportedCount === 15 &&
          section.omittedCount === 5
      )
    );
    assert.equal(trace?.stage2.analysis?.revealMoment, baseDiagnostics.analysis.revealMoment);
    assert.deepEqual(trace?.stage2.analysis?.sceneBeats, baseDiagnostics.analysis.sceneBeats);
    assert.equal(
      trace?.stage2.effectivePrompting?.promptStages[0]?.promptText,
      "ANALYZER FULL PROMPT WITH CONTEXT"
    );
    assert.equal(
      trace?.stage2.effectivePrompting?.promptStages[1]?.promptText,
      "SELECTOR FULL PROMPT WITH CONTEXT"
    );
    assert.equal(trace?.stage2.examples?.examplesMode, "form_guided");
    assert.equal(trace?.stage2.examples?.retrievalConfidence, "medium");
    assert.equal(trace?.stage2.examples?.selectedExamples.length, 1);
    assert.equal(trace?.stage3.handoff.selectedCaptionOption, 2);
    assert.equal(trace?.stage3.handoff.defaultCaptionOption, 1);
    assert.equal(trace?.stage3.handoff.topTextSource, "draft_override");
    assert.equal(trace?.stage3.latestRenderExport?.fileName, "trace.mp4");
    assert.equal(trace?.stage3.latestAgentSession?.sessionId, "session_1");
    assert.equal(trace?.draft?.stage2.selectedCaptionOption, 2);

    const exportedStage2Event = trace?.thread.events.find((event) => event.type === "stage2");
    assert.ok(exportedStage2Event);
    assert.equal(
      ((exportedStage2Event?.data as Stage2Response | null)?.source.topComments.length ?? 0),
      15
    );
  });
});

test("chat trace export keeps stable and experimental reference one-shot flows isolated", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    const sourceStore = await import("../lib/source-job-store");
    const stage2Store = await import("../lib/stage2-progress-store");
    const { buildChatTraceExport } = await import("../lib/chat-trace-export");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Reference Trace Isolation",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Reference Trace Channel",
      username: "reference_trace_channel"
    });
    const traceChannel = await chatHistory.getChannelById(channel.id);
    assert.ok(traceChannel);

    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/watch?v=traceReferenceIsolation",
      channel.id
    );
    const comments = Array.from({ length: 12 }, (_, index) => ({
      id: `comment_${index + 1}`,
      author: `viewer_${index + 1}`,
      text:
        index % 2 === 0
          ? "that pause said enough"
          : "everybody in that bay heard the bill",
      likes: 120 - index,
      postedAt: null
    }));
    const commentsPayload = {
      title: "Reference Trace Isolation",
      totalComments: comments.length,
      topComments: comments,
      allComments: comments
    };
    const sourceJob = sourceStore.createSourceJob({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: {
        sourceUrl: chat.url,
        autoRunStage2: false,
        trigger: "fetch",
        chat: {
          id: chat.id,
          channelId: channel.id
        },
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username
        }
      }
    });
    sourceStore.markSourceJobStageRunning(sourceJob.jobId, "comments", "Loading comments.");
    sourceStore.finalizeSourceJobSuccess(sourceJob.jobId, {
      chatId: chat.id,
      channelId: channel.id,
      sourceUrl: chat.url,
      stage1Ready: true,
      title: "Reference Trace Isolation",
      commentsAvailable: true,
      commentsError: null,
      commentsPayload,
      commentsAcquisitionStatus: "primary_success",
      commentsAcquisitionProvider: "youtubeDataApi",
      commentsAcquisitionNote: "Комментарии загружены через YouTube Data API.",
      autoStage2RunId: null
    });

    const stage2StyleProfile = normalizeStage2StyleProfile({
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      onboardingCompletedAt: nowIso(),
      discoveryPromptVersion: "trace-reference-isolation",
      referenceInfluenceSummary:
        "References favor dense reference rewrites with controlled social release.",
      explorationShare: 0.22,
      referenceLinks: [],
      candidateDirections: [
        {
          id: "direction_1",
          fitBand: "core",
          name: "Dense reference read",
          description: "Turns the source beat into a precise human paraphrase.",
          voice: "observational, compressed",
          topPattern: "state the why-care immediately",
          bottomPattern: "cash out the human cost without meta commentary",
          humorLevel: "low",
          sarcasmLevel: "low",
          warmthLevel: "medium",
          insiderDensityLevel: "low",
          bestFor: "reference-driven reveal clips",
          avoids: "meta narration about the edit or comment section",
          microExample: "The room gets the cost before he says it.",
          sourceReferenceIds: [],
          internalPromptNotes: "",
          axes: {
            humor: 0.24,
            sarcasm: 0.18,
            warmth: 0.43,
            insiderDensity: 0.19,
            intensity: 0.55,
            explanationDensity: 0.61,
            quoteDensity: 0.15,
            topCompression: 0.74
          }
        }
      ],
      selectedDirectionIds: ["direction_1"]
    });
    const editorialMemory = createEmptyStage2EditorialMemorySummary(stage2StyleProfile);
    const weakGroundingVideoContext = buildVideoContext({
      sourceUrl: chat.url,
      title: "A mechanic pauses before the whole room gets it",
      description: "",
      transcript: "",
      comments: comments.map((comment) => ({
        author: comment.author,
        likes: comment.likes,
        text: comment.text
      })),
      frameDescriptions: [
        "A mechanic freezes with the wrench still in his hand.",
        "Everyone nearby turns toward the pause instead of the part.",
        "The room reads the mistake before anyone speaks.",
        "The silence lands harder than the explanation."
      ],
      userInstruction: "Keep the output grounded and human."
    });

    const stableOneShotResponse = {
      analysis: {
        visual_anchors: [
          "the wrench stops mid-air",
          "everyone turns toward the pause",
          "the room gets the cost before he speaks"
        ],
        comment_vibe: "dry, impressed side-eye",
        key_phrase_to_adapt: "that pause said enough"
      },
      candidates: Array.from({ length: 5 }, (_, index) => ({
        candidate_id: `stable_ref_${index + 1}`,
        top:
          index === 0
            ? "That wrench stops mid-air because everybody in that bay reads the cost of the mistake before he gets the sentence out."
            : `The whole bay stops watching the part and starts reading his face the second that wrench freezes ${index + 1}.`,
        bottom:
          index === 0
            ? "That pause lands like the repair bill already reached every mechanic in the room."
            : `Nobody there needs a louder explanation after that pause, because the cost already hit the room ${index + 1}.`,
        retained_handle: index < 2,
        rationale: `Stable reference option ${index + 1}`
      })),
      winner_candidate_id: "stable_ref_1",
      titles: Array.from({ length: 5 }, (_, index) => ({
        title: `PAUSE SAID ENOUGH ${index + 1}`,
        title_ru: `ПАУЗА СКАЗАЛА ВСЁ ${index + 1}`
      }))
    };
    const experimentalOneShotResponse = {
      analysis: {
        visual_anchors: [
          "the wrench stops mid-air",
          "everyone turns toward the pause",
          "the room gets the cost before he speaks"
        ],
        comment_vibe: "dry, impressed side-eye",
        key_phrase_to_adapt: "that pause said enough"
      },
      candidates: Array.from({ length: 5 }, (_, index) => ({
        candidate_id: `experimental_ref_${index + 1}`,
        top:
          index === 0
            ? "The mistake lands before the explanation does, and the whole bay reads the bill in that frozen wrench before he says another word."
            : `The room stops tracking the repair and starts reading the price of it off his face the second that wrench hangs there ${index + 1}.`,
        bottom:
          index === 0
            ? "That silence turns a normal repair beat into the exact second everybody there realizes what this is going to cost."
            : `The pause does the whole job by itself, because everyone in that bay already knows what the next sentence would say ${index + 1}.`,
        retained_handle: index < 2,
        rationale: `Experimental reference option ${index + 1}`
      })),
      winner_candidate_id: "experimental_ref_1",
      titles: Array.from({ length: 5 }, (_, index) => ({
        title: `PAUSE SAID ENOUGH ${index + 1}`,
        title_ru: `ПАУЗА СКАЗАЛА ВСЁ ${index + 1}`
      }))
    };

    const stablePipeline = await runNativeCaptionPipelineDirectFixture({
      stage2WorkerProfileId: "stable_reference_v6",
      promptConfig: normalizeStage2PromptConfig({
        stages: {
          oneShotReference: {
            reasoningEffort: "high"
          }
        }
      }),
      hardConstraints: {
        ...RELAXED_NATIVE_HARD_CONSTRAINTS,
        topLengthMin: 110,
        topLengthMax: 210,
        bottomLengthMin: 70,
        bottomLengthMax: 160
      },
      videoContext: weakGroundingVideoContext,
      stage2StyleProfile,
      editorialMemory,
      responses: [stableOneShotResponse]
    });
    const experimentalPipeline = await runNativeCaptionPipelineDirectFixture({
      stage2WorkerProfileId: "stable_reference_v6_experimental",
      promptConfig: normalizeStage2PromptConfig({
        stages: {
          oneShotReference: {
            reasoningEffort: "high"
          }
        }
      }),
      hardConstraints: {
        ...RELAXED_NATIVE_HARD_CONSTRAINTS,
        topLengthMin: 110,
        topLengthMax: 210,
        bottomLengthMin: 70,
        bottomLengthMax: 160
      },
      videoContext: weakGroundingVideoContext,
      stage2StyleProfile,
      editorialMemory,
      responses: [experimentalOneShotResponse]
    });

    const stableRun = stage2Store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: chat.url,
        userInstruction: "Stable trace comparison run",
        mode: "manual",
        channel: {
          id: traceChannel.id,
          name: traceChannel.name,
          username: traceChannel.username,
          stage2WorkerProfileId: "stable_reference_v6",
          stage2ExamplesConfig: traceChannel.stage2ExamplesConfig,
          stage2HardConstraints: traceChannel.stage2HardConstraints,
          stage2StyleProfile,
          editorialMemory,
          editorialMemorySource: {
            strategy: "channel_fallback_only",
            requestedWorkerProfileId: "stable_reference_v6",
            resolvedWorkerProfileId: "stable_reference_v6",
            sameLineExplicitCount: 0,
            fallbackExplicitCount: 1,
            sameLineSelectionCount: 2,
            fallbackSelectionCount: 0,
            supplementedWithFallback: false,
            explicitThreshold: 6
          }
        }
      }
    });
    stage2Store.setStage2RunResultData(stableRun.runId, {
      ...stablePipeline.result,
      source: {
        url: chat.url,
        title: "Reference Trace Isolation",
        totalComments: comments.length,
        topComments: comments,
        allComments: comments,
        commentsUsedForPrompt: comments.length,
        downloadProvider: "ytDlp",
        primaryProviderError: null,
        downloadFallbackUsed: false,
        commentsAcquisitionStatus: "primary_success",
        commentsAcquisitionProvider: "youtubeDataApi",
        commentsAcquisitionNote: "Комментарии загружены через YouTube Data API.",
        commentsExtractionFallbackUsed: false
      },
      stage2Run: {
        runId: stableRun.runId,
        mode: "manual",
        createdAt: nowIso(),
        startedAt: nowIso(),
        finishedAt: nowIso()
      }
    });
    stage2Store.finalizeStage2RunSuccess(stableRun.runId);

    const experimentalRun = stage2Store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: chat.url,
        userInstruction: "Experimental trace comparison run",
        mode: "manual",
        channel: {
          id: traceChannel.id,
          name: traceChannel.name,
          username: traceChannel.username,
          stage2WorkerProfileId: "stable_reference_v6_experimental",
          stage2ExamplesConfig: traceChannel.stage2ExamplesConfig,
          stage2HardConstraints: traceChannel.stage2HardConstraints,
          stage2StyleProfile,
          editorialMemory,
          editorialMemorySource: {
            strategy: "same_line_only",
            requestedWorkerProfileId: "stable_reference_v6_experimental",
            resolvedWorkerProfileId: "stable_reference_v6_experimental",
            sameLineExplicitCount: 0,
            fallbackExplicitCount: 0,
            sameLineSelectionCount: 2,
            fallbackSelectionCount: 0,
            supplementedWithFallback: false,
            explicitThreshold: 3
          }
        }
      }
    });
    stage2Store.setStage2RunResultData(experimentalRun.runId, {
      ...experimentalPipeline.result,
      source: {
        url: chat.url,
        title: "Reference Trace Isolation",
        totalComments: comments.length,
        topComments: comments,
        allComments: comments,
        commentsUsedForPrompt: comments.length,
        downloadProvider: "ytDlp",
        primaryProviderError: null,
        downloadFallbackUsed: false,
        commentsAcquisitionStatus: "primary_success",
        commentsAcquisitionProvider: "youtubeDataApi",
        commentsAcquisitionNote: "Комментарии загружены через YouTube Data API.",
        commentsExtractionFallbackUsed: false
      },
      stage2Run: {
        runId: experimentalRun.runId,
        mode: "manual",
        createdAt: nowIso(),
        startedAt: nowIso(),
        finishedAt: nowIso()
      }
    });
    stage2Store.finalizeStage2RunSuccess(experimentalRun.runId);

    const stableTrace = await buildChatTraceExport({
      workspace: owner.workspace,
      userId: owner.user.id,
      chatId: chat.id,
      selectedRunId: stableRun.runId
    });
    const experimentalTrace = await buildChatTraceExport({
      workspace: owner.workspace,
      userId: owner.user.id,
      chatId: chat.id,
      selectedRunId: experimentalRun.runId
    });
    assert.ok(stableTrace);
    assert.ok(experimentalTrace);

    const stableOneShotManifest = stableTrace?.stage2.stageManifests.find(
      (stage) => stage.stageId === "oneShotReference"
    );
    const experimentalOneShotManifest = experimentalTrace?.stage2.stageManifests.find(
      (stage) => stage.stageId === "oneShotReference"
    );

    assert.equal(stableTrace?.stage2.execution.pathVariant, "reference_one_shot_v1");
    assert.equal(
      experimentalTrace?.stage2.execution.pathVariant,
      "reference_one_shot_v1_experimental"
    );
    assert.equal(stableTrace?.stage2.causalInputs.workerProfile.resolvedId, "stable_reference_v6");
    assert.equal(
      experimentalTrace?.stage2.causalInputs.workerProfile.resolvedId,
      "stable_reference_v6_experimental"
    );
    assert.equal(
      stableOneShotManifest?.promptCompatibilityVersion,
      "reference_one_shot_v1@2026-04-03"
    );
    assert.equal(
      experimentalOneShotManifest?.promptCompatibilityVersion,
      "reference_one_shot_v1_experimental@2026-04-12"
    );
    assert.equal(stableOneShotManifest?.inputManifest?.comments?.passedCount, 12);
    assert.equal(experimentalOneShotManifest?.inputManifest?.comments?.passedCount, 8);
    assert.equal(stableTrace?.stage2.causalInputs.editorialMemorySource?.strategy, "channel_fallback_only");
    assert.equal(experimentalTrace?.stage2.causalInputs.editorialMemorySource?.strategy, "same_line_only");
    assert.equal(stableTrace?.stage2.causalInputs.editorialMemorySource?.explicitThreshold, 6);
    assert.equal(experimentalTrace?.stage2.causalInputs.editorialMemorySource?.explicitThreshold, 3);
    assert.equal(stableTrace?.stage2.currentResult?.output.captionOptions.length, 5);
    assert.equal(experimentalTrace?.stage2.currentResult?.output.captionOptions.length, 5);
  });
});

test("chat trace export preserves canonical vnext proof markers for a deterministic proof run", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    const stage2Store = await import("../lib/stage2-progress-store");
    const { buildChatTraceExport } = await import("../lib/chat-trace-export");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Trace Export VNext Proof",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Proof Channel",
      username: "proof_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/watch?v=traceExportVnextProof",
      channel.id
    );

    const weakGenericExamples = Array.from({ length: 8 }, (_, index) =>
      makeExample({
        id: `proof_weak_${index + 1}`,
        ownerChannelId: "generic",
        ownerChannelName: "Generic",
        title: `Generic viral clip ${index + 1}`,
        overlayTop: `This thing gets wild fast ${index + 1}`,
        overlayBottom: `Everybody keeps replaying this one ${index + 1}`,
        clipType: "general",
        whyItWorks: [],
        qualityScore: 0.2
      })
    );
    const selectedExampleIds = weakGenericExamples.slice(0, 3).map((example) => example.id);
    const { result, videoContext } = await runSuccessfulPipeline({
      stage2VNextEnabled: true,
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: false,
        customExamples: weakGenericExamples
      },
      selectedExampleIds,
      selectorResponse: {
        selected_example_ids: selectedExampleIds
      }
    });
    const proofComments = videoContext.comments.map((comment, index) => ({
      id: comment.id ?? `proof_comment_${index + 1}`,
      author: comment.author,
      text: comment.text,
      likes: comment.likes,
      postedAt: comment.postedAt ?? null
    }));

    const run = stage2Store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: chat.url,
        userInstruction: videoContext.userInstruction ?? null,
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints
        }
      }
    });
    const stage2Response: Stage2Response = {
      source: {
        url: chat.url,
        title: videoContext.title,
        totalComments: proofComments.length,
        topComments: proofComments,
        allComments: proofComments,
        commentsUsedForPrompt: proofComments.length,
        frameDescriptions: videoContext.frameDescriptions
      },
      output: result.output,
      warnings: result.warnings,
      diagnostics: result.diagnostics,
      tokenUsage: result.tokenUsage,
      userInstructionUsed: videoContext.userInstruction,
      stage2Run: {
        runId: run.runId,
        mode: "manual",
        createdAt: nowIso(),
        startedAt: nowIso(),
        finishedAt: nowIso()
      },
      stage2Worker: {
        runId: run.runId,
        buildId: result.output.pipeline.execution?.workerBuild.buildId,
        startedAt: result.output.pipeline.execution?.workerBuild.startedAt,
        pid: result.output.pipeline.execution?.workerBuild.pid,
        pipelineVersion: result.output.pipeline.execution?.pipelineVersion,
        stageChainVersion: result.output.pipeline.execution?.stageChainVersion,
        featureFlags: result.output.pipeline.execution?.featureFlags
      }
    };
    stage2Store.setStage2RunResultData(run.runId, stage2Response);
    stage2Store.finalizeStage2RunSuccess(run.runId);

    const trace = await buildChatTraceExport({
      workspace: owner.workspace,
      userId: owner.user.id,
      chatId: chat.id,
      selectedRunId: run.runId
    });

    assert.ok(trace);
    assert.equal(trace?.version, "clip-trace-export-v3");
    assert.equal(trace?.stage2.execution.featureFlags?.STAGE2_VNEXT_ENABLED, true);
    assert.equal(trace?.stage2.execution.pipelineVersion, "vnext");
    assert.equal(trace?.stage2.execution.stageChainVersion, "stage2-vnext");
    assert.equal(trace?.stage2.vnext.present, true);
    assert.ok(trace?.stage2.vnext.stageOutputs?.clipTruthExtractor);
    assert.ok(trace?.stage2.vnext.stageOutputs?.audienceMiner);
    assert.equal(trace?.stage2.vnext.traceMeta?.compatibilityMode, "none");
    assert.equal(trace?.stage2.vnext.exampleRouting?.mode, "disabled");
    assert.equal(trace?.stage2.currentResult?.output.pipeline?.selectedExamplesCount, 0);
    assert.equal(trace?.stage2.vnext.canonicalCounters?.examplesPassedDownstream, 0);
    assert.equal(trace?.stage2.vnext.criticGate?.reserveBackfillCount, 0);
    assert.equal(trace?.stage2.vnext.validation?.ok, true);
    assert.equal(trace?.traceContract.canonicalSections.stage2VNext, "stage2.vnext");
    assert.equal(trace?.traceContract.canonicalSections.stage2VNextStageOutputs, "stage2.vnext.stageOutputs");
    assert.equal(
      trace?.traceContract.canonicalSections.stage2VNextCanonicalCounters,
      "stage2.vnext.canonicalCounters"
    );
    assert.equal(trace?.stage2.consistencyChecks.every((check) => check.ok), true);
  });
});

test("chat trace export surfaces consistency check failures when vnext counters contradict runtime output", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    const stage2Store = await import("../lib/stage2-progress-store");
    const { buildChatTraceExport } = await import("../lib/chat-trace-export");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Trace Export Consistency",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Consistency Channel",
      username: "consistency_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/watch?v=traceExportConsistency",
      channel.id
    );

    const proofBase = makeRuntimeStage2Response("consistency_run", "consistency");
    const stage2Response: Stage2Response = {
      ...proofBase,
      output: {
        ...proofBase.output,
        pipeline: {
          channelId: channel.id,
          mode: "codex_pipeline",
          execution: {
            featureFlags: {
              STAGE2_VNEXT_ENABLED: true,
              source: "override",
              rawValue: null
            },
            pipelineVersion: "vnext",
            stageChainVersion: "stage2-vnext",
            workerBuild: {
              buildId: "consistency-build",
              startedAt: nowIso(),
              pid: 777
            },
            resolvedAt: nowIso(),
            legacyFallbackReason: null
          },
          selectorOutput: {
            selectedExampleIds: [],
            rejectedExampleIds: ["example_1"]
          },
          availableExamplesCount: 4,
          selectedExamplesCount: 2,
          finalSelector: {
            candidateOptionMap: Array.from({ length: 5 }, (_, index) => ({
              option: index + 1,
              candidateId: `cand_${index + 1}`
            })),
            shortlistCandidateIds: Array.from({ length: 5 }, (_, index) => `cand_${index + 1}`),
            finalPickCandidateId: "cand_1",
            rationaleRaw: "consistency fixture"
          },
          vnext: {
            phase: 1,
            exampleRouting: {
              mode: "disabled",
              confidence: 0.2,
              selectedExampleIds: [],
              blockedExampleIds: ["example_1"],
              reasons: ["weak retrieval"]
            },
            criticGate: {
              evaluatedCandidateIds: ["cand_1", "cand_2"],
              criticKeptCandidateIds: ["cand_1"],
              criticRejectedCandidateIds: ["cand_2"],
              rewriteCandidateIds: ["cand_1"],
              validatedShortlistPoolIds: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
              visibleShortlistCandidateIds: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
              invalidDroppedCandidateIds: [],
              reserveBackfillCount: 0
            },
            canonicalCounters: {
              sourceCommentsAvailable: 0,
              sourceCommentsPassedToAudienceMiner: 0,
              sourceCommentsPassedToTruthExtractor: 0,
              examplesRetrieved: 1,
              examplesPassedDownstream: 1,
              semanticDraftsGenerated: 5,
              packedCandidatesGenerated: 5,
              packedCandidatesValid: 5,
              hardRejectedCount: 1,
              survivorCount: 1,
              visibleShortlistCount: 5,
              winnerCount: 1
            },
            candidateLineage: [],
            trace: {
              meta: {
                version: "stage2-vnext-trace-v3",
                generatedAt: nowIso(),
                featureFlag: "STAGE2_VNEXT_ENABLED",
                featureFlags: {
                  STAGE2_VNEXT_ENABLED: true,
                  source: "override",
                  rawValue: null
                },
                pipelineVersion: "vnext",
                stageChainVersion: "stage2-vnext",
                workerBuild: {
                  buildId: "consistency-build",
                  startedAt: nowIso(),
                  pid: 777
                },
                compatibilityMode: "none",
                implementedStages: [
                  "clip_truth_extractor",
                  "audience_miner",
                  "example_router",
                  "semantic_draft_generator",
                  "constraint_packer",
                  "quality_court",
                  "ranked_final_selector",
                  "title_and_seo"
                ]
              },
              inputs: {
                source: {
                  sourceId: "source_consistency",
                  sourceUrl: chat.url,
                  title: "Consistency Clip",
                  description: "",
                  transcript: null,
                  durationSec: null,
                  frames: [],
                  comments: [],
                  metadata: {
                    provider: "test",
                    downloadedAt: nowIso(),
                    totalComments: 0
                  }
                },
                channel: {
                  channelId: channel.id,
                  name: channel.name,
                  username: channel.username,
                  hardConstraints: channel.stage2HardConstraints,
                  userInstruction: null
                }
              },
              stageOutputs: {
                clipTruthExtractor: {
                  observedFacts: ["consistency fact"],
                  visibleAnchors: ["anchor"],
                  visibleActions: ["action"],
                  sceneBeats: ["beat"],
                  revealMoment: "reveal",
                  lateClipChange: "aftermath",
                  pauseSafeTopFacts: ["anchor"],
                  inferredReads: ["read"],
                  uncertaintyNotes: [],
                  claimGuardrails: ["stay clip-grounded"],
                  firstSecondsSignal: "opening signal",
                  whyViewerCares: "viewer cares"
                },
                audienceMiner: {
                  sentimentSummary: "curious",
                  consensusLane: "consensus",
                  jokeLane: "jokes",
                  dissentLane: "",
                  suspicionLane: "",
                  shorthandPressure: "medium",
                  allowedCues: ["Miles"],
                  bannedCues: ["not confirmed"],
                  normalizedSlang: [
                    {
                      raw: "Miles",
                      safeNativeEquivalent: "Miles",
                      keepRawAllowed: true
                    }
                  ],
                  moderationFindings: []
                },
                exampleRouter: {
                  decision: {
                    mode: "disabled",
                    confidence: 0.2,
                    selectedExampleIds: [],
                    blockedExampleIds: ["example_1"],
                    reasons: ["weak retrieval"]
                  },
                  retrievedExamples: [],
                  passedExamples: [],
                  blockedExamples: []
                },
                strategySearch: null,
                semanticDraftGenerator: {
                  drafts: []
                },
                constraintPacker: {
                  packedCandidates: []
                },
                qualityCourt: {
                  judgeCards: []
                },
                rankedFinalSelector: {
                  visibleCandidateIds: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
                  winnerCandidateId: "cand_1",
                  rankingMatches: [],
                  rationale: "fixture"
                },
                titleAndSeo: {
                  titles: [],
                  seo: null
                },
                exampleUsage: [
                  {
                    stageId: "semantic_draft_generator",
                    exampleMode: "disabled",
                    passedExampleIds: ["example_1"]
                  }
                ]
              },
              candidateLineage: [],
              criticGate: {
                evaluatedCandidateIds: ["cand_1", "cand_2"],
                criticKeptCandidateIds: ["cand_1"],
                criticRejectedCandidateIds: ["cand_2"],
                rewriteCandidateIds: ["cand_1"],
                validatedShortlistPoolIds: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
                visibleShortlistCandidateIds: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
                invalidDroppedCandidateIds: [],
                reserveBackfillCount: 0
              },
              canonicalCounters: {
                sourceCommentsAvailable: 0,
                sourceCommentsPassedToAudienceMiner: 0,
                sourceCommentsPassedToTruthExtractor: 0,
                examplesRetrieved: 1,
                examplesPassedDownstream: 1,
                semanticDraftsGenerated: 5,
                packedCandidatesGenerated: 5,
                packedCandidatesValid: 5,
                hardRejectedCount: 1,
                survivorCount: 1,
                visibleShortlistCount: 5,
                winnerCount: 1
              },
              validation: {
                validatorsRun: ["traceValidator"],
                issues: []
              },
              selection: {
                visibleCandidateIds: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
                winnerCandidateId: "cand_1",
                rankingMatches: [],
                rationale: "fixture"
              },
              memory: {
                status: "disabled",
                reason: "fixture"
              },
              cost: {
                totalPromptChars: 0,
                totalEstimatedInputTokens: 0,
                totalEstimatedOutputTokens: 0
              }
            },
            validation: {
              ok: false,
              issues: ["Disabled example mode still passed examples to a downstream stage."]
            }
          }
        }
      },
      stage2Run: {
        runId: "consistency_run",
        mode: "manual",
        createdAt: nowIso()
      }
    };
    const run = stage2Store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: chat.url,
        userInstruction: "consistency",
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints
        }
      }
    });
    stage2Store.setStage2RunResultData(run.runId, {
      ...stage2Response,
      stage2Run: {
        ...stage2Response.stage2Run,
        runId: run.runId
      }
    });
    stage2Store.finalizeStage2RunSuccess(run.runId);

    const trace = await buildChatTraceExport({
      workspace: owner.workspace,
      userId: owner.user.id,
      chatId: chat.id,
      selectedRunId: run.runId
    });

    assert.ok(trace);
    assert.equal(
      trace?.stage2.consistencyChecks.find((check) => check.id === "selected_examples_count_alignment")?.ok,
      false
    );
    assert.equal(
      trace?.stage2.consistencyChecks.find((check) => check.id === "vnext_disabled_examples")?.ok,
      false
    );
  });
});

test("chat trace export remains valid when the chat has no comments, no stage 2 result, and no stage 3 state", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    const { buildChatTraceExport } = await import("../lib/chat-trace-export");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Trace Export Empty",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Empty Channel",
      username: "empty_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/watch?v=traceExport02",
      channel.id
    );

    const trace = await buildChatTraceExport({
      workspace: owner.workspace,
      userId: owner.user.id,
      chatId: chat.id
    });

    assert.ok(trace);
    assert.equal(trace?.traceContract.canonicalSections.stage2Outcome, "stage2.outcome");
    assert.equal(trace?.traceContract.canonicalSections.stage2Execution, "stage2.execution");
    assert.equal(trace?.comments.available, false);
    assert.equal(trace?.comments.runtimeUsage.totalExtractedCount, 0);
    assert.equal(trace?.comments.exportUsage.includedCount, 0);
    assert.equal(trace?.stage3.handoff.stage2Available, false);
    assert.equal(trace?.stage3.handoff.topTextSource, "empty");
    assert.equal(trace?.comments.items.length, 0);
    assert.equal(trace?.sourceJobs.length, 0);
    assert.equal(trace?.stage2.runs.length, 0);
    assert.equal(trace?.stage2.selectedRunId, null);
    assert.equal(trace?.stage2.stageManifests.length, 0);
    assert.equal(trace?.stage2.outcome.finalPickCandidateId, null);
    assert.equal(trace?.stage2.examplesRuntimeUsage.activeCorpusCount, 0);
    assert.equal(trace?.stage2.vnext.present, false);
    assert.equal(trace?.stage2.currentResult, null);
    assert.equal(trace?.stage3.draft, null);
    assert.equal(trace?.stage3.latestRenderExport, null);
    assert.equal(trace?.stage3.latestAgentSession, null);
  });
});

test("history list upsert keeps stable meaningful-update order instead of moving an opened item to the top", () => {
  const base = [
    {
      id: "chat_1",
      channelId: "channel",
      url: "https://example.com/1",
      title: "First",
      updatedAt: "2026-03-21T12:00:00.000Z",
      status: "stage2Ready" as const,
      maxStep: 3 as const,
      preferredStep: 3 as const,
      hasDraft: false,
      exportTitle: null,
      liveAction: null
    },
    {
      id: "chat_2",
      channelId: "channel",
      url: "https://example.com/2",
      title: "Second",
      updatedAt: "2026-03-21T11:00:00.000Z",
      status: "sourceReady" as const,
      maxStep: 2 as const,
      preferredStep: 2 as const,
      hasDraft: false,
      exportTitle: null,
      liveAction: null
    }
  ];

  const updated = upsertHistoryItemByMeaningfulUpdate(base, {
    ...base[1],
    preferredStep: 1
  });

  assert.deepEqual(updated.map((item) => item.id), ["chat_1", "chat_2"]);
  assert.equal(updated[1]?.preferredStep, 1);
});

test("history sections separate current recent working and archive without duplicating the active item", () => {
  const items = [
    {
      id: "current_chat",
      channelId: "channel",
      url: "https://example.com/current",
      title: "Current clip",
      updatedAt: "2026-03-21T12:10:00.000Z",
      status: "editing" as const,
      maxStep: 3 as const,
      preferredStep: 3 as const,
      hasDraft: true,
      exportTitle: null,
      liveAction: null
    },
    {
      id: "recent_chat",
      channelId: "channel",
      url: "https://example.com/recent",
      title: "Recent clip",
      updatedAt: "2026-03-21T12:05:00.000Z",
      status: "sourceReady" as const,
      maxStep: 2 as const,
      preferredStep: 2 as const,
      hasDraft: false,
      exportTitle: null,
      liveAction: null
    },
    {
      id: "working_chat",
      channelId: "channel",
      url: "https://example.com/working",
      title: "Working clip",
      updatedAt: "2026-03-21T11:55:00.000Z",
      status: "stage2Ready" as const,
      maxStep: 3 as const,
      preferredStep: 2 as const,
      hasDraft: false,
      exportTitle: null,
      liveAction: "Stage 2" as const
    },
    {
      id: "archive_chat",
      channelId: "channel",
      url: "https://example.com/archive",
      title: "Archive clip",
      updatedAt: "2026-03-21T11:40:00.000Z",
      status: "exported" as const,
      maxStep: 3 as const,
      preferredStep: 3 as const,
      hasDraft: false,
      exportTitle: "Archive title",
      liveAction: null
    }
  ];

  const sections = buildHistorySections({
    allItems: items,
    visibleItems: items,
    activeHistoryId: "current_chat",
    recentHistoryIds: ["current_chat", "recent_chat", "archive_chat"],
    filter: "all"
  });

  assert.deepEqual(
    sections.map((section) => ({
      title: section.title,
      ids: section.items.map((item) => item.id)
    })),
    [
      { title: "Открыт сейчас", ids: ["current_chat"] },
      { title: "Недавно открывали", ids: ["recent_chat", "archive_chat"] },
      { title: "В работе", ids: ["working_chat"] }
    ]
  );
});

test("history filters keep archive and working distinctions explicit in the new panel logic", () => {
  const workingItem = {
    id: "working_chat",
    channelId: "channel",
    url: "https://example.com/working",
    title: "Working clip",
    updatedAt: "2026-03-21T11:55:00.000Z",
    status: "stage2Ready" as const,
    maxStep: 3 as const,
    preferredStep: 2 as const,
    hasDraft: false,
    exportTitle: null,
    liveAction: null
  };
  const archiveItem = {
    id: "archive_chat",
    channelId: "channel",
    url: "https://example.com/archive",
    title: "Archive clip",
    updatedAt: "2026-03-21T11:40:00.000Z",
    status: "exported" as const,
    maxStep: 3 as const,
    preferredStep: 3 as const,
    hasDraft: false,
    exportTitle: "Archive title",
    liveAction: null
  };

  assert.equal(matchesHistoryFilter(workingItem, "working"), true);
  assert.equal(matchesHistoryFilter(workingItem, "archive"), false);
  assert.equal(matchesHistoryFilter(archiveItem, "archive"), true);
  assert.equal(matchesHistoryFilter(archiveItem, "error"), false);
});

test("history progress badge makes step 2 state explicit without relying on source-host noise", () => {
  const stage2RunningItem = {
    id: "running_chat",
    channelId: "channel",
    url: "https://www.youtube.com/watch?v=running",
    title: "Running clip",
    updatedAt: "2026-03-21T11:55:00.000Z",
    status: "sourceReady" as const,
    maxStep: 2 as const,
    preferredStep: 2 as const,
    hasDraft: false,
    exportTitle: null,
    liveAction: "Stage 2" as const
  };
  const readyItem = {
    id: "ready_chat",
    channelId: "channel",
    url: "https://www.youtube.com/watch?v=ready",
    title: "Ready clip",
    updatedAt: "2026-03-21T11:40:00.000Z",
    status: "editing" as const,
    maxStep: 3 as const,
    preferredStep: 2 as const,
    hasDraft: true,
    exportTitle: null,
    liveAction: null
  };

  assert.deepEqual(getHistoryProgressBadge(stage2RunningItem), {
    label: "Шаг 2: в процессе",
    tone: "running"
  });
  assert.deepEqual(getHistoryProgressBadge(readyItem), {
    label: "Опции готовы",
    tone: "ready"
  });
});

test("app shell renders a compact current-chat header action", () => {
  const shellProps: AppShellProps = {
    title: "Автоматизация клипов",
    subtitle: "Subtitle",
    steps: [
      { id: 1, label: "Шаг 1", enabled: true },
      { id: 2, label: "Шаг 2", enabled: true },
      { id: 3, label: "Шаг 3", enabled: true }
    ],
    currentStep: 1,
    onStepChange: () => undefined,
    historyItems: [],
    activeHistoryId: null,
    onHistoryOpen: () => undefined,
    onDeleteHistory: () => undefined,
    onCreateNew: () => undefined,
    channels: [],
    activeChannelId: null,
    onSelectChannel: () => undefined,
    onManageChannels: () => undefined,
    canManageChannels: false,
    canManageTeam: false,
    onOpenTeam: () => undefined,
    codexConnected: false,
    codexBusyConnect: false,
    codexBusyRefresh: false,
    canManageCodex: false,
    canConnectCodex: false,
    codexConnectBlockedReason: null,
    codexStatusLabel: "Disconnected",
    codexActionLabel: "Connect",
    codexDeviceAuth: null,
    codexSecondaryActionLabel: null,
    onConnectCodex: () => undefined,
    onRefreshCodex: () => undefined,
    currentUserName: "Owner",
    currentUserRole: "owner",
    workspaceName: "Workspace",
    onLogout: () => undefined,
    statusText: "",
    statusTone: "",
    toasts: [],
    onDismissToast: () => undefined,
    headerActions: React.createElement(
      "button",
      { type: "button", className: "btn btn-ghost" },
      "Скачать историю"
    ),
    details: React.createElement("div", null),
    children: React.createElement("div", null, "Body")
  };
  const html = renderToStaticMarkup(
    React.createElement(AppShell, shellProps)
  );

  assert.match(html, /Еще/);
  assert.doesNotMatch(html, /Скачать историю/);
});

test("header overflow action wrapper closes on bubble click so nested actions can run first", () => {
  const callOrder: string[] = [];
  const wrapperProps = getOverflowActionWrapperProps(() => {
    callOrder.push("close");
  });

  callOrder.push("nested-action");
  wrapperProps.onClick?.({} as React.MouseEvent<HTMLDivElement>);

  assert.deepEqual(callOrder, ["nested-action", "close"]);
  assert.equal("onClickCapture" in wrapperProps, false);
});

test("app shell renders app-level toasts in a dedicated top-left viewport", () => {
  const shellProps: React.ComponentProps<typeof AppShell> = {
    title: "Автоматизация клипов",
    subtitle: "Subtitle",
    steps: [
      { id: 1, label: "Шаг 1", enabled: true },
      { id: 2, label: "Шаг 2", enabled: true },
      { id: 3, label: "Шаг 3", enabled: true }
    ],
    currentStep: 1,
    onStepChange: () => undefined,
    historyItems: [],
    activeHistoryId: null,
    onHistoryOpen: () => undefined,
    onDeleteHistory: () => undefined,
    onCreateNew: () => undefined,
    channels: [],
    activeChannelId: null,
    onSelectChannel: () => undefined,
    onManageChannels: () => undefined,
    canManageChannels: false,
    canManageTeam: false,
    onOpenTeam: () => undefined,
    codexConnected: false,
    codexBusyConnect: false,
    codexBusyRefresh: false,
    canManageCodex: false,
    canConnectCodex: false,
    codexConnectBlockedReason: null,
    codexStatusLabel: "Disconnected",
    codexActionLabel: "Connect",
    codexDeviceAuth: null,
    codexSecondaryActionLabel: null,
    onConnectCodex: () => undefined,
    onRefreshCodex: () => undefined,
    currentUserName: "Owner",
    currentUserRole: "owner",
    workspaceName: "Workspace",
    onLogout: () => undefined,
    statusText: "",
    statusTone: "",
    toasts: [
      {
        id: "next-chat-shortcut",
        tone: "neutral",
        title: "Следующий ролик",
        message: "Источник уже получен.",
        variant: "shortcut",
        actionLabel: "Создать новый чат",
        onAction: () => undefined,
        durationMs: 5000
      }
    ],
    onDismissToast: () => undefined,
    details: React.createElement("div", null),
    children: React.createElement("div", null, "Body")
  };
  const html = renderToStaticMarkup(
    React.createElement(AppShell, shellProps)
  );

  assert.match(html, /app-toast-stack/);
  assert.match(html, /Следующий ролик/);
  assert.match(html, /Создать новый чат/);
  assert.match(html, /app-toast-timer/);
  assert.match(html, /--toast-duration:5000ms/);
});

test("app shell labels the account exit action explicitly", () => {
  assert.equal(getWorkspaceLogoutLabel(), "Выйти из приложения");
});

test("step 3 render template defaults to the finalization surface with stage 2 mix actions", () => {
  const html = renderToStaticMarkup(
    React.createElement(Step3RenderTemplate, makeStep3RenderTemplateProps())
  );

  assert.ok(html.indexOf("Финализация") < html.indexOf("Финальный текст"));
  assert.match(html, /Открыть редактор/);
  assert.doesNotMatch(html, /details class="details-drawer stage3-caption-editor-drawer"/);
  assert.match(html, /Финальный текст/);
  assert.match(html, /Сбросить к выбранному варианту/);
  assert.match(html, /Взять всё/);
  assert.match(html, /Взять TOP/);
  assert.match(html, /Взять BOTTOM/);
  assert.match(html, /Используется текущий live draft без сохраненной версии/);
});

test("step 3 background UI reflects the actual resolved background mode", () => {
  const customHtml = renderToStaticMarkup(
    React.createElement(
      Step3RenderTemplate,
      makeStep3RenderTemplateProps({
        templateId: HEDGES_OF_HONOR_TEMPLATE_ID,
        previewVideoUrl: "https://example.com/source.mp4",
        backgroundAssetUrl: "https://example.com/custom.mp4",
        backgroundAssetMimeType: "video/mp4"
      })
    )
  );
  const sourceBlurHtml = renderToStaticMarkup(
    React.createElement(
      Step3RenderTemplate,
      makeStep3RenderTemplateProps({
        templateId: HEDGES_OF_HONOR_TEMPLATE_ID,
        previewVideoUrl: "https://example.com/source.mp4",
        backgroundAssetUrl: null,
        backgroundAssetMimeType: null
      })
    )
  );
  const builtInHtml = renderToStaticMarkup(
    React.createElement(
      Step3RenderTemplate,
      makeStep3RenderTemplateProps({
        templateId: HEDGES_OF_HONOR_TEMPLATE_ID,
        previewVideoUrl: null,
        backgroundAssetUrl: null,
        backgroundAssetMimeType: null
      })
    )
  );

  assert.match(customHtml, /<span class="quick-edit-value">Custom<\/span>/);
  assert.match(sourceBlurHtml, /<span class="quick-edit-value">Blur source<\/span>/);
  assert.match(builtInHtml, /<span class="quick-edit-value">Template backdrop<\/span>/);
});

test("stage 3 preview dedupe is scoped to workspace and user so only owned previews are reused", async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Preview Dedupe A",
      email: "preview-owner-a@example.com",
      password: "Password123!",
      displayName: "Owner A"
    });
    const invite = await teamStore.createInvite({
      workspaceId: owner.workspace.id,
      email: "preview-editor@example.com",
      role: "redactor_limited",
      createdByUserId: owner.user.id
    });
    const sameWorkspaceOtherUser = await teamStore.acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Editor"
    });

    const previewBody = {
      sourceUrl: "https://www.youtube.com/shorts/abc123xyz00",
      clipStartSec: 0,
      renderPlan: {
        templateId: SCIENCE_CARD_TEMPLATE_ID,
        topFontScale: 1.1,
        bottomFontScale: 1.05
      }
    };

    const ownerKey = await buildStage3PreviewDedupeKey(previewBody, {
      workspaceId: owner.workspace.id,
      userId: owner.user.id
    });
    const ownerKeyRepeat = await buildStage3PreviewDedupeKey(previewBody, {
      workspaceId: owner.workspace.id,
      userId: owner.user.id
    });
    const otherUserKey = await buildStage3PreviewDedupeKey(previewBody, {
      workspaceId: owner.workspace.id,
      userId: sameWorkspaceOtherUser.user.id
    });
    const otherWorkspaceKey = await buildStage3PreviewDedupeKey(previewBody, {
      workspaceId: "workspace-b",
      userId: owner.user.id
    });

    assert.equal(ownerKey, ownerKeyRepeat);
    assert.notEqual(ownerKey, otherUserKey);
    assert.notEqual(ownerKey, otherWorkspaceKey);

    const ownerJob = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "preview",
      executionTarget: "host",
      payloadJson: JSON.stringify(previewBody),
      dedupeKey: ownerKey
    });
    const ownerRetry = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "preview",
      executionTarget: "host",
      payloadJson: JSON.stringify(previewBody),
      dedupeKey: ownerKeyRepeat
    });
    const otherUserJob = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: sameWorkspaceOtherUser.user.id,
      kind: "preview",
      executionTarget: "host",
      payloadJson: JSON.stringify(previewBody),
      dedupeKey: otherUserKey
    });

    assert.equal(ownerRetry.id, ownerJob.id);
    assert.notEqual(otherUserJob.id, ownerJob.id);
  });
});

test("formatCodexExecFailureMessage keeps both stderr and stdout diagnostics", () => {
  const message = formatCodexExecFailureMessage({
    stderr: "Warning: no last agent message; wrote empty content to /tmp/output.json",
    stdout:
      "ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits.",
    fallback: "Codex exec failed."
  });

  assert.equal(
    message,
    [
      "Warning: no last agent message; wrote empty content to /tmp/output.json",
      "ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits."
    ].join("\n")
  );
});

test("assertCodexProducedFinalMessage allows non-empty output", () => {
  assert.doesNotThrow(() => {
    assertCodexProducedFinalMessage({
      rawOutput: '  {"result":"ok"}  ',
      stdout: "",
      stderr: ""
    });
  });
});

test("assertCodexProducedFinalMessage surfaces CLI diagnostics when output is blank", () => {
  assert.throws(
    () => {
      assertCodexProducedFinalMessage({
        rawOutput: "   \n",
        stderr: "Warning: no last agent message; wrote empty content to /tmp/output.json",
        stdout: "ERROR: You've hit your usage limit. Try again tomorrow."
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /usage limit/i);
      assert.match(error.message, /no last agent message/i);
      return true;
    }
  );
});
