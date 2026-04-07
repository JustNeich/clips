import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { getAppDataDir } from "./app-paths";
import { downloadSourceMedia } from "./source-acquisition";
import { isUploadedSourceUrl } from "./uploaded-source";
import { normalizeSupportedUrl } from "./ytdlp";

export type SourceMediaCacheState = "hit" | "miss" | "wait";

export type CachedSourceMedia = {
  sourcePath: string;
  sourceKey: string;
  fileName: string;
  title: string | null;
  videoSizeBytes: number;
  downloadProvider: "visolix" | "ytDlp" | "upload";
  primaryProviderError: string | null;
  downloadFallbackUsed: boolean;
  cacheState: SourceMediaCacheState;
};

type CachedSourceMediaCore = Omit<CachedSourceMedia, "cacheState">;

type CachedSourceMediaMeta = {
  fileName: string;
  title: string | null;
  videoSizeBytes: number;
  downloadProvider: "visolix" | "ytDlp" | "upload";
  primaryProviderError: string | null;
  downloadFallbackUsed: boolean;
  sticky?: boolean;
};

const SOURCE_MEDIA_CACHE_MAX_ENTRIES = 24;
const SOURCE_MEDIA_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
const sourceMediaInflight = new Map<string, Promise<CachedSourceMediaCore>>();

function getSourceMediaCacheRoot(): string {
  return path.join(getAppDataDir(), "source-media-cache");
}

function getSourceMediaCacheDir(): string {
  return path.join(getSourceMediaCacheRoot(), "sources");
}

function hashKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

export function getSourceMediaCacheKey(rawUrl: string): string {
  return hashKey(normalizeSupportedUrl(rawUrl));
}

function buildMetaPath(sourceKey: string): string {
  return path.join(getSourceMediaCacheDir(), `${sourceKey}.json`);
}

