import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import {
  LOCAL_FIRST_CONTRACT_VERSION,
  LOCAL_FIRST_MAX_RECOVERY_ATTEMPTS,
  LOCAL_FIRST_NODE_MAJOR,
  LOCAL_FIRST_RECREATABLE_DATA_DIRS,
  LOCAL_FIRST_STATE_SCHEMA_VERSION,
  acceptLocalFirstHandoff,
  beginLocalFirstHandoff,
  createLocalFirstManifest,
  isCorrectableLocalFirstFailure,
  normalizeLocalFirstMachineId,
  validateLocalFirstRuntime,
  type LocalFirstRuntimeIdentity,
  type LocalFirstStateManifest
} from "./local-first-contract";

const execFileAsync = promisify(execFile);
const MANIFEST_FILE = "manifest.json";
const LOCK_FILE = "active.lock";
const INVENTORY_FILE = "inventory.json";

type PortableInventoryEntry = {
  path: string;
  sizeBytes: number;
  sha256: string;
};

export type LocalFirstPaths = {
  root: string;
  controlDir: string;
  dataDir: string;
  manifestPath: string;
  lockPath: string;
};

export type LocalFirstPreflightCheck = {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
};

export type LocalFirstPreflightResult = {
  ok: boolean;
  checks: LocalFirstPreflightCheck[];
  runtime: LocalFirstRuntimeIdentity;
  manifest: LocalFirstStateManifest | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return randomUUID().replaceAll("-", "");
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { present?: number } | undefined;
  return row?.present === 1;
}

function parseNodeMajor(version = process.versions.node): number {
  const parsed = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    for await (const chunk of handle.readableWebStream()) {
      hash.update(Buffer.from(chunk));
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  return hash.digest("hex");
}

export function getLocalFirstPaths(stateDir: string): LocalFirstPaths {
  const root = path.resolve(stateDir);
  const controlDir = path.join(root, "control");
  return {
    root,
    controlDir,
    dataDir: path.join(root, "data"),
    manifestPath: path.join(controlDir, MANIFEST_FILE),
    lockPath: path.join(controlDir, LOCK_FILE)
  };
}

export async function collectLocalFirstRuntimeIdentity(
  repoRoot: string,
  nodeVersion = process.versions.node
): Promise<LocalFirstRuntimeIdentity> {
  const [{ stdout }, lockfile] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }),
    fs.readFile(path.join(repoRoot, "package-lock.json"))
  ]);
  return {
    gitRevision: stdout.trim(),
    lockfileSha256: sha256(lockfile),
    nodeMajor: parseNodeMajor(nodeVersion)
  };
}

export async function isLocalFirstRepoDirty(repoRoot: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot });
  return Boolean(stdout.trim());
}

export async function readLocalFirstManifest(stateDir: string): Promise<LocalFirstStateManifest> {
  const raw = await fs.readFile(getLocalFirstPaths(stateDir).manifestPath, "utf8");
  return JSON.parse(raw) as LocalFirstStateManifest;
}

