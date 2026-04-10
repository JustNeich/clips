"use client";

import {
  AuthMeResponse,
  Channel,
  ChannelAsset,
  ChatDraft,
  ChatListItem,
  ChatThread,
  CodexAuthResponse,
  CodexDeviceAuth,
  SourceJobDetail,
  SourceJobSummary,
  Stage2RunDetail,
  Stage2RunSummary,
  Stage3AgentConversationItem,
  Stage3IterationStopReason,
  Stage3RenderPlan,
  Stage3Segment,
  Stage3TimingMode,
  STAGE3_SEGMENT_SPEED_OPTIONS,
  Stage3SessionStatus,
  Stage3TimelineResponse,
  Stage3Version
} from "./components/types";
import { getPreferredStepForChat } from "../lib/chat-workflow";
import { isSourceJobActive } from "../lib/source-job-client";
import { isStage2RunActive } from "../lib/stage2-run-client";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "../lib/stage3-constants";
import {
  normalizeStage3CameraKeyframes,
  normalizeStage3CameraMotion,
  normalizeStage3PositionKeyframes,
  normalizeStage3ScaleKeyframes,
  resolveStage3EffectiveCameraTracks
} from "../lib/stage3-camera";
import { normalizeStage3SessionStatus } from "../lib/stage3-legacy-bridge";
import { STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
import { clampStage3TextScaleUi } from "../lib/stage3-text-fit";
import { sanitizeDisplayText } from "../lib/ui-error";
import {
  normalizeStage3SegmentFocusOverride,
  normalizeStage3SegmentMirrorOverride,
  normalizeStage3SegmentZoomOverride
} from "../lib/stage3-segment-transforms";
import {
  normalizeStage3RenderPlanSegments,
  resolveCanonicalStage3RenderPolicy
} from "../lib/stage3-render-plan";
import {
  buildStage3EditorSession,
  normalizeStage3EditorFragments
} from "../lib/stage3-editor-core";

const DEFAULT_TEXT_SCALE = 1.25;
const SEGMENT_SPEED_SET = new Set<number>(STAGE3_SEGMENT_SPEED_OPTIONS);

export type PersistedFlowShellState = {
  channelId: string | null;
  chatId: string | null;
  step: 1 | 2 | 3;
};

export function buildScopedStorageKey(
  prefix: string,
  workspaceId: string | null | undefined,
  userId: string | null | undefined
): string | null {
  if (!workspaceId || !userId) {
    return null;
  }
  return `${prefix}:${workspaceId}:${userId}`;
}

export function clampWorkflowStep(value: unknown): 1 | 2 | 3 {
  return value === 2 || value === 3 ? value : 1;
}

export function normalizePersistedFlowShellState(value: unknown): PersistedFlowShellState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  return {
    channelId: typeof candidate.channelId === "string" && candidate.channelId.trim() ? candidate.channelId : null,
    chatId: typeof candidate.chatId === "string" && candidate.chatId.trim() ? candidate.chatId : null,
    step: clampWorkflowStep(candidate.step)
  };
}

export function normalizeStage2DurationMetric(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const parsed =
    typeof candidate.lastDurationMs === "number" && Number.isFinite(candidate.lastDurationMs)
      ? candidate.lastDurationMs
      : null;
  if (parsed === null) {
    return null;
  }
  return Math.min(5 * 60_000, Math.max(1_000, Math.round(parsed)));
}

export function buildChannelAssetUrl(channelId: string, assetId: string): string {
  return `/api/channels/${channelId}/assets/${assetId}`;
}

export function findAssetById(
  assets: ChannelAsset[],
  assetId: string | null | undefined
): ChannelAsset | null {
  if (!assetId) {
    return null;
  }
  return assets.find((asset) => asset.id === assetId) ?? null;
}

export function toJsonDownload(fileName: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function triggerUrlDownload(url: string, fileName?: string | null): void {
  const a = document.createElement("a");
  a.href = url;
  if (fileName) {
    a.download = fileName;
  }
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function parseDownloadFileName(response: Response): string | null {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }
  const plainMatch = disposition.match(/filename="([^"]+)"/i) ?? disposition.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }
  if (error instanceof Error) {
    return error.name === "AbortError";
  }
  return false;
}

