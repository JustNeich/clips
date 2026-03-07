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
const DEFAULT_VISOLIX_BASE_URL = "https://developers.visolix.com";
const DEFAULT_VISOLIX_TIMEOUT_MS = 120_000;
const DEFAULT_VISOLIX_POLL_INTERVAL_MS = 1_200;
const DEFAULT_VISOLIX_YOUTUBE_FORMAT = "720";

type VisolixInitResponse = {
  success?: unknown;
  id?: unknown;
  title?: unknown;
  info?: {
    title?: unknown;
    image?: unknown;
  } | null;
  progress_url?: unknown;
  message?: unknown;
  error?: unknown;
  cachehash?: unknown;
  repeat_download?: unknown;
  additional_info?: unknown;
};

type VisolixProgressResponse = {
  success?: unknown;
  progress?: unknown;
  download_url?: unknown;
  text?: unknown;
  message?: unknown;
  error?: unknown;
  alternative_download_urls?: Array<{
    type?: unknown;
    url?: unknown;
    has_ssl?: unknown;
  }> | null;
};

type YtDlpInfoJson = {
  title?: unknown;
  duration?: unknown;
  comments?: unknown;
};

export type SourceAcquisitionProvider = "visolix" | "ytDlp";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getVisolixApiKey(): string | null {
  const raw = asTrimmedString(process.env.VISOLIX_API_KEY);
  if (!raw) {
    return null;
  }

  const normalized = unwrapQuotedSecret(raw).trim();
  return normalized || null;
}

function getVisolixBaseUrl(): string {
  return (asTrimmedString(process.env.VISOLIX_BASE_URL) ?? DEFAULT_VISOLIX_BASE_URL).replace(/\/+$/, "");
}

function getVisolixTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.VISOLIX_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_VISOLIX_TIMEOUT_MS;
}

function getVisolixPollIntervalMs(): number {
  const parsed = Number.parseInt(process.env.VISOLIX_PROGRESS_POLL_INTERVAL_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_VISOLIX_POLL_INTERVAL_MS;
}

function getVisolixYoutubeFormat(): string {
  return asTrimmedString(process.env.VISOLIX_YOUTUBE_FORMAT) ?? DEFAULT_VISOLIX_YOUTUBE_FORMAT;
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

function normalizeUrlForVisolix(rawUrl: string): string {
  return isYouTubeUrl(rawUrl) ? normalizeYouTubeUrl(rawUrl) : rawUrl;
}

function deriveVisolixPlatform(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === "youtu.be" || hostname.includes("youtube.com")) {
      return "youtube";
    }
    if (hostname.includes("instagram.com")) {
      return "instagram";
    }
    if (hostname.includes("facebook.com") || hostname === "fb.watch") {
      return "facebook";
    }
    if (hostname.includes("tiktok.com")) {
      return "tiktok";
    }
  } catch {
    return null;
  }

  return null;
}

export function isVisolixConfigured(): boolean {
  return Boolean(getVisolixApiKey());
}

export async function resolveYtDlpExecutable(): Promise<string | null> {
  return resolveExecutableFromCandidates(YTDLP_CANDIDATES);
}

async function readJsonOrText(response: Response): Promise<Record<string, unknown> | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json().catch(() => null)) as Record<string, unknown> | null;
  }

  const text = (await response.text().catch(() => "")).trim();
  if (!text) {
    return null;
  }

  return { message: text.slice(0, 500) };
}

async function visolixDownloadInit(rawUrl: string): Promise<VisolixInitResponse> {
  const apiKey = getVisolixApiKey();
  if (!apiKey) {
    throw new Error("Visolix API key не задан. Добавьте VISOLIX_API_KEY на сервере.");
  }

  const candidateUrls = Array.from(
    new Set([normalizeUrlForVisolix(rawUrl), rawUrl].map((value) => value.trim()).filter(Boolean))
  );
  const platform = candidateUrls.map((value) => deriveVisolixPlatform(value)).find(Boolean);
  if (!platform) {
    throw new Error("Visolix не поддерживает этот URL.");
  }

  let lastError: Error | null = null;

  for (const candidateUrl of candidateUrls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getVisolixTimeoutMs());

    try {
      const headers = new Headers({
        "X-API-KEY": apiKey,
        "X-PLATFORM": platform,
        URL: candidateUrl
      });

      if (platform === "youtube") {
        headers.set("X-FORMAT", getVisolixYoutubeFormat());
      }

      const response = await fetch(`${getVisolixBaseUrl()}/api/download`, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal
      });
      const body = await readJsonOrText(response);

      if (!response.ok) {
        const apiMessage =
          asTrimmedString(body?.detail) ??
          asTrimmedString(body?.error) ??
          asTrimmedString(body?.message);
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            apiMessage ??
              `Visolix API отклонил запрос (HTTP ${response.status}). Проверьте VISOLIX_API_KEY и права доступа.`
          );
        }
        throw new Error(apiMessage ?? `Visolix API вернул HTTP ${response.status}.`);
      }

      if (body && (body.error === true || body.success === false)) {
        throw new Error(
          asTrimmedString(body.detail) ??
            asTrimmedString(body.error) ??
            asTrimmedString(body.message) ??
            "Visolix API не смог обработать этот URL."
        );
      }

      return (body ?? {}) as VisolixInitResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new Error("Visolix API не ответил вовремя.");
      } else {
        lastError = error instanceof Error ? error : new Error("Visolix API не смог обработать этот URL.");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Visolix API не смог обработать этот URL.");
}

