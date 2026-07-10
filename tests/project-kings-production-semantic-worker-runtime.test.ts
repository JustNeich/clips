import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildProductionSemanticJobPayload,
  buildProductionSemanticJobResult,
  PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION,
  PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION,
  type ProductionSemanticExecutorReadiness,
  type ProductionSemanticJobPayload
} from "../lib/project-kings/production-semantic-job-contract";
import type { ProductionSemanticLeasedJobExecutor } from "../lib/project-kings/production-semantic-worker-executor";
import {
  ProductionSemanticCompletionUnknownError,
  readProjectKingsSemanticWorkerConfig,
  runProjectKingsSemanticWorkerLoop,
  runProjectKingsSemanticWorkerOnce,
  type ProjectKingsSemanticWorkerRuntimeOptions
} from "../lib/project-kings/production-semantic-worker-runtime";
import type {
  ProductionAgentAttemptTelemetry,
  ProductionAgentModelSelection
} from "../lib/project-kings/production-agent-runtime";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function selection(): ProductionAgentModelSelection {
  const route = (routeId: string, fallbackRouteIds: string[], cost: number) => ({
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
      benchmarkVersion: "semantic-runtime-test-v1",
      routeId,
      reasoningEffort: "low" as const,
      sampleSize: 3,
      qualityScore: 0.99,
      schemaSuccessRate: 1,
      p95LatencyMs: 1_000,
      meanCost: cost,
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

function payload(): ProductionSemanticJobPayload<"caption"> {
  const content = "{}";
  const digest = sha(content);
  return buildProductionSemanticJobPayload({
    role: "caption",
    routeManifestId: "semantic-runtime-routes-v2",
    routeManifestSha256: "b".repeat(64),
    selection: selection(),
    packet: {
      schemaVersion: "production-agent-packet-v1",
      role: "caption",
      runId: "run-1",
      itemId: "item-1",
      channelId: `UC${"c".repeat(22)}`,
      profileVersion: "1",
      task: {
        candidateId: "candidate-1",
        language: "en",
        templateType: "top_bottom",
        maxCharacters: 160,
        bannedWords: []
      },
      artifacts: [
        {
          inputId: "concept",
          id: "concept",
          kind: "concept_contract",
          mediaType: "json",
          fileName: "concept.json",
          sizeBytes: Buffer.byteLength(content),
          sha256: digest,
          storageKey: digest
        }
      ]
    }
  });
}

function readiness(): ProductionSemanticExecutorReadiness {
  return {
    ready: true,
    code: "ready",
    message: "ready",
    jobSchemaVersion: PRODUCTION_SEMANTIC_JOB_SCHEMA_VERSION,
    resultSchemaVersion: PRODUCTION_SEMANTIC_RESULT_SCHEMA_VERSION
  };
}

function attempt(jobPayload: ProductionSemanticJobPayload<"caption">): ProductionAgentAttemptTelemetry {
  return {
    schemaVersion: 1,
    attempt: 1,
    role: "caption",
    routeId: "caption-primary",
    provider: "codex",
    model: "gpt-5.4-mini",
    reasoningEffort: "low",
    benchmarkVersion: "semantic-runtime-test-v1",
    timeoutMs: 60_000,
    startedAt: "2026-07-10T12:00:00.000Z",
    durationMs: 1_000,
    promptSha256: jobPayload.promptSha256,
    outputSha256: "d".repeat(64),
    usage: {
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 1
    },
    outcome: "passed",
    error: null
  };
}

function result(jobPayload: ProductionSemanticJobPayload<"caption">) {
  return buildProductionSemanticJobResult({
    payload: jobPayload,
    selectedRouteId: "caption-primary",
    output: {
      decision: "PASS",
      caption: "Exact caption",
      title: "Exact title",
      hook: "Hook",
      action: "Action",
      payoff: "Payoff",
      factualClaims: [],
      bannedWordsFound: []
    },
    attempts: [attempt(jobPayload)],
    workerRuntimeVersion: "semantic-runtime-test-v1",
    completedAt: "2026-07-10T12:00:02.000Z"
  });
}

function executor(jobPayload: ProductionSemanticJobPayload<"caption">, calls: { count: number }): ProductionSemanticLeasedJobExecutor {
  return {
    preflight: async () => readiness(),
    execute: async () => {
      throw new Error("Exact lease required");
    },
    executeLeasedJob: async (_jobId, received) => {
      calls.count += 1;
      assert.equal(received.payloadSha256, jobPayload.payloadSha256);
      return result(jobPayload);
    }
  };
}

function runtimeOptions(input: {
  root: string;
  executor: ProductionSemanticLeasedJobExecutor;
  fetchImpl: typeof fetch;
}): ProjectKingsSemanticWorkerRuntimeOptions {
  return {
    config: {
      serverOrigin: "https://clips.example.test",
      sessionToken: "secret-worker-token",
      workerId: "semantic-worker",
      label: "Semantic worker"
    },
    executor: input.executor,
    appVersion: "1.0.0+runtime.test",
    semanticRuntimeVersion: "semantic-runtime-test-v1",
    spoolRoot: path.join(input.root, "spool"),
    fetchImpl: input.fetchImpl,
    heartbeatIntervalMs: 60_000
  };
}

test("semantic-only runtime claims no render kinds and fails closed before claiming on auth rejection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-runtime-auth-"));
  const jobPayload = payload();
  const calls = { count: 0 };
  let requests = 0;
  try {
    await assert.rejects(
      runProjectKingsSemanticWorkerOnce(
        runtimeOptions({
          root,
          executor: executor(jobPayload, calls),
          fetchImpl: async (_url, init) => {
            requests += 1;
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            assert.equal(JSON.stringify(body).includes("secret-worker-token"), false);
            return new Response(null, { status: 401 });
          }
        })
      ),
      /authentication or lease was rejected/
    );
    assert.equal(requests, 1);
    assert.equal(calls.count, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("completion uncertainty retains a durable result spool and restart completes without a second model call", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-runtime-restart-"));
  const jobPayload = payload();
  const calls = { count: 0 };
  let completionAttempt = 0;
  let claimCount = 0;
  const supportedKinds: unknown[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const pathname = new URL(String(url)).pathname;
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret-worker-token");
    if (pathname.endsWith("/api/stage3/worker/heartbeat")) return Response.json({ ok: true });
    if (pathname.endsWith("/api/stage3/worker/jobs/claim")) {
      claimCount += 1;
      const body = JSON.parse(String(init?.body)) as { supportedKinds: unknown[] };
      supportedKinds.push(...body.supportedKinds);
      return Response.json({
        job: { id: "semantic-job-1", kind: "production-semantic", status: "running" },
        payloadJson: JSON.stringify(jobPayload)
      });
    }
    if (pathname.endsWith("/heartbeat")) return Response.json({ ok: true });
    if (pathname.endsWith("/complete")) {
      completionAttempt += 1;
      return completionAttempt === 1
        ? new Response(null, { status: 502 })
        : Response.json({ ok: true });
    }
    throw new Error(`Unexpected test request ${pathname}`);
  };
  try {
    const options = runtimeOptions({ root, executor: executor(jobPayload, calls), fetchImpl });
    await assert.rejects(
      runProjectKingsSemanticWorkerOnce(options),
      ProductionSemanticCompletionUnknownError
    );
    assert.equal(calls.count, 1);

    const recovered = await runProjectKingsSemanticWorkerOnce(options);
    assert.deepEqual(recovered, {
      status: "completed",
      jobId: "semantic-job-1",
      reusedSpool: true
    });
    assert.equal(calls.count, 1);
    assert.equal(claimCount, 2);
    assert.deepEqual([...new Set(supportedKinds)], ["production-semantic"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic worker config requires a regular 0600 file and never returns extra credential fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-runtime-config-"));
  const configPath = path.join(root, "config.json");
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        serverOrigin: "https://clips.example.test",
        sessionToken: "session-token",
        workerId: "worker-1",
        label: "Semantic",
        accidentalSecret: "must-not-propagate"
      }),
      { mode: 0o644 }
    );
    if (process.platform !== "win32") {
      await assert.rejects(
        readProjectKingsSemanticWorkerConfig({ configPath }),
        /permissions must be 0600/
      );
    }
    await chmod(configPath, 0o600);
    const parsed = await readProjectKingsSemanticWorkerConfig({ configPath });
    assert.deepEqual(parsed, {
      serverOrigin: "https://clips.example.test",
      sessionToken: "session-token",
      workerId: "worker-1",
      label: "Semantic"
    });
    assert.equal("accidentalSecret" in parsed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic supervisor starts three claim lanes while advertising only production-semantic", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-runtime-lanes-"));
  const jobPayload = payload();
  const calls = { count: 0 };
  let claimEntrances = 0;
  let stop = false;
  let releaseClaims!: () => void;
  const claimBarrier = new Promise<void>((resolve) => {
    releaseClaims = resolve;
  });
  const fetchImpl: typeof fetch = async (url, init) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/api/stage3/worker/heartbeat")) return Response.json({ ok: true });
    if (pathname.endsWith("/api/stage3/worker/jobs/claim")) {
      const body = JSON.parse(String(init?.body)) as { supportedKinds: string[] };
      assert.deepEqual(body.supportedKinds, ["production-semantic"]);
      claimEntrances += 1;
      if (claimEntrances === 3) {
        stop = true;
        releaseClaims();
      }
      await claimBarrier;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected test request ${pathname}`);
  };
  try {
    await runProjectKingsSemanticWorkerLoop({
      options: runtimeOptions({ root, executor: executor(jobPayload, calls), fetchImpl }),
      shouldStop: () => stop,
      sleep: async () => undefined
    });
    assert.equal(claimEntrances, 3);
    assert.equal(calls.count, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
