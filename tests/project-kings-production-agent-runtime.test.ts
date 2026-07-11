import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PRODUCTION_AGENT_OUTPUT_SCHEMAS,
  PRODUCTION_AGENT_ROLES,
  ProductionAgentContractError,
  buildProductionAgentPrompt,
  validateProductionAgentOutput,
  validateProductionAgentPacket,
  type RevisionPacket,
  type SourceFitPacket,
  type SourceSearchOutput,
  type SourceSearchPacket,
  type VisionQaOutput,
  type VisionQaPacket
} from "../lib/project-kings/production-agent-contracts";
import {
  ProductionAgentConfigurationError,
  ProductionAgentRunError,
  createCodexProductionAgentInvoker,
  runProductionSemanticAgent,
  type ProductionAgentModelSelection
} from "../lib/project-kings/production-agent-runtime";

const CHANNEL_ID = "UC1234567890123456789012";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const USAGE = {
  inputTokens: 120,
  cachedInputTokens: 80,
  outputTokens: 24,
  reasoningOutputTokens: 7
};

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function selection(options: { vision?: boolean; authorizeFallback?: boolean } = {}): ProductionAgentModelSelection {
  const route = (
    routeId: string,
    model: string,
    fallbackRouteIds: string[],
    meanCost: number
  ) => ({
    route: {
      routeId,
      provider: "codex",
      model,
      capabilities: {
        vision: true,
        jsonSchema: true,
        reasoningEfforts: ["low", "medium", "high", "x-high"] as const,
        timeoutMs: 90_000,
        fallbackRouteIds
      }
    },
    benchmark: {
      benchmarkVersion: "kings-benchmark-v1",
      routeId,
      reasoningEffort: "medium" as const,
      sampleSize: 120,
      qualityScore: 0.98,
      schemaSuccessRate: 1,
      p95LatencyMs: 1_200,
      meanCost,
      costUnit: "usd" as const
    }
  });
  return {
    primary: route(
      "codex:gpt-5.4-mini",
      "gpt-5.4-mini",
      options.authorizeFallback === false ? [] : ["codex:gpt-5.4"],
      0.01
    ),
    fallback: route("codex:gpt-5.4", "gpt-5.4", ["codex:gpt-5.4-mini"], 0.02),
    policy: {
      requiresVision: options.vision ?? false,
      requiresJsonSchema: true,
      minimumReasoning: "low",
      minimumContextTokens: 0,
      minimumSampleSize: 40,
      minimumQualityScore: 0.95,
      minimumSchemaSuccessRate: 0.99,
      maximumP95LatencyMs: 90_000
    }
  };
}

function sourceSearchPacket(overrides: Partial<SourceSearchPacket> = {}): SourceSearchPacket {
  return {
    schemaVersion: "production-agent-packet-v1",
    role: "source_search",
    runId: "run-001",
    itemId: "item-001",
    channelId: CHANNEL_ID,
    profileVersion: "profile-v1",
    task: {
      targetCandidateCount: 3,
      querySeeds: ["police bodycam rescue"],
      allowedStrategies: ["instagram", "reserve_pool"],
      excludedStoryEventIds: ["event-used-1"]
    },
    artifacts: [
      {
        id: "concept",
        kind: "concept_contract",
        mediaType: "json",
        path: "/private/evidence/concept-contract.json",
        sha256: SHA_A
      }
    ],
    ...overrides
  };
}

function sourceSearchOutput(): SourceSearchOutput {
  return {
    decision: "FOUND",
    candidates: [
      {
        candidateId: "candidate-1",
        sourceUrl: "https://www.instagram.com/reel/example/",
        strategy: "instagram",
        storyEventId: "event-1",
        eventSummary: "Officer frees a trapped animal.",
        relevanceReason: "Visible police action has a clear rescue payoff.",
        evidenceArtifactIds: ["concept"]
      }
    ],
    exhaustedStrategies: []
  };
}

function sourceFitPacket(): SourceFitPacket {
  return {
    schemaVersion: "production-agent-packet-v1",
    role: "source_fit",
    runId: "run-source-fit",
    itemId: "item-source-fit",
    channelId: CHANNEL_ID,
    profileVersion: "profile-v1",
    task: {
      candidateId: "candidate-source-fit",
      sourceUrl: "https://www.instagram.com/reel/example/",
      sourceSha256: SHA_B,
      claimedStoryEventId: "event-current",
      knownSourceSha256: [],
      knownStoryEventIds: []
    },
    artifacts: [{
      id: "concept",
      kind: "concept_contract",
      mediaType: "json",
      path: "/private/evidence/concept-contract.json",
      sha256: SHA_A
    }]
  };
}

