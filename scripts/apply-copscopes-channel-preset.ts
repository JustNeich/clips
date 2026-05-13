import { pathToFileURL } from "node:url";

import { getDb } from "../lib/db/client";
import {
  COPSCOPES_CHANNEL_USERNAME,
  COPSCOPES_TEMPLATE_NAME,
  createCopscopesChannelPatch,
  createCopscopesManagedTemplateSnapshot
} from "../lib/copscopes-channel-preset";
import { getChannelById, updateChannelById } from "../lib/chat-history";
import {
  createManagedTemplate,
  updateManagedTemplate
} from "../lib/managed-template-store";

type ApplyArgs = {
  username: string;
  dryRun: boolean;
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

function parseArgs(argv: string[]): ApplyArgs {
  const args: ApplyArgs = {
    username: COPSCOPES_CHANNEL_USERNAME,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--username") {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error("--username requires a value.");
      }
      args.username = value.replace(/^@+/, "");
      index += 1;
      continue;
    }
    if (arg.startsWith("--username=")) {
      args.username = arg.slice("--username=".length).replace(/^@+/, "");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function findChannelByUsername(username: string): ChannelRow | null {
  const db = getDb();
  const normalized = username.trim().replace(/^@+/, "").toLowerCase();
  const row = db
    .prepare(
      `SELECT id, workspace_id, name, username
       FROM channels
       WHERE archived_at IS NULL
         AND lower(username) = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(normalized) as ChannelRow | undefined;
  return row ?? null;
}

function findExistingCopscopesTemplate(workspaceId: string): TemplateRow | null {
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
    .get(workspaceId, COPSCOPES_TEMPLATE_NAME) as TemplateRow | undefined;
  return row ?? null;
}

async function upsertCopscopesTemplate(input: {
  workspaceId: string;
  dryRun: boolean;
}): Promise<{ templateId: string; action: "create" | "update" | "dry-run" }> {
  const snapshot = createCopscopesManagedTemplateSnapshot();
  const existing = findExistingCopscopesTemplate(input.workspaceId);
  if (input.dryRun) {
    return {
      templateId: existing?.id ?? `<would-create:${COPSCOPES_TEMPLATE_NAME}>`,
      action: "dry-run"
    };
  }
  if (existing) {
    const updated = await updateManagedTemplate(existing.id, snapshot, {
      workspaceId: input.workspaceId
    });
    if (!updated) {
      throw new Error(`Template ${existing.id} disappeared during update.`);
    }
    return { templateId: updated.id, action: "update" };
  }

  const created = await createManagedTemplate(snapshot, {
    workspaceId: input.workspaceId,
    creatorUserId: null,
    creatorDisplayName: "Copscopes preset"
  });
  return { templateId: created.id, action: "create" };
}

export async function applyCopscopesChannelPreset(args: ApplyArgs): Promise<{
  dryRun: boolean;
  channelId: string;
  channelName: string;
  username: string;
  templateId: string;
  templateAction: "create" | "update" | "dry-run";
  examplesCount: number;
}> {
  const row = findChannelByUsername(args.username);
  if (!row) {
    throw new Error(
      `Channel @${args.username} was not found in the active APP_DATA_DIR database. ` +
        "Create or sync the production channel first, then rerun this script."
    );
  }

  const template = await upsertCopscopesTemplate({
    workspaceId: row.workspace_id,
    dryRun: args.dryRun
  });
  const patch = createCopscopesChannelPatch({
    ownerChannelId: row.id,
    ownerChannelName: row.name,
    templateId: template.templateId
  });

  if (!args.dryRun) {
    await updateChannelById(row.id, patch);
  }

  const reloaded = await getChannelById(row.id);
  return {
    dryRun: args.dryRun,
    channelId: row.id,
    channelName: reloaded?.name ?? row.name,
    username: reloaded?.username ?? row.username,
    templateId: template.templateId,
    templateAction: template.action,
    examplesCount: patch.stage2ExamplesConfig.customExamples.length
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await applyCopscopesChannelPreset(args);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
