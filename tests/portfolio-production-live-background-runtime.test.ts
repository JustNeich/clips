import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel } from "../lib/chat-history";
import {
  bootstrapPortfolioProductionLiveBackgroundRuntimeWithRetry,
  PortfolioProductionBackgroundRuntime,
  schedulePortfolioProductionLiveBackgroundRun,
  resetPortfolioProductionLiveBackgroundRuntimeForTests
} from "../lib/portfolio-production-live-background-runtime";
import type { reconcilePortfolioProductionRun } from "../lib/portfolio-production-orchestrator";
import {
  claimPortfolioDaemonDispatchLease,
  claimPortfolioDaemonLease,
  releasePortfolioDaemonDispatchLease,
  releasePortfolioDaemonLease
} from "../lib/portfolio-production-daemon-store";
import {
  appendProductionOutbox,
  claimProductionOutbox,
  createOrGetProductionRun,
  createProductionItem,
  createProductionProfile,
  getNextProductionOutboxWakeAt,
  listProductionOutbox,
  listProductionRunChannels,
  renewProductionOutboxLease,
  type ProductionItemRecord,
  type ProductionRunRecord
} from "../lib/portfolio-production-store";
import {
  calculateProductionAgentRouteManifestSha256,
  loadFrozenProductionAgentRouteManifest
} from "../lib/project-kings/production-model-route-manifest";
import {
  PRODUCTION_MODEL_AGENT_ROLES,
  type ProductionModelAgentRole
} from "../lib/project-kings/production-agent-contracts";
import type { ProductionAgentModelSelection } from "../lib/project-kings/production-agent-runtime";
import { bootstrapOwner } from "../lib/team-store";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function productionSelection(role: ProductionModelAgentRole): ProductionAgentModelSelection {
  const requiresVision = role === "vision_qa" || role === "source_policy";
  const sampleSize = role === "source_policy" ? 30 : 3;
  const route = (routeId: string, fallbackRouteIds: string[], meanCost: number) => ({
    route: {
      routeId,
      provider: "codex",
      model: routeId.endsWith("primary") ? "gpt-5.4-mini" : "gpt-5.4",
      capabilities: {
        vision: requiresVision,
        jsonSchema: true,
        reasoningEfforts: ["low", "medium"] as const,
        timeoutMs: 60_000,
        fallbackRouteIds
      }
    },
    benchmark: {
      benchmarkVersion: "background-runtime-manifest-v1",
      routeId,
      reasoningEffort: "low" as const,
      sampleSize,
      qualityScore: 0.98,
      schemaSuccessRate: 1,
      p95LatencyMs: 1_000,
      meanCost,
      costUnit: "codex_credits" as const
    }
  });
  return {
    primary: route(`${role}-primary`, [`${role}-fallback`], 1),
    fallback: route(`${role}-fallback`, [], 2),
    policy: {
      requiresVision,
      requiresJsonSchema: true,
      minimumReasoning: "low",
      minimumContextTokens: 1_000,
      minimumSampleSize: sampleSize,
      minimumQualityScore: 0.9,
      minimumSchemaSuccessRate: 1,
      maximumP95LatencyMs: 5_000
    }
  };
}

