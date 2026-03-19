import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "../app/components/AppShell";
import {
  CHANNEL_MANAGER_DEFAULT_SETTINGS_ID,
  listChannelManagerTargets
} from "../app/components/ChannelManager";
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
  createStage2ProgressSnapshot,
  markStage2ProgressStageCompleted,
  markStage2ProgressStageRunning,
  normalizeStage2ProgressSnapshot,
  normalizeStage2PromptConfig
} from "../lib/stage2-pipeline";
import {
  issueScopedRequestVersion,
  matchesScopedRequestVersion,
  pickPreferredStage2RunId
} from "../lib/stage2-run-client";
import {
  pickPreferredSourceJobId
} from "../lib/source-job-client";
import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  getBundledStage2ExamplesSeed,
  getBundledStage2ExamplesSeedJson,
  resolveStage2ExamplesCorpus,
  Stage2CorpusExample,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "../lib/stage2-channel-config";
import { prepareCommentsForPrompt, sortCommentsByPopularity } from "../lib/comments";
import { buildLimitedCommentsExtractorArgs } from "../lib/ytdlp";
import {
  buildPromptPacket,
  resolveStage2PromptTemplate
} from "../lib/viral-shorts-worker/prompts";
import { getTemplateFigmaSpec } from "../lib/stage3-template-spec";
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
  ViralShortsWorkerService
} from "../lib/viral-shorts-worker/service";
import type { JsonStageExecutor } from "../lib/viral-shorts-worker/executor";
import { normalizeChatDraft } from "../lib/chat-workflow";
import { fallbackRenderPlan, normalizeRenderPlan } from "../app/home-page-support";

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
    qualityScore: input.qualityScore ?? 0.9
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
    quote_first_bottom_compliance: Number((base - 0.05).toFixed(2)),
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

function makeStep3RenderTemplateProps(overrides?: Partial<React.ComponentProps<typeof Step3RenderTemplate>>) {
  return {
    sourceUrl: "https://example.com/source",
    templateId: "template-road",
    channelName: "Stone Face Turbo",
    channelUsername: "StoneFaceTurbo",
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
    isVisibleToCurrentUser: true
  };
}

async function runSuccessfulPipeline(options?: {
  promptConfig?: ReturnType<typeof normalizeStage2PromptConfig>;
  stage2ExamplesConfig?: Stage2ExamplesConfig;
  workspaceStage2ExamplesCorpusJson?: string;
  stage2HardConstraints?: Stage2HardConstraints;
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
      raw_summary: "An old pickup bucks through a muddy rut until the axle twists sideways."
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
      ? {
          titleOptions: Array.from({ length: 5 }, (_, index) => ({
            title_id: `title_${index + 1}`,
            title: `HOW AXLE FAILS ${index + 1}`,
            title_ru: `КАК ЛОМАЕТСЯ МОСТ ${index + 1}`,
            rationale: `Title ${index + 1} leans into the failure mystery.`
          }))
        }
      : Array.from({ length: 5 }, (_, index) => ({
          title_id: `title_${index + 1}`,
          title: `HOW AXLE FAILS ${index + 1}`,
          title_ru: `КАК ЛОМАЕТСЯ МОСТ ${index + 1}`,
          rationale: `Title ${index + 1} leans into the failure mystery.`
        }))
  ]);
  const progressEvents: Array<{ stageId: string; state: string; detail: string | null | undefined }> = [];
  const videoContext = buildVideoContext({
    sourceUrl: "https://example.com/short",
    title: "Old pickup bucks through a muddy rut",
    description: "The axle starts twisting while the crowd sees the truck sink sideways.",
    transcript: "The driver tries one more time and the wheel almost folds under him.",
    comments: [
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
      bottomQuoteRequired: false,
      bannedWords: ["literally"],
      bannedOpeners: ["Here is a"]
    };

    teamStore.updateWorkspaceStage2HardConstraints(owner.workspace.id, updatedConstraints);

    const saved = teamStore.getWorkspaceStage2HardConstraints(owner.workspace.id);
    assert.deepEqual(saved, updatedConstraints);
  });
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

