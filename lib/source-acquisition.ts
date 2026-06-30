import { execFile } from "node:child_process";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { createWriteStream, promises as fs } from "node:fs";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { SourceProviderErrorSummary, SourceProviderId } from "../app/components/types";
import { resolveExecutableFromCandidates } from "./command-path";
import { runWithHostedSubprocessGate, isHostedRenderRuntime } from "./hosted-subprocess";
import { fetchCommentsForUrl } from "./source-comments";
import { getUploadedSourceDisplayName, isUploadedSourceUrl } from "./uploaded-source";
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
const DEFAULT_SOURCE_DOWNLOAD_RETRY_DELAY_MS = 5_000;
const MAX_REMOTE_SOURCE_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_SAFE_REMOTE_REDIRECTS = 3;

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

export type SourceAcquisitionProvider = SourceProviderId;
export type SourceCommentsProvider = "youtubeDataApi" | "ytDlp";
export type SourceCommentsStatus = "primary_success" | "fallback_success" | "unavailable";
export type SourceCommentsAcquisition = {
  status: SourceCommentsStatus;
  provider: SourceCommentsProvider | null;
  note: string | null;
  error: string | null;
};

export type OptionalSourceInfoResult = {
  infoJson: { title?: string; description?: string; transcript?: string; comments?: unknown } | null;
  commentsExtractionFallbackUsed: boolean;
  commentsAcquisition: SourceCommentsAcquisition;
};

export type SourceDownloadProvider = SourceAcquisitionProvider | "upload";

export type SourceDownloadResult = {
  provider: SourceDownloadProvider;
  filePath: string;
  fileName: string;
  title: string | null;
  durationSec: number | null;
  videoSizeBytes: number;
  primaryProviderError: string | null;
  downloadFallbackUsed: boolean;
  providerErrorSummary: SourceProviderErrorSummary | null;
};

type SourceDownloadCoreResult = Omit<
  SourceDownloadResult,
  "primaryProviderError" | "downloadFallbackUsed" | "providerErrorSummary"
>;

type SourceDownloadOverride = (rawUrl: string, tmpDir: string) => Promise<SourceDownloadCoreResult>;

export type SourceDownloadRetryNotice = {
  provider: SourceAcquisitionProvider;
  attempt: number;
  maxAttempts: number;
  retryAt: string;
  providerErrorSummary: SourceProviderErrorSummary;
};

export type SourceDownloadOptions = {
  onRetryScheduled?: (notice: SourceDownloadRetryNotice) => Promise<void> | void;
};

export type SourceDownloadErrorContext = {
  providerErrorSummary: SourceProviderErrorSummary;
  attempt: number | null;
  maxAttempts: number | null;
};

export class SourceDownloadError extends Error {
  readonly context: SourceDownloadErrorContext;

  constructor(message: string, context: SourceDownloadErrorContext) {
    super(message);
    this.name = "SourceDownloadError";
    this.context = context;
  }
}

let testVisolixDownloader: SourceDownloadOverride | null = null;
let testYtDlpDownloader: SourceDownloadOverride | null = null;
let testSafeLookup:
  | ((hostname: string) => Promise<Array<{ address: string; family?: number }>>)
  | null = null;
let testSafeFetch: ((url: string, init: RequestInit) => Promise<Response>) | null = null;

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

export function setSourceAcquisitionNetworkForTests(
  input:
    | {
        lookup?: ((hostname: string) => Promise<Array<{ address: string; family?: number }>>) | null;
        fetch?: ((url: string, init: RequestInit) => Promise<Response>) | null;
      }
    | null
): void {
  testSafeLookup = input?.lookup ?? null;
  testSafeFetch = input?.fetch ?? null;
}

