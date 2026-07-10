import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

export const VISION_QA_CORPUS_SOURCE_AUDIT_VERSION =
  "project-kings-vision-qa-source-audit-v2" as const;
export const VISION_QA_CORPUS_CAMPAIGN_MANIFEST_VERSION =
  "project-kings-vision-qa-campaign-v1" as const;
export const VISION_QA_REQUIRED_SELECTION_BASES = 3;
export const VISION_QA_REQUIRED_HOLDOUT_CLEAN_BASES = 40;
export const VISION_QA_REQUIRED_APPROVED_BASES = 43;

const execFileAsync = promisify(execFile);

type UnknownRecord = Record<string, unknown>;

type ProductionItemAuditRow = {
  run_id: string;
  run_manifest_hash: string;
  production_item_id: string;
  production_item_state: string;
  channel_id: string;
  event_fingerprint: string | null;
  source_sha256: string | null;
  preview_sha256: string | null;
  template_sha256: string | null;
  settings_sha256: string | null;
  final_artifact_sha256: string | null;
  stage3_job_id: string | null;
  render_export_id: string | null;
  artifact_file_path: string | null;
  artifact_file_name: string | null;
  artifact_size_bytes: number | null;
  artifact_mime_type: string | null;
  snapshot_json: string | null;
  stage3_status: string | null;
  profile_id: string;
  profile_version: number;
  profile_hash: string;
  profile_config_json: string;
};

type QualityVerdictAuditRow = {
  id: string;
  run_id: string;
  production_item_id: string;
  judge_kind: string;
  verdict: string;
  artifact_sha256: string;
  source_sha256: string | null;
  preview_sha256: string | null;
  template_sha256: string | null;
  settings_sha256: string | null;
  agent_attempt_id: string | null;
  evidence_sha256: string | null;
  evidence_artifact_path: string | null;
  defects_json: string;
  attempt_role: string | null;
  attempt_status: string | null;
  attempt_output_hash: string | null;
  attempt_quality_binding_sha256: string | null;
};

export type VisionQaCorpusCampaignManifest = Readonly<{
  schemaVersion: typeof VISION_QA_CORPUS_CAMPAIGN_MANIFEST_VERSION;
  campaignId: string;
  runs: readonly Readonly<{
    runId: string;
    productionManifestSha256: string;
  }>[];
  manifestSha256: string;
}>;

export type VisionQaArtifactInspection = Readonly<{
  sizeBytes: number;
  sha256: string;
  durationMs: number | null;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  audioCodec: string | null;
  decodeComplete: boolean;
  decodeError: string | null;
}>;

export type VisionQaCorpusSourceArtifact = Readonly<{
  relativePath: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  audioCodec: string | null;
  decodeComplete: boolean;
  decodeError: string | null;
  runId: string;
  runManifestSha256: string;
  productionItemId: string;
  productionItemState: string;
  databaseMatchCount: number;
  renderExportId: string | null;
  stage3JobId: string | null;
  channelId: string;
  profileId: string;
  profileVersion: number;
  profileHash: string;
  conceptContractSha256: string | null;
  sourceSha256: string | null;
  templateSha256: string | null;
  eventGroupId: string | null;
  completedRenderExport: boolean;
  exactDatabaseSize: boolean;
  exactFinalArtifactSha256: boolean;
  layoutAwareSourceCropBound: boolean;
  deterministicFinalPassBound: boolean;
  visionFinalPassBound: boolean;
  derivedFinalPass: boolean;
  explicitApprovalBound: boolean;
}>;

export type VisionQaCorpusSourceAuditEvidence = Readonly<{
  schemaVersion: typeof VISION_QA_CORPUS_SOURCE_AUDIT_VERSION;
  auditedAt: string;
  campaign: VisionQaCorpusCampaignManifest;
  approvalPolicy: Readonly<{
    policyId: "project-kings-final-approved-derived-pass-v1";
    completedRenderExportIsApproval: false;
    requires: readonly [
      "campaign_run_manifest_binding",
      "production_item_final_approved",
      "exact_final_mp4_sha256",
      "layout_aware_source_crop",
      "deterministic_final_pass",
      "vision_final_pass",
      "exact_quality_bindings",
      "quality_evidence_provenance"
    ];
  }>;
  requirements: Readonly<{
    selectionBases: 3;
    holdoutCleanBases: 40;
    totalApprovedBases: 43;
  }>;
  counts: Readonly<{
    campaignRuns: number;
    campaignProductionItems: number;
    diskMp4: number;
    completedRenderExportMatches: number;
    finalApprovedItems: number;
    finalApprovedCompletedRenderExportMatches: number;
    finalApprovedDecodeComplete: number;
    exactFinalArtifactHashes: number;
    finalApprovedExactFinalArtifactHashes: number;
    derivedFinalPasses: number;
    finalApprovedDerivedFinalPasses: number;
    layoutAwareSourceCrops: number;
    finalApprovedLayoutAwareSourceCrops: number;
    uniqueArtifacts: number;
    uniqueSourceHashes: number;
    uniqueEventGroups: number;
    decodeComplete: number;
    explicitApproved: number;
    eligibleApprovedUnique: number;
    approvedBaseDeficit: number;
  }>;
  assetSetSha256: string;
  artifacts: readonly VisionQaCorpusSourceArtifact[];
  outcome: "ready" | "blocked";
  blockers: readonly Readonly<{
    code:
      | "campaign_scope_mismatch"
      | "insufficient_explicit_approved_bases"
      | "decode_failure"
      | "database_provenance_gap"
      | "final_artifact_hash_mismatch"
      | "final_quality_binding_gap"
      | "layout_context_gap";
    expected: number | string;
    actual: number | string;
    deficit?: number;
  }>[];
  evidenceSha256: string;
}>;

