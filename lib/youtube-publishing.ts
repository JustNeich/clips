import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { assertAppEncryptionReady } from "./app-crypto";
import { resolvePublicAppOrigin } from "./public-app-origin";
import type { ChannelPublishIntegrationOption } from "../app/components/types";
import type { StoredYoutubeCredential } from "./publication-store";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_UPLOAD_BASE_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

export const YOUTUBE_PUBLISH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "openid",
  "email"
] as const;

export class YouTubePublishError extends Error {
  readonly recoverable: boolean;
  readonly reauthRequired: boolean;

  constructor(message: string, options?: { recoverable?: boolean; reauthRequired?: boolean }) {
    super(message);
    this.name = "YouTubePublishError";
    this.recoverable = options?.recoverable ?? true;
    this.reauthRequired = options?.reauthRequired ?? false;
  }
}

type YouTubeTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function requireGoogleOAuthConfig(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID и GOOGLE_OAUTH_CLIENT_SECRET должны быть настроены на сервере.");
  }
  return { clientId, clientSecret };
}

export function assertYouTubePublishingConnectReady(): void {
  requireGoogleOAuthConfig();
  assertAppEncryptionReady();
}

function buildRedirectUri(request: Request): string {
  return `${resolvePublicAppOrigin(request)}/api/integrations/youtube/callback`;
}

function normalizeScopes(scopes: string[] | null | undefined): string[] {
  return Array.from(new Set((scopes ?? []).map((item) => item.trim()).filter(Boolean)));
}

function extractGoogleApiErrorMessage(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) {
    return null;
  }
  const error = payload.error;
  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
      return errorRecord.message.trim();
    }
  }
  if (typeof payload.error_description === "string" && payload.error_description.trim()) {
    return payload.error_description.trim();
  }
  return null;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

async function runWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) {
        throw error;
      }
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 750 * (attempt + 1));
        timeout.unref?.();
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unknown YouTube API failure.");
}

async function fetchGoogleToken(body: URLSearchParams): Promise<YouTubeTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await parseJsonResponse<YouTubeTokenResponse>(response);
  if (!response.ok || payload.error) {
    const description = payload.error_description || payload.error || "Google token exchange failed.";
    throw new YouTubePublishError(description, {
      recoverable: response.status >= 500 || response.status === 429,
      reauthRequired: payload.error === "invalid_grant"
    });
  }
  return payload;
}

async function fetchGoogleUserinfo(accessToken: string): Promise<{ email: string | null }> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    return { email: null };
  }
  const payload = (await response.json().catch(() => null)) as { email?: string } | null;
  return {
    email: typeof payload?.email === "string" && payload.email.trim() ? payload.email.trim() : null
  };
}

async function youtubeApiJson<T>(input: {
  accessToken: string;
  url: string;
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
}): Promise<T> {
  const response = await fetch(input.url, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
      ...input.headers
    },
    body: input.body ?? undefined
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = extractGoogleApiErrorMessage(payload) ?? `YouTube API request failed with status ${response.status}.`;
    throw new YouTubePublishError(message, {
      recoverable: response.status >= 500 || response.status === 429,
      reauthRequired: response.status === 401 || response.status === 403
    });
  }
  return (payload ?? {}) as T;
}

