import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { PortfolioBackgroundScheduleResult } from "../lib/portfolio-production-live-background-runtime";
import type {
  ProductionProfileRecord,
  ProductionRunChannelRecord,
  ProductionRunRecord
} from "../lib/portfolio-production-store";
import {
  ProjectKingsPortfolioDaemonInputError,
  resolveProjectKingsPortfolioDaemonConfig,
  tickProjectKingsPortfolioDaemon
} from "../lib/project-kings/portfolio-daemon";
import { getPortfolioDaemonRuntime } from "../lib/portfolio-production-daemon-store";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: (workspaceId: string, userId: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-project-kings-daemon-server-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    const owner = await bootstrapOwner({
      workspaceName: "Project Kings daemon server",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    return await run(owner.workspace.id, owner.user.id);
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function fakeRun(input: {
  id: string;
  workspaceId: string;
  logicalDate: string;
  mode?: "shadow" | "live";
  status?: ProductionRunRecord["status"];
}): ProductionRunRecord {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    portfolioProfileHash: "portfolio-hash",
    logicalDate: input.logicalDate,
    mode: input.mode ?? "shadow",
    status: input.status ?? "running",
    targetPerChannel: 3,
    manifestHash: "manifest-hash",
    manifest: {},
    requestIdempotencyKey: null,
    version: 1,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: null,
    createdAt: "2040-01-01T00:00:00.000Z",
    updatedAt: "2040-01-01T00:00:00.000Z",
    completedAt: null
  };
}

function scheduled(runId: string): PortfolioBackgroundScheduleResult {
  return {
    scheduled: true,
    status: "scheduled",
    runId,
    blockerCode: null,
    blocker: null,
    manifestId: "manifest",
    manifestSha256: "1".repeat(64)
  };
}

function passingPreflight(profileIds: readonly string[]) {
  return profileIds.map((profileId) => ({
    profileId,
    valid: true,
    profileHash: `profile-hash-${profileId}`,
    liveFactsHash: `live-facts-${profileId}`,
    checks: [],
    blockers: []
  }));
}

test("server daemon tick creates one logical-day run, resumes it and keeps a singleton lease", { concurrency: false }, async () => {
  await withIsolatedAppData(async (workspaceId, userId) => {
    const profileIds = ["profile-dark", "profile-light", "profile-cop"] as const;
    const runs: ProductionRunRecord[] = [];
    const runProfiles = new Map<string, readonly string[]>();
    let now = new Date("2040-01-01T00:00:00.000Z");
    let starts = 0;
    let schedules = 0;
    const dependencies = {
      now: () => now,
      featureFlagEnabled: () => true,
      resolveProfiles: () => ({
        profiles: [] as ProductionProfileRecord[],
        approvedByUserId: userId
      }),
      preflightProfiles: async () => passingPreflight(profileIds),
      listRuns: (input: Parameters<typeof import("../lib/portfolio-production-store").listProductionRuns>[0] = {}) =>
        runs.filter((run) =>
          (!input.workspaceId || run.workspaceId === input.workspaceId) &&
          (!input.modes?.length || input.modes.includes(run.mode)) &&
          (!input.statuses?.length || input.statuses.includes(run.status)) &&
          (!input.hasOpenOutbox || run.status === "completed")
        ),
      listRunChannels: (runId: string) => (runProfiles.get(runId) ?? []).map((profileId, index) => ({
        id: `run-channel-${index}`,
        runId,
        workspaceId,
        channelId: `channel-${index}`,
        profileId,
        profileVersion: 1,
        profileHash: `hash-${index}`,
        expectedYoutubeChannelId: `UC${index}`,
        status: "running",
        targetCount: 3,
        publicVerifiedCount: 0,
        nextSlotAt: null,
        blockerCode: null,
        blockerMessage: null,
        version: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: null
      } satisfies ProductionRunChannelRecord)),
      startDailyRun: async ({ logicalDate }: { logicalDate: string }) => {
        starts += 1;
        const run = fakeRun({ id: `run-${starts}`, workspaceId, logicalDate });
        runs.push(run);
        runProfiles.set(run.id, profileIds);
        return { run };
      },
      scheduleRun: async ({ run }: { run: ProductionRunRecord }) => {
        schedules += 1;
        return scheduled(run.id);
      },
      stopRuntime: () => 0
    };

    const first = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro-one",
      profileIds,
      mode: "shadow",
      timezone: "Europe/Moscow"
    }, dependencies);
    assert.equal(first.role, "leader");
    assert.equal(first.status, "running");
    assert.ok(first.leaseToken);
    assert.equal(first.startedRunId, "run-1");
    assert.deepEqual(first.activeRunIds, ["run-1"]);
    assert.deepEqual(first.scheduledRunIds, ["run-1"]);
    assert.equal(starts, 1);
    assert.equal(schedules, 1);

    now = new Date("2040-01-01T00:00:30.000Z");
    const restartedClient = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro-one",
      leaseToken: first.leaseToken,
      profileIds,
      mode: "shadow",
      timezone: "Europe/Moscow"
    }, dependencies);
    assert.equal(restartedClient.role, "leader");
    assert.equal(restartedClient.startedRunId, "run-1");
    assert.equal(starts, 1, "same logical day must not create a second run");

    const competing = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro-two",
      profileIds,
      mode: "shadow",
      timezone: "Europe/Moscow"
    }, dependencies);
    assert.equal(competing.role, "standby");
    assert.equal(competing.leaseToken, null);
    assert.equal(starts, 1);

    runs[0] = { ...runs[0]!, status: "blocked", lastError: "source_buffer: 3 ready, 6 required" };
    now = new Date("2040-01-01T00:01:00.000Z");
    const blockedReplay = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro-one",
      leaseToken: first.leaseToken,
      profileIds,
      mode: "shadow",
      timezone: "Europe/Moscow"
    }, dependencies);
    assert.equal(blockedReplay.status, "blocked");
    assert.match(blockedReplay.blockers.join(" "), /source_buffer/);

    now = new Date("2040-01-01T00:02:31.000Z");
    const takeover = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro-two",
      profileIds,
      mode: "shadow",
      timezone: "Europe/Moscow"
    }, dependencies);
    assert.equal(takeover.role, "leader");
    assert.ok(takeover.leaseToken);
    assert.notEqual(takeover.leaseToken, first.leaseToken);
    assert.equal(starts, 1);
  });
});

