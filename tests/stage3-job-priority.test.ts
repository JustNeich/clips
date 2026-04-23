import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb, newId, nowIso } from "../lib/db/client";
import {
  claimNextQueuedStage3Job,
  claimNextQueuedStage3JobForWorker,
  completeStage3Job,
  enqueueStage3Job,
  getStage3Job
} from "../lib/stage3-job-store";
import {
  scheduleStage3JobProcessing,
  setStage3JobProcessorForTests
} from "../lib/stage3-job-runtime";
import { exchangeStage3WorkerPairingToken, issueStage3WorkerPairingToken } from "../lib/stage3-worker-store";

async function waitForCondition(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  throw new Error("Timed out waiting for Stage 3 jobs to settle.");
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-job-priority-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsStage3JobRuntimeState__?: unknown }).__clipsStage3JobRuntimeState__;
  delete (globalThis as { __clipsStage3JobProcessorOverride__?: unknown }).__clipsStage3JobProcessorOverride__;

  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    delete (globalThis as { __clipsStage3JobRuntimeState__?: unknown }).__clipsStage3JobRuntimeState__;
    delete (globalThis as { __clipsStage3JobProcessorOverride__?: unknown }).__clipsStage3JobProcessorOverride__;
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

test("host queue prefers render over newer preview jobs", async () => {
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

    assert.equal(firstClaim?.id, render.id);
    assert.equal(secondClaim?.id, preview.id);
  });
});

test("host runtime processes multiple jobs up to configured concurrency", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const previousLimit = process.env.STAGE3_HOST_MAX_CONCURRENT_JOBS;
    const previousHostExecution = process.env.STAGE3_ALLOW_HOST_EXECUTION;
    process.env.STAGE3_HOST_MAX_CONCURRENT_JOBS = "2";
    process.env.STAGE3_ALLOW_HOST_EXECUTION = "1";

    try {
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

      let active = 0;
      let maxActive = 0;
      setStage3JobProcessorForTests(async (job) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((resolve) => {
            setTimeout(resolve, 40);
          });
          completeStage3Job(job.id, {
            resultJson: JSON.stringify({ ok: true }),
            artifact: null
          });
        } finally {
          active = Math.max(0, active - 1);
        }
      });
      scheduleStage3JobProcessing();

      const jobs = [
        enqueueStage3Job({
          workspaceId,
          userId,
          kind: "source-download",
          executionTarget: "host",
          payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=job-1" })
        }),
        enqueueStage3Job({
          workspaceId,
          userId,
          kind: "source-download",
          executionTarget: "host",
          payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=job-2" })
        }),
        enqueueStage3Job({
          workspaceId,
          userId,
          kind: "source-download",
          executionTarget: "host",
          payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=job-3" })
        })
      ];

      scheduleStage3JobProcessing();
      await waitForCondition(() => jobs.every((job) => getStage3Job(job.id)?.status === "completed"));
      const completed = jobs.map((job) => getStage3Job(job.id));

      assert.equal(maxActive, 2);
      assert.ok(completed.every((job) => job?.status === "completed"));
    } finally {
      setStage3JobProcessorForTests(null);
      if (previousLimit === undefined) {
        delete process.env.STAGE3_HOST_MAX_CONCURRENT_JOBS;
      } else {
        process.env.STAGE3_HOST_MAX_CONCURRENT_JOBS = previousLimit;
      }
      if (previousHostExecution === undefined) {
        delete process.env.STAGE3_ALLOW_HOST_EXECUTION;
      } else {
        process.env.STAGE3_ALLOW_HOST_EXECUTION = previousHostExecution;
      }
    }
  });
});

test("host runtime clamps queued job concurrency to hosted CPU budget", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const previousRender = process.env.RENDER;
    const previousLimit = process.env.STAGE3_HOST_MAX_CONCURRENT_JOBS;
    const previousCpuLimit = process.env.HOSTED_CPU_CONCURRENCY_LIMIT;
    const previousHostExecution = process.env.STAGE3_ALLOW_HOST_EXECUTION;
    process.env.RENDER = "1";
    process.env.STAGE3_HOST_MAX_CONCURRENT_JOBS = "4";
    process.env.HOSTED_CPU_CONCURRENCY_LIMIT = "1";
    process.env.STAGE3_ALLOW_HOST_EXECUTION = "1";

    try {
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

      let active = 0;
      let maxActive = 0;
      setStage3JobProcessorForTests(async (job) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((resolve) => {
            setTimeout(resolve, 30);
          });
          completeStage3Job(job.id, {
            resultJson: JSON.stringify({ ok: true }),
            artifact: null
          });
        } finally {
          active = Math.max(0, active - 1);
        }
      });
      scheduleStage3JobProcessing();

      const jobs = [
        enqueueStage3Job({
          workspaceId,
          userId,
          kind: "source-download",
          executionTarget: "host",
          payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=job-1" })
        }),
        enqueueStage3Job({
          workspaceId,
          userId,
          kind: "source-download",
          executionTarget: "host",
          payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=job-2" })
        }),
        enqueueStage3Job({
          workspaceId,
          userId,
          kind: "source-download",
          executionTarget: "host",
          payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=job-3" })
        })
      ];

      scheduleStage3JobProcessing();
      await waitForCondition(() => jobs.every((job) => getStage3Job(job.id)?.status === "completed"));

      assert.equal(maxActive, 1);
    } finally {
      setStage3JobProcessorForTests(null);
      if (previousRender === undefined) {
        delete process.env.RENDER;
      } else {
        process.env.RENDER = previousRender;
      }
      if (previousLimit === undefined) {
        delete process.env.STAGE3_HOST_MAX_CONCURRENT_JOBS;
      } else {
        process.env.STAGE3_HOST_MAX_CONCURRENT_JOBS = previousLimit;
      }
      if (previousCpuLimit === undefined) {
        delete process.env.HOSTED_CPU_CONCURRENCY_LIMIT;
      } else {
        process.env.HOSTED_CPU_CONCURRENCY_LIMIT = previousCpuLimit;
      }
      if (previousHostExecution === undefined) {
        delete process.env.STAGE3_ALLOW_HOST_EXECUTION;
      } else {
        process.env.STAGE3_ALLOW_HOST_EXECUTION = previousHostExecution;
      }
    }
  });
});

test("local worker queue prefers render over newer preview jobs", async () => {
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

    assert.equal(firstClaim?.id, render.id);
    assert.equal(secondClaim?.id, preview.id);
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

test("getStage3Job resolves worker labels and latest artifact in one read path", async () => {
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

    const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
    const exchanged = exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "Render Worker",
      platform: "darwin-arm64"
    });

    const job = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/watch?v=job-read-path" })
    });

    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: exchanged.worker.id,
      workspaceId,
      userId
    });
    assert.equal(claimed?.id, job.id);
    assert.equal(getStage3Job(job.id)?.workerLabel, "Render Worker");

    const artifactDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-job-artifact-"));
    const artifactPath = path.join(artifactDir, "render.mp4");
    try {
      await writeFile(artifactPath, "rendered");
      completeStage3Job(job.id, {
        resultJson: JSON.stringify({ ok: true }),
        artifact: {
          fileName: "render.mp4",
          mimeType: "video/mp4",
          filePath: artifactPath,
          sizeBytes: Buffer.byteLength("rendered")
        }
      });

      const completed = getStage3Job(job.id);
      assert.equal(completed?.status, "completed");
      assert.equal(completed?.workerLabel, null);
      assert.equal(completed?.artifact?.fileName, "render.mp4");
      assert.equal(completed?.artifactFilePath, artifactPath);
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });
});