function productionManifestFixture() {
  const payload = {
    schemaVersion: 2 as const,
    manifestId: "project-kings-background-runtime-test-v2",
    createdAt: "2040-01-01T00:00:00.000Z",
    evidence: Object.fromEntries(
      PRODUCTION_MODEL_AGENT_ROLES.map((role, index) => [role, {
        role,
        benchmarkVersion: "background-runtime-manifest-v1",
        evidenceSha256: String(index + 1).repeat(64)
      }])
    ) as Record<ProductionModelAgentRole, {
      role: ProductionModelAgentRole;
      benchmarkVersion: string;
      evidenceSha256: string;
    }>,
    selections: Object.fromEntries(
      PRODUCTION_MODEL_AGENT_ROLES.map((role) => [role, productionSelection(role)])
    ) as Record<ProductionModelAgentRole, ProductionAgentModelSelection>
  };
  return {
    ...payload,
    manifestSha256: calculateProductionAgentRouteManifestSha256(payload)
  };
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-portfolio-background-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  resetPortfolioProductionLiveBackgroundRuntimeForTests();
  try {
    return await run();
  } finally {
    resetPortfolioProductionLiveBackgroundRuntimeForTests();
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

async function seedRun(input: {
  mode?: "shadow" | "live";
  target?: number;
  logicalDate?: string;
  owner?: Awaited<ReturnType<typeof bootstrapOwner>>;
  modelRouteManifestId?: string;
  modelRouteManifestSha256?: string;
} = {}): Promise<{
  run: ProductionRunRecord;
  items: ProductionItemRecord[];
  owner: Awaited<ReturnType<typeof bootstrapOwner>>;
}> {
  const owner = input.owner ?? await bootstrapOwner({
      workspaceName: "Portfolio Background Runtime",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: `Channel ${input.logicalDate ?? "one"}`,
    username: `background-${(input.logicalDate ?? "one").replaceAll("-", "")}`
  });
  const profile = createProductionProfile({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    version: 1,
    status: "active",
    profileHash: sha(`profile:${channel.id}`),
    expectedYoutubeChannelId: "UC1234567890123456789012",
    expectedDestinationTitle: "Background destination",
    templateId: "background-template",
    templateSnapshotSha256: sha("template"),
    publishPolicyId: "project-kings-daily-3x3-v1",
    qualityPolicyId: "project-kings-quality-v1",
    modelRouteManifestId: input.modelRouteManifestId ?? "project-kings-model-routes-v1",
    modelRouteManifestSha256: input.modelRouteManifestSha256 ?? "1".repeat(64),
    targetPerLogicalDay: input.target ?? 1,
    readyBufferMin: 1,
    readyBufferCap: 3,
    candidateAttemptBudget: 3,
    config: {},
    approvedAt: "2026-07-10T00:00:00.000Z",
    approvedByUserId: owner.user.id
  });
  const created = createOrGetProductionRun({
    workspaceId: owner.workspace.id,
    portfolioProfileHash: sha(`portfolio:${channel.id}`),
    logicalDate: input.logicalDate ?? "2040-01-01",
    mode: input.mode ?? "live",
    targetPerChannel: input.target ?? 1,
    manifestHash: sha(`manifest:${channel.id}`),
    manifest: { schemaVersion: 1 },
    channels: [{
      channelId: channel.id,
      profileId: profile.id,
      profileVersion: profile.version,
      profileHash: profile.profileHash,
      expectedYoutubeChannelId: profile.expectedYoutubeChannelId,
      targetCount: input.target ?? 1
    }]
  });
  const runChannel = listProductionRunChannels(created.run.id)[0]!;
  const items = Array.from({ length: input.target ?? 1 }, (_, index) => createProductionItem({
    runId: created.run.id,
    runChannelId: runChannel.id,
    itemSlot: index + 1,
    attemptBudget: 3
  }));
  return { run: created.run, items, owner };
}

const noReconcile = (() => ({ acquired: true })) as unknown as typeof reconcilePortfolioProductionRun;

function appendEvent(item: ProductionItemRecord, eventKind: string, availableAt?: string) {
  return appendProductionOutbox({
    workspaceId: item.workspaceId,
    runId: item.runId,
    channelId: item.channelId,
    productionItemId: item.id,
    eventKind,
    payload: {},
    availableAt,
    maxAttempts: 3
  });
}

test("background dispatcher uses the durable global render claim across bounded passes", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { run, items } = await seedRun({ target: 3 });
    items.forEach((item) => appendEvent(item, "preview.requested"));
    let active = 0;
    let maxActive = 0;
    const runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: run.workspaceId,
      dispatcher: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      },
      autoSchedule: false,
      heartbeatMs: 0
    }, {
      reconcile: noReconcile,
      now: () => new Date("2040-01-01T00:00:00.000Z"),
      logger: () => undefined
    });
    runtime.scheduleRun(run.id);
    const results = [await runtime.runNow(), await runtime.runNow(), await runtime.runNow()];
    assert.equal(results.reduce((sum, result) => sum + result.claimed, 0), 3);
    assert.equal(results.reduce((sum, result) => sum + result.delivered, 0), 3);
    assert.equal(maxActive, 1);
    assert.equal(listProductionOutbox({ runId: run.id }).every((event) => event.status === "delivered"), true);
  });
});

