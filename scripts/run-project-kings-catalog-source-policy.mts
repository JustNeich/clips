#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import catalogRerunModule from "../lib/project-kings/catalog-source-policy-rerun";
import profilesModule from "../lib/project-kings/pilot-production-profiles";
import profileStoreModule from "../lib/project-kings/pilot-profile-store";
import sourceBufferReadinessModule from "../lib/project-kings/source-buffer-readiness";
import sourcePolicyAssessmentModule from "../lib/project-kings/source-policy-assessment-runner";
import sourceRefillAdaptersModule from "../lib/project-kings/source-refill-adapters";
import sourcePolicyModule from "../lib/project-kings/source-rights-sensitive-policy";

const {
  resolveProjectKingsCatalogPolicyCandidates,
  runProjectKingsCatalogSourcePolicyRerun
} = catalogRerunModule;
const { PROJECT_KINGS_PILOT_PROFILES } = profilesModule;
const {
  PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID,
  PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256
} = profileStoreModule;
const {
  auditProjectKingsSourceBufferReadiness,
  parseProjectKingsLivePublicationInventory
} = sourceBufferReadinessModule;
const { runProjectKingsSourcePolicyAssessment } = sourcePolicyAssessmentModule;
const {
  createProjectKingsLocalMediaEvidenceProvider,
  loadProjectKingsSourceRefillSemanticRuntime
} = sourceRefillAdaptersModule;
const { hashProjectKingsSourcePolicyArtifact } = sourcePolicyModule;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = path.join(
  repoRoot,
  "docs/project-kings-production-pipeline-v1/evidence/project-kings-model-routes-v4.json"
);

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

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
}

function homePath(value: string): string {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function repoOutputPath(value: string): string {
  const outputPath = resolvePath(value);
  const relative = path.relative(repoRoot, outputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("--output must resolve to a file inside the Clips repository.");
  }
  return outputPath;
}

function candidateIds(value: string): readonly string[] {
  const result = value.split(",").map((entry) => entry.trim());
  if (result.length === 0 || result.some((entry) => !entry)) {
    throw new Error("--candidate-ids must be a comma-separated list of exact candidate IDs.");
  }
  if (new Set(result).size !== result.length) {
    throw new Error("--candidate-ids must not contain duplicates.");
  }
  return result;
}

function concurrency(value: string | null): number {
  const parsed = value === null ? 3 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) {
    throw new Error("--concurrency must be an integer between 1 and 3.");
  }
  return parsed;
}

async function existingOutput(outputPath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, filePath);
}

const inventoryPath = resolvePath(requiredArgument("--inventory"));
const requestedCandidateIds = candidateIds(requiredArgument("--candidate-ids"));
const outputPath = repoOutputPath(requiredArgument("--output"));
const maxConcurrency = concurrency(argument("--concurrency"));
const manifestPath = resolvePath(argument("--manifest") ?? defaultManifestPath);
const codexHome = path.resolve(homePath(
  argument("--codex-home") ?? process.env.CODEX_HOME?.trim() ?? path.join(os.homedir(), ".codex")
));

const inventory = parseProjectKingsLivePublicationInventory(
  JSON.parse(await fs.readFile(inventoryPath, "utf8"))
);
const readiness = await auditProjectKingsSourceBufferReadiness({
  repoRoot,
  liveInventory: inventory,
  capturedAt: inventory.capturedAt
});
// Resolve every requested identity before a semantic runtime is created. Dark
// donor ambiguity, missing media and stale IDs therefore fail before a model call.
resolveProjectKingsCatalogPolicyCandidates({
  readiness,
  candidateIds: requestedCandidateIds
});

