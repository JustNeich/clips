import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import {
  PRODUCTION_DEFECT_CODES,
  validateProductionAgentOutput,
  type VisionQaOutput
} from "./production-agent-contracts";
import type { ProductionDefectCode } from "../production-quality-gate";
import {
  validateConceptContract,
  type ConceptContract
} from "./channel-production-profile";

export const VISION_QA_EVAL_CORPUS_VERSION = "project-kings-vision-qa-corpus-v2" as const;
export const VISION_QA_EVAL_RUN_VERSION = "project-kings-vision-qa-eval-run-v2" as const;
export const VISION_QA_MIN_HOLDOUT_CASES = 120;
export const VISION_QA_MIN_CLEAN_CASES = 40;
export const VISION_QA_MIN_DEFECTIVE_CASES = 80;
export const VISION_QA_REQUIRED_SEQUENTIAL_RUNS = 3;

export const VISION_QA_EVAL_DEFECT_TAXONOMY = {
  wrong_channel: "critical",
  wrong_template: "critical",
  concept_mismatch: "critical",
  duplicate_video: "noncritical",
  duplicate_event: "noncritical",
  missing_hook: "noncritical",
  missing_action: "noncritical",
  missing_payoff: "noncritical",
  donor_ui: "critical",
  cta: "critical",
  handle: "critical",
  watermark: "critical",
  foreign_captions: "critical",
  main_event_lost: "critical",
  unsafe_crop: "critical",
  factual_claim_unverified: "critical",
  banned_word: "noncritical"
} as const satisfies Partial<Record<ProductionDefectCode, "critical" | "noncritical">>;

export type VisionQaEvalDefectCode = keyof typeof VISION_QA_EVAL_DEFECT_TAXONOMY;
export type VisionQaEvalSeverity = "critical" | "noncritical";

export type VisionQaEvalDefect = Readonly<{
  code: VisionQaEvalDefectCode;
  severity: VisionQaEvalSeverity;
  rationale: string;
}>;

export type VisionQaReviewerProvenance = Readonly<{
  reviewerKind: "human" | "model";
  provider: string;
  model: string | null;
  routeId: string | null;
  reasoningEffort: string | null;
  isolationBoundary: "independent_human" | "separate_process";
  independenceKey: string;
  invocationEvidenceSha256: string;
}>;

export type VisionQaEvalAnnotation = Readonly<{
  annotationId: string;
  annotatorId: string;
  annotationVersion: string;
  completedAt: string;
  blind: true;
  provenance: VisionQaReviewerProvenance;
  decision: "PASS" | "FAIL";
  defects: readonly VisionQaEvalDefect[];
}>;

export type VisionQaEvalAdjudication = Readonly<{
  adjudicationId: string;
  adjudicatorId: string;
  adjudicationVersion: string;
  completedAt: string;
  provenance: VisionQaReviewerProvenance;
  decision: "PASS" | "FAIL";
  defects: readonly VisionQaEvalDefect[];
  resolution: string;
}>;

export type BlindSafeArtifactReference = Readonly<{
  filePath: string;
  sha256: string;
}>;

export type BlindSafeFrameReference = BlindSafeArtifactReference & Readonly<{
  frameIndex: number;
  timestampMs: number;
}>;

export type BlindSafeVisionQaContextPacket = Readonly<{
  schemaVersion: "project-kings-vision-qa-blind-context-v1";
  conceptContract: ConceptContract;
  template: Readonly<{
    templateSha256: string;
    layoutKind: "classic_top_bottom" | "channel_story";
    frame: Readonly<{ width: number; height: number }>;
    mediaViewport: Readonly<{ x: number; y: number; width: number; height: number }>;
    reference: BlindSafeArtifactReference;
    authorizedText: Readonly<{
      visibleText: readonly string[];
      channelName: string;
      channelHandle: string | null;
    }>;
  }>;
  source: Readonly<{
    artifact: BlindSafeArtifactReference;
    frames: readonly BlindSafeFrameReference[];
    crop: Readonly<{
      coordinateSpace: "normalized_source";
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }>;
  brief: Readonly<{
    storyEventId: string;
    hook: string;
    action: string;
    payoff: string;
  }>;
  factualEvidence: readonly Readonly<{
    claim: string;
    evidence: string;
    evidenceSha256: string;
  }>[];
  duplicateLedger: Readonly<{
    knownSourceSha256: readonly string[];
    knownStoryEventIds: readonly string[];
  }>;
  bannedWords: readonly string[];
}>;

export type VisionQaEvalCase = Readonly<{
  caseId: string;
  sourceSha256: string;
  storyEventId: string;
  channelId: string;
  templateSha256: string;
  conceptId: string;
  groundTruthClass: "clean" | "defective";
  artifactPath: string;
  artifactSha256: string;
  frameManifestPath: string;
  frameManifestSha256: string;
  blindContextPacket: BlindSafeVisionQaContextPacket;
  blindContextPacketSha256: string;
  deterministicVerdict: Readonly<{
    decision: "PASS" | "FAIL";
    defectCodes: readonly ProductionDefectCode[];
  }>;
  annotations: readonly [VisionQaEvalAnnotation, VisionQaEvalAnnotation];
  adjudication: VisionQaEvalAdjudication;
}>;

export type VisionQaFrameManifest = Readonly<{
  schemaVersion: "vision-qa-frame-manifest-v1";
  videoSha256: string;
  frames: readonly Readonly<{
    frameIndex: number;
    timestampMs: number;
    file: string;
    sha256: string;
  }>[];
}>;

export type VisionQaEvalPartitionInput = Readonly<{
  schemaVersion: typeof VISION_QA_EVAL_CORPUS_VERSION;
  partition: "selection_pool" | "final_holdout";
  datasetId: string;
  datasetVersion: string;
  cases: readonly VisionQaEvalCase[];
}>;

export type VerifiedVisionQaFrame = Readonly<{
  frameIndex: number;
  timestampMs: number;
  filePath: string;
  sha256: string;
}>;

export type FrozenVisionQaEvalCase = VisionQaEvalCase &
  Readonly<{
    verifiedFrames: readonly VerifiedVisionQaFrame[];
  }>;

export type FrozenVisionQaEvalPartition = Readonly<{
  schemaVersion: typeof VISION_QA_EVAL_CORPUS_VERSION;
  partition: "selection_pool" | "final_holdout";
  datasetId: string;
  datasetVersion: string;
  cases: readonly FrozenVisionQaEvalCase[];
  counts: Readonly<{
    total: number;
    clean: number;
    defective: number;
    criticalDefective: number;
  }>;
  partitionSha256: string;
}>;

export type FrozenVisionQaEvalCorpus = Readonly<{
  selectionPool: FrozenVisionQaEvalPartition & { partition: "selection_pool" };
  finalHoldout: FrozenVisionQaEvalPartition & { partition: "final_holdout" };
  corpusSha256: string;
}>;

export type VisionQaSelectedJudge = Readonly<{
  routeId: string;
  model: string;
  reasoningEffort: string;
  selectionPoolSha256: string;
  selectionBenchmarkEvidenceSha256: string;
  routeManifestSha256: string;
  routeBenchmarkEvidenceSha256: string;
  isolation: Readonly<{
    executionBoundary: "separate_process";
    adapterId: string;
    adapterSha256: string;
    attestationSha256: string;
  }>;
}>;

export type BlindVisionQaJudgeInput = Readonly<{
  blindCaseToken: string;
  channelId: string;
  templateSha256: string;
  conceptId: string;
  artifact: Readonly<{
    filePath: string;
    sha256: string;
  }>;
  frames: readonly VerifiedVisionQaFrame[];
  contextPacket: BlindSafeVisionQaContextPacket;
  contextPacketSha256: string;
}>;

export type BlindVisionQaJudgeResult = Readonly<{
  verdict: VisionQaOutput;
  invocationEvidenceSha256: string;
  provenance: Readonly<{
    invocationId: string;
    routeId: string;
    model: string;
    reasoningEffort: string;
    executionBoundary: "separate_process";
    adapterId: string;
    adapterSha256: string;
    routeManifestSha256: string;
    routeBenchmarkEvidenceSha256: string;
    requestSha256: string;
    verdictSha256: string;
  }>;
}>;

export type BlindVisionQaJudge = (
  input: BlindVisionQaJudgeInput
) => Promise<BlindVisionQaJudgeResult>;

export type VisionQaEvalSampleEvidence = Readonly<{
  blindCaseToken: string;
  artifactSha256: string;
  channelId: string;
  groundTruthClass: "clean" | "defective";
  groundTruthDefects: readonly VisionQaEvalDefect[];
  deterministicDecision: "PASS" | "FAIL";
  visionDecision: "PASS" | "FAIL" | "ERROR";
  combinedDecision: "PASS" | "FAIL";
  detectedDefectCodes: readonly VisionQaEvalDefectCode[];
  deterministicVisionDisagreement: boolean;
  durationMs: number;
  verdictSha256: string | null;
  invocationEvidenceSha256: string | null;
  error: string | null;
}>;

export type VisionQaEvalMetrics = Readonly<{
  criticalDefectRecall: number;
  allDefectRecall: number;
  cleanPassPrecision: number;
  cleanAcceptanceRate: number;
  criticalFalsePasses: number;
  judgeErrors: number;
  deterministicVisionDisagreements: number;
  visionPasses: number;
  trueCleanPasses: number;
  totalCleanCases: number;
  detectedCriticalDefects: number;
  totalCriticalDefects: number;
  detectedDefects: number;
  totalDefects: number;
  byDefectCode: Readonly<Record<VisionQaEvalDefectCode, Readonly<{
    severity: VisionQaEvalSeverity;
    total: number;
    detected: number;
    recall: number | null;
    falsePasses: number;
  }>>>;
  byChannel: Readonly<Record<string, Readonly<{
    totalCases: number;
    cleanCases: number;
    defectiveCases: number;
    acceptedCleanCases: number;
    cleanAcceptanceRate: number | null;
    totalDefects: number;
    detectedDefects: number;
    defectRecall: number | null;
    criticalFalsePasses: number;
  }>>>;
}>;

export type FrozenVisionQaEvalRunEvidence = Readonly<{
  schemaVersion: typeof VISION_QA_EVAL_RUN_VERSION;
  runIndex: 1 | 2 | 3;
  runId: string;
  startedAt: string;
  completedAt: string;
  finalHoldoutSha256: string;
  selectedJudge: VisionQaSelectedJudge;
  samples: readonly VisionQaEvalSampleEvidence[];
  metrics: VisionQaEvalMetrics;
  launchGatePassed: boolean;
  evidenceSha256: string;
}>;

export type FrozenVisionQaLaunchEvidence = Readonly<{
  schemaVersion: "project-kings-vision-qa-launch-evidence-v2";
  corpusSha256: string;
  selectionPoolSha256: string;
  finalHoldoutSha256: string;
  selectedJudge: VisionQaSelectedJudge;
  requiredSequentialRuns: 3;
  runEvidenceSha256: readonly [string, string, string];
  launchReady: boolean;
  failedRunIndexes: readonly number[];
  evidenceSha256: string;
}>;

export type VisionQaEvalRunResult = Readonly<{
  runs: readonly [
    FrozenVisionQaEvalRunEvidence,
    FrozenVisionQaEvalRunEvidence,
    FrozenVisionQaEvalRunEvidence
  ];
  launch: FrozenVisionQaLaunchEvidence;
}>;

function blindSafeReferenceWithoutPath(reference: BlindSafeArtifactReference): Omit<BlindSafeArtifactReference, "filePath"> {
  const { filePath: _filePath, ...withoutPath } = reference;
  return withoutPath;
}

function normalizedBlindSafeContextPacketForHash(packet: BlindSafeVisionQaContextPacket): unknown {
  return {
    ...packet,
    template: {
      ...packet.template,
      reference: blindSafeReferenceWithoutPath(packet.template.reference)
    },
    source: {
      ...packet.source,
      artifact: blindSafeReferenceWithoutPath(packet.source.artifact),
      frames: packet.source.frames.map(({ filePath: _filePath, ...frame }) => frame)
    }
  };
}

export function calculateBlindSafeVisionQaContextPacketSha256(
  packet: BlindSafeVisionQaContextPacket
): string {
  return sha256(normalizedBlindSafeContextPacketForHash(packet));
}

export class VisionQaEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionQaEvalError";
  }
}

