import { createHash } from "node:crypto";
import path from "node:path";

import {
  buildProductionAgentPrompt,
  validateProductionAgentOutput,
  validateProductionAgentPacket,
  type ProductionAgentArtifact,
  type ProductionAgentOutputByRole,
  type ProductionAgentPacketByRole
} from "./production-agent-contracts";
import {
  validateOutputAgainstPacket,
  validateProductionAgentModelSelection,
  type ProductionAgentAttemptOutcome,
  type ProductionAgentAttemptTelemetry,
  type ProductionAgentModelSelection,
  type ProductionAgentReasoningEffort
} from "./production-agent-runtime";

export const PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION =
  "project-kings-semantic-job-v1" as const;
export const PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION =
  "project-kings-semantic-result-v1" as const;

export const PRODUCTION_SEMANTIC_JOB_ROLES = [
  "source_fit",
  "caption",
  "montage_planner",
  "vision_qa"
] as const;

export type ProductionSemanticJobRole =
  (typeof PRODUCTION_SEMANTIC_JOB_ROLES)[number];

export type ProductionSemanticInputRef = Readonly<{
  inputId: string;
  id: string;
  kind: ProductionAgentArtifact["kind"];
  mediaType: ProductionAgentArtifact["mediaType"];
  fileName: string;
  sizeBytes: number;
  sha256: string;
  /** Content-addressed key only. It is deliberately not a server-local path. */
  storageKey: string;
}>;

export type ProductionSemanticPortablePacketByRole = {
  [R in ProductionSemanticJobRole]: Omit<ProductionAgentPacketByRole[R], "artifacts"> & {
    artifacts: readonly ProductionSemanticInputRef[];
  };
};

export type ProductionSemanticJobPayload<
  R extends ProductionSemanticJobRole = ProductionSemanticJobRole
> = Readonly<{
  schemaVersion: typeof PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION;
  invocationKey: string;
  role: R;
  runId: string;
  itemId: string;
  packetSha256: string;
  promptSha256: string;
  qualityBindingSha256: string | null;
  routeManifestId: string;
  routeManifestSha256: string;
  selection: ProductionAgentModelSelection;
  packet: ProductionSemanticPortablePacketByRole[R];
  payloadSha256: string;
}>;

export type ProductionSemanticJobResult<
  R extends ProductionSemanticJobRole = ProductionSemanticJobRole
> = Readonly<{
  schemaVersion: typeof PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION;
  invocationKey: string;
  role: R;
  payloadSha256: string;
  packetSha256: string;
  promptSha256: string;
  routeManifestSha256: string;
  selectedRouteId: string;
  output: ProductionAgentOutputByRole[R];
  outputSha256: string;
  attempts: readonly ProductionAgentAttemptTelemetry[];
  workerRuntimeVersion: string;
  completedAt: string;
  resultSha256: string;
}>;

export type ProductionSemanticExecutorReadiness = Readonly<{
  ready: boolean;
  code: "ready" | "executor_missing" | "preflight_failed";
  message: string;
  jobSchemaVersion: typeof PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION;
  resultSchemaVersion: typeof PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION;
}>;

export type ProductionSemanticJobExecutor = Readonly<{
  preflight: () => Promise<ProductionSemanticExecutorReadiness>;
  execute: (
    payload: ProductionSemanticJobPayload,
    options: { signal?: AbortSignal | null }
  ) => Promise<ProductionSemanticJobResult>;
}>;

export class ProductionSemanticJobContractError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ProductionSemanticJobContractError";
    this.field = field;
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
export const PRODUCTION_SEMANTIC_INPUT_MAX_BYTES = 100 * 1024 * 1024;
export const PRODUCTION_SEMANTIC_INPUT_AGGREGATE_MAX_BYTES = 500 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ProductionSemanticJobContractError("hash", "contains a non-finite number");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  throw new ProductionSemanticJobContractError(
    "hash",
    `contains unsupported value ${typeof value}`
  );
}