test("unfinished prior logical day blocks a new run until it is completed", { concurrency: false }, async () => {
  await withIsolatedAppData(async (workspaceId, userId) => {
    const profileIds = ["profile-dark", "profile-light", "profile-cop"] as const;
    const priorRun = fakeRun({
      id: "run-prior-8-of-9",
      workspaceId,
      logicalDate: "2040-01-01",
      mode: "live",
      status: "waiting_public"
    });
    const runs: ProductionRunRecord[] = [priorRun];
    const runProfiles = new Map<string, readonly string[]>([[priorRun.id, profileIds]]);
    let now = new Date("2040-01-02T00:00:00.000Z");
    let starts = 0;
    const scheduledRunIds: string[] = [];
    const dependencies = {
      now: () => now,
      featureFlagEnabled: () => true,
      resolveProfiles: () => ({ profiles: [] as ProductionProfileRecord[], approvedByUserId: userId }),
      preflightProfiles: async () => passingPreflight(profileIds),
      listRuns: (input: Parameters<typeof import("../lib/portfolio-production-store").listProductionRuns>[0] = {}) =>
        runs.filter((run) =>
          (!input.workspaceId || run.workspaceId === input.workspaceId) &&
          (!input.modes?.length || input.modes.includes(run.mode)) &&
          (!input.statuses?.length || input.statuses.includes(run.status)) &&
          !input.hasOpenOutbox
        ),
      listRunChannels: (runId: string) => (runProfiles.get(runId) ?? []).map((profileId, index) => ({
        id: `${runId}-channel-${index}`,
        runId,
        workspaceId,
        channelId: `channel-${index}`,
        profileId,
        profileVersion: 1,
        profileHash: `hash-${index}`,
        expectedYoutubeChannelId: `UC${index}`,
        status: runId === priorRun.id && runs[0]?.status === "waiting_public"
          ? index === 2 ? "waiting_public" : "completed"
          : "running",
        targetCount: 3,
        publicVerifiedCount: runId === priorRun.id ? index === 2 ? 2 : 3 : 0,
        nextSlotAt: null,
        blockerCode: null,
        blockerMessage: null,
        version: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: null
      } satisfies ProductionRunChannelRecord)),
      startDailyRun: async ({ logicalDate }: { logicalDate: string }) => {
        starts += 1;
        const run = fakeRun({ id: "run-current-day", workspaceId, logicalDate, mode: "live" });
        runs.push(run);
        runProfiles.set(run.id, profileIds);
        return { run };
      },
      scheduleRun: async ({ run }: { run: ProductionRunRecord }) => {
        scheduledRunIds.push(run.id);
        return scheduled(run.id);
      },
      stopRuntime: () => 0
    };

    const blocked = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro",
      profileIds,
      mode: "live"
    }, dependencies);
    assert.equal(blocked.status, "blocked", JSON.stringify(blocked.blockers));
    assert.equal(blocked.startedRunId, null);
    assert.equal(starts, 0);
    assert.deepEqual(scheduledRunIds, [priorRun.id], "the unfinished prior run should keep recovering");
    assert.match(blocked.blockers.join(" "), /prior_logical_day_unfinished:run-prior-8-of-9:2040-01-01:waiting_public/);

    for (const terminalStatus of ["blocked", "failed"] as const) {
      runs[0] = { ...runs[0]!, status: terminalStatus, completedAt: now.toISOString() };
      now = new Date(now.getTime() + 10_000);
      const stillBlocked = await tickProjectKingsPortfolioDaemon({
        workspaceId,
        leaseOwner: "mcp-machine:zoro",
        leaseToken: blocked.leaseToken,
        profileIds,
        mode: "live"
      }, dependencies);
      assert.equal(stillBlocked.status, "blocked");
      assert.equal(stillBlocked.startedRunId, null);
      assert.equal(starts, 0, `${terminalStatus} prior run must not be bypassed automatically`);
      assert.match(stillBlocked.blockers.join(" "), new RegExp(`prior_logical_day_unfinished:.*:${terminalStatus}`));
    }

    runs[0] = { ...runs[0]!, status: "completed", completedAt: now.toISOString() };
    now = new Date(now.getTime() + 10_000);
    const recovered = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro",
      leaseToken: blocked.leaseToken,
      profileIds,
      mode: "live"
    }, dependencies);
    assert.equal(recovered.status, "running");
    assert.equal(recovered.startedRunId, "run-current-day");
    assert.equal(starts, 1);
  });
});

