#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROJECT_KINGS_CHANNELS,
  appendProjectKingsLedgerEvent,
  buildProjectKingsJudgePacket,
  buildProjectKingsPreflight,
  normalizeProjectKingsSourceKey,
  publicVerifiedSourceKeys,
  readProjectKingsLedger,
  resolveProjectKingsSemanticVerdict,
  runProjectKingsChannelsInParallel,
  summarizeProjectKingsProgress,
  withProjectKingsExternalRetry,
  type ProjectKingsChannelKey,
  type ProjectKingsLedgerEvent,
  type SemanticVerdict
} from "../lib/project-kings-daily";
import {
  reconcileYouTubePublicVerification,
  type ClipsPublicationPublicState,
  type YouTubePublicVerificationResult
} from "../lib/youtube-public-verification";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_APP_URL = "https://clips-vy11.onrender.com";
const DEFAULT_DOCS_DIR = path.join(REPO_ROOT, "docs", "project-kings-daily");
const DEFAULT_STATE_DIR = path.join(os.homedir(), ".local", "state", "project-kings-daily");
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "interrupted", "canceled"]);
const TRANSIENT_HTTP = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const ACTIVE_PUBLICATION_STATUSES = new Set(["queued", "uploading", "scheduled", "published"]);
const RECENT_LOCK_GRACE_MS = 2 * 60_000;

type ChannelConfig = {
  key: ProjectKingsChannelKey;
  channelId: string;
  name: string;
  username: string;
  stage2HardConstraints?: Record<string, unknown>;
  youtubeChannelId: string;
};

const CHANNELS: Record<ProjectKingsChannelKey, ChannelConfig> = {
  dark: {
    key: "dark",
    channelId: "4b59c5cf412e4c07b192f3312361c2eb",
    name: "Dark JoyBoy",
    username: "DarknessJoyBoy",
    youtubeChannelId: "UCwO37rtHMhHX8caUr5Rc0Bw"
  },
  light: {
    key: "light",
    channelId: "43923d42c1c0495282f29d4c6e09b0b4",
    name: "THE LIGHT KINGDOM",
    username: "The_LIghtKingdom",
    youtubeChannelId: "UC0LWZYpYuYAWK55WmvDqxbg"
  },
  cop: {
    key: "cop",
    channelId: "6187aeeea7bd47188e08089c5916edc1",
    name: "COP SCOPES",
    username: "copscopes-x2e",
    youtubeChannelId: "UCJhBMXXQ5GrTbrhqjwT1leg"
  }
};

type SourceCandidate = {
  sourceUrl: string;
  preapproved: boolean;
  note?: string;
};

type SourceCatalog = {
  schemaVersion: number;
  evidenceSnapshot: string;
  channels: Record<ProjectKingsChannelKey, SourceCandidate[]>;
};

type RuntimeConfig = {
  appUrl: string;
  cdpUrl: string | null;
  tokenPath: string | null;
  docsDir: string;
  sourcesPath: string;
  stateDir: string;
  ledgerPath: string;
  runId: string;
  model: string;
  targetPerChannel: number;
  publish: boolean;
  waitForPublic: boolean;
  preflightOnly: boolean;
  refillOnly: boolean;
  pollMs: number;
  maxStageWaitMs: number;
  maxPublicWaitMs: number;
};

type RuntimeDocs = {
  readme: string;
  channels: string;
  source: string;
  captionMontage: string;
  qa: string;
  runbook: string;
};

type ControlChannel = {
  id: string;
  name: string;
  username: string;
  stage2HardConstraints?: Record<string, unknown> | null;
  publishing?: {
    ready?: boolean;
    settings?: { timezone?: string; firstSlotLocalTime?: string; dailySlotCount?: number };
    integration?: { selectedYoutubeChannelId?: string | null; status?: string | null } | null;
  };
};

type Publication = {
  id: string;
  channelId: string;
  chatId: string;
  status: string;
  scheduledAt: string;
  sourceUrl: string;
  youtubeVideoId: string | null;
  youtubeVideoUrl: string | null;
  lastError: string | null;
  updatedAt: string;
};

type SourcePacket = {
  chatId: string;
  sourceUrl: string;
  pipelineSourceUrl: string;
  decomposition: Record<string, unknown>;
  decompositionPath: string;
  framePaths: string[];
  sourceArtifact: Record<string, unknown>;
};

type ApprovedRender = {
  chatId: string;
  sourceUrl: string;
  pipelineSourceUrl: string;
  stage3JobId: string;
  artifactPath: string;
  artifactSha256: string;
  judgeEvidenceSha256: string;
  caption: Record<string, unknown>;
};

class HttpFailure extends Error {
  readonly status: number;
  readonly payload: unknown;
  readonly url: string;

  constructor(message: string, input: { status: number; payload: unknown; url: string }) {
    super(message);
    this.name = "HttpFailure";
    this.status = input.status;
    this.payload = input.payload;
    this.url = input.url;
  }
}

class ReplaceSource extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplaceSource";
  }
}

class CaptionRework extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = [message]) {
    super(message);
    this.name = "CaptionRework";
    this.issues = issues;
  }
}

class AmbiguousExternalResult extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousExternalResult";
  }
}

function expandHome(value: string): string {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return parsed;
}

function defaultDailyRunId(): string {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  return `kings-${local}`;
}

function parseArgs(argv: string[]): RuntimeConfig {
  const stateDir = expandHome(process.env.PROJECT_KINGS_STATE_DIR?.trim() || DEFAULT_STATE_DIR);
  const result: RuntimeConfig = {
    appUrl: (process.env.CLIPS_APP_URL?.trim() || DEFAULT_APP_URL).replace(/\/+$/, ""),
    cdpUrl: process.env.CLIPS_CDP_URL?.trim() || null,
    tokenPath: process.env.CLIPS_TOKEN_PATH?.trim() || null,
    docsDir: DEFAULT_DOCS_DIR,
    sourcesPath: path.join(DEFAULT_DOCS_DIR, "sources.json"),
    stateDir,
    ledgerPath: path.join(stateDir, "project-kings-ledger.jsonl"),
    runId: process.env.PROJECT_KINGS_RUN_ID?.trim() || defaultDailyRunId(),
    model: process.env.PROJECT_KINGS_MODEL?.trim() || "gpt-5.6-luna",
    targetPerChannel: 3,
    publish: true,
    waitForPublic: true,
    preflightOnly: false,
    refillOnly: false,
    pollMs: 15_000,
    maxStageWaitMs: 30 * 60_000,
    maxPublicWaitMs: 36 * 60 * 60_000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    const next = () => {
      const value = argv[++index];
      if (!value) throw new Error(`${flag} requires a value.`);
      return value;
    };
    if (flag === "--app-url") result.appUrl = next().replace(/\/+$/, "");
    else if (flag === "--cdp-url") result.cdpUrl = next().replace(/\/+$/, "");
    else if (flag === "--token-path") result.tokenPath = next();
    else if (flag === "--docs-dir") result.docsDir = path.resolve(next());
    else if (flag === "--sources") result.sourcesPath = path.resolve(next());
    else if (flag === "--state-dir") result.stateDir = expandHome(next());
    else if (flag === "--run-id") result.runId = next();
    else if (flag === "--model") result.model = next();
    else if (flag === "--target-per-channel") result.targetPerChannel = Math.min(3, parsePositiveInt(next(), flag));
    else if (flag === "--poll-seconds") result.pollMs = parsePositiveInt(next(), flag) * 1_000;
    else if (flag === "--max-stage-wait-minutes") result.maxStageWaitMs = parsePositiveInt(next(), flag) * 60_000;
    else if (flag === "--max-public-wait-hours") result.maxPublicWaitMs = parsePositiveInt(next(), flag) * 60 * 60_000;
    else if (flag === "--no-publish") {
      result.publish = false;
      result.waitForPublic = false;
    } else if (flag === "--no-wait-public") result.waitForPublic = false;
    else if (flag === "--preflight-only") result.preflightOnly = true;
    else if (flag === "--refill-only") result.refillOnly = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  result.ledgerPath = path.join(result.stateDir, "project-kings-ledger.jsonl");
  if (!/^[A-Za-z0-9._:-]{6,120}$/.test(result.runId)) {
    throw new Error("--run-id contains unsupported characters.");
  }
  return result;
}

function loadDocs(docsDir: string): RuntimeDocs {
  const read = (name: string) => readFileSync(path.join(docsDir, name), "utf8");
  return {
    readme: read("README.md"),
    channels: read("CHANNELS.md"),
    source: read("SOURCE.md"),
    captionMontage: read("CAPTION_MONTAGE.md"),
    qa: read("QA.md"),
    runbook: read("RUNBOOK.md")
  };
}

function readCatalog(filePath: string): SourceCatalog {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as SourceCatalog;
  if (parsed.schemaVersion !== 1) throw new Error("Unsupported Project Kings source catalog schema.");
  for (const key of PROJECT_KINGS_CHANNELS) {
    if (!Array.isArray(parsed.channels[key])) throw new Error(`Source catalog is missing ${key}.`);
  }
  return parsed;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableExternal(error: unknown): boolean {
  if (error instanceof AmbiguousExternalResult) return true;
  if (error instanceof HttpFailure) return TRANSIENT_HTTP.has(error.status);
  const candidate = error as (NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException }) | null;
  const code = candidate?.code ?? candidate?.cause?.code;
  return Boolean(code && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(code));
}

type RunLockRecord = {
  pid: number;
  runId: string;
  startedAt: string;
};

function parseRunLock(raw: string): RunLockRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<RunLockRecord>;
    if (!Number.isInteger(value.pid) || Number(value.pid) < 1 || typeof value.runId !== "string" || !value.runId) {
      return null;
    }
    return {
      pid: Number(value.pid),
      runId: value.runId,
      startedAt: typeof value.startedAt === "string" ? value.startedAt : ""
    };
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "EPERM";
  }
}

function acquireRunLock(lockPath: string, runId: string): number {
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, runId, startedAt: new Date().toISOString() }));
        return fd;
      } catch (error) {
        closeSync(fd);
        rmSync(lockPath, { force: true });
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST" || pass > 0) {
        throw new Error(`Another Project Kings run owns ${lockPath}: ${String(error)}`);
      }
      const record = parseRunLock(readFileSync(lockPath, "utf8"));
      if (record && isProcessAlive(record.pid)) {
        throw new Error(`Another Project Kings run ${record.runId} (pid ${record.pid}) owns ${lockPath}.`);
      }
      if (!record) {
        const ageMs = Date.now() - statSync(lockPath).mtimeMs;
        if (ageMs < RECENT_LOCK_GRACE_MS) {
          throw new Error(`Project Kings lock ${lockPath} is incomplete but still recent.`);
        }
      }
      rmSync(lockPath, { force: true });
    }
  }
  throw new Error(`Could not acquire Project Kings lock ${lockPath}.`);
}

