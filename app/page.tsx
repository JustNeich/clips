"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, FlowStep } from "./components/AppShell";
import { DetailsDrawer } from "./components/DetailsDrawer";
import { Step1PasteLink } from "./components/Step1PasteLink";
import { Step2PickCaption } from "./components/Step2PickCaption";
import { Step3RenderTemplate } from "./components/Step3RenderTemplate";
import {
  ChatEvent,
  ChatThread,
  CodexAuthResponse,
  CommentsPayload,
  Stage3AgentPass,
  Stage3RenderPlan,
  Stage3StateSnapshot,
  Stage3Version,
  Stage3OptimizationRun,
  Stage3OptimizeResponse,
  Stage2Response
} from "./components/types";
import { getScienceCardComputed, STAGE3_TEMPLATE_ID } from "../lib/stage3-template";

const CODEX_SESSION_STORAGE_KEY = "codex_session_id";
const CLIP_DURATION_SEC = 6;

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
  | "connect-codex"
  | "refresh-codex";

function normalizeCodexSessionId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{16,96}$/.test(value)) {
    return null;
  }
  return value;
}

function createCodexSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
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
    segments: [],
    policy: "full_source_normalize",
    prompt: ""
  };
}

function stripRenderPlanForPreview(plan: Stage3RenderPlan): Stage3RenderPlan {
  return {
    ...plan,
    // Prompt text must not affect preview cache keys or trigger heavy re-renders.
    prompt: ""
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
    segments,
    policy:
      candidate?.policy === "adaptive_window" ||
      candidate?.policy === "full_source_normalize" ||
      candidate?.policy === "fixed_segments"
        ? candidate.policy
        : base.policy,
    prompt: typeof candidate?.prompt === "string" ? candidate.prompt : base.prompt
  };
}

function normalizeStage3Pass(pass: unknown, fallbackDurationSec = CLIP_DURATION_SEC): Stage3AgentPass | null {
  if (!pass || typeof pass !== "object") {
    return null;
  }
  const candidate = pass as Partial<Stage3AgentPass>;
  if (
    typeof candidate.pass !== "number" ||
    typeof candidate.label !== "string" ||
    typeof candidate.summary !== "string" ||
    !Array.isArray(candidate.changes)
  ) {
    return null;
  }

  const topText = typeof candidate.topText === "string" ? candidate.topText : "";
  const bottomText = typeof candidate.bottomText === "string" ? candidate.bottomText : "";
  const clipStartSec = typeof candidate.clipStartSec === "number" ? candidate.clipStartSec : 0;
  const clipDurationSec =
    typeof candidate.clipDurationSec === "number" ? candidate.clipDurationSec : fallbackDurationSec;
  const renderPlan = normalizeRenderPlan(candidate.renderPlan, fallbackRenderPlan());

  return {
    pass: candidate.pass,
    label: candidate.label,
    summary: candidate.summary,
    changes: candidate.changes.map((item) => String(item)),
    topText,
    bottomText,
    topFontPx: typeof candidate.topFontPx === "number" ? candidate.topFontPx : 0,
    bottomFontPx: typeof candidate.bottomFontPx === "number" ? candidate.bottomFontPx : 0,
    topCompacted: Boolean(candidate.topCompacted),
    bottomCompacted: Boolean(candidate.bottomCompacted),
    clipStartSec,
    clipDurationSec,
    clipEndSec:
      typeof candidate.clipEndSec === "number" ? candidate.clipEndSec : clipStartSec + clipDurationSec,
    focusY: typeof candidate.focusY === "number" ? candidate.focusY : 0.5,
    renderPlan
  };
}

function passToSnapshot(pass: Stage3AgentPass, sourceDurationSec: number | null): Stage3StateSnapshot {
  return {
    topText: pass.topText,
    bottomText: pass.bottomText,
    clipStartSec: pass.clipStartSec,
    clipDurationSec: pass.clipDurationSec,
    focusY: pass.focusY,
    renderPlan: normalizeRenderPlan(pass.renderPlan),
    sourceDurationSec,
    textFit: {
      topFontPx: pass.topFontPx,
      bottomFontPx: pass.bottomFontPx,
      topCompacted: pass.topCompacted,
      bottomCompacted: pass.bottomCompacted
    }
  };
}

