"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, FlowStep } from "./components/AppShell";
import { ChannelManager } from "./components/ChannelManager";
import { ChannelOnboardingWizard } from "./components/ChannelOnboardingWizard";
import { DetailsDrawer } from "./components/DetailsDrawer";
import { upsertHistoryItemByMeaningfulUpdate } from "./components/history-panel-support";
import { Step1PasteLink } from "./components/Step1PasteLink";
import {
  normalizeStage2DiagnosticsForView,
  Stage2RunDiagnosticsPanels,
  Step2PickCaption
} from "./components/Step2PickCaption";
import { Step3RenderTemplate } from "./components/Step3RenderTemplate";
import {
  AppRole,
  AuthMeResponse,
  Channel,
  ChannelAccessGrant,
  ChannelAsset,
  ChannelFeedbackResponse,
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
  SourceJobDetail,
  SourceJobSummary,
  Stage3StateSnapshot,
  Stage3TextFitSnapshot,
  Stage3TimelineResponse,
  Stage3Version,
  Stage2RunDetail,
  Stage2RunSummary,
  Stage2Response,
  UserRecord
} from "./components/types";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  normalizeStage2PromptConfig,
  type Stage2ProgressSnapshot,
  type Stage2PromptConfig
} from "../lib/stage2-pipeline";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  normalizeStage2HardConstraints,
  type Stage2ExamplesConfig,
  type Stage2HardConstraints
} from "../lib/stage2-channel-config";
import type { ChannelStyleDiscoveryRunDetail } from "../lib/channel-style-discovery-types";
import {
  issueScopedRequestVersion,
  getStage2ElapsedMs,
  isStage2RunActive,
  matchesScopedRequestVersion,
  pickPreferredStage2RunId
} from "../lib/stage2-run-client";
import {
  getSourceJobElapsedMs,
  isSourceJobActive,
  pickPreferredSourceJobId,
  resolveSourceFetchBlockedReason,
  shouldReuseActiveChatForSourceFetch
} from "../lib/source-job-client";
import {
  STAGE3_TEMPLATE_ID
} from "../lib/stage3-template";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import {
  clampStage3TextScaleUi,
  createStage3TextFitSnapshot
} from "../lib/stage3-text-fit";
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
import { buildChatTraceExportFileName } from "../lib/chat-trace-export-shared";
import { buildStage3DraftRenderPlanOverride } from "../lib/stage3-draft-render-plan";
import {
  applyStage2CaptionToStage3Text,
  buildStage2ToStage3HandoffSummary,
  getSelectedStage2Caption,
  getSelectedStage2Title,
  getStage2SelectionDefaults
} from "../lib/stage2-stage3-handoff";
import { sanitizeDisplayText, summarizeUserFacingError } from "../lib/ui-error";
import {
  buildChannelAssetUrl,
  buildScopedStorageKey,
  buildSharedCodexStatus,
  buildStage3AgentConversation,
  clampWorkflowStep,
  currentPollDelay,
  deriveLivePreferredStep,
  equalChatDraft,
  equalChatListItem,
  equalChatList,
  equalChatThread,
  equalCodexAuthResponse,
  equalSharedCodexStatus,
  equalSourceJobDetail,
  equalSourceJobSummaries,
  equalStage2RunDetail,
  equalStage2RunSummaries,
  fallbackRenderPlan,
  fetchWithTimeout,
  findAssetById,
  formatSourceProviderLabel,
  formatStage3Operation,
  formatStage3Status,
  formatStage3StopReason,
  hydrateStage3RenderPlanOverride,
  getEditingPolicy,
  isAbortError,
  mergeSavedChannelIntoList,
  mergeStage3Versions,
  normalizeClientSegments,
  normalizePersistedFlowShellState,
  normalizeRenderPlan,
  normalizeStage2DurationMetric,
  parseDownloadFileName,
  parseRetryAfterMs,
  PersistedFlowShellState,
  responseLooksLikeHtml,
  responseLooksLikeJson,
  responseContentType,
  shorten,
  stripRenderPlanForPreview,
  sumClientSegmentsDuration,
  toJsonDownload,
  triggerBlobDownload,
  triggerUrlDownload,
  trimClientSegmentsToDuration
} from "./home-page-support";

const CLIP_DURATION_SEC = 6;
const DEFAULT_TEXT_SCALE = 1.25;
const DEFAULT_STAGE2_EXPECTED_DURATION_MS = 40_000;
const STAGE2_DETAIL_POLL_VISIBLE_MS = 900;
const STAGE2_DETAIL_POLL_HIDDEN_MS = 2_500;
const STAGE2_RUNS_POLL_VISIBLE_MS = 1_800;
const STAGE2_RUNS_POLL_HIDDEN_MS = 5_000;
const SOURCE_DETAIL_POLL_VISIBLE_MS = 900;
const SOURCE_DETAIL_POLL_HIDDEN_MS = 2_500;
const SOURCE_JOBS_POLL_VISIBLE_MS = 1_800;
const SOURCE_JOBS_POLL_HIDDEN_MS = 5_000;
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
  | "trace-export"
  | "connect-codex"
  | "refresh-codex";

type AppToastInput = {
  id: string;
  tone: "neutral" | "success" | "error";
  title?: string | null;
  message: string;
  actionLabel?: string | null;
  onAction?: () => void;
  variant?: "default" | "shortcut";
  durationMs?: number | null;
  autoHideMs?: number | null;
};

