import type { Stage3SourceCrop } from "../app/components/types";

const MIN_CROP_SIDE = 0.05;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeUnit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return clamp(value, 0, 1);
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function normalizeStage3SourceCrop(
  value: unknown,
  fallback: Stage3SourceCrop | null = null
): Stage3SourceCrop | null {
  const candidate = value && typeof value === "object" ? (value as Partial<Stage3SourceCrop>) : null;
  if (!candidate) {
    return fallback;
  }

  const enabled = typeof candidate.enabled === "boolean" ? candidate.enabled : fallback?.enabled ?? true;
  if (!enabled) {
    return {
      enabled: false,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      confidence: null,
      source: normalizeOptionalString(candidate.source, 80) ?? fallback?.source ?? null,
      reviewedAt: normalizeOptionalString(candidate.reviewedAt, 40) ?? fallback?.reviewedAt ?? null,
      notes: normalizeOptionalString(candidate.notes, 240) ?? fallback?.notes ?? null
    };
  }

  const rawX = normalizeUnit(candidate.x);
  const rawY = normalizeUnit(candidate.y);
  const rawWidth = normalizeUnit(candidate.width);
  const rawHeight = normalizeUnit(candidate.height);
  if (rawX === null || rawY === null || rawWidth === null || rawHeight === null) {
    return fallback;
  }

  const x = clamp(rawX, 0, 1 - MIN_CROP_SIDE);
  const y = clamp(rawY, 0, 1 - MIN_CROP_SIDE);
  const width = clamp(rawWidth, MIN_CROP_SIDE, 1 - x);
  const height = clamp(rawHeight, MIN_CROP_SIDE, 1 - y);
  const confidence = normalizeUnit(candidate.confidence);

  return {
    enabled: true,
    x: Number(x.toFixed(6)),
    y: Number(y.toFixed(6)),
    width: Number(width.toFixed(6)),
    height: Number(height.toFixed(6)),
    confidence,
    source: normalizeOptionalString(candidate.source, 80) ?? fallback?.source ?? null,
    reviewedAt: normalizeOptionalString(candidate.reviewedAt, 40) ?? fallback?.reviewedAt ?? null,
    notes: normalizeOptionalString(candidate.notes, 240) ?? fallback?.notes ?? null
  };
}

export function buildStage3SourceCropFfmpegFilter(crop: Stage3SourceCrop | null | undefined): string | null {
  const normalized = normalizeStage3SourceCrop(crop ?? null);
  if (!normalized?.enabled) {
    return null;
  }
  if (
    normalized.x <= 0.000001 &&
    normalized.y <= 0.000001 &&
    normalized.width >= 0.999999 &&
    normalized.height >= 0.999999
  ) {
    return null;
  }
  const x = normalized.x.toFixed(6);
  const y = normalized.y.toFixed(6);
  const width = normalized.width.toFixed(6);
  const height = normalized.height.toFixed(6);
  return [
    "crop=",
    `trunc(iw*${width}/2)*2`,
    `:trunc(ih*${height}/2)*2`,
    `:trunc(iw*${x}/2)*2`,
    `:trunc(ih*${y}/2)*2`
  ].join("");
}

