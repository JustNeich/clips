import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
  ChannelPublication,
  ChannelPublicationEvent,
  ChannelPublicationSummary,
  ChannelPublishIntegration,
  ChannelPublishIntegrationOption,
  ChannelPublishSettings
} from "../app/components/types";
import { decryptJsonPayload, encryptJsonPayload } from "./app-crypto";
import {
  buildCustomPublicationCandidateFromUtcIso,
  DEFAULT_CHANNEL_PUBLISH_SETTINGS,
  normalizeChannelPublishSettings,
  parseChannelPublicationTagsJson,
  stringifyChannelPublicationTags
} from "./channel-publishing";
import { getDb, newId, nowIso, runInTransaction } from "./db/client";
import { PublicationMutationError } from "./publication-mutation-errors";
import {
  isRenderExportArtifactPath,
  persistRenderExportArtifact
} from "./render-export-artifacts";
import { getStage3Job } from "./stage3-job-store";
import { tryAppendFlowAuditEvent } from "./audit-log-store";

export type StoredYoutubeCredential = {
  refreshToken: string;
  accessToken: string | null;
  expiryDate: string | null;
  tokenType: string | null;
  scopes: string[];
};

type PublishSettingsRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  timezone: string;
  first_slot_local_time: string;
  daily_slot_count: number;
  slot_interval_minutes: number;
  auto_queue_enabled: number;
  upload_lead_minutes: number;
  notify_subscribers_default: number;
  created_at: string;
  updated_at: string;
};

type PublishIntegrationRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  provider: string;
  status: string;
  encrypted_token_json: string | null;
  google_account_email: string | null;
  selected_youtube_channel_id: string | null;
  selected_youtube_channel_title: string | null;
  selected_youtube_channel_custom_url: string | null;
  available_channels_json: string | null;
  scopes_json: string | null;
  connected_by_user_id: string | null;
  connected_at: string | null;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type OAuthStateRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  user_id: string;
  state_token_hash: string;
  expires_at: string;
  created_at: string;
};

type RenderExportRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  chat_id: string;
  stage3_job_id: string;
  artifact_file_name: string;
  artifact_file_path: string;
  artifact_mime_type: string;
  artifact_size_bytes: number;
  render_title: string | null;
  source_url: string;
  snapshot_json: string;
  created_by_user_id: string;
  created_at: string;
};

type ChannelPublicationRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  chat_id: string;
  render_export_id: string;
  provider: string;
  status: string;
  schedule_mode: string;
  scheduled_at: string;
  upload_ready_at: string;
  slot_date: string;
  slot_index: number;
  title: string;
  description: string;
  tags_json: string;
  notify_subscribers: number;
  needs_review: number;
  title_manual: number;
  description_manual: number;
  tags_manual: number;
  schedule_manual: number;
  youtube_video_id: string | null;
  youtube_video_url: string | null;
  published_at: string | null;
  canceled_at: string | null;
  last_error: string | null;
  attempts: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  upload_session_url: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  render_file_name?: string;
  source_url?: string;
  chat_title?: string;
};

type ChannelPublicationEventRow = {
  id: string;
  publication_id: string;
  level: string;
  message: string;
  created_at: string;
};

export type RenderExportRecord = {
  id: string;
  workspaceId: string;
  channelId: string;
  chatId: string;
  stage3JobId: string;
  artifactFileName: string;
  artifactFilePath: string;
  artifactMimeType: string;
  artifactSizeBytes: number;
  renderTitle: string | null;
  sourceUrl: string;
  snapshotJson: string;
  createdByUserId: string;
  createdAt: string;
};

export type ClaimedChannelPublication = {
  publication: ChannelPublication;
  leaseToken: string;
  leaseExpiresAt: string;
};

export type ChannelPublicationProcessingState = {
  publicationId: string;
  status: ChannelPublication["status"];
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  uploadSessionUrl: string | null;
  youtubeVideoId: string | null;
  youtubeVideoUrl: string | null;
};

function hashStateToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseOptionsJson(value: string | null | undefined): ChannelPublishIntegrationOption[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        const candidate = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
        const id = typeof candidate?.id === "string" ? candidate.id.trim() : "";
        const title = typeof candidate?.title === "string" ? candidate.title.trim() : "";
        if (!id || !title) {
          return null;
        }
        return {
          id,
          title,
          customUrl:
            typeof candidate?.customUrl === "string" && candidate.customUrl.trim()
              ? candidate.customUrl.trim()
              : null
        };
      })
      .filter((item): item is ChannelPublishIntegrationOption => Boolean(item));
  } catch {
    return [];
  }
}

function parseScopesJson(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function mapPublishSettingsRow(row: PublishSettingsRow | null): ChannelPublishSettings {
  if (!row) {
    return DEFAULT_CHANNEL_PUBLISH_SETTINGS;
  }
  return normalizeChannelPublishSettings({
    timezone: row.timezone,
    firstSlotLocalTime: row.first_slot_local_time,
    dailySlotCount: Number(row.daily_slot_count) || DEFAULT_CHANNEL_PUBLISH_SETTINGS.dailySlotCount,
    slotIntervalMinutes:
      Number(row.slot_interval_minutes) || DEFAULT_CHANNEL_PUBLISH_SETTINGS.slotIntervalMinutes,
    autoQueueEnabled: Boolean(row.auto_queue_enabled),
    uploadLeadMinutes: Number(row.upload_lead_minutes) || DEFAULT_CHANNEL_PUBLISH_SETTINGS.uploadLeadMinutes,
    notifySubscribersByDefault: Boolean(row.notify_subscribers_default)
  });
}

function mapPublishIntegrationRow(row: PublishIntegrationRow | null): ChannelPublishIntegration | null {
  if (!row) {
    return null;
  }
  return {
    provider: "youtube",
    status:
      row.status === "pending_selection" ||
      row.status === "connected" ||
      row.status === "reauth_required" ||
      row.status === "error"
        ? row.status
        : "disconnected",
    connectedAt: row.connected_at ?? null,
    updatedAt: row.updated_at,
    selectedYoutubeChannelId: row.selected_youtube_channel_id ?? null,
    selectedYoutubeChannelTitle: row.selected_youtube_channel_title ?? null,
    selectedYoutubeChannelCustomUrl: row.selected_youtube_channel_custom_url ?? null,
    selectedGoogleAccountEmail: row.google_account_email ?? null,
    availableChannels: parseOptionsJson(row.available_channels_json),
    scopes: parseScopesJson(row.scopes_json),
    lastVerifiedAt: row.last_verified_at ?? null,
    lastError: row.last_error ?? null
  };
}

function mapRenderExportRow(row: RenderExportRow | null): RenderExportRecord | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    channelId: row.channel_id,
    chatId: row.chat_id,
    stage3JobId: row.stage3_job_id,
    artifactFileName: row.artifact_file_name,
    artifactFilePath: row.artifact_file_path,
    artifactMimeType: row.artifact_mime_type,
    artifactSizeBytes: Number(row.artifact_size_bytes) || 0,
    renderTitle: row.render_title ?? null,
    sourceUrl: row.source_url,
    snapshotJson: row.snapshot_json,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at
  };
}

