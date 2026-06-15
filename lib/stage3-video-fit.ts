export type Stage3VideoFit = "cover" | "contain";

export const DEFAULT_STAGE3_VIDEO_FIT: Stage3VideoFit = "cover";

export function normalizeStage3VideoFit(
  value: unknown,
  fallback: Stage3VideoFit = DEFAULT_STAGE3_VIDEO_FIT
): Stage3VideoFit {
  if (value === "cover" || value === "contain") {
    return value;
  }
  return fallback;
}