export function parseRetryAfterMs(value: string | null | undefined, fallbackMs: number): number {
  const seconds = Number.parseFloat(value ?? "");
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return fallbackMs;
  }
  return Math.max(250, Math.round(seconds * 1000));
}

export function responseContentType(response: Response): string {
  return (response.headers.get("content-type") ?? "").toLowerCase();
}

export function responseLooksLikeHtml(response: Response): boolean {
  const contentType = responseContentType(response);
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

export function responseLooksLikeJson(response: Response): boolean {
  return responseContentType(response).includes("application/json");
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternal = () => {
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
  }
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abortFromExternal);
    }
  }
}

export function equalCodexDeviceAuth(
  left: CodexDeviceAuth | null | undefined,
  right: CodexDeviceAuth | null | undefined
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.status === right.status &&
    left.output === right.output &&
    left.loginUrl === right.loginUrl &&
    left.userCode === right.userCode
  );
}

export function equalCodexAuthResponse(
  left: CodexAuthResponse | null | undefined,
  right: CodexAuthResponse | null | undefined
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.sessionId === right.sessionId &&
    left.loggedIn === right.loggedIn &&
    left.loginStatusText === right.loginStatusText &&
    equalCodexDeviceAuth(left.deviceAuth, right.deviceAuth)
  );
}

export function buildSharedCodexStatus(
  auth: CodexAuthResponse,
  canManageCodex: boolean
): AuthMeResponse["sharedCodexStatus"] {
  return {
    status: auth.loggedIn
      ? "connected"
      : auth.deviceAuth.status === "running"
        ? "connecting"
        : "disconnected",
    connected: auth.loggedIn,
    loginStatusText: auth.loginStatusText,
    deviceAuth: canManageCodex ? auth.deviceAuth : null
  };
}

export function equalSharedCodexStatus(
  left: AuthMeResponse["sharedCodexStatus"],
  right: AuthMeResponse["sharedCodexStatus"]
): boolean {
  return (
    left.status === right.status &&
    left.connected === right.connected &&
    left.loginStatusText === right.loginStatusText &&
    equalCodexDeviceAuth(left.deviceAuth, right.deviceAuth)
  );
}

export function equalChatListItem(left: ChatListItem, right: ChatListItem): boolean {
  return (
    left.id === right.id &&
    left.channelId === right.channelId &&
    left.url === right.url &&
    left.title === right.title &&
    left.updatedAt === right.updatedAt &&
    left.status === right.status &&
    left.maxStep === right.maxStep &&
    left.preferredStep === right.preferredStep &&
    left.hasDraft === right.hasDraft &&
    left.exportTitle === right.exportTitle &&
    (left.publication?.id ?? null) === (right.publication?.id ?? null) &&
    (left.publication?.status ?? null) === (right.publication?.status ?? null) &&
    (left.publication?.scheduledAt ?? null) === (right.publication?.scheduledAt ?? null) &&
    (left.publication?.needsReview ?? null) === (right.publication?.needsReview ?? null) &&
    (left.publication?.youtubeVideoUrl ?? null) === (right.publication?.youtubeVideoUrl ?? null) &&
    (left.publication?.lastError ?? null) === (right.publication?.lastError ?? null) &&
    (left.liveAction ?? null) === (right.liveAction ?? null)
  );
}

export function equalChatList(left: ChatListItem[], right: ChatListItem[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!equalChatListItem(left[index]!, right[index]!)) {
      return false;
    }
  }
  return true;
}