export async function writeLocalFirstManifest(
  stateDir: string,
  manifest: LocalFirstStateManifest
): Promise<void> {
  const paths = getLocalFirstPaths(stateDir);
  await fs.mkdir(paths.controlDir, { recursive: true });
  const tempPath = `${paths.manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await fs.rename(tempPath, paths.manifestPath);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function inspectLocalFirstLock(stateDir: string): Promise<{
  exists: boolean;
  live: boolean;
  pid: number | null;
  machineId: string | null;
}> {
  const { lockPath } = getLocalFirstPaths(stateDir);
  try {
    const parsed = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
      pid?: number;
      machineId?: string;
    };
    const pid = Number.isInteger(parsed.pid) ? parsed.pid as number : null;
    return {
      exists: true,
      live: pid !== null && isPidAlive(pid),
      pid,
      machineId: typeof parsed.machineId === "string" ? parsed.machineId : null
    };
  } catch {
    return {
      exists: await pathExists(lockPath),
      live: false,
      pid: null,
      machineId: null
    };
  }
}

export async function acquireLocalFirstLock(input: {
  stateDir: string;
  machineId: string;
  runtime: LocalFirstRuntimeIdentity;
}): Promise<() => Promise<void>> {
  const machineId = normalizeLocalFirstMachineId(input.machineId);
  const paths = getLocalFirstPaths(input.stateDir);
  await fs.mkdir(paths.controlDir, { recursive: true });
  const existing = await inspectLocalFirstLock(input.stateDir);
  if (existing.live) {
    throw new Error(
      `Local-first state is already active on ${existing.machineId ?? "another machine"} (pid ${existing.pid}).`
    );
  }
  if (existing.exists) {
    await fs.rm(paths.lockPath, { force: true });
  }
  const payload = {
    pid: process.pid,
    machineId,
    gitRevision: input.runtime.gitRevision,
    startedAt: nowIso()
  };
  const handle = await fs.open(paths.lockPath, "wx", 0o600);
  await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`);
  await handle.close();
  return async () => {
    const current = await inspectLocalFirstLock(input.stateDir);
    if (current.pid === process.pid && current.machineId === machineId) {
      await fs.rm(paths.lockPath, { force: true });
    }
  };
}

async function commandVersion(command: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync(command, args, { timeout: 8_000 });
    return (result.stdout || result.stderr).trim().split(/\r?\n/)[0] ?? "available";
  } catch {
    return null;
  }
}

function addCheck(
  checks: LocalFirstPreflightCheck[],
  name: string,
  status: LocalFirstPreflightCheck["status"],
  detail: string
): void {
  checks.push({ name, status, detail });
}

function inspectPortableDatabase(dbPath: string): {
  integrity: string;
  activeHostJobs: number;
  activeLocalRenders: number;
  hostDefaultWorkspaces: number;
  activeOwners: number;
} {
  if (!path.isAbsolute(dbPath)) {
    throw new Error("Database path must be absolute.");
  }
  const db = new DatabaseSync(dbPath);
  try {
    const integrityRow = db.prepare("PRAGMA quick_check").get() as Record<string, unknown>;
    const integrity = String(Object.values(integrityRow)[0] ?? "unknown");
    const activeHostJobs = tableExists(db, "stage3_jobs")
      ? Number(
          (
            db.prepare(
              "SELECT COUNT(*) AS count FROM stage3_jobs WHERE execution_target = 'host' AND status IN ('queued', 'running')"
            ).get() as { count?: number }
          ).count ?? 0
        )
      : 0;
    const activeLocalRenders = tableExists(db, "stage3_jobs")
      ? Number(
          (
            db.prepare(
              "SELECT COUNT(*) AS count FROM stage3_jobs WHERE execution_target = 'local' AND kind = 'render' AND status = 'running'"
            ).get() as { count?: number }
          ).count ?? 0
        )
      : 0;
    const hostDefaultWorkspaces = tableExists(db, "workspaces")
      ? Number(
          (
            db.prepare(
              "SELECT COUNT(*) AS count FROM workspaces WHERE stage3_execution_target = 'host'"
            ).get() as { count?: number }
          ).count ?? 0
        )
      : 0;
    const activeOwners =
      tableExists(db, "workspace_members") && tableExists(db, "users")
        ? Number(
            (
              db.prepare(
                `SELECT COUNT(*) AS count
                   FROM workspace_members
                   JOIN users ON users.id = workspace_members.user_id
                  WHERE workspace_members.role = 'owner'
                    AND users.status = 'active'`
              ).get() as { count?: number }
            ).count ?? 0
          )
        : 0;
    return {
      integrity,
      activeHostJobs,
      activeLocalRenders,
      hostDefaultWorkspaces,
      activeOwners
    };
  } finally {
    db.close();
  }
}

