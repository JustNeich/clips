import { randomUUID } from "node:crypto";
import {
  Stage3AgentPass,
  Stage3AudioMode,
  Stage3RenderPlan,
  Stage3RenderPolicy,
  Stage3Segment,
  Stage3StateSnapshot,
  Stage3TimingMode,
  Stage3Version
} from "../app/components/types";
import { getScienceCardComputed } from "./stage3-template";

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
const MAX_PASSES = 8;
const SCORE_STOP_THRESHOLD = 88;
const SCORE_EPSILON = 0.35;

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
};

type EvaluatedScore = {
  total: number;
  durationError: number;
  textReadability: number;
  actionCoverage: number;
  instructionCompliance: number;
  renderStability: number;
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

function parseSegmentsFromPrompt(
  prompt: string,
  sourceDurationSec: number | null
): Stage3Segment[] {
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
    const endSec =
      endToken === "конец" || endToken === "end" ? sourceDurationSec : Number.parseFloat(endToken);
    if (Number.isFinite(startSec)) {
      segments.push({
        startSec,
        endSec: endSec !== null && Number.isFinite(endSec) ? endSec : null,
        label: `${secMatch[1]}-${secMatch[2]}`
      });
    }
    secMatch = secondsPattern.exec(normalized);
  }

  return segments;
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
  if (
    promptLower.includes("сжать") ||
    promptLower.includes("ускор") ||
    promptLower.includes("speed up")
  ) {
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
    promptLower.includes("smooth slowmo") ||
    promptLower.includes("smooth slow-mo")
  );
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
    segments: [],
    policy: inferPolicyFromSourceDuration(sourceDurationSec),
    prompt: ""
  };
}

function normalizePlan(input: Partial<Stage3RenderPlan> | undefined, sourceDurationSec: number | null): Stage3RenderPlan {
  const defaultPlan = createDefaultRenderPlan(sourceDurationSec);
  const timingMode = input?.timingMode;
  const audioMode = input?.audioMode;
  const policy = input?.policy;
  const segments = Array.isArray(input?.segments)
    ? input.segments
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
    segments,
    policy:
      policy === "adaptive_window" || policy === "full_source_normalize" || policy === "fixed_segments"
        ? policy
        : defaultPlan.policy,
    prompt: typeof input?.prompt === "string" ? input.prompt : defaultPlan.prompt
  };
}

