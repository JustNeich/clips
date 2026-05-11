import { setChannelAccess } from "../../../../lib/channel-access";
import { getDb, newId, nowIso } from "../../../../lib/db/client";

export const runtime = "nodejs";

const TARGET_EMAIL = "salievsardor02@gmail.com";
const TARGET_USERNAME = "copscopes";
const TARGET_ROLE = "redactor_limited";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function readHeader(request: Request, name: string): string {
  return request.headers.get(name)?.trim() ?? "";
}

function getTargetChannel(): { id: string; workspaceId: string } | null {
  const row = getDb()
    .prepare(
      `SELECT id, workspace_id
       FROM channels
       WHERE username = ?
         AND archived_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get(TARGET_USERNAME) as { id?: unknown; workspace_id?: unknown } | undefined;
  if (typeof row?.id !== "string" || typeof row.workspace_id !== "string") {
    return null;
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id
  };
}

function getFirstActiveOwner(workspaceId: string): { userId: string } | null {
  const row = getDb()
    .prepare(
      `SELECT u.id AS user_id
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ?
         AND wm.role = 'owner'
         AND u.status = 'active'
       ORDER BY wm.created_at ASC
       LIMIT 1`
    )
    .get(workspaceId) as { user_id?: unknown } | undefined;
  return typeof row?.user_id === "string" ? { userId: row.user_id } : null;
}

function getUserByEmail(email: string): { id: string; status: string } | null {
  const row = getDb()
    .prepare("SELECT id, status FROM users WHERE email = ? LIMIT 1")
    .get(normalizeEmail(email)) as { id?: unknown; status?: unknown } | undefined;
  if (typeof row?.id !== "string") {
    return null;
  }
  return {
    id: row.id,
    status: typeof row.status === "string" ? row.status : ""
  };
}

function getMembership(workspaceId: string, userId: string): { id: string; role: string } | null {
  const row = getDb()
    .prepare("SELECT id, role FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1")
    .get(workspaceId, userId) as { id?: unknown; role?: unknown } | undefined;
  if (typeof row?.id !== "string") {
    return null;
  }
  return {
    id: row.id,
    role: typeof row.role === "string" ? row.role : ""
  };
}

function ensureEditorMembership(workspaceId: string, userId: string): { id: string; role: string; created: boolean } {
  const existing = getMembership(workspaceId, userId);
  if (existing) {
    return { ...existing, created: false };
  }

  const now = nowIso();
  const id = newId();
  getDb()
    .prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, workspaceId, userId, TARGET_ROLE, now, now);
  return {
    id,
    role: TARGET_ROLE,
    created: true
  };
}

export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.APP_BOOTSTRAP_SECRET?.trim() ?? "";
  const providedSecret = readHeader(request, "x-codex-ops-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const channel = getTargetChannel();
  if (!channel) {
    return Response.json({ error: "COP SCOPES channel not found." }, { status: 404 });
  }

  const owner = getFirstActiveOwner(channel.workspaceId);
  if (!owner) {
    return Response.json({ error: "Active owner not found." }, { status: 404 });
  }

  const user = getUserByEmail(TARGET_EMAIL);
  if (!user) {
    return Response.json(
      {
        error: "Target user is not registered in Clips yet.",
        email: TARGET_EMAIL,
        channelUsername: TARGET_USERNAME,
        accessGranted: false
      },
      { status: 404 }
    );
  }
  if (user.status !== "active") {
    return Response.json(
      {
        error: "Target user is not active.",
        email: TARGET_EMAIL,
        status: user.status,
        accessGranted: false
      },
      { status: 409 }
    );
  }

  const membership = ensureEditorMembership(channel.workspaceId, user.id);
  const grant = setChannelAccess({
    channelId: channel.id,
    userId: user.id,
    grantedByUserId: owner.userId
  });

  return Response.json(
    {
      ok: true,
      email: TARGET_EMAIL,
      channelId: channel.id,
      channelUsername: TARGET_USERNAME,
      userId: user.id,
      membershipId: membership.id,
      membershipRole: membership.role,
      membershipCreated: membership.created,
      accessGrantId: grant.id,
      accessGranted: true
    },
    { status: 200 }
  );
}