export type SourceMetadataResult = {
  provider: SourceDownloadProvider;
  title: string | null;
  durationSec: number | null;
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

function maxPositiveDuration(values: unknown[]): number | null {
  const durations = values.map(asPositiveNumber).filter((value): value is number => value !== null);
  if (!durations.length) {
    return null;
  }
  return Math.max(...durations);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCommentsAcquisition(input?: Partial<SourceCommentsAcquisition>) {
  return {
    status: input?.status ?? "unavailable",
    provider: input?.provider ?? null,
    note: input?.note ?? null,
    error: input?.error ?? null
  } satisfies SourceCommentsAcquisition;
}

function createProviderErrorSummary(
  input?: Partial<SourceProviderErrorSummary>
): SourceProviderErrorSummary {
  return {
    primaryProvider: input?.primaryProvider ?? null,
    primaryProviderError: input?.primaryProviderError ?? null,
    primaryRetryEligible: input?.primaryRetryEligible ?? false,
    fallbackProvider: input?.fallbackProvider ?? null,
    fallbackProviderError: input?.fallbackProviderError ?? null,
    hostedFallbackSkippedReason: input?.hostedFallbackSkippedReason ?? null
  };
}

function providerLabel(provider: SourceAcquisitionProvider): string {
  return provider === "visolix" ? "Visolix" : "yt-dlp";
}

function formatLegacyPrimaryProviderError(
  provider: SourceAcquisitionProvider,
  message: string | null
): string | null {
  const normalized = message?.trim();
  if (!normalized) {
    return null;
  }
  return `${providerLabel(provider)}: ${normalized}`;
}

function formatSourceDownloadFailureMessage(summary: SourceProviderErrorSummary): string {
  const primaryError = formatLegacyPrimaryProviderError(
    summary.primaryProvider ?? "visolix",
    summary.primaryProviderError
  );
  if (!primaryError) {
    return "Source fetch failed.";
  }
  if (!summary.fallbackProviderError) {
    return primaryError;
  }
  return `${primaryError} Fallback ${providerLabel(summary.fallbackProvider ?? "ytDlp")}: ${summary.fallbackProviderError}`;
}

function isRetryableVisolixErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const nonRetryablePatterns = [
    "anti-bot",
    "auth",
    "unauthorized",
    "forbidden",
    "unsupported",
    "не поддерж",
    "validation",
    "invalid",
    "sign in",
    "cookie",
    "captcha",
    "private",
    "403",
    "401",
    "429"
  ];
  if (nonRetryablePatterns.some((pattern) => normalized.includes(pattern))) {
    return false;
  }

  const retryablePatterns = [
    "timeout",
    "timed out",
    "network",
    "socket",
    "fetch failed",
    "econn",
    "etimedout",
    "bad gateway",
    "gateway timeout",
    "service unavailable",
    "provider unavailable",
    "не вернул download_url",
    "database connection unavailable",
    "temporarily unavailable",
    "temporary",
    "internal server error",
    "upstream",
    "http 500",
    "http 502",
    "http 503",
    "http 504"
  ];
  return retryablePatterns.some((pattern) => normalized.includes(pattern));
}

function shouldSkipHostedYtDlpFallbackForSource(sourceUrl: string): boolean {
  return isHostedRenderRuntime() && isYouTubeUrl(sourceUrl);
}

function buildHostedFallbackSkippedReason(sourceUrl: string): string | null {
  if (!shouldSkipHostedYtDlpFallbackForSource(sourceUrl)) {
    return null;
  }
  return "Hosted policy: yt-dlp fallback для YouTube source download пропущен на этом runtime.";
}

function buildSourceDownloadErrorContext(
  providerErrorSummary: SourceProviderErrorSummary,
  input?: {
    attempt?: number | null;
    maxAttempts?: number | null;
  }
): SourceDownloadErrorContext {
  return {
    providerErrorSummary,
    attempt: input?.attempt ?? null,
    maxAttempts: input?.maxAttempts ?? null
  };
}

export function getSourceDownloadErrorContext(error: unknown): SourceDownloadErrorContext | null {
  return error instanceof SourceDownloadError ? error.context : null;
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

function getSourceDownloadRetryDelayMs(): number {
  const parsed = Number.parseInt(process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SOURCE_DOWNLOAD_RETRY_DELAY_MS;
}

function getVisolixYoutubeFormat(): string {
  return asTrimmedString(process.env.VISOLIX_YOUTUBE_FORMAT) ?? DEFAULT_VISOLIX_YOUTUBE_FORMAT;
}

function asTrimmedScalarString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return asTrimmedString(value);
}

function buildVisolixProgressUrl(downloadId: string): string {
  const progressUrl = new URL("/api/progress", `${getVisolixBaseUrl()}/`);
  progressUrl.searchParams.set("id", downloadId);
  return progressUrl.toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getVisolixRecordCandidates(payload: unknown): Array<Record<string, unknown>> {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  const candidates = [root];
  for (const key of ["data", "result", "download", "job", "info"]) {
    const nested = asRecord(root[key]);
    if (nested) {
      candidates.push(nested);
    }
  }
  return candidates;
}

function pickVisolixString(payload: unknown, keys: string[]): string | null {
  for (const candidate of getVisolixRecordCandidates(payload)) {
    for (const key of keys) {
      const value = asTrimmedString(candidate[key]);
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function pickVisolixScalar(payload: unknown, keys: string[]): string | null {
  for (const candidate of getVisolixRecordCandidates(payload)) {
    for (const key of keys) {
      const value = asTrimmedScalarString(candidate[key]);
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function getVisolixAlternativeDownloadUrl(payload: unknown): string | null {
  for (const candidate of getVisolixRecordCandidates(payload)) {
    const alternatives = candidate.alternative_download_urls;
    if (!Array.isArray(alternatives)) {
      continue;
    }
    for (const alternative of alternatives) {
      const url = asTrimmedString(asRecord(alternative)?.url);
      if (url) {
        return url;
      }
    }
  }
  return null;
}

function getVisolixDownloadUrl(payload: unknown): string | null {
  return (
    pickVisolixString(payload, ["download_url", "downloadUrl", "url"]) ??
    getVisolixAlternativeDownloadUrl(payload)
  );
}

function getVisolixTitle(payload: unknown): string | null {
  return pickVisolixString(payload, ["title"]);
}

function getVisolixProgressUrl(payload: VisolixInitResponse): string | null {
  const explicitProgressUrl = pickVisolixString(payload, ["progress_url", "progressUrl"]);
  if (explicitProgressUrl) {
    return explicitProgressUrl;
  }

  const downloadId = pickVisolixScalar(payload, ["id", "download_id", "downloadId", "job_id", "jobId"]);
  return downloadId ? buildVisolixProgressUrl(downloadId) : null;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 0
  );
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:169.254.") ||
    normalized.startsWith("::ffff:172.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isPrivateIpv4(address);
  }
  if (family === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

type SafeRemoteUrl = {
  url: string;
  hostname: string;
  addresses: string[];
};

export function createPinnedHttpsLookup(pinnedAddress: string) {
  const family = isIP(pinnedAddress);
  if (family !== 4 && family !== 6) {
    throw new Error("Remote URL did not resolve to a valid IP address.");
  }

  return (
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: 4 | 6 }>,
      family?: 4 | 6
    ) => void
  ) => {
    if (options?.all) {
      callback(null, [{ address: pinnedAddress, family }]);
      return;
    }
    callback(null, pinnedAddress, family);
  };
}

async function resolveSafeRemoteUrl(rawUrl: string, label: string): Promise<SafeRemoteUrl> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} вернул некорректный URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} URL должен использовать HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} URL не должен содержать credentials.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`${label} URL указывает на localhost.`);
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`${label} URL указывает на внутренний адрес.`);
    }
    return {
      url: parsed.toString(),
      hostname,
      addresses: [hostname]
    };
  }

  const addresses = await (testSafeLookup
    ? testSafeLookup(hostname)
    : dnsLookup(hostname, { all: true })).catch(() => []);
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error(`${label} URL не прошёл проверку публичного адреса.`);
  }

  return {
    url: parsed.toString(),
    hostname,
    addresses: addresses.map((entry) => entry.address)
  };
}