test("client timeout during pending semantic work cannot open a second dispatch after the original lease horizon", { concurrency: false }, async () => {
  await withIsolatedAppData(async (workspaceId, userId) => {
    const profileIds = ["profile-dark", "profile-light", "profile-cop"] as const;
    const run = fakeRun({ id: "run-pending-semantic", workspaceId, logicalDate: "2040-01-01" });
    let now = new Date("2040-01-01T00:00:00.000Z");
    let schedules = 0;
    let fenceHeartbeat: (() => void) | null = null;
    let resolveSemantic!: () => void;
    const pendingSemantic = new Promise<void>((resolve) => { resolveSemantic = resolve; });
    const dependencies = {
      now: () => now,
      featureFlagEnabled: () => true,
      resolveProfiles: () => ({ profiles: [] as ProductionProfileRecord[], approvedByUserId: userId }),
      preflightProfiles: async () => passingPreflight(profileIds),
      listRuns: (input: Parameters<typeof import("../lib/portfolio-production-store").listProductionRuns>[0] = {}) =>
        (!input.workspaceId || input.workspaceId === workspaceId) &&
        (!input.modes?.length || input.modes.includes(run.mode)) &&
        (!input.statuses?.length || input.statuses.includes(run.status))
          ? [run]
          : [],
      listRunChannels: () => profileIds.map((profileId, index) => ({
        id: `pending-run-channel-${index}`,
        runId: run.id,
        workspaceId,
        channelId: `channel-${index}`,
        profileId,
        profileVersion: 1,
        profileHash: `hash-${index}`,
        expectedYoutubeChannelId: `UC${index}`,
        status: "running" as const,
        targetCount: 3,
        publicVerifiedCount: 0,
        nextSlotAt: null,
        blockerCode: null,
        blockerMessage: null,
        version: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: null
      })),
      startDailyRun: async () => assert.fail("same-day run must be reused"),
      scheduleRun: async () => {
        schedules += 1;
        await pendingSemantic;
        return scheduled(run.id);
      },
      setFenceHeartbeat: (callback: () => void) => {
        fenceHeartbeat = callback;
        return { unref() {} } as unknown as ReturnType<typeof setInterval>;
      },
      clearFenceHeartbeat: () => undefined,
      stopRuntime: () => 0
    };

    const firstTick = tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro",
      profileIds,
      mode: "shadow"
    }, dependencies);
    for (let attempt = 0; attempt < 20 && schedules === 0; attempt += 1) await Promise.resolve();
    assert.equal(schedules, 1);
    const leaseToken = getPortfolioDaemonRuntime({ workspaceId })?.leaseToken;
    assert.ok(leaseToken);

    // The client has timed out, but the server-side bounded request is still
    // waiting for the durable semantic job. Its heartbeat renews both fences.
    now = new Date("2040-01-01T00:01:00.000Z");
    assert.ok(fenceHeartbeat);
    fenceHeartbeat!();
    now = new Date("2040-01-01T00:01:40.000Z");
    const retryTick = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro",
      leaseToken,
      profileIds,
      mode: "shadow"
    }, dependencies);
    assert.equal(retryTick.role, "leader");
    assert.deepEqual(retryTick.blockers, ["portfolio_dispatch_busy"]);
    assert.equal(schedules, 1, "retry after client timeout must not start a second semantic dispatch");

    resolveSemantic();
    const completed = await firstTick;
    assert.deepEqual(completed.scheduledRunIds, [run.id]);
    assert.equal(schedules, 1);
  });
});

