import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getChannelById } from "./chat-history";
import { isChannelPublishIntegrationReady } from "./channel-publish-state";
import { getDb, newId, nowIso, runInTransaction } from "./db/client";
import {
  authenticateMcpMachineCredential,
  type McpMachineAuthContext,
  type McpMachineCredentialScope
} from "./mcp-machine-credential-store";
import { PublicationMutationError } from "./publication-mutation-errors";
import {
  assertNoBlockingPublicationDuplicate,
  getChannelPublicationById,
  getChannelPublishIntegration,
  getStoredChannelPublishCredential
} from "./publication-store";
import { createReadyVideoPublication } from "./ready-video-publication";
import { removeUploadedSourceMedia, storeUploadedSourceMedia } from "./source-media-cache";
import { buildUploadedSourceUrl } from "./uploaded-source";
import { sanitizeYoutubeDescription } from "./youtube-description-policy";

const execFileAsync = promisify(execFile);

export const PUBLISHING_API_MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
export const PUBLISHING_API_UPLOAD_TTL_SECONDS = 24 * 60 * 60;
export const PUBLISHING_API_IDEMPOTENCY_KEY_MAX_BYTES = 200;

export type PublishingApiErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "AUTHENTICATION_FAILED"
  | "SCOPE_FORBIDDEN"
  | "CHANNEL_NOT_ALLOWED"
  | "CHANNEL_NOT_FOUND"
  | "DESTINATION_NOT_READY"
  | "INVALID_REQUEST"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "DUPLICATE_CONTENT"
  | "DUPLICATE_PUBLICATION"
  | "PUBLISH_AT_CONFLICT"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_EXPIRED"
  | "UPLOAD_IN_PROGRESS"
  | "UPLOAD_NOT_READY"
  | "UPLOAD_TERMINAL"
  | "CONTENT_LENGTH_REQUIRED"
  | "CONTENT_LENGTH_MISMATCH"
  | "CONTENT_TOO_LARGE"
  | "CONTENT_HASH_MISMATCH"
  | "INVALID_MP4"
  | "COMMIT_IN_PROGRESS"
  | "PUBLICATION_NOT_FOUND"
  | "TRANSIENT_STORAGE_ERROR"
  | "TRANSIENT_COMMIT_ERROR";

export class PublishingApiError extends Error {
  readonly code: PublishingApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly field?: string;
  readonly retryAfterSeconds?: number;

  constructor(
    code: PublishingApiErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; field?: string; retryAfterSeconds?: number } = {}
  ) {
    super(message);
    this.name = "PublishingApiError";
    this.code = code;
    this.status = options.status ?? 400;
    this.retryable = options.retryable ?? false;
    this.field = options.field;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function publishingApiErrorResponse(error: unknown): Response {
  const resolved =
    error instanceof PublishingApiError
      ? error
      : new PublishingApiError(
          "TRANSIENT_COMMIT_ERROR",
          "The publishing service could not complete the request.",
          { status: 503, retryable: true, retryAfterSeconds: 3 }
        );
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (resolved.retryable && resolved.retryAfterSeconds) {
    headers.set("Retry-After", String(resolved.retryAfterSeconds));
  }
  return Response.json(
    {
      error: resolved.message,
      code: resolved.code,
      retryable: resolved.retryable,
      ...(resolved.field ? { field: resolved.field } : {})
    },
    { status: resolved.status, headers }
  );
}

type PublishingUploadStatus = "created" | "uploading" | "uploaded" | "committing" | "committed" | "failed";

type PublishingUploadRow = {
  id: string;
  workspace_id: string;
  machine_credential_id: string;
  channel_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  content_sha256: string;
  content_length: number;
  content_type: string;
  file_name: string;
  title: string;
  description: string;
  tags_json: string;
  publish_at: string;
  notify_subscribers: number;
  source_url: string;
  source_path: string | null;
  uploaded_size_bytes: number | null;
  uploaded_sha256: string | null;
  status: string;
  publication_id: string | null;
  render_export_id: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  expires_at: string;
  committed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreatePublishingUploadInput = {
  channelId?: unknown;
  fileName?: unknown;
  contentType?: unknown;
  contentLength?: unknown;
  contentSha256?: unknown;
  publishAt?: unknown;
  title?: unknown;
  description?: unknown;
  tags?: unknown;
  notifySubscribers?: unknown;
};

type NormalizedCreateInput = {
  channelId: string;
  fileName: string;
  contentType: "video/mp4";
  contentLength: number;
  contentSha256: string;
  publishAt: string;
  title: string;
  description: string;
  tags: string[];
  notifySubscribers: boolean;
};

function parseUploadStatus(value: string): PublishingUploadStatus {
  return value === "uploading" || value === "uploaded" || value === "committing" || value === "committed" || value === "failed"
    ? value
    : "created";
}

function parseTagsJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function normalizeIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (
    !key ||
    Buffer.byteLength(key, "utf8") > PUBLISHING_API_IDEMPOTENCY_KEY_MAX_BYTES ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)
  ) {
    throw new PublishingApiError(
      "INVALID_IDEMPOTENCY_KEY",
      `Idempotency-Key is required and must be 1-${PUBLISHING_API_IDEMPOTENCY_KEY_MAX_BYTES} bytes of letters, digits, dot, underscore, colon, or dash.`,
      { field: "Idempotency-Key" }
    );
  }
  return key;
}

