import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb, newId, nowIso } from "../lib/db/client";
import {
  authenticateStage3WorkerSessionToken,
  exchangeStage3WorkerPairingToken,
  issueStage3WorkerPairingToken,
  listStage3Workers,
  resolveStage3WorkerPairingTtlMs
} from "../lib/stage3-worker-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-worker-pairing-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsStage3JobRuntimeState__?: unknown }).__clipsStage3JobRuntimeState__;
  delete (globalThis as { __clipsChannelPublicationRuntimeState__?: unknown }).__clipsChannelPublicationRuntimeState__;

  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    delete (globalThis as { __clipsStage3JobRuntimeState__?: unknown }).__clipsStage3JobRuntimeState__;
    delete (globalThis as { __clipsChannelPublicationRuntimeState__?: unknown }).__clipsChannelPublicationRuntimeState__;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function seedWorkspace(workspaceId: string, userId: string): void {
  const db = getDb();
  const stamp = nowIso();
  db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    workspaceId,
    "Test workspace",
    "test-workspace",
    stamp,
    stamp
  );
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, "u@example.com", "hash", "User", "active", stamp, stamp);
  db.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newId(), workspaceId, userId, "owner", stamp, stamp);
}

test("pairing token can be retried on the same machine without creating duplicate workers", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);

    const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
    const first = exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "worker",
      platform: "win32-x64",
      hostname: "KATYA-PC",
      appVersion: "1.0.0+20260413170000"
    });

    const second = exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "worker",
      platform: "win32-x64",
      hostname: "katya-pc",
      appVersion: "1.0.0+20260413170100"
    });

    assert.equal(second.worker.id, first.worker.id);
    assert.notEqual(second.sessionToken, first.sessionToken);
    assert.equal(authenticateStage3WorkerSessionToken(first.sessionToken), null);
    assert.equal(authenticateStage3WorkerSessionToken(second.sessionToken)?.worker.id, first.worker.id);

    const workers = listStage3Workers({ workspaceId, userId });
    assert.equal(workers.length, 1);
    assert.equal(workers[0]?.id, first.worker.id);
  });
});

test("pairing token retry is rejected when the same command is reused on another machine", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);

    const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
    exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "worker",
      platform: "win32-x64",
      hostname: "KATYA-PC"
    });

    assert.throws(
      () =>
        exchangeStage3WorkerPairingToken({
          pairingToken: pairing.token,
          label: "worker",
          platform: "win32-x64",
          hostname: "OTHER-PC"
        }),
      /already used on another machine/i
    );
  });
});

test("pairing ttl keeps long bootstrap commands valid even when env is configured too low", () => {
  assert.equal(resolveStage3WorkerPairingTtlMs("600"), 60 * 60_000);
  assert.equal(resolveStage3WorkerPairingTtlMs("7200"), 7_200_000);
  assert.equal(resolveStage3WorkerPairingTtlMs(undefined), 60 * 60_000);
});
