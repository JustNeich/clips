import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveClaimableStage3WorkerKinds } from "../lib/stage3-worker-claim-capabilities";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  buildProductionSemanticJobPayload,
  buildProductionSemanticJobResult,
  hasReusableProductionSemanticResultJson,
  parseProductionSemanticJobPayloadJson,
  parseProductionSemanticJobResultJson,
  PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION,
  PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION,
  type ProductionSemanticExecutorReadiness,
  type ProductionSemanticJobExecutor,
  type ProductionSemanticJobPayload
} from "../lib/project-kings/production-semantic-job-contract";
import type {
  ProductionAgentAttemptTelemetry,
  ProductionAgentModelSelection
} from "../lib/project-kings/production-agent-runtime";
import {
  classifyStage3HeavyJobError,
  executeStage3HeavyJobPayload
} from "../lib/stage3-job-executor";
import {
  claimNextQueuedStage3JobForWorker,
  completeStage3Job,
  enqueueStage3Job,
  failQueuedLocalStage3JobsForWorkerUpdateRequired,
  getStage3Job
} from "../lib/stage3-job-store";
import { resolveStage3WorkerJobTimeoutMs } from "../lib/stage3-worker-job-timeout";
import {
  resolveProductionSemanticExecutorReadiness,
  resolveStage3WorkerSupportedKinds
} from "../lib/stage3-worker-runtime";

const ARTIFACT_SHA = "a".repeat(64);
const MANIFEST_SHA = "b".repeat(64);

function selection(): ProductionAgentModelSelection {
  const benchmarkVersion = "semantic-benchmark-v1";
  const route = (
    routeId: string,
    fallbackRouteIds: string[],
    meanCost: number
  ) => ({
    route: {
      routeId,
      provider: "codex",
      model: routeId === "caption-primary" ? "gpt-5.4-mini" : "gpt-5.4",
      capabilities: {
        vision: false,
        jsonSchema: true,
        reasoningEfforts: ["low", "medium"] as const,
        timeoutMs: 60_000,
        fallbackRouteIds
      }
    },
    benchmark: {
      benchmarkVersion,
      routeId,
      reasoningEffort: "low" as const,
      sampleSize: 3,
      qualityScore: 0.98,
      schemaSuccessRate: 1,
      p95LatencyMs: 1_000,
      meanCost,
      costUnit: "codex_credits" as const
    }
  });
  return {
    primary: route("caption-primary", ["caption-fallback"], 1),
    fallback: route("caption-fallback", [], 2),
    policy: {
      requiresVision: false,
      requiresJsonSchema: true,
      minimumReasoning: "low",
      minimumContextTokens: 1_000,
      minimumSampleSize: 3,
      minimumQualityScore: 0.9,
      minimumSchemaSuccessRate: 1,
      maximumP95LatencyMs: 5_000
    }
  };
}

function payload(overrides: { itemId?: string } = {}) {
  const itemId = overrides.itemId ?? "item-1";
  return buildProductionSemanticJobPayload({
    role: "caption",
    qualityBindingSha256: null,
    routeManifestId: "project-kings-model-routes-v2",
    routeManifestSha256: MANIFEST_SHA,
    selection: selection(),
    packet: {
      schemaVersion: "production-agent-packet-v1",
      role: "caption",
      runId: "run-1",
      itemId,
      channelId: `UC${"c".repeat(22)}`,
      profileVersion: "1",
      task: {
        candidateId: "candidate-1",
        language: "en",
        templateType: "top_bottom",
        maxCharacters: 160,
        bannedWords: ["forbidden"]
      },
      artifacts: [
        {
          inputId: "concept-contract",
          id: "concept-contract",
          kind: "concept_contract",
          mediaType: "json",
          fileName: "concept-contract.json",
          sizeBytes: 512,
          sha256: ARTIFACT_SHA,
          storageKey: ARTIFACT_SHA
        }
      ]
    }
  });
}

function passedAttempt(
  jobPayload: ProductionSemanticJobPayload<"caption">
): ProductionAgentAttemptTelemetry {
  return {
    schemaVersion: 1,
    attempt: 1,
    role: "caption",
    routeId: "caption-primary",
    provider: "codex",
    model: "gpt-5.4-mini",
    reasoningEffort: "low",
    benchmarkVersion: "semantic-benchmark-v1",
    timeoutMs: 60_000,
    startedAt: "2026-07-10T12:00:00.000Z",
    durationMs: 1_250,
    promptSha256: jobPayload.promptSha256,
    outputSha256: "d".repeat(64),
    usage: {
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
      reasoningOutputTokens: 10
    },
    outcome: "passed",
    error: null
  };
}

