import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  claimPortfolioChannelOwnerships,
  claimPortfolioDaemonDispatchLease,
  claimPortfolioDaemonLease,
  getPortfolioChannelOwnership,
  releasePortfolioDaemonLease
} from "../lib/portfolio-production-daemon-store";
import {
  ackProductionOutbox,
  appendProductionOutbox,
  claimProductionOutbox,
  createOrGetProductionRun,
  createProductionItem,
  createProductionProfile,
  listProductionOutbox,
  listProductionRunChannels,
  ProductionStoreError,
  renewProductionOutboxLease,
  type ProductionItemRecord,
  type ProductionProfileRecord
} from "../lib/portfolio-production-store";
import {
  createChannelPublication,
  createRenderExport
} from "../lib/publication-store";
import { PublicationMutationError } from "../lib/publication-mutation-errors";
import { releaseProjectKingsPortfolioDaemon } from "../lib/project-kings/portfolio-daemon";
import { bootstrapOwner } from "../lib/team-store";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-portfolio-topology-fence-"));
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

async function seedProfile(input: {
  workspaceId: string;
  userId: string;
  suffix: string;
}): Promise<{ channelId: string; profile: ProductionProfileRecord }> {
  const channel = await createChannel({
    workspaceId: input.workspaceId,
    creatorUserId: input.userId,
    name: `Topology ${input.suffix}`,
    username: `topology-${input.suffix}`
  });
  const profile = createProductionProfile({
    workspaceId: input.workspaceId,
    channelId: channel.id,
    version: 1,
    status: "active",
    profileHash: sha(`profile:${input.suffix}`),
    expectedYoutubeChannelId: `UC${input.suffix.padEnd(22, "0")}`,
    expectedDestinationTitle: `Topology ${input.suffix}`,
    templateId: `template-${input.suffix}`,
    templateSnapshotSha256: sha(`template:${input.suffix}`),
    publishPolicyId: "project-kings-daily-3x3-v1",
    qualityPolicyId: "project-kings-quality-v1",
    modelRouteManifestId: "project-kings-model-routes-v2",
    modelRouteManifestSha256: "1".repeat(64),
    targetPerLogicalDay: 6,
    readyBufferMin: 1,
    readyBufferCap: 12,
    candidateAttemptBudget: 9,
    config: {},
    approvedAt: nowIso(),
    approvedByUserId: input.userId
  });
  return { channelId: channel.id, profile };
}

function seedRun(input: {
  workspaceId: string;
  profiles: readonly ProductionProfileRecord[];
  target?: number;
}) {
  return createOrGetProductionRun({
    workspaceId: input.workspaceId,
    portfolioProfileHash: sha(`portfolio:${input.profiles.map((profile) => profile.id).join(":")}`),
    logicalDate: "2040-01-01",
    mode: "live",
    targetPerChannel: input.target ?? 6,
    manifestHash: sha("manifest"),
    manifest: { schemaVersion: 1 },
    channels: input.profiles.map((profile) => ({
      channelId: profile.channelId,
      profileId: profile.id,
      profileVersion: profile.version,
      profileHash: profile.profileHash,
      expectedYoutubeChannelId: profile.expectedYoutubeChannelId,
      targetCount: input.target ?? 6
    }))
  }).run;
}

function append(item: ProductionItemRecord, eventKind: string) {
  return appendProductionOutbox({
    workspaceId: item.workspaceId,
    runId: item.runId,
    channelId: item.channelId,
    productionItemId: item.id,
    eventKind,
    payload: { fixture: eventKind },
    maxAttempts: 3,
    availableAt: "2040-01-01T00:00:00.000Z"
  });
}

