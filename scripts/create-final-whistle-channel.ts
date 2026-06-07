import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  FINAL_WHISTLE_CHANNEL_NAME,
  FINAL_WHISTLE_CHANNEL_USERNAME,
  FINAL_WHISTLE_TEMPLATE_NAME,
  createFinalWhistleChannelPatch,
  createFinalWhistleManagedTemplateSnapshot
} from "../lib/final-whistle-channel-preset";
import {
  createChannel,
  createChannelAsset,
  getChannelById,
  updateChannelById
} from "../lib/chat-history";
import { saveChannelAssetFile } from "../lib/channel-assets";
import { getDb } from "../lib/db/client";
import {
  createManagedTemplate,
  updateManagedTemplate
} from "../lib/managed-template-store";

type UpsertArgs = {
  workspaceId?: string;
  creatorUserId?: string;
  username: string;
  name: string;
  avatarPath?: string;
  dryRun: boolean;
};

type WorkspaceRow = {
  id: string;
  name: string;
};

type UserRow = {
  id: string;
  email: string;
  role: string;
};

type ChannelRow = {
  id: string;
  workspace_id: string;
  name: string;
  username: string;
};

type TemplateRow = {
  id: string;
};

export type FinalWhistleUpsertResult = {
  dryRun: boolean;
  channelId: string;
  channelName: string;
  username: string;
  workspaceId: string;
  templateId: string;
  templateAction: "create" | "update" | "dry-run";
  channelAction: "create" | "update" | "dry-run";
  examplesCount: number;
  defaultClipDurationSec: number;
  avatarAssetId: string | null;
};

function parseArgs(argv: string[]): UpsertArgs {
  const args: UpsertArgs = {
    username: FINAL_WHISTLE_CHANNEL_USERNAME,
    name: FINAL_WHISTLE_CHANNEL_NAME,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--workspace-id") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--workspace-id requires a value.");
      args.workspaceId = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--workspace-id=")) {
      args.workspaceId = arg.slice("--workspace-id=".length).trim();
      continue;
    }
    if (arg === "--creator-user-id") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--creator-user-id requires a value.");
      args.creatorUserId = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--creator-user-id=")) {
      args.creatorUserId = arg.slice("--creator-user-id=".length).trim();
      continue;
    }
    if (arg === "--username") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--username requires a value.");
      args.username = value.replace(/^@+/, "");
      index += 1;
      continue;
    }
    if (arg.startsWith("--username=")) {
      args.username = arg.slice("--username=".length).trim().replace(/^@+/, "");
      continue;
    }
    if (arg === "--name") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--name requires a value.");
      args.name = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--name=")) {
      args.name = arg.slice("--name=".length).trim();
      continue;
    }
    if (arg === "--avatar") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--avatar requires a file path.");
      args.avatarPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--avatar=")) {
      args.avatarPath = arg.slice("--avatar=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function resolveWorkspace(workspaceId?: string): WorkspaceRow {
  const db = getDb();
  if (workspaceId) {
    const row = db
      .prepare("SELECT id, name FROM workspaces WHERE id = ? LIMIT 1")
      .get(workspaceId) as WorkspaceRow | undefined;
    if (!row) throw new Error(`Workspace ${workspaceId} was not found.`);
    return row;
  }

  const preferred = db
    .prepare("SELECT id, name FROM workspaces WHERE lower(name) = 'clips' ORDER BY created_at ASC LIMIT 1")
    .get() as WorkspaceRow | undefined;
  if (preferred) return preferred;

  const fallback = db
    .prepare("SELECT id, name FROM workspaces ORDER BY created_at ASC LIMIT 1")
    .get() as WorkspaceRow | undefined;
  if (!fallback) throw new Error("No workspace exists in the local database.");
  return fallback;
}

function resolveCreatorUser(workspaceId: string, creatorUserId?: string): UserRow {
  const db = getDb();
  if (creatorUserId) {
    const row = db
      .prepare(
        `SELECT u.id, u.email, wm.role
           FROM users u
           JOIN workspace_members wm ON wm.user_id = u.id
          WHERE u.id = ? AND wm.workspace_id = ?
          LIMIT 1`
      )
      .get(creatorUserId, workspaceId) as UserRow | undefined;
    if (!row) throw new Error(`User ${creatorUserId} is not a member of workspace ${workspaceId}.`);
    return row;
  }

  const owner = db
    .prepare(
      `SELECT u.id, u.email, wm.role
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ?
        ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, wm.created_at ASC
        LIMIT 1`
    )
    .get(workspaceId) as UserRow | undefined;
  if (!owner) throw new Error(`Workspace ${workspaceId} has no members.`);
  return owner;
}

