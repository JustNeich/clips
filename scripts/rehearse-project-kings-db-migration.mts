import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const repoRoot = path.resolve(import.meta.dirname, "..");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

type DatabaseSnapshot = {
  integrity: string[];
  foreignKeyIssues: unknown[];
  tables: Array<{ name: string; rowCount: number; sqlSha256: string }>;
  indexes: Array<{ name: string; table: string; sqlSha256: string }>;
  databaseBytes: number;
  pageCount: number;
  pageSize: number;
};

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function inspectDatabase(db: DatabaseSync): DatabaseSnapshot {
  const integrity = (db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check?: string }>)
    .map((row) => String(row.integrity_check ?? ""));
  const foreignKeyIssues = db.prepare("PRAGMA foreign_key_check").all();
  const tableRows = db.prepare(`SELECT name, sql FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`).all() as Array<{
      name: string;
      sql: string | null;
    }>;
  const tables = tableRows.map((row) => {
    const escaped = row.name.replaceAll('"', '""');
    const count = db.prepare(`SELECT COUNT(*) AS count FROM "${escaped}"`).get() as { count?: number | bigint };
    return {
      name: row.name,
      rowCount: Number(count.count ?? 0),
      sqlSha256: hashText(String(row.sql ?? ""))
    };
  });
  const indexes = (db.prepare(`SELECT name, tbl_name AS table_name, sql FROM sqlite_master
    WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`).all() as Array<{
      name: string;
      table_name: string;
      sql: string | null;
    }>).map((row) => ({
      name: row.name,
      table: row.table_name,
      sqlSha256: hashText(String(row.sql ?? ""))
    }));
  const pageCount = Number((db.prepare("PRAGMA page_count").get() as { page_count?: number }).page_count ?? 0);
  const pageSize = Number((db.prepare("PRAGMA page_size").get() as { page_size?: number }).page_size ?? 0);
  return {
    integrity,
    foreignKeyIssues,
    tables,
    indexes,
    databaseBytes: 0,
    pageCount,
    pageSize
  };
}

async function inspectDatabaseAsync(db: DatabaseSync, dbPath: string): Promise<DatabaseSnapshot> {
  const snapshot = inspectDatabase(db);
  snapshot.databaseBytes = (await fs.stat(dbPath)).size;
  return snapshot;
}

function assertHealthy(label: string, snapshot: DatabaseSnapshot): void {
  if (snapshot.integrity.length !== 1 || snapshot.integrity[0] !== "ok") {
    throw new Error(`${label} integrity_check failed: ${JSON.stringify(snapshot.integrity)}`);
  }
  if (snapshot.foreignKeyIssues.length) {
    throw new Error(`${label} foreign_key_check failed: ${JSON.stringify(snapshot.foreignKeyIssues)}`);
  }
}

function assertRowsPreserved(before: DatabaseSnapshot, after: DatabaseSnapshot): void {
  const afterCounts = new Map(after.tables.map((table) => [table.name, table.rowCount]));
  const missing: string[] = [];
  const changed: string[] = [];
  for (const table of before.tables) {
    if (!afterCounts.has(table.name)) missing.push(table.name);
    else if (afterCounts.get(table.name) !== table.rowCount) {
      changed.push(`${table.name}:${table.rowCount}->${afterCounts.get(table.name)}`);
    }
  }
  if (missing.length || changed.length) {
    throw new Error(`Migration did not preserve pre-existing rows; missing=${missing.join(",")}; changed=${changed.join(",")}`);
  }
}

const sourcePath = path.resolve(requiredArgument("--snapshot"));
const snapshotClassification = requiredArgument("--snapshot-classification");
if (snapshotClassification !== "production_snapshot" && snapshotClassification !== "development_production_shaped") {
  throw new Error("--snapshot-classification must be production_snapshot|development_production_shaped.");
}
const preconditionNote = argument("--precondition-note")?.trim() || null;
const outputPath = path.resolve(
  argument("--out") ?? path.join(
    repoRoot,
    "docs/project-kings-production-pipeline-v1/evidence/migration-rehearsal.json"
  )
);
const sourceStat = await fs.stat(sourcePath);
if (!sourceStat.isFile() || sourceStat.size < 1) throw new Error("--snapshot must be a non-empty SQLite file.");
const sourceSha256Before = await fileSha256(sourcePath);
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-kings-migration-rehearsal-"));
const rehearsalDbPath = path.join(tempDir, "app.db");
await fs.copyFile(sourcePath, rehearsalDbPath);

