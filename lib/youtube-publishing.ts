import { promises as fs } from "node:fs";
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

export async function uploadYouTubeVideo(input: {
  accessToken: string;
  filePath: string;
  mimeType: string;
  title: string;
  description: string;
  tags: string[];
  notifySubscribers: boolean;
  publishAt: string;
}): Promise<{
  videoId: string;
  videoUrl: string;
}> {
  const bytes = await fs.readFile(input.filePath);
  const startResponse = await runWithRetry(async () => {
    const response = await fetch(
      `${YOUTUBE_UPLOAD_BASE_URL}?uploadType=resumable&part=snippet,status&notifySubscribers=${input.notifySubscribers ? "true" : "false"}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(bytes.byteLength),
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

  const sessionUrl = startResponse.headers.get("location");
  if (!sessionUrl) {
    throw new YouTubePublishError("YouTube не вернул upload session URL.", {
      recoverable: false
    });
  }

  const uploadPayload = await runWithRetry(async () => {
    const response = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": input.mimeType
      },
      body: bytes
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = extractGoogleApiErrorMessage(payload) ?? `Не удалось загрузить видео в YouTube (${response.status}).`;
      throw new YouTubePublishError(message, {
        recoverable: response.status >= 500 || response.status === 429,
        reauthRequired: response.status === 401 || response.status === 403
      });
    }
    return payload;
  });

  const videoId = typeof uploadPayload?.id === "string" ? uploadPayload.id.trim() : "";
  if (!videoId) {
    throw new YouTubePublishError("YouTube upload завершился без video id.", {
      recoverable: false
    });
  }
  return {
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  };
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
