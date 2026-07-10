import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import { getAppDataDir } from "./app-paths";
import { getDb, getDbFilePath } from "./db/client";
import { isHostedRenderRuntime } from "./hosted-subprocess";
import { normalizeSupportedUrl } from "./supported-url";
import { queueThrottledBackgroundTask } from "./throttled-background-task";
import { sweepProductionSemanticInputStore } from "./project-kings/production-semantic-input-store";

export type AppStorageCleanupMode = "normal" | "emergency";

export type AppStorageCleanupRemovedFile = {
  path: string;
  bytes: number;
  reason: string;
};

export type AppStorageCleanupResult = {
  mode: AppStorageCleanupMode;
  requestedMode: AppStorageCleanupMode;
  reason: string;
  incomingBytes: number;
  removedFiles: AppStorageCleanupRemovedFile[];
  removedBytes: number;
  beforeFreeBytes: number | null;
  afterFreeBytes: number | null;
};

type CleanupContext = {
  mode: AppStorageCleanupMode;
  requestedMode: AppStorageCleanupMode;
  reason: string;
  incomingBytes: number;
  removedFiles: AppStorageCleanupRemovedFile[];
  beforeFreeBytes: number | null;
};

type FileEntry = {
  name: string;
  filePath: string;
  sizeBytes: number;
  mtimeMs: number;
};

type StorageProtectionSnapshot = {
  protectedRenderExportPaths: Set<string>;
  protectedSourceKeys: Set<string>;
};

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const STORAGE_MIN_FREE_BYTES = readEnvBytes("APP_STORAGE_MIN_FREE_MB", isHostedRenderRuntime() ? 768 : 512);

const NORMAL_RENDER_EXPORT_MAX_AGE_MS = readEnvDurationHours("APP_STORAGE_RENDER_EXPORT_MAX_AGE_HOURS", 7 * 24);
const EMERGENCY_RENDER_EXPORT_MAX_AGE_MS = readEnvDurationHours(
  "APP_STORAGE_RENDER_EXPORT_EMERGENCY_MAX_AGE_HOURS",
  24
);
const NORMAL_UPLOADED_SOURCE_MAX_AGE_MS = readEnvDurationHours("APP_STORAGE_UPLOADED_SOURCE_MAX_AGE_HOURS", 7 * 24);
const EMERGENCY_UPLOADED_SOURCE_MAX_AGE_MS = readEnvDurationHours(
  "APP_STORAGE_UPLOADED_SOURCE_EMERGENCY_MAX_AGE_HOURS",
  24
);
const RECENT_SOURCE_PROTECTION_MS = readEnvDurationHours("APP_STORAGE_RECENT_SOURCE_PROTECTION_HOURS", 7 * 24);

const ACTIVE_PUBLICATION_STATUSES = ["queued", "uploading", "scheduled", "paused", "failed"] as const;
const ACTIVE_JOB_STATUSES = ["queued", "running"] as const;

function readEnvDurationHours(name: string, fallbackHours: number): number {
  const raw = Number.parseFloat(process.env[name] ?? "");
  if (!Number.isFinite(raw) || raw < 0) {
    return fallbackHours * HOUR_MS;
  }
  return raw * HOUR_MS;
}

function readEnvBytes(name: string, fallbackMb: number): number {
  const raw = Number.parseFloat(process.env[name] ?? "");
  if (!Number.isFinite(raw) || raw < 0) {
    return fallbackMb * 1024 * 1024;
  }
  return raw * 1024 * 1024;
}

function hashSourceKey(value: string): string {
  return createHash("sha1").update(normalizeSupportedUrl(value)).digest("hex");
}

function maybeSourceKey(value: string | null | undefined): string | null {
  const normalized = normalizeSupportedUrl(value ?? "");
  if (!normalized) {
    return null;
  }
  if (!normalized.startsWith("upload:") && !normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    return null;
  }
  return hashSourceKey(normalized);
}

function collectSourceUrls(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    const normalized = normalizeSupportedUrl(value);
    if (
      normalized.startsWith("upload:") ||
      normalized.startsWith("https://") ||
      normalized.startsWith("http://")
    ) {
      output.add(normalized);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSourceUrls(item, output);
    }
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectSourceUrls(item, output);
  }
}

