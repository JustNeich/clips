import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as ownerControlRoute } from "../app/api/admin/control/route";
import { createChannel, createOrGetChatBySource } from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import { createMcpMachineCredential } from "../lib/mcp-machine-credential-store";
import {
  appendProductionOutbox,
  buildProductionOutboxDedupeKey,
  claimProductionOutbox,
  createOrGetProductionRun,
  createProductionItem,
  createProductionProfile,
  getProductionItem,
  isProductionProfileExplicitlyApproved,
  listChannelSourceCandidates,
  listProductionEvents,
  listProductionItems,
  listProductionOutbox,
  listProductionProfiles,
  listProductionRunChannels,
  reserveChannelSourceCandidate,
  retryProductionOutbox,
  transitionChannelSourceCandidateQualification,
  transitionProductionItem,
  upsertChannelSourceCandidate
} from "../lib/portfolio-production-store";
import { PROJECT_KINGS_PILOT_PROFILES } from "../lib/project-kings/pilot-production-profiles";
import { getActiveProjectKingsSourcePolicyApproval } from "../lib/project-kings/source-policy-approval-store";
import {
  PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION
} from "../lib/project-kings/source-rights-sensitive-policy";
import { bootstrapOwner } from "../lib/team-store";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-portfolio-owner-control-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousManagedTemplatesRoot = process.env.MANAGED_TEMPLATES_ROOT;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.MANAGED_TEMPLATES_ROOT = path.join(appDataDir, "managed-templates");
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousManagedTemplatesRoot === undefined) delete process.env.MANAGED_TEMPLATES_ROOT;
    else process.env.MANAGED_TEMPLATES_ROOT = previousManagedTemplatesRoot;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function postOwnerControl(secret: string, tool: string, input: Record<string, unknown>): Promise<Response> {
  return ownerControlRoute(
    new Request("http://localhost/api/admin/control", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ tool, input })
    })
  );
}

async function seedSyntheticRun() {
  const owner = await bootstrapOwner({
    workspaceName: "Portfolio Owner Control",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "Synthetic portfolio channel",
    username: "synthetic-portfolio-channel"
  });
  const profileHash = sha("synthetic-profile");
  const profile = createProductionProfile({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    version: 1,
    status: "shadow",
    profileHash,
    expectedYoutubeChannelId: "UC_SYNTHETIC",
    expectedDestinationTitle: "Synthetic",
    templateId: "synthetic-template",
    templateSnapshotSha256: sha("synthetic-template"),
    publishPolicyId: "project-kings-daily-3x3-v1",
    qualityPolicyId: "project-kings-quality-v1",
    modelRouteManifestId: "project-kings-model-routes-v1",
    modelRouteManifestSha256: "1".repeat(64),
    targetPerLogicalDay: 1,
    readyBufferMin: 1,
    readyBufferCap: 2,
    candidateAttemptBudget: 2,
    config: {},
    approvedAt: new Date().toISOString(),
    approvedByUserId: owner.user.id
  });
  const created = createOrGetProductionRun({
    workspaceId: owner.workspace.id,
    portfolioProfileHash: sha("synthetic-portfolio"),
    logicalDate: "2040-01-01",
    mode: "shadow",
    targetPerChannel: 1,
    manifestHash: sha("synthetic-manifest"),
    manifest: { schemaVersion: 1 },
    channels: [
      {
        channelId: channel.id,
        profileId: profile.id,
        profileVersion: profile.version,
        profileHash: profile.profileHash,
        expectedYoutubeChannelId: profile.expectedYoutubeChannelId,
        targetCount: 1
      }
    ]
  });
  return { owner, profile, run: created.run };
}