export function hashProductionSemanticValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductionSemanticJobContractError(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max = 2_000): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProductionSemanticJobContractError(field, "must be a non-empty string");
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new ProductionSemanticJobContractError(field, `must be at most ${max} characters`);
  }
  return normalized;
}

function nullableText(value: unknown, field: string, max = 4_000): string | null {
  if (value === null) return null;
  return text(value, field, max);
}

function sha256(value: unknown, field: string): string {
  const normalized = text(value, field, 64).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new ProductionSemanticJobContractError(field, "must be a lowercase SHA-256 digest");
  }
  return normalized;
}

function safeId(value: unknown, field: string): string {
  const normalized = text(value, field, 160);
  if (!SAFE_ID_PATTERN.test(normalized)) {
    throw new ProductionSemanticJobContractError(field, "contains unsupported characters");
  }
  return normalized;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new ProductionSemanticJobContractError(
      field,
      `must be an integer between ${min} and ${max}`
    );
  }
  return Number(value);
}

function finite(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new ProductionSemanticJobContractError(
      field,
      `must be a number between ${min} and ${max}`
    );
  }
  return value;
}

function semanticRole(value: unknown, field = "role"): ProductionSemanticJobRole {
  if (!PRODUCTION_SEMANTIC_JOB_ROLES.includes(value as ProductionSemanticJobRole)) {
    throw new ProductionSemanticJobContractError(field, "is not a supported semantic job role");
  }
  return value as ProductionSemanticJobRole;
}

function validateInputRef(value: unknown, index: number): ProductionSemanticInputRef {
  const input = record(value, `packet.artifacts[${index}]`);
  const fileName = text(input.fileName, `packet.artifacts[${index}].fileName`, 255);
  if (
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("\0")
  ) {
    throw new ProductionSemanticJobContractError(
      `packet.artifacts[${index}].fileName`,
      "must be one plain file name"
    );
  }
  const digest = sha256(input.sha256, `packet.artifacts[${index}].sha256`);
  const storageKey = sha256(input.storageKey, `packet.artifacts[${index}].storageKey`);
  if (storageKey !== digest) {
    throw new ProductionSemanticJobContractError(
      `packet.artifacts[${index}].storageKey`,
      "must equal the content SHA-256"
    );
  }
  const kind = input.kind;
  const allowedKinds: ProductionAgentArtifact["kind"][] = [
    "concept_contract",
    "source_pool",
    "source_metadata",
    "transcript",
    "ocr",
    "key_frame",
    "preview_frame",
    "factual_evidence",
    "caption_brief",
    "montage_plan",
    "quality_verdict"
  ];
  if (!allowedKinds.includes(kind as ProductionAgentArtifact["kind"])) {
    throw new ProductionSemanticJobContractError(
      `packet.artifacts[${index}].kind`,
      "is unsupported"
    );
  }
  if (input.mediaType !== "image" && input.mediaType !== "json" && input.mediaType !== "text") {
    throw new ProductionSemanticJobContractError(
      `packet.artifacts[${index}].mediaType`,
      "is unsupported"
    );
  }
  return {
    inputId: safeId(input.inputId, `packet.artifacts[${index}].inputId`),
    id: safeId(input.id, `packet.artifacts[${index}].id`),
    kind: kind as ProductionAgentArtifact["kind"],
    mediaType: input.mediaType,
    fileName,
    sizeBytes: integer(
      input.sizeBytes,
      `packet.artifacts[${index}].sizeBytes`,
      1,
      PRODUCTION_SEMANTIC_INPUT_MAX_BYTES
    ),
    sha256: digest,
    storageKey
  };
}

function hydratePacketForValidation<R extends ProductionSemanticJobRole>(
  role: R,
  packet: ProductionSemanticPortablePacketByRole[R]
): ProductionAgentPacketByRole[R] {
  return {
    ...packet,
    artifacts: packet.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      mediaType: artifact.mediaType,
      path: path.resolve("production-semantic-inputs", artifact.fileName),
      sha256: artifact.sha256
    }))
  } as unknown as ProductionAgentPacketByRole[R];
}

