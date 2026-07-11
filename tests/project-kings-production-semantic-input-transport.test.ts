import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, truncate, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as completeWorkerJob } from "../app/api/stage3/worker/jobs/[id]/complete/route";
import { GET as getSemanticInput } from "../app/api/stage3/worker/jobs/[id]/inputs/[inputId]/route";
import { createChannel } from "../lib/chat-history";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  createOrGetProductionRun,
  createProductionItem,
  createProductionProfile,
  ProductionStoreError,
  recordAgentAttempt
} from "../lib/portfolio-production-store";
import type { ProductionAgentArtifact } from "../lib/project-kings/production-agent-contracts";
import {
  openProductionSemanticInput,
  ProductionSemanticInputStoreError,
  releaseProductionSemanticInputReservation,
  resolveProductionSemanticInputPath,
  stageProductionSemanticInputs,
  stageProductionSemanticInputsWithReceipt,
  sweepProductionSemanticInputStore
} from "../lib/project-kings/production-semantic-input-store";
import { enqueueProductionSemanticStage3Job } from "../lib/project-kings/production-semantic-job-enqueue";
import {
  buildProductionSemanticJobPayload,
  buildProductionSemanticJobResult,
  hashProductionSemanticValue,
  PRODUCTION_SEMANTIC_INPUT_AGGREGATE_MAX_BYTES,
  PRODUCTION_SEMANTIC_INPUT_MAX_BYTES,
  type ProductionSemanticJobPayload
} from "../lib/project-kings/production-semantic-job-contract";
import type {
  ProductionAgentAttemptTelemetry,
  ProductionAgentModelSelection
} from "../lib/project-kings/production-agent-runtime";
import { calculateProjectKingsCodexCreditMicros } from "../lib/project-kings/codex-credit-cost";
import {
  claimNextQueuedStage3JobForWorker,
  completeStage3Job,
  enqueueStage3Job,
  getStage3Job
} from "../lib/stage3-job-store";
import {
  exchangeStage3WorkerPairingToken,
  issueStage3WorkerPairingToken
} from "../lib/stage3-worker-store";
import { bootstrapOwner } from "../lib/team-store";

const MANIFEST_SHA = "b".repeat(64);

function sha(buffer: Uint8Array | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function selection(): ProductionAgentModelSelection {
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

function payload(input: {
  runId: string;
  itemId: string;
  refs: Awaited<ReturnType<typeof stageProductionSemanticInputs>>;
}) {
  return buildProductionSemanticJobPayload({
    role: "caption",
    qualityBindingSha256: null,
    routeManifestId: "project-kings-model-routes-v2",
    routeManifestSha256: MANIFEST_SHA,
    selection: selection(),
    packet: {
      schemaVersion: "production-agent-packet-v1",
      role: "caption",
      runId: input.runId,
      itemId: input.itemId,
      channelId: `UC${"c".repeat(22)}`,
      profileVersion: "1",
      task: {
        candidateId: "candidate-1",
        language: "en",
        templateType: "top_bottom",
        maxCharacters: 160,
        bannedWords: ["forbidden"]
      },
      artifacts: input.refs
    }
  });
}

function passedAttempt(jobPayload: ProductionSemanticJobPayload<"caption">): ProductionAgentAttemptTelemetry {
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

function result(jobPayload: ProductionSemanticJobPayload<"caption">) {
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
    workerRuntimeVersion: "clips-worker-test+semantic.2",
    completedAt: "2026-07-10T12:00:02.000Z"
  });
}

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-semantic-inputs-"));
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

function seedWorkspace(workspaceId = "w1", userId = "u1"): void {
  const db = getDb();
  const stamp = nowIso();
  db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(workspaceId, "Semantic transport", `semantic-${workspaceId}`, stamp, stamp);
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, `${userId}@example.com`, "hash", "Semantic", "active", stamp, stamp);
  db.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newId(), workspaceId, userId, "owner", stamp, stamp);
}

