import { getDb } from "../../../../lib/db/client";
import { createAuthSession } from "../../../../lib/team-store";

export const runtime = "nodejs";

const MAX_TTL_MINUTES = 60;
const DEFAULT_TTL_MINUTES = 20;

type Body = {
  purpose?: string;
  ttlMinutes?: number;
};

function readHeader(request: Request, name: string): string {
  return request.headers.get(name)?.trim() ?? "";
}

function resolveTtlMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TTL_MINUTES;
  }
  return Math.max(1, Math.min(MAX_TTL_MINUTES, Math.round(value)));
}

function getFirstActiveOwner(): { workspaceId: string; userId: string } | null {
  const row = getDb()
    .prepare(
      `SELECT wm.workspace_id, u.id AS user_id
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.role = 'owner'
         AND u.status = 'active'
       ORDER BY wm.created_at ASC
       LIMIT 1`
    )
    .get() as { workspace_id?: unknown; user_id?: unknown } | undefined;

  if (typeof row?.workspace_id !== "string" || typeof row.user_id !== "string") {
    return null;
  }
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id
  };
}

export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.APP_BOOTSTRAP_SECRET?.trim() ?? "";
  const providedSecret = readHeader(request, "x-codex-ops-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const owner = getFirstActiveOwner();
  if (!owner) {
    return Response.json({ error: "Active owner not found." }, { status: 404 });
  }

  const ttlMinutes = resolveTtlMinutes(body?.ttlMinutes);
  const session = createAuthSession({
    workspaceId: owner.workspaceId,
    userId: owner.userId,
    userAgent: `codex-ops:${body?.purpose?.trim() || "temporary-owner-session"}`,
    ipAddress: "render-ops"
  });
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  getDb().prepare("UPDATE auth_sessions SET expires_at = ? WHERE id = ?").run(expiresAt, session.record.id);

  return Response.json(
    {
      sessionToken: session.token,
      expiresAt,
      workspaceId: owner.workspaceId,
      userId: owner.userId
    },
    { status: 200 }
  );
}
