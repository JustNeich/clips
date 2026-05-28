import { pathToFileURL } from "node:url";

import {
  GHOSTFACE_COUNTRY_CHANNEL_NAME,
  GHOSTFACE_COUNTRY_CHANNEL_USERNAME,
  GHOSTFACE_COUNTRY_TEMPLATE_NAME,
  createGhostfaceCountryChannelPatch,
  createGhostfaceCountryManagedTemplateSnapshot
} from "../lib/ghostface-country-channel-preset";
import { getChannelById, updateChannelById } from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import {
  createManagedTemplate,
  updateManagedTemplate
} from "../lib/managed-template-store";

type ApplyArgs = {
  username: string;
  dryRun: boolean;
  templateOnly: boolean;
  workspaceId?: string;
};

type ChannelRow = {
  id: string;
  workspace_id: string;
  name: string;
  username: string;
  template_id: string;
};

type TemplateRow = {
  id: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
};

function parseArgs(argv: string[]): ApplyArgs {
  const args: ApplyArgs = {
    username: GHOSTFACE_COUNTRY_CHANNEL_USERNAME,
    dryRun: false,
    templateOnly: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--template-only") {
      args.templateOnly = true;
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
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function normalizeLookup(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
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
  if (!fallback) throw new Error("No workspace exists in the active APP_DATA_DIR database.");
  return fallback;
}

function findChannel(input: { username: string; workspaceId: string }): ChannelRow | null {
  const db = getDb();
  const username = normalizeLookup(input.username);
  const canonicalName = GHOSTFACE_COUNTRY_CHANNEL_NAME.toLowerCase();
  const compactName = canonicalName.replace(/\s+/g, "");
  const row = db
    .prepare(
      `SELECT id, workspace_id, name, username, template_id
         FROM channels
        WHERE workspace_id = ?
          AND archived_at IS NULL
          AND (
            lower(username) = ?
            OR lower(replace(username, ' ', '')) = ?
            OR lower(name) = ?
            OR lower(replace(name, ' ', '')) = ?
          )
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .get(input.workspaceId, username, username, canonicalName, compactName) as ChannelRow | undefined;
  return row ?? null;
}

function findExistingTemplate(workspaceId: string): TemplateRow | null {
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
    .get(workspaceId, GHOSTFACE_COUNTRY_TEMPLATE_NAME) as TemplateRow | undefined;
  return row ?? null;
}

async function upsertGhostfaceTemplate(input: {
  workspaceId: string;
  dryRun: boolean;
}): Promise<{ templateId: string; action: "create" | "update" | "dry-run" }> {
  const existing = findExistingTemplate(input.workspaceId);
  if (input.dryRun) {
    return {
      templateId: existing?.id ?? `<would-create:${GHOSTFACE_COUNTRY_TEMPLATE_NAME}>`,
      action: "dry-run"
    };
  }

  const snapshot = createGhostfaceCountryManagedTemplateSnapshot();
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
    creatorDisplayName: "Ghostface Country preset"
  });
  return { templateId: created.id, action: "create" };
}

export async function applyGhostfaceCountryChannelTemplate(args: ApplyArgs): Promise<{
  dryRun: boolean;
  workspaceId: string;
  channelId: string | null;
  channelName: string | null;
  username: string | null;
  previousTemplateId: string | null;
  templateId: string;
  templateAction: "create" | "update" | "dry-run";
  channelAction: "update" | "dry-run" | "template-only";
}> {
  let workspace: WorkspaceRow;
  try {
    workspace = resolveWorkspace(args.workspaceId);
  } catch (error) {
    if (args.dryRun && args.templateOnly && !args.workspaceId) {
      createGhostfaceCountryManagedTemplateSnapshot();
      return {
        dryRun: true,
        workspaceId: "<detached-dry-run>",
        channelId: null,
        channelName: null,
        username: null,
        previousTemplateId: null,
        templateId: `<would-create:${GHOSTFACE_COUNTRY_TEMPLATE_NAME}>`,
        templateAction: "dry-run",
        channelAction: "template-only"
      };
    }
    throw error;
  }
  const channel = findChannel({
    username: args.username,
    workspaceId: workspace.id
  });

  if (!channel && !args.templateOnly) {
    throw new Error(
      `Channel @${args.username} / "${GHOSTFACE_COUNTRY_CHANNEL_NAME}" was not found in the active APP_DATA_DIR database. ` +
        "Use --template-only to create/update only the managed template, or point APP_DATA_DIR at the database that contains the channel."
    );
  }

  const template = await upsertGhostfaceTemplate({
    workspaceId: workspace.id,
    dryRun: args.dryRun
  });

  if (args.templateOnly || !channel) {
    return {
      dryRun: args.dryRun,
      workspaceId: workspace.id,
      channelId: null,
      channelName: null,
      username: null,
      previousTemplateId: null,
      templateId: template.templateId,
      templateAction: template.action,
      channelAction: "template-only"
    };
  }

  if (!args.dryRun) {
    await updateChannelById(
      channel.id,
      createGhostfaceCountryChannelPatch({
        templateId: template.templateId
      })
    );
  }

  const reloaded = await getChannelById(channel.id);
  return {
    dryRun: args.dryRun,
    workspaceId: workspace.id,
    channelId: channel.id,
    channelName: reloaded?.name ?? channel.name,
    username: reloaded?.username ?? channel.username,
    previousTemplateId: channel.template_id,
    templateId: template.templateId,
    templateAction: template.action,
    channelAction: args.dryRun ? "dry-run" : "update"
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await applyGhostfaceCountryChannelTemplate(args);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