function normalizeSnapshot(
  value: unknown,
  fallback: Stage3StateSnapshot,
  sourceDurationSec: number | null
): Stage3StateSnapshot {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const candidate = value as Partial<Stage3StateSnapshot>;
  return {
    topText: typeof candidate.topText === "string" ? candidate.topText : fallback.topText,
    bottomText: typeof candidate.bottomText === "string" ? candidate.bottomText : fallback.bottomText,
    clipStartSec:
      typeof candidate.clipStartSec === "number" ? candidate.clipStartSec : fallback.clipStartSec,
    clipDurationSec:
      typeof candidate.clipDurationSec === "number" ? candidate.clipDurationSec : fallback.clipDurationSec,
    focusY: typeof candidate.focusY === "number" ? candidate.focusY : fallback.focusY,
    renderPlan: normalizeRenderPlan(candidate.renderPlan, fallback.renderPlan),
    sourceDurationSec,
    textFit: {
      topFontPx:
        typeof candidate.textFit?.topFontPx === "number"
          ? candidate.textFit.topFontPx
          : fallback.textFit.topFontPx,
      bottomFontPx:
        typeof candidate.textFit?.bottomFontPx === "number"
          ? candidate.textFit.bottomFontPx
          : fallback.textFit.bottomFontPx,
      topCompacted:
        typeof candidate.textFit?.topCompacted === "boolean"
          ? candidate.textFit.topCompacted
          : fallback.textFit.topCompacted,
      bottomCompacted:
        typeof candidate.textFit?.bottomCompacted === "boolean"
          ? candidate.textFit.bottomCompacted
          : fallback.textFit.bottomCompacted
    }
  };
}

function buildDiffFromSnapshots(
  baseline: Stage3StateSnapshot,
  final: Stage3StateSnapshot
): Stage3Version["diff"] {
  const textChanged = baseline.topText !== final.topText || baseline.bottomText !== final.bottomText;
  const framingChanged =
    Math.abs(baseline.clipStartSec - final.clipStartSec) >= 0.01 ||
    Math.abs(baseline.focusY - final.focusY) >= 0.005;
  const timingChanged =
    baseline.renderPlan.timingMode !== final.renderPlan.timingMode ||
    baseline.renderPlan.policy !== final.renderPlan.policy ||
    baseline.renderPlan.smoothSlowMo !== final.renderPlan.smoothSlowMo;
  const segmentsChanged =
    JSON.stringify(baseline.renderPlan.segments) !== JSON.stringify(final.renderPlan.segments);
  const audioChanged = baseline.renderPlan.audioMode !== final.renderPlan.audioMode;
  const summary: string[] = [];
  if (textChanged) {
    summary.push("Текст приведен к более читаемому виду.");
  }
  if (framingChanged) {
    summary.push("Скорректированы фокус и старт клипа.");
  }
  if (segmentsChanged) {
    summary.push("Обновлена нарезка фрагментов.");
  }
  if (timingChanged) {
    summary.push("Изменена стратегия длительности/темпа.");
  }
  if (audioChanged) {
    summary.push("Обновлен режим аудио.");
  }
  if (!summary.length) {
    summary.push("Агент подтвердил текущие настройки без изменений.");
  }
  return { textChanged, framingChanged, timingChanged, segmentsChanged, audioChanged, summary };
}

function normalizeOptimizationRun(
  value: unknown,
  fallbackId: string,
  fallbackCreatedAt: string
): Stage3OptimizationRun | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<Stage3OptimizationRun> & { passes?: unknown[] };
  const rawPasses = Array.isArray(candidate.passes) ? candidate.passes : [];
  const normalizedPasses = rawPasses
    .map((pass) => normalizeStage3Pass(pass))
    .filter((pass): pass is Stage3AgentPass => Boolean(pass));

  if (!normalizedPasses.length) {
    return null;
  }

  const recommendedPass =
    typeof candidate.recommendedPass === "number" && Number.isFinite(candidate.recommendedPass)
      ? candidate.recommendedPass
      : normalizedPasses[normalizedPasses.length - 1].pass;

  return {
    runId: typeof candidate.runId === "string" && candidate.runId.trim() ? candidate.runId : fallbackId,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim()
        ? candidate.createdAt
        : fallbackCreatedAt,
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : "",
    passes: normalizedPasses,
    recommendedPass,
    sourceDurationSec:
      typeof candidate.sourceDurationSec === "number" && Number.isFinite(candidate.sourceDurationSec)
        ? candidate.sourceDurationSec
        : null
  };
}

