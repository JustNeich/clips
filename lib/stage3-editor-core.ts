import type {
  Stage3EditorSelectionMode,
  Stage3RenderPlan,
  Stage3RenderPolicy,
  Stage3Segment,
  Stage3TimingMode
} from "../app/components/types";
import {
  DEFAULT_STAGE3_CLIP_DURATION_SEC,
  normalizeStage3ClipDurationSec
} from "./stage3-duration";

const MIN_EDITOR_TIMING_GUARD_SEC = 0.1;
export const STAGE3_EDITOR_MIN_SELECTION_DURATION_SEC = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundToThousandth(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function resolveFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function resolveStage3EditorMinimumSelectionDurationSec(sourceDurationSec: number | null): number {
  if (sourceDurationSec !== null && sourceDurationSec > 0) {
    return Math.min(STAGE3_EDITOR_MIN_SELECTION_DURATION_SEC, sourceDurationSec);
  }
  return STAGE3_EDITOR_MIN_SELECTION_DURATION_SEC;
}

function resolveSourceUpperBound(sourceDurationSec: number | null, fallback: number, minimumDurationSec: number): number {
  if (sourceDurationSec !== null && sourceDurationSec > 0) {
    return sourceDurationSec;
  }
  return Math.max(minimumDurationSec, fallback);
}

function finalizeNormalizedEditorRange(params: {
  startSec: number;
  endSec: number;
  sourceDurationSec: number | null;
  minimumDurationSec: number;
}): { startSec: number; endSec: number; sourceDurationSec: number } {
  const upperBound = resolveSourceUpperBound(
    params.sourceDurationSec,
    params.endSec,
    params.minimumDurationSec
  );
  let startSec = roundToTenth(params.startSec);
  let endSec = roundToTenth(params.endSec);

  if (endSec - startSec < params.minimumDurationSec - 0.0001) {
    endSec = roundToTenth(Math.min(upperBound, startSec + params.minimumDurationSec));
  }
  if (endSec - startSec < params.minimumDurationSec - 0.0001) {
    startSec = roundToTenth(Math.max(0, endSec - params.minimumDurationSec));
  }
  if (endSec - startSec < params.minimumDurationSec - 0.0001) {
    endSec = roundToTenth(Math.min(upperBound, startSec + params.minimumDurationSec));
  }

  return {
    startSec,
    endSec,
    sourceDurationSec: roundToThousandth(Math.max(MIN_EDITOR_TIMING_GUARD_SEC, endSec - startSec))
  };
}

function resolveSelectionKind(params: {
  rawSegments: Stage3Segment[];
  selectionMode?: Stage3EditorSelectionMode | null;
  legacyRenderPolicy?: Stage3RenderPolicy | null;
  legacyNormalizeToTargetEnabled?: boolean;
}): "window" | "fragments" | "legacy_full_source" | "legacy_adaptive_window" {
  if (params.selectionMode === "fragments" && params.rawSegments.length > 0) {
    return "fragments";
  }
  if (params.selectionMode === "window") {
    return "window";
  }
  if (params.rawSegments.length > 0) {
    return "fragments";
  }
  if (params.legacyRenderPolicy === "full_source_normalize" || params.legacyNormalizeToTargetEnabled) {
    return "legacy_full_source";
  }
  if (params.legacyRenderPolicy === "adaptive_window") {
    return "legacy_adaptive_window";
  }
  return "window";
}

function resolveAdaptiveWindow(params: {
  clipStartSec: number;
  clipDurationSec: number;
  sourceDurationSec: number | null;
}): { startSec: number; endSec: number } {
  const sourceDuration = params.sourceDurationSec;
  if (!sourceDuration || sourceDuration <= params.clipDurationSec) {
    return {
      startSec: 0,
      endSec: Math.max(params.clipDurationSec, sourceDuration ?? params.clipDurationSec)
    };
  }

  let windowDuration = params.clipDurationSec;
  if (sourceDuration <= 12) {
    windowDuration = sourceDuration;
  } else if (sourceDuration <= 20) {
    windowDuration = clamp(sourceDuration * 0.55, 8, 12);
  }
  windowDuration = clamp(windowDuration, params.clipDurationSec, sourceDuration);

  const startSec = clamp(params.clipStartSec, 0, Math.max(0, sourceDuration - windowDuration));
  return {
    startSec: roundToTenth(startSec),
    endSec: roundToTenth(startSec + windowDuration)
  };
}

export type Stage3EditorFragment = {
  label: string;
  startSec: number;
  endSec: number;
  sourceDurationSec: number;
  speed: Stage3Segment["speed"];
  focusYOverride: number | null;
  videoZoomOverride: number | null;
  mirrorEnabledOverride: boolean | null;
};

export type Stage3EditorSourceSelection = {
  selectionMode: Stage3EditorSelectionMode;
  selectionKind: "window" | "fragments" | "legacy_full_source" | "legacy_adaptive_window";
  sourceDurationSec: number | null;
  windowStartSec: number;
  windowEndSec: number;
  fragments: Stage3EditorFragment[];
  totalSelectedSourceDurationSec: number;
  totalBaseOutputDurationSec: number;
  coverageRanges: Array<{ startSec: number; endSec: number }>;
};

export type Stage3EditorOutputSegment = {
  label: string;
  sourceStartSec: number;
  sourceEndSec: number;
  sourceDurationSec: number;
  speed: Stage3Segment["speed"];
  focusYOverride: number | null;
  videoZoomOverride: number | null;
  mirrorEnabledOverride: boolean | null;
  outputStartSec: number;
  outputEndSec: number;
  outputDurationSec: number;
  resolvedPlaybackRate: number;
};

export type Stage3EditorOutputPlan = {
  targetDurationSec: number;
  totalSelectedSourceDurationSec: number;
  totalBaseOutputDurationSec: number;
  totalOutputDurationSec: number;
  durationScale: number;
  timingMode: Stage3TimingMode;
  segments: Stage3EditorOutputSegment[];
};

export type Stage3EditorSession = {
  source: Stage3EditorSourceSelection;
  output: Stage3EditorOutputPlan;
  renderPlanPatch: Pick<
    Stage3RenderPlan,
    "segments" | "timingMode" | "normalizeToTargetEnabled" | "policy" | "editorSelectionMode"
  >;
};

export type Stage3EditorTransportState = {
  sessionKey: string;
  activeSegmentIndex: number;
  lastPublishedOutputSec: number;
  pendingSourceSeekSec: number | null;
  status: "idle" | "seeking" | "playing" | "paused" | "completed";
};

export function normalizeStage3EditorFragments(params: {
  segments: Stage3Segment[];
  sourceDurationSec: number | null;
  labelPrefix?: string;
}): Stage3EditorFragment[] {
  const labelPrefix = params.labelPrefix?.trim() || "Фрагмент";
  const minimumDurationSec = resolveStage3EditorMinimumSelectionDurationSec(params.sourceDurationSec);
  const normalized = params.segments
    .map((segment, index) => {
      const startSec = resolveFiniteNumber(segment.startSec);
      if (startSec === null) {
        return null;
      }
      const normalizedStartSec =
        params.sourceDurationSec !== null && params.sourceDurationSec > 0
          ? clamp(Math.max(0, startSec), 0, Math.max(0, params.sourceDurationSec - minimumDurationSec))
          : Math.max(0, startSec);
      const fallbackEndSec = normalizedStartSec + minimumDurationSec;
      const rawEndSec =
        segment.endSec === null
          ? params.sourceDurationSec ?? fallbackEndSec
          : resolveFiniteNumber(segment.endSec) ?? fallbackEndSec;
      const upperBound = resolveSourceUpperBound(
        params.sourceDurationSec,
        Math.max(fallbackEndSec, rawEndSec),
        minimumDurationSec
      );
      const endSec = clamp(rawEndSec, normalizedStartSec + minimumDurationSec, upperBound);
      const normalizedRange = finalizeNormalizedEditorRange({
        startSec: normalizedStartSec,
        endSec,
        sourceDurationSec: params.sourceDurationSec,
        minimumDurationSec
      });
      return {
        label:
          typeof segment.label === "string" && segment.label.trim()
            ? segment.label.trim()
            : `${labelPrefix} ${index + 1}`,
        startSec: normalizedRange.startSec,
        endSec: normalizedRange.endSec,
        sourceDurationSec: normalizedRange.sourceDurationSec,
        speed: segment.speed,
        focusYOverride:
          typeof segment.focusY === "number" && Number.isFinite(segment.focusY) ? segment.focusY : null,
        videoZoomOverride:
          typeof segment.videoZoom === "number" && Number.isFinite(segment.videoZoom) ? segment.videoZoom : null,
        mirrorEnabledOverride:
          typeof segment.mirrorEnabled === "boolean" ? segment.mirrorEnabled : null
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => segment !== null)
    .sort((left, right) => {
      if (left.startSec !== right.startSec) {
        return left.startSec - right.startSec;
      }
      if (left.endSec !== right.endSec) {
        return left.endSec - right.endSec;
      }
      return left.label.localeCompare(right.label);
    })
    .slice(0, 12);

  const nonOverlapping: Stage3EditorFragment[] = [];
  for (const fragment of normalized) {
    const last = nonOverlapping[nonOverlapping.length - 1];
    const startSec = last ? Math.max(fragment.startSec, last.endSec) : fragment.startSec;
    const upperBound = resolveSourceUpperBound(params.sourceDurationSec, fragment.endSec, minimumDurationSec);
    const endSec = clamp(fragment.endSec, startSec + minimumDurationSec, upperBound);
    if (endSec - startSec < minimumDurationSec - 0.0001) {
      continue;
    }
    const normalizedRange = finalizeNormalizedEditorRange({
      startSec,
      endSec,
      sourceDurationSec: params.sourceDurationSec,
      minimumDurationSec
    });
    nonOverlapping.push({
      ...fragment,
      startSec: normalizedRange.startSec,
      endSec: normalizedRange.endSec,
      sourceDurationSec: normalizedRange.sourceDurationSec
    });
  }

  return nonOverlapping.map((fragment, index) => ({
    ...fragment,
    label: fragment.label || `${labelPrefix} ${index + 1}`
  }));
}

function buildCoverageRanges(fragments: Stage3EditorFragment[]): Array<{ startSec: number; endSec: number }> {
  if (fragments.length === 0) {
    return [];
  }
  const ranges: Array<{ startSec: number; endSec: number }> = [];
  for (const fragment of fragments) {
    const last = ranges[ranges.length - 1];
    if (last && fragment.startSec <= last.endSec + 0.001) {
      last.endSec = Math.max(last.endSec, fragment.endSec);
      continue;
    }
    ranges.push({
      startSec: fragment.startSec,
      endSec: fragment.endSec
    });
  }
  return ranges;
}

function buildWindowFragment(params: {
  clipStartSec: number;
  clipDurationSec: number;
  sourceDurationSec: number | null;
}): Stage3EditorFragment {
  const minimumDurationSec = resolveStage3EditorMinimumSelectionDurationSec(params.sourceDurationSec);
  const sourceDuration = params.sourceDurationSec;
  const startUpperBound =
    sourceDuration && sourceDuration > params.clipDurationSec
      ? Math.max(0, sourceDuration - Math.max(params.clipDurationSec, minimumDurationSec))
      : 0;
  const startSec = sourceDuration ? clamp(params.clipStartSec, 0, startUpperBound) : Math.max(0, params.clipStartSec);
  const rawEndSec = sourceDuration ? Math.min(sourceDuration, startSec + params.clipDurationSec) : startSec + params.clipDurationSec;
  const endSec = Math.max(startSec + minimumDurationSec, rawEndSec);
  const normalizedRange = finalizeNormalizedEditorRange({
    startSec,
    endSec,
    sourceDurationSec: params.sourceDurationSec,
    minimumDurationSec
  });
  return {
    label: "Основной фрагмент",
    startSec: normalizedRange.startSec,
    endSec: normalizedRange.endSec,
    sourceDurationSec: normalizedRange.sourceDurationSec,
    speed: 1,
    focusYOverride: null,
    videoZoomOverride: null,
    mirrorEnabledOverride: null
  };
}

function buildSourceSelection(params: {
  rawSegments: Stage3Segment[];
  selectionMode?: Stage3EditorSelectionMode | null;
  legacyRenderPolicy?: Stage3RenderPolicy | null;
  legacyNormalizeToTargetEnabled?: boolean;
  clipStartSec: number;
  clipDurationSec: number;
  sourceDurationSec: number | null;
}): Stage3EditorSourceSelection {
  const selectionKind = resolveSelectionKind({
    rawSegments: params.rawSegments,
    selectionMode: params.selectionMode,
    legacyRenderPolicy: params.legacyRenderPolicy,
    legacyNormalizeToTargetEnabled: params.legacyNormalizeToTargetEnabled
  });
  const explicitFragments = normalizeStage3EditorFragments({
    segments: params.rawSegments,
    sourceDurationSec: params.sourceDurationSec
  });

  let fragments: Stage3EditorFragment[] = [];
  if (selectionKind === "fragments" && explicitFragments.length > 0) {
    fragments = explicitFragments;
  } else if (selectionKind === "legacy_full_source") {
    const sourceDuration = params.sourceDurationSec ?? params.clipDurationSec;
    fragments = [
      {
        label: "Полный исходник",
        startSec: 0,
        endSec: roundToTenth(Math.max(params.clipDurationSec, sourceDuration)),
        sourceDurationSec: roundToThousandth(Math.max(MIN_EDITOR_TIMING_GUARD_SEC, sourceDuration)),
        speed: 1,
        focusYOverride: null,
        videoZoomOverride: null,
        mirrorEnabledOverride: null
      }
    ];
  } else if (selectionKind === "legacy_adaptive_window") {
    const adaptiveWindow = resolveAdaptiveWindow({
      clipStartSec: params.clipStartSec,
      clipDurationSec: params.clipDurationSec,
      sourceDurationSec: params.sourceDurationSec
    });
    fragments = [
      {
        label: "Адаптивное окно",
        startSec: adaptiveWindow.startSec,
        endSec: adaptiveWindow.endSec,
        sourceDurationSec: roundToThousandth(
          Math.max(MIN_EDITOR_TIMING_GUARD_SEC, adaptiveWindow.endSec - adaptiveWindow.startSec)
        ),
        speed: 1,
        focusYOverride: null,
        videoZoomOverride: null,
        mirrorEnabledOverride: null
      }
    ];
  } else {
    fragments = [
      explicitFragments[0] ??
        buildWindowFragment({
          clipStartSec: params.clipStartSec,
          clipDurationSec: params.clipDurationSec,
          sourceDurationSec: params.sourceDurationSec
        })
    ];
  }

  const coverageRanges = buildCoverageRanges(fragments);
  const windowStartSec = coverageRanges[0]?.startSec ?? 0;
  const windowEndSec = coverageRanges[coverageRanges.length - 1]?.endSec ?? params.clipDurationSec;
  const totalSelectedSourceDurationSec = fragments.reduce((total, fragment) => total + fragment.sourceDurationSec, 0);
  const totalBaseOutputDurationSec = fragments.reduce(
    (total, fragment) => total + fragment.sourceDurationSec / Math.max(0.1, fragment.speed),
    0
  );

  return {
    selectionMode: selectionKind === "window" ? "window" : "fragments",
    selectionKind,
    sourceDurationSec: params.sourceDurationSec,
    windowStartSec,
    windowEndSec,
    fragments,
    totalSelectedSourceDurationSec: roundToThousandth(totalSelectedSourceDurationSec),
    totalBaseOutputDurationSec: roundToThousandth(totalBaseOutputDurationSec),
    coverageRanges
  };
}

function buildOutputPlan(params: {
  source: Stage3EditorSourceSelection;
  targetDurationSec: number;
}): Stage3EditorOutputPlan {
  const targetDurationSec = normalizeStage3ClipDurationSec(
    params.targetDurationSec,
    DEFAULT_STAGE3_CLIP_DURATION_SEC
  );
  const totalBaseOutputDurationSec = Math.max(
    MIN_EDITOR_TIMING_GUARD_SEC,
    params.source.totalBaseOutputDurationSec || targetDurationSec
  );
  const durationScale = targetDurationSec / totalBaseOutputDurationSec;
  const timingMode =
    durationScale > 1.0005 ? "stretch" : durationScale < 0.9995 ? "compress" : "auto";

  let cursor = 0;
  const segments = params.source.fragments.map((fragment, index) => {
    const outputStartSec = cursor;
    const baseOutputDurationSec = fragment.sourceDurationSec / Math.max(0.1, fragment.speed);
    const outputDurationSec =
      index === params.source.fragments.length - 1
        ? Math.max(0, targetDurationSec - outputStartSec)
        : baseOutputDurationSec * durationScale;
    const outputEndSec = outputStartSec + outputDurationSec;
    cursor = outputEndSec;
    return {
      label: fragment.label,
      sourceStartSec: fragment.startSec,
      sourceEndSec: fragment.endSec,
      sourceDurationSec: fragment.sourceDurationSec,
      speed: fragment.speed,
      focusYOverride: fragment.focusYOverride,
      videoZoomOverride: fragment.videoZoomOverride,
      mirrorEnabledOverride: fragment.mirrorEnabledOverride,
      outputStartSec: roundToThousandth(outputStartSec),
      outputEndSec: roundToThousandth(outputEndSec),
      outputDurationSec: roundToThousandth(outputDurationSec),
      resolvedPlaybackRate: roundToThousandth(fragment.speed / durationScale)
    };
  });

  return {
    targetDurationSec: roundToThousandth(targetDurationSec),
    totalSelectedSourceDurationSec: params.source.totalSelectedSourceDurationSec,
    totalBaseOutputDurationSec: roundToThousandth(totalBaseOutputDurationSec),
    totalOutputDurationSec: roundToThousandth(targetDurationSec),
    durationScale: roundToThousandth(durationScale),
    timingMode,
    segments
  };
}

export function buildStage3EditorSession(params: {
  rawSegments: Stage3Segment[];
  selectionMode?: Stage3EditorSelectionMode | null;
  legacyRenderPolicy?: Stage3RenderPolicy | null;
  legacyNormalizeToTargetEnabled?: boolean;
  clipStartSec: number;
  clipDurationSec: number;
  targetDurationSec?: number;
  sourceDurationSec: number | null;
}): Stage3EditorSession {
  const source = buildSourceSelection({
    rawSegments: params.rawSegments,
    selectionMode: params.selectionMode,
    legacyRenderPolicy: params.legacyRenderPolicy,
    legacyNormalizeToTargetEnabled: params.legacyNormalizeToTargetEnabled,
    clipStartSec: params.clipStartSec,
    clipDurationSec: params.clipDurationSec,
    sourceDurationSec: params.sourceDurationSec
  });
  const output = buildOutputPlan({
    source,
    targetDurationSec: params.targetDurationSec ?? params.clipDurationSec
  });

  return {
    source,
    output,
    renderPlanPatch: {
      segments: source.fragments.map((fragment) => ({
        startSec: fragment.startSec,
        endSec: fragment.endSec,
        speed: fragment.speed,
        label: fragment.label,
        focusY: fragment.focusYOverride,
        videoZoom: fragment.videoZoomOverride,
        mirrorEnabled: fragment.mirrorEnabledOverride
      })),
      timingMode: output.timingMode,
      normalizeToTargetEnabled: true,
      policy: "fixed_segments",
      editorSelectionMode: source.selectionMode
    }
  };
}

export function buildStage3EditorTimingKey(session: Stage3EditorSession): string {
  return [
    session.source.selectionMode,
    session.source.selectionKind,
    roundToThousandth(session.output.targetDurationSec).toFixed(3),
    roundToThousandth(session.output.durationScale).toFixed(3),
    ...session.output.segments.map((segment) =>
      [
        segment.sourceStartSec.toFixed(3),
        segment.sourceEndSec.toFixed(3),
        segment.speed.toFixed(3),
        segment.outputStartSec.toFixed(3),
        segment.outputEndSec.toFixed(3),
        segment.outputDurationSec.toFixed(3),
        segment.resolvedPlaybackRate.toFixed(3)
      ].join(":")
    )
  ].join("|");
}
