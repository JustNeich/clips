import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import productionReplays from "../lib/project-kings/production-replays";
import type { ProjectKingsReplayEvidence } from "../lib/project-kings/production-replays";

const { runProjectKingsReplaySuite } = productionReplays;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(
  repoRoot,
  "docs/project-kings-production-pipeline-v1/evidence"
);

const evidenceFiles: Array<{
  filename: string;
  select: "historical" | "infrastructure" | "content";
}> = [
  { filename: "replays-historical-july-9.json", select: "historical" },
  { filename: "replays-infrastructure-recovery.json", select: "infrastructure" },
  { filename: "replays-content-rework.json", select: "content" }
];

function summary(evidence: ProjectKingsReplayEvidence): Record<string, unknown> {
  return {
    scenarioId: evidence.scenarioId,
    runId: evidence.runId,
    outcome: evidence.outcome,
    assertions: evidence.assertions.length,
    durationMs: evidence.clock.logicalDurationMs,
    evidenceSha256: evidence.evidenceSha256
  };
}

await mkdir(evidenceDir, { recursive: true });
const suite = await runProjectKingsReplaySuite({ repoRoot });

for (const evidenceFile of evidenceFiles) {
  const evidence = suite[evidenceFile.select];
  await writeFile(
    path.join(evidenceDir, evidenceFile.filename),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8"
  );
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: "project-kings-replay-runner-v1",
  evidenceDir: path.relative(repoRoot, evidenceDir),
  externalNetworkEnabled: false,
  scenarios: evidenceFiles.map(({ select }) => summary(suite[select]))
}, null, 2)}\n`);
