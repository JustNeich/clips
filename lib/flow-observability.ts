import type {
  ChannelPublicationStatus,
  Stage2Response,
  Stage3ExecutionTarget,
  Stage3JobArtifact,
  Stage3JobKind,
  Stage3JobStatus
} from "../app/components/types";
import { listFlowAuditEvents, type FlowAuditEvent } from "./audit-log-store";
import { buildChatTraceExport } from "./chat-trace-export";
import { getChatById } from "./chat-history";
import { getDb } from "./db/client";
import { redactForFlowExport } from "./flow-redaction";
import type { WorkspaceRecord } from "./team-store";

export type FlowObservabilityStage = "source" | "stage2" | "stage3" | "publishing" | "new";
export type FlowObservabilityDateBasis = "created" | "lastActivity";
export type FlowObservabilityStatus =
  | "new"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "scheduled"
  | "published"
  | "paused"
  | "canceled";

export type FlowObservabilitySummary = {
  chatId: string;
  channelId: string;
  channelName: string;
  channelUsername: string;
  title: string;
  sourceUrl: string;
  latestStage: FlowObservabilityStage;
  latestStatus: FlowObservabilityStatus;
  provider: string | null;
  model: string | null;
  updatedAt: string;
  lastActivityAt: string;
  createdAt: string;
  sourceJobId: string | null;
  stage2RunId: string | null;
  stage3JobId: string | null;
  publicationId: string | null;
  youtubeVideoUrl: string | null;
  lastError: string | null;
};

export type FlowObservabilityMetrics = {
  total: number;
  today: number;
  createdToday: number;
  updatedToday: number;
  running: number;
  failed: number;
  scheduled: number;
  published: number;
  deleted: number;
};

export type FlowObservabilityList = {
  flows: FlowObservabilitySummary[];
  metrics: FlowObservabilityMetrics;
  auditEvents: FlowAuditEvent[];
};

export type FlowStage3JobEvent = {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type FlowStage3JobDetail = {
  id: string;
  kind: Stage3JobKind;
  status: Stage3JobStatus;
  executionTarget: Stage3ExecutionTarget;
  assignedWorkerId: string | null;
  workerLabel: string | null;
  leaseUntil: string | null;
  lastHeartbeatAt: string | null;
  dedupeKey: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attempts: number;
  attemptLimit: number;
  attemptGroup: string | null;
  recoverable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  artifact: Stage3JobArtifact | null;
  events: FlowStage3JobEvent[];
};

export type FlowObservabilityDetail = {
  flow: FlowObservabilitySummary;
  auditEvents: FlowAuditEvent[];
  stage3Jobs: FlowStage3JobDetail[];
  trace: unknown;
};

export type FlowObservabilityFilters = {
  channelId?: string | null;
  stage?: string | null;
  status?: string | null;
  provider?: string | null;
  model?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  dateBasis?: FlowObservabilityDateBasis | null;
  todayFrom?: string | null;
  todayTo?: string | null;
  limit?: number | null;
};

type ChatFlowRow = {
  chat_id: string;
  workspace_id: string;
  channel_id: string;
  source_url: string;
  title: string;
  chat_created_at: string;
  chat_updated_at: string;
  channel_name: string;
  channel_username: string;
};

type SourceJobLite = {
  job_id: string;
  chat_id: string;
  status: string;
  source_url: string;
  result_json?: string | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  updated_at: string;
  finished_at?: string | null;
};

type Stage2RunLite = {
  run_id: string;
  chat_id?: string | null;
  status: string;
  result_json?: string | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  updated_at: string;
  finished_at?: string | null;
};

type Stage3JobLite = {
  id: string;
  user_id?: string | null;
  status: string;
  payload_json: string;
  result_json?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  kind: string;
  execution_target?: string | null;
  assigned_worker_id?: string | null;
  assigned_worker_label?: string | null;
  lease_expires_at?: string | null;
  heartbeat_at?: string | null;
  dedupe_key?: string | null;
  recoverable?: number | null;
  attempts?: number | null;
  attempt_limit?: number | null;
  attempt_group?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  artifact_id?: string | null;
  artifact_job_id?: string | null;
  artifact_kind?: string | null;
  artifact_file_name?: string | null;
  artifact_mime_type?: string | null;
  artifact_size_bytes?: number | null;
  artifact_created_at?: string | null;
};

type PublicationLite = {
  id: string;
  chat_id: string;
  status: ChannelPublicationStatus | string;
  title: string;
  youtube_video_url?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
  scheduled_at: string;
  published_at?: string | null;
  canceled_at?: string | null;
};

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function latestByChat<T extends { chat_id?: string | null; updated_at: string; created_at: string }>(
  rows: T[]
): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const chatId = row.chat_id;
    if (!chatId) {
      continue;
    }
    const existing = map.get(chatId);
    if (!existing || row.updated_at > existing.updated_at || (row.updated_at === existing.updated_at && row.created_at > existing.created_at)) {
      map.set(chatId, row);
    }
  }
  return map;
}

