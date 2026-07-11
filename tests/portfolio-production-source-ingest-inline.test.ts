import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel, createOrGetChatBySource } from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import {
  createOrGetProductionRun,
  createProductionItem,
  createProductionProfile,
  getProductionItem,
  listChannelSourceCandidates,
  listProductionOutbox,
  listProductionRunChannels,
  reserveChannelSourceCandidate,
  transitionChannelSourceCandidateQualification,
  upsertChannelSourceCandidate,
  type ProductionOutboxRecord
} from "../lib/portfolio-production-store";
import {
  createPortfolioLiveDispatcher,
  type ProductionAgentSelections
} from "../lib/portfolio-production-live-runtime";
import {
  claimQueuedSourceJob,
  createSourceJob,
  finalizeSourceJobSuccess,
  getSourceJob,
  listSourceJobsForChat
} from "../lib/source-job-store";
import { getCachedSourceMedia, storeUploadedSourceMedia } from "../lib/source-media-cache";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-portfolio-source-inline-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsSourceRuntimeState__?: unknown }).__clipsSourceRuntimeState__;
  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    delete (globalThis as { __clipsSourceRuntimeState__?: unknown }).__clipsSourceRuntimeState__;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("portfolio source ingest resumes one exact queued upload job inline without duplicate work", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Portfolio source inline",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Inline source channel",
      username: "inline_source_channel"
    });
    const profileHash = "1".repeat(64);
    const profile = createProductionProfile({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      version: 1,
      status: "draft",
      profileHash,
      expectedYoutubeChannelId: "UC1234567890123456789012",
      templateId: "inline-source-template",
      templateSnapshotSha256: "2".repeat(64),
      publishPolicyId: "inline-source-publish-policy",
      qualityPolicyId: "inline-source-quality-policy",
      modelRouteManifestId: "inline-source-model-routes",
      modelRouteManifestSha256: "3".repeat(64),
      targetPerLogicalDay: 1,
      readyBufferMin: 1,
      readyBufferCap: 6,
      candidateAttemptBudget: 3,
      config: { fixture: true }
    });
    const { run } = createOrGetProductionRun({
      workspaceId: owner.workspace.id,
      portfolioProfileHash: "4".repeat(64),
      logicalDate: "2026-07-11",
      mode: "shadow",
      targetPerChannel: 1,
      manifestHash: "5".repeat(64),
      manifest: { fixture: true },
      channels: [{
        channelId: channel.id,
        profileId: profile.id,
        profileVersion: profile.version,
        profileHash: profile.profileHash,
        expectedYoutubeChannelId: profile.expectedYoutubeChannelId,
        targetCount: 1
      }]
    });
    const runChannel = listProductionRunChannels(run.id)[0]!;
    const createdItem = createProductionItem({
      runId: run.id,
      runChannelId: runChannel.id,
      itemSlot: 1
    });

    const sourceUrl = "upload://project-kings-inline/exact-source.mp4";
    const sourceBytes = new TextEncoder().encode("exact-uploaded-source-bytes");
    const contentSha256 = sha256(sourceBytes);
    await storeUploadedSourceMedia({
      sourceUrl,
      fileName: "exact-source.mp4",
      title: "Exact source",
      sourceStream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(sourceBytes);
          controller.close();
        }
      })
    });
    const { candidate } = upsertChannelSourceCandidate({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      provider: "owner_upload",
      sourceUrl,
      canonicalUrl: sourceUrl,
      contentSha256,
      eventFingerprint: "inline-source-event",
      categoryKey: "inline-source",
      rightsStatus: "owner_approved_source_pool",
      evidence: { discoveredBy: "test" }
    });
    transitionChannelSourceCandidateQualification({
      candidateId: candidate.id,
      toStatus: "qualified",
      contentSha256,
      eventFingerprint: "inline-source-event",
      evidence: { qualifiedBy: "test", contentSha256 }
    });
    const { item } = reserveChannelSourceCandidate({
      candidateId: candidate.id,
      itemId: createdItem.id,
      expectedItemVersion: createdItem.version
    });

    const chat = await createOrGetChatBySource({
      rawUrl: sourceUrl,
      channelIdRaw: channel.id,
      title: "Exact source",
      eventText: "Pre-deploy queued source job."
    });
    const request = {
      sourceUrl,
      autoRunStage2: false,
      agentDecomposition: true,
      trigger: "fetch" as const,
      chat: { id: chat.id, channelId: channel.id },
      channel: { id: channel.id, name: channel.name, username: channel.username }
    };
    const queued = createSourceJob({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request
    });
    assert.equal(queued.status, "queued");
    (globalThis as {
      __clipsSourceRuntimeState__?: {
        initialized: boolean;
        activeJobs: Set<string>;
        activeJobPromises: Map<string, Promise<void>>;
        schedulerPromise: Promise<void> | null;
      };
    }).__clipsSourceRuntimeState__ = {
      initialized: true,
      activeJobs: new Set<string>(),
      activeJobPromises: new Map<string, Promise<void>>(),
      schedulerPromise: new Promise<void>(() => undefined)
    };

    const event: ProductionOutboxRecord = {
      id: "source-inline-event",
      workspaceId: owner.workspace.id,
      runId: run.id,
      channelId: channel.id,
      productionItemId: item.id,
      eventKind: "source_ingest.requested",
      dedupeKey: "source-inline-dedupe",
      payload: { candidateId: candidate.id },
      status: "processing",
      attempts: 2,
      maxAttempts: 3,
      availableAt: "2026-07-11T00:00:00.000Z",
      leaseOwner: "test",
      leaseToken: "test-token",
      leaseExpiresAt: "2026-07-11T00:05:00.000Z",
      lastError: null,
      deadLetterCode: null,
      projectedAt: null,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      deliveredAt: null
    };
    const dispatch = createPortfolioLiveDispatcher({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      routeManifestId: "inline-source-model-routes",
      routeManifestSha256: "3".repeat(64),
      selections: {} as ProductionAgentSelections
    });

    await dispatch(event);
    await dispatch(event);

    const jobs = listSourceJobsForChat(chat.id, owner.workspace.id, 20);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.jobId, queued.jobId);
    assert.equal(jobs[0]?.status, "completed");
    assert.equal(jobs[0]?.resultData?.sourceCacheState, "hit");
    assert.equal(jobs[0]?.resultData?.downloadProvider, "upload");
    assert.equal(listChannelSourceCandidates({
      workspaceId: owner.workspace.id,
      channelId: channel.id
    }).length, 1);

    const cached = await getCachedSourceMedia(sourceUrl);
    assert.ok(cached);
    assert.equal(cached?.downloadProvider, "upload");
    assert.equal(getProductionItem(item.id)?.state, "source_ingested");
    assert.equal(getProductionItem(item.id)?.sourceSha256, contentSha256);
    assert.equal(
      listProductionOutbox({ runId: run.id }).filter((entry) => entry.eventKind === "source_fit.requested").length,
      1
    );
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM source_jobs").get() as { count: number }).count,
      1
    );
  });
});

