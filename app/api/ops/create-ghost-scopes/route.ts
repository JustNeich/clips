import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  createChannel,
  createChannelAsset,
  updateChannelById
} from "../../../../lib/chat-history";
import { saveChannelAssetFile } from "../../../../lib/channel-assets";
import { setChannelAccess } from "../../../../lib/channel-access";
import { getDb, newId, nowIso } from "../../../../lib/db/client";
import {
  createManagedTemplate,
  readManagedTemplate,
  updateManagedTemplate
} from "../../../../lib/managed-template-store";

export const runtime = "nodejs";

const TARGET_EMAIL = "salievsardor02@gmail.com";
const TARGET_NAME = "GHOST SCOPES";
const TARGET_USERNAME = "ghostscopes";
const SOURCE_USERNAME = "copscopes";
const AVATAR_PATH = path.join(process.cwd(), "public", "ops", "ghost-scopes-avatar.png");

type ChannelRow = {
  id: string;
  workspace_id: string;
  creator_user_id: string;
  name: string;
  username: string;
  template_id: string;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function getChannelByUsername(username: string): ChannelRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, workspace_id, creator_user_id, name, username, template_id
       FROM channels
       WHERE lower(username) = ?
         AND archived_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get(username.toLowerCase()) as ChannelRow | undefined;
  return row ?? null;
}

