import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

import {
  PRODUCTION_SOURCE_POLICY_CLASSES,
  validateProductionAgentPacket,
  type ProductionAgentArtifact,
  type SourcePolicyPacket
} from "./production-agent-contracts";
import {
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION,
  type ProjectKingsSensitiveSignal
} from "./source-rights-sensitive-policy";
import type {
  StageModelBenchmarkCase,
  StageModelBenchmarkDataset
} from "./model-benchmark";

export const PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_SAMPLE_SIZE = 30 as const;
export const PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_DATASET_PATH =
  "docs/project-kings-production-pipeline-v1/evidence/source-policy-benchmark-real-30-v1/dataset.json" as const;
export const PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_ANNOTATIONS_PATH =
  "docs/project-kings-production-pipeline-v1/evidence/source-policy-benchmark-real-30-v1/annotations.json" as const;

const DATASET_SCHEMA_VERSION = "project-kings-source-policy-dataset-v1";
const ANNOTATION_SCHEMA_VERSION = "project-kings-source-policy-annotations-v1";
const SHA256 = /^[a-f0-9]{64}$/;
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const SIGNALS = ["absent", "present", "unknown"] as const;
const SIGNAL_KEYS = [
  "graphicViolence",
  "unsupportedAllegation",
  "minorInSensitiveIncident",
  "realisticPoliticalOrPublicFigureDeepfake"
] as const;

export type ProjectKingsSourcePolicyBenchmarkSignals = Readonly<{
  graphicViolence: ProjectKingsSensitiveSignal;
  unsupportedAllegation: ProjectKingsSensitiveSignal;
  minorInSensitiveIncident: ProjectKingsSensitiveSignal;
  realisticPoliticalOrPublicFigureDeepfake: ProjectKingsSensitiveSignal;
}>;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function text(value: unknown, label: string, max = 4_000): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value as number;
}

function sha256(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!SHA256.test(result)) throw new Error(`${label} must be a lowercase SHA-256.`);
  return result;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

