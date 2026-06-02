import { existsSync } from "node:fs";
import {
  Stage3ExecutionTarget,
  Stage3JobArtifact,
  Stage3JobKind,
  Stage3JobStatus,
  Stage3JobSummary
} from "../app/components/types";
import { getDb, newId, nowIso, runInTransaction } from "./db/client";
import { tryAppendFlowAuditEvent } from "./audit-log-store";
import { STAGE3_WORKER_ONLINE_WINDOW_MS } from "./stage3-worker-availability";
import { resolveStage3WorkerJobTimeoutMs } from "./stage3-worker-job-timeout";

type JobRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  kind: string;
  status: string;
  execution_target: string | null;
  assigned_worker_id: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  dedupe_key: string | null;
  payload_json: string;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  recoverable: number;
  attempts: number;
  attempt_limit: number | null;
  attempt_group: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  assigned_worker_label?: string | null;
  artifact_id?: string | null;
  artifact_job_id?: string | null;
  artifact_kind?: string | null;
  artifact_file_name?: string | null;
  artifact_mime_type?: string | null;
  artifact_file_path?: string | null;
  artifact_size_bytes?: number | null;
  artifact_created_at?: string | null;
};

export type Stage3JobRecord = Stage3JobSummary & {
  workspaceId: string;
  userId: string;
  payloadJson: string;
  resultJson: string | null;
  artifactFilePath: string | null;
  attemptLimit: number;
  attemptGroup: string | null;
};

type EnqueueStage3JobInput = {
  workspaceId: string;
  userId: string;
  kind: Stage3JobKind;
  payloadJson: string;
  executionTarget?: Stage3ExecutionTarget | null;
  dedupeKey?: string | null;
  attemptLimit?: number | null;
  attemptGroup?: string | null;
  reuseCompleted?: boolean | null;
};

type CompleteStage3JobInput = {
  resultJson?: string | null;
  artifact?: {
    kind?: Stage3JobArtifact["kind"];
    fileName: string;
    mimeType: string;
    filePath: string;
    sizeBytes: number;
  } | null;
};

type FinishStage3JobInput = {
  status: Extract<Stage3JobStatus, "failed" | "interrupted">;
  errorCode?: string | null;
  errorMessage: string;
  recoverable: boolean;
};

type ClaimStage3WorkerJobInput = {
  workerId: string;
  workspaceId: string;
  userId: string;
  supportedKinds?: Stage3JobKind[];
  leaseDurationMs?: number;
};

type FailQueuedLocalJobsForWorkerUpdateInput = {
  workspaceId: string;
  userId: string;
  supportedKinds?: Stage3JobKind[] | null;
  workerId?: string | null;
  workerAppVersion?: string | null;
  expectedRuntimeVersion?: string | null;
};

export const DEFAULT_LOCAL_STAGE3_WORKER_LEASE_MS = 45 * 60_000;
const LOCAL_STAGE3_WORKER_RESTART_RECOVERY_GRACE_MS = 20_000;
const LOCAL_STAGE3_SERVER_WATCHDOG_GRACE_MS = 30_000;
const LOCAL_STAGE3_QUEUED_WORKER_UNAVAILABLE_GRACE_MS = 90_000;

function normalizeJobKind(value: string): Stage3JobKind {
  if (
    value === "preview" ||
    value === "render" ||
    value === "editing-proxy" ||
    value === "source-download" ||
    value === "agent-media-step"
  ) {
    return value;
  }
  return "preview";
}

function normalizeExecutionTarget(value: string | null | undefined): Stage3ExecutionTarget {
  return value === "host" ? "host" : "local";
}

function normalizeJobStatus(value: string): Stage3JobStatus {
  if (value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "interrupted") {
    return value;
  }
  return "failed";
}

function buildStage3JobTimeoutErrorCode(kind: Stage3JobKind): string {
  return `${kind.replaceAll("-", "_")}_timeout`;
}

function resolveStage3ServerWatchdogTimeoutMs(kind: Stage3JobKind): number {
  return resolveStage3WorkerJobTimeoutMs(kind) + LOCAL_STAGE3_SERVER_WATCHDOG_GRACE_MS;
}

function getStage3JobRunningStartedAtMs(row: Pick<JobRow, "started_at" | "updated_at" | "created_at">): number | null {
  const startedAt = Date.parse(row.started_at ?? row.updated_at ?? row.created_at);
  return Number.isFinite(startedAt) ? startedAt : null;
}

function buildHostStage3JobPrioritySql(column = "kind"): string {
  return `CASE
    WHEN ${column} = 'editing-proxy' THEN 0
    WHEN ${column} = 'render' THEN 1
    WHEN ${column} = 'source-download' THEN 2
    WHEN ${column} = 'agent-media-step' THEN 3
    WHEN ${column} = 'preview' THEN 9
    ELSE 4
  END`;
}

function buildLocalStage3JobPrioritySql(column = "kind"): string {
  return `CASE
    WHEN ${column} = 'editing-proxy' THEN 0
    WHEN ${column} = 'render' THEN 1
    WHEN ${column} = 'source-download' THEN 2
    WHEN ${column} = 'agent-media-step' THEN 3
    WHEN ${column} = 'preview' THEN 9
    ELSE 4
  END`;
}

