import {
  getDb,
  newId,
  nowIso,
  runInTransaction
} from "./db/client";
import {
  createStage2ProgressSnapshot,
  DEFAULT_STAGE2_PROMPT_CONFIG,
  finalizeStage2ProgressSuccess,
  markStage2ProgressStageCompleted,
  markStage2ProgressStageFailed,
  markStage2ProgressStageRunning,
  resetStage2ProgressForRetry,
  Stage2PipelineStageId,
  Stage2ProgressSnapshot,
  Stage2PromptConfig
} from "./stage2-pipeline";
import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "./stage2-channel-config";

export type Stage2RunMode = "manual" | "auto";

export type Stage2RunRequest = {
  sourceUrl: string;
  userInstruction: string | null;
  mode: Stage2RunMode;
  channel: {
    id: string;
    name: string;
    username: string;
    descriptionPrompt: string;
    examplesJson?: string;
    stage2WorkerProfileId: string | null;
    stage2ExamplesConfig: Stage2ExamplesConfig;
    stage2HardConstraints: Stage2HardConstraints;
    stage2PromptConfig: Stage2PromptConfig;
  };
};

export type Stage2RunRecord = {
  runId: string;
  workspaceId: string;
  creatorUserId: string | null;
  channelId: string | null;
  chatId: string | null;
  sourceUrl: string;
  userInstruction: string | null;
  mode: Stage2RunMode;
  request: Stage2RunRequest;
  snapshot: Stage2ProgressSnapshot;
  status: Stage2ProgressSnapshot["status"];
  resultData: unknown | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};

type Stage2RunRow = {
  run_id: string;
  workspace_id: string;
  creator_user_id?: string | null;
  channel_id?: string | null;
  chat_id?: string | null;
  source_url?: string | null;
  user_instruction?: string | null;
  mode?: string | null;
  request_json?: string | null;
  status: string;
  snapshot_json: string;
  result_json?: string | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  updated_at: string;
  finished_at?: string | null;
};

function normalizeMode(value: string | null | undefined): Stage2RunMode {
  return value === "auto" ? "auto" : "manual";
}

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

function normalizeRequest(record: Stage2RunRow, snapshot: Stage2ProgressSnapshot): Stage2RunRequest {
  const parsed = parseJsonOrNull<Partial<Stage2RunRequest>>(record.request_json);
  const mode = normalizeMode(parsed?.mode ?? record.mode);
  const sourceUrl = String(parsed?.sourceUrl ?? record.source_url ?? "").trim();
  const userInstruction =
    typeof parsed?.userInstruction === "string" && parsed.userInstruction.trim()
      ? parsed.userInstruction.trim()
      : record.user_instruction
        ? String(record.user_instruction).trim() || null
        : null;
  const channelCandidate =
    parsed?.channel && typeof parsed.channel === "object"
      ? (parsed.channel as Partial<Stage2RunRequest["channel"]>)
      : null;

  return {
    sourceUrl,
    userInstruction,
    mode,
    channel: {
      id: String(channelCandidate?.id ?? record.channel_id ?? "").trim(),
      name: String(channelCandidate?.name ?? "").trim(),
      username: String(channelCandidate?.username ?? "").trim(),
      descriptionPrompt: String(channelCandidate?.descriptionPrompt ?? "").trim(),
      examplesJson:
        typeof channelCandidate?.examplesJson === "string" ? channelCandidate.examplesJson : "[]",
      stage2WorkerProfileId:
        typeof channelCandidate?.stage2WorkerProfileId === "string" &&
        channelCandidate.stage2WorkerProfileId.trim()
          ? channelCandidate.stage2WorkerProfileId.trim()
          : null,
      stage2ExamplesConfig:
        channelCandidate?.stage2ExamplesConfig &&
        typeof channelCandidate.stage2ExamplesConfig === "object"
          ? (channelCandidate.stage2ExamplesConfig as Stage2ExamplesConfig)
          : DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints:
        channelCandidate?.stage2HardConstraints &&
        typeof channelCandidate.stage2HardConstraints === "object"
          ? (channelCandidate.stage2HardConstraints as Stage2HardConstraints)
          : DEFAULT_STAGE2_HARD_CONSTRAINTS,
      stage2PromptConfig:
        channelCandidate?.stage2PromptConfig && typeof channelCandidate.stage2PromptConfig === "object"
          ? (channelCandidate.stage2PromptConfig as Stage2PromptConfig)
          : DEFAULT_STAGE2_PROMPT_CONFIG
    }
  };
}