async function pollVisolixDownload(progressUrl: string): Promise<string> {
  const timeoutAt = Date.now() + getVisolixTimeoutMs();
  let lastMessage: string | null = null;

  while (Date.now() < timeoutAt) {
    const response = await fetch(progressUrl, { cache: "no-store" });
    const body = (await readJsonOrText(response)) as Record<string, unknown> | null;

    if (!response.ok) {
      throw new Error(
        asTrimmedString(body?.detail) ??
          asTrimmedString(body?.error) ??
          asTrimmedString(body?.message) ??
          `Visolix progress API вернул HTTP ${response.status}.`
      );
    }

    const downloadUrl = asTrimmedString(body?.download_url);
    if (downloadUrl) {
      return downloadUrl;
    }

    if (body && (body.error === true || body.success === false)) {
      throw new Error(
        asTrimmedString(body.detail) ??
          asTrimmedString(body.error) ??
          asTrimmedString(body.message) ??
          "Visolix progress завершился ошибкой."
      );
    }

    lastMessage = asTrimmedString(body?.text) ?? asTrimmedString(body?.message) ?? lastMessage;
    await sleep(getVisolixPollIntervalMs());
  }

  throw new Error(
    lastMessage
      ? `Visolix не завершил download вовремя. Последний статус: ${lastMessage}.`
      : "Visolix не завершил download вовремя."
  );
}

async function downloadRemoteFile(
  downloadUrl: string,
  destinationPath: string,
  providerLabel: string
): Promise<number> {
  const response = await fetch(downloadUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Не удалось скачать файл из ${providerLabel} (HTTP ${response.status}).`);
  }
  if (!response.body) {
    throw new Error(`${providerLabel} не вернул тело файла.`);
  }

  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destinationPath));
  const stat = await fs.stat(destinationPath);
  return stat.size;
}

function sanitizeOutputName(rawName: string | null, fallback: string): string {
  return sanitizeFileName(rawName ?? fallback) || fallback;
}

async function tryVisolixDownload(rawUrl: string, tmpDir: string): Promise<SourceDownloadResult> {
  const targetPath = path.join(tmpDir, "source.mp4");
  const initPayload = await visolixDownloadInit(rawUrl);
  const progressUrl = asTrimmedString(initPayload.progress_url);

  if (!progressUrl) {
    throw new Error("Visolix не вернул progress_url для download job.");
  }

  const downloadUrl = await pollVisolixDownload(progressUrl);
  const videoSizeBytes = await downloadRemoteFile(downloadUrl, targetPath, "Visolix");
  const title = asTrimmedString(initPayload.title) ?? asTrimmedString(initPayload.info?.title);

  return {
    provider: "visolix",
    filePath: targetPath,
    fileName: sanitizeOutputName(title, "source"),
    title,
    durationSec: null,
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

  if (isVisolixConfigured()) {
    try {
      return await tryVisolixDownload(rawUrl, tmpDir);
    } catch (error) {
      errors.push(error instanceof Error ? `Visolix: ${error.message}` : "Visolix: source fetch failed.");
    }
  }

  try {
    return await tryYtDlpDownload(rawUrl, tmpDir);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "yt-dlp: source fetch failed.");
  }

  throw new Error(errors.join(" Fallback: "));
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
  if (isVisolixConfigured()) {
    return {
      provider: "visolix",
      title: null,
      durationSec: null
    };
  }

  return tryYtDlpMetadata(rawUrl);
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
