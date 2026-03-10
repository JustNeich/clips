import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { APP_DB_SCHEMA } from "./schema";
import { getAppDataDir } from "../app-paths";

const DATA_DIR = getAppDataDir();
const DB_PATH = path.join(DATA_DIR, "app.db");

type GlobalDbScope = typeof globalThis & {
  __clipsAppDb?: DatabaseSync;
};

function hasColumn(db: DatabaseSync, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === columnName);
}

function addColumnIfMissing(db: DatabaseSync, tableName: string, columnName: string, definition: string): void {
  if (hasColumn(db, tableName, columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function applyDbMigrations(db: DatabaseSync): void {
  addColumnIfMissing(db, "stage3_jobs", "execution_target", "TEXT NOT NULL DEFAULT 'local'");
  addColumnIfMissing(db, "stage3_jobs", "assigned_worker_id", "TEXT");
  addColumnIfMissing(db, "stage3_jobs", "lease_expires_at", "TEXT");
  addColumnIfMissing(db, "stage3_jobs", "heartbeat_at", "TEXT");
  addColumnIfMissing(db, "stage3_jobs", "attempt_limit", "INTEGER NOT NULL DEFAULT 3");
  addColumnIfMissing(db, "stage3_jobs", "attempt_group", "TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_stage3_jobs_execution ON stage3_jobs(execution_target, status, created_at ASC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_stage3_jobs_worker ON stage3_jobs(assigned_worker_id, status, updated_at DESC)"
  );
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function createDb(): DatabaseSync {
  ensureDataDir();
  const db = new DatabaseSync(DB_PATH);
  db.exec(APP_DB_SCHEMA);
  applyDbMigrations(db);
  return db;
}

export function getDb(): DatabaseSync {
  const scope = globalThis as GlobalDbScope;
  if (!scope.__clipsAppDb) {
    scope.__clipsAppDb = createDb();
  }
  return scope.__clipsAppDb;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID().replace(/-/g, "");
}

export function runInTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