function visionPacket(): VisionQaPacket {
  return {
    schemaVersion: "production-agent-packet-v1",
    role: "vision_qa",
    runId: "run-vision",
    itemId: "item-vision",
    channelId: CHANNEL_ID,
    profileVersion: "profile-v1",
    task: {
      templateSha256: SHA_A,
      conceptId: "police-visible-rescue",
      sourceSha256: SHA_B,
      previewSha256: "c".repeat(64),
      knownSourceSha256: [],
      knownStoryEventIds: []
    },
    artifacts: [
      {
        id: "preview-frame-1",
        kind: "preview_frame",
        mediaType: "image",
        path: "/private/evidence/preview-frame-1.png",
        sha256: SHA_A
      }
    ]
  };
}

function visionOutput(): VisionQaOutput {
  return {
    decision: "PASS",
    channelId: CHANNEL_ID,
    templateSha256: SHA_A,
    conceptMatch: true,
    duplicateVideo: false,
    duplicateEvent: false,
    hookPresent: true,
    actionPresent: true,
    payoffPresent: true,
    donorUiVisible: false,
    ctaVisible: false,
    handleVisible: false,
    watermarkVisible: false,
    foreignCaptionsVisible: false,
    mainEventPreserved: true,
    cropSafe: true,
    factualClaimsVerified: true,
    bannedWordsPresent: false,
    defects: []
  };
}

test("semantic roles expose one strict output schema each", () => {
  assert.deepEqual(Object.keys(PRODUCTION_AGENT_OUTPUT_SCHEMAS).sort(), [...PRODUCTION_AGENT_ROLES].sort());
  for (const role of PRODUCTION_AGENT_ROLES) {
    assert.equal(PRODUCTION_AGENT_OUTPUT_SCHEMAS[role].type, "object");
    assert.equal(PRODUCTION_AGENT_OUTPUT_SCHEMAS[role].additionalProperties, false);
  }

  const visionSchema = PRODUCTION_AGENT_OUTPUT_SCHEMAS.vision_qa as {
    required: string[];
  };
  assert.deepEqual([...visionSchema.required].sort(), Object.keys(visionOutput()).sort());
});

test("strict validators accept the exact contracts for every non-search semantic role", () => {
  assert.equal(
    validateProductionAgentOutput("source_fit", {
      decision: "PASS",
      candidateId: "candidate-1",
      storyEventId: "event-1",
      conceptMatch: true,
      factualFit: true,
      duplicateVideo: false,
      duplicateEvent: false,
      sourceUsable: true,
      reason: "All gates pass.",
      factualClaims: []
    }).decision,
    "PASS"
  );
  assert.equal(
    validateProductionAgentOutput("caption", {
      decision: "PASS",
      caption: "A trapped animal is freed after the officer cuts the final strap.",
      title: "Officer completes a difficult rescue",
      hook: "The animal cannot move.",
      action: "The officer cuts the strap.",
      payoff: "The animal runs free.",
      factualClaims: [],
      bannedWordsFound: []
    }).decision,
    "PASS"
  );
  assert.equal(
    validateProductionAgentOutput("montage_planner", {
      decision: "PASS",
      targetDurationSec: 12,
      segments: [
        { startSec: 0, endSec: 2, purpose: "hook" },
        { startSec: 2, endSec: 9, purpose: "action" },
        { startSec: 9, endSec: 12, purpose: "payoff" }
      ],
      crop: { focusX: 0.5, focusY: 0.45, reason: "Keeps the hands and animal visible." },
      reason: "The visible action remains continuous."
    }).decision,
    "PASS"
  );
  assert.equal(validateProductionAgentOutput("vision_qa", visionOutput()).decision, "PASS");
  assert.equal(
    validateProductionAgentOutput("revision", {
      action: "targeted_visual_revision",
      resumeState: "preview_ready",
      changes: [
        {
          defectCode: "unsafe_crop",
          instruction: "Move the crop left to preserve the officer's hands.",
          artifactId: "preview-frame-1"
        }
      ],
      reason: "One bounded crop correction is sufficient."
    }).action,
    "targeted_visual_revision"
  );
});