function mapPublicationEventRow(row: ChannelPublicationEventRow): ChannelPublicationEvent {
  return {
    id: row.id,
    publicationId: row.publication_id,
    level: row.level === "warn" || row.level === "error" ? row.level : "info",
    message: row.message,
    createdAt: row.created_at
  };
}

function mapChannelPublicationRow(
  row: ChannelPublicationRow,
  events: ChannelPublicationEvent[] = []
): ChannelPublication {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    channelId: row.channel_id,
    chatId: row.chat_id,
    renderExportId: row.render_export_id,
    status:
      row.status === "uploading" ||
      row.status === "scheduled" ||
      row.status === "published" ||
      row.status === "failed" ||
      row.status === "paused" ||
      row.status === "canceled"
        ? row.status
        : "queued",
    scheduleMode: row.schedule_mode === "custom" ? "custom" : "slot",
    scheduledAt: row.scheduled_at,
    uploadReadyAt: row.upload_ready_at,
    slotDate: row.slot_date,
    slotIndex: Number(row.slot_index) || 0,
    title: row.title,
    description: row.description,
    tags: parseChannelPublicationTagsJson(row.tags_json),
    notifySubscribers: Boolean(row.notify_subscribers),
    needsReview: Boolean(row.needs_review),
    titleManual: Boolean(row.title_manual),
    descriptionManual: Boolean(row.description_manual),
    tagsManual: Boolean(row.tags_manual),
    scheduleManual: Boolean(row.schedule_manual),
    youtubeVideoId: row.youtube_video_id ?? null,
    youtubeVideoUrl: row.youtube_video_url ?? null,
    publishedAt: row.published_at ?? null,
    canceledAt: row.canceled_at ?? null,
    lastError: row.last_error ?? null,
    renderFileName: row.render_file_name ?? "video.mp4",
    sourceUrl: row.source_url ?? "",
    chatTitle: row.chat_title ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events
  };
}

function readPublicationEvents(publicationId: string): ChannelPublicationEvent[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM channel_publication_events WHERE publication_id = ? ORDER BY created_at ASC")
    .all(publicationId) as ChannelPublicationEventRow[];
  return rows.map(mapPublicationEventRow);
}

function readPublicationEventsByPublicationIds(publicationIds: string[]): Map<string, ChannelPublicationEvent[]> {
  const ids = Array.from(new Set(publicationIds.map((item) => item.trim()).filter(Boolean)));
  const byPublicationId = new Map<string, ChannelPublicationEvent[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) {
    return byPublicationId;
  }

  const placeholders = ids.map(() => "?").join(", ");
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
         FROM channel_publication_events
        WHERE publication_id IN (${placeholders})
        ORDER BY created_at ASC`
    )
    .all(...ids) as ChannelPublicationEventRow[];
  for (const row of rows) {
    const events = byPublicationId.get(row.publication_id) ?? [];
    events.push(mapPublicationEventRow(row));
    byPublicationId.set(row.publication_id, events);
  }
  return byPublicationId;
}

function readPublishSettingsRow(channelId: string): PublishSettingsRow | null {
  const db = getDb();
  return (
    (db
      .prepare("SELECT * FROM channel_publish_settings WHERE channel_id = ? LIMIT 1")
      .get(channelId) as PublishSettingsRow | undefined) ?? null
  );
}

function readPublishIntegrationRow(channelId: string): PublishIntegrationRow | null {
  const db = getDb();
  return (
    (db
      .prepare("SELECT * FROM channel_publish_integrations WHERE channel_id = ? LIMIT 1")
      .get(channelId) as PublishIntegrationRow | undefined) ?? null
  );
}

export function getChannelPublishSettings(channelId: string): ChannelPublishSettings {
  return mapPublishSettingsRow(readPublishSettingsRow(channelId));
}

export function ensureChannelPublishSettings(input: {
  workspaceId: string;
  channelId: string;
  userId?: string | null;
}): ChannelPublishSettings {
  const existing = readPublishSettingsRow(input.channelId);
  if (existing) {
    return mapPublishSettingsRow(existing);
  }
  const now = nowIso();
  const db = getDb();
  db.prepare(
    `INSERT INTO channel_publish_settings
      (id, workspace_id, channel_id, timezone, first_slot_local_time, daily_slot_count, slot_interval_minutes, auto_queue_enabled, upload_lead_minutes, notify_subscribers_default, created_at, updated_at, updated_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    input.workspaceId,
    input.channelId,
    DEFAULT_CHANNEL_PUBLISH_SETTINGS.timezone,
    DEFAULT_CHANNEL_PUBLISH_SETTINGS.firstSlotLocalTime,
    DEFAULT_CHANNEL_PUBLISH_SETTINGS.dailySlotCount,
    DEFAULT_CHANNEL_PUBLISH_SETTINGS.slotIntervalMinutes,
    DEFAULT_CHANNEL_PUBLISH_SETTINGS.autoQueueEnabled ? 1 : 0,
    DEFAULT_CHANNEL_PUBLISH_SETTINGS.uploadLeadMinutes,
    DEFAULT_CHANNEL_PUBLISH_SETTINGS.notifySubscribersByDefault ? 1 : 0,
    now,
    now,
    input.userId ?? null
  );
  return DEFAULT_CHANNEL_PUBLISH_SETTINGS;
}

export function upsertChannelPublishSettings(input: {
  workspaceId: string;
  channelId: string;
  userId: string;
  patch: Partial<ChannelPublishSettings>;
}): ChannelPublishSettings {
  const current = ensureChannelPublishSettings(input);
  const next = normalizeChannelPublishSettings({
    ...current,
    ...input.patch
  });
  const now = nowIso();
  const db = getDb();
  db.prepare(
    `UPDATE channel_publish_settings
        SET timezone = ?,
            first_slot_local_time = ?,
            daily_slot_count = ?,
            slot_interval_minutes = ?,
            auto_queue_enabled = ?,
            upload_lead_minutes = ?,
            notify_subscribers_default = ?,
            updated_at = ?,
            updated_by_user_id = ?
      WHERE channel_id = ?`
  ).run(
    next.timezone,
    next.firstSlotLocalTime,
    next.dailySlotCount,
    next.slotIntervalMinutes,
    next.autoQueueEnabled ? 1 : 0,
    next.uploadLeadMinutes,
    next.notifySubscribersByDefault ? 1 : 0,
    now,
    input.userId,
    input.channelId
  );
  return next;
}

