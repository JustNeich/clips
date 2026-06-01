import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as heartbeatWorkerStage3Job } from "../app/api/stage3/worker/jobs/[id]/heartbeat/route";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  claimNextQueuedStage3JobForWorker,
  completeStage3Job,
  enqueueStage3Job,
  failQueuedLocalStage3JobsForWorkerUpdateRequired,
  finishStage3Job,
  getStage3Job,
  sweepExpiredLocalStage3Jobs
} from "../lib/stage3-job-store";
import {
  exchangeStage3WorkerPairingToken,
  issueStage3WorkerPairingToken,
  listStage3Workers
} from "../lib/stage3-worker-store";

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-worker-status-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsStage3JobRuntimeState__?: unknown }).__clipsStage3JobRuntimeState__;
  delete (globalThis as { __clipsChannelPublicationRuntimeState__?: unknown }).__clipsChannelPublicationRuntimeState__;

  try {
    return await run(appDataDir);
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

test("outdated local worker marks queued render jobs failed instead of leaving them waiting", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);

    const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
    const exchanged = exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "worker",
      platform: "darwin-arm64",
      appVersion: "1.0.0+runtime.old"
    });

    const render = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=render" })
    });
    const preview = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "preview",
      executionTarget: "local",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=preview" })
    });

    const failed = failQueuedLocalStage3JobsForWorkerUpdateRequired({
      workspaceId,
      userId,
      supportedKinds: ["render"],
      workerId: exchanged.worker.id,
      workerAppVersion: "1.0.0+runtime.old",
      expectedRuntimeVersion: "1.0.0+runtime.new"
    });

    assert.equal(failed, 1);
    const refreshedRender = getStage3Job(render.id);
    assert.equal(refreshedRender?.status, "failed");
    assert.equal(refreshedRender?.errorCode, "worker_runtime_outdated");
    assert.equal(refreshedRender?.recoverable, true);
    assert.match(refreshedRender?.errorMessage ?? "", /Обновите\/перезапустите worker/i);
    assert.equal(refreshedRender?.assignedWorkerId, null);

    const refreshedPreview = getStage3Job(preview.id);
    assert.equal(refreshedPreview?.status, "queued");

    const events = getDb()
      .prepare("SELECT message FROM stage3_job_events WHERE job_id = ? ORDER BY created_at ASC")
      .all(render.id) as Array<{ message: string }>;
    assert.ok(events.some((event) => event.message === "Queued local job blocked by outdated worker runtime."));
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

test("server watchdog fails heartbeat-fresh local jobs after the kind timeout", async () => {
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
    const staleStartedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    const freshHeartbeatAt = new Date().toISOString();
    const futureLeaseAt = new Date(Date.now() + 30 * 60_000).toISOString();
    db.prepare(
      `UPDATE stage3_jobs
          SET started_at = ?,
              heartbeat_at = ?,
              lease_expires_at = ?,
              updated_at = ?
        WHERE id = ?`
    ).run(staleStartedAt, freshHeartbeatAt, futureLeaseAt, freshHeartbeatAt, job.id);

    const changed = sweepExpiredLocalStage3Jobs();
    assert.equal(changed, 1);

    const refreshedJob = getStage3Job(job.id);
    assert.equal(refreshedJob?.status, "failed");
    assert.equal(refreshedJob?.errorCode, "editing_proxy_timeout");
    assert.equal(refreshedJob?.assignedWorkerId, null);
    assert.equal(refreshedJob?.leaseUntil, null);
    assert.equal(refreshedJob?.lastHeartbeatAt, null);

    const workers = listStage3Workers({ workspaceId, userId });
    assert.equal(workers[0]?.status, "online");
    assert.equal(workers[0]?.currentJobId, null);

    const events = db
      .prepare("SELECT message FROM stage3_job_events WHERE job_id = ? ORDER BY created_at ASC")
      .all(job.id) as Array<{ message: string }>;
    assert.ok(events.some((event) => event.message === "Local worker job exceeded server watchdog; job failed."));
  });
});

