import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { queueThrottledBackgroundTask } from "./throttled-background-task";

export type Stage3WorkerDownloadedAsset = {
  filePath: string;
  fileName: string | null;
  mimeType: string | null;
};

type CachedWorkerAssetMetadata = {
  version: "worker-asset-cache-v1";
  assetId: string;
  createdAt: string | null;
  fileName: string;
  mimeType: string | null;
  dataFileName: string;
};

const WORKER_ASSET_CACHE_VERSION = "worker-asset-cache-v1";
const WORKER_ASSET_CACHE_LIMITS = {
  maxFiles: 96,
  maxBytes: 2 * 1024 * 1024 * 1024,
  maxAgeMs: 30 * 24 * 60 * 60_000
} as const;
const WORKER_ASSET_CACHE_PRUNE_INTERVAL_MS = 2 * 60_000;

function readWorkerAssetEnv(): { serverOrigin: string; sessionToken: string } | null {
  const serverOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN?.trim();
  const sessionToken = process.env.STAGE3_WORKER_SESSION_TOKEN?.trim();
  if (!serverOrigin || !sessionToken) {
    return null;
  }
  return { serverOrigin: serverOrigin.replace(/\/+$/, ""), sessionToken };
}

function sanitizeFileName(value: string | null | undefined, assetId: string): string {
  const raw = (value ?? "").trim();
  const candidate = raw && !raw.includes("/") && !raw.includes("\\") ? raw : assetId;
  return candidate.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function resolveWorkerAssetCacheRoot(tmpDir: string): string {
  const installRoot = process.env.STAGE3_WORKER_INSTALL_ROOT?.trim();
  if (installRoot) {
    return path.join(installRoot, "cache", "assets");
  }
  return path.join(tmpDir, "stage3-worker-assets");
}

function buildWorkerAssetMetaPath(cacheRoot: string, assetId: string): string {
  return path.join(cacheRoot, `asset-${assetId}.json`);
}

function buildWorkerAssetDataFileName(assetId: string, fileName: string): string {
  return `asset-${assetId}-${fileName}`;
}

async function readCachedWorkerAssetMetadata(
  cacheRoot: string,
  assetId: string
): Promise<CachedWorkerAssetMetadata | null> {
  const metaPath = buildWorkerAssetMetaPath(cacheRoot, assetId);
  try {
    const parsed = JSON.parse(await fs.readFile(metaPath, "utf-8")) as Partial<CachedWorkerAssetMetadata>;
    if (
      parsed.version !== WORKER_ASSET_CACHE_VERSION ||
      parsed.assetId !== assetId ||
      typeof parsed.fileName !== "string" ||
      !parsed.fileName ||
      typeof parsed.dataFileName !== "string" ||
      !parsed.dataFileName
    ) {
      return null;
    }
    return {
      version: WORKER_ASSET_CACHE_VERSION,
      assetId,
      createdAt: typeof parsed.createdAt === "string" && parsed.createdAt.trim() ? parsed.createdAt : null,
      fileName: parsed.fileName,
      mimeType: typeof parsed.mimeType === "string" && parsed.mimeType.trim() ? parsed.mimeType : null,
      dataFileName: parsed.dataFileName
    };
  } catch {
    return null;
  }
}

async function readCachedWorkerAsset(
  cacheRoot: string,
  assetId: string
): Promise<Stage3WorkerDownloadedAsset | null> {
  const metadata = await readCachedWorkerAssetMetadata(cacheRoot, assetId);
  if (!metadata) {
    return null;
  }

  const filePath = path.join(cacheRoot, metadata.dataFileName);
  try {
    await fs.access(filePath);
    const now = new Date();
    await Promise.all([
      fs.utimes(filePath, now, now).catch(() => undefined),
      fs.utimes(buildWorkerAssetMetaPath(cacheRoot, assetId), now, now).catch(() => undefined)
    ]);
    return {
      filePath,
      fileName: metadata.fileName,
      mimeType: metadata.mimeType
    };
  } catch {
    return null;
  }
}

async function writeWorkerAssetResponse(
  response: Response,
  outputPath: string
): Promise<void> {
  if (!response.body) {
    throw new Error("Stage 3 worker asset response did not include a readable body.");
  }
  const partPath = `${outputPath}.part-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as any),
      createWriteStream(partPath)
    );
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
    await fs.rename(partPath, outputPath);
  } catch (error) {
    await fs.rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function pruneWorkerAssetCache(cacheRoot: string): Promise<void> {
  const now = Date.now();
  const entries = await fs.readdir(cacheRoot).catch(() => []);
  const assetFiles = (
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith("asset-") && !entry.endsWith(".json") && !entry.includes(".part-"))
        .map(async (entry) => {
          const filePath = path.join(cacheRoot, entry);
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

  const fresh = assetFiles
    .filter((file) => now - file.mtimeMs <= WORKER_ASSET_CACHE_LIMITS.maxAgeMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  const expired = assetFiles.filter((file) => now - file.mtimeMs > WORKER_ASSET_CACHE_LIMITS.maxAgeMs);

  for (const file of expired) {
    await fs.rm(file.filePath, { force: true }).catch(() => undefined);
  }

  let totalBytes = fresh.reduce((sum, file) => sum + file.sizeBytes, 0);
  for (let index = WORKER_ASSET_CACHE_LIMITS.maxFiles; index < fresh.length; index += 1) {
    const file = fresh[index];
    if (!file) {
      continue;
    }
    totalBytes -= file.sizeBytes;
    await fs.rm(file.filePath, { force: true }).catch(() => undefined);
  }

  const sized = fresh.slice(0, WORKER_ASSET_CACHE_LIMITS.maxFiles);
  for (let index = sized.length - 1; index >= 0 && totalBytes > WORKER_ASSET_CACHE_LIMITS.maxBytes; index -= 1) {
    const file = sized[index];
    if (!file) {
      continue;
    }
    totalBytes -= file.sizeBytes;
    await fs.rm(file.filePath, { force: true }).catch(() => undefined);
  }

  const remainingEntries = await fs.readdir(cacheRoot).catch(() => []);
  await Promise.all(
    remainingEntries
      .filter((entry) => entry.startsWith("asset-") && entry.endsWith(".json"))
      .map(async (entry) => {
        const metaPath = path.join(cacheRoot, entry);
        const meta = await readCachedWorkerAssetMetadata(cacheRoot, entry.slice("asset-".length, -".json".length));
        if (!meta) {
          await fs.rm(metaPath, { force: true }).catch(() => undefined);
          return;
        }
        const filePath = path.join(cacheRoot, meta.dataFileName);
        const exists = await fs
          .access(filePath)
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          await fs.rm(metaPath, { force: true }).catch(() => undefined);
        }
      })
  );
}

export async function maybeDownloadStage3WorkerAsset(params: {
  channelId: string;
  assetId: string;
  tmpDir: string;
  suggestedFileName?: string | null;
}): Promise<Stage3WorkerDownloadedAsset | null> {
  const workerEnv = readWorkerAssetEnv();
  if (!workerEnv) {
    return null;
  }
  const cacheRoot = resolveWorkerAssetCacheRoot(params.tmpDir);
  await fs.mkdir(cacheRoot, { recursive: true });
  const cached = await readCachedWorkerAsset(cacheRoot, params.assetId);
  if (cached) {
    return cached;
  }

  const previousMeta = await readCachedWorkerAssetMetadata(cacheRoot, params.assetId);

  const url = new URL(`${workerEnv.serverOrigin}/api/stage3/worker/assets/${encodeURIComponent(params.assetId)}`);
  url.searchParams.set("channelId", params.channelId);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${workerEnv.sessionToken}`
    }
  });

  if (response.status === 404) {
    await fs.rm(buildWorkerAssetMetaPath(cacheRoot, params.assetId), { force: true }).catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Failed to fetch Stage 3 asset ${params.assetId}.`);
  }

  const fileName = sanitizeFileName(
    response.headers.get("x-stage3-asset-file-name") || params.suggestedFileName,
    params.assetId
  );
  const outputPath = path.join(cacheRoot, buildWorkerAssetDataFileName(params.assetId, fileName));
  await writeWorkerAssetResponse(response, outputPath);
  await fs.writeFile(
    buildWorkerAssetMetaPath(cacheRoot, params.assetId),
    JSON.stringify(
      {
        version: WORKER_ASSET_CACHE_VERSION,
        assetId: params.assetId,
        createdAt: response.headers.get("x-stage3-asset-created-at"),
        fileName,
        mimeType: response.headers.get("content-type"),
        dataFileName: path.basename(outputPath)
      } satisfies CachedWorkerAssetMetadata,
      null,
      2
    ),
    "utf-8"
  );
  if (previousMeta?.dataFileName && previousMeta.dataFileName !== path.basename(outputPath)) {
    await fs.rm(path.join(cacheRoot, previousMeta.dataFileName), { force: true }).catch(() => undefined);
  }
  queueThrottledBackgroundTask(
    `stage3-worker-asset-prune:${cacheRoot}`,
    WORKER_ASSET_CACHE_PRUNE_INTERVAL_MS,
    () => pruneWorkerAssetCache(cacheRoot)
  );
  return {
    filePath: outputPath,
    fileName,
    mimeType: response.headers.get("content-type")
  };
}