function normalizeSha256(value: unknown, field = "contentSha256"): string {
  const hash = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new PublishingApiError("INVALID_REQUEST", `${field} must be a lowercase or uppercase SHA-256 hex digest.`, {
      field
    });
  }
  return hash;
}

function normalizeCreateInput(
  input: CreatePublishingUploadInput,
  options: { allowPastPublishAt?: boolean } = {}
): NormalizedCreateInput {
  const channelId = typeof input.channelId === "string" ? input.channelId.trim() : "";
  if (!channelId) {
    throw new PublishingApiError("INVALID_REQUEST", "channelId is required.", { field: "channelId" });
  }
  const rawFileName = typeof input.fileName === "string" ? input.fileName.trim() : "";
  const fileName = path.basename(rawFileName).replace(/[\r\n"]/g, "_");
  if (!fileName || !fileName.toLowerCase().endsWith(".mp4")) {
    throw new PublishingApiError("INVALID_REQUEST", "fileName must end in .mp4.", { field: "fileName" });
  }
  if (input.contentType !== "video/mp4") {
    throw new PublishingApiError("INVALID_REQUEST", "contentType must be video/mp4.", { field: "contentType" });
  }
  const contentLength = typeof input.contentLength === "number" ? input.contentLength : Number.NaN;
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new PublishingApiError("INVALID_REQUEST", "contentLength must be a positive integer.", {
      field: "contentLength"
    });
  }
  if (contentLength > PUBLISHING_API_MAX_UPLOAD_BYTES) {
    throw new PublishingApiError("CONTENT_TOO_LARGE", "The MP4 exceeds the 512 MiB upload limit.", {
      status: 413,
      field: "contentLength"
    });
  }
  const contentSha256 = normalizeSha256(input.contentSha256);
  const publishAt = typeof input.publishAt === "string" ? input.publishAt.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(publishAt)) {
    throw new PublishingApiError("INVALID_REQUEST", "publishAt must be an RFC3339 timestamp with an explicit offset.", {
      field: "publishAt"
    });
  }
  const publishDate = new Date(publishAt);
  if (Number.isNaN(publishDate.getTime()) || (!options.allowPastPublishAt && publishDate.getTime() <= Date.now())) {
    throw new PublishingApiError("INVALID_REQUEST", "publishAt must be a valid future timestamp for a new upload.", {
      field: "publishAt"
    });
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 100) {
    throw new PublishingApiError("INVALID_REQUEST", "title is required and must be at most 100 characters.", {
      field: "title"
    });
  }
  const description = typeof input.description === "string"
    ? sanitizeYoutubeDescription(input.description.replace(/\r\n/g, "\n"))
    : "";
  if (description.length > 5000) {
    throw new PublishingApiError("INVALID_REQUEST", "description must be at most 5000 characters.", {
      field: "description"
    });
  }
  if (input.tags !== undefined && !Array.isArray(input.tags)) {
    throw new PublishingApiError("INVALID_REQUEST", "tags must be an array of strings.", { field: "tags" });
  }
  const tags = [...new Set((input.tags ?? []).filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
  if (tags.length > 30 || tags.some((tag) => tag.length > 100) || tags.join(",").length > 500) {
    throw new PublishingApiError("INVALID_REQUEST", "tags must contain at most 30 values and 500 total characters.", {
      field: "tags"
    });
  }
  if (input.notifySubscribers !== undefined && typeof input.notifySubscribers !== "boolean") {
    throw new PublishingApiError("INVALID_REQUEST", "notifySubscribers must be boolean.", {
      field: "notifySubscribers"
    });
  }
  return {
    channelId,
    fileName,
    contentType: "video/mp4",
    contentLength,
    contentSha256,
    publishAt,
    title,
    description,
    tags,
    notifySubscribers: input.notifySubscribers === true
  };
}

function buildRequestFingerprint(input: NormalizedCreateInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        channelId: input.channelId,
        fileName: input.fileName,
        contentType: input.contentType,
        contentLength: input.contentLength,
        contentSha256: input.contentSha256,
        publishAt: input.publishAt,
        title: input.title,
        description: input.description,
        tags: input.tags,
        notifySubscribers: input.notifySubscribers
      })
    )
    .digest("hex");
}