function headersToRecord(headersInit: HeadersInit | undefined): Record<string, string> {
  const headers = new Headers(headersInit);
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function hasSensitiveRedirectHeaders(init: RequestInit): boolean {
  const headers = new Headers(init.headers);
  return ["authorization", "proxy-authorization", "cookie", "x-api-key"].some((name) => headers.has(name));
}

function responseHeadersFromIncoming(headers: IncomingHttpHeaders): Headers {
  const output = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        output.append(key, item);
      }
    } else if (typeof value === "string") {
      output.set(key, value);
    }
  }
  return output;
}

async function fetchPinnedHttpsUrl(safe: SafeRemoteUrl, init: RequestInit): Promise<Response> {
  if (testSafeFetch) {
    return testSafeFetch(safe.url, init);
  }
  const parsed = new URL(safe.url);
  const pinnedAddress = safe.addresses[0];
  if (!pinnedAddress) {
    throw new Error("Remote URL did not resolve to a public address.");
  }
  return await new Promise<Response>((resolve, reject) => {
    const request = https.request(
      parsed,
      {
        method: init.method ?? "GET",
        headers: headersToRecord(init.headers),
        lookup: createPinnedHttpsLookup(pinnedAddress)
      },
      (incoming) => {
        resolve(
          new Response(Readable.toWeb(incoming) as unknown as BodyInit, {
            status: incoming.statusCode ?? 500,
            statusText: incoming.statusMessage,
            headers: responseHeadersFromIncoming(incoming.headers)
          })
        );
      }
    );
    const abortHandler = () => {
      request.destroy(new Error("Request aborted."));
    };
    init.signal?.addEventListener("abort", abortHandler, { once: true });
    request.on("error", reject);
    request.on("close", () => {
      init.signal?.removeEventListener("abort", abortHandler);
    });
    const body = init.body;
    if (typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array) {
      request.write(body);
    } else if (body) {
      request.destroy(new Error("Unsupported request body for safe remote fetch."));
      return;
    }
    request.end();
  });
}