type UnknownRecord = Record<string, unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as UnknownRecord)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  const result = JSON.stringify(canonicalize(value));
  if (result === undefined) throw new VisionQaEvalError("Evaluation evidence must be JSON-serializable.");
  return result;
}

function sha256(value: string | Uint8Array | unknown): string {
  const payload =
    typeof value === "string" || value instanceof Uint8Array ? value : stableJson(value);
  return createHash("sha256").update(payload).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as UnknownRecord)) deepFreeze(child);
  return value;
}

function exactKeys(value: UnknownRecord, required: readonly string[], at: string): void {
  const allowed = new Set(required);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new VisionQaEvalError(`${at}.${key} is not part of the frozen contract.`);
  }
  for (const key of required) {
    if (!(key in value)) throw new VisionQaEvalError(`${at}.${key} is required.`);
  }
}

function record(value: unknown, at: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VisionQaEvalError(`${at} must be an object.`);
  }
  return value as UnknownRecord;
}

function text(value: unknown, at: string, max = 1_000): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) {
    throw new VisionQaEvalError(`${at} must be a non-empty trimmed string.`);
  }
  return value;
}

function sha(value: unknown, at: string): string {
  const result = text(value, at, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new VisionQaEvalError(`${at} must be SHA-256 hex.`);
  return result;
}

function isoDate(value: unknown, at: string): string {
  const result = text(value, at, 64);
  if (!Number.isFinite(Date.parse(result))) throw new VisionQaEvalError(`${at} must be an ISO timestamp.`);
  return result;
}

function normalizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "Unknown error")).trim().slice(0, 1_000);
}

function nullableText(value: unknown, at: string, max = 1_000): string | null {
  if (value === null) return null;
  return text(value, at, max);
}

function uniqueStrings(raw: unknown, at: string, options: { maxItems: number; sha?: boolean } ): string[] {
  if (!Array.isArray(raw) || raw.length > options.maxItems) {
    throw new VisionQaEvalError(`${at} must be an array with at most ${options.maxItems} entries.`);
  }
  const result = raw.map((entry, index) =>
    options.sha ? sha(entry, `${at}[${index}]`) : text(entry, `${at}[${index}]`, 2_000)
  );
  if (new Set(result).size !== result.length) throw new VisionQaEvalError(`${at} contains duplicates.`);
  return result;
}

function validateReviewerProvenance(raw: unknown, at: string): VisionQaReviewerProvenance {
  const value = record(raw, at);
  exactKeys(value, [
    "reviewerKind", "provider", "model", "routeId", "reasoningEffort", "isolationBoundary",
    "independenceKey", "invocationEvidenceSha256"
  ], at);
  if (value.reviewerKind !== "human" && value.reviewerKind !== "model") {
    throw new VisionQaEvalError(`${at}.reviewerKind must be human or model.`);
  }
  const model = nullableText(value.model, `${at}.model`, 160);
  const routeId = nullableText(value.routeId, `${at}.routeId`, 160);
  const reasoningEffort = nullableText(value.reasoningEffort, `${at}.reasoningEffort`, 80);
  if (value.reviewerKind === "model") {
    if (!model || !routeId || !reasoningEffort || value.isolationBoundary !== "separate_process") {
      throw new VisionQaEvalError(`${at} model reviewer must record model, route, reasoning and separate-process isolation.`);
    }
  } else if (
    model !== null || routeId !== null || reasoningEffort !== null ||
    value.isolationBoundary !== "independent_human"
  ) {
    throw new VisionQaEvalError(`${at} human reviewer provenance is inconsistent.`);
  }
  return {
    reviewerKind: value.reviewerKind,
    provider: text(value.provider, `${at}.provider`, 160),
    model,
    routeId,
    reasoningEffort,
    isolationBoundary: value.isolationBoundary,
    independenceKey: text(value.independenceKey, `${at}.independenceKey`, 160),
    invocationEvidenceSha256: sha(value.invocationEvidenceSha256, `${at}.invocationEvidenceSha256`)
  };
}

function normalizedUnitRect(raw: unknown, at: string): { x: number; y: number; width: number; height: number } {
  const value = record(raw, at);
  exactKeys(value, ["x", "y", "width", "height"], at);
  const parts = [value.x, value.y, value.width, value.height];
  if (!parts.every((part) => typeof part === "number" && Number.isFinite(part))) {
    throw new VisionQaEvalError(`${at} must contain finite numbers.`);
  }
  const x = value.x as number;
  const y = value.y as number;
  const width = value.width as number;
  const height = value.height as number;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
    throw new VisionQaEvalError(`${at} must stay inside normalized bounds.`);
  }
  return { x, y, width, height };
}

const BLIND_PATH_LABEL_TOKENS = new Set([
  "clean", "defective", "pass", "fail", "ground_truth", "groundtruth", "mutation",
  "injection", "injection_recipe", ...Object.keys(VISION_QA_EVAL_DEFECT_TAXONOMY)
]);

function assertBlindSafePath(filePath: string, at: string): void {
  const tokens = path.normalize(filePath).split(path.sep).flatMap((segment) => {
    const normalized = segment.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return [normalized, ...normalized.split("_")];
  });
  if (tokens.some((token) => BLIND_PATH_LABEL_TOKENS.has(token))) {
    throw new VisionQaEvalError(`${at} leaks a label or injection recipe through its path.`);
  }
}

