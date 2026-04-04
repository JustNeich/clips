import type { CommentsPayload, SourceJobProgressSnapshot, SourceJobResult, SourceJobStageId, SourceJobStatus } from "../app/components/types";
import { getDb, newId, nowIso, runInTransaction } from "./db/client";

export type SourceJobTrigger = "fetch" | "comments";

export type SourceJobRequest = {
  sourceUrl: string;
  autoRunStage2: boolean;
  trigger: SourceJobTrigger;
  chat: {
    id: string;
    channelId: string;
  };
  channel: {
    id: string;
    name: string;
    username: string;
  };
};

export type SourceJobRecord = {
  jobId: string;
  workspaceId: string;
  creatorUserId: string | null;
  channelId: string;
  chatId: string;
  sourceUrl: string;
  request: SourceJobRequest;
  progress: SourceJobProgressSnapshot;
  status: SourceJobStatus;
  resultData: SourceJobResult | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};

type SourceJobRow = {
  job_id: string;
  workspace_id: string;
  creator_user_id?: string | null;
  channel_id: string;
  chat_id: string;
  source_url: string;
  request_json: string;
  status: string;
  progress_json: string;
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

function createSourceJobProgressSnapshot(jobId: string): SourceJobProgressSnapshot {
  const stamp = nowIso();
  return {
    status: "queued",
    activeStageId: "prepare",
    detail: `Job ${jobId.slice(0, 8)} ожидает запуска.`,
    createdAt: stamp,
    startedAt: null,
    updatedAt: stamp,
    finishedAt: null,
    error: null
  };
}

function mapSourceJob(row: SourceJobRow): SourceJobRecord {
  const progress =
    parseJsonOrNull<SourceJobProgressSnapshot>(row.progress_json) ??
    createSourceJobProgressSnapshot(String(row.job_id));
  const request = parseJsonOrNull<SourceJobRequest>(row.request_json);
  const sourceUrl = request?.sourceUrl?.trim() || String(row.source_url);
  const chatId = request?.chat.id?.trim() || String(row.chat_id);
  const channelId = request?.channel.id?.trim() || String(row.channel_id);

  return {
    jobId: String(row.job_id),
    workspaceId: String(row.workspace_id),
    creatorUserId: row.creator_user_id ? String(row.creator_user_id) : null,
    channelId,
    chatId,
    sourceUrl,
    request: request ?? {
      sourceUrl,
      autoRunStage2: false,
      trigger: "fetch",
      chat: { id: chatId, channelId },
      channel: {
        id: channelId,
        name: "",
        username: ""
      }
    },
    progress,
    status: (row.status as SourceJobStatus) ?? progress.status,
    resultData: parseJsonOrNull<SourceJobResult>(row.result_json),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    updatedAt: String(row.updated_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null
  };
}

function readSourceJobRow(jobId: string): SourceJobRow | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM source_jobs WHERE job_id = ? LIMIT 1").get(jobId) as SourceJobRow | undefined) ?? null;
}

function saveSourceJob(record: SourceJobRecord): SourceJobRecord {
  const db = getDb();
  db.prepare(
    `INSERT INTO source_jobs
      (
        job_id,
        workspace_id,
        creator_user_id,
        channel_id,
        chat_id,
        source_url,
        request_json,
        status,
        progress_json,
        result_json,
        error_message,
        created_at,
        started_at,
        updated_at,
        finished_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        creator_user_id = excluded.creator_user_id,
        channel_id = excluded.channel_id,
        chat_id = excluded.chat_id,
        source_url = excluded.source_url,
        request_json = excluded.request_json,
        status = excluded.status,
        progress_json = excluded.progress_json,
        result_json = excluded.result_json,
        error_message = excluded.error_message,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        finished_at = excluded.finished_at`
  ).run(
    record.jobId,
    record.workspaceId,
    record.creatorUserId,
    record.channelId,
    record.chatId,
    record.sourceUrl,
    JSON.stringify(record.request),
    record.status,
    JSON.stringify(record.progress),
    record.resultData === null ? null : JSON.stringify(record.resultData),
    record.errorMessage,
    record.createdAt,
    record.startedAt,
    record.updatedAt,
    record.finishedAt
  );

  const row = readSourceJobRow(record.jobId);
  if (!row) {
    throw new Error("Failed to persist source job record.");
  }
  return mapSourceJob(row);
}

function mutateSourceJob(
  jobId: string,
  mutator: (record: SourceJobRecord) => SourceJobRecord
): SourceJobRecord | null {
  return runInTransaction(() => {
    const current = getSourceJob(jobId);
    if (!current) {
      return null;
    }
    return saveSourceJob(mutator(current));
  });
}

function updateProgress(
  record: SourceJobRecord,
  input: Partial<Pick<SourceJobProgressSnapshot, "status" | "activeStageId" | "detail" | "finishedAt" | "error">>
): SourceJobProgressSnapshot {
  return {
    ...record.progress,
    ...input,
    startedAt:
      input.status === "running"
        ? record.progress.startedAt ?? nowIso()
        : record.progress.startedAt,
    updatedAt: nowIso()
  };
}

export function createSourceJob(input: {
  workspaceId: string;
  creatorUserId: string;
  request: SourceJobRequest;
}): SourceJobRecord {
  const stamp = nowIso();
  const jobId = newId();
  return saveSourceJob({
    jobId,
    workspaceId: input.workspaceId,
    creatorUserId: input.creatorUserId,
    channelId: input.request.channel.id,
    chatId: input.request.chat.id,
    sourceUrl: input.request.sourceUrl,
    request: input.request,
    progress: createSourceJobProgressSnapshot(jobId),
    status: "queued",
    resultData: null,
    errorMessage: null,
    createdAt: stamp,
    startedAt: null,
    updatedAt: stamp,
    finishedAt: null
  });
}

export function getSourceJob(jobId: string): SourceJobRecord | null {
  const row = readSourceJobRow(jobId);
  return row ? mapSourceJob(row) : null;
}

export function listSourceJobsForChat(
  chatId: string,
  workspaceId: string,
  limit = 20
): SourceJobRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM source_jobs
        WHERE workspace_id = ?
          AND chat_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(workspaceId, chatId, Math.max(1, Math.floor(limit))) as SourceJobRow[];
  return rows.map(mapSourceJob);
}