function mapArtifactFromJobRow(row: JobRow): { artifact: Stage3JobArtifact | null; filePath: string | null } {
  if (!row.artifact_file_path || !existsSync(row.artifact_file_path)) {
    return {
      artifact: null,
      filePath: null
    };
  }

  return {
    artifact: {
      id: String(row.artifact_id),
      jobId: String(row.artifact_job_id ?? row.id),
      kind: "video",
      fileName: String(row.artifact_file_name),
      mimeType: String(row.artifact_mime_type),
      sizeBytes: Number(row.artifact_size_bytes) || 0,
      createdAt: String(row.artifact_created_at),
      downloadUrl: null
    },
    filePath: String(row.artifact_file_path)
  };
}

function mapJobRow(row: JobRow | null): Stage3JobRecord | null {
  if (!row) {
    return null;
  }

  const kind = normalizeJobKind(String(row.kind));
  const artifact = mapArtifactFromJobRow(row);
  const baseStatus = normalizeJobStatus(String(row.status));
  const requiresArtifact = kind === "preview" || kind === "render" || kind === "editing-proxy";
  const status = baseStatus === "completed" && requiresArtifact && !artifact.filePath ? "interrupted" : baseStatus;
  const errorCode =
    baseStatus === "completed" && requiresArtifact && !artifact.filePath
      ? "artifact_missing"
      : row.error_code
        ? String(row.error_code)
        : null;
  const errorMessage =
    baseStatus === "completed" && requiresArtifact && !artifact.filePath
      ? "Stage 3 artifact is missing and the job must be retried."
      : row.error_message
        ? String(row.error_message)
        : null;

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    kind,
    status,
    executionTarget: normalizeExecutionTarget(row.execution_target),
    assignedWorkerId: row.assigned_worker_id ? String(row.assigned_worker_id) : null,
    workerLabel: row.assigned_worker_label ? String(row.assigned_worker_label) : null,
    leaseUntil: row.lease_expires_at ? String(row.lease_expires_at) : null,
    lastHeartbeatAt: row.heartbeat_at ? String(row.heartbeat_at) : null,
    dedupeKey: row.dedupe_key ? String(row.dedupe_key) : null,
    payloadJson: String(row.payload_json),
    resultJson: row.result_json ? String(row.result_json) : null,
    errorCode,
    errorMessage,
    recoverable: baseStatus === "completed" && requiresArtifact && !artifact.filePath ? true : Boolean(row.recoverable),
    attempts: Number(row.attempts) || 0,
    attemptLimit: Number(row.attempt_limit) || 3,
    attemptGroup: row.attempt_group ? String(row.attempt_group) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    artifact: artifact.artifact,
    artifactFilePath: artifact.filePath
  };
}

function readJobRow(jobId: string): JobRow | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `WITH latest_artifacts AS (
            SELECT
              a.*,
              ROW_NUMBER() OVER (
                PARTITION BY a.job_id
                ORDER BY a.created_at DESC, a.id DESC
              ) AS row_num
            FROM stage3_job_artifacts a
          )
          SELECT
            j.*,
            w.label AS assigned_worker_label,
            a.id AS artifact_id,
            a.job_id AS artifact_job_id,
            a.kind AS artifact_kind,
            a.file_name AS artifact_file_name,
            a.mime_type AS artifact_mime_type,
            a.file_path AS artifact_file_path,
            a.size_bytes AS artifact_size_bytes,
            a.created_at AS artifact_created_at
          FROM stage3_jobs j
          LEFT JOIN stage3_workers w
            ON w.id = j.assigned_worker_id
          LEFT JOIN latest_artifacts a
            ON a.job_id = j.id
           AND a.row_num = 1
         WHERE j.id = ?
         LIMIT 1`
      )
      .get(jobId) as JobRow | undefined) ?? null
  );
}

function parseStage3JobPayload(payloadJson: string): {
  chatId: string | null;
  channelId: string | null;
  sourceUrl: string | null;
} {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    return {
      chatId: typeof parsed.chatId === "string" && parsed.chatId.trim() ? parsed.chatId.trim() : null,
      channelId: typeof parsed.channelId === "string" && parsed.channelId.trim() ? parsed.channelId.trim() : null,
      sourceUrl: typeof parsed.sourceUrl === "string" && parsed.sourceUrl.trim() ? parsed.sourceUrl.trim() : null
    };
  } catch {
    return { chatId: null, channelId: null, sourceUrl: null };
  }
}

function buildQueuedMediaSupersessionKey(row: Pick<JobRow, "workspace_id" | "user_id" | "payload_json">): string | null {
  const payload = parseStage3JobPayload(row.payload_json);
  const renderSource = payload.chatId ? `chat:${payload.chatId}` : payload.sourceUrl ? `source:${payload.sourceUrl}` : null;
  if (!renderSource) {
    return null;
  }
  return `${row.workspace_id}:${row.user_id}:${renderSource}`;
}

function auditStage3Job(
  action: string,
  job: Pick<
    Stage3JobRecord,
    | "id"
    | "workspaceId"
    | "userId"
    | "kind"
    | "status"
    | "executionTarget"
    | "payloadJson"
    | "errorCode"
    | "errorMessage"
    | "attempts"
    | "createdAt"
    | "updatedAt"
    | "startedAt"
    | "completedAt"
  >,
  status: "queued" | "running" | "completed" | "failed",
  extra?: Record<string, unknown>
): void {
  const payload = parseStage3JobPayload(job.payloadJson);
  tryAppendFlowAuditEvent({
    workspaceId: job.workspaceId,
    userId: job.userId,
    action,
    entityType: "stage3_job",
    entityId: job.id,
    channelId: payload.channelId,
    chatId: payload.chatId,
    correlationId: job.id,
    stage: "stage3",
    status,
    severity: status === "failed" ? "error" : "info",
    payload: {
      kind: job.kind,
      executionTarget: job.executionTarget,
      attempts: job.attempts,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      ...extra
    },
    createdAt: job.completedAt ?? job.startedAt ?? job.updatedAt
  });
}

