import { randomUUID } from "node:crypto";
import {
  Stage3AgentPass,
  Stage3AudioMode,
  Stage3Operation,
  Stage3RenderPlan,
  Stage3RenderPolicy,
  Stage3Segment,
  STAGE3_SEGMENT_SPEED_OPTIONS,
  Stage3StateSnapshot,
  Stage3TextPolicy,
  Stage3TimingMode,
  Stage3Version
} from "../app/components/types";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  getTemplateById,
  getTemplateComputed
} from "./stage3-template";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "./stage3-constants";
import {
  normalizeStage3CameraKeyframes,
  normalizeStage3CameraMotion,
  resolveStage3EffectiveCameraTracks
} from "./stage3-camera";
import {
  normalizeStage3SegmentFocusOverride,
  normalizeStage3SegmentMirrorOverride,
  normalizeStage3SegmentZoomOverride
} from "./stage3-segment-transforms";

export type {
  Stage3RenderPlan,
  Stage3StateSnapshot,
  Stage3Version,
  Stage3TimingMode,
  Stage3AudioMode,
  Stage3RenderPolicy,
  Stage3Segment
} from "../app/components/types";

const TARGET_DURATION_SEC = 6 as const;
const MAX_PASSES = 12;
const SCORE_STOP_THRESHOLD = 91;
const SCORE_EPSILON = 0.45;
const MAX_ALLOWED_DEGRADE = 3;
const DEFAULT_ZOOM = 1.2;
const DEFAULT_TEXT_SCALE = 1.25;
const FONT_SCALE_MIN = 0.7;
const FONT_SCALE_MAX = 1.9;
const SEGMENT_SPEED_SET = new Set<number>(STAGE3_SEGMENT_SPEED_OPTIONS);

function hasAnyCue(promptLower: string, cues: string[]): boolean {
  return cues.some((cue) => promptLower.includes(cue));
}

export function hasFullSourceCue(promptLower: string): boolean {
  return hasAnyCue(promptLower, [
    "все видео",
    "всё видео",
    "все 15с",
    "все 15 сек",
    "всё 15с",
    "исходного видео",
    "исходное видео целиком",
    "полностью исходное видео",
    "целиком",
    "полностью",
    "весь исходник",
    "весь ролик",
    "all source video",
    "entire source",
    "whole video",
    "entire video",
    "full video"
  ]);
}

export function hasSubjectIsolationCue(promptLower: string): boolean {
  const audioOnlyCue =
    promptLower.includes("только звук") ||
    promptLower.includes("без музыки") ||
    promptLower.includes("source only") ||
    promptLower.includes("only audio");
  if (audioOnlyCue) {
    return false;
  }

  return hasAnyCue(promptLower, [
    "видно только",
    "покажи только",
    "оставь только",
    "нужно только",
    "только квадрат",
    "только видео",
    "только исходное видео",
    "оставался только",
    "only show",
    "show only",
    "keep only",
    "only the square",
    "only the video",
    "only the source video",
    "just the video",
    "focus only",
    "только модель",
    "только лицо",
    "только объект",
    "только персонаж",
    "только целев",
    "целевое видео",
    "основное видео",
    "main subject",
    "target video",
    "main video",
    "главный объект",
    "основной объект",
    "subject only"
  ]);
}

export function hasActionRegionCue(promptLower: string): boolean {
  return hasAnyCue(promptLower, [
    "только действия",
    "где происходят действия",
    "где происходит действие",
    "где происходят события",
    "где происходит событие",
    "в котором происходят события",
    "в котором происходит действие",
    "в кадре только",
    "где главное действие",
    "только то, где",
    "зона действия",
    "только сцена с действием",
    "only action",
    "main action",
    "where the action",
    "where it happens",
    "where things happen",
    "event area",
    "action area"
  ]);
}

export function inferIsolationZoomValue(promptLower: string): number {
  if (
    promptLower.includes("только") ||
    promptLower.includes("only") ||
    promptLower.includes("show only") ||
    promptLower.includes("keep only")
  ) {
    return 1.26;
  }
  if (
    promptLower.includes("сильный") ||
    promptLower.includes("aggressive") ||
    promptLower.includes("крупно") ||
    promptLower.includes("closer")
  ) {
    return 1.32;
  }
  return 1.18;
}

export type BuildStage3VersionInput = {
  versionNo: number;
  prompt: string;
  topText: string;
  bottomText: string;
  clipDurationSec: number;
  sourceDurationSec: number | null;
  manualClipStartSec: number;
  manualFocusY: number;
  autoClipStartSec: number;
  autoFocusY: number;
  currentSnapshot?: Partial<Stage3StateSnapshot> | null;
};

type EvaluationContext = {
  promptLower: string;
  sourceDurationSec: number | null;
  autoClipStartSec: number;
  autoFocusY: number;
  userIntent: Stage3UserIntent;
};

export type Stage3EvaluationContext = {
  promptLower: string;
  sourceDurationSec: number | null;
  autoClipStartSec: number;
  autoFocusY: number;
  userIntent: Stage3UserIntent;
};

export type Stage3EvaluatedScore = {
  total: number;
  durationError: number;
  textReadability: number;
  actionCoverage: number;
  instructionCompliance: number;
  renderStability: number;
};

export type Stage3UserIntent = {
  zoomRequested: boolean;
  zoomValue: number | null;
  actionOnly: boolean;
  segments: Stage3Segment[];
  timingMode: Stage3TimingMode | null;
  audioMode: Stage3AudioMode | null;
  smoothSlowMo: boolean;
  noZoom: boolean;
  fontTarget: "top" | "bottom" | "both" | null;
  fontDirection: "increase" | "decrease" | null;
  fontPercent: number | null;
};

type PlannerResult = {
  summary: string;
  operations: Stage3Operation[];
  intent?: Partial<{
    zoomRequested: boolean;
    zoomValue: number | null;
    actionOnly: boolean;
    segmentsRequested: number;
    timingMode: Stage3TimingMode | null;
    audioMode: Stage3AudioMode | null;
  }>;
};

type OptimizeStage3VersionInput = BuildStage3VersionInput & {
  planner?: ((input: {
    passIndex: number;
    maxPasses: number;
    snapshot: Stage3StateSnapshot;
    scoreBefore: Stage3EvaluatedScore;
    prompt: string;
    sourceDurationSec: number | null;
    lastPassSummary?: string | null;
    userIntent: Stage3UserIntent;
  }) => Promise<PlannerResult>) | null;
  model?: string;
  reasoningEffort?: string;
  maxPasses?: number;
};

