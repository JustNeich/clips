import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import modelBenchmarkModule from "../lib/project-kings/model-benchmark";
import type { ModelBenchmarkPricingEvidence } from "../lib/project-kings/model-benchmark";
import modelRoutingModule from "../lib/project-kings/model-routing";
import type { ModelReasoningEffort, ModelSelectionPolicy } from "../lib/project-kings/model-routing";
import productionAgentRuntimeModule from "../lib/project-kings/production-agent-runtime";
import remainingBenchmarkModule from "../lib/project-kings/remaining-semantic-benchmark-dataset";
import type { RemainingSemanticBenchmarkRole } from "../lib/project-kings/remaining-semantic-benchmark-dataset";
import checkpointModule from "../lib/project-kings/remaining-semantic-benchmark-checkpoint";
import type {
  RemainingSemanticBenchmarkCheckpointCall,
  RemainingSemanticBenchmarkInvocationIdentity
} from "../lib/project-kings/remaining-semantic-benchmark-checkpoint";

const { ModelBenchmarkHarnessError, runStageSpecificModelBenchmark } = modelBenchmarkModule;
const { PROJECT_KINGS_V1_MODEL_REGISTRY } = modelRoutingModule;
const { createCodexProductionAgentInvoker } = productionAgentRuntimeModule;
const {
  REMAINING_SEMANTIC_BENCHMARK_ROLES,
  buildRemainingSemanticBenchmarkDatasets,
  createRemainingSemanticBenchmarkQualityEvaluator,
  remainingSemanticAnnotationSha256
} = remainingBenchmarkModule;
const {
  REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION,
  appendRemainingSemanticBenchmarkCheckpoint,
  hasCompleteRemainingSemanticCheckpointUsage,
  loadSuccessfulRemainingSemanticCheckpoints,
  remainingSemanticBenchmarkInvocationKey
} = checkpointModule;

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const EVIDENCE_ROOT = path.join(
  REPO_ROOT,
  "docs/project-kings-production-pipeline-v1/evidence"
);
const RATE_CARD_PATH = path.join(EVIDENCE_ROOT, "codex-rate-card-2026-07-10-v2.json");
const RATE_CARD_VERIFIED_AT = "2026-07-10T18:20:00.000Z";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function compactError(value: unknown): string {
  const message = (value instanceof Error ? value.stack ?? value.message : String(value)).trim();
  return message.length <= 8_000
    ? message
    : `${message.slice(0, 2_000)}\n... [truncated] ...\n${message.slice(-5_000)}`;
}

function requiredRole(): RemainingSemanticBenchmarkRole {
  const role = process.env.PROJECT_KINGS_REMAINING_BENCHMARK_ROLE?.trim();
  if (!REMAINING_SEMANTIC_BENCHMARK_ROLES.includes(role as RemainingSemanticBenchmarkRole)) {
    throw new Error(
      `PROJECT_KINGS_REMAINING_BENCHMARK_ROLE must be one of ${REMAINING_SEMANTIC_BENCHMARK_ROLES.join(", ")}.`
    );
  }
  return role as RemainingSemanticBenchmarkRole;
}

function evidenceTag(): string {
  const value = process.env.PROJECT_KINGS_REMAINING_BENCHMARK_VERSION?.trim() || "real-30-v2";
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) {
    throw new Error("PROJECT_KINGS_REMAINING_BENCHMARK_VERSION must be a safe lowercase evidence tag.");
  }
  return value;
}

function candidatesForRole(role: RemainingSemanticBenchmarkRole): Array<{
  routeId: string;
  reasoningEffort: ModelReasoningEffort;
}> {
  // Owner directive 2026-07-10: the production candidate pool is gpt-5.6-luna;
  // two reasoning efforts of the same route provide primary + same-route fallback.
  const defaults: Record<RemainingSemanticBenchmarkRole, string> = {
    source_search: "codex:gpt-5.6-luna:low,codex:gpt-5.6-luna:medium",
    source_fit: "codex:gpt-5.6-luna:low,codex:gpt-5.6-luna:medium",
    caption: "codex:gpt-5.6-luna:low,codex:gpt-5.6-luna:medium",
    montage_planner: "codex:gpt-5.6-luna:low,codex:gpt-5.6-luna:medium"
  };
  const raw = process.env.PROJECT_KINGS_REMAINING_BENCHMARK_CANDIDATES?.trim() || defaults[role];
  const result = raw.split(",").map((entry) => {
    const match = /^(codex:gpt-5\.4(?:-mini)?|codex:gpt-5\.6-luna):(low|medium|high|x-high)$/.exec(entry.trim());
    if (!match) throw new Error(`Invalid remaining-role benchmark candidate ${entry}.`);
    return { routeId: match[1]!, reasoningEffort: match[2]! as ModelReasoningEffort };
  });
  if (result.length < 2) throw new Error("At least two benchmark candidates are required.");
  return result;
}

