import os from "node:os";
import path from "node:path";
import process from "node:process";
import { existsSync, promises as fs } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  detectPreferredStage3Browser,
  ensureStage3RenderBrowser
} from "./stage3-browser-runtime";
import {
  resolveStage3WorkerAdvertisedVersion,
  shouldRestartStage3WorkerAfterSync
} from "./stage3-worker-runtime-sync";
import { resolveStage3WorkerRestartLaunch } from "./stage3-worker-restart";
import { ensureEsbuildRuntimeAvailable } from "./stage3-esbuild-runtime";
import { ensureRspackRuntimeAvailable } from "./stage3-rspack-runtime";
import { runStage3WorkerNpm } from "./stage3-worker-npm";
import { completeRemoteStage3Artifact } from "./stage3-worker-completion";
import {
  Stage3WorkerJobTimeoutError,
  isStage3WorkerJobTimeoutError,
  resolveStage3WorkerJobTimeoutMs
} from "./stage3-worker-job-timeout";
import { ensureManagedStage3WorkerTools } from "./stage3-worker-managed-tools";
import type { Stage3RenderProgressEvent } from "./stage3-render-service";
import { readSystemMemoryTelemetry } from "./system-resource-telemetry";

declare const __CLIPS_STAGE3_WORKER_RUNTIME_VERSION__: string | undefined;

export type WorkerPlatform = "darwin-arm64" | "darwin-x64" | "win32-x64" | "unknown";

export type WorkerConfig = {
  serverOrigin: string;
  sessionToken: string;
  workerId: string;
  label: string;
  platform: WorkerPlatform;
  pairedAt: string;
};

export type WorkerCapabilities = {
  ffmpeg: { available: boolean; path: string | null };
  ffprobe: { available: boolean; path: string | null };
  ytDlp: { available: boolean; path: string | null };
  browser: { available: boolean; path: string | null; source: string | null };
};

export type Stage3WorkerAdmissionTelemetry = {
  capturedAt: string;
  cpuCount: number | null;
  loadAverage1m: number | null;
  normalizedLoad1m: number | null;
  totalMemoryBytes: number | null;
  freeMemoryBytes: number | null;
  freeMemoryRatio: number | null;
  memoryProvider: string | null;
  activeRenderProcesses: number | null;
  activeWorkerJobs: number;
  telemetryError: string | null;
};

export type Stage3WorkerAdmissionReport = {
  decision: "admit" | "defer" | "busy";
  admitted: boolean;
  reasons: string[];
  thresholds: {
    maxNormalizedLoad1m: number;
    minFreeMemoryBytes: number;
    maxActiveRenderProcesses: number;
    maxActiveWorkerJobs: number;
  };
  telemetry: Stage3WorkerAdmissionTelemetry;
};

export type Stage3WorkerLoopOptions = {
  restartAfterRuntimeSync?: boolean;
  installSignalHandlers?: boolean;
  shouldStop?: () => boolean;
};

type Stage3JobEnvelope = {
  job: {
    id: string;
    kind: "preview" | "render" | "editing-proxy" | "source-download" | "agent-media-step";
    status: "queued" | "running" | "completed" | "failed" | "interrupted";
  };
};

type ClaimedJobResponse = Stage3JobEnvelope & {
  payloadJson: string;
};

class Stage3WorkerJobLeaseLostError extends Error {
  readonly jobId: string;
  readonly status: number;

  constructor(jobId: string, status: number) {
    super(`Stage 3 local executor lost lease for job ${jobId} (heartbeat status ${status}).`);
    this.name = "Stage3WorkerJobLeaseLostError";
    this.jobId = jobId;
    this.status = status;
  }
}

type WorkerRuntimeManifest = {
  version?: string;
  runtimeVersion?: string;
  builtAt?: string;
  bundleFile?: string;
  runtimeDependenciesArchiveFile?: string;
  runtimeDependenciesPlatform?: string;
  runtimeSourcesArchiveFile?: string;
  remotionFiles?: string[];
  libFiles?: string[];
  designFiles?: string[];
  publicFiles?: string[];
};

type Stage3WorkerRuntimeSyncOptions = {
  env?: NodeJS.ProcessEnv;
  npmCommand?: string;
  sessionToken?: string | null;
  pairingToken?: string | null;
};
type Stage3WorkerRuntimeAuthMode = "session" | "pairing" | "auto";

const execFileAsync = promisify(execFile);
const GIB = 1024 * 1024 * 1024;
const DEFAULT_ADMISSION_MAX_NORMALIZED_LOAD = 0.8;
const DEFAULT_ADMISSION_MIN_FREE_MEMORY_BYTES = 3 * GIB;
const BUNDLED_WORKER_RUNTIME_VERSION = normalizeRuntimeVersion(
  typeof __CLIPS_STAGE3_WORKER_RUNTIME_VERSION__ === "string"
    ? __CLIPS_STAGE3_WORKER_RUNTIME_VERSION__
    : null
);
const DEFAULT_BUNDLE_FILE = "clips-stage3-worker.cjs";
const DEFAULT_REMOTION_FILES = ["index.tsx", "science-card-v1.tsx"];
const DEFAULT_LIB_FILES = [
  "stage3-template.ts",
  "stage3-constants.ts",
  "template-scene.tsx",
  "stage3-verified-badge.tsx",
  "template-calibration-types.ts",
  "auto-fit-template-scene.tsx",
  "stage3-template-core.ts",
  "stage3-render-variation.ts",
  "stage3-template-spec.ts",
  "stage3-template-renderer.tsx",
  "stage3-template-runtime.tsx",
  "stage3-template-registry.ts"
];
const DEFAULT_DESIGN_FILES = [
  "templates/science-card-v1/figma-spec.json",
  "templates/science-card-v7/figma-spec.json",
  "templates/hedges-of-honor-v1/figma-spec.json"
];
const DEFAULT_PUBLIC_FILES = [
  "stage3-template-backdrops/hedges-of-honor-v1-shell.svg",
  "stage3-template-backdrops/science-card-v7-shell.svg",
  "stage3-template-badges/american-news-badge.svg",
  "stage3-template-badges/gold-glow-badge.png",
  "stage3-template-badges/honor-verified-badge.svg",
  "stage3-template-badges/pink-glow-badge.png",
  "stage3-template-badges/science-card-v1-check.png",
  "stage3-template-badges/twitter-verified-badge.png"
];

function resolveFiniteEnvNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

type ProcessSnapshot = { pid: number; ppid: number; command: string };

