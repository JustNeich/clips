import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "./stage3-constants";

export type Stage3CameraMotion = "disabled" | "top_to_bottom" | "bottom_to_top";

export type Stage3CameraKeyframe = {
  id: string;
  timeSec: number;
  focusY: number;
  zoom: number;
};

export type Stage3PositionKeyframe = {
  id: string;
  timeSec: number;
  focusY: number;
};

export type Stage3ScaleKeyframe = {
  id: string;
  timeSec: number;
  zoom: number;
};

export const STAGE3_CAMERA_FOCUS_MIN = 0.12;
export const STAGE3_CAMERA_FOCUS_MAX = 0.88;
export const STAGE3_CAMERA_FOCUS_X_MIN = STAGE3_CAMERA_FOCUS_MIN;
export const STAGE3_CAMERA_FOCUS_X_MAX = STAGE3_CAMERA_FOCUS_MAX;

const DEFAULT_CLIP_DURATION_SEC = 6;
const LEGACY_SWEEP = 0.28;
const DUPLICATE_TIME_EPSILON_SEC = 0.001;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function normalizeClipDurationSec(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return DEFAULT_CLIP_DURATION_SEC;
}

function normalizeTimeSec(value: unknown, clipDurationSec: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return roundTo(clamp(value, 0, clipDurationSec), 3);
}

function normalizeTimedKeyframes<T extends { timeSec: number }>(
  keyframes: T[]
): T[] {
  const deduped: T[] = [];
  for (const keyframe of keyframes.sort((left, right) => left.timeSec - right.timeSec)) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(previous.timeSec - keyframe.timeSec) <= DUPLICATE_TIME_EPSILON_SEC) {
      deduped[deduped.length - 1] = keyframe;
      continue;
    }
    deduped.push(keyframe);
  }
  return deduped;
}

function collectTrackTimes(positionKeyframes: Stage3PositionKeyframe[], scaleKeyframes: Stage3ScaleKeyframe[]): number[] {
  const times = [...positionKeyframes.map((keyframe) => keyframe.timeSec), ...scaleKeyframes.map((keyframe) => keyframe.timeSec)]
    .sort((left, right) => left - right);
  const unique: number[] = [];
  for (const timeSec of times) {
    if (unique.length === 0 || Math.abs(unique[unique.length - 1]! - timeSec) > DUPLICATE_TIME_EPSILON_SEC) {
      unique.push(timeSec);
    }
  }
  return unique;
}

export function clampStage3FocusY(value: number): number {
  return clamp(value, STAGE3_CAMERA_FOCUS_MIN, STAGE3_CAMERA_FOCUS_MAX);
}

export function clampStage3FocusX(value: number): number {
  return clamp(value, STAGE3_CAMERA_FOCUS_X_MIN, STAGE3_CAMERA_FOCUS_X_MAX);
}

export function clampStage3CameraZoom(value: number): number {
  return clamp(value, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM);
}

export function normalizeStage3CameraMotion(value: unknown): Stage3CameraMotion {
  return value === "top_to_bottom" || value === "bottom_to_top" || value === "disabled" ? value : "disabled";
}

export function normalizeStage3CameraKeyframes(
  value: unknown,
  options?: {
    clipDurationSec?: number;
    fallbackFocusY?: number;
    fallbackZoom?: number;
  }
): Stage3CameraKeyframe[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const clipDurationSec = normalizeClipDurationSec(options?.clipDurationSec);
  const fallbackFocusY = clampStage3FocusY(
    typeof options?.fallbackFocusY === "number" && Number.isFinite(options.fallbackFocusY) ? options.fallbackFocusY : 0.5
  );
  const fallbackZoom = clampStage3CameraZoom(
    typeof options?.fallbackZoom === "number" && Number.isFinite(options.fallbackZoom) ? options.fallbackZoom : 1
  );

  const normalized = value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as Partial<Stage3CameraKeyframe>;
      const timeSec = normalizeTimeSec(candidate.timeSec, clipDurationSec);
      if (timeSec === null) {
        return null;
      }
      const focusY =
        typeof candidate.focusY === "number" && Number.isFinite(candidate.focusY)
          ? clampStage3FocusY(candidate.focusY)
          : fallbackFocusY;
      const zoom =
        typeof candidate.zoom === "number" && Number.isFinite(candidate.zoom)
          ? clampStage3CameraZoom(candidate.zoom)
          : fallbackZoom;
      return {
        id:
          typeof candidate.id === "string" && candidate.id.trim()
            ? candidate.id.trim()
            : `camera-${index + 1}-${Math.round(timeSec * 1000)}`,
        timeSec,
        focusY: roundTo(focusY, 4),
        zoom: roundTo(zoom, 4)
      };
    })
    .filter((keyframe): keyframe is Stage3CameraKeyframe => Boolean(keyframe));

  return normalizeTimedKeyframes(normalized);
}