test("revision packets accept deterministic quality defects without optional frame indexes", () => {
  const packet: RevisionPacket = {
    schemaVersion: "production-agent-packet-v1",
    role: "revision",
    runId: "run-revision",
    itemId: "item-revision",
    channelId: CHANNEL_ID,
    profileVersion: "profile-v1",
    task: {
      attempt: 1,
      maxAttempts: 5,
      artifactSha256: SHA_A,
      defects: [
        {
          code: "unsafe_crop",
          severity: "critical",
          message: "The crop removes the main action."
        }
      ]
    },
    artifacts: [
      {
        id: "quality-verdict",
        kind: "quality_verdict",
        mediaType: "json",
        path: "/private/evidence/quality-verdict.json",
        sha256: SHA_B
      }
    ]
  };

  assert.equal(validateProductionAgentPacket("revision", packet).task.defects[0]?.code, "unsafe_crop");
});

test("source fit accepts canonical uploaded sources and rejects unsafe URL schemes", () => {
  const uploadedPacket: SourceFitPacket = {
    ...sourceFitPacket(),
    task: {
      ...sourceFitPacket().task,
      sourceUrl: "upload://source-upload-123/exact-source.mp4"
    }
  };

  assert.equal(
    validateProductionAgentPacket("source_fit", uploadedPacket).task.sourceUrl,
    uploadedPacket.task.sourceUrl
  );

  for (const sourceUrl of [
    "http://example.com/source.mp4",
    "file:///private/source.mp4",
    "data:video/mp4;base64,AAAA"
  ]) {
    assert.throws(
      () => validateProductionAgentPacket("source_fit", {
        ...uploadedPacket,
        task: { ...uploadedPacket.task, sourceUrl }
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProductionAgentContractError);
        assert.equal(error.path, "packet.task.sourceUrl");
        assert.match(error.message, /HTTPS or the canonical upload protocol/);
        return true;
      }
    );
  }
});

test("primary benchmarked route is used when its strict output passes", async () => {
  const calls: string[] = [];
  const result = await runProductionSemanticAgent({
    role: "source_search",
    packet: sourceSearchPacket(),
    selection: selection(),
    invoker: async (input) => {
      calls.push(input.route.routeId);
      assert.equal(input.outputSchema.additionalProperties, false);
      assert.equal(input.prompt.includes("There is no conversation history."), true);
      return { rawOutput: JSON.stringify(sourceSearchOutput()), usage: USAGE };
    }
  });

  assert.equal(result.selectedRouteId, "codex:gpt-5.4-mini");
  assert.deepEqual(calls, ["codex:gpt-5.4-mini"]);
  assert.equal(result.output.decision, "FOUND");
  assert.equal(result.attempts[0]?.outcome, "passed");
});

test("only the explicitly benchmarked fallback route runs after primary failure", async () => {
  const calls: string[] = [];
  const result = await runProductionSemanticAgent({
    role: "source_search",
    packet: sourceSearchPacket(),
    selection: selection(),
    invoker: async (input) => {
      calls.push(input.route.routeId);
      if (calls.length === 1) throw new Error("provider 502");
      return { rawOutput: JSON.stringify(sourceSearchOutput()), usage: USAGE };
    }
  });

  assert.deepEqual(calls, ["codex:gpt-5.4-mini", "codex:gpt-5.4"]);
  assert.equal(result.selectedRouteId, "codex:gpt-5.4");
  assert.deepEqual(result.attempts.map((attempt) => attempt.outcome), ["invoke_error", "passed"]);
});

test("schema-invalid output fails closed and retains attempt evidence", async () => {
  const invalid = {
    decision: "FOUND",
    candidates: [],
    exhaustedStrategies: []
  };

  await assert.rejects(
    () =>
      runProductionSemanticAgent({
        role: "source_search",
        packet: sourceSearchPacket(),
        selection: selection(),
        maxAttempts: 1,
        invoker: async () => ({ rawOutput: JSON.stringify(invalid), usage: USAGE })
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProductionAgentRunError);
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0]?.outcome, "schema_error");
      assert.match(error.attempts[0]?.outputSha256 ?? "", /^[a-f0-9]{64}$/);
      return true;
    }
  );
});

test("telemetry records real measured duration, exact usage and prompt/output SHA", async () => {
  const rawOutput = JSON.stringify(sourceSearchOutput());
  let capturedPrompt = "";
  const clock = [100, 145];
  const result = await runProductionSemanticAgent({
    role: "source_search",
    packet: sourceSearchPacket(),
    selection: selection(),
    now: () => new Date("2026-07-10T12:00:00.000Z"),
    monotonicNowMs: () => clock.shift() ?? 145,
    invoker: async (input) => {
      capturedPrompt = input.prompt;
      return { rawOutput, usage: USAGE };
    }
  });

  const attempt = result.attempts[0];
  assert.equal(attempt?.durationMs, 45);
  assert.equal(attempt?.startedAt, "2026-07-10T12:00:00.000Z");
  assert.deepEqual(attempt?.usage, USAGE);
  assert.equal(attempt?.promptSha256, hash(capturedPrompt));
  assert.equal(attempt?.outputSha256, hash(rawOutput));
  assert.equal(attempt?.model, "gpt-5.4-mini");
  assert.equal(attempt?.reasoningEffort, "medium");
  assert.equal(attempt?.benchmarkVersion, "kings-benchmark-v1");
  assert.equal(attempt?.timeoutMs, 90_000);
});