export function getChannelPublishIntegration(channelId: string): ChannelPublishIntegration | null {
  return mapPublishIntegrationRow(readPublishIntegrationRow(channelId));
}

export function getStoredChannelPublishCredential(channelId: string): StoredYoutubeCredential | null {
  const row = readPublishIntegrationRow(channelId);
  return decryptJsonPayload<StoredYoutubeCredential>(row?.encrypted_token_json ?? null);
}

export function saveChannelPublishIntegration(input: {
  workspaceId: string;
  channelId: string;
  userId: string;
  status: ChannelPublishIntegration["status"];
  credential: StoredYoutubeCredential | null;
  googleAccountEmail: string | null;
  selectedYoutubeChannelId: string | null;
  selectedYoutubeChannelTitle: string | null;
  selectedYoutubeChannelCustomUrl: string | null;
  availableChannels: ChannelPublishIntegrationOption[];
  scopes: string[];
  lastVerifiedAt?: string | null;
  lastError?: string | null;
}): ChannelPublishIntegration {
  const current = readPublishIntegrationRow(input.channelId);
  const now = nowIso();
  const encrypted =
    input.credential !== null ? encryptJsonPayload(input.credential) : current?.encrypted_token_json ?? null;
  const db = getDb();

  if (current) {
    db.prepare(
      `UPDATE channel_publish_integrations
          SET status = ?,
              encrypted_token_json = ?,
              google_account_email = ?,
              selected_youtube_channel_id = ?,
              selected_youtube_channel_title = ?,
              selected_youtube_channel_custom_url = ?,
              available_channels_json = ?,
              scopes_json = ?,
              connected_by_user_id = ?,
              connected_at = COALESCE(connected_at, ?),
              last_verified_at = ?,
              last_error = ?,
              updated_at = ?
        WHERE channel_id = ?`
    ).run(
      input.status,
      encrypted,
      input.googleAccountEmail,
      input.selectedYoutubeChannelId,
      input.selectedYoutubeChannelTitle,
      input.selectedYoutubeChannelCustomUrl,
      JSON.stringify(input.availableChannels),
      JSON.stringify(input.scopes),
      input.userId,
      now,
      input.lastVerifiedAt ?? now,
      input.lastError ?? null,
      now,
      input.channelId
    );
  } else {
    db.prepare(
      `INSERT INTO channel_publish_integrations
        (id, workspace_id, channel_id, provider, status, encrypted_token_json, google_account_email, selected_youtube_channel_id, selected_youtube_channel_title, selected_youtube_channel_custom_url, available_channels_json, scopes_json, connected_by_user_id, connected_at, last_verified_at, last_error, created_at, updated_at)
        VALUES (?, ?, ?, 'youtube', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId(),
      input.workspaceId,
      input.channelId,
      input.status,
      encrypted,
      input.googleAccountEmail,
      input.selectedYoutubeChannelId,
      input.selectedYoutubeChannelTitle,
      input.selectedYoutubeChannelCustomUrl,
      JSON.stringify(input.availableChannels),
      JSON.stringify(input.scopes),
      input.userId,
      now,
      input.lastVerifiedAt ?? now,
      input.lastError ?? null,
      now,
      now
    );
  }

  return getChannelPublishIntegration(input.channelId) ?? {
    provider: "youtube",
    status: input.status,
    connectedAt: now,
    updatedAt: now,
    selectedYoutubeChannelId: input.selectedYoutubeChannelId,
    selectedYoutubeChannelTitle: input.selectedYoutubeChannelTitle,
    selectedYoutubeChannelCustomUrl: input.selectedYoutubeChannelCustomUrl,
    selectedGoogleAccountEmail: input.googleAccountEmail,
    availableChannels: input.availableChannels,
    scopes: input.scopes,
    lastVerifiedAt: input.lastVerifiedAt ?? now,
    lastError: input.lastError ?? null
  };
}

export function updateStoredChannelPublishCredential(
  channelId: string,
  credential: StoredYoutubeCredential
): void {
  const db = getDb();
  db.prepare(
    `UPDATE channel_publish_integrations
        SET encrypted_token_json = ?,
            last_verified_at = ?,
            updated_at = ?
      WHERE channel_id = ?`
  ).run(encryptJsonPayload(credential), nowIso(), nowIso(), channelId);
}

export function updateChannelPublishIntegrationSelection(input: {
  channelId: string;
  selectedYoutubeChannelId: string;
  selectedYoutubeChannelTitle: string;
  selectedYoutubeChannelCustomUrl: string | null;
}): ChannelPublishIntegration {
  const db = getDb();
  db.prepare(
    `UPDATE channel_publish_integrations
        SET status = 'connected',
            selected_youtube_channel_id = ?,
            selected_youtube_channel_title = ?,
            selected_youtube_channel_custom_url = ?,
            updated_at = ?,
            last_error = NULL
      WHERE channel_id = ?`
  ).run(
    input.selectedYoutubeChannelId,
    input.selectedYoutubeChannelTitle,
    input.selectedYoutubeChannelCustomUrl,
    nowIso(),
    input.channelId
  );
  return getChannelPublishIntegration(input.channelId)!;
}

export function markChannelPublishIntegrationError(channelId: string, errorMessage: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE channel_publish_integrations
        SET status = 'error',
            last_error = ?,
            updated_at = ?
      WHERE channel_id = ?`
  ).run(errorMessage, nowIso(), channelId);
}

export function markChannelPublishIntegrationReauthRequired(channelId: string, errorMessage: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE channel_publish_integrations
        SET status = 'reauth_required',
            last_error = ?,
            updated_at = ?
      WHERE channel_id = ?`
  ).run(errorMessage, nowIso(), channelId);
}

export function deleteChannelPublishIntegration(channelId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM channel_publish_integrations WHERE channel_id = ?").run(channelId);
}

export function createChannelYoutubeOAuthState(input: {
  workspaceId: string;
  channelId: string;
  userId: string;
  ttlMs?: number;
}): { state: string; expiresAt: string } {
  const ttlMs = Math.max(60_000, Math.min(30 * 60_000, input.ttlMs ?? 10 * 60_000));
  const state = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO channel_youtube_oauth_states
      (id, workspace_id, channel_id, user_id, state_token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    input.workspaceId,
    input.channelId,
    input.userId,
    hashStateToken(state),
    expiresAt,
    nowIso()
  );
  return { state, expiresAt };
}

export function consumeChannelYoutubeOAuthState(state: string): OAuthStateRow | null {
  const hash = hashStateToken(state);
  return runInTransaction((db) => {
    const row = db
      .prepare("SELECT * FROM channel_youtube_oauth_states WHERE state_token_hash = ? LIMIT 1")
      .get(hash) as OAuthStateRow | undefined;
    if (!row) {
      return null;
    }
    db.prepare("DELETE FROM channel_youtube_oauth_states WHERE id = ?").run(row.id);
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return null;
    }
    return row;
  });
}

export function pruneExpiredChannelYoutubeOAuthStates(): void {
  const db = getDb();
  db.prepare("DELETE FROM channel_youtube_oauth_states WHERE expires_at <= ?").run(nowIso());
}

export function getRenderExportByStage3JobId(stage3JobId: string): RenderExportRecord | null {
  const db = getDb();
  return mapRenderExportRow(
    (db
      .prepare("SELECT * FROM render_exports WHERE stage3_job_id = ? LIMIT 1")
      .get(stage3JobId) as RenderExportRow | undefined) ?? null
  );
}

function updateRenderExportArtifact(input: {
  renderExportId: string;
  artifactFileName: string;
  artifactFilePath: string;
  artifactMimeType: string;
  artifactSizeBytes: number;
}): RenderExportRecord | null {
  const db = getDb();
  db.prepare(
    `UPDATE render_exports
        SET artifact_file_name = ?,
            artifact_file_path = ?,
            artifact_mime_type = ?,
            artifact_size_bytes = ?
      WHERE id = ?`
  ).run(
    input.artifactFileName,
    input.artifactFilePath,
    input.artifactMimeType,
    input.artifactSizeBytes,
    input.renderExportId
  );
  return getRenderExportById(input.renderExportId);
}

export function getRenderExportById(renderExportId: string): RenderExportRecord | null {
  const db = getDb();
  return mapRenderExportRow(
    (db.prepare("SELECT * FROM render_exports WHERE id = ? LIMIT 1").get(renderExportId) as RenderExportRow | undefined) ??
      null
  );
}

export function createRenderExport(input: {
  workspaceId: string;
  channelId: string;
  chatId: string;
  stage3JobId: string;
  artifactFileName: string;
  artifactFilePath: string;
  artifactMimeType: string;
  artifactSizeBytes: number;
  renderTitle: string | null;
  sourceUrl: string;
  snapshotJson: string;
  createdByUserId: string;
}): RenderExportRecord {
  const existing = getRenderExportByStage3JobId(input.stage3JobId);
  if (existing) {
    if (
      existing.artifactFileName !== input.artifactFileName ||
      existing.artifactFilePath !== input.artifactFilePath ||
      existing.artifactMimeType !== input.artifactMimeType ||
      existing.artifactSizeBytes !== input.artifactSizeBytes ||
      !existsSync(existing.artifactFilePath)
    ) {
      return (
        updateRenderExportArtifact({
          renderExportId: existing.id,
          artifactFileName: input.artifactFileName,
          artifactFilePath: input.artifactFilePath,
          artifactMimeType: input.artifactMimeType,
          artifactSizeBytes: input.artifactSizeBytes
        }) ?? existing
      );
    }
    return existing;
  }
  const record: RenderExportRecord = {
    id: newId(),
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: input.chatId,
    stage3JobId: input.stage3JobId,
    artifactFileName: input.artifactFileName,
    artifactFilePath: input.artifactFilePath,
    artifactMimeType: input.artifactMimeType,
    artifactSizeBytes: input.artifactSizeBytes,
    renderTitle: input.renderTitle,
    sourceUrl: input.sourceUrl,
    snapshotJson: input.snapshotJson,
    createdByUserId: input.createdByUserId,
    createdAt: nowIso()
  };
  const db = getDb();
  db.prepare(
    `INSERT INTO render_exports
      (id, workspace_id, channel_id, chat_id, stage3_job_id, artifact_file_name, artifact_file_path, artifact_mime_type, artifact_size_bytes, render_title, source_url, snapshot_json, created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.workspaceId,
    record.channelId,
    record.chatId,
    record.stage3JobId,
    record.artifactFileName,
    record.artifactFilePath,
    record.artifactMimeType,
    record.artifactSizeBytes,
    record.renderTitle,
    record.sourceUrl,
    record.snapshotJson,
    record.createdByUserId,
    record.createdAt
  );
  return record;
}

export async function ensureRenderExportArtifactAvailable(
  renderExportId: string
): Promise<RenderExportRecord | null> {
  const current = getRenderExportById(renderExportId);
  if (!current) {
    return null;
  }

  if (current.artifactFilePath && existsSync(current.artifactFilePath)) {
    if (isRenderExportArtifactPath(current.artifactFilePath)) {
      return current;
    }
    const persisted = await persistRenderExportArtifact({
      stage3JobId: current.stage3JobId,
      sourcePath: current.artifactFilePath,
      fileName: current.artifactFileName
    });
    return updateRenderExportArtifact({
      renderExportId: current.id,
      artifactFileName: current.artifactFileName,
      artifactFilePath: persisted.filePath,
      artifactMimeType: current.artifactMimeType,
      artifactSizeBytes: persisted.sizeBytes
    });
  }

  const job = getStage3Job(current.stage3JobId);
  if (!job?.artifactFilePath || !job.artifact || !existsSync(job.artifactFilePath)) {
    return null;
  }

  const persisted = await persistRenderExportArtifact({
    stage3JobId: current.stage3JobId,
    sourcePath: job.artifactFilePath,
    fileName: current.artifactFileName || job.artifact.fileName
  });
  return updateRenderExportArtifact({
    renderExportId: current.id,
    artifactFileName: current.artifactFileName || job.artifact.fileName,
    artifactFilePath: persisted.filePath,
    artifactMimeType: current.artifactMimeType || job.artifact.mimeType,
    artifactSizeBytes: persisted.sizeBytes
  });
}

export function appendChannelPublicationEvent(
  publicationId: string,
  level: "info" | "warn" | "error",
  message: string
): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO channel_publication_events (id, publication_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(newId(), publicationId, level, message, nowIso());
}

function auditChannelPublication(
  action: string,
  publication: ChannelPublication,
  status: "queued" | "running" | "scheduled" | "published" | "failed" | "paused" | "resumed" | "edited" | "canceled",
  options?: {
    userId?: string | null;
    severity?: "info" | "warn" | "error";
    payload?: Record<string, unknown>;
  }
): void {
  tryAppendFlowAuditEvent({
    workspaceId: publication.workspaceId,
    userId: options?.userId ?? null,
    action,
    entityType: "publication",
    entityId: publication.id,
    channelId: publication.channelId,
    chatId: publication.chatId,
    correlationId: publication.id,
    stage: "publishing",
    status,
    severity: options?.severity ?? (status === "failed" ? "error" : "info"),
    payload: {
      title: publication.title,
      status: publication.status,
      scheduleMode: publication.scheduleMode,
      scheduledAt: publication.scheduledAt,
      youtubeVideoId: publication.youtubeVideoId,
      youtubeVideoUrl: publication.youtubeVideoUrl,
      renderExportId: publication.renderExportId,
      sourceUrl: publication.sourceUrl,
      lastError: publication.lastError,
      ...options?.payload
    },
    createdAt: publication.updatedAt
  });
}

function readPublicationRow(publicationId: string): ChannelPublicationRow | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `SELECT p.*, r.artifact_file_name as render_file_name, r.source_url as source_url, t.title as chat_title
           FROM channel_publications p
           JOIN render_exports r ON r.id = p.render_export_id
           JOIN chat_threads t ON t.id = p.chat_id
          WHERE p.id = ?
          LIMIT 1`
      )
      .get(publicationId) as ChannelPublicationRow | undefined) ?? null
  );
}