test("exact source-job claim cannot steal another queued job or reclaim running/completed work", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Exact source claim",
      email: "claim-owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Exact claim channel",
      username: "exact_claim_channel"
    });
    const chatA = await createOrGetChatBySource({
      rawUrl: "upload://exact-claim/source-a.mp4",
      channelIdRaw: channel.id,
      title: "Source A",
      eventText: "Queued A"
    });
    const chatB = await createOrGetChatBySource({
      rawUrl: "upload://exact-claim/source-b.mp4",
      channelIdRaw: channel.id,
      title: "Source B",
      eventText: "Queued B"
    });
    const create = (chat: typeof chatA) => createSourceJob({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: {
        sourceUrl: chat.url,
        autoRunStage2: false,
        agentDecomposition: true,
        trigger: "fetch",
        chat: { id: chat.id, channelId: channel.id },
        channel: { id: channel.id, name: channel.name, username: channel.username }
      }
    });
    const jobA = create(chatA);
    const jobB = create(chatB);

    assert.equal(claimQueuedSourceJob(jobA.jobId)?.status, "running");
    assert.equal(claimQueuedSourceJob(jobA.jobId), null);
    assert.equal(getSourceJob(jobB.jobId)?.status, "queued");

    finalizeSourceJobSuccess(jobA.jobId, {
      chatId: chatA.id,
      channelId: channel.id,
      sourceUrl: chatA.url,
      stage1Ready: true,
      title: "Source A",
      commentsAvailable: false,
      commentsError: null,
      commentsPayload: null,
      autoStage2RunId: null
    });
    assert.equal(getSourceJob(jobA.jobId)?.status, "completed");
    assert.equal(claimQueuedSourceJob(jobA.jobId), null);
    assert.equal(getSourceJob(jobB.jobId)?.status, "queued");
  });
});