async function fetchSafeRemoteUrl(
  rawUrl: string,
  init: RequestInit,
  label: string,
  redirectsLeft = MAX_SAFE_REMOTE_REDIRECTS
): Promise<Response> {
  const safe = await resolveSafeRemoteUrl(rawUrl, label);
  const response = await fetchPinnedHttpsUrl(safe, {
    ...init,
    redirect: "manual"
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location || redirectsLeft <= 0) {
      throw new Error(`${label} вернул небезопасный redirect.`);
    }
    const nextUrl = new URL(location, safe.url).toString();
    if (new URL(nextUrl).origin !== new URL(safe.url).origin && hasSensitiveRedirectHeaders(init)) {
      throw new Error(`${label} вернул cross-origin redirect для запроса с sensitive headers.`);
    }
    return fetchSafeRemoteUrl(nextUrl, init, label, redirectsLeft - 1);
  }
  return response;
}

function createByteLimitTransform(maxBytes: number, label: string): Transform {
  let totalBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        callback(new Error(`${label} вернул слишком большой файл.`));
        return;
      }
      callback(null, chunk);
    }
  });
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

function buildInstagramVisolixVariants(rawUrl: string): string[] {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes("instagram.com")) {
      return [];
    }

    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const reelIndex = pathSegments.findIndex((segment) => {
      const lowered = segment.toLowerCase();
      return lowered === "reel" || lowered === "reels";
    });
    const reelId = reelIndex >= 0 ? pathSegments[reelIndex + 1] : null;
    if (!reelId) {
      return [];
    }

    const baseHosts = Array.from(new Set([parsed.hostname, parsed.hostname.replace(/^www\./i, ""), `www.${parsed.hostname.replace(/^www\./i, "")}`]));
    const pathVariants = [`/reel/${reelId}`, `/reel/${reelId}/`];
    const urls: string[] = [];

    for (const host of baseHosts) {
      for (const pathname of pathVariants) {
        const candidate = new URL(parsed.toString());
        candidate.protocol = "https:";
        candidate.hostname = host;
        candidate.pathname = pathname;
        candidate.search = "";
        candidate.hash = "";
        candidate.username = "";
        candidate.password = "";
        urls.push(candidate.toString());
      }
    }

    return urls;
  } catch {
    return [];
  }
}