const { manifest, invoker } = await loadProjectKingsSourceRefillSemanticRuntime({
  repoRoot,
  manifestPath,
  codexHome
});
if (
  manifest.manifestId !== PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID ||
  manifest.manifestSha256 !== PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256
) {
  throw new Error("Catalog source-policy rerun requires the exact active v4 route manifest.");
}
const mediaEvidenceProvider = createProjectKingsLocalMediaEvidenceProvider({
  repoRoot,
  whisperModel: argument("--whisper-model") ?? "tiny"
});
const requestId = `catalog-source-policy-${readiness.liveInventorySha256.slice(0, 20)}`;
const priorArtifacts = await existingOutput(outputPath);
const result = await runProjectKingsCatalogSourcePolicyRerun({
  readiness,
  candidateIds: requestedCandidateIds,
  existingArtifacts: priorArtifacts,
  concurrency: maxConcurrency,
  onArtifactsUpdated: async (artifacts) => {
    await atomicWrite(outputPath, `${JSON.stringify(artifacts, null, 2)}\n`);
  },
  assessCandidate: async (candidate) => {
    const discoveredCandidate = {
      candidateId: candidate.candidateId,
      profileKey: candidate.profileKey,
      provider: candidate.provider,
      route: candidate.route,
      donorUsername: candidate.donorUsername,
      sourceUrl: candidate.sourceUrl,
      canonicalUrl: candidate.canonicalUrl,
      caption: "",
      provisionalStoryEventId: candidate.storyEventId,
      discoveryEvidenceSha256: candidate.discoveryEvidenceSha256
    };
    const mediaPath = path.resolve(repoRoot, candidate.media.relativePath);
    const extracted = await mediaEvidenceProvider.extract({
      requestId,
      candidate: discoveredCandidate,
      downloaded: {
        candidateId: candidate.candidateId,
        sourceUrl: candidate.sourceUrl,
        mediaPath,
        acquisitionPath: "approved_provider",
        acquisitionEvidenceSha256: hashProjectKingsSourcePolicyArtifact({
          candidateId: candidate.candidateId,
          sourceUrl: candidate.sourceUrl,
          relativePath: candidate.media.relativePath,
          contentSha256: candidate.media.contentSha256,
          acquisitionPath: "existing_exact_catalog_media"
        })
      }
    });
    if (extracted.media.contentSha256 !== candidate.media.contentSha256) {
      throw new Error(`Candidate ${candidate.candidateId} media changed after readiness audit.`);
    }
    const profile = PROJECT_KINGS_PILOT_PROFILES[candidate.profileKey];
    const assessment = await runProjectKingsSourcePolicyAssessment({
      repoRoot,
      runId: `${requestId}:${candidate.candidateId}`,
      candidate: {
        candidateId: candidate.candidateId,
        profileKey: candidate.profileKey,
        channelId: profile.youtube.channelId,
        profileVersion: profile.profileVersion,
        sourceUrl: candidate.sourceUrl,
        contentSha256: candidate.media.contentSha256,
        mediaPath
      },
      ocrEvidence: extracted.ocr,
      asrEvidence: extracted.asr,
      selection: manifest.selections.source_policy,
      invoker,
      temporaryRoot: path.join(repoRoot, ".data/project-kings/catalog-source-policy/tmp")
    });
    return assessment.assessment;
  }
});
await atomicWrite(outputPath, `${JSON.stringify(result.artifacts, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  schemaVersion: result.schemaVersion,
  inventoryPath: path.relative(repoRoot, inventoryPath),
  liveInventorySha256: readiness.liveInventorySha256,
  manifestId: manifest.manifestId,
  manifestSha256: manifest.manifestSha256,
  sourcePolicySelection: {
    routeId: manifest.selections.source_policy.primary.route.routeId,
    model: manifest.selections.source_policy.primary.route.model,
    reasoningEffort: manifest.selections.source_policy.primary.benchmark.reasoningEffort,
    fallbackMode: manifest.selections.source_policy.fallbackMode
  },
  requestedCandidateIds: result.requestedCandidateIds,
  resumedCandidateIds: result.resumedCandidateIds,
  assessedCandidateIds: result.assessedCandidateIds,
  outputPath: path.relative(repoRoot, outputPath),
  artifactCount: result.artifacts.length,
  resultSha256: result.resultSha256
}, null, 2)}\n`);
