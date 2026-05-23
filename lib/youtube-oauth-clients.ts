export type YouTubeOAuthClientConfig = {
  key: string;
  label: string;
  clientId: string;
  clientSecret: string;
  projectNumber: string | null;
  dailyUploadBudget: number | null;
};

export type PublicYouTubeOAuthClient = Omit<YouTubeOAuthClientConfig, "clientId" | "clientSecret"> & {
  isDefault: boolean;
  configured: boolean;
};

const LEGACY_CLIENT_KEY = "default";
const LEGACY_CLIENT_LABEL = "Default Google project";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function normalizeClientKey(value: unknown, index: number): string {
  const key = readString(value) || (index === 0 ? LEGACY_CLIENT_KEY : "");
  if (!key) {
    throw new Error(`YOUTUBE_OAUTH_CLIENTS_JSON[${index}].key is required.`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    throw new Error(`YOUTUBE_OAUTH_CLIENTS_JSON[${index}].key may only contain letters, numbers, "_" and "-".`);
  }
  return key;
}

function normalizeConfiguredClient(raw: unknown, index: number): YouTubeOAuthClientConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`YOUTUBE_OAUTH_CLIENTS_JSON[${index}] must be an object.`);
  }
  const record = raw as Record<string, unknown>;
  const key = normalizeClientKey(record.key ?? record.id, index);
  const clientId = readString(record.clientId ?? record.client_id);
  const clientSecret = readString(record.clientSecret ?? record.client_secret);
  if (!clientId || !clientSecret) {
    throw new Error(`YOUTUBE_OAUTH_CLIENTS_JSON[${index}] must include clientId and clientSecret.`);
  }
  return {
    key,
    label: readString(record.label ?? record.name) || key,
    clientId,
    clientSecret,
    projectNumber: readString(record.projectNumber ?? record.project_number) || null,
    dailyUploadBudget: readNumber(record.dailyUploadBudget ?? record.daily_upload_budget)
  };
}

function readLegacyClient(): YouTubeOAuthClientConfig | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    return null;
  }
  return {
    key: LEGACY_CLIENT_KEY,
    label: process.env.GOOGLE_OAUTH_CLIENT_LABEL?.trim() || LEGACY_CLIENT_LABEL,
    clientId,
    clientSecret,
    projectNumber: process.env.GOOGLE_OAUTH_PROJECT_NUMBER?.trim() || null,
    dailyUploadBudget: readNumber(process.env.GOOGLE_OAUTH_DAILY_UPLOAD_BUDGET)
  };
}

export function listYouTubeOAuthClients(): YouTubeOAuthClientConfig[] {
  const configured = process.env.YOUTUBE_OAUTH_CLIENTS_JSON?.trim() ?? "";
  if (configured) {
    const parsed = JSON.parse(configured) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("YOUTUBE_OAUTH_CLIENTS_JSON must be a JSON array.");
    }
    const clients = parsed.map(normalizeConfiguredClient);
    const keys = new Set<string>();
    for (const client of clients) {
      if (keys.has(client.key)) {
        throw new Error(`YOUTUBE_OAUTH_CLIENTS_JSON contains duplicate key "${client.key}".`);
      }
      keys.add(client.key);
    }
    return clients;
  }

  const legacy = readLegacyClient();
  return legacy ? [legacy] : [];
}

export function getDefaultYouTubeOAuthClientKey(): string {
  const clients = listYouTubeOAuthClients();
  const requested = process.env.YOUTUBE_OAUTH_DEFAULT_CLIENT_KEY?.trim() ?? "";
  if (requested) {
    if (!clients.some((client) => client.key === requested)) {
      throw new Error(`YOUTUBE_OAUTH_DEFAULT_CLIENT_KEY "${requested}" is not configured.`);
    }
    return requested;
  }
  return clients[0]?.key ?? LEGACY_CLIENT_KEY;
}

export function resolveYouTubeOAuthClient(key?: string | null): YouTubeOAuthClientConfig {
  const clients = listYouTubeOAuthClients();
  if (clients.length === 0) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET or YOUTUBE_OAUTH_CLIENTS_JSON must be configured for YouTube publishing."
    );
  }
  const resolvedKey = key?.trim() || getDefaultYouTubeOAuthClientKey();
  const client = clients.find((candidate) => candidate.key === resolvedKey);
  if (!client) {
    throw new Error(`YouTube OAuth project "${resolvedKey}" is not configured.`);
  }
  return client;
}

export function listPublicYouTubeOAuthClients(): PublicYouTubeOAuthClient[] {
  const defaultKey = getDefaultYouTubeOAuthClientKey();
  return listYouTubeOAuthClients().map((client) => ({
    key: client.key,
    label: client.label,
    projectNumber: client.projectNumber,
    dailyUploadBudget: client.dailyUploadBudget,
    isDefault: client.key === defaultKey,
    configured: true
  }));
}

export function resolvePublicYouTubeOAuthClientMetadata(key?: string | null): PublicYouTubeOAuthClient {
  const requestedKey = key?.trim() || getDefaultYouTubeOAuthClientKey();
  const client = listPublicYouTubeOAuthClients().find((candidate) => candidate.key === requestedKey);
  if (client) {
    return client;
  }
  return {
    key: requestedKey,
    label: `${requestedKey} (not configured)`,
    projectNumber: null,
    dailyUploadBudget: null,
    isDefault: false,
    configured: false
  };
}
