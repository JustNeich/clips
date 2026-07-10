#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_BUFFER_REFILLER_LABEL = "com.zoro.clips-project-kings-source-buffer-refiller";
export const SOURCE_BUFFER_RUNTIME_SCHEMA = "project-kings-source-buffer-runtime-v1";
export const SOURCE_BUFFER_EVIDENCE_SCHEMA = "project-kings-source-buffer-readiness-v1";
export const SOURCE_BUFFER_READY_MIN = 6;
export const SOURCE_BUFFER_READY_CAP = 12;
const SOURCE_QUALIFICATION_V2 = "project-kings-source-qualification-v2";
const SOURCE_POLICY_V2 = "project-kings-source-rights-sensitive-policy-v2";
const SOURCE_POLICY_SHA256 =
  "b6664c4364c4a3b172a1f1d653e3d100604e98f5ef1b33857324691fa894eb39";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "assistant",
  "project-kings-source-buffer-refiller.env"
);
const DEFAULT_STATE_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  SOURCE_BUFFER_REFILLER_LABEL
);
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_BLOCKED_BACKOFF_MS = 300_000;
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_HTTP_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 30_000;
const PROFILE_KEYS = ["dark-joy-boy", "light-kingdom", "copscopes-x2e"];

export class SourceBufferRefillerError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SourceBufferRefillerError";
    this.code = options.code ?? "source_buffer_refiller_error";
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus ?? null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new SourceBufferRefillerError(`Unsupported boolean value: ${value}`, { code: "config_invalid" });
}

function boundedInteger(value, fallback, name, min, max) {
  const resolved = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new SourceBufferRefillerError(`${name} must be an integer between ${min} and ${max}.`, {
      code: "config_invalid"
    });
  }
  return resolved;
}

export function parseRefillerEnvText(raw) {
  const values = {};
  for (const sourceLine of String(raw).split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) {
      throw new SourceBufferRefillerError("Environment file contains a malformed line.", {
        code: "env_file_invalid"
      });
    }
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new SourceBufferRefillerError(`Environment file contains an invalid key: ${key}`, {
        code: "env_file_invalid"
      });
    }
    let value = normalized.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function expandHome(value, homeDir) {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return value;
}

async function assertPrivateFile(filePath, label) {
  let details;
  try {
    details = await stat(filePath);
  } catch {
    throw new SourceBufferRefillerError(`${label} is missing: ${filePath}`, {
      code: "env_file_missing"
    });
  }
  if (!details.isFile()) {
    throw new SourceBufferRefillerError(`${label} is not a regular file: ${filePath}`, {
      code: "env_file_invalid"
    });
  }
  if ((details.mode & 0o777) !== 0o600) {
    throw new SourceBufferRefillerError(`${label} must have mode 0600.`, {
      code: "env_file_permissions"
    });
  }
}

function validateAppUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SourceBufferRefillerError("CLIPS_APP_URL must be a valid URL.", { code: "config_invalid" });
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new SourceBufferRefillerError("CLIPS_APP_URL must use HTTPS or loopback HTTP.", {
      code: "config_invalid"
    });
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function safeRepoPath(repoRoot, configuredPath) {
  const resolved = path.resolve(repoRoot, configuredPath);
  const boundary = path.relative(repoRoot, resolved);
  if (!boundary || boundary.startsWith("..") || path.isAbsolute(boundary)) {
    throw new SourceBufferRefillerError(
      "PROJECT_KINGS_SOURCE_BUFFER_EVIDENCE_PATH must resolve inside the Clips repository.",
      { code: "config_invalid" }
    );
  }
  return resolved;
}