test("closed portfolio daemon fence prevents reconcile, claim and dispatch", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { run, items } = await seedRun();
    appendEvent(items[0]!, "publication.requested");
    let reconcileCalls = 0;
    let dispatchCalls = 0;
    const runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: run.workspaceId,
      dispatcher: async () => { dispatchCalls += 1; },
      dispatchFence: () => false,
      autoSchedule: false,
      heartbeatMs: 0
    }, {
      reconcile: (() => {
        reconcileCalls += 1;
        return { acquired: true };
      }) as unknown as typeof reconcilePortfolioProductionRun,
      now: () => new Date("2040-01-01T00:00:00.000Z"),
      logger: () => undefined
    });
    runtime.scheduleRun(run.id);
    const result = await runtime.runNow();
    assert.equal(result.reconciled, 0);
    assert.equal(result.claimed, 0);
    assert.equal(dispatchCalls, 0);
    assert.equal(reconcileCalls, 0);
    assert.equal(listProductionOutbox({ runId: run.id })[0]?.status, "pending");
  });
});

test("reconcile/refiller runs before the claim so newly released work starts in the same pass", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { run, items } = await seedRun();
    let refilled = false;
    let dispatchCalls = 0;
    const reconcileAndRefill = (() => {
      if (!refilled) {
        refilled = true;
        appendEvent(items[0]!, "source_fit.requested");
      }
      return { acquired: true };
    }) as unknown as typeof reconcilePortfolioProductionRun;
    const runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: run.workspaceId,
      dispatcher: async () => { dispatchCalls += 1; },
      autoSchedule: false,
      heartbeatMs: 0
    }, {
      reconcile: reconcileAndRefill,
      now: () => new Date("2040-01-01T00:00:00.000Z"),
      logger: () => undefined
    });
    runtime.scheduleRun(run.id);
    const result = await runtime.runNow();
    assert.equal(result.claimed, 1);
    assert.equal(dispatchCalls, 1);
    assert.equal(result.reconciled, 2);
  });
});

test("shadow publication intents are acknowledged without invoking the live upload dispatcher", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { run, items } = await seedRun({ mode: "shadow" });
    appendEvent(items[0]!, "publication.requested");
    let uploadCalls = 0;
    const runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: run.workspaceId,
      dispatcher: async () => { uploadCalls += 1; },
      autoSchedule: false,
      heartbeatMs: 0
    }, {
      reconcile: noReconcile,
      now: () => new Date("2040-01-01T00:00:00.000Z"),
      logger: () => undefined
    });
    runtime.scheduleRun(run.id);
    const result = await runtime.runNow();
    assert.equal(result.delivered, 1);
    assert.equal(uploadCalls, 0);
    assert.equal(listProductionOutbox({ runId: run.id })[0]?.status, "delivered");
  });
});

test("a run that becomes blocked during reconcile is removed before any pending side effect is claimed", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { run, items } = await seedRun();
    appendEvent(items[0]!, "publication.requested");
    let reads = 0;
    let dispatchCalls = 0;
    const runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: run.workspaceId,
      dispatcher: async () => { dispatchCalls += 1; },
      autoSchedule: false,
      heartbeatMs: 0
    }, {
      getRun: () => {
        reads += 1;
        return { ...run, status: reads >= 3 ? "blocked" : "running" };
      },
      reconcile: noReconcile,
      now: () => new Date("2040-01-01T00:00:00.000Z"),
      logger: () => undefined
    });
    runtime.scheduleRun(run.id);
    const result = await runtime.runNow();
    assert.equal(result.claimed, 0);
    assert.equal(dispatchCalls, 0);
    assert.equal(listProductionOutbox({ runId: run.id })[0]?.status, "pending");
  });
});

test("cancel-requested runs stay registered so cancellation and upload reconciliation outbox work can finish", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { run, items } = await seedRun();
    appendEvent(items[0]!, "production.item.cancel_requested");
    const cancelRequestedRun: ProductionRunRecord = {
      ...run,
      status: "cancel_requested",
      completedAt: null
    };
    let dispatchCalls = 0;
    const runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: run.workspaceId,
      dispatcher: async () => { dispatchCalls += 1; },
      autoSchedule: false,
      heartbeatMs: 0
    }, {
      getRun: () => cancelRequestedRun,
      reconcile: noReconcile,
      now: () => new Date("2040-01-01T00:00:00.000Z"),
      logger: () => undefined
    });
    runtime.scheduleRun(run.id);
    const result = await runtime.runNow();

    assert.equal(result.claimed, 1);
    assert.equal(result.delivered, 1);
    assert.equal(dispatchCalls, 1);
    assert.deepEqual(runtime.getSnapshot().registeredRunIds, [run.id]);
  });
});

