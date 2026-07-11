import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as uploadSourceRoute } from "../app/api/pipeline/source-upload/route";
import { createChannel } from "../lib/chat-history";
import { createMcpMachineCredential } from "../lib/mcp-machine-credential-store";
import { setSourceJobProcessorForTests } from "../lib/source-job-runtime";
import { getSourceJob, type SourceJobRecord } from "../lib/source-job-store";
import { bootstrapOwner } from "../lib/team-store";

type SourceRuntimeGlobal = typeof globalThis & {
  __clipsAppDb?: unknown;
  __clipsSourceRuntimeState__?: unknown;
  __clipsSourceJobProcessorOverride__?: unknown;
};

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-upload-idempotency-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousManagedTemplatesRoot = process.env.MANAGED_TEMPLATES_ROOT;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.MANAGED_TEMPLATES_ROOT = path.join(appDataDir, "managed-templates");
  const scope = globalThis as SourceRuntimeGlobal;
  delete scope.__clipsAppDb;
  delete scope.__clipsSourceRuntimeState__;
  delete scope.__clipsSourceJobProcessorOverride__;

  try {
    return await run();
  } finally {
    setSourceJobProcessorForTests(null);
    delete scope.__clipsAppDb;
    delete scope.__clipsSourceRuntimeState__;
    delete scope.__clipsSourceJobProcessorOverride__;
    if (previousManagedTemplatesRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_ROOT = previousManagedTemplatesRoot;
    }
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function mp4Bytes(marker = 0): Buffer {
  const bytes = Buffer.alloc(32, marker);
  bytes.write("ftyp", 4, "ascii");
  return bytes;
}

function uploadRequest(input: {
  token: string;
  channelId: string;
  fileName?: string;
  idempotencyKey?: string;
  marker?: number;
}): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${input.token}`,
    "content-type": "video/mp4",
    "x-channel-id": input.channelId,
    "x-file-name": input.fileName ?? "project-kings.mp4"
  };
  if (input.idempotencyKey !== undefined) {
    headers["x-idempotency-key"] = input.idempotencyKey;
  }
  return new Request("http://localhost/api/pipeline/source-upload", {
    method: "POST",
    headers,
    body: mp4Bytes(input.marker)
  });
}

async function waitForTerminalJob(jobId: string): Promise<SourceJobRecord> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const job = getSourceJob(jobId);
    if (job && (job.status === "completed" || job.status === "failed")) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Source job ${jobId} did not finish in time.`);
}

async function seedUploadContext() {
  const owner = await bootstrapOwner({
    workspaceName: "Upload idempotency",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "Project Kings",
    username: "project-kings"
  });
  const machine = createMcpMachineCredential({
    workspaceId: owner.workspace.id,
    ownerUserId: owner.user.id,
    machineId: "project-kings-uploader",
    scopes: ["pipeline:run"]
  });
  return { owner, channel, machine };
}

test("X-Idempotency-Key replays the same completed source job", async () => {
  await withIsolatedAppData(async () => {
    const { channel, machine } = await seedUploadContext();
    setSourceJobProcessorForTests(async (job) => ({
      chatId: job.chatId,
      channelId: job.channelId,
      sourceUrl: job.sourceUrl,
      stage1Ready: true,
      title: "ready",
      commentsAvailable: false,
      commentsError: null,
      commentsPayload: null,
      autoStage2RunId: null
    }));

    const first = await uploadSourceRoute(
      uploadRequest({ token: machine.secret, channelId: channel.id, idempotencyKey: "run-1:dark:slot-1" })
    );
    assert.equal(first.status, 202);
    const firstPayload = (await first.json()) as { job: { jobId: string; sourceUrl: string } };
    assert.equal((await waitForTerminalJob(firstPayload.job.jobId)).status, "completed");

    const replay = await uploadSourceRoute(
      uploadRequest({
        token: machine.secret,
        channelId: channel.id,
        fileName: "changed-name.mp4",
        idempotencyKey: "run-1:dark:slot-1",
        marker: 1
      })
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("x-idempotent-replay"), "true");
    const replayPayload = (await replay.json()) as {
      idempotentReplay: boolean;
      job: { jobId: string; sourceUrl: string; status: string };
    };
    assert.equal(replayPayload.idempotentReplay, true);
    assert.equal(replayPayload.job.jobId, firstPayload.job.jobId);
    assert.equal(replayPayload.job.sourceUrl, firstPayload.job.sourceUrl);
    assert.equal(replayPayload.job.status, "completed");
  });
});

