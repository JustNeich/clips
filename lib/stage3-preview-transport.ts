import type { Stage3PlaybackPosition } from "./stage3-preview-playback";

export type Stage3PreviewMappedTransportVideo = {
  currentTime: number;
  playbackRate: number;
  paused?: boolean;
  play?: () => Promise<unknown> | unknown;
  pause?: () => void;
};

export type Stage3PreviewMappedTransportState = {
  sessionKey: string;
  activeSegmentIndex: number;
  lastPublishedOutputSec: number;
  pendingSourceSeekSec: number | null;
  requestedPlay: boolean;
  phase: "idle" | "seeking_anchor" | "seeking_sync" | "ready" | "playing" | "paused" | "completed";
};

export function createStage3PreviewMappedTransportState(sessionKey = ""): Stage3PreviewMappedTransportState {
  return {
    sessionKey,
    activeSegmentIndex: 0,
    lastPublishedOutputSec: 0,
    pendingSourceSeekSec: null,
    requestedPlay: false,
    phase: "idle"
  };
}

export function resetStage3PreviewMappedTransportState(
  state: Stage3PreviewMappedTransportState,
  sessionKey = state.sessionKey
): void {
  state.sessionKey = sessionKey;
  state.activeSegmentIndex = 0;
  state.lastPublishedOutputSec = 0;
  state.pendingSourceSeekSec = null;
  state.requestedPlay = false;
  state.phase = "idle";
}

export function updateStage3PreviewMappedPlayIntent(
  state: Stage3PreviewMappedTransportState,
  requestedPlay: boolean
): void {
  state.requestedPlay = requestedPlay;
  if (!requestedPlay && state.pendingSourceSeekSec === null && state.phase !== "completed") {
    state.phase = "paused";
  }
}

export function applyStage3PreviewMappedPosition(params: {
  video: Stage3PreviewMappedTransportVideo;
  state: Stage3PreviewMappedTransportState;
  position: Stage3PlaybackPosition;
  toleranceSec?: number;
  seekPhase?: "seeking_anchor" | "seeking_sync";
}): { seekIssued: boolean } {
  const toleranceSec = Math.max(0, params.toleranceSec ?? 0.04);
  if (Math.abs(params.video.playbackRate - params.position.playbackRate) > 0.001) {
    params.video.playbackRate = params.position.playbackRate;
  }

  params.state.activeSegmentIndex = params.position.segmentIndex;
  params.state.lastPublishedOutputSec = params.position.outputTimeSec;

  const seekIssued = Math.abs(params.video.currentTime - params.position.sourceTimeSec) > toleranceSec;
  if (seekIssued) {
    params.state.pendingSourceSeekSec = params.position.sourceTimeSec;
    params.state.phase = params.seekPhase ?? "seeking_sync";
    params.video.currentTime = params.position.sourceTimeSec;
    return { seekIssued: true };
  }

  if (
    params.state.pendingSourceSeekSec !== null &&
    Math.abs(params.video.currentTime - params.state.pendingSourceSeekSec) <= Math.max(0.08, toleranceSec)
  ) {
    params.state.pendingSourceSeekSec = null;
  }
  params.state.phase = params.state.requestedPlay ? "ready" : "paused";

  return { seekIssued: false };
}

export function finalizeStage3PreviewMappedSeek(params: {
  state: Stage3PreviewMappedTransportState;
  currentSourceTimeSec: number;
  toleranceSec?: number;
}): boolean {
  if (params.state.pendingSourceSeekSec === null) {
    return false;
  }
  const toleranceSec = Math.max(0.01, params.toleranceSec ?? 0.08);
  if (Math.abs(params.currentSourceTimeSec - params.state.pendingSourceSeekSec) <= toleranceSec) {
    params.state.pendingSourceSeekSec = null;
    params.state.phase = params.state.requestedPlay ? "ready" : "paused";
    return true;
  }
  return false;
}

export function isStage3PreviewMappedSeekPending(params: {
  state: Stage3PreviewMappedTransportState;
  currentSourceTimeSec: number;
  toleranceSec?: number;
}): boolean {
  if (params.state.pendingSourceSeekSec === null) {
    return false;
  }
  finalizeStage3PreviewMappedSeek(params);
  return params.state.pendingSourceSeekSec !== null;
}

export async function maybeStartStage3PreviewMappedPlayback(params: {
  video: Stage3PreviewMappedTransportVideo;
  state: Stage3PreviewMappedTransportState;
}): Promise<boolean> {
  if (params.state.pendingSourceSeekSec !== null || !params.state.requestedPlay) {
    return false;
  }
  if (!params.video.paused) {
    params.state.phase = "playing";
    return true;
  }

  params.state.phase = "ready";
  if (typeof params.video.play !== "function") {
    params.state.phase = "playing";
    return true;
  }

  try {
    await params.video.play();
    params.state.phase = "playing";
    return true;
  } catch {
    params.state.phase = params.state.requestedPlay ? "ready" : "paused";
    return false;
  }
}

export function pauseStage3PreviewMappedPlayback(params: {
  video: Stage3PreviewMappedTransportVideo;
  state: Stage3PreviewMappedTransportState;
}): void {
  if (typeof params.video.pause === "function") {
    params.video.pause();
  }
  if (params.state.phase !== "completed") {
    params.state.phase = params.state.pendingSourceSeekSec === null ? "paused" : params.state.phase;
  }
}