export function normalizeStage3PositionKeyframes(
  value: unknown,
  options?: {
    clipDurationSec?: number;
    fallbackFocusY?: number;
  }
): Stage3PositionKeyframe[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const clipDurationSec = normalizeClipDurationSec(options?.clipDurationSec);
  const fallbackFocusY = clampStage3FocusY(
    typeof options?.fallbackFocusY === "number" && Number.isFinite(options.fallbackFocusY) ? options.fallbackFocusY : 0.5
  );

  const normalized = value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as Partial<Stage3PositionKeyframe>;
      const timeSec = normalizeTimeSec(candidate.timeSec, clipDurationSec);
      if (timeSec === null) {
        return null;
      }
      const focusY =
        typeof candidate.focusY === "number" && Number.isFinite(candidate.focusY)
          ? clampStage3FocusY(candidate.focusY)
          : fallbackFocusY;
      return {
        id:
          typeof candidate.id === "string" && candidate.id.trim()
            ? candidate.id.trim()
            : `position-${index + 1}-${Math.round(timeSec * 1000)}`,
        timeSec,
        focusY: roundTo(focusY, 4)
      };
    })
    .filter((keyframe): keyframe is Stage3PositionKeyframe => Boolean(keyframe));

  return normalizeTimedKeyframes(normalized);
}

export function normalizeStage3ScaleKeyframes(
  value: unknown,
  options?: {
    clipDurationSec?: number;
    fallbackZoom?: number;
  }
): Stage3ScaleKeyframe[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const clipDurationSec = normalizeClipDurationSec(options?.clipDurationSec);
  const fallbackZoom = clampStage3CameraZoom(
    typeof options?.fallbackZoom === "number" && Number.isFinite(options.fallbackZoom) ? options.fallbackZoom : 1
  );

  const normalized = value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as Partial<Stage3ScaleKeyframe>;
      const timeSec = normalizeTimeSec(candidate.timeSec, clipDurationSec);
      if (timeSec === null) {
        return null;
      }
      const zoom =
        typeof candidate.zoom === "number" && Number.isFinite(candidate.zoom)
          ? clampStage3CameraZoom(candidate.zoom)
          : fallbackZoom;
      return {
        id:
          typeof candidate.id === "string" && candidate.id.trim()
            ? candidate.id.trim()
            : `scale-${index + 1}-${Math.round(timeSec * 1000)}`,
        timeSec,
        zoom: roundTo(zoom, 4)
      };
    })
    .filter((keyframe): keyframe is Stage3ScaleKeyframe => Boolean(keyframe));

  return normalizeTimedKeyframes(normalized);
}

function splitLegacyCameraKeyframes(params: {
  cameraKeyframes: unknown;
  clipDurationSec?: number;
  baseFocusY: number;
  baseZoom: number;
}): {
  legacyCameraKeyframes: Stage3CameraKeyframe[];
  positionKeyframes: Stage3PositionKeyframe[];
  scaleKeyframes: Stage3ScaleKeyframe[];
} {
  const legacyCameraKeyframes = normalizeStage3CameraKeyframes(params.cameraKeyframes, {
    clipDurationSec: params.clipDurationSec,
    fallbackFocusY: params.baseFocusY,
    fallbackZoom: params.baseZoom
  });
  return {
    legacyCameraKeyframes,
    positionKeyframes: legacyCameraKeyframes.map((keyframe) => ({
      id: keyframe.id,
      timeSec: keyframe.timeSec,
      focusY: keyframe.focusY
    })),
    scaleKeyframes: legacyCameraKeyframes.map((keyframe) => ({
      id: keyframe.id,
      timeSec: keyframe.timeSec,
      zoom: keyframe.zoom
    }))
  };
}

export function resolveLegacyCameraBounds(baseFocusY: number): {
  startFocusY: number;
  endFocusY: number;
} {
  const focus = clampStage3FocusY(baseFocusY);
  const startFocusY = clamp(focus - LEGACY_SWEEP / 2, STAGE3_CAMERA_FOCUS_MIN, STAGE3_CAMERA_FOCUS_MAX - LEGACY_SWEEP);
  const endFocusY = clamp(startFocusY + LEGACY_SWEEP, STAGE3_CAMERA_FOCUS_MIN, STAGE3_CAMERA_FOCUS_MAX);
  return { startFocusY, endFocusY };
}