export function appendStage3JobEvent(
  jobId: string,
  level: "info" | "warn" | "error",
  message: string,
  payload?: Record<string, unknown> | null
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO stage3_job_events
      (id, job_id, level, message, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
  ).run(newId(), jobId, level, message, payload ? JSON.stringify(payload) : null, nowIso());
}

function clearStage3JobArtifacts(jobId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM stage3_job_artifacts WHERE job_id = ?").run(jobId);
}

function shouldResetTerminalRetryAttempts(
  existing: Stage3JobRecord,
  input: EnqueueStage3JobInput
): boolean {
  if (input.reuseCompleted === false) {
    return true;
  }
  return existing.status === "failed" && existing.errorCode === "artifact_storage_full";
}

export function getStage3Job(jobId: string): Stage3JobRecord | null {
  return mapJobRow(readJobRow(jobId));
}

export function interruptPendingStage3Jobs(): number {
  const stamp = nowIso();
  return runInTransaction((db) => {
    const rows = db
      .prepare("SELECT id FROM stage3_jobs WHERE execution_target = 'host' AND status IN ('queued', 'running')")
      .all() as Array<{ id: string }>;
    if (!rows.length) {
      return 0;
    }
    db.prepare(
      `UPDATE stage3_jobs
          SET status = 'interrupted',
              error_code = 'process_restart',
              error_message = ?,
              recoverable = 1,
              completed_at = ?,
              updated_at = ?,
              assigned_worker_id = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL
        WHERE execution_target = 'host'
          AND status IN ('queued', 'running')`
    ).run("Stage 3 host job interrupted by process restart.", stamp, stamp);
    for (const row of rows) {
      appendStage3JobEvent(String(row.id), "warn", "Host job interrupted during process bootstrap.", {
        reason: "process_restart"
      });
    }
    return rows.length;
  });
}

export function enqueueStage3Job(input: EnqueueStage3JobInput): Stage3JobRecord {
  const job = runInTransaction((db) => {
    const stamp = nowIso();
    const dedupeKey = input.dedupeKey?.trim() || null;
    const executionTarget = input.executionTarget ?? "local";
    const attemptLimit =
      typeof input.attemptLimit === "number" && Number.isFinite(input.attemptLimit) && input.attemptLimit > 0
        ? Math.max(1, Math.round(input.attemptLimit))
        : 3;
    const attemptGroup = input.attemptGroup?.trim() || null;

    if (dedupeKey) {
      const existingRow =
        (db
          .prepare("SELECT * FROM stage3_jobs WHERE kind = ? AND execution_target = ? AND dedupe_key = ? LIMIT 1")
          .get(input.kind, executionTarget, dedupeKey) as JobRow | undefined) ?? null;
      const existing = existingRow ? mapJobRow(readJobRow(String(existingRow.id))) : null;
      if (existing) {
        if (
          (existing.status === "queued" || existing.status === "running") &&
          existing.executionTarget === executionTarget
        ) {
          appendStage3JobEvent(existing.id, "info", "Reused in-flight job.", {
            kind: existing.kind,
            dedupeKey
          });
          return existing;
        }
        if (input.reuseCompleted !== false && existing.status === "completed" && existing.artifactFilePath) {
          appendStage3JobEvent(existing.id, "info", "Reused completed job.", {
            kind: existing.kind,
            dedupeKey
          });
          return existing;
        }

        const resetAttempts = shouldResetTerminalRetryAttempts(existing, input);
        const previousAttempts = Math.max(0, Number(existing.attempts) || 0);
        const terminalRetry =
          existing.status === "failed" || existing.status === "interrupted";
        if (terminalRetry && !resetAttempts && previousAttempts >= attemptLimit) {
          appendStage3JobEvent(existing.id, "warn", "Skipped automatic retry after max attempts.", {
            kind: existing.kind,
            dedupeKey,
            attempts: previousAttempts,
            attemptLimit
          });
          return existing;
        }

        clearStage3JobArtifacts(existing.id);
        db.prepare(
          `UPDATE stage3_jobs
              SET workspace_id = ?,
                  user_id = ?,
                  status = 'queued',
                  execution_target = ?,
                  assigned_worker_id = NULL,
                  lease_expires_at = NULL,
                  heartbeat_at = NULL,
                  payload_json = ?,
                  result_json = NULL,
                  error_code = NULL,
                  error_message = NULL,
                  recoverable = 1,
                  attempts = ?,
                  started_at = NULL,
                  completed_at = NULL,
                  attempt_limit = ?,
                  attempt_group = ?,
                  updated_at = ?
            WHERE id = ?`
        ).run(
          input.workspaceId,
          input.userId,
          executionTarget,
          input.payloadJson,
          resetAttempts || !terminalRetry ? 0 : previousAttempts,
          attemptLimit,
          attemptGroup,
          stamp,
          existing.id
        );
        appendStage3JobEvent(existing.id, "info", "Queued job for retry.", {
          kind: existing.kind,
          dedupeKey,
          executionTarget,
          resetAttempts
        });
        return mapJobRow(readJobRow(existing.id)) as Stage3JobRecord;
      }
    }

    const jobId = newId();
    db.prepare(
      `INSERT INTO stage3_jobs
        (id, workspace_id, user_id, kind, status, execution_target, assigned_worker_id, lease_expires_at, heartbeat_at, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, attempt_limit, attempt_group, created_at, updated_at, started_at, completed_at)
        VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL, 1, 0, ?, ?, ?, ?, NULL, NULL)`
    ).run(
      jobId,
      input.workspaceId,
      input.userId,
      input.kind,
      executionTarget,
      dedupeKey,
      input.payloadJson,
      attemptLimit,
      attemptGroup,
      stamp,
      stamp
    );
    appendStage3JobEvent(jobId, "info", "Queued job.", {
      kind: input.kind,
      dedupeKey,
      executionTarget
    });
    return mapJobRow(readJobRow(jobId)) as Stage3JobRecord;
  });
  auditStage3Job("stage3_job.queued", job, "queued", {
    dedupeKey: job.dedupeKey
  });
  return job;
}