function result(jobPayload = payload()) {
  return buildProductionSemanticJobResult({
    payload: jobPayload,
    selectedRouteId: "caption-primary",
    output: {
      decision: "PASS",
      caption: "A concise factual caption",
      title: "A factual title",
      hook: "Watch this",
      action: "The subject completes the action",
      payoff: "The result is visible",
      factualClaims: [],
      bannedWordsFound: []
    },
    attempts: [passedAttempt(jobPayload)],
    workerRuntimeVersion: "clips-worker-test+semantic.1",
    completedAt: "2026-07-10T12:00:02.000Z"
  });
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-semantic-stage3-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function seedWorkspace(workspaceId: string, userId: string): void {
  const db = getDb();
  const stamp = nowIso();
  db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(workspaceId, "Semantic test", "semantic-test", stamp, stamp);
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, "semantic@example.com", "hash", "Semantic", "active", stamp, stamp);
  db.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newId(), workspaceId, userId, "owner", stamp, stamp);
}

test("production-semantic payload and result round-trip with exact hashes", () => {
  const builtPayload = payload();
  const parsedPayload = parseProductionSemanticJobPayloadJson(JSON.stringify(builtPayload));
  assert.equal(parsedPayload.payloadSha256, builtPayload.payloadSha256);
  assert.equal(parsedPayload.schemaVersion, PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION);

  const builtResult = result(builtPayload);
  const parsedResult = parseProductionSemanticJobResultJson(
    JSON.stringify(builtResult),
    parsedPayload
  );
  assert.equal(parsedResult.resultSha256, builtResult.resultSha256);
  assert.equal(parsedResult.schemaVersion, PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION);
  assert.equal(parsedResult.output.decision, "PASS");
});

test("production-semantic accepts only the authorized primary then fallback sequence", () => {
  const jobPayload = payload();
  const primaryFailed: ProductionAgentAttemptTelemetry = {
    ...passedAttempt(jobPayload),
    outputSha256: null,
    usage: null,
    outcome: "invoke_error",
    error: "primary unavailable"
  };
  const fallbackPassed: ProductionAgentAttemptTelemetry = {
    ...passedAttempt(jobPayload),
    attempt: 2,
    routeId: "caption-fallback",
    model: "gpt-5.4",
    outputSha256: "e".repeat(64)
  };
  const fallbackResult = buildProductionSemanticJobResult({
    payload: jobPayload,
    selectedRouteId: "caption-fallback",
    output: {
      decision: "PASS",
      caption: "A concise factual caption",
      title: "A factual title",
      hook: "Watch this",
      action: "The subject completes the action",
      payoff: "The result is visible",
      factualClaims: [],
      bannedWordsFound: []
    },
    attempts: [primaryFailed, fallbackPassed],
    workerRuntimeVersion: "clips-worker-test+semantic.fallback",
    completedAt: "2026-07-10T12:00:03.000Z"
  });
  assert.equal(fallbackResult.selectedRouteId, "caption-fallback");
  assert.equal(
    parseProductionSemanticJobResultJson(JSON.stringify(fallbackResult), jobPayload).attempts.length,
    2
  );

  assert.throws(() => buildProductionSemanticJobResult({
    payload: jobPayload,
    selectedRouteId: "caption-fallback",
    output: fallbackResult.output,
    attempts: [fallbackPassed],
    workerRuntimeVersion: "clips-worker-test+semantic.bad-order",
    completedAt: "2026-07-10T12:00:03.000Z"
  }), /authorized benchmark route|ordered attempt index/);
});

test("production-semantic contract rejects payload and result tampering", () => {
  const builtPayload = payload();
  const tamperedPayload = structuredClone(builtPayload) as any;
  tamperedPayload.packet.task.candidateId = "candidate-tampered";
  assert.throws(
    () => parseProductionSemanticJobPayloadJson(JSON.stringify(tamperedPayload)),
    /packetSha256/
  );

  const builtResult = result(builtPayload);
  const tamperedResult = structuredClone(builtResult) as any;
  tamperedResult.output.title = "Tampered title";
  assert.throws(
    () => parseProductionSemanticJobResultJson(JSON.stringify(tamperedResult), builtPayload),
    /outputSha256/
  );

  assert.equal(
    hasReusableProductionSemanticResultJson(
      JSON.stringify(builtPayload),
      JSON.stringify(tamperedResult)
    ),
    false
  );
});

