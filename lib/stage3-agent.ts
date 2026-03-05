import { randomUUID } from "node:crypto";
import {
  Stage3AgentPass,
  Stage3AudioMode,
  Stage3Operation,
  Stage3RenderPlan,
  Stage3RenderPolicy,
  Stage3Segment,
  Stage3StateSnapshot,
  Stage3TextPolicy,
  Stage3TimingMode,
  Stage3Version
} from "../app/components/types";
import { SCIENCE_CARD, getScienceCardComputed } from "./stage3-template";

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

type BuildStage3VersionInput = {
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

type EvaluatedScore = {
  total: number;
  durationError: number;
  textReadability: number;
  actionCoverage: number;
  instructionCompliance: number;
  renderStability: number;
};

type Stage3UserIntent = {
  zoomRequested: boolean;
  zoomValue: number | null;
  actionOnly: boolean;
  segments: Stage3Segment[];
  timingMode: Stage3TimingMode | null;
  audioMode: Stage3AudioMode | null;
  smoothSlowMo: boolean;
  noZoom: boolean;
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
    scoreBefore: EvaluatedScore;
    prompt: string;
    sourceDurationSec: number | null;
    lastPassSummary?: string | null;
    userIntent: Stage3UserIntent;
  }) => Promise<PlannerResult>) | null;
  model?: string;
  reasoningEffort?: string;
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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
    label:
      typeof segment.label === "string" && segment.label.trim()
        ? segment.label.trim()
        : `${start.toFixed(2)}-${end === null ? "end" : end.toFixed(2)}`
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
        label: `${match[1]}-${match[2]}`
      });
    }
    match = pattern.exec(normalized);
  }

  const secondsPattern = /(?:^|[\s,;])(\d{1,3}(?:\.\d+)?)\s*-\s*(\d{1,3}(?:\.\d+)?|конец|end)(?=$|[\s,;])/g;
  let secMatch = secondsPattern.exec(normalized);
  while (secMatch) {
    const startSec = Number.parseFloat(secMatch[1]);
    const endToken = secMatch[2];
    const endSec = endToken === "конец" || endToken === "end" ? sourceDurationSec : Number.parseFloat(endToken);
    if (Number.isFinite(startSec)) {
      segments.push({
        startSec,
        endSec: endSec !== null && Number.isFinite(endSec) ? endSec : null,
        label: `${secMatch[1]}-${secMatch[2]}`
      });
    }
    secMatch = secondsPattern.exec(normalized);
  }

  return segments
    .map((segment) => normalizeSegment(segment, sourceDurationSec))
    .filter((segment): segment is Stage3Segment => Boolean(segment));
}

function detectTimingMode(promptLower: string): Stage3TimingMode | null {
  if (
    promptLower.includes("растянуть") ||
    promptLower.includes("слоумо") ||
    promptLower.includes("slowmo") ||
    promptLower.includes("slow-mo")
  ) {
    return "stretch";
  }
  if (promptLower.includes("сжать") || promptLower.includes("ускор") || promptLower.includes("speed up")) {
    return "compress";
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
    promptLower.includes("slow motion") ||
    promptLower.includes("smooth slowmo") ||
    promptLower.includes("smooth slow-mo")
  );
}

function parseZoomValue(promptLower: string): { requested: boolean; value: number | null; noZoom: boolean } {
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
    promptLower.includes("увелич");
  if (!requested) {
    return { requested: false, value: null, noZoom: false };
  }

  const mulMatch = promptLower.match(/x\s*(1(?:\.\d+)?|0?\.\d+)/i);
  if (mulMatch?.[1]) {
    const parsed = Number.parseFloat(mulMatch[1]);
    if (Number.isFinite(parsed)) {
      return { requested: true, value: clamp(parsed, 1, 1.6), noZoom: false };
    }
  }

  const percentMatch = promptLower.match(/(\d{2,3})\s*%/);
  if (percentMatch?.[1]) {
    const parsed = Number.parseInt(percentMatch[1], 10);
    if (Number.isFinite(parsed)) {
      return { requested: true, value: clamp(parsed / 100, 1, 1.6), noZoom: false };
    }
  }

  if (promptLower.includes("сильный зум") || promptLower.includes("strong zoom")) {
    return { requested: true, value: 1.35, noZoom: false };
  }
  if (promptLower.includes("легкий зум") || promptLower.includes("slight zoom")) {
    return { requested: true, value: 1.1, noZoom: false };
  }
  return { requested: true, value: DEFAULT_ZOOM, noZoom: false };
}

function parseUserIntent(prompt: string, sourceDurationSec: number | null): Stage3UserIntent {
  const promptLower = prompt.trim().toLowerCase();
  const zoom = parseZoomValue(promptLower);
  const actionOnly =
    promptLower.includes("только действия") ||
    promptLower.includes("где происходят действия") ||
    promptLower.includes("only action") ||
    promptLower.includes("main action");
  return {
    zoomRequested: zoom.requested,
    zoomValue: zoom.value,
    actionOnly,
    segments: parseSegmentsFromPrompt(promptLower, sourceDurationSec),
    timingMode: detectTimingMode(promptLower),
    audioMode: detectAudioMode(promptLower),
    smoothSlowMo: smoothSlowMoRequested(promptLower),
    noZoom: zoom.noZoom
  };
}

