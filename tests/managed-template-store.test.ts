import assert from "node:assert/strict";
import { access, mkdtemp, rm, unlink } from "node:fs/promises";
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
