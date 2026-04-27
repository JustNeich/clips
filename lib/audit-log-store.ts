import { getDb, newId, nowIso } from "./db/client";
import { redactForFlowExport } from "./flow-redaction";

export type FlowAuditStage =
  | "source"
  | "stage2"
  | "stage3"
  | "publishing"
  | "youtube"
  | "chat"
  | "channel"
  | "mcp"
  | "system";

export type FlowAuditSeverity = "info" | "warn" | "error";

export type FlowAuditStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "scheduled"
  | "published"
  | "paused"
  | "resumed"
  | "edited"
  | "canceled"
  | "deleted"
  | "attempted"
  | "succeeded"
  | "revoked"
  | "created";

export type FlowAuditEvent = {
  id: string;
  workspaceId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  channelId: string | null;
  chatId: string | null;
  correlationId: string | null;
  stage: FlowAuditStage | string | null;
  status: FlowAuditStatus | string | null;
  severity: FlowAuditSeverity;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

type AuditLogRow = {
  id: string;
  workspace_id: string;
  user_id?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  channel_id?: string | null;
  chat_id?: string | null;
  correlation_id?: string | null;
  stage?: string | null;
  status?: string | null;
  severity?: string | null;
  payload_json?: string | null;
  created_at: string;
};

export type AppendFlowAuditEventInput = {
  workspaceId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  channelId?: string | null;
  chatId?: string | null;
  correlationId?: string | null;
  stage?: FlowAuditStage | string | null;
  status?: FlowAuditStatus | string | null;
  severity?: FlowAuditSeverity;
  payload?: Record<string, unknown> | null;
  createdAt?: string | null;
};

export type ListFlowAuditEventsInput = {
  workspaceId: string;
  channelId?: string | null;
  chatId?: string | null;
  entityId?: string | null;
  stage?: string | null;
  status?: string | null;
  severity?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
};

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function mapAuditLogRow(row: AuditLogRow): FlowAuditEvent {
  const severity = row.severity === "warn" || row.severity === "error" ? row.severity : "info";
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    userId: row.user_id ? String(row.user_id) : null,
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    channelId: row.channel_id ? String(row.channel_id) : null,
    chatId: row.chat_id ? String(row.chat_id) : null,
    correlationId: row.correlation_id ? String(row.correlation_id) : null,
    stage: row.stage ? String(row.stage) : null,
    status: row.status ? String(row.status) : null,
    severity,
    payload: parseJsonObject(row.payload_json),
    createdAt: String(row.created_at)
  };
}

export function appendFlowAuditEvent(input: AppendFlowAuditEventInput): FlowAuditEvent {
  const db = getDb();
  const id = newId();
  const createdAt = input.createdAt?.trim() || nowIso();
  const payload = input.payload === undefined ? null : redactForFlowExport(input.payload);
  db.prepare(
    `INSERT INTO audit_log
      (id, workspace_id, user_id, action, entity_type, entity_id, channel_id, chat_id, correlation_id, stage, status, severity, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.workspaceId,
    input.userId ?? null,
    input.action,
    input.entityType,
    input.entityId,
    input.channelId ?? null,
    input.chatId ?? null,
    input.correlationId ?? null,
    input.stage ?? null,
    input.status ?? null,
    input.severity ?? "info",
    payload ? JSON.stringify(payload) : null,
    createdAt
  );
  const row = db.prepare("SELECT * FROM audit_log WHERE id = ? LIMIT 1").get(id) as AuditLogRow;
  return mapAuditLogRow(row);
}

export function tryAppendFlowAuditEvent(input: AppendFlowAuditEventInput): FlowAuditEvent | null {
  try {
    return appendFlowAuditEvent(input);
  } catch (error) {
    console.warn(
      JSON.stringify({
        scope: "flow-audit",
        event: "append_failed",
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        error: error instanceof Error ? error.message : String(error)
      })
    );
    return null;
  }
}

export function listFlowAuditEvents(input: ListFlowAuditEventsInput): FlowAuditEvent[] {
  const filters: string[] = ["workspace_id = ?"];
  const params: unknown[] = [input.workspaceId];
  if (input.channelId) {
    filters.push("channel_id = ?");
    params.push(input.channelId);
  }
  if (input.chatId) {
    filters.push("chat_id = ?");
    params.push(input.chatId);
  }
  if (input.entityId) {
    filters.push("entity_id = ?");
    params.push(input.entityId);
  }
  if (input.stage) {
    filters.push("stage = ?");
    params.push(input.stage);
  }
  if (input.status) {
    filters.push("status = ?");
    params.push(input.status);
  }
  if (input.severity) {
    filters.push("severity = ?");
    params.push(input.severity);
  }
  if (input.from) {
    filters.push("created_at >= ?");
    params.push(input.from);
  }
  if (input.to) {
    filters.push("created_at <= ?");
    params.push(input.to);
  }
  const search = input.search?.trim();
  if (search) {
    filters.push("(action LIKE ? OR entity_type LIKE ? OR entity_id LIKE ? OR payload_json LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.max(1, Math.min(500, Math.floor(input.limit)))
      : 100;
  params.push(limit);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
         FROM audit_log
        WHERE ${filters.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    )
    .all(...(params as string[])) as AuditLogRow[];
  return rows.map(mapAuditLogRow);
}
