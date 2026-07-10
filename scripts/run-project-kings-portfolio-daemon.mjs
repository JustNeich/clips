#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORTFOLIO_DAEMON_LABEL = "com.zoro.clips-project-kings-portfolio";

const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "assistant",
  "project-kings-portfolio.env"
);
const DEFAULT_STATE_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  PORTFOLIO_DAEMON_LABEL
);
const DEFAULT_POLL_INTERVAL_MS = 30_000;
// One owner tick is an awaited, bounded control-plane pass. Some current
// handlers wait for a durable Zoro Stage3 job, so the client timeout must be
// longer than the largest stage budget while the server renews both fences.
const DEFAULT_HTTP_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_BLOCKED_BACKOFF_MS = 300_000;
const DEFAULT_MAX_HTTP_ATTEMPTS = 3;
const DEFAULT_TIMEZONE = "Europe/Moscow";
const MAX_HTTP_BACKOFF_MS = 30_000;

export class PortfolioDaemonError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "PortfolioDaemonError";
    this.code = options.code ?? "portfolio_daemon_error";
    this.retryable = options.retryable ?? false;
    this.httpStatus = options.httpStatus ?? null;
    this.details = options.details ?? null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseInteger(value, fallback, { name, min, max }) {
  const resolved = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new PortfolioDaemonError(`${name} must be an integer between ${min} and ${max}.`, {
      code: "config_invalid"
    });
  }
  return resolved;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new PortfolioDaemonError(`Unsupported boolean value: ${value}`, { code: "config_invalid" });
}

export function parseEnvText(raw) {
  const values = {};
  for (const sourceLine of String(raw).split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) {
      throw new PortfolioDaemonError("Environment file contains a malformed line.", {
        code: "env_file_invalid"
      });
    }
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new PortfolioDaemonError(`Environment file contains an invalid key: ${key}`, {
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
  } catch (error) {
    throw new PortfolioDaemonError(`${label} is missing: ${filePath}`, {
      code: "env_file_missing",
      details: error instanceof Error ? error.message : String(error)
    });
  }
  if (!details.isFile()) {
    throw new PortfolioDaemonError(`${label} is not a regular file: ${filePath}`, {
      code: "env_file_invalid"
    });
  }
  const mode = details.mode & 0o777;
  if (mode !== 0o600) {
    throw new PortfolioDaemonError(`${label} must have mode 0600.`, {
      code: "env_file_permissions"
    });
  }
}

function validateAppUrl(rawUrl, mode) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PortfolioDaemonError("CLIPS_APP_URL must be a valid URL.", { code: "config_invalid" });
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(mode === "shadow" && parsed.protocol === "http:" && loopback)) {
    throw new PortfolioDaemonError(
      "CLIPS_APP_URL must use HTTPS; HTTP is allowed only for loopback shadow runs.",
      { code: "config_invalid" }
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function validateTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value }).format(new Date());
  } catch {
    throw new PortfolioDaemonError(`Unsupported timezone: ${value}`, { code: "config_invalid" });
  }
  return value;
}

function parseProfileIds(value) {
  const profileIds = String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (
    profileIds.length !== 3 ||
    new Set(profileIds).size !== 3 ||
    profileIds.some((profileId) => profileId.length > 64)
  ) {
    throw new PortfolioDaemonError(
      "PROJECT_KINGS_PORTFOLIO_PROFILE_IDS must contain exactly three unique comma-separated profile IDs.",
      { code: "config_invalid" }
    );
  }
  return profileIds;
}

function parseCanaryPolicy(value, mode) {
  const policy = String(value ?? (mode === "live" ? "first_item_per_channel_public_verified" : "none")).trim();
  if (policy !== "first_item_per_channel_public_verified" && policy !== "none") {
    throw new PortfolioDaemonError(
      "PROJECT_KINGS_PORTFOLIO_CANARY_POLICY must be first_item_per_channel_public_verified or none.",
      { code: "config_invalid" }
    );
  }
  if (mode === "shadow" && policy !== "none") {
    throw new PortfolioDaemonError("Shadow portfolio daemon always requires canary policy none.", {
      code: "config_invalid"
    });
  }
  return policy;
}