function parseProcessTable(processList: string): ProcessSnapshot[] {
  const processes: ProcessSnapshot[] = [];
  for (const rawLine of processList.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    processes.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return processes;
}

export function countDescendantRenderProcesses(processList: string, workerPid: number): number {
  const processes = parseProcessTable(processList);
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const isDescendant = (entry: ProcessSnapshot) => {
    const visited = new Set<number>();
    let current = entry;
    while (current.ppid > 0 && !visited.has(current.ppid)) {
      if (current.ppid === workerPid) return true;
      visited.add(current.ppid);
      const parent = byPid.get(current.ppid);
      if (!parent) return false;
      current = parent;
    }
    return false;
  };
  return processes.filter(
    (entry) =>
      entry.pid !== workerPid &&
      isDescendant(entry) &&
      (/\b(remotion|ffmpeg|ffprobe)\b/i.test(entry.command) ||
        /\b(chrome|chromium)(?:\.exe)?\b.*--headless/i.test(entry.command))
  ).length;
}

async function readActiveRenderProcessCount(): Promise<number> {
  if (process.platform === "win32") {
    throw new Error("windows_process_ancestry_unavailable");
  }
  const command = "/bin/ps";
  const args = ["-axo", "pid=,ppid=,command="];
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  return countDescendantRenderProcesses(stdout, process.pid);
}

export function evaluateStage3WorkerAdmission(
  telemetry: Stage3WorkerAdmissionTelemetry
): Stage3WorkerAdmissionReport {
  const thresholds = {
    maxNormalizedLoad1m: resolveFiniteEnvNumber(
      "STAGE3_WORKER_MAX_NORMALIZED_LOAD",
      DEFAULT_ADMISSION_MAX_NORMALIZED_LOAD
    ),
    minFreeMemoryBytes:
      resolveFiniteEnvNumber(
        "STAGE3_WORKER_MIN_FREE_MEMORY_GB",
        DEFAULT_ADMISSION_MIN_FREE_MEMORY_BYTES / GIB
      ) * GIB,
    maxActiveRenderProcesses: 0,
    maxActiveWorkerJobs: 0
  };
  const reasons: string[] = [];
  if (
    telemetry.telemetryError ||
    telemetry.cpuCount === null ||
    telemetry.loadAverage1m === null ||
    telemetry.normalizedLoad1m === null ||
    telemetry.totalMemoryBytes === null ||
    telemetry.freeMemoryBytes === null ||
    telemetry.freeMemoryRatio === null ||
    telemetry.activeRenderProcesses === null
  ) {
    reasons.push(`telemetry_unavailable${telemetry.telemetryError ? `:${telemetry.telemetryError}` : ""}`);
  }
  if (
    telemetry.normalizedLoad1m !== null &&
    telemetry.normalizedLoad1m > thresholds.maxNormalizedLoad1m
  ) {
    reasons.push("system_load_above_limit");
  }
  if (
    telemetry.freeMemoryBytes !== null &&
    telemetry.freeMemoryBytes < thresholds.minFreeMemoryBytes
  ) {
    reasons.push("free_memory_below_limit");
  }
  if (
    telemetry.activeRenderProcesses !== null &&
    telemetry.activeRenderProcesses > thresholds.maxActiveRenderProcesses
  ) {
    reasons.push("active_render_process_detected");
  }
  if (telemetry.activeWorkerJobs > thresholds.maxActiveWorkerJobs) {
    reasons.push("worker_job_active");
  }
  return {
    decision: reasons.length === 0 ? "admit" : "defer",
    admitted: reasons.length === 0,
    reasons,
    thresholds,
    telemetry
  };
}

export async function collectStage3WorkerAdmissionReport(input: {
  activeWorkerJobs?: number;
  processCountReader?: () => Promise<number>;
  systemSnapshot?: {
    cpuCount: number;
    loadAverage1m: number;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    memoryProvider?: string;
  };
} = {}): Promise<Stage3WorkerAdmissionReport> {
  const capturedAt = new Date().toISOString();
  try {
  const memory = input.systemSnapshot
    ? {
        totalMemoryBytes: input.systemSnapshot.totalMemoryBytes,
        availableMemoryBytes: input.systemSnapshot.freeMemoryBytes,
        provider: input.systemSnapshot.memoryProvider ?? "test",
        error: null
      }
      : await readSystemMemoryTelemetry();
    if (memory.totalMemoryBytes === null || memory.availableMemoryBytes === null) {
      throw new Error(memory.error ?? "memory_telemetry_unavailable");
    }
    const snapshot = input.systemSnapshot ?? {
      cpuCount: os.cpus().length,
      loadAverage1m: os.loadavg()[0] ?? Number.NaN,
      totalMemoryBytes: memory.totalMemoryBytes,
      freeMemoryBytes: memory.availableMemoryBytes,
      memoryProvider: memory.provider ?? undefined
    };
    const activeRenderProcesses = await (
      input.processCountReader ?? readActiveRenderProcessCount
    )();
    if (
      !Number.isFinite(snapshot.cpuCount) ||
      snapshot.cpuCount <= 0 ||
      !Number.isFinite(snapshot.loadAverage1m) ||
      snapshot.loadAverage1m < 0 ||
      !Number.isFinite(snapshot.totalMemoryBytes) ||
      snapshot.totalMemoryBytes <= 0 ||
      !Number.isFinite(snapshot.freeMemoryBytes) ||
      snapshot.freeMemoryBytes < 0 ||
      !Number.isInteger(activeRenderProcesses) ||
      activeRenderProcesses < 0
    ) {
      throw new Error("invalid_system_metrics");
    }
    const telemetry: Stage3WorkerAdmissionTelemetry = {
      capturedAt,
      cpuCount: snapshot.cpuCount,
      loadAverage1m: snapshot.loadAverage1m,
      normalizedLoad1m: snapshot.loadAverage1m / snapshot.cpuCount,
      totalMemoryBytes: snapshot.totalMemoryBytes,
      freeMemoryBytes: snapshot.freeMemoryBytes,
      freeMemoryRatio: snapshot.freeMemoryBytes / snapshot.totalMemoryBytes,
      memoryProvider: snapshot.memoryProvider ?? memory.provider ?? null,
      activeRenderProcesses,
      activeWorkerJobs: Math.max(0, Math.floor(input.activeWorkerJobs ?? 0)),
      telemetryError: null
    };
    return evaluateStage3WorkerAdmission(telemetry);
  } catch (error) {
    return evaluateStage3WorkerAdmission({
      capturedAt,
      cpuCount: null,
      loadAverage1m: null,
      normalizedLoad1m: null,
      totalMemoryBytes: null,
      freeMemoryBytes: null,
      freeMemoryRatio: null,
      memoryProvider: null,
      activeRenderProcesses: null,
      activeWorkerJobs: Math.max(0, Math.floor(input.activeWorkerJobs ?? 0)),
      telemetryError: error instanceof Error ? error.message : String(error)
    });
  }
}

function workerHomeDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Clips Stage3 Worker");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Clips Stage3 Worker");
  }
  return path.join(os.homedir(), ".clips-stage3-worker");
}