function validatePortablePacket<R extends ProductionSemanticJobRole>(
  role: R,
  value: unknown
): ProductionSemanticPortablePacketByRole[R] {
  const packet = record(value, "packet");
  if (!Array.isArray(packet.artifacts)) {
    throw new ProductionSemanticJobContractError("packet.artifacts", "must be an array");
  }
  const artifacts = packet.artifacts.map(validateInputRef);
  const totalInputBytes = artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0);
  if (totalInputBytes > PRODUCTION_SEMANTIC_INPUT_AGGREGATE_MAX_BYTES) {
    throw new ProductionSemanticJobContractError(
      "packet.artifacts",
      `exceeds the ${PRODUCTION_SEMANTIC_INPUT_AGGREGATE_MAX_BYTES} byte aggregate limit`
    );
  }
  if (new Set(artifacts.map((artifact) => artifact.inputId)).size !== artifacts.length) {
    throw new ProductionSemanticJobContractError("packet.artifacts", "inputId values must be unique");
  }
  const portable = {
    ...packet,
    role,
    artifacts
  } as unknown as ProductionSemanticPortablePacketByRole[R];
  const validated = validateProductionAgentPacket(role, hydratePacketForValidation(role, portable));
  return {
    ...validated,
    artifacts
  } as unknown as ProductionSemanticPortablePacketByRole[R];
}

function promptForPortablePacket<R extends ProductionSemanticJobRole>(
  role: R,
  packet: ProductionSemanticPortablePacketByRole[R]
): string {
  return buildProductionAgentPrompt(role, hydratePacketForValidation(role, packet));
}

function assertSerializedSize(value: unknown, max: number, field: string): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf-8");
  if (bytes > max) {
    throw new ProductionSemanticJobContractError(field, `exceeds ${max} serialized bytes`);
  }
}

export function buildProductionSemanticJobPayload<R extends ProductionSemanticJobRole>(input: {
  role: R;
  qualityBindingSha256?: string | null;
  routeManifestId: string;
  routeManifestSha256: string;
  selection: ProductionAgentModelSelection;
  packet: ProductionSemanticPortablePacketByRole[R];
}): ProductionSemanticJobPayload<R> {
  const role = semanticRole(input.role) as R;
  const packet = validatePortablePacket(role, input.packet);
  if (packet.role !== role) {
    throw new ProductionSemanticJobContractError("packet.role", "does not match payload role");
  }
  validateProductionAgentModelSelection(input.selection, role);
  const packetSha256 = hashProductionSemanticValue(packet);
  const promptSha256 = createHash("sha256")
    .update(promptForPortablePacket(role, packet))
    .digest("hex");
  const qualityBindingSha256 = input.qualityBindingSha256 === null || input.qualityBindingSha256 === undefined
    ? null
    : sha256(input.qualityBindingSha256, "qualityBindingSha256");
  const unsigned = {
    schemaVersion: PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION,
    invocationKey: hashProductionSemanticValue({
      role,
      packetSha256,
      promptSha256,
      qualityBindingSha256,
      routeManifestSha256: sha256(input.routeManifestSha256, "routeManifestSha256"),
      selection: input.selection
    }),
    role,
    runId: packet.runId,
    itemId: packet.itemId,
    packetSha256,
    promptSha256,
    qualityBindingSha256,
    routeManifestId: safeId(input.routeManifestId, "routeManifestId"),
    routeManifestSha256: sha256(input.routeManifestSha256, "routeManifestSha256"),
    selection: input.selection,
    packet
  } as const;
  const payload = {
    ...unsigned,
    payloadSha256: hashProductionSemanticValue(unsigned)
  } satisfies ProductionSemanticJobPayload<R>;
  assertSerializedSize(payload, MAX_PAYLOAD_BYTES, "payload");
  return payload;
}

