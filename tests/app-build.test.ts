import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GET as getRuntimeCapabilities } from "../app/api/runtime/capabilities/route";
import { APP_SESSION_COOKIE } from "../lib/auth/cookies";
import { getAppBuildId, isFallbackAppBuildId, shouldReloadForBuildMismatch } from "../lib/app-build";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-app-build-test-"));
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

test("getAppBuildId prefers deployment commit identifiers and trims them", () => {
  assert.equal(
    getAppBuildId({
      NODE_ENV: "test",
      RENDER_GIT_COMMIT: "  abc123  "
    } as NodeJS.ProcessEnv),
    "abc123"
  );
  assert.equal(
    getAppBuildId({
      NODE_ENV: "test",
      VERCEL_GIT_COMMIT_SHA: "def456"
    } as NodeJS.ProcessEnv),
    "def456"
  );
});

test("shouldReloadForBuildMismatch triggers only for distinct non-empty build ids", () => {
  assert.equal(shouldReloadForBuildMismatch("build-a", "build-b"), true);
  assert.equal(shouldReloadForBuildMismatch("build-a", " build-a "), false);
  assert.equal(shouldReloadForBuildMismatch("", "build-b"), false);
  assert.equal(shouldReloadForBuildMismatch("build-a", ""), false);
});

test("shouldReloadForBuildMismatch ignores local fallback build ids", () => {
  assert.equal(isFallbackAppBuildId("local-2026-04-21T22:51:15.456Z"), true);
  assert.equal(isFallbackAppBuildId("runtime-build-123"), false);
  assert.equal(shouldReloadForBuildMismatch("local-2026-04-21T22:51:15.456Z", "runtime-build-123"), false);
  assert.equal(shouldReloadForBuildMismatch("runtime-build-123", "local-2026-04-21T22:51:15.456Z"), false);
});

test("runtime capabilities expose the current app build id for authenticated clients", async () => {
  await withIsolatedAppData(async () => {
    const previousRenderGitCommit = process.env.RENDER_GIT_COMMIT;
    process.env.RENDER_GIT_COMMIT = "runtime-build-123";

    try {
      const owner = await bootstrapOwner({
        workspaceName: "Build Workspace",
        email: "owner@example.com",
        password: "Password123!",
        displayName: "Owner"
      });

      const response = await getRuntimeCapabilities(
        new Request("http://localhost/api/runtime/capabilities", {
          headers: {
            cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`
          }
        })
      );
      const body = (await response.json()) as { buildId?: string };

      assert.equal(response.status, 200);
      assert.equal(body.buildId, getAppBuildId());
    } finally {
      if (previousRenderGitCommit === undefined) {
        delete process.env.RENDER_GIT_COMMIT;
      } else {
        process.env.RENDER_GIT_COMMIT = previousRenderGitCommit;
      }
    }
  });
});