function paths() {
  const root = workerHomeDir();
  return {
    root,
    configPath: path.join(root, "config.json"),
    cacheRoot: path.join(root, "cache"),
    toolsRoot: path.join(root, "tools")
  };
}

export function getStage3WorkerHomeDir(): string {
  return workerHomeDir();
}

export function getStage3WorkerPaths(): ReturnType<typeof paths> {
  return paths();
}

function detectPlatform(): WorkerPlatform {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "darwin-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "darwin-x64";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "win32-x64";
  }
  return "unknown";
}

function splitPathEnv(): string[] {
  const raw = process.env.PATH ?? "";
  return raw.split(process.platform === "win32" ? ";" : ":").filter(Boolean);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (candidate.includes(path.sep) || (process.platform === "win32" && candidate.includes("\\"))) {
      if (await fileExists(candidate)) {
        return candidate;
      }
      continue;
    }
    for (const dir of splitPathEnv()) {
      const full = path.join(dir, candidate);
      if (await fileExists(full)) {
        return full;
      }
    }
  }
  return null;
}

export async function detectStage3WorkerCapabilities(): Promise<WorkerCapabilities> {
  const base = paths().toolsRoot;
  const ffmpegCandidates =
    process.platform === "win32"
      ? [path.join(base, "ffmpeg", "ffmpeg.exe"), "ffmpeg.exe", "ffmpeg"]
      : [path.join(base, "ffmpeg", "ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];
  const ffprobeCandidates =
    process.platform === "win32"
      ? [path.join(base, "ffmpeg", "ffprobe.exe"), "ffprobe.exe", "ffprobe"]
      : [path.join(base, "ffmpeg", "ffprobe"), "/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"];
  const ytDlpCandidates =
    process.platform === "win32"
      ? [path.join(base, "yt-dlp", "yt-dlp.exe"), "yt-dlp.exe", "yt-dlp"]
      : [path.join(base, "yt-dlp", "yt-dlp"), "/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "yt-dlp"];

  const [ffmpeg, ffprobe, ytDlp] = await Promise.all([
    resolveExecutable(ffmpegCandidates),
    resolveExecutable(ffprobeCandidates),
    resolveExecutable(ytDlpCandidates)
  ]);
  const detectedBrowser = await detectPreferredStage3Browser();

  return {
    ffmpeg: { available: Boolean(ffmpeg), path: ffmpeg },
    ffprobe: { available: Boolean(ffprobe), path: ffprobe },
    ytDlp: { available: Boolean(ytDlp), path: ytDlp },
    browser: {
      available: Boolean(detectedBrowser?.browserExecutable),
      path: detectedBrowser?.browserExecutable ?? null,
      source: detectedBrowser?.source ?? null
    }
  };
}

async function ensureWorkerDirs(): Promise<void> {
  const p = paths();
  await fs.mkdir(p.root, { recursive: true });
  await fs.mkdir(p.cacheRoot, { recursive: true });
  await fs.mkdir(p.toolsRoot, { recursive: true });
}

function normalizeRuntimeVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveStage3WorkerRuntimeDependenciesPlatform(input?: {
  platform?: NodeJS.Platform;
  arch?: string;
}): string {
  return `${input?.platform ?? process.platform}-${input?.arch ?? process.arch}`;
}

function normalizeRuntimeDependenciesPlatform(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function isStage3WorkerRuntimeDependenciesArchiveCompatible(input: {
  manifestPlatform?: unknown;
  workerPlatform?: string;
}): boolean {
  const manifestPlatform = normalizeRuntimeDependenciesPlatform(input.manifestPlatform);
  if (!manifestPlatform) {
    return false;
  }
  return manifestPlatform === (input.workerPlatform ?? resolveStage3WorkerRuntimeDependenciesPlatform()).toLowerCase();
}

function sanitizeRelativeFileList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const safe = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => Boolean(item) && !item.includes("..") && !path.isAbsolute(item))
    .map((item) => item.replace(/^\/+/, ""));
  return safe.length > 0 ? safe : fallback;
}

async function readLocalRuntimeManifest(): Promise<WorkerRuntimeManifest | null> {
  const manifestPath = path.join(paths().root, "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(raw) as WorkerRuntimeManifest;
  } catch {
    return null;
  }
}

function buildWorkerRuntimeApiFileUrl(origin: string, relativePath: string): string {
  return `${origin}/api/stage3/worker/runtime/${relativePath.replace(/^\/+/, "")}`;
}

function buildWorkerRuntimeFetchInit(
  options: Stage3WorkerRuntimeSyncOptions,
  mode: Stage3WorkerRuntimeAuthMode = "auto"
): RequestInit {
  const headers: Record<string, string> = {};
  const sessionToken = options.sessionToken?.trim();
  const pairingToken = options.pairingToken?.trim();
  if (sessionToken && mode !== "pairing") {
    headers.Authorization = `Bearer ${sessionToken}`;
  } else if (pairingToken && mode !== "session") {
    headers["X-Stage3-Worker-Pairing-Token"] = pairingToken;
  }
  return {
    cache: "no-store",
    headers
  };
}

function shouldRetryWorkerRuntimeWithPairingToken(input: {
  response: Response;
  options: Stage3WorkerRuntimeSyncOptions;
}): boolean {
  return (
    (input.response.status === 401 || input.response.status === 403) &&
    Boolean(input.options.sessionToken?.trim()) &&
    Boolean(input.options.pairingToken?.trim())
  );
}

async function downloadBinaryFile(url: string, destination: string, init?: RequestInit): Promise<void> {
  const response = await fetch(url, init ?? { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
}

function resolveTarCommand(): string {
  return process.platform === "win32" ? "tar.exe" : "tar";
}

async function replaceExtractedWorkerRuntimeSources(input: {
  archivePath: string;
  workerRoot: string;
}): Promise<void> {
  const targets = ["remotion", "lib", "design", "public"];
  for (const relative of targets) {
    await fs.rm(path.join(input.workerRoot, relative), {
      recursive: true,
      force: true
    }).catch(() => undefined);
  }
  await fs.mkdir(input.workerRoot, { recursive: true });
  await execFileAsync(resolveTarCommand(), ["-xzf", input.archivePath, "-C", input.workerRoot]);
}

async function replaceExtractedWorkerRuntimeDependencies(input: {
  archivePath: string;
  workerRoot: string;
}): Promise<void> {
  await fs.rm(path.join(input.workerRoot, "node_modules"), {
    recursive: true,
    force: true
  }).catch(() => undefined);
  await fs.mkdir(input.workerRoot, { recursive: true });
  await execFileAsync(resolveTarCommand(), ["-xzf", input.archivePath, "-C", input.workerRoot]);
  if (!(await fileExists(path.join(input.workerRoot, "node_modules")))) {
    throw new Error("Worker runtime dependency archive did not create node_modules.");
  }
}

async function workerRuntimeDependenciesMissing(workerRoot: string): Promise<boolean> {
  const markers = [
    path.join(workerRoot, "node_modules", "@remotion", "renderer", "package.json"),
    path.join(workerRoot, "node_modules", "@remotion", "bundler", "package.json"),
    path.join(workerRoot, "node_modules", "esbuild", "package.json"),
    path.join(workerRoot, "node_modules", "remotion", "package.json"),
    path.join(workerRoot, "node_modules", "react", "package.json"),
    path.join(workerRoot, "node_modules", "react-dom", "package.json")
  ];
  const missing = await Promise.all(markers.map(async (marker) => !(await fileExists(marker))));
  return missing.some(Boolean);
}

export async function syncStage3WorkerRuntime(
  serverOrigin: string,
  options: Stage3WorkerRuntimeSyncOptions = {}
): Promise<{ updated: boolean; runtimeVersion: string | null }> {
  const origin = serverOrigin.replace(/\/+$/, "");
  const manifestUrl = buildWorkerRuntimeApiFileUrl(origin, "manifest.json");
  let runtimeFetchInit = buildWorkerRuntimeFetchInit(options);
  let remoteManifestResponse = await fetch(manifestUrl, runtimeFetchInit);
  if (shouldRetryWorkerRuntimeWithPairingToken({ response: remoteManifestResponse, options })) {
    const pairingRuntimeFetchInit = buildWorkerRuntimeFetchInit(options, "pairing");
    const pairingManifestResponse = await fetch(manifestUrl, pairingRuntimeFetchInit);
    if (pairingManifestResponse.ok) {
      remoteManifestResponse = pairingManifestResponse;
      runtimeFetchInit = pairingRuntimeFetchInit;
    }
  }
  if (!remoteManifestResponse.ok) {
    throw new Error(
      `Failed to read worker manifest from server (${remoteManifestResponse.status}).`
    );
  }
  const remoteManifest = (await remoteManifestResponse.json()) as WorkerRuntimeManifest;
  const remoteRuntimeVersion =
    normalizeRuntimeVersion(remoteManifest.runtimeVersion) ??
    normalizeRuntimeVersion(remoteManifest.version);
  if (!remoteRuntimeVersion) {
    throw new Error("Worker manifest does not contain runtime version.");
  }

  const localManifest = await readLocalRuntimeManifest();
  const localRuntimeVersion =
    normalizeRuntimeVersion(localManifest?.runtimeVersion) ??
    normalizeRuntimeVersion(localManifest?.version) ??
    BUNDLED_WORKER_RUNTIME_VERSION;
  const workerPaths = paths();
  const remotionDir = path.join(workerPaths.root, "remotion");
  const libDir = path.join(workerPaths.root, "lib");
  const designDir = path.join(workerPaths.root, "design");
  const publicDir = path.join(workerPaths.root, "public");
  const binDir = path.join(workerPaths.root, "bin");
  const bundlePath = path.join(binDir, DEFAULT_BUNDLE_FILE);
  const packagePath = path.join(workerPaths.root, "package.json");
  const manifestPath = path.join(workerPaths.root, "manifest.json");
  const runtimeDependenciesArchivePath = path.join(workerPaths.root, "runtime-deps.tar.gz");
  const runtimeSourcesArchivePath = path.join(workerPaths.root, "runtime-sources.tar.gz");
  const bundleFile = remoteManifest.bundleFile?.trim() || DEFAULT_BUNDLE_FILE;
  const runtimeDependenciesArchiveFile =
    typeof remoteManifest.runtimeDependenciesArchiveFile === "string" &&
    remoteManifest.runtimeDependenciesArchiveFile.trim()
      ? remoteManifest.runtimeDependenciesArchiveFile.trim()
      : "";
  const runtimeDependenciesArchiveCompatible = isStage3WorkerRuntimeDependenciesArchiveCompatible({
    manifestPlatform: remoteManifest.runtimeDependenciesPlatform
  });
  const runtimeSourcesArchiveFile =
    typeof remoteManifest.runtimeSourcesArchiveFile === "string" &&
    remoteManifest.runtimeSourcesArchiveFile.trim()
      ? remoteManifest.runtimeSourcesArchiveFile.trim()
      : "";
  const remotionFiles = sanitizeRelativeFileList(remoteManifest.remotionFiles, DEFAULT_REMOTION_FILES);
  const libFiles = sanitizeRelativeFileList(remoteManifest.libFiles, DEFAULT_LIB_FILES);
  const designFiles = sanitizeRelativeFileList(remoteManifest.designFiles, DEFAULT_DESIGN_FILES);
  const publicFiles = sanitizeRelativeFileList(remoteManifest.publicFiles, DEFAULT_PUBLIC_FILES);
  const runtimeFilesMissing = (
    await Promise.all([
      ...remotionFiles.map(async (fileName) => !(await fileExists(path.join(remotionDir, fileName)))),
      ...libFiles.map(async (fileName) => !(await fileExists(path.join(libDir, fileName)))),
      ...designFiles.map(async (fileName) => !(await fileExists(path.join(designDir, fileName)))),
      ...publicFiles.map(async (fileName) => !(await fileExists(path.join(publicDir, fileName))))
    ])
  ).some(Boolean);
  const runtimeInstallMissing = (
    await Promise.all([
      fileExists(bundlePath),
      fileExists(packagePath),
      fileExists(manifestPath)
    ])
  ).some((exists) => !exists);
  const runtimeDependenciesMissing = await workerRuntimeDependenciesMissing(workerPaths.root);

  if (
    localRuntimeVersion === remoteRuntimeVersion &&
    !runtimeFilesMissing &&
    !runtimeInstallMissing &&
    !runtimeDependenciesMissing
  ) {
    return { updated: false, runtimeVersion: remoteRuntimeVersion };
  }

  await fs.mkdir(remotionDir, { recursive: true });
  await fs.mkdir(libDir, { recursive: true });
  await fs.mkdir(designDir, { recursive: true });
  await fs.mkdir(publicDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  await downloadBinaryFile(buildWorkerRuntimeApiFileUrl(origin, bundleFile), bundlePath, runtimeFetchInit);
  await downloadBinaryFile(buildWorkerRuntimeApiFileUrl(origin, "package.json"), packagePath, runtimeFetchInit);
  await downloadBinaryFile(buildWorkerRuntimeApiFileUrl(origin, "manifest.json"), manifestPath, runtimeFetchInit);

  let runtimeSourcesHydrated = false;
  if (runtimeSourcesArchiveFile) {
    try {
      await downloadBinaryFile(
        buildWorkerRuntimeApiFileUrl(origin, runtimeSourcesArchiveFile),
        runtimeSourcesArchivePath,
        runtimeFetchInit
      );
      await replaceExtractedWorkerRuntimeSources({
        archivePath: runtimeSourcesArchivePath,
        workerRoot: workerPaths.root
      });
      runtimeSourcesHydrated = true;
    } catch {
      runtimeSourcesHydrated = false;
    } finally {
      await fs.rm(runtimeSourcesArchivePath, { force: true }).catch(() => undefined);
    }
  }

  if (!runtimeSourcesHydrated) {
    for (const fileName of remotionFiles) {
      await downloadBinaryFile(
        buildWorkerRuntimeApiFileUrl(origin, `remotion/${fileName}`),
        path.join(remotionDir, fileName),
        runtimeFetchInit
      );
    }
    for (const fileName of libFiles) {
      await downloadBinaryFile(
        buildWorkerRuntimeApiFileUrl(origin, `lib/${fileName}`),
        path.join(libDir, fileName),
        runtimeFetchInit
      );
    }
    for (const fileName of designFiles) {
      await downloadBinaryFile(
        buildWorkerRuntimeApiFileUrl(origin, `design/${fileName}`),
        path.join(designDir, fileName),
        runtimeFetchInit
      );
    }
    for (const fileName of publicFiles) {
      await downloadBinaryFile(
        buildWorkerRuntimeApiFileUrl(origin, `public/${fileName}`),
        path.join(publicDir, fileName),
        runtimeFetchInit
      );
    }
  }

  let runtimeDependenciesHydrated = false;
  if (runtimeDependenciesArchiveFile && runtimeDependenciesArchiveCompatible) {
    try {
      await downloadBinaryFile(
        buildWorkerRuntimeApiFileUrl(origin, runtimeDependenciesArchiveFile),
        runtimeDependenciesArchivePath,
        runtimeFetchInit
      );
      await replaceExtractedWorkerRuntimeDependencies({
        archivePath: runtimeDependenciesArchivePath,
        workerRoot: workerPaths.root
      });
      runtimeDependenciesHydrated = true;
    } catch {
      runtimeDependenciesHydrated = false;
    } finally {
      await fs.rm(runtimeDependenciesArchivePath, { force: true }).catch(() => undefined);
    }
  }

  await fs.chmod(bundlePath, 0o755).catch(() => undefined);
  if (!runtimeDependenciesHydrated) {
    if (runtimeDependenciesArchiveFile && !runtimeDependenciesArchiveCompatible) {
      await fs.rm(path.join(workerPaths.root, "node_modules"), { recursive: true, force: true }).catch(() => undefined);
    }
    await runStage3WorkerNpm({
      installRoot: workerPaths.root,
      npmCommand: options.npmCommand,
      env: options.env,
      npmArgs: [
        "install",
        "--omit=dev",
        "--no-fund",
        "--no-audit"
      ]
    });
  }
  return {
    updated: true,
    runtimeVersion: remoteRuntimeVersion
  };
}

export async function readStage3WorkerConfig(): Promise<WorkerConfig | null> {
  try {
    return JSON.parse(await fs.readFile(paths().configPath, "utf-8")) as WorkerConfig;
  } catch {
    return null;
  }
}

export async function writeStage3WorkerConfig(config: WorkerConfig): Promise<void> {
  await ensureWorkerDirs();
  await fs.writeFile(paths().configPath, JSON.stringify(config, null, 2));
}

function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function getCommand(): string {
  return process.argv[2] ?? "help";
}

function authHeaders(config: WorkerConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.sessionToken}`
  };
}

async function readAppVersion(): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return resolveStage3WorkerAdvertisedVersion({
      bundledRuntimeVersion: BUNDLED_WORKER_RUNTIME_VERSION,
      packageVersion: parsed.version ?? null
    });
  } catch {
    return resolveStage3WorkerAdvertisedVersion({
      bundledRuntimeVersion: BUNDLED_WORKER_RUNTIME_VERSION,
      packageVersion: null
    });
  }
}

async function restartCurrentWorkerProcess(runtimeVersion: string | null): Promise<void> {
  const wrapperPath = path.join(paths().root, "bin", "clips-stage3-worker.cmd");
  const launch = resolveStage3WorkerRestartLaunch({
    execPath: process.execPath,
    argv: process.argv,
    cwd: process.cwd(),
    installRoot: paths().root,
    comspec: process.env.ComSpec ?? process.env.COMSPEC ?? null,
    wrapperExists: process.platform === "win32" ? existsSync(wrapperPath) : false
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: process.env,
      stdio: "inherit"
    });
    child.once("spawn", () => resolve());
    child.once("error", (error) => reject(error));
  });
  console.log(
    `Restarting Stage 3 worker to load runtime ${runtimeVersion ?? "latest"} before claiming jobs.`
  );
  process.exit(0);
}

export async function pairStage3Worker(input: {
  server: string;
  token: string;
  label?: string | null;
}): Promise<WorkerConfig> {
  const server = input.server.trim();
  const token = input.token.trim();
  const label = input.label?.trim() || `${os.hostname()} ${detectPlatform()}`;
  if (!server || !token) {
    throw new Error("Usage: npm run stage3-worker -- pair --server <origin> --token <pairing-token>");
  }

  await ensureWorkerDirs();
  const capabilities = await detectStage3WorkerCapabilities();
  const response = await fetch(`${server.replace(/\/+$/, "")}/api/stage3/worker/auth/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      pairingToken: token,
      label,
      platform: detectPlatform(),
      hostname: os.hostname(),
      appVersion: await readAppVersion(),
      capabilities
    })
  });
  const body = (await response.json().catch(() => null)) as
    | {
        error?: string;
        worker?: { id: string; label: string; platform: WorkerPlatform };
        sessionToken?: string;
      }
    | null;
  if (!response.ok || !body?.worker?.id || !body.sessionToken) {
    throw new Error(body?.error || "Failed to pair Stage 3 worker.");
  }

  const config: WorkerConfig = {
    serverOrigin: server.replace(/\/+$/, ""),
    sessionToken: body.sessionToken,
    workerId: body.worker.id,
    label: body.worker.label,
    platform: body.worker.platform,
    pairedAt: new Date().toISOString()
  };
  await writeStage3WorkerConfig(config);
  return config;
}