async function hashFile(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function resolveInside(repoRoot: string, configuredPath: string, label: string): string {
  if (path.isAbsolute(configuredPath)) throw new Error(`${label} must be repository-relative.`);
  const resolved = path.resolve(repoRoot, configuredPath);
  const boundary = path.relative(path.resolve(repoRoot), resolved);
  if (!boundary || boundary.startsWith("..") || path.isAbsolute(boundary)) {
    throw new Error(`${label} must resolve inside repoRoot.`);
  }
  return resolved;
}

async function verifyFile(
  repoRoot: string,
  configuredPath: unknown,
  expectedSha256: unknown,
  label: string
): Promise<{ filePath: string; sha256: string }> {
  const relativePath = text(configuredPath, `${label}.relativePath`);
  const expected = sha256(expectedSha256, `${label}.sha256`);
  const filePath = resolveInside(repoRoot, relativePath, `${label}.relativePath`);
  const actual = await hashFile(filePath);
  if (actual !== expected) throw new Error(`${label} bytes differ from frozen SHA-256.`);
  return { filePath, sha256: expected };
}

function signal(value: unknown, label: string): ProjectKingsSensitiveSignal {
  if (!SIGNALS.includes(value as ProjectKingsSensitiveSignal)) {
    throw new Error(`${label} must be absent, present, or unknown.`);
  }
  return value as ProjectKingsSensitiveSignal;
}

function parseSignals(value: unknown, label: string): ProjectKingsSourcePolicyBenchmarkSignals {
  const raw = record(value, label);
  if (
    Object.keys(raw).length !== SIGNAL_KEYS.length ||
    SIGNAL_KEYS.some((key) => !(key in raw))
  ) {
    throw new Error(`${label} must contain the exact four source-policy signals.`);
  }
  return {
    graphicViolence: signal(raw.graphicViolence, `${label}.graphicViolence`),
    unsupportedAllegation: signal(raw.unsupportedAllegation, `${label}.unsupportedAllegation`),
    minorInSensitiveIncident: signal(raw.minorInSensitiveIncident, `${label}.minorInSensitiveIncident`),
    realisticPoliticalOrPublicFigureDeepfake: signal(
      raw.realisticPoliticalOrPublicFigureDeepfake,
      `${label}.realisticPoliticalOrPublicFigureDeepfake`
    )
  };
}

export function encodeProjectKingsSourcePolicyBenchmarkSignals(
  signals: ProjectKingsSourcePolicyBenchmarkSignals
): string {
  const abbreviate = (value: ProjectKingsSensitiveSignal) =>
    value === "absent" ? "a" : value === "present" ? "p" : "u";
  return `sp:${SIGNAL_KEYS.map((key) => abbreviate(signals[key])).join(",")}`;
}

async function readFrozenJson(filePath: string): Promise<JsonRecord> {
  return record(JSON.parse(await fs.readFile(filePath, "utf8")), filePath);
}

export async function loadProjectKingsSourcePolicyBenchmarkDataset(input: {
  repoRoot: string;
  datasetRelativePath?: string;
  annotationsRelativePath?: string;
}): Promise<StageModelBenchmarkDataset<"source_policy">> {
  const repoRoot = path.resolve(input.repoRoot);
  const datasetPath = resolveInside(
    repoRoot,
    input.datasetRelativePath ?? PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_DATASET_PATH,
    "datasetRelativePath"
  );
  const annotationsPath = resolveInside(
    repoRoot,
    input.annotationsRelativePath ?? PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_ANNOTATIONS_PATH,
    "annotationsRelativePath"
  );
  const [dataset, annotations] = await Promise.all([
    readFrozenJson(datasetPath),
    readFrozenJson(annotationsPath)
  ]);
  if (dataset.schemaVersion !== DATASET_SCHEMA_VERSION) throw new Error("Unsupported source-policy dataset schema.");
  if (annotations.schemaVersion !== ANNOTATION_SCHEMA_VERSION) throw new Error("Unsupported source-policy annotations schema.");
  const { datasetSha256: datasetShaRaw, ...datasetPayload } = dataset;
  const datasetSha256 = sha256(datasetShaRaw, "dataset.datasetSha256");
  if (hashJson(datasetPayload) !== datasetSha256) throw new Error("Source-policy dataset hash mismatch.");
  const { annotationsSha256: annotationShaRaw, ...annotationPayload } = annotations;
  const annotationsSha256 = sha256(annotationShaRaw, "annotations.annotationsSha256");
  if (hashJson(annotationPayload) !== annotationsSha256) throw new Error("Source-policy annotation-set hash mismatch.");
  if (annotations.datasetSha256 !== datasetSha256) throw new Error("Annotations are not bound to this dataset.");
  if (dataset.policyVersion !== PROJECT_KINGS_SOURCE_POLICY_VERSION || dataset.policySha256 !== PROJECT_KINGS_SOURCE_POLICY_SHA256) {
    throw new Error("Source-policy dataset is not bound to the active frozen policy.");
  }
  const datasetCases = array(dataset.cases, "dataset.cases");
  const annotationCases = array(annotations.cases, "annotations.cases");
  if (
    dataset.sampleSize !== PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_SAMPLE_SIZE ||
    annotations.sampleSize !== PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_SAMPLE_SIZE ||
    datasetCases.length !== PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_SAMPLE_SIZE ||
    annotationCases.length !== PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_SAMPLE_SIZE
  ) {
    throw new Error(`Source-policy benchmark requires exactly ${PROJECT_KINGS_SOURCE_POLICY_BENCHMARK_SAMPLE_SIZE} frozen cases.`);
  }

  const annotationsByCase = new Map<string, {
    signals: ProjectKingsSourcePolicyBenchmarkSignals;
    datasetCaseBindingSha256: string;
  }>();
  for (const [index, rawAnnotation] of annotationCases.entries()) {
    const annotation = record(rawAnnotation, `annotations.cases[${index}]`);
    const { annotationSha256: caseAnnotationShaRaw, ...caseAnnotationPayload } = annotation;
    const caseAnnotationSha256 = sha256(caseAnnotationShaRaw, `annotations.cases[${index}].annotationSha256`);
    if (hashJson(caseAnnotationPayload) !== caseAnnotationSha256) {
      throw new Error(`annotations.cases[${index}] hash mismatch.`);
    }
    const caseId = text(annotation.caseId, `annotations.cases[${index}].caseId`, 160);
    text(annotation.reason, `annotations.cases[${index}].reason`, 2_000);
    if (annotationsByCase.has(caseId)) throw new Error(`Duplicate annotation for ${caseId}.`);
    annotationsByCase.set(caseId, {
      signals: parseSignals(annotation.signals, `annotations.cases[${index}].signals`),
      datasetCaseBindingSha256: sha256(
        annotation.datasetCaseBindingSha256,
        `annotations.cases[${index}].datasetCaseBindingSha256`
      )
    });
  }

  const seenCaseIds = new Set<string>();
  const seenContentSha256 = new Set<string>();
  const benchmarkCases: Array<StageModelBenchmarkCase<"source_policy">> = [];
  for (const [index, rawCase] of datasetCases.entries()) {
    const datasetCase = record(rawCase, `dataset.cases[${index}]`);
    const { caseBindingSha256: caseBindingRaw, ...casePayload } = datasetCase;
    const caseBindingSha256 = sha256(caseBindingRaw, `dataset.cases[${index}].caseBindingSha256`);
    if (hashJson(casePayload) !== caseBindingSha256) throw new Error(`dataset.cases[${index}] binding hash mismatch.`);
    const caseId = text(datasetCase.caseId, `dataset.cases[${index}].caseId`, 160);
    if (seenCaseIds.has(caseId)) throw new Error(`Duplicate dataset case ${caseId}.`);
    seenCaseIds.add(caseId);
    const contentSha256 = sha256(datasetCase.contentSha256, `dataset.cases[${index}].contentSha256`);
    if (seenContentSha256.has(contentSha256)) throw new Error(`Duplicate exact media bytes in ${caseId}.`);
    seenContentSha256.add(contentSha256);
    const mediaRelativePath = text(datasetCase.mediaRelativePath, `dataset.cases[${index}].mediaRelativePath`);
    if (!mediaRelativePath.startsWith(".data/project-kings/source-candidates/")) {
      throw new Error(`${caseId} media must come from the real source-candidates pool.`);
    }
    const mediaPath = resolveInside(repoRoot, mediaRelativePath, `${caseId}.mediaRelativePath`);
    if ((await hashFile(mediaPath)) !== contentSha256) throw new Error(`${caseId} source MP4 hash mismatch.`);
    const channelId = text(datasetCase.channelId, `${caseId}.channelId`, 24);
    if (!YOUTUBE_CHANNEL_ID.test(channelId)) throw new Error(`${caseId} has an invalid channelId.`);
    const profileVersion = text(datasetCase.profileVersion, `${caseId}.profileVersion`, 160);
    const profileKey = text(datasetCase.profileKey, `${caseId}.profileKey`, 32);
    if (!(["dark-joy-boy", "light-kingdom", "copscopes-x2e"] as const).includes(profileKey as never)) {
      throw new Error(`${caseId} has an invalid profileKey.`);
    }
    const sourceUrl = text(datasetCase.sourceUrl, `${caseId}.sourceUrl`, 2_000);
    if (!sourceUrl.startsWith("https://")) throw new Error(`${caseId} sourceUrl must use HTTPS.`);
    const artifactsRecord = record(datasetCase.artifacts, `${caseId}.artifacts`);
    const metadataRecord = record(artifactsRecord.sourceMetadata, `${caseId}.artifacts.sourceMetadata`);
    const metadata = await verifyFile(repoRoot, metadataRecord.relativePath, metadataRecord.sha256, `${caseId}.sourceMetadata`);
    const frameRecords = array(artifactsRecord.orderedKeyFrames, `${caseId}.artifacts.orderedKeyFrames`);
    const frameCount = integer(datasetCase.frameCount, `${caseId}.frameCount`, 5, 9);
    if (frameRecords.length !== frameCount) throw new Error(`${caseId} frame count does not match frozen artifacts.`);
    const frameArtifacts: ProductionAgentArtifact[] = [];
    let previousTimestampMs = -1;
    for (const [frameIndex, rawFrame] of frameRecords.entries()) {
      const frame = record(rawFrame, `${caseId}.frames[${frameIndex}]`);
      const artifactId = text(frame.artifactId, `${caseId}.frames[${frameIndex}].artifactId`, 160);
      if (artifactId !== `source-key-frame-${String(frameIndex + 1).padStart(2, "0")}`) {
        throw new Error(`${caseId} frame artifact order is not canonical.`);
      }
      const timestampMs = integer(frame.timestampMs, `${caseId}.frames[${frameIndex}].timestampMs`, 0, 86_400_000);
      if (timestampMs <= previousTimestampMs) throw new Error(`${caseId} frame timestamps must increase.`);
      previousTimestampMs = timestampMs;
      const verified = await verifyFile(repoRoot, frame.relativePath, frame.sha256, `${caseId}.frames[${frameIndex}]`);
      frameArtifacts.push({ id: artifactId, kind: "key_frame", mediaType: "image", path: verified.filePath, sha256: verified.sha256 });
    }
    const ocrRecord = record(artifactsRecord.ocr, `${caseId}.artifacts.ocr`);
    const asrRecord = record(artifactsRecord.asr, `${caseId}.artifacts.asr`);
    const [ocr, asr] = await Promise.all([
      verifyFile(repoRoot, ocrRecord.relativePath, ocrRecord.sha256, `${caseId}.ocr`),
      verifyFile(repoRoot, asrRecord.relativePath, asrRecord.sha256, `${caseId}.asr`)
    ]);
    const asrStatus = text(asrRecord.status, `${caseId}.asr.status`, 32);
    if (!(["no_audio", "no_speech", "speech_detected"] as const).includes(asrStatus as never)) {
      throw new Error(`${caseId} has an invalid ASR status.`);
    }
    const asrText = await fs.readFile(asr.filePath, "utf8");
    if (!asrText.startsWith(`status=${asrStatus}\n`)) throw new Error(`${caseId} ASR status is not bound to transcript bytes.`);
    const annotation = annotationsByCase.get(caseId);
    if (!annotation) throw new Error(`Missing reviewed annotation for ${caseId}.`);
    if (annotation.datasetCaseBindingSha256 !== caseBindingSha256) {
      throw new Error(`${caseId} annotation is not bound to its dataset case.`);
    }
    const sourceMetadataArtifactId = text(metadataRecord.artifactId, `${caseId}.metadata.artifactId`, 160);
    const ocrArtifactId = text(ocrRecord.artifactId, `${caseId}.ocr.artifactId`, 160);
    const asrArtifactId = text(asrRecord.artifactId, `${caseId}.asr.artifactId`, 160);
    const artifacts: ProductionAgentArtifact[] = [
      { id: sourceMetadataArtifactId, kind: "source_metadata", mediaType: "json", path: metadata.filePath, sha256: metadata.sha256 },
      ...frameArtifacts,
      { id: ocrArtifactId, kind: "ocr", mediaType: "text", path: ocr.filePath, sha256: ocr.sha256 },
      { id: asrArtifactId, kind: "transcript", mediaType: "text", path: asr.filePath, sha256: asr.sha256 }
    ];
    const packet: SourcePolicyPacket = {
      schemaVersion: "production-agent-packet-v1",
      role: "source_policy",
      runId: "benchmark-source-policy-real-30-v1",
      itemId: caseId,
      channelId,
      profileVersion,
      task: {
        candidateId: caseId,
        sourceUrl,
        contentSha256,
        profileKey: profileKey as "dark-joy-boy" | "light-kingdom" | "copscopes-x2e",
        policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
        policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
        prohibitedClasses: PRODUCTION_SOURCE_POLICY_CLASSES,
        orderedKeyFrameArtifactIds: frameArtifacts.map((artifact) => artifact.id),
        ocrArtifactId,
        asrArtifactId,
        sourceMetadataArtifactId
      },
      artifacts
    };
    benchmarkCases.push({
      caseId,
      packet: validateProductionAgentPacket("source_policy", packet),
      expectedQualityLabel: encodeProjectKingsSourcePolicyBenchmarkSignals(annotation.signals)
    });
  }
  if (annotationsByCase.size !== seenCaseIds.size) throw new Error("Annotation set contains cases outside the dataset.");
  return Object.freeze({
    datasetId: text(dataset.datasetId, "dataset.datasetId", 160),
    datasetVersion: text(dataset.datasetVersion, "dataset.datasetVersion", 160),
    role: "source_policy" as const,
    cases: Object.freeze(benchmarkCases)
  });
}
