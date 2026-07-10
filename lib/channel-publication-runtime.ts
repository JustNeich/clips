import { processQueuedChannelPublication } from "./channel-publication-service";
import {
  appendChannelPublicationEvent,
  claimNextReadyChannelPublication,
  getChannelPublicationById,
  getNextChannelPublicationWakeAt,
  getNextChannelPublicationVerificationWakeAt,
  getChannelPublishIntegration,
  listScheduledChannelPublicationsAwaitingVerification,
  markChannelPublicationPublicVerified,
  recoverInterruptedChannelPublications,
  sweepPublishedChannelPublications
} from "./publication-store";
import { reconcileYouTubePublicVerification } from "./youtube-public-verification";

type ChannelPublicationRuntimeState = {
  initialized: boolean;
  runnerPromise: Promise<void> | null;
  wakeTimer: ReturnType<typeof setTimeout> | null;
  wakeAt: string | null;
};

type ChannelPublicationRuntimeGlobal = typeof globalThis & {
  __clipsChannelPublicationRuntimeState__?: ChannelPublicationRuntimeState;
};

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
  const swept = sweepPublishedChannelPublications();
  if (recovered > 0) {
    logPublicationRuntime("bootstrap_requeue_publications", { count: recovered });
  }
  if (swept > 0) {
    logPublicationRuntime("bootstrap_sweep_published", { count: swept });
  }
}

export type ScheduledPublicationReconcileResult = {
  checked: number;
  verified: number;
  retryable: number;
  terminal: number;
};

export async function reconcileScheduledChannelPublications(input: {
  now?: Date;
  fetch?: typeof fetch;
  limit?: number;
} = {}): Promise<ScheduledPublicationReconcileResult> {
  const now = input.now ?? new Date();
  const publications = listScheduledChannelPublicationsAwaitingVerification({
    dueAt: now.toISOString(),
    limit: input.limit ?? 20
  });
  const result: ScheduledPublicationReconcileResult = {
    checked: publications.length,
    verified: 0,
    retryable: 0,
    terminal: 0
  };
  for (const publication of publications) {
    const expectedVideoId = publication.youtubeVideoId;
    const integration = getChannelPublishIntegration(publication.channelId);
    const expectedChannelId = integration?.selectedYoutubeChannelId ?? null;
    if (!expectedVideoId || !expectedChannelId) {
      result.terminal += 1;
      continue;
    }
    const verification = await reconcileYouTubePublicVerification(
      {
        publicationId: publication.id,
        expectedVideoId,
        expectedChannelId
      },
      {
        readClipsPublication: async (publicationId) => {
          const current = getChannelPublicationById(publicationId);
          const currentIntegration = current ? getChannelPublishIntegration(current.channelId) : null;
          if (!current) throw new Error("Clips publication disappeared during public reconciliation.");
          return {
            publicationId: current.id,
            status: current.status,
            youtubeVideoId: current.youtubeVideoId,
            youtubeChannelId: currentIntegration?.selectedYoutubeChannelId ?? null,
            lastError: current.lastError
          };
        },
        fetch: input.fetch ?? fetch,
        now: () => now,
        sleep: async () => undefined
      },
      { maxAttempts: 1, maxElapsedMs: 0 }
    );
    if (verification.verified) {
      markChannelPublicationPublicVerified({
        publicationId: publication.id,
        expectedYoutubeVideoId: expectedVideoId,
        expectedYoutubeChannelId: expectedChannelId,
        verifiedAt: now.toISOString(),
        evidenceSha256: verification.evidenceSha256
      });
      result.verified += 1;
      continue;
    }
    if (verification.outcome === "terminal_failure") {
      result.terminal += 1;
      appendChannelPublicationEvent(
        publication.id,
        "error",
        `Public verification terminal failure: ${verification.reason}. Evidence: ${verification.evidenceSha256.slice(0, 12)}.`
      );
    } else {
      result.retryable += 1;
    }
  }
  return result;
}

function scheduleNextWake(): void {
  const state = getRuntimeState();
  if (state.runnerPromise) {
    return;
  }
  const queueWakeAt = getNextChannelPublicationWakeAt();
  const verificationWakeAt = getNextChannelPublicationVerificationWakeAt();
  const nowMs = Date.now();
  const normalizedVerificationWakeAt = verificationWakeAt && Date.parse(verificationWakeAt) <= nowMs
    ? new Date(nowMs + 30_000).toISOString()
    : verificationWakeAt;
  const nextWakeAt = [queueWakeAt, normalizedVerificationWakeAt]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
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
  }, delayMs);
  state.wakeTimer.unref?.();
}

async function runChannelPublicationLoop(): Promise<void> {
  sweepPublishedChannelPublications();
  const reconciled = await reconcileScheduledChannelPublications();
  if (reconciled.checked > 0) {
    logPublicationRuntime("public_verification_pass", reconciled);
  }

  while (true) {
    const claimed = claimNextReadyChannelPublication({});
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
