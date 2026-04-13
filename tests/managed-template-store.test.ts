import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createManagedTemplate,
  deleteManagedTemplateDetailed,
  getWorkspaceDefaultTemplateId,
  listManagedTemplates,
  readManagedTemplateSync,
  resolveManagedTemplate,
  resolveManagedTemplateSync,
  updateManagedTemplate
} from "../lib/managed-template-store";
import { STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
import { bootstrapOwner } from "../lib/team-store";
import { getDb } from "../lib/db/client";

async function withIsolatedTemplateWorkspace<T>(
  run: (input: { appDataDir: string; legacyRoot: string; owner: Awaited<ReturnType<typeof bootstrapOwner>> }) => Promise<T>
): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-workspace-templates-test-"));
  const legacyRoot = path.join(appDataDir, "legacy-managed-templates");
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousRoot = process.env.MANAGED_TEMPLATES_ROOT;
  const previousLegacyRoot = process.env.MANAGED_TEMPLATES_LEGACY_ROOT;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.MANAGED_TEMPLATES_ROOT = path.join(appDataDir, "managed-templates");
  process.env.MANAGED_TEMPLATES_LEGACY_ROOT = legacyRoot;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    await mkdir(legacyRoot, { recursive: true });
    const owner = await bootstrapOwner({
      workspaceName: "Workspace Templates",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    return await run({ appDataDir, legacyRoot, owner });
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_ROOT = previousRoot;
    }
    if (previousLegacyRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_LEGACY_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_LEGACY_ROOT = previousLegacyRoot;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("workspace template library seeds a DB-backed default template", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const templates = await listManagedTemplates(owner.workspace.id);
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const resolvedAsync = await resolveManagedTemplate(null, { workspaceId: owner.workspace.id });
    const resolvedSync = resolveManagedTemplateSync(undefined, { workspaceId: owner.workspace.id });
    const resolvedLegacyBuiltInId = await resolveManagedTemplate(STAGE3_TEMPLATE_ID, {
      workspaceId: owner.workspace.id
    });

    assert.ok(templates.length >= 1);
    assert.equal(defaultTemplateId, templates.find((template) => template.id === defaultTemplateId)?.id);
    assert.notEqual(defaultTemplateId, STAGE3_TEMPLATE_ID);
    assert.equal(resolvedAsync?.id, defaultTemplateId);
    assert.equal(resolvedSync?.id, defaultTemplateId);
    assert.equal(resolvedLegacyBuiltInId?.id, defaultTemplateId);
    assert.equal(resolvedAsync?.layoutFamily, STAGE3_TEMPLATE_ID);
  });
});

test("legacy repo-backed custom templates import into workspace_templates", async () => {
  await withIsolatedTemplateWorkspace(async ({ legacyRoot, owner }) => {
    const legacyTemplateId = "legacy-custom-template";
    await writeFile(
      path.join(legacyRoot, `${legacyTemplateId}.json`),
      JSON.stringify(
        {
          id: legacyTemplateId,
          workspaceId: owner.workspace.id,
          creatorUserId: owner.user.id,
          creatorDisplayName: "Legacy Editor",
          createdAt: "2026-04-08T10:00:00.000Z",
          updatedAt: "2026-04-08T10:00:00.000Z",
          versions: [],
          name: "Legacy Custom Template",
          description: "Stored in the repo-backed folder",
          baseTemplateId: "science-card-v1",
          content: {
            topText: "Legacy top",
            bottomText: "Legacy bottom",
            channelName: "Legacy",
            channelHandle: "@legacy",
            highlights: { top: [], bottom: [] },
            topHighlightPhrases: [],
            topFontScale: 1,
            bottomFontScale: 1,
            previewScale: 0.34,
            mediaAsset: null,
            backgroundAsset: null,
            avatarAsset: null
          },
          templateConfig: {},
          shadowLayers: []
        },
        null,
        2
      ),
      "utf-8"
    );

    const templates = await listManagedTemplates(owner.workspace.id);

    assert.ok(templates.some((template) => template.id === legacyTemplateId));
  });
});

test("managed templates preserve custom card geometry and author font stacks", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Geometry Control",
        baseTemplateId: "science-card-v1",
        templateConfig: {
          card: {
            x: 120,
            y: 220,
            width: 760,
            height: 1360
          },
          typography: {
            authorName: {
              fontFamily: '"Aptos","Segoe UI","Helvetica Neue",Arial,sans-serif'
            },
            authorHandle: {
              fontFamily: '"American Typewriter","Courier New","Georgia",serif'
            }
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(reloaded?.templateConfig.card.x, 120);
    assert.equal(reloaded?.templateConfig.card.y, 220);
    assert.equal(reloaded?.templateConfig.card.width, 760);
    assert.equal(reloaded?.templateConfig.card.height, 1360);
    assert.equal(
      reloaded?.templateConfig.typography.authorName.fontFamily,
      '"Aptos","Segoe UI","Helvetica Neue",Arial,sans-serif'
    );
    assert.equal(
      reloaded?.templateConfig.typography.authorHandle.fontFamily,
      '"American Typewriter","Courier New","Georgia",serif'
    );
  });
});

