import type {
  Stage3EditorSelectionMode,
  Stage3RenderPolicy,
  Stage3Segment,
  Stage3TimingMode
} from "../app/components/types";
import {
  buildStage3EditorSession,
  buildStage3EditorTimingKey,
  type Stage3EditorOutputPlan,
  type Stage3EditorOutputSegment
} from "./stage3-editor-core";
import { resolveStage3SegmentTransformState } from "./stage3-segment-transforms";

export type Stage3PlaybackSegment = Stage3EditorOutputSegment & {
  playbackRate: number;
};

export type Stage3PlaybackPlan = {
  targetDurationSec: Stage3EditorOutputPlan["targetDurationSec"];
  totalSelectedSourceDurationSec: Stage3EditorOutputPlan["totalSelectedSourceDurationSec"];
  totalBaseOutputDurationSec: Stage3EditorOutputPlan["totalBaseOutputDurationSec"];
  totalOutputDurationSec: Stage3EditorOutputPlan["totalOutputDurationSec"];
  durationScale: Stage3EditorOutputPlan["durationScale"];
  timingMode: Stage3EditorOutputPlan["timingMode"];
  segments: Stage3PlaybackSegment[];
};

export type Stage3PlaybackPosition = {
  segmentIndex: number;
  outputTimeSec: number;
  sourceTimeSec: number;
  playbackRate: number;
  segment: Stage3PlaybackSegment;
};

export type Stage3PlaybackSyncAction =
  | {
      kind: "position";
      position: Stage3PlaybackPosition;
    }
  | {
      kind: "seek";
      position: Stage3PlaybackPosition;
      reason: "before_segment" | "between_segments";
    }
  | {
      kind: "complete";
      position: Stage3PlaybackPosition;
      reason: "plan_end";
    };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildSegmentIndex(plan: Stage3PlaybackPlan, outputTimeSec: number): number {
  return Math.max(
    0,
    plan.segments.findIndex((segment, index) => {
      if (index === plan.segments.length - 1) {
        return outputTimeSec <= segment.outputEndSec + 0.001;
      }
      return outputTimeSec >= segment.outputStartSec && outputTimeSec < segment.outputEndSec;
    })
  );
}

export function buildStage3PlaybackPlan(params: {
  segments: Stage3Segment[];
  sourceDurationSec: number | null;
  clipStartSec: number;
  clipDurationSec: number;
  targetDurationSec: number;
  timingMode: Stage3TimingMode;
  policy: Stage3RenderPolicy;
  selectionMode?: Stage3EditorSelectionMode;
}): Stage3PlaybackPlan {
  const session = buildStage3EditorSession({
    rawSegments: params.segments,
    clipStartSec: params.clipStartSec,
    clipDurationSec: params.clipDurationSec,
    targetDurationSec: params.targetDurationSec,
    sourceDurationSec: params.sourceDurationSec,
    selectionMode:
      params.selectionMode === "window" || params.selectionMode === "fragments"
        ? params.selectionMode
        : params.segments.length > 0
          ? "fragments"
          : params.policy === "fixed_segments"
            ? "window"
            : "fragments",
    legacyRenderPolicy: params.policy,
    legacyNormalizeToTargetEnabled: params.timingMode === "compress" || params.timingMode === "stretch"
  });

  return {
    ...session.output,
    segments: session.output.segments.map((segment) => ({
      ...segment,
      playbackRate: segment.resolvedPlaybackRate
    }))
  };
}

