import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as completeWorkerStage3Job } from "../app/api/stage3/worker/jobs/[id]/complete/route";
import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  createChannelPublication,
  createRenderExport,
  getRenderExportByStage3JobId,
  listChannelPublications,
  saveChannelPublishIntegration,
  upsertChannelPublishSettings
} from "../lib/publication-store";
import {
  createOrUpdateQueuedPublicationFromRenderExport,
  processQueuedChannelPublication
} from "../lib/channel-publication-service";
import { claimNextQueuedStage3JobForWorker, enqueueStage3Job, getStage3Job } from "../lib/stage3-job-store";
import {
  exchangeStage3WorkerPairingToken,
  issueStage3WorkerPairingToken
} from "../lib/stage3-worker-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-publication-test-"));
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

function connectChannelPublishing(
  channelId: string,
  options?: {
    status?: "connected" | "reauth_required" | "error" | "pending_selection";
    lastError?: string | null;
  }
): void {
  saveChannelPublishIntegration({
    workspaceId: "w1",
    channelId,
    userId: "u1",
    status: options?.status ?? "connected",
    credential: null,
    googleAccountEmail: "u@example.com",
    selectedYoutubeChannelId: "youtube-channel-1",
    selectedYoutubeChannelTitle: "Daily Dopamine",
    selectedYoutubeChannelCustomUrl: "@dailydopamine",
    availableChannels: [
      {
        id: "youtube-channel-1",
        title: "Daily Dopamine",
        customUrl: "@dailydopamine"
      }
    ],
    scopes: ["youtube.upload"],
    lastError: options?.lastError ?? null
  });
}

function insertCompletedRenderJob(input: {
  workspaceId: string;
  userId: string;
  chatId: string;
  channelId: string;
  sourceUrl: string;
  renderTitle: string;
}): string {
  const stage3JobId = newId();
  const stamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO stage3_jobs
        (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
        VALUES (?, ?, ?, 'render', 'completed', NULL, ?, NULL, NULL, NULL, 1, 0, ?, ?, ?, ?)`
    )
    .run(
      stage3JobId,
      input.workspaceId,
      input.userId,
      JSON.stringify({
        chatId: input.chatId,
        channelId: input.channelId,
        sourceUrl: input.sourceUrl,
        renderTitle: input.renderTitle
      }),
      stamp,
      stamp,
      stamp,
      stamp
    );
  return stage3JobId;
}

test("local worker render completion creates a render export and queued publication", async () => {
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

    const channel = await createChannel({
      workspaceId,
      creatorUserId: userId,
      name: "Daily Dopamine",
      username: "dailydopamine"
    });
    upsertChannelPublishSettings({
      workspaceId,
      channelId: channel.id,
      userId,
      patch: {
        notifySubscribersByDefault: false
      }
    });
    connectChannelPublishing(channel.id);
    const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=abc123", channel.id);

    const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
    const exchanged = exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "worker",
      platform: "darwin-arm64"
    });

    const job = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      payloadJson: JSON.stringify({
        chatId: chat.id,
        channelId: channel.id,
        sourceUrl: chat.url,
        renderTitle: "Rendered title",
        snapshot: {}
      })
    });
    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: exchanged.worker.id,
      workspaceId,
      userId,
      supportedKinds: ["render"]
    });
    assert.equal(claimed?.id, job.id);

    const response = await completeWorkerStage3Job(
      new Request(`http://localhost/api/stage3/worker/jobs/${job.id}/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${exchanged.sessionToken}`,
          "Content-Type": "video/mp4",
          "x-stage3-artifact-name": encodeURIComponent("out.mp4"),
          "x-stage3-artifact-mime-type": encodeURIComponent("video/mp4"),
          "x-stage3-result-json": Buffer.from(JSON.stringify({ ok: true }), "utf-8").toString("base64url")
        },
        body: new Uint8Array([1, 2, 3, 4])
      }),
      { params: Promise.resolve({ id: job.id }) }
    );
    const body = (await response.json()) as { job?: { status?: string } };

    assert.equal(response.status, 200);
    assert.equal(body.job?.status, "completed");

    const renderExport = getRenderExportByStage3JobId(job.id);
    assert.ok(renderExport, "expected local render completion to persist render export");
    assert.match(renderExport?.artifactFilePath ?? "", /render-exports/);

    const publications = listChannelPublications(channel.id);
    assert.equal(publications.length, 1);
    assert.equal(publications[0]?.renderExportId, renderExport?.id);
    assert.equal(publications[0]?.title, "Rendered title");
    assert.equal(publications[0]?.chatId, chat.id);
    assert.equal(publications[0]?.notifySubscribers, false);
  });
});

