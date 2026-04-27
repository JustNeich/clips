import { createHash, randomBytes } from "node:crypto";
import { getDb, newId, nowIso } from "./db/client";
import { getWorkspace, type UserRecord, type WorkspaceRecord } from "./team-store";
import { appendFlowAuditEvent, tryAppendFlowAuditEvent } from "./audit-log-store";

export type McpAccessTokenScope = "flow:read";

export type McpAccessTokenRecord = {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  tokenHint: string;
  scopes: McpAccessTokenScope[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatedMcpAccessToken = {
  token: string;
  record: McpAccessTokenRecord;
};

export type McpTokenAuthContext = {
  workspace: WorkspaceRecord;
  user: Pick<UserRecord, "id" | "email" | "displayName" | "status">;
  token: McpAccessTokenRecord;
};

type McpAccessTokenRow = {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  token_hash: string;
  token_hint: string;
  scopes_json: string;
  expires_at: string;
  revoked_at?: string | null;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
  owner_email?: string;
  owner_display_name?: string;
  owner_status?: string;
};

function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseScopes(raw: string | null | undefined): McpAccessTokenScope[] {
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((scope): scope is McpAccessTokenScope => scope === "flow:read");
  } catch {
    return [];
  }
}

function mapMcpToken(row: McpAccessTokenRow): McpAccessTokenRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    ownerUserId: String(row.owner_user_id),
    tokenHint: String(row.token_hint),
    scopes: parseScopes(row.scopes_json),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function createMcpAccessToken(input: {
  workspaceId: string;
  ownerUserId: string;
  expiresInDays?: number | null;
}): CreatedMcpAccessToken {
  const expiresInDays =
    typeof input.expiresInDays === "number" && Number.isFinite(input.expiresInDays)
      ? Math.max(1, Math.min(90, Math.floor(input.expiresInDays)))
      : 30;
  const rawToken = `clips_mcp_${randomBytes(32).toString("hex")}`;
  const tokenHash = hashMcpToken(rawToken);
  const tokenHint = rawToken.slice(-8);
  const stamp = nowIso();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const db = getDb();
  const id = newId();
  db.prepare(
    `INSERT INTO mcp_access_tokens
      (id, workspace_id, owner_user_id, token_hash, token_hint, scopes_json, expires_at, revoked_at, last_used_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
  ).run(
    id,
    input.workspaceId,
    input.ownerUserId,
    tokenHash,
    tokenHint,
    JSON.stringify(["flow:read"]),
    expiresAt,
    stamp,
    stamp
  );
  const row = db.prepare("SELECT * FROM mcp_access_tokens WHERE id = ? LIMIT 1").get(id) as McpAccessTokenRow;
  const record = mapMcpToken(row);
  appendFlowAuditEvent({
    workspaceId: input.workspaceId,
    userId: input.ownerUserId,
    action: "mcp_token.created",
    entityType: "mcp_token",
    entityId: id,
    stage: "mcp",
    status: "created",
    payload: {
      tokenHint,
      scopes: record.scopes,
      expiresAt
    }
  });
  return { token: rawToken, record };
}

export function listMcpAccessTokens(workspaceId: string): McpAccessTokenRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
         FROM mcp_access_tokens
        WHERE workspace_id = ?
        ORDER BY created_at DESC`
    )
    .all(workspaceId) as McpAccessTokenRow[];
  return rows.map(mapMcpToken);
}

export function revokeMcpAccessToken(input: {
  workspaceId: string;
  tokenId: string;
  ownerUserId: string;
}): McpAccessTokenRecord | null {
  const stamp = nowIso();
  const db = getDb();
  db.prepare(
    `UPDATE mcp_access_tokens
        SET revoked_at = COALESCE(revoked_at, ?),
            updated_at = ?
      WHERE workspace_id = ?
        AND id = ?`
  ).run(stamp, stamp, input.workspaceId, input.tokenId);
  const row = db
    .prepare("SELECT * FROM mcp_access_tokens WHERE workspace_id = ? AND id = ? LIMIT 1")
    .get(input.workspaceId, input.tokenId) as McpAccessTokenRow | undefined;
  if (!row) {
    return null;
  }
  const record = mapMcpToken(row);
  appendFlowAuditEvent({
    workspaceId: input.workspaceId,
    userId: input.ownerUserId,
    action: "mcp_token.revoked",
    entityType: "mcp_token",
    entityId: input.tokenId,
    stage: "mcp",
    status: "revoked",
    payload: {
      tokenHint: record.tokenHint
    }
  });
  return record;
}

export function authenticateMcpFlowReadToken(rawToken: string): McpTokenAuthContext | null {
  const token = rawToken.trim();
  if (!token) {
    return null;
  }
  const tokenHash = hashMcpToken(token);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.*, u.email as owner_email, u.display_name as owner_display_name, u.status as owner_status
         FROM mcp_access_tokens t
         JOIN users u ON u.id = t.owner_user_id
        WHERE t.token_hash = ?
        LIMIT 1`
    )
    .get(tokenHash) as McpAccessTokenRow | undefined;
  if (!row) {
    return null;
  }
  const record = mapMcpToken(row);
  if (record.revokedAt || !record.scopes.includes("flow:read")) {
    return null;
  }
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  const workspace = getWorkspace();
  if (!workspace || workspace.id !== record.workspaceId) {
    return null;
  }
  const stamp = nowIso();
  db.prepare(
    `UPDATE mcp_access_tokens
        SET last_used_at = ?,
            updated_at = ?
      WHERE id = ?`
  ).run(stamp, stamp, record.id);
  tryAppendFlowAuditEvent({
    workspaceId: record.workspaceId,
    userId: record.ownerUserId,
    action: "mcp_token.used",
    entityType: "mcp_token",
    entityId: record.id,
    stage: "mcp",
    status: "succeeded",
    payload: {
      tokenHint: record.tokenHint
    }
  });
  return {
    workspace,
    user: {
      id: record.ownerUserId,
      email: row.owner_email ? String(row.owner_email) : "",
      displayName: row.owner_display_name ? String(row.owner_display_name) : "MCP",
      status: row.owner_status ? String(row.owner_status) : "active"
    },
    token: { ...record, lastUsedAt: stamp, updatedAt: stamp }
  };
}