function inferPolicyFromSourceDuration(sourceDurationSec: number | null): Stage3RenderPolicy {
  if (!sourceDurationSec || sourceDurationSec <= 12) {
    return "full_source_normalize";
  }
  return "adaptive_window";
}

function createDefaultRenderPlan(sourceDurationSec: number | null): Stage3RenderPlan {
  return {
    targetDurationSec: TARGET_DURATION_SEC,
    timingMode: sourceDurationSec !== null && sourceDurationSec < TARGET_DURATION_SEC ? "stretch" : "auto",
    audioMode: "source_only",
    smoothSlowMo: false,
    videoZoom: 1,
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
    authorName: SCIENCE_CARD.author.name,
    authorHandle: SCIENCE_CARD.author.handle,
    templateId: "science-card-v1",
    prompt: ""
  };
}

function normalizePlan(input: Partial<Stage3RenderPlan> | undefined, sourceDurationSec: number | null): Stage3RenderPlan {
  const defaultPlan = createDefaultRenderPlan(sourceDurationSec);
  const timingMode = input?.timingMode;
  const audioMode = input?.audioMode;
  const policy = input?.policy;
  const textPolicy = input?.textPolicy;
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
    audioMode:
      audioMode === "source_only" || audioMode === "source_plus_music"
        ? audioMode
        : defaultPlan.audioMode,
    smoothSlowMo: Boolean(input?.smoothSlowMo),
    videoZoom:
      typeof input?.videoZoom === "number" && Number.isFinite(input.videoZoom)
        ? clamp(input.videoZoom, 1, 1.6)
        : defaultPlan.videoZoom,
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

function computeTextFit(topText: string, bottomText: string): Stage3StateSnapshot["textFit"] & {
  topText: string;
  bottomText: string;
} {
  const computed = getScienceCardComputed(topText, bottomText);
  return {
    topText: computed.top,
    bottomText: computed.bottom,
    topFontPx: computed.topFont,
    bottomFontPx: computed.bottomFont,
    topCompacted: computed.topCompacted,
    bottomCompacted: computed.bottomCompacted
  };
}

function createSnapshot(input: {
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  sourceDurationSec: number | null;
  renderPlan: Stage3RenderPlan;
}): Stage3StateSnapshot {
  const fit = computeTextFit(input.topText, input.bottomText);
  return {
    topText: fit.topText,
    bottomText: fit.bottomText,
    clipStartSec: Math.max(0, input.clipStartSec),
    clipDurationSec: TARGET_DURATION_SEC,
    focusY: clamp(input.focusY, 0.12, 0.88),
    sourceDurationSec: input.sourceDurationSec,
    renderPlan: normalizePlan(input.renderPlan, input.sourceDurationSec),
    textFit: {
      topFontPx: fit.topFontPx,
      bottomFontPx: fit.bottomFontPx,
      topCompacted: fit.topCompacted,
      bottomCompacted: fit.bottomCompacted
    }
  };
}

function approxSegmentsDuration(
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
    return acc + (end - start);
  }, 0);
  return Math.max(0.05, raw);
}