export async function loadSourceBufferRefillerConfig(input = {}) {
  const homeDir = input.homeDir ?? os.homedir();
  const repoRoot = path.resolve(input.repoRoot ?? REPO_ROOT);
  const configPath = path.resolve(expandHome(input.configPath ?? DEFAULT_CONFIG_PATH, homeDir));
  await assertPrivateFile(configPath, "Source-buffer refiller config");
  const daemonEnv = parseRefillerEnvText(await readFile(configPath, "utf8"));
  if (!daemonEnv.CLIPS_MCP_ENV_FILE) {
    throw new SourceBufferRefillerError("CLIPS_MCP_ENV_FILE is required in the refiller config.", {
      code: "config_invalid"
    });
  }
  const authEnvPath = path.resolve(expandHome(daemonEnv.CLIPS_MCP_ENV_FILE, homeDir));
  await assertPrivateFile(authEnvPath, "Clips machine credential file");
  const authEnv = parseRefillerEnvText(await readFile(authEnvPath, "utf8"));
  const token = authEnv.CLIPS_MCP_TOKEN?.trim() ?? "";
  if (!token) {
    throw new SourceBufferRefillerError("CLIPS_MCP_TOKEN is missing from the machine credential file.", {
      code: "machine_token_missing"
    });
  }
  const configuredEvidencePath = daemonEnv.PROJECT_KINGS_SOURCE_BUFFER_EVIDENCE_PATH?.trim();
  if (!configuredEvidencePath) {
    throw new SourceBufferRefillerError("PROJECT_KINGS_SOURCE_BUFFER_EVIDENCE_PATH is required.", {
      code: "config_invalid"
    });
  }
  const evidencePath = safeRepoPath(repoRoot, configuredEvidencePath);
  const evidenceStat = await stat(evidencePath).catch(() => null);
  if (!evidenceStat?.isFile()) {
    throw new SourceBufferRefillerError(`Frozen source-buffer evidence is missing: ${evidencePath}`, {
      code: "source_evidence_missing"
    });
  }
  const stateDir = path.resolve(
    expandHome(daemonEnv.PROJECT_KINGS_SOURCE_BUFFER_REFILLER_STATE_DIR ?? DEFAULT_STATE_DIR, homeDir)
  );
  return {
    repoRoot,
    configPath,
    authEnvPath,
    appUrl: validateAppUrl(authEnv.CLIPS_APP_URL?.trim() || "https://clips-vy11.onrender.com"),
    token,
    armed: parseBoolean(daemonEnv.PROJECT_KINGS_SOURCE_BUFFER_REFILLER_ARMED, false),
    evidencePath,
    pollIntervalMs: boundedInteger(
      daemonEnv.PROJECT_KINGS_SOURCE_BUFFER_REFILLER_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      "PROJECT_KINGS_SOURCE_BUFFER_REFILLER_POLL_INTERVAL_MS",
      5_000,
      3_600_000
    ),
    blockedBackoffMs: boundedInteger(
      daemonEnv.PROJECT_KINGS_SOURCE_BUFFER_REFILLER_BLOCKED_BACKOFF_MS,
      DEFAULT_BLOCKED_BACKOFF_MS,
      "PROJECT_KINGS_SOURCE_BUFFER_REFILLER_BLOCKED_BACKOFF_MS",
      10_000,
      3_600_000
    ),
    httpTimeoutMs: boundedInteger(
      daemonEnv.PROJECT_KINGS_SOURCE_BUFFER_REFILLER_HTTP_TIMEOUT_MS,
      DEFAULT_HTTP_TIMEOUT_MS,
      "PROJECT_KINGS_SOURCE_BUFFER_REFILLER_HTTP_TIMEOUT_MS",
      1_000,
      120_000
    ),
    maxHttpAttempts: boundedInteger(
      daemonEnv.PROJECT_KINGS_SOURCE_BUFFER_REFILLER_MAX_HTTP_ATTEMPTS,
      DEFAULT_MAX_HTTP_ATTEMPTS,
      "PROJECT_KINGS_SOURCE_BUFFER_REFILLER_MAX_HTTP_ATTEMPTS",
      1,
      5
    ),
    stateDir,
    statePath: path.join(stateDir, "refiller-health.json"),
    lockPath: path.join(stateDir, "refiller.lock"),
    killSwitchPath: path.resolve(
      expandHome(
        daemonEnv.PROJECT_KINGS_SOURCE_BUFFER_REFILLER_KILL_SWITCH_PATH ?? path.join(stateDir, "DISABLED"),
        homeDir
      )
    )
  };
}

export function redactRefillerSecrets(value, secrets = []) {
  const activeSecrets = secrets
    .filter((secret) => typeof secret === "string" && secret)
    .sort((left, right) => right.length - left.length);
  if (typeof value === "string") {
    let output = value;
    for (const secret of activeSecrets) output = output.split(secret).join("[REDACTED]");
    return output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  }
  if (Array.isArray(value)) return value.map((entry) => redactRefillerSecrets(entry, activeSecrets));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      /token|secret|authorization|cookie/i.test(key)
        ? "[REDACTED]"
        : redactRefillerSecrets(entry, activeSecrets)
    ]));
  }
  return value;
}

