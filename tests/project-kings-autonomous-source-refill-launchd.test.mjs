import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  acquireAutonomousRefillLock,
  buildAutonomousRefillLaunchdRunPlan,
  runAutonomousRefillLaunchd
} from "../scripts/run-project-kings-autonomous-source-refill-launchd.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture(overrides = {}) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "autonomous-refill-launchd-"));
  const configDir = path.join(homeDir, ".config", "assistant");
  const codexHome = path.join(homeDir, ".codex");
  const codexBin = path.join(homeDir, "bin", "codex");
  const manifestPath = path.join(homeDir, "route-manifest.json");
  const authPath = path.join(homeDir, "clips.env");
  const configPath = path.join(configDir, "project-kings-source-buffer-refiller.env");
  await Promise.all([
    mkdir(configDir, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
    mkdir(path.dirname(codexBin), { recursive: true })
  ]);
  await Promise.all([
    writeFile(
      codexBin,
      "#!/bin/sh\nif [ \"$1\" = \"login\" ]; then echo 'Logged in using ChatGPT'; else echo 'codex-cli 0.144.1'; fi\n",
      { mode: 0o700 }
    ),
    writeFile(manifestPath, "{}\n", { mode: 0o600 }),
    writeFile(authPath, "CLIPS_MCP_TOKEN=test\n", { mode: 0o600 })
  ]);
  const values = {
    CLIPS_MCP_ENV_FILE: authPath,
    PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH: manifestPath,
    CODEX_BIN: codexBin,
    CODEX_HOME: codexHome,
    PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED: "1",
    PROJECT_KINGS_AUTONOMOUS_REFILL_MODE: "shadow",
    PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED: "0",
    ...overrides
  };
  await writeFile(
    configPath,
    Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"),
    { mode: 0o600 }
  );
  await chmod(configPath, 0o600);
  return { homeDir, configPath, codexBin, codexHome, manifestPath };
}

