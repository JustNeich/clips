import {
  Stage3RenderPolicy,
  Stage3Segment,
  STAGE3_SEGMENT_SPEED_OPTIONS,
  Stage3TimingMode
} from "../app/components/types";
import {
  normalizeStage3SegmentFocusOverride,
  normalizeStage3SegmentMirrorOverride,
  normalizeStage3SegmentZoomOverride,
  resolveStage3SegmentTransformState
} from "./stage3-segment-transforms";

const SEGMENT_SPEED_SET = new Set<number>(STAGE3_SEGMENT_SPEED_OPTIONS);

export type Stage3PlaybackSegment = {
  label: string;
  sourceStartSec: number;
  sourceEndSec: number;
  speed: number;
  focusYOverride: number | null;
  videoZoomOverride: number | null;
  mirrorEnabledOverride: boolean | null;
  outputStartSec: number;
  outputEndSec: number;
  outputDurationSec: number;
  playbackRate: number;
};

export type Stage3PlaybackPlan = {
  targetDurationSec: number;
  totalOutputDurationSec: number;
  durationScale: number;
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

function formatTimingKeyNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "nan";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeSegmentSpeed(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && SEGMENT_SPEED_SET.has(value)) {
    return value;
  }
  return 1;
}

function clampClipStart(rawStartSec: number, sourceDurationSec: number | null, clipDurationSec: number): number {
  if (!sourceDurationSec || sourceDurationSec <= clipDurationSec) {
    return 0;
  }
  return clamp(rawStartSec, 0, Math.max(0, sourceDurationSec - clipDurationSec));
}

