import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_ANNOTATIONS_PATH,
  PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_DATASET_PATH,
  encodeProjectKingsSourcePolicyBenchmarkSignals,
  loadProjectKingsSourcePolicyBenchmarkDataset
} from "../lib/project-kings/source-policy-benchmark-dataset";

const REPO_ROOT = path.resolve(__dirname, "..");

test("frozen source_policy dataset loads 30 exact MP4-bound cases with six real frames and tri-state labels", async () => {
  const dataset = await loadProjectKingsSourcePolicyBenchmarkDataset({ repoRoot: REPO_ROOT });

  assert.equal(dataset.datasetId, "project-kings-source-policy-real-candidates");
  assert.equal(dataset.datasetVersion, "real-30-v1");
  assert.equal(dataset.cases.length, 30);
  assert.equal(new Set(dataset.cases.map((entry) => entry.caseId)).size, 30);
  assert.equal(new Set(dataset.cases.map((entry) => entry.packet.task.contentSha256)).size, 30);
  assert.deepEqual(
    dataset.cases.map((entry) => entry.packet.task.profileKey).reduce<Record<string, number>>((counts, profileKey) => {
      counts[profileKey] = (counts[profileKey] ?? 0) + 1;
      return counts;
    }, {}),
    { "dark-joy-boy": 8, "copscopes-x2e": 10, "light-kingdom": 12 }
  );
  for (const benchmarkCase of dataset.cases) {
    assert.equal(benchmarkCase.packet.task.orderedKeyFrameArtifactIds.length, 6);
    assert.equal(benchmarkCase.packet.artifacts.filter((artifact) => artifact.kind === "key_frame").length, 6);
    assert.match(benchmarkCase.expectedQualityLabel, /^sp:[apu],[apu],[apu],[apu]$/);
    assert.equal(
      benchmarkCase.packet.artifacts.some((artifact) =>
        ["approval", "qualification", "policy_verdict"].includes(artifact.kind)
      ),
      false
    );
  }
  const labels = dataset.cases.map((entry) => entry.expectedQualityLabel);
  assert.equal(labels.filter((label) => label === "sp:a,a,a,a").length, 18);
  assert.equal(labels.includes("sp:a,a,a,u"), true);
  assert.equal(labels.includes("sp:a,p,p,a"), true);
  assert.equal(labels.includes("sp:a,a,p,a"), true);
  assert.equal(labels.includes("sp:a,a,a,p"), true);
  assert.equal(
    encodeProjectKingsSourcePolicyBenchmarkSignals({
      graphicViolence: "absent",
      unsupportedAllegation: "present",
      minorInSensitiveIncident: "unknown",
      realisticPoliticalOrPublicFigureDeepfake: "absent"
    }),
    "sp:a,p,u,a"
  );
});

test("frozen annotation drift fails before a benchmark invocation can use it", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-kings-source-policy-dataset-"));
  try {
    const datasetSource = path.join(REPO_ROOT, PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_DATASET_PATH);
    const annotationSource = path.join(REPO_ROOT, PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_ANNOTATIONS_PATH);
    const datasetTarget = path.join(temporaryRoot, PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_DATASET_PATH);
    const annotationTarget = path.join(temporaryRoot, PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_ANNOTATIONS_PATH);
    await fs.mkdir(path.dirname(datasetTarget), { recursive: true });
    await fs.copyFile(datasetSource, datasetTarget);
    const annotations = JSON.parse(await fs.readFile(annotationSource, "utf8")) as {
      cases: Array<{ signals: { graphicViolence: string } }>;
    };
    annotations.cases[0]!.signals.graphicViolence = "present";
    await fs.writeFile(annotationTarget, `${JSON.stringify(annotations, null, 2)}\n`);
    await assert.rejects(
      () => loadProjectKingsSourcePolicyBenchmarkDataset({ repoRoot: temporaryRoot }),
      /annotation-set hash mismatch/
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
