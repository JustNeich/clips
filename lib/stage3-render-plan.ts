import type { Stage3RenderPolicy, Stage3Segment } from "../app/components/types";
import { normalizeStage3EditorFragments } from "./stage3-editor-core";
import {
  normalizeStage3SegmentFocusOverride,
  normalizeStage3SegmentMirrorOverride,
  normalizeStage3SegmentZoomOverride
} from "./stage3-segment-transforms";

const STAGE3_SEGMENT_SPEED_SET = new Set<number>([1, 1.5, 2, 2.5, 3, 4, 5]);

export function normalizeStage3RenderPlanSegmentSpeed(value: unknown): Stage3Segment["speed"] {
  if (typeof value === "number" && Number.isFinite(value) && STAGE3_SEGMENT_SPEED_SET.has(value)) {
    return value as Stage3Segment["speed"];
  }
  return 1;
}

export function compareStage3SegmentsByTiming(
  left: Pick<Stage3Segment, "startSec" | "endSec" | "speed" | "label">,
  right: Pick<Stage3Segment, "startSec" | "endSec" | "speed" | "label">
): number {
  if (left.startSec !== right.startSec) {
    return left.startSec - right.startSec;
  }
  const leftEnd = left.endSec ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.endSec ?? Number.POSITIVE_INFINITY;
  if (leftEnd !== rightEnd) {
    return leftEnd - rightEnd;
  }
  if (left.speed !== right.speed) {
    return left.speed - right.speed;
  }
  return left.label.localeCompare(right.label);
}

export function normalizeStage3RenderPlanSegments(
  value: unknown,
  options?: { labelPrefix?: string }
): Stage3Segment[] {
  const labelPrefix = options?.labelPrefix?.trim() || "Фрагмент";
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map<Stage3Segment | null>((segment, index) => {
      if (!segment || typeof segment !== "object") {
        return null;
      }
      const startSec =
        typeof segment.startSec === "number" && Number.isFinite(segment.startSec)
          ? segment.startSec
          : null;
      const endSec =
        segment.endSec === null
          ? null
          : typeof segment.endSec === "number" && Number.isFinite(segment.endSec)
            ? segment.endSec
            : null;
      if (startSec === null) {
        return null;
      }
      return {
        startSec,
        endSec,
        speed: normalizeStage3RenderPlanSegmentSpeed((segment as { speed?: unknown }).speed),
        label:
          typeof segment.label === "string" && segment.label.trim()
            ? segment.label.trim()
            : `${labelPrefix} ${index + 1}`,
        focusY: normalizeStage3SegmentFocusOverride((segment as { focusY?: unknown }).focusY),
        videoZoom: normalizeStage3SegmentZoomOverride((segment as { videoZoom?: unknown }).videoZoom),
        mirrorEnabled: normalizeStage3SegmentMirrorOverride((segment as { mirrorEnabled?: unknown }).mirrorEnabled)
      };
    })
    .filter((segment): segment is Stage3Segment => segment !== null);
  return normalizeStage3EditorFragments({
    segments: normalized.sort(compareStage3SegmentsByTiming),
    sourceDurationSec: null,
    labelPrefix
  }).map((segment) => ({
    startSec: segment.startSec,
    endSec: segment.endSec,
    speed: normalizeStage3RenderPlanSegmentSpeed(segment.speed),
    label: segment.label,
    focusY: segment.focusYOverride,
    videoZoom: segment.videoZoomOverride,
    mirrorEnabled: segment.mirrorEnabledOverride
  }));
}

export function resolveCanonicalStage3RenderPolicy(params: {
  segments: Stage3Segment[];
  normalizeToTargetEnabled: boolean;
  requestedPolicy: Stage3RenderPolicy;
}): Stage3RenderPolicy {
  if (params.segments.length > 0) {
    return "fixed_segments";
  }
  if (params.normalizeToTargetEnabled) {
    return "full_source_normalize";
  }
  return params.requestedPolicy === "adaptive_window" ? "adaptive_window" : "fixed_segments";
}
