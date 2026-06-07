import { createHash, randomBytes } from "node:crypto";
import { appendFlowAuditEvent, tryAppendFlowAuditEvent } from "./audit-log-store";
import { getDb, newId, nowIso } from "./db/client";
import { getWorkspace, type UserRecord, type WorkspaceRecord } from "./team-store";

export type McpMachineCredentialScope =
  | "flow:read"
  | "control:write"
  | "entity:write"
  | "pipeline:run"
  | "publication:write"
  | "publication:delete"
  | "worker:admin"
  | "integration:readiness"
  | "audit:read";

const MCP_MACHINE_SCOPES = new Set<McpMachineCredentialScope>([
  "flow:read",
  "control:write",
  "entity:write",
  "pipeline:run",
  "publication:write",
  "publication:delete",
  "worker:admin",
  "integration:readiness",
  "audit:read"
]);

export const DEFAULT_MCP_MACHINE_SCOPES: McpMachineCredentialScope[] = [
  "flow:read",
  "control:write",
  "entity:write",
  "pipeline:run",
  "publication:write",
  "publication:delete",
  "worker:admin",
  "integration:readiness",
  "audit:read"
];

export type McpMachineCredentialRecord = {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  machineId: string;
  secretHint: string;
  scopes: McpMachineCredentialScope[];
  status: "active" | "revoked";
  rotatesAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatedMcpMachineCredential = {
  secret: string;
  record: McpMachineCredentialRecord;
};

export type McpMachineAuthContext = {
  workspace: WorkspaceRecord;
  user: Pick<UserRecord, "id" | "email" | "displayName" | "status">;
  credential: McpMachineCredentialRecord;
};

type McpMachineCredentialRow = {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  machine_id: string;
  secret_hash: string;
  secret_hint: string;
  scopes_json: string;
  status: string;
  rotates_at?: string | null;
  revoked_at?: string | null;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
  owner_email?: string;
  owner_display_name?: string;
  owner_status?: string;
};

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function normalizeMcpMachineCredentialScopes(value: unknown): McpMachineCredentialScope[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value.filter((scope): scope is McpMachineCredentialScope => {
        return typeof scope === "string" && MCP_MACHINE_SCOPES.has(scope as McpMachineCredentialScope);
      })
    )
  ];
}

function parseScopes(raw: string | null | undefined): McpMachineCredentialScope[] {
  try {
    return normalizeMcpMachineCredentialScopes(JSON.parse(raw ?? "[]") as unknown);
  } catch {
    return [];
  }
}