export async function loadPortfolioDaemonConfig(input = {}) {
  const homeDir = input.homeDir ?? os.homedir();
  const configPath = path.resolve(expandHome(input.configPath ?? DEFAULT_CONFIG_PATH, homeDir));
  await assertPrivateFile(configPath, "Portfolio daemon config");
  const configRaw = await readFile(configPath, "utf8");
  const configSha256 = createHash("sha256").update(configRaw).digest("hex");
  if (input.expectedConfigSha256) {
    const expectedConfigSha256 = String(input.expectedConfigSha256).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedConfigSha256) || expectedConfigSha256 !== configSha256) {
      throw new PortfolioDaemonError(
        `Portfolio daemon config hash mismatch: expected ${expectedConfigSha256}, got ${configSha256}.`,
        { code: "config_hash_mismatch" }
      );
    }
  }
  const daemonEnv = parseEnvText(configRaw);
  const authEnvPathValue = daemonEnv.CLIPS_MCP_ENV_FILE;
  if (!authEnvPathValue) {
    throw new PortfolioDaemonError("CLIPS_MCP_ENV_FILE is required in the daemon config.", {
      code: "config_invalid"
    });
  }
  const authEnvPath = path.resolve(expandHome(authEnvPathValue, homeDir));
  await assertPrivateFile(authEnvPath, "Clips machine credential file");
  const authEnv = parseEnvText(await readFile(authEnvPath, "utf8"));
  const mode = (daemonEnv.PROJECT_KINGS_PORTFOLIO_MODE ?? "shadow").trim().toLowerCase();
  if (mode !== "shadow" && mode !== "live") {
    throw new PortfolioDaemonError("PROJECT_KINGS_PORTFOLIO_MODE must be shadow or live.", {
      code: "config_invalid"
    });
  }
  const token = authEnv.CLIPS_MCP_TOKEN?.trim() ?? "";
  if (!token) {
    throw new PortfolioDaemonError("CLIPS_MCP_TOKEN is missing from the machine credential file.", {
      code: "machine_token_missing"
    });
  }
  const stateDir = path.resolve(
    expandHome(daemonEnv.PROJECT_KINGS_PORTFOLIO_STATE_DIR ?? DEFAULT_STATE_DIR, homeDir)
  );
  const killSwitchPath = path.resolve(
    expandHome(
      daemonEnv.PROJECT_KINGS_PORTFOLIO_KILL_SWITCH_PATH ?? path.join(stateDir, "DISABLED"),
      homeDir
    )
  );
  const config = {
    configPath,
    configSha256,
    authEnvPath,
    appUrl: validateAppUrl(authEnv.CLIPS_APP_URL?.trim() || "https://clips-vy11.onrender.com", mode),
    token,
    armed: parseBoolean(daemonEnv.PROJECT_KINGS_PORTFOLIO_ARMED, false),
    mode,
    canaryPolicy: parseCanaryPolicy(daemonEnv.PROJECT_KINGS_PORTFOLIO_CANARY_POLICY, mode),
    profileIds: parseProfileIds(daemonEnv.PROJECT_KINGS_PORTFOLIO_PROFILE_IDS),
    timezone: validateTimezone(
      daemonEnv.PROJECT_KINGS_PORTFOLIO_TIMEZONE?.trim() || DEFAULT_TIMEZONE
    ),
    pollIntervalMs: parseInteger(
      daemonEnv.PROJECT_KINGS_PORTFOLIO_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      { name: "PROJECT_KINGS_PORTFOLIO_POLL_INTERVAL_MS", min: 1_000, max: 3_600_000 }
    ),
    httpTimeoutMs: parseInteger(
      daemonEnv.PROJECT_KINGS_PORTFOLIO_HTTP_TIMEOUT_MS,
      DEFAULT_HTTP_TIMEOUT_MS,
      { name: "PROJECT_KINGS_PORTFOLIO_HTTP_TIMEOUT_MS", min: 30_000, max: 30 * 60_000 }
    ),
    blockedBackoffMs: parseInteger(
      daemonEnv.PROJECT_KINGS_PORTFOLIO_BLOCKED_BACKOFF_MS,
      DEFAULT_BLOCKED_BACKOFF_MS,
      { name: "PROJECT_KINGS_PORTFOLIO_BLOCKED_BACKOFF_MS", min: 10_000, max: 3_600_000 }
    ),
    maxHttpAttempts: parseInteger(
      daemonEnv.PROJECT_KINGS_PORTFOLIO_MAX_HTTP_ATTEMPTS,
      DEFAULT_MAX_HTTP_ATTEMPTS,
      { name: "PROJECT_KINGS_PORTFOLIO_MAX_HTTP_ATTEMPTS", min: 1, max: 5 }
    ),
    stateDir,
    statePath: path.join(stateDir, "daemon-health.json"),
    lockPath: path.join(stateDir, "daemon.lock"),
    killSwitchPath
  };
  if (config.mode === "live" && !config.appUrl.startsWith("https://")) {
    throw new PortfolioDaemonError("Live mode requires an HTTPS Clips endpoint.", {
      code: "config_invalid"
    });
  }
  return config;
}

