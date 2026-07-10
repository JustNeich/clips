import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  PRODUCTION_SOURCE_POLICY_CLASSES,
  validateProductionAgentOutput,
  type ProductionAgentArtifact,
  type SourcePolicyOutput,
  type SourcePolicyPacket
} from "./production-agent-contracts";
import {
  runProductionSemanticAgent,
  type ProductionAgentAttemptTelemetry,
  type ProductionAgentInvoker,
  type ProductionAgentModelSelection
} from "./production-agent-runtime";
import type { ProjectKingsPilotProfileKey } from "./pilot-production-profiles";
import {
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION,
  createProjectKingsSensitiveContentAssessment,
  hashProjectKingsSourcePolicyArtifact,
  type ProjectKingsSensitiveContentAssessment
} from "./source-rights-sensitive-policy";

export const PROJECT_KINGS_SOURCE_POLICY_ASSESSMENT_RUN_VERSION =
  "project-kings-source-policy-assessment-run-v1" as const;

export type ProjectKingsSourcePolicyTextEvidence = Readonly<{
  artifactId: string;
  filePath: string;
  sha256: string;
}>;

export type ProjectKingsSourcePolicyFrameExtraction = Readonly<{
  filePath: string;
  timestampMs: number;
}>;

export type ProjectKingsSourcePolicyAssessmentCandidate = Readonly<{
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  channelId: string;
  profileVersion: string;
  sourceUrl: string;
  contentSha256: string;
  mediaPath: string;
}>;

export type ProjectKingsSourcePolicyFrameExtractor = (input: Readonly<{
  mediaPath: string;
  outputDirectory: string;
  frameCount: number;
  ffmpegPath: string;
  ffprobePath: string;
}>) => Promise<readonly ProjectKingsSourcePolicyFrameExtraction[]>;

export type RunProjectKingsSourcePolicyAssessmentInput = Readonly<{
  repoRoot: string;
  candidate: ProjectKingsSourcePolicyAssessmentCandidate;
  ocrEvidence: ProjectKingsSourcePolicyTextEvidence;
  asrEvidence: ProjectKingsSourcePolicyTextEvidence;
  selection: ProductionAgentModelSelection;
  invoker: ProductionAgentInvoker;
  runId?: string;
  frameCount?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  temporaryRoot?: string;
  extractFrames?: ProjectKingsSourcePolicyFrameExtractor;
  now?: () => Date;
  monotonicNowMs?: () => number;
}>;

export type ProjectKingsSourcePolicyAssessmentRunResult = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_SOURCE_POLICY_ASSESSMENT_RUN_VERSION;
  candidateId: string;
  contentSha256: string;
  policyVersion: typeof PROJECT_KINGS_SOURCE_POLICY_VERSION;
  policySha256: typeof PROJECT_KINGS_SOURCE_POLICY_SHA256;
  assessment: ProjectKingsSensitiveContentAssessment;
  semanticOutput: SourcePolicyOutput;
  selectedRouteId: string;
  attempt: ProductionAgentAttemptTelemetry;
  attempts: readonly ProductionAgentAttemptTelemetry[];
  attemptEvidenceSha256: string;
  artifactSetSha256: string;
  packetBindingSha256: string;
}>;

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;