export function requirePublishingMachine(
  request: Request,
  requiredScope: Extract<McpMachineCredentialScope, "publication:create" | "publication:read">
): McpMachineAuthContext {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!bearer) {
    throw new PublishingApiError("AUTHENTICATION_REQUIRED", "A publishing machine bearer credential is required.", {
      status: 401
    });
  }
  const auth = authenticateMcpMachineCredential(bearer);
  if (!auth) {
    throw new PublishingApiError("AUTHENTICATION_FAILED", "The publishing machine credential is invalid or revoked.", {
      status: 401
    });
  }
  if (!auth.credential.scopes.includes(requiredScope)) {
    throw new PublishingApiError("SCOPE_FORBIDDEN", `The credential does not include ${requiredScope}.`, {
      status: 403
    });
  }
  return auth;
}

async function assertAllowedChannel(auth: McpMachineAuthContext, channelId: string): Promise<void> {
  if (!auth.credential.allowedChannelIds.includes(channelId)) {
    throw new PublishingApiError("CHANNEL_NOT_ALLOWED", "The credential is not allowed to use this Clips channel.", {
      status: 403,
      field: "channelId"
    });
  }
  const channel = await getChannelById(channelId);
  if (!channel || channel.workspaceId !== auth.workspace.id || channel.archivedAt) {
    throw new PublishingApiError("CHANNEL_NOT_FOUND", "The Clips channel is unavailable.", {
      status: 404,
      field: "channelId"
    });
  }
}

function assertDestinationReady(channelId: string): void {
  const integration = getChannelPublishIntegration(channelId);
  const credential = getStoredChannelPublishCredential(channelId);
  if (!isChannelPublishIntegrationReady(integration) || !credential?.refreshToken?.trim()) {
    throw new PublishingApiError(
      "DESTINATION_NOT_READY",
      "The Clips channel does not have a confirmed server-side YouTube destination credential.",
      { status: 409, field: "channelId" }
    );
  }
}

function findUploadById(uploadId: string): PublishingUploadRow | null {
  return (
    (getDb().prepare("SELECT * FROM publishing_api_uploads WHERE id = ? LIMIT 1").get(uploadId) as PublishingUploadRow | undefined) ??
    null
  );
}

