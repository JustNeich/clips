import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
const EVIDENCE_RELATIVE = "docs/project-kings-production-pipeline-v1/evidence/source-buffer-readiness-2026-07-10-v7.json";

async function fixture() {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "refiller-launchd-home-"));
  const configDir = path.join(homeDir, ".config", "assistant");
  await mkdir(configDir, { recursive: true });
  const authPath = path.join(configDir, "clips.env");
  const configPath = path.join(configDir, "project-kings-source-buffer-refiller.env");
  await writeFile(authPath, [
    "CLIPS_APP_URL=https://clips.example.test",
    "CLIPS_MCP_TOKEN=super-secret-machine-token"
  ].join("\n"), { mode: 0o600 });
  await writeFile(configPath, [
    `CLIPS_MCP_ENV_FILE=${authPath}`,
    "PROJECT_KINGS_SOURCE_BUFFER_REFILLER_ARMED=0",
    `PROJECT_KINGS_SOURCE_BUFFER_EVIDENCE_PATH=${EVIDENCE_RELATIVE}`
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

test("refiller template escapes paths and rejects unresolved placeholders", () => {
  assert.equal(
    renderRefillerLaunchdTemplate("<string>{{VALUE}}</string>", { VALUE: "/A & B/<node>" }),
    "<string>/A &amp; B/&lt;node&gt;</string>"
  );
  assert.throws(() => renderRefillerLaunchdTemplate("{{MISSING}}", {}), /Unresolved/);
});

test("rendered refiller plist is persistent, direct and credential-free", async () => {
  const value = await fixture();
  try {
    const plan = await buildRefillerInstallPlan(planInput(value.homeDir));
    assert.match(plan.rendered, new RegExp(`<string>${REFILLER_LAUNCHD_LABEL}<\\/string>`));
    assert.match(plan.rendered, /run-project-kings-source-buffer-refiller\.mjs/);
    assert.match(plan.rendered, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plan.rendered, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.doesNotMatch(plan.rendered, /super-secret-machine-token|CLIPS_MCP_TOKEN/);
    assert.doesNotMatch(plan.rendered, /<string>-l?c<\/string>/);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installer defaults to dry-run and creates no runtime paths", async () => {
  const value = await fixture();
  let commands = 0;
  try {
    const result = await runRefillerInstaller([
      "--home", value.homeDir,
      "--repo", REPO_ROOT,
      "--node", process.execPath
    ], {
      platform: "darwin",
      uid: 501,
      nodeVersion: "22.10.0",
      runCommand: async () => { commands += 1; }
    });
    assert.equal(result.output.action, "dry-run");
    assert.equal(result.output.launchdLoaded, false);
    assert.equal(commands, 0);
    await assert.rejects(() => stat(path.join(value.homeDir, "Library", "LaunchAgents")), /ENOENT/);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("install path runs plutil only and never loads launchd", async () => {
  const value = await fixture();
  const commands = [];
  try {
    const result = await runRefillerInstaller([
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
      }
    });
    assert.deepEqual(commands.map((entry) => entry.command), ["plutil"]);
    assert.equal(result.output.launchdLoaded, false);
    assert.equal((await stat(result.output.targetPath)).mode & 0o777, 0o644);
    assert.doesNotMatch(await readFile(result.output.targetPath, "utf8"), /super-secret-machine-token/);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("drift requires replace and preserves a backup", async () => {
  const value = await fixture();
  try {
    const plan = await buildRefillerInstallPlan(planInput(value.homeDir));
    await mkdir(plan.launchAgentsDir, { recursive: true });
    await writeFile(plan.targetPath, "old-refiller-plist", { mode: 0o644 });
    const drifted = await buildRefillerInstallPlan(planInput(value.homeDir));
    await assert.rejects(() => installRefillerPlist(drifted), /--replace/);
    const installed = await installRefillerPlist(drifted, {
      replace: true,
      now: new Date("2026-07-10T12:34:56.000Z"),
      runCommand: async (command) => assert.equal(command, "plutil")
    });
    assert.equal(await readFile(installed.backupPath, "utf8"), "old-refiller-plist");
    assert.equal(await readFile(plan.targetPath, "utf8"), plan.rendered);
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installer fails closed on weak auth, external evidence and non-macOS", async () => {
  const value = await fixture();
  try {
    await chmod(value.authPath, 0o644);
    await assert.rejects(() => buildRefillerInstallPlan(planInput(value.homeDir)), /mode 0600/);
    await chmod(value.authPath, 0o600);
    await writeFile(value.configPath, [
      `CLIPS_MCP_ENV_FILE=${value.authPath}`,
      "PROJECT_KINGS_SOURCE_BUFFER_EVIDENCE_PATH=../../outside.json"
    ].join("\n"));
    await assert.rejects(() => buildRefillerInstallPlan(planInput(value.homeDir)), /inside the Clips repository/);
    await assert.rejects(
      () => buildRefillerInstallPlan(planInput(value.homeDir, { platform: "linux" })),
      /macOS only/
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});

test("installer exposes manual commands but has no arm/load option", async () => {
  const value = await fixture();
  try {
    const plan = await buildRefillerInstallPlan(planInput(value.homeDir));
    assert.match(plan.manualArmCommand, /^launchctl bootstrap gui\/501 /);
    assert.equal(plan.manualStopCommand, `launchctl bootout gui/501/${REFILLER_LAUNCHD_LABEL}`);
    await assert.rejects(
      () => runRefillerInstaller(["--arm", "--home", value.homeDir], {
        platform: "darwin",
        uid: 501,
        nodeVersion: "22.10.0"
      }),
      /Unknown refiller installer argument/
    );
  } finally {
    await rm(value.homeDir, { recursive: true, force: true });
  }
});
