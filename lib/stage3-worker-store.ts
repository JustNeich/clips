import { createHash, randomBytes } from "node:crypto";
import {
  Stage3JobKind,
  Stage3WorkerPlatform,
  Stage3WorkerStatus,
  Stage3WorkerSummary
} from "../app/components/types";
import { getDb, newId, nowIso, runInTransaction } from "./db/client";
import { sweepExpiredLocalStage3Jobs } from "./stage3-job-store";

const PAIRING_TTL_MS = Number.parseInt(process.env.STAGE3_WORKER_PAIRING_TTL_SEC ?? "", 10) > 0
  ? Number.parseInt(process.env.STAGE3_WORKER_PAIRING_TTL_SEC ?? "", 10) * 1000
  : 10 * 60_000;
const SESSION_TTL_MS = Number.parseInt(process.env.STAGE3_WORKER_SESSION_TTL_SEC ?? "", 10) > 0
  ? Number.parseInt(process.env.STAGE3_WORKER_SESSION_TTL_SEC ?? "", 10) * 1000
  : 30 * 24 * 60 * 60_000;
const ONLINE_WINDOW_MS = 30_000;

type WorkerRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  label: string;
  platform: string;
  hostname: string | null;
  app_version: string | null;
  capabilities_json: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  current_job_id?: string | null;
  current_job_kind?: string | null;
  current_job_lease_expires_at?: string | null;
  current_job_heartbeat_at?: string | null;
};

type WorkerCurrentJobRow = {
  current_job_id?: string | null;
  current_job_kind?: string | null;
  current_job_lease_expires_at?: string | null;
  current_job_heartbeat_at?: string | null;
};

type WorkerCurrentJobSnapshot = {
  id: string;
  kind: Stage3JobKind;
  leaseUntil: string | null;
  lastHeartbeatAt: string | null;
};

type WorkerTokenRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  worker_id: string | null;
  token_hash: string;
  token_kind: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Stage3WorkerRecord = Stage3WorkerSummary & {
  workspaceId: string;
  userId: string;
  capabilitiesJson: string | null;
  revokedAt: string | null;
};

export type Stage3WorkerAuthContext = {
  worker: Stage3WorkerRecord;
  workspaceId: string;
  userId: string;
  tokenId: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizePlatform(value: string | null | undefined): Stage3WorkerPlatform {
  if (value === "darwin-arm64" || value === "darwin-x64" || value === "win32-x64") {
    return value;
  }
  return "unknown";
}

function normalizeCurrentJobKind(value: string | null | undefined): Stage3JobKind | null {
  if (
    value === "preview" ||
    value === "render" ||
    value === "editing-proxy" ||
    value === "source-download" ||
    value === "agent-media-step"
  ) {
    return value;
  }
  return null;
}

function readCurrentWorkerJobRow(workerId: string): WorkerCurrentJobRow | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `SELECT
            id AS current_job_id,
            kind AS current_job_kind,
            lease_expires_at AS current_job_lease_expires_at,
            heartbeat_at AS current_job_heartbeat_at
          FROM stage3_jobs
         WHERE assigned_worker_id = ?
           AND status = 'running'
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(workerId) as WorkerCurrentJobRow | undefined) ?? null
  );
}

function mapCurrentWorkerJob(row: WorkerCurrentJobRow | null): WorkerCurrentJobSnapshot | null {
  if (!row?.current_job_id) {
    return null;
  }
  const kind = normalizeCurrentJobKind(row.current_job_kind);
  if (!kind) {
    return null;
  }
  return {
    id: String(row.current_job_id),
    kind,
    leaseUntil: row.current_job_lease_expires_at ? String(row.current_job_lease_expires_at) : null,
    lastHeartbeatAt: row.current_job_heartbeat_at ? String(row.current_job_heartbeat_at) : null
  };
}

function resolveCurrentWorkerJob(row: WorkerRow): WorkerCurrentJobSnapshot | null {
  if (
    Object.prototype.hasOwnProperty.call(row, "current_job_id") ||
    Object.prototype.hasOwnProperty.call(row, "current_job_kind") ||
    Object.prototype.hasOwnProperty.call(row, "current_job_lease_expires_at") ||
    Object.prototype.hasOwnProperty.call(row, "current_job_heartbeat_at")
  ) {
    return mapCurrentWorkerJob(row);
  }
  return mapCurrentWorkerJob(readCurrentWorkerJobRow(String(row.id)));
}

function isCurrentWorkerJobActive(job: WorkerCurrentJobSnapshot | null): boolean {
  if (!job) {
    return false;
  }
  if (!job.leaseUntil) {
    return true;
  }
  const leaseMs = new Date(job.leaseUntil).getTime();
  if (!Number.isFinite(leaseMs) || leaseMs <= Date.now()) {
    return false;
  }
  return true;
}

function deriveWorkerStatus(lastSeenAt: string | null, hasActiveCurrentJob: boolean): Stage3WorkerStatus {
  if (!lastSeenAt) {
    return "offline";
  }
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > ONLINE_WINDOW_MS) {
    return "offline";
  }
  return hasActiveCurrentJob ? "busy" : "online";
}

function mapWorkerRow(row: WorkerRow | null): Stage3WorkerRecord | null {
  if (!row) {
    return null;
  }
  const currentJob = resolveCurrentWorkerJob(row);
  const hasActiveCurrentJob = isCurrentWorkerJobActive(currentJob);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    label: String(row.label),
    platform: normalizePlatform(row.platform ? String(row.platform) : null),
    hostname: row.hostname ? String(row.hostname) : null,
    appVersion: row.app_version ? String(row.app_version) : null,
    status: deriveWorkerStatus(row.last_seen_at ? String(row.last_seen_at) : null, hasActiveCurrentJob),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
    currentJobId: hasActiveCurrentJob ? currentJob?.id ?? null : null,
    currentJobKind: hasActiveCurrentJob ? currentJob?.kind ?? null : null,
    capabilitiesJson: row.capabilities_json ? String(row.capabilities_json) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function readWorkerRow(workerId: string): WorkerRow | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM stage3_workers WHERE id = ?").get(workerId) as WorkerRow | undefined) ?? null;
}

export function issueStage3WorkerPairingToken(input: {
  workspaceId: string;
  userId: string;
}): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const stamp = nowIso();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO stage3_worker_tokens
      (id, workspace_id, user_id, worker_id, token_hash, token_kind, expires_at, consumed_at, revoked_at, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, 'pairing', ?, NULL, NULL, ?, ?)`
  ).run(newId(), input.workspaceId, input.userId, hashToken(token), expiresAt, stamp, stamp);
  return { token, expiresAt };
}