function validateArtifactReference(raw: unknown, at: string): BlindSafeArtifactReference {
  const value = record(raw, at);
  exactKeys(value, ["filePath", "sha256"], at);
  const filePath = text(value.filePath, `${at}.filePath`, 4_000);
  if (!path.isAbsolute(filePath)) throw new VisionQaEvalError(`${at}.filePath must be absolute.`);
  assertBlindSafePath(filePath, `${at}.filePath`);
  return { filePath, sha256: sha(value.sha256, `${at}.sha256`) };
}

function validateBlindContextPacket(raw: unknown, at: string): BlindSafeVisionQaContextPacket {
  const value = record(raw, at);
  exactKeys(value, [
    "schemaVersion", "conceptContract", "template", "source", "brief", "factualEvidence",
    "duplicateLedger", "bannedWords"
  ], at);
  if (value.schemaVersion !== "project-kings-vision-qa-blind-context-v1") {
    throw new VisionQaEvalError(`${at}.schemaVersion is unsupported.`);
  }
  const conceptIssues = validateConceptContract(value.conceptContract);
  if (conceptIssues.length > 0) {
    throw new VisionQaEvalError(`${at}.conceptContract is invalid: ${conceptIssues[0]!.path} ${conceptIssues[0]!.message}`);
  }
  const conceptContract = JSON.parse(stableJson(value.conceptContract)) as ConceptContract;

  const template = record(value.template, `${at}.template`);
  exactKeys(template, [
    "templateSha256", "layoutKind", "frame", "mediaViewport", "reference", "authorizedText"
  ], `${at}.template`);
  if (template.layoutKind !== "classic_top_bottom" && template.layoutKind !== "channel_story") {
    throw new VisionQaEvalError(`${at}.template.layoutKind is unsupported.`);
  }
  const frame = record(template.frame, `${at}.template.frame`);
  exactKeys(frame, ["width", "height"], `${at}.template.frame`);
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) ||
      Number(frame.width) <= 0 || Number(frame.height) <= 0) {
    throw new VisionQaEvalError(`${at}.template.frame must contain positive integer dimensions.`);
  }
  const authorizedText = record(template.authorizedText, `${at}.template.authorizedText`);
  exactKeys(authorizedText, ["visibleText", "channelName", "channelHandle"], `${at}.template.authorizedText`);
  const visibleText = uniqueStrings(authorizedText.visibleText, `${at}.template.authorizedText.visibleText`, { maxItems: 24 });
  if (visibleText.length < 1) throw new VisionQaEvalError(`${at}.template.authorizedText.visibleText cannot be empty.`);
  const channelHandle = nullableText(authorizedText.channelHandle, `${at}.template.authorizedText.channelHandle`, 160);

  const source = record(value.source, `${at}.source`);
  exactKeys(source, ["artifact", "frames", "crop"], `${at}.source`);
  if (!Array.isArray(source.frames) || source.frames.length < 3 || source.frames.length > 120) {
    throw new VisionQaEvalError(`${at}.source.frames must contain 3-120 verified source frames.`);
  }
  let previousIndex = -1;
  let previousTimestamp = -1;
  const sourceFrames = source.frames.map((rawFrame, index): BlindSafeFrameReference => {
    const frameAt = `${at}.source.frames[${index}]`;
    const frameValue = record(rawFrame, frameAt);
    exactKeys(frameValue, ["frameIndex", "timestampMs", "filePath", "sha256"], frameAt);
    if (!Number.isInteger(frameValue.frameIndex) || Number(frameValue.frameIndex) <= previousIndex ||
        typeof frameValue.timestampMs !== "number" || !Number.isFinite(frameValue.timestampMs) ||
        Number(frameValue.timestampMs) <= previousTimestamp) {
      throw new VisionQaEvalError(`${frameAt} index and timestamp must be strictly increasing.`);
    }
    previousIndex = Number(frameValue.frameIndex);
    previousTimestamp = Number(frameValue.timestampMs);
    const reference = validateArtifactReference({
      filePath: frameValue.filePath,
      sha256: frameValue.sha256
    }, frameAt);
    return { frameIndex: previousIndex, timestampMs: previousTimestamp, ...reference };
  });
  const crop = record(source.crop, `${at}.source.crop`);
  exactKeys(crop, ["coordinateSpace", "x", "y", "width", "height"], `${at}.source.crop`);
  if (crop.coordinateSpace !== "normalized_source") {
    throw new VisionQaEvalError(`${at}.source.crop.coordinateSpace must be normalized_source.`);
  }
  const normalizedCrop = normalizedUnitRect({
    x: crop.x, y: crop.y, width: crop.width, height: crop.height
  }, `${at}.source.crop.bounds`);

  const brief = record(value.brief, `${at}.brief`);
  exactKeys(brief, ["storyEventId", "hook", "action", "payoff"], `${at}.brief`);
  const factualEvidence = Array.isArray(value.factualEvidence)
    ? value.factualEvidence.map((rawEvidence, index) => {
        const evidenceAt = `${at}.factualEvidence[${index}]`;
        const evidence = record(rawEvidence, evidenceAt);
        exactKeys(evidence, ["claim", "evidence", "evidenceSha256"], evidenceAt);
        const claim = text(evidence.claim, `${evidenceAt}.claim`, 2_000);
        const evidenceText = text(evidence.evidence, `${evidenceAt}.evidence`, 4_000);
        const evidenceSha256 = sha(evidence.evidenceSha256, `${evidenceAt}.evidenceSha256`);
        if (evidenceSha256 !== sha256({ claim, evidence: evidenceText })) {
          throw new VisionQaEvalError(`${evidenceAt}.evidenceSha256 does not bind the factual evidence.`);
        }
        return { claim, evidence: evidenceText, evidenceSha256 };
      })
    : (() => { throw new VisionQaEvalError(`${at}.factualEvidence must be an array.`); })();
  if (factualEvidence.length > 100) throw new VisionQaEvalError(`${at}.factualEvidence is too large.`);

  const duplicateLedger = record(value.duplicateLedger, `${at}.duplicateLedger`);
  exactKeys(duplicateLedger, ["knownSourceSha256", "knownStoryEventIds"], `${at}.duplicateLedger`);
  return {
    schemaVersion: "project-kings-vision-qa-blind-context-v1",
    conceptContract,
    template: {
      templateSha256: sha(template.templateSha256, `${at}.template.templateSha256`),
      layoutKind: template.layoutKind,
      frame: { width: Number(frame.width), height: Number(frame.height) },
      mediaViewport: normalizedUnitRect(template.mediaViewport, `${at}.template.mediaViewport`),
      reference: validateArtifactReference(template.reference, `${at}.template.reference`),
      authorizedText: {
        visibleText,
        channelName: text(authorizedText.channelName, `${at}.template.authorizedText.channelName`, 160),
        channelHandle
      }
    },
    source: {
      artifact: validateArtifactReference(source.artifact, `${at}.source.artifact`),
      frames: sourceFrames,
      crop: { coordinateSpace: "normalized_source", ...normalizedCrop }
    },
    brief: {
      storyEventId: text(brief.storyEventId, `${at}.brief.storyEventId`, 160),
      hook: text(brief.hook, `${at}.brief.hook`, 2_000),
      action: text(brief.action, `${at}.brief.action`, 2_000),
      payoff: text(brief.payoff, `${at}.brief.payoff`, 2_000)
    },
    factualEvidence,
    duplicateLedger: {
      knownSourceSha256: uniqueStrings(duplicateLedger.knownSourceSha256, `${at}.duplicateLedger.knownSourceSha256`, { maxItems: 1_000, sha: true }),
      knownStoryEventIds: uniqueStrings(duplicateLedger.knownStoryEventIds, `${at}.duplicateLedger.knownStoryEventIds`, { maxItems: 1_000 })
    },
    bannedWords: uniqueStrings(value.bannedWords, `${at}.bannedWords`, { maxItems: 500 })
  };
}

export function validateBlindSafeVisionQaContextPacket(
  raw: unknown
): BlindSafeVisionQaContextPacket {
  return deepFreeze(validateBlindContextPacket(raw, "blindContextPacket"));
}

function validateDefects(raw: unknown, at: string): VisionQaEvalDefect[] {
  if (!Array.isArray(raw)) throw new VisionQaEvalError(`${at} must be an array.`);
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const itemAt = `${at}[${index}]`;
    const item = record(entry, itemAt);
    exactKeys(item, ["code", "severity", "rationale"], itemAt);
    const code = text(item.code, `${itemAt}.code`, 100) as VisionQaEvalDefectCode;
    const expectedSeverity = VISION_QA_EVAL_DEFECT_TAXONOMY[code];
    if (!expectedSeverity) throw new VisionQaEvalError(`${itemAt}.code is outside the Vision QA taxonomy.`);
    if (seen.has(code)) throw new VisionQaEvalError(`${at} contains duplicate defect ${code}.`);
    seen.add(code);
    if (item.severity !== expectedSeverity) {
      throw new VisionQaEvalError(`${itemAt}.severity must be ${expectedSeverity}.`);
    }
    return {
      code,
      severity: expectedSeverity,
      rationale: text(item.rationale, `${itemAt}.rationale`, 2_000)
    };
  });
}