export function getChannelPublicationById(publicationId: string): ChannelPublication | null {
  const row = readPublicationRow(publicationId);
  return row ? mapChannelPublicationRow(row, readPublicationEvents(publicationId)) : null;
}

export function getChannelPublicationProcessingState(
  publicationId: string
): ChannelPublicationProcessingState | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, status, lease_token, lease_expires_at, upload_session_url, youtube_video_id, youtube_video_url
         FROM channel_publications
        WHERE id = ?
        LIMIT 1`
    )
    .get(publicationId) as
    | {
        id?: string;
        status?: string;
        lease_token?: string | null;
        lease_expires_at?: string | null;
        upload_session_url?: string | null;
        youtube_video_id?: string | null;
        youtube_video_url?: string | null;
      }
    | undefined;
  if (!row?.id) {
    return null;
  }
  return {
    publicationId: row.id,
    status:
      row.status === "uploading" ||
      row.status === "scheduled" ||
      row.status === "published" ||
      row.status === "failed" ||
      row.status === "paused" ||
      row.status === "canceled"
        ? row.status
        : "queued",
    leaseToken: row.lease_token ?? null,
    leaseExpiresAt: row.lease_expires_at ?? null,
    uploadSessionUrl:
      typeof row.upload_session_url === "string" && row.upload_session_url.trim()
        ? row.upload_session_url.trim()
        : null,
    youtubeVideoId: row.youtube_video_id ?? null,
    youtubeVideoUrl: row.youtube_video_url ?? null
  };
}

export function findLatestPublicationForRenderExport(renderExportId: string): ChannelPublication | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.*, r.artifact_file_name as render_file_name, r.source_url as source_url, t.title as chat_title
         FROM channel_publications p
         JOIN render_exports r ON r.id = p.render_export_id
         JOIN chat_threads t ON t.id = p.chat_id
        WHERE p.render_export_id = ?
        ORDER BY p.updated_at DESC
        LIMIT 1`
    )
    .get(renderExportId) as ChannelPublicationRow | undefined;
  return row ? mapChannelPublicationRow(row, readPublicationEvents(row.id)) : null;
}

