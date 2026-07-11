#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
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
export const REFILLER_ENTRYPOINT_RELATIVE_PATH =
  "scripts/run-project-kings-autonomous-source-refill-launchd.mjs";
export const REFILLER_AUTONOMOUS_ENTRYPOINT_RELATIVE_PATH =
  "scripts/run-project-kings-autonomous-source-refill.mts";
export const REFILLER_CONFIG_RELATIVE_PATH =
  ".config/assistant/project-kings-source-buffer-refiller.env";
export const REFILLER_ROUTE_MANIFEST_ID = "project-kings-model-routes-v4";
export const REFILLER_ROUTE_MANIFEST_SHA256 =
  "13e867148fdda8c138421218fcc1ebf23cfc06b649c1321ed319e20238f456e5";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function refillerXmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderRefillerLaunchdTemplate(template, variables) {
  let rendered = String(template);
  for (const [name, value] of Object.entries(variables)) {
    rendered = rendered.replaceAll(`{{${name}}}`, refillerXmlEscape(value));
  }
  const unresolved = [...rendered.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)]
    .map((match) => match[1]);
  if (unresolved.length > 0) {
    throw new Error(`Unresolved refiller launchd variables: ${[...new Set(unresolved)].join(", ")}`);
  }
  return rendered;
}

function parseArgs(argv) {
  const options = {
    action: "dry-run",
    replace: false,
    rollbackPath: null,
    homeDir: os.homedir(),
    nodeBin: process.execPath,
    repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  };
  const actions = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--dry-run", "--install", "--arm", "--uninstall"].includes(argument)) {
      const action = argument.slice(2);
      actions.push(action);
      options.action = action;
    } else if (argument === "--rollback") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--rollback requires a backup plist path.");
      index += 1;
      actions.push("rollback");
      options.action = "rollback";
      options.rollbackPath = path.resolve(value);
    } else if (argument === "--replace") {
      options.replace = true;
    } else if (["--home", "--node", "--repo"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--home") options.homeDir = path.resolve(value);
      if (argument === "--node") options.nodeBin = path.resolve(value);
      if (argument === "--repo") options.repoRoot = path.resolve(value);
    } else {
      throw new Error(`Unknown refiller installer argument: ${argument}`);
    }
  }
  if (new Set(actions).size > 1) throw new Error("Choose exactly one refiller installer action.");
  return options;
}

async function exists(filePath) {
  return stat(filePath).then(() => true, (error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
}

async function regularFile(filePath, label, executable = false) {
  const details = await lstat(filePath).catch(() => null);
  if (!details?.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  }
  if (executable && (details.mode & 0o111) === 0) {
    throw new Error(`${label} is not executable: ${filePath}`);
  }
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
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) value = value.slice(1, -1);
    return value;
  }
  return null;
}

function expandHome(value, homeDir) {
  if (value === "~") return homeDir;
  return value?.startsWith("~/") ? path.join(homeDir, value.slice(2)) : value;
}

function insideRepo(repoRoot, configuredPath, label) {
  const resolved = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(repoRoot, configuredPath);
  const boundary = path.relative(repoRoot, resolved);
  if (!boundary || boundary.startsWith("..") || path.isAbsolute(boundary)) {
    throw new Error(`${label} must resolve inside the Clips repository.`);
  }
  return resolved;
}

function staticPaths(input) {
  const homeDir = path.resolve(input.homeDir);
  const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
  const logsDir = path.join(homeDir, "Library", "Logs", REFILLER_LAUNCHD_LABEL);
  const stateDir = path.join(
    homeDir,
    "Library",
    "Application Support",
    REFILLER_LAUNCHD_LABEL
  );
  return {
    label: REFILLER_LAUNCHD_LABEL,
    homeDir,
    launchAgentsDir,
    logsDir,
    stateDir,
    targetPath: path.join(launchAgentsDir, `${REFILLER_LAUNCHD_LABEL}.plist`),
    domain: `gui/${input.uid}`
  };
}

