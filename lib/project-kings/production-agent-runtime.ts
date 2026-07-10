import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runCodexExec,
  type CodexExecUsage,
  type RunCodexExecInput,
  type RunCodexExecResult
} from "../codex-runner";
import {
  PRODUCTION_AGENT_OUTPUT_SCHEMAS,
  PRODUCTION_SOURCE_POLICY_MINIMUM_BENCHMARK_SAMPLES,
  ProductionAgentContractError,
  buildProductionAgentPrompt,
  parseProductionAgentOutput,
  productionAgentArtifactRelativePath,
  validateProductionAgentPacket,
  type ProductionAgentArtifact,
  type CaptionOutput,
  type CaptionPacket,
  type MontagePlannerOutput,
  type MontagePlannerPacket,
  type ProductionAgentOutputByRole,
  type ProductionAgentPacketByRole,
  type ProductionAgentRole,
  type RevisionOutput,
  type RevisionPacket,
  type SourceFitOutput,
  type SourceFitPacket,
  type SourcePolicyOutput,
  type SourcePolicyPacket,
  type SourceSearchOutput,
  type SourceSearchPacket,
  type VisionQaOutput,
  type VisionQaPacket
} from "./production-agent-contracts";

export type ProductionAgentReasoningEffort = "low" | "medium" | "high" | "x-high";

export type ProductionAgentModelRoute = Readonly<{
  route: Readonly<{
    routeId: string;
    provider: string;
    model: string;
    capabilities: Readonly<{
      vision: boolean;
      jsonSchema: boolean;
      reasoningEfforts: readonly ProductionAgentReasoningEffort[];
      timeoutMs: number;
      fallbackRouteIds: readonly string[];
    }>;
  }>;
  benchmark: Readonly<{
    benchmarkVersion: string;
    routeId: string;
    reasoningEffort: ProductionAgentReasoningEffort;
    sampleSize: number;
    qualityScore: number;
    schemaSuccessRate: number;
    p95LatencyMs: number;
    meanCost: number;
    costUnit: "usd" | "codex_credits";
  }>;
}>;

export type ProductionAgentModelSelection = Readonly<{
  primary: ProductionAgentModelRoute;
  fallback: ProductionAgentModelRoute;
  policy: Readonly<{
    requiresVision: boolean;
    requiresJsonSchema: boolean;
    minimumReasoning: ProductionAgentReasoningEffort;
    minimumContextTokens: number;
    minimumSampleSize: number;
    minimumQualityScore: number;
    minimumSchemaSuccessRate: number;
    maximumP95LatencyMs: number;
  }>;
}>;

export type ProductionAgentInvocationInput = Readonly<{
  role: ProductionAgentRole;
  packet: ProductionAgentPacketByRole[ProductionAgentRole];
  prompt: string;
  outputSchema: Readonly<Record<string, unknown>>;
  route: Readonly<{
    routeId: string;
    provider: string;
    model: string;
    reasoningEffort: ProductionAgentReasoningEffort;
    timeoutMs: number;
    benchmarkVersion: string;
  }>;
}>;

export type ProductionAgentInvocationResult = Readonly<{
  rawOutput: string;
  usage: CodexExecUsage | null;
}>;

export type ProductionAgentInvoker = (
  input: ProductionAgentInvocationInput
) => Promise<ProductionAgentInvocationResult>;

export type ProductionAgentAttemptOutcome =
  | "passed"
  | "invoke_error"
  | "schema_error"
  | "telemetry_missing";

export type ProductionAgentAttemptTelemetry = Readonly<{
  schemaVersion: 1;
  attempt: number;
  role: ProductionAgentRole;
  routeId: string;
  provider: string;
  model: string;
  reasoningEffort: ProductionAgentReasoningEffort;
  benchmarkVersion: string;
  timeoutMs: number;
  startedAt: string;
  durationMs: number;
  promptSha256: string;
  outputSha256: string | null;
  usage: CodexExecUsage | null;
  outcome: ProductionAgentAttemptOutcome;
  error: string | null;
}>;