export function buildStage3PlaybackTimingKey(plan: Stage3PlaybackPlan): string {
  return buildStage3EditorTimingKey({
    source: {
      selectionMode: "fragments",
      selectionKind: "fragments",
      sourceDurationSec: null,
      windowStartSec: plan.segments[0]?.sourceStartSec ?? 0,
      windowEndSec: plan.segments[plan.segments.length - 1]?.sourceEndSec ?? plan.targetDurationSec,
      fragments: plan.segments.map((segment) => ({
        label: segment.label,
        startSec: segment.sourceStartSec,
        endSec: segment.sourceEndSec,
        sourceDurationSec: segment.sourceDurationSec,
        speed: segment.speed,
        focusXOverride: segment.focusXOverride,
        focusYOverride: segment.focusYOverride,
        videoZoomOverride: segment.videoZoomOverride,
        mirrorEnabledOverride: segment.mirrorEnabledOverride
      })),
      totalSelectedSourceDurationSec: plan.totalSelectedSourceDurationSec,
      totalBaseOutputDurationSec: plan.totalBaseOutputDurationSec,
      coverageRanges: plan.segments.map((segment) => ({
        startSec: segment.sourceStartSec,
        endSec: segment.sourceEndSec
      }))
    },
    output: plan,
    renderPlanPatch: {
      segments: [],
      timingMode: plan.timingMode,
      normalizeToTargetEnabled: true,
      policy: "fixed_segments",
      editorSelectionMode: "fragments"
    }
  });
}

export function resolveStage3PlaybackPosition(
  plan: Stage3PlaybackPlan,
  rawOutputTimeSec: number
): Stage3PlaybackPosition | null {
  if (plan.segments.length === 0) {
    return null;
  }

  const maxOutputSec = Math.max(0, plan.totalOutputDurationSec);
  const outputTimeSec = clamp(rawOutputTimeSec, 0, maxOutputSec);
  const segmentIndex = buildSegmentIndex(plan, outputTimeSec);
  const segment = plan.segments[segmentIndex] ?? plan.segments[plan.segments.length - 1]!;
  const withinSegmentSec = clamp(outputTimeSec - segment.outputStartSec, 0, segment.outputDurationSec);
  const sourceTimeSec = clamp(
    segment.sourceStartSec + withinSegmentSec * segment.playbackRate,
    segment.sourceStartSec,
    segment.sourceEndSec
  );

  return {
    segmentIndex,
    outputTimeSec,
    sourceTimeSec,
    playbackRate: clamp(segment.playbackRate, 0.1, 16),
    segment
  };
}

function buildStage3PlaybackPositionFromSourceTime(
  plan: Stage3PlaybackPlan,
  segmentIndex: number,
  rawSourceTimeSec: number
): Stage3PlaybackPosition | null {
  const segment = plan.segments[segmentIndex];
  if (!segment) {
    return null;
  }
  const sourceTimeSec = clamp(rawSourceTimeSec, segment.sourceStartSec, segment.sourceEndSec);
  return {
    segmentIndex,
    outputTimeSec: mapStage3SourceTimeToOutputTime(segment, sourceTimeSec),
    sourceTimeSec,
    playbackRate: clamp(segment.playbackRate, 0.1, 16),
    segment
  };
}

function findStage3PlaybackSegmentIndexForSourceTime(params: {
  plan: Stage3PlaybackPlan;
  sourceTimeSec: number;
  preferredSegmentIndex: number;
  driftToleranceSec: number;
  transitionThresholdSec: number;
}): number {
  const clampedPreferredIndex = clamp(
    params.preferredSegmentIndex,
    0,
    Math.max(0, params.plan.segments.length - 1)
  );
  const preferredSegment = params.plan.segments[clampedPreferredIndex];
  const isWithinSegment = (segment: Stage3PlaybackSegment) =>
    params.sourceTimeSec >= segment.sourceStartSec - params.driftToleranceSec &&
    params.sourceTimeSec < segment.sourceEndSec - params.transitionThresholdSec;

  if (preferredSegment && isWithinSegment(preferredSegment)) {
    return clampedPreferredIndex;
  }

  return params.plan.segments.findIndex((segment) => isWithinSegment(segment));
}

