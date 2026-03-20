import type { CommentsPayload } from "../app/components/types";
import { sortCommentsByPopularity, type CommentItem } from "./comments";
import { normalizeSupportedUrl } from "./ytdlp";

const YOUTUBE_DATA_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const DEFAULT_YOUTUBE_COMMENTS_CAP = 300;
const YOUTUBE_COMMENTS_PAGE_SIZE = 100;
const DEFAULT_YOUTUBE_COMMENTS_CACHE_TTL_MS = 10 * 60 * 1000;

type YouTubeCommentsCacheEntry = {
  expiresAt: number;
  payload: CommentsPayload;
};

type YouTubeCommentsGlobal = typeof globalThis & {
  __clipsYoutubeCommentsCache__?: Map<string, YouTubeCommentsCacheEntry>;
};

type YouTubeApiErrorBody = {
  error?: {
    code?: unknown;
    message?: unknown;
    status?: unknown;
    errors?: Array<{
      reason?: unknown;
      message?: unknown;
      domain?: unknown;
    }> | null;
  } | null;
  items?: unknown;
};

type YouTubeCommentThreadItem = {
  id?: unknown;
  snippet?: {
    topLevelComment?: {
      id?: unknown;
      snippet?: {
        authorDisplayName?: unknown;
        textDisplay?: unknown;
        textOriginal?: unknown;
        likeCount?: unknown;
        publishedAt?: unknown;
      } | null;
    } | null;
  } | null;
};

export type YouTubeCommentsApiErrorCode =
  | "config_missing"
  | "comments_disabled"
  | "video_unavailable"
  | "quota_exceeded"
  | "api_auth_invalid"
  | "temporary_failure";

export class YouTubeCommentsApiError extends Error {
  readonly code: YouTubeCommentsApiErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(input: {
    code: YouTubeCommentsApiErrorCode;
    message: string;
    retryable: boolean;
    status?: number | null;
  }) {
    super(input.message);
    this.name = "YouTubeCommentsApiError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status ?? null;
  }
}

function getYouTubeCommentsCache(): Map<string, YouTubeCommentsCacheEntry> {
  const scope = globalThis as YouTubeCommentsGlobal;
  if (!scope.__clipsYoutubeCommentsCache__) {
    scope.__clipsYoutubeCommentsCache__ = new Map<string, YouTubeCommentsCacheEntry>();
  }
  return scope.__clipsYoutubeCommentsCache__;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNonNegativeInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return 0;
}

function clampCommentsCap(value: number | null | undefined): number {
  const numeric = Number.isFinite(value) ? Number(value) : DEFAULT_YOUTUBE_COMMENTS_CAP;
  return Math.max(1, Math.min(DEFAULT_YOUTUBE_COMMENTS_CAP, Math.floor(numeric)));
}

function normalizePostedAt(value: unknown): { timestamp: number | null; postedAt: string | null } {
  const postedAt = asTrimmedString(value);
  if (!postedAt) {
    return { timestamp: null, postedAt: null };
  }
  const timestamp = Date.parse(postedAt);
  return {
    timestamp: Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null,
    postedAt
  };
}

function sliceCommentsPayload(payload: CommentsPayload, maxComments: number): CommentsPayload {
  const limitedComments = payload.allComments.slice(0, maxComments);
  return {
    title: payload.title,
    totalComments: limitedComments.length,
    topComments: limitedComments.slice(0, 10),
    allComments: limitedComments
  };
}

function readCachedYouTubeComments(videoId: string, maxComments: number, nowMs: number): CommentsPayload | null {
  const cache = getYouTubeCommentsCache();
  const entry = cache.get(videoId);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= nowMs) {
    cache.delete(videoId);
    return null;
  }
  return sliceCommentsPayload(entry.payload, maxComments);
}

function writeCachedYouTubeComments(
  videoId: string,
  payload: CommentsPayload,
  nowMs: number,
  ttlMs: number
): void {
  getYouTubeCommentsCache().set(videoId, {
    payload,
    expiresAt: nowMs + Math.max(1_000, ttlMs)
  });
}

function getYouTubeDataApiKey(inputKey?: string | null): string | null {
  const raw = inputKey ?? process.env.YOUTUBE_DATA_API_KEY ?? null;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

async function readResponseJson(response: Response): Promise<YouTubeApiErrorBody | null> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as YouTubeApiErrorBody;
  } catch {
    return null;
  }
}

