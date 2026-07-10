import { createHash } from "node:crypto";

export const PROJECT_KINGS_INSTAGRAM_DISCOVERY_SCHEMA =
  "project-kings-instagram-donor-discovery-v1" as const;

export const PROJECT_KINGS_INSTAGRAM_DONOR_POLICY = Object.freeze({
  "dark-joy-boy": Object.freeze([
    "kodyantle",
    "spidermonkeywinston",
    "myrtlebeachsafari",
    "realdiddykong"
  ]),
  "light-kingdom": Object.freeze(["learnaifaster"]),
  "copscopes-x2e": Object.freeze(["copscopes"])
} as const);

export type ProjectKingsInstagramDiscoveryProfileKey =
  keyof typeof PROJECT_KINGS_INSTAGRAM_DONOR_POLICY;

export type ProjectKingsInstagramDiscoveryIssueCode =
  | "instagram_auth_required"
  | "instagram_access_forbidden"
  | "instagram_rate_limited"
  | "instagram_transient_http_error"
  | "instagram_http_error"
  | "instagram_timeout"
  | "instagram_network_error"
  | "instagram_response_too_large"
  | "instagram_invalid_json"
  | "instagram_session_bootstrap_failed"
  | "instagram_profile_not_found"
  | "instagram_invalid_profile_response"
  | "instagram_invalid_clips_response"
  | "instagram_invalid_item"
  | "instagram_pagination_invalid";

export type ProjectKingsInstagramDiscoveryIssueClassification =
  | "authentication_required"
  | "access_forbidden"
  | "rate_limited"
  | "transient"
  | "invalid_response"
  | "not_found";

export type ProjectKingsInstagramDiscoveryIssue = Readonly<{
  profileKey: ProjectKingsInstagramDiscoveryProfileKey;
  donorUsername: string | null;
  endpoint: ProjectKingsInstagramRequestEndpoint;
  code: ProjectKingsInstagramDiscoveryIssueCode;
  classification: ProjectKingsInstagramDiscoveryIssueClassification;
  retryable: boolean;
  httpStatus: number | null;
  attempts: number;
  detail: string;
  evidenceSha256: string;
}>;

export type ProjectKingsInstagramRequestEndpoint =
  | "session_bootstrap"
  | "profile_lookup"
  | "clips_page";

export type ProjectKingsInstagramRequestEvidence = Readonly<{
  endpoint: ProjectKingsInstagramRequestEndpoint;
  donorUsername: string | null;
  pageNumber: number | null;
  httpStatus: number;
  attempts: number;
  responseSha256: string;
  evidenceSha256: string;
}>;

export type ProjectKingsInstagramDiscoveryCandidate = Readonly<{
  profileKey: ProjectKingsInstagramDiscoveryProfileKey;
  donorUsername: string;
  donorUserId: string;
  mediaId: string | null;
  shortcode: string;
  canonicalUrl: string;
  caption: string;
  captionWasTruncated: boolean;
  viewCount: number | null;
  takenAtEpochSeconds: number | null;
  takenAt: string | null;
  pageResponseSha256: string;
  discoveryState: "discovery_only";
  semanticDecision: null;
  automaticQualification: false;
  evidenceSha256: string;
}>;

export type ProjectKingsInstagramDiscoveryExclusion = Readonly<{
  profileKey: ProjectKingsInstagramDiscoveryProfileKey;
  donorUsername: string;
  shortcode: string;
  canonicalUrl: string;
  reason: "known_canonical_url" | "duplicate";
  duplicateDimensions: readonly ("shortcode" | "canonical_url")[];
  pageResponseSha256: string;
  evidenceSha256: string;
}>;

export type ProjectKingsInstagramDonorDiscovery = Readonly<{
  donorUsername: string;
  donorUserId: string | null;
  status: "complete" | "partial" | "failed";
  pagesFetched: number;
  itemsSeen: number;
  paginationExhausted: boolean;
  candidates: readonly ProjectKingsInstagramDiscoveryCandidate[];
  exclusions: readonly ProjectKingsInstagramDiscoveryExclusion[];
  requestEvidence: readonly ProjectKingsInstagramRequestEvidence[];
  issues: readonly ProjectKingsInstagramDiscoveryIssue[];
  evidenceSha256: string;
}>;

export type ProjectKingsInstagramProfileDiscovery = Readonly<{
  profileKey: ProjectKingsInstagramDiscoveryProfileKey;
  donorPolicy: readonly string[];
  status: "complete" | "partial" | "failed";
  donors: readonly ProjectKingsInstagramDonorDiscovery[];
  requestEvidence: readonly ProjectKingsInstagramRequestEvidence[];
  issues: readonly ProjectKingsInstagramDiscoveryIssue[];
  evidenceSha256: string;
}>;

export type ProjectKingsInstagramDiscoveryPacket = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_INSTAGRAM_DISCOVERY_SCHEMA;
  capturedAt: string;
  provider: "instagram_public_web";
  requestSha256: string;
  knownCanonicalUrlsSha256: string;
  knownCanonicalUrlCount: number;
  limits: Readonly<{
    pagesPerDonor: number;
    itemsPerDonor: number;
    pageSize: number;
    timeoutMs: number;
    maxAttempts: number;
    maxResponseBytes: number;
  }>;
  profiles: readonly ProjectKingsInstagramProfileDiscovery[];
  summary: Readonly<{
    profileCount: number;
    donorCount: number;
    candidateCount: number;
    excludedKnownCount: number;
    duplicateCount: number;
    issueCount: number;
    complete: boolean;
  }>;
  evidenceSha256: string;
}>;