test("server watchdog frees render queue behind an overdue editing proxy", async () => {
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

    const proxyJob = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "editing-proxy",
      executionTarget: "local",
      payloadJson: JSON.stringify({
        chatId: "chat-1",
        sourceUrl: "https://youtube.com/watch?v=abc123"
      })
    });
    assert.equal(
      claimNextQueuedStage3JobForWorker({
        workerId: exchanged.worker.id,
        workspaceId,
        userId,
        supportedKinds: ["editing-proxy", "render"]
      })?.id,
      proxyJob.id
    );

    const renderJob = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      payloadJson: JSON.stringify({
        chatId: "chat-1",
        sourceUrl: "https://youtube.com/watch?v=abc123",
        renderTitle: "Ready render"
      })
    });

    const db = getDb();
    const staleStartedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    const freshHeartbeatAt = new Date().toISOString();
    const futureLeaseAt = new Date(Date.now() + 30 * 60_000).toISOString();
    db.prepare(
      `UPDATE stage3_jobs
          SET started_at = ?,
              heartbeat_at = ?,
              lease_expires_at = ?,
              updated_at = ?
        WHERE id = ?`
    ).run(staleStartedAt, freshHeartbeatAt, futureLeaseAt, freshHeartbeatAt, proxyJob.id);

    const claimedRender = claimNextQueuedStage3JobForWorker({
      workerId: exchanged.worker.id,
      workspaceId,
      userId,
      supportedKinds: ["editing-proxy", "render"]
    });

    assert.equal(claimedRender?.id, renderJob.id);
    assert.equal(claimedRender?.status, "running");
    assert.equal(claimedRender?.kind, "render");
    assert.equal(getStage3Job(proxyJob.id)?.status, "failed");
    assert.equal(getStage3Job(proxyJob.id)?.errorCode, "editing_proxy_timeout");
  });
});

test("job heartbeat does not keep a worker online after server watchdog clears the lease", async () => {
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
      payloadJson: JSON.stringify({
        sourceUrl: "https://youtube.com/watch?v=abc123"
      })
    });
    assert.equal(
      claimNextQueuedStage3JobForWorker({
        workerId: exchanged.worker.id,
        workspaceId,
        userId,
        supportedKinds: ["editing-proxy"]
      })?.id,
      job.id
    );

    const db = getDb();
    const staleWorkerSeenAt = new Date(Date.now() - 60_000).toISOString();
    db.prepare("UPDATE stage3_workers SET last_seen_at = ?, updated_at = ? WHERE id = ?").run(
      staleWorkerSeenAt,
      staleWorkerSeenAt,
      exchanged.worker.id
    );
    finishStage3Job(job.id, {
      status: "failed",
      errorCode: "editing_proxy_timeout",
      errorMessage: "server watchdog failed job",
      recoverable: true
    });

    const response = await heartbeatWorkerStage3Job(
      new Request(`http://localhost/api/stage3/worker/jobs/${job.id}/heartbeat`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${exchanged.sessionToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ appVersion: "1.0.0+runtime.test" })
      }),
      { params: Promise.resolve({ id: job.id }) }
    );

    assert.equal(response.status, 409);
    const workerRow = db
      .prepare("SELECT last_seen_at FROM stage3_workers WHERE id = ?")
      .get(exchanged.worker.id) as { last_seen_at?: string } | undefined;
    assert.equal(workerRow?.last_seen_at, staleWorkerSeenAt);

    const workers = listStage3Workers({ workspaceId, userId });
    assert.equal(workers[0]?.status, "offline");
  });
});

test("render dedupe can requeue completed or failed jobs without keeping stale attempts", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);

    const first = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      dedupeKey: "render-content:w1:u1:stable",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" })
    });
    const artifactPath = path.join(appDataDir, "render.mp4");
    await writeFile(artifactPath, new Uint8Array([1, 2, 3]));

    completeStage3Job(first.id, {
      resultJson: null,
      artifact: {
        kind: "video",
        fileName: "render.mp4",
        mimeType: "video/mp4",
        filePath: artifactPath,
        sizeBytes: 123
      }
    });

    const reusedCompleted = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      dedupeKey: "render-content:w1:u1:stable",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" })
    });
    assert.equal(reusedCompleted.id, first.id);
    assert.equal(reusedCompleted.status, "completed");

    const requeuedCompleted = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      dedupeKey: "render-content:w1:u1:stable",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" }),
      reuseCompleted: false
    });
    assert.equal(requeuedCompleted.id, first.id);
    assert.equal(requeuedCompleted.status, "queued");
    assert.equal(requeuedCompleted.attempts, 0);

    const db = getDb();
    db.prepare("UPDATE stage3_jobs SET attempts = 3 WHERE id = ?").run(first.id);
    finishStage3Job(first.id, {
      status: "failed",
      errorCode: "render_failed",
      errorMessage: "failed",
      recoverable: true
    });

    const requeuedFailed = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      dedupeKey: "render-content:w1:u1:stable",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" }),
      reuseCompleted: false
    });
    assert.equal(requeuedFailed.status, "queued");
    assert.equal(requeuedFailed.attempts, 0);
  });
});

