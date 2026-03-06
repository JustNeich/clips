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
  ChatEvent,
  ChatThread,
  Stage3AgentConversationItem,
  CodexAuthResponse,
  CommentsPayload,
  RuntimeCapabilitiesResponse,
  Stage3AgentRunResponse,
  Stage3IterationStopReason,
  Stage3RenderPlan,
  Stage3SessionStatus,
  Stage3StateSnapshot,
  Stage3TimelineResponse,
  Stage3Version,
  Stage2Response,
  UserRecord
} from "./components/types";
import { getTemplateComputed, STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
import {
  buildLegacyTimelineEntries,
  findLatestStage3AgentSessionRef,
  normalizeStage3SessionStatus
} from "../lib/stage3-legacy-bridge";

const CLIP_DURATION_SEC = 6;
const DEFAULT_TEXT_SCALE = 1.25;

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

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }
  if (error instanceof Error) {
    return error.name === "AbortError";
  }
  return false;
}

function extractCommentsPayload(data: unknown): CommentsPayload | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const candidate = data as Partial<CommentsPayload>;
  if (!Array.isArray(candidate.topComments) || !Array.isArray(candidate.allComments)) {
    return null;
  }
  return {
    title: String(candidate.title ?? "video"),
    totalComments: Number(candidate.totalComments ?? candidate.allComments.length ?? 0),
    topComments: candidate.topComments,
    allComments: candidate.allComments
  };
}

function extractStage2Payload(data: unknown): Stage2Response | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  if (!("output" in (data as Record<string, unknown>))) {
    return null;
  }
  return data as Stage2Response;
}

