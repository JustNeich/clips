import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureCodexLoggedIn } from "../codex-runner";
import {
  type ProductionAgentArtifact,
  type ProductionAgentPacketByRole
} from "./production-agent-contracts";
import {
  createCodexProductionAgentInvoker,
  runProductionSemanticAgent
} from "./production-agent-runtime";
import {
  loadFrozenProductionAgentRouteManifest,
  type ProductionReadyAgentRouteManifest
} from "./production-model-route-manifest";
import {
  buildProductionSemanticJobResult,
  hashProductionSemanticValue,
  PRODUCTION_SEMANTIC_JOB_ROLES,
  PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION,
  PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION,
  validateProductionSemanticJobPayload,
  validateProductionSemanticJobResult,
  type ProductionSemanticExecutorReadiness,
  type ProductionSemanticJobExecutor,
  type ProductionSemanticJobPayload,
  type ProductionSemanticJobResult,
  type ProductionSemanticJobRole,
  type ProductionSemanticInputRef
} from "./production-semantic-job-contract";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const PROJECT_KINGS_SEMANTIC_WORKER_ENV = {
  enabled: "PROJECT_KINGS_SEMANTIC_WORKER_ENABLED",
  codexHome: "PROJECT_KINGS_SEMANTIC_CODEX_HOME",
  routeManifestPath: "PROJECT_KINGS_SEMANTIC_ROUTE_MANIFEST_PATH",
  workRoot: "PROJECT_KINGS_SEMANTIC_WORK_ROOT"
} as const;

export class ProductionSemanticWorkerInputError extends Error {
  readonly code:
    | "input_http_failed"
    | "input_header_mismatch"
    | "input_size_mismatch"
    | "input_sha256_mismatch"
    | "input_write_failed";

  constructor(code: ProductionSemanticWorkerInputError["code"], message: string) {
    super(message);
    this.name = "ProductionSemanticWorkerInputError";
    this.code = code;
  }
}

export class ProductionSemanticWorkerPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionSemanticWorkerPreflightError";
  }
}

export type ProductionSemanticLeasedJobExecutor = ProductionSemanticJobExecutor &
  Readonly<{
    executeLeasedJob: (
      jobId: string,
      payload: ProductionSemanticJobPayload,
      options?: { signal?: AbortSignal | null }
    ) => Promise<ProductionSemanticJobResult>;
  }>;

type ExecutorDependencies = Readonly<{
  ensureLoggedIn?: typeof ensureCodexLoggedIn;
  loadManifest?: typeof loadFrozenProductionAgentRouteManifest;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  runAgent?: typeof runProductionSemanticAgent;
}>;

export type ProductionSemanticWorkerExecutorOptions = Readonly<{
  serverOrigin: string;
  sessionToken: string;
  codexHome: string;
  routeManifestPath: string;
  workRoot: string;
  workerRuntimeVersion: string;
  enabled: boolean;
  repoCwd?: string;
  dependencies?: ExecutorDependencies;
}>;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ProductionSemanticWorkerPreflightError(`${field} is required.`);
  }
  return normalized;
}

function assertAbsolutePath(value: string, field: string): string {
  const normalized = required(value, field);
  if (!path.isAbsolute(normalized)) {
    throw new ProductionSemanticWorkerPreflightError(`${field} must be an absolute path.`);
  }
  return normalized;
}

function normalizeServerOrigin(value: string): string {
  const normalized = required(value, "serverOrigin").replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ProductionSemanticWorkerPreflightError("serverOrigin must be a valid URL.");
  }
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new ProductionSemanticWorkerPreflightError(
      "Production semantic input transport requires HTTPS outside localhost."
    );
  }
  return parsed.origin;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ProductionSemanticWorkerPreflightError) return error.message;
  return "Production semantic executor preflight failed; inspect local worker logs.";
}