function requeueExpiredLocalJobsInternal(db: ReturnType<typeof getDb>): void {
  const stamp = nowIso();
  const expired = db.prepare(
    `SELECT *
       FROM stage3_jobs
      WHERE execution_target = 'local'
        AND status = 'running'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at <= ?`
  ).all(stamp) as JobRow[];

  for (const row of expired) {
    const attempts = Number(row.attempts) || 0;
    const attemptLimit = Number(row.attempt_limit) || 3;
    if (attempts >= attemptLimit) {
      db.prepare(
        `UPDATE stage3_jobs
            SET status = 'failed',
                error_code = 'worker_unavailable',
                error_message = ?,
                recoverable = 1,
                completed_at = ?,
                updated_at = ?,
                assigned_worker_id = NULL,
                lease_expires_at = NULL,
                heartbeat_at = NULL
          WHERE id = ?`
      ).run("Локальный executor перестал отвечать во время выполнения Stage 3 job.", stamp, stamp, row.id);
      appendStage3JobEvent(String(row.id), "warn", "Local worker lease expired; job failed after max attempts.", {
        attempts,
        attemptLimit
      });
      continue;
    }

    db.prepare(
      `UPDATE stage3_jobs
          SET status = 'queued',
              error_code = NULL,
              error_message = NULL,
              completed_at = NULL,
              updated_at = ?,
              assigned_worker_id = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL
        WHERE id = ?`
    ).run(stamp, row.id);
    appendStage3JobEvent(String(row.id), "warn", "Local worker lease expired; job returned to queue.", {
      attempts,
      attemptLimit
    });
  }
}

function failOverdueLocalJobsInternal(db: ReturnType<typeof getDb>): number {
  const nowMs = Date.now();
  const stamp = new Date(nowMs).toISOString();
  const running = db.prepare(
    `SELECT *
       FROM stage3_jobs
      WHERE execution_target = 'local'
        AND status = 'running'`
  ).all() as JobRow[];
  let failed = 0;

  for (const row of running) {
    const kind = normalizeJobKind(String(row.kind));
    const startedAtMs = getStage3JobRunningStartedAtMs(row);
    if (startedAtMs === null) {
      continue;
    }
    const timeoutMs = resolveStage3ServerWatchdogTimeoutMs(kind);
    if (nowMs - startedAtMs < timeoutMs) {
      continue;
    }

    const timeoutSec = Math.round(resolveStage3WorkerJobTimeoutMs(kind) / 1000);
    const result = db.prepare(
      `UPDATE stage3_jobs
          SET status = 'failed',
              error_code = ?,
              error_message = ?,
              recoverable = 1,
              completed_at = ?,
              updated_at = ?,
              assigned_worker_id = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL
        WHERE id = ?
          AND execution_target = 'local'
          AND status = 'running'`
    ).run(
      buildStage3JobTimeoutErrorCode(kind),
      `Локальный executor не завершил ${kind} за ${timeoutSec} секунд; серверный watchdog остановил зависшую Stage 3 job.`,
      stamp,
      stamp,
      row.id
    );
    if ((result.changes ?? 0) === 0) {
      continue;
    }
    appendStage3JobEvent(String(row.id), "error", "Local worker job exceeded server watchdog; job failed.", {
      kind,
      timeoutMs,
      workerId: row.assigned_worker_id ?? null,
      startedAt: row.started_at ?? null,
      lastHeartbeatAt: row.heartbeat_at ?? null,
      leaseUntil: row.lease_expires_at ?? null
    });
    failed += 1;
  }

  return failed;
}