test("render completion fails closed when another channel publication has the same title", async () => {
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

    const channel = await createChannel({
      workspaceId,
      creatorUserId: userId,
      name: "Daily Dopamine",
      username: "dailydopamine"
    });
    connectChannelPublishing(channel.id);

    const firstChat = await createOrGetChatByUrl("https://youtube.com/watch?v=duplicate-title-1", channel.id);
    const firstJobId = insertCompletedRenderJob({
      workspaceId,
      userId,
      chatId: firstChat.id,
      channelId: channel.id,
      sourceUrl: firstChat.url,
      renderTitle: "Calf Learns The Hard Way"
    });
    const firstRenderExport = createRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: firstChat.id,
      stage3JobId: firstJobId,
      artifactFileName: "first.mp4",
      artifactFilePath: "/tmp/first.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Calf Learns The Hard Way",
      sourceUrl: firstChat.url,
      snapshotJson: "{}",
      createdByUserId: userId
    });

    const firstPublication = createOrUpdateQueuedPublicationFromRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: firstChat.id,
      chatTitle: firstChat.title,
      renderExport: firstRenderExport,
      stage2Result: null,
      createdByUserId: userId,
      publishAfterRender: true
    });
    assert.equal(firstPublication?.status, "queued");

    const secondChat = await createOrGetChatByUrl("https://youtube.com/watch?v=duplicate-title-2", channel.id);
    const secondJobId = insertCompletedRenderJob({
      workspaceId,
      userId,
      chatId: secondChat.id,
      channelId: channel.id,
      sourceUrl: secondChat.url,
      renderTitle: "  calf   learns the hard way  "
    });
    const secondRenderExport = createRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: secondChat.id,
      stage3JobId: secondJobId,
      artifactFileName: "second.mp4",
      artifactFilePath: "/tmp/second.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "  calf   learns the hard way  ",
      sourceUrl: secondChat.url,
      snapshotJson: "{}",
      createdByUserId: userId
    });

    const duplicatePublication = createOrUpdateQueuedPublicationFromRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: secondChat.id,
      chatTitle: secondChat.title,
      renderExport: secondRenderExport,
      stage2Result: null,
      createdByUserId: userId,
      publishAfterRender: true
    });

    assert.equal(duplicatePublication?.status, "failed");
    assert.match(duplicatePublication?.lastError ?? "", /таким же названием/i);
    assert.match(duplicatePublication?.lastError ?? "", new RegExp(firstPublication!.id));

    const duplicateAfterRerender = createOrUpdateQueuedPublicationFromRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: secondChat.id,
      chatTitle: secondChat.title,
      renderExport: secondRenderExport,
      stage2Result: null,
      createdByUserId: userId,
      publishAfterRender: true
    });
    assert.equal(duplicateAfterRerender?.id, duplicatePublication?.id);
    assert.equal(duplicateAfterRerender?.status, "failed");
    assert.match(duplicateAfterRerender?.lastError ?? "", /таким же названием/i);

    const thirdChat = await createOrGetChatByUrl("https://youtube.com/watch?v=duplicate-source-shell", channel.id);
    const thirdJobId = insertCompletedRenderJob({
      workspaceId,
      userId,
      chatId: thirdChat.id,
      channelId: channel.id,
      sourceUrl: firstChat.url,
      renderTitle: "Fresh title but old source"
    });
    const thirdRenderExport = createRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: thirdChat.id,
      stage3JobId: thirdJobId,
      artifactFileName: "third.mp4",
      artifactFilePath: "/tmp/third.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Fresh title but old source",
      sourceUrl: firstChat.url,
      snapshotJson: "{}",
      createdByUserId: userId
    });
    const sourceDuplicatePublication = createOrUpdateQueuedPublicationFromRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: thirdChat.id,
      chatTitle: thirdChat.title,
      renderExport: thirdRenderExport,
      stage2Result: null,
      createdByUserId: userId,
      publishAfterRender: true
    });

    assert.equal(sourceDuplicatePublication?.status, "failed");
    assert.match(sourceDuplicatePublication?.lastError ?? "", /того же исходника/i);
    assert.match(sourceDuplicatePublication?.lastError ?? "", new RegExp(firstPublication!.id));
    assert.equal(listChannelPublications(channel.id).length, 3);
  });
});

