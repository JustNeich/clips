import { getDb, newId, nowIso, runInTransaction } from "./db/client";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  normalizeStage2HardConstraints
} from "./stage2-channel-config";
import { normalizeStage2StyleProfile } from "./stage2-channel-learning";
import { normalizeStage2StyleDiscoveryReferenceUrls } from "./stage2-style-reference-links";
import type {
  ChannelStyleDiscoveryRequest,
  ChannelStyleDiscoveryRunDetail,
  ChannelStyleDiscoveryRunStatus
} from "./channel-style-discovery-types";

type ChannelStyleDiscoveryRunRow = {
  run_id: string;
  workspace_id: string;
  creator_user_id?: string | null;
  status: string;
  request_json?: string | null;
  request_fingerprint?: string | null;
  result_json?: string | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  updated_at: string;
  finished_at?: string | null;
};

function parseJsonOrNull<T>(raw: string | null | undefined): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeRequest(input: Partial<ChannelStyleDiscoveryRequest> | null | undefined): ChannelStyleDiscoveryRequest {
  return {
    channelName: String(input?.channelName ?? "").trim() || "Untitled channel",
    username: String(input?.username ?? "").trim() || "channel",
    hardConstraints: normalizeStage2HardConstraints(
      input?.hardConstraints ?? DEFAULT_STAGE2_HARD_CONSTRAINTS
    ),
    referenceUrls: normalizeStage2StyleDiscoveryReferenceUrls(input?.referenceUrls ?? [])
  };
}

function createRequestFingerprint(request: ChannelStyleDiscoveryRequest): string {
  return JSON.stringify({
    channelName: request.channelName.trim(),
    username: request.username.trim(),
    hardConstraints: normalizeStage2HardConstraints(request.hardConstraints),
    referenceUrls: normalizeStage2StyleDiscoveryReferenceUrls(request.referenceUrls)
  });
}

function normalizeStatus(value: string | null | undefined): ChannelStyleDiscoveryRunStatus {
  if (value === "running" || value === "completed" || value === "failed") {
    return value;
  }
  return "queued";
}

