import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel } from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import {
  classifyPortfolioLiveWorkers
} from "../lib/portfolio-production-live-preflight";
import {
  runPortfolioProductionSemanticStage3Agent,
  type PortfolioLiveRuntimeOptions,
  type ProductionAgentSelections
} from "../lib/portfolio-production-live-runtime";
import {
  createOrGetProductionRun,
  createProductionItem,
  createProductionProfile,
  listAgentAttempts
} from "../lib/portfolio-production-store";
import {
  buildProductionSemanticJobResult,
  type ProductionSemanticJobPayload
} from "../lib/project-kings/production-semantic-job-contract";
import type {
  ProductionAgentAttemptTelemetry,
  ProductionAgentModelSelection
} from "../lib/project-kings/production-agent-runtime";
import {
  completeStage3Job,
  getStage3Job,
  type Stage3JobRecord
} from "../lib/stage3-job-store";
import type { Stage3WorkerRecord } from "../lib/stage3-worker-store";
import { bootstrapOwner } from "../lib/team-store";

const MANIFEST_ID = "project-kings-model-routes-v2";
const MANIFEST_SHA256 = "b".repeat(64);

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function captionSelection(): ProductionAgentModelSelection {
  const route = (routeId: string, fallbackRouteIds: string[], meanCost: number) => ({
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
      benchmarkVersion: "semantic-benchmark-v1",
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

function captionResult(payload: ProductionSemanticJobPayload<"caption">) {
  const output = {
    decision: "PASS" as const,
    caption: "A concise factual caption",
    title: "A factual title",
    hook: "Watch this",
    action: "The subject completes the action",
    payoff: "The result is visible",
    factualClaims: [] as string[],
    bannedWordsFound: [] as string[]
  };
  const primaryAttempt: ProductionAgentAttemptTelemetry = {
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
    durationMs: 100,
    promptSha256: payload.promptSha256,
    outputSha256: null,
    usage: null,
    outcome: "invoke_error",
    error: "primary unavailable"
  };
  const fallbackAttempt: ProductionAgentAttemptTelemetry = {
    ...primaryAttempt,
    attempt: 2,
    routeId: "caption-fallback",
    model: "gpt-5.4",
    startedAt: "2026-07-10T12:00:00.100Z",
    durationMs: 1_250,
    outputSha256: sha(JSON.stringify(output)),
    usage: {
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
      reasoningOutputTokens: 10
    },
    outcome: "passed",
    error: null
  };
  return buildProductionSemanticJobResult({
    payload,
    selectedRouteId: "caption-fallback",
    output,
    attempts: [primaryAttempt, fallbackAttempt],
    workerRuntimeVersion: "project-kings-semantic-worker-test-v1",
    completedAt: "2026-07-10T12:00:02.000Z"
  });
}

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-live-semantic-transport-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run(appDataDir);
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("live semantic runtime reuses one exact Stage 3 completion and records bound telemetry once", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const owner = await bootstrapOwner({
      workspaceName: "Live semantic transport",
      email: "live-semantic@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Live semantic transport",
      username: "live-semantic-transport"
    });
    const profile = createProductionProfile({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      version: 1,
      status: "active",
      profileHash: "1".repeat(64),
      expectedYoutubeChannelId: `UC${"t".repeat(22)}`,
      expectedDestinationTitle: "Live semantic transport",
      templateId: "template-1",
      templateSnapshotSha256: "2".repeat(64),
      publishPolicyId: "policy-1",
      qualityPolicyId: "quality-1",
      modelRouteManifestId: MANIFEST_ID,
      modelRouteManifestSha256: MANIFEST_SHA256,
      targetPerLogicalDay: 1,
      readyBufferMin: 1,
      readyBufferCap: 2,
      candidateAttemptBudget: 3,
      config: {},
      approvedAt: "2026-07-10T00:00:00.000Z",
      approvedByUserId: owner.user.id
    });
    const createdRun = createOrGetProductionRun({
      workspaceId: owner.workspace.id,
      portfolioProfileHash: "3".repeat(64),
      logicalDate: "2026-07-10",
      mode: "simulation",
      targetPerChannel: 1,
      manifestHash: "4".repeat(64),
      manifest: { profileIds: [profile.id] },
      idempotencyKey: "live-semantic-transport-run",
      channels: [{
        channelId: channel.id,
        profileId: profile.id,
        profileVersion: profile.version,
        profileHash: profile.profileHash,
        expectedYoutubeChannelId: profile.expectedYoutubeChannelId
      }]
    });
    const runChannel = getDb()
      .prepare("SELECT id FROM production_run_channels WHERE run_id = ? LIMIT 1")
      .get(createdRun.run.id) as { id: string };
    const item = createProductionItem({
      runId: createdRun.run.id,
      runChannelId: runChannel.id,
      itemSlot: 1
    });
    const artifactPath = path.join(appDataDir, "concept-contract.json");
    const artifactContent = "{\"concept\":\"transport\"}\n";
    await writeFile(artifactPath, artifactContent, "utf8");
    const packet = {
      schemaVersion: "production-agent-packet-v1" as const,
      role: "caption" as const,
      runId: item.runId,
      itemId: item.id,
      channelId: item.expectedYoutubeChannelId,
      profileVersion: "1",
      task: {
        candidateId: "candidate-1",
        language: "en" as const,
        templateType: "top_bottom" as const,
        maxCharacters: 160,
        bannedWords: ["forbidden"]
      },
      artifacts: [{
        id: "concept-contract",
        kind: "concept_contract" as const,
        mediaType: "json" as const,
        path: artifactPath,
        sha256: sha(artifactContent)
      }]
    };
    const options: PortfolioLiveRuntimeOptions = {
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      routeManifestId: MANIFEST_ID,
      routeManifestSha256: MANIFEST_SHA256,
      selections: { caption: captionSelection() } as ProductionAgentSelections
    };
    let workerCompletions = 0;
    const waitForJob = async (jobId: string): Promise<Stage3JobRecord> => {
      const job = getStage3Job(jobId);
      assert.ok(job);
      if (job.status !== "completed") {
        const payload = JSON.parse(job.payloadJson) as ProductionSemanticJobPayload<"caption">;
        completeStage3Job(job.id, {
          resultJson: JSON.stringify(captionResult(payload))
        });
        workerCompletions += 1;
      }
      return getStage3Job(jobId)!;
    };

    const first = await runPortfolioProductionSemanticStage3Agent({
      role: "caption",
      packet,
      item,
      options,
      dependencies: { waitForJob }
    });
    const replay = await runPortfolioProductionSemanticStage3Agent({
      role: "caption",
      packet,
      item,
      options,
      dependencies: { waitForJob }
    });
    await assert.rejects(
      runPortfolioProductionSemanticStage3Agent({
        role: "caption",
        packet,
        item,
        options: { ...options, workspaceId: "wrong-workspace" },
        dependencies: { waitForJob }
      }),
      /exact item\/workspace scope/
    );

    const jobs = getDb()
      .prepare("SELECT id, payload_json FROM stage3_jobs WHERE kind = 'production-semantic'")
      .all() as Array<{ id: string; payload_json: string }>;
    const attempts = listAgentAttempts({
      runId: item.runId,
      productionItemId: item.id
    });
    assert.equal(workerCompletions, 1);
    assert.equal(jobs.length, 1);
    assert.equal(attempts.length, 2);
    assert.equal(first.successfulAttempt.id, replay.successfulAttempt.id);
    assert.equal(first.successfulAttempt.stage3JobId, jobs[0]!.id);
    assert.equal(first.successfulAttempt.model, "gpt-5.4");
    assert.ok(attempts.every((attempt) => attempt.stage3JobId === jobs[0]!.id));
    assert.equal(first.output.title, "A factual title");
    const payload = JSON.parse(jobs[0]!.payload_json) as ProductionSemanticJobPayload<"caption">;
    assert.equal(payload.routeManifestId, MANIFEST_ID);
    assert.equal(payload.routeManifestSha256, MANIFEST_SHA256);
    assert.deepEqual(payload.selection, captionSelection());
  });
});

