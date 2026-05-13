import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  enqueueAndScheduleStage3Job,
  setStage3JobProcessorForTests,
  waitForStage3Job
} from "../lib/stage3-job-runtime";
import { completeStage3Job } from "../lib/stage3-job-store";
import { bootstrapOwner } from "../lib/team-store";

test("fresh host Stage 3 jobs are not interrupted by runtime bootstrap cleanup", { concurrency: false }, async () => {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-job-runtime-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousAllowHost = process.env.STAGE3_ALLOW_HOST_EXECUTION;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.STAGE3_ALLOW_HOST_EXECUTION = "1";
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsStage3JobRuntimeState__?: unknown }).__clipsStage3JobRuntimeState__;

  setStage3JobProcessorForTests((job) => {
    completeStage3Job(job.id, { resultJson: JSON.stringify({ ok: true }) });
    return Promise.resolve();
  });

  try {
    const owner = await bootstrapOwner({
      workspaceName: "Stage 3 Host Runtime",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const job = enqueueAndScheduleStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "agent-media-step",
      executionTarget: "host",
      payloadJson: JSON.stringify({ requestId: "fresh-host-job" }),
      reuseCompleted: false
    });
    assert.equal(job.status, "queued");

    const completed = await waitForStage3Job(job.id, { timeoutMs: 2_000 });
    assert.equal(completed.status, "completed");
    assert.equal(completed.errorCode, null);
    assert.equal(completed.errorMessage, null);
  } finally {
    setStage3JobProcessorForTests(null);
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    delete (globalThis as { __clipsStage3JobRuntimeState__?: unknown }).__clipsStage3JobRuntimeState__;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousAllowHost === undefined) {
      delete process.env.STAGE3_ALLOW_HOST_EXECUTION;
    } else {
      process.env.STAGE3_ALLOW_HOST_EXECUTION = previousAllowHost;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
});