function mapMachineCredential(row: McpMachineCredentialRow): McpMachineCredentialRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    ownerUserId: String(row.owner_user_id),
    machineId: String(row.machine_id),
    secretHint: String(row.secret_hint),
    scopes: parseScopes(row.scopes_json),
    status: row.status === "revoked" ? "revoked" : "active",
    rotatesAt: row.rotates_at ? String(row.rotates_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function createMcpMachineCredential(input: {
  workspaceId: string;
  ownerUserId: string;
  machineId: string;
  scopes?: McpMachineCredentialScope[] | null;
  rotatesInDays?: number | null;
  replaceExisting?: boolean | null;
}): CreatedMcpMachineCredential {
  const machineId = input.machineId.trim();
  if (!machineId) {
    throw new Error("machineId is required.");
  }
  const requestedScopes = normalizeMcpMachineCredentialScopes(input.scopes);
  const scopes = requestedScopes.length > 0 ? requestedScopes : DEFAULT_MCP_MACHINE_SCOPES;
  const rotatesInDays =
    typeof input.rotatesInDays === "number" && Number.isFinite(input.rotatesInDays)
      ? Math.max(7, Math.min(730, Math.floor(input.rotatesInDays)))
      : 180;
  const secret = `clips_machine_${randomBytes(32).toString("hex")}`;
  const secretHint = secret.slice(-8);
  const secretHash = hashSecret(secret);
  const stamp = nowIso();
  const rotatesAt = new Date(Date.now() + rotatesInDays * 24 * 60 * 60 * 1000).toISOString();
  const db = getDb();

  if (input.replaceExisting) {
    db.prepare(
      `UPDATE mcp_machine_credentials
          SET status = 'revoked',
              revoked_at = COALESCE(revoked_at, ?),
              updated_at = ?
        WHERE workspace_id = ?
          AND machine_id = ?
          AND status != 'revoked'`
    ).run(stamp, stamp, input.workspaceId, machineId);
  }

  const id = newId();
  db.prepare(
    `INSERT INTO mcp_machine_credentials
      (id, workspace_id, owner_user_id, machine_id, secret_hash, secret_hint, scopes_json, status, rotates_at, revoked_at, last_used_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?)`
  ).run(
    id,
    input.workspaceId,
    input.ownerUserId,
    machineId,
    secretHash,
    secretHint,
    JSON.stringify(scopes),
    rotatesAt,
    stamp,
    stamp
  );

  const row = db.prepare("SELECT * FROM mcp_machine_credentials WHERE id = ? LIMIT 1").get(id) as McpMachineCredentialRow;
  const record = mapMachineCredential(row);
  appendFlowAuditEvent({
    workspaceId: input.workspaceId,
    userId: input.ownerUserId,
    action: "mcp_machine.created",
    entityType: "mcp_machine",
    entityId: id,
    stage: "mcp",
    status: "created",
    payload: {
      machineId,
      secretHint,
      scopes,
      rotatesAt
    }
  });
  return { secret, record };
}

export function listMcpMachineCredentials(workspaceId: string): McpMachineCredentialRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT *
         FROM mcp_machine_credentials
        WHERE workspace_id = ?
        ORDER BY updated_at DESC`
    )
    .all(workspaceId) as McpMachineCredentialRow[];
  return rows.map(mapMachineCredential);
}

export function revokeMcpMachineCredential(input: {
  workspaceId: string;
  credentialId: string;
  ownerUserId: string;
}): McpMachineCredentialRecord | null {
  const stamp = nowIso();
  const db = getDb();
  db.prepare(
    `UPDATE mcp_machine_credentials
        SET status = 'revoked',
            revoked_at = COALESCE(revoked_at, ?),
            updated_at = ?
      WHERE workspace_id = ?
        AND id = ?`
  ).run(stamp, stamp, input.workspaceId, input.credentialId);
  const row = db
    .prepare("SELECT * FROM mcp_machine_credentials WHERE workspace_id = ? AND id = ? LIMIT 1")
    .get(input.workspaceId, input.credentialId) as McpMachineCredentialRow | undefined;
  if (!row) {
    return null;
  }
  const record = mapMachineCredential(row);
  appendFlowAuditEvent({
    workspaceId: input.workspaceId,
    userId: input.ownerUserId,
    action: "mcp_machine.revoked",
    entityType: "mcp_machine",
    entityId: input.credentialId,
    stage: "mcp",
    status: "revoked",
    payload: {
      machineId: record.machineId,
      secretHint: record.secretHint
    }
  });
  return record;
}

export function authenticateMcpMachineCredentialForScope(
  rawSecret: string,
  requiredScope: McpMachineCredentialScope
): McpMachineAuthContext | null {
  const secret = rawSecret.trim();
  if (!secret) {
    return null;
  }
  const row = getDb()
    .prepare(
      `SELECT c.*, u.email as owner_email, u.display_name as owner_display_name, u.status as owner_status
         FROM mcp_machine_credentials c
         JOIN users u ON u.id = c.owner_user_id
        WHERE c.secret_hash = ?
        LIMIT 1`
    )
    .get(hashSecret(secret)) as McpMachineCredentialRow | undefined;
  if (!row) {
    return null;
  }
  const record = mapMachineCredential(row);
  if (record.status !== "active" || record.revokedAt || !record.scopes.includes(requiredScope)) {
    return null;
  }
  const workspace = getWorkspace();
  if (!workspace || workspace.id !== record.workspaceId) {
    return null;
  }
  const stamp = nowIso();
  getDb()
    .prepare(
      `UPDATE mcp_machine_credentials
          SET last_used_at = ?,
              updated_at = ?
        WHERE id = ?`
    )
    .run(stamp, stamp, record.id);
  tryAppendFlowAuditEvent({
    workspaceId: record.workspaceId,
    userId: record.ownerUserId,
    action: "mcp_machine.used",
    entityType: "mcp_machine",
    entityId: record.id,
    stage: "mcp",
    status: "succeeded",
    payload: {
      machineId: record.machineId,
      secretHint: record.secretHint,
      requiredScope,
      rotationDue: record.rotatesAt ? new Date(record.rotatesAt).getTime() <= Date.now() : false
    }
  });
  return {
    workspace,
    user: {
      id: record.ownerUserId,
      email: row.owner_email ? String(row.owner_email) : "",
      displayName: row.owner_display_name ? String(row.owner_display_name) : "MCP machine",
      status: row.owner_status ? String(row.owner_status) : "active"
    },
    credential: { ...record, lastUsedAt: stamp, updatedAt: stamp }
  };
}
