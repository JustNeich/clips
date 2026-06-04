import { Stage3ExecutionTarget, Stage3JobStatus } from "../app/components/types";

export type Stage3PolledJobKind = "editing-proxy" | "preview" | "render";

const POLL_PROFILES: Record<
  Stage3PolledJobKind,
  {
    queuedMs: number;
    runningMs: number;
    localPenaltyMs: number;
    softBackoffMs: number;
    hardBackoffMs: number;
    hiddenFloorMs: number;
    maxMs: number;
  }
> = {
  "editing-proxy": {
    queuedMs: 1_100,
    runningMs: 950,
    localPenaltyMs: 250,
    softBackoffMs: 250,
    hardBackoffMs: 450,
    hiddenFloorMs: 3_000,
    maxMs: 3_200
  },
  preview: {
    queuedMs: 1_300,
    runningMs: 1_050,
    localPenaltyMs: 350,
    softBackoffMs: 350,
    hardBackoffMs: 600,
    hiddenFloorMs: 3_000,
    maxMs: 3_400
  },
  render: {
    queuedMs: 1_700,
    runningMs: 1_350,
    localPenaltyMs: 450,
    softBackoffMs: 700,
    hardBackoffMs: 1_100,
    hiddenFloorMs: 5_000,
    maxMs: 5_000
  }
};

export function resolveStage3JobPollIntervalMs(params: {
  kind: Stage3PolledJobKind;
  status: Extract<Stage3JobStatus, "queued" | "running">;
  executionTarget: Stage3ExecutionTarget;
  elapsedMs?: number;
  hidden?: boolean;
}): number {
  const profile = POLL_PROFILES[params.kind];
  const elapsedMs = Math.max(0, params.elapsedMs ?? 0);
  let delayMs = params.status === "queued" ? profile.queuedMs : profile.runningMs;

  if (params.executionTarget === "local") {
    delayMs += profile.localPenaltyMs;
  }
  if (elapsedMs >= 15_000) {
    delayMs += profile.softBackoffMs;
  }
  if (elapsedMs >= 45_000) {
    delayMs += profile.hardBackoffMs;
  }
  if (params.hidden) {
    delayMs = Math.max(delayMs, profile.hiddenFloorMs);
  }

  return Math.min(delayMs, profile.maxMs);
}

const TRANSIENT_STATUS_RETRY_WINDOWS_MS: Record<Stage3PolledJobKind, number> = {
  "editing-proxy": 5 * 60_000,
  preview: 5 * 60_000,
  render: 45 * 60_000
};

const TRANSIENT_STATUS_RETRY_CAPS_MS: Record<Stage3PolledJobKind, number> = {
  "editing-proxy": 6_000,
  preview: 8_000,
  render: 15_000
};

export function shouldContinueStage3JobStatusPollingAfterTransient(params: {
  kind: Stage3PolledJobKind;
  elapsedMs: number;
}): boolean {
  return Math.max(0, params.elapsedMs) <= TRANSIENT_STATUS_RETRY_WINDOWS_MS[params.kind];
}

export function resolveStage3JobStatusTransientRetryMs(params: {
  kind: Stage3PolledJobKind;
  transientFailures: number;
  hidden?: boolean;
}): number {
  const failures = Math.max(1, Math.floor(params.transientFailures));
  const capMs = TRANSIENT_STATUS_RETRY_CAPS_MS[params.kind];
  const baseMs = params.kind === "render" ? 2_000 : 1_500;
  const stepMs = params.kind === "render" ? 1_250 : 750;
  const hiddenFloorMs = params.kind === "render" ? 5_000 : 3_000;
  const delayMs = Math.min(capMs, baseMs + (failures - 1) * stepMs);
  return params.hidden ? Math.max(delayMs, hiddenFloorMs) : delayMs;
}