async function writeFixtureArtifact(appDataDir: string, content = '{"contract":"exact"}') {
  const sourcePath = path.join(appDataDir, `concept-contract-${sha(content).slice(0, 8)}.json`);
  await writeFile(sourcePath, content);
  const artifact: ProductionAgentArtifact = {
    id: "concept-contract",
    kind: "concept_contract",
    mediaType: "json",
    path: sourcePath,
    sha256: sha(content)
  };
  return { sourcePath, artifact };
}

async function stageFixture(appDataDir: string, content = '{"contract":"exact"}') {
  const { sourcePath, artifact } = await writeFixtureArtifact(appDataDir, content);
  const receipt = await stageProductionSemanticInputsWithReceipt([artifact]);
  return { sourcePath, artifact, refs: [...receipt.refs], reservationId: receipt.reservationId };
}

function canonicalCaptionPacket(input: {
  runId: string;
  itemId: string;
  artifact: ProductionAgentArtifact;
}) {
  return {
    schemaVersion: "production-agent-packet-v1" as const,
    role: "caption" as const,
    runId: input.runId,
    itemId: input.itemId,
    channelId: `UC${"c".repeat(22)}`,
    profileVersion: "1",
    task: {
      candidateId: "candidate-1",
      language: "en",
      templateType: "top_bottom" as const,
      maxCharacters: 160,
      bannedWords: ["forbidden"]
    },
    artifacts: [input.artifact]
  };
}

function pairWorker(workspaceId: string, userId: string, label: string) {
  const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
  return exchangeStage3WorkerPairingToken({
    pairingToken: pairing.token,
    label,
    platform: "darwin-arm64",
    hostname: label.toLowerCase().replaceAll(" ", "-")
  });
}

test("semantic input endpoint serves exact bytes only to the active leased worker", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    seedWorkspace();
    const staged = await stageFixture(appDataDir);
    const jobPayload = payload({ runId: "run-1", itemId: "item-1", refs: staged.refs });
    const ownerWorker = pairWorker("w1", "u1", "Owner worker");
    const otherWorker = pairWorker("w1", "u1", "Other worker");
    const job = enqueueStage3Job({
      workspaceId: "w1",
      userId: "u1",
      kind: "production-semantic",
      executionTarget: "local",
      payloadJson: JSON.stringify(jobPayload)
    });
    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: ownerWorker.worker.id,
      workspaceId: "w1",
      userId: "u1",
      supportedKinds: ["production-semantic"],
      leaseDurationMs: 60_000
    });
    assert.equal(claimed?.id, job.id);
    const url = `http://localhost/api/stage3/worker/jobs/${job.id}/inputs/${staged.refs[0].inputId}`;
    const context = { params: Promise.resolve({ id: job.id, inputId: staged.refs[0].inputId }) };

    const response = await getSemanticInput(new Request(url, {
      headers: { Authorization: `Bearer ${ownerWorker.sessionToken}` }
    }), context);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"contract":"exact"}');
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("x-production-semantic-sha256"), staged.refs[0].sha256);

    const other = await getSemanticInput(new Request(url, {
      headers: { Authorization: `Bearer ${otherWorker.sessionToken}` }
    }), context);
    assert.equal(other.status, 409);

    const traversal = await getSemanticInput(new Request(url, {
      headers: { Authorization: `Bearer ${ownerWorker.sessionToken}` }
    }), { params: Promise.resolve({ id: job.id, inputId: "../../app.db" }) });
    assert.equal(traversal.status, 404);

    getDb().prepare("UPDATE stage3_jobs SET lease_expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", job.id);
    const stale = await getSemanticInput(new Request(url, {
      headers: { Authorization: `Bearer ${ownerWorker.sessionToken}` }
    }), context);
    assert.equal(stale.status, 409);

    getDb().prepare("UPDATE stage3_jobs SET lease_expires_at = ? WHERE id = ?")
      .run("2099-01-01T00:00:00.000Z", job.id);
    const opened = await openProductionSemanticInput(staged.refs[0]);
    opened.stream.destroy();
    await writeFile(opened.filePath, "tampered");
    const drift = await getSemanticInput(new Request(url, {
      headers: { Authorization: `Bearer ${ownerWorker.sessionToken}` }
    }), context);
    assert.equal(drift.status, 409);
    assert.equal((await drift.json() as { code: string }).code, "stored_input_size_mismatch");
  });
});