async function readResponseBytesBounded(
  response: Response,
  expectedBytes: number,
  signal?: AbortSignal | null
): Promise<Uint8Array> {
  if (!response.body) {
    throw new ProductionSemanticWorkerInputError("input_http_failed", "Semantic input response had no body.");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Semantic input download was aborted.", "AbortError");
      }
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > expectedBytes) {
        throw new ProductionSemanticWorkerInputError(
          "input_size_mismatch",
          `Semantic input exceeded its declared ${expectedBytes} byte size.`
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) {
    throw new ProductionSemanticWorkerInputError(
      "input_size_mismatch",
      `Semantic input size mismatch: expected ${expectedBytes}, received ${total}.`
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function inputUrl(serverOrigin: string, jobId: string, ref: ProductionSemanticInputRef): string {
  return (
    `${serverOrigin}/api/stage3/worker/jobs/${encodeURIComponent(jobId)}` +
    `/inputs/${encodeURIComponent(ref.inputId)}`
  );
}

export async function downloadLeasedProductionSemanticInput(input: {
  serverOrigin: string;
  sessionToken: string;
  jobId: string;
  ref: ProductionSemanticInputRef;
  destinationPath: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal | null;
}): Promise<ProductionAgentArtifact> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(inputUrl(input.serverOrigin, input.jobId, input.ref), {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${input.sessionToken}`
    },
    signal: input.signal ?? undefined
  });
  if (!response.ok) {
    throw new ProductionSemanticWorkerInputError(
      "input_http_failed",
      `Semantic input download failed with status ${response.status}.`
    );
  }
  const contentLength = response.headers.get("content-length");
  const responseInputId = response.headers.get("x-production-semantic-input-id");
  const responseSha256 = response.headers.get("x-production-semantic-sha256")?.toLowerCase();
  if (
    contentLength !== String(input.ref.sizeBytes) ||
    responseInputId !== input.ref.inputId ||
    responseSha256 !== input.ref.sha256
  ) {
    throw new ProductionSemanticWorkerInputError(
      "input_header_mismatch",
      "Semantic input response headers do not match the leased immutable reference."
    );
  }
  const bytes = await readResponseBytesBounded(response, input.ref.sizeBytes, input.signal);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== input.ref.sha256) {
    throw new ProductionSemanticWorkerInputError(
      "input_sha256_mismatch",
      `Semantic input SHA-256 mismatch for ${input.ref.inputId}.`
    );
  }
  try {
    await fs.mkdir(path.dirname(input.destinationPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(input.destinationPath, bytes, { mode: 0o600, flag: "wx" });
  } catch (error) {
    throw new ProductionSemanticWorkerInputError(
      "input_write_failed",
      `Semantic input could not be materialized: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return {
    id: input.ref.id,
    kind: input.ref.kind,
    mediaType: input.ref.mediaType,
    path: input.destinationPath,
    sha256: input.ref.sha256
  };
}

function assertManifestBinding(
  manifest: ProductionReadyAgentRouteManifest,
  payload: ProductionSemanticJobPayload
): void {
  if (
    manifest.manifestId !== payload.routeManifestId ||
    manifest.manifestSha256 !== payload.routeManifestSha256
  ) {
    throw new ProductionSemanticWorkerPreflightError(
      "Leased semantic job is not bound to the locally frozen route manifest."
    );
  }
  const selected = manifest.selections[payload.role];
  if (!selected || hashProductionSemanticValue(selected) !== hashProductionSemanticValue(payload.selection)) {
    throw new ProductionSemanticWorkerPreflightError(
      `Leased ${payload.role} selection differs from the locally frozen route manifest.`
    );
  }
}

function assertLocalCodexOnlyManifest(manifest: ProductionReadyAgentRouteManifest): void {
  for (const role of PRODUCTION_SEMANTIC_JOB_ROLES) {
    const selection = manifest.selections[role];
    if (
      !selection ||
      selection.primary.route.provider !== "codex" ||
      selection.fallback.route.provider !== "codex"
    ) {
      throw new ProductionSemanticWorkerPreflightError(
        `Semantic worker route ${role} must use the locally authenticated Codex provider.`
      );
    }
  }
}

function materializedPacket<R extends ProductionSemanticJobRole>(
  payload: ProductionSemanticJobPayload<R>,
  artifacts: readonly ProductionAgentArtifact[]
): ProductionAgentPacketByRole[R] {
  return {
    ...payload.packet,
    artifacts
  } as unknown as ProductionAgentPacketByRole[R];
}

async function invokeMaterializedSemanticRole<R extends ProductionSemanticJobRole>(input: {
  payload: ProductionSemanticJobPayload<R>;
  packet: ProductionAgentPacketByRole[R];
  invoker: ReturnType<typeof createCodexProductionAgentInvoker>;
  runAgent: typeof runProductionSemanticAgent;
  workerRuntimeVersion: string;
  completedAt: string;
}): Promise<ProductionSemanticJobResult<R>> {
  const run = await input.runAgent({
    role: input.payload.role,
    packet: input.packet,
    selection: input.payload.selection,
    invoker: input.invoker,
    maxAttempts: 2
  });
  return buildProductionSemanticJobResult({
    payload: input.payload,
    selectedRouteId: run.selectedRouteId,
    output: run.output,
    attempts: run.attempts,
    workerRuntimeVersion: input.workerRuntimeVersion,
    completedAt: input.completedAt
  });
}

export function createProductionSemanticWorkerExecutor(
  options: ProductionSemanticWorkerExecutorOptions
): ProductionSemanticLeasedJobExecutor {
  const dependencies = options.dependencies ?? {};
  const ensureLoggedIn = dependencies.ensureLoggedIn ?? ensureCodexLoggedIn;
  const loadManifest = dependencies.loadManifest ?? loadFrozenProductionAgentRouteManifest;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const runAgent = dependencies.runAgent ?? runProductionSemanticAgent;
  let readyManifest: ProductionReadyAgentRouteManifest | null = null;
  let preflightInFlight: Promise<ProductionSemanticExecutorReadiness> | null = null;

  const readyReadiness = (): ProductionSemanticExecutorReadiness => ({
    ready: true,
    code: "ready",
    message: "Local Codex login and frozen semantic manifest are ready.",
    jobSchemaVersion: PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION,
    resultSchemaVersion: PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION
  });

  async function performPreflight(): Promise<ProductionSemanticExecutorReadiness> {
    try {
      if (readyManifest) return readyReadiness();
      if (!options.enabled) {
        throw new ProductionSemanticWorkerPreflightError(
          `${PROJECT_KINGS_SEMANTIC_WORKER_ENV.enabled}=1 is required.`
        );
      }
      const codexHome = assertAbsolutePath(options.codexHome, PROJECT_KINGS_SEMANTIC_WORKER_ENV.codexHome);
      const routeManifestPath = assertAbsolutePath(
        options.routeManifestPath,
        PROJECT_KINGS_SEMANTIC_WORKER_ENV.routeManifestPath
      );
      assertAbsolutePath(options.workRoot, PROJECT_KINGS_SEMANTIC_WORKER_ENV.workRoot);
      required(options.sessionToken, "worker session credential");
      required(options.workerRuntimeVersion, "workerRuntimeVersion");
      normalizeServerOrigin(options.serverOrigin);
      await Promise.all([
        ensureLoggedIn(codexHome),
        fs.mkdir(options.workRoot, { recursive: true, mode: 0o700 })
      ]);
      const workRootStat = await fs.stat(options.workRoot);
      if (
        !workRootStat.isDirectory() ||
        (process.platform !== "win32" && (workRootStat.mode & 0o077) !== 0)
      ) {
        throw new ProductionSemanticWorkerPreflightError(
          "Semantic worker work root must be a private 0700 directory."
        );
      }
      readyManifest = await loadManifest({
        repoCwd: options.repoCwd ?? options.workRoot,
        manifestPath: routeManifestPath
      });
      assertLocalCodexOnlyManifest(readyManifest);
      return readyReadiness();
    } catch (error) {
      readyManifest = null;
      return {
        ready: false,
        code: "preflight_failed",
        message: safeErrorMessage(error),
        jobSchemaVersion: PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION,
        resultSchemaVersion: PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION
      };
    }
  }

  async function preflight(): Promise<ProductionSemanticExecutorReadiness> {
    if (readyManifest) return readyReadiness();
    if (!preflightInFlight) preflightInFlight = performPreflight();
    const current = preflightInFlight;
    try {
      return await current;
    } finally {
      if (preflightInFlight === current) preflightInFlight = null;
    }
  }

  async function executeLeasedJob(
    jobId: string,
    rawPayload: ProductionSemanticJobPayload,
    executionOptions: { signal?: AbortSignal | null } = {}
  ): Promise<ProductionSemanticJobResult> {
    const payload = validateProductionSemanticJobPayload(rawPayload);
    if (!jobId.trim()) {
      throw new ProductionSemanticWorkerPreflightError("Exact leased job id is required.");
    }
    const manifest = readyManifest;
    if (!manifest) {
      const readiness = await preflight();
      if (!readiness.ready || !readyManifest) {
        throw new ProductionSemanticWorkerPreflightError(readiness.message);
      }
    }
    readyManifest = await loadManifest({
      repoCwd: options.repoCwd ?? options.workRoot,
      manifestPath: options.routeManifestPath
    });
    assertLocalCodexOnlyManifest(readyManifest);
    assertManifestBinding(readyManifest, payload);
    if (executionOptions.signal?.aborted) {
      throw executionOptions.signal.reason instanceof Error
        ? executionOptions.signal.reason
        : new DOMException("Semantic job was aborted before input download.", "AbortError");
    }

    const jobDir = await fs.mkdtemp(path.join(options.workRoot, "leased-semantic-"));
    try {
      const artifacts: ProductionAgentArtifact[] = [];
      for (const [index, ref] of payload.packet.artifacts.entries()) {
        const destinationPath = path.join(
          jobDir,
          `${String(index + 1).padStart(3, "0")}-${ref.fileName}`
        );
        artifacts.push(
          await downloadLeasedProductionSemanticInput({
            serverOrigin: normalizeServerOrigin(options.serverOrigin),
            sessionToken: options.sessionToken,
            jobId,
            ref,
            destinationPath,
            fetchImpl,
            signal: executionOptions.signal
          })
        );
      }
      const packet = materializedPacket(payload, artifacts);
      const invoker = createCodexProductionAgentInvoker({
        repoCwd: options.repoCwd ?? options.workRoot,
        codexHome: options.codexHome,
        tempRoot: jobDir,
        signal: executionOptions.signal
      });
      return validateProductionSemanticJobResult(
        await invokeMaterializedSemanticRole({
          payload,
          packet,
          invoker,
          runAgent,
          workerRuntimeVersion: options.workerRuntimeVersion,
          completedAt: now().toISOString()
        }),
        payload
      );
    } finally {
      await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return {
    preflight,
    execute: async () => {
      throw new ProductionSemanticWorkerPreflightError(
        "Production semantic execution requires an exact active Stage 3 job lease."
      );
    },
    executeLeasedJob
  };
}

export function createProductionSemanticWorkerExecutorFromEnv(input: {
  serverOrigin: string;
  sessionToken: string;
  workerRuntimeVersion: string;
  env?: NodeJS.ProcessEnv;
  dependencies?: ExecutorDependencies;
}): ProductionSemanticLeasedJobExecutor {
  const env = input.env ?? process.env;
  return createProductionSemanticWorkerExecutor({
    serverOrigin: input.serverOrigin,
    sessionToken: input.sessionToken,
    codexHome: env[PROJECT_KINGS_SEMANTIC_WORKER_ENV.codexHome]?.trim() ?? "",
    routeManifestPath:
      env[PROJECT_KINGS_SEMANTIC_WORKER_ENV.routeManifestPath]?.trim() ?? "",
    workRoot:
      env[PROJECT_KINGS_SEMANTIC_WORKER_ENV.workRoot]?.trim() ??
      path.join(os.homedir(), "Library", "Application Support", "Clips Project Kings Semantic Worker", "work"),
    workerRuntimeVersion: input.workerRuntimeVersion,
    enabled: env[PROJECT_KINGS_SEMANTIC_WORKER_ENV.enabled]?.trim() === "1",
    repoCwd: env.PROJECT_KINGS_SEMANTIC_REPO_CWD?.trim(),
    dependencies: input.dependencies
  });
}

export function isProductionSemanticInputIntegrityError(error: unknown): boolean {
  return (
    error instanceof ProductionSemanticWorkerInputError &&
    ["input_header_mismatch", "input_size_mismatch", "input_sha256_mismatch"].includes(error.code)
  );
}

export function isSha256(value: string): boolean {
  return SHA256_PATTERN.test(value);
}
