import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStage3PreviewMappedPosition,
  createStage3PreviewMappedTransportState,
  finalizeStage3PreviewMappedSeek,
  isStage3PreviewMappedSeekPending,
  maybeStartStage3PreviewMappedPlayback,
  resetStage3PreviewMappedTransportState
} from "../lib/stage3-preview-transport";
import type { Stage3PlaybackPosition } from "../lib/stage3-preview-playback";

function makePosition(overrides?: Partial<Stage3PlaybackPosition>): Stage3PlaybackPosition {
  return {
    segmentIndex: 0,
    outputTimeSec: 0,
    sourceTimeSec: 18.3,
    playbackRate: 1,
    segment: {
      label: "A",
      sourceStartSec: 18.3,
      sourceEndSec: 24.3,
      sourceDurationSec: 6,
      speed: 1,
      focusXOverride: null,
      focusYOverride: null,
      videoZoomOverride: null,
      mirrorEnabledOverride: null,
      outputStartSec: 0,
      outputEndSec: 6,
      outputDurationSec: 6,
      resolvedPlaybackRate: 1,
      playbackRate: 1
    },
    ...overrides
  };
}

test("mapped preview transport records a pending seek when output jumps into a later source window", () => {
  const state = createStage3PreviewMappedTransportState();
  const video = { currentTime: 0, playbackRate: 1 };
  const position = makePosition();

  const result = applyStage3PreviewMappedPosition({
    video,
    state,
    position,
    toleranceSec: 0
  });

  assert.equal(result.seekIssued, true);
  assert.equal(video.currentTime, 18.3);
  assert.equal(state.pendingSourceSeekSec, 18.3);
  assert.equal(state.lastPublishedOutputSec, 0);
  assert.equal(state.activeSegmentIndex, 0);
  assert.equal(state.phase, "seeking_sync");
});

test("mapped preview transport waits for the browser seek to land before resuming sync", () => {
  const state = createStage3PreviewMappedTransportState();
  state.pendingSourceSeekSec = 18.3;
  state.requestedPlay = true;
  state.phase = "seeking_anchor";

  assert.equal(
    isStage3PreviewMappedSeekPending({
      state,
      currentSourceTimeSec: 0
    }),
    true
  );
  assert.equal(state.pendingSourceSeekSec, 18.3);

  assert.equal(
    isStage3PreviewMappedSeekPending({
      state,
      currentSourceTimeSec: 18.31
    }),
    false
  );
  assert.equal(state.pendingSourceSeekSec, null);
  assert.equal(state.phase, "ready");
});

test("mapped preview transport reset clears stale pending seek and playback anchor", () => {
  const state = createStage3PreviewMappedTransportState();
  state.activeSegmentIndex = 2;
  state.lastPublishedOutputSec = 5.8;
  state.pendingSourceSeekSec = 42;
  state.requestedPlay = true;
  state.phase = "playing";

  resetStage3PreviewMappedTransportState(state);

  assert.equal(state.activeSegmentIndex, 0);
  assert.equal(state.lastPublishedOutputSec, 0);
  assert.equal(state.pendingSourceSeekSec, null);
  assert.equal(state.requestedPlay, false);
  assert.equal(state.phase, "idle");
});

test("late-window startup stays gated until the anchor seek is confirmed", async () => {
  const state = createStage3PreviewMappedTransportState();
  state.requestedPlay = true;
  const video = {
    currentTime: 0,
    playbackRate: 1,
    paused: true,
    playCalls: 0,
    async play() {
      this.playCalls += 1;
      this.paused = false;
    },
    pause() {
      this.paused = true;
    }
  };

  applyStage3PreviewMappedPosition({
    video,
    state,
    position: makePosition({ sourceTimeSec: 40, segment: { ...makePosition().segment, sourceStartSec: 40, sourceEndSec: 46 } }),
    toleranceSec: 0,
    seekPhase: "seeking_anchor"
  });

  const startedBeforeSeek = await maybeStartStage3PreviewMappedPlayback({ video, state });
  assert.equal(startedBeforeSeek, false);
  assert.equal(video.playCalls, 0);
  assert.equal(state.phase, "seeking_anchor");

  const landed = finalizeStage3PreviewMappedSeek({
    state,
    currentSourceTimeSec: 40
  });
  assert.equal(landed, true);
  assert.equal(state.phase, "ready");

  const startedAfterSeek = await maybeStartStage3PreviewMappedPlayback({ video, state });
  assert.equal(startedAfterSeek, true);
  assert.equal(video.playCalls, 1);
  assert.equal(state.phase, "playing");
});

test("mapped preview transport swallows interrupted play promises when media is removed", async () => {
  const state = createStage3PreviewMappedTransportState();
  state.requestedPlay = true;
  state.phase = "ready";
  const video = {
    currentTime: 40,
    playbackRate: 1,
    paused: true,
    async play() {
      const error = new Error(
        "The play() request was interrupted because the media was removed from the document."
      ) as Error & { name?: string };
      error.name = "AbortError";
      throw error;
    },
    pause() {
      this.paused = true;
    }
  };

  const started = await maybeStartStage3PreviewMappedPlayback({ video, state });

  assert.equal(started, false);
  assert.equal(state.phase, "ready");
  assert.equal(state.requestedPlay, true);
});