test("two daemons cannot dispatch and lease loss fences every remaining outbox intent", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Topology daemon fence",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const { profile } = await seedProfile({ workspaceId: owner.workspace.id, userId: owner.user.id, suffix: "one" });
    const run = seedRun({ workspaceId: owner.workspace.id, profiles: [profile], target: 3 });
    const runChannel = listProductionRunChannels(run.id)[0]!;
    const items = [1, 2, 3].map((itemSlot) => createProductionItem({
      runId: run.id,
      runChannelId: runChannel.id,
      itemSlot
    }));
    items.forEach((item) => append(item, "source_fit.requested"));

    const configSha256 = sha("daemon-config");
    const daemon = claimPortfolioDaemonLease({
      workspaceId: owner.workspace.id,
      owner: "zoro-a",
      leaseMs: 30_000,
      configSha256,
      now: "2040-01-01T00:00:00.000Z"
    });
    assert.ok(daemon?.leaseToken);
    assert.equal(claimPortfolioDaemonLease({
      workspaceId: owner.workspace.id,
      owner: "zoro-b",
      leaseMs: 30_000,
      configSha256,
      now: "2040-01-01T00:00:01.000Z"
    }), null);
    const dispatch = claimPortfolioDaemonDispatchLease({
      workspaceId: owner.workspace.id,
      daemonLeaseToken: daemon.leaseToken!,
      owner: "zoro-a:tick",
      leaseMs: 30_000,
      now: "2040-01-01T00:00:01.000Z"
    });
    assert.ok(dispatch?.dispatchToken);
    assert.equal(claimPortfolioDaemonDispatchLease({
      workspaceId: owner.workspace.id,
      daemonLeaseToken: daemon.leaseToken!,
      owner: "zoro-a:duplicate-tick",
      leaseMs: 30_000,
      now: "2040-01-01T00:00:02.000Z"
    }), null);
    const fence = {
      daemonId: "project-kings-portfolio-v1",
      daemonLeaseToken: daemon.leaseToken!,
      dispatchToken: dispatch.dispatchToken,
      configSha256
    };
    const claimed = claimProductionOutbox({
      owner: "zoro-a:bounded-pass",
      leaseMs: 1_000,
      limit: 2,
      workspaceId: owner.workspace.id,
      runIds: [run.id],
      daemonFence: fence,
      now: "2040-01-01T00:00:02.000Z"
    });
    assert.equal(claimed.length, 2);

    releasePortfolioDaemonLease({
      workspaceId: owner.workspace.id,
      leaseToken: daemon.leaseToken!,
      now: "2040-01-01T00:00:02.500Z"
    });
    assert.throws(
      () => renewProductionOutboxLease({
        outboxId: claimed[0]!.id,
        leaseToken: claimed[0]!.leaseToken!,
        leaseMs: 1_000,
        daemonFence: fence,
        now: "2040-01-01T00:00:02.600Z"
      }),
      (error: unknown) => error instanceof ProductionStoreError && error.code === "lease_conflict"
    );
    assert.throws(
      () => claimProductionOutbox({
        owner: "stale-zoro",
        leaseMs: 1_000,
        workspaceId: owner.workspace.id,
        runIds: [run.id],
        daemonFence: fence,
        now: "2040-01-01T00:00:02.700Z"
      }),
      (error: unknown) => error instanceof ProductionStoreError && error.code === "lease_conflict"
    );
    const pendingBeforeTakeover = listProductionOutbox({ runId: run.id })
      .find((entry) => entry.status === "pending")!;
    assert.equal(pendingBeforeTakeover.status, "pending");
    assert.equal(pendingBeforeTakeover.attempts, 0, "stop must create no new intent/attempt");

    const takeover = claimPortfolioDaemonLease({
      workspaceId: owner.workspace.id,
      owner: "zoro-b",
      leaseMs: 30_000,
      configSha256,
      now: "2040-01-01T00:00:04.000Z"
    });
    assert.ok(takeover?.leaseToken);
    const takeoverDispatch = claimPortfolioDaemonDispatchLease({
      workspaceId: owner.workspace.id,
      daemonLeaseToken: takeover.leaseToken!,
      owner: "zoro-b:tick",
      leaseMs: 30_000,
      now: "2040-01-01T00:00:04.000Z"
    });
    const recovered = claimProductionOutbox({
      owner: "zoro-b:bounded-pass",
      leaseMs: 1_000,
      limit: 3,
      workspaceId: owner.workspace.id,
      runIds: [run.id],
      daemonFence: {
        daemonId: "project-kings-portfolio-v1",
        daemonLeaseToken: takeover.leaseToken!,
        dispatchToken: takeoverDispatch!.dispatchToken,
        configSha256
      },
      now: "2040-01-01T00:00:04.000Z"
    });
    assert.equal(recovered.length, 3);
  });
});