function findChannelByUsername(username: string, workspaceId: string): ChannelRow | null {
  const db = getDb();
  const normalized = username.trim().replace(/^@+/, "").toLowerCase();
  const row = db
    .prepare(
      `SELECT id, workspace_id, name, username
         FROM channels
        WHERE workspace_id = ?
          AND archived_at IS NULL
          AND lower(username) = ?
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .get(workspaceId, normalized) as ChannelRow | undefined;
  return row ?? null;
}

function findTemplate(workspaceId: string): TemplateRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id
         FROM workspace_templates
        WHERE workspace_id = ?
          AND archived_at IS NULL
          AND name = ?
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .get(workspaceId, FINAL_WHISTLE_TEMPLATE_NAME) as TemplateRow | undefined;
  return row ?? null;
}

async function upsertTemplate(input: {
  workspaceId: string;
  dryRun: boolean;
}): Promise<{ templateId: string; action: "create" | "update" | "dry-run" }> {
  const existing = findTemplate(input.workspaceId);
  if (input.dryRun) {
    return {
      templateId: existing?.id ?? `<would-create:${FINAL_WHISTLE_TEMPLATE_NAME}>`,
      action: "dry-run"
    };
  }

  const snapshot = createFinalWhistleManagedTemplateSnapshot();
  if (existing) {
    const updated = await updateManagedTemplate(existing.id, snapshot, {
      workspaceId: input.workspaceId
    });
    if (!updated) throw new Error(`Template ${existing.id} disappeared during update.`);
    return { templateId: updated.id, action: "update" };
  }

  const created = await createManagedTemplate(snapshot, {
    workspaceId: input.workspaceId,
    creatorUserId: null,
    creatorDisplayName: "Final Whistle preset"
  });
  return { templateId: created.id, action: "create" };
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

async function attachAvatar(input: {
  channelId: string;
  avatarPath?: string;
  dryRun: boolean;
}): Promise<string | null> {
  if (!input.avatarPath) return null;
  const absolutePath = path.resolve(input.avatarPath);
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Avatar file was not found: ${absolutePath}`);
  if (input.dryRun) return "<would-create-avatar-asset>";

  const mimeType = mimeFromPath(absolutePath);
  const buffer = await fs.readFile(absolutePath);
  const assetId = randomUUID().replace(/-/g, "");
  const saved = await saveChannelAssetFile({
    channelId: input.channelId,
    assetId,
    mimeType,
    buffer
  });
  const asset = await createChannelAsset({
    channelId: input.channelId,
    kind: "avatar",
    assetId,
    fileName: saved.fileName,
    originalName: path.basename(absolutePath),
    mimeType,
    sizeBytes: stat.size
  });
  await updateChannelById(input.channelId, { avatarAssetId: asset.id });
  return asset.id;
}

export async function upsertFinalWhistleChannel(
  args: Partial<UpsertArgs> = {}
): Promise<FinalWhistleUpsertResult> {
  const workspace = resolveWorkspace(args.workspaceId);
  const creator = resolveCreatorUser(workspace.id, args.creatorUserId);
  const username = (args.username ?? FINAL_WHISTLE_CHANNEL_USERNAME).trim().replace(/^@+/, "");
  const name = (args.name ?? FINAL_WHISTLE_CHANNEL_NAME).trim() || FINAL_WHISTLE_CHANNEL_NAME;
  const dryRun = args.dryRun === true;

  const existing = findChannelByUsername(username, workspace.id);
  const channelAction: "create" | "update" | "dry-run" = dryRun
    ? "dry-run"
    : existing
      ? "update"
      : "create";

  let channelId = existing?.id ?? `<would-create:${username}>`;
  if (!existing && !dryRun) {
    const created = await createChannel({
      workspaceId: workspace.id,
      creatorUserId: creator.id,
      name,
      username
    });
    channelId = created.id;
  }

  const template = await upsertTemplate({
    workspaceId: workspace.id,
    dryRun
  });
  const patch = createFinalWhistleChannelPatch({
    ownerChannelId: channelId,
    ownerChannelName: name,
    templateId: template.templateId
  });

  if (!dryRun) {
    await updateChannelById(channelId, {
      name,
      username,
      ...patch
    });
  }

  const avatarAssetId = await attachAvatar({
    channelId,
    avatarPath: args.avatarPath,
    dryRun
  });
  const reloaded = dryRun ? null : await getChannelById(channelId);

  return {
    dryRun,
    channelId,
    channelName: reloaded?.name ?? name,
    username: reloaded?.username ?? username,
    workspaceId: workspace.id,
    templateId: template.templateId,
    templateAction: template.action,
    channelAction,
    examplesCount: patch.stage2ExamplesConfig.customExamples.length,
    defaultClipDurationSec: patch.defaultClipDurationSec,
    avatarAssetId: avatarAssetId ?? reloaded?.avatarAssetId ?? null
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await upsertFinalWhistleChannel(args);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
