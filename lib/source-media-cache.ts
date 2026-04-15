import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import type { SourceProviderErrorSummary } from "../app/components/types";
import { getAppDataDir } from "./app-paths";
import { isHostedRenderRuntime } from "./hosted-subprocess";
import {
  downloadSourceMedia,
  type SourceDownloadOptions
} from "./source-acquisition";
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
  providerErrorSummary: SourceProviderErrorSummary | null;
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
  providerErrorSummary: SourceProviderErrorSummary | null;
  sticky?: boolean;
  composite?: boolean;
};

const SOURCE_MEDIA_CACHE_MAX_ENTRIES = 24;
const HOSTED_SOURCE_MEDIA_CACHE_MAX_ENTRIES = 8;
const SOURCE_MEDIA_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
const HOSTED_SOURCE_MEDIA_CACHE_MAX_AGE_MS = 6 * 60 * 60_000;
const HOSTED_SOURCE_MEDIA_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const sourceMediaInflight = new Map<string, Promise<CachedSourceMediaCore>>();

type EnsureSourceMediaCachedOptions = SourceDownloadOptions;

function createDefaultProviderErrorSummary(): SourceProviderErrorSummary | null {
  return null;
}

function getSourceMediaCacheLimits() {
  if (isHostedRenderRuntime()) {
    return {
      maxEntries: HOSTED_SOURCE_MEDIA_CACHE_MAX_ENTRIES,
      maxAgeMs: HOSTED_SOURCE_MEDIA_CACHE_MAX_AGE_MS,
      maxBytes: HOSTED_SOURCE_MEDIA_CACHE_MAX_BYTES
    };
  }
  return {
    maxEntries: SOURCE_MEDIA_CACHE_MAX_ENTRIES,
    maxAgeMs: SOURCE_MEDIA_CACHE_MAX_AGE_MS,
    maxBytes: Number.POSITIVE_INFINITY
  };
}

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
      downloadFallbackUsed: false,
      providerErrorSummary: createDefaultProviderErrorSummary()
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
      providerErrorSummary:
        parsed.providerErrorSummary &&
        typeof parsed.providerErrorSummary === "object" &&
        !Array.isArray(parsed.providerErrorSummary)
          ? {
              primaryProvider:
                parsed.providerErrorSummary.primaryProvider === "visolix" ||
                parsed.providerErrorSummary.primaryProvider === "ytDlp"
                  ? parsed.providerErrorSummary.primaryProvider
                  : null,
              primaryProviderError:
                typeof parsed.providerErrorSummary.primaryProviderError === "string" &&
                parsed.providerErrorSummary.primaryProviderError.trim()
                  ? parsed.providerErrorSummary.primaryProviderError.trim()
                  : null,
              primaryRetryEligible: parsed.providerErrorSummary.primaryRetryEligible === true,
              fallbackProvider:
                parsed.providerErrorSummary.fallbackProvider === "visolix" ||
                parsed.providerErrorSummary.fallbackProvider === "ytDlp"
                  ? parsed.providerErrorSummary.fallbackProvider
                  : null,
              fallbackProviderError:
                typeof parsed.providerErrorSummary.fallbackProviderError === "string" &&
                parsed.providerErrorSummary.fallbackProviderError.trim()
                  ? parsed.providerErrorSummary.fallbackProviderError.trim()
                  : null,
              hostedFallbackSkippedReason:
                typeof parsed.providerErrorSummary.hostedFallbackSkippedReason === "string" &&
                parsed.providerErrorSummary.hostedFallbackSkippedReason.trim()
                  ? parsed.providerErrorSummary.hostedFallbackSkippedReason.trim()
                  : null
            }
          : createDefaultProviderErrorSummary(),
      sticky: parsed.sticky === true,
      composite: parsed.composite === true
    };
  } catch {
    return {
      fileName: `${sourceKey}.mp4`,
      title: null,
      videoSizeBytes: 0,
      downloadProvider: "ytDlp",
      primaryProviderError: null,
      downloadFallbackUsed: false,
      providerErrorSummary: createDefaultProviderErrorSummary(),
      sticky: false,
      composite: false
    };
  }
}

export async function getCachedSourceMedia(rawUrl: string): Promise<CachedSourceMedia | null> {
  const sourceUrl = normalizeSupportedUrl(rawUrl);
  const sourceKey = getSourceMediaCacheKey(sourceUrl);
  const sourcePath = buildSourcePath(sourceKey);
  if (!(await pathExists(sourcePath))) {
    return null;
  }
  const meta = await readMeta(sourceKey);
  return {
    sourcePath,
    sourceKey,
    ...meta,
    cacheState: "hit"
  };
}

async function writeMeta(sourceKey: string, meta: CachedSourceMediaMeta): Promise<void> {
  await fs.writeFile(buildMetaPath(sourceKey), `${JSON.stringify(meta)}\n`, "utf-8");
}