export function syncChatListPublicationSummaries(
  items: ChatListItem[],
  summaries: ReadonlyMap<string, NonNullable<ChatListItem["publication"]>>
): ChatListItem[] {
  let changed = false;
  const nextItems = items.map((item) => {
    const currentPublication = item.publication ?? null;
    const nextPublication = summaries.get(item.id) ?? null;
    if (
      (currentPublication?.id ?? null) === (nextPublication?.id ?? null) &&
      (currentPublication?.status ?? null) === (nextPublication?.status ?? null) &&
      (currentPublication?.scheduledAt ?? null) === (nextPublication?.scheduledAt ?? null) &&
      (currentPublication?.needsReview ?? null) === (nextPublication?.needsReview ?? null) &&
      (currentPublication?.youtubeVideoUrl ?? null) === (nextPublication?.youtubeVideoUrl ?? null) &&
      (currentPublication?.lastError ?? null) === (nextPublication?.lastError ?? null)
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      publication: nextPublication
    };
  });
  return changed ? nextItems : items;
}

export function equalChatThread(
  left: ChatThread | null | undefined,
  right: ChatThread | null | undefined
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  const leftLastEvent = left.events[left.events.length - 1] ?? null;
  const rightLastEvent = right.events[right.events.length - 1] ?? null;
  return (
    left.id === right.id &&
    left.channelId === right.channelId &&
    left.url === right.url &&
    left.title === right.title &&
    left.updatedAt === right.updatedAt &&
    left.events.length === right.events.length &&
    leftLastEvent?.id === rightLastEvent?.id &&
    leftLastEvent?.createdAt === rightLastEvent?.createdAt
  );
}

export function equalChatDraft(
  left: ChatDraft | null | undefined,
  right: ChatDraft | null | undefined
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.id === right.id && left.threadId === right.threadId && left.updatedAt === right.updatedAt;
}

export function equalStage2RunSummary(left: Stage2RunSummary, right: Stage2RunSummary): boolean {
  return (
    left.runId === right.runId &&
    left.chatId === right.chatId &&
    left.channelId === right.channelId &&
    left.sourceUrl === right.sourceUrl &&
    left.userInstruction === right.userInstruction &&
    left.mode === right.mode &&
    left.baseRunId === right.baseRunId &&
    left.status === right.status &&
    left.errorMessage === right.errorMessage &&
    left.hasResult === right.hasResult &&
    left.createdAt === right.createdAt &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt &&
    left.finishedAt === right.finishedAt &&
    left.progress.status === right.progress.status &&
    left.progress.updatedAt === right.progress.updatedAt &&
    left.progress.activeStageId === right.progress.activeStageId &&
    left.progress.error === right.progress.error
  );
}

export function equalStage2RunSummaries(left: Stage2RunSummary[], right: Stage2RunSummary[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!equalStage2RunSummary(left[index]!, right[index]!)) {
      return false;
    }
  }
  return true;
}

export function equalStage2RunDetail(
  left: Stage2RunDetail | null | undefined,
  right: Stage2RunDetail | null | undefined
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return equalStage2RunSummary(left, right) && Boolean(left.result) === Boolean(right.result);
}

export function equalSourceJobSummary(left: SourceJobSummary, right: SourceJobSummary): boolean {
  return (
    left.jobId === right.jobId &&
    left.chatId === right.chatId &&
    left.channelId === right.channelId &&
    left.sourceUrl === right.sourceUrl &&
    left.status === right.status &&
    left.errorMessage === right.errorMessage &&
    left.hasResult === right.hasResult &&
    left.createdAt === right.createdAt &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt &&
    left.finishedAt === right.finishedAt &&
    left.progress.status === right.progress.status &&
    left.progress.updatedAt === right.progress.updatedAt &&
    left.progress.activeStageId === right.progress.activeStageId &&
    left.progress.error === right.progress.error &&
    (left.progress.detail ?? null) === (right.progress.detail ?? null)
  );
}

export function equalSourceJobSummaries(left: SourceJobSummary[], right: SourceJobSummary[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!equalSourceJobSummary(left[index]!, right[index]!)) {
      return false;
    }
  }
  return true;
}

export function equalSourceJobDetail(
  left: SourceJobDetail | null | undefined,
  right: SourceJobDetail | null | undefined
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return equalSourceJobSummary(left, right) && Boolean(left.result) === Boolean(right.result);
}

