import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import contractsModule from "../lib/project-kings/production-agent-contracts";
import runtimeModule from "../lib/project-kings/production-agent-runtime";
import manifestModule from "../lib/project-kings/production-model-route-manifest";
import profileStoreModule from "../lib/project-kings/pilot-profile-store";
import profilesModule from "../lib/project-kings/pilot-production-profiles";
import readinessModule from "../lib/project-kings/source-buffer-readiness";
import type {
  ProductionAgentArtifact,
  SourceFitOutput,
  SourceFitPacket
} from "../lib/project-kings/production-agent-contracts";
import type {
  ProjectKingsPilotProfileKey
} from "../lib/project-kings/pilot-production-profiles";
import type {
  ProjectKingsSourceFitAttestation,
  ProjectKingsSourceMediaInspection
} from "../lib/project-kings/source-buffer-readiness";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const EVIDENCE_ROOT = path.join(REPO_ROOT, "docs/project-kings-production-pipeline-v1/evidence");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.join(REPO_ROOT, value);
}

const INVENTORY_PATH = resolveFromRoot(
  argument("--inventory") ??
    "docs/project-kings-production-pipeline-v1/evidence/live-publication-inventory-2026-07-10.json"
);

const OUTPUT_PATH = resolveFromRoot(
  argument("--output") ?? "docs/project-kings-production-pipeline-v1/evidence/source-fit-attestations-2026-07-10-v3.json"
);

const { validateProductionAgentOutput } = contractsModule;
const { createCodexProductionAgentInvoker, runProductionSemanticAgent } = runtimeModule;
const { parseFrozenProductionAgentRouteManifest } = manifestModule;
const { PROJECT_KINGS_PILOT_PROFILES } = profilesModule;
const { PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID } = profileStoreModule;
const MANIFEST_PATH = path.join(EVIDENCE_ROOT, `${PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID}.json`);
const {
  auditProjectKingsSourceBufferReadiness,
  calculateProjectKingsLiveInventorySha256,
  parseProjectKingsLivePublicationInventory
} = readinessModule;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

async function fileSha256(filePath: string): Promise<string> {
  return sha256(await fs.readFile(filePath));
}

async function writeArtifact(input: {
  root: string;
  id: string;
  kind: ProductionAgentArtifact["kind"];
  value: unknown;
}): Promise<ProductionAgentArtifact> {
  const filePath = path.join(input.root, `${input.id}.json`);
  const content = `${JSON.stringify(input.value, null, 2)}\n`;
  await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  return { id: input.id, kind: input.kind, mediaType: "json", path: filePath, sha256: sha256(content) };
}

async function extractFrames(input: {
  root: string;
  mediaPath: string;
  media: ProjectKingsSourceMediaInspection;
}): Promise<ProductionAgentArtifact[]> {
  const durationSec = Math.max(0.5, (input.media.durationMs ?? 3_000) / 1_000);
  const timestamps = [0.15, 0.5, 0.85].map((ratio) => Math.max(0, Math.min(durationSec - 0.05, durationSec * ratio)));
  const frames: ProductionAgentArtifact[] = [];
  for (const [index, timestamp] of timestamps.entries()) {
    const filePath = path.join(input.root, `frame-${index + 1}.jpg`);
    await execFileAsync("ffmpeg", [
      "-nostdin", "-v", "error", "-ss", timestamp.toFixed(3), "-i", input.mediaPath,
      "-frames:v", "1", "-vf", "scale=720:-2:force_original_aspect_ratio=decrease", "-q:v", "2", filePath
    ], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    frames.push({
      id: `key-frame-${index + 1}`,
      kind: "key_frame",
      mediaType: "image",
      path: filePath,
      sha256: await fileSha256(filePath)
    });
  }
  return frames;
}

async function mapConcurrent<T, R>(values: readonly T[], limit: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      output[index] = await worker(values[index]!);
    }
  }));
  return output;
}

const normalizeFromIndex = process.argv.indexOf("--normalize-from");
if (normalizeFromIndex >= 0) {
  const configured = process.argv[normalizeFromIndex + 1];
  if (!configured) throw new Error("--normalize-from requires a JSON file path.");
  const sourcePath = path.isAbsolute(configured) ? configured : path.join(REPO_ROOT, configured);
  const legacy = JSON.parse(await fs.readFile(sourcePath, "utf8")) as Array<
    Omit<ProjectKingsSourceFitAttestation, "rawOutputSha256"> & { outputSha256: string }
  >;
  const normalized: ProjectKingsSourceFitAttestation[] = legacy.map((entry) => {
    const output = validateProductionAgentOutput("source_fit", entry.output) as SourceFitOutput;
    return {
      ...entry,
      rawOutputSha256: entry.outputSha256,
      outputSha256: sha256(stableJson(output)),
      output
    };
  });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${path.relative(REPO_ROOT, OUTPUT_PATH)} normalized=${normalized.length}\n`);
  process.exit(0);
}

const mergeArgument = argument("--merge");
if (mergeArgument) {
  const merged = new Map<string, ProjectKingsSourceFitAttestation>();
  for (const configured of mergeArgument.split(",").map((value) => value.trim()).filter(Boolean)) {
    const entries = JSON.parse(await fs.readFile(resolveFromRoot(configured), "utf8")) as ProjectKingsSourceFitAttestation[];
    for (const entry of entries) {
      const output = validateProductionAgentOutput("source_fit", entry.output) as SourceFitOutput;
      if (entry.outputSha256 !== sha256(stableJson(output))) {
        throw new Error(`${entry.candidateId} has an invalid structured output hash.`);
      }
      merged.set(entry.candidateId, { ...entry, output });
    }
  }
  const entries = [...merged.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(entries, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${path.relative(REPO_ROOT, OUTPUT_PATH)} merged=${entries.length}\n`);
  process.exit(0);
}

