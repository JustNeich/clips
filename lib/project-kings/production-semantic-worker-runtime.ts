import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isProductionSemanticInputIntegrityError,
  createProductionSemanticWorkerExecutorFromEnv,
  type ProductionSemanticLeasedJobExecutor
} from "./production-semantic-worker-executor";
import {
  isProductionSemanticExecutorReadiness,
  parseProductionSemanticJobPayloadJson,
  validateProductionSemanticJobResult,
  type ProductionSemanticExecutorReadiness,
  type ProductionSemanticJobPayload,
  type ProductionSemanticJobResult
} from "./production-semantic-job-contract";
import {
  persistProductionSemanticResultSpool,
  readProductionSemanticResultSpool,
  removeProductionSemanticResultSpool
} from "./production-semantic-worker-spool";

declare const __PROJECT_KINGS_SEMANTIC_WORKER_RUNTIME_VERSION__: string | undefined;
declare const __PROJECT_KINGS_SEMANTIC_WORKER_STAGE3_APP_VERSION__: string | undefined;

export const PROJECT_KINGS_SEMANTIC_WORKER_DEFAULT_POLL_MS = 2_000;
export const PROJECT_KINGS_SEMANTIC_WORKER_DEFAULT_HEARTBEAT_MS = 10_000;
export const PROJECT_KINGS_SEMANTIC_WORKER_DEFAULT_JOB_TIMEOUT_MS = 12 * 60_000;
export const PROJECT_KINGS_SEMANTIC_WORKER_DEFAULT_CONCURRENCY = 3;

export type ProjectKingsSemanticWorkerConfig = Readonly<{
  serverOrigin: string;
  sessionToken: string;
  workerId: string;
  label: string;
}>;

export type ProjectKingsSemanticWorkerRunOutcome = Readonly<{
  status: "idle" | "completed" | "failed";
  jobId: string | null;
  reusedSpool: boolean;
}>;

type ClaimedJob = Readonly<{
  job: Readonly<{
    id: string;
    kind: "production-semantic";
    status: "running";
  }>;
  payloadJson: string;
}>;

export class ProductionSemanticWorkerAuthError extends Error {
  readonly status: number;

  constructor(status: number, message = "Semantic worker authentication or lease was rejected.") {
    super(message);
    this.name = "ProductionSemanticWorkerAuthError";
    this.status = status;
  }
}

export class ProductionSemanticCompletionUnknownError extends Error {
  readonly jobId: string;
  readonly status: number;

  constructor(jobId: string, status: number) {
    super(
      `Semantic result completion is unconfirmed for job ${jobId}; local result spool was retained.`
    );
    this.name = "ProductionSemanticCompletionUnknownError";
    this.jobId = jobId;
    this.status = status;
  }
}

export class ProductionSemanticCompletionRejectedError extends Error {
  readonly jobId: string;
  readonly status: number;

  constructor(jobId: string, status: number) {
    super(`Semantic result completion was deterministically rejected for job ${jobId}.`);
    this.name = "ProductionSemanticCompletionRejectedError";
    this.jobId = jobId;
    this.status = status;
  }
}

export class ProductionSemanticLeaseLostError extends Error {
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Semantic worker lost the exact lease for job ${jobId}.`);
    this.name = "ProductionSemanticLeaseLostError";
    this.jobId = jobId;
  }
}

export type ProjectKingsSemanticWorkerRuntimeOptions = Readonly<{
  config: ProjectKingsSemanticWorkerConfig;
  executor: ProductionSemanticLeasedJobExecutor;
  appVersion: string;
  semanticRuntimeVersion: string;
  spoolRoot: string;
  fetchImpl?: typeof fetch;
  heartbeatIntervalMs?: number;
  jobTimeoutMs?: number;
}>;

function normalizeServerOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("Semantic worker requires HTTPS outside localhost.");
  }
  return parsed.origin;
}

function authHeaders(config: ProjectKingsSemanticWorkerConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.sessionToken}` };
}

function capabilities(readiness: ProductionSemanticExecutorReadiness) {
  return {
    workerClass: "project-kings-semantic-only-v1",
    maxConcurrentJobsPerProcess: PROJECT_KINGS_SEMANTIC_WORKER_DEFAULT_CONCURRENCY,
    productionSemantic: readiness
  };
}

async function checkedResponse(response: Response, operation: string): Promise<Response> {
  if (response.ok) return response;
  if (response.status === 401 || response.status === 403 || response.status === 409) {
    throw new ProductionSemanticWorkerAuthError(response.status);
  }
  throw new Error(`${operation} failed with status ${response.status}.`);
}