export type ProjectKingsInstagramFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type DiscoverProjectKingsInstagramDonorsOptions = Readonly<{
  profileKeys?: readonly ProjectKingsInstagramDiscoveryProfileKey[];
  knownCanonicalUrls?: readonly string[];
  capturedAt?: string;
  pagesPerDonor?: number;
  itemsPerDonor?: number;
  pageSize?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  maxResponseBytes?: number;
  fetchImpl?: ProjectKingsInstagramFetch;
  sleep?: (delayMs: number) => Promise<void>;
}>;

type UnknownRecord = Record<string, unknown>;

type RequestSuccess = Readonly<{
  bodyText: string;
  responseSha256: string;
  responseHeaders: Headers;
  evidence: ProjectKingsInstagramRequestEvidence;
}>;

type RequestFailureDetails = Readonly<{
  endpoint: ProjectKingsInstagramRequestEndpoint;
  code: ProjectKingsInstagramDiscoveryIssueCode;
  classification: ProjectKingsInstagramDiscoveryIssueClassification;
  retryable: boolean;
  httpStatus: number | null;
  attempts: number;
  detail: string;
}>;

const INSTAGRAM_ORIGIN = "https://www.instagram.com";
const INSTAGRAM_APP_ID = "936619743392459";
const ALLOWED_FETCH_HOSTS = new Set(["www.instagram.com"]);
const ALLOWED_FETCH_PATHS = new Set([
  "/",
  "/api/v1/users/web_profile_info/",
  "/api/v1/clips/user/"
]);
const SOURCE_URL_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
const CAPTION_LIMIT = 4_000;
const DEFAULT_PAGES_PER_DONOR = 2;
const DEFAULT_ITEMS_PER_DONOR = 24;
const DEFAULT_PAGE_SIZE = 12;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 5_000;
const SHORTCODE = /^[A-Za-z0-9_-]{3,64}$/;

class InstagramRequestFailure extends Error {
  readonly details: RequestFailureDetails;

  constructor(details: RequestFailureDetails) {
    super(details.detail);
    this.name = "InstagramRequestFailure";
    this.details = details;
  }
}

class InstagramResponseTooLarge extends Error {
  constructor() {
    super("Instagram response exceeded the configured byte limit.");
    this.name = "InstagramResponseTooLarge";
  }
}

export class ProjectKingsInstagramDiscoveryError extends Error {
  readonly code: "invalid_discovery_configuration";

