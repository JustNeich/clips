import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { SourceSearchOutput, SourceSearchPacket } from "../lib/project-kings/production-agent-contracts";
import {
  ModelBenchmarkHarnessError,
  SOURCE_POLICY_PRODUCTION_MINIMUM_SAMPLE_SIZE,
  calculateModelBenchmarkCost,
  calculateModelBenchmarkP95,
  createDecisionLabelQualityEvaluator,
  runStageSpecificModelBenchmark,
  writeFrozenModelBenchmarkEvidence,
  type ModelBenchmarkPricingEvidence,
  type StageModelBenchmarkDataset
} from "../lib/project-kings/model-benchmark";
import {
  defineModelRegistry,
  type ModelRegistry,
  type ModelSelectionPolicy
} from "../lib/project-kings/model-routing";

const CHANNEL_ID = "UC1234567890123456789012";
const ARTIFACT_SHA = "a".repeat(64);
const PRICING_SHA = "b".repeat(64);
const USAGE = {
  inputTokens: 100,
  cachedInputTokens: 40,
  outputTokens: 20,
  reasoningOutputTokens: 5
};

const REGISTRY: ModelRegistry = defineModelRegistry([
  {
    routeId: "codex:gpt-5.4-mini",
    provider: "codex",
    model: "gpt-5.4-mini",
    capabilities: {
      vision: true,
      jsonSchema: true,
      reasoningEfforts: ["low", "medium", "high", "x-high"],
      contextWindowTokens: 128_000,
      cost: {
        source: "benchmark-required",
        costUnit: null,
        inputPerMillionTokens: null,
        cachedInputPerMillionTokens: null,
        outputPerMillionTokens: null
      },
      timeoutMs: 90_000,
      fallbackRouteIds: ["codex:gpt-5.4"]
    },
    evidence: ["Test registry mirrors the Project Kings Codex route contract."]
  },
  {
    routeId: "codex:gpt-5.4",
    provider: "codex",
    model: "gpt-5.4",
    capabilities: {
      vision: true,
      jsonSchema: true,
      reasoningEfforts: ["low", "medium", "high", "x-high"],
      contextWindowTokens: 128_000,
      cost: {
        source: "benchmark-required",
        costUnit: null,
        inputPerMillionTokens: null,
        cachedInputPerMillionTokens: null,
        outputPerMillionTokens: null
      },
      timeoutMs: 90_000,
      fallbackRouteIds: ["codex:gpt-5.4-mini"]
    },
    evidence: ["Test registry mirrors the Project Kings Codex fallback contract."]
  }
]);

const POLICY: ModelSelectionPolicy = {
  requiresVision: false,
  requiresJsonSchema: true,
  minimumReasoning: "low",
  minimumContextTokens: 0,
  minimumSampleSize: 2,
  minimumQualityScore: 1,
  minimumSchemaSuccessRate: 1,
  maximumP95LatencyMs: 1_000
};

const PRICING: ModelBenchmarkPricingEvidence[] = [
  {
    routeId: "codex:gpt-5.4-mini",
    costUnit: "usd",
    inputPerMillionTokens: 1,
    cachedInputPerMillionTokens: 0.5,
    outputPerMillionTokens: 2,
    source: "Frozen test pricing sheet.",
    verifiedAt: "2026-07-10T00:00:00.000Z",
    sourceSha256: PRICING_SHA
  },
  {
    routeId: "codex:gpt-5.4",
    costUnit: "usd",
    inputPerMillionTokens: 10,
    cachedInputPerMillionTokens: 5,
    outputPerMillionTokens: 20,
    source: "Frozen test pricing sheet.",
    verifiedAt: "2026-07-10T00:00:00.000Z",
    sourceSha256: PRICING_SHA
  }
];

function packet(caseId: string): SourceSearchPacket {
  return {
    schemaVersion: "production-agent-packet-v1",
    role: "source_search",
    runId: "benchmark-run",
    itemId: caseId,
    channelId: CHANNEL_ID,
    profileVersion: "profile-v1",
    task: {
      targetCandidateCount: 1,
      querySeeds: ["police rescue"],
      allowedStrategies: ["instagram"],
      excludedStoryEventIds: []
    },
    artifacts: [
      {
        id: "concept",
        kind: "concept_contract",
        mediaType: "json",
        path: `/private/owner/full-chat-secret/${caseId}.json`,
        sha256: ARTIFACT_SHA
      }
    ]
  };
}

const DATASET: StageModelBenchmarkDataset<"source_search"> = {
  datasetId: "source-search-holdout",
  datasetVersion: "v1",
  role: "source_search",
  cases: [
    { caseId: "case-1", packet: packet("case-1"), expectedQualityLabel: "FOUND" },
    { caseId: "case-2", packet: packet("case-2"), expectedQualityLabel: "FOUND" }
  ]
};