let before: DatabaseSnapshot;
let after: DatabaseSnapshot;
let idempotentAfter: DatabaseSnapshot;
const startedAt = new Date().toISOString();
const startMs = performance.now();
try {
  const beforeDb = new DatabaseSync(rehearsalDbPath);
  beforeDb.exec("PRAGMA foreign_keys = ON");
  before = await inspectDatabaseAsync(beforeDb, rehearsalDbPath);
  beforeDb.close();
  assertHealthy("before", before);

  const priorAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = tempDir;
  delete (globalThis as { __clipsAppDb?: DatabaseSync }).__clipsAppDb;
  try {
    const { getDb } = await import(`../lib/db/client.ts?rehearsal=${randomUUID()}`);
    const migrated = getDb();
    after = await inspectDatabaseAsync(migrated, rehearsalDbPath);
    assertHealthy("after", after);
    assertRowsPreserved(before, after);
    migrated.close();
    delete (globalThis as { __clipsAppDb?: DatabaseSync }).__clipsAppDb;

    const idempotent = getDb();
    idempotentAfter = await inspectDatabaseAsync(idempotent, rehearsalDbPath);
    assertHealthy("idempotent-after", idempotentAfter);
    assertRowsPreserved(after, idempotentAfter);
    idempotent.close();
    delete (globalThis as { __clipsAppDb?: DatabaseSync }).__clipsAppDb;
  } finally {
    if (priorAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = priorAppDataDir;
    delete (globalThis as { __clipsAppDb?: DatabaseSync }).__clipsAppDb;
  }

  const sourceSha256After = await fileSha256(sourcePath);
  if (sourceSha256After !== sourceSha256Before) {
    throw new Error("Original snapshot changed during migration rehearsal.");
  }
  const requiredTables = [
    "production_profiles",
    "production_runs",
    "production_run_channels",
    "production_items",
    "channel_source_candidates",
    "production_events",
    "production_outbox",
    "agent_attempts",
    "quality_verdicts",
    "public_verifications"
  ];
  const afterTables = new Set(after.tables.map((table) => table.name));
  const missingRequired = requiredTables.filter((table) => !afterTables.has(table));
  if (missingRequired.length) {
    throw new Error(`Migrated database is missing production tables: ${missingRequired.join(", ")}`);
  }

  const evidencePayload = {
    schemaVersion: "project-kings-migration-rehearsal-v1",
    rehearsalId: `migration-${sourceSha256Before.slice(0, 24)}`,
    sourceSnapshot: {
      fileName: path.basename(sourcePath),
      sha256: sourceSha256Before,
      bytes: sourceStat.size,
      classification: snapshotClassification,
      preconditionNote
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startMs),
    originalSnapshotUnchanged: true,
    restoreMethod: "discard isolated copy; original snapshot is never opened by application migrations",
    acceptanceEligible: snapshotClassification === "production_snapshot" && preconditionNote === null,
    before,
    after,
    idempotentAfter,
    result: "pass"
  } as const;
  const evidenceSha256 = hashText(JSON.stringify(evidencePayload));
  const evidence = { ...evidencePayload, evidenceSha256 };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryOutput = `${outputPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryOutput, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryOutput, outputPath);
  process.stdout.write(`${JSON.stringify({
    outputPath: path.relative(repoRoot, outputPath),
    rehearsalId: evidence.rehearsalId,
    durationMs: evidence.durationMs,
    beforeTables: before.tables.length,
    afterTables: after.tables.length,
    evidenceSha256
  }, null, 2)}\n`);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