function releaseRunLock(lockPath: string, lockFd: number | null, runId: string): void {
  if (lockFd !== null) closeSync(lockFd);
  try {
    const record = parseRunLock(readFileSync(lockPath, "utf8"));
    if (record?.pid === process.pid && record.runId === runId) {
      rmSync(lockPath, { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw error;
  }
}

function tokenFromFile(filePath: string): string {
  const raw = readFileSync(expandHome(filePath), "utf8").trim();
  const match = raw.match(/^\s*CLIPS_MCP_TOKEN\s*=\s*["']?([^\s"']+)["']?\s*$/m);
  const token = match?.[1] ?? (raw.includes("\n") ? "" : raw);
  if (!token) throw new Error(`CLIPS_MCP_TOKEN is missing in ${expandHome(filePath)}.`);
  return token;
}

async function cookiesFromCdp(cdpUrl: string, appUrl: string): Promise<string> {
  const tabsResponse = await fetch(`${cdpUrl}/json/list`);
  if (!tabsResponse.ok) throw new Error(`CDP list failed: HTTP ${tabsResponse.status}.`);
  const tabs = (await tabsResponse.json()) as Array<{ url?: string; webSocketDebuggerUrl?: string }>;
  const origin = new URL(appUrl).origin;
  const tab = tabs.find((candidate) => candidate.url?.startsWith(origin)) ?? tabs.find((candidate) => candidate.webSocketDebuggerUrl);
  if (!tab?.webSocketDebuggerUrl) throw new Error(`No authenticated Clips tab found at ${cdpUrl}.`);
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket connection failed.")), { once: true });
  });
  let nextId = 1;
  const call = <T>(method: string, params: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const listener = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as { id?: number; result?: T; error?: unknown };
        if (message.id !== id) return;
        socket.removeEventListener("message", listener);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result as T);
      };
      socket.addEventListener("message", listener);
      socket.send(JSON.stringify({ id, method, params }));
    });
  const response = await call<{ cookies: Array<{ name: string; value: string; domain: string; expires?: number }> }>(
    "Network.getAllCookies"
  );
  socket.close();
  const hostname = new URL(appUrl).hostname;
  const nowSec = Date.now() / 1_000;
  const cookies = response.cookies.filter((cookie) => {
    const domain = cookie.domain.replace(/^\./, "");
    return (hostname === domain || hostname.endsWith(`.${domain}`)) && (!cookie.expires || cookie.expires < 0 || cookie.expires > nowSec);
  });
  if (!cookies.length) throw new Error("Authenticated Clips cookies were not found in CDP.");
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

class ClipsClient {
  readonly appUrl: string;
  readonly headers: Record<string, string>;

  private constructor(appUrl: string, headers: Record<string, string>) {
    this.appUrl = appUrl;
    this.headers = headers;
  }

  static async create(config: RuntimeConfig): Promise<ClipsClient> {
    const envToken = process.env.CLIPS_MCP_TOKEN?.trim();
    const defaultProtectedPath = path.join(os.homedir(), ".config", "assistant", "clips-mcp.env");
    if (envToken) return new ClipsClient(config.appUrl, { Authorization: `Bearer ${envToken}` });
    if (config.tokenPath) return new ClipsClient(config.appUrl, { Authorization: `Bearer ${tokenFromFile(config.tokenPath)}` });
    if (existsSync(defaultProtectedPath)) {
      return new ClipsClient(config.appUrl, { Authorization: `Bearer ${tokenFromFile(defaultProtectedPath)}` });
    }
    if (config.cdpUrl) return new ClipsClient(config.appUrl, { Cookie: await cookiesFromCdp(config.cdpUrl, config.appUrl) });
    throw new Error("No protected Clips credential or --cdp-url was provided.");
  }

  async requestJson<T>(urlOrPath: string, init: RequestInit = {}, attempts = 3): Promise<T> {
    const url = new URL(urlOrPath, this.appUrl).toString();
    return withProjectKingsExternalRetry(
      async () => {
        const response = await fetch(url, {
          ...init,
          headers: {
            Accept: "application/json",
            ...this.headers,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...(init.headers ?? {})
          }
        });
        const text = await response.text();
        let payload: unknown = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = text;
        }
        if (!response.ok) {
          const message =
            payload && typeof payload === "object" && "error" in payload
              ? String((payload as { error: unknown }).error)
              : `HTTP ${response.status}`;
          throw new HttpFailure(message, { status: response.status, payload, url });
        }
        return payload as T;
      },
      { maxAttempts: attempts, isRetryable: isRetryableExternal }
    );
  }

  control<T>(tool: string, input: Record<string, unknown> = {}, attempts = 3): Promise<T> {
    return this.requestJson<T>(
      "/api/admin/control",
      { method: "POST", body: JSON.stringify({ tool, input }) },
      attempts
    );
  }

  async download(urlOrPath: string, destination: string): Promise<void> {
    const url = new URL(urlOrPath, this.appUrl).toString();
    await withProjectKingsExternalRetry(
      async () => {
        const response = await fetch(url, { headers: this.headers });
        if (!response.ok) throw new HttpFailure(`Download HTTP ${response.status}`, { status: response.status, payload: null, url });
        writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
      },
      { maxAttempts: 3, isRetryable: isRetryableExternal }
    );
  }

  async uploadSource(channelId: string, filePath: string, idempotencyKey: string): Promise<Record<string, unknown>> {
    const url = new URL("/api/pipeline/source-upload", this.appUrl).toString();
    const body = readFileSync(filePath);
    return withProjectKingsExternalRetry(
      async () => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            ...this.headers,
            Accept: "application/json",
            "Content-Type": "video/mp4",
            "X-Channel-Id": channelId,
            "X-File-Name": encodeURIComponent(path.basename(filePath)),
            "X-Auto-Run-Stage2": "false",
            "X-Agent-Decomposition": "true",
            "X-Idempotency-Key": idempotencyKey
          },
          body
        });
        const text = await response.text();
        const payload = text ? (JSON.parse(text) as unknown) : null;
        if (!response.ok) {
          const message = payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error: unknown }).error)
            : `Upload HTTP ${response.status}`;
          throw new HttpFailure(message, { status: response.status, payload, url });
        }
        return payload as Record<string, unknown>;
      },
      { maxAttempts: 3, isRetryable: isRetryableExternal }
    );
  }
}

function runCommand(command: string, args: string[], input?: string, timeoutMs = 10 * 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed (${signal ?? code}): ${stderr.slice(-2_000)}`));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function assertLocalTool(command: string, args: string[] = ["--version"]): Promise<void> {
  await runCommand(command, args, undefined, 30_000);
}

async function inspectMedia(filePath: string, outputDir: string): Promise<{ probe: Record<string, unknown>; framePaths: string[] }> {
  mkdirSync(outputDir, { recursive: true });
  const probeResult = await runCommand(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath],
    undefined,
    60_000
  );
  const probe = JSON.parse(probeResult.stdout) as Record<string, unknown>;
  const duration = Number((probe.format as { duration?: string } | undefined)?.duration ?? 6);
  const streams = Array.isArray(probe.streams) ? probe.streams.map(asRecord).filter(Boolean) as Record<string, unknown>[] : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const width = Number(video?.width ?? 0);
  const height = Number(video?.height ?? 0);
  if (!video || !audio) throw new ReplaceSource("Rendered MP4 must contain both video and audio streams.");
  if (!Number.isFinite(duration) || duration < 3 || duration > 30) {
    throw new ReplaceSource(`Rendered MP4 duration ${String(duration)}s is outside 3-30s.`);
  }
  if (width < 720 || height < 1280 || height <= width) {
    throw new ReplaceSource(`Rendered MP4 resolution ${width}x${height} is not a valid vertical Short.`);
  }
  await runCommand("ffmpeg", ["-v", "error", "-i", filePath, "-f", "null", "-"], undefined, 3 * 60_000);
  const fps = Math.max(0.1, 6 / Math.max(1, duration));
  const framePattern = path.join(outputDir, "frame-%02d.jpg");
  await runCommand(
    "ffmpeg",
    ["-y", "-v", "error", "-i", filePath, "-vf", `fps=${fps.toFixed(4)},scale=720:-2`, "-frames:v", "8", framePattern],
    undefined,
    3 * 60_000
  );
  const framePaths = Array.from({ length: 8 }, (_, index) => path.join(outputDir, `frame-${String(index + 1).padStart(2, "0")}.jpg`)).filter(
    existsSync
  );
  if (framePaths.length < 3) throw new Error(`Media inspection produced only ${framePaths.length} frames.`);
  return { probe, framePaths };
}

function findNamedFile(root: string, fileName: string): string | null {
  if (!existsSync(root)) return null;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name === fileName) return absolute;
    }
  }
  return null;
}

function findPreparedSourceFile(sourceUrl: string): string | null {
  const sourceId = normalizeProjectKingsSourceKey(sourceUrl).split(":").slice(1).join(":");
  if (!sourceId) return null;
  const roots = [
    process.env.PROJECT_KINGS_SOURCE_CACHE_ROOT?.trim(),
    path.join(REPO_ROOT, ".data", "project-kings", "source-candidates"),
    "/Users/neich/Documents/Macedonian Imperium/clips automations/.data/project-kings/source-candidates"
  ].filter((item): item is string => Boolean(item));
  for (const root of [...new Set(roots)]) {
    const found = findNamedFile(root, `${sourceId}.mp4`);
    if (found && statSync(found).size > 1_024) return found;
  }
  return null;
}

async function prepareLocalSourceFile(sourceUrl: string, outputDir: string): Promise<string> {
  const prepared = findPreparedSourceFile(sourceUrl);
  if (prepared) return prepared;
  const destination = path.join(outputDir, "source-fallback.mp4");
  await runCommand(
    "yt-dlp",
    [
      "--no-playlist",
      "--merge-output-format",
      "mp4",
      "--remux-video",
      "mp4",
      "-f",
      "bv*+ba/b",
      "-o",
      destination,
      sourceUrl
    ],
    undefined,
    10 * 60_000
  );
  if (!existsSync(destination) || statSync(destination).size < 1_024) {
    throw new Error("Local yt-dlp fallback did not produce a usable MP4.");
  }
  await runCommand("ffprobe", ["-v", "error", "-show_format", "-of", "json", destination], undefined, 60_000);
  return destination;
}

const MODEL_SCHEMAS = {
  sourceMaker: {
    type: "object",
    additionalProperties: false,
    required: ["decision", "summary", "visibleEvidence", "factualClaims"],
    properties: {
      decision: { type: "string", enum: ["PASS", "REPLACE"] },
      summary: { type: "string" },
      visibleEvidence: { type: "array", items: { type: "string" } },
      factualClaims: { type: "array", items: { type: "string" } }
    }
  },
  judge: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "issues", "summary"],
    properties: {
      verdict: { type: "string", enum: ["PASS", "REWORK", "REPLACE"] },
      issues: { type: "array", items: { type: "string" } },
      summary: { type: "string" }
    }
  },
  captionMaker: {
    type: "object",
    additionalProperties: false,
    required: ["top", "bottom", "topRu", "bottomRu", "title", "description", "montage"],
    properties: {
      top: { type: "string" },
      bottom: { type: "string" },
      topRu: { type: "string" },
      bottomRu: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      montage: {
        type: "object",
        additionalProperties: false,
        required: ["clipStartSec", "clipDurationSec", "focusY", "videoZoom", "sourceCrop"],
        properties: {
          clipStartSec: { type: "number", minimum: 0 },
          clipDurationSec: { type: "number", minimum: 3, maximum: 30 },
          focusY: { type: "number", minimum: 0, maximum: 1 },
          videoZoom: { type: "number", minimum: 0.8, maximum: 2 },
          sourceCrop: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y", "width", "height"],
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
              width: { type: "number", minimum: 0.1, maximum: 1 },
              height: { type: "number", minimum: 0.1, maximum: 1 }
            }
          }
        }
      }
    }
  }
} as const;

function extractUsage(stdout: string): unknown {
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Record<string, unknown>[];
  return [...events].reverse().find((event) => "usage" in event)?.usage ?? null;
}

type SemanticModelCall = {
  config: RuntimeConfig;
  event: (event: Omit<ProjectKingsLedgerEvent, "runId" | "at">) => void;
  channelKey: ProjectKingsChannelKey;
  slot: number | null;
  role: string;
  prompt: string;
  schema: Record<string, unknown>;
  images?: string[];
  workDir: string;
};

let semanticJudgeTail: Promise<void> = Promise.resolve();

async function callSemanticModelNow<T>(input: SemanticModelCall): Promise<T> {
  mkdirSync(input.workDir, { recursive: true });
  const callId = `${input.role}-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const schemaPath = path.join(input.workDir, `${callId}-schema.json`);
  const outputPath = path.join(input.workDir, `${callId}-output.json`);
  writeFileSync(schemaPath, JSON.stringify(input.schema, null, 2));
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--model",
    input.config.model,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "--json",
    "-C",
    input.workDir
  ];
  for (const imagePath of input.images ?? []) args.push("-i", imagePath);
  args.push("-");
  const startedAt = Date.now();
  const result = await runCommand("codex", args, input.prompt, 12 * 60_000);
  const output = JSON.parse(readFileSync(outputPath, "utf8")) as T;
  input.event({
    channelKey: input.channelKey,
    slot: input.slot,
    stage: "model_call_completed",
    attemptKind: "semantic",
    artifactRefs: {
      role: input.role,
      model: input.config.model,
      elapsedMs: Date.now() - startedAt,
      usage: extractUsage(result.stdout),
      costUsd: null,
      outputPath
    }
  });
  return output;
}

