import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  VISION_QA_REQUIRED_HOLDOUT_CLEAN_BASES,
  VISION_QA_REQUIRED_SELECTION_BASES,
  assertVisionQaCorpusBuildReady,
  verifyVisionQaCorpusSourceAuditEvidence,
  type VisionQaCorpusSourceArtifact,
  type VisionQaCorpusSourceAuditEvidence
} from "./vision-qa-corpus-builder";
import {
  generateVisionQaDefectVariant,
  selectEligibleVisionQaCleanBasesFromAudit,
  type EligibleVisionQaCleanBase,
  type VisionQaControlledDefect,
  type VisionQaDefectRecipeManifest
} from "./vision-qa-defect-generator";
import {
  createVisionQaAnnotationCampaign,
  reviewerProvenanceMatchesIdentity,
  verifyVisionQaAnnotationCampaignManifest,
  verifyVisionQaAnnotationPacket,
  type VisionQaAdjudicationAssignmentPacket,
  type VisionQaAnnotationCampaignManifest,
  type VisionQaAnnotationPacket,
  type VisionQaAnnotationReviewerIdentity
} from "./vision-qa-annotation-runner";
import {
  VISION_QA_EVAL_CORPUS_VERSION,
  VISION_QA_EVAL_DEFECT_TAXONOMY,
  assembleFrozenVisionQaEvalCorpus,
  calculateBlindSafeVisionQaContextPacketSha256,
  calculateBlindVisionQaJudgeRequestSha256,
  freezeVisionQaEvalPartition,
  validateBlindSafeVisionQaContextPacket,
  writeFrozenVisionQaEvalPartition,
  type BlindSafeVisionQaContextPacket,
  type BlindVisionQaJudgeInput,
  type FrozenVisionQaEvalCorpus,
  type VerifiedVisionQaFrame,
  type VisionQaEvalAnnotation,
  type VisionQaEvalCase,
  type VisionQaEvalDefect,
  type VisionQaEvalDefectCode,
  type VisionQaEvalPartitionInput,
  type VisionQaFrameManifest
} from "./vision-qa-eval";
import {
  validateConceptContract,
  type ConceptContract
} from "./channel-production-profile";

const execFileAsync = promisify(execFile);

export const VISION_QA_CORPUS_PREPARATION_PLAN_VERSION =
  "project-kings-vision-qa-preparation-plan-v1" as const;
export const VISION_QA_CORPUS_PREPARED_MANIFEST_VERSION =
  "project-kings-vision-qa-prepared-campaign-v1" as const;
export const VISION_QA_CORPUS_BLIND_CASES_VERSION =
  "project-kings-vision-qa-blind-cases-v1" as const;
export const VISION_QA_CORPUS_TRUTH_SEED_VERSION =
  "project-kings-vision-qa-truth-seeds-v1" as const;
export const VISION_QA_REVIEW_RESPONSE_VERSION =
  "project-kings-vision-qa-review-response-v1" as const;
export const VISION_QA_ADJUDICATION_INPUT_VERSION =
  "project-kings-vision-qa-adjudication-input-v1" as const;
export const VISION_QA_ADJUDICATION_RESPONSE_VERSION =
  "project-kings-vision-qa-adjudication-response-v1" as const;

/**
 * Technical-only failures are covered by the deterministic final-artifact gate.
 * A corrupt mux cannot yield honest judge frames, and resolution/audio/flash are
 * outside the frozen Vision taxonomy, so they may not manufacture Vision labels.
 */
export const VISION_QA_VISUAL_CORPUS_DEFECTS = [
  "wrong_template",
  "donor_ui",
  "cta",
  "handle",
  "watermark",
  "foreign_captions",
  "banned_word",
  "unsafe_crop",
  "main_event_lost"
] as const satisfies readonly VisionQaControlledDefect[];

export const VISION_QA_CORPUS_PREPARATION_CONTRACT = Object.freeze({
  schemaVersion: "project-kings-vision-qa-preparation-contract-v1",
  planSchemaVersion: VISION_QA_CORPUS_PREPARATION_PLAN_VERSION,
  sourceGate: {
    campaignScoped: true,
    requiredEligibleApprovedBases: 43,
    completedOrDecodableIsApproval: false
  },
  partitions: {
    selection: { cleanBases: 3, controlledVariantsPerBase: 2, totalCases: 9 },
    finalHoldout: { cleanBases: 40, controlledVariantsPerBase: 2, totalCases: 120 }
  },
  requiredPlanKeys: [
    "schemaVersion", "campaignManifestSha256", "sourceAuditEvidenceSha256", "datasetId", "datasetVersion",
    "createdAt", "rubricVersion", "selectionProductionItemIds", "holdoutProductionItemIds", "contexts",
    "reviewers", "adjudicator", "planSha256"
  ],
  requiredContextKeys: [
    "productionItemId", "sourceArtifact", "conceptContract", "template", "sourceCrop", "brief",
    "factualEvidence", "duplicateLedger", "bannedWords", "contextSeedSha256"
  ],
  leakageKeys: ["sourceSha256", "storyEventId"],
  reviewers: { independentBlindReviewers: 2, independentAdjudicators: 1 },
  visualControlledDefects: [...VISION_QA_VISUAL_CORPUS_DEFECTS],
  technicalOnlyFaults: ["corrupt_mux", "flash_frame", "lost_audio", "wrong_resolution"],
  hash: { algorithm: "sha256", encoding: "lowercase_hex", canonicalJson: true },
  outputsAreExclusive: true,
  noSyntheticPass: true
} as const);

type UnknownRecord = Record<string, unknown>;
type UnitRect = Readonly<{ x: number; y: number; width: number; height: number }>;

export type VisionQaCorpusContextSeed = Readonly<{
  productionItemId: string;
  sourceArtifact: Readonly<{ relativePath: string; sha256: string }>;
  conceptContract: ConceptContract;
  template: Readonly<{
    templateSha256: string;
    layoutKind: "classic_top_bottom" | "channel_story";
    frame: Readonly<{ width: number; height: number }>;
    mediaViewport: UnitRect;
    authorizedText: Readonly<{
      visibleText: readonly string[];
      channelName: string;
      channelHandle: string | null;
    }>;
  }>;
  sourceCrop: UnitRect;
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
  contextSeedSha256: string;
}>;

export type VisionQaCorpusPreparationPlan = Readonly<{
  schemaVersion: typeof VISION_QA_CORPUS_PREPARATION_PLAN_VERSION;
  campaignManifestSha256: string;
  sourceAuditEvidenceSha256: string;
  datasetId: string;
  datasetVersion: string;
  createdAt: string;
  rubricVersion: string;
  selectionProductionItemIds: readonly string[];
  holdoutProductionItemIds: readonly string[];
  contexts: readonly VisionQaCorpusContextSeed[];
  reviewers: readonly [VisionQaAnnotationReviewerIdentity, VisionQaAnnotationReviewerIdentity];
  adjudicator: VisionQaAnnotationReviewerIdentity;
  planSha256: string;
}>;

export type VisionQaPreparedBlindCase = Readonly<{
  blindCaseToken: string;
  partition: "selection_pool" | "final_holdout";
  baseProductionItemId: string;
  requestSha256: string;
  request: BlindVisionQaJudgeInput;
  frameManifestPath: string;
  frameManifestSha256: string;
  deterministicVerdict: Readonly<{ decision: "PASS"; defectCodes: readonly [] }>;
  caseRecordSha256: string;
}>;

export type VisionQaBlindCasesFile = Readonly<{
  schemaVersion: typeof VISION_QA_CORPUS_BLIND_CASES_VERSION;
  campaignManifestSha256: string;
  preparationPlanSha256: string;
  cases: readonly VisionQaPreparedBlindCase[];
  blindCasesSha256: string;
}>;

export type VisionQaTruthSeed = Readonly<{
  blindCaseToken: string;
  partition: "selection_pool" | "final_holdout";
  baseProductionItemId: string;
  groundTruthClass: "clean" | "defective";
  expectedDefect: VisionQaEvalDefect | null;
  provenance: Readonly<{
    kind: "explicit_final_approval" | "controlled_fault_injection";
    sourceAuditEvidenceSha256: string;
    sourceArtifactSha256: string;
    productionItemId: string;
    defectRecipeManifestSha256: string | null;
    defectProbeEvidenceSha256: string | null;
  }>;
  truthSeedSha256: string;
}>;

