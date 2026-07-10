import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sourceBufferReadiness from "../lib/project-kings/source-buffer-readiness";
import type { ProjectKingsSourceFitAttestation } from "../lib/project-kings/source-buffer-readiness";

const {
  auditProjectKingsSourceBufferReadiness,
  parseProjectKingsLivePublicationInventory,
  writeProjectKingsSourceBufferReadiness
} = sourceBufferReadiness;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

const inventoryPath = resolveFromRoot(
  argument("--inventory") ??
    "docs/project-kings-production-pipeline-v1/evidence/live-publication-inventory-2026-07-10.json"
);
const outputPath = resolveFromRoot(
  argument("--output") ??
    "docs/project-kings-production-pipeline-v1/evidence/source-buffer-readiness-2026-07-10.json"
);
const attestationArgument = argument("--attestations");
const capturedAt = argument("--captured-at") ?? new Date().toISOString();

const inventory = parseProjectKingsLivePublicationInventory(
  JSON.parse(await fs.readFile(inventoryPath, "utf8"))
);
let sourceFitAttestations: readonly ProjectKingsSourceFitAttestation[] = [];
if (attestationArgument) {
  const raw = JSON.parse(await fs.readFile(resolveFromRoot(attestationArgument), "utf8"));
  if (!Array.isArray(raw)) throw new Error("--attestations must point to a JSON array.");
  sourceFitAttestations = raw as ProjectKingsSourceFitAttestation[];
}

const evidence = await auditProjectKingsSourceBufferReadiness({
  repoRoot,
  liveInventory: inventory,
  capturedAt,
  sourceFitAttestations
});
await writeProjectKingsSourceBufferReadiness({ outputPath, evidence });

process.stdout.write(`${JSON.stringify({
  schemaVersion: "project-kings-source-buffer-audit-result-v1",
  outputPath: path.relative(repoRoot, outputPath),
  liveInventorySha256: evidence.liveInventorySha256,
  evidenceSha256: evidence.evidenceSha256,
  summary: evidence.summary,
  channels: evidence.channels.map((channel) => ({
    profileKey: channel.profileKey,
    unusedCandidates: channel.unusedCandidateCount,
    qualified: channel.qualifiedCount,
    pending: channel.pendingCount,
    candidateSupplyDeficit: channel.candidateSupplyDeficit,
    qualifiedBufferDeficit: channel.qualifiedBufferDeficit
  }))
}, null, 2)}\n`);
