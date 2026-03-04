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
};

export type Stage3AgentPass = {
  pass: number;
  label: string;
  summary: string;
  changes: string[];
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

export type Stage3Segment = {
  startSec: number;
  endSec: number | null;
  label: string;
};

export type Stage3RenderPlan = {
  targetDurationSec: 6;
  timingMode: Stage3TimingMode;
  audioMode: Stage3AudioMode;
  smoothSlowMo: boolean;
  segments: Stage3Segment[];
  policy: Stage3RenderPolicy;
  backgroundAssetId: string | null;
  backgroundAssetMimeType: string | null;
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
};

export type Stage3OptimizeResponse = {
  optimization: {
    version: Stage3Version;
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
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  events: ChatEvent[];
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