function output(): SourceSearchOutput {
  return {
    decision: "FOUND",
    candidates: [
      {
        candidateId: "candidate-1",
        sourceUrl: "https://www.instagram.com/reel/example/",
        strategy: "instagram",
        storyEventId: "event-1",
        eventSummary: "Officer releases a trapped animal.",
        relevanceReason: "The action and payoff are both visible.",
        evidenceArtifactIds: ["concept"]
      }
    ],
    exhaustedStrategies: []
  };
}

function candidates() {
  return [
    { routeId: "codex:gpt-5.4-mini", reasoningEffort: "medium" as const },
    { routeId: "codex:gpt-5.4", reasoningEffort: "medium" as const }
  ];
}

function deterministicRunOptions(options: {
  outputPath?: string;
  invalidMini?: boolean;
  omitMiniUsage?: boolean;
  calls?: string[];
} = {}) {
  let clock = 0;
  return {
    benchmarkVersion: "benchmark-v1",
    registry: REGISTRY,
    policy: POLICY,
    dataset: DATASET,
    candidates: candidates(),
    pricing: PRICING,
    qualityEvaluator: createDecisionLabelQualityEvaluator({ evaluatorVersion: "v1" }),
    outputPath: options.outputPath,
    now: () => new Date("2026-07-10T12:00:00.000Z"),
    monotonicNowMs: () => clock,
    invoker: async (input: Parameters<import("../lib/project-kings/production-agent-runtime").ProductionAgentInvoker>[0]) => {
      options.calls?.push(`${input.route.routeId}:${input.route.reasoningEffort}:${input.packet.itemId}`);
      assert.equal(input.prompt.includes("full-chat-secret"), false);
      assert.equal(input.prompt.includes("There is no conversation history."), true);
      clock += input.route.routeId.endsWith("mini") ? 100 : 200;
      const rawOutput =
        options.invalidMini && input.route.routeId.endsWith("mini")
          ? JSON.stringify({ decision: "FOUND", candidates: [], exhaustedStrategies: [] })
          : JSON.stringify(output());
      return {
        rawOutput,
        usage: options.omitMiniUsage && input.route.routeId.endsWith("mini") ? null : USAGE
      };
    }
  };
}

test("cost calculation splits cached input and does not double-count reasoning tokens", () => {
  assert.equal(
    calculateModelBenchmarkCost(USAGE, {
      routeId: "codex:test",
      costUnit: "usd",
      inputPerMillionTokens: 10,
      cachedInputPerMillionTokens: 2,
      outputPerMillionTokens: 30,
      source: "test",
      verifiedAt: "2026-07-10T00:00:00.000Z",
      sourceSha256: PRICING_SHA
    }),
    0.00128
  );
  assert.equal(
    calculateModelBenchmarkP95(Array.from({ length: 20 }, (_, index) => index + 1)),
    19
  );
});

test("stage benchmark selects the cheapest passing route and registers a tested fallback", async () => {
  const calls: string[] = [];
  const result = await runStageSpecificModelBenchmark(deterministicRunOptions({ calls }));

  assert.equal(result.selection.primary.route.routeId, "codex:gpt-5.4-mini");
  assert.equal(result.selection.fallback.route.routeId, "codex:gpt-5.4");
  assert.equal(result.selection.primary.benchmark.reasoningEffort, "medium");
  assert.deepEqual(calls, [
    "codex:gpt-5.4-mini:medium:case-1",
    "codex:gpt-5.4-mini:medium:case-2",
    "codex:gpt-5.4:medium:case-1",
    "codex:gpt-5.4:medium:case-2"
  ]);
  assert.equal(result.evidence.selection?.primary.routeId, "codex:gpt-5.4-mini");
  assert.equal(result.evidence.selection?.fallback.routeId, "codex:gpt-5.4");
  assert.equal(result.evidence.candidates[0]?.aggregate.schemaSuccessRate, 1);
  assert.equal(result.evidence.candidates[0]?.aggregate.qualityScore, 1);
  assert.equal(result.evidence.candidates[0]?.aggregate.p95LatencyMs, 100);
  assert.equal(result.evidence.candidates[1]?.aggregate.p95LatencyMs, 200);
  assert.match(result.evidence.dataset.datasetSha256, /^[a-f0-9]{64}$/);
  assert.match(result.evidence.dataset.promptSetSha256, /^[a-f0-9]{64}$/);
  assert.match(result.evidence.dataset.outputSchemaSha256, /^[a-f0-9]{64}$/);
  assert.match(result.evidence.executionContract.registrySha256, /^[a-f0-9]{64}$/);
  assert.match(result.evidence.executionContract.policySha256, /^[a-f0-9]{64}$/);
  assert.match(result.evidence.qualityEvaluator.implementationSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    result.evidence.executionContract.costMethod,
    "uncached-input-plus-cached-input-plus-total-output-v1"
  );
  assert.equal(result.evidence.executionContract.reasoningTokensDoubleCounted, false);
  assert.match(result.evidence.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(result.evidence), true);
  assert.equal(Object.isFrozen(result.evidence.candidates[0]?.samples[0]), true);
});