async function pairCommand(): Promise<void> {
  const config = await pairStage3Worker({
    server: getArg("--server")?.trim() ?? "",
    token: getArg("--token")?.trim() ?? "",
    label: getArg("--label")?.trim() ?? null
  });
  console.log(`Paired Stage 3 worker: ${config.label} (${config.platform})`);
}

function printDoctorResult(capabilities: WorkerCapabilities): void {
  const rows = [
    ["ffmpeg", capabilities.ffmpeg],
    ["ffprobe", capabilities.ffprobe],
    ["yt-dlp", capabilities.ytDlp]
  ] as const;
  for (const [label, value] of rows) {
    console.log(`${label}: ${value.available ? `OK (${value.path})` : "MISSING"}`);
  }
  if (capabilities.browser.available) {
    console.log(`browser: OK (${capabilities.browser.path})`);
  } else {
    console.log("browser: no local Chrome/Edge detected, worker will fall back to Remotion-managed browser setup");
  }
  if (!capabilities.ffmpeg.available || !capabilities.ffprobe.available || !capabilities.ytDlp.available) {
    if (process.platform === "darwin") {
      console.log("Install hint: brew install ffmpeg yt-dlp");
    } else if (process.platform === "win32") {
      console.log("Install hint: winget install Gyan.FFmpeg yt-dlp.yt-dlp");
    }
  }
}