test("automatic failed job retry preserves attempts and stops after limit", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);

    const first = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "editing-proxy",
      executionTarget: "local",
      dedupeKey: "editing-proxy:w1:u1:stable",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" })
    });
    const db = getDb();
    db.prepare("UPDATE stage3_jobs SET attempts = 2 WHERE id = ?").run(first.id);
    finishStage3Job(first.id, {
      status: "failed",
      errorCode: "editing_proxy_timeout",
      errorMessage: "Stage 3 local executor timed out while running editing-proxy after 300s.",
      recoverable: true
    });

    const automaticRetry = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "editing-proxy",
      executionTarget: "local",
      dedupeKey: "editing-proxy:w1:u1:stable",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" })
    });
    assert.equal(automaticRetry.id, first.id);
    assert.equal(automaticRetry.status, "queued");
    assert.equal(automaticRetry.attempts, 2);

    db.prepare("UPDATE stage3_jobs SET attempts = 3 WHERE id = ?").run(first.id);
    finishStage3Job(first.id, {
      status: "failed",
      errorCode: "editing_proxy_timeout",
      errorMessage: "Stage 3 local executor timed out while running editing-proxy after 300s.",
      recoverable: true
    });

    const blockedRetry = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "editing-proxy",
      executionTarget: "local",
      dedupeKey: "editing-proxy:w1:u1:stable",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" })
    });
    assert.equal(blockedRetry.id, first.id);
    assert.equal(blockedRetry.status, "failed");
    assert.equal(blockedRetry.attempts, 3);
    assert.equal(blockedRetry.errorCode, "editing_proxy_timeout");

    const events = db
      .prepare("SELECT message FROM stage3_job_events WHERE job_id = ? ORDER BY created_at ASC")
      .all(first.id) as Array<{ message: string }>;
    assert.ok(events.some((event) => event.message === "Skipped automatic retry after max attempts."));
  });
});

test("artifact storage failures reset attempts so manual retries can recover after cleanup", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);

    const first = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "editing-proxy",
      executionTarget: "local",
      dedupeKey: "editing-proxy:w1:u1:storage",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" })
    });
    const db = getDb();
    db.prepare("UPDATE stage3_jobs SET attempts = 3 WHERE id = ?").run(first.id);
    finishStage3Job(first.id, {
      status: "failed",
      errorCode: "artifact_storage_full",
      errorMessage: "Stage 3 artifact storage is full",
      recoverable: true
    });

    const retried = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "editing-proxy",
      executionTarget: "local",
      dedupeKey: "editing-proxy:w1:u1:storage",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=abc123" })
    });

    assert.equal(retried.id, first.id);
    assert.equal(retried.status, "queued");
    assert.equal(retried.attempts, 0);
    assert.equal(retried.errorCode, null);
  });
});

test("local render sweep interrupts older queued renders for the same chat", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);

    const older = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      dedupeKey: "render-request:w1:u1:older",
      payloadJson: JSON.stringify({
        chatId: "chat-1",
        sourceUrl: "https://example.com/older",
        renderTitle: "Older"
      })
    });
    const newer = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      dedupeKey: "render-request:w1:u1:newer",
      payloadJson: JSON.stringify({
        chatId: "chat-1",
        sourceUrl: "https://example.com/newer",
        renderTitle: "Newer"
      })
    });

    const db = getDb();
    db.prepare("UPDATE stage3_jobs SET created_at = ?, updated_at = ? WHERE id = ?").run(
      "2026-05-01T07:00:00.000Z",
      "2026-05-01T07:00:00.000Z",
      older.id
    );
    db.prepare("UPDATE stage3_jobs SET created_at = ?, updated_at = ? WHERE id = ?").run(
      "2026-05-01T08:00:00.000Z",
      "2026-05-01T08:00:00.000Z",
      newer.id
    );

    const changed = sweepExpiredLocalStage3Jobs();
    assert.equal(changed, 1);

    const refreshedOlder = getStage3Job(older.id);
    const refreshedNewer = getStage3Job(newer.id);
    assert.equal(refreshedOlder?.status, "interrupted");
    assert.equal(refreshedOlder?.errorCode, "superseded_render_request");
    assert.equal(refreshedNewer?.status, "queued");

    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: "worker-1",
      workspaceId,
      userId,
      supportedKinds: ["render"]
    });
    assert.equal(claimed?.id, newer.id);
  });
});