function validateAnnotation(raw: unknown, at: string): VisionQaEvalAnnotation {
  const value = record(raw, at);
  exactKeys(
    value,
    ["annotationId", "annotatorId", "annotationVersion", "completedAt", "blind", "provenance", "decision", "defects"],
    at
  );
  if (value.blind !== true) throw new VisionQaEvalError(`${at}.blind must be true.`);
  if (value.decision !== "PASS" && value.decision !== "FAIL") {
    throw new VisionQaEvalError(`${at}.decision must be PASS or FAIL.`);
  }
  const defects = validateDefects(value.defects, `${at}.defects`);
  if ((value.decision === "PASS") !== (defects.length === 0)) {
    throw new VisionQaEvalError(`${at}.decision contradicts its defects.`);
  }
  return {
    annotationId: text(value.annotationId, `${at}.annotationId`, 160),
    annotatorId: text(value.annotatorId, `${at}.annotatorId`, 160),
    annotationVersion: text(value.annotationVersion, `${at}.annotationVersion`, 160),
    completedAt: isoDate(value.completedAt, `${at}.completedAt`),
    blind: true,
    provenance: validateReviewerProvenance(value.provenance, `${at}.provenance`),
    decision: value.decision,
    defects
  };
}

function validateAdjudication(raw: unknown, at: string): VisionQaEvalAdjudication {
  const value = record(raw, at);
  exactKeys(
    value,
    ["adjudicationId", "adjudicatorId", "adjudicationVersion", "completedAt", "provenance", "decision", "defects", "resolution"],
    at
  );
  if (value.decision !== "PASS" && value.decision !== "FAIL") {
    throw new VisionQaEvalError(`${at}.decision must be PASS or FAIL.`);
  }
  const defects = validateDefects(value.defects, `${at}.defects`);
  if ((value.decision === "PASS") !== (defects.length === 0)) {
    throw new VisionQaEvalError(`${at}.decision contradicts its defects.`);
  }
  return {
    adjudicationId: text(value.adjudicationId, `${at}.adjudicationId`, 160),
    adjudicatorId: text(value.adjudicatorId, `${at}.adjudicatorId`, 160),
    adjudicationVersion: text(value.adjudicationVersion, `${at}.adjudicationVersion`, 160),
    completedAt: isoDate(value.completedAt, `${at}.completedAt`),
    provenance: validateReviewerProvenance(value.provenance, `${at}.provenance`),
    decision: value.decision,
    defects,
    resolution: text(value.resolution, `${at}.resolution`, 2_000)
  };
}

function validateCase(raw: unknown, at: string): VisionQaEvalCase {
  const value = record(raw, at);
  exactKeys(
    value,
    [
      "caseId",
      "sourceSha256",
      "storyEventId",
      "channelId",
      "templateSha256",
      "conceptId",
      "groundTruthClass",
      "artifactPath",
      "artifactSha256",
      "frameManifestPath",
      "frameManifestSha256",
      "blindContextPacket",
      "blindContextPacketSha256",
      "deterministicVerdict",
      "annotations",
      "adjudication"
    ],
    at
  );
  if (value.groundTruthClass !== "clean" && value.groundTruthClass !== "defective") {
    throw new VisionQaEvalError(`${at}.groundTruthClass must be clean or defective.`);
  }
  if (!path.isAbsolute(String(value.artifactPath ?? "")) || !path.isAbsolute(String(value.frameManifestPath ?? ""))) {
    throw new VisionQaEvalError(`${at} artifact and frame manifest paths must be absolute.`);
  }
  assertBlindSafePath(String(value.artifactPath), `${at}.artifactPath`);
  assertBlindSafePath(String(value.frameManifestPath), `${at}.frameManifestPath`);
  if (!Array.isArray(value.annotations) || value.annotations.length !== 2) {
    throw new VisionQaEvalError(`${at}.annotations must contain exactly two independent annotations.`);
  }
  const first = validateAnnotation(value.annotations[0], `${at}.annotations[0]`);
  const second = validateAnnotation(value.annotations[1], `${at}.annotations[1]`);
  if (first.annotatorId === second.annotatorId || first.annotationId === second.annotationId) {
    throw new VisionQaEvalError(`${at}.annotations must come from two independent annotators.`);
  }
  if (first.provenance.independenceKey === second.provenance.independenceKey ||
      first.provenance.invocationEvidenceSha256 === second.provenance.invocationEvidenceSha256) {
    throw new VisionQaEvalError(`${at}.annotations must have independent reviewer provenance.`);
  }
  const adjudication = validateAdjudication(value.adjudication, `${at}.adjudication`);
  if ([first.annotatorId, second.annotatorId].includes(adjudication.adjudicatorId)) {
    throw new VisionQaEvalError(`${at}.adjudicator must be independent from both annotators.`);
  }
  if ([first.provenance.independenceKey, second.provenance.independenceKey]
      .includes(adjudication.provenance.independenceKey) ||
      [first.provenance.invocationEvidenceSha256, second.provenance.invocationEvidenceSha256]
        .includes(adjudication.provenance.invocationEvidenceSha256)) {
    throw new VisionQaEvalError(`${at}.adjudicator must have independent reviewer provenance.`);
  }
  if (
    Date.parse(adjudication.completedAt) <
    Math.max(Date.parse(first.completedAt), Date.parse(second.completedAt))
  ) {
    throw new VisionQaEvalError(`${at}.adjudication cannot precede its annotations.`);
  }
  const expectedClass = adjudication.decision === "PASS" ? "clean" : "defective";
  if (value.groundTruthClass !== expectedClass) {
    throw new VisionQaEvalError(`${at}.groundTruthClass contradicts adjudication.`);
  }
  const deterministic = record(value.deterministicVerdict, `${at}.deterministicVerdict`);
  exactKeys(deterministic, ["decision", "defectCodes"], `${at}.deterministicVerdict`);
  if (deterministic.decision !== "PASS" && deterministic.decision !== "FAIL") {
    throw new VisionQaEvalError(`${at}.deterministicVerdict.decision must be PASS or FAIL.`);
  }
  if (!Array.isArray(deterministic.defectCodes)) {
    throw new VisionQaEvalError(`${at}.deterministicVerdict.defectCodes must be an array.`);
  }
  const deterministicDefectCodes = deterministic.defectCodes.map((code, index) =>
    text(code, `${at}.deterministicVerdict.defectCodes[${index}]`, 100) as ProductionDefectCode
  );
  for (const [index, code] of deterministicDefectCodes.entries()) {
    if (!PRODUCTION_DEFECT_CODES.includes(code)) {
      throw new VisionQaEvalError(`${at}.deterministicVerdict.defectCodes[${index}] is unknown.`);
    }
  }
  if (new Set(deterministicDefectCodes).size !== deterministicDefectCodes.length) {
    throw new VisionQaEvalError(`${at}.deterministicVerdict.defectCodes contains duplicates.`);
  }
  if ((deterministic.decision === "PASS") !== (deterministicDefectCodes.length === 0)) {
    throw new VisionQaEvalError(`${at}.deterministicVerdict contradicts its defects.`);
  }
  const blindContextPacket = validateBlindContextPacket(value.blindContextPacket, `${at}.blindContextPacket`);
  const blindContextPacketSha256 = sha(
    value.blindContextPacketSha256,
    `${at}.blindContextPacketSha256`
  );
  if (blindContextPacketSha256 !== calculateBlindSafeVisionQaContextPacketSha256(blindContextPacket)) {
    throw new VisionQaEvalError(`${at}.blindContextPacketSha256 does not bind the blind-safe packet.`);
  }
  if (blindContextPacket.source.artifact.sha256 !== value.sourceSha256) {
    throw new VisionQaEvalError(`${at}.blindContextPacket source does not match sourceSha256.`);
  }
  if (blindContextPacket.template.templateSha256 !== value.templateSha256) {
    throw new VisionQaEvalError(`${at}.blindContextPacket template does not match templateSha256.`);
  }
  if (blindContextPacket.conceptContract.conceptId !== value.conceptId) {
    throw new VisionQaEvalError(`${at}.blindContextPacket concept does not match conceptId.`);
  }
  if (blindContextPacket.brief.storyEventId !== value.storyEventId) {
    throw new VisionQaEvalError(`${at}.blindContextPacket brief does not match storyEventId.`);
  }
  return {
    caseId: text(value.caseId, `${at}.caseId`, 160),
    sourceSha256: sha(value.sourceSha256, `${at}.sourceSha256`),
    storyEventId: text(value.storyEventId, `${at}.storyEventId`, 160),
    channelId: text(value.channelId, `${at}.channelId`, 100),
    templateSha256: sha(value.templateSha256, `${at}.templateSha256`),
    conceptId: text(value.conceptId, `${at}.conceptId`, 160),
    groundTruthClass: value.groundTruthClass,
    artifactPath: text(value.artifactPath, `${at}.artifactPath`, 4_000),
    artifactSha256: sha(value.artifactSha256, `${at}.artifactSha256`),
    frameManifestPath: text(value.frameManifestPath, `${at}.frameManifestPath`, 4_000),
    frameManifestSha256: sha(value.frameManifestSha256, `${at}.frameManifestSha256`),
    blindContextPacket,
    blindContextPacketSha256,
    deterministicVerdict: {
      decision: deterministic.decision,
      defectCodes: deterministicDefectCodes
    },
    annotations: [first, second],
    adjudication
  };
}