function failQueuedLocalJobsWithoutOnlineWorkerInternal(db: ReturnType<typeof getDb>): number {
  const nowMs = Date.now();
  const stamp = new Date(nowMs).toISOString();
  const queuedCutoff = new Date(nowMs - LOCAL_STAGE3_QUEUED_WORKER_UNAVAILABLE_GRACE_MS).toISOString();
  const workerOnlineCutoff = new Date(nowMs - STAGE3_WORKER_ONLINE_WINDOW_MS).toISOString();
  const rows = db
    .prepare(
      `SELECT q.*
         FROM stage3_jobs q
        WHERE q.execution_target = 'local'
          AND q.status = 'queued'
          AND q.updated_at <= ?
          AND NOT EXISTS (
            SELECT 1
              FROM stage3_jobs running
             WHERE running.execution_target = 'local'
               AND running.status = 'running'
               AND running.workspace_id = q.workspace_id
               AND running.user_id = q.user_id
          )
          AND NOT EXISTS (
            SELECT 1
              FROM stage3_workers worker
             WHERE worker.workspace_id = q.workspace_id
               AND worker.user_id = q.user_id
               AND worker.revoked_at IS NULL
               AND worker.last_seen_at IS NOT NULL
               AND worker.last_seen_at > ?
          )
        ORDER BY q.updated_at ASC, q.created_at ASC`
    )
    .all(queuedCutoff, workerOnlineCutoff) as JobRow[];

  if (!rows.length) {
    return 0;
  }

  const statement = db.prepare(
    `UPDATE stage3_jobs
        SET status = 'failed',
            error_code = 'worker_unavailable',
            error_message = ?,
            recoverable = 1,
            completed_at = ?,
            updated_at = ?,
            assigned_worker_id = NULL,
            lease_expires_at = NULL,
            heartbeat_at = NULL
      WHERE id = ?
        AND execution_target = 'local'
        AND status = 'queued'`
  );
  let failed = 0;
  for (const row of rows) {
    const kind = normalizeJobKind(String(row.kind));
    const waitedSec = Math.round(LOCAL_STAGE3_QUEUED_WORKER_UNAVAILABLE_GRACE_MS / 1000);
    const result = statement.run(
      `Локальный executor Stage 3 недоступен: ${kind} ждал executor больше ${waitedSec} секунд. ` +
        "Перезапустите Clips Worker/bootstrap и повторите действие.",
      stamp,
      stamp,
      row.id
    );
    if ((result.changes ?? 0) === 0) {
      continue;
    }
    appendStage3JobEvent(String(row.id), "error", "Queued local job exceeded worker availability grace; job failed.", {
      kind,
      queuedSince: row.updated_at,
      queuedGraceMs: LOCAL_STAGE3_QUEUED_WORKER_UNAVAILABLE_GRACE_MS,
      workerOnlineWindowMs: STAGE3_WORKER_ONLINE_WINDOW_MS
    });
    const updated = mapJobRow(readJobRow(String(row.id)));
    if (updated) {
      auditStage3Job("stage3_job.failed", updated, "failed", {
        errorCode: "worker_unavailable",
        recoverable: true,
        reason: "queued_worker_unavailable"
      });
    }
    failed += 1;
  }

  return failed;
}

function requeueRunningJobsForWorkerInternal(
  db: ReturnType<typeof getDb>,
  input: Pick<ClaimStage3WorkerJobInput, "workerId" | "workspaceId" | "userId" | "supportedKinds">
): number {
  const staleHeartbeatCutoff = new Date(Date.now() - LOCAL_STAGE3_WORKER_RESTART_RECOVERY_GRACE_MS).toISOString();
  const kinds = (input.supportedKinds?.length ? input.supportedKinds : null) as Stage3JobKind[] | null;
  const userId = input.userId.trim();
  const query = kinds
    ? `SELECT *
         FROM stage3_jobs
        WHERE execution_target = 'local'
          AND status = 'running'
          AND assigned_worker_id = ?
          AND workspace_id = ?
          AND user_id = ?
          AND (heartbeat_at IS NULL OR heartbeat_at <= ?)
          AND kind IN (${kinds.map(() => "?").join(", ")})
        ORDER BY updated_at ASC, created_at ASC`
    : `SELECT *
         FROM stage3_jobs
        WHERE execution_target = 'local'
          AND status = 'running'
          AND assigned_worker_id = ?
          AND workspace_id = ?
          AND user_id = ?
          AND (heartbeat_at IS NULL OR heartbeat_at <= ?)
        ORDER BY updated_at ASC, created_at ASC`;
  const baseParams = [input.workerId, input.workspaceId, userId, staleHeartbeatCutoff];
  const params = kinds
    ? [...baseParams, ...kinds]
    : baseParams;
  const rows = db.prepare(query).all(...params) as JobRow[];
  if (!rows.length) {
    return 0;
  }

  const stamp = nowIso();
  let recovered = 0;
  for (const row of rows) {
    const attempts = Number(row.attempts) || 0;
    const attemptLimit = Number(row.attempt_limit) || 3;
    if (attempts >= attemptLimit) {
      const result = db.prepare(
        `UPDATE stage3_jobs
            SET status = 'failed',
                error_code = 'worker_restart_attempt_limit',
                error_message = ?,
                recoverable = 1,
                completed_at = ?,
                updated_at = ?,
                assigned_worker_id = NULL,
                lease_expires_at = NULL,
                heartbeat_at = NULL
          WHERE id = ?
            AND status = 'running'
            AND assigned_worker_id = ?
            AND (heartbeat_at IS NULL OR heartbeat_at <= ?)`
      ).run(
        "Локальный executor был перезапущен до завершения Stage 3 job, и лимит повторных попыток исчерпан.",
        stamp,
        stamp,
        row.id,
        input.workerId,
        staleHeartbeatCutoff
      );
      if ((result.changes ?? 0) > 0) {
        appendStage3JobEvent(String(row.id), "warn", "Local worker restart recovery failed after max attempts.", {
          workerId: input.workerId,
          attempts,
          attemptLimit
        });
        recovered += 1;
      }
      continue;
    }

    const result = db.prepare(
      `UPDATE stage3_jobs
          SET status = 'queued',
              error_code = NULL,
              error_message = NULL,
              completed_at = NULL,
              updated_at = ?,
              assigned_worker_id = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL
        WHERE id = ?
          AND status = 'running'
          AND assigned_worker_id = ?
          AND (heartbeat_at IS NULL OR heartbeat_at <= ?)`
    ).run(stamp, row.id, input.workerId, staleHeartbeatCutoff);
    if ((result.changes ?? 0) > 0) {
      appendStage3JobEvent(String(row.id), "warn", "Local worker restarted; job returned to queue.", {
        workerId: input.workerId,
        attempts,
        attemptLimit
      });
      recovered += 1;
    }
  }

  return recovered;
}

