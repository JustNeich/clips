import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CodexExecUsage } from "../codex-runner";
import {
  buildProductionAgentPrompt,
  parseProductionAgentOutput,
  productionAgentArtifactRelativePath,
  validateProductionAgentPacket,
  PRODUCTION_SOURCE_POLICY_MINIMUM_BENCHMARK_SAMPLES,
  type ProductionAgentOutputByRole,
  type ProductionAgentPacketByRole,
  type ProductionAgentRole
} from "./production-agent-contracts";
import {
  validateOutputAgainstPacket,
  type ProductionAgentInvoker
} from "./production-agent-runtime";
import {
  ModelSelectionError,
  selectBenchmarkedModelRoutes,
  type ModelBenchmarkResult,
  type ModelCostUnit,
  type ModelReasoningEffort,
  type ModelRegistry,
  type ModelRouteDefinition,
  type ModelSelection,
  type ModelSelectionPolicy
} from "./model-routing";
import { PRODUCTION_AGENT_OUTPUT_SCHEMAS } from "./production-agent-contracts";

export const MODEL_BENCHMARK_EVIDENCE_VERSION = "project-kings-model-benchmark-evidence-v1" as const;
export const MODEL_BENCHMARK_MAX_CASES = 120;
export const MODEL_BENCHMARK_MAX_CANDIDATES = 12;
export const MODEL_BENCHMARK_MAX_EXECUTIONS = 240;
export const SOURCE_POLICY_PRODUCTION_MINIMUM_SAMPLE_SIZE =
  PRODUCTION_SOURCE_POLICY_MINIMUM_BENCHMARK_SAMPLES;

export type StageModelBenchmarkCase<R extends ProductionAgentRole> = Readonly<{
  caseId: string;
  packet: ProductionAgentPacketByRole[R];
  expectedQualityLabel: string;
}>;

export type StageModelBenchmarkDataset<R extends ProductionAgentRole> = Readonly<{
  datasetId: string;
  datasetVersion: string;
  role: R;
  cases: readonly StageModelBenchmarkCase<R>[];
}>;

export type StageModelBenchmarkCandidate = Readonly<{
  routeId: string;
  reasoningEffort: ModelReasoningEffort;
}>;

export type ModelBenchmarkPricingEvidence = Readonly<{
  routeId: string;
  costUnit: ModelCostUnit;
  inputPerMillionTokens: number;
  cachedInputPerMillionTokens: number;
  outputPerMillionTokens: number;
  source: string;
  verifiedAt: string;
  sourceSha256: string;
}>;

export type ModelBenchmarkQualityEvaluation = Readonly<{
  label: string;
  score: number;
  passed: boolean;
  evidence: readonly string[];
}>;

export type ModelBenchmarkQualityEvaluator = Readonly<{
  evaluatorId: string;
  evaluatorVersion: string;
  implementationSha256: string;
  config: unknown;
  evaluate: (input: {
    role: ProductionAgentRole;
    caseId: string;
    expectedQualityLabel: string;
    packet: ProductionAgentPacketByRole[ProductionAgentRole];
    output: ProductionAgentOutputByRole[ProductionAgentRole];
  }) => ModelBenchmarkQualityEvaluation | Promise<ModelBenchmarkQualityEvaluation>;
}>;

export type ModelBenchmarkSampleEvidence = Readonly<{
  caseId: string;
  expectedQualityLabel: string;
  promptSha256: string;
  startedAt: string;
  durationMs: number;
  schemaValid: boolean;
  quality: ModelBenchmarkQualityEvaluation | null;
  usage: CodexExecUsage | null;
  cost: number | null;
  costUnit: ModelCostUnit;
  outputSha256: string | null;
  error: string | null;
}>;