export function validateProductionSemanticJobPayload(
  value: unknown
): ProductionSemanticJobPayload {
  const input = record(value, "payload");
  if (input.schemaVersion !== PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION) {
    throw new ProductionSemanticJobContractError("schemaVersion", "is unsupported");
  }
  const role = semanticRole(input.role);
  const packet = validatePortablePacket(role, input.packet);
  if (packet.role !== role) {
    throw new ProductionSemanticJobContractError("packet.role", "does not match payload role");
  }
  const runId = text(input.runId, "runId", 160);
  const itemId = text(input.itemId, "itemId", 160);
  if (runId !== packet.runId || itemId !== packet.itemId) {
    throw new ProductionSemanticJobContractError(
      "packet",
      "runId/itemId do not match the payload binding"
    );
  }
  const selection = input.selection as ProductionAgentModelSelection;
  validateProductionAgentModelSelection(selection, role);
  const packetSha256 = sha256(input.packetSha256, "packetSha256");
  if (packetSha256 !== hashProductionSemanticValue(packet)) {
    throw new ProductionSemanticJobContractError("packetSha256", "does not match packet content");
  }
  const promptSha256 = sha256(input.promptSha256, "promptSha256");
  const actualPromptSha256 = createHash("sha256")
    .update(promptForPortablePacket(role, packet))
    .digest("hex");
  if (promptSha256 !== actualPromptSha256) {
    throw new ProductionSemanticJobContractError("promptSha256", "does not match packet prompt");
  }
  const qualityBindingSha256 = input.qualityBindingSha256 === null
    ? null
    : sha256(input.qualityBindingSha256, "qualityBindingSha256");
  const routeManifestSha256 = sha256(input.routeManifestSha256, "routeManifestSha256");
  const invocationKey = sha256(input.invocationKey, "invocationKey");
  const expectedInvocationKey = hashProductionSemanticValue({
    role,
    packetSha256,
    promptSha256,
    qualityBindingSha256,
    routeManifestSha256,
    selection
  });
  if (invocationKey !== expectedInvocationKey) {
    throw new ProductionSemanticJobContractError("invocationKey", "does not match payload bindings");
  }
  const unsigned = {
    schemaVersion: PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION,
    invocationKey,
    role,
    runId,
    itemId,
    packetSha256,
    promptSha256,
    qualityBindingSha256,
    routeManifestId: safeId(input.routeManifestId, "routeManifestId"),
    routeManifestSha256,
    selection,
    packet
  } as const;
  const payloadSha256 = sha256(input.payloadSha256, "payloadSha256");
  if (payloadSha256 !== hashProductionSemanticValue(unsigned)) {
    throw new ProductionSemanticJobContractError("payloadSha256", "does not match payload content");
  }
  const payload = { ...unsigned, payloadSha256 } satisfies ProductionSemanticJobPayload;
  assertSerializedSize(payload, MAX_PAYLOAD_BYTES, "payload");
  return payload;
}

export function parseProductionSemanticJobPayloadJson(
  payloadJson: string
): ProductionSemanticJobPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    throw new ProductionSemanticJobContractError("payload", "must be valid JSON");
  }
  return validateProductionSemanticJobPayload(parsed);
}

function validateUsage(value: unknown, field: string) {
  if (value === null) return null;
  const usage = record(value, field);
  return {
    inputTokens: integer(usage.inputTokens, `${field}.inputTokens`, 0, Number.MAX_SAFE_INTEGER),
    cachedInputTokens: integer(
      usage.cachedInputTokens,
      `${field}.cachedInputTokens`,
      0,
      Number.MAX_SAFE_INTEGER
    ),
    outputTokens: integer(usage.outputTokens, `${field}.outputTokens`, 0, Number.MAX_SAFE_INTEGER),
    reasoningOutputTokens: integer(
      usage.reasoningOutputTokens,
      `${field}.reasoningOutputTokens`,
      0,
      Number.MAX_SAFE_INTEGER
    )
  };
}

