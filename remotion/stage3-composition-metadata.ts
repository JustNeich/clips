import {
  DEFAULT_STAGE3_CLIP_DURATION_SEC,
  normalizeStage3SourceFullDurationSec
} from "../lib/stage3-duration";

export const STAGE3_REMOTION_FPS = 30;

export type Stage3CompositionDurationProps = {
  clipDurationSec?: unknown;
};

export function resolveStage3CompositionDurationInFrames(
  clipDurationSec: unknown,
  fps = STAGE3_REMOTION_FPS
): number {
  const normalizedDurationSec = normalizeStage3SourceFullDurationSec(
    clipDurationSec,
    DEFAULT_STAGE3_CLIP_DURATION_SEC
  );
  return Math.max(1, Math.round(normalizedDurationSec * fps));
}

export function buildStage3CompositionMetadata(props: Stage3CompositionDurationProps) {
  return {
    fps: STAGE3_REMOTION_FPS,
    durationInFrames: resolveStage3CompositionDurationInFrames(props.clipDurationSec)
  };
}