export function buildLegacyPositionKeyframes(params: {
  cameraMotion: Stage3CameraMotion;
  clipDurationSec?: number;
  baseFocusY: number;
}): Stage3PositionKeyframe[] {
  if (params.cameraMotion === "disabled") {
    return [];
  }

  const clipDurationSec = normalizeClipDurationSec(params.clipDurationSec);
  const { startFocusY, endFocusY } = resolveLegacyCameraBounds(params.baseFocusY);

  if (params.cameraMotion === "top_to_bottom") {
    return [
      { id: "legacy-start", timeSec: 0, focusY: startFocusY },
      { id: "legacy-end", timeSec: clipDurationSec, focusY: endFocusY }
    ];
  }

  return [
    { id: "legacy-start", timeSec: 0, focusY: endFocusY },
    { id: "legacy-end", timeSec: clipDurationSec, focusY: startFocusY }
  ];
}

export function buildLegacyCameraKeyframes(params: {
  cameraMotion: Stage3CameraMotion;
  clipDurationSec?: number;
  baseFocusY: number;
  baseZoom: number;
}): Stage3CameraKeyframe[] {
  const baseZoom = clampStage3CameraZoom(params.baseZoom);
  return buildLegacyPositionKeyframes(params).map((keyframe) => ({
    id: keyframe.id,
    timeSec: keyframe.timeSec,
    focusY: keyframe.focusY,
    zoom: baseZoom
  }));
}

export function resolveStage3EffectiveCameraTracks(params: {
  cameraPositionKeyframes?: unknown;
  cameraScaleKeyframes?: unknown;
  cameraKeyframes?: unknown;
  cameraMotion?: unknown;
  clipDurationSec?: number;
  baseFocusY: number;
  baseZoom: number;
}): {
  positionKeyframes: Stage3PositionKeyframe[];
  scaleKeyframes: Stage3ScaleKeyframe[];
  legacyCameraKeyframes: Stage3CameraKeyframe[];
} {
  const baseFocusY = clampStage3FocusY(params.baseFocusY);
  const baseZoom = clampStage3CameraZoom(params.baseZoom);
  const hasExplicitTracks = Array.isArray(params.cameraPositionKeyframes) || Array.isArray(params.cameraScaleKeyframes);

  if (hasExplicitTracks) {
    return {
      positionKeyframes: normalizeStage3PositionKeyframes(params.cameraPositionKeyframes, {
        clipDurationSec: params.clipDurationSec,
        fallbackFocusY: baseFocusY
      }),
      scaleKeyframes: normalizeStage3ScaleKeyframes(params.cameraScaleKeyframes, {
        clipDurationSec: params.clipDurationSec,
        fallbackZoom: baseZoom
      }),
      legacyCameraKeyframes: normalizeStage3CameraKeyframes(params.cameraKeyframes, {
        clipDurationSec: params.clipDurationSec,
        fallbackFocusY: baseFocusY,
        fallbackZoom: baseZoom
      })
    };
  }

  const legacyTracks = splitLegacyCameraKeyframes({
    cameraKeyframes: params.cameraKeyframes,
    clipDurationSec: params.clipDurationSec,
    baseFocusY,
    baseZoom
  });
  if (legacyTracks.legacyCameraKeyframes.length > 0) {
    return legacyTracks;
  }

  return {
    positionKeyframes: buildLegacyPositionKeyframes({
      cameraMotion: normalizeStage3CameraMotion(params.cameraMotion),
      clipDurationSec: params.clipDurationSec,
      baseFocusY
    }),
    scaleKeyframes: [],
    legacyCameraKeyframes: buildLegacyCameraKeyframes({
      cameraMotion: normalizeStage3CameraMotion(params.cameraMotion),
      clipDurationSec: params.clipDurationSec,
      baseFocusY,
      baseZoom
    })
  };
}

function resolveTrackValueAtTime<T extends { timeSec: number }>(params: {
  timeSec: number;
  keyframes: T[];
  baseValue: number;
  pickValue: (keyframe: T) => number;
  clampValue: (value: number) => number;
}): number {
  const timeSec = Math.max(0, Number.isFinite(params.timeSec) ? params.timeSec : 0);

  if (params.keyframes.length === 0) {
    return params.clampValue(params.baseValue);
  }

  const first = params.keyframes[0];
  if (first && timeSec < first.timeSec) {
    return params.clampValue(params.baseValue);
  }

  for (let index = 0; index < params.keyframes.length; index += 1) {
    const current = params.keyframes[index];
    const next = params.keyframes[index + 1];
    if (!current) {
      break;
    }
    if (!next) {
      return params.clampValue(params.pickValue(current));
    }
    if (timeSec <= current.timeSec) {
      return params.clampValue(params.pickValue(current));
    }
    if (timeSec < next.timeSec) {
      const start = params.pickValue(current);
      const end = params.pickValue(next);
      const span = Math.max(0.0001, next.timeSec - current.timeSec);
      const progress = clamp((timeSec - current.timeSec) / span, 0, 1);
      return roundTo(params.clampValue(start + (end - start) * progress), 4);
    }
  }

  const last = params.keyframes[params.keyframes.length - 1];
  return params.clampValue(last ? params.pickValue(last) : params.baseValue);
}