export default function HomePage() {
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"ok" | "error" | "">("");
  const [appToasts, setAppToasts] = useState<Array<Omit<AppToastInput, "autoHideMs">>>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [authState, setAuthState] = useState<AuthMeResponse | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const [draftUrl, setDraftUrl] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [workspaceStage2ExamplesCorpusJson, setWorkspaceStage2ExamplesCorpusJson] = useState("[]");
  const [workspaceStage2HardConstraints, setWorkspaceStage2HardConstraints] = useState<Stage2HardConstraints>(
    DEFAULT_STAGE2_HARD_CONSTRAINTS
  );
  const [workspaceStage2PromptConfig, setWorkspaceStage2PromptConfig] = useState<Stage2PromptConfig>(
    DEFAULT_STAGE2_PROMPT_CONFIG
  );
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [channelAssets, setChannelAssets] = useState<ChannelAsset[]>([]);
  const [channelAccessGrants, setChannelAccessGrants] = useState<ChannelAccessGrant[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<Array<{ user: UserRecord; role: AppRole }>>([]);
  const [channelFeedbackHistory, setChannelFeedbackHistory] = useState<ChannelFeedbackResponse["historyEvents"]>([]);
  const [channelEditorialMemory, setChannelEditorialMemory] = useState<ChannelFeedbackResponse["editorialMemory"] | null>(null);
  const [isChannelFeedbackLoading, setIsChannelFeedbackLoading] = useState(false);
  const [deletingChannelFeedbackEventId, setDeletingChannelFeedbackEventId] = useState<string | null>(null);
  const [isChannelManagerOpen, setIsChannelManagerOpen] = useState(false);
  const [isChannelOnboardingOpen, setIsChannelOnboardingOpen] = useState(false);
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
  const toastTimersRef = useRef<Record<string, number>>({});

  const dismissAppToast = useCallback((toastId: string): void => {
    const timerId = toastTimersRef.current[toastId];
    if (typeof timerId === "number") {
      window.clearTimeout(timerId);
      delete toastTimersRef.current[toastId];
    }
    setAppToasts((prev) => prev.filter((toast) => toast.id !== toastId));
  }, []);

  const showAppToast = useCallback(
    (input: AppToastInput): void => {
      const { autoHideMs = null, ...toast } = input;
      const existingTimerId = toastTimersRef.current[toast.id];
      if (typeof existingTimerId === "number") {
        window.clearTimeout(existingTimerId);
        delete toastTimersRef.current[toast.id];
      }
      setAppToasts((prev) => {
        const next = prev.filter((item) => item.id !== toast.id);
        return [toast, ...next].slice(0, 4);
      });
      if (typeof autoHideMs === "number" && autoHideMs > 0) {
        toastTimersRef.current[toast.id] = window.setTimeout(() => {
          dismissAppToast(toast.id);
        }, autoHideMs);
      }
    },
    [dismissAppToast]
  );

  useEffect(() => {
    return () => {
      Object.values(toastTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      toastTimersRef.current = {};
    };
  }, []);
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
  const [sourceJobs, setSourceJobs] = useState<SourceJobSummary[]>([]);
  const [sourceJobDetail, setSourceJobDetail] = useState<SourceJobDetail | null>(null);
  const [sourceJobElapsedMs, setSourceJobElapsedMs] = useState(0);
  const [sourceJobId, setSourceJobId] = useState<string | null>(null);
  const [isSourceEnqueueing, setIsSourceEnqueueing] = useState(false);
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
  const sourceProgressPollIdRef = useRef(0);
  const sourceJobsRequestVersionsRef = useRef<Record<string, number>>({});
  const stage2ProgressPollIdRef = useRef(0);
  const stage2RunsRequestVersionsRef = useRef<Record<string, number>>({});
  const stage2SelectionSourceRef = useRef<string | null>(null);
  const desiredActiveChatIdRef = useRef<string | null>(null);
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
  const canOperateActiveChannel = activeChannel?.currentUserCanOperate !== false;
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

  const channelOnboardingStorageKey = useMemo(
    () => buildScopedStorageKey("clips-channel-onboarding", authState?.workspace.id, authState?.user.id),
    [authState?.user.id, authState?.workspace.id]
  );

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
      const currentItem = prev.find((item) => item.id === nextItem.id) ?? null;
      if (currentItem && equalChatListItem(currentItem, nextItem)) {
        return prev;
      }
      const nextList = upsertHistoryItemByMeaningfulUpdate(prev, nextItem);
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
      const avatar = findAssetById(assets, channel.avatarAssetId);
      const background = findAssetById(assets, channel.defaultBackgroundAssetId);
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
          backgroundAssetId: channel.defaultBackgroundAssetId,
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
      const selectionDefaults = getStage2SelectionDefaults(stage2Event);
      const preferredCaptionOption =
        draft?.stage2.selectedCaptionOption ?? selectionDefaults.captionOption;
      const preferredTitleOption =
        draft?.stage2.selectedTitleOption ?? selectionDefaults.titleOption;
      const selectedCaptionForHydration = getSelectedStage2Caption(stage2Event, preferredCaptionOption);
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
        ? hydrateStage3RenderPlanOverride(draft.stage3.renderPlan, baseRenderPlan)
        : baseRenderPlan;
      const handoffSummary = buildStage2ToStage3HandoffSummary({
        stage2: stage2Event,
        draft,
        latestVersion,
        selectedCaptionOption: preferredCaptionOption,
        selectedTitleOption: preferredTitleOption
      });
      const nextTopText = handoffSummary.topText ?? "";
      const nextBottomText = handoffSummary.bottomText ?? "";
      const hydratedFromSelectedCaption =
        Boolean(selectedCaptionForHydration) &&
        nextTopText === (selectedCaptionForHydration?.top ?? "") &&
        nextBottomText === (selectedCaptionForHydration?.bottom ?? "");

      initializedStage3ChatRef.current = chat.id;
      setCurrentStep(getPreferredStepForChat(chat, draft));
      setStage2Instruction(draft?.stage2.instruction ?? "");
      setSelectedOption(handoffSummary.selectedCaptionOption);
      setSelectedTitleOption(handoffSummary.selectedTitleOption);
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
      workspaceStage2HardConstraints?: Stage2HardConstraints;
      workspaceStage2PromptConfig?: Stage2PromptConfig;
    };
    const nextChannels = body.channels ?? [];
    setWorkspaceStage2ExamplesCorpusJson(body.workspaceStage2ExamplesCorpusJson ?? "[]");
    setWorkspaceStage2HardConstraints(
      normalizeStage2HardConstraints(body.workspaceStage2HardConstraints)
    );
    setWorkspaceStage2PromptConfig(normalizeStage2PromptConfig(body.workspaceStage2PromptConfig));
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

  const refreshChannelFeedback = useCallback(async (channelId: string): Promise<ChannelFeedbackResponse | null> => {
    if (!channelId) {
      setChannelFeedbackHistory([]);
      setChannelEditorialMemory(null);
      return null;
    }

    setIsChannelFeedbackLoading(true);
    try {
      const response = await fetch(`/api/channels/${channelId}/feedback`);
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось загрузить историю редакторских реакций."));
      }
      const body = (await response.json()) as ChannelFeedbackResponse;
      setChannelFeedbackHistory(body.historyEvents ?? []);
      setChannelEditorialMemory(body.editorialMemory ?? null);
      return body;
    } finally {
      setIsChannelFeedbackLoading(false);
    }
  }, [parseError]);

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
    patchChatListItem(buildChatListItem(body.chat, resolvedDraft));
    if (desiredActiveChatIdRef.current && desiredActiveChatIdRef.current !== chatId) {
      return { chat: body.chat, draft: resolvedDraft };
    }
    const shouldHydrate =
      !equalChatThread(activeChatRef.current, body.chat) ||
      !equalChatDraft(activeDraftRef.current, resolvedDraft);

    desiredActiveChatIdRef.current = body.chat.id;
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
    if (shouldHydrate) {
      hydrateChatEditorState(body.chat, resolvedDraft);
    }
    return { chat: body.chat, draft: resolvedDraft };
  }, [hydrateChatEditorState, parseError, patchChatListItem, readLocalDraftCache]);

  const refreshSourceJobsForChat = useCallback(async (
    chatId: string,
    options?: { signal?: AbortSignal }
  ): Promise<SourceJobSummary[]> => {
    const issued = issueScopedRequestVersion(sourceJobsRequestVersionsRef.current, chatId);
    sourceJobsRequestVersionsRef.current = issued.nextVersions;
    const response = await fetch(`/api/pipeline/source?chatId=${encodeURIComponent(chatId)}`, {
      cache: "no-store",
      signal: options?.signal
    });
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить source jobs."));
    }
    const body = (await response.json()) as { jobs?: SourceJobSummary[] };
    const nextJobs = body.jobs ?? [];
    if (
      !matchesScopedRequestVersion(sourceJobsRequestVersionsRef.current, chatId, issued.version) ||
      activeChatIdRef.current !== chatId
    ) {
      return nextJobs;
    }
    setSourceJobs((prev) => (equalSourceJobSummaries(prev, nextJobs) ? prev : nextJobs));
    return nextJobs;
  }, [parseError]);

  const refreshSourceJobDetail = useCallback(async (
    jobId: string,
    options?: { signal?: AbortSignal }
  ): Promise<SourceJobDetail | null> => {
    const response = await fetch(`/api/pipeline/source?jobId=${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      signal: options?.signal
    });
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось загрузить source job."));
    }
    const body = (await response.json()) as { job?: SourceJobDetail | null };
    return body.job ?? null;
  }, [parseError]);

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
      throw new Error(await parseError(response, "Не удалось загрузить историю запусков Stage 2."));
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
      throw new Error(await parseError(response, "Не удалось загрузить запуск Stage 2."));
    }
    const body = (await response.json()) as { run?: Stage2RunDetail | null };
    return body.run ?? null;
  }, [parseError]);

  const hydrateChatLiveState = useCallback(async (
    chatId: string,
    options?: { preferredStep?: 1 | 2 | 3 }
  ): Promise<{ chat: ChatThread; draft: ChatDraft | null }> => {
    desiredActiveChatIdRef.current = chatId;
    activeChatIdRef.current = chatId;
    const { chat, draft } = await refreshActiveChat(chatId);
    const [nextSourceJobs, nextStage2Runs] = await Promise.all([
      refreshSourceJobsForChat(chatId).catch(() => []),
      refreshStage2RunsForChat(chatId).catch(() => [])
    ]);
    if (desiredActiveChatIdRef.current !== chatId) {
      return { chat, draft };
    }
    const preferredStep = deriveLivePreferredStep({
      chat,
      draft,
      sourceJobs: nextSourceJobs,
      stage2Runs: nextStage2Runs
    });
    const cappedPreferredStep = Math.min(
      options?.preferredStep ?? preferredStep,
      getMaxStepForChat(chat)
    ) as 1 | 2 | 3;
    if (preferredStep === 1 || preferredStep === 2) {
      setCurrentStep(preferredStep);
      return { chat, draft };
    }
    setCurrentStep(cappedPreferredStep);
    return { chat, draft };
  }, [refreshActiveChat, refreshSourceJobsForChat, refreshStage2RunsForChat]);

  const appendEvent = useCallback(async (
    chatId: string,
    event: { role: ChatEvent["role"]; type: ChatEvent["type"]; text: string; data?: unknown }
  ): Promise<void> => {
    const response = await fetch(`/api/chat-events/${chatId}`, {
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
      desiredActiveChatIdRef.current = null;
      activeChatIdRef.current = null;
      setChatList([]);
      setActiveChat(null);
      setActiveDraft(null);
      setChannelAccessGrants([]);
      setChannelFeedbackHistory([]);
      setChannelEditorialMemory(null);
      return;
    }
    void refreshChats().catch(() => undefined);
    void refreshChannelAssets(activeChannelId).catch(() => undefined);
    void refreshChannelAccess(activeChannelId).catch(() => undefined);
    void refreshChannelFeedback(activeChannelId).catch(() => undefined);
  }, [activeChannelId, refreshChannelAccess, refreshChannelAssets, refreshChannelFeedback, refreshChats]);

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
        await hydrateChatLiveState(shell.chatId!, { preferredStep: shell.step });
      } catch {
        // Ignore restore failures and leave current selection untouched.
      }
    })();
  }, [activeChannelId, activeChat, chatList, hydrateChatLiveState]);

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
      desiredActiveChatIdRef.current = null;
      activeChatIdRef.current = null;
      sourceJobsRequestVersionsRef.current = {};
      setSourceJobs([]);
      setSourceJobDetail(null);
      setSourceJobId(null);
      setSourceJobElapsedMs(0);
      stage2RunsRequestVersionsRef.current = {};
      setStage2Runs([]);
      setStage2RunDetail(null);
      setStage2RunId(null);
      setStage2ElapsedMs(0);
      stage2SelectionSourceRef.current = null;
      return;
    }

    desiredActiveChatIdRef.current = activeChat.id;
    activeChatIdRef.current = activeChat.id;
    sourceJobsRequestVersionsRef.current = {};
    setSourceJobs([]);
    setSourceJobDetail(null);
    setSourceJobId(null);
    setSourceJobElapsedMs(0);
    stage2RunsRequestVersionsRef.current = {};
    setStage2Runs([]);
    setStage2RunDetail(null);
    setStage2RunId(null);
    setStage2ElapsedMs(0);
    void refreshSourceJobsForChat(activeChat.id).catch(() => undefined);
    void refreshStage2RunsForChat(activeChat.id).catch(() => undefined);
  }, [activeChat?.id, refreshSourceJobsForChat, refreshStage2RunsForChat]);

  useEffect(() => {
    setSourceJobId((current) => pickPreferredSourceJobId(sourceJobs, current));
  }, [sourceJobs]);

  useEffect(() => {
    if (!sourceJobId) {
      setSourceJobDetail(null);
      return;
    }

    let cancelled = false;
    let timer = 0;
    let controller: AbortController | null = null;
    const pollId = sourceProgressPollIdRef.current + 1;
    sourceProgressPollIdRef.current = pollId;

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled || sourceProgressPollIdRef.current !== pollId) {
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
        const nextJob = await refreshSourceJobDetail(sourceJobId, { signal: controller.signal });
        if (cancelled || sourceProgressPollIdRef.current !== pollId) {
          return;
        }
        setSourceJobDetail((prev) => (equalSourceJobDetail(prev, nextJob) ? prev : nextJob));
        if (!nextJob) {
          return;
        }

        if (!isSourceJobActive(nextJob)) {
          if (activeChat?.id === nextJob.chatId) {
            await Promise.allSettled([
              hydrateChatLiveState(activeChat.id),
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

      scheduleNextPoll(currentPollDelay(SOURCE_DETAIL_POLL_VISIBLE_MS, SOURCE_DETAIL_POLL_HIDDEN_MS));
    };

    void poll();

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearTimeout(timer);
    };
  }, [
    activeChat?.id,
    hydrateChatLiveState,
    refreshActiveChat,
    refreshChats,
    refreshSourceJobDetail,
    refreshSourceJobsForChat,
    refreshStage2RunsForChat,
    sourceJobId
  ]);

  useEffect(() => {
    const progress = sourceJobDetail?.progress ?? null;
    if (!progress || !isSourceJobActive(sourceJobDetail) || currentStep !== 1) {
      setSourceJobElapsedMs(getSourceJobElapsedMs(progress));
      return;
    }

    let timer = 0;
    const tick = () => {
      setSourceJobElapsedMs(getSourceJobElapsedMs(progress));
      timer = window.setTimeout(
        tick,
        currentPollDelay(STAGE2_ELAPSED_TICK_MS, STAGE2_ELAPSED_TICK_HIDDEN_MS)
      );
    };
    tick();
    return () => {
      window.clearTimeout(timer);
    };
  }, [currentStep, sourceJobDetail]);

  const hasActiveSourceJobs = useMemo(
    () => sourceJobs.some((job) => isSourceJobActive(job)),
    [sourceJobs]
  );

  useEffect(() => {
    if (!activeChat?.id || !hasActiveSourceJobs) {
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
        await refreshSourceJobsForChat(activeChat.id, { signal: controller.signal });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        scheduleNextPoll(currentPollDelay(STAGE2_POLL_RETRY_VISIBLE_MS, STAGE2_POLL_RETRY_HIDDEN_MS));
        return;
      }

      scheduleNextPoll(currentPollDelay(SOURCE_JOBS_POLL_VISIBLE_MS, SOURCE_JOBS_POLL_HIDDEN_MS));
    };

    void poll();

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearTimeout(timer);
    };
  }, [activeChat?.id, hasActiveSourceJobs, refreshSourceJobsForChat]);

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
              hydrateChatLiveState(activeChat.id, { preferredStep: 2 }),
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
    hydrateChatLiveState,
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
          backgroundAssetId: activeChannel.defaultBackgroundAssetId,
          backgroundAssetMimeType:
            findAssetById(channelAssets, activeChannel.defaultBackgroundAssetId)?.mimeType ?? null,
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

  const enqueueSourceJobForChat = async (input: {
    chatId?: string | null;
    channelId?: string | null;
    url: string;
    trigger: "fetch" | "comments";
    autoRunStage2: boolean;
  }): Promise<{
    chat: ChatThread;
    job: SourceJobDetail | null;
    reused: boolean;
    activeStage2Run: Stage2RunDetail | null;
  }> => {
    const response = await fetch("/api/pipeline/source", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chatId: input.chatId ?? undefined,
        channelId: input.channelId ?? undefined,
        url: input.url,
        trigger: input.trigger,
        autoRunStage2: input.autoRunStage2
      })
    });

    if (response.status === 409) {
      const body = (await response.json()) as {
        error?: string;
        chat?: ChatThread;
        job?: SourceJobDetail;
        run?: Stage2RunDetail;
      };
      if (body.error === "source_job_already_active" && body.chat && body.job) {
        setSourceJobId(body.job.jobId);
        setSourceJobDetail(body.job);
        setSourceJobs((current) => {
          const deduped = current.filter((item) => item.jobId !== body.job!.jobId);
          return [body.job!, ...deduped].slice(0, 20);
        });
        return { chat: body.chat, job: body.job, reused: true, activeStage2Run: null };
      }
      if (body.error === "stage2_run_already_active" && body.chat && body.run) {
        setStage2RunId(body.run.runId);
        setStage2RunDetail(body.run);
        setStage2Runs((current) => {
          const deduped = current.filter((item) => item.runId !== body.run!.runId);
          return [body.run!, ...deduped].slice(0, 20);
        });
        await Promise.allSettled([
          refreshActiveChat(body.chat.id),
          refreshStage2RunsForChat(body.chat.id),
          refreshChats()
        ]);
        return { chat: body.chat, job: null, reused: true, activeStage2Run: body.run };
      }
      if (body.error === "stage2_run_already_active") {
        throw new Error("В этом чате уже идёт Stage 2. Дождитесь завершения перед новым получением источника.");
      }
    }

    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось запустить получение источника."));
    }

    const body = (await response.json()) as {
      chat: ChatThread;
      job: SourceJobDetail;
    };
    setSourceJobId(body.job.jobId);
    setSourceJobDetail(body.job);
    setSourceJobs((current) => {
      const deduped = current.filter((item) => item.jobId !== body.job.jobId);
      return [body.job, ...deduped].slice(0, 20);
    });
    await Promise.allSettled([
      refreshActiveChat(body.chat.id),
      refreshSourceJobsForChat(body.chat.id),
      refreshChats()
    ]);
    return { chat: body.chat, job: body.job, reused: false, activeStage2Run: null };
  };

  const runStage2ForChat = async (
    chat: Pick<ChatThread, "id" | "url">,
    instruction: string,
    mode: "manual" | "auto" | "regenerate",
    options?: { baseRunId?: string | null }
  ): Promise<{ run: Stage2RunDetail; reused: boolean }> => {
    if (!codexLoggedIn) {
      throw new Error("Shared Codex недоступен. Обратитесь к владельцу.");
    }

    const trimmedInstruction = instruction.trim();
    const response = await fetch("/api/pipeline/stage2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chatId: chat.id,
        url: chat.url,
        userInstruction: trimmedInstruction || undefined,
        mode,
        baseRunId: options?.baseRunId ?? undefined
      })
    });

    if (response.status === 409) {
      const body = (await response.json()) as {
        error?: string;
        run?: Stage2RunDetail;
      };
      if (body.error === "stage2_run_already_active" && body.run) {
        setStage2RunId(body.run.runId);
        setStage2RunDetail(body.run);
        setStage2Runs((current) => {
          const deduped = current.filter((item) => item.runId !== body.run!.runId);
          return [body.run!, ...deduped].slice(0, 20);
        });
        return { run: body.run, reused: true };
      }
      if (body.error === "source_job_already_active") {
        throw new Error("Сначала дождитесь окончания получения источника для этого чата.");
      }
    }

    if (!response.ok) {
      throw new Error(await parseError(response, "Stage 2 завершился ошибкой."));
    }

    const body = (await response.json()) as { run: Stage2RunDetail };
    const run = body.run;
    await appendEvent(chat.id, {
      role: "user",
      type: "stage2",
      text:
        mode === "auto"
          ? "Auto Stage 2 запущен сразу после Step 1."
          : mode === "regenerate"
            ? trimmedInstruction
              ? `Пользователь запустил быструю перегенерацию Stage 2 с инструкцией: ${trimmedInstruction}`
              : "Пользователь запустил быструю перегенерацию Stage 2."
          : trimmedInstruction
            ? `Пользователь запустил Stage 2 с инструкцией: ${trimmedInstruction}`
            : "Пользователь запустил Stage 2."
    }).catch(() => undefined);
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
      return { run: nextRun, reused: false };
    }

    return { run, reused: false };
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
    if (sourceJobBlockedReason) {
      setStatusType("error");
      setStatus(sourceJobBlockedReason);
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
    setIsSourceEnqueueing(true);
    setStatus("");
    setStatusType("");

    try {
      const { chat, job, reused, activeStage2Run } = await enqueueSourceJobForChat({
        chatId: sourceFetchReusesActiveChat ? activeChat?.id ?? null : null,
        channelId: activeChannelId,
        url,
        trigger: "fetch",
        autoRunStage2: codexLoggedIn
      });
      setDraftUrl("");
      await hydrateChatLiveState(chat.id, {
        preferredStep: activeStage2Run ? 2 : 1
      });
      if (activeStage2Run) {
        setCurrentStep(2);
        setStatusType("ok");
        setStatus("Для этого источника уже идёт Stage 2. Подключился к существующему чату и запуску.");
        return;
      }
      showNextChatShortcutToast(chat.id);
      setCurrentStep(1);
      setStatusType("ok");
      setStatus(
        reused
          ? "Для этого чата уже идёт получение источника. Подключился к существующему процессу."
          : job?.progress.detail ??
            (codexLoggedIn
              ? "Получение источника запущено. Step 2 стартует автоматически после завершения Step 1."
              : "Получение источника запущено. Можно переключаться между чатами и вернуться позже.")
      );
    } catch (error) {
      const message = getUiErrorMessage(error, "Не удалось загрузить источник.");
      setCurrentStep(1);
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsSourceEnqueueing(false);
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
    if (isSourceJobVisibleRunning) {
      setStatusType("error");
      setStatus("Для этого чата уже идёт получение комментариев/источника.");
      return;
    }
    if (isStage2RunVisibleRunning) {
      setStatusType("error");
      setStatus("Сначала дождитесь окончания Stage 2 для этого чата.");
      return;
    }

    setBusyAction("comments");
    setIsBusy(true);
    setIsSourceEnqueueing(true);
    setStatus("");
    setStatusType("");

    try {
      const { chat: refreshedChat, reused, activeStage2Run } = await enqueueSourceJobForChat({
        chatId: chat.id,
        url: chat.url,
        trigger: "comments",
        autoRunStage2: false
      });
      await hydrateChatLiveState(refreshedChat.id, {
        preferredStep: activeStage2Run ? 2 : 1
      });
      if (activeStage2Run) {
        setCurrentStep(2);
        setStatusType("ok");
        setStatus("Для этого источника уже идёт Stage 2. Подключился к существующему чату и запуску.");
        return;
      }
      showNextChatShortcutToast(refreshedChat.id);
      setStatusType("ok");
      setStatus(
        reused
          ? "Для этого чата уже идёт получение комментариев. Подключился к существующему процессу."
          : "Получение комментариев запущено в фоне."
      );
    } catch (error) {
      const message = getUiErrorMessage(error, "Не удалось загрузить комментарии.");
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsSourceEnqueueing(false);
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
    if (isSourceJobVisibleRunning) {
      setStatusType("error");
      setStatus("Сначала дождитесь окончания получения источника для этого чата.");
      return;
    }
    if (isStage2RunVisibleRunning) {
      setCurrentStep(2);
      setStatusType("ok");
      setStatus("Stage 2 уже выполняется в фоне. Подключён текущий запуск.");
      return;
    }

    setIsStage2Enqueueing(true);
    setBusyAction("stage2");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      const { run, reused } = await runStage2ForChat(chat, stage2Instruction, "manual");
      setStage2RunId(run.runId);
      setCurrentStep(2);
      setStatusType("ok");
      setStatus(
        reused
          ? "Для этого чата уже идёт Stage 2. Подключился к существующему запуску."
          : "Stage 2 запущен в фоне. Прогресс и результат сохраняются и переживут обновление страницы."
      );
    } catch (error) {
      const message = getUiErrorMessage(error, "Stage 2 не удалось запустить.");
      setStatusType("error");
      setStatus(message);
    } finally {
      setIsStage2Enqueueing(false);
      setIsBusy(false);
      setBusyAction("");
    }
  };

  const handleQuickRegenerateStage2 = async (): Promise<void> => {
    const chat = requireActiveChat();
    if (!chat) {
      return;
    }
    if (!selectedStage2RunnableBaseRunId) {
      setStatusType("error");
      setStatus(
        quickRegenerateBlockedReason ??
          "Сначала выберите готовый запуск Stage 2 с результатом для быстрой перегенерации."
      );
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
    if (isSourceJobVisibleRunning) {
      setStatusType("error");
      setStatus("Сначала дождитесь окончания получения источника для этого чата.");
      return;
    }
    if (isStage2RunVisibleRunning) {
      setCurrentStep(2);
      setStatusType("ok");
      setStatus("Stage 2 уже выполняется в фоне. Подключён текущий запуск.");
      return;
    }

    setIsStage2Enqueueing(true);
    setBusyAction("stage2");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      const { run, reused } = await runStage2ForChat(chat, stage2Instruction, "regenerate", {
        baseRunId: selectedStage2RunnableBaseRunId
      });
      setStage2RunId(run.runId);
      setCurrentStep(2);
      setStatusType("ok");
      setStatus(
        reused
          ? "Для этого чата уже идёт Stage 2. Подключился к существующему запуску."
          : "Быстрая перегенерация Stage 2 запущена в фоне и использует выбранный запуск как базу."
      );
    } catch (error) {
      const message = getUiErrorMessage(error, "Быструю перегенерацию Stage 2 не удалось запустить.");
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
    if (sourceJobDetail?.result?.commentsPayload) {
      return sourceJobDetail.result.commentsPayload;
    }
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
  const stage1FetchState = useMemo(() => {
    const eventState = extractStage1FetchState(activeChat);
    const sourceResult = sourceJobDetail?.result;
    if (!sourceResult) {
      return eventState;
    }
    return {
      ready: sourceResult.stage1Ready || eventState.ready,
      commentsAvailable: sourceResult.commentsAvailable || eventState.commentsAvailable,
      commentsError: sourceResult.commentsError ?? eventState.commentsError
    };
  }, [activeChat, sourceJobDetail?.result]);
  const selectedSourceJobSummary = useMemo(
    () => sourceJobs.find((job) => job.jobId === sourceJobId) ?? null,
    [sourceJobId, sourceJobs]
  );
  const selectedSourceJobDetail = useMemo(
    () => (sourceJobDetail?.jobId === sourceJobId ? sourceJobDetail : null),
    [sourceJobDetail, sourceJobId]
  );
  const visibleSourceJob = selectedSourceJobDetail ?? selectedSourceJobSummary;
  const isSourceJobVisibleRunning = useMemo(
    () => isSourceJobActive(visibleSourceJob),
    [visibleSourceJob]
  );

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
  const selectedStage2RunnableBaseRunId = useMemo(() => {
    if (selectedStage2RunDetail?.status === "completed" && selectedStage2RunDetail.result) {
      return selectedStage2RunDetail.runId;
    }
    if (selectedStage2RunSummary?.status === "completed" && selectedStage2RunSummary.hasResult) {
      return selectedStage2RunSummary.runId;
    }
    return null;
  }, [selectedStage2RunDetail, selectedStage2RunSummary]);
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
  const visibleStage2Diagnostics = useMemo(
    () =>
      normalizeStage2DiagnosticsForView(visibleStage2Result?.diagnostics ?? null, {
        channelName: activeChannel?.name ?? null,
        channelUsername: activeChannel?.username ?? null
      }),
    [visibleStage2Result?.diagnostics, activeChannel?.name, activeChannel?.username]
  );
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
    return getStage2SelectionDefaults(visibleStage2Result);
  }, [visibleStage2Result]);
  const isStage2RunVisibleRunning = useMemo(
    () => isStage2RunActive(selectedStage2RunDetail ?? selectedStage2RunSummary),
    [selectedStage2RunDetail, selectedStage2RunSummary]
  );
  const sourceFetchReusesActiveChat = useMemo(
    () =>
      shouldReuseActiveChatForSourceFetch({
        activeChatId: activeChat?.id ?? null,
        activeChatUrl: activeChat?.url ?? null,
        draftUrl
      }),
    [activeChat?.id, activeChat?.url, draftUrl]
  );
  useEffect(() => {
    if (!activeChat) {
      return;
    }
    if (isSourceJobVisibleRunning) {
      setCurrentStep((prev) => (prev === 1 ? prev : 1));
      return;
    }
    if (isStage2RunVisibleRunning) {
      setCurrentStep((prev) => (prev === 2 ? prev : 2));
    }
  }, [activeChat, isSourceJobVisibleRunning, isStage2RunVisibleRunning]);
  const sourceJobBlockedReason = useMemo(() => {
    return resolveSourceFetchBlockedReason({
      activeChannelId,
      fetchSourceAvailable,
      fetchSourceBlockedReason,
      reusesActiveChat: sourceFetchReusesActiveChat,
      hasActiveSourceJob: isSourceJobVisibleRunning,
      hasActiveStage2Run: isStage2RunVisibleRunning
    });
  }, [
    activeChannelId,
    fetchSourceAvailable,
    fetchSourceBlockedReason,
    isSourceJobVisibleRunning,
    isStage2RunVisibleRunning,
    sourceFetchReusesActiveChat
  ]);
  const canFetchSourceForActiveChat = useMemo(
    () => Boolean(activeChannelId) && !sourceJobBlockedReason && !isSourceEnqueueing,
    [activeChannelId, isSourceEnqueueing, sourceJobBlockedReason]
  );
  const canRunStage2ForActiveChat = useMemo(() => {
    if (!activeChat || !codexLoggedIn || !stage2RuntimeAvailable) {
      return false;
    }
    if (!stage1FetchState.ready || isStage2Enqueueing || isSourceJobVisibleRunning || isStage2RunVisibleRunning) {
      return false;
    }
    return true;
  }, [
    activeChat,
    codexLoggedIn,
    stage1FetchState.ready,
    stage2RuntimeAvailable,
    isStage2Enqueueing,
    isSourceJobVisibleRunning,
    isStage2RunVisibleRunning
  ]);
  const canQuickRegenerateForActiveChat = useMemo(
    () => Boolean(selectedStage2RunnableBaseRunId) && canRunStage2ForActiveChat,
    [canRunStage2ForActiveChat, selectedStage2RunnableBaseRunId]
  );
  const effectiveStage2BlockedReason = useMemo(() => {
    if (isSourceJobVisibleRunning) {
      return "Сначала дождитесь окончания получения источника для этого чата.";
    }
    if (isStage2RunVisibleRunning) {
      return "Для этого чата уже идёт Stage 2.";
    }
    if (!stage1FetchState.ready) {
      return "Сначала получите источник.";
    }
    return stage2BlockedReason;
  }, [
    isSourceJobVisibleRunning,
    isStage2RunVisibleRunning,
    stage1FetchState.ready,
    stage2BlockedReason
  ]);
  const quickRegenerateBlockedReason = useMemo(() => {
    if (!selectedStage2RunnableBaseRunId) {
      return "Сначала выберите готовый запуск Stage 2 с результатом.";
    }
    return effectiveStage2BlockedReason;
  }, [effectiveStage2BlockedReason, selectedStage2RunnableBaseRunId]);
  const chatTraceBlockedReason = useMemo(() => {
    if (!activeChat) {
      return "Сначала выберите ролик из истории или получите источник.";
    }
    if (!canOperateActiveChannel) {
      return "У вас нет прав на выгрузку trace для этого канала.";
    }
    return null;
  }, [activeChat, canOperateActiveChannel]);
  const canDownloadChatTrace = useMemo(
    () => !chatTraceBlockedReason && busyAction !== "trace-export",
    [busyAction, chatTraceBlockedReason]
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
    return getSelectedStage2Caption(visibleStage2Result, selectedOption);
  }, [selectedOption, visibleStage2Result]);

  const selectedTitle = useMemo(() => {
    return getSelectedStage2Title(visibleStage2Result, selectedTitleOption);
  }, [selectedTitleOption, visibleStage2Result]);

  const latestStage3Version = useMemo(
    () => stage3Versions[stage3Versions.length - 1] ?? null,
    [stage3Versions]
  );

  const stage3HandoffSummary = useMemo(
    () =>
      buildStage2ToStage3HandoffSummary({
        stage2: visibleStage2Result,
        draft: activeDraft,
        latestVersion: latestStage3Version,
        selectedCaptionOption: selectedOption,
        selectedTitleOption,
        currentTopText: stage3TopText,
        currentBottomText: stage3BottomText
      }),
    [
      activeDraft,
      latestStage3Version,
      selectedOption,
      selectedTitleOption,
      stage3BottomText,
      stage3TopText,
      visibleStage2Result
    ]
  );

  const syncStage3AutoAppliedCaption = useCallback(
    (nextTopText: string, nextBottomText: string, preferredOption?: number | null) => {
      if (!activeChat?.id || !visibleStage2Result) {
        autoAppliedCaptionRef.current = null;
        return;
      }

      const sourceCaption = getSelectedStage2Caption(
        visibleStage2Result,
        preferredOption ?? selectedOption ?? null
      );
      if (sourceCaption && nextTopText === sourceCaption.top && nextBottomText === sourceCaption.bottom) {
        autoAppliedCaptionRef.current = {
          chatId: activeChat.id,
          option: sourceCaption.option,
          top: sourceCaption.top,
          bottom: sourceCaption.bottom
        };
        return;
      }

      autoAppliedCaptionRef.current = null;
    },
    [activeChat?.id, selectedOption, visibleStage2Result]
  );

  const handleStage3TopTextChange = useCallback(
    (value: string) => {
      setStage3TopText(value);
      syncStage3AutoAppliedCaption(value, stage3BottomText);
    },
    [stage3BottomText, syncStage3AutoAppliedCaption]
  );

  const handleStage3BottomTextChange = useCallback(
    (value: string) => {
      setStage3BottomText(value);
      syncStage3AutoAppliedCaption(stage3TopText, value);
    },
    [stage3TopText, syncStage3AutoAppliedCaption]
  );

  const handleApplyStage2CaptionToStage3 = useCallback(
    (option: number, mode: "all" | "top" | "bottom") => {
      if (!visibleStage2Result) {
        return;
      }
      const sourceCaption =
        visibleStage2Result.output.captionOptions.find((item) => item.option === option) ?? null;
      const nextText = applyStage2CaptionToStage3Text({
        currentTopText: stage3TopText,
        currentBottomText: stage3BottomText,
        caption: sourceCaption,
        mode
      });

      if (mode === "all") {
        setSelectedOption(option);
        syncStage3AutoAppliedCaption(nextText.topText, nextText.bottomText, option);
      } else {
        syncStage3AutoAppliedCaption(nextText.topText, nextText.bottomText);
      }

      setStage3TopText(nextText.topText);
      setStage3BottomText(nextText.bottomText);
    },
    [
      stage3BottomText,
      stage3TopText,
      syncStage3AutoAppliedCaption,
      visibleStage2Result
    ]
  );

  const handleResetStage3CaptionText = useCallback(
    (mode: "all" | "top" | "bottom") => {
      if (!selectedCaption) {
        return;
      }
      const nextText = applyStage2CaptionToStage3Text({
        currentTopText: stage3TopText,
        currentBottomText: stage3BottomText,
        caption: selectedCaption,
        mode
      });

      syncStage3AutoAppliedCaption(nextText.topText, nextText.bottomText, selectedCaption.option);
      setStage3TopText(nextText.topText);
      setStage3BottomText(nextText.bottomText);
    },
    [selectedCaption, stage3BottomText, stage3TopText, syncStage3AutoAppliedCaption]
  );

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
    const normalizedCurrentRenderPlan = normalizedStage3RenderPlan;
    const renderPlanOverride = buildStage3DraftRenderPlanOverride(
      normalizedCurrentRenderPlan,
      baseRenderPlan
    );
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
        renderPlan: renderPlanOverride,
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
      {
        id: 2,
        label: "Проверить и выбрать",
        enabled: Boolean(activeChat && (stage1FetchState.ready || isStage2RunVisibleRunning))
      },
      { id: 3, label: "Рендер видео", enabled: Boolean(visibleStage2Result) }
    ],
    [activeChat, isStage2RunVisibleRunning, stage1FetchState.ready, visibleStage2Result]
  );

  const activeLiveAction = useMemo<ChatListItem["liveAction"]>(() => {
    if (!activeChat) {
      return null;
    }
    if (isSourceJobVisibleRunning) {
      return visibleSourceJob?.progress.activeStageId === "comments" ? "Comments" : "Fetching";
    }
    if (isStage2RunVisibleRunning) {
      return "Stage 2";
    }
    switch (busyAction) {
      case "render":
        return "Rendering";
      default:
        return null;
    }
  }, [activeChat, busyAction, isSourceJobVisibleRunning, isStage2RunVisibleRunning, visibleSourceJob?.progress.activeStageId]);

  useEffect(() => {
    if (!activeChat || !isSourceJobVisibleRunning || !visibleSourceJob) {
      return;
    }
    const liveDetail = visibleSourceJob.progress.detail?.trim();
    if (!liveDetail) {
      return;
    }
    const jobPrefix = `Job ${visibleSourceJob.jobId.slice(0, 8)}`;
    setStatus((prev) => {
      const normalized = prev.trim();
      if (
        normalized.length === 0 ||
        normalized.startsWith(jobPrefix) ||
        normalized.startsWith("Получение источника запущено.") ||
        normalized.startsWith("Получение комментариев запущено в фоне.") ||
        normalized.startsWith("Для этого чата уже идёт получение источника.") ||
        normalized.startsWith("Для этого чата уже идёт получение комментариев.")
      ) {
        return liveDetail;
      }
      return prev;
    });
  }, [activeChat, isSourceJobVisibleRunning, visibleSourceJob]);

  const historyItems = useMemo(() => {
    if (!activeChat) {
      return chatList;
    }
    return chatList.map((item) => {
      if (item.id !== activeChat.id) {
        return item;
      }
      const nextLiveAction = activeLiveAction ?? item.liveAction ?? null;
      const nextPreferredStep = isSourceJobVisibleRunning
        ? 1
        : isStage2RunVisibleRunning
          ? 2
          : item.preferredStep;
      if (item.liveAction === nextLiveAction && item.preferredStep === nextPreferredStep) {
        return item;
      }
      return {
        ...item,
        preferredStep: nextPreferredStep,
        liveAction: nextLiveAction
      };
    });
  }, [activeChat?.id, activeLiveAction, chatList, isSourceJobVisibleRunning, isStage2RunVisibleRunning]);

  const handleHistoryOpen = useCallback(async (id: string, step?: 1 | 2 | 3): Promise<void> => {
    setStatus("");
    setStatusType("");

    if (!id) {
      desiredActiveChatIdRef.current = null;
      activeChatIdRef.current = null;
      setActiveChat(null);
      setActiveDraft(null);
      setCurrentStep(1);
      return;
    }

    try {
      await flushActiveDraftSave();
      await hydrateChatLiveState(id, step ? { preferredStep: step } : undefined);
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось открыть элемент истории."));
    }
  }, [flushActiveDraftSave, getUiErrorMessage, hydrateChatLiveState]);

  const handleResetFlow = (): void => {
    void flushActiveDraftSave();
    desiredActiveChatIdRef.current = null;
    activeChatIdRef.current = null;
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

  const showNextChatShortcutToast = useCallback(
    (chatId: string): void => {
      const toastId = `next-chat-shortcut:${chatId}`;
      showAppToast({
        id: toastId,
        tone: "neutral",
        title: "Следующий ролик",
        message: "Можно уже открыть новый чат для следующей ссылки.",
        variant: "shortcut",
        actionLabel: "Создать новый чат",
        durationMs: 5000,
        autoHideMs: 5000,
        onAction: () => {
          dismissAppToast(toastId);
          handleCreateNextChatShortcut(chatId);
        }
      });
    },
    [dismissAppToast, showAppToast]
  );

  const handleCreateNextChatShortcut = (toastChatId?: string | null): void => {
    const resolvedToastChatId = toastChatId ?? activeChat?.id ?? null;
    if (resolvedToastChatId) {
      dismissAppToast(`next-chat-shortcut:${resolvedToastChatId}`);
    }
    handleResetFlow();
    setStatusType("ok");
    setStatus("Открыт новый чат. Вставьте следующую ссылку.");
  };

  const handleSwitchChannel = useCallback(
    (channelId: string): void => {
      if (!channelId || channelId === activeChannelId) {
        return;
      }
      void flushActiveDraftSave();
      const nextChannel = channels.find((channel) => channel.id === channelId) ?? null;
      setActiveChannelId(channelId);
      desiredActiveChatIdRef.current = null;
      activeChatIdRef.current = null;
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
        desiredActiveChatIdRef.current = null;
        activeChatIdRef.current = null;
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

  const handleCreateChannel = (): void => {
    setIsChannelOnboardingOpen(true);
  };

  const handleStartChannelStyleDiscovery = useCallback(async (input: {
    name: string;
    username: string;
    stage2HardConstraints: Stage2HardConstraints;
    referenceLinks: string[];
  }): Promise<ChannelStyleDiscoveryRunDetail> => {
    const response = await fetch("/api/channels/style-discovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      throw new Error(
        await parseError(response, "Не удалось запустить подбор стартовых стилистических направлений.")
      );
    }
    const body = (await response.json()) as { run?: ChannelStyleDiscoveryRunDetail };
    if (!body.run) {
      throw new Error("Сервис style discovery не вернул идентификатор запуска.");
    }
    return body.run;
  }, [parseError]);

  const handleGetChannelStyleDiscoveryRun = useCallback(async (runId: string): Promise<ChannelStyleDiscoveryRunDetail> => {
    const response = await fetch(`/api/channels/style-discovery?runId=${encodeURIComponent(runId)}`);
    if (!response.ok) {
      throw new Error(
        await parseError(response, "Не удалось загрузить состояние style discovery.")
      );
    }
    const body = (await response.json()) as { run?: ChannelStyleDiscoveryRunDetail };
    if (!body.run) {
      throw new Error("Сервис style discovery вернул пустой запуск.");
    }
    return body.run;
  }, [parseError]);

  const handleCreateChannelFromOnboarding = async (input: {
    name: string;
    username: string;
    stage2ExamplesConfig: Stage2ExamplesConfig;
    stage2HardConstraints: Stage2HardConstraints;
    stage2StyleProfile: Channel["stage2StyleProfile"];
    referenceUrls: string[];
    avatarFile: File | null;
  }): Promise<void> => {
    void input.referenceUrls;
    setBusyAction("channel-create");
    try {
      const response = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          username: input.username,
          stage2ExamplesConfig: input.stage2ExamplesConfig,
          stage2HardConstraints: input.stage2HardConstraints,
          stage2StyleProfile: input.stage2StyleProfile
        })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось создать канал."));
      }
      const body = (await response.json()) as { channel: Channel };
      let avatarNotice: string | null = null;
      if (input.avatarFile) {
        try {
          const formData = new FormData();
          formData.append("kind", "avatar");
          formData.append("file", input.avatarFile);
          const avatarResponse = await fetch(`/api/channels/${body.channel.id}/assets`, {
            method: "POST",
            body: formData
          });
          if (!avatarResponse.ok) {
            throw new Error(await parseError(avatarResponse, "Не удалось загрузить аватар."));
          }
        } catch (error) {
          avatarNotice = getUiErrorMessage(error, "Канал создан, но аватар загрузить не удалось.");
        }
      }

      await refreshChannels(body.channel.id);
      handleSwitchChannel(body.channel.id);
      setIsChannelOnboardingOpen(false);
      setStatusType("ok");
      setStatus(avatarNotice ?? "Канал создан через новый пошаговый мастер.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось создать канал."));
      throw error;
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
      stage2StyleProfile: Channel["stage2StyleProfile"];
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
        const resolvedAvatar = channelAssets.find((item) => item.id === body.channel.avatarAssetId);
        const resolvedBg = channelAssets.find((item) => item.id === body.channel.defaultBackgroundAssetId);
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
                  ? body.channel.defaultBackgroundAssetId
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

  const handleSaveWorkspaceStage2Defaults = async (
    patch: Partial<{
      stage2ExamplesCorpusJson: string;
      stage2HardConstraints: Stage2HardConstraints;
      stage2PromptConfig: Stage2PromptConfig;
    }>
  ): Promise<void> => {
    setBusyAction("channel-save");
    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось сохранить общие настройки Stage 2."));
      }
      const body = (await response.json()) as {
        stage2ExamplesCorpusJson?: string;
        stage2HardConstraints?: Stage2HardConstraints;
        stage2PromptConfig?: Stage2PromptConfig;
      };
      if (typeof body.stage2ExamplesCorpusJson === "string") {
        setWorkspaceStage2ExamplesCorpusJson(body.stage2ExamplesCorpusJson);
      }
      if (body.stage2HardConstraints) {
        setWorkspaceStage2HardConstraints(normalizeStage2HardConstraints(body.stage2HardConstraints));
      }
      if (body.stage2PromptConfig) {
        setWorkspaceStage2PromptConfig(normalizeStage2PromptConfig(body.stage2PromptConfig));
      }
    } finally {
      setBusyAction("");
    }
  };

  const handleSubmitStage2OptionFeedback = async (input: {
    option: number;
    kind: "more_like_this" | "less_like_this" | "selected_option";
    scope: "option" | "top" | "bottom";
    noteMode: "soft_preference" | "hard_rule" | "situational_note";
    note: string;
  }): Promise<void> => {
    if (!activeChannelId || !visibleStage2Result) {
      throw new Error("Сначала выберите канал и загрузите результаты Stage 2.");
    }
    const option = visibleStage2Result.output.captionOptions.find(
      (candidate) => candidate.option === input.option
    );
    if (!option) {
      throw new Error("Выбранный вариант Stage 2 не найден.");
    }

    const response = await fetch(`/api/channels/${activeChannelId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: activeChat?.id ?? null,
        stage2RunId: visibleStage2Result.stage2Run?.runId ?? null,
        kind: input.kind,
        scope: input.scope,
        noteMode: input.noteMode,
        note: input.note.trim() || null,
        optionSnapshot: {
          candidateId: option.candidateId ?? `option_${option.option}`,
          optionNumber: option.option,
          top: option.top,
          bottom: option.bottom,
          angle: option.angle ?? "",
          styleDirectionIds: option.styleDirectionIds ?? [],
          explorationMode: option.explorationMode ?? "aligned"
        }
      })
    });
    if (!response.ok) {
      throw new Error(await parseError(response, "Не удалось сохранить обратную связь."));
    }
    const body = (await response.json()) as ChannelFeedbackResponse & { event?: unknown };
    setChannelFeedbackHistory(body.historyEvents ?? []);
    setChannelEditorialMemory(body.editorialMemory ?? null);
    const savedModeLabel =
      input.noteMode === "hard_rule"
        ? "Жёсткое правило"
        : input.noteMode === "situational_note"
          ? "Ситуативная заметка"
          : "Мягкое предпочтение";
    setStatusType("ok");
    setStatus(
      input.kind === "selected_option"
        ? "Выбор сохранён: канал воспримет его как лёгкий положительный сигнал."
        : input.noteMode === "hard_rule"
          ? `${savedModeLabel} сохранено: этот сигнал останется активным правилом канала, пока его не удалят.`
          : input.kind === "more_like_this"
        ? input.scope === "top"
          ? `${savedModeLabel} для TOP сохранено: будущие запуски мягко подтянутся к этому ходу.`
          : input.scope === "bottom"
            ? `${savedModeLabel} для BOTTOM сохранено: будущие запуски мягко подтянутся к этому ходу.`
            : `${savedModeLabel} сохранено: будущие запуски будут тяготеть ближе к этому варианту.`
        : input.kind === "less_like_this"
          ? input.scope === "top"
            ? `${savedModeLabel} для TOP сохранено: будущие запуски мягко уйдут от этого хода.`
            : input.scope === "bottom"
              ? `${savedModeLabel} для BOTTOM сохранено: будущие запуски мягко уйдут от этого хода.`
              : `${savedModeLabel} сохранено: будущие запуски будут мягко уходить от этого варианта.`
          : "Выбор сохранён: канал воспримет его как лёгкий положительный сигнал."
    );
  };

  const handleDeleteChannelFeedbackEvent = async (eventId: string): Promise<void> => {
    if (!activeChannelId) {
      setStatusType("error");
      setStatus("Сначала выберите канал.");
      return;
    }
    if (!window.confirm("Удалить эту реакцию канала из истории и обучающей памяти?")) {
      return;
    }

    setDeletingChannelFeedbackEventId(eventId);
    try {
      const response = await fetch(`/api/channels/${activeChannelId}/feedback`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось удалить реакцию канала."));
      }
      const body = (await response.json()) as ChannelFeedbackResponse & { deletedEventId?: string };
      setChannelFeedbackHistory(body.historyEvents ?? []);
      setChannelEditorialMemory(body.editorialMemory ?? null);
      setStatusType("ok");
      setStatus("Реакция удалена: editorial memory сразу пересчитана по оставшимся сигналам.");
    } catch (error) {
      setStatusType("error");
      setStatus(error instanceof Error ? error.message : "Не удалось удалить реакцию канала.");
    } finally {
      setDeletingChannelFeedbackEventId(null);
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

  const handleDownloadChatTrace = async (): Promise<void> => {
    const chat = activeChat;
    if (!chat) {
      setStatusType("error");
      setStatus("Сначала выберите ролик из истории или получите источник.");
      return;
    }
    if (!canOperateActiveChannel) {
      setStatusType("error");
      setStatus("У вас нет прав на выгрузку trace для этого канала.");
      return;
    }

    setBusyAction("trace-export");
    try {
      const params = new URLSearchParams();
      if (stage2RunId) {
        params.set("selectedRunId", stage2RunId);
      }
      const response = await fetch(
        `/api/chat-trace/${encodeURIComponent(chat.id)}${params.toString() ? `?${params.toString()}` : ""}`
      );
      if (!response.ok) {
        throw new Error(await parseError(response, "Не удалось выгрузить историю ролика."));
      }
      const blob = await response.blob();
      const fileName =
        parseDownloadFileName(response) ??
        buildChatTraceExportFileName({
          channelUsername: activeChannel?.username ?? null,
          chatId: chat.id,
          exportedAt: new Date().toISOString()
        });
      triggerBlobDownload(blob, fileName);
      setStatusType("ok");
      setStatus("Полная история ролика выгружена.");
    } catch (error) {
      setStatusType("error");
      setStatus(getUiErrorMessage(error, "Не удалось выгрузить историю ролика."));
    } finally {
      setBusyAction("");
    }
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
      toasts={appToasts}
      onDismissToast={dismissAppToast}
      headerActions={
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            void handleDownloadChatTrace();
          }}
          disabled={!canDownloadChatTrace}
          title={!canDownloadChatTrace ? chatTraceBlockedReason ?? undefined : "Скачать полный trace JSON по текущему ролику"}
          aria-busy={busyAction === "trace-export"}
        >
          {busyAction === "trace-export" ? "Выгружаем..." : "Скачать историю"}
        </button>
      }
      details={
        <DetailsDrawer
          events={activeChat?.events ?? []}
          comments={latestComments}
          isBusyComments={isSourceJobVisibleRunning || isSourceEnqueueing || isStage2RunVisibleRunning}
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
      afterDetails={
        currentStep === 2 ? (
          <Stage2RunDiagnosticsPanels diagnostics={visibleStage2Diagnostics} />
        ) : null
      }
    >
      {currentStep === 1 ? (
        <Step1PasteLink
          draftUrl={draftUrl}
          activeUrl={activeChat?.url ?? null}
          sourceJob={selectedSourceJobDetail ?? (selectedSourceJobSummary ? { ...selectedSourceJobSummary, result: null } : null)}
          sourceJobElapsedMs={sourceJobElapsedMs}
          commentsFallbackActive={stage1FetchState.ready && !stage1FetchState.commentsAvailable}
          fetchBusy={isSourceJobVisibleRunning || isSourceEnqueueing}
          downloadBusy={busyAction === "download"}
          fetchAvailable={Boolean(canFetchSourceForActiveChat)}
          fetchBlockedReason={sourceJobBlockedReason}
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
          canRunStage2={canRunStage2ForActiveChat}
          canQuickRegenerate={canQuickRegenerateForActiveChat}
          runBlockedReason={effectiveStage2BlockedReason}
          quickRegenerateBlockedReason={quickRegenerateBlockedReason}
          canSubmitFeedback={Boolean(canOperateActiveChannel && activeChannelId && visibleStage2Result)}
          isLaunching={isStage2Enqueueing}
          isRunning={isStage2RunVisibleRunning}
          expectedDurationMs={stage2ExpectedDurationMs}
          elapsedMs={stage2ElapsedMs}
          selectedOption={selectedOption}
          selectedTitleOption={selectedTitleOption}
          onInstructionChange={setStage2Instruction}
          onQuickRegenerate={() => {
            void handleQuickRegenerateStage2();
          }}
          onRunStage2={() => {
            void handleRunStage2();
          }}
          onSelectRun={setStage2RunId}
          onSelectOption={setSelectedOption}
          onSelectTitleOption={setSelectedTitleOption}
          feedbackHistory={channelFeedbackHistory}
          feedbackHistoryLoading={isChannelFeedbackLoading}
          onSubmitOptionFeedback={handleSubmitStage2OptionFeedback}
          onDeleteFeedbackEvent={handleDeleteChannelFeedbackEvent}
          deletingFeedbackEventId={deletingChannelFeedbackEventId}
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
          captionSources={visibleStage2Result?.output.captionOptions ?? []}
          selectedCaptionOption={selectedOption ?? visibleStage2SelectionDefaults.captionOption}
          handoffSummary={stage3HandoffSummary}
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
          onTopTextChange={handleStage3TopTextChange}
          onBottomTextChange={handleStage3BottomTextChange}
          onApplyCaptionSource={handleApplyStage2CaptionToStage3}
          onResetCaptionText={handleResetStage3CaptionText}
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
        workspaceStage2HardConstraints={workspaceStage2HardConstraints}
        workspaceStage2PromptConfig={workspaceStage2PromptConfig}
        activeChannelId={activeChannelId}
        assets={channelAssets}
        currentUserRole={authState?.membership.role ?? null}
        onClose={() => setIsChannelManagerOpen(false)}
        onSelectChannel={handleSwitchChannel}
        canCreateChannel={canCreateChannel}
        onCreateChannel={handleCreateChannel}
        onDeleteChannel={(channelId) => {
          void handleDeleteChannel(channelId);
        }}
        onSaveChannel={handleSaveChannel}
        onShowGlobalToast={showAppToast}
        onDismissGlobalToast={dismissAppToast}
        onStartStyleDiscovery={handleStartChannelStyleDiscovery}
        onGetStyleDiscoveryRun={handleGetChannelStyleDiscoveryRun}
        feedbackHistory={channelFeedbackHistory}
        feedbackHistoryLoading={isChannelFeedbackLoading}
        editorialMemory={channelEditorialMemory}
        onDeleteFeedbackEvent={handleDeleteChannelFeedbackEvent}
        deletingFeedbackEventId={deletingChannelFeedbackEventId}
        onSaveWorkspaceStage2Defaults={handleSaveWorkspaceStage2Defaults}
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
      <ChannelOnboardingWizard
        open={isChannelOnboardingOpen}
        storageKey={channelOnboardingStorageKey}
        workspaceStage2ExamplesCorpusJson={workspaceStage2ExamplesCorpusJson}
        workspaceStage2HardConstraints={workspaceStage2HardConstraints}
        onClose={() => setIsChannelOnboardingOpen(false)}
        onStartStyleDiscovery={handleStartChannelStyleDiscovery}
        onGetStyleDiscoveryRun={handleGetChannelStyleDiscoveryRun}
        onSubmit={handleCreateChannelFromOnboarding}
      />
    </AppShell>
  );
}