export type VisionQaCorpusSourceAuditOptions = Readonly<{
  repoRoot: string;
  campaignManifest: VisionQaCorpusCampaignManifest;
  databasePath?: string;
  auditedAt?: string;
  concurrency?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  inspectArtifact?: (filePath: string) => Promise<VisionQaArtifactInspection>;
}>;

export const VISION_QA_LOCAL_INVENTORY_PREFLIGHT_VERSION =
  "project-kings-vision-qa-local-inventory-preflight-v1" as const;

export type VisionQaLocalInventoryPreflightEvidence = Readonly<{
  schemaVersion: typeof VISION_QA_LOCAL_INVENTORY_PREFLIGHT_VERSION;
  auditedAt: string;
  renderExportDirectory: string;
  databasePath: string;
  counts: Readonly<{
    rawMp4: number;
    uniqueMp4Hashes: number;
    decodeComplete: number;
    databaseRenderExports: number | null;
    campaignScopedEligibleBases: 0 | null;
  }>;
  requiredProductionTables: Readonly<Record<
    "production_runs" | "production_run_channels" | "production_profiles" | "production_items" |
    "channel_source_candidates" | "quality_verdicts" | "agent_attempts",
    boolean
  >>;
  qualificationAllowed: false;
  outcome: "blocked";
  blockers: readonly Readonly<{
    code: "campaign_manifest_required" | "production_schema_missing" | "raw_decode_failure";
    detail: string;
  }>[];
  assetSetSha256: string;
  evidenceSha256: string;
}>;

export type VisionQaLocalInventoryPreflightOptions = Readonly<{
  repoRoot: string;
  databasePath?: string;
  renderExportDirectory?: string;
  auditedAt?: string;
  concurrency?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  inspectArtifact?: (filePath: string) => Promise<VisionQaArtifactInspection>;
}>;

export class VisionQaCorpusBuildBlockedError extends Error {
  readonly evidence: VisionQaCorpusSourceAuditEvidence;

  constructor(evidence: VisionQaCorpusSourceAuditEvidence) {
    super(
      `Vision QA corpus build blocked: ${evidence.counts.eligibleApprovedUnique}/${VISION_QA_REQUIRED_APPROVED_BASES} exact Project Kings clean bases; deficit ${evidence.counts.approvedBaseDeficit}.`
    );
    this.name = "VisionQaCorpusBuildBlockedError";
    this.evidence = evidence;
  }
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function parseRecord(value: string | null): UnknownRecord | null {
  if (!value) return null;
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

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
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("end", () => resolve(digest.digest("hex")));
  });
}

function normalizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 1_000);
}

function manifestPayload(input: Omit<VisionQaCorpusCampaignManifest, "manifestSha256">): unknown {
  return {
    schemaVersion: input.schemaVersion,
    campaignId: input.campaignId,
    runs: [...input.runs]
      .map((run) => ({
        runId: run.runId,
        productionManifestSha256: run.productionManifestSha256
      }))
      .sort((left, right) => left.runId.localeCompare(right.runId))
  };
}

export function createVisionQaCorpusCampaignManifest(input: {
  campaignId: string;
  runs: readonly Readonly<{ runId: string; productionManifestSha256: string }>[];
}): VisionQaCorpusCampaignManifest {
  const campaignId = input.campaignId.trim();
  if (!campaignId || campaignId.length > 160) throw new Error("Vision QA campaignId is invalid.");
  if (input.runs.length < 1) throw new Error("Vision QA campaign must name at least one production run.");
  const seen = new Set<string>();
  const runs = input.runs.map((run) => {
    const runId = run.runId.trim();
    if (!runId || runId.length > 160 || seen.has(runId)) {
      throw new Error("Vision QA campaign run IDs must be unique, non-empty and bounded.");
    }
    if (!isSha256(run.productionManifestSha256)) {
      throw new Error(`Vision QA campaign production manifest hash is invalid for ${runId}.`);
    }
    seen.add(runId);
    return { runId, productionManifestSha256: run.productionManifestSha256 };
  }).sort((left, right) => left.runId.localeCompare(right.runId));
  const withoutHash = {
    schemaVersion: VISION_QA_CORPUS_CAMPAIGN_MANIFEST_VERSION,
    campaignId,
    runs
  } as const;
  return { ...withoutHash, manifestSha256: sha256(stableJson(manifestPayload(withoutHash))) };
}

export function verifyVisionQaCorpusCampaignManifest(
  manifest: VisionQaCorpusCampaignManifest
): void {
  if (manifest.schemaVersion !== VISION_QA_CORPUS_CAMPAIGN_MANIFEST_VERSION) {
    throw new Error("Vision QA campaign manifest version is unsupported.");
  }
  const normalized = createVisionQaCorpusCampaignManifest({
    campaignId: manifest.campaignId,
    runs: manifest.runs
  });
  if (stableJson(normalized) !== stableJson(manifest)) {
    throw new Error("Vision QA campaign manifest is not canonical or its hash does not match.");
  }
}

function normalizedNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedRect(value: unknown): { x: number; y: number; width: number; height: number } | null {
  const candidate = record(value);
  const x = normalizedNumber(candidate?.x);
  const y = normalizedNumber(candidate?.y);
  const width = normalizedNumber(candidate?.width);
  const height = normalizedNumber(candidate?.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
    return null;
  }
  return { x, y, width, height };
}

/**
 * A crop is not accepted in isolation. It must be a normalized source crop and
 * it must be bound to the exact template layout whose media viewport receives it.
 */
