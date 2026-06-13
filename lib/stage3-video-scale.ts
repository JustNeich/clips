export const STAGE3_MIN_VIDEO_SCALE_Y = 0.5;
export const STAGE3_MAX_VIDEO_SCALE_Y = 1.5;
export const DEFAULT_STAGE3_VIDEO_SCALE_Y = 1;

export const STAGE3_MIN_VIDEO_SCALE_X = 0.5;
export const STAGE3_MAX_VIDEO_SCALE_X = 1.5;
export const DEFAULT_STAGE3_VIDEO_SCALE_X = 1;

export function normalizeStage3VideoScaleY(value: unknown, fallback = DEFAULT_STAGE3_VIDEO_SCALE_Y): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(STAGE3_MAX_VIDEO_SCALE_Y, Math.max(STAGE3_MIN_VIDEO_SCALE_Y, Number(value.toFixed(3))));
}

export function normalizeStage3VideoScaleX(value: unknown, fallback = DEFAULT_STAGE3_VIDEO_SCALE_X): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(STAGE3_MAX_VIDEO_SCALE_X, Math.max(STAGE3_MIN_VIDEO_SCALE_X, Number(value.toFixed(3))));
}
