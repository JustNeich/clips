export const DEFAULT_STAGE3_CLIP_DURATION_SEC = 6;
export const MIN_STAGE3_CLIP_DURATION_SEC = 3;
export const MAX_STAGE3_CLIP_DURATION_SEC = 15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

export function buildStage3ClipDurationOptions(): number[] {
  const options: number[] = [];
  for (let sec = MIN_STAGE3_CLIP_DURATION_SEC; sec <= MAX_STAGE3_CLIP_DURATION_SEC; sec += 1) {
    options.push(sec);
  }
  return options;
}