test("durable outbox rows prove semantic, render, publication and per-channel limits", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Topology durable limits",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const profiles = await Promise.all(["a", "b", "c"].map((suffix) =>
      seedProfile({ workspaceId: owner.workspace.id, userId: owner.user.id, suffix })
    ));
    const run = seedRun({ workspaceId: owner.workspace.id, profiles: profiles.map((entry) => entry.profile), target: 6 });
    const channels = listProductionRunChannels(run.id);
    const itemsByChannel = new Map(channels.map((channel) => [
      channel.channelId,
      Array.from({ length: 6 }, (_, index) => createProductionItem({
        runId: run.id,
        runChannelId: channel.id,
        itemSlot: index + 1
      }))
    ]));
    const first = itemsByChannel.get(channels[0]!.channelId)!;
    const second = itemsByChannel.get(channels[1]!.channelId)!;
    first.slice(0, 4).forEach((item) => append(item, "source_fit.requested"));
    const semantic = claimProductionOutbox({
      owner: "semantic-a",
      leaseMs: 30_000,
      limit: 10,
      workspaceId: owner.workspace.id,
      runIds: [run.id],
      now: "2040-01-01T00:00:01.000Z"
    });
    assert.equal(semantic.length, 3);
    assert.equal(claimProductionOutbox({
      owner: "semantic-b",
      leaseMs: 30_000,
      limit: 10,
      workspaceId: owner.workspace.id,
      runIds: [run.id],
      now: "2040-01-01T00:00:02.000Z"
    }).length, 0);
    ackProductionOutbox({ outboxId: semantic[0]!.id, leaseToken: semantic[0]!.leaseToken! });
    const semanticFourth = claimProductionOutbox({
      owner: "semantic-b",
      leaseMs: 30_000,
      limit: 10,
      workspaceId: owner.workspace.id,
      runIds: [run.id],
      now: "2040-01-01T00:00:03.000Z"
    });
    assert.equal(semanticFourth.length, 1);
    [...semantic.slice(1), ...semanticFourth].forEach((entry) =>
      ackProductionOutbox({ outboxId: entry.id, leaseToken: entry.leaseToken! })
    );

    append(first[0]!, "preview.requested");
    append(first[1]!, "final_render.requested");
    const render = claimProductionOutbox({
      owner: "render-a",
      leaseMs: 30_000,
      limit: 10,
      workspaceId: owner.workspace.id,
      runIds: [run.id],
      now: "2040-01-01T00:00:04.000Z"
    });
    assert.equal(render.length, 1);
    assert.equal(claimProductionOutbox({
      owner: "render-b",
      leaseMs: 30_000,
      limit: 10,
      workspaceId: owner.workspace.id,
      runIds: [run.id],
      now: "2040-01-01T00:00:05.000Z"
    }).length, 0);
    ackProductionOutbox({ outboxId: render[0]!.id, leaseToken: render[0]!.leaseToken! });
    const renderSecond = claimProductionOutbox({
      owner: "render-b",
      leaseMs: 30_000,
      limit: 10,
      workspaceId: owner.workspace.id,
      runIds: [run.id],
      now: "2040-01-01T00:00:06.000Z"
    });
    assert.equal(renderSecond.length, 1);
    ackProductionOutbox({ outboxId: renderSecond[0]!.id, leaseToken: renderSecond[0]!.leaseToken! });

    append(first[0]!, "publication.requested");
    append(first[1]!, "publication.requested");
    append(second[0]!, "publication.requested");
    const publication = claimProductionOutbox({
      owner: "publication-a",
      leaseMs: 30_000,
      limit: 10,
      workspaceId: owner.workspace.id,
      runIds: [run.id],
      now: "2040-01-01T00:00:07.000Z"
    });
    assert.equal(publication.length, 2);
    assert.equal(new Set(publication.map((entry) => entry.channelId)).size, 2);
    assert.equal(claimProductionOutbox({
      owner: "publication-b",
      leaseMs: 30_000,
      limit: 10,
      workspaceId: owner.workspace.id,
      runIds: [run.id],
      now: "2040-01-01T00:00:08.000Z"
    }).length, 0);
  });
});

async function createCompletedStage3Job(input: { workspaceId: string; userId: string }): Promise<string> {
  const id = newId();
  const stamp = nowIso();
  getDb().prepare(`INSERT INTO stage3_jobs
    (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json,
     error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
    VALUES (?, ?, ?, 'render', 'completed', NULL, '{}', NULL, NULL, NULL, 1, 0, ?, ?, ?, ?)`)
    .run(id, input.workspaceId, input.userId, stamp, stamp, stamp, stamp);
  return id;
}