export function createRefillerLogger(input = {}) {
  const write = input.write ?? ((line) => process.stdout.write(`${line}\n`));
  const now = input.now ?? (() => new Date());
  const secrets = input.secrets ?? [];
  return (event, payload = {}) => {
    write(JSON.stringify(redactRefillerSecrets({
      scope: "project-kings-source-buffer-refiller",
      event,
      at: now().toISOString(),
      ...payload
    }, secrets)));
  };
}

function safeError(error, token) {
  return redactRefillerSecrets(error instanceof Error ? error.message : String(error), [token]);
}

function retryDelay(attempt, response, random) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
    return Math.min(MAX_BACKOFF_MS, Number(retryAfter) * 1_000);
  }
  const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** Math.max(0, attempt - 1));
  return Math.min(MAX_BACKOFF_MS, base + Math.floor(base * 0.2 * random()));
}

async function responseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Source-buffer API returned invalid JSON (HTTP ${response.status}).` };
  }
}

export async function readSourceBufferRuntime(input) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const sleep = input.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const random = input.random ?? Math.random;
  const logger = input.logger ?? (() => undefined);
  const attempts = input.maxAttempts ?? DEFAULT_MAX_HTTP_ATTEMPTS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const endpoint = `${input.appUrl.replace(/\/+$/, "")}/api/admin/project-kings/source-buffer`;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.token}`,
          Accept: "application/json"
        },
        signal: controller.signal
      });
      const payload = await responseJson(response);
      if (response.ok) return payload;
      const message = redactRefillerSecrets(
        typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`,
        [input.token]
      );
      if (response.status === 401 || response.status === 403) {
        throw new SourceBufferRefillerError(message, {
          code: "machine_auth_blocked",
          httpStatus: response.status
        });
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts) {
        throw new SourceBufferRefillerError(message, {
          code: `source_buffer_http_${response.status}`,
          httpStatus: response.status,
          retryable
        });
      }
      const delayMs = retryDelay(attempt, response, random);
      logger("runtime_read_retry", { attempt, delayMs, httpStatus: response.status });
      await sleep(delayMs);
    } catch (error) {
      if (error instanceof SourceBufferRefillerError) throw error;
      const wrapped = new SourceBufferRefillerError(
        error instanceof Error && error.name === "AbortError"
          ? `Source-buffer runtime read timed out after ${timeoutMs} ms.`
          : `Source-buffer runtime network failure: ${safeError(error, input.token)}`,
        {
          code: error instanceof Error && error.name === "AbortError"
            ? "source_buffer_timeout"
            : "source_buffer_network",
          retryable: true
        }
      );
      if (attempt === attempts) throw wrapped;
      const delayMs = retryDelay(attempt, response, random);
      logger("runtime_read_retry", { attempt, delayMs, code: wrapped.code });
      await sleep(delayMs);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new SourceBufferRefillerError("Source-buffer runtime read failed.");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function loadFrozenSourceBufferEvidence(evidencePath) {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  if (!isPlainObject(evidence) || evidence.schemaVersion !== SOURCE_BUFFER_EVIDENCE_SCHEMA) {
    throw new SourceBufferRefillerError("Unsupported Project Kings source-buffer evidence version.", {
      code: "source_evidence_invalid"
    });
  }
  if (!/^[a-f0-9]{64}$/.test(evidence.evidenceSha256 ?? "")) {
    throw new SourceBufferRefillerError("Frozen source-buffer evidence has an invalid SHA-256.", {
      code: "source_evidence_invalid"
    });
  }
  const { evidenceSha256, ...payload } = evidence;
  const calculated = sha256(JSON.stringify(canonicalize(payload)));
  if (calculated !== evidenceSha256) {
    throw new SourceBufferRefillerError("Frozen source-buffer evidence hash mismatch.", {
      code: "source_evidence_hash_mismatch"
    });
  }
  if (!Array.isArray(evidence.channels)) {
    throw new SourceBufferRefillerError("Frozen source-buffer evidence has no channels.", {
      code: "source_evidence_invalid"
    });
  }
  const keys = evidence.channels.map((channel) => channel?.profileKey).sort();
  if (keys.length !== 3 || keys.some((key, index) => key !== [...PROFILE_KEYS].sort()[index])) {
    throw new SourceBufferRefillerError("Frozen evidence must cover the three Project Kings pilot profiles.", {
      code: "source_evidence_invalid"
    });
  }
  return evidence;
}

function validateRuntime(runtime) {
  if (!isPlainObject(runtime) || runtime.schemaVersion !== SOURCE_BUFFER_RUNTIME_SCHEMA) {
    throw new SourceBufferRefillerError("Unsupported Project Kings source-buffer runtime response.", {
      code: "source_buffer_protocol_error"
    });
  }
  if (!Array.isArray(runtime.channels)) {
    throw new SourceBufferRefillerError("Source-buffer runtime channels are missing.", {
      code: "source_buffer_protocol_error"
    });
  }
  const channels = runtime.channels.map((channel) => {
    if (!PROFILE_KEYS.includes(channel?.profileKey)) {
      throw new SourceBufferRefillerError("Source-buffer runtime contains an unknown profile.", {
        code: "source_buffer_protocol_error"
      });
    }
    const available = Number(channel.qualifiedAvailable);
    const minimum = Number(channel.refill?.readyBufferMin);
    const cap = Number(channel.refill?.readyBufferCap);
    if (!Number.isInteger(available) || available < 0 || minimum !== SOURCE_BUFFER_READY_MIN || cap !== SOURCE_BUFFER_READY_CAP) {
      throw new SourceBufferRefillerError("Source-buffer runtime violates the frozen 6/12 policy.", {
        code: "source_buffer_policy_mismatch"
      });
    }
    return {
      profileKey: channel.profileKey,
      qualifiedAvailable: available,
      readyBufferMin: minimum,
      readyBufferCap: cap,
      shouldRefill: Boolean(channel.refill?.shouldRefill),
      candidates: Array.isArray(channel.candidates) ? channel.candidates : []
    };
  });
  if (channels.length !== 3 || new Set(channels.map((channel) => channel.profileKey)).size !== 3) {
    throw new SourceBufferRefillerError("Source-buffer runtime must contain exactly three pilot profiles.", {
      code: "source_buffer_protocol_error"
    });
  }
  return channels.sort((left, right) => left.profileKey.localeCompare(right.profileKey));
}

function eligibleCandidate(candidate) {
  const sourcePolicy = candidate?.qualificationEvidence?.sourcePolicy;
  const verdict = sourcePolicy?.policyVerdict;
  return candidate?.qualificationStatus === "qualified" &&
    candidate.rightsStatus === "owner_approved_source_pool" &&
    isPlainObject(candidate.qualificationEvidence) &&
    candidate.qualificationEvidence.schemaVersion === SOURCE_QUALIFICATION_V2 &&
    sourcePolicy?.policyVersion === SOURCE_POLICY_V2 &&
    sourcePolicy?.policySha256 === SOURCE_POLICY_SHA256 &&
    sourcePolicy?.discoveryState === "frozen_catalog" &&
    verdict?.disposition === "pass" &&
    verdict?.eligibleForSourceFit === true &&
    verdict?.policySha256 === SOURCE_POLICY_SHA256 &&
    verdict?.policyApprovalSha256 === sourcePolicy?.approvalSha256 &&
    verdict?.sourceDesignationEvidenceSha256 === sourcePolicy?.designationEvidenceSha256 &&
    verdict?.sensitiveAssessmentSha256 === sourcePolicy?.sensitiveAssessmentSha256 &&
    isPlainObject(candidate.localMedia?.selected);
}

function candidateExists(candidate, stored) {
  return stored.some((entry) =>
    entry?.canonicalUrl === candidate.canonicalUrl ||
    entry?.contentSha256 === candidate.qualificationEvidence?.contentSha256 ||
    entry?.eventFingerprint === candidate.qualificationEvidence?.eventFingerprint
  );
}

function refillAnalysis(channels, evidence) {
  const evidenceByProfile = new Map(evidence.channels.map((channel) => [channel.profileKey, channel]));
  const details = channels.map((channel) => {
    const catalog = evidenceByProfile.get(channel.profileKey)?.candidates ?? [];
    const eligible = catalog.filter(eligibleCandidate).filter((candidate) => !candidateExists(candidate, channel.candidates));
    return {
      profileKey: channel.profileKey,
      qualifiedAvailable: channel.qualifiedAvailable,
      deficit: Math.max(0, channel.readyBufferMin - channel.qualifiedAvailable),
      capRoom: Math.max(0, channel.readyBufferCap - channel.qualifiedAvailable),
      eligibleRemaining: eligible.length,
      shouldRefill: channel.shouldRefill && channel.qualifiedAvailable < channel.readyBufferMin
    };
  });
  return details;
}

function catalogSignature(evidenceSha256, details) {
  return sha256(JSON.stringify(canonicalize({
    evidenceSha256,
    channels: details.map((entry) => ({
      profileKey: entry.profileKey,
      qualifiedAvailable: entry.qualifiedAvailable,
      deficit: entry.deficit,
      eligibleRemaining: entry.eligibleRemaining
    }))
  })));
}

function buildHealth(input) {
  return {
    schemaVersion: 1,
    label: SOURCE_BUFFER_REFILLER_LABEL,
    host: os.hostname(),
    pid: process.pid,
    heartbeatAt: input.now.toISOString(),
    status: input.status,
    armed: input.config.armed,
    ready: input.ready ?? false,
    evidencePath: path.relative(input.config.repoRoot, input.config.evidencePath),
    evidenceSha256: input.evidenceSha256 ?? null,
    catalogSignature: input.catalogSignature ?? null,
    channels: input.channels ?? [],
    lastReadAt: input.read ? input.now.toISOString() : input.previousState?.lastReadAt ?? null,
    lastSyncAt: input.synced ? input.now.toISOString() : input.previousState?.lastSyncAt ?? null,
    sync: input.sync ?? null,
    blockerCode: input.blockerCode ?? null,
    blocker: input.blocker ? redactRefillerSecrets(String(input.blocker), [input.config.token]) : null
  };
}

async function defaultFileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultSync(input) {
  const { syncProjectKingsSourceBuffer } = await import("./sync-project-kings-source-buffer.mjs");
  return syncProjectKingsSourceBuffer(input);
}

function syncErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b401\b|unauthori[sz]ed|invalid.*token|token.*invalid/i.test(message)) return "machine_auth_blocked";
  if (/\b403\b|forbidden/i.test(message)) return "machine_auth_blocked";
  return "source_buffer_sync_failed";
}

export async function tickSourceBufferRefiller(input) {
  const config = input.config;
  const state = input.state ?? {};
  const now = input.now ?? new Date();
  const fileExists = input.fileExists ?? defaultFileExists;
  if (await fileExists(config.killSwitchPath)) {
    return buildHealth({
      config,
      now,
      status: "disabled",
      previousState: state,
      blockerCode: "kill_switch_active",
      blocker: "The local source-buffer refiller kill switch is active."
    });
  }
  if (!config.armed) {
    return buildHealth({
      config,
      now,
      status: "disarmed",
      previousState: state,
      blockerCode: "refiller_disarmed",
      blocker: "PROJECT_KINGS_SOURCE_BUFFER_REFILLER_ARMED is not enabled."
    });
  }
  const readRuntime = input.readRuntime ?? (() => readSourceBufferRuntime({
    appUrl: config.appUrl,
    token: config.token,
    timeoutMs: config.httpTimeoutMs,
    maxAttempts: config.maxHttpAttempts,
    fetchImpl: input.fetchImpl,
    sleep: input.sleep,
    random: input.random,
    logger: input.logger
  }));
  try {
    const evidence = await (input.loadEvidence ?? loadFrozenSourceBufferEvidence)(config.evidencePath);
    const runtime = await readRuntime();
    const channels = validateRuntime(runtime);
    const details = refillAnalysis(channels, evidence);
    const signature = catalogSignature(evidence.evidenceSha256, details);
    const publicChannels = details.map(({ profileKey, qualifiedAvailable, deficit, eligibleRemaining }) => ({
      profileKey,
      qualifiedAvailable,
      deficit,
      eligibleRemaining
    }));
    if (details.some((channel) => channel.qualifiedAvailable > channel.readyBufferCap)) {
      return buildHealth({
        config,
        now,
        status: "blocked",
        evidenceSha256: evidence.evidenceSha256,
        catalogSignature: signature,
        channels: publicChannels,
        previousState: state,
        read: true,
        blockerCode: "source_buffer_cap_exceeded",
        blocker: "Source buffer is above the frozen cap of 12; no sync was attempted."
      });
    }
    const ready = details.every((channel) => channel.qualifiedAvailable >= SOURCE_BUFFER_READY_MIN);
    if (ready) {
      return buildHealth({
        config,
        now,
        status: "ready",
        ready: true,
        evidenceSha256: evidence.evidenceSha256,
        catalogSignature: signature,
        channels: publicChannels,
        previousState: state,
        read: true
      });
    }
    const refillable = details.filter((channel) => channel.shouldRefill);
    const exhausted = refillable.every((channel) => channel.eligibleRemaining === 0);
    const repeatedExhaustion = state.blockerCode === "source_catalog_exhausted" &&
      state.catalogSignature === signature &&
      state.evidenceSha256 === evidence.evidenceSha256;
    if (exhausted || repeatedExhaustion) {
      return buildHealth({
        config,
        now,
        status: "blocked",
        evidenceSha256: evidence.evidenceSha256,
        catalogSignature: signature,
        channels: publicChannels,
        previousState: state,
        read: true,
        blockerCode: "source_catalog_exhausted",
        blocker: "source_catalog_exhausted"
      });
    }
    const sync = input.sync ?? defaultSync;
    const result = await sync({
      evidencePath: config.evidencePath,
      runtime: { appUrl: config.appUrl, token: config.token }
    });
    const resultChannels = Array.isArray(result?.channels) ? result.channels : [];
    const afterByProfile = new Map(resultChannels.map((channel) => [channel.profileKey, channel]));
    const after = details.map((channel) => ({
      profileKey: channel.profileKey,
      qualifiedAvailable: Number(afterByProfile.get(channel.profileKey)?.qualifiedAvailable) || channel.qualifiedAvailable,
      deficit: Number.isInteger(afterByProfile.get(channel.profileKey)?.deficit)
        ? afterByProfile.get(channel.profileKey).deficit
        : channel.deficit,
      eligibleRemaining: 0
    }));
    const syncSummary = {
      attempted: Number(result?.attempted) || 0,
      created: Number(result?.created) || 0,
      existing: Number(result?.existing) || 0
    };
    if (after.some((channel) => channel.qualifiedAvailable > SOURCE_BUFFER_READY_CAP)) {
      return buildHealth({
        config,
        now,
        status: "blocked",
        evidenceSha256: evidence.evidenceSha256,
        catalogSignature: catalogSignature(evidence.evidenceSha256, after),
        channels: after,
        previousState: state,
        read: true,
        synced: true,
        sync: syncSummary,
        blockerCode: "source_buffer_cap_exceeded",
        blocker: "Source-buffer sync exceeded the frozen cap of 12; no further sync will run."
      });
    }
    if (result?.ready === true && after.every((channel) => channel.qualifiedAvailable >= SOURCE_BUFFER_READY_MIN)) {
      return buildHealth({
        config,
        now,
        status: "ready",
        ready: true,
        evidenceSha256: evidence.evidenceSha256,
        catalogSignature: signature,
        channels: after,
        previousState: state,
        read: true,
        synced: true,
        sync: syncSummary
      });
    }
    return buildHealth({
      config,
      now,
      status: "blocked",
      evidenceSha256: evidence.evidenceSha256,
      catalogSignature: catalogSignature(evidence.evidenceSha256, after),
      channels: after,
      previousState: state,
      read: true,
      synced: true,
      sync: syncSummary,
      blockerCode: "source_catalog_exhausted",
      blocker: "source_catalog_exhausted"
    });
  } catch (error) {
    const code = error instanceof SourceBufferRefillerError ? error.code : syncErrorCode(error);
    return buildHealth({
      config,
      now,
      status: "blocked",
      previousState: state,
      blockerCode: code,
      blocker: safeError(error, config.token)
    });
  }
}

function assertHealthHasNoCredentials(value, trail = "health") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertHealthHasNoCredentials(entry, `${trail}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (/token|secret|authorization|cookie/i.test(key)) {
      throw new SourceBufferRefillerError(`Credential-like field is forbidden in refiller health: ${trail}.${key}`, {
        code: "state_contains_credential"
      });
    }
    assertHealthHasNoCredentials(entry, `${trail}.${key}`);
  }
}

