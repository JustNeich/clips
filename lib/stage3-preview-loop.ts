export type Stage3PreviewFrameLoopVideo = {
  paused: boolean;
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
  addEventListener: (type: "play" | "playing" | "pause", listener: () => void) => void;
  removeEventListener: (type: "play" | "playing" | "pause", listener: () => void) => void;
};

export function attachStage3PreviewFrameLoop(params: {
  video: Stage3PreviewFrameLoopVideo;
  isPlaying: boolean;
  publishPosition: () => boolean;
  requestAnimationFrameImpl?: (callback: () => void) => number;
  cancelAnimationFrameImpl?: (handle: number) => void;
}): () => void {
  const requestAnimationFrameImpl =
    params.requestAnimationFrameImpl ?? globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelAnimationFrameImpl =
    params.cancelAnimationFrameImpl ?? globalThis.cancelAnimationFrame?.bind(globalThis);
  let rafId: number | null = null;
  let frameLoopToken: number | null = null;
  let cancelled = false;

  const cleanupScheduled = () => {
    if (rafId !== null && cancelAnimationFrameImpl) {
      cancelAnimationFrameImpl(rafId);
      rafId = null;
    }
    if (frameLoopToken !== null && params.video.cancelVideoFrameCallback) {
      params.video.cancelVideoFrameCallback(frameLoopToken);
      frameLoopToken = null;
    }
  };

  const schedule = () => {
    if (cancelled || !params.isPlaying || params.video.paused) {
      return;
    }
    if (rafId !== null || frameLoopToken !== null) {
      return;
    }
    if (params.video.requestVideoFrameCallback) {
      frameLoopToken = params.video.requestVideoFrameCallback(() => {
        frameLoopToken = null;
        if (cancelled || !params.publishPosition()) {
          return;
        }
        schedule();
      });
      return;
    }
    if (!requestAnimationFrameImpl) {
      return;
    }
    rafId = requestAnimationFrameImpl(() => {
      rafId = null;
      if (cancelled || !params.publishPosition()) {
        return;
      }
      schedule();
    });
  };

  const handleResume = () => {
    if (!params.isPlaying) {
      return;
    }
    schedule();
  };

  const handlePause = () => {
    cleanupScheduled();
  };

  params.video.addEventListener("play", handleResume);
  params.video.addEventListener("playing", handleResume);
  params.video.addEventListener("pause", handlePause);
  schedule();

  return () => {
    cancelled = true;
    cleanupScheduled();
    params.video.removeEventListener("play", handleResume);
    params.video.removeEventListener("playing", handleResume);
    params.video.removeEventListener("pause", handlePause);
  };
}
