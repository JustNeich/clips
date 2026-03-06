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

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function createDb(): DatabaseSync {
  ensureDataDir();
  const db = new DatabaseSync(DB_PATH);
  db.exec(APP_DB_SCHEMA);
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