export function resolveStage3PlaybackSyncAction(params: {
  plan: Stage3PlaybackPlan;
  sourceTimeSec: number;
  preferredSegmentIndex: number;
  driftToleranceSec?: number;
  transitionThresholdSec?: number;
}): Stage3PlaybackSyncAction | null {
  if (params.plan.segments.length === 0) {
    return null;
  }

  const driftToleranceSec = clamp(params.driftToleranceSec ?? 0.08, 0, 0.5);
  const transitionThresholdSec = clamp(params.transitionThresholdSec ?? 0.02, 0.001, 0.25);
  const sourceTimeSec = Math.max(0, Number.isFinite(params.sourceTimeSec) ? params.sourceTimeSec : 0);
  const preferredSegmentIndex = clamp(
    params.preferredSegmentIndex,
    0,
    Math.max(0, params.plan.segments.length - 1)
  );
  const preferredSegment = params.plan.segments[preferredSegmentIndex] ?? params.plan.segments[0]!;
  const containingSegmentIndex = findStage3PlaybackSegmentIndexForSourceTime({
    plan: params.plan,
    sourceTimeSec,
    preferredSegmentIndex,
    driftToleranceSec,
    transitionThresholdSec
  });

  if (containingSegmentIndex >= 0) {
    const position = buildStage3PlaybackPositionFromSourceTime(params.plan, containingSegmentIndex, sourceTimeSec);
    return position ? { kind: "position", position } : null;
  }

  if (sourceTimeSec < preferredSegment.sourceStartSec - driftToleranceSec) {
    const position = resolveStage3PlaybackPosition(params.plan, preferredSegment.outputStartSec);
    return position ? { kind: "seek", position, reason: "before_segment" } : null;
  }

  const nextSegmentIndex = params.plan.segments.findIndex(
    (segment) => sourceTimeSec < segment.sourceStartSec - driftToleranceSec
  );
  if (nextSegmentIndex >= 0) {
    const position = resolveStage3PlaybackPosition(
      params.plan,
      params.plan.segments[nextSegmentIndex]?.outputStartSec ?? 0
    );
    return position ? { kind: "seek", position, reason: "between_segments" } : null;
  }

  const position = resolveStage3PlaybackPosition(params.plan, params.plan.totalOutputDurationSec);
  return position ? { kind: "complete", position, reason: "plan_end" } : null;
}

export function resolveStage3PlaybackTransformState(params: {
  plan: Stage3PlaybackPlan;
  outputTimeSec: number;
  fallbackFocusX: number;
  fallbackFocusY: number;
  fallbackVideoZoom: number;
  fallbackMirrorEnabled: boolean;
}): {
  segmentIndex: number | null;
  focusX: number;
  focusY: number;
  videoZoom: number;
  mirrorEnabled: boolean;
} {
  const position = resolveStage3PlaybackPosition(params.plan, params.outputTimeSec);
  const effective = resolveStage3SegmentTransformState({
    segment: position?.segment
      ? {
          focusX: position.segment.focusXOverride,
          focusY: position.segment.focusYOverride,
          videoZoom: position.segment.videoZoomOverride,
          mirrorEnabled: position.segment.mirrorEnabledOverride
        }
      : null,
    fallbackFocusX: params.fallbackFocusX,
    fallbackFocusY: params.fallbackFocusY,
    fallbackVideoZoom: params.fallbackVideoZoom,
    fallbackMirrorEnabled: params.fallbackMirrorEnabled
  });
  return {
    segmentIndex: position?.segmentIndex ?? null,
    ...effective
  };
}

export function mapStage3SourceTimeToOutputTime(segment: Stage3PlaybackSegment, sourceTimeSec: number): number {
  return clamp(
    segment.outputStartSec + (sourceTimeSec - segment.sourceStartSec) / Math.max(0.1, segment.playbackRate),
    segment.outputStartSec,
    segment.outputEndSec
  );
}

export function applyStage3PlaybackPositionToVideo(
  video: HTMLVideoElement,
  position: Stage3PlaybackPosition,
  toleranceSec = 0.04
): void {
  if (Math.abs(video.playbackRate - position.playbackRate) > 0.001) {
    video.playbackRate = position.playbackRate;
  }
  if (Math.abs(video.currentTime - position.sourceTimeSec) > toleranceSec) {
    video.currentTime = position.sourceTimeSec;
  }
}
