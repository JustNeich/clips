#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const LAUNCHD_LABEL = "com.zoro.clips-project-kings-portfolio";
export const INSTALLER_TEMPLATE_RELATIVE_PATH =
  "support/launchd/com.zoro.clips-project-kings-portfolio.plist.tmpl";
export const DAEMON_RELATIVE_PATH = "scripts/run-project-kings-portfolio-daemon.mjs";
export const REQUIRED_CONFIG_RELATIVE_PATH = ".config/assistant/project-kings-portfolio.env";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderLaunchdTemplate(template, variables) {
  let rendered = String(template);
  for (const [name, value] of Object.entries(variables)) {
    rendered = rendered.replaceAll(`{{${name}}}`, xmlEscape(value));
  }
  const unresolved = [...rendered.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((match) => match[1]);
  if (unresolved.length > 0) {
    throw new Error(`Unresolved launchd template variables: ${[...new Set(unresolved)].join(", ")}`);
  }
  return rendered;
}

function parseArgs(argv) {
  const options = {
    action: "dry-run",
    replace: false,
    homeDir: os.homedir(),
    nodeBin: process.execPath,
    repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.action = "dry-run";
      continue;
    }
    if (argument === "--install") {
      options.action = "install";
      continue;
    }
    if (argument === "--replace") {
      options.replace = true;
      continue;
    }
    if (["--home", "--node", "--repo"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--home") options.homeDir = path.resolve(value);
      if (argument === "--node") options.nodeBin = path.resolve(value);
      if (argument === "--repo") options.repoRoot = path.resolve(value);
      continue;
    }
    throw new Error(`Unknown installer argument: ${argument}`);
  }
  return options;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function assertRegularFile(filePath, label) {
  let details;
  try {
    details = await stat(filePath);
  } catch {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  if (!details.isFile()) throw new Error(`${label} is not a regular file: ${filePath}`);
  return details;
}

async function assertPrivateEnvFile(filePath, label) {
  const details = await assertRegularFile(filePath, label);
  if ((details.mode & 0o777) !== 0o600) throw new Error(`${label} must have mode 0600.`);
  return readFile(filePath, "utf8");
}

function parseEnvReference(raw, key) {
  for (const sourceLine of String(raw).split(/\r?\n/)) {
    let line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const separator = line.indexOf("=");
    if (separator <= 0 || line.slice(0, separator).trim() !== key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

function expandHome(value, homeDir) {
  if (value === "~") return homeDir;
  if (value?.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return value;
}

async function validateRuntimeInputs(input) {
  if (input.platform !== "darwin") throw new Error("This installer supports macOS only.");
  if (input.uid === 0) throw new Error("Do not install this LaunchAgent as root.");
  const nodeDetails = await assertRegularFile(input.nodeBin, "Node binary");
  if ((nodeDetails.mode & 0o111) === 0) throw new Error("Node binary is not executable.");
  const nodeVersion = input.nodeVersion ?? process.versions.node;
  if (Number(nodeVersion.split(".")[0]) !== 22) {
    throw new Error(`Project Kings portfolio daemon requires Node 22; found ${nodeVersion}.`);
  }
  await assertRegularFile(path.join(input.repoRoot, DAEMON_RELATIVE_PATH), "Portfolio daemon entrypoint");
  await assertRegularFile(
    path.join(input.repoRoot, INSTALLER_TEMPLATE_RELATIVE_PATH),
    "Launchd source template"
  );
  const configPath = path.join(input.homeDir, REQUIRED_CONFIG_RELATIVE_PATH);
  const configRaw = await assertPrivateEnvFile(configPath, "Portfolio daemon config");
  const profileIds = (parseEnvReference(configRaw, "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (profileIds.length !== 3 || new Set(profileIds).size !== 3 || profileIds.some((entry) => entry.length > 64)) {
    throw new Error(
      "Portfolio daemon config must define exactly three unique PROJECT_KINGS_PORTFOLIO_PROFILE_IDS."
    );
  }
  const mode = parseEnvReference(configRaw, "PROJECT_KINGS_PORTFOLIO_MODE") ?? "shadow";
  const canaryPolicy = parseEnvReference(configRaw, "PROJECT_KINGS_PORTFOLIO_CANARY_POLICY") ??
    (mode === "live" ? "first_item_per_channel_public_verified" : "none");
  if (mode !== "shadow" && mode !== "live") {
    throw new Error("Portfolio daemon mode must be shadow or live.");
  }
  if (canaryPolicy !== "first_item_per_channel_public_verified" && canaryPolicy !== "none") {
    throw new Error("Portfolio daemon canary policy must be first_item_per_channel_public_verified or none.");
  }
  if (mode === "shadow" && canaryPolicy !== "none") {
    throw new Error("Shadow portfolio daemon always requires canary policy none.");
  }
  const authReference = parseEnvReference(configRaw, "CLIPS_MCP_ENV_FILE");
  if (!authReference) throw new Error("Portfolio daemon config must define CLIPS_MCP_ENV_FILE.");
  const authPath = path.resolve(expandHome(authReference, input.homeDir));
  const authRaw = await assertPrivateEnvFile(authPath, "Clips machine credential file");
  if (!parseEnvReference(authRaw, "CLIPS_MCP_TOKEN")) {
    throw new Error("Clips machine credential file does not contain CLIPS_MCP_TOKEN.");
  }
  const appUrl = parseEnvReference(authRaw, "CLIPS_APP_URL") ?? "https://clips-vy11.onrender.com";
  let parsedUrl;
  try {
    parsedUrl = new URL(appUrl);
  } catch {
    throw new Error("CLIPS_APP_URL in the machine credential file is invalid.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Launchd packaging requires an HTTPS CLIPS_APP_URL.");
  }
  return { configPath, configRaw, authPath, appOrigin: parsedUrl.origin };
}

export async function buildLaunchdInstallPlan(input = {}) {
  const repoRoot = path.resolve(
    input.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  );
  const homeDir = path.resolve(input.homeDir ?? os.homedir());
  const nodeBin = path.resolve(input.nodeBin ?? process.execPath);
  const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
  const logsDir = path.join(homeDir, "Library", "Logs", LAUNCHD_LABEL);
  const stateDir = path.join(homeDir, "Library", "Application Support", LAUNCHD_LABEL);
  const targetPath = path.join(launchAgentsDir, `${LAUNCHD_LABEL}.plist`);
  const templatePath = path.join(repoRoot, INSTALLER_TEMPLATE_RELATIVE_PATH);
  const validation = await validateRuntimeInputs({
    repoRoot,
    homeDir,
    nodeBin,
    platform: input.platform ?? process.platform,
    uid: input.uid ?? process.getuid?.(),
    nodeVersion: input.nodeVersion
  });
  const template = await readFile(templatePath, "utf8");
  const daemonSourcePath = path.join(repoRoot, DAEMON_RELATIVE_PATH);
  const daemonSource = await readFile(daemonSourcePath, "utf8");
  const daemonSha256 = sha256(daemonSource);
  const configSha256 = sha256(validation.configRaw);
  const releaseSha256 = sha256(JSON.stringify({
    schemaVersion: 1,
    daemonSha256,
    configSha256,
    nodeBin,
    templateSha256: sha256(template)
  }));
  const runtimeDir = path.join(stateDir, "releases", releaseSha256);
  const runtimePath = path.join(runtimeDir, "run-project-kings-portfolio-daemon.mjs");
  const rendered = renderLaunchdTemplate(template, {
    NODE_BIN: nodeBin,
    DAEMON_RUNTIME: runtimePath,
    RUNTIME_DIR: runtimeDir,
    USER_HOME: homeDir,
    CONFIG_SHA256: configSha256
  });
  if (/CLIPS_MCP_TOKEN|Bearer\s+/i.test(rendered)) {
    throw new Error("Rendered plist unexpectedly contains credential material.");
  }
  const targetExists = await fileExists(targetPath);
  const existing = targetExists ? await readFile(targetPath, "utf8") : null;
  return {
    label: LAUNCHD_LABEL,
    repoRoot,
    nodeBin,
    homeDir,
    templatePath,
    targetPath,
    configPath: validation.configPath,
    authPath: validation.authPath,
    appOrigin: validation.appOrigin,
    launchAgentsDir,
    logsDir,
    stateDir,
    runtimeDir,
    runtimePath,
    daemonSourcePath,
    daemonSource,
    daemonSha256,
    configSha256,
    releaseSha256,
    rendered,
    renderedSha256: sha256(rendered),
    targetExists,
    targetMatches: existing === rendered,
    targetSha256: existing === null ? null : sha256(existing),
    manualArmCommand: `launchctl bootstrap gui/${input.uid ?? process.getuid?.()} ${JSON.stringify(targetPath)}`,
    manualStopCommand: `launchctl bootout gui/${input.uid ?? process.getuid?.()}/${LAUNCHD_LABEL}`
  };
}

function timestampForBackup(now) {
  return now.toISOString().replace(/[:.]/g, "-");
}

export async function installLaunchdPlist(plan, input = {}) {
  if (plan.targetExists && !plan.targetMatches && !input.replace) {
    throw new Error("Installed LaunchAgent differs from the rendered source; pass --replace to preserve a backup and replace it.");
  }
  await mkdir(plan.runtimeDir, { recursive: true, mode: 0o700 });
  await chmod(plan.runtimeDir, 0o700);
  let runtimeChanged = false;
  if (await fileExists(plan.runtimePath)) {
    const currentRuntime = await readFile(plan.runtimePath, "utf8");
    if (sha256(currentRuntime) !== plan.daemonSha256) {
      throw new Error(`Pinned portfolio daemon runtime hash mismatch: ${plan.runtimePath}`);
    }
  } else {
    const temporaryRuntimePath = `${plan.runtimePath}.tmp-${process.pid}`;
    try {
      await writeFile(temporaryRuntimePath, plan.daemonSource, { mode: 0o600, flag: "wx" });
      await rename(temporaryRuntimePath, plan.runtimePath);
      await chmod(plan.runtimePath, 0o600);
      runtimeChanged = true;
    } catch (error) {
      await rm(temporaryRuntimePath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  if (plan.targetMatches) {
    return { changed: runtimeChanged, runtimeChanged, backupPath: null, targetPath: plan.targetPath };
  }
  const runCommand = input.runCommand ?? (async (command, args) => {
    const result = await execFileAsync(command, args, { timeout: 15_000 });
    return { stdout: result.stdout, stderr: result.stderr };
  });
  await mkdir(plan.launchAgentsDir, { recursive: true, mode: 0o755 });
  await mkdir(plan.logsDir, { recursive: true, mode: 0o700 });
  await chmod(plan.logsDir, 0o700);
  await mkdir(plan.stateDir, { recursive: true, mode: 0o700 });
  await chmod(plan.stateDir, 0o700);
  const temporaryPath = `${plan.targetPath}.tmp-${process.pid}`;
  const backupPath = plan.targetExists
    ? `${plan.targetPath}.backup-${timestampForBackup(input.now ?? new Date())}`
    : null;
  try {
    await writeFile(temporaryPath, plan.rendered, { mode: 0o600, flag: "wx" });
    await runCommand("plutil", ["-lint", temporaryPath]);
    if (backupPath) await copyFile(plan.targetPath, backupPath);
    await chmod(temporaryPath, 0o644);
    await rename(temporaryPath, plan.targetPath);
    await chmod(plan.targetPath, 0o644);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { changed: true, runtimeChanged, backupPath, targetPath: plan.targetPath };
}

function publicPlan(plan, action) {
  return {
    action,
    label: plan.label,
    targetPath: plan.targetPath,
    templatePath: plan.templatePath,
    configPath: plan.configPath,
    authPath: plan.authPath,
    appOrigin: plan.appOrigin,
    renderedSha256: plan.renderedSha256,
    daemonSha256: plan.daemonSha256,
    configSha256: plan.configSha256,
    releaseSha256: plan.releaseSha256,
    runtimePath: plan.runtimePath,
    targetExists: plan.targetExists,
    targetMatches: plan.targetMatches,
    targetSha256: plan.targetSha256,
    launchdLoaded: false,
    manualArmCommand: plan.manualArmCommand,
    manualStopCommand: plan.manualStopCommand
  };
}

export async function runInstaller(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const plan = await buildLaunchdInstallPlan({
    homeDir: options.homeDir,
    nodeBin: options.nodeBin,
    repoRoot: options.repoRoot,
    platform: dependencies.platform,
    uid: dependencies.uid,
    nodeVersion: dependencies.nodeVersion
  });
  if (options.action === "dry-run") {
    return { exitCode: 0, output: publicPlan(plan, "dry-run") };
  }
  const installed = await installLaunchdPlist(plan, {
    replace: options.replace,
    runCommand: dependencies.runCommand,
    now: dependencies.now
  });
  return {
    exitCode: 0,
    output: {
      ...publicPlan(plan, "install"),
      changed: installed.changed,
      runtimeChanged: installed.runtimeChanged,
      backupPath: installed.backupPath,
      launchdLoaded: false
    }
  };
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  runInstaller()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        action: "blocked",
        error: error instanceof Error ? error.message : String(error),
        launchdLoaded: false
      })}\n`);
      process.exitCode = 1;
    });
}
