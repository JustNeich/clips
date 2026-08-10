import { processQueuedChannelPublication } from "./channel-publication-service";
import {
  claimNextReadyChannelPublication,
  getNextChannelPublicationWakeAt,
  recoverInterruptedChannelPublications
} from "./publication-store";

type ChannelPublicationRuntimeState = {
  initialized: boolean;
  runnerPromise: Promise<void> | null;
  wakeTimer: ReturnType<typeof setTimeout> | null;
  wakeAt: string | null;
};

type ChannelPublicationRuntimeGlobal = typeof globalThis & {
  __clipsChannelPublicationRuntimeState__?: ChannelPublicationRuntimeState;
};

// Node clamps larger delays to 1 ms. Re-arm long-range publication wakes in
// bounded chunks instead of spinning the runtime until a distant publishAt.
const MAX_NODE_TIMEOUT_MS = 2_147_000_000;
const PUBLICATION_LEASE_DURATION_MS = 5 * 60_000;

function getRuntimeState(): ChannelPublicationRuntimeState {
  const scope = globalThis as ChannelPublicationRuntimeGlobal;
  if (!scope.__clipsChannelPublicationRuntimeState__) {
    scope.__clipsChannelPublicationRuntimeState__ = {
      initialized: false,
      runnerPromise: null,
      wakeTimer: null,
      wakeAt: null
    };
  }
  return scope.__clipsChannelPublicationRuntimeState__;
}

function logPublicationRuntime(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      scope: "channel-publication",
      event,
      at: new Date().toISOString(),
      ...payload
    })
  );
}

function clearWakeTimer(state: ChannelPublicationRuntimeState): void {
  if (state.wakeTimer) {
    clearTimeout(state.wakeTimer);
    state.wakeTimer = null;
  }
  state.wakeAt = null;
}

function ensureChannelPublicationRuntime(): void {
  const state = getRuntimeState();
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  const recovered = recoverInterruptedChannelPublications();
  if (recovered > 0) {
    logPublicationRuntime("bootstrap_requeue_publications", { count: recovered });
  }
}

function scheduleNextWake(): void {
  const state = getRuntimeState();
  if (state.runnerPromise) {
    return;
  }
  const nextWakeAt = getNextChannelPublicationWakeAt();
  if (!nextWakeAt) {
    clearWakeTimer(state);
    return;
  }

  const delayMs = new Date(nextWakeAt).getTime() - Date.now();
  if (delayMs <= 0) {
    queueMicrotask(() => {
      scheduleChannelPublicationProcessing();
    });
    return;
  }

  if (state.wakeAt && new Date(state.wakeAt).getTime() <= new Date(nextWakeAt).getTime()) {
    return;
  }

  clearWakeTimer(state);
  state.wakeAt = nextWakeAt;
  state.wakeTimer = setTimeout(() => {
    const latest = getRuntimeState();
    latest.wakeTimer = null;
    latest.wakeAt = null;
    scheduleChannelPublicationProcessing();
  }, Math.min(delayMs, MAX_NODE_TIMEOUT_MS));
  state.wakeTimer.unref?.();
}

async function runChannelPublicationLoop(): Promise<void> {
  while (true) {
    const claimed = claimNextReadyChannelPublication({
      leaseDurationMs: PUBLICATION_LEASE_DURATION_MS
    });
    if (!claimed) {
      break;
    }
    const { publication, leaseToken } = claimed;

    logPublicationRuntime("publication_claimed", {
      publicationId: publication.id,
      channelId: publication.channelId,
      scheduledAt: publication.scheduledAt
    });

    try {
      const result = await processQueuedChannelPublication(publication, {
        leaseToken
      });
      logPublicationRuntime("publication_processed", {
        publicationId: result.id,
        status: result.status,
        youtubeVideoId: result.youtubeVideoId
      });
    } catch (error) {
      logPublicationRuntime("publication_process_fail", {
        publicationId: publication.id,
        message: error instanceof Error ? error.message : "Unknown publication processing failure."
      });
    }
  }
}

export function scheduleChannelPublicationProcessing(): void {
  ensureChannelPublicationRuntime();
  const state = getRuntimeState();
  if (state.runnerPromise) {
    return;
  }

  clearWakeTimer(state);
  state.runnerPromise = Promise.resolve()
    .then(() => runChannelPublicationLoop())
    .finally(() => {
      const latest = getRuntimeState();
      latest.runnerPromise = null;
      scheduleNextWake();
    });
}
