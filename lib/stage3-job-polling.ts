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
