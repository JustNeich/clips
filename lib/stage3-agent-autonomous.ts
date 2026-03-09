import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

import {
  approxSegmentsDuration,
  applyOperations,
  createSnapshot,
  estimatePreTimingDuration,
  evaluateScore,
  hasActionRegionCue,
  hasFullSourceCue,
  hasMeaningfulMediaChange,
  hasSubjectIsolationCue,
  inferIsolationZoomValue,
  inferHeuristicOperations,
  parseUserIntent,
  Stage3EvaluationContext
} from "./stage3-agent";
import {
  analyzeStage3FramedPreview,
  analyzeBestClipAndFocus,
  clampClipStart,
  type Stage3FramingMetrics,
  sanitizeFocusY
} from "./stage3-media-agent";
import { planStage3OperationsWithCodex } from "./stage3-agent-llm";
import { Stage3Operation, Stage3StateSnapshot } from "../app/components/types";
import { ensureCodexHomeForSession, normalizeCodexSessionId } from "./codex-session";
import { ensureCodexLoggedIn } from "./codex-runner";
import {
  type Stage3GoalType,
  type Stage3IterationPlan,
  type Stage3IterationRecord,
  type Stage3IterationScores,
  type Stage3IterationStopReason,
  type Stage3MessageRecord,
  type Stage3SessionRecord,
  type Stage3SessionStatus,
  type Stage3VersionRecord,
  createIteration,
  createMessage,
  createSession,
  createVersion,
  findIdempotency,
  getSession,
  getSessionsByProjectId,
  getVersion,
  listIterations,
  listVersions,
  registerIdempotency,
  setBestVersion,
  updateSession,
  buildGoalHash
} from "./stage3-session-store";
import { ensureStage3SourceCached } from "./stage3-server-control";

const PREVIEW_FPS = 3;
const DEFAULT_TARGET_SCORE = 0.9;
const DEFAULT_MIN_GAIN = 0.02;
const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_OPERATION_BUDGET = 5;
const MAX_OPERATION_BUDGET = 6;
const DEFAULT_SAFETY_THRESHOLD = 0.3;
const CLIP_DURATION_SEC = 6;
const DEFAULT_TEXT_SCALE = 1.25;
const AUTONOMOUS_ENGINE_VERSION = "stage3-autonomous-2026-03-06-directive-composite-v5";

const execFileAsync = promisify(execFile);

export type Stage3IterationResult = {
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
};

type AutonomyOptions = {
  maxIterations?: number;
  targetScore?: number;
  minGain?: number;
  operationBudget?: number;
};

export type RunAutonomousResponse = {
  status: "applied" | "partiallyApplied" | "failed";
  sessionId: string;
  finalVersionId: string;
  bestVersionId: string;
  iterations: Stage3IterationResult[];
  scoreHistory: number[];
  finalScore: number;
  stabilityNote?: string;
  summary: {
    beforeVersionId: string;
    changedOperations: string[];
    whyStopped: Stage3IterationStopReason;
  };
};

type RunAutonomousInput = {
  sessionId?: string;
  projectId: string;
  mediaId: string;
  sourceUrl?: string;
  goalText: string;
  options?: AutonomyOptions;
  currentSnapshot?: Partial<Stage3StateSnapshot>;
  idempotencyKey?: string;
  autoClipStartSec?: number | null;
  autoFocusY?: number | null;
  sourceDurationSec?: number | null;
  codexSessionId?: string;
  plannerModel?: string;
  plannerReasoningEffort?: string;
  plannerTimeoutMs?: number;
};

type Stage3GoalSignal = {
  goalType: Stage3GoalType;
  confidence: number;
  ambiguity: number;
  constraints: {
    forbidZoom: boolean;
    forbidAudio: boolean;
    forbidCrop: boolean;
    targetZoom?: number | null;
    allowTextRewrite: boolean;
  };
  guidance: {
    tightenFraming: boolean;
    verticalReframe: boolean;
    polish: boolean;
    artifactEdges: Array<"top" | "bottom" | "left" | "right">;
    desiredFocusShift: number;
    preferStrongerIterations: boolean;
    forceIteration: boolean;
    useFullSource: boolean;
  };
  rawGoal: string;
};

type Stage3RealityMetrics = Stage3FramingMetrics & {
  stability: number;
  motionMean: number;
  previewPath: string;
  keyframePaths: string[];
};

type Stage3RuntimeContext = {
  goalText: string;
  sourceUrl: string;
  sourcePath: string;
  sourceDurationSec: number | null;
  mediaId: string;
  session: Stage3SessionRecord;
  options: {
    maxIterations: number;
    targetScore: number;
    minGain: number;
    operationBudget: number;
  };
  autoClipStartSec: number;
  autoFocusY: number;
  sessionState: {
    initialVersionId: string;
    currentSnapshot: Stage3StateSnapshot;
    currentVersionId: string;
    bestVersionId: string;
    iterationOffset: number;
    bestScore: number;
    stagnation: number;
    lastIterationScore: number;
    currentRealityMetrics: Stage3RealityMetrics | null;
  };
};

type JudgeInputs = {
  before: Stage3StateSnapshot;
  after: Stage3StateSnapshot;
  plan: Stage3IterationPlan;
  appliedOps: Stage3Operation[];
  iterationIndex: number;
  goalSignal: Stage3GoalSignal;
  sourcePath: string;
  sourceDurationSec: number | null;
  autoClipStartSec: number;
  autoFocusY: number;
  beforeScoreNormalized: number;
  context: Stage3EvaluationContext;
  realityMetrics?: Stage3RealityMetrics;
};

type JudgeResult = {
  scores: Stage3IterationScores;
  notes: string;
  safetyFailReason: string | null;
};

type PlannerInput = {
  goalSignal: Stage3GoalSignal;
  goalText: string;
  snapshot: Stage3StateSnapshot;
  autoClipStartSec: number;
  autoFocusY: number;
  iterationIndex: number;
  planBudget: number;
  lastTotalScore: number;
  sourceDurationSec: number | null;
  realityMetrics?: Stage3RealityMetrics | null;
  codexHome?: string;
  planner?: {
    model: string;
    reasoningEffort: string;
    timeoutMs: number;
  };
};

type SourceContext = {
  sourcePath: string;
  sourceDurationSec: number | null;
  tmpDir: string;
};

type SnapshotFingerprintInput = {
  clipStartSec?: number | null;
  focusY?: number | null;
  topText?: string;
  bottomText?: string;
  renderPlan?: {
    videoZoom?: number | null;
    topFontScale?: number | null;
    bottomFontScale?: number | null;
    timingMode?: string | null;
    audioMode?: string | null;
    textPolicy?: string | null;
    smoothSlowMo?: boolean | null;
    policy?: string | null;
    segments?: string[];
    segmentCount?: number;
  };
};

const runLocks = new Map<string, Promise<unknown>>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(value, 0, 1);
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function toRoundedNumber(value: number | null | undefined, digits = 4): number | null {
  if (!Number.isFinite(value as number)) {
    return null;
  }
  return Number((value as number).toFixed(digits));
}

