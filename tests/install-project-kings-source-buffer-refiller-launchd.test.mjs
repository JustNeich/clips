import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  REFILLER_LAUNCHD_LABEL,
  buildRefillerInstallPlan,
  installRefillerPlist,
  renderRefillerLaunchdTemplate,
  runRefillerInstaller
} from "../scripts/install-project-kings-source-buffer-refiller-launchd.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_RELATIVE =
  "docs/project-kings-production-pipeline-v1/evidence/project-kings-model-routes-v4.json";

async function fixture() {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "refiller-launchd-home-"));
  const configDir = path.join(homeDir, ".config", "assistant");
  const codexHome = path.join(homeDir, ".codex");
  await Promise.all([
    mkdir(configDir, { recursive: true }),
    mkdir(codexHome, { recursive: true })
  ]);
  const authPath = path.join(configDir, "clips.env");
  const configPath = path.join(configDir, "project-kings-source-buffer-refiller.env");
  const codexBin = path.join(homeDir, "bin", "codex");
  await mkdir(path.dirname(codexBin), { recursive: true });
  await writeFile(codexBin, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await writeFile(authPath, [
    "CLIPS_APP_URL=https://clips.example.test",
    "CLIPS_MCP_TOKEN=super-secret-machine-token"
  ].join("\n"), { mode: 0o600 });
  const writeConfig = async (overrides = {}) => {
    const values = {
      CLIPS_MCP_ENV_FILE: authPath,
      PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH: MANIFEST_RELATIVE,
      CODEX_BIN: codexBin,
      CODEX_HOME: codexHome,
      PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED: "0",
      PROJECT_KINGS_AUTONOMOUS_REFILL_MODE: "dry_run",
      PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED: "0",
      ...overrides
    };
    await writeFile(
      configPath,
      Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"),
      { mode: 0o600 }
    );
    await chmod(configPath, 0o600);
  };
  await writeConfig();
  return { homeDir, authPath, configPath, codexBin, codexHome, writeConfig };
}

function planInput(homeDir, overrides = {}) {
  return {
    repoRoot: REPO_ROOT,
    homeDir,
    nodeBin: process.execPath,
    platform: "darwin",
    uid: 501,
    nodeVersion: "22.10.0",
    ...overrides
  };
}

function installerArgs(value, action = []) {
  return [
    ...action,
    "--home", value.homeDir,
    "--repo", REPO_ROOT,
    "--node", process.execPath
  ];
}

test("refiller template escapes paths and rejects unresolved placeholders", () => {
  assert.equal(
    renderRefillerLaunchdTemplate("<string>{{VALUE}}</string>", { VALUE: "/A & B/<node>" }),
    "<string>/A &amp; B/&lt;node&gt;</string>"
  );
  assert.throws(() => renderRefillerLaunchdTemplate("{{MISSING}}", {}), /Unresolved/);
});