async function callSemanticModel<T>(input: SemanticModelCall): Promise<T> {
  if (!input.role.endsWith("judge")) {
    return callSemanticModelNow<T>(input);
  }
  const previous = semanticJudgeTail;
  let release = () => {};
  semanticJudgeTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await callSemanticModelNow<T>(input);
  } finally {
    release();
  }
}

type RunnerContext = {
  config: RuntimeConfig;
  docs: RuntimeDocs;
  catalog: SourceCatalog;
  client: ClipsClient;
  runDir: string;
  event: (event: Omit<ProjectKingsLedgerEvent, "runId" | "at">) => void;
  stopping: () => boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function findRecord(value: unknown, predicate: (record: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecord(item, predicate);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (predicate(record)) return record;
  for (const item of Object.values(record)) {
    const found = findRecord(item, predicate);
    if (found) return found;
  }
  return null;
}

function findRecords(value: unknown, predicate: (record: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const matches: Record<string, unknown>[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    const record = asRecord(current);
    if (!record) return;
    if (predicate(record)) matches.push(record);
    for (const item of Object.values(record)) visit(item);
  };
  visit(value);
  return matches;
}

function isActivePublication(publication: Publication): boolean {
  return ACTIVE_PUBLICATION_STATUSES.has(publication.status) && !publication.lastError;
}

function channelRunDir(context: RunnerContext, channelKey: ProjectKingsChannelKey, slot: number | null, sourceUrl?: string): string {
  const slotPart = slot ? `slot-${slot}` : "buffer";
  const sourcePart = sourceUrl ? sha256(sourceUrl).slice(0, 12) : "portfolio";
  const directory = path.join(context.runDir, channelKey, slotPart, sourcePart);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function compactDecomposition(decomposition: Record<string, unknown>): Record<string, unknown> {
  const comments = Array.isArray(decomposition.comments) ? decomposition.comments.slice(0, 30) : [];
  const frames = Array.isArray(decomposition.frames)
    ? decomposition.frames.slice(0, 24).map((frame) => {
        const record = asRecord(frame);
        return record
          ? { timestampSec: record.timestampSec ?? null, description: asString(record.description) }
          : frame;
      })
    : [];
  const subtitles = asRecord(decomposition.subtitles);
  return {
    sourceKey: decomposition.sourceKey ?? null,
    comments,
    frames,
    subtitles: subtitles
      ? {
          available: subtitles.available ?? false,
          segments: Array.isArray(subtitles.segments) ? subtitles.segments.slice(0, 80) : []
        }
      : null,
    meta: decomposition.meta ?? null
  };
}

async function waitForDecomposition(
  context: RunnerContext,
  channelKey: ProjectKingsChannelKey,
  chatId: string,
  sourceJobId: string,
  slot: number | null
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + context.config.maxStageWaitMs;
  while (Date.now() <= deadline) {
    if (context.stopping()) throw new Error("Safe stop requested.");
    try {
      const sourceStatus = await context.client.requestJson<Record<string, unknown>>(
        `/api/pipeline/source?jobId=${encodeURIComponent(sourceJobId)}`,
        {},
        3
      );
      const sourceJob = asRecord(sourceStatus.job);
      const jobStatus = asString(sourceJob?.status);
      if (jobStatus === "failed") {
        const progress = asRecord(sourceJob?.progress);
        throw new ReplaceSource(
          asString(sourceJob?.errorMessage) ?? asString(progress?.error) ?? `${channelKey}: source job failed.`
        );
      }
      return await context.client.control<Record<string, unknown>>(
        "clips_flow_get_source_decomposition",
        { chatId },
        3
      );
    } catch (error) {
      if (!(error instanceof HttpFailure) || error.status !== 404) throw error;
      const detail = await context.client.control<Record<string, unknown>>("clips_owner_get_flow", { chatId }, 3);
      const flow = asRecord(detail.flow);
      if (flow?.latestStatus === "failed") {
        throw new ReplaceSource(asString(flow.lastError) ?? `${channelKey}: source decomposition failed.`);
      }
    }
    await sleep(context.config.pollMs);
  }
  context.event({ channelKey, slot, stage: "source_timeout", stopReason: "source_decomposition_timeout" });
  throw new ReplaceSource(`${channelKey}: source decomposition timed out.`);
}

async function downloadDecompositionFrames(
  context: RunnerContext,
  decomposition: Record<string, unknown>,
  outputDir: string
): Promise<string[]> {
  const frames = Array.isArray(decomposition.frames) ? decomposition.frames : [];
  const selected = frames.length <= 8
    ? frames
    : Array.from({ length: 8 }, (_, index) => frames[Math.round((index * (frames.length - 1)) / 7)]);
  const frameDir = path.join(outputDir, "source-frames");
  mkdirSync(frameDir, { recursive: true });
  const paths: string[] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const frame = asRecord(selected[index]);
    const imageUrl = asString(frame?.imageUrl);
    if (!imageUrl) continue;
    const destination = path.join(frameDir, `frame-${String(index + 1).padStart(2, "0")}.jpg`);
    await context.client.download(imageUrl, destination);
    paths.push(destination);
  }
  if (paths.length < 3) throw new ReplaceSource("Source decomposition has fewer than three readable frames.");
  return paths;
}

async function startAgentSource(
  context: RunnerContext,
  channel: ChannelConfig,
  candidate: SourceCandidate,
  slot: number | null
): Promise<{ chatId: string; sourceJobId: string; pipelineSourceUrl: string }> {
  const outputDir = channelRunDir(context, channel.key, slot, candidate.sourceUrl);
  try {
    const localFile = await prepareLocalSourceFile(candidate.sourceUrl, outputDir);
    const sourceMediaSha256 = sha256(readFileSync(localFile));
    const duplicateMedia = readProjectKingsLedger(context.config.ledgerPath).find((event) => {
      const refs = asRecord(event.artifactRefs);
      return (
        event.stage === "local_source_uploaded" &&
        asString(refs?.sourceMediaSha256) === sourceMediaSha256 &&
        normalizeProjectKingsSourceKey(event.sourceUrl ?? "") !== normalizeProjectKingsSourceKey(candidate.sourceUrl)
      );
    });
    if (duplicateMedia) {
      throw new ReplaceSource(
        `Source media duplicates ${duplicateMedia.channelKey}/${duplicateMedia.runId} (${duplicateMedia.sourceUrl ?? "unknown source"}).`
      );
    }
    if (context.stopping()) throw new Error("Safe stop requested before source upload.");
    const uploadIdempotencyKey = `project-kings-${sha256(
      `${context.config.runId}\0${channel.key}\0${slot ?? "buffer"}\0${candidate.sourceUrl}\0${sourceMediaSha256}`
    )}`;
    const uploaded = await context.client.uploadSource(channel.channelId, localFile, uploadIdempotencyKey);
    const uploadChat = asRecord(uploaded.chat);
    const uploadJob = asRecord(uploaded.job);
    const uploadChatId = asString(uploadChat?.id);
    const uploadJobId = asString(uploadJob?.jobId);
    const pipelineSourceUrl = asString(uploadJob?.sourceUrl) ?? asString(uploadChat?.url);
    if (!uploadChatId || !uploadJobId || !pipelineSourceUrl) {
      throw new Error("Local source upload returned no chat, job, or upload URL.");
    }
    context.event({
      channelKey: channel.key,
      slot,
      stage: "local_source_uploaded",
      sourceUrl: candidate.sourceUrl,
      artifactRefs: { localFile, sourceMediaSha256, uploadChatId, uploadJobId, pipelineSourceUrl }
    });
    const uploadDeadline = Date.now() + Math.min(context.config.maxStageWaitMs, 5 * 60_000);
    let uploadCompleted = false;
    while (Date.now() <= uploadDeadline) {
      if (context.stopping()) throw new Error("Safe stop requested while source upload is reconcilable.");
      const status = await context.client.requestJson<Record<string, unknown>>(
        `/api/pipeline/source?jobId=${encodeURIComponent(uploadJobId)}`,
        {},
        3
      );
      const job = asRecord(status.job);
      const jobStatus = asString(job?.status);
      if (jobStatus === "completed") {
        uploadCompleted = true;
        break;
      }
      if (["failed", "canceled", "interrupted"].includes(jobStatus ?? "")) {
        throw new Error(asString(job?.errorMessage) ?? `Uploaded source preparation ${jobStatus}.`);
      }
      await sleep(context.config.pollMs);
    }
    if (!uploadCompleted) throw new Error("Uploaded source preparation timed out.");
    try {
      await context.client.control("clips_flow_get_source_decomposition", { chatId: uploadChatId }, 1);
      return { chatId: uploadChatId, sourceJobId: uploadJobId, pipelineSourceUrl };
    } catch (error) {
      if (!(error instanceof HttpFailure) || error.status !== 404) throw error;
    }
    if (context.stopping()) throw new Error("Safe stop requested after source upload reconciliation.");
    const agent = await context.client.control<Record<string, unknown>>(
      "clips_owner_run_agent_pipeline",
      {
        channelId: channel.channelId,
        sourceUrl: pipelineSourceUrl,
        title: `Project Kings ${context.config.runId} ${channel.key}`,
        eventText: `Original source: ${candidate.sourceUrl}`
      },
      1
    );
    const agentChatId = asString(asRecord(agent.chat)?.id);
    const agentJobId = asString(asRecord(agent.job)?.jobId);
    if (!agentChatId || !agentJobId) throw new Error("Uploaded agent source start returned no chat or source job id.");
    return { chatId: agentChatId, sourceJobId: agentJobId, pipelineSourceUrl };
  } catch (error) {
    if (error instanceof ReplaceSource) throw error;
    context.event({
      channelKey: channel.key,
      slot,
      stage: "local_source_fallback_failed",
      sourceUrl: candidate.sourceUrl,
      stopReason: error instanceof Error ? error.message : String(error)
    });
    if (context.stopping()) throw error;
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (context.stopping()) throw new Error("Safe stop requested before source fallback.");
    try {
      const started = await context.client.control<Record<string, unknown>>(
        "clips_owner_run_agent_pipeline",
        {
          channelId: channel.channelId,
          sourceUrl: candidate.sourceUrl,
          title: `Project Kings ${context.config.runId} ${channel.key}`,
          eventText: candidate.note ?? ""
        },
        1
      );
      const chat = asRecord(started.chat);
      const job = asRecord(started.job);
      const chatId = asString(chat?.id);
      const sourceJobId = asString(job?.jobId);
      if (!chatId || !sourceJobId) throw new Error("Agent source start returned no chat or source job id.");
      return { chatId, sourceJobId, pipelineSourceUrl: candidate.sourceUrl };
    } catch (error) {
      const payload = error instanceof HttpFailure ? asRecord(error.payload) : null;
      const job = asRecord(payload?.job);
      const reconciledChatId = asString(job?.chatId);
      const reconciledJobId = asString(job?.jobId);
      if (reconciledChatId && reconciledJobId) {
        context.event({
          channelKey: channel.key,
          slot,
          stage: "source_start_reconciled",
          sourceUrl: candidate.sourceUrl,
          attemptKind: "external",
          attempt
        });
        return { chatId: reconciledChatId, sourceJobId: reconciledJobId, pipelineSourceUrl: candidate.sourceUrl };
      }
      if (attempt >= 3 || !isRetryableExternal(error)) throw error;
      await sleep(attempt * 1_000);
    }
  }
  throw new Error("Source start retry loop exhausted.");
}

function reusableSourcePacket(
  context: RunnerContext,
  channelKey: ProjectKingsChannelKey,
  sourceUrl: string
): SourcePacket | null {
  const key = normalizeProjectKingsSourceKey(sourceUrl);
  const existing = [...readProjectKingsLedger(context.config.ledgerPath)].reverse().find(
    (event) =>
      event.runId === context.config.runId &&
      event.channelKey === channelKey &&
      event.stage === "source_fit_verified" &&
      normalizeProjectKingsSourceKey(event.sourceUrl ?? "") === key
  );
  const refs = asRecord(existing?.artifactRefs);
  const decompositionPath = asString(refs?.decompositionPath);
  const framePaths = Array.isArray(refs?.framePaths) ? refs.framePaths.filter((item): item is string => typeof item === "string") : [];
  const sourceArtifact = asRecord(refs?.sourceArtifact);
  const chatId = asString(refs?.chatId);
  const pipelineSourceUrl = asString(refs?.pipelineSourceUrl) ?? sourceUrl;
  if (!chatId || !decompositionPath || !existsSync(decompositionPath) || framePaths.some((item) => !existsSync(item)) || !sourceArtifact) {
    return null;
  }
  return {
    chatId,
    sourceUrl,
    pipelineSourceUrl,
    decomposition: JSON.parse(readFileSync(decompositionPath, "utf8")) as Record<string, unknown>,
    decompositionPath,
    framePaths,
    sourceArtifact
  };
}

async function prepareAndJudgeSource(
  context: RunnerContext,
  channel: ChannelConfig,
  candidate: SourceCandidate,
  slot: number | null,
  reworkBudget: { count: number }
): Promise<SourcePacket> {
  const reusable = reusableSourcePacket(context, channel.key, candidate.sourceUrl);
  if (reusable) return reusable;
  const outputDir = channelRunDir(context, channel.key, slot, candidate.sourceUrl);
  const { chatId, sourceJobId, pipelineSourceUrl } = await startAgentSource(context, channel, candidate, slot);
  context.event({
    channelKey: channel.key,
    slot,
    stage: "source_started",
    sourceUrl: candidate.sourceUrl,
    artifactRefs: { chatId, sourceJobId, pipelineSourceUrl }
  });
  const decomposition = await waitForDecomposition(context, channel.key, chatId, sourceJobId, slot);
  const decompositionPath = path.join(outputDir, "source-decomposition.json");
  writeFileSync(decompositionPath, JSON.stringify(decomposition, null, 2));
  const framePaths = await downloadDecompositionFrames(context, decomposition, outputDir);
  const sourceInput = {
    channel: { key: channel.key, name: channel.name, youtubeChannelId: channel.youtubeChannelId },
    candidate,
    decomposition: compactDecomposition(decomposition)
  };
  let reworkIssues: string[] = [];
  while (true) {
    const sourceArtifact = await callSemanticModel<Record<string, unknown>>({
      config: context.config,
      event: context.event,
      channelKey: channel.key,
      slot,
      role: "source-maker",
      schema: MODEL_SCHEMAS.sourceMaker,
      images: framePaths,
      workDir: path.join(outputDir, "model"),
      prompt: [
        "You are the source-fit maker. Return only the compact JSON artifact required by the schema; never expose chain-of-thought.",
        "Runtime channel rules:",
        context.docs.channels,
        "Runtime source rules:",
        context.docs.source,
        `Clean input packet:\n${JSON.stringify(sourceInput)}`,
        reworkIssues.length ? `Exact rework issues from the independent judge:\n${JSON.stringify(reworkIssues)}` : ""
      ].filter(Boolean).join("\n\n")
    });
    if (sourceArtifact.decision !== "PASS") throw new ReplaceSource("Source maker returned REPLACE.");
    const judgePacket = buildProjectKingsJudgePacket({
      sourceInput,
      artifact: sourceArtifact,
      criteria: { channels: context.docs.channels, source: context.docs.source, qa: context.docs.qa }
    });
    const judge = await callSemanticModel<{ verdict: SemanticVerdict; issues: string[]; summary: string }>({
      config: context.config,
      event: context.event,
      channelKey: channel.key,
      slot,
      role: "source-judge",
      schema: MODEL_SCHEMAS.judge,
      images: framePaths,
      workDir: path.join(outputDir, "model"),
      prompt: [
        "You are the independent blind source judge. You see the input, artifact, and criteria, but no maker reasoning.",
        "Fail closed on channel mismatch, duplicates, donor UI, hard captions, unsupported claims, unusable footage, or policy risk.",
        `Judge packet:\n${JSON.stringify(judgePacket)}`
      ].join("\n\n")
    });
    const action = resolveProjectKingsSemanticVerdict({ verdict: judge.verdict, reworksDone: reworkBudget.count, maxReworks: 2 });
    if (action === "advance") {
      context.event({
        channelKey: channel.key,
        slot,
        stage: "source_fit_verified",
        sourceUrl: candidate.sourceUrl,
        artifactRefs: { chatId, decompositionPath, framePaths, sourceArtifact, judge, pipelineSourceUrl }
      });
      return {
        chatId,
        sourceUrl: candidate.sourceUrl,
        pipelineSourceUrl,
        decomposition,
        decompositionPath,
        framePaths,
        sourceArtifact
      };
    }
    if (action === "replace") throw new ReplaceSource(`Source judge: ${judge.summary}`);
    reworkBudget.count += 1;
    reworkIssues = judge.issues;
  }
}

async function startAndWaitStage2(
  context: RunnerContext,
  channel: ChannelConfig,
  packet: SourcePacket,
  caption: Record<string, unknown>,
  slot: number
): Promise<void> {
  let runId: string | null = null;
  const enqueueStartedAt = Date.now();
  const expectedAgentCaption = {
    top: asString(caption.top) ?? "",
    bottom: asString(caption.bottom) ?? "",
    topRu: asString(caption.topRu) ?? "",
    bottomRu: asString(caption.bottomRu) ?? ""
  };
  for (let attempt = 1; attempt <= 3 && !runId; attempt += 1) {
    try {
      const started = await context.client.control<Record<string, unknown>>(
        "clips_owner_run_video_pipeline",
        {
          channelId: channel.channelId,
          sourceUrl: packet.pipelineSourceUrl,
          title: asString(caption.title) ?? `${channel.name} Short`,
          eventText: asString(caption.description) ?? "",
          userInstruction: context.docs.captionMontage,
          mode: "agent_manual",
          agentCaption: expectedAgentCaption
        },
        1
      );
      runId = asString(asRecord(started.run)?.runId);
      if (!runId) throw new AmbiguousExternalResult("Stage 2 start returned no run id.");
    } catch (error) {
      if (!isRetryableExternal(error)) throw error;
      const detail = await context.client.control<Record<string, unknown>>("clips_owner_get_flow", { chatId: packet.chatId }, 3);
      const active = findRecords(detail, (record) => {
        if (!asString(record.runId) || !["queued", "running", "completed"].includes(asString(record.status) ?? "")) {
          return false;
        }
        const createdAt = Date.parse(asString(record.createdAt) ?? "");
        if (!Number.isFinite(createdAt) || createdAt < enqueueStartedAt - 2_000) return false;
        const request = asRecord(record.request);
        const sourceUrl = asString(record.sourceUrl) ?? asString(request?.sourceUrl);
        if (
          !sourceUrl ||
          normalizeProjectKingsSourceKey(sourceUrl) !== normalizeProjectKingsSourceKey(packet.pipelineSourceUrl)
        ) {
          return false;
        }
        const agentCaption = asRecord(request?.agentCaption);
        return (
          asString(agentCaption?.top) === expectedAgentCaption.top &&
          asString(agentCaption?.bottom) === expectedAgentCaption.bottom &&
          (asString(agentCaption?.topRu) ?? "") === expectedAgentCaption.topRu &&
          (asString(agentCaption?.bottomRu) ?? "") === expectedAgentCaption.bottomRu
        );
      }).sort((left, right) => (asString(right.createdAt) ?? "").localeCompare(asString(left.createdAt) ?? ""))[0];
      runId = asString(active?.runId);
      if (!runId && attempt >= 3) throw error;
      if (!runId) await sleep(attempt * 1_000);
    }
  }
  if (!runId) throw new Error("Stage 2 start could not be reconciled.");
  context.event({ channelKey: channel.key, slot, stage: "stage2_started", sourceUrl: packet.sourceUrl, artifactRefs: { chatId: packet.chatId, runId } });
  const deadline = Date.now() + context.config.maxStageWaitMs;
  while (Date.now() <= deadline) {
    if (context.stopping()) throw new Error("Safe stop requested.");
    const detail = await context.client.control<Record<string, unknown>>("clips_owner_get_flow", { chatId: packet.chatId, selectedRunId: runId }, 3);
    const run = findRecord(detail, (record) => asString(record.runId) === runId);
    const status = asString(run?.status);
    if (status === "completed") return;
    if (["failed", "canceled", "interrupted"].includes(status ?? "")) {
      const message = asString(run?.errorMessage) ?? "unknown error";
      if (/caption|constraint|length|banned|TOP|BOTTOM/i.test(message)) {
        throw new CaptionRework(`Stage 2 ${status}: ${message}`);
      }
      throw new ReplaceSource(`Stage 2 ${status}: ${message}`);
    }
    await sleep(context.config.pollMs);
  }
  throw new ReplaceSource("Stage 2 timed out.");
}

function buildSnapshot(caption: Record<string, unknown>, approval?: Record<string, unknown>): Record<string, unknown> {
  const montage = asRecord(caption.montage) ?? {};
  const crop = asRecord(montage.sourceCrop) ?? {};
  const x = Number(crop.x ?? 0);
  const y = Number(crop.y ?? 0);
  const width = Math.min(1 - x, Number(crop.width ?? 1));
  const height = Math.min(1 - y, Number(crop.height ?? 1));
  return {
    topText: asString(caption.top) ?? "",
    bottomText: asString(caption.bottom) ?? "",
    clipStartSec: Math.max(0, Number(montage.clipStartSec ?? 0)),
    clipDurationSec: Math.max(3, Math.min(30, Number(montage.clipDurationSec ?? 6))),
    focusY: Math.max(0, Math.min(1, Number(montage.focusY ?? 0.5))),
    renderPlan: {
      videoZoom: Math.max(0.8, Math.min(2, Number(montage.videoZoom ?? 1))),
      sourceCrop: {
        enabled: true,
        x: Math.max(0, Math.min(0.9, x)),
        y: Math.max(0, Math.min(0.9, y)),
        width: Math.max(0.1, width),
        height: Math.max(0.1, height),
        confidence: 1,
        source: "project-kings-maker-judge",
        reviewedAt: new Date().toISOString()
      }
    },
    ...(approval ? { zoroKingApproval: approval } : {})
  };
}

async function waitStage3Job(
  context: RunnerContext,
  channelKey: ProjectKingsChannelKey,
  slot: number,
  pollUrl: string
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + context.config.maxStageWaitMs;
  while (Date.now() <= deadline) {
    if (context.stopping()) throw new Error("Safe stop requested.");
    const envelope = await context.client.requestJson<Record<string, unknown>>(pollUrl, {}, 3);
    const job = asRecord(envelope.job);
    const status = asString(job?.status);
    if (status === "completed") return envelope;
    if (status && TERMINAL_JOB_STATUSES.has(status)) {
      throw new ReplaceSource(`Stage 3 ${status}: ${asString(job?.errorMessage) ?? "unknown error"}`);
    }
    await sleep(context.config.pollMs);
  }
  context.event({ channelKey, slot, stage: "stage3_timeout", stopReason: "stage3_timeout" });
  throw new ReplaceSource("Stage 3 job timed out.");
}

async function renderArtifact(
  context: RunnerContext,
  channel: ChannelConfig,
  packet: SourcePacket,
  slot: number,
  snapshot: Record<string, unknown>,
  kind: "preview" | "render",
  outputDir: string
): Promise<{ jobId: string; filePath: string; sha256: string; probe: Record<string, unknown>; framePaths: string[] }> {
  const enqueueStartedAt = Date.now();
  let started: Record<string, unknown> | null = null;
  for (let attempt = 1; attempt <= 3 && !started; attempt += 1) {
    try {
      started = kind === "preview"
        ? await context.client.control<Record<string, unknown>>(
            "clips_owner_render_preview",
            { channelId: channel.channelId, sourceUrl: packet.pipelineSourceUrl, chatId: packet.chatId, snapshot },
            1
          )
        : await context.client.control<Record<string, unknown>>(
            "clips_owner_render_video",
            { channelId: channel.channelId, chatId: packet.chatId, publishAfterRender: false, snapshot },
            1
          );
    } catch (error) {
      const payload = error instanceof HttpFailure ? asRecord(error.payload) : null;
      if (asString(payload?.code) === "text_constraints_failed") {
        const issues = Array.isArray(payload?.issues)
          ? payload.issues.filter((item): item is string => typeof item === "string")
          : [error instanceof Error ? error.message : String(error)];
        throw new CaptionRework("Render caption constraints failed.", issues);
      }
      const detail = await context.client.control<Record<string, unknown>>(
        "clips_owner_get_flow",
        { chatId: packet.chatId },
        3
      );
      const jobs = Array.isArray(detail.stage3Jobs) ? detail.stage3Jobs.map(asRecord).filter(Boolean) as Record<string, unknown>[] : [];
      const reconciled = jobs
        .filter((job) => asString(job.kind) === kind && Date.parse(asString(job.createdAt) ?? "") >= enqueueStartedAt - 2_000)
        .sort((left, right) => (asString(right.createdAt) ?? "").localeCompare(asString(left.createdAt) ?? ""))[0];
      const reconciledId = asString(reconciled?.id);
      if (reconciledId) {
        started = {
          job: reconciled,
          pollUrl: `/api/stage3/${kind === "preview" ? "preview" : "render"}/jobs/${reconciledId}`,
          ...(kind === "render" ? { downloadUrl: `/api/admin/render-exports/${reconciledId}` } : {})
        };
        context.event({
          channelKey: channel.key,
          slot,
          stage: `${kind}_start_reconciled`,
          sourceUrl: packet.sourceUrl,
          attemptKind: "external",
          attempt,
          artifactRefs: { jobId: reconciledId }
        });
        break;
      }
      if (attempt >= 3 || !isRetryableExternal(error)) throw error;
      await sleep(attempt * 1_000);
    }
  }
  if (!started) throw new Error(`${kind} enqueue could not be reconciled.`);
  const job = asRecord(started.job);
  const jobId = asString(job?.id);
  const pollUrl = asString(started.pollUrl);
  if (!jobId || !pollUrl) throw new Error(`${kind} enqueue returned no job id or poll URL.`);
  context.event({ channelKey: channel.key, slot, stage: `${kind}_started`, sourceUrl: packet.sourceUrl, artifactRefs: { jobId, pollUrl } });
  const completed = await waitStage3Job(context, channel.key, slot, pollUrl);
  const completedJob = asRecord(completed.job);
  const artifact = asRecord(completedJob?.artifact);
  const downloadUrl = kind === "render" ? asString(started.downloadUrl) : asString(artifact?.downloadUrl);
  if (!downloadUrl) throw new Error(`${kind} completed without a download URL.`);
  const filePath = path.join(outputDir, `${kind}-${jobId}.mp4`);
  await context.client.download(downloadUrl, filePath);
  const media = await inspectMedia(filePath, path.join(outputDir, `${kind}-${jobId}-frames`));
  return { jobId, filePath, sha256: sha256(readFileSync(filePath)), probe: media.probe, framePaths: media.framePaths };
}

async function judgeRenderedArtifact(
  context: RunnerContext,
  channel: ChannelConfig,
  slot: number,
  packet: SourcePacket,
  caption: Record<string, unknown>,
  media: { filePath: string; sha256: string; probe: Record<string, unknown>; framePaths: string[] },
  role: "preview-judge" | "final-judge",
  outputDir: string
): Promise<{ verdict: SemanticVerdict; issues: string[]; summary: string }> {
  const judgePacket = buildProjectKingsJudgePacket({
    sourceInput: {
      channel: { key: channel.key, name: channel.name },
      sourceUrl: packet.sourceUrl,
      sourceArtifact: packet.sourceArtifact,
      caption
    },
    artifact: { sha256: media.sha256, probe: media.probe },
    criteria: context.docs.qa
  });
  return callSemanticModel({
    config: context.config,
    event: context.event,
    channelKey: channel.key,
    slot,
    role,
    schema: MODEL_SCHEMAS.judge,
    images: media.framePaths,
    workDir: path.join(outputDir, "model"),
    prompt: [
      "You are the independent final-video judge. Inspect the actual rendered MP4 frames and probe evidence.",
      "You do not see maker reasoning. PASS only when crop, hook-development-payoff, text, donor UI/watermark/captions, audio/video, and channel fit all pass.",
      `Judge packet:\n${JSON.stringify(judgePacket)}`
    ].join("\n\n")
  });
}

async function makeCaptionAndMontage(
  context: RunnerContext,
  channel: ChannelConfig,
  slot: number,
  packet: SourcePacket,
  reworkBudget: { count: number },
  exactIssues: string[] = []
): Promise<Record<string, unknown>> {
  const outputDir = channelRunDir(context, channel.key, slot, packet.sourceUrl);
  const channelState = await context.client.control<Record<string, unknown>>(
    "clips_owner_get_channel",
    { channelId: channel.channelId },
    3
  );
  const stage2HardConstraints = asRecord(asRecord(channelState.channel)?.stage2HardConstraints);
  let issues = exactIssues;
  while (true) {
    const cleanInput = {
      channel: {
        key: channel.key,
        name: channel.name,
        youtubeChannelId: channel.youtubeChannelId,
        stage2HardConstraints
      },
      sourceUrl: packet.sourceUrl,
      sourceArtifact: packet.sourceArtifact,
      decomposition: compactDecomposition(packet.decomposition)
    };
    const caption = await callSemanticModel<Record<string, unknown>>({
      config: context.config,
      event: context.event,
      channelKey: channel.key,
      slot,
      role: "caption-montage-maker",
      schema: MODEL_SCHEMAS.captionMaker,
      images: packet.framePaths,
      workDir: path.join(outputDir, "model"),
      prompt: [
        "You are the caption and montage maker. Return only the compact artifact required by the schema; no chain-of-thought.",
        "Use only visible, supportable facts. Build hook -> development -> payoff and keep the main action visible after crop.",
        "Runtime channel rules:",
        context.docs.channels,
        "Runtime caption/montage rules:",
        context.docs.captionMontage,
        `Clean input packet:\n${JSON.stringify(cleanInput)}`,
        issues.length ? `Exact issues to repair:\n${JSON.stringify(issues)}` : ""
      ].filter(Boolean).join("\n\n")
    });
    const packetForJudge = buildProjectKingsJudgePacket({
      sourceInput: cleanInput,
      artifact: caption,
      criteria: { captionMontage: context.docs.captionMontage, qa: context.docs.qa }
    });
    const judge = await callSemanticModel<{ verdict: SemanticVerdict; issues: string[]; summary: string }>({
      config: context.config,
      event: context.event,
      channelKey: channel.key,
      slot,
      role: "caption-montage-judge",
      schema: MODEL_SCHEMAS.judge,
      images: packet.framePaths,
      workDir: path.join(outputDir, "model"),
      prompt: [
        "You are the independent blind caption/montage judge. You do not see maker reasoning.",
        "PASS only when text, claims, hook-development-payoff, clip timing, and crop all obey the runtime criteria.",
        `Judge packet:\n${JSON.stringify(packetForJudge)}`
      ].join("\n\n")
    });
    const action = resolveProjectKingsSemanticVerdict({ verdict: judge.verdict, reworksDone: reworkBudget.count, maxReworks: 2 });
    if (action === "advance") return caption;
    if (action === "replace") throw new ReplaceSource(`Caption/montage judge: ${judge.summary}`);
    reworkBudget.count += 1;
    issues = judge.issues;
  }
}

async function prepareApprovedRender(
  context: RunnerContext,
  channel: ChannelConfig,
  candidate: SourceCandidate,
  slot: number
): Promise<ApprovedRender> {
  const outputDir = channelRunDir(context, channel.key, slot, candidate.sourceUrl);
  const reworkBudget = { count: 0 };
  const packet = await prepareAndJudgeSource(context, channel, candidate, slot, reworkBudget);
  let exactIssues: string[] = [];
  while (true) {
    const caption = await makeCaptionAndMontage(context, channel, slot, packet, reworkBudget, exactIssues);
    try {
      await startAndWaitStage2(context, channel, packet, caption, slot);
    } catch (error) {
      if (!(error instanceof CaptionRework)) throw error;
      const action = resolveProjectKingsSemanticVerdict({ verdict: "REWORK", reworksDone: reworkBudget.count, maxReworks: 2 });
      if (action === "replace") throw new ReplaceSource(error.message);
      reworkBudget.count += 1;
      exactIssues = error.issues;
      continue;
    }
    let preview;
    try {
      preview = await renderArtifact(context, channel, packet, slot, buildSnapshot(caption), "preview", outputDir);
    } catch (error) {
      if (!(error instanceof CaptionRework)) throw error;
      const action = resolveProjectKingsSemanticVerdict({ verdict: "REWORK", reworksDone: reworkBudget.count, maxReworks: 2 });
      if (action === "replace") throw new ReplaceSource(error.message);
      reworkBudget.count += 1;
      exactIssues = error.issues;
      continue;
    }
    const previewJudge = await judgeRenderedArtifact(context, channel, slot, packet, caption, preview, "preview-judge", outputDir);
    let action = resolveProjectKingsSemanticVerdict({ verdict: previewJudge.verdict, reworksDone: reworkBudget.count, maxReworks: 2 });
    if (action === "replace") throw new ReplaceSource(`Preview judge: ${previewJudge.summary}`);
    if (action === "rework") {
      reworkBudget.count += 1;
      exactIssues = previewJudge.issues;
      continue;
    }
    const approval = {
      status: "approved",
      source: "project-kings-independent-judge",
      judgeVerdict: "approved",
      innerVideoOnly: true,
      donorWrapperVisible: false,
      approvedAt: new Date().toISOString(),
      previewFrames: preview.framePaths.map((framePath) => sha256(readFileSync(framePath)))
    };
    let rendered;
    try {
      rendered = await renderArtifact(context, channel, packet, slot, buildSnapshot(caption, approval), "render", outputDir);
    } catch (error) {
      if (!(error instanceof CaptionRework)) throw error;
      const action = resolveProjectKingsSemanticVerdict({ verdict: "REWORK", reworksDone: reworkBudget.count, maxReworks: 2 });
      if (action === "replace") throw new ReplaceSource(error.message);
      reworkBudget.count += 1;
      exactIssues = error.issues;
      continue;
    }
    const finalJudge = await judgeRenderedArtifact(context, channel, slot, packet, caption, rendered, "final-judge", outputDir);
    action = resolveProjectKingsSemanticVerdict({ verdict: finalJudge.verdict, reworksDone: reworkBudget.count, maxReworks: 2 });
    if (action === "replace") throw new ReplaceSource(`Final judge: ${finalJudge.summary}`);
    if (action === "rework") {
      reworkBudget.count += 1;
      exactIssues = finalJudge.issues;
      continue;
    }
    const judgeEvidenceSha256 = sha256(JSON.stringify({
      renderSha256: rendered.sha256,
      verdict: finalJudge,
      previewSha256: preview.sha256
    }));
    context.event({
      channelKey: channel.key,
      slot,
      stage: "qa_passed",
      sourceUrl: candidate.sourceUrl,
      attemptKind: "semantic",
      attempt: reworkBudget.count + 1,
      artifactRefs: {
        chatId: packet.chatId,
        stage3JobId: rendered.jobId,
        artifactPath: rendered.filePath,
        artifactSha256: rendered.sha256,
        judgeEvidenceSha256,
        pipelineSourceUrl: packet.pipelineSourceUrl,
        caption
      }
    });
    return {
      chatId: packet.chatId,
      sourceUrl: candidate.sourceUrl,
      pipelineSourceUrl: packet.pipelineSourceUrl,
      stage3JobId: rendered.jobId,
      artifactPath: rendered.filePath,
      artifactSha256: rendered.sha256,
      judgeEvidenceSha256,
      caption
    };
  }
}

function reusableApprovedRender(context: RunnerContext, channelKey: ProjectKingsChannelKey, slot: number): ApprovedRender | null {
  const event = [...readProjectKingsLedger(context.config.ledgerPath)].reverse().find(
    (candidate) => candidate.runId === context.config.runId && candidate.channelKey === channelKey && candidate.slot === slot && candidate.stage === "qa_passed"
  );
  const refs = asRecord(event?.artifactRefs);
  const artifactPath = asString(refs?.artifactPath);
  const stage3JobId = asString(refs?.stage3JobId);
  const artifactSha256 = asString(refs?.artifactSha256);
  const judgeEvidenceSha256 = asString(refs?.judgeEvidenceSha256);
  const chatId = asString(refs?.chatId);
  const pipelineSourceUrl = asString(refs?.pipelineSourceUrl) ?? event?.sourceUrl ?? null;
  const caption = asRecord(refs?.caption);
  if (!event?.sourceUrl || !pipelineSourceUrl || !artifactPath || !existsSync(artifactPath) || !stage3JobId || !artifactSha256 || !judgeEvidenceSha256 || !chatId || !caption) {
    return null;
  }
  if (sha256(readFileSync(artifactPath)) !== artifactSha256) throw new Error(`${channelKey} slot ${slot}: approved MP4 hash drift.`);
  return {
    chatId,
    sourceUrl: event.sourceUrl,
    pipelineSourceUrl,
    stage3JobId,
    artifactPath,
    artifactSha256,
    judgeEvidenceSha256,
    caption
  };
}

async function listChannelPublications(context: RunnerContext, channel: ChannelConfig): Promise<Publication[]> {
  const result = await context.client.control<{ publications?: Publication[] }>(
    "clips_owner_list_publications",
    { channelId: channel.channelId, limit: 200 },
    2
  );
  return Array.isArray(result.publications) ? result.publications : [];
}

async function queueApprovedRender(
  context: RunnerContext,
  channel: ChannelConfig,
  slot: number,
  approved: ApprovedRender
): Promise<Publication> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const existing = (await listChannelPublications(context, channel)).find(
      (publication) =>
        publication.chatId === approved.chatId &&
        normalizeProjectKingsSourceKey(publication.sourceUrl) === normalizeProjectKingsSourceKey(approved.pipelineSourceUrl) &&
        isActivePublication(publication)
    );
    if (existing) {
      context.event({
        channelKey: channel.key,
        slot,
        stage: "upload_reconciled",
        sourceUrl: approved.sourceUrl,
        attemptKind: "external",
        attempt,
        publicationId: existing.id,
        youtubeVideoId: existing.youtubeVideoId,
        artifactRefs: { action: existing.youtubeVideoId ? "reconcile_video_id" : "lookup_publication" }
      });
      return existing;
    }
    try {
      const queued = await context.client.control<{ publication?: Publication }>(
        "clips_owner_queue_approved_render",
        {
          channelId: channel.channelId,
          stage3JobId: approved.stage3JobId,
          expectedSourceUrl: approved.pipelineSourceUrl,
          judgeVerdict: "PASS",
          judgeEvidenceSha256: approved.judgeEvidenceSha256
        },
        1
      );
      if (!queued.publication) throw new Error("Approved render queue returned no publication.");
      if (!isActivePublication(queued.publication)) {
        throw new Error(
          `Approved render publication ${queued.publication.id} is ${queued.publication.status}: ${queued.publication.lastError ?? "no detail"}.`
        );
      }
      return queued.publication;
    } catch (error) {
      const retryable = isRetryableExternal(error);
      if (retryable) {
        const reconciled = (await listChannelPublications(context, channel)).find(
          (publication) =>
            publication.chatId === approved.chatId &&
            normalizeProjectKingsSourceKey(publication.sourceUrl) === normalizeProjectKingsSourceKey(approved.pipelineSourceUrl) &&
            isActivePublication(publication)
        );
        if (reconciled) return reconciled;
      }
      if (attempt >= 3 || !retryable) throw error;
      await sleep(attempt * 1_000);
    }
  }
  throw new Error("Approved render queue retry loop exhausted.");
}

function excludedSourceKeys(context: RunnerContext, publications: Publication[]): Set<string> {
  const events = readProjectKingsLedger(context.config.ledgerPath);
  const excluded = publicVerifiedSourceKeys(events);
  const activePublicationIds = new Set<string>();
  for (const publication of publications) {
    if (publication.status !== "canceled") {
      activePublicationIds.add(publication.id);
      excluded.add(normalizeProjectKingsSourceKey(publication.sourceUrl));
    }
  }
  for (const event of events) {
    if (
      event.stage === "publication_queued" &&
      event.publicationId &&
      activePublicationIds.has(event.publicationId) &&
      event.sourceUrl
    ) {
      excluded.add(normalizeProjectKingsSourceKey(event.sourceUrl));
    }
    if (
      event.runId === context.config.runId &&
      ["qa_passed", "publication_queued", "public_verified"].includes(event.stage) &&
      event.sourceUrl
    ) {
      excluded.add(normalizeProjectKingsSourceKey(event.sourceUrl));
    }
    if (event.runId === context.config.runId && event.stage === "source_replaced" && event.sourceUrl) {
      excluded.add(normalizeProjectKingsSourceKey(event.sourceUrl));
    }
  }
  return excluded;
}

function selectedRunSourceKeys(context: RunnerContext): Set<string> {
  return new Set(
    readProjectKingsLedger(context.config.ledgerPath)
      .filter((event) => event.runId === context.config.runId && event.sourceUrl && ["candidate_selected", "qa_passed", "publication_queued"].includes(event.stage))
      .map((event) => normalizeProjectKingsSourceKey(event.sourceUrl ?? ""))
  );
}

async function runChannel(
  context: RunnerContext,
  channelKey: ProjectKingsChannelKey,
  allPublications: Publication[],
  reservation: Set<string>
): Promise<{ ready: number; queued: Publication[] }> {
  const channel = CHANNELS[channelKey];
  const queued: Publication[] = [];
  for (let slot = 1; slot <= context.config.targetPerChannel; slot += 1) {
    if (context.stopping()) throw new Error("Safe stop requested.");
    const alreadyQueued = [...readProjectKingsLedger(context.config.ledgerPath)].reverse().find(
      (event) => event.runId === context.config.runId && event.channelKey === channelKey && event.slot === slot && event.stage === "publication_queued"
    );
    if (alreadyQueued?.publicationId) {
      const publication = (await listChannelPublications(context, channel)).find((item) => item.id === alreadyQueued.publicationId);
      if (publication && isActivePublication(publication)) {
        queued.push(publication);
        continue;
      }
    }
    let approved = reusableApprovedRender(context, channelKey, slot);
    if (!approved) {
      const excluded = excludedSourceKeys(context, allPublications);
      let lastError: unknown = null;
      for (const candidate of context.catalog.channels[channelKey]) {
        const key = normalizeProjectKingsSourceKey(candidate.sourceUrl);
        if (!key || excluded.has(key) || reservation.has(key)) continue;
        reservation.add(key);
        context.event({ channelKey, slot, stage: "candidate_selected", sourceUrl: candidate.sourceUrl });
        try {
          approved = await prepareApprovedRender(context, channel, candidate, slot);
          break;
        } catch (error) {
          if (context.stopping()) throw error;
          if (!(error instanceof ReplaceSource)) throw error;
          lastError = error;
          context.event({
            channelKey,
            slot,
            stage: "source_replaced",
            sourceUrl: candidate.sourceUrl,
            stopReason: error instanceof Error ? error.message : String(error)
          });
        }
      }
      if (!approved) throw lastError ?? new Error(`${channelKey}: no source candidate could fill slot ${slot}.`);
    } else {
      reservation.add(normalizeProjectKingsSourceKey(approved.sourceUrl));
    }
    if (!context.config.publish) {
      context.event({
        channelKey,
        slot,
        stage: "control_ready_no_publication",
        sourceUrl: approved.sourceUrl,
        artifactRefs: { stage3JobId: approved.stage3JobId, artifactSha256: approved.artifactSha256 }
      });
      continue;
    }
    if (context.stopping()) throw new Error("Safe stop requested before publication queue.");
    const publication = await queueApprovedRender(context, channel, slot, approved);
    context.event({
      channelKey,
      slot,
      stage: "publication_queued",
      sourceUrl: approved.sourceUrl,
      publicationId: publication.id,
      youtubeVideoId: publication.youtubeVideoId,
      artifactRefs: { scheduledAt: publication.scheduledAt, status: publication.status, stage3JobId: approved.stage3JobId }
    });
    queued.push(publication);
  }
  return { ready: context.config.targetPerChannel, queued };
}

function sourceVerifiedKeys(context: RunnerContext, channelKey: ProjectKingsChannelKey): Set<string> {
  const verified = new Set(
    context.catalog.channels[channelKey]
      .filter((candidate) => candidate.preapproved)
      .map((candidate) => normalizeProjectKingsSourceKey(candidate.sourceUrl))
  );
  for (const event of readProjectKingsLedger(context.config.ledgerPath)) {
    if (event.channelKey === channelKey && event.stage === "source_fit_verified" && event.sourceUrl) {
      verified.add(normalizeProjectKingsSourceKey(event.sourceUrl));
    }
  }
  return verified;
}

async function refillChannelBuffer(
  context: RunnerContext,
  channelKey: ProjectKingsChannelKey,
  allPublications: Publication[],
  minBuffer = 6
): Promise<number> {
  const channel = CHANNELS[channelKey];
  const excluded = excludedSourceKeys(context, allPublications);
  const countAvailable = () => [...sourceVerifiedKeys(context, channelKey)].filter((key) => !excluded.has(key)).length;
  let available = countAvailable();
  for (const candidate of context.catalog.channels[channelKey]) {
    if (available >= minBuffer) break;
    const key = normalizeProjectKingsSourceKey(candidate.sourceUrl);
    if (!key || excluded.has(key) || sourceVerifiedKeys(context, channelKey).has(key)) continue;
    try {
      await prepareAndJudgeSource(context, channel, candidate, null, { count: 0 });
      available = countAvailable();
    } catch (error) {
      if (context.stopping()) throw error;
      if (!(error instanceof ReplaceSource)) throw error;
      context.event({
        channelKey,
        slot: null,
        stage: "source_replaced",
        sourceUrl: candidate.sourceUrl,
        stopReason: error instanceof Error ? error.message : String(error)
      });
      excluded.add(key);
    }
  }
  if (available < minBuffer) throw new Error(`${channelKey}: refiller restored only ${available}/${minBuffer} verified sources.`);
  context.event({ channelKey, slot: null, stage: "buffer_restored", artifactRefs: { available, required: minBuffer } });
  return available;
}

async function readAllPublications(context: RunnerContext): Promise<Publication[]> {
  const groups = await Promise.all(PROJECT_KINGS_CHANNELS.map((key) => listChannelPublications(context, CHANNELS[key])));
  return groups.flat();
}

async function runPreflight(context: RunnerContext): Promise<{
  channels: ControlChannel[];
  publications: Publication[];
  sourceBuffer: Record<ProjectKingsChannelKey, number>;
  bufferReady: boolean;
}> {
  await Promise.all([
    assertLocalTool("codex", ["--version"]),
    assertLocalTool("ffmpeg", ["-version"]),
    assertLocalTool("ffprobe", ["-version"])
  ]);
  const [channelResult, workerResult] = await Promise.all([
    context.client.control<{ channels?: ControlChannel[] }>("clips_owner_list_channels", {}, 2),
    context.client.control<Record<string, unknown>>("clips_owner_list_stage3_workers", {}, 2)
  ]);
  const channels = Array.isArray(channelResult.channels) ? channelResult.channels : [];
  const onlineWorker = findRecord(workerResult, (record) => {
    const status = asString(record.status)?.toLowerCase();
    return status === "online" || status === "ready";
  });
  if (!onlineWorker) throw new Error("Preflight: no online Stage 3 worker.");
  const publications = await readAllPublications(context);
  const excluded = excludedSourceKeys(context, publications);
  const preflightChannels = PROJECT_KINGS_CHANNELS.map((key) => {
    const expected = CHANNELS[key];
    const actual = channels.find((channel) => channel.id === expected.channelId);
    const verified = sourceVerifiedKeys(context, key);
    return {
      key,
      channelId: expected.channelId,
      expectedYoutubeChannelId: expected.youtubeChannelId,
      actualYoutubeChannelId: actual?.publishing?.integration?.selectedYoutubeChannelId ?? null,
      publishingReady: actual?.publishing?.ready === true,
      timezone: actual?.publishing?.settings?.timezone ?? null,
      candidates: context.catalog.channels[key].filter((candidate) => {
        const sourceKey = normalizeProjectKingsSourceKey(candidate.sourceUrl);
        return verified.has(sourceKey) && !excluded.has(sourceKey);
      })
    };
  });
  const hardPreflight = buildProjectKingsPreflight({ channels: preflightChannels, ledger: [], publications: [], minBuffer: 0 });
  if (!hardPreflight.ready) throw new Error(`Project Kings preflight failed:\n${hardPreflight.errors.join("\n")}`);
  const bufferPreflight = buildProjectKingsPreflight({ channels: preflightChannels, ledger: [], publications: [], minBuffer: 6 });
  const sourceBuffer = Object.fromEntries(bufferPreflight.channels.map((channel) => [channel.key, channel.availableDistinct])) as Record<
    ProjectKingsChannelKey,
    number
  >;
  const bufferReady = bufferPreflight.ready;
  context.event({
    channelKey: "portfolio",
    slot: null,
    stage: bufferReady ? "preflight_passed" : "preflight_refill_required",
    artifactRefs: {
      channels: PROJECT_KINGS_CHANNELS.map((key) => ({
        key,
        channelId: CHANNELS[key].channelId,
        youtubeChannelId: CHANNELS[key].youtubeChannelId
      })),
      sourceBuffer,
      bufferErrors: bufferPreflight.errors,
      stage2HardConstraints: Object.fromEntries(
        PROJECT_KINGS_CHANNELS.map((key) => [
          key,
          channels.find((channel) => channel.id === CHANNELS[key].channelId)?.stage2HardConstraints ?? null
        ])
      ),
      worker: onlineWorker,
      model: context.config.model
    }
  });
  return { channels, publications, sourceBuffer, bufferReady };
}

async function readClipsPublicationState(
  context: RunnerContext,
  channel: ChannelConfig,
  publicationId: string
): Promise<ClipsPublicationPublicState> {
  const [publications, channelResponse] = await Promise.all([
    listChannelPublications(context, channel),
    context.client.control<Record<string, unknown>>("clips_owner_get_channel", { channelId: channel.channelId }, 1)
  ]);
  const publication = publications.find((item) => item.id === publicationId);
  if (!publication) throw new Error(`Clips publication not found: ${publicationId}.`);
  const currentChannel = asRecord(channelResponse.channel);
  const publishing = asRecord(currentChannel?.publishing);
  const integration = asRecord(publishing?.integration);
  return {
    publicationId: publication.id,
    status: publication.status,
    youtubeVideoId: publication.youtubeVideoId,
    youtubeChannelId: asString(integration?.selectedYoutubeChannelId),
    lastError: publication.lastError
  };
}

async function waitForPublicationPublic(
  context: RunnerContext,
  channelKey: ProjectKingsChannelKey,
  slot: number,
  publicationId: string,
  sourceUrl: string
): Promise<{ publicationId: string; youtubeVideoId: string; result: YouTubePublicVerificationResult }> {
  const alreadyVerified = readProjectKingsLedger(context.config.ledgerPath).find(
    (event) => event.runId === context.config.runId && event.channelKey === channelKey && event.slot === slot && event.stage === "public_verified"
  );
  if (alreadyVerified) {
    if (!alreadyVerified.youtubeVideoId || alreadyVerified.publicationId !== publicationId) {
      throw new Error(`${channelKey}: public_verified ledger identity does not match publication ${publicationId}.`);
    }
    if (
      normalizeProjectKingsSourceKey(alreadyVerified.sourceUrl ?? "") !==
      normalizeProjectKingsSourceKey(sourceUrl)
    ) {
      throw new Error(`${channelKey}: public_verified ledger source does not match slot ${slot}.`);
    }
  }
  const channel = CHANNELS[channelKey];
  const deadline = Date.now() + context.config.maxPublicWaitMs;
  let lastReason = "waiting_for_youtube_id";
  while (Date.now() <= deadline) {
    if (context.stopping()) throw new Error("Safe stop requested.");
    const publications = await listChannelPublications(context, channel);
    const publication = publications.find((item) => item.id === publicationId);
    if (!publication) throw new Error(`${channelKey}: publication ${publicationId} disappeared.`);
    if (publication.lastError || ["failed", "canceled", "paused"].includes(publication.status)) {
      throw new Error(`${channelKey}: publication ${publicationId} stopped (${publication.status}): ${publication.lastError ?? "no detail"}`);
    }
    const videoId = publication.youtubeVideoId;
    if (videoId) {
      if (alreadyVerified?.youtubeVideoId && alreadyVerified.youtubeVideoId !== videoId) {
        throw new Error(`${channelKey}: publication ${publicationId} YouTube id drifted from the verified ledger.`);
      }
      const result = await reconcileYouTubePublicVerification(
        { publicationId, expectedVideoId: videoId, expectedChannelId: channel.youtubeChannelId },
        {
          readClipsPublication: (id) => readClipsPublicationState(context, channel, id),
          fetch
        },
        { maxAttempts: 1 }
      );
      lastReason = result.reason;
      if (result.verified) {
        context.event(
          alreadyVerified
            ? {
                channelKey,
                slot,
                stage: "public_reverified",
                sourceUrl,
                publicationId,
                youtubeVideoId: videoId,
                artifactRefs: { evidenceSha256: result.evidenceSha256, attempts: result.attempts }
              }
            : {
                channelKey,
                slot,
                stage: "public_verified",
                sourceUrl,
                publicationId,
                youtubeVideoId: videoId,
                artifactRefs: {
                  shortsUrl: `https://www.youtube.com/shorts/${videoId}`,
                  rssUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.youtubeChannelId}`,
                  evidenceSha256: result.evidenceSha256,
                  attempts: result.attempts
                }
              }
        );
        return { publicationId, youtubeVideoId: videoId, result };
      }
      if (result.outcome === "terminal_failure") {
        throw new Error(`${channelKey}: public verification terminal failure ${result.reason}.`);
      }
    }
    const scheduledAtMs = Date.parse(publication.scheduledAt);
    const beforeUploadWindow = Number.isFinite(scheduledAtMs) && Date.now() < scheduledAtMs - 130 * 60_000;
    await sleep(beforeUploadWindow ? Math.max(context.config.pollMs, 60_000) : context.config.pollMs);
  }
  throw new Error(`${channelKey}: public verification timed out (${lastReason}).`);
}

function queuedEvents(context: RunnerContext): ProjectKingsLedgerEvent[] {
  const bySlot = new Map<string, ProjectKingsLedgerEvent>();
  for (const event of readProjectKingsLedger(context.config.ledgerPath)) {
    if (event.runId !== context.config.runId || event.stage !== "publication_queued" || event.channelKey === "portfolio" || !event.slot) continue;
    bySlot.set(`${event.channelKey}:${event.slot}`, event);
  }
  return [...bySlot.values()];
}

function summarizeRuntime(context: RunnerContext): Record<string, unknown> {
  const events = readProjectKingsLedger(context.config.ledgerPath).filter((event) => event.runId === context.config.runId);
  const modelCalls = events.filter((event) => event.stage === "model_call_completed");
  const externalRetries = events.filter((event) => event.attemptKind === "external" && (event.attempt ?? 1) > 1);
  const replacements = events.filter((event) => event.stage === "source_replaced");
  return {
    runId: context.config.runId,
    progress: summarizeProjectKingsProgress(events, context.config.runId, context.config.targetPerChannel),
    modelCalls: modelCalls.length,
    externalRetries: externalRetries.length,
    replacements: replacements.length,
    modelUsage: modelCalls.map((event) => asRecord(event.artifactRefs)?.usage ?? null),
    modelCostUsd: null
  };
}

async function execute(config: RuntimeConfig): Promise<void> {
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(config.stateDir, "run.lock");
  let lockFd: number | null = null;
  let stopping = false;
  let event: ((partial: Omit<ProjectKingsLedgerEvent, "runId" | "at">) => void) | null = null;
  const requestStop = () => {
    stopping = true;
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  try {
    lockFd = acquireRunLock(lockPath, config.runId);
    const runDir = path.join(config.stateDir, "runs", config.runId);
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    event = (partial: Omit<ProjectKingsLedgerEvent, "runId" | "at">) =>
      appendProjectKingsLedgerEvent(config.ledgerPath, { ...partial, runId: config.runId, at: new Date().toISOString() });
    const context: RunnerContext = {
      config,
      docs: loadDocs(config.docsDir),
      catalog: readCatalog(config.sourcesPath),
      client: await ClipsClient.create(config),
      runDir,
      event,
      stopping: () => stopping
    };
    const existingEvents = readProjectKingsLedger(config.ledgerPath).filter((item) => item.runId === config.runId);
    if (!existingEvents.some((item) => item.stage === "run_started")) {
      event({
        channelKey: "portfolio",
        slot: null,
        stage: "run_started",
        artifactRefs: {
          targetPerChannel: config.targetPerChannel,
          publish: config.publish,
          model: config.model,
          docs: ["README.md", "CHANNELS.md", "SOURCE.md", "CAPTION_MONTAGE.md", "QA.md", "RUNBOOK.md"]
        }
      });
    } else {
      event({ channelKey: "portfolio", slot: null, stage: "run_resumed" });
    }

    let preflight = await runPreflight(context);
    if (config.preflightOnly) {
      if (!preflight.bufferReady) {
        throw new Error(`Project Kings preflight requires source refill: ${JSON.stringify(preflight.sourceBuffer)}.`);
      }
      console.log(JSON.stringify({ status: "preflight_passed", runId: config.runId, sourceBuffer: preflight.sourceBuffer }, null, 2));
      return;
    }

    if (config.refillOnly || !preflight.bufferReady) {
      const refillBeforeRun = await runProjectKingsChannelsInParallel((key) =>
        refillChannelBuffer(context, key, preflight.publications)
      );
      const refillBeforeFailures = Object.entries(refillBeforeRun).filter(([, result]) => result.status === "rejected");
      if (refillBeforeFailures.length) {
        const reason = refillBeforeFailures
          .map(([key, result]) => `${key}:${String((result as PromiseRejectedResult).reason)}`)
          .join("; ");
        event({ channelKey: "portfolio", slot: null, stage: "maintenance_required", stopReason: reason });
        throw new Error(`Buffer refill failed: ${reason}`);
      }
      preflight = await runPreflight(context);
      if (!preflight.bufferReady) {
        throw new Error(`Buffer refill completed without 6/6/6 readiness: ${JSON.stringify(preflight.sourceBuffer)}.`);
      }
      if (config.refillOnly) {
        console.log(JSON.stringify({ status: "buffer_restored", runId: config.runId, results: refillBeforeRun }, null, 2));
        return;
      }
    }

    const reservation = selectedRunSourceKeys(context);
    const channelResults = await runProjectKingsChannelsInParallel((key) => runChannel(context, key, preflight.publications, reservation));
    const channelFailures = Object.entries(channelResults).filter(([, result]) => result.status === "rejected");
    if (channelFailures.length) {
      event({
        channelKey: "portfolio",
        slot: null,
        stage: "maintenance_required",
        stopReason: channelFailures
          .map(([key, result]) => `${key}:${String((result as PromiseRejectedResult).reason)}`)
          .join("; ")
      });
    }
    if (!config.publish) {
      if (channelFailures.length) {
        throw new Error(
          `Control run failed for ${channelFailures.map(([key]) => key).join(", ")}; other channels completed independently.`
        );
      }
      event({ channelKey: "portfolio", slot: null, stage: "control_run_completed", artifactRefs: summarizeRuntime(context) });
      console.log(JSON.stringify({ status: "control_ready_no_publication", ...summarizeRuntime(context) }, null, 2));
      return;
    }
    const freshPublications = await readAllPublications(context);
    const refillResults = await runProjectKingsChannelsInParallel((key) => refillChannelBuffer(context, key, freshPublications));
    const refillFailures = Object.entries(refillResults).filter(([, result]) => result.status === "rejected");
    if (refillFailures.length) {
      event({
        channelKey: "portfolio",
        slot: null,
        stage: "maintenance_required",
        stopReason: refillFailures.map(([key, result]) => `${key}:${String((result as PromiseRejectedResult).reason)}`).join("; ")
      });
    }
    if (!config.waitForPublic) {
      console.log(JSON.stringify({ status: "ready_scheduled", queued: queuedEvents(context), refillResults, ...summarizeRuntime(context) }, null, 2));
      if (channelFailures.length || refillFailures.length) {
        throw new Error("Run remains incomplete after scheduling the healthy channels; see maintenance_required ledger event.");
      }
      return;
    }
    const publications = queuedEvents(context);
    if (!channelFailures.length && publications.length !== config.targetPerChannel * PROJECT_KINGS_CHANNELS.length) {
      throw new Error(`Queued publication ledger is ${publications.length}/${config.targetPerChannel * PROJECT_KINGS_CHANNELS.length}.`);
    }
    for (const [key, result] of Object.entries(channelResults)) {
      if (result.status !== "fulfilled") continue;
      const queuedForChannel = publications.filter((publication) => publication.channelKey === key).length;
      if (queuedForChannel !== config.targetPerChannel) {
        throw new Error(`${key}: queued publication ledger is ${queuedForChannel}/${config.targetPerChannel}.`);
      }
    }
    const verification = await Promise.allSettled(
      publications.map((publication) => {
        if (!publication.slot || !publication.publicationId || !publication.sourceUrl) {
          throw new Error("Queued publication ledger event is missing slot, publicationId, or sourceUrl.");
        }
        return waitForPublicationPublic(
          context,
          publication.channelKey as ProjectKingsChannelKey,
          publication.slot,
          publication.publicationId,
          publication.sourceUrl
        );
      })
    );
    const verificationFailures = verification.filter((result) => result.status === "rejected");
    if (verificationFailures.length) {
      throw new Error(`Public verification failed for ${verificationFailures.length} publication(s): ${verificationFailures.map((result) => String((result as PromiseRejectedResult).reason)).join("; ")}`);
    }
    const finalEvents = readProjectKingsLedger(config.ledgerPath);
    const progress = summarizeProjectKingsProgress(finalEvents, config.runId, config.targetPerChannel);
    for (const [key, result] of Object.entries(channelResults)) {
      if (result.status !== "fulfilled") continue;
      const channelKey = key as ProjectKingsChannelKey;
      if (progress[channelKey] !== config.targetPerChannel) {
        throw new Error(`${channelKey}: ${progress[channelKey]}/${config.targetPerChannel} public_verified.`);
      }
    }
    if (channelFailures.length) {
      throw new Error(
        `Healthy channels reached verification, but channel preparation remains failed: ${channelFailures.map(([key]) => key).join(", ")}.`
      );
    }
    if (refillFailures.length) throw new Error("Public target passed, but source buffer was not fully restored.");
    event({ channelKey: "portfolio", slot: null, stage: "run_completed", artifactRefs: summarizeRuntime(context) });
    console.log(JSON.stringify({ status: "completed", verification, ...summarizeRuntime(context) }, null, 2));
  } finally {
    try {
      if (stopping && event) event({ channelKey: "portfolio", slot: null, stage: "safe_stop", stopReason: "signal" });
    } finally {
      process.removeListener("SIGINT", requestStop);
      process.removeListener("SIGTERM", requestStop);
      releaseRunLock(lockPath, lockFd, config.runId);
    }
  }
}

const config = parseArgs(process.argv.slice(2));
execute(config).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