function estimatePreTimingDuration(snapshot: Stage3StateSnapshot): number {
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
  if (intent.timingMode && snapshot.renderPlan.timingMode !== intent.timingMode) {
    penalty += 14;
  }
  if (intent.audioMode && snapshot.renderPlan.audioMode !== intent.audioMode) {
    penalty += 16;
  }
  if (intent.zoomRequested) {
    const expectedZoom = intent.zoomValue ?? DEFAULT_ZOOM;
    if (Math.abs(snapshot.renderPlan.videoZoom - expectedZoom) > 0.04) {
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

function evaluateScore(snapshot: Stage3StateSnapshot, context: EvaluationContext): EvaluatedScore {
  const durationOut = estimateOutputDuration(snapshot);
  const durationError = (Math.abs(durationOut - TARGET_DURATION_SEC) / TARGET_DURATION_SEC) * 28;

  let textReadability = 0;
  if (snapshot.textFit.topCompacted) {
    textReadability += 7;
  }
  if (snapshot.textFit.bottomCompacted) {
    textReadability += 7;
  }
  if (snapshot.textFit.topFontPx < SCIENCE_CARD.typography.top.min) {
    textReadability +=
      ((SCIENCE_CARD.typography.top.min - snapshot.textFit.topFontPx) / SCIENCE_CARD.typography.top.min) * 10;
  }
  if (snapshot.textFit.bottomFontPx < SCIENCE_CARD.typography.bottom.min) {
    textReadability +=
      ((SCIENCE_CARD.typography.bottom.min - snapshot.textFit.bottomFontPx) /
        SCIENCE_CARD.typography.bottom.min) *
      10;
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

function hasMeaningfulMediaChange(before: Stage3StateSnapshot, after: Stage3StateSnapshot): boolean {
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
  if (Math.abs(before.renderPlan.musicGain - after.renderPlan.musicGain) >= 0.01) {
    return true;
  }
  if (before.renderPlan.timingMode !== after.renderPlan.timingMode) {
    return true;
  }
  if (before.renderPlan.audioMode !== after.renderPlan.audioMode) {
    return true;
  }
  if (before.renderPlan.smoothSlowMo !== after.renderPlan.smoothSlowMo) {
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
  const textChanged = baseline.topText !== final.topText || baseline.bottomText !== final.bottomText;
  const framingChanged =
    Math.abs(baseline.clipStartSec - final.clipStartSec) >= 0.01 ||
    Math.abs(baseline.focusY - final.focusY) >= 0.005 ||
    Math.abs(baseline.renderPlan.videoZoom - final.renderPlan.videoZoom) >= 0.01;
  const timingChanged =
    baseline.renderPlan.timingMode !== final.renderPlan.timingMode ||
    baseline.renderPlan.policy !== final.renderPlan.policy ||
    baseline.renderPlan.smoothSlowMo !== final.renderPlan.smoothSlowMo;
  const segmentsChanged =
    JSON.stringify(baseline.renderPlan.segments) !== JSON.stringify(final.renderPlan.segments);
  const audioChanged = baseline.renderPlan.audioMode !== final.renderPlan.audioMode;
  const summary: string[] = [];
  if (textChanged) {
    summary.push("Обновлены TOP/BOTTOM для стабильной читаемости.");
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
    summary.push("Изменен режим аудио (source/source+music).");
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

function applyOperations(
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
          changes.push(`Timing mode: ${nextPlan.timingMode} -> ${operation.timingMode}.`);
          nextPlan.timingMode = operation.timingMode;
        }
        break;
      case "set_audio_mode":
        if (nextPlan.audioMode !== operation.audioMode) {
          changes.push(`Audio mode: ${nextPlan.audioMode} -> ${operation.audioMode}.`);
          nextPlan.audioMode = operation.audioMode;
        }
        break;
      case "set_slowmo":
        if (nextPlan.smoothSlowMo !== operation.smoothSlowMo) {
          nextPlan.smoothSlowMo = operation.smoothSlowMo;
          changes.push(`Slow-mo: ${operation.smoothSlowMo ? "on" : "off"}.`);
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
        nextPlan.videoZoom = clamp(operation.videoZoom, 1, 1.6);
        changes.push(`Zoom video slot: x${nextPlan.videoZoom.toFixed(2)}.`);
        break;
      case "set_music_gain":
        nextPlan.musicGain = clamp(operation.musicGain, 0, 1);
        changes.push(`Music gain: ${(nextPlan.musicGain * 100).toFixed(0)}%.`);
        break;
      case "set_text_policy":
        nextPlan.textPolicy = operation.textPolicy;
        changes.push(`Text policy: ${operation.textPolicy}.`);
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

function inferHeuristicOperations(input: {
  snapshot: Stage3StateSnapshot;
  prompt: string;
  intent: Stage3UserIntent;
  autoClipStartSec: number;
  autoFocusY: number;
  sourceDurationSec: number | null;
}): Stage3Operation[] {
  const operations: Stage3Operation[] = [];
  const promptNorm = input.prompt.trim();
  if (!promptNorm) {
    if (Math.abs(input.snapshot.clipStartSec - input.autoClipStartSec) >= 0.08) {
      operations.push({ op: "set_clip_start", clipStartSec: input.autoClipStartSec });
    }
    if (Math.abs(input.snapshot.focusY - input.autoFocusY) >= 0.01) {
      operations.push({ op: "set_focus_y", focusY: input.autoFocusY });
    }
    return operations;
  }

  if (input.intent.zoomRequested) {
    operations.push({
      op: "set_video_zoom",
      videoZoom: input.intent.zoomValue ?? DEFAULT_ZOOM
    });
  }
  if (input.intent.timingMode) {
    operations.push({ op: "set_timing_mode", timingMode: input.intent.timingMode });
  }
  if (input.intent.audioMode) {
    operations.push({ op: "set_audio_mode", audioMode: input.intent.audioMode });
  }
  if (input.intent.smoothSlowMo) {
    operations.push({ op: "set_slowmo", smoothSlowMo: true });
  }
  if (input.intent.segments.length > 0) {
    operations.push({
      op: "set_segments",
      segments: normalizeSegmentsForPlan(input.intent.segments, input.sourceDurationSec)
    });
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
  if (intent.segments.length === 0 && !intent.zoomRequested && !intent.timingMode && !intent.audioMode) {
    suggestions.push("Уточните задачу: длительность/фрагменты/аудио/зум.");
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