test("unknown full-chat-history fields are rejected before any model call", async () => {
  let calls = 0;
  const packetWithHistory = {
    ...sourceSearchPacket(),
    fullChatHistory: ["owner secret conversation"]
  };

  await assert.rejects(
    () =>
      runProductionSemanticAgent({
        role: "source_search",
        packet: packetWithHistory as unknown as SourceSearchPacket,
        selection: selection(),
        invoker: async () => {
          calls += 1;
          return { rawOutput: JSON.stringify(sourceSearchOutput()), usage: USAGE };
        }
      }),
    ProductionAgentContractError
  );
  assert.equal(calls, 0);
});

test("Vision QA requires every production quality field and rejects a missing crop verdict", async () => {
  const missingCropSafe = { ...visionOutput() } as Partial<VisionQaOutput>;
  delete missingCropSafe.cropSafe;

  await assert.rejects(
    () =>
      runProductionSemanticAgent({
        role: "vision_qa",
        packet: visionPacket(),
        selection: selection({ vision: true }),
        maxAttempts: 1,
        invoker: async () => ({ rawOutput: JSON.stringify(missingCropSafe), usage: USAGE })
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProductionAgentRunError);
      assert.equal(error.attempts[0]?.outcome, "schema_error");
      assert.match(error.message, /cropSafe/);
      return true;
    }
  );

  const accepted = await runProductionSemanticAgent({
    role: "vision_qa",
    packet: visionPacket(),
    selection: selection({ vision: true }),
    invoker: async () => ({ rawOutput: JSON.stringify(visionOutput()), usage: USAGE })
  });
  assert.deepEqual(accepted.output, visionOutput());
});

test("Vision QA prompt defines template text, foreign captions and evidence-bounded factual defects", () => {
  const prompt = buildProductionAgentPrompt("vision_qa", visionPacket());

  assert.match(prompt, /complete ordered preview-frame set/);
  assert.match(prompt, /designated top\/bottom template-card regions/);
  assert.match(
    prompt,
    /inside the media region is foreign_captions: set foreignCaptionsVisible=true and include a foreign_captions defect/
  );
  assert.match(prompt, /visible prompt to follow, subscribe, comment, share, click or continue/);
  assert.match(prompt, /foreign visible @username or account handle/);
  assert.match(prompt, /Letterboxing or neutral background bars alone are not unsafe_crop/);
  assert.match(
    prompt,
    /Do not emit it merely because no external claim exists or irrelevant context is absent/
  );
});

test("Source Search prompt confines the judge to concept relevance and forbids downstream-fit rejection", () => {
  const prompt = buildProductionAgentPrompt("source_search", sourceSearchPacket());

  assert.match(prompt, /Judge only two things: channel-concept relevance and same-profile source supply/);
  assert.match(
    prompt,
    /Never reject a candidate for burned-in captions, subtitles, watermarks, aggregator or account handles, follow\/subscribe overlays, calls to action, end cards, split-screen layouts, static framing, a missing action payoff, or being part of a compilation/
  );
  assert.match(prompt, /must be returned as FOUND even when it visibly carries such defects/);
  assert.match(
    prompt,
    /does not fit the channel concept is NO_MATCH even when it is present in the pool and shares the profile/
  );
  assert.match(prompt, /Do not widen the channel concept/);
});

test("Source Fit prompt treats concept examples as exemplars and task lists as the duplicate ledger", () => {
  const prompt = buildProductionAgentPrompt("source_fit", sourceFitPacket());

  assert.match(prompt, /positiveExamples and concept\.continuityBuffer define the channel boundary/);
  assert.match(prompt, /not proof that an event was already published or reserved/);
  assert.match(prompt, /duplicateVideo=true only when the candidate source hash appears in packet\.task\.knownSourceSha256/);
  assert.match(prompt, /duplicateEvent=true only when the candidate story event appears in packet\.task\.knownStoryEventIds/);
  assert.match(prompt, /Never reject the current candidate merely because its own positive example/);
});

