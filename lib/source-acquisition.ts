import { execFile } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { resolveExecutableFromCandidates } from "./command-path";
import { fetchCommentsForUrl } from "./source-comments";
import { fetchTranscriptFromYtDlpInfo, type YtDlpCaptionInfo } from "./youtube-captions";
import { extractYouTubeVideoIdFromUrl } from "./youtube-comments";
import { readYtDlpMetadataArtifacts } from "./ytdlp-metadata";
import {
  buildLimitedCommentsExtractorArgs,
  createYtDlpAuthContext,
  extractYtDlpErrorFromUnknown,
  normalizeSupportedUrl,
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
  download_url?: unknown;
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

type YtDlpInfoJson = YtDlpCaptionInfo & {
  title?: unknown;
  duration?: unknown;
  comments?: unknown;
  description?: unknown;
};

export type SourceAcquisitionProvider = "visolix" | "ytDlp";

export type SourceDownloadResult = {
  provider: SourceAcquisitionProvider;
  filePath: string;
  fileName: string;
  title: string | null;
  durationSec: number | null;
  videoSizeBytes: number;
  primaryProviderError: string | null;
  downloadFallbackUsed: boolean;
};

type SourceDownloadCoreResult = Omit<
  SourceDownloadResult,
  "primaryProviderError" | "downloadFallbackUsed"
>;

type SourceDownloadOverride = (rawUrl: string, tmpDir: string) => Promise<SourceDownloadCoreResult>;

let testVisolixDownloader: SourceDownloadOverride | null = null;
let testYtDlpDownloader: SourceDownloadOverride | null = null;

export function setSourceAcquisitionDownloadersForTests(
  input:
    | {
        visolix?: SourceDownloadOverride | null;
        ytDlp?: SourceDownloadOverride | null;
      }
    | null
): void {
  testVisolixDownloader = input?.visolix ?? null;
  testYtDlpDownloader = input?.ytDlp ?? null;
}

export type SourceMetadataResult = {
  provider: SourceAcquisitionProvider;
  title: string | null;
  durationSec: number | null;
};

export type OptionalYtDlpInfoResult = {
  infoJson: { title?: string; description?: string; transcript?: string; comments?: unknown } | null;
  commentsExtractionFallbackUsed: boolean;
  commentsAcquisition: {
    status: "primary_success" | "fallback_success" | "unavailable";
    provider: "youtubeDataApi" | "ytDlp" | null;
    note: string | null;
    error: string | null;
  };
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

function createCommentsAcquisition(input?: Partial<OptionalYtDlpInfoResult["commentsAcquisition"]>) {
  return {
    status: input?.status ?? "unavailable",
    provider: input?.provider ?? null,
    note: input?.note ?? null,
    error: input?.error ?? null
  } satisfies OptionalYtDlpInfoResult["commentsAcquisition"];
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function summarizeProviderTextResponse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  if (/<(?:!doctype|html|head|body|title)\b/i.test(trimmed)) {
    const titleMatch = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? compactWhitespace(stripHtmlTags(titleMatch[1] ?? "")) : "";
    const statusMatch = title.match(/\b([45]\d\d)\b(?:[:\s-]+([A-Za-z][A-Za-z -]+))?/i);
    if (statusMatch) {
      const statusCode = statusMatch[1];
      const reason = compactWhitespace(statusMatch[2] ?? "");
      return reason ? `upstream вернул HTTP ${statusCode} (${reason}).` : `upstream вернул HTTP ${statusCode}.`;
    }
    if (title) {
      return `upstream вернул HTML-страницу (${title}).`;
    }
    return "upstream вернул HTML-страницу вместо API-ответа.";
  }

  return compactWhitespace(trimmed).slice(0, 500);
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
  return Boolean(extractYouTubeVideoIdFromUrl(rawUrl));
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
  const normalizedUrl = normalizeSupportedUrl(rawUrl);
  return isYouTubeUrl(normalizedUrl) ? normalizeYouTubeUrl(normalizedUrl) : normalizedUrl;
}

function encodeVisolixHeaderUrl(rawUrl: string): string {
  return encodeURIComponent(rawUrl);
}

function buildVisolixUrlCandidates(rawUrl: string): string[] {
  const trimmed = rawUrl.trim();
  const normalized = normalizeUrlForVisolix(trimmed).trim();
  const baseCandidates = Array.from(new Set([trimmed, normalized].filter(Boolean)));

  return Array.from(
    new Set(
      baseCandidates.flatMap((candidate) => {
        const encoded = encodeVisolixHeaderUrl(candidate);
        return encoded === candidate ? [candidate] : [candidate, encoded];
      })
    )
  );
}

function deriveVisolixPlatform(rawUrl: string): string | null {
  try {
    const parsed = new URL(normalizeSupportedUrl(rawUrl));
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

  return { message: summarizeProviderTextResponse(text) };
}

async function visolixDownloadInit(rawUrl: string): Promise<VisolixInitResponse> {
  const apiKey = getVisolixApiKey();
  if (!apiKey) {
    throw new Error("Visolix API key не задан. Добавьте VISOLIX_API_KEY на сервере.");
  }

  const normalizedUrl = normalizeSupportedUrl(rawUrl);
  const candidateUrls = buildVisolixUrlCandidates(normalizedUrl);
  const platform = deriveVisolixPlatform(normalizedUrl);
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

      const payload = (body ?? {}) as VisolixInitResponse;
      const directDownloadUrl =
        asTrimmedString(payload.download_url) ??
        asTrimmedString((payload as Record<string, unknown>).url) ??
        asTrimmedString((payload as Record<string, unknown>).downloadUrl);
      const progressUrl = asTrimmedString(payload.progress_url);

      if (!directDownloadUrl && !progressUrl) {
        lastError = new Error("Visolix не вернул download_url или progress_url для download job.");
        continue;
      }

      return payload;
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

    const downloadUrl =
      asTrimmedString(body?.download_url) ??
      asTrimmedString(body?.url) ??
      asTrimmedString(body?.downloadUrl);
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

async function tryVisolixDownload(rawUrl: string, tmpDir: string): Promise<SourceDownloadCoreResult> {
  const targetPath = path.join(tmpDir, "source.mp4");
  const initPayload = await visolixDownloadInit(rawUrl);
  const directDownloadUrl =
    asTrimmedString(initPayload.download_url) ??
    asTrimmedString((initPayload as Record<string, unknown>).url) ??
    asTrimmedString((initPayload as Record<string, unknown>).downloadUrl);
  const progressUrl = asTrimmedString(initPayload.progress_url);

  if (!directDownloadUrl && !progressUrl) {
    throw new Error("Visolix не вернул download_url или progress_url для download job.");
  }

  const downloadUrl = directDownloadUrl ?? (await pollVisolixDownload(progressUrl as string));
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

async function tryYtDlpDownload(rawUrl: string, tmpDir: string): Promise<SourceDownloadCoreResult> {
  const sourceUrl = normalizeSupportedUrl(rawUrl);
  const ytDlpPath = await resolveYtDlpExecutable();
  if (!ytDlpPath) {
    throw new Error(
      process.env.STAGE3_WORKER_SERVER_ORIGIN?.trim()
        ? "yt-dlp не найден на локальном executor."
        : "yt-dlp не найден в среде выполнения."
    );
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
    sourceUrl
  ];

  try {
    await execFileAsync(ytDlpPath, args, {
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 16
    });
  } catch (error) {
    throw new Error(
      extractYtDlpErrorFromUnknown(error, { sourceUrl }) ??
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
  const sourceUrl = normalizeSupportedUrl(rawUrl);
  const errors: string[] = [];
  const visolixDownloader = testVisolixDownloader ?? tryVisolixDownload;
  const ytDlpDownloader = testYtDlpDownloader ?? tryYtDlpDownload;
  let primaryProviderError: string | null = null;

  if (isVisolixConfigured()) {
    try {
      const downloaded = await visolixDownloader(sourceUrl, tmpDir);
      return {
        ...downloaded,
        primaryProviderError: null,
        downloadFallbackUsed: false
      };
    } catch (error) {
      primaryProviderError =
        error instanceof Error ? `Visolix: ${error.message}` : "Visolix: source fetch failed.";
      errors.push(primaryProviderError);
    }
  }

  try {
    const downloaded = await ytDlpDownloader(sourceUrl, tmpDir);
    return {
      ...downloaded,
      primaryProviderError,
      downloadFallbackUsed: Boolean(primaryProviderError)
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "yt-dlp: source fetch failed.");
  }

  throw new Error(errors.join(" Fallback: "));
}

async function tryYtDlpMetadata(rawUrl: string): Promise<SourceMetadataResult> {
  const ytDlpPath = await resolveYtDlpExecutable();
  if (!ytDlpPath) {
    throw new Error(
      process.env.STAGE3_WORKER_SERVER_ORIGIN?.trim()
        ? "yt-dlp не найден на локальном executor."
        : "yt-dlp не найден в среде выполнения."
    );
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
      extractYtDlpErrorFromUnknown(error, { sourceUrl: rawUrl }) ??
        (error instanceof Error ? error.message : "Не удалось получить metadata через yt-dlp.")
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function fetchSourceMetadata(rawUrl: string): Promise<SourceMetadataResult> {
  const sourceUrl = normalizeSupportedUrl(rawUrl);
  if (isVisolixConfigured()) {
    return {
      provider: "visolix",
      title: null,
      durationSec: null
    };
  }

  return tryYtDlpMetadata(sourceUrl);
}

export async function fetchOptionalYtDlpInfo(
  rawUrl: string,
  tmpDir: string
): Promise<OptionalYtDlpInfoResult> {
  const sourceUrl = normalizeSupportedUrl(rawUrl);
  if (isYouTubeUrl(sourceUrl)) {
    return fetchOptionalYouTubeInfo(sourceUrl, tmpDir);
  }

  const ytDlpPath = await resolveYtDlpExecutable();
  if (!ytDlpPath) {
    return {
      infoJson: null,
      commentsExtractionFallbackUsed: true,
      commentsAcquisition: createCommentsAcquisition({
        status: "unavailable",
        provider: null,
        note: "Локальный yt-dlp недоступен, поэтому comments metadata path не смог сработать.",
        error: "yt-dlp недоступен для извлечения комментариев."
      })
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
      ...(withComments ? buildLimitedCommentsExtractorArgs(sourceUrl, 300) : []),
      "-o",
      outputTemplate,
      sourceUrl
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
        commentsExtractionFallbackUsed: true,
        commentsAcquisition: createCommentsAcquisition({
          status: "unavailable",
          provider: null,
          note:
            "yt-dlp не смог извлечь комментарии и не смог даже перейти в metadata-only режим без комментариев.",
          error: "yt-dlp не смог получить комментарии."
        })
      };
    }
  }

  const { infoJson, comments } = await readYtDlpMetadataArtifacts(tmpDir, "metadata");
  if (!infoJson) {
    return {
      infoJson: null,
      commentsExtractionFallbackUsed,
      commentsAcquisition: createCommentsAcquisition({
        status: "unavailable",
        provider: null,
        note: commentsExtractionFallbackUsed
          ? "yt-dlp смог получить только metadata fallback без пригодного comments payload."
          : "yt-dlp не вернул пригодные metadata для comments payload.",
        error: "Комментарии недоступны в metadata artifacts."
      })
    };
  }

  const normalizedInfo = infoJson as YtDlpInfoJson;
  const transcript = await fetchTranscriptFromYtDlpInfo(normalizedInfo);
  return {
    infoJson: {
      title: asTrimmedString(normalizedInfo.title) ?? undefined,
      description: asTrimmedString(normalizedInfo.description) ?? undefined,
      transcript: transcript || undefined,
      comments
    },
    commentsExtractionFallbackUsed,
    commentsAcquisition: comments.length > 0
      ? createCommentsAcquisition({
          status: "primary_success",
          provider: "ytDlp",
          note: commentsExtractionFallbackUsed
            ? "Комментарии извлечены через yt-dlp metadata path после частичного fallback внутри yt-dlp."
            : "Комментарии извлечены через yt-dlp metadata path."
        })
      : createCommentsAcquisition({
          status: "unavailable",
          provider: commentsExtractionFallbackUsed ? null : "ytDlp",
          note: commentsExtractionFallbackUsed
            ? "yt-dlp перешёл в metadata-only fallback и подготовил ролик без комментариев."
            : "yt-dlp metadata path завершился без комментариев.",
          error: "Комментарии для этого источника недоступны."
        })
  };
}

async function fetchOptionalYouTubeInfo(
  sourceUrl: string,
  tmpDir: string
): Promise<OptionalYtDlpInfoResult> {
  const ytDlpPath = await resolveYtDlpExecutable();
  let normalizedInfo: YtDlpInfoJson | null = null;
  let transcript: string | null = null;

  if (ytDlpPath) {
    const outputTemplate = path.join(tmpDir, "metadata.%(ext)s");
    const ytDlpAuth = await createYtDlpAuthContext(tmpDir);

    try {
      await execFileAsync(
        ytDlpPath,
        [
          ...ytDlpAuth.args,
          "--skip-download",
          "--no-playlist",
          "--no-warnings",
          "--write-info-json",
          "-o",
          outputTemplate,
          sourceUrl
        ],
        {
          timeout: 3 * 60 * 1000,
          maxBuffer: 1024 * 1024 * 16
        }
      );

      const { infoJson } = await readYtDlpMetadataArtifacts(tmpDir, "metadata");
      if (infoJson) {
        normalizedInfo = infoJson as YtDlpInfoJson;
        transcript = await fetchTranscriptFromYtDlpInfo(normalizedInfo);
      }
    } catch {
      normalizedInfo = null;
      transcript = null;
    }
  }

  const commentsResult = await fetchCommentsForUrl(sourceUrl);
  const comments = commentsResult.payload?.allComments ?? [];
  const title =
    asTrimmedString(normalizedInfo?.title) ??
    asTrimmedString(commentsResult.payload?.title) ??
    null;
  const description = asTrimmedString(normalizedInfo?.description);

  if (!title && !description && !transcript && comments.length === 0) {
    return {
      infoJson: null,
      commentsExtractionFallbackUsed: commentsResult.fallbackUsed,
      commentsAcquisition: createCommentsAcquisition({
        status: commentsResult.status,
        provider: commentsResult.provider,
        note: commentsResult.note,
        error: commentsResult.error
      })
    };
  }

  return {
    infoJson: {
      title: title ?? undefined,
      description: description ?? undefined,
      transcript: transcript || undefined,
      comments
    },
    commentsExtractionFallbackUsed: commentsResult.fallbackUsed,
    commentsAcquisition: createCommentsAcquisition({
      status: commentsResult.payload && comments.length > 0 ? commentsResult.status : "unavailable",
      provider: commentsResult.payload && comments.length > 0 ? commentsResult.provider : commentsResult.provider,
      note: commentsResult.note,
      error: commentsResult.payload && comments.length > 0 ? null : commentsResult.error
    })
  };
}
