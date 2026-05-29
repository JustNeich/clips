import { promises as fs } from "node:fs";
import path from "node:path";
import { Stage3JobKind } from "../app/components/types";
import { getAppDataDir } from "./app-paths";

type Stage3VideoArtifactKind = Extract<Stage3JobKind, "preview" | "render" | "editing-proxy">;

type ArtifactRetention = {
  maxFiles: number;
  maxBytes: number;
  maxAgeMs: number;
};

type ArtifactPruneOptions = ArtifactRetention & {
  tempMaxAgeMs?: number;
  protectRecentTempMs?: number;
};

const STAGE3_VIDEO_ARTIFACT_KINDS = ["preview", "render", "editing-proxy"] as const satisfies readonly Stage3VideoArtifactKind[];
const STALE_TEMP_ARTIFACT_MS = 5 * 60_000;
const RECENT_TEMP_ARTIFACT_GRACE_MS = 2 * 60_000;
const EMERGENCY_RETAINED_KIND_BYTES = 128 * 1024 * 1024;

export const STAGE3_ARTIFACT_STORAGE_FULL_MESSAGE =
  "На сервере не хватило места, чтобы сохранить Stage 3 artifact. Старые временные Stage 3 файлы уже очищены; повторите действие. Если ошибка повторится, нужно освободить persistent disk Render.";

export class Stage3ArtifactStorageError extends Error {
  readonly code = "stage3_artifact_storage_full";

  constructor(cause: unknown) {
    super(STAGE3_ARTIFACT_STORAGE_FULL_MESSAGE);
    this.name = "Stage3ArtifactStorageError";
    this.cause = cause;
  }
}

function resolveArtifactRoot(): string {
  return path.join(getAppDataDir(), "stage3-job-artifacts");
}

function isTempArtifactFileName(name: string): boolean {
  return name.includes(".part-");
}

function isNoSpaceError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  const normalized = `${code} ${message}`.toLowerCase();
  return normalized.includes("enospc") || normalized.includes("no space left on device");
}

export function isStage3ArtifactStorageError(error: unknown): boolean {
  return error instanceof Stage3ArtifactStorageError || isNoSpaceError(error);
}

async function pruneArtifactDirectory(
  dirPath: string,
  options: ArtifactPruneOptions
): Promise<void> {
  const now = Date.now();
  const entries = await fs.readdir(dirPath).catch(() => []);
  const files = (
    await Promise.all(
      entries.map(async (name) => {
        const filePath = path.join(dirPath, name);
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile()) {
          return null;
        }
        return {
          name,
          filePath,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
          isTemp: isTempArtifactFileName(name)
        };
      })
    )
  ).filter(
    (item): item is { name: string; filePath: string; sizeBytes: number; mtimeMs: number; isTemp: boolean } =>
      Boolean(item)
  );

  const tempMaxAgeMs = options.tempMaxAgeMs ?? STALE_TEMP_ARTIFACT_MS;
  const protectRecentTempMs = options.protectRecentTempMs ?? RECENT_TEMP_ARTIFACT_GRACE_MS;
  const staleTemp = files.filter((file) => file.isTemp && now - file.mtimeMs > tempMaxAgeMs);
  await Promise.all(staleTemp.map((file) => fs.rm(file.filePath, { force: true }).catch(() => undefined)));
  const removed = new Set(staleTemp.map((file) => file.filePath));

  const candidates = files.filter(
    (file) => !removed.has(file.filePath) && !(file.isTemp && now - file.mtimeMs <= protectRecentTempMs)
  );

  const expired = candidates.filter((file) => now - file.mtimeMs > options.maxAgeMs);
  await Promise.all(expired.map((file) => fs.rm(file.filePath, { force: true }).catch(() => undefined)));
  expired.forEach((file) => removed.add(file.filePath));

  const fresh = candidates
    .filter((file) => !removed.has(file.filePath))
    .filter((file) => now - file.mtimeMs <= options.maxAgeMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  let totalBytes = fresh.reduce((sum, file) => sum + file.sizeBytes, 0);

  for (let index = options.maxFiles; index < fresh.length; index += 1) {
    totalBytes -= fresh[index].sizeBytes;
    await fs.rm(fresh[index].filePath, { force: true }).catch(() => undefined);
  }

  const capped = fresh.slice(0, options.maxFiles);
  for (let index = capped.length - 1; index >= 0 && totalBytes > options.maxBytes; index -= 1) {
    totalBytes -= capped[index].sizeBytes;
    await fs.rm(capped[index].filePath, { force: true }).catch(() => undefined);
  }
}

function resolveArtifactDir(kind: Stage3VideoArtifactKind): string {
  return path.join(resolveArtifactRoot(), kind);
}