function buildVisolixUrlCandidates(rawUrl: string): string[] {
  const trimmed = rawUrl.trim();
  const normalized = normalizeUrlForVisolix(trimmed).trim();
  const instagramVariants = buildInstagramVisolixVariants(normalized);
  const rawCandidates = Array.from(new Set([normalized, ...instagramVariants, trimmed].filter(Boolean)));
  const encodedCandidates = rawCandidates
    .map((candidate) => encodeVisolixHeaderUrl(candidate))
    .filter((candidate, index, list) => candidate !== rawCandidates[index] && list.indexOf(candidate) === index);

  return Array.from(new Set([...rawCandidates, ...encodedCandidates]));
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

      const response = await fetchSafeRemoteUrl(`${getVisolixBaseUrl()}/api/download`, {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal
      }, "Visolix API");
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
      const directDownloadUrl = getVisolixDownloadUrl(payload);
      const progressUrl = getVisolixProgressUrl(payload);

      if (!directDownloadUrl && !progressUrl) {
        lastError = new Error("Visolix не вернул download_url, progress_url или id для download job.");
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
    const response = await fetchSafeRemoteUrl(progressUrl, { cache: "no-store" }, "Visolix progress");
    const body = (await readJsonOrText(response)) as Record<string, unknown> | null;

    if (!response.ok) {
      throw new Error(
        asTrimmedString(body?.detail) ??
          asTrimmedString(body?.error) ??
          asTrimmedString(body?.message) ??
          `Visolix progress API вернул HTTP ${response.status}.`
      );
    }

    const downloadUrl = getVisolixDownloadUrl(body);
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
  const response = await fetchSafeRemoteUrl(downloadUrl, { cache: "no-store" }, providerLabel);
  if (!response.ok) {
    throw new Error(`Не удалось скачать файл из ${providerLabel} (HTTP ${response.status}).`);
  }
  if (!response.body) {
    throw new Error(`${providerLabel} не вернул тело файла.`);
  }
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_SOURCE_DOWNLOAD_BYTES) {
    throw new Error(`${providerLabel} вернул слишком большой файл.`);
  }

  await pipeline(
    Readable.fromWeb(response.body as never),
    createByteLimitTransform(MAX_REMOTE_SOURCE_DOWNLOAD_BYTES, providerLabel),
    createWriteStream(destinationPath)
  );
  const stat = await fs.stat(destinationPath);
  return stat.size;
}

function sanitizeOutputName(rawName: string | null, fallback: string): string {
  return sanitizeFileName(rawName ?? fallback) || fallback;
}

async function tryVisolixDownload(rawUrl: string, tmpDir: string): Promise<SourceDownloadCoreResult> {
  const targetPath = path.join(tmpDir, "source.mp4");
  const initPayload = await visolixDownloadInit(rawUrl);
  const directDownloadUrl = getVisolixDownloadUrl(initPayload);
  const progressUrl = getVisolixProgressUrl(initPayload);

  if (!directDownloadUrl && !progressUrl) {
    throw new Error("Visolix не вернул download_url, progress_url или id для download job.");
  }

  const downloadUrl = directDownloadUrl ?? (await pollVisolixDownload(progressUrl as string));
  const videoSizeBytes = await downloadRemoteFile(downloadUrl, targetPath, "Visolix");
  const title = getVisolixTitle(initPayload);

  return {
    provider: "visolix",
    filePath: targetPath,
    fileName: sanitizeOutputName(title, "source"),
    title,
    durationSec: null,
    videoSizeBytes
  };
}