export function hasLayoutAwareVisionQaSourceCrop(snapshot: unknown): boolean {
  const value = record(snapshot);
  const renderPlan = record(value?.renderPlan);
  const sourceCrop = record(renderPlan?.sourceCrop);
  const managedTemplateState = record(value?.managedTemplateState);
  const templateConfig = record(managedTemplateState?.templateConfig);
  const frame = record(templateConfig?.frame);
  const card = record(templateConfig?.card);
  const templateId = typeof renderPlan?.templateId === "string" ? renderPlan.templateId.trim() : "";
  const managedId = typeof managedTemplateState?.managedId === "string"
    ? managedTemplateState.managedId.trim()
    : "";
  if (
    !templateId || !managedId || templateId !== managedId ||
    sourceCrop?.enabled !== true || !normalizedRect(sourceCrop) ||
    !frame || !card ||
    !Number.isFinite(Number(frame.width)) || Number(frame.width) <= 0 ||
    !Number.isFinite(Number(frame.height)) || Number(frame.height) <= 0 ||
    !Number.isFinite(Number(card.height)) || Number(card.height) <= 0
  ) return false;

  if (templateConfig?.layoutKind === "classic_top_bottom") {
    const slot = record(templateConfig.slot);
    const topHeight = normalizedNumber(slot?.topHeight);
    const bottomHeight = normalizedNumber(slot?.bottomHeight);
    return topHeight !== null && bottomHeight !== null && topHeight >= 0 && bottomHeight >= 0 &&
      Number(card.height) - topHeight - bottomHeight > 0;
  }
  if (templateConfig?.layoutKind === "channel_story") {
    const story = record(templateConfig.channelStory);
    if (!story) return false;
    const verticalParts = [
      "contentPaddingTop", "contentPaddingBottom", "headerHeight", "leadHeight", "bodyHeight",
      "headerToLeadGap", "leadToBodyGap", "bodyToMediaGap", "footerHeight"
    ].map((key) => normalizedNumber(story[key]));
    return verticalParts.every((part) => part !== null && part >= 0) &&
      Number(card.height) - verticalParts.reduce<number>((total, part) => total + Number(part), 0) > 0;
  }
  return false;
}

/** Compatibility helper for legacy callers. It is no longer sufficient for corpus eligibility. */
export function hasExplicitVisionQaSourceApproval(snapshot: unknown): boolean {
  const value = record(snapshot);
  const approval = record(value?.zoroKingApproval);
  return Boolean(
    hasLayoutAwareVisionQaSourceCrop(snapshot) &&
      approval?.status === "approved" &&
      approval.judgeVerdict === "approved" &&
      approval.innerVideoOnly === true &&
      approval.donorWrapperVisible === false &&
      Array.isArray(approval.previewFrames) &&
      approval.previewFrames.length > 0 &&
      approval.previewFrames.every((frame) => typeof frame === "string" && frame.length > 0)
  );
}

async function inspectMp4(input: {
  filePath: string;
  ffmpegPath: string;
  ffprobePath: string;
}): Promise<VisionQaArtifactInspection> {
  const stat = await fs.stat(input.filePath);
  const artifactSha256 = await sha256File(input.filePath);
  let durationMs: number | null = null;
  let videoCodec: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let audioCodec: string | null = null;
  let decodeComplete = false;
  let decodeError: string | null = null;
  try {
    const { stdout } = await execFileAsync(input.ffprobePath, [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
      "-of", "json",
      input.filePath
    ], { maxBuffer: 4 * 1024 * 1024 });
    const probe = record(JSON.parse(stdout));
    const streams = Array.isArray(probe?.streams) ? probe.streams.map(record).filter(Boolean) as UnknownRecord[] : [];
    const video = streams.find((stream) => stream.codec_type === "video") ?? null;
    const audio = streams.find((stream) => stream.codec_type === "audio") ?? null;
    const format = record(probe?.format);
    const duration = Number(format?.duration);
    durationMs = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1_000) : null;
    videoCodec = typeof video?.codec_name === "string" ? video.codec_name : null;
    width = Number.isInteger(video?.width) ? Number(video?.width) : null;
    height = Number.isInteger(video?.height) ? Number(video?.height) : null;
    audioCodec = typeof audio?.codec_name === "string" ? audio.codec_name : null;
    if (!video || !durationMs) throw new Error("ffprobe did not return a positive-duration video stream.");
    await execFileAsync(input.ffmpegPath, [
      "-nostdin", "-v", "error", "-xerror",
      "-i", input.filePath,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-f", "null", "-"
    ], { maxBuffer: 4 * 1024 * 1024 });
    decodeComplete = true;
  } catch (error) {
    decodeError = normalizeError(error);
  }
  return {
    sizeBytes: stat.size,
    sha256: artifactSha256,
    durationMs,
    videoCodec,
    width,
    height,
    audioCodec,
    decodeComplete,
    decodeError
  };
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const lanes = Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index]!, index);
    }
  });
  await Promise.all(lanes);
  return results;
}

function qualityBindingSha256(row: ProductionItemAuditRow, artifactSha256: string): string | null {
  if (!row.source_sha256 || !row.preview_sha256 || !row.template_sha256 || !row.settings_sha256) return null;
  return sha256(stableJson({
    gateType: "final",
    artifactSha256,
    sourceSha256: row.source_sha256,
    previewSha256: row.preview_sha256,
    templateSha256: row.template_sha256,
    settingsSha256: row.settings_sha256
  }));
}

