import { promises as fs } from "node:fs";
import path from "node:path";
import { Stage3JobKind } from "../app/components/types";
import { getAppDataDir } from "./app-paths";

const JOB_ARTIFACT_ROOT = path.join(getAppDataDir(), "stage3-job-artifacts");

async function pruneArtifactDirectory(
  dirPath: string,
  options: { maxFiles: number; maxBytes: number; maxAgeMs: number }
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
          filePath,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs
        };
      })
    )
  ).filter((item): item is { filePath: string; sizeBytes: number; mtimeMs: number } => Boolean(item));

  const expired = files.filter((file) => now - file.mtimeMs > options.maxAgeMs);
  await Promise.all(expired.map((file) => fs.rm(file.filePath, { force: true }).catch(() => undefined)));

  const fresh = files
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

function resolveArtifactDir(kind: Extract<Stage3JobKind, "preview" | "render" | "editing-proxy">): string {
  return path.join(JOB_ARTIFACT_ROOT, kind);
}

function resolveArtifactRetention(
  kind: Extract<Stage3JobKind, "preview" | "render" | "editing-proxy">
): { maxFiles: number; maxBytes: number; maxAgeMs: number } {
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

export async function publishStage3VideoArtifact(
  kind: Extract<Stage3JobKind, "preview" | "render" | "editing-proxy">,
  jobId: string,
  sourcePath: string
): Promise<{ filePath: string; sizeBytes: number }> {
  const dirPath = resolveArtifactDir(kind);
  await fs.mkdir(dirPath, { recursive: true });
  const finalPath = path.join(dirPath, `${jobId}.mp4`);
  const tempPath = path.join(dirPath, `${jobId}.part-${Date.now()}.mp4`);
  await fs.copyFile(sourcePath, tempPath);
  await fs.rename(tempPath, finalPath);
  const stat = await fs.stat(finalPath);
  await pruneArtifactDirectory(dirPath, resolveArtifactRetention(kind)).catch(() => undefined);
  return {
    filePath: finalPath,
    sizeBytes: stat.size
  };
}

export async function publishStage3VideoArtifactFromBuffer(
  kind: Extract<Stage3JobKind, "preview" | "render" | "editing-proxy">,
  jobId: string,
  bytes: Uint8Array
): Promise<{ filePath: string; sizeBytes: number }> {
  const dirPath = resolveArtifactDir(kind);
  await fs.mkdir(dirPath, { recursive: true });
  const finalPath = path.join(dirPath, `${jobId}.mp4`);
  const tempPath = path.join(dirPath, `${jobId}.part-${Date.now()}.mp4`);
  await fs.writeFile(tempPath, bytes);
  await fs.rename(tempPath, finalPath);
  const stat = await fs.stat(finalPath);
  await pruneArtifactDirectory(dirPath, resolveArtifactRetention(kind)).catch(() => undefined);
  return {
    filePath: finalPath,
    sizeBytes: stat.size
  };
}
