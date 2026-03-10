import {
  Stage3AgentPass,
  Stage3OptimizationRun,
  Stage3RenderPlan,
  Stage3SessionStatus,
  Stage3StateSnapshot,
  Stage3Version
} from "../app/components/types";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "./stage3-constants";

const CLIP_DURATION_SEC = 6;
const DEFAULT_TEMPLATE_ID = "science-card-v1";
const DEFAULT_TEXT_SCALE = 1.25;

export type Stage3AgentSessionRef = {
  sessionId: string;
  status: Stage3SessionStatus | null;
  finalVersionId: string | null;
  bestVersionId: string | null;
};

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
    policy: "full_source_normalize",
    backgroundAssetId: null,
    backgroundAssetMimeType: null,
    musicAssetId: null,
    musicAssetMimeType: null,
    avatarAssetId: null,
    avatarAssetMimeType: null,
    authorName: "Science Snack",
    authorHandle: "@Science_Snack_1",
    templateId: DEFAULT_TEMPLATE_ID,
    prompt: ""
  };
}

function normalizeRenderPlan(value: unknown, fallback = fallbackRenderPlan()): Stage3RenderPlan {
  const candidate = value && typeof value === "object" ? (value as Partial<Stage3RenderPlan>) : undefined;
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
            speed:
              typeof (segment as { speed?: unknown }).speed === "number" &&
              [1, 1.5, 2, 2.5, 3, 4, 5].includes((segment as { speed?: number }).speed ?? 0)
                ? ((segment as { speed?: number }).speed as Stage3RenderPlan["segments"][number]["speed"])
                : 1,
            label:
              typeof segment.label === "string" && segment.label.trim()
                ? segment.label
                : `${startSec.toFixed(1)}-${endSec === null ? "end" : endSec.toFixed(1)}`
          };
        })
        .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
    : fallback.segments;

  return {
    targetDurationSec: 6,
    timingMode:
      candidate?.timingMode === "auto" ||
      candidate?.timingMode === "compress" ||
      candidate?.timingMode === "stretch"
        ? candidate.timingMode
        : fallback.timingMode,
    audioMode:
      candidate?.audioMode === "source_only" || candidate?.audioMode === "source_plus_music"
        ? candidate.audioMode
        : fallback.audioMode,
    sourceAudioEnabled: Boolean(candidate?.sourceAudioEnabled ?? fallback.sourceAudioEnabled),
    smoothSlowMo: Boolean(candidate?.smoothSlowMo ?? fallback.smoothSlowMo),
    mirrorEnabled: Boolean(candidate?.mirrorEnabled ?? fallback.mirrorEnabled),
    cameraMotion:
      candidate?.cameraMotion === "top_to_bottom" || candidate?.cameraMotion === "bottom_to_top"
        ? candidate.cameraMotion
        : fallback.cameraMotion,
    videoZoom:
      typeof candidate?.videoZoom === "number" && Number.isFinite(candidate.videoZoom)
        ? Math.min(STAGE3_MAX_VIDEO_ZOOM, Math.max(STAGE3_MIN_VIDEO_ZOOM, candidate.videoZoom))
        : fallback.videoZoom,
    topFontScale:
      typeof candidate?.topFontScale === "number" && Number.isFinite(candidate.topFontScale)
        ? Math.min(1.9, Math.max(0.7, candidate.topFontScale))
        : fallback.topFontScale,
    bottomFontScale:
      typeof candidate?.bottomFontScale === "number" && Number.isFinite(candidate.bottomFontScale)
        ? Math.min(1.9, Math.max(0.7, candidate.bottomFontScale))
        : fallback.bottomFontScale,
    musicGain:
      typeof candidate?.musicGain === "number" && Number.isFinite(candidate.musicGain)
        ? Math.min(1, Math.max(0, candidate.musicGain))
        : fallback.musicGain,
    textPolicy:
      candidate?.textPolicy === "strict_fit" ||
      candidate?.textPolicy === "preserve_words" ||
      candidate?.textPolicy === "aggressive_compact"
        ? candidate.textPolicy
        : fallback.textPolicy,
    segments,
    policy:
      candidate?.policy === "adaptive_window" ||
      candidate?.policy === "full_source_normalize" ||
      candidate?.policy === "fixed_segments"
        ? candidate.policy
        : fallback.policy,
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
        : fallback.authorName,
    authorHandle:
      typeof candidate?.authorHandle === "string" && candidate.authorHandle.trim()
        ? candidate.authorHandle.trim()
        : fallback.authorHandle,
    templateId:
      typeof candidate?.templateId === "string" && candidate.templateId.trim()
        ? candidate.templateId.trim()
        : fallback.templateId,
    prompt: typeof candidate?.prompt === "string" ? candidate.prompt : fallback.prompt
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
    renderPlan: normalizeRenderPlan(candidate.renderPlan, fallbackRenderPlan())
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
  const normalizedPasses = (Array.isArray(candidate.passes) ? candidate.passes : [])
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
  const internalPasses = (Array.isArray(candidate.internalPasses) ? candidate.internalPasses : [])
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
  const recommendedPass =
    typeof candidate.recommendedPass === "number" && Number.isFinite(candidate.recommendedPass)
      ? candidate.recommendedPass
      : internalPasses[internalPasses.length - 1].pass;
  const baselineFallback = passToSnapshot(internalPasses[0], sourceDurationSec);
  const finalFallback = passToSnapshot(
    internalPasses[Math.max(0, Math.min(internalPasses.length - 1, recommendedPass - 1))],
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
    recommendedPass
  };
}