export type ModelBenchmarkCandidateEvidence = Readonly<{
  routeId: string;
  provider: string;
  model: string;
  reasoningEffort: ModelReasoningEffort;
  samples: readonly ModelBenchmarkSampleEvidence[];
  aggregate: Readonly<{
    sampleSize: number;
    schemaSuccessRate: number;
    qualityScore: number;
    qualityPassRate: number;
    p95LatencyMs: number;
    meanCost: number | null;
    costUnit: ModelCostUnit;
    completeUsageAndCostEvidence: boolean;
    selectorBenchmark: ModelBenchmarkResult | null;
  }>;
}>;

export type FrozenModelBenchmarkEvidence = Readonly<{
  schemaVersion: typeof MODEL_BENCHMARK_EVIDENCE_VERSION;
  benchmarkVersion: string;
  stageRole: ProductionAgentRole;
  createdAt: string;
  bounds: Readonly<{
    maxCases: number;
    maxCandidates: number;
    maxExecutions: number;
    actualExecutions: number;
  }>;
  dataset: Readonly<{
    datasetId: string;
    datasetVersion: string;
    datasetSha256: string;
    promptSetSha256: string;
    outputSchemaSha256: string;
    sampleSize: number;
  }>;
  qualityEvaluator: Readonly<{
    evaluatorId: string;
    evaluatorVersion: string;
    implementationSha256: string;
    configSha256: string;
  }>;
  executionContract: Readonly<{
    registrySha256: string;
    policySha256: string;
    schemaValidationMethod: "strict-production-agent-output-v1";
    qualityAggregationMethod: "mean-passed-evaluator-score-v1";
    p95Method: "nearest-rank-p95-v1";
    costMethod: "uncached-input-plus-cached-input-plus-total-output-v1";
    reasoningTokensDoubleCounted: false;
  }>;
  pricing: readonly ModelBenchmarkPricingEvidence[];
  candidates: readonly ModelBenchmarkCandidateEvidence[];
  selection: Readonly<{
    primary: Readonly<{
      routeId: string;
      model: string;
      reasoningEffort: ModelReasoningEffort;
    }>;
    fallback: Readonly<{
      routeId: string;
      model: string;
      reasoningEffort: ModelReasoningEffort;
    }>;
  }> | null;
  selectionError: string | null;
  selectionRejections: readonly Readonly<{ routeId: string; reason: string }>[];
  evidenceSha256: string;
}>;

export type StageModelBenchmarkRunResult = Readonly<{
  selection: ModelSelection;
  evidence: FrozenModelBenchmarkEvidence;
}>;

export class ModelBenchmarkHarnessError extends Error {
  readonly evidence: FrozenModelBenchmarkEvidence | null;

  constructor(message: string, evidence: FrozenModelBenchmarkEvidence | null = null) {
    super(message);
    this.name = "ModelBenchmarkHarnessError";
    this.evidence = evidence;
  }
}

type UnknownRecord = Record<string, unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as UnknownRecord)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new ModelBenchmarkHarnessError("Benchmark evidence must be JSON-serializable.");
  return serialized;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as UnknownRecord)) deepFreeze(child);
  return value;
}

