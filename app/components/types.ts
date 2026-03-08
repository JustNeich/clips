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
    top: string;
    bottom: string;
    topRu?: string;
    bottomRu?: string;
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
    commentsOmittedFromPrompt?: number;
    frameDescriptions?: string[];
    commentsExtractionFallbackUsed?: boolean;
  };
  output: Stage2Output;
  seo?: {
    description: string;
    tags: string;
  } | null;
  warnings: Array<{ field: string; message: string }>;
  model?: string;
  reasoningEffort?: string;
  userInstructionUsed?: string | null;
  channel?: {
    id: string;
    name: string;
    username: string;
  };
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

export type Stage3TimingMode = "auto" | "compress" | "stretch";

export type Stage3AudioMode = "source_only" | "source_plus_music";

export type Stage3RenderPolicy = "full_source_normalize" | "adaptive_window" | "fixed_segments";

export type Stage3TextPolicy = "strict_fit" | "preserve_words" | "aggressive_compact";

export type Stage3Segment = {
  startSec: number;
  endSec: number | null;
  label: string;
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
  audioMode: Stage3AudioMode;
  smoothSlowMo: boolean;
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
  textFit: {
    topFontPx: number;
    bottomFontPx: number;
    topCompacted: boolean;
    bottomCompacted: boolean;
  };
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
  isVisibleToCurrentUser?: boolean;
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
  };
};

export type AppRole = "owner" | "manager" | "redactor" | "redactor_limited";

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
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