function interruptSupersededQueuedLocalRenderJobsInternal(db: ReturnType<typeof getDb>): number {
  const rows = db
    .prepare(
      `SELECT *
         FROM stage3_jobs
        WHERE execution_target = 'local'
          AND kind = 'render'
          AND status = 'queued'
        ORDER BY created_at DESC, rowid DESC`
    )
    .all() as JobRow[];
  const seen = new Set<string>();
  const superseded: JobRow[] = [];

  for (const row of rows) {
    const key = buildQueuedMediaSupersessionKey(row);
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      superseded.push(row);
      continue;
    }
    seen.add(key);
  }

  if (!superseded.length) {
    return 0;
  }

  const stamp = nowIso();
  const statement = db.prepare(
    `UPDATE stage3_jobs
        SET status = 'interrupted',
            error_code = 'superseded_render_request',
            error_message = ?,
            recoverable = 1,
            completed_at = ?,
            updated_at = ?,
            assigned_worker_id = NULL,
            lease_expires_at = NULL,
            heartbeat_at = NULL
      WHERE id = ?
        AND execution_target = 'local'
        AND kind = 'render'
        AND status = 'queued'`
  );

  for (const row of superseded) {
    statement.run("Более новый render для этого материала заменил ожидающее Stage 3 задание.", stamp, stamp, row.id);
    appendStage3JobEvent(String(row.id), "warn", "Queued render job superseded by a newer render request.", {
      reason: "superseded_render_request"
    });
  }

  return superseded.length;
}

function interruptSupersededQueuedLocalPreviewJobsInternal(db: ReturnType<typeof getDb>): number {
  const rows = db
    .prepare(
      `SELECT *
         FROM stage3_jobs
        WHERE execution_target = 'local'
          AND kind = 'preview'
          AND status = 'queued'
        ORDER BY created_at DESC, rowid DESC`
    )
    .all() as JobRow[];
  const seen = new Set<string>();
  const superseded: JobRow[] = [];

  for (const row of rows) {
    const key = buildQueuedMediaSupersessionKey(row);
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      superseded.push(row);
      continue;
    }
    seen.add(key);
  }

  if (!superseded.length) {
    return 0;
  }

  const stamp = nowIso();
  const statement = db.prepare(
    `UPDATE stage3_jobs
        SET status = 'interrupted',
            error_code = 'superseded_preview_request',
            error_message = ?,
            recoverable = 1,
            completed_at = ?,
            updated_at = ?,
            assigned_worker_id = NULL,
            lease_expires_at = NULL,
            heartbeat_at = NULL
      WHERE id = ?
        AND execution_target = 'local'
        AND kind = 'preview'
        AND status = 'queued'`
  );

  for (const row of superseded) {
    statement.run("Более новый preview для этого материала заменил ожидающее Stage 3 задание.", stamp, stamp, row.id);
    appendStage3JobEvent(String(row.id), "warn", "Queued preview job superseded by a newer preview request.", {
      reason: "superseded_preview_request"
    });
  }

  return superseded.length;
}

export function failQueuedLocalStage3JobsForWorkerUpdateRequired(
  input: FailQueuedLocalJobsForWorkerUpdateInput
): number {
  const userId = input.userId.trim();
  if (!userId) {
    return 0;
  }
  const kinds = (input.supportedKinds?.length ? input.supportedKinds : null) as Stage3JobKind[] | null;
  const expectedRuntimeVersion = input.expectedRuntimeVersion?.trim() || "latest";
  const workerAppVersion = input.workerAppVersion?.trim() || "unknown";
  const message =
    `Локальный executor устарел (worker: ${workerAppVersion}, требуется: ${expectedRuntimeVersion}). ` +
    "Обновите/перезапустите worker через bootstrap и повторите Stage 3 render.";
  const failedJobs = runInTransaction((db) => {
    const query = kinds
      ? `SELECT *
           FROM stage3_jobs
          WHERE execution_target = 'local'
            AND workspace_id = ?
            AND user_id = ?
            AND status = 'queued'
            AND kind IN (${kinds.map(() => "?").join(", ")})
          ORDER BY created_at ASC`
      : `SELECT *
           FROM stage3_jobs
          WHERE execution_target = 'local'
            AND workspace_id = ?
            AND user_id = ?
            AND status = 'queued'
          ORDER BY created_at ASC`;
    const params = kinds ? [input.workspaceId, userId, ...kinds] : [input.workspaceId, userId];
    const rows = db.prepare(query).all(...params) as JobRow[];
    if (!rows.length) {
      return [];
    }
    const stamp = nowIso();
    const statement = db.prepare(
      `UPDATE stage3_jobs
          SET status = 'failed',
              error_code = 'worker_runtime_outdated',
              error_message = ?,
              recoverable = 1,
              completed_at = ?,
              updated_at = ?,
              assigned_worker_id = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL
        WHERE id = ?
          AND execution_target = 'local'
          AND status = 'queued'`
    );
    const updatedJobs: Stage3JobRecord[] = [];
    for (const row of rows) {
      const result = statement.run(message, stamp, stamp, row.id);
      if ((result.changes ?? 0) === 0) {
        continue;
      }
      appendStage3JobEvent(String(row.id), "error", "Queued local job blocked by outdated worker runtime.", {
        workerId: input.workerId ?? null,
        workerAppVersion,
        expectedRuntimeVersion
      });
      const updated = mapJobRow(readJobRow(String(row.id)));
      if (updated) {
        updatedJobs.push(updated);
      }
    }
    return updatedJobs;
  });
  for (const job of failedJobs) {
    auditStage3Job("stage3_job.failed", job, "failed", {
      errorCode: "worker_runtime_outdated",
      recoverable: true,
      workerId: input.workerId ?? null,
      workerAppVersion,
      expectedRuntimeVersion
    });
  }
  return failedJobs.length;
}