function findUploadByIdempotency(input: {
  workspaceId: string;
  credentialId: string;
  idempotencyKey: string;
}): PublishingUploadRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM publishing_api_uploads
          WHERE workspace_id = ? AND machine_credential_id = ? AND idempotency_key = ?
          LIMIT 1`
      )
      .get(input.workspaceId, input.credentialId, input.idempotencyKey) as PublishingUploadRow | undefined) ?? null
  );
}

function recoverCommittedUpload(row: PublishingUploadRow): PublishingUploadRow {
  if (row.publication_id) {
    return row;
  }
  const linked = getDb()
    .prepare(
      `SELECT p.id AS publication_id, p.render_export_id AS render_export_id
         FROM channel_publications p
         JOIN render_exports r ON r.id = p.render_export_id
        WHERE p.workspace_id = ? AND p.channel_id = ? AND r.source_url = ?
        ORDER BY p.created_at DESC
        LIMIT 1`
    )
    .get(row.workspace_id, row.channel_id, row.source_url) as
      | { publication_id?: string; render_export_id?: string }
      | undefined;
  if (!linked?.publication_id || !linked.render_export_id) {
    return row;
  }
  const stamp = nowIso();
  getDb()
    .prepare(
      `UPDATE publishing_api_uploads
          SET status = 'committed', publication_id = ?, render_export_id = ?,
              committed_at = COALESCE(committed_at, ?), last_error_code = NULL,
              last_error_message = NULL, updated_at = ?
        WHERE id = ? AND publication_id IS NULL`
    )
    .run(linked.publication_id, linked.render_export_id, stamp, stamp, row.id);
  return findUploadById(row.id) ?? row;
}

function assertUploadOwned(auth: McpMachineAuthContext, row: PublishingUploadRow): void {
  if (row.workspace_id !== auth.workspace.id || row.machine_credential_id !== auth.credential.id) {
    throw new PublishingApiError("UPLOAD_NOT_FOUND", "The publishing upload was not found.", { status: 404 });
  }
}

function assertReplayMatches(row: PublishingUploadRow, idempotencyKey: string, contentSha256: string): void {
  if (row.idempotency_key !== idempotencyKey || row.content_sha256 !== contentSha256) {
    throw new PublishingApiError(
      "IDEMPOTENCY_KEY_CONFLICT",
      "The idempotency key is already bound to a different request or content hash.",
      { status: 409, field: "Idempotency-Key" }
    );
  }
}

function buildReceipt(row: PublishingUploadRow) {
  if (!row.publication_id) {
    return null;
  }
  const publication = getChannelPublicationById(row.publication_id);
  if (!publication || publication.workspaceId !== row.workspace_id || publication.channelId !== row.channel_id) {
    throw new PublishingApiError("PUBLICATION_NOT_FOUND", "The committed publication receipt is unavailable.", {
      status: 500,
      retryable: true,
      retryAfterSeconds: 3
    });
  }
  return {
    receiptId: row.id,
    uploadId: row.id,
    publicationId: publication.id,
    channelId: publication.channelId,
    contentSha256: row.content_sha256,
    publishAt: publication.scheduledAt,
    status: publication.status,
    youtubeVideoId: publication.youtubeVideoId,
    youtubeVideoUrl: publication.youtubeVideoUrl,
    lastError: publication.lastError,
    createdAt: row.created_at,
    committedAt: row.committed_at,
    updatedAt: publication.updatedAt,
    statusUrl: `/api/publishing/v1/publications/${publication.id}`
  };
}

function buildUploadPayload(row: PublishingUploadRow, replayed: boolean) {
  return {
    replayed,
    upload: {
      id: row.id,
      channelId: row.channel_id,
      status: parseUploadStatus(row.status),
      contentType: row.content_type,
      contentLength: row.content_length,
      contentSha256: row.content_sha256,
      publishAt: row.publish_at,
      expiresAt: row.expires_at,
      uploadUrl: `/api/publishing/v1/uploads/${row.id}/content`,
      commitUrl: `/api/publishing/v1/uploads/${row.id}/commit`
    },
    receipt: row.status === "committed" ? buildReceipt(row) : null,
    limits: {
      maxUploadBytes: PUBLISHING_API_MAX_UPLOAD_BYTES,
      uploadTtlSeconds: PUBLISHING_API_UPLOAD_TTL_SECONDS,
      idempotencyKeyMaxBytes: PUBLISHING_API_IDEMPOTENCY_KEY_MAX_BYTES
    }
  };
}

export async function createPublishingUpload(request: Request, rawInput: CreatePublishingUploadInput) {
  const auth = requirePublishingMachine(request, "publication:create");
  const idempotencyKey = normalizeIdempotencyKey(request);
  const existing = findUploadByIdempotency({
    workspaceId: auth.workspace.id,
    credentialId: auth.credential.id,
    idempotencyKey
  });
  const input = normalizeCreateInput(rawInput, { allowPastPublishAt: Boolean(existing) });
  await assertAllowedChannel(auth, input.channelId);
  const fingerprint = buildRequestFingerprint(input);
  if (existing) {
    if (existing.request_fingerprint !== fingerprint || existing.content_sha256 !== input.contentSha256) {
      throw new PublishingApiError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "The idempotency key is already bound to a different payload or content hash.",
        { status: 409, field: "Idempotency-Key" }
      );
    }
    return { status: 200, body: buildUploadPayload(existing, true) };
  }
  assertDestinationReady(input.channelId);
  try {
    assertNoBlockingPublicationDuplicate({ channelId: input.channelId, title: input.title });
  } catch (error) {
    if (error instanceof PublicationMutationError) {
      throw new PublishingApiError("DUPLICATE_PUBLICATION", error.message, { status: 409, field: "title" });
    }
    throw error;
  }
  const duplicateContent = getDb()
    .prepare(
      `SELECT id FROM publishing_api_uploads
        WHERE workspace_id = ? AND channel_id = ? AND content_sha256 = ?
          AND status != 'failed' AND (status = 'committed' OR expires_at > ?)
        LIMIT 1`
    )
    .get(auth.workspace.id, input.channelId, input.contentSha256, nowIso()) as { id?: string } | undefined;
  if (duplicateContent?.id) {
    throw new PublishingApiError("DUPLICATE_CONTENT", "The same MP4 content already has an active upload or publication.", {
      status: 409,
      field: "contentSha256"
    });
  }
  const id = newId();
  const stamp = nowIso();
  const expiresAt = new Date(Date.now() + PUBLISHING_API_UPLOAD_TTL_SECONDS * 1000).toISOString();
  const sourceUrl = buildUploadedSourceUrl(id, input.fileName);
  runInTransaction((db) => {
    db.prepare(
      `INSERT INTO publishing_api_uploads
        (id, workspace_id, machine_credential_id, channel_id, idempotency_key, request_fingerprint,
         content_sha256, content_length, content_type, file_name, title, description, tags_json,
         publish_at, notify_subscribers, source_url, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?)`
    ).run(
      id,
      auth.workspace.id,
      auth.credential.id,
      input.channelId,
      idempotencyKey,
      fingerprint,
      input.contentSha256,
      input.contentLength,
      input.contentType,
      input.fileName,
      input.title,
      input.description,
      JSON.stringify(input.tags),
      input.publishAt,
      input.notifySubscribers ? 1 : 0,
      sourceUrl,
      expiresAt,
      stamp,
      stamp
    );
  });
  return { status: 201, body: buildUploadPayload(findUploadById(id)!, false) };
}

function requireUploadHeaders(request: Request, row: PublishingUploadRow): { idempotencyKey: string; contentSha256: string } {
  const idempotencyKey = normalizeIdempotencyKey(request);
  const contentSha256 = normalizeSha256(request.headers.get("content-sha256"), "Content-SHA256");
  assertReplayMatches(row, idempotencyKey, contentSha256);
  return { idempotencyKey, contentSha256 };
}

async function probeMp4(filePath: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=format_name,duration,size:stream=codec_type,codec_name",
        "-of",
        "json",
        filePath
      ],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }
    );
    const payload = JSON.parse(stdout) as {
      format?: { format_name?: string; duration?: string; size?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string }>;
    };
    const formatNames = String(payload.format?.format_name ?? "").split(",");
    const duration = Number(payload.format?.duration ?? Number.NaN);
    if (!formatNames.includes("mp4") || !Array.isArray(payload.streams) || !payload.streams.some((stream) => stream.codec_type === "video") || !Number.isFinite(duration) || duration <= 0) {
      throw new Error("invalid mp4 container");
    }
  } catch {
    throw new PublishingApiError("INVALID_MP4", "The uploaded bytes are not a playable MP4 with a video stream.", {
      status: 422,
      field: "file"
    });
  }
}

function setUploadState(input: {
  uploadId: string;
  status: PublishingUploadStatus;
  sourcePath?: string | null;
  uploadedSizeBytes?: number | null;
  uploadedSha256?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): void {
  getDb()
    .prepare(
      `UPDATE publishing_api_uploads
          SET status = ?, source_path = COALESCE(?, source_path),
              uploaded_size_bytes = COALESCE(?, uploaded_size_bytes),
              uploaded_sha256 = COALESCE(?, uploaded_sha256),
              last_error_code = ?, last_error_message = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(
      input.status,
      input.sourcePath ?? null,
      input.uploadedSizeBytes ?? null,
      input.uploadedSha256 ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      nowIso(),
      input.uploadId
    );
}