async function postWorkerHeartbeat(input: {
  options: ProjectKingsSemanticWorkerRuntimeOptions;
  readiness: ProductionSemanticExecutorReadiness;
}): Promise<void> {
  const fetchImpl = input.options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${normalizeServerOrigin(input.options.config.serverOrigin)}/api/stage3/worker/heartbeat`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        ...authHeaders(input.options.config),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        appVersion: input.options.appVersion,
        capabilities: capabilities(input.readiness)
      })
    }
  );
  await checkedResponse(response, "Semantic worker heartbeat");
}

async function claimOneJob(input: {
  options: ProjectKingsSemanticWorkerRuntimeOptions;
  readiness: ProductionSemanticExecutorReadiness;
}): Promise<ClaimedJob | null> {
  const fetchImpl = input.options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${normalizeServerOrigin(input.options.config.serverOrigin)}/api/stage3/worker/jobs/claim`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        ...authHeaders(input.options.config),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        supportedKinds: ["production-semantic"],
        appVersion: input.options.appVersion,
        capabilities: capabilities(input.readiness)
      })
    }
  );
  if (response.status === 204) return null;
  await checkedResponse(response, "Semantic job claim");
  const parsed = (await response.json().catch(() => null)) as Partial<ClaimedJob> | null;
  if (
    !parsed?.job ||
    parsed.job.kind !== "production-semantic" ||
    parsed.job.status !== "running" ||
    typeof parsed.job.id !== "string" ||
    !parsed.job.id.trim() ||
    typeof parsed.payloadJson !== "string"
  ) {
    throw new Error("Semantic claim returned an invalid job envelope.");
  }
  return parsed as ClaimedJob;
}

async function postJobHeartbeat(input: {
  options: ProjectKingsSemanticWorkerRuntimeOptions;
  readiness: ProductionSemanticExecutorReadiness;
  jobId: string;
}): Promise<void> {
  const fetchImpl = input.options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${normalizeServerOrigin(input.options.config.serverOrigin)}/api/stage3/worker/jobs/${encodeURIComponent(input.jobId)}/heartbeat`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        ...authHeaders(input.options.config),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        appVersion: input.options.appVersion,
        capabilities: capabilities(input.readiness)
      })
    }
  );
  if (response.status === 404 || response.status === 409) {
    throw new ProductionSemanticLeaseLostError(input.jobId);
  }
  await checkedResponse(response, "Semantic job heartbeat");
}

async function completeJob(input: {
  options: ProjectKingsSemanticWorkerRuntimeOptions;
  jobId: string;
  result: ProductionSemanticJobResult;
}): Promise<void> {
  const fetchImpl = input.options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${normalizeServerOrigin(input.options.config.serverOrigin)}/api/stage3/worker/jobs/${encodeURIComponent(input.jobId)}/complete`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        ...authHeaders(input.options.config),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ resultJson: JSON.stringify(input.result) })
    }
  ).catch(() => null);
  if (response?.ok) return;
  const status = response?.status ?? 0;
  if (status === 401 || status === 403) throw new ProductionSemanticWorkerAuthError(status);
  if (status === 404 || status === 409) throw new ProductionSemanticLeaseLostError(input.jobId);
  if (status > 0 && status < 500 && status !== 408 && status !== 429) {
    throw new ProductionSemanticCompletionRejectedError(input.jobId, status);
  }
  throw new ProductionSemanticCompletionUnknownError(input.jobId, status);
}

async function failJob(input: {
  options: ProjectKingsSemanticWorkerRuntimeOptions;
  jobId: string;
  error: unknown;
}): Promise<void> {
  const fetchImpl = input.options.fetchImpl ?? fetch;
  const integrityFailure = isProductionSemanticInputIntegrityError(input.error);
  const completionRejected = input.error instanceof ProductionSemanticCompletionRejectedError;
  const response = await fetchImpl(
    `${normalizeServerOrigin(input.options.config.serverOrigin)}/api/stage3/worker/jobs/${encodeURIComponent(input.jobId)}/fail`,
    {
      method: "POST",
      redirect: "error",
      headers: {
        ...authHeaders(input.options.config),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        errorCode: integrityFailure
          ? "production_semantic_input_integrity_failed"
          : completionRejected
            ? "production_semantic_completion_rejected"
            : "production_semantic_executor_failed",
        message: integrityFailure
          ? "A leased semantic input failed immutable size or SHA-256 verification."
          : completionRejected
            ? "The server rejected the locally validated semantic result binding."
            : "The local production semantic executor failed closed.",
        recoverable: !integrityFailure && !completionRejected
      })
    }
  );
  await checkedResponse(response, "Semantic job failure report");
}