test("CopScopes legacy publication is blocked during v1 ownership and safe rollback re-enables it", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Topology legacy fence",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const { channelId, profile } = await seedProfile({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      suffix: "copscopes"
    });
    const configSha256 = sha("ownership-config");
    const daemon = claimPortfolioDaemonLease({
      workspaceId: owner.workspace.id,
      owner: "zoro",
      leaseMs: 90_000,
      configSha256,
      config: { profileIds: [profile.id], mode: "live" }
    });
    claimPortfolioChannelOwnerships({
      workspaceId: owner.workspace.id,
      daemonLeaseToken: daemon!.leaseToken!,
      configSha256,
      profiles: [{
        id: profile.id,
        channelId,
        version: profile.version,
        profileHash: profile.profileHash
      }]
    });
    assert.equal(getPortfolioChannelOwnership({ workspaceId: owner.workspace.id, channelId })?.status, "active");

    const run = seedRun({ workspaceId: owner.workspace.id, profiles: [profile], target: 1 });
    const runChannel = listProductionRunChannels(run.id)[0]!;
    const item = createProductionItem({ runId: run.id, runChannelId: runChannel.id, itemSlot: 1 });
    const chat = await createOrGetChatByUrl("https://instagram.com/reel/v1-authorized", channelId);
    const stage3JobId = await createCompletedStage3Job({ workspaceId: owner.workspace.id, userId: owner.user.id });
    const v1Render = createRenderExport({
      workspaceId: owner.workspace.id,
      channelId,
      chatId: chat.id,
      stage3JobId,
      artifactFileName: "v1.mp4",
      artifactFilePath: "/tmp/v1.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "v1",
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: owner.user.id
    });
    getDb().prepare(`UPDATE production_items SET state = 'final_approved', stage3_job_id = ? WHERE id = ?`)
      .run(stage3JobId, item.id);
    const scheduledAt = "2040-01-01T12:00:00.000Z";
    const v1Publication = createChannelPublication({
      workspaceId: owner.workspace.id,
      channelId,
      chatId: chat.id,
      renderExportId: v1Render.id,
      scheduleMode: "custom",
      scheduledAt,
      uploadReadyAt: scheduledAt,
      slotDate: "2040-01-01",
      slotIndex: 0,
      title: "v1 authorized",
      description: "",
      tags: [],
      notifySubscribers: false,
      needsReview: false,
      createdByUserId: owner.user.id
    });
    assert.ok(v1Publication.id);

    const legacyChat = await createOrGetChatByUrl("https://instagram.com/reel/legacy-copscopes", channelId);
    const legacyJobId = await createCompletedStage3Job({ workspaceId: owner.workspace.id, userId: owner.user.id });
    const legacyRender = createRenderExport({
      workspaceId: owner.workspace.id,
      channelId,
      chatId: legacyChat.id,
      stage3JobId: legacyJobId,
      artifactFileName: "legacy.mp4",
      artifactFilePath: "/tmp/legacy.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "legacy",
      sourceUrl: legacyChat.url,
      snapshotJson: "{}",
      createdByUserId: owner.user.id
    });
    const createLegacy = () => createChannelPublication({
      workspaceId: owner.workspace.id,
      channelId,
      chatId: legacyChat.id,
      renderExportId: legacyRender.id,
      scheduleMode: "custom",
      scheduledAt: "2040-01-01T13:00:00.000Z",
      uploadReadyAt: "2040-01-01T13:00:00.000Z",
      slotDate: "2040-01-01",
      slotIndex: 1,
      title: "legacy CopScopes",
      description: "",
      tags: [],
      notifySubscribers: false,
      needsReview: false,
      createdByUserId: owner.user.id
    });
    assert.throws(
      createLegacy,
      (error: unknown) => error instanceof PublicationMutationError && error.code === "PORTFOLIO_CHANNEL_OWNED"
    );

    const releasing = releaseProjectKingsPortfolioDaemon({
      workspaceId: owner.workspace.id,
      leaseToken: daemon!.leaseToken!
    });
    assert.equal(releasing.released, false);
    assert.equal(releasing.status, "stopping");
    assert.equal(releasing.channelOwnershipsReleased, false);
    assert.equal(getPortfolioChannelOwnership({ workspaceId: owner.workspace.id, channelId })?.status, "releasing");
    const outboxCountAtStop = listProductionOutbox({ runId: run.id }).length;
    assert.throws(
      () => append(item, "post_stop.intent"),
      /portfolio_channel_ownership_releasing/
    );
    assert.equal(listProductionOutbox({ runId: run.id }).length, outboxCountAtStop);
    assert.throws(
      createLegacy,
      (error: unknown) => error instanceof PublicationMutationError && error.code === "PORTFOLIO_OWNERSHIP_RELEASING"
    );

    getDb().prepare(`UPDATE production_items SET state = 'public_verified', publication_id = ? WHERE id = ?`)
      .run(v1Publication.id, item.id);
    getDb().prepare(`UPDATE production_runs SET status = 'completed', completed_at = ? WHERE id = ?`)
      .run(nowIso(), run.id);
    getDb().prepare(`UPDATE channel_publications SET status = 'published', youtube_video_id = 'video-v1' WHERE id = ?`)
      .run(v1Publication.id);
    const released = releaseProjectKingsPortfolioDaemon({
      workspaceId: owner.workspace.id,
      leaseToken: daemon!.leaseToken!
    });
    assert.equal(released.released, true);
    assert.equal(released.status, "stopped");
    assert.equal(released.channelOwnershipsReleased, true);
    assert.equal(getPortfolioChannelOwnership({ workspaceId: owner.workspace.id, channelId })?.status, "released");
    assert.ok(createLegacy().id, "legacy is re-enabled only after safe release");
  });
});
