#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { hostname, homedir } from "node:os";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildLocalFirstChildEnvironment,
  normalizeLocalFirstMachineId
} from "../lib/local-first-contract";
import {
  acceptLocalFirstTransfer,
  acquireLocalFirstLock,
  collectLocalFirstRuntimeIdentity,
  createLocalFirstHandoff,
  getLocalFirstPaths,
  initializeLocalFirstState,
  migrateLocalFirstState,
  readLocalFirstManifest,
  recoverLocalFirstJobs,
  runLocalFirstPreflight
} from "../lib/local-first-state";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function getCommand(): string {
  return process.argv[2] ?? "help";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadLocalFirstEnvFile(): Promise<void> {
  const envFile =
    process.env.CLIPS_LOCAL_FIRST_ENV_FILE?.trim() ||
    path.join(homedir(), ".config", "clips", "local-first.env");
  if (!(await fileExists(envFile))) {
    return;
  }
  const raw = await fs.readFile(envFile, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
  }
}

function requireSetting(name: "CLIPS_MACHINE_ID" | "CLIPS_STATE_DIR"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. Put it in ~/.config/clips/local-first.env or export it for this command.`
    );
  }
  return value;
}

function resolveContext(): {
  machineId: string;
  stateDir: string;
  machineDir: string;
  port: number;
} {
  const machineId = normalizeLocalFirstMachineId(
    getArg("--machine") ?? requireSetting("CLIPS_MACHINE_ID")
  );
  const stateDir = path.resolve(
    getArg("--state-dir") ?? requireSetting("CLIPS_STATE_DIR")
  );
  const machineDir = path.resolve(
    getArg("--machine-dir") ??
      process.env.CLIPS_MACHINE_DIR?.trim() ??
      path.join(homedir(), ".config", "clips", "local-first", machineId)
  );
  const portValue = Number.parseInt(
    getArg("--port") ?? process.env.CLIPS_LOCAL_PORT ?? "3000",
    10
  );
  if (!Number.isFinite(portValue) || portValue < 1 || portValue > 65535) {
    throw new Error("CLIPS_LOCAL_PORT/--port must be a valid TCP port.");
  }
  return { machineId, stateDir, machineDir, port: portValue };
}

async function ensureDatabaseSchema(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(repoRoot, "scripts", "clips-local-first-schema.ts")
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_DATA_DIR: dataDir
      },
      stdio: "inherit"
    }
  );
  const code = await childExit(child);
  if (code !== 0) {
    throw new Error(`Database schema migration failed with exit code ${code}.`);
  }
}

async function initCommand(): Promise<void> {
  const context = resolveContext();
  const fromDataDir = getArg("--from-data");
  const manifest = await initializeLocalFirstState({
    repoRoot,
    stateDir: context.stateDir,
    machineId: context.machineId,
    fromDataDir
  });
  await ensureDatabaseSchema(getLocalFirstPaths(context.stateDir).dataDir);
  const migrated = await migrateLocalFirstState({
    repoRoot,
    stateDir: context.stateDir,
    machineId: context.machineId
  });
  console.log(
    JSON.stringify(
      {
        stateDir: context.stateDir,
        owner: migrated.manifest.owner,
        generation: migrated.manifest.generation,
        migratedHostJobs: migrated.migratedHostJobs,
        adoptedDataDir: fromDataDir ? path.resolve(fromDataDir) : null,
        initialGeneration: manifest.generation
      },
      null,
      2
    )
  );
}

async function migrateCommand(): Promise<void> {
  const context = resolveContext();
  await ensureDatabaseSchema(getLocalFirstPaths(context.stateDir).dataDir);
  const result = await migrateLocalFirstState({
    repoRoot,
    stateDir: context.stateDir,
    machineId: context.machineId
  });
  console.log(JSON.stringify(result, null, 2));
}

async function preflightCommand(requireBuild = !hasArg("--no-build")): Promise<void> {
  const context = resolveContext();
  const result = await runLocalFirstPreflight({
    repoRoot,
    stateDir: context.stateDir,
    machineId: context.machineId,
    requireBuild
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function recoverCommand(loop = false): Promise<void> {
  const context = resolveContext();
  do {
    try {
      const result = await recoverLocalFirstJobs({
        stateDir: context.stateDir,
        machineId: context.machineId,
        includeOrphanedRunning: true,
        forceOrphanedRunning: !loop && hasArg("--offline")
      });
      if (
        result.requeuedJobIds.length > 0 ||
        result.exhaustedJobIds.length > 0 ||
        result.removedCacheDirs.length > 0 ||
        !loop
      ) {
        console.log(JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2));
      }
    } catch (error) {
      if (!loop) {
        throw error;
      }
      console.error(
        `Local-first recovery pass failed and will retry: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (loop) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  } while (loop);
}