function hasExactQualityBindings(
  verdict: QualityVerdictAuditRow,
  item: ProductionItemAuditRow,
  artifactSha256: string
): boolean {
  return verdict.run_id === item.run_id && verdict.production_item_id === item.production_item_id &&
    verdict.verdict === "pass" && verdict.artifact_sha256 === artifactSha256 &&
    verdict.source_sha256 === item.source_sha256 && verdict.preview_sha256 === item.preview_sha256 &&
    verdict.template_sha256 === item.template_sha256 && verdict.settings_sha256 === item.settings_sha256 &&
    isSha256(verdict.evidence_sha256) && Boolean(verdict.evidence_artifact_path) &&
    verdict.defects_json === "[]";
}

async function hasVerifiedEvidenceFile(verdict: QualityVerdictAuditRow): Promise<boolean> {
  if (!verdict.evidence_artifact_path || !path.isAbsolute(verdict.evidence_artifact_path) ||
      !verdict.evidence_sha256) return false;
  return (await sha256File(verdict.evidence_artifact_path).catch(() => null)) === verdict.evidence_sha256;
}

async function hasBoundFinalPass(input: {
  item: ProductionItemAuditRow;
  artifactSha256: string;
  verdicts: readonly QualityVerdictAuditRow[];
  judgeKind: "deterministic" | "vision";
}): Promise<boolean> {
  const expectedBinding = qualityBindingSha256(input.item, input.artifactSha256);
  if (!expectedBinding) return false;
  for (const verdict of input.verdicts) {
    if (verdict.judge_kind !== input.judgeKind || !hasExactQualityBindings(verdict, input.item, input.artifactSha256)) {
      continue;
    }
    if (!(await hasVerifiedEvidenceFile(verdict))) continue;
    if (input.judgeKind === "deterministic") {
      if (verdict.agent_attempt_id === null) return true;
      continue;
    }
    if (
      verdict.agent_attempt_id && verdict.attempt_role === "vision_qa" &&
      verdict.attempt_status === "passed" && isSha256(verdict.attempt_output_hash) &&
      verdict.attempt_quality_binding_sha256 === expectedBinding
    ) return true;
  }
  return false;
}

function finalizeEvidence(
  evidence: Omit<VisionQaCorpusSourceAuditEvidence, "evidenceSha256">
): VisionQaCorpusSourceAuditEvidence {
  return {
    ...evidence,
    evidenceSha256: sha256(stableJson(evidence))
  };
}

export function verifyVisionQaCorpusSourceAuditEvidence(
  evidence: VisionQaCorpusSourceAuditEvidence
): void {
  verifyVisionQaCorpusCampaignManifest(evidence.campaign);
  const { evidenceSha256, ...withoutHash } = evidence;
  if (sha256(stableJson(withoutHash)) !== evidenceSha256) {
    throw new Error("Vision QA source audit evidence hash does not match its payload.");
  }
  if (evidence.counts.approvedBaseDeficit !== Math.max(
    0,
    VISION_QA_REQUIRED_APPROVED_BASES - evidence.counts.eligibleApprovedUnique
  )) {
    throw new Error("Vision QA source audit deficit is inconsistent.");
  }
  if (new Set(evidence.artifacts.map((artifact) => artifact.productionItemId)).size !== evidence.artifacts.length) {
    throw new Error("Vision QA source audit contains duplicate production items.");
  }
  const hashes = evidence.artifacts.flatMap((artifact) => artifact.sha256 ? [artifact.sha256] : []);
  if (new Set(hashes).size !== evidence.counts.uniqueArtifacts) {
    throw new Error("Vision QA source audit unique artifact count is inconsistent.");
  }
  const manifestRuns = new Map(evidence.campaign.runs.map((run) => [run.runId, run.productionManifestSha256]));
  const campaignMismatch = evidence.artifacts.some(
    (artifact) => manifestRuns.get(artifact.runId) !== artifact.runManifestSha256
  );
  if (campaignMismatch && !(
    evidence.outcome === "blocked" &&
    evidence.blockers.some((blocker) => blocker.code === "campaign_scope_mismatch") &&
    evidence.counts.eligibleApprovedUnique === 0
  )) {
    throw new Error("Vision QA source audit did not fail closed on a campaign manifest mismatch.");
  }
  if (evidence.artifacts.some((artifact) => artifact.derivedFinalPass !==
    (artifact.deterministicFinalPassBound && artifact.visionFinalPassBound))) {
    throw new Error("Vision QA source audit contains a synthetic or inconsistent derived PASS.");
  }
}