export function buildYouTubeOAuthUrl(request: Request, state: string): string {
  assertYouTubePublishingConnectReady();
  const { clientId } = requireGoogleOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: buildRedirectUri(request),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: YOUTUBE_PUBLISH_SCOPES.join(" "),
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeYouTubeOAuthCode(input: {
  request: Request;
  code: string;
}): Promise<{
  credential: StoredYoutubeCredential;
  googleAccountEmail: string | null;
  availableChannels: ChannelPublishIntegrationOption[];
}> {
  assertYouTubePublishingConnectReady();
  const { clientId, clientSecret } = requireGoogleOAuthConfig();
  const payload = await fetchGoogleToken(
    new URLSearchParams({
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: buildRedirectUri(input.request),
      grant_type: "authorization_code"
    })
  );

  if (!payload.access_token) {
    throw new YouTubePublishError("Google OAuth не вернул access token.", {
      recoverable: false
    });
  }
  const scopes = normalizeScopes((payload.scope ?? "").split(" "));
  const credential: StoredYoutubeCredential = {
    refreshToken: payload.refresh_token?.trim() || "",
    accessToken: payload.access_token,
    expiryDate:
      typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : null,
    tokenType: payload.token_type?.trim() || "Bearer",
    scopes
  };
  if (!credential.refreshToken) {
    throw new YouTubePublishError("Google OAuth не вернул refresh token. Повторите подключение с consent.", {
      recoverable: false,
      reauthRequired: true
    });
  }
  const [userinfo, availableChannels] = await Promise.all([
    fetchGoogleUserinfo(payload.access_token),
    listManagedYouTubeChannels(payload.access_token)
  ]);
  return {
    credential,
    googleAccountEmail: userinfo.email,
    availableChannels
  };
}

export async function refreshYouTubeAccessToken(credential: StoredYoutubeCredential): Promise<StoredYoutubeCredential> {
  if (!credential.refreshToken) {
    throw new YouTubePublishError("Отсутствует refresh token для YouTube OAuth.", {
      recoverable: false,
      reauthRequired: true
    });
  }
  const { clientId, clientSecret } = requireGoogleOAuthConfig();
  const payload = await fetchGoogleToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credential.refreshToken,
      grant_type: "refresh_token"
    })
  );
  if (!payload.access_token) {
    throw new YouTubePublishError("Не удалось обновить access token YouTube.", {
      recoverable: false,
      reauthRequired: true
    });
  }
  return {
    ...credential,
    accessToken: payload.access_token,
    expiryDate:
      typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : credential.expiryDate,
    tokenType: payload.token_type?.trim() || credential.tokenType,
    scopes: normalizeScopes((payload.scope ?? credential.scopes.join(" ")).split(" "))
  };
}

export function isYoutubeAccessTokenExpired(credential: StoredYoutubeCredential): boolean {
  if (!credential.accessToken || !credential.expiryDate) {
    return true;
  }
  return new Date(credential.expiryDate).getTime() <= Date.now() + 60_000;
}

export async function listManagedYouTubeChannels(
  accessToken: string
): Promise<ChannelPublishIntegrationOption[]> {
  const payload = await youtubeApiJson<{
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        customUrl?: string;
      };
    }>;
  }>({
    accessToken,
    url: `${YOUTUBE_API_BASE_URL}/channels?part=snippet&mine=true`
  });
  return (payload.items ?? [])
    .map((item) => {
      const id = item.id?.trim() ?? "";
      const title = item.snippet?.title?.trim() ?? "";
      if (!id || !title) {
        return null;
      }
      return {
        id,
        title,
        customUrl: item.snippet?.customUrl?.trim() || null
      };
    })
    .filter((item): item is ChannelPublishIntegrationOption => Boolean(item));
}

type UploadSessionStatus =
  | {
      state: "incomplete";
      nextByte: number;
    }
  | {
      state: "completed";
      videoId: string;
    };

function parseUploadRangeNextByte(rangeHeader: string | null): number {
  const match = rangeHeader?.match(/bytes=(\d+)-(\d+)/i);
  if (!match) {
    return 0;
  }
  const end = Number.parseInt(match[2] ?? "", 10);
  return Number.isFinite(end) ? end + 1 : 0;
}

function extractYouTubeVideoId(payload: Record<string, unknown> | null | undefined): string {
  return typeof payload?.id === "string" ? payload.id.trim() : "";
}

function shouldRetryUploadError(error: unknown): boolean {
  return !(error instanceof YouTubePublishError) || error.recoverable;
}

async function waitBeforeUploadRetry(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 750 * (attempt + 1));
    timeout.unref?.();
  });
}

