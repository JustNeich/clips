import path from "node:path";
import { promises as fs } from "node:fs";

const DEFAULT_RUNTIME_DIR = ".stage3-worker-runtime";
const ROOT_RUNTIME_FILES = new Set([
  "clips-stage3-worker.cjs",
  "manifest.json",
  "package.json",
  "runtime-deps.tar.gz",
  "runtime-sources.tar.gz"
]);
const RUNTIME_SOURCE_DIRS = new Set(["remotion", "lib", "design", "public"]);

export const STAGE3_WORKER_RUNTIME_API_PREFIX = "/api/stage3/worker/runtime";

export function getStage3WorkerRuntimeDir(cwd: string = process.cwd()): string {
  const configured = process.env.STAGE3_WORKER_RUNTIME_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(cwd, configured);
  }
  return path.resolve(cwd, DEFAULT_RUNTIME_DIR);
}

export function getStage3WorkerRuntimeManifestPath(cwd: string = process.cwd()): string {
  return path.join(getStage3WorkerRuntimeDir(cwd), "manifest.json");
}

function normalizeRuntimePath(relativePath: string): string | null {
  const raw = relativePath.trim().replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || raw.startsWith("/")) {
    return null;
  }
  const normalized = path.posix.normalize(raw).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    return null;
  }
  const [firstSegment] = normalized.split("/");
  if (ROOT_RUNTIME_FILES.has(normalized)) {
    return normalized;
  }
  if (firstSegment && RUNTIME_SOURCE_DIRS.has(firstSegment) && normalized !== firstSegment) {
    return normalized;
  }
  return null;
}

type WorkerRuntimeManifest = {
  bundleFile?: unknown;
  runtimeDependenciesArchiveFile?: unknown;
  runtimeSourcesArchiveFile?: unknown;
  remotionFiles?: unknown;
  libFiles?: unknown;
  designFiles?: unknown;
  publicFiles?: unknown;
};

function addManifestFile(target: Set<string>, value: unknown): void {
  const normalized = typeof value === "string" ? normalizeRuntimePath(value) : null;
  if (normalized && !normalized.includes("/")) {
    target.add(normalized);
  }
}

function addManifestDirFiles(target: Set<string>, prefix: string, value: unknown): void {
  if (!Array.isArray(value) || !RUNTIME_SOURCE_DIRS.has(prefix)) {
    return;
  }
  for (const item of value) {
    const relative = typeof item === "string" ? item.trim() : "";
    const normalized = relative ? normalizeRuntimePath(`${prefix}/${relative}`) : null;
    if (normalized?.startsWith(`${prefix}/`)) {
      target.add(normalized);
    }
  }
}

async function readRuntimeManifest(cwd: string): Promise<WorkerRuntimeManifest | null> {
  try {
    const raw = await fs.readFile(getStage3WorkerRuntimeManifestPath(cwd), "utf-8");
    return JSON.parse(raw) as WorkerRuntimeManifest;
  } catch {
    return null;
  }
}

async function listAllowedRuntimePaths(cwd: string): Promise<Set<string>> {
  const manifest = await readRuntimeManifest(cwd);
  const allowed = new Set<string>(["manifest.json", "package.json"]);
  addManifestFile(allowed, manifest?.bundleFile ?? "clips-stage3-worker.cjs");
  addManifestFile(allowed, manifest?.runtimeDependenciesArchiveFile);
  addManifestFile(allowed, manifest?.runtimeSourcesArchiveFile);
  addManifestDirFiles(allowed, "remotion", manifest?.remotionFiles);
  addManifestDirFiles(allowed, "lib", manifest?.libFiles);
  addManifestDirFiles(allowed, "design", manifest?.designFiles);
  addManifestDirFiles(allowed, "public", manifest?.publicFiles);
  return allowed;
}

export async function resolveStage3WorkerRuntimeFile(
  relativePath: string,
  cwd: string = process.cwd()
): Promise<{ filePath: string; normalizedPath: string } | null> {
  const normalizedPath = normalizeRuntimePath(relativePath);
  if (!normalizedPath) {
    return null;
  }
  const allowedPaths = await listAllowedRuntimePaths(cwd);
  if (!allowedPaths.has(normalizedPath)) {
    return null;
  }
  const runtimeDir = getStage3WorkerRuntimeDir(cwd);
  const filePath = path.resolve(runtimeDir, normalizedPath);
  const relativeToRuntime = path.relative(runtimeDir, filePath);
  if (relativeToRuntime.startsWith("..") || path.isAbsolute(relativeToRuntime)) {
    return null;
  }
  return { filePath, normalizedPath };
}

export function getStage3WorkerRuntimeContentType(normalizedPath: string): string {
  if (normalizedPath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (normalizedPath.endsWith(".cjs") || normalizedPath.endsWith(".js") || normalizedPath.endsWith(".ts")) {
    return "text/plain; charset=utf-8";
  }
  if (normalizedPath.endsWith(".tsx")) {
    return "text/plain; charset=utf-8";
  }
  if (normalizedPath.endsWith(".tar.gz")) {
    return "application/gzip";
  }
  if (normalizedPath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (normalizedPath.endsWith(".png")) {
    return "image/png";
  }
  return "application/octet-stream";
}
