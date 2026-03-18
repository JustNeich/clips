"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, FlowStep } from "./components/AppShell";
import { ChannelManager } from "./components/ChannelManager";
import { DetailsDrawer } from "./components/DetailsDrawer";
import { Step1PasteLink } from "./components/Step1PasteLink";
import { Step2PickCaption } from "./components/Step2PickCaption";
import { Step3RenderTemplate } from "./components/Step3RenderTemplate";
import {
  AppRole,
  AuthMeResponse,
  Channel,
  ChannelAccessGrant,
  ChannelAsset,
  ChatDraft,
  ChatEvent,
  ChatListItem,
  ChatRenderExportRef,
  ChatThread,
  Stage3AgentConversationItem,
  CodexAuthResponse,
  CodexDeviceAuth,
  CommentsPayload,
  RuntimeCapabilitiesResponse,
  Stage3AgentRunResponse,
  Stage3CameraMotion,
  Stage3EditorDraftOverrides,
  Stage3JobEnvelope,
  Stage3PreviewState,
  Stage3RenderState,
  Stage3IterationStopReason,
  Stage3RenderPlan,
  Stage3WorkerListResponse,
  Stage3WorkerPairingResponse,
  Stage3WorkerSummary,
  Stage3Segment,
  STAGE3_SEGMENT_SPEED_OPTIONS,
  Stage3SessionStatus,
  Stage3StateSnapshot,
  Stage3TextFitSnapshot,
  Stage3TimelineResponse,
  Stage3Version,
  Stage2RunDetail,
  Stage2RunSummary,
  Stage2Response,
  UserRecord
} from "./components/types";
import type { Stage2ProgressSnapshot, Stage2PromptConfig } from "../lib/stage2-pipeline";
import type { Stage2ExamplesConfig, Stage2HardConstraints } from "../lib/stage2-channel-config";
import {
  issueScopedRequestVersion,
  getStage2ElapsedMs,
  isStage2RunActive,
  matchesScopedRequestVersion,
  pickPreferredStage2RunId
} from "../lib/stage2-run-client";
import {
  STAGE3_TEMPLATE_ID
} from "../lib/stage3-template";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import {
  clampStage3TextScaleUi,
  createStage3TextFitSnapshot
} from "../lib/stage3-text-fit";
import { templateUsesBuiltInBackdropFromRegistry } from "../lib/stage3-template-registry";
import {
  buildLegacyTimelineEntries,
  findLatestStage3AgentSessionRef,
  normalizeStage3SessionStatus
} from "../lib/stage3-legacy-bridge";
import { buildStage3WorkerCommands } from "../lib/stage3-worker-commands";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "../lib/stage3-constants";
import {
  buildChatListItem,
  extractCommentsPayload,
  extractStage1FetchState,
  extractStage2Payload,
  getDefaultDraftState,
  getMaxStepForChat,
  getPreferredStepForChat,
  normalizeChatDraft
} from "../lib/chat-workflow";
import { sanitizeDisplayText, summarizeUserFacingError } from "../lib/ui-error";

const CLIP_DURATION_SEC = 6;
const DEFAULT_TEXT_SCALE = 1.25;
const DEFAULT_STAGE2_EXPECTED_DURATION_MS = 40_000;
const STAGE2_DETAIL_POLL_VISIBLE_MS = 900;
const STAGE2_DETAIL_POLL_HIDDEN_MS = 2_500;
const STAGE2_RUNS_POLL_VISIBLE_MS = 1_800;
const STAGE2_RUNS_POLL_HIDDEN_MS = 5_000;
const STAGE2_ELAPSED_TICK_MS = 250;
const STAGE2_ELAPSED_TICK_HIDDEN_MS = 1_000;
const STAGE2_POLL_RETRY_VISIBLE_MS = 1_500;
const STAGE2_POLL_RETRY_HIDDEN_MS = 4_000;
const SEGMENT_SPEED_SET = new Set<number>(STAGE3_SEGMENT_SPEED_OPTIONS);

type BusyAction =
  | ""
  | "fetch"
  | "download"
  | "comments"
  | "stage2"
  | "render"
  | "stage3-optimize"
  | "video-meta"
  | "video-preview"
  | "background-upload"
  | "music-upload"
  | "channel-load"
  | "channel-save"
  | "channel-create"
  | "channel-delete"
  | "channel-asset-delete"
  | "connect-codex"
  | "refresh-codex";

type PersistedFlowShellState = {
  channelId: string | null;
  chatId: string | null;
  step: 1 | 2 | 3;
};

function buildScopedStorageKey(
  prefix: string,
  workspaceId: string | null | undefined,
  userId: string | null | undefined
): string | null {
  if (!workspaceId || !userId) {
    return null;
  }
  return `${prefix}:${workspaceId}:${userId}`;
}

function clampWorkflowStep(value: unknown): 1 | 2 | 3 {
  return value === 2 || value === 3 ? value : 1;
}

