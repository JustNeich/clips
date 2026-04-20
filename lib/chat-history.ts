import { buildLegacyTimelineEntries } from "./stage3-legacy-bridge";
import { ChatDraft, ChatListItem, Stage3Version } from "../app/components/types";
import { buildChatListItem, normalizeChatDraft } from "./chat-workflow";
import { getDb, newId, nowIso } from "./db/client";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  parseStage2PromptConfigJson,
  Stage2PromptConfig,
  stringifyStage2PromptConfig
} from "./stage2-pipeline";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  parseStage2ExamplesConfigJson,
  parseStage2HardConstraintsJson,
  Stage2ExamplesConfig,
  Stage2HardConstraints,
  stringifyStage2ExamplesConfig,
  stringifyStage2HardConstraints
} from "./stage2-channel-config";
import {
  DEFAULT_STAGE2_STYLE_PROFILE,
  parseStage2StyleProfileJson,
  stringifyStage2StyleProfile,
  type Stage2StyleProfile
} from "./stage2-channel-learning";
import { parseStage2WorkerProfileId } from "./stage2-worker-profile";
import { listLatestPublicationSummariesByChatIds } from "./publication-store";
import { listLatestActiveStage2RunsForChats } from "./stage2-progress-store";
import { listLatestActiveSourceJobsForChats } from "./source-job-store";
import { getWorkspaceDefaultTemplateId, readManagedTemplate } from "./managed-template-store";
import { getWorkspace, getWorkspaceStage2HardConstraints } from "./team-store";
import { normalizeSupportedUrl } from "./ytdlp";

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
  workspaceId: string;
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
  workspaceId: string;
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
  workspaceId: string;
  creatorUserId: string;
  name: string;
  username: string;
  systemPrompt: string;
  descriptionPrompt: string;
  examplesJson: string;
  stage2WorkerProfileId: string | null;
  stage2ExamplesConfig: Stage2ExamplesConfig;
  stage2HardConstraints: Stage2HardConstraints;
  stage2PromptConfig: Stage2PromptConfig;
  stage2StyleProfile: Stage2StyleProfile;
  templateId: string;
  avatarAssetId: string | null;
  defaultBackgroundAssetId: string | null;
  defaultMusicAssetId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

export type ChannelAccessRecord = {
  id: string;
  channelId: string;
  userId: string;
  accessRole: "operate";
  grantedByUserId: string;
  createdAt: string;
  revokedAt: string | null;
};

export const CHAT_STORE_VERSION = 3 as const;
export const DEFAULT_TEMPLATE_ID = "science-card-v1";

const allowedEventTypes = new Set<ChatEventType>([
  "link",
  "download",
  "comments",
  "stage2",
  "error",
  "note"
]);

