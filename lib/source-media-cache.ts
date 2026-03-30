import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAppDataDir } from "./app-paths";
import {
  downloadSourceMedia,
  type SourceAcquisitionProvider,
  type SourceDownloadResult
} from "./source-acquisition";
import { normalizeSupportedUrl } from "./ytdlp";

const DEFAULT_SOURCE_MEDIA_CACHE_LIMIT = 12;

type SourceMediaDownloader = (rawUrl: string, tmpDir: string) => Promise<SourceDownloadResult>;

type SourceMediaCacheGlobal = typeof globalThis & {
  __clipsSourceMediaDownloaderOverride__?: SourceMediaDownloader | null;
};

export type CachedSourceMedia = {
  cacheKey: string;
  sourceUrl: string;
  filePath: string;
  fileName: string;
  title: string | null;
  durationSec: number | null;
  videoSizeBytes: number;
  provider: SourceAcquisitionProvider;
};

type CachedSourceMediaMeta = {
  fileName: string;
  title: string | null;
  durationSec: number | null;
  videoSizeBytes: number;
  provider: SourceAcquisitionProvider;
};

const sourceMediaInflight = new Map<string, Promise<CachedSourceMedia>>();

function getSourceMediaDownloader(): SourceMediaDownloader {
  const scope = globalThis as SourceMediaCacheGlobal;
  return scope.__clipsSourceMediaDownloaderOverride__ ?? downloadSourceMedia;
}

export function setSourceMediaDownloaderForTests(downloader: SourceMediaDownloader | null): void {
  (globalThis as SourceMediaCacheGlobal).__clipsSourceMediaDownloaderOverride__ = downloader;
}

function getSourceMediaCacheDir(): string {
  return path.join(getAppDataDir(), "source-media-cache");
}

function buildCacheKey(sourceUrl: string): string {
  return createHash("sha1").update(sourceUrl).digest("hex");
}

function buildVideoPath(cacheKey: string): string {
  return path.join(getSourceMediaCacheDir(), `${cacheKey}.mp4`);
}

function buildMetaPath(cacheKey: string): string {
  return path.join(getSourceMediaCacheDir(), `${cacheKey}.json`);
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function asProvider(value: unknown): SourceAcquisitionProvider | null {
  return value === "visolix" || value === "ytDlp" ? value : null;
}

function getSourceMediaCacheLimit(): number {
  const raw = Number.parseInt(process.env.SOURCE_MEDIA_CACHE_MAX_FILES ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_SOURCE_MEDIA_CACHE_LIMIT;
  }
  return Math.max(1, Math.min(100, Math.floor(raw)));
}

async function touchCacheArtifacts(cacheKey: string): Promise<void> {
  const now = new Date();
  await Promise.all([
    fs.utimes(buildVideoPath(cacheKey), now, now).catch(() => undefined),
    fs.utimes(buildMetaPath(cacheKey), now, now).catch(() => undefined)
  ]);
}

async function readCachedSourceMedia(
  sourceUrl: string,
  cacheKey: string
): Promise<CachedSourceMedia | null> {
  const filePath = buildVideoPath(cacheKey);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    return null;
  }

  const metaPath = buildMetaPath(cacheKey);
  let meta: CachedSourceMediaMeta | null = null;

  try {
    const parsed = JSON.parse(await fs.readFile(metaPath, "utf-8")) as Record<string, unknown>;
    const provider = asProvider(parsed.provider);
    if (provider) {
      meta = {
        fileName: asTrimmedString(parsed.fileName) ?? `${cacheKey}.mp4`,
        title: asTrimmedString(parsed.title),
        durationSec: asPositiveNumber(parsed.durationSec),
        videoSizeBytes:
          typeof parsed.videoSizeBytes === "number" && Number.isFinite(parsed.videoSizeBytes) && parsed.videoSizeBytes > 0
            ? parsed.videoSizeBytes
            : stat.size,
        provider
      };
    }
  } catch {
    meta = null;
  }

  await touchCacheArtifacts(cacheKey);

  return {
    cacheKey,
    sourceUrl,
    filePath,
    fileName: meta?.fileName ?? `${cacheKey}.mp4`,
    title: meta?.title ?? null,
    durationSec: meta?.durationSec ?? null,
    videoSizeBytes: meta?.videoSizeBytes ?? stat.size,
    provider: meta?.provider ?? "ytDlp"
  };
}