function inClause(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export async function auditVisionQaCorpusSourceInventory(
  options: VisionQaCorpusSourceAuditOptions
): Promise<VisionQaCorpusSourceAuditEvidence> {
  verifyVisionQaCorpusCampaignManifest(options.campaignManifest);
  const repoRoot = path.resolve(options.repoRoot);
  const databasePath = path.resolve(options.databasePath ?? path.join(repoRoot, ".data/app.db"));
  const auditedAt = options.auditedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(auditedAt))) throw new Error("auditedAt must be an ISO timestamp.");
  const runIds = options.campaignManifest.runs.map((run) => run.runId);
  const expectedManifests = new Map(
    options.campaignManifest.runs.map((run) => [run.runId, run.productionManifestSha256])
  );

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA query_only = ON");
  let rows: ProductionItemAuditRow[];
  let qualityRows: QualityVerdictAuditRow[];
  let actualRuns: Array<{ id: string; manifest_hash: string }>;
  try {
    actualRuns = db.prepare(`SELECT id, manifest_hash FROM production_runs WHERE id IN (${inClause(runIds.length)})`)
      .all(...runIds) as unknown as Array<{ id: string; manifest_hash: string }>;
    rows = db.prepare(`SELECT
      pr.id AS run_id,
      pr.manifest_hash AS run_manifest_hash,
      pi.id AS production_item_id,
      pi.state AS production_item_state,
      pi.channel_id AS channel_id,
      c.event_fingerprint AS event_fingerprint,
      pi.source_sha256 AS source_sha256,
      pi.preview_sha256 AS preview_sha256,
      pi.template_sha256 AS template_sha256,
      pi.settings_sha256 AS settings_sha256,
      pi.final_artifact_sha256 AS final_artifact_sha256,
      pi.stage3_job_id AS stage3_job_id,
      r.id AS render_export_id,
      r.artifact_file_path AS artifact_file_path,
      r.artifact_file_name AS artifact_file_name,
      r.artifact_size_bytes AS artifact_size_bytes,
      r.artifact_mime_type AS artifact_mime_type,
      r.snapshot_json AS snapshot_json,
      j.status AS stage3_status,
      prc.profile_id AS profile_id,
      prc.profile_version AS profile_version,
      prc.profile_hash AS profile_hash,
      pp.config_json AS profile_config_json
      FROM production_items pi
      JOIN production_runs pr ON pr.id = pi.run_id
      JOIN production_run_channels prc ON prc.id = pi.run_channel_id
      JOIN production_profiles pp ON pp.id = prc.profile_id
      LEFT JOIN channel_source_candidates c ON c.id = pi.source_candidate_id
      LEFT JOIN render_exports r ON r.stage3_job_id = pi.stage3_job_id
      LEFT JOIN stage3_jobs j ON j.id = pi.stage3_job_id
      WHERE pi.run_id IN (${inClause(runIds.length)})
      ORDER BY pi.run_id, pi.channel_id, pi.item_slot, pi.generation`)
      .all(...runIds) as unknown as ProductionItemAuditRow[];
    qualityRows = db.prepare(`SELECT
      q.id, q.run_id, q.production_item_id, q.judge_kind, q.verdict,
      q.artifact_sha256, q.source_sha256, q.preview_sha256, q.template_sha256, q.settings_sha256,
      q.agent_attempt_id, q.evidence_sha256, q.evidence_artifact_path, q.defects_json,
      a.role AS attempt_role, a.status AS attempt_status, a.output_hash AS attempt_output_hash,
      a.quality_binding_sha256 AS attempt_quality_binding_sha256
      FROM quality_verdicts q
      LEFT JOIN agent_attempts a ON a.id = q.agent_attempt_id
      WHERE q.gate_type = 'final' AND q.run_id IN (${inClause(runIds.length)})`)
      .all(...runIds) as unknown as QualityVerdictAuditRow[];
  } finally {
    db.close();
  }

  const actualRunMap = new Map(actualRuns.map((run) => [run.id, run.manifest_hash]));
  const campaignScopeMatches = runIds.every((runId) => actualRunMap.get(runId) === expectedManifests.get(runId));
  const verdictsByItem = new Map<string, QualityVerdictAuditRow[]>();
  for (const verdict of qualityRows) {
    const values = verdictsByItem.get(verdict.production_item_id) ?? [];
    values.push(verdict);
    verdictsByItem.set(verdict.production_item_id, values);
  }

  const inspect = options.inspectArtifact ?? ((filePath: string) => inspectMp4({
    filePath,
    ffmpegPath: options.ffmpegPath ?? "ffmpeg",
    ffprobePath: options.ffprobePath ?? "ffprobe"
  }));
  const artifacts = await mapConcurrent(
    rows,
    Math.max(1, Math.min(16, options.concurrency ?? 8)),
    async (row): Promise<VisionQaCorpusSourceArtifact> => {
      let inspection: VisionQaArtifactInspection | null = null;
      if (row.artifact_file_path) {
        inspection = await inspect(row.artifact_file_path).catch((error): VisionQaArtifactInspection => ({
          sizeBytes: 0,
          sha256: "0".repeat(64),
          durationMs: null,
          videoCodec: null,
          width: null,
          height: null,
          audioCodec: null,
          decodeComplete: false,
          decodeError: normalizeError(error)
        }));
      }
      const artifactSha256 = inspection?.sha256 ?? null;
      const profileConfig = parseRecord(row.profile_config_json);
      const conceptContractSha256 = profileConfig?.concept
        ? sha256(stableJson(profileConfig.concept))
        : null;
      const itemVerdicts = verdictsByItem.get(row.production_item_id) ?? [];
      const deterministicFinalPassBound = artifactSha256
        ? await hasBoundFinalPass({ item: row, artifactSha256, verdicts: itemVerdicts, judgeKind: "deterministic" })
        : false;
      const visionFinalPassBound = artifactSha256
        ? await hasBoundFinalPass({ item: row, artifactSha256, verdicts: itemVerdicts, judgeKind: "vision" })
        : false;
      const layoutAwareSourceCropBound = hasLayoutAwareVisionQaSourceCrop(parseRecord(row.snapshot_json));
      const completedRenderExport = row.stage3_status === "completed" &&
        row.artifact_mime_type === "video/mp4" && Boolean(row.artifact_file_path && path.isAbsolute(row.artifact_file_path));
      const exactDatabaseSize = Boolean(inspection && row.artifact_size_bytes === inspection.sizeBytes);
      const exactFinalArtifactSha256 = Boolean(
        artifactSha256 && row.final_artifact_sha256 === artifactSha256
      );
      const derivedFinalPass = deterministicFinalPassBound && visionFinalPassBound;
      const explicitApprovalBound = row.production_item_state === "final_approved" &&
        exactFinalArtifactSha256 && derivedFinalPass && layoutAwareSourceCropBound;
      return {
        relativePath: row.artifact_file_path ? path.relative(repoRoot, row.artifact_file_path) : null,
        sha256: artifactSha256,
        sizeBytes: inspection?.sizeBytes ?? null,
        durationMs: inspection?.durationMs ?? null,
        videoCodec: inspection?.videoCodec ?? null,
        width: inspection?.width ?? null,
        height: inspection?.height ?? null,
        audioCodec: inspection?.audioCodec ?? null,
        decodeComplete: inspection?.decodeComplete ?? false,
        decodeError: inspection?.decodeError ?? "No exact render export is bound to the production item.",
        runId: row.run_id,
        runManifestSha256: row.run_manifest_hash,
        productionItemId: row.production_item_id,
        productionItemState: row.production_item_state,
        databaseMatchCount: row.render_export_id ? 1 : 0,
        renderExportId: row.render_export_id,
        stage3JobId: row.stage3_job_id,
        channelId: row.channel_id,
        profileId: row.profile_id,
        profileVersion: row.profile_version,
        profileHash: row.profile_hash,
        conceptContractSha256,
        sourceSha256: row.source_sha256,
        templateSha256: row.template_sha256,
        eventGroupId: row.event_fingerprint,
        completedRenderExport,
        exactDatabaseSize,
        exactFinalArtifactSha256,
        layoutAwareSourceCropBound,
        deterministicFinalPassBound,
        visionFinalPassBound,
        derivedFinalPass,
        explicitApprovalBound
      };
    }
  );

  const hashCounts = new Map<string, number>();
  const finalApprovedHashCounts = new Map<string, number>();
  for (const artifact of artifacts) {
    if (artifact.sha256) {
      hashCounts.set(artifact.sha256, (hashCounts.get(artifact.sha256) ?? 0) + 1);
      if (artifact.productionItemState === "final_approved") {
        finalApprovedHashCounts.set(
          artifact.sha256,
          (finalApprovedHashCounts.get(artifact.sha256) ?? 0) + 1
        );
      }
    }
  }
  const eligibleApprovedHashes = new Set(
    artifacts
      .filter((artifact) =>
        campaignScopeMatches &&
        expectedManifests.get(artifact.runId) === artifact.runManifestSha256 &&
        artifact.decodeComplete && artifact.databaseMatchCount === 1 &&
        artifact.completedRenderExport && artifact.exactDatabaseSize &&
        artifact.explicitApprovalBound && artifact.sha256 && finalApprovedHashCounts.get(artifact.sha256) === 1
      )
      .flatMap((artifact) => artifact.sha256 ? [artifact.sha256] : [])
  );
  const counts = {
    campaignRuns: actualRuns.length,
    campaignProductionItems: artifacts.length,
    diskMp4: artifacts.filter((artifact) => artifact.relativePath !== null).length,
    completedRenderExportMatches: artifacts.filter((artifact) =>
      artifact.databaseMatchCount === 1 && artifact.completedRenderExport && artifact.exactDatabaseSize
    ).length,
    finalApprovedItems: artifacts.filter((artifact) => artifact.productionItemState === "final_approved").length,
    finalApprovedCompletedRenderExportMatches: artifacts.filter((artifact) =>
      artifact.productionItemState === "final_approved" && artifact.databaseMatchCount === 1 &&
      artifact.completedRenderExport && artifact.exactDatabaseSize).length,
    finalApprovedDecodeComplete: artifacts.filter((artifact) =>
      artifact.productionItemState === "final_approved" && artifact.decodeComplete).length,
    exactFinalArtifactHashes: artifacts.filter((artifact) => artifact.exactFinalArtifactSha256).length,
    finalApprovedExactFinalArtifactHashes: artifacts.filter((artifact) =>
      artifact.productionItemState === "final_approved" && artifact.exactFinalArtifactSha256).length,
    derivedFinalPasses: artifacts.filter((artifact) => artifact.derivedFinalPass).length,
    finalApprovedDerivedFinalPasses: artifacts.filter((artifact) =>
      artifact.productionItemState === "final_approved" && artifact.derivedFinalPass).length,
    layoutAwareSourceCrops: artifacts.filter((artifact) => artifact.layoutAwareSourceCropBound).length,
    finalApprovedLayoutAwareSourceCrops: artifacts.filter((artifact) =>
      artifact.productionItemState === "final_approved" && artifact.layoutAwareSourceCropBound).length,
    uniqueArtifacts: hashCounts.size,
    uniqueSourceHashes: new Set(artifacts.flatMap((artifact) =>
      artifact.productionItemState === "final_approved" && artifact.sourceSha256
        ? [artifact.sourceSha256] : [])).size,
    uniqueEventGroups: new Set(artifacts.flatMap((artifact) =>
      artifact.productionItemState === "final_approved" && artifact.eventGroupId
        ? [artifact.eventGroupId] : [])).size,
    decodeComplete: artifacts.filter((artifact) => artifact.decodeComplete).length,
    explicitApproved: artifacts.filter((artifact) => artifact.explicitApprovalBound).length,
    eligibleApprovedUnique: eligibleApprovedHashes.size,
    approvedBaseDeficit: Math.max(0, VISION_QA_REQUIRED_APPROVED_BASES - eligibleApprovedHashes.size)
  } as const;
  const blockers: Array<VisionQaCorpusSourceAuditEvidence["blockers"][number]> = [];
  if (!campaignScopeMatches) {
    blockers.push({ code: "campaign_scope_mismatch", expected: runIds.length, actual: actualRuns.length });
  }
  if (counts.finalApprovedDecodeComplete !== counts.finalApprovedItems) {
    blockers.push({ code: "decode_failure", expected: counts.finalApprovedItems, actual: counts.finalApprovedDecodeComplete });
  }
  if (counts.finalApprovedCompletedRenderExportMatches !== counts.finalApprovedItems) {
    blockers.push({
      code: "database_provenance_gap",
      expected: counts.finalApprovedItems,
      actual: counts.finalApprovedCompletedRenderExportMatches
    });
  }
  if (counts.finalApprovedExactFinalArtifactHashes !== counts.finalApprovedItems) {
    blockers.push({
      code: "final_artifact_hash_mismatch",
      expected: counts.finalApprovedItems,
      actual: counts.finalApprovedExactFinalArtifactHashes
    });
  }
  if (counts.finalApprovedDerivedFinalPasses !== counts.finalApprovedItems) {
    blockers.push({
      code: "final_quality_binding_gap",
      expected: counts.finalApprovedItems,
      actual: counts.finalApprovedDerivedFinalPasses
    });
  }
  if (counts.finalApprovedLayoutAwareSourceCrops !== counts.finalApprovedItems) {
    blockers.push({
      code: "layout_context_gap",
      expected: counts.finalApprovedItems,
      actual: counts.finalApprovedLayoutAwareSourceCrops
    });
  }
  if (counts.eligibleApprovedUnique < VISION_QA_REQUIRED_APPROVED_BASES) {
    blockers.push({
      code: "insufficient_explicit_approved_bases",
      expected: VISION_QA_REQUIRED_APPROVED_BASES,
      actual: counts.eligibleApprovedUnique,
      deficit: counts.approvedBaseDeficit
    });
  }
  const evidence = finalizeEvidence({
    schemaVersion: VISION_QA_CORPUS_SOURCE_AUDIT_VERSION,
    auditedAt,
    campaign: options.campaignManifest,
    approvalPolicy: {
      policyId: "project-kings-final-approved-derived-pass-v1",
      completedRenderExportIsApproval: false,
      requires: [
        "campaign_run_manifest_binding",
        "production_item_final_approved",
        "exact_final_mp4_sha256",
        "layout_aware_source_crop",
        "deterministic_final_pass",
        "vision_final_pass",
        "exact_quality_bindings",
        "quality_evidence_provenance"
      ]
    },
    requirements: {
      selectionBases: VISION_QA_REQUIRED_SELECTION_BASES,
      holdoutCleanBases: VISION_QA_REQUIRED_HOLDOUT_CLEAN_BASES,
      totalApprovedBases: VISION_QA_REQUIRED_APPROVED_BASES
    },
    counts,
    assetSetSha256: sha256(stableJson([...finalApprovedHashCounts.keys()].sort())),
    artifacts,
    outcome: blockers.length === 0 ? "ready" : "blocked",
    blockers
  });
  verifyVisionQaCorpusSourceAuditEvidence(evidence);
  return evidence;
}