export function deriveLivePreferredStep(params: {
  chat: ChatThread | null;
  draft: ChatDraft | null;
  sourceJobs?: SourceJobSummary[];
  stage2Runs?: Stage2RunSummary[];
}): 1 | 2 | 3 {
  if (params.sourceJobs?.some((job) => isSourceJobActive(job))) {
    return 1;
  }
  if (params.stage2Runs?.some((run) => isStage2RunActive(run))) {
    return 2;
  }
  return getPreferredStepForChat(params.chat, params.draft);
}

export function resolveHydratedWorkflowStep(input: {
  nextChatId: string | null;
  initializedChatId: string | null;
  currentStep: 1 | 2 | 3;
  preferredStep: 1 | 2 | 3;
  maxStep: 1 | 2 | 3;
}): 1 | 2 | 3 {
  if (!input.nextChatId) {
    return 1;
  }
  if (input.initializedChatId === input.nextChatId) {
    return Math.min(input.currentStep, input.maxStep) as 1 | 2 | 3;
  }
  return Math.min(input.preferredStep, input.maxStep) as 1 | 2 | 3;
}

export function resolveLiveHydratedWorkflowStep(input: {
  livePreferredStep: 1 | 2 | 3;
  maxStep: 1 | 2 | 3;
  requestedStep?: 1 | 2 | 3;
}): 1 | 2 | 3 {
  if (input.requestedStep) {
    return Math.min(input.requestedStep, input.maxStep) as 1 | 2 | 3;
  }
  if (input.livePreferredStep === 1 || input.livePreferredStep === 2) {
    return input.livePreferredStep;
  }
  return Math.min(input.livePreferredStep, input.maxStep) as 1 | 2 | 3;
}

export function currentPollDelay(visibleMs: number, hiddenMs: number): number {
  if (typeof document === "undefined") {
    return visibleMs;
  }
  return document.visibilityState === "visible" ? visibleMs : hiddenMs;
}

export function mergeSavedChannelIntoList(channels: Channel[], savedChannel: Channel): Channel[] {
  const existing = channels.find((channel) => channel.id === savedChannel.id);
  const merged = existing ? { ...existing, ...savedChannel } : savedChannel;
  const rest = channels.filter((channel) => channel.id !== savedChannel.id);
  return [merged, ...rest];
}

export function fallbackRenderPlan(): Stage3RenderPlan {
  return {
    targetDurationSec: 6,
    timingMode: "auto",
    normalizeToTargetEnabled: false,
    editorSelectionMode: "window",
    audioMode: "source_only",
    sourceAudioEnabled: true,
    smoothSlowMo: false,
    mirrorEnabled: true,
    cameraMotion: "disabled",
    cameraKeyframes: [],
    cameraPositionKeyframes: [],
    cameraScaleKeyframes: [],
    videoZoom: 1,
    topFontScale: DEFAULT_TEXT_SCALE,
    bottomFontScale: DEFAULT_TEXT_SCALE,
    musicGain: 0.65,
    textPolicy: "strict_fit",
    segments: [],
    policy: "fixed_segments",
    backgroundAssetId: null,
    backgroundAssetMimeType: null,
    musicAssetId: null,
    musicAssetMimeType: null,
    avatarAssetId: null,
    avatarAssetMimeType: null,
    authorName: "Science Snack",
    authorHandle: "@Science_Snack_1",
    templateId: STAGE3_TEMPLATE_ID,
    prompt: ""
  };
}

export function roundStage3Tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function normalizeStage3SegmentSpeed(value: unknown): Stage3Segment["speed"] {
  if (typeof value === "number" && Number.isFinite(value) && SEGMENT_SPEED_SET.has(value)) {
    return value as Stage3Segment["speed"];
  }
  return 1;
}

export function normalizeClientSegments(
  segments: Stage3Segment[],
  sourceDurationSec: number | null
): Stage3Segment[] {
  return normalizeStage3EditorFragments({
    segments,
    sourceDurationSec
  }).map((segment) => ({
    startSec: segment.startSec,
    endSec: segment.endSec,
    speed: segment.speed,
    label: segment.label,
    focusY: segment.focusYOverride,
    videoZoom: segment.videoZoomOverride,
    mirrorEnabled: segment.mirrorEnabledOverride
  }));
}

