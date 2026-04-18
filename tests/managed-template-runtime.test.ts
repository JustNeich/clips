import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_STAGE3_VIDEO_ADJUSTMENTS } from "../lib/stage3-video-adjustments";
import { resolveManagedTemplateRuntimeSync } from "../lib/managed-template-runtime";

async function withIsolatedWorkerAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-managed-template-runtime-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  process.env.APP_DATA_DIR = appDataDir;

  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("built-in managed template runtime resolves without a workspace DB bootstrap", async () => {
  await withIsolatedWorkerAppData(async () => {
    const resolved = resolveManagedTemplateRuntimeSync("science-card-red-v1", null, {
      workspaceId: "missing-workspace"
    });

    assert.equal(resolved.managedTemplateId, "science-card-red-v1");
    assert.equal(resolved.baseTemplateId, "science-card-red-v1");
    assert.equal(resolved.templateConfig.card.borderColor, "#d33f49");
    assert.deepEqual(resolved.templateConfig.videoAdjustments, DEFAULT_STAGE3_VIDEO_ADJUSTMENTS);
  });
});
