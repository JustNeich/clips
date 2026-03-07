import { execFile } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { resolveExecutableFromCandidates } from "./command-path";
import {
  createYtDlpAuthContext,
  extractYtDlpErrorFromUnknown,
  sanitizeFileName
} from "./ytdlp";

const execFileAsync = promisify(execFile);

const YTDLP_CANDIDATES = ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "yt-dlp"];
const DEFAULT_FASTSAVER_BASE_URL = "https://api.fastsaver.io/v1";
const DEFAULT_FASTSAVER_TIMEOUT_MS = 120_000;
const DEFAULT_FASTSAVER_YOUTUBE_FORMAT_PRIORITY = ["1080p", "720p", "480p", "240p", "144p"];

type FastSaverYouTubeFormat = {
  type?: unknown;
  format?: unknown;
  filesize?: unknown;
};

type FastSaverYouTubeInfoResponse = {
  ok?: unknown;
  video_id?: unknown;
  title?: unknown;
  author?: unknown;
  author_url?: unknown;
  thumbnail?: unknown;
  duration?: unknown;
  formats?: unknown;
};

type FastSaverYouTubeDownloadResponse = {
  ok?: unknown;
  filename?: unknown;
  download_url?: unknown;
};

type FastSaverFetchResponse = {
  ok?: unknown;
  id?: unknown;
  source?: unknown;
  type?: unknown;
  download_url?: unknown;
  thumbnail_url?: unknown;
  width?: unknown;
  height?: unknown;
  duration?: unknown;
  caption?: unknown;
  filename?: unknown;
};

type YtDlpInfoJson = {
  title?: unknown;
  duration?: unknown;
  comments?: unknown;
};

export type SourceAcquisitionProvider = "fastSaver" | "ytDlp";

export type SourceDownloadResult = {
  provider: SourceAcquisitionProvider;
  filePath: string;
  fileName: string;
  title: string | null;
  durationSec: number | null;
  videoSizeBytes: number;
};

export type SourceMetadataResult = {
  provider: SourceAcquisitionProvider;
  title: string | null;
  durationSec: number | null;
};

export type OptionalYtDlpInfoResult = {
  infoJson: { title?: string; comments?: unknown } | null;
  commentsExtractionFallbackUsed: boolean;
};

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unwrapQuotedSecret(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
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

function getFastSaverApiKey(): string | null {
  const raw = asTrimmedString(process.env.FASTSAVER_API_KEY);
  if (!raw) {
    return null;
  }

  const normalized = unwrapQuotedSecret(raw).replace(/^Bearer\s+/i, "").trim();
  return normalized || null;
}

function getFastSaverBaseUrl(): string {
  return (asTrimmedString(process.env.FASTSAVER_BASE_URL) ?? DEFAULT_FASTSAVER_BASE_URL).replace(
    /\/+$/,
    ""
  );
}

function getFastSaverTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.FASTSAVER_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FASTSAVER_TIMEOUT_MS;
}

function getFastSaverYoutubeFormatPriority(): string[] {
  const raw = asTrimmedString(process.env.FASTSAVER_YOUTUBE_FORMAT_PRIORITY);
  if (!raw) {
    return [...DEFAULT_FASTSAVER_YOUTUBE_FORMAT_PRIORITY];
  }
  const values = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return values.length > 0 ? values : [...DEFAULT_FASTSAVER_YOUTUBE_FORMAT_PRIORITY];
}

function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.includes("youtube.com") || parsed.hostname === "youtu.be";
  } catch {
    return false;
  }
}

function normalizeYouTubeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      if (id) {
        return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
      }
    }

    if (hostname.includes("youtube.com")) {
      const pathname = parsed.pathname;
      if (pathname.startsWith("/shorts/")) {
        const id = pathname.split("/").filter(Boolean)[1];
        if (id) {
          return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
        }
      }

      if (pathname === "/watch" && parsed.searchParams.get("v")) {
        return `https://www.youtube.com/watch?v=${encodeURIComponent(parsed.searchParams.get("v") ?? "")}`;
      }
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function normalizeUrlForFastSaver(rawUrl: string): string {
  return isYouTubeUrl(rawUrl) ? normalizeYouTubeUrl(rawUrl) : rawUrl;
}

export function isFastSaverConfigured(): boolean {
  return Boolean(getFastSaverApiKey());
}

export async function resolveYtDlpExecutable(): Promise<string | null> {
  return resolveExecutableFromCandidates(YTDLP_CANDIDATES);
}

async function performFastSaverRequest(
  pathname: string,
  init: RequestInit | undefined,
  authHeader: "X-Api-Key" | "Authorization",
  apiKey: string,
  signal: AbortSignal
): Promise<Response> {
  const authValue = authHeader === "Authorization" ? `Bearer ${apiKey}` : apiKey;

  return fetch(`${getFastSaverBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      [authHeader]: authValue,
      ...(init?.headers ?? {})
    },
    cache: "no-store",
    signal
  });
}

async function readFastSaverErrorBody(response: Response): Promise<Record<string, unknown> | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json().catch(() => null)) as Record<string, unknown> | null;
  }

  const text = (await response.text().catch(() => "")).trim();
  if (!text) {
    return null;
  }

  return {
    message: text.slice(0, 500)
  };
}

async function fastSaverRequest<T>(pathname: string, init?: RequestInit): Promise<T> {
  const apiKey = getFastSaverApiKey();
  if (!apiKey) {
    throw new Error("FastSaver API key не задан. Добавьте FASTSAVER_API_KEY на сервере.");
  }

  const timeoutMs = getFastSaverTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response = await performFastSaverRequest(pathname, init, "X-Api-Key", apiKey, controller.signal);
    let body = await readFastSaverErrorBody(response);

    if (response.status === 401 || response.status === 403) {
      response = await performFastSaverRequest(
        pathname,
        init,
        "Authorization",
        apiKey,
        controller.signal
      );
      body = await readFastSaverErrorBody(response);
    }

    if (!response.ok) {
      const apiMessage = asTrimmedString(body?.error) ?? asTrimmedString(body?.message);
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          apiMessage ??
            `FastSaver API отклонил запрос (HTTP ${response.status}). Проверьте FASTSAVER_API_KEY, формат секрета и права доступа.`
        );
      }
      throw new Error(apiMessage ?? `FastSaver API вернул HTTP ${response.status}.`);
    }

    if (body && body.ok === false) {
      throw new Error(
        asTrimmedString(body.error) ??
          asTrimmedString(body.message) ??
          "FastSaver API не смог обработать этот URL."
      );
    }

    return (body ?? {}) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("FastSaver API не ответил вовремя.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeOutputName(rawName: string | null, fallback: string): string {
  return sanitizeFileName(rawName ?? fallback) || fallback;
}

function chooseFastSaverYouTubeFormat(response: FastSaverYouTubeInfoResponse): string {
  const priority = getFastSaverYoutubeFormatPriority();
  const formats = Array.isArray(response.formats) ? (response.formats as FastSaverYouTubeFormat[]) : [];
  const available = formats
    .map((item) => asTrimmedString(item.format))
    .filter((value): value is string => Boolean(value));

  for (const preferred of priority) {
    if (available.includes(preferred)) {
      return preferred;
    }
  }

  const firstVideo = available.find((value) => value.toLowerCase() !== "audio");
  return firstVideo ?? priority[0] ?? "720p";
}

async function downloadRemoteFile(downloadUrl: string, destinationPath: string): Promise<number> {
  const response = await fetch(downloadUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Не удалось скачать файл из FastSaver (HTTP ${response.status}).`);
  }
  if (!response.body) {
    throw new Error("FastSaver не вернул тело файла.");
  }

  await pipeline(
    Readable.fromWeb(response.body as any),
    createWriteStream(destinationPath)
  );

  const stat = await fs.stat(destinationPath);
  return stat.size;
}