async function pruneSourceMediaCache(): Promise<void> {
  const now = Date.now();
  const limits = getSourceMediaCacheLimits();
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
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
            sticky: meta.sticky === true
          };
        })
    )
  ).filter(
    (entry): entry is {
      filePath: string;
      metaPath: string;
      sizeBytes: number;
      mtimeMs: number;
      sticky: boolean;
    } => Boolean(entry)
  );

  const stale = filesWithMeta.filter((entry) => !entry.sticky && now - entry.mtimeMs > limits.maxAgeMs);
  await Promise.all(
    stale.flatMap((entry) => [
      fs.rm(entry.filePath, { force: true }).catch(() => undefined),
      fs.rm(entry.metaPath, { force: true }).catch(() => undefined)
    ])
  );

  const nonStale = filesWithMeta.filter((entry) => !stale.some((candidate) => candidate.filePath === entry.filePath));
  const stickyEntries = nonStale.filter((entry) => entry.sticky);
  const keptNonSticky: typeof nonStale = [];
  let totalNonStickyBytes = 0;

  for (const entry of nonStale
    .filter((candidate) => !candidate.sticky)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)) {
    if (keptNonSticky.length >= limits.maxEntries) {
      continue;
    }
    if (
      keptNonSticky.length > 0 &&
      Number.isFinite(limits.maxBytes) &&
      totalNonStickyBytes + entry.sizeBytes > limits.maxBytes
    ) {
      continue;
    }
    keptNonSticky.push(entry);
    totalNonStickyBytes += entry.sizeBytes;
  }

  const keptPaths = new Set([...stickyEntries, ...keptNonSticky].map((entry) => entry.filePath));
  const overflow = nonStale.filter((entry) => !entry.sticky && !keptPaths.has(entry.filePath));

  await Promise.all(
    overflow.flatMap((entry) => [
      fs.rm(entry.filePath, { force: true }).catch(() => undefined),
      fs.rm(entry.metaPath, { force: true }).catch(() => undefined)
    ])
  );
}

export const pruneSourceMediaCacheForTests = pruneSourceMediaCache;

type UploadedSourceMediaInfo = {
  width: number;
  height: number;
  hasAudio: boolean;
};

function normalizeVideoDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1080;
  }
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

async function probeUploadedSourceMediaInfo(videoPath: string): Promise<UploadedSourceMediaInfo> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height",
      "-of",
      "json",
      videoPath
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 * 2 }
  );

  const payload = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
    }>;
  };
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  if (!videoStream?.width || !videoStream?.height) {
    throw new Error("Не удалось определить параметры исходного mp4.");
  }

  return {
    width: normalizeVideoDimension(videoStream.width),
    height: normalizeVideoDimension(videoStream.height),
    hasAudio: streams.some((stream) => stream.codec_type === "audio")
  };
}

function buildNormalizeUploadedSourceVideoFilter(targetWidth: number, targetHeight: number): string {
  return [
    `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`,
    `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black`,
    "setsar=1",
    "fps=30",
    "format=yuv420p"
  ].join(",");
}

async function normalizeUploadedSourcePartMedia(input: {
  sourcePath: string;
  outputPath: string;
  targetWidth: number;
  targetHeight: number;
  includeAudio: boolean;
  sourceHasAudio: boolean;
}): Promise<void> {
  const args = ["-y", "-i", input.sourcePath];
  if (input.includeAudio && !input.sourceHasAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }

  args.push(
    "-filter_complex",
    `[0:v]${buildNormalizeUploadedSourceVideoFilter(input.targetWidth, input.targetHeight)}[v]`,
    "-map",
    "[v]"
  );

  if (input.includeAudio) {
    args.push("-map", input.sourceHasAudio ? "0:a:0" : "1:a:0");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-threads",
    "0"
  );

  if (input.includeAudio) {
    args.push("-c:a", "aac", "-ar", "48000", "-ac", "2");
    if (!input.sourceHasAudio) {
      args.push("-shortest");
    }
  } else {
    args.push("-an");
  }

  args.push("-movflags", "+faststart", input.outputPath);

  await execFileAsync("ffmpeg", args, {
    timeout: 5 * 60_000,
    maxBuffer: 1024 * 1024 * 16
  });
}

async function concatUploadedSourceMedia(input: {
  sourcePaths: string[];
  outputPath: string;
  hasAudio: boolean;
  tmpDir: string;
}): Promise<void> {
  const listPath = path.join(input.tmpDir, "uploaded-sources.txt");
  const list = input.sourcePaths.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, list, "utf-8");

  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-threads",
    "0",
    "-movflags",
    "+faststart"
  ];

  if (input.hasAudio) {
    args.push("-c:a", "aac", "-ar", "48000", "-ac", "2");
  } else {
    args.push("-an");
  }

  args.push(input.outputPath);

  await execFileAsync("ffmpeg", args, {
    timeout: 5 * 60_000,
    maxBuffer: 1024 * 1024 * 16
  });
}