export async function uploadPublishingContent(request: Request, uploadId: string) {
  const auth = requirePublishingMachine(request, "publication:create");
  const row = findUploadById(uploadId);
  if (!row) {
    throw new PublishingApiError("UPLOAD_NOT_FOUND", "The publishing upload was not found.", { status: 404 });
  }
  assertUploadOwned(auth, row);
  await assertAllowedChannel(auth, row.channel_id);
  requireUploadHeaders(request, row);
  const declaredLengthRaw = request.headers.get("content-length")?.trim() ?? "";
  if (!/^\d+$/.test(declaredLengthRaw)) {
    throw new PublishingApiError("CONTENT_LENGTH_REQUIRED", "Content-Length is required for the bounded upload.", {
      status: 411,
      field: "Content-Length"
    });
  }
  const declaredLength = Number(declaredLengthRaw);
  if (declaredLength !== row.content_length) {
    throw new PublishingApiError("CONTENT_LENGTH_MISMATCH", "Content-Length does not match the create request.", {
      status: 422,
      field: "Content-Length"
    });
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "video/mp4") {
    throw new PublishingApiError("INVALID_REQUEST", "Content-Type must be video/mp4.", { field: "Content-Type" });
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new PublishingApiError("UPLOAD_EXPIRED", "The upload reservation has expired.", { status: 410 });
  }
  const currentStatus = parseUploadStatus(row.status);
  if (currentStatus === "uploaded" || currentStatus === "committed") {
    return { status: 200, body: buildUploadPayload(row, true) };
  }
  if (currentStatus === "uploading") {
    throw new PublishingApiError("UPLOAD_IN_PROGRESS", "The upload is already in progress.", {
      status: 409,
      retryable: true,
      retryAfterSeconds: 2
    });
  }
  if (currentStatus === "committing") {
    throw new PublishingApiError("COMMIT_IN_PROGRESS", "The upload is being committed.", {
      status: 409,
      retryable: true,
      retryAfterSeconds: 2
    });
  }
  if (currentStatus === "failed") {
    throw new PublishingApiError("UPLOAD_TERMINAL", row.last_error_message || "The upload is in a terminal failed state.", {
      status: 409
    });
  }
  const claimed = getDb()
    .prepare("UPDATE publishing_api_uploads SET status = 'uploading', updated_at = ? WHERE id = ? AND status = 'created'")
    .run(nowIso(), row.id);
  if (Number(claimed.changes ?? 0) !== 1) {
    throw new PublishingApiError("UPLOAD_IN_PROGRESS", "The upload was claimed by another request.", {
      status: 409,
      retryable: true,
      retryAfterSeconds: 2
    });
  }
  if (!request.body) {
    setUploadState({ uploadId: row.id, status: "created" });
    throw new PublishingApiError("INVALID_REQUEST", "An MP4 request body is required.", { field: "file" });
  }
  const hasher = createHash("sha256");
  let actualBytes = 0;
  const metered = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        actualBytes += chunk.byteLength;
        hasher.update(chunk);
        controller.enqueue(chunk);
      }
    })
  );
  try {
    const cached = await storeUploadedSourceMedia({
      sourceUrl: row.source_url,
      fileName: row.file_name,
      title: row.title,
      sourceStream: metered,
      expectedSizeBytes: row.content_length,
      maxBytes: PUBLISHING_API_MAX_UPLOAD_BYTES,
      requireMp4Signature: true
    });
    const actualSha256 = hasher.digest("hex");
    if (actualBytes !== row.content_length || cached.videoSizeBytes !== row.content_length) {
      await removeUploadedSourceMedia(row.source_url);
      setUploadState({
        uploadId: row.id,
        status: "created",
        errorCode: "CONTENT_LENGTH_MISMATCH",
        errorMessage: "The received byte count does not match contentLength."
      });
      throw new PublishingApiError("CONTENT_LENGTH_MISMATCH", "The received byte count does not match contentLength.", {
        status: 422,
        field: "file"
      });
    }
    if (actualSha256 !== row.content_sha256) {
      await removeUploadedSourceMedia(row.source_url);
      setUploadState({
        uploadId: row.id,
        status: "created",
        errorCode: "CONTENT_HASH_MISMATCH",
        errorMessage: "The received bytes do not match contentSha256."
      });
      throw new PublishingApiError("CONTENT_HASH_MISMATCH", "The received bytes do not match contentSha256.", {
        status: 422,
        field: "Content-SHA256"
      });
    }
    await probeMp4(cached.sourcePath);
    setUploadState({
      uploadId: row.id,
      status: "uploaded",
      sourcePath: cached.sourcePath,
      uploadedSizeBytes: actualBytes,
      uploadedSha256: actualSha256
    });
    return { status: 200, body: buildUploadPayload(findUploadById(row.id)!, false) };
  } catch (error) {
    if (error instanceof PublishingApiError) {
      if (error.code === "INVALID_MP4") {
        await removeUploadedSourceMedia(row.source_url);
        setUploadState({ uploadId: row.id, status: "failed", errorCode: error.code, errorMessage: error.message });
      }
      throw error;
    }
    await removeUploadedSourceMedia(row.source_url);
    setUploadState({
      uploadId: row.id,
      status: "created",
      errorCode: "TRANSIENT_STORAGE_ERROR",
      errorMessage: "The upload could not be stored."
    });
    throw new PublishingApiError("TRANSIENT_STORAGE_ERROR", "The upload could not be stored.", {
      status: 503,
      retryable: true,
      retryAfterSeconds: 3
    });
  }
}

