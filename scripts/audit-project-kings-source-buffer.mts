import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sourceBufferReadiness from "../lib/project-kings/source-buffer-readiness";
import sourceBufferPolicyInputs from "../lib/project-kings/source-buffer-policy-inputs";
import type {
  ProjectKingsSourceFitAttestation
} from "../lib/project-kings/source-buffer-readiness";

const {
  auditProjectKingsSourceBufferReadiness,
  parseProjectKingsLivePublicationInventory,
  writeProjectKingsSourceBufferReadiness
} = sourceBufferReadiness;
const {
  assertProjectKingsSourcePolicyArtifactsBoundToReadiness,
  parseProjectKingsSourcePolicyApprovalArtifact,
  parseProjectKingsSourcePolicyCandidateArtifacts
} = sourceBufferPolicyInputs;

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
  if (!value) throw new Error(`${name} is required; policy evidence is never synthesized.`);
  return value;
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
const policyApprovalPath = resolveFromRoot(requiredArgument("--policy-approval"));
const policyArtifactsPath = resolveFromRoot(requiredArgument("--policy-artifacts"));
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
const sourcePolicyApproval = parseProjectKingsSourcePolicyApprovalArtifact(
  JSON.parse(await fs.readFile(policyApprovalPath, "utf8"))
);
const sourcePolicyCandidateArtifacts = parseProjectKingsSourcePolicyCandidateArtifacts(
  JSON.parse(await fs.readFile(policyArtifactsPath, "utf8")),
  sourcePolicyApproval
);

const evidence = await auditProjectKingsSourceBufferReadiness({
  repoRoot,
  liveInventory: inventory,
  capturedAt,
  sourceFitAttestations,
  sourcePolicyApproval,
  sourcePolicyCandidateArtifacts
});
assertProjectKingsSourcePolicyArtifactsBoundToReadiness(
  evidence,
  sourcePolicyCandidateArtifacts
);
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