export type OptimizeStage3VersionOutput = {
  changed: boolean;
  version?: Stage3Version;
  noOpReason?: string;
  suggestions?: string[];
  intent: {
    zoomRequested: boolean;
    zoomValue: number | null;
    actionOnly: boolean;
    segmentsRequested: number;
    timingMode: Stage3TimingMode | null;
    audioMode: Stage3AudioMode | null;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSegmentSpeed(value: unknown): Stage3Segment["speed"] {
  if (typeof value === "number" && Number.isFinite(value) && SEGMENT_SPEED_SET.has(value)) {
    return value as Stage3Segment["speed"];
  }
  return 1;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatTimingModeLabel(value: Stage3TimingMode): string {
  switch (value) {
    case "auto":
      return "авто";
    case "compress":
      return "сжатие";
    case "stretch":
      return "растягивание";
    default:
      return value;
  }
}

function formatAudioModeLabel(value: Stage3AudioMode): string {
  switch (value) {
    case "source_only":
      return "только исходный звук";
    case "source_plus_music":
      return "исходный звук + музыка";
    default:
      return value;
  }
}

function formatTextPolicyLabel(value: Stage3TextPolicy): string {
  switch (value) {
    case "strict_fit":
      return "строгое вмещение";
    case "preserve_words":
      return "сохранение слов";
    case "aggressive_compact":
      return "агрессивное уплотнение";
    default:
      return value;
  }
}

function parseTimecode(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\.(\d))?$/);
  if (!match) {
    return null;
  }
  const min = Number.parseInt(match[1], 10);
  const sec = Number.parseInt(match[2], 10);
  const tenth = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (!Number.isFinite(min) || !Number.isFinite(sec) || sec >= 60) {
    return null;
  }
  return min * 60 + sec + tenth / 10;
}

function parseLooseSecondToken(value: string, sourceDurationSec: number | null): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "конец" || normalized === "end") {
    return sourceDurationSec;
  }
  const numeric = normalized.replace(/(?:секунд(?:ы|у)?|сек|seconds?|secs?|sec|с)\.?$/i, "").trim();
  if (!numeric) {
    return null;
  }
  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSegment(
  segment: Stage3Segment,
  sourceDurationSec: number | null
): Stage3Segment | null {
  const start = Number.isFinite(segment.startSec) ? Math.max(0, segment.startSec) : null;
  if (start === null) {
    return null;
  }
  const endCandidate =
    segment.endSec === null
      ? sourceDurationSec
      : Number.isFinite(segment.endSec)
        ? segment.endSec
        : null;
  const end = endCandidate === null ? null : Math.max(start + 0.05, endCandidate);
  return {
    startSec: start,
    endSec: end,
    speed: normalizeSegmentSpeed(segment.speed),
    label:
      typeof segment.label === "string" && segment.label.trim()
        ? segment.label.trim()
        : `${start.toFixed(2)}-${end === null ? "end" : end.toFixed(2)}`,
    focusY: normalizeStage3SegmentFocusOverride(segment.focusY),
    videoZoom: normalizeStage3SegmentZoomOverride(segment.videoZoom),
    mirrorEnabled: normalizeStage3SegmentMirrorOverride(segment.mirrorEnabled)
  };
}

function parseSegmentsFromPrompt(prompt: string, sourceDurationSec: number | null): Stage3Segment[] {
  const normalized = prompt.toLowerCase();
  const segments: Stage3Segment[] = [];
  const pattern = /(\d{1,2}:\d{2}(?:\.\d)?)\s*-\s*(\d{1,2}:\d{2}(?:\.\d)?|конец|end)/g;

  let match = pattern.exec(normalized);
  while (match) {
    const startSec = parseTimecode(match[1]);
    const endToken = match[2];
    const endSec = endToken === "конец" || endToken === "end" ? sourceDurationSec : parseTimecode(endToken);
    if (startSec !== null) {
      segments.push({
        startSec,
        endSec: endSec ?? null,
        label: `${match[1]}-${match[2]}`,
        speed: 1
      });
    }
    match = pattern.exec(normalized);
  }

  const secondsPattern =
    /(?:^|[\s,;[(])(?:\d+\s*[.)]\s*)?(\d{1,3}(?:\.\d+)?)\s*(?:секунд(?:ы|у)?|сек|seconds?|secs?|sec|с)?\s*-\s*((?:\d{1,3}(?:\.\d+)?\s*(?:секунд(?:ы|у)?|сек|seconds?|secs?|sec|с)?)|конец|end)(?=$|[\s,;)\].])/g;
  let secMatch = secondsPattern.exec(normalized);
  while (secMatch) {
    const startSec = parseLooseSecondToken(secMatch[1], sourceDurationSec);
    const endSec = parseLooseSecondToken(secMatch[2], sourceDurationSec);
    if (startSec !== null) {
      segments.push({
        startSec,
        endSec,
        label: `${secMatch[1]}-${secMatch[2]}`,
        speed: 1
      });
    }
    secMatch = secondsPattern.exec(normalized);
  }

  return segments
    .map((segment) => normalizeSegment(segment, sourceDurationSec))
    .filter((segment): segment is Stage3Segment => Boolean(segment));
}

function hasExactTargetDurationCue(promptLower: string): boolean {
  return (
    /(?:ровно|exactly|strictly)\s*6(?:[.,]\d+)?\s*(?:секунд(?:ы|у)?|сек|seconds?|secs?|sec|с)\b/i.test(promptLower) ||
    /(?:make|keep|render)\s+(?:it\s+)?exactly\s*6(?:[.,]\d+)?\s*(?:seconds?|secs?|sec)\b/i.test(promptLower)
  );
}

export function approxSegmentsDuration(
  segments: Stage3Segment[],
  sourceDurationSec: number | null,
  fallbackDuration: number
): number {
  if (!segments.length) {
    return fallbackDuration;
  }
  const raw = segments.reduce((acc, segment) => {
    const start = Math.max(0, segment.startSec);
    const endRaw = segment.endSec ?? sourceDurationSec ?? start + fallbackDuration;
    const end = Math.max(start + 0.03, endRaw);
    return acc + (end - start) / normalizeSegmentSpeed(segment.speed);
  }, 0);
  return Math.max(0.05, raw);
}

function detectTimingMode(
  promptLower: string,
  sourceDurationSec: number | null,
  segments: Stage3Segment[]
): Stage3TimingMode | null {
  if (
    promptLower.includes("растянуть") ||
    promptLower.includes("растяни") ||
    promptLower.includes("удлини") ||
    promptLower.includes("замедли") ||
    promptLower.includes("слоумо") ||
    promptLower.includes("slowmo") ||
    promptLower.includes("slow-mo") ||
    promptLower.includes("растяни до 6") ||
    promptLower.includes("дотяни до 6") ||
    promptLower.includes("extend to 6") ||
    promptLower.includes("stretch to 6")
  ) {
    return "stretch";
  }
  if (
    promptLower.includes("сжать") ||
    promptLower.includes("ужать") ||
    promptLower.includes("сократи") ||
    promptLower.includes("ускор") ||
    promptLower.includes("умести в 6") ||
    promptLower.includes("до 6с") ||
    promptLower.includes("до 6 сек") ||
    promptLower.includes("shorten to 6") ||
    promptLower.includes("compress to 6") ||
    promptLower.includes("fit into 6") ||
    promptLower.includes("speed up")
  ) {
    return "compress";
  }
  if (hasExactTargetDurationCue(promptLower)) {
    const requestedSourceDuration =
      segments.length > 0
        ? approxSegmentsDuration(segments, sourceDurationSec, TARGET_DURATION_SEC)
        : sourceDurationSec;
    if (requestedSourceDuration !== null) {
      if (requestedSourceDuration > TARGET_DURATION_SEC + 0.12) {
        return "compress";
      }
      if (requestedSourceDuration < TARGET_DURATION_SEC - 0.12) {
        return "stretch";
      }
      return "auto";
    }
    return "auto";
  }
  return null;
}

function detectAudioMode(promptLower: string): Stage3AudioMode | null {
  if (
    promptLower.includes("звук + музыка") ||
    promptLower.includes("звук+музыка") ||
    promptLower.includes("звук и музыка")
  ) {
    return "source_plus_music";
  }
  if (
    promptLower.includes("только звук") ||
    promptLower.includes("без музыки") ||
    promptLower.includes("отключить музыку")
  ) {
    return "source_only";
  }
  return null;
}

function smoothSlowMoRequested(promptLower: string): boolean {
  return (
    promptLower.includes("плавный слоумо") ||
    promptLower.includes("плавное слоумо") ||
    promptLower.includes("плавный slowmo") ||
    promptLower.includes("slomo") ||
    promptLower.includes("slow motion") ||
    promptLower.includes("smooth slowmo") ||
    promptLower.includes("smooth slow-mo")
  );
}

