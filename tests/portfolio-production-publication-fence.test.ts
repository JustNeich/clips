import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  claimNextReadyChannelPublication,
  createChannelPublication,
  createRenderExport,
  getPortfolioPublicationSideEffectFence,
  saveChannelPublishIntegration
} from "../lib/publication-store";
import {
  createOrGetProductionRun,
  createProductionItem,
  createProductionProfile,
  listProductionRunChannels
} from "../lib/portfolio-production-store";
import { bootstrapOwner } from "../lib/team-store";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-portfolio-publication-fence-"));
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

test("portfolio publication cannot be claimed before durable intent binding and cancel fences remain fail-closed", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Portfolio publication fence",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Fence channel",
      username: "fence-channel"
    });
    saveChannelPublishIntegration({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      status: "connected",
      credential: null,
      googleAccountEmail: "owner@example.com",
      selectedYoutubeChannelId: "UC1234567890123456789012",
      selectedYoutubeChannelTitle: "Fence channel",
      selectedYoutubeChannelCustomUrl: "@fence-channel",
      availableChannels: [{
        id: "UC1234567890123456789012",
        title: "Fence channel",
        customUrl: "@fence-channel"
      }],
      scopes: ["youtube.upload"],
      lastError: null
    });
    const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=portfolio-fence", channel.id);
    const stage3JobId = newId();
    const stamp = nowIso();
    getDb().prepare(`INSERT INTO stage3_jobs
      (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json,
       error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
      VALUES (?, ?, ?, 'render', 'completed', NULL, '{}', NULL, NULL, NULL, 1, 0, ?, ?, ?, ?)`)
      .run(stage3JobId, owner.workspace.id, owner.user.id, stamp, stamp, stamp, stamp);
    const renderExport = createRenderExport({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      chatId: chat.id,
      stage3JobId,
      artifactFileName: "fence.mp4",
      artifactFilePath: "/tmp/fence.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Fence video",
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: owner.user.id
    });
    const profile = createProductionProfile({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      version: 1,
      status: "active",
      profileHash: sha("fence-profile"),
      expectedYoutubeChannelId: "UC1234567890123456789012",
      expectedDestinationTitle: "Fence channel",
      templateId: "fence-template",
      templateSnapshotSha256: sha("fence-template"),
      publishPolicyId: "project-kings-daily-3x3-v1",
      qualityPolicyId: "project-kings-quality-v1",
      modelRouteManifestId: "project-kings-model-routes-v1",
      modelRouteManifestSha256: "1".repeat(64),
      targetPerLogicalDay: 1,
      readyBufferMin: 1,
      readyBufferCap: 3,
      candidateAttemptBudget: 3,
      config: {},
      approvedAt: stamp,
      approvedByUserId: owner.user.id
    });
    const created = createOrGetProductionRun({
      workspaceId: owner.workspace.id,
      portfolioProfileHash: sha("fence-portfolio"),
      logicalDate: "2040-01-01",
      mode: "live",
      targetPerChannel: 1,
      manifestHash: sha("fence-manifest"),
      manifest: { schemaVersion: 1 },
      channels: [{
        channelId: channel.id,
        profileId: profile.id,
        profileVersion: profile.version,
        profileHash: profile.profileHash,
        expectedYoutubeChannelId: profile.expectedYoutubeChannelId,
        targetCount: 1
      }]
    });
    const runChannel = listProductionRunChannels(created.run.id)[0]!;
    const item = createProductionItem({ runId: created.run.id, runChannelId: runChannel.id, itemSlot: 1 });
    const scheduledAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const publication = createChannelPublication({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      chatId: chat.id,
      renderExportId: renderExport.id,
      scheduleMode: "custom",
      scheduledAt,
      uploadReadyAt: new Date(Date.now() - 60_000).toISOString(),
      slotDate: scheduledAt.slice(0, 10),
      slotIndex: 0,
      title: "Fence video",
      description: "",
      tags: [],
      notifySubscribers: false,
      needsReview: false,
      createdByUserId: owner.user.id
    });
    getDb().prepare("UPDATE production_runs SET status = 'running' WHERE id = ?").run(created.run.id);
    getDb().prepare(`UPDATE production_items
      SET state = 'final_approved', stage3_job_id = ?, updated_at = ? WHERE id = ?`)
      .run(stage3JobId, stamp, item.id);

    assert.deepEqual(getPortfolioPublicationSideEffectFence(publication.id), {
      linked: true,
      allowed: false,
      productionItemId: item.id,
      itemState: "final_approved",
      runStatus: "running",
      boundPublicationId: null,
      reason: "publication_intent_not_bound"
    });
    assert.equal(claimNextReadyChannelPublication({}), null);

    getDb().prepare(`UPDATE production_items
      SET state = 'upload_outcome_unknown', publication_id = ?, updated_at = ? WHERE id = ?`)
      .run(publication.id, stamp, item.id);
    assert.equal(getPortfolioPublicationSideEffectFence(publication.id).allowed, true);
    const claimed = claimNextReadyChannelPublication({});
    assert.equal(claimed?.publication.id, publication.id);

    getDb().prepare(`UPDATE channel_publications
      SET status = 'queued', lease_token = NULL, lease_expires_at = NULL WHERE id = ?`).run(publication.id);
    getDb().prepare("UPDATE production_items SET state = 'cancel_requested' WHERE id = ?").run(item.id);
    const canceledFence = getPortfolioPublicationSideEffectFence(publication.id);
    assert.equal(canceledFence.allowed, false);
    assert.equal(canceledFence.reason, "item_state_cancel_requested_blocks_upload");
    assert.equal(claimNextReadyChannelPublication({}), null);

    getDb().prepare(`UPDATE production_items SET state = 'upload_outcome_unknown' WHERE id = ?`).run(item.id);
    getDb().prepare(`UPDATE production_runs SET status = 'cancel_requested' WHERE id = ?`).run(created.run.id);
    getDb().prepare(`UPDATE channel_publications SET upload_session_url = ? WHERE id = ?`)
      .run("https://upload.youtube.test/resumable-session", publication.id);
    const resumableFence = getPortfolioPublicationSideEffectFence(publication.id);
    assert.equal(resumableFence.allowed, true);
    assert.equal(resumableFence.runStatus, "cancel_requested");
    assert.equal(claimNextReadyChannelPublication({})?.publication.id, publication.id);
  });
});