async function statFreeBytes(dirPath: string): Promise<number | null> {
  await fs.mkdir(dirPath, { recursive: true }).catch(() => undefined);
  const statfs = await fs.statfs(dirPath).catch(() => null);
  if (!statfs) {
    return null;
  }
  return statfs.bavail * statfs.bsize;
}

function resolveMode(requestedMode: AppStorageCleanupMode, beforeFreeBytes: number | null, incomingBytes: number): AppStorageCleanupMode {
  if (requestedMode === "emergency") {
    return "emergency";
  }
  if (beforeFreeBytes === null) {
    return requestedMode;
  }
  return beforeFreeBytes < STORAGE_MIN_FREE_BYTES + Math.max(0, incomingBytes) ? "emergency" : requestedMode;
}

async function listFiles(dirPath: string): Promise<FileEntry[]> {
  const names = await fs.readdir(dirPath).catch(() => []);
  const files = await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(dirPath, name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile()) {
        return null;
      }
      return {
        name,
        filePath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs
      };
    })
  );
  return files.filter((file): file is FileEntry => Boolean(file));
}

async function removeFile(ctx: CleanupContext, file: FileEntry | { filePath: string; sizeBytes: number }, reason: string): Promise<void> {
  await fs.rm(file.filePath, { force: true }).catch(() => undefined);
  ctx.removedFiles.push({
    path: file.filePath,
    bytes: file.sizeBytes,
    reason
  });
}