export type VisionQaTruthSeedsFile = Readonly<{
  schemaVersion: typeof VISION_QA_CORPUS_TRUTH_SEED_VERSION;
  campaignManifestSha256: string;
  preparationPlanSha256: string;
  seeds: readonly VisionQaTruthSeed[];
  truthSeedsSha256: string;
}>;

export type VisionQaPreparedCampaignManifest = Readonly<{
  schemaVersion: typeof VISION_QA_CORPUS_PREPARED_MANIFEST_VERSION;
  campaignManifestSha256: string;
  sourceAuditEvidenceSha256: string;
  preparationPlanSha256: string;
  datasetId: string;
  datasetVersion: string;
  createdAt: string;
  counts: Readonly<{
    selectionClean: 3;
    selectionDefective: 6;
    holdoutClean: 40;
    holdoutDefective: 80;
    holdoutTotal: 120;
    uniqueFinalArtifactHashes: number;
  }>;
  blindCases: Readonly<{ relativePath: string; sha256: string }>;
  sealedTruthSeeds: Readonly<{ relativePath: string; sha256: string }>;
  annotationCampaign: Readonly<{
    relativePath: string;
    manifestSha256: string;
    reviewerPacketRelativePaths: readonly [string, string];
    adjudicationAssignmentRelativePath: string;
  }>;
  manifestSha256: string;
}>;

export type VisionQaFrameExtraction = Readonly<{
  frameManifestPath: string;
  frameManifestSha256: string;
  frames: readonly VerifiedVisionQaFrame[];
}>;

export type VisionQaCorpusPreparationDependencies = Readonly<{
  generateDefectVariant?: typeof generateVisionQaDefectVariant;
  extractFrames?: (input: {
    videoPath: string;
    outputDirectory: string;
    frameSetId: string;
    ffmpegPath: string;
    ffprobePath: string;
  }) => Promise<VisionQaFrameExtraction>;
}>;

export type VisionQaReviewResponse = Readonly<{
  schemaVersion: typeof VISION_QA_REVIEW_RESPONSE_VERSION;
  campaignManifestSha256: string;
  reviewerPacketSha256: string;
  reviewerId: string;
  completedAt: string;
  annotations: readonly Readonly<{
    blindCaseToken: string;
    requestSha256: string;
    decision: "PASS" | "FAIL";
    defects: readonly VisionQaEvalDefect[];
    invocationEvidenceSha256: string;
  }>[];
  responseSha256: string;
}>;

export type VisionQaAdjudicationInputPacket = Readonly<{
  schemaVersion: typeof VISION_QA_ADJUDICATION_INPUT_VERSION;
  campaignManifestSha256: string;
  assignmentPacketSha256: string;
  assignedIdentity: VisionQaAnnotationReviewerIdentity;
  reviewerResponseSha256: readonly [string, string];
  cases: readonly Readonly<{
    blindCaseToken: string;
    requestSha256: string;
    reviews: readonly [
      Readonly<{ reviewerId: string; decision: "PASS" | "FAIL"; defects: readonly VisionQaEvalDefect[] }>,
      Readonly<{ reviewerId: string; decision: "PASS" | "FAIL"; defects: readonly VisionQaEvalDefect[] }>
    ];
  }>[];
  forbiddenContext: readonly ["ground_truth", "defect_recipe", "fault_injection"];
  packetSha256: string;
}>;

export type VisionQaAdjudicationResponse = Readonly<{
  schemaVersion: typeof VISION_QA_ADJUDICATION_RESPONSE_VERSION;
  campaignManifestSha256: string;
  adjudicationInputPacketSha256: string;
  adjudicatorId: string;
  completedAt: string;
  cases: readonly Readonly<{
    blindCaseToken: string;
    requestSha256: string;
    decision: "PASS" | "FAIL";
    defects: readonly VisionQaEvalDefect[];
    resolution: string;
    invocationEvidenceSha256: string;
  }>[];
  responseSha256: string;
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as UnknownRecord)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new Error("Vision QA corpus evidence must be JSON-serializable.");
  return serialized;
}