export async function readRefillerHealth(statePath) {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return {};
    throw error;
  }
}

export async function writeRefillerHealth(statePath, health) {
  assertHealthHasNoCredentials(health);
  const directory = path.dirname(statePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${statePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(health, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, statePath);
  await chmod(statePath, 0o600);
}

function pidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === "object" && error.code === "EPERM";
  }
}

export async function acquireRefillerLock(lockPath) {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(lockPath), 0o700);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockPath, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, {
        flag: "wx",
        mode: 0o600
      });
      return { lockPath, pid: process.pid };
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "EEXIST")) throw error;
      let existing = null;
      try {
        existing = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        // Invalid lock cannot prove a live owner.
      }
      if (pidRunning(existing?.pid)) {
        throw new SourceBufferRefillerError(`Source-buffer refiller already runs with pid ${existing.pid}.`, {
          code: "refiller_already_running"
        });
      }
      await rm(lockPath, { force: true });
    }
  }
  throw new SourceBufferRefillerError("Could not acquire the source-buffer refiller lock.", {
    code: "refiller_lock_failed"
  });
}

export async function releaseRefillerLock(lock) {
  let existing;
  try {
    existing = JSON.parse(await readFile(lock.lockPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
  if (existing.pid !== lock.pid) return false;
  await rm(lock.lockPath, { force: true });
  return true;
}

async function interruptibleSleep(delayMs, signal) {
  if (signal.aborted) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function runSourceBufferRefiller(input = {}) {
  const configLoader = input.configLoader ?? (() => loadSourceBufferRefillerConfig({ configPath: input.configPath }));
  const firstConfig = await configLoader();
  const logger = input.logger ?? createRefillerLogger({ secrets: [firstConfig.token] });
  const lock = await acquireRefillerLock(firstConfig.lockPath);
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  logger("refiller_started", { armed: firstConfig.armed, pid: process.pid });
  let previous = await readRefillerHealth(firstConfig.statePath);
  try {
    while (!abortController.signal.aborted) {
      let config = firstConfig;
      let health;
      try {
        config = await configLoader();
        health = await tickSourceBufferRefiller({ config, state: previous, logger });
      } catch (error) {
        health = buildHealth({
          config,
          now: new Date(),
          status: "blocked",
          previousState: previous,
          blockerCode: error instanceof SourceBufferRefillerError ? error.code : "refiller_tick_failed",
          blocker: safeError(error, firstConfig.token)
        });
      }
      previous = health;
      await writeRefillerHealth(config.statePath, health);
      logger("tick_completed", {
        status: health.status,
        ready: health.ready,
        blockerCode: health.blockerCode,
        channels: health.channels.map((channel) => ({
          profileKey: channel.profileKey,
          qualifiedAvailable: channel.qualifiedAvailable,
          deficit: channel.deficit
        }))
      });
      const delayMs = health.status === "blocked" ? config.blockedBackoffMs : config.pollIntervalMs;
      await interruptibleSleep(delayMs, abortController.signal);
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await releaseRefillerLock(lock);
    logger("refiller_stopped", { pid: process.pid });
  }
}

function parseCli(argv) {
  const args = [...argv];
  let command = "run";
  let configPath = DEFAULT_CONFIG_PATH;
  if (args[0] && !args[0].startsWith("--")) command = args.shift();
  while (args.length > 0) {
    const option = args.shift();
    if (option === "--config") {
      const value = args.shift();
      if (!value) throw new SourceBufferRefillerError("--config requires a path.", { code: "cli_invalid" });
      configPath = value;
      continue;
    }
    throw new SourceBufferRefillerError(`Unknown argument: ${option}`, { code: "cli_invalid" });
  }
  if (command !== "run" && command !== "tick") {
    throw new SourceBufferRefillerError(`Unknown command: ${command}`, { code: "cli_invalid" });
  }
  return { command, configPath };
}

export async function runRefillerCli(argv = process.argv.slice(2)) {
  const { command, configPath } = parseCli(argv);
  const config = await loadSourceBufferRefillerConfig({ configPath });
  const logger = createRefillerLogger({ secrets: [config.token] });
  if (command === "tick") {
    const lock = await acquireRefillerLock(config.lockPath);
    try {
      const previous = await readRefillerHealth(config.statePath);
      const health = await tickSourceBufferRefiller({ config, state: previous, logger });
      await writeRefillerHealth(config.statePath, health);
      logger("tick_completed", {
        status: health.status,
        ready: health.ready,
        blockerCode: health.blockerCode
      });
      return health.status === "blocked" ? 2 : 0;
    } finally {
      await releaseRefillerLock(lock);
    }
  }
  await runSourceBufferRefiller({ configPath, logger });
  return 0;
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  runRefillerCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        scope: "project-kings-source-buffer-refiller",
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      })}\n`);
      process.exitCode = 1;
    });
}
