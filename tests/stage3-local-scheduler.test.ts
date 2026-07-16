import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { getDb, newId, nowIso } from "../lib/db/client";
import {
  claimNextQueuedStage3JobForWorker,
  enqueueStage3Job,
  enqueueStage3JobWithOutcome,
  getStage3Job
} from "../lib/stage3-job-store";
import {
  resolveStage3LocalClaimProfiles,
  resolveStage3LocalResourceProfile,
  resolveStage3LocalSchedulerLimits,
  resolveStage3WorkIdentity,
  type Stage3LocalActiveJob
} from "../lib/stage3-local-scheduler";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-local-scheduler-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function seedWorkspace(workspaceId = "w1", userId = "u1"): void {
  const db = getDb();
  const stamp = nowIso();
  db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    workspaceId,
    "Test workspace",
    `workspace-${workspaceId}`,
    stamp,
    stamp
  );
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, `${userId}@example.com`, "hash", "User", "active", stamp, stamp);
  db.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newId(), workspaceId, userId, "owner", stamp, stamp);
}

test("resource profiles and work identity are derived by Clips, not by an editor", () => {
  const shortPayload = JSON.stringify({ channelId: "dark", workItemId: "dark-1", revision: 2, clipDurationSec: 18 });
  const longPayload = JSON.stringify({ channelId: "dark", workItemId: "dark-2", revision: 1, clipDurationSec: 18.01 });
  const normalizedLongPayload = JSON.stringify({
    channelId: "dark",
    workItemId: "dark-3",
    revision: 1,
    snapshot: {
      clipDurationSec: 6,
      renderPlan: { targetDurationSec: 22.134 }
    }
  });
  assert.deepEqual(resolveStage3WorkIdentity(shortPayload), {
    channelId: "dark",
    workItemId: "dark-1",
    revision: 2
  });
  assert.equal(resolveStage3LocalResourceProfile("render", shortPayload), "render-short");
  assert.equal(resolveStage3LocalResourceProfile("render", longPayload), "render-long");
  assert.equal(resolveStage3LocalResourceProfile("render", normalizedLongPayload), "render-long");
  assert.equal(resolveStage3LocalResourceProfile("source-download", "{}"), "download");
  assert.equal(resolveStage3LocalResourceProfile("editing-proxy", "{}"), "media");
});

test("an existing Stage 3 database is migrated before scheduler indexes are created", async () => {
  await withIsolatedAppData(async () => {
    const legacy = new DatabaseSync(path.join(process.env.APP_DATA_DIR!, "app.db"));
    legacy.exec(`
      CREATE TABLE stage3_jobs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        execution_target TEXT NOT NULL DEFAULT 'local',
        assigned_worker_id TEXT,
        lease_expires_at TEXT,
        heartbeat_at TEXT,
        dedupe_key TEXT,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        recoverable INTEGER NOT NULL DEFAULT 1,
        attempts INTEGER NOT NULL DEFAULT 0,
        attempt_limit INTEGER NOT NULL DEFAULT 3,
        attempt_group TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
    `);
    legacy.prepare(
      `INSERT INTO stage3_jobs
        (id, workspace_id, user_id, kind, status, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, 'render', 'queued', ?, ?, ?)`
    ).run(
      "legacy-render",
      "w1",
      "u1",
      JSON.stringify({ channelId: "dark", workItemId: "dark-legacy", revision: 3, clipDurationSec: 40 }),
      nowIso(),
      nowIso()
    );
    legacy.close();

    const migrated = getDb().prepare(
      "SELECT channel_id, work_item_id, revision, resource_profile FROM stage3_jobs WHERE id = ?"
    ).get("legacy-render") as {
      channel_id: string;
      work_item_id: string;
      revision: number;
      resource_profile: string;
    };
    assert.deepEqual({ ...migrated }, {
      channel_id: "dark",
      work_item_id: "dark-legacy",
      revision: 3,
      resource_profile: "render-long"
    });
  });
});