export function listChannelPublications(channelId: string): ChannelPublication[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*, r.artifact_file_name as render_file_name, r.source_url as source_url, t.title as chat_title
         FROM channel_publications p
         JOIN render_exports r ON r.id = p.render_export_id
         JOIN chat_threads t ON t.id = p.chat_id
        WHERE p.channel_id = ? AND p.status != 'canceled'
        ORDER BY p.scheduled_at ASC, p.created_at ASC`
    )
    .all(channelId) as ChannelPublicationRow[];
  const eventsByPublicationId = readPublicationEventsByPublicationIds(rows.map((row) => row.id));
  return rows.map((row) => mapChannelPublicationRow(row, eventsByPublicationId.get(row.id) ?? []));
}

export function listFutureActivePublicationsForChannel(channelId: string): ChannelPublication[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*, r.artifact_file_name as render_file_name, r.source_url as source_url, t.title as chat_title
         FROM channel_publications p
         JOIN render_exports r ON r.id = p.render_export_id
         JOIN chat_threads t ON t.id = p.chat_id
        WHERE p.channel_id = ?
          AND p.status != 'canceled'
          AND p.status != 'published'
          AND p.scheduled_at >= ?
        ORDER BY p.scheduled_at ASC`
    )
    .all(channelId, nowIso()) as ChannelPublicationRow[];
  return rows.map((row) => mapChannelPublicationRow(row));
}

export function listLatestPublicationSummariesByChatIds(chatIds: string[]): Map<string, ChannelPublicationSummary> {
  const trimmed = chatIds.map((item) => item.trim()).filter(Boolean);
  if (trimmed.length === 0) {
    return new Map();
  }
  const placeholders = trimmed.map(() => "?").join(", ");
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*
         FROM channel_publications p
         JOIN (
           SELECT chat_id, MAX(updated_at) AS max_updated_at
             FROM channel_publications
            WHERE chat_id IN (${placeholders}) AND status != 'canceled'
            GROUP BY chat_id
         ) latest
           ON latest.chat_id = p.chat_id
          AND latest.max_updated_at = p.updated_at`
    )
    .all(...trimmed) as ChannelPublicationRow[];

  return new Map(
    rows.map((row) => [
      row.chat_id,
      {
        id: row.id,
        status:
          row.status === "uploading" ||
          row.status === "scheduled" ||
          row.status === "published" ||
          row.status === "failed" ||
          row.status === "paused" ||
          row.status === "canceled"
            ? row.status
            : "queued",
        scheduledAt: row.scheduled_at,
        needsReview: Boolean(row.needs_review),
        youtubeVideoUrl: row.youtube_video_url ?? null,
        lastError: row.last_error ?? null
      } satisfies ChannelPublicationSummary
    ])
  );
}

export function findLatestReusablePublicationForChat(chatId: string): ChannelPublication | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.*, r.artifact_file_name as render_file_name, r.source_url as source_url, t.title as chat_title
         FROM channel_publications p
         JOIN render_exports r ON r.id = p.render_export_id
         JOIN chat_threads t ON t.id = p.chat_id
        WHERE p.chat_id = ?
          AND p.status IN ('queued', 'paused', 'failed')
        ORDER BY p.updated_at DESC
        LIMIT 1`
    )
    .get(chatId) as ChannelPublicationRow | undefined;
  return row ? mapChannelPublicationRow(row, readPublicationEvents(row.id)) : null;
}