async function downloadViaYtDlp(input: {
  sourceUrl: string;
  tmpDir: string;
  fileNameHint?: string | null;
  titleHint?: string | null;
  durationHint?: number | null;
  errorContextUrl?: string | null;
}): Promise<Omit<SourceDownloadCoreResult, "provider">> {
  const ytDlpPath = await resolveYtDlpExecutable();
  if (!ytDlpPath) {
    throw new Error(
      process.env.STAGE3_WORKER_SERVER_ORIGIN?.trim()
        ? "yt-dlp не найден на локальном executor."
        : "yt-dlp не найден в среде выполнения."
    );
  }

  const outputTemplate = path.join(input.tmpDir, "source.%(ext)s");
  const ytDlpAuth = await createYtDlpAuthContext(input.tmpDir);
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
    input.sourceUrl
  ];

  try {
    await runWithHostedSubprocessGate(() =>
      execFileAsync(ytDlpPath, args, {
        timeout: 5 * 60 * 1000,
        maxBuffer: 1024 * 1024 * 16
      })
    );
  } catch (error) {
    throw new Error(
      extractYtDlpErrorFromUnknown(error, { sourceUrl: input.errorContextUrl ?? input.sourceUrl }) ??
        (error instanceof Error ? error.message : "yt-dlp не смог скачать исходное видео.")
    );
  }

  const files = await fs.readdir(input.tmpDir);
  const mp4File = files.find((file) => file.endsWith(".mp4"));
  const infoJsonFile = files.find((file) => file.endsWith(".info.json"));

  if (!mp4File) {
    throw new Error("yt-dlp не создал mp4 после скачивания source.");
  }

  const downloadedPath = path.join(input.tmpDir, mp4File);
  const canonicalPath = path.join(input.tmpDir, "source.mp4");
  if (downloadedPath !== canonicalPath) {
    await fs.copyFile(downloadedPath, canonicalPath);
  }

  let title: string | null = input.titleHint ?? null;
  let durationSec: number | null = input.durationHint ?? null;

  if (infoJsonFile) {
    const infoJson = JSON.parse(await fs.readFile(path.join(input.tmpDir, infoJsonFile), "utf-8")) as YtDlpInfoJson;
    title = asTrimmedString(infoJson.title) ?? title;
    durationSec = asPositiveNumber(infoJson.duration) ?? durationSec;
  }

  const stat = await fs.stat(canonicalPath);
  return {
    filePath: canonicalPath,
    fileName: sanitizeOutputName(input.fileNameHint ?? title ?? path.parse(mp4File).name, "source"),
    title,
    durationSec,
    videoSizeBytes: stat.size
  };
}

async function tryYtDlpDownload(rawUrl: string, tmpDir: string): Promise<SourceDownloadCoreResult> {
  const sourceUrl = normalizeSupportedUrl(rawUrl);
  const downloaded = await downloadViaYtDlp({
    sourceUrl,
    tmpDir,
    errorContextUrl: sourceUrl
  });

  return {
    provider: "ytDlp",
    ...downloaded
  };
}