const liveInventory = parseProjectKingsLivePublicationInventory(JSON.parse(await fs.readFile(INVENTORY_PATH, "utf8")));
const liveInventorySha256 = calculateProjectKingsLiveInventorySha256(liveInventory);
const readiness = await auditProjectKingsSourceBufferReadiness({
  repoRoot: REPO_ROOT,
  liveInventory,
  capturedAt: new Date().toISOString()
});
const manifest = parseFrozenProductionAgentRouteManifest(JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")));
const invoker = createCodexProductionAgentInvoker({
  repoCwd: REPO_ROOT,
  codexHome: process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex")
});

const requestedCandidateIds = new Set(
  (argument("--candidate-ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean)
);
const candidates = readiness.channels.flatMap((channel) => channel.candidates
  .filter((candidate) => candidate.localMedia.selected && candidate.rightsStatus === "owner_approved_source_pool")
  .filter((candidate) => requestedCandidateIds.size === 0 || requestedCandidateIds.has(candidate.candidateId))
  .map((candidate) => ({ channel, candidate })));
const knownSourceSha256 = candidates
  .map(({ candidate }) => candidate.localMedia.selected!.contentSha256);
const knownStoryEventIds = candidates
  .map(({ candidate }) => candidate.storyEventId)
  .filter((value): value is string => Boolean(value));

const attestations = await mapConcurrent(candidates, 3, async ({ channel, candidate }) => {
  if (!candidate.storyEventId || !candidate.localMedia.selected) {
    throw new Error(`${candidate.candidateId} has no event or exact media binding.`);
  }
  const profileKey = channel.profileKey as ProjectKingsPilotProfileKey;
  const profile = PROJECT_KINGS_PILOT_PROFILES[profileKey];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `project-kings-source-fit-${candidate.candidateId}-`));
  try {
    const mediaPath = path.join(REPO_ROOT, candidate.localMedia.selected.relativePath);
    const concept = await writeArtifact({ root, id: "concept-contract", kind: "concept_contract", value: profile });
    const metadata = await writeArtifact({
      root,
      id: "source-metadata",
      kind: "source_metadata",
      value: {
        candidateId: candidate.candidateId,
        sourceUrl: candidate.sourceUrl,
        claimedStoryEventId: candidate.storyEventId,
        media: candidate.localMedia.selected,
        discoveryRoutes: candidate.discoveryRoutes,
        findings: candidate.findings
      }
    });
    const frames = await extractFrames({ root, mediaPath, media: candidate.localMedia.selected });
    const artifacts = [concept, metadata, ...frames];
    const packet: SourceFitPacket = {
      schemaVersion: "production-agent-packet-v1",
      role: "source_fit",
      runId: `project-kings-source-buffer-${liveInventory.capturedAt.slice(0, 10)}`,
      itemId: candidate.candidateId,
      channelId: profile.youtube.channelId,
      profileVersion: String(profile.profileVersion),
      task: {
        candidateId: candidate.candidateId,
        sourceUrl: candidate.sourceUrl,
        sourceSha256: candidate.localMedia.selected.contentSha256,
        claimedStoryEventId: candidate.storyEventId,
        knownSourceSha256: knownSourceSha256.filter((value) => value !== candidate.localMedia.selected!.contentSha256),
        knownStoryEventIds: knownStoryEventIds.filter((value) => value !== candidate.storyEventId)
      },
      artifacts
    };
    const result = await runProductionSemanticAgent({
      role: "source_fit",
      packet,
      selection: manifest.selections.source_fit,
      invoker,
      maxAttempts: 2
    });
    const output = validateProductionAgentOutput("source_fit", result.output) as SourceFitOutput;
    const attempt = result.attempts.find((entry) => entry.outcome === "passed");
    if (!attempt?.outputSha256) throw new Error(`${candidate.candidateId} has no successful hash-bound model attempt.`);
    const attestation: ProjectKingsSourceFitAttestation = {
      candidateId: candidate.candidateId,
      profileKey,
      sourceUrl: candidate.sourceUrl,
      contentSha256: candidate.localMedia.selected.contentSha256,
      profileHash: channel.profileHash,
      liveInventorySha256,
      agentAttemptId: `source-fit-${sha256(`${attempt.promptSha256}:${attempt.outputSha256}`).slice(0, 32)}`,
      model: attempt.model,
      reasoningLevel: attempt.reasoningEffort,
      promptSha256: attempt.promptSha256,
      artifactSetSha256: sha256(artifacts.map((artifact) => `${artifact.id}:${artifact.sha256}`).sort().join("\n")),
      rawOutputSha256: attempt.outputSha256,
      outputSha256: sha256(stableJson(output)),
      finishedAt: new Date(Date.parse(attempt.startedAt) + attempt.durationMs).toISOString(),
      output
    };
    process.stdout.write(`${candidate.candidateId}: ${output.decision} (${attempt.model}/${attempt.reasoningEffort})\n`);
    return attestation;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(attestations, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${path.relative(REPO_ROOT, OUTPUT_PATH)} candidates=${attestations.length}\n`);