function fallbackRenderPlan(): Stage3RenderPlan {
  return {
    targetDurationSec: 6,
    timingMode: "auto",
    audioMode: "source_only",
    smoothSlowMo: false,
    videoZoom: 1,
    topFontScale: DEFAULT_TEXT_SCALE,
    bottomFontScale: DEFAULT_TEXT_SCALE,
    musicGain: 0.65,
    textPolicy: "strict_fit",
    segments: [],
    policy: "full_source_normalize",
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

function stripRenderPlanForPreview(plan: Stage3RenderPlan): Stage3RenderPlan {
  return {
    ...plan,
    // Keep preview lightweight: no prompt noise, no music mixing, no channel assets.
    prompt: "",
    audioMode: "source_only",
    musicGain: 0,
    musicAssetId: null,
    musicAssetMimeType: null,
    videoZoom: 1,
    topFontScale: plan.topFontScale,
    bottomFontScale: plan.bottomFontScale,
    backgroundAssetId: null,
    backgroundAssetMimeType: null,
    avatarAssetId: null,
    avatarAssetMimeType: null
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
            label:
              typeof segment.label === "string" && segment.label.trim()
                ? segment.label
                : `${startSec.toFixed(1)}-${endSec === null ? "end" : endSec.toFixed(1)}`
          };
        })
        .filter(
          (segment): segment is { startSec: number; endSec: number | null; label: string } =>
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
    smoothSlowMo: Boolean(candidate?.smoothSlowMo ?? base.smoothSlowMo),
    videoZoom:
      typeof candidate?.videoZoom === "number" && Number.isFinite(candidate.videoZoom)
        ? Math.min(1.6, Math.max(1, candidate.videoZoom))
        : base.videoZoom,
    topFontScale:
      typeof candidate?.topFontScale === "number" && Number.isFinite(candidate.topFontScale)
        ? Math.min(1.9, Math.max(0.7, candidate.topFontScale))
        : base.topFontScale,
    bottomFontScale:
      typeof candidate?.bottomFontScale === "number" && Number.isFinite(candidate.bottomFontScale)
        ? Math.min(1.9, Math.max(0.7, candidate.bottomFontScale))
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

function formatShortDate(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
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
      return "append segment";
    case "clear_segments":
      return "clear segments";
    case "set_audio_mode":
      return "audio";
    case "set_slowmo":
      return "slow-mo";
    case "set_top_font_scale":
      return "top size";
    case "set_bottom_font_scale":
      return "bottom size";
    case "rewrite_top_text":
      return "rewrite top";
    case "rewrite_bottom_text":
      return "rewrite bottom";
    case "set_timing_mode":
      return "timing";
    case "set_text_policy":
      return "text policy";
    case "set_music_gain":
      return "music";
    default:
      return op.replace(/^set_/, "").replace(/_/g, " ");
  }
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
        text: goal,
        meta: [
          `goalType: ${timeline.session.goalType}`,
          `target score ${timeline.session.targetScore.toFixed(2)}`
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
        title: "Rollback",
        text: "Создана новая версия-откат от выбранной точки timeline.",
        meta: [targetVersionId ? `target ${shorten(targetVersionId, 18)}` : "target unknown", reason],
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
      text: iteration.judgeNotes || iteration.plan.rationale,
      meta: [
        `score ${iteration.scores.total.toFixed(2)}`,
        `gain ${iteration.scores.stepGain >= 0 ? "+" : ""}${iteration.scores.stepGain.toFixed(2)}`,
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
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [channelAssets, setChannelAssets] = useState<ChannelAsset[]>([]);
  const [channelAccessGrants, setChannelAccessGrants] = useState<ChannelAccessGrant[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<Array<{ user: UserRecord; role: AppRole }>>([]);
  const [isChannelManagerOpen, setIsChannelManagerOpen] = useState(false);
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [activeChat, setActiveChat] = useState<ChatThread | null>(null);

  const [codexAuth, setCodexAuth] = useState<CodexAuthResponse | null>(null);
  const [isCodexAuthLoading, setIsCodexAuthLoading] = useState(false);
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilitiesResponse | null>(null);

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [stage2Instruction, setStage2Instruction] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [stage3TopText, setStage3TopText] = useState("");
  const [stage3BottomText, setStage3BottomText] = useState("");
  const [stage3ClipStartSec, setStage3ClipStartSec] = useState(0);
  const [stage3FocusY, setStage3FocusY] = useState(0.5);
  const [stage3RenderPlan, setStage3RenderPlan] = useState<Stage3RenderPlan>(fallbackRenderPlan());
  const [sourceDurationSec, setSourceDurationSec] = useState<number | null>(null);
  const [stage3PreviewVideoUrl, setStage3PreviewVideoUrl] = useState<string | null>(null);
  const [stage3PreviewNotice, setStage3PreviewNotice] = useState<string | null>(null);
  const [stage3AgentPrompt, setStage3AgentPrompt] = useState("");
  const [stage3AgentSessionId, setStage3AgentSessionId] = useState<string | null>(null);
  const [stage3AgentTimeline, setStage3AgentTimeline] = useState<Stage3TimelineResponse | null>(null);
  const [isStage3TimelineLoading, setIsStage3TimelineLoading] = useState(false);
  const [ignoreStage3ChatSessionRef, setIgnoreStage3ChatSessionRef] = useState(false);
  const [stage3SelectedVersionId, setStage3SelectedVersionId] = useState<string | null>(null);
  const [stage3PassSelectionByVersion, setStage3PassSelectionByVersion] = useState<Record<string, number>>({});
  const appliedCaptionKeyRef = useRef("");
  const initializedStage3ChatRef = useRef<string | null>(null);
  const previousChannelIdRef = useRef<string | null>(null);
  const stage3PreviewCacheRef = useRef<Map<string, { url: string; createdAt: number }>>(new Map());
  const stage3PreviewRequestKeyRef = useRef<string>("");

  const codexLoggedIn = Boolean(codexAuth?.loggedIn);
  const currentRole = authState?.membership.role ?? null;
  const canManageCodex = Boolean(authState?.effectivePermissions.canManageCodex);
  const canCreateChannel = Boolean(authState?.effectivePermissions.canCreateChannel);
  const fetchSourceAvailable = runtimeCapabilities?.features.fetchSource ?? true;
  const downloadSourceAvailable = runtimeCapabilities?.features.downloadSource ?? true;
  const sharedCodexAvailable = runtimeCapabilities?.features.sharedCodex ?? true;
  const stage2RuntimeAvailable = runtimeCapabilities?.features.stage2 ?? true;
  const fetchSourceBlockedReason = runtimeCapabilities?.tools.ytDlp.message ?? null;
  const downloadSourceBlockedReason = runtimeCapabilities?.tools.ytDlp.message ?? null;
  const codexBlockedReason = runtimeCapabilities?.tools.codex.message ?? null;
  const stage2BlockedReason =
    !sharedCodexAvailable
      ? codexBlockedReason
      : !stage2RuntimeAvailable
        ? runtimeCapabilities?.tools.ytDlp.message ??
          runtimeCapabilities?.tools.ffmpeg.message ??
          runtimeCapabilities?.tools.ffprobe.message ??
          "Stage 2 runtime is unavailable on this deployment."
        : null;
  const codexStatusLabel = codexLoggedIn
    ? "Shared Codex connected"
    : sharedCodexAvailable
      ? "Shared Codex unavailable"
      : "Codex runtime unavailable";
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

  const parseError = useCallback(async (response: Response, fallback: string): Promise<string> => {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? fallback;
  }, []);

  const refreshAuthState = useCallback(async (): Promise<AuthMeResponse> => {
    const response = await fetch("/api/auth/me");
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = "/login";
      }
      throw new Error(await parseError(response, "Failed to load auth state."));
    }
    const body = (await response.json()) as AuthMeResponse;
    setAuthState(body);
    return body;
  }, [parseError]);

  const refreshRuntimeCapabilities = useCallback(async (): Promise<RuntimeCapabilitiesResponse> => {
    const response = await fetch("/api/runtime/capabilities");
    if (!response.ok) {
      throw new Error(await parseError(response, "Failed to inspect runtime capabilities."));
    }
    const body = (await response.json()) as RuntimeCapabilitiesResponse;
    setRuntimeCapabilities(body);
    return body;
  }, [parseError]);

  const applyChannelToRenderPlan = useCallback(
    (channel: Channel | null, assets: ChannelAsset[] = []): Stage3RenderPlan => {
      const base = fallbackRenderPlan();
      if (!channel) {
        return base;
      }
      const avatar = findAssetById(assets, channel.avatarAssetId);
      const background = findAssetById(assets, channel.defaultBackgroundAssetId);
      const music = findAssetById(assets, channel.defaultMusicAssetId);
      return normalizeRenderPlan(
        {
          ...base,
          templateId: channel.templateId || STAGE3_TEMPLATE_ID,
          authorName: channel.name || base.authorName,
          authorHandle: channel.username.startsWith("@")
            ? channel.username
            : `@${channel.username || "channel"}`,
          avatarAssetId: channel.avatarAssetId,
          avatarAssetMimeType: avatar?.mimeType ?? null,
          backgroundAssetId: channel.defaultBackgroundAssetId,
          backgroundAssetMimeType: background?.mimeType ?? null,
          musicAssetId: channel.defaultMusicAssetId,
          musicAssetMimeType: music?.mimeType ?? null
        },
        base
      );
    },
    []
  );

  const refreshChannels = useCallback(async (): Promise<Channel[]> => {
    const response = await fetch("/api/channels");
    if (!response.ok) {
      throw new Error(await parseError(response, "Failed to load channels."));
    }
    const body = (await response.json()) as { channels: Channel[] };
    const nextChannels = body.channels ?? [];
    setChannels(nextChannels);
    setActiveChannelId((prev) => {
      if (prev && nextChannels.some((channel) => channel.id === prev)) {
        return prev;
      }
      return nextChannels[0]?.id ?? null;
    });
    return nextChannels;
  }, []);

  const refreshChannelAssets = useCallback(async (channelId: string): Promise<ChannelAsset[]> => {
    const response = await fetch(`/api/channels/${channelId}/assets`);
    if (!response.ok) {
      throw new Error(await parseError(response, "Failed to load channel assets."));
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
      throw new Error(await parseError(response, "Failed to load workspace members."));
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
      throw new Error(await parseError(response, "Failed to load channel access."));
    }
    const body = (await response.json()) as { grants: ChannelAccessGrant[] };
    setChannelAccessGrants(body.grants ?? []);
  }, [authState?.effectivePermissions.canManageAnyChannelAccess, parseError]);

  const refreshChats = async (): Promise<void> => {
    const query = activeChannelId ? `?channelId=${encodeURIComponent(activeChannelId)}` : "";
    const response = await fetch(`/api/chats${query}`);
    if (!response.ok) {
      throw new Error(await parseError(response, "Failed to load history."));
    }
    const body = (await response.json()) as { chats: ChatThread[] };
    const nextChats = body.chats ?? [];
    setChats(nextChats);
    setActiveChat((prev) => {
      if (!prev) {
        return nextChats[0] ?? null;
      }
      const match = nextChats.find((chat) => chat.id === prev.id);
      return match ?? nextChats[0] ?? null;
    });
  };

  const refreshActiveChat = async (chatId: string): Promise<ChatThread> => {
    const response = await fetch(`/api/chats/${chatId}`);
    if (!response.ok) {
      throw new Error(await parseError(response, "Failed to load item."));
    }
    const body = (await response.json()) as { chat: ChatThread };
    setActiveChat(body.chat);
    setChats((prev) => {
      const without = prev.filter((item) => item.id !== body.chat.id);
      return [body.chat, ...without];
    });
    return body.chat;
  };

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
      throw new Error(await parseError(response, "Failed to save event."));
    }
    const body = (await response.json()) as { chat: ChatThread };
    setActiveChat(body.chat);
    setChats((prev) => {
      const without = prev.filter((item) => item.id !== body.chat.id);
      return [body.chat, ...without];
    });
  }, [parseError]);

  const loadStage3AgentTimeline = useCallback(
    async (sessionId: string): Promise<Stage3TimelineResponse> => {
      setIsStage3TimelineLoading(true);
      try {
        const response = await fetch(`/api/stage3/agent/${sessionId}/timeline`);
        if (!response.ok) {
          throw new Error(await parseError(response, "Failed to load Stage 3 agent timeline."));
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

  const refreshCodexAuth = async (): Promise<void> => {
    setBusyAction("refresh-codex");
    setIsCodexAuthLoading(true);
    try {
      const response = await fetch("/api/codex/auth");
      if (!response.ok) {
        throw new Error(await parseError(response, "Failed to load Codex status."));
      }
      const body = (await response.json()) as CodexAuthResponse;
      setCodexAuth(body);
      setAuthState((prev) =>
        prev
          ? {
              ...prev,
              sharedCodexStatus: {
                status: body.loggedIn
                  ? "connected"
                  : body.deviceAuth.status === "running"
                    ? "connecting"
                    : "disconnected",
                connected: body.loggedIn,
                loginStatusText: body.loginStatusText,
                deviceAuth: prev.effectivePermissions.canManageCodex ? body.deviceAuth : null
              }
            }
          : prev
      );
    } finally {
      setIsCodexAuthLoading(false);
      setBusyAction((prev) => (prev === "refresh-codex" ? "" : prev));
    }
  };

  const startCodexDeviceAuth = async (): Promise<void> => {
    if (!canManageCodex) {
      setStatusType("error");
      setStatus("Shared Codex integration can be managed only by owner.");
      return;
    }
    if (!sharedCodexAvailable) {
      setStatusType("error");
      setStatus(codexBlockedReason ?? "Codex runtime is unavailable on this deployment.");
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
        throw new Error(await parseError(response, "Unable to start Connect Codex."));
      }
      const body = (await response.json()) as CodexAuthResponse;
      setCodexAuth(body);
      setStatusType("ok");
      setStatus("Shared Codex connect started. Complete device auth and refresh status.");
    } catch (error) {
      setStatusType("error");
      setStatus(error instanceof Error ? error.message : "Connect Codex failed.");
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
        throw new Error(await parseError(response, "Unable to update shared Codex."));
      }
      const body = (await response.json()) as CodexAuthResponse;
      setCodexAuth(body);
      await refreshAuthState().catch(() => undefined);
      setStatusType("ok");
      setStatus(action === "cancel" ? "Device auth canceled." : "Shared Codex disconnected.");
    } catch (error) {
      setStatusType("error");
      setStatus(error instanceof Error ? error.message : "Unable to update shared Codex.");
    } finally {
      setBusyAction("");
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        await refreshAuthState();
        await refreshRuntimeCapabilities();
        await refreshCodexAuth();
        await refreshChannels();
      } catch (error) {
        setStatusType("error");
        setStatus(error instanceof Error ? error.message : "Failed to initialize app.");
      } finally {
        setIsAuthLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeChannelId) {
      setChats([]);
      setActiveChat(null);
      setChannelAccessGrants([]);
      return;
    }
    void refreshChats().catch(() => undefined);
    void refreshChannelAssets(activeChannelId).catch(() => undefined);
    void refreshChannelAccess(activeChannelId).catch(() => undefined);
  }, [activeChannelId]);

  useEffect(() => {
    void refreshWorkspaceMembers().catch(() => undefined);
  }, [refreshWorkspaceMembers]);

  useEffect(() => {
    if (!activeChannel) {
      previousChannelIdRef.current = null;
      return;
    }
    if (previousChannelIdRef.current === activeChannel.id) {
      return;
    }
    previousChannelIdRef.current = activeChannel.id;

    setStage3RenderPlan((prev) =>
      normalizeRenderPlan(
        {
          ...prev,
          templateId: activeChannel.templateId || STAGE3_TEMPLATE_ID,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stage3PreviewRequestKeyRef.current = "";
    clearStage3PreviewCache();
    setStage3PreviewVideoUrl(null);
    setStage3PreviewNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.id]);

  const codexRunning = codexAuth?.deviceAuth.status === "running";

  useEffect(() => {
    if (!codexRunning) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshCodexAuth().catch(() => undefined);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [codexRunning]);

  const requireActiveChat = (): ChatThread | null => {
    if (!activeChat) {
      setStatusType("error");
      setStatus("Create or select an item first.");
      return null;
    }
    return activeChat;
  };

  const applyStage3Snapshot = (snapshot: Stage3StateSnapshot): void => {
    setStage3TopText(snapshot.topText);
    setStage3BottomText(snapshot.bottomText);
    setStage3ClipStartSec(snapshot.clipStartSec);
    setStage3FocusY(snapshot.focusY);
    setStage3RenderPlan(normalizeRenderPlan(snapshot.renderPlan, fallbackRenderPlan()));
    if (snapshot.renderPlan?.prompt?.trim()) {
      setStage3AgentPrompt(snapshot.renderPlan.prompt);
    }
  };

  const makeLiveSnapshot = (): Stage3StateSnapshot => {
    const fit = getTemplateComputed(
      stage3RenderPlan.templateId || STAGE3_TEMPLATE_ID,
      stage3TopText,
      stage3BottomText,
      {
        topFontScale: stage3RenderPlan.topFontScale,
        bottomFontScale: stage3RenderPlan.bottomFontScale
      }
    );
    return {
      topText: fit.top,
      bottomText: fit.bottom,
      clipStartSec: stage3ClipStartSec,
      clipDurationSec: CLIP_DURATION_SEC,
      focusY: stage3FocusY,
      renderPlan: normalizeRenderPlan(
        { ...stage3RenderPlan, prompt: stage3AgentPrompt.trim() || stage3RenderPlan.prompt },
        fallbackRenderPlan()
      ),
      sourceDurationSec,
      textFit: {
        topFontPx: fit.topFont,
        bottomFontPx: fit.bottomFont,
        topCompacted: fit.topCompacted,
        bottomCompacted: fit.bottomCompacted
      }
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
      URL.revokeObjectURL(url);
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
      setStatus("Copy to clipboard failed.");
    }
  };

  const handlePasteFromClipboard = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setStatusType("error");
        setStatus("Clipboard is empty.");
        return;
      }
      setDraftUrl(text.trim());
      setStatusType("ok");
      setStatus("Link pasted from clipboard.");
    } catch {
      setStatusType("error");
      setStatus("Clipboard read failed. Paste manually.");
    }
  };

  const runStage2ForChat = async (
    chat: Pick<ChatThread, "id" | "url">,
    instruction: string,
    mode: "manual" | "auto"
  ): Promise<Stage2Response> => {
    if (!codexLoggedIn) {
      throw new Error("Shared Codex unavailable. Contact owner.");
    }

    const trimmedInstruction = instruction.trim();
    await appendEvent(chat.id, {
      role: "user",
      type: "stage2",
      text:
        mode === "auto"
          ? "Auto Stage 2 started right after Step 1 fetch."
          : trimmedInstruction
            ? `User ran Stage 2 with instruction: ${trimmedInstruction}`
            : "User ran Stage 2."
    });

    const response = await fetch("/api/pipeline/stage2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chatId: chat.id,
        url: chat.url,
        userInstruction: trimmedInstruction || undefined
      })
    });

    if (!response.ok) {
      throw new Error(await parseError(response, "Stage 2 failed."));
    }

    const stage2 = (await response.json()) as Stage2Response;
    await appendEvent(chat.id, {
      role: "assistant",
      type: "stage2",
      text: `Stage 2 complete. Comments: ${stage2.source.totalComments}`,
      data: stage2
    });

    setSelectedOption(stage2.output.finalPick.option);
    setCurrentStep(3);
    return stage2;
  };

  const handleFetchSource = async (): Promise<void> => {
    const url = draftUrl.trim();
    if (!url) {
      setStatusType("error");
      setStatus("Paste a Shorts/Reels link first.");
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

    setBusyAction("fetch");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    let chatId: string | null = null;

    try {
      const createResponse = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, channelId: activeChannelId })
      });
      if (!createResponse.ok) {
        throw new Error(await parseError(createResponse, "Failed to create item."));
      }

      const createBody = (await createResponse.json()) as { chat: ChatThread };
      chatId = createBody.chat.id;
      setDraftUrl("");
      await refreshActiveChat(chatId);

      await appendEvent(chatId, {
        role: "user",
        type: "comments",
        text: "User ran Stage 1 fetch (link + comments)."
      });

      const commentsResponse = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });

      if (!commentsResponse.ok) {
        throw new Error(await parseError(commentsResponse, "Source fetched, comments failed."));
      }

      const comments = (await commentsResponse.json()) as CommentsPayload;
      await appendEvent(chatId, {
        role: "assistant",
        type: "comments",
        text: `Comments loaded: ${comments.totalComments}`,
        data: comments
      });

      setCurrentStep(2);

      if (!codexLoggedIn) {
        setStatusType("ok");
        setStatus(
          `Source fetched. Comments: ${comments.totalComments}. Shared Codex unavailable — contact owner.`
        );
        return;
      }

      setBusyAction("stage2");
      await runStage2ForChat({ id: chatId, url }, "", "auto");
      setStatusType("ok");
      setStatus(`Source fetched. Comments: ${comments.totalComments}. Stage 2 completed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch source.";
      if (chatId) {
        await appendEvent(chatId, {
          role: "assistant",
          type: "error",
          text: message
        }).catch(() => undefined);
      }
      setCurrentStep(1);
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
      setStatus("Provide a source URL first.");
      return;
    }

    const chatId = activeChat?.id ?? null;
    if (!downloadSourceAvailable) {
      setStatusType("error");
      setStatus(downloadSourceBlockedReason ?? "Source download is unavailable on this deployment.");
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
          text: "User started mp4 download."
        });
      }

      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Unable to download video."));
      }

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
          text: `Video downloaded: ${fileName}`
        });
      }

      setStatusType("ok");
      setStatus("Video downloaded.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video download failed.";
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
        throw new Error(await parseError(response, "Unable to load comments."));
      }

      const comments = (await response.json()) as CommentsPayload;
      await appendEvent(chat.id, {
        role: "assistant",
        type: "comments",
        text: `Comments loaded: ${comments.totalComments}`,
        data: comments
      });

      setStatusType("ok");
      setStatus("Comments loaded.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Comments loading failed.";
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
      setStatus(stage2BlockedReason ?? "Stage 2 runtime is unavailable on this deployment.");
      return;
    }
    if (!codexLoggedIn) {
      setStatusType("error");
      setStatus("Shared Codex unavailable — contact owner.");
      return;
    }

    setBusyAction("stage2");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      await runStage2ForChat(chat, stage2Instruction, "manual");
      setStatusType("ok");
      setStatus("Stage 2 complete.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stage 2 failed.";
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

  const handleRenderVideo = async (): Promise<void> => {
    const chat = requireActiveChat();
    if (!chat) {
      return;
    }
    if (!stage3TopText && !stage3BottomText) {
      setStatusType("error");
      setStatus("Сначала получите Stage 2 и выберите вариант.");
      return;
    }

    setBusyAction("render");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      const baseSnapshot = makeLiveSnapshot();
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

      await appendEvent(chat.id, {
        role: "user",
        type: "note",
        text: `User started Step 3 render with template: ${STAGE3_TEMPLATE_ID}`
      });

      const response = await fetch("/api/stage3/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: chat.url,
          channelId: activeChannelId,
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
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Render export failed."));
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const sourceName =
        response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "video.mp4";
      const outputName = sourceName.endsWith(".mp4")
        ? sourceName
        : `${sourceName.replace(/\.mp4$/i, "")}_${STAGE3_TEMPLATE_ID}.mp4`;

      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = outputName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);

      await appendEvent(chat.id, {
        role: "assistant",
        type: "note",
        text: `Stage 3 export finished: ${outputName} (clip ${renderSnapshot.clipStartSec.toFixed(1)}-${(
          renderSnapshot.clipStartSec + CLIP_DURATION_SEC
        ).toFixed(1)}s, focus ${Math.round(renderSnapshot.focusY * 100)}%)`
      });

      setStatusType("ok");
      setStatus("Render export complete.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Render export failed.";
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

  const handleOptimizeStage3 = async (): Promise<void> => {
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

    setBusyAction("stage3-optimize");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      const currentSnapshot = makeLiveSnapshot();
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
      const message = error instanceof Error ? error.message : "Stage 3 agent run failed.";
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
        throw new Error(await parseError(response, "Unable to resume Stage 3 agent session."));
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
      const message = error instanceof Error ? error.message : "Unable to resume Stage 3 agent session.";
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
      setStatus("Выберите версию из history drawer для rollback.");
      return;
    }

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
        throw new Error(await parseError(response, "Stage 3 rollback failed."));
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
        `Rollback выполнен${selectedVersion ? ` к v${selectedVersion.versionNo}` : ""}. Причина: ${body.reason}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stage 3 rollback failed.";
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
        throw new Error(await parseError(response, "Background upload failed."));
      }

      const body = (await response.json()) as { asset?: ChannelAsset };
      const asset = body.asset;
      if (!asset?.id) {
        throw new Error("Background upload returned empty asset id.");
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
      setStatus(error instanceof Error ? error.message : "Background upload failed.");
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
        throw new Error(await parseError(response, "Music upload failed."));
      }
      const body = (await response.json()) as { asset?: ChannelAsset };
      const asset = body.asset;
      if (!asset?.id) {
        throw new Error("Music upload returned empty asset id.");
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
      setStatus(error instanceof Error ? error.message : "Music upload failed.");
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

  const stage3LivePreviewState = useMemo(
    () => ({
      clipStartSec: stage3ClipStartSec,
      clipDurationSec: CLIP_DURATION_SEC,
      renderPlan: stripRenderPlanForPreview(normalizeRenderPlan(stage3RenderPlan, fallbackRenderPlan()))
    }),
    [stage3ClipStartSec, stage3RenderPlan]
  );

  useEffect(() => {
    if (!latestStage2Event) {
      setSelectedOption(null);
      return;
    }
    setSelectedOption((prev) => {
      if (
        prev &&
        latestStage2Event.payload.output.captionOptions.some((option) => option.option === prev)
      ) {
        return prev;
      }
      return latestStage2Event.payload.output.finalPick.option;
    });
  }, [latestStage2Event]);

  const selectedCaption = useMemo(() => {
    if (!latestStage2Event) {
      return null;
    }
    const preferredOption = selectedOption ?? latestStage2Event.payload.output.finalPick.option;
    return (
      latestStage2Event.payload.output.captionOptions.find((item) => item.option === preferredOption) ??
      latestStage2Event.payload.output.captionOptions[0] ??
      null
    );
  }, [latestStage2Event, selectedOption]);

  useEffect(() => {
    const key = [
      activeChat?.id ?? "",
      selectedCaption?.option ?? "",
      selectedCaption?.top ?? "",
      selectedCaption?.bottom ?? ""
    ].join("|");

    if (appliedCaptionKeyRef.current === key) {
      return;
    }

    appliedCaptionKeyRef.current = key;
    setStage3TopText(selectedCaption?.top ?? "");
    setStage3BottomText(selectedCaption?.bottom ?? "");
    setStage3RenderPlan((prev) =>
      normalizeRenderPlan(
        {
          ...applyChannelToRenderPlan(activeChannel, channelAssets),
          policy: prev.policy
        },
        fallbackRenderPlan()
      )
    );
    setStage3SelectedVersionId(null);
    setStage3PassSelectionByVersion({});
    setStage3AgentSessionId(null);
    setStage3AgentTimeline(null);
    setIgnoreStage3ChatSessionRef(true);
    setStage3PreviewNotice(null);
  }, [
    activeChat?.id,
    selectedCaption?.option,
    selectedCaption?.top,
    selectedCaption?.bottom,
    activeChannel,
    channelAssets,
    applyChannelToRenderPlan
  ]);

  useEffect(() => {
    const chatId = activeChat?.id ?? null;
    if (!chatId) {
      initializedStage3ChatRef.current = null;
      setStage3AgentSessionId(null);
      setStage3AgentTimeline(null);
      setIgnoreStage3ChatSessionRef(false);
      setStage3SelectedVersionId(null);
      setStage3PassSelectionByVersion({});
      setStage3AgentPrompt("");
      setStage3TopText("");
      setStage3BottomText("");
      setStage3ClipStartSec(0);
      setStage3FocusY(0.5);
      setStage3RenderPlan(applyChannelToRenderPlan(activeChannel, channelAssets));
      stage3PreviewRequestKeyRef.current = "";
      setStage3PreviewVideoUrl(null);
      setStage3PreviewNotice(null);
      return;
    }
    const isNewChat = initializedStage3ChatRef.current !== chatId;
    if (isNewChat) {
      initializedStage3ChatRef.current = chatId;
      setStage3AgentSessionId(stage3AgentSessionRef?.sessionId ?? null);
      setStage3AgentTimeline(null);
      setIgnoreStage3ChatSessionRef(false);
    }
    const latestVersion = stage3Versions[stage3Versions.length - 1] ?? null;
    if (!latestVersion) {
      setStage3SelectedVersionId(null);
      setStage3PassSelectionByVersion({});
      setStage3AgentPrompt(activeStage3AgentTimeline?.session.goalText ?? "");
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
    stage3AgentSessionRef?.sessionId,
    activeStage3AgentTimeline,
    stage3Versions,
    activeChannel,
    channelAssets,
    applyChannelToRenderPlan
  ]);

  useEffect(() => {
    if (currentStep !== 3 || !activeChat?.url) {
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
          throw new Error(await parseError(response, "Failed to fetch source duration."));
        }
        const body = (await response.json()) as { durationSec: number | null };
        const duration = body.durationSec;
        setSourceDurationSec(duration);
        setStage3RenderPlan((prev) => {
          if (prev.segments.length > 0 || prev.prompt.trim()) {
            return prev;
          }
          const policy = duration !== null && duration > 12 ? "adaptive_window" : "full_source_normalize";
          return { ...prev, policy };
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
  }, [currentStep, activeChat?.url]);

  useEffect(() => {
    if (currentStep !== 3 || !activeChat?.url) {
      return;
    }

    const previewState = stage3LivePreviewState;

    const previewKey = JSON.stringify({
      sourceUrl: activeChat.url,
      clipStartSec: Number(previewState.clipStartSec.toFixed(3)),
      clipDurationSec: previewState.clipDurationSec,
      renderPlan: previewState.renderPlan
    });
    stage3PreviewRequestKeyRef.current = previewKey;

    const cached = stage3PreviewCacheRef.current.get(previewKey);
    if (cached) {
      setStage3PreviewVideoUrl(cached.url);
      setStage3PreviewNotice(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusyAction((prev) => (prev ? prev : "video-preview"));

      void (async () => {
        try {
          const response = await fetch("/api/stage3/preview", {
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
          });
          if (!response.ok) {
            throw new Error(await parseError(response, "Failed to load Stage 3 preview."));
          }

          const blob = await response.blob();
          if (controller.signal.aborted || stage3PreviewRequestKeyRef.current !== previewKey) {
            return;
          }

          const objectUrl = URL.createObjectURL(blob);
          const cache = stage3PreviewCacheRef.current;
          const existing = cache.get(previewKey);
          if (existing) {
            URL.revokeObjectURL(objectUrl);
            setStage3PreviewVideoUrl(existing.url);
          } else {
            cache.set(previewKey, { url: objectUrl, createdAt: Date.now() });
            while (cache.size > 14) {
              const oldestEntry = [...cache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
              if (!oldestEntry) {
                break;
              }
              URL.revokeObjectURL(oldestEntry[1].url);
              cache.delete(oldestEntry[0]);
            }
            setStage3PreviewVideoUrl(objectUrl);
          }
          setStage3PreviewNotice(null);
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            return;
          }
          const message = error instanceof Error ? error.message : "Не удалось загрузить предпросмотр.";
          setStage3PreviewNotice(message);
        } finally {
          if (!controller.signal.aborted) {
            setBusyAction((prev) => (prev === "video-preview" ? "" : prev));
          }
        }
      })();
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [currentStep, activeChat?.url, activeChannelId, stage3LivePreviewState]);

  const steps: FlowStep[] = useMemo(
    () => [
      { id: 1, label: "Paste link", enabled: true },
      { id: 2, label: "Review & pick", enabled: Boolean(activeChat && latestComments) },
      { id: 3, label: "Render video", enabled: Boolean(latestStage2Event) }
    ],
    [activeChat, latestComments, latestStage2Event]
  );

  const historyItems = useMemo(
    () =>
      chats.map((chat) => ({
        id: chat.id,
        title: shorten(chat.title || chat.url),
        subtitle: formatShortDate(chat.updatedAt)
      })),
    [chats]
  );

  const handleHistoryChange = async (id: string): Promise<void> => {
    setStatus("");
    setStatusType("");

    if (!id) {
      setActiveChat(null);
      setCurrentStep(1);
      return;
    }

    try {
      const chat = await refreshActiveChat(id);
      const hasComments = chat.events.some(
        (event) => event.type === "comments" && event.role === "assistant"
      );
      const hasStage2 = chat.events.some((event) => event.type === "stage2" && event.role === "assistant");
      setCurrentStep(hasStage2 ? 3 : hasComments ? 2 : 1);
    } catch (error) {
      setStatusType("error");
      setStatus(error instanceof Error ? error.message : "Failed to open history item.");
    }
  };

  const handleResetFlow = (): void => {
    setActiveChat(null);
    setDraftUrl("");
    setCurrentStep(1);
    setStage2Instruction("");
    setSelectedOption(null);
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
    appliedCaptionKeyRef.current = "";
    stage3PreviewRequestKeyRef.current = "";
    clearStage3PreviewCache();
    setStage3PreviewVideoUrl(null);
    setStage3PreviewNotice(null);
    setStatus("");
    setStatusType("");
  };

  const handleSwitchChannel = useCallback(
    (channelId: string): void => {
      if (!channelId || channelId === activeChannelId) {
        return;
      }
      const nextChannel = channels.find((channel) => channel.id === channelId) ?? null;
      setActiveChannelId(channelId);
      setChats([]);
      setActiveChat(null);
      setDraftUrl("");
      setCurrentStep(1);
      setStage2Instruction("");
      setSelectedOption(null);
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
      appliedCaptionKeyRef.current = "";
      stage3PreviewRequestKeyRef.current = "";
      clearStage3PreviewCache();
      setStage3PreviewVideoUrl(null);
      setStage3PreviewNotice(null);
      setStatus("");
      setStatusType("");
    },
    [activeChannelId, channels, channelAssets, applyChannelToRenderPlan]
  );

  const handleDeleteHistory = async (chatId: string): Promise<void> => {
    if (!window.confirm("Delete this item from history?")) {
      return;
    }

    setStatus("");
    setStatusType("");

    try {
      const response = await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await parseError(response, "Failed to delete history item."));
      }

      await refreshChats();
      if (activeChat?.id === chatId) {
        setCurrentStep(1);
      }

      setStatusType("ok");
      setStatus("History item deleted.");
    } catch (error) {
      setStatusType("error");
      setStatus(error instanceof Error ? error.message : "Failed to delete history item.");
    }
  };

  const handleCreateChannel = async (): Promise<void> => {
    setBusyAction("channel-create");
    try {
      const response = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New channel", username: "channel" })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Failed to create channel."));
      }
      const body = (await response.json()) as { channel: Channel };
      await refreshChannels();
      handleSwitchChannel(body.channel.id);
      setStatusType("ok");
      setStatus("Канал создан.");
    } catch (error) {
      setStatusType("error");
      setStatus(error instanceof Error ? error.message : "Failed to create channel.");
    } finally {
      setBusyAction("");
    }
  };

  const handleSaveChannel = async (
    channelId: string,
    patch: Partial<{
      name: string;
      username: string;
      systemPrompt: string;
      descriptionPrompt: string;
      examplesJson: string;
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
        throw new Error(await parseError(response, "Failed to save channel."));
      }
      const body = (await response.json()) as { channel: Channel };
      await refreshChannels();
      let refreshedAssets: ChannelAsset[] = [];
      if (activeChannelId) {
        refreshedAssets = await refreshChannelAssets(activeChannelId).catch(() => []);
      }
      if (body.channel.id === activeChannelId) {
        const resolvedAvatar = refreshedAssets.find((item) => item.id === body.channel.avatarAssetId);
        const resolvedBg = refreshedAssets.find((item) => item.id === body.channel.defaultBackgroundAssetId);
        const resolvedMusic = refreshedAssets.find((item) => item.id === body.channel.defaultMusicAssetId);
        setStage3RenderPlan((prev) =>
          normalizeRenderPlan(
            {
              ...prev,
              templateId: body.channel.templateId || prev.templateId,
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
      setStatus(error instanceof Error ? error.message : "Failed to save channel.");
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
        throw new Error(await parseError(response, "Failed to delete channel."));
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
      setStatus(error instanceof Error ? error.message : "Failed to delete channel.");
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
        throw new Error(await parseError(response, "Failed to delete asset."));
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
      setStatus(error instanceof Error ? error.message : "Failed to delete asset.");
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
        throw new Error(await parseError(response, "Failed to upload asset."));
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
      setStatus(error instanceof Error ? error.message : "Failed to upload asset.");
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
        throw new Error(await parseError(response, "Failed to update channel access."));
      }
      const body = (await response.json()) as { grants: ChannelAccessGrant[] };
      setChannelAccessGrants(body.grants ?? []);
      setStatusType("ok");
      setStatus("Доступ к каналу обновлен.");
    } catch (error) {
      setStatusType("error");
      setStatus(error instanceof Error ? error.message : "Failed to update channel access.");
    } finally {
      setBusyAction("");
    }
  };

  useEffect(() => {
    if (!activeChat) {
      return;
    }
    const hasStage2 = activeChat.events.some(
      (event) => event.type === "stage2" && event.role === "assistant"
    );
    setCurrentStep((prev) => {
      if (prev !== 1) {
        return prev;
      }
      return hasStage2 ? 3 : 2;
    });
  }, [activeChat]);

  const handleExportTemplate = (): void => {
    const chat = activeChat;
    if (!chat) {
      setStatusType("error");
      setStatus("Create or select an item first.");
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      sourceUrl: chat.url,
      templateId: stage3RenderPlan.templateId,
      stage2EventId: latestStage2Event?.id ?? null,
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
      stage2: latestStage2Event?.payload ?? null
    };

    toJsonDownload(`template_${chat.id}.json`, payload);
    setStatusType("ok");
    setStatus("Template config exported.");
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
          <p className="status-line ok">Loading workspace...</p>
        </section>
      </main>
    );
  }

  return (
    <AppShell
      title="Clips Automations"
      subtitle="Minimal 3-step flow: fetch source, pick caption, render output."
      steps={steps}
      currentStep={currentStep}
      onStepChange={(step) => setCurrentStep(step)}
      historyItems={historyItems}
      activeHistoryId={activeChat?.id ?? null}
      onHistoryChange={(id) => {
        void handleHistoryChange(id);
      }}
      onDeleteHistory={(id) => {
        void handleDeleteHistory(id);
      }}
      onCreateNew={handleResetFlow}
      channels={channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        username: channel.username
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
      canConnectCodex={sharedCodexAvailable}
      codexConnectBlockedReason={codexBlockedReason}
      codexStatusLabel={codexStatusLabel}
      codexSecondaryActionLabel={
        canManageCodex
          ? codexAuth?.deviceAuth.status === "running"
            ? "Cancel"
            : codexLoggedIn
              ? "Disconnect"
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
            setStatus("Comments JSON downloaded.");
          }}
        />
      }
    >
      {currentStep === 1 ? (
        <Step1PasteLink
          draftUrl={draftUrl}
          activeUrl={activeChat?.url ?? null}
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
          stage2={latestStage2Event?.payload ?? null}
          stageCreatedAt={latestStage2Event?.createdAt ?? null}
          instruction={stage2Instruction}
          canRunStage2={Boolean(activeChat && codexLoggedIn && stage2RuntimeAvailable) && !isBusy}
          runBlockedReason={stage2BlockedReason}
          isRunning={busyAction === "stage2"}
          selectedOption={selectedOption}
          onInstructionChange={setStage2Instruction}
          onRunStage2={() => {
            void handleRunStage2();
          }}
          onSelectOption={setSelectedOption}
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
          isPreviewLoading={busyAction === "video-preview"}
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
          clipStartSec={stage3ClipStartSec}
          clipDurationSec={CLIP_DURATION_SEC}
          sourceDurationSec={sourceDurationSec}
          focusY={stage3FocusY}
          videoZoom={stage3RenderPlan.videoZoom}
          topFontScale={stage3RenderPlan.topFontScale}
          bottomFontScale={stage3RenderPlan.bottomFontScale}
          musicGain={stage3RenderPlan.musicGain}
          isRendering={busyAction === "render"}
          isOptimizing={busyAction === "stage3-optimize"}
          isUploadingBackground={busyAction === "background-upload"}
          onRender={() => {
            void handleRenderVideo();
          }}
          onOptimize={() => {
            void handleOptimizeStage3();
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
          onClipStartChange={(value) => setStage3ClipStartSec(value)}
          onFocusYChange={(value) => setStage3FocusY(value)}
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
          onExport={handleExportTemplate}
        />
      ) : null}

      <ChannelManager
        open={isChannelManagerOpen}
        channels={channels}
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
        onSaveChannel={(channelId, patch) => {
          void handleSaveChannel(channelId, patch);
        }}
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