export async function findDownloadedMediaAudioIssue(
  filePath: string,
  options: { providerLabel?: string } = {}
): Promise<string | null> {
  const providerLabel = options.providerLabel?.trim() || "Source provider";
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,duration:format=duration",
        "-of",
        "json",
        filePath
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: unknown; duration?: unknown }>;
      format?: { duration?: unknown };
    };
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const audioDurations = streams
      .filter((stream) => stream.codec_type === "audio")
      .map((stream) => stream.duration);
    if (!audioDurations.length) {
      return `${providerLabel} вернул mp4 без аудиодорожки.`;
    }

    const audioDurationSec = maxPositiveDuration(audioDurations);
    const videoDurationSec =
      maxPositiveDuration(streams.filter((stream) => stream.codec_type === "video").map((stream) => stream.duration)) ??
      asPositiveNumber(parsed.format?.duration);
    if (
      audioDurationSec !== null &&
      videoDurationSec !== null &&
      videoDurationSec >= 4 &&
      audioDurationSec + 0.75 < videoDurationSec &&
      audioDurationSec / videoDurationSec < 0.9
    ) {
      return `${providerLabel} вернул mp4, где аудио короче видео (${audioDurationSec.toFixed(1)}с из ${videoDurationSec.toFixed(1)}с).`;
    }
    return null;
  } catch {
    return null;
  }
}