export function sweepExpiredLocalStage3Jobs(): number {
  return runInTransaction((db) => {
    const stamp = nowIso();
    const before = db.prepare(
      `SELECT COUNT(*) AS count
         FROM stage3_jobs
        WHERE execution_target = 'local'
          AND status = 'running'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at <= ?`
    ).get(stamp) as { count?: number } | undefined;
    const overdue = failOverdueLocalJobsInternal(db);
    requeueExpiredLocalJobsInternal(db);
    const superseded =
      interruptSupersededQueuedLocalRenderJobsInternal(db) +
      interruptSupersededQueuedLocalPreviewJobsInternal(db);
    const unavailable = failQueuedLocalJobsWithoutOnlineWorkerInternal(db);
    return overdue + (Number(before?.count) || 0) + superseded + unavailable;
  });
}

export function claimNextQueuedStage3Job(): Stage3JobRecord | null {
  const job = runInTransaction((db) => {
    const row =
      (db
        .prepare(
            `SELECT *
               FROM stage3_jobs
              WHERE execution_target = 'host'
                AND status = 'queued'
              ORDER BY
                ${buildHostStage3JobPrioritySql("kind")} ASC,
                created_at ASC
              LIMIT 1`
        )
        .get() as JobRow | undefined) ?? null;
    if (!row) {
      return null;
    }

    const stamp = nowIso();
    db.prepare(
      `UPDATE stage3_jobs
          SET status = 'running',
              attempts = attempts + 1,
              started_at = COALESCE(started_at, ?),
              updated_at = ?,
              assigned_worker_id = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL
        WHERE id = ?`
    ).run(stamp, stamp, row.id);
    appendStage3JobEvent(String(row.id), "info", "Started host job execution.", {
      attempts: (Number(row.attempts) || 0) + 1
    });
    return mapJobRow(readJobRow(String(row.id)));
  });
  if (job) {
    auditStage3Job("stage3_job.running", job, "running", {
      worker: "host"
    });
  }
  return job;
}

export function claimNextQueuedStage3JobForWorker(input: ClaimStage3WorkerJobInput): Stage3JobRecord | null {
  if (!input.userId.trim()) {
    throw new Error("Stage 3 local worker claim requires a user scope.");
  }
  const leaseDurationMs =
    typeof input.leaseDurationMs === "number" && Number.isFinite(input.leaseDurationMs) && input.leaseDurationMs > 0
      ? input.leaseDurationMs
      : DEFAULT_LOCAL_STAGE3_WORKER_LEASE_MS;

  const job = runInTransaction((db) => {
    failOverdueLocalJobsInternal(db);
    requeueExpiredLocalJobsInternal(db);
    requeueRunningJobsForWorkerInternal(db, input);
    interruptSupersededQueuedLocalRenderJobsInternal(db);
    interruptSupersededQueuedLocalPreviewJobsInternal(db);

    const kinds = (input.supportedKinds?.length ? input.supportedKinds : null) as Stage3JobKind[] | null;
    const userId = input.userId.trim();
    const query = kinds
      ? `SELECT * FROM stage3_jobs
          WHERE execution_target = 'local'
            AND workspace_id = ?
            AND user_id = ?
            AND status = 'queued'
            AND kind IN (${kinds.map(() => "?").join(", ")})
          ORDER BY ${buildLocalStage3JobPrioritySql("kind")} ASC, created_at ASC
          LIMIT 1`
      : `SELECT * FROM stage3_jobs
          WHERE execution_target = 'local'
            AND workspace_id = ?
            AND user_id = ?
            AND status = 'queued'
          ORDER BY ${buildLocalStage3JobPrioritySql("kind")} ASC, created_at ASC
          LIMIT 1`;
    const baseParams = [input.workspaceId, userId];
    const params = kinds
      ? [...baseParams, ...kinds]
      : baseParams;
    const row = (db.prepare(query).get(...params) as JobRow | undefined) ?? null;
    if (!row) {
      return null;
    }

    const stamp = nowIso();
    const leaseUntil = new Date(Date.now() + leaseDurationMs).toISOString();
    db.prepare(
      `UPDATE stage3_jobs
          SET status = 'running',
              attempts = attempts + 1,
              started_at = COALESCE(started_at, ?),
              updated_at = ?,
              assigned_worker_id = ?,
              lease_expires_at = ?,
              heartbeat_at = ?
        WHERE id = ?
          AND status = 'queued'`
    ).run(stamp, stamp, input.workerId, leaseUntil, stamp, row.id);
    const updated = readJobRow(String(row.id));
    if (!updated || updated.status !== "running" || updated.assigned_worker_id !== input.workerId) {
      return null;
    }
    appendStage3JobEvent(String(row.id), "info", "Local worker claimed job.", {
      workerId: input.workerId,
      attempts: (Number(row.attempts) || 0) + 1,
      leaseUntil
    });
    return mapJobRow(readJobRow(String(row.id)));
  });
  if (job) {
    auditStage3Job("stage3_job.running", job, "running", {
      workerId: input.workerId,
      worker: "local"
    });
  }
  return job;
}

