import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { STAGE2_SYSTEM_PROMPT } from "./stage2";

export type ChatEventRole = "user" | "assistant" | "system";

export type ChatEventType =
  | "link"
  | "download"
  | "comments"
  | "stage2"
  | "error"
  | "note";

export type ChatEvent = {
  id: string;
  role: ChatEventRole;
  type: ChatEventType;
  text: string;
  data?: unknown;
  createdAt: string;
};

export type ChatThread = {
  id: string;
  channelId: string;
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  events: ChatEvent[];
};

export type ChannelAssetKind = "avatar" | "background" | "music";

export type ChannelAsset = {
  id: string;
  channelId: string;
  kind: ChannelAssetKind;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type Channel = {
  id: string;
  name: string;
  username: string;
  systemPrompt: string;
  examplesJson: string;
  templateId: string;
  avatarAssetId: string | null;
  defaultBackgroundAssetId: string | null;
  defaultMusicAssetId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChatStore = {
  version: 2;
  channels: Channel[];
  channelAssets: ChannelAsset[];
  threads: ChatThread[];
};

type LegacyStore = {
  threads?: unknown;
};

export const CHAT_STORE_VERSION = 2 as const;
export const DEFAULT_TEMPLATE_ID = "science-card-v1";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "chat-history.json");
const EXAMPLES_PATH = path.join(process.cwd(), "data", "examples.json");

let cachedDefaultExamples: string | null = null;

const allowedEventTypes = new Set<ChatEventType>([
  "link",
  "download",
  "comments",
  "stage2",
  "error",
  "note"
]);

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return randomUUID().replace(/-/g, "");
}

function normalizeUrl(raw: string): string {
  return raw.trim();
}

function sanitizeName(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function sanitizeTextBlock(value: string | null | undefined, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function sanitizeUsername(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_.-]/g, "");
  return normalized || "channel";
}

function safeJsonString(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return fallback;
  }
}

function ensureValidJsonString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("examplesJson не должен быть пустым.");
  }
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    throw new Error("examplesJson должен быть валидным JSON.");
  }
}

async function loadDefaultExamplesJson(): Promise<string> {
  if (cachedDefaultExamples) {
    return cachedDefaultExamples;
  }
  try {
    const raw = await fs.readFile(EXAMPLES_PATH, "utf-8");
    cachedDefaultExamples = raw;
    return raw;
  } catch {
    const fallback = "[]";
    cachedDefaultExamples = fallback;
    return fallback;
  }
}

async function buildDefaultChannel(now: string, id = newId()): Promise<Channel> {
  const examplesJson = await loadDefaultExamplesJson();
  return {
    id,
    name: "Default",
    username: "science_snack",
    systemPrompt: STAGE2_SYSTEM_PROMPT,
    examplesJson,
    templateId: DEFAULT_TEMPLATE_ID,
    avatarAssetId: null,
    defaultBackgroundAssetId: null,
    defaultMusicAssetId: null,
    createdAt: now,
    updatedAt: now
  };
}

function sanitizeEvent(value: unknown): ChatEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const event = value as Partial<ChatEvent>;
  if (
    typeof event.id !== "string" ||
    typeof event.role !== "string" ||
    typeof event.type !== "string" ||
    typeof event.text !== "string" ||
    typeof event.createdAt !== "string"
  ) {
    return null;
  }
  if (!allowedEventTypes.has(event.type as ChatEventType)) {
    return null;
  }
  const role = event.role as ChatEventRole;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return null;
  }

  return {
    id: event.id,
    role,
    type: event.type as ChatEventType,
    text: event.text,
    data: event.data,
    createdAt: event.createdAt
  };
}

