import { getExpectedStage3WorkerRuntimeVersion, isStage3WorkerRuntimeVersionCompatible } from "./stage3-worker-runtime-manifest";
import { getStage3WorkerById, listStage3Workers } from "./stage3-worker-store";

export type Stage3LocalWorkerReadiness = {
  ready: boolean;
  expectedRuntimeVersion: string | null;
  onlineWorkers: number;
  compatibleOnlineWorkers: number;
};

export async function resolveStage3LocalWorkerReadiness(input: {
  workspaceId: string;
  userId?: string | null;
}): Promise<Stage3LocalWorkerReadiness> {
  const expectedRuntimeVersion = await getExpectedStage3WorkerRuntimeVersion();
  const workers = listStage3Workers({
    workspaceId: input.workspaceId,
    userId: input.userId
  });
  const onlineWorkers = workers.filter((worker) => worker.status !== "offline").length;
  const compatibleOnlineWorkers = workers.filter((worker) => {
    if (worker.status === "offline") {
      return false;
    }
    return isStage3WorkerRuntimeVersionCompatible({
      workerAppVersion: worker.appVersion,
      expectedRuntimeVersion
    });
  }).length;

  return {
    ready: compatibleOnlineWorkers > 0,
    expectedRuntimeVersion,
    onlineWorkers,
    compatibleOnlineWorkers
  };
}

export async function resolveRequiredStage3WorkerReadiness(input: {
  workspaceId: string;
  userId?: string | null;
  workerId: string;
}) {
  const expectedRuntimeVersion = await getExpectedStage3WorkerRuntimeVersion();
  const worker = getStage3WorkerById(input);
  const active = worker?.status === "online" || worker?.status === "busy";
  const compatible = Boolean(
    worker &&
      active &&
      isStage3WorkerRuntimeVersionCompatible({
        workerAppVersion: worker.appVersion,
        expectedRuntimeVersion
      })
  );
  return {
    ready: compatible,
    expectedRuntimeVersion,
    worker,
    reason: !worker
      ? "worker_not_found"
      : !active
        ? "worker_offline"
        : compatible
          ? null
          : "worker_runtime_outdated"
  } as const;
}