function buildPromptPlan(
  prompt: string,
  sourceDurationSec: number | null,
  baselinePlan: Stage3RenderPlan
): Stage3RenderPlan {
  const promptNorm = prompt.trim();
  const promptLower = promptNorm.toLowerCase();
  const parsedSegments = parseSegmentsFromPrompt(promptNorm, sourceDurationSec);
  const explicitTiming = detectTimingMode(promptLower);
  const explicitAudio = detectAudioMode(promptLower);
  const explicitSlowMo = smoothSlowMoRequested(promptLower);

  const hasSegments = parsedSegments.length > 0;
  let policy: Stage3RenderPolicy = hasSegments ? "fixed_segments" : inferPolicyFromSourceDuration(sourceDurationSec);

  if (hasSegments) {
    policy = "fixed_segments";
  } else if (explicitTiming) {
    policy = "full_source_normalize";
  }

  const timingMode: Stage3TimingMode =
    explicitTiming ??
    (sourceDurationSec !== null && sourceDurationSec <= TARGET_DURATION_SEC
      ? "stretch"
      : baselinePlan.timingMode);

  return {
    targetDurationSec: TARGET_DURATION_SEC,
    timingMode,
    audioMode: explicitAudio ?? baselinePlan.audioMode,
    smoothSlowMo: explicitSlowMo || (timingMode === "stretch" && baselinePlan.smoothSlowMo),
    segments: hasSegments ? parsedSegments : baselinePlan.segments,
    policy,
    prompt: promptNorm
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

function evaluateInstructionCompliance(snapshot: Stage3StateSnapshot, promptLower: string): number {
  if (!promptLower.trim()) {
    return 0;
  }
  let penalty = 0;
  const hasFragmentsInstruction =
    /\d{1,2}:\d{2}(?:\.\d)?\s*-\s*(?:\d{1,2}:\d{2}(?:\.\d)?|конец|end)/.test(promptLower);
  if (hasFragmentsInstruction && snapshot.renderPlan.segments.length === 0) {
    penalty += 22;
  }
  if ((promptLower.includes("сжать") || promptLower.includes("ускор")) && snapshot.renderPlan.timingMode !== "compress") {
    penalty += 14;
  }
  if ((promptLower.includes("растянуть") || promptLower.includes("слоумо")) && snapshot.renderPlan.timingMode !== "stretch") {
    penalty += 14;
  }
  if ((promptLower.includes("только звук") || promptLower.includes("отключить музыку")) && snapshot.renderPlan.audioMode !== "source_only") {
    penalty += 16;
  }
  if (
    (promptLower.includes("звук + музыка") || promptLower.includes("звук+музыка") || promptLower.includes("звук и музыка")) &&
    snapshot.renderPlan.audioMode !== "source_plus_music"
  ) {
    penalty += 16;
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
  if (snapshot.textFit.topFontPx < 34) {
    textReadability += ((34 - snapshot.textFit.topFontPx) / 34) * 10;
  }
  if (snapshot.textFit.bottomFontPx < 30) {
    textReadability += ((30 - snapshot.textFit.bottomFontPx) / 30) * 10;
  }

  const actionCoverage =
    Math.min(14, Math.abs(snapshot.clipStartSec - context.autoClipStartSec) * 1.8) +
    Math.abs(snapshot.focusY - context.autoFocusY) * 18;

  const instructionCompliance = evaluateInstructionCompliance(snapshot, context.promptLower);
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

function snapshotToPass(args: {
  pass: number;
  label: string;
  summary: string;
  changes: string[];
  snapshot: Stage3StateSnapshot;
}): Stage3AgentPass {
  const { snapshot } = args;
  return {
    pass: args.pass,
    label: args.label,
    summary: args.summary,
    changes: args.changes,
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

function updatePlanFromPrompt(
  snapshot: Stage3StateSnapshot,
  promptPlan: Stage3RenderPlan
): { next: Stage3StateSnapshot; changed: boolean; changes: string[] } {
  const next = createSnapshot({
    topText: snapshot.topText,
    bottomText: snapshot.bottomText,
    clipStartSec: snapshot.clipStartSec,
    clipDurationSec: snapshot.clipDurationSec,
    focusY: snapshot.focusY,
    sourceDurationSec: snapshot.sourceDurationSec,
    renderPlan: promptPlan
  });
  const changed = JSON.stringify(snapshot.renderPlan) !== JSON.stringify(next.renderPlan);
  const changes: string[] = [];
  if (changed) {
    changes.push(`Политика монтажа: ${snapshot.renderPlan.policy} -> ${next.renderPlan.policy}.`);
    if (snapshot.renderPlan.timingMode !== next.renderPlan.timingMode) {
      changes.push(`Режим длительности: ${snapshot.renderPlan.timingMode} -> ${next.renderPlan.timingMode}.`);
    }
    if (snapshot.renderPlan.audioMode !== next.renderPlan.audioMode) {
      changes.push(`Режим аудио: ${snapshot.renderPlan.audioMode} -> ${next.renderPlan.audioMode}.`);
    }
    if (snapshot.renderPlan.segments.length !== next.renderPlan.segments.length) {
      changes.push(`Фрагменты: ${snapshot.renderPlan.segments.length} -> ${next.renderPlan.segments.length}.`);
    }
  }
  return { next, changed, changes };
}

function adjustFraming(
  snapshot: Stage3StateSnapshot,
  autoClipStartSec: number,
  autoFocusY: number
): { next: Stage3StateSnapshot; changed: boolean; changes: string[] } {
  let changed = false;
  const next = createSnapshot({
    ...snapshot,
    clipStartSec: snapshot.clipStartSec,
    clipDurationSec: snapshot.clipDurationSec,
    focusY: snapshot.focusY,
    sourceDurationSec: snapshot.sourceDurationSec,
    renderPlan: snapshot.renderPlan
  });
  const changes: string[] = [];

  if (Math.abs(snapshot.clipStartSec - autoClipStartSec) >= 0.08) {
    next.clipStartSec = Math.max(0, autoClipStartSec);
    changed = true;
    changes.push(`Сдвиг старта клипа: ${snapshot.clipStartSec.toFixed(1)}с -> ${next.clipStartSec.toFixed(1)}с.`);
  }
  if (Math.abs(snapshot.focusY - autoFocusY) >= 0.01) {
    next.focusY = clamp(autoFocusY, 0.12, 0.88);
    changed = true;
    changes.push(`Вертикальный фокус: ${Math.round(snapshot.focusY * 100)}% -> ${Math.round(next.focusY * 100)}%.`);
  }

  return { next, changed, changes };
}

function applyTextFit(snapshot: Stage3StateSnapshot): { next: Stage3StateSnapshot; changed: boolean; changes: string[] } {
  const fit = computeTextFit(snapshot.topText, snapshot.bottomText);
  const next = createSnapshot({
    ...snapshot,
    topText: fit.topText,
    bottomText: fit.bottomText,
    clipStartSec: snapshot.clipStartSec,
    clipDurationSec: snapshot.clipDurationSec,
    focusY: snapshot.focusY,
    sourceDurationSec: snapshot.sourceDurationSec,
    renderPlan: snapshot.renderPlan
  });
  const changed = fit.topText !== snapshot.topText || fit.bottomText !== snapshot.bottomText;
  const changes: string[] = [];
  if (changed) {
    changes.push("Подогнал TOP/BOTTOM под реальные размеры слотов.");
  }
  if (fit.topCompacted || fit.bottomCompacted) {
    changes.push("Сократил текст только в местах, где это нужно для полного влезания.");
  } else {
    changes.push("Текст полностью помещается без дополнительного сокращения.");
  }
  return { next, changed, changes };
}

function createDiff(baseline: Stage3StateSnapshot, final: Stage3StateSnapshot): Stage3Version["diff"] {
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
    summary.push("Обновлены TOP/BOTTOM для стабильной читаемости.");
  }
  if (framingChanged) {
    summary.push("Скорректирован фокус и момент старта клипа.");
  }
  if (segmentsChanged) {
    summary.push("Пересобран монтаж по фрагментам.");
  }
  if (timingChanged) {
    summary.push("Обновлен режим длительности/темпа до ровно 6 секунд.");
  }
  if (audioChanged) {
    summary.push("Изменен режим аудио (только source или source + music).");
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

export function buildStage3Version(input: BuildStage3VersionInput): Stage3Version {
  const baselinePlan = normalizePlan(input.currentSnapshot?.renderPlan, input.sourceDurationSec);
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
    renderPlan: baselinePlan
  });

  const promptPlan = buildPromptPlan(input.prompt, input.sourceDurationSec, baseline.renderPlan);
  const ctx: EvaluationContext = {
    promptLower: input.prompt.trim().toLowerCase(),
    sourceDurationSec: input.sourceDurationSec,
    autoClipStartSec: input.autoClipStartSec,
    autoFocusY: input.autoFocusY
  };

  let current = baseline;
  let currentScore = evaluateScore(current, ctx);
  let stableCount = 0;
  const passes: Stage3AgentPass[] = [];
  let passNo = 1;

  const runOperation = (
    summary: string,
    operation: (snapshot: Stage3StateSnapshot) => { next: Stage3StateSnapshot; changed: boolean; changes: string[] }
  ) => {
    if (passNo > MAX_PASSES) {
      return;
    }
    const { next, changed, changes } = operation(current);
    if (!changed) {
      return;
    }
    const nextScore = evaluateScore(next, ctx);
    const delta = nextScore.total - currentScore.total;
    if (delta < SCORE_EPSILON) {
      stableCount += 1;
    } else {
      stableCount = 0;
    }
    current = next;
    currentScore = nextScore;

    passes.push(
      snapshotToPass({
        pass: passNo,
        label: `Проход ${passNo}`,
        summary,
        changes: [
          ...changes,
          `Оценка качества: ${nextScore.total.toFixed(1)} (duration ${nextScore.durationError.toFixed(1)}, text ${nextScore.textReadability.toFixed(1)}, action ${nextScore.actionCoverage.toFixed(1)}).`
        ],
        snapshot: current
      })
    );
    passNo += 1;
  };

  runOperation("Разобрал инструкцию и обновил монтажный план.", (snapshot) =>
    updatePlanFromPrompt(snapshot, promptPlan)
  );
  runOperation("Скорректировал фокус и старт клипа по активности.", (snapshot) =>
    adjustFraming(snapshot, input.autoClipStartSec, input.autoFocusY)
  );
  runOperation("Привел текст к стабильному отображению в шаблоне.", (snapshot) =>
    applyTextFit(snapshot)
  );

  if (passNo <= MAX_PASSES && (stableCount < 2 || currentScore.total < SCORE_STOP_THRESHOLD)) {
    const finalScore = evaluateScore(current, ctx);
    passes.push(
      snapshotToPass({
        pass: passNo,
        label: `Проход ${passNo}`,
        summary: "Финальная валидация перед рендером.",
        changes: [
          "Проверил итоговую длительность, текстовую читаемость и покрытие действия в кадре.",
          `Финальная оценка качества: ${finalScore.total.toFixed(1)}.`
        ],
        snapshot: current
      })
    );
  }

  const recommendedPass = passes.length ? passes[passes.length - 1].pass : 1;
  const diff = createDiff(baseline, current);

  return {
    versionNo: Math.max(1, input.versionNo || 1),
    runId: randomUUID().replace(/-/g, ""),
    createdAt: new Date().toISOString(),
    prompt: input.prompt.trim(),
    baseline,
    final: current,
    diff,
    internalPasses: passes,
    recommendedPass
  };
}
