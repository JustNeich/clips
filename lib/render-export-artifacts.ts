import { promises as fs } from "node:fs";
import path from "node:path";

import { getAppDataDir } from "./app-paths";
import { cleanupAppStorageForWrite } from "./storage-maintenance";

const RENDER_EXPORT_ARTIFACT_ROOT = path.join(getAppDataDir(), "render-exports");

function isNoSpaceError(error: unknown): boolean {
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  const normalized = `${code} ${message}`.toLowerCase();
  return normalized.includes("enospc") || normalized.includes("no space left on device");
}

function normalizeArtifactExtension(fileName: string): string {
  const ext = path.extname(fileName).trim().toLowerCase();
  return ext || ".mp4";
}

export function isRenderExportArtifactPath(filePath: string): boolean {
  const candidate = filePath.trim();
  if (!candidate) {
    return false;
  }
  const root = path.resolve(RENDER_EXPORT_ARTIFACT_ROOT);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export function resolveRenderExportArtifactPath(stage3JobId: string, fileName: string): string {
  return path.join(
    RENDER_EXPORT_ARTIFACT_ROOT,
    `${stage3JobId}${normalizeArtifactExtension(fileName)}`
  );
}

export async function persistRenderExportArtifact(input: {
  stage3JobId: string;
  sourcePath: string;
  fileName: string;
}): Promise<{ filePath: string; sizeBytes: number }> {
  const finalPath = resolveRenderExportArtifactPath(input.stage3JobId, input.fileName);
  const resolvedSource = path.resolve(input.sourcePath);
  const resolvedFinal = path.resolve(finalPath);

  await fs.mkdir(RENDER_EXPORT_ARTIFACT_ROOT, { recursive: true });

  if (resolvedSource === resolvedFinal) {
    const stat = await fs.stat(finalPath);
    return {
      filePath: finalPath,
      sizeBytes: stat.size
    };
  }

  const extension = normalizeArtifactExtension(input.fileName);
  const tempPath = path.join(
    RENDER_EXPORT_ARTIFACT_ROOT,
    `${input.stage3JobId}.part-${Date.now()}${extension}`
  );
  const sourceStat = await fs.stat(resolvedSource);
  const writeOnce = async (): Promise<void> => {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    await fs.rm(finalPath, { force: true }).catch(() => undefined);
    await fs.copyFile(resolvedSource, tempPath);
    await fs.rename(tempPath, finalPath);
  };

  await cleanupAppStorageForWrite({
    reason: "render-export",
    incomingBytes: sourceStat.size,
    mode: "normal"
  }).catch(() => undefined);
  try {
    await writeOnce();
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    if (!isNoSpaceError(error)) {
      throw error;
    }
    await cleanupAppStorageForWrite({
      reason: "render-export",
      incomingBytes: sourceStat.size,
      mode: "emergency"
    }).catch(() => undefined);
    await writeOnce();
  }
  const stat = await fs.stat(finalPath);
  return {
    filePath: finalPath,
    sizeBytes: stat.size
  };
}
