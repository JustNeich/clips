import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import replayModule from "../lib/project-kings/source-policy-benchmark-replay";

const { replayProjectKingsSourcePolicyBenchmark } = replayModule;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name: string): string | null {
  const indexes = process.argv
    .map((value, index) => value === name ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length > 1) throw new Error(`${name} must be provided at most once.`);
  if (indexes.length === 0) return null;
  const value = process.argv[indexes[0]! + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, filePath);
}

const datasetPath = resolveFromRoot(argument("--dataset") ??
  "docs/project-kings-production-pipeline-v1/evidence/source-policy-benchmark-real-30-v1/dataset.json");
const rawEvidencePath = resolveFromRoot(argument("--raw-evidence") ??
  "docs/project-kings-production-pipeline-v1/evidence/model-benchmark-source_policy-2026-07-10-real-30-v9-raw.json");
const bindingsPath = resolveFromRoot(requiredArgument("--bindings"));
const outputPath = resolveFromRoot(requiredArgument("--output"));

const [datasetBytes, rawEvidenceBytes, bindingsBytes] = await Promise.all([
  fs.readFile(datasetPath, "utf8"),
  fs.readFile(rawEvidencePath, "utf8"),
  fs.readFile(bindingsPath, "utf8")
]);
const result = replayProjectKingsSourcePolicyBenchmark({
  dataset: JSON.parse(datasetBytes),
  datasetFileSha256: createHash("sha256").update(datasetBytes).digest("hex"),
  rawEvidence: JSON.parse(rawEvidenceBytes),
  bindings: JSON.parse(bindingsBytes)
});
await atomicWrite(outputPath, `${JSON.stringify(result.artifacts, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  schemaVersion: result.schemaVersion,
  selectedRouteId: result.selectedRouteId,
  reasoningEffort: result.reasoningEffort,
  artifactCount: result.artifacts.length,
  outputPath: path.relative(repoRoot, outputPath),
  datasetSha256: result.datasetSha256,
  rawEvidenceSha256: result.rawEvidenceSha256,
  bindingsSha256: result.bindingsSha256,
  replayEvidenceSha256: result.replayEvidenceSha256
}, null, 2)}\n`);