function text(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) {
    throw new ModelBenchmarkHarnessError(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function finiteRate(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ModelBenchmarkHarnessError(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function round(value: number, digits = 12): number {
  return Number(value.toFixed(digits));
}

function normalizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "Unknown error")).trim().slice(0, 1_000);
}

function validUsage(usage: CodexExecUsage | null): usage is CodexExecUsage {
  return Boolean(
    usage &&
      [usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.reasoningOutputTokens].every(
        (entry) => Number.isInteger(entry) && entry >= 0
      ) &&
      usage.cachedInputTokens <= usage.inputTokens &&
      usage.reasoningOutputTokens <= usage.outputTokens
  );
}

export function calculateModelBenchmarkCost(
  usage: CodexExecUsage,
  pricing: ModelBenchmarkPricingEvidence
): number {
  if (!validUsage(usage)) throw new ModelBenchmarkHarnessError("Token usage is incomplete or internally inconsistent.");
  const uncachedInputTokens = usage.inputTokens - usage.cachedInputTokens;
  return round(
    (uncachedInputTokens * pricing.inputPerMillionTokens +
      usage.cachedInputTokens * pricing.cachedInputPerMillionTokens +
      usage.outputTokens * pricing.outputPerMillionTokens) /
      1_000_000
  );
}

export function calculateModelBenchmarkP95(durationsMs: readonly number[]): number {
  if (!durationsMs.length || durationsMs.some((duration) => !Number.isFinite(duration) || duration < 0)) {
    throw new ModelBenchmarkHarnessError("p95 requires at least one non-negative finite duration.");
  }
  const sorted = [...durationsMs].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

function validatePricing(
  pricing: readonly ModelBenchmarkPricingEvidence[],
  routes: ReadonlyMap<string, ModelRouteDefinition>
): Map<string, ModelBenchmarkPricingEvidence> {
  const result = new Map<string, ModelBenchmarkPricingEvidence>();
  for (const [index, entry] of pricing.entries()) {
    const at = `pricing[${index}]`;
    const routeId = text(entry.routeId, `${at}.routeId`, 160);
    if (!routes.has(routeId)) throw new ModelBenchmarkHarnessError(`${at}.routeId is not in the model registry.`);
    if (result.has(routeId)) throw new ModelBenchmarkHarnessError(`${at}.routeId is duplicated.`);
    if (entry.costUnit !== "usd" && entry.costUnit !== "codex_credits") {
      throw new ModelBenchmarkHarnessError(`${at}.costUnit is invalid.`);
    }
    finiteRate(entry.inputPerMillionTokens, `${at}.inputPerMillionTokens`);
    finiteRate(entry.cachedInputPerMillionTokens, `${at}.cachedInputPerMillionTokens`);
    finiteRate(entry.outputPerMillionTokens, `${at}.outputPerMillionTokens`);
    text(entry.source, `${at}.source`, 1_000);
    if (!Number.isFinite(Date.parse(entry.verifiedAt))) {
      throw new ModelBenchmarkHarnessError(`${at}.verifiedAt must be an ISO date.`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sourceSha256)) {
      throw new ModelBenchmarkHarnessError(`${at}.sourceSha256 must be SHA-256 hex.`);
    }
    result.set(routeId, deepFreeze(structuredClone(entry)));
  }
  return result;
}

function normalizePacketForDatasetHash<R extends ProductionAgentRole>(
  role: R,
  packet: ProductionAgentPacketByRole[R]
): unknown {
  const validated = validateProductionAgentPacket(role, packet);
  return {
    ...validated,
    artifacts: validated.artifacts.map((artifact, index) => ({
      ...artifact,
      path: productionAgentArtifactRelativePath(artifact, index)
    }))
  };
}

function validateQualityEvaluation(value: ModelBenchmarkQualityEvaluation): ModelBenchmarkQualityEvaluation {
  const label = text(value.label, "quality.label", 160);
  if (typeof value.passed !== "boolean") throw new ModelBenchmarkHarnessError("quality.passed must be boolean.");
  if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 1) {
    throw new ModelBenchmarkHarnessError("quality.score must be between 0 and 1.");
  }
  if (!Array.isArray(value.evidence) || value.evidence.length > 24) {
    throw new ModelBenchmarkHarnessError("quality.evidence must contain at most 24 entries.");
  }
  const evidence = value.evidence.map((entry, index) => text(entry, `quality.evidence[${index}]`, 1_000));
  return { label, score: value.score, passed: value.passed, evidence };
}

function extractOutputLabel(output: ProductionAgentOutputByRole[ProductionAgentRole]): string {
  const record = output as unknown as UnknownRecord;
  if (typeof record.decision === "string") return record.decision;
  if (typeof record.action === "string") return record.action;
  if (record.signals && typeof record.signals === "object" && !Array.isArray(record.signals)) {
    const values = Object.values(record.signals as UnknownRecord);
    if (values.some((value) => value === "present")) return "present";
    if (values.some((value) => value === "unknown")) return "unknown";
    if (values.length === 4 && values.every((value) => value === "absent")) return "absent";
  }
  throw new ModelBenchmarkHarnessError("Output does not expose a benchmark quality label.");
}

function evaluateDecisionLabel(input: {
  expectedQualityLabel: string;
  output: ProductionAgentOutputByRole[ProductionAgentRole];
}): ModelBenchmarkQualityEvaluation {
  const actual = extractOutputLabel(input.output);
  const passed = actual === input.expectedQualityLabel;
  return {
    label: actual,
    score: passed ? 1 : 0,
    passed,
    evidence: [`expected=${input.expectedQualityLabel}`, `actual=${actual}`]
  };
}

export function createDecisionLabelQualityEvaluator(input: {
  evaluatorId?: string;
  evaluatorVersion: string;
}): ModelBenchmarkQualityEvaluator {
  return {
    evaluatorId: input.evaluatorId ?? "production-output-label",
    evaluatorVersion: input.evaluatorVersion,
    implementationSha256: sha256(
      `${extractOutputLabel.toString()}\n${evaluateDecisionLabel.toString()}`
    ),
    config: { comparison: "exact-output-decision-or-action" },
    evaluate: ({ expectedQualityLabel, output }) =>
      evaluateDecisionLabel({ expectedQualityLabel, output })
  };
}

function evidenceHashPayload(evidence: Omit<FrozenModelBenchmarkEvidence, "evidenceSha256">): unknown {
  return evidence;
}

function buildFrozenEvidence(
  value: Omit<FrozenModelBenchmarkEvidence, "evidenceSha256">
): FrozenModelBenchmarkEvidence {
  const evidence = {
    ...value,
    evidenceSha256: sha256(evidenceHashPayload(value))
  };
  return deepFreeze(evidence);
}

export async function writeFrozenModelBenchmarkEvidence(
  outputPath: string,
  evidence: FrozenModelBenchmarkEvidence
): Promise<void> {
  const { evidenceSha256: _evidenceSha256, ...withoutHash } = evidence;
  if (sha256(evidenceHashPayload(withoutHash)) !== evidence.evidenceSha256) {
    throw new ModelBenchmarkHarnessError("Benchmark evidence hash does not match its payload.");
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf-8",
    flag: "wx"
  });
}

