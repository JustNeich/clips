import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppDataDir } from "./app-paths";
import { newId } from "./db/client";
import type { Stage2RunDebugArtifact } from "./viral-shorts-worker/types";

function getStage2DebugArtifactsDir(): string {
  return path.join(getAppDataDir(), "stage2-debug-artifacts");
}

function sanitizeDebugRef(debugRef: string): string | null {
  const trimmed = debugRef.trim();
  return /^[a-z0-9_-]+$/i.test(trimmed) ? trimmed : null;
}

function buildArtifactPath(runId: string, debugRef: string): string {
  return path.join(getStage2DebugArtifactsDir(), `${runId}.${debugRef}.json`);
}

export async function saveStage2RunDebugArtifact(input: {
  runId: string;
  artifact: Stage2RunDebugArtifact;
}): Promise<string> {
  const debugRef = `stage2_debug_${newId()}`;
  const targetPath = buildArtifactPath(input.runId, debugRef);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(input.artifact, null, 2)}\n`, "utf-8");
  return debugRef;
}

export async function loadStage2RunDebugArtifact(
  runId: string,
  debugRef: string
): Promise<Stage2RunDebugArtifact | null> {
  const safeDebugRef = sanitizeDebugRef(debugRef);
  if (!safeDebugRef) {
    return null;
  }
  try {
    const raw = await fs.readFile(buildArtifactPath(runId, safeDebugRef), "utf-8");
    const parsed = JSON.parse(raw) as Stage2RunDebugArtifact;
    return parsed?.kind === "stage2-run-debug" ? parsed : null;
  } catch {
    return null;
  }
}