export function findLatestPublicationForChat(chatId: string): ChannelPublication | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.*, r.artifact_file_name as render_file_name, r.source_url as source_url, t.title as chat_title
         FROM channel_publications p
         JOIN render_exports r ON r.id = p.render_export_id
         JOIN chat_threads t ON t.id = p.chat_id
        WHERE p.chat_id = ?
          AND p.status != 'canceled'
        ORDER BY CASE
          WHEN p.status IN ('queued', 'uploading', 'paused', 'failed', 'scheduled') THEN 0
          ELSE 1
        END ASC, p.updated_at DESC
        LIMIT 1`
    )
    .get(chatId) as ChannelPublicationRow | undefined;
  return row ? mapChannelPublicationRow(row, readPublicationEvents(row.id)) : null;
}

export function createChannelPublication(input: {
  workspaceId: string;
  channelId: string;
  chatId: string;
  renderExportId: string;
  scheduleMode: ChannelPublication["scheduleMode"];
  scheduledAt: string;
  uploadReadyAt: string;
  slotDate: string;
  slotIndex: number;
  title: string;
  description: string;
  tags: string[];
  notifySubscribers: boolean;
  needsReview: boolean;
  titleManual?: boolean;
  descriptionManual?: boolean;
  tagsManual?: boolean;
  scheduleManual?: boolean;
  createdByUserId: string;
}): ChannelPublication {
  const publicationId = newId();
  const createdAt = nowIso();
  const db = getDb();
  db.prepare(
    `INSERT INTO channel_publications
      (id, workspace_id, channel_id, chat_id, render_export_id, provider, status, schedule_mode, scheduled_at, upload_ready_at, slot_date, slot_index, title, description, tags_json, notify_subscribers, needs_review, title_manual, description_manual, tags_manual, schedule_manual, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'youtube', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    publicationId,
    input.workspaceId,
    input.channelId,
    input.chatId,
    input.renderExportId,
    input.scheduleMode,
    input.scheduledAt,
    input.uploadReadyAt,
    input.slotDate,
    input.slotIndex,
    input.title,
    input.description,
    stringifyChannelPublicationTags(input.tags),
    input.notifySubscribers ? 1 : 0,
    input.needsReview ? 1 : 0,
    input.titleManual ? 1 : 0,
    input.descriptionManual ? 1 : 0,
    input.tagsManual ? 1 : 0,
    input.scheduleManual ? 1 : 0,
    input.createdByUserId,
    createdAt,
    createdAt
  );
  appendChannelPublicationEvent(publicationId, "info", "Публикация поставлена в очередь.");
  const publication = getChannelPublicationById(publicationId)!;
  auditChannelPublication("publication.queued", publication, "queued", {
    userId: input.createdByUserId
  });
  return publication;
}

function getPublicationForMutation(publicationId: string): ChannelPublication {
  const current = getChannelPublicationById(publicationId);
  if (!current) {
    throw new PublicationMutationError("Публикация не найдена.", {
      code: "PUBLICATION_NOT_FOUND",
      status: 404
    });
  }
  return current;
}

function assertPublicationNotUploading(publication: ChannelPublication, actionLabel: string): void {
  if (publication.status === "uploading") {
    throw new PublicationMutationError(
      `${actionLabel} недоступно, пока ролик загружается в YouTube. Дождитесь завершения текущей загрузки, чтобы не создать дубль.`,
      {
        code: "PUBLICATION_UPLOAD_IN_PROGRESS"
      }
    );
  }
}

export function updateChannelPublicationDraft(input: {
  publicationId: string;
  title?: string;
  description?: string;
  tags?: string[];
  notifySubscribers?: boolean;
  needsReview?: boolean;
  titleManual?: boolean;
  descriptionManual?: boolean;
  tagsManual?: boolean;
  scheduleMode?: ChannelPublication["scheduleMode"];
  scheduledAt?: string;
  uploadReadyAt?: string;
  slotDate?: string;
  slotIndex?: number;
  scheduleManual?: boolean;
  renderExportId?: string;
  clearLastError?: boolean;
}): ChannelPublication {
  const current = getPublicationForMutation(input.publicationId);
  assertPublicationNotUploading(current, "Редактирование публикации");
  const db = getDb();
  db.prepare(
    `UPDATE channel_publications
        SET render_export_id = ?,
            title = ?,
            description = ?,
            tags_json = ?,
            notify_subscribers = ?,
            needs_review = ?,
            title_manual = ?,
            description_manual = ?,
            tags_manual = ?,
            schedule_mode = ?,
            scheduled_at = ?,
            upload_ready_at = ?,
            slot_date = ?,
            slot_index = ?,
            schedule_manual = ?,
            last_error = ?,
            status = CASE
              WHEN status IN ('failed', 'paused') THEN 'queued'
              ELSE status
            END,
            updated_at = ?,
            canceled_at = CASE WHEN status = 'canceled' THEN NULL ELSE canceled_at END
      WHERE id = ?`
  ).run(
    input.renderExportId ?? current.renderExportId,
    input.title ?? current.title,
    input.description ?? current.description,
    stringifyChannelPublicationTags(input.tags ?? current.tags),
    typeof input.notifySubscribers === "boolean"
      ? input.notifySubscribers ? 1 : 0
      : current.notifySubscribers ? 1 : 0,
    typeof input.needsReview === "boolean" ? (input.needsReview ? 1 : 0) : current.needsReview ? 1 : 0,
    typeof input.titleManual === "boolean" ? (input.titleManual ? 1 : 0) : current.titleManual ? 1 : 0,
    typeof input.descriptionManual === "boolean"
      ? input.descriptionManual ? 1 : 0
      : current.descriptionManual ? 1 : 0,
    typeof input.tagsManual === "boolean" ? (input.tagsManual ? 1 : 0) : current.tagsManual ? 1 : 0,
    input.scheduleMode ?? current.scheduleMode,
    input.scheduledAt ?? current.scheduledAt,
    input.uploadReadyAt ?? current.uploadReadyAt,
    input.slotDate ?? current.slotDate,
    typeof input.slotIndex === "number" ? input.slotIndex : current.slotIndex,
    typeof input.scheduleManual === "boolean"
      ? input.scheduleManual ? 1 : 0
      : current.scheduleManual ? 1 : 0,
    input.clearLastError ? null : current.lastError,
    nowIso(),
    input.publicationId
  );
  const publication = getChannelPublicationById(input.publicationId)!;
  auditChannelPublication("publication.edited", publication, "edited");
  return publication;
}

export function pauseChannelPublication(publicationId: string): ChannelPublication {
  const current = getPublicationForMutation(publicationId);
  assertPublicationNotUploading(current, "Пауза публикации");
  if (current.status === "paused") {
    return current;
  }
  if (current.status === "published" || current.status === "canceled") {
    throw new PublicationMutationError("Эту публикацию больше нельзя поставить на паузу.", {
      code: "PUBLICATION_ACTION_FORBIDDEN"
    });
  }
  const db = getDb();
  db.prepare(
    `UPDATE channel_publications
        SET status = 'paused',
            updated_at = ?,
            lease_token = NULL,
            lease_expires_at = NULL
      WHERE id = ?`
  ).run(nowIso(), publicationId);
  appendChannelPublicationEvent(publicationId, "info", "Публикация поставлена на паузу.");
  const publication = getChannelPublicationById(publicationId)!;
  auditChannelPublication("publication.paused", publication, "paused");
  return publication;
}

