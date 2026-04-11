const RECOVERY_STORAGE_PREFIX = "clips:dynamic-import-recovery:";

export type DynamicImportRecoveryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function isRecoverableDynamicImportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const label = `${error.name} ${error.message}`.trim();
  return (
    /ChunkLoadError/i.test(label) ||
    /Loading chunk [^\s]+ failed/i.test(label) ||
    /Failed to fetch dynamically imported module/i.test(label)
  );
}

function getDynamicImportRecoveryStorage(): DynamicImportRecoveryStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function buildRecoveryStorageKey(id: string): string {
  return `${RECOVERY_STORAGE_PREFIX}${id}`;
}

export async function loadDynamicImportWithRecovery<T>(
  loader: () => Promise<T>,
  options: {
    id: string;
    storage?: DynamicImportRecoveryStorage | null;
    reload?: () => void;
    isClient?: boolean;
  }
): Promise<T> {
  const storage = options.storage ?? getDynamicImportRecoveryStorage();
  const isClient = options.isClient ?? typeof window !== "undefined";
  const recoveryKey = buildRecoveryStorageKey(options.id);

  try {
    const loaded = await loader();
    storage?.removeItem(recoveryKey);
    return loaded;
  } catch (error) {
    if (!isClient || !isRecoverableDynamicImportError(error)) {
      throw error;
    }

    const alreadyReloaded = storage?.getItem(recoveryKey) === "1";
    if (!alreadyReloaded) {
      storage?.setItem(recoveryKey, "1");
      if (options.reload) {
        options.reload();
        throw error;
      }
      window.location.reload();
      return await new Promise<T>(() => undefined);
    }

    storage?.removeItem(recoveryKey);
    throw error;
  }
}