function sanitizeThread(value: unknown): ChatThread | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const thread = value as Partial<ChatThread>;
  if (
    typeof thread.id !== "string" ||
    typeof thread.url !== "string" ||
    typeof thread.title !== "string" ||
    typeof thread.createdAt !== "string" ||
    typeof thread.updatedAt !== "string"
  ) {
    return null;
  }

  const events = Array.isArray(thread.events) ? thread.events.map(sanitizeEvent).filter(Boolean) : [];
  return {
    id: thread.id,
    channelId: typeof thread.channelId === "string" ? thread.channelId : "",
    url: thread.url,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    events: events as ChatEvent[]
  };
}

function sanitizeChannel(value: unknown): Channel | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const channel = value as Partial<Channel>;
  if (
    typeof channel.id !== "string" ||
    typeof channel.createdAt !== "string" ||
    typeof channel.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: channel.id,
    name: sanitizeName(channel.name, "Channel"),
    username: sanitizeUsername(channel.username),
    systemPrompt: sanitizeTextBlock(channel.systemPrompt, STAGE2_SYSTEM_PROMPT),
    examplesJson: typeof channel.examplesJson === "string" ? channel.examplesJson : "[]",
    templateId: sanitizeName(channel.templateId, DEFAULT_TEMPLATE_ID),
    avatarAssetId: typeof channel.avatarAssetId === "string" && channel.avatarAssetId.trim() ? channel.avatarAssetId : null,
    defaultBackgroundAssetId:
      typeof channel.defaultBackgroundAssetId === "string" && channel.defaultBackgroundAssetId.trim()
        ? channel.defaultBackgroundAssetId
        : null,
    defaultMusicAssetId:
      typeof channel.defaultMusicAssetId === "string" && channel.defaultMusicAssetId.trim()
        ? channel.defaultMusicAssetId
        : null,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt
  };
}

function sanitizeAsset(value: unknown): ChannelAsset | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const asset = value as Partial<ChannelAsset>;
  if (
    typeof asset.id !== "string" ||
    typeof asset.channelId !== "string" ||
    typeof asset.kind !== "string" ||
    typeof asset.fileName !== "string" ||
    typeof asset.originalName !== "string" ||
    typeof asset.mimeType !== "string" ||
    typeof asset.sizeBytes !== "number" ||
    typeof asset.createdAt !== "string"
  ) {
    return null;
  }
  if (asset.kind !== "avatar" && asset.kind !== "background" && asset.kind !== "music") {
    return null;
  }
  return {
    id: asset.id,
    channelId: asset.channelId,
    kind: asset.kind,
    fileName: asset.fileName,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt
  };
}

async function ensureStoreExists(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const now = nowIso();
    const defaultChannel = await buildDefaultChannel(now);
    const initial: ChatStore = {
      version: CHAT_STORE_VERSION,
      channels: [defaultChannel],
      channelAssets: [],
      threads: []
    };
    await fs.writeFile(STORE_PATH, JSON.stringify(initial, null, 2), "utf-8");
  }
}