async function verifyFrameManifest(evalCase: VisionQaEvalCase): Promise<VerifiedVisionQaFrame[]> {
  const artifactSha256 = await sha256File(evalCase.artifactPath).catch(() => null);
  if (artifactSha256 !== evalCase.artifactSha256) {
    throw new VisionQaEvalError(`Case ${evalCase.caseId} artifact is missing or its hash changed.`);
  }
  const manifestBytes = await fs.readFile(evalCase.frameManifestPath).catch(() => null);
  if (!manifestBytes || sha256(manifestBytes) !== evalCase.frameManifestSha256) {
    throw new VisionQaEvalError(`Case ${evalCase.caseId} frame manifest is missing or its hash changed.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBytes.toString("utf-8"));
  } catch {
    throw new VisionQaEvalError(`Case ${evalCase.caseId} frame manifest is not JSON.`);
  }
  const manifest = record(parsed, `case ${evalCase.caseId} frameManifest`);
  exactKeys(manifest, ["schemaVersion", "videoSha256", "frames"], `case ${evalCase.caseId} frameManifest`);
  if (manifest.schemaVersion !== "vision-qa-frame-manifest-v1") {
    throw new VisionQaEvalError(`Case ${evalCase.caseId} frame manifest version is unsupported.`);
  }
  if (manifest.videoSha256 !== evalCase.artifactSha256) {
    throw new VisionQaEvalError(`Case ${evalCase.caseId} frame manifest points to another video.`);
  }
  if (!Array.isArray(manifest.frames) || manifest.frames.length < 3 || manifest.frames.length > 120) {
    throw new VisionQaEvalError(`Case ${evalCase.caseId} frame manifest must contain 3-120 frames.`);
  }
  const result: VerifiedVisionQaFrame[] = [];
  let lastFrameIndex = -1;
  let lastTimestampMs = -1;
  const files = new Set<string>();
  for (const [index, raw] of manifest.frames.entries()) {
    const at = `case ${evalCase.caseId} frameManifest.frames[${index}]`;
    const frame = record(raw, at);
    exactKeys(frame, ["frameIndex", "timestampMs", "file", "sha256"], at);
    if (!Number.isInteger(frame.frameIndex) || (frame.frameIndex as number) <= lastFrameIndex) {
      throw new VisionQaEvalError(`${at}.frameIndex must be strictly increasing.`);
    }
    if (typeof frame.timestampMs !== "number" || !Number.isFinite(frame.timestampMs) || frame.timestampMs <= lastTimestampMs) {
      throw new VisionQaEvalError(`${at}.timestampMs must be strictly increasing.`);
    }
    const relativeFile = text(frame.file, `${at}.file`, 500);
    if (path.isAbsolute(relativeFile) || relativeFile.split(/[\\/]+/).includes("..")) {
      throw new VisionQaEvalError(`${at}.file must stay inside the manifest directory.`);
    }
    assertBlindSafePath(path.resolve(path.dirname(evalCase.frameManifestPath), relativeFile), `${at}.file`);
    if (files.has(relativeFile)) throw new VisionQaEvalError(`${at}.file is duplicated.`);
    files.add(relativeFile);
    const frameSha256 = sha(frame.sha256, `${at}.sha256`);
    const filePath = path.resolve(path.dirname(evalCase.frameManifestPath), relativeFile);
    if ((await sha256File(filePath).catch(() => null)) !== frameSha256) {
      throw new VisionQaEvalError(`${at} file is missing or its hash changed.`);
    }
    lastFrameIndex = frame.frameIndex as number;
    lastTimestampMs = frame.timestampMs;
    result.push({
      frameIndex: lastFrameIndex,
      timestampMs: lastTimestampMs,
      filePath,
      sha256: frameSha256
    });
  }
  return result;
}

async function verifyBlindContextPacketFiles(evalCase: VisionQaEvalCase): Promise<void> {
  const packet = evalCase.blindContextPacket;
  if (calculateBlindSafeVisionQaContextPacketSha256(packet) !== evalCase.blindContextPacketSha256) {
    throw new VisionQaEvalError(`Case ${evalCase.caseId} blind-safe context packet changed.`);
  }
  const references: Array<{ label: string; filePath: string; sha256: string }> = [
    { label: "template reference", ...packet.template.reference },
    { label: "source artifact", ...packet.source.artifact },
    ...packet.source.frames.map((frame) => ({
      label: `source frame ${frame.frameIndex}`,
      filePath: frame.filePath,
      sha256: frame.sha256
    }))
  ];
  for (const reference of references) {
    if ((await sha256File(reference.filePath).catch(() => null)) !== reference.sha256) {
      throw new VisionQaEvalError(`Case ${evalCase.caseId} ${reference.label} is missing or its hash changed.`);
    }
  }
}

function normalizedCaseForHash(evalCase: FrozenVisionQaEvalCase): unknown {
  const {
    artifactPath: _artifactPath,
    frameManifestPath: _frameManifestPath,
    verifiedFrames,
    ...withoutPaths
  } = evalCase;
  return {
    ...withoutPaths,
    verifiedFrames: verifiedFrames.map(({ filePath: _filePath, ...frame }) => frame)
  };
}

function computePartitionHash(input: Omit<FrozenVisionQaEvalPartition, "partitionSha256">): string {
  return sha256({
    schemaVersion: input.schemaVersion,
    partition: input.partition,
    datasetId: input.datasetId,
    datasetVersion: input.datasetVersion,
    counts: input.counts,
    cases: input.cases.map(normalizedCaseForHash)
  });
}

export async function freezeVisionQaEvalPartition(
  raw: VisionQaEvalPartitionInput
): Promise<FrozenVisionQaEvalPartition> {
  const value = record(raw, "partition");
  exactKeys(value, ["schemaVersion", "partition", "datasetId", "datasetVersion", "cases"], "partition");
  if (value.schemaVersion !== VISION_QA_EVAL_CORPUS_VERSION) {
    throw new VisionQaEvalError("Partition corpus version is unsupported.");
  }
  if (value.partition !== "selection_pool" && value.partition !== "final_holdout") {
    throw new VisionQaEvalError("Partition must be selection_pool or final_holdout.");
  }
  if (!Array.isArray(value.cases) || value.cases.length < 1) {
    throw new VisionQaEvalError("Partition must contain at least one case.");
  }
  const cases: FrozenVisionQaEvalCase[] = [];
  const caseIds = new Set<string>();
  const artifactHashes = new Set<string>();
  const manifestHashes = new Set<string>();
  const annotationIds = new Set<string>();
  const adjudicationIds = new Set<string>();
  for (const [index, rawCase] of value.cases.entries()) {
    const evalCase = validateCase(rawCase, `partition.cases[${index}]`);
    if (caseIds.has(evalCase.caseId)) throw new VisionQaEvalError(`Duplicate case ID ${evalCase.caseId}.`);
    if (artifactHashes.has(evalCase.artifactSha256)) {
      throw new VisionQaEvalError(`Duplicate artifact hash ${evalCase.artifactSha256}.`);
    }
    if (manifestHashes.has(evalCase.frameManifestSha256)) {
      throw new VisionQaEvalError(`Duplicate frame manifest hash ${evalCase.frameManifestSha256}.`);
    }
    caseIds.add(evalCase.caseId);
    artifactHashes.add(evalCase.artifactSha256);
    manifestHashes.add(evalCase.frameManifestSha256);
    for (const annotation of evalCase.annotations) {
      if (annotationIds.has(annotation.annotationId)) {
        throw new VisionQaEvalError(`Duplicate annotation ID ${annotation.annotationId}.`);
      }
      annotationIds.add(annotation.annotationId);
    }
    if (adjudicationIds.has(evalCase.adjudication.adjudicationId)) {
      throw new VisionQaEvalError(`Duplicate adjudication ID ${evalCase.adjudication.adjudicationId}.`);
    }
    adjudicationIds.add(evalCase.adjudication.adjudicationId);
    cases.push({
      ...evalCase,
      verifiedFrames: await verifyFrameManifest(evalCase)
    });
    await verifyBlindContextPacketFiles(evalCase);
  }
  const clean = cases.filter((evalCase) => evalCase.groundTruthClass === "clean").length;
  const defective = cases.length - clean;
  const criticalDefective = cases.filter((evalCase) =>
    evalCase.adjudication.defects.some((defect) => defect.severity === "critical")
  ).length;
  const withoutHash = {
    schemaVersion: VISION_QA_EVAL_CORPUS_VERSION,
    partition: value.partition,
    datasetId: text(value.datasetId, "partition.datasetId", 160),
    datasetVersion: text(value.datasetVersion, "partition.datasetVersion", 160),
    cases,
    counts: { total: cases.length, clean, defective, criticalDefective }
  } as const;
  return deepFreeze({
    ...withoutHash,
    partitionSha256: computePartitionHash(withoutHash)
  });
}

function findOverlap(
  selection: FrozenVisionQaEvalPartition,
  holdout: FrozenVisionQaEvalPartition,
  getter: (evalCase: FrozenVisionQaEvalCase) => string
): string | null {
  const selected = new Set(selection.cases.map(getter));
  return holdout.cases.map(getter).find((value) => selected.has(value)) ?? null;
}

export function assembleFrozenVisionQaEvalCorpus(input: {
  selectionPool: FrozenVisionQaEvalPartition;
  finalHoldout: FrozenVisionQaEvalPartition;
}): FrozenVisionQaEvalCorpus {
  if (input.selectionPool.partition !== "selection_pool") {
    throw new VisionQaEvalError("selectionPool must be sealed as selection_pool.");
  }
  if (input.finalHoldout.partition !== "final_holdout") {
    throw new VisionQaEvalError("finalHoldout must be sealed as final_holdout.");
  }
  if (!Object.isFrozen(input.selectionPool) || !Object.isFrozen(input.finalHoldout)) {
    throw new VisionQaEvalError("Selection pool and final holdout must be frozen separately before assembly.");
  }
  if (computePartitionHash(input.selectionPool) !== input.selectionPool.partitionSha256) {
    throw new VisionQaEvalError("Selection pool hash does not match its frozen payload.");
  }
  if (computePartitionHash(input.finalHoldout) !== input.finalHoldout.partitionSha256) {
    throw new VisionQaEvalError("Final holdout hash does not match its frozen payload.");
  }
  const holdoutCounts = input.finalHoldout.counts;
  if (
    holdoutCounts.total < VISION_QA_MIN_HOLDOUT_CASES ||
    holdoutCounts.clean < VISION_QA_MIN_CLEAN_CASES ||
    holdoutCounts.defective < VISION_QA_MIN_DEFECTIVE_CASES
  ) {
    throw new VisionQaEvalError(
      `Final holdout requires at least ${VISION_QA_MIN_HOLDOUT_CASES} cases, ${VISION_QA_MIN_CLEAN_CASES} clean and ${VISION_QA_MIN_DEFECTIVE_CASES} defective.`
    );
  }
  if (holdoutCounts.criticalDefective < 1) {
    throw new VisionQaEvalError("Final holdout must contain at least one adjudicated critical defect.");
  }
  const overlapChecks: Array<[string, (evalCase: FrozenVisionQaEvalCase) => string]> = [
    ["case ID", (evalCase) => evalCase.caseId],
    ["artifact hash", (evalCase) => evalCase.artifactSha256],
    ["frame manifest hash", (evalCase) => evalCase.frameManifestSha256],
    ["source hash", (evalCase) => evalCase.sourceSha256],
    ["story event", (evalCase) => evalCase.storyEventId]
  ];
  for (const [label, getter] of overlapChecks) {
    const overlap = findOverlap(input.selectionPool, input.finalHoldout, getter);
    if (overlap) throw new VisionQaEvalError(`Selection/holdout data leakage: overlapping ${label} ${overlap}.`);
  }
  return deepFreeze({
    selectionPool: input.selectionPool as FrozenVisionQaEvalCorpus["selectionPool"],
    finalHoldout: input.finalHoldout as FrozenVisionQaEvalCorpus["finalHoldout"],
    corpusSha256: sha256({
      selectionPoolSha256: input.selectionPool.partitionSha256,
      finalHoldoutSha256: input.finalHoldout.partitionSha256
    })
  });
}

function detectedDefectCodes(verdict: VisionQaOutput, evalCase: FrozenVisionQaEvalCase): VisionQaEvalDefectCode[] {
  const detected = new Set<VisionQaEvalDefectCode>();
  for (const defect of verdict.defects) {
    if (!(defect.code in VISION_QA_EVAL_DEFECT_TAXONOMY)) {
      throw new VisionQaEvalError(`Vision judge returned out-of-taxonomy defect ${defect.code}.`);
    }
    detected.add(defect.code as VisionQaEvalDefectCode);
  }
  if (verdict.channelId !== evalCase.channelId) detected.add("wrong_channel");
  if (verdict.templateSha256 !== evalCase.templateSha256) detected.add("wrong_template");
  if (!verdict.conceptMatch) detected.add("concept_mismatch");
  if (verdict.duplicateVideo) detected.add("duplicate_video");
  if (verdict.duplicateEvent) detected.add("duplicate_event");
  if (!verdict.hookPresent) detected.add("missing_hook");
  if (!verdict.actionPresent) detected.add("missing_action");
  if (!verdict.payoffPresent) detected.add("missing_payoff");
  if (verdict.donorUiVisible) detected.add("donor_ui");
  if (verdict.ctaVisible) detected.add("cta");
  if (verdict.handleVisible) detected.add("handle");
  if (verdict.watermarkVisible) detected.add("watermark");
  if (verdict.foreignCaptionsVisible) detected.add("foreign_captions");
  if (!verdict.mainEventPreserved) detected.add("main_event_lost");
  if (!verdict.cropSafe) detected.add("unsafe_crop");
  if (!verdict.factualClaimsVerified) detected.add("factual_claim_unverified");
  if (verdict.bannedWordsPresent) detected.add("banned_word");
  return [...detected].sort();
}

function calculateMetrics(samples: readonly VisionQaEvalSampleEvidence[]): VisionQaEvalMetrics {
  let totalCriticalDefects = 0;
  let detectedCriticalDefects = 0;
  let totalDefects = 0;
  let detectedDefects = 0;
  let criticalFalsePasses = 0;
  let judgeErrors = 0;
  let deterministicVisionDisagreements = 0;
  let visionPasses = 0;
  let trueCleanPasses = 0;
  let totalCleanCases = 0;
  const byDefectCode = Object.fromEntries(
    Object.entries(VISION_QA_EVAL_DEFECT_TAXONOMY).map(([code, severity]) => [code, {
      severity,
      total: 0,
      detected: 0,
      recall: null,
      falsePasses: 0
    }])
  ) as Record<VisionQaEvalDefectCode, {
    severity: VisionQaEvalSeverity;
    total: number;
    detected: number;
    recall: number | null;
    falsePasses: number;
  }>;
  const byChannelMutable = new Map<string, {
    totalCases: number;
    cleanCases: number;
    defectiveCases: number;
    acceptedCleanCases: number;
    totalDefects: number;
    detectedDefects: number;
    criticalFalsePasses: number;
  }>();
  for (const sample of samples) {
    if (sample.visionDecision === "ERROR" || sample.error !== null) judgeErrors += 1;
    const detected = new Set(sample.detectedDefectCodes);
    const channel = byChannelMutable.get(sample.channelId) ?? {
      totalCases: 0,
      cleanCases: 0,
      defectiveCases: 0,
      acceptedCleanCases: 0,
      totalDefects: 0,
      detectedDefects: 0,
      criticalFalsePasses: 0
    };
    channel.totalCases += 1;
    if (sample.groundTruthClass === "clean") {
      totalCleanCases += 1;
      channel.cleanCases += 1;
      if (sample.visionDecision === "PASS") channel.acceptedCleanCases += 1;
    } else {
      channel.defectiveCases += 1;
    }
    for (const defect of sample.groundTruthDefects) {
      totalDefects += 1;
      channel.totalDefects += 1;
      const codeMetrics = byDefectCode[defect.code];
      codeMetrics.total += 1;
      if (detected.has(defect.code)) {
        detectedDefects += 1;
        channel.detectedDefects += 1;
        codeMetrics.detected += 1;
      }
      if (defect.severity === "critical") {
        totalCriticalDefects += 1;
        if (detected.has(defect.code)) detectedCriticalDefects += 1;
      }
      if (sample.visionDecision === "PASS") codeMetrics.falsePasses += 1;
    }
    if (
      sample.groundTruthDefects.some((defect) => defect.severity === "critical") &&
      sample.visionDecision === "PASS"
    ) {
      criticalFalsePasses += 1;
      channel.criticalFalsePasses += 1;
    }
    if (sample.deterministicVisionDisagreement) deterministicVisionDisagreements += 1;
    if (sample.visionDecision === "PASS") {
      visionPasses += 1;
      if (sample.groundTruthClass === "clean") trueCleanPasses += 1;
    }
    byChannelMutable.set(sample.channelId, channel);
  }
  for (const metrics of Object.values(byDefectCode)) {
    metrics.recall = metrics.total === 0 ? null : metrics.detected / metrics.total;
  }
  const byChannel = Object.fromEntries(
    [...byChannelMutable.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([channelId, channel]) => [channelId, {
        ...channel,
        cleanAcceptanceRate:
          channel.cleanCases === 0 ? null : channel.acceptedCleanCases / channel.cleanCases,
        defectRecall: channel.totalDefects === 0 ? null : channel.detectedDefects / channel.totalDefects
      }])
  );
  return {
    criticalDefectRecall:
      totalCriticalDefects === 0 ? 0 : detectedCriticalDefects / totalCriticalDefects,
    allDefectRecall: totalDefects === 0 ? 0 : detectedDefects / totalDefects,
    cleanPassPrecision: visionPasses === 0 ? 0 : trueCleanPasses / visionPasses,
    cleanAcceptanceRate: totalCleanCases === 0 ? 0 : trueCleanPasses / totalCleanCases,
    criticalFalsePasses,
    judgeErrors,
    deterministicVisionDisagreements,
    visionPasses,
    trueCleanPasses,
    totalCleanCases,
    detectedCriticalDefects,
    totalCriticalDefects,
    detectedDefects,
    totalDefects,
    byDefectCode,
    byChannel
  };
}

function launchGatePassed(metrics: VisionQaEvalMetrics): boolean {
  return (
    metrics.criticalDefectRecall === 1 &&
    metrics.allDefectRecall >= 0.95 &&
    metrics.cleanPassPrecision >= 0.9 &&
    metrics.cleanAcceptanceRate >= 0.9 &&
    metrics.criticalFalsePasses === 0 &&
    metrics.judgeErrors === 0
  );
}

function blindToken(holdoutSha256: string, runIndex: number, artifactSha256: string): string {
  return sha256(`blind:${holdoutSha256}:${runIndex}:${artifactSha256}`);
}

export function calculateBlindVisionQaJudgeRequestSha256(input: BlindVisionQaJudgeInput): string {
  return sha256({
    blindCaseToken: input.blindCaseToken,
    channelId: input.channelId,
    templateSha256: input.templateSha256,
    conceptId: input.conceptId,
    artifact: blindSafeReferenceWithoutPath(input.artifact),
    frames: input.frames.map(({ filePath: _filePath, ...frame }) => frame),
    contextPacketSha256: input.contextPacketSha256,
    contextPacket: normalizedBlindSafeContextPacketForHash(input.contextPacket)
  });
}

export function calculateBlindVisionQaJudgeVerdictSha256(verdict: VisionQaOutput): string {
  return sha256(verdict);
}

export function calculateBlindVisionQaJudgeInvocationEvidenceSha256(
  provenance: BlindVisionQaJudgeResult["provenance"]
): string {
  return sha256(provenance);
}

function validateBlindJudgeProvenance(input: {
  raw: unknown;
  invocationEvidenceSha256: unknown;
  selectedJudge: VisionQaSelectedJudge;
  request: BlindVisionQaJudgeInput;
  verdict: VisionQaOutput;
}): { provenance: BlindVisionQaJudgeResult["provenance"]; invocationEvidenceSha256: string } {
  const value = record(input.raw, "judgeResult.provenance");
  exactKeys(value, [
    "invocationId", "routeId", "model", "reasoningEffort", "executionBoundary", "adapterId",
    "adapterSha256", "routeManifestSha256", "routeBenchmarkEvidenceSha256", "requestSha256", "verdictSha256"
  ], "judgeResult.provenance");
  if (value.executionBoundary !== "separate_process") {
    throw new VisionQaEvalError("Vision judge provenance must prove separate-process isolation.");
  }
  const provenance: BlindVisionQaJudgeResult["provenance"] = {
    invocationId: text(value.invocationId, "judgeResult.provenance.invocationId", 240),
    routeId: text(value.routeId, "judgeResult.provenance.routeId", 160),
    model: text(value.model, "judgeResult.provenance.model", 160),
    reasoningEffort: text(value.reasoningEffort, "judgeResult.provenance.reasoningEffort", 80),
    executionBoundary: "separate_process",
    adapterId: text(value.adapterId, "judgeResult.provenance.adapterId", 160),
    adapterSha256: sha(value.adapterSha256, "judgeResult.provenance.adapterSha256"),
    routeManifestSha256: sha(value.routeManifestSha256, "judgeResult.provenance.routeManifestSha256"),
    routeBenchmarkEvidenceSha256: sha(
      value.routeBenchmarkEvidenceSha256,
      "judgeResult.provenance.routeBenchmarkEvidenceSha256"
    ),
    requestSha256: sha(value.requestSha256, "judgeResult.provenance.requestSha256"),
    verdictSha256: sha(value.verdictSha256, "judgeResult.provenance.verdictSha256")
  };
  if (
    provenance.routeId !== input.selectedJudge.routeId ||
    provenance.model !== input.selectedJudge.model ||
    provenance.reasoningEffort !== input.selectedJudge.reasoningEffort ||
    provenance.adapterId !== input.selectedJudge.isolation.adapterId ||
    provenance.adapterSha256 !== input.selectedJudge.isolation.adapterSha256 ||
    provenance.routeManifestSha256 !== input.selectedJudge.routeManifestSha256 ||
    provenance.routeBenchmarkEvidenceSha256 !== input.selectedJudge.routeBenchmarkEvidenceSha256
  ) {
    throw new VisionQaEvalError("Vision judge invocation provenance does not match the selected isolated route.");
  }
  if (provenance.requestSha256 !== calculateBlindVisionQaJudgeRequestSha256(input.request)) {
    throw new VisionQaEvalError("Vision judge provenance does not bind the exact blind request packet.");
  }
  if (provenance.verdictSha256 !== calculateBlindVisionQaJudgeVerdictSha256(input.verdict)) {
    throw new VisionQaEvalError("Vision judge provenance does not bind the exact validated verdict.");
  }
  const invocationEvidenceSha256 = sha(
    input.invocationEvidenceSha256,
    "judgeResult.invocationEvidenceSha256"
  );
  if (invocationEvidenceSha256 !== calculateBlindVisionQaJudgeInvocationEvidenceSha256(provenance)) {
    throw new VisionQaEvalError("Vision judge invocation evidence hash does not bind its provenance.");
  }
  return { provenance, invocationEvidenceSha256 };
}

function withEvidenceHash<T extends UnknownRecord>(value: T): T & { evidenceSha256: string } {
  return deepFreeze({ ...value, evidenceSha256: sha256(value) });
}

async function writeExclusiveJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    flag: "wx",
    mode: 0o444
  });
}

export async function writeFrozenVisionQaEvalPartition(
  outputPath: string,
  partition: FrozenVisionQaEvalPartition
): Promise<void> {
  if (computePartitionHash(partition) !== partition.partitionSha256) {
    throw new VisionQaEvalError("Partition hash does not match its frozen payload.");
  }
  await writeExclusiveJson(outputPath, partition);
}

function validateSelectedJudge(raw: VisionQaSelectedJudge): VisionQaSelectedJudge {
  const value = record(raw, "selectedJudge");
  exactKeys(
    value,
    [
      "routeId",
      "model",
      "reasoningEffort",
      "selectionPoolSha256",
      "selectionBenchmarkEvidenceSha256",
      "routeManifestSha256",
      "routeBenchmarkEvidenceSha256",
      "isolation"
    ],
    "selectedJudge"
  );
  const isolation = record(value.isolation, "selectedJudge.isolation");
  exactKeys(
    isolation,
    ["executionBoundary", "adapterId", "adapterSha256", "attestationSha256"],
    "selectedJudge.isolation"
  );
  if (isolation.executionBoundary !== "separate_process") {
    throw new VisionQaEvalError("selectedJudge.isolation.executionBoundary must be separate_process.");
  }
  return {
    routeId: text(value.routeId, "selectedJudge.routeId", 160),
    model: text(value.model, "selectedJudge.model", 160),
    reasoningEffort: text(value.reasoningEffort, "selectedJudge.reasoningEffort", 80),
    selectionPoolSha256: sha(value.selectionPoolSha256, "selectedJudge.selectionPoolSha256"),
    selectionBenchmarkEvidenceSha256: sha(
      value.selectionBenchmarkEvidenceSha256,
      "selectedJudge.selectionBenchmarkEvidenceSha256"
    ),
    routeManifestSha256: sha(value.routeManifestSha256, "selectedJudge.routeManifestSha256"),
    routeBenchmarkEvidenceSha256: sha(
      value.routeBenchmarkEvidenceSha256,
      "selectedJudge.routeBenchmarkEvidenceSha256"
    ),
    isolation: {
      executionBoundary: "separate_process",
      adapterId: text(isolation.adapterId, "selectedJudge.isolation.adapterId", 160),
      adapterSha256: sha(isolation.adapterSha256, "selectedJudge.isolation.adapterSha256"),
      attestationSha256: sha(isolation.attestationSha256, "selectedJudge.isolation.attestationSha256")
    }
  };
}

async function reverifyFrozenPartitionFiles(partition: FrozenVisionQaEvalPartition): Promise<void> {
  for (const evalCase of partition.cases) {
    if ((await sha256File(evalCase.artifactPath).catch(() => null)) !== evalCase.artifactSha256) {
      throw new VisionQaEvalError(`Frozen partition artifact ${evalCase.caseId} changed before evaluation.`);
    }
    if (
      (await sha256File(evalCase.frameManifestPath).catch(() => null)) !==
      evalCase.frameManifestSha256
    ) {
      throw new VisionQaEvalError(`Frozen partition frame manifest ${evalCase.caseId} changed before evaluation.`);
    }
    for (const frame of evalCase.verifiedFrames) {
      if ((await sha256File(frame.filePath).catch(() => null)) !== frame.sha256) {
        throw new VisionQaEvalError(`Frozen partition frame ${evalCase.caseId}:${frame.frameIndex} changed.`);
      }
    }
    await verifyBlindContextPacketFiles(evalCase);
  }
}

export async function runBlindVisionQaLaunchEvaluation(input: {
  corpus: FrozenVisionQaEvalCorpus;
  selectedJudge: VisionQaSelectedJudge;
  judge: BlindVisionQaJudge;
  outputDirectory?: string;
  now?: () => Date;
  monotonicNowMs?: () => number;
}): Promise<VisionQaEvalRunResult> {
  const selectedJudge = deepFreeze(validateSelectedJudge(input.selectedJudge));
  if (!Object.isFrozen(input.corpus.finalHoldout) || !Object.isFrozen(input.corpus.selectionPool)) {
    throw new VisionQaEvalError("Evaluation requires the separately frozen corpus partitions.");
  }
  const reassembledCorpus = assembleFrozenVisionQaEvalCorpus({
    selectionPool: input.corpus.selectionPool,
    finalHoldout: input.corpus.finalHoldout
  });
  if (reassembledCorpus.corpusSha256 !== input.corpus.corpusSha256) {
    throw new VisionQaEvalError("Evaluation corpus was not produced by the frozen corpus assembly gate.");
  }
  const expectedCorpusSha256 = sha256({
    selectionPoolSha256: input.corpus.selectionPool.partitionSha256,
    finalHoldoutSha256: input.corpus.finalHoldout.partitionSha256
  });
  if (expectedCorpusSha256 !== input.corpus.corpusSha256) {
    throw new VisionQaEvalError("Corpus hash does not match its frozen partitions.");
  }
  if (selectedJudge.selectionPoolSha256 !== input.corpus.selectionPool.partitionSha256) {
    throw new VisionQaEvalError("Selected judge is not bound to this frozen selection pool.");
  }
  await reverifyFrozenPartitionFiles(input.corpus.selectionPool);
  await reverifyFrozenPartitionFiles(input.corpus.finalHoldout);
  const now = input.now ?? (() => new Date());
  const monotonicNowMs = input.monotonicNowMs ?? (() => performance.now());
  const runs: FrozenVisionQaEvalRunEvidence[] = [];
  for (let rawRunIndex = 1; rawRunIndex <= VISION_QA_REQUIRED_SEQUENTIAL_RUNS; rawRunIndex += 1) {
    const runIndex = rawRunIndex as 1 | 2 | 3;
    const startedAt = now().toISOString();
    const runId = sha256(
      `${input.corpus.finalHoldout.partitionSha256}:${selectedJudge.routeId}:${selectedJudge.reasoningEffort}:${runIndex}`
    ).slice(0, 24);
    const samples: VisionQaEvalSampleEvidence[] = [];
    for (const evalCase of input.corpus.finalHoldout.cases) {
      const token = blindToken(input.corpus.finalHoldout.partitionSha256, runIndex, evalCase.artifactSha256);
      const started = monotonicNowMs();
      let visionDecision: "PASS" | "FAIL" | "ERROR" = "ERROR";
      let detectedCodes: VisionQaEvalDefectCode[] = [];
      let verdictSha256: string | null = null;
      let invocationEvidenceSha256: string | null = null;
      let error: string | null = null;
      try {
        const request = deepFreeze({
          blindCaseToken: token,
          channelId: evalCase.channelId,
          templateSha256: evalCase.templateSha256,
          conceptId: evalCase.conceptId,
          artifact: {
            filePath: evalCase.artifactPath,
            sha256: evalCase.artifactSha256
          },
          frames: evalCase.verifiedFrames,
          contextPacket: evalCase.blindContextPacket,
          contextPacketSha256: evalCase.blindContextPacketSha256
        }) satisfies BlindVisionQaJudgeInput;
        const judged = await input.judge(request);
        const judgedRecord = record(judged, "judgeResult");
        exactKeys(judgedRecord, ["verdict", "invocationEvidenceSha256", "provenance"], "judgeResult");
        const verdict = validateProductionAgentOutput("vision_qa", judgedRecord.verdict);
        const invocation = validateBlindJudgeProvenance({
          raw: judgedRecord.provenance,
          invocationEvidenceSha256: judgedRecord.invocationEvidenceSha256,
          selectedJudge,
          request,
          verdict
        });
        detectedCodes = detectedDefectCodes(verdict, evalCase);
        visionDecision = verdict.decision === "PASS" && detectedCodes.length === 0 ? "PASS" : "FAIL";
        verdictSha256 = sha256(verdict);
        invocationEvidenceSha256 = invocation.invocationEvidenceSha256;
      } catch (caught) {
        error = normalizeError(caught);
      }
      const durationMs = Math.max(0, monotonicNowMs() - started);
      const deterministicVisionDisagreement =
        evalCase.deterministicVerdict.decision !==
        (visionDecision === "PASS" ? "PASS" : "FAIL");
      samples.push({
        blindCaseToken: token,
        artifactSha256: evalCase.artifactSha256,
        channelId: evalCase.channelId,
        groundTruthClass: evalCase.groundTruthClass,
        groundTruthDefects: evalCase.adjudication.defects,
        deterministicDecision: evalCase.deterministicVerdict.decision,
        visionDecision,
        combinedDecision:
          evalCase.deterministicVerdict.decision === "PASS" && visionDecision === "PASS"
            ? "PASS"
            : "FAIL",
        detectedDefectCodes: detectedCodes,
        deterministicVisionDisagreement,
        durationMs,
        verdictSha256,
        invocationEvidenceSha256,
        error
      });
    }
    const metrics = calculateMetrics(samples);
    const evidence = withEvidenceHash({
      schemaVersion: VISION_QA_EVAL_RUN_VERSION,
      runIndex,
      runId,
      startedAt,
      completedAt: now().toISOString(),
      finalHoldoutSha256: input.corpus.finalHoldout.partitionSha256,
      selectedJudge,
      samples,
      metrics,
      launchGatePassed: launchGatePassed(metrics)
    }) as FrozenVisionQaEvalRunEvidence;
    runs.push(evidence);
    if (input.outputDirectory) {
      await writeExclusiveJson(
        path.join(input.outputDirectory, `vision-qa-eval-run-${String(runIndex).padStart(2, "0")}.json`),
        evidence
      );
    }
  }
  const typedRuns = runs as [
    FrozenVisionQaEvalRunEvidence,
    FrozenVisionQaEvalRunEvidence,
    FrozenVisionQaEvalRunEvidence
  ];
  const failedRunIndexes = typedRuns
    .filter((run) => !run.launchGatePassed)
    .map((run) => run.runIndex);
  const launch = withEvidenceHash({
      schemaVersion: "project-kings-vision-qa-launch-evidence-v2" as const,
    corpusSha256: input.corpus.corpusSha256,
    selectionPoolSha256: input.corpus.selectionPool.partitionSha256,
    finalHoldoutSha256: input.corpus.finalHoldout.partitionSha256,
    selectedJudge,
    requiredSequentialRuns: 3 as const,
    runEvidenceSha256: typedRuns.map((run) => run.evidenceSha256) as [string, string, string],
    launchReady: failedRunIndexes.length === 0,
    failedRunIndexes
  }) as FrozenVisionQaLaunchEvidence;
  if (input.outputDirectory) {
    await writeExclusiveJson(path.join(input.outputDirectory, "vision-qa-launch-evidence.json"), launch);
  }
  return deepFreeze({ runs: typedRuns, launch });
}
