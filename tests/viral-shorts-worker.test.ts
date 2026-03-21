import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell, type AppShellProps } from "../app/components/AppShell";
import {
  CHANNEL_MANAGER_DEFAULT_SETTINGS_ID,
  canDeleteManagedChannel,
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
  markStage2ProgressStageCompleted,
  markStage2ProgressStageFailed,
  markStage2ProgressStageRunning,
  normalizeStage2ProgressSnapshot,
  normalizeStage2PromptConfig
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
  buildAnalyzerPrompt,
  buildCriticPrompt,
  buildFinalSelectorPrompt,
  buildPromptPacket,
  buildRewriterPrompt,
  buildWriterPrompt,
  resolveStage2PromptTemplate
} from "../lib/viral-shorts-worker/prompts";
import type { Stage2ExamplesAssessment } from "../lib/viral-shorts-worker/types";
import {
  buildAdaptiveFramePlan,
  buildStage2RuntimeVideoContext
} from "../lib/stage2-runner";
import { buildSelectorExamplePool } from "../lib/viral-shorts-worker/selector-example-pool";
import { resolveStage3BackgroundMode } from "../lib/stage3-background-mode";
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
    if (this.responses.length === 0) {
      throw new Error("No queued executor response.");
    }
    const next = this.responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next as T;
  }
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
        bottom: "\"Option one bottom\""
      },
      {
        option: 2,
        top: "Option two top",
        bottom: "\"Option two bottom\""
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
        bottom: "\"Option two bottom\""
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
    clipStartSec: 0,
    clipDurationSec: 6,
    sourceDurationSec: 15,
    focusY: 0.5,
    cameraMotion: "disabled" as const,
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
    onCameraMotionChange: () => undefined,
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
  analyzerResponse?: Record<string, unknown>;
  selectedExampleIds?: string[];
  userInstruction?: string | null;
  providerWrappedStageOutputs?: boolean;
  finalSelectorRationale?: string;
  selectorResponse?: Record<string, unknown>;
  criticResponse?: unknown;
  writerCandidates?: Array<Record<string, unknown>>;
  rewrittenCandidates?: Array<Record<string, unknown>>;
  rewriterResponse?: unknown;
  finalSelectorResponse?: Record<string, unknown>;
  titleResponse?: unknown;
  comments?: Array<{ author: string; likes: number; text: string }>;
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
  const executor = new QueueExecutor([
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
    options?.criticResponse ?? defaultCriticResponse,
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
  ]);
  const progressEvents: Array<{ stageId: string; state: string; detail: string | null | undefined }> = [];
  const videoContext = buildVideoContext({
    sourceUrl: "https://example.com/short",
    title: "Old pickup bucks through a muddy rut",
    description: "The axle starts twisting while the crowd sees the truck sink sideways.",
    transcript: "The driver tries one more time and the wheel almost folds under him.",
    comments:
      options?.comments ??
      [
        {
          author: "user1",
          likes: 12,
          text: "That axle was cooked before he even hit the rut."
        }
      ],
    frameDescriptions: ["mud splashes around the tire", "axle leans hard to the left"],
    userInstruction: options?.userInstruction ?? "Keep it grounded and avoid slang overload."
  });

  const result = await service.runPipeline({
    channel,
    workspaceStage2ExamplesCorpusJson:
      options?.workspaceStage2ExamplesCorpusJson ?? workspaceExamplesJson,
    videoContext,
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    promptConfig,
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
    activeExamplesPreview: {
      source: "channel_custom",
      corpus: [],
      workspaceCorpusCount: 12
    },
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

test("rewriter telemetry stays consistent with the critic-approved candidate pool", async () => {
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
    top: `Noisy rewrite ${index + 1}`,
    bottom: `"Noisy ${index + 1}" bottom`,
    top_ru: `ru noisy ${index + 1}`,
    bottom_ru: `ru noisy ${index + 1}`
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
  assert.equal(rewriterEvent?.detail, "1 finalists sent to rewrite, 1 usable rewrites applied.");
  assert.equal(
    result.output.pipeline.finalSelector?.rationaleInternalRaw,
    `Final selector evaluated ${visibleIds.length} shortlist candidates: ${visibleIds.join(", ")}. ` +
      `Final visible shortlist is ${visibleIds.join(", ")} with cand_2 as the final pick. ` +
      "Visible angles: shared_experience, payoff_reveal."
  );
  assert.ok(result.output.captionOptions.every((option) => option.candidateId !== "cand_1" || option.top !== "Noisy rewrite 1"));
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
      bottomText: "\"Picked bottom\""
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
      bottomText: "\"Current bottom\""
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
      bottomText: "\"Picked bottom\""
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
    audioMode: base.audioMode,
    sourceAudioEnabled: base.sourceAudioEnabled,
    smoothSlowMo: base.smoothSlowMo,
    mirrorEnabled: base.mirrorEnabled,
    cameraMotion: base.cameraMotion,
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
  assert.equal(hydrated.topFontScale, 0.99);
  assert.equal(hydrated.bottomFontScale, 1.05);
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
    audioMode: "source_only",
    sourceAudioEnabled: true,
    smoothSlowMo: false,
    mirrorEnabled: true,
    cameraMotion: "disabled",
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
  assert.match(writerPrompt, /stock continuations/i);
  assert.match(criticPrompt, /"candidateSetSignals":/);
  assert.match(criticPrompt, /"genericTailCandidateIds": \[/);
  assert.match(criticPrompt, /"repeatedBottomTailSignatures": \[/);
  assert.match(criticPrompt, /"examplesMode": "style_guided"/);
  assert.match(rewriterPrompt, /"candidateSetSignals":/);
  assert.match(rewriterPrompt, /"explorationMode": "exploratory"/);
  assert.match(finalSelectorPrompt, /"candidateSetSignals":/);
  assert.match(finalSelectorPrompt, /"styleDirectionIds": \[/);
  assert.match(finalSelectorPrompt, /"explorationMode": "exploratory"/);
});

test("buildPromptPacket keeps comments-aware slang and suspicion details in analyzer context", () => {
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

  assert.ok(packet.context.analyzerOutput.slangToAdapt.includes("god pack"));
  assert.ok(packet.context.analyzerOutput.slangToAdapt.includes("Scooby laugh"));
  assert.match(packet.context.analyzerOutput.hiddenDetail, /pre-opened|fake|resealed/i);
  assert.match(packet.prompts.selector, /god pack/i);
  assert.match(packet.prompts.selector, /Scooby laugh/i);
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

test("repairCandidateForHardConstraints pads short bottoms without injecting unrelated contamination tails", () => {
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

  assert.equal(repaired.valid, true);
  assert.equal(repaired.repaired, true);
  assert.ok(repaired.candidate.bottom.length >= 120);
  assert.doesNotMatch(repaired.candidate.bottom, /jeep|lost that exchange/i);
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

test("pipeline replaces repeated contaminated bottom tails when cleaner reserve candidates exist", async () => {
  const contaminatedTail = "Everybody in that jeep knows exactly who lost that exchange.";
  const writerCandidates = Array.from({ length: 8 }, (_, index) => ({
    candidate_id: `cand_${index + 1}`,
    angle: index < 3 ? "awe_scale" : index < 6 ? "shared_experience" : "warmth_reverence",
    top: `The nominee montage keeps adding heavier names until the whole category feels absurd ${index + 1}.`,
    bottom:
      index < 5
        ? `"This lineup is brutal." ${contaminatedTail}`
        : `"That category had no soft landing." The room feels it the second the winner stands up ${index + 1}.`,
    top_ru: `Монтаж номинантов становится все тяжелее и тяжелее, пока сама категория не выглядит абсурдной ${index + 1}.`,
    bottom_ru:
      index < 5
        ? `"Этот состав безумный." ${contaminatedTail}`
        : `"В этой категории не было легкой победы." Зал это считывает в ту же секунду ${index + 1}.`,
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

  const contaminatedCount = result.output.captionOptions.filter((option) =>
    option.bottom.includes(contaminatedTail)
  ).length;

  assert.ok(contaminatedCount <= 1);
  assertFinalShortlistContract(result);
});

test("pipeline diversifies duplicate stock tails even when reserve pool cannot supply cleaner replacements", async () => {
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

  const { result } = await runSuccessfulPipeline({
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
  });

  const uniqueBottomCount = new Set(
    result.output.captionOptions.map((option) => option.bottom)
  ).size;
  const uniqueTailCount = new Set(
    result.output.captionOptions.map((option) => option.bottom.split(/(?<=[.!?]["']?)\s+/).slice(-1)[0])
  ).size;

  assert.ok(uniqueBottomCount >= 4);
  assert.ok(uniqueTailCount >= 3);
  assertFinalShortlistContract(result);
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
  assert.ok(result.diagnostics.analysis.slangToAdapt?.includes("god pack"));
  assert.ok(result.diagnostics.analysis.slangToAdapt?.includes("Scooby laugh"));
  assert.match(result.diagnostics.analysis.hiddenDetail ?? "", /pre-opened|fake|resealed/i);
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
  assert.match(writerResolved.defaultPrompt, /Context Compression Rule/);
  assert.match(writerResolved.defaultPrompt, /Must explain why the viewer should care/);
  assert.match(writerResolved.defaultPrompt, /Quoted openers are optional/);
  assert.match(writerResolved.defaultPrompt, /stock continuations/i);
  assert.match(writerResolved.defaultPrompt, /Do not let the batch collapse into one repeated bottom rhythm/i);
  assert.doesNotMatch(writerResolved.defaultPrompt, /Must begin with one quoted sentence/);
  assert.match(resolveStage2PromptTemplate("critic", normalizeStage2PromptConfig({})).defaultPrompt, /Batch audit rules/);
  assert.match(resolveStage2PromptTemplate("critic", normalizeStage2PromptConfig({})).defaultPrompt, /polished-but-interchangeable bottoms/i);
  assert.match(writerResolved.defaultPrompt, /top_ru/);
  assert.match(writerResolved.defaultPrompt, /bottom_ru/);
  assert.match(rewriterResolved.defaultPrompt, /top_ru/);
  assert.match(rewriterResolved.defaultPrompt, /bottom_ru/);
  assert.match(rewriterResolved.defaultPrompt, /Never leave a tightening fragment or broken truncation behind/i);
  assert.match(resolveStage2PromptTemplate("finalSelector", normalizeStage2PromptConfig({})).defaultPrompt, /style_direction_ids/i);
  assert.match(resolveStage2PromptTemplate("finalSelector", normalizeStage2PromptConfig({})).defaultPrompt, /exploration_mode/i);
  assert.match(titlesResolved.defaultPrompt, /title_ru/);
  assert.match(titlesResolved.defaultPrompt, /real Russian/);
  assert.match(seoResolved.defaultPrompt, /Search terms and topics covered:/);
  assert.match(seoResolved.defaultPrompt, /Exactly 17 tags/);
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
      React.createElement(Stage2RunDiagnosticsPanels, { diagnostics })
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
  assert.ok(!/hot pool/i.test(html));
  assert.ok(!/stable \+ hot \+ anti/i.test(html));
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
  assert.match(html, /Не запускался/);
  assert.match(html, /Этот этап не запускался, потому что запуск завершился ошибкой на предыдущем шаге/);
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
  const channelConstraints: Stage2HardConstraints = {
    topLengthMin: 5,
    topLengthMax: 120,
    bottomLengthMin: 5,
    bottomLengthMax: 120,
    bannedWords: [],
    bannedOpeners: []
  };
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
      selectedExamples: []
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
      stage2HardConstraints: channelConstraints
    },
    userInstruction: "make it shorter and sneak in one dry joke"
  });
  const result = buildQuickRegenerateResult({
    runId: "run_quick_regen",
    createdAt: nowIso(),
    mode: "regenerate",
    baseRunId: "run_base_quick",
    baseResult: baseStage2,
    channel: {
      id: "channel_quick",
      name: "Quick Channel",
      username: "quick_channel",
      stage2HardConstraints: channelConstraints
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
  assert.match(promptText, /"retrievalContext":/);
  assert.match(promptText, /"analysisContext":/);
  assert.ok(
    result.diagnostics?.effectivePrompting.promptStages.some((stage) => stage.stageId === "regenerate")
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
      downloadAvailable: true,
      downloadBlockedReason: null,
      onDraftUrlChange: () => undefined,
      onPaste: () => undefined,
      onFetch: () => undefined,
      onDownloadSource: () => undefined
    })
  );

  assert.match(html, /Источник уже обрабатывается в фоне/);
  assert.doesNotMatch(html, /danger-text[^>]*>Для этого чата уже идёт получение источника\./);
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
      downloadAvailable: true,
      downloadBlockedReason: null,
      onDraftUrlChange: () => undefined,
      onPaste: () => undefined,
      onFetch: () => undefined,
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
      downloadAvailable: true,
      downloadBlockedReason: null,
      onDraftUrlChange: () => undefined,
      onPaste: () => undefined,
      onFetch: () => undefined,
      onDownloadSource: () => undefined
    })
  );

  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=qQhqClv6fNo"/);
  assert.match(html, /source-link-anchor/);
  assert.match(html, /iframe/);
  assert.match(html, /youtube\.com\/embed\/qQhqClv6fNo/);
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

    store.markStage2RunStageRunning(run.runId, "writer", {
      detail: "Writing shortlist."
    });
    store.markStage2RunStageFailed(run.runId, "writer", "writer timeout");

    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    const reloaded = store.getStage2Run(run.runId);
    assert.equal(reloaded?.status, "failed");
    assert.equal(reloaded?.errorMessage, "writer timeout");
    assert.equal(reloaded?.snapshot.activeStageId, "writer");
    assert.match(reloaded?.snapshot.error ?? "", /writer timeout/);
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
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints
        }
      }
    });

    store.markStage2RunStageRunning(run.runId, "writer", {
      detail: "Writing before restart."
    });

    delete (globalThis as { __clipsStage2RuntimeState__?: unknown }).__clipsStage2RuntimeState__;

    runtime.setStage2RunProcessorForTests(async (claimedRun) => {
      const recovered = store.getStage2Run(claimedRun.runId);
      assert.equal(recovered?.status, "running");
      assert.equal(
        recovered?.snapshot.steps.find((step) => step.id === "writer")?.state,
        "pending"
      );
      assert.match(
        recovered?.snapshot.steps.find((step) => step.id === "analyzer")?.detail ?? "",
        /Recovered after process restart/
      );
      observedRecoveredSnapshot = true;

      store.markStage2RunStageRunning(claimedRun.runId, "analyzer", {
        detail: "Recovered analyzer rerun."
      });
      await sleep(25);
      store.markStage2RunStageCompleted(claimedRun.runId, "analyzer", {
        detail: "Recovered analyzer done."
      });
      store.markStage2RunStageRunning(claimedRun.runId, "finalSelector", {
        detail: "Recovered shortlist."
      });
      await sleep(25);
      store.markStage2RunStageCompleted(claimedRun.runId, "finalSelector", {
        detail: "Recovered shortlist ready."
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

    const baseDiagnostics = {
      channel: {
        id: channel.id,
        name: channel.name,
        username: channel.username,
        examplesSource: "workspace_default"
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
            id: "example_selected",
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
            stageId: "selector",
            label: "Выбор угла",
            summary: "Chooses angle and examples.",
            configuredPrompt: "SELECTOR CONFIGURED PROMPT",
            promptText: "SELECTOR FULL PROMPT WITH CONTEXT",
            reasoningEffort: "high",
            promptChars: 1234,
            usesImages: false,
            isCustomPrompt: true
          }
        ]
      }
    } as any;

    const selectedRunBase = makeRuntimeStage2Response("selected_run", "selected");
    const selectedRunResponse: Stage2Response = {
      ...selectedRunBase,
      source: {
        ...selectedRunBase.source,
        url: chat.url,
        title: "Selected run clip",
        totalComments: comments.length,
        topComments: comments,
        allComments: comments,
        commentsUsedForPrompt: 15,
        downloadProvider: "ytDlp",
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
      source: {
        ...latestRunBase.source,
        url: chat.url,
        title: "Latest run clip",
        totalComments: comments.length,
        topComments: comments,
        allComments: comments,
        commentsUsedForPrompt: 15,
        downloadProvider: "visolix",
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
          stage2ExamplesConfig: traceChannel.stage2ExamplesConfig,
          stage2HardConstraints: traceChannel.stage2HardConstraints
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
          stage2ExamplesConfig: traceChannel.stage2ExamplesConfig,
          stage2HardConstraints: traceChannel.stage2HardConstraints
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
    assert.equal(trace?.comments.totalComments, 20);
    assert.equal(trace?.comments.includedCount, 15);
    assert.equal(trace?.comments.items.length, 15);
    assert.equal(trace?.comments.status, "fallback_success");
    assert.equal(trace?.comments.provider, "ytDlp");
    assert.equal(trace?.comments.fallbackUsed, true);
    assert.equal(trace?.sourceJobs.length, 1);
    assert.equal(trace?.sourceJobs[0]?.request.trigger, "fetch");
    assert.equal(trace?.stage2.runs.length, 2);
    assert.equal(trace?.stage2.runs[0]?.request.channel.username, channel.username);
    assert.deepEqual(trace?.stage2.workspaceDefaults.hardConstraints, workspaceConstraints);
    assert.deepEqual(trace?.channel.stage2HardConstraints, channelConstraints);
    assert.equal(trace?.stage2.selectedRunId, selectedRun.runId);
    assert.equal(trace?.stage2.currentResult?.output.finalPick.reason, "Final pick for selected");
    assert.equal(trace?.stage2.currentResult?.source.topComments.length, 15);
    assert.equal(trace?.stage2.currentResult?.source.allComments.length, 15);
    assert.equal(trace?.source.commentsAcquisitionStatus, "fallback_success");
    assert.equal(trace?.source.commentsAcquisitionProvider, "ytDlp");
    assert.equal(trace?.source.commentsFallbackUsed, true);
    assert.equal(trace?.stage2.analysis?.revealMoment, baseDiagnostics.analysis.revealMoment);
    assert.deepEqual(trace?.stage2.analysis?.sceneBeats, baseDiagnostics.analysis.sceneBeats);
    assert.equal(
      trace?.stage2.effectivePrompting?.promptStages[0]?.promptText,
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
    assert.equal(trace?.comments.available, false);
    assert.equal(trace?.stage3.handoff.stage2Available, false);
    assert.equal(trace?.stage3.handoff.topTextSource, "empty");
    assert.equal(trace?.comments.items.length, 0);
    assert.equal(trace?.sourceJobs.length, 0);
    assert.equal(trace?.stage2.runs.length, 0);
    assert.equal(trace?.stage2.currentResult, null);
    assert.equal(trace?.stage3.draft, null);
    assert.equal(trace?.stage3.latestRenderExport, null);
    assert.equal(trace?.stage3.latestAgentSession, null);
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

  assert.match(html, /Скачать историю/);
});

test("step 3 render template exposes final text editor and stage 2 mix actions", () => {
  const html = renderToStaticMarkup(
    React.createElement(Step3RenderTemplate, makeStep3RenderTemplateProps())
  );

  assert.ok(html.indexOf("Editing") < html.indexOf("Финальный текст"));
  assert.match(html, /details class="details-drawer stage3-caption-editor-drawer"/);
  assert.match(html, /Финальный текст/);
  assert.match(html, /Сбросить к выбранному варианту/);
  assert.match(html, /Взять всё/);
  assert.match(html, /Взять TOP/);
  assert.match(html, /Взять BOTTOM/);
  assert.match(html, /Используется manual draft/);
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
