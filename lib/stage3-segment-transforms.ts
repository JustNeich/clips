import { Stage3Segment } from "../app/components/types";
import { clampStage3CameraZoom, clampStage3FocusY } from "./stage3-camera";

export type Stage3SegmentTransformState = {
  focusY: number;
  videoZoom: number;
  mirrorEnabled: boolean;
};

export function normalizeStage3SegmentFocusOverride(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Number(clampStage3FocusY(value).toFixed(4));
}

export function normalizeStage3SegmentZoomOverride(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Number(clampStage3CameraZoom(value).toFixed(4));
}

export function normalizeStage3SegmentMirrorOverride(value: unknown): boolean | null {
  if (typeof value !== "boolean") {
    return null;
  }
  return value;
}

export function resolveStage3SegmentTransformState(params: {
  segment?: Partial<Stage3Segment> | null;
  fallbackFocusY: number;
  fallbackVideoZoom: number;
  fallbackMirrorEnabled: boolean;
}): Stage3SegmentTransformState {
  return {
    focusY: normalizeStage3SegmentFocusOverride(params.segment?.focusY) ?? clampStage3FocusY(params.fallbackFocusY),
    videoZoom:
      normalizeStage3SegmentZoomOverride(params.segment?.videoZoom) ?? clampStage3CameraZoom(params.fallbackVideoZoom),
    mirrorEnabled:
      normalizeStage3SegmentMirrorOverride(params.segment?.mirrorEnabled) ?? params.fallbackMirrorEnabled
  };
}
