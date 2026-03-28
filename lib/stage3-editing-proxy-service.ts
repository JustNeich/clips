import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAppDataDir } from "./app-paths";
import { STAGE3_EDITING_PROXY_CACHE_VERSION } from "./stage3-editing-proxy-contract";
import { prepareStage3EditingProxy as buildStage3EditingProxy } from "./stage3-media-agent";
import {
  ensureStage3SourceCached,
  runHostedStage3HeavyJob
} from "./stage3-server-control";
import { extractYtDlpErrorFromUnknown, isSupportedUrl, normalizeSupportedUrl } from "./ytdlp";

export const EDITING_PROXY_WAIT_TIMEOUT_MS = 20_000;
const EDITING_PROXY_CACHE_ROOT = path.join(getAppDataDir(), "stage3-cache");
const EDITING_PROXY_CACHE_DIR = path.join(EDITING_PROXY_CACHE_ROOT, "editing-proxies");
const editingProxyInflight = new Map<string, Promise<void>>();

export type Stage3EditingProxyRequestBody = {
  sourceUrl?: string;
};

export type Stage3PreparedEditingProxy = {
  filePath: string;
  sourceDurationSec: number | null;
  sourceKey: string;
  fileName: string;
  cacheState: "hit" | "miss" | "wait";
};

function hashKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function pathExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function pruneCacheDirectory(dirPath: string, options: { maxFiles: number; maxBytes: number; maxAgeMs: number }) {
  const now = Date.now();
  const entries = await fs.readdir(dirPath).catch(() => []);
  const files = (
    await Promise.all(
      entries.map(async (name) => {
        const filePath = path.join(dirPath, name);
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile()) {
          return null;
        }
        return {
          filePath,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs
        };
      })
    )
  ).filter((item): item is { filePath: string; sizeBytes: number; mtimeMs: number } => Boolean(item));

  const expired = files.filter((file) => now - file.mtimeMs > options.maxAgeMs);
  await Promise.all(expired.map((file) => fs.rm(file.filePath, { force: true }).catch(() => undefined)));

  const fresh = files
    .filter((file) => now - file.mtimeMs <= options.maxAgeMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  let totalBytes = fresh.reduce((sum, file) => sum + file.sizeBytes, 0);
  for (let index = options.maxFiles; index < fresh.length; index += 1) {
    const file = fresh[index];
    totalBytes -= file.sizeBytes;
    await fs.rm(file.filePath, { force: true }).catch(() => undefined);
  }

  const sized = fresh.slice(0, options.maxFiles);
  for (let index = sized.length - 1; index >= 0 && totalBytes > options.maxBytes; index -= 1) {
    totalBytes -= sized[index].sizeBytes;
    await fs.rm(sized[index].filePath, { force: true }).catch(() => undefined);
  }
}

function resolveSourceUrl(rawSource: string | undefined): string {
  const sourceUrl = normalizeSupportedUrl(rawSource?.trim() ?? "");
  if (!sourceUrl) {
    throw new Error("Передайте sourceUrl в теле запроса.");
  }
  if (!isSupportedUrl(sourceUrl)) {
    throw new Error("Не удалось подготовить proxy-видео для редактора. Проверьте ссылку на ролик из Шага 1.");
  }
  return sourceUrl;
}

export async function buildStage3EditingProxyDedupeKey(
  body: Stage3EditingProxyRequestBody,
  scope?: { workspaceId?: string | null; userId?: string | null }
): Promise<string> {
  const sourceUrl = resolveSourceUrl(body.sourceUrl);
  const workspaceId = scope?.workspaceId?.trim() ?? "";
  const userId = scope?.userId?.trim() ?? "";
  const sourceKey = hashKey(sourceUrl);
  if (!workspaceId || !userId) {
    return `editing-proxy:${STAGE3_EDITING_PROXY_CACHE_VERSION}:global:${sourceKey}`;
  }
  return `editing-proxy:${STAGE3_EDITING_PROXY_CACHE_VERSION}:${workspaceId}:${userId}:${sourceKey}`;
}

export async function prepareStage3EditingProxy(
  body: Stage3EditingProxyRequestBody,
  options?: { signal?: AbortSignal; waitTimeoutMs?: number | null }
): Promise<Stage3PreparedEditingProxy> {
  const sourceUrl = resolveSourceUrl(body.sourceUrl);
  const waitTimeoutMs =
    typeof options?.waitTimeoutMs === "number" && Number.isFinite(options.waitTimeoutMs) && options.waitTimeoutMs > 0
      ? options.waitTimeoutMs
      : EDITING_PROXY_WAIT_TIMEOUT_MS;
  const source = await ensureStage3SourceCached(sourceUrl, {
    signal: options?.signal,
    waitTimeoutMs
  });
  await fs.mkdir(EDITING_PROXY_CACHE_DIR, { recursive: true });
  const proxyKey = `${source.sourceKey}-${STAGE3_EDITING_PROXY_CACHE_VERSION}`;
  const proxyPath = path.join(EDITING_PROXY_CACHE_DIR, `${proxyKey}.mp4`);

  if (await pathExists(proxyPath)) {
    return {
      filePath: proxyPath,
      sourceDurationSec: source.sourceDurationSec,
      sourceKey: source.sourceKey,
      fileName: `${path.parse(source.fileName).name || source.sourceKey}.editing-proxy.mp4`,
      cacheState: "hit"
    };
  }

  const running = editingProxyInflight.get(proxyKey);
  const waitedForExistingTask = Boolean(running);
  if (running) {
    await running;
  } else {
    const task = (async () => {
      const localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-editing-proxy-"));
      try {
        if (options?.signal?.aborted) {
          return;
        }
        const prepared = await runHostedStage3HeavyJob(
          () =>
            buildStage3EditingProxy({
              sourcePath: source.sourcePath,
              tmpDir: localTmpDir,
              sourceFileName: source.fileName
            }),
          {
            signal: options?.signal,
            waitTimeoutMs
          }
        );
        if (options?.signal?.aborted) {
          return;
        }
        const publishPath = `${proxyPath}.part-${hashKey(`${Date.now()}-${Math.random()}`)}`;
        await fs.copyFile(prepared.proxyPath, publishPath);
        await fs.rename(publishPath, proxyPath);
      } finally {
        await fs.rm(localTmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    })();
    editingProxyInflight.set(proxyKey, task);
    try {
      await task;
    } finally {
      editingProxyInflight.delete(proxyKey);
    }
  }

  if (options?.signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  if (!(await pathExists(proxyPath))) {
    throw new Error("Не удалось подготовить proxy-видео для редактора. Повторите ещё раз.");
  }

  await pruneCacheDirectory(EDITING_PROXY_CACHE_DIR, {
    maxFiles: 24,
    maxBytes: 768 * 1024 * 1024,
    maxAgeMs: 6 * 60 * 60_000
  }).catch(() => undefined);

  return {
    filePath: proxyPath,
    sourceDurationSec: source.sourceDurationSec,
    sourceKey: source.sourceKey,
    fileName: `${path.parse(source.fileName).name || source.sourceKey}.editing-proxy.mp4`,
    cacheState: waitedForExistingTask ? "wait" : "miss"
  };
}

export function summarizeStage3EditingProxyError(error: unknown): string {
  const ytdlpMessage = extractYtDlpErrorFromUnknown(error);
  if (ytdlpMessage) {
    return ytdlpMessage;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Stage 3 editing proxy failed.";
}