async function handoffCommand(): Promise<void> {
  const context = resolveContext();
  const toMachineId = getArg("--to");
  const outputDir = getArg("--out");
  if (!toMachineId || !outputDir) {
    throw new Error("Usage: local:first -- handoff --to <machine-id> --out <transfer-directory>");
  }
  const result = await createLocalFirstHandoff({
    stateDir: context.stateDir,
    machineId: context.machineId,
    toMachineId,
    outputDir
  });
  console.log(
    JSON.stringify(
      {
        transferDir: result.transferDir,
        handoffId: result.manifest.handoff?.id ?? null,
        target: result.manifest.handoff?.toMachineId ?? null,
        token: result.token,
        note: "The token is shown once. Transfer it separately from the state directory."
      },
      null,
      2
    )
  );
}

async function acceptCommand(): Promise<void> {
  const context = resolveContext();
  const transferDir = getArg("--from");
  const token = getArg("--token");
  if (!transferDir || !token) {
    throw new Error("Usage: local:first -- accept --from <transfer-directory> --token <token>");
  }
  const result = await acceptLocalFirstTransfer({
    repoRoot,
    stateDir: context.stateDir,
    machineId: context.machineId,
    transferDir,
    token
  });
  await ensureDatabaseSchema(getLocalFirstPaths(context.stateDir).dataDir);
  console.log(
    JSON.stringify(
      {
        stateDir: context.stateDir,
        owner: result.manifest.owner,
        generation: result.manifest.generation,
        backupDir: result.backupDir
      },
      null,
      2
    )
  );
}

function childExit(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  if (child.signalCode !== null) {
    return Promise.resolve(128);
  }
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 128 : 1));
    });
    child.once("error", () => resolve(1));
  });
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const exited = childExit(child).then(() => true);
  const timedOut = new Promise<false>((resolve) => {
    setTimeout(() => resolve(false), 10_000).unref();
  });
  if (!(await Promise.race([exited, timedOut]))) {
    child.kill("SIGKILL");
    await childExit(child);
  }
}