export async function storeUploadedCompositeSourceMedia(input: {
  sourceUrl: string;
  fileName: string;
  title?: string | null;
  parts: Array<{
    fileName: string;
    bytes: Uint8Array;
  }>;
  maxBytes?: number;
  probeMediaInfo?: (videoPath: string) => Promise<UploadedSourceMediaInfo>;
  normalizePartMedia?: (input: {
    sourcePath: string;
    outputPath: string;
    targetWidth: number;
    targetHeight: number;
    includeAudio: boolean;
    sourceHasAudio: boolean;
  }) => Promise<void>;
  concatMedia?: (input: {
    sourcePaths: string[];
    outputPath: string;
    hasAudio: boolean;
    tmpDir: string;
  }) => Promise<void>;
}): Promise<CachedSourceMedia> {
  const sourceUrl = normalizeSupportedUrl(input.sourceUrl);
  if (input.parts.length < 2) {
    throw new Error("Для склейки нужно минимум 2 исходника.");
  }

  const sourceKey = getSourceMediaCacheKey(sourceUrl);
  const sourcePath = buildSourcePath(sourceKey);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-source-upload-batch-"));
  const tmpPath = path.join(tmpDir, `${sourceKey}.mp4`);
  const maxBytes = Number.isFinite(input.maxBytes) ? Number(input.maxBytes) : null;
  let totalInputBytes = 0;

  try {
    const partPaths: string[] = [];
    for (let index = 0; index < input.parts.length; index += 1) {
      const part = input.parts[index];
      const buffer = Buffer.from(part.bytes);
      totalInputBytes += buffer.byteLength;
      if (maxBytes && totalInputBytes > maxBytes) {
        throw new Error("Файл слишком большой.");
      }
      const partPath = path.join(
        tmpDir,
        `part-${String(index + 1).padStart(2, "0")}${path.extname(part.fileName || "") || ".mp4"}`
      );
      await fs.writeFile(partPath, buffer);
      partPaths.push(partPath);
    }

    if (totalInputBytes <= 0) {
      throw new Error("Файл пустой.");
    }

    const probeMediaInfo = input.probeMediaInfo ?? probeUploadedSourceMediaInfo;
    const normalizePartMedia = input.normalizePartMedia ?? normalizeUploadedSourcePartMedia;
    const concatMedia = input.concatMedia ?? concatUploadedSourceMedia;
    const partMediaInfo = await Promise.all(partPaths.map(async (entry) => probeMediaInfo(entry)));
    const targetWidth = partMediaInfo[0]?.width ?? 1080;
    const targetHeight = partMediaInfo[0]?.height ?? 1920;
    const includeAudio = partMediaInfo.some((entry) => entry.hasAudio);
    const normalizedPartPaths: string[] = [];

    for (let index = 0; index < partPaths.length; index += 1) {
      const partPath = partPaths[index];
      const mediaInfo = partMediaInfo[index];
      if (!partPath || !mediaInfo) {
        continue;
      }
      const normalizedPath = path.join(tmpDir, `normalized-${String(index + 1).padStart(2, "0")}.mp4`);
      await normalizePartMedia({
        sourcePath: partPath,
        outputPath: normalizedPath,
        targetWidth,
        targetHeight,
        includeAudio,
        sourceHasAudio: mediaInfo.hasAudio
      });
      normalizedPartPaths.push(normalizedPath);
    }

    await concatMedia({
      sourcePaths: normalizedPartPaths,
      outputPath: tmpPath,
      hasAudio: includeAudio,
      tmpDir
    });

    const stat = await fs.stat(tmpPath);
    if (maxBytes && stat.size > maxBytes) {
      throw new Error("Файл слишком большой.");
    }

    await fs.mkdir(getSourceMediaCacheDir(), { recursive: true });
    await fs.rename(tmpPath, sourcePath);
    const meta: CachedSourceMediaMeta = {
      fileName: input.fileName.trim() || `${sourceKey}.mp4`,
      title: input.title?.trim() || path.parse(input.fileName).name || null,
      videoSizeBytes: stat.size,
      downloadProvider: "upload",
      primaryProviderError: null,
      downloadFallbackUsed: false,
      providerErrorSummary: createDefaultProviderErrorSummary(),
      sticky: true,
      composite: true
    };
    await writeMeta(sourceKey, meta);
    void pruneSourceMediaCache().catch(() => undefined);
    return {
      sourcePath,
      sourceKey,
      ...meta,
      cacheState: "miss"
    };
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function ensureSourceMediaCached(
  rawUrl: string,
  options: EnsureSourceMediaCachedOptions = {}
): Promise<CachedSourceMedia> {
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
      const downloaded = await downloadSourceMedia(sourceUrl, tmpDir, options);
      await fs.copyFile(downloaded.filePath, sourcePath);
      const meta: CachedSourceMediaMeta = {
        fileName: downloaded.fileName,
        title: downloaded.title,
        videoSizeBytes: downloaded.videoSizeBytes,
        downloadProvider: downloaded.provider,
        primaryProviderError: downloaded.primaryProviderError,
        downloadFallbackUsed: downloaded.downloadFallbackUsed,
        providerErrorSummary: downloaded.providerErrorSummary
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
      providerErrorSummary: createDefaultProviderErrorSummary(),
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