export async function runProjectKingsSemanticWorkerOnce(
  options: ProjectKingsSemanticWorkerRuntimeOptions
): Promise<ProjectKingsSemanticWorkerRunOutcome> {
  const readiness = await options.executor.preflight();
  if (
    !isProductionSemanticExecutorReadiness(readiness) ||
    !readiness.ready ||
    readiness.code !== "ready"
  ) {
    throw new Error(readiness.message || "Production semantic executor preflight failed.");
  }
  await postWorkerHeartbeat({ options, readiness });
  const claimed = await claimOneJob({ options, readiness });
  if (!claimed) {
    return { status: "idle", jobId: null, reusedSpool: false };
  }
  const payload = parseProductionSemanticJobPayloadJson(claimed.payloadJson);
  const jobController = new AbortController();
  let heartbeatRunning = false;
  let heartbeatError: unknown = null;
  const heartbeatTimer = setInterval(() => {
    if (heartbeatRunning || heartbeatError) return;
    heartbeatRunning = true;
    void postJobHeartbeat({ options, readiness, jobId: claimed.job.id })
      .catch((error) => {
        heartbeatError = error;
        if (!jobController.signal.aborted) jobController.abort(error);
      })
      .finally(() => {
        heartbeatRunning = false;
      });
  }, options.heartbeatIntervalMs ?? PROJECT_KINGS_SEMANTIC_WORKER_DEFAULT_HEARTBEAT_MS);
  heartbeatTimer.unref?.();
  const jobTimeoutMs = options.jobTimeoutMs ?? PROJECT_KINGS_SEMANTIC_WORKER_DEFAULT_JOB_TIMEOUT_MS;
  const jobTimeout = setTimeout(() => {
    if (!jobController.signal.aborted) {
      jobController.abort(
        new Error(`Production semantic job exceeded its ${jobTimeoutMs}ms worker watchdog.`)
      );
    }
  }, jobTimeoutMs);
  jobTimeout.unref?.();

  try {
    let result = await readProductionSemanticResultSpool({
      spoolRoot: options.spoolRoot,
      jobId: claimed.job.id,
      payload
    });
    const reusedSpool = Boolean(result);
    if (!result) {
      result = await options.executor.executeLeasedJob(claimed.job.id, payload, {
        signal: jobController.signal
      });
      result = validateProductionSemanticJobResult(result, payload);
      await persistProductionSemanticResultSpool({
        spoolRoot: options.spoolRoot,
        jobId: claimed.job.id,
        payload,
        result
      });
    }
    if (jobController.signal.aborted) {
      throw jobController.signal.reason instanceof Error
        ? jobController.signal.reason
        : new DOMException("Semantic job was aborted before completion.", "AbortError");
    }
    if (heartbeatError) throw heartbeatError;
    await postJobHeartbeat({ options, readiness, jobId: claimed.job.id });
    await completeJob({ options, jobId: claimed.job.id, result });
    await removeProductionSemanticResultSpool({
      spoolRoot: options.spoolRoot,
      jobId: claimed.job.id
    });
    return { status: "completed", jobId: claimed.job.id, reusedSpool };
  } catch (error) {
    if (
      error instanceof ProductionSemanticCompletionUnknownError ||
      error instanceof ProductionSemanticLeaseLostError ||
      error instanceof ProductionSemanticWorkerAuthError
    ) {
      throw error;
    }
    await failJob({ options, jobId: claimed.job.id, error });
    await removeProductionSemanticResultSpool({
      spoolRoot: options.spoolRoot,
      jobId: claimed.job.id
    });
    return { status: "failed", jobId: claimed.job.id, reusedSpool: false };
  } finally {
    clearInterval(heartbeatTimer);
    clearTimeout(jobTimeout);
  }
}

export async function runProjectKingsSemanticWorkerLoop(input: {
  options: ProjectKingsSemanticWorkerRuntimeOptions;
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  concurrency?: number;
}): Promise<void> {
  const shouldStop = input.shouldStop ?? (() => false);
  const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const concurrency = input.concurrency ?? PROJECT_KINGS_SEMANTIC_WORKER_DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new Error("Semantic worker concurrency must be an integer between 1 and 3.");
  }
  const runLane = async () => {
    while (!shouldStop()) {
      const outcome = await runProjectKingsSemanticWorkerOnce(input.options);
      if (outcome.status === "idle") {
        await sleep(input.pollIntervalMs ?? PROJECT_KINGS_SEMANTIC_WORKER_DEFAULT_POLL_MS);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => runLane()));
}

