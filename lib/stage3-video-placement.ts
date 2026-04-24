import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "./stage3-constants";
import { clampStage3FocusX, clampStage3FocusY } from "./stage3-camera";

export type Stage3VideoPlacementStyle = {
  objectPosition: string;
  transform: string;
  transformOrigin: string;
};

export function buildStage3VideoPlacementStyle(input: {
  focusX: number;
  focusY: number;
  videoZoom?: number | null;
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
  const scaleX = input.mirrorEnabled ? -scale : scale;
  const xPercent = (focusX * 100).toFixed(3);
  const yPercent = (focusY * 100).toFixed(3);

  return {
    objectPosition: `${xPercent}% ${yPercent}%`,
    transform: `scale(${scaleX.toFixed(3)}, ${scale.toFixed(3)})`,
    transformOrigin: `${xPercent}% ${yPercent}%`
  };
}
