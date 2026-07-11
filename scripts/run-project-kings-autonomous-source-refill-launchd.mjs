#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
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

export const AUTONOMOUS_REFILL_LAUNCHD_LABEL =
  "com.zoro.clips-project-kings-source-buffer-refiller";
export const AUTONOMOUS_REFILL_ENTRYPOINT_RELATIVE_PATH =
  "scripts/run-project-kings-autonomous-source-refill.mts";
export const AUTONOMOUS_REFILL_CONFIG_RELATIVE_PATH =
  ".config/assistant/project-kings-source-buffer-refiller.env";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), AUTONOMOUS_REFILL_CONFIG_RELATIVE_PATH);
function redacted(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(cookie|token|authorization)=?[^\s,;]*/gi, "$1=[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

export function parseAutonomousRefillEnv(raw) {
  const output = {};
  for (const sourceLine of String(raw).split(/\r?\n/)) {
    let line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("Autonomous refill config contains a malformed line.");
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new Error("Autonomous refill config contains an invalid key.");
    }
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}

function expandHome(value, homeDir) {
  if (value === "~") return homeDir;
  return value.startsWith("~/") ? path.join(homeDir, value.slice(2)) : value;
}

async function privateConfig(filePath) {
  const details = await stat(filePath).catch(() => null);
  if (!details?.isFile()) throw new Error(`Autonomous refill config is missing: ${filePath}`);
  if ((details.mode & 0o777) !== 0o600) {
    throw new Error("Autonomous refill config must have mode 0600.");
  }
  return parseAutonomousRefillEnv(await readFile(filePath, "utf8"));
}

function mode(value) {
  const resolved = value?.trim() || "dry_run";
  if (!["dry_run", "shadow", "execute"].includes(resolved)) {
    throw new Error("PROJECT_KINGS_AUTONOMOUS_REFILL_MODE must be dry_run, shadow or execute.");
  }
  return resolved;
}

export async function buildAutonomousRefillLaunchdRunPlan(input = {}) {
  const homeDir = path.resolve(input.homeDir ?? os.homedir());
  const repoRoot = path.resolve(input.repoRoot ?? REPO_ROOT);
  const configPath = path.resolve(
    expandHome(input.configPath ?? DEFAULT_CONFIG_PATH, homeDir)
  );
  const env = await privateConfig(configPath);
  const armed = env.PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED === "1";
  const configuredMode = mode(env.PROJECT_KINGS_AUTONOMOUS_REFILL_MODE);
  const expectedStateDir = path.join(
    homeDir,
    "Library",
    "Application Support",
    AUTONOMOUS_REFILL_LAUNCHD_LABEL
  );
  const stateDir = path.resolve(expandHome(
    env.PROJECT_KINGS_SOURCE_BUFFER_REFILLER_STATE_DIR ?? expectedStateDir,
    homeDir
  ));
  if (stateDir !== expectedStateDir) {
    throw new Error(
      `PROJECT_KINGS_SOURCE_BUFFER_REFILLER_STATE_DIR must be the stable path ${expectedStateDir}.`
    );
  }
  const plan = {
    schemaVersion: "project-kings-autonomous-refill-launchd-plan-v1",
    repoRoot,
    homeDir,
    configPath,
    stateDir,
    lockDir: path.join(stateDir, "autonomous-refill.lock"),
    statusPath: path.join(stateDir, "last-launchd-run.json"),
    armed,
    mode: configuredMode,
    childArgs: [
      "--import",
      "tsx",
      path.join(repoRoot, AUTONOMOUS_REFILL_ENTRYPOINT_RELATIVE_PATH),
      "--config",
      configPath,
      "--mode",
      configuredMode,
      ...(configuredMode === "execute" ? ["--allow-upload"] : [])
    ],
    childEnv: null
  };
  if (!armed) return plan;
  if (Number((input.nodeVersion ?? process.versions.node).split(".")[0]) !== 22) {
    throw new Error("Autonomous refill launchd runtime requires Node 22.");
  }
  if (configuredMode === "execute" && env.PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED !== "1") {
    throw new Error("Execute refill requires PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED=1.");
  }
  const codexBinRaw = env.CODEX_BIN?.trim();
  const codexHomeRaw = env.CODEX_HOME?.trim();
  const manifestRaw = env.PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH?.trim();
  if (!codexBinRaw || !codexHomeRaw || !manifestRaw || !env.CLIPS_MCP_ENV_FILE?.trim()) {
    throw new Error(
      "Armed autonomous refill requires CODEX_BIN, CODEX_HOME, PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH and CLIPS_MCP_ENV_FILE."
    );
  }
  const codexBin = path.resolve(expandHome(codexBinRaw, homeDir));
  const codexHome = path.resolve(expandHome(codexHomeRaw, homeDir));
  const manifestPath = path.isAbsolute(manifestRaw)
    ? path.resolve(manifestRaw)
    : path.resolve(repoRoot, manifestRaw);
  await Promise.all([
    access(codexBin, fsConstants.X_OK),
    access(codexHome, fsConstants.R_OK),
    access(manifestPath, fsConstants.R_OK),
    access(path.join(repoRoot, AUTONOMOUS_REFILL_ENTRYPOINT_RELATIVE_PATH), fsConstants.R_OK)
  ]);
  return {
    ...plan,
    codexBin,
    codexHome,
    manifestPath,
    childEnv: {
      ...process.env,
      CODEX_BIN: codexBin,
      CODEX_HOME: codexHome
    }
  };
}

async function atomicWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filePath), 0o700);
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx"
  });
  await rename(temporaryPath, filePath);
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function acquireAutonomousRefillLock(input) {
  const owner = {
    schemaVersion: "project-kings-autonomous-refill-lock-v1",
    pid: input.pid ?? process.pid,
    nonce: input.nonce ?? randomUUID(),
    acquiredAt: (input.now ?? new Date()).toISOString()
  };
  const processAlive = input.processAlive ?? defaultProcessAlive;
  await mkdir(path.dirname(input.lockDir), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let created = false;
    try {
      await mkdir(input.lockDir, { mode: 0o700 });
      created = true;
      await writeFile(
        path.join(input.lockDir, "owner.json"),
        `${JSON.stringify(owner, null, 2)}\n`,
        { mode: 0o600, flag: "wx" }
      );
      return {
        acquired: true,
        owner,
        release: async () => {
          const current = JSON.parse(
            await readFile(path.join(input.lockDir, "owner.json"), "utf8")
          );
          if (current.nonce !== owner.nonce || current.pid !== owner.pid) {
            throw new Error("Autonomous refill lock ownership changed before release.");
          }
          await rm(input.lockDir, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (created) {
        await rm(input.lockDir, { recursive: true, force: true }).catch(() => undefined);
      }
      if (error?.code !== "EEXIST") throw error;
      const current = await readFile(path.join(input.lockDir, "owner.json"), "utf8")
        .then((raw) => JSON.parse(raw))
        .catch(() => null);
      if (!Number.isInteger(current?.pid) || current.pid <= 0 || !current.nonce) {
        return { acquired: false, owner: current, release: async () => undefined };
      }
      if (await processAlive(current.pid)) {
        return { acquired: false, owner: current, release: async () => undefined };
      }
      const stalePath = `${input.lockDir}.stale-${owner.pid}-${owner.nonce}`;
      try {
        await rename(input.lockDir, stalePath);
      } catch (renameError) {
        if (renameError?.code === "ENOENT") continue;
        throw renameError;
      }
      await rm(stalePath, { recursive: true, force: true });
    }
  }
  return { acquired: false, owner: null, release: async () => undefined };
}

function defaultRunChild(input) {
  return execFileAsync(process.execPath, input.args, {
    cwd: input.cwd,
    env: input.env,
    timeout: 6 * 60 * 60_000,
    maxBuffer: 16 * 1024 * 1024
  }).then(({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }));
}

function supportsRequiredCodexVersion(raw) {
  const match = String(raw).match(/\b(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number);
  return major > 0 || minor > 144 || (minor === 144 && patch >= 1);
}

async function defaultRuntimePreflight(plan) {
  const version = await execFileAsync(plan.codexBin, ["--version"], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    env: plan.childEnv
  });
  if (!supportsRequiredCodexVersion(`${version.stdout}\n${version.stderr}`)) {
    throw new Error("Autonomous refill requires Codex CLI 0.144.1 or newer for gpt-5.6-luna.");
  }
  const login = await execFileAsync(plan.codexBin, ["login", "status"], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    env: plan.childEnv
  });
  const loginText = `${login.stdout}\n${login.stderr}`.toLowerCase();
  if (!loginText.includes("logged in") || loginText.includes("not logged in")) {
    throw new Error("Autonomous refill requires an authenticated Codex CLI.");
  }
}

export async function runAutonomousRefillLaunchd(input = {}) {
  const startedAt = (input.now ?? new Date()).toISOString();
  const plan = await buildAutonomousRefillLaunchdRunPlan(input);
  if (!plan.armed) {
    const result = {
      schemaVersion: "project-kings-autonomous-refill-launchd-result-v1",
      status: "disabled",
      mode: plan.mode,
      startedAt,
      finishedAt: (input.finishedAt ?? new Date()).toISOString()
    };
    await (input.writeStatus ?? atomicWrite)(plan.statusPath, result);
    return result;
  }
  const lock = await (input.acquireLock ?? acquireAutonomousRefillLock)({
    lockDir: plan.lockDir,
    now: input.now,
    pid: input.pid,
    processAlive: input.processAlive
  });
  if (!lock.acquired) {
    const result = {
      schemaVersion: "project-kings-autonomous-refill-launchd-result-v1",
      status: "skipped_overlap",
      mode: plan.mode,
      startedAt,
      finishedAt: (input.finishedAt ?? new Date()).toISOString(),
      activePid: Number.isInteger(lock.owner?.pid) ? lock.owner.pid : null
    };
    await (input.writeStatus ?? atomicWrite)(plan.statusPath, result);
    return result;
  }
  try {
    await (input.runtimePreflight ?? defaultRuntimePreflight)(plan);
    const child = await (input.runChild ?? defaultRunChild)({
      args: plan.childArgs,
      cwd: plan.repoRoot,
      env: plan.childEnv
    });
    if (child.exitCode !== 0) {
      throw new Error(`Autonomous refill child exited ${child.exitCode}: ${child.stderr || child.stdout}`);
    }
    const result = {
      schemaVersion: "project-kings-autonomous-refill-launchd-result-v1",
      status: "completed",
      mode: plan.mode,
      startedAt,
      finishedAt: (input.finishedAt ?? new Date()).toISOString()
    };
    await (input.writeStatus ?? atomicWrite)(plan.statusPath, result);
    return result;
  } catch (error) {
    const result = {
      schemaVersion: "project-kings-autonomous-refill-launchd-result-v1",
      status: "blocked",
      mode: plan.mode,
      startedAt,
      finishedAt: (input.finishedAt ?? new Date()).toISOString(),
      error: redacted(error)
    };
    await (input.writeStatus ?? atomicWrite)(plan.statusPath, result);
    throw Object.assign(new Error(result.error), { result });
  } finally {
    await lock.release();
  }
}

const isEntrypoint = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const configIndex = process.argv.indexOf("--config");
  const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : undefined;
  runAutonomousRefillLaunchd({ configPath })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify(
        error?.result ?? {
          schemaVersion: "project-kings-autonomous-refill-launchd-result-v1",
          status: "blocked",
          error: redacted(error)
        },
        null,
        2
      )}\n`);
      process.exitCode = 1;
    });
}