function resolveCameraStateFromTracks(params: {
  timeSec: number;
  positionKeyframes: Stage3PositionKeyframe[];
  scaleKeyframes: Stage3ScaleKeyframe[];
  baseFocusY: number;
  baseZoom: number;
}): {
  focusY: number;
  zoom: number;
} {
  return {
    focusY: resolveTrackValueAtTime({
      timeSec: params.timeSec,
      keyframes: params.positionKeyframes,
      baseValue: params.baseFocusY,
      pickValue: (keyframe) => keyframe.focusY,
      clampValue: clampStage3FocusY
    }),
    zoom: resolveTrackValueAtTime({
      timeSec: params.timeSec,
      keyframes: params.scaleKeyframes,
      baseValue: params.baseZoom,
      pickValue: (keyframe) => keyframe.zoom,
      clampValue: clampStage3CameraZoom
    })
  };
}

export function combineStage3CameraTracks(params: {
  positionKeyframes: Stage3PositionKeyframe[];
  scaleKeyframes: Stage3ScaleKeyframe[];
  baseFocusY: number;
  baseZoom: number;
}): Stage3CameraKeyframe[] {
  return collectTrackTimes(params.positionKeyframes, params.scaleKeyframes).map((timeSec, index) => {
    const state = resolveCameraStateFromTracks({
      timeSec,
      positionKeyframes: params.positionKeyframes,
      scaleKeyframes: params.scaleKeyframes,
      baseFocusY: params.baseFocusY,
      baseZoom: params.baseZoom
    });
    return {
      id: `camera-${index + 1}-${Math.round(timeSec * 1000)}`,
      timeSec,
      focusY: state.focusY,
      zoom: state.zoom
    };
  });
}

export function resolveStage3EffectiveCameraKeyframes(params: {
  cameraPositionKeyframes?: unknown;
  cameraScaleKeyframes?: unknown;
  cameraKeyframes?: unknown;
  cameraMotion?: unknown;
  clipDurationSec?: number;
  baseFocusY: number;
  baseZoom: number;
}): Stage3CameraKeyframe[] {
  const tracks = resolveStage3EffectiveCameraTracks(params);
  const hasExplicitTracks =
    Array.isArray(params.cameraPositionKeyframes) || Array.isArray(params.cameraScaleKeyframes);
  if (!hasExplicitTracks && tracks.legacyCameraKeyframes.length > 0) {
    return tracks.legacyCameraKeyframes;
  }
  return combineStage3CameraTracks({
    positionKeyframes: tracks.positionKeyframes,
    scaleKeyframes: tracks.scaleKeyframes,
    baseFocusY: params.baseFocusY,
    baseZoom: params.baseZoom
  });
}

export function resolveCameraStateAtTime(params: {
  timeSec: number;
  cameraPositionKeyframes?: unknown;
  cameraScaleKeyframes?: unknown;
  cameraKeyframes?: unknown;
  cameraMotion?: unknown;
  clipDurationSec?: number;
  baseFocusY: number;
  baseZoom: number;
}): {
  focusY: number;
  zoom: number;
  positionKeyframes: Stage3PositionKeyframe[];
  scaleKeyframes: Stage3ScaleKeyframe[];
  keyframes: Stage3CameraKeyframe[];
} {
  const baseFocusY = clampStage3FocusY(params.baseFocusY);
  const baseZoom = clampStage3CameraZoom(params.baseZoom);
  const tracks = resolveStage3EffectiveCameraTracks({
    cameraPositionKeyframes: params.cameraPositionKeyframes,
    cameraScaleKeyframes: params.cameraScaleKeyframes,
    cameraKeyframes: params.cameraKeyframes,
    cameraMotion: params.cameraMotion,
    clipDurationSec: params.clipDurationSec,
    baseFocusY,
    baseZoom
  });
  const state = resolveCameraStateFromTracks({
    timeSec: params.timeSec,
    positionKeyframes: tracks.positionKeyframes,
    scaleKeyframes: tracks.scaleKeyframes,
    baseFocusY,
    baseZoom
  });

  return {
    ...state,
    positionKeyframes: tracks.positionKeyframes,
    scaleKeyframes: tracks.scaleKeyframes,
    keyframes: combineStage3CameraTracks({
      positionKeyframes: tracks.positionKeyframes,
      scaleKeyframes: tracks.scaleKeyframes,
      baseFocusY,
      baseZoom
    })
  };
}