test("publication processing fails an already queued duplicate before opening YouTube upload", async () => {
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

    const channel = await createChannel({
      workspaceId,
      creatorUserId: userId,
      name: "Daily Dopamine",
      username: "dailydopamine"
    });

    const firstChat = await createOrGetChatByUrl("https://youtube.com/watch?v=preupload-1", channel.id);
    const firstJobId = insertCompletedRenderJob({
      workspaceId,
      userId,
      chatId: firstChat.id,
      channelId: channel.id,
      sourceUrl: firstChat.url,
      renderTitle: "Duplicate Before Upload"
    });
    const firstRenderExport = createRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: firstChat.id,
      stage3JobId: firstJobId,
      artifactFileName: "first.mp4",
      artifactFilePath: "/tmp/first.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Duplicate Before Upload",
      sourceUrl: firstChat.url,
      snapshotJson: "{}",
      createdByUserId: userId
    });
    const firstPublication = createChannelPublication({
      workspaceId,
      channelId: channel.id,
      chatId: firstChat.id,
      renderExportId: firstRenderExport.id,
      scheduleMode: "slot",
      scheduledAt: "2040-05-05T18:00:00.000Z",
      uploadReadyAt: "2000-01-01T00:00:00.000Z",
      slotDate: "2040-05-05",
      slotIndex: 0,
      title: "Duplicate Before Upload",
      description: "",
      tags: [],
      notifySubscribers: false,
      needsReview: false,
      createdByUserId: userId
    });

    const secondChat = await createOrGetChatByUrl("https://youtube.com/watch?v=preupload-2", channel.id);
    const secondJobId = insertCompletedRenderJob({
      workspaceId,
      userId,
      chatId: secondChat.id,
      channelId: channel.id,
      sourceUrl: secondChat.url,
      renderTitle: "Duplicate Before Upload"
    });
    const secondRenderExport = createRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: secondChat.id,
      stage3JobId: secondJobId,
      artifactFileName: "second.mp4",
      artifactFilePath: "/tmp/second.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Duplicate Before Upload",
      sourceUrl: secondChat.url,
      snapshotJson: "{}",
      createdByUserId: userId
    });
    const secondPublication = createChannelPublication({
      workspaceId,
      channelId: channel.id,
      chatId: secondChat.id,
      renderExportId: secondRenderExport.id,
      scheduleMode: "slot",
      scheduledAt: "2040-05-05T18:15:00.000Z",
      uploadReadyAt: "2000-01-01T00:00:00.000Z",
      slotDate: "2040-05-05",
      slotIndex: 1,
      title: "Duplicate Before Upload",
      description: "",
      tags: [],
      notifySubscribers: false,
      needsReview: false,
      createdByUserId: userId
    });

    const processed = await processQueuedChannelPublication(secondPublication);

    assert.equal(processed.status, "failed");
    assert.match(processed.lastError ?? "", /таким же названием/i);
    assert.match(processed.lastError ?? "", new RegExp(firstPublication.id));
  });
});

test("local worker render completion skips queued publication when publishAfterRender is false", async () => {
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

    const channel = await createChannel({
      workspaceId,
      creatorUserId: userId,
      name: "Daily Dopamine",
      username: "dailydopamine"
    });
    connectChannelPublishing(channel.id);
    const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=publish-off", channel.id);

    const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
    const exchanged = exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "worker",
      platform: "darwin-arm64"
    });

    const job = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      payloadJson: JSON.stringify({
        chatId: chat.id,
        channelId: channel.id,
        sourceUrl: chat.url,
        renderTitle: "Rendered title",
        publishAfterRender: false,
        snapshot: {}
      })
    });
    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: exchanged.worker.id,
      workspaceId,
      userId,
      supportedKinds: ["render"]
    });
    assert.equal(claimed?.id, job.id);

    const response = await completeWorkerStage3Job(
      new Request(`http://localhost/api/stage3/worker/jobs/${job.id}/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${exchanged.sessionToken}`,
          "Content-Type": "video/mp4",
          "x-stage3-artifact-name": encodeURIComponent("out.mp4"),
          "x-stage3-artifact-mime-type": encodeURIComponent("video/mp4"),
          "x-stage3-result-json": Buffer.from(JSON.stringify({ ok: true }), "utf-8").toString("base64url")
        },
        body: new Uint8Array([1, 2, 3, 4])
      }),
      { params: Promise.resolve({ id: job.id }) }
    );

    assert.equal(response.status, 200);
    assert.ok(getRenderExportByStage3JobId(job.id));
    assert.equal(listChannelPublications(channel.id).length, 0);
  });
});