test("channel manager adds a dedicated Default settings target only for owners", () => {
  const channels = [
    makeChannelForManager({ id: "alpha", name: "Alpha Channel", username: "alpha" }),
    makeChannelForManager({ id: "beta", name: "Beta Channel", username: "beta" })
  ];

  const ownerTargets = listChannelManagerTargets(channels, true);
  assert.equal(ownerTargets[0]?.id, CHANNEL_MANAGER_DEFAULT_SETTINGS_ID);
  assert.equal(ownerTargets[0]?.label, "Default settings");
  assert.equal(ownerTargets[0]?.kind, "workspace_defaults");
  assert.equal(ownerTargets[1]?.id, "alpha");

  const redactorTargets = listChannelManagerTargets(channels, false);
  assert.deepEqual(
    redactorTargets.map((item) => item.id),
    ["alpha", "beta"]
  );
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
      "quote_first_bottom_compliance",
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
  assert.equal(result.output.pipeline.mode, "codex_pipeline");
  assert.equal(result.output.pipeline.availableExamplesCount, 5);
  assert.equal(result.output.pipeline.selectedExamplesCount, 3);
  assert.ok(result.output.captionOptions.every((option) => option.candidateId));
  assert.ok(result.output.captionOptions.every((option) => option.angle));
  assert.ok(result.output.captionOptions.every((option) => option.constraintCheck?.passed));
  assert.equal(result.diagnostics.examples.activeCorpusCount, 5);
  assert.equal(result.diagnostics.examples.selectedExamples.length, 3);
  assert.deepEqual(
    result.diagnostics.examples.selectedExamples.map((example) => example.title),
    [
      "Truck axle snaps in the mud",
      "Driver keeps rolling after the first wobble",
      "Crowd reacts when the wheel folds"
    ]
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

  assert.match(result.output.finalPick.reason, /^option 2 is the strongest visible pick/i);
  assert.match(result.output.finalPick.reason, /lands the reaction with/i);
  assert.match(result.output.finalPick.reason, /The rest of the visible shortlist still gives real alternates:/);
  assert.doesNotMatch(result.output.finalPick.reason, /\bc0[78]\b/i);
  assert.doesNotMatch(result.output.finalPick.reason, /\bcand_7\b|\bcand_8\b/i);
  assert.equal(result.output.pipeline.finalSelector?.rationaleRaw, result.output.finalPick.reason);
  assert.equal(
    result.output.pipeline.finalSelector?.rationaleInternalRaw,
    "Final selector evaluated 8 candidates: cand_1, cand_2, cand_3, cand_4, cand_5, cand_6, cand_7, cand_8. Final visible shortlist is cand_1, cand_2, cand_3, cand_4, cand_5 with cand_2 as the final pick. Visible angles: payoff_reveal, shared_experience, competence_process."
  );
  assert.equal(
    result.output.pipeline.finalSelector?.rationaleInternalModelRaw,
    "c04 is strongest, but c07 and c08 still matter because they almost beat it on tension."
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
    bottomQuoteRequired: true,
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
});

test("constraint repair keeps complete sentences instead of chopped endings", async () => {
  const constraints: Stage2HardConstraints = {
    topLengthMin: 24,
    topLengthMax: 70,
    bottomLengthMin: 24,
    bottomLengthMax: 70,
    bottomQuoteRequired: true,
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
    bottomQuoteRequired: true,
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
  assert.ok(result.output.captionOptions.length >= 1);
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
    bottomQuoteRequired: false,
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
    ...Array.from({ length: 5 }, (_, index) => makeCandidate(`cand_${index + 4}`, "shared_experience", index + 4))
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

  assert.equal(criticEvent?.detail, "1 candidates kept for rewrite.");
  assert.equal(rewriterEvent?.detail, "1 finalists sent to rewrite, 1 usable rewrites applied.");
  assert.equal(result.output.pipeline.finalSelector?.rationaleInternalRaw?.includes("Final selector evaluated 1 candidate: cand_4."), true);
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
    "Final selector evaluated 5 candidates: cand_1, cand_2, cand_3, cand_4, cand_5. Final visible shortlist is cand_4, cand_1, cand_3, cand_5, cand_2 with cand_4 as the final pick. Visible angles: payoff_reveal, shared_experience, tension_danger."
  );
  assert.equal(
    result.output.pipeline.finalSelector?.rationaleInternalModelRaw,
    "Only one unique candidate appears in the provided pool, and c04 is publishable."
  );
  assert.match(result.output.finalPick.reason, /^option 1 is the strongest visible pick/i);
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
    templateId: "turbo-face-v1",
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
      templateId: "turbo-face-v1",
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
      authorName: "Stone Face Turbo",
      authorHandle: "@StoneFaceTurbo"
    },
    fallbackRenderPlan()
  );

  const hydrated = normalizeRenderPlan(persistedOverride, updatedChannelBase);
  assert.equal(hydrated.templateId, "science-card-v7");
  assert.equal(hydrated.authorName, "Stone Face Turbo");
  assert.equal(hydrated.authorHandle, "@StoneFaceTurbo");
  assert.equal(hydrated.videoZoom, 1.35);
  assert.equal(hydrated.topFontScale, 1.35);
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
        templateId: "turbo-face-v1",
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
      stakes: ["danger"],
      payoff: "payoff",
      coreTrigger: "trigger",
      humanStake: "stake",
      narrativeFrame: "frame",
      whyViewerCares: "care",
      bestBottomEnergy: "dry humor",
      commentVibe: "crowd reacts",
      slangToAdapt: ["cooked"],
      extractableSlang: ["cooked"],
      hiddenDetail: "detail",
      genericRisks: ["risk"],
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

test("default prompt templates expose the new analyzer and selector contracts", () => {
  const analyzerResolved = resolveStage2PromptTemplate("analyzer", normalizeStage2PromptConfig({}));
  const selectorResolved = resolveStage2PromptTemplate("selector", normalizeStage2PromptConfig({}));
  const writerResolved = resolveStage2PromptTemplate("writer", normalizeStage2PromptConfig({}));
  const rewriterResolved = resolveStage2PromptTemplate("rewriter", normalizeStage2PromptConfig({}));
  const titlesResolved = resolveStage2PromptTemplate("titles", normalizeStage2PromptConfig({}));
  const seoResolved = resolveStage2PromptTemplate("seo", normalizeStage2PromptConfig({}));

  assert.match(analyzerResolved.defaultPrompt, /specific_nouns/);
  assert.match(analyzerResolved.defaultPrompt, /visible_actions/);
  assert.match(analyzerResolved.defaultPrompt, /core_trigger/);
  assert.match(analyzerResolved.defaultPrompt, /best_bottom_energy/);
  assert.match(selectorResolved.defaultPrompt, /primary_angle/);
  assert.match(selectorResolved.defaultPrompt, /top_strategy/);
  assert.match(selectorResolved.defaultPrompt, /why_old_v6_would_work_here/);
  assert.match(selectorResolved.defaultPrompt, /failure_modes/);
  assert.match(writerResolved.defaultPrompt, /Context Compression Rule/);
  assert.match(writerResolved.defaultPrompt, /Must explain why the viewer should care/);
  assert.match(writerResolved.defaultPrompt, /top_ru/);
  assert.match(writerResolved.defaultPrompt, /bottom_ru/);
  assert.match(rewriterResolved.defaultPrompt, /top_ru/);
  assert.match(rewriterResolved.defaultPrompt, /bottom_ru/);
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
        runBlockedReason: null,
        isLaunching: false,
        isRunning: false,
        expectedDurationMs: 40_000,
        elapsedMs: 12_000,
        selectedOption: 2,
        selectedTitleOption: 1,
        onInstructionChange: () => undefined,
        onRunStage2: () => undefined,
        onSelectRun: () => undefined,
        onSelectOption: () => undefined,
        onSelectTitleOption: () => undefined,
        onCopy: () => undefined
      }),
      React.createElement(Stage2RunDiagnosticsPanels, { diagnostics })
    )
  );

  assert.match(html, /Как этот run реально устроен/);
  assert.match(html, /Active corpus \+ selector picks/);
  assert.match(html, /selector picked 3/);
  assert.match(html, /Target Channel/);
  assert.match(html, /Truck axle snaps in the mud/);
  assert.match(html, /Selector rationale/);
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
        runBlockedReason: null,
        isLaunching: false,
        isRunning: false,
        expectedDurationMs: 40_000,
        elapsedMs: 12_000,
        selectedOption: 1,
        selectedTitleOption: 1,
        onInstructionChange: () => undefined,
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
  assert.match(html, /Effective prompts/);
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
      runBlockedReason: "Для этого чата уже идёт Stage 2.",
      isLaunching: false,
      isRunning: false,
      expectedDurationMs: 40_000,
      elapsedMs: 12_000,
      selectedOption: null,
      selectedTitleOption: null,
      onInstructionChange: () => undefined,
      onRunStage2: () => undefined,
      onSelectRun: () => undefined,
      onSelectOption: () => undefined,
      onSelectTitleOption: () => undefined,
      onCopy: () => undefined
    })
  );

  assert.match(html, /Stage 2 уже выполняется в фоне/);
  assert.match(html, /Результат этого run еще не готов/);
  assert.doesNotMatch(html, /Результат второго этапа пуст\. Сначала запустите второй этап/);
  assert.doesNotMatch(html, /danger-text[^>]*>Для этого чата уже идёт Stage 2/);
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
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Trace Channel",
      username: "trace_channel"
    });
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
      examples: {
        source: "workspace_default",
        workspaceCorpusCount: 5,
        activeCorpusCount: 5,
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
        downloadProvider: "ytDlp"
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
        downloadProvider: "visolix"
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
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints
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
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints
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
    assert.equal(trace?.sourceJobs.length, 1);
    assert.equal(trace?.sourceJobs[0]?.request.trigger, "fetch");
    assert.equal(trace?.stage2.runs.length, 2);
    assert.equal(trace?.stage2.runs[0]?.request.channel.username, channel.username);
    assert.equal(trace?.stage2.selectedRunId, selectedRun.runId);
    assert.equal(trace?.stage2.currentResult?.output.finalPick.reason, "Final pick for selected");
    assert.equal(trace?.stage2.currentResult?.source.topComments.length, 15);
    assert.equal(trace?.stage2.currentResult?.source.allComments.length, 15);
    assert.equal(
      trace?.stage2.effectivePrompting?.promptStages[0]?.promptText,
      "SELECTOR FULL PROMPT WITH CONTEXT"
    );
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
  const html = renderToStaticMarkup(
    React.createElement(AppShell, {
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
    })
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