export function heartbeatStage3Job(
  jobId: string,
  workerId: string,
  leaseDurationMs = DEFAULT_LOCAL_STAGE3_WORKER_LEASE_MS
): Stage3JobRecord {
  const stamp = nowIso();
  const leaseUntil = new Date(Date.now() + leaseDurationMs).toISOString();
  const db = getDb();
  const result = db.prepare(
    `UPDATE stage3_jobs
        SET heartbeat_at = ?,
            lease_expires_at = ?,
            updated_at = ?
      WHERE id = ?
        AND assigned_worker_id = ?
        AND status = 'running'`
  ).run(stamp, leaseUntil, stamp, jobId, workerId);
  if ((result.changes ?? 0) === 0) {
    throw new Error("Stage 3 job is not leased by this worker.");
  }
  appendStage3JobEvent(jobId, "info", "Local worker heartbeat.", {
    workerId,
    leaseUntil
  });
  return mapJobRow(readJobRow(jobId)) as Stage3JobRecord;
}

export function touchStage3Job(jobId: string): void {
  const db = getDb();
  db.prepare("UPDATE stage3_jobs SET updated_at = ? WHERE id = ?").run(nowIso(), jobId);
}

export function hasQueuedStage3Jobs(executionTarget: Stage3ExecutionTarget = "host"): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT 1 as present FROM stage3_jobs WHERE execution_target = ? AND status = 'queued' LIMIT 1")
    .get(executionTarget) as { present?: number } | undefined;
  return row?.present === 1;
}

function buildStage3JobCompletionError(
  db: ReturnType<typeof getDb>,
  jobId: string,
  step: string,
  error: unknown
): Error {
  const row = db
    .prepare("SELECT 1 as present FROM stage3_jobs WHERE id = ? LIMIT 1")
    .get(jobId) as { present?: number } | undefined;
  const rowState = row?.present === 1 ? "job row present" : "job row missing";
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Stage 3 completion failed during ${step} for ${jobId} (${rowState}): ${message}`);
}

export function completeStage3Job(jobId: string, input: CompleteStage3JobInput): Stage3JobRecord {
  const job = runInTransaction((db) => {
    const stamp = nowIso();
    if (input.artifact) {
      try {
        clearStage3JobArtifacts(jobId);
        db.prepare(
          `INSERT INTO stage3_job_artifacts
            (id, job_id, kind, file_name, mime_type, file_path, size_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newId(),
          jobId,
          input.artifact.kind ?? "video",
          input.artifact.fileName,
          input.artifact.mimeType,
          input.artifact.filePath,
          input.artifact.sizeBytes,
          stamp
        );
      } catch (error) {
        throw buildStage3JobCompletionError(db, jobId, "artifact_persist", error);
      }
    }

    try {
      const result = db.prepare(
        `UPDATE stage3_jobs
            SET status = 'completed',
                result_json = ?,
                error_code = NULL,
                error_message = NULL,
                recoverable = 1,
                completed_at = ?,
                updated_at = ?,
                assigned_worker_id = NULL,
                lease_expires_at = NULL,
                heartbeat_at = NULL
          WHERE id = ?`
      ).run(input.resultJson ?? null, stamp, stamp, jobId);
      if ((result.changes ?? 0) === 0) {
        throw new Error("Stage 3 job row was not updated.");
      }
    } catch (error) {
      throw buildStage3JobCompletionError(db, jobId, "job_update", error);
    }
    try {
      appendStage3JobEvent(jobId, "info", "Completed job.", {
        artifact: Boolean(input.artifact)
      });
    } catch (error) {
      throw buildStage3JobCompletionError(db, jobId, "event_append", error);
    }
    return mapJobRow(readJobRow(jobId)) as Stage3JobRecord;
  });
  auditStage3Job("stage3_job.completed", job, "completed", {
    artifact: Boolean(input.artifact),
    artifactFileName: input.artifact?.fileName ?? null
  });
  return job;
}

export function finishStage3Job(jobId: string, input: FinishStage3JobInput): Stage3JobRecord {
  const job = runInTransaction((db) => {
    const stamp = nowIso();
    db.prepare(
      `UPDATE stage3_jobs
          SET status = ?,
              error_code = ?,
              error_message = ?,
              recoverable = ?,
              completed_at = ?,
              updated_at = ?,
              assigned_worker_id = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL
        WHERE id = ?`
    ).run(input.status, input.errorCode ?? null, input.errorMessage, input.recoverable ? 1 : 0, stamp, stamp, jobId);
    appendStage3JobEvent(jobId, input.status === "failed" ? "error" : "warn", input.errorMessage, {
      code: input.errorCode ?? null,
      recoverable: input.recoverable
    });
    return mapJobRow(readJobRow(jobId)) as Stage3JobRecord;
  });
  auditStage3Job("stage3_job.failed", job, "failed", {
    errorCode: input.errorCode ?? null,
    recoverable: input.recoverable
  });
  return job;
}