// Owner directive 2026-07-11: production routes run gpt-5.6-luna exclusively. When
// only one luna route passes the floors, allow an explicit fail-closed single-route
// selection instead of throwing. Floors are unchanged.
const POLICIES: Record<RemainingSemanticBenchmarkRole, ModelSelectionPolicy> = {
  source_search: {
    requiresVision: false,
    requiresJsonSchema: true,
    minimumReasoning: "low",
    minimumContextTokens: 0,
    minimumSampleSize: 30,
    minimumQualityScore: 1,
    minimumSchemaSuccessRate: 1,
    maximumP95LatencyMs: 300_000,
    allowFailClosedSingleRoute: true
  },
  source_fit: {
    requiresVision: true,
    requiresJsonSchema: true,
    minimumReasoning: "low",
    minimumContextTokens: 0,
    minimumSampleSize: 30,
    minimumQualityScore: 1,
    minimumSchemaSuccessRate: 1,
    maximumP95LatencyMs: 90_000,
    allowFailClosedSingleRoute: true
  },
  caption: {
    requiresVision: true,
    requiresJsonSchema: true,
    minimumReasoning: "low",
    minimumContextTokens: 0,
    minimumSampleSize: 30,
    minimumQualityScore: 1,
    minimumSchemaSuccessRate: 1,
    maximumP95LatencyMs: 240_000,
    allowFailClosedSingleRoute: true
  },
  montage_planner: {
    requiresVision: true,
    requiresJsonSchema: true,
    minimumReasoning: "low",
    minimumContextTokens: 0,
    minimumSampleSize: 30,
    minimumQualityScore: 1,
    minimumSchemaSuccessRate: 1,
    maximumP95LatencyMs: 240_000,
    allowFailClosedSingleRoute: true
  }
};