async function tryFastSaverDownload(rawUrl: string, tmpDir: string): Promise<SourceDownloadResult> {
  const providerUrl = normalizeUrlForFastSaver(rawUrl);
  const targetPath = path.join(tmpDir, "source.mp4");

  if (isYouTubeUrl(providerUrl)) {
    const info = await fastSaverRequest<FastSaverYouTubeInfoResponse>(
      `/youtube/info?${new URLSearchParams({ url: providerUrl }).toString()}`
    );
    const format = chooseFastSaverYouTubeFormat(info);
    const download = await fastSaverRequest<FastSaverYouTubeDownloadResponse>("/youtube/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: providerUrl,
        format
      })
    });

    const downloadUrl = asTrimmedString(download.download_url);
    if (!downloadUrl) {
      throw new Error("FastSaver не вернул ссылку на скачивание YouTube-видео.");
    }

    const videoSizeBytes = await downloadRemoteFile(downloadUrl, targetPath);
    return {
      provider: "fastSaver",
      filePath: targetPath,
      fileName: sanitizeOutputName(
        asTrimmedString(info.title) ?? asTrimmedString(download.filename),
        "source"
      ),
      title: asTrimmedString(info.title) ?? asTrimmedString(download.filename),
      durationSec: asPositiveNumber(info.duration),
      videoSizeBytes
    };
  }

  const payload = await fastSaverRequest<FastSaverFetchResponse>(
    `/fetch?${new URLSearchParams({ url: providerUrl }).toString()}`
  );
  const downloadUrl = asTrimmedString(payload.download_url);
  if (!downloadUrl) {
    throw new Error("FastSaver не вернул ссылку на скачивание media source.");
  }

  const mediaType = asTrimmedString(payload.type);
  if (mediaType && mediaType !== "video") {
    throw new Error(`FastSaver вернул неподдерживаемый тип media: ${mediaType}.`);
  }

  const videoSizeBytes = await downloadRemoteFile(downloadUrl, targetPath);
  const title = asTrimmedString(payload.caption) ?? asTrimmedString(payload.filename);

  return {
    provider: "fastSaver",
    filePath: targetPath,
    fileName: sanitizeOutputName(title, "source"),
    title,
    durationSec: asPositiveNumber(payload.duration),
    videoSizeBytes
  };
}

async function tryYtDlpDownload(rawUrl: string, tmpDir: string): Promise<SourceDownloadResult> {
  const ytDlpPath = await resolveYtDlpExecutable();
  if (!ytDlpPath) {
    throw new Error("yt-dlp не найден на сервере.");
  }

  const outputTemplate = path.join(tmpDir, "source.%(ext)s");
  const ytDlpAuth = await createYtDlpAuthContext(tmpDir);
  const args = [
    ...ytDlpAuth.args,
    "--no-playlist",
    "--no-warnings",
    "--write-info-json",
    "--merge-output-format",
    "mp4",
    "-f",
    "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "-o",
    outputTemplate,
    rawUrl
  ];

  try {
    await execFileAsync(ytDlpPath, args, {
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 16
    });
  } catch (error) {
    throw new Error(
      extractYtDlpErrorFromUnknown(error) ??
        (error instanceof Error ? error.message : "yt-dlp не смог скачать исходное видео.")
    );
  }

  const files = await fs.readdir(tmpDir);
  const mp4File = files.find((file) => file.endsWith(".mp4"));
  const infoJsonFile = files.find((file) => file.endsWith(".info.json"));

  if (!mp4File) {
    throw new Error("yt-dlp не создал mp4 после скачивания source.");
  }

  const downloadedPath = path.join(tmpDir, mp4File);
  const canonicalPath = path.join(tmpDir, "source.mp4");
  if (downloadedPath !== canonicalPath) {
    await fs.copyFile(downloadedPath, canonicalPath);
  }

  let title: string | null = null;
  let durationSec: number | null = null;

  if (infoJsonFile) {
    const infoJson = JSON.parse(await fs.readFile(path.join(tmpDir, infoJsonFile), "utf-8")) as YtDlpInfoJson;
    title = asTrimmedString(infoJson.title);
    durationSec = asPositiveNumber(infoJson.duration);
  }

  const stat = await fs.stat(canonicalPath);
  return {
    provider: "ytDlp",
    filePath: canonicalPath,
    fileName: sanitizeOutputName(path.parse(mp4File).name, "source"),
    title,
    durationSec,
    videoSizeBytes: stat.size
  };
}

export async function downloadSourceMedia(
  rawUrl: string,
  tmpDir: string
): Promise<SourceDownloadResult> {
  const errors: string[] = [];

  if (isFastSaverConfigured()) {
    try {
      return await tryFastSaverDownload(rawUrl, tmpDir);
    } catch (error) {
      errors.push(
        error instanceof Error ? `FastSaver: ${error.message}` : "FastSaver: source fetch failed."
      );
    }
  }

  try {
    return await tryYtDlpDownload(rawUrl, tmpDir);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "yt-dlp: source fetch failed.");
  }

  throw new Error(errors.join(" Fallback: "));
}

