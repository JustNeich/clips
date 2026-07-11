import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as ownerControlRoute } from "../app/api/admin/control/route";
import { createChannel } from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import { createMcpMachineCredential } from "../lib/mcp-machine-credential-store";
import {
  appendProductionOutbox,
  buildProductionOutboxDedupeKey,
  createOrGetProductionRun,
  createProductionItem,
  createProductionProfile,
  isProductionProfileExplicitlyApproved,
  listProductionOutbox,
  listProductionProfiles,
  listProductionRunChannels
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
