import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRemainingSemanticBenchmarkDatasets,
  createRemainingSemanticBenchmarkQualityEvaluator
} from "../lib/project-kings/remaining-semantic-benchmark-dataset";
import {
  REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION,
  appendRemainingSemanticBenchmarkCheckpoint,
  loadSuccessfulRemainingSemanticCheckpoints,
  remainingSemanticBenchmarkInvocationKey,
  type RemainingSemanticBenchmarkCheckpointCall,
  type RemainingSemanticBenchmarkInvocationIdentity
} from "../lib/project-kings/remaining-semantic-benchmark-checkpoint";

const REPO_ROOT = path.resolve(__dirname, "..");

test("remaining semantic benchmark freezes 30 real typed packets for every role", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kings-remaining-benchmark-test-"));
  try {
    const built = await buildRemainingSemanticBenchmarkDatasets({ repoRoot: REPO_ROOT, fixtureRoot });
    assert.deepEqual(
      Object.fromEntries(Object.entries(built.datasets).map(([role, dataset]) => [role, dataset.cases.length])),
      { source_search: 30, source_fit: 30, caption: 30, montage_planner: 30 }
    );
    assert.equal(built.annotations.mediaCases.length, 30);
    assert.equal(built.annotations.independentFromModelRoutesUnderTest, true);
    assert.match(built.annotations.annotationsSha256, /^[a-f0-9]{64}$/);
    assert.equal(new Set(built.annotations.mediaCases.map((entry) => entry.mediaId)).size, 30);
    assert.equal(built.annotations.sourceEvidence.length >= 4, true);
    assert.equal(
      built.datasets.source_search.cases.filter((entry) => entry.expectedQualityLabel === "FOUND").length,
      15
    );
    assert.equal(
      built.datasets.source_search.cases.filter((entry) => entry.expectedQualityLabel === "NO_MATCH").length,
      15
    );

    const allArtifacts = Object.values(built.datasets).flatMap((dataset) =>
      dataset.cases.flatMap((entry) => entry.packet.artifacts)
    );
    assert.equal(allArtifacts.some((artifact) => artifact.mediaType === "image"), true);
    assert.equal(
      built.datasets.source_fit.cases.every((entry) =>
        entry.packet.artifacts.filter((artifact) => artifact.mediaType === "image").length === 3
      ),
      true
    );
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("remaining semantic scorer rejects plausible-looking outputs that violate frozen truth", async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kings-remaining-scorer-test-"));
  try {
    const built = await buildRemainingSemanticBenchmarkDatasets({ repoRoot: REPO_ROOT, fixtureRoot });
    const evaluator = createRemainingSemanticBenchmarkQualityEvaluator(built.annotations);

    const searchCase = built.datasets.source_search.cases.find((entry) => entry.expectedQualityLabel === "FOUND")!;
    const badSearch = await evaluator.evaluate({
      role: "source_search",
      caseId: searchCase.caseId,
      expectedQualityLabel: searchCase.expectedQualityLabel,
      packet: searchCase.packet,
      output: {
        decision: "FOUND",
        candidates: [{
          candidateId: "made-up-candidate",
          sourceUrl: "https://www.instagram.com/reel/made-up/",
          strategy: "instagram",
          storyEventId: "made-up-event",
          eventSummary: "Made up.",
          relevanceReason: "Made up.",
          evidenceArtifactIds: ["source-pool"]
        }],
        exhaustedStrategies: []
      }
    });
    assert.equal(badSearch.passed, false);

    const rejectedFit = built.datasets.source_fit.cases.find((entry) =>
      entry.expectedQualityLabel === "FAIL" && !entry.caseId.includes("duplicate")
    )!;
    const badFit = await evaluator.evaluate({
      role: "source_fit",
      caseId: rejectedFit.caseId,
      expectedQualityLabel: rejectedFit.expectedQualityLabel,
      packet: rejectedFit.packet,
      output: {
        decision: "PASS",
        candidateId: rejectedFit.packet.task.candidateId,
        storyEventId: rejectedFit.packet.task.claimedStoryEventId,
        conceptMatch: true,
        factualFit: true,
        duplicateVideo: false,
        duplicateEvent: false,
        sourceUsable: true,
        reason: "Incorrectly ignores the human reject evidence.",
        factualClaims: []
      }
    });
    assert.equal(badFit.passed, false);

    const captionCase = built.datasets.caption.cases[0]!;
    const badCaption = await evaluator.evaluate({
      role: "caption",
      caseId: captionCase.caseId,
      expectedQualityLabel: captionCase.expectedQualityLabel,
      packet: captionCase.packet,
      output: {
        decision: "PASS",
        caption: "This video shows the clip and asks viewers to keep watching for a generic ending.",
        title: "A Generic Video Ending",
        hook: "Watch this video",
        action: "The clip continues",
        payoff: "Viewers see an ending",
        factualClaims: ["A generic event occurs."],
        bannedWordsFound: []
      }
    });
    assert.equal(badCaption.passed, false);

    const montageCase = built.datasets.montage_planner.cases[0]!;
    const badMontage = await evaluator.evaluate({
      role: "montage_planner",
      caseId: montageCase.caseId,
      expectedQualityLabel: montageCase.expectedQualityLabel,
      packet: montageCase.packet,
      output: {
        decision: "PASS",
        targetDurationSec: montageCase.packet.task.targetDurationSec,
        segments: [
          { startSec: 0, endSec: 0.2, purpose: "hook" },
          { startSec: 0.2, endSec: 0.4, purpose: "action" },
          { startSec: 0.4, endSec: 0.6, purpose: "payoff" }
        ],
        crop: { focusX: 0.5, focusY: 0.5, reason: "Center." },
        reason: "Far too little timeline coverage."
      }
    });
    assert.equal(badMontage.passed, false);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("benchmark checkpoint resumes only an exact successful invocation and preserves measured telemetry", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kings-remaining-checkpoint-test-"));
  const checkpointPath = path.join(directory, "checkpoint.jsonl");
  try {
    const identity: RemainingSemanticBenchmarkInvocationIdentity = {
      benchmarkVersion: "project-kings-caption-real-30-v2",
      annotationsSha256: "a".repeat(64),
      caseId: "caption-01-case",
      routeId: "codex:gpt-5.4-mini",
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      promptSha256: "b".repeat(64),
      outputSchemaSha256: "c".repeat(64)
    };
    const rawOutput = JSON.stringify({ decision: "PASS" });
    const success: RemainingSemanticBenchmarkCheckpointCall = {
      schemaVersion: REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION,
      invocationKey: remainingSemanticBenchmarkInvocationKey(identity),
      ...identity,
      startedAt: "2026-07-10T18:00:00.000Z",
      durationMs: 12_345.678,
      outcome: "returned",
      rawOutput,
      outputSha256: createHash("sha256").update(rawOutput).digest("hex"),
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 200,
        outputTokens: 100,
        reasoningOutputTokens: 20
      },
      error: null
    };
    await appendRemainingSemanticBenchmarkCheckpoint(checkpointPath, success);

    const quotaFailureIdentity = { ...identity, caseId: "caption-02-case" };
    const quotaFailure: RemainingSemanticBenchmarkCheckpointCall = {
      schemaVersion: REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION,
      invocationKey: remainingSemanticBenchmarkInvocationKey(quotaFailureIdentity),
      ...quotaFailureIdentity,
      startedAt: "2026-07-10T18:01:00.000Z",
      durationMs: 500,
      outcome: "invoke_error",
      rawOutput: null,
      outputSha256: null,
      usage: null,
      error: "usage limit"
    };
    await appendRemainingSemanticBenchmarkCheckpoint(checkpointPath, quotaFailure);

    const loaded = await loadSuccessfulRemainingSemanticCheckpoints(checkpointPath);
    assert.equal(loaded.size, 1);
    assert.equal(loaded.get(success.invocationKey)?.durationMs, 12_345.678);
    assert.deepEqual(loaded.get(success.invocationKey)?.usage, success.usage);
    assert.equal(loaded.has(quotaFailure.invocationKey), false);
    assert.notEqual(
      remainingSemanticBenchmarkInvocationKey({ ...identity, promptSha256: "d".repeat(64) }),
      success.invocationKey
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("benchmark checkpoint rejects tampered invocation bindings", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kings-remaining-checkpoint-tamper-"));
  const checkpointPath = path.join(directory, "checkpoint.jsonl");
  try {
    await fs.writeFile(checkpointPath, `${JSON.stringify({
      schemaVersion: REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION,
      invocationKey: "f".repeat(64),
      benchmarkVersion: "benchmark-v1",
      annotationsSha256: "a".repeat(64),
      caseId: "case-1",
      routeId: "codex:gpt-5.4-mini",
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
      promptSha256: "b".repeat(64),
      outputSchemaSha256: "c".repeat(64),
      startedAt: "2026-07-10T18:00:00.000Z",
      durationMs: 100,
      outcome: "returned",
      rawOutput: "{}",
      outputSha256: "d".repeat(64),
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0 },
      error: null
    })}\n`, "utf8");
    await assert.rejects(
      () => loadSuccessfulRemainingSemanticCheckpoints(checkpointPath),
      /invalid invocation key/
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