test("an unapproved fallback route is rejected before invocation", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      runProductionSemanticAgent({
        role: "source_search",
        packet: sourceSearchPacket(),
        selection: selection({ authorizeFallback: false }),
        invoker: async () => {
          calls += 1;
          return { rawOutput: JSON.stringify(sourceSearchOutput()), usage: USAGE };
        }
      }),
    ProductionAgentConfigurationError
  );
  assert.equal(calls, 0);
});

test("a fail-closed null-fallback selection surfaces a retryable infra failure without switching models", async () => {
  const base = selection();
  const failClosed = {
    primary: base.primary,
    fallback: null,
    fallbackMode: "fail_closed_none" as const,
    policy: base.policy
  };
  let calls = 0;
  await assert.rejects(
    () =>
      runProductionSemanticAgent({
        role: "source_search",
        packet: sourceSearchPacket(),
        selection: failClosed,
        invoker: async () => {
          calls += 1;
          throw new Error("codex exec transport reset");
        }
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProductionAgentRunError);
      // Only the primary route is attempted; there is no silent switch to a
      // fallback model. The single attempt keeps the existing retryable
      // "invoke_error" classification the Stage 3 lease requeues on.
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0]?.outcome, "invoke_error");
      assert.match(
        error.attempts[0]?.error ?? "",
        /frozen manifest declares fail-closed: no fallback route/
      );
      assert.match(error.message, /frozen manifest declares fail-closed: no fallback route/);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test("missing Codex JSONL token usage fails closed instead of producing incomplete telemetry", async () => {
  await assert.rejects(
    () =>
      runProductionSemanticAgent({
        role: "source_search",
        packet: sourceSearchPacket(),
        selection: selection(),
        maxAttempts: 1,
        invoker: async () => ({ rawOutput: JSON.stringify(sourceSearchOutput()), usage: null })
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProductionAgentRunError);
      assert.equal(error.attempts[0]?.outcome, "telemetry_missing");
      return true;
    }
  );
});

test("Codex adapter uses an isolated cwd, hash-verified copied images, schema file and JSONL usage", async () => {
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "kings-agent-source-"));
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kings-agent-runtime-"));
  const imageBytes = Buffer.from("deterministic-image-bytes");
  const imagePath = path.join(sourceDir, "frame.png");
  await fs.writeFile(imagePath, imageBytes);
  let observedExecutionCwd = "";
  try {
    const packet = sourceSearchPacket({
      artifacts: [
        {
          id: "frame",
          kind: "key_frame",
          mediaType: "image",
          path: imagePath,
          sha256: hash(imageBytes)
        }
      ]
    });
    const invoker = createCodexProductionAgentInvoker({
      repoCwd: "/srv/clips",
      codexHome: "/srv/codex-home",
      tempRoot,
      runCodex: async (input) => {
        observedExecutionCwd = input.executionCwd ?? "";
        assert.equal(observedExecutionCwd.startsWith(tempRoot), true);
        assert.equal(input.cwd, "/srv/clips");
        assert.equal(input.codexHome, "/srv/codex-home");
        assert.equal(input.jsonEvents, true);
        assert.equal(input.ignoreUserConfig, true);
        assert.equal(input.ignoreRules, true);
        assert.equal(input.model, "gpt-5.4-mini");
        assert.equal(input.reasoningEffort, "medium");
        assert.equal(input.prompt.includes(imagePath), false);
        assert.equal(input.prompt.includes("artifacts/01-frame.png"), true);
        assert.equal(input.imagePaths.length, 1);
        assert.equal(path.dirname(input.imagePaths[0] ?? "").startsWith(observedExecutionCwd), true);
        assert.deepEqual(await fs.readFile(input.imagePaths[0] ?? ""), imageBytes);
        const schema = JSON.parse(await fs.readFile(input.outputSchemaPath, "utf-8")) as {
          additionalProperties?: boolean;
        };
        assert.equal(schema.additionalProperties, false);
        const output = sourceSearchOutput();
        output.candidates[0]!.evidenceArtifactIds = ["frame"];
        await fs.writeFile(input.outputMessagePath, JSON.stringify(output), "utf-8");
        return { stdout: "", stderr: "", usage: USAGE };
      }
    });

    const result = await runProductionSemanticAgent({
      role: "source_search",
      packet,
      selection: selection(),
      invoker
    });

    assert.equal(result.output.decision, "FOUND");
    assert.ok(observedExecutionCwd);
    assert.deepEqual(await fs.readdir(tempRoot), []);
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