export async function downloadSourceMedia(
  rawUrl: string,
  tmpDir: string,
  options: SourceDownloadOptions = {}
): Promise<SourceDownloadResult> {
  const sourceUrl = normalizeSupportedUrl(rawUrl);
  if (isUploadedSourceUrl(sourceUrl)) {
    throw new Error("Загруженный mp4 уже хранится локально и не должен скачиваться повторно.");
  }

  const visolixDownloader = testVisolixDownloader ?? tryVisolixDownload;
  const ytDlpDownloader = testYtDlpDownloader ?? tryYtDlpDownload;
  const hostedFallbackSkippedReason = buildHostedFallbackSkippedReason(sourceUrl);
  const shouldAttemptVisolix = Boolean(hostedFallbackSkippedReason) || isVisolixConfigured();
  const shouldSkipHostedFallback = Boolean(hostedFallbackSkippedReason);
  let summary = createProviderErrorSummary({
    primaryProvider: shouldAttemptVisolix ? "visolix" : "ytDlp",
    hostedFallbackSkippedReason
  });
  let primaryProviderError: string | null = null;

  if (shouldAttemptVisolix) {
    try {
      const downloaded = await visolixDownloader(sourceUrl, tmpDir);
      const audioIssue = await findDownloadedMediaAudioIssue(downloaded.filePath, {
        providerLabel: "Visolix"
      });
      if (audioIssue) {
        summary = createProviderErrorSummary({
          primaryProvider: "visolix",
          primaryProviderError: audioIssue,
          hostedFallbackSkippedReason
        });
        primaryProviderError = formatLegacyPrimaryProviderError("visolix", audioIssue);
        if (shouldSkipHostedFallback) {
          throw new SourceDownloadError(
            primaryProviderError ?? "Source fetch failed.",
            buildSourceDownloadErrorContext(summary, {
              attempt: 1,
              maxAttempts: 1
            })
          );
        }
      } else {
        return {
          ...downloaded,
          primaryProviderError: null,
          downloadFallbackUsed: false,
          providerErrorSummary: null
        };
      }
    } catch (error) {
      if (error instanceof SourceDownloadError) {
        throw error;
      }
      const primaryErrorMessage =
        error instanceof Error ? error.message.trim() || "source fetch failed." : "source fetch failed.";
      const retryEligible = isRetryableVisolixErrorMessage(primaryErrorMessage);
      summary = createProviderErrorSummary({
        primaryProvider: "visolix",
        primaryProviderError: primaryErrorMessage,
        primaryRetryEligible: retryEligible,
        hostedFallbackSkippedReason
      });
      primaryProviderError = formatLegacyPrimaryProviderError("visolix", primaryErrorMessage);

      if (retryEligible) {
        const retryDelayMs = getSourceDownloadRetryDelayMs();
        const retryAt = new Date(Date.now() + retryDelayMs).toISOString();
        await options.onRetryScheduled?.({
          provider: "visolix",
          attempt: 1,
          maxAttempts: 2,
          retryAt,
          providerErrorSummary: summary
        });
        await sleep(retryDelayMs);
        try {
          const downloaded = await visolixDownloader(sourceUrl, tmpDir);
          return {
            ...downloaded,
            primaryProviderError: null,
            downloadFallbackUsed: false,
            providerErrorSummary: null
          };
        } catch (retryError) {
          const retryErrorMessage =
            retryError instanceof Error ? retryError.message.trim() || primaryErrorMessage : primaryErrorMessage;
          summary = createProviderErrorSummary({
            ...summary,
            primaryProviderError: retryErrorMessage
          });
          primaryProviderError = formatLegacyPrimaryProviderError("visolix", retryErrorMessage);

          if (shouldSkipHostedFallback) {
            throw new SourceDownloadError(
              primaryProviderError ?? "Source fetch failed.",
              buildSourceDownloadErrorContext(summary, {
                attempt: 2,
                maxAttempts: 2
              })
            );
          }
        }
      }

      if (shouldSkipHostedFallback) {
        throw new SourceDownloadError(
          primaryProviderError ?? "Source fetch failed.",
          buildSourceDownloadErrorContext(summary, {
            attempt: 1,
            maxAttempts: 1
          })
        );
      }
    }
  }

  try {
    const downloaded = await ytDlpDownloader(sourceUrl, tmpDir);
    return {
      ...downloaded,
      primaryProviderError,
      downloadFallbackUsed: Boolean(primaryProviderError),
      providerErrorSummary: primaryProviderError
        ? createProviderErrorSummary({
            ...summary,
            fallbackProvider: "ytDlp"
          })
        : null
    };
  } catch (error) {
    const fallbackError =
      error instanceof Error ? error.message.trim() || "source fetch failed." : "source fetch failed.";
    summary = shouldAttemptVisolix
      ? createProviderErrorSummary({
          ...summary,
          fallbackProvider: "ytDlp",
          fallbackProviderError: fallbackError
        })
      : createProviderErrorSummary({
          primaryProvider: "ytDlp",
          primaryProviderError: fallbackError
        });
    throw new SourceDownloadError(
      formatSourceDownloadFailureMessage(summary),
      buildSourceDownloadErrorContext(summary, {
        attempt: 1,
        maxAttempts: 1
      })
    );
  }
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
    const { stdout } = await runWithHostedSubprocessGate(() =>
      execFileAsync(
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
      )
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
  if (isUploadedSourceUrl(sourceUrl)) {
    return {
      provider: "upload",
      title: getUploadedSourceDisplayName(sourceUrl),
      durationSec: null
    };
  }
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
): Promise<OptionalSourceInfoResult> {
  const sourceUrl = normalizeSupportedUrl(rawUrl);
  if (isYouTubeUrl(sourceUrl)) {
    return fetchOptionalYouTubeInfo(sourceUrl, tmpDir);
  }
  if (isUploadedSourceUrl(sourceUrl)) {
    return {
      infoJson: {
        title: getUploadedSourceDisplayName(sourceUrl) ?? undefined
      },
      commentsExtractionFallbackUsed: false,
      commentsAcquisition: createCommentsAcquisition({
        status: "unavailable",
        provider: null,
        note: "Для загруженного mp4 комментарии недоступны.",
        error: "Комментарии для загруженного mp4 недоступны."
      })
    };
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

    await runWithHostedSubprocessGate(() =>
      execFileAsync(ytDlpPath, args, {
        timeout: 3 * 60 * 1000,
        maxBuffer: 1024 * 1024 * 16
      })
    );
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
): Promise<OptionalSourceInfoResult> {
  const ytDlpPath = await resolveYtDlpExecutable();
  let normalizedInfo: YtDlpInfoJson | null = null;
  let transcript: string | null = null;

  if (ytDlpPath) {
    const outputTemplate = path.join(tmpDir, "metadata.%(ext)s");
    const ytDlpAuth = await createYtDlpAuthContext(tmpDir);

    try {
      await runWithHostedSubprocessGate(() =>
        execFileAsync(
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
        )
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