export async function runLocalFirstPreflight(input: {
  repoRoot: string;
  stateDir: string;
  machineId: string;
  requireBuild?: boolean;
}): Promise<LocalFirstPreflightResult> {
  const checks: LocalFirstPreflightCheck[] = [];
  const machineId = normalizeLocalFirstMachineId(input.machineId);
  const runtime = await collectLocalFirstRuntimeIdentity(input.repoRoot);
  let manifest: LocalFirstStateManifest | null = null;
  try {
    manifest = await readLocalFirstManifest(input.stateDir);
    addCheck(checks, "portable-state", "ok", getLocalFirstPaths(input.stateDir).root);
  } catch (error) {
    addCheck(
      checks,
      "portable-state",
      "fail",
      error instanceof Error ? error.message : String(error)
    );
  }

  if (manifest) {
    for (const issue of validateLocalFirstRuntime(manifest, runtime)) {
      addCheck(checks, issue.code, "fail", issue.message);
    }
    const ownsState = manifest.status === "active" && manifest.owner?.machineId === machineId;
    addCheck(
      checks,
      "ownership",
      ownsState ? "ok" : "fail",
      ownsState
        ? `${machineId} owns epoch ${manifest.owner?.epoch}.`
        : `State status=${manifest.status}, owner=${manifest.owner?.machineId ?? "none"}.`
    );
  }

  addCheck(
    checks,
    "node",
    runtime.nodeMajor === LOCAL_FIRST_NODE_MAJOR ? "ok" : "fail",
    `Node ${process.versions.node}; required major ${LOCAL_FIRST_NODE_MAJOR}.`
  );
  addCheck(
    checks,
    "repo-clean",
    (await isLocalFirstRepoDirty(input.repoRoot)) ? "fail" : "ok",
    "Runtime must come from an exact clean Git revision."
  );

  const requiredCommands: Array<[string, string[]]> = [
    ["ffmpeg", ["-version"]],
    ["ffprobe", ["-version"]],
    ["yt-dlp", ["--version"]]
  ];
  for (const [command, args] of requiredCommands) {
    const version = await commandVersion(command, args);
    addCheck(
      checks,
      command,
      version ? "ok" : "fail",
      version ?? `${command} is required for the local worker.`
    );
  }

  if (input.requireBuild !== false) {
    for (const [name, filePath] of [
      ["next-build", path.join(input.repoRoot, ".next", "BUILD_ID")],
      [
        "worker-runtime",
        path.join(input.repoRoot, ".stage3-worker-runtime", "manifest.json")
      ]
    ]) {
      addCheck(
        checks,
        name,
        (await pathExists(filePath)) ? "ok" : "fail",
        filePath
      );
    }
  }

  const dbPath = path.join(getLocalFirstPaths(input.stateDir).dataDir, "app.db");
  if (await pathExists(dbPath)) {
    try {
      const db = inspectPortableDatabase(dbPath);
      addCheck(
        checks,
        "sqlite",
        db.integrity === "ok" ? "ok" : "fail",
        `quick_check=${db.integrity}`
      );
      addCheck(
        checks,
        "render-control-plane",
        db.activeHostJobs === 0 && db.hostDefaultWorkspaces === 0 ? "ok" : "fail",
        `active host jobs=${db.activeHostJobs}, host-default workspaces=${db.hostDefaultWorkspaces}`
      );
      addCheck(
        checks,
        "worker-owner",
        db.activeOwners > 0 ? "ok" : "fail",
        db.activeOwners > 0
          ? `active owners=${db.activeOwners}`
          : "Portable state has no active owner for automatic local worker pairing."
      );
      addCheck(
        checks,
        "serial-render-gate",
        db.activeLocalRenders <= 1 ? "ok" : "fail",
        `running local renders=${db.activeLocalRenders}, limit=1`
      );
    } catch (error) {
      addCheck(
        checks,
        "sqlite",
        "fail",
        error instanceof Error ? error.message : String(error)
      );
    }
  } else {
    addCheck(checks, "sqlite", "fail", `${dbPath} does not exist.`);
  }

  const lock = await inspectLocalFirstLock(input.stateDir);
  addCheck(
    checks,
    "active-process",
    lock.live ? "fail" : "ok",
    lock.live
      ? `State is already active on ${lock.machineId ?? "unknown"} (pid ${lock.pid}).`
      : "No competing active-machine process."
  );
  addCheck(
    checks,
    "render-external",
    "ok",
    "Render credentials and network health are intentionally not checked."
  );
  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
    runtime,
    manifest
  };
}

