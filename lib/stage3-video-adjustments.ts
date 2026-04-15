export type Stage3VideoAdjustments = {
  brightness: number;
  exposure: number;
  contrast: number;
  saturation: number;
};

export const STAGE3_VIDEO_BRIGHTNESS_MIN = 0.4;
export const STAGE3_VIDEO_BRIGHTNESS_MAX = 1.8;
export const STAGE3_VIDEO_EXPOSURE_MIN = -1;
export const STAGE3_VIDEO_EXPOSURE_MAX = 1;
export const STAGE3_VIDEO_CONTRAST_MIN = 0.5;
export const STAGE3_VIDEO_CONTRAST_MAX = 1.8;
export const STAGE3_VIDEO_SATURATION_MIN = 0;
export const STAGE3_VIDEO_SATURATION_MAX = 2;

export const DEFAULT_STAGE3_VIDEO_ADJUSTMENTS: Stage3VideoAdjustments = {
  brightness: 1,
  exposure: 0,
  contrast: 1,
  saturation: 1
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

export function cloneStage3VideoAdjustments(
  value: Stage3VideoAdjustments
): Stage3VideoAdjustments {
  return {
    brightness: value.brightness,
    exposure: value.exposure,
    contrast: value.contrast,
    saturation: value.saturation
  };
}

export function normalizeStage3VideoBrightness(value: unknown, fallback = 1): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(round(value), STAGE3_VIDEO_BRIGHTNESS_MIN, STAGE3_VIDEO_BRIGHTNESS_MAX)
    : fallback;
}

export function normalizeStage3VideoExposure(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(round(value), STAGE3_VIDEO_EXPOSURE_MIN, STAGE3_VIDEO_EXPOSURE_MAX)
    : fallback;
}

export function normalizeStage3VideoContrast(value: unknown, fallback = 1): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(round(value), STAGE3_VIDEO_CONTRAST_MIN, STAGE3_VIDEO_CONTRAST_MAX)
    : fallback;
}

export function normalizeStage3VideoSaturation(value: unknown, fallback = 1): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(round(value), STAGE3_VIDEO_SATURATION_MIN, STAGE3_VIDEO_SATURATION_MAX)
    : fallback;
}

export function normalizeStage3VideoAdjustments(
  value: unknown,
  fallback: Stage3VideoAdjustments = DEFAULT_STAGE3_VIDEO_ADJUSTMENTS
): Stage3VideoAdjustments {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  return {
    brightness: normalizeStage3VideoBrightness(candidate?.brightness, fallback.brightness),
    exposure: normalizeStage3VideoExposure(candidate?.exposure, fallback.exposure),
    contrast: normalizeStage3VideoContrast(candidate?.contrast, fallback.contrast),
    saturation: normalizeStage3VideoSaturation(candidate?.saturation, fallback.saturation)
  };
}

export function areStage3VideoAdjustmentsEqual(
  left: Stage3VideoAdjustments,
  right: Stage3VideoAdjustments
): boolean {
  return (
    Math.abs(left.brightness - right.brightness) < 0.0001 &&
    Math.abs(left.exposure - right.exposure) < 0.0001 &&
    Math.abs(left.contrast - right.contrast) < 0.0001 &&
    Math.abs(left.saturation - right.saturation) < 0.0001
  );
}

export function readStage3VideoAdjustmentsFromRenderPlan(
  value: {
    videoBrightness?: unknown;
    videoExposure?: unknown;
    videoContrast?: unknown;
    videoSaturation?: unknown;
  },
  fallback: Stage3VideoAdjustments = DEFAULT_STAGE3_VIDEO_ADJUSTMENTS
): Stage3VideoAdjustments {
  return {
    brightness: normalizeStage3VideoBrightness(value.videoBrightness, fallback.brightness),
    exposure: normalizeStage3VideoExposure(value.videoExposure, fallback.exposure),
    contrast: normalizeStage3VideoContrast(value.videoContrast, fallback.contrast),
    saturation: normalizeStage3VideoSaturation(value.videoSaturation, fallback.saturation)
  };
}

export function applyStage3VideoAdjustmentsToRenderPlan<T extends object>(
  value: T,
  adjustments: Stage3VideoAdjustments
): T & {
  videoBrightness: number;
  videoExposure: number;
  videoContrast: number;
  videoSaturation: number;
} {
  return {
    ...value,
    videoBrightness: adjustments.brightness,
    videoExposure: adjustments.exposure,
    videoContrast: adjustments.contrast,
    videoSaturation: adjustments.saturation
  };
}

export function buildStage3VideoFilterCss(
  adjustments: Stage3VideoAdjustments,
  options?: {
    blurPx?: number;
    baseBrightness?: number;
    baseContrast?: number;
    baseSaturation?: number;
  }
): string | undefined {
  const normalized = normalizeStage3VideoAdjustments(adjustments);
  const blurPx = options?.blurPx ?? 0;
  const brightness =
    (options?.baseBrightness ?? 1) * normalized.brightness * Math.pow(2, normalized.exposure);
  const contrast = (options?.baseContrast ?? 1) * normalized.contrast;
  const saturation = (options?.baseSaturation ?? 1) * normalized.saturation;
  const filters: string[] = [];

  if (blurPx > 0) {
    filters.push(`blur(${round(blurPx)}px)`);
  }
  if (Math.abs(brightness - 1) >= 0.0001) {
    filters.push(`brightness(${round(brightness).toFixed(3)})`);
  }
  if (Math.abs(contrast - 1) >= 0.0001) {
    filters.push(`contrast(${round(contrast).toFixed(3)})`);
  }
  if (Math.abs(saturation - 1) >= 0.0001) {
    filters.push(`saturate(${round(saturation).toFixed(3)})`);
  }

  return filters.length > 0 ? filters.join(" ") : undefined;
}