test("same frozen inputs, outputs, clocks and timestamp produce the same evidence hash", async () => {
  const first = await runStageSpecificModelBenchmark(deterministicRunOptions());
  const second = await runStageSpecificModelBenchmark(deterministicRunOptions());

  assert.equal(first.evidence.dataset.datasetSha256, second.evidence.dataset.datasetSha256);
  assert.equal(first.evidence.dataset.promptSetSha256, second.evidence.dataset.promptSetSha256);
  assert.equal(first.evidence.evidenceSha256, second.evidence.evidenceSha256);
});

test("frozen evidence is written once and cannot be silently overwritten", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kings-model-benchmark-"));
  const outputPath = path.join(directory, "source-search-v1.json");
  try {
    const result = await runStageSpecificModelBenchmark(deterministicRunOptions({ outputPath }));
    const stored = JSON.parse(await fs.readFile(outputPath, "utf-8")) as {
      evidenceSha256?: string;
      selection?: { fallback?: { model?: string } };
    };
    assert.equal(stored.evidenceSha256, result.evidence.evidenceSha256);
    assert.equal(stored.selection?.fallback?.model, "gpt-5.4");
    await assert.rejects(() => writeFrozenModelBenchmarkEvidence(outputPath, result.evidence), /EEXIST/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("schema-invalid candidate cannot pass and a portfolio without tested fallback fails closed", async () => {
  await assert.rejects(
    () => runStageSpecificModelBenchmark(deterministicRunOptions({ invalidMini: true })),
    (error: unknown) => {
      assert.ok(error instanceof ModelBenchmarkHarnessError);
      assert.equal(error.evidence?.selection, null);
      assert.equal(error.evidence?.candidates[0]?.aggregate.schemaSuccessRate, 0);
      assert.equal(error.evidence?.candidates[1]?.aggregate.schemaSuccessRate, 1);
      assert.match(error.evidence?.selectionError ?? "", /fallback/i);
      return true;
    }
  );
});

test("missing usage is never converted into zero cost or selector eligibility", async () => {
  await assert.rejects(
    () => runStageSpecificModelBenchmark(deterministicRunOptions({ omitMiniUsage: true })),
    (error: unknown) => {
      assert.ok(error instanceof ModelBenchmarkHarnessError);
      const mini = error.evidence?.candidates[0];
      assert.equal(mini?.aggregate.completeUsageAndCostEvidence, false);
      assert.equal(mini?.aggregate.meanCost, null);
      assert.equal(mini?.aggregate.selectorBenchmark, null);
      assert.equal(error.evidence?.selection, null);
      return true;
    }
  );
});

test("full chat history injected into a dataset packet is rejected before invocation", async () => {
  let calls = 0;
  const invalidDataset = {
    ...DATASET,
    cases: [
      {
        ...DATASET.cases[0]!,
        packet: {
          ...DATASET.cases[0]!.packet,
          fullChatHistory: ["secret owner conversation"]
        }
      }
    ]
  } as unknown as StageModelBenchmarkDataset<"source_search">;

  await assert.rejects(
    () =>
      runStageSpecificModelBenchmark({
        ...deterministicRunOptions(),
        dataset: invalidDataset,
        invoker: async () => {
          calls += 1;
          return { rawOutput: JSON.stringify(output()), usage: USAGE };
        }
      }),
    /fullChatHistory/
  );
  assert.equal(calls, 0);
});

test("source_policy benchmark scaffold fails closed before model calls until 30 real vision cases exist", async () => {
  let calls = 0;
  const dataset: StageModelBenchmarkDataset<"source_policy"> = {
    datasetId: "source-policy-real-candidate-holdout",
    datasetVersion: "scaffold-v1",
    role: "source_policy",
    cases: []
  };
  const run = (policy: ModelSelectionPolicy) =>
    runStageSpecificModelBenchmark({
      benchmarkVersion: "source-policy-benchmark-v1",
      registry: REGISTRY,
      policy,
      dataset,
      candidates: candidates(),
      pricing: PRICING,
      qualityEvaluator: createDecisionLabelQualityEvaluator({ evaluatorVersion: "v1" }),
      invoker: async () => {
        calls += 1;
        return { rawOutput: "{}", usage: USAGE };
      }
    });
  const sourcePolicyPolicy: ModelSelectionPolicy = {
    ...POLICY,
    requiresVision: true,
    minimumSampleSize: SOURCE_POLICY_PRODUCTION_MINIMUM_SAMPLE_SIZE
  };

  await assert.rejects(
    run({ ...sourcePolicyPolicy, requiresVision: false }),
    /Source policy benchmark policy must require vision capability/
  );
  await assert.rejects(
    run({
      ...sourcePolicyPolicy,
      minimumSampleSize: SOURCE_POLICY_PRODUCTION_MINIMUM_SAMPLE_SIZE - 1
    }),
    /minimumSampleSize must be at least 30/
  );
  await assert.rejects(
    run(sourcePolicyPolicy),
    /requires at least 30 real labeled cases/
  );
  assert.equal(calls, 0);
});