async function tryFastSaverMetadata(rawUrl: string): Promise<SourceMetadataResult> {
  const providerUrl = normalizeUrlForFastSaver(rawUrl);

  if (isYouTubeUrl(providerUrl)) {
    const info = await fastSaverRequest<FastSaverYouTubeInfoResponse>(
      `/youtube/info?${new URLSearchParams({ url: providerUrl }).toString()}`
    );
    return {
      provider: "fastSaver",
      title: asTrimmedString(info.title),
      durationSec: asPositiveNumber(info.duration)
    };
  }

  const payload = await fastSaverRequest<FastSaverFetchResponse>(
    `/fetch?${new URLSearchParams({ url: providerUrl }).toString()}`
  );
  return {
    provider: "fastSaver",
    title: asTrimmedString(payload.caption) ?? asTrimmedString(payload.filename),
    durationSec: asPositiveNumber(payload.duration)
  };
}

async function tryYtDlpMetadata(rawUrl: string): Promise<SourceMetadataResult> {
  const ytDlpPath = await resolveYtDlpExecutable();
  if (!ytDlpPath) {
    throw new Error("yt-dlp не найден на сервере.");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-meta-"));

  try {
    const ytDlpAuth = await createYtDlpAuthContext(tmpDir);
    const { stdout } = await execFileAsync(
      ytDlpPath,
      [
        ...ytDlpAuth.args,
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        rawUrl
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 8 }
    );

    const meta = JSON.parse(stdout) as YtDlpInfoJson;
    return {
      provider: "ytDlp",
      title: asTrimmedString(meta.title),
      durationSec: asPositiveNumber(meta.duration)
    };
  } catch (error) {
    throw new Error(
      extractYtDlpErrorFromUnknown(error) ??
        (error instanceof Error ? error.message : "Не удалось получить metadata через yt-dlp.")
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function fetchSourceMetadata(rawUrl: string): Promise<SourceMetadataResult> {
  const errors: string[] = [];

  if (isFastSaverConfigured()) {
    try {
      return await tryFastSaverMetadata(rawUrl);
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `FastSaver: ${error.message}`
          : "FastSaver: metadata fetch failed."
      );
    }
  }

  try {
    return await tryYtDlpMetadata(rawUrl);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "yt-dlp: metadata fetch failed.");
  }

  throw new Error(errors.join(" Fallback: "));
}

export async function fetchOptionalYtDlpInfo(
  rawUrl: string,
  tmpDir: string
): Promise<OptionalYtDlpInfoResult> {
  const ytDlpPath = await resolveYtDlpExecutable();
  if (!ytDlpPath) {
    return {
      infoJson: null,
      commentsExtractionFallbackUsed: true
    };
  }

  const outputTemplate = path.join(tmpDir, "metadata.%(ext)s");
  const ytDlpAuth = await createYtDlpAuthContext(tmpDir);

  const run = async (withComments: boolean): Promise<void> => {
    const args = [
      ...ytDlpAuth.args,
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
      "--write-info-json",
      ...(withComments ? ["--write-comments"] : []),
      "-o",
      outputTemplate,
      rawUrl
    ];

    await execFileAsync(ytDlpPath, args, {
      timeout: 3 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 16
    });
  };

  let commentsExtractionFallbackUsed = false;

  try {
    await run(true);
  } catch {
    commentsExtractionFallbackUsed = true;
    try {
      await run(false);
    } catch {
      return {
        infoJson: null,
        commentsExtractionFallbackUsed: true
      };
    }
  }

  const files = await fs.readdir(tmpDir);
  const infoJsonFile = files.find((file) => file.endsWith(".info.json"));
  if (!infoJsonFile) {
    return {
      infoJson: null,
      commentsExtractionFallbackUsed
    };
  }

  const infoJson = JSON.parse(await fs.readFile(path.join(tmpDir, infoJsonFile), "utf-8")) as YtDlpInfoJson;
  return {
    infoJson: {
      title: asTrimmedString(infoJson.title) ?? undefined,
      comments: infoJson.comments
    },
    commentsExtractionFallbackUsed
  };
}