function mapStage2Run(row: Stage2RunRow): Stage2RunRecord {
  const snapshot = JSON.parse(String(row.snapshot_json)) as Stage2ProgressSnapshot;
  const request = normalizeRequest(row, snapshot);
  return {
    runId: String(row.run_id),
    workspaceId: String(row.workspace_id),
    creatorUserId: row.creator_user_id ? String(row.creator_user_id) : null,
    channelId: request.channel.id || (row.channel_id ? String(row.channel_id) : null),
    chatId: row.chat_id ? String(row.chat_id) : null,
    sourceUrl: request.sourceUrl,
    userInstruction: request.userInstruction,
    mode: request.mode,
    request,
    snapshot,
    status: String(row.status) as Stage2ProgressSnapshot["status"],
    resultData: parseJsonOrNull<unknown>(row.result_json),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    updatedAt: String(row.updated_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null
  };
}

function readRunRow(runId: string): Stage2RunRow | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM stage2_runs WHERE run_id = ? LIMIT 1").get(runId) as Stage2RunRow | undefined) ?? null;
}

function saveRecord(record: Stage2RunRecord): Stage2RunRecord {
  const db = getDb();
  db.prepare(
    `INSERT INTO stage2_runs
      (
        run_id,
        workspace_id,
        creator_user_id,
        channel_id,
        chat_id,
        source_url,
        user_instruction,
        mode,
        request_json,
        status,
        snapshot_json,
        result_json,
        error_message,
        created_at,
        started_at,
        updated_at,
        finished_at
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      creator_user_id = excluded.creator_user_id,
      channel_id = excluded.channel_id,
      chat_id = excluded.chat_id,
      source_url = excluded.source_url,
      user_instruction = excluded.user_instruction,
      mode = excluded.mode,
      request_json = excluded.request_json,
      status = excluded.status,
      snapshot_json = excluded.snapshot_json,
      result_json = excluded.result_json,
      error_message = excluded.error_message,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at,
      finished_at = excluded.finished_at`
  ).run(
    record.runId,
    record.workspaceId,
    record.creatorUserId,
    record.channelId,
    record.chatId,
    record.sourceUrl,
    record.userInstruction,
    record.mode,
    JSON.stringify(record.request),
    record.status,
    JSON.stringify(record.snapshot),
    record.resultData === null ? null : JSON.stringify(record.resultData),
    record.errorMessage,
    record.createdAt,
    record.startedAt,
    record.updatedAt,
    record.finishedAt
  );

  const row = readRunRow(record.runId);
  if (!row) {
    throw new Error("Failed to persist stage2 run record.");
  }
  return mapStage2Run(row);
}

export function createStage2Run(input: {
  workspaceId: string;
  creatorUserId: string;
  chatId?: string | null;
  request: Stage2RunRequest;
}): Stage2RunRecord {
  const stamp = nowIso();
  const runId = newId();
  return saveRecord({
    runId,
    workspaceId: input.workspaceId,
    creatorUserId: input.creatorUserId,
    channelId: input.request.channel.id || null,
    chatId: input.chatId ?? null,
    sourceUrl: input.request.sourceUrl,
    userInstruction: input.request.userInstruction,
    mode: input.request.mode,
    request: input.request,
    snapshot: createStage2ProgressSnapshot(runId),
    status: "queued",
    resultData: null,
    errorMessage: null,
    createdAt: stamp,
    startedAt: null,
    updatedAt: stamp,
    finishedAt: null
  });
}

export function getStage2Run(runId: string): Stage2RunRecord | null {
  const row = readRunRow(runId);
  return row ? mapStage2Run(row) : null;
}