function parseZoomValue(promptLower: string): { requested: boolean; value: number | null; noZoom: boolean } {
  const subjectIsolation = hasSubjectIsolationCue(promptLower);
  const noZoom =
    promptLower.includes("без зума") ||
    promptLower.includes("убери зум") ||
    promptLower.includes("zoom 1x") ||
    promptLower.includes("no zoom");
  if (noZoom) {
    return { requested: true, value: 1, noZoom: true };
  }

  const requested =
    promptLower.includes("зум") ||
    promptLower.includes("zoom") ||
    promptLower.includes("приблиз") ||
    promptLower.includes("увелич") ||
    subjectIsolation;
  if (!requested) {
    return { requested: false, value: null, noZoom: false };
  }

  const mulMatch = promptLower.match(/x\s*(1(?:\.\d+)?|0?\.\d+)/i);
  if (mulMatch?.[1]) {
    const parsed = Number.parseFloat(mulMatch[1]);
    if (Number.isFinite(parsed)) {
      return {
        requested: true,
        value: clamp(parsed, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM),
        noZoom: false
      };
    }
  }

  const percentMatch = promptLower.match(/(\d{2,3})\s*%/);
  if (percentMatch?.[1]) {
    const parsed = Number.parseInt(percentMatch[1], 10);
    if (Number.isFinite(parsed)) {
      return {
        requested: true,
        value: clamp(parsed / 100, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM),
        noZoom: false
      };
    }
  }

  if (promptLower.includes("сильный зум") || promptLower.includes("strong zoom")) {
    return { requested: true, value: 1.35, noZoom: false };
  }
  if (promptLower.includes("легкий зум") || promptLower.includes("slight zoom")) {
    return { requested: true, value: 1.1, noZoom: false };
  }
  if (subjectIsolation) {
    return { requested: true, value: inferIsolationZoomValue(promptLower), noZoom: false };
  }
  return { requested: true, value: DEFAULT_ZOOM, noZoom: false };
}

function parseFontIntent(
  promptLower: string
): {
  target: "top" | "bottom" | "both" | null;
  direction: "increase" | "decrease" | null;
  percent: number | null;
} {
  const hasFontKeyword =
    promptLower.includes("шрифт") ||
    promptLower.includes("font") ||
    promptLower.includes("размер текста") ||
    promptLower.includes("text size");
  if (!hasFontKeyword) {
    return { target: null, direction: null, percent: null };
  }

  const target: "top" | "bottom" | "both" =
    promptLower.includes("top") ||
    promptLower.includes("верх") ||
    promptLower.includes("верхн")
      ? "top"
      : promptLower.includes("bottom") || promptLower.includes("низ") || promptLower.includes("нижн")
        ? "bottom"
        : "both";

  const direction: "increase" | "decrease" | null =
    promptLower.includes("увелич") ||
    promptLower.includes("крупн") ||
    promptLower.includes("больше") ||
    promptLower.includes("increase") ||
    promptLower.includes("bigger") ||
    promptLower.includes("larger")
      ? "increase"
      : promptLower.includes("уменьш") ||
          promptLower.includes("меньше") ||
          promptLower.includes("сниз") ||
          promptLower.includes("decrease") ||
          promptLower.includes("smaller")
        ? "decrease"
        : null;

  const percentMatch = promptLower.match(/(?:шрифт|font|text size)[^0-9]{0,24}(\d{2,3})\s*%/i) ?? promptLower.match(/(\d{2,3})\s*%/);
  const percentRaw = percentMatch?.[1] ? Number.parseInt(percentMatch[1], 10) : null;
  const percent =
    percentRaw !== null && Number.isFinite(percentRaw)
      ? clamp(percentRaw / 100, FONT_SCALE_MIN, FONT_SCALE_MAX)
      : null;

  return { target, direction, percent };
}

export function parseUserIntent(prompt: string, sourceDurationSec: number | null): Stage3UserIntent {
  const promptLower = prompt.trim().toLowerCase();
  const zoom = parseZoomValue(promptLower);
  const fontIntent = parseFontIntent(promptLower);
  const segments = parseSegmentsFromPrompt(promptLower, sourceDurationSec);
  const actionOnly =
    hasActionRegionCue(promptLower) || hasSubjectIsolationCue(promptLower);
  return {
    zoomRequested: zoom.requested,
    zoomValue: zoom.value,
    actionOnly,
    segments,
    timingMode: detectTimingMode(promptLower, sourceDurationSec, segments),
    audioMode: detectAudioMode(promptLower),
    smoothSlowMo: smoothSlowMoRequested(promptLower),
    noZoom: zoom.noZoom,
    fontTarget: fontIntent.target,
    fontDirection: fontIntent.direction,
    fontPercent: fontIntent.percent
  };
}

function inferPolicyFromSourceDuration(sourceDurationSec: number | null): Stage3RenderPolicy {
  if (!sourceDurationSec || sourceDurationSec <= 12) {
    return "full_source_normalize";
  }
  return "adaptive_window";
}

function createDefaultRenderPlan(
  sourceDurationSec: number | null,
  templateId?: string
): Stage3RenderPlan {
  const resolvedTemplateId = templateId?.trim() || SCIENCE_CARD_TEMPLATE_ID;
  const templateConfig = getTemplateById(resolvedTemplateId);
  return {
    targetDurationSec: TARGET_DURATION_SEC,
    timingMode: sourceDurationSec !== null && sourceDurationSec < TARGET_DURATION_SEC ? "stretch" : "auto",
    normalizeToTargetEnabled: sourceDurationSec !== null && sourceDurationSec < TARGET_DURATION_SEC,
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
    policy: inferPolicyFromSourceDuration(sourceDurationSec),
    backgroundAssetId: null,
    backgroundAssetMimeType: null,
    musicAssetId: null,
    musicAssetMimeType: null,
    avatarAssetId: null,
    avatarAssetMimeType: null,
    authorName: templateConfig.author.name,
    authorHandle: templateConfig.author.handle,
    templateId: resolvedTemplateId,
    prompt: ""
  };
}

function normalizePlan(input: Partial<Stage3RenderPlan> | undefined, sourceDurationSec: number | null): Stage3RenderPlan {
  const incomingTemplateId =
    typeof input?.templateId === "string" && input.templateId.trim() ? input.templateId.trim() : undefined;
  const defaultPlan = createDefaultRenderPlan(sourceDurationSec, incomingTemplateId);
  const timingMode = input?.timingMode;
  const audioMode = input?.audioMode;
  const policy = input?.policy;
  const textPolicy = input?.textPolicy;
  const videoZoom =
    typeof input?.videoZoom === "number" && Number.isFinite(input.videoZoom)
      ? clamp(input.videoZoom, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM)
      : defaultPlan.videoZoom;
  const cameraTracks = resolveStage3EffectiveCameraTracks({
    cameraPositionKeyframes: input?.cameraPositionKeyframes,
    cameraScaleKeyframes: input?.cameraScaleKeyframes,
    cameraKeyframes: input?.cameraKeyframes ?? defaultPlan.cameraKeyframes,
    cameraMotion: input?.cameraMotion,
    clipDurationSec: TARGET_DURATION_SEC,
    baseFocusY: 0.5,
    baseZoom: videoZoom
  });
  const segments = Array.isArray(input?.segments)
    ? input.segments
        .map((segment) => normalizeSegment(segment, sourceDurationSec))
        .filter((segment): segment is Stage3Segment => Boolean(segment))
    : [];

  return {
    targetDurationSec: TARGET_DURATION_SEC,
    timingMode:
      timingMode === "auto" || timingMode === "compress" || timingMode === "stretch"
        ? timingMode
        : defaultPlan.timingMode,
    normalizeToTargetEnabled:
      typeof input?.normalizeToTargetEnabled === "boolean"
        ? input.normalizeToTargetEnabled
        : input?.timingMode === "compress" ||
            input?.timingMode === "stretch" ||
            input?.policy === "full_source_normalize" ||
            defaultPlan.normalizeToTargetEnabled,
    audioMode:
      audioMode === "source_only" || audioMode === "source_plus_music"
        ? audioMode
        : defaultPlan.audioMode,
    sourceAudioEnabled: Boolean(input?.sourceAudioEnabled ?? defaultPlan.sourceAudioEnabled),
    smoothSlowMo: Boolean(input?.smoothSlowMo),
    mirrorEnabled: Boolean(input?.mirrorEnabled ?? defaultPlan.mirrorEnabled),
    cameraMotion: normalizeStage3CameraMotion(input?.cameraMotion),
    cameraKeyframes: normalizeStage3CameraKeyframes(input?.cameraKeyframes ?? defaultPlan.cameraKeyframes, {
      clipDurationSec: TARGET_DURATION_SEC,
      fallbackFocusY: 0.5,
      fallbackZoom: videoZoom
    }),
    cameraPositionKeyframes: cameraTracks.positionKeyframes,
    cameraScaleKeyframes: cameraTracks.scaleKeyframes,
    videoZoom,
    topFontScale:
      typeof input?.topFontScale === "number" && Number.isFinite(input.topFontScale)
        ? clamp(input.topFontScale, FONT_SCALE_MIN, FONT_SCALE_MAX)
        : defaultPlan.topFontScale,
    bottomFontScale:
      typeof input?.bottomFontScale === "number" && Number.isFinite(input.bottomFontScale)
        ? clamp(input.bottomFontScale, FONT_SCALE_MIN, FONT_SCALE_MAX)
        : defaultPlan.bottomFontScale,
    musicGain:
      typeof input?.musicGain === "number" && Number.isFinite(input.musicGain)
        ? clamp(input.musicGain, 0, 1)
        : defaultPlan.musicGain,
    textPolicy:
      textPolicy === "strict_fit" || textPolicy === "preserve_words" || textPolicy === "aggressive_compact"
        ? textPolicy
        : defaultPlan.textPolicy,
    segments,
    policy:
      policy === "adaptive_window" || policy === "full_source_normalize" || policy === "fixed_segments"
        ? policy
        : defaultPlan.policy,
    backgroundAssetId:
      typeof input?.backgroundAssetId === "string" && input.backgroundAssetId.trim()
        ? input.backgroundAssetId.trim()
        : null,
    backgroundAssetMimeType:
      typeof input?.backgroundAssetMimeType === "string" && input.backgroundAssetMimeType.trim()
        ? input.backgroundAssetMimeType.trim()
        : null,
    musicAssetId:
      typeof input?.musicAssetId === "string" && input.musicAssetId.trim()
        ? input.musicAssetId.trim()
        : null,
    musicAssetMimeType:
      typeof input?.musicAssetMimeType === "string" && input.musicAssetMimeType.trim()
        ? input.musicAssetMimeType.trim()
        : null,
    avatarAssetId:
      typeof input?.avatarAssetId === "string" && input.avatarAssetId.trim()
        ? input.avatarAssetId.trim()
        : null,
    avatarAssetMimeType:
      typeof input?.avatarAssetMimeType === "string" && input.avatarAssetMimeType.trim()
        ? input.avatarAssetMimeType.trim()
        : null,
    authorName:
      typeof input?.authorName === "string" && input.authorName.trim()
        ? input.authorName.trim()
        : defaultPlan.authorName,
    authorHandle:
      typeof input?.authorHandle === "string" && input.authorHandle.trim()
        ? input.authorHandle.trim()
        : defaultPlan.authorHandle,
    templateId:
      typeof input?.templateId === "string" && input.templateId.trim()
        ? input.templateId.trim()
        : defaultPlan.templateId,
    prompt: typeof input?.prompt === "string" ? input.prompt : defaultPlan.prompt
  };
}