  constructor(message: string) {
    super(message);
    this.name = "ProjectKingsInstagramDiscoveryError";
    this.code = "invalid_discovery_configuration";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as UnknownRecord)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function stableProjectKingsInstagramDiscoveryJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashProjectKingsInstagramDiscoveryEvidence(value: unknown): string {
  return createHash("sha256")
    .update(stableProjectKingsInstagramDiscoveryJson(value))
    .digest("hex");
}

function withEvidenceSha256<T extends UnknownRecord>(payload: T): Readonly<T & { evidenceSha256: string }> {
  return Object.freeze({
    ...payload,
    evidenceSha256: hashProjectKingsInstagramDiscoveryEvidence(payload)
  });
}

function objectOrNull(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new ProjectKingsInstagramDiscoveryError(
      `${label} must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return resolved;
}

function normalizeProfileKeys(
  profileKeys: readonly ProjectKingsInstagramDiscoveryProfileKey[] | undefined
): ProjectKingsInstagramDiscoveryProfileKey[] {
  const selected = profileKeys ?? Object.keys(PROJECT_KINGS_INSTAGRAM_DONOR_POLICY) as
    ProjectKingsInstagramDiscoveryProfileKey[];
  const unique = [...new Set(selected)];
  if (unique.length === 0) {
    throw new ProjectKingsInstagramDiscoveryError("At least one profile key is required.");
  }
  for (const key of unique) {
    if (!Object.hasOwn(PROJECT_KINGS_INSTAGRAM_DONOR_POLICY, key)) {
      throw new ProjectKingsInstagramDiscoveryError(`Unsupported profile key: ${String(key)}.`);
    }
  }
  return unique;
}

export function normalizeInstagramShortcode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return SHORTCODE.test(normalized) ? normalized : null;
}

export function canonicalizeInstagramReelUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProjectKingsInstagramDiscoveryError("Known source URL is not a valid URL.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    !SOURCE_URL_HOSTS.has(hostname) ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    throw new ProjectKingsInstagramDiscoveryError("Known source URLs must be HTTPS Instagram URLs.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const reelIndex = segments.findIndex((segment) => segment.toLowerCase() === "reel");
  const shortcode = reelIndex >= 0 ? normalizeInstagramShortcode(segments[reelIndex + 1]) : null;
  if (!shortcode || reelIndex > 1) {
    throw new ProjectKingsInstagramDiscoveryError("Known source URL is not a supported Instagram Reel URL.");
  }
  return `${INSTAGRAM_ORIGIN}/reel/${shortcode}/`;
}

export function assertAllowedProjectKingsInstagramFetchUrl(rawUrl: string | URL): URL {
  let parsed: URL;
  try {
    parsed = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl);
  } catch {
    throw new ProjectKingsInstagramDiscoveryError(
      "Instagram discovery fetch target is not a valid URL."
    );
  }
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_FETCH_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    !ALLOWED_FETCH_PATHS.has(parsed.pathname)
  ) {
    throw new ProjectKingsInstagramDiscoveryError(
      "Instagram discovery fetch target is outside the HTTPS allowlist."
    );
  }
  return parsed;
}

function normalizeCaption(value: unknown): { caption: string; truncated: boolean } {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length <= CAPTION_LIMIT) return { caption: normalized, truncated: false };
  return { caption: normalized.slice(0, CAPTION_LIMIT), truncated: true };
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeTimestamp(value: unknown): { epochSeconds: number | null; iso: string | null } {
  let numeric = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return { epochSeconds: null, iso: null };
  if (numeric >= 1_000_000_000_000) numeric /= 1_000;
  const epochSeconds = Math.floor(numeric);
  const date = new Date(epochSeconds * 1_000);
  if (!Number.isFinite(date.getTime())) return { epochSeconds: null, iso: null };
  return { epochSeconds, iso: date.toISOString() };
}

function responseSetCookies(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const direct = extended.getSetCookie?.();
  if (direct?.length) return direct;
  const combined = headers.get("set-cookie");
  return combined
    ? combined.split(/,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/g).map((entry) => entry.trim())
    : [];
}

class EphemeralInstagramCookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(headers: Headers): void {
    for (const setCookie of responseSetCookies(headers)) {
      const pair = setCookie.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim().toLowerCase();
      const value = pair.slice(separator + 1).trim();
      if (!new Set(["mid", "csrftoken"]).has(name)) continue;
      if (!value || value.length > 512 || /[;\r\n\0]/.test(value)) continue;
      this.cookies.set(name, value);
    }
  }

  ready(): boolean {
    return Boolean(this.cookies.get("mid") && this.cookies.get("csrftoken"));
  }

  csrfToken(): string {
    return this.cookies.get("csrftoken") ?? "";
  }

  requestCookieHeader(): string {
    const csrfToken = this.cookies.get("csrftoken") ?? "";
    const mid = this.cookies.get("mid") ?? "";
    return `csrftoken=${csrfToken}; mid=${mid}`;
  }
}

function classifyHttpFailure(
  endpoint: ProjectKingsInstagramRequestEndpoint,
  status: number,
  attempts: number
): InstagramRequestFailure {
  if (status === 401) {
    return new InstagramRequestFailure({
      endpoint,
      code: "instagram_auth_required",
      classification: "authentication_required",
      retryable: false,
      httpStatus: status,
      attempts,
      detail: "Instagram public-web request requires authentication."
    });
  }
  if (status === 403) {
    return new InstagramRequestFailure({
      endpoint,
      code: "instagram_access_forbidden",
      classification: "access_forbidden",
      retryable: false,
      httpStatus: status,
      attempts,
      detail: "Instagram public-web request was forbidden."
    });
  }
  if (status === 429) {
    return new InstagramRequestFailure({
      endpoint,
      code: "instagram_rate_limited",
      classification: "rate_limited",
      retryable: true,
      httpStatus: status,
      attempts,
      detail: "Instagram public-web request was rate limited."
    });
  }
  const transient = status === 408 || status >= 500;
  return new InstagramRequestFailure({
    endpoint,
    code: transient ? "instagram_transient_http_error" : "instagram_http_error",
    classification: transient ? "transient" : "invalid_response",
    retryable: transient,
    httpStatus: status,
    attempts,
    detail: transient
      ? "Instagram public-web request returned a transient HTTP error."
      : "Instagram public-web request returned an unsupported HTTP response."
  });
}

function retryDelayMs(attempt: number, headers: Headers | null): number {
  const retryAfter = headers?.get("retry-after")?.trim() ?? "";
  if (/^\d+$/.test(retryAfter)) {
    return Math.min(MAX_RETRY_DELAY_MS, Number(retryAfter) * 1_000);
  }
  return Math.min(MAX_RETRY_DELAY_MS, 250 * 2 ** Math.max(0, attempt - 1));
}

async function readResponseBodyBounded(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal
): Promise<{ bodyText: string; responseSha256: string }> {
  if (!response.body) {
    return {
      bodyText: "",
      responseSha256: createHash("sha256").update("").digest("hex")
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const hash = createHash("sha256");
  let bodyText = "";
  let sizeBytes = 0;
  let abortHandler: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortHandler = () => {
      reject(new DOMException("Instagram response body timed out.", "AbortError"));
      void reader.cancel().catch(() => undefined);
    };
    if (signal.aborted) abortHandler();
    else signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      sizeBytes += chunk.value.byteLength;
      if (sizeBytes > maxResponseBytes) {
        void reader.cancel().catch(() => undefined);
        throw new InstagramResponseTooLarge();
      }
      hash.update(chunk.value);
      bodyText += decoder.decode(chunk.value, { stream: true });
    }
    bodyText += decoder.decode();
    return { bodyText, responseSha256: hash.digest("hex") };
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

async function requestInstagram(input: {
  fetchImpl: ProjectKingsInstagramFetch;
  sleep: (delayMs: number) => Promise<void>;
  url: URL;
  init: RequestInit;
  endpoint: ProjectKingsInstagramRequestEndpoint;
  donorUsername: string | null;
  pageNumber: number | null;
  timeoutMs: number;
  maxAttempts: number;
  maxResponseBytes: number;
}): Promise<RequestSuccess> {
  assertAllowedProjectKingsInstagramFetchUrl(input.url);
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let rejectDeadline: (reason: unknown) => void = () => undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timeout = setTimeout(() => {
      controller.abort();
      rejectDeadline(new DOMException("Instagram request timed out.", "AbortError"));
    }, input.timeoutMs);
    let response: Response;
    try {
      response = await Promise.race([
        input.fetchImpl(input.url, {
          ...input.init,
          redirect: "manual",
          signal: controller.signal
        }),
        deadline
      ]);
    } catch (error) {
      clearTimeout(timeout);
      const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      const failure = new InstagramRequestFailure({
        endpoint: input.endpoint,
        code: timedOut ? "instagram_timeout" : "instagram_network_error",
        classification: "transient",
        retryable: true,
        httpStatus: null,
        attempts: attempt,
        detail: timedOut
          ? "Instagram public-web request timed out."
          : "Instagram public-web request failed at the network boundary."
      });
      if (attempt === input.maxAttempts) throw failure;
      await input.sleep(retryDelayMs(attempt, null));
      continue;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      clearTimeout(timeout);
      const failure = classifyHttpFailure(input.endpoint, response.status, attempt);
      if (!failure.details.retryable || attempt === input.maxAttempts) throw failure;
      await input.sleep(retryDelayMs(attempt, response.headers));
      continue;
    }
    const declaredSize = normalizeNonNegativeInteger(response.headers.get("content-length"));
    if (declaredSize !== null && declaredSize > input.maxResponseBytes) {
      void response.body?.cancel().catch(() => undefined);
      clearTimeout(timeout);
      throw new InstagramRequestFailure({
        endpoint: input.endpoint,
        code: "instagram_response_too_large",
        classification: "invalid_response",
        retryable: false,
        httpStatus: response.status,
        attempts: attempt,
        detail: "Instagram public-web response exceeded the configured byte limit."
      });
    }
    let bodyText: string;
    let responseSha256: string;
    try {
      ({ bodyText, responseSha256 } = await readResponseBodyBounded(
        response,
        input.maxResponseBytes,
        controller.signal
      ));
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof InstagramResponseTooLarge) {
        throw new InstagramRequestFailure({
          endpoint: input.endpoint,
          code: "instagram_response_too_large",
          classification: "invalid_response",
          retryable: false,
          httpStatus: response.status,
          attempts: attempt,
          detail: "Instagram public-web response exceeded the configured byte limit."
        });
      }
      const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      const failure = new InstagramRequestFailure({
        endpoint: input.endpoint,
        code: timedOut ? "instagram_timeout" : "instagram_network_error",
        classification: "transient",
        retryable: true,
        httpStatus: response.status,
        attempts: attempt,
        detail: timedOut
          ? "Instagram public-web response timed out while reading its body."
          : "Instagram public-web response failed while reading its body."
      });
      if (attempt === input.maxAttempts) throw failure;
      await input.sleep(retryDelayMs(attempt, response.headers));
      continue;
    }
    clearTimeout(timeout);
    return {
      bodyText,
      responseSha256,
      responseHeaders: response.headers,
      evidence: withEvidenceSha256({
        endpoint: input.endpoint,
        donorUsername: input.donorUsername,
        pageNumber: input.pageNumber,
        httpStatus: response.status,
        attempts: attempt,
        responseSha256
      })
    };
  }
  throw new ProjectKingsInstagramDiscoveryError("Instagram request exhausted without a result.");
}

function parseJsonResponse(
  response: RequestSuccess,
  endpoint: ProjectKingsInstagramRequestEndpoint
): UnknownRecord {
  try {
    const parsed = JSON.parse(response.bodyText) as unknown;
    const record = objectOrNull(parsed);
    if (!record) throw new Error("not an object");
    return record;
  } catch {
    throw new InstagramRequestFailure({
      endpoint,
      code: "instagram_invalid_json",
      classification: "invalid_response",
      retryable: false,
      httpStatus: response.evidence.httpStatus,
      attempts: response.evidence.attempts,
      detail: "Instagram public-web response was not valid object JSON."
    });
  }
}

function issueFromFailure(
  failure: InstagramRequestFailure,
  profileKey: ProjectKingsInstagramDiscoveryProfileKey,
  donorUsername: string | null
): ProjectKingsInstagramDiscoveryIssue {
  return withEvidenceSha256({
    profileKey,
    donorUsername,
    endpoint: failure.details.endpoint,
    code: failure.details.code,
    classification: failure.details.classification,
    retryable: failure.details.retryable,
    httpStatus: failure.details.httpStatus,
    attempts: failure.details.attempts,
    detail: failure.details.detail
  });
}

function createIssue(input: Omit<ProjectKingsInstagramDiscoveryIssue, "evidenceSha256">) {
  return withEvidenceSha256({ ...input });
}

function normalizeMediaItem(input: {
  rawItem: unknown;
  profileKey: ProjectKingsInstagramDiscoveryProfileKey;
  donorUsername: string;
  donorUserId: string;
  pageResponseSha256: string;
}): Omit<ProjectKingsInstagramDiscoveryCandidate, "evidenceSha256"> | null {
  const item = objectOrNull(input.rawItem);
  if (!item) return null;
  const media = objectOrNull(item.media) ?? item;
  const shortcode = normalizeInstagramShortcode(media.code ?? media.shortcode);
  if (!shortcode) return null;
  const captionContainer = objectOrNull(media.caption);
  const normalizedCaption = normalizeCaption(
    captionContainer?.text ?? media.caption_text ?? (typeof media.caption === "string" ? media.caption : "")
  );
  const timestamp = normalizeTimestamp(media.taken_at ?? media.taken_at_timestamp);
  const mediaIdRaw = media.pk ?? media.id;
  const mediaId = typeof mediaIdRaw === "string" || typeof mediaIdRaw === "number"
    ? String(mediaIdRaw)
    : null;
  return {
    profileKey: input.profileKey,
    donorUsername: input.donorUsername,
    donorUserId: input.donorUserId,
    mediaId,
    shortcode,
    canonicalUrl: `${INSTAGRAM_ORIGIN}/reel/${shortcode}/`,
    caption: normalizedCaption.caption,
    captionWasTruncated: normalizedCaption.truncated,
    viewCount: normalizeNonNegativeInteger(
      media.play_count ?? media.view_count ?? media.video_view_count
    ),
    takenAtEpochSeconds: timestamp.epochSeconds,
    takenAt: timestamp.iso,
    pageResponseSha256: input.pageResponseSha256,
    discoveryState: "discovery_only",
    semanticDecision: null,
    automaticQualification: false
  };
}

function profileUserId(payload: UnknownRecord): string | null {
  const data = objectOrNull(payload.data);
  const user = objectOrNull(data?.user ?? payload.user);
  const raw = user?.id ?? user?.pk;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const normalized = String(raw).trim();
  return normalized && normalized.length <= 128 ? normalized : null;
}

function pageItems(payload: UnknownRecord): unknown[] | null {
  return Array.isArray(payload.items) ? payload.items : null;
}

function pagination(payload: UnknownRecord): { moreAvailable: boolean; maxId: string | null } {
  const pagingInfo = objectOrNull(payload.paging_info);
  const moreAvailable = payload.more_available === true || pagingInfo?.more_available === true;
  const rawMaxId = payload.next_max_id ?? payload.max_id ?? pagingInfo?.max_id ?? pagingInfo?.next_max_id;
  const maxId = typeof rawMaxId === "string" && rawMaxId.trim()
    ? rawMaxId.trim().slice(0, 1_024)
    : null;
  return { moreAvailable, maxId };
}

function requestHeaders(input: {
  cookieJar?: EphemeralInstagramCookieJar;
  donorUsername?: string;
  post?: boolean;
}): Headers {
  const headers = new Headers({
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    "x-ig-app-id": INSTAGRAM_APP_ID
  });
  if (input.donorUsername) {
    headers.set("referer", `${INSTAGRAM_ORIGIN}/${input.donorUsername}/`);
  }
  if (input.cookieJar) {
    headers.set("cookie", input.cookieJar.requestCookieHeader());
    headers.set("x-csrftoken", input.cookieJar.csrfToken());
  }
  if (input.post) {
    headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    headers.set("x-requested-with", "XMLHttpRequest");
  }
  return headers;
}

function statusFromIssues(
  issues: readonly ProjectKingsInstagramDiscoveryIssue[],
  producedEvidence: boolean
): "complete" | "partial" | "failed" {
  if (issues.length === 0) return "complete";
  return producedEvidence ? "partial" : "failed";
}

async function discoverDonor(input: {
  profileKey: ProjectKingsInstagramDiscoveryProfileKey;
  donorUsername: string;
  cookieJar: EphemeralInstagramCookieJar;
  fetchImpl: ProjectKingsInstagramFetch;
  sleep: (delayMs: number) => Promise<void>;
  pagesPerDonor: number;
  itemsPerDonor: number;
  pageSize: number;
  timeoutMs: number;
  maxAttempts: number;
  maxResponseBytes: number;
  knownCanonicalUrls: ReadonlySet<string>;
  seenCanonicalUrls: Set<string>;
  seenShortcodes: Set<string>;
}): Promise<ProjectKingsInstagramDonorDiscovery> {
  const requestEvidence: ProjectKingsInstagramRequestEvidence[] = [];
  const issues: ProjectKingsInstagramDiscoveryIssue[] = [];
  const candidates: ProjectKingsInstagramDiscoveryCandidate[] = [];
  const exclusions: ProjectKingsInstagramDiscoveryExclusion[] = [];
  let donorUserId: string | null = null;
  let pagesFetched = 0;
  let itemsSeen = 0;
  let paginationExhausted = false;
  try {
    const profileUrl = new URL("/api/v1/users/web_profile_info/", INSTAGRAM_ORIGIN);
    profileUrl.searchParams.set("username", input.donorUsername);
    const profileResponse = await requestInstagram({
      ...input,
      url: profileUrl,
      init: { method: "GET", headers: requestHeaders({
        cookieJar: input.cookieJar,
        donorUsername: input.donorUsername
      }) },
      endpoint: "profile_lookup",
      donorUsername: input.donorUsername,
      pageNumber: null
    });
    requestEvidence.push(profileResponse.evidence);
    input.cookieJar.absorb(profileResponse.responseHeaders);
    donorUserId = profileUserId(parseJsonResponse(profileResponse, "profile_lookup"));
    if (!donorUserId) {
      issues.push(createIssue({
        profileKey: input.profileKey,
        donorUsername: input.donorUsername,
        endpoint: "profile_lookup",
        code: "instagram_profile_not_found",
        classification: "not_found",
        retryable: false,
        httpStatus: profileResponse.evidence.httpStatus,
        attempts: profileResponse.evidence.attempts,
        detail: "Instagram donor profile did not return a public user id."
      }));
    }
  } catch (error) {
    const failure = error instanceof InstagramRequestFailure
      ? error
      : new InstagramRequestFailure({
        endpoint: "profile_lookup",
        code: "instagram_invalid_profile_response",
        classification: "invalid_response",
        retryable: false,
        httpStatus: null,
        attempts: 1,
        detail: "Instagram donor profile response could not be normalized."
      });
    issues.push(issueFromFailure(failure, input.profileKey, input.donorUsername));
  }

  if (donorUserId) {
    let maxId: string | null = null;
    const seenMaxIds = new Set<string>();
    for (let pageNumber = 1; pageNumber <= input.pagesPerDonor; pageNumber += 1) {
      if (itemsSeen >= input.itemsPerDonor) break;
      try {
        const body = new URLSearchParams({
          target_user_id: donorUserId,
          page_size: String(Math.min(input.pageSize, input.itemsPerDonor - itemsSeen)),
          max_id: maxId ?? ""
        });
        const clipsResponse = await requestInstagram({
          ...input,
          url: new URL("/api/v1/clips/user/", INSTAGRAM_ORIGIN),
          init: {
            method: "POST",
            headers: requestHeaders({
              cookieJar: input.cookieJar,
              donorUsername: input.donorUsername,
              post: true
            }),
            body
          },
          endpoint: "clips_page",
          donorUsername: input.donorUsername,
          pageNumber
        });
        requestEvidence.push(clipsResponse.evidence);
        input.cookieJar.absorb(clipsResponse.responseHeaders);
        const payload = parseJsonResponse(clipsResponse, "clips_page");
        const items = pageItems(payload);
        if (!items) {
          issues.push(createIssue({
            profileKey: input.profileKey,
            donorUsername: input.donorUsername,
            endpoint: "clips_page",
            code: "instagram_invalid_clips_response",
            classification: "invalid_response",
            retryable: false,
            httpStatus: clipsResponse.evidence.httpStatus,
            attempts: clipsResponse.evidence.attempts,
            detail: "Instagram clips response did not contain an items array."
          }));
          break;
        }
        pagesFetched += 1;
        const remaining = input.itemsPerDonor - itemsSeen;
        for (const rawItem of items.slice(0, remaining)) {
          itemsSeen += 1;
          const candidatePayload = normalizeMediaItem({
            rawItem,
            profileKey: input.profileKey,
            donorUsername: input.donorUsername,
            donorUserId,
            pageResponseSha256: clipsResponse.responseSha256
          });
          if (!candidatePayload) {
            issues.push(createIssue({
              profileKey: input.profileKey,
              donorUsername: input.donorUsername,
              endpoint: "clips_page",
              code: "instagram_invalid_item",
              classification: "invalid_response",
              retryable: false,
              httpStatus: clipsResponse.evidence.httpStatus,
              attempts: clipsResponse.evidence.attempts,
              detail: "Instagram clip item did not contain a valid shortcode."
            }));
            continue;
          }
          if (input.knownCanonicalUrls.has(candidatePayload.canonicalUrl)) {
            exclusions.push(withEvidenceSha256({
              profileKey: input.profileKey,
              donorUsername: input.donorUsername,
              shortcode: candidatePayload.shortcode,
              canonicalUrl: candidatePayload.canonicalUrl,
              reason: "known_canonical_url" as const,
              duplicateDimensions: ["canonical_url"] as const,
              pageResponseSha256: clipsResponse.responseSha256
            }));
            continue;
          }
          const duplicateDimensions: ("shortcode" | "canonical_url")[] = [];
          if (input.seenShortcodes.has(candidatePayload.shortcode)) duplicateDimensions.push("shortcode");
          if (input.seenCanonicalUrls.has(candidatePayload.canonicalUrl)) {
            duplicateDimensions.push("canonical_url");
          }
          if (duplicateDimensions.length > 0) {
            exclusions.push(withEvidenceSha256({
              profileKey: input.profileKey,
              donorUsername: input.donorUsername,
              shortcode: candidatePayload.shortcode,
              canonicalUrl: candidatePayload.canonicalUrl,
              reason: "duplicate" as const,
              duplicateDimensions,
              pageResponseSha256: clipsResponse.responseSha256
            }));
            continue;
          }
          input.seenShortcodes.add(candidatePayload.shortcode);
          input.seenCanonicalUrls.add(candidatePayload.canonicalUrl);
          candidates.push(withEvidenceSha256(candidatePayload));
        }
        const next = pagination(payload);
        if (!next.moreAvailable) {
          paginationExhausted = true;
          break;
        }
        if (!next.maxId || seenMaxIds.has(next.maxId)) {
          issues.push(createIssue({
            profileKey: input.profileKey,
            donorUsername: input.donorUsername,
            endpoint: "clips_page",
            code: "instagram_pagination_invalid",
            classification: "invalid_response",
            retryable: false,
            httpStatus: clipsResponse.evidence.httpStatus,
            attempts: clipsResponse.evidence.attempts,
            detail: "Instagram clips pagination repeated or omitted its next cursor."
          }));
          break;
        }
        seenMaxIds.add(next.maxId);
        maxId = next.maxId;
      } catch (error) {
        const failure = error instanceof InstagramRequestFailure
          ? error
          : new InstagramRequestFailure({
            endpoint: "clips_page",
            code: "instagram_invalid_clips_response",
            classification: "invalid_response",
            retryable: false,
            httpStatus: null,
            attempts: 1,
            detail: "Instagram clips response could not be normalized."
          });
        issues.push(issueFromFailure(failure, input.profileKey, input.donorUsername));
        break;
      }
    }
  }

  const payload = {
    donorUsername: input.donorUsername,
    donorUserId,
    status: statusFromIssues(issues, requestEvidence.length > 0) as "complete" | "partial" | "failed",
    pagesFetched,
    itemsSeen,
    paginationExhausted,
    candidates,
    exclusions,
    requestEvidence,
    issues
  };
  return withEvidenceSha256(payload);
}

export async function discoverProjectKingsInstagramDonors(
  options: DiscoverProjectKingsInstagramDonorsOptions = {}
): Promise<ProjectKingsInstagramDiscoveryPacket> {
  const profileKeys = normalizeProfileKeys(options.profileKeys);
  const pagesPerDonor = boundedInteger(
    options.pagesPerDonor,
    DEFAULT_PAGES_PER_DONOR,
    "pagesPerDonor",
    1,
    5
  );
  const itemsPerDonor = boundedInteger(
    options.itemsPerDonor,
    DEFAULT_ITEMS_PER_DONOR,
    "itemsPerDonor",
    1,
    100
  );
  const pageSize = boundedInteger(options.pageSize, DEFAULT_PAGE_SIZE, "pageSize", 1, 50);
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs", 250, 60_000);
  const maxAttempts = boundedInteger(
    options.maxAttempts,
    DEFAULT_MAX_ATTEMPTS,
    "maxAttempts",
    1,
    3
  );
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    "maxResponseBytes",
    1_024,
    10 * 1024 * 1024
  );
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  if (!Number.isFinite(new Date(capturedAt).getTime())) {
    throw new ProjectKingsInstagramDiscoveryError("capturedAt must be an ISO-compatible timestamp.");
  }
  const knownCanonicalUrls = new Set(
    (options.knownCanonicalUrls ?? []).map(canonicalizeInstagramReelUrl)
  );
  const sortedKnownCanonicalUrls = [...knownCanonicalUrls].sort();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ProjectKingsInstagramDiscoveryError("A fetch implementation is required.");
  }
  const sleep = options.sleep ?? ((delayMs: number) => new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  }));
  const limits = Object.freeze({
    pagesPerDonor,
    itemsPerDonor,
    pageSize,
    timeoutMs,
    maxAttempts,
    maxResponseBytes
  });
  const requestSha256 = hashProjectKingsInstagramDiscoveryEvidence({
    schemaVersion: PROJECT_KINGS_INSTAGRAM_DISCOVERY_SCHEMA,
    profileKeys,
    donorPolicy: Object.fromEntries(profileKeys.map((key) => [
      key,
      PROJECT_KINGS_INSTAGRAM_DONOR_POLICY[key]
    ])),
    knownCanonicalUrls: sortedKnownCanonicalUrls,
    limits
  });
  const seenCanonicalUrls = new Set<string>();
  const seenShortcodes = new Set<string>();
  const profiles: ProjectKingsInstagramProfileDiscovery[] = [];

  // Intentionally sequential: public-web sessions are isolated per profile and
  // no profile can create concurrent Instagram requests.
  for (const profileKey of profileKeys) {
    const donorPolicy = PROJECT_KINGS_INSTAGRAM_DONOR_POLICY[profileKey];
    const profileRequestEvidence: ProjectKingsInstagramRequestEvidence[] = [];
    const profileIssues: ProjectKingsInstagramDiscoveryIssue[] = [];
    const donors: ProjectKingsInstagramDonorDiscovery[] = [];
    const cookieJar = new EphemeralInstagramCookieJar();
    try {
      const bootstrap = await requestInstagram({
        fetchImpl,
        sleep,
        url: new URL("/", INSTAGRAM_ORIGIN),
        init: { method: "GET", headers: requestHeaders({}) },
        endpoint: "session_bootstrap",
        donorUsername: null,
        pageNumber: null,
        timeoutMs,
        maxAttempts,
        maxResponseBytes
      });
      profileRequestEvidence.push(bootstrap.evidence);
      cookieJar.absorb(bootstrap.responseHeaders);
      if (!cookieJar.ready()) {
        profileIssues.push(createIssue({
          profileKey,
          donorUsername: null,
          endpoint: "session_bootstrap",
          code: "instagram_session_bootstrap_failed",
          classification: "authentication_required",
          retryable: false,
          httpStatus: bootstrap.evidence.httpStatus,
          attempts: bootstrap.evidence.attempts,
          detail: "Instagram public-web session did not provide required ephemeral cookies."
        }));
      }
    } catch (error) {
      const failure = error instanceof InstagramRequestFailure
        ? error
        : new InstagramRequestFailure({
          endpoint: "session_bootstrap",
          code: "instagram_session_bootstrap_failed",
          classification: "authentication_required",
          retryable: false,
          httpStatus: null,
          attempts: 1,
          detail: "Instagram public-web session could not be initialized."
        });
      profileIssues.push(issueFromFailure(failure, profileKey, null));
    }

    if (cookieJar.ready()) {
      for (const donorUsername of donorPolicy) {
        donors.push(await discoverDonor({
          profileKey,
          donorUsername,
          cookieJar,
          fetchImpl,
          sleep,
          pagesPerDonor,
          itemsPerDonor,
          pageSize,
          timeoutMs,
          maxAttempts,
          maxResponseBytes,
          knownCanonicalUrls,
          seenCanonicalUrls,
          seenShortcodes
        }));
      }
    }
    const allIssues = [...profileIssues, ...donors.flatMap((donor) => donor.issues)];
    profiles.push(withEvidenceSha256({
      profileKey,
      donorPolicy,
      status: statusFromIssues(
        allIssues,
        profileRequestEvidence.length > 0 || donors.some((donor) => donor.requestEvidence.length > 0)
      ) as "complete" | "partial" | "failed",
      donors,
      requestEvidence: profileRequestEvidence,
      issues: profileIssues
    }));
  }

  const donors = profiles.flatMap((profile) => profile.donors);
  const allExclusions = donors.flatMap((donor) => donor.exclusions);
  const allIssues = profiles.flatMap((profile) => [
    ...profile.issues,
    ...profile.donors.flatMap((donor) => donor.issues)
  ]);
  const packetPayload = {
    schemaVersion: PROJECT_KINGS_INSTAGRAM_DISCOVERY_SCHEMA,
    capturedAt: new Date(capturedAt).toISOString(),
    provider: "instagram_public_web" as const,
    requestSha256,
    knownCanonicalUrlsSha256: hashProjectKingsInstagramDiscoveryEvidence(sortedKnownCanonicalUrls),
    knownCanonicalUrlCount: sortedKnownCanonicalUrls.length,
    limits,
    profiles,
    summary: {
      profileCount: profiles.length,
      donorCount: donors.length,
      candidateCount: donors.reduce((sum, donor) => sum + donor.candidates.length, 0),
      excludedKnownCount: allExclusions.filter((entry) => entry.reason === "known_canonical_url").length,
      duplicateCount: allExclusions.filter((entry) => entry.reason === "duplicate").length,
      issueCount: allIssues.length,
      complete: profiles.every((profile) => profile.status === "complete")
    }
  };
  return withEvidenceSha256(packetPayload);
}

function verifyHashBoundObject(value: UnknownRecord, label: string): void {
  const evidenceSha256 = value.evidenceSha256;
  if (typeof evidenceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(evidenceSha256)) {
    throw new ProjectKingsInstagramDiscoveryError(`${label} has no valid evidence hash.`);
  }
  const { evidenceSha256: ignored, ...payload } = value;
  void ignored;
  if (hashProjectKingsInstagramDiscoveryEvidence(payload) !== evidenceSha256) {
    throw new ProjectKingsInstagramDiscoveryError(`${label} evidence hash mismatch.`);
  }
}

export function verifyProjectKingsInstagramDiscoveryPacket(
  packet: ProjectKingsInstagramDiscoveryPacket
): void {
  if (packet.schemaVersion !== PROJECT_KINGS_INSTAGRAM_DISCOVERY_SCHEMA) {
    throw new ProjectKingsInstagramDiscoveryError("Unsupported Instagram discovery packet schema.");
  }
  for (const [profileIndex, profile] of packet.profiles.entries()) {
    if (
      !Object.hasOwn(PROJECT_KINGS_INSTAGRAM_DONOR_POLICY, profile.profileKey) ||
      stableProjectKingsInstagramDiscoveryJson(profile.donorPolicy) !==
        stableProjectKingsInstagramDiscoveryJson(PROJECT_KINGS_INSTAGRAM_DONOR_POLICY[profile.profileKey])
    ) {
      throw new ProjectKingsInstagramDiscoveryError("Discovery profile does not match frozen donor policy.");
    }
    verifyHashBoundObject(profile as unknown as UnknownRecord, `profiles[${profileIndex}]`);
    for (const [requestIndex, request] of profile.requestEvidence.entries()) {
      verifyHashBoundObject(
        request as unknown as UnknownRecord,
        `profiles[${profileIndex}].requestEvidence[${requestIndex}]`
      );
    }
    for (const [issueIndex, issue] of profile.issues.entries()) {
      verifyHashBoundObject(
        issue as unknown as UnknownRecord,
        `profiles[${profileIndex}].issues[${issueIndex}]`
      );
    }
    for (const [donorIndex, donor] of profile.donors.entries()) {
      if (
        !profile.donorPolicy.includes(donor.donorUsername) ||
        donor.status !== statusFromIssues(donor.issues, donor.requestEvidence.length > 0)
      ) {
        throw new ProjectKingsInstagramDiscoveryError("Discovery donor metadata is inconsistent.");
      }
      verifyHashBoundObject(
        donor as unknown as UnknownRecord,
        `profiles[${profileIndex}].donors[${donorIndex}]`
      );
      const clipsPageHashes = new Set(
        donor.requestEvidence
          .filter((request) => request.endpoint === "clips_page")
          .map((request) => request.responseSha256)
      );
      for (const [candidateIndex, candidate] of donor.candidates.entries()) {
        if (
          candidate.discoveryState !== "discovery_only" ||
          candidate.semanticDecision !== null ||
          candidate.automaticQualification !== false ||
          candidate.profileKey !== profile.profileKey ||
          candidate.donorUsername !== donor.donorUsername ||
          candidate.donorUserId !== donor.donorUserId ||
          canonicalizeInstagramReelUrl(candidate.canonicalUrl) !== candidate.canonicalUrl ||
          candidate.canonicalUrl !== `${INSTAGRAM_ORIGIN}/reel/${candidate.shortcode}/` ||
          !clipsPageHashes.has(candidate.pageResponseSha256)
        ) {
          throw new ProjectKingsInstagramDiscoveryError(
            "Discovery candidate is not bound to its donor and clips-page evidence."
          );
        }
        verifyHashBoundObject(
          candidate as unknown as UnknownRecord,
          `profiles[${profileIndex}].donors[${donorIndex}].candidates[${candidateIndex}]`
        );
      }
      for (const [exclusionIndex, exclusion] of donor.exclusions.entries()) {
        if (
          exclusion.profileKey !== profile.profileKey ||
          exclusion.donorUsername !== donor.donorUsername ||
          canonicalizeInstagramReelUrl(exclusion.canonicalUrl) !== exclusion.canonicalUrl ||
          exclusion.canonicalUrl !== `${INSTAGRAM_ORIGIN}/reel/${exclusion.shortcode}/` ||
          !clipsPageHashes.has(exclusion.pageResponseSha256)
        ) {
          throw new ProjectKingsInstagramDiscoveryError(
            "Discovery exclusion is not bound to its donor and clips-page evidence."
          );
        }
        verifyHashBoundObject(
          exclusion as unknown as UnknownRecord,
          `profiles[${profileIndex}].donors[${donorIndex}].exclusions[${exclusionIndex}]`
        );
      }
      for (const [requestIndex, request] of donor.requestEvidence.entries()) {
        verifyHashBoundObject(
          request as unknown as UnknownRecord,
          `profiles[${profileIndex}].donors[${donorIndex}].requestEvidence[${requestIndex}]`
        );
      }
      for (const [issueIndex, issue] of donor.issues.entries()) {
        verifyHashBoundObject(
          issue as unknown as UnknownRecord,
          `profiles[${profileIndex}].donors[${donorIndex}].issues[${issueIndex}]`
        );
      }
    }
    const profileIssues = [
      ...profile.issues,
      ...profile.donors.flatMap((donor) => donor.issues)
    ];
    const expectedProfileStatus = statusFromIssues(
      profileIssues,
      profile.requestEvidence.length > 0 ||
        profile.donors.some((donor) => donor.requestEvidence.length > 0)
    );
    if (profile.status !== expectedProfileStatus) {
      throw new ProjectKingsInstagramDiscoveryError("Discovery profile status is inconsistent.");
    }
  }
  const donors = packet.profiles.flatMap((profile) => profile.donors);
  const exclusions = donors.flatMap((donor) => donor.exclusions);
  const issues = packet.profiles.flatMap((profile) => [
    ...profile.issues,
    ...profile.donors.flatMap((donor) => donor.issues)
  ]);
  const expectedSummary = {
    profileCount: packet.profiles.length,
    donorCount: donors.length,
    candidateCount: donors.reduce((sum, donor) => sum + donor.candidates.length, 0),
    excludedKnownCount: exclusions.filter((entry) => entry.reason === "known_canonical_url").length,
    duplicateCount: exclusions.filter((entry) => entry.reason === "duplicate").length,
    issueCount: issues.length,
    complete: packet.profiles.every((profile) => profile.status === "complete")
  };
  if (
    stableProjectKingsInstagramDiscoveryJson(packet.summary) !==
    stableProjectKingsInstagramDiscoveryJson(expectedSummary)
  ) {
    throw new ProjectKingsInstagramDiscoveryError("Discovery packet summary is inconsistent.");
  }
  verifyHashBoundObject(packet as unknown as UnknownRecord, "packet");
}
