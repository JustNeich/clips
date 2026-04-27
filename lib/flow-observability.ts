import type { ChannelPublicationStatus, Stage2Response } from "../app/components/types";
import { listFlowAuditEvents, type FlowAuditEvent } from "./audit-log-store";
import { buildChatTraceExport } from "./chat-trace-export";
import { getChatById } from "./chat-history";
import { getDb } from "./db/client";
import { redactForFlowExport } from "./flow-redaction";
import type { WorkspaceRecord } from "./team-store";

export type FlowObservabilityStage = "source" | "stage2" | "stage3" | "publishing" | "new";
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

export type FlowObservabilityDetail = {
  flow: FlowObservabilitySummary;
  auditEvents: FlowAuditEvent[];
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
  status: string;
  payload_json: string;
  result_json?: string | null;
  error_message?: string | null;
  kind: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
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
    createdAt: chat.chat_created_at,
    sourceJobId: source?.job_id ?? null,
    stage2RunId: stage2?.run_id ?? null,
    stage3JobId: stage3?.id ?? null,
    publicationId: publication?.id ?? null,
    youtubeVideoUrl: publication?.youtube_video_url ?? null,
    lastError: latest.lastError
  };
}

function computeMetrics(flows: FlowObservabilitySummary[], auditEvents: FlowAuditEvent[]): FlowObservabilityMetrics {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  return {
    total: flows.length,
    today: flows.filter((flow) => flow.updatedAt.startsWith(todayPrefix)).length,
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
  if (filters.from) {
    where.push("c.updated_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("c.updated_at <= ?");
    params.push(filters.to);
  }
  const limit =
    typeof filters.limit === "number" && Number.isFinite(filters.limit)
      ? Math.max(1, Math.min(200, Math.floor(filters.limit)))
      : 80;
  params.push(Math.max(limit * 3, limit));

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
       ORDER BY c.updated_at DESC
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
          LIMIT 500`
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
    .slice(0, limit);

  return {
    flows: redactForFlowExport(flows),
    metrics: computeMetrics(flows, auditEvents),
    auditEvents: redactForFlowExport(auditEvents)
  };
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
