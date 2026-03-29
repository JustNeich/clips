import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb, newId, nowIso } from "../lib/db/client";
import {
  claimNextQueuedStage3Job,
  claimNextQueuedStage3JobForWorker,
  enqueueStage3Job
} from "../lib/stage3-job-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-job-priority-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

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

test("host queue prefers editing proxy over older preview jobs", async () => {
  await withIsolatedAppData(async () => {
    const db = getDb();
    const stamp = nowIso();
    const workspaceId = "w1";
    const userId = "u1";

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

    const preview = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "preview",
      executionTarget: "host",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=older-preview" })
    });
    const editingProxy = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "editing-proxy",
      executionTarget: "host",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=editor-proxy" })
    });

    const firstClaim = claimNextQueuedStage3Job();
    const secondClaim = claimNextQueuedStage3Job();

    assert.equal(firstClaim?.id, editingProxy.id);
    assert.equal(secondClaim?.id, preview.id);
  });
});

test("host queue prefers preview over older render jobs", async () => {
  await withIsolatedAppData(async () => {
    const db = getDb();
    const stamp = nowIso();
    const workspaceId = "w1";
    const userId = "u1";

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

    const render = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "host",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=older-render" })
    });
    const preview = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "preview",
      executionTarget: "host",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=newer-preview" })
    });

    const firstClaim = claimNextQueuedStage3Job();
    const secondClaim = claimNextQueuedStage3Job();

    assert.equal(firstClaim?.id, preview.id);
    assert.equal(secondClaim?.id, render.id);
  });
});

test("local worker queue prefers preview over older render jobs", async () => {
  await withIsolatedAppData(async () => {
    const db = getDb();
    const stamp = nowIso();
    const workspaceId = "w1";
    const userId = "u1";

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

    const render = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=older-render" })
    });
    const preview = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "preview",
      executionTarget: "local",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=newer-preview" })
    });

    const firstClaim = claimNextQueuedStage3JobForWorker({
      workerId: "worker-1",
      workspaceId,
      userId
    });
    const secondClaim = claimNextQueuedStage3JobForWorker({
      workerId: "worker-2",
      workspaceId,
      userId
    });

    assert.equal(firstClaim?.id, preview.id);
    assert.equal(secondClaim?.id, render.id);
  });
});

test("dedupe keys are isolated by execution target", async () => {
  await withIsolatedAppData(async () => {
    const db = getDb();
    const stamp = nowIso();
    const workspaceId = "w1";
    const userId = "u1";

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

    const host = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "preview",
      executionTarget: "host",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=same" }),
      dedupeKey: "preview:stable"
    });
    const local = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "preview",
      executionTarget: "local",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=same" }),
      dedupeKey: "preview:stable"
    });

    assert.notEqual(host.id, local.id);
    assert.equal(host.executionTarget, "host");
    assert.equal(local.executionTarget, "local");
  });
});
