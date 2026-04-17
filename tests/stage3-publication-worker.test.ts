import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as completeWorkerStage3Job } from "../app/api/stage3/worker/jobs/[id]/complete/route";
import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import { getDb, newId, nowIso } from "../lib/db/client";
import { getRenderExportByStage3JobId, listChannelPublications, saveChannelPublishIntegration, upsertChannelPublishSettings } from "../lib/publication-store";
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
  });
});