test("local worker render completion materializes failed publication when YouTube requires reauth", async () => {
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

    const channel = await createChannel({
      workspaceId,
      creatorUserId: userId,
      name: "Daily Dopamine",
      username: "dailydopamine"
    });
    connectChannelPublishing(channel.id, {
      status: "reauth_required",
      lastError: "Token has been expired or revoked."
    });
    const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=reauth-required", channel.id);

    const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
    const exchanged = exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "worker",
      platform: "darwin-arm64"
    });

    const job = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "render",
      executionTarget: "local",
      payloadJson: JSON.stringify({
        chatId: chat.id,
        channelId: channel.id,
        sourceUrl: chat.url,
        renderTitle: "Rendered title",
        publishAfterRender: true,
        snapshot: {}
      })
    });
    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: exchanged.worker.id,
      workspaceId,
      userId,
      supportedKinds: ["render"]
    });
    assert.equal(claimed?.id, job.id);

    const response = await completeWorkerStage3Job(
      new Request(`http://localhost/api/stage3/worker/jobs/${job.id}/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${exchanged.sessionToken}`,
          "Content-Type": "video/mp4",
          "x-stage3-artifact-name": encodeURIComponent("out.mp4"),
          "x-stage3-artifact-mime-type": encodeURIComponent("video/mp4"),
          "x-stage3-result-json": Buffer.from(JSON.stringify({ ok: true }), "utf-8").toString("base64url")
        },
        body: new Uint8Array([1, 2, 3, 4])
      }),
      { params: Promise.resolve({ id: job.id }) }
    );
    const body = (await response.json()) as { job?: { status?: string } };

    assert.equal(response.status, 200);
    assert.equal(body.job?.status, "completed");

    const renderExport = getRenderExportByStage3JobId(job.id);
    assert.ok(renderExport, "expected render export to persist");

    const publications = listChannelPublications(channel.id);
    assert.equal(publications.length, 1);
    assert.equal(publications[0]?.renderExportId, renderExport?.id);
    assert.equal(publications[0]?.status, "failed");
    assert.equal(publications[0]?.lastError, "Token has been expired or revoked.");
    assert.equal(publications[0]?.chatId, chat.id);
  });
});

test("local worker editing-proxy completion accepts multipart artifacts", async () => {
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
      label: "worker",
      platform: "darwin-arm64"
    });

    const job = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "editing-proxy",
      executionTarget: "local",
      payloadJson: JSON.stringify({
        sourceUrl: "https://youtube.com/watch?v=editing-proxy"
      })
    });
    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: exchanged.worker.id,
      workspaceId,
      userId,
      supportedKinds: ["editing-proxy"]
    });
    assert.equal(claimed?.id, job.id);

    const form = new FormData();
    form.set("resultJson", JSON.stringify({ sourceKey: "proxy-source", sourceDurationSec: 42 }));
    form.set("artifact", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/mp4" }), "proxy.mp4");

    const response = await completeWorkerStage3Job(
      new Request(`http://localhost/api/stage3/worker/jobs/${job.id}/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${exchanged.sessionToken}`
        },
        body: form
      }),
      { params: Promise.resolve({ id: job.id }) }
    );
    const body = (await response.json()) as { job?: { status?: string; kind?: string } };

    assert.equal(response.status, 200);
    assert.equal(body.job?.status, "completed");
    assert.equal(body.job?.kind, "editing-proxy");

    const completed = getStage3Job(job.id);
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.kind, "editing-proxy");
    assert.equal(completed?.artifact?.fileName, "proxy.mp4");
    assert.ok(completed?.artifactFilePath?.endsWith(`${job.id}.mp4`));

    const duplicateResponse = await completeWorkerStage3Job(
      new Request(`http://localhost/api/stage3/worker/jobs/${job.id}/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${exchanged.sessionToken}`,
          "Content-Type": "video/mp4",
          "x-stage3-artifact-name": encodeURIComponent("proxy.mp4"),
          "x-stage3-artifact-mime-type": encodeURIComponent("video/mp4")
        },
        body: new Uint8Array([1, 2, 3, 4])
      }),
      { params: Promise.resolve({ id: job.id }) }
    );
    const duplicateBody = (await duplicateResponse.json()) as { job?: { status?: string; kind?: string } };

    assert.equal(duplicateResponse.status, 200);
    assert.equal(duplicateBody.job?.status, "completed");
    assert.equal(duplicateBody.job?.kind, "editing-proxy");
  });
});