function runToVersion(run: Stage3OptimizationRun, versionNo: number): Stage3Version | null {
  if (!run.passes.length) {
    return null;
  }
  const recommendedIndex = Math.max(0, Math.min(run.passes.length - 1, run.recommendedPass - 1));
  const baseline = passToSnapshot(run.passes[0], run.sourceDurationSec);
  const final = passToSnapshot(run.passes[recommendedIndex], run.sourceDurationSec);
  return {
    versionNo,
    runId: run.runId,
    createdAt: run.createdAt,
    prompt: run.prompt,
    baseline,
    final,
    diff: buildDiffFromSnapshots(baseline, final),
    internalPasses: run.passes,
    recommendedPass: run.recommendedPass
  };
}

function normalizeStage3Version(
  value: unknown,
  fallbackVersionNo: number,
  fallbackId: string,
  fallbackCreatedAt: string
): Stage3Version | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<Stage3Version>;
  const passesRaw = Array.isArray(candidate.internalPasses) ? candidate.internalPasses : [];
  const internalPasses = passesRaw
    .map((pass) => normalizeStage3Pass(pass))
    .filter((pass): pass is Stage3AgentPass => Boolean(pass));

  if (!internalPasses.length) {
    return null;
  }
  const sourceDurationSec =
    typeof candidate.final?.sourceDurationSec === "number"
      ? candidate.final.sourceDurationSec
      : typeof candidate.baseline?.sourceDurationSec === "number"
        ? candidate.baseline.sourceDurationSec
        : null;
  const baselineFallback = passToSnapshot(internalPasses[0], sourceDurationSec);
  const finalFallback = passToSnapshot(
    internalPasses[Math.max(0, Math.min(internalPasses.length - 1, (candidate.recommendedPass ?? 1) - 1))],
    sourceDurationSec
  );
  const baseline = normalizeSnapshot(candidate.baseline, baselineFallback, baselineFallback.sourceDurationSec);
  const final = normalizeSnapshot(candidate.final, finalFallback, finalFallback.sourceDurationSec);

  return {
    versionNo:
      typeof candidate.versionNo === "number" && Number.isFinite(candidate.versionNo)
        ? candidate.versionNo
        : fallbackVersionNo,
    runId:
      typeof candidate.runId === "string" && candidate.runId.trim() ? candidate.runId : fallbackId,
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim()
        ? candidate.createdAt
        : fallbackCreatedAt,
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : "",
    baseline,
    final,
    diff:
      candidate.diff && typeof candidate.diff === "object"
        ? {
            textChanged: Boolean(candidate.diff.textChanged),
            framingChanged: Boolean(candidate.diff.framingChanged),
            timingChanged: Boolean(candidate.diff.timingChanged),
            segmentsChanged: Boolean(candidate.diff.segmentsChanged),
            audioChanged: Boolean(candidate.diff.audioChanged),
            summary: Array.isArray(candidate.diff.summary)
              ? candidate.diff.summary.map((item) => String(item))
              : buildDiffFromSnapshots(baseline, final).summary
          }
        : buildDiffFromSnapshots(baseline, final),
    internalPasses,
    recommendedPass:
      typeof candidate.recommendedPass === "number" && Number.isFinite(candidate.recommendedPass)
        ? candidate.recommendedPass
        : internalPasses[internalPasses.length - 1].pass
  };
}