async function atomicWrite(filePath: string, content: string, mode?: number): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporary, content, { encoding: "utf8", mode });
  await fs.rename(temporary, filePath);
  if (mode !== undefined) await fs.chmod(filePath, mode);
}

export async function writeVisionQaCorpusSourceAudit(input: {
  outputDirectory: string;
  evidence: VisionQaCorpusSourceAuditEvidence;
}): Promise<{ evidencePath: string; blockerPath: string | null }> {
  verifyVisionQaCorpusSourceAuditEvidence(input.evidence);
  const outputDirectory = path.resolve(input.outputDirectory);
  await fs.mkdir(outputDirectory, { recursive: true });
  const evidencePath = path.join(outputDirectory, "source-audit.json");
  await atomicWrite(evidencePath, `${JSON.stringify(input.evidence, null, 2)}\n`);
  let blockerPath: string | null = null;
  if (input.evidence.outcome === "blocked") {
    blockerPath = path.join(outputDirectory, "BUILD_BLOCKED.md");
    await atomicWrite(
      blockerPath,
      [
        "# Vision QA corpus build blocked",
        "",
        `Exact Project Kings clean bases: ${input.evidence.counts.eligibleApprovedUnique}/${VISION_QA_REQUIRED_APPROVED_BASES}.`,
        `Deficit: ${input.evidence.counts.approvedBaseDeficit}.`,
        `Campaign manifest: ${input.evidence.campaign.manifestSha256}.`,
        "",
        "Completed or decodable render exports are not automatically clean or approved.",
        "A base must be a campaign-scoped final_approved production item with an exact final MP4 hash and exact deterministic + Vision PASS bindings.",
        "No holdout, mutations, blind packet, annotations, or ground-truth files were created.",
        "See `source-audit.json` for hash-bound inventory evidence.",
        ""
      ].join("\n")
    );
  } else {
    await fs.rm(path.join(outputDirectory, "BUILD_BLOCKED.md"), { force: true });
  }
  return { evidencePath, blockerPath };
}