function validateAttempt(
  value: unknown,
  index: number,
  payload: ProductionSemanticJobPayload
): ProductionAgentAttemptTelemetry {
  const field = `attempts[${index}]`;
  const attempt = record(value, field);
  if (attempt.schemaVersion !== 1) {
    throw new ProductionSemanticJobContractError(`${field}.schemaVersion`, "must equal 1");
  }
  if (attempt.role !== payload.role) {
    throw new ProductionSemanticJobContractError(`${field}.role`, "does not match payload role");
  }
  const reasoningEffort = text(attempt.reasoningEffort, `${field}.reasoningEffort`, 20);
  if (!(["low", "medium", "high", "x-high"] as string[]).includes(reasoningEffort)) {
    throw new ProductionSemanticJobContractError(`${field}.reasoningEffort`, "is unsupported");
  }
  const outcome = text(attempt.outcome, `${field}.outcome`, 40);
  if (!(["passed", "invoke_error", "schema_error", "telemetry_missing"] as string[]).includes(outcome)) {
    throw new ProductionSemanticJobContractError(`${field}.outcome`, "is unsupported");
  }
  const promptSha256 = sha256(attempt.promptSha256, `${field}.promptSha256`);
  if (promptSha256 !== payload.promptSha256) {
    throw new ProductionSemanticJobContractError(`${field}.promptSha256`, "does not match payload prompt");
  }
  const normalized = {
    schemaVersion: 1 as const,
    attempt: integer(attempt.attempt, `${field}.attempt`, 1, 10),
    role: payload.role,
    routeId: safeId(attempt.routeId, `${field}.routeId`),
    provider: text(attempt.provider, `${field}.provider`, 160),
    model: text(attempt.model, `${field}.model`, 160),
    reasoningEffort: reasoningEffort as ProductionAgentReasoningEffort,
    benchmarkVersion: text(attempt.benchmarkVersion, `${field}.benchmarkVersion`, 160),
    timeoutMs: integer(attempt.timeoutMs, `${field}.timeoutMs`, 1_000, 60 * 60_000),
    startedAt: text(attempt.startedAt, `${field}.startedAt`, 64),
    durationMs: finite(attempt.durationMs, `${field}.durationMs`, 0, 60 * 60_000),
    promptSha256,
    outputSha256: attempt.outputSha256 === null
      ? null
      : sha256(attempt.outputSha256, `${field}.outputSha256`),
    usage: validateUsage(attempt.usage, `${field}.usage`),
    outcome: outcome as ProductionAgentAttemptOutcome,
    error: attempt.error === null ? null : nullableText(attempt.error, `${field}.error`)
  };
  if (normalized.attempt !== index + 1) {
    throw new ProductionSemanticJobContractError(`${field}.attempt`, "must match its ordered attempt index");
  }
  const selection = payload.selection;
  if (selection) {
    const expected = index === 0 ? selection.primary : index === 1 ? selection.fallback : null;
    if (!expected) {
      throw new ProductionSemanticJobContractError(field, "exceeds the two authorized model routes");
    }
    const exactBindings = [
      ["routeId", normalized.routeId, expected.route.routeId],
      ["provider", normalized.provider, expected.route.provider],
      ["model", normalized.model, expected.route.model],
      ["reasoningEffort", normalized.reasoningEffort, expected.benchmark.reasoningEffort],
      ["benchmarkVersion", normalized.benchmarkVersion, expected.benchmark.benchmarkVersion],
      ["timeoutMs", normalized.timeoutMs, expected.route.capabilities.timeoutMs]
    ] as const;
    for (const [binding, actual, authorized] of exactBindings) {
      if (actual !== authorized) {
        throw new ProductionSemanticJobContractError(`${field}.${binding}`, "does not match the authorized benchmark route");
      }
    }
  }
  if (normalized.outcome === "passed") {
    if (!normalized.usage || !normalized.outputSha256 || normalized.error !== null) {
      throw new ProductionSemanticJobContractError(field, "a passed attempt requires usage/output and no error");
    }
  }
  return normalized;
}