function checkpointDatabase(dataDir: string): void {
  const dbPath = path.join(dataDir, "app.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 15000");
    const integrityRow = db.prepare("PRAGMA quick_check").get() as Record<string, unknown>;
    const integrity = String(Object.values(integrityRow)[0] ?? "unknown");
    if (integrity !== "ok") {
      throw new Error(`SQLite quick_check failed: ${integrity}`);
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

export async function initializeLocalFirstState(input: {
  repoRoot: string;
  stateDir: string;
  machineId: string;
  fromDataDir?: string | null;
}): Promise<LocalFirstStateManifest> {
  const runtime = await collectLocalFirstRuntimeIdentity(input.repoRoot);
  if (runtime.nodeMajor !== LOCAL_FIRST_NODE_MAJOR) {
    throw new Error(`Node ${LOCAL_FIRST_NODE_MAJOR} is required to initialize portable state.`);
  }
  if (await isLocalFirstRepoDirty(input.repoRoot)) {
    throw new Error("Portable state must be initialized from a clean Git checkout.");
  }
  const paths = getLocalFirstPaths(input.stateDir);
  if (await pathExists(paths.manifestPath)) {
    throw new Error(`Local-first state already exists at ${paths.root}.`);
  }
  await fs.mkdir(paths.dataDir, { recursive: true });
  if (input.fromDataDir) {
    checkpointDatabase(path.resolve(input.fromDataDir));
    await copyPortableTree(path.resolve(input.fromDataDir), paths.dataDir);
    relocatePortableDatabase(paths.dataDir, path.resolve(input.fromDataDir), paths.dataDir, true);
  }
  const manifest = createLocalFirstManifest({
    machineId: input.machineId,
    runtime
  });
  await writeLocalFirstManifest(paths.root, manifest);
  return manifest;
}

export async function migrateLocalFirstState(input: {
  repoRoot: string;
  stateDir: string;
  machineId: string;
}): Promise<{ manifest: LocalFirstStateManifest; migratedHostJobs: number }> {
  const machineId = normalizeLocalFirstMachineId(input.machineId);
  const paths = getLocalFirstPaths(input.stateDir);
  const manifest = await readLocalFirstManifest(paths.root);
  if (manifest.status !== "active" || manifest.owner?.machineId !== machineId) {
    throw new Error(`State is not actively owned by ${machineId}.`);
  }
  const lock = await inspectLocalFirstLock(paths.root);
  if (lock.live) {
    throw new Error("Stop local:first start before migrating portable state.");
  }
  const runtime = await collectLocalFirstRuntimeIdentity(input.repoRoot);
  if (runtime.nodeMajor !== LOCAL_FIRST_NODE_MAJOR) {
    throw new Error(`Node ${LOCAL_FIRST_NODE_MAJOR} is required to migrate portable state.`);
  }
  if (await isLocalFirstRepoDirty(input.repoRoot)) {
    throw new Error("Portable state migration requires a clean Git checkout.");
  }
  const dbPath = path.join(paths.dataDir, "app.db");
  const db = new DatabaseSync(dbPath);
  let migratedHostJobs = 0;
  try {
    db.exec("PRAGMA busy_timeout = 15000");
    const runningHostJobs = Number(
      (
        db.prepare(
          "SELECT COUNT(*) AS count FROM stage3_jobs WHERE execution_target = 'host' AND status = 'running'"
        ).get() as { count?: number }
      ).count ?? 0
    );
    if (runningHostJobs > 0) {
      throw new Error(`Refusing migration while ${runningHostJobs} hosted jobs are running.`);
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const update = db.prepare(
        `UPDATE stage3_jobs
            SET execution_target = 'local',
                assigned_worker_id = NULL,
                lease_expires_at = NULL,
                heartbeat_at = NULL,
                updated_at = ?
          WHERE execution_target = 'host'
            AND status IN ('queued', 'failed', 'interrupted')`
      ).run(nowIso());
      migratedHostJobs = Number(update.changes ?? 0);
      db.prepare(
        "UPDATE workspaces SET stage3_execution_target = 'local', updated_at = ? WHERE stage3_execution_target IS NULL OR stage3_execution_target <> 'local'"
      ).run(nowIso());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  const updated: LocalFirstStateManifest = {
    ...manifest,
    contractVersion: LOCAL_FIRST_CONTRACT_VERSION,
    stateSchemaVersion: LOCAL_FIRST_STATE_SCHEMA_VERSION,
    generation: manifest.generation + 1,
    runtime,
    updatedAt: nowIso()
  };
  await writeLocalFirstManifest(paths.root, updated);
  return { manifest: updated, migratedHostJobs };
}

async function cleanupCorrectableCaches(dataDir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const name of LOCAL_FIRST_RECREATABLE_DATA_DIRS) {
    const target = path.join(dataDir, name);
    try {
      await fs.rm(target, { recursive: true, force: true });
      removed.push(target);
    } catch {
      // The next recovery pass will retry after the local filesystem is healthy.
    }
  }
  return removed;
}

export async function recoverLocalFirstJobs(input: {
  stateDir: string;
  machineId: string;
  includeOrphanedRunning?: boolean;
  forceOrphanedRunning?: boolean;
}): Promise<{
  requeuedJobIds: string[];
  exhaustedJobIds: string[];
  removedCacheDirs: string[];
}> {
  const machineId = normalizeLocalFirstMachineId(input.machineId);
  const paths = getLocalFirstPaths(input.stateDir);
  const manifest = await readLocalFirstManifest(paths.root);
  if (manifest.status !== "active" || manifest.owner?.machineId !== machineId) {
    throw new Error(`State is not actively owned by ${machineId}.`);
  }
  if (input.forceOrphanedRunning) {
    const lock = await inspectLocalFirstLock(paths.root);
    if (lock.live) {
      throw new Error("Forced offline recovery requires local:first start to be stopped.");
    }
  }
  const db = new DatabaseSync(path.join(paths.dataDir, "app.db"));
  const requeuedJobIds: string[] = [];
  const exhaustedJobIds: string[] = [];
  let needsCacheCleanup = false;
  try {
    db.exec("PRAGMA busy_timeout = 15000");
    const stamp = nowIso();
    const runningPredicate = input.forceOrphanedRunning
      ? "status = 'running'"
      : `status = 'running'
              AND lease_expires_at IS NOT NULL
              AND lease_expires_at <= ?`;
    const candidates = db.prepare(
      `SELECT id, status, error_code, error_message, attempts, attempt_limit, lease_expires_at
         FROM stage3_jobs
        WHERE execution_target = 'local'
          AND (
            (status IN ('failed', 'interrupted') AND recoverable = 1)
            OR (${runningPredicate})
          )
        ORDER BY updated_at ASC, created_at ASC`
    ).all(...(input.forceOrphanedRunning ? [] : [stamp])) as Array<{
      id: string;
      status: string;
      error_code: string | null;
      error_message: string | null;
      attempts: number;
      attempt_limit: number;
      lease_expires_at: string | null;
    }>;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of candidates) {
        const orphaned =
          row.status === "running" &&
          (input.forceOrphanedRunning === true ||
            (row.lease_expires_at !== null && row.lease_expires_at <= stamp));
        if (orphaned && input.includeOrphanedRunning === false) {
          continue;
        }
        const errorCode = orphaned ? "worker_unavailable" : row.error_code;
        const errorMessage = orphaned
          ? "Expired local worker lease recovered by local-first agent."
          : row.error_message;
        if (
          !orphaned &&
          !isCorrectableLocalFirstFailure({
            errorCode,
            errorMessage
          })
        ) {
          continue;
        }
        const recovery = db.prepare(
          "SELECT recovery_count FROM local_first_job_recovery WHERE job_id = ?"
        ).get(row.id) as { recovery_count?: number } | undefined;
        const recoveryCount = Number(recovery?.recovery_count ?? 0);
        if (recoveryCount >= LOCAL_FIRST_MAX_RECOVERY_ATTEMPTS) {
          exhaustedJobIds.push(row.id);
          continue;
        }
        const nextRecoveryCount = recoveryCount + 1;
        const update = db.prepare(
          `UPDATE stage3_jobs
              SET status = 'queued',
                  attempts = 0,
                  attempt_limit = CASE WHEN attempt_limit < 3 THEN 3 ELSE attempt_limit END,
                  attempt_group = ?,
                  error_code = NULL,
                  error_message = NULL,
                  completed_at = NULL,
                  assigned_worker_id = NULL,
                  lease_expires_at = NULL,
                  heartbeat_at = NULL,
                  updated_at = ?
            WHERE id = ?
              AND execution_target = 'local'
              AND status = ?`
        ).run(
          `local-first-recovery-${nextRecoveryCount}`,
          stamp,
          row.id,
          row.status
        );
        if (Number(update.changes ?? 0) === 0) {
          continue;
        }
        db.prepare(
          `INSERT INTO local_first_job_recovery
            (job_id, recovery_count, last_error_code, last_recovered_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             recovery_count = excluded.recovery_count,
             last_error_code = excluded.last_error_code,
             last_recovered_at = excluded.last_recovered_at,
             updated_at = excluded.updated_at`
        ).run(row.id, nextRecoveryCount, errorCode, stamp, stamp);
        db.prepare(
          `INSERT INTO stage3_job_events
            (id, job_id, level, message, payload_json, created_at)
           VALUES (?, ?, 'warn', ?, ?, ?)`
        ).run(
          newId(),
          row.id,
          "Local-first recovery agent returned a correctable job to the local queue.",
          JSON.stringify({
            previousStatus: row.status,
            previousErrorCode: errorCode,
            recoveryCount: nextRecoveryCount,
            machineId
          }),
          stamp
        );
        requeuedJobIds.push(row.id);
        if (errorCode === "artifact_storage_full" || /\benospc\b/i.test(errorMessage ?? "")) {
          needsCacheCleanup = true;
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
  const removedCacheDirs = needsCacheCleanup
    ? await cleanupCorrectableCaches(paths.dataDir)
    : [];
  return { requeuedJobIds, exhaustedJobIds, removedCacheDirs };
}

async function copyPortableTree(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (LOCAL_FIRST_RECREATABLE_DATA_DIRS.has(entry.name)) {
      continue;
    }
    if (
      entry.name.endsWith(".downloading") ||
      entry.name.endsWith(".uploading") ||
      entry.name.endsWith(".tmp") ||
      entry.name === ".DS_Store"
    ) {
      continue;
    }
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Portable state must not contain symlinks: ${sourcePath}`);
    }
    if (entry.isDirectory()) {
      await copyPortableTree(sourcePath, destinationPath);
      continue;
    }
    if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

function relocatePortableDatabase(
  dataDir: string,
  sourceDataRoot: string,
  targetDataRoot: string,
  sanitizeMachineState: boolean
): void {
  const dbPath = path.join(dataDir, "app.db");
  if (!path.isAbsolute(sourceDataRoot) || !path.isAbsolute(targetDataRoot)) {
    throw new Error("Portable data roots must be absolute.");
  }
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (tableExists(db, "stage3_job_artifacts")) {
        db.prepare(
          `UPDATE stage3_job_artifacts
              SET file_path = ? || substr(file_path, ?)
            WHERE file_path = ? OR file_path LIKE ?`
        ).run(
          targetDataRoot,
          sourceDataRoot.length + 1,
          sourceDataRoot,
          `${sourceDataRoot}${path.sep}%`
        );
      }
      if (tableExists(db, "render_exports")) {
        db.prepare(
          `UPDATE render_exports
              SET artifact_file_path = ? || substr(artifact_file_path, ?)
            WHERE artifact_file_path = ? OR artifact_file_path LIKE ?`
        ).run(
          targetDataRoot,
          sourceDataRoot.length + 1,
          sourceDataRoot,
          `${sourceDataRoot}${path.sep}%`
        );
      }
      if (sanitizeMachineState) {
        if (tableExists(db, "stage3_worker_tokens")) {
          db.exec("DELETE FROM stage3_worker_tokens");
        }
        if (tableExists(db, "stage3_workers")) {
          db.prepare(
            "UPDATE stage3_workers SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?"
          ).run(nowIso(), nowIso());
        }
        if (tableExists(db, "workspace_codex_integrations")) {
          db.prepare(
            `UPDATE workspace_codex_integrations
                SET status = 'disconnected',
                    codex_session_id = NULL,
                    codex_home_path = NULL,
                    login_status_text = NULL,
                    device_auth_status = NULL,
                    device_auth_output = NULL,
                    device_auth_login_url = NULL,
                    device_auth_user_code = NULL,
                    connected_at = NULL,
                    updated_at = ?`
          ).run(nowIso());
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

function assertNoActiveWork(dataDir: string): void {
  const db = new DatabaseSync(path.join(dataDir, "app.db"));
  try {
    const active: string[] = [];
    for (const [table, statuses] of [
      ["stage3_jobs", ["running"]],
      ["source_jobs", ["running"]],
      ["stage2_runs", ["running"]],
      ["channel_style_discovery_runs", ["running"]],
      ["channel_publications", ["uploading"]]
    ] as Array<[string, string[]]>) {
      if (!tableExists(db, table)) {
        continue;
      }
      const placeholders = statuses.map(() => "?").join(", ");
      const count = Number(
        (
          db.prepare(
            `SELECT COUNT(*) AS count FROM ${table} WHERE status IN (${placeholders})`
          ).get(...statuses) as { count?: number }
        ).count ?? 0
      );
      if (count > 0) {
        active.push(`${table}=${count}`);
      }
    }
    if (active.length > 0) {
      throw new Error(
        `Handoff requires a quiescent queue. Finish or recover active work first: ${active.join(", ")}.`
      );
    }
  } finally {
    db.close();
  }
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const current = path.join(root, relative);
  const files: string[] = [];
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const childRelative = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Transfer contains a symlink: ${childRelative}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, childRelative));
    } else if (entry.isFile() && childRelative !== INVENTORY_FILE) {
      files.push(childRelative);
    }
  }
  return files.sort();
}

async function buildInventory(root: string): Promise<PortableInventoryEntry[]> {
  return Promise.all(
    (await listFiles(root)).map(async (relativePath) => {
      const filePath = path.join(root, relativePath);
      const stat = await fs.stat(filePath);
      return {
        path: relativePath,
        sizeBytes: stat.size,
        sha256: await sha256File(filePath)
      };
    })
  );
}

async function verifyInventory(root: string): Promise<void> {
  const expected = JSON.parse(
    await fs.readFile(path.join(root, INVENTORY_FILE), "utf8")
  ) as PortableInventoryEntry[];
  const actual = await buildInventory(root);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Portable transfer inventory checksum verification failed.");
  }
}

export async function createLocalFirstHandoff(input: {
  stateDir: string;
  machineId: string;
  toMachineId: string;
  outputDir: string;
}): Promise<{ transferDir: string; token: string; manifest: LocalFirstStateManifest }> {
  const paths = getLocalFirstPaths(input.stateDir);
  const outputDir = path.resolve(input.outputDir);
  if (await pathExists(outputDir)) {
    throw new Error(`Transfer destination already exists: ${outputDir}`);
  }
  const lock = await inspectLocalFirstLock(paths.root);
  if (lock.live) {
    throw new Error("Stop local:first start before handing off portable state.");
  }
  await recoverLocalFirstJobs({
    stateDir: paths.root,
    machineId: input.machineId,
    includeOrphanedRunning: true,
    forceOrphanedRunning: true
  });
  assertNoActiveWork(paths.dataDir);
  checkpointDatabase(paths.dataDir);
  const manifest = await readLocalFirstManifest(paths.root);
  const handoff = beginLocalFirstHandoff({
    manifest,
    machineId: input.machineId,
    toMachineId: input.toMachineId,
    dataRoot: paths.dataDir
  });
  const tempDir = `${outputDir}.preparing-${randomUUID()}`;
  try {
    await fs.mkdir(path.join(tempDir, "control"), { recursive: true });
    await copyPortableTree(paths.dataDir, path.join(tempDir, "data"));
    relocatePortableDatabase(
      path.join(tempDir, "data"),
      paths.dataDir,
      paths.dataDir,
      true
    );
    await fs.writeFile(
      path.join(tempDir, "control", MANIFEST_FILE),
      `${JSON.stringify(handoff.transferManifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    const inventory = await buildInventory(tempDir);
    await fs.writeFile(
      path.join(tempDir, INVENTORY_FILE),
      `${JSON.stringify(inventory, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    await writeLocalFirstManifest(paths.root, handoff.sourceManifest);
    try {
      await fs.rename(tempDir, outputDir);
    } catch (error) {
      await writeLocalFirstManifest(paths.root, manifest);
      throw error;
    }
    return {
      transferDir: outputDir,
      token: handoff.token,
      manifest: handoff.sourceManifest
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function acceptLocalFirstTransfer(input: {
  repoRoot: string;
  stateDir: string;
  machineId: string;
  transferDir: string;
  token: string;
}): Promise<{ manifest: LocalFirstStateManifest; backupDir: string | null }> {
  const transferDir = path.resolve(input.transferDir);
  await verifyInventory(transferDir);
  const transferManifest = JSON.parse(
    await fs.readFile(path.join(transferDir, "control", MANIFEST_FILE), "utf8")
  ) as LocalFirstStateManifest;
  const runtime = await collectLocalFirstRuntimeIdentity(input.repoRoot);
  const accepted = acceptLocalFirstHandoff({
    manifest: transferManifest,
    machineId: input.machineId,
    token: input.token,
    runtime
  });
  const target = getLocalFirstPaths(input.stateDir);
  const lock = await inspectLocalFirstLock(target.root);
  if (lock.live) {
    throw new Error("Stop local:first start before accepting a handoff.");
  }
  let existingManifest: LocalFirstStateManifest | null = null;
  if (await pathExists(target.manifestPath)) {
    existingManifest = await readLocalFirstManifest(target.root);
    if (existingManifest.status === "active") {
      throw new Error(
        `Refusing to replace active state owned by ${existingManifest.owner?.machineId ?? "unknown"}.`
      );
    }
  }
  const parentDir = path.dirname(target.root);
  const tempStateDir = path.join(parentDir, `.${path.basename(target.root)}.accepting-${randomUUID()}`);
  const backupDir = existingManifest
    ? `${target.root}.backup-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`
    : null;
  await fs.mkdir(path.join(tempStateDir, "control"), { recursive: true });
  try {
    await copyPortableTree(path.join(transferDir, "data"), path.join(tempStateDir, "data"));
    relocatePortableDatabase(
      path.join(tempStateDir, "data"),
      transferManifest.handoff?.sourceDataRoot ?? path.join(transferDir, "data"),
      target.dataDir,
      true
    );
    await fs.writeFile(
      path.join(tempStateDir, "control", MANIFEST_FILE),
      `${JSON.stringify(accepted, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    if (backupDir) {
      await fs.rename(target.root, backupDir);
    }
    try {
      await fs.rename(tempStateDir, target.root);
    } catch (error) {
      if (backupDir) {
        await fs.rename(backupDir, target.root).catch(() => undefined);
      }
      throw error;
    }
    return { manifest: accepted, backupDir };
  } catch (error) {
    await fs.rm(tempStateDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