export function listLatestActiveSourceJobsForChats(
  chatIds: string[],
  workspaceId: string
): Map<string, SourceJobRecord> {
  if (chatIds.length === 0) {
    return new Map();
  }

  const placeholders = chatIds.map(() => "?").join(", ");
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM source_jobs
        WHERE workspace_id = ?
          AND chat_id IN (${placeholders})
          AND status IN ('queued', 'running')
        ORDER BY updated_at DESC`
    )
    .all(workspaceId, ...chatIds) as SourceJobRow[];

  const latestByChat = new Map<string, SourceJobRecord>();
  for (const row of rows) {
    const record = mapSourceJob(row);
    if (latestByChat.has(record.chatId)) {
      continue;
    }
    latestByChat.set(record.chatId, record);
  }
  return latestByChat;
}

export function findActiveSourceJobForChat(
  chatId: string,
  workspaceId: string
): SourceJobRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM source_jobs
        WHERE workspace_id = ?
          AND chat_id = ?
          AND status IN ('queued', 'running')
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .get(workspaceId, chatId) as SourceJobRow | undefined;
  return row ? mapSourceJob(row) : null;
}

export function hasQueuedSourceJobs(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT 1 AS present FROM source_jobs WHERE status = 'queued' LIMIT 1")
    .get() as { present?: number } | undefined;
  return row?.present === 1;
}

export function claimNextQueuedSourceJob(): SourceJobRecord | null {
  return runInTransaction((db) => {
    const row =
      (db
        .prepare("SELECT * FROM source_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
        .get() as SourceJobRow | undefined) ?? null;
    if (!row) {
      return null;
    }

    const current = mapSourceJob(row);
    const progress = updateProgress(current, {
      status: "running",
      activeStageId: "prepare",
      detail: "Подготавливаем источник и чат.",
      error: null
    });
    const startedAt = current.startedAt ?? progress.startedAt ?? nowIso();

    db.prepare(
      `UPDATE source_jobs
          SET status = 'running',
              progress_json = ?,
              error_message = NULL,
              started_at = ?,
              updated_at = ?
        WHERE job_id = ?`
    ).run(JSON.stringify(progress), startedAt, progress.updatedAt, current.jobId);

    return mapSourceJob(readSourceJobRow(current.jobId) as SourceJobRow);
  });
}

export function recoverInterruptedSourceJobs(detail = "Recovered after process restart. Re-running source fetch."): number {
  return runInTransaction((db) => {
    const rows = db
      .prepare("SELECT * FROM source_jobs WHERE status = 'running'")
      .all() as SourceJobRow[];
    if (rows.length === 0) {
      return 0;
    }

    for (const row of rows) {
      const record = mapSourceJob(row);
      const progress = {
        ...record.progress,
        status: "queued" as const,
        detail,
        error: null,
        updatedAt: nowIso(),
        startedAt: null,
        finishedAt: null,
        activeStageId: "prepare" as const
      };
      db.prepare(
        `UPDATE source_jobs
            SET status = 'queued',
                progress_json = ?,
                error_message = NULL,
                started_at = NULL,
                updated_at = ?,
                finished_at = NULL
          WHERE job_id = ?`
      ).run(JSON.stringify(progress), progress.updatedAt, record.jobId);
    }

    return rows.length;
  });
}

export function interruptRunningSourceJobs(
  message = "Source job stopped after process restart on hosted runtime. Start it again manually."
): number {
  return runInTransaction((db) => {
    const rows = db
      .prepare("SELECT * FROM source_jobs WHERE status = 'running'")
      .all() as SourceJobRow[];
    if (rows.length === 0) {
      return 0;
    }

    for (const row of rows) {
      const record = mapSourceJob(row);
      const finishedAt = nowIso();
      const progress = {
        ...record.progress,
        status: "failed" as const,
        detail: message,
        error: message,
        updatedAt: finishedAt,
        finishedAt,
        activeStageId: record.progress.activeStageId ?? "prepare"
      };
      db.prepare(
        `UPDATE source_jobs
            SET status = 'failed',
                progress_json = ?,
                error_message = ?,
                updated_at = ?,
                finished_at = ?
          WHERE job_id = ?`
      ).run(JSON.stringify(progress), message, progress.updatedAt, progress.finishedAt, record.jobId);
    }

    return rows.length;
  });
}

export function markSourceJobStageRunning(
  jobId: string,
  stageId: SourceJobStageId,
  detail: string
): SourceJobRecord | null {
  return mutateSourceJob(jobId, (record) => {
    const progress = updateProgress(record, {
      status: "running",
      activeStageId: stageId,
      detail,
      error: null
    });
    return {
      ...record,
      progress,
      status: progress.status,
      errorMessage: null,
      startedAt: progress.startedAt,
      updatedAt: progress.updatedAt,
      finishedAt: progress.finishedAt
    };
  });
}

export function finalizeSourceJobSuccess(
  jobId: string,
  resultData: SourceJobResult
): SourceJobRecord | null {
  return mutateSourceJob(jobId, (record) => {
    const finishedAt = nowIso();
    const progress = {
      ...record.progress,
      status: "completed" as const,
      activeStageId: null,
      detail: resultData.commentsAvailable
        ? `Источник готов. Загружено ${resultData.commentsPayload?.totalComments ?? 0} комментариев.`
        : "Источник готов. Продолжаем без комментариев.",
      error: null,
      updatedAt: finishedAt,
      finishedAt
    };
    return {
      ...record,
      progress,
      status: "completed",
      resultData,
      errorMessage: null,
      updatedAt: finishedAt,
      finishedAt
    };
  });
}

export function finalizeSourceJobFailure(jobId: string, errorMessage: string): SourceJobRecord | null {
  return mutateSourceJob(jobId, (record) => {
    const finishedAt = nowIso();
    const progress = {
      ...record.progress,
      status: "failed" as const,
      error: errorMessage,
      detail: errorMessage,
      updatedAt: finishedAt,
      finishedAt
    };
    return {
      ...record,
      progress,
      status: "failed",
      errorMessage,
      updatedAt: finishedAt,
      finishedAt
    };
  });
}