export async function runStage3WorkerDoctor(): Promise<WorkerCapabilities> {
  await ensureWorkerDirs();
  const config = await readStage3WorkerConfig();
  if (config?.serverOrigin) {
    await ensureManagedStage3WorkerTools({
      serverOrigin: config.serverOrigin,
      toolsRoot: paths().toolsRoot,
      log: (message) => console.log(message)
    });
  }
  const esbuildRuntime = await ensureEsbuildRuntimeAvailable({
    installRoot: paths().root,
    log: (message) => console.log(message)
  });
  if (!esbuildRuntime.ready) {
    throw new Error(
      `Stage 3 worker esbuild runtime is broken: ${esbuildRuntime.error ?? "missing esbuild native binary"}`
    );
  }
  if (esbuildRuntime.repaired) {
    console.log("esbuild runtime: REPAIRED");
  } else {
    console.log("esbuild runtime: OK");
  }
  const rspackRuntime = await ensureRspackRuntimeAvailable({
    installRoot: paths().root,
    log: (message) => console.log(message)
  });
  if (!rspackRuntime.ready) {
    throw new Error(
      `Stage 3 worker render runtime is broken: ${rspackRuntime.error ?? "missing rspack native binding"}`
    );
  }
  if (rspackRuntime.repaired) {
    console.log("rspack runtime: REPAIRED");
  } else {
    console.log("rspack runtime: OK");
  }
  const capabilities = await detectStage3WorkerCapabilities();
  printDoctorResult(capabilities);
  if (!capabilities.ffmpeg.available || !capabilities.ffprobe.available || !capabilities.ytDlp.available) {
    throw new Error("Stage 3 worker dependencies are missing.");
  }
  return capabilities;
}