async function validateInputs(input) {
  if (input.platform !== "darwin") throw new Error("This refiller installer supports macOS only.");
  if (!Number.isInteger(input.uid) || input.uid <= 0) {
    throw new Error("Do not install this LaunchAgent as root or without a user UID.");
  }
  await regularFile(input.nodeBin, "Node binary", true);
  const nodeVersion = input.nodeVersion ?? process.versions.node;
  if (Number(nodeVersion.replace(/^v/, "").split(".")[0]) !== 22) {
    throw new Error(`Autonomous source refill requires Node 22; found ${nodeVersion}.`);
  }
  await Promise.all([
    regularFile(path.join(input.repoRoot, REFILLER_ENTRYPOINT_RELATIVE_PATH), "Autonomous launchd supervisor"),
    regularFile(
      path.join(input.repoRoot, REFILLER_AUTONOMOUS_ENTRYPOINT_RELATIVE_PATH),
      "Autonomous one-shot entrypoint"
    ),
    regularFile(path.join(input.repoRoot, REFILLER_TEMPLATE_RELATIVE_PATH), "Refiller plist template")
  ]);
  const configPath = path.join(input.homeDir, REFILLER_CONFIG_RELATIVE_PATH);
  const configRaw = await privateEnv(configPath, "Autonomous refiller config");
  const armedValue = envValue(configRaw, "PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED") ?? "0";
  if (!["0", "1"].includes(armedValue)) {
    throw new Error("PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED must be exactly 0 or 1.");
  }
  const mode = envValue(configRaw, "PROJECT_KINGS_AUTONOMOUS_REFILL_MODE") ?? "dry_run";
  if (!["dry_run", "shadow", "execute"].includes(mode)) {
    throw new Error("PROJECT_KINGS_AUTONOMOUS_REFILL_MODE must be dry_run, shadow or execute.");
  }
  const uploadArmed = envValue(configRaw, "PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED") === "1";
  if (mode === "execute" && armedValue === "1" && !uploadArmed) {
    throw new Error("Armed execute mode requires PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED=1.");
  }
  const authReference = envValue(configRaw, "CLIPS_MCP_ENV_FILE");
  const manifestReference = envValue(configRaw, "PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH");
  const codexBinReference = envValue(configRaw, "CODEX_BIN");
  const codexHomeReference = envValue(configRaw, "CODEX_HOME");
  if (!authReference || !manifestReference || !codexBinReference || !codexHomeReference) {
    throw new Error(
      "Autonomous refiller config requires CLIPS_MCP_ENV_FILE, PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH, CODEX_BIN and CODEX_HOME."
    );
  }
  const authPath = path.resolve(expandHome(authReference, input.homeDir));
  const authRaw = await privateEnv(authPath, "Clips machine credential file");
  if (!envValue(authRaw, "CLIPS_MCP_TOKEN")) {
    throw new Error("Machine credential file has no token.");
  }
  const appUrl = envValue(authRaw, "CLIPS_APP_URL") ?? "https://clips-vy11.onrender.com";
  let parsedUrl;
  try {
    parsedUrl = new URL(appUrl);
  } catch {
    throw new Error("CLIPS_APP_URL is invalid.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Launchd autonomous refill requires HTTPS CLIPS_APP_URL.");
  }
  const manifestPath = insideRepo(input.repoRoot, manifestReference, "Route manifest path");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const unsignedManifest = { ...manifest };
  delete unsignedManifest.manifestSha256;
  if (
    manifest.schemaVersion !== 3 ||
    manifest.manifestId !== REFILLER_ROUTE_MANIFEST_ID ||
    manifest.manifestSha256 !== REFILLER_ROUTE_MANIFEST_SHA256 ||
    sha256(JSON.stringify(canonicalize(unsignedManifest))) !== manifest.manifestSha256
  ) {
    throw new Error("Autonomous refill requires the exact frozen Project Kings v4 route manifest.");
  }
  const configuredCodexBin = path.resolve(expandHome(codexBinReference, input.homeDir));
  const codexBin = await realpath(configuredCodexBin).catch(() => configuredCodexBin);
  const codexHome = path.resolve(expandHome(codexHomeReference, input.homeDir));
  await regularFile(codexBin, "Codex binary", true);
  const codexHomeStat = await stat(codexHome).catch(() => null);
  if (!codexHomeStat?.isDirectory()) throw new Error(`CODEX_HOME is missing: ${codexHome}`);
  const configuredStateDir = envValue(configRaw, "PROJECT_KINGS_SOURCE_BUFFER_REFILLER_STATE_DIR");
  const stateDir = configuredStateDir
    ? path.resolve(expandHome(configuredStateDir, input.homeDir))
    : staticPaths(input).stateDir;
  if (stateDir !== staticPaths(input).stateDir) {
    throw new Error(
      `PROJECT_KINGS_SOURCE_BUFFER_REFILLER_STATE_DIR must be the stable path ${staticPaths(input).stateDir}.`
    );
  }
  return {
    configPath,
    authPath,
    manifestPath,
    codexBin,
    codexHome,
    appOrigin: parsedUrl.origin,
    armed: armedValue === "1",
    mode,
    uploadArmed,
    configuredStateDir: stateDir
  };
}