test("worker advertises production-semantic only after a valid ready preflight", async () => {
  const unavailable = await resolveProductionSemanticExecutorReadiness(null);
  assert.equal(unavailable.ready, false);
  assert.equal(resolveStage3WorkerSupportedKinds(unavailable).includes("production-semantic"), false);
  assert.equal(
    resolveClaimableStage3WorkerKinds(
      ["production-semantic"],
      { productionSemantic: unavailable }
    )?.length,
    0
  );

  const ready: ProductionSemanticExecutorReadiness = {
    ready: true,
    code: "ready",
    message: "ready",
    jobSchemaVersion: PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION,
    resultSchemaVersion: PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION
  };
  const executor: ProductionSemanticJobExecutor = {
    preflight: async () => ready,
    execute: async (jobPayload) => result(jobPayload as ProductionSemanticJobPayload<"caption">)
  };
  const resolved = await resolveProductionSemanticExecutorReadiness(executor);
  assert.equal(resolved.ready, true);
  assert.equal(resolveStage3WorkerSupportedKinds(resolved).includes("production-semantic"), true);
  assert.deepEqual(
    resolveClaimableStage3WorkerKinds(
      ["production-semantic"],
      { productionSemantic: resolved }
    ),
    ["production-semantic"]
  );
});

test("Stage3 executor fails closed instead of running production-semantic on the server", async () => {
  const builtPayload = payload();
  await assert.rejects(
    executeStage3HeavyJobPayload("production-semantic", JSON.stringify(builtPayload)),
    /No ready production-semantic executor/
  );
  const classified = classifyStage3HeavyJobError(
    "production-semantic",
    await executeStage3HeavyJobPayload("production-semantic", JSON.stringify(builtPayload))
      .then(() => new Error("unexpected success"))
      .catch((error) => error)
  );
  assert.deepEqual(classified, {
    code: "production_semantic_executor_unavailable",
    message: "No ready production-semantic executor is installed in this worker runtime.",
    recoverable: false
  });
});

test("production-semantic has its own bounded worker timeout", () => {
  assert.equal(resolveStage3WorkerJobTimeoutMs("production-semantic", {}), 12 * 60_000);
  assert.equal(
    resolveStage3WorkerJobTimeoutMs("production-semantic", {
      STAGE3_WORKER_PRODUCTION_SEMANTIC_TIMEOUT_MS: "180000"
    }),
    180_000
  );
});

test("worker that does not support production-semantic cannot claim its job", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);
    const builtPayload = payload();
    const job = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "production-semantic",
      executionTarget: "local",
      payloadJson: JSON.stringify(builtPayload)
    });
    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: "worker-without-semantic",
      workspaceId,
      userId,
      supportedKinds: ["preview", "render", "agent-media-step"]
    });
    assert.equal(claimed, null);
    assert.equal(getStage3Job(job.id)?.status, "queued");
  });
});

test("completed production-semantic result-only job is reused only for exact valid bindings", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);
    const builtPayload = payload();
    const input = {
      workspaceId,
      userId,
      kind: "production-semantic" as const,
      executionTarget: "local" as const,
      dedupeKey: `project-kings-semantic:${builtPayload.invocationKey}`,
      payloadJson: JSON.stringify(builtPayload)
    };
    const first = enqueueStage3Job(input);
    completeStage3Job(first.id, {
      resultJson: JSON.stringify(result(builtPayload)),
      artifact: null
    });

    const reused = enqueueStage3Job(input);
    assert.equal(reused.id, first.id);
    assert.equal(reused.status, "completed");

    const mismatchedPayload = payload({ itemId: "item-2" });
    const mismatched = enqueueStage3Job({
      ...input,
      payloadJson: JSON.stringify(mismatchedPayload)
    });
    assert.equal(mismatched.id, first.id);
    assert.equal(mismatched.status, "queued");
    assert.equal(mismatched.resultJson, null);
  });
});

test("outdated worker failure projection includes queued production-semantic jobs", async () => {
  await withIsolatedAppData(async () => {
    const workspaceId = "w1";
    const userId = "u1";
    seedWorkspace(workspaceId, userId);
    const builtPayload = payload();
    const job = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "production-semantic",
      executionTarget: "local",
      dedupeKey: `project-kings-semantic:${builtPayload.invocationKey}`,
      payloadJson: JSON.stringify(builtPayload)
    });

    const failed = failQueuedLocalStage3JobsForWorkerUpdateRequired({
      workspaceId,
      userId,
      supportedKinds: ["production-semantic"],
      workerId: "worker-old",
      workerAppVersion: "old-runtime",
      expectedRuntimeVersion: "new-runtime"
    });
    assert.equal(failed, 1);
    assert.equal(getStage3Job(job.id)?.status, "failed");
    assert.equal(getStage3Job(job.id)?.errorCode, "worker_runtime_outdated");
  });
});