function sanitizeName(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

async function resolvePersistedChannelTemplateId(
  workspaceId: string,
  value: string | null | undefined,
  fallback?: string
): Promise<string> {
  const fallbackTemplateId = fallback?.trim() || (await getWorkspaceDefaultTemplateId(workspaceId));
  const candidate = sanitizeName(value, fallbackTemplateId);
  const resolved = await readManagedTemplate(candidate, { workspaceId });
  return resolved?.id ?? fallbackTemplateId;
}

async function repairChannelTemplateReference(channel: Channel): Promise<Channel> {
  const resolvedTemplateId = await resolvePersistedChannelTemplateId(
    channel.workspaceId,
    channel.templateId
  );
  if (resolvedTemplateId === channel.templateId) {
    return channel;
  }

  const updatedAt = nowIso();
  const db = getDb();
  db.prepare("UPDATE channels SET template_id = ?, updated_at = ? WHERE id = ?").run(
    resolvedTemplateId,
    updatedAt,
    channel.id
  );
  return {
    ...channel,
    templateId: resolvedTemplateId,
    updatedAt
  };
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

function mapChannel(row: Record<string, unknown>): Channel {
  const username = sanitizeUsername(String(row.username ?? ""));
  const channelId = String(row.id);
  const channelName = sanitizeName(String(row.name ?? ""), "Channel");
  const examplesJson = safeJsonString(String(row.examples_json ?? "[]"), "[]");
  return {
    id: channelId,
    workspaceId: String(row.workspace_id),
    creatorUserId: String(row.creator_user_id),
    name: channelName,
    username,
    systemPrompt: sanitizeTextBlock(String(row.system_prompt ?? ""), ""),
    descriptionPrompt: sanitizeTextBlock(String(row.description_prompt ?? ""), ""),
    examplesJson,
    stage2WorkerProfileId: parseStage2WorkerProfileId(row.stage2_worker_profile_id),
    stage2ExamplesConfig: parseStage2ExamplesConfigJson(
      row.stage2_examples_config_json ? String(row.stage2_examples_config_json) : null,
      { channelId, channelName }
    ),
    stage2HardConstraints: row.stage2_hard_constraints_json
      ? parseStage2HardConstraintsJson(String(row.stage2_hard_constraints_json))
      : DEFAULT_STAGE2_HARD_CONSTRAINTS,
    stage2PromptConfig: parseStage2PromptConfigJson(
      row.stage2_prompt_config_json ? String(row.stage2_prompt_config_json) : null
    ),
    stage2StyleProfile: parseStage2StyleProfileJson(
      row.stage2_style_profile_json ? String(row.stage2_style_profile_json) : null
    ),
    templateId: sanitizeName(String(row.template_id ?? ""), DEFAULT_TEMPLATE_ID),
    avatarAssetId: row.avatar_asset_id ? String(row.avatar_asset_id) : null,
    defaultBackgroundAssetId: row.default_background_asset_id
      ? String(row.default_background_asset_id)
      : null,
    defaultMusicAssetId: row.default_music_asset_id ? String(row.default_music_asset_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    archivedAt: row.archived_at ? String(row.archived_at) : null
  };
}

function mapAsset(row: Record<string, unknown>): ChannelAsset {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    channelId: String(row.channel_id),
    kind: String(row.kind) as ChannelAssetKind,
    fileName: String(row.file_name),
    originalName: String(row.original_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    createdAt: String(row.created_at)
  };
}

function mapEvent(row: Record<string, unknown>): ChatEvent {
  const type = String(row.type) as ChatEventType;
  const role = String(row.role) as ChatEventRole;
  return {
    id: String(row.id),
    role,
    type: allowedEventTypes.has(type) ? type : "note",
    text: String(row.text),
    data: row.data_json ? JSON.parse(String(row.data_json)) : undefined,
    createdAt: String(row.created_at)
  };
}

function mapThread(row: Record<string, unknown>, events: ChatEvent[]): ChatThread {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    channelId: String(row.channel_id),
    url: String(row.url),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    events
  };
}

function mapDraft(row: Record<string, unknown>): ChatDraft | null {
  const parsed = row.draft_json ? JSON.parse(String(row.draft_json)) : null;
  const draft = normalizeChatDraft(parsed);
  if (!draft) {
    return null;
  }
  return {
    ...draft,
    id: String(row.id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function getAnyWorkspaceId(): string {
  const workspace = getWorkspace();
  if (!workspace) {
    throw new Error("Workspace is not initialized.");
  }
  return workspace.id;
}

function getThreadEvents(threadId: string): ChatEvent[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM chat_events WHERE thread_id = ? ORDER BY created_at ASC")
    .all(threadId) as Record<string, unknown>[];
  return rows.map(mapEvent);
}

function getDraftRow(threadId: string, userId: string): Record<string, unknown> | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM chat_drafts WHERE thread_id = ? AND user_id = ?")
    .get(threadId, userId) as Record<string, unknown> | undefined;
}

export async function listChannels(workspaceId?: string): Promise<Channel[]> {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM channels WHERE workspace_id = ? AND archived_at IS NULL ORDER BY updated_at DESC"
    )
    .all(workspaceId ?? getAnyWorkspaceId()) as Record<string, unknown>[];
  return Promise.all(rows.map((row) => repairChannelTemplateReference(mapChannel(row))));
}

export async function listChannelsWithStats(
  workspaceId?: string
): Promise<
  Array<
    Channel & {
      backgroundCount: number;
      musicCount: number;
      hasAvatar: boolean;
    }
  >
> {
  const channels = await listChannels(workspaceId);
  const db = getDb();
  return channels.map((channel) => {
    const rows = db
      .prepare("SELECT kind, COUNT(*) as count FROM channel_assets WHERE channel_id = ? GROUP BY kind")
      .all(channel.id) as Record<string, unknown>[];
    const counts = new Map(rows.map((row) => [String(row.kind), Number(row.count)]));
    return {
      ...channel,
      backgroundCount: counts.get("background") ?? 0,
      musicCount: counts.get("music") ?? 0,
      hasAvatar: Boolean(channel.avatarAssetId)
    };
  });
}

export async function getChannelById(channelId: string): Promise<Channel | null> {
  const db = getDb();
  const row = db.prepare("SELECT * FROM channels WHERE id = ?").get(channelId) as
    | Record<string, unknown>
    | undefined;
  return row ? repairChannelTemplateReference(mapChannel(row)) : null;
}

export async function getDefaultChannel(workspaceId?: string): Promise<Channel> {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM channels WHERE workspace_id = ? AND archived_at IS NULL ORDER BY created_at ASC LIMIT 1"
    )
    .get(workspaceId ?? getAnyWorkspaceId()) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Default channel not found.");
  }
  return repairChannelTemplateReference(mapChannel(row));
}

export async function createChannel(input: {
  workspaceId: string;
  creatorUserId: string;
  name?: string;
  username?: string;
  systemPrompt?: string;
  descriptionPrompt?: string;
  examplesJson?: string;
  stage2WorkerProfileId?: string | null;
  stage2ExamplesConfig?: Stage2ExamplesConfig;
  stage2HardConstraints?: Stage2HardConstraints;
  stage2PromptConfig?: Stage2PromptConfig;
  stage2StyleProfile?: Stage2StyleProfile;
  templateId?: string;
}): Promise<Channel> {
  const now = nowIso();
  const username = sanitizeUsername(input.username ?? "channel");
  const templateId = await resolvePersistedChannelTemplateId(input.workspaceId, input.templateId);
  const channel: Channel = {
    id: newId(),
    workspaceId: input.workspaceId,
    creatorUserId: input.creatorUserId,
    name: sanitizeName(input.name, "New channel"),
    username,
    systemPrompt: sanitizeTextBlock(input.systemPrompt, ""),
    descriptionPrompt: sanitizeTextBlock(input.descriptionPrompt, ""),
    examplesJson: typeof input.examplesJson === "string" ? ensureValidJsonString(input.examplesJson) : "[]",
    stage2WorkerProfileId: null,
    stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
    stage2HardConstraints: input.stage2HardConstraints
      ? parseStage2HardConstraintsJson(stringifyStage2HardConstraints(input.stage2HardConstraints))
      : getWorkspaceStage2HardConstraints(input.workspaceId),
    stage2PromptConfig: DEFAULT_STAGE2_PROMPT_CONFIG,
    stage2StyleProfile: DEFAULT_STAGE2_STYLE_PROFILE,
    templateId,
    avatarAssetId: null,
    defaultBackgroundAssetId: null,
    defaultMusicAssetId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null
  };

  channel.stage2ExamplesConfig = parseStage2ExamplesConfigJson(
    stringifyStage2ExamplesConfig(channel.stage2ExamplesConfig, {
      channelId: channel.id,
      channelName: channel.name
    }),
    { channelId: channel.id, channelName: channel.name }
  );

  const db = getDb();
  db.prepare(
    `INSERT INTO channels
    (id, workspace_id, creator_user_id, name, username, system_prompt, description_prompt, examples_json, stage2_worker_profile_id, stage2_examples_config_json, stage2_hard_constraints_json, stage2_prompt_config_json, stage2_style_profile_json, template_id, avatar_asset_id, default_background_asset_id, default_music_asset_id, created_at, updated_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL)`
  ).run(
    channel.id,
    channel.workspaceId,
    channel.creatorUserId,
    channel.name,
    channel.username,
    channel.systemPrompt,
    channel.descriptionPrompt,
    channel.examplesJson,
    channel.stage2WorkerProfileId,
    stringifyStage2ExamplesConfig(channel.stage2ExamplesConfig, {
      channelId: channel.id,
      channelName: channel.name
    }),
    stringifyStage2HardConstraints(channel.stage2HardConstraints),
    stringifyStage2PromptConfig(channel.stage2PromptConfig),
    stringifyStage2StyleProfile(channel.stage2StyleProfile),
    channel.templateId,
    channel.createdAt,
    channel.updatedAt
  );
  return channel;
}

export async function updateChannelById(
  channelId: string,
  patch: Partial<{
    name: string;
    username: string;
    systemPrompt: string;
    descriptionPrompt: string;
    examplesJson: string;
    stage2WorkerProfileId: string | null;
    stage2ExamplesConfig: Stage2ExamplesConfig;
    stage2HardConstraints: Stage2HardConstraints;
    stage2PromptConfig: Stage2PromptConfig;
    stage2StyleProfile: Stage2StyleProfile;
    templateId: string;
    avatarAssetId: string | null;
    defaultBackgroundAssetId: string | null;
    defaultMusicAssetId: string | null;
  }>
): Promise<Channel> {
  const channel = await getChannelById(channelId);
  if (!channel) {
    throw new Error("Channel not found.");
  }
  const assetIds = new Set((await listChannelAssets(channelId)).map((asset) => asset.id));
  const nextTemplateId =
    typeof patch.templateId === "string"
      ? await resolvePersistedChannelTemplateId(channel.workspaceId, patch.templateId, channel.templateId)
      : channel.templateId;

  const next = {
    ...channel,
    name: typeof patch.name === "string" ? sanitizeName(patch.name, channel.name) : channel.name,
    username:
      typeof patch.username === "string" ? sanitizeUsername(patch.username) : channel.username,
    systemPrompt:
      typeof patch.systemPrompt === "string"
        ? sanitizeTextBlock(patch.systemPrompt, channel.systemPrompt)
        : channel.systemPrompt,
    descriptionPrompt:
      typeof patch.descriptionPrompt === "string"
        ? sanitizeTextBlock(patch.descriptionPrompt, channel.descriptionPrompt)
        : channel.descriptionPrompt,
    examplesJson:
      typeof patch.examplesJson === "string"
        ? ensureValidJsonString(patch.examplesJson)
        : channel.examplesJson,
    stage2WorkerProfileId: channel.stage2WorkerProfileId,
    stage2ExamplesConfig: channel.stage2ExamplesConfig,
    stage2HardConstraints:
      "stage2HardConstraints" in patch && patch.stage2HardConstraints
        ? parseStage2HardConstraintsJson(stringifyStage2HardConstraints(patch.stage2HardConstraints))
        : channel.stage2HardConstraints,
    stage2PromptConfig: channel.stage2PromptConfig,
    stage2StyleProfile: channel.stage2StyleProfile,
    templateId: nextTemplateId,
    avatarAssetId:
      "avatarAssetId" in patch
        ? patch.avatarAssetId && assetIds.has(patch.avatarAssetId)
          ? patch.avatarAssetId
          : null
        : channel.avatarAssetId,
    defaultBackgroundAssetId:
      "defaultBackgroundAssetId" in patch
        ? patch.defaultBackgroundAssetId && assetIds.has(patch.defaultBackgroundAssetId)
          ? patch.defaultBackgroundAssetId
          : null
        : channel.defaultBackgroundAssetId,
    defaultMusicAssetId:
      "defaultMusicAssetId" in patch
        ? patch.defaultMusicAssetId && assetIds.has(patch.defaultMusicAssetId)
          ? patch.defaultMusicAssetId
          : null
        : channel.defaultMusicAssetId,
    updatedAt: nowIso()
  };

  const db = getDb();
  db.prepare(
    `UPDATE channels SET
      name = ?,
      username = ?,
      system_prompt = ?,
      description_prompt = ?,
      examples_json = ?,
      stage2_worker_profile_id = ?,
      stage2_examples_config_json = ?,
      stage2_hard_constraints_json = ?,
      stage2_prompt_config_json = ?,
      stage2_style_profile_json = ?,
      template_id = ?,
      avatar_asset_id = ?,
      default_background_asset_id = ?,
      default_music_asset_id = ?,
      updated_at = ?
    WHERE id = ?`
  ).run(
    next.name,
    next.username,
    next.systemPrompt,
    next.descriptionPrompt,
    next.examplesJson,
    next.stage2WorkerProfileId,
    stringifyStage2ExamplesConfig(next.stage2ExamplesConfig, {
      channelId: next.id,
      channelName: next.name
    }),
    stringifyStage2HardConstraints(next.stage2HardConstraints),
    stringifyStage2PromptConfig(next.stage2PromptConfig),
    stringifyStage2StyleProfile(next.stage2StyleProfile),
    next.templateId,
    next.avatarAssetId,
    next.defaultBackgroundAssetId,
    next.defaultMusicAssetId,
    next.updatedAt,
    channelId
  );

  return next;
}

export async function reassignChannelsTemplateId(
  fromTemplateId: string,
  toTemplateId: string
): Promise<number> {
  const sourceTemplateId = sanitizeName(fromTemplateId, "").trim();
  const targetTemplateId = sanitizeName(toTemplateId, "").trim();
  if (!sourceTemplateId || !targetTemplateId || sourceTemplateId === targetTemplateId) {
    return 0;
  }

  const db = getDb();
  const result = db
    .prepare(
      `UPDATE channels
       SET template_id = ?, updated_at = ?
       WHERE template_id = ?`
    )
    .run(targetTemplateId, nowIso(), sourceTemplateId);
  return Number(result.changes ?? 0);
}

export async function deleteChannelById(channelId: string): Promise<{
  deleted: boolean;
  removedAssets: ChannelAsset[];
  removedChats: ChatThread[];
}> {
  const channel = await getChannelById(channelId);
  if (!channel) {
    return { deleted: false, removedAssets: [], removedChats: [] };
  }
  const channels = await listChannels(channel.workspaceId);
  if (channels.length <= 1) {
    throw new Error("Cannot delete the last channel.");
  }

  const removedAssets = await listChannelAssets(channelId);
  const removedChats = await listChats(channelId);
  const db = getDb();
  db.prepare("DELETE FROM channels WHERE id = ?").run(channelId);
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
  const db = getDb();
  const rows = (
    kind
      ? db
          .prepare(
            "SELECT * FROM channel_assets WHERE channel_id = ? AND kind = ? ORDER BY created_at DESC"
          )
          .all(channelId, kind)
      : db
          .prepare("SELECT * FROM channel_assets WHERE channel_id = ? ORDER BY created_at DESC")
          .all(channelId)
  ) as Record<string, unknown>[];
  return rows.map(mapAsset);
}

export async function getChannelAssetById(
  channelId: string,
  assetId: string
): Promise<ChannelAsset | null> {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM channel_assets WHERE id = ? AND channel_id = ?")
    .get(assetId, channelId) as Record<string, unknown> | undefined;
  return row ? mapAsset(row) : null;
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
  const channel = await getChannelById(params.channelId);
  if (!channel) {
    throw new Error("Channel not found.");
  }

  const asset: ChannelAsset = {
    id: params.assetId?.trim() || newId(),
    workspaceId: channel.workspaceId,
    channelId: params.channelId,
    kind: params.kind,
    fileName: params.fileName,
    originalName: params.originalName,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    createdAt: nowIso()
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO channel_assets
    (id, workspace_id, channel_id, kind, file_name, original_name, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    asset.id,
    asset.workspaceId,
    asset.channelId,
    asset.kind,
    asset.fileName,
    asset.originalName,
    asset.mimeType,
    asset.sizeBytes,
    asset.createdAt
  );

  const patch: Parameters<typeof updateChannelById>[1] = {};
  if (asset.kind === "avatar" && !channel.avatarAssetId) {
    patch.avatarAssetId = asset.id;
  }
  if (asset.kind === "background" && !channel.defaultBackgroundAssetId) {
    patch.defaultBackgroundAssetId = asset.id;
  }
  if (asset.kind === "music" && !channel.defaultMusicAssetId) {
    patch.defaultMusicAssetId = asset.id;
  }
  if (Object.keys(patch).length > 0) {
    await updateChannelById(channel.id, patch);
  } else {
    db.prepare("UPDATE channels SET updated_at = ? WHERE id = ?").run(nowIso(), channel.id);
  }

  return asset;
}

export async function deleteChannelAssetById(
  channelId: string,
  assetId: string
): Promise<ChannelAsset | null> {
  const asset = await getChannelAssetById(channelId, assetId);
  if (!asset) {
    return null;
  }
  const db = getDb();
  db.prepare("DELETE FROM channel_assets WHERE id = ? AND channel_id = ?").run(assetId, channelId);
  return asset;
}

export async function listChats(channelId?: string, workspaceId?: string): Promise<ChatThread[]> {
  const db = getDb();
  const rows = (
    channelId
      ? db
          .prepare("SELECT * FROM chat_threads WHERE channel_id = ? ORDER BY updated_at DESC")
          .all(channelId)
      : db
          .prepare("SELECT * FROM chat_threads WHERE workspace_id = ? ORDER BY updated_at DESC")
          .all(workspaceId ?? getAnyWorkspaceId())
  ) as Record<string, unknown>[];
  return rows.map((row) => mapThread(row, getThreadEvents(String(row.id))));
}

export async function listChatListItems(
  userId: string,
  channelId?: string,
  workspaceId?: string
): Promise<ChatListItem[]> {
  const chats = await listChats(channelId, workspaceId);
  const resolvedWorkspaceId = workspaceId ?? getAnyWorkspaceId();
  const activeSourceJobsByChatId = listLatestActiveSourceJobsForChats(
    chats.map((chat) => chat.id),
    resolvedWorkspaceId
  );
  const activeRunsByChatId = listLatestActiveStage2RunsForChats(
    chats.map((chat) => chat.id),
    resolvedWorkspaceId
  );
  const publicationByChatId = listLatestPublicationSummariesByChatIds(chats.map((chat) => chat.id));

  return chats.map((chat) => {
    const item = {
      ...buildChatListItem(chat, getChatDraftSync(chat.id, userId)),
      publication: publicationByChatId.get(chat.id) ?? null
    };
    const activeSourceJob = activeSourceJobsByChatId.get(chat.id);
    if (activeSourceJob) {
      const liveAction =
        activeSourceJob.progress.activeStageId === "retry"
          ? "Retrying"
          : activeSourceJob.progress.activeStageId === "comments"
            ? "Comments"
            : "Fetching";
      return {
        ...item,
        preferredStep: 1,
        liveAction
      };
    }

    const activeRun = activeRunsByChatId.get(chat.id);
    if (!activeRun) {
      return item;
    }

    const workingStatus = item.maxStep >= 3 || item.hasDraft
      ? "editing"
      : item.maxStep >= 2
        ? "sourceReady"
        : "new";

    return {
      ...item,
      status: item.status === "error" || item.status === "exported" ? workingStatus : item.status,
      preferredStep: 2,
      liveAction: "Stage 2"
    };
  });
}

export async function getChatById(chatId: string): Promise<ChatThread | null> {
  const db = getDb();
  const row = db.prepare("SELECT * FROM chat_threads WHERE id = ?").get(chatId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapThread(row, getThreadEvents(chatId)) : null;
}

function getChatDraftSync(threadId: string, userId: string): ChatDraft | null {
  const row = getDraftRow(threadId, userId);
  return row ? mapDraft(row) : null;
}

export async function getChatDraft(threadId: string, userId: string): Promise<ChatDraft | null> {
  return getChatDraftSync(threadId, userId);
}

export async function upsertChatDraft(
  threadId: string,
  userId: string,
  draftInput: Omit<ChatDraft, "id" | "threadId" | "userId" | "createdAt" | "updatedAt">
): Promise<ChatDraft> {
  const thread = await getChatById(threadId);
  if (!thread) {
    throw new Error("Chat not found.");
  }

  const db = getDb();
  const existing = getDraftRow(threadId, userId);
  const now = nowIso();
  const payload = normalizeChatDraft({
    id: existing ? String(existing.id) : "",
    threadId,
    userId,
    createdAt: existing ? String(existing.created_at) : now,
    updatedAt: now,
    ...draftInput
  });

  if (!payload) {
    throw new Error("Draft payload is invalid.");
  }

  if (existing) {
    db.prepare(
      `UPDATE chat_drafts
       SET draft_json = ?, updated_at = ?
       WHERE thread_id = ? AND user_id = ?`
    ).run(JSON.stringify(payload), now, threadId, userId);
  } else {
    db.prepare(
      `INSERT INTO chat_drafts
        (id, workspace_id, thread_id, user_id, draft_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(newId(), thread.workspaceId, threadId, userId, JSON.stringify(payload), now, now);
  }

  db.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(now, threadId);

  const next = getChatDraftSync(threadId, userId);
  if (!next) {
    throw new Error("Draft could not be loaded after save.");
  }
  return next;
}

export async function deleteChatDraft(threadId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const result = db.prepare("DELETE FROM chat_drafts WHERE thread_id = ? AND user_id = ?").run(threadId, userId);
  return Number(result.changes ?? 0) > 0;
}

export async function createOrGetChatBySource(input: {
  rawUrl: string;
  channelIdRaw?: string;
  title?: string | null;
  eventText?: string | null;
}): Promise<ChatThread> {
  const url = normalizeSupportedUrl(input.rawUrl.trim());
  if (!url) {
    throw new Error("URL is required.");
  }
  const channel = input.channelIdRaw ? await getChannelById(input.channelIdRaw) : await getDefaultChannel().catch(() => null);
  if (!channel) {
    throw new Error("Channel not found.");
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM chat_threads WHERE url = ? AND channel_id = ?")
    .get(url, channel.id) as Record<string, unknown> | undefined;
  if (existing) {
    return mapThread(existing, getThreadEvents(String(existing.id)));
  }

  const createdAt = nowIso();
  const thread: ChatThread = {
    id: newId(),
    workspaceId: channel.workspaceId,
    channelId: channel.id,
    url,
    title: sanitizeName(input.title, url),
    createdAt,
    updatedAt: createdAt,
    events: []
  };

  db.prepare(
    "INSERT INTO chat_threads (id, workspace_id, channel_id, url, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    thread.id,
    thread.workspaceId,
    thread.channelId,
    thread.url,
    thread.title,
    thread.createdAt,
    thread.updatedAt
  );

  await appendChatEvent(thread.id, {
    role: "user",
    type: "link",
    text: input.eventText?.trim() || `Ссылка добавлена: ${url}`
  });

  return (await getChatById(thread.id)) as ChatThread;
}

export async function createOrGetChatByUrl(rawUrl: string, channelIdRaw?: string): Promise<ChatThread> {
  return createOrGetChatBySource({
    rawUrl,
    channelIdRaw
  });
}

export async function appendChatEvent(
  chatId: string,
  event: Omit<ChatEvent, "id" | "createdAt">
): Promise<ChatThread> {
  const thread = await getChatById(chatId);
  if (!thread) {
    throw new Error("Chat not found.");
  }
  const createdAt = nowIso();
  const eventId = newId();
  const db = getDb();
  db.prepare(
    "INSERT INTO chat_events (id, thread_id, role, type, text, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    eventId,
    chatId,
    event.role,
    event.type,
    event.text,
    event.data === undefined ? null : JSON.stringify(event.data),
    createdAt
  );

  let nextTitle = thread.title;
  if (event.type === "stage2" || event.type === "comments") {
    const payload = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : null;
    if (payload && typeof payload.title === "string") {
      nextTitle = payload.title;
    }
  }
  db.prepare("UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?").run(
    nextTitle,
    createdAt,
    chatId
  );
  return (await getChatById(chatId)) as ChatThread;
}

export async function deleteChatById(chatId: string): Promise<boolean> {
  const db = getDb();
  const result = db.prepare("DELETE FROM chat_threads WHERE id = ?").run(chatId);
  return Number(result.changes ?? 0) > 0;
}

export async function getChannelAccessForUser(
  channelId: string,
  userId: string
): Promise<ChannelAccessRecord | null> {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM channel_access WHERE channel_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(channelId, userId) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    userId: String(row.user_id),
    accessRole: "operate",
    grantedByUserId: String(row.granted_by_user_id),
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null
  };
}

export async function listLegacyStage3VersionsByMedia(mediaId: string): Promise<Stage3Version[]> {
  const normalizedMediaId = mediaId.trim();
  if (!normalizedMediaId) {
    return [];
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.id, e.created_at, e.data_json
       FROM chat_events e
       JOIN chat_threads t ON t.id = e.thread_id
       WHERE t.url = ? AND e.role = 'assistant' AND e.type = 'note'
       ORDER BY e.created_at ASC`
    )
    .all(normalizedMediaId) as Record<string, unknown>[];

  const events = rows
    .filter((row) => row.data_json)
    .map((row) => ({
      id: String(row.id),
      createdAt: String(row.created_at),
      data: JSON.parse(String(row.data_json))
    }));

  return buildLegacyTimelineEntries(events);
}