function parseStage3ChatId(payloadJson: string): string | null {
  const payload = parseJson<Record<string, unknown>>(payloadJson);
  const chatId = typeof payload?.chatId === "string" ? payload.chatId.trim() : "";
  return chatId || null;
}

function latestStage3ByChat(rows: Stage3JobLite[]): Map<string, Stage3JobLite> {
  const map = new Map<string, Stage3JobLite>();
  for (const row of rows) {
    const chatId = parseStage3ChatId(row.payload_json);
    if (!chatId) {
      continue;
    }
    const existing = map.get(chatId);
    if (!existing || row.updated_at > existing.updated_at || (row.updated_at === existing.updated_at && row.created_at > existing.created_at)) {
      map.set(chatId, row);
    }
  }
  return map;
}

function normalizeStatus(status: string | null | undefined): FlowObservabilityStatus {
  switch (status) {
    case "queued":
    case "uploading":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
    case "interrupted":
      return "failed";
    case "scheduled":
      return "scheduled";
    case "published":
      return "published";
    case "paused":
      return "paused";
    case "canceled":
      return "canceled";
    default:
      return "new";
  }
}

function normalizeStage3JobKind(value: string | null | undefined): Stage3JobKind {
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

function normalizeStage3JobStatus(value: string | null | undefined): Stage3JobStatus {
  if (value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "interrupted") {
    return value;
  }
  return "failed";
}

function normalizeStage3ExecutionTarget(value: string | null | undefined): Stage3ExecutionTarget {
  return value === "host" ? "host" : "local";
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  const parsed = parseJson<unknown>(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

function extractStage2ProviderModel(run: Stage2RunLite | null): { provider: string | null; model: string | null } {
  const result = parseJson<Stage2Response>(run?.result_json) ?? null;
  const promptStages = result?.diagnostics?.effectivePrompting?.promptStages ?? [];
  const model =
    result?.model ??
    promptStages.find((stage) => typeof stage.model === "string" && stage.model.trim())?.model ??
    null;
  const providerConfig = (result?.output as { pipeline?: { provider?: string | null } } | undefined)?.pipeline?.provider;
  const provider =
    typeof providerConfig === "string" && providerConfig.trim()
      ? providerConfig.trim()
      : result?.stage2Worker?.pipelineVersion === "vnext"
        ? "stage2-vnext"
        : model
          ? "caption-provider"
          : null;
  return { provider, model: model?.trim() || null };
}

function chooseLatestStage(input: {
  chat: ChatFlowRow;
  source: SourceJobLite | null;
  stage2: Stage2RunLite | null;
  stage3: Stage3JobLite | null;
  publication: PublicationLite | null;
}): { stage: FlowObservabilityStage; status: FlowObservabilityStatus; updatedAt: string; lastError: string | null } {
  const candidates: Array<{
    stage: FlowObservabilityStage;
    status: FlowObservabilityStatus;
    updatedAt: string;
    lastError: string | null;
  }> = [
    {
      stage: "new",
      status: "new",
      updatedAt: input.chat.chat_updated_at,
      lastError: null
    }
  ];
  if (input.source) {
    candidates.push({
      stage: "source",
      status: normalizeStatus(input.source.status),
      updatedAt: input.source.updated_at,
      lastError: input.source.error_message ?? null
    });
  }
  if (input.stage2) {
    candidates.push({
      stage: "stage2",
      status: normalizeStatus(input.stage2.status),
      updatedAt: input.stage2.updated_at,
      lastError: input.stage2.error_message ?? null
    });
  }
  if (input.stage3) {
    candidates.push({
      stage: "stage3",
      status: normalizeStatus(input.stage3.status),
      updatedAt: input.stage3.updated_at,
      lastError: input.stage3.error_message ?? null
    });
  }
  if (input.publication) {
    candidates.push({
      stage: "publishing",
      status: normalizeStatus(input.publication.status),
      updatedAt: input.publication.updated_at,
      lastError: input.publication.last_error ?? null
    });
  }
  return candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]!;
}

function matchesFilters(flow: FlowObservabilitySummary, filters: FlowObservabilityFilters): boolean {
  if (filters.stage && flow.latestStage !== filters.stage) {
    return false;
  }
  if (filters.status && flow.latestStatus !== filters.status) {
    return false;
  }
  if (filters.provider && flow.provider !== filters.provider) {
    return false;
  }
  if (filters.model && flow.model !== filters.model) {
    return false;
  }
  const search = filters.search?.trim().toLowerCase();
  if (search) {
    const haystack = [
      flow.chatId,
      flow.channelName,
      flow.channelUsername,
      flow.title,
      flow.sourceUrl,
      flow.sourceJobId,
      flow.stage2RunId,
      flow.stage3JobId,
      flow.publicationId,
      flow.youtubeVideoUrl,
      flow.provider,
      flow.model
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(search)) {
      return false;
    }
  }
  const dateBasis = filters.dateBasis === "lastActivity" ? "lastActivity" : "created";
  const dateValue = dateBasis === "lastActivity" ? flow.lastActivityAt : flow.createdAt;
  if (filters.from && dateValue < filters.from) {
    return false;
  }
  if (filters.to && dateValue > filters.to) {
    return false;
  }
  return true;
}

function buildSummary(
  chat: ChatFlowRow,
  source: SourceJobLite | null,
  stage2: Stage2RunLite | null,
  stage3: Stage3JobLite | null,
  publication: PublicationLite | null
): FlowObservabilitySummary {
  const latest = chooseLatestStage({ chat, source, stage2, stage3, publication });
  const stage2ProviderModel = extractStage2ProviderModel(stage2);
  return {
    chatId: chat.chat_id,
    channelId: chat.channel_id,
    channelName: chat.channel_name,
    channelUsername: chat.channel_username,
    title: chat.title,
    sourceUrl: chat.source_url,
    latestStage: latest.stage,
    latestStatus: latest.status,
    provider: stage2ProviderModel.provider,
    model: stage2ProviderModel.model,
    updatedAt: latest.updatedAt,
    lastActivityAt: latest.updatedAt,
    createdAt: chat.chat_created_at,
    sourceJobId: source?.job_id ?? null,
    stage2RunId: stage2?.run_id ?? null,
    stage3JobId: stage3?.id ?? null,
    publicationId: publication?.id ?? null,
    youtubeVideoUrl: publication?.youtube_video_url ?? null,
    lastError: latest.lastError
  };
}

function isWithinOptionalRange(value: string, from: string | null | undefined, to: string | null | undefined): boolean {
  if (from && value < from) {
    return false;
  }
  if (to && value > to) {
    return false;
  }
  return true;
}

function computeMetrics(
  flows: FlowObservabilitySummary[],
  auditEvents: FlowAuditEvent[],
  filters: FlowObservabilityFilters
): FlowObservabilityMetrics {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const hasExplicitTodayWindow = Boolean(filters.todayFrom || filters.todayTo);
  const isToday = (value: string): boolean =>
    hasExplicitTodayWindow
      ? isWithinOptionalRange(value, filters.todayFrom, filters.todayTo)
      : value.startsWith(todayPrefix);
  const createdToday = flows.filter((flow) => isToday(flow.createdAt)).length;
  const updatedToday = flows.filter((flow) => isToday(flow.lastActivityAt)).length;
  return {
    total: flows.length,
    today: createdToday,
    createdToday,
    updatedToday,
    running: flows.filter((flow) => flow.latestStatus === "queued" || flow.latestStatus === "running").length,
    failed: flows.filter((flow) => flow.latestStatus === "failed").length,
    scheduled: flows.filter((flow) => flow.latestStatus === "scheduled").length,
    published: flows.filter((flow) => flow.latestStatus === "published").length,
    deleted: auditEvents.filter(
      (event) =>
        event.status === "deleted" ||
        event.status === "canceled" ||
        event.action === "publication.delete.succeeded"
    ).length
  };
}

export function listFlowObservability(input: {
  workspaceId: string;
  filters?: FlowObservabilityFilters;
}): FlowObservabilityList {
  const filters = input.filters ?? {};
  const params: unknown[] = [input.workspaceId];
  const where = ["c.workspace_id = ?"];
  if (filters.channelId) {
    where.push("c.channel_id = ?");
    params.push(filters.channelId);
  }
  const dateBasis = filters.dateBasis === "lastActivity" ? "lastActivity" : "created";
  if (dateBasis === "created" && filters.from) {
    where.push("c.created_at >= ?");
    params.push(filters.from);
  }
  if (dateBasis === "created" && filters.to) {
    where.push("c.created_at <= ?");
    params.push(filters.to);
  }
  const search = filters.search?.trim();
  if (search) {
    const like = `%${search}%`;
    where.push(
      `(c.id LIKE ?
        OR c.url LIKE ?
        OR c.title LIKE ?
        OR ch.name LIKE ?
        OR ch.username LIKE ?
        OR EXISTS (
          SELECT 1 FROM source_jobs sj
           WHERE sj.workspace_id = c.workspace_id
             AND sj.chat_id = c.id
             AND (sj.job_id LIKE ? OR sj.source_url LIKE ? OR sj.error_message LIKE ? OR sj.result_json LIKE ?)
        )
        OR EXISTS (
          SELECT 1 FROM stage2_runs s2
           WHERE s2.workspace_id = c.workspace_id
             AND s2.chat_id = c.id
             AND (s2.run_id LIKE ? OR s2.error_message LIKE ? OR s2.result_json LIKE ?)
        )
        OR EXISTS (
          SELECT 1 FROM stage3_jobs s3
           WHERE s3.workspace_id = c.workspace_id
             AND s3.payload_json LIKE '%' || c.id || '%'
             AND (s3.id LIKE ? OR s3.error_code LIKE ? OR s3.error_message LIKE ? OR s3.payload_json LIKE ? OR s3.result_json LIKE ?)
        )
        OR EXISTS (
          SELECT 1 FROM channel_publications cp
           WHERE cp.workspace_id = c.workspace_id
             AND cp.chat_id = c.id
             AND (cp.id LIKE ? OR cp.title LIKE ? OR cp.youtube_video_url LIKE ? OR cp.last_error LIKE ?)
        ))`
    );
    params.push(
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like
    );
  }
  const limit =
    typeof filters.limit === "number" && Number.isFinite(filters.limit)
      ? Math.max(1, Math.min(200, Math.floor(filters.limit)))
      : 80;
  const scanLimit = search || filters.from || filters.to ? 2000 : Math.max(limit * 10, 500);
  params.push(scanLimit);

  const db = getDb();
  const chats = db
    .prepare(
      `SELECT
          c.id as chat_id,
          c.workspace_id,
          c.channel_id,
          c.url as source_url,
          c.title,
          c.created_at as chat_created_at,
          c.updated_at as chat_updated_at,
          ch.name as channel_name,
          ch.username as channel_username
       FROM chat_threads c
        JOIN channels ch ON ch.id = c.channel_id
       WHERE ${where.join(" AND ")}
       ORDER BY c.updated_at DESC, c.created_at DESC
       LIMIT ?`
    )
    .all(...(params as string[])) as ChatFlowRow[];

  const chatIds = chats.map((chat) => chat.chat_id);
  const placeholders = chatIds.map(() => "?").join(", ");
  const sourceByChat =
    chatIds.length > 0
      ? latestByChat(
          db
            .prepare(
              `SELECT * FROM source_jobs
                WHERE workspace_id = ?
                  AND chat_id IN (${placeholders})
                ORDER BY updated_at DESC`
            )
            .all(input.workspaceId, ...chatIds) as SourceJobLite[]
        )
      : new Map<string, SourceJobLite>();
  const stage2ByChat =
    chatIds.length > 0
      ? latestByChat(
          db
            .prepare(
              `SELECT * FROM stage2_runs
                WHERE workspace_id = ?
                  AND chat_id IN (${placeholders})
                ORDER BY updated_at DESC`
            )
            .all(input.workspaceId, ...chatIds) as Stage2RunLite[]
        )
      : new Map<string, Stage2RunLite>();
  const publicationByChat =
    chatIds.length > 0
      ? latestByChat(
          db
            .prepare(
              `SELECT * FROM channel_publications
                WHERE workspace_id = ?
                  AND chat_id IN (${placeholders})
                ORDER BY updated_at DESC`
            )
            .all(input.workspaceId, ...chatIds) as PublicationLite[]
        )
      : new Map<string, PublicationLite>();
  const stage3ByChat = latestStage3ByChat(
    db
      .prepare(
        `SELECT * FROM stage3_jobs
          WHERE workspace_id = ?
          ORDER BY updated_at DESC
          LIMIT 2000`
      )
      .all(input.workspaceId) as Stage3JobLite[]
  );

  const auditEvents = listFlowAuditEvents({
    workspaceId: input.workspaceId,
    limit: 100,
    stage: filters.stage && filters.stage !== "new" ? filters.stage : null,
    status: filters.status ?? null,
    search: filters.search ?? null
  });
  const flows = chats
    .map((chat) =>
      buildSummary(
        chat,
        sourceByChat.get(chat.chat_id) ?? null,
        stage2ByChat.get(chat.chat_id) ?? null,
        stage3ByChat.get(chat.chat_id) ?? null,
        publicationByChat.get(chat.chat_id) ?? null
      )
    )
    .filter((flow) => matchesFilters(flow, filters))
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt) || right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);

  return {
    flows: redactForFlowExport(flows),
    metrics: computeMetrics(flows, auditEvents, filters),
    auditEvents: redactForFlowExport(auditEvents)
  };
}