function snapshotStateFingerprint(snapshot?: Partial<Stage3StateSnapshot>): string {
  const plan = snapshot?.renderPlan as Partial<Stage3StateSnapshot["renderPlan"]> | undefined;
  const normalizedSegments = Array.isArray(plan?.segments)
    ? plan.segments
        .filter((segment) => segment && typeof segment === "object")
        .map((segment) => {
          const start = toRoundedNumber(parseFiniteNumber((segment as { startSec: unknown }).startSec), 3);
          const end = toRoundedNumber(parseFiniteNumber((segment as { endSec: unknown }).endSec), 3);
          return `${start ?? "x"}:${end ?? "x"}`;
        })
    : [];

  const normalizedTopText =
    typeof snapshot?.topText === "string" ? snapshot.topText.trim().toLowerCase() : "";
  const normalizedBottomText =
    typeof snapshot?.bottomText === "string" ? snapshot.bottomText.trim().toLowerCase() : "";
  const payload: SnapshotFingerprintInput = {
    clipStartSec: toRoundedNumber(parseFiniteNumber(snapshot?.clipStartSec)),
    focusY: toRoundedNumber(parseFiniteNumber(snapshot?.focusY)),
    topText: normalizedTopText,
    bottomText: normalizedBottomText,
    renderPlan: {
      videoZoom: toRoundedNumber(parseFiniteNumber(plan?.videoZoom)),
      topFontScale: toRoundedNumber(parseFiniteNumber(plan?.topFontScale)),
      bottomFontScale: toRoundedNumber(parseFiniteNumber(plan?.bottomFontScale)),
      timingMode: typeof plan?.timingMode === "string" ? plan.timingMode : null,
      audioMode: typeof plan?.audioMode === "string" ? plan.audioMode : null,
      textPolicy: typeof plan?.textPolicy === "string" ? plan.textPolicy : null,
      smoothSlowMo: typeof plan?.smoothSlowMo === "boolean" ? plan.smoothSlowMo : null,
      policy: typeof plan?.policy === "string" ? plan.policy : null,
      segments: normalizedSegments,
      segmentCount: plan?.segments?.length ?? 0
    }
  };

  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

function buildRunIdempotencyKey(input: {
  projectId: string;
  mediaId: string;
  sourceUrl: string;
  goalText: string;
  options: {
    maxIterations: number;
    targetScore: number;
    minGain: number;
    operationBudget: number;
  };
  autoClipStartSec: number;
  autoFocusY: number;
  sourceDurationSec: number | null;
  currentSnapshot?: Partial<Stage3StateSnapshot>;
}): string {
  const fingerprint = {
    engineVersion: AUTONOMOUS_ENGINE_VERSION,
    projectId: input.projectId,
    mediaId: input.mediaId,
    sourceUrl: input.sourceUrl,
    goalText: input.goalText.toLowerCase().trim(),
    options: {
      maxIterations: input.options.maxIterations,
      targetScore: toRoundedNumber(input.options.targetScore, 2),
      minGain: toRoundedNumber(input.options.minGain, 4),
      operationBudget: input.options.operationBudget
    },
    autoClipStartSec: toRoundedNumber(input.autoClipStartSec, 3),
    autoFocusY: toRoundedNumber(input.autoFocusY, 3),
    sourceDurationSec: toRoundedNumber(input.sourceDurationSec, 2),
    snapshotState: snapshotStateFingerprint(input.currentSnapshot)
  };

  return createHash("sha1").update(JSON.stringify(fingerprint)).digest("hex");
}

function buildScopedUserIdempotencyKey(input: {
  rawKey: string;
  sessionId?: string;
  projectId: string;
  mediaId: string;
  goalHash: string;
}): string {
  const payload = {
    rawKey: input.rawKey.trim(),
    sessionId: input.sessionId ?? "new",
    projectId: input.projectId,
    mediaId: input.mediaId,
    goalHash: input.goalHash
  };
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function lockKeyFromInput(input: {
  sessionId?: string;
  projectId: string;
  mediaId: string;
  goalText: string;
  options?: AutonomyOptions;
}): string {
  if (input.sessionId) {
    return `session:${input.sessionId}`;
  }
  return `run:${input.projectId}:${input.mediaId}:${buildGoalHash(input.goalText)}:${input.options?.maxIterations ?? "n"}:${input.options?.operationBudget ?? "n"}:${input.options?.targetScore ?? "n"}:${input.options?.minGain ?? "n"}`;
}

async function withRunLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = runLocks.get(key) ?? Promise.resolve();
  const lock = previous.catch(() => undefined).then(() => task());
  runLocks.set(key, lock);
  try {
    return await lock;
  } finally {
    if (runLocks.get(key) === lock) {
      runLocks.delete(key);
    }
  }
}

function dedupeByOpKind(operations: Stage3Operation[]): Stage3Operation[] {
  const result: Stage3Operation[] = [];
  const byKind = new Map<string, Stage3Operation>();
  for (const op of operations) {
    byKind.set(op.op, op);
  }
  for (const op of byKind.values()) {
    result.push(op);
  }
  return result;
}

function operationPriority(op: Stage3Operation): number {
  switch (op.op) {
    case "set_segments":
      return 0;
    case "append_segment":
      return 1;
    case "clear_segments":
      return 2;
    case "set_timing_mode":
      return 3;
    case "set_audio_mode":
      return 4;
    case "set_slowmo":
      return 5;
    case "set_music_gain":
      return 6;
    case "set_clip_start":
      return 7;
    case "set_focus_y":
      return 8;
    case "set_video_zoom":
      return 9;
    case "set_top_font_scale":
      return 10;
    case "set_bottom_font_scale":
      return 11;
    case "set_text_policy":
      return 12;
    case "rewrite_top_text":
      return 13;
    case "rewrite_bottom_text":
      return 14;
    default:
      return 50;
  }
}

function prioritizeOperations(operations: Stage3Operation[]): Stage3Operation[] {
  return [...operations].sort((left, right) => operationPriority(left) - operationPriority(right));
}

function buildImplicitTimingSegments(params: {
  timingMode: "compress" | "stretch";
  sourceDurationSec: number | null;
  seedStartSec: number;
}): Stage3Operation | null {
  const sourceDurationSec = params.sourceDurationSec;
  if (!sourceDurationSec || sourceDurationSec <= 0.05) {
    return null;
  }

  const desiredSourceSpan =
    params.timingMode === "stretch"
      ? Math.min(sourceDurationSec, Math.max(1.8, CLIP_DURATION_SEC * 0.78))
      : Math.min(sourceDurationSec, Math.max(CLIP_DURATION_SEC + 1.2, CLIP_DURATION_SEC * 1.35));

  if (params.timingMode === "stretch" && desiredSourceSpan >= CLIP_DURATION_SEC - 0.08) {
    return null;
  }
  if (params.timingMode === "compress" && desiredSourceSpan <= CLIP_DURATION_SEC + 0.08) {
    return null;
  }

  const startSec = clampClipStart(params.seedStartSec, sourceDurationSec, desiredSourceSpan);
  const endSec = Math.min(sourceDurationSec, startSec + desiredSourceSpan);
  return {
    op: "set_segments",
    segments: [
      {
        startSec,
        endSec,
        label: `${startSec.toFixed(2)}-${endSec.toFixed(2)}`,
        speed: 1
      }
    ]
  };
}

function buildRequiredDirectiveOps(
  snapshot: Stage3StateSnapshot,
  goalSignal: Stage3GoalSignal
): Stage3Operation[] {
  const intent = parseUserIntent(goalSignal.rawGoal, snapshot.sourceDurationSec);
  const ops: Stage3Operation[] = [];

  if (intent.segments.length > 0) {
    ops.push({
      op: "set_segments",
      segments: intent.segments
    });
  } else if (
    intent.timingMode &&
    goalSignal.guidance.useFullSource &&
    snapshot.sourceDurationSec &&
    snapshot.sourceDurationSec > 0.05
  ) {
    ops.push({
      op: "set_segments",
      segments: [
        {
          startSec: 0,
          endSec: snapshot.sourceDurationSec,
          label: `0-${snapshot.sourceDurationSec.toFixed(2)}`,
          speed: 1
        }
      ]
    });
    if (snapshot.clipStartSec !== 0) {
      ops.push({
        op: "set_clip_start",
        clipStartSec: 0
      });
    }
  } else if (
    intent.timingMode === "compress" ||
    intent.timingMode === "stretch"
  ) {
    const implicitSegments = buildImplicitTimingSegments({
      timingMode: intent.timingMode,
      sourceDurationSec: snapshot.sourceDurationSec,
      seedStartSec: snapshot.clipStartSec
    });
    if (implicitSegments) {
      ops.push(implicitSegments);
    }
  }

  if (intent.timingMode) {
    ops.push({
      op: "set_timing_mode",
      timingMode: intent.timingMode
    });
  }
  if (intent.audioMode) {
    ops.push({
      op: "set_audio_mode",
      audioMode: intent.audioMode
    });
  }
  if (intent.smoothSlowMo) {
    ops.push({
      op: "set_slowmo",
      smoothSlowMo: true
    });
  }

  return prioritizeOperations(dedupeByOpKind(ops));
}

function hasAnyCue(value: string, cues: string[]): boolean {
  return cues.some((cue) => value.includes(cue));
}

function detectArtifactEdges(value: string): Array<"top" | "bottom" | "left" | "right"> {
  const edges: Array<"top" | "bottom" | "left" | "right"> = [];
  if (
    hasAnyCue(value, [
      "сверху",
      "вверху",
      "верху",
      "верхний край",
      "top edge",
      "at the top",
      "top strip",
      "top artifact"
    ])
  ) {
    edges.push("top");
  }
  if (
    hasAnyCue(value, [
      "снизу",
      "внизу",
      "нижний край",
      "bottom edge",
      "at the bottom",
      "bottom strip",
      "bottom artifact"
    ])
  ) {
    edges.push("bottom");
  }
  if (hasAnyCue(value, ["слева", "левый край", "left edge", "on the left", "left artifact"])) {
    edges.push("left");
  }
  if (hasAnyCue(value, ["справа", "правый край", "right edge", "on the right", "right artifact"])) {
    edges.push("right");
  }
  return edges;
}

function hasVisualCleanupCue(value: string): boolean {
  return hasAnyCue(value, [
    "виднеется",
    "торчит",
    "кусочек",
    "кусок",
    "артефакт",
    "лишнее",
    "убери сверху",
    "убери снизу",
    "доведи до идеала",
    "до идеала",
    "идеал",
    "идеально",
    "подчисти",
    "подправь",
    "refine",
    "polish",
    "artifact",
    "clean up",
    "extra piece",
    "little piece",
    "small piece"
  ]);
}

function hasVerticalReframeCue(value: string): boolean {
  return hasAnyCue(value, [
    "вертикально",
    "вертикаль",
    "спозиционируй",
    "позиционируй",
    "сдвинь выше",
    "сдвинь ниже",
    "по центру",
    "отцентрируй",
    "выровняй",
    "центрируй",
    "reposition",
    "vertical",
    "center it",
    "align it",
    "reframe"
  ]);
}

function ingestGoal(goalText: string): Stage3GoalSignal {
  const rawGoal = goalText.trim();
  const lower = rawGoal.toLowerCase();
  const intent = parseUserIntent(goalText, null);
  const subjectIsolation = hasSubjectIsolationCue(lower);
  const actionRegion = hasActionRegionCue(lower);
  const artifactEdges = detectArtifactEdges(lower);
  const visualCleanup = hasVisualCleanupCue(lower);
  const verticalReframe = hasVerticalReframeCue(lower);
  const useFullSource = hasFullSourceCue(lower);
  const tightenFraming =
    subjectIsolation ||
    actionRegion ||
    hasAnyCue(lower, [
      "только квадрат",
      "только исходное видео",
      "только видео",
      "оставь только квадрат",
      "оставался только",
      "только целевое видео",
      "only the source video",
      "only the square",
      "just the video",
      "keep only the source",
      "frame only"
    ]);
  const hasFragmentsGoal =
    intent.segments.length > 0 ||
    hasAnyCue(lower, [
      "фрагменты",
      "фрагмент",
      "нарезка",
      "куски",
      "сцены",
      "segments",
      "segment",
      "clips only",
      "use fragments"
    ]);
  const hasTimingGoal =
    intent.timingMode !== null ||
    hasAnyCue(lower, [
      "сожми",
      "ужми",
      "ужать",
      "растяни",
      "растянуть",
      "ускорь",
      "замедли",
      "до 6с",
      "до 6 сек",
      "в 6 секунд",
      "ровно 6 секунд",
      "ровно 6 сек",
      "exactly 6 seconds",
      "compress",
      "stretch",
      "speed up",
      "slow down"
    ]);

  const hasFocus =
    lower.includes("focus") ||
    lower.includes("фокус") ||
    lower.includes("основной объект") ||
    lower.includes("только модель") ||
    lower.includes("только лицо") ||
    lower.includes("главный объект") ||
    subjectIsolation ||
    actionRegion ||
    tightenFraming ||
    visualCleanup ||
    verticalReframe ||
    artifactEdges.length > 0;
  const hasZoom =
    lower.includes("zoom") ||
    lower.includes("зум") ||
    lower.includes("крупнее") ||
    lower.includes("увелич") ||
    lower.includes("ближе");
  const hasCrop = lower.includes("crop") || lower.includes("обрез") || lower.includes("обрезать");
  const hasColor =
    lower.includes("цвет") || lower.includes("brightness") || lower.includes("контраст") || lower.includes("ярк") || lower.includes("хром");
  const hasStab = lower.includes("стабили") || lower.includes("stabil");
  const hasAudio = lower.includes("звук") || lower.includes("аудио") || lower.includes("музык");
  const hasText = lower.includes("текст") || lower.includes("шрифт") || lower.includes("text");

  let goalType: Stage3GoalType = "unknown";
  let confidence = 0.35;
  let ambiguity = 0.62;
  if (hasFragmentsGoal) {
    goalType = "fragments";
    confidence = intent.segments.length > 0 ? 0.92 : 0.74;
    ambiguity = intent.segments.length > 0 ? 0.18 : 0.38;
  } else if (hasTimingGoal) {
    goalType = "timing";
    confidence = intent.timingMode ? 0.9 : 0.72;
    ambiguity = intent.timingMode ? 0.18 : 0.34;
  } else if (hasFocus) {
    goalType = "focusOnly";
    confidence = subjectIsolation || actionRegion || tightenFraming ? 0.88 : visualCleanup ? 0.78 : 0.82;
    ambiguity = visualCleanup || artifactEdges.length > 0 ? 0.42 : subjectIsolation || actionRegion ? 0.31 : 0.36;
  } else if (hasZoom) {
    goalType = "zoom";
    confidence = 0.72;
    ambiguity = 0.38;
  } else if (hasCrop) {
    goalType = "crop";
    confidence = 0.64;
    ambiguity = 0.46;
  } else if (hasColor) {
    goalType = "color";
    confidence = 0.54;
    ambiguity = 0.56;
  } else if (hasStab) {
    goalType = "stabilization";
    confidence = 0.58;
    ambiguity = 0.55;
  } else if (hasAudio) {
    goalType = "audio";
    confidence = 0.52;
    ambiguity = 0.54;
  } else if (hasText) {
    goalType = "text";
    confidence = 0.54;
    ambiguity = 0.52;
  }

  const desiredFocusShift =
    (artifactEdges.includes("top") ? 0.08 : 0) +
    (artifactEdges.includes("bottom") ? -0.08 : 0);
  const preferStrongerIterations =
    tightenFraming || visualCleanup || verticalReframe || artifactEdges.length > 0;
  const targetZoomFromLanguage =
    typeof intent.zoomValue === "number" && Number.isFinite(intent.zoomValue)
      ? intent.zoomValue
      : goalType === "focusOnly" && !lower.includes("без зума") && !lower.includes("no zoom")
        ? clamp(
            Math.max(
              inferIsolationZoomValue(lower),
              tightenFraming ? 1.24 : 1.12,
              visualCleanup || artifactEdges.length > 0 ? 1.18 : 1
            ),
            1,
            1.36
          )
        : null;

  return {
    goalType,
    confidence,
    ambiguity,
    constraints: {
      forbidZoom: lower.includes("без зума") || lower.includes("no zoom") || lower.includes("убери зум") || lower.includes("убрать зум"),
      forbidAudio: lower.includes("без звука") || lower.includes("mute") || lower.includes("без звуковой") || lower.includes("mute audio"),
      forbidCrop: lower.includes("без кроп") || lower.includes("не обрез") || lower.includes("dont crop") || lower.includes("не трогай crop"),
      targetZoom: targetZoomFromLanguage,
      allowTextRewrite: intent.fontDirection !== null || intent.fontTarget !== null || hasText
    },
    guidance: {
      tightenFraming,
      verticalReframe,
      polish: visualCleanup,
      artifactEdges,
      desiredFocusShift,
      preferStrongerIterations,
      forceIteration: visualCleanup || verticalReframe || artifactEdges.length > 0,
      useFullSource
    },
    rawGoal
  };
}

function clampRenderOp(op: Stage3Operation, snapshot: Stage3StateSnapshot, iterationIndex: number): Stage3Operation {
  const maxZoomStep = iterationIndex <= 2 ? 0.16 : iterationIndex <= 4 ? 0.1 : 0.08;
  const maxPanStep = iterationIndex <= 2 ? 0.1 : iterationIndex <= 4 ? 0.05 : 0.03;

  switch (op.op) {
    case "set_video_zoom": {
      const requested = clamp(op.videoZoom, 1, 1.6);
      const bounded = clamp(requested, clamp(snapshot.renderPlan.videoZoom - maxZoomStep, 1, 1.6), clamp(snapshot.renderPlan.videoZoom + maxZoomStep, 1, 1.6));
      return { ...op, videoZoom: bounded };
    }
    case "set_focus_y": {
      const bounded = clamp(op.focusY, snapshot.focusY - maxPanStep, snapshot.focusY + maxPanStep);
      return { ...op, focusY: sanitizeFocusY(bounded) };
    }
    case "set_clip_start": {
      return {
        ...op,
        clipStartSec: clampClipStart(op.clipStartSec, snapshot.sourceDurationSec, CLIP_DURATION_SEC)
      };
    }
    case "set_top_font_scale":
      return { ...op, topFontScale: clamp(op.topFontScale, 0.7, 1.9) };
    case "set_bottom_font_scale":
      return { ...op, bottomFontScale: clamp(op.bottomFontScale, 0.7, 1.9) };
    case "set_music_gain":
      return { ...op, musicGain: clamp(op.musicGain, 0, 1) };
    default:
      return op;
  }
}

function guardAndNormalizePlan(
  plan: Stage3IterationPlan,
  snapshot: Stage3StateSnapshot,
  goalSignal: Stage3GoalSignal,
  iterationIndex: number,
  planBudget: number
): Stage3IterationPlan {
  const requiredOps = buildRequiredDirectiveOps(snapshot, goalSignal);
  const budget = Math.max(
    requiredOps.length,
    Math.max(1, Math.min(MAX_OPERATION_BUDGET, Math.max(1, Math.floor(planBudget))))
  );
  const candidateOps = prioritizeOperations(
    dedupeByOpKind([...plan.operations, ...requiredOps])
  );
  const budgeted = candidateOps.slice(0, budget);
  const allowedKinds = new Set<string>([
    "set_segments",
    "append_segment",
    "clear_segments",
    "set_timing_mode",
    "set_audio_mode",
    "set_slowmo",
    "set_clip_start",
    "set_focus_y",
    "set_video_zoom",
    "set_top_font_scale",
    "set_bottom_font_scale",
    "set_music_gain",
    "set_text_policy",
    "rewrite_top_text",
    "rewrite_bottom_text"
  ]);

  const next: Stage3Operation[] = [];

  for (const op of budgeted) {
    if (!allowedKinds.has(op.op)) {
      continue;
    }
    if (goalSignal.constraints.forbidZoom && op.op === "set_video_zoom") {
      continue;
    }
    if (goalSignal.constraints.forbidAudio &&
      (op.op === "set_audio_mode" || op.op === "set_music_gain")) {
      continue;
    }
    if (goalSignal.constraints.forbidCrop && (op.op === "set_clip_start" || op.op === "set_segments" || op.op === "append_segment" || op.op === "clear_segments")) {
      continue;
    }
    if ((op.op === "rewrite_top_text" || op.op === "rewrite_bottom_text") && !goalSignal.constraints.allowTextRewrite) {
      continue;
    }

    next.push(clampRenderOp(op, snapshot, iterationIndex));
  }

  if (
    goalSignal.goalType === "timing" &&
    goalSignal.guidance.useFullSource &&
    snapshot.sourceDurationSec &&
    snapshot.sourceDurationSec > 0.05 &&
    !coversFullSource(snapshot) &&
    !next.some((op) => op.op === "set_segments")
  ) {
    next.push({
      op: "set_segments",
      segments: [
        {
          startSec: 0,
          endSec: snapshot.sourceDurationSec,
          label: `0-${snapshot.sourceDurationSec.toFixed(2)}`,
          speed: 1
        }
      ]
    });
    if (snapshot.clipStartSec !== 0 && !next.some((op) => op.op === "set_clip_start")) {
      next.push({
        op: "set_clip_start",
        clipStartSec: 0
      });
    }
  }

  const deduped = prioritizeOperations(dedupeByOpKind(next))
    .filter((op, index, all): op is Stage3Operation => {
      const later = all.slice(index + 1).find((item) => item.op === op.op);
      return !later;
    })
    .slice(0, candidateOps.length > 0 ? budget : 0);

  return {
    ...plan,
    operations: deduped,
    magnitudes: deduped.map(() => 1)
  };
}

function summarizeRealityMetrics(metrics: Stage3RealityMetrics | null | undefined): string {
  if (!metrics) {
    return "visual metrics unavailable";
  }
  return [
    `activeCenterY=${metrics.activeCenterY.toFixed(2)}`,
    `activeSpan=${metrics.activeSpan.toFixed(2)}`,
    `topEdge=${metrics.topEdgeEnergy.toFixed(2)}`,
    `bottomEdge=${metrics.bottomEdgeEnergy.toFixed(2)}`,
    `edgeEnergy=${metrics.edgeEnergy.toFixed(2)}`,
    `centerEnergy=${metrics.centerEnergy.toFixed(2)}`,
    `visualFocus=${metrics.visualFocus.toFixed(2)}`
  ].join("; ");
}

function coversFullSource(snapshot: Stage3StateSnapshot): boolean {
  const sourceDurationSec = snapshot.sourceDurationSec;
  if (!sourceDurationSec || sourceDurationSec <= 0.05) {
    return snapshot.renderPlan.segments.length === 0;
  }
  if (snapshot.renderPlan.policy === "full_source_normalize" && snapshot.renderPlan.segments.length === 0) {
    return true;
  }
  if (snapshot.renderPlan.segments.length !== 1) {
    return false;
  }
  const [segment] = snapshot.renderPlan.segments;
  return (
    Math.abs(segment.startSec - 0) <= 0.05 &&
    Math.abs((segment.endSec ?? sourceDurationSec) - sourceDurationSec) <= 0.2
  );
}

function computeSegmentsFit(
  snapshot: Stage3StateSnapshot,
  requestedSegments: Stage3StateSnapshot["renderPlan"]["segments"],
  sourceDurationSec: number | null
): number {
  if (requestedSegments.length === 0) {
    return 1;
  }
  const actualSegments = snapshot.renderPlan.segments;
  if (actualSegments.length !== requestedSegments.length) {
    return clamp(actualSegments.length / Math.max(1, requestedSegments.length), 0, 0.68);
  }
  const delta = requestedSegments.reduce((acc, segment, index) => {
    const actual = actualSegments[index];
    if (!actual) {
      return acc + 2;
    }
    return (
      acc +
      Math.abs(actual.startSec - segment.startSec) +
      Math.abs((actual.endSec ?? sourceDurationSec ?? actual.startSec) - (segment.endSec ?? sourceDurationSec ?? segment.startSec))
    );
  }, 0);
  return clamp(1 - delta / Math.max(1, requestedSegments.length * 2.4), 0, 1);
}

function computeTimingFit(
  snapshot: Stage3StateSnapshot,
  requestedTimingMode: Stage3StateSnapshot["renderPlan"]["timingMode"] | null,
  promptLower: string
): number {
  if (!requestedTimingMode) {
    return 1;
  }
  const timingModeFit = snapshot.renderPlan.timingMode === requestedTimingMode ? 1 : 0.24;
  const sourceSpan = estimatePreTimingDuration(snapshot);
  const durationDirectionFit =
    requestedTimingMode === "compress"
      ? sourceSpan > CLIP_DURATION_SEC + 0.08
        ? 1
        : sourceSpan >= CLIP_DURATION_SEC - 0.02
          ? 0.46
          : 0.18
      : requestedTimingMode === "stretch"
        ? sourceSpan < CLIP_DURATION_SEC - 0.08
          ? 1
          : sourceSpan <= CLIP_DURATION_SEC + 0.02
            ? 0.42
            : 0.18
        : 1;
  const targetFit = Math.abs(snapshot.renderPlan.targetDurationSec - CLIP_DURATION_SEC) <= 0.01 ? 1 : 0.3;

  if (!hasFullSourceCue(promptLower) || !snapshot.sourceDurationSec || snapshot.sourceDurationSec <= CLIP_DURATION_SEC) {
    return clamp(0.48 * timingModeFit + 0.32 * durationDirectionFit + 0.2 * targetFit, 0, 1);
  }
  const coverageFit = coversFullSource(snapshot) ? 1 : 0.18;
  return clamp(0.34 * timingModeFit + 0.22 * durationDirectionFit + 0.16 * targetFit + 0.28 * coverageFit, 0, 1);
}

function computeDirectiveCompositeFit(
  snapshot: Stage3StateSnapshot,
  context: Stage3EvaluationContext
): number | null {
  const scores: number[] = [];

  if (context.userIntent.segments.length > 0) {
    scores.push(computeSegmentsFit(snapshot, context.userIntent.segments, context.sourceDurationSec));
  }
  if (context.userIntent.timingMode) {
    scores.push(computeTimingFit(snapshot, context.userIntent.timingMode, context.promptLower));
  }
  if (context.userIntent.audioMode) {
    scores.push(snapshot.renderPlan.audioMode === context.userIntent.audioMode ? 1 : 0.2);
  }
  if (context.userIntent.smoothSlowMo) {
    scores.push(snapshot.renderPlan.smoothSlowMo ? 1 : 0.18);
  }

  if (scores.length === 0) {
    return null;
  }
  const meanScore = scores.reduce((acc, value) => acc + value, 0) / scores.length;
  const minScore = Math.min(...scores);
  return clamp(0.55 * meanScore + 0.45 * minScore, 0, 1);
}

function computeVisualGoalFit(goalSignal: Stage3GoalSignal, realityMetrics: Stage3RealityMetrics): number {
  const centerFit = clamp(1 - Math.abs(realityMetrics.activeCenterY - 0.5) / 0.28, 0, 1);
  const edgeFocusFit = clamp(realityMetrics.visualFocus, 0, 1);
  const requestedEdgePenaltyValues = goalSignal.guidance.artifactEdges.map((edge) => {
    switch (edge) {
      case "top":
        return realityMetrics.topEdgeEnergy;
      case "bottom":
        return realityMetrics.bottomEdgeEnergy;
      case "left":
        return realityMetrics.leftEdgeEnergy;
      case "right":
        return realityMetrics.rightEdgeEnergy;
      default:
        return realityMetrics.edgeEnergy;
    }
  });
  const targetedEdgePenalty =
    requestedEdgePenaltyValues.length > 0
      ? requestedEdgePenaltyValues.reduce((acc, value) => acc + value, 0) / requestedEdgePenaltyValues.length
      : realityMetrics.edgeEnergy;
  const edgeCleanFit = clamp(1 - targetedEdgePenalty, 0, 1);
  const desiredSpan = goalSignal.guidance.tightenFraming ? 0.72 : 0.84;
  const spanFit = clamp(1 - Math.abs(realityMetrics.activeSpan - desiredSpan) / 0.42, 0, 1);

  if (goalSignal.guidance.artifactEdges.length > 0) {
    return clamp(0.5 * edgeCleanFit + 0.3 * centerFit + 0.2 * edgeFocusFit, 0, 1);
  }
  if (goalSignal.guidance.tightenFraming || goalSignal.guidance.verticalReframe || goalSignal.guidance.polish) {
    return clamp(0.34 * centerFit + 0.28 * edgeCleanFit + 0.2 * edgeFocusFit + 0.18 * spanFit, 0, 1);
  }
  return clamp(0.45 * centerFit + 0.3 * edgeFocusFit + 0.25 * spanFit, 0, 1);
}

function buildFallbackPlan(args: {
  goalSignal: Stage3GoalSignal;
  goalText: string;
  snapshot: Stage3StateSnapshot;
  autoClipStartSec: number;
  autoFocusY: number;
  iterationIndex: number;
  planBudget: number;
  sourceDurationSec: number | null;
  realityMetrics?: Stage3RealityMetrics | null;
}): Stage3IterationPlan {
  const intent = parseUserIntent(args.goalText, args.sourceDurationSec);
  const promptLower = args.goalText.toLowerCase();
  const heuristicOps = inferHeuristicOperations({
    snapshot: args.snapshot,
    prompt: args.goalText,
    intent,
    autoClipStartSec: args.autoClipStartSec,
    autoFocusY: args.autoFocusY,
    sourceDurationSec: args.sourceDurationSec
  });

  const tuned: Stage3Operation[] = [];

  if (args.goalSignal.goalType === "timing") {
    const parsedIntent = parseUserIntent(args.goalText, args.sourceDurationSec);
    if (parsedIntent.timingMode) {
      tuned.push({ op: "set_timing_mode", timingMode: parsedIntent.timingMode });
    }
    if (args.goalSignal.guidance.useFullSource && args.sourceDurationSec && args.sourceDurationSec > 0.05 && !coversFullSource(args.snapshot)) {
      tuned.push({
        op: "set_segments",
        segments: [
          {
            startSec: 0,
            endSec: args.sourceDurationSec,
            label: `0-${args.sourceDurationSec.toFixed(2)}`,
            speed: 1
          }
        ]
      });
      if (args.snapshot.clipStartSec !== 0) {
        tuned.push({ op: "set_clip_start", clipStartSec: 0 });
      }
    }
  }

  if (args.goalSignal.goalType === "focusOnly") {
    const visualCenterDrift = (args.realityMetrics?.activeCenterY ?? 0.5) - 0.5;
    const focusTarget = sanitizeFocusY(
      clamp(
        args.snapshot.focusY +
          visualCenterDrift * 0.22 +
          args.goalSignal.guidance.desiredFocusShift +
          (args.goalSignal.guidance.verticalReframe ? (args.autoFocusY - args.snapshot.focusY) * 0.4 : 0),
        0.12,
        0.88
      )
    );
    const focusDelta = focusTarget - args.snapshot.focusY;
    const focusStep = clamp(
      Math.abs(focusDelta),
      0.02,
      args.goalSignal.guidance.preferStrongerIterations ? 0.14 : 0.1
    );
    if (Math.abs(focusDelta) > 0.01) {
      tuned.push({
        op: "set_focus_y",
        focusY: sanitizeFocusY(args.snapshot.focusY + Math.sign(focusDelta) * focusStep)
      });
    }

    if (!args.goalSignal.constraints.forbidZoom) {
      const zoomBase = args.snapshot.renderPlan.videoZoom;
      const visualTightnessNeed =
        args.realityMetrics &&
        (args.realityMetrics.edgeEnergy > 0.28 ||
          args.realityMetrics.visualFocus < 0.58 ||
          args.realityMetrics.activeSpan < (args.goalSignal.guidance.tightenFraming ? 0.68 : 0.58));
      const targetZoom = clamp(
        Math.max(
          args.goalSignal.constraints.targetZoom ?? (1.14 + Math.min(0.24, args.iterationIndex * 0.03)),
          visualTightnessNeed ? zoomBase + 0.04 : zoomBase,
          args.goalSignal.guidance.polish ? 1.18 : 1
        ),
        1,
        args.goalSignal.guidance.preferStrongerIterations ? 1.42 : 1.35
      );
      const direction = targetZoom >= zoomBase ? 1 : -1;
      const step = clamp(
        Math.max(0.03, Math.abs(targetZoom - zoomBase) || 0.03),
        0.03,
        args.goalSignal.guidance.preferStrongerIterations
          ? args.iterationIndex <= 3
            ? 0.14
            : 0.08
          : args.iterationIndex <= 2
            ? 0.1
            : 0.07
      );
      const nextZoom = clamp(zoomBase + direction * step, 1, 1.6);
      tuned.push({
        op: "set_video_zoom",
        videoZoom: clamp(nextZoom, 1, 1.6)
      });
    }

    const clipDelta = Math.abs(args.snapshot.clipStartSec - args.autoClipStartSec);
    if (clipDelta > 0.2) {
      tuned.push({ op: "set_clip_start", clipStartSec: args.autoClipStartSec });
    }
  }

  const candidate = [...heuristicOps, ...tuned];
  const deduped = dedupeByOpKind(candidate)
    .slice(0, Math.max(1, Math.min(args.planBudget, candidate.length || 1)));

  if (deduped.length === 0) {
    const recoveryOps: Stage3Operation[] = [];
    const wantsVisualIsolation =
      args.goalSignal.goalType === "focusOnly" ||
      hasSubjectIsolationCue(promptLower) ||
      hasActionRegionCue(promptLower) ||
      promptLower.includes("видно") ||
      promptLower.includes("visible") ||
      promptLower.includes("show") ||
      promptLower.includes("событ");

    if (wantsVisualIsolation && !args.goalSignal.constraints.forbidZoom) {
      recoveryOps.push({
        op: "set_video_zoom",
        videoZoom: clamp(
          Math.max(
            args.snapshot.renderPlan.videoZoom + (args.goalSignal.guidance.preferStrongerIterations ? 0.1 : args.iterationIndex <= 2 ? 0.08 : 0.05),
            args.goalSignal.constraints.targetZoom ?? 1.14,
            args.goalSignal.guidance.tightenFraming ? 1.2 : 1
          ),
          1,
          args.goalSignal.guidance.preferStrongerIterations ? 1.42 : 1.35
        )
      });
    }

    if (Math.abs(args.snapshot.focusY - args.autoFocusY) > 0.01 || args.goalSignal.guidance.desiredFocusShift !== 0) {
      recoveryOps.push({
        op: "set_focus_y",
        focusY: sanitizeFocusY(
          clamp(args.autoFocusY + args.goalSignal.guidance.desiredFocusShift, 0.12, 0.88)
        )
      });
    }

    if (Math.abs(args.snapshot.clipStartSec - args.autoClipStartSec) > 0.08) {
      recoveryOps.push({
        op: "set_clip_start",
        clipStartSec: args.autoClipStartSec
      });
    }

    const safeRecovery = dedupeByOpKind(recoveryOps).slice(0, Math.max(1, args.planBudget));
    if (safeRecovery.length > 0) {
      return {
        rationale: "Recovery fallback plan after empty heuristic proposal.",
        strategy: "fallback",
        hypothesis: "Apply a safe exploratory framing delta to avoid empty no-op iterations.",
        operations: safeRecovery,
        magnitudes: safeRecovery.map(() => 0.45)
      };
    }
  }

  return {
    rationale:
      args.goalSignal.goalType === "focusOnly"
        ? `Soft focus fallback plan. ${summarizeRealityMetrics(args.realityMetrics)}`
        : "Heuristic fallback plan for quality-safe changes.",
    strategy: "heuristic",
    hypothesis:
      args.goalSignal.goalType === "focusOnly"
        ? "Move focus and adjust framing slightly, then reassess with score feedback."
        : "Apply lightweight heuristic operations to approach the requested goal.",
    operations: deduped,
    magnitudes: deduped.map(() => 0.5)
  };
};

export async function selectNextPlan(input: PlannerInput): Promise<Stage3IterationPlan> {
  if (input.codexHome) {
    try {
      const plan = await planStage3OperationsWithCodex({
        codexHome: input.codexHome,
        prompt: input.goalText,
        snapshot: input.snapshot,
        sourceDurationSec: input.sourceDurationSec,
        passIndex: input.iterationIndex,
        maxPasses: Math.max(1, DEFAULT_MAX_ITERATIONS),
        scoreBefore: input.lastTotalScore * 100,
        lastPassSummary: null,
        model: input.planner?.model ?? "gpt-5.2",
        reasoningEffort: input.planner?.reasoningEffort ?? "extra-high",
        timeoutMs: input.planner?.timeoutMs ?? 120_000,
        imagePaths: [],
        visualDiagnostics: summarizeRealityMetrics(input.realityMetrics)
      });

  const bounded = guardAndNormalizePlan(
        {
          rationale: plan.summary,
          strategy: "llm",
          hypothesis:
            `LLM-план на шаг ${input.iterationIndex} для цели: ${input.goalText.slice(0, 40).trim()}${input.goalText.length > 40 ? "..." : ""}`,
          operations: plan.operations,
          magnitudes: plan.operations.map(() => 0.8)
        },
        input.snapshot,
        input.goalSignal,
        input.iterationIndex,
        input.planBudget
      );
      if (bounded.operations.length > 0) {
        return bounded;
      }
      const fallbackPlan = buildFallbackPlan({
        goalSignal: input.goalSignal,
        goalText: input.goalText,
        snapshot: input.snapshot,
        autoClipStartSec: input.autoClipStartSec,
        autoFocusY: input.autoFocusY,
        iterationIndex: input.iterationIndex,
        planBudget: input.planBudget,
        sourceDurationSec: input.sourceDurationSec,
        realityMetrics: input.realityMetrics
      });
      const fallbackBounded = guardAndNormalizePlan(
        fallbackPlan,
        input.snapshot,
        input.goalSignal,
        input.iterationIndex,
        input.planBudget
      );
      if (fallbackBounded.operations.length > 0) {
        return fallbackBounded;
      }
      return fallbackPlan;
    } catch {
      // fallback to heuristic below
    }
  }

  const fallbackPlan = buildFallbackPlan({
    goalSignal: input.goalSignal,
    goalText: input.goalText,
    snapshot: input.snapshot,
    autoClipStartSec: input.autoClipStartSec,
    autoFocusY: input.autoFocusY,
    iterationIndex: input.iterationIndex,
    planBudget: input.planBudget,
    sourceDurationSec: input.sourceDurationSec,
    realityMetrics: input.realityMetrics
  });
  return guardAndNormalizePlan(
    fallbackPlan,
    input.snapshot,
    input.goalSignal,
    input.iterationIndex,
    input.planBudget
  );
}

function computeGoalFit(
  snapshot: Stage3StateSnapshot,
  context: Stage3EvaluationContext,
  goalSignal: Stage3GoalSignal,
  autoClipStartSec: number,
  autoFocusY: number,
  realityMetrics?: Stage3RealityMetrics | null
): number {
  let primaryGoalFit = 0.52;

  if (goalSignal.goalType === "focusOnly") {
    const focusDelta = Math.abs(snapshot.focusY - autoFocusY);
    const focusFit = clamp(1 - focusDelta / 0.4, 0, 1);
    const clipFit = clamp(1 - Math.abs(snapshot.clipStartSec - autoClipStartSec) / Math.max(1, CLIP_DURATION_SEC), 0, 1);
    const visualFit = realityMetrics ? computeVisualGoalFit(goalSignal, realityMetrics) : 0.55;
    if (goalSignal.constraints.forbidZoom) {
      primaryGoalFit = clamp(0.42 * focusFit + 0.24 * clipFit + 0.34 * visualFit, 0, 1);
    } else {
      const zoomTarget = clamp(goalSignal.constraints.targetZoom ?? 1.16, 1.08, 1.35);
      const zoomEvidenceFloor = 1.02;
      const zoomSpan = Math.max(0.08, zoomTarget - zoomEvidenceFloor);
      const zoomProgress = clamp((snapshot.renderPlan.videoZoom - zoomEvidenceFloor) / zoomSpan, 0, 1);

      primaryGoalFit = clamp(0.34 * zoomProgress + 0.18 * focusFit + 0.13 * clipFit + 0.35 * visualFit, 0, 1);
    }
  } else if (goalSignal.goalType === "zoom") {
    if (goalSignal.constraints.targetZoom != null) {
      primaryGoalFit = clamp(1 - Math.abs(snapshot.renderPlan.videoZoom - goalSignal.constraints.targetZoom) / 0.6, 0, 1);
    } else {
      primaryGoalFit = clamp((snapshot.renderPlan.videoZoom - 1) / 0.6, 0, 1);
    }
  } else if (goalSignal.goalType === "timing") {
    const requestedTiming = parseUserIntent(goalSignal.rawGoal, context.sourceDurationSec).timingMode;
    if (!requestedTiming) {
      primaryGoalFit = snapshot.renderPlan.timingMode !== "auto" ? 0.78 : 0.58;
    } else {
      primaryGoalFit = computeTimingFit(snapshot, requestedTiming, context.promptLower);
    }
  } else if (goalSignal.goalType === "fragments") {
    const requestedSegments = parseUserIntent(goalSignal.rawGoal, context.sourceDurationSec).segments;
    if (requestedSegments.length === 0) {
      primaryGoalFit = snapshot.renderPlan.segments.length > 0 ? 0.82 : 0.52;
    } else {
      primaryGoalFit = computeSegmentsFit(snapshot, requestedSegments, context.sourceDurationSec);
    }
  } else if (goalSignal.goalType === "crop") {
    const segmentScore = snapshot.renderPlan.segments.length > 0 ? 0.7 : 0.25;
    const clipScore = clamp(1 - Math.abs(snapshot.clipStartSec - autoClipStartSec) / Math.max(1, CLIP_DURATION_SEC), 0, 1);
    const zoomScore = clamp((snapshot.renderPlan.videoZoom - 1) / 0.6, 0, 1);
    const visualFit = realityMetrics ? computeVisualGoalFit(goalSignal, realityMetrics) : 0.55;
    primaryGoalFit = clamp(0.2 * segmentScore + 0.25 * clipScore + 0.22 * zoomScore + 0.33 * visualFit, 0, 1);
  } else {
    const baselineFromPrompt = parseUserIntent(goalSignal.rawGoal, context.sourceDurationSec);
    const baseActionDelta = baselineFromPrompt.actionOnly
      ? Math.min(1, Math.abs(snapshot.focusY - autoFocusY) + Math.abs(snapshot.clipStartSec - autoClipStartSec) / 3)
      : 0;

    if (goalSignal.goalType === "audio") {
      const desiredMode = baselineFromPrompt.audioMode;
      const audioScore = desiredMode ? (snapshot.renderPlan.audioMode === desiredMode ? 1 : 0.55) : 0.7;
      primaryGoalFit = clamp(0.6 * audioScore + 0.4 * (1 - baseActionDelta), 0, 1);
    } else if (goalSignal.goalType === "text") {
      const fontChange =
        (Math.abs(snapshot.renderPlan.topFontScale - DEFAULT_TEXT_SCALE) +
          Math.abs(snapshot.renderPlan.bottomFontScale - DEFAULT_TEXT_SCALE)) /
        2;
      if (baselineFromPrompt.fontTarget) {
        primaryGoalFit = clamp(
          0.5 * (fontChange > 0.05 ? 0.9 : 0.5) + 0.5 * (baselineFromPrompt.fontDirection ? 0.5 : 0.8),
          0,
          1
        );
      } else {
        primaryGoalFit = clamp(0.8 - fontChange, 0, 1);
      }
    } else if (realityMetrics && (goalSignal.guidance.tightenFraming || goalSignal.guidance.verticalReframe || goalSignal.guidance.polish)) {
      primaryGoalFit = computeVisualGoalFit(goalSignal, realityMetrics);
    }
  }

  const directiveCompositeFit = computeDirectiveCompositeFit(snapshot, context);
  if (directiveCompositeFit === null) {
    return primaryGoalFit;
  }
  if (goalSignal.goalType === "unknown") {
    return directiveCompositeFit;
  }
  if (
    goalSignal.goalType === "timing" ||
    goalSignal.goalType === "fragments" ||
    goalSignal.goalType === "audio"
  ) {
    return clamp(0.24 * primaryGoalFit + 0.76 * directiveCompositeFit, 0, 1);
  }
  return clamp(0.46 * primaryGoalFit + 0.54 * directiveCompositeFit, 0, 1);
}

function computeSafety(
  before: Stage3StateSnapshot,
  after: Stage3StateSnapshot,
  appliedOps: Stage3Operation[]
): number {
  let safety = 1;
  if (Math.abs(after.renderPlan.videoZoom - before.renderPlan.videoZoom) > 0.18) {
    safety -= 0.35;
  }
  if (Math.abs(after.focusY - before.focusY) > 0.25) {
    safety -= 0.3;
  }
  if (Math.abs(after.clipStartSec - before.clipStartSec) > 1.4) {
    safety -= 0.2;
  }

  for (const op of appliedOps) {
    if (op.op === "set_audio_mode" && op.audioMode === "source_plus_music") {
      safety -= 0.1;
    }
    if (op.op === "set_timing_mode" && (op.timingMode === "compress" || op.timingMode === "stretch")) {
      safety -= 0.05;
    }
  }

  if (after.renderPlan.topFontScale < 0.7 || after.renderPlan.topFontScale > 1.9) {
    safety -= 0.15;
  }
  if (after.renderPlan.bottomFontScale < 0.7 || after.renderPlan.bottomFontScale > 1.9) {
    safety -= 0.15;
  }

  return clamp(safety, 0, 1);
}

async function extractMotionMetrics(previewPath: string, tmpDir: string): Promise<{ stability: number; motionMean: number }> {
  const statsPath = path.join(tmpDir, `stage3-motion-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      previewPath,
      "-vf",
      `fps=${PREVIEW_FPS},signalstats,metadata=mode=print:file=${statsPath}`,
      "-f",
      "null",
      "-"
    ],
    { timeout: 90_000, maxBuffer: 1024 * 1024 * 8 }
  );

  const raw = await fs.readFile(statsPath, "utf-8").catch(() => "");
  if (!raw) {
    return { stability: 0.6, motionMean: 0.4 };
  }

  const values = raw
    .match(/YDIF=([0-9.]+)/g)
    ?.map((entry) => Number.parseFloat(entry.split("=").at(-1) ?? "0"))
    .filter((entry) => Number.isFinite(entry) && entry >= 0) ?? [];

  if (!values.length) {
    return { stability: 0.6, motionMean: 0.4 };
  }

  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance =
    values.reduce((acc, value) => {
      const d = value - mean;
      return acc + d * d;
    }, 0) / values.length;

  const stability = clamp(1 - Math.min(1, Math.sqrt(variance) / (mean + 0.001)), 0, 1);
  return {
    stability: clamp(stability, 0, 1),
    motionMean: clamp(mean / 60, 0, 1)
  };
}

async function runRealityPreview(args: {
  sourcePath: string;
  snapshot: Stage3StateSnapshot;
  sourceDurationSec: number | null;
}): Promise<Stage3RealityMetrics> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-autonomous-preview-"));
  try {
    const analysis = await analyzeStage3FramedPreview({
      sourcePath: args.sourcePath,
      tmpDir,
      sourceDurationSec: args.sourceDurationSec,
      snapshot: args.snapshot,
      profile: "preview"
    });
    const motion = await extractMotionMetrics(analysis.previewPath, tmpDir);
    return {
      ...analysis.metrics,
      stability: motion.stability,
      motionMean: motion.motionMean,
      previewPath: "",
      keyframePaths: []
    };
  } catch {
    return {
      activeCenterY: 0.5,
      activeSpan: 0.82,
      topEdgeEnergy: 0.18,
      bottomEdgeEnergy: 0.18,
      leftEdgeEnergy: 0.18,
      rightEdgeEnergy: 0.18,
      centerEnergy: 0.6,
      edgeEnergy: 0.24,
      visualFocus: 0.58,
      frameCount: 0,
      stability: 0.55,
      motionMean: 0.45,
      previewPath: "",
      keyframePaths: []
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function summarizeIterationTimings(times: {
  planStart: number;
  executeStart: number;
  judgeStart: number;
  totalStart: number;
  executeMs?: number;
  judgeMs?: number;
}): { planMs: number; executeMs: number; judgeMs: number; totalMs: number } {
  const now = Date.now();
  return {
    planMs: Math.max(0, times.executeStart - times.planStart),
    executeMs: Math.max(0, times.judgeStart - times.executeStart),
    judgeMs: Math.max(0, now - times.judgeStart),
    totalMs: Math.max(0, now - times.totalStart)
  };
}

function resolveOperationTimings(partial: {
  planMs?: number;
  executeMs?: number;
  judgeMs?: number;
  totalMs?: number;
}): {
  planMs?: number;
  executeMs?: number;
  judgeMs?: number;
  totalMs?: number;
} {
  return {
    planMs: partial.planMs,
    executeMs: partial.executeMs,
    judgeMs: partial.judgeMs,
    totalMs: partial.totalMs
  };
}

export async function judgeIteration(input: JudgeInputs): Promise<JudgeResult> {
  const beforeScored = evaluateScore(input.before, input.context);
  const afterScored = evaluateScore(input.after, input.context);
  const directiveFit = computeDirectiveCompositeFit(input.after, input.context);

  const quality = normalizeScore(afterScored.total / 100);
  const goalFit = normalizeScore(
    computeGoalFit(
      input.after,
      input.context,
      input.goalSignal,
      input.autoClipStartSec,
      input.autoFocusY,
      input.realityMetrics
    )
  );

  const baseSafety = computeSafety(input.before, input.after, input.appliedOps);
  let safety = baseSafety;

  if (input.realityMetrics) {
    safety = clamp(
      safety +
        0.35 * input.realityMetrics.stability -
        0.25 * input.realityMetrics.motionMean -
        (input.goalSignal.guidance.tightenFraming && input.realityMetrics.edgeEnergy > 0.42 ? 0.08 : 0),
      0,
      1
    );
  }

  const total = normalizeScore(0.6 * goalFit + 0.25 * quality + 0.15 * safety);
  const qualityDelta = (afterScored.total - beforeScored.total) / 100;
  const totalDelta = clamp(total - normalizeScore(input.beforeScoreNormalized), -1, 1);

  const notes = [
    `goalFit=${goalFit.toFixed(2)}`,
    directiveFit !== null ? `directiveFit=${directiveFit.toFixed(2)}` : null,
    `quality=${quality.toFixed(2)}`,
    `safety=${safety.toFixed(2)}`,
    input.realityMetrics ? `activeCenterY=${input.realityMetrics.activeCenterY.toFixed(2)}` : null,
    input.realityMetrics ? `activeSpan=${input.realityMetrics.activeSpan.toFixed(2)}` : null,
    input.realityMetrics ? `topEdge=${input.realityMetrics.topEdgeEnergy.toFixed(2)}` : null,
    input.realityMetrics ? `bottomEdge=${input.realityMetrics.bottomEdgeEnergy.toFixed(2)}` : null,
    input.realityMetrics ? `visualFocus=${input.realityMetrics.visualFocus.toFixed(2)}` : null,
    `qualityDelta=${qualityDelta.toFixed(3)}`,
    `totalDelta=${totalDelta.toFixed(3)}`
  ].filter((item): item is string => Boolean(item));

  let safetyFailReason: string | null = null;
  if (safety < DEFAULT_SAFETY_THRESHOLD) {
    safetyFailReason = `Safety below threshold: ${safety.toFixed(2)} < ${DEFAULT_SAFETY_THRESHOLD}`;
  }

  return {
    scores: {
      quality,
      goalFit,
      safety,
      stepGain: totalDelta,
      total
    },
    notes: notes.join("; "),
    safetyFailReason
  };
}

async function resolveSourceContext(sourceUrl: string): Promise<SourceContext> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip3-autosrc-"));
  const source = await ensureStage3SourceCached(sourceUrl);
  return {
    sourcePath: source.sourcePath,
    sourceDurationSec: source.sourceDurationSec,
    tmpDir
  };
}

function resolveDefaultSnapshot(
  input: {
    currentSnapshot: Partial<Stage3StateSnapshot> | undefined;
    sourceDurationSec: number | null;
    autoClipStartSec: number;
    autoFocusY: number;
  }
): Stage3StateSnapshot {
  const renderPlan = input.currentSnapshot?.renderPlan as Partial<Stage3StateSnapshot["renderPlan"]> | undefined;
  return createSnapshot({
    topText: typeof input.currentSnapshot?.topText === "string" ? input.currentSnapshot.topText : "",
    bottomText: typeof input.currentSnapshot?.bottomText === "string" ? input.currentSnapshot.bottomText : "",
    clipStartSec: clampClipStart(
      parseFiniteNumber(input.currentSnapshot?.clipStartSec) ?? input.autoClipStartSec,
      input.sourceDurationSec,
      CLIP_DURATION_SEC
    ),
    clipDurationSec: CLIP_DURATION_SEC,
    focusY: sanitizeFocusY(
      parseFiniteNumber(input.currentSnapshot?.focusY) ?? input.autoFocusY
    ),
    sourceDurationSec: input.sourceDurationSec,
    renderPlan: {
      targetDurationSec: 6,
      ...renderPlan,
      prompt: typeof renderPlan?.prompt === "string" ? renderPlan.prompt : ""
    } as Stage3StateSnapshot["renderPlan"]
  });
}

function toResponseIterations(iterations: Stage3IterationRecord[]): Stage3IterationResult[] {
  return iterations.map((iteration) => ({
    iterationIndex: iteration.iterationIndex,
    plan: iteration.plan,
    appliedOps: iteration.appliedOps,
    beforeVersionId: iteration.beforeVersionId,
    afterVersionId: iteration.afterVersionId,
    judgeNotes: iteration.judgeNotes,
    stoppedReason: iteration.stoppedReason,
    scores: iteration.scores,
    timings: iteration.timings
  }));
}

function toRunAutonomousStatus(status: Stage3SessionStatus): "applied" | "partiallyApplied" | "failed" {
  if (status === "completed") {
    return "applied";
  }
  if (status === "partiallyApplied") {
    return "partiallyApplied";
  }
  return "failed";
}

export async function runAutonomousOptimization(input: RunAutonomousInput): Promise<RunAutonomousResponse> {
  const trimmedGoal = input.goalText.trim();
  const mediaId = input.mediaId.trim();
  const sourceUrl = (input.sourceUrl ?? input.mediaId).trim();
  const goalHash = buildGoalHash(trimmedGoal);

  if (!trimmedGoal) {
    throw new Error("goalText is required.");
  }
  if (!mediaId) {
    throw new Error("mediaId is required.");
  }
  if (!sourceUrl) {
    throw new Error("sourceUrl is required.");
  }

  const options = {
    maxIterations: clamp(parseFiniteNumber(input.options?.maxIterations) ?? DEFAULT_MAX_ITERATIONS, 1, 12),
    targetScore: clamp(parseFiniteNumber(input.options?.targetScore) ?? DEFAULT_TARGET_SCORE, 0, 1),
    minGain: clamp(parseFiniteNumber(input.options?.minGain) ?? DEFAULT_MIN_GAIN, 0, 1),
    operationBudget: Math.max(1, Math.min(MAX_OPERATION_BUDGET, Math.floor(parseFiniteNumber(input.options?.operationBudget) ?? DEFAULT_OPERATION_BUDGET)))
  } satisfies {
    maxIterations: number;
    targetScore: number;
    minGain: number;
    operationBudget: number;
  };

  const lockId = lockKeyFromInput({
    sessionId: input.sessionId,
    projectId: input.projectId,
    mediaId,
    goalText: trimmedGoal,
    options
  });

  return withRunLock(lockId, async () => {
    const prefetchSourceDuration = input.sourceDurationSec ?? null;
    const idempotencyKey = input.idempotencyKey?.trim()
      ? buildScopedUserIdempotencyKey({
          rawKey: input.idempotencyKey,
          sessionId: input.sessionId,
          projectId: input.projectId,
          mediaId,
          goalHash
        })
      : buildRunIdempotencyKey({
          projectId: input.projectId,
          mediaId,
          sourceUrl,
          goalText: trimmedGoal,
          options: {
            maxIterations: options.maxIterations,
            targetScore: options.targetScore,
            minGain: options.minGain,
            operationBudget: options.operationBudget
          },
          autoClipStartSec: parseFiniteNumber(input.autoClipStartSec) ?? 0,
          autoFocusY: parseFiniteNumber(input.autoFocusY) ?? 0,
          sourceDurationSec: prefetchSourceDuration,
          currentSnapshot: input.currentSnapshot
        });

      const cached = await findIdempotency(idempotencyKey);
      if (
        cached &&
        cached.mediaId === mediaId &&
        cached.projectId === input.projectId &&
        cached.goalHash === goalHash
      ) {
        const cachedSession = await getSession(cached.sessionId);
        if (cachedSession) {
          const iterations = await listIterations(cachedSession.id);
          const versions = await listVersions(cachedSession.id);
          const beforeVersionId = cached.result.beforeVersionId ?? versions[0]?.id ?? cached.result.finalVersionId;
          const hasIterationRange =
            cached.result.firstIterationIndex !== undefined && cached.result.lastIterationIndex !== undefined;
          const cachedIterations = hasIterationRange
            ? iterations.filter(
                (iteration) =>
                  iteration.iterationIndex >= cached.result.firstIterationIndex! &&
                  iteration.iterationIndex <= cached.result.lastIterationIndex!
              )
            : iterations;
          const changedOperations = cachedIterations.flatMap((iteration) =>
            iteration.appliedOps.map((operation) => operation.op)
          );
          const lastIterationReason = [...cachedIterations]
            .reverse()
            .map((iteration) => iteration.stoppedReason)
            .find((reason): reason is Stage3IterationStopReason => reason !== null);
          const finalScore = cached.result.scoreHistory.at(-1) ?? 0;
          const bestVersionId = cached.result.bestVersionId;
          const stabilityNote =
            bestVersionId !== cached.result.finalVersionId
              ? "Ранее выполненный прогон вернул rollback к лучшему варианту, повторно использован кэш idempotency-key."
              : undefined;

          const cachedResult: RunAutonomousResponse = {
            status: cached.result.status === "completed" ? "applied" : cached.result.status === "partiallyApplied" ? "partiallyApplied" : "failed",
            sessionId: cachedSession.id,
            finalVersionId: cached.result.finalVersionId,
            bestVersionId: cached.result.bestVersionId,
            iterations: toResponseIterations(cachedIterations),
            scoreHistory: cached.result.scoreHistory,
            finalScore,
            stabilityNote,
            summary: {
              beforeVersionId,
              changedOperations,
              whyStopped:
                lastIterationReason ??
                (cached.result.status === "completed"
                  ? "targetScoreReached"
                  : cached.result.status === "failed"
                    ? "safety"
                    : "maxIterationsReached")
            }
          };
          return cachedResult;
        }
      }

      const sourceContext = await resolveSourceContext(sourceUrl);
      try {
        const goalSignal = ingestGoal(trimmedGoal);

        let plannerModel = input.plannerModel || process.env.CODEX_STAGE3_MODEL || "gpt-5.2";
        let plannerReasoning =
          input.plannerReasoningEffort || process.env.CODEX_STAGE3_REASONING_EFFORT || "extra-high";
        const plannerTimeout = Number.parseInt(process.env.CODEX_STAGE3_TIMEOUT_MS ?? "120000", 10);
        const configuredTimeout = Number.isFinite(input.plannerTimeoutMs ?? plannerTimeout)
          ? input.plannerTimeoutMs ?? plannerTimeout
          : plannerTimeout;
        let codexHome: string | undefined;

        if (input.codexSessionId) {
          try {
            const codexSessionId = normalizeCodexSessionId(input.codexSessionId);
            if (!codexSessionId) {
              throw new Error("Invalid codexSessionId");
            }
            codexHome = await ensureCodexHomeForSession(codexSessionId);
            await ensureCodexLoggedIn(codexHome);
          } catch {
            codexHome = undefined;
          }
        }

        const autoInfo = await analyzeBestClipAndFocus(
          sourceContext.sourcePath,
          sourceContext.tmpDir,
          sourceContext.sourceDurationSec ?? input.sourceDurationSec ?? null,
          CLIP_DURATION_SEC
        );

        const autoClipStartSec = clampClipStart(
          parseFiniteNumber(input.autoClipStartSec) ?? autoInfo.clipStartSec,
          sourceContext.sourceDurationSec ?? input.sourceDurationSec ?? null,
          CLIP_DURATION_SEC
        );
        const autoFocusY = sanitizeFocusY(parseFiniteNumber(input.autoFocusY) ?? autoInfo.focusY);

        const sourceDurationSec = sourceContext.sourceDurationSec ?? input.sourceDurationSec ?? null;

        let session: Stage3SessionRecord;
        if (input.sessionId) {
          const found = await getSession(input.sessionId);
          if (!found) {
            throw new Error("Session not found.");
          }
          if (found.mediaId !== mediaId) {
            throw new Error("mediaId does not match session mediaId.");
          }
          session = found;
        } else {
          const existing = (await getSessionsByProjectId(input.projectId)).find(
            (item) => item.mediaId === mediaId && item.goalText.trim() === trimmedGoal && item.status === "running"
          );
          if (existing) {
            session = existing;
          } else {
            session = await createSession({
              projectId: input.projectId,
              mediaId,
              goalText: trimmedGoal,
              goalType: goalSignal.goalType,
              targetScore: options.targetScore,
              minGain: options.minGain,
              maxIterations: options.maxIterations,
              operationBudget: options.operationBudget
            });
          }
        }

        await updateSession(session.id, {
          status: "running",
          goalType: goalSignal.goalType,
          goalText: trimmedGoal,
          targetScore: options.targetScore,
          minGain: options.minGain,
          maxIterations: options.maxIterations,
          operationBudget: options.operationBudget
        });

        let currentSnapshot = resolveDefaultSnapshot({
          currentSnapshot: input.currentSnapshot,
          sourceDurationSec,
          autoClipStartSec,
          autoFocusY
        });

        let sessionCurrentVersionCorrupted = false;
        if (session.currentVersionId) {
          const currentVersion = await getVersion(session.currentVersionId);
          if (currentVersion) {
            currentSnapshot = currentVersion.transformConfig;
          } else {
            sessionCurrentVersionCorrupted = true;
            session.currentVersionId = null;
            session.bestVersionId = null;
          }
        }

        if (sessionCurrentVersionCorrupted) {
          await updateSession(session.id, {
            currentVersionId: null,
            bestVersionId: null
          });
        }

        if (!session.currentVersionId) {
          const initial = await createVersion({
            sessionId: session.id,
            parentVersionId: null,
            iterationIndex: 0,
            source: "agent.auto",
            transformConfig: currentSnapshot,
            diffSummary: ["Создана стартовая версия среза для автономного цикла."],
            rationale: "initial"
          });
          session.currentVersionId = initial.id;
          session.bestVersionId = initial.id;
          await setBestVersion(session.id, initial.id);
        } else {
          await setBestVersion(session.id, session.bestVersionId ?? session.currentVersionId);
        }

        const baselineVersion = await getVersion(session.currentVersionId!);
        const beforeVersionId = baselineVersion?.id ?? session.currentVersionId!;
        const existingVersions = await listVersions(session.id);
        const iterationOffset = existingVersions.reduce((max, item) => Math.max(max, item.iterationIndex), 0);
        const runtime: Stage3RuntimeContext = {
          goalText: trimmedGoal,
          sourceUrl,
          sourcePath: sourceContext.sourcePath,
          sourceDurationSec,
          mediaId,
          session,
          options,
          autoClipStartSec,
          autoFocusY,
          sessionState: {
            initialVersionId: beforeVersionId,
            currentSnapshot,
            currentVersionId: beforeVersionId,
            bestVersionId: session.bestVersionId ?? beforeVersionId,
            iterationOffset,
            bestScore: 0,
            stagnation: 0,
            lastIterationScore: 0,
            currentRealityMetrics: null
          }
        };

        const intent = parseUserIntent(trimmedGoal, sourceDurationSec);
        const context: Stage3EvaluationContext = {
          promptLower: trimmedGoal.toLowerCase(),
          sourceDurationSec,
          autoClipStartSec,
          autoFocusY,
          userIntent: intent
        };

        let status: Stage3SessionStatus = "running";
        let lastReason: Stage3IterationStopReason | null = null;
        const history: Stage3IterationResult[] = [];
        const scoreHistory: number[] = [];
        const maxIterationIndex = runtime.sessionState.iterationOffset + runtime.options.maxIterations;

        const baselineReality = await runRealityPreview({
          sourcePath: sourceContext.sourcePath,
          snapshot: runtime.sessionState.currentSnapshot,
          sourceDurationSec
        });
        runtime.sessionState.currentRealityMetrics = baselineReality;

        const baselineQuality = normalizeScore(
          evaluateScore(runtime.sessionState.currentSnapshot, context).total / 100
        );
        const baselineGoalFit = normalizeScore(
          computeGoalFit(
            runtime.sessionState.currentSnapshot,
            context,
            goalSignal,
            autoClipStartSec,
            autoFocusY,
            baselineReality
          )
        );
        const baselineSafety = computeSafety(
          runtime.sessionState.currentSnapshot,
          runtime.sessionState.currentSnapshot,
          []
        );
        const baselineScore = normalizeScore(
          0.6 * baselineGoalFit + 0.25 * baselineQuality + 0.15 * baselineSafety
        );
        runtime.sessionState.bestScore = baselineScore;
        runtime.sessionState.lastIterationScore = baselineScore;
        scoreHistory.push(baselineScore);

        await createMessage({
          sessionId: session.id,
          role: "user",
          text: `autonomous_goal_request`,
          payload: {
            goal: trimmedGoal,
            options: runtime.options,
            projectId: input.projectId,
            mediaId
          }
        });

        if (baselineScore >= runtime.options.targetScore && !goalSignal.guidance.forceIteration) {
          status = "completed";
          lastReason = "targetScoreReached";
          const finalVersionIdNow = runtime.sessionState.currentVersionId;
          const bestVersionId = runtime.sessionState.bestVersionId || beforeVersionId;

          const summary: RunAutonomousResponse["summary"] = {
            beforeVersionId,
            changedOperations: [],
            whyStopped: lastReason
          };

          await updateSession(session.id, {
            status,
            lastPlanSummary: "baseline already satisfies target score",
            stagnationCount: 0
          });

          await createMessage({
            sessionId: session.id,
            role: "assistant_summary",
            text: `autonomous_iteration_done_${status}`,
            payload: {
              sessionId: session.id,
              status,
              finalVersionId: finalVersionIdNow,
              bestVersionId,
              whyStopped: summary.whyStopped,
              iterations: 0,
              startedAt: nowIso()
            }
          });

          await registerIdempotency(
            idempotencyKey,
            {
              finalVersionId: finalVersionIdNow,
              bestVersionId,
              beforeVersionId,
              firstIterationIndex: history.at(0)?.iterationIndex,
              lastIterationIndex: history.at(-1)?.iterationIndex,
              status,
              scoreHistory
            },
            {
              sessionId: session.id,
              projectId: input.projectId,
              mediaId,
              goalHash
            }
          );

          return {
            status: toRunAutonomousStatus(status),
            sessionId: session.id,
            finalVersionId: finalVersionIdNow,
            bestVersionId,
            iterations: [],
            scoreHistory,
            finalScore: scoreHistory.at(-1) ?? baselineScore,
            summary
          };
        }

        for (
          let iterationIndex = runtime.sessionState.iterationOffset + 1;
          iterationIndex <= maxIterationIndex;
          iterationIndex += 1
        ) {
          const totalStart = Date.now();
          const planStart = Date.now();
          const plan = await selectNextPlan({
            goalSignal,
            goalText: trimmedGoal,
            snapshot: runtime.sessionState.currentSnapshot,
            autoClipStartSec,
            autoFocusY,
            iterationIndex,
            planBudget: runtime.options.operationBudget,
            lastTotalScore: runtime.sessionState.lastIterationScore,
            sourceDurationSec,
            realityMetrics: runtime.sessionState.currentRealityMetrics,
            codexHome,
            planner: codexHome
              ? {
                model: plannerModel,
                reasoningEffort: plannerReasoning,
                timeoutMs: configuredTimeout
              }
              : undefined
          });
          const guardedPlan = guardAndNormalizePlan(
            plan,
            runtime.sessionState.currentSnapshot,
            goalSignal,
            iterationIndex,
            runtime.options.operationBudget
          );
          const executeStart = Date.now();
          const applied = applyOperations(runtime.sessionState.currentSnapshot, guardedPlan.operations, sourceDurationSec);
          const executeMs = Date.now();

          if (applied.changes.length === 0 || !hasMeaningfulMediaChange(runtime.sessionState.currentSnapshot, applied.next)) {
            const beforeVersionId = runtime.sessionState.currentVersionId;
            const now = Date.now();
            const noProgressNote =
              guardedPlan.operations.length === 0
                ? "После planner + guard не осталось допустимых операций. План не смог сдвинуть текущую версию."
                : "Нет значимых медиа-изменений после применения предложенных операций.";
            const timings = summarizeIterationTimings({
              planStart,
              executeStart,
              judgeStart: now,
              totalStart,
              executeMs: executeMs - executeStart,
              judgeMs: 0
            });
            runtime.sessionState.stagnation += 1;
            const noProgressStopReason: Stage3IterationStopReason | null =
              runtime.sessionState.stagnation >= 2
                ? "minGainReached"
                : iterationIndex >= maxIterationIndex
                  ? "maxIterationsReached"
                  : null;

            const iterationRecord: Stage3IterationResult = {
              iterationIndex,
              plan: guardedPlan,
              appliedOps: guardedPlan.operations,
              beforeVersionId,
              afterVersionId: beforeVersionId,
              judgeNotes: noProgressNote,
              stoppedReason: noProgressStopReason,
              scores: {
                quality: 0,
                goalFit: 0,
                safety: 0,
                stepGain: 0,
                total: runtime.sessionState.lastIterationScore
              },
              timings: {
                planMs: timings.planMs,
                executeMs: timings.executeMs,
                judgeMs: timings.judgeMs,
                totalMs: now - totalStart
              }
            };

            await createIteration({
              sessionId: session.id,
              iterationIndex,
              beforeVersionId,
              afterVersionId: beforeVersionId,
              plan: iterationRecord.plan,
              appliedOps: iterationRecord.appliedOps,
              scores: iterationRecord.scores,
              judgeNotes: iterationRecord.judgeNotes,
              stoppedReason: iterationRecord.stoppedReason,
              timings: iterationRecord.timings
            });

            history.push(iterationRecord);
            scoreHistory.push(runtime.sessionState.lastIterationScore);

            if (noProgressStopReason) {
              lastReason = noProgressStopReason;
              status = "partiallyApplied";
              break;
            }

            await updateSession(session.id, {
              lastPlanSummary: "no progress on current plan, trying alternative iteration",
              stagnationCount: runtime.sessionState.stagnation
            });
            continue;
          }

          const beforeVersionId = runtime.sessionState.currentVersionId;

          const newVersion = await createVersion({
            sessionId: session.id,
            parentVersionId: beforeVersionId,
            iterationIndex,
            source: "agent.auto",
            transformConfig: applied.next,
            diffSummary: applied.changes,
            rationale: guardedPlan.rationale
          });

          const judgeStart = Date.now();
          const metrics = await runRealityPreview({
            sourcePath: sourceContext.sourcePath,
            snapshot: applied.next,
            sourceDurationSec
          });

          const scoreBeforeIteration = runtime.sessionState.lastIterationScore;
          const judge = await judgeIteration({
            before: runtime.sessionState.currentSnapshot,
            after: applied.next,
            plan: guardedPlan,
            appliedOps: guardedPlan.operations,
            iterationIndex,
            goalSignal,
            sourcePath: sourceContext.sourcePath,
            sourceDurationSec,
            autoClipStartSec,
            autoFocusY,
            beforeScoreNormalized: scoreBeforeIteration,
            context,
            realityMetrics: metrics
          });

          const judgeMs = Date.now();
          const timings = summarizeIterationTimings({
            planStart,
            executeStart,
            judgeStart,
            totalStart,
            executeMs: executeMs - executeStart,
            judgeMs: judgeMs - judgeStart
          });

          const iterationScoreDelta = judge.scores.total - scoreBeforeIteration;
          runtime.sessionState.lastIterationScore = judge.scores.total;
          const gainBelowThreshold = iterationScoreDelta < runtime.options.minGain;
          runtime.sessionState.stagnation = gainBelowThreshold ? runtime.sessionState.stagnation + 1 : 0;

          let stoppedReason: Stage3IterationStopReason | null = null;
          if (judge.scores.total >= runtime.options.targetScore) {
            stoppedReason = "targetScoreReached";
          } else if (judge.scores.safety < DEFAULT_SAFETY_THRESHOLD) {
            stoppedReason = "safety";
          } else if (runtime.sessionState.stagnation >= 2) {
            stoppedReason = "minGainReached";
          } else if (iterationIndex >= maxIterationIndex) {
            stoppedReason = "maxIterationsReached";
          }

          await createIteration({
            sessionId: session.id,
            iterationIndex,
            beforeVersionId,
            afterVersionId: newVersion.id,
            plan: guardedPlan,
            appliedOps: guardedPlan.operations,
            scores: {
              quality: judge.scores.quality,
              goalFit: judge.scores.goalFit,
              safety: judge.scores.safety,
              stepGain: judge.scores.stepGain,
              total: judge.scores.total
            },
            judgeNotes: judge.notes,
            stoppedReason,
            timings: resolveOperationTimings({
              planMs: timings.planMs,
              executeMs: timings.executeMs,
              judgeMs: timings.judgeMs,
              totalMs: timings.totalMs
            })
          });

          runtime.sessionState.currentSnapshot = applied.next;
          runtime.sessionState.currentVersionId = newVersion.id;
          runtime.sessionState.currentRealityMetrics = metrics;

          scoreHistory.push(judge.scores.total);
          history.push({
            iterationIndex,
            plan: guardedPlan,
            appliedOps: guardedPlan.operations,
            beforeVersionId,
            afterVersionId: newVersion.id,
            judgeNotes: judge.notes,
            stoppedReason,
            scores: {
              quality: judge.scores.quality,
              goalFit: judge.scores.goalFit,
              safety: judge.scores.safety,
              stepGain: judge.scores.stepGain,
              total: judge.scores.total
            },
            timings: {
              planMs: timings.planMs,
              executeMs: timings.executeMs,
              judgeMs: timings.judgeMs,
              totalMs: timings.totalMs
            }
          });

          if (judge.scores.total > runtime.sessionState.bestScore) {
            runtime.sessionState.bestScore = judge.scores.total;
            runtime.sessionState.bestVersionId = newVersion.id;
            await setBestVersion(session.id, newVersion.id);
          }

          if (stoppedReason === "targetScoreReached") {
            status = "completed";
            lastReason = stoppedReason;
            break;
          }

          if (stoppedReason === "safety") {
            status = "failed";
            lastReason = stoppedReason;
            break;
          }

          if (stoppedReason === "minGainReached") {
            status = "partiallyApplied";
            lastReason = stoppedReason;
            break;
          }

          if (stoppedReason === "maxIterationsReached") {
            status = "partiallyApplied";
            lastReason = stoppedReason;
            break;
          }

          await updateSession(session.id, {
            lastPlanSummary: guardedPlan.rationale,
            stagnationCount: runtime.sessionState.stagnation
          });
        }

        let finalVersionId = runtime.sessionState.currentVersionId;
        const bestVersionId = runtime.sessionState.bestVersionId || beforeVersionId;

        if (status === "running") {
          status = "partiallyApplied";
          lastReason = "maxIterationsReached";
        }

        if ((status === "partiallyApplied" || status === "failed") && bestVersionId !== finalVersionId) {
          const bestVersion = await getVersion(bestVersionId);
          if (bestVersion) {
            const rollback = await createVersion({
              sessionId: session.id,
              parentVersionId: bestVersion.id,
              iterationIndex: maxIterationIndex + 1,
              source: "rollback",
              transformConfig: bestVersion.transformConfig,
              diffSummary: ["Rollback на лучший вариант после деградации цели."],
              rationale: "rollback_guard"
            });
            finalVersionId = rollback.id;
            await updateSession(session.id, {
              currentVersionId: rollback.id,
              status
            });
            await createMessage({
              sessionId: session.id,
              role: "assistant_auto",
              text: "rollback_guard",
              payload: {
                reason: "rollback_guard",
                targetVersionId: rollback.id,
                sourceVersionId: bestVersion.id
              }
            });
          }
        }

        const finalVersionIdNow = finalVersionId || runtime.sessionState.currentVersionId;
        const finalScore = scoreHistory.at(-1) ?? runtime.sessionState.lastIterationScore;
        const stabilityNote =
          bestVersionId !== finalVersionIdNow ? "Показатель после инициализации может снижаться на последующих итерациях; включен rollback к лучшему варианту." : undefined;

        const summary: RunAutonomousResponse["summary"] = {
          beforeVersionId,
          changedOperations: history.flatMap((iteration) => iteration.appliedOps.map((op) => op.op)),
          whyStopped: lastReason ?? (status === "completed" ? "targetScoreReached" : "maxIterationsReached")
        };

        await updateSession(session.id, {
          status,
          lastPlanSummary: runtime.sessionState.currentSnapshot
            ? "last autonomous step complete"
            : "autonomous run complete",
          stagnationCount: runtime.sessionState.stagnation
        });

        await createMessage({
          sessionId: session.id,
          role: "assistant_summary",
          text: `autonomous_iteration_done_${status}`,
          payload: {
            sessionId: session.id,
            status,
            finalVersionId: finalVersionIdNow,
            bestVersionId,
            whyStopped: summary.whyStopped,
            iterations: history.length,
            startedAt: nowIso()
          }
        });

        await registerIdempotency(
          idempotencyKey,
          {
            finalVersionId: finalVersionIdNow,
            bestVersionId,
            beforeVersionId,
            firstIterationIndex: history.at(0)?.iterationIndex,
            lastIterationIndex: history.at(-1)?.iterationIndex,
            status,
            scoreHistory
          },
          {
            sessionId: session.id,
            projectId: input.projectId,
            mediaId,
            goalHash
          }
        );

        return {
          status: toRunAutonomousStatus(status),
          sessionId: session.id,
          finalVersionId: finalVersionIdNow,
          bestVersionId,
          iterations: history,
          scoreHistory,
          finalScore,
          stabilityNote,
          summary
        };
      } finally {
        await fs.rm(sourceContext.tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    });

    
}

export async function resumeAutonomousSession(
  sessionId: string,
  mediaId: string,
  options?: AutonomyOptions,
  sourceUrl?: string,
  idempotencyKey?: string,
  plannerModel?: string,
  plannerReasoningEffort?: string,
  plannerTimeoutMs?: number
): Promise<RunAutonomousResponse> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error("Session not found.");
  }
  if (session.mediaId !== mediaId) {
    throw new Error("mediaId does not match session mediaId.");
  }

  const currentVersion = session.currentVersionId ? await getVersion(session.currentVersionId) : null;

  return runAutonomousOptimization({
    sessionId,
    projectId: session.projectId,
    mediaId,
    sourceUrl: sourceUrl ?? mediaId,
    goalText: session.goalText,
    currentSnapshot: currentVersion?.transformConfig,
    options,
    sourceDurationSec: currentVersion?.transformConfig.sourceDurationSec,
    idempotencyKey,
    autoClipStartSec: currentVersion?.transformConfig.clipStartSec,
    autoFocusY: currentVersion?.transformConfig.focusY,
    plannerModel,
    plannerReasoningEffort,
    plannerTimeoutMs
  });
}