function extractStage3Version(
  data: unknown,
  eventId: string,
  createdAt: string,
  fallbackVersionNo: number
): Stage3Version | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    kind?: string;
    version?: unknown;
    run?: unknown;
    optimization?: {
      version?: unknown;
      run?: unknown;
      passes?: unknown[];
      recommendedPass?: number;
      sourceDurationSec?: number | null;
    };
    passes?: unknown[];
    recommendedPass?: number;
    sourceDurationSec?: number | null;
    agentPrompt?: string;
  };

  if (payload.kind === "stage3-version") {
    const direct = normalizeStage3Version(payload.version ?? payload, fallbackVersionNo, `version_${eventId}`, createdAt);
    if (direct) {
      return direct;
    }
  }

  const explicitVersion = normalizeStage3Version(
    payload.version ?? payload.optimization?.version,
    fallbackVersionNo,
    `version_${eventId}`,
    createdAt
  );
  if (explicitVersion) {
    return explicitVersion;
  }

  const directRun = normalizeOptimizationRun(payload.run, `run_${eventId}`, createdAt);
  if (directRun) {
    return runToVersion(directRun, fallbackVersionNo);
  }

  const wrappedRun = normalizeOptimizationRun(payload.optimization?.run, `run_${eventId}`, createdAt);
  if (wrappedRun) {
    return runToVersion(wrappedRun, fallbackVersionNo);
  }

  const legacyPasses = payload.optimization?.passes ?? payload.passes;
  if (Array.isArray(legacyPasses) && legacyPasses.length > 0) {
    const legacyRun = normalizeOptimizationRun(
      {
        runId: `legacy_${eventId}`,
        createdAt,
        prompt: payload.agentPrompt ?? "",
        passes: legacyPasses,
        recommendedPass: payload.optimization?.recommendedPass ?? payload.recommendedPass,
        sourceDurationSec: payload.optimization?.sourceDurationSec ?? payload.sourceDurationSec ?? null
      },
      `legacy_${eventId}`,
      createdAt
    );
    if (legacyRun) {
      return runToVersion(legacyRun, fallbackVersionNo);
    }
  }
  return null;
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

