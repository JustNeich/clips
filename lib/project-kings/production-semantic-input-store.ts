import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  createReadStream,
  existsSync,
  lstatSync,
  rmSync
} from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import { getAppDataDir } from "../app-paths";
import { getDb, getDbFilePath, newId, nowIso, runInTransaction } from "../db/client";
import type { ProductionAgentArtifact } from "./production-agent-contracts";
import {
  parseProductionSemanticJobPayloadJson,
  PRODUCTION_SEMANTIC_INPUT_AGGREGATE_MAX_BYTES,
  PRODUCTION_SEMANTIC_INPUT_MAX_BYTES,
  type ProductionSemanticInputRef
} from "./production-semantic-job-contract";

const STORE_DIRECTORY = "production-semantic-inputs";
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "interrupted"]);
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const INPUT_RESERVATION_TTL_MS = 60 * 60_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type ProductionSemanticInputStoreErrorCode =
  | "invalid_input"
  | "source_missing"
  | "source_not_regular_file"
  | "source_size_mismatch"
  | "source_hash_mismatch"
  | "input_too_large"
  | "aggregate_too_large"
  | "stored_input_missing"
  | "stored_input_not_regular_file"
  | "stored_input_size_mismatch"
  | "stored_input_hash_mismatch";

export class ProductionSemanticInputStoreError extends Error {
  readonly code: ProductionSemanticInputStoreErrorCode;

  constructor(code: ProductionSemanticInputStoreErrorCode, message: string) {
    super(message);
    this.name = "ProductionSemanticInputStoreError";
    this.code = code;
  }
}

export type OpenProductionSemanticInput = Readonly<{
  filePath: string;
  fileName: string;
  mediaType: ProductionSemanticInputRef["mediaType"];
  sizeBytes: number;
  sha256: string;
  stream: ReturnType<typeof createReadStream>;
}>;

export type ProductionSemanticInputSweepResult = Readonly<{
  retentionMs: number;
  blocked: boolean;
  removed: readonly Readonly<{ filePath: string; storageKey: string; sizeBytes: number }>[];
}>;

export type ProductionSemanticInputStageReceipt = Readonly<{
  refs: readonly ProductionSemanticInputRef[];
  createdStorageKeys: readonly string[];
  reservationId: string | null;
}>;

function inputRoot(): string {
  return path.join(getAppDataDir(), STORE_DIRECTORY, "sha256");
}

export function resolveProductionSemanticInputPath(storageKey: string): string {
  const normalized = storageKey.trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new ProductionSemanticInputStoreError("invalid_input", "Input storage key must be a SHA-256 digest.");
  }
  return path.join(inputRoot(), normalized.slice(0, 2), normalized);
}