function mapRun(row: ChannelStyleDiscoveryRunRow): ChannelStyleDiscoveryRunDetail {
  const request = normalizeRequest(parseJsonOrNull<Partial<ChannelStyleDiscoveryRequest>>(row.request_json));
  return {
    runId: String(row.run_id),
    workspaceId: String(row.workspace_id),
    creatorUserId: row.creator_user_id ? String(row.creator_user_id) : null,
    status: normalizeStatus(row.status),
    request,
    result: row.result_json
      ? normalizeStage2StyleProfile(parseJsonOrNull<unknown>(row.result_json))
      : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    updatedAt: String(row.updated_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null
  };
}

function readRunRow(runId: string): ChannelStyleDiscoveryRunRow | null {
  const db = getDb();
  return (
    (db
      .prepare("SELECT * FROM channel_style_discovery_runs WHERE run_id = ? LIMIT 1")
      .get(runId) as ChannelStyleDiscoveryRunRow | undefined) ?? null
  );
}

function saveRun(run: ChannelStyleDiscoveryRunDetail): ChannelStyleDiscoveryRunDetail {
  const db = getDb();
  db.prepare(
    `INSERT INTO channel_style_discovery_runs
      (
        run_id,
        workspace_id,
        creator_user_id,
        status,
        request_json,
        request_fingerprint,
        result_json,
        error_message,
        created_at,
        started_at,
        updated_at,
        finished_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      creator_user_id = excluded.creator_user_id,
      status = excluded.status,
      request_json = excluded.request_json,
      request_fingerprint = excluded.request_fingerprint,
      result_json = excluded.result_json,
      error_message = excluded.error_message,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at,
      finished_at = excluded.finished_at`
  ).run(
    run.runId,
    run.workspaceId,
    run.creatorUserId,
    run.status,
    JSON.stringify(run.request),
    createRequestFingerprint(run.request),
    run.result ? JSON.stringify(run.result) : null,
    run.errorMessage,
    run.createdAt,
    run.startedAt,
    run.updatedAt,
    run.finishedAt
  );
  return mapRun(readRunRow(run.runId) as ChannelStyleDiscoveryRunRow);
}

export function getChannelStyleDiscoveryRun(runId: string): ChannelStyleDiscoveryRunDetail | null {
  const row = readRunRow(runId);
  return row ? mapRun(row) : null;
}

export function createChannelStyleDiscoveryRun(input: {
  workspaceId: string;
  creatorUserId: string;
  request: ChannelStyleDiscoveryRequest;
}): ChannelStyleDiscoveryRunDetail {
  const request = normalizeRequest(input.request);
  const fingerprint = createRequestFingerprint(request);
  return runInTransaction((db) => {
    const existing = db
      .prepare(
        `SELECT * FROM channel_style_discovery_runs
          WHERE workspace_id = ?
            AND creator_user_id = ?
            AND request_fingerprint = ?
            AND status IN ('queued', 'running')
          ORDER BY created_at DESC
          LIMIT 1`
      )
      .get(input.workspaceId, input.creatorUserId, fingerprint) as ChannelStyleDiscoveryRunRow | undefined;
    if (existing) {
      return mapRun(existing);
    }

    const now = nowIso();
    const created: ChannelStyleDiscoveryRunDetail = {
      runId: newId(),
      workspaceId: input.workspaceId,
      creatorUserId: input.creatorUserId,
      status: "queued",
      request,
      result: null,
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      finishedAt: null
    };
    saveRun(created);
    return created;
  });
}

export function claimNextQueuedChannelStyleDiscoveryRun(): ChannelStyleDiscoveryRunDetail | null {
  return runInTransaction((db) => {
    const row = db
      .prepare(
        `SELECT * FROM channel_style_discovery_runs
          WHERE status = 'queued'
          ORDER BY created_at ASC
          LIMIT 1`
      )
      .get() as ChannelStyleDiscoveryRunRow | undefined;
    if (!row) {
      return null;
    }
    const startedAt = nowIso();
    db.prepare(
      `UPDATE channel_style_discovery_runs
          SET status = 'running',
              started_at = COALESCE(started_at, ?),
              updated_at = ?,
              finished_at = NULL,
              error_message = NULL
        WHERE run_id = ?`
    ).run(startedAt, startedAt, row.run_id);
    return getChannelStyleDiscoveryRun(String(row.run_id));
  });
}

export function recoverInterruptedChannelStyleDiscoveryRuns(): number {
  return runInTransaction((db) => {
    const now = nowIso();
    const result = db
      .prepare(
        `UPDATE channel_style_discovery_runs
            SET status = 'queued',
                started_at = NULL,
                updated_at = ?,
                finished_at = NULL,
                error_message = NULL
          WHERE status = 'running'`
      )
      .run(now);
    return Number(result.changes ?? 0);
  });
}

export function finalizeChannelStyleDiscoveryRunSuccess(
  runId: string,
  result: unknown
): ChannelStyleDiscoveryRunDetail | null {
  const current = getChannelStyleDiscoveryRun(runId);
  if (!current) {
    return null;
  }
  return saveRun({
    ...current,
    status: "completed",
    result: normalizeStage2StyleProfile(result),
    errorMessage: null,
    updatedAt: nowIso(),
    finishedAt: nowIso()
  });
}

export function finalizeChannelStyleDiscoveryRunFailure(
  runId: string,
  errorMessage: string
): ChannelStyleDiscoveryRunDetail | null {
  const current = getChannelStyleDiscoveryRun(runId);
  if (!current) {
    return null;
  }
  return saveRun({
    ...current,
    status: "failed",
    result: current.result,
    errorMessage: errorMessage.trim() || "Style discovery failed.",
    updatedAt: nowIso(),
    finishedAt: nowIso()
  });
}

export function hasQueuedChannelStyleDiscoveryRuns(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT run_id FROM channel_style_discovery_runs WHERE status = 'queued' LIMIT 1")
    .get() as { run_id?: string } | undefined;
  return Boolean(row?.run_id);
}