export async function buildRefillerInstallPlan(input = {}) {
  const repoRoot = path.resolve(
    input.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  );
  const homeDir = path.resolve(input.homeDir ?? os.homedir());
  const nodeBin = await realpath(path.resolve(input.nodeBin ?? process.execPath));
  const uid = input.uid ?? process.getuid?.();
  const paths = staticPaths({ homeDir, uid });
  const validated = await validateInputs({
    repoRoot,
    homeDir,
    nodeBin,
    platform: input.platform ?? process.platform,
    uid,
    nodeVersion: input.nodeVersion
  });
  const templatePath = path.join(repoRoot, REFILLER_TEMPLATE_RELATIVE_PATH);
  const rendered = renderRefillerLaunchdTemplate(await readFile(templatePath, "utf8"), {
    NODE_BIN: nodeBin,
    CLIPS_REPO: repoRoot,
    USER_HOME: homeDir
  });
  if (/CLIPS_MCP_TOKEN|Bearer\s+/i.test(rendered)) {
    throw new Error("Rendered refiller plist contains credential material.");
  }
  const targetExists = await exists(paths.targetPath);
  const current = targetExists ? await readFile(paths.targetPath, "utf8") : null;
  const installerPath = path.join(repoRoot, "scripts/install-project-kings-source-buffer-refiller-launchd.mjs");
  return {
    schemaVersion: "project-kings-autonomous-refill-install-plan-v1",
    ...paths,
    ...validated,
    repoRoot,
    nodeBin,
    templatePath,
    rendered,
    renderedSha256: sha256(rendered),
    targetExists,
    targetMatches: current === rendered,
    targetSha256: current === null ? null : sha256(current),
    manualArmCommand:
      `${JSON.stringify(nodeBin)} ${JSON.stringify(installerPath)} --arm ` +
      `--home ${JSON.stringify(homeDir)} --repo ${JSON.stringify(repoRoot)} --node ${JSON.stringify(nodeBin)}`,
    manualStopCommand: `${JSON.stringify(nodeBin)} ${JSON.stringify(installerPath)} --uninstall --home ${JSON.stringify(homeDir)}`
  };
}