export function extractLegacyStage3Version(
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

function normalizeLegacyCreatedAt(createdAt: string | undefined, fallback: string): string {
  if (typeof createdAt !== "string") {
    return fallback;
  }

  const normalized = createdAt.trim();
  if (!normalized) {
    return fallback;
  }

  return Number.isNaN(Date.parse(normalized)) ? fallback : normalized;
}

export function buildLegacyTimelineEntries(
  events: Array<{ id: string; createdAt: string; data: unknown }>
): Stage3Version[] {
  const sortedEvents = [...events].sort((left, right) => {
    const leftAt = normalizeLegacyCreatedAt(left.createdAt, "");
    const rightAt = normalizeLegacyCreatedAt(right.createdAt, "");
    if (leftAt === rightAt) {
      return left.id.localeCompare(right.id);
    }
    return leftAt < rightAt ? -1 : 1;
  });

  const versions: Stage3Version[] = [];
  let versionNo = 1;
  for (const event of sortedEvents) {
    const version = extractLegacyStage3Version(event.data, event.id, event.createdAt, versionNo);
    if (!version) {
      continue;
    }
    versions.push(version);
    versionNo = Math.max(versionNo + 1, version.versionNo + 1);
  }

  return versions
    .sort((left, right) => {
      if (left.createdAt === right.createdAt) {
        return left.runId.localeCompare(right.runId);
      }
      return left.createdAt < right.createdAt ? -1 : 1;
    })
    .map((version, index) => ({ ...version, versionNo: index + 1 }));
}

export function normalizeStage3SessionStatus(value: unknown): Stage3SessionStatus | null {
  return value === "running" || value === "completed" || value === "partiallyApplied" || value === "failed"
    ? value
    : null;
}

export function extractStage3AgentSessionRef(data: unknown): Stage3AgentSessionRef | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as Record<string, unknown>;
  if (candidate.kind !== "stage3-agent-session") {
    return null;
  }

  const sessionId =
    typeof candidate.sessionId === "string" && candidate.sessionId.trim() ? candidate.sessionId.trim() : null;
  if (!sessionId) {
    return null;
  }

  const normalizeVersionId = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  return {
    sessionId,
    status: normalizeStage3SessionStatus(candidate.status),
    finalVersionId: normalizeVersionId(candidate.finalVersionId ?? candidate.currentVersionId),
    bestVersionId: normalizeVersionId(candidate.bestVersionId)
  };
}

export function findLatestStage3AgentSessionRef(
  events: Array<{ data?: unknown }>
): Stage3AgentSessionRef | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const sessionRef = extractStage3AgentSessionRef(events[index]?.data);
    if (sessionRef) {
      return sessionRef;
    }
  }
  return null;
}
