import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadSourceVideo, probeVideoDurationSeconds } from "./stage3-media-agent";
import { normalizeSupportedUrl } from "./ytdlp";

export type Stage3CachedSource = {
  sourcePath: string;
  sourceDurationSec: number | null;
  sourceKey: string;
  fileName: string;
};

export type Stage3HostedJobOptions = {
  signal?: AbortSignal | null;
  waitTimeoutMs?: number | null;
};

const STAGE3_CACHE_ROOT = path.join(os.tmpdir(), "clip-stage3-cache");
const SOURCE_CACHE_DIR = path.join(STAGE3_CACHE_ROOT, "sources");
const sourceInflight = new Map<string, Promise<Stage3CachedSource>>();
let hostedHeavyJobActive = 0;
const hostedHeavyWaiters: Array<{
  settled: boolean;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  signal: AbortSignal | null;
  abortHandler: (() => void) | null;
}> = [];
const hostedHeavyJobContext = new AsyncLocalStorage<boolean>();

export class Stage3HostedBusyError extends Error {
  constructor(message = "Hosted Stage 3 worker is busy") {
    super(message);
    this.name = "Stage3HostedBusyError";
  }
}

function hashKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function readMetaFileName(
  rawMeta: string,
  sourceKey: string
): { fileName: string; sourceDurationSec: number | null } {
  if (!rawMeta) {
    return {
      fileName: `${sourceKey}.mp4`,
      sourceDurationSec: null
    };
  }

  try {
    const parsed = JSON.parse(rawMeta) as { fileName?: unknown; sourceDurationSec?: unknown };
    return {
      fileName:
        typeof parsed.fileName === "string" && parsed.fileName.trim()
          ? parsed.fileName.trim()
          : `${sourceKey}.mp4`,
      sourceDurationSec:
        typeof parsed.sourceDurationSec === "number" && Number.isFinite(parsed.sourceDurationSec)
          ? parsed.sourceDurationSec
          : null
    };
  } catch {
    return {
      fileName: `${sourceKey}.mp4`,
      sourceDurationSec: null
    };
  }
}

async function pruneDirectory(dirPath: string, maxFiles: number): Promise<void> {
  const entries = await fs.readdir(dirPath).catch(() => []);
  if (entries.length <= maxFiles) {
    return;
  }

  const files = await Promise.all(
    entries.map(async (name) => {
      const filePath = path.join(dirPath, name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile()) {
        return null;
      }
      return { filePath, mtimeMs: stat.mtimeMs };
    })
  );

  const stale = files
    .filter((item): item is { filePath: string; mtimeMs: number } => Boolean(item))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(maxFiles);

  await Promise.all(stale.map((item) => fs.rm(item.filePath, { force: true }).catch(() => undefined)));
}

export function isStage3HostedRuntime(): boolean {
  return process.env.RENDER === "true" || process.env.RENDER === "1";
}

export function isStage3HostedBusyError(error: unknown): error is Stage3HostedBusyError {
  return error instanceof Stage3HostedBusyError;
}

function clearHostedWaiter(waiter: (typeof hostedHeavyWaiters)[number]): void {
  if (waiter.timeoutId !== null) {
    clearTimeout(waiter.timeoutId);
    waiter.timeoutId = null;
  }
  if (waiter.signal && waiter.abortHandler) {
    waiter.signal.removeEventListener("abort", waiter.abortHandler);
    waiter.abortHandler = null;
  }
}

function removeHostedWaiter(waiter: (typeof hostedHeavyWaiters)[number]): void {
  const index = hostedHeavyWaiters.indexOf(waiter);
  if (index >= 0) {
    hostedHeavyWaiters.splice(index, 1);
  }
}

function createHostedSlotRelease(): () => void {
  let released = false;
  return () => {
    if (released || !isStage3HostedRuntime()) {
      return;
    }
    released = true;
    hostedHeavyJobActive = Math.max(0, hostedHeavyJobActive - 1);
    while (hostedHeavyJobActive === 0 && hostedHeavyWaiters.length > 0) {
      const next = hostedHeavyWaiters.shift();
      if (!next || next.settled) {
        continue;
      }
      next.settled = true;
      clearHostedWaiter(next);
      hostedHeavyJobActive += 1;
      next.resolve(createHostedSlotRelease());
      return;
    }
  };
}

