import { promises as fs } from "node:fs";
import path from "node:path";

import { getAppDataDir } from "./app-paths";

const RENDER_EXPORT_ARTIFACT_ROOT = path.join(getAppDataDir(), "render-exports");

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
  await fs.copyFile(resolvedSource, tempPath);
  await fs.rename(tempPath, finalPath);
  const stat = await fs.stat(finalPath);
  return {
    filePath: finalPath,
    sizeBytes: stat.size
  };
}