export type ProductionAgentRunResult<R extends ProductionAgentRole> = Readonly<{
  role: R;
  output: ProductionAgentOutputByRole[R];
  selectedRouteId: string;
  attempts: readonly ProductionAgentAttemptTelemetry[];
}>;

export class ProductionAgentRunError extends Error {
  readonly role: ProductionAgentRole;
  readonly attempts: readonly ProductionAgentAttemptTelemetry[];

  constructor(role: ProductionAgentRole, attempts: readonly ProductionAgentAttemptTelemetry[]) {
    const lastError = attempts.at(-1)?.error ?? "No attempt completed.";
    super(`Production agent ${role} failed closed after ${attempts.length} attempt(s): ${lastError}`);
    this.name = "ProductionAgentRunError";
    this.role = role;
    this.attempts = attempts;
  }
}

export class ProductionAgentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionAgentConfigurationError";
  }
}

export class ProductionAgentNonRetryableInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionAgentNonRetryableInvocationError";
  }
}

type RunCodex = (input: RunCodexExecInput) => Promise<RunCodexExecResult>;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error || "Unknown error")).trim();
  if (message.length <= 4_000) return message;

  // Codex emits harmless startup diagnostics before the actionable terminal
  // failure. Preserve both ends so durable telemetry does not hide the real
  // cause behind repeated skill/config warnings.
  return `${message.slice(0, 750)}\n... [diagnostics truncated] ...\n${message.slice(-3_000)}`;
}

function reasoningRank(value: ProductionAgentReasoningEffort): number {
  return ["low", "medium", "high", "x-high"].indexOf(value);
}

function assertFiniteRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ProductionAgentConfigurationError(`${label} is outside the benchmark policy range.`);
  }
}

function validateBenchmarkedRoute(
  selected: ProductionAgentModelRoute,
  selection: ProductionAgentModelSelection,
  role: ProductionAgentRole,
  label: "primary" | "fallback"
): void {
  const { route, benchmark } = selected;
  if (!route.routeId.trim() || !route.provider.trim() || !route.model.trim()) {
    throw new ProductionAgentConfigurationError(`${label} route identity is incomplete.`);
  }
  if (benchmark.routeId !== route.routeId || !benchmark.benchmarkVersion.trim()) {
    throw new ProductionAgentConfigurationError(`${label} route is not bound to a benchmark result.`);
  }
  if (!route.capabilities.jsonSchema || !selection.policy.requiresJsonSchema) {
    throw new ProductionAgentConfigurationError(`${label} route is not approved for strict JSON Schema.`);
  }
  if (
    (role === "vision_qa" || role === "source_policy") &&
    (!route.capabilities.vision || !selection.policy.requiresVision)
  ) {
    throw new ProductionAgentConfigurationError(
      `${label} route is not benchmarked for ${role === "vision_qa" ? "Vision QA" : "source policy vision"}.`
    );
  }
  if (!route.capabilities.reasoningEfforts.includes(benchmark.reasoningEffort)) {
    throw new ProductionAgentConfigurationError(`${label} reasoning effort is unsupported by the route.`);
  }
  if (reasoningRank(benchmark.reasoningEffort) < reasoningRank(selection.policy.minimumReasoning)) {
    throw new ProductionAgentConfigurationError(`${label} reasoning effort is below the benchmark policy.`);
  }
  if (!Number.isInteger(benchmark.sampleSize) || benchmark.sampleSize < selection.policy.minimumSampleSize) {
    throw new ProductionAgentConfigurationError(`${label} benchmark sample is below the policy floor.`);
  }
  assertFiniteRange(benchmark.qualityScore, selection.policy.minimumQualityScore, 1, `${label}.qualityScore`);
  assertFiniteRange(
    benchmark.schemaSuccessRate,
    selection.policy.minimumSchemaSuccessRate,
    1,
    `${label}.schemaSuccessRate`
  );
  assertFiniteRange(benchmark.p95LatencyMs, 1, selection.policy.maximumP95LatencyMs, `${label}.p95LatencyMs`);
  assertFiniteRange(benchmark.meanCost, 0, Number.MAX_SAFE_INTEGER, `${label}.meanCost`);
  if (benchmark.costUnit !== "usd" && benchmark.costUnit !== "codex_credits") {
    throw new ProductionAgentConfigurationError(`${label}.costUnit is invalid.`);
  }
  if (!Number.isInteger(route.capabilities.timeoutMs) || route.capabilities.timeoutMs < 1_000) {
    throw new ProductionAgentConfigurationError(`${label} timeout is invalid.`);
  }
}