async function normalizeStore(parsedUnknown: unknown): Promise<ChatStore> {
  const now = nowIso();
  const parsed = (parsedUnknown ?? {}) as Partial<ChatStore> & LegacyStore;

  const channels = Array.isArray(parsed.channels)
    ? parsed.channels.map(sanitizeChannel).filter((item): item is Channel => Boolean(item))
    : [];
  const channelAssets = Array.isArray(parsed.channelAssets)
    ? parsed.channelAssets.map(sanitizeAsset).filter((item): item is ChannelAsset => Boolean(item))
    : [];
  const threads = Array.isArray(parsed.threads)
    ? parsed.threads.map(sanitizeThread).filter((item): item is ChatThread => Boolean(item))
    : [];

  let nextChannels = channels;
  if (!nextChannels.length) {
    nextChannels = [await buildDefaultChannel(now)];
  }

  const validChannelIds = new Set(nextChannels.map((item) => item.id));
  const defaultChannelId = nextChannels[0].id;

  const nextAssets = channelAssets.filter((asset) => validChannelIds.has(asset.channelId));
  const validAssetIds = new Set(nextAssets.map((asset) => asset.id));

  const finalizedChannels = nextChannels.map((channel) => ({
    ...channel,
    examplesJson: safeJsonString(channel.examplesJson, "[]"),
    avatarAssetId:
      channel.avatarAssetId && validAssetIds.has(channel.avatarAssetId) ? channel.avatarAssetId : null,
    defaultBackgroundAssetId:
      channel.defaultBackgroundAssetId && validAssetIds.has(channel.defaultBackgroundAssetId)
        ? channel.defaultBackgroundAssetId
        : null,
    defaultMusicAssetId:
      channel.defaultMusicAssetId && validAssetIds.has(channel.defaultMusicAssetId)
        ? channel.defaultMusicAssetId
        : null
  }));

  const finalizedThreads = threads.map((thread) => ({
    ...thread,
    channelId: validChannelIds.has(thread.channelId) ? thread.channelId : defaultChannelId
  }));

  return {
    version: CHAT_STORE_VERSION,
    channels: finalizedChannels,
    channelAssets: nextAssets,
    threads: finalizedThreads
  };
}

async function readStore(): Promise<ChatStore> {
  await ensureStoreExists();
  const raw = await fs.readFile(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const normalized = await normalizeStore(parsed);

  // Persist migration/sanitization to disk.
  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    await writeStore(normalized);
  }

  return normalized;
}