test("X-Idempotency-Key replays the same failed source job", async () => {
  await withIsolatedAppData(async () => {
    const { channel, machine } = await seedUploadContext();
    setSourceJobProcessorForTests(async () => {
      throw new Error("expected source failure");
    });

    const first = await uploadSourceRoute(
      uploadRequest({ token: machine.secret, channelId: channel.id, idempotencyKey: "run-2:light:slot-2" })
    );
    const firstPayload = (await first.json()) as { job: { jobId: string } };
    assert.equal((await waitForTerminalJob(firstPayload.job.jobId)).status, "failed");

    const replay = await uploadSourceRoute(
      uploadRequest({ token: machine.secret, channelId: channel.id, idempotencyKey: "run-2:light:slot-2" })
    );
    assert.equal(replay.status, 200);
    const replayPayload = (await replay.json()) as { job: { jobId: string; status: string } };
    assert.equal(replayPayload.job.jobId, firstPayload.job.jobId);
    assert.equal(replayPayload.job.status, "failed");
  });
});

test("concurrent retries share one job while requests without the header stay unique", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel, machine } = await seedUploadContext();
    setSourceJobProcessorForTests(async (job) => ({
      chatId: job.chatId,
      channelId: job.channelId,
      sourceUrl: job.sourceUrl,
      stage1Ready: true,
      title: "ready",
      commentsAvailable: false,
      commentsError: null,
      commentsPayload: null,
      autoStage2RunId: null
    }));

    const [left, right] = await Promise.all([
      uploadSourceRoute(
        uploadRequest({ token: machine.secret, channelId: channel.id, idempotencyKey: "run-3:cop:slot-1" })
      ),
      uploadSourceRoute(
        uploadRequest({ token: machine.secret, channelId: channel.id, idempotencyKey: "run-3:cop:slot-1" })
      )
    ]);
    const leftPayload = (await left.json()) as { job: { jobId: string } };
    const rightPayload = (await right.json()) as { job: { jobId: string } };
    assert.equal(rightPayload.job.jobId, leftPayload.job.jobId);

    const legacyOne = await uploadSourceRoute(uploadRequest({ token: machine.secret, channelId: channel.id }));
    const legacyTwo = await uploadSourceRoute(uploadRequest({ token: machine.secret, channelId: channel.id }));
    const legacyOnePayload = (await legacyOne.json()) as { job: { jobId: string; sourceUrl: string } };
    const legacyTwoPayload = (await legacyTwo.json()) as { job: { jobId: string; sourceUrl: string } };
    assert.notEqual(legacyTwoPayload.job.jobId, legacyOnePayload.job.jobId);
    assert.notEqual(legacyTwoPayload.job.sourceUrl, legacyOnePayload.job.sourceUrl);

    const secondChannel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Project Kings Two",
      username: "project-kings-two"
    });
    const scopedOne = await uploadSourceRoute(
      uploadRequest({ token: machine.secret, channelId: channel.id, idempotencyKey: "shared-scope-key" })
    );
    const scopedTwo = await uploadSourceRoute(
      uploadRequest({ token: machine.secret, channelId: secondChannel.id, idempotencyKey: "shared-scope-key" })
    );
    const scopedOnePayload = (await scopedOne.json()) as { job: { sourceUrl: string } };
    const scopedTwoPayload = (await scopedTwo.json()) as { job: { sourceUrl: string } };
    assert.notEqual(scopedTwoPayload.job.sourceUrl, scopedOnePayload.job.sourceUrl);
  });
});