function startUploadHeartbeat(onHeartbeat?: () => void | Promise<void>): () => void {
  if (!onHeartbeat) {
    return () => undefined;
  }
  const ping = () => {
    Promise.resolve(onHeartbeat()).catch(() => {
      // Heartbeat is a safety net; the upload request remains the source of truth.
    });
  };
  ping();
  const interval = setInterval(ping, 30_000);
  interval.unref?.();
  return () => clearInterval(interval);
}

async function openYouTubeUploadSession(input: {
  accessToken: string;
  fileSize: number;
  mimeType: string;
  title: string;
  description: string;
  tags: string[];
  notifySubscribers: boolean;
  publishAt: string;
}): Promise<string> {
  const startResponse = await runWithRetry(async () => {
    const response = await fetch(
      `${YOUTUBE_UPLOAD_BASE_URL}?uploadType=resumable&part=snippet,status&notifySubscribers=${input.notifySubscribers ? "true" : "false"}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(input.fileSize),
          "X-Upload-Content-Type": input.mimeType
        },
        body: JSON.stringify({
          snippet: {
            title: input.title,
            description: input.description,
            tags: input.tags
          },
          status: {
            privacyStatus: "private",
            publishAt: input.publishAt
          }
        })
      }
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const message =
        extractGoogleApiErrorMessage(payload) ??
        `Не удалось открыть YouTube resumable upload session (${response.status}).`;
      throw new YouTubePublishError(message, {
        recoverable: response.status >= 500 || response.status === 429,
        reauthRequired: response.status === 401 || response.status === 403
      });
    }
    return response;
  });

  const sessionUrl = startResponse.headers.get("location")?.trim() ?? "";
  if (!sessionUrl) {
    throw new YouTubePublishError("YouTube не вернул upload session URL.", {
      recoverable: false
    });
  }
  return sessionUrl;
}

async function inspectYouTubeUploadSession(input: {
  accessToken: string;
  sessionUrl: string;
  fileSize: number;
}): Promise<UploadSessionStatus> {
  const response = await fetch(input.sessionUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Length": "0",
      "Content-Range": `bytes */${input.fileSize}`
    }
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.status === 308) {
    return {
      state: "incomplete",
      nextByte: Math.min(input.fileSize, parseUploadRangeNextByte(response.headers.get("range")))
    };
  }
  if (response.ok) {
    const videoId = extractYouTubeVideoId(payload);
    if (videoId) {
      return {
        state: "completed",
        videoId
      };
    }
  }
  const message =
    extractGoogleApiErrorMessage(payload) ??
    `Не удалось проверить YouTube upload session (${response.status}).`;
  throw new YouTubePublishError(message, {
    recoverable: response.status >= 500 || response.status === 429,
    reauthRequired: response.status === 401 || response.status === 403
  });
}

async function uploadRemainingYouTubeBytes(input: {
  accessToken: string;
  sessionUrl: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  startByte: number;
}): Promise<UploadSessionStatus> {
  const startByte = Math.max(0, Math.min(input.fileSize, input.startByte));
  if (startByte >= input.fileSize) {
    return inspectYouTubeUploadSession(input);
  }

  const stream = Readable.toWeb(createReadStream(input.filePath, { start: startByte })) as ReadableStream<Uint8Array>;
  const response = await fetch(input.sessionUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Length": String(input.fileSize - startByte),
      "Content-Type": input.mimeType,
      "Content-Range": `bytes ${startByte}-${input.fileSize - 1}/${input.fileSize}`
    },
    body: stream,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.status === 308) {
    return {
      state: "incomplete",
      nextByte: Math.min(input.fileSize, parseUploadRangeNextByte(response.headers.get("range")))
    };
  }
  if (!response.ok) {
    const message =
      extractGoogleApiErrorMessage(payload) ??
      `Не удалось загрузить видео в YouTube (${response.status}).`;
    throw new YouTubePublishError(message, {
      recoverable: response.status >= 500 || response.status === 429,
      reauthRequired: response.status === 401 || response.status === 403
    });
  }

  const videoId = extractYouTubeVideoId(payload);
  if (!videoId) {
    throw new YouTubePublishError("YouTube upload завершился без video id.", {
      recoverable: false
    });
  }
  return {
    state: "completed",
    videoId
  };
}

async function uploadViaResumableSession(input: {
  accessToken: string;
  sessionUrl: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}): Promise<{ videoId: string }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const status = await inspectYouTubeUploadSession(input);
      if (status.state === "completed") {
        return {
          videoId: status.videoId
        };
      }
      const uploaded = await uploadRemainingYouTubeBytes({
        ...input,
        startByte: status.nextByte
      });
      if (uploaded.state === "completed") {
        return {
          videoId: uploaded.videoId
        };
      }
      lastError = new YouTubePublishError("YouTube upload session остался незавершённым.", {
        recoverable: true
      });
    } catch (error) {
      lastError = error;
      if (!shouldRetryUploadError(error) || attempt === 2) {
        throw error;
      }
    }
    await waitBeforeUploadRetry(attempt);
  }
  throw lastError instanceof Error ? lastError : new Error("Unknown YouTube upload failure.");
}

export async function uploadYouTubeVideo(input: {
  accessToken: string;
  filePath: string;
  mimeType: string;
  title: string;
  description: string;
  tags: string[];
  notifySubscribers: boolean;
  publishAt: string;
  sessionUrl?: string | null;
  onSessionUrl?: (sessionUrl: string) => void | Promise<void>;
  onHeartbeat?: () => void | Promise<void>;
}): Promise<{
  videoId: string;
  videoUrl: string;
}> {
  const fileStat = await fs.stat(input.filePath);
  if (fileStat.size <= 0) {
    throw new YouTubePublishError("Файл для публикации пустой.", {
      recoverable: false
    });
  }

  const stopHeartbeat = startUploadHeartbeat(input.onHeartbeat);
  try {
    let sessionUrl = input.sessionUrl?.trim() ?? "";
    if (!sessionUrl) {
      sessionUrl = await openYouTubeUploadSession({ ...input, fileSize: fileStat.size });
      await input.onSessionUrl?.(sessionUrl);
    }

    const result = await uploadViaResumableSession({
      accessToken: input.accessToken,
      filePath: input.filePath,
      fileSize: fileStat.size,
      mimeType: input.mimeType,
      sessionUrl
    });
    return {
      videoId: result.videoId,
      videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(result.videoId)}`
    };
  } finally {
    stopHeartbeat();
  }
}

export async function updateYouTubeScheduledVideo(input: {
  accessToken: string;
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  publishAt: string;
}): Promise<void> {
  await runWithRetry(async () => {
    await youtubeApiJson<Record<string, unknown>>({
      accessToken: input.accessToken,
      url: `${YOUTUBE_API_BASE_URL}/videos?part=snippet,status`,
      method: "PUT",
      body: JSON.stringify({
        id: input.videoId,
        snippet: {
          title: input.title,
          description: input.description,
          tags: input.tags
        },
        status: {
          privacyStatus: "private",
          publishAt: input.publishAt
        }
      })
    });
  });
}

export async function deleteYouTubeVideo(input: {
  accessToken: string;
  videoId: string;
}): Promise<void> {
  await runWithRetry(async () => {
    const response = await fetch(
      `${YOUTUBE_API_BASE_URL}/videos?id=${encodeURIComponent(input.videoId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${input.accessToken}`
        }
      }
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const message = extractGoogleApiErrorMessage(payload) ?? `Не удалось удалить видео из YouTube (${response.status}).`;
      throw new YouTubePublishError(message, {
        recoverable: response.status >= 500 || response.status === 429,
        reauthRequired: response.status === 401 || response.status === 403
      });
    }
  });
}