function extractYouTubeApiReason(body: YouTubeApiErrorBody | null): string {
  const reasons = body?.error?.errors;
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return "";
  }
  return asTrimmedString(reasons[0]?.reason)?.toLowerCase() ?? "";
}

function extractYouTubeApiMessage(body: YouTubeApiErrorBody | null): string {
  return (
    asTrimmedString(body?.error?.message) ??
    asTrimmedString(body?.error?.errors?.[0]?.message) ??
    ""
  );
}

export function extractYouTubeVideoIdFromUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(normalizeSupportedUrl(rawUrl));
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    }
    if (hostname.includes("youtube.com")) {
      if (parsed.pathname === "/watch") {
        return asTrimmedString(parsed.searchParams.get("v"));
      }
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/").filter(Boolean)[1] ?? null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function mapYouTubeDataApiError(
  status: number,
  body: unknown
): YouTubeCommentsApiError {
  const parsed = body && typeof body === "object" ? (body as YouTubeApiErrorBody) : null;
  const reason = extractYouTubeApiReason(parsed);
  const message = extractYouTubeApiMessage(parsed);
  const lowerMessage = message.toLowerCase();

  if (reason === "commentsdisabled" || lowerMessage.includes("comments disabled")) {
    return new YouTubeCommentsApiError({
      code: "comments_disabled",
      message: "Комментарии отключены для этого YouTube-видео.",
      retryable: false,
      status
    });
  }

  if (
    reason === "videonotfound" ||
    reason === "notfound" ||
    lowerMessage.includes("video not found") ||
    lowerMessage.includes("video unavailable") ||
    status === 404
  ) {
    return new YouTubeCommentsApiError({
      code: "video_unavailable",
      message: "YouTube-видео недоступно или не найдено.",
      retryable: false,
      status
    });
  }

  if (
    reason === "quotaexceeded" ||
    reason === "dailylimitexceeded" ||
    reason === "dailylimitexceededunreg" ||
    reason === "ratelimitexceeded" ||
    reason === "userratelimitexceeded"
  ) {
    return new YouTubeCommentsApiError({
      code: "quota_exceeded",
      message: "Превышена квота YouTube Data API на этом сервере.",
      retryable: true,
      status
    });
  }

  if (
    reason === "keyinvalid" ||
    reason === "accessnotconfigured" ||
    reason === "iprefererblocked" ||
    reason === "forbidden" ||
    status === 401
  ) {
    return new YouTubeCommentsApiError({
      code: "api_auth_invalid",
      message:
        "YouTube Data API отклонил серверный ключ. Проверьте YOUTUBE_DATA_API_KEY и включение YouTube Data API v3.",
      retryable: true,
      status
    });
  }

  if (status >= 500 || reason === "backenderror") {
    return new YouTubeCommentsApiError({
      code: "temporary_failure",
      message: "YouTube Data API временно недоступен. Попробуйте снова позже.",
      retryable: true,
      status
    });
  }

  return new YouTubeCommentsApiError({
    code: "temporary_failure",
    message:
      message || `YouTube Data API вернул HTTP ${status} и не смог отдать комментарии для этого видео.`,
    retryable: true,
    status
  });
}

export function shouldFallbackFromYouTubeCommentsError(error: unknown): boolean {
  if (!(error instanceof YouTubeCommentsApiError)) {
    return true;
  }
  return error.code !== "comments_disabled" && error.code !== "video_unavailable";
}

export function normalizeYouTubeApiCommentThreads(items: unknown): CommentItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: CommentItem[] = [];

  for (const entry of items as YouTubeCommentThreadItem[]) {
    const thread = entry && typeof entry === "object" ? entry : null;
    const comment = thread?.snippet?.topLevelComment?.snippet ?? null;
    if (!comment) {
      continue;
    }

    const text =
      asTrimmedString(comment.textOriginal) ??
      asTrimmedString(comment.textDisplay) ??
      null;
    if (!text) {
      continue;
    }

    const id =
      asTrimmedString(thread?.snippet?.topLevelComment?.id) ??
      asTrimmedString(thread?.id) ??
      null;
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);

    const { timestamp, postedAt } = normalizePostedAt(comment.publishedAt);
    normalized.push({
      id,
      author: asTrimmedString(comment.authorDisplayName) ?? "Unknown",
      text,
      likes: asNonNegativeInteger(comment.likeCount),
      timestamp,
      postedAt
    });
  }

  return normalized;
}

