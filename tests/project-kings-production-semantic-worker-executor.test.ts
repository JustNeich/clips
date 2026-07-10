import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ProductionReadyAgentRouteManifest } from "../lib/project-kings/production-model-route-manifest";
import {
  createProductionSemanticWorkerExecutor,
  downloadLeasedProductionSemanticInput
} from "../lib/project-kings/production-semantic-worker-executor";
import {
  buildProductionSemanticJobPayload,
  PRODUCTION_SEMANTIC_JOB_ROLES,
  type ProductionSemanticJobPayload
} from "../lib/project-kings/production-semantic-job-contract";
import type {
  ProductionAgentAttemptTelemetry,
  ProductionAgentModelSelection
} from "../lib/project-kings/production-agent-runtime";
import {
  createCodexProductionAgentInvoker,
  ProductionAgentRunError,
  runProductionSemanticAgent
} from "../lib/project-kings/production-agent-runtime";

function sha(value: string | Uint8Array): string {
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
      benchmarkVersion: "semantic-worker-test-v1",
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

function payload(content: string): ProductionSemanticJobPayload<"caption"> {
  const digest = sha(content);
  return buildProductionSemanticJobPayload({
    role: "caption",
    qualityBindingSha256: null,
    routeManifestId: "semantic-worker-routes-v2",
    routeManifestSha256: "b".repeat(64),
    selection: selection(),
    packet: {
      schemaVersion: "production-agent-packet-v1",
      role: "caption",
      runId: "run-semantic-worker",
      itemId: "item-semantic-worker",
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
          inputId: "concept-contract",
          id: "concept-contract",
          kind: "concept_contract",
          mediaType: "json",
          fileName: "concept-contract.json",
          sizeBytes: Buffer.byteLength(content),
          sha256: digest,
          storageKey: digest
        }
      ]
    }
  });
}