export function resumeChannelPublication(publicationId: string): ChannelPublication {
  const current = getPublicationForMutation(publicationId);
  assertPublicationNotUploading(current, "Возобновление публикации");
  if (current.status === "queued" || current.status === "scheduled") {
    return current;
  }
  if (current.status === "published" || current.status === "canceled") {
    throw new PublicationMutationError("Эту публикацию больше нельзя возобновить.", {
      code: "PUBLICATION_ACTION_FORBIDDEN"
    });
  }
  const db = getDb();
  db.prepare(
    `UPDATE channel_publications
        SET status = 'queued',
            last_error = NULL,
            updated_at = ?,
            lease_token = NULL,
            lease_expires_at = NULL
      WHERE id = ?`
  ).run(nowIso(), publicationId);
  appendChannelPublicationEvent(publicationId, "info", "Публикация возобновлена.");
  const publication = getChannelPublicationById(publicationId)!;
  auditChannelPublication("publication.resumed", publication, "resumed");
  return publication;
}

export function retryChannelPublication(publicationId: string): ChannelPublication {
  const current = getPublicationForMutation(publicationId);
  assertPublicationNotUploading(current, "Повтор публикации");
  if (current.status === "queued" || current.status === "scheduled") {
    return current;
  }
  if (current.status === "published" || current.status === "canceled") {
    throw new PublicationMutationError("Эту публикацию больше нельзя поставить на повтор.", {
      code: "PUBLICATION_ACTION_FORBIDDEN"
    });
  }
  const db = getDb();
  db.prepare(
    `UPDATE channel_publications
        SET status = 'queued',
            last_error = NULL,
            youtube_video_id = NULL,
            youtube_video_url = NULL,
            updated_at = ?,
            lease_token = NULL,
            lease_expires_at = NULL
      WHERE id = ?`
  ).run(nowIso(), publicationId);
  appendChannelPublicationEvent(publicationId, "info", "Публикация поставлена на повтор.");
  const publication = getChannelPublicationById(publicationId)!;
  auditChannelPublication("publication.queued", publication, "queued", {
    payload: { reason: "retry" }
  });
  return publication;
}

export function cancelChannelPublication(publicationId: string): ChannelPublication {
  const current = getPublicationForMutation(publicationId);
  assertPublicationNotUploading(current, "Удаление публикации");
  if (current.status === "canceled") {
    return current;
  }
  if (current.status === "published") {
    throw new PublicationMutationError("Опубликованную публикацию нельзя удалить из очереди.", {
      code: "PUBLICATION_ACTION_FORBIDDEN"
    });
  }
  const db = getDb();
  const canceledAt = nowIso();
  db.prepare(
    `UPDATE channel_publications
        SET status = 'canceled',
            canceled_at = ?,
            updated_at = ?,
            lease_token = NULL,
            lease_expires_at = NULL,
            upload_session_url = NULL
      WHERE id = ?`
  ).run(canceledAt, canceledAt, publicationId);
  appendChannelPublicationEvent(publicationId, "info", "Публикация удалена из очереди.");
  const publication = getChannelPublicationById(publicationId)!;
  auditChannelPublication("publication.canceled", publication, "canceled");
  return publication;
}

export function publishNowChannelPublication(publicationId: string): ChannelPublication {
  const current = getPublicationForMutation(publicationId);
  assertPublicationNotUploading(current, "Publish now");
  if (current.status === "published" || current.status === "canceled") {
    return current;
  }
  const now = nowIso();
  const settings = getChannelPublishSettings(current.channelId) ?? DEFAULT_CHANNEL_PUBLISH_SETTINGS;
  const schedule = buildCustomPublicationCandidateFromUtcIso({
    settings,
    scheduledAt: now
  });
  const db = getDb();
  db.prepare(
    `UPDATE channel_publications
        SET schedule_mode = ?,
            scheduled_at = ?,
            upload_ready_at = ?,
            slot_date = ?,
            slot_index = ?,
            schedule_manual = 1,
            status = 'queued',
            last_error = NULL,
            updated_at = ?,
            lease_token = NULL,
            lease_expires_at = NULL
      WHERE id = ?`
  ).run(
    schedule.scheduleMode,
    schedule.scheduledAt,
    schedule.uploadReadyAt,
    schedule.slotDate,
    schedule.slotIndex,
    now,
    publicationId
  );
  appendChannelPublicationEvent(publicationId, "info", "Публикация переведена в publish now.");
  const publication = getChannelPublicationById(publicationId)!;
  auditChannelPublication("publication.queued", publication, "queued", {
    payload: { reason: "publish_now" }
  });
  return publication;
}

export function sweepPublishedChannelPublications(now = nowIso()): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id
         FROM channel_publications
        WHERE status = 'scheduled'
          AND scheduled_at <= ?`
    )
    .all(now) as Array<{ id: string }>;
  const changed = Number(
    db.prepare(
    `UPDATE channel_publications
        SET status = 'published',
            published_at = COALESCE(published_at, scheduled_at),
            updated_at = ?
      WHERE status = 'scheduled'
        AND scheduled_at <= ?`
    ).run(now, now).changes ?? 0
  );
  for (const row of rows) {
    const publication = getChannelPublicationById(String(row.id));
    if (publication?.status === "published") {
      auditChannelPublication("publication.published", publication, "published");
    }
  }
  return changed;
}

export function recoverInterruptedChannelPublications(): number {
  const now = nowIso();
  const db = getDb();
  return Number(
    db.prepare(
    `UPDATE channel_publications
        SET status = 'queued',
            last_error = COALESCE(last_error, 'Процесс публикации был перезапущен.'),
            updated_at = ?,
            lease_token = NULL,
            lease_expires_at = NULL
      WHERE status = 'uploading'
        AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`
    ).run(now, now).changes ?? 0
  );
}

export function getNextChannelPublicationWakeAt(): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.upload_ready_at
         FROM channel_publications p
         JOIN channel_publish_integrations i ON i.channel_id = p.channel_id
        WHERE p.status = 'queued'
          AND i.status = 'connected'
          AND i.selected_youtube_channel_id IS NOT NULL
        ORDER BY p.upload_ready_at ASC
        LIMIT 1`
    )
    .get() as { upload_ready_at?: string | null } | undefined;
  return row?.upload_ready_at ? String(row.upload_ready_at) : null;
}

