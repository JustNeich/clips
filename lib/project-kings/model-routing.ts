export const MODEL_REASONING_EFFORTS = ["low", "medium", "high", "x-high"] as const;

export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number];

export type ModelCostUnit = "usd" | "codex_credits";

export type ModelRouteDefinition = Readonly<{
  routeId: string;
  provider: string;
  model: string;
  capabilities: Readonly<{
    vision: boolean;
    jsonSchema: boolean;
    reasoningEfforts: readonly ModelReasoningEffort[];
    contextWindowTokens: number | null;
    cost: Readonly<{
      source: "verified-price" | "benchmark-required";
      costUnit: ModelCostUnit | null;
      inputPerMillionTokens: number | null;
      cachedInputPerMillionTokens: number | null;
      outputPerMillionTokens: number | null;
    }>;
    timeoutMs: number;
    fallbackRouteIds: readonly string[];
  }>;
  evidence: readonly string[];
}>;

export type ModelRegistry = Readonly<{
  routes: readonly ModelRouteDefinition[];
}>;

export type ModelBenchmarkResult = Readonly<{
  benchmarkVersion: string;
  routeId: string;
  reasoningEffort: ModelReasoningEffort;
  sampleSize: number;
  qualityScore: number;
  schemaSuccessRate: number;
  p95LatencyMs: number;
  meanCost: number;
  costUnit: ModelCostUnit;
}>;

export type ModelSelectionPolicy = Readonly<{
  requiresVision: boolean;
  requiresJsonSchema: boolean;
  minimumReasoning: ModelReasoningEffort;
  minimumContextTokens: number;
  minimumSampleSize: number;
  minimumQualityScore: number;
  minimumSchemaSuccessRate: number;
  maximumP95LatencyMs: number;
}>;

export type SelectedModelRoute = Readonly<{
  route: ModelRouteDefinition;
  benchmark: ModelBenchmarkResult;
}>;

export type ModelSelectionFallbackMode = "distinct_route" | "same_route_reasoning";

export type ModelSelection = Readonly<{
  primary: SelectedModelRoute;
  fallback: SelectedModelRoute;
  fallbackMode: ModelSelectionFallbackMode;
  policy: ModelSelectionPolicy;
}>;

export type ModelSelectionRejection = Readonly<{
  routeId: string;
  reason: string;
}>;