export default function HomePage() {
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"ok" | "error" | "">("");
  const [isBusy, setIsBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>("");

  const [draftUrl, setDraftUrl] = useState("");
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [activeChat, setActiveChat] = useState<ChatThread | null>(null);

  const [codexSessionId, setCodexSessionId] = useState("");
  const [codexAuth, setCodexAuth] = useState<CodexAuthResponse | null>(null);
  const [isCodexAuthLoading, setIsCodexAuthLoading] = useState(false);

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
  const [stage3SelectedVersionId, setStage3SelectedVersionId] = useState<string | null>(null);
  const [stage3PassSelectionByVersion, setStage3PassSelectionByVersion] = useState<Record<string, number>>({});
  const appliedCaptionKeyRef = useRef("");
  const initializedStage3ChatRef = useRef<string | null>(null);
  const stage3InitInFlightRef = useRef<string | null>(null);
  const stage3PreviewCacheRef = useRef<Map<string, { url: string; createdAt: number }>>(new Map());
  const stage3PreviewRequestKeyRef = useRef<string>("");

  const codexLoggedIn = Boolean(codexAuth?.loggedIn);

  const parseError = async (response: Response, fallback: string): Promise<string> => {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? fallback;
  };

  const refreshChats = async (): Promise<void> => {
    const response = await fetch("/api/chats");
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

  const appendEvent = async (
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
  };

  const ensureSession = (): string => {
    const existing = normalizeCodexSessionId(localStorage.getItem(CODEX_SESSION_STORAGE_KEY));
    if (existing) {
      return existing;
    }
    const created = createCodexSessionId();
    localStorage.setItem(CODEX_SESSION_STORAGE_KEY, created);
    return created;
  };

  const refreshCodexAuth = async (sessionIdParam?: string): Promise<void> => {
    const sid = sessionIdParam ?? codexSessionId;
    if (!sid) {
      return;
    }
    setBusyAction((prev) => (sessionIdParam ? prev : "refresh-codex"));
    setIsCodexAuthLoading(true);
    try {
      const response = await fetch("/api/codex/auth", {
        headers: { "x-codex-session-id": sid }
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Failed to load Codex status."));
      }
      const body = (await response.json()) as CodexAuthResponse;
      setCodexAuth(body);
    } finally {
      setIsCodexAuthLoading(false);
      setBusyAction((prev) => (prev === "refresh-codex" ? "" : prev));
    }
  };

  const startCodexDeviceAuth = async (): Promise<void> => {
    if (!codexSessionId) {
      return;
    }
    setBusyAction("connect-codex");
    setIsCodexAuthLoading(true);
    try {
      const response = await fetch("/api/codex/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-codex-session-id": codexSessionId
        },
        body: JSON.stringify({ action: "start" })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Unable to start Connect Codex."));
      }
      const body = (await response.json()) as CodexAuthResponse;
      setCodexAuth(body);
      setStatusType("ok");
      setStatus("Connect started. Complete sign-in and refresh status.");
    } catch (error) {
      setStatusType("error");
      setStatus(error instanceof Error ? error.message : "Connect Codex failed.");
    } finally {
      setIsCodexAuthLoading(false);
      setBusyAction("");
    }
  };

  useEffect(() => {
    const sid = ensureSession();
    setCodexSessionId(sid);
    void refreshCodexAuth(sid).catch(() => undefined);
    void refreshChats().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!codexRunning || !codexSessionId) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshCodexAuth(codexSessionId).catch(() => undefined);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [codexRunning, codexSessionId]);

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
    const fit = getScienceCardComputed(stage3TopText, stage3BottomText);
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

  const clearStage3PreviewCache = (): void => {
    const cache = stage3PreviewCacheRef.current;
    for (const { url } of cache.values()) {
      URL.revokeObjectURL(url);
    }
    cache.clear();
  };

  const buildStage3InitVersion = (snapshot: Stage3StateSnapshot): Stage3Version => {
    const now = new Date().toISOString();
    const runId = `stage3_init_${createCodexSessionId()}`;
    const pass: Stage3AgentPass = {
      pass: 1,
      label: "Инициализация",
      summary: "Создана стартовая версия из выбранного варианта Stage 2 без авто-оптимизации.",
      changes: ["Зафиксированы исходные текст, фокус и тайминг для дальнейших итераций."],
      topText: snapshot.topText,
      bottomText: snapshot.bottomText,
      topFontPx: snapshot.textFit.topFontPx,
      bottomFontPx: snapshot.textFit.bottomFontPx,
      topCompacted: snapshot.textFit.topCompacted,
      bottomCompacted: snapshot.textFit.bottomCompacted,
      clipStartSec: snapshot.clipStartSec,
      clipDurationSec: snapshot.clipDurationSec,
      clipEndSec: snapshot.clipStartSec + snapshot.clipDurationSec,
      focusY: snapshot.focusY,
      renderPlan: snapshot.renderPlan
    };
    return {
      versionNo: 1,
      runId,
      createdAt: now,
      prompt: "",
      baseline: snapshot,
      final: snapshot,
      diff: {
        textChanged: false,
        framingChanged: false,
        timingChanged: false,
        segmentsChanged: false,
        audioChanged: false,
        summary: ["Базовая версия v1 создана."]
      },
      internalPasses: [pass],
      recommendedPass: 1
    };
  };

  const ensureStage3Initialized = async (chat: ChatThread): Promise<void> => {
    if (stage3Versions.length > 0) {
      return;
    }
    if (stage3InitInFlightRef.current === chat.id) {
      return;
    }
    if (!stage3TopText.trim() && !stage3BottomText.trim()) {
      return;
    }

    stage3InitInFlightRef.current = chat.id;
    try {
      const snapshot = makeLiveSnapshot();
      const version = buildStage3InitVersion(snapshot);
      await appendEvent(chat.id, {
        role: "assistant",
        type: "note",
        text: "Stage 3 инициализирован. Создана стартовая версия v1.",
        data: {
          kind: "stage3-version",
          version
        }
      });
    } finally {
      stage3InitInFlightRef.current = null;
    }
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

  const handleFetchSource = async (): Promise<void> => {
    const url = draftUrl.trim();
    if (!url) {
      setStatusType("error");
      setStatus("Paste a Shorts/Reels link first.");
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
        body: JSON.stringify({ url })
      });
      if (!createResponse.ok) {
        throw new Error(await parseError(createResponse, "Failed to create item."));
      }

      const createBody = (await createResponse.json()) as { chat: ChatThread };
      chatId = createBody.chat.id;
      setDraftUrl("");
      await refreshActiveChat(chatId);
      setCurrentStep(2);

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

      setStatusType("ok");
      setStatus(`Source fetched. Comments: ${comments.totalComments}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch source.";
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

  const handleDownloadVideo = async (): Promise<void> => {
    const sourceUrl = activeChat?.url ?? draftUrl.trim();
    if (!sourceUrl) {
      setStatusType("error");
      setStatus("Provide a source URL first.");
      return;
    }

    const chatId = activeChat?.id ?? null;

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
    if (!codexLoggedIn || !codexSessionId) {
      setStatusType("error");
      setStatus("Connect Codex first.");
      return;
    }

    setBusyAction("stage2");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      const instruction = stage2Instruction.trim();
      await appendEvent(chat.id, {
        role: "user",
        type: "stage2",
        text: instruction
          ? `User ran Stage 2 with instruction: ${instruction}`
          : "User ran Stage 2."
      });

      const response = await fetch("/api/pipeline/stage2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-codex-session-id": codexSessionId
        },
        body: JSON.stringify({ url: chat.url, userInstruction: instruction || undefined })
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
      const renderSnapshot = selectedStage3Version?.final ?? makeLiveSnapshot();

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
          templateId: STAGE3_TEMPLATE_ID,
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

    setBusyAction("stage3-optimize");
    setIsBusy(true);
    setStatus("");
    setStatusType("");

    try {
      const prompt = stage3AgentPrompt.trim();
      const currentSnapshot = selectedStage3Snapshot ?? makeLiveSnapshot();
      const hasInitVersion = stage3Versions.length > 0;
      if (!hasInitVersion) {
        await ensureStage3Initialized(chat);
      }
      const nextVersionNo = Math.max(2, stage3Versions.length + (hasInitVersion ? 1 : 2));
      await appendEvent(chat.id, {
        role: "user",
        type: "note",
        text: prompt
          ? `Пользователь запустил оптимизацию Stage 3 с инструкцией: ${prompt}`
          : "Пользователь запустил оптимизацию Stage 3."
      });

      const response = await fetch("/api/stage3/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: chat.url,
          chatId: chat.id,
          versionNo: nextVersionNo,
          topText: currentSnapshot.topText,
          bottomText: currentSnapshot.bottomText,
          clipStartSec: currentSnapshot.clipStartSec,
          focusY: currentSnapshot.focusY,
          clipDurationSec: CLIP_DURATION_SEC,
          agentPrompt: prompt || undefined,
          currentSnapshot
        })
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Stage 3 optimization failed."));
      }

      const body = (await response.json()) as Stage3OptimizeResponse;
      const version = body.optimization.version;
      const passes = version?.internalPasses ?? [];
      if (!version || !passes.length) {
        throw new Error("Stage 3 optimization returned no version.");
      }

      const recommendedPass = version.recommendedPass ?? passes.length;
      const recommendedIndex = Math.max(0, Math.min(passes.length - 1, recommendedPass - 1));
      const selected = passes[recommendedIndex] ?? null;

      setStage3SelectedVersionId(version.runId);
      setStage3PassSelectionByVersion((prev) => ({
        ...prev,
        [version.runId]: recommendedIndex
      }));
      applyStage3Snapshot(version.final);
      setSourceDurationSec(version.final.sourceDurationSec);
      if (version.prompt.trim()) {
        setStage3AgentPrompt(version.prompt);
      }

      await appendEvent(chat.id, {
        role: "assistant",
        type: "note",
        text: `Stage 3 оптимизирован. Версия v${version.versionNo} готова: ${version.diff.summary.join(" ")}`,
        data: {
          kind: "stage3-version",
          version
        }
      });

      const compactedTop = selected?.topCompacted ? "TOP сжат" : "TOP без изменений";
      const compactedBottom = selected?.bottomCompacted ? "BOTTOM сжат" : "BOTTOM без изменений";
      setStatusType("ok");
      setStatus(
        `Версия v${version.versionNo} создана. ${compactedTop}, ${compactedBottom}. Внутренних проходов: ${passes.length}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stage 3 optimization failed.";
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

  const stage3Versions = useMemo(() => {
    if (!activeChat) {
      return [] as Stage3Version[];
    }

    const collected: Stage3Version[] = [];
    let fallbackVersionNo = 1;
    for (const event of activeChat.events) {
      if (event.type !== "note" || event.role !== "assistant") {
        continue;
      }
      const version = extractStage3Version(event.data, event.id, event.createdAt, fallbackVersionNo);
      if (!version) {
        continue;
      }
      collected.push(version);
      fallbackVersionNo = Math.max(fallbackVersionNo + 1, version.versionNo + 1);
    }

    return collected
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((version, index) => ({ ...version, versionNo: index + 1 }));
  }, [activeChat]);

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

  const selectedStage3Snapshot = useMemo(() => {
    if (!selectedStage3Version) {
      return null;
    }
    return selectedStage3Version.final;
  }, [selectedStage3Version]);

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
    setStage3RenderPlan((prev) => ({ ...fallbackRenderPlan(), policy: prev.policy }));
    setStage3SelectedVersionId(null);
    setStage3PassSelectionByVersion({});
    setStage3PreviewNotice(null);
  }, [activeChat?.id, selectedCaption?.option, selectedCaption?.top, selectedCaption?.bottom]);

  useEffect(() => {
    if (currentStep !== 3) {
      return;
    }
    const chat = activeChat;
    if (!chat) {
      return;
    }
    if (stage3Versions.length > 0) {
      return;
    }
    if (!stage3TopText.trim() && !stage3BottomText.trim()) {
      return;
    }
    void ensureStage3Initialized(chat).catch(() => undefined);
  }, [
    currentStep,
    activeChat,
    stage3Versions.length,
    stage3TopText,
    stage3BottomText,
    stage3ClipStartSec,
    stage3FocusY,
    stage3RenderPlan,
    stage3AgentPrompt
  ]);

  useEffect(() => {
    const chatId = activeChat?.id ?? null;
    if (!chatId) {
      initializedStage3ChatRef.current = null;
      setStage3SelectedVersionId(null);
      setStage3PassSelectionByVersion({});
      setStage3AgentPrompt("");
      setStage3RenderPlan(fallbackRenderPlan());
      stage3PreviewRequestKeyRef.current = "";
      setStage3PreviewVideoUrl(null);
      setStage3PreviewNotice(null);
      return;
    }
    if (initializedStage3ChatRef.current === chatId) {
      return;
    }

    initializedStage3ChatRef.current = chatId;
    const latestVersion = stage3Versions[stage3Versions.length - 1] ?? null;
    if (!latestVersion) {
      setStage3SelectedVersionId(null);
      setStage3PassSelectionByVersion({});
      setStage3AgentPrompt("");
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
    }
    applyStage3Snapshot(latestVersion.final);
  }, [activeChat?.id, stage3Versions]);

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

    const previewState = selectedStage3Snapshot
      ? {
          clipStartSec: selectedStage3Snapshot.clipStartSec,
          clipDurationSec: CLIP_DURATION_SEC,
          renderPlan: stripRenderPlanForPreview(
            normalizeRenderPlan(selectedStage3Snapshot.renderPlan, fallbackRenderPlan())
          )
        }
      : stage3LivePreviewState;

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
  }, [currentStep, activeChat?.url, selectedStage3Snapshot, stage3LivePreviewState]);

  const steps: FlowStep[] = useMemo(
    () => [
      { id: 1, label: "Paste link", enabled: true },
      { id: 2, label: "Review & pick", enabled: Boolean(activeChat) },
      { id: 3, label: "Render video", enabled: Boolean(latestStage2Event) }
    ],
    [activeChat, latestStage2Event]
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
      const hasStage2 = chat.events.some((event) => event.type === "stage2" && event.role === "assistant");
      setCurrentStep(hasStage2 ? 3 : 2);
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
    setStage3RenderPlan(fallbackRenderPlan());
    setSourceDurationSec(null);
    setStage3AgentPrompt("");
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
      templateId: STAGE3_TEMPLATE_ID,
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

  const codexBadgeConnected = codexLoggedIn;

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
      codexConnected={codexBadgeConnected}
      codexBusyConnect={busyAction === "connect-codex"}
      codexBusyRefresh={busyAction === "refresh-codex" || isCodexAuthLoading}
      onConnectCodex={() => {
        void startCodexDeviceAuth();
      }}
      onRefreshCodex={() => {
        void refreshCodexAuth();
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
          stage2={latestStage2Event?.payload ?? null}
          stageCreatedAt={latestStage2Event?.createdAt ?? null}
          instruction={stage2Instruction}
          canRunStage2={Boolean(activeChat && codexLoggedIn) && !isBusy}
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
          previewVideoUrl={stage3PreviewVideoUrl}
          versions={stage3Versions}
          selectedVersionId={stage3SelectedVersionId}
          selectedPassIndex={selectedStage3PassIndex}
          isPreviewLoading={busyAction === "video-preview"}
          previewNotice={stage3PreviewNotice}
          agentPrompt={stage3AgentPrompt}
          topText={stage3TopText}
          bottomText={stage3BottomText}
          clipStartSec={stage3ClipStartSec}
          clipDurationSec={CLIP_DURATION_SEC}
          sourceDurationSec={sourceDurationSec}
          focusY={stage3FocusY}
          isRendering={busyAction === "render"}
          isOptimizing={busyAction === "stage3-optimize"}
          onRender={() => {
            void handleRenderVideo();
          }}
          onOptimize={() => {
            void handleOptimizeStage3();
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
          onExport={handleExportTemplate}
        />
      ) : null}
    </AppShell>
  );
}