async function writeStore(store: ChatStore): Promise<void> {
  await ensureStoreExists();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function listChannels(): Promise<Channel[]> {
  const store = await readStore();
  return [...store.channels].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function listChannelsWithStats(): Promise<
  Array<
    Channel & {
      backgroundCount: number;
      musicCount: number;
      hasAvatar: boolean;
    }
  >
> {
  const store = await readStore();
  return [...store.channels]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((channel) => {
      const assets = store.channelAssets.filter((asset) => asset.channelId === channel.id);
      return {
        ...channel,
        backgroundCount: assets.filter((asset) => asset.kind === "background").length,
        musicCount: assets.filter((asset) => asset.kind === "music").length,
        hasAvatar: Boolean(channel.avatarAssetId)
      };
    });
}

export async function getChannelById(channelId: string): Promise<Channel | null> {
  const store = await readStore();
  return store.channels.find((channel) => channel.id === channelId) ?? null;
}

export async function getDefaultChannel(): Promise<Channel> {
  const store = await readStore();
  return store.channels[0];
}

export async function createChannel(input?: {
  name?: string;
  username?: string;
  systemPrompt?: string;
  examplesJson?: string;
  templateId?: string;
}): Promise<Channel> {
  const store = await readStore();
  const now = nowIso();
  const baseline = store.channels[0] ?? (await buildDefaultChannel(now));
  const channel: Channel = {
    id: newId(),
    name: sanitizeName(input?.name, "New channel"),
    username: sanitizeUsername(input?.username ?? "channel"),
    systemPrompt: sanitizeTextBlock(input?.systemPrompt, baseline.systemPrompt),
    examplesJson:
      typeof input?.examplesJson === "string"
        ? ensureValidJsonString(input.examplesJson)
        : safeJsonString(baseline.examplesJson, "[]"),
    templateId: sanitizeName(input?.templateId, baseline.templateId),
    avatarAssetId: null,
    defaultBackgroundAssetId: null,
    defaultMusicAssetId: null,
    createdAt: now,
    updatedAt: now
  };

  store.channels.push(channel);
  await writeStore(store);
  return channel;
}

export async function updateChannelById(
  channelId: string,
  patch: Partial<{
    name: string;
    username: string;
    systemPrompt: string;
    examplesJson: string;
    templateId: string;
    avatarAssetId: string | null;
    defaultBackgroundAssetId: string | null;
    defaultMusicAssetId: string | null;
  }>
): Promise<Channel> {
  const store = await readStore();
  const channel = store.channels.find((item) => item.id === channelId);
  if (!channel) {
    throw new Error("Channel not found.");
  }

  const assetIds = new Set(
    store.channelAssets.filter((asset) => asset.channelId === channelId).map((asset) => asset.id)
  );

  if (typeof patch.name === "string") {
    channel.name = sanitizeName(patch.name, channel.name);
  }
  if (typeof patch.username === "string") {
    channel.username = sanitizeUsername(patch.username);
  }
  if (typeof patch.systemPrompt === "string") {
    channel.systemPrompt = sanitizeTextBlock(patch.systemPrompt, channel.systemPrompt);
  }
  if (typeof patch.examplesJson === "string") {
    channel.examplesJson = ensureValidJsonString(patch.examplesJson);
  }
  if (typeof patch.templateId === "string") {
    channel.templateId = sanitizeName(patch.templateId, channel.templateId);
  }
  if ("avatarAssetId" in patch) {
    channel.avatarAssetId =
      patch.avatarAssetId && assetIds.has(patch.avatarAssetId) ? patch.avatarAssetId : null;
  }
  if ("defaultBackgroundAssetId" in patch) {
    channel.defaultBackgroundAssetId =
      patch.defaultBackgroundAssetId && assetIds.has(patch.defaultBackgroundAssetId)
        ? patch.defaultBackgroundAssetId
        : null;
  }
  if ("defaultMusicAssetId" in patch) {
    channel.defaultMusicAssetId =
      patch.defaultMusicAssetId && assetIds.has(patch.defaultMusicAssetId)
        ? patch.defaultMusicAssetId
        : null;
  }

  channel.updatedAt = nowIso();
  await writeStore(store);
  return channel;
}

export async function deleteChannelById(channelId: string): Promise<{
  deleted: boolean;
  removedAssets: ChannelAsset[];
  removedChats: ChatThread[];
}> {
  const store = await readStore();
  if (store.channels.length <= 1) {
    throw new Error("Cannot delete the last channel.");
  }

  const channel = store.channels.find((item) => item.id === channelId);
  if (!channel) {
    return {
      deleted: false,
      removedAssets: [],
      removedChats: []
    };
  }

  const removedAssets = store.channelAssets.filter((asset) => asset.channelId === channelId);
  const removedChats = store.threads.filter((thread) => thread.channelId === channelId);

  store.channels = store.channels.filter((item) => item.id !== channelId);
  store.channelAssets = store.channelAssets.filter((asset) => asset.channelId !== channelId);
  store.threads = store.threads.filter((thread) => thread.channelId !== channelId);

  await writeStore(store);
  return {
    deleted: true,
    removedAssets,
    removedChats
  };
}

export async function listChannelAssets(
  channelId: string,
  kind?: ChannelAssetKind
): Promise<ChannelAsset[]> {
  const store = await readStore();
  return store.channelAssets
    .filter((asset) => asset.channelId === channelId && (!kind || asset.kind === kind))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getChannelAssetById(
  channelId: string,
  assetId: string
): Promise<ChannelAsset | null> {
  const store = await readStore();
  return (
    store.channelAssets.find((asset) => asset.id === assetId && asset.channelId === channelId) ?? null
  );
}

export async function createChannelAsset(params: {
  channelId: string;
  kind: ChannelAssetKind;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  assetId?: string;
}): Promise<ChannelAsset> {
  const store = await readStore();
  const channel = store.channels.find((item) => item.id === params.channelId);
  if (!channel) {
    throw new Error("Channel not found.");
  }

  const asset: ChannelAsset = {
    id: params.assetId?.trim() || newId(),
    channelId: params.channelId,
    kind: params.kind,
    fileName: params.fileName,
    originalName: params.originalName,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    createdAt: nowIso()
  };

  store.channelAssets.push(asset);
  channel.updatedAt = nowIso();

  // First asset of each kind can become default to speed up UX.
  if (asset.kind === "avatar" && !channel.avatarAssetId) {
    channel.avatarAssetId = asset.id;
  }
  if (asset.kind === "background" && !channel.defaultBackgroundAssetId) {
    channel.defaultBackgroundAssetId = asset.id;
  }
  if (asset.kind === "music" && !channel.defaultMusicAssetId) {
    channel.defaultMusicAssetId = asset.id;
  }

  await writeStore(store);
  return asset;
}

export async function deleteChannelAssetById(
  channelId: string,
  assetId: string
): Promise<ChannelAsset | null> {
  const store = await readStore();
  const asset = store.channelAssets.find((item) => item.id === assetId && item.channelId === channelId);
  if (!asset) {
    return null;
  }
  store.channelAssets = store.channelAssets.filter((item) => !(item.id === assetId && item.channelId === channelId));

  const channel = store.channels.find((item) => item.id === channelId);
  if (channel) {
    if (channel.avatarAssetId === assetId) {
      channel.avatarAssetId = null;
    }
    if (channel.defaultBackgroundAssetId === assetId) {
      channel.defaultBackgroundAssetId = null;
    }
    if (channel.defaultMusicAssetId === assetId) {
      channel.defaultMusicAssetId = null;
    }
    channel.updatedAt = nowIso();
  }

  await writeStore(store);
  return asset;
}

export async function listChats(channelId?: string): Promise<ChatThread[]> {
  const store = await readStore();
  const filtered = channelId ? store.threads.filter((thread) => thread.channelId === channelId) : store.threads;
  return [...filtered].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getChatById(chatId: string): Promise<ChatThread | null> {
  const store = await readStore();
  return store.threads.find((thread) => thread.id === chatId) ?? null;
}

export async function createOrGetChatByUrl(rawUrl: string, channelIdRaw?: string): Promise<ChatThread> {
  const url = normalizeUrl(rawUrl);
  const store = await readStore();
  const defaultChannelId = store.channels[0]?.id ?? "";
  const channelId =
    typeof channelIdRaw === "string" && store.channels.some((channel) => channel.id === channelIdRaw)
      ? channelIdRaw
      : defaultChannelId;

  const existing = store.threads.find((thread) => thread.url === url && thread.channelId === channelId);
  if (existing) {
    return existing;
  }

  const createdAt = nowIso();
  const thread: ChatThread = {
    id: newId(),
    channelId,
    url,
    title: url,
    createdAt,
    updatedAt: createdAt,
    events: [
      {
        id: newId(),
        role: "user",
        type: "link",
        text: `Ссылка добавлена: ${url}`,
        createdAt
      }
    ]
  };

  store.threads.push(thread);
  await writeStore(store);
  return thread;
}

export async function appendChatEvent(
  chatId: string,
  event: Omit<ChatEvent, "id" | "createdAt">
): Promise<ChatThread> {
  const store = await readStore();
  const thread = store.threads.find((item) => item.id === chatId);
  if (!thread) {
    throw new Error("Chat not found.");
  }

  const createdAt = nowIso();
  thread.events.push({
    id: newId(),
    createdAt,
    ...event
  });
  thread.updatedAt = createdAt;

  if (event.type === "stage2" || event.type === "comments") {
    thread.title =
      typeof event.data === "object" &&
      event.data &&
      "title" in (event.data as Record<string, unknown>) &&
      typeof (event.data as Record<string, unknown>).title === "string"
        ? String((event.data as Record<string, unknown>).title)
        : thread.title;
  }

  await writeStore(store);
  return thread;
}

export async function deleteChatById(chatId: string): Promise<boolean> {
  const store = await readStore();
  const prevLength = store.threads.length;
  store.threads = store.threads.filter((thread) => thread.id !== chatId);

  if (store.threads.length === prevLength) {
    return false;
  }

  await writeStore(store);
  return true;
}