async function acquireHostedStage3Slot(options?: Stage3HostedJobOptions): Promise<() => void> {
  if (!isStage3HostedRuntime() || hostedHeavyJobContext.getStore()) {
    return () => undefined;
  }
  if (hostedHeavyJobActive === 0 && hostedHeavyWaiters.length === 0) {
    hostedHeavyJobActive += 1;
    return createHostedSlotRelease();
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      settled: false,
      resolve,
      reject,
      timeoutId: null as ReturnType<typeof setTimeout> | null,
      signal: options?.signal ?? null,
      abortHandler: null as (() => void) | null
    };

    const abortWait = () => {
      if (waiter.settled) {
        return;
      }
      waiter.settled = true;
      removeHostedWaiter(waiter);
      clearHostedWaiter(waiter);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    if (waiter.signal?.aborted) {
      abortWait();
      return;
    }

    const waitTimeoutMs =
      typeof options?.waitTimeoutMs === "number" && Number.isFinite(options.waitTimeoutMs) && options.waitTimeoutMs > 0
        ? options.waitTimeoutMs
        : null;

    if (waitTimeoutMs !== null) {
      waiter.timeoutId = setTimeout(() => {
        if (waiter.settled) {
          return;
        }
        waiter.settled = true;
        removeHostedWaiter(waiter);
        clearHostedWaiter(waiter);
        reject(new Stage3HostedBusyError());
      }, waitTimeoutMs);
    }

    if (waiter.signal) {
      waiter.abortHandler = abortWait;
      waiter.signal.addEventListener("abort", abortWait, { once: true });
    }

    hostedHeavyWaiters.push(waiter);
  });
}

export async function runHostedStage3HeavyJob<T>(
  task: () => Promise<T>,
  options?: Stage3HostedJobOptions
): Promise<T> {
  if (!isStage3HostedRuntime()) {
    return task();
  }
  if (hostedHeavyJobContext.getStore()) {
    return task();
  }

  const release = await acquireHostedStage3Slot(options);
  try {
    if (options?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    return await hostedHeavyJobContext.run(true, task);
  } finally {
    release();
  }
}

export async function ensureStage3SourceCached(
  rawSource: string,
  options?: Stage3HostedJobOptions
): Promise<Stage3CachedSource> {
  const sourceUrl = normalizeSupportedUrl(rawSource);
  const sourceKey = hashKey(sourceUrl);
  const sourcePath = path.join(SOURCE_CACHE_DIR, `${sourceKey}.mp4`);
  const metaPath = path.join(SOURCE_CACHE_DIR, `${sourceKey}.json`);

  if (await pathExists(sourcePath)) {
    const rawMeta = await fs.readFile(metaPath, "utf-8").catch(() => "");
    const meta = readMetaFileName(rawMeta, sourceKey);
    const sourceDurationSec = meta.sourceDurationSec ?? (await probeVideoDurationSeconds(sourcePath));

    if (!rawMeta || meta.sourceDurationSec === null) {
      await fs
        .writeFile(
          metaPath,
          JSON.stringify({
            fileName: meta.fileName,
            sourceDurationSec
          }),
          "utf-8"
        )
        .catch(() => undefined);
    }

    return {
      sourcePath,
      sourceDurationSec,
      sourceKey,
      fileName: meta.fileName
    };
  }

  const running = sourceInflight.get(sourceKey);
  if (running) {
    return running;
  }

  const task = (async () => {
    await fs.mkdir(SOURCE_CACHE_DIR, { recursive: true });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-source-cache-"));
    try {
      const downloaded = await runHostedStage3HeavyJob(() => downloadSourceVideo(sourceUrl, tmpDir), options);
      await fs.copyFile(downloaded.filePath, sourcePath);
      const sourceDurationSec = await probeVideoDurationSeconds(sourcePath);
      await fs
        .writeFile(
          metaPath,
          JSON.stringify({
            fileName: downloaded.fileName,
            sourceDurationSec
          }),
          "utf-8"
        )
        .catch(() => undefined);

      return {
        sourcePath,
        sourceDurationSec,
        sourceKey,
        fileName: downloaded.fileName
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  })();

  sourceInflight.set(sourceKey, task);
  try {
    return await task;
  } finally {
    sourceInflight.delete(sourceKey);
  }
}

export async function pruneStage3SourceCache(maxFiles: number): Promise<void> {
  await pruneDirectory(SOURCE_CACHE_DIR, maxFiles);
}