function buildSourcePath(sourceKey: string): string {
  return path.join(getSourceMediaCacheDir(), `${sourceKey}.mp4`);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readMeta(sourceKey: string): Promise<CachedSourceMediaMeta> {
  const raw = await fs.readFile(buildMetaPath(sourceKey), "utf-8").catch(() => "");
  if (!raw) {
    return {
      fileName: `${sourceKey}.mp4`,
      title: null,
      videoSizeBytes: 0,
      downloadProvider: "ytDlp",
      primaryProviderError: null,
      downloadFallbackUsed: false
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CachedSourceMediaMeta>;
    return {
      fileName:
        typeof parsed.fileName === "string" && parsed.fileName.trim()
          ? parsed.fileName.trim()
          : `${sourceKey}.mp4`,
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : null,
      videoSizeBytes:
        typeof parsed.videoSizeBytes === "number" && Number.isFinite(parsed.videoSizeBytes) && parsed.videoSizeBytes >= 0
          ? parsed.videoSizeBytes
          : 0,
      downloadProvider:
        parsed.downloadProvider === "visolix"
          ? "visolix"
          : parsed.downloadProvider === "upload"
            ? "upload"
            : "ytDlp",
      primaryProviderError:
        typeof parsed.primaryProviderError === "string" && parsed.primaryProviderError.trim()
          ? parsed.primaryProviderError.trim()
          : null,
      downloadFallbackUsed: parsed.downloadFallbackUsed === true,
      sticky: parsed.sticky === true
    };
  } catch {
    return {
      fileName: `${sourceKey}.mp4`,
      title: null,
      videoSizeBytes: 0,
      downloadProvider: "ytDlp",
      primaryProviderError: null,
      downloadFallbackUsed: false,
      sticky: false
    };
  }
}

async function writeMeta(sourceKey: string, meta: CachedSourceMediaMeta): Promise<void> {
  await fs.writeFile(buildMetaPath(sourceKey), `${JSON.stringify(meta)}\n`, "utf-8");
}

async function pruneSourceMediaCache(): Promise<void> {
  const now = Date.now();
  const cacheDir = getSourceMediaCacheDir();
  const entries = await fs.readdir(cacheDir).catch(() => []);
  const filesWithMeta = (
    await Promise.all(
      entries
        .filter((name) => name.endsWith(".mp4"))
        .map(async (name) => {
          const filePath = path.join(cacheDir, name);
          const stat = await fs.stat(filePath).catch(() => null);
          if (!stat?.isFile()) {
            return null;
          }
          const sourceKey = path.basename(name, ".mp4");
          const meta = await readMeta(sourceKey);
          return {
            filePath,
            metaPath: buildMetaPath(sourceKey),
            mtimeMs: stat.mtimeMs,
            sticky: meta.sticky === true
          };
        })
    )
  ).filter(
    (entry): entry is { filePath: string; metaPath: string; mtimeMs: number; sticky: boolean } => Boolean(entry)
  );

  const stale = filesWithMeta.filter((entry) => !entry.sticky && now - entry.mtimeMs > SOURCE_MEDIA_CACHE_MAX_AGE_MS);
  await Promise.all(
    stale.flatMap((entry) => [
      fs.rm(entry.filePath, { force: true }).catch(() => undefined),
      fs.rm(entry.metaPath, { force: true }).catch(() => undefined)
    ])
  );

  const nonStale = filesWithMeta.filter((entry) => !stale.some((candidate) => candidate.filePath === entry.filePath));
  const stickyEntries = nonStale.filter((entry) => entry.sticky);
  const recentNonSticky = nonStale
    .filter((entry) => !entry.sticky)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, SOURCE_MEDIA_CACHE_MAX_ENTRIES);
  const keptPaths = new Set([...stickyEntries, ...recentNonSticky].map((entry) => entry.filePath));
  const overflow = nonStale.filter((entry) => !entry.sticky && !keptPaths.has(entry.filePath));

  await Promise.all(
    overflow.flatMap((entry) => [
      fs.rm(entry.filePath, { force: true }).catch(() => undefined),
      fs.rm(entry.metaPath, { force: true }).catch(() => undefined)
    ])
  );
}

export async function ensureSourceMediaCached(rawUrl: string): Promise<CachedSourceMedia> {
  const sourceUrl = normalizeSupportedUrl(rawUrl);
  const sourceKey = getSourceMediaCacheKey(sourceUrl);
  const sourcePath = buildSourcePath(sourceKey);

  if (await pathExists(sourcePath)) {
    const meta = await readMeta(sourceKey);
    return {
      sourcePath,
      sourceKey,
      ...meta,
      cacheState: "hit"
    };
  }

  if (isUploadedSourceUrl(sourceUrl)) {
    throw new Error("Загруженный mp4 не найден в локальном хранилище. Загрузите файл заново.");
  }

  const running = sourceMediaInflight.get(sourceKey);
  if (running) {
    const resolved = await running;
    return {
      ...resolved,
      cacheState: "wait"
    };
  }

  const task = (async (): Promise<CachedSourceMediaCore> => {
    await fs.mkdir(getSourceMediaCacheDir(), { recursive: true });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-source-cache-build-"));
    try {
      const downloaded = await downloadSourceMedia(sourceUrl, tmpDir);
      await fs.copyFile(downloaded.filePath, sourcePath);
      const meta: CachedSourceMediaMeta = {
        fileName: downloaded.fileName,
        title: downloaded.title,
        videoSizeBytes: downloaded.videoSizeBytes,
        downloadProvider: downloaded.provider,
        primaryProviderError: downloaded.primaryProviderError,
        downloadFallbackUsed: downloaded.downloadFallbackUsed
      };
      await writeMeta(sourceKey, meta);
      void pruneSourceMediaCache().catch(() => undefined);
      return {
        sourcePath,
        sourceKey,
        ...meta
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  })();

  sourceMediaInflight.set(sourceKey, task);
  try {
    const resolved = await task;
    return {
      ...resolved,
      cacheState: "miss"
    };
  } finally {
    sourceMediaInflight.delete(sourceKey);
  }
}

export async function storeUploadedSourceMedia(input: {
  sourceUrl: string;
  fileName: string;
  title?: string | null;
  sourceStream: ReadableStream<Uint8Array>;
  maxBytes?: number;
}): Promise<CachedSourceMedia> {
  const sourceUrl = normalizeSupportedUrl(input.sourceUrl);
  const sourceKey = getSourceMediaCacheKey(sourceUrl);
  const sourcePath = buildSourcePath(sourceKey);
  const tmpPath = path.join(getSourceMediaCacheDir(), `${sourceKey}.uploading`);
  const maxBytes = Number.isFinite(input.maxBytes) ? Number(input.maxBytes) : null;
  let sizeBytes = 0;

  await fs.mkdir(getSourceMediaCacheDir(), { recursive: true });

  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.byteLength;
      if (maxBytes && sizeBytes > maxBytes) {
        callback(new Error("Файл слишком большой."));
        return;
      }
      callback(null, buffer);
    }
  });

  try {
    await pipeline(Readable.fromWeb(input.sourceStream as never), counter, createWriteStream(tmpPath));
    if (sizeBytes <= 0) {
      throw new Error("Файл пустой.");
    }
    await fs.rename(tmpPath, sourcePath);
    const meta: CachedSourceMediaMeta = {
      fileName: input.fileName.trim() || `${sourceKey}.mp4`,
      title: input.title?.trim() || path.parse(input.fileName).name || null,
      videoSizeBytes: sizeBytes,
      downloadProvider: "upload",
      primaryProviderError: null,
      downloadFallbackUsed: false,
      sticky: true
    };
    await writeMeta(sourceKey, meta);
    return {
      sourcePath,
      sourceKey,
      ...meta,
      cacheState: "miss"
    };
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