async function doctorCommand(): Promise<void> {
  try {
    await runStage3WorkerDoctor();
  } catch (error) {
    process.exitCode = 1;
    throw error;
  }
}

async function statusCommand(): Promise<void> {
  const config = await readStage3WorkerConfig();
  if (!config) {
    console.log("Stage 3 worker is not paired.");
    return;
  }
  console.log(JSON.stringify(config, null, 2));
}

export async function logoutStage3Worker(): Promise<void> {
  await fs.rm(paths().configPath, { force: true }).catch(() => undefined);
}

async function logoutCommand(): Promise<void> {
  await logoutStage3Worker();
  console.log("Stage 3 worker config removed.");
}

type ReportedWorkerCapabilities = WorkerCapabilities & {
  admission?: Stage3WorkerAdmissionReport;
};

async function postWorkerHeartbeat(
  config: WorkerConfig,
  capabilities: ReportedWorkerCapabilities
): Promise<void> {
  await fetch(`${config.serverOrigin}/api/stage3/worker/heartbeat`, {
    method: "POST",
    headers: {
      ...authHeaders(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      appVersion: await readAppVersion(),
      capabilities
    })
  }).catch(() => undefined);
}

async function completeRemoteJob(
  config: WorkerConfig,
  job: Stage3JobEnvelope["job"],
  result: {
    resultJson: string | null;
    artifactPath: string | null;
    artifactName: string | null;
    artifactMimeType: string | null;
  }
): Promise<void> {
  const url = `${config.serverOrigin}/api/stage3/worker/jobs/${job.id}/complete`;

  async function readCompletionError(response: Response): Promise<string> {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error || `Failed to complete remote Stage 3 job (status ${response.status}).`;
  }

  if (!result.artifactPath) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...authHeaders(config),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        resultJson: result.resultJson
      })
    });
    if (!response.ok) {
      throw new Error(await readCompletionError(response));
    }
    return;
  }

  const bytes = await fs.readFile(result.artifactPath);
  const artifactName = result.artifactName || `${job.id}.mp4`;
  const artifactMimeType = result.artifactMimeType || "video/mp4";
  await completeRemoteStage3Artifact({
    url,
    authHeaders: authHeaders(config),
    jobId: job.id,
    artifactBytes: bytes,
    artifactName,
    artifactMimeType,
    resultJson: result.resultJson,
    warn: (message) => {
      console.warn(message);
    }
  });
}

async function failRemoteJob(
  config: WorkerConfig,
  job: Stage3JobEnvelope["job"],
  classified: {
    code: string;
    message: string;
    recoverable: boolean;
  }
): Promise<void> {
  await fetch(`${config.serverOrigin}/api/stage3/worker/jobs/${job.id}/fail`, {
    method: "POST",
    headers: {
      ...authHeaders(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      errorCode: classified.code,
      message: classified.message,
      recoverable: classified.recoverable
    })
  }).catch(() => undefined);
}