export function claimNextReadyChannelPublication(input: {
  leaseDurationMs?: number;
}): ClaimedChannelPublication | null {
  const leaseMs = Math.max(5 * 60_000, Math.min(6 * 60 * 60_000, input.leaseDurationMs ?? 30 * 60_000));
  const now = new Date();
  const nowString = now.toISOString();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();

  const claimed = runInTransaction((db) => {
    sweepPublishedChannelPublications(nowString);
    const row = db
      .prepare(
        `SELECT p.id
           FROM channel_publications p
           JOIN channel_publish_integrations i ON i.channel_id = p.channel_id
          WHERE p.status = 'queued'
            AND p.upload_ready_at <= ?
            AND i.status = 'connected'
            AND i.selected_youtube_channel_id IS NOT NULL
          ORDER BY p.upload_ready_at ASC, p.created_at ASC
          LIMIT 1`
      )
      .get(nowString) as { id?: string } | undefined;
    if (!row?.id) {
      return null;
    }
    db.prepare(
      `UPDATE channel_publications
          SET status = 'uploading',
              attempts = attempts + 1,
              lease_token = ?,
              lease_expires_at = ?,
              updated_at = ?
        WHERE id = ?`
    ).run(leaseToken, leaseExpiresAt, nowString, row.id);
    const publication = getChannelPublicationById(String(row.id));
    if (!publication) {
      return null;
    }
    return {
      publication,
      leaseToken,
      leaseExpiresAt
    };
  });
  if (claimed) {
    auditChannelPublication("publication.uploading", claimed.publication, "running", {
      payload: {
        leaseExpiresAt: claimed.leaseExpiresAt
      }
    });
  }
  return claimed;
}

export function extendChannelPublicationLease(input: {
  publicationId: string;
  expectedLeaseToken: string;
  leaseDurationMs?: number;
}): boolean {
  const expectedLeaseToken = input.expectedLeaseToken.trim();
  if (!expectedLeaseToken) {
    return false;
  }
  const leaseMs = Math.max(5 * 60_000, Math.min(6 * 60 * 60_000, input.leaseDurationMs ?? 30 * 60_000));
  const now = new Date();
  const stamp = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE channel_publications
          SET lease_expires_at = ?,
              updated_at = ?
        WHERE id = ?
          AND status = 'uploading'
          AND lease_token = ?`
    )
    .run(leaseExpiresAt, stamp, input.publicationId, expectedLeaseToken);
  return Number(result.changes ?? 0) > 0;
}

export function persistChannelPublicationUploadSession(input: {
  publicationId: string;
  sessionUrl: string;
  expectedLeaseToken: string;
}): boolean {
  const sessionUrl = input.sessionUrl.trim();
  const expectedLeaseToken = input.expectedLeaseToken.trim();
  if (!sessionUrl || !expectedLeaseToken) {
    return false;
  }
  const db = getDb();
  const stamp = nowIso();
  const result = db
    .prepare(
      `UPDATE channel_publications
          SET upload_session_url = ?,
              updated_at = ?
        WHERE id = ?
          AND status = 'uploading'
          AND lease_token = ?`
    )
    .run(sessionUrl, stamp, input.publicationId, expectedLeaseToken);
  return Number(result.changes ?? 0) > 0;
}

export function markChannelPublicationScheduled(input: {
  publicationId: string;
  youtubeVideoId: string;
  youtubeVideoUrl: string | null;
  expectedLeaseToken?: string | null;
}): ChannelPublication {
  const db = getDb();
  const stamp = nowIso();
  const expectedLeaseToken = input.expectedLeaseToken?.trim() ?? "";
  const result = expectedLeaseToken
    ? db.prepare(
        `UPDATE channel_publications
            SET status = 'scheduled',
                youtube_video_id = ?,
                youtube_video_url = ?,
                last_error = NULL,
                lease_token = NULL,
                lease_expires_at = NULL,
                upload_session_url = NULL,
                updated_at = ?
          WHERE id = ?
            AND status = 'uploading'
            AND lease_token = ?
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at > ?`
      ).run(input.youtubeVideoId, input.youtubeVideoUrl, stamp, input.publicationId, expectedLeaseToken, stamp)
    : db.prepare(
        `UPDATE channel_publications
            SET status = 'scheduled',
                youtube_video_id = ?,
                youtube_video_url = ?,
                last_error = NULL,
                lease_token = NULL,
                lease_expires_at = NULL,
                upload_session_url = NULL,
                updated_at = ?
          WHERE id = ?`
      ).run(input.youtubeVideoId, input.youtubeVideoUrl, stamp, input.publicationId);
  if ((result.changes ?? 0) === 0) {
    const current = getChannelPublicationById(input.publicationId);
    if (current) {
      return current;
    }
    throw new PublicationMutationError("Публикация не найдена.", {
      code: "PUBLICATION_NOT_FOUND",
      status: 404
    });
  }
  appendChannelPublicationEvent(input.publicationId, "info", "Видео загружено в YouTube и запланировано.");
  const publication = getChannelPublicationById(input.publicationId)!;
  auditChannelPublication("publication.scheduled", publication, "scheduled", {
    payload: {
      youtubeVideoId: input.youtubeVideoId,
      youtubeVideoUrl: input.youtubeVideoUrl
    }
  });
  return publication;
}

export function markChannelPublicationFailed(
  publicationId: string,
  errorMessage: string,
  options?: { expectedLeaseToken?: string | null }
): ChannelPublication {
  const db = getDb();
  const stamp = nowIso();
  const expectedLeaseToken = options?.expectedLeaseToken?.trim() ?? "";
  const result = expectedLeaseToken
    ? db.prepare(
        `UPDATE channel_publications
            SET status = 'failed',
                last_error = ?,
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = ?
          WHERE id = ?
            AND status = 'uploading'
            AND lease_token = ?
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at > ?`
      ).run(errorMessage, stamp, publicationId, expectedLeaseToken, stamp)
    : db.prepare(
        `UPDATE channel_publications
            SET status = 'failed',
                last_error = ?,
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = ?
          WHERE id = ?`
      ).run(errorMessage, stamp, publicationId);
  if ((result.changes ?? 0) === 0) {
    const current = getChannelPublicationById(publicationId);
    if (current) {
      return current;
    }
    throw new PublicationMutationError("Публикация не найдена.", {
      code: "PUBLICATION_NOT_FOUND",
      status: 404
    });
  }
  appendChannelPublicationEvent(publicationId, "error", errorMessage);
  const publication = getChannelPublicationById(publicationId)!;
  auditChannelPublication("publication.failed", publication, "failed", {
    severity: "error",
    payload: {
      errorMessage
    }
  });
  return publication;
}

export function listPublicationsReadyForRemoteDeletion(channelId: string): ChannelPublication[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*, r.artifact_file_name as render_file_name, r.source_url as source_url, t.title as chat_title
         FROM channel_publications p
         JOIN render_exports r ON r.id = p.render_export_id
         JOIN chat_threads t ON t.id = p.chat_id
        WHERE p.channel_id = ?
          AND p.status = 'scheduled'
          AND p.youtube_video_id IS NOT NULL`
    )
    .all(channelId) as ChannelPublicationRow[];
  return rows.map((row) => mapChannelPublicationRow(row, readPublicationEvents(row.id)));
}