test("semantic enqueue helper stages canonical artifacts and reuses the exact immutable job", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    seedWorkspace();
    const fixture = await writeFixtureArtifact(appDataDir, '{"helper":"exact"}');
    const packet = canonicalCaptionPacket({ runId: "run-helper", itemId: "item-helper", artifact: fixture.artifact });
    const first = await enqueueProductionSemanticStage3Job({
      workspaceId: "w1",
      userId: "u1",
      role: "caption",
      packet,
      qualityBindingSha256: null,
      routeManifestId: "project-kings-model-routes-v2",
      routeManifestSha256: MANIFEST_SHA,
      selection: selection()
    });
    assert.equal(first.enqueue.outcome, "created");
    assert.equal(first.enqueue.job.kind, "production-semantic");
    assert.equal(first.enqueue.job.executionTarget, "local");
    assert.equal(first.payload.packet.artifacts[0].storageKey, sha('{"helper":"exact"}'));
    assert.equal(first.enqueue.job.payloadJson, JSON.stringify(first.payload));

    const replay = await enqueueProductionSemanticStage3Job({
      workspaceId: "w1",
      userId: "u1",
      role: "caption",
      packet,
      qualityBindingSha256: null,
      routeManifestId: "project-kings-model-routes-v2",
      routeManifestSha256: MANIFEST_SHA,
      selection: selection()
    });
    assert.equal(replay.enqueue.outcome, "reused_in_flight");
    assert.equal(replay.enqueue.job.id, first.enqueue.job.id);
    assert.equal(replay.payload.payloadSha256, first.payload.payloadSha256);

    const ownerRetry = await enqueueProductionSemanticStage3Job({
      workspaceId: "w1",
      userId: "u1",
      role: "caption",
      packet,
      qualityBindingSha256: null,
      routeManifestId: "project-kings-model-routes-v2",
      routeManifestSha256: MANIFEST_SHA,
      selection: selection(),
      dedupeSalt: "a".repeat(32)
    });
    assert.equal(ownerRetry.enqueue.outcome, "created");
    assert.notEqual(ownerRetry.enqueue.job.id, first.enqueue.job.id);
    assert.match(ownerRetry.enqueue.job.dedupeKey ?? "", /:retry:a{32}$/);
  });
});

test("semantic enqueue helper rolls back newly staged content when DB enqueue fails", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    seedWorkspace();
    const fixture = await writeFixtureArtifact(appDataDir, '{"enqueue":"must-rollback"}');
    const storagePath = resolveProductionSemanticInputPath(fixture.artifact.sha256);
    const packet = canonicalCaptionPacket({ runId: "run-fail", itemId: "item-fail", artifact: fixture.artifact });

    await assert.rejects(enqueueProductionSemanticStage3Job({
      workspaceId: "missing-workspace",
      userId: "missing-user",
      role: "caption",
      packet,
      routeManifestId: "project-kings-model-routes-v2",
      routeManifestSha256: MANIFEST_SHA,
      selection: selection()
    }));
    await assert.rejects(access(storagePath));
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM stage3_jobs WHERE kind = 'production-semantic'").get() as { count: number }).count,
      0
    );
  });
});