async function pruneSourceMediaCache(maxFiles = getSourceMediaCacheLimit()): Promise<void> {
  const cacheDir = getSourceMediaCacheDir();
  const entries = await fs.readdir(cacheDir).catch(() => []);
  const videoEntries = entries.filter((entry) => entry.endsWith(".mp4"));
  if (videoEntries.length <= maxFiles) {
    return;
  }

  const files = await Promise.all(
    videoEntries.map(async (entry) => {
      const filePath = path.join(cacheDir, entry);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile()) {
        return null;
      }
      return {
        cacheKey: entry.slice(0, -4),
        mtimeMs: stat.mtimeMs
      };
    })
  );

  const stale = files
    .filter((item): item is { cacheKey: string; mtimeMs: number } => Boolean(item))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(maxFiles);

  await Promise.all(
    stale.map(async (item) => {
      await Promise.all([
        fs.rm(buildVideoPath(item.cacheKey), { force: true }).catch(() => undefined),
        fs.rm(buildMetaPath(item.cacheKey), { force: true }).catch(() => undefined)
      ]);
    })
  );
}

export async function ensureSourceMediaCached(rawSource: string): Promise<CachedSourceMedia> {
  const sourceUrl = normalizeSupportedUrl(rawSource);
  const cacheKey = buildCacheKey(sourceUrl);
  const cached = await readCachedSourceMedia(sourceUrl, cacheKey);
  if (cached) {
    return cached;
  }

  const running = sourceMediaInflight.get(cacheKey);
  if (running) {
    return running;
  }

  const task = (async () => {
    await fs.mkdir(getSourceMediaCacheDir(), { recursive: true });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-source-cache-"));
    const targetVideoPath = buildVideoPath(cacheKey);
    const targetMetaPath = buildMetaPath(cacheKey);
    const tempVideoPath = `${targetVideoPath}.part`;
    const tempMetaPath = `${targetMetaPath}.part`;

    try {
      const downloaded = await getSourceMediaDownloader()(sourceUrl, tmpDir);
      await fs.copyFile(downloaded.filePath, tempVideoPath);
      await fs.rm(targetVideoPath, { force: true }).catch(() => undefined);
      await fs.rename(tempVideoPath, targetVideoPath);

      const meta: CachedSourceMediaMeta = {
        fileName: downloaded.fileName,
        title: downloaded.title,
        durationSec: downloaded.durationSec,
        videoSizeBytes: downloaded.videoSizeBytes,
        provider: downloaded.provider
      };
      await fs.writeFile(tempMetaPath, `${JSON.stringify(meta)}\n`, "utf-8");
      await fs.rm(targetMetaPath, { force: true }).catch(() => undefined);
      await fs.rename(tempMetaPath, targetMetaPath);
      void pruneSourceMediaCache().catch(() => undefined);

      return {
        cacheKey,
        sourceUrl,
        filePath: targetVideoPath,
        fileName: meta.fileName,
        title: meta.title,
        durationSec: meta.durationSec,
        videoSizeBytes: meta.videoSizeBytes,
        provider: meta.provider
      };
    } finally {
      await Promise.all([
        fs.rm(tempVideoPath, { force: true }).catch(() => undefined),
        fs.rm(tempMetaPath, { force: true }).catch(() => undefined),
        fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
      ]);
    }
  })();

  sourceMediaInflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    sourceMediaInflight.delete(cacheKey);
  }
}