test("live daemon holds no dispatch path while the server feature flag is off", { concurrency: false }, async () => {
  await withIsolatedAppData(async (workspaceId) => {
    let starts = 0;
    let schedules = 0;
    let stops = 0;
    const result = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro",
      profileIds: ["profile-dark", "profile-light", "profile-cop"],
      mode: "live",
      timezone: "Europe/Moscow"
    }, {
      now: () => new Date("2040-01-01T00:00:00.000Z"),
      featureFlagEnabled: () => false,
      startDailyRun: async () => {
        starts += 1;
        throw new Error("must not start");
      },
      scheduleRun: async () => {
        schedules += 1;
        throw new Error("must not schedule");
      },
      stopRuntime: () => {
        stops += 1;
        return 1;
      }
    });
    assert.equal(result.role, "leader");
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["portfolio_feature_flag_disabled"]);
    assert.ok(result.leaseToken);
    assert.equal(starts, 0);
    assert.equal(schedules, 0);
    assert.equal(stops, 1);
  });
});

test("live daemon canaryPolicy none is blocked until the post-canary flag is explicit", { concurrency: false }, async () => {
  await withIsolatedAppData(async (workspaceId) => {
    let starts = 0;
    let schedules = 0;
    const result = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro",
      profileIds: ["profile-dark", "profile-light", "profile-cop"],
      mode: "live",
      canaryPolicy: "none",
      timezone: "Europe/Moscow"
    }, {
      now: () => new Date("2040-01-01T00:00:00.000Z"),
      featureFlagEnabled: () => true,
      postCanaryEnabled: () => false,
      startDailyRun: async () => {
        starts += 1;
        throw new Error("must not start");
      },
      scheduleRun: async () => {
        schedules += 1;
        throw new Error("must not schedule");
      },
      stopRuntime: () => 1
    });
    assert.equal(result.role, "leader");
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["post_canary_feature_flag_disabled"]);
    assert.equal(starts, 0);
    assert.equal(schedules, 0);
  });
});