test("semantic enqueue helper rejects uncovered source_policy before staging", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    seedWorkspace();
    const fixture = await writeFixtureArtifact(appDataDir, '{"role":"source-policy"}');
    const storagePath = resolveProductionSemanticInputPath(fixture.artifact.sha256);
    const packet = canonicalCaptionPacket({ runId: "run-role", itemId: "item-role", artifact: fixture.artifact });
    await assert.rejects(
      enqueueProductionSemanticStage3Job({
        workspaceId: "w1",
        userId: "u1",
        role: "source_policy",
        packet: { ...packet, role: "source_policy" },
        routeManifestId: "project-kings-model-routes-v2",
        routeManifestSha256: MANIFEST_SHA,
        selection: selection()
      } as unknown as Parameters<typeof enqueueProductionSemanticStage3Job>[0]),
      /not covered by the production-semantic transport contract/
    );
    await assert.rejects(access(storagePath));
  });
});

test("semantic completion rejects artifacts, empty or drifted results before completing", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    seedWorkspace();
    const staged = await stageFixture(appDataDir);
    const jobPayload = payload({ runId: "run-1", itemId: "item-1", refs: staged.refs });
    const worker = pairWorker("w1", "u1", "Completion worker");
    const job = enqueueStage3Job({
      workspaceId: "w1", userId: "u1", kind: "production-semantic", executionTarget: "local",
      payloadJson: JSON.stringify(jobPayload)
    });
    claimNextQueuedStage3JobForWorker({
      workerId: worker.worker.id, workspaceId: "w1", userId: "u1",
      supportedKinds: ["production-semantic"], leaseDurationMs: 60_000
    });
    const context = { params: Promise.resolve({ id: job.id }) };
    const url = `http://localhost/api/stage3/worker/jobs/${job.id}/complete`;
    const auth = { Authorization: `Bearer ${worker.sessionToken}` };

    const artifact = await completeWorkerJob(new Request(url, {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "video/mp4",
        "x-stage3-artifact-name": "unexpected.mp4"
      },
      body: Buffer.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70])
    }), context);
    assert.equal(artifact.status, 400);
    assert.equal(getStage3Job(job.id)?.status, "running");

    const empty = await completeWorkerJob(new Request(url, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ resultJson: "" })
    }), context);
    assert.equal(empty.status, 400);
    assert.equal(getStage3Job(job.id)?.status, "running");

    const tampered = structuredClone(result(jobPayload)) as any;
    tampered.output.title = "Bound to no hash";
    const invalid = await completeWorkerJob(new Request(url, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ resultJson: JSON.stringify(tampered) })
    }), context);
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json() as { code: string }).code, "production_semantic_completion_invalid");
    assert.equal(getStage3Job(job.id)?.status, "running");

    const foreignPayload = payload({ runId: "run-1", itemId: "item-other", refs: staged.refs });
    const foreign = await completeWorkerJob(new Request(url, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ resultJson: JSON.stringify(result(foreignPayload)) })
    }), context);
    assert.equal(foreign.status, 422);
    assert.equal(getStage3Job(job.id)?.status, "running");

    const rogue = structuredClone(result(jobPayload)) as any;
    rogue.selectedRouteId = "rogue-route";
    rogue.attempts[0] = {
      ...rogue.attempts[0],
      routeId: "rogue-route",
      provider: "rogue-provider",
      model: "unapproved-model",
      reasoningEffort: "x-high",
      benchmarkVersion: "rogue-benchmark",
      timeoutMs: 3_600_000
    };
    const { resultSha256: _ignored, ...rogueUnsigned } = rogue;
    rogue.resultSha256 = hashProductionSemanticValue(rogueUnsigned);
    const rogueRoute = await completeWorkerJob(new Request(url, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ resultJson: JSON.stringify(rogue) })
    }), context);
    assert.equal(rogueRoute.status, 422);
    assert.equal(getStage3Job(job.id)?.status, "running");

    const completed = await completeWorkerJob(new Request(url, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ resultJson: JSON.stringify(result(jobPayload)) })
    }), context);
    assert.equal(completed.status, 200);
    assert.equal(getStage3Job(job.id)?.status, "completed");
    assert.equal(getStage3Job(job.id)?.artifact, null);

    const replay = await completeWorkerJob(new Request(url, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ resultJson: JSON.stringify(result(jobPayload)) })
    }), context);
    assert.equal(replay.status, 200);

    const otherWorker = pairWorker("w1", "u1", "Completion replay attacker");
    const otherReplay = await completeWorkerJob(new Request(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${otherWorker.sessionToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ resultJson: JSON.stringify(result(jobPayload)) })
    }), context);
    assert.equal(otherReplay.status, 409);

    getDb().prepare("UPDATE stage3_jobs SET result_json = NULL WHERE id = ?").run(job.id);
    const corruptedReplay = await completeWorkerJob(new Request(url, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ resultJson: JSON.stringify(result(jobPayload)) })
    }), context);
    assert.equal(corruptedReplay.status, 422);
  });
});