export function redactSecrets(value, secrets = []) {
  const activeSecrets = secrets
    .filter((secret) => typeof secret === "string" && secret.length > 0)
    .sort((left, right) => right.length - left.length);
  const redactString = (input) => {
    let output = input;
    for (const secret of activeSecrets) output = output.split(secret).join("[REDACTED]");
    output = output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
    return output;
  };
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, activeSecrets));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|authorization|cookie/i.test(key)
          ? "[REDACTED]"
          : redactSecrets(item, activeSecrets)
      ])
    );
  }
  return value;
}

export function createStructuredLogger(input = {}) {
  const write = input.write ?? ((line) => process.stdout.write(`${line}\n`));
  const secrets = input.secrets ?? [];
  const now = input.now ?? (() => new Date());
  return (event, payload = {}) => {
    const safe = redactSecrets(
      {
        scope: "project-kings-portfolio-daemon",
        event,
        at: now().toISOString(),
        ...payload
      },
      secrets
    );
    write(JSON.stringify(safe));
  };
}

function safeErrorMessage(error, secrets = []) {
  return redactSecrets(error instanceof Error ? error.message : String(error), secrets);
}

function retryDelayMs(attempt, response, random) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
    return Math.min(MAX_HTTP_BACKOFF_MS, Math.max(0, Number(retryAfter) * 1_000));
  }
  const base = Math.min(MAX_HTTP_BACKOFF_MS, 1_000 * 2 ** Math.max(0, attempt - 1));
  return Math.min(MAX_HTTP_BACKOFF_MS, base + Math.floor(base * 0.2 * random()));
}

