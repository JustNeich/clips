import { Stage3WorkerStatus } from "../app/components/types";

export function resolveStage3WorkerRefreshIntervalMs(params: {
  workerState: Stage3WorkerStatus | "not_paired";
  pairingActive: boolean;
}): number {
  if (
    params.pairingActive &&
    (params.workerState === "not_paired" || params.workerState === "offline")
  ) {
    return 1_500;
  }
  if (params.workerState === "offline") {
    return 5_000;
  }
  return 10_000;
}
