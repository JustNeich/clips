import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-workspace-codex-test-"));
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

test("missing Shared Codex home degrades to disconnected instead of breaking auth refresh", async () => {
  await withIsolatedAppData(async () => {
    const { bootstrapOwner, getWorkspaceCodexIntegration, upsertWorkspaceCodexIntegration } = await import(
      "../lib/team-store"
    );
    const { getWorkspaceCodexStatus, requireWorkspaceCodexHome } = await import("../lib/workspace-codex");

    const auth = await bootstrapOwner({
      workspaceName: "Codex Integration",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    upsertWorkspaceCodexIntegration({
      workspaceId: auth.workspace.id,
      ownerUserId: auth.user.id,
      status: "connected",
      codexSessionId: "66c8fc5524014f7c909314421ccde3ec",
      codexHomePath: "/var/data/codex-sessions/66c8fc5524014f7c909314421ccde3ec",
      loginStatusText: "Connected",
      deviceAuthStatus: "done",
      deviceAuthOutput: "ok",
      deviceAuthLoginUrl: null,
      deviceAuthUserCode: null,
      connectedAt: new Date().toISOString()
    });

    const refreshed = await getWorkspaceCodexStatus(auth);
    assert.equal(refreshed?.status, "disconnected");
    assert.equal(refreshed?.codexSessionId, null);
    assert.equal(refreshed?.codexHomePath, null);
    assert.equal(refreshed?.loginStatusText, "Отключен");

    const persisted = getWorkspaceCodexIntegration(auth.workspace.id);
    assert.equal(persisted?.status, "disconnected");
    assert.equal(persisted?.codexSessionId, null);
    assert.equal(persisted?.codexHomePath, null);

    await assert.rejects(() => requireWorkspaceCodexHome(auth.workspace.id), /shared_codex_unavailable/);
  });
});