function sha256(value: string | Uint8Array | unknown): string {
  const payload = typeof value === "string" || value instanceof Uint8Array ? value : stableJson(value);
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

function assertSha(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256.`);
  }
}

function assertText(value: unknown, label: string, max = 1_000): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) {
    throw new Error(`${label} must be a bounded non-empty trimmed string.`);
  }
}

function assertExactKeys(value: UnknownRecord, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value))) {
    throw new Error(`${label} does not match the exact contract.`);
  }
}

function assertRelativePath(value: unknown, label: string): asserts value is string {
  assertText(value, label, 1_000);
  if (path.isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
}

function assertUnitRect(value: UnitRect, label: string): void {
  const parts = [value.x, value.y, value.width, value.height];
  if (!parts.every((part) => typeof part === "number" && Number.isFinite(part)) ||
      value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0 ||
      value.x + value.width > 1.000001 || value.y + value.height > 1.000001) {
    throw new Error(`${label} must be a normalized rectangle.`);
  }
}

function verifyDefects(defects: readonly VisionQaEvalDefect[], label: string): void {
  const seen = new Set<string>();
  for (const defect of defects) {
    const expected = VISION_QA_EVAL_DEFECT_TAXONOMY[defect.code];
    if (!expected || defect.severity !== expected || !defect.rationale.trim() || seen.has(defect.code)) {
      throw new Error(`${label} contains an invalid, duplicate or incorrectly classified defect.`);
    }
    seen.add(defect.code);
  }
}

function contextPayload(context: Omit<VisionQaCorpusContextSeed, "contextSeedSha256">): unknown {
  return context;
}

export function createVisionQaCorpusContextSeed(
  input: Omit<VisionQaCorpusContextSeed, "contextSeedSha256">
): VisionQaCorpusContextSeed {
  return structuredClone({ ...input, contextSeedSha256: sha256(contextPayload(input)) });
}

export function verifyVisionQaCorpusContextSeed(context: VisionQaCorpusContextSeed): void {
  assertExactKeys(context as unknown as UnknownRecord, [
    "productionItemId", "sourceArtifact", "conceptContract", "template", "sourceCrop", "brief",
    "factualEvidence", "duplicateLedger", "bannedWords", "contextSeedSha256"
  ], "context seed");
  assertText(context.productionItemId, "context.productionItemId", 160);
  assertRelativePath(context.sourceArtifact.relativePath, "context.sourceArtifact.relativePath");
  assertSha(context.sourceArtifact.sha256, "context.sourceArtifact.sha256");
  const conceptIssues = validateConceptContract(context.conceptContract);
  if (conceptIssues.length) throw new Error(`context.conceptContract is invalid: ${conceptIssues[0]!.message}`);
  assertSha(context.template.templateSha256, "context.template.templateSha256");
  if (context.template.layoutKind !== "classic_top_bottom" && context.template.layoutKind !== "channel_story") {
    throw new Error("context.template.layoutKind is unsupported.");
  }
  if (!Number.isInteger(context.template.frame.width) || !Number.isInteger(context.template.frame.height) ||
      context.template.frame.width <= 0 || context.template.frame.height <= 0) {
    throw new Error("context.template.frame must contain positive integer dimensions.");
  }
  assertUnitRect(context.template.mediaViewport, "context.template.mediaViewport");
  assertUnitRect(context.sourceCrop, "context.sourceCrop");
  if (!Array.isArray(context.template.authorizedText.visibleText) ||
      context.template.authorizedText.visibleText.length < 1 ||
      new Set(context.template.authorizedText.visibleText).size !== context.template.authorizedText.visibleText.length) {
    throw new Error("context.template.authorizedText.visibleText must be non-empty and unique.");
  }
  context.template.authorizedText.visibleText.forEach((value, index) =>
    assertText(value, `context.template.authorizedText.visibleText[${index}]`, 2_000));
  assertText(context.template.authorizedText.channelName, "context.template.authorizedText.channelName", 160);
  if (context.template.authorizedText.channelHandle !== null) {
    assertText(context.template.authorizedText.channelHandle, "context.template.authorizedText.channelHandle", 160);
  }
  for (const [key, value] of Object.entries(context.brief)) assertText(value, `context.brief.${key}`, 2_000);
  for (const [index, evidence] of context.factualEvidence.entries()) {
    assertText(evidence.claim, `context.factualEvidence[${index}].claim`, 2_000);
    assertText(evidence.evidence, `context.factualEvidence[${index}].evidence`, 4_000);
    assertSha(evidence.evidenceSha256, `context.factualEvidence[${index}].evidenceSha256`);
    if (evidence.evidenceSha256 !== sha256({ claim: evidence.claim, evidence: evidence.evidence })) {
      throw new Error(`context.factualEvidence[${index}] hash mismatch.`);
    }
  }
  for (const value of context.duplicateLedger.knownSourceSha256) assertSha(value, "known source hash");
  for (const value of context.duplicateLedger.knownStoryEventIds) assertText(value, "known story event", 160);
  if (new Set(context.bannedWords).size !== context.bannedWords.length) {
    throw new Error("context.bannedWords must be unique.");
  }
  context.bannedWords.forEach((value) => assertText(value, "context.bannedWords[]", 160));
  assertSha(context.contextSeedSha256, "context.contextSeedSha256");
  const { contextSeedSha256, ...withoutHash } = context;
  if (sha256(contextPayload(withoutHash)) !== contextSeedSha256) {
    throw new Error("Vision QA context seed hash mismatch.");
  }
}

export function createVisionQaCorpusPreparationPlan(input: Omit<
  VisionQaCorpusPreparationPlan,
  "schemaVersion" | "planSha256"
>): VisionQaCorpusPreparationPlan {
  const withoutHash = {
    schemaVersion: VISION_QA_CORPUS_PREPARATION_PLAN_VERSION,
    ...structuredClone(input),
    selectionProductionItemIds: [...input.selectionProductionItemIds].sort(),
    holdoutProductionItemIds: [...input.holdoutProductionItemIds].sort(),
    contexts: [...input.contexts].sort((left, right) =>
      left.productionItemId.localeCompare(right.productionItemId))
  } as const;
  const plan = { ...withoutHash, planSha256: sha256(withoutHash) };
  verifyVisionQaCorpusPreparationPlan(plan);
  return plan;
}

export function verifyVisionQaCorpusPreparationPlan(plan: VisionQaCorpusPreparationPlan): void {
  assertExactKeys(plan as unknown as UnknownRecord, [
    "schemaVersion", "campaignManifestSha256", "sourceAuditEvidenceSha256", "datasetId", "datasetVersion",
    "createdAt", "rubricVersion", "selectionProductionItemIds", "holdoutProductionItemIds", "contexts",
    "reviewers", "adjudicator", "planSha256"
  ], "preparation plan");
  if (plan.schemaVersion !== VISION_QA_CORPUS_PREPARATION_PLAN_VERSION) {
    throw new Error("Vision QA preparation plan version is unsupported.");
  }
  assertSha(plan.campaignManifestSha256, "plan.campaignManifestSha256");
  assertSha(plan.sourceAuditEvidenceSha256, "plan.sourceAuditEvidenceSha256");
  assertText(plan.datasetId, "plan.datasetId", 160);
  assertText(plan.datasetVersion, "plan.datasetVersion", 160);
  assertText(plan.rubricVersion, "plan.rubricVersion", 160);
  if (!Number.isFinite(Date.parse(plan.createdAt))) throw new Error("plan.createdAt must be an ISO timestamp.");
  if (plan.selectionProductionItemIds.length !== VISION_QA_REQUIRED_SELECTION_BASES ||
      plan.holdoutProductionItemIds.length !== VISION_QA_REQUIRED_HOLDOUT_CLEAN_BASES) {
    throw new Error("Preparation plan requires exactly 3 selection and 40 holdout clean production items.");
  }
  const allIds = [...plan.selectionProductionItemIds, ...plan.holdoutProductionItemIds];
  if (new Set(allIds).size !== allIds.length || plan.contexts.length !== allIds.length) {
    throw new Error("Preparation plan production items and contexts must be exactly 43 unique entries.");
  }
  if (stableJson(plan.selectionProductionItemIds) !== stableJson([...plan.selectionProductionItemIds].sort()) ||
      stableJson(plan.holdoutProductionItemIds) !== stableJson([...plan.holdoutProductionItemIds].sort()) ||
      stableJson(plan.contexts.map((value) => value.productionItemId)) !==
        stableJson(plan.contexts.map((value) => value.productionItemId).sort())) {
    throw new Error("Preparation plan item IDs and contexts must be canonically sorted.");
  }
  for (const context of plan.contexts) verifyVisionQaCorpusContextSeed(context);
  if (new Set(plan.contexts.map((context) => context.productionItemId)).size !== allIds.length ||
      plan.contexts.some((context) => !allIds.includes(context.productionItemId))) {
    throw new Error("Preparation plan contexts do not match its exact item roster.");
  }
  if (plan.reviewers.length !== 2) throw new Error("Preparation plan requires exactly two reviewers.");
  assertSha(plan.planSha256, "plan.planSha256");
  const { planSha256, ...withoutHash } = plan;
  if (sha256(withoutHash) !== planSha256) throw new Error("Vision QA preparation plan hash mismatch.");
}

function artifactByItem(evidence: VisionQaCorpusSourceAuditEvidence): Map<string, VisionQaCorpusSourceArtifact> {
  return new Map(evidence.artifacts.map((artifact) => [artifact.productionItemId, artifact]));
}

function assertPlanBoundToAudit(input: {
  repoRoot: string;
  evidence: VisionQaCorpusSourceAuditEvidence;
  plan: VisionQaCorpusPreparationPlan;
}): void {
  verifyVisionQaCorpusSourceAuditEvidence(input.evidence);
  assertVisionQaCorpusBuildReady(input.evidence);
  verifyVisionQaCorpusPreparationPlan(input.plan);
  if (input.plan.campaignManifestSha256 !== input.evidence.campaign.manifestSha256 ||
      input.plan.sourceAuditEvidenceSha256 !== input.evidence.evidenceSha256) {
    throw new Error("Vision QA preparation plan is not bound to the exact source audit and campaign.");
  }
  const selected = selectEligibleVisionQaCleanBasesFromAudit({
    repoRoot: input.repoRoot,
    evidence: input.evidence,
    productionItemIds: [...input.plan.selectionProductionItemIds, ...input.plan.holdoutProductionItemIds]
  });
  if (selected.length !== VISION_QA_REQUIRED_SELECTION_BASES + VISION_QA_REQUIRED_HOLDOUT_CLEAN_BASES) {
    throw new Error("Vision QA preparation plan does not resolve to exactly 43 eligible bases.");
  }
  const artifacts = artifactByItem(input.evidence);
  const sourceHashes = new Set<string>();
  const storyEvents = new Set<string>();
  for (const context of input.plan.contexts) {
    const artifact = artifacts.get(context.productionItemId);
    if (!artifact || !artifact.sourceSha256 || !artifact.eventGroupId || !artifact.templateSha256 ||
        !artifact.conceptContractSha256) {
      throw new Error(`Eligible base ${context.productionItemId} lacks source/story/template/concept provenance.`);
    }
    if (context.sourceArtifact.sha256 !== artifact.sourceSha256 ||
        context.brief.storyEventId !== artifact.eventGroupId ||
        context.template.templateSha256 !== artifact.templateSha256 ||
        sha256(context.conceptContract) !== artifact.conceptContractSha256) {
      throw new Error(`Context seed ${context.productionItemId} drifted from the audited production item.`);
    }
    if (sourceHashes.has(artifact.sourceSha256) || storyEvents.has(artifact.eventGroupId)) {
      throw new Error("Selection/holdout base roster must use unique source hashes and story events.");
    }
    sourceHashes.add(artifact.sourceSha256);
    storyEvents.add(artifact.eventGroupId);
  }
  const selection = new Set(input.plan.selectionProductionItemIds);
  const selectionSource = new Set(input.evidence.artifacts.filter((artifact) => selection.has(artifact.productionItemId))
    .flatMap((artifact) => artifact.sourceSha256 ? [artifact.sourceSha256] : []));
  const selectionEvents = new Set(input.evidence.artifacts.filter((artifact) => selection.has(artifact.productionItemId))
    .flatMap((artifact) => artifact.eventGroupId ? [artifact.eventGroupId] : []));
  for (const itemId of input.plan.holdoutProductionItemIds) {
    const artifact = artifacts.get(itemId)!;
    if (selectionSource.has(artifact.sourceSha256!) || selectionEvents.has(artifact.eventGroupId!)) {
      throw new Error("Selection/holdout source or story leakage detected before corpus mutation.");
    }
  }
}

async function writeExclusiveJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await fs.chmod(filePath, 0o444);
}

async function copyExclusiveBound(input: { source: string; destination: string; expectedSha256: string }): Promise<void> {
  if ((await sha256File(input.source).catch(() => null)) !== input.expectedSha256) {
    throw new Error(`Input artifact hash drifted before staging: ${input.source}.`);
  }
  await fs.mkdir(path.dirname(input.destination), { recursive: true });
  await fs.copyFile(input.source, input.destination, fs.constants.COPYFILE_EXCL);
  if ((await sha256File(input.destination)) !== input.expectedSha256) {
    await fs.rm(input.destination, { force: true });
    throw new Error("Staged Vision QA artifact hash mismatch.");
  }
  await fs.chmod(input.destination, 0o444);
}

async function probeDuration(ffprobePath: string, videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", videoPath
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Frame extraction requires a positive-duration video.");
  return duration;
}

function frameTimestamps(durationSec: number): number[] {
  const tail = Math.max(0.04, durationSec - 0.04);
  return [...new Set([0.04, durationSec * 0.25, durationSec * 0.5, durationSec * 0.75, tail]
    .map((value) => Math.max(0, Math.min(tail, value)).toFixed(3)))]
    .map(Number)
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || value - values[index - 1]! >= 0.001);
}

export async function extractVisionQaFrameManifest(input: {
  videoPath: string;
  outputDirectory: string;
  frameSetId: string;
  ffmpegPath?: string;
  ffprobePath?: string;
}): Promise<VisionQaFrameExtraction> {
  assertText(input.frameSetId, "frameSetId", 160);
  const ffmpegPath = input.ffmpegPath ?? "ffmpeg";
  const ffprobePath = input.ffprobePath ?? "ffprobe";
  const videoSha256 = await sha256File(input.videoPath);
  const durationSec = await probeDuration(ffprobePath, input.videoPath);
  const timestamps = frameTimestamps(durationSec);
  if (timestamps.length < 3) throw new Error("Frame extraction could not produce three distinct timestamps.");
  const outputDirectory = path.resolve(input.outputDirectory);
  await fs.mkdir(outputDirectory, { recursive: true });
  const root = path.join(outputDirectory, sha256(`frames:${input.frameSetId}`).slice(0, 32));
  await fs.mkdir(root, { recursive: false });
  const frames: Array<VisionQaFrameManifest["frames"][number]> = [];
  try {
    for (const [index, timestampSec] of timestamps.entries()) {
      const file = `${String(index).padStart(3, "0")}.png`;
      const filePath = path.join(root, file);
      await execFileAsync(ffmpegPath, [
        "-nostdin", "-v", "error", "-ss", timestampSec.toFixed(3), "-i", input.videoPath,
        "-frames:v", "1", "-vf", "scale='min(1080,iw)':-2:flags=lanczos", filePath
      ], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      const frameSha256 = await sha256File(filePath);
      await fs.chmod(filePath, 0o444);
      frames.push({ frameIndex: index, timestampMs: Math.round(timestampSec * 1_000), file, sha256: frameSha256 });
    }
    const manifest: VisionQaFrameManifest = {
      schemaVersion: "vision-qa-frame-manifest-v1",
      videoSha256,
      frames
    };
    const frameManifestPath = path.join(root, "manifest.json");
    const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
    await fs.writeFile(frameManifestPath, bytes, { encoding: "utf8", flag: "wx", mode: 0o444 });
    return {
      frameManifestPath,
      frameManifestSha256: sha256(bytes),
      frames: frames.map((frame) => ({
        frameIndex: frame.frameIndex,
        timestampMs: frame.timestampMs,
        filePath: path.join(root, frame.file),
        sha256: frame.sha256
      }))
    };
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

function selectDefects(baseIndex: number): readonly [VisionQaControlledDefect, VisionQaControlledDefect] {
  const first = VISION_QA_VISUAL_CORPUS_DEFECTS[(baseIndex * 2) % VISION_QA_VISUAL_CORPUS_DEFECTS.length]!;
  const second = VISION_QA_VISUAL_CORPUS_DEFECTS[(baseIndex * 2 + 1) % VISION_QA_VISUAL_CORPUS_DEFECTS.length]!;
  return [first, second];
}

function defectGroundTruth(defect: VisionQaControlledDefect): VisionQaEvalDefect {
  if (!(defect in VISION_QA_EVAL_DEFECT_TAXONOMY)) {
    throw new Error(`Controlled defect ${defect} is not valid Vision QA ground truth.`);
  }
  const code = defect as VisionQaEvalDefectCode;
  return {
    code,
    severity: VISION_QA_EVAL_DEFECT_TAXONOMY[code],
    rationale: `The sealed controlled-fault recipe injected ${code}; two blind reviews and independent adjudication must confirm it before freezing.`
  };
}

function truthSeed(input: Omit<VisionQaTruthSeed, "truthSeedSha256">): VisionQaTruthSeed {
  return { ...input, truthSeedSha256: sha256(input) };
}

function preparedCase(input: Omit<VisionQaPreparedBlindCase, "caseRecordSha256">): VisionQaPreparedBlindCase {
  return { ...input, caseRecordSha256: sha256(input) };
}

function relativeFrom(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  if (!relative || relative.split(/[\\/]+/).includes("..")) throw new Error("Corpus output escaped its immutable campaign root.");
  return relative;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function contextForCase(input: {
  seed: VisionQaCorpusContextSeed;
  sourceArtifactPath: string;
  sourceFrames: readonly VerifiedVisionQaFrame[];
  templateReference: VerifiedVisionQaFrame;
}): BlindSafeVisionQaContextPacket {
  return validateBlindSafeVisionQaContextPacket({
    schemaVersion: "project-kings-vision-qa-blind-context-v1",
    conceptContract: input.seed.conceptContract,
    template: {
      ...input.seed.template,
      reference: {
        filePath: input.templateReference.filePath,
        sha256: input.templateReference.sha256
      }
    },
    source: {
      artifact: { filePath: input.sourceArtifactPath, sha256: input.seed.sourceArtifact.sha256 },
      frames: input.sourceFrames,
      crop: { coordinateSpace: "normalized_source", ...input.seed.sourceCrop }
    },
    brief: input.seed.brief,
    factualEvidence: input.seed.factualEvidence,
    duplicateLedger: input.seed.duplicateLedger,
    bannedWords: input.seed.bannedWords
  });
}

export async function prepareVisionQaCorpusCampaign(input: {
  repoRoot: string;
  outputRoot: string;
  evidence: VisionQaCorpusSourceAuditEvidence;
  plan: VisionQaCorpusPreparationPlan;
  ffmpegPath?: string;
  ffprobePath?: string;
  dependencies?: VisionQaCorpusPreparationDependencies;
}): Promise<{ root: string; manifestPath: string; manifest: VisionQaPreparedCampaignManifest }> {
  const repoRoot = path.resolve(input.repoRoot);
  assertPlanBoundToAudit({ repoRoot, evidence: input.evidence, plan: input.plan });
  const campaignRoot = path.join(path.resolve(input.outputRoot), "campaigns", input.plan.planSha256);
  await fs.mkdir(path.dirname(campaignRoot), { recursive: true });
  await fs.mkdir(campaignRoot, { recursive: false });
  const generate = input.dependencies?.generateDefectVariant ?? generateVisionQaDefectVariant;
  const extract = input.dependencies?.extractFrames ?? ((options) => extractVisionQaFrameManifest(options));
  const ffmpegPath = input.ffmpegPath ?? "ffmpeg";
  const ffprobePath = input.ffprobePath ?? "ffprobe";
  const evidenceArtifacts = artifactByItem(input.evidence);
  const contextByItem = new Map(input.plan.contexts.map((context) => [context.productionItemId, context]));
  const eligibleBases = new Map(selectEligibleVisionQaCleanBasesFromAudit({
    repoRoot,
    evidence: input.evidence,
    productionItemIds: [...input.plan.selectionProductionItemIds, ...input.plan.holdoutProductionItemIds]
  }).map((base) => [base.productionItemId, base]));
  const blindCases: VisionQaPreparedBlindCase[] = [];
  const seeds: VisionQaTruthSeed[] = [];
  const artifactHashes = new Set<string>();
  let baseIndex = 0;
  try {
    for (const partition of ["selection_pool", "final_holdout"] as const) {
      const itemIds = partition === "selection_pool"
        ? input.plan.selectionProductionItemIds
        : input.plan.holdoutProductionItemIds;
      for (const productionItemId of itemIds) {
        const base = eligibleBases.get(productionItemId)!;
        const audited = evidenceArtifacts.get(productionItemId)!;
        const contextSeed = contextByItem.get(productionItemId)!;
        const opaqueBaseId = sha256(`base:${input.plan.planSha256}:${productionItemId}`).slice(0, 32);
        const stagedSourcePath = path.join(campaignRoot, "assets", `${opaqueBaseId}.mp4`);
        await copyExclusiveBound({
          source: path.resolve(repoRoot, contextSeed.sourceArtifact.relativePath),
          destination: stagedSourcePath,
          expectedSha256: contextSeed.sourceArtifact.sha256
        });
        const sourceFrames = await extract({
          videoPath: stagedSourcePath,
          outputDirectory: path.join(campaignRoot, "source-frames"),
          frameSetId: `${opaqueBaseId}:source`,
          ffmpegPath,
          ffprobePath
        });
        const stagedBasePath = path.join(campaignRoot, "artifacts", `${opaqueBaseId}.mp4`);
        await copyExclusiveBound({ source: base.artifactPath, destination: stagedBasePath, expectedSha256: base.artifactSha256 });
        const baseFrames = await extract({
          videoPath: stagedBasePath,
          outputDirectory: path.join(campaignRoot, "frames"),
          frameSetId: `${opaqueBaseId}:base`,
          ffmpegPath,
          ffprobePath
        });
        const templateReference = baseFrames.frames[Math.floor(baseFrames.frames.length / 2)]!;
        const contextPacket = contextForCase({
          seed: contextSeed,
          sourceArtifactPath: stagedSourcePath,
          sourceFrames: sourceFrames.frames,
          templateReference
        });
        const caseSpecs: Array<{
          artifactPath: string;
          artifactSha256: string;
          frames: VisionQaFrameExtraction;
          recipe: VisionQaDefectRecipeManifest | null;
          defect: VisionQaControlledDefect | null;
        }> = [{
          artifactPath: stagedBasePath,
          artifactSha256: base.artifactSha256,
          frames: baseFrames,
          recipe: null,
          defect: null
        }];
        for (const defect of selectDefects(baseIndex)) {
          if (defect === "banned_word" && contextSeed.bannedWords.length < 1) {
            throw new Error(`Context ${productionItemId} needs at least one banned word for its controlled variant.`);
          }
          const recipe = await generate({
            base: base as EligibleVisionQaCleanBase,
            defect,
            outputRoot: campaignRoot,
            bannedWord: defect === "banned_word" ? contextSeed.bannedWords[0]! : null,
            createdAt: input.plan.createdAt,
            ffmpegPath,
            ffprobePath
          });
          if (!recipe.probe.injectionObserved) throw new Error(`Controlled defect ${defect} has no observed injection proof.`);
          const artifactPath = path.join(campaignRoot, recipe.blindArtifact.relativePath);
          const frames = await extract({
            videoPath: artifactPath,
            outputDirectory: path.join(campaignRoot, "frames"),
            frameSetId: `${opaqueBaseId}:${recipe.recipeSha256}`,
            ffmpegPath,
            ffprobePath
          });
          caseSpecs.push({ artifactPath, artifactSha256: recipe.blindArtifact.sha256, frames, recipe, defect });
        }
        for (const spec of caseSpecs) {
          if (artifactHashes.has(spec.artifactSha256)) throw new Error("Vision QA campaign produced a duplicate final artifact hash.");
          artifactHashes.add(spec.artifactSha256);
          const blindCaseToken = sha256(`case:${input.plan.planSha256}:${spec.artifactSha256}`);
          const request: BlindVisionQaJudgeInput = {
            blindCaseToken,
            channelId: audited.channelId,
            templateSha256: contextSeed.template.templateSha256,
            conceptId: contextSeed.conceptContract.conceptId,
            artifact: { filePath: spec.artifactPath, sha256: spec.artifactSha256 },
            frames: spec.frames.frames,
            contextPacket,
            contextPacketSha256: calculateBlindSafeVisionQaContextPacketSha256(contextPacket)
          };
          const requestSha256 = calculateBlindVisionQaJudgeRequestSha256(request);
          blindCases.push(preparedCase({
            blindCaseToken,
            partition,
            baseProductionItemId: productionItemId,
            requestSha256,
            request,
            frameManifestPath: spec.frames.frameManifestPath,
            frameManifestSha256: spec.frames.frameManifestSha256,
            deterministicVerdict: { decision: "PASS", defectCodes: [] }
          }));
          seeds.push(truthSeed({
            blindCaseToken,
            partition,
            baseProductionItemId: productionItemId,
            groundTruthClass: spec.recipe ? "defective" : "clean",
            expectedDefect: spec.defect ? defectGroundTruth(spec.defect) : null,
            provenance: {
              kind: spec.recipe ? "controlled_fault_injection" : "explicit_final_approval",
              sourceAuditEvidenceSha256: input.evidence.evidenceSha256,
              sourceArtifactSha256: contextSeed.sourceArtifact.sha256,
              productionItemId,
              defectRecipeManifestSha256: spec.recipe?.manifestSha256 ?? null,
              defectProbeEvidenceSha256: spec.recipe?.probe.evidenceSha256 ?? null
            }
          }));
        }
        baseIndex += 1;
      }
    }
    const holdoutCases = blindCases.filter((entry) => entry.partition === "final_holdout");
    const holdoutSeeds = seeds.filter((entry) => entry.partition === "final_holdout");
    const selectionSeeds = seeds.filter((entry) => entry.partition === "selection_pool");
    const counts = {
      selectionClean: selectionSeeds.filter((entry) => entry.groundTruthClass === "clean").length,
      selectionDefective: selectionSeeds.filter((entry) => entry.groundTruthClass === "defective").length,
      holdoutClean: holdoutSeeds.filter((entry) => entry.groundTruthClass === "clean").length,
      holdoutDefective: holdoutSeeds.filter((entry) => entry.groundTruthClass === "defective").length,
      holdoutTotal: holdoutCases.length,
      uniqueFinalArtifactHashes: artifactHashes.size
    };
    if (counts.selectionClean !== 3 || counts.selectionDefective !== 6 || counts.holdoutClean !== 40 ||
        counts.holdoutDefective !== 80 || counts.holdoutTotal !== 120 || artifactHashes.size < 120) {
      throw new Error("Vision QA corpus preparation did not produce exact 3+6 selection and 40+80 holdout counts.");
    }
    const blindWithoutHash = {
      schemaVersion: VISION_QA_CORPUS_BLIND_CASES_VERSION,
      campaignManifestSha256: input.evidence.campaign.manifestSha256,
      preparationPlanSha256: input.plan.planSha256,
      cases: blindCases
    } as const;
    const blindFile: VisionQaBlindCasesFile = {
      ...blindWithoutHash,
      blindCasesSha256: sha256(blindWithoutHash)
    };
    const truthWithoutHash = {
      schemaVersion: VISION_QA_CORPUS_TRUTH_SEED_VERSION,
      campaignManifestSha256: input.evidence.campaign.manifestSha256,
      preparationPlanSha256: input.plan.planSha256,
      seeds
    } as const;
    const truthFile: VisionQaTruthSeedsFile = {
      ...truthWithoutHash,
      truthSeedsSha256: sha256(truthWithoutHash)
    };
    const blindPath = path.join(campaignRoot, "blind-cases.json");
    const truthPath = path.join(campaignRoot, "sealed-truth-seeds.json");
    await writeExclusiveJson(blindPath, blindFile);
    await writeExclusiveJson(truthPath, truthFile);
    const annotationCampaign = await createVisionQaAnnotationCampaign({
      outputRoot: path.join(campaignRoot, "review-campaigns"),
      campaignId: `${input.plan.datasetId}:${input.plan.datasetVersion}:${input.plan.planSha256}`,
      corpusManifestSha256: blindFile.blindCasesSha256,
      createdAt: input.plan.createdAt,
      rubricVersion: input.plan.rubricVersion,
      reviewers: input.plan.reviewers,
      adjudicator: input.plan.adjudicator,
      cases: blindCases.map((entry) => entry.request)
    });
    const manifestWithoutHash = {
      schemaVersion: VISION_QA_CORPUS_PREPARED_MANIFEST_VERSION,
      campaignManifestSha256: input.evidence.campaign.manifestSha256,
      sourceAuditEvidenceSha256: input.evidence.evidenceSha256,
      preparationPlanSha256: input.plan.planSha256,
      datasetId: input.plan.datasetId,
      datasetVersion: input.plan.datasetVersion,
      createdAt: input.plan.createdAt,
      counts: counts as VisionQaPreparedCampaignManifest["counts"],
      blindCases: { relativePath: relativeFrom(campaignRoot, blindPath), sha256: blindFile.blindCasesSha256 },
      sealedTruthSeeds: { relativePath: relativeFrom(campaignRoot, truthPath), sha256: truthFile.truthSeedsSha256 },
      annotationCampaign: {
        relativePath: relativeFrom(campaignRoot, annotationCampaign.manifestPath),
        manifestSha256: annotationCampaign.manifest.manifestSha256,
        reviewerPacketRelativePaths: annotationCampaign.reviewerPacketPaths.map((filePath) =>
          relativeFrom(campaignRoot, filePath)) as [string, string],
        adjudicationAssignmentRelativePath: relativeFrom(campaignRoot, annotationCampaign.adjudicationAssignmentPath)
      }
    } as const;
    const manifest: VisionQaPreparedCampaignManifest = {
      ...manifestWithoutHash,
      manifestSha256: sha256(manifestWithoutHash)
    };
    const manifestPath = path.join(campaignRoot, "prepared-manifest.json");
    await writeExclusiveJson(manifestPath, manifest);
    return { root: campaignRoot, manifestPath, manifest };
  } catch (error) {
    await fs.rm(campaignRoot, { recursive: true, force: true });
    throw error;
  }
}

function verifyReviewDecision(decision: "PASS" | "FAIL", defects: readonly VisionQaEvalDefect[], label: string): void {
  verifyDefects(defects, label);
  if ((decision === "PASS") !== (defects.length === 0)) {
    throw new Error(`${label} decision contradicts its defects.`);
  }
}

export function verifyVisionQaReviewResponse(input: {
  response: VisionQaReviewResponse;
  campaign: VisionQaAnnotationCampaignManifest;
  packet: VisionQaAnnotationPacket;
}): void {
  verifyVisionQaAnnotationCampaignManifest(input.campaign);
  verifyVisionQaAnnotationPacket(input.packet);
  const response = input.response;
  const reviewerIndex = input.campaign.reviewers.findIndex(
    (identity) => identity.reviewerId === input.packet.assignedIdentity.reviewerId
  );
  if (response.schemaVersion !== VISION_QA_REVIEW_RESPONSE_VERSION ||
      response.campaignManifestSha256 !== input.campaign.manifestSha256 ||
      response.reviewerPacketSha256 !== input.packet.packetSha256 ||
      response.reviewerId !== input.packet.assignedIdentity.reviewerId ||
      input.packet.campaignId !== input.campaign.campaignId ||
      reviewerIndex < 0 || input.campaign.packetSha256[reviewerIndex] !== input.packet.packetSha256 ||
      stableJson(input.campaign.reviewers[reviewerIndex]) !== stableJson(input.packet.assignedIdentity) ||
      !Number.isFinite(Date.parse(response.completedAt))) {
    throw new Error("Vision QA review response is not bound to its exact campaign, packet and reviewer.");
  }
  if (response.annotations.length !== input.packet.cases.length) {
    throw new Error("Vision QA review response must cover every assigned blind case exactly once.");
  }
  const expected = new Map(input.packet.cases.map((entry) => [entry.blindCaseToken, entry.requestSha256]));
  const seen = new Set<string>();
  const invocationEvidence = new Set<string>();
  for (const annotation of response.annotations) {
    if (seen.has(annotation.blindCaseToken) || expected.get(annotation.blindCaseToken) !== annotation.requestSha256) {
      throw new Error("Vision QA review response contains a duplicate, foreign or drifted case.");
    }
    seen.add(annotation.blindCaseToken);
    assertSha(annotation.invocationEvidenceSha256, "review annotation invocation evidence");
    if (invocationEvidence.has(annotation.invocationEvidenceSha256)) {
      throw new Error("Vision QA review reused invocation evidence across blind cases.");
    }
    invocationEvidence.add(annotation.invocationEvidenceSha256);
    verifyReviewDecision(annotation.decision, annotation.defects, "review annotation");
  }
  assertSha(response.responseSha256, "review response hash");
  const { responseSha256, ...withoutHash } = response;
  if (sha256(withoutHash) !== responseSha256) throw new Error("Vision QA review response hash mismatch.");
}

export function createVisionQaAdjudicationInputPacket(input: {
  campaign: VisionQaAnnotationCampaignManifest;
  assignment: VisionQaAdjudicationAssignmentPacket;
  reviewerPackets: readonly [VisionQaAnnotationPacket, VisionQaAnnotationPacket];
  responses: readonly [VisionQaReviewResponse, VisionQaReviewResponse];
}): VisionQaAdjudicationInputPacket {
  verifyVisionQaAnnotationCampaignManifest(input.campaign);
  verifyVisionQaAnnotationPacket(input.assignment);
  input.reviewerPackets.forEach((packet) => verifyVisionQaAnnotationPacket(packet));
  if (input.assignment.campaignId !== input.campaign.campaignId ||
      input.assignment.packetSha256 !== input.campaign.packetSha256[2] ||
      stableJson(input.assignment.assignedIdentity) !== stableJson(input.campaign.adjudicator) ||
      input.reviewerPackets.some((packet, index) =>
        packet.packetSha256 !== input.campaign.packetSha256[index] ||
        packet.campaignId !== input.campaign.campaignId ||
        stableJson(packet.assignedIdentity) !== stableJson(input.campaign.reviewers[index]))) {
    throw new Error("Annotation packets are not the exact packets frozen in the campaign manifest.");
  }
  input.responses.forEach((response, index) => verifyVisionQaReviewResponse({
    response,
    campaign: input.campaign,
    packet: input.reviewerPackets[index]!
  }));
  const responseMaps = input.responses.map((response) =>
    new Map(response.annotations.map((annotation) => [annotation.blindCaseToken, annotation]))) as [
      Map<string, VisionQaReviewResponse["annotations"][number]>,
      Map<string, VisionQaReviewResponse["annotations"][number]>
    ];
  const cases = input.reviewerPackets[0].cases.map((entry) => ({
    blindCaseToken: entry.blindCaseToken,
    requestSha256: entry.requestSha256,
    reviews: input.reviewerPackets.map((packet, reviewerIndex) => {
      const annotation = responseMaps[reviewerIndex]!.get(entry.blindCaseToken)!;
      return {
        reviewerId: packet.assignedIdentity.reviewerId,
        decision: annotation.decision,
        defects: annotation.defects
      };
    }) as [
      { reviewerId: string; decision: "PASS" | "FAIL"; defects: readonly VisionQaEvalDefect[] },
      { reviewerId: string; decision: "PASS" | "FAIL"; defects: readonly VisionQaEvalDefect[] }
    ]
  }));
  const withoutHash = {
    schemaVersion: VISION_QA_ADJUDICATION_INPUT_VERSION,
    campaignManifestSha256: input.campaign.manifestSha256,
    assignmentPacketSha256: input.assignment.packetSha256,
    assignedIdentity: input.assignment.assignedIdentity,
    reviewerResponseSha256: input.responses.map((response) => response.responseSha256) as [string, string],
    cases,
    forbiddenContext: ["ground_truth", "defect_recipe", "fault_injection"] as const
  };
  return { ...withoutHash, packetSha256: sha256(withoutHash) };
}

export function verifyVisionQaAdjudicationResponse(input: {
  response: VisionQaAdjudicationResponse;
  packet: VisionQaAdjudicationInputPacket;
}): void {
  const { packetSha256, ...packetWithoutHash } = input.packet;
  if (sha256(packetWithoutHash) !== packetSha256) throw new Error("Vision QA adjudication input packet hash mismatch.");
  const response = input.response;
  if (response.schemaVersion !== VISION_QA_ADJUDICATION_RESPONSE_VERSION ||
      response.campaignManifestSha256 !== input.packet.campaignManifestSha256 ||
      response.adjudicationInputPacketSha256 !== input.packet.packetSha256 ||
      response.adjudicatorId !== input.packet.assignedIdentity.reviewerId ||
      !Number.isFinite(Date.parse(response.completedAt)) ||
      response.cases.length !== input.packet.cases.length) {
    throw new Error("Vision QA adjudication response is not bound to its exact input packet.");
  }
  const expected = new Map(input.packet.cases.map((entry) => [entry.blindCaseToken, entry.requestSha256]));
  const seen = new Set<string>();
  const invocationEvidence = new Set<string>();
  for (const adjudication of response.cases) {
    if (seen.has(adjudication.blindCaseToken) || expected.get(adjudication.blindCaseToken) !== adjudication.requestSha256) {
      throw new Error("Vision QA adjudication response contains a duplicate, foreign or drifted case.");
    }
    seen.add(adjudication.blindCaseToken);
    assertText(adjudication.resolution, "adjudication resolution", 4_000);
    assertSha(adjudication.invocationEvidenceSha256, "adjudication invocation evidence");
    if (invocationEvidence.has(adjudication.invocationEvidenceSha256)) {
      throw new Error("Vision QA adjudication reused invocation evidence across blind cases.");
    }
    invocationEvidence.add(adjudication.invocationEvidenceSha256);
    verifyReviewDecision(adjudication.decision, adjudication.defects, "adjudication");
  }
  assertSha(response.responseSha256, "adjudication response hash");
  const { responseSha256, ...withoutHash } = response;
  if (sha256(withoutHash) !== responseSha256) throw new Error("Vision QA adjudication response hash mismatch.");
}

function annotationFromResponse(input: {
  campaign: VisionQaAnnotationCampaignManifest;
  packet: VisionQaAnnotationPacket;
  response: VisionQaReviewResponse;
  blindCaseToken: string;
}): VisionQaEvalAnnotation {
  const value = input.response.annotations.find((entry) => entry.blindCaseToken === input.blindCaseToken)!;
  const provenance = {
    reviewerKind: input.packet.assignedIdentity.reviewerKind,
    provider: input.packet.assignedIdentity.provider,
    model: input.packet.assignedIdentity.model,
    routeId: input.packet.assignedIdentity.routeId,
    reasoningEffort: input.packet.assignedIdentity.reasoningEffort,
    isolationBoundary: input.packet.assignedIdentity.isolationBoundary,
    independenceKey: input.packet.assignedIdentity.independenceKey,
    invocationEvidenceSha256: value.invocationEvidenceSha256
  };
  if (!reviewerProvenanceMatchesIdentity({ provenance, identity: input.packet.assignedIdentity })) {
    throw new Error("Vision QA reviewer provenance does not match the assigned independent identity.");
  }
  return {
    annotationId: sha256(`annotation:${input.campaign.manifestSha256}:${input.packet.packetSha256}:${input.blindCaseToken}`),
    annotatorId: input.packet.assignedIdentity.reviewerId,
    annotationVersion: input.packet.rubricVersion,
    completedAt: input.response.completedAt,
    blind: true,
    provenance,
    decision: value.decision,
    defects: value.defects
  };
}

function verifyPreparedFile<T extends { [key: string]: unknown }>(input: {
  file: T;
  hashField: keyof T;
  expectedHash: string;
}): void {
  const actual = input.file[input.hashField];
  if (actual !== input.expectedHash) throw new Error("Prepared Vision QA file does not match its manifest hash.");
  const clone = { ...input.file };
  delete clone[input.hashField];
  if (sha256(clone) !== input.expectedHash) throw new Error("Prepared Vision QA file hash mismatch.");
}

export async function finalizeVisionQaCorpusCampaign(input: {
  campaignRoot: string;
  preparedManifest: VisionQaPreparedCampaignManifest;
  reviewerPackets: readonly [VisionQaAnnotationPacket, VisionQaAnnotationPacket];
  campaign: VisionQaAnnotationCampaignManifest;
  reviewResponses: readonly [VisionQaReviewResponse, VisionQaReviewResponse];
  adjudicationPacket: VisionQaAdjudicationInputPacket;
  adjudicationResponse: VisionQaAdjudicationResponse;
}): Promise<{ corpus: FrozenVisionQaEvalCorpus; manifestPath: string }> {
  const campaignRoot = path.resolve(input.campaignRoot);
  const prepared = input.preparedManifest;
  const { manifestSha256, ...preparedWithoutHash } = prepared;
  if (sha256(preparedWithoutHash) !== manifestSha256) throw new Error("Prepared campaign manifest hash mismatch.");
  if (input.campaign.manifestSha256 !== prepared.annotationCampaign.manifestSha256) {
    throw new Error("Annotation campaign does not match the prepared corpus manifest.");
  }
  const blindFile = await readJson<VisionQaBlindCasesFile>(path.join(campaignRoot, prepared.blindCases.relativePath));
  const truthFile = await readJson<VisionQaTruthSeedsFile>(path.join(campaignRoot, prepared.sealedTruthSeeds.relativePath));
  verifyPreparedFile({ file: blindFile as unknown as UnknownRecord, hashField: "blindCasesSha256", expectedHash: prepared.blindCases.sha256 });
  verifyPreparedFile({ file: truthFile as unknown as UnknownRecord, hashField: "truthSeedsSha256", expectedHash: prepared.sealedTruthSeeds.sha256 });
  if (blindFile.schemaVersion !== VISION_QA_CORPUS_BLIND_CASES_VERSION ||
      truthFile.schemaVersion !== VISION_QA_CORPUS_TRUTH_SEED_VERSION ||
      blindFile.campaignManifestSha256 !== prepared.campaignManifestSha256 ||
      truthFile.campaignManifestSha256 !== prepared.campaignManifestSha256 ||
      blindFile.preparationPlanSha256 !== prepared.preparationPlanSha256 ||
      truthFile.preparationPlanSha256 !== prepared.preparationPlanSha256 ||
      blindFile.cases.length !== truthFile.seeds.length) {
    throw new Error("Prepared blind cases and sealed truth seeds are not bound to the exact plan and campaign.");
  }
  for (const blind of blindFile.cases) {
    const { caseRecordSha256, ...withoutCaseHash } = blind;
    assertSha(caseRecordSha256, "blind case record hash");
    if (sha256(withoutCaseHash) !== caseRecordSha256 ||
        calculateBlindVisionQaJudgeRequestSha256(blind.request) !== blind.requestSha256) {
      throw new Error("Prepared blind case or request hash mismatch.");
    }
  }
  for (const seed of truthFile.seeds) {
    const { truthSeedSha256, ...withoutSeedHash } = seed;
    assertSha(truthSeedSha256, "truth seed hash");
    if (sha256(withoutSeedHash) !== truthSeedSha256) throw new Error("Sealed truth seed hash mismatch.");
    if (seed.groundTruthClass === "clean") {
      if (seed.expectedDefect !== null || seed.provenance.kind !== "explicit_final_approval" ||
          seed.provenance.defectRecipeManifestSha256 !== null || seed.provenance.defectProbeEvidenceSha256 !== null) {
        throw new Error("Clean truth seed is not derived exclusively from explicit final approval.");
      }
    } else {
      if (!seed.expectedDefect || seed.provenance.kind !== "controlled_fault_injection") {
        throw new Error("Defective truth seed is not derived from a controlled fault injection.");
      }
      verifyDefects([seed.expectedDefect], "truth seed expected defect");
      assertSha(seed.provenance.defectRecipeManifestSha256, "truth seed defect recipe hash");
      assertSha(seed.provenance.defectProbeEvidenceSha256, "truth seed defect probe hash");
    }
    assertSha(seed.provenance.sourceAuditEvidenceSha256, "truth seed source audit hash");
    assertSha(seed.provenance.sourceArtifactSha256, "truth seed source artifact hash");
    if (seed.provenance.sourceAuditEvidenceSha256 !== prepared.sourceAuditEvidenceSha256 ||
        seed.provenance.productionItemId !== seed.baseProductionItemId) {
      throw new Error("Truth seed provenance drifted from the prepared source audit or base item.");
    }
  }
  input.reviewResponses.forEach((response, index) => verifyVisionQaReviewResponse({
    response,
    campaign: input.campaign,
    packet: input.reviewerPackets[index]!
  }));
  verifyVisionQaAdjudicationResponse({ response: input.adjudicationResponse, packet: input.adjudicationPacket });
  if (input.adjudicationPacket.campaignManifestSha256 !== input.campaign.manifestSha256 ||
      input.adjudicationPacket.assignmentPacketSha256 !== input.campaign.packetSha256[2] ||
      stableJson(input.adjudicationPacket.assignedIdentity) !== stableJson(input.campaign.adjudicator) ||
      stableJson(input.adjudicationPacket.reviewerResponseSha256) !==
        stableJson(input.reviewResponses.map((response) => response.responseSha256)) ||
      input.adjudicationPacket.cases.length !== blindFile.cases.length) {
    throw new Error("Adjudication input is not bound to the exact campaign, reviews and blind case roster.");
  }
  const adjudicationRequests = new Map(input.adjudicationPacket.cases.map((entry) => [
    entry.blindCaseToken,
    entry.requestSha256
  ]));
  if (blindFile.cases.some((entry) => adjudicationRequests.get(entry.blindCaseToken) !== entry.requestSha256)) {
    throw new Error("Adjudication input case roster drifted from the prepared blind requests.");
  }
  const latestReview = Math.max(...input.reviewResponses.map((response) => Date.parse(response.completedAt)));
  if (Date.parse(input.adjudicationResponse.completedAt) < latestReview) {
    throw new Error("Vision QA adjudication cannot precede the independent reviews.");
  }
  const truthByToken = new Map(truthFile.seeds.map((seed) => [seed.blindCaseToken, seed]));
  const adjudicationByToken = new Map(input.adjudicationResponse.cases.map((entry) => [entry.blindCaseToken, entry]));
  const evalCases: VisionQaEvalCase[] = [];
  for (const blind of blindFile.cases) {
    const truth = truthByToken.get(blind.blindCaseToken);
    const adjudication = adjudicationByToken.get(blind.blindCaseToken);
    if (!truth || !adjudication || truth.partition !== blind.partition) {
      throw new Error("Vision QA finalization lost its sealed truth or adjudication binding.");
    }
    if (truth.groundTruthClass === "clean") {
      if (adjudication.decision !== "PASS" || adjudication.defects.length !== 0) {
        throw new Error(`Explicitly approved clean base ${truth.baseProductionItemId} was not confirmed clean; replace it instead of inventing PASS.`);
      }
    } else if (adjudication.decision !== "FAIL" || !truth.expectedDefect ||
        !adjudication.defects.some((defect) => defect.code === truth.expectedDefect!.code)) {
      throw new Error(`Controlled defect ${truth.expectedDefect?.code ?? "unknown"} was not independently confirmed; no ground truth was frozen.`);
    }
    const context = blind.request.contextPacket;
    const annotations = input.reviewerPackets.map((packet, index) => annotationFromResponse({
      campaign: input.campaign,
      packet,
      response: input.reviewResponses[index]!,
      blindCaseToken: blind.blindCaseToken
    })) as [VisionQaEvalAnnotation, VisionQaEvalAnnotation];
    const adjudicatorIdentity = input.adjudicationPacket.assignedIdentity;
    const provenance = {
      reviewerKind: adjudicatorIdentity.reviewerKind,
      provider: adjudicatorIdentity.provider,
      model: adjudicatorIdentity.model,
      routeId: adjudicatorIdentity.routeId,
      reasoningEffort: adjudicatorIdentity.reasoningEffort,
      isolationBoundary: adjudicatorIdentity.isolationBoundary,
      independenceKey: adjudicatorIdentity.independenceKey,
      invocationEvidenceSha256: adjudication.invocationEvidenceSha256
    };
    if (!reviewerProvenanceMatchesIdentity({ provenance, identity: adjudicatorIdentity })) {
      throw new Error("Vision QA adjudicator provenance does not match its independent identity.");
    }
    evalCases.push({
      caseId: sha256(`eval-case:${blind.blindCaseToken}`).slice(0, 32),
      sourceSha256: context.source.artifact.sha256,
      storyEventId: context.brief.storyEventId,
      channelId: blind.request.channelId,
      templateSha256: blind.request.templateSha256,
      conceptId: blind.request.conceptId,
      groundTruthClass: truth.groundTruthClass,
      artifactPath: blind.request.artifact.filePath,
      artifactSha256: blind.request.artifact.sha256,
      frameManifestPath: blind.frameManifestPath,
      frameManifestSha256: blind.frameManifestSha256,
      blindContextPacket: context,
      blindContextPacketSha256: blind.request.contextPacketSha256,
      deterministicVerdict: blind.deterministicVerdict,
      annotations,
      adjudication: {
        adjudicationId: sha256(`adjudication:${input.campaign.manifestSha256}:${blind.blindCaseToken}`),
        adjudicatorId: adjudicatorIdentity.reviewerId,
        adjudicationVersion: input.reviewerPackets[0].rubricVersion,
        completedAt: input.adjudicationResponse.completedAt,
        provenance,
        decision: adjudication.decision,
        defects: adjudication.defects,
        resolution: adjudication.resolution
      }
    });
  }
  const selectionInput: VisionQaEvalPartitionInput = {
    schemaVersion: VISION_QA_EVAL_CORPUS_VERSION,
    partition: "selection_pool",
    datasetId: `${prepared.datasetId}:selection`,
    datasetVersion: prepared.datasetVersion,
    cases: evalCases.filter((_, index) => blindFile.cases[index]!.partition === "selection_pool")
  };
  const holdoutInput: VisionQaEvalPartitionInput = {
    schemaVersion: VISION_QA_EVAL_CORPUS_VERSION,
    partition: "final_holdout",
    datasetId: `${prepared.datasetId}:holdout`,
    datasetVersion: prepared.datasetVersion,
    cases: evalCases.filter((_, index) => blindFile.cases[index]!.partition === "final_holdout")
  };
  const selectionPool = await freezeVisionQaEvalPartition(selectionInput);
  const finalHoldout = await freezeVisionQaEvalPartition(holdoutInput);
  const corpus = assembleFrozenVisionQaEvalCorpus({ selectionPool, finalHoldout });
  const frozenRoot = path.join(campaignRoot, "frozen");
  await fs.mkdir(frozenRoot, { recursive: false });
  await writeFrozenVisionQaEvalPartition(path.join(frozenRoot, "selection-pool.json"), selectionPool);
  await writeFrozenVisionQaEvalPartition(path.join(frozenRoot, "final-holdout.json"), finalHoldout);
  const manifestWithoutHash = {
    schemaVersion: "project-kings-vision-qa-frozen-corpus-manifest-v1",
    preparedManifestSha256: prepared.manifestSha256,
    annotationCampaignManifestSha256: input.campaign.manifestSha256,
    reviewerResponseSha256: input.reviewResponses.map((response) => response.responseSha256),
    adjudicationResponseSha256: input.adjudicationResponse.responseSha256,
    selectionPoolSha256: selectionPool.partitionSha256,
    finalHoldoutSha256: finalHoldout.partitionSha256,
    corpusSha256: corpus.corpusSha256
  } as const;
  const frozenManifest = { ...manifestWithoutHash, manifestSha256: sha256(manifestWithoutHash) };
  const manifestPath = path.join(frozenRoot, "manifest.json");
  await writeExclusiveJson(manifestPath, frozenManifest);
  return { corpus, manifestPath };
}