async function main(): Promise<void> {
  const role = requiredRole();
  const tag = evidenceTag();
  const candidates = candidatesForRole(role);
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), `project-kings-${role}-real-30-`));
  try {
    const built = await buildRemainingSemanticBenchmarkDatasets({
      repoRoot: REPO_ROOT,
      fixtureRoot
    });
    const dataset = built.datasets[role];
    const qualityEvaluator = createRemainingSemanticBenchmarkQualityEvaluator(
      built.annotations,
      built.sourceSearchBoundary
    );
    const rateCardBytes = await fs.readFile(RATE_CARD_PATH);
    const rateCard = JSON.parse(rateCardBytes.toString("utf8")) as {
      rates: Record<string, { input: number; cachedInput: number; output: number }>;
    };
    const pricing: ModelBenchmarkPricingEvidence[] = PROJECT_KINGS_V1_MODEL_REGISTRY.routes.map((route) => {
      const rate = rateCard.rates[route.model];
      if (!rate) throw new Error(`Frozen rate card does not contain ${route.model}.`);
      return {
        routeId: route.routeId,
        costUnit: "codex_credits",
        inputPerMillionTokens: rate.input,
        cachedInputPerMillionTokens: rate.cachedInput,
        outputPerMillionTokens: rate.output,
        source: "OpenAI Codex rate card captured in docs/project-kings-production-pipeline-v1/evidence/codex-rate-card-2026-07-10-v2.json",
        verifiedAt: RATE_CARD_VERIFIED_AT,
        sourceSha256: sha256(rateCardBytes)
      };
    });
    const outputPath = path.join(
      EVIDENCE_ROOT,
      `model-benchmark-${role}-2026-07-10-${tag}.json`
    );
    const rawOutputPath = path.join(
      EVIDENCE_ROOT,
      `model-benchmark-${role}-2026-07-10-${tag}-raw.json`
    );
    const benchmarkVersion = `project-kings-${role}-${tag}`;
    const annotationsSha256 = remainingSemanticAnnotationSha256(built.annotations);
    const checkpointPath = path.join(
      REPO_ROOT,
      ".data/project-kings/model-benchmark-checkpoints",
      `${role}-${tag}.jsonl`
    );
    await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
    const successfulCheckpoints = await loadSuccessfulRemainingSemanticCheckpoints(checkpointPath);
    const baseInvoker = createCodexProductionAgentInvoker({
      repoCwd: REPO_ROOT,
      codexHome: process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex")
    });
    const rawCalls: Array<Record<string, unknown>> = [];
    let virtualMonotonicClockMs = 0;
    const invoker: typeof baseInvoker = async (invocation) => {
      const promptSha256 = sha256(invocation.prompt);
      const outputSchemaSha256 = sha256Json(invocation.outputSchema);
      const invocationIdentity: RemainingSemanticBenchmarkInvocationIdentity = {
        benchmarkVersion,
        annotationsSha256,
        caseId: invocation.packet.itemId,
        routeId: invocation.route.routeId,
        model: invocation.route.model,
        reasoningEffort: invocation.route.reasoningEffort,
        promptSha256,
        outputSchemaSha256
      };
      const invocationKey = remainingSemanticBenchmarkInvocationKey(invocationIdentity);
      const checkpoint = successfulCheckpoints.get(invocationKey);
      if (checkpoint) {
        virtualMonotonicClockMs += checkpoint.durationMs;
        rawCalls.push({
          ...checkpoint,
          resumedFromCheckpoint: true,
          checkpointPath: path.relative(REPO_ROOT, checkpointPath)
        });
        return {
          rawOutput: checkpoint.rawOutput!,
          usage: checkpoint.usage!
        };
      }
      const startedAt = new Date().toISOString();
      const started = performance.now();
      try {
        const result = await baseInvoker(invocation);
        const durationMs = Number((performance.now() - started).toFixed(6));
        virtualMonotonicClockMs += durationMs;
        const call: RemainingSemanticBenchmarkCheckpointCall = {
          schemaVersion: REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION,
          invocationKey,
          ...invocationIdentity,
          startedAt,
          durationMs,
          outcome: "returned",
          rawOutput: result.rawOutput,
          outputSha256: sha256(result.rawOutput),
          usage: result.usage,
          error: null
        };
        await appendRemainingSemanticBenchmarkCheckpoint(checkpointPath, call);
        if (hasCompleteRemainingSemanticCheckpointUsage(call.usage)) {
          successfulCheckpoints.set(invocationKey, call);
        }
        rawCalls.push({ ...call, resumedFromCheckpoint: false });
        return result;
      } catch (error) {
        const durationMs = Number((performance.now() - started).toFixed(6));
        virtualMonotonicClockMs += durationMs;
        const call: RemainingSemanticBenchmarkCheckpointCall = {
          schemaVersion: REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION,
          invocationKey,
          ...invocationIdentity,
          startedAt,
          durationMs,
          outcome: "invoke_error",
          rawOutput: null,
          outputSha256: null,
          usage: null,
          error: compactError(error)
        };
        await appendRemainingSemanticBenchmarkCheckpoint(checkpointPath, call);
        rawCalls.push({ ...call, resumedFromCheckpoint: false });
        throw error;
      }
    };

    let outcome: "pass" | "blocked" = "blocked";
    let runError: string | null = null;
    let evidenceSha256: string | null = null;
    try {
      const result = await runStageSpecificModelBenchmark({
        benchmarkVersion,
        registry: PROJECT_KINGS_V1_MODEL_REGISTRY,
        policy: POLICIES[role],
        dataset,
        candidates,
        pricing,
        qualityEvaluator,
        invoker,
        monotonicNowMs: () => virtualMonotonicClockMs,
        outputPath
      });
      outcome = "pass";
      evidenceSha256 = result.evidence.evidenceSha256;
      const fallbackLabel = result.selection.fallback
        ? `${result.selection.fallback.route.model}/${result.selection.fallback.benchmark.reasoningEffort}`
        : "fail-closed-none";
      process.stdout.write(
        `${role}: PASS primary=${result.selection.primary.route.model}/${result.selection.primary.benchmark.reasoningEffort} fallback=${fallbackLabel} evidence=${result.evidence.evidenceSha256}\n`
      );
    } catch (error) {
      runError = compactError(error);
      if (error instanceof ModelBenchmarkHarnessError && error.evidence) {
        evidenceSha256 = error.evidence.evidenceSha256;
      } else {
        throw error;
      }
      process.stdout.write(`${role}: BLOCKED ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      const rawPayload = {
        schemaVersion: "project-kings-remaining-semantic-model-raw-evidence-v1",
        benchmarkVersion,
        stageRole: role,
        createdAt: new Date().toISOString(),
        annotationsSha256,
        benchmarkEvidenceSha256: evidenceSha256,
        outcome,
        error: runError,
        callCount: rawCalls.length,
        checkpoint: {
          relativePath: path.relative(REPO_ROOT, checkpointPath),
          resumedSuccessCount: rawCalls.filter((entry) => entry.resumedFromCheckpoint === true).length,
          liveCallCount: rawCalls.filter((entry) => entry.resumedFromCheckpoint === false).length
        },
        candidates,
        calls: rawCalls
      };
      const frozenRaw = { ...rawPayload, rawEvidenceSha256: sha256Json(rawPayload) };
      await fs.writeFile(rawOutputPath, `${JSON.stringify(frozenRaw, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
    }
    if (outcome !== "pass") process.exitCode = 1;
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${compactError(error)}\n`);
  process.exitCode = 1;
});