async function fetchYouTubeVideoTitle(input: {
  videoId: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<string | null> {
  const endpoint = new URL(`${YOUTUBE_DATA_API_BASE_URL}/videos`);
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("id", input.videoId);
  endpoint.searchParams.set("fields", "items(id,snippet(title))");
  endpoint.searchParams.set("key", input.apiKey);

  try {
    const response = await input.fetchImpl(endpoint.toString(), {
      method: "GET",
      cache: "no-store"
    });
    const body = await readResponseJson(response);
    if (!response.ok) {
      return null;
    }
    const item = Array.isArray(body?.items) ? body.items[0] : null;
    const snippet = item && typeof item === "object" ? (item as { snippet?: { title?: unknown } }).snippet : null;
    return asTrimmedString(snippet?.title);
  } catch {
    return null;
  }
}

export async function fetchYouTubeCommentsPayload(input: {
  rawUrl: string;
  maxComments?: number;
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
  cacheTtlMs?: number;
  nowMs?: () => number;
}): Promise<CommentsPayload> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxComments = clampCommentsCap(input.maxComments);
  const videoId = extractYouTubeVideoIdFromUrl(input.rawUrl);
  if (!videoId) {
    throw new YouTubeCommentsApiError({
      code: "video_unavailable",
      message: "Не удалось определить YouTube videoId из этой ссылки.",
      retryable: false
    });
  }

  const apiKey = getYouTubeDataApiKey(input.apiKey);
  if (!apiKey) {
    throw new YouTubeCommentsApiError({
      code: "config_missing",
      message:
        "YOUTUBE_DATA_API_KEY не задан на сервере. Добавьте серверный ключ YouTube Data API v3 для стабильного comments fetch.",
      retryable: true
    });
  }

  const nowMs = input.nowMs?.() ?? Date.now();
  const cached = readCachedYouTubeComments(videoId, maxComments, nowMs);
  if (cached) {
    return cached;
  }

  const comments: CommentItem[] = [];
  let pageToken: string | null = null;

  while (comments.length < maxComments) {
    const endpoint = new URL(`${YOUTUBE_DATA_API_BASE_URL}/commentThreads`);
    endpoint.searchParams.set("part", "snippet");
    endpoint.searchParams.set("videoId", videoId);
    endpoint.searchParams.set("maxResults", String(Math.min(YOUTUBE_COMMENTS_PAGE_SIZE, maxComments - comments.length)));
    endpoint.searchParams.set("order", "relevance");
    endpoint.searchParams.set("textFormat", "plainText");
    endpoint.searchParams.set(
      "fields",
      "nextPageToken,items(id,snippet(topLevelComment(id,snippet(authorDisplayName,textDisplay,textOriginal,likeCount,publishedAt))))"
    );
    endpoint.searchParams.set("key", apiKey);
    if (pageToken) {
      endpoint.searchParams.set("pageToken", pageToken);
    }

    let response: Response;
    try {
      response = await fetchImpl(endpoint.toString(), {
        method: "GET",
        cache: "no-store"
      });
    } catch {
      throw new YouTubeCommentsApiError({
        code: "temporary_failure",
        message: "Не удалось связаться с YouTube Data API при получении комментариев.",
        retryable: true
      });
    }

    const body = await readResponseJson(response);
    if (!response.ok) {
      throw mapYouTubeDataApiError(response.status, body);
    }

    comments.push(...normalizeYouTubeApiCommentThreads(body?.items));
    pageToken = asTrimmedString((body as { nextPageToken?: unknown } | null)?.nextPageToken);
    if (!pageToken) {
      break;
    }
  }

  const sortedComments = sortCommentsByPopularity(comments).slice(0, maxComments);
  const title = await fetchYouTubeVideoTitle({
    videoId,
    apiKey,
    fetchImpl
  });

  if (!title && sortedComments.length === 0) {
    throw new YouTubeCommentsApiError({
      code: "video_unavailable",
      message: "YouTube-видео недоступно или не найдено.",
      retryable: false
    });
  }

  const payload: CommentsPayload = {
    title: title ?? "video",
    totalComments: sortedComments.length,
    topComments: sortedComments.slice(0, 10),
    allComments: sortedComments
  };

  writeCachedYouTubeComments(
    videoId,
    payload,
    nowMs,
    input.cacheTtlMs ?? DEFAULT_YOUTUBE_COMMENTS_CACHE_TTL_MS
  );

  return payload;
}
