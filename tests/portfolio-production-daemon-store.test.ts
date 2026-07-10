import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  claimPortfolioDaemonLease,
  getPortfolioDaemonRuntime,
  heartbeatPortfolioDaemonLease,
  isPortfolioDaemonLeaseActive,
  PortfolioDaemonLeaseError,
  releasePortfolioDaemonLease
} from "../lib/portfolio-production-daemon-store";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: (workspaceId: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-portfolio-daemon-store-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    const owner = await bootstrapOwner({
      workspaceName: "Portfolio daemon store",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    return await run(owner.workspace.id);
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("portfolio daemon lease is singleton, durable, renewable and takeover-safe", { concurrency: false }, async () => {
  await withIsolatedAppData(async (workspaceId) => {
    const configSha256 = "1".repeat(64);
    const first = claimPortfolioDaemonLease({
      workspaceId,
      owner: "zoro-one",
      leaseMs: 30_000,
      configSha256,
      config: { profileIds: ["one", "two", "three"], mode: "shadow" },
      now: "2040-01-01T00:00:00.000Z"
    });
    assert.ok(first?.leaseToken);
    assert.equal(first.configSha256, configSha256);
    assert.deepEqual(first.config, { profileIds: ["one", "two", "three"], mode: "shadow" });

    const second = claimPortfolioDaemonLease({
      workspaceId,
      owner: "zoro-two",
      leaseMs: 30_000,
      configSha256,
      now: "2040-01-01T00:00:10.000Z"
    });
    assert.equal(second, null);

    const renewed = heartbeatPortfolioDaemonLease({
      workspaceId,
      leaseToken: first.leaseToken!,
      leaseMs: 30_000,
      configSha256,
      status: "running",
      logicalDate: "2040-01-01",
      activeRunIds: ["run-b", "run-a", "run-a"],
      now: "2040-01-01T00:00:20.000Z"
    });
    assert.equal(renewed.leaseExpiresAt, "2040-01-01T00:00:50.000Z");
    assert.deepEqual(renewed.activeRunIds, ["run-a", "run-b"]);
    assert.equal(renewed.logicalDate, "2040-01-01");
    assert.equal(isPortfolioDaemonLeaseActive({
      workspaceId,
      leaseToken: first.leaseToken!,
      now: "2040-01-01T00:00:49.999Z"
    }), true);

    const takeover = claimPortfolioDaemonLease({
      workspaceId,
      owner: "zoro-two",
      leaseMs: 30_000,
      configSha256: "2".repeat(64),
      config: { profileIds: ["four", "five", "six"], mode: "shadow" },
      now: "2040-01-01T00:00:50.000Z"
    });
    assert.ok(takeover?.leaseToken);
    assert.notEqual(takeover.leaseToken, first.leaseToken);
    assert.equal(takeover.configSha256, "2".repeat(64));

    assert.throws(
      () => releasePortfolioDaemonLease({
        workspaceId,
        leaseToken: first.leaseToken!,
        now: "2040-01-01T00:00:51.000Z"
      }),
      (error: unknown) => error instanceof PortfolioDaemonLeaseError && error.code === "lease_lost"
    );
    const released = releasePortfolioDaemonLease({
      workspaceId,
      leaseToken: takeover.leaseToken!,
      now: "2040-01-01T00:00:51.000Z"
    });
    assert.equal(released.status, "stopped");
    assert.equal(released.leaseToken, null);
    assert.equal(getPortfolioDaemonRuntime({ workspaceId })?.status, "stopped");
  });
});

test("portfolio daemon heartbeat rejects configuration drift under an active token", { concurrency: false }, async () => {
  await withIsolatedAppData(async (workspaceId) => {
    const claimed = claimPortfolioDaemonLease({
      workspaceId,
      owner: "zoro",
      leaseMs: 30_000,
      configSha256: "a".repeat(64),
      now: "2040-01-01T00:00:00.000Z"
    });
    assert.ok(claimed?.leaseToken);
    assert.throws(
      () => heartbeatPortfolioDaemonLease({
        workspaceId,
        leaseToken: claimed.leaseToken!,
        leaseMs: 30_000,
        configSha256: "b".repeat(64),
        status: "running",
        now: "2040-01-01T00:00:01.000Z"
      }),
      (error: unknown) => error instanceof PortfolioDaemonLeaseError && error.code === "lease_lost"
    );
    assert.equal(isPortfolioDaemonLeaseActive({
      workspaceId,
      leaseToken: claimed.leaseToken!,
      now: "2040-01-01T00:00:02.000Z"
    }), true);
  });
});
