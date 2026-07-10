import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LAUNCHD_LABEL,
  buildLaunchdInstallPlan,
  installLaunchdPlist,
  renderLaunchdTemplate,
  runInstaller
} from "../scripts/install-project-kings-portfolio-launchd.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture() {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "kings-launchd-home-"));
  const configDir = path.join(homeDir, ".config", "assistant");
  await mkdir(configDir, { recursive: true });
  const authPath = path.join(configDir, "clips-mcp.env");
  const configPath = path.join(configDir, "project-kings-portfolio.env");
  await writeFile(authPath, [
    "CLIPS_APP_URL=https://clips.example.test",
    "CLIPS_MCP_TOKEN=super-secret-machine-token"
  ].join("\n"), { mode: 0o600 });
  await writeFile(configPath, [
    `CLIPS_MCP_ENV_FILE=${authPath}`,
    "PROJECT_KINGS_PORTFOLIO_ARMED=0",
    "PROJECT_KINGS_PORTFOLIO_MODE=shadow",
    "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS=profile-dark,profile-light,profile-cop"
  ].join("\n"), { mode: 0o600 });
  return { homeDir, authPath, configPath };
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

test("template rendering XML-escapes paths and rejects unresolved variables", () => {
  const rendered = renderLaunchdTemplate("<string>{{VALUE}}</string>", { VALUE: "/A & B/<node>" });
  assert.equal(rendered, "<string>/A &amp; B/&lt;node&gt;</string>");
  assert.throws(() => renderLaunchdTemplate("{{MISSING}}", {}), /Unresolved/);
});