test("a restarted dispatcher reclaims an expired durable lease and finishes the event", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { run, items } = await seedRun();
    appendEvent(items[0]!, "source_fit.requested");
    const crashedClaim = claimProductionOutbox({
      owner: "crashed-process",
      leaseMs: 1_000,
      workspaceId: run.workspaceId,
      runIds: [run.id],
      now: "2040-01-01T00:00:00.000Z"
    });
    assert.equal(crashedClaim.length, 1);

    let dispatchCalls = 0;
    const runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: run.workspaceId,
      dispatcher: async () => { dispatchCalls += 1; },
      autoSchedule: false,
      heartbeatMs: 0,
      outboxLeaseMs: 1_000
    }, {
      reconcile: noReconcile,
      now: () => new Date("2040-01-01T00:00:01.001Z"),
      logger: () => undefined
    });
    runtime.scheduleRun(run.id);
    const result = await runtime.runNow();
    assert.equal(result.delivered, 1);
    assert.equal(dispatchCalls, 1);
    const event = listProductionOutbox({ runId: run.id })[0]!;
    assert.equal(event.status, "delivered");
    assert.equal(event.attempts, 2);
  });
});

test("dispatcher claims only explicitly registered run ids inside the workspace", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const first = await seedRun({ logicalDate: "2040-01-01" });
    const second = await seedRun({ logicalDate: "2040-01-02", owner: first.owner });
    appendEvent(first.items[0]!, "source_fit.requested");
    appendEvent(second.items[0]!, "source_fit.requested");
    const seenRunIds: string[] = [];
    const runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: first.run.workspaceId,
      dispatcher: async (event) => { seenRunIds.push(event.runId); },
      autoSchedule: false,
      heartbeatMs: 0
    }, {
      reconcile: noReconcile,
      now: () => new Date("2040-01-03T00:00:00.000Z"),
      logger: () => undefined
    });
    runtime.scheduleRun(first.run.id);
    await runtime.runNow();
    assert.deepEqual(seenRunIds, [first.run.id]);
    assert.equal(listProductionOutbox({ runId: first.run.id })[0]?.status, "delivered");
    assert.equal(listProductionOutbox({ runId: second.run.id })[0]?.status, "pending");
  });
});

test("overlapping wakes share one pass and cannot double-dispatch an event", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { run, items } = await seedRun();
    appendEvent(items[0]!, "source_fit.requested");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let dispatchCalls = 0;
    const runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: run.workspaceId,
      dispatcher: async () => {
        dispatchCalls += 1;
        await gate;
      },
      autoSchedule: false,
      heartbeatMs: 0
    }, {
      reconcile: noReconcile,
      now: () => new Date("2040-01-01T00:00:00.000Z"),
      logger: () => undefined
    });
    runtime.scheduleRun(run.id);
    const first = runtime.runNow();
    const second = runtime.runNow();
    await Promise.resolve();
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(dispatchCalls, 1);
    assert.equal(firstResult.claimed, 1);
    assert.deepEqual(secondResult, firstResult);
  });
});

test("outbox heartbeat renewal delays watchdog recovery and next wake tracks future verification", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { run, items } = await seedRun();
    appendEvent(items[0]!, "public_verify.requested", "2040-01-01T00:01:00.000Z");
    assert.equal(
      getNextProductionOutboxWakeAt({ workspaceId: run.workspaceId, runIds: [run.id] }),
      "2040-01-01T00:01:00.000Z"
    );
    const claimed = claimProductionOutbox({
      owner: "first-owner",
      leaseMs: 1_000,
      workspaceId: run.workspaceId,
      runIds: [run.id],
      now: "2040-01-01T00:01:00.000Z"
    });
    renewProductionOutboxLease({
      outboxId: claimed[0]!.id,
      leaseToken: claimed[0]!.leaseToken!,
      leaseMs: 2_000,
      now: "2040-01-01T00:01:00.500Z"
    });
    assert.equal(claimProductionOutbox({
      owner: "watchdog",
      leaseMs: 1_000,
      workspaceId: run.workspaceId,
      runIds: [run.id],
      now: "2040-01-01T00:01:01.500Z"
    }).length, 0);
    assert.equal(claimProductionOutbox({
      owner: "watchdog",
      leaseMs: 1_000,
      workspaceId: run.workspaceId,
      runIds: [run.id],
      now: "2040-01-01T00:01:02.501Z"
    }).length, 1);
  });
});