export async function installRefillerPlist(plan, input = {}) {
  if (plan.targetExists && !plan.targetMatches && !input.replace) {
    throw new Error("Installed refiller plist has drift; pass --replace to preserve a backup and replace it.");
  }
  const runCommand = input.runCommand ?? defaultRunCommand;
  await Promise.all([
    mkdir(plan.launchAgentsDir, { recursive: true, mode: 0o755 }),
    mkdir(plan.logsDir, { recursive: true, mode: 0o700 }),
    mkdir(plan.stateDir, { recursive: true, mode: 0o700 }),
    mkdir(plan.configuredStateDir, { recursive: true, mode: 0o700 })
  ]);
  await Promise.all([
    chmod(plan.logsDir, 0o700),
    chmod(plan.stateDir, 0o700),
    chmod(plan.configuredStateDir, 0o700)
  ]);
  if (plan.targetMatches) return { changed: false, backupPath: null, targetPath: plan.targetPath };
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

async function defaultRunCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    ...options
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function serviceMissing(error) {
  return /Could not find service|No such process|service.*not found|code 113/i.test(
    `${error?.message ?? ""} ${error?.stderr ?? ""}`
  );
}

async function bootout(plan, runCommand) {
  try {
    await runCommand("launchctl", ["bootout", `${plan.domain}/${plan.label}`]);
  } catch (error) {
    if (!serviceMissing(error)) throw error;
  }
}

function supportsRequiredCodexVersion(raw) {
  const match = String(raw).match(/\b(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major > 0 || minor > 144 || (minor === 144 && patch >= 1);
}

export async function armRefiller(plan, input = {}) {
  if (!plan.targetExists || !plan.targetMatches) {
    throw new Error("Arm requires the exact installed autonomous refill plist.");
  }
  if (!plan.armed) {
    throw new Error("Set PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED=1 before --arm.");
  }
  if (plan.mode === "execute" && !plan.uploadArmed) {
    throw new Error("Execute arm requires PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED=1.");
  }
  const runCommand = input.runCommand ?? defaultRunCommand;
  const nodeVersion = await runCommand(plan.nodeBin, ["--version"]);
  if (!/^v?22\./.test(String(nodeVersion.stdout).trim())) {
    throw new Error("Arm preflight requires the selected Node binary to report v22.");
  }
  const codexVersion = await runCommand(plan.codexBin, ["--version"], {
    env: { ...process.env, CODEX_HOME: plan.codexHome }
  });
  if (!supportsRequiredCodexVersion(`${codexVersion.stdout ?? ""}\n${codexVersion.stderr ?? ""}`)) {
    throw new Error("Arm preflight requires Codex CLI 0.144.1 or newer for gpt-5.6-luna.");
  }
  const login = await runCommand(plan.codexBin, ["login", "status"], {
    env: { ...process.env, CODEX_HOME: plan.codexHome }
  });
  const loginText = `${login.stdout ?? ""}\n${login.stderr ?? ""}`.toLowerCase();
  if (!loginText.includes("logged in") || loginText.includes("not logged in")) {
    throw new Error("Arm preflight requires an authenticated Codex CLI in configured CODEX_HOME.");
  }
  await bootout(plan, runCommand);
  await runCommand("launchctl", ["bootstrap", plan.domain, plan.targetPath]);
  return { launchdLoaded: true, mode: plan.mode, targetPath: plan.targetPath };
}

function recoveryPlan(input) {
  const uid = input.uid ?? process.getuid?.();
  if (input.platform !== "darwin") throw new Error("This refiller installer supports macOS only.");
  if (!Number.isInteger(uid) || uid <= 0) throw new Error("Recovery requires a non-root user UID.");
  return staticPaths({ homeDir: path.resolve(input.homeDir ?? os.homedir()), uid });
}

export async function uninstallRefiller(plan, input = {}) {
  const runCommand = input.runCommand ?? defaultRunCommand;
  await bootout(plan, runCommand);
  if (!(await exists(plan.targetPath))) {
    return { changed: false, backupPath: null, launchdLoaded: false };
  }
  const backupPath = `${plan.targetPath}.uninstall-backup-${
    (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-")
  }`;
  await copyFile(plan.targetPath, backupPath);
  await rm(plan.targetPath);
  return { changed: true, backupPath, launchdLoaded: false };
}

function validatedRollbackPath(plan, backupPath) {
  const resolved = path.resolve(backupPath);
  const relative = path.relative(plan.launchAgentsDir, resolved);
  const prefix = `${plan.label}.plist.`;
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.dirname(relative) !== "." ||
    !path.basename(relative).startsWith(prefix) ||
    !path.basename(relative).includes("backup-")
  ) {
    throw new Error("Rollback backup must be a refiller plist backup inside LaunchAgents.");
  }
  return resolved;
}

export async function rollbackRefiller(plan, backupPath, input = {}) {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const sourcePath = validatedRollbackPath(plan, backupPath);
  await regularFile(sourcePath, "Rollback plist backup");
  await runCommand("plutil", ["-lint", sourcePath]);
  await bootout(plan, runCommand);
  await mkdir(plan.launchAgentsDir, { recursive: true, mode: 0o755 });
  const displacedPath = (await exists(plan.targetPath))
    ? `${plan.targetPath}.pre-rollback-backup-${
        (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-")
      }`
    : null;
  if (displacedPath) await copyFile(plan.targetPath, displacedPath);
  const temporaryPath = `${plan.targetPath}.rollback-${process.pid}`;
  await copyFile(sourcePath, temporaryPath);
  await chmod(temporaryPath, 0o644);
  await rename(temporaryPath, plan.targetPath);
  return {
    changed: true,
    restoredFrom: sourcePath,
    displacedPath,
    launchdLoaded: false
  };
}

function publicPlan(plan, action) {
  return {
    action,
    schemaVersion: plan.schemaVersion,
    label: plan.label,
    targetPath: plan.targetPath,
    templatePath: plan.templatePath,
    configPath: plan.configPath,
    authPath: plan.authPath,
    manifestPath: plan.manifestPath,
    codexBin: plan.codexBin,
    codexHome: plan.codexHome,
    appOrigin: plan.appOrigin,
    mode: plan.mode,
    armed: plan.armed,
    uploadArmed: plan.uploadArmed,
    stateDir: plan.configuredStateDir,
    logsDir: plan.logsDir,
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
  const platform = dependencies.platform ?? process.platform;
  const uid = dependencies.uid ?? process.getuid?.();
  if (options.action === "uninstall" || options.action === "rollback") {
    const plan = recoveryPlan({ homeDir: options.homeDir, platform, uid });
    if (options.action === "uninstall") {
      const result = await uninstallRefiller(plan, {
        runCommand: dependencies.runCommand,
        now: dependencies.now
      });
      return { exitCode: 0, output: { action: "uninstall", ...plan, ...result } };
    }
    const result = await rollbackRefiller(plan, options.rollbackPath, {
      runCommand: dependencies.runCommand,
      now: dependencies.now
    });
    return { exitCode: 0, output: { action: "rollback", ...plan, ...result } };
  }
  const plan = await buildRefillerInstallPlan({
    repoRoot: options.repoRoot,
    homeDir: options.homeDir,
    nodeBin: options.nodeBin,
    platform,
    uid,
    nodeVersion: dependencies.nodeVersion
  });
  if (options.action === "dry-run") {
    return { exitCode: 0, output: publicPlan(plan, "dry-run") };
  }
  if (options.action === "install") {
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
        backupPath: installed.backupPath
      }
    };
  }
  const armed = await armRefiller(plan, { runCommand: dependencies.runCommand });
  return {
    exitCode: 0,
    output: { ...publicPlan(plan, "arm"), ...armed }
  };
}

const isEntrypoint = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
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
