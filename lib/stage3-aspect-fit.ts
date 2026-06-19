// Deliberate aspect handling for the media region of a card template. The card
// WIDTH is fixed (we cannot narrow the plate), so the owner's rules are:
//   - bars top/bottom (content WIDER than the region) -> shrink the region HEIGHT
//     to the content aspect (Option A, preferred): the video fills it with no bars
//     and no distortion; the card simply gets shorter.
//   - bars left/right (content NARROWER than the region) -> we cannot change width,
//     so either zoom-to-fill (cover, crops a bounded amount top/bottom) or a SLIGHT
//     horizontal stretch (capped, "не переборщить").
// This is independent of the decorative background and of baked-in-bar stripping
// (see stage3-source-content-detect).

export type Stage3AspectFitMode = "cover" | "region_height" | "zoom" | "stretch";

export type Stage3AspectFitDecision = {
  mode: Stage3AspectFitMode;
  reason: string;
  // Render-plan patch fields the caller merges into renderPlan.
  patch: {
    videoFit: "cover" | "contain";
    mediaRegionHeightPx?: number;
    videoScaleX?: number;
  };
  // Diagnostics for logging / the judge.
  contentAspect: number;
  regionAspect: number;
  estimatedCoverCropFraction?: number;
};

export type Stage3AspectFitCaps = {
  // Aspect difference treated as "already fits" (no action).
  tolerance: number;
  // Max fraction of height a zoom-to-fill (cover) may crop before we avoid it.
  maxCoverCrop: number;
  // Max horizontal stretch factor allowed ("slight" stretch only).
  maxStretch: number;
  // Floor on how short the media region may become, as a fraction of its default.
  minRegionHeightFraction: number;
};

export const DEFAULT_STAGE3_ASPECT_FIT_CAPS: Stage3AspectFitCaps = {
  tolerance: 0.03,
  maxCoverCrop: 0.22,
  maxStretch: 1.1,
  minRegionHeightFraction: 0.45
};

function roundEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function resolveStage3AspectFit(params: {
  contentAspect: number;
  regionWidthPx: number;
  regionHeightPx: number;
  caps?: Partial<Stage3AspectFitCaps>;
}): Stage3AspectFitDecision {
  const caps = { ...DEFAULT_STAGE3_ASPECT_FIT_CAPS, ...(params.caps ?? {}) };
  const contentAspect = params.contentAspect;
  const regionAspect = params.regionWidthPx / params.regionHeightPx;

  const fallback: Stage3AspectFitDecision = {
    mode: "cover",
    reason: "content aspect ~ region aspect; cover fills cleanly",
    patch: { videoFit: "cover" },
    contentAspect,
    regionAspect
  };

  if (
    !Number.isFinite(contentAspect) ||
    contentAspect <= 0 ||
    !Number.isFinite(regionAspect) ||
    regionAspect <= 0
  ) {
    return fallback;
  }

  const relDiff = Math.abs(contentAspect - regionAspect) / regionAspect;
  if (relDiff <= caps.tolerance) {
    return fallback;
  }

  // Content WIDER than the region -> would letterbox top/bottom -> Option A.
  if (contentAspect > regionAspect) {
    const idealHeight = params.regionWidthPx / contentAspect;
    const minHeight = params.regionHeightPx * caps.minRegionHeightFraction;
    const clampedHeight = Math.max(minHeight, Math.min(params.regionHeightPx, idealHeight));
    return {
      mode: "region_height",
      reason: `content wider than region (${contentAspect.toFixed(2)} > ${regionAspect.toFixed(
        2
      )}); shrink media region height to ${Math.round(clampedHeight)}px (Option A)`,
      patch: { videoFit: "cover", mediaRegionHeightPx: roundEven(clampedHeight) },
      contentAspect,
      regionAspect
    };
  }

  // Content NARROWER than the region -> would pillarbox left/right.
  // cover fills the width and crops this fraction of the height:
  const coverCropFraction = 1 - contentAspect / regionAspect;
  if (coverCropFraction <= caps.maxCoverCrop) {
    return {
      mode: "zoom",
      reason: `content narrower than region (${contentAspect.toFixed(2)} < ${regionAspect.toFixed(
        2
      )}); cover crops ~${Math.round(coverCropFraction * 100)}% vertically (acceptable)`,
      patch: { videoFit: "cover" },
      contentAspect,
      regionAspect,
      estimatedCoverCropFraction: coverCropFraction
    };
  }

  // Cover would crop too much -> try a SLIGHT horizontal stretch instead.
  const stretchX = regionAspect / contentAspect;
  if (stretchX <= caps.maxStretch) {
    return {
      mode: "stretch",
      reason: `content narrower than region; slight horizontal stretch x${stretchX.toFixed(
        3
      )} (under cap ${caps.maxStretch})`,
      patch: { videoFit: "contain", videoScaleX: Number(stretchX.toFixed(3)) },
      contentAspect,
      regionAspect
    };
  }

  // Neither is clean (very narrow content): take the bounded zoom and report the
  // crop so the judge can veto. Do NOT stretch beyond the cap.
  return {
    mode: "zoom",
    reason: `content much narrower than region; zoom crops ~${Math.round(
      coverCropFraction * 100
    )}% (over soft cap, flagged for judge)`,
    patch: { videoFit: "cover" },
    contentAspect,
    regionAspect,
    estimatedCoverCropFraction: coverCropFraction
  };
}
