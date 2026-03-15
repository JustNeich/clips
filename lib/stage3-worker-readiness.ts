import { getExpectedStage3WorkerRuntimeVersion, isStage3WorkerRuntimeVersionCompatible } from "./stage3-worker-runtime-manifest";
import { listStage3Workers } from "./stage3-worker-store";

export type Stage3LocalWorkerReadiness = {
  ready: boolean;
  expectedRuntimeVersion: string | null;
  onlineWorkers: number;
  compatibleOnlineWorkers: number;
};

export async function resolveStage3LocalWorkerReadiness(input: {
  workspaceId: string;
  userId: string;
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