export function exchangeStage3WorkerPairingToken(input: {
  pairingToken: string;
  label: string;
  platform: string;
  hostname?: string | null;
  appVersion?: string | null;
  capabilitiesJson?: string | null;
}): { worker: Stage3WorkerRecord; sessionToken: string; expiresAt: string } {
  const pairingHash = hashToken(input.pairingToken.trim());
  return runInTransaction((db) => {
    const tokenRow =
      (db
        .prepare(
          `SELECT * FROM stage3_worker_tokens
            WHERE token_hash = ?
              AND token_kind = 'pairing'
              AND consumed_at IS NULL
              AND revoked_at IS NULL
            LIMIT 1`
        )
        .get(pairingHash) as WorkerTokenRow | undefined) ?? null;
    if (!tokenRow) {
      throw new Error("Pairing token is invalid.");
    }
    if (new Date(String(tokenRow.expires_at)).getTime() <= Date.now()) {
      throw new Error("Pairing token has expired.");
    }

    const stamp = nowIso();
    const workerId = newId();
    db.prepare(
      `INSERT INTO stage3_workers
        (id, workspace_id, user_id, label, platform, hostname, app_version, capabilities_json, last_seen_at, revoked_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(
      workerId,
      tokenRow.workspace_id,
      tokenRow.user_id,
      input.label.trim() || "Local Worker",
      normalizePlatform(input.platform),
      input.hostname?.trim() || null,
      input.appVersion?.trim() || null,
      input.capabilitiesJson ?? null,
      stamp,
      stamp,
      stamp
    );

    db.prepare(
      `UPDATE stage3_worker_tokens
          SET consumed_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(stamp, stamp, tokenRow.id);

    const sessionToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    db.prepare(
      `INSERT INTO stage3_worker_tokens
        (id, workspace_id, user_id, worker_id, token_hash, token_kind, expires_at, consumed_at, revoked_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'session', ?, NULL, NULL, ?, ?)`
    ).run(
      newId(),
      tokenRow.workspace_id,
      tokenRow.user_id,
      workerId,
      hashToken(sessionToken),
      expiresAt,
      stamp,
      stamp
    );

    const worker = mapWorkerRow(readWorkerRow(workerId));
    if (!worker) {
      throw new Error("Failed to create Stage 3 worker.");
    }
    return {
      worker,
      sessionToken,
      expiresAt
    };
  });
}

export function authenticateStage3WorkerSessionToken(token: string): Stage3WorkerAuthContext | null {
  const db = getDb();
  const row =
    (db
      .prepare(
        `SELECT
            t.id as token_id,
            t.workspace_id,
            t.user_id,
            t.expires_at,
            t.revoked_at as token_revoked_at,
            w.*
          FROM stage3_worker_tokens t
          JOIN stage3_workers w ON w.id = t.worker_id
         WHERE t.token_hash = ?
           AND t.token_kind = 'session'
         LIMIT 1`
      )
      .get(hashToken(token.trim())) as
      | (WorkerRow & {
          token_id: string;
          expires_at: string;
          token_revoked_at: string | null;
        })
      | undefined) ?? null;

  if (!row) {
    return null;
  }
  if (row.token_revoked_at || row.revoked_at) {
    return null;
  }
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    return null;
  }

  const worker = mapWorkerRow({
    id: row.id,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    label: row.label,
    platform: row.platform,
    hostname: row.hostname,
    app_version: row.app_version,
    capabilities_json: row.capabilities_json,
    last_seen_at: row.last_seen_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  });
  if (!worker) {
    return null;
  }

  return {
    worker,
    workspaceId: worker.workspaceId,
    userId: worker.userId,
    tokenId: String(row.token_id)
  };
}