function resolveArtifactRetention(kind: Stage3VideoArtifactKind): ArtifactRetention {
  if (kind === "render") {
    return {
      maxFiles: 16,
      maxBytes: 1024 * 1024 * 1024,
      maxAgeMs: 6 * 60 * 60_000
    };
  }
  if (kind === "editing-proxy") {
    return {
      maxFiles: 24,
      maxBytes: 1024 * 1024 * 1024,
      maxAgeMs: 3 * 60 * 60_000
    };
  }
  return {
    maxFiles: 40,
    maxBytes: 768 * 1024 * 1024,
    maxAgeMs: 60 * 60_000
  };
}

function reserveRetentionForIncomingArtifact(retention: ArtifactRetention, incomingBytes: number): ArtifactRetention {
  return {
    ...retention,
    maxFiles: Math.max(0, retention.maxFiles - 1),
    maxBytes: Math.max(0, retention.maxBytes - Math.max(0, incomingBytes))
  };
}

function resolveEmergencyArtifactRetention(kind: Stage3VideoArtifactKind, targetKind: Stage3VideoArtifactKind): ArtifactRetention {
  const retention = resolveArtifactRetention(kind);
  if (kind === targetKind) {
    return {
      ...retention,
      maxFiles: 0,
      maxBytes: 0,
      maxAgeMs: 0
    };
  }
  return {
    maxFiles: Math.min(2, retention.maxFiles),
    maxBytes: Math.min(EMERGENCY_RETAINED_KIND_BYTES, retention.maxBytes),
    maxAgeMs: Math.min(30 * 60_000, retention.maxAgeMs)
  };
}

async function pruneArtifactStorageForWrite(
  targetKind: Stage3VideoArtifactKind,
  incomingBytes: number,
  mode: "normal" | "emergency"
): Promise<void> {
  await Promise.all(
    STAGE3_VIDEO_ARTIFACT_KINDS.map(async (kind) => {
      const dirPath = resolveArtifactDir(kind);
      await fs.mkdir(dirPath, { recursive: true });
      const retention =
        mode === "emergency"
          ? resolveEmergencyArtifactRetention(kind, targetKind)
          : kind === targetKind
            ? reserveRetentionForIncomingArtifact(resolveArtifactRetention(kind), incomingBytes)
            : resolveArtifactRetention(kind);
      await pruneArtifactDirectory(dirPath, retention).catch(() => undefined);
    })
  );
}

async function publishStage3VideoArtifactWithWriter(
  kind: Stage3VideoArtifactKind,
  jobId: string,
  incomingBytes: number,
  writeTemp: (tempPath: string) => Promise<void>
): Promise<{ filePath: string; sizeBytes: number }> {
  const dirPath = resolveArtifactDir(kind);
  await fs.mkdir(dirPath, { recursive: true });
  const finalPath = path.join(dirPath, `${jobId}.mp4`);
  const tempPath = path.join(dirPath, `${jobId}.part-${Date.now()}.mp4`);

  const writeOnce = async (): Promise<void> => {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    await fs.rm(finalPath, { force: true }).catch(() => undefined);
    await writeTemp(tempPath);
    await fs.rename(tempPath, finalPath);
  };

  await pruneArtifactStorageForWrite(kind, incomingBytes, "normal");
  try {
    await writeOnce();
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    if (!isNoSpaceError(error)) {
      throw error;
    }
    await pruneArtifactStorageForWrite(kind, incomingBytes, "emergency");
    try {
      await writeOnce();
    } catch (retryError) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      if (isNoSpaceError(retryError)) {
        throw new Stage3ArtifactStorageError(retryError);
      }
      throw retryError;
    }
  }

  const stat = await fs.stat(finalPath);
  await pruneArtifactDirectory(dirPath, resolveArtifactRetention(kind)).catch(() => undefined);
  return {
    filePath: finalPath,
    sizeBytes: stat.size
  };
}

export async function publishStage3VideoArtifact(
  kind: Stage3VideoArtifactKind,
  jobId: string,
  sourcePath: string
): Promise<{ filePath: string; sizeBytes: number }> {
  const sourceStat = await fs.stat(sourcePath);
  return publishStage3VideoArtifactWithWriter(kind, jobId, sourceStat.size, (tempPath) =>
    fs.copyFile(sourcePath, tempPath)
  );
}

export async function publishStage3VideoArtifactFromBuffer(
  kind: Stage3VideoArtifactKind,
  jobId: string,
  bytes: Uint8Array
): Promise<{ filePath: string; sizeBytes: number }> {
  return publishStage3VideoArtifactWithWriter(kind, jobId, bytes.byteLength, (tempPath) =>
    fs.writeFile(tempPath, bytes)
  );
}