async function removeCompanionMeta(filePath: string): Promise<void> {
  const metaPath = filePath.replace(/\.mp4$/i, ".json");
  await fs.rm(metaPath, { force: true }).catch(() => undefined);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readStorageProtectionSnapshot(): StorageProtectionSnapshot {
  if (!existsSync(getDbFilePath())) {
    return {
      protectedRenderExportPaths: new Set(),
      protectedSourceKeys: new Set()
    };
  }

  const db = getDb();
  const protectedRenderExportPaths = new Set<string>();
  const protectedSourceUrls = new Set<string>();

  const activePublicationPlaceholders = ACTIVE_PUBLICATION_STATUSES.map(() => "?").join(", ");
  const activeRenderExports = db
    .prepare(
      `SELECT DISTINCT r.artifact_file_path, r.source_url
         FROM render_exports r
         JOIN channel_publications p ON p.render_export_id = r.id
        WHERE p.status IN (${activePublicationPlaceholders})`
    )
    .all(...ACTIVE_PUBLICATION_STATUSES) as Array<{ artifact_file_path?: string; source_url?: string }>;
  for (const row of activeRenderExports) {
    if (row.artifact_file_path) {
      protectedRenderExportPaths.add(path.resolve(row.artifact_file_path));
    }
    if (row.source_url) {
      protectedSourceUrls.add(row.source_url);
    }
  }

  const activeJobPlaceholders = ACTIVE_JOB_STATUSES.map(() => "?").join(", ");
  const activeSourceJobs = db
    .prepare(`SELECT DISTINCT source_url FROM source_jobs WHERE status IN (${activeJobPlaceholders})`)
    .all(...ACTIVE_JOB_STATUSES) as Array<{ source_url?: string }>;
  for (const row of activeSourceJobs) {
    if (row.source_url) {
      protectedSourceUrls.add(row.source_url);
    }
  }

  // A hash-qualified Project Kings buffer entry is a durable production input,
  // even before a chat/job/publication references it. Removing its sticky upload
  // would leave the DB claiming the buffer is ready while the exact approved
  // bytes no longer exist.
  const qualifiedProductionSources = db
    .prepare(`SELECT DISTINCT source_url FROM channel_source_candidates
      WHERE status IN ('available', 'reserved') AND qualification_status = 'qualified'`)
    .all() as Array<{ source_url?: string }>;
  for (const row of qualifiedProductionSources) {
    if (row.source_url) protectedSourceUrls.add(row.source_url);
  }

  const recentChatCutoff = new Date(Date.now() - RECENT_SOURCE_PROTECTION_MS).toISOString();
  const recentChats = db
    .prepare("SELECT DISTINCT url FROM chat_threads WHERE updated_at >= ?")
    .all(recentChatCutoff) as Array<{ url?: string }>;
  for (const row of recentChats) {
    if (row.url) {
      protectedSourceUrls.add(row.url);
    }
  }

  const activeStage3Jobs = db
    .prepare(`SELECT payload_json FROM stage3_jobs WHERE status IN (${activeJobPlaceholders})`)
    .all(...ACTIVE_JOB_STATUSES) as Array<{ payload_json?: string }>;
  for (const row of activeStage3Jobs) {
    collectSourceUrls(parseJson(row.payload_json ?? ""), protectedSourceUrls);
  }

  const protectedSourceKeys = new Set<string>();
  for (const url of protectedSourceUrls) {
    const sourceKey = maybeSourceKey(url);
    if (sourceKey) {
      protectedSourceKeys.add(sourceKey);
    }
  }

  return {
    protectedRenderExportPaths,
    protectedSourceKeys
  };
}

async function pruneTempFiles(ctx: CleanupContext, dirPath: string, label: string): Promise<void> {
  const maxAgeMs = ctx.mode === "emergency" ? 5 * 60_000 : HOUR_MS;
  const now = Date.now();
  const files = await listFiles(dirPath);
  await Promise.all(
    files
      .filter((file) => /\.(part-|downloading|uploading)/.test(file.name) && now - file.mtimeMs > maxAgeMs)
      .map((file) => removeFile(ctx, file, `${label}:stale-temp`))
  );
}

async function pruneSimpleAgeDir(
  ctx: CleanupContext,
  dirPath: string,
  label: string,
  normalMaxAgeMs: number,
  emergencyMaxAgeMs: number,
  options: { protectRecentMs?: number } = {}
): Promise<void> {
  const maxAgeMs = ctx.mode === "emergency" ? emergencyMaxAgeMs : normalMaxAgeMs;
  const protectRecentMs = options.protectRecentMs ?? 2 * 60_000;
  const now = Date.now();
  const files = await listFiles(dirPath);
  await Promise.all(
    files
      .filter((file) => {
        if (file.name.includes(".part-") && now - file.mtimeMs <= protectRecentMs) {
          return false;
        }
        return now - file.mtimeMs > maxAgeMs;
      })
      .map((file) => removeFile(ctx, file, `${label}:age`))
  );
}

async function pruneRenderExports(ctx: CleanupContext, protection: StorageProtectionSnapshot): Promise<void> {
  const dirPath = path.join(getAppDataDir(), "render-exports");
  const maxAgeMs = ctx.mode === "emergency" ? EMERGENCY_RENDER_EXPORT_MAX_AGE_MS : NORMAL_RENDER_EXPORT_MAX_AGE_MS;
  const now = Date.now();
  const files = await listFiles(dirPath);
  await Promise.all(
    files
      .filter((file) => {
        if (protection.protectedRenderExportPaths.has(path.resolve(file.filePath))) {
          return false;
        }
        return now - file.mtimeMs > maxAgeMs;
      })
      .map((file) => removeFile(ctx, file, "render-export:inactive-old"))
  );
}

async function readSourceMeta(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath.replace(/\.mp4$/i, ".json"), "utf-8").catch(() => "");
  return raw ? (parseJson(raw) as Record<string, unknown>) ?? {} : {};
}

async function pruneSourceMediaCache(ctx: CleanupContext, protection: StorageProtectionSnapshot): Promise<void> {
  const dirPath = path.join(getAppDataDir(), "source-media-cache", "sources");
  const stickyMaxAgeMs =
    ctx.mode === "emergency" ? EMERGENCY_UPLOADED_SOURCE_MAX_AGE_MS : NORMAL_UPLOADED_SOURCE_MAX_AGE_MS;
  const nonStickyMaxAgeMs = ctx.mode === "emergency" ? 0 : isHostedRenderRuntime() ? 6 * HOUR_MS : DAY_MS;
  const now = Date.now();
  const files = (await listFiles(dirPath)).filter((file) => file.name.endsWith(".mp4"));
  for (const file of files) {
    const sourceKey = path.basename(file.name, ".mp4");
    if (protection.protectedSourceKeys.has(sourceKey)) {
      continue;
    }
    const meta = await readSourceMeta(file.filePath);
    const sticky = meta.sticky === true || meta.downloadProvider === "upload";
    const maxAgeMs = sticky ? stickyMaxAgeMs : nonStickyMaxAgeMs;
    if (now - file.mtimeMs <= maxAgeMs) {
      continue;
    }
    await removeFile(ctx, file, sticky ? "source-media-cache:inactive-upload-old" : "source-media-cache:old");
    await removeCompanionMeta(file.filePath);
  }
  await pruneTempFiles(ctx, dirPath, "source-media-cache");
}

