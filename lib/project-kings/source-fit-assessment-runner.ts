import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

import {
  validateProductionAgentOutput,
  type ProductionAgentArtifact,
  type SourceFitOutput,
  type SourceFitPacket
} from "./production-agent-contracts";
import {
  runProductionSemanticAgent,
  type ProductionAgentAttemptTelemetry,
  type ProductionAgentInvoker,
  type ProductionAgentModelSelection
} from "./production-agent-runtime";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "./pilot-production-profiles";
import { calculateProductionProfileHash } from "./pilot-profile-store";
import type {
  ProjectKingsSourceFitAttestation,
  ProjectKingsSourceMediaInspection
} from "./source-buffer-readiness";

export const PROJECT_KINGS_SOURCE_FIT_RUN_VERSION =
  "project-kings-source-fit-run-v1" as const;

export type ProjectKingsSourceFitArtifact = Readonly<{
  id: string;
  kind: "key_frame" | "ocr" | "transcript";
  mediaType: "image" | "text";
  filePath: string;
  sha256: string;
}>;

export type RunProjectKingsSourceFitAssessmentInput = Readonly<{
  repoRoot: string;
  runId: string;
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  sourceUrl: string;
  provisionalStoryEventId: string;
  media: ProjectKingsSourceMediaInspection;
  mediaPath: string;
  liveInventorySha256: string;
  knownSourceSha256: readonly string[];
  knownStoryEventIds: readonly string[];
  discoveryEvidence: unknown;
  artifacts: readonly ProjectKingsSourceFitArtifact[];
  selection: ProductionAgentModelSelection;
  invoker: ProductionAgentInvoker;
  temporaryRoot?: string;
  now?: () => Date;
  monotonicNowMs?: () => number;
}>;

export type ProjectKingsSourceFitRunResult = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_SOURCE_FIT_RUN_VERSION;
  output: SourceFitOutput;
  attestation: ProjectKingsSourceFitAttestation;
  selectedRouteId: string;
  attempt: ProductionAgentAttemptTelemetry;
  attempts: readonly ProductionAgentAttemptTelemetry[];
  packetBindingSha256: string;
}>;

const SHA256 = /^[a-f0-9]{64}$/;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function exactRepoPath(repoRoot: string, configuredPath: string, label: string): string {
  const root = path.resolve(repoRoot);
  const absolute = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(root, configuredPath);
  const boundary = path.relative(root, absolute);
  if (!boundary || boundary.startsWith("..") || path.isAbsolute(boundary)) {
    throw new Error(`${label} must resolve to a file inside repoRoot.`);
  }
  return absolute;
}

async function verifySourceFitArtifact(
  repoRoot: string,
  artifact: ProjectKingsSourceFitArtifact
): Promise<ProductionAgentArtifact> {
  if (!artifact.id.trim() || !SHA256.test(artifact.sha256)) {
    throw new Error("Source Fit artifact identity or SHA-256 is invalid.");
  }
  const filePath = exactRepoPath(repoRoot, artifact.filePath, `artifact ${artifact.id}`);
  if ((await sha256File(filePath)) !== artifact.sha256) {
    throw new Error(`Source Fit artifact ${artifact.id} bytes changed.`);
  }
  return {
    id: artifact.id,
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    path: filePath,
    sha256: artifact.sha256
  };
}

async function writeJsonArtifact(input: {
  directory: string;
  id: string;
  kind: "concept_contract" | "source_metadata";
  value: unknown;
}): Promise<ProductionAgentArtifact> {
  const filePath = path.join(input.directory, `${input.id}.json`);
  const content = `${JSON.stringify(input.value, null, 2)}\n`;
  await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  return {
    id: input.id,
    kind: input.kind,
    mediaType: "json",
    path: filePath,
    sha256: sha256(content)
  };
}