export function listStage2RunsForChat(
  chatId: string,
  workspaceId: string,
  limit = 20
): Stage2RunRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM stage2_runs
        WHERE workspace_id = ?
          AND chat_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(workspaceId, chatId, Math.max(1, Math.floor(limit))) as Stage2RunRow[];
  return rows.map(mapStage2Run);
}

export function listLatestActiveStage2RunsForChats(
  chatIds: string[],
  workspaceId: string
): Map<string, Stage2RunRecord> {
  if (chatIds.length === 0) {
    return new Map();
  }

  const placeholders = chatIds.map(() => "?").join(", ");
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM stage2_runs
        WHERE workspace_id = ?
          AND chat_id IN (${placeholders})
          AND status IN ('queued', 'running')
        ORDER BY updated_at DESC`
    )
    .all(workspaceId, ...chatIds) as Stage2RunRow[];

  const latestByChat = new Map<string, Stage2RunRecord>();
  for (const row of rows) {
    const record = mapStage2Run(row);
    if (!record.chatId || latestByChat.has(record.chatId)) {
      continue;
    }
    latestByChat.set(record.chatId, record);
  }
  return latestByChat;
}

export function findActiveStage2RunForChat(
  chatId: string,
  workspaceId: string
): Stage2RunRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM stage2_runs
        WHERE workspace_id = ?
          AND chat_id = ?
          AND status IN ('queued', 'running')
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .get(workspaceId, chatId) as Stage2RunRow | undefined;
  return row ? mapStage2Run(row) : null;
}

export function hasQueuedStage2Runs(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT 1 as present FROM stage2_runs WHERE status = 'queued' LIMIT 1")
    .get() as { present?: number } | undefined;
  return row?.present === 1;
}

export function claimNextQueuedStage2Run(): Stage2RunRecord | null {
  return runInTransaction((db) => {
    const row =
      (db
        .prepare("SELECT * FROM stage2_runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
        .get() as Stage2RunRow | undefined) ?? null;
    if (!row) {
      return null;
    }

    const current = mapStage2Run(row);
    const snapshot: Stage2ProgressSnapshot = {
      ...current.snapshot,
      status: "running",
      updatedAt: nowIso(),
      error: null
    };
    const startedAt = current.startedAt ?? nowIso();

    db.prepare(
      `UPDATE stage2_runs
          SET status = 'running',
              snapshot_json = ?,
              error_message = NULL,
              started_at = ?,
              updated_at = ?
        WHERE run_id = ?`
    ).run(JSON.stringify(snapshot), startedAt, snapshot.updatedAt, current.runId);

    return mapStage2Run(readRunRow(current.runId) as Stage2RunRow);
  });
}

export function interruptRunningStage2Runs(message = "Stage 2 run interrupted by process restart."): number {
  return runInTransaction((db) => {
    const rows = db
      .prepare("SELECT * FROM stage2_runs WHERE status = 'running'")
      .all() as Stage2RunRow[];
    if (rows.length === 0) {
      return 0;
    }

    for (const row of rows) {
      const record = mapStage2Run(row);
      const failedSnapshot = markStage2ProgressStageFailed(
        record.snapshot,
        record.snapshot.activeStageId ?? "analyzer",
        message
      );
      db.prepare(
        `UPDATE stage2_runs
            SET status = 'failed',
                snapshot_json = ?,
                error_message = ?,
                updated_at = ?,
                finished_at = ?
          WHERE run_id = ?`
      ).run(
        JSON.stringify(failedSnapshot),
        message,
        failedSnapshot.updatedAt,
        failedSnapshot.finishedAt,
        record.runId
      );
    }

    return rows.length;
  });
}

export function recoverInterruptedStage2Runs(
  detail = "Recovered after process restart. Re-running the pipeline from analyzer."
): number {
  return runInTransaction((db) => {
    const rows = db
      .prepare("SELECT * FROM stage2_runs WHERE status = 'running'")
      .all() as Stage2RunRow[];
    if (rows.length === 0) {
      return 0;
    }

    for (const row of rows) {
      const record = mapStage2Run(row);
      const restartedSnapshot = resetStage2ProgressForRetry(record.snapshot, detail);
      db.prepare(
        `UPDATE stage2_runs
            SET status = 'queued',
                snapshot_json = ?,
                error_message = NULL,
                started_at = NULL,
                updated_at = ?,
                finished_at = NULL
          WHERE run_id = ?`
      ).run(JSON.stringify(restartedSnapshot), restartedSnapshot.updatedAt, record.runId);
    }

    return rows.length;
  });
}

function mutateStage2Run(
  runId: string,
  mutator: (record: Stage2RunRecord) => Stage2RunRecord
): Stage2RunRecord | null {
  return runInTransaction(() => {
    const current = getStage2Run(runId);
    if (!current) {
      return null;
    }
    return saveRecord(mutator(current));
  });
}

export function markStage2RunStageRunning(
  runId: string,
  stageId: Stage2PipelineStageId,
  patch?: Partial<{
    detail: string | null;
    promptChars: number | null;
    reasoningEffort: string | null;
  }>
): Stage2RunRecord | null {
  return mutateStage2Run(runId, (record) => {
    const snapshot = markStage2ProgressStageRunning(record.snapshot, stageId, patch);
    return {
      ...record,
      snapshot,
      status: snapshot.status,
      errorMessage: null,
      startedAt: record.startedAt ?? snapshot.startedAt,
      updatedAt: snapshot.updatedAt,
      finishedAt: snapshot.finishedAt
    };
  });
}

export function markStage2RunStageCompleted(
  runId: string,
  stageId: Stage2PipelineStageId,
  patch?: Partial<{
    detail: string | null;
    durationMs: number | null;
    promptChars: number | null;
    reasoningEffort: string | null;
  }>
): Stage2RunRecord | null {
  return mutateStage2Run(runId, (record) => {
    const snapshot = markStage2ProgressStageCompleted(record.snapshot, stageId, patch);
    return {
      ...record,
      snapshot,
      status: snapshot.status,
      updatedAt: snapshot.updatedAt,
      finishedAt: snapshot.finishedAt
    };
  });
}

export function markStage2RunStageFailed(
  runId: string,
  stageId: Stage2PipelineStageId,
  error: string,
  patch?: Partial<{
    durationMs: number | null;
    promptChars: number | null;
    reasoningEffort: string | null;
  }>
): Stage2RunRecord | null {
  return mutateStage2Run(runId, (record) => {
    const snapshot = markStage2ProgressStageFailed(record.snapshot, stageId, error, {
      detail: error,
      ...patch
    });
    return {
      ...record,
      snapshot,
      status: snapshot.status,
      errorMessage: error,
      updatedAt: snapshot.updatedAt,
      finishedAt: snapshot.finishedAt
    };
  });
}

export function finalizeStage2RunSuccess(
  runId: string,
  input?: { resultData?: unknown | null }
): Stage2RunRecord | null {
  return mutateStage2Run(runId, (record) => {
    const snapshot = finalizeStage2ProgressSuccess(record.snapshot);
    return {
      ...record,
      snapshot,
      status: snapshot.status,
      resultData: input?.resultData !== undefined ? input.resultData : record.resultData,
      errorMessage: null,
      updatedAt: snapshot.updatedAt,
      finishedAt: snapshot.finishedAt
    };
  });
}

export function finalizeStage2RunFailure(
  runId: string,
  errorMessage: string
): Stage2RunRecord | null {
  return mutateStage2Run(runId, (record) => {
    const alreadyFailed = record.snapshot.status === "failed";
    const snapshot = alreadyFailed
      ? {
          ...record.snapshot,
          updatedAt: nowIso(),
          finishedAt: record.snapshot.finishedAt ?? nowIso(),
          error: errorMessage
        }
      : markStage2ProgressStageFailed(
          record.snapshot,
          record.snapshot.activeStageId ?? "analyzer",
          errorMessage
        );

    return {
      ...record,
      snapshot,
      status: "failed",
      errorMessage,
      updatedAt: snapshot.updatedAt,
      finishedAt: snapshot.finishedAt
    };
  });
}

export function setStage2RunResultData(
  runId: string,
  resultData: unknown | null
): Stage2RunRecord | null {
  return mutateStage2Run(runId, (record) => ({
    ...record,
    resultData,
    updatedAt: nowIso()
  }));
}
