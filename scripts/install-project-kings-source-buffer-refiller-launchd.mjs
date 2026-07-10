#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const REFILLER_LAUNCHD_LABEL = "com.zoro.clips-project-kings-source-buffer-refiller";
export const REFILLER_TEMPLATE_RELATIVE_PATH =
  "support/launchd/com.zoro.clips-project-kings-source-buffer-refiller.plist.tmpl";
export const REFILLER_ENTRYPOINT_RELATIVE_PATH = "scripts/run-project-kings-source-buffer-refiller.mjs";
export const REFILLER_CONFIG_RELATIVE_PATH = ".config/assistant/project-kings-source-buffer-refiller.env";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function refillerXmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderRefillerLaunchdTemplate(template, variables) {
  let rendered = String(template);
  for (const [name, value] of Object.entries(variables)) {
    rendered = rendered.replaceAll(`{{${name}}}`, refillerXmlEscape(value));
  }
  const unresolved = [...rendered.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((match) => match[1]);
  if (unresolved.length > 0) {
    throw new Error(`Unresolved refiller launchd variables: ${[...new Set(unresolved)].join(", ")}`);
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
    if (argument === "--dry-run") options.action = "dry-run";
    else if (argument === "--install") options.action = "install";
    else if (argument === "--replace") options.replace = true;
    else if (["--home", "--node", "--repo"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--home") options.homeDir = path.resolve(value);
      if (argument === "--node") options.nodeBin = path.resolve(value);
      if (argument === "--repo") options.repoRoot = path.resolve(value);
    } else {
      throw new Error(`Unknown refiller installer argument: ${argument}`);
    }
  }
  return options;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function regularFile(filePath, label) {
  const details = await stat(filePath).catch(() => null);
  if (!details?.isFile()) throw new Error(`${label} is missing: ${filePath}`);
  return details;
}

async function privateEnv(filePath, label) {
  const details = await regularFile(filePath, label);
  if ((details.mode & 0o777) !== 0o600) throw new Error(`${label} must have mode 0600.`);
  return readFile(filePath, "utf8");
}

function envValue(raw, key) {
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
    ) value = value.slice(1, -1);
    return value;
  }
  return null;
}

function expandHome(value, homeDir) {
  return value?.startsWith("~/") ? path.join(homeDir, value.slice(2)) : value;
}

async function validateInputs(input) {
  if (input.platform !== "darwin") throw new Error("This refiller installer supports macOS only.");
  if (input.uid === 0) throw new Error("Do not install this LaunchAgent as root.");
  const node = await regularFile(input.nodeBin, "Node binary");
  if ((node.mode & 0o111) === 0) throw new Error("Node binary is not executable.");
  const nodeVersion = input.nodeVersion ?? process.versions.node;
  if (Number(nodeVersion.split(".")[0]) !== 22) {
    throw new Error(`Source-buffer refiller requires Node 22; found ${nodeVersion}.`);
  }
  await regularFile(path.join(input.repoRoot, REFILLER_ENTRYPOINT_RELATIVE_PATH), "Refiller entrypoint");
  await regularFile(path.join(input.repoRoot, REFILLER_TEMPLATE_RELATIVE_PATH), "Refiller plist template");
  await regularFile(path.join(input.repoRoot, "scripts/sync-project-kings-source-buffer.mjs"), "Frozen sync script");
  const configPath = path.join(input.homeDir, REFILLER_CONFIG_RELATIVE_PATH);
  const configRaw = await privateEnv(configPath, "Source-buffer refiller config");
  const authReference = envValue(configRaw, "CLIPS_MCP_ENV_FILE");
  const evidenceReference = envValue(configRaw, "PROJECT_KINGS_SOURCE_BUFFER_EVIDENCE_PATH");
  if (!authReference) throw new Error("Refiller config must define CLIPS_MCP_ENV_FILE.");
  if (!evidenceReference) {
    throw new Error("Refiller config must define PROJECT_KINGS_SOURCE_BUFFER_EVIDENCE_PATH.");
  }
  const authPath = path.resolve(expandHome(authReference, input.homeDir));
  const authRaw = await privateEnv(authPath, "Clips machine credential file");
  if (!envValue(authRaw, "CLIPS_MCP_TOKEN")) throw new Error("Machine credential file has no token.");
  const appUrl = envValue(authRaw, "CLIPS_APP_URL") ?? "https://clips-vy11.onrender.com";
  let parsedUrl;
  try {
    parsedUrl = new URL(appUrl);
  } catch {
    throw new Error("CLIPS_APP_URL is invalid.");
  }
  if (parsedUrl.protocol !== "https:") throw new Error("Launchd packaging requires HTTPS CLIPS_APP_URL.");
  const evidencePath = path.resolve(input.repoRoot, evidenceReference);
  const boundary = path.relative(input.repoRoot, evidencePath);
  if (!boundary || boundary.startsWith("..") || path.isAbsolute(boundary)) {
    throw new Error("Frozen evidence path must stay inside the Clips repository.");
  }
  await regularFile(evidencePath, "Frozen source-buffer evidence");
  return { configPath, authPath, evidencePath, appOrigin: parsedUrl.origin };
}

export async function buildRefillerInstallPlan(input = {}) {
  const repoRoot = path.resolve(input.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const homeDir = path.resolve(input.homeDir ?? os.homedir());
  const nodeBin = path.resolve(input.nodeBin ?? process.execPath);
  const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
  const logsDir = path.join(homeDir, "Library", "Logs", REFILLER_LAUNCHD_LABEL);
  const stateDir = path.join(homeDir, "Library", "Application Support", REFILLER_LAUNCHD_LABEL);
  const targetPath = path.join(launchAgentsDir, `${REFILLER_LAUNCHD_LABEL}.plist`);
  const templatePath = path.join(repoRoot, REFILLER_TEMPLATE_RELATIVE_PATH);
  const validated = await validateInputs({
    repoRoot,
    homeDir,
    nodeBin,
    platform: input.platform ?? process.platform,
    uid: input.uid ?? process.getuid?.(),
    nodeVersion: input.nodeVersion
  });
  const rendered = renderRefillerLaunchdTemplate(await readFile(templatePath, "utf8"), {
    NODE_BIN: nodeBin,
    CLIPS_REPO: repoRoot,
    USER_HOME: homeDir
  });
  if (/CLIPS_MCP_TOKEN|Bearer\s+/i.test(rendered)) {
    throw new Error("Rendered refiller plist contains credential material.");
  }
  const targetExists = await exists(targetPath);
  const current = targetExists ? await readFile(targetPath, "utf8") : null;
  return {
    label: REFILLER_LAUNCHD_LABEL,
    repoRoot,
    homeDir,
    nodeBin,
    templatePath,
    targetPath,
    launchAgentsDir,
    logsDir,
    stateDir,
    ...validated,
    rendered,
    renderedSha256: sha256(rendered),
    targetExists,
    targetMatches: current === rendered,
    targetSha256: current === null ? null : sha256(current),
    manualArmCommand: `launchctl bootstrap gui/${input.uid ?? process.getuid?.()} ${JSON.stringify(targetPath)}`,
    manualStopCommand: `launchctl bootout gui/${input.uid ?? process.getuid?.()}/${REFILLER_LAUNCHD_LABEL}`
  };
}

export async function installRefillerPlist(plan, input = {}) {
  if (plan.targetExists && !plan.targetMatches && !input.replace) {
    throw new Error("Installed refiller plist has drift; pass --replace to preserve a backup and replace it.");
  }
  if (plan.targetMatches) return { changed: false, backupPath: null, targetPath: plan.targetPath };
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
    ? `${plan.targetPath}.backup-${(input.now ?? new Date()).toISOString().replace(/[:.]/g, "-")}`
    : null;
  try {
    await writeFile(temporaryPath, plan.rendered, { flag: "wx", mode: 0o600 });
    await runCommand("plutil", ["-lint", temporaryPath]);
    if (backupPath) await copyFile(plan.targetPath, backupPath);
    await chmod(temporaryPath, 0o644);
    await rename(temporaryPath, plan.targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { changed: true, backupPath, targetPath: plan.targetPath };
}

function publicPlan(plan, action) {
  return {
    action,
    label: plan.label,
    targetPath: plan.targetPath,
    templatePath: plan.templatePath,
    configPath: plan.configPath,
    authPath: plan.authPath,
    evidencePath: plan.evidencePath,
    appOrigin: plan.appOrigin,
    renderedSha256: plan.renderedSha256,
    targetExists: plan.targetExists,
    targetMatches: plan.targetMatches,
    launchdLoaded: false,
    manualArmCommand: plan.manualArmCommand,
    manualStopCommand: plan.manualStopCommand
  };
}

export async function runRefillerInstaller(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const plan = await buildRefillerInstallPlan({
    repoRoot: options.repoRoot,
    homeDir: options.homeDir,
    nodeBin: options.nodeBin,
    platform: dependencies.platform,
    uid: dependencies.uid,
    nodeVersion: dependencies.nodeVersion
  });
  if (options.action === "dry-run") return { exitCode: 0, output: publicPlan(plan, "dry-run") };
  const installed = await installRefillerPlist(plan, {
    replace: options.replace,
    runCommand: dependencies.runCommand,
    now: dependencies.now
  });
  return {
    exitCode: 0,
    output: {
      ...publicPlan(plan, "install"),
      changed: installed.changed,
      backupPath: installed.backupPath,
      launchdLoaded: false
    }
  };
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  runRefillerInstaller()
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