export async function runProjectKingsSourceFitAssessment(
  input: RunProjectKingsSourceFitAssessmentInput
): Promise<ProjectKingsSourceFitRunResult> {
  const profile = PROJECT_KINGS_PILOT_PROFILES[input.profileKey];
  if (!input.candidateId.trim() || !input.provisionalStoryEventId.trim()) {
    throw new Error("Source Fit candidate and provisional event identities are required.");
  }
  if (!input.sourceUrl.startsWith("https://")) {
    throw new Error("Source Fit sourceUrl must use HTTPS.");
  }
  if (!SHA256.test(input.liveInventorySha256) || !SHA256.test(input.media.contentSha256)) {
    throw new Error("Source Fit input hashes are invalid.");
  }
  if (!input.media.decodeComplete) {
    throw new Error("Source Fit refuses media that did not fully decode.");
  }
  const mediaPath = exactRepoPath(input.repoRoot, input.mediaPath, "mediaPath");
  if ((await sha256File(mediaPath)) !== input.media.contentSha256) {
    throw new Error("Source Fit media bytes differ from the inspected content hash.");
  }
  const suppliedArtifacts = await Promise.all(
    input.artifacts.map((artifact) => verifySourceFitArtifact(input.repoRoot, artifact))
  );
  if (!suppliedArtifacts.some((artifact) => artifact.kind === "key_frame")) {
    throw new Error("Source Fit requires at least one hash-bound key frame.");
  }
  if (!suppliedArtifacts.some((artifact) => artifact.kind === "ocr")) {
    throw new Error("Source Fit requires hash-bound OCR evidence.");
  }
  if (!suppliedArtifacts.some((artifact) => artifact.kind === "transcript")) {
    throw new Error("Source Fit requires hash-bound ASR evidence.");
  }

  const temporaryRoot = exactRepoPath(
    input.repoRoot,
    input.temporaryRoot ?? ".data/project-kings/source-refill/tmp",
    "temporaryRoot"
  );
  await fs.mkdir(temporaryRoot, { recursive: true });
  const workingDirectory = await fs.mkdtemp(
    path.join(temporaryRoot, `source-fit-${input.candidateId}-`)
  );
  try {
    const concept = await writeJsonArtifact({
      directory: workingDirectory,
      id: "concept-contract",
      kind: "concept_contract",
      value: profile.concept
    });
    const metadata = await writeJsonArtifact({
      directory: workingDirectory,
      id: "source-metadata",
      kind: "source_metadata",
      value: {
        candidateId: input.candidateId,
        profileKey: input.profileKey,
        sourceUrl: input.sourceUrl,
        provisionalStoryEventId: input.provisionalStoryEventId,
        media: input.media,
        discoveryEvidence: input.discoveryEvidence
      }
    });
    const artifacts = [concept, metadata, ...suppliedArtifacts];
    const packet: SourceFitPacket = {
      schemaVersion: "production-agent-packet-v1",
      role: "source_fit",
      runId: input.runId,
      itemId: input.candidateId,
      channelId: profile.youtube.channelId,
      profileVersion: profile.profileVersion,
      task: {
        candidateId: input.candidateId,
        sourceUrl: input.sourceUrl,
        sourceSha256: input.media.contentSha256,
        claimedStoryEventId: input.provisionalStoryEventId,
        knownSourceSha256: [...new Set(input.knownSourceSha256)].sort(),
        knownStoryEventIds: [...new Set(input.knownStoryEventIds)].sort()
      },
      artifacts
    };
    const run = await runProductionSemanticAgent({
      role: "source_fit",
      packet,
      selection: input.selection,
      invoker: input.invoker,
      maxAttempts: 2,
      now: input.now,
      monotonicNowMs: input.monotonicNowMs
    });
    const output = validateProductionAgentOutput("source_fit", run.output);
    const successfulAttempt = run.attempts.find((attempt) => attempt.outcome === "passed");
    if (!successfulAttempt?.outputSha256) {
      throw new Error("Source Fit has no successful hash-bound model attempt.");
    }
    if (input.knownSourceSha256.includes(input.media.contentSha256)) {
      throw new Error("Source Fit deterministic gate detected duplicate content bytes.");
    }
    if (input.knownStoryEventIds.includes(output.storyEventId)) {
      throw new Error("Source Fit deterministic gate detected a duplicate story event.");
    }
    const artifactSetSha256 = sha256(
      artifacts
        .map((artifact) => `${artifact.id}:${artifact.sha256}`)
        .sort()
        .join("\n")
    );
    const outputSha256 = sha256(stableJson(output));
    const finishedAt = new Date(
      Date.parse(successfulAttempt.startedAt) + successfulAttempt.durationMs
    ).toISOString();
    const attestation: ProjectKingsSourceFitAttestation = {
      candidateId: input.candidateId,
      profileKey: input.profileKey,
      sourceUrl: input.sourceUrl,
      contentSha256: input.media.contentSha256,
      profileHash: calculateProductionProfileHash(profile),
      liveInventorySha256: input.liveInventorySha256,
      agentAttemptId: `source-fit-${sha256(
        `${successfulAttempt.promptSha256}:${successfulAttempt.outputSha256}`
      ).slice(0, 32)}`,
      model: successfulAttempt.model,
      reasoningLevel: successfulAttempt.reasoningEffort,
      promptSha256: successfulAttempt.promptSha256,
      artifactSetSha256,
      rawOutputSha256: successfulAttempt.outputSha256,
      outputSha256,
      finishedAt,
      output
    };
    return Object.freeze({
      schemaVersion: PROJECT_KINGS_SOURCE_FIT_RUN_VERSION,
      output,
      attestation,
      selectedRouteId: run.selectedRouteId,
      attempt: successfulAttempt,
      attempts: run.attempts,
      packetBindingSha256: sha256(
        stableJson({
          role: packet.role,
          runId: packet.runId,
          itemId: packet.itemId,
          channelId: packet.channelId,
          profileVersion: packet.profileVersion,
          task: packet.task,
          artifactSetSha256
        })
      )
    });
  } finally {
    await fs.rm(workingDirectory, { recursive: true, force: true });
  }
}