test("rendered plist schedules the autonomous one-shot daily and embeds no credentials", async () => {
  const value = await fixture();
  try {
    const plan = await buildRefillerInstallPlan(planInput(value.homeDir));
    assert.match(plan.rendered, new RegExp(`<string>${REFILLER_LAUNCHD_LABEL}<\\/string>`));
    assert.match(plan.rendered, /run-project-kings-autonomous-source-refill-launchd\.mjs/);
    assert.doesNotMatch(plan.rendered, /run-project-kings-source-buffer-refiller\.mjs/);
    assert.match(plan.rendered, /<key>StartCalendarInterval<\/key>/);
    assert.match(plan.rendered, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.doesNotMatch(plan.rendered, /<key>KeepAlive<\/key>/);
    assert.doesNotMatch(plan.rendered, /super-secret-machine-token|CLIPS_MCP_TOKEN/);
    assert.equal(plan.armed, false);
    assert.equal(plan.mode, "dry_run");
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installer defaults to dry-run and creates no runtime paths", async () => {
  const value = await fixture();
  let commands = 0;
  try {
    const result = await runRefillerInstaller(installerArgs(value), {
      platform: "darwin",
      uid: 501,
      nodeVersion: "22.10.0",
      runCommand: async () => { commands += 1; }
    });
    assert.equal(result.output.action, "dry-run");
    assert.equal(result.output.launchdLoaded, false);
    assert.equal(commands, 0);
    await assert.rejects(
      () => stat(path.join(value.homeDir, "Library", "LaunchAgents")),
      /ENOENT/
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("install validates plist, creates stable private paths and never loads launchd", async () => {
  const value = await fixture();
  const commands = [];
  try {
    const result = await runRefillerInstaller(installerArgs(value, ["--install"]), {
      platform: "darwin",
      uid: 501,
      nodeVersion: "22.10.0",
      runCommand: async (command, args) => {
        commands.push({ command, args });
        assert.equal(command, "plutil");
        return { stdout: "OK", stderr: "" };
      }
    });
    assert.deepEqual(commands.map((entry) => entry.command), ["plutil"]);
    assert.equal(result.output.launchdLoaded, false);
    assert.equal((await stat(result.output.targetPath)).mode & 0o777, 0o644);
    assert.equal((await stat(result.output.logsDir)).mode & 0o777, 0o700);
    assert.equal((await stat(result.output.stateDir)).mode & 0o777, 0o700);
    assert.doesNotMatch(await readFile(result.output.targetPath, "utf8"), /super-secret/);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("idempotent install repairs missing stable directories without loading launchd", async () => {
  const value = await fixture();
  const commands = [];
  try {
    const first = await runRefillerInstaller(installerArgs(value, ["--install"]), {
      platform: "darwin",
      uid: 501,
      nodeVersion: "22.10.0",
      runCommand: async (command) => {
        commands.push(command);
        return { stdout: "OK", stderr: "" };
      }
    });
    await Promise.all([
      rm(first.output.logsDir, { recursive: true, force: true }),
      rm(first.output.stateDir, { recursive: true, force: true })
    ]);
    const second = await runRefillerInstaller(installerArgs(value, ["--install"]), {
      platform: "darwin",
      uid: 501,
      nodeVersion: "22.10.0",
      runCommand: async (command) => {
        commands.push(command);
        return { stdout: "OK", stderr: "" };
      }
    });
    assert.equal(second.output.changed, false);
    assert.equal((await stat(second.output.logsDir)).mode & 0o777, 0o700);
    assert.equal((await stat(second.output.stateDir)).mode & 0o777, 0o700);
    assert.deepEqual(commands, ["plutil"]);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("drift requires replace and preserves a rollback backup", async () => {
  const value = await fixture();
  try {
    const plan = await buildRefillerInstallPlan(planInput(value.homeDir));
    await mkdir(plan.launchAgentsDir, { recursive: true });
    await writeFile(plan.targetPath, "old-legacy-refiller-plist", { mode: 0o644 });
    const drifted = await buildRefillerInstallPlan(planInput(value.homeDir));
    await assert.rejects(() => installRefillerPlist(drifted), /--replace/);
    const installed = await installRefillerPlist(drifted, {
      replace: true,
      now: new Date("2026-07-10T12:34:56.000Z"),
      runCommand: async (command) => {
        assert.equal(command, "plutil");
        return { stdout: "OK", stderr: "" };
      }
    });
    assert.equal(await readFile(installed.backupPath, "utf8"), "old-legacy-refiller-plist");
    assert.equal(await readFile(plan.targetPath, "utf8"), plan.rendered);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installer fails closed on weak auth, wrong manifest, missing Codex, Node drift and non-macOS", async () => {
  const value = await fixture();
  try {
    await chmod(value.authPath, 0o644);
    await assert.rejects(() => buildRefillerInstallPlan(planInput(value.homeDir)), /mode 0600/);
    await chmod(value.authPath, 0o600);
    await value.writeConfig({ PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH: "../../outside.json" });
    await assert.rejects(
      () => buildRefillerInstallPlan(planInput(value.homeDir)),
      /inside the Clips repository/
    );
    await value.writeConfig({ CODEX_BIN: path.join(value.homeDir, "missing-codex") });
    await assert.rejects(() => buildRefillerInstallPlan(planInput(value.homeDir)), /Codex binary/);
    await value.writeConfig({
      PROJECT_KINGS_SOURCE_BUFFER_REFILLER_STATE_DIR: path.join(value.homeDir, "unsafe-state")
    });
    await assert.rejects(
      () => buildRefillerInstallPlan(planInput(value.homeDir)),
      /must be the stable path/
    );
    await value.writeConfig();
    await assert.rejects(
      () => buildRefillerInstallPlan(planInput(value.homeDir, { nodeVersion: "24.1.0" })),
      /Node 22/
    );
    await assert.rejects(
      () => buildRefillerInstallPlan(planInput(value.homeDir, { platform: "linux" })),
      /macOS only/
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("arm is explicit, checks Node and Codex login, then replaces the loaded legacy label", async () => {
  const value = await fixture();
  const installCommands = [];
  try {
    await runRefillerInstaller(installerArgs(value, ["--install"]), {
      platform: "darwin",
      uid: 501,
      nodeVersion: "22.10.0",
      runCommand: async (command) => {
        installCommands.push(command);
        return { stdout: "OK", stderr: "" };
      }
    });
    let oldRuntimeCalls = 0;
    await assert.rejects(
      () => runRefillerInstaller(installerArgs(value, ["--arm"]), {
        platform: "darwin",
        uid: 501,
        nodeVersion: "22.10.0",
        runCommand: async () => ({ stdout: "", stderr: "" })
      }),
      /ARMED=1/
    );
    await value.writeConfig({
      PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED: "1",
      PROJECT_KINGS_AUTONOMOUS_REFILL_MODE: "shadow"
    });
    await assert.rejects(
      () => runRefillerInstaller(installerArgs(value, ["--arm"]), {
        platform: "darwin",
        uid: 501,
        nodeVersion: "22.10.0",
        runCommand: async (_command, args) => {
          oldRuntimeCalls += 1;
          return {
            stdout: args[0] === "--version"
              ? (oldRuntimeCalls === 1 ? "v22.10.0" : "codex-cli 0.131.0")
              : "",
            stderr: ""
          };
        }
      }),
      /0\.144\.1/
    );
    const commands = [];
    const result = await runRefillerInstaller(installerArgs(value, ["--arm"]), {
      platform: "darwin",
      uid: 501,
      nodeVersion: "22.10.0",
      runCommand: async (command, args, options) => {
        commands.push({ command, args, options });
        if (args[0] === "--version" && commands.length === 1) {
          return { stdout: "v22.10.0\n", stderr: "" };
        }
        if (args[0] === "--version") {
          return { stdout: "codex-cli 0.144.1\n", stderr: "" };
        }
        if (args[0] === "login") return { stdout: "Logged in using ChatGPT", stderr: "" };
        if (command === "launchctl" && args[0] === "bootout") {
          throw Object.assign(new Error("Could not find service"), { stderr: "Could not find service" });
        }
        return { stdout: "", stderr: "" };
      }
    });
    assert.equal(result.output.launchdLoaded, true);
    assert.equal(result.output.mode, "shadow");
    assert.deepEqual(commands.map((entry) => [entry.command, entry.args[0]]), [
      [commands[0].command, "--version"],
      [commands[1].command, "--version"],
      [commands[1].command, "login"],
      ["launchctl", "bootout"],
      ["launchctl", "bootstrap"]
    ]);
    assert.equal(commands[2].options.env.CODEX_HOME, value.codexHome);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("execute cannot arm without the independent upload flag", async () => {
  const value = await fixture();
  try {
    await value.writeConfig({
      PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED: "1",
      PROJECT_KINGS_AUTONOMOUS_REFILL_MODE: "execute",
      PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED: "0"
    });
    await assert.rejects(
      () => buildRefillerInstallPlan(planInput(value.homeDir)),
      /UPLOAD_ARMED=1/
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("uninstall preserves a backup and rollback restores it without loading launchd", async () => {
  const value = await fixture();
  try {
    const installed = await runRefillerInstaller(installerArgs(value, ["--install"]), {
      platform: "darwin",
      uid: 501,
      nodeVersion: "22.10.0",
      runCommand: async () => ({ stdout: "OK", stderr: "" })
    });
    const original = await readFile(installed.output.targetPath, "utf8");
    const uninstallCommands = [];
    const removed = await runRefillerInstaller([
      "--uninstall", "--home", value.homeDir
    ], {
      platform: "darwin",
      uid: 501,
      now: new Date("2026-07-11T12:00:00.000Z"),
      runCommand: async (command, args) => {
        uninstallCommands.push({ command, args });
        return { stdout: "", stderr: "" };
      }
    });
    assert.equal(removed.output.launchdLoaded, false);
    await assert.rejects(() => stat(installed.output.targetPath), /ENOENT/);
    assert.equal(await readFile(removed.output.backupPath, "utf8"), original);
    const rollbackCommands = [];
    const restored = await runRefillerInstaller([
      "--rollback", removed.output.backupPath,
      "--home", value.homeDir
    ], {
      platform: "darwin",
      uid: 501,
      runCommand: async (command, args) => {
        rollbackCommands.push({ command, args });
        return { stdout: "", stderr: "" };
      }
    });
    assert.equal(restored.output.launchdLoaded, false);
    assert.equal(await readFile(installed.output.targetPath, "utf8"), original);
    assert.deepEqual(rollbackCommands.map((entry) => entry.args[0]), ["-lint", "bootout"]);
    assert.deepEqual(uninstallCommands.map((entry) => entry.args[0]), ["bootout"]);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});