async function pruneStage3WorkingStorage(ctx: CleanupContext): Promise<void> {
  const appDataDir = getAppDataDir();
  await Promise.all([
    pruneSimpleAgeDir(ctx, path.join(appDataDir, "stage3-cache", "previews"), "stage3-cache:preview", HOUR_MS, 10 * 60_000),
    pruneSimpleAgeDir(
      ctx,
      path.join(appDataDir, "stage3-cache", "editing-proxies"),
      "stage3-cache:editing-proxy",
      6 * HOUR_MS,
      30 * 60_000
    ),
    pruneSimpleAgeDir(
      ctx,
      path.join(appDataDir, "stage3-job-artifacts", "preview"),
      "stage3-artifact:preview",
      HOUR_MS,
      10 * 60_000
    ),
    pruneSimpleAgeDir(
      ctx,
      path.join(appDataDir, "stage3-job-artifacts", "editing-proxy"),
      "stage3-artifact:editing-proxy",
      3 * HOUR_MS,
      30 * 60_000
    ),
    pruneSimpleAgeDir(
      ctx,
      path.join(appDataDir, "stage3-job-artifacts", "render"),
      "stage3-artifact:render",
      6 * HOUR_MS,
      30 * 60_000
    )
  ]);
}

function logCleanupResult(result: AppStorageCleanupResult): void {
  if (result.removedFiles.length === 0) {
    return;
  }
  console.info(
    JSON.stringify({
      scope: "storage",
      event: "app_storage_cleanup",
      at: new Date().toISOString(),
      reason: result.reason,
      mode: result.mode,
      requestedMode: result.requestedMode,
      incomingBytes: result.incomingBytes,
      removedFiles: result.removedFiles.length,
      removedBytes: result.removedBytes,
      beforeFreeBytes: result.beforeFreeBytes,
      afterFreeBytes: result.afterFreeBytes,
      removed: result.removedFiles.slice(0, 40)
    })
  );
}

export async function cleanupAppStorageForWrite(input: {
  reason: string;
  incomingBytes?: number | null;
  mode?: AppStorageCleanupMode;
}): Promise<AppStorageCleanupResult> {
  const appDataDir = getAppDataDir();
  const incomingBytes = Math.max(0, Math.floor(input.incomingBytes ?? 0));
  const requestedMode = input.mode ?? "normal";
  const beforeFreeBytes = await statFreeBytes(appDataDir);
  const ctx: CleanupContext = {
    mode: resolveMode(requestedMode, beforeFreeBytes, incomingBytes),
    requestedMode,
    reason: input.reason,
    incomingBytes,
    removedFiles: [],
    beforeFreeBytes
  };
  const protection = readStorageProtectionSnapshot();

  const semanticInputs = await sweepProductionSemanticInputStore();
  for (const removed of semanticInputs.removed) {
    ctx.removedFiles.push({
      path: removed.filePath,
      bytes: removed.sizeBytes,
      reason: "production-semantic-input:terminal-retention"
    });
  }
  await pruneStage3WorkingStorage(ctx);
  await pruneRenderExports(ctx, protection);
  await pruneSourceMediaCache(ctx, protection);

  const afterFreeBytes = await statFreeBytes(appDataDir);
  const result: AppStorageCleanupResult = {
    mode: ctx.mode,
    requestedMode: ctx.requestedMode,
    reason: ctx.reason,
    incomingBytes: ctx.incomingBytes,
    removedFiles: ctx.removedFiles,
    removedBytes: ctx.removedFiles.reduce((sum, file) => sum + file.bytes, 0),
    beforeFreeBytes: ctx.beforeFreeBytes,
    afterFreeBytes
  };
  logCleanupResult(result);
  return result;
}

export function scheduleAppStorageMaintenance(reason = "scheduled"): boolean {
  return queueThrottledBackgroundTask("app-storage-maintenance", 30 * 60_000, async () => {
    await cleanupAppStorageForWrite({
      reason,
      incomingBytes: 0,
      mode: "normal"
    });
  });
}