export function validateProductionAgentModelSelection(
  selection: ProductionAgentModelSelection,
  role: ProductionAgentRole
): void {
  if (
    role === "source_policy" &&
    selection.policy.minimumSampleSize <
      PRODUCTION_SOURCE_POLICY_MINIMUM_BENCHMARK_SAMPLES
  ) {
    throw new ProductionAgentConfigurationError(
      `Source policy benchmark requires at least ${PRODUCTION_SOURCE_POLICY_MINIMUM_BENCHMARK_SAMPLES} real labeled samples.`
    );
  }
  validateBenchmarkedRoute(selection.primary, selection, role, "primary");
  validateBenchmarkedRoute(selection.fallback, selection, role, "fallback");
  if (selection.primary.route.routeId === selection.fallback.route.routeId) {
    throw new ProductionAgentConfigurationError("Primary and fallback routes must be distinct.");
  }
  if (!selection.primary.route.capabilities.fallbackRouteIds.includes(selection.fallback.route.routeId)) {
    throw new ProductionAgentConfigurationError("Fallback route is not the benchmarked fallback authorized by primary.");
  }
  if (selection.primary.benchmark.benchmarkVersion !== selection.fallback.benchmark.benchmarkVersion) {
    throw new ProductionAgentConfigurationError("Primary and fallback must come from the same benchmark snapshot.");
  }
  if (selection.primary.benchmark.costUnit !== selection.fallback.benchmark.costUnit) {
    throw new ProductionAgentConfigurationError("Primary and fallback benchmark costs use different units.");
  }
}

function invocationRoute(selected: ProductionAgentModelRoute): ProductionAgentInvocationInput["route"] {
  return {
    routeId: selected.route.routeId,
    provider: selected.route.provider,
    model: selected.route.model,
    reasoningEffort: selected.benchmark.reasoningEffort,
    timeoutMs: selected.route.capabilities.timeoutMs,
    benchmarkVersion: selected.benchmark.benchmarkVersion
  };
}

function telemetry(input: Omit<ProductionAgentAttemptTelemetry, "schemaVersion">): ProductionAgentAttemptTelemetry {
  return { schemaVersion: 1, ...input };
}

function hasCompleteUsage(value: CodexExecUsage | null): value is CodexExecUsage {
  return Boolean(
    value &&
      [value.inputTokens, value.cachedInputTokens, value.outputTokens, value.reasoningOutputTokens].every(
        (entry) => Number.isInteger(entry) && entry >= 0
      )
  );
}