async function waitForLocalApi(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Local Clips API exited before becoming healthy.");
    }
    try {
      const response = await fetch(`${origin}/api/health`, {
        headers: { Accept: "application/json" }
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Local Clips API did not become healthy at ${origin}.`);
}

async function pairOwnedLocalWorker(input: {
  env: NodeJS.ProcessEnv;
  machineId: string;
  origin: string;
}): Promise<void> {
  Object.assign(process.env, input.env);
  const [{ getDb }, { issueStage3WorkerPairingToken }, { pairStage3Worker }] =
    await Promise.all([
      import("../lib/db/client"),
      import("../lib/stage3-worker-store"),
      import("../lib/stage3-worker-runtime")
    ]);
  const db = getDb();
  const ownerEmail = process.env.CLIPS_OWNER_EMAIL?.trim().toLowerCase() ?? null;
  const owners = db.prepare(
    `SELECT workspace_members.workspace_id, workspace_members.user_id, users.email
       FROM workspace_members
       JOIN users ON users.id = workspace_members.user_id
      WHERE workspace_members.role = 'owner'
        AND users.status = 'active'
        AND (? IS NULL OR lower(users.email) = ?)
      ORDER BY workspace_members.created_at ASC`
  ).all(ownerEmail, ownerEmail) as Array<{
    workspace_id: string;
    user_id: string;
    email: string;
  }>;
  if (owners.length !== 1) {
    throw new Error(
      owners.length === 0
        ? "No active owner exists in portable state. Set CLIPS_OWNER_EMAIL or complete one-time bootstrap."
        : "Multiple owners exist. Set CLIPS_OWNER_EMAIL to choose the local worker owner."
    );
  }
  const owner = owners[0];
  const stamp = new Date().toISOString();
  db.prepare(
    `UPDATE stage3_worker_tokens
        SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
      WHERE workspace_id = ?
        AND user_id = ?
        AND token_kind = 'session'
        AND revoked_at IS NULL`
  ).run(stamp, stamp, owner.workspace_id, owner.user_id);
  const issued = issueStage3WorkerPairingToken({
    workspaceId: owner.workspace_id,
    userId: owner.user_id
  });
  const config = await pairStage3Worker({
    server: input.origin,
    token: issued.token,
    label: `Local-first ${input.machineId} (${hostname()})`
  });
  console.log(`Paired local worker ${config.workerId} for ${owner.email}.`);
}

function spawnInherited(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): ChildProcess {
  return spawn(command, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit"
  });
}

async function superviseLocalFirst(input: {
  context: ReturnType<typeof resolveContext>;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const origin = `http://127.0.0.1:${input.context.port}`;
  const nextBin = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");
  const workerBundle = path.join(
    repoRoot,
    ".stage3-worker-runtime",
    "clips-stage3-worker.cjs"
  );
  let stopping = false;
  let api: ChildProcess | null = null;
  let worker: ChildProcess | null = null;
  let recovery: ChildProcess | null = null;
  const requestStop = (): void => {
    stopping = true;
    void Promise.all([stopChild(api), stopChild(worker), stopChild(recovery)]);
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  while (!stopping) {
    try {
      api = spawnInherited(
        process.execPath,
        [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(input.context.port)],
        input.env
      );
      await waitForLocalApi(origin, api);
      await pairOwnedLocalWorker({
        env: input.env,
        machineId: input.context.machineId,
        origin
      });
      worker = spawnInherited(process.execPath, [workerBundle, "start"], input.env);
      recovery = spawnInherited(
        process.execPath,
        [
          "--import",
          "tsx",
          scriptPath,
          "recovery-loop",
          "--machine",
          input.context.machineId,
          "--state-dir",
          input.context.stateDir,
          "--machine-dir",
          input.context.machineDir,
          "--port",
          String(input.context.port)
        ],
        input.env
      );
      const exited = await Promise.race([
        childExit(api).then((code) => ({ name: "api", code })),
        childExit(worker).then((code) => ({ name: "worker", code })),
        childExit(recovery).then((code) => ({ name: "recovery", code }))
      ]);
      if (!stopping) {
        console.error(
          `${exited.name} exited with code ${exited.code}; local-first supervisor will restart the stack.`
        );
      }
    } catch (error) {
      if (!stopping) {
        console.error(
          `Local-first stack failed and will restart: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    } finally {
      await Promise.all([stopChild(api), stopChild(worker), stopChild(recovery)]);
      api = null;
      worker = null;
      recovery = null;
    }
    if (!stopping) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

async function startCommand(): Promise<void> {
  const context = resolveContext();
  const preflight = await runLocalFirstPreflight({
    repoRoot,
    stateDir: context.stateDir,
    machineId: context.machineId,
    requireBuild: true
  });
  if (!preflight.ok) {
    console.error(JSON.stringify(preflight, null, 2));
    throw new Error("Local-first preflight failed; no API or worker was started.");
  }
  const manifest = await readLocalFirstManifest(context.stateDir);
  if (manifest.status !== "active" || manifest.owner?.machineId !== context.machineId) {
    throw new Error(`Portable state is not owned by ${context.machineId}.`);
  }
  const runtime = await collectLocalFirstRuntimeIdentity(repoRoot);
  const releaseLock = await acquireLocalFirstLock({
    stateDir: context.stateDir,
    machineId: context.machineId,
    runtime
  });
  await fs.mkdir(context.machineDir, { recursive: true });
  const env = buildLocalFirstChildEnvironment({
    base: process.env,
    stateDir: context.stateDir,
    machineDir: context.machineDir,
    port: context.port
  });
  try {
    await superviseLocalFirst({ context, env });
  } finally {
    await releaseLock();
  }
}

function printHelp(): void {
  console.log(`Clips local-first commands:
  init [--from-data <legacy APP_DATA_DIR>]
  migrate
  preflight [--no-build]
  start
  recover
  handoff --to <machine-id> --out <transfer-directory>
  accept --from <transfer-directory> --token <token>

Required settings:
  CLIPS_MACHINE_ID=mac-mini|macbook
  CLIPS_STATE_DIR=/absolute/path/to/portable-state

Optional local-only settings:
  CLIPS_MACHINE_DIR, CLIPS_OWNER_EMAIL, CLIPS_LOCAL_PORT,
  CLIPS_LOCAL_FIRST_ENV_FILE`);
}

async function main(): Promise<void> {
  await loadLocalFirstEnvFile();
  switch (getCommand()) {
    case "init":
      await initCommand();
      return;
    case "migrate":
      await migrateCommand();
      return;
    case "preflight":
      await preflightCommand();
      return;
    case "start":
      await startCommand();
      return;
    case "recover":
      await recoverCommand(false);
      return;
    case "recovery-loop":
      await recoverCommand(true);
      return;
    case "handoff":
      await handoffCommand();
      return;
    case "accept":
      await acceptCommand();
      return;
    default:
      printHelp();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