test("balanced scheduler opens only the documented lane capacity", () => {
  const previousShort = process.env.STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS;
  delete process.env.STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS;
  try {
    const limits = resolveStage3LocalSchedulerLimits();
    assert.deepEqual(limits, { shortRender: 1, media: 1, download: 2 });
    assert.deepEqual(resolveStage3LocalClaimProfiles("render", [], limits), ["render-short", "render-long"]);
    assert.deepEqual(
      resolveStage3LocalClaimProfiles("render", [{ profile: "render-short" }], limits),
      []
    );
    assert.deepEqual(
      resolveStage3LocalClaimProfiles("media", [{ profile: "render-long" }], limits),
      []
    );
    assert.deepEqual(
      resolveStage3LocalClaimProfiles("download", [{ profile: "render-long" }], limits),
      ["download"]
    );
    assert.deepEqual(
      resolveStage3LocalClaimProfiles(
        "render",
        [{ profile: "download" }, { profile: "download" }] as Stage3LocalActiveJob[],
        limits
      ),
      ["render-short"]
    );
    assert.deepEqual(
      resolveStage3LocalClaimProfiles(
        "download",
        [{ profile: "render-long" }, { profile: "download" }] as Stage3LocalActiveJob[],
        limits
      ),
      []
    );
  } finally {
    if (previousShort === undefined) delete process.env.STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS;
    else process.env.STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS = previousShort;
  }
});

test("different videos in one persistent chat never supersede one another", async () => {
  await withIsolatedAppData(async () => {
    seedWorkspace();
    const first = enqueueStage3Job({
      workspaceId: "w1",
      userId: "u1",
      kind: "render",
      executionTarget: "local",
      payloadJson: JSON.stringify({ chatId: "permanent-dark", channelId: "dark", workItemId: "dark-1", revision: 1 })
    });
    const second = enqueueStage3Job({
      workspaceId: "w1",
      userId: "u1",
      kind: "render",
      executionTarget: "local",
      payloadJson: JSON.stringify({ chatId: "permanent-dark", channelId: "dark", workItemId: "dark-2", revision: 1 })
    });
    const claimedFirst = claimNextQueuedStage3JobForWorker({
      workerId: "worker-1",
      workspaceId: "w1",
      userId: "u1",
      supportedKinds: ["render"],
      resourceProfiles: ["render-short"]
    });
    const claimedSecond = claimNextQueuedStage3JobForWorker({
      workerId: "worker-1",
      workspaceId: "w1",
      userId: "u1",
      supportedKinds: ["render"],
      resourceProfiles: ["render-short"]
    });
    assert.deepEqual(new Set([claimedFirst?.id, claimedSecond?.id]), new Set([first.id, second.id]));
    assert.equal(getStage3Job(first.id)?.status, "running");
    assert.equal(getStage3Job(second.id)?.status, "running");
  });
});

test("one channel cannot occupy the local queue while another channel waits", async () => {
  await withIsolatedAppData(async () => {
    seedWorkspace();
    const jobs = [
      ...Array.from({ length: 10 }, (_, index) => ({ channelId: "dark", workItemId: `dark-${index}` })),
      ...Array.from({ length: 10 }, (_, index) => ({ channelId: "cop", workItemId: `cop-${index}` })),
      ...Array.from({ length: 10 }, (_, index) => ({ channelId: "third", workItemId: `third-${index}` }))
    ].map((identity) => enqueueStage3Job({
      workspaceId: "w1",
      userId: "u1",
      kind: "render",
      executionTarget: "local",
      dedupeKey: `render:${identity.workItemId}`,
      payloadJson: JSON.stringify({ ...identity, revision: 1, clipDurationSec: 6 })
    }));

    const duplicate = enqueueStage3JobWithOutcome({
      workspaceId: "w1",
      userId: "u1",
      kind: "render",
      executionTarget: "local",
      dedupeKey: "render:dark-0",
      payloadJson: JSON.stringify({ channelId: "dark", workItemId: "dark-0", revision: 1, clipDurationSec: 6 })
    });
    assert.equal(duplicate.outcome, "reused_in_flight");
    assert.equal(duplicate.job.id, jobs[0].id);

    const claimed = Array.from({ length: 30 }, (_, index) => claimNextQueuedStage3JobForWorker({
      workerId: `worker-${index}`,
      workspaceId: "w1",
      userId: "u1",
      supportedKinds: ["render"],
      resourceProfiles: ["render-short"]
    }));
    assert.equal(claimed.filter(Boolean).length, 30);
    assert.equal(new Set(claimed.map((job) => job?.id)).size, 30);
    assert.deepEqual(claimed.slice(0, 3).map((job) => job?.channelId), ["dark", "cop", "third"]);
  });
});