export function touchStage3WorkerHeartbeat(input: {
  workerId: string;
  appVersion?: string | null;
  capabilitiesJson?: string | null;
}): Stage3WorkerRecord {
  const stamp = nowIso();
  const db = getDb();
  db.prepare(
    `UPDATE stage3_workers
        SET last_seen_at = ?,
            app_version = COALESCE(?, app_version),
            capabilities_json = COALESCE(?, capabilities_json),
            updated_at = ?
      WHERE id = ?`
  ).run(stamp, input.appVersion?.trim() || null, input.capabilitiesJson ?? null, stamp, input.workerId);
  const worker = mapWorkerRow(readWorkerRow(input.workerId));
  if (!worker) {
    throw new Error("Stage 3 worker not found.");
  }
  return worker;
}

export function listStage3Workers(input: { workspaceId: string; userId: string }): Stage3WorkerSummary[] {
  sweepExpiredLocalStage3Jobs();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT w.*,
              (
                SELECT j.id
                  FROM stage3_jobs j
                 WHERE j.assigned_worker_id = w.id
                   AND j.status = 'running'
                 ORDER BY j.updated_at DESC
                 LIMIT 1
              ) AS current_job_id,
              (
                SELECT j.kind
                  FROM stage3_jobs j
                 WHERE j.assigned_worker_id = w.id
                   AND j.status = 'running'
                 ORDER BY j.updated_at DESC
                 LIMIT 1
              ) AS current_job_kind,
              (
                SELECT j.lease_expires_at
                  FROM stage3_jobs j
                 WHERE j.assigned_worker_id = w.id
                   AND j.status = 'running'
                 ORDER BY j.updated_at DESC
                 LIMIT 1
              ) AS current_job_lease_expires_at,
              (
                SELECT j.heartbeat_at
                  FROM stage3_jobs j
                 WHERE j.assigned_worker_id = w.id
                   AND j.status = 'running'
                 ORDER BY j.updated_at DESC
                 LIMIT 1
              ) AS current_job_heartbeat_at
         FROM stage3_workers w
        WHERE w.workspace_id = ?
          AND w.user_id = ?
          AND w.revoked_at IS NULL
        ORDER BY w.updated_at DESC`
    )
    .all(input.workspaceId, input.userId) as WorkerRow[];
  return rows
    .map((row) => mapWorkerRow(row))
    .filter((row): row is Stage3WorkerRecord => Boolean(row));
}

export function revokeStage3Worker(input: { workerId: string; workspaceId: string; userId: string }): Stage3WorkerRecord {
  return runInTransaction((db) => {
    const row =
      (db
        .prepare(
          `SELECT * FROM stage3_workers
            WHERE id = ?
              AND workspace_id = ?
              AND user_id = ?
              AND revoked_at IS NULL
            LIMIT 1`
        )
        .get(input.workerId, input.workspaceId, input.userId) as WorkerRow | undefined) ?? null;
    if (!row) {
      throw new Error("Stage 3 worker not found.");
    }
    const stamp = nowIso();
    db.prepare("UPDATE stage3_workers SET revoked_at = ?, updated_at = ? WHERE id = ?").run(stamp, stamp, input.workerId);
    db.prepare("UPDATE stage3_worker_tokens SET revoked_at = ?, updated_at = ? WHERE worker_id = ?").run(
      stamp,
      stamp,
      input.workerId
    );
    const worker = mapWorkerRow(readWorkerRow(input.workerId));
    if (!worker) {
      throw new Error("Stage 3 worker not found.");
    }
    return worker;
  });
}