async function parseResponsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Remote response was not valid JSON (HTTP ${response.status}).` };
  }
}

function remoteErrorMessage(payload, status) {
  if (isPlainObject(payload) && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }
  return `Clips owner control returned HTTP ${status}.`;
}

export async function postOwnerControl(input) {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PortfolioDaemonError("A fetch implementation is required.", { code: "runtime_invalid" });
  }
  const sleep = input.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const random = input.random ?? Math.random;
  const logger = input.logger ?? (() => undefined);
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_HTTP_ATTEMPTS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const endpoint = `${input.appUrl.replace(/\/+$/, "")}/api/admin/control`;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);
    timeout.unref?.();
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ tool: input.tool, input: input.toolInput ?? {} }),
        signal: abortController.signal
      });
      const payload = await parseResponsePayload(response);
      if (response.ok) return payload;

      const message = redactSecrets(remoteErrorMessage(payload, response.status), [input.token]);
      if (response.status === 401 || response.status === 403) {
        throw new PortfolioDaemonError(message, {
          code: "machine_auth_blocked",
          httpStatus: response.status,
          retryable: false
        });
      }
      const retryable = response.status === 429 || response.status >= 500;
      const code = isPlainObject(payload) && typeof payload.code === "string"
        ? payload.code
        : `owner_control_http_${response.status}`;
      const error = new PortfolioDaemonError(message, {
        code,
        httpStatus: response.status,
        retryable
      });
      if (!retryable || attempt === maxAttempts) throw error;
      lastError = error;
      const delayMs = retryDelayMs(attempt, response, random);
      logger("owner_control_retry", { tool: input.tool, attempt, delayMs, httpStatus: response.status });
      await sleep(delayMs);
    } catch (error) {
      if (error instanceof PortfolioDaemonError) throw error;
      const message = error instanceof Error && error.name === "AbortError"
        ? `Clips owner control timed out after ${timeoutMs} ms.`
        : redactSecrets(
          `Clips owner control network failure: ${error instanceof Error ? error.message : String(error)}`,
          [input.token]
        );
      const wrapped = new PortfolioDaemonError(message, {
        code: error instanceof Error && error.name === "AbortError" ? "owner_control_timeout" : "owner_control_network",
        retryable: true
      });
      if (attempt === maxAttempts) throw wrapped;
      lastError = wrapped;
      const delayMs = retryDelayMs(attempt, response, random);
      logger("owner_control_retry", { tool: input.tool, attempt, delayMs, code: wrapped.code });
      await sleep(delayMs);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new PortfolioDaemonError("Clips owner control failed.", { code: "owner_control_failed" });
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string").map((entry) => entry.slice(0, 4_000));
}

function sanitizedBlockers(value, token) {
  return stringArray(value).map((entry) => redactSecrets(entry, [token]));
}

function buildHealth(input) {
  const response = input.response ?? null;
  const blockers = response ? sanitizedBlockers(response.blockers, input.config.token) : [];
  return {
    schemaVersion: 2,
    label: PORTFOLIO_DAEMON_LABEL,
    host: os.hostname(),
    pid: process.pid,
    heartbeatAt: input.now.toISOString(),
    mode: input.config.mode,
    canaryPolicy: input.config.canaryPolicy,
    armed: input.config.armed,
    profileIds: [...input.config.profileIds],
    timezone: input.config.timezone,
    status: input.status,
    role: response?.role === "leader" || response?.role === "standby" ? response.role : null,
    logicalDate: typeof response?.logicalDate === "string" ? response.logicalDate : null,
    leaseExpiresAt: typeof response?.leaseExpiresAt === "string" ? response.leaseExpiresAt : null,
    serverHeartbeatAt: typeof response?.heartbeatAt === "string" ? response.heartbeatAt : null,
    runtimeVersion: Number.isInteger(response?.runtimeVersion) ? response.runtimeVersion : null,
    startedRunId: typeof response?.startedRunId === "string" ? response.startedRunId : null,
    activeRunIds: stringArray(response?.activeRunIds),
    scheduledRunIds: stringArray(response?.scheduledRunIds),
    blockers,
    lastSuccessfulOwnerCheckAt: input.ownerChecked
      ? input.now.toISOString()
      : input.previousState?.lastSuccessfulOwnerCheckAt ?? null,
    blockerCode: input.blockerCode ?? blockers[0]?.split(":", 1)[0] ?? null,
    blocker: input.blocker
      ? redactSecrets(String(input.blocker), [input.config.token])
      : blockers[0] ?? null
  };
}

function validateTickResponse(payload) {
  if (!isPlainObject(payload)) {
    throw new PortfolioDaemonError("Portfolio daemon tick response must be an object.", {
      code: "owner_control_protocol_error"
    });
  }
  if (payload.role !== "leader" && payload.role !== "standby") {
    throw new PortfolioDaemonError("Portfolio daemon tick response has an invalid role.", {
      code: "owner_control_protocol_error"
    });
  }
  if (!["running", "blocked", "error"].includes(payload.status)) {
    throw new PortfolioDaemonError("Portfolio daemon tick response has an invalid status.", {
      code: "owner_control_protocol_error"
    });
  }
  if (payload.role === "leader" && (typeof payload.leaseToken !== "string" || !payload.leaseToken)) {
    throw new PortfolioDaemonError("Leader tick response is missing its lease token.", {
      code: "owner_control_protocol_error"
    });
  }
  return payload;
}

function responseLosesLease(response) {
  return response.role === "standby" ||
    stringArray(response.blockers).includes("portfolio_daemon_lease_lost");
}

function defaultOwnerControl(config, input) {
  return (tool, toolInput) => postOwnerControl({
    appUrl: config.appUrl,
    token: config.token,
    tool,
    toolInput,
    timeoutMs: config.httpTimeoutMs,
    maxAttempts: config.maxHttpAttempts,
    fetchImpl: input.fetchImpl,
    sleep: input.sleep,
    random: input.random,
    logger: input.logger
  });
}

export async function releasePortfolioDaemonServerLease(input) {
  const leaseToken = input.leaseToken?.trim() ?? "";
  if (!leaseToken) return { released: false, leaseLost: false, leaseToken: null, error: null };
  const ownerControl = input.ownerControl ?? defaultOwnerControl(input.config, input);
  try {
    const payload = await ownerControl("clips_owner_release_portfolio_daemon", { leaseToken });
    const released = Boolean(payload?.released);
    const leaseLost = payload?.status === "lease_lost";
    return {
      released,
      leaseLost,
      leaseToken: released || leaseLost ? null : leaseToken,
      error: null
    };
  } catch (error) {
    return {
      released: false,
      leaseLost: false,
      leaseToken,
      error: error instanceof PortfolioDaemonError
        ? error
        : new PortfolioDaemonError(error instanceof Error ? error.message : String(error))
    };
  }
}

export async function releaseHeldPortfolioLease(input) {
  const fileExists = input.fileExists ?? defaultFileExists;
  if (!input.leaseToken) {
    return { released: false, leaseLost: false, leaseToken: null, error: null, skipped: "no_lease" };
  }
  if (await fileExists(input.config.killSwitchPath)) {
    return {
      released: false,
      leaseLost: false,
      leaseToken: input.leaseToken,
      error: null,
      skipped: "kill_switch_active"
    };
  }
  return {
    ...await releasePortfolioDaemonServerLease(input),
    skipped: null
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

export async function tickPortfolioDaemon(input) {
  const config = input.config;
  const now = input.now ?? new Date();
  const state = input.state ?? {};
  const fileExists = input.fileExists ?? defaultFileExists;
  const ownerControl = input.ownerControl ?? defaultOwnerControl(config, input);
  const secrets = [config.token];

  if (await fileExists(config.killSwitchPath)) {
    return {
      health: buildHealth({
        config,
        now,
        status: "disabled",
        previousState: state,
        blockerCode: "kill_switch_active",
        blocker: "The local kill switch is active."
      }),
      leaseToken: input.leaseToken ?? null
    };
  }
  if (!config.armed) {
    const release = input.leaseToken
      ? await releasePortfolioDaemonServerLease({
        config,
        leaseToken: input.leaseToken,
        ownerControl
      })
      : { leaseToken: null, error: null };
    return {
      health: buildHealth({
        config,
        now,
        status: "disarmed",
        previousState: state,
        ownerChecked: Boolean(input.leaseToken && !release.error),
        blockerCode: release.error ? "lease_release_failed" : "daemon_disarmed",
        blocker: release.error
          ? safeErrorMessage(release.error, secrets)
          : "PROJECT_KINGS_PORTFOLIO_ARMED is not enabled."
      }),
      leaseToken: release.leaseToken
    };
  }

  try {
    const payload = validateTickResponse(await ownerControl("clips_owner_tick_portfolio_daemon", {
      profileIds: [...config.profileIds],
      mode: config.mode,
      canaryPolicy: config.canaryPolicy,
      timezone: config.timezone,
      ...(input.leaseToken ? { leaseToken: input.leaseToken } : {})
    }));
    const losesLease = responseLosesLease(payload);
    const explicitLeaseLoss = stringArray(payload.blockers).includes("portfolio_daemon_lease_lost") ||
      Boolean(input.leaseToken && payload.role === "standby");
    const leaseToken = losesLease ? null : payload.leaseToken;
    return {
      health: buildHealth({
        config,
        now,
        status: payload.role === "standby" ? "standby" : payload.status,
        response: payload,
        previousState: state,
        ownerChecked: true,
        blockerCode: explicitLeaseLoss
          ? "portfolio_daemon_lease_lost"
          : payload.role === "standby"
            ? "portfolio_daemon_standby"
            : undefined
      }),
      leaseToken
    };
  } catch (error) {
    const daemonError = error instanceof PortfolioDaemonError
      ? error
      : new PortfolioDaemonError(safeErrorMessage(error, secrets));
    return {
      health: buildHealth({
        config,
        now,
        status: "blocked",
        previousState: state,
        blockerCode: daemonError.code,
        blocker: safeErrorMessage(daemonError, secrets)
      }),
      leaseToken: input.leaseToken ?? null
    };
  }
}

export async function readDaemonState(statePath) {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return {};
    throw new PortfolioDaemonError(`Could not read daemon state: ${error instanceof Error ? error.message : String(error)}`, {
      code: "state_read_failed"
    });
  }
}

function assertStateContainsNoCredentials(value, trail = "state") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertStateContainsNoCredentials(entry, `${trail}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (/leaseToken|token|secret|authorization|cookie/i.test(key)) {
      throw new PortfolioDaemonError(`Credential-like field is forbidden in durable daemon state: ${trail}.${key}`, {
        code: "state_contains_credential"
      });
    }
    assertStateContainsNoCredentials(entry, `${trail}.${key}`);
  }
}

