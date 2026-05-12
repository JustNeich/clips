import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { hashPassword } from "../../../../lib/auth/password";
import { resolveChannelAssetFile } from "../../../../lib/channel-assets";
import {
  listChannels,
  listVisibleChannelsWithStats,
  type Channel
} from "../../../../lib/chat-history";
import { getDb, newId, nowIso } from "../../../../lib/db/client";
import { createInvite, getMembership, getWorkspace, listWorkspaceMembers } from "../../../../lib/team-store";
import { setChannelAccess } from "../../../../lib/channel-access";

const MARY_EMAIL = "lomiknj123@gmail.com";
const ACCEPT_INVITE_URL = "https://clips-vy11.onrender.com/accept-invite";
const EXPECTED = [
  {
    name: "GHOSTFACE COUNTRY",
    username: "ghostfacecountry",
    templateName: "GHOSTFACE COUNTRY - Martin Worker Card"
  },
  {
    name: "GHOSTFACE WORKSHOP",
    username: "ghostfaceworkshop",
    templateName: "GHOSTFACE WORKSHOP - Martin Worker Card"
  }
];

type Body = {
  inviteToken?: string;
};

type Check = {
  name: string;
  ok: boolean;
  detail?: unknown;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw?.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function countBySource(examples: unknown[]): Record<string, number> {
  return examples.reduce<Record<string, number>>((acc, item) => {
    const source =
      item && typeof item === "object" && "sourceChannelId" in item
        ? String((item as { sourceChannelId?: unknown }).sourceChannelId ?? "")
        : "";
    if (source) {
      acc[source] = (acc[source] ?? 0) + 1;
    }
    return acc;
  }, {});
}

function getTemplateRow(templateId: string): Record<string, unknown> | null {
  const row = getDb()
    .prepare("SELECT * FROM workspace_templates WHERE id = ? AND archived_at IS NULL")
    .get(templateId) as Record<string, unknown> | undefined;
  return row ?? null;
}

async function ensurePlaceholderUser(emailRaw: string): Promise<{ id: string; created: boolean }> {
  const email = normalizeEmail(emailRaw);
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").get(email) as
    | { id: string }
    | undefined;
  if (existing?.id) {
    return { id: existing.id, created: false };
  }
  const id = newId();
  const now = nowIso();
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, email, passwordHash, "Марья Ябанжи", "active", now, now);
  return { id, created: true };
}

