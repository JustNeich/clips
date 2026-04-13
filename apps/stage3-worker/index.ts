import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  detectPreferredStage3Browser,
  ensureStage3RenderBrowser
} from "../../lib/stage3-browser-runtime";

type WorkerPlatform = "darwin-arm64" | "darwin-x64" | "win32-x64" | "unknown";

type WorkerConfig = {
  serverOrigin: string;
  sessionToken: string;
  workerId: string;
  label: string;
  platform: WorkerPlatform;
  pairedAt: string;
};

type WorkerCapabilities = {
  ffmpeg: { available: boolean; path: string | null };
  ffprobe: { available: boolean; path: string | null };
  ytDlp: { available: boolean; path: string | null };
  browser: { available: boolean; path: string | null; source: string | null };
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

type WorkerRuntimeManifest = {
  version?: string;
  runtimeVersion?: string;
  builtAt?: string;
  bundleFile?: string;
  remotionFiles?: string[];
  libFiles?: string[];
  designFiles?: string[];
  publicFiles?: string[];
};

const execFileAsync = promisify(execFile);
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
  "stage3-template-badges/science-card-v1-check.png",
  "stage3-template-badges/honor-verified-badge.svg",
  "stage3-template-backdrops/science-card-v7-shell.svg",
  "stage3-template-backdrops/hedges-of-honor-v1-shell.svg"
];

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

async function detectCapabilities(): Promise<WorkerCapabilities> {
  const base = paths().toolsRoot;
  const ffmpegCandidates =
    process.platform === "win32"
      ? [path.join(base, "ffmpeg", "ffmpeg.exe"), "ffmpeg.exe", "ffmpeg"]
      : ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];
  const ffprobeCandidates =
    process.platform === "win32"
      ? [path.join(base, "ffmpeg", "ffprobe.exe"), "ffprobe.exe", "ffprobe"]
      : ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"];
  const ytDlpCandidates =
    process.platform === "win32"
      ? [path.join(base, "yt-dlp", "yt-dlp.exe"), "yt-dlp.exe", "yt-dlp"]
      : ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "yt-dlp"];

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

async function downloadBinaryFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
}

async function syncWorkerRuntime(serverOrigin: string): Promise<{ updated: boolean; runtimeVersion: string | null }> {
  const origin = serverOrigin.replace(/\/+$/, "");
  const remoteManifestResponse = await fetch(`${origin}/stage3-worker/manifest.json`, { cache: "no-store" });
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
    normalizeRuntimeVersion(process.env.CLIPS_STAGE3_WORKER_VERSION);
  const workerPaths = paths();
  const remotionDir = path.join(workerPaths.root, "remotion");
  const libDir = path.join(workerPaths.root, "lib");
  const designDir = path.join(workerPaths.root, "design");
  const publicDir = path.join(workerPaths.root, "public");
  const binDir = path.join(workerPaths.root, "bin");
  const bundleFile = remoteManifest.bundleFile?.trim() || DEFAULT_BUNDLE_FILE;
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

  if (localRuntimeVersion === remoteRuntimeVersion && !runtimeFilesMissing) {
    process.env.CLIPS_STAGE3_WORKER_VERSION = remoteRuntimeVersion;
    return { updated: false, runtimeVersion: remoteRuntimeVersion };
  }

  await fs.mkdir(remotionDir, { recursive: true });
  await fs.mkdir(libDir, { recursive: true });
  await fs.mkdir(designDir, { recursive: true });
  await fs.mkdir(publicDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  await downloadBinaryFile(`${origin}/stage3-worker/${bundleFile}`, path.join(binDir, DEFAULT_BUNDLE_FILE));
  await downloadBinaryFile(`${origin}/stage3-worker/package.json`, path.join(workerPaths.root, "package.json"));
  await downloadBinaryFile(`${origin}/stage3-worker/manifest.json`, path.join(workerPaths.root, "manifest.json"));

  for (const fileName of remotionFiles) {
    await downloadBinaryFile(
      `${origin}/stage3-worker/remotion/${fileName}`,
      path.join(remotionDir, fileName)
    );
  }
  for (const fileName of libFiles) {
    await downloadBinaryFile(
      `${origin}/stage3-worker/lib/${fileName}`,
      path.join(libDir, fileName)
    );
  }
  for (const fileName of designFiles) {
    await downloadBinaryFile(
      `${origin}/stage3-worker/design/${fileName}`,
      path.join(designDir, fileName)
    );
  }
  for (const fileName of publicFiles) {
    await downloadBinaryFile(
      `${origin}/stage3-worker/public/${fileName}`,
      path.join(publicDir, fileName)
    );
  }

  await fs.chmod(path.join(binDir, DEFAULT_BUNDLE_FILE), 0o755).catch(() => undefined);
  await execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", [
    "install",
    "--omit=dev",
    "--no-fund",
    "--no-audit"
  ], {
    cwd: workerPaths.root
  });
  process.env.CLIPS_STAGE3_WORKER_VERSION = remoteRuntimeVersion;

  return {
    updated: true,
    runtimeVersion: remoteRuntimeVersion
  };
}

async function readConfig(): Promise<WorkerConfig | null> {
  try {
    return JSON.parse(await fs.readFile(paths().configPath, "utf-8")) as WorkerConfig;
  } catch {
    return null;
  }
}