test("rendered plist uses direct ProgramArguments and contains no credential", async () => {
  const value = await fixture();
  try {
    const plan = await buildLaunchdInstallPlan(planInput(value.homeDir));
    assert.match(plan.rendered, new RegExp(`<string>${LAUNCHD_LABEL}<\\/string>`));
    assert.match(plan.rendered, /run-project-kings-portfolio-daemon\.mjs/);
    assert.match(plan.rendered, /project-kings-portfolio\.env/);
    assert.match(plan.rendered, /--expected-config-sha256/);
    assert.match(plan.rendered, new RegExp(plan.configSha256));
    assert.equal(plan.rendered.includes(REPO_ROOT), false);
    assert.doesNotMatch(plan.rendered, /super-secret-machine-token/);
    assert.doesNotMatch(plan.rendered, /CLIPS_MCP_TOKEN/);
    assert.doesNotMatch(plan.rendered, /<string>-l?c<\/string>/);
    assert.match(plan.rendered, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.match(plan.rendered, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plan.rendered, /<key>ThrottleInterval<\/key>\s*<integer>30<\/integer>/);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installer defaults to dry-run and makes no filesystem or command mutation", async () => {
  const value = await fixture();
  let commandCalls = 0;
  try {
    const result = await runInstaller([
      "--home", value.homeDir,
      "--repo", REPO_ROOT,
      "--node", process.execPath
    ], {
      platform: "darwin",
      uid: 501,
      nodeVersion: "22.10.0",
      runCommand: async () => { commandCalls += 1; }
    });
    assert.equal(result.output.action, "dry-run");
    assert.equal(result.output.launchdLoaded, false);
    assert.equal(commandCalls, 0);
    await assert.rejects(() => stat(path.join(value.homeDir, "Library", "LaunchAgents")), /ENOENT/);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("install validates with plutil, writes atomically and never invokes launchctl", async () => {
  const value = await fixture();
  const commands = [];
  try {
    const result = await runInstaller([
      "--install",
      "--home", value.homeDir,
      "--repo", REPO_ROOT,
      "--node", process.execPath
    ], {
      platform: "darwin",
      uid: 501,
      nodeVersion: "22.10.0",
      runCommand: async (command, args) => {
        commands.push({ command, args });
        assert.equal(command, "plutil");
        assert.equal(args[0], "-lint");
      }
    });
    assert.equal(result.output.action, "install");
    assert.equal(result.output.changed, true);
    assert.equal(result.output.launchdLoaded, false);
    assert.deepEqual(commands.map((item) => item.command), ["plutil"]);
    const installed = await readFile(result.output.targetPath, "utf8");
    assert.match(installed, /run-project-kings-portfolio-daemon\.mjs/);
    assert.doesNotMatch(installed, /super-secret-machine-token|CLIPS_MCP_TOKEN/);
    assert.equal((await stat(result.output.targetPath)).mode & 0o777, 0o644);
    assert.equal((await stat(result.output.runtimePath)).mode & 0o777, 0o600);
    assert.equal(await readFile(result.output.runtimePath, "utf8"), await readFile(path.join(REPO_ROOT, "scripts/run-project-kings-portfolio-daemon.mjs"), "utf8"));
    assert.match(result.output.runtimePath, new RegExp(result.output.releaseSha256));
    assert.equal((await stat(path.dirname(result.output.targetPath).replace(/LaunchAgents$/, `Logs/${LAUNCHD_LABEL}`))).mode & 0o777, 0o700);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("drift is blocked without replace and replace preserves a timestamped backup", async () => {
  const value = await fixture();
  try {
    const plan = await buildLaunchdInstallPlan(planInput(value.homeDir));
    await mkdir(plan.launchAgentsDir, { recursive: true });
    await writeFile(plan.targetPath, "old-plist", { mode: 0o644 });
    const driftedPlan = await buildLaunchdInstallPlan(planInput(value.homeDir));
    await assert.rejects(() => installLaunchdPlist(driftedPlan), /--replace/);
    const installed = await installLaunchdPlist(driftedPlan, {
      replace: true,
      now: new Date("2026-07-10T12:34:56.000Z"),
      runCommand: async (command) => assert.equal(command, "plutil")
    });
    assert.equal(installed.changed, true);
    assert.match(installed.backupPath, /backup-2026-07-10T12-34-56-000Z$/);
    assert.equal(await readFile(installed.backupPath, "utf8"), "old-plist");
    assert.equal(await readFile(plan.targetPath, "utf8"), plan.rendered);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("install is idempotent when the rendered plist already matches", async () => {
  const value = await fixture();
  let commands = 0;
  try {
    const plan = await buildLaunchdInstallPlan(planInput(value.homeDir));
    await installLaunchdPlist(plan, { runCommand: async () => { commands += 1; } });
    const current = await buildLaunchdInstallPlan(planInput(value.homeDir));
    const result = await installLaunchdPlist(current, { runCommand: async () => { commands += 1; } });
    assert.equal(result.changed, false);
    assert.equal(commands, 1);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installed content-addressed daemon fails closed on runtime tampering", async () => {
  const value = await fixture();
  try {
    const plan = await buildLaunchdInstallPlan(planInput(value.homeDir));
    await installLaunchdPlist(plan, { runCommand: async () => undefined });
    await writeFile(plan.runtimePath, "tampered", { mode: 0o600 });
    const current = await buildLaunchdInstallPlan(planInput(value.homeDir));
    await assert.rejects(
      () => installLaunchdPlist(current),
      /runtime hash mismatch/
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installer fails closed on weak env permissions, non-HTTPS auth and non-macOS", async () => {
  const value = await fixture();
  try {
    await chmod(value.authPath, 0o644);
    await assert.rejects(
      () => buildLaunchdInstallPlan(planInput(value.homeDir)),
      /mode 0600/
    );
    await chmod(value.authPath, 0o600);
    await writeFile(value.authPath, "CLIPS_APP_URL=http://clips.example.test\nCLIPS_MCP_TOKEN=secret\n");
    await assert.rejects(
      () => buildLaunchdInstallPlan(planInput(value.homeDir)),
      /HTTPS/
    );
    await assert.rejects(
      () => buildLaunchdInstallPlan(planInput(value.homeDir, { platform: "linux" })),
      /macOS only/
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installer requires exactly three unique frozen profile ids", async () => {
  const value = await fixture();
  try {
    await writeFile(value.configPath, [
      `CLIPS_MCP_ENV_FILE=${value.authPath}`,
      "PROJECT_KINGS_PORTFOLIO_MODE=shadow",
      "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS=duplicate,duplicate,third"
    ].join("\n"));
    await assert.rejects(
      () => buildLaunchdInstallPlan(planInput(value.homeDir)),
      /exactly three unique/
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installer validates the immutable daemon canary policy", async () => {
  const value = await fixture();
  try {
    await writeFile(value.configPath, [
      `CLIPS_MCP_ENV_FILE=${value.authPath}`,
      "PROJECT_KINGS_PORTFOLIO_MODE=shadow",
      "PROJECT_KINGS_PORTFOLIO_CANARY_POLICY=first_item_per_channel_public_verified",
      "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS=profile-dark,profile-light,profile-cop"
    ].join("\n"));
    await assert.rejects(
      () => buildLaunchdInstallPlan(planInput(value.homeDir)),
      /always requires canary policy none/
    );

    await writeFile(value.configPath, [
      `CLIPS_MCP_ENV_FILE=${value.authPath}`,
      "PROJECT_KINGS_PORTFOLIO_MODE=live",
      "PROJECT_KINGS_PORTFOLIO_CANARY_POLICY=none",
      "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS=profile-dark,profile-light,profile-cop"
    ].join("\n"));
    assert.equal((await buildLaunchdInstallPlan(planInput(value.homeDir))).appOrigin, "https://clips.example.test");
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installer exposes manual commands but has no arm or load CLI option", async () => {
  const value = await fixture();
  try {
    const plan = await buildLaunchdInstallPlan(planInput(value.homeDir));
    assert.match(plan.manualArmCommand, /^launchctl bootstrap gui\/501 /);
    assert.equal(plan.manualStopCommand, `launchctl bootout gui/501/${LAUNCHD_LABEL}`);
    await assert.rejects(
      () => runInstaller(["--arm", "--home", value.homeDir], { platform: "darwin", uid: 501, nodeVersion: "22.10.0" }),
      /Unknown installer argument/
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});