export function sumClientSegmentsDuration(
  segments: Stage3Segment[],
  sourceDurationSec: number | null
): number {
  return normalizeClientSegments(segments, sourceDurationSec).reduce((total, segment) => {
    const endSec = segment.endSec ?? sourceDurationSec ?? segment.startSec;
    return total + Math.max(0, endSec - segment.startSec) / normalizeStage3SegmentSpeed(segment.speed);
  }, 0);
}

export function trimClientSegmentsToDuration(
  segments: Stage3Segment[],
  targetDurationSec: number,
  sourceDurationSec: number | null
): Stage3Segment[] {
  void targetDurationSec;
  return normalizeClientSegments(segments, sourceDurationSec);
}

export function resolveNormalizedTimingMode(params: {
  segments: Stage3Segment[];
  targetDurationSec: number;
  sourceDurationSec: number | null;
}): Stage3TimingMode {
  const session = buildStage3EditorSession({
    rawSegments: params.segments,
    selectionMode: "fragments",
    clipStartSec: 0,
    clipDurationSec: params.targetDurationSec,
    targetDurationSec: params.targetDurationSec,
    sourceDurationSec: params.sourceDurationSec
  });
  return session.output.timingMode;
}

export function getEditingPolicy(
  segments: Stage3Segment[],
  compressionEnabled: boolean
): Stage3RenderPlan["policy"] {
  void segments;
  void compressionEnabled;
  return "fixed_segments";
}

export function stripRenderPlanForPreview(plan: Stage3RenderPlan): Stage3RenderPlan {
  const fallback = fallbackRenderPlan();
  return {
    ...fallback,
    targetDurationSec: plan.targetDurationSec,
    timingMode: plan.timingMode,
    audioMode: plan.audioMode,
    sourceAudioEnabled: plan.sourceAudioEnabled,
    smoothSlowMo: plan.smoothSlowMo,
    mirrorEnabled: plan.mirrorEnabled,
    cameraMotion: plan.cameraMotion,
    cameraKeyframes: plan.cameraKeyframes,
    cameraPositionKeyframes: plan.cameraPositionKeyframes,
    cameraScaleKeyframes: plan.cameraScaleKeyframes,
    videoZoom: plan.videoZoom,
    segments: plan.segments,
    policy: plan.policy,
    prompt: "",
    musicGain: plan.musicGain,
    musicAssetId: plan.musicAssetId,
    musicAssetMimeType: plan.musicAssetMimeType
  };
}