export function validateOutputAgainstPacket(
  role: ProductionAgentRole,
  packet: ProductionAgentPacketByRole[ProductionAgentRole],
  output: ProductionAgentOutputByRole[ProductionAgentRole]
): void {
  const artifactIds = new Set(packet.artifacts.map((artifact) => artifact.id));
  switch (role) {
    case "source_search": {
      const sourcePacket = packet as SourceSearchPacket;
      const sourceOutput = output as SourceSearchOutput;
      if (sourceOutput.candidates.length > sourcePacket.task.targetCandidateCount) {
        throw new ProductionAgentContractError("output.candidates", "exceeds the requested candidate count");
      }
      for (const [index, candidate] of sourceOutput.candidates.entries()) {
        if (!sourcePacket.task.allowedStrategies.includes(candidate.strategy)) {
          throw new ProductionAgentContractError(`output.candidates[${index}].strategy`, "was not authorized by the packet");
        }
        if (sourcePacket.task.excludedStoryEventIds.includes(candidate.storyEventId)) {
          throw new ProductionAgentContractError(`output.candidates[${index}].storyEventId`, "is already excluded as used");
        }
        if (candidate.evidenceArtifactIds.some((artifactId) => !artifactIds.has(artifactId))) {
          throw new ProductionAgentContractError(`output.candidates[${index}].evidenceArtifactIds`, "references an unknown artifact");
        }
      }
      return;
    }
    case "source_fit": {
      const fitPacket = packet as SourceFitPacket;
      const fitOutput = output as SourceFitOutput;
      if (fitOutput.candidateId !== fitPacket.task.candidateId) {
        throw new ProductionAgentContractError("output.candidateId", "does not match the requested candidate");
      }
      for (const [index, claim] of fitOutput.factualClaims.entries()) {
        if (claim.evidenceArtifactIds.some((artifactId) => !artifactIds.has(artifactId))) {
          throw new ProductionAgentContractError(`output.factualClaims[${index}].evidenceArtifactIds`, "references an unknown artifact");
        }
        if (claim.verified && claim.evidenceArtifactIds.length === 0) {
          throw new ProductionAgentContractError(`output.factualClaims[${index}].evidenceArtifactIds`, "verified claims require evidence");
        }
      }
      return;
    }
    case "source_policy": {
      const policyPacket = packet as SourcePolicyPacket;
      const policyOutput = output as SourcePolicyOutput;
      if (policyOutput.candidateId !== policyPacket.task.candidateId) {
        throw new ProductionAgentContractError(
          "output.candidateId",
          "does not match the requested candidate"
        );
      }
      if (policyOutput.contentSha256 !== policyPacket.task.contentSha256) {
        throw new ProductionAgentContractError(
          "output.contentSha256",
          "does not match the exact source bytes"
        );
      }
      if (
        policyOutput.evidenceArtifactIds.some(
          (artifactId) => !artifactIds.has(artifactId)
        )
      ) {
        throw new ProductionAgentContractError(
          "output.evidenceArtifactIds",
          "references an unknown artifact"
        );
      }
      if (
        !policyOutput.evidenceArtifactIds.some((artifactId) =>
          policyPacket.task.orderedKeyFrameArtifactIds.includes(artifactId)
        ) ||
        !policyOutput.evidenceArtifactIds.includes(policyPacket.task.ocrArtifactId) ||
        !policyOutput.evidenceArtifactIds.includes(policyPacket.task.asrArtifactId)
      ) {
        throw new ProductionAgentContractError(
          "output.evidenceArtifactIds",
          "must cite visual, OCR and ASR evidence"
        );
      }
      return;
    }
    case "caption": {
      const captionPacket = packet as CaptionPacket;
      const captionOutput = output as CaptionOutput;
      if (captionOutput.caption.length > captionPacket.task.maxCharacters) {
        throw new ProductionAgentContractError("output.caption", "exceeds maxCharacters");
      }
      const normalizedCaption = captionOutput.caption.toLocaleLowerCase();
      const hiddenBannedWord = captionPacket.task.bannedWords.find((word) =>
        normalizedCaption.includes(word.toLocaleLowerCase())
      );
      if (hiddenBannedWord && !captionOutput.bannedWordsFound.includes(hiddenBannedWord)) {
        throw new ProductionAgentContractError("output.bannedWordsFound", "omits a banned word present in the caption");
      }
      return;
    }
    case "montage_planner": {
      const montagePacket = packet as MontagePlannerPacket;
      const montageOutput = output as MontagePlannerOutput;
      if (Math.abs(montageOutput.targetDurationSec - montagePacket.task.targetDurationSec) > 0.01) {
        throw new ProductionAgentContractError("output.targetDurationSec", "does not match the requested duration");
      }
      let previousEnd = 0;
      montageOutput.segments.forEach((segment, index) => {
        if (segment.endSec > montagePacket.task.sourceDurationSec || segment.startSec < previousEnd) {
          throw new ProductionAgentContractError(`output.segments[${index}]`, "is outside or overlaps the source timeline");
        }
        previousEnd = segment.endSec;
      });
      return;
    }
    case "vision_qa": {
      const visionPacket = packet as VisionQaPacket;
      const visionOutput = output as VisionQaOutput;
      if (
        visionOutput.decision === "PASS" &&
        (visionOutput.channelId !== visionPacket.channelId ||
          visionOutput.templateSha256 !== visionPacket.task.templateSha256)
      ) {
        throw new ProductionAgentContractError("output.decision", "cannot PASS a different channel or template");
      }
      return;
    }
    case "revision": {
      const revisionPacket = packet as RevisionPacket;
      const revisionOutput = output as RevisionOutput;
      const defectCodes = new Set(revisionPacket.task.defects.map((defect) => defect.code));
      for (const [index, change] of revisionOutput.changes.entries()) {
        if (!defectCodes.has(change.defectCode)) {
          throw new ProductionAgentContractError(`output.changes[${index}].defectCode`, "was not present in the QA verdict");
        }
        if (change.artifactId !== null && !artifactIds.has(change.artifactId)) {
          throw new ProductionAgentContractError(`output.changes[${index}].artifactId`, "references an unknown artifact");
        }
      }
      if (
        ["deterministic_repair", "targeted_regenerate", "targeted_visual_revision"].includes(
          revisionOutput.action
        ) &&
        revisionOutput.changes.length === 0
      ) {
        throw new ProductionAgentContractError("output.changes", "targeted repair requires at least one change");
      }
      return;
    }
  }
}

