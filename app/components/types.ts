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
  }>;
  titleOptions: string[];
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
  };
  output: Stage2Output;
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

// Legacy shape compatibility (for old events/response parsing)
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
  name: string;
  username: string;
  systemPrompt: string;
  examplesJson: string;
  templateId: string;
  avatarAssetId: string | null;
  defaultBackgroundAssetId: string | null;
  defaultMusicAssetId: string | null;
  createdAt: string;
  updatedAt: string;
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
  sessionId: string;
  loggedIn: boolean;
  loginStatusText: string;
  deviceAuth: CodexDeviceAuth;
};