async function writeConfig(config: WorkerConfig): Promise<void> {
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
  const fromEnv = process.env.CLIPS_STAGE3_WORKER_VERSION?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version?.trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function pairCommand(): Promise<void> {
  const server = getArg("--server")?.trim();
  const token = getArg("--token")?.trim();
  const label = getArg("--label")?.trim() || `${os.hostname()} ${detectPlatform()}`;
  if (!server || !token) {
    throw new Error("Usage: npm run stage3-worker -- pair --server <origin> --token <pairing-token>");
  }

  await ensureWorkerDirs();
  const capabilities = await detectCapabilities();
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
  await writeConfig(config);
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

async function doctorCommand(): Promise<void> {
  await ensureWorkerDirs();
  const capabilities = await detectCapabilities();
  printDoctorResult(capabilities);
  if (!capabilities.ffmpeg.available || !capabilities.ffprobe.available || !capabilities.ytDlp.available) {
    process.exitCode = 1;
  }
}

async function statusCommand(): Promise<void> {
  const config = await readConfig();
  if (!config) {
    console.log("Stage 3 worker is not paired.");
    return;
  }
  console.log(JSON.stringify(config, null, 2));
}

async function logoutCommand(): Promise<void> {
  await fs.rm(paths().configPath, { force: true }).catch(() => undefined);
  console.log("Stage 3 worker config removed.");
}

async function postWorkerHeartbeat(config: WorkerConfig, capabilities: WorkerCapabilities): Promise<void> {
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

  function shouldRetryAlternateArtifactUpload(status: number | null): boolean {
    return status !== 401 && status !== 403 && status !== 404 && status !== 409;
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

  try {
    const form = new FormData();
    if (result.resultJson) {
      form.set("resultJson", result.resultJson);
    }
    form.set("artifact", new Blob([bytes], { type: artifactMimeType }), artifactName);

    const multipartResponse = await fetch(url, {
      method: "POST",
      headers: authHeaders(config),
      body: form
    });
    if (multipartResponse.ok) {
      return;
    }

    const multipartError = await readCompletionError(multipartResponse);
    if (!shouldRetryAlternateArtifactUpload(multipartResponse.status)) {
      throw new Error(multipartError);
    }
    console.warn(
      `Multipart Stage 3 completion failed for ${job.id} (${multipartResponse.status}); retrying with raw artifact upload.`
    );
  } catch (error) {
    const fallbackResponse = await fetch(url, {
      method: "POST",
      headers: {
        ...authHeaders(config),
        "Content-Type": artifactMimeType,
        "x-stage3-artifact-name": encodeURIComponent(artifactName),
        "x-stage3-artifact-mime-type": encodeURIComponent(artifactMimeType),
        ...(result.resultJson
          ? {
              "x-stage3-result-json": Buffer.from(result.resultJson, "utf-8").toString("base64url")
            }
          : {})
      },
      body: bytes
    });
    if (!fallbackResponse.ok) {
      const fallbackError = await readCompletionError(fallbackResponse);
      const primaryError = error instanceof Error ? error.message : String(error);
      throw new Error(`${primaryError}; raw upload retry failed: ${fallbackError}`);
    }
  }
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

async function startCommand(): Promise<void> {
  const config = await readConfig();
  if (!config) {
    throw new Error("Pair worker first: npm run stage3-worker -- pair --server <origin> --token <token>");
  }

  await ensureWorkerDirs();
  try {
    const syncResult = await syncWorkerRuntime(config.serverOrigin);
    if (syncResult.updated) {
      console.log(
        `Updated local Stage 3 worker runtime to ${syncResult.runtimeVersion ?? "latest"}.`
      );
    }
  } catch (error) {
    console.warn(
      `Worker runtime sync skipped: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const capabilities = await detectCapabilities();
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

  const { classifyStage3HeavyJobError, executeStage3HeavyJobPayload } = await import("../../lib/stage3-job-executor");

  const appVersion = await readAppVersion();
  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
  });
  process.on("SIGTERM", () => {
    stop = true;
  });

  await postWorkerHeartbeat(config, capabilities);
  console.log(`Stage 3 worker started for ${config.serverOrigin} (${config.label})`);

  while (!stop) {
    try {
      const claimResponse = await fetch(`${config.serverOrigin}/api/stage3/worker/jobs/claim`, {
        method: "POST",
        headers: {
          ...authHeaders(config),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          supportedKinds: ["preview", "render", "editing-proxy", "source-download", "agent-media-step"],
          appVersion,
          capabilities
        })
      });

      if (claimResponse.status === 204) {
        await postWorkerHeartbeat(config, capabilities);
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
      console.log(`Claimed job ${job.id} (${job.kind})`);

      const leaseTimer = setInterval(() => {
        void fetch(`${config.serverOrigin}/api/stage3/worker/jobs/${job.id}/heartbeat`, {
          method: "POST",
          headers: {
            ...authHeaders(config),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            appVersion,
            capabilities
          })
        }).catch(() => undefined);
      }, 10_000);

      try {
        const executed = await executeStage3HeavyJobPayload(job.kind, claimBody.payloadJson);
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
      await startCommand();
      return;
    default:
      console.log("Commands: pair | start | status | doctor | logout");
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
