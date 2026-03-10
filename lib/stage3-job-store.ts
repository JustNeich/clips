import { existsSync } from "node:fs";
import {
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
  dedupe_key: string | null;
  payload_json: string;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  recoverable: number;
  attempts: number;
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
};

type EnqueueStage3JobInput = {
  workspaceId: string;
  userId: string;
  kind: Stage3JobKind;
  payloadJson: string;
  dedupeKey?: string | null;
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

function normalizeJobKind(value: string): Stage3JobKind {
  if (
    value === "preview" ||
    value === "render" ||
    value === "source-download" ||
    value === "agent-media-step"
  ) {
    return value;
  }
  return "preview";
}

function normalizeJobStatus(value: string): Stage3JobStatus {
  if (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "interrupted"
  ) {
    return value;
  }
  return "failed";
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
      kind: row.kind === "video" ? "video" : "video",
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

  const artifactRow = readArtifactRow(String(row.id));
  const artifact = mapArtifactRow(artifactRow);
  const baseStatus = normalizeJobStatus(String(row.status));
  const status =
    baseStatus === "completed" && !artifact.filePath
      ? "interrupted"
      : baseStatus;
  const errorCode =
    baseStatus === "completed" && !artifact.filePath
      ? "artifact_missing"
      : row.error_code
        ? String(row.error_code)
        : null;
  const errorMessage =
    baseStatus === "completed" && !artifact.filePath
      ? "Stage 3 artifact is missing and the job must be retried."
      : row.error_message
        ? String(row.error_message)
        : null;

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    kind: normalizeJobKind(String(row.kind)),
    status,
    dedupeKey: row.dedupe_key ? String(row.dedupe_key) : null,
    payloadJson: String(row.payload_json),
    resultJson: row.result_json ? String(row.result_json) : null,
    errorCode,
    errorMessage,
    recoverable: baseStatus === "completed" && !artifact.filePath ? true : Boolean(row.recoverable),
    attempts: Number(row.attempts) || 0,
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
      .prepare("SELECT id FROM stage3_jobs WHERE status IN ('queued', 'running')")
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
              updated_at = ?
        WHERE status IN ('queued', 'running')`
    ).run("Stage 3 job interrupted by process restart.", stamp, stamp);
    for (const row of rows) {
      appendStage3JobEvent(String(row.id), "warn", "Job interrupted during process bootstrap.", {
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

    if (dedupeKey) {
      const existingRow =
        (db
          .prepare("SELECT * FROM stage3_jobs WHERE kind = ? AND dedupe_key = ? LIMIT 1")
          .get(input.kind, dedupeKey) as JobRow | undefined) ?? null;
      const existing = mapJobRow(existingRow);
      if (existing) {
        if (existing.status === "queued" || existing.status === "running") {
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
                  payload_json = ?,
                  result_json = NULL,
                  error_code = NULL,
                  error_message = NULL,
                  recoverable = 1,
                  started_at = NULL,
                  completed_at = NULL,
                  updated_at = ?
            WHERE id = ?`
        ).run(input.workspaceId, input.userId, input.payloadJson, stamp, existing.id);
        appendStage3JobEvent(existing.id, "info", "Queued job for retry.", {
          kind: existing.kind,
          dedupeKey
        });
        return mapJobRow(readJobRow(existing.id)) as Stage3JobRecord;
      }
    }

    const jobId = newId();
    db.prepare(
      `INSERT INTO stage3_jobs
        (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
        VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, NULL, NULL, 1, 0, ?, ?, NULL, NULL)`
    ).run(jobId, input.workspaceId, input.userId, input.kind, dedupeKey, input.payloadJson, stamp, stamp);
    appendStage3JobEvent(jobId, "info", "Queued job.", {
      kind: input.kind,
      dedupeKey
    });
    return mapJobRow(readJobRow(jobId)) as Stage3JobRecord;
  });
}

export function claimNextQueuedStage3Job(): Stage3JobRecord | null {
  return runInTransaction((db) => {
    const row =
      (db
        .prepare("SELECT * FROM stage3_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
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
              updated_at = ?
        WHERE id = ?`
    ).run(stamp, stamp, row.id);
    appendStage3JobEvent(String(row.id), "info", "Started job execution.", {
      attempts: (Number(row.attempts) || 0) + 1
    });
    return mapJobRow(readJobRow(String(row.id)));
  });
}

export function touchStage3Job(jobId: string): void {
  const db = getDb();
  db.prepare("UPDATE stage3_jobs SET updated_at = ? WHERE id = ?").run(nowIso(), jobId);
}

export function hasQueuedStage3Jobs(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT 1 as present FROM stage3_jobs WHERE status = 'queued' LIMIT 1")
    .get() as { present?: number } | undefined;
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
              updated_at = ?
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
              updated_at = ?
        WHERE id = ?`
    ).run(input.status, input.errorCode ?? null, input.errorMessage, input.recoverable ? 1 : 0, stamp, stamp, jobId);
    appendStage3JobEvent(jobId, input.status === "failed" ? "error" : "warn", input.errorMessage, {
      code: input.errorCode ?? null,
      recoverable: input.recoverable
    });
    return mapJobRow(readJobRow(jobId)) as Stage3JobRecord;
  });
}