test("managed templates persist an explicit empty badge asset path", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Badge Color Mode",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const updated = await updateManagedTemplate(
      template.id,
      {
        baseTemplateId: "science-card-v1",
        templateConfig: {
          author: {
            checkAssetPath: ""
          },
          palette: {
            checkBadgeColor: "#11aa77"
          }
        }
      },
      { workspaceId: owner.workspace.id }
    );
    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(updated?.templateConfig.author.checkAssetPath, "");
    assert.equal(updated?.templateConfig.palette.checkBadgeColor, "#11aa77");
    assert.equal(reloaded?.templateConfig.author.checkAssetPath, "");
    assert.equal(reloaded?.templateConfig.palette.checkBadgeColor, "#11aa77");
  });
});

test("managed templates persist custom top and bottom line heights", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const template = await createManagedTemplate(
      {
        name: "Line Height Control",
        baseTemplateId: "science-card-v1",
        templateConfig: {
          typography: {
            top: {
              lineHeight: 1.12
            },
            bottom: {
              lineHeight: 1.24
            }
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const reloaded = readManagedTemplateSync(template.id, { workspaceId: owner.workspace.id });

    assert.equal(reloaded?.templateConfig.typography.top.lineHeight, 1.12);
    assert.equal(reloaded?.templateConfig.typography.bottom.lineHeight, 1.24);
  });
});

test("soft-deleted legacy templates are not resurrected by later imports", async () => {
  await withIsolatedTemplateWorkspace(async ({ legacyRoot, owner }) => {
    const legacyTemplateId = "legacy-delete-check";
    await writeFile(
      path.join(legacyRoot, `${legacyTemplateId}.json`),
      JSON.stringify({
        id: legacyTemplateId,
        workspaceId: owner.workspace.id,
        name: "Legacy Delete Check",
        baseTemplateId: "science-card-v1"
      }),
      "utf-8"
    );

    assert.ok((await listManagedTemplates(owner.workspace.id)).some((template) => template.id === legacyTemplateId));
    const deleted = await deleteManagedTemplateDetailed(legacyTemplateId, { workspaceId: owner.workspace.id });
    const afterDelete = await listManagedTemplates(owner.workspace.id);

    assert.equal(deleted.deleted, true);
    assert.ok(!afterDelete.some((template) => template.id === legacyTemplateId));
  });
});

test("legacy import does not steal same-id templates from another workspace", async () => {
  await withIsolatedTemplateWorkspace(async ({ legacyRoot, owner }) => {
    const legacyTemplateId = "shared-legacy-id";
    const otherWorkspaceId = "other-workspace-id";
    const stamp = "2026-04-08T10:00:00.000Z";
    const db = getDb();
    db.prepare(
      "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(otherWorkspaceId, "Other Workspace", "other-workspace", stamp, stamp);
    db.prepare(
      `INSERT INTO workspace_templates
       (id, workspace_id, name, description, layout_family, content_json, template_config_json, shadow_layers_json, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      legacyTemplateId,
      otherWorkspaceId,
      "Other Workspace Template",
      "",
      STAGE3_TEMPLATE_ID,
      "{}",
      "{}",
      "[]",
      stamp,
      stamp
    );
    await writeFile(
      path.join(legacyRoot, `${legacyTemplateId}.json`),
      JSON.stringify({
        id: legacyTemplateId,
        workspaceId: owner.workspace.id,
        name: "Owner Legacy Collision",
        baseTemplateId: STAGE3_TEMPLATE_ID
      }),
      "utf-8"
    );

    const chatHistory = await import("../lib/chat-history");
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Collision Channel",
      username: "collision_channel"
    });
    db.prepare("UPDATE channels SET template_id = ? WHERE id = ?").run(legacyTemplateId, channel.id);

    const templates = await listManagedTemplates(owner.workspace.id);
    const importedTemplate = templates.find((template) => template.name === "Owner Legacy Collision");
    const otherWorkspaceTemplate = db
      .prepare("SELECT workspace_id FROM workspace_templates WHERE id = ? LIMIT 1")
      .get(legacyTemplateId) as Record<string, unknown> | undefined;
    const repairedChannel = await chatHistory.getChannelById(channel.id);

    assert.ok(importedTemplate);
    assert.notEqual(importedTemplate.id, legacyTemplateId);
    assert.equal(otherWorkspaceTemplate?.workspace_id, otherWorkspaceId);
    assert.equal(repairedChannel?.templateId, importedTemplate.id);
  });
});

test("deleting the default template promotes an oldest replacement and blocks deleting the last template", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const replacement = await createManagedTemplate(
      {
        name: "Replacement Template",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    const deletedDefault = await deleteManagedTemplateDetailed(defaultTemplateId, {
      workspaceId: owner.workspace.id
    });
    const blockedLastDelete = await deleteManagedTemplateDetailed(replacement.id, {
      workspaceId: owner.workspace.id
    });

    assert.equal(deletedDefault.deleted, true);
    assert.equal(deletedDefault.fallbackTemplateId, replacement.id);
    assert.equal(await getWorkspaceDefaultTemplateId(owner.workspace.id), replacement.id);
    assert.equal(blockedLastDelete.deleted, false);
    assert.equal(blockedLastDelete.reason, "last_template");
  });
});

test("broken channel template references self-heal to the workspace default", async () => {
  await withIsolatedTemplateWorkspace(async ({ owner }) => {
    const chatHistory = await import("../lib/chat-history");
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Repair Channel",
      username: "repair_channel"
    });

    getDb().prepare("UPDATE channels SET template_id = ? WHERE id = ?").run("missing-template-id", channel.id);
    const repaired = await chatHistory.getChannelById(channel.id);

    assert.equal(repaired?.templateId, defaultTemplateId);
  });
});