export async function runClaimedJobWithTimeout<T>(
  job: Stage3JobEnvelope["job"],
  payloadJson: string,
  task: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal | null
): Promise<T> {
  const timeoutMs = resolveStage3WorkerJobTimeoutMs(job.kind, process.env, payloadJson);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;

  const abortWith = (reason: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  try {
    if (externalSignal?.aborted) {
      abortWith(externalSignal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    } else if (externalSignal) {
      abortHandler = () => {
        abortWith(externalSignal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      };
      externalSignal.addEventListener("abort", abortHandler, { once: true });
    }

    const abortPromise = new Promise<T>((_resolve, reject) => {
      if (controller.signal.aborted) {
        reject(controller.signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      controller.signal.addEventListener(
        "abort",
        () => {
          reject(controller.signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        },
        { once: true }
      );
    });

    return await Promise.race([
      task(controller.signal),
      abortPromise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          abortWith(new Stage3WorkerJobTimeoutError(job.kind, timeoutMs));
          reject(new Stage3WorkerJobTimeoutError(job.kind, timeoutMs));
        }, timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (externalSignal && abortHandler) {
      externalSignal.removeEventListener("abort", abortHandler);
    }
  }
}

export async function withStage3WorkerCurrentJobId<T>(
  jobId: string,
  run: () => Promise<T>
): Promise<T> {
  const previousJobId = process.env.STAGE3_WORKER_CURRENT_JOB_ID;
  process.env.STAGE3_WORKER_CURRENT_JOB_ID = jobId;
  try {
    return await run();
  } finally {
    if (previousJobId === undefined) {
      delete process.env.STAGE3_WORKER_CURRENT_JOB_ID;
    } else {
      process.env.STAGE3_WORKER_CURRENT_JOB_ID = previousJobId;
    }
  }
}

function exitAfterTimedOutJob(): void {
  const timer = setTimeout(() => {
    process.exit(1);
  }, 500);
  timer.unref?.();
}

function summarizeStage3WorkerProgressPayload(payload: Record<string, unknown> | undefined): string {
  if (!payload || Object.keys(payload).length === 0) {
    return "";
  }
  try {
    const serialized = JSON.stringify(payload);
    return serialized.length > 420 ? `${serialized.slice(0, 417)}...` : serialized;
  } catch {
    return "[unserializable payload]";
  }
}

export function formatStage3WorkerRenderProgressLog(jobId: string, event: Stage3RenderProgressEvent): string {
  const parts = [
    `Render stage ${event.stage} ${event.status} for job ${jobId}`
  ];
  if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)) {
    parts.push(`durationMs=${Math.round(event.durationMs)}`);
  }
  const payload = summarizeStage3WorkerProgressPayload(event.payload);
  if (payload) {
    parts.push(`payload=${payload}`);
  }
  if (event.errorMessage) {
    parts.push(`error=${event.errorMessage}`);
  }
  return parts.join(" ");
}

function logStage3WorkerRenderProgress(jobId: string, event: Stage3RenderProgressEvent): void {
  const message = formatStage3WorkerRenderProgressLog(jobId, event);
  if (event.status === "failed") {
    console.error(message);
    return;
  }
  console.log(message);
}

export async function startStage3WorkerLoop(options: Stage3WorkerLoopOptions = {}): Promise<void> {
  const restartAfterRuntimeSync = options.restartAfterRuntimeSync ?? true;
  const installSignalHandlers = options.installSignalHandlers ?? true;
  const shouldStop = options.shouldStop ?? (() => false);
  const config = await readStage3WorkerConfig();
  if (!config) {
    throw new Error("Pair worker first: npm run stage3-worker -- pair --server <origin> --token <token>");
  }

  await ensureWorkerDirs();
  let syncResult: { updated: boolean; runtimeVersion: string | null } | null = null;
  try {
    syncResult = await syncStage3WorkerRuntime(config.serverOrigin, {
      sessionToken: config.sessionToken
    });
    if (syncResult.updated) {
      console.log(
        `Updated local Stage 3 worker runtime to ${syncResult.runtimeVersion ?? "latest"}.`
      );
    }
  } catch (error) {
    throw new Error(
      `Worker runtime sync failed before job loop: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (
    syncResult &&
    shouldRestartStage3WorkerAfterSync({
      bundledRuntimeVersion: BUNDLED_WORKER_RUNTIME_VERSION,
      syncResult
    })
  ) {
    if (!restartAfterRuntimeSync) {
      throw new Error(
        `Updated local Stage 3 worker runtime to ${syncResult.runtimeVersion ?? "latest"}. ` +
          "Restart Clips Worker before claiming jobs."
      );
    }
    try {
      await restartCurrentWorkerProcess(syncResult.runtimeVersion);
      return;
    } catch (error) {
      throw new Error(
        `Updated local Stage 3 worker runtime to ${syncResult.runtimeVersion ?? "latest"}, ` +
          `but automatic restart failed: ${error instanceof Error ? error.message : String(error)}. ` +
          "Rerun the Stage 3 bootstrap command or restart the worker manually before claiming jobs."
      );
    }
  }

  await ensureManagedStage3WorkerTools({
    serverOrigin: config.serverOrigin,
    toolsRoot: paths().toolsRoot,
    log: (message) => console.log(message)
  });

  const esbuildRuntime = await ensureEsbuildRuntimeAvailable({
    installRoot: paths().root,
    log: (message) => console.log(message)
  });
  if (!esbuildRuntime.ready) {
    throw new Error(
      `Stage 3 worker esbuild runtime is broken: ${esbuildRuntime.error ?? "missing esbuild native binary"}. Rerun bootstrap if this keeps happening.`
    );
  }
  if (esbuildRuntime.repaired) {
    console.log("Repaired local esbuild runtime before claiming Stage 3 jobs.");
  }

  const rspackRuntime = await ensureRspackRuntimeAvailable({
    installRoot: paths().root,
    log: (message) => console.log(message)
  });
  if (!rspackRuntime.ready) {
    throw new Error(
      `Stage 3 worker render runtime is broken: ${rspackRuntime.error ?? "missing rspack native binding"}. Rerun bootstrap if this keeps happening.`
    );
  }
  if (rspackRuntime.repaired) {
    console.log("Repaired local rspack runtime before claiming Stage 3 jobs.");
  }

  const capabilities = await detectStage3WorkerCapabilities();
  if (!capabilities.ffmpeg.available || !capabilities.ffprobe.available || !capabilities.ytDlp.available) {
    printDoctorResult(capabilities);
    throw new Error("Stage 3 worker dependencies are missing.");
  }

  process.env.APP_DATA_DIR = paths().root;
  process.env.STAGE3_WORKER_SERVER_ORIGIN = config.serverOrigin;
  process.env.STAGE3_WORKER_SESSION_TOKEN = config.sessionToken;
  process.env.STAGE3_WORKER_INSTALL_ROOT = paths().root;

  const preparedBrowser = await ensureStage3RenderBrowser({
    logLevel: "info"
  });
  process.env.STAGE3_BROWSER_EXECUTABLE = preparedBrowser.browserExecutable;
  console.log(preparedBrowser.description);

  const { classifyStage3HeavyJobError, executeStage3HeavyJobPayload } = await import("./stage3-job-executor");

  // Pre-warm the Remotion bundle once, before claiming any job, so the first
  // render does not pay the cold-bundle cost inside the render watchdog. The
  // worker reuses this memoized bundle for every subsequent render. Non-fatal.
  try {
    const { warmStage3RemotionBundle } = await import("./stage3-render-service");
    await warmStage3RemotionBundle((message) => console.log(message));
  } catch (error) {
    console.warn(
      `Stage 3 Remotion bundle pre-warm skipped: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const appVersion = await readAppVersion();
  let stop = false;
  if (installSignalHandlers) {
    process.on("SIGINT", () => {
      stop = true;
    });
    process.on("SIGTERM", () => {
      stop = true;
    });
  }

  await postWorkerHeartbeat(config, capabilities);
  console.log(`Stage 3 worker started for ${config.serverOrigin} (${config.label})`);

  let lastAdmissionLogKey = "";
  let lastAdmissionLogAt = 0;

  while (!stop && !shouldStop()) {
    try {
      if (shouldStop()) {
        break;
      }
      const admission = await collectStage3WorkerAdmissionReport({ activeWorkerJobs: 0 });
      const reportedCapabilities: ReportedWorkerCapabilities = {
        ...capabilities,
        admission
      };
      const admissionLogKey = `${admission.decision}:${admission.reasons.join(",")}`;
      if (
        admissionLogKey !== lastAdmissionLogKey ||
        Date.now() - lastAdmissionLogAt >= 30_000
      ) {
        const telemetry = admission.telemetry;
        console.log(
          [
            `Stage 3 admission ${admission.decision}`,
            `load=${telemetry.normalizedLoad1m?.toFixed(2) ?? "unknown"}`,
            `freeGb=${telemetry.freeMemoryBytes === null ? "unknown" : (telemetry.freeMemoryBytes / GIB).toFixed(2)}`,
            `activeRenderProcesses=${telemetry.activeRenderProcesses ?? "unknown"}`,
            `activeWorkerJobs=${telemetry.activeWorkerJobs}`,
            admission.reasons.length > 0 ? `reasons=${admission.reasons.join(",")}` : null
          ].filter(Boolean).join(" ")
        );
        lastAdmissionLogKey = admissionLogKey;
        lastAdmissionLogAt = Date.now();
      }
      if (!admission.admitted) {
        await postWorkerHeartbeat(config, reportedCapabilities);
        await new Promise((resolve) => setTimeout(resolve, 4000));
        continue;
      }
      const claimResponse = await fetch(`${config.serverOrigin}/api/stage3/worker/jobs/claim`, {
        method: "POST",
        headers: {
          ...authHeaders(config),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          supportedKinds: ["preview", "render", "editing-proxy", "source-download", "agent-media-step"],
          appVersion,
          capabilities: reportedCapabilities
        })
      });

      if (claimResponse.status === 204) {
        await postWorkerHeartbeat(config, reportedCapabilities);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      const claimBody = (await claimResponse.json().catch(() => null)) as
        | ({ error?: string } & Partial<ClaimedJobResponse>)
        | null;
      if (!claimResponse.ok || !claimBody?.job || typeof claimBody.payloadJson !== "string") {
        throw new Error(claimBody?.error || "Failed to claim Stage 3 job.");
      }

      const job = claimBody.job;
      const payloadJson = claimBody.payloadJson;
      console.log(`Claimed job ${job.id} (${job.kind})`);
      const jobController = new AbortController();
      const busyAdmission: Stage3WorkerAdmissionReport = {
        ...admission,
        decision: "busy",
        admitted: false,
        reasons: ["worker_job_active"],
        telemetry: {
          ...admission.telemetry,
          activeWorkerJobs: 1
        }
      };

      const leaseTimer = setInterval(() => {
        void (async () => {
          const response = await fetch(`${config.serverOrigin}/api/stage3/worker/jobs/${job.id}/heartbeat`, {
            method: "POST",
            headers: {
              ...authHeaders(config),
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              appVersion,
              capabilities: {
                ...capabilities,
                admission: busyAdmission
              }
            })
          }).catch(() => null);
          if (response && (response.status === 404 || response.status === 409)) {
            jobController.abort(new Stage3WorkerJobLeaseLostError(job.id, response.status));
          }
        })();
      }, 10_000);

      try {
        const executed = await withStage3WorkerCurrentJobId(
          job.id,
          () => runClaimedJobWithTimeout(
            job,
            payloadJson,
            (signal) =>
              executeStage3HeavyJobPayload(job.kind, payloadJson, {
                signal,
                onRenderProgress:
                  job.kind === "render" ? (event) => logStage3WorkerRenderProgress(job.id, event) : undefined
              }),
            jobController.signal
          )
        );
        try {
          await completeRemoteJob(config, job, {
            resultJson: executed.resultJson,
            artifactPath: executed.artifact?.filePath ?? null,
            artifactName: executed.artifact?.fileName ?? null,
            artifactMimeType: executed.artifact?.mimeType ?? null
          });
          console.log(`Completed job ${job.id}`);
        } finally {
          await executed.cleanup?.();
        }
      } catch (error) {
        const classified = classifyStage3HeavyJobError(job.kind, error);
        await failRemoteJob(config, job, classified);
        console.error(`Job ${job.id} failed: ${classified.message}`);
        if (isStage3WorkerJobTimeoutError(error)) {
          console.error("Stage 3 worker is exiting after a timed-out job. Restart the executor from Step 3 before continuing.");
          stop = true;
          exitAfterTimedOutJob();
        } else if (error instanceof Stage3WorkerJobLeaseLostError) {
          console.error("Stage 3 worker is exiting after the server revoked the current job lease.");
          stop = true;
          exitAfterTimedOutJob();
        }
      } finally {
        clearInterval(leaseTimer);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }
}

async function main(): Promise<void> {
  switch (getCommand()) {
    case "pair":
      await pairCommand();
      return;
    case "doctor":
      await doctorCommand();
      return;
    case "status":
      await statusCommand();
      return;
    case "logout":
      await logoutCommand();
      return;
    case "start":
      await startStage3WorkerLoop();
      return;
    default:
      console.log("Commands: pair | start | status | doctor | logout");
  }
}

export async function runStage3WorkerCli(): Promise<void> {
  await main();
}