export function assertVisionQaCorpusBuildReady(
  evidence: VisionQaCorpusSourceAuditEvidence
): void {
  verifyVisionQaCorpusSourceAuditEvidence(evidence);
  if (evidence.outcome !== "ready") throw new VisionQaCorpusBuildBlockedError(evidence);
}

async function listMp4Files(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp4")) result.push(filePath);
    }
  };
  await visit(root);
  return result.sort((left, right) => left.localeCompare(right));
}

export function verifyVisionQaLocalInventoryPreflightEvidence(
  evidence: VisionQaLocalInventoryPreflightEvidence
): void {
  if (evidence.schemaVersion !== VISION_QA_LOCAL_INVENTORY_PREFLIGHT_VERSION ||
      evidence.qualificationAllowed !== false || evidence.outcome !== "blocked") {
    throw new Error("Vision QA local inventory preflight may never qualify corpus bases.");
  }
  const { evidenceSha256, ...withoutHash } = evidence;
  if (sha256(stableJson(withoutHash)) !== evidenceSha256) {
    throw new Error("Vision QA local inventory preflight hash does not match its payload.");
  }
  if (evidence.counts.uniqueMp4Hashes > evidence.counts.rawMp4 ||
      evidence.counts.decodeComplete > evidence.counts.rawMp4) {
    throw new Error("Vision QA local inventory preflight counts are inconsistent.");
  }
  const productionSchemaReady = Object.values(evidence.requiredProductionTables).every(Boolean);
  if ((productionSchemaReady ? null : 0) !== evidence.counts.campaignScopedEligibleBases) {
    throw new Error("Vision QA local inventory preflight eligibility sentinel is inconsistent.");
  }
  if (!evidence.blockers.some((blocker) => blocker.code === "campaign_manifest_required")) {
    throw new Error("Unscoped Vision QA inventory must remain blocked on a campaign manifest.");
  }
}