export async function writeDaemonState(statePath, state) {
  assertStateContainsNoCredentials(state);
  const directory = path.dirname(statePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, statePath);
  await chmod(statePath, 0o600);
}

function pidIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === "object" && error.code === "EPERM";
  }
}

export async function acquireDaemonLock(lockPath) {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(lockPath), 0o700);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    try {
      const handle = await open(lockPath, "wx", 0o600);
      const record = { pid: process.pid, token, acquiredAt: new Date().toISOString() };
      await handle.writeFile(`${JSON.stringify(record)}\n`);
      await handle.close();
      return { lockPath, pid: process.pid, token };
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "EEXIST")) throw error;
      let existing = null;
      try {
        existing = JSON.parse(await readFile(lockPath, "utf8"));
      } catch {
        // An unreadable lock is stale only when no valid live pid can be proven.
      }
      if (pidIsRunning(existing?.pid)) {
        throw new PortfolioDaemonError(`Portfolio daemon is already running with pid ${existing.pid}.`, {
          code: "daemon_already_running"
        });
      }
      await rm(lockPath, { force: true });
    }
  }
  throw new PortfolioDaemonError("Could not acquire the portfolio daemon lock.", {
    code: "daemon_lock_failed"
  });
}

export async function releaseDaemonLock(lock) {
  if (!lock?.lockPath || !lock?.token) return false;
  let existing;
  try {
    existing = JSON.parse(await readFile(lock.lockPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
  if (existing.token !== lock.token || existing.pid !== lock.pid) return false;
  await rm(lock.lockPath, { force: true });
  return true;
}

export async function releaseStaleDaemonLock(lockPath) {
  let existing;
  try {
    existing = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { released: false, reason: "missing" };
    }
    await rm(lockPath, { force: true });
    return { released: true, reason: "invalid" };
  }
  if (pidIsRunning(existing?.pid)) {
    return { released: false, reason: "active", pid: existing.pid };
  }
  await rm(lockPath, { force: true });
  return { released: true, reason: "stale", pid: existing?.pid ?? null };
}

function delayUntilNextTick(health, config) {
  return health.status === "blocked" ? config.blockedBackoffMs : config.pollIntervalMs;
}

async function interruptibleSleep(delayMs, signal) {
  if (signal.aborted) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runPortfolioDaemon(input = {}) {
  const configLoader = input.configLoader ?? (() => loadPortfolioDaemonConfig({
    configPath: input.configPath,
    expectedConfigSha256: input.expectedConfigSha256
  }));
  const firstConfig = await configLoader();
  const logger = input.logger ?? createStructuredLogger({ secrets: [firstConfig.token] });
  const lock = await acquireDaemonLock(firstConfig.lockPath);
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  let heldLeaseToken = null;
  let lastConfig = firstConfig;
  let lastHealth = await readDaemonState(firstConfig.statePath);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  logger("daemon_started", { mode: firstConfig.mode, armed: firstConfig.armed, pid: process.pid });
  try {
    while (!abortController.signal.aborted) {
      let config;
      let health;
      try {
        config = await configLoader();
        lastConfig = config;
        const previousHealth = await readDaemonState(config.statePath);
        const tick = await tickPortfolioDaemon({
          config,
          state: previousHealth,
          leaseToken: heldLeaseToken,
          logger
        });
        health = tick.health;
        heldLeaseToken = tick.leaseToken;
      } catch (error) {
        config = lastConfig;
        health = buildHealth({
          config,
          now: new Date(),
          status: "blocked",
          previousState: lastHealth,
          blockerCode: error instanceof PortfolioDaemonError ? error.code : "daemon_tick_failed",
          blocker: safeErrorMessage(error, [firstConfig.token])
        });
      }
      lastHealth = health;
      await writeDaemonState(config.statePath, health);
      logger("tick_completed", {
        status: health.status,
        role: health.role,
        logicalDate: health.logicalDate,
        activeRunCount: health.activeRunIds?.length ?? 0,
        blockerCode: health.blockerCode
      });
      await interruptibleSleep(delayUntilNextTick(health, config), abortController.signal);
    }
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    if (heldLeaseToken) {
      const release = await releaseHeldPortfolioLease({
        config: lastConfig,
        leaseToken: heldLeaseToken,
        logger
      });
      logger("server_lease_release", {
        released: release.released,
        leaseLost: release.leaseLost,
        skipped: release.skipped,
        error: release.error ? safeErrorMessage(release.error, [lastConfig.token]) : null
      });
    }
    await releaseDaemonLock(lock);
    logger("daemon_stopped", { pid: process.pid });
  }
}

function parseCliArgs(argv) {
  const args = [...argv];
  let command = "run";
  let configPath = DEFAULT_CONFIG_PATH;
  let expectedConfigSha256 = null;
  if (args[0] && !args[0].startsWith("--")) command = args.shift();
  while (args.length > 0) {
    const option = args.shift();
    if (option === "--config") {
      const value = args.shift();
      if (!value) throw new PortfolioDaemonError("--config requires a path.", { code: "cli_invalid" });
      configPath = value;
      continue;
    }
    if (option === "--expected-config-sha256") {
      const value = args.shift();
      if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
        throw new PortfolioDaemonError("--expected-config-sha256 requires a SHA-256 digest.", { code: "cli_invalid" });
      }
      expectedConfigSha256 = value.toLowerCase();
      continue;
    }
    throw new PortfolioDaemonError(`Unknown argument: ${option}`, { code: "cli_invalid" });
  }
  if (!["run", "tick", "release"].includes(command)) {
    throw new PortfolioDaemonError(`Unknown command: ${command}`, { code: "cli_invalid" });
  }
  return { command, configPath, expectedConfigSha256 };
}

export async function runCli(argv = process.argv.slice(2)) {
  const { command, configPath, expectedConfigSha256 } = parseCliArgs(argv);
  const config = await loadPortfolioDaemonConfig({ configPath, expectedConfigSha256 });
  const logger = createStructuredLogger({ secrets: [config.token] });
  if (command === "release") {
    let existing = null;
    try {
      existing = JSON.parse(await readFile(config.lockPath, "utf8"));
    } catch {
      // Missing or invalid local lock is handled by stale cleanup below.
    }
    if (pidIsRunning(existing?.pid)) {
      process.kill(existing.pid, "SIGTERM");
      logger("daemon_release_signaled", { pid: existing.pid });
      return 0;
    }
    const result = await releaseStaleDaemonLock(config.lockPath);
    logger("lock_release_checked", result);
    return result.released || result.reason === "missing" ? 0 : 2;
  }
  if (command === "tick") {
    const lock = await acquireDaemonLock(config.lockPath);
    try {
      const previousState = await readDaemonState(config.statePath);
      const tick = await tickPortfolioDaemon({ config, state: previousState, logger });
      await writeDaemonState(config.statePath, tick.health);
      logger("tick_completed", {
        status: tick.health.status,
        role: tick.health.role,
        logicalDate: tick.health.logicalDate,
        activeRunCount: tick.health.activeRunIds?.length ?? 0,
        blockerCode: tick.health.blockerCode
      });
      let releaseError = null;
      if (tick.leaseToken) {
        const release = await releaseHeldPortfolioLease({
          config,
          leaseToken: tick.leaseToken,
          logger
        });
        releaseError = release.error;
        logger("server_lease_release", {
          released: release.released,
          leaseLost: release.leaseLost,
          skipped: release.skipped,
          error: release.error ? safeErrorMessage(release.error, [config.token]) : null
        });
      }
      return tick.health.status === "blocked" || releaseError ? 2 : 0;
    } finally {
      await releaseDaemonLock(lock);
    }
  }
  await runPortfolioDaemon({ configPath, expectedConfigSha256, logger });
  return 0;
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const safeMessage = redactSecrets(error instanceof Error ? error.message : String(error));
      process.stderr.write(`${JSON.stringify({
        scope: "project-kings-portfolio-daemon",
        event: "fatal",
        at: new Date().toISOString(),
        error: safeMessage
      })}\n`);
      process.exitCode = 1;
    });
}
