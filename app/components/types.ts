import type { Stage2ProgressSnapshot, Stage2PromptConfig } from "../../lib/stage2-pipeline";
import type { Stage2ExamplesConfig, Stage2HardConstraints } from "../../lib/stage2-channel-config";
import type {
  ResolvedWorkspaceCodexModelConfig,
  WorkspaceCodexModelConfig
} from "../../lib/workspace-codex-models";
import type {
  ChannelEditorialFeedbackEvent,
  Stage2ExplorationMode,
  Stage2EditorialMemorySummary,
  Stage2StyleProfile
} from "../../lib/stage2-channel-learning";
import type {
  Stage2DebugMode,
  Stage2Diagnostics,
  Stage2TokenUsage
} from "../../lib/viral-shorts-worker/types";

export type CommentItem = {
  id: string;
  author: string;
  text: string;
  likes: number;
  postedAt: string | null;
};

export type CommentsPayload = {
  title: string;
  totalComments: number;
  topComments: CommentItem[];
  allComments: CommentItem[];
};

export type Stage2Output = {
  inputAnalysis: {
    visualAnchors: string[];
    commentVibe: string;
    keyPhraseToAdapt: string;
  };
  captionOptions: Array<{
    option: number;
    candidateId?: string;
    angle?: string;
    top: string;
    bottom: string;
    topRu?: string;
    bottomRu?: string;
    styleDirectionIds?: string[];
    explorationMode?: Stage2ExplorationMode;
    constraintCheck?: {
      passed: boolean;
      repaired: boolean;
      topLength: number;
      bottomLength: number;
      issues: string[];
    };
  }>;
  titleOptions: Array<{
    option: number;
    title: string;
    titleRu?: string;
  }>;
  finalPick: {
    option: number;
    reason: string;
  };
  pipeline?: {
    channelId: string;
    mode: "packet_only" | "codex_pipeline" | "regenerate";
    selectorOutput: unknown;
    availableExamplesCount: number;
    selectedExamplesCount: number;
    finalSelector?: {
      candidateOptionMap: Array<{
        option: number;
        candidateId: string;
      }>;
      shortlistCandidateIds: string[];
      finalPickCandidateId: string;
      rationaleRaw: string;
      rationaleInternalRaw?: string;
      rationaleInternalModelRaw?: string;
      shortlistStats?: {
        targetCount: number;
        requestedCount: number;
        validatedCount: number;
        visibleCount: number;
        repairedCount: number;
        droppedAfterValidationCount: number;
        topSignalSummary?: unknown;
      };
    };
  };
};

export type Stage2Response = {
  source: {
    url: string;
    title: string;
    totalComments: number;
    topComments: CommentItem[];
    allComments: CommentItem[];
    commentsUsedForPrompt: number;
    videoFileName?: string;
    videoSizeBytes?: number;
    downloadProvider?: "visolix" | "ytDlp";
    primaryProviderError?: string | null;
    downloadFallbackUsed?: boolean;
    commentsOmittedFromPrompt?: number;
    frameDescriptions?: string[];
    commentsExtractionFallbackUsed?: boolean;
    commentsAcquisitionStatus?: "primary_success" | "fallback_success" | "unavailable";
    commentsAcquisitionProvider?: "youtubeDataApi" | "ytDlp" | null;
    commentsAcquisitionNote?: string | null;
    commentsAcquisitionError?: string | null;
  };
  output: Stage2Output;
  seo?: {
    description: string;
    tags: string;
  } | null;
  warnings: Array<{ field: string; message: string }>;
  diagnostics?: Stage2Diagnostics;
  tokenUsage?: Stage2TokenUsage;
  debugMode?: Stage2DebugMode;
  debugRef?: {
    kind: "stage2-run-debug";
    ref: string;
  } | null;
  progress?: Stage2ProgressSnapshot | null;
  model?: string;
  reasoningEffort?: string;
  userInstructionUsed?: string | null;
  stage2Spec?: {
    name: string;
    outputSections: string[];
    topLengthRule: string;
    bottomLengthRule: string;
    enforcedVia: string;
  };
  stage2Worker?: {
    runId: string;
    profileId?: string;
    stateDir?: string;
  };
  stage2Run?: {
    runId: string;
    mode: "manual" | "auto" | "regenerate";
    baseRunId?: string | null;
    createdAt: string;
    startedAt?: string | null;
    finishedAt?: string | null;
  };
  channel?: {
    id: string;
    name: string;
    username: string;
  };
};