export async function runProductionSemanticAgent<R extends ProductionAgentRole>(input: {
  role: R;
  packet: ProductionAgentPacketByRole[R];
  selection: ProductionAgentModelSelection;
  invoker: ProductionAgentInvoker;
  maxAttempts?: 1 | 2;
  now?: () => Date;
  monotonicNowMs?: () => number;
}): Promise<ProductionAgentRunResult<R>> {
  const packet = validateProductionAgentPacket(input.role, input.packet);
  validateProductionAgentModelSelection(input.selection, input.role);
  const maxAttempts = input.maxAttempts ?? 2;
  if (maxAttempts !== 1 && maxAttempts !== 2) {
    throw new ProductionAgentConfigurationError("maxAttempts must be 1 or 2.");
  }
  const prompt = buildProductionAgentPrompt(input.role, packet);
  const promptSha256 = sha256(prompt);
  const outputSchema = PRODUCTION_AGENT_OUTPUT_SCHEMAS[input.role];
  const routes = [input.selection.primary, input.selection.fallback].slice(0, maxAttempts);
  const now = input.now ?? (() => new Date());
  const monotonicNowMs = input.monotonicNowMs ?? (() => performance.now());
  const attempts: ProductionAgentAttemptTelemetry[] = [];

  for (let index = 0; index < routes.length; index += 1) {
    const route = invocationRoute(routes[index]!);
    const startedAt = now().toISOString();
    const started = monotonicNowMs();
    let rawOutput: string | null = null;
    let usage: CodexExecUsage | null = null;
    try {
      const invoked = await input.invoker({
        role: input.role,
        packet,
        prompt,
        outputSchema,
        route
      });
      rawOutput = invoked.rawOutput;
      usage = invoked.usage;
      const output = parseProductionAgentOutput(input.role, rawOutput);
      validateOutputAgainstPacket(input.role, packet, output);
      if (!hasCompleteUsage(usage)) {
        attempts.push(
          telemetry({
            attempt: index + 1,
            role: input.role,
            ...route,
            startedAt,
            durationMs: Math.max(0, monotonicNowMs() - started),
            promptSha256,
            outputSha256: sha256(rawOutput),
            usage: null,
            outcome: "telemetry_missing",
            error: "Codex JSONL did not include complete non-negative turn.completed usage."
          })
        );
        continue;
      }
      attempts.push(
        telemetry({
          attempt: index + 1,
          role: input.role,
          ...route,
          startedAt,
          durationMs: Math.max(0, monotonicNowMs() - started),
          promptSha256,
          outputSha256: sha256(rawOutput),
          usage,
          outcome: "passed",
          error: null
        })
      );
      return {
        role: input.role,
        output,
        selectedRouteId: route.routeId,
        attempts
      };
    } catch (error) {
      const isSchemaError = rawOutput !== null;
      attempts.push(
        telemetry({
          attempt: index + 1,
          role: input.role,
          ...route,
          startedAt,
          durationMs: Math.max(0, monotonicNowMs() - started),
          promptSha256,
          outputSha256: rawOutput === null ? null : sha256(rawOutput),
          usage,
          outcome: isSchemaError ? "schema_error" : "invoke_error",
          error: normalizeError(error)
        })
      );
      if (error instanceof ProductionAgentNonRetryableInvocationError) {
        break;
      }
    }
  }

  throw new ProductionAgentRunError(input.role, attempts);
}