test("semantic input staging enforces per-file and aggregate bounds before copying", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const wrongHashPath = path.join(appDataDir, "wrong-hash.json");
    await writeFile(wrongHashPath, "exact bytes");
    await assert.rejects(
      stageProductionSemanticInputs([{
        id: "wrong-hash", kind: "source_metadata", mediaType: "json", path: wrongHashPath, sha256: "a".repeat(64)
      }]),
      (error) => error instanceof ProductionSemanticInputStoreError && error.code === "source_hash_mismatch"
    );

    const firstValid = await writeFixtureArtifact(appDataDir, '{"partial":"first"}');
    await assert.rejects(
      stageProductionSemanticInputs([
        firstValid.artifact,
        { id: "second-wrong", kind: "source_metadata", mediaType: "json", path: wrongHashPath, sha256: "a".repeat(64) }
      ]),
      (error) => error instanceof ProductionSemanticInputStoreError && error.code === "source_hash_mismatch"
    );
    await assert.rejects(access(resolveProductionSemanticInputPath(firstValid.artifact.sha256)));

    const oversized = path.join(appDataDir, "oversized.json");
    await writeFile(oversized, "x");
    await truncate(oversized, PRODUCTION_SEMANTIC_INPUT_MAX_BYTES + 1);
    await assert.rejects(
      stageProductionSemanticInputs([{
        id: "oversized", kind: "source_metadata", mediaType: "json", path: oversized, sha256: "a".repeat(64)
      }]),
      (error) => error instanceof ProductionSemanticInputStoreError && error.code === "input_too_large"
    );

    const aggregateArtifacts: ProductionAgentArtifact[] = [];
    const eachSize = Math.floor(PRODUCTION_SEMANTIC_INPUT_AGGREGATE_MAX_BYTES / 6) + 1;
    for (let index = 0; index < 6; index += 1) {
      const filePath = path.join(appDataDir, `aggregate-${index}.json`);
      await writeFile(filePath, "x");
      await truncate(filePath, eachSize);
      aggregateArtifacts.push({
        id: `aggregate-${index}`,
        kind: "source_metadata",
        mediaType: "json",
        path: filePath,
        sha256: "a".repeat(64)
      });
    }
    await assert.rejects(
      stageProductionSemanticInputs(aggregateArtifacts),
      (error) => error instanceof ProductionSemanticInputStoreError && error.code === "aggregate_too_large"
    );
  });
});