function getFirstActiveOwner(workspaceId?: string): { workspaceId: string; userId: string } | null {
  const row = getDb()
    .prepare(
      `SELECT wm.workspace_id, u.id AS user_id
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.role = 'owner'
         AND u.status = 'active'
         ${workspaceId ? "AND wm.workspace_id = ?" : ""}
       ORDER BY wm.created_at ASC
       LIMIT 1`
    )
    .get(...(workspaceId ? [workspaceId] : [])) as { workspace_id?: unknown; user_id?: unknown } | undefined;

  if (typeof row?.workspace_id !== "string" || typeof row.user_id !== "string") {
    return null;
  }
  return { workspaceId: row.workspace_id, userId: row.user_id };
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
    .prepare(
      "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(id, workspaceId, userId, "redactor_limited", now, now);
  return { id, role: "redactor_limited", created: true };
}

export async function POST(): Promise<Response> {
  const existingChannel = getChannelByUsername(TARGET_USERNAME);
  const sourceChannel = getChannelByUsername(SOURCE_USERNAME);
  const owner = getFirstActiveOwner(existingChannel?.workspace_id ?? sourceChannel?.workspace_id);
  if (!owner) {
    return NextResponse.json({ ok: false, error: "Active owner not found." }, { status: 404 });
  }

  const sourceTemplate = sourceChannel
    ? await readManagedTemplate(sourceChannel.template_id, { workspaceId: sourceChannel.workspace_id })
    : null;
  const existingTemplate = existingChannel
    ? await readManagedTemplate(existingChannel.template_id, { workspaceId: existingChannel.workspace_id })
    : null;

  const templateInput = {
    name: `${TARGET_NAME} DarkWall Glow`,
    description: "Ghost-themed DarkWall-style channel story template with soft blue lead glow.",
    layoutFamily: sourceTemplate?.layoutFamily ?? "channel-story-v1",
    baseTemplateId: sourceTemplate?.baseTemplateId ?? "channel-story-v1",
    content: {
      ...(sourceTemplate?.content ?? {}),
      topText: "Did they tell you...",
      bottomText:
        "The hallway camera caught nothing but static - until the white shape moved against the wall. It had no feet, no shadow, and no face, but it stopped exactly where the child had been pointing all night.",
      channelName: TARGET_NAME,
      channelHandle: `@${TARGET_USERNAME}`,
      topFontScale: 1.32,
      bottomFontScale: 1.02,
      avatarAsset: null
    },
    templateConfig: {
      ...(sourceTemplate?.templateConfig ?? {}),
      layoutKind: "channel_story",
      palette: {
        ...(sourceTemplate?.templateConfig.palette ?? {}),
        topTextColor: "#ffffff",
        bottomTextColor: "#f8f8f5",
        authorNameColor: "#ffffff",
        authorHandleColor: "#d5d8df",
        accentColor: "#f0d83a"
      },
      typography: {
        ...(sourceTemplate?.templateConfig.typography ?? {}),
        top: {
          ...(sourceTemplate?.templateConfig.typography.top ?? {}),
          weight: 900,
          lineHeight: 0.92,
          letterSpacing: "-0.018em",
          textShadow:
            "0 0 4px rgba(255,255,255,0.96), 0 0 12px rgba(255,255,255,0.9), 0 0 28px rgba(54,145,255,0.98), 0 0 56px rgba(31,104,255,0.72)"
        },
        bottom: {
          ...(sourceTemplate?.templateConfig.typography.bottom ?? {}),
          textShadow:
            sourceTemplate?.templateConfig.typography.bottom.textShadow ??
            "0 0 7px rgba(0,0,0,0.68)"
        }
      },
      channelStory: {
        ...(sourceTemplate?.templateConfig.channelStory ?? {}),
        leadMode: "clip_custom",
        defaultLeadText: "Did they tell you...",
        headerAlign: "center",
        bodyTextAlign: "center",
        headerHeight: 112,
        headerToLeadGap: 8,
        leadHeight: 146,
        leadToBodyGap: 8,
        leadGlowEnabled: true,
        leadGlowColor: "rgba(42,132,255,0.9)",
        leadGlowHeight: 76,
        leadGlowBlur: 28,
        leadGlowOpacity: 0.86,
        leadGlowSpreadX: 250
      }
    },
    shadowLayers: sourceTemplate?.shadowLayers ?? []
  };

  const template = existingTemplate
    ? await updateManagedTemplate(existingTemplate.id, templateInput, { workspaceId: owner.workspaceId })
    : await createManagedTemplate(templateInput, {
        workspaceId: owner.workspaceId,
        creatorUserId: owner.userId,
        creatorDisplayName: "Codex Ops"
      });
  if (!template) {
    return NextResponse.json({ ok: false, error: "Template update failed." }, { status: 500 });
  }

  const channel =
    existingChannel ??
    await createChannel({
      workspaceId: owner.workspaceId,
      creatorUserId: owner.userId,
      name: TARGET_NAME,
      username: TARGET_USERNAME,
      systemPrompt:
        "Create short eerie paranormal and ghost-sighting story captions for suspense-driven shorts. Keep the tone cinematic, direct and unsettling.",
      descriptionPrompt:
        "Dense scary micro-story format: lead with a disturbing question, then explain the ghost event in vivid but concise prose.",
      templateId: template.id
    });
  if (existingChannel) {
    await updateChannelById(existingChannel.id, {
      name: TARGET_NAME,
      username: TARGET_USERNAME,
      templateId: template.id
    });
  }

  const avatarBuffer = await fs.readFile(AVATAR_PATH);
  const avatarAssetId = newId();
  const savedAvatar = await saveChannelAssetFile({
    channelId: channel.id,
    assetId: avatarAssetId,
    mimeType: "image/png",
    buffer: avatarBuffer
  });
  const avatarAsset = await createChannelAsset({
    channelId: channel.id,
    kind: "avatar",
    fileName: savedAvatar.fileName,
    originalName: "ghost-scopes-avatar.png",
    mimeType: "image/png",
    sizeBytes: avatarBuffer.byteLength,
    assetId: avatarAssetId
  });
  await updateChannelById(channel.id, { avatarAssetId: avatarAsset.id });

  const user = getUserByEmail(TARGET_EMAIL);
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error: "Target user is not registered in Clips yet.",
        email: TARGET_EMAIL,
        channelId: channel.id,
        channelUsername: TARGET_USERNAME,
        accessGranted: false
      },
      { status: 404 }
    );
  }
  if (user.status !== "active") {
    return NextResponse.json(
      {
        ok: false,
        error: "Target user is not active.",
        email: TARGET_EMAIL,
        status: user.status,
        accessGranted: false
      },
      { status: 409 }
    );
  }

  const membership = ensureEditorMembership(owner.workspaceId, user.id);
  const grant = setChannelAccess({
    channelId: channel.id,
    userId: user.id,
    grantedByUserId: owner.userId
  });

  return NextResponse.json({
    ok: true,
    channelId: channel.id,
    channelName: TARGET_NAME,
    channelUsername: TARGET_USERNAME,
    templateId: template.id,
    avatarAssetId: avatarAsset.id,
    email: TARGET_EMAIL,
    userId: user.id,
    membershipId: membership.id,
    membershipRole: membership.role,
    membershipCreated: membership.created,
    accessGrantId: grant.id,
    accessGranted: true
  });
}
