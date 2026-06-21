import type { TemplateRenderSnapshot } from "./stage3-template-core";

export const STAGE3_MAX_GEOMETRY_STRETCH = 1.08;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function makeEven(value: number, fallback = 2): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(2, Math.round(value / 2) * 2);
}

export function normalizeStage3MediaRegionHeightPx(
  value: unknown,
  defaultRegionHeightPx: number
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (!Number.isFinite(defaultRegionHeightPx) || defaultRegionHeightPx <= 0) {
    return makeEven(Math.max(2, value));
  }
  const defaultHeight = makeEven(defaultRegionHeightPx);
  return makeEven(clamp(value, 2, defaultHeight), defaultHeight);
}

export function normalizeStage3GeometryScale(value: unknown, fallback = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Number(clamp(value, 0.5, STAGE3_MAX_GEOMETRY_STRETCH).toFixed(3));
}

export function resolveStage3EffectiveMediaGeometry(input: {
  regionWidthPx: number;
  regionHeightPx: number;
  mediaRegionHeightPx?: unknown;
  videoScaleX?: unknown;
  videoScaleY?: unknown;
}): {
  regionWidthPx: number;
  regionHeightPx: number;
  cropAspect: number;
  slotAspect: number;
  videoScaleX: number;
  videoScaleY: number;
} {
  const regionWidthPx = makeEven(input.regionWidthPx);
  const defaultRegionHeightPx = makeEven(input.regionHeightPx);
  const regionHeightPx =
    normalizeStage3MediaRegionHeightPx(input.mediaRegionHeightPx, defaultRegionHeightPx) ??
    defaultRegionHeightPx;
  const videoScaleX = normalizeStage3GeometryScale(input.videoScaleX);
  const videoScaleY = normalizeStage3GeometryScale(input.videoScaleY);
  const slotAspect = regionWidthPx / Math.max(1, regionHeightPx);
  const cropAspect = slotAspect * (videoScaleY / Math.max(0.001, videoScaleX));

  return {
    regionWidthPx,
    regionHeightPx,
    cropAspect,
    slotAspect,
    videoScaleX,
    videoScaleY
  };
}

export function applyStage3MediaGeometryToTemplateSnapshot(
  snapshot: TemplateRenderSnapshot,
  mediaRegionHeightPx: unknown
): TemplateRenderSnapshot {
  const height = normalizeStage3MediaRegionHeightPx(mediaRegionHeightPx, snapshot.layout.media.height);
  if (height === null || height === snapshot.layout.media.height) {
    return snapshot;
  }

  const delta = snapshot.layout.media.height - height;
  // The owner's rule: the WHOLE CARD gets shorter (top & bottom panels move
  // closer, media fits the source) — NOT "grow the bottom panel" and NOT "leave
  // an empty white band". We shrink the card by the freed media height and
  // RE-CENTER it: the top half of the card (card frame, top panel, media) slides
  // DOWN by delta/2 and the bottom group (bottom panel, author, avatar, bottom
  // text) slides UP by delta/2, so the shorter card stays balanced in frame.
  const half = Math.round(delta / 2);
  const shiftDown = <T extends { y: number }>(rect: T): T => ({ ...rect, y: rect.y + half });
  const shiftUp = <T extends { y: number }>(rect: T): T => ({ ...rect, y: rect.y - half });
  const card = snapshot.layout.card
    ? { ...snapshot.layout.card, y: snapshot.layout.card.y + half, height: snapshot.layout.card.height - delta }
    : snapshot.layout.card;

  return {
    ...snapshot,
    snapshotHash: `${snapshot.snapshotHash}:media-region-${height}`,
    computed: {
      ...snapshot.computed,
      videoHeight: height
    },
    layout: {
      ...snapshot.layout,
      ...(card ? { card } : {}),
      top: shiftDown(snapshot.layout.top),
      media: {
        ...shiftDown(snapshot.layout.media),
        height
      },
      bottom: shiftUp(snapshot.layout.bottom),
      author: shiftUp(snapshot.layout.author),
      avatar: shiftUp(snapshot.layout.avatar),
      bottomText: shiftUp(snapshot.layout.bottomText)
    }
  };
}