export class ModelRegistryValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Model registry is invalid: ${issues.join("; ")}`);
    this.name = "ModelRegistryValidationError";
    this.issues = issues;
  }
}

export class ModelSelectionError extends Error {
  readonly rejections: readonly ModelSelectionRejection[];

  constructor(message: string, rejections: readonly ModelSelectionRejection[]) {
    super(message);
    this.name = "ModelSelectionError";
    this.rejections = rejections;
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isReasoningEffort(value: unknown): value is ModelReasoningEffort {
  return MODEL_REASONING_EFFORTS.includes(value as ModelReasoningEffort);
}

function reasoningRank(value: ModelReasoningEffort): number {
  return MODEL_REASONING_EFFORTS.indexOf(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as UnknownRecord)) {
    deepFreeze(child);
  }
  return value;
}

function validateNullableCost(value: unknown, path: string, issues: string[]): void {
  if (value === null) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issues.push(`${path} must be null or a non-negative finite number`);
  }
}

export function defineModelRegistry(value: readonly ModelRouteDefinition[]): ModelRegistry {
  const issues: string[] = [];
  if (!Array.isArray(value) || value.length < 2) {
    throw new ModelRegistryValidationError(["at least two model routes are required"]);
  }

  const routeIds: string[] = [];
  value.forEach((route, index) => {
    const path = `routes[${index}]`;
    if (!isRecord(route)) {
      issues.push(`${path} must be an object`);
      return;
    }
    for (const field of ["routeId", "provider", "model"] as const) {
      if (typeof route[field] !== "string" || !(route[field] as string).trim()) {
        issues.push(`${path}.${field} must be a non-empty string`);
      }
    }
    if (typeof route.routeId === "string") {
      routeIds.push(route.routeId);
    }
    if (!Array.isArray(route.evidence) || route.evidence.length < 1) {
      issues.push(`${path}.evidence must contain at least one repository fact`);
    } else if (route.evidence.some((entry) => typeof entry !== "string" || !entry.trim())) {
      issues.push(`${path}.evidence must contain only non-empty strings`);
    }

    if (!isRecord(route.capabilities)) {
      issues.push(`${path}.capabilities must be an object`);
      return;
    }
    const capabilities = route.capabilities;
    if (typeof capabilities.vision !== "boolean") {
      issues.push(`${path}.capabilities.vision must be boolean`);
    }
    if (typeof capabilities.jsonSchema !== "boolean") {
      issues.push(`${path}.capabilities.jsonSchema must be boolean`);
    }
    if (
      !Array.isArray(capabilities.reasoningEfforts) ||
      capabilities.reasoningEfforts.length < 1 ||
      capabilities.reasoningEfforts.some((effort) => !isReasoningEffort(effort))
    ) {
      issues.push(`${path}.capabilities.reasoningEfforts must contain supported reasoning values`);
    } else if (new Set(capabilities.reasoningEfforts).size !== capabilities.reasoningEfforts.length) {
      issues.push(`${path}.capabilities.reasoningEfforts must be unique`);
    }
    const contextWindowTokens = capabilities.contextWindowTokens;
    if (
      contextWindowTokens !== null &&
      (typeof contextWindowTokens !== "number" ||
        !Number.isInteger(contextWindowTokens) ||
        contextWindowTokens < 1)
    ) {
      issues.push(`${path}.capabilities.contextWindowTokens must be null or a positive integer`);
    }
    const timeoutMs = capabilities.timeoutMs;
    if (
      typeof timeoutMs !== "number" ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1_000 ||
      timeoutMs > 60 * 60_000
    ) {
      issues.push(`${path}.capabilities.timeoutMs must be between 1 second and 1 hour`);
    }
    if (!Array.isArray(capabilities.fallbackRouteIds) || capabilities.fallbackRouteIds.length < 1) {
      issues.push(`${path}.capabilities.fallbackRouteIds must contain at least one route`);
    } else if (
      capabilities.fallbackRouteIds.some((entry) => typeof entry !== "string" || !entry.trim())
    ) {
      issues.push(`${path}.capabilities.fallbackRouteIds must contain only non-empty strings`);
    }

    if (!isRecord(capabilities.cost)) {
      issues.push(`${path}.capabilities.cost must be an object`);
    } else {
      if (
        capabilities.cost.source !== "verified-price" &&
        capabilities.cost.source !== "benchmark-required"
      ) {
        issues.push(`${path}.capabilities.cost.source is invalid`);
      }
      validateNullableCost(
        capabilities.cost.inputPerMillionTokens,
        `${path}.capabilities.cost.inputPerMillionTokens`,
        issues
      );
      validateNullableCost(
        capabilities.cost.cachedInputPerMillionTokens,
        `${path}.capabilities.cost.cachedInputPerMillionTokens`,
        issues
      );
      validateNullableCost(
        capabilities.cost.outputPerMillionTokens,
        `${path}.capabilities.cost.outputPerMillionTokens`,
        issues
      );
      if (
        capabilities.cost.costUnit !== null &&
        capabilities.cost.costUnit !== "usd" &&
        capabilities.cost.costUnit !== "codex_credits"
      ) {
        issues.push(`${path}.capabilities.cost.costUnit is invalid`);
      }
      if (
        capabilities.cost.source === "verified-price" &&
        (capabilities.cost.costUnit === null ||
          capabilities.cost.inputPerMillionTokens === null ||
          capabilities.cost.cachedInputPerMillionTokens === null ||
          capabilities.cost.outputPerMillionTokens === null)
      ) {
        issues.push(`${path}.capabilities.cost verified-price requires a unit and all token prices`);
      }
    }
  });

  if (new Set(routeIds).size !== routeIds.length) {
    issues.push("routeId values must be unique");
  }
  const routeIdSet = new Set(routeIds);
  value.forEach((route, index) => {
    if (!isRecord(route) || !isRecord(route.capabilities)) {
      return;
    }
    const fallbackRouteIds = route.capabilities.fallbackRouteIds;
    if (!Array.isArray(fallbackRouteIds)) {
      return;
    }
    fallbackRouteIds.forEach((fallbackRouteId) => {
      if (fallbackRouteId === route.routeId) {
        issues.push(`routes[${index}] cannot fall back to itself`);
      } else if (typeof fallbackRouteId === "string" && !routeIdSet.has(fallbackRouteId)) {
        issues.push(`routes[${index}] references unknown fallback ${fallbackRouteId}`);
      }
    });
  });

  if (issues.length > 0) {
    throw new ModelRegistryValidationError(issues);
  }
  return deepFreeze({ routes: structuredClone(value) });
}

function validateSelectionPolicy(policy: ModelSelectionPolicy): void {
  const issues: string[] = [];
  if (!isReasoningEffort(policy.minimumReasoning)) {
    issues.push("minimumReasoning is invalid");
  }
  if (!Number.isInteger(policy.minimumContextTokens) || policy.minimumContextTokens < 0) {
    issues.push("minimumContextTokens must be a non-negative integer");
  }
  if (!Number.isInteger(policy.minimumSampleSize) || policy.minimumSampleSize < 1) {
    issues.push("minimumSampleSize must be a positive integer");
  }
  if (
    !Number.isFinite(policy.minimumQualityScore) ||
    policy.minimumQualityScore < 0 ||
    policy.minimumQualityScore > 1
  ) {
    issues.push("minimumQualityScore must be between 0 and 1");
  }
  if (
    !Number.isFinite(policy.minimumSchemaSuccessRate) ||
    policy.minimumSchemaSuccessRate < 0 ||
    policy.minimumSchemaSuccessRate > 1
  ) {
    issues.push("minimumSchemaSuccessRate must be between 0 and 1");
  }
  if (!Number.isFinite(policy.maximumP95LatencyMs) || policy.maximumP95LatencyMs < 1) {
    issues.push("maximumP95LatencyMs must be positive");
  }
  if (issues.length > 0) {
    throw new ModelSelectionError(`Model selection policy is invalid: ${issues.join("; ")}`, []);
  }
}

function validateBenchmark(benchmark: ModelBenchmarkResult): string | null {
  if (!benchmark.benchmarkVersion.trim()) {
    return "benchmarkVersion is missing";
  }
  if (!isReasoningEffort(benchmark.reasoningEffort)) {
    return "reasoningEffort is invalid";
  }
  if (!Number.isInteger(benchmark.sampleSize) || benchmark.sampleSize < 1) {
    return "sampleSize is invalid";
  }
  if (
    !Number.isFinite(benchmark.qualityScore) ||
    benchmark.qualityScore < 0 ||
    benchmark.qualityScore > 1
  ) {
    return "qualityScore is invalid";
  }
  if (
    !Number.isFinite(benchmark.schemaSuccessRate) ||
    benchmark.schemaSuccessRate < 0 ||
    benchmark.schemaSuccessRate > 1
  ) {
    return "schemaSuccessRate is invalid";
  }
  if (!Number.isFinite(benchmark.p95LatencyMs) || benchmark.p95LatencyMs < 1) {
    return "p95LatencyMs is invalid";
  }
  if (!Number.isFinite(benchmark.meanCost) || benchmark.meanCost < 0) {
    return "meanCost is invalid";
  }
  if (benchmark.costUnit !== "usd" && benchmark.costUnit !== "codex_credits") {
    return "costUnit is invalid";
  }
  return null;
}

function chooseByCostThenSpeed(candidates: readonly SelectedModelRoute[]): SelectedModelRoute {
  const costUnits = new Set(candidates.map((candidate) => candidate.benchmark.costUnit));
  if (costUnits.size !== 1) {
    throw new ModelSelectionError("Benchmark candidates use incomparable cost units.", []);
  }
  const cheapestCost = Math.min(...candidates.map((candidate) => candidate.benchmark.meanCost));
  const costTieCeiling = cheapestCost === 0 ? 0 : cheapestCost * 1.1;
  const costTie = candidates.filter((candidate) =>
    cheapestCost === 0
      ? candidate.benchmark.meanCost === 0
      : candidate.benchmark.meanCost < costTieCeiling
  );
  return [...costTie].sort((left, right) => {
    return (
      left.benchmark.p95LatencyMs - right.benchmark.p95LatencyMs ||
      left.benchmark.meanCost - right.benchmark.meanCost ||
      right.benchmark.qualityScore - left.benchmark.qualityScore ||
      right.benchmark.schemaSuccessRate - left.benchmark.schemaSuccessRate ||
      left.route.routeId.localeCompare(right.route.routeId)
    );
  })[0]!;
}

export function selectBenchmarkedModelRoutes(input: {
  registry: ModelRegistry;
  benchmarks: readonly ModelBenchmarkResult[];
  policy: ModelSelectionPolicy;
}): ModelSelection {
  validateSelectionPolicy(input.policy);
  const rejections: ModelSelectionRejection[] = [];
  const candidates: SelectedModelRoute[] = [];
  const passingByRoute = new Map<string, SelectedModelRoute[]>();

  for (const route of input.registry.routes) {
    const routeReasons: string[] = [];
    if (input.policy.requiresVision && !route.capabilities.vision) {
      routeReasons.push("vision capability is required");
    }
    if (input.policy.requiresJsonSchema && !route.capabilities.jsonSchema) {
      routeReasons.push("JSON schema capability is required");
    }
    if (
      input.policy.minimumContextTokens > 0 &&
      (route.capabilities.contextWindowTokens === null ||
        route.capabilities.contextWindowTokens < input.policy.minimumContextTokens)
    ) {
      routeReasons.push("verified context window is below the required minimum or unknown");
    }
    if (
      !route.capabilities.reasoningEfforts.some(
        (effort) => reasoningRank(effort) >= reasoningRank(input.policy.minimumReasoning)
      )
    ) {
      routeReasons.push("minimum reasoning effort is unsupported");
    }
    if (routeReasons.length > 0) {
      rejections.push({ routeId: route.routeId, reason: routeReasons.join("; ") });
      continue;
    }

    const routeBenchmarks = input.benchmarks.filter((benchmark) => benchmark.routeId === route.routeId);
    const passingBenchmarks: ModelBenchmarkResult[] = [];
    for (const benchmark of routeBenchmarks) {
      const invalidReason = validateBenchmark(benchmark);
      if (invalidReason) {
        rejections.push({ routeId: route.routeId, reason: invalidReason });
        continue;
      }
      const benchmarkReasons: string[] = [];
      if (!route.capabilities.reasoningEfforts.includes(benchmark.reasoningEffort)) {
        benchmarkReasons.push("benchmark reasoning is unsupported by the route");
      }
      if (reasoningRank(benchmark.reasoningEffort) < reasoningRank(input.policy.minimumReasoning)) {
        benchmarkReasons.push("benchmark reasoning is below the minimum");
      }
      if (benchmark.sampleSize < input.policy.minimumSampleSize) {
        benchmarkReasons.push("benchmark sample is too small");
      }
      if (benchmark.qualityScore < input.policy.minimumQualityScore) {
        benchmarkReasons.push("quality score is below the floor");
      }
      if (benchmark.schemaSuccessRate < input.policy.minimumSchemaSuccessRate) {
        benchmarkReasons.push("schema success rate is below the floor");
      }
      if (benchmark.p95LatencyMs > input.policy.maximumP95LatencyMs) {
        benchmarkReasons.push("p95 latency exceeds the ceiling");
      }
      if (benchmarkReasons.length > 0) {
        rejections.push({ routeId: route.routeId, reason: benchmarkReasons.join("; ") });
        continue;
      }
      passingBenchmarks.push(benchmark);
    }
    if (routeBenchmarks.length === 0) {
      rejections.push({ routeId: route.routeId, reason: "no benchmark result" });
      continue;
    }
    if (passingBenchmarks.length === 0) {
      continue;
    }
    const routePassing = passingBenchmarks.map((benchmark) => ({
      route,
      benchmark
    }));
    passingByRoute.set(route.routeId, routePassing);
    candidates.push(chooseByCostThenSpeed(routePassing));
  }

  if (candidates.length === 0) {
    throw new ModelSelectionError("No model route passed the benchmark policy.", rejections);
  }

  const primary = chooseByCostThenSpeed(candidates);
  const allowedFallbacks = new Set(primary.route.capabilities.fallbackRouteIds);
  const fallbackCandidates = candidates.filter(
    (candidate) => candidate.route.routeId !== primary.route.routeId && allowedFallbacks.has(candidate.route.routeId)
  );
  if (fallbackCandidates.length === 0) {
    // Owner-approved degraded mode (2026-07-10): when no distinct route passes the
    // policy, the same route may serve as fallback at a different benchmark-qualified
    // reasoning effort. The selection records fallbackMode so manifests and audits see
    // that model-outage resilience is NOT provided by this pair.
    const sameRouteAlternatives = (passingByRoute.get(primary.route.routeId) ?? []).filter(
      (candidate) => candidate.benchmark.reasoningEffort !== primary.benchmark.reasoningEffort
    );
    if (sameRouteAlternatives.length === 0) {
      throw new ModelSelectionError(
        `Primary route ${primary.route.routeId} has no distinct benchmark-qualified fallback.`,
        rejections
      );
    }
    return deepFreeze(
      structuredClone({
        primary,
        fallback: chooseByCostThenSpeed(sameRouteAlternatives),
        fallbackMode: "same_route_reasoning" as const,
        policy: input.policy
      })
    );
  }
  const fallback = chooseByCostThenSpeed(fallbackCandidates);
  return deepFreeze(
    structuredClone({
      primary,
      fallback,
      fallbackMode: "distinct_route" as const,
      policy: input.policy
    })
  );
}

const CODEX_REPO_EVIDENCE = [
  "lib/workspace-codex-models.ts lists gpt-5.4 and gpt-5.4-mini for multimodal Stage 2 routes",
  "tests/codex-runner.test.ts verifies gpt-5.4-mini with --image and --output-schema",
  "lib/stage2-prompt-specs.ts exposes low, medium, high, and x-high reasoning",
  "lib/codex-runner.ts defaults each execution timeout to 480000 ms"
] as const;

const LUNA_LIVE_PROBE_EVIDENCE = [
  "2026-07-10 live probe on codex-cli 0.144.1: `codex exec --model gpt-5.6-luna` returned OK on this ChatGPT account (0.131.0-alpha.22 rejected the model; gpt-5.6 and gpt-5.6-mini remain unsupported for ChatGPT accounts)",
  "2026-07-10 live probe: `codex exec --model gpt-5.6-luna --image <real dataset key frame>` returned a correct visual answer",
  "2026-07-10 live probe: `codex exec --model gpt-5.6-luna --output-schema` returned schema-valid JSON",
  "OpenAI Codex rate card (captured 2026-07-10 in docs/project-kings-production-pipeline-v1/evidence/codex-rate-card-2026-07-10-v2.json) lists GPT-5.6 Luna at 25/2.50/150 credits per 1M input/cached/output tokens",
  "lib/codex-runner.ts defaults each execution timeout to 480000 ms"
] as const;

export const PROJECT_KINGS_V1_MODEL_REGISTRY = defineModelRegistry([
  {
    routeId: "codex:gpt-5.4",
    provider: "codex",
    model: "gpt-5.4",
    capabilities: {
      vision: true,
      jsonSchema: true,
      reasoningEfforts: MODEL_REASONING_EFFORTS,
      contextWindowTokens: null,
      cost: {
        source: "benchmark-required",
        costUnit: null,
        inputPerMillionTokens: null,
        cachedInputPerMillionTokens: null,
        outputPerMillionTokens: null
      },
      timeoutMs: 8 * 60_000,
      fallbackRouteIds: ["codex:gpt-5.4-mini", "codex:gpt-5.6-luna"]
    },
    evidence: CODEX_REPO_EVIDENCE
  },
  {
    routeId: "codex:gpt-5.4-mini",
    provider: "codex",
    model: "gpt-5.4-mini",
    capabilities: {
      vision: true,
      jsonSchema: true,
      reasoningEfforts: MODEL_REASONING_EFFORTS,
      contextWindowTokens: null,
      cost: {
        source: "benchmark-required",
        costUnit: null,
        inputPerMillionTokens: null,
        cachedInputPerMillionTokens: null,
        outputPerMillionTokens: null
      },
      timeoutMs: 8 * 60_000,
      fallbackRouteIds: ["codex:gpt-5.4", "codex:gpt-5.6-luna"]
    },
    evidence: CODEX_REPO_EVIDENCE
  },
  {
    routeId: "codex:gpt-5.6-luna",
    provider: "codex",
    model: "gpt-5.6-luna",
    capabilities: {
      vision: true,
      jsonSchema: true,
      reasoningEfforts: MODEL_REASONING_EFFORTS,
      contextWindowTokens: null,
      cost: {
        source: "benchmark-required",
        costUnit: null,
        inputPerMillionTokens: null,
        cachedInputPerMillionTokens: null,
        outputPerMillionTokens: null
      },
      timeoutMs: 8 * 60_000,
      fallbackRouteIds: ["codex:gpt-5.4", "codex:gpt-5.4-mini"]
    },
    evidence: LUNA_LIVE_PROBE_EVIDENCE
  }
]);