test("daily source-buffer blocker is recorded before run creation and a later tick can recover", { concurrency: false }, async () => {
  await withIsolatedAppData(async (workspaceId, userId) => {
    const profileIds = ["profile-dark", "profile-light", "profile-cop"] as const;
    const runs: ProductionRunRecord[] = [];
    let bufferReady = false;
    let starts = 0;
    let now = new Date("2040-01-01T00:00:00.000Z");
    const dependencies = {
      now: () => now,
      featureFlagEnabled: () => true,
      resolveProfiles: () => ({ profiles: [] as ProductionProfileRecord[], approvedByUserId: userId }),
      preflightProfiles: async () => profileIds.map((profileId, index) => ({
        profileId,
        valid: bufferReady || index > 0,
        profileHash: `profile-hash-${profileId}`,
        liveFactsHash: `live-facts-${profileId}`,
        checks: [],
        blockers: !bufferReady && index === 0 ? ["source_buffer: 3 ready, 6 required"] : []
      })),
      listRuns: (input: Parameters<typeof import("../lib/portfolio-production-store").listProductionRuns>[0] = {}) =>
        runs.filter((run) =>
          (!input.workspaceId || run.workspaceId === input.workspaceId) &&
          (!input.modes?.length || input.modes.includes(run.mode)) &&
          (!input.statuses?.length || input.statuses.includes(run.status))
        ),
      listRunChannels: (runId: string) => profileIds.map((profileId, index) => ({
        id: `recover-channel-${index}`,
        runId,
        workspaceId,
        channelId: `recover-channel-id-${index}`,
        profileId,
        profileVersion: 1,
        profileHash: `recover-hash-${index}`,
        expectedYoutubeChannelId: `UCRECOVER${index}`,
        status: "running" as const,
        targetCount: 3,
        publicVerifiedCount: 0,
        nextSlotAt: null,
        blockerCode: null,
        blockerMessage: null,
        version: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: null
      })),
      startDailyRun: async ({ logicalDate }: { logicalDate: string }) => {
        starts += 1;
        const run = fakeRun({ id: "run-after-refill", workspaceId, logicalDate });
        runs.push(run);
        return { run };
      },
      scheduleRun: async ({ run }: { run: ProductionRunRecord }) => scheduled(run.id),
      stopRuntime: () => 0
    };

    const blocked = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro",
      profileIds,
      mode: "shadow"
    }, dependencies);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.startedRunId, null);
    assert.match(blocked.blockers.join(" "), /source_buffer/);
    assert.equal(starts, 0, "failed daily preflight must not consume the idempotent date");

    bufferReady = true;
    now = new Date("2040-01-01T00:00:30.000Z");
    const recovered = await tickProjectKingsPortfolioDaemon({
      workspaceId,
      leaseOwner: "mcp-machine:zoro",
      leaseToken: blocked.leaseToken,
      profileIds,
      mode: "shadow"
    }, dependencies);
    assert.equal(recovered.status, "running");
    assert.equal(recovered.startedRunId, "run-after-refill");
    assert.equal(starts, 1);
  });
});

test("daemon config rejects category drift and cannot choose another singleton id", () => {
  assert.throws(
    () => resolveProjectKingsPortfolioDaemonConfig({
      profileIds: ["same", "same", "third"],
      mode: "shadow"
    }),
    ProjectKingsPortfolioDaemonInputError
  );
  const config = resolveProjectKingsPortfolioDaemonConfig({
    profileIds: ["dark", "light", "cop"],
    mode: "shadow",
    timezone: "Europe/Moscow"
  });
  assert.equal(config.daemonId, "project-kings-portfolio-v1");
  assert.equal(config.canaryPolicy, "none");
  assert.equal(config.targetPerChannel, 3);
  assert.equal(config.publishPolicyId, "project-kings-daily-3x3-v1");
  assert.equal(resolveProjectKingsPortfolioDaemonConfig({
    profileIds: ["dark", "light", "cop"],
    mode: "live"
  }).canaryPolicy, "first_item_per_channel_public_verified");
});