test("semantic input GC retains shared active refs and removes only old terminal refs", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    seedWorkspace();
    const staged = await stageFixture(appDataDir);
    const jobPayload = payload({ runId: "run-1", itemId: "item-1", refs: staged.refs });
    const active = enqueueStage3Job({
      workspaceId: "w1", userId: "u1", kind: "production-semantic", executionTarget: "local",
      payloadJson: JSON.stringify(jobPayload)
    });
    const old = enqueueStage3Job({
      workspaceId: "w1", userId: "u1", kind: "production-semantic", executionTarget: "local",
      payloadJson: JSON.stringify(jobPayload)
    });
    completeStage3Job(old.id, { resultJson: JSON.stringify(result(jobPayload)) });
    releaseProductionSemanticInputReservation(staged.reservationId);
    getDb().prepare("UPDATE stage3_jobs SET completed_at = ?, updated_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", old.id);
    const opened = await openProductionSemanticInput(staged.refs[0]);
    opened.stream.destroy();

    const retained = await sweepProductionSemanticInputStore({
      now: new Date("2026-07-10T00:00:00.000Z"), retentionMs: 1_000
    });
    assert.equal(retained.removed.length, 0);
    await access(opened.filePath);

    getDb().prepare("UPDATE stage3_jobs SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", active.id);
    const removed = await sweepProductionSemanticInputStore({
      now: new Date("2026-07-10T00:00:00.000Z"), retentionMs: 1_000
    });
    assert.equal(removed.removed.length, 1);
    await assert.rejects(access(opened.filePath));
  });
});

test("durable staging reservation fences GC until semantic enqueue is durable", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    seedWorkspace();
    const fixture = await writeFixtureArtifact(appDataDir, '{"gc":"reservation"}');
    const oldReceipt = await stageProductionSemanticInputsWithReceipt([fixture.artifact]);
    const oldPayload = payload({ runId: "run-old", itemId: "item-old", refs: [...oldReceipt.refs] });
    const old = enqueueStage3Job({
      workspaceId: "w1", userId: "u1", kind: "production-semantic", executionTarget: "local",
      payloadJson: JSON.stringify(oldPayload)
    });
    completeStage3Job(old.id, { resultJson: JSON.stringify(result(oldPayload)) });
    getDb().prepare("UPDATE stage3_jobs SET completed_at = ?, updated_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", old.id);
    releaseProductionSemanticInputReservation(oldReceipt.reservationId);

    const nextReceipt = await stageProductionSemanticInputsWithReceipt([fixture.artifact]);
    const storagePath = resolveProductionSemanticInputPath(nextReceipt.refs[0].storageKey);
    const duringStaging = await sweepProductionSemanticInputStore({
      now: new Date(), retentionMs: 1_000
    });
    assert.equal(duringStaging.removed.length, 0);
    await access(storagePath);

    const nextPayload = payload({ runId: "run-next", itemId: "item-next", refs: [...nextReceipt.refs] });
    const next = enqueueStage3Job({
      workspaceId: "w1", userId: "u1", kind: "production-semantic", executionTarget: "local",
      payloadJson: JSON.stringify(nextPayload)
    });
    releaseProductionSemanticInputReservation(nextReceipt.reservationId);
    assert.equal(getStage3Job(next.id)?.status, "queued");
    const afterEnqueue = await sweepProductionSemanticInputStore({ now: new Date(), retentionMs: 1_000 });
    assert.equal(afterEnqueue.removed.length, 0);
    await access(storagePath);
  });
});

