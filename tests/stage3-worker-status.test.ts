import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb, newId, nowIso } from "../lib/db/client";
import { claimNextQueuedStage3JobForWorker, enqueueStage3Job, getStage3Job } from "../lib/stage3-job-store";
import {
  exchangeStage3WorkerPairingToken,
  issueStage3WorkerPairingToken,
  listStage3Workers
} from "../lib/stage3-worker-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-worker-status-"));
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

test("listStage3Workers reports busy worker with current job kind for active local jobs", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);

    const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
    const exchanged = exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "worker",
      platform: "darwin-arm64"
    });

    const job = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "editing-proxy",
      executionTarget: "local",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" })
    });
    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: exchanged.worker.id,
      workspaceId,
      userId,
      supportedKinds: ["editing-proxy"]
    });

    assert.equal(claimed?.id, job.id);

    const workers = listStage3Workers({ workspaceId, userId });
    assert.equal(workers.length, 1);
    assert.equal(workers[0]?.status, "busy");
    assert.equal(workers[0]?.currentJobId, job.id);
    assert.equal(workers[0]?.currentJobKind, "editing-proxy");
  });
});

test("listStage3Workers sweeps expired local leases before deriving busy state", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);

    const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
    const exchanged = exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "worker",
      platform: "darwin-arm64"
    });

    const job = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "editing-proxy",
      executionTarget: "local",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" })
    });
    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: exchanged.worker.id,
      workspaceId,
      userId,
      supportedKinds: ["editing-proxy"]
    });

    assert.equal(claimed?.id, job.id);

    const db = getDb();
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    db.prepare(
      `UPDATE stage3_jobs
          SET lease_expires_at = ?,
              heartbeat_at = ?,
              updated_at = ?
        WHERE id = ?`
    ).run(expiredAt, expiredAt, expiredAt, job.id);

    const workers = listStage3Workers({ workspaceId, userId });
    assert.equal(workers.length, 1);
    assert.equal(workers[0]?.status, "online");
    assert.equal(workers[0]?.currentJobId, null);
    assert.equal(workers[0]?.currentJobKind, null);

    const refreshedJob = getStage3Job(job.id);
    assert.equal(refreshedJob?.status, "queued");
    assert.equal(refreshedJob?.assignedWorkerId, null);
  });
});