type Stage3JobEventRow = {
  id: string;
  job_id: string;
  level: string;
  message: string;
  payload_json?: string | null;
  created_at: string;
};

function mapStage3JobEvent(row: Stage3JobEventRow): FlowStage3JobEvent {
  return {
    id: String(row.id),
    level: row.level === "warn" || row.level === "error" ? row.level : "info",
    message: String(row.message),
    payload: parseJsonObject(row.payload_json),
    createdAt: String(row.created_at)
  };
}

function mapStage3JobDetail(row: Stage3JobLite, events: FlowStage3JobEvent[]): FlowStage3JobDetail {
  const artifact =
    row.artifact_id && row.artifact_file_name && row.artifact_mime_type
      ? {
          id: String(row.artifact_id),
          jobId: String(row.artifact_job_id ?? row.id),
          kind: "video" as const,
          fileName: String(row.artifact_file_name),
          mimeType: String(row.artifact_mime_type),
          sizeBytes: Number(row.artifact_size_bytes) || 0,
          createdAt: String(row.artifact_created_at ?? row.completed_at ?? row.updated_at),
          downloadUrl: null
        }
      : null;

  return {
    id: String(row.id),
    kind: normalizeStage3JobKind(row.kind),
    status: normalizeStage3JobStatus(row.status),
    executionTarget: normalizeStage3ExecutionTarget(row.execution_target),
    assignedWorkerId: row.assigned_worker_id ? String(row.assigned_worker_id) : null,
    workerLabel: row.assigned_worker_label ? String(row.assigned_worker_label) : null,
    leaseUntil: row.lease_expires_at ? String(row.lease_expires_at) : null,
    lastHeartbeatAt: row.heartbeat_at ? String(row.heartbeat_at) : null,
    dedupeKey: row.dedupe_key ? String(row.dedupe_key) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    attempts: Number(row.attempts) || 0,
    attemptLimit: Number(row.attempt_limit) || 3,
    attemptGroup: row.attempt_group ? String(row.attempt_group) : null,
    recoverable: row.recoverable === undefined || row.recoverable === null ? true : Boolean(row.recoverable),
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    payload: parseJsonObject(row.payload_json),
    result: parseJsonObject(row.result_json),
    artifact,
    events
  };
}

