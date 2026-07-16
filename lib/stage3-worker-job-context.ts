import { AsyncLocalStorage } from "node:async_hooks";

export type Stage3WorkerJobResourceContext = {
  cpuCount: number;
  loadAverage1m: number;
  availableMemoryBytes: number;
};

export type Stage3WorkerJobContext = {
  jobId: string;
  resources: Stage3WorkerJobResourceContext | null;
};

const storage = new AsyncLocalStorage<Stage3WorkerJobContext>();

export function runWithStage3WorkerJobContext<T>(
  context: Stage3WorkerJobContext,
  run: () => Promise<T>
): Promise<T> {
  return storage.run(context, run);
}

export function getStage3WorkerJobContext(): Stage3WorkerJobContext | null {
  return storage.getStore() ?? null;
}

export function getStage3WorkerCurrentJobId(): string | null {
  return getStage3WorkerJobContext()?.jobId ?? null;
}
