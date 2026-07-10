import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  runProjectKingsReplaySuite,
  type ProjectKingsReplayEvidence,
  type ProjectKingsReplaySuite
} from "../lib/project-kings/production-replays";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(
  repoRoot,
  "docs/project-kings-production-pipeline-v1/evidence"
);
const evidenceFiles: Array<{
  filename: string;
  select: keyof ProjectKingsReplaySuite;
}> = [
  { filename: "replays-historical-july-9.json", select: "historical" },
  { filename: "replays-infrastructure-recovery.json", select: "infrastructure" },
  { filename: "replays-content-rework.json", select: "content" }
];

let generatedSuitePromise: Promise<{
  suite: ProjectKingsReplaySuite;
  interceptedNetworkCalls: number;
}> | null = null;

function generateWithoutNetwork(): Promise<{
  suite: ProjectKingsReplaySuite;
  interceptedNetworkCalls: number;
}> {
  if (generatedSuitePromise) return generatedSuitePromise;
  generatedSuitePromise = (async () => {
    const originalFetch = globalThis.fetch;
    let interceptedNetworkCalls = 0;
    globalThis.fetch = (async () => {
      interceptedNetworkCalls += 1;
      throw new Error("Project Kings replay attempted forbidden network access.");
    }) as typeof fetch;
    try {
      const suite = await runProjectKingsReplaySuite({ repoRoot });
      return { suite, interceptedNetworkCalls };
    } finally {
      globalThis.fetch = originalFetch;
    }
  })();
  return generatedSuitePromise;
}

function assertCommonEvidence(evidence: ProjectKingsReplayEvidence): void {
  assert.equal(evidence.schemaVersion, "project-kings-replay-evidence-v1");
  assert.equal(evidence.runIdKind, "deterministic-business-alias");
  assert.equal(evidence.outcome, "pass");
  assert.match(evidence.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.ok(evidence.assertions.length > 0);
  assert.ok(evidence.assertions.every((entry) => entry.pass));
  assert.deepEqual(evidence.externalEffects, {
    networkRequests: 0,
    youtubeUploadRequests: 0,
    publicVideosCreated: 0
  });
}

test("three Project Kings replays pass without network or external publication", async () => {
  const { suite, interceptedNetworkCalls } = await generateWithoutNetwork();
  assert.equal(interceptedNetworkCalls, 0);
  Object.values(suite).forEach(assertCommonEvidence);

  assert.equal(suite.historical.scenarioId, "historical-july-9");
  assert.deepEqual(suite.historical.metrics.replay, {
    targetItems: 9,
    finalApprovedItems: 9,
    agentAttempts: 45,
    reasoningTokens: 0,
    pollingAndModelTokens: 0,
    deliveredOutboxEvents: 45,
    retriedOutboxEvents: 0,
    deadOutboxEvents: 0
  });

  assert.equal(suite.infrastructure.scenarioId, "infrastructure-recovery");
  assert.equal(suite.infrastructure.metrics.publicVerifiedItems, 9);
  assert.equal(suite.infrastructure.metrics.retryCalls, 2);
  assert.equal(suite.infrastructure.metrics.lostLeaseEventAttempts, 2);
  assert.equal(suite.infrastructure.metrics.uniquePublicationIntentCount, 9);
  assert.equal(suite.infrastructure.metrics.uniqueVideoIdentityCount, 9);
  assert.equal(suite.infrastructure.metrics.uploadOutcomeUnknownCount, 1);
  assert.equal(suite.infrastructure.metrics.uploadReconcileCount, 1);

  assert.equal(suite.content.scenarioId, "content-rework");
  assert.deepEqual(suite.content.metrics.historicalGenerationsForFaultedSlot, [
    { generation: 1, state: "quarantined" },
    { generation: 2, state: "replaced" },
    { generation: 3, state: "final_approved" }
  ]);
  assert.deepEqual(suite.content.metrics.revisionActions, [
    "targeted_visual_revision",
    "targeted_visual_revision",
    "replace_source"
  ]);
  assert.deepEqual(suite.content.metrics.unsafeCropDefectCodes, [
    "unsafe_crop",
    "vision_deterministic_disagreement"
  ]);
  assert.equal(suite.content.metrics.quarantinedSourceCount, 1);
  assert.equal(suite.content.metrics.finalApprovedItems, 9);
});

test("frozen replay evidence exactly matches a new deterministic execution", async () => {
  const { suite } = await generateWithoutNetwork();
  for (const evidenceFile of evidenceFiles) {
    const frozen = JSON.parse(
      await readFile(path.join(evidenceDir, evidenceFile.filename), "utf8")
    ) as ProjectKingsReplayEvidence;
    assert.deepEqual(frozen, suite[evidenceFile.select]);
  }
});

test("two independent executions produce identical evidence", async () => {
  const { suite: first } = await generateWithoutNetwork();
  const second = await runProjectKingsReplaySuite({ repoRoot });
  assert.deepEqual(second, first);
});
