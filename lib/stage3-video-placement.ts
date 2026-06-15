import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "./stage3-constants";
import { clampStage3FocusX, clampStage3FocusY } from "./stage3-camera";
import { normalizeStage3VideoScaleX, normalizeStage3VideoScaleY } from "./stage3-video-scale";
import {
  normalizeStage3VideoFit,
  type Stage3VideoFit
} from "./stage3-video-fit";

export type Stage3VideoPlacementStyle = {
  objectFit: Stage3VideoFit;
  objectPosition: string;
  transform: string;
  transformOrigin: string;
};

const POSITION_CENTER = 0.5;

function buildTranslatePercent(focus: number, scale: number): number {
  const maxTranslatePercent = Math.max(0, (scale - 1) * 50);
  return (POSITION_CENTER - focus) * 2 * maxTranslatePercent;
}

export function buildStage3VideoPlacementStyle(input: {
  focusX: number;
  focusY: number;
  videoZoom?: number | null;
  videoScaleY?: number | null;
  videoScaleX?: number | null;
  videoFit?: unknown;
  mirrorEnabled?: boolean | null;
  extraScale?: number;
}): Stage3VideoPlacementStyle {
  const focusX = clampStage3FocusX(
    typeof input.focusX === "number" && Number.isFinite(input.focusX) ? input.focusX : 0.5
  );
  const focusY = clampStage3FocusY(
    typeof input.focusY === "number" && Number.isFinite(input.focusY) ? input.focusY : 0.5
  );
  const zoom = Math.min(
    STAGE3_MAX_VIDEO_ZOOM,
    Math.max(STAGE3_MIN_VIDEO_ZOOM, Number.isFinite(input.videoZoom ?? NaN) ? input.videoZoom! : 1)
  );
  const extraScale =
    typeof input.extraScale === "number" && Number.isFinite(input.extraScale) && input.extraScale > 0
      ? input.extraScale
      : 1;
  const scale = zoom * extraScale;
  const scaleY = scale * normalizeStage3VideoScaleY(input.videoScaleY);
  const baseScaleX = scale * normalizeStage3VideoScaleX(input.videoScaleX);
  const scaleX = input.mirrorEnabled ? -baseScaleX : baseScaleX;
  const xPercent = (focusX * 100).toFixed(3);
  const yPercent = (focusY * 100).toFixed(3);
  const translateX = buildTranslatePercent(focusX, baseScaleX);
  const translateY = buildTranslatePercent(focusY, scaleY);
  const transformTranslate = `translate(${translateX.toFixed(3)}%, ${translateY.toFixed(3)}%)`;
  const transformScale = `scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`;

  return {
    objectFit: normalizeStage3VideoFit(input.videoFit),
    objectPosition: `${xPercent}% ${yPercent}%`,
    transform: `${transformTranslate} ${transformScale}`,
    transformOrigin: "center center"
  };
}