export function normalizeRenderPlan(value: unknown, fallback?: Stage3RenderPlan): Stage3RenderPlan {
  const candidate = value && typeof value === "object" ? (value as Partial<Stage3RenderPlan>) : undefined;
  const base = fallback ?? fallbackRenderPlan();
  const videoZoom =
    typeof candidate?.videoZoom === "number" && Number.isFinite(candidate.videoZoom)
      ? Math.min(STAGE3_MAX_VIDEO_ZOOM, Math.max(STAGE3_MIN_VIDEO_ZOOM, candidate.videoZoom))
      : base.videoZoom;
  const legacyCameraKeyframes = normalizeStage3CameraKeyframes(candidate?.cameraKeyframes ?? base.cameraKeyframes, {
    clipDurationSec: base.targetDurationSec,
    fallbackFocusY: 0.5,
    fallbackZoom: videoZoom
  });
  const effectiveCameraTracks = resolveStage3EffectiveCameraTracks({
    cameraPositionKeyframes: candidate?.cameraPositionKeyframes,
    cameraScaleKeyframes: candidate?.cameraScaleKeyframes,
    cameraKeyframes: candidate?.cameraKeyframes ?? base.cameraKeyframes,
    cameraMotion: candidate?.cameraMotion ?? base.cameraMotion,
    clipDurationSec: base.targetDurationSec,
    baseFocusY: 0.5,
    baseZoom: videoZoom
  });
  const segments = Array.isArray(candidate?.segments)
    ? normalizeStage3RenderPlanSegments(candidate.segments)
    : base.segments;
  const normalizeToTargetEnabled =
    typeof candidate?.normalizeToTargetEnabled === "boolean"
      ? candidate.normalizeToTargetEnabled
      : candidate?.timingMode === "compress" ||
          candidate?.timingMode === "stretch" ||
          candidate?.policy === "full_source_normalize";
  const requestedPolicy =
    candidate?.policy === "adaptive_window" ||
    candidate?.policy === "full_source_normalize" ||
    candidate?.policy === "fixed_segments"
      ? candidate.policy
      : base.policy;
  const policy = resolveCanonicalStage3RenderPolicy({
    segments,
    normalizeToTargetEnabled,
    requestedPolicy
  });

  return {
    targetDurationSec: 6,
    timingMode:
      candidate?.timingMode === "auto" ||
      candidate?.timingMode === "compress" ||
      candidate?.timingMode === "stretch"
        ? candidate.timingMode
        : base.timingMode,
    normalizeToTargetEnabled,
    editorSelectionMode:
      candidate?.editorSelectionMode === "window" || candidate?.editorSelectionMode === "fragments"
        ? candidate.editorSelectionMode
        : base.editorSelectionMode,
    audioMode:
      candidate?.audioMode === "source_only" || candidate?.audioMode === "source_plus_music"
        ? candidate.audioMode
        : base.audioMode,
    sourceAudioEnabled: Boolean(candidate?.sourceAudioEnabled ?? base.sourceAudioEnabled),
    smoothSlowMo: Boolean(candidate?.smoothSlowMo ?? base.smoothSlowMo),
    mirrorEnabled: Boolean(candidate?.mirrorEnabled ?? base.mirrorEnabled),
    cameraMotion: normalizeStage3CameraMotion(candidate?.cameraMotion ?? base.cameraMotion),
    cameraKeyframes: legacyCameraKeyframes,
    cameraPositionKeyframes: normalizeStage3PositionKeyframes(
      effectiveCameraTracks.positionKeyframes,
      {
        clipDurationSec: base.targetDurationSec,
        fallbackFocusY: 0.5
      }
    ),
    cameraScaleKeyframes: normalizeStage3ScaleKeyframes(effectiveCameraTracks.scaleKeyframes, {
      clipDurationSec: base.targetDurationSec,
      fallbackZoom: videoZoom
    }),
    videoZoom,
    topFontScale:
      typeof candidate?.topFontScale === "number" && Number.isFinite(candidate.topFontScale)
        ? clampStage3TextScaleUi(candidate.topFontScale)
        : base.topFontScale,
    bottomFontScale:
      typeof candidate?.bottomFontScale === "number" && Number.isFinite(candidate.bottomFontScale)
        ? clampStage3TextScaleUi(candidate.bottomFontScale)
        : base.bottomFontScale,
    musicGain:
      typeof candidate?.musicGain === "number" && Number.isFinite(candidate.musicGain)
        ? Math.min(1, Math.max(0, candidate.musicGain))
        : base.musicGain,
    textPolicy:
      candidate?.textPolicy === "strict_fit" ||
      candidate?.textPolicy === "preserve_words" ||
      candidate?.textPolicy === "aggressive_compact"
        ? candidate.textPolicy
        : base.textPolicy,
    segments,
    policy,
    backgroundAssetId:
      typeof candidate?.backgroundAssetId === "string" && candidate.backgroundAssetId.trim()
        ? candidate.backgroundAssetId.trim()
        : null,
    backgroundAssetMimeType:
      typeof candidate?.backgroundAssetMimeType === "string" &&
      candidate.backgroundAssetMimeType.trim()
        ? candidate.backgroundAssetMimeType.trim()
        : null,
    musicAssetId:
      typeof candidate?.musicAssetId === "string" && candidate.musicAssetId.trim()
        ? candidate.musicAssetId.trim()
        : null,
    musicAssetMimeType:
      typeof candidate?.musicAssetMimeType === "string" && candidate.musicAssetMimeType.trim()
        ? candidate.musicAssetMimeType.trim()
        : null,
    avatarAssetId:
      typeof candidate?.avatarAssetId === "string" && candidate.avatarAssetId.trim()
        ? candidate.avatarAssetId.trim()
        : null,
    avatarAssetMimeType:
      typeof candidate?.avatarAssetMimeType === "string" && candidate.avatarAssetMimeType.trim()
        ? candidate.avatarAssetMimeType.trim()
        : null,
    authorName:
      typeof candidate?.authorName === "string" && candidate.authorName.trim()
        ? candidate.authorName.trim()
        : base.authorName,
    authorHandle:
      typeof candidate?.authorHandle === "string" && candidate.authorHandle.trim()
        ? candidate.authorHandle.trim()
        : base.authorHandle,
    templateId:
      typeof candidate?.templateId === "string" && candidate.templateId.trim()
        ? candidate.templateId.trim()
        : base.templateId,
    prompt: typeof candidate?.prompt === "string" ? candidate.prompt : base.prompt
  };
}