test("agent attempt telemetry binds to an exact completed semantic Stage 3 job", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const owner = await bootstrapOwner({
      workspaceName: "Semantic telemetry",
      email: "semantic-telemetry@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Semantic telemetry",
      username: "semantic-telemetry"
    });
    const profile = createProductionProfile({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      version: 1,
      status: "active",
      profileHash: "1".repeat(64),
      expectedYoutubeChannelId: `UC${"t".repeat(22)}`,
      expectedDestinationTitle: "Semantic telemetry",
      templateId: "template-1",
      templateSnapshotSha256: "2".repeat(64),
      publishPolicyId: "policy-1",
      qualityPolicyId: "quality-1",
      modelRouteManifestId: "models-1",
      modelRouteManifestSha256: "3".repeat(64),
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
      portfolioProfileHash: "4".repeat(64),
      logicalDate: "2026-07-10",
      mode: "simulation",
      targetPerChannel: 1,
      manifestHash: "5".repeat(64),
      manifest: { profileIds: [profile.id] },
      idempotencyKey: "semantic-telemetry-run",
      channels: [{
        channelId: channel.id,
        profileId: profile.id,
        profileVersion: profile.version,
        profileHash: profile.profileHash,
        expectedYoutubeChannelId: profile.expectedYoutubeChannelId
      }]
    });
    const runChannel = getDb().prepare("SELECT id FROM production_run_channels WHERE run_id = ? LIMIT 1")
      .get(createdRun.run.id) as { id: string };
    const item = createProductionItem({ runId: createdRun.run.id, runChannelId: runChannel.id, itemSlot: 1 });
    const staged = await stageFixture(appDataDir, '{"telemetry":"bound"}');
    const jobPayload = payload({ runId: createdRun.run.id, itemId: item.id, refs: staged.refs });
    const semanticJob = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "production-semantic",
      executionTarget: "local",
      payloadJson: JSON.stringify(jobPayload)
    });
    completeStage3Job(semanticJob.id, { resultJson: JSON.stringify(result(jobPayload)) });
    releaseProductionSemanticInputReservation(staged.reservationId);

    const exactTelemetry = passedAttempt(jobPayload);
    const exactCostMicros = calculateProjectKingsCodexCreditMicros({
      model: exactTelemetry.model,
      usage: exactTelemetry.usage!
    });
    const exactAttemptInput = {
      workspaceId: item.workspaceId,
      runId: item.runId,
      productionItemId: item.id,
      stage3JobId: semanticJob.id,
      role: "caption",
      model: exactTelemetry.model,
      reasoningLevel: exactTelemetry.reasoningEffort,
      promptHash: exactTelemetry.promptSha256,
      outputHash: exactTelemetry.outputSha256,
      artifactIds: staged.refs.map((ref) => ref.id),
      status: "passed" as const,
      outcome: "passed",
      verdict: "pass",
      errorCode: null,
      inputTokens: exactTelemetry.usage!.inputTokens,
      outputTokens: exactTelemetry.usage!.outputTokens,
      cachedInputTokens: exactTelemetry.usage!.cachedInputTokens,
      reasoningOutputTokens: exactTelemetry.usage!.reasoningOutputTokens,
      costMicros: exactCostMicros,
      costUnit: "codex_credits" as const,
      durationMs: Math.round(exactTelemetry.durationMs),
      startedAt: exactTelemetry.startedAt,
      finishedAt: "2026-07-10T12:00:01.250Z"
    };

    const recorded = recordAgentAttempt({
      ...exactAttemptInput,
      attemptNo: 1,
    });
    assert.equal(recorded.stage3JobId, semanticJob.id);
    assert.equal(recorded.inputTokens, exactTelemetry.usage!.inputTokens);
    assert.equal(recorded.durationMs, Math.round(exactTelemetry.durationMs));
    assert.equal(recorded.costMicros, exactCostMicros);

    assert.throws(() => recordAgentAttempt({
      ...exactAttemptInput,
      attemptNo: 2
    }), (error) => error instanceof ProductionStoreError && error.code === "uniqueness_conflict");

    assert.throws(() => recordAgentAttempt({
      ...exactAttemptInput,
      attemptNo: 2,
      model: "different-model",
    }), (error) => error instanceof ProductionStoreError && error.code === "invalid_input");
    assert.throws(() => recordAgentAttempt({
      ...exactAttemptInput,
      attemptNo: 2,
      inputTokens: exactTelemetry.usage!.inputTokens + 1
    }), (error) => error instanceof ProductionStoreError && error.code === "invalid_input");
    assert.throws(() => recordAgentAttempt({
      ...exactAttemptInput,
      attemptNo: 2,
      status: "timed_out"
    }), (error) => error instanceof ProductionStoreError && error.code === "invalid_input");
  });
});