export async function readProjectKingsSemanticWorkerConfig(input: {
  configPath: string;
}): Promise<ProjectKingsSemanticWorkerConfig> {
  if (!path.isAbsolute(input.configPath)) {
    throw new Error("PROJECT_KINGS_SEMANTIC_WORKER_CONFIG_PATH must be absolute.");
  }
  const stat = await fs.lstat(input.configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Semantic worker config must be a regular non-symlink file.");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("Semantic worker config permissions must be 0600 or stricter.");
  }
  const parsed = JSON.parse(await fs.readFile(input.configPath, "utf-8")) as
    | Partial<ProjectKingsSemanticWorkerConfig>
    | null;
  if (
    !parsed ||
    typeof parsed.serverOrigin !== "string" ||
    typeof parsed.sessionToken !== "string" ||
    typeof parsed.workerId !== "string" ||
    typeof parsed.label !== "string" ||
    !parsed.sessionToken.trim() ||
    !parsed.workerId.trim()
  ) {
    throw new Error("Semantic worker config is incomplete.");
  }
  return {
    serverOrigin: normalizeServerOrigin(parsed.serverOrigin),
    sessionToken: parsed.sessionToken.trim(),
    workerId: parsed.workerId.trim(),
    label: parsed.label.trim() || "Project Kings semantic worker"
  };
}

export function resolveProjectKingsSemanticWorkerBuildIdentity(env: NodeJS.ProcessEnv = process.env): {
  appVersion: string;
  semanticRuntimeVersion: string;
} {
  const compiledAppVersion =
    typeof __PROJECT_KINGS_SEMANTIC_WORKER_STAGE3_APP_VERSION__ === "string"
      ? __PROJECT_KINGS_SEMANTIC_WORKER_STAGE3_APP_VERSION__.trim()
      : "";
  const compiledSemanticVersion =
    typeof __PROJECT_KINGS_SEMANTIC_WORKER_RUNTIME_VERSION__ === "string"
      ? __PROJECT_KINGS_SEMANTIC_WORKER_RUNTIME_VERSION__.trim()
      : "";
  const appVersion = compiledAppVersion || env.PROJECT_KINGS_SEMANTIC_STAGE3_APP_VERSION?.trim() || "";
  const semanticRuntimeVersion =
    compiledSemanticVersion || env.PROJECT_KINGS_SEMANTIC_RUNTIME_VERSION?.trim() || "";
  if (!appVersion || !semanticRuntimeVersion) {
    throw new Error("Semantic worker build identity is missing; use the frozen semantic worker bundle.");
  }
  return { appVersion, semanticRuntimeVersion };
}

export async function runProjectKingsSemanticWorkerFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const prepared = await preflightProjectKingsSemanticWorkerFromEnv(env);
  const { config, identity, executor } = prepared;
  const spoolRoot =
    env.PROJECT_KINGS_SEMANTIC_SPOOL_ROOT?.trim() ||
    path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Clips Project Kings Semantic Worker",
      "spool"
    );
  await fs.mkdir(spoolRoot, { recursive: true, mode: 0o700 });
  const spoolStat = await fs.stat(spoolRoot);
  if (!spoolStat.isDirectory() || (process.platform !== "win32" && (spoolStat.mode & 0o077) !== 0)) {
    throw new Error("Semantic worker spool root must be a private 0700 directory.");
  }
  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
  });
  process.on("SIGTERM", () => {
    stop = true;
  });
  await runProjectKingsSemanticWorkerLoop({
    options: {
      config,
      executor,
      appVersion: identity.appVersion,
      semanticRuntimeVersion: identity.semanticRuntimeVersion,
      spoolRoot
    },
    shouldStop: () => stop
  });
}

export async function preflightProjectKingsSemanticWorkerFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  config: ProjectKingsSemanticWorkerConfig;
  identity: { appVersion: string; semanticRuntimeVersion: string };
  executor: ProductionSemanticLeasedJobExecutor;
  readiness: ProductionSemanticExecutorReadiness;
}> {
  const configPath =
    env.PROJECT_KINGS_SEMANTIC_WORKER_CONFIG_PATH?.trim() ||
    path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Clips Project Kings Semantic Worker",
      "worker-config.json"
    );
  const config = await readProjectKingsSemanticWorkerConfig({ configPath });
  const identity = resolveProjectKingsSemanticWorkerBuildIdentity(env);
  const executor = createProductionSemanticWorkerExecutorFromEnv({
    serverOrigin: config.serverOrigin,
    sessionToken: config.sessionToken,
    workerRuntimeVersion: identity.semanticRuntimeVersion,
    env
  });
  const readiness = await executor.preflight();
  if (!readiness.ready || readiness.code !== "ready") {
    throw new Error(readiness.message);
  }
  return { config, identity, executor, readiness };
}

export function productionSemanticWorkerSafeStartupMessage(input: {
  instance: string;
  semanticRuntimeVersion: string;
}): string {
  return `Project Kings semantic-only worker ${input.instance} started (${input.semanticRuntimeVersion}).`;
}