async function hashFile(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function readRegularFile(filePath: string, missingCode: ProductionSemanticInputStoreErrorCode, regularCode: ProductionSemanticInputStoreErrorCode) {
  let fileStat;
  let linkStat;
  try {
    [fileStat, linkStat] = await Promise.all([fs.stat(filePath), fs.lstat(filePath)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProductionSemanticInputStoreError(missingCode, "Semantic input file does not exist.");
    }
    throw error;
  }
  if (!fileStat.isFile() || linkStat.isSymbolicLink()) {
    throw new ProductionSemanticInputStoreError(regularCode, "Semantic input must be one regular file, not a symlink.");
  }
  return fileStat;
}

function plainFileName(filePath: string, index: number): string {
  const baseName = path.basename(filePath).replaceAll("\0", "").trim();
  if (baseName && baseName !== "." && baseName !== ".." && !baseName.includes("/") && !baseName.includes("\\")) {
    return baseName.slice(0, 255);
  }
  return `input-${String(index + 1).padStart(2, "0")}`;
}

async function validateStoredFile(input: { filePath: string; sizeBytes: number; sha256: string }): Promise<void> {
  const stat = await readRegularFile(
    input.filePath,
    "stored_input_missing",
    "stored_input_not_regular_file"
  );
  if (stat.size !== input.sizeBytes) {
    throw new ProductionSemanticInputStoreError(
      "stored_input_size_mismatch",
      `Stored semantic input size drifted: expected ${input.sizeBytes}, got ${stat.size}.`
    );
  }
  const digest = await hashFile(input.filePath);
  if (digest !== input.sha256) {
    throw new ProductionSemanticInputStoreError(
      "stored_input_hash_mismatch",
      "Stored semantic input SHA-256 drifted from its immutable reference."
    );
  }
}

async function writeContentAddressedFile(input: {
  sourcePath: string;
  sizeBytes: number;
  sha256: string;
}): Promise<{ filePath: string; created: boolean }> {
  const destination = resolveProductionSemanticInputPath(input.sha256);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (existsSync(destination)) {
    await validateStoredFile({ filePath: destination, sizeBytes: input.sizeBytes, sha256: input.sha256 });
    return { filePath: destination, created: false };
  }

  const temporary = path.join(path.dirname(destination), `.${input.sha256}.${randomUUID()}.tmp`);
  try {
    await fs.copyFile(input.sourcePath, temporary, fsConstants.COPYFILE_EXCL);
    await fs.chmod(temporary, 0o600);
    await validateStoredFile({ filePath: temporary, sizeBytes: input.sizeBytes, sha256: input.sha256 });
    const handle = await fs.open(temporary, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await validateStoredFile({ filePath: destination, sizeBytes: input.sizeBytes, sha256: input.sha256 });
      await fs.rm(temporary, { force: true });
      return { filePath: destination, created: false };
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
  await validateStoredFile({ filePath: destination, sizeBytes: input.sizeBytes, sha256: input.sha256 });
  return { filePath: destination, created: true };
}

function createProductionSemanticInputReservation(storageKeys: readonly string[]): string | null {
  if (!existsSync(getDbFilePath())) return null;
  const reservationId = newId();
  const stamp = nowIso();
  const expiresAt = new Date(Date.now() + INPUT_RESERVATION_TTL_MS).toISOString();
  runInTransaction((db) => {
    const insert = db.prepare(
      `INSERT INTO production_semantic_input_reservations
        (reservation_id, storage_key, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    );
    for (const storageKey of new Set(storageKeys)) {
      insert.run(reservationId, storageKey, expiresAt, stamp);
    }
  });
  return reservationId;
}

export function releaseProductionSemanticInputReservation(reservationId: string | null | undefined): void {
  if (!reservationId || !existsSync(getDbFilePath())) return;
  getDb().prepare(
    "DELETE FROM production_semantic_input_reservations WHERE reservation_id = ?"
  ).run(reservationId);
}

function protectedProductionSemanticStorageKeys(
  db: ReturnType<typeof getDb>,
  stamp: string
): Set<string> | null {
  db.prepare("DELETE FROM production_semantic_input_reservations WHERE expires_at <= ?").run(stamp);
  const referenced = new Set(
    (db.prepare(
      "SELECT storage_key FROM production_semantic_input_reservations WHERE expires_at > ?"
    ).all(stamp) as Array<{ storage_key: string }>).map((row) => row.storage_key)
  );
  const rows = db.prepare(
    "SELECT payload_json FROM stage3_jobs WHERE kind = 'production-semantic'"
  ).all() as Array<{ payload_json: string }>;
  for (const row of rows) {
    try {
      for (const artifact of parseProductionSemanticJobPayloadJson(row.payload_json).packet.artifacts) {
        referenced.add(artifact.storageKey);
      }
    } catch {
      return null;
    }
  }
  return referenced;
}

export async function cleanupUnreferencedProductionSemanticInputs(
  storageKeys: readonly string[]
): Promise<Readonly<{ blocked: boolean; removedStorageKeys: readonly string[] }>> {
  if (!existsSync(getDbFilePath())) {
    const removed: string[] = [];
    for (const storageKey of new Set(storageKeys)) {
      const filePath = resolveProductionSemanticInputPath(storageKey);
      try {
        const stat = lstatSync(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        rmSync(filePath, { force: true });
        removed.push(storageKey);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return { blocked: false, removedStorageKeys: removed };
  }
  return runInTransaction((db) => {
    const referenced = protectedProductionSemanticStorageKeys(db, nowIso());
    if (referenced === null) return { blocked: true, removedStorageKeys: [] };
    const removed: string[] = [];
    for (const storageKey of new Set(storageKeys)) {
      if (referenced.has(storageKey)) continue;
      const filePath = resolveProductionSemanticInputPath(storageKey);
      try {
        const stat = lstatSync(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        rmSync(filePath, { force: true });
        removed.push(storageKey);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return { blocked: false, removedStorageKeys: removed };
  });
}

async function rollbackCreatedInputs(storageKeys: readonly string[], originalError: unknown): Promise<never> {
  try {
    const cleanup = await cleanupUnreferencedProductionSemanticInputs(storageKeys);
    if (cleanup.blocked) {
      throw new Error("Semantic input cleanup was blocked by an invalid existing job payload.");
    }
  } catch (cleanupError) {
    throw new AggregateError(
      [originalError, cleanupError],
      "Semantic input staging failed and its rollback could not be verified."
    );
  }
  throw originalError;
}

export async function stageProductionSemanticInputsWithReceipt(
  artifacts: readonly ProductionAgentArtifact[]
): Promise<ProductionSemanticInputStageReceipt> {
  if (!Array.isArray(artifacts) || artifacts.length === 0 || artifacts.length > 24) {
    throw new ProductionSemanticInputStoreError("invalid_input", "Semantic input set must contain between 1 and 24 files.");
  }

  const inspected = await Promise.all(
    artifacts.map(async (artifact, index) => {
      const sourcePath = path.resolve(artifact.path);
      const expectedSha = artifact.sha256.trim().toLowerCase();
      if (!SHA256_PATTERN.test(expectedSha)) {
        throw new ProductionSemanticInputStoreError("invalid_input", `Artifact ${artifact.id} has an invalid SHA-256.`);
      }
      const stat = await readRegularFile(sourcePath, "source_missing", "source_not_regular_file");
      if (stat.size < 1) {
        throw new ProductionSemanticInputStoreError("source_size_mismatch", `Artifact ${artifact.id} is empty.`);
      }
      if (stat.size > PRODUCTION_SEMANTIC_INPUT_MAX_BYTES) {
        throw new ProductionSemanticInputStoreError(
          "input_too_large",
          `Artifact ${artifact.id} exceeds the ${PRODUCTION_SEMANTIC_INPUT_MAX_BYTES} byte per-file limit.`
        );
      }
      return { artifact, index, sourcePath, expectedSha, sizeBytes: stat.size };
    })
  );

  const aggregateBytes = inspected.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  if (aggregateBytes > PRODUCTION_SEMANTIC_INPUT_AGGREGATE_MAX_BYTES) {
    throw new ProductionSemanticInputStoreError(
      "aggregate_too_large",
      `Semantic input set exceeds the ${PRODUCTION_SEMANTIC_INPUT_AGGREGATE_MAX_BYTES} byte aggregate limit.`
    );
  }

  const refs: ProductionSemanticInputRef[] = [];
  const prepared: Array<(typeof inspected)[number] & { digest: string }> = [];
  for (const entry of inspected) {
    const digest = await hashFile(entry.sourcePath);
    if (digest !== entry.expectedSha) {
      throw new ProductionSemanticInputStoreError(
        "source_hash_mismatch",
        `Artifact ${entry.artifact.id} does not match its declared SHA-256.`
      );
    }
    prepared.push({ ...entry, digest });
    refs.push({
      inputId: `input-${String(entry.index + 1).padStart(2, "0")}-${digest.slice(0, 12)}`,
      id: entry.artifact.id,
      kind: entry.artifact.kind,
      mediaType: entry.artifact.mediaType,
      fileName: plainFileName(entry.sourcePath, entry.index),
      sizeBytes: entry.sizeBytes,
      sha256: digest,
      storageKey: digest
    });
  }
  const reservationId = createProductionSemanticInputReservation(prepared.map((entry) => entry.digest));
  const createdStorageKeys: string[] = [];
  try {
    for (const entry of prepared) {
      const stored = await writeContentAddressedFile({
        sourcePath: entry.sourcePath,
        sizeBytes: entry.sizeBytes,
        sha256: entry.digest
      });
      if (stored.created) createdStorageKeys.push(entry.digest);
    }
  } catch (error) {
    releaseProductionSemanticInputReservation(reservationId);
    return await rollbackCreatedInputs(createdStorageKeys, error);
  }
  return { refs, createdStorageKeys, reservationId };
}

export async function stageProductionSemanticInputs(
  artifacts: readonly ProductionAgentArtifact[]
): Promise<ProductionSemanticInputRef[]> {
  return [...(await stageProductionSemanticInputsWithReceipt(artifacts)).refs];
}

export async function openProductionSemanticInput(ref: ProductionSemanticInputRef): Promise<OpenProductionSemanticInput> {
  if (ref.storageKey !== ref.sha256 || !SHA256_PATTERN.test(ref.sha256)) {
    throw new ProductionSemanticInputStoreError("invalid_input", "Semantic input reference is not content-addressed.");
  }
  if (!Number.isInteger(ref.sizeBytes) || ref.sizeBytes < 1 || ref.sizeBytes > PRODUCTION_SEMANTIC_INPUT_MAX_BYTES) {
    throw new ProductionSemanticInputStoreError("invalid_input", "Semantic input reference has an invalid size.");
  }
  const filePath = resolveProductionSemanticInputPath(ref.storageKey);
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProductionSemanticInputStoreError("stored_input_missing", "Semantic input file does not exist.");
    }
    throw new ProductionSemanticInputStoreError("stored_input_not_regular_file", "Stored semantic input cannot be opened safely.");
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new ProductionSemanticInputStoreError("stored_input_not_regular_file", "Stored semantic input is not a regular file.");
    }
    if (stat.size !== ref.sizeBytes) {
      throw new ProductionSemanticInputStoreError(
        "stored_input_size_mismatch",
        `Stored semantic input size drifted: expected ${ref.sizeBytes}, got ${stat.size}.`
      );
    }
    const digest = createHash("sha256");
    const verificationStream = handle.createReadStream({ start: 0, autoClose: false });
    for await (const chunk of verificationStream) digest.update(chunk);
    if (digest.digest("hex") !== ref.sha256) {
      throw new ProductionSemanticInputStoreError(
        "stored_input_hash_mismatch",
        "Stored semantic input SHA-256 drifted from its immutable reference."
      );
    }
    return {
      filePath,
      fileName: ref.fileName,
      mediaType: ref.mediaType,
      sizeBytes: ref.sizeBytes,
      sha256: ref.sha256,
      stream: handle.createReadStream({ start: 0, autoClose: true })
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function sweepProductionSemanticInputStore(input: {
  now?: Date;
  retentionMs?: number;
} = {}): Promise<ProductionSemanticInputSweepResult> {
  const retentionMs = Number.isFinite(input.retentionMs) && Number(input.retentionMs) >= 0
    ? Math.floor(Number(input.retentionMs))
    : DEFAULT_RETENTION_MS;
  if (!existsSync(getDbFilePath())) {
    return { retentionMs, blocked: false, removed: [] };
  }
  const requestedNowMs = (input.now ?? new Date()).getTime();
  const nowMs = Number.isFinite(requestedNowMs) ? requestedNowMs : Date.now();
  const stamp = new Date(nowMs).toISOString();
  return runInTransaction((db) => {
    db.prepare("DELETE FROM production_semantic_input_reservations WHERE expires_at <= ?").run(stamp);
    const protectedKeys = new Set(
      (db.prepare(
        "SELECT storage_key FROM production_semantic_input_reservations WHERE expires_at > ?"
      ).all(stamp) as Array<{ storage_key: string }>).map((row) => row.storage_key)
    );
    const removableKeys = new Set<string>();
    const rows = db.prepare(
      `SELECT status, payload_json, COALESCE(completed_at, updated_at, created_at) AS terminal_at
         FROM stage3_jobs
        WHERE kind = 'production-semantic'`
    ).all() as Array<{ status: string; payload_json: string; terminal_at: string }>;
    for (const row of rows) {
      let keys: string[];
      try {
        keys = parseProductionSemanticJobPayloadJson(row.payload_json).packet.artifacts.map((artifact) => artifact.storageKey);
      } catch {
        return { retentionMs, blocked: true, removed: [] };
      }
      const terminalAt = Date.parse(row.terminal_at);
      const oldTerminal = TERMINAL_JOB_STATUSES.has(row.status) && Number.isFinite(terminalAt) && terminalAt <= nowMs - retentionMs;
      for (const key of keys) {
        if (oldTerminal) removableKeys.add(key);
        else protectedKeys.add(key);
      }
    }

    const removed: Array<{ filePath: string; storageKey: string; sizeBytes: number }> = [];
    for (const storageKey of removableKeys) {
      if (protectedKeys.has(storageKey)) continue;
      const filePath = resolveProductionSemanticInputPath(storageKey);
      try {
        const stat = lstatSync(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        rmSync(filePath, { force: true });
        removed.push({ filePath, storageKey, sizeBytes: stat.size });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return { retentionMs, blocked: false, removed };
  });
}
