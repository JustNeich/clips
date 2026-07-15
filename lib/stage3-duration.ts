export const DEFAULT_STAGE3_CLIP_DURATION_SEC = 6;
export const MIN_STAGE3_CLIP_DURATION_SEC = 3;
export const MAX_STAGE3_CLIP_DURATION_SEC = 59;
export const MIN_STAGE3_SOURCE_FULL_DURATION_SEC = 0.5;
export const MAX_STAGE3_SOURCE_FULL_DURATION_SEC = 180;

export type Stage3DurationMode = "channel_default" | "source_full" | "explicit_final";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToThousandth(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function normalizeStage3DurationMode(value: unknown): Stage3DurationMode {
  if (value === "explicit_final") {
    return "explicit_final";
  }
  return value === "source_full" ? "source_full" : "channel_default";
}

export function normalizeStage3ClipDurationSec(
  value: unknown,
  fallback = DEFAULT_STAGE3_CLIP_DURATION_SEC
): number {
  const resolvedFallback =
    typeof fallback === "number" && Number.isFinite(fallback)
      ? clamp(Math.round(fallback), MIN_STAGE3_CLIP_DURATION_SEC, MAX_STAGE3_CLIP_DURATION_SEC)
      : DEFAULT_STAGE3_CLIP_DURATION_SEC;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return resolvedFallback;
  }
  return clamp(Math.round(value), MIN_STAGE3_CLIP_DURATION_SEC, MAX_STAGE3_CLIP_DURATION_SEC);
}

export function normalizeStage3SourceFullDurationSec(
  value: unknown,
  fallback = DEFAULT_STAGE3_CLIP_DURATION_SEC
): number {
  const resolvedFallback =
    typeof fallback === "number" && Number.isFinite(fallback)
      ? clamp(
          roundToThousandth(fallback),
          MIN_STAGE3_SOURCE_FULL_DURATION_SEC,
          MAX_STAGE3_SOURCE_FULL_DURATION_SEC
        )
      : DEFAULT_STAGE3_CLIP_DURATION_SEC;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return resolvedFallback;
  }
  return clamp(
    roundToThousandth(value),
    MIN_STAGE3_SOURCE_FULL_DURATION_SEC,
    MAX_STAGE3_SOURCE_FULL_DURATION_SEC
  );
}

export function resolveStage3OutputDurationSec(params: {
  mode?: Stage3DurationMode | null;
  targetDurationSec?: unknown;
  sourceDurationSec?: number | null;
  fallback?: number;
}): number {
  const mode = normalizeStage3DurationMode(params.mode);
  const fallback = params.fallback ?? DEFAULT_STAGE3_CLIP_DURATION_SEC;
  if (mode === "source_full") {
    return normalizeStage3SourceFullDurationSec(
      params.sourceDurationSec ?? params.targetDurationSec,
      fallback
    );
  }
  if (mode === "explicit_final") {
    return normalizeStage3SourceFullDurationSec(params.targetDurationSec, fallback);
  }
  return normalizeStage3ClipDurationSec(params.targetDurationSec, fallback);
}

export function buildStage3ClipDurationOptions(): number[] {
  const options: number[] = [];
  for (let sec = MIN_STAGE3_CLIP_DURATION_SEC; sec <= MAX_STAGE3_CLIP_DURATION_SEC; sec += 1) {
    options.push(sec);
  }
  return options;
}
