#!/usr/bin/env node
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function parseArgs(argv) {
  const flags = new Set(argv);
  const valueAfter = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : null;
  };
  return {
    dryRun: flags.has("--dry-run"),
    yes: flags.has("--yes"),
    resetWorkers: flags.has("--reset-workers"),
    removeLegacyJson: !flags.has("--keep-legacy-json"),
    appDataDir: valueAfter("--app-data-dir")
  };
}

function resolveAppDataDir(explicit) {
  const normalized = explicit?.trim() || process.env.APP_DATA_DIR?.trim();
  if (normalized) {
    return path.resolve(normalized);
  }
  if (process.env.RENDER === "true" || process.env.RENDER === "1") {
    return "/var/data/app";
  }
  return path.join(process.cwd(), ".data");
}

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return Boolean(row?.name);
}

function columnExists(db, tableName, columnName) {
  if (!tableExists(db, tableName)) {
    return false;
  }
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => row?.name === columnName);
}

function whereFromColumns(db, tableName, candidates) {
  const clauses = candidates
    .filter((candidate) => columnExists(db, tableName, candidate.column))
    .map((candidate) => candidate.sql);
  return clauses.length ? `WHERE ${clauses.join(" OR ")}` : "WHERE 0 = 1";
}

function countRows(db, tableName, where = "") {
  if (!tableExists(db, tableName)) {
    return 0;
  }
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} ${where}`).get();
  return Number(row?.count ?? 0);
}

function deleteRows(db, label, tableName, where = "") {
  if (!tableExists(db, tableName)) {
    return { label, rows: 0, skipped: true };
  }
  const result = db.prepare(`DELETE FROM ${tableName} ${where}`).run();
  return { label, rows: Number(result.changes ?? 0), skipped: false };
}

async function summarizePath(targetPath) {
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
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files += 1;
        const fileStat = await fs.stat(fullPath).catch(() => null);
        bytes += fileStat?.size ?? 0;
      }
    }
  }
  return { exists: true, files, bytes };
}

async function rmAndRecreateDir(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(targetPath, { recursive: true });
}

async function backupDbFiles(appDataDir) {
  const backupRoot = path.join(appDataDir, "maintenance-backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, `clear-video-history-${stamp}`);
  await fs.mkdir(backupDir, { recursive: true });

  const copied = [];
  for (const fileName of ["app.db", "app.db-wal", "app.db-shm", "chat-history.json", "stage3-sessions.json"]) {
    const source = path.join(appDataDir, fileName);
    if (!existsSync(source)) {
      continue;
    }
    const destination = path.join(backupDir, fileName);
    await fs.copyFile(source, destination);
    copied.push(fileName);
  }
  return { backupDir, copied };
}

const args = parseArgs(process.argv.slice(2));
if (!args.dryRun && !args.yes) {
  console.error("Refusing to mutate data without --yes. Use --dry-run to preview.");
  process.exit(2);
}

const appDataDir = resolveAppDataDir(args.appDataDir);
const dbPath = path.join(appDataDir, "app.db");
if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;");

const rowPlan = [
  [
    "chat-bound editorial feedback",
    "channel_editorial_feedback_events",
    whereFromColumns(db, "channel_editorial_feedback_events", [
      { column: "chat_id", sql: "chat_id IS NOT NULL" },
      { column: "stage2_run_id", sql: "stage2_run_id IS NOT NULL" }
    ])
  ],
  ["publication events", "channel_publication_events", ""],
  ["publications", "channel_publications", ""],
  ["render exports", "render_exports", ""],
  ["stage3 job artifacts", "stage3_job_artifacts", ""],
  ["stage3 job events", "stage3_job_events", ""],
  ["stage3 jobs", "stage3_jobs", ""],
  ["source jobs", "source_jobs", ""],
  ["stage2 runs", "stage2_runs", ""],
  ["chat drafts", "chat_drafts", ""],
  ["chat events", "chat_events", ""],
  ["chat threads", "chat_threads", ""],
  [
    "video audit events",
    "audit_log",
    whereFromColumns(db, "audit_log", [
      { column: "chat_id", sql: "chat_id IS NOT NULL" },
      { column: "stage", sql: "stage IN ('source', 'stage2', 'stage3', 'publishing', 'youtube')" },
      {
        column: "entity_type",
        sql: "entity_type IN ('chat', 'source_job', 'stage2_run', 'stage3_job', 'render_export', 'publication', 'channel_publication')"
      }
    ])
  ]
];
if (args.resetWorkers) {
  rowPlan.push(["stage3 worker tokens", "stage3_worker_tokens", ""]);
  rowPlan.push(["stage3 workers", "stage3_workers", ""]);
}

const dirsToClear = [
  "source-media-cache",
  "stage3-cache",
  "stage3-job-artifacts",
  "render-exports",
  path.join("viral-shorts-worker", "exports")
];
const filesToRemove = args.removeLegacyJson ? ["stage3-sessions.json", "chat-history.json"] : ["stage3-sessions.json"];

const beforeRows = rowPlan.map(([label, table, where]) => ({
  label,
  table,
  rows: countRows(db, table, where)
}));
const beforePaths = [];
for (const relativePath of [...dirsToClear, ...filesToRemove]) {
  const targetPath = path.join(appDataDir, relativePath);
  beforePaths.push({
    path: relativePath,
    ...(await summarizePath(targetPath))
  });
}

if (args.dryRun) {
  console.log(
    JSON.stringify(
      {
        appDataDir,
        resetWorkers: args.resetWorkers,
        removeLegacyJson: args.removeLegacyJson,
        rows: beforeRows,
        paths: beforePaths
      },
      null,
      2
    )
  );
  db.close();
  process.exit(0);
}

const backup = await backupDbFiles(appDataDir);
const deletedRows = [];
db.exec("BEGIN IMMEDIATE");
try {
  for (const [label, table, where] of rowPlan) {
    deletedRows.push(deleteRows(db, label, table, where));
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

for (const relativePath of dirsToClear) {
  await rmAndRecreateDir(path.join(appDataDir, relativePath));
}
for (const relativePath of filesToRemove) {
  await fs.rm(path.join(appDataDir, relativePath), { force: true });
}

db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
db.close();

console.log(
  JSON.stringify(
    {
      appDataDir,
      backup,
      resetWorkers: args.resetWorkers,
      removeLegacyJson: args.removeLegacyJson,
      deletedRows,
      clearedPaths: [...dirsToClear, ...filesToRemove]
    },
    null,
    2
  )
);