function insertPortfolioChannelOwnership(input: {
  workspaceId: string;
  runChannel: {
    channelId: string;
    profileId: string;
    profileVersion: number;
    profileHash: string;
  };
  status: "active" | "releasing";
}): void {
  const stamp = "2040-01-01T00:00:00.000Z";
  getDb().prepare(`INSERT INTO production_channel_ownership
    (workspace_id, channel_id, daemon_id, config_sha256, profile_id, profile_version, profile_hash,
     status, fence_token, activated_at, release_requested_at, released_at, updated_at)
    VALUES (?, ?, 'project-kings-portfolio-v1', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
    .run(
      input.workspaceId,
      input.runChannel.channelId,
      sha("owner-control-ownership-config"),
      input.runChannel.profileId,
      input.runChannel.profileVersion,
      input.runChannel.profileHash,
      input.status,
      "owner-control-fence-token",
      stamp,
      input.status === "releasing" ? stamp : null,
      stamp
    );
}

async function seedProjectedUploadProtocolSourceFitFailure(
  failure = "packet.task.sourceUrl: must use HTTPS"
) {
  const seeded = await seedSyntheticRun();
  const runChannel = listProductionRunChannels(seeded.run.id)[0]!;
  getDb().prepare("UPDATE production_runs SET status = 'running' WHERE id = ?")
    .run(seeded.run.id);
  getDb().prepare("UPDATE production_run_channels SET status = 'running' WHERE id = ?")
    .run(runChannel.id);

  const sourceUrl = "upload://owner-source-fit-retry/source.mp4";
  const sourceSha256 = sha("owner-source-fit-retry-source");
  const chat = await createOrGetChatBySource({
    rawUrl: sourceUrl,
    channelIdRaw: seeded.profile.channelId,
    title: "Owner source-fit retry fixture"
  });
  const discovered = upsertChannelSourceCandidate({
    workspaceId: seeded.owner.workspace.id,
    channelId: seeded.profile.channelId,
    provider: "upload",
    sourceUrl,
    canonicalUrl: sourceUrl,
    contentSha256: sourceSha256,
    eventFingerprint: "owner-source-fit-retry-event",
    categoryKey: "owner-source-fit-retry",
    rightsStatus: "owner_approved_source_pool",
    evidence: { discoveredBy: "owner-control-regression" }
  }).candidate;
  const candidate = transitionChannelSourceCandidateQualification({
    candidateId: discovered.id,
    toStatus: "qualified",
    contentSha256: sourceSha256,
    eventFingerprint: discovered.eventFingerprint,
    evidence: { qualifiedBy: "owner-control-regression" }
  });
  const createdItem = createProductionItem({
    runId: seeded.run.id,
    runChannelId: runChannel.id,
    itemSlot: 1,
    attemptBudget: 5
  });
  const reserved = reserveChannelSourceCandidate({
    candidateId: candidate.id,
    itemId: createdItem.id,
    expectedItemVersion: createdItem.version
  });
  const sourceIngested = transitionProductionItem({
    itemId: reserved.item.id,
    expectedVersion: reserved.item.version,
    toState: "source_ingested",
    eventType: "production.source_ingested",
    patch: { sourceSha256, chatId: chat.id },
    outbox: {
      eventKind: "source_fit.requested",
      dedupeKey: buildProductionOutboxDedupeKey("source_fit.requested", {
        gate: "source_fit",
        sourceSha256
      }),
      payload: { sourceSha256, chatId: chat.id },
      maxAttempts: 3
    }
  });
  const originalOutbox = listProductionOutbox({
    runId: seeded.run.id,
    productionItemId: sourceIngested.id
  })[0]!;
  for (let attempt = 1; attempt <= originalOutbox.maxAttempts; attempt += 1) {
    const now = `2040-01-01T00:00:0${attempt}.000Z`;
    const claimed = claimProductionOutbox({
      owner: `owner-source-fit-retry-${attempt}`,
      leaseMs: 30_000,
      runIds: [seeded.run.id],
      now
    });
    assert.equal(claimed.length, 1);
    retryProductionOutbox({
      outboxId: claimed[0]!.id,
      leaseToken: claimed[0]!.leaseToken!,
      error: failure,
      availableAt: now,
      now
    });
  }
  return {
    ...seeded,
    runChannelId: runChannel.id,
    item: getProductionItem(sourceIngested.id)!,
    candidate: listChannelSourceCandidates({
      workspaceId: seeded.owner.workspace.id,
      channelId: seeded.profile.channelId,
      limit: 10
    }).find((entry) => entry.id === candidate.id)!,
    outbox: listProductionOutbox({
      runId: seeded.run.id,
      productionItemId: sourceIngested.id
    })[0]!
  };
}

test("portfolio owner commands enforce flow:read versus control:write", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { owner } = await seedSyntheticRun();
    const readOnly = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "portfolio-read-only",
      scopes: ["flow:read"]
    });
    for (const tool of [
      "clips_owner_prepare_production_profiles",
      "clips_owner_approve_production_profile",
      "clips_owner_approve_source_policy",
      "clips_owner_validate_production_profile",
      "clips_owner_start_portfolio_run",
      "clips_owner_reconcile_portfolio_run",
      "clips_owner_retry_production_item",
      "clips_owner_cancel_portfolio_run",
      "clips_owner_tick_portfolio_daemon",
      "clips_owner_release_portfolio_daemon"
    ]) {
      const response = await postOwnerControl(readOnly.secret, tool, {});
      assert.equal(response.status, 401, `${tool} must require control:write`);
    }
    const readable = await postOwnerControl(readOnly.secret, "clips_owner_get_portfolio_run", {});
    assert.equal(readable.status, 400);
  });
});

test("machine credential can heartbeat and release the fail-closed portfolio daemon without website login", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { owner } = await seedSyntheticRun();
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "zoro-portfolio-daemon",
      scopes: ["control:write"]
    });
    const previousFlag = process.env.PORTFOLIO_PIPELINE_V1_ENABLED;
    const previousPostCanaryFlag = process.env.PORTFOLIO_PIPELINE_POST_CANARY_ENABLED;
    delete process.env.PORTFOLIO_PIPELINE_V1_ENABLED;
    delete process.env.PORTFOLIO_PIPELINE_POST_CANARY_ENABLED;
    try {
      const tickResponse = await postOwnerControl(machine.secret, "clips_owner_tick_portfolio_daemon", {
        profileIds: ["profile-dark", "profile-light", "profile-cop"],
        mode: "live",
        timezone: "Europe/Moscow"
      });
      assert.equal(tickResponse.status, 202, await tickResponse.clone().text());
      const tick = (await tickResponse.json()) as {
        role: string;
        status: string;
        leaseToken: string | null;
        blockers: string[];
      };
      assert.equal(tick.role, "leader");
      assert.equal(tick.status, "blocked");
      assert.ok(tick.leaseToken);
      assert.deepEqual(tick.blockers, ["portfolio_feature_flag_disabled"]);

      const releaseResponse = await postOwnerControl(machine.secret, "clips_owner_release_portfolio_daemon", {
        leaseToken: tick.leaseToken
      });
      assert.equal(releaseResponse.status, 200, await releaseResponse.clone().text());
      const released = (await releaseResponse.json()) as { released: boolean; status: string };
      assert.equal(released.released, true);
      assert.equal(released.status, "stopped");

      process.env.PORTFOLIO_PIPELINE_V1_ENABLED = "1";
      const postCanaryResponse = await postOwnerControl(machine.secret, "clips_owner_tick_portfolio_daemon", {
        profileIds: ["profile-dark", "profile-light", "profile-cop"],
        mode: "live",
        canaryPolicy: "none",
        timezone: "Europe/Moscow"
      });
      assert.equal(postCanaryResponse.status, 202, await postCanaryResponse.clone().text());
      const postCanary = (await postCanaryResponse.json()) as {
        status: string;
        leaseToken: string | null;
        blockers: string[];
      };
      assert.equal(postCanary.status, "blocked");
      assert.ok(postCanary.leaseToken);
      assert.deepEqual(postCanary.blockers, ["post_canary_feature_flag_disabled"]);
      await postOwnerControl(machine.secret, "clips_owner_release_portfolio_daemon", {
        leaseToken: postCanary.leaseToken
      });

      const unapprovedStart = await postOwnerControl(machine.secret, "clips_owner_start_portfolio_run", {
        profileIds: ["profile-dark", "profile-light", "profile-cop"],
        logicalDate: "2040-01-01",
        mode: "live",
        canaryPolicy: "none"
      });
      assert.equal(unapprovedStart.status, 409);
      assert.deepEqual(await unapprovedStart.json(), {
        error: "Live canaryPolicy=none requires PORTFOLIO_PIPELINE_POST_CANARY_ENABLED=1.",
        code: "post_canary_feature_flag_disabled"
      });
    } finally {
      if (previousFlag === undefined) delete process.env.PORTFOLIO_PIPELINE_V1_ENABLED;
      else process.env.PORTFOLIO_PIPELINE_V1_ENABLED = previousFlag;
      if (previousPostCanaryFlag === undefined) delete process.env.PORTFOLIO_PIPELINE_POST_CANARY_ENABLED;
      else process.env.PORTFOLIO_PIPELINE_POST_CANARY_ENABLED = previousPostCanaryFlag;
    }
  });
});

test("portfolio owner get, validate, reconcile and cancel expose typed durable state", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { owner, profile, run } = await seedSyntheticRun();
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "portfolio-controller",
      scopes: ["flow:read", "control:write"]
    });

    const validationResponse = await postOwnerControl(
      machine.secret,
      "clips_owner_validate_production_profile",
      { profileId: profile.id, version: profile.version }
    );
    assert.equal(validationResponse.status, 200);
    const validation = (await validationResponse.json()) as { valid: boolean; blockers: string[] };
    assert.equal(validation.valid, false);
    assert.ok(validation.blockers.length > 0);

    const getResponse = await postOwnerControl(machine.secret, "clips_owner_get_portfolio_run", {
      runId: run.id
    });
    assert.equal(getResponse.status, 200);
    const detail = (await getResponse.json()) as {
      run: { id: string; version: number };
      counts: { target: number; publicVerified: number };
      metrics: {
        inputTokens: number;
        cachedInputTokens: number;
        reasoningOutputTokens: number;
        outbox: { pending: number };
      };
    };
    assert.equal(detail.run.id, run.id);
    assert.deepEqual(detail.counts, { target: 1, publicVerified: 0, terminal: 0 });
    assert.equal(detail.metrics.inputTokens, 0);
    assert.equal(detail.metrics.cachedInputTokens, 0);
    assert.equal(detail.metrics.reasoningOutputTokens, 0);
    assert.equal(detail.metrics.outbox.pending, 0);

    const reconcileResponse = await postOwnerControl(
      machine.secret,
      "clips_owner_reconcile_portfolio_run",
      { runId: run.id, expectedVersion: detail.run.version }
    );
    assert.equal(reconcileResponse.status, 202);
    const reconciled = (await reconcileResponse.json()) as {
      acquired: boolean;
      run: { version: number };
      background: { scheduled: boolean; status: string; blockerCode: string | null };
    };
    assert.equal(reconciled.acquired, true);
    assert.deepEqual(reconciled.background, {
      scheduled: false,
      status: "blocked",
      blockerCode: "manifest_path_missing",
      blocker: "PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH is not configured; live background dispatch remains disabled.",
      manifestId: null,
      manifestSha256: null,
      runId: run.id
    });

    const cancelResponse = await postOwnerControl(machine.secret, "clips_owner_cancel_portfolio_run", {
      runId: run.id,
      expectedVersion: reconciled.run.version,
      reason: "owner test cancellation"
    });
    assert.equal(cancelResponse.status, 202, await cancelResponse.clone().text());
    const canceled = (await cancelResponse.json()) as { run: { status: string } };
    assert.equal(canceled.run.status, "cancel_requested");
  });
});

test("portfolio start and retry reject incomplete owner input before side effects", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { owner } = await seedSyntheticRun();
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "portfolio-input-guard",
      scopes: ["flow:read", "control:write"]
    });
    const start = await postOwnerControl(machine.secret, "clips_owner_start_portfolio_run", {
      logicalDate: "2040-01-01",
      mode: "unsupported"
    });
    assert.equal(start.status, 400);
    const fakeProfileIds = ["profile-dark", "profile-light", "profile-cop"];
    const liveTargetOne = await postOwnerControl(machine.secret, "clips_owner_start_portfolio_run", {
      profileIds: fakeProfileIds,
      logicalDate: "2040-01-01",
      mode: "live",
      targetPerChannel: 1
    });
    assert.equal(liveTargetOne.status, 400);
    assert.deepEqual(await liveTargetOne.json(), {
      error: "Project Kings owner start supports targetPerChannel=1 only for shadow; live and simulation require 3."
    });
    const shadowTargetTwo = await postOwnerControl(machine.secret, "clips_owner_start_portfolio_run", {
      profileIds: fakeProfileIds,
      logicalDate: "2040-01-01",
      mode: "shadow",
      targetPerChannel: 2
    });
    assert.equal(shadowTargetTwo.status, 400);
    const shadowTargetOne = await postOwnerControl(machine.secret, "clips_owner_start_portfolio_run", {
      profileIds: fakeProfileIds,
      logicalDate: "2040-01-01",
      mode: "shadow",
      targetPerChannel: 1
    });
    assert.equal(shadowTargetOne.status, 404, await shadowTargetOne.clone().text());
    assert.doesNotMatch(await shadowTargetOne.text(), /targetPerChannel/);
    const retry = await postOwnerControl(machine.secret, "clips_owner_retry_production_item", {
      runId: "missing"
    });
    assert.equal(retry.status, 400);
  });
});

test("owner must explicitly approve exact prepared profile hashes before live start", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Portfolio Explicit Approval",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    for (const profile of Object.values(PROJECT_KINGS_PILOT_PROFILES)) {
      const channel = await createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: profile.youtube.titleAdvisory,
        username: `approval_${profile.profileId.slice(0, 6)}`
      });
      getDb().prepare("UPDATE channels SET id = ? WHERE id = ?").run(profile.profileId, channel.id);
    }
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "portfolio-explicit-approval",
      scopes: ["flow:read", "control:write"]
    });
    const preparedResponse = await postOwnerControl(
      machine.secret,
      "clips_owner_prepare_production_profiles",
      {}
    );
    assert.equal(preparedResponse.status, 200, await preparedResponse.clone().text());
    const prepared = (await preparedResponse.json()) as {
      profiles: Record<string, { id: string; version: number; profileHash: string; status: string }>;
    };
    const drafts = Object.values(prepared.profiles);
    assert.equal(drafts.length, 3);
    assert.ok(drafts.every((profile) => profile.status === "draft"));

    const previousFlag = process.env.PORTFOLIO_PIPELINE_V1_ENABLED;
    process.env.PORTFOLIO_PIPELINE_V1_ENABLED = "1";
    try {
      const start = await postOwnerControl(machine.secret, "clips_owner_start_portfolio_run", {
        profileIds: drafts.map((profile) => profile.id),
        logicalDate: "2040-01-01",
        mode: "live"
      });
      assert.equal(start.status, 409, await start.clone().text());
      const body = (await start.json()) as { code: string; error: string };
      assert.equal(body.code, "invalid_transition");
      assert.match(body.error, /explicitly approved/);
      assert.equal(
        (getDb().prepare("SELECT COUNT(*) AS count FROM production_runs").get() as { count: number }).count,
        0
      );
      const daemonWithoutPolicy = await postOwnerControl(machine.secret, "clips_owner_tick_portfolio_daemon", {
        profileIds: drafts.map((profile) => profile.id),
        mode: "live",
        timezone: "Europe/Moscow"
      });
      assert.equal(daemonWithoutPolicy.status, 202);
      const daemonState = (await daemonWithoutPolicy.json()) as {
        status: string;
        leaseToken: string;
        blockers: string[];
      };
      assert.equal(daemonState.status, "blocked");
      assert.match(daemonState.blockers.join(" "), /active owner approval.*source policy/);
      const releasedDaemon = await postOwnerControl(machine.secret, "clips_owner_release_portfolio_daemon", {
        leaseToken: daemonState.leaseToken
      });
      assert.equal(releasedDaemon.status, 200);

      const wrongPolicy = await postOwnerControl(machine.secret, "clips_owner_approve_source_policy", {
        policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
        policySha256: "f".repeat(64),
        sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
        ownerAuthorizationEvidenceSha256: sha("owner-source-policy-intent")
      });
      assert.equal(wrongPolicy.status, 409);
      assert.equal(getActiveProjectKingsSourcePolicyApproval(owner.workspace.id), null);

      const sourcePolicy = await postOwnerControl(machine.secret, "clips_owner_approve_source_policy", {
        policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
        policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
        sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
        ownerAuthorizationEvidenceSha256: sha("owner-source-policy-intent")
      });
      assert.equal(sourcePolicy.status, 200, await sourcePolicy.clone().text());
      const firstApproval = (await sourcePolicy.json()) as {
        existing: boolean;
        approval: { id: string; approvalSha256: string };
      };
      assert.equal(firstApproval.existing, false);
      const repeatedPolicy = await postOwnerControl(machine.secret, "clips_owner_approve_source_policy", {
        policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
        policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
        sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
        ownerAuthorizationEvidenceSha256: sha("owner-source-policy-intent")
      });
      assert.equal(repeatedPolicy.status, 200);
      const repeatedApproval = (await repeatedPolicy.json()) as {
        existing: boolean;
        approval: { id: string; approvalSha256: string };
      };
      assert.equal(repeatedApproval.existing, true);
      assert.equal(repeatedApproval.approval.id, firstApproval.approval.id);
      assert.equal(repeatedApproval.approval.approvalSha256, firstApproval.approval.approvalSha256);

      const unapprovedProfiles = await postOwnerControl(machine.secret, "clips_owner_start_portfolio_run", {
        profileIds: drafts.map((profile) => profile.id),
        logicalDate: "2040-01-01",
        mode: "live"
      });
      assert.equal(unapprovedProfiles.status, 409);
      assert.match((await unapprovedProfiles.json() as { error: string }).error, /explicitly approved/);
    } finally {
      if (previousFlag === undefined) delete process.env.PORTFOLIO_PIPELINE_V1_ENABLED;
      else process.env.PORTFOLIO_PIPELINE_V1_ENABLED = previousFlag;
    }

    const directLive = await postOwnerControl(machine.secret, "clips_owner_approve_production_profile", {
      profileId: drafts[0]!.id,
      version: drafts[0]!.version,
      profileHash: drafts[0]!.profileHash,
      targetStatus: "active"
    });
    assert.equal(directLive.status, 409);
    const wrongHash = await postOwnerControl(machine.secret, "clips_owner_approve_production_profile", {
      profileId: drafts[0]!.id,
      version: drafts[0]!.version,
      profileHash: "f".repeat(64),
      targetStatus: "shadow"
    });
    assert.equal(wrongHash.status, 409);

    for (const draft of drafts) {
      const shadowResponse = await postOwnerControl(machine.secret, "clips_owner_approve_production_profile", {
        profileId: draft.id,
        version: draft.version,
        profileHash: draft.profileHash,
        targetStatus: "shadow"
      });
      assert.equal(shadowResponse.status, 200, await shadowResponse.clone().text());
      const shadow = (await shadowResponse.json()) as { profile: { status: string; approvalScope: string } };
      assert.deepEqual(
        { status: shadow.profile.status, approvalScope: shadow.profile.approvalScope },
        { status: "shadow", approvalScope: "shadow" }
      );
      const activeResponse = await postOwnerControl(machine.secret, "clips_owner_approve_production_profile", {
        profileId: draft.id,
        version: draft.version,
        profileHash: draft.profileHash,
        targetStatus: "active"
      });
      assert.equal(activeResponse.status, 200, await activeResponse.clone().text());
    }
    const active = listProductionProfiles({ workspaceId: owner.workspace.id });
    assert.equal(active.length, 3);
    assert.ok(active.every((profile) => isProductionProfileExplicitlyApproved(profile, "live")));
  });
});

test("owner retry requeues the exact revision intent without leaving rework or duplicating the attempt", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { owner, run } = await seedSyntheticRun();
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "portfolio-revision-retry",
      scopes: ["flow:read", "control:write"]
    });
    const runChannel = listProductionRunChannels(run.id)[0]!;
    const created = createProductionItem({
      runId: run.id,
      runChannelId: runChannel.id,
      itemSlot: 1,
      attemptBudget: 5
    });
    getDb().prepare(`UPDATE production_items
      SET state = 'rework', resume_state = 'preview_ready', attempts = 1
      WHERE id = ?`).run(created.id);
    const item = { ...created, state: "rework" as const, resumeState: "preview_ready" as const, attempts: 1 };
    const payload = {
      defects: [{ code: "crop_main_action_lost", severity: "high" }],
      expectedRevisionAction: "targeted_visual_revision"
    };
    const dedupeKey = buildProductionOutboxDedupeKey("revision.requested", {
      gate: "preview",
      attemptNo: 1,
      previewSha256: sha("owner-retry-preview")
    });
    const intent = appendProductionOutbox({
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "revision.requested",
      dedupeKey,
      payload,
      maxAttempts: 3,
      availableAt: "2040-01-01T00:00:00.000Z"
    });
    getDb().prepare(`UPDATE production_outbox
      SET status = 'dead', attempts = max_attempts,
          last_error = 'legacy dead revision without a projector'
      WHERE id = ?`).run(intent.id);

    const response = await postOwnerControl(machine.secret, "clips_owner_retry_production_item", {
      runId: run.id,
      itemId: item.id,
      expectedVersion: item.version,
      reason: "retry the same approved revision intent"
    });
    assert.equal(response.status, 202);
    const result = (await response.json()) as {
      item: { state: string; resumeState: string | null; version: number };
      retryIntent: { outboxId: string; dedupeKey: string; status: string; requeued: boolean };
    };
    assert.equal(result.item.state, "rework");
    assert.equal(result.item.resumeState, "preview_ready");
    assert.equal(result.item.version, item.version);
    assert.deepEqual(result.retryIntent, {
      outboxId: intent.id,
      dedupeKey,
      status: "pending",
      requeued: true
    });
    const outbox = listProductionOutbox({ runId: run.id, productionItemId: item.id });
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0]?.id, intent.id);
    assert.equal(outbox[0]?.dedupeKey, dedupeKey);
    assert.deepEqual(outbox[0]?.payload, payload);
    assert.equal(outbox[0]?.attempts, 0);
  });
});

test("owner retry reopens the exact upload-protocol source-fit intent without replacing its item or source", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedProjectedUploadProtocolSourceFitFailure();
    assert.equal(seeded.item.state, "failed");
    assert.equal(seeded.item.version, 4);
    assert.equal(seeded.outbox.status, "dead");
    assert.equal(seeded.outbox.deadLetterCode, "outbox_retry_exhausted");
    assert.ok(seeded.outbox.projectedAt);
    const beforeCandidate = structuredClone(seeded.candidate);
    const beforePayload = structuredClone(seeded.outbox.payload);

    const machine = createMcpMachineCredential({
      workspaceId: seeded.owner.workspace.id,
      ownerUserId: seeded.owner.user.id,
      machineId: "portfolio-source-fit-owner-retry",
      scopes: ["flow:read", "control:write"]
    });
    const response = await postOwnerControl(machine.secret, "clips_owner_retry_production_item", {
      runId: seeded.run.id,
      itemId: seeded.item.id,
      expectedVersion: seeded.item.version,
      reason: "retry the same source after canonical upload protocol support was deployed"
    });
    assert.equal(response.status, 202, await response.clone().text());
    const result = (await response.json()) as {
      item: {
        id: string;
        state: string;
        version: number;
        sourceCandidateId: string | null;
        sourceSha256: string | null;
        chatId: string | null;
      };
      retryIntent: {
        outboxId: string;
        dedupeKey: string;
        status: string;
        requeued: boolean;
        preservedSource: boolean;
      };
    };
    assert.equal(result.item.id, seeded.item.id);
    assert.equal(result.item.state, "source_ingested");
    assert.equal(result.item.version, seeded.item.version + 1);
    assert.equal(result.item.sourceCandidateId, seeded.item.sourceCandidateId);
    assert.equal(result.item.sourceSha256, seeded.item.sourceSha256);
    assert.equal(result.item.chatId, seeded.item.chatId);
    assert.deepEqual(result.retryIntent, {
      outboxId: seeded.outbox.id,
      dedupeKey: seeded.outbox.dedupeKey,
      status: "pending",
      requeued: true,
      preservedSource: true
    });

    const currentItems = listProductionItems({
      runId: seeded.run.id,
      includeHistorical: true
    });
    assert.equal(currentItems.length, 1);
    assert.equal(currentItems[0]?.id, seeded.item.id);
    const afterCandidate = listChannelSourceCandidates({
      workspaceId: seeded.owner.workspace.id,
      channelId: seeded.profile.channelId,
      limit: 10
    }).find((entry) => entry.id === seeded.candidate.id)!;
    assert.deepEqual(afterCandidate, beforeCandidate);
    const afterOutbox = listProductionOutbox({
      runId: seeded.run.id,
      productionItemId: seeded.item.id
    })[0]!;
    assert.equal(afterOutbox.id, seeded.outbox.id);
    assert.equal(afterOutbox.productionItemId, seeded.item.id);
    assert.equal(afterOutbox.dedupeKey, seeded.outbox.dedupeKey);
    assert.deepEqual(afterOutbox.payload, beforePayload);
    assert.equal(afterOutbox.status, "pending");
    assert.equal(afterOutbox.attempts, 0);
    assert.equal(afterOutbox.lastError, null);
    assert.equal(afterOutbox.deadLetterCode, null);
    assert.equal(afterOutbox.projectedAt, null);
    const afterChannel = listProductionRunChannels(seeded.run.id)[0]!;
    assert.equal(afterChannel.id, seeded.runChannelId);
    assert.equal(afterChannel.status, "running");
    assert.equal(afterChannel.blockerCode, null);
    assert.equal(afterChannel.blockerMessage, null);
    assert.equal(afterChannel.completedAt, null);
    const recoveryEvents = listProductionEvents({ runId: seeded.run.id })
      .filter((entry) => entry.eventType.includes("owner_source_fit_retry"));
    assert.deepEqual(recoveryEvents.map((entry) => entry.eventType).sort(), [
      "production.channel.owner_source_fit_retry_reopened",
      "production.item.owner_source_fit_retry_requeued"
    ]);
    assert.ok(recoveryEvents.every((entry) =>
      entry.productionItemId === seeded.item.id &&
      entry.payload.outboxId === seeded.outbox.id &&
      entry.payload.sourceCandidateId === seeded.candidate.id &&
      entry.payload.sourceSha256 === seeded.item.sourceSha256
    ));
  });
});

test("owner retry reopens the exact compressed semantic-input source-fit intent after the transport fix", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedProjectedUploadProtocolSourceFitFailure(
      "A leased semantic input failed immutable size or SHA-256 verification."
    );
    const machine = createMcpMachineCredential({
      workspaceId: seeded.owner.workspace.id,
      ownerUserId: seeded.owner.user.id,
      machineId: "portfolio-source-fit-compression-retry",
      scopes: ["flow:read", "control:write"]
    });
    const response = await postOwnerControl(machine.secret, "clips_owner_retry_production_item", {
      runId: seeded.run.id,
      itemId: seeded.item.id,
      expectedVersion: seeded.item.version,
      reason: "retry the same source after decoded size and SHA verification was deployed"
    });
    assert.equal(response.status, 202, await response.clone().text());
    const result = (await response.json()) as {
      item: { id: string; state: string; sourceCandidateId: string | null };
      retryIntent: { outboxId: string; status: string; preservedSource: boolean };
    };
    assert.equal(result.item.id, seeded.item.id);
    assert.equal(result.item.state, "source_ingested");
    assert.equal(result.item.sourceCandidateId, seeded.candidate.id);
    assert.equal(result.retryIntent.outboxId, seeded.outbox.id);
    assert.equal(result.retryIntent.status, "pending");
    assert.equal(result.retryIntent.preservedSource, true);
    assert.equal(listProductionItems({
      runId: seeded.run.id,
      includeHistorical: true
    }).length, 1);
  });
});

test("owner source-fit recovery stays fail-closed after external effects or a terminal run", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedProjectedUploadProtocolSourceFitFailure();
    const machine = createMcpMachineCredential({
      workspaceId: seeded.owner.workspace.id,
      ownerUserId: seeded.owner.user.id,
      machineId: "portfolio-source-fit-external-effect-guard",
      scopes: ["flow:read", "control:write"]
    });
    getDb().prepare("UPDATE production_items SET upload_session_url = ? WHERE id = ?")
      .run("https://upload.example/session", seeded.item.id);
    const response = await postOwnerControl(machine.secret, "clips_owner_retry_production_item", {
      runId: seeded.run.id,
      itemId: seeded.item.id,
      expectedVersion: seeded.item.version,
      reason: "must remain blocked after an external effect"
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "A production item with downstream or upload effects cannot be recovered in place.",
      code: "external_effect_conflict",
      details: { itemId: seeded.item.id }
    });
    assert.equal(getProductionItem(seeded.item.id)?.state, "failed");
    assert.equal(listProductionOutbox({
      runId: seeded.run.id,
      productionItemId: seeded.item.id
    })[0]?.status, "dead");
    assert.equal(listProductionRunChannels(seeded.run.id)[0]?.status, "failed");
  });

  await withIsolatedAppData(async () => {
    const seeded = await seedProjectedUploadProtocolSourceFitFailure();
    const machine = createMcpMachineCredential({
      workspaceId: seeded.owner.workspace.id,
      ownerUserId: seeded.owner.user.id,
      machineId: "portfolio-source-fit-terminal-run-guard",
      scopes: ["flow:read", "control:write"]
    });
    getDb().prepare("UPDATE production_runs SET status = 'failed', completed_at = ? WHERE id = ?")
      .run("2040-01-01T00:01:00.000Z", seeded.run.id);
    const response = await postOwnerControl(machine.secret, "clips_owner_retry_production_item", {
      runId: seeded.run.id,
      itemId: seeded.item.id,
      expectedVersion: seeded.item.version,
      reason: "must not reopen a terminal run"
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { code: string; error: string };
    assert.equal(body.code, "invalid_transition");
    assert.match(body.error, /still-running production run/);
    assert.equal(getProductionItem(seeded.item.id)?.state, "failed");
    assert.equal(listProductionOutbox({
      runId: seeded.run.id,
      productionItemId: seeded.item.id
    })[0]?.status, "dead");
  });
});

test("owner source-fit recovery rejects a different dead-letter cause without creating a replacement", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedProjectedUploadProtocolSourceFitFailure();
    const machine = createMcpMachineCredential({
      workspaceId: seeded.owner.workspace.id,
      ownerUserId: seeded.owner.user.id,
      machineId: "portfolio-source-fit-cause-guard",
      scopes: ["flow:read", "control:write"]
    });
    getDb().prepare("UPDATE production_outbox SET last_error = ? WHERE id = ?")
      .run("semantic provider unavailable", seeded.outbox.id);
    const response = await postOwnerControl(machine.secret, "clips_owner_retry_production_item", {
      runId: seeded.run.id,
      itemId: seeded.item.id,
      expectedVersion: seeded.item.version,
      reason: "must not reinterpret another source-fit failure"
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { code: string; error: string };
    assert.equal(body.code, "invalid_transition");
    assert.match(body.error, /exact recoverable uploaded-source source-fit dead letter/);
    assert.equal(listProductionItems({
      runId: seeded.run.id,
      includeHistorical: true
    }).length, 1);
    assert.equal(getProductionItem(seeded.item.id)?.state, "failed");
    assert.equal(listProductionRunChannels(seeded.run.id)[0]?.status, "failed");
  });
});

test("ordinary failed owner retry still creates the next source generation", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedSyntheticRun();
    const runChannel = listProductionRunChannels(seeded.run.id)[0]!;
    getDb().prepare("UPDATE production_runs SET status = 'running' WHERE id = ?")
      .run(seeded.run.id);
    getDb().prepare("UPDATE production_run_channels SET status = 'running' WHERE id = ?")
      .run(runChannel.id);
    const original = createProductionItem({
      runId: seeded.run.id,
      runChannelId: runChannel.id,
      itemSlot: 1,
      attemptBudget: 5
    });
    getDb().prepare("UPDATE production_items SET state = 'failed', last_error = ? WHERE id = ?")
      .run("ordinary bounded source failure", original.id);
    const machine = createMcpMachineCredential({
      workspaceId: seeded.owner.workspace.id,
      ownerUserId: seeded.owner.user.id,
      machineId: "portfolio-ordinary-failed-retry",
      scopes: ["flow:read", "control:write"]
    });
    const response = await postOwnerControl(machine.secret, "clips_owner_retry_production_item", {
      runId: seeded.run.id,
      itemId: original.id,
      expectedVersion: original.version,
      reason: "advance the ordinary failed source generation"
    });
    assert.equal(response.status, 202, await response.clone().text());
    const body = (await response.json()) as {
      item: { id: string; itemSlot: number; generation: number; state: string };
      retryIntent: unknown;
    };
    assert.notEqual(body.item.id, original.id);
    assert.equal(body.item.itemSlot, original.itemSlot);
    assert.equal(body.item.generation, original.generation + 1);
    assert.equal(body.item.state, "reserved");
    assert.equal(body.retryIntent, null);
    assert.deepEqual(
      listProductionItems({ runId: seeded.run.id, includeHistorical: true })
        .map((item) => ({ id: item.id, generation: item.generation, state: item.state })),
      [
        { id: original.id, generation: 1, state: "failed" },
        { id: body.item.id, generation: 2, state: "reserved" }
      ]
    );
  });
});

test("owner retry rejects releasing ownership before any recovery mutation", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedSyntheticRun();
    const runChannel = listProductionRunChannels(seeded.run.id)[0]!;
    getDb().prepare("UPDATE production_runs SET status = 'running' WHERE id = ?")
      .run(seeded.run.id);
    getDb().prepare("UPDATE production_run_channels SET status = 'running' WHERE id = ?")
      .run(runChannel.id);
    const original = createProductionItem({
      runId: seeded.run.id,
      runChannelId: runChannel.id,
      itemSlot: 1,
      attemptBudget: 5
    });
    getDb().prepare("UPDATE production_items SET state = 'failed', last_error = ? WHERE id = ?")
      .run("ordinary bounded source failure", original.id);
    insertPortfolioChannelOwnership({
      workspaceId: seeded.owner.workspace.id,
      runChannel,
      status: "releasing"
    });
    const machine = createMcpMachineCredential({
      workspaceId: seeded.owner.workspace.id,
      ownerUserId: seeded.owner.user.id,
      machineId: "portfolio-releasing-owner-retry",
      scopes: ["flow:read", "control:write"]
    });
    const before = {
      item: getProductionItem(original.id),
      items: listProductionItems({ runId: seeded.run.id, includeHistorical: true }),
      channel: listProductionRunChannels(seeded.run.id)[0],
      events: listProductionEvents({ runId: seeded.run.id })
    };
    const response = await postOwnerControl(machine.secret, "clips_owner_retry_production_item", {
      runId: seeded.run.id,
      itemId: original.id,
      expectedVersion: original.version,
      reason: "must remain unchanged while ownership is releasing"
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as {
      code: string;
      details: { blockerCode?: string; operation?: string };
    };
    assert.equal(body.code, "lease_conflict");
    assert.deepEqual(body.details, {
      blockerCode: "portfolio_channel_ownership_releasing",
      operation: "create_replacement_generation",
      productionItemId: original.id,
      workspaceId: seeded.owner.workspace.id,
      channelId: runChannel.channelId
    });
    assert.deepEqual({
      item: getProductionItem(original.id),
      items: listProductionItems({ runId: seeded.run.id, includeHistorical: true }),
      channel: listProductionRunChannels(seeded.run.id)[0],
      events: listProductionEvents({ runId: seeded.run.id })
    }, before);
  });
});

test("accepted owner retry reports deferred reconcile and remains idempotent", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedSyntheticRun();
    const runChannel = listProductionRunChannels(seeded.run.id)[0]!;
    getDb().prepare("UPDATE production_runs SET status = 'running' WHERE id = ?")
      .run(seeded.run.id);
    getDb().prepare("UPDATE production_run_channels SET status = 'running' WHERE id = ?")
      .run(runChannel.id);
    const original = createProductionItem({
      runId: seeded.run.id,
      runChannelId: runChannel.id,
      itemSlot: 1,
      attemptBudget: 5
    });
    getDb().prepare("UPDATE production_items SET state = 'failed', last_error = ? WHERE id = ?")
      .run("ordinary bounded source failure", original.id);
    const sourceUrl = "https://example.com/owner-retry-deferred.mp4";
    const sourceSha256 = sha("owner-retry-deferred-source");
    const discovered = upsertChannelSourceCandidate({
      workspaceId: seeded.owner.workspace.id,
      channelId: seeded.profile.channelId,
      provider: "test",
      sourceUrl,
      canonicalUrl: sourceUrl,
      contentSha256: sourceSha256,
      eventFingerprint: "owner-retry-deferred-event",
      categoryKey: "owner-retry-deferred",
      rightsStatus: "owner_approved_source_pool",
      evidence: { discoveredBy: "owner-retry-deferred-regression" }
    }).candidate;
    const candidate = transitionChannelSourceCandidateQualification({
      candidateId: discovered.id,
      toStatus: "qualified",
      contentSha256: sourceSha256,
      eventFingerprint: discovered.eventFingerprint,
      evidence: { qualifiedBy: "owner-retry-deferred-regression" }
    });
    insertPortfolioChannelOwnership({
      workspaceId: seeded.owner.workspace.id,
      runChannel,
      status: "active"
    });
    getDb().exec(`CREATE TRIGGER owner_retry_test_release_after_replacement
      AFTER INSERT ON production_items
      WHEN NEW.run_id = '${seeded.run.id}' AND NEW.item_slot = 1 AND NEW.generation = 2
      BEGIN
        UPDATE production_channel_ownership
        SET status = 'releasing', release_requested_at = '2040-01-01T00:00:01.000Z',
            updated_at = '2040-01-01T00:00:01.000Z'
        WHERE workspace_id = NEW.workspace_id AND channel_id = NEW.channel_id;
      END;`);
    const machine = createMcpMachineCredential({
      workspaceId: seeded.owner.workspace.id,
      ownerUserId: seeded.owner.user.id,
      machineId: "portfolio-deferred-reconcile-owner-retry",
      scopes: ["flow:read", "control:write"]
    });
    const retryInput = {
      runId: seeded.run.id,
      itemId: original.id,
      expectedVersion: original.version,
      reason: "accept once and defer reconciliation behind the stop fence"
    };
    const firstResponse = await postOwnerControl(
      machine.secret,
      "clips_owner_retry_production_item",
      retryInput
    );
    assert.equal(firstResponse.status, 202, await firstResponse.clone().text());
    const first = (await firstResponse.json()) as {
      accepted: boolean;
      item: { id: string; generation: number; state: string; sourceCandidateId: string | null };
      reconcileDeferred: { code: string; error: string } | null;
    };
    assert.equal(first.accepted, true);
    assert.equal(first.item.generation, 2);
    assert.equal(first.item.state, "reserved");
    assert.equal(first.item.sourceCandidateId, null);
    assert.equal(first.reconcileDeferred?.code, "portfolio_channel_ownership_releasing");
    assert.match(first.reconcileDeferred?.error ?? "", /ownership is releasing/);
    assert.equal(listProductionOutbox({ runId: seeded.run.id }).length, 0);
    assert.equal(listChannelSourceCandidates({
      workspaceId: seeded.owner.workspace.id,
      channelId: seeded.profile.channelId,
      limit: 10
    }).find((entry) => entry.id === candidate.id)?.status, "available");

    const repeatedResponse = await postOwnerControl(
      machine.secret,
      "clips_owner_retry_production_item",
      retryInput
    );
    assert.equal(repeatedResponse.status, 202, await repeatedResponse.clone().text());
    const repeated = (await repeatedResponse.json()) as {
      accepted: boolean;
      item: { id: string; generation: number };
      reconcileDeferred: { code: string } | null;
    };
    assert.equal(repeated.accepted, true);
    assert.equal(repeated.item.id, first.item.id);
    assert.equal(repeated.item.generation, 2);
    assert.equal(repeated.reconcileDeferred?.code, "portfolio_channel_ownership_releasing");
    assert.deepEqual(
      listProductionItems({ runId: seeded.run.id, includeHistorical: true })
        .map((item) => ({ id: item.id, generation: item.generation })),
      [
        { id: original.id, generation: 1 },
        { id: first.item.id, generation: 2 }
      ]
    );
  });
});