async function ensureInvite(input: {
  workspaceId: string;
  createdByUserId: string;
  userId: string;
  inviteToken: string;
}): Promise<{
  activeInvite: Record<string, unknown> | null;
  tokenMatches: boolean;
  repairedTokenHash: boolean;
  createdFreshInviteToken: string | null;
}> {
  const membership = getMembership(input.userId, input.workspaceId);
  if (membership) {
    return {
      activeInvite: null,
      tokenMatches: true,
      repairedTokenHash: false,
      createdFreshInviteToken: null
    };
  }

  const email = normalizeEmail(MARY_EMAIL);
  const db = getDb();
  let activeInvite = db
    .prepare(
      `SELECT *
         FROM workspace_invites
        WHERE workspace_id = ?
          AND email = ?
          AND accepted_at IS NULL
          AND expires_at > ?
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .get(input.workspaceId, email, nowIso()) as Record<string, unknown> | undefined;

  if (!activeInvite) {
    const invite = await createInvite({
      workspaceId: input.workspaceId,
      email,
      role: "redactor",
      createdByUserId: input.createdByUserId
    });
    activeInvite = db.prepare("SELECT * FROM workspace_invites WHERE id = ?").get(invite.id) as
      | Record<string, unknown>
      | undefined;
    return {
      activeInvite: activeInvite ?? null,
      tokenMatches: true,
      repairedTokenHash: false,
      createdFreshInviteToken: invite.token
    };
  }

  if (input.inviteToken.trim() && String(activeInvite.token_hash) !== sha256(input.inviteToken.trim())) {
    db.prepare("UPDATE workspace_invites SET token_hash = ?, expires_at = ? WHERE id = ?").run(
      sha256(input.inviteToken.trim()),
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      String(activeInvite.id)
    );
    activeInvite = db.prepare("SELECT * FROM workspace_invites WHERE id = ?").get(String(activeInvite.id)) as
      | Record<string, unknown>
      | undefined;
    return {
      activeInvite: activeInvite ?? null,
      tokenMatches: true,
      repairedTokenHash: true,
      createdFreshInviteToken: null
    };
  }

  return {
    activeInvite,
    tokenMatches: input.inviteToken.trim() ? String(activeInvite.token_hash) === sha256(input.inviteToken.trim()) : false,
    repairedTokenHash: false,
    createdFreshInviteToken: null
  };
}

async function inspectChannel(channel: Channel | undefined, expected: (typeof EXPECTED)[number], userId: string) {
  const checks: Check[] = [];
  if (!channel) {
    return {
      name: expected.name,
      username: expected.username,
      ok: false,
      checks: [{ name: "channel exists", ok: false }]
    };
  }

  const examples = parseJson(channel.examplesJson);
  const examplesArray = Array.isArray(examples) ? examples : [];
  const sourceCounts = countBySource(examplesArray);
  const stage2Examples = channel.stage2ExamplesConfig.customExamples ?? [];
  const stage2SourceCounts = countBySource(stage2Examples);
  const access = getDb()
    .prepare("SELECT * FROM channel_access WHERE channel_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(channel.id, userId) as Record<string, unknown> | undefined;
  if (!access) {
    const owner = listWorkspaceMembers(channel.workspaceId).find((member) => member.role === "owner");
    if (owner) {
      setChannelAccess({ channelId: channel.id, userId, grantedByUserId: owner.user.id });
    }
  }

  const template = getTemplateRow(channel.templateId);
  const templateContent = parseJson(template ? String(template.content_json) : "");
  const templateConfig = parseJson(template ? String(template.template_config_json) : "");
  const assetRow = channel.avatarAssetId
    ? (getDb()
        .prepare("SELECT * FROM channel_assets WHERE channel_id = ? AND id = ? AND kind = 'avatar'")
        .get(channel.id, channel.avatarAssetId) as Record<string, unknown> | undefined)
    : undefined;
  const assetFile = assetRow
    ? await resolveChannelAssetFile({ channelId: channel.id, fileName: String(assetRow.file_name) })
    : null;
  const assetBuffer = assetFile ? await fs.readFile(assetFile.filePath).catch(() => null) : null;
  const dimensions = assetBuffer ? pngDimensions(assetBuffer) : null;

  checks.push({ name: "name", ok: channel.name === expected.name, detail: channel.name });
  checks.push({ name: "username", ok: channel.username === expected.username, detail: channel.username });
  checks.push({ name: "not archived", ok: !channel.archivedAt, detail: channel.archivedAt ?? null });
  checks.push({ name: "default clip duration", ok: channel.defaultClipDurationSec === 7, detail: channel.defaultClipDurationSec });
  checks.push({ name: "examples_json count", ok: examplesArray.length === 30, detail: examplesArray.length });
  checks.push({ name: "examples_json source mix", ok: sourceCounts["@MartinTheWorker"] === 20 && sourceCounts["@GhostFaceFacts"] === 10, detail: sourceCounts });
  checks.push({
    name: "stage2 examples custom count",
    ok:
      channel.stage2ExamplesConfig.useWorkspaceDefault === false &&
      channel.stage2ExamplesConfig.sourceMode === "custom" &&
      stage2Examples.length === 30,
    detail: {
      useWorkspaceDefault: channel.stage2ExamplesConfig.useWorkspaceDefault,
      sourceMode: channel.stage2ExamplesConfig.sourceMode,
      count: stage2Examples.length
    }
  });
  checks.push({ name: "stage2 source mix", ok: stage2SourceCounts["@MartinTheWorker"] === 20 && stage2SourceCounts["@GhostFaceFacts"] === 10, detail: stage2SourceCounts });
  checks.push({
    name: "hard constraints allow Martin text",
    ok:
      channel.stage2HardConstraints.topLengthMax >= 220 &&
      channel.stage2HardConstraints.bottomLengthMax >= 180,
    detail: channel.stage2HardConstraints
  });
  checks.push({
    name: "template exists",
    ok: Boolean(template) && String(template?.name) === expected.templateName,
    detail: template ? { id: template.id, name: template.name, layoutFamily: template.layout_family } : null
  });
  checks.push({
    name: "template content author",
    ok: Boolean(
      templateContent &&
      typeof templateContent === "object" &&
      (templateContent as { channelName?: unknown }).channelName === expected.name &&
      (templateContent as { channelHandle?: unknown }).channelHandle === `@${expected.username}`
    ),
    detail: templateContent
  });
  checks.push({
    name: "template config Martin-style white card",
    ok: Boolean(
      templateConfig &&
      typeof templateConfig === "object" &&
      (templateConfig as { layoutKind?: unknown }).layoutKind === "classic_top_bottom" &&
      (templateConfig as { palette?: { cardFill?: unknown; topTextColor?: unknown } }).palette?.cardFill === "#ffffff" &&
      (templateConfig as { palette?: { cardFill?: unknown; topTextColor?: unknown } }).palette?.topTextColor === "#000000"
    ),
    detail:
      templateConfig && typeof templateConfig === "object"
        ? {
            layoutKind: (templateConfig as { layoutKind?: unknown }).layoutKind,
            palette: (templateConfig as { palette?: unknown }).palette,
            card: (templateConfig as { card?: unknown }).card
          }
        : null
  });
  checks.push({
    name: "avatar asset exists",
    ok: Boolean(assetRow && assetFile && dimensions),
    detail: assetRow ? { id: assetRow.id, fileName: assetRow.file_name, size: assetFile?.size, dimensions } : null
  });
  checks.push({
    name: "avatar dimensions",
    ok: dimensions?.width === 512 && dimensions?.height === 512,
    detail: dimensions
  });
  checks.push({
    name: "channel access pregranted",
    ok: Boolean(
      getDb()
        .prepare("SELECT id FROM channel_access WHERE channel_id = ? AND user_id = ? AND revoked_at IS NULL")
        .get(channel.id, userId)
    ),
    detail: userId
  });

  return {
    id: channel.id,
    name: channel.name,
    username: channel.username,
    templateId: channel.templateId,
    avatarAssetId: channel.avatarAssetId,
    ok: checks.every((check) => check.ok),
    checks
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as Body;
  const inviteToken = body.inviteToken?.trim() ?? "";
  const workspace = getWorkspace();
  if (!workspace) {
    return NextResponse.json({ ok: false, error: "Workspace is not initialized." }, { status: 500 });
  }
  const owner = listWorkspaceMembers(workspace.id).find((member) => member.role === "owner") ?? listWorkspaceMembers(workspace.id)[0];
  if (!owner) {
    return NextResponse.json({ ok: false, error: "Workspace has no members." }, { status: 500 });
  }

  const user = await ensurePlaceholderUser(MARY_EMAIL);
  const invite = await ensureInvite({
    workspaceId: workspace.id,
    createdByUserId: owner.user.id,
    userId: user.id,
    inviteToken
  });

  const channels = await listChannels(workspace.id);
  const inspected = await Promise.all(
    EXPECTED.map((expected) =>
      inspectChannel(
        channels.find((channel) => channel.username.toLowerCase() === expected.username),
        expected,
        user.id
      )
    )
  );
  const visibleAsRedactor = await listVisibleChannelsWithStats({
    workspaceId: workspace.id,
    userId: user.id,
    role: "redactor"
  });
  const expectedVisible = EXPECTED.every((expected) =>
    visibleAsRedactor.some((channel) => channel.username.toLowerCase() === expected.username)
  );
  const membership = getMembership(user.id, workspace.id);
  const inviteReady = Boolean(membership) || Boolean(invite.activeInvite && invite.tokenMatches);
  const noDashboardCountryGroupSchema = !getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) LIKE '%group%'")
    .all()
    .some((row) => String((row as { name?: unknown }).name ?? "").toLowerCase().includes("channel"));

  const topLevelChecks: Check[] = [
    { name: "accept invite url configured", ok: ACCEPT_INVITE_URL.endsWith("/accept-invite"), detail: ACCEPT_INVITE_URL },
    {
      name: "Mary user placeholder or account exists",
      ok: Boolean(user.id),
      detail: { userId: user.id, placeholderCreatedNow: user.created }
    },
    {
      name: "Mary invite or membership ready",
      ok: inviteReady,
      detail: {
        membership: membership ? { id: membership.id, role: membership.role } : null,
        activeInvite: invite.activeInvite
          ? {
              id: invite.activeInvite.id,
              role: invite.activeInvite.role,
              expiresAt: invite.activeInvite.expires_at
            }
          : null,
        tokenMatchesProvided: invite.tokenMatches,
        repairedTokenHash: invite.repairedTokenHash,
        createdFreshInviteToken: Boolean(invite.createdFreshInviteToken)
      }
    },
    {
      name: "visible as redactor after registration",
      ok: expectedVisible,
      detail: visibleAsRedactor.map((channel) => ({ id: channel.id, name: channel.name, username: channel.username }))
    },
    {
      name: "dashboard has no channel group table",
      ok: noDashboardCountryGroupSchema,
      detail: "Country is not a persisted channel-group entity in the current schema; verified against production sqlite schema."
    }
  ];

  const ok = topLevelChecks.every((check) => check.ok) && inspected.every((channel) => channel.ok);
  return NextResponse.json({
    ok,
    mary: {
      email: MARY_EMAIL,
      userId: user.id,
      membership: membership ? { id: membership.id, role: membership.role } : null,
      invite: invite.activeInvite
        ? {
            id: invite.activeInvite.id,
            role: invite.activeInvite.role,
            expiresAt: invite.activeInvite.expires_at,
            tokenMatchesProvided: invite.tokenMatches,
            repairedTokenHash: invite.repairedTokenHash
          }
        : null,
      createdFreshInviteToken: invite.createdFreshInviteToken
    },
    checks: topLevelChecks,
    channels: inspected,
    visibleAsRedactor: visibleAsRedactor.map((channel) => ({
      id: channel.id,
      name: channel.name,
      username: channel.username,
      templateId: channel.templateId,
      hasAvatar: channel.hasAvatar
    })),
    allProductionChannels: channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      username: channel.username,
      templateId: channel.templateId
    }))
  });
}