async function hashFile(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    sizeBytes += bytes.byteLength;
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

export async function commitPublishingUpload(request: Request, uploadId: string) {
  const auth = requirePublishingMachine(request, "publication:create");
  let row = findUploadById(uploadId);
  if (!row) {
    throw new PublishingApiError("UPLOAD_NOT_FOUND", "The publishing upload was not found.", { status: 404 });
  }
  assertUploadOwned(auth, row);
  await assertAllowedChannel(auth, row.channel_id);
  requireUploadHeaders(request, row);
  // A process can stop after the durable queue row is created but before this
  // API row is linked. Recover by the upload-unique source URL before deciding
  // whether another publication may be created.
  row = recoverCommittedUpload(row);
  if (row.status === "committed") {
    return { status: 200, body: { replayed: true, receipt: buildReceipt(row) } };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new PublishingApiError("UPLOAD_EXPIRED", "The upload reservation has expired.", { status: 410 });
  }
  if (row.status === "committing") {
    const stale = Date.now() - new Date(row.updated_at).getTime() > 5 * 60_000;
    if (!stale) {
      throw new PublishingApiError("COMMIT_IN_PROGRESS", "The upload is already being committed.", {
        status: 409,
        retryable: true,
        retryAfterSeconds: 2
      });
    }
    setUploadState({ uploadId: row.id, status: "uploaded" });
    row = findUploadById(row.id)!;
  }
  if (row.status !== "uploaded" || !row.source_path) {
    throw new PublishingApiError("UPLOAD_NOT_READY", "Upload the complete MP4 before commit.", { status: 409 });
  }
  assertDestinationReady(row.channel_id);
  const claimed = getDb()
    .prepare("UPDATE publishing_api_uploads SET status = 'committing', updated_at = ? WHERE id = ? AND status = 'uploaded'")
    .run(nowIso(), row.id);
  if (Number(claimed.changes ?? 0) !== 1) {
    throw new PublishingApiError("COMMIT_IN_PROGRESS", "The upload was claimed by another commit request.", {
      status: 409,
      retryable: true,
      retryAfterSeconds: 2
    });
  }
  try {
    await access(row.source_path);
    const stored = await hashFile(row.source_path);
    if (stored.sizeBytes !== row.content_length || stored.sha256 !== row.content_sha256) {
      setUploadState({
        uploadId: row.id,
        status: "failed",
        errorCode: "CONTENT_HASH_MISMATCH",
        errorMessage: "The staged MP4 no longer matches the committed content binding."
      });
      throw new PublishingApiError(
        "CONTENT_HASH_MISMATCH",
        "The staged MP4 no longer matches the committed content binding.",
        { status: 422 }
      );
    }
    await probeMp4(row.source_path);
    assertNoBlockingPublicationDuplicate({ channelId: row.channel_id, title: row.title });
    const result = await createReadyVideoPublication({
      workspaceId: row.workspace_id,
      userId: auth.user.id,
      channelId: row.channel_id,
      sourceUrl: row.source_url,
      title: row.title,
      fileName: row.file_name,
      sourcePath: row.source_path,
      description: row.description,
      tags: parseTagsJson(row.tags_json),
      publishAt: row.publish_at,
      notifySubscribers: Boolean(row.notify_subscribers)
    });
    if (!result.publication) {
      throw new Error("The existing publication queue did not return a publication receipt.");
    }
    const committedAt = nowIso();
    getDb()
      .prepare(
        `UPDATE publishing_api_uploads
            SET status = 'committed', publication_id = ?, render_export_id = ?, committed_at = ?,
                last_error_code = NULL, last_error_message = NULL, updated_at = ?
          WHERE id = ?`
      )
      .run(result.publication.id, result.renderExport.id, committedAt, committedAt, row.id);
    const committed = findUploadById(row.id)!;
    return { status: 201, body: { replayed: false, receipt: buildReceipt(committed) } };
  } catch (error) {
    if (error instanceof PublishingApiError) {
      if (error.code === "INVALID_MP4") {
        setUploadState({ uploadId: row.id, status: "failed", errorCode: error.code, errorMessage: error.message });
      } else if (error.code !== "CONTENT_HASH_MISMATCH") {
        setUploadState({ uploadId: row.id, status: "uploaded", errorCode: error.code, errorMessage: error.message });
      }
      throw error;
    }
    if (error instanceof PublicationMutationError) {
      setUploadState({ uploadId: row.id, status: "uploaded", errorCode: error.code, errorMessage: error.message });
      const code = error.code === "TIME_OCCUPIED" ? "PUBLISH_AT_CONFLICT" : "DUPLICATE_PUBLICATION";
      throw new PublishingApiError(code, error.message, {
        status: 409,
        field: error.field === "scheduledAtLocal" ? "publishAt" : error.field
      });
    }
    setUploadState({
      uploadId: row.id,
      status: "uploaded",
      errorCode: "TRANSIENT_COMMIT_ERROR",
      errorMessage: "The commit could not be completed."
    });
    throw new PublishingApiError("TRANSIENT_COMMIT_ERROR", "The commit could not be completed.", {
      status: 503,
      retryable: true,
      retryAfterSeconds: 3
    });
  }
}

export async function getPublishingPublication(request: Request, publicationId: string) {
  const auth = requirePublishingMachine(request, "publication:read");
  const row = getDb()
    .prepare("SELECT * FROM publishing_api_uploads WHERE workspace_id = ? AND publication_id = ? LIMIT 1")
    .get(auth.workspace.id, publicationId) as PublishingUploadRow | undefined;
  if (!row) {
    throw new PublishingApiError("PUBLICATION_NOT_FOUND", "The publication receipt was not found.", { status: 404 });
  }
  await assertAllowedChannel(auth, row.channel_id);
  const { reconcileChannelPublicationRemoteState } = await import("./channel-publication-service");
  const reconciled = await reconcileChannelPublicationRemoteState(publicationId);
  return {
    status: 200,
    body: {
      receipt: {
        ...buildReceipt(row),
        remoteVerification: reconciled.remote
      }
    }
  };
}

export async function getPublishingUpload(request: Request, uploadId: string) {
  const auth = requirePublishingMachine(request, "publication:read");
  const row = findUploadById(uploadId);
  if (!row) {
    throw new PublishingApiError("UPLOAD_NOT_FOUND", "The publishing upload was not found.", { status: 404 });
  }
  assertUploadOwned(auth, row);
  await assertAllowedChannel(auth, row.channel_id);
  return { status: 200, body: buildUploadPayload(row, true) };
}