function validateCandidates(
  candidates: readonly StageModelBenchmarkCandidate[],
  routes: ReadonlyMap<string, ModelRouteDefinition>
): Array<{ candidate: StageModelBenchmarkCandidate; route: ModelRouteDefinition }> {
  if (!candidates.length || candidates.length > MODEL_BENCHMARK_MAX_CANDIDATES) {
    throw new ModelBenchmarkHarnessError(`Benchmark must contain 1-${MODEL_BENCHMARK_MAX_CANDIDATES} candidates.`);
  }
  const seen = new Set<string>();
  return candidates.map((candidate, index) => {
    const route = routes.get(candidate.routeId);
    if (!route) throw new ModelBenchmarkHarnessError(`candidates[${index}].routeId is not in the registry.`);
    if (!route.capabilities.reasoningEfforts.includes(candidate.reasoningEffort)) {
      throw new ModelBenchmarkHarnessError(`candidates[${index}].reasoningEffort is unsupported.`);
    }
    const key = `${candidate.routeId}:${candidate.reasoningEffort}`;
    if (seen.has(key)) throw new ModelBenchmarkHarnessError(`Duplicate benchmark candidate ${key}.`);
    seen.add(key);
    return { candidate: deepFreeze(structuredClone(candidate)), route };
  });
}

function buildSelectionEvidence(selection: ModelSelection): NonNullable<FrozenModelBenchmarkEvidence["selection"]> {
  return {
    primary: {
      routeId: selection.primary.route.routeId,
      model: selection.primary.route.model,
      reasoningEffort: selection.primary.benchmark.reasoningEffort
    },
    fallback: {
      routeId: selection.fallback.route.routeId,
      model: selection.fallback.route.model,
      reasoningEffort: selection.fallback.benchmark.reasoningEffort
    }
  };
}

