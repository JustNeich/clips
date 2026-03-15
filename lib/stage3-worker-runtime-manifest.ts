import { promises as fs } from "node:fs";
import path from "node:path";

type Stage3WorkerPublicManifest = {
  version?: string;
  runtimeVersion?: string;
  builtAt?: string;
  bundleFile?: string;
  remotionFiles?: string[];
  libFiles?: string[];
};

const MANIFEST_CACHE_TTL_MS = 5_000;

let manifestCache: {
  loadedAtMs: number;
  manifest: Stage3WorkerPublicManifest | null;
} | null = null;

function normalizeRuntimeVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function readManifestFromDisk(): Promise<Stage3WorkerPublicManifest | null> {
  const filePath = path.join(process.cwd(), "public", "stage3-worker", "manifest.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as Stage3WorkerPublicManifest;
  } catch {
    return null;
  }
}

export async function readStage3WorkerPublicManifest(): Promise<Stage3WorkerPublicManifest | null> {
  if (manifestCache && Date.now() - manifestCache.loadedAtMs < MANIFEST_CACHE_TTL_MS) {
    return manifestCache.manifest;
  }
  const manifest = await readManifestFromDisk();
  manifestCache = {
    loadedAtMs: Date.now(),
    manifest
  };
  return manifest;
}

export async function getExpectedStage3WorkerRuntimeVersion(): Promise<string | null> {
  const manifest = await readStage3WorkerPublicManifest();
  return (
    normalizeRuntimeVersion(manifest?.runtimeVersion) ??
    normalizeRuntimeVersion(manifest?.version) ??
    null
  );
}

export function isStage3WorkerRuntimeVersionCompatible(input: {
  workerAppVersion: string | null | undefined;
  expectedRuntimeVersion: string | null | undefined;
}): boolean {
  const expected = normalizeRuntimeVersion(input.expectedRuntimeVersion);
  if (!expected) {
    return true;
  }
  return normalizeRuntimeVersion(input.workerAppVersion) === expected;
}

