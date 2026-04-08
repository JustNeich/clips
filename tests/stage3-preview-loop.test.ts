import test from "node:test";
import assert from "node:assert/strict";
import { attachStage3PreviewFrameLoop } from "../lib/stage3-preview-loop";

class FakePreviewVideo {
  paused = true;
  private listeners = {
    play: new Set<() => void>(),
    playing: new Set<() => void>(),
    pause: new Set<() => void>()
  };

  addEventListener(type: "play" | "playing" | "pause", listener: () => void) {
    this.listeners[type].add(listener);
  }

  removeEventListener(type: "play" | "playing" | "pause", listener: () => void) {
    this.listeners[type].delete(listener);
  }

  dispatch(type: "play" | "playing" | "pause") {
    for (const listener of this.listeners[type]) {
      listener();
    }
  }
}

test("preview frame loop starts after the browser emits play for an async autoplay", () => {
  const video = new FakePreviewVideo();
  let publishCalls = 0;
  let pendingFrame: (() => void) | null = null;

  const cleanup = attachStage3PreviewFrameLoop({
    video,
    isPlaying: true,
    publishPosition: () => {
      publishCalls += 1;
      return publishCalls < 2;
    },
    requestAnimationFrameImpl: (callback) => {
      pendingFrame = callback;
      return 1;
    },
    cancelAnimationFrameImpl: () => {
      pendingFrame = null;
    }
  });

  assert.equal(publishCalls, 0);
  assert.equal(pendingFrame, null);

  video.paused = false;
  video.dispatch("play");

  assert.ok(pendingFrame);
  const firstFrame = pendingFrame as () => void;
  pendingFrame = null;
  firstFrame();
  assert.equal(publishCalls, 1);
  assert.ok(pendingFrame);
  const secondFrame = pendingFrame as () => void;
  pendingFrame = null;
  secondFrame();
  assert.equal(publishCalls, 2);
  assert.equal(pendingFrame, null);

  cleanup();
});