function validateSelectedAttempt(
  attempts: readonly ProductionAgentAttemptTelemetry[],
  selectedRouteId: string,
  field: string
): void {
  const passed = attempts.filter((attempt) => attempt.outcome === "passed");
  const finalAttempt = attempts.at(-1);
  if (
    passed.length !== 1 ||
    !finalAttempt ||
    finalAttempt.outcome !== "passed" ||
    finalAttempt.routeId !== selectedRouteId
  ) {
    throw new ProductionSemanticJobContractError(
      field,
      "must identify the single passed final authorized attempt"
    );
  }
}

export function buildProductionSemanticJobResult<R extends ProductionSemanticJobRole>(input: {
  payload: ProductionSemanticJobPayload<R>;
  selectedRouteId: string;
  output: ProductionAgentOutputByRole[R];
  attempts: readonly ProductionAgentAttemptTelemetry[];
  workerRuntimeVersion: string;
  completedAt: string;
}): ProductionSemanticJobResult<R> {
  const payload = validateProductionSemanticJobPayload(input.payload) as ProductionSemanticJobPayload<R>;
  const output = validateProductionAgentOutput(payload.role, input.output) as ProductionAgentOutputByRole[R];
  validateOutputAgainstPacket(
    payload.role,
    hydratePacketForValidation(payload.role, payload.packet),
    output
  );
  const attempts = input.attempts.map((attempt, index) => validateAttempt(attempt, index, payload));
  const selectedRouteId = safeId(input.selectedRouteId, "selectedRouteId");
  validateSelectedAttempt(attempts, selectedRouteId, "selectedRouteId");
  const unsigned = {
    schemaVersion: PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION,
    invocationKey: payload.invocationKey,
    role: payload.role,
    payloadSha256: payload.payloadSha256,
    packetSha256: payload.packetSha256,
    promptSha256: payload.promptSha256,
    routeManifestSha256: payload.routeManifestSha256,
    selectedRouteId,
    output,
    outputSha256: hashProductionSemanticValue(output),
    attempts,
    workerRuntimeVersion: text(input.workerRuntimeVersion, "workerRuntimeVersion", 160),
    completedAt: text(input.completedAt, "completedAt", 64)
  } as const;
  const result = {
    ...unsigned,
    resultSha256: hashProductionSemanticValue(unsigned)
  } satisfies ProductionSemanticJobResult<R>;
  assertSerializedSize(result, MAX_RESULT_BYTES, "result");
  return result;
}