function manifest(jobPayload: ProductionSemanticJobPayload<"caption">): ProductionReadyAgentRouteManifest {
  const selections = Object.fromEntries(
    PRODUCTION_SEMANTIC_JOB_ROLES.map((role) => [role, jobPayload.selection])
  ) as unknown as ProductionReadyAgentRouteManifest["selections"];
  return {
    schemaVersion: 2,
    manifestId: jobPayload.routeManifestId,
    createdAt: "2026-07-10T12:00:00.000Z",
    manifestSha256: jobPayload.routeManifestSha256,
    selections,
    evidence: {} as ProductionReadyAgentRouteManifest["evidence"]
  };
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
    benchmarkVersion: "semantic-worker-test-v1",
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

test("semantic executor preflight fails closed when enablement or local Codex login is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-executor-auth-"));
  try {
    let loginCalls = 0;
    const disabled = createProductionSemanticWorkerExecutor({
      serverOrigin: "https://clips.example.test",
      sessionToken: "never-log-this-token",
      codexHome: path.join(root, "codex"),
      routeManifestPath: path.join(root, "manifest.json"),
      workRoot: path.join(root, "work"),
      workerRuntimeVersion: "semantic-test-v1",
      enabled: false,
      dependencies: {
        ensureLoggedIn: async () => {
          loginCalls += 1;
        }
      }
    });
    const disabledReadiness = await disabled.preflight();
    assert.equal(disabledReadiness.ready, false);
    assert.equal(disabledReadiness.code, "preflight_failed");
    assert.equal(loginCalls, 0);
    assert.doesNotMatch(disabledReadiness.message, /never-log-this-token/);

    const loggedOut = createProductionSemanticWorkerExecutor({
      serverOrigin: "https://clips.example.test",
      sessionToken: "never-log-this-token",
      codexHome: path.join(root, "codex"),
      routeManifestPath: path.join(root, "manifest.json"),
      workRoot: path.join(root, "work"),
      workerRuntimeVersion: "semantic-test-v1",
      enabled: true,
      dependencies: {
        ensureLoggedIn: async () => {
          throw new Error("Not logged in: never-log-this-token");
        }
      }
    });
    const loggedOutReadiness = await loggedOut.preflight();
    assert.equal(loggedOutReadiness.ready, false);
    assert.doesNotMatch(loggedOutReadiness.message, /never-log-this-token/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic worker preflight rejects any non-Codex semantic route", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-executor-provider-"));
  const jobPayload = payload("exact");
  const externalManifest = structuredClone(manifest(jobPayload));
  (externalManifest.selections.caption.primary.route as { provider: string }).provider = "anthropic";
  try {
    const executor = createProductionSemanticWorkerExecutor({
      serverOrigin: "https://clips.example.test",
      sessionToken: "worker-token",
      codexHome: path.join(root, "codex"),
      routeManifestPath: path.join(root, "manifest.json"),
      workRoot: path.join(root, "work"),
      workerRuntimeVersion: "semantic-test-v1",
      enabled: true,
      dependencies: {
        ensureLoggedIn: async () => undefined,
        loadManifest: async () => externalManifest
      }
    });
    const readiness = await executor.preflight();
    assert.equal(readiness.ready, false);
    assert.match(readiness.message, /locally authenticated Codex provider/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("leased input downloader rejects size/SHA drift before materializing bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-input-hash-"));
  const expected = "exact input";
  const jobPayload = payload(expected);
  const ref = jobPayload.packet.artifacts[0]!;
  const destination = path.join(root, "artifact.json");
  try {
    await assert.rejects(
      downloadLeasedProductionSemanticInput({
        serverOrigin: "https://clips.example.test",
        sessionToken: "secret-worker-token",
        jobId: "job-1",
        ref,
        destinationPath: destination,
        fetchImpl: async (_url, init) => {
          assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer secret-worker-token");
          const tampered = "short";
          return new Response(tampered, {
            headers: {
              "content-length": String(Buffer.byteLength(tampered)),
              "x-production-semantic-input-id": ref.inputId,
              "x-production-semantic-sha256": ref.sha256
            }
          });
        }
      }),
      /headers do not match/
    );
    await assert.rejects(access(destination));

    const sameSizeTampered = "exact inpuX";
    assert.equal(Buffer.byteLength(sameSizeTampered), ref.sizeBytes);
    await assert.rejects(
      downloadLeasedProductionSemanticInput({
        serverOrigin: "https://clips.example.test",
        sessionToken: "secret-worker-token",
        jobId: "job-1",
        ref,
        destinationPath: destination,
        fetchImpl: async () =>
          new Response(sameSizeTampered, {
            headers: {
              "content-length": String(ref.sizeBytes),
              "x-production-semantic-input-id": ref.inputId,
              "x-production-semantic-sha256": ref.sha256
            }
          })
      }),
      /SHA-256 mismatch/
    );
    await assert.rejects(access(destination));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executor downloads exact leased inputs, builds a local typed packet and validates the result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-executor-run-"));
  const content = '{"concept":"exact"}';
  const jobPayload = payload(content);
  let observedArtifactPath = "";
  try {
    const executor = createProductionSemanticWorkerExecutor({
      serverOrigin: "https://clips.example.test",
      sessionToken: "worker-token",
      codexHome: path.join(root, "codex"),
      routeManifestPath: path.join(root, "manifest.json"),
      workRoot: path.join(root, "work"),
      workerRuntimeVersion: "semantic-test-v1",
      enabled: true,
      dependencies: {
        ensureLoggedIn: async () => undefined,
        loadManifest: async () => manifest(jobPayload),
        fetchImpl: async () =>
          new Response(content, {
            headers: {
              "content-length": String(Buffer.byteLength(content)),
              "x-production-semantic-input-id": "concept-contract",
              "x-production-semantic-sha256": sha(content)
            }
          }),
        runAgent: (async (input: any) => {
          observedArtifactPath = input.packet.artifacts[0].path;
          assert.equal(await readFile(observedArtifactPath, "utf-8"), content);
          return {
            role: "caption",
            selectedRouteId: "caption-primary",
            output: {
              decision: "PASS",
              caption: "Exact factual caption",
              title: "Exact title",
              hook: "Hook",
              action: "Action",
              payoff: "Payoff",
              factualClaims: [],
              bannedWordsFound: []
            },
            attempts: [passedAttempt(jobPayload)]
          };
        }) as any,
        now: () => new Date("2026-07-10T12:00:02.000Z")
      }
    });
    assert.equal((await executor.preflight()).ready, true);
    const result = await executor.executeLeasedJob("leased-job-1", jobPayload);
    assert.equal(result.output.decision, "PASS");
    assert.equal(result.workerRuntimeVersion, "semantic-test-v1");
    assert.match(observedArtifactPath, /leased-semantic-/);
    await assert.rejects(access(observedArtifactPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executor rejects a payload whose selection differs from the local frozen manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-executor-manifest-"));
  const jobPayload = payload("exact");
  const drifted = structuredClone(jobPayload.selection);
  (drifted as { primary: { benchmark: { meanCost: number } } }).primary.benchmark.meanCost += 1;
  try {
    const executor = createProductionSemanticWorkerExecutor({
      serverOrigin: "https://clips.example.test",
      sessionToken: "worker-token",
      codexHome: path.join(root, "codex"),
      routeManifestPath: path.join(root, "manifest.json"),
      workRoot: path.join(root, "work"),
      workerRuntimeVersion: "semantic-test-v1",
      enabled: true,
      dependencies: {
        ensureLoggedIn: async () => undefined,
        loadManifest: async () => ({
          ...manifest(jobPayload),
          selections: {
            ...manifest(jobPayload).selections,
            caption: drifted
          }
        })
      }
    });
    assert.equal((await executor.preflight()).ready, true);
    await assert.rejects(
      executor.executeLeasedJob("leased-job-1", jobPayload),
      /differs from the locally frozen route manifest/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic Codex adapter carries lease-abort signal into the model process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-executor-abort-"));
  const artifactPath = path.join(root, "concept.json");
  const content = "{}";
  const controller = new AbortController();
  const leaseLost = new Error("lease lost");
  let modelCalls = 0;
  await writeFile(artifactPath, content);
  try {
    const invoker = createCodexProductionAgentInvoker({
      repoCwd: root,
      codexHome: path.join(root, "codex"),
      tempRoot: root,
      signal: controller.signal,
      runCodex: async (input) => {
        modelCalls += 1;
        assert.equal(input.signal, controller.signal);
        controller.abort(leaseLost);
        throw leaseLost;
      }
    });
    await assert.rejects(
      runProductionSemanticAgent({
        role: "caption",
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
              id: "concept",
              kind: "concept_contract",
              mediaType: "json",
              path: artifactPath,
              sha256: sha(content)
            }
          ]
        },
        selection: selection(),
        invoker,
        maxAttempts: 2
      }),
      (error: unknown) =>
        error instanceof ProductionAgentRunError &&
        error.attempts.length === 1 &&
        /canceled after the job lease ended/.test(error.attempts[0]?.error ?? "")
    );
    assert.equal(modelCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
