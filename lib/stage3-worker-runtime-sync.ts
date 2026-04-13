export type Stage3WorkerRuntimeSyncResult = {
  updated: boolean;
  runtimeVersion: string | null;
};

function normalizeRuntimeVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveStage3WorkerAdvertisedVersion(input: {
  bundledRuntimeVersion: string | null | undefined;
  packageVersion: string | null | undefined;
}): string {
  const bundled = normalizeRuntimeVersion(input.bundledRuntimeVersion);
  if (bundled) {
    return bundled;
  }
  const packageVersion = input.packageVersion?.trim();
  return packageVersion ? packageVersion : "0.0.0";
}

export function shouldRestartStage3WorkerAfterSync(input: {
  bundledRuntimeVersion: string | null | undefined;
  syncResult: Stage3WorkerRuntimeSyncResult;
}): boolean {
  if (!input.syncResult.updated) {
    return false;
  }
  const bundled = normalizeRuntimeVersion(input.bundledRuntimeVersion);
  const synced = normalizeRuntimeVersion(input.syncResult.runtimeVersion);
  if (!synced) {
    return true;
  }
  return bundled !== synced;
}