function listStage3JobDetailsForChat(input: {
  workspaceId: string;
  chatId: string;
  limit?: number;
}): FlowStage3JobDetail[] {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 50)));
  const db = getDb();
  const rows = db
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
          a.size_bytes AS artifact_size_bytes,
          a.created_at AS artifact_created_at
        FROM stage3_jobs j
        LEFT JOIN stage3_workers w
          ON w.id = j.assigned_worker_id
        LEFT JOIN latest_artifacts a
          ON a.job_id = j.id
         AND a.row_num = 1
       WHERE j.workspace_id = ?
         AND j.payload_json LIKE ?
       ORDER BY j.updated_at DESC, j.created_at DESC
       LIMIT ?`
    )
    .all(input.workspaceId, `%${input.chatId}%`, limit * 2) as Stage3JobLite[];

  const matchingRows = rows.filter((row) => parseStage3ChatId(row.payload_json) === input.chatId).slice(0, limit);
  if (!matchingRows.length) {
    return [];
  }
  const jobIds = matchingRows.map((row) => row.id);
  const placeholders = jobIds.map(() => "?").join(", ");
  const eventRows = db
    .prepare(
      `SELECT *
         FROM stage3_job_events
        WHERE job_id IN (${placeholders})
        ORDER BY created_at ASC, id ASC`
    )
    .all(...jobIds) as Stage3JobEventRow[];
  const eventsByJob = new Map<string, FlowStage3JobEvent[]>();
  for (const row of eventRows) {
    const jobId = String(row.job_id);
    const existing = eventsByJob.get(jobId) ?? [];
    existing.push(mapStage3JobEvent(row));
    eventsByJob.set(jobId, existing);
  }
  return matchingRows.map((row) => mapStage3JobDetail(row, eventsByJob.get(row.id) ?? []));
}

export async function getFlowObservabilityDetail(input: {
  workspace: WorkspaceRecord;
  userId: string;
  chatId: string;
  selectedRunId?: string | null;
}): Promise<FlowObservabilityDetail | null> {
  const chat = await getChatById(input.chatId);
  if (!chat || chat.workspaceId !== input.workspace.id) {
    return null;
  }
  const list = listFlowObservability({
    workspaceId: input.workspace.id,
    filters: {
      search: input.chatId,
      limit: 20
    }
  });
  const flow = list.flows.find((item) => item.chatId === input.chatId) ?? null;
  if (!flow) {
    return null;
  }
  const trace = await buildChatTraceExport({
    workspace: input.workspace,
    userId: input.userId,
    chatId: input.chatId,
    selectedRunId: input.selectedRunId
  });
  return {
    flow,
    auditEvents: listFlowAuditEvents({
      workspaceId: input.workspace.id,
      chatId: input.chatId,
      limit: 200
    }),
    stage3Jobs: redactForFlowExport(
      listStage3JobDetailsForChat({
        workspaceId: input.workspace.id,
        chatId: input.chatId,
        limit: 50
      })
    ) as FlowStage3JobDetail[],
    trace: redactForFlowExport(trace)
  };
}

export async function exportFlowTrace(input: {
  workspace: WorkspaceRecord;
  userId: string;
  chatId: string;
  selectedRunId?: string | null;
}): Promise<unknown | null> {
  const trace = await buildChatTraceExport({
    workspace: input.workspace,
    userId: input.userId,
    chatId: input.chatId,
    selectedRunId: input.selectedRunId
  });
  return trace ? redactForFlowExport(trace) : null;
}

export function findFlowByUrlOrVideoId(input: {
  workspaceId: string;
  query: string;
  limit?: number | null;
}): FlowObservabilityList {
  return listFlowObservability({
    workspaceId: input.workspaceId,
    filters: {
      search: input.query,
      limit: input.limit ?? 20
    }
  });
}