function computeTextFit(
  templateId: string,
  topText: string,
  bottomText: string,
  renderPlan: Stage3RenderPlan
): Stage3StateSnapshot["textFit"] & {
  topText: string;
  bottomText: string;
} {
  const computed = getTemplateComputed(templateId, topText, bottomText, {
    topFontScale: renderPlan.topFontScale,
    bottomFontScale: renderPlan.bottomFontScale
  });
  return {
    topText: computed.top,
    bottomText: computed.bottom,
    topFontPx: computed.topFont,
    bottomFontPx: computed.bottomFont,
    topLineHeight: computed.topLineHeight,
    bottomLineHeight: computed.bottomLineHeight,
    topLines: computed.topLines,
    bottomLines: computed.bottomLines,
    topCompacted: computed.topCompacted,
    bottomCompacted: computed.bottomCompacted
  };
}

export function createSnapshot(input: {
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  sourceDurationSec: number | null;
  renderPlan: Stage3RenderPlan;
}): Stage3StateSnapshot {
  const normalizedPlan = normalizePlan(input.renderPlan, input.sourceDurationSec);
  const fit = computeTextFit(
    normalizedPlan.templateId || "science-card-v1",
    input.topText,
    input.bottomText,
    normalizedPlan
  );
  return {
    topText: fit.topText,
    bottomText: fit.bottomText,
    clipStartSec: Math.max(0, input.clipStartSec),
    clipDurationSec: TARGET_DURATION_SEC,
    focusY: clamp(input.focusY, 0.12, 0.88),
    sourceDurationSec: input.sourceDurationSec,
    renderPlan: normalizedPlan,
    textFit: {
      topFontPx: fit.topFontPx,
      bottomFontPx: fit.bottomFontPx,
      topCompacted: fit.topCompacted,
      bottomCompacted: fit.bottomCompacted
    }
  };
}

export function estimatePreTimingDuration(snapshot: Stage3StateSnapshot): number {
  const sourceDurationSec = snapshot.sourceDurationSec;
  const policy = snapshot.renderPlan.policy;

  if (snapshot.renderPlan.segments.length > 0) {
    return approxSegmentsDuration(snapshot.renderPlan.segments, sourceDurationSec, snapshot.clipDurationSec);
  }

  if (policy === "full_source_normalize") {
    return sourceDurationSec ?? snapshot.clipDurationSec;
  }

  if (policy === "adaptive_window") {
    if (!sourceDurationSec) {
      return snapshot.clipDurationSec;
    }
    if (sourceDurationSec <= 12) {
      return sourceDurationSec;
    }
    if (sourceDurationSec <= 20) {
      return clamp(sourceDurationSec * 0.55, 8, 12);
    }
    return snapshot.clipDurationSec;
  }

  return snapshot.clipDurationSec;
}

function estimateOutputDuration(snapshot: Stage3StateSnapshot): number {
  const pre = estimatePreTimingDuration(snapshot);
  const target = snapshot.renderPlan.targetDurationSec;
  if (snapshot.renderPlan.timingMode === "compress") {
    return Math.min(pre, target);
  }
  if (snapshot.renderPlan.timingMode === "stretch") {
    return Math.max(pre, target);
  }
  return target;
}

function evaluateInstructionCompliance(
  snapshot: Stage3StateSnapshot,
  promptLower: string,
  intent: Stage3UserIntent
): number {
  if (!promptLower.trim()) {
    return 0;
  }
  let penalty = 0;
  if (intent.segments.length > 0 && snapshot.renderPlan.segments.length === 0) {
    penalty += 22;
  }
  if (intent.segments.length > 0 && snapshot.renderPlan.segments.length > 0) {
    if (snapshot.renderPlan.segments.length !== intent.segments.length) {
      penalty += 14;
    } else {
      const segmentDelta = intent.segments.reduce((acc, segment, index) => {
        const actual = snapshot.renderPlan.segments[index];
        if (!actual) {
          return acc + 2;
        }
        const actualEnd = actual.endSec ?? snapshot.sourceDurationSec ?? actual.startSec + TARGET_DURATION_SEC;
        const intentEnd = segment.endSec ?? snapshot.sourceDurationSec ?? segment.startSec + TARGET_DURATION_SEC;
        return acc + Math.abs(actual.startSec - segment.startSec) + Math.abs(actualEnd - intentEnd);
      }, 0);
      penalty += clamp(segmentDelta * 3.2, 0, 18);
    }
  }
  if (intent.timingMode && snapshot.renderPlan.timingMode !== intent.timingMode) {
    penalty += 14;
  }
  if (intent.timingMode && hasFullSourceCue(promptLower) && snapshot.sourceDurationSec && snapshot.sourceDurationSec > snapshot.clipDurationSec) {
    const fullCoverage =
      snapshot.renderPlan.segments.length === 1 &&
      Math.abs(snapshot.renderPlan.segments[0].startSec - 0) <= 0.05 &&
      Math.abs((snapshot.renderPlan.segments[0].endSec ?? snapshot.sourceDurationSec) - snapshot.sourceDurationSec) <= 0.2;
    if (!fullCoverage) {
      penalty += 18;
    }
  }
  if (intent.audioMode && snapshot.renderPlan.audioMode !== intent.audioMode) {
    penalty += 16;
  }
  if (intent.smoothSlowMo && !snapshot.renderPlan.smoothSlowMo) {
    penalty += 14;
  }
  if (intent.zoomRequested) {
    const expectedZoom = intent.zoomValue ?? DEFAULT_ZOOM;
    if (Math.abs(snapshot.renderPlan.videoZoom - expectedZoom) > 0.04) {
      penalty += 12;
    }
  }
  if (intent.fontTarget && intent.fontDirection) {
    const topChanged = Math.abs(snapshot.renderPlan.topFontScale - DEFAULT_TEXT_SCALE) >= 0.03;
    const bottomChanged = Math.abs(snapshot.renderPlan.bottomFontScale - DEFAULT_TEXT_SCALE) >= 0.03;
    if (intent.fontTarget === "top" && !topChanged) {
      penalty += 9;
    }
    if (intent.fontTarget === "bottom" && !bottomChanged) {
      penalty += 9;
    }
    if (intent.fontTarget === "both" && (!topChanged || !bottomChanged)) {
      penalty += 12;
    }
  }
  if (intent.actionOnly) {
    const dist = Math.abs(snapshot.clipStartSec) + Math.abs(snapshot.focusY - 0.5) * 2.4;
    penalty += clamp(dist * 1.2, 0, 10);
  }
  return penalty;
}