test("disabled-by-default config exits before lock, Codex or child work", async () => {
  const value = await fixture({
    PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED: "0",
    CODEX_BIN: "",
    CODEX_HOME: "",
    PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH: ""
  });
  let children = 0;
  let locks = 0;
  let status = null;
  try {
    const result = await runAutonomousRefillLaunchd({
      repoRoot: REPO_ROOT,
      homeDir: value.homeDir,
      configPath: value.configPath,
      nodeVersion: "22.10.0",
      acquireLock: async () => {
        locks += 1;
        throw new Error("must not lock");
      },
      runChild: async () => {
        children += 1;
        throw new Error("must not run");
      },
      writeStatus: async (_path, next) => { status = next; }
    });
    assert.equal(result.status, "disabled");
    assert.equal(status.status, "disabled");
    assert.equal(children, 0);
    assert.equal(locks, 0);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("disabled config cannot redirect status outside the stable state directory", async () => {
  const value = await fixture({
    PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED: "0",
    PROJECT_KINGS_SOURCE_BUFFER_REFILLER_STATE_DIR: path.join(os.tmpdir(), "unsafe-refill-state")
  });
  try {
    await assert.rejects(
      () => runAutonomousRefillLaunchd({
        repoRoot: REPO_ROOT,
        homeDir: value.homeDir,
        configPath: value.configPath,
        nodeVersion: "22.10.0"
      }),
      /must be the stable path/
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("active lock makes an overlapping wake a successful no-op", async () => {
  const value = await fixture();
  const stateDir = path.join(
    value.homeDir,
    "Library",
    "Application Support",
    "com.zoro.clips-project-kings-source-buffer-refiller"
  );
  const lockDir = path.join(stateDir, "autonomous-refill.lock");
  await mkdir(lockDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(lockDir, "owner.json"), JSON.stringify({
    schemaVersion: "project-kings-autonomous-refill-lock-v1",
    pid: 4242,
    nonce: "active-owner",
    acquiredAt: "2026-07-11T10:00:00.000Z"
  }));
  let children = 0;
  try {
    const result = await runAutonomousRefillLaunchd({
      repoRoot: REPO_ROOT,
      homeDir: value.homeDir,
      configPath: value.configPath,
      nodeVersion: "22.10.0",
      processAlive: async (pid) => pid === 4242,
      runChild: async () => {
        children += 1;
        throw new Error("overlap must not run");
      }
    });
    assert.equal(result.status, "skipped_overlap");
    assert.equal(result.activePid, 4242);
    assert.equal(children, 0);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("stale lock is recovered and shadow child receives the exact one-shot command", async () => {
  const value = await fixture();
  const stateDir = path.join(
    value.homeDir,
    "Library",
    "Application Support",
    "com.zoro.clips-project-kings-source-buffer-refiller"
  );
  const lockDir = path.join(stateDir, "autonomous-refill.lock");
  await mkdir(lockDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(lockDir, "owner.json"), JSON.stringify({
    schemaVersion: "project-kings-autonomous-refill-lock-v1",
    pid: 9999,
    nonce: "stale-owner",
    acquiredAt: "2026-07-10T10:00:00.000Z"
  }));
  let childInput = null;
  try {
    const result = await runAutonomousRefillLaunchd({
      repoRoot: REPO_ROOT,
      homeDir: value.homeDir,
      configPath: value.configPath,
      nodeVersion: "22.10.0",
      pid: 5000,
      processAlive: async () => false,
      runChild: async (input) => {
        childInput = input;
        return { exitCode: 0, stdout: "{\"status\":\"complete\"}\n", stderr: "" };
      }
    });
    assert.equal(result.status, "completed");
    assert.match(childInput.args.join(" "), /run-project-kings-autonomous-source-refill\.mts/);
    assert.match(childInput.args.join(" "), /--mode shadow/);
    assert.doesNotMatch(childInput.args.join(" "), /--allow-upload/);
    assert.equal(childInput.env.CODEX_BIN, value.codexBin);
    assert.equal(childInput.env.CODEX_HOME, value.codexHome);
    await assert.rejects(access(lockDir));
    const status = JSON.parse(await readFile(path.join(stateDir, "last-launchd-run.json"), "utf8"));
    assert.equal(status.status, "completed");
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("execute mode requires the independent upload arm before locking or child work", async () => {
  const value = await fixture({
    PROJECT_KINGS_AUTONOMOUS_REFILL_MODE: "execute",
    PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED: "0"
  });
  let children = 0;
  try {
    await assert.rejects(
      () => runAutonomousRefillLaunchd({
        repoRoot: REPO_ROOT,
        homeDir: value.homeDir,
        configPath: value.configPath,
        nodeVersion: "22.10.0",
        runChild: async () => {
          children += 1;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      }),
      /UPLOAD_ARMED=1/
    );
    assert.equal(children, 0);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("failed child is recorded as blocked and always releases the lock", async () => {
  const value = await fixture();
  const stateDir = path.join(
    value.homeDir,
    "Library",
    "Application Support",
    "com.zoro.clips-project-kings-source-buffer-refiller"
  );
  const lockDir = path.join(stateDir, "autonomous-refill.lock");
  try {
    await assert.rejects(
      () => runAutonomousRefillLaunchd({
        repoRoot: REPO_ROOT,
        homeDir: value.homeDir,
        configPath: value.configPath,
        nodeVersion: "22.10.0",
        runChild: async () => ({
          exitCode: 2,
          stdout: "",
          stderr: "Bearer secret-token failed"
        })
      }),
      /Bearer \[REDACTED\]/
    );
    await assert.rejects(access(lockDir));
    const status = JSON.parse(
      await readFile(path.join(stateDir, "last-launchd-run.json"), "utf8")
    );
    assert.equal(status.status, "blocked");
    assert.doesNotMatch(status.error, /secret-token/);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("lock ownership is exclusive and only its nonce can release it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "autonomous-refill-lock-"));
  const lockDir = path.join(root, "lock");
  try {
    const first = await acquireAutonomousRefillLock({
      lockDir,
      pid: 111,
      nonce: "first",
      processAlive: async () => true,
      now: new Date("2026-07-11T10:00:00.000Z")
    });
    assert.equal(first.acquired, true);
    const second = await acquireAutonomousRefillLock({
      lockDir,
      pid: 222,
      nonce: "second",
      processAlive: async (pid) => pid === 111,
      now: new Date("2026-07-11T10:00:01.000Z")
    });
    assert.equal(second.acquired, false);
    await first.release();
    await assert.rejects(access(lockDir));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("armed plan fails closed on Node or Codex runtime drift", async () => {
  const value = await fixture();
  try {
    await assert.rejects(
      () => buildAutonomousRefillLaunchdRunPlan({
        repoRoot: REPO_ROOT,
        homeDir: value.homeDir,
        configPath: value.configPath,
        nodeVersion: "24.1.0"
      }),
      /Node 22/
    );
    await rm(value.codexBin);
    await assert.rejects(
      () => buildAutonomousRefillLaunchdRunPlan({
        repoRoot: REPO_ROOT,
        homeDir: value.homeDir,
        configPath: value.configPath,
        nodeVersion: "22.10.0"
      }),
      /ENOENT|no such file/i
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});