export type Stage2RunStatus = "queued" | "running" | "completed" | "failed";

export type Stage2RunSummary = {
  runId: string;
  chatId: string | null;
  channelId: string | null;
  sourceUrl: string;
  userInstruction: string | null;
  mode: "manual" | "auto" | "regenerate";
  baseRunId: string | null;
  status: Stage2RunStatus;
  progress: Stage2ProgressSnapshot;
  errorMessage: string | null;
  hasResult: boolean;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};

export type Stage2RunDetail = Stage2RunSummary & {
  result: Stage2Response | null;
};

export type ChannelFeedbackResponse = {
  historyEvents: ChannelEditorialFeedbackEvent[];
  editorialMemory: Stage2EditorialMemorySummary;
};

export type SourceJobStatus = "queued" | "running" | "completed" | "failed";

export type SourceJobStageId = "prepare" | "comments" | "stage2";

export type SourceJobProgressSnapshot = {
  status: SourceJobStatus;
  activeStageId: SourceJobStageId | null;
  detail: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type SourceJobResult = {
  chatId: string;
  channelId: string;
  sourceUrl: string;
  stage1Ready: boolean;
  title: string | null;
  commentsAvailable: boolean;
  commentsError: string | null;
  commentsPayload: CommentsPayload | null;
  commentsAcquisitionStatus?: "primary_success" | "fallback_success" | "unavailable";
  commentsAcquisitionProvider?: "youtubeDataApi" | "ytDlp" | null;
  commentsAcquisitionNote?: string | null;
  autoStage2RunId: string | null;
};

export type SourceJobSummary = {
  jobId: string;
  chatId: string;
  channelId: string;
  sourceUrl: string;
  status: SourceJobStatus;
  progress: SourceJobProgressSnapshot;
  errorMessage: string | null;
  hasResult: boolean;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};

export type SourceJobDetail = SourceJobSummary & {
  result: SourceJobResult | null;
};

export type Stage3AgentPass = {
  pass: number;
  label: string;
  summary: string;
  changes: string[];
  proposedOps?: Stage3Operation[];
  accepted?: boolean;
  scoreBefore?: number;
  scoreAfter?: number;
  delta?: number;
  rejectionReason?: string;
  topText: string;
  bottomText: string;
  topFontPx: number;
  bottomFontPx: number;
  topCompacted: boolean;
  bottomCompacted: boolean;
  clipStartSec: number;
  clipDurationSec: number;
  clipEndSec: number;
  focusY: number;
  renderPlan: Stage3RenderPlan;
};

export type Stage3PlannerSnapshotDigest = {
  sourceDurationSec: number | null;
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  textFit: {
    topCompacted: boolean;
    bottomCompacted: boolean;
    topFontPx: number;
    bottomFontPx: number;
    topOverflow: boolean;
    bottomOverflow: boolean;
  };
  renderPlan: {
    timingMode: Stage3TimingMode;
    audioMode: Stage3AudioMode;
    videoZoom: number;
    topFontScale: number;
    bottomFontScale: number;
    textPolicy: Stage3TextPolicy;
    smoothSlowMo: boolean;
    segmentCount: number;
    segments: Array<{
      startSec: number;
      endSec: number | null;
      speed: Stage3SegmentSpeed;
      label: string;
    }>;
  };
};

export type Stage3TimingMode = "auto" | "compress" | "stretch";

export type Stage3AudioMode = "source_only" | "source_plus_music";

export type Stage3RenderPolicy = "full_source_normalize" | "adaptive_window" | "fixed_segments";

export type Stage3TextPolicy = "strict_fit" | "preserve_words" | "aggressive_compact";

export const STAGE3_SEGMENT_SPEED_OPTIONS = [1, 1.5, 2, 2.5, 3, 4, 5] as const;

export type Stage3SegmentSpeed = (typeof STAGE3_SEGMENT_SPEED_OPTIONS)[number];

export type Stage3CameraMotion = "disabled" | "top_to_bottom" | "bottom_to_top";

export type Stage3CameraKeyframe = {
  id: string;
  timeSec: number;
  focusY: number;
  zoom: number;
};

export type Stage3PositionKeyframe = {
  id: string;
  timeSec: number;
  focusY: number;
};

export type Stage3ScaleKeyframe = {
  id: string;
  timeSec: number;
  zoom: number;
};

export type Stage3PreviewState = "idle" | "debouncing" | "loading" | "retrying" | "ready" | "error";

export type Stage3RenderState = "idle" | "queued" | "rendering" | "ready" | "error";

export type Stage3EditorDraftOverrides = {
  clipStartSec: number;
  focusY: number;
  videoZoom: number;
  cameraKeyframes: Stage3CameraKeyframe[];
  cameraPositionKeyframes: Stage3PositionKeyframe[];
  cameraScaleKeyframes: Stage3ScaleKeyframe[];
  segments: Stage3Segment[];
  timingMode: Stage3TimingMode;
  renderPolicy: Stage3RenderPolicy;
  normalizeToTargetEnabled: boolean;
  topFontScale: number;
  bottomFontScale: number;
  musicGain: number;
};

export type Stage3TextFitSnapshot = {
  topFontPx: number;
  bottomFontPx: number;
  topLineHeight?: number;
  bottomLineHeight?: number;
  topLines?: number;
  bottomLines?: number;
  topCompacted: boolean;
  bottomCompacted: boolean;
  snapshotHash?: string;
  fitHash?: string;
};

export type Stage3JobKind = "preview" | "render" | "editing-proxy" | "source-download" | "agent-media-step";

export type Stage3JobStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export type Stage3ExecutionTarget = "host" | "local";

export type Stage3WorkerPlatform = "darwin-arm64" | "darwin-x64" | "win32-x64" | "unknown";

export type Stage3WorkerStatus = "online" | "offline" | "busy";

export type Stage3JobArtifactKind = "video";

export type Stage3JobArtifact = {
  id: string;
  jobId: string;
  kind: Stage3JobArtifactKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string | null;
};

export type Stage3JobSummary = {
  id: string;
  kind: Stage3JobKind;
  status: Stage3JobStatus;
  executionTarget: Stage3ExecutionTarget;
  assignedWorkerId: string | null;
  workerLabel: string | null;
  leaseUntil: string | null;
  lastHeartbeatAt: string | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attempts: number;
  recoverable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  resultJson?: string | null;
  artifact: Stage3JobArtifact | null;
};

export type Stage3JobEnvelope = {
  job: Stage3JobSummary;
};

export type Stage3WorkerSummary = {
  id: string;
  label: string;
  platform: Stage3WorkerPlatform;
  hostname: string | null;
  appVersion: string | null;
  status: Stage3WorkerStatus;
  lastSeenAt: string | null;
  currentJobId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Stage3WorkerListResponse = {
  workers: Stage3WorkerSummary[];
};

export type Stage3WorkerPairingResponse = {
  pairingToken: string;
  expiresAt: string;
  serverOrigin: string;
  suggestedLabel: string;
  commands: {
    shell: string;
    powershell: string;
    direct: string;
    localDev?: string;
  };
};

export type {
  TemplateCalibrationArtifacts,
  TemplateCalibrationBundle,
  TemplateCalibrationSession,
  TemplateCalibrationStatus,
  TemplateCompareMode,
  TemplateCompareScope,
  TemplateContentFixture,
  TemplateDiffReport,
  TemplateOverlayBlendMode
} from "../../lib/template-calibration-types";

export type Stage3Segment = {
  startSec: number;
  endSec: number | null;
  label: string;
  speed: Stage3SegmentSpeed;
  focusY?: number | null;
  videoZoom?: number | null;
  mirrorEnabled?: boolean | null;
};

export type Stage3Operation =
  | { op: "set_segments"; segments: Stage3Segment[] }
  | { op: "append_segment"; segment: Stage3Segment }
  | { op: "clear_segments" }
  | { op: "set_timing_mode"; timingMode: Stage3TimingMode }
  | { op: "set_audio_mode"; audioMode: Stage3AudioMode }
  | { op: "set_slowmo"; smoothSlowMo: boolean }
  | { op: "set_clip_start"; clipStartSec: number }
  | { op: "set_focus_y"; focusY: number }
  | { op: "set_video_zoom"; videoZoom: number }
  | { op: "set_top_font_scale"; topFontScale: number }
  | { op: "set_bottom_font_scale"; bottomFontScale: number }
  | { op: "set_music_gain"; musicGain: number }
  | { op: "set_text_policy"; textPolicy: Stage3TextPolicy }
  | { op: "rewrite_top_text"; topText: string }
  | { op: "rewrite_bottom_text"; bottomText: string };

export type Stage3RenderPlan = {
  targetDurationSec: 6;
  timingMode: Stage3TimingMode;
  normalizeToTargetEnabled: boolean;
  audioMode: Stage3AudioMode;
  sourceAudioEnabled: boolean;
  smoothSlowMo: boolean;
  mirrorEnabled: boolean;
  cameraMotion: Stage3CameraMotion;
  cameraKeyframes: Stage3CameraKeyframe[];
  cameraPositionKeyframes: Stage3PositionKeyframe[];
  cameraScaleKeyframes: Stage3ScaleKeyframe[];
  videoZoom: number;
  topFontScale: number;
  bottomFontScale: number;
  musicGain: number;
  textPolicy: Stage3TextPolicy;
  segments: Stage3Segment[];
  policy: Stage3RenderPolicy;
  backgroundAssetId: string | null;
  backgroundAssetMimeType: string | null;
  musicAssetId: string | null;
  musicAssetMimeType: string | null;
  avatarAssetId: string | null;
  avatarAssetMimeType: string | null;
  authorName: string;
  authorHandle: string;
  templateId: string;
  prompt: string;
};

export type Stage3StateSnapshot = {
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  renderPlan: Stage3RenderPlan;
  sourceDurationSec: number | null;
  templateSnapshot?: {
    templateId: string;
    specRevision: string;
    snapshotHash: string;
    fitRevision: string;
  };
  textFit: Stage3TextFitSnapshot;
};

export type Stage3Version = {
  versionNo: number;
  runId: string;
  createdAt: string;
  prompt: string;
  baseline: Stage3StateSnapshot;
  final: Stage3StateSnapshot;
  diff: {
    textChanged: boolean;
    framingChanged: boolean;
    timingChanged: boolean;
    segmentsChanged: boolean;
    audioChanged: boolean;
    summary: string[];
  };
  internalPasses: Stage3AgentPass[];
  recommendedPass: number;
  agentMeta?: {
    model: string;
    reasoningEffort: string;
    passesExecuted: number;
    acceptedPasses: number;
    stoppedBy: "quality_threshold" | "epsilon" | "max_pass" | "timeout" | "no_change";
  };
};

// Legacy `/api/stage3/optimize` compatibility shape.
export type Stage3OptimizeResponse = {
  optimization: {
    changed: boolean;
    version?: Stage3Version;
    noOpReason?: string;
    suggestions?: string[];
    intent?: {
      zoomRequested: boolean;
      zoomValue: number | null;
      actionOnly: boolean;
      segmentsRequested: number;
      timingMode: Stage3TimingMode | null;
      audioMode: Stage3AudioMode | null;
    };
    run?: Stage3OptimizationRun;
  };
};

export type Stage3SessionStatus = "running" | "completed" | "partiallyApplied" | "failed";

export type Stage3GoalType =
  | "focusOnly"
  | "crop"
  | "zoom"
  | "timing"
  | "fragments"
  | "color"
  | "stabilization"
  | "audio"
  | "text"
  | "unknown";

export type Stage3IterationStopReason =
  | "targetScoreReached"
  | "maxIterationsReached"
  | "minGainReached"
  | "safety"
  | "noProgress"
  | "plannerFailure"
  | "rollbackCreated"
  | "userStop";

export type Stage3IterationScores = {
  quality: number;
  goalFit: number;
  safety: number;
  stepGain: number;
  total: number;
};

export type Stage3IterationPlan = {
  rationale: string;
  strategy: "heuristic" | "llm" | "fallback";
  hypothesis: string;
  operations: Stage3Operation[];
  magnitudes: number[];
  expected?: Record<string, unknown>;
};

export type Stage3VersionRecord = {
  id: string;
  sessionId: string;
  parentVersionId: string | null;
  iterationIndex: number;
  source: "agent.auto" | "rollback";
  transformConfig: Stage3StateSnapshot;
  diffSummary: string[];
  rationale: string;
  createdAt: string;
};

export type Stage3IterationRecord = {
  id: string;
  sessionId: string;
  iterationIndex: number;
  beforeVersionId: string;
  afterVersionId: string;
  plan: Stage3IterationPlan;
  appliedOps: Stage3Operation[];
  scores: Stage3IterationScores;
  judgeNotes: string;
  stoppedReason: Stage3IterationStopReason | null;
  createdAt: string;
  timings: {
    planMs?: number;
    executeMs?: number;
    judgeMs?: number;
    totalMs?: number;
  };
};

export type Stage3MessageRole = "user" | "assistant_auto" | "assistant_summary";

export type Stage3MessageRecord = {
  id: string;
  sessionId: string;
  role: Stage3MessageRole;
  text: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type Stage3SessionRecord = {
  id: string;
  projectId: string;
  mediaId: string;
  goalText: string;
  status: Stage3SessionStatus;
  goalType: Stage3GoalType;
  targetScore: number;
  minGain: number;
  maxIterations: number;
  operationBudget: number;
  createdAt: string;
  updatedAt: string;
  lastPlanSummary: string | null;
  stagnationCount: number;
  currentVersionId: string | null;
  bestVersionId: string | null;
};

export type Stage3TimelineResponse = {
  session: Stage3SessionRecord;
  versions: Stage3VersionRecord[];
  iterations: Stage3IterationRecord[];
  messages: Stage3MessageRecord[];
  legacyVersions: Stage3Version[];
  uiVersions: Stage3Version[];
};

export type Stage3AgentRunResponse = {
  status: "applied" | "partiallyApplied" | "failed";
  sessionId: string;
  finalVersionId: string;
  bestVersionId: string;
  iterations: Array<{
    iterationIndex: number;
    plan: Stage3IterationPlan;
    appliedOps: Stage3Operation[];
    beforeVersionId: string;
    afterVersionId: string;
    judgeNotes: string;
    stoppedReason: Stage3IterationStopReason | null;
    scores: Stage3IterationScores;
    timings: {
      planMs?: number;
      executeMs?: number;
      judgeMs?: number;
      totalMs?: number;
    };
  }>;
  scoreHistory: number[];
  finalScore: number;
  stabilityNote?: string;
  summary: {
    beforeVersionId: string;
    changedOperations: string[];
    whyStopped: Stage3IterationStopReason;
  };
};

export type Stage3AgentConversationItem = {
  id: string;
  role: "user" | "assistant";
  title: string;
  text: string;
  meta: string[];
  createdAt: string;
  tone?: "neutral" | "success" | "warning";
};

// Legacy optimize-run shape used only by compat bridge and old history parsing.
export type Stage3OptimizationRun = {
  runId: string;
  createdAt: string;
  prompt: string;
  passes: Stage3AgentPass[];
  recommendedPass: number;
  sourceDurationSec: number | null;
};

export type ChatWorkflowStatus =
  | "new"
  | "sourceReady"
  | "stage2Ready"
  | "editing"
  | "agentRunning"
  | "exported"
  | "error";

export type ChatRenderExportRef = {
  kind: "stage3-render-export";
  fileName: string;
  renderTitle: string | null;
  clipStartSec: number | null;
  clipEndSec: number | null;
  focusY: number | null;
  templateId: string | null;
  createdAt: string | null;
};

export type ChatDraft = {
  id: string;
  threadId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  lastOpenStep: 1 | 2 | 3;
  stage2: {
    instruction: string;
    selectedCaptionOption: number | null;
    selectedTitleOption: number | null;
  };
  stage3: {
    topText: string | null;
    bottomText: string | null;
    clipStartSec: number | null;
    focusY: number | null;
    renderPlan: Partial<Stage3RenderPlan> | null;
    agentPrompt: string;
    selectedVersionId: string | null;
    passSelectionByVersion: Record<string, number>;
  };
};

export type ChatListItemAction = "open" | "step2" | "step3" | "delete";

export type ChannelPublishIntegrationStatus =
  | "disconnected"
  | "pending_selection"
  | "connected"
  | "reauth_required"
  | "error";

export type ChannelPublishSettings = {
  timezone: string;
  firstSlotLocalTime: string;
  dailySlotCount: number;
  slotIntervalMinutes: number;
  autoQueueEnabled: boolean;
  uploadLeadMinutes: number;
  notifySubscribersByDefault: boolean;
};

export type ChannelPublishIntegrationOption = {
  id: string;
  title: string;
  customUrl: string | null;
};

export type ChannelPublishIntegration = {
  provider: "youtube";
  status: ChannelPublishIntegrationStatus;
  connectedAt: string | null;
  updatedAt: string;
  selectedYoutubeChannelId: string | null;
  selectedYoutubeChannelTitle: string | null;
  selectedYoutubeChannelCustomUrl: string | null;
  selectedGoogleAccountEmail: string | null;
  availableChannels: ChannelPublishIntegrationOption[];
  scopes: string[];
  lastVerifiedAt: string | null;
  lastError: string | null;
};

export type ChannelPublicationStatus =
  | "queued"
  | "uploading"
  | "scheduled"
  | "published"
  | "failed"
  | "paused"
  | "canceled";

export type ChannelPublicationScheduleMode = "slot" | "custom";

export type ChannelPublicationEvent = {
  id: string;
  publicationId: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
};

export type ChannelPublication = {
  id: string;
  workspaceId: string;
  channelId: string;
  chatId: string;
  renderExportId: string;
  status: ChannelPublicationStatus;
  scheduleMode: ChannelPublicationScheduleMode;
  scheduledAt: string;
  uploadReadyAt: string;
  slotDate: string;
  slotIndex: number;
  title: string;
  description: string;
  tags: string[];
  notifySubscribers: boolean;
  needsReview: boolean;
  titleManual: boolean;
  descriptionManual: boolean;
  tagsManual: boolean;
  scheduleManual: boolean;
  youtubeVideoId: string | null;
  youtubeVideoUrl: string | null;
  publishedAt: string | null;
  canceledAt: string | null;
  lastError: string | null;
  renderFileName: string;
  sourceUrl: string;
  chatTitle: string;
  createdAt: string;
  updatedAt: string;
  events: ChannelPublicationEvent[];
};

export type ChannelPublicationSummary = {
  id: string;
  status: ChannelPublicationStatus;
  scheduledAt: string;
  needsReview: boolean;
  youtubeVideoUrl: string | null;
  lastError: string | null;
};

export type ChatListItem = {
  id: string;
  channelId: string;
  url: string;
  title: string;
  updatedAt: string;
  status: ChatWorkflowStatus;
  maxStep: 1 | 2 | 3;
  preferredStep: 1 | 2 | 3;
  hasDraft: boolean;
  exportTitle: string | null;
  publication?: ChannelPublicationSummary | null;
  liveAction?: "Fetching" | "Comments" | "Stage 2" | "Rendering" | null;
};

export type ChatEvent = {
  id: string;
  role: "user" | "assistant" | "system";
  type: "link" | "download" | "comments" | "stage2" | "error" | "note";
  text: string;
  data?: unknown;
  createdAt: string;
};

export type ChatThread = {
  id: string;
  channelId: string;
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  events: ChatEvent[];
};

export type ChannelAssetKind = "avatar" | "background" | "music";

export type ChannelAsset = {
  id: string;
  channelId: string;
  kind: ChannelAssetKind;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
};

export type Channel = {
  id: string;
  workspaceId?: string;
  creatorUserId?: string;
  name: string;
  username: string;
  systemPrompt: string;
  descriptionPrompt: string;
  examplesJson: string;
  stage2WorkerProfileId: string | null;
  stage2ExamplesConfig: Stage2ExamplesConfig;
  stage2HardConstraints: Stage2HardConstraints;
  stage2PromptConfig: Stage2PromptConfig;
  stage2StyleProfile?: Stage2StyleProfile;
  templateId: string;
  avatarAssetId: string | null;
  defaultBackgroundAssetId: string | null;
  defaultMusicAssetId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  currentUserCanOperate?: boolean;
  currentUserCanEditSetup?: boolean;
  currentUserCanManageAccess?: boolean;
  currentUserCanDelete?: boolean;
  isVisibleToCurrentUser?: boolean;
  publishSettings?: ChannelPublishSettings;
  publishIntegration?: ChannelPublishIntegration | null;
  assets?: {
    avatar?: ChannelAsset | null;
    backgrounds?: ChannelAsset[];
    music?: ChannelAsset[];
  };
};

export type CodexDeviceAuth = {
  status: "idle" | "running" | "done" | "error" | "canceled";
  output: string;
  loginUrl: string | null;
  userCode: string | null;
};

export type CodexAuthResponse = {
  sessionId: string | null;
  loggedIn: boolean;
  loginStatusText: string;
  deviceAuth: CodexDeviceAuth;
};

export type RuntimeToolCapability = {
  available: boolean;
  resolvedPath: string | null;
  message: string | null;
};

export type RuntimeCapabilitiesResponse = {
  deployment: {
    vercel: boolean;
    nodeVersion: string;
  };
  tools: {
    codex: RuntimeToolCapability;
    visolix: RuntimeToolCapability;
    ytDlp: RuntimeToolCapability;
    ffmpeg: RuntimeToolCapability;
    ffprobe: RuntimeToolCapability;
  };
  features: {
    fetchSource: boolean;
    downloadSource: boolean;
    loadComments: boolean;
    sharedCodex: boolean;
    stage2: boolean;
    stage3: boolean;
    stage3LocalExecutor: boolean;
  };
};

export type AppRole = "owner" | "manager" | "redactor" | "redactor_limited";

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  stage2ExamplesCorpusJson?: string;
  stage2PromptConfig?: Stage2PromptConfig;
  codexModelConfig?: WorkspaceCodexModelConfig;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceCodexModelConfigResponse = {
  codexModelConfig: WorkspaceCodexModelConfig;
  resolvedCodexModelConfig: ResolvedWorkspaceCodexModelConfig;
};

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMemberRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  role: AppRole;
  createdAt: string;
  updatedAt: string;
};

export type EffectivePermissions = {
  canManageMembers: boolean;
  canManageCodex: boolean;
  canCreateChannel: boolean;
  canManageAnyChannelAccess: boolean;
};

export type AuthMeResponse = {
  user: UserRecord;
  workspace: WorkspaceRecord;
  membership: WorkspaceMemberRecord;
  sharedCodexStatus: {
    status: "connected" | "disconnected" | "connecting" | "error";
    connected: boolean;
    loginStatusText: string | null;
    deviceAuth: CodexDeviceAuth | null;
  };
  effectivePermissions: EffectivePermissions;
};

export type ChannelAccessGrant = {
  id: string;
  channelId: string;
  userId: string;
  accessRole: "operate";
  grantedByUserId: string;
  createdAt: string;
  revokedAt: string | null;
  user?: UserRecord | null;
};