export function hydrateStage3RenderPlanOverride(
  value: unknown,
  base: Stage3RenderPlan
): Stage3RenderPlan {
  if (!value || typeof value !== "object") {
    return normalizeRenderPlan(base, base);
  }
  const override = value as Record<string, unknown>;
  const merged: Record<string, unknown> = {
    ...base,
    ...override
  };
  const hasLegacyCameraOverride = "cameraKeyframes" in override || "cameraMotion" in override;
  if (hasLegacyCameraOverride && !("cameraPositionKeyframes" in override)) {
    delete merged.cameraPositionKeyframes;
  }
  if (hasLegacyCameraOverride && !("cameraScaleKeyframes" in override)) {
    delete merged.cameraScaleKeyframes;
  }
  return normalizeRenderPlan(
    merged,
    base
  );
}

export function shorten(value: string, max = 54): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}...`;
}

export function formatStage3Status(value: Stage3SessionStatus): string {
  switch (value) {
    case "running":
      return "В работе";
    case "completed":
      return "Цель достигнута";
    case "partiallyApplied":
      return "Лучший найденный вариант";
    case "failed":
      return "Остановлено";
    default:
      return value;
  }
}

export function formatStage3StopReason(value: Stage3IterationStopReason | null | undefined): string {
  switch (value) {
    case "targetScoreReached":
      return "достигнут target score";
    case "maxIterationsReached":
      return "исчерпан лимит итераций";
    case "minGainReached":
      return "прогресс стабилизировался";
    case "safety":
      return "остановка по safety";
    case "noProgress":
      return "нет прогресса";
    case "plannerFailure":
      return "планировщик не дал валидный план";
    case "rollbackCreated":
      return "создан rollback checkpoint";
    case "userStop":
      return "остановлено пользователем";
    default:
      return "цикл завершен";
  }
}

export function formatStage3Operation(op: string): string {
  switch (op) {
    case "set_video_zoom":
      return "zoom";
    case "set_focus_y":
      return "focus";
    case "set_clip_start":
      return "clip start";
    case "set_segments":
      return "segments";
    case "append_segment":
      return "добавить сегмент";
    case "clear_segments":
      return "очистить сегменты";
    case "set_audio_mode":
      return "аудио";
    case "set_slowmo":
      return "слоу-мо";
    case "set_top_font_scale":
      return "размер верхнего текста";
    case "set_bottom_font_scale":
      return "размер нижнего текста";
    case "rewrite_top_text":
      return "переписать верх";
    case "rewrite_bottom_text":
      return "переписать низ";
    case "set_timing_mode":
      return "тайминг";
    case "set_text_policy":
      return "политика текста";
    case "set_music_gain":
      return "музыка";
    default:
      return op.replace(/^set_/, "").replace(/_/g, " ");
  }
}

export function formatSourceProviderLabel(
  provider: "visolix" | "ytDlp" | "upload" | null | undefined
): string | null {
  if (provider === "visolix") {
    return "Visolix";
  }
  if (provider === "ytDlp") {
    return "локальный fallback-загрузчик";
  }
  if (provider === "upload") {
    return "ручную загрузку mp4";
  }
  return null;
}

export function mergeStage3Versions(groups: Stage3Version[][]): Stage3Version[] {
  const byRunId = new Map<string, Stage3Version>();
  for (const group of groups) {
    for (const version of group) {
      if (!version?.runId) {
        continue;
      }
      byRunId.set(version.runId, version);
    }
  }

  return [...byRunId.values()]
    .sort((left, right) => {
      if (left.createdAt === right.createdAt) {
        return left.runId.localeCompare(right.runId);
      }
      return left.createdAt < right.createdAt ? -1 : 1;
    })
    .map((version, index) => ({ ...version, versionNo: index + 1 }));
}

export function buildStage3AgentConversation(
  timeline: Stage3TimelineResponse | null
): Stage3AgentConversationItem[] {
  if (!timeline) {
    return [];
  }

  const items: Stage3AgentConversationItem[] = [];

  for (const message of timeline.messages) {
    if (message.role === "user") {
      const goal =
        typeof message.payload?.goal === "string" && message.payload.goal.trim()
          ? message.payload.goal.trim()
          : timeline.session.goalText;
      items.push({
        id: message.id,
        role: "user",
        title: "Задача",
        text: sanitizeDisplayText(goal),
        meta: [
          `тип цели: ${timeline.session.goalType}`,
          `целевая оценка ${timeline.session.targetScore.toFixed(2)}`
        ],
        createdAt: message.createdAt
      });
      continue;
    }

    if (message.role === "assistant_summary") {
      const status = normalizeStage3SessionStatus(message.payload?.status);
      const whyStopped =
        typeof message.payload?.whyStopped === "string"
          ? (message.payload.whyStopped as Stage3IterationStopReason)
          : null;
      const iterationCount =
        typeof message.payload?.iterations === "number" && Number.isFinite(message.payload.iterations)
          ? message.payload.iterations
          : timeline.iterations.length;
      items.push({
        id: message.id,
        role: "assistant",
        title: "Итог",
        text:
          status === "completed"
            ? "Агент завершил цикл после достижения порога качества."
            : status === "partiallyApplied"
              ? "Агент сохранил лучший вариант и остановился без ручной паузы."
              : "Агент завершил цикл с остановкой по ограничению или safety.",
        meta: [
          status ? formatStage3Status(status) : "Статус неизвестен",
          `${iterationCount} итерац.`,
          formatStage3StopReason(whyStopped)
        ],
        createdAt: message.createdAt,
        tone: status === "completed" ? "success" : status === "failed" ? "warning" : "neutral"
      });
      continue;
    }

    if (message.role === "assistant_auto" && message.text === "rollback") {
      const targetVersionId =
        typeof message.payload?.targetVersionId === "string" ? message.payload.targetVersionId : null;
      const reason = typeof message.payload?.reason === "string" ? message.payload.reason : "rollback";
      items.push({
        id: message.id,
        role: "assistant",
        title: "Откат",
        text: "Создана новая версия-откат от выбранной точки timeline.",
        meta: [
          targetVersionId ? `цель ${shorten(targetVersionId, 18)}` : "целевая версия неизвестна",
          reason
        ],
        createdAt: message.createdAt,
        tone: "warning"
      });
    }
  }

  for (const iteration of timeline.iterations) {
    const operations = iteration.appliedOps.map((operation) => formatStage3Operation(operation.op));
    items.push({
      id: `iteration-${iteration.id}`,
      role: "assistant",
      title: `Итерация ${iteration.iterationIndex}`,
      text: sanitizeDisplayText(iteration.judgeNotes || iteration.plan.rationale),
      meta: [
        `оценка ${iteration.scores.total.toFixed(2)}`,
        `прирост ${iteration.scores.stepGain >= 0 ? "+" : ""}${iteration.scores.stepGain.toFixed(2)}`,
        operations.length ? operations.join(", ") : "без операций",
        formatStage3StopReason(iteration.stoppedReason)
      ],
      createdAt: iteration.createdAt,
      tone:
        iteration.stoppedReason === "targetScoreReached"
          ? "success"
          : iteration.stoppedReason === "safety"
            ? "warning"
            : "neutral"
    });
  }

  return items.sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.id.localeCompare(right.id);
    }
    return left.createdAt < right.createdAt ? -1 : 1;
  });
}