export function validateProductionSemanticJobResult(
  value: unknown,
  expectedPayload?: ProductionSemanticJobPayload | null
): ProductionSemanticJobResult {
  const input = record(value, "result");
  if (input.schemaVersion !== PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION) {
    throw new ProductionSemanticJobContractError("result.schemaVersion", "is unsupported");
  }
  const payload = expectedPayload ? validateProductionSemanticJobPayload(expectedPayload) : null;
  const role = semanticRole(input.role, "result.role");
  if (payload && role !== payload.role) {
    throw new ProductionSemanticJobContractError("result.role", "does not match payload role");
  }
  const output = validateProductionAgentOutput(role, input.output);
  if (payload) {
    validateOutputAgainstPacket(
      role,
      hydratePacketForValidation(role, payload.packet),
      output
    );
  }
  const syntheticPayload = payload ?? ({
    role,
    promptSha256: sha256(input.promptSha256, "result.promptSha256")
  } as ProductionSemanticJobPayload);
  const maximumAttempts = payload ? 2 : 10;
  if (!Array.isArray(input.attempts) || input.attempts.length < 1 || input.attempts.length > maximumAttempts) {
    throw new ProductionSemanticJobContractError("result.attempts", `must contain 1 to ${maximumAttempts} attempts`);
  }
  const attempts = input.attempts.map((attempt, index) => validateAttempt(attempt, index, syntheticPayload));
  const selectedRouteId = safeId(input.selectedRouteId, "result.selectedRouteId");
  validateSelectedAttempt(attempts, selectedRouteId, "result.selectedRouteId");
  const unsigned = {
    schemaVersion: PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION,
    invocationKey: sha256(input.invocationKey, "result.invocationKey"),
    role,
    payloadSha256: sha256(input.payloadSha256, "result.payloadSha256"),
    packetSha256: sha256(input.packetSha256, "result.packetSha256"),
    promptSha256: sha256(input.promptSha256, "result.promptSha256"),
    routeManifestSha256: sha256(input.routeManifestSha256, "result.routeManifestSha256"),
    selectedRouteId,
    output,
    outputSha256: sha256(input.outputSha256, "result.outputSha256"),
    attempts,
    workerRuntimeVersion: text(input.workerRuntimeVersion, "result.workerRuntimeVersion", 160),
    completedAt: text(input.completedAt, "result.completedAt", 64)
  } as const;
  if (unsigned.outputSha256 !== hashProductionSemanticValue(output)) {
    throw new ProductionSemanticJobContractError("result.outputSha256", "does not match output content");
  }
  if (payload) {
    const bindings = [
      ["invocationKey", unsigned.invocationKey, payload.invocationKey],
      ["payloadSha256", unsigned.payloadSha256, payload.payloadSha256],
      ["packetSha256", unsigned.packetSha256, payload.packetSha256],
      ["promptSha256", unsigned.promptSha256, payload.promptSha256],
      ["routeManifestSha256", unsigned.routeManifestSha256, payload.routeManifestSha256]
    ] as const;
    for (const [field, actual, expected] of bindings) {
      if (actual !== expected) {
        throw new ProductionSemanticJobContractError(`result.${field}`, "does not match payload binding");
      }
    }
  }
  const resultSha256 = sha256(input.resultSha256, "result.resultSha256");
  if (resultSha256 !== hashProductionSemanticValue(unsigned)) {
    throw new ProductionSemanticJobContractError("result.resultSha256", "does not match result content");
  }
  const result = { ...unsigned, resultSha256 } satisfies ProductionSemanticJobResult;
  assertSerializedSize(result, MAX_RESULT_BYTES, "result");
  return result;
}

export function parseProductionSemanticJobResultJson(
  resultJson: string,
  expectedPayload?: ProductionSemanticJobPayload | null
): ProductionSemanticJobResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    throw new ProductionSemanticJobContractError("result", "must be valid JSON");
  }
  return validateProductionSemanticJobResult(parsed, expectedPayload);
}

export function hasReusableProductionSemanticResultJson(
  payloadJson: string,
  resultJson: string | null | undefined,
  nextPayloadJson?: string | null
): boolean {
  if (!resultJson) return false;
  try {
    const payload = parseProductionSemanticJobPayloadJson(payloadJson);
    if (nextPayloadJson) {
      const nextPayload = parseProductionSemanticJobPayloadJson(nextPayloadJson);
      if (nextPayload.payloadSha256 !== payload.payloadSha256) return false;
    }
    parseProductionSemanticJobResultJson(resultJson, payload);
    return true;
  } catch {
    return false;
  }
}

export function unavailableProductionSemanticExecutorReadiness(
  message = "No production-semantic executor is installed in this worker runtime."
): ProductionSemanticExecutorReadiness {
  return {
    ready: false,
    code: "executor_missing",
    message,
    jobSchemaVersion: PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION,
    resultSchemaVersion: PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION
  };
}

export function isProductionSemanticExecutorReadiness(
  value: unknown
): value is ProductionSemanticExecutorReadiness {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const readiness = value as Partial<ProductionSemanticExecutorReadiness>;
  return (
    typeof readiness.ready === "boolean" &&
    (readiness.code === "ready" ||
      readiness.code === "executor_missing" ||
      readiness.code === "preflight_failed") &&
    typeof readiness.message === "string" &&
    readiness.jobSchemaVersion === PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION &&
    readiness.resultSchemaVersion === PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION
  );
}