export async function runStageSpecificModelBenchmark<R extends ProductionAgentRole>(input: {
  benchmarkVersion: string;
  registry: ModelRegistry;
  policy: ModelSelectionPolicy;
  dataset: StageModelBenchmarkDataset<R>;
  candidates: readonly StageModelBenchmarkCandidate[];
  pricing: readonly ModelBenchmarkPricingEvidence[];
  qualityEvaluator: ModelBenchmarkQualityEvaluator;
  invoker: ProductionAgentInvoker;
  outputPath?: string;
  now?: () => Date;
  monotonicNowMs?: () => number;
}): Promise<StageModelBenchmarkRunResult> {
  const benchmarkVersion = text(input.benchmarkVersion, "benchmarkVersion", 160);
  const datasetId = text(input.dataset.datasetId, "dataset.datasetId", 160);
  const datasetVersion = text(input.dataset.datasetVersion, "dataset.datasetVersion", 160);
  if (!input.policy.requiresJsonSchema) {
    throw new ModelBenchmarkHarnessError("Stage benchmark policy must require JSON Schema.");
  }
  if (
    (input.dataset.role === "vision_qa" || input.dataset.role === "source_policy") &&
    !input.policy.requiresVision
  ) {
    throw new ModelBenchmarkHarnessError(
      `${input.dataset.role === "vision_qa" ? "Vision QA" : "Source policy"} benchmark policy must require vision capability.`
    );
  }
  if (
    input.dataset.role === "source_policy" &&
    input.policy.minimumSampleSize < SOURCE_POLICY_PRODUCTION_MINIMUM_SAMPLE_SIZE
  ) {
    throw new ModelBenchmarkHarnessError(
      `Source policy production benchmark minimumSampleSize must be at least ${SOURCE_POLICY_PRODUCTION_MINIMUM_SAMPLE_SIZE}.`
    );
  }
  if (
    input.dataset.role === "source_policy" &&
    input.dataset.cases.length < SOURCE_POLICY_PRODUCTION_MINIMUM_SAMPLE_SIZE
  ) {
    throw new ModelBenchmarkHarnessError(
      `Source policy production dataset requires at least ${SOURCE_POLICY_PRODUCTION_MINIMUM_SAMPLE_SIZE} real labeled cases.`
    );
  }
  if (!input.dataset.cases.length || input.dataset.cases.length > MODEL_BENCHMARK_MAX_CASES) {
    throw new ModelBenchmarkHarnessError(`Dataset must contain 1-${MODEL_BENCHMARK_MAX_CASES} cases.`);
  }
  const caseIds = input.dataset.cases.map((entry, index) => text(entry.caseId, `dataset.cases[${index}].caseId`, 160));
  if (new Set(caseIds).size !== caseIds.length) throw new ModelBenchmarkHarnessError("Dataset case IDs must be unique.");

  const routes = new Map(input.registry.routes.map((route) => [route.routeId, route]));
  const candidates = validateCandidates(input.candidates, routes);
  const actualExecutions = candidates.length * input.dataset.cases.length;
  if (actualExecutions > MODEL_BENCHMARK_MAX_EXECUTIONS) {
    throw new ModelBenchmarkHarnessError(`Benchmark exceeds the ${MODEL_BENCHMARK_MAX_EXECUTIONS}-execution bound.`);
  }
  const pricing = validatePricing(input.pricing, routes);
  for (const { candidate } of candidates) {
    if (!pricing.has(candidate.routeId)) {
      throw new ModelBenchmarkHarnessError(`Pricing evidence is missing for ${candidate.routeId}.`);
    }
  }
  const evaluatorId = text(input.qualityEvaluator.evaluatorId, "qualityEvaluator.evaluatorId", 160);
  const evaluatorVersion = text(input.qualityEvaluator.evaluatorVersion, "qualityEvaluator.evaluatorVersion", 160);
  if (!/^[a-f0-9]{64}$/.test(input.qualityEvaluator.implementationSha256)) {
    throw new ModelBenchmarkHarnessError("qualityEvaluator.implementationSha256 must be SHA-256 hex.");
  }
  const configSha256 = sha256(input.qualityEvaluator.config);
  const validatedCases = input.dataset.cases.map((entry, index) => {
    const packet = deepFreeze(validateProductionAgentPacket(input.dataset.role, entry.packet));
    return {
      caseId: caseIds[index]!,
      expectedQualityLabel: text(entry.expectedQualityLabel, `dataset.cases[${index}].expectedQualityLabel`, 160),
      packet,
      normalizedPacket: normalizePacketForDatasetHash(input.dataset.role, packet),
      prompt: buildProductionAgentPrompt(input.dataset.role, packet)
    };
  });
  const outputSchema = PRODUCTION_AGENT_OUTPUT_SCHEMAS[input.dataset.role];
  const datasetSha256 = sha256({
    datasetId,
    datasetVersion,
    role: input.dataset.role,
    cases: validatedCases.map((entry) => ({
      caseId: entry.caseId,
      expectedQualityLabel: entry.expectedQualityLabel,
      packet: entry.normalizedPacket
    }))
  });
  const promptSetSha256 = sha256(
    validatedCases.map((entry) => ({ caseId: entry.caseId, promptSha256: sha256(entry.prompt) }))
  );
  const outputSchemaSha256 = sha256(outputSchema);
  const now = input.now ?? (() => new Date());
  const monotonicNowMs = input.monotonicNowMs ?? (() => performance.now());
  const candidateEvidence: ModelBenchmarkCandidateEvidence[] = [];
  const selectorBenchmarks: ModelBenchmarkResult[] = [];

  for (const { candidate, route } of candidates) {
    const routePricing = pricing.get(candidate.routeId)!;
    const samples: ModelBenchmarkSampleEvidence[] = [];
    for (const benchmarkCase of validatedCases) {
      const startedAt = now().toISOString();
      const started = monotonicNowMs();
      let rawOutput: string | null = null;
      let usage: CodexExecUsage | null = null;
      let schemaValid = false;
      let quality: ModelBenchmarkQualityEvaluation | null = null;
      let error: string | null = null;
      try {
        const invoked = await input.invoker({
          role: input.dataset.role,
          packet: benchmarkCase.packet,
          prompt: benchmarkCase.prompt,
          outputSchema,
          route: {
            routeId: route.routeId,
            provider: route.provider,
            model: route.model,
            reasoningEffort: candidate.reasoningEffort,
            timeoutMs: route.capabilities.timeoutMs,
            benchmarkVersion
          }
        });
        rawOutput = invoked.rawOutput;
        usage = validUsage(invoked.usage) ? invoked.usage : null;
        const output = deepFreeze(parseProductionAgentOutput(input.dataset.role, rawOutput));
        validateOutputAgainstPacket(
          input.dataset.role,
          benchmarkCase.packet,
          output
        );
        schemaValid = true;
        quality = validateQualityEvaluation(
          await input.qualityEvaluator.evaluate({
            role: input.dataset.role,
            caseId: benchmarkCase.caseId,
            expectedQualityLabel: benchmarkCase.expectedQualityLabel,
            packet: benchmarkCase.packet,
            output
          })
        );
      } catch (caught) {
        error = normalizeError(caught);
      }
      const durationMs = round(Math.max(0, monotonicNowMs() - started), 6);
      const cost = usage ? calculateModelBenchmarkCost(usage, routePricing) : null;
      samples.push({
        caseId: benchmarkCase.caseId,
        expectedQualityLabel: benchmarkCase.expectedQualityLabel,
        promptSha256: sha256(benchmarkCase.prompt),
        startedAt,
        durationMs,
        schemaValid,
        quality,
        usage,
        cost,
        costUnit: routePricing.costUnit,
        outputSha256: rawOutput === null ? null : sha256(rawOutput),
        error
      });
    }

    const sampleSize = samples.length;
    const schemaSuccessRate = round(samples.filter((sample) => sample.schemaValid).length / sampleSize);
    const qualityScore = round(
      samples.reduce(
        (sum, sample) => sum + (sample.quality?.passed ? sample.quality.score : 0),
        0
      ) / sampleSize
    );
    const qualityPassRate = round(samples.filter((sample) => sample.quality?.passed).length / sampleSize);
    const p95LatencyMs = calculateModelBenchmarkP95(samples.map((sample) => sample.durationMs));
    const completeUsageAndCostEvidence = samples.every((sample) => sample.usage !== null && sample.cost !== null);
    const meanCost = completeUsageAndCostEvidence
      ? round(samples.reduce((sum, sample) => sum + (sample.cost ?? 0), 0) / sampleSize)
      : null;
    const selectorBenchmark: ModelBenchmarkResult | null =
      meanCost === null
        ? null
        : {
            benchmarkVersion,
            routeId: route.routeId,
            reasoningEffort: candidate.reasoningEffort,
            sampleSize,
            qualityScore,
            schemaSuccessRate,
            p95LatencyMs,
            meanCost,
            costUnit: routePricing.costUnit
          };
    if (selectorBenchmark) selectorBenchmarks.push(selectorBenchmark);
    candidateEvidence.push({
      routeId: route.routeId,
      provider: route.provider,
      model: route.model,
      reasoningEffort: candidate.reasoningEffort,
      samples,
      aggregate: {
        sampleSize,
        schemaSuccessRate,
        qualityScore,
        qualityPassRate,
        p95LatencyMs,
        meanCost,
        costUnit: routePricing.costUnit,
        completeUsageAndCostEvidence,
        selectorBenchmark
      }
    });
  }

  let selection: ModelSelection | null = null;
  let selectionError: string | null = null;
  let selectionRejections: Array<{ routeId: string; reason: string }> = [];
  try {
    selection = selectBenchmarkedModelRoutes({
      registry: input.registry,
      benchmarks: selectorBenchmarks,
      policy: input.policy
    });
  } catch (error) {
    selectionError = normalizeError(error);
    if (error instanceof ModelSelectionError) {
      selectionRejections = error.rejections.map((rejection) => ({ ...rejection }));
    }
  }
  const createdAt = now().toISOString();
  const evidence = buildFrozenEvidence({
    schemaVersion: MODEL_BENCHMARK_EVIDENCE_VERSION,
    benchmarkVersion,
    stageRole: input.dataset.role,
    createdAt,
    bounds: {
      maxCases: MODEL_BENCHMARK_MAX_CASES,
      maxCandidates: MODEL_BENCHMARK_MAX_CANDIDATES,
      maxExecutions: MODEL_BENCHMARK_MAX_EXECUTIONS,
      actualExecutions
    },
    dataset: {
      datasetId,
      datasetVersion,
      datasetSha256,
      promptSetSha256,
      outputSchemaSha256,
      sampleSize: validatedCases.length
    },
    qualityEvaluator: {
      evaluatorId,
      evaluatorVersion,
      implementationSha256: input.qualityEvaluator.implementationSha256,
      configSha256
    },
    executionContract: {
      registrySha256: sha256(input.registry),
      policySha256: sha256(input.policy),
      schemaValidationMethod: "strict-production-agent-output-v1",
      qualityAggregationMethod: "mean-passed-evaluator-score-v1",
      p95Method: "nearest-rank-p95-v1",
      costMethod: "uncached-input-plus-cached-input-plus-total-output-v1",
      reasoningTokensDoubleCounted: false
    },
    pricing: [...pricing.values()],
    candidates: candidateEvidence,
    selection: selection ? buildSelectionEvidence(selection) : null,
    selectionError,
    selectionRejections
  });
  if (input.outputPath) await writeFrozenModelBenchmarkEvidence(input.outputPath, evidence);
  if (!selection) {
    throw new ModelBenchmarkHarnessError(selectionError ?? "No benchmark selection was produced.", evidence);
  }
  return deepFreeze({ selection, evidence });
}
