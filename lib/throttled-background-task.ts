type BackgroundTaskState = {
  scheduledAtMs: number;
  promise: Promise<void> | null;
};

type BackgroundTaskScope = typeof globalThis & {
  __clipsThrottledBackgroundTasks__?: Map<string, BackgroundTaskState>;
};

function getTaskStateMap(): Map<string, BackgroundTaskState> {
  const scope = globalThis as BackgroundTaskScope;
  if (!scope.__clipsThrottledBackgroundTasks__) {
    scope.__clipsThrottledBackgroundTasks__ = new Map<string, BackgroundTaskState>();
  }
  return scope.__clipsThrottledBackgroundTasks__;
}

export function queueThrottledBackgroundTask(
  key: string,
  minIntervalMs: number,
  task: () => Promise<void>
): boolean {
  const tasks = getTaskStateMap();
  const now = Date.now();
  const current = tasks.get(key);
  if (current?.promise) {
    return false;
  }
  if (current && now - current.scheduledAtMs < Math.max(0, minIntervalMs)) {
    return false;
  }

  const next: BackgroundTaskState = {
    scheduledAtMs: now,
    promise: null
  };

  const promise = Promise.resolve()
    .then(task)
    .catch(() => undefined)
    .finally(() => {
      const latest = tasks.get(key);
      if (latest?.promise === promise) {
        latest.promise = null;
      }
    });

  next.promise = promise;
  tasks.set(key, next);
  return true;
}

export function resetThrottledBackgroundTaskStateForTests(): void {
  getTaskStateMap().clear();
}
