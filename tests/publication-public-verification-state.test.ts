import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  createChannelPublication,
  createRenderExport,
  getChannelPublicationById,
  getNextChannelPublicationVerificationWakeAt,
  listScheduledChannelPublicationsAwaitingVerification,
  markChannelPublicationPublicVerified,
  markChannelPublicationScheduled,
  saveChannelPublishIntegration,
  sweepPublishedChannelPublications
} from "../lib/publication-store";
import { reconcileScheduledChannelPublications } from "../lib/channel-publication-runtime";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-public-verified-state-"));
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

async function createScheduledPublication() {
  const owner = await bootstrapOwner({
    workspaceName: "Public Verification Workspace",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "Verified Channel",
    username: "verified_channel"
  });
  const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=verification-source", channel.id);
  const stage3JobId = newId();
  const stamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO stage3_jobs
        (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
        VALUES (?, ?, ?, 'render', 'completed', NULL, '{}', NULL, NULL, NULL, 1, 0, ?, ?, ?, ?)`
    )
    .run(stage3JobId, owner.workspace.id, owner.user.id, stamp, stamp, stamp, stamp);
  const renderExport = createRenderExport({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    chatId: chat.id,
    stage3JobId,
    artifactFileName: "verified.mp4",
    artifactFilePath: "/tmp/verified.mp4",
    artifactMimeType: "video/mp4",
    artifactSizeBytes: 1024,
    renderTitle: "Verified title",
    sourceUrl: chat.url,
    snapshotJson: "{}",
    createdByUserId: owner.user.id
  });
  const publication = createChannelPublication({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    chatId: chat.id,
    renderExportId: renderExport.id,
    scheduleMode: "slot",
    scheduledAt: "2026-07-10T06:00:00.000Z",
    uploadReadyAt: "2026-07-10T05:00:00.000Z",
    slotDate: "2026-07-10",
    slotIndex: 0,
    title: "Verified title",
    description: "Description",
    tags: [],
    notifySubscribers: false,
    needsReview: false,
    createdByUserId: owner.user.id
  });
  saveChannelPublishIntegration({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    userId: owner.user.id,
    status: "connected",
    credential: null,
    googleAccountEmail: "owner@example.com",
    selectedYoutubeChannelId: "UC1234567890123456789012",
    selectedYoutubeChannelTitle: "Verified Channel",
    selectedYoutubeChannelCustomUrl: "@verified",
    availableChannels: [{ id: "UC1234567890123456789012", title: "Verified Channel", customUrl: "@verified" }],
    scopes: ["youtube.upload"],
    lastError: null
  });
  return markChannelPublicationScheduled({
    publicationId: publication.id,
    youtubeVideoId: "AbCdEf12345",
    youtubeVideoUrl: "https://youtube.com/shorts/AbCdEf12345"
  });
}

test("scheduled publication is not marked published by clock time", async () => {
  await withIsolatedAppData(async () => {
    const publication = await createScheduledPublication();
    assert.equal(sweepPublishedChannelPublications("2026-07-10T23:00:00.000Z"), 0);
    assert.equal(getChannelPublicationById(publication.id)?.status, "scheduled");
    assert.equal(getChannelPublicationById(publication.id)?.publishedAt, null);
    assert.equal(getNextChannelPublicationVerificationWakeAt(), "2026-07-10T06:00:00.000Z");
    assert.deepEqual(
      listScheduledChannelPublicationsAwaitingVerification({ dueAt: "2026-07-10T05:59:59.000Z" }),
      []
    );
    assert.equal(
      listScheduledChannelPublicationsAwaitingVerification({ dueAt: "2026-07-10T06:00:00.000Z" })[0]?.id,
      publication.id
    );
  });
});

test("legacy scheduled publication is reconciled through RSS and exact playable Shorts page", async () => {
  await withIsolatedAppData(async () => {
    const publication = await createScheduledPublication();
    const channelId = "UC1234567890123456789012";
    const videoId = "AbCdEf12345";
    const rss = `<?xml version="1.0"?><feed><link rel="alternate" href="https://www.youtube.com/channel/${channelId}"/><entry><yt:videoId>${videoId}</yt:videoId><yt:channelId>${channelId}</yt:channelId></entry></feed>`;
    const shorts = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({
      playabilityStatus: { status: "OK" },
      videoDetails: { videoId, channelId, isPrivate: false },
      streamingData: { formats: [{ itag: 18 }] }
    })};</script></html>`;
    const result = await reconcileScheduledChannelPublications({
      now: new Date("2026-07-10T06:02:00.000Z"),
      fetch: async (url) => new Response(String(url).includes("feeds/videos.xml") ? rss : shorts, {
        status: 200,
        headers: { "content-type": String(url).includes("feeds/videos.xml") ? "application/atom+xml" : "text/html" }
      })
    });
    assert.deepEqual(result, { checked: 1, verified: 1, retryable: 0, terminal: 0 });
    assert.equal(getChannelPublicationById(publication.id)?.status, "published");
  });
});

test("only exact public evidence moves scheduled publication to published", async () => {
  await withIsolatedAppData(async () => {
    const publication = await createScheduledPublication();
    const verified = markChannelPublicationPublicVerified({
      publicationId: publication.id,
      expectedYoutubeVideoId: "AbCdEf12345",
      expectedYoutubeChannelId: "UC1234567890123456789012",
      verifiedAt: "2026-07-10T06:02:00.000Z",
      evidenceSha256: "a".repeat(64)
    });
    assert.equal(verified.status, "published");
    assert.equal(verified.publishedAt, "2026-07-10T06:02:00.000Z");
    assert.match(verified.events.at(-1)?.message ?? "", /Clips \+ RSS \+ exact Shorts page/);
  });
});

test("mismatched video evidence fails without changing publication state", async () => {
  await withIsolatedAppData(async () => {
    const publication = await createScheduledPublication();
    assert.throws(
      () =>
        markChannelPublicationPublicVerified({
          publicationId: publication.id,
          expectedYoutubeVideoId: "Different123",
          expectedYoutubeChannelId: "UC1234567890123456789012",
          verifiedAt: "2026-07-10T06:02:00.000Z",
          evidenceSha256: "b".repeat(64)
        }),
      /video ID/i
    );
    assert.equal(getChannelPublicationById(publication.id)?.status, "scheduled");
  });
});
