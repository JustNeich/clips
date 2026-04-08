import assert from "node:assert/strict";
import { access, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createManagedTemplate,
  listManagedTemplates,
  resolveManagedTemplate,
  resolveManagedTemplateSync
} from "../lib/managed-template-store";
import { STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
import { listTemplateVariants } from "../lib/stage3-template-registry";

async function withIsolatedManagedTemplatesRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "clips-managed-templates-test-"));
  const previousRoot = process.env.MANAGED_TEMPLATES_ROOT;
  process.env.MANAGED_TEMPLATES_ROOT = root;

  try {
    return await run(root);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_ROOT = previousRoot;
    }
    await rm(root, { recursive: true, force: true });
  }
}

async function withManagedTemplateMigrationRoots<T>(run: (input: { appDataDir: string; legacyRoot: string }) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-managed-templates-appdata-test-"));
  const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "clips-managed-templates-legacy-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousRoot = process.env.MANAGED_TEMPLATES_ROOT;
  const previousLegacyRoot = process.env.MANAGED_TEMPLATES_LEGACY_ROOT;
  process.env.APP_DATA_DIR = appDataDir;
  delete process.env.MANAGED_TEMPLATES_ROOT;
  process.env.MANAGED_TEMPLATES_LEGACY_ROOT = legacyRoot;

  try {
    return await run({ appDataDir, legacyRoot });
  } finally {
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
    await rm(legacyRoot, { recursive: true, force: true });
  }
}

test("managed template store backfills missing built-in templates even after the seed marker exists", async () => {
  await withIsolatedManagedTemplatesRoot(async (root) => {
    const variants = listTemplateVariants().map((variant) => variant.id);
    assert.ok(variants.length >= 2, "Expected at least two built-in templates for backfill coverage.");

    await listManagedTemplates();

    const missingTemplateId = variants.find((templateId) => templateId !== STAGE3_TEMPLATE_ID) ?? variants[0];
    const missingTemplatePath = path.join(root, `${missingTemplateId}.json`);
    await unlink(missingTemplatePath);

    const templates = await listManagedTemplates();

    await access(missingTemplatePath);
    assert.ok(templates.some((template) => template.id === missingTemplateId));
  });
});

test("managed template resolution defaults to the stable Stage 3 template id", async () => {
  await withIsolatedManagedTemplatesRoot(async () => {
    await listManagedTemplates();
    await createManagedTemplate(
      {
        name: "Newest Custom Template",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: "workspace_test",
        creatorUserId: "user_test",
        creatorDisplayName: "Tester"
      }
    );

    const resolvedAsync = await resolveManagedTemplate(null);
    const resolvedSync = resolveManagedTemplateSync(undefined);

    assert.equal(resolvedAsync?.id, STAGE3_TEMPLATE_ID);
    assert.equal(resolvedSync?.id, STAGE3_TEMPLATE_ID);
  });
});

test("managed template store migrates legacy repo-backed templates into app data storage", async () => {
  await withManagedTemplateMigrationRoots(async ({ appDataDir, legacyRoot }) => {
    const legacyTemplateId = "legacy-custom-template";
    await writeFile(
      path.join(legacyRoot, `${legacyTemplateId}.json`),
      JSON.stringify(
        {
          id: legacyTemplateId,
          workspaceId: "workspace_legacy",
          creatorUserId: "user_legacy",
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

    const templates = await listManagedTemplates();
    const migratedPath = path.join(appDataDir, "managed-templates", `${legacyTemplateId}.json`);

    assert.ok(templates.some((template) => template.id === legacyTemplateId));
    await access(migratedPath);
  });
});
