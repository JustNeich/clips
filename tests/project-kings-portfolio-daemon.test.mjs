import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PortfolioDaemonError,
  acquireDaemonLock,
  createStructuredLogger,
  loadPortfolioDaemonConfig,
  parseEnvText,
  postOwnerControl,
  redactSecrets,
  releaseDaemonLock,
  releaseHeldPortfolioLease,
  releasePortfolioDaemonServerLease,
  releaseStaleDaemonLock,
  tickPortfolioDaemon,
  writeDaemonState,
  readDaemonState
} from "../scripts/run-project-kings-portfolio-daemon.mjs";

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async text() {
      return payload === null ? "" : JSON.stringify(payload);
    }
  };
}

function baseConfig(overrides = {}) {
  return {
    appUrl: "https://clips.example.test",
    token: "machine-secret-token",
    armed: true,
    mode: "shadow",
    canaryPolicy: "none",
    profileIds: ["profile-dark", "profile-light", "profile-cop"],
    timezone: "Europe/Moscow",
    pollIntervalMs: 30_000,
    blockedBackoffMs: 300_000,
    httpTimeoutMs: 15_000,
    maxHttpAttempts: 3,
    stateDir: "/tmp/project-kings-state",
    statePath: "/tmp/project-kings-state/daemon-health.json",
    lockPath: "/tmp/project-kings-state/daemon.lock",
    killSwitchPath: "/tmp/project-kings-state/DISABLED",
    ...overrides
  };
}

function leaderTick(overrides = {}) {
  return {
    role: "leader",
    status: "running",
    daemonId: "project-kings-portfolio-v1",
    logicalDate: "2026-07-10",
    leaseToken: "server-lease-secret",
    leaseExpiresAt: "2026-07-10T18:01:30.000Z",
    heartbeatAt: "2026-07-10T18:00:00.000Z",
    runtimeVersion: 2,
    startedRunId: "run-1",
    activeRunIds: ["run-1"],
    scheduledRunIds: ["run-1"],
    blockers: [],
    ...overrides
  };
}

test("environment parser accepts simple and exported quoted values", () => {
  assert.deepEqual(parseEnvText("A=one\nexport B='two words'\nC=\"three\"\n"), {
    A: "one",
    B: "two words",
    C: "three"
  });
  assert.throws(() => parseEnvText("not-an-assignment"), /malformed/);
});