function normalizePersistedFlowShellState(value: unknown): PersistedFlowShellState | null {
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

function normalizeStage2DurationMetric(value: unknown): number | null {
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

function buildChannelAssetUrl(channelId: string, assetId: string): string {
  return `/api/channels/${channelId}/assets/${assetId}`;
}

function findAssetById(assets: ChannelAsset[], assetId: string | null | undefined): ChannelAsset | null {
  if (!assetId) {
    return null;
  }
  return assets.find((asset) => asset.id === assetId) ?? null;
}

function toJsonDownload(fileName: string, data: unknown): void {
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

function triggerUrlDownload(url: string, fileName?: string | null): void {
  const a = document.createElement("a");
  a.href = url;
  if (fileName) {
    a.download = fileName;
  }
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }
  if (error instanceof Error) {
    return error.name === "AbortError";
  }
  return false;
}

function parseRetryAfterMs(value: string | null | undefined, fallbackMs: number): number {
  const seconds = Number.parseFloat(value ?? "");
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return fallbackMs;
  }
  return Math.max(250, Math.round(seconds * 1000));
}

function responseContentType(response: Response): string {
  return (response.headers.get("content-type") ?? "").toLowerCase();
}

function responseLooksLikeHtml(response: Response): boolean {
  const contentType = responseContentType(response);
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

function responseLooksLikeJson(response: Response): boolean {
  return responseContentType(response).includes("application/json");
}

async function fetchWithTimeout(
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

function equalCodexDeviceAuth(
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

function equalCodexAuthResponse(
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

function buildSharedCodexStatus(
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

function equalSharedCodexStatus(
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

function equalChatListItem(left: ChatListItem, right: ChatListItem): boolean {
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
    (left.liveAction ?? null) === (right.liveAction ?? null)
  );
}

function equalChatList(left: ChatListItem[], right: ChatListItem[]): boolean {
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

function equalChatThread(
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

function equalChatDraft(left: ChatDraft | null | undefined, right: ChatDraft | null | undefined): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.id === right.id &&
    left.threadId === right.threadId &&
    left.updatedAt === right.updatedAt
  );
}

function equalStage2RunSummary(
  left: Stage2RunSummary,
  right: Stage2RunSummary
): boolean {
  return (
    left.runId === right.runId &&
    left.chatId === right.chatId &&
    left.channelId === right.channelId &&
    left.sourceUrl === right.sourceUrl &&
    left.userInstruction === right.userInstruction &&
    left.mode === right.mode &&
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

function equalStage2RunSummaries(left: Stage2RunSummary[], right: Stage2RunSummary[]): boolean {
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

function equalStage2RunDetail(
  left: Stage2RunDetail | null | undefined,
  right: Stage2RunDetail | null | undefined
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    equalStage2RunSummary(left, right) &&
    Boolean(left.result) === Boolean(right.result)
  );
}

function currentPollDelay(visibleMs: number, hiddenMs: number): number {
  if (typeof document === "undefined") {
    return visibleMs;
  }
  return document.visibilityState === "visible" ? visibleMs : hiddenMs;
}

function mergeSavedChannelIntoList(channels: Channel[], savedChannel: Channel): Channel[] {
  const existing = channels.find((channel) => channel.id === savedChannel.id);
  const merged = existing ? { ...existing, ...savedChannel } : savedChannel;
  const rest = channels.filter((channel) => channel.id !== savedChannel.id);
  return [merged, ...rest];
}

function fallbackRenderPlan(): Stage3RenderPlan {
  return {
    targetDurationSec: 6,
    timingMode: "auto",
    audioMode: "source_only",
    sourceAudioEnabled: true,
    smoothSlowMo: false,
    mirrorEnabled: true,
    cameraMotion: "disabled",
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

function roundStage3Tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeStage3SegmentSpeed(value: unknown): Stage3Segment["speed"] {
  if (typeof value === "number" && Number.isFinite(value) && SEGMENT_SPEED_SET.has(value)) {
    return value as Stage3Segment["speed"];
  }
  return 1;
}

function normalizeStage3CameraMotion(value: unknown): Stage3CameraMotion {
  if (value === "top_to_bottom" || value === "bottom_to_top" || value === "disabled") {
    return value;
  }
  return "disabled";
}

function normalizeClientSegments(
  segments: Stage3Segment[],
  sourceDurationSec: number | null
): Stage3Segment[] {
  return segments
    .map((segment, index) => {
      const startSec =
        typeof segment.startSec === "number" && Number.isFinite(segment.startSec)
          ? Math.max(0, segment.startSec)
          : null;
      if (startSec === null) {
        return null;
      }
      const rawEnd =
        segment.endSec === null
          ? sourceDurationSec ?? startSec + 0.5
          : typeof segment.endSec === "number" && Number.isFinite(segment.endSec)
            ? segment.endSec
            : startSec + 0.5;
      const cappedEnd =
        sourceDurationSec === null ? rawEnd : Math.min(Math.max(startSec + 0.1, rawEnd), sourceDurationSec);
      return {
        startSec: roundStage3Tenth(startSec),
        endSec: roundStage3Tenth(Math.max(startSec + 0.1, cappedEnd)),
        speed: normalizeStage3SegmentSpeed(segment.speed),
        label:
          typeof segment.label === "string" && segment.label.trim()
            ? segment.label.trim()
            : `Фрагмент ${index + 1}`
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
    .sort((left, right) => left.startSec - right.startSec)
    .slice(0, 12)
    .map((segment, index) => ({
      ...segment,
      label: segment.label || `Фрагмент ${index + 1}`
    }));
}

function sumClientSegmentsDuration(
  segments: Stage3Segment[],
  sourceDurationSec: number | null
): number {
  return segments.reduce((total, segment) => {
    const endSec = segment.endSec ?? sourceDurationSec ?? segment.startSec;
    return total + Math.max(0, endSec - segment.startSec) / normalizeStage3SegmentSpeed(segment.speed);
  }, 0);
}

function trimClientSegmentsToDuration(
  segments: Stage3Segment[],
  targetDurationSec: number,
  sourceDurationSec: number | null
): Stage3Segment[] {
  let remaining = targetDurationSec;
  const trimmed: Stage3Segment[] = [];

  for (const segment of normalizeClientSegments(segments, sourceDurationSec)) {
    if (remaining <= 0.05) {
      break;
    }
    const endSec = segment.endSec ?? sourceDurationSec ?? segment.startSec;
    const duration = Math.max(0.1, endSec - segment.startSec);
    const keepDuration = Math.min(duration, remaining * segment.speed);
    trimmed.push({
      ...segment,
      endSec: roundStage3Tenth(segment.startSec + keepDuration)
    });
    remaining -= keepDuration / segment.speed;
  }

  return normalizeClientSegments(trimmed, sourceDurationSec);
}

function getEditingPolicy(
  segments: Stage3Segment[],
  compressionEnabled: boolean
): Stage3RenderPlan["policy"] {
  if (segments.length > 0) {
    return "fixed_segments";
  }
  return compressionEnabled ? "full_source_normalize" : "fixed_segments";
}

function stripRenderPlanForPreview(plan: Stage3RenderPlan): Stage3RenderPlan {
  const fallback = fallbackRenderPlan();
  return {
    ...fallback,
    targetDurationSec: plan.targetDurationSec,
    timingMode: plan.timingMode,
    audioMode: plan.audioMode,
    sourceAudioEnabled: plan.sourceAudioEnabled,
    smoothSlowMo: plan.smoothSlowMo,
    segments: plan.segments,
    policy: plan.policy,
    // Keep preview lightweight and stable: only transport fields that affect the server preview file.
    prompt: "",
    musicGain: plan.musicGain,
    musicAssetId: plan.musicAssetId,
    musicAssetMimeType: plan.musicAssetMimeType
  };
}

function normalizeRenderPlan(value: unknown, fallback?: Stage3RenderPlan): Stage3RenderPlan {
  const candidate = value && typeof value === "object" ? (value as Partial<Stage3RenderPlan>) : undefined;
  const base = fallback ?? fallbackRenderPlan();
  const segments = Array.isArray(candidate?.segments)
    ? candidate.segments
        .map((segment) => {
          if (!segment || typeof segment !== "object") {
            return null;
          }
          const startSec =
            typeof segment.startSec === "number" && Number.isFinite(segment.startSec)
              ? segment.startSec
              : null;
          const endSec =
            segment.endSec === null
              ? null
              : typeof segment.endSec === "number" && Number.isFinite(segment.endSec)
                ? segment.endSec
                : null;
          if (startSec === null) {
            return null;
          }
          return {
            startSec,
            endSec,
            speed: normalizeStage3SegmentSpeed(segment.speed),
            label:
              typeof segment.label === "string" && segment.label.trim()
                ? segment.label
                : `${startSec.toFixed(1)}-${endSec === null ? "end" : endSec.toFixed(1)}`
          };
        })
        .filter(
          (segment): segment is { startSec: number; endSec: number | null; speed: Stage3Segment["speed"]; label: string } =>
            Boolean(segment)
        )
    : base.segments;

  return {
    targetDurationSec: 6,
    timingMode:
      candidate?.timingMode === "auto" ||
      candidate?.timingMode === "compress" ||
      candidate?.timingMode === "stretch"
        ? candidate.timingMode
        : base.timingMode,
    audioMode:
      candidate?.audioMode === "source_only" || candidate?.audioMode === "source_plus_music"
        ? candidate.audioMode
        : base.audioMode,
    sourceAudioEnabled: Boolean(candidate?.sourceAudioEnabled ?? base.sourceAudioEnabled),
    smoothSlowMo: Boolean(candidate?.smoothSlowMo ?? base.smoothSlowMo),
    mirrorEnabled: Boolean(candidate?.mirrorEnabled ?? base.mirrorEnabled),
    cameraMotion: normalizeStage3CameraMotion(candidate?.cameraMotion ?? base.cameraMotion),
    videoZoom:
      typeof candidate?.videoZoom === "number" && Number.isFinite(candidate.videoZoom)
        ? Math.min(STAGE3_MAX_VIDEO_ZOOM, Math.max(STAGE3_MIN_VIDEO_ZOOM, candidate.videoZoom))
        : base.videoZoom,
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
    policy:
      candidate?.policy === "adaptive_window" ||
      candidate?.policy === "full_source_normalize" ||
      candidate?.policy === "fixed_segments"
        ? candidate.policy
        : base.policy,
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

function shorten(value: string, max = 54): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}...`;
}

function formatStage3Status(value: Stage3SessionStatus): string {
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

function formatStage3StopReason(value: Stage3IterationStopReason | null | undefined): string {
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

function formatStage3Operation(op: string): string {
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

function formatSourceProviderLabel(provider: "visolix" | "ytDlp" | null | undefined): string | null {
  if (provider === "visolix") {
    return "Visolix";
  }
  if (provider === "ytDlp") {
    return "локальный fallback-загрузчик";
  }
  return null;
}

function mergeStage3Versions(groups: Stage3Version[][]): Stage3Version[] {
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

function buildStage3AgentConversation(
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

export default function HomePage() {
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"ok" | "error" | "">("");
  const [isBusy, setIsBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [authState, setAuthState] = useState<AuthMeResponse | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const [draftUrl, setDraftUrl] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [workspaceStage2ExamplesCorpusJson, setWorkspaceStage2ExamplesCorpusJson] = useState("[]");
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [channelAssets, setChannelAssets] = useState<ChannelAsset[]>([]);
  const [channelAccessGrants, setChannelAccessGrants] = useState<ChannelAccessGrant[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<Array<{ user: UserRecord; role: AppRole }>>([]);
  const [isChannelManagerOpen, setIsChannelManagerOpen] = useState(false);
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [activeChat, setActiveChat] = useState<ChatThread | null>(null);
  const [activeDraft, setActiveDraft] = useState<ChatDraft | null>(null);

  const [codexAuth, setCodexAuth] = useState<CodexAuthResponse | null>(null);
  const [isCodexAuthLoading, setIsCodexAuthLoading] = useState(false);
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilitiesResponse | null>(null);

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [stage2Instruction, setStage2Instruction] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [selectedTitleOption, setSelectedTitleOption] = useState<number | null>(null);
  const [stage3TopText, setStage3TopText] = useState("");
  const [stage3BottomText, setStage3BottomText] = useState("");
  const [stage3ClipStartSec, setStage3ClipStartSec] = useState(0);
  const [stage3FocusY, setStage3FocusY] = useState(0.5);
  const [stage3RenderPlan, setStage3RenderPlan] = useState<Stage3RenderPlan>(fallbackRenderPlan());
  const [sourceDurationSec, setSourceDurationSec] = useState<number | null>(null);
  const [stage3PreviewVideoUrl, setStage3PreviewVideoUrl] = useState<string | null>(null);
  const [stage3PreviewState, setStage3PreviewState] = useState<Stage3PreviewState>("idle");
  const [stage3PreviewNotice, setStage3PreviewNotice] = useState<string | null>(null);
  const [stage3PreviewJobId, setStage3PreviewJobId] = useState<string | null>(null);
  const [stage3Workers, setStage3Workers] = useState<Stage3WorkerSummary[]>([]);
  const [stage3WorkerPairing, setStage3WorkerPairing] = useState<Stage3WorkerPairingResponse | null>(null);
  const [isStage3WorkerPairing, setIsStage3WorkerPairing] = useState(false);
  const [stage3AgentPrompt, setStage3AgentPrompt] = useState("");
  const [stage3AgentSessionId, setStage3AgentSessionId] = useState<string | null>(null);
  const [stage3AgentTimeline, setStage3AgentTimeline] = useState<Stage3TimelineResponse | null>(null);
  const [isStage3TimelineLoading, setIsStage3TimelineLoading] = useState(false);
  const [ignoreStage3ChatSessionRef, setIgnoreStage3ChatSessionRef] = useState(false);
  const [stage3SelectedVersionId, setStage3SelectedVersionId] = useState<string | null>(null);
  const [stage3PassSelectionByVersion, setStage3PassSelectionByVersion] = useState<Record<string, number>>({});
  const [stage3RenderState, setStage3RenderState] = useState<Stage3RenderState>("idle");
  const [stage3RenderJobId, setStage3RenderJobId] = useState<string | null>(null);
  const [stage2ExpectedDurationMs, setStage2ExpectedDurationMs] = useState(
    DEFAULT_STAGE2_EXPECTED_DURATION_MS
  );
  const [stage2Runs, setStage2Runs] = useState<Stage2RunSummary[]>([]);
  const [stage2RunDetail, setStage2RunDetail] = useState<Stage2RunDetail | null>(null);
  const [stage2ElapsedMs, setStage2ElapsedMs] = useState(0);
  const [stage2RunId, setStage2RunId] = useState<string | null>(null);
  const [isStage2Enqueueing, setIsStage2Enqueueing] = useState(false);
  const autoAppliedCaptionRef = useRef<{
    chatId: string;
    option: number | null;
    top: string;
    bottom: string;
  } | null>(null);
  const initializedStage3ChatRef = useRef<string | null>(null);
  const previousChannelIdRef = useRef<string | null>(null);
  const stage3PreviewCacheRef = useRef<Map<string, { url: string; createdAt: number }>>(new Map());
  const stage3PreviewRequestKeyRef = useRef<string>("");
  const stage3PreviewRequestIdRef = useRef(0);
  const stage3LastGoodPreviewAtRef = useRef<number | null>(null);
  const restoringFlowShellStateRef = useRef<PersistedFlowShellState | null>(null);
  const stage2ProgressPollIdRef = useRef(0);
  const stage2RunsRequestVersionsRef = useRef<Record<string, number>>({});
  const stage2SelectionSourceRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const activeChatRef = useRef<ChatThread | null>(null);
  const activeDraftRef = useRef<ChatDraft | null>(null);
  const stage3RenderContextRef = useRef<{
    chatId: string;
    snapshot: Stage3StateSnapshot;
    renderTitle: string | null;
  } | null>(null);
  const stage3RenderPollIdRef = useRef(0);
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftInFlightRef = useRef<Promise<void> | null>(null);
  const draftPayloadJsonRef = useRef<string>("");

  const codexLoggedIn = Boolean(codexAuth?.loggedIn);
  const codexRunning = codexAuth?.deviceAuth.status === "running";
  const currentRole = authState?.membership.role ?? null;
  const canManageCodex = Boolean(authState?.effectivePermissions.canManageCodex);
  const canCreateChannel = Boolean(authState?.effectivePermissions.canCreateChannel);
  const fetchSourceAvailable = runtimeCapabilities?.features.fetchSource ?? true;
  const downloadSourceAvailable = runtimeCapabilities?.features.downloadSource ?? true;
  const sharedCodexAvailable = runtimeCapabilities?.features.sharedCodex ?? true;
  const stage2RuntimeAvailable = runtimeCapabilities?.features.stage2 ?? true;
  const stage3LocalExecutorAvailable =
    runtimeCapabilities?.features.stage3LocalExecutor ?? process.env.NODE_ENV === "production";
  const codexBlockedReason = runtimeCapabilities?.tools.codex.message ?? null;
  const sourceAcquisitionBlockedReason = runtimeCapabilities
    ? [
        runtimeCapabilities.tools.visolix.message,
        runtimeCapabilities.tools.ytDlp.message
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
    : null;
  const fetchSourceBlockedReason = sourceAcquisitionBlockedReason;
  const downloadSourceBlockedReason = sourceAcquisitionBlockedReason;
  const effectiveCodexBlockedReason = codexRunning
    ? "Device auth уже запущен. Завершите его или сначала отмените."
    : codexBlockedReason;
  const stage2BlockedReason =
    !sharedCodexAvailable
      ? codexBlockedReason
      : !codexLoggedIn
        ? codexRunning
          ? "Идет device auth Shared Codex. Завершите вход в браузере и затем нажмите «Обновить»."
          : canManageCodex
            ? "Shared Codex еще не подключен. Нажмите «Подключить», завершите device auth и затем нажмите «Обновить»."
            : "Shared Codex недоступен — обратитесь к владельцу."
      : !stage2RuntimeAvailable
        ? sourceAcquisitionBlockedReason ??
          runtimeCapabilities?.tools.ffmpeg.message ??
          runtimeCapabilities?.tools.ffprobe.message ??
          "Среда выполнения Stage 2 недоступна на этом деплое."
        : null;
  const codexStatusLabel = codexLoggedIn
    ? "Shared Codex подключен"
    : codexAuth?.deviceAuth.status === "running"
      ? "Shared Codex ожидает вход"
      : codexAuth?.deviceAuth.status === "error"
        ? "Ошибка входа Shared Codex"
        : sharedCodexAvailable
          ? "Shared Codex не подключен"
          : "Среда выполнения Codex недоступна";
  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId]
  );
  const stage3BackgroundUrl =
    activeChannelId && stage3RenderPlan.backgroundAssetId
      ? buildChannelAssetUrl(activeChannelId, stage3RenderPlan.backgroundAssetId)
      : null;
  const stage3AvatarUrl =
    activeChannelId && stage3RenderPlan.avatarAssetId
      ? buildChannelAssetUrl(activeChannelId, stage3RenderPlan.avatarAssetId)
      : null;
  const backgroundOptions = useMemo(
    () => channelAssets.filter((asset) => asset.kind === "background"),
    [channelAssets]
  );
  const musicOptions = useMemo(
    () => channelAssets.filter((asset) => asset.kind === "music"),
    [channelAssets]
  );
  const stage3RenderInProgress = stage3RenderState === "queued" || stage3RenderState === "rendering";
  const activeStage3Worker = useMemo(
    () => stage3Workers.find((worker) => worker.status !== "offline") ?? stage3Workers[0] ?? null,
    [stage3Workers]
  );
  const stage3WorkerPanelState = activeStage3Worker?.status ?? (stage3Workers.length > 0 ? "offline" : "not_paired");

  useEffect(() => {
    activeChatIdRef.current = activeChat?.id ?? null;
  }, [activeChat?.id]);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    activeDraftRef.current = activeDraft;
  }, [activeDraft]);

  const parseError = useCallback(async (response: Response, fallback: string): Promise<string> => {
    const contentType = responseContentType(response);
    let raw = fallback;

    if (contentType.includes("application/json")) {
      const body = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: string;
            recoverable?: boolean;
            retryAfterSec?: number | null;
          }
        | null;
      raw = body?.message ?? body?.error ?? fallback;
    } else {
      raw = (await response.text().catch(() => fallback)) || fallback;
    }

    if (raw === fallback && response.headers.get("x-stage3-worker-update-required") === "1") {
      const requiredVersion = response.headers.get("x-stage3-worker-required-version");
      raw = requiredVersion
        ? `Текущий локальный executor устарел. Требуется runtime ${requiredVersion}. Обновите worker через bootstrap и повторите попытку.`
        : "Текущий локальный executor устарел. Обновите worker через bootstrap и повторите попытку.";
    }

    return summarizeUserFacingError(raw);
  }, []);

  const getUiErrorMessage = useCallback(
    (error: unknown, fallback: string): string => {
      if (error instanceof Error && error.message.trim()) {
        return summarizeUserFacingError(error.message);
      }

      return summarizeUserFacingError(fallback);
    },
    []
  );

  const getDraftStorageKey = useCallback(
    (chatId: string): string | null => {
      const workspaceId = authState?.workspace.id;
      const userId = authState?.user.id;
      if (!workspaceId || !userId || !chatId) {
        return null;
      }
      return `clips-chat-draft:${workspaceId}:${userId}:${chatId}`;
    },
    [authState?.user.id, authState?.workspace.id]
  );

  const getFlowShellStorageKey = useCallback((): string | null => {
    return buildScopedStorageKey("clips-flow-shell", authState?.workspace.id, authState?.user.id);
  }, [authState?.user.id, authState?.workspace.id]);

  const readFlowShellState = useCallback(
    (workspaceId?: string, userId?: string): PersistedFlowShellState | null => {
      const key = buildScopedStorageKey(
        "clips-flow-shell",
        workspaceId ?? authState?.workspace.id,
        userId ?? authState?.user.id
      );
      if (!key || typeof window === "undefined") {
        return null;
      }
      try {
        return normalizePersistedFlowShellState(JSON.parse(window.localStorage.getItem(key) ?? "null"));
      } catch {
        return null;
      }
    },
    [authState?.user.id, authState?.workspace.id]
  );

  const writeFlowShellState = useCallback(
    (state: PersistedFlowShellState): void => {
      const key = getFlowShellStorageKey();
      if (!key || typeof window === "undefined") {
        return;
      }
      window.localStorage.setItem(key, JSON.stringify(state));
    },
    [getFlowShellStorageKey]
  );

  const getStage2DurationStorageKey = useCallback((): string | null => {
    return buildScopedStorageKey("clips-stage2-duration", authState?.workspace.id, authState?.user.id);
  }, [authState?.user.id, authState?.workspace.id]);

  const readStage2DurationMetric = useCallback(
    (workspaceId?: string, userId?: string): number => {
      const key = buildScopedStorageKey(
        "clips-stage2-duration",
        workspaceId ?? authState?.workspace.id,
        userId ?? authState?.user.id
      );
      if (!key || typeof window === "undefined") {
        return DEFAULT_STAGE2_EXPECTED_DURATION_MS;
      }
      try {
        return (
          normalizeStage2DurationMetric(JSON.parse(window.localStorage.getItem(key) ?? "null")) ??
          DEFAULT_STAGE2_EXPECTED_DURATION_MS
        );
      } catch {
        return DEFAULT_STAGE2_EXPECTED_DURATION_MS;
      }
    },
    [authState?.user.id, authState?.workspace.id]
  );

  const writeStage2DurationMetric = useCallback(
    (durationMs: number): void => {
      const key = getStage2DurationStorageKey();
      if (!key || typeof window === "undefined") {
        return;
      }
      window.localStorage.setItem(
        key,
        JSON.stringify({
          lastDurationMs: Math.min(5 * 60_000, Math.max(1_000, Math.round(durationMs))),
          updatedAt: new Date().toISOString()
        })
      );
    },
    [getStage2DurationStorageKey]
  );

  const readLocalDraftCache = useCallback(
    (chatId: string): ChatDraft | null => {
      const key = getDraftStorageKey(chatId);
      if (!key || typeof window === "undefined") {
        return null;
      }
      try {
        return normalizeChatDraft(JSON.parse(window.localStorage.getItem(key) ?? "null"));
      } catch {
        return null;
      }
    },
    [getDraftStorageKey]
  );

  const writeLocalDraftCache = useCallback(
    (draft: ChatDraft | null): void => {
      if (!draft || typeof window === "undefined") {
        return;
      }
      const key = getDraftStorageKey(draft.threadId);
      if (!key) {
        return;
      }
      window.localStorage.setItem(key, JSON.stringify(draft));
    },
    [getDraftStorageKey]
  );

  const patchChatListItem = useCallback((nextItem: ChatListItem): void => {
    setChatList((prev) => {
      const currentIndex = prev.findIndex((item) => item.id === nextItem.id);
      if (currentIndex === 0 && equalChatListItem(prev[0]!, nextItem)) {
        return prev;
      }
      const without = prev.filter((item) => item.id !== nextItem.id);
      const nextList = [nextItem, ...without];
      return equalChatList(prev, nextList) ? prev : nextList;
    });
  }, []);

  const refreshAuthState = useCallback(async (): Promise<AuthMeResponse> => {
    const response = await fetch("/api/auth/me");
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = "/login";
      }
      throw new Error(await parseError(response, "Не удалось загрузить состояние авторизации."));
    }
    const body = (await response.json()) as AuthMeResponse;
    setAuthState(body);
    return body;
  }, [parseError]);

  const refreshRuntimeCapabilities = useCallback(async (): Promise<RuntimeCapabilitiesResponse> => {
    const response = await fetch("/api/runtime/capabilities");
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось проверить возможности среды выполнения."));
    }
    const body = (await response.json()) as RuntimeCapabilitiesResponse;
    setRuntimeCapabilities(body);
    return body;
  }, [parseError]);

  const refreshStage3Workers = useCallback(async (): Promise<Stage3WorkerSummary[]> => {
    if (!stage3LocalExecutorAvailable) {
      setStage3Workers([]);
      return [];
    }
    const response = await fetch("/api/stage3/workers");
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить локальные Stage 3 executors."));
    }
    const body = (await response.json()) as Stage3WorkerListResponse;
    setStage3Workers(body.workers ?? []);
    return body.workers ?? [];
  }, [parseError, stage3LocalExecutorAvailable]);

  const createStage3WorkerPairing = useCallback(async (): Promise<void> => {
    if (!stage3LocalExecutorAvailable) {
      setStage3WorkerPairing(null);
      setStage3Workers([]);
      setStatusType("ok");
      setStatus("На localhost локальный executor отключен. Stage 3 выполняется прямо на хосте.");
      return;
    }
    setIsStage3WorkerPairing(true);
    try {
      const response = await fetch("/api/stage3/workers/pairing", {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось создать pairing token локального executor."));
      }
      const body = (await response.json()) as Stage3WorkerPairingResponse;
      const browserOrigin =
        typeof window !== "undefined" && window.location.origin
          ? window.location.origin.replace(/\/+$/, "")
          : body.serverOrigin;
      setStage3WorkerPairing({
        ...body,
        serverOrigin: browserOrigin,
        commands: buildStage3WorkerCommands({
          origin: browserOrigin,
          pairingToken: body.pairingToken
        })
      });
      setStatusType("ok");
      setStatus("Pairing token создан. Запустите локальный Stage 3 worker на своей машине.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось подготовить локальный executor."));
    } finally {
      setIsStage3WorkerPairing(false);
    }
  }, [getUiErrorMessage, parseError, stage3LocalExecutorAvailable]);

  const applyChannelToRenderPlan = useCallback(
    (channel: Channel | null, assets: ChannelAsset[] = []): Stage3RenderPlan => {
      const base = fallbackRenderPlan();
      if (!channel) {
        return base;
      }
      const resolvedTemplateId = channel.templateId || STAGE3_TEMPLATE_ID;
      const useBuiltInBackdrop = templateUsesBuiltInBackdropFromRegistry(resolvedTemplateId);
      const avatar = findAssetById(assets, channel.avatarAssetId);
      const background = useBuiltInBackdrop
        ? null
        : findAssetById(assets, channel.defaultBackgroundAssetId);
      const music = findAssetById(assets, channel.defaultMusicAssetId);
      return normalizeRenderPlan(
        {
          ...base,
          templateId: resolvedTemplateId,
          authorName: channel.name || base.authorName,
          authorHandle: channel.username.startsWith("@")
            ? channel.username
            : `@${channel.username || "channel"}`,
          avatarAssetId: channel.avatarAssetId,
          avatarAssetMimeType: avatar?.mimeType ?? null,
          backgroundAssetId: useBuiltInBackdrop ? null : channel.defaultBackgroundAssetId,
          backgroundAssetMimeType: background?.mimeType ?? null,
          musicAssetId: channel.defaultMusicAssetId,
          musicAssetMimeType: music?.mimeType ?? null,
          audioMode: channel.defaultMusicAssetId ? "source_plus_music" : base.audioMode
        },
        base
      );
    },
    []
  );

  const hydrateChatEditorState = useCallback(
    (chat: ChatThread | null, draft: ChatDraft | null): void => {
      if (!chat) {
        initializedStage3ChatRef.current = null;
        setCurrentStep(1);
        setStage2Instruction("");
        setSelectedOption(null);
        setSelectedTitleOption(null);
        setStage3TopText("");
        setStage3BottomText("");
        setStage3ClipStartSec(0);
        setStage3FocusY(0.5);
        setStage3RenderPlan(applyChannelToRenderPlan(activeChannel, channelAssets));
        setSourceDurationSec(null);
        setStage3AgentPrompt("");
        setStage3AgentSessionId(null);
        setStage3AgentTimeline(null);
        setIgnoreStage3ChatSessionRef(false);
        setStage3SelectedVersionId(null);
        setStage3PassSelectionByVersion({});
        autoAppliedCaptionRef.current = null;
        stage3PreviewRequestKeyRef.current = "";
        stage3PreviewRequestIdRef.current += 1;
        setStage3PreviewVideoUrl(null);
        setStage3PreviewState("idle");
        setStage3PreviewNotice(null);
        setStage3PreviewJobId(null);
        setStage3RenderState("idle");
        setStage3RenderJobId(null);
        return;
      }

      const stage2Event = extractStage2Payload(
        [...chat.events].reverse().find((event) => event.type === "stage2" && event.role === "assistant")?.data
      );
      const preferredCaptionOption =
        draft?.stage2.selectedCaptionOption ?? stage2Event?.output.finalPick.option ?? null;
      const preferredTitleOption =
        draft?.stage2.selectedTitleOption ?? stage2Event?.output.titleOptions[0]?.option ?? null;
      const selectedCaptionForHydration = stage2Event
        ? stage2Event.output.captionOptions.find((item) => item.option === preferredCaptionOption) ??
          stage2Event.output.captionOptions[0] ??
          null
        : null;
      const legacyVersions = buildLegacyTimelineEntries(
        chat.events
          .filter((event) => event.type === "note" && event.role === "assistant")
          .map((event) => ({
            id: event.id,
            createdAt: event.createdAt,
            data: event.data
          }))
      );
      const latestVersion = legacyVersions[legacyVersions.length - 1] ?? null;
      const defaults = getDefaultDraftState(chat);
      const baseRenderPlan = latestVersion
        ? normalizeRenderPlan(latestVersion.final.renderPlan, fallbackRenderPlan())
        : applyChannelToRenderPlan(activeChannel, channelAssets);
      const nextRenderPlan = draft?.stage3.renderPlan
        ? normalizeRenderPlan(draft.stage3.renderPlan, baseRenderPlan)
        : baseRenderPlan;

      const nextTopText = draft?.stage3.topText ?? latestVersion?.final.topText ?? selectedCaptionForHydration?.top ?? "";
      const nextBottomText =
        draft?.stage3.bottomText ?? latestVersion?.final.bottomText ?? selectedCaptionForHydration?.bottom ?? "";
      const hydratedFromSelectedCaption =
        Boolean(selectedCaptionForHydration) &&
        nextTopText === (selectedCaptionForHydration?.top ?? "") &&
        nextBottomText === (selectedCaptionForHydration?.bottom ?? "");

      initializedStage3ChatRef.current = chat.id;
      setCurrentStep(getPreferredStepForChat(chat, draft));
      setStage2Instruction(draft?.stage2.instruction ?? "");
      setSelectedOption(preferredCaptionOption);
      setSelectedTitleOption(preferredTitleOption);
      setStage3TopText(nextTopText);
      setStage3BottomText(nextBottomText);
      setStage3ClipStartSec(draft?.stage3.clipStartSec ?? latestVersion?.final.clipStartSec ?? 0);
      setStage3FocusY(draft?.stage3.focusY ?? latestVersion?.final.focusY ?? 0.5);
      setStage3RenderPlan(nextRenderPlan);
      setSourceDurationSec(latestVersion?.final.sourceDurationSec ?? null);
      setStage3AgentPrompt(
        draft?.stage3.agentPrompt.trim() ||
          latestVersion?.prompt.trim() ||
          defaults.agentPrompt.trim() ||
          ""
      );
      setStage3AgentSessionId(findLatestStage3AgentSessionRef(chat.events)?.sessionId ?? null);
      setStage3AgentTimeline(null);
      setIgnoreStage3ChatSessionRef(false);
      setStage3SelectedVersionId(draft?.stage3.selectedVersionId ?? defaults.selectedVersionId ?? null);
      setStage3PassSelectionByVersion(
        Object.keys(draft?.stage3.passSelectionByVersion ?? {}).length > 0
          ? draft?.stage3.passSelectionByVersion ?? {}
          : defaults.passSelectionByVersion
      );
      autoAppliedCaptionRef.current = hydratedFromSelectedCaption
        ? {
            chatId: chat.id,
            option: selectedCaptionForHydration?.option ?? null,
            top: nextTopText,
            bottom: nextBottomText
          }
        : null;
      stage3PreviewRequestKeyRef.current = "";
      stage3PreviewRequestIdRef.current += 1;
      setStage3PreviewVideoUrl(null);
      setStage3PreviewState("idle");
      setStage3PreviewNotice(null);
      setStage3PreviewJobId(null);
      setStage3RenderState("idle");
      setStage3RenderJobId(null);
    },
    [activeChannel, applyChannelToRenderPlan, channelAssets]
  );

  const refreshChannels = useCallback(async (preferredChannelId?: string | null): Promise<Channel[]> => {
    const response = await fetch("/api/channels");
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить каналы."));
    }
    const body = (await response.json()) as {
      channels: Channel[];
      workspaceStage2ExamplesCorpusJson?: string;
    };
    const nextChannels = body.channels ?? [];
    setWorkspaceStage2ExamplesCorpusJson(body.workspaceStage2ExamplesCorpusJson ?? "[]");
    setChannels(nextChannels);
    setActiveChannelId((prev) => {
      if (prev && nextChannels.some((channel) => channel.id === prev)) {
        return prev;
      }
      if (preferredChannelId && nextChannels.some((channel) => channel.id === preferredChannelId)) {
        return preferredChannelId;
      }
      return nextChannels[0]?.id ?? null;
    });
    return nextChannels;
  }, [parseError]);

  const refreshChannelAssets = useCallback(async (channelId: string): Promise<ChannelAsset[]> => {
    const response = await fetch(`/api/channels/${channelId}/assets`);
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить ассеты канала."));
    }
    const body = (await response.json()) as { assets: ChannelAsset[] };
    const nextAssets = body.assets ?? [];
    setChannelAssets(nextAssets);
    return nextAssets;
  }, []);

  const refreshWorkspaceMembers = useCallback(async (): Promise<void> => {
    if (!authState?.effectivePermissions.canManageMembers) {
      setWorkspaceMembers([]);
      return;
    }
    const response = await fetch("/api/workspace/members");
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить участников рабочего пространства."));
    }
    const body = (await response.json()) as {
      members: Array<{ role: AppRole; user: UserRecord }>;
    };
    setWorkspaceMembers(body.members ?? []);
  }, [authState?.effectivePermissions.canManageMembers, parseError]);

  const refreshChannelAccess = useCallback(async (channelId: string): Promise<void> => {
    if (!authState?.effectivePermissions.canManageAnyChannelAccess) {
      setChannelAccessGrants([]);
      return;
    }
    const response = await fetch(`/api/channels/${channelId}/access`);
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить доступ к каналу."));
    }
    const body = (await response.json()) as { grants: ChannelAccessGrant[] };
    setChannelAccessGrants(body.grants ?? []);
  }, [authState?.effectivePermissions.canManageAnyChannelAccess, parseError]);

  const refreshChats = useCallback(async (): Promise<ChatListItem[]> => {
    const query = activeChannelId ? `?channelId=${encodeURIComponent(activeChannelId)}` : "";
    const response = await fetch(`/api/chats${query}`);
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить историю."));
    }
    const body = (await response.json()) as { chats: ChatListItem[] };
    const nextChats = body.chats ?? [];
    setChatList((prev) => (equalChatList(prev, nextChats) ? prev : nextChats));
    setActiveChat((prev) => {
      if (!prev) {
        return prev;
      }
      return nextChats.some((chat) => chat.id === prev.id) ? prev : null;
    });
    setActiveDraft((prev) => {
      if (!prev) {
        return prev;
      }
      return nextChats.some((chat) => chat.id === prev.threadId) ? prev : null;
    });
    return nextChats;
  }, [activeChannelId, parseError]);

  const refreshActiveChat = useCallback(async (chatId: string): Promise<{ chat: ChatThread; draft: ChatDraft | null }> => {
    const response = await fetch(`/api/chats/${chatId}`);
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить элемент."));
    }
    const body = (await response.json()) as { chat: ChatThread; draft: ChatDraft | null };
    const localDraft = readLocalDraftCache(chatId);
    const serverDraft = body.draft ? normalizeChatDraft(body.draft) : null;
    const resolvedDraft =
      localDraft &&
      (!serverDraft ||
        new Date(localDraft.updatedAt).getTime() > new Date(serverDraft.updatedAt).getTime())
        ? localDraft
        : serverDraft;
    const shouldHydrate =
      !equalChatThread(activeChatRef.current, body.chat) ||
      !equalChatDraft(activeDraftRef.current, resolvedDraft);

    activeChatIdRef.current = body.chat.id;
    activeChatRef.current = body.chat;
    activeDraftRef.current = resolvedDraft;
    setActiveChat((prev) => (equalChatThread(prev, body.chat) ? prev : body.chat));
    setActiveDraft((prev) => (equalChatDraft(prev, resolvedDraft) ? prev : resolvedDraft));
    draftPayloadJsonRef.current = resolvedDraft
      ? JSON.stringify({
          lastOpenStep: resolvedDraft.lastOpenStep,
          stage2: resolvedDraft.stage2,
          stage3: resolvedDraft.stage3
        })
      : "";
    patchChatListItem(buildChatListItem(body.chat, resolvedDraft));
    if (shouldHydrate) {
      hydrateChatEditorState(body.chat, resolvedDraft);
    }
    return { chat: body.chat, draft: resolvedDraft };
  }, [hydrateChatEditorState, parseError, patchChatListItem, readLocalDraftCache]);

  const refreshStage2RunsForChat = useCallback(async (
    chatId: string,
    options?: { signal?: AbortSignal }
  ): Promise<Stage2RunSummary[]> => {
    const issued = issueScopedRequestVersion(stage2RunsRequestVersionsRef.current, chatId);
    stage2RunsRequestVersionsRef.current = issued.nextVersions;
    const response = await fetch(`/api/pipeline/stage2?chatId=${encodeURIComponent(chatId)}`, {
      cache: "no-store",
      signal: options?.signal
    });
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить Stage 2 runs."));
    }
    const body = (await response.json()) as { runs?: Stage2RunSummary[] };
    const nextRuns = body.runs ?? [];
    if (
      !matchesScopedRequestVersion(stage2RunsRequestVersionsRef.current, chatId, issued.version) ||
      activeChatIdRef.current !== chatId
    ) {
      return nextRuns;
    }
    setStage2Runs((prev) => (equalStage2RunSummaries(prev, nextRuns) ? prev : nextRuns));
    return nextRuns;
  }, [parseError]);

  const refreshStage2RunDetail = useCallback(async (
    runId: string,
    options?: { signal?: AbortSignal }
  ): Promise<Stage2RunDetail | null> => {
    const response = await fetch(`/api/pipeline/stage2?runId=${encodeURIComponent(runId)}`, {
      cache: "no-store",
      signal: options?.signal
    });
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить Stage 2 run."));
    }
    const body = (await response.json()) as { run?: Stage2RunDetail | null };
    return body.run ?? null;
  }, [parseError]);

  const appendEvent = useCallback(async (
    chatId: string,
    event: { role: ChatEvent["role"]; type: ChatEvent["type"]; text: string; data?: unknown }
  ): Promise<void> => {
    const response = await fetch(`/api/chats/${chatId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event)
    });
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось сохранить событие."));
    }
    const body = (await response.json()) as { chat: ChatThread };
    setActiveChat(body.chat);
    patchChatListItem(
      buildChatListItem(body.chat, activeChat?.id === body.chat.id ? activeDraft : null)
    );
  }, [activeChat?.id, activeDraft, parseError, patchChatListItem]);

  const loadStage3AgentTimeline = useCallback(
    async (sessionId: string): Promise<Stage3TimelineResponse> => {
      setIsStage3TimelineLoading(true);
      try {
        const response = await fetch(`/api/stage3/agent/${sessionId}/timeline`);
        if (!response.ok) {
          throw new Error(await parseError(response, "Не удалось загрузить timeline агента Stage 3."));
        }
        const body = (await response.json()) as Stage3TimelineResponse;
        setStage3AgentSessionId(body.session.id);
        setStage3AgentTimeline(body);
        return body;
      } finally {
        setIsStage3TimelineLoading(false);
      }
    },
    [parseError]
  );

  const appendStage3AgentSessionEvent = useCallback(
    async (
      chatId: string,
      payload: {
        sessionId: string;
        status?: Stage3SessionStatus;
        finalVersionId?: string | null;
        bestVersionId?: string | null;
        summaryText: string;
      }
    ): Promise<void> => {
      await appendEvent(chatId, {
        role: "assistant",
        type: "note",
        text: payload.summaryText,
        data: {
          kind: "stage3-agent-session",
          sessionId: payload.sessionId,
          status: payload.status ?? null,
          currentVersionId: payload.finalVersionId ?? null,
          finalVersionId: payload.finalVersionId ?? null,
          bestVersionId: payload.bestVersionId ?? null
        }
      });
    },
    [appendEvent]
  );

  const refreshCodexAuth = useCallback(
    async (options?: { background?: boolean }): Promise<void> => {
      const background = options?.background ?? false;
      if (!background) {
        setBusyAction("refresh-codex");
        setIsCodexAuthLoading(true);
      }
      try {
        const response = await fetch("/api/codex/auth");
        if (!response.ok) {
          throw new Error(await parseError(response, "Не удалось загрузить статус Codex."));
        }
        const body = (await response.json()) as CodexAuthResponse;
        setCodexAuth((prev) => (equalCodexAuthResponse(prev, body) ? prev : body));
        setAuthState((prev) => {
          if (!prev) {
            return prev;
          }
          const nextSharedCodexStatus = buildSharedCodexStatus(
            body,
            prev.effectivePermissions.canManageCodex
          );
          if (equalSharedCodexStatus(prev.sharedCodexStatus, nextSharedCodexStatus)) {
            return prev;
          }
          return {
            ...prev,
            sharedCodexStatus: nextSharedCodexStatus
          };
        });
      } finally {
        if (!background) {
          setIsCodexAuthLoading(false);
          setBusyAction((prev) => (prev === "refresh-codex" ? "" : prev));
        }
      }
    },
    [parseError]
  );

  const startCodexDeviceAuth = async (): Promise<void> => {
    if (!canManageCodex) {
      setStatusType("error");
      setStatus("Интеграцией Shared Codex может управлять только владелец.");
      return;
    }
    if (!sharedCodexAvailable) {
      setStatusType("error");
      setStatus(codexBlockedReason ?? "Среда выполнения Codex недоступна на этом деплое.");
      return;
    }
    setBusyAction("connect-codex");
    setIsCodexAuthLoading(true);
    try {
      const response = await fetch("/api/codex/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "start" })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось запустить подключение Codex."));
      }
      const body = (await response.json()) as CodexAuthResponse;
      setCodexAuth(body);
      setStatusType("ok");
      setStatus("Подключение Shared Codex запущено. Завершите device auth и обновите статус.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось подключить Codex."));
    } finally {
      setIsCodexAuthLoading(false);
      setBusyAction("");
    }
  };

  const handleCodexSecondaryAction = async (): Promise<void> => {
    if (!canManageCodex) {
      return;
    }
    const action = codexAuth?.deviceAuth.status === "running" ? "cancel" : codexLoggedIn ? "disconnect" : null;
    if (!action) {
      return;
    }
    setBusyAction("connect-codex");
    try {
      const response = await fetch("/api/codex/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось обновить Shared Codex."));
      }
      const body = (await response.json()) as CodexAuthResponse;
      setCodexAuth(body);
      await refreshAuthState().catch(() => undefined);
      setStatusType("ok");
      setStatus(action === "cancel" ? "Device auth отменен." : "Shared Codex отключен.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось обновить Shared Codex."));
    } finally {
      setBusyAction("");
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const auth = await refreshAuthState();
        const restoredFlowShellState = readFlowShellState(auth.workspace.id, auth.user.id);
        restoringFlowShellStateRef.current = restoredFlowShellState;
        setStage2ExpectedDurationMs(readStage2DurationMetric(auth.workspace.id, auth.user.id));
        await refreshRuntimeCapabilities();
        await refreshCodexAuth({ background: true });
        await refreshChannels(restoredFlowShellState?.channelId ?? null);
      } catch (error) {
        setStatusType("error");
        setStatus(getUiErrorMessage(error, "Не удалось инициализировать приложение."));
      } finally {
        setIsAuthLoading(false);
      }
    })();
  }, [
    getUiErrorMessage,
    readFlowShellState,
    readStage2DurationMetric,
    refreshAuthState,
    refreshChannels,
    refreshCodexAuth,
    refreshRuntimeCapabilities
  ]);

  useEffect(() => {
    if (!authState?.workspace.id || !authState?.user.id) {
      return;
    }
    setStage2ExpectedDurationMs(readStage2DurationMetric());
  }, [authState?.user.id, authState?.workspace.id, readStage2DurationMetric]);

  useEffect(() => {
    if (!activeChannelId) {
      setChatList([]);
      setActiveChat(null);
      setActiveDraft(null);
      setChannelAccessGrants([]);
      return;
    }
    void refreshChats().catch(() => undefined);
    void refreshChannelAssets(activeChannelId).catch(() => undefined);
    void refreshChannelAccess(activeChannelId).catch(() => undefined);
  }, [activeChannelId]);

  useEffect(() => {
    const shell = restoringFlowShellStateRef.current;
    if (!shell || !activeChannelId) {
      return;
    }
    if (shell.channelId && shell.channelId !== activeChannelId) {
      return;
    }
    if (!shell.chatId) {
      restoringFlowShellStateRef.current = null;
      return;
    }
    if (activeChat?.id === shell.chatId) {
      restoringFlowShellStateRef.current = null;
      setCurrentStep(Math.min(shell.step, getMaxStepForChat(activeChat)) as 1 | 2 | 3);
      return;
    }
    if (!chatList.some((chat) => chat.id === shell.chatId)) {
      if (chatList.length > 0) {
        restoringFlowShellStateRef.current = null;
      }
      return;
    }
    restoringFlowShellStateRef.current = null;
    void (async () => {
      try {
        const { chat } = await refreshActiveChat(shell.chatId!);
        setCurrentStep(Math.min(shell.step, getMaxStepForChat(chat)) as 1 | 2 | 3);
      } catch {
        // Ignore restore failures and leave current selection untouched.
      }
    })();
  }, [activeChannelId, activeChat, chatList, refreshActiveChat]);

  useEffect(() => {
    if (isAuthLoading || !authState?.workspace.id || !authState?.user.id) {
      return;
    }
    const restoring = restoringFlowShellStateRef.current;
    if (
      restoring &&
      restoring.channelId === activeChannelId &&
      restoring.chatId &&
      !activeChat?.id
    ) {
      return;
    }
    writeFlowShellState({
      channelId: activeChannelId ?? null,
      chatId: activeChat?.id ?? null,
      step: currentStep
    });
  }, [
    activeChannelId,
    activeChat?.id,
    isAuthLoading,
    authState?.user.id,
    authState?.workspace.id,
    currentStep,
    writeFlowShellState
  ]);

  useEffect(() => {
    if (!activeChat?.id) {
      stage2RunsRequestVersionsRef.current = {};
      setStage2Runs([]);
      setStage2RunDetail(null);
      setStage2RunId(null);
      setStage2ElapsedMs(0);
      stage2SelectionSourceRef.current = null;
      return;
    }

    stage2RunsRequestVersionsRef.current = {};
    setStage2Runs([]);
    setStage2RunDetail(null);
    setStage2RunId(null);
    setStage2ElapsedMs(0);
    void refreshStage2RunsForChat(activeChat.id).catch(() => undefined);
  }, [activeChat?.id, refreshStage2RunsForChat]);

  useEffect(() => {
    setStage2RunId((current) => pickPreferredStage2RunId(stage2Runs, current));
  }, [stage2Runs]);

  useEffect(() => {
    if (!stage2RunId) {
      setStage2RunDetail(null);
      return;
    }

    let cancelled = false;
    let timer = 0;
    let controller: AbortController | null = null;
    const pollId = stage2ProgressPollIdRef.current + 1;
    stage2ProgressPollIdRef.current = pollId;
    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled || stage2ProgressPollIdRef.current !== pollId) {
        return;
      }
      timer = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async (): Promise<void> => {
      controller?.abort();
      controller = new AbortController();
      try {
        const nextRun = await refreshStage2RunDetail(stage2RunId, { signal: controller.signal });
        if (cancelled || stage2ProgressPollIdRef.current !== pollId) {
          return;
        }
        setStage2RunDetail((prev) => (equalStage2RunDetail(prev, nextRun) ? prev : nextRun));
        if (!nextRun) {
          return;
        }

        if (!isStage2RunActive(nextRun)) {
          const durationMs = getStage2ElapsedMs(nextRun.progress);
          if (nextRun.status === "completed" && durationMs >= 1_000) {
            setStage2ExpectedDurationMs(durationMs);
            writeStage2DurationMetric(durationMs);
          }
          if (activeChat?.id === nextRun.chatId) {
            await Promise.allSettled([
              refreshActiveChat(activeChat.id),
              refreshStage2RunsForChat(activeChat.id),
              refreshChats()
            ]);
          } else {
            void refreshChats().catch(() => undefined);
          }
          return;
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        scheduleNextPoll(currentPollDelay(STAGE2_POLL_RETRY_VISIBLE_MS, STAGE2_POLL_RETRY_HIDDEN_MS));
        return;
      }

      scheduleNextPoll(currentPollDelay(STAGE2_DETAIL_POLL_VISIBLE_MS, STAGE2_DETAIL_POLL_HIDDEN_MS));
    };

    void poll();

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearTimeout(timer);
    };
  }, [
    activeChat?.id,
    refreshActiveChat,
    refreshChats,
    refreshStage2RunDetail,
    refreshStage2RunsForChat,
    stage2RunId,
    writeStage2DurationMetric
  ]);

  useEffect(() => {
    const progress = stage2RunDetail?.progress ?? null;
    if (!progress || !isStage2RunActive(stage2RunDetail) || currentStep !== 2) {
      setStage2ElapsedMs(getStage2ElapsedMs(progress));
      return;
    }

    let timer = 0;
    const tick = () => {
      setStage2ElapsedMs(getStage2ElapsedMs(progress));
      timer = window.setTimeout(
        tick,
        currentPollDelay(STAGE2_ELAPSED_TICK_MS, STAGE2_ELAPSED_TICK_HIDDEN_MS)
      );
    };
    tick();
    return () => {
      window.clearTimeout(timer);
    };
  }, [currentStep, stage2RunDetail]);

  const hasActiveStage2Runs = useMemo(
    () => stage2Runs.some((run) => isStage2RunActive(run)),
    [stage2Runs]
  );

  useEffect(() => {
    if (!activeChat?.id) {
      return;
    }
    if (!hasActiveStage2Runs) {
      return;
    }

    let cancelled = false;
    let timer = 0;
    let controller: AbortController | null = null;
    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async (): Promise<void> => {
      controller?.abort();
      controller = new AbortController();
      try {
        await refreshStage2RunsForChat(activeChat.id, { signal: controller.signal });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        scheduleNextPoll(currentPollDelay(STAGE2_POLL_RETRY_VISIBLE_MS, STAGE2_POLL_RETRY_HIDDEN_MS));
        return;
      }

      scheduleNextPoll(currentPollDelay(STAGE2_RUNS_POLL_VISIBLE_MS, STAGE2_RUNS_POLL_HIDDEN_MS));
    };

    void poll();

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearTimeout(timer);
    };
  }, [activeChat?.id, hasActiveStage2Runs, refreshStage2RunsForChat]);

  useEffect(() => {
    void refreshWorkspaceMembers().catch(() => undefined);
  }, [refreshWorkspaceMembers]);

  useEffect(() => {
    if (isAuthLoading || currentStep !== 3 || !stage3LocalExecutorAvailable) {
      setStage3Workers([]);
      setStage3WorkerPairing(null);
      return;
    }
    void refreshStage3Workers().catch(() => undefined);
    const timer = window.setInterval(() => {
      void refreshStage3Workers().catch(() => undefined);
    }, 10_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [currentStep, isAuthLoading, refreshStage3Workers, stage3LocalExecutorAvailable]);

  useEffect(() => {
    if (!activeChannel) {
      previousChannelIdRef.current = null;
      return;
    }
    if (previousChannelIdRef.current === activeChannel.id) {
      return;
    }
    previousChannelIdRef.current = activeChannel.id;

    const resolvedTemplateId = activeChannel.templateId || STAGE3_TEMPLATE_ID;
    const useBuiltInBackdrop = templateUsesBuiltInBackdropFromRegistry(resolvedTemplateId);
    setStage3RenderPlan((prev) =>
      normalizeRenderPlan(
        {
          ...prev,
          templateId: resolvedTemplateId,
          authorName: activeChannel.name || prev.authorName,
          authorHandle: activeChannel.username.startsWith("@")
            ? activeChannel.username
            : `@${activeChannel.username || "channel"}`,
          avatarAssetId: activeChannel.avatarAssetId,
          avatarAssetMimeType: findAssetById(channelAssets, activeChannel.avatarAssetId)?.mimeType ?? null,
          backgroundAssetId: useBuiltInBackdrop ? null : activeChannel.defaultBackgroundAssetId,
          backgroundAssetMimeType:
            useBuiltInBackdrop
              ? null
              : findAssetById(channelAssets, activeChannel.defaultBackgroundAssetId)?.mimeType ?? null,
          musicAssetId: activeChannel.defaultMusicAssetId,
          musicAssetMimeType:
            findAssetById(channelAssets, activeChannel.defaultMusicAssetId)?.mimeType ?? null
        },
        fallbackRenderPlan()
      )
    );
  }, [activeChannel, channelAssets]);

  useEffect(() => {
    setStage3RenderPlan((prev) => {
      const nextAvatarMime = findAssetById(channelAssets, prev.avatarAssetId)?.mimeType ?? null;
      const nextBackgroundMime = findAssetById(channelAssets, prev.backgroundAssetId)?.mimeType ?? null;
      const nextMusicMime = findAssetById(channelAssets, prev.musicAssetId)?.mimeType ?? null;

      if (
        prev.avatarAssetMimeType === nextAvatarMime &&
        prev.backgroundAssetMimeType === nextBackgroundMime &&
        prev.musicAssetMimeType === nextMusicMime
      ) {
        return prev;
      }

      return normalizeRenderPlan(
        {
          ...prev,
          avatarAssetMimeType: nextAvatarMime,
          backgroundAssetMimeType: nextBackgroundMime,
          musicAssetMimeType: nextMusicMime
        },
        fallbackRenderPlan()
      );
    });
  }, [channelAssets]);

  useEffect(() => {
    return () => {
      clearStage3PreviewCache();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stage3PreviewRequestKeyRef.current = "";
    stage3PreviewRequestIdRef.current += 1;
    clearStage3PreviewCache();
    setStage3PreviewVideoUrl(null);
    setStage3PreviewState("idle");
    setStage3PreviewNotice(null);
    setStage3PreviewJobId(null);
    setStage3RenderState("idle");
    setStage3RenderJobId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.id]);

  useEffect(() => {
    if (!codexRunning) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshCodexAuth({ background: true }).catch(() => undefined);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [codexRunning, refreshCodexAuth]);

  const requireActiveChat = (): ChatThread | null => {
    if (!activeChat) {
      setStatusType("error");
      setStatus("Create or select an item first.");
      return null;
    }
    return activeChat;
  };

  const applyStage3Snapshot = useCallback((snapshot: Stage3StateSnapshot): void => {
    setStage3TopText(snapshot.topText);
    setStage3BottomText(snapshot.bottomText);
    setStage3ClipStartSec(snapshot.clipStartSec);
    setStage3FocusY(snapshot.focusY);
    setStage3RenderPlan(normalizeRenderPlan(snapshot.renderPlan, fallbackRenderPlan()));
    if (snapshot.renderPlan?.prompt?.trim()) {
      setStage3AgentPrompt(snapshot.renderPlan.prompt);
    }
  }, []);

  const makeLiveSnapshot = (
    draftOverrides?: Partial<Stage3EditorDraftOverrides>,
    textFitOverride?: Stage3TextFitSnapshot | null
  ): Stage3StateSnapshot => {
    const effectiveRenderPlan = normalizeRenderPlan(
      {
        ...stage3RenderPlan,
        videoZoom:
          typeof draftOverrides?.videoZoom === "number" && Number.isFinite(draftOverrides.videoZoom)
            ? draftOverrides.videoZoom
            : stage3RenderPlan.videoZoom,
        topFontScale:
          typeof draftOverrides?.topFontScale === "number" && Number.isFinite(draftOverrides.topFontScale)
            ? draftOverrides.topFontScale
            : stage3RenderPlan.topFontScale,
        bottomFontScale:
          typeof draftOverrides?.bottomFontScale === "number" && Number.isFinite(draftOverrides.bottomFontScale)
            ? draftOverrides.bottomFontScale
            : stage3RenderPlan.bottomFontScale,
        musicGain:
          typeof draftOverrides?.musicGain === "number" && Number.isFinite(draftOverrides.musicGain)
            ? draftOverrides.musicGain
            : stage3RenderPlan.musicGain,
        prompt: stage3AgentPrompt.trim() || stage3RenderPlan.prompt
      },
      fallbackRenderPlan()
    );
    const templateSnapshot = buildTemplateRenderSnapshot({
      templateId: effectiveRenderPlan.templateId || STAGE3_TEMPLATE_ID,
      content: {
        topText: stage3TopText,
        bottomText: stage3BottomText,
        channelName: effectiveRenderPlan.authorName,
        channelHandle: effectiveRenderPlan.authorHandle,
        topFontScale: effectiveRenderPlan.topFontScale,
        bottomFontScale: effectiveRenderPlan.bottomFontScale,
        previewScale: 1,
        mediaAsset: null,
        backgroundAsset: null,
        avatarAsset: null
      },
      fitOverride: textFitOverride ?? undefined
    });
    const snapshotClipStart =
      typeof draftOverrides?.clipStartSec === "number" && Number.isFinite(draftOverrides.clipStartSec)
        ? Math.max(0, draftOverrides.clipStartSec)
        : stage3ClipStartSec;
    const snapshotFocusY =
      typeof draftOverrides?.focusY === "number" && Number.isFinite(draftOverrides.focusY)
        ? Math.min(0.88, Math.max(0.12, draftOverrides.focusY))
        : stage3FocusY;
    return {
      topText: templateSnapshot.content.topText,
      bottomText: templateSnapshot.content.bottomText,
      clipStartSec: snapshotClipStart,
      clipDurationSec: CLIP_DURATION_SEC,
      focusY: snapshotFocusY,
      renderPlan: effectiveRenderPlan,
      sourceDurationSec,
      templateSnapshot: {
        templateId: templateSnapshot.templateId,
        specRevision: templateSnapshot.specRevision,
        snapshotHash: templateSnapshot.snapshotHash,
        fitRevision: templateSnapshot.fitRevision
      },
      textFit: createStage3TextFitSnapshot(
        {
          templateId: templateSnapshot.templateId,
          snapshotHash: templateSnapshot.snapshotHash,
          topText: templateSnapshot.content.topText,
          bottomText: templateSnapshot.content.bottomText,
          topFontScale: effectiveRenderPlan.topFontScale,
          bottomFontScale: effectiveRenderPlan.bottomFontScale
        },
        {
          topFontPx: templateSnapshot.fit.topFontPx,
          bottomFontPx: templateSnapshot.fit.bottomFontPx,
          topLineHeight: templateSnapshot.fit.topLineHeight,
          bottomLineHeight: templateSnapshot.fit.bottomLineHeight,
          topLines: templateSnapshot.fit.topLines,
          bottomLines: templateSnapshot.fit.bottomLines,
          topCompacted: templateSnapshot.fit.topCompacted,
          bottomCompacted: templateSnapshot.fit.bottomCompacted
        }
      )
    };
  };

  const applyTimelineVersion = (
    timeline: Stage3TimelineResponse,
    preferredVersionId?: string | null
  ): Stage3Version | null => {
    const mergedVersions = mergeStage3Versions([
      timeline.legacyVersions,
      timeline.uiVersions
    ]);
    const targetVersion =
      (preferredVersionId
        ? mergedVersions.find((version) => version.runId === preferredVersionId) ?? null
        : null) ??
      mergedVersions[mergedVersions.length - 1] ??
      null;

    if (!targetVersion) {
      setStage3SelectedVersionId(null);
      setStage3PassSelectionByVersion({});
      return null;
    }

    setStage3SelectedVersionId(targetVersion.runId);
    setStage3PassSelectionByVersion((prev) => ({
      ...prev,
      [targetVersion.runId]: 0
    }));
    applyStage3Snapshot(targetVersion.final);
    setSourceDurationSec(targetVersion.final.sourceDurationSec);
    return targetVersion;
  };

  const clearStage3PreviewCache = (): void => {
    const cache = stage3PreviewCacheRef.current;
    for (const { url } of cache.values()) {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    }
    cache.clear();
  };

  const copyToClipboard = async (value: string, successMessage: string): Promise<void> => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setStatusType("ok");
      setStatus(successMessage);
    } catch {
      setStatusType("error");
      setStatus("Не удалось скопировать в буфер обмена.");
    }
  };

  const handlePasteFromClipboard = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setStatusType("error");
        setStatus("Буфер обмена пуст.");
        return;
      }
      setDraftUrl(text.trim());
      setStatusType("ok");
      setStatus("Ссылка вставлена из буфера обмена.");
    } catch {
      setStatusType("error");
      setStatus("Не удалось прочитать буфер обмена. Вставьте ссылку вручную.");
    }
  };

  const runStage2ForChat = async (
    chat: Pick<ChatThread, "id" | "url">,
    instruction: string,
    mode: "manual" | "auto"
  ): Promise<Stage2RunDetail> => {
    if (!codexLoggedIn) {
      throw new Error("Shared Codex недоступен. Обратитесь к владельцу.");
    }

    const trimmedInstruction = instruction.trim();
    await appendEvent(chat.id, {
      role: "user",
      type: "stage2",
      text:
        mode === "auto"
          ? "Auto Stage 2 запущен сразу после Step 1."
          : trimmedInstruction
            ? `Пользователь запустил Stage 2 с инструкцией: ${trimmedInstruction}`
            : "Пользователь запустил Stage 2."
    });

    const response = await fetch("/api/pipeline/stage2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chatId: chat.id,
        url: chat.url,
        userInstruction: trimmedInstruction || undefined,
        mode
      })
    });

    if (!response.ok) {
      throw new Error(await parseError(response, "Stage 2 завершился ошибкой."));
    }

    const body = (await response.json()) as { run: Stage2RunDetail };
    const run = body.run;
    setStage2RunId(run.runId);
    setStage2RunDetail(run);
    setStage2Runs((current) => {
      const deduped = current.filter((item) => item.runId !== run.runId);
      return [run, ...deduped].slice(0, 20);
    });

    await Promise.allSettled([
      refreshStage2RunsForChat(chat.id),
      refreshChats()
    ]);

    const nextRun = await refreshStage2RunDetail(run.runId);
    if (nextRun) {
      setStage2RunDetail(nextRun);
      return nextRun;
    }

    return run;
  };

  const handleFetchSource = async (): Promise<void> => {
    const url = draftUrl.trim();
    if (!url) {
      setStatusType("error");
      setStatus("Сначала вставьте ссылку на Shorts/Reels.");
      return;
    }
    if (!activeChannelId) {
      setStatusType("error");
      setStatus("Сначала создайте/выберите канал.");
      return;
    }
    if (!fetchSourceAvailable) {
      setStatusType("error");
      setStatus(fetchSourceBlockedReason ?? "Source fetch is unavailable on this deployment.");
      return;
    }

    await flushActiveDraftSave();
    setBusyAction("fetch");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    let chatId: string | null = null;
    let stage1Ready = false;
    let commentsAvailable = false;
    let commentsError: string | null = null;

    try {
      const createResponse = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, channelId: activeChannelId })
      });
      if (!createResponse.ok) {
        throw new Error(await parseError(createResponse, "Не удалось создать элемент."));
      }

      const createBody = (await createResponse.json()) as { chat: ChatThread };
      chatId = createBody.chat.id;
      setDraftUrl("");
      await refreshActiveChat(chatId);

      await appendEvent(chatId, {
        role: "user",
        type: "comments",
        text: "Пользователь запустил Step 1: загрузку ссылки и комментариев."
      });

      const commentsResponse = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });

      if (commentsResponse.ok) {
        const comments = (await commentsResponse.json()) as CommentsPayload;
        commentsAvailable = true;
        await appendEvent(chatId, {
          role: "assistant",
          type: "comments",
          text: `Комментарии загружены: ${comments.totalComments}`,
          data: comments
        });
      } else {
        commentsError = await parseError(commentsResponse, "Не удалось загрузить комментарии.");
        await appendEvent(chatId, {
          role: "assistant",
          type: "note",
          text: "Исходник получен. Комментарии недоступны на этом сервере.",
          data: {
            stage1Ready: true,
            commentsAvailable: false,
            commentsError
          }
        });
      }

      stage1Ready = true;
      setCurrentStep(2);

      if (!codexLoggedIn) {
        setStatusType("ok");
        setStatus(
          commentsAvailable
            ? canManageCodex
              ? "Источник готов. Комментарии загружены. Подключите Shared Codex, чтобы продолжить."
              : "Источник готов. Комментарии загружены. Shared Codex еще не подключен."
            : canManageCodex
              ? "Источник готов без комментариев. Подключите Shared Codex, чтобы продолжить."
              : "Источник готов без комментариев. Shared Codex еще не подключен."
        );
        return;
      }

      setIsStage2Enqueueing(true);
      try {
        const run = await runStage2ForChat({ id: chatId, url }, "", "auto");
        setStage2RunId(run.runId);
        setStatusType("ok");
        setStatus(
          commentsAvailable
            ? "Источник готов. Stage 2 запущен в фоне. Можно обновлять страницу или вернуться позже."
            : "Источник загружен без комментариев. Stage 2 запущен в фоне и переживет refresh."
        );
      } catch (stage2Error) {
        const message = getUiErrorMessage(stage2Error, "Источник готов, но Stage 2 не удалось запустить.");
        await appendEvent(chatId, {
          role: "assistant",
          type: "error",
          text: message
        }).catch(() => undefined);
        setStatusType("error");
        setStatus(message);
      } finally {
        setIsStage2Enqueueing(false);
      }
      return;
    } catch (error) {
      const message = getUiErrorMessage(error, "Не удалось загрузить источник.");
      if (chatId) {
        await appendEvent(chatId, {
          role: "assistant",
          type: "error",
          text: message
        }).catch(() => undefined);
      }
      setCurrentStep(stage1Ready ? 2 : 1);
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsBusy(false);
      setBusyAction("");
    }
  };

  const handleDownloadVideo = async (): Promise<void> => {
    const sourceUrl = activeChat?.url ?? draftUrl.trim();
    if (!sourceUrl) {
      setStatusType("error");
      setStatus("Сначала укажите URL источника.");
      return;
    }

    const chatId = activeChat?.id ?? null;
    if (!downloadSourceAvailable) {
      setStatusType("error");
      setStatus(downloadSourceBlockedReason ?? "Скачивание источника недоступно на этом деплое.");
      return;
    }

    setBusyAction("download");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      if (chatId) {
        await appendEvent(chatId, {
          role: "user",
          type: "download",
          text: "Пользователь запустил скачивание mp4."
        });
      }

      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось скачать видео."));
      }

      const provider = response.headers.get("X-Source-Provider") as "visolix" | "ytDlp" | null;
      const providerLabel = formatSourceProviderLabel(provider);
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const fileName =
        response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "video.mp4";
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);

      if (chatId) {
        await appendEvent(chatId, {
          role: "assistant",
          type: "download",
          text: providerLabel ? `Видео скачано через ${providerLabel}: ${fileName}` : `Видео скачано: ${fileName}`
        });
      }

      setStatusType("ok");
      setStatus(providerLabel ? `Видео скачано через ${providerLabel}.` : "Видео скачано.");
    } catch (error) {
      const message = getUiErrorMessage(error, "Не удалось скачать видео.");
      if (chatId) {
        await appendEvent(chatId, {
          role: "assistant",
          type: "error",
          text: message
        }).catch(() => undefined);
      }
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsBusy(false);
      setBusyAction("");
    }
  };

  const handleLoadComments = async (): Promise<void> => {
    const chat = requireActiveChat();
    if (!chat) {
      return;
    }

    setBusyAction("comments");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      await appendEvent(chat.id, {
        role: "user",
        type: "comments",
        text: "User requested comments."
      });

      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: chat.url })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось загрузить комментарии."));
      }

      const comments = (await response.json()) as CommentsPayload;
      await appendEvent(chat.id, {
        role: "assistant",
        type: "comments",
        text: `Комментарии загружены: ${comments.totalComments}`,
        data: comments
      });

      setStatusType("ok");
      setStatus("Комментарии загружены.");
    } catch (error) {
      const message = getUiErrorMessage(error, "Не удалось загрузить комментарии.");
      await appendEvent(chat.id, {
        role: "assistant",
        type: "error",
        text: message
      }).catch(() => undefined);
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsBusy(false);
      setBusyAction("");
    }
  };

  const handleRunStage2 = async (): Promise<void> => {
    const chat = requireActiveChat();
    if (!chat) {
      return;
    }
    if (!stage2RuntimeAvailable) {
      setStatusType("error");
      setStatus(stage2BlockedReason ?? "Среда выполнения Stage 2 недоступна на этом деплое.");
      return;
    }
    if (!codexLoggedIn) {
      setStatusType("error");
      setStatus("Shared Codex недоступен — обратитесь к владельцу.");
      return;
    }

    setIsStage2Enqueueing(true);
    setBusyAction("stage2");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      const run = await runStage2ForChat(chat, stage2Instruction, "manual");
      setStage2RunId(run.runId);
      setCurrentStep(2);
      setStatusType("ok");
      setStatus("Stage 2 запущен в фоне. Прогресс и результат сохраняются и переживут refresh.");
    } catch (error) {
      const message = getUiErrorMessage(error, "Stage 2 не удалось запустить.");
      await appendEvent(chat.id, {
        role: "assistant",
        type: "error",
        text: message
      }).catch(() => undefined);
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsStage2Enqueueing(false);
      setIsBusy(false);
      setBusyAction("");
    }
  };

  const handleRenderVideo = async (
    draftOverrides?: Partial<Stage3EditorDraftOverrides>,
    textFitOverride?: Stage3TextFitSnapshot | null
  ): Promise<void> => {
    const chat = requireActiveChat();
    if (!chat) {
      return;
    }
    if (!stage3TopText && !stage3BottomText) {
      setStatusType("error");
      setStatus("Сначала получите Stage 2 и выберите вариант.");
      return;
    }

    await flushActiveDraftSave();
    setBusyAction("render");
    setIsBusy(true);
    setStage3RenderState("queued");
    setStage3RenderJobId(null);
    setStatus("");
    setStatusType("");

    try {
      const baseSnapshot = makeLiveSnapshot(draftOverrides, textFitOverride);
      const renderSnapshot: Stage3StateSnapshot = {
        ...baseSnapshot,
        renderPlan: normalizeRenderPlan(
          {
            ...baseSnapshot.renderPlan,
            backgroundAssetId: stage3RenderPlan.backgroundAssetId,
            backgroundAssetMimeType: stage3RenderPlan.backgroundAssetMimeType,
            musicAssetId: stage3RenderPlan.musicAssetId,
            musicAssetMimeType: stage3RenderPlan.musicAssetMimeType,
            avatarAssetId: stage3RenderPlan.avatarAssetId,
            avatarAssetMimeType: stage3RenderPlan.avatarAssetMimeType,
            authorName: stage3RenderPlan.authorName,
            authorHandle: stage3RenderPlan.authorHandle,
            templateId: stage3RenderPlan.templateId,
            prompt: stage3AgentPrompt.trim() || baseSnapshot.renderPlan.prompt
          },
          fallbackRenderPlan()
        )
      };
      stage3RenderContextRef.current = {
        chatId: chat.id,
        snapshot: renderSnapshot,
        renderTitle: selectedTitle?.title ?? null
      };

      await appendEvent(chat.id, {
        role: "user",
        type: "note",
        text: `User started Step 3 render with template: ${STAGE3_TEMPLATE_ID}`
      });

      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await fetchWithTimeout("/api/stage3/render/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceUrl: chat.url,
            channelId: activeChannelId,
            renderTitle: selectedTitle?.title ?? undefined,
            templateId: renderSnapshot.renderPlan.templateId || STAGE3_TEMPLATE_ID,
            topText: renderSnapshot.topText,
            bottomText: renderSnapshot.bottomText,
            clipStartSec: renderSnapshot.clipStartSec,
            clipDurationSec: CLIP_DURATION_SEC,
            focusY: renderSnapshot.focusY,
            agentPrompt: stage3AgentPrompt.trim() || undefined,
            renderPlan: renderSnapshot.renderPlan,
            snapshot: renderSnapshot
          })
        }, 15_000);
        const shouldRetry = response.status >= 500 || responseLooksLikeHtml(response);
        if (response.ok && responseLooksLikeJson(response)) {
          break;
        }
        const message = await parseError(response, "Render export failed.");
        if (!shouldRetry || attempt === 2) {
          throw new Error(message);
        }
        const retryAfterValue = response.headers.get("retry-after");
        setStatusType("ok");
        setStatus("Рендер-сервис отвечает нестабильно. Повторяю запуск...");
        await new Promise<void>((resolve) => window.setTimeout(resolve, parseRetryAfterMs(retryAfterValue, 1200)));
      }
      if (!response) {
        throw new Error("Render export failed.");
      }
      const job = ((await response.json()) as Stage3JobEnvelope).job;
      setStage3RenderJobId(job.id);
      if (job.status === "completed" && job.artifact?.downloadUrl) {
        triggerUrlDownload(job.artifact.downloadUrl, job.artifact.fileName);
        setStage3RenderState("ready");
        setStage3RenderJobId(null);
        setStatusType("ok");
        setStatus("Render export complete.");
        return;
      }
      if (job.status === "failed" || job.status === "interrupted") {
        throw new Error(job.errorMessage ?? "Render export failed.");
      }
      setStage3RenderState(job.status === "queued" ? "queued" : job.status === "running" ? "rendering" : "ready");
      setStatusType("ok");
      setStatus(
        job.executionTarget === "local"
          ? job.workerLabel
            ? `Рендер выполняется на ${job.workerLabel}.`
            : "Рендер поставлен в очередь локального executor."
          : "Рендер запущен."
      );
    } catch (error) {
      setStage3RenderState("error");
      const message = getUiErrorMessage(error, "Render export failed.");
      await appendEvent(chat.id, {
        role: "assistant",
        type: "error",
        text: message
      }).catch(() => undefined);
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsBusy(false);
      setBusyAction("");
    }
  };

  useEffect(() => {
    if (!stage3RenderJobId || (stage3RenderState !== "queued" && stage3RenderState !== "rendering")) {
      return;
    }

    const pollId = stage3RenderPollIdRef.current + 1;
    stage3RenderPollIdRef.current = pollId;
    const controller = new AbortController();

    const isStale = () => controller.signal.aborted || stage3RenderPollIdRef.current !== pollId;

    const run = async (): Promise<void> => {
      let jobId = stage3RenderJobId;
      let transientFailures = 0;

      while (!isStale()) {
        const response = await fetchWithTimeout(`/api/stage3/render/jobs/${jobId}`, {
          signal: controller.signal
        }, 15_000);
        const shouldRetry = response.status >= 500 || responseLooksLikeHtml(response);
        if (!response.ok || !responseLooksLikeJson(response)) {
          const message = await parseError(response, "Render export failed.");
          if (shouldRetry && transientFailures < 4) {
            transientFailures += 1;
            setStatusType("ok");
            setStatus("Статус рендера временно недоступен. Повторяю...");
            await new Promise<void>((resolve) => {
              const timer = window.setTimeout(
                () => resolve(),
                parseRetryAfterMs(response.headers.get("retry-after"), 1000 + transientFailures * 500)
              );
              controller.signal.addEventListener(
                "abort",
                () => {
                  window.clearTimeout(timer);
                  resolve();
                },
                { once: true }
              );
            });
            continue;
          }
          throw new Error(message);
        }
        const job = ((await response.json()) as Stage3JobEnvelope).job;
        transientFailures = 0;
        jobId = job.id;
        setStage3RenderJobId(job.id);

        if (job.status === "queued") {
          setStage3RenderState("queued");
          setStatusType("ok");
          setStatus(
            job.executionTarget === "local"
              ? job.workerLabel
                ? `Рендер ожидает ${job.workerLabel}.`
                : "Ожидает локальный executor."
              : "Рендер в очереди."
          );
        } else if (job.status === "running") {
          setStage3RenderState("rendering");
          setStatusType("ok");
          setStatus(
            job.executionTarget === "local"
              ? job.workerLabel
                ? `Рендер выполняется на ${job.workerLabel}.`
                : "Локальный executor выполняет рендер."
              : "Рендер выполняется."
          );
        } else if (job.status === "completed" && job.artifact?.downloadUrl) {
          const renderContext = stage3RenderContextRef.current;
          triggerUrlDownload(job.artifact.downloadUrl, job.artifact.fileName);
          if (renderContext?.chatId) {
            await appendEvent(renderContext.chatId, {
              role: "assistant",
              type: "note",
              text: `Stage 3 export finished: ${job.artifact.fileName} (title ${renderContext.renderTitle ?? "n/a"}, clip ${renderContext.snapshot.clipStartSec.toFixed(1)}-${(
                renderContext.snapshot.clipStartSec + CLIP_DURATION_SEC
              ).toFixed(1)}s, focus ${Math.round(renderContext.snapshot.focusY * 100)}%)`,
              data: {
                kind: "stage3-render-export",
                fileName: job.artifact.fileName,
                renderTitle: renderContext.renderTitle,
                clipStartSec: renderContext.snapshot.clipStartSec,
                clipEndSec: renderContext.snapshot.clipStartSec + CLIP_DURATION_SEC,
                focusY: renderContext.snapshot.focusY,
                templateId: renderContext.snapshot.renderPlan.templateId || STAGE3_TEMPLATE_ID,
                createdAt: new Date().toISOString()
              } satisfies ChatRenderExportRef
            });
          }
          setStage3RenderState("ready");
          setStage3RenderJobId(null);
          setStatusType("ok");
          setStatus("Render export complete.");
          void refreshStage3Workers().catch(() => undefined);
          return;
        } else {
          throw new Error(job.errorMessage ?? "Render export failed.");
        }

        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(() => resolve(), 1000);
          controller.signal.addEventListener(
            "abort",
            () => {
              window.clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        });
      }
    };

    void run().catch(async (error) => {
      if (isAbortError(error) || isStale()) {
        return;
      }
      setStage3RenderState("error");
      const chatId = stage3RenderContextRef.current?.chatId ?? activeChat?.id ?? null;
      const message = getUiErrorMessage(error, "Render export failed.");
      if (chatId) {
        await appendEvent(chatId, {
          role: "assistant",
          type: "error",
          text: message
        }).catch(() => undefined);
      }
      setStatusType("error");
      setStatus(message);
    });

    return () => {
      controller.abort();
    };
  }, [
    activeChat?.id,
    appendEvent,
    getUiErrorMessage,
    parseError,
    refreshStage3Workers,
    stage3RenderJobId,
    stage3RenderState
  ]);

  const handleOptimizeStage3 = async (
    draftOverrides?: Partial<Stage3EditorDraftOverrides>,
    textFitOverride?: Stage3TextFitSnapshot | null
  ): Promise<void> => {
    const chat = requireActiveChat();
    if (!chat) {
      return;
    }

    const goalText = stage3AgentPrompt.trim() || activeStage3AgentTimeline?.session.goalText.trim() || "";
    if (!goalText) {
      setStatusType("error");
      setStatus("Опишите задачу для Redactor Agent.");
      return;
    }

    await flushActiveDraftSave();
    setBusyAction("stage3-optimize");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      const currentSnapshot = makeLiveSnapshot(draftOverrides, textFitOverride);
      const response = await fetch("/api/stage3/agent/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId: stage3KnownSessionId ?? undefined,
          projectId: chat.id,
          mediaId: chat.url,
          sourceUrl: chat.url,
          sourceDurationSec,
          goalText,
          currentSnapshot,
          autoClipStartSec: currentSnapshot.clipStartSec,
          autoFocusY: currentSnapshot.focusY,
          plannerReasoningEffort: "extra-high",
          plannerTimeoutMs: 120000,
          options: {
            maxIterations: 8,
            targetScore: 0.9,
            minGain: 0.02,
            operationBudget: 5
          }
        })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Stage 3 agent run failed."));
      }

      const body = (await response.json()) as Stage3AgentRunResponse;
      const timeline = await loadStage3AgentTimeline(body.sessionId);
      const selectedVersion = applyTimelineVersion(timeline, body.finalVersionId);

      setStage3AgentSessionId(body.sessionId);
      setIgnoreStage3ChatSessionRef(false);
      setStage3AgentPrompt(goalText);

      await appendStage3AgentSessionEvent(chat.id, {
        sessionId: body.sessionId,
        status: timeline.session.status,
        finalVersionId: body.finalVersionId,
        bestVersionId: body.bestVersionId,
        summaryText:
          timeline.session.status === "completed"
            ? "Redactor Agent завершил автономный цикл и сохранил итоговую версию."
            : timeline.session.status === "partiallyApplied"
              ? "Redactor Agent сохранил лучший найденный вариант после автономных итераций."
              : "Redactor Agent завершил цикл с остановкой по safety или ограничению."
      }).catch(() => undefined);

      const changedOps = [...new Set(body.summary.changedOperations.map((operation) => formatStage3Operation(operation)))];
      const versionLabel = selectedVersion ? `v${selectedVersion.versionNo}` : "текущая версия";
      const summary = changedOps.length ? changedOps.join(", ") : "без заметных операций";

      setStatusType(body.status === "failed" ? "error" : "ok");
      setStatus(
        `${versionLabel}: ${summary}. ${formatStage3StopReason(body.summary.whyStopped)}.` +
          (body.stabilityNote ? ` ${body.stabilityNote}` : "")
      );
    } catch (error) {
      const message = getUiErrorMessage(error, "Stage 3 agent run failed.");
      await appendEvent(chat.id, {
        role: "assistant",
        type: "error",
        text: message
      }).catch(() => undefined);
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsBusy(false);
      setBusyAction("");
    }
  };

  const handleResumeStage3Agent = async (): Promise<void> => {
    const chat = requireActiveChat();
    const sessionId = stage3KnownSessionId;
    if (!chat || !sessionId) {
      setStatusType("error");
      setStatus("Сначала запустите Redactor Agent хотя бы один раз.");
      return;
    }

    await flushActiveDraftSave();
    setBusyAction("stage3-optimize");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      const response = await fetch(`/api/stage3/agent/sessions/${sessionId}/resume`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mediaId: chat.url,
          sourceUrl: chat.url,
          plannerReasoningEffort: "extra-high",
          plannerTimeoutMs: 120000,
          options: {
            maxIterations: 8,
            targetScore: 0.9,
            minGain: 0.02,
            operationBudget: 5
          }
        })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось продолжить сессию агента Stage 3."));
      }

      const body = (await response.json()) as Stage3AgentRunResponse;
      const timeline = await loadStage3AgentTimeline(body.sessionId);
      const selectedVersion = applyTimelineVersion(timeline, body.finalVersionId);
      setIgnoreStage3ChatSessionRef(false);

      await appendStage3AgentSessionEvent(chat.id, {
        sessionId: body.sessionId,
        status: timeline.session.status,
        finalVersionId: body.finalVersionId,
        bestVersionId: body.bestVersionId,
        summaryText: "Redactor Agent продолжил автономный цикл от текущей версии."
      }).catch(() => undefined);

      setStatusType(body.status === "failed" ? "error" : "ok");
      setStatus(
        `${selectedVersion ? `v${selectedVersion.versionNo}` : "Сессия"} обновлена: ${formatStage3StopReason(
          body.summary.whyStopped
        )}.`
      );
    } catch (error) {
      const message = getUiErrorMessage(error, "Не удалось продолжить сессию агента Stage 3.");
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsBusy(false);
      setBusyAction("");
    }
  };

  const handleRollbackStage3Version = async (): Promise<void> => {
    const chat = requireActiveChat();
    const sessionId = stage3KnownSessionId;
    const targetVersionId = stage3SelectedVersionId;

    if (!chat || !sessionId || !targetVersionId) {
      setStatusType("error");
      setStatus("Выберите версию в drawer истории для отката.");
      return;
    }

    await flushActiveDraftSave();
    setBusyAction("stage3-optimize");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      const response = await fetch(`/api/stage3/agent/${sessionId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetVersionId,
          reason: "user_selected_version"
        })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось выполнить откат Stage 3."));
      }

      const body = (await response.json()) as {
        sessionId: string;
        targetVersionId: string;
        reason: string;
        rollbackVersionId: string;
        currentVersionId: string;
      };

      const timeline = await loadStage3AgentTimeline(body.sessionId);
      const selectedVersion = applyTimelineVersion(timeline, body.currentVersionId);
      setIgnoreStage3ChatSessionRef(false);

      await appendStage3AgentSessionEvent(chat.id, {
        sessionId: body.sessionId,
        status: timeline.session.status,
        finalVersionId: body.currentVersionId,
        bestVersionId: timeline.session.bestVersionId,
        summaryText: "Redactor Agent создал rollback-версию от выбранной точки timeline."
      }).catch(() => undefined);

      setStatusType("ok");
      setStatus(
        `Откат выполнен${selectedVersion ? ` к v${selectedVersion.versionNo}` : ""}. Причина: ${body.reason}.`
      );
    } catch (error) {
      const message = getUiErrorMessage(error, "Не удалось выполнить откат Stage 3.");
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsBusy(false);
      setBusyAction("");
    }
  };

  const handleUploadBackground = async (file: File): Promise<void> => {
    if (!activeChannelId) {
      setStatusType("error");
      setStatus("Сначала выберите канал.");
      return;
    }

    setBusyAction("background-upload");
    setStatus("");
    setStatusType("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "background");
      const response = await fetch(`/api/channels/${activeChannelId}/assets`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось загрузить фон."));
      }

      const body = (await response.json()) as { asset?: ChannelAsset };
      const asset = body.asset;
      if (!asset?.id) {
        throw new Error("Загрузка фона вернула пустой идентификатор ассета.");
      }

      setStage3RenderPlan((prev) =>
        normalizeRenderPlan(
          {
            ...prev,
            backgroundAssetId: asset.id,
            backgroundAssetMimeType: asset.mimeType ?? null
          },
          fallbackRenderPlan()
        )
      );

      await refreshChannelAssets(activeChannelId).catch(() => undefined);

      setStatusType("ok");
      setStatus("Фон загружен и применен к шаблону.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось загрузить фон."));
    } finally {
      setBusyAction("");
    }
  };

  const handleUploadMusic = async (file: File): Promise<void> => {
    if (!activeChannelId) {
      setStatusType("error");
      setStatus("Сначала выберите канал.");
      return;
    }

    setBusyAction("music-upload");
    setStatus("");
    setStatusType("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "music");
      const response = await fetch(`/api/channels/${activeChannelId}/assets`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось загрузить музыку."));
      }
      const body = (await response.json()) as { asset?: ChannelAsset };
      const asset = body.asset;
      if (!asset?.id) {
        throw new Error("Загрузка музыки вернула пустой идентификатор ассета.");
      }

      setStage3RenderPlan((prev) =>
        normalizeRenderPlan(
          {
            ...prev,
            musicAssetId: asset.id,
            musicAssetMimeType: asset.mimeType ?? null,
            audioMode: "source_plus_music"
          },
          fallbackRenderPlan()
        )
      );

      await refreshChannelAssets(activeChannelId).catch(() => undefined);
      setStatusType("ok");
      setStatus("Музыка загружена.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось загрузить музыку."));
    } finally {
      setBusyAction("");
    }
  };

  const handleClearBackground = (): void => {
    setStage3RenderPlan((prev) =>
      normalizeRenderPlan(
        {
          ...prev,
          backgroundAssetId: null,
          backgroundAssetMimeType: null
        },
        fallbackRenderPlan()
      )
    );
    setStatusType("ok");
    setStatus("Кастомный фон очищен. Используется blur исходного видео.");
  };

  const handleClearMusic = (): void => {
    setStage3RenderPlan((prev) =>
      normalizeRenderPlan(
        {
          ...prev,
          musicAssetId: null,
          musicAssetMimeType: null,
          audioMode: "source_only"
        },
        fallbackRenderPlan()
      )
    );
    setStatusType("ok");
    setStatus("Музыка отключена.");
  };

  const latestComments = useMemo(() => {
    if (!activeChat) {
      return null;
    }
    for (let i = activeChat.events.length - 1; i >= 0; i -= 1) {
      const event = activeChat.events[i];
      if (event.type === "comments") {
        return extractCommentsPayload(event.data);
      }
    }
    return null;
  }, [activeChat]);
  const stage1FetchState = useMemo(() => extractStage1FetchState(activeChat), [activeChat]);

  const stage2Events = useMemo(() => {
    if (!activeChat) {
      return [] as Array<{ id: string; createdAt: string; payload: Stage2Response }>;
    }
    return activeChat.events
      .map((event) => {
        if (event.type !== "stage2" || event.role !== "assistant") {
          return null;
        }
        const payload = extractStage2Payload(event.data);
        if (!payload) {
          return null;
        }
        return {
          id: event.id,
          createdAt: event.createdAt,
          payload
        };
      })
      .filter((event): event is { id: string; createdAt: string; payload: Stage2Response } =>
        Boolean(event)
      );
  }, [activeChat]);

  const latestStage2Event = useMemo(() => {
    return stage2Events[stage2Events.length - 1] ?? null;
  }, [stage2Events]);
  const selectedStage2RunSummary = useMemo(
    () => stage2Runs.find((run) => run.runId === stage2RunId) ?? null,
    [stage2RunId, stage2Runs]
  );
  const selectedStage2RunDetail = useMemo(
    () => (stage2RunDetail?.runId === stage2RunId ? stage2RunDetail : null),
    [stage2RunDetail, stage2RunId]
  );
  const visibleStage2Progress = useMemo<Stage2ProgressSnapshot | null>(
    () =>
      selectedStage2RunDetail?.progress ??
      selectedStage2RunSummary?.progress ??
      latestStage2Event?.payload.progress ??
      null,
    [latestStage2Event, selectedStage2RunDetail?.progress, selectedStage2RunSummary?.progress]
  );
  const visibleStage2Result = useMemo<Stage2Response | null>(() => {
    if (selectedStage2RunDetail) {
      return selectedStage2RunDetail.result;
    }
    if (selectedStage2RunSummary) {
      if (!selectedStage2RunSummary.hasResult) {
        return null;
      }
      if (latestStage2Event?.payload.stage2Run?.runId === selectedStage2RunSummary.runId) {
        return latestStage2Event.payload;
      }
      return null;
    }
    return latestStage2Event?.payload ?? null;
  }, [latestStage2Event, selectedStage2RunDetail, selectedStage2RunSummary]);
  const visibleStage2CreatedAt = useMemo(() => {
    if (selectedStage2RunDetail) {
      return selectedStage2RunDetail.finishedAt ?? selectedStage2RunDetail.updatedAt;
    }
    if (selectedStage2RunSummary) {
      if (latestStage2Event?.payload.stage2Run?.runId === selectedStage2RunSummary.runId) {
        return latestStage2Event.createdAt;
      }
      return selectedStage2RunSummary.finishedAt ?? selectedStage2RunSummary.updatedAt;
    }
    return latestStage2Event?.createdAt ?? null;
  }, [latestStage2Event, selectedStage2RunDetail, selectedStage2RunSummary]);
  const visibleStage2SourceKey = useMemo(() => {
    if (selectedStage2RunDetail) {
      return selectedStage2RunDetail.runId;
    }
    if (selectedStage2RunSummary) {
      return selectedStage2RunSummary.runId;
    }
    return latestStage2Event?.payload.stage2Run?.runId ?? latestStage2Event?.id ?? null;
  }, [latestStage2Event, selectedStage2RunDetail, selectedStage2RunSummary]);
  const visibleStage2EventId = useMemo(() => {
    if (!latestStage2Event) {
      return null;
    }
    if (!visibleStage2SourceKey) {
      return latestStage2Event.id;
    }
    return latestStage2Event.payload.stage2Run?.runId === visibleStage2SourceKey
      ? latestStage2Event.id
      : null;
  }, [latestStage2Event, visibleStage2SourceKey]);
  const visibleStage2SelectionDefaults = useMemo(() => {
    if (!visibleStage2Result) {
      return { captionOption: null, titleOption: null };
    }
    return {
      captionOption: visibleStage2Result.output.finalPick.option,
      titleOption: visibleStage2Result.output.titleOptions[0]?.option ?? 1
    };
  }, [visibleStage2Result]);
  const isStage2RunVisibleRunning = useMemo(
    () => isStage2RunActive(selectedStage2RunDetail ?? selectedStage2RunSummary),
    [selectedStage2RunDetail, selectedStage2RunSummary]
  );

  const stage3AgentSessionRef = useMemo(() => {
    if (!activeChat) {
      return null;
    }
    return findLatestStage3AgentSessionRef(activeChat.events);
  }, [activeChat]);

  const legacyStage3Versions = useMemo(() => {
    if (!activeChat) {
      return [] as Stage3Version[];
    }
    return buildLegacyTimelineEntries(
      activeChat.events
        .filter((event) => event.type === "note" && event.role === "assistant")
        .map((event) => ({
          id: event.id,
          createdAt: event.createdAt,
          data: event.data
        }))
    );
  }, [activeChat]);

  const activeStage3AgentTimeline = useMemo(() => {
    if (!stage3AgentTimeline || !activeChat?.url) {
      return null;
    }
    return stage3AgentTimeline.session.mediaId === activeChat.url ? stage3AgentTimeline : null;
  }, [activeChat?.url, stage3AgentTimeline]);
  const stage3KnownSessionId =
    stage3AgentSessionId ?? (ignoreStage3ChatSessionRef ? null : stage3AgentSessionRef?.sessionId ?? null);

  const stage3Versions = useMemo(() => {
    if (ignoreStage3ChatSessionRef && !activeStage3AgentTimeline) {
      return [] as Stage3Version[];
    }
    if (!activeStage3AgentTimeline) {
      return legacyStage3Versions;
    }

    return mergeStage3Versions([
      activeStage3AgentTimeline.legacyVersions,
      activeStage3AgentTimeline.uiVersions,
      legacyStage3Versions
    ]);
  }, [activeStage3AgentTimeline, ignoreStage3ChatSessionRef, legacyStage3Versions]);

  const stage3AgentConversation = useMemo(
    () => buildStage3AgentConversation(activeStage3AgentTimeline),
    [activeStage3AgentTimeline]
  );
  const stage3AgentLatestIteration = useMemo(
    () => activeStage3AgentTimeline?.iterations[activeStage3AgentTimeline.iterations.length - 1] ?? null,
    [activeStage3AgentTimeline]
  );
  const stage3AgentCurrentScore = stage3AgentLatestIteration?.scores.total ?? null;
  const canResumeStage3Agent = Boolean(
    activeStage3AgentTimeline?.session &&
      activeStage3AgentTimeline.session.status !== "completed" &&
      busyAction !== "stage3-optimize" &&
      busyAction !== "render"
  );
  const canRollbackStage3Version = Boolean(
    activeStage3AgentTimeline?.versions.some((version) => version.id === stage3SelectedVersionId) &&
      stage3SelectedVersionId &&
      stage3SelectedVersionId !== activeStage3AgentTimeline?.session.currentVersionId &&
      busyAction !== "stage3-optimize" &&
      busyAction !== "render"
  );

  useEffect(() => {
    if (!activeChat || !stage3KnownSessionId) {
      return;
    }
    if (stage3AgentTimeline?.session.id === stage3KnownSessionId) {
      return;
    }

    void loadStage3AgentTimeline(stage3KnownSessionId).catch(() => undefined);
  }, [
    activeChat,
    ignoreStage3ChatSessionRef,
    loadStage3AgentTimeline,
    stage3KnownSessionId,
    stage3AgentTimeline?.session.id
  ]);

  // Backward-compatible aliases after run->version refactor.
  const stage3Runs = stage3Versions;
  const stage3SelectedRunId = stage3SelectedVersionId;

  const selectedStage3Version = useMemo(() => {
    if (!stage3SelectedRunId) {
      return null;
    }
    return stage3Runs.find((run) => run.runId === stage3SelectedRunId) ?? null;
  }, [stage3Runs, stage3SelectedRunId]);

  const selectedStage3PassIndex = useMemo(() => {
    if (!selectedStage3Version) {
      return 0;
    }
    const fallback = Math.max(
      0,
      Math.min(selectedStage3Version.internalPasses.length - 1, selectedStage3Version.recommendedPass - 1)
    );
    const stored = stage3PassSelectionByVersion[selectedStage3Version.runId];
    if (typeof stored !== "number" || !Number.isFinite(stored)) {
      return fallback;
    }
    return Math.max(0, Math.min(selectedStage3Version.internalPasses.length - 1, stored));
  }, [selectedStage3Version, stage3PassSelectionByVersion]);

  const normalizedStage3RenderPlan = useMemo(
    () => normalizeRenderPlan(stage3RenderPlan, fallbackRenderPlan()),
    [stage3RenderPlan]
  );

  const stage3LivePreviewState = useMemo(
    () => ({
      clipStartSec: stage3ClipStartSec,
      clipDurationSec: CLIP_DURATION_SEC,
      renderPlan: stripRenderPlanForPreview(normalizedStage3RenderPlan)
    }),
    [
      stage3ClipStartSec,
      normalizedStage3RenderPlan
    ]
  );
  const stage3LivePreviewStateRef = useRef(stage3LivePreviewState);

  const stage3LivePreviewKey = useMemo(() => {
    if (!activeChat?.url) {
      return "";
    }
    return JSON.stringify({
      sourceUrl: activeChat.url,
      clipStartSec: Number(stage3LivePreviewState.clipStartSec.toFixed(3)),
      clipDurationSec: stage3LivePreviewState.clipDurationSec,
      renderPlan: stage3LivePreviewState.renderPlan
    });
  }, [activeChat?.url, stage3LivePreviewState]);

  useEffect(() => {
    stage3LivePreviewStateRef.current = stage3LivePreviewState;
  }, [stage3LivePreviewState]);

  const normalizedStage3RenderPlanJson = useMemo(
    () => JSON.stringify(normalizedStage3RenderPlan),
    [normalizedStage3RenderPlan]
  );
  const stage3PassSelectionJson = useMemo(
    () => JSON.stringify(stage3PassSelectionByVersion),
    [stage3PassSelectionByVersion]
  );

  useEffect(() => {
    if (!visibleStage2Result) {
      stage2SelectionSourceRef.current = null;
      setSelectedOption(null);
      setSelectedTitleOption(null);
      return;
    }

    const previousSourceKey = stage2SelectionSourceRef.current;
    const sourceChanged =
      previousSourceKey !== null &&
      visibleStage2SourceKey !== null &&
      previousSourceKey !== visibleStage2SourceKey;
    stage2SelectionSourceRef.current = visibleStage2SourceKey;

    setSelectedOption((prev) => {
      if (
        !sourceChanged &&
        prev &&
        visibleStage2Result.output.captionOptions.some((option) => option.option === prev)
      ) {
        return prev;
      }
      return sourceChanged
        ? visibleStage2SelectionDefaults.captionOption
        : activeDraft?.stage2.selectedCaptionOption ?? visibleStage2SelectionDefaults.captionOption;
    });

    setSelectedTitleOption((prev) => {
      if (
        !sourceChanged &&
        prev &&
        visibleStage2Result.output.titleOptions.some((titleOption) => titleOption.option === prev)
      ) {
        return prev;
      }
      return sourceChanged
        ? visibleStage2SelectionDefaults.titleOption
        : activeDraft?.stage2.selectedTitleOption ?? visibleStage2SelectionDefaults.titleOption;
    });
  }, [
    activeDraft?.stage2.selectedCaptionOption,
    activeDraft?.stage2.selectedTitleOption,
    visibleStage2Result,
    visibleStage2SelectionDefaults.captionOption,
    visibleStage2SelectionDefaults.titleOption,
    visibleStage2SourceKey
  ]);

  const selectedCaption = useMemo(() => {
    if (!visibleStage2Result) {
      return null;
    }
    const preferredOption = selectedOption ?? visibleStage2Result.output.finalPick.option;
    return (
      visibleStage2Result.output.captionOptions.find((item) => item.option === preferredOption) ??
      visibleStage2Result.output.captionOptions[0] ??
      null
    );
  }, [selectedOption, visibleStage2Result]);

  const selectedTitle = useMemo(() => {
    if (!visibleStage2Result) {
      return null;
    }
    const preferredOption = selectedTitleOption ?? visibleStage2Result.output.titleOptions[0]?.option ?? 1;
    return (
      visibleStage2Result.output.titleOptions.find((item) => item.option === preferredOption) ??
      visibleStage2Result.output.titleOptions[0] ??
      null
    );
  }, [selectedTitleOption, visibleStage2Result]);

  const hasActiveStage3Draft = useMemo(() => {
    if (!activeDraft) {
      return false;
    }
    return (
      activeDraft.stage3.topText !== null ||
      activeDraft.stage3.bottomText !== null ||
      activeDraft.stage3.clipStartSec !== null ||
      activeDraft.stage3.focusY !== null ||
      activeDraft.stage3.renderPlan !== null ||
      Boolean(activeDraft.stage3.agentPrompt.trim()) ||
      activeDraft.stage3.selectedVersionId !== null ||
      Object.keys(activeDraft.stage3.passSelectionByVersion).length > 0
    );
  }, [activeDraft]);

  const currentDraftPayload = useMemo(() => {
    if (!activeChat) {
      return null;
    }

    const defaults = getDefaultDraftState(activeChat);
    const latestVersion = stage3Versions[stage3Versions.length - 1] ?? null;
    const baseRenderPlan = latestVersion
      ? normalizeRenderPlan(latestVersion.final.renderPlan, fallbackRenderPlan())
      : applyChannelToRenderPlan(activeChannel, channelAssets);
    const baseRenderPlanJson = JSON.stringify(baseRenderPlan);
    const normalizedCurrentRenderPlan = normalizedStage3RenderPlan;
    const renderPlanChanged = normalizedStage3RenderPlanJson !== baseRenderPlanJson;
    const baseTopText = latestVersion?.final.topText ?? selectedCaption?.top ?? "";
    const baseBottomText = latestVersion?.final.bottomText ?? selectedCaption?.bottom ?? "";
    const baseClipStart = latestVersion?.final.clipStartSec ?? 0;
    const baseFocusY = latestVersion?.final.focusY ?? 0.5;
    const baseAgentPrompt = latestVersion?.prompt ?? defaults.agentPrompt ?? "";
    const titleDefault = visibleStage2SelectionDefaults.titleOption;
    const captionDefault = visibleStage2SelectionDefaults.captionOption;
    const passSelectionChanged =
      stage3PassSelectionJson !== JSON.stringify(defaults.passSelectionByVersion);

    return {
      lastOpenStep: currentStep,
      stage2: {
        instruction: stage2Instruction,
        selectedCaptionOption:
          selectedOption !== null && selectedOption !== captionDefault ? selectedOption : null,
        selectedTitleOption:
          selectedTitleOption !== null && selectedTitleOption !== titleDefault ? selectedTitleOption : null
      },
      stage3: {
        topText: stage3TopText !== baseTopText ? stage3TopText : null,
        bottomText: stage3BottomText !== baseBottomText ? stage3BottomText : null,
        clipStartSec: stage3ClipStartSec !== baseClipStart ? stage3ClipStartSec : null,
        focusY: stage3FocusY !== baseFocusY ? stage3FocusY : null,
        renderPlan: renderPlanChanged ? normalizedCurrentRenderPlan : null,
        agentPrompt:
          stage3AgentPrompt.trim() && stage3AgentPrompt !== baseAgentPrompt ? stage3AgentPrompt : "",
        selectedVersionId:
          stage3SelectedVersionId && stage3SelectedVersionId !== defaults.selectedVersionId
            ? stage3SelectedVersionId
            : null,
        passSelectionByVersion: passSelectionChanged ? stage3PassSelectionByVersion : {}
      }
    };
  }, [
    activeChannel,
    activeChat,
    applyChannelToRenderPlan,
    channelAssets,
    currentStep,
    selectedCaption,
    selectedOption,
    selectedTitleOption,
    stage2Instruction,
    stage3AgentPrompt,
    stage3ClipStartSec,
    stage3FocusY,
    stage3PassSelectionJson,
    stage3PassSelectionByVersion,
    normalizedStage3RenderPlan,
    normalizedStage3RenderPlanJson,
    stage3SelectedVersionId,
    stage3TopText,
    stage3BottomText,
    stage3Versions,
    visibleStage2SelectionDefaults.captionOption,
    visibleStage2SelectionDefaults.titleOption
  ]);

  const saveActiveDraftPayload = useCallback(
    async (
      payload: NonNullable<typeof currentDraftPayload>,
      options?: { silent?: boolean }
    ): Promise<void> => {
      if (!activeChat || !authState?.user.id) {
        return;
      }

      const stamp = new Date().toISOString();
      const optimisticDraft = normalizeChatDraft({
        id: activeDraft?.id ?? "",
        threadId: activeChat.id,
        userId: authState.user.id,
        createdAt: activeDraft?.createdAt ?? stamp,
        updatedAt: stamp,
        ...payload
      });

      if (optimisticDraft) {
        writeLocalDraftCache(optimisticDraft);
      }

      const request = (async () => {
        const response = await fetch(`/api/chats/${activeChat.id}/draft`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          throw new Error(await parseError(response, "Не удалось сохранить draft."));
        }

        const body = (await response.json()) as { draft: ChatDraft; summary: ChatListItem };
        setActiveDraft(body.draft);
        writeLocalDraftCache(body.draft);
        patchChatListItem(body.summary);
        draftPayloadJsonRef.current = JSON.stringify(payload);
      })();

      draftInFlightRef.current = request;
      try {
        await request;
      } catch (error) {
        if (!options?.silent) {
          setStatusType("error");
          setStatus(getUiErrorMessage(error, "Не удалось сохранить draft."));
        }
      } finally {
        if (draftInFlightRef.current === request) {
          draftInFlightRef.current = null;
        }
      }
    },
    [
      activeChat,
      activeDraft?.createdAt,
      activeDraft?.id,
      authState?.user.id,
      getUiErrorMessage,
      parseError,
      patchChatListItem,
      writeLocalDraftCache
    ]
  );

  const flushActiveDraftSave = useCallback(async (): Promise<void> => {
    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
      if (currentDraftPayload) {
        await saveActiveDraftPayload(currentDraftPayload, { silent: true });
      }
      return;
    }

    if (draftInFlightRef.current) {
      await draftInFlightRef.current.catch(() => undefined);
    }
  }, [currentDraftPayload, saveActiveDraftPayload]);

  const hasWorkingStage3Draft = useMemo(() => {
    if (hasActiveStage3Draft) {
      return true;
    }
    return Boolean(
      currentDraftPayload &&
        (
          currentDraftPayload.stage3.topText !== null ||
          currentDraftPayload.stage3.bottomText !== null ||
          currentDraftPayload.stage3.clipStartSec !== null ||
          currentDraftPayload.stage3.focusY !== null ||
          currentDraftPayload.stage3.renderPlan !== null ||
          Boolean(currentDraftPayload.stage3.agentPrompt.trim()) ||
          currentDraftPayload.stage3.selectedVersionId !== null ||
          Object.keys(currentDraftPayload.stage3.passSelectionByVersion).length > 0
        )
    );
  }, [currentDraftPayload, hasActiveStage3Draft]);

  const currentDraftPayloadJson = useMemo(
    () => (currentDraftPayload ? JSON.stringify(currentDraftPayload) : null),
    [currentDraftPayload]
  );

  useEffect(() => {
    if (!activeChat || !currentDraftPayload || !currentDraftPayloadJson) {
      return;
    }

    if (currentDraftPayloadJson === draftPayloadJsonRef.current) {
      return;
    }

    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current);
    }

    draftSaveTimerRef.current = window.setTimeout(() => {
      draftSaveTimerRef.current = null;
      void saveActiveDraftPayload(currentDraftPayload, { silent: true });
    }, 400);

    return () => {
      if (draftSaveTimerRef.current !== null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [activeChat, currentDraftPayload, currentDraftPayloadJson, saveActiveDraftPayload]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushActiveDraftSave();
      }
    };

    const handleBeforeUnload = () => {
      void flushActiveDraftSave();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [flushActiveDraftSave]);

  useEffect(() => {
    if (!activeChat?.id) {
      return;
    }

    const nextTopText = selectedCaption?.top ?? "";
    const nextBottomText = selectedCaption?.bottom ?? "";
    const currentAutoApplied = autoAppliedCaptionRef.current;
    const alreadyAppliedCurrentSelection =
      currentAutoApplied?.chatId === activeChat.id &&
      currentAutoApplied.option === (selectedCaption?.option ?? null) &&
      currentAutoApplied.top === nextTopText &&
      currentAutoApplied.bottom === nextBottomText &&
      stage3TopText === nextTopText &&
      stage3BottomText === nextBottomText;

    if (alreadyAppliedCurrentSelection) {
      return;
    }

    const currentMatchesLastAutoApplied =
      currentAutoApplied?.chatId === activeChat.id &&
      stage3TopText === currentAutoApplied.top &&
      stage3BottomText === currentAutoApplied.bottom;
    const currentTextEmpty = !stage3TopText && !stage3BottomText;

    if (!currentTextEmpty && !currentMatchesLastAutoApplied) {
      return;
    }

    autoAppliedCaptionRef.current = {
      chatId: activeChat.id,
      option: selectedCaption?.option ?? null,
      top: nextTopText,
      bottom: nextBottomText
    };
    setStage3TopText(nextTopText);
    setStage3BottomText(nextBottomText);
    setStage3SelectedVersionId(null);
    setStage3PassSelectionByVersion({});
    setStage3AgentSessionId(null);
    setStage3AgentTimeline(null);
    setIgnoreStage3ChatSessionRef(true);
  }, [
    activeChat?.id,
    selectedCaption?.option,
    selectedCaption?.top,
    selectedCaption?.bottom,
    stage3TopText,
    stage3BottomText
  ]);

  useEffect(() => {
    if (!activeChat?.id) {
      return;
    }

    if (hasWorkingStage3Draft || stage3Versions.length === 0) {
      return;
    }

    const latestVersion = stage3Versions[stage3Versions.length - 1] ?? null;
    if (!latestVersion) {
      return;
    }

    const recommendedIndex = Math.max(
      0,
      Math.min(latestVersion.internalPasses.length - 1, latestVersion.recommendedPass - 1)
    );
    setStage3SelectedVersionId(latestVersion.runId);
    setStage3PassSelectionByVersion({ [latestVersion.runId]: recommendedIndex });
    if (latestVersion.prompt.trim()) {
      setStage3AgentPrompt(latestVersion.prompt);
    } else if (activeStage3AgentTimeline?.session.goalText.trim()) {
      setStage3AgentPrompt(activeStage3AgentTimeline.session.goalText);
    }
    applyStage3Snapshot(latestVersion.final);
  }, [
    activeChat?.id,
    activeStage3AgentTimeline,
    hasWorkingStage3Draft,
    stage3Versions,
    applyStage3Snapshot
  ]);

  useEffect(() => {
    if (currentStep !== 3 || !activeChat?.url || stage3RenderInProgress) {
      return;
    }

    const controller = new AbortController();
    setBusyAction((prev) => (prev ? prev : "video-meta"));

    void (async () => {
      try {
        const response = await fetch("/api/video/meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: activeChat.url }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(await parseError(response, "Не удалось получить длительность исходника."));
        }
        const body = (await response.json()) as { durationSec: number | null };
        const duration = body.durationSec;
        setSourceDurationSec(duration);
        setStage3RenderPlan((prev) => {
          if (prev.prompt.trim()) {
            return prev;
          }
          const compressionEnabled = prev.timingMode === "compress";
          const policy = getEditingPolicy(prev.segments, compressionEnabled);
          if (prev.policy === policy) {
            return prev;
          }
          return normalizeRenderPlan(
            {
              ...prev,
              policy
            },
            fallbackRenderPlan()
          );
        });
        setStage3ClipStartSec((prev) => {
          if (!duration || duration <= CLIP_DURATION_SEC) {
            return 0;
          }
          const maxStart = Math.max(0, duration - CLIP_DURATION_SEC);
          return Math.min(prev, maxStart);
        });
      } catch {
        setSourceDurationSec(null);
      } finally {
        setBusyAction((prev) => (prev === "video-meta" ? "" : prev));
      }
    })();

    return () => controller.abort();
  }, [currentStep, activeChat?.url, stage3RenderInProgress]);

  useEffect(() => {
    if (currentStep !== 3 || !activeChat?.url) {
      return;
    }

    const previewState = stage3LivePreviewStateRef.current;
    const previewKey = stage3LivePreviewKey;
    stage3PreviewRequestKeyRef.current = previewKey;
    const requestId = stage3PreviewRequestIdRef.current + 1;
    stage3PreviewRequestIdRef.current = requestId;

    const cached = stage3PreviewCacheRef.current.get(previewKey);
    if (cached) {
      setStage3PreviewVideoUrl(cached.url);
      setStage3PreviewState("ready");
      setStage3PreviewNotice(null);
      return;
    }

    if (stage3RenderInProgress) {
      setStage3PreviewState("retrying");
      setStage3PreviewNotice("Предпросмотр обновится после рендера...");
      return;
    }

    const controller = new AbortController();
    let debounceTimer: number | null = null;
    let retryTimer: number | null = null;

    const isStale = (): boolean =>
      controller.signal.aborted ||
      stage3PreviewRequestIdRef.current !== requestId ||
      stage3PreviewRequestKeyRef.current !== previewKey;

    const rememberPreviewUrl = (url: string) => {
      const cache = stage3PreviewCacheRef.current;
      cache.set(previewKey, { url, createdAt: Date.now() });
      while (cache.size > 14) {
        const oldestEntry = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
        if (!oldestEntry) {
          break;
        }
        if (oldestEntry[1].url.startsWith("blob:")) {
          URL.revokeObjectURL(oldestEntry[1].url);
        }
        cache.delete(oldestEntry[0]);
      }
      stage3LastGoodPreviewAtRef.current = Date.now();
      setStage3PreviewVideoUrl(url);
      setStage3PreviewState("ready");
      setStage3PreviewNotice(null);
    };

    const scheduleRetry = (message: string, delayMs: number) => {
      if (isStale()) {
        return;
      }
      setStage3PreviewState("retrying");
      setStage3PreviewNotice(message);
      retryTimer = window.setTimeout(() => {
        if (isStale()) {
          return;
        }
        void startPreviewRequest();
      }, delayMs);
    };

    const pollPreviewJob = async (
      initialJob: Stage3JobEnvelope["job"]
    ): Promise<void> => {
      let job = initialJob;

      while (!isStale()) {
        setStage3PreviewJobId(job.id);
        if (job.status === "completed" && job.artifact?.downloadUrl) {
          rememberPreviewUrl(job.artifact.downloadUrl);
          return;
        }
        if (job.status === "failed" || job.status === "interrupted") {
          const message = job.errorMessage ?? "Не удалось загрузить предпросмотр.";
          if (job.recoverable) {
            scheduleRetry(message, 4000);
            return;
          }
          setStage3PreviewState("error");
          setStage3PreviewNotice(message);
          return;
        }

        setStage3PreviewState(job.status === "queued" ? "retrying" : "loading");
        if (job.executionTarget === "local") {
          setStage3PreviewNotice(
            job.status === "queued"
              ? "Ожидает локальный executor..."
              : job.workerLabel
                ? `Предпросмотр выполняется на ${job.workerLabel}...`
                : "Локальный executor обновляет предпросмотр..."
          );
        } else {
          setStage3PreviewNotice(job.status === "queued" ? "Предпросмотр в очереди..." : "Обновляю предпросмотр...");
        }

        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(() => resolve(), 1000);
          controller.signal.addEventListener(
            "abort",
            () => {
              window.clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        });
        if (isStale()) {
          return;
        }

        try {
          const response = await fetchWithTimeout(`/api/stage3/preview/jobs/${job.id}`, {
            signal: controller.signal
          }, 12_000);
          if (!response.ok) {
            const message = await parseError(response, "Не удалось обновить статус предпросмотра.");
            const retryDelayMs = parseRetryAfterMs(response.headers.get("retry-after"), 4000);
            scheduleRetry(message, retryDelayMs);
            return;
          }
          const body = (await response.json()) as Stage3JobEnvelope;
          job = body.job;
        } catch (error) {
          if (isStale()) {
            return;
          }
          if (isAbortError(error)) {
            scheduleRetry("Предпросмотр обновляется дольше обычного. Повторяю...", 4000);
            return;
          }
          scheduleRetry(getUiErrorMessage(error, "Не удалось обновить статус предпросмотра."), 4000);
          return;
        }
      }
    };

    const startPreviewRequest = async (): Promise<void> => {
      if (isStale()) {
        return;
      }
      setStage3PreviewState("loading");
      setStage3PreviewNotice("Обновляю предпросмотр...");

      try {
        const response = await fetchWithTimeout("/api/stage3/preview/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceUrl: activeChat.url,
            channelId: activeChannelId,
            clipDurationSec: CLIP_DURATION_SEC,
            renderPlan: previewState.renderPlan,
            snapshot: {
              clipStartSec: previewState.clipStartSec,
              clipDurationSec: previewState.clipDurationSec,
              renderPlan: previewState.renderPlan
            }
          }),
          signal: controller.signal
        }, 12_000);
        if (!response.ok) {
          const message = await parseError(response, "Не удалось поставить предпросмотр в очередь.");
          const retryDelayMs = parseRetryAfterMs(response.headers.get("retry-after"), 4000);
          if (response.status >= 500) {
            scheduleRetry(message, retryDelayMs);
            return;
          }
          setStage3PreviewState("error");
          setStage3PreviewNotice(message);
          return;
        }

        const body = (await response.json()) as Stage3JobEnvelope;
        await pollPreviewJob(body.job);
      } catch (error) {
        if (isStale()) {
          return;
        }
        if (isAbortError(error)) {
          scheduleRetry("Предпросмотр обновляется дольше обычного. Повторяю...", 4000);
          return;
        }
        scheduleRetry(getUiErrorMessage(error, "Не удалось загрузить предпросмотр."), 4000);
      }
    };

    setStage3PreviewState("debouncing");
    setStage3PreviewNotice("Обновляю предпросмотр...");
    debounceTimer = window.setTimeout(() => {
      void startPreviewRequest();
    }, 650);

    return () => {
      controller.abort();
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
      }
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [
    activeChannelId,
    activeChat?.url,
    currentStep,
    getUiErrorMessage,
    parseError,
    stage3LivePreviewKey,
    stage3RenderInProgress
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
      return;
    }
    const scope = window as typeof window & {
      __STAGE3_PREVIEW_DEBUG__?: Record<string, unknown>;
    };
    scope.__STAGE3_PREVIEW_DEBUG__ = {
      previewKey: stage3LivePreviewKey,
      previewState: stage3PreviewState,
      previewNotice: stage3PreviewNotice,
      previewJobId: stage3PreviewJobId,
      lastGoodPreviewAgeMs:
        stage3LastGoodPreviewAtRef.current === null ? null : Date.now() - stage3LastGoodPreviewAtRef.current
    };
    return () => {
      delete scope.__STAGE3_PREVIEW_DEBUG__;
    };
  }, [
    stage3LivePreviewKey,
    stage3PreviewJobId,
    stage3PreviewNotice,
    stage3PreviewState
  ]);

  const steps: FlowStep[] = useMemo(
    () => [
      { id: 1, label: "Вставить ссылку", enabled: true },
      { id: 2, label: "Проверить и выбрать", enabled: Boolean(activeChat && stage1FetchState.ready) },
      { id: 3, label: "Рендер видео", enabled: Boolean(visibleStage2Result) }
    ],
    [activeChat, stage1FetchState.ready, visibleStage2Result]
  );

  const activeLiveAction = useMemo<ChatListItem["liveAction"]>(() => {
    if (!activeChat) {
      return null;
    }
    if (isStage2RunVisibleRunning) {
      return "Stage 2";
    }
    switch (busyAction) {
      case "fetch":
        return "Fetching";
      case "comments":
        return "Comments";
      case "render":
        return "Rendering";
      default:
        return null;
    }
  }, [activeChat, busyAction, isStage2RunVisibleRunning]);

  const historyItems = useMemo(() => {
    if (!activeChat) {
      return chatList;
    }
    return chatList.map((item) => {
      if (item.id !== activeChat.id) {
        return item;
      }
      const nextLiveAction = activeLiveAction ?? item.liveAction ?? null;
      if (item.liveAction === nextLiveAction) {
        return item;
      }
      return {
        ...item,
        liveAction: nextLiveAction
      };
    });
  }, [activeChat?.id, activeLiveAction, chatList]);

  const handleHistoryOpen = useCallback(async (id: string, step?: 1 | 2 | 3): Promise<void> => {
    setStatus("");
    setStatusType("");

    if (!id) {
      setActiveChat(null);
      setActiveDraft(null);
      setCurrentStep(1);
      return;
    }

    try {
      await flushActiveDraftSave();
      const { chat, draft } = await refreshActiveChat(id);
      if (step) {
        setCurrentStep(Math.min(step, getMaxStepForChat(chat)) as 1 | 2 | 3);
      } else {
        setCurrentStep(getPreferredStepForChat(chat, draft));
      }
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось открыть элемент истории."));
    }
  }, [flushActiveDraftSave, getUiErrorMessage, refreshActiveChat]);

  const handleResetFlow = (): void => {
    void flushActiveDraftSave();
    setActiveChat(null);
    setActiveDraft(null);
    draftPayloadJsonRef.current = "";
    setDraftUrl("");
    setCurrentStep(1);
    setStage2Instruction("");
    setSelectedOption(null);
    setSelectedTitleOption(null);
    setStage3TopText("");
    setStage3BottomText("");
    setStage3ClipStartSec(0);
    setStage3FocusY(0.5);
    setStage3RenderPlan(applyChannelToRenderPlan(activeChannel, channelAssets));
    setSourceDurationSec(null);
    setStage3AgentPrompt("");
    setStage3AgentSessionId(null);
    setStage3AgentTimeline(null);
    setIgnoreStage3ChatSessionRef(false);
    setStage3SelectedVersionId(null);
    setStage3PassSelectionByVersion({});
    initializedStage3ChatRef.current = null;
    autoAppliedCaptionRef.current = null;
    stage3PreviewRequestKeyRef.current = "";
    stage3PreviewRequestIdRef.current += 1;
    clearStage3PreviewCache();
    setStage3PreviewVideoUrl(null);
    setStage3PreviewState("idle");
    setStage3PreviewNotice(null);
    setStage3PreviewJobId(null);
    setStage3RenderState("idle");
    setStage3RenderJobId(null);
    setStatus("");
    setStatusType("");
  };

  const handleSwitchChannel = useCallback(
    (channelId: string): void => {
      if (!channelId || channelId === activeChannelId) {
        return;
      }
      void flushActiveDraftSave();
      const nextChannel = channels.find((channel) => channel.id === channelId) ?? null;
      setActiveChannelId(channelId);
      setChatList([]);
      setActiveChat(null);
      setActiveDraft(null);
      draftPayloadJsonRef.current = "";
      setDraftUrl("");
      setCurrentStep(1);
      setStage2Instruction("");
      setSelectedOption(null);
      setSelectedTitleOption(null);
      setStage3TopText("");
      setStage3BottomText("");
      setStage3ClipStartSec(0);
      setStage3FocusY(0.5);
      setStage3RenderPlan(applyChannelToRenderPlan(nextChannel, []));
      setSourceDurationSec(null);
      setStage3AgentPrompt("");
      setStage3AgentSessionId(null);
      setStage3AgentTimeline(null);
      setIgnoreStage3ChatSessionRef(false);
      setStage3SelectedVersionId(null);
      setStage3PassSelectionByVersion({});
      initializedStage3ChatRef.current = null;
      autoAppliedCaptionRef.current = null;
      stage3PreviewRequestKeyRef.current = "";
      stage3PreviewRequestIdRef.current += 1;
      clearStage3PreviewCache();
      setStage3PreviewVideoUrl(null);
      setStage3PreviewState("idle");
      setStage3PreviewNotice(null);
      setStage3PreviewJobId(null);
      setStage3RenderState("idle");
      setStage3RenderJobId(null);
      setStatus("");
      setStatusType("");
    },
    [activeChannelId, channels, channelAssets, applyChannelToRenderPlan, flushActiveDraftSave]
  );

  const handleDeleteHistory = useCallback(async (chatId: string): Promise<void> => {
    if (!window.confirm("Удалить этот элемент из истории?")) {
      return;
    }

    setStatus("");
    setStatusType("");

    try {
      const response = await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось удалить элемент истории."));
      }

      const draftStorageKey = getDraftStorageKey(chatId);
      if (draftStorageKey && typeof window !== "undefined") {
        window.localStorage.removeItem(draftStorageKey);
      }

      await refreshChats();
      if (activeChat?.id === chatId) {
        setActiveChat(null);
        setActiveDraft(null);
        draftPayloadJsonRef.current = "";
        setCurrentStep(1);
      }

      setStatusType("ok");
      setStatus("Элемент истории удален.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось удалить элемент истории."));
    }
  }, [activeChat?.id, getDraftStorageKey, getUiErrorMessage, parseError, refreshChats]);

  const handleCreateChannel = async (): Promise<void> => {
    setBusyAction("channel-create");
    try {
      const response = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New channel", username: "channel" })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось создать канал."));
      }
      const body = (await response.json()) as { channel: Channel };
      await refreshChannels();
      handleSwitchChannel(body.channel.id);
      setStatusType("ok");
      setStatus("Канал создан.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось создать канал."));
    } finally {
      setBusyAction("");
    }
  };

  const handleSaveChannel = async (
    channelId: string,
    patch: Partial<{
      name: string;
      username: string;
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
      stage2PromptConfig: Stage2PromptConfig;
      templateId: string;
      avatarAssetId: string | null;
      defaultBackgroundAssetId: string | null;
      defaultMusicAssetId: string | null;
    }>
  ): Promise<void> => {
    setBusyAction("channel-save");
    try {
      const response = await fetch(`/api/channels/${channelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось сохранить канал."));
      }
      const body = (await response.json()) as { channel: Channel };
      setChannels((prev) => mergeSavedChannelIntoList(prev, body.channel));
      if (body.channel.id === activeChannelId) {
        const resolvedTemplateId = body.channel.templateId || STAGE3_TEMPLATE_ID;
        const useBuiltInBackdrop = templateUsesBuiltInBackdropFromRegistry(resolvedTemplateId);
        const resolvedAvatar = channelAssets.find((item) => item.id === body.channel.avatarAssetId);
        const resolvedBg = useBuiltInBackdrop
          ? null
          : channelAssets.find((item) => item.id === body.channel.defaultBackgroundAssetId);
        const resolvedMusic = channelAssets.find((item) => item.id === body.channel.defaultMusicAssetId);
        setStage3RenderPlan((prev) =>
          normalizeRenderPlan(
            {
              ...prev,
              templateId: resolvedTemplateId,
              authorName: body.channel.name || prev.authorName,
              authorHandle: body.channel.username.startsWith("@")
                ? body.channel.username
                : `@${body.channel.username || "channel"}`,
              avatarAssetId:
                patch.avatarAssetId !== undefined || patch.name !== undefined || patch.username !== undefined
                  ? body.channel.avatarAssetId
                  : prev.avatarAssetId,
              avatarAssetMimeType:
                patch.avatarAssetId !== undefined || patch.name !== undefined || patch.username !== undefined
                  ? resolvedAvatar?.mimeType ?? null
                  : prev.avatarAssetMimeType,
              backgroundAssetId:
                patch.defaultBackgroundAssetId !== undefined
                  ? useBuiltInBackdrop
                    ? null
                    : body.channel.defaultBackgroundAssetId
                  : prev.backgroundAssetId,
              backgroundAssetMimeType:
                patch.defaultBackgroundAssetId !== undefined
                  ? resolvedBg?.mimeType ?? null
                  : prev.backgroundAssetMimeType,
              musicAssetId:
                patch.defaultMusicAssetId !== undefined
                  ? body.channel.defaultMusicAssetId
                  : prev.musicAssetId,
              musicAssetMimeType:
                patch.defaultMusicAssetId !== undefined
                  ? resolvedMusic?.mimeType ?? null
                  : prev.musicAssetMimeType
            },
            fallbackRenderPlan()
          )
        );
      }
      setStatusType("ok");
      setStatus("Канал сохранен.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось сохранить канал."));
    } finally {
      setBusyAction("");
    }
  };

  const handleSaveWorkspaceStage2ExamplesCorpus = async (value: string): Promise<void> => {
    setBusyAction("channel-save");
    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage2ExamplesCorpusJson: value })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось сохранить corpus workspace."));
      }
      const body = (await response.json()) as { stage2ExamplesCorpusJson: string };
      setWorkspaceStage2ExamplesCorpusJson(body.stage2ExamplesCorpusJson ?? "[]");
    } finally {
      setBusyAction("");
    }
  };

  const handleDeleteChannel = async (channelId: string): Promise<void> => {
    if (!window.confirm("Удалить канал вместе с его историей и ассетами?")) {
      return;
    }
    setBusyAction("channel-delete");
    try {
      const response = await fetch(`/api/channels/${channelId}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось удалить канал."));
      }
      const channelsNext = await refreshChannels();
      const nextActive = channelsNext[0]?.id ?? null;
      if (nextActive) {
        handleSwitchChannel(nextActive);
      }
      setStatusType("ok");
      setStatus("Канал удален.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось удалить канал."));
    } finally {
      setBusyAction("");
    }
  };

  const handleDeleteChannelAsset = async (assetId: string): Promise<void> => {
    if (!activeChannelId) {
      return;
    }
    setBusyAction("channel-asset-delete");
    try {
      const response = await fetch(`/api/channels/${activeChannelId}/assets/${assetId}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось удалить ассет."));
      }
      await refreshChannelAssets(activeChannelId);
      await refreshChannels();
      setStage3RenderPlan((prev) =>
        normalizeRenderPlan(
          {
            ...prev,
            avatarAssetId: prev.avatarAssetId === assetId ? null : prev.avatarAssetId,
            avatarAssetMimeType: prev.avatarAssetId === assetId ? null : prev.avatarAssetMimeType,
            backgroundAssetId: prev.backgroundAssetId === assetId ? null : prev.backgroundAssetId,
            backgroundAssetMimeType:
              prev.backgroundAssetId === assetId ? null : prev.backgroundAssetMimeType,
            musicAssetId: prev.musicAssetId === assetId ? null : prev.musicAssetId,
            musicAssetMimeType: prev.musicAssetId === assetId ? null : prev.musicAssetMimeType,
            audioMode: prev.musicAssetId === assetId ? "source_only" : prev.audioMode
          },
          fallbackRenderPlan()
        )
      );
      setStatusType("ok");
      setStatus("Ассет удален.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось удалить ассет."));
    } finally {
      setBusyAction("");
    }
  };

  const handleUploadChannelAsset = async (kind: "avatar" | "background" | "music", file: File): Promise<void> => {
    if (!activeChannelId) {
      setStatusType("error");
      setStatus("Сначала выберите канал.");
      return;
    }
    const action: BusyAction =
      kind === "background" ? "background-upload" : kind === "music" ? "music-upload" : "channel-save";
    setBusyAction(action);
    try {
      const formData = new FormData();
      formData.append("kind", kind);
      formData.append("file", file);
      const response = await fetch(`/api/channels/${activeChannelId}/assets`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось загрузить ассет."));
      }
      const body = (await response.json()) as { asset?: ChannelAsset };
      await refreshChannelAssets(activeChannelId);
      await refreshChannels();

      if (body.asset?.kind === "background") {
        setStage3RenderPlan((prev) =>
          normalizeRenderPlan(
            {
              ...prev,
              backgroundAssetId: body.asset?.id ?? null,
              backgroundAssetMimeType: body.asset?.mimeType ?? null
            },
            fallbackRenderPlan()
          )
        );
      }
      if (body.asset?.kind === "music") {
        setStage3RenderPlan((prev) =>
          normalizeRenderPlan(
            {
              ...prev,
              musicAssetId: body.asset?.id ?? null,
              musicAssetMimeType: body.asset?.mimeType ?? null,
              audioMode: "source_plus_music"
            },
            fallbackRenderPlan()
          )
        );
      }
      if (body.asset?.kind === "avatar") {
        setStage3RenderPlan((prev) =>
          normalizeRenderPlan(
            {
              ...prev,
              avatarAssetId: body.asset?.id ?? null,
              avatarAssetMimeType: body.asset?.mimeType ?? null
            },
            fallbackRenderPlan()
          )
        );
      }

      setStatusType("ok");
      setStatus("Ассет загружен.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось загрузить ассет."));
    } finally {
      setBusyAction("");
    }
  };

  const handleUpdateChannelAccess = async (
    channelId: string,
    input: { grantUserIds: string[]; revokeUserIds: string[] }
  ): Promise<void> => {
    setBusyAction("channel-save");
    try {
      const response = await fetch(`/api/channels/${channelId}/access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось обновить доступ к каналу."));
      }
      const body = (await response.json()) as { grants: ChannelAccessGrant[] };
      setChannelAccessGrants(body.grants ?? []);
      setStatusType("ok");
      setStatus("Доступ к каналу обновлен.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось обновить доступ к каналу."));
    } finally {
      setBusyAction("");
    }
  };

  useEffect(() => {
    if (!activeChat) {
      hydrateChatEditorState(null, null);
    }
  }, [activeChat, hydrateChatEditorState]);

  const handleExportTemplate = (): void => {
    const chat = activeChat;
    if (!chat) {
      setStatusType("error");
      setStatus("Сначала создайте или выберите элемент.");
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      sourceUrl: chat.url,
      templateId: stage3RenderPlan.templateId,
      stage2EventId: visibleStage2EventId,
      selectedOption: selectedCaption?.option ?? null,
      top: stage3TopText,
      bottom: stage3BottomText,
      clipStartSec: stage3ClipStartSec,
      clipDurationSec: CLIP_DURATION_SEC,
      focusY: stage3FocusY,
      renderPlan: stage3RenderPlan,
      agentPrompt: stage3AgentPrompt,
      sourceDurationSec,
      selectedVersionId: stage3SelectedVersionId,
      selectedPassIndex: selectedStage3PassIndex,
      versions: stage3Versions,
      stage2: visibleStage2Result
    };

    toJsonDownload(`template_${chat.id}.json`, payload);
    setStatusType("ok");
    setStatus("Конфиг шаблона экспортирован.");
  };

  const handleLogout = async (): Promise<void> => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  const codexBadgeConnected = codexLoggedIn;

  if (isAuthLoading) {
    return (
      <main className="app-layout">
        <section className="app-main">
          <p className="status-line ok">Загрузка рабочего пространства...</p>
        </section>
      </main>
    );
  }

  return (
    <AppShell
      title="Автоматизация клипов"
      subtitle="Минимальный 3-шаговый поток: получить источник, выбрать подпись, отрендерить результат."
      steps={steps}
      currentStep={currentStep}
      onStepChange={(step) => setCurrentStep(step)}
      historyItems={historyItems}
      activeHistoryId={activeChat?.id ?? null}
      onHistoryOpen={handleHistoryOpen}
      onDeleteHistory={handleDeleteHistory}
      onCreateNew={handleResetFlow}
      channels={channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        username: channel.username,
        avatarUrl: channel.avatarAssetId ? buildChannelAssetUrl(channel.id, channel.avatarAssetId) : null
      }))}
      activeChannelId={activeChannelId}
      onSelectChannel={handleSwitchChannel}
      onManageChannels={() => setIsChannelManagerOpen(true)}
      canManageChannels={canCreateChannel || Boolean(activeChannel?.currentUserCanEditSetup)}
      canManageTeam={Boolean(authState?.effectivePermissions.canManageMembers)}
      onOpenTeam={() => {
        window.location.href = "/team";
      }}
      codexConnected={codexBadgeConnected}
      codexBusyConnect={busyAction === "connect-codex"}
      codexBusyRefresh={busyAction === "refresh-codex" || isCodexAuthLoading}
      canManageCodex={canManageCodex}
      canConnectCodex={sharedCodexAvailable && !codexRunning}
      codexConnectBlockedReason={effectiveCodexBlockedReason}
      codexStatusLabel={codexStatusLabel}
      codexActionLabel={codexLoggedIn ? "Переподключить" : "Подключить"}
      codexDeviceAuth={canManageCodex ? codexAuth?.deviceAuth ?? null : null}
      codexSecondaryActionLabel={
        canManageCodex
          ? codexAuth?.deviceAuth.status === "running"
            ? "Отменить"
            : codexLoggedIn
              ? "Отключить"
              : null
          : null
      }
      onConnectCodex={() => {
        void startCodexDeviceAuth();
      }}
      onRefreshCodex={() => {
        void refreshCodexAuth();
      }}
      onSecondaryCodexAction={() => {
        void handleCodexSecondaryAction();
      }}
      onCopyCodexLoginUrl={() => {
        void copyToClipboard(codexAuth?.deviceAuth.loginUrl ?? "", "Ссылка для входа скопирована.");
      }}
      onCopyCodexUserCode={() => {
        void copyToClipboard(codexAuth?.deviceAuth.userCode ?? "", "Код устройства скопирован.");
      }}
      currentUserName={authState?.user.displayName ?? null}
      currentUserRole={currentRole}
      workspaceName={authState?.workspace.name ?? null}
      onLogout={() => {
        void handleLogout();
      }}
      statusText={status}
      statusTone={statusType}
      details={
        <DetailsDrawer
          events={activeChat?.events ?? []}
          comments={latestComments}
          isBusyComments={busyAction === "comments"}
          onLoadComments={() => {
            void handleLoadComments();
          }}
          onDownloadCommentsJson={(payload) => {
            toJsonDownload(
              `${(payload.title || "video").replace(/[^a-zA-Z0-9._-]/g, "_")}_comments.json`,
              payload
            );
            setStatusType("ok");
            setStatus("JSON комментариев скачан.");
          }}
        />
      }
    >
      {currentStep === 1 ? (
        <Step1PasteLink
          draftUrl={draftUrl}
          activeUrl={activeChat?.url ?? null}
          commentsFallbackActive={stage1FetchState.ready && !stage1FetchState.commentsAvailable}
          isBusy={isBusy}
          fetchAvailable={fetchSourceAvailable}
          fetchBlockedReason={fetchSourceBlockedReason}
          downloadAvailable={downloadSourceAvailable}
          downloadBlockedReason={downloadSourceBlockedReason}
          onDraftUrlChange={setDraftUrl}
          onPaste={() => {
            void handlePasteFromClipboard();
          }}
          onFetch={() => {
            void handleFetchSource();
          }}
          onDownloadSource={() => {
            void handleDownloadVideo();
          }}
        />
      ) : null}

      {currentStep === 2 ? (
        <Step2PickCaption
          channelName={activeChannel?.name ?? null}
          channelUsername={activeChannel?.username ?? null}
          stage2={visibleStage2Result}
          progress={visibleStage2Progress}
          stageCreatedAt={visibleStage2CreatedAt}
          commentsAvailable={stage1FetchState.commentsAvailable}
          instruction={stage2Instruction}
          runs={stage2Runs}
          selectedRunId={stage2RunId}
          currentRunStatus={selectedStage2RunDetail?.status ?? selectedStage2RunSummary?.status ?? null}
          currentRunError={
            selectedStage2RunDetail?.errorMessage ?? selectedStage2RunSummary?.errorMessage ?? null
          }
          canRunStage2={
            Boolean(activeChat && codexLoggedIn && stage2RuntimeAvailable) &&
            (!isBusy || busyAction === "stage2") &&
            !isStage2Enqueueing
          }
          runBlockedReason={stage2BlockedReason}
          isLaunching={isStage2Enqueueing}
          isRunning={isStage2RunVisibleRunning}
          expectedDurationMs={stage2ExpectedDurationMs}
          elapsedMs={stage2ElapsedMs}
          selectedOption={selectedOption}
          selectedTitleOption={selectedTitleOption}
          onInstructionChange={setStage2Instruction}
          onRunStage2={() => {
            void handleRunStage2();
          }}
          onSelectRun={setStage2RunId}
          onSelectOption={setSelectedOption}
          onSelectTitleOption={setSelectedTitleOption}
          onCopy={(value, successMessage) => {
            void copyToClipboard(value, successMessage);
          }}
        />
      ) : null}

      {currentStep === 3 ? (
        <Step3RenderTemplate
          sourceUrl={activeChat?.url ?? null}
          templateId={stage3RenderPlan.templateId}
          channelName={activeChannel?.name ?? stage3RenderPlan.authorName ?? "Channel"}
          channelUsername={
            (activeChannel?.username?.trim() || "").replace(/^@/, "") ||
            (stage3RenderPlan.authorHandle || "@channel").replace(/^@/, "")
          }
          avatarUrl={stage3AvatarUrl}
          previewVideoUrl={stage3PreviewVideoUrl}
          backgroundAssetUrl={stage3BackgroundUrl}
          backgroundAssetMimeType={stage3RenderPlan.backgroundAssetMimeType}
          backgroundOptions={backgroundOptions}
          musicOptions={musicOptions}
          selectedBackgroundAssetId={stage3RenderPlan.backgroundAssetId}
          selectedMusicAssetId={stage3RenderPlan.musicAssetId}
          versions={stage3Versions}
          selectedVersionId={stage3SelectedVersionId}
          selectedPassIndex={selectedStage3PassIndex}
          previewState={stage3PreviewState}
          previewNotice={stage3PreviewNotice}
          agentPrompt={stage3AgentPrompt}
          agentSession={activeStage3AgentTimeline?.session ?? null}
          agentMessages={stage3AgentConversation}
          agentCurrentScore={stage3AgentCurrentScore}
          isAgentTimelineLoading={isStage3TimelineLoading}
          canResumeAgent={canResumeStage3Agent}
          canRollbackSelectedVersion={canRollbackStage3Version}
          topText={stage3TopText}
          bottomText={stage3BottomText}
          segments={stage3RenderPlan.segments}
          compressionEnabled={stage3RenderPlan.timingMode === "compress"}
          workerState={stage3WorkerPanelState}
          workerLabel={activeStage3Worker?.label ?? null}
          workerPlatform={activeStage3Worker?.platform ?? null}
          workerLastSeenAt={activeStage3Worker?.lastSeenAt ?? null}
          workerPairing={stage3WorkerPairing}
          isWorkerPairing={isStage3WorkerPairing}
          showWorkerControls={stage3LocalExecutorAvailable}
          clipStartSec={stage3ClipStartSec}
          clipDurationSec={CLIP_DURATION_SEC}
          sourceDurationSec={sourceDurationSec}
          focusY={stage3FocusY}
          cameraMotion={stage3RenderPlan.cameraMotion}
          mirrorEnabled={stage3RenderPlan.mirrorEnabled}
          videoZoom={stage3RenderPlan.videoZoom}
          topFontScale={stage3RenderPlan.topFontScale}
          bottomFontScale={stage3RenderPlan.bottomFontScale}
          sourceAudioEnabled={stage3RenderPlan.sourceAudioEnabled}
          musicGain={stage3RenderPlan.musicGain}
          renderState={stage3RenderState}
          isOptimizing={busyAction === "stage3-optimize"}
          isUploadingBackground={busyAction === "background-upload"}
          onRender={(overrides, textFitOverride) => {
            void handleRenderVideo(overrides, textFitOverride);
          }}
          onOptimize={(overrides, textFitOverride) => {
            void handleOptimizeStage3(overrides, textFitOverride);
          }}
          onResumeAgent={() => {
            void handleResumeStage3Agent();
          }}
          onRollbackSelectedVersion={() => {
            void handleRollbackStage3Version();
          }}
          onReset={handleResetFlow}
          onUploadBackground={handleUploadBackground}
          onUploadMusic={handleUploadMusic}
          onClearBackground={handleClearBackground}
          onClearMusic={handleClearMusic}
          onSelectBackgroundAssetId={(value) => {
            const selected = backgroundOptions.find((asset) => asset.id === value) ?? null;
            setStage3RenderPlan((prev) =>
              normalizeRenderPlan(
                {
                  ...prev,
                  backgroundAssetId: value,
                  backgroundAssetMimeType: selected?.mimeType ?? null
                },
                fallbackRenderPlan()
              )
            );
          }}
          onSelectMusicAssetId={(value) => {
            const selected = musicOptions.find((asset) => asset.id === value) ?? null;
            setStage3RenderPlan((prev) =>
              normalizeRenderPlan(
                {
                  ...prev,
                  musicAssetId: value,
                  musicAssetMimeType: selected?.mimeType ?? null,
                  audioMode: value ? "source_plus_music" : "source_only"
                },
                fallbackRenderPlan()
              )
            );
          }}
          onAgentPromptChange={setStage3AgentPrompt}
          onFragmentStateChange={({ segments, compressionEnabled }) => {
            const normalizedSegments = normalizeClientSegments(segments, sourceDurationSec);
            const boundedSegments = compressionEnabled
              ? normalizedSegments
              : trimClientSegmentsToDuration(normalizedSegments, CLIP_DURATION_SEC, sourceDurationSec);
            const policy = getEditingPolicy(boundedSegments, compressionEnabled);

            if (boundedSegments.length > 0) {
              setStage3ClipStartSec(boundedSegments[0]?.startSec ?? 0);
            }

            setStage3RenderPlan((prev) =>
              normalizeRenderPlan(
                {
                  ...prev,
                  segments: boundedSegments,
                  timingMode: compressionEnabled ? "compress" : "auto",
                  policy
                },
                fallbackRenderPlan()
              )
            );
          }}
          onSelectVersionId={(runId) => {
            const version = stage3Versions.find((item) => item.runId === runId);
            if (!version) {
              return;
            }
            const index = Math.max(
              0,
              Math.min(version.internalPasses.length - 1, version.recommendedPass - 1)
            );
            setStage3SelectedVersionId(runId);
            setStage3PassSelectionByVersion((prev) => ({
              ...prev,
              [runId]: index
            }));
            if (version.prompt.trim()) {
              setStage3AgentPrompt(version.prompt);
            }
            applyStage3Snapshot(version.final);
            setStatusType("ok");
            setStatus(`Выбрана версия v${version.versionNo}.`);
          }}
          onSelectPassIndex={(index) => {
            const version = selectedStage3Version;
            if (!version) {
              return;
            }
            const pass = version.internalPasses[index];
            if (!pass) {
              return;
            }
            setStage3PassSelectionByVersion((prev) => ({
              ...prev,
              [version.runId]: index
            }));
            setStatusType("ok");
            setStatus(`Выбран ${pass.label} (только для просмотра изменений).`);
          }}
          onClipStartChange={(value) => {
            setStage3ClipStartSec(value);
            setStage3RenderPlan((prev) => {
              if (prev.segments.length > 0) {
                return prev;
              }
              const compressionEnabled = prev.timingMode === "compress";
              const policy = getEditingPolicy(prev.segments, compressionEnabled);
              if (prev.policy === policy) {
                return prev;
              }
              return normalizeRenderPlan(
                {
                  ...prev,
                  policy
                },
                fallbackRenderPlan()
              );
            });
          }}
          onFocusYChange={(value) => setStage3FocusY(value)}
          onCameraMotionChange={(value) =>
            setStage3RenderPlan((prev) =>
              normalizeRenderPlan(
                {
                  ...prev,
                  cameraMotion: value
                },
                fallbackRenderPlan()
              )
            )
          }
          onMirrorEnabledChange={(value) =>
            setStage3RenderPlan((prev) =>
              normalizeRenderPlan(
                {
                  ...prev,
                  mirrorEnabled: value
                },
                fallbackRenderPlan()
              )
            )
          }
          onVideoZoomChange={(value) =>
            setStage3RenderPlan((prev) =>
              normalizeRenderPlan(
                {
                  ...prev,
                  videoZoom: value
                },
                fallbackRenderPlan()
              )
            )
          }
          onMusicGainChange={(value) =>
            setStage3RenderPlan((prev) =>
              normalizeRenderPlan(
                {
                  ...prev,
                  musicGain: value
                },
                fallbackRenderPlan()
              )
            )
          }
          onSourceAudioEnabledChange={(value) =>
            setStage3RenderPlan((prev) =>
              normalizeRenderPlan(
                {
                  ...prev,
                  sourceAudioEnabled: value
                },
                fallbackRenderPlan()
              )
            )
          }
          onTopFontScaleChange={(value) =>
            setStage3RenderPlan((prev) =>
              normalizeRenderPlan(
                {
                  ...prev,
                  topFontScale: value
                },
                fallbackRenderPlan()
              )
            )
          }
          onBottomFontScaleChange={(value) =>
            setStage3RenderPlan((prev) =>
              normalizeRenderPlan(
                {
                  ...prev,
                  bottomFontScale: value
                },
                fallbackRenderPlan()
              )
            )
          }
          onCreateWorkerPairing={() => {
            void createStage3WorkerPairing();
          }}
          onExport={handleExportTemplate}
        />
      ) : null}

      <ChannelManager
        open={isChannelManagerOpen}
        channels={channels}
        workspaceStage2ExamplesCorpusJson={workspaceStage2ExamplesCorpusJson}
        activeChannelId={activeChannelId}
        assets={channelAssets}
        onClose={() => setIsChannelManagerOpen(false)}
        onSelectChannel={handleSwitchChannel}
        canCreateChannel={canCreateChannel}
        onCreateChannel={() => {
          void handleCreateChannel();
        }}
        onDeleteChannel={(channelId) => {
          void handleDeleteChannel(channelId);
        }}
        onSaveChannel={handleSaveChannel}
        onSaveWorkspaceStage2ExamplesCorpus={handleSaveWorkspaceStage2ExamplesCorpus}
        onUploadAsset={(kind, file) => {
          void handleUploadChannelAsset(kind, file);
        }}
        onDeleteAsset={(assetId) => {
          void handleDeleteChannelAsset(assetId);
        }}
        canManageAccess={Boolean(authState?.effectivePermissions.canManageAnyChannelAccess)}
        accessGrants={channelAccessGrants}
        workspaceMembers={workspaceMembers}
        onUpdateAccess={(channelId, input) => {
          void handleUpdateChannelAccess(channelId, input);
        }}
      />
    </AppShell>
  );
}
