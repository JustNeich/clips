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

type ParsedRuntimeVersion = {
  normalized: string;
  release: string;
  build: string | null;
};

function normalizeRuntimeVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseRuntimeVersion(value: string | null | undefined): ParsedRuntimeVersion | null {
  const normalized = normalizeRuntimeVersion(value);
  if (!normalized) {
    return null;
  }
  const plusIndex = normalized.indexOf("+");
  if (plusIndex < 0) {
    return {
      normalized,
      release: normalized,
      build: null
    };
  }
  const release = normalized.slice(0, plusIndex).trim();
  const build = normalized.slice(plusIndex + 1).trim();
  return {
    normalized,
    release: release || normalized,
    build: build || null
  };
}

function compareRuntimeBuildStamp(left: string | null, right: string | null): number | null {
  if (!left || !right) {
    return null;
  }
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) {
    return null;
  }
  const width = Math.max(left.length, right.length);
  const paddedLeft = left.padStart(width, "0");
  const paddedRight = right.padStart(width, "0");
  if (paddedLeft === paddedRight) {
    return 0;
  }
  return paddedLeft > paddedRight ? 1 : -1;
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
  const expected = parseRuntimeVersion(input.expectedRuntimeVersion);
  if (!expected) {
    return true;
  }
  const worker = parseRuntimeVersion(input.workerAppVersion);
  if (!worker) {
    return false;
  }
  if (worker.normalized === expected.normalized) {
    return true;
  }
  if (worker.release !== expected.release) {
    return false;
  }
  if (!expected.build) {
    return true;
  }
  const buildComparison = compareRuntimeBuildStamp(worker.build, expected.build);
  if (buildComparison === null) {
    return false;
  }
  return buildComparison >= 0;
}