test("legacy in-process watchdog is opt-in and never the portfolio default", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { run, items } = await seedRun();
    appendEvent(items[0]!, "public_verify.requested", "2040-01-01T00:01:00.000Z");
    const runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: run.workspaceId,
      dispatcher: async () => undefined,
      heartbeatMs: 0,
      autoSchedule: true,
      pollIntervalMs: 30_000
    }, {
      reconcile: noReconcile,
      now: () => new Date("2040-01-01T00:00:00.000Z"),
      logger: () => undefined
    });
    runtime.scheduleRun(run.id);
    for (let attempt = 0; attempt < 20 && !runtime.getSnapshot().lastPass; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.lastPass?.claimed, 0);
    assert.equal(snapshot.wakeAt, "2040-01-01T00:00:30.000Z");
    runtime.stop();
  });
});

test("bounded live dispatch requires exact daemon and dispatch leases without Codex auth", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const repoCwd = process.cwd();
    const manifestPath = path.join(process.env.APP_DATA_DIR!, "background-runtime-manifest-v2.json");
    await writeFile(manifestPath, `${JSON.stringify(productionManifestFixture(), null, 2)}\n`, "utf8");
    const manifest = await loadFrozenProductionAgentRouteManifest({
      repoCwd,
      manifestPath
    });
    const { run } = await seedRun({
      modelRouteManifestId: manifest.manifestId,
      modelRouteManifestSha256: manifest.manifestSha256
    });
    const previousFlag = process.env.PORTFOLIO_PIPELINE_V1_ENABLED;
    process.env.PORTFOLIO_PIPELINE_V1_ENABLED = "1";
    try {
      const configSha256 = "c".repeat(64);
      const daemon = claimPortfolioDaemonLease({
        workspaceId: run.workspaceId,
        owner: "zoro-test",
        leaseMs: 90_000,
        configSha256,
        now: new Date().toISOString()
      });
      assert.ok(daemon?.leaseToken);
      const dispatch = claimPortfolioDaemonDispatchLease({
        workspaceId: run.workspaceId,
        daemonLeaseToken: daemon.leaseToken!,
        owner: "zoro-test:tick",
        leaseMs: 90_000,
        now: new Date().toISOString()
      });
      assert.ok(dispatch?.dispatchToken);
      const result = await schedulePortfolioProductionLiveBackgroundRun({
        runId: run.id,
        workspaceId: run.workspaceId,
        repoCwd,
        manifestPath,
        daemonLease: {
          leaseToken: daemon.leaseToken!,
          dispatchToken: dispatch.dispatchToken,
          configSha256
        }
      });
      assert.equal(result.status, "scheduled");
      assert.equal(result.scheduled, true);
      assert.equal(result.blockerCode, null);
      releasePortfolioDaemonDispatchLease({
        workspaceId: run.workspaceId,
        daemonLeaseToken: daemon.leaseToken!,
        dispatchToken: dispatch.dispatchToken
      });
      releasePortfolioDaemonLease({ workspaceId: run.workspaceId, leaseToken: daemon.leaseToken! });
    } finally {
      if (previousFlag === undefined) delete process.env.PORTFOLIO_PIPELINE_V1_ENABLED;
      else process.env.PORTFOLIO_PIPELINE_V1_ENABLED = previousFlag;
    }
  });
});

test("bootstrap retries a recoverable provider blocker and remains bounded", async () => {
  const scheduled = {
    scheduled: true,
    status: "scheduled",
    runId: "run-bootstrap-retry",
    blockerCode: null,
    blocker: null,
    manifestId: "manifest-v1",
    manifestSha256: "a".repeat(64)
  } as const;
  const blocked = {
    ...scheduled,
    scheduled: false,
    status: "blocked",
    blockerCode: "provider_unavailable",
    blocker: "provider is temporarily unavailable",
    manifestId: null,
    manifestSha256: null
  } as const;
  let attempts = 0;
  const sleeps: number[] = [];
  const recovered = await bootstrapPortfolioProductionLiveBackgroundRuntimeWithRetry({
    maxAttempts: 3,
    backoffMs: [7, 11]
  }, {
    bootstrap: async () => {
      attempts += 1;
      return attempts === 1 ? [blocked] : [scheduled];
    },
    sleep: async (delayMs) => { sleeps.push(delayMs); }
  });
  assert.deepEqual(recovered, [scheduled]);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [7]);

  attempts = 0;
  sleeps.length = 0;
  const exhausted = await bootstrapPortfolioProductionLiveBackgroundRuntimeWithRetry({
    maxAttempts: 3,
    backoffMs: [2, 4]
  }, {
    bootstrap: async () => {
      attempts += 1;
      return [blocked];
    },
    sleep: async (delayMs) => { sleeps.push(delayMs); }
  });
  assert.deepEqual(exhausted, [blocked]);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [2, 4]);
});