test("config requires exactly three unique frozen profile ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kings-daemon-config-"));
  try {
    const configPath = path.join(root, "project-kings.env");
    const authPath = path.join(root, "clips.env");
    await writeFile(authPath, "CLIPS_APP_URL=https://clips.example.test\nCLIPS_MCP_TOKEN=secret\n", { mode: 0o600 });
    await writeFile(configPath, [
      `CLIPS_MCP_ENV_FILE=${authPath}`,
      "PROJECT_KINGS_PORTFOLIO_ARMED=1",
      "PROJECT_KINGS_PORTFOLIO_MODE=live",
      "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS=profile-dark,profile-light,profile-cop",
      `PROJECT_KINGS_PORTFOLIO_STATE_DIR=${path.join(root, "state")}`
    ].join("\n"), { mode: 0o600 });
    const config = await loadPortfolioDaemonConfig({ configPath, homeDir: root });
    assert.deepEqual(config.profileIds, ["profile-dark", "profile-light", "profile-cop"]);
    assert.equal(config.armed, true);
    assert.equal(config.mode, "live");
    assert.equal(config.canaryPolicy, "first_item_per_channel_public_verified");

    await writeFile(configPath, [
      `CLIPS_MCP_ENV_FILE=${authPath}`,
      "PROJECT_KINGS_PORTFOLIO_MODE=live",
      "PROJECT_KINGS_PORTFOLIO_CANARY_POLICY=none",
      "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS=profile-dark,profile-light,profile-cop"
    ].join("\n"));
    assert.equal((await loadPortfolioDaemonConfig({ configPath, homeDir: root })).canaryPolicy, "none");

    await writeFile(configPath, [
      `CLIPS_MCP_ENV_FILE=${authPath}`,
      "PROJECT_KINGS_PORTFOLIO_MODE=shadow",
      "PROJECT_KINGS_PORTFOLIO_CANARY_POLICY=first_item_per_channel_public_verified",
      "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS=profile-dark,profile-light,profile-cop"
    ].join("\n"));
    await assert.rejects(() => loadPortfolioDaemonConfig({ configPath, homeDir: root }), /always requires canary policy none/);

    await writeFile(configPath, [
      `CLIPS_MCP_ENV_FILE=${authPath}`,
      "PROJECT_KINGS_PORTFOLIO_MODE=shadow",
      "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS=duplicate,duplicate,third"
    ].join("\n"));
    await assert.rejects(() => loadPortfolioDaemonConfig({ configPath, homeDir: root }), /exactly three unique/);

    await chmod(authPath, 0o644);
    await assert.rejects(
      () => loadPortfolioDaemonConfig({ configPath, homeDir: root }),
      (error) => error instanceof PortfolioDaemonError && error.code === "env_file_permissions"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("daemon refuses config-byte drift from its installed release binding", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kings-daemon-config-hash-"));
  try {
    const configPath = path.join(root, "project-kings.env");
    const authPath = path.join(root, "clips.env");
    await writeFile(authPath, "CLIPS_APP_URL=https://clips.example.test\nCLIPS_MCP_TOKEN=secret\n", { mode: 0o600 });
    const raw = [
      `CLIPS_MCP_ENV_FILE=${authPath}`,
      "PROJECT_KINGS_PORTFOLIO_MODE=shadow",
      "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS=profile-dark,profile-light,profile-cop"
    ].join("\n");
    await writeFile(configPath, raw, { mode: 0o600 });
    const expected = createHash("sha256").update(raw).digest("hex");
    assert.equal((await loadPortfolioDaemonConfig({ configPath, homeDir: root, expectedConfigSha256: expected })).configSha256, expected);
    await writeFile(configPath, `${raw}\nPROJECT_KINGS_PORTFOLIO_ARMED=1`, { mode: 0o600 });
    await assert.rejects(
      () => loadPortfolioDaemonConfig({ configPath, homeDir: root, expectedConfigSha256: expected }),
      (error) => error instanceof PortfolioDaemonError && error.code === "config_hash_mismatch"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owner client posts only to the owner-control endpoint with the machine bearer token", async () => {
  let captured;
  await postOwnerControl({
    appUrl: "https://clips.example.test/",
    token: "machine-token",
    tool: "clips_owner_tick_portfolio_daemon",
    toolInput: { profileIds: ["a", "b", "c"], mode: "shadow", timezone: "Europe/Moscow" },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return response(202, leaderTick());
    }
  });
  assert.equal(captured.url, "https://clips.example.test/api/admin/control");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Bearer machine-token");
  assert.equal(JSON.parse(captured.init.body).tool, "clips_owner_tick_portfolio_daemon");
});

test("429 and 5xx use a bounded retry budget", async () => {
  const statuses = [429, 502, 202];
  const sleeps = [];
  const payload = await postOwnerControl({
    appUrl: "https://clips.example.test",
    token: "secret",
    tool: "clips_owner_tick_portfolio_daemon",
    maxAttempts: 3,
    random: () => 0,
    sleep: async (delayMs) => { sleeps.push(delayMs); },
    fetchImpl: async () => {
      const status = statuses.shift();
      return response(status, status === 202 ? leaderTick() : { error: `temporary-${status}` });
    }
  });
  assert.equal(payload.role, "leader");
  assert.deepEqual(sleeps, [1_000, 2_000]);
  assert.equal(statuses.length, 0);
});

test("401 is fail-closed, redacted and never retried", async () => {
  let calls = 0;
  let capturedError;
  await assert.rejects(
    () => postOwnerControl({
      appUrl: "https://clips.example.test",
      token: "secret",
      tool: "clips_owner_tick_portfolio_daemon",
      maxAttempts: 3,
      sleep: async () => assert.fail("401 must not sleep/retry"),
      fetchImpl: async () => {
        calls += 1;
        return response(401, { error: "machine token secret is invalid" });
      }
    }),
    (error) => {
      capturedError = error;
      return error instanceof PortfolioDaemonError && error.code === "machine_auth_blocked";
    }
  );
  assert.equal(calls, 1);
  assert.equal(capturedError.message.includes("secret"), false);
});

test("fresh disarmed and kill-switch ticks make zero remote calls", async () => {
  for (const scenario of [
    { config: baseConfig(), exists: true, expected: "disabled" },
    { config: baseConfig({ armed: false }), exists: false, expected: "disarmed" },
    { config: baseConfig({ armed: false, mode: "live" }), exists: false, expected: "disarmed" }
  ]) {
    let calls = 0;
    const result = await tickPortfolioDaemon({
      config: scenario.config,
      state: {},
      fileExists: async () => scenario.exists,
      ownerControl: async () => { calls += 1; }
    });
    assert.equal(result.health.status, scenario.expected);
    assert.equal(result.leaseToken, null);
    assert.equal(calls, 0);
  }
});

test("every armed tick calls exactly the server singleton tick tool", async () => {
  const calls = [];
  const result = await tickPortfolioDaemon({
    config: baseConfig({ mode: "live", canaryPolicy: "first_item_per_channel_public_verified" }),
    state: {},
    fileExists: async () => false,
    ownerControl: async (tool, input) => {
      calls.push({ tool, input });
      return leaderTick();
    }
  });
  assert.deepEqual(calls, [{
    tool: "clips_owner_tick_portfolio_daemon",
    input: {
      profileIds: ["profile-dark", "profile-light", "profile-cop"],
      mode: "live",
      canaryPolicy: "first_item_per_channel_public_verified",
      timezone: "Europe/Moscow"
    }
  }]);
  assert.equal(result.leaseToken, "server-lease-secret");
  assert.equal(result.health.status, "running");
  assert.equal("leaseToken" in result.health, false);
});

test("next in-memory heartbeat forwards the prior lease without persisting it", async () => {
  let tickInput;
  const result = await tickPortfolioDaemon({
    config: baseConfig(),
    state: { schemaVersion: 2, status: "running" },
    leaseToken: "prior-in-memory-lease",
    fileExists: async () => false,
    ownerControl: async (_tool, input) => {
      tickInput = input;
      return leaderTick({ leaseToken: "renewed-in-memory-lease" });
    }
  });
  assert.equal(tickInput.leaseToken, "prior-in-memory-lease");
  assert.equal(result.leaseToken, "renewed-in-memory-lease");
  assert.equal(JSON.stringify(result.health).includes("lease"), true);
  assert.equal(JSON.stringify(result.health).includes("in-memory-lease"), false);
});

test("standby and lease-lost responses clear the in-memory lease", async () => {
  for (const payload of [
    leaderTick({ role: "standby", leaseToken: null, scheduledRunIds: [] }),
    leaderTick({ role: "standby", status: "error", leaseToken: null, blockers: ["portfolio_daemon_lease_lost"] })
  ]) {
    const result = await tickPortfolioDaemon({
      config: baseConfig(),
      state: {},
      leaseToken: "old-lease",
      fileExists: async () => false,
      ownerControl: async () => payload
    });
    assert.equal(result.leaseToken, null);
    assert.equal(result.health.role, "standby");
  }
});

test("disarming an in-memory leader best-effort releases the server lease", async () => {
  const calls = [];
  const result = await tickPortfolioDaemon({
    config: baseConfig({ armed: false }),
    state: {},
    leaseToken: "held-lease",
    fileExists: async () => false,
    ownerControl: async (tool, input) => {
      calls.push({ tool, input });
      return { released: true, status: "stopped" };
    }
  });
  assert.deepEqual(calls, [{
    tool: "clips_owner_release_portfolio_daemon",
    input: { leaseToken: "held-lease" }
  }]);
  assert.equal(result.leaseToken, null);
  assert.equal(result.health.status, "disarmed");
});

test("explicit server release clears stopped or lost leases and retains retryable failures in memory", async () => {
  for (const [payload, expected] of [
    [{ released: true, status: "stopped" }, null],
    [{ released: false, status: "lease_lost" }, null],
    [{ released: false, status: "stopping" }, "held"]
  ]) {
    const result = await releasePortfolioDaemonServerLease({
      config: baseConfig(),
      leaseToken: "held",
      ownerControl: async () => payload
    });
    assert.equal(result.leaseToken, expected);
  }
});

test("kill switch takes precedence over SIGTERM-style server lease release", async () => {
  let calls = 0;
  const skipped = await releaseHeldPortfolioLease({
    config: baseConfig(),
    leaseToken: "held",
    fileExists: async () => true,
    ownerControl: async () => { calls += 1; }
  });
  assert.equal(skipped.skipped, "kill_switch_active");
  assert.equal(calls, 0);

  const released = await releaseHeldPortfolioLease({
    config: baseConfig(),
    leaseToken: "held",
    fileExists: async () => false,
    ownerControl: async (tool) => {
      calls += 1;
      assert.equal(tool, "clips_owner_release_portfolio_daemon");
      return { released: true, status: "stopped" };
    }
  });
  assert.equal(released.released, true);
  assert.equal(calls, 1);
});

test("durable health is private and rejects any lease/token field", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kings-state-"));
  try {
    const statePath = path.join(root, "state", "health.json");
    const health = (await tickPortfolioDaemon({
      config: baseConfig(),
      state: {},
      fileExists: async () => false,
      ownerControl: async () => leaderTick()
    })).health;
    await writeDaemonState(statePath, health);
    assert.deepEqual(await readDaemonState(statePath), health);
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    const raw = await readFile(statePath, "utf8");
    assert.equal(raw.includes("server-lease-secret"), false);
    await assert.rejects(
      () => writeDaemonState(statePath, { ...health, leaseToken: "forbidden" }),
      (error) => error instanceof PortfolioDaemonError && error.code === "state_contains_credential"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("secret redaction covers structured logs and bearer values", () => {
  const secret = "sensitive-machine-token";
  assert.equal(redactSecrets(`Bearer ${secret} ${secret}`, [secret]), "Bearer [REDACTED] [REDACTED]");
  const lines = [];
  const logger = createStructuredLogger({ secrets: [secret], write: (line) => lines.push(line) });
  logger("test", { message: `failed with ${secret}`, authorization: `Bearer ${secret}`, leaseToken: secret });
  assert.equal(lines.join("\n").includes(secret), false);
});

test("local lock release requires exact ownership and stale cleanup cannot steal a live daemon", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kings-lock-"));
  const lockPath = path.join(root, "state", "daemon.lock");
  try {
    const lock = await acquireDaemonLock(lockPath);
    assert.equal(await releaseDaemonLock({ ...lock, token: "wrong" }), false);
    assert.deepEqual(await releaseStaleDaemonLock(lockPath), {
      released: false,
      reason: "active",
      pid: process.pid
    });
    assert.equal(await releaseDaemonLock(lock), true);
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ pid: 999_999_999, token: "stale" })}\n`, { mode: 0o600 });
    assert.equal((await releaseStaleDaemonLock(lockPath)).reason, "stale");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
