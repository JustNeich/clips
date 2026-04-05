import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAppDataDir } from "./app-paths";
import { downloadSourceMedia } from "./source-acquisition";
import { normalizeSupportedUrl } from "./ytdlp";

export type SourceMediaCacheState = "hit" | "miss" | "wait";

export type CachedSourceMedia = {
  sourcePath: string;
  sourceKey: string;
  fileName: string;
  title: string | null;
  videoSizeBytes: number;
  downloadProvider: "visolix" | "ytDlp";
  primaryProviderError: string | null;
  downloadFallbackUsed: boolean;
  cacheState: SourceMediaCacheState;
};

type CachedSourceMediaCore = Omit<CachedSourceMedia, "cacheState">;

type CachedSourceMediaMeta = {
  fileName: string;
  title: string | null;
  videoSizeBytes: number;
  downloadProvider: "visolix" | "ytDlp";
  primaryProviderError: string | null;
  downloadFallbackUsed: boolean;
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
      downloadProvider: parsed.downloadProvider === "visolix" ? "visolix" : "ytDlp",
      primaryProviderError:
        typeof parsed.primaryProviderError === "string" && parsed.primaryProviderError.trim()
          ? parsed.primaryProviderError.trim()
          : null,
      downloadFallbackUsed: parsed.downloadFallbackUsed === true
    };
  } catch {
    return {
      fileName: `${sourceKey}.mp4`,
      title: null,
      videoSizeBytes: 0,
      downloadProvider: "ytDlp",
      primaryProviderError: null,
      downloadFallbackUsed: false
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
  const files = (
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
          return {
            filePath,
            metaPath: buildMetaPath(sourceKey),
            mtimeMs: stat.mtimeMs
          };
        })
    )
  ).filter((entry): entry is { filePath: string; metaPath: string; mtimeMs: number } => Boolean(entry));

  const stale = files.filter((entry) => now - entry.mtimeMs > SOURCE_MEDIA_CACHE_MAX_AGE_MS);
  await Promise.all(
    stale.flatMap((entry) => [
      fs.rm(entry.filePath, { force: true }).catch(() => undefined),
      fs.rm(entry.metaPath, { force: true }).catch(() => undefined)
    ])
  );

  const fresh = files
    .filter((entry) => now - entry.mtimeMs <= SOURCE_MEDIA_CACHE_MAX_AGE_MS)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, SOURCE_MEDIA_CACHE_MAX_ENTRIES);
  const freshPaths = new Set(fresh.map((entry) => entry.filePath));
  const overflow = files.filter((entry) => !freshPaths.has(entry.filePath));

  await Promise.all(
    overflow.flatMap((entry) => [
      fs.rm(entry.filePath, { force: true }).catch(() => undefined),
      fs.rm(entry.metaPath, { force: true }).catch(() => undefined)
    ])
  );
}

export async function ensureSourceMediaCached(rawUrl: string): Promise<CachedSourceMedia> {
  const sourceUrl = normalizeSupportedUrl(rawUrl);
  const sourceKey = hashKey(sourceUrl);
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