function evaluateRenderStability(snapshot: Stage3StateSnapshot): number {
  let penalty = 0;
  const sourceDuration = snapshot.sourceDurationSec;
  for (const segment of snapshot.renderPlan.segments) {
    if (!Number.isFinite(segment.startSec)) {
      penalty += 20;
      continue;
    }
    const start = segment.startSec;
    const endRaw = segment.endSec ?? sourceDuration ?? start + snapshot.clipDurationSec;
    if (!Number.isFinite(endRaw)) {
      penalty += 16;
      continue;
    }
    if (endRaw <= start + 0.02) {
      penalty += 18;
    }
    if (sourceDuration !== null && (start > sourceDuration || endRaw > sourceDuration + 0.3)) {
      penalty += 12;
    }
  }
  return penalty;
}

export function evaluateScore(snapshot: Stage3StateSnapshot, context: Stage3EvaluationContext): Stage3EvaluatedScore {
  const durationOut = estimateOutputDuration(snapshot);
  const durationError = (Math.abs(durationOut - TARGET_DURATION_SEC) / TARGET_DURATION_SEC) * 28;

  let textReadability = 0;
  const computed = getTemplateComputed(
    snapshot.renderPlan.templateId,
    snapshot.topText,
    snapshot.bottomText,
    {
      topFontScale: snapshot.renderPlan.topFontScale,
      bottomFontScale: snapshot.renderPlan.bottomFontScale
    }
  );
  const typography = getTemplateById(snapshot.renderPlan.templateId).typography;
  if (snapshot.textFit.topCompacted) {
    textReadability += 7;
  }
  if (snapshot.textFit.bottomCompacted) {
    textReadability += 7;
  }
  if (snapshot.textFit.topFontPx < typography.top.min) {
    textReadability +=
      ((typography.top.min - snapshot.textFit.topFontPx) / typography.top.min) * 10;
  }
  if (snapshot.textFit.bottomFontPx < typography.bottom.min) {
    textReadability +=
      ((typography.bottom.min - snapshot.textFit.bottomFontPx) / typography.bottom.min) * 10;
  }
  const topFillRatio = clamp(
    (computed.topLines * computed.topFont * computed.topLineHeight) /
      Math.max(1, computed.topBlockHeight),
    0,
    1.6
  );
  if (topFillRatio < 0.66) {
    textReadability += (0.66 - topFillRatio) * 16;
  }
  if (topFillRatio > 1.03) {
    textReadability += Math.min(10, (topFillRatio - 1.03) * 20);
  }

  const actionCoverage =
    Math.min(14, Math.abs(snapshot.clipStartSec - context.autoClipStartSec) * 1.8) +
    Math.abs(snapshot.focusY - context.autoFocusY) * 18 +
    (context.userIntent.actionOnly && snapshot.renderPlan.videoZoom < 1.08 ? 6 : 0);

  const instructionCompliance = evaluateInstructionCompliance(
    snapshot,
    context.promptLower,
    context.userIntent
  );
  const renderStability = evaluateRenderStability(snapshot);
  const total = Math.max(
    0,
    100 - (durationError + textReadability + actionCoverage + instructionCompliance + renderStability)
  );
  return {
    total,
    durationError,
    textReadability,
    actionCoverage,
    instructionCompliance,
    renderStability
  };
}

export function hasMeaningfulMediaChange(before: Stage3StateSnapshot, after: Stage3StateSnapshot): boolean {
  if (before.topText !== after.topText || before.bottomText !== after.bottomText) {
    return true;
  }
  if (Math.abs(before.clipStartSec - after.clipStartSec) >= 0.01) {
    return true;
  }
  if (Math.abs(before.focusY - after.focusY) >= 0.005) {
    return true;
  }
  if (Math.abs(before.renderPlan.videoZoom - after.renderPlan.videoZoom) >= 0.01) {
    return true;
  }
  if (Math.abs(before.renderPlan.topFontScale - after.renderPlan.topFontScale) >= 0.01) {
    return true;
  }
  if (Math.abs(before.renderPlan.bottomFontScale - after.renderPlan.bottomFontScale) >= 0.01) {
    return true;
  }
  if (Math.abs(before.renderPlan.musicGain - after.renderPlan.musicGain) >= 0.01) {
    return true;
  }
  if (before.renderPlan.timingMode !== after.renderPlan.timingMode) {
    return true;
  }
  if (before.renderPlan.audioMode !== after.renderPlan.audioMode) {
    return true;
  }
  if (before.renderPlan.sourceAudioEnabled !== after.renderPlan.sourceAudioEnabled) {
    return true;
  }
  if (before.renderPlan.smoothSlowMo !== after.renderPlan.smoothSlowMo) {
    return true;
  }
  if (before.renderPlan.mirrorEnabled !== after.renderPlan.mirrorEnabled) {
    return true;
  }
  if (before.renderPlan.cameraMotion !== after.renderPlan.cameraMotion) {
    return true;
  }
  if (JSON.stringify(before.renderPlan.cameraKeyframes) !== JSON.stringify(after.renderPlan.cameraKeyframes)) {
    return true;
  }
  if (before.renderPlan.policy !== after.renderPlan.policy) {
    return true;
  }
  if (before.renderPlan.textPolicy !== after.renderPlan.textPolicy) {
    return true;
  }
  if (JSON.stringify(before.renderPlan.segments) !== JSON.stringify(after.renderPlan.segments)) {
    return true;
  }
  return false;
}

