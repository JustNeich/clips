import { existsSync } from "node:fs";
import {
  Stage3ExecutionTarget,
  Stage3JobArtifact,
  Stage3JobKind,
  Stage3JobStatus,
  Stage3JobSummary
} from "../app/components/types";
import { getDb, newId, nowIso, runInTransaction } from "./db/client";

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
};

type JobArtifactRow = {
  id: string;
  job_id: string;
  kind: string;
  file_name: string;
  mime_type: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
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

function readWorkerLabel(workerId: string | null | undefined): string | null {
  if (!workerId) {
    return null;
  }
  const db = getDb();
  const row = db.prepare("SELECT label FROM stage3_workers WHERE id = ? LIMIT 1").get(workerId) as
    | { label?: string | null }
    | undefined;
  return row?.label ? String(row.label) : null;
}

function mapArtifactRow(row: JobArtifactRow | null): { artifact: Stage3JobArtifact | null; filePath: string | null } {
  if (!row || !existsSync(row.file_path)) {
    return {
      artifact: null,
      filePath: null
    };
  }

  return {
    artifact: {
      id: String(row.id),
      jobId: String(row.job_id),
      kind: "video",
      fileName: String(row.file_name),
      mimeType: String(row.mime_type),
      sizeBytes: Number(row.size_bytes) || 0,
      createdAt: String(row.created_at),
      downloadUrl: null
    },
    filePath: String(row.file_path)
  };
}

function readArtifactRow(jobId: string): JobArtifactRow | null {
  const db = getDb();
  return (
    (db
      .prepare("SELECT * FROM stage3_job_artifacts WHERE job_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(jobId) as JobArtifactRow | undefined) ?? null
  );
}

function mapJobRow(row: JobRow | null): Stage3JobRecord | null {
  if (!row) {
    return null;
  }

  const kind = normalizeJobKind(String(row.kind));
  const artifactRow = readArtifactRow(String(row.id));
  const artifact = mapArtifactRow(artifactRow);
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
    workerLabel: readWorkerLabel(row.assigned_worker_id),
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
  return (db.prepare("SELECT * FROM stage3_jobs WHERE id = ?").get(jobId) as JobRow | undefined) ?? null;
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
  return runInTransaction((db) => {
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
          .prepare("SELECT * FROM stage3_jobs WHERE kind = ? AND dedupe_key = ? LIMIT 1")
          .get(input.kind, dedupeKey) as JobRow | undefined) ?? null;
      const existing = mapJobRow(existingRow);
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
        if (existing.status === "completed" && existing.artifactFilePath) {
          appendStage3JobEvent(existing.id, "info", "Reused completed job.", {
            kind: existing.kind,
            dedupeKey
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
          attemptLimit,
          attemptGroup,
          stamp,
          existing.id
        );
        appendStage3JobEvent(existing.id, "info", "Queued job for retry.", {
          kind: existing.kind,
          dedupeKey,
          executionTarget
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

export function claimNextQueuedStage3Job(): Stage3JobRecord | null {
  return runInTransaction((db) => {
    const row =
      (db
        .prepare(
          `SELECT *
             FROM stage3_jobs
            WHERE execution_target = 'host'
              AND status = 'queued'
            ORDER BY
              CASE
                WHEN kind = 'preview' THEN 1
                ELSE 0
              END ASC,
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
}

export function claimNextQueuedStage3JobForWorker(input: ClaimStage3WorkerJobInput): Stage3JobRecord | null {
  const leaseDurationMs =
    typeof input.leaseDurationMs === "number" && Number.isFinite(input.leaseDurationMs) && input.leaseDurationMs > 0
      ? input.leaseDurationMs
      : 30_000;

  return runInTransaction((db) => {
    requeueExpiredLocalJobsInternal(db);

    const kinds = (input.supportedKinds?.length ? input.supportedKinds : null) as Stage3JobKind[] | null;
    const query = kinds
      ? `SELECT * FROM stage3_jobs
          WHERE execution_target = 'local'
            AND workspace_id = ?
            AND user_id = ?
            AND status = 'queued'
            AND kind IN (${kinds.map(() => "?").join(", ")})
          ORDER BY created_at ASC
          LIMIT 1`
      : `SELECT * FROM stage3_jobs
          WHERE execution_target = 'local'
            AND workspace_id = ?
            AND user_id = ?
            AND status = 'queued'
          ORDER BY created_at ASC
          LIMIT 1`;
    const params = kinds
      ? [input.workspaceId, input.userId, ...kinds]
      : [input.workspaceId, input.userId];
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
        WHERE id = ?`
    ).run(stamp, stamp, input.workerId, leaseUntil, stamp, row.id);
    appendStage3JobEvent(String(row.id), "info", "Local worker claimed job.", {
      workerId: input.workerId,
      attempts: (Number(row.attempts) || 0) + 1,
      leaseUntil
    });
    return mapJobRow(readJobRow(String(row.id)));
  });
}

export function heartbeatStage3Job(jobId: string, workerId: string, leaseDurationMs = 30_000): Stage3JobRecord {
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

export function completeStage3Job(jobId: string, input: CompleteStage3JobInput): Stage3JobRecord {
  return runInTransaction((db) => {
    const stamp = nowIso();
    if (input.artifact) {
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
    }

    db.prepare(
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
    appendStage3JobEvent(jobId, "info", "Completed job.", {
      artifact: Boolean(input.artifact)
    });
    return mapJobRow(readJobRow(jobId)) as Stage3JobRecord;
  });
}

export function finishStage3Job(jobId: string, input: FinishStage3JobInput): Stage3JobRecord {
  return runInTransaction((db) => {
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
}