function normalizeExplicitSegments(
  segments: Stage3Segment[],
  sourceDurationSec: number | null
): Array<{
  label: string;
  startSec: number;
  endSec: number;
  speed: number;
  focusYOverride: number | null;
  videoZoomOverride: number | null;
  mirrorEnabledOverride: boolean | null;
}> {
  return segments
    .map((segment, index) => {
      const startSec =
        typeof segment.startSec === "number" && Number.isFinite(segment.startSec)
          ? Math.max(0, segment.startSec)
          : null;
      if (startSec === null) {
        return null;
      }
      const rawEnd =
        segment.endSec === null
          ? sourceDurationSec ?? startSec + 0.5
          : typeof segment.endSec === "number" && Number.isFinite(segment.endSec)
            ? segment.endSec
            : startSec + 0.5;
      const cappedEnd =
        sourceDurationSec === null ? rawEnd : Math.min(Math.max(startSec + 0.1, rawEnd), sourceDurationSec);
      return {
        label:
          typeof segment.label === "string" && segment.label.trim()
            ? segment.label.trim()
            : `Фрагмент ${index + 1}`,
        startSec: roundToTenth(startSec),
        endSec: roundToTenth(Math.max(startSec + 0.1, cappedEnd)),
        speed: normalizeSegmentSpeed(segment.speed),
        focusYOverride: normalizeStage3SegmentFocusOverride(segment.focusY),
        videoZoomOverride: normalizeStage3SegmentZoomOverride(segment.videoZoom),
        mirrorEnabledOverride: normalizeStage3SegmentMirrorOverride(segment.mirrorEnabled)
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
    .sort((left, right) => left.startSec - right.startSec)
    .slice(0, 12);
}

function resolveBaseSegments(params: {
  segments: Stage3Segment[];
  sourceDurationSec: number | null;
  clipStartSec: number;
  clipDurationSec: number;
  policy: Stage3RenderPolicy;
}): Array<{
  label: string;
  startSec: number;
  endSec: number;
  speed: number;
  focusYOverride: number | null;
  videoZoomOverride: number | null;
  mirrorEnabledOverride: boolean | null;
}> {
  const explicit = normalizeExplicitSegments(params.segments, params.sourceDurationSec);
  if (explicit.length > 0) {
    return explicit;
  }

  const fallbackWindow = (): Array<{
    label: string;
    startSec: number;
    endSec: number;
    speed: number;
    focusYOverride: number | null;
    videoZoomOverride: number | null;
    mirrorEnabledOverride: boolean | null;
  }> => {
    const startSec = clampClipStart(params.clipStartSec, params.sourceDurationSec, params.clipDurationSec);
    const endSec = params.sourceDurationSec
      ? Math.min(params.sourceDurationSec, startSec + params.clipDurationSec)
      : startSec + params.clipDurationSec;
    return [
      {
        label: "Основной фрагмент",
        startSec,
        endSec: Math.max(startSec + 0.05, endSec),
        speed: 1,
        focusYOverride: null,
        videoZoomOverride: null,
        mirrorEnabledOverride: null
      }
    ];
  };

  if (params.policy === "full_source_normalize") {
    if (params.sourceDurationSec && params.sourceDurationSec > 0.05) {
      return [
        {
          label: "Полный исходник",
          startSec: 0,
          endSec: params.sourceDurationSec,
          speed: 1,
          focusYOverride: null,
          videoZoomOverride: null,
          mirrorEnabledOverride: null
        }
      ];
    }
    return fallbackWindow();
  }

  if (params.policy === "adaptive_window") {
    if (!params.sourceDurationSec || params.sourceDurationSec <= params.clipDurationSec) {
      return fallbackWindow();
    }

    let windowDuration = params.clipDurationSec;
    if (params.sourceDurationSec <= 12) {
      windowDuration = params.sourceDurationSec;
    } else if (params.sourceDurationSec <= 20) {
      windowDuration = clamp(params.sourceDurationSec * 0.55, 8, 12);
    }
    windowDuration = clamp(windowDuration, params.clipDurationSec, params.sourceDurationSec);

    const startSec = clamp(params.clipStartSec, 0, Math.max(0, params.sourceDurationSec - windowDuration));
    return [
      {
        label: "Адаптивное окно",
        startSec,
        endSec: startSec + windowDuration,
        speed: 1,
        focusYOverride: null,
        videoZoomOverride: null,
        mirrorEnabledOverride: null
      }
    ];
  }

  return fallbackWindow();
}

function resolveDurationScale(totalOutputDurationSec: number, targetDurationSec: number, timingMode: Stage3TimingMode): number {
  if (Math.abs(totalOutputDurationSec - targetDurationSec) <= 0.005) {
    return 1;
  }

  const requiresCompression = totalOutputDurationSec > targetDurationSec + 0.005;
  const requiresStretch = totalOutputDurationSec < targetDurationSec - 0.005;
  if (timingMode === "compress" && !requiresCompression) {
    return 1;
  }
  if (timingMode === "stretch" && !requiresStretch) {
    return 1;
  }
  return targetDurationSec / Math.max(0.05, totalOutputDurationSec);
}

export function buildStage3PlaybackPlan(params: {
  segments: Stage3Segment[];
  sourceDurationSec: number | null;
  clipStartSec: number;
  clipDurationSec: number;
  targetDurationSec: number;
  timingMode: Stage3TimingMode;
  policy: Stage3RenderPolicy;
}): Stage3PlaybackPlan {
  const baseSegments = resolveBaseSegments({
    segments: params.segments,
    sourceDurationSec: params.sourceDurationSec,
    clipStartSec: params.clipStartSec,
    clipDurationSec: params.clipDurationSec,
    policy: params.policy
  });

  const totalOutputDurationSec = baseSegments.reduce((total, segment) => {
    return total + Math.max(0.05, segment.endSec - segment.startSec) / Math.max(0.1, segment.speed);
  }, 0);
  const durationScale = resolveDurationScale(totalOutputDurationSec, params.targetDurationSec, params.timingMode);

  let cursor = 0;
  const segments = baseSegments.map((segment) => {
    const sourceDurationSec = Math.max(0.05, segment.endSec - segment.startSec);
    const normalizedOutputDurationSec = (sourceDurationSec / Math.max(0.1, segment.speed)) * durationScale;
    const outputStartSec = cursor;
    const outputEndSec = outputStartSec + normalizedOutputDurationSec;
    cursor = outputEndSec;
    return {
      label: segment.label,
      sourceStartSec: segment.startSec,
      sourceEndSec: segment.endSec,
      speed: segment.speed,
      focusYOverride: segment.focusYOverride,
      videoZoomOverride: segment.videoZoomOverride,
      mirrorEnabledOverride: segment.mirrorEnabledOverride,
      outputStartSec,
      outputEndSec,
      outputDurationSec: normalizedOutputDurationSec,
      playbackRate: segment.speed / durationScale
    };
  });

  return {
    targetDurationSec: params.targetDurationSec,
    totalOutputDurationSec: cursor,
    durationScale,
    segments
  };
}

export function buildStage3PlaybackTimingKey(plan: Stage3PlaybackPlan): string {
  return [
    formatTimingKeyNumber(plan.targetDurationSec),
    formatTimingKeyNumber(plan.totalOutputDurationSec),
    formatTimingKeyNumber(plan.durationScale),
    ...plan.segments.map((segment) =>
      [
        formatTimingKeyNumber(segment.sourceStartSec),
        formatTimingKeyNumber(segment.sourceEndSec),
        formatTimingKeyNumber(segment.speed),
        formatTimingKeyNumber(segment.outputStartSec),
        formatTimingKeyNumber(segment.outputEndSec),
        formatTimingKeyNumber(segment.outputDurationSec),
        formatTimingKeyNumber(segment.playbackRate)
      ].join(":")
    )
  ].join("|");
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
  const segmentIndex =
    plan.segments.findIndex((segment, index) => {
      if (index === plan.segments.length - 1) {
        return outputTimeSec <= segment.outputEndSec + 0.001;
      }
      return outputTimeSec >= segment.outputStartSec && outputTimeSec < segment.outputEndSec;
    }) ?? -1;
  const segment = plan.segments[Math.max(0, segmentIndex)] ?? plan.segments[plan.segments.length - 1];
  const withinSegmentSec = clamp(outputTimeSec - segment.outputStartSec, 0, segment.outputDurationSec);
  const sourceTimeSec = clamp(
    segment.sourceStartSec + withinSegmentSec * segment.playbackRate,
    segment.sourceStartSec,
    segment.sourceEndSec
  );

  return {
    segmentIndex: Math.max(0, segmentIndex),
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
  const preferredSegment = params.plan.segments[preferredSegmentIndex] ?? params.plan.segments[0];
  const containingSegmentIndex = findStage3PlaybackSegmentIndexForSourceTime({
    plan: params.plan,
    sourceTimeSec,
    preferredSegmentIndex,
    driftToleranceSec,
    transitionThresholdSec
  });

  if (containingSegmentIndex >= 0) {
    const position = buildStage3PlaybackPositionFromSourceTime(
      params.plan,
      containingSegmentIndex,
      sourceTimeSec
    );
    return position
      ? {
          kind: "position",
          position
        }
      : null;
  }

  if (sourceTimeSec < preferredSegment.sourceStartSec - driftToleranceSec) {
    const position = resolveStage3PlaybackPosition(params.plan, preferredSegment.outputStartSec);
    return position
      ? {
          kind: "seek",
          position,
          reason: "before_segment"
        }
      : null;
  }

  const nextSegmentIndex = params.plan.segments.findIndex(
    (segment) => sourceTimeSec < segment.sourceStartSec - driftToleranceSec
  );
  if (nextSegmentIndex >= 0) {
    const position = resolveStage3PlaybackPosition(
      params.plan,
      params.plan.segments[nextSegmentIndex]?.outputStartSec ?? 0
    );
    return position
      ? {
          kind: "seek",
          position,
          reason: "between_segments"
        }
      : null;
  }

  const position = resolveStage3PlaybackPosition(params.plan, params.plan.totalOutputDurationSec);
  return position
    ? {
        kind: "complete",
        position,
        reason: "plan_end"
      }
    : null;
}

export function resolveStage3PlaybackTransformState(params: {
  plan: Stage3PlaybackPlan;
  outputTimeSec: number;
  fallbackFocusY: number;
  fallbackVideoZoom: number;
  fallbackMirrorEnabled: boolean;
}): {
  segmentIndex: number | null;
  focusY: number;
  videoZoom: number;
  mirrorEnabled: boolean;
} {
  const position = resolveStage3PlaybackPosition(params.plan, params.outputTimeSec);
  const effective = resolveStage3SegmentTransformState({
    segment: position?.segment
      ? {
          focusY: position.segment.focusYOverride,
          videoZoom: position.segment.videoZoomOverride,
          mirrorEnabled: position.segment.mirrorEnabledOverride
        }
      : null,
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