function snapshotToPass(args: {
  pass: number;
  label: string;
  summary: string;
  changes: string[];
  snapshot: Stage3StateSnapshot;
  proposedOps: Stage3Operation[];
  accepted: boolean;
  scoreBefore: number;
  scoreAfter: number;
  delta: number;
  rejectionReason?: string;
}): Stage3AgentPass {
  const { snapshot } = args;
  return {
    pass: args.pass,
    label: args.label,
    summary: args.summary,
    changes: args.changes,
    proposedOps: args.proposedOps,
    accepted: args.accepted,
    scoreBefore: Number(args.scoreBefore.toFixed(2)),
    scoreAfter: Number(args.scoreAfter.toFixed(2)),
    delta: Number(args.delta.toFixed(2)),
    rejectionReason: args.rejectionReason,
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
}

function createDiff(baseline: Stage3StateSnapshot, final: Stage3StateSnapshot): Stage3Version["diff"] {
  const fontChanged =
    Math.abs(baseline.renderPlan.topFontScale - final.renderPlan.topFontScale) >= 0.01 ||
    Math.abs(baseline.renderPlan.bottomFontScale - final.renderPlan.bottomFontScale) >= 0.01;
  const textChanged =
    baseline.topText !== final.topText || baseline.bottomText !== final.bottomText || fontChanged;
  const framingChanged =
    Math.abs(baseline.clipStartSec - final.clipStartSec) >= 0.01 ||
    Math.abs(baseline.focusY - final.focusY) >= 0.005 ||
    Math.abs(baseline.renderPlan.videoZoom - final.renderPlan.videoZoom) >= 0.01 ||
    baseline.renderPlan.mirrorEnabled !== final.renderPlan.mirrorEnabled ||
    baseline.renderPlan.cameraMotion !== final.renderPlan.cameraMotion ||
    JSON.stringify(baseline.renderPlan.cameraKeyframes) !== JSON.stringify(final.renderPlan.cameraKeyframes);
  const timingChanged =
    baseline.renderPlan.timingMode !== final.renderPlan.timingMode ||
    baseline.renderPlan.policy !== final.renderPlan.policy ||
    baseline.renderPlan.smoothSlowMo !== final.renderPlan.smoothSlowMo;
  const segmentsChanged =
    JSON.stringify(baseline.renderPlan.segments) !== JSON.stringify(final.renderPlan.segments);
  const audioChanged =
    baseline.renderPlan.audioMode !== final.renderPlan.audioMode ||
    baseline.renderPlan.sourceAudioEnabled !== final.renderPlan.sourceAudioEnabled;
  const summary: string[] = [];
  if (textChanged) {
    summary.push("Обновлены TOP/BOTTOM для стабильной читаемости.");
  }
  if (fontChanged) {
    summary.push("Скорректирован размер шрифта TOP/BOTTOM.");
  }
  if (framingChanged) {
    summary.push("Скорректированы фокус/старт и масштаб видео-слота.");
  }
  if (segmentsChanged) {
    summary.push("Пересобран монтаж по фрагментам.");
  }
  if (timingChanged) {
    summary.push("Обновлен режим длительности/темпа до ровно 6 секунд.");
  }
  if (audioChanged) {
    summary.push("Изменен аудиомикс исходника и музыки.");
  }
  if (!summary.length) {
    summary.push("Существенных изменений не потребовалось, подтверждена стабильность рендера.");
  }
  return {
    textChanged,
    framingChanged,
    timingChanged,
    segmentsChanged,
    audioChanged,
    summary
  };
}

function normalizeSegmentsForPlan(
  segments: Stage3Segment[],
  sourceDurationSec: number | null
): Stage3Segment[] {
  return segments
    .map((segment) => normalizeSegment(segment, sourceDurationSec))
    .filter((segment): segment is Stage3Segment => Boolean(segment))
    .slice(0, 12);
}

export function applyOperations(
  snapshot: Stage3StateSnapshot,
  operations: Stage3Operation[],
  sourceDurationSec: number | null
): { next: Stage3StateSnapshot; changes: string[] } {
  let nextTop = snapshot.topText;
  let nextBottom = snapshot.bottomText;
  let nextClipStart = snapshot.clipStartSec;
  let nextFocus = snapshot.focusY;
  const nextPlan: Stage3RenderPlan = normalizePlan(
    { ...snapshot.renderPlan, prompt: snapshot.renderPlan.prompt },
    sourceDurationSec
  );
  const changes: string[] = [];

  for (const operation of operations) {
    switch (operation.op) {
      case "set_segments": {
        nextPlan.segments = normalizeSegmentsForPlan(operation.segments, sourceDurationSec);
        nextPlan.policy = nextPlan.segments.length > 0 ? "fixed_segments" : nextPlan.policy;
        changes.push(`Фрагменты установлены: ${nextPlan.segments.length}.`);
        break;
      }
      case "append_segment": {
        const normalized = normalizeSegment(operation.segment, sourceDurationSec);
        if (normalized) {
          nextPlan.segments = normalizeSegmentsForPlan([...nextPlan.segments, normalized], sourceDurationSec);
          if (nextPlan.segments.length > 0) {
            nextPlan.policy = "fixed_segments";
          }
          changes.push("Добавлен фрагмент монтажа.");
        }
        break;
      }
      case "clear_segments":
        if (nextPlan.segments.length > 0) {
          nextPlan.segments = [];
          if (nextPlan.policy === "fixed_segments") {
            nextPlan.policy = inferPolicyFromSourceDuration(sourceDurationSec);
          }
          changes.push("Фрагменты очищены.");
        }
        break;
      case "set_timing_mode":
        if (nextPlan.timingMode !== operation.timingMode) {
          changes.push(
            `Режим тайминга: ${formatTimingModeLabel(nextPlan.timingMode)} -> ${formatTimingModeLabel(operation.timingMode)}.`
          );
          nextPlan.timingMode = operation.timingMode;
        }
        break;
      case "set_audio_mode":
        if (nextPlan.audioMode !== operation.audioMode) {
          changes.push(
            `Режим аудио: ${formatAudioModeLabel(nextPlan.audioMode)} -> ${formatAudioModeLabel(operation.audioMode)}.`
          );
          nextPlan.audioMode = operation.audioMode;
        }
        break;
      case "set_slowmo":
        if (nextPlan.smoothSlowMo !== operation.smoothSlowMo) {
          nextPlan.smoothSlowMo = operation.smoothSlowMo;
          changes.push(`Слоумо: ${operation.smoothSlowMo ? "включен" : "выключен"}.`);
        }
        break;
      case "set_clip_start":
        nextClipStart = Math.max(0, operation.clipStartSec);
        changes.push(`Смещение старта клипа до ${nextClipStart.toFixed(2)}с.`);
        break;
      case "set_focus_y":
        nextFocus = clamp(operation.focusY, 0.12, 0.88);
        changes.push(`Фокус Y: ${Math.round(nextFocus * 100)}%.`);
        break;
      case "set_video_zoom":
        nextPlan.videoZoom = clamp(operation.videoZoom, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM);
        changes.push(`Масштаб видео: x${nextPlan.videoZoom.toFixed(2)}.`);
        break;
      case "set_top_font_scale":
        nextPlan.topFontScale = clamp(operation.topFontScale, FONT_SCALE_MIN, FONT_SCALE_MAX);
        changes.push(`Размер TOP шрифта: ${(nextPlan.topFontScale * 100).toFixed(0)}%.`);
        break;
      case "set_bottom_font_scale":
        nextPlan.bottomFontScale = clamp(operation.bottomFontScale, FONT_SCALE_MIN, FONT_SCALE_MAX);
        changes.push(`Размер BOTTOM шрифта: ${(nextPlan.bottomFontScale * 100).toFixed(0)}%.`);
        break;
      case "set_music_gain":
        nextPlan.musicGain = clamp(operation.musicGain, 0, 1);
        changes.push(`Громкость музыки: ${(nextPlan.musicGain * 100).toFixed(0)}%.`);
        break;
      case "set_text_policy":
        nextPlan.textPolicy = operation.textPolicy;
        changes.push(`Политика текста: ${formatTextPolicyLabel(operation.textPolicy)}.`);
        break;
      case "rewrite_top_text":
        nextTop = normalizeText(operation.topText);
        changes.push("TOP текст переписан.");
        break;
      case "rewrite_bottom_text":
        nextBottom = normalizeText(operation.bottomText);
        changes.push("BOTTOM текст переписан.");
        break;
      default:
        break;
    }
  }

  const next = createSnapshot({
    topText: nextTop,
    bottomText: nextBottom,
    clipStartSec: nextClipStart,
    clipDurationSec: snapshot.clipDurationSec,
    focusY: nextFocus,
    sourceDurationSec,
    renderPlan: nextPlan
  });
  return { next, changes };
}

export function inferHeuristicOperations(input: {
  snapshot: Stage3StateSnapshot;
  prompt: string;
  intent: Stage3UserIntent;
  autoClipStartSec: number;
  autoFocusY: number;
  sourceDurationSec: number | null;
}): Stage3Operation[] {
  const operations: Stage3Operation[] = [];
  const promptNorm = input.prompt.trim();
  const promptLower = promptNorm.toLowerCase();
  const fullSourceRequested = hasFullSourceCue(promptLower);
  const explicitSegments = normalizeSegmentsForPlan(input.intent.segments, input.sourceDurationSec);
  const computed = getTemplateComputed(
    input.snapshot.renderPlan.templateId,
    input.snapshot.topText,
    input.snapshot.bottomText,
    {
      topFontScale: input.snapshot.renderPlan.topFontScale,
      bottomFontScale: input.snapshot.renderPlan.bottomFontScale
    }
  );
  const typography = getTemplateById(input.snapshot.renderPlan.templateId).typography;
  const topFillRatio = clamp(
    (computed.topLines * computed.topFont * computed.topLineHeight) /
      Math.max(1, computed.topBlockHeight),
    0,
    1.6
  );

  if (!promptNorm) {
    if (Math.abs(input.snapshot.clipStartSec - input.autoClipStartSec) >= 0.08) {
      operations.push({ op: "set_clip_start", clipStartSec: input.autoClipStartSec });
    }
    if (Math.abs(input.snapshot.focusY - input.autoFocusY) >= 0.01) {
      operations.push({ op: "set_focus_y", focusY: input.autoFocusY });
    }
    if (input.snapshot.textFit.topCompacted && input.snapshot.renderPlan.topFontScale > 0.82) {
      operations.push({
        op: "set_top_font_scale",
        topFontScale: clamp(input.snapshot.renderPlan.topFontScale * 0.93, FONT_SCALE_MIN, FONT_SCALE_MAX)
      });
    } else if (!input.snapshot.textFit.topCompacted && topFillRatio < 0.7) {
      operations.push({
        op: "set_top_font_scale",
        topFontScale: clamp(input.snapshot.renderPlan.topFontScale * 1.08, FONT_SCALE_MIN, FONT_SCALE_MAX)
      });
    }
    return operations;
  }

  if (input.intent.zoomRequested) {
    operations.push({
      op: "set_video_zoom",
      videoZoom: input.intent.zoomValue ?? DEFAULT_ZOOM
    });
  }
  if (explicitSegments.length > 0) {
    operations.push({
      op: "set_segments",
      segments: explicitSegments
    });
  } else if (input.intent.timingMode && fullSourceRequested && input.sourceDurationSec && input.sourceDurationSec > 0.05) {
    operations.push({
      op: "set_segments",
      segments: normalizeSegmentsForPlan(
        [
          {
            startSec: 0,
            endSec: input.sourceDurationSec,
            label: `0-${input.sourceDurationSec.toFixed(2)}`,
            speed: 1
          }
        ],
        input.sourceDurationSec
      )
    });
  } else if (input.intent.timingMode) {
    const implicitDuration =
      input.intent.timingMode === "stretch"
        ? Math.min(input.sourceDurationSec ?? TARGET_DURATION_SEC, Math.max(1.8, TARGET_DURATION_SEC * 0.78))
        : Math.min(input.sourceDurationSec ?? TARGET_DURATION_SEC, Math.max(TARGET_DURATION_SEC + 1.2, TARGET_DURATION_SEC * 1.35));
    const shouldSeedTimingSegments =
      input.sourceDurationSec !== null &&
      ((input.intent.timingMode === "stretch" && implicitDuration < TARGET_DURATION_SEC - 0.08) ||
        (input.intent.timingMode === "compress" && implicitDuration > TARGET_DURATION_SEC + 0.08));

    if (shouldSeedTimingSegments) {
      const implicitStart =
        input.sourceDurationSec && input.sourceDurationSec > implicitDuration
          ? clamp(input.autoClipStartSec, 0, Math.max(0, input.sourceDurationSec - implicitDuration))
          : 0;
      operations.push({
        op: "set_segments",
        segments: normalizeSegmentsForPlan(
          [
            {
              startSec: implicitStart,
              endSec: Math.min(input.sourceDurationSec ?? implicitStart + implicitDuration, implicitStart + implicitDuration),
              label: `${implicitStart.toFixed(2)}-${Math.min(input.sourceDurationSec ?? implicitStart + implicitDuration, implicitStart + implicitDuration).toFixed(2)}`,
              speed: 1
            }
          ],
          input.sourceDurationSec
        )
      });
    }
  }
  if (input.intent.timingMode) {
    operations.push({ op: "set_timing_mode", timingMode: input.intent.timingMode });
    if (
      fullSourceRequested &&
      input.sourceDurationSec &&
      input.sourceDurationSec > 0.05 &&
      input.snapshot.clipStartSec !== 0
    ) {
      operations.push({ op: "set_clip_start", clipStartSec: 0 });
    }
  }
  if (input.intent.audioMode) {
    operations.push({ op: "set_audio_mode", audioMode: input.intent.audioMode });
  }
  if (input.intent.smoothSlowMo) {
    operations.push({ op: "set_slowmo", smoothSlowMo: true });
  }
  if (input.intent.actionOnly) {
    operations.push({ op: "set_clip_start", clipStartSec: input.autoClipStartSec });
    operations.push({ op: "set_focus_y", focusY: input.autoFocusY });
    if (!input.intent.zoomRequested) {
      operations.push({ op: "set_video_zoom", videoZoom: DEFAULT_ZOOM });
    }
  }

  if (input.intent.noZoom) {
    operations.push({ op: "set_video_zoom", videoZoom: 1 });
  }

  if (input.intent.fontTarget) {
    const factor =
      input.intent.fontPercent !== null
        ? input.intent.fontPercent
        : input.intent.fontDirection === "increase"
          ? 1.12
          : input.intent.fontDirection === "decrease"
            ? 0.9
            : 1;
    const nextTop = clamp(input.snapshot.renderPlan.topFontScale * factor, FONT_SCALE_MIN, FONT_SCALE_MAX);
    const nextBottom = clamp(
      input.snapshot.renderPlan.bottomFontScale * factor,
      FONT_SCALE_MIN,
      FONT_SCALE_MAX
    );
    if (input.intent.fontTarget === "top" || input.intent.fontTarget === "both") {
      operations.push({ op: "set_top_font_scale", topFontScale: nextTop });
    }
    if (input.intent.fontTarget === "bottom" || input.intent.fontTarget === "both") {
      operations.push({ op: "set_bottom_font_scale", bottomFontScale: nextBottom });
    }
  } else if (input.snapshot.textFit.topCompacted || topFillRatio < 0.66 || topFillRatio > 1.05) {
    const scaleCandidate = input.snapshot.textFit.topCompacted
      ? input.snapshot.renderPlan.topFontScale * 0.92
      : topFillRatio < 0.66
        ? input.snapshot.renderPlan.topFontScale * 1.08
        : input.snapshot.renderPlan.topFontScale * 0.95;
    operations.push({
      op: "set_top_font_scale",
      topFontScale: clamp(scaleCandidate, FONT_SCALE_MIN, FONT_SCALE_MAX)
    });
  }

  return operations;
}

function createNoOpSuggestions(intent: Stage3UserIntent): string[] {
  const suggestions: string[] = [];
  if (intent.zoomRequested) {
    suggestions.push("Уточните силу зума, например: «zoom x1.35» или «легкий зум x1.1».");
  }
  if (intent.actionOnly && intent.segments.length === 0) {
    suggestions.push("Добавьте конкретные интервалы: «0:00-0:02, 0:08-конец».");
  }
  if (
    intent.segments.length === 0 &&
    !intent.zoomRequested &&
    !intent.timingMode &&
    !intent.audioMode &&
    !intent.fontTarget
  ) {
    suggestions.push("Уточните задачу: длительность/фрагменты/аудио/зум.");
  }
  if (intent.fontTarget) {
    suggestions.push("Для шрифта используйте явную команду, например: «top font 92%» или «увеличь шрифт bottom».");
  }
  if (!suggestions.length) {
    suggestions.push("Попробуйте дать более конкретную инструкцию по фрагментам, темпу или зуму.");
  }
  return suggestions;
}

function mergeOperations(primary: Stage3Operation[], secondary: Stage3Operation[]): Stage3Operation[] {
  if (!primary.length) {
    return secondary;
  }
  if (!secondary.length) {
    return primary;
  }
  return [...primary, ...secondary].slice(0, 12);
}

export async function optimizeStage3Version(
  input: OptimizeStage3VersionInput
): Promise<OptimizeStage3VersionOutput> {
  const baselinePlan = normalizePlan(input.currentSnapshot?.renderPlan, input.sourceDurationSec);
  const prompt = input.prompt.trim();
  const userIntent = parseUserIntent(prompt, input.sourceDurationSec);
  const baseline = createSnapshot({
    topText: normalizeText(input.currentSnapshot?.topText ?? input.topText),
    bottomText: normalizeText(input.currentSnapshot?.bottomText ?? input.bottomText),
    clipStartSec: Number.isFinite(input.currentSnapshot?.clipStartSec ?? NaN)
      ? Number(input.currentSnapshot?.clipStartSec)
      : input.manualClipStartSec,
    clipDurationSec: TARGET_DURATION_SEC,
    focusY: Number.isFinite(input.currentSnapshot?.focusY ?? NaN)
      ? Number(input.currentSnapshot?.focusY)
      : input.manualFocusY,
    sourceDurationSec: input.sourceDurationSec,
    renderPlan: {
      ...baselinePlan,
      prompt
    }
  });

  const context: EvaluationContext = {
    promptLower: prompt.toLowerCase(),
    sourceDurationSec: input.sourceDurationSec,
    autoClipStartSec: input.autoClipStartSec,
    autoFocusY: input.autoFocusY,
    userIntent
  };

  let current = baseline;
  let currentScore = evaluateScore(current, context);
  let lastPassSummary: string | null = null;
  let acceptedPasses = 0;
  let stagnantPasses = 0;
  const passes: Stage3AgentPass[] = [];
  let stoppedBy: NonNullable<Stage3Version["agentMeta"]>["stoppedBy"] = "max_pass";

  for (let passIndex = 1; passIndex <= MAX_PASSES; passIndex += 1) {
    const heuristicOps =
      passIndex === 1
        ? inferHeuristicOperations({
            snapshot: current,
            prompt,
            intent: userIntent,
            autoClipStartSec: input.autoClipStartSec,
            autoFocusY: input.autoFocusY,
            sourceDurationSec: input.sourceDurationSec
          })
        : [];

    let plannerSummary = "Heuristic pass.";
    let plannerOps: Stage3Operation[] = [];
    if (input.planner && prompt) {
      try {
        const planned = await input.planner({
          passIndex,
          maxPasses: MAX_PASSES,
          snapshot: current,
          scoreBefore: currentScore,
          prompt,
          sourceDurationSec: input.sourceDurationSec,
          lastPassSummary,
          userIntent
        });
        plannerSummary = planned.summary || plannerSummary;
        plannerOps = planned.operations ?? [];
      } catch (error) {
        plannerSummary = error instanceof Error ? `Planner fallback: ${error.message}` : "Planner fallback.";
      }
    }

    const proposedOps = mergeOperations(heuristicOps, plannerOps);
    if (!proposedOps.length) {
      stoppedBy = acceptedPasses > 0 ? "epsilon" : "no_change";
      break;
    }

    const scoreBefore = currentScore.total;
    const { next, changes } = applyOperations(current, proposedOps, input.sourceDurationSec);
    const scoreAfterResult = evaluateScore(next, context);
    const scoreAfter = scoreAfterResult.total;
    const delta = scoreAfter - scoreBefore;
    const changed = hasMeaningfulMediaChange(current, next);
    const forcedByInstruction = Boolean(prompt);
    const accepted =
      changed && (delta >= SCORE_EPSILON || (forcedByInstruction && delta >= -MAX_ALLOWED_DEGRADE));

    if (accepted) {
      acceptedPasses += 1;
      current = next;
      currentScore = scoreAfterResult;
    }

    if (delta < SCORE_EPSILON) {
      stagnantPasses += 1;
    } else {
      stagnantPasses = 0;
    }

    passes.push(
      snapshotToPass({
        pass: passIndex,
        label: `Проход ${passIndex}`,
        summary: plannerSummary,
        changes: [
          ...changes,
          `Оценка качества: ${scoreAfter.toFixed(1)} (duration ${scoreAfterResult.durationError.toFixed(1)}, text ${scoreAfterResult.textReadability.toFixed(1)}, action ${scoreAfterResult.actionCoverage.toFixed(1)}).`
        ],
        snapshot: accepted ? current : next,
        proposedOps,
        accepted,
        scoreBefore,
        scoreAfter,
        delta,
        rejectionReason: accepted
          ? undefined
          : !changed
            ? "Pass не дал реального изменения кадра/монтажа."
            : `Pass ухудшил score сильнее порога (${delta.toFixed(2)}).`
      })
    );
    lastPassSummary = plannerSummary;

    if (currentScore.total >= SCORE_STOP_THRESHOLD) {
      stoppedBy = "quality_threshold";
      break;
    }
    if (stagnantPasses >= 2) {
      stoppedBy = "epsilon";
      break;
    }
  }

  const changed = hasMeaningfulMediaChange(baseline, current);
  const builtVersion: Stage3Version = {
    versionNo: Math.max(1, input.versionNo || 1),
    runId: randomUUID().replace(/-/g, ""),
    createdAt: new Date().toISOString(),
    prompt,
    baseline,
    final: current,
    diff: createDiff(baseline, current),
    internalPasses: passes,
    recommendedPass: passes.length ? passes[Math.max(0, passes.length - 1)].pass : 1,
    agentMeta: {
      model: input.model ?? "gpt-5.2",
      reasoningEffort: input.reasoningEffort ?? "extra-high",
      passesExecuted: passes.length,
      acceptedPasses,
      stoppedBy: changed ? stoppedBy : "no_change"
    }
  };

  if (!changed) {
    return {
      changed: false,
      version: builtVersion,
      noOpReason:
        "Агент не нашел pass с реальным улучшением. Текущая версия уже близка к оптимальной для этого запроса.",
      suggestions: createNoOpSuggestions(userIntent),
      intent: {
        zoomRequested: userIntent.zoomRequested,
        zoomValue: userIntent.zoomValue,
        actionOnly: userIntent.actionOnly,
        segmentsRequested: userIntent.segments.length,
        timingMode: userIntent.timingMode,
        audioMode: userIntent.audioMode
      }
    };
  }

  return {
    changed: true,
    version: builtVersion,
    intent: {
      zoomRequested: userIntent.zoomRequested,
      zoomValue: userIntent.zoomValue,
      actionOnly: userIntent.actionOnly,
      segmentsRequested: userIntent.segments.length,
      timingMode: userIntent.timingMode,
      audioMode: userIntent.audioMode
    }
  };
}

// Legacy export used by older call-sites.
export async function buildStage3Version(input: BuildStage3VersionInput): Promise<Stage3Version> {
  const optimized = await optimizeStage3Version(input);
  if (optimized.changed && optimized.version) {
    return optimized.version;
  }

  const fallback = createSnapshot({
    topText: normalizeText(input.currentSnapshot?.topText ?? input.topText),
    bottomText: normalizeText(input.currentSnapshot?.bottomText ?? input.bottomText),
    clipStartSec: Number.isFinite(input.currentSnapshot?.clipStartSec ?? NaN)
      ? Number(input.currentSnapshot?.clipStartSec)
      : input.manualClipStartSec,
    clipDurationSec: TARGET_DURATION_SEC,
    focusY: Number.isFinite(input.currentSnapshot?.focusY ?? NaN)
      ? Number(input.currentSnapshot?.focusY)
      : input.manualFocusY,
    sourceDurationSec: input.sourceDurationSec,
    renderPlan: normalizePlan(input.currentSnapshot?.renderPlan, input.sourceDurationSec)
  });

  return {
    versionNo: Math.max(1, input.versionNo || 1),
    runId: randomUUID().replace(/-/g, ""),
    createdAt: new Date().toISOString(),
    prompt: input.prompt.trim(),
    baseline: fallback,
    final: fallback,
    diff: createDiff(fallback, fallback),
    internalPasses: [],
    recommendedPass: 1,
    agentMeta: {
      model: "gpt-5.2",
      reasoningEffort: "extra-high",
      passesExecuted: 0,
      acceptedPasses: 0,
      stoppedBy: "no_change"
    }
  };
}