test("preflight distinguishes the semantic-only worker from the render worker", () => {
  const stamp = new Date().toISOString();
  const worker = (input: {
    id: string;
    capabilities: Record<string, unknown>;
  }): Stage3WorkerRecord => ({
    id: input.id,
    workspaceId: "workspace-1",
    userId: "owner-1",
    label: input.id,
    platform: "darwin-arm64",
    hostname: "zoro.local",
    appVersion: "worker-v1",
    status: "online",
    lastSeenAt: stamp,
    currentJobId: null,
    currentJobKind: null,
    capabilitiesJson: JSON.stringify(input.capabilities),
    revokedAt: null,
    createdAt: stamp,
    updatedAt: stamp
  });
  const readiness = {
    ready: true,
    code: "ready",
    message: "ready",
    jobSchemaVersion: "project-kings-semantic-job-v1",
    resultSchemaVersion: "project-kings-semantic-result-v1"
  } as const;
  const classified = classifyPortfolioLiveWorkers([
    worker({ id: "render-worker", capabilities: { ffmpeg: true } }),
    worker({
      id: "semantic-worker",
      capabilities: {
        workerClass: "project-kings-semantic-only-v1",
        productionSemantic: readiness
      }
    })
  ]);
  assert.deepEqual(classified.renderWorkerIds, ["render-worker"]);
  assert.deepEqual(classified.semanticWorkerIds, ["semantic-worker"]);

  const unready = classifyPortfolioLiveWorkers([
    worker({
      id: "semantic-worker-unready",
      capabilities: {
        workerClass: "project-kings-semantic-only-v1",
        productionSemantic: { ...readiness, ready: false, code: "preflight_failed" }
      }
    })
  ]);
  assert.deepEqual(unready.renderWorkerIds, []);
  assert.deepEqual(unready.semanticWorkerIds, []);
});