export async function auditVisionQaLocalInventoryPreflight(
  options: VisionQaLocalInventoryPreflightOptions
): Promise<VisionQaLocalInventoryPreflightEvidence> {
  const repoRoot = path.resolve(options.repoRoot);
  const renderExportDirectory = path.resolve(
    options.renderExportDirectory ?? path.join(repoRoot, ".data/render-exports")
  );
  const databasePath = path.resolve(options.databasePath ?? path.join(repoRoot, ".data/app.db"));
  const auditedAt = options.auditedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(auditedAt))) throw new Error("auditedAt must be an ISO timestamp.");
  const files = await listMp4Files(renderExportDirectory);
  const inspect = options.inspectArtifact ?? ((filePath: string) => inspectMp4({
    filePath,
    ffmpegPath: options.ffmpegPath ?? "ffmpeg",
    ffprobePath: options.ffprobePath ?? "ffprobe"
  }));
  const inspections = await mapConcurrent(
    files,
    Math.max(1, Math.min(16, options.concurrency ?? 8)),
    async (filePath) => ({
      relativePath: path.relative(repoRoot, filePath),
      inspection: await inspect(filePath).catch((error): VisionQaArtifactInspection => ({
        sizeBytes: 0,
        sha256: "0".repeat(64),
        durationMs: null,
        videoCodec: null,
        width: null,
        height: null,
        audioCodec: null,
        decodeComplete: false,
        decodeError: normalizeError(error)
      }))
    })
  );
  const requiredTableNames = [
    "production_runs", "production_run_channels", "production_profiles", "production_items",
    "channel_source_candidates", "quality_verdicts", "agent_attempts"
  ] as const;
  const requiredProductionTables = Object.fromEntries(
    requiredTableNames.map((table) => [table, false])
  ) as Record<typeof requiredTableNames[number], boolean>;
  let databaseRenderExports: number | null = null;
  if (await fs.stat(databasePath).catch(() => null)) {
    const db = new DatabaseSync(databasePath);
    try {
      db.exec("PRAGMA query_only = ON");
      const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as Array<{ name: string }>;
      const names = new Set(tableRows.map((row) => row.name));
      for (const table of requiredTableNames) requiredProductionTables[table] = names.has(table);
      if (names.has("render_exports")) {
        const row = db.prepare("SELECT COUNT(*) AS count FROM render_exports").get() as unknown as { count: number };
        databaseRenderExports = Number(row.count);
      }
    } finally {
      db.close();
    }
  }
  const productionSchemaReady = Object.values(requiredProductionTables).every(Boolean);
  const decodeComplete = inspections.filter((entry) => entry.inspection.decodeComplete).length;
  const blockers: VisionQaLocalInventoryPreflightEvidence["blockers"][number][] = [{
    code: "campaign_manifest_required",
    detail: "Raw render exports are intentionally unqualified until a canonical run-scoped campaign manifest is supplied."
  }];
  if (!productionSchemaReady) blockers.push({
    code: "production_schema_missing",
    detail: `Missing required durable tables: ${requiredTableNames.filter((table) => !requiredProductionTables[table]).join(", ")}.`
  });
  if (decodeComplete !== files.length) blockers.push({
    code: "raw_decode_failure",
    detail: `${files.length - decodeComplete} raw MP4 file(s) failed the full decode probe.`
  });
  const withoutHash = {
    schemaVersion: VISION_QA_LOCAL_INVENTORY_PREFLIGHT_VERSION,
    auditedAt,
    renderExportDirectory,
    databasePath,
    counts: {
      rawMp4: files.length,
      uniqueMp4Hashes: new Set(inspections.map((entry) => entry.inspection.sha256)).size,
      decodeComplete,
      databaseRenderExports,
      campaignScopedEligibleBases: productionSchemaReady ? null : 0 as const
    },
    requiredProductionTables,
    qualificationAllowed: false as const,
    outcome: "blocked" as const,
    blockers,
    assetSetSha256: sha256(stableJson(inspections.map((entry) => ({
      relativePath: entry.relativePath,
      sha256: entry.inspection.sha256,
      sizeBytes: entry.inspection.sizeBytes,
      decodeComplete: entry.inspection.decodeComplete
    }))))
  };
  const evidence = { ...withoutHash, evidenceSha256: sha256(stableJson(withoutHash)) };
  verifyVisionQaLocalInventoryPreflightEvidence(evidence);
  return evidence;
}

export async function writeVisionQaLocalInventoryPreflight(input: {
  outputDirectory: string;
  evidence: VisionQaLocalInventoryPreflightEvidence;
}): Promise<string> {
  verifyVisionQaLocalInventoryPreflightEvidence(input.evidence);
  const outputDirectory = path.resolve(input.outputDirectory);
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, "inventory-preflight.json");
  await atomicWrite(outputPath, `${JSON.stringify(input.evidence, null, 2)}\n`);
  return outputPath;
}
