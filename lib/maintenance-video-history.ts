import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppDataDir } from "./app-paths";
import { getDb, runInTransaction } from "./db/client";

type ClearVideoHistoryOptions = {
  dryRun?: boolean;
  resetWorkers?: boolean;
  removeLegacyJson?: boolean;
};

type RowPlanItem = {
  label: string;
  table: string;
  where: string;
};

type PathSummary = {
  path: string;
  exists: boolean;
  files: number;
  bytes: number;
};

function tableExists(tableName: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function columnExists(tableName: string, columnName: string): boolean {
  if (!tableExists(tableName)) {
    return false;
  }
  const db = getDb();
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === columnName);
}

function whereFromColumns(tableName: string, candidates: Array<{ column: string; sql: string }>): string {
  const clauses = candidates
    .filter((candidate) => columnExists(tableName, candidate.column))
    .map((candidate) => candidate.sql);
  return clauses.length ? `WHERE ${clauses.join(" OR ")}` : "WHERE 0 = 1";
}

function countRows(tableName: string, where = ""): number {
  if (!tableExists(tableName)) {
    return 0;
  }
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} ${where}`).get() as
    | { count?: number }
    | undefined;
  return Number(row?.count ?? 0);
}

function deleteRows(item: RowPlanItem): { label: string; table: string; rows: number; skipped: boolean } {
  if (!tableExists(item.table)) {
    return { label: item.label, table: item.table, rows: 0, skipped: true };
  }
  const db = getDb();
  const result = db.prepare(`DELETE FROM ${item.table} ${item.where}`).run();
  return {
    label: item.label,
    table: item.table,
    rows: Number(result.changes ?? 0),
    skipped: false
  };
}

async function summarizePath(targetPath: string): Promise<Omit<PathSummary, "path">> {
  const stat = await fs.stat(targetPath).catch(() => null);
  if (!stat) {
    return { exists: false, files: 0, bytes: 0 };
  }
  if (!stat.isDirectory()) {
    return { exists: true, files: 1, bytes: stat.size };
  }

  let files = 0;
  let bytes = 0;
  const stack = [targetPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      files += 1;
      const fileStat = await fs.stat(fullPath).catch(() => null);
      bytes += fileStat?.size ?? 0;
    }
  }
  return { exists: true, files, bytes };
}

async function backupDbFiles(appDataDir: string): Promise<{ backupDir: string; copied: string[] }> {
  const backupRoot = path.join(appDataDir, "maintenance-backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, `clear-video-history-${stamp}`);
  await fs.mkdir(backupDir, { recursive: true });

  const copied: string[] = [];
  for (const fileName of ["app.db", "app.db-wal", "app.db-shm", "chat-history.json", "stage3-sessions.json"]) {
    const source = path.join(appDataDir, fileName);
    if (!existsSync(source)) {
      continue;
    }
    await fs.copyFile(source, path.join(backupDir, fileName));
    copied.push(fileName);
  }
  return { backupDir, copied };
}

function buildRowPlan(resetWorkers: boolean): RowPlanItem[] {
  const plan: RowPlanItem[] = [
    {
      label: "chat-bound editorial feedback",
      table: "channel_editorial_feedback_events",
      where: whereFromColumns("channel_editorial_feedback_events", [
        { column: "chat_id", sql: "chat_id IS NOT NULL" },
        { column: "stage2_run_id", sql: "stage2_run_id IS NOT NULL" }
      ])
    },
    { label: "publication events", table: "channel_publication_events", where: "" },
    { label: "publications", table: "channel_publications", where: "" },
    { label: "render exports", table: "render_exports", where: "" },
    { label: "stage3 job artifacts", table: "stage3_job_artifacts", where: "" },
    { label: "stage3 job events", table: "stage3_job_events", where: "" },
    { label: "stage3 jobs", table: "stage3_jobs", where: "" },
    { label: "source jobs", table: "source_jobs", where: "" },
    { label: "stage2 runs", table: "stage2_runs", where: "" },
    { label: "chat drafts", table: "chat_drafts", where: "" },
    { label: "chat events", table: "chat_events", where: "" },
    { label: "chat threads", table: "chat_threads", where: "" },
    {
      label: "video audit events",
      table: "audit_log",
      where: whereFromColumns("audit_log", [
        { column: "chat_id", sql: "chat_id IS NOT NULL" },
        { column: "stage", sql: "stage IN ('source', 'stage2', 'stage3', 'publishing', 'youtube')" },
        {
          column: "entity_type",
          sql: "entity_type IN ('chat', 'source_job', 'stage2_run', 'stage3_job', 'render_export', 'publication', 'channel_publication')"
        }
      ])
    }
  ];

  if (resetWorkers) {
    plan.push({ label: "stage3 worker tokens", table: "stage3_worker_tokens", where: "" });
    plan.push({ label: "stage3 workers", table: "stage3_workers", where: "" });
  }
  return plan;
}

export async function clearVideoHistoryForMaintenance(options: ClearVideoHistoryOptions = {}) {
  const appDataDir = getAppDataDir();
  const resetWorkers = options.resetWorkers !== false;
  const removeLegacyJson = options.removeLegacyJson !== false;
  const dirsToClear = [
    "source-media-cache",
    "stage3-cache",
    "stage3-job-artifacts",
    "render-exports",
    path.join("viral-shorts-worker", "exports")
  ];
  const filesToRemove = removeLegacyJson ? ["stage3-sessions.json", "chat-history.json"] : ["stage3-sessions.json"];
  const rowPlan = buildRowPlan(resetWorkers);
  const beforeRows = rowPlan.map((item) => ({
    label: item.label,
    table: item.table,
    rows: countRows(item.table, item.where)
  }));
  const beforePaths: PathSummary[] = [];
  for (const relativePath of [...dirsToClear, ...filesToRemove]) {
    beforePaths.push({
      path: relativePath,
      ...(await summarizePath(path.join(appDataDir, relativePath)))
    });
  }

  if (options.dryRun) {
    return {
      dryRun: true,
      appDataDir,
      resetWorkers,
      removeLegacyJson,
      rows: beforeRows,
      paths: beforePaths
    };
  }

  const db = getDb();
  db.exec("PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;");
  const backup = await backupDbFiles(appDataDir);
  const deletedRows = runInTransaction(() => rowPlan.map((item) => deleteRows(item)));

  for (const relativePath of dirsToClear) {
    const targetPath = path.join(appDataDir, relativePath);
    await fs.rm(targetPath, { recursive: true, force: true });
    await fs.mkdir(targetPath, { recursive: true });
  }
  for (const relativePath of filesToRemove) {
    await fs.rm(path.join(appDataDir, relativePath), { force: true });
  }

  db.exec("PRAGMA wal_checkpoint(PASSIVE);");

  return {
    dryRun: false,
    appDataDir,
    backup,
    resetWorkers,
    removeLegacyJson,
    beforeRows,
    beforePaths,
    deletedRows,
    clearedPaths: [...dirsToClear, ...filesToRemove]
  };
}
