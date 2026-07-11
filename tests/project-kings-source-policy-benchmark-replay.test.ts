import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  PROJECT_KINGS_SOURCE_POLICY_REPLAY_REASONING_EFFORT,
  PROJECT_KINGS_SOURCE_POLICY_REPLAY_ROUTE_ID,
  replayProjectKingsSourcePolicyBenchmark
} from "../lib/project-kings/source-policy-benchmark-replay";
import { hashProjectKingsSourcePolicyArtifact } from "../lib/project-kings/source-rights-sensitive-policy";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetPath = path.join(
  repoRoot,
  "docs/project-kings-production-pipeline-v1/evidence/source-policy-benchmark-real-30-v1/dataset.json"
);
const rawEvidencePath = path.join(
  repoRoot,
  "docs/project-kings-production-pipeline-v1/evidence/model-benchmark-source_policy-2026-07-10-real-30-v9-raw.json"
);

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const binding = {
  benchmarkCaseId: "light-youtube-BwIaEb5vGDo",
  candidateId: "light-ask-BwIaEb5vGDo",
  profileKey: "light-kingdom",
  canonicalSourceUrl: "https://www.youtube.com/watch?v=BwIaEb5vGDo",
  contentSha256: "0c500e91711a6ec9cbf3bb8ad1f498f04f9de23b460d0cc0c9f10ebdc32de47f",
  provider: "youtube_ask",
  route: "youtube_ask_v3",
  donorUsername: null,
  upstreamDiscoveryEvidenceSha256: hash("frozen-youtube-ask-discovery")
} as const;

async function inputs() {
  const [datasetBytes, rawEvidenceBytes] = await Promise.all([
    fs.readFile(datasetPath, "utf8"),
    fs.readFile(rawEvidencePath, "utf8")
  ]);
  return {
    datasetBytes,
    dataset: JSON.parse(datasetBytes),
    datasetFileSha256: hash(datasetBytes),
    rawEvidence: JSON.parse(rawEvidenceBytes)
  };
}

test("Luna/medium replay builds a target-candidate assessment from exact benchmark bytes", async () => {
  const source = await inputs();
  const result = replayProjectKingsSourcePolicyBenchmark({
    ...source,
    bindings: [binding]
  });
  assert.equal(result.selectedRouteId, PROJECT_KINGS_SOURCE_POLICY_REPLAY_ROUTE_ID);
  assert.equal(result.reasoningEffort, PROJECT_KINGS_SOURCE_POLICY_REPLAY_REASONING_EFFORT);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0]?.candidateId, binding.candidateId);
  assert.equal(result.artifacts[0]?.designation.canonicalSourceUrl, binding.canonicalSourceUrl);
  assert.equal(result.artifacts[0]?.sensitiveAssessment.contentSha256, binding.contentSha256);
  assert.deepEqual(result.artifacts[0]?.sensitiveAssessment.signals, {
    graphicViolence: "absent",
    unsupportedAllegation: "absent",
    minorInSensitiveIncident: "absent",
    realisticPoliticalOrPublicFigureDeepfake: "absent"
  });
});

test("replay rejects triple-binding drift and a missing selected route/effort call", async () => {
  const source = await inputs();
  assert.throws(
    () => replayProjectKingsSourcePolicyBenchmark({
      ...source,
      bindings: [{ ...binding, contentSha256: hash("wrong-media") }]
    }),
    /profileKey \+ canonicalSourceUrl \+ contentSha256/i
  );

  const rawEvidence = structuredClone(source.rawEvidence) as {
    calls: Array<Record<string, unknown>>;
    rawEvidenceSha256: string;
  };
  const selected = rawEvidence.calls.find((call) =>
    call.caseId === binding.benchmarkCaseId &&
    call.routeId === PROJECT_KINGS_SOURCE_POLICY_REPLAY_ROUTE_ID &&
    call.reasoningEffort === PROJECT_KINGS_SOURCE_POLICY_REPLAY_REASONING_EFFORT
  )!;
  selected.reasoningEffort = "high";
  const { rawEvidenceSha256: ignored, ...payload } = rawEvidence;
  void ignored;
  rawEvidence.rawEvidenceSha256 = hashProjectKingsSourcePolicyArtifact(payload);
  assert.throws(
    () => replayProjectKingsSourcePolicyBenchmark({
      ...source,
      rawEvidence,
      bindings: [binding]
    }),
    /exactly one .*medium call for every dataset case/i
  );
});

test("replay CLI writes only policy artifacts and reports its evidence binding", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-kings-policy-replay-"));
  try {
    const bindingsPath = path.join(temporaryRoot, "bindings.json");
    const outputPath = path.join(temporaryRoot, "artifacts.json");
    await fs.writeFile(bindingsPath, `${JSON.stringify([binding])}\n`, "utf8");
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      path.join(repoRoot, "scripts/replay-project-kings-source-policy-benchmark.mts"),
      "--bindings",
      bindingsPath,
      "--output",
      outputPath
    ], { cwd: repoRoot, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    const summary = JSON.parse(stdout) as {
      schemaVersion: string;
      artifactCount: number;
      replayEvidenceSha256: string;
    };
    assert.equal(summary.schemaVersion, "project-kings-source-policy-benchmark-replay-v1");
    assert.equal(summary.artifactCount, 1);
    assert.match(summary.replayEvidenceSha256, /^[a-f0-9]{64}$/);
    const output = JSON.parse(await fs.readFile(outputPath, "utf8"));
    assert.equal(output[0].candidateId, binding.candidateId);
    assert.equal("approval" in output[0], false);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
