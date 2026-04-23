import {
  claimNextQueuedChannelStyleDiscoveryRun,
  createChannelStyleDiscoveryRun,
  finalizeChannelStyleDiscoveryRunFailure,
  finalizeChannelStyleDiscoveryRunSuccess,
  getChannelStyleDiscoveryRun,
  hasQueuedChannelStyleDiscoveryRuns,
  recoverInterruptedChannelStyleDiscoveryRuns
} from "./channel-style-discovery-store";
import { discoverStage2StyleProfile } from "./stage2-style-discovery";
import type {
  ChannelStyleDiscoveryRequest,
  ChannelStyleDiscoveryRunDetail
} from "./channel-style-discovery-types";
import { clampHostedConcurrencyLimit } from "./hosted-resource-budget";

type ChannelStyleDiscoveryRuntimeState = {
  initialized: boolean;
  activeRuns: Set<string>;
  schedulerPromise: Promise<void> | null;
};

type ChannelStyleDiscoveryRuntimeGlobal = typeof globalThis & {
  __clipsChannelStyleDiscoveryRuntimeState__?: ChannelStyleDiscoveryRuntimeState;
  __clipsChannelStyleDiscoveryProcessorOverride__?: ChannelStyleDiscoveryProcessor | null;
};

export type ChannelStyleDiscoveryProcessor = (
  run: ChannelStyleDiscoveryRunDetail
) => Promise<ChannelStyleDiscoveryRunDetail["result"]>;

function getRuntimeState(): ChannelStyleDiscoveryRuntimeState {
  const scope = globalThis as ChannelStyleDiscoveryRuntimeGlobal;
  if (!scope.__clipsChannelStyleDiscoveryRuntimeState__) {
    scope.__clipsChannelStyleDiscoveryRuntimeState__ = {
      initialized: false,
      activeRuns: new Set<string>(),
      schedulerPromise: null
    };
  }
  return scope.__clipsChannelStyleDiscoveryRuntimeState__;
}

function getProcessor(): ChannelStyleDiscoveryProcessor {
  const scope = globalThis as ChannelStyleDiscoveryRuntimeGlobal;
  return scope.__clipsChannelStyleDiscoveryProcessorOverride__ ?? (async (run) =>
    discoverStage2StyleProfile({
      workspaceId: run.workspaceId,
      channelName: run.request.channelName,
      username: run.request.username,
      hardConstraints: run.request.hardConstraints,
      referenceUrls: run.request.referenceUrls
    }));
}

export function setChannelStyleDiscoveryProcessorForTests(
  processor: ChannelStyleDiscoveryProcessor | null
): void {
  (globalThis as ChannelStyleDiscoveryRuntimeGlobal).__clipsChannelStyleDiscoveryProcessorOverride__ =
    processor;
}

function ensureChannelStyleDiscoveryRuntime(): void {
  const state = getRuntimeState();
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  recoverInterruptedChannelStyleDiscoveryRuns();
}

function getChannelStyleDiscoveryConcurrencyLimit(): number {
  const raw = Number.parseInt(process.env.CHANNEL_STYLE_DISCOVERY_MAX_CONCURRENT_RUNS ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return clampHostedConcurrencyLimit(2);
  }
  return clampHostedConcurrencyLimit(Math.max(1, Math.min(6, Math.floor(raw))));
}

async function executeRun(run: ChannelStyleDiscoveryRunDetail): Promise<void> {
  try {
    const result = await getProcessor()(run);
    finalizeChannelStyleDiscoveryRunSuccess(run.runId, result);
  } catch (error) {
    finalizeChannelStyleDiscoveryRunFailure(
      run.runId,
      error instanceof Error ? error.message : "Style discovery failed."
    );
  }
}

function startClaimedRun(run: ChannelStyleDiscoveryRunDetail): void {
  const state = getRuntimeState();
  if (state.activeRuns.has(run.runId)) {
    return;
  }
  state.activeRuns.add(run.runId);
  void executeRun(run).finally(() => {
    state.activeRuns.delete(run.runId);
    scheduleChannelStyleDiscoveryProcessing();
  });
}

function runSchedulerPass(): void {
  const state = getRuntimeState();
  const limit = getChannelStyleDiscoveryConcurrencyLimit();
  while (state.activeRuns.size < limit) {
    const claimed = claimNextQueuedChannelStyleDiscoveryRun();
    if (!claimed) {
      break;
    }
    startClaimedRun(claimed);
  }
}

export function scheduleChannelStyleDiscoveryProcessing(): void {
  ensureChannelStyleDiscoveryRuntime();
  const state = getRuntimeState();
  if (state.schedulerPromise) {
    return;
  }
  state.schedulerPromise = Promise.resolve()
    .then(() => {
      runSchedulerPass();
    })
    .finally(() => {
      const latest = getRuntimeState();
      latest.schedulerPromise = null;
      if (
        latest.activeRuns.size < getChannelStyleDiscoveryConcurrencyLimit() &&
        hasQueuedChannelStyleDiscoveryRuns()
      ) {
        scheduleChannelStyleDiscoveryProcessing();
      }
    });
}

export function enqueueAndScheduleChannelStyleDiscoveryRun(input: {
  workspaceId: string;
  creatorUserId: string;
  request: ChannelStyleDiscoveryRequest;
}): ChannelStyleDiscoveryRunDetail {
  const run = createChannelStyleDiscoveryRun(input);
  scheduleChannelStyleDiscoveryProcessing();
  return run;
}

export function getChannelStyleDiscoveryRunOrThrow(runId: string): ChannelStyleDiscoveryRunDetail {
  ensureChannelStyleDiscoveryRuntime();
  scheduleChannelStyleDiscoveryProcessing();
  const run = getChannelStyleDiscoveryRun(runId);
  if (!run) {
    throw new Error("Style discovery run not found.");
  }
  return run;
}