function requiredText(value: string, label: string, maxLength = 2_000): string {
  if (!value.trim() || value !== value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function requiredSha256(value: string, label: string): string {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256.`);
  return value;
}

function resolveFrozenPath(repoRoot: string, configuredPath: string, label: string): string {
  const root = path.resolve(repoRoot);
  const absolutePath = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(root, configuredPath);
  const boundary = path.relative(root, absolutePath);
  if (!boundary || boundary.startsWith("..") || path.isAbsolute(boundary)) {
    throw new Error(`${label} must resolve to a frozen file inside repoRoot.`);
  }
  return absolutePath;
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

async function verifyFrozenArtifact(
  repoRoot: string,
  evidence: ProjectKingsSourcePolicyTextEvidence,
  label: string
): Promise<string> {
  requiredText(evidence.artifactId, `${label}.artifactId`, 160);
  const expectedSha256 = requiredSha256(evidence.sha256, `${label}.sha256`);
  const filePath = resolveFrozenPath(repoRoot, evidence.filePath, `${label}.filePath`);
  if ((await sha256File(filePath)) !== expectedSha256) {
    throw new Error(`${label} bytes differ from their frozen SHA-256.`);
  }
  return filePath;
}

async function defaultExtractFrames(
  input: Parameters<ProjectKingsSourcePolicyFrameExtractor>[0]
): Promise<readonly ProjectKingsSourcePolicyFrameExtraction[]> {
  const { stdout } = await execFileAsync(
    input.ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      input.mediaPath
    ],
    { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
  );
  const durationSec = Number(stdout.trim());
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Frozen candidate media has no valid duration.");
  }
  const frames: ProjectKingsSourcePolicyFrameExtraction[] = [];
  for (let index = 0; index < input.frameCount; index += 1) {
    const ratio = (index + 0.5) / input.frameCount;
    const timestampSec = Math.max(
      0,
      Math.min(durationSec - 0.02, durationSec * ratio)
    );
    const filePath = path.join(
      input.outputDirectory,
      `key-frame-${String(index + 1).padStart(2, "0")}.jpg`
    );
    await execFileAsync(
      input.ffmpegPath,
      [
        "-nostdin",
        "-v",
        "error",
        "-ss",
        timestampSec.toFixed(3),
        "-i",
        input.mediaPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=960:-2:force_original_aspect_ratio=decrease",
        "-q:v",
        "2",
        "-n",
        filePath
      ],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
    );
    frames.push({ filePath, timestampMs: Math.round(timestampSec * 1_000) });
  }
  return frames;
}

function orderedArtifactSetSha256(
  artifacts: readonly ProductionAgentArtifact[]
): string {
  return hashProjectKingsSourcePolicyArtifact(
    artifacts.map((artifact, index) => ({
      index,
      id: artifact.id,
      kind: artifact.kind,
      sha256: artifact.sha256
    }))
  );
}

async function writeSourceMetadata(input: {
  outputDirectory: string;
  candidate: ProjectKingsSourcePolicyAssessmentCandidate;
  frameOrder: readonly Readonly<{
    artifactId: string;
    timestampMs: number;
    sha256: string;
  }>[];
}): Promise<ProductionAgentArtifact> {
  const filePath = path.join(input.outputDirectory, "source-policy-metadata.json");
  const payload = {
    candidateId: input.candidate.candidateId,
    profileKey: input.candidate.profileKey,
    sourceUrl: input.candidate.sourceUrl,
    contentSha256: input.candidate.contentSha256,
    policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
    policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
    prohibitedClasses: PRODUCTION_SOURCE_POLICY_CLASSES,
    orderedFrames: input.frameOrder
  };
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  return {
    id: "source-policy-metadata",
    kind: "source_metadata",
    mediaType: "json",
    path: filePath,
    sha256: createHash("sha256").update(content).digest("hex")
  };
}

export async function runProjectKingsSourcePolicyAssessment(
  input: RunProjectKingsSourcePolicyAssessmentInput
): Promise<ProjectKingsSourcePolicyAssessmentRunResult> {
  const candidate = input.candidate;
  requiredText(candidate.candidateId, "candidate.candidateId", 160);
  requiredText(candidate.sourceUrl, "candidate.sourceUrl");
  if (!candidate.sourceUrl.startsWith("https://")) {
    throw new Error("candidate.sourceUrl must use HTTPS.");
  }
  requiredSha256(candidate.contentSha256, "candidate.contentSha256");
  const frameCount = input.frameCount ?? 5;
  if (!Number.isInteger(frameCount) || frameCount < 3 || frameCount > 12) {
    throw new Error("frameCount must be an integer between 3 and 12.");
  }
  const mediaPath = resolveFrozenPath(
    input.repoRoot,
    candidate.mediaPath,
    "candidate.mediaPath"
  );
  if ((await sha256File(mediaPath)) !== candidate.contentSha256) {
    throw new Error("Frozen candidate media differs from candidate.contentSha256.");
  }
  const [ocrPath, asrPath] = await Promise.all([
    verifyFrozenArtifact(input.repoRoot, input.ocrEvidence, "ocrEvidence"),
    verifyFrozenArtifact(input.repoRoot, input.asrEvidence, "asrEvidence")
  ]);
  if (input.ocrEvidence.artifactId === input.asrEvidence.artifactId) {
    throw new Error("OCR and ASR artifact IDs must be distinct.");
  }

  const temporaryRoot = path.resolve(input.temporaryRoot ?? os.tmpdir());
  await fs.mkdir(temporaryRoot, { recursive: true });
  const workingDirectory = await fs.mkdtemp(
    path.join(temporaryRoot, `project-kings-source-policy-${candidate.candidateId}-`)
  );
  try {
    const extracted = await (input.extractFrames ?? defaultExtractFrames)({
      mediaPath,
      outputDirectory: workingDirectory,
      frameCount,
      ffmpegPath: input.ffmpegPath ?? "ffmpeg",
      ffprobePath: input.ffprobePath ?? "ffprobe"
    });
    if (extracted.length !== frameCount) {
      throw new Error(`Frame extractor returned ${extracted.length}/${frameCount} ordered frames.`);
    }
    let previousTimestampMs = -1;
    const frameArtifacts: ProductionAgentArtifact[] = [];
    const frameOrder: Array<{
      artifactId: string;
      timestampMs: number;
      sha256: string;
    }> = [];
    for (const [index, frame] of extracted.entries()) {
      if (
        !Number.isInteger(frame.timestampMs) ||
        frame.timestampMs < 0 ||
        frame.timestampMs <= previousTimestampMs
      ) {
        throw new Error("Extracted key frames must have strictly increasing timestamps.");
      }
      previousTimestampMs = frame.timestampMs;
      const framePath = path.resolve(frame.filePath);
      const frameBoundary = path.relative(workingDirectory, framePath);
      if (
        !frameBoundary ||
        frameBoundary.startsWith("..") ||
        path.isAbsolute(frameBoundary)
      ) {
        throw new Error("Extracted key frame escaped the runner working directory.");
      }
      const frameSha256 = await sha256File(framePath);
      const artifactId = `source-key-frame-${String(index + 1).padStart(2, "0")}`;
      frameArtifacts.push({
        id: artifactId,
        kind: "key_frame",
        mediaType: "image",
        path: framePath,
        sha256: frameSha256
      });
      frameOrder.push({ artifactId, timestampMs: frame.timestampMs, sha256: frameSha256 });
    }
    const metadata = await writeSourceMetadata({
      outputDirectory: workingDirectory,
      candidate,
      frameOrder
    });
    const ocrArtifact: ProductionAgentArtifact = {
      id: input.ocrEvidence.artifactId,
      kind: "ocr",
      mediaType: "text",
      path: ocrPath,
      sha256: input.ocrEvidence.sha256
    };
    const asrArtifact: ProductionAgentArtifact = {
      id: input.asrEvidence.artifactId,
      kind: "transcript",
      mediaType: "text",
      path: asrPath,
      sha256: input.asrEvidence.sha256
    };
    const artifacts = [metadata, ...frameArtifacts, ocrArtifact, asrArtifact];
    const packet: SourcePolicyPacket = {
      schemaVersion: "production-agent-packet-v1",
      role: "source_policy",
      runId: input.runId ?? `source-policy-${candidate.candidateId}`,
      itemId: candidate.candidateId,
      channelId: candidate.channelId,
      profileVersion: candidate.profileVersion,
      task: {
        candidateId: candidate.candidateId,
        sourceUrl: candidate.sourceUrl,
        contentSha256: candidate.contentSha256,
        profileKey: candidate.profileKey,
        policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
        policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
        prohibitedClasses: PRODUCTION_SOURCE_POLICY_CLASSES,
        orderedKeyFrameArtifactIds: frameArtifacts.map((artifact) => artifact.id),
        ocrArtifactId: ocrArtifact.id,
        asrArtifactId: asrArtifact.id,
        sourceMetadataArtifactId: metadata.id
      },
      artifacts
    };
    const run = await runProductionSemanticAgent({
      role: "source_policy",
      packet,
      selection: input.selection,
      invoker: input.invoker,
      maxAttempts: 2,
      now: input.now,
      monotonicNowMs: input.monotonicNowMs
    });
    const semanticOutput = validateProductionAgentOutput(
      "source_policy",
      run.output
    );
    const attempt = run.attempts.find((entry) => entry.outcome === "passed");
    if (!attempt?.outputSha256) {
      throw new Error("Source policy runner has no successful hash-bound model attempt.");
    }
    const artifactSetSha256 = orderedArtifactSetSha256(artifacts);
    const packetBindingSha256 = hashProjectKingsSourcePolicyArtifact({
      role: packet.role,
      runId: packet.runId,
      itemId: packet.itemId,
      channelId: packet.channelId,
      profileVersion: packet.profileVersion,
      task: packet.task,
      artifactSetSha256
    });
    const attemptEvidenceSha256 = hashProjectKingsSourcePolicyArtifact({
      schemaVersion: PROJECT_KINGS_SOURCE_POLICY_ASSESSMENT_RUN_VERSION,
      candidateId: candidate.candidateId,
      contentSha256: candidate.contentSha256,
      packetBindingSha256,
      artifactSetSha256,
      attempt,
      semanticOutput
    });
    const assessment = createProjectKingsSensitiveContentAssessment({
      candidateId: candidate.candidateId,
      contentSha256: candidate.contentSha256,
      upstreamEvidenceSha256: attemptEvidenceSha256,
      signals: semanticOutput.signals
    });
    return Object.freeze({
      schemaVersion: PROJECT_KINGS_SOURCE_POLICY_ASSESSMENT_RUN_VERSION,
      candidateId: candidate.candidateId,
      contentSha256: candidate.contentSha256,
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      assessment,
      semanticOutput,
      selectedRouteId: run.selectedRouteId,
      attempt,
      attempts: run.attempts,
      attemptEvidenceSha256,
      artifactSetSha256,
      packetBindingSha256
    });
  } finally {
    await fs.rm(workingDirectory, { recursive: true, force: true });
  }
}