async function verifyAndCopyArtifact(
  artifact: ProductionAgentArtifact,
  index: number,
  tmpDir: string
): Promise<{ copiedPath: string; isImage: boolean }> {
  const stats = await fs.stat(artifact.path).catch(() => null);
  if (!stats?.isFile()) {
    throw new ProductionAgentNonRetryableInvocationError(`Artifact ${artifact.id} is not a readable file.`);
  }
  const bytes = await fs.readFile(artifact.path);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== artifact.sha256) {
    throw new ProductionAgentNonRetryableInvocationError(
      `Artifact ${artifact.id} hash mismatch: expected ${artifact.sha256}, got ${actualSha256}.`
    );
  }
  const relativePath = productionAgentArtifactRelativePath(artifact, index);
  const copiedPath = path.join(tmpDir, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(copiedPath), { recursive: true });
  await fs.copyFile(artifact.path, copiedPath);
  return { copiedPath, isImage: artifact.mediaType === "image" };
}

export function createCodexProductionAgentInvoker(options: {
  repoCwd: string;
  codexHome: string;
  tempRoot?: string;
  runCodex?: RunCodex;
  signal?: AbortSignal | null;
}): ProductionAgentInvoker {
  const execute = options.runCodex ?? runCodexExec;
  return async (input) => {
    if (options.signal?.aborted) {
      throw new ProductionAgentNonRetryableInvocationError(
        "Production semantic Codex invocation was canceled after the job lease ended."
      );
    }
    if (input.route.provider !== "codex") {
      throw new ProductionAgentNonRetryableInvocationError(
        `Codex adapter refuses provider ${input.route.provider}; no implicit provider fallback is allowed.`
      );
    }
    const tempRoot = options.tempRoot ?? os.tmpdir();
    await fs.mkdir(tempRoot, { recursive: true });
    const tmpDir = await fs.mkdtemp(path.join(tempRoot, "project-kings-agent-"));
    const schemaPath = path.join(tmpDir, "output.schema.json");
    const outputPath = path.join(tmpDir, "output.json");
    try {
      const copied = await Promise.all(
        input.packet.artifacts.map((artifact, index) => verifyAndCopyArtifact(artifact, index, tmpDir))
      );
      await fs.writeFile(schemaPath, JSON.stringify(input.outputSchema, null, 2), "utf-8");
      let result: RunCodexExecResult;
      try {
        result = await execute({
          prompt: input.prompt,
          imagePaths: copied.filter((artifact) => artifact.isImage).map((artifact) => artifact.copiedPath),
          outputSchemaPath: schemaPath,
          outputMessagePath: outputPath,
          cwd: options.repoCwd,
          executionCwd: tmpDir,
          codexHome: options.codexHome,
          timeoutMs: input.route.timeoutMs,
          model: input.route.model,
          reasoningEffort: input.route.reasoningEffort,
          jsonEvents: true,
          ignoreUserConfig: true,
          ignoreRules: true,
          signal: options.signal ?? null
        });
      } catch (error) {
        if (options.signal?.aborted) {
          throw new ProductionAgentNonRetryableInvocationError(
            "Production semantic Codex invocation was canceled after the job lease ended."
          );
        }
        throw error;
      }
      return {
        rawOutput: await fs.readFile(outputPath, "utf-8"),
        usage: result.usage
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}
