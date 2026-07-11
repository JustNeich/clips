import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { getDb, newId, nowIso, runInTransaction } from "./db/client";
import {
  parseProductionSemanticJobPayloadJson,
  parseProductionSemanticJobResultJson
} from "./project-kings/production-semantic-job-contract";
import { calculateProjectKingsCodexCreditMicros } from "./project-kings/codex-credit-cost";
import {
  classifyPortfolioDurableResourceLane,
  PORTFOLIO_DURABLE_LANE_EVENT_KINDS,
  PORTFOLIO_RESOURCE_LIMITS
} from "./portfolio-production-resource-policy";

export type ProductionProfileStatus = "draft" | "shadow" | "active" | "retired";
export type ProductionProfileApprovalScope = "shadow" | "live";
export type ProductionRunMode = "simulation" | "shadow" | "live";
export type ProductionRunStatus =
  | "created"
  | "preflight"
  | "ready"
  | "running"
  | "waiting_public"
  | "cancel_requested"
  | "completed"
  | "blocked"
  | "canceled"
  | "failed";
export type ProductionRunChannelStatus = ProductionRunStatus;
export type ProductionItemResumeState = "source_qualified" | "brief_ready" | "preview_ready";
export type ProductionItemState =
  | "reserved"
  | "source_ingested"
  | "source_qualified"
  | "brief_ready"
  | "preview_ready"
  | "preview_approved"
  | "final_rendered"
  | "final_approved"
  | "publication_scheduled"
  | "public_verified"
  | "rework"
  | "replaced"
  | "quarantined"
  | "policy_blocked"
  | "upload_outcome_unknown"
  | "cancel_requested"
  | "canceled"
  | "failed";
export type ChannelSourceCandidateStatus =
  | "available"
  | "reserved"
  | "consumed"
  | "quarantined"
  | "rejected";
export type ChannelSourceQualificationStatus =
  | "discovered"
  | "pending"
  | "qualified"
  | "rejected"
  | "quarantined";
export type ProductionOutboxStatus = "pending" | "processing" | "delivered" | "dead";
export type QualityGateType = "source" | "preview" | "final";
export type PersistedQualityJudgeKind = "deterministic" | "semantic" | "vision";
export type QualityJudgeKind = PersistedQualityJudgeKind | "combined";
export type QualityVerdictValue = "pass" | "fail";

export const PRODUCTION_ITEM_TRANSITIONS: Readonly<Record<ProductionItemState, readonly ProductionItemState[]>> = {
  reserved: ["source_ingested", "replaced", "quarantined", "policy_blocked", "cancel_requested", "failed"],
  source_ingested: ["source_qualified", "rework", "replaced", "quarantined", "policy_blocked", "cancel_requested", "failed"],
  source_qualified: ["brief_ready", "rework", "replaced", "quarantined", "policy_blocked", "cancel_requested", "failed"],
  brief_ready: ["preview_ready", "rework", "replaced", "quarantined", "policy_blocked", "cancel_requested", "failed"],
  preview_ready: ["preview_approved", "rework", "replaced", "quarantined", "policy_blocked", "cancel_requested", "failed"],
  preview_approved: ["final_rendered", "rework", "replaced", "quarantined", "policy_blocked", "cancel_requested", "failed"],
  final_rendered: ["final_approved", "rework", "replaced", "quarantined", "policy_blocked", "cancel_requested", "failed"],
  final_approved: ["publication_scheduled", "upload_outcome_unknown", "policy_blocked", "cancel_requested", "failed"],
  publication_scheduled: ["upload_outcome_unknown", "public_verified", "policy_blocked", "cancel_requested", "failed"],
  public_verified: [],
  rework: ["source_qualified", "brief_ready", "preview_ready", "replaced", "quarantined", "policy_blocked", "cancel_requested", "failed"],
  replaced: [],
  quarantined: [],
  policy_blocked: [],
  upload_outcome_unknown: ["publication_scheduled", "public_verified", "policy_blocked", "cancel_requested", "canceled", "failed"],
  cancel_requested: ["canceled", "upload_outcome_unknown", "public_verified", "failed"],
  canceled: [],
  failed: []
};

const PRODUCTION_RUN_TRANSITIONS: Readonly<Record<ProductionRunStatus, readonly ProductionRunStatus[]>> = {
  created: ["preflight", "cancel_requested", "canceled", "failed"],
  preflight: ["ready", "blocked", "cancel_requested", "canceled", "failed"],
  ready: ["running", "blocked", "cancel_requested", "canceled", "failed"],
  running: ["waiting_public", "blocked", "cancel_requested", "canceled", "failed"],
  waiting_public: ["completed", "blocked", "cancel_requested", "canceled", "failed"],
  cancel_requested: ["canceled", "blocked", "failed"],
  completed: [],
  blocked: [],
  canceled: [],
  failed: []
};

const ITEM_LEASE_TERMINAL_STATES = new Set<ProductionItemState>([
  "public_verified",
  "replaced",
  "quarantined",
  "policy_blocked",
  "canceled",
  "failed"
]);
const REPLACEABLE_ITEM_STATES = new Set<ProductionItemState>(["replaced", "quarantined", "failed"]);
const ITEM_COMPLETED_STATES = new Set<ProductionItemState>([
  "public_verified",
  "replaced",
  "quarantined",
  "policy_blocked",
  "canceled",
  "failed"
]);
const RUN_TERMINAL_STATES = new Set<ProductionRunStatus>(["completed", "blocked", "canceled", "failed"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const LOGICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const PRODUCTION_PUBLIC_VERIFICATION_WINDOW_MS = 24 * 60 * 60_000;
const PRODUCTION_PUBLIC_VERIFICATION_CONTINUATION_DELAY_MS = 5 * 60_000;
const PRODUCTION_PUBLIC_VERIFICATION_MAX_ATTEMPTS_PER_WINDOW = 12;

export type ProductionStoreErrorCode =
  | "invalid_input"
  | "not_found"
  | "stale_version"
  | "invalid_transition"
  | "lease_conflict"
  | "idempotency_conflict"
  | "uniqueness_conflict"
  | "quality_gate_missing"
  | "source_conflict"
  | "source_budget_exhausted"
  | "external_effect_conflict";

export class ProductionStoreError extends Error {
  readonly code: ProductionStoreErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ProductionStoreErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ProductionStoreError";
    this.code = code;
    this.details = details;
  }
}

export type ProductionProfileRecord = {
  id: string;
  workspaceId: string;
  channelId: string;
  version: number;
  status: ProductionProfileStatus;
  profileHash: string;
  expectedYoutubeChannelId: string;
  expectedDestinationTitle: string;
  templateId: string;
  templateSnapshotSha256: string;
  publishPolicyId: string;
  qualityPolicyId: string;
  modelRouteManifestId: string;
  modelRouteManifestSha256: string;
  targetPerLogicalDay: number;
  readyBufferMin: number;
  readyBufferCap: number;
  candidateAttemptBudget: number;
  config: Record<string, unknown>;
  createdAt: string;
  approvedAt: string | null;
  approvedByUserId: string | null;
  approvalScope: ProductionProfileApprovalScope | null;
  approvalBindingSha256: string | null;
};

export type ProductionRunRecord = {
  id: string;
  workspaceId: string;
  portfolioProfileHash: string;
  logicalDate: string;
  mode: ProductionRunMode;
  status: ProductionRunStatus;
  targetPerChannel: number;
  manifestHash: string;
  manifest: Record<string, unknown>;
  requestIdempotencyKey: string | null;
  version: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ProductionRunChannelRecord = {
  id: string;
  runId: string;
  workspaceId: string;
  channelId: string;
  profileId: string;
  profileVersion: number;
  profileHash: string;
  expectedYoutubeChannelId: string;
  status: ProductionRunChannelStatus;
  targetCount: number;
  publicVerifiedCount: number;
  nextSlotAt: string | null;
  blockerCode: string | null;
  blockerMessage: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ProductionItemRecord = {
  id: string;
  runId: string;
  runChannelId: string;
  workspaceId: string;
  channelId: string;
  itemSlot: number;
  generation: number;
  state: ProductionItemState;
  resumeState: ProductionItemResumeState | null;
  sourceCandidateId: string | null;
  sourceSha256: string | null;
  previewSha256: string | null;
  templateSha256: string | null;
  settingsSha256: string | null;
  finalArtifactSha256: string | null;
  chatId: string | null;
  stage2RunId: string | null;
  stage3JobId: string | null;
  publicationId: string | null;
  expectedYoutubeChannelId: string;
  youtubeVideoId: string | null;
  uploadSessionUrl: string | null;
  attempts: number;
  attemptBudget: number;
  version: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ChannelSourceCandidateRecord = {
  id: string;
  workspaceId: string;
  channelId: string;
  provider: string;
  sourceUrl: string;
  canonicalUrl: string;
  contentSha256: string | null;
  eventFingerprint: string | null;
  categoryKey: string;
  rightsStatus: string;
  status: ChannelSourceCandidateStatus;
  qualificationStatus: ChannelSourceQualificationStatus;
  qualificationEvidenceSha256: string | null;
  evidence: Record<string, unknown>;
  reservedItemId: string | null;
  reservedAt: string | null;
  consumedAt: string | null;
  quarantinedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductionEventRecord = {
  id: string;
  workspaceId: string;
  runId: string;
  channelId: string | null;
  productionItemId: string | null;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ProductionOutboxRecord = {
  id: string;
  workspaceId: string;
  runId: string;
  channelId: string;
  productionItemId: string;
  eventKind: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  status: ProductionOutboxStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  deadLetterCode: string | null;
  projectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
};

export type AgentAttemptRecord = {
  id: string;
  workspaceId: string;
  runId: string;
  productionItemId: string;
  stage3JobId: string | null;
  role: string;
  attemptNo: number;
  model: string;
  reasoningLevel: string;
  promptHash: string;
  qualityBindingSha256: string | null;
  outputHash: string | null;
  artifactIds: string[];
  status: "running" | "passed" | "failed" | "timed_out";
  outcome: string | null;
  verdict: string | null;
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningOutputTokens: number | null;
  costMicros: number | null;
  costUnit: "usd" | "codex_credits" | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
};

export type QualityVerdictRecord = {
  id: string;
  workspaceId: string;
  runId: string;
  productionItemId: string;
  gateType: QualityGateType;
  judgeKind: QualityJudgeKind;
  verdict: QualityVerdictValue;
  attemptNo: number;
  artifactSha256: string;
  sourceSha256: string | null;
  previewSha256: string | null;
  templateSha256: string | null;
  settingsSha256: string | null;
  agentAttemptId: string | null;
  evidenceSha256: string | null;
  evidenceArtifactPath: string | null;
  defects: Array<Record<string, unknown>>;
  persisted: boolean;
  derivedFromVerdictIds: string[];
  createdAt: string;
};

export type PublicVerificationRecord = {
  id: string;
  workspaceId: string;
  runId: string;
  productionItemId: string;
  publicationId: string;
  expectedYoutubeChannelId: string;
  youtubeVideoId: string;
  attemptNo: number;
  clipsStatus: string;
  clipsMatches: boolean;
  rssSeen: boolean;
  shortsHttpStatus: number | null;
  pagePlayable: boolean;
  pageCanonicalVideoId: string | null;
  pageChannelId: string | null;
  verified: boolean;
  failureCode: string | null;
  evidence: Record<string, unknown>;
  checkedAt: string;
};

type Row = Record<string, unknown>;

function fail(code: ProductionStoreErrorCode, message: string, details: Record<string, unknown> = {}): never {
  throw new ProductionStoreError(code, message, details);
}

function requiredText(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== "string" || !value.trim()) {
    fail("invalid_input", `${field} is required.`, { field });
  }
  return value.trim().slice(0, maxLength);
}

function optionalText(value: unknown, maxLength = 2048): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim().slice(0, maxLength);
}

function positiveInteger(value: unknown, field: string, minimum = 1): number {
  if (!Number.isInteger(value) || Number(value) < minimum) {
    fail("invalid_input", `${field} must be an integer >= ${minimum}.`, { field, value });
  }
  return Number(value);
}

function sha256(value: unknown, field: string, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === "")) {
    return null;
  }
  const normalized = requiredText(value, field, 64).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    fail("invalid_input", `${field} must be a 64-character SHA-256 hex digest.`, { field });
  }
  return normalized;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    return jsonObject(JSON.parse(String(value ?? "{}")));
  } catch {
    return {};
  }
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseDefects(value: unknown): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.map(jsonObject) : [];
  } catch {
    return [];
  }
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function productionProfileApprovalBinding(input: {
  profileId: string;
  workspaceId: string;
  channelId: string;
  version: number;
  profileHash: string;
  status: ProductionProfileStatus;
  approvalScope: ProductionProfileApprovalScope;
  approvedAt: string;
  approvedByUserId: string;
}): string {
  return createHash("sha256").update(canonicalJson({
    schemaVersion: 1,
    profileId: input.profileId,
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    version: input.version,
    profileHash: input.profileHash,
    status: input.status,
    approvalScope: input.approvalScope,
    approvedAt: input.approvedAt,
    approvedByUserId: input.approvedByUserId
  })).digest("hex");
}

export function calculateProductionProfileApprovalBinding(
  profile: Pick<
    ProductionProfileRecord,
    | "id"
    | "workspaceId"
    | "channelId"
    | "version"
    | "profileHash"
    | "status"
    | "approvalScope"
    | "approvedAt"
    | "approvedByUserId"
  >
): string | null {
  if (!profile.approvalScope || !profile.approvedAt || !profile.approvedByUserId) return null;
  return productionProfileApprovalBinding({
    profileId: profile.id,
    workspaceId: profile.workspaceId,
    channelId: profile.channelId,
    version: profile.version,
    profileHash: profile.profileHash,
    status: profile.status,
    approvalScope: profile.approvalScope,
    approvedAt: profile.approvedAt,
    approvedByUserId: profile.approvedByUserId
  });
}

export function isProductionProfileExplicitlyApproved(
  profile: ProductionProfileRecord,
  requiredScope: ProductionProfileApprovalScope
): boolean {
  const statusAndScopeMatch = requiredScope === "live"
    ? profile.status === "active" && profile.approvalScope === "live"
    : (profile.status === "shadow" && profile.approvalScope === "shadow") ||
      (profile.status === "active" && profile.approvalScope === "live");
  if (!statusAndScopeMatch || !profile.approvalBindingSha256) return false;
  return calculateProductionProfileApprovalBinding(profile) === profile.approvalBindingSha256;
}

export function buildProductionOutboxDedupeKey(
  eventKind: string,
  immutableBinding: Record<string, unknown>
): string {
  const normalizedEventKind = requiredText(eventKind, "eventKind", 160);
  const bindingSha256 = createHash("sha256").update(canonicalJson(immutableBinding)).digest("hex");
  return `${normalizedEventKind}:${bindingSha256}`;
}

export function calculateChannelSourceQualificationEvidenceSha256(
  evidence: Record<string, unknown>
): string {
  return createHash("sha256").update(stringify(evidence)).digest("hex");
}

function leaseExpiry(stamp: string, leaseMs: number): string {
  const duration = positiveInteger(leaseMs, "leaseMs");
  if (duration > 3_600_000) {
    fail("invalid_input", "leaseMs cannot exceed one hour.", { leaseMs });
  }
  return new Date(new Date(stamp).getTime() + duration).toISOString();
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint|unique/i.test(error.message);
}

function mapProfile(row: Row): ProductionProfileRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), channelId: String(row.channel_id),
    version: Number(row.version), status: String(row.status) as ProductionProfileStatus,
    profileHash: String(row.profile_hash), expectedYoutubeChannelId: String(row.expected_youtube_channel_id),
    expectedDestinationTitle: String(row.expected_destination_title), templateId: String(row.template_id),
    templateSnapshotSha256: String(row.template_snapshot_sha256), publishPolicyId: String(row.publish_policy_id),
    qualityPolicyId: String(row.quality_policy_id), modelRouteManifestId: String(row.model_route_manifest_id),
    modelRouteManifestSha256: String(row.model_route_manifest_sha256),
    targetPerLogicalDay: Number(row.target_per_logical_day), readyBufferMin: Number(row.ready_buffer_min),
    readyBufferCap: Number(row.ready_buffer_cap), candidateAttemptBudget: Number(row.candidate_attempt_budget),
    config: parseObject(row.config_json), createdAt: String(row.created_at),
    approvedAt: optionalText(row.approved_at), approvedByUserId: optionalText(row.approved_by_user_id),
    approvalScope: optionalText(row.approval_scope) as ProductionProfileApprovalScope | null,
    approvalBindingSha256: optionalText(row.approval_binding_sha256)
  };
}

function mapRun(row: Row): ProductionRunRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), portfolioProfileHash: String(row.portfolio_profile_hash),
    logicalDate: String(row.logical_date), mode: String(row.mode) as ProductionRunMode,
    status: String(row.status) as ProductionRunStatus, targetPerChannel: Number(row.target_per_channel),
    manifestHash: String(row.manifest_hash), manifest: parseObject(row.manifest_json),
    requestIdempotencyKey: optionalText(row.request_idempotency_key), version: Number(row.version),
    leaseOwner: optionalText(row.lease_owner), leaseExpiresAt: optionalText(row.lease_expires_at),
    lastError: optionalText(row.last_error), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    completedAt: optionalText(row.completed_at)
  };
}

function mapRunChannel(row: Row): ProductionRunChannelRecord {
  return {
    id: String(row.id), runId: String(row.run_id), workspaceId: String(row.workspace_id),
    channelId: String(row.channel_id), profileId: String(row.profile_id), profileVersion: Number(row.profile_version),
    profileHash: String(row.profile_hash), expectedYoutubeChannelId: String(row.expected_youtube_channel_id),
    status: String(row.status) as ProductionRunChannelStatus, targetCount: Number(row.target_count),
    publicVerifiedCount: Number(row.public_verified_count), nextSlotAt: optionalText(row.next_slot_at),
    blockerCode: optionalText(row.blocker_code), blockerMessage: optionalText(row.blocker_message),
    version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    completedAt: optionalText(row.completed_at)
  };
}

function mapItem(row: Row): ProductionItemRecord {
  return {
    id: String(row.id), runId: String(row.run_id), runChannelId: String(row.run_channel_id),
    workspaceId: String(row.workspace_id), channelId: String(row.channel_id), itemSlot: Number(row.item_slot),
    generation: Number(row.generation), state: String(row.state) as ProductionItemState,
    resumeState: optionalText(row.resume_state) as ProductionItemResumeState | null,
    sourceCandidateId: optionalText(row.source_candidate_id), sourceSha256: optionalText(row.source_sha256),
    previewSha256: optionalText(row.preview_sha256), templateSha256: optionalText(row.template_sha256),
    settingsSha256: optionalText(row.settings_sha256), finalArtifactSha256: optionalText(row.final_artifact_sha256),
    chatId: optionalText(row.chat_id), stage2RunId: optionalText(row.stage2_run_id), stage3JobId: optionalText(row.stage3_job_id),
    publicationId: optionalText(row.publication_id), expectedYoutubeChannelId: String(row.expected_youtube_channel_id),
    youtubeVideoId: optionalText(row.youtube_video_id), uploadSessionUrl: optionalText(row.upload_session_url),
    attempts: Number(row.attempts), attemptBudget: Number(row.attempt_budget), version: Number(row.version),
    leaseOwner: optionalText(row.lease_owner), leaseExpiresAt: optionalText(row.lease_expires_at),
    lastError: optionalText(row.last_error), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    completedAt: optionalText(row.completed_at)
  };
}

function mapCandidate(row: Row): ChannelSourceCandidateRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), channelId: String(row.channel_id),
    provider: String(row.provider), sourceUrl: String(row.source_url), canonicalUrl: String(row.canonical_url),
    contentSha256: optionalText(row.content_sha256), eventFingerprint: optionalText(row.event_fingerprint),
    categoryKey: String(row.category_key), rightsStatus: String(row.rights_status),
    status: String(row.status) as ChannelSourceCandidateStatus,
    qualificationStatus: String(row.qualification_status) as ChannelSourceQualificationStatus,
    qualificationEvidenceSha256: optionalText(row.qualification_evidence_sha256),
    evidence: parseObject(row.evidence_json),
    reservedItemId: optionalText(row.reserved_item_id), reservedAt: optionalText(row.reserved_at),
    consumedAt: optionalText(row.consumed_at), quarantinedAt: optionalText(row.quarantined_at),
    lastError: optionalText(row.last_error), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function mapEvent(row: Row): ProductionEventRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), runId: String(row.run_id),
    channelId: optionalText(row.channel_id), productionItemId: optionalText(row.production_item_id),
    eventType: String(row.event_type), fromState: optionalText(row.from_state), toState: optionalText(row.to_state),
    payload: parseObject(row.payload_json), createdAt: String(row.created_at)
  };
}

function mapOutbox(row: Row): ProductionOutboxRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), runId: String(row.run_id),
    channelId: String(row.channel_id), productionItemId: String(row.production_item_id), eventKind: String(row.event_kind),
    dedupeKey: String(row.dedupe_key),
    payload: parseObject(row.payload_json), status: String(row.status) as ProductionOutboxStatus,
    attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts), availableAt: String(row.available_at),
    leaseOwner: optionalText(row.lease_owner), leaseToken: optionalText(row.lease_token), leaseExpiresAt: optionalText(row.lease_expires_at),
    lastError: optionalText(row.last_error), deadLetterCode: optionalText(row.dead_letter_code),
    projectedAt: optionalText(row.projected_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    deliveredAt: optionalText(row.delivered_at)
  };
}

function mapAgentAttempt(row: Row): AgentAttemptRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), runId: String(row.run_id),
    productionItemId: String(row.production_item_id), stage3JobId: optionalText(row.stage3_job_id),
    role: String(row.role), attemptNo: Number(row.attempt_no),
    model: String(row.model), reasoningLevel: String(row.reasoning_level), promptHash: String(row.prompt_hash),
    qualityBindingSha256: optionalText(row.quality_binding_sha256),
    outputHash: optionalText(row.output_hash), artifactIds: parseStringArray(row.artifact_ids_json),
    status: String(row.status) as AgentAttemptRecord["status"], outcome: optionalText(row.outcome), verdict: optionalText(row.verdict),
    errorCode: optionalText(row.error_code), inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
    cachedInputTokens: row.cached_input_tokens === null ? null : Number(row.cached_input_tokens),
    reasoningOutputTokens: row.reasoning_output_tokens === null ? null : Number(row.reasoning_output_tokens),
    costMicros: row.cost_micros === null ? null : Number(row.cost_micros),
    costUnit:
      row.cost_unit === "usd" || row.cost_unit === "codex_credits"
        ? row.cost_unit
        : null,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms), startedAt: String(row.started_at),
    finishedAt: optionalText(row.finished_at), createdAt: String(row.created_at)
  };
}

function mapVerdict(row: Row): QualityVerdictRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), runId: String(row.run_id),
    productionItemId: String(row.production_item_id), gateType: String(row.gate_type) as QualityGateType,
    judgeKind: String(row.judge_kind) as QualityJudgeKind, verdict: String(row.verdict) as QualityVerdictValue,
    attemptNo: Number(row.attempt_no), artifactSha256: String(row.artifact_sha256), sourceSha256: optionalText(row.source_sha256),
    previewSha256: optionalText(row.preview_sha256), templateSha256: optionalText(row.template_sha256),
    settingsSha256: optionalText(row.settings_sha256), agentAttemptId: optionalText(row.agent_attempt_id),
    evidenceSha256: optionalText(row.evidence_sha256), evidenceArtifactPath: optionalText(row.evidence_artifact_path, 4096),
    defects: parseDefects(row.defects_json), persisted: true, derivedFromVerdictIds: [],
    createdAt: String(row.created_at)
  };
}

function mapVerification(row: Row): PublicVerificationRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), runId: String(row.run_id),
    productionItemId: String(row.production_item_id), publicationId: String(row.publication_id),
    expectedYoutubeChannelId: String(row.expected_youtube_channel_id), youtubeVideoId: String(row.youtube_video_id),
    attemptNo: Number(row.attempt_no), clipsStatus: String(row.clips_status), clipsMatches: Number(row.clips_matches) === 1,
    rssSeen: Number(row.rss_seen) === 1, shortsHttpStatus: row.shorts_http_status === null ? null : Number(row.shorts_http_status),
    pagePlayable: Number(row.page_playable) === 1, pageCanonicalVideoId: optionalText(row.page_canonical_video_id),
    pageChannelId: optionalText(row.page_channel_id), verified: Number(row.verified) === 1,
    failureCode: optionalText(row.failure_code), evidence: parseObject(row.evidence_json), checkedAt: String(row.checked_at)
  };
}

function readRow(db: DatabaseSync, table: string, id: string): Row | null {
  const allowed = new Set([
    "production_profiles", "production_runs", "production_run_channels", "production_items",
    "channel_source_candidates", "production_outbox", "agent_attempts", "quality_verdicts", "public_verifications"
  ]);
  if (!allowed.has(table)) {
    fail("invalid_input", "Unsupported production table lookup.", { table });
  }
  return (db.prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`).get(id) as Row | undefined) ?? null;
}

function requireRun(db: DatabaseSync, runId: string): ProductionRunRecord {
  const row = readRow(db, "production_runs", runId);
  if (!row) fail("not_found", "Production run not found.", { runId });
  return mapRun(row);
}

function requireRunChannel(db: DatabaseSync, runChannelId: string): ProductionRunChannelRecord {
  const row = readRow(db, "production_run_channels", runChannelId);
  if (!row) fail("not_found", "Production run channel not found.", { runChannelId });
  return mapRunChannel(row);
}

function requireItem(db: DatabaseSync, itemId: string): ProductionItemRecord {
  const row = readRow(db, "production_items", itemId);
  if (!row) fail("not_found", "Production item not found.", { itemId });
  return mapItem(row);
}

function appendEventTx(db: DatabaseSync, input: {
  workspaceId: string; runId: string; channelId?: string | null; productionItemId?: string | null;
  eventType: string; fromState?: string | null; toState?: string | null; payload?: Record<string, unknown>; createdAt: string;
}): ProductionEventRecord {
  const id = newId();
  db.prepare(`INSERT INTO production_events
    (id, workspace_id, run_id, channel_id, production_item_id, event_type, from_state, to_state, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.workspaceId, input.runId, input.channelId ?? null, input.productionItemId ?? null,
      requiredText(input.eventType, "eventType", 160), input.fromState ?? null, input.toState ?? null,
      stringify(input.payload), input.createdAt);
  return mapEvent(db.prepare("SELECT * FROM production_events WHERE id = ?").get(id) as Row);
}

export type AppendProductionOutboxInput = {
  workspaceId: string;
  runId: string;
  channelId: string;
  productionItemId: string;
  eventKind: string;
  dedupeKey?: string | null;
  payload: Record<string, unknown>;
  availableAt?: string | null;
  maxAttempts?: number | null;
};

export function buildProductionPublicVerificationOutboxIntent(input: {
  publicationId: string;
  youtubeVideoId: string;
  scheduledAt: string;
}): Pick<AppendProductionOutboxInput, "eventKind" | "payload" | "availableAt" | "maxAttempts"> {
  const publicationId = requiredText(input.publicationId, "publicationId", 64);
  const youtubeVideoId = requiredText(input.youtubeVideoId, "youtubeVideoId", 128);
  const scheduledAtMs = Date.parse(requiredText(input.scheduledAt, "scheduledAt", 80));
  if (!Number.isFinite(scheduledAtMs)) {
    fail("invalid_input", "scheduledAt must be a valid timestamp.", { scheduledAt: input.scheduledAt });
  }
  const scheduledAt = new Date(scheduledAtMs).toISOString();
  const publicVerificationDeadlineAt = new Date(
    scheduledAtMs + PRODUCTION_PUBLIC_VERIFICATION_WINDOW_MS
  ).toISOString();
  return {
    eventKind: "public_verify.requested",
    payload: {
      publicationId,
      youtubeVideoId,
      publicVerificationStartedAt: scheduledAt,
      publicVerificationDeadlineAt
    },
    availableAt: scheduledAt,
    maxAttempts: PRODUCTION_PUBLIC_VERIFICATION_MAX_ATTEMPTS_PER_WINDOW
  };
}

export function resolveProductionPublicVerificationDeadlineAt(
  outbox: Pick<ProductionOutboxRecord, "eventKind" | "payload">
): string | null {
  if (outbox.eventKind !== "public_verify.requested") return null;
  const rawStartedAt = outbox.payload.publicVerificationStartedAt;
  const raw = outbox.payload.publicVerificationDeadlineAt;
  if (
    typeof rawStartedAt !== "string" ||
    !rawStartedAt.trim() ||
    typeof raw !== "string" ||
    !raw.trim()
  ) return null;
  const startedAtMs = Date.parse(rawStartedAt);
  const deadlineMs = Date.parse(raw);
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(deadlineMs) ||
    deadlineMs !== startedAtMs + PRODUCTION_PUBLIC_VERIFICATION_WINDOW_MS
  ) return null;
  return new Date(deadlineMs).toISOString();
}

function productionPublicVerificationDeadlineReached(
  outbox: Pick<ProductionOutboxRecord, "eventKind" | "payload">,
  stamp: string
): boolean {
  const deadlineAt = resolveProductionPublicVerificationDeadlineAt(outbox);
  if (!deadlineAt) return false;
  const stampMs = Date.parse(stamp);
  return Number.isFinite(stampMs) && stampMs >= Date.parse(deadlineAt);
}

function appendOutboxTx(db: DatabaseSync, input: AppendProductionOutboxInput, stamp: string): ProductionOutboxRecord {
  const item = requireItem(db, requiredText(input.productionItemId, "productionItemId", 64));
  if (item.workspaceId !== input.workspaceId || item.runId !== input.runId || item.channelId !== input.channelId) {
    fail("invalid_input", "Outbox scope must match its production item.", { productionItemId: item.id });
  }
  const eventKind = requiredText(input.eventKind, "eventKind", 160);
  const payload = jsonObject(input.payload);
  const payloadJson = stringify(payload);
  const maxAttempts = positiveInteger(input.maxAttempts ?? 3, "maxAttempts");
  const availableAt = input.availableAt ?? stamp;
  const dedupeKey = requiredText(
    input.dedupeKey ?? buildProductionOutboxDedupeKey(eventKind, payload),
    "dedupeKey",
    512
  );
  const existing = db.prepare(`SELECT * FROM production_outbox
    WHERE production_item_id = ? AND dedupe_key = ? LIMIT 1`)
    .get(input.productionItemId, dedupeKey) as Row | undefined;
  if (existing) {
    const existingRecord = mapOutbox(existing);
    const sameIntent = existingRecord.eventKind === eventKind &&
      isDeepStrictEqual(existingRecord.payload, payload) &&
      existingRecord.maxAttempts === maxAttempts &&
      (input.availableAt === undefined || input.availableAt === null || existingRecord.availableAt === availableAt);
    if (sameIntent) return existingRecord;
    fail("idempotency_conflict", "Outbox dedupe key is already bound to a different immutable intent.", {
      productionItemId: input.productionItemId,
      dedupeKey,
      existingEventKind: existingRecord.eventKind,
      requestedEventKind: eventKind
    });
  }
  const id = newId();
  try {
    db.prepare(`INSERT INTO production_outbox
      (id, workspace_id, run_id, channel_id, production_item_id, event_kind, dedupe_key, payload_json, status, attempts,
       max_attempts, available_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`) 
      .run(id, input.workspaceId, input.runId, input.channelId, input.productionItemId,
        eventKind, dedupeKey, payloadJson, maxAttempts, availableAt, stamp, stamp);
  } catch (error) {
    if (isConstraintError(error)) {
      fail("idempotency_conflict", "Outbox dedupe key was claimed by a different immutable intent.", {
        productionItemId: input.productionItemId, eventKind, dedupeKey
      });
    }
    throw error;
  }
  return mapOutbox(readRow(db, "production_outbox", id)!);
}

export function isAllowedProductionItemTransition(from: ProductionItemState, to: ProductionItemState): boolean {
  return PRODUCTION_ITEM_TRANSITIONS[from]?.includes(to) ?? false;
}

export type CreateProductionProfileInput = {
  workspaceId: string;
  channelId: string;
  version: number;
  status: ProductionProfileStatus;
  profileHash: string;
  expectedYoutubeChannelId: string;
  expectedDestinationTitle?: string | null;
  templateId: string;
  templateSnapshotSha256: string;
  publishPolicyId: string;
  qualityPolicyId: string;
  modelRouteManifestId: string;
  modelRouteManifestSha256: string;
  targetPerLogicalDay: number;
  readyBufferMin: number;
  readyBufferCap: number;
  candidateAttemptBudget: number;
  config: Record<string, unknown>;
  approvedAt?: string | null;
  approvedByUserId?: string | null;
};

export function createProductionProfile(input: CreateProductionProfileInput): ProductionProfileRecord {
  const workspaceId = requiredText(input.workspaceId, "workspaceId", 64);
  const channelId = requiredText(input.channelId, "channelId", 64);
  const version = positiveInteger(input.version, "version");
  const target = positiveInteger(input.targetPerLogicalDay, "targetPerLogicalDay");
  const readyMin = positiveInteger(input.readyBufferMin, "readyBufferMin", 0);
  const readyCap = positiveInteger(input.readyBufferCap, "readyBufferCap");
  if (readyMin > readyCap) {
    fail("invalid_input", "readyBufferMin cannot exceed readyBufferCap.", { readyMin, readyCap });
  }
  const stamp = nowIso();
  const id = newId();
  try {
    getDb().prepare(`INSERT INTO production_profiles
      (id, workspace_id, channel_id, version, status, profile_hash, expected_youtube_channel_id,
       expected_destination_title, template_id, template_snapshot_sha256, publish_policy_id,
       quality_policy_id, model_route_manifest_id, model_route_manifest_sha256, target_per_logical_day, ready_buffer_min,
       ready_buffer_cap, candidate_attempt_budget, config_json, created_at, approved_at, approved_by_user_id,
       approval_scope, approval_binding_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
      .run(id, workspaceId, channelId, version, input.status, sha256(input.profileHash, "profileHash"),
        requiredText(input.expectedYoutubeChannelId, "expectedYoutubeChannelId", 128),
        optionalText(input.expectedDestinationTitle, 256) ?? "", requiredText(input.templateId, "templateId", 160),
        sha256(input.templateSnapshotSha256, "templateSnapshotSha256"),
        requiredText(input.publishPolicyId, "publishPolicyId", 160), requiredText(input.qualityPolicyId, "qualityPolicyId", 160),
        requiredText(input.modelRouteManifestId, "modelRouteManifestId", 160),
        sha256(input.modelRouteManifestSha256, "modelRouteManifestSha256"), target, readyMin, readyCap,
        positiveInteger(input.candidateAttemptBudget, "candidateAttemptBudget"), stringify(input.config), stamp,
        input.approvedAt ?? null, input.approvedByUserId ?? null);
  } catch (error) {
    if (isConstraintError(error)) {
      fail("uniqueness_conflict", "Production profile version or hash already exists.", { channelId, version });
    }
    throw error;
  }
  return mapProfile(readRow(getDb(), "production_profiles", id)!);
}

export function getProductionProfile(profileId: string): ProductionProfileRecord | null {
  const row = readRow(getDb(), "production_profiles", requiredText(profileId, "profileId", 64));
  return row ? mapProfile(row) : null;
}

export function listProductionProfiles(input: {
  workspaceId: string;
  channelId?: string | null;
  status?: ProductionProfileStatus | null;
}): ProductionProfileRecord[] {
  const clauses = ["workspace_id = ?"];
  const params: Array<string> = [requiredText(input.workspaceId, "workspaceId", 64)];
  if (input.channelId) {
    clauses.push("channel_id = ?");
    params.push(requiredText(input.channelId, "channelId", 64));
  }
  if (input.status) {
    clauses.push("status = ?");
    params.push(input.status);
  }
  return (getDb().prepare(`SELECT * FROM production_profiles WHERE ${clauses.join(" AND ")} ORDER BY channel_id, version DESC`)
    .all(...params) as Row[]).map(mapProfile);
}

export type ApproveProductionProfileInput = {
  workspaceId: string;
  profileId: string;
  expectedVersion: number;
  expectedProfileHash: string;
  targetStatus: Extract<ProductionProfileStatus, "shadow" | "active">;
  approvedByUserId: string;
  approvedAt?: string;
};

/**
 * Records a deliberate owner approval for one exact immutable profile
 * version/hash. Merely populating the legacy approved_at columns is not enough:
 * execution checks the cryptographic approval binding written here.
 */
export function approveProductionProfile(input: ApproveProductionProfileInput): ProductionProfileRecord {
  const workspaceId = requiredText(input.workspaceId, "workspaceId", 64);
  const profileId = requiredText(input.profileId, "profileId", 64);
  const expectedVersion = positiveInteger(input.expectedVersion, "expectedVersion");
  const expectedProfileHash = sha256(input.expectedProfileHash, "expectedProfileHash")!;
  const approvedByUserId = requiredText(input.approvedByUserId, "approvedByUserId", 64);
  if (input.targetStatus !== "shadow" && input.targetStatus !== "active") {
    fail("invalid_input", "targetStatus must be shadow or active.", { targetStatus: input.targetStatus });
  }
  return runInTransaction((db) => {
    const row = readRow(db, "production_profiles", profileId);
    if (!row) fail("not_found", "Production profile not found.", { profileId });
    const current = mapProfile(row);
    if (
      current.workspaceId !== workspaceId ||
      current.version !== expectedVersion ||
      current.profileHash !== expectedProfileHash
    ) {
      fail("stale_version", "Production profile approval does not match the exact stored version and hash.", {
        profileId,
        expectedVersion,
        expectedProfileHash,
        actualVersion: current.version,
        actualProfileHash: current.profileHash
      });
    }
    const targetScope: ProductionProfileApprovalScope = input.targetStatus === "active" ? "live" : "shadow";
    if (
      current.status === input.targetStatus &&
      current.approvedByUserId === approvedByUserId &&
      isProductionProfileExplicitlyApproved(current, targetScope)
    ) {
      return current;
    }
    if (
      current.status === input.targetStatus &&
      isProductionProfileExplicitlyApproved(current, targetScope)
    ) {
      fail("invalid_transition", "Production profile is already explicitly approved by a different owner identity.", {
        profileId,
        approvedByUserId: current.approvedByUserId
      });
    }
    if (current.status === "retired") {
      fail("invalid_transition", "A retired production profile cannot be approved again.", { profileId });
    }
    if (input.targetStatus === "shadow" && current.status !== "draft" && current.status !== "shadow") {
      fail("invalid_transition", "Shadow approval requires a draft or legacy unbound shadow profile.", {
        profileId,
        currentStatus: current.status
      });
    }
    if (
      input.targetStatus === "active" &&
      current.status !== "shadow" &&
      current.status !== "active"
    ) {
      fail("invalid_transition", "Live approval requires an explicitly approved shadow profile.", {
        profileId,
        currentStatus: current.status
      });
    }
    if (
      input.targetStatus === "active" &&
      current.status === "shadow" &&
      !isProductionProfileExplicitlyApproved(current, "shadow")
    ) {
      fail("invalid_transition", "Live approval requires the current hash/version to have explicit shadow approval first.", {
        profileId,
        currentStatus: current.status
      });
    }
    // An already-active row without a binding is a legacy row created by the
    // former implicit path. It can only become valid through this exact owner
    // command; no start/reconcile path manufactures the binding.
    const approvedAt = input.approvedAt ?? nowIso();
    const binding = productionProfileApprovalBinding({
      profileId: current.id,
      workspaceId: current.workspaceId,
      channelId: current.channelId,
      version: current.version,
      profileHash: current.profileHash,
      status: input.targetStatus,
      approvalScope: targetScope,
      approvedAt,
      approvedByUserId
    });
    const result = db.prepare(`UPDATE production_profiles
      SET status = ?, approved_at = ?, approved_by_user_id = ?, approval_scope = ?, approval_binding_sha256 = ?
      WHERE id = ? AND workspace_id = ? AND version = ? AND profile_hash = ? AND status = ?`)
      .run(input.targetStatus, approvedAt, approvedByUserId, targetScope, binding,
        current.id, current.workspaceId, current.version, current.profileHash, current.status);
    if (Number(result.changes) !== 1) {
      fail("stale_version", "Production profile changed while approval was being recorded.", { profileId });
    }
    return mapProfile(readRow(db, "production_profiles", current.id)!);
  });
}

export type CreateProductionRunChannelInput = {
  channelId: string;
  profileId: string;
  profileVersion: number;
  profileHash: string;
  expectedYoutubeChannelId: string;
  targetCount?: number | null;
};

export type CreateOrGetProductionRunInput = {
  workspaceId: string;
  portfolioProfileHash: string;
  logicalDate: string;
  mode: ProductionRunMode;
  targetPerChannel: number;
  manifestHash: string;
  manifest: Record<string, unknown>;
  idempotencyKey?: string | null;
  channels: CreateProductionRunChannelInput[];
};

function assertSameRunRequest(run: ProductionRunRecord, input: CreateOrGetProductionRunInput): void {
  const sameBusinessTuple = run.workspaceId === input.workspaceId &&
    run.portfolioProfileHash === input.portfolioProfileHash.toLowerCase() && run.logicalDate === input.logicalDate && run.mode === input.mode;
  if (!sameBusinessTuple || run.targetPerChannel !== input.targetPerChannel || run.manifestHash !== input.manifestHash.toLowerCase()) {
    fail("idempotency_conflict", "Idempotency key or business run tuple is already bound to different immutable input.", {
      runId: run.id
    });
  }
}

export function createOrGetProductionRun(input: CreateOrGetProductionRunInput): {
  run: ProductionRunRecord;
  existing: boolean;
} {
  const workspaceId = requiredText(input.workspaceId, "workspaceId", 64);
  const portfolioProfileHash = sha256(input.portfolioProfileHash, "portfolioProfileHash")!;
  const manifestHash = sha256(input.manifestHash, "manifestHash")!;
  const logicalDate = requiredText(input.logicalDate, "logicalDate", 10);
  if (!LOGICAL_DATE_PATTERN.test(logicalDate)) {
    fail("invalid_input", "logicalDate must use YYYY-MM-DD.", { logicalDate });
  }
  const targetPerChannel = positiveInteger(input.targetPerChannel, "targetPerChannel");
  if (!Array.isArray(input.channels) || input.channels.length === 0) {
    fail("invalid_input", "At least one production channel is required.");
  }
  const channelIds = input.channels.map((channel) => requiredText(channel.channelId, "channelId", 64));
  if (new Set(channelIds).size !== channelIds.length) {
    fail("invalid_input", "Production run channels must be unique.");
  }
  const idempotencyKey = optionalText(input.idempotencyKey, 256);

  return runInTransaction((db) => {
    if (idempotencyKey) {
      const requestRow = db.prepare(`SELECT * FROM production_runs
        WHERE workspace_id = ? AND request_idempotency_key = ? LIMIT 1`).get(workspaceId, idempotencyKey) as Row | undefined;
      if (requestRow) {
        const run = mapRun(requestRow);
        assertSameRunRequest(run, { ...input, workspaceId, portfolioProfileHash, manifestHash, targetPerChannel });
        return { run, existing: true };
      }
    }
    const businessRow = db.prepare(`SELECT * FROM production_runs
      WHERE workspace_id = ? AND portfolio_profile_hash = ? AND logical_date = ? AND mode = ? LIMIT 1`)
      .get(workspaceId, portfolioProfileHash, logicalDate, input.mode) as Row | undefined;
    if (businessRow) {
      const run = mapRun(businessRow);
      assertSameRunRequest(run, { ...input, workspaceId, portfolioProfileHash, manifestHash, targetPerChannel });
      return { run, existing: true };
    }

    const profiles = input.channels.map((channel) => {
      const profileRow = db.prepare(`SELECT * FROM production_profiles
        WHERE id = ? AND workspace_id = ? AND channel_id = ? AND version = ? AND profile_hash = ? LIMIT 1`)
        .get(requiredText(channel.profileId, "profileId", 64), workspaceId, channel.channelId,
          positiveInteger(channel.profileVersion, "profileVersion"), sha256(channel.profileHash, "profileHash")) as Row | undefined;
      if (!profileRow) {
        fail("not_found", "Frozen production profile does not match the requested channel/version/hash.", {
          profileId: channel.profileId, channelId: channel.channelId
        });
      }
      const profile = mapProfile(profileRow);
      if (profile.expectedYoutubeChannelId !== channel.expectedYoutubeChannelId) {
        fail("invalid_input", "Expected YouTube destination differs from the frozen profile.", { channelId: channel.channelId });
      }
      return {
        channel: {
          ...channel,
          targetCount: positiveInteger(channel.targetCount ?? targetPerChannel, "channel.targetCount")
        },
        profile
      };
    });

    const stamp = nowIso();
    const runId = newId();
    try {
      db.prepare(`INSERT INTO production_runs
        (id, workspace_id, portfolio_profile_hash, logical_date, mode, status, target_per_channel,
         manifest_hash, manifest_json, request_idempotency_key, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, 1, ?, ?)`)
        .run(runId, workspaceId, portfolioProfileHash, logicalDate, input.mode, targetPerChannel,
          manifestHash, stringify(input.manifest), idempotencyKey, stamp, stamp);

      for (const { channel, profile } of profiles) {
        db.prepare(`INSERT INTO production_run_channels
          (id, run_id, workspace_id, channel_id, profile_id, profile_version, profile_hash,
           expected_youtube_channel_id, status, target_count, public_verified_count, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, 0, 1, ?, ?)`)
        .run(newId(), runId, workspaceId, channel.channelId, profile.id, profile.version, profile.profileHash,
            profile.expectedYoutubeChannelId, channel.targetCount, stamp, stamp);
      }
      appendEventTx(db, {
        workspaceId, runId, eventType: "production.run.created", toState: "created",
        payload: { portfolioProfileHash, logicalDate, mode: input.mode, channelIds }, createdAt: stamp
      });
    } catch (error) {
      if (error instanceof ProductionStoreError) throw error;
      if (isConstraintError(error)) {
        fail("uniqueness_conflict", "Production run uniqueness constraint failed.", { workspaceId, logicalDate });
      }
      throw error;
    }
    return { run: requireRun(db, runId), existing: false };
  });
}

export function getProductionRun(runId: string): ProductionRunRecord | null {
  const row = readRow(getDb(), "production_runs", requiredText(runId, "runId", 64));
  return row ? mapRun(row) : null;
}

export function findProductionRunByIdempotencyKey(input: {
  workspaceId: string;
  idempotencyKey: string;
}): ProductionRunRecord | null {
  const row = getDb().prepare(`SELECT * FROM production_runs
    WHERE workspace_id = ? AND request_idempotency_key = ? LIMIT 1`)
    .get(
      requiredText(input.workspaceId, "workspaceId", 64),
      requiredText(input.idempotencyKey, "idempotencyKey", 256)
    ) as Row | undefined;
  return row ? mapRun(row) : null;
}

export function listProductionRuns(input: {
  workspaceId?: string | null;
  modes?: ProductionRunMode[] | null;
  statuses?: ProductionRunStatus[] | null;
  hasOpenOutbox?: boolean | null;
  limit?: number | null;
} = {}): ProductionRunRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (input.workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(requiredText(input.workspaceId, "workspaceId", 64));
  }
  if (input.modes?.length) {
    const modes = [...new Set(input.modes)];
    clauses.push(`mode IN (${modes.map(() => "?").join(", ")})`);
    params.push(...modes);
  }
  if (input.statuses?.length) {
    const statuses = [...new Set(input.statuses)];
    clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }
  if (input.hasOpenOutbox === true) {
    clauses.push(`EXISTS (
      SELECT 1 FROM production_outbox AS open_outbox
      WHERE open_outbox.run_id = production_runs.id
        AND ((open_outbox.status = 'pending' AND open_outbox.attempts < open_outbox.max_attempts
          AND (open_outbox.event_kind = 'production.item.public_verified' OR EXISTS (
            SELECT 1 FROM production_run_channels AS claimable_channel
            WHERE claimable_channel.run_id = open_outbox.run_id
              AND claimable_channel.channel_id = open_outbox.channel_id
              AND claimable_channel.status NOT IN ('completed', 'blocked', 'canceled', 'failed')
          )))
          OR open_outbox.status = 'processing')
    )`);
  }
  const limit = Math.min(1_000, positiveInteger(input.limit ?? 100, "limit"));
  params.push(limit);
  return (getDb().prepare(`SELECT * FROM production_runs
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY created_at ASC, id ASC LIMIT ?`).all(...params) as Row[]).map(mapRun);
}

export function listProductionRunChannels(runId: string): ProductionRunChannelRecord[] {
  return (getDb().prepare("SELECT * FROM production_run_channels WHERE run_id = ? ORDER BY created_at, channel_id")
    .all(requiredText(runId, "runId", 64)) as Row[]).map(mapRunChannel);
}

export function listProductionItems(input: {
  runId: string;
  channelId?: string | null;
  includeHistorical?: boolean | null;
}): ProductionItemRecord[] {
  const clauses = ["run_id = ?"];
  const params: string[] = [requiredText(input.runId, "runId", 64)];
  if (input.channelId) {
    clauses.push("channel_id = ?");
    params.push(requiredText(input.channelId, "channelId", 64));
  }
  if (!input.includeHistorical) {
    clauses.push("state NOT IN ('replaced', 'quarantined', 'failed')");
  }
  return (getDb().prepare(`SELECT * FROM production_items WHERE ${clauses.join(" AND ")}
    ORDER BY channel_id, item_slot, generation`).all(...params) as Row[]).map(mapItem);
}

export function getProductionItem(itemId: string): ProductionItemRecord | null {
  const row = readRow(getDb(), "production_items", requiredText(itemId, "itemId", 64));
  return row ? mapItem(row) : null;
}

export type CreateProductionItemInput = {
  runId: string;
  runChannelId: string;
  itemSlot: number;
  attemptBudget?: number | null;
};

function insertProductionItemTx(db: DatabaseSync, input: {
  run: ProductionRunRecord;
  runChannel: ProductionRunChannelRecord;
  itemSlot: number;
  generation: number;
  attemptBudget: number;
  sourceCandidateId?: string | null;
  createdAt: string;
}): ProductionItemRecord {
  const itemId = newId();
  try {
    db.prepare(`INSERT INTO production_items
      (id, run_id, run_channel_id, workspace_id, channel_id, item_slot, generation, state,
       source_candidate_id, expected_youtube_channel_id, attempts, attempt_budget, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, 0, ?, 1, ?, ?)`)
      .run(itemId, input.run.id, input.runChannel.id, input.run.workspaceId, input.runChannel.channelId,
        input.itemSlot, input.generation, input.sourceCandidateId ?? null, input.runChannel.expectedYoutubeChannelId,
        input.attemptBudget, input.createdAt, input.createdAt);
  } catch (error) {
    if (isConstraintError(error)) {
      fail("uniqueness_conflict", "A current production item already exists for this logical slot.", {
        runId: input.run.id, channelId: input.runChannel.channelId, itemSlot: input.itemSlot
      });
    }
    throw error;
  }
  appendEventTx(db, {
    workspaceId: input.run.workspaceId, runId: input.run.id, channelId: input.runChannel.channelId,
    productionItemId: itemId, eventType: "production.item.created", toState: "reserved",
    payload: { itemSlot: input.itemSlot, generation: input.generation }, createdAt: input.createdAt
  });
  return requireItem(db, itemId);
}

export function createProductionItem(input: CreateProductionItemInput): ProductionItemRecord {
  return runInTransaction((db) => {
    const run = requireRun(db, requiredText(input.runId, "runId", 64));
    if (RUN_TERMINAL_STATES.has(run.status)) {
      fail("invalid_transition", "Cannot add an item to a terminal production run.", { runId: run.id, status: run.status });
    }
    const runChannel = requireRunChannel(db, requiredText(input.runChannelId, "runChannelId", 64));
    if (runChannel.runId !== run.id) {
      fail("invalid_input", "Production run channel belongs to another run.");
    }
    const itemSlot = positiveInteger(input.itemSlot, "itemSlot");
    if (itemSlot > runChannel.targetCount) {
      fail("invalid_input", "itemSlot exceeds the channel target count.", { itemSlot, targetCount: runChannel.targetCount });
    }
    const profileRow = readRow(db, "production_profiles", runChannel.profileId);
    const defaultBudget = profileRow ? mapProfile(profileRow).candidateAttemptBudget : 1;
    return insertProductionItemTx(db, {
      run, runChannel, itemSlot, generation: 1,
      attemptBudget: positiveInteger(input.attemptBudget ?? defaultBudget, "attemptBudget"), createdAt: nowIso()
    });
  });
}

export function createReplacementProductionItem(input: {
  replacedItemId: string;
  expectedVersion: number;
  attemptBudget?: number | null;
}): ProductionItemRecord {
  return runInTransaction((db) => {
    const oldItem = requireItem(db, requiredText(input.replacedItemId, "replacedItemId", 64));
    if (oldItem.version !== input.expectedVersion) {
      fail("stale_version", "Production item version is stale.", { expected: input.expectedVersion, actual: oldItem.version });
    }
    if (!REPLACEABLE_ITEM_STATES.has(oldItem.state) || oldItem.publicationId || oldItem.youtubeVideoId || oldItem.uploadSessionUrl) {
      fail("invalid_transition", "This production item cannot receive another generation.", { state: oldItem.state });
    }
    const run = requireRun(db, oldItem.runId);
    const runChannel = requireRunChannel(db, oldItem.runChannelId);
    return insertProductionItemTx(db, {
      run, runChannel, itemSlot: oldItem.itemSlot, generation: oldItem.generation + 1,
      attemptBudget: positiveInteger(input.attemptBudget ?? oldItem.attemptBudget, "attemptBudget"), createdAt: nowIso()
    });
  });
}

export type ProductionItemTransitionPatch = {
  sourceCandidateId?: string | null;
  sourceSha256?: string | null;
  previewSha256?: string | null;
  templateSha256?: string | null;
  settingsSha256?: string | null;
  finalArtifactSha256?: string | null;
  chatId?: string | null;
  stage2RunId?: string | null;
  stage3JobId?: string | null;
  publicationId?: string | null;
  expectedYoutubeChannelId?: string | null;
  youtubeVideoId?: string | null;
  uploadSessionUrl?: string | null;
  lastError?: string | null;
  incrementAttempts?: boolean | null;
};

export type TransitionProductionItemInput = {
  itemId: string;
  expectedVersion: number;
  toState: ProductionItemState;
  resumeState?: ProductionItemResumeState | null;
  eventType: string;
  eventPayload?: Record<string, unknown>;
  patch?: ProductionItemTransitionPatch;
  outbox?: Omit<AppendProductionOutboxInput, "workspaceId" | "runId" | "channelId" | "productionItemId"> | null;
  // Optional caller clock (ISO). Deterministic replay/simulation contours run on a
  // virtual clock; stamping with the real wall clock would make outbox availableAt
  // land in the virtual future and never become claimable.
  now?: string | null;
};

function patchedText(current: string | null, value: string | null | undefined, field: string, maxLength = 2048): string | null {
  return value === undefined ? current : value === null ? null : requiredText(value, field, maxLength);
}

function patchedHash(current: string | null, value: string | null | undefined, field: string): string | null {
  return value === undefined ? current : sha256(value, field, true);
}

function requireBoundQualityVerdict(db: DatabaseSync, item: ProductionItemRecord, gateType: QualityGateType): void {
  const artifactSha256 = gateType === "source"
    ? item.sourceSha256
    : gateType === "preview"
      ? item.previewSha256
      : item.finalArtifactSha256;
  if (!artifactSha256) {
    fail("quality_gate_missing", `${gateType} artifact hash is missing.`, { itemId: item.id, gateType });
  }
  const derived = deriveCombinedQualityPass(db, {
    productionItemId: item.id,
    gateType,
    artifactSha256,
    sourceSha256: item.sourceSha256,
    previewSha256: item.previewSha256,
    templateSha256: item.templateSha256,
    settingsSha256: item.settingsSha256
  });
  if (!derived) {
    fail("quality_gate_missing", `No derived PASS matches the current ${gateType} artifact bindings.`, {
      itemId: item.id, gateType, artifactSha256
    });
  }
}

function validateTransitionArtifacts(db: DatabaseSync, item: ProductionItemRecord, toState: ProductionItemState): void {
  if (toState === "source_ingested" && (!item.sourceCandidateId || !item.sourceSha256)) {
    fail("invalid_transition", "source_ingested requires a reserved candidate and source hash.", { itemId: item.id });
  }
  if (toState === "source_ingested") {
    const candidateRow = readRow(db, "channel_source_candidates", item.sourceCandidateId!);
    const candidate = candidateRow ? mapCandidate(candidateRow) : null;
    if (!candidate || candidate.status !== "reserved" || candidate.reservedItemId !== item.id ||
        candidate.workspaceId !== item.workspaceId || candidate.channelId !== item.channelId ||
        !isChannelSourceCandidateQualified(candidate)) {
      fail("source_conflict", "source_ingested requires this item's transactional source reservation.", {
        itemId: item.id, sourceCandidateId: item.sourceCandidateId
      });
    }
  }
  if (toState === "source_qualified") {
    requireBoundQualityVerdict(db, item, "source");
  }
  if (toState === "preview_ready" && (!item.sourceSha256 || !item.previewSha256 || !item.templateSha256 || !item.settingsSha256)) {
    fail("invalid_transition", "preview_ready requires source, preview, template, and settings hashes.", { itemId: item.id });
  }
  if (toState === "preview_approved") {
    requireBoundQualityVerdict(db, item, "preview");
  }
  if (toState === "final_rendered" && !item.finalArtifactSha256) {
    fail("invalid_transition", "final_rendered requires the final artifact hash.", { itemId: item.id });
  }
  if (toState === "final_approved") {
    requireBoundQualityVerdict(db, item, "final");
  }
  if (toState === "publication_scheduled" && !item.publicationId) {
    fail("invalid_transition", "publication_scheduled requires a bound publication intent.", { itemId: item.id });
  }
  if (toState === "upload_outcome_unknown" && !item.publicationId) {
    fail("invalid_transition", "upload_outcome_unknown requires the original publication intent.", { itemId: item.id });
  }
}

function applyProductionItemTransitionTx(db: DatabaseSync, input: TransitionProductionItemInput, stamp: string): ProductionItemRecord {
  const current = requireItem(db, requiredText(input.itemId, "itemId", 64));
  if (current.version !== input.expectedVersion) {
    fail("stale_version", "Production item version is stale.", {
      itemId: current.id, expected: input.expectedVersion, actual: current.version
    });
  }
  if (input.toState === "public_verified") {
    fail("invalid_transition", "public_verified can only be written by recordPublicVerification.", { itemId: current.id });
  }
  if (!isAllowedProductionItemTransition(current.state, input.toState)) {
    fail("invalid_transition", `Invalid production item transition ${current.state} -> ${input.toState}.`, {
      itemId: current.id, from: current.state, to: input.toState
    });
  }
  let resumeState: ProductionItemResumeState | null = current.resumeState;
  if (input.toState === "rework") {
    if (!input.resumeState || !["source_qualified", "brief_ready", "preview_ready"].includes(input.resumeState)) {
      fail("invalid_transition", "rework requires an explicit supported resumeState.", { itemId: current.id });
    }
    resumeState = input.resumeState;
  } else if (current.state === "rework") {
    if (input.toState !== current.resumeState && !["replaced", "quarantined", "policy_blocked", "cancel_requested", "failed"].includes(input.toState)) {
      fail("invalid_transition", "A rework item may resume only at its recorded resumeState.", {
        itemId: current.id, resumeState: current.resumeState, requested: input.toState
      });
    }
    resumeState = null;
  } else if (input.resumeState !== undefined && input.resumeState !== null) {
    fail("invalid_input", "resumeState is valid only when entering rework.", { itemId: current.id });
  }

  const patch = input.patch ?? {};
  const next: ProductionItemRecord = {
    ...current,
    state: input.toState,
    resumeState,
    sourceCandidateId: patchedText(current.sourceCandidateId, patch.sourceCandidateId, "sourceCandidateId", 64),
    sourceSha256: patchedHash(current.sourceSha256, patch.sourceSha256, "sourceSha256"),
    previewSha256: patchedHash(current.previewSha256, patch.previewSha256, "previewSha256"),
    templateSha256: patchedHash(current.templateSha256, patch.templateSha256, "templateSha256"),
    settingsSha256: patchedHash(current.settingsSha256, patch.settingsSha256, "settingsSha256"),
    finalArtifactSha256: patchedHash(current.finalArtifactSha256, patch.finalArtifactSha256, "finalArtifactSha256"),
    chatId: patchedText(current.chatId, patch.chatId, "chatId", 64),
    stage2RunId: patchedText(current.stage2RunId, patch.stage2RunId, "stage2RunId", 64),
    stage3JobId: patchedText(current.stage3JobId, patch.stage3JobId, "stage3JobId", 64),
    publicationId: patchedText(current.publicationId, patch.publicationId, "publicationId", 64),
    expectedYoutubeChannelId: patch.expectedYoutubeChannelId === undefined || patch.expectedYoutubeChannelId === null
      ? current.expectedYoutubeChannelId
      : requiredText(patch.expectedYoutubeChannelId, "expectedYoutubeChannelId", 128),
    youtubeVideoId: patchedText(current.youtubeVideoId, patch.youtubeVideoId, "youtubeVideoId", 128),
    uploadSessionUrl: patchedText(current.uploadSessionUrl, patch.uploadSessionUrl, "uploadSessionUrl", 2048),
    attempts: current.attempts + (patch.incrementAttempts ? 1 : 0),
    lastError: patch.lastError === undefined ? current.lastError : optionalText(patch.lastError, 2000),
    version: current.version + 1,
    updatedAt: stamp,
    completedAt: ITEM_COMPLETED_STATES.has(input.toState) ? stamp : null
  };
  const sourceBindingChanged = next.sourceSha256 !== current.sourceSha256;
  const previewBindingChanged = next.previewSha256 !== current.previewSha256;
  const renderBindingChanged = next.templateSha256 !== current.templateSha256 || next.settingsSha256 !== current.settingsSha256;
  if ((sourceBindingChanged || renderBindingChanged) && patch.previewSha256 === undefined) {
    next.previewSha256 = null;
  }
  if ((sourceBindingChanged || previewBindingChanged || renderBindingChanged) && patch.finalArtifactSha256 === undefined) {
    next.finalArtifactSha256 = null;
  }
  if (current.expectedYoutubeChannelId !== next.expectedYoutubeChannelId) {
    fail("invalid_input", "Expected YouTube destination is immutable for a production item.", { itemId: current.id });
  }
  for (const field of ["publicationId", "youtubeVideoId", "uploadSessionUrl"] as const) {
    if (current[field] && next[field] !== current[field]) {
      fail("external_effect_conflict", `${field} cannot be cleared or rebound.`, { itemId: current.id, field });
    }
  }
  if (next.attempts > next.attemptBudget) {
    fail("invalid_transition", "Production item attempt budget is exhausted.", {
      itemId: current.id, attempts: next.attempts, attemptBudget: next.attemptBudget
    });
  }
  validateTransitionArtifacts(db, next, input.toState);

  const result = db.prepare(`UPDATE production_items SET
    state = ?, resume_state = ?, source_candidate_id = ?, source_sha256 = ?, preview_sha256 = ?,
    template_sha256 = ?, settings_sha256 = ?, final_artifact_sha256 = ?, chat_id = ?, stage2_run_id = ?,
    stage3_job_id = ?, publication_id = ?, expected_youtube_channel_id = ?, youtube_video_id = ?,
    upload_session_url = ?, attempts = ?, version = version + 1, last_error = ?, updated_at = ?, completed_at = ?
    WHERE id = ? AND version = ?`)
    .run(next.state, next.resumeState, next.sourceCandidateId, next.sourceSha256, next.previewSha256,
      next.templateSha256, next.settingsSha256, next.finalArtifactSha256, next.chatId, next.stage2RunId,
      next.stage3JobId, next.publicationId, next.expectedYoutubeChannelId, next.youtubeVideoId,
      next.uploadSessionUrl, next.attempts, next.lastError, stamp, next.completedAt, current.id, current.version);
  if (Number(result.changes) !== 1) {
    fail("stale_version", "Production item changed before transition commit.", { itemId: current.id });
  }
  appendEventTx(db, {
    workspaceId: current.workspaceId, runId: current.runId, channelId: current.channelId, productionItemId: current.id,
    eventType: input.eventType, fromState: current.state, toState: input.toState, payload: input.eventPayload, createdAt: stamp
  });
  if (input.outbox) {
    appendOutboxTx(db, {
      ...input.outbox,
      workspaceId: current.workspaceId,
      runId: current.runId,
      channelId: current.channelId,
      productionItemId: current.id
    }, stamp);
  }
  return requireItem(db, current.id);
}

export function transitionProductionItem(input: TransitionProductionItemInput): ProductionItemRecord {
  return runInTransaction((db) => applyProductionItemTransitionTx(db, input, input.now ?? nowIso()));
}

export function transitionProductionRun(input: {
  runId: string;
  expectedVersion: number;
  toStatus: ProductionRunStatus;
  eventType: string;
  eventPayload?: Record<string, unknown>;
  lastError?: string | null;
}): ProductionRunRecord {
  return runInTransaction((db) => {
    const run = requireRun(db, requiredText(input.runId, "runId", 64));
    if (run.version !== input.expectedVersion) {
      fail("stale_version", "Production run version is stale.", { expected: input.expectedVersion, actual: run.version });
    }
    if (!PRODUCTION_RUN_TRANSITIONS[run.status].includes(input.toStatus)) {
      fail("invalid_transition", `Invalid production run transition ${run.status} -> ${input.toStatus}.`);
    }
    const stamp = nowIso();
    const completedAt = RUN_TERMINAL_STATES.has(input.toStatus) ? stamp : null;
    const result = db.prepare(`UPDATE production_runs
      SET status = ?, version = version + 1, last_error = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND version = ?`)
      .run(input.toStatus, input.lastError === undefined ? run.lastError : optionalText(input.lastError, 2000),
        stamp, completedAt, run.id, run.version);
    if (Number(result.changes) !== 1) fail("stale_version", "Production run changed before transition commit.");
    appendEventTx(db, {
      workspaceId: run.workspaceId, runId: run.id, eventType: input.eventType,
      fromState: run.status, toState: input.toStatus, payload: input.eventPayload, createdAt: stamp
    });
    return requireRun(db, run.id);
  });
}

export function transitionProductionRunChannel(input: {
  runChannelId: string;
  expectedVersion: number;
  toStatus: ProductionRunChannelStatus;
  eventType: string;
  eventPayload?: Record<string, unknown>;
  nextSlotAt?: string | null;
  blockerCode?: string | null;
  blockerMessage?: string | null;
}): ProductionRunChannelRecord {
  return runInTransaction((db) => {
    const channel = requireRunChannel(db, requiredText(input.runChannelId, "runChannelId", 64));
    if (channel.version !== input.expectedVersion) {
      fail("stale_version", "Production run channel version is stale.", { expected: input.expectedVersion, actual: channel.version });
    }
    if (!PRODUCTION_RUN_TRANSITIONS[channel.status].includes(input.toStatus)) {
      fail("invalid_transition", `Invalid production run channel transition ${channel.status} -> ${input.toStatus}.`);
    }
    const stamp = nowIso();
    const completedAt = RUN_TERMINAL_STATES.has(input.toStatus) ? stamp : null;
    const result = db.prepare(`UPDATE production_run_channels SET
      status = ?, next_slot_at = ?, blocker_code = ?, blocker_message = ?, version = version + 1,
      updated_at = ?, completed_at = ? WHERE id = ? AND version = ?`)
      .run(input.toStatus, input.nextSlotAt === undefined ? channel.nextSlotAt : input.nextSlotAt,
        input.blockerCode === undefined ? channel.blockerCode : optionalText(input.blockerCode, 160),
        input.blockerMessage === undefined ? channel.blockerMessage : optionalText(input.blockerMessage, 2000),
        stamp, completedAt, channel.id, channel.version);
    if (Number(result.changes) !== 1) fail("stale_version", "Production run channel changed before transition commit.");
    appendEventTx(db, {
      workspaceId: channel.workspaceId, runId: channel.runId, channelId: channel.channelId,
      eventType: input.eventType, fromState: channel.status, toState: input.toStatus,
      payload: input.eventPayload, createdAt: stamp
    });
    return requireRunChannel(db, channel.id);
  });
}

export function appendProductionOutbox(
  input: AppendProductionOutboxInput & { now?: string | null }
): ProductionOutboxRecord {
  return runInTransaction((db) => appendOutboxTx(db, input, input.now ?? nowIso()));
}

export type UpsertChannelSourceCandidateInput = {
  workspaceId: string;
  channelId: string;
  provider: string;
  sourceUrl: string;
  canonicalUrl: string;
  contentSha256?: string | null;
  eventFingerprint?: string | null;
  categoryKey: string;
  rightsStatus: string;
  evidence: Record<string, unknown>;
  status?: Extract<ChannelSourceCandidateStatus, "available" | "rejected"> | null;
};

export type TransitionChannelSourceCandidateQualificationInput = {
  candidateId: string;
  toStatus: Exclude<ChannelSourceQualificationStatus, "discovered">;
  contentSha256?: string | null;
  eventFingerprint?: string | null;
  evidence?: Record<string, unknown> | null;
  reason?: string | null;
};

export function isChannelSourceCandidateQualified(
  candidate: ChannelSourceCandidateRecord
): boolean {
  if (candidate.evidence.schemaVersion === "project-kings-imported-source-evidence-v1") {
    return false;
  }
  return candidate.qualificationStatus === "qualified" &&
    Boolean(candidate.contentSha256) &&
    Boolean(candidate.eventFingerprint) &&
    Boolean(candidate.qualificationEvidenceSha256) &&
    candidate.qualificationEvidenceSha256 ===
      calculateChannelSourceQualificationEvidenceSha256(candidate.evidence);
}

export function upsertChannelSourceCandidate(input: UpsertChannelSourceCandidateInput): {
  candidate: ChannelSourceCandidateRecord;
  created: boolean;
  duplicateBy: "canonical_url" | "content_sha256" | "event_fingerprint" | null;
} {
  return runInTransaction((db) => {
    const workspaceId = requiredText(input.workspaceId, "workspaceId", 64);
    const channelId = requiredText(input.channelId, "channelId", 64);
    const canonicalUrl = requiredText(input.canonicalUrl, "canonicalUrl", 2048);
    const contentHash = sha256(input.contentSha256, "contentSha256", true);
    const eventFingerprint = optionalText(input.eventFingerprint, 256);
    const candidates: Array<{ kind: "canonical_url" | "content_sha256" | "event_fingerprint"; row?: Row }> = [
      {
        kind: "canonical_url",
        row: db.prepare(`SELECT * FROM channel_source_candidates
          WHERE workspace_id = ? AND channel_id = ? AND canonical_url = ? LIMIT 1`)
          .get(workspaceId, channelId, canonicalUrl) as Row | undefined
      },
      {
        kind: "content_sha256",
        row: contentHash ? db.prepare(`SELECT * FROM channel_source_candidates
          WHERE workspace_id = ? AND channel_id = ? AND content_sha256 = ? LIMIT 1`)
          .get(workspaceId, channelId, contentHash) as Row | undefined : undefined
      },
      {
        kind: "event_fingerprint",
        row: eventFingerprint ? db.prepare(`SELECT * FROM channel_source_candidates
          WHERE workspace_id = ? AND channel_id = ? AND event_fingerprint = ? LIMIT 1`)
          .get(workspaceId, channelId, eventFingerprint) as Row | undefined : undefined
      }
    ];
    const duplicate = candidates.find((candidate) => candidate.row);
    if (duplicate?.row) {
      return { candidate: mapCandidate(duplicate.row), created: false, duplicateBy: duplicate.kind };
    }

    const id = newId();
    const stamp = nowIso();
    const status = input.status ?? "available";
    const qualificationStatus: ChannelSourceQualificationStatus =
      status === "rejected" ? "rejected" : "discovered";
    try {
      db.prepare(`INSERT INTO channel_source_candidates
        (id, workspace_id, channel_id, provider, source_url, canonical_url, content_sha256, event_fingerprint,
         category_key, rights_status, status, qualification_status, qualification_evidence_sha256,
         evidence_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`)
        .run(id, workspaceId, channelId, requiredText(input.provider, "provider", 80),
          requiredText(input.sourceUrl, "sourceUrl", 2048), canonicalUrl, contentHash, eventFingerprint,
          requiredText(input.categoryKey, "categoryKey", 160), requiredText(input.rightsStatus, "rightsStatus", 160),
          status, qualificationStatus, stringify(input.evidence), stamp, stamp);
    } catch (error) {
      if (isConstraintError(error)) {
        fail("uniqueness_conflict", "Source candidate conflicts with an existing URL, content hash, or event.", {
          channelId, canonicalUrl
        });
      }
      throw error;
    }
    return { candidate: mapCandidate(readRow(db, "channel_source_candidates", id)!), created: true, duplicateBy: null };
  });
}

export function transitionChannelSourceCandidateQualification(
  input: TransitionChannelSourceCandidateQualificationInput
): ChannelSourceCandidateRecord {
  return runInTransaction((db) => {
    const row = readRow(db, "channel_source_candidates", requiredText(input.candidateId, "candidateId", 64));
    if (!row) fail("not_found", "Source candidate not found.", { candidateId: input.candidateId });
    const candidate = mapCandidate(row);
    const toStatus = input.toStatus;
    if (candidate.qualificationStatus === "rejected" || candidate.qualificationStatus === "quarantined") {
      if (candidate.qualificationStatus === toStatus) return candidate;
      fail("source_conflict", "Terminal source qualification cannot be reopened.", {
        candidateId: candidate.id,
        qualificationStatus: candidate.qualificationStatus
      });
    }
    if (candidate.status !== "available") {
      fail("source_conflict", "Only an available source candidate can change qualification.", {
        candidateId: candidate.id,
        status: candidate.status
      });
    }
    const stamp = nowIso();
    if (toStatus === "pending") {
      if (candidate.qualificationStatus === "qualified") {
        fail("source_conflict", "A qualified source candidate cannot return to pending.", {
          candidateId: candidate.id
        });
      }
      db.prepare(`UPDATE channel_source_candidates
        SET qualification_status = 'pending', qualification_evidence_sha256 = NULL, updated_at = ?
        WHERE id = ? AND status = 'available' AND qualification_status IN ('discovered', 'pending')`)
        .run(stamp, candidate.id);
      return mapCandidate(readRow(db, "channel_source_candidates", candidate.id)!);
    }
    if (toStatus === "qualified") {
      const contentSha256 = sha256(input.contentSha256, "contentSha256")!;
      const eventFingerprint = requiredText(input.eventFingerprint, "eventFingerprint", 256);
      const evidence = parseObject(stringify(jsonObject(input.evidence)));
      if (Object.keys(evidence).length === 0) {
        fail("invalid_input", "Qualification evidence must be a non-empty object.", {
          candidateId: candidate.id
        });
      }
      const evidenceJson = stringify(evidence);
      const evidenceSha256 = calculateChannelSourceQualificationEvidenceSha256(evidence);
      if ((candidate.contentSha256 && candidate.contentSha256 !== contentSha256) ||
          (candidate.eventFingerprint && candidate.eventFingerprint !== eventFingerprint)) {
        fail("source_conflict", "Qualification cannot replace an existing source identity binding.", {
          candidateId: candidate.id
        });
      }
      if (candidate.qualificationStatus === "qualified") {
        if (candidate.contentSha256 === contentSha256 &&
            candidate.eventFingerprint === eventFingerprint &&
            candidate.qualificationEvidenceSha256 === evidenceSha256 &&
            isDeepStrictEqual(candidate.evidence, evidence)) {
          return candidate;
        }
        fail("source_conflict", "Qualified source evidence is immutable.", {
          candidateId: candidate.id
        });
      }
      try {
        const result = db.prepare(`UPDATE channel_source_candidates
          SET content_sha256 = ?, event_fingerprint = ?, evidence_json = ?, qualification_status = 'qualified',
              qualification_evidence_sha256 = ?, last_error = NULL, updated_at = ?
          WHERE id = ? AND status = 'available' AND qualification_status IN ('discovered', 'pending')`)
          .run(contentSha256, eventFingerprint, evidenceJson, evidenceSha256, stamp, candidate.id);
        if (Number(result.changes) !== 1) {
          fail("source_conflict", "Source qualification changed concurrently.", { candidateId: candidate.id });
        }
      } catch (error) {
        if (error instanceof ProductionStoreError) throw error;
        if (isConstraintError(error)) {
          fail("uniqueness_conflict", "Qualified source duplicates existing content or event evidence.", {
            candidateId: candidate.id
          });
        }
        throw error;
      }
      return mapCandidate(readRow(db, "channel_source_candidates", candidate.id)!);
    }
    const reason = requiredText(input.reason, "reason", 2000);
    const lifecycleStatus: Extract<ChannelSourceCandidateStatus, "rejected" | "quarantined"> = toStatus;
    db.prepare(`UPDATE channel_source_candidates
      SET status = ?, qualification_status = ?,
          quarantined_at = CASE WHEN ? = 'quarantined' THEN ? ELSE quarantined_at END,
          last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'available' AND qualification_status IN ('discovered', 'pending', 'qualified')`)
      .run(lifecycleStatus, toStatus, toStatus, stamp, reason, stamp, candidate.id);
    return mapCandidate(readRow(db, "channel_source_candidates", candidate.id)!);
  });
}

export function listChannelSourceCandidates(input: {
  workspaceId: string;
  channelId: string;
  status?: ChannelSourceCandidateStatus | null;
  qualificationStatus?: ChannelSourceQualificationStatus | null;
  limit?: number | null;
}): ChannelSourceCandidateRecord[] {
  const clauses = ["workspace_id = ?", "channel_id = ?"];
  const params: Array<string | number> = [requiredText(input.workspaceId, "workspaceId", 64), requiredText(input.channelId, "channelId", 64)];
  if (input.status) {
    clauses.push("status = ?");
    params.push(input.status);
  }
  if (input.qualificationStatus) {
    clauses.push("qualification_status = ?");
    params.push(input.qualificationStatus);
  }
  const limit = Math.min(1000, positiveInteger(input.limit ?? 100, "limit"));
  params.push(limit);
  return (getDb().prepare(`SELECT * FROM channel_source_candidates WHERE ${clauses.join(" AND ")}
    ORDER BY created_at ASC, id ASC LIMIT ?`).all(...params) as Row[]).map(mapCandidate);
}

export type ReserveChannelSourceCandidateInput = {
  candidateId: string;
  itemId: string;
  expectedItemVersion: number;
  outbox?: Omit<AppendProductionOutboxInput, "workspaceId" | "runId" | "channelId" | "productionItemId"> | null;
  // Optional caller clock (ISO); see TransitionProductionItemInput.now.
  now?: string | null;
};

function reserveChannelSourceCandidateTx(
  db: DatabaseSync,
  input: ReserveChannelSourceCandidateInput,
  stamp: string
): { candidate: ChannelSourceCandidateRecord; item: ProductionItemRecord } {
    const candidateRow = readRow(db, "channel_source_candidates", requiredText(input.candidateId, "candidateId", 64));
    if (!candidateRow) fail("not_found", "Source candidate not found.", { candidateId: input.candidateId });
    const candidate = mapCandidate(candidateRow);
    const item = requireItem(db, requiredText(input.itemId, "itemId", 64));
    if (!isChannelSourceCandidateQualified(candidate)) {
      fail("source_conflict", "Source candidate is not qualified with exact content, event, and evidence hashes.", {
        candidateId: candidate.id,
        qualificationStatus: candidate.qualificationStatus
      });
    }
    if (candidate.status === "reserved" && candidate.reservedItemId === item.id && item.sourceCandidateId === candidate.id) {
      if (input.outbox) {
        const eventKind = requiredText(input.outbox.eventKind, "eventKind", 160);
        const payload = jsonObject(input.outbox.payload);
        const dedupeKey = requiredText(
          input.outbox.dedupeKey ?? buildProductionOutboxDedupeKey(eventKind, payload),
          "dedupeKey",
          512
        );
        const existingOutbox = db.prepare(`SELECT * FROM production_outbox
          WHERE production_item_id = ? AND dedupe_key = ? LIMIT 1`)
          .get(item.id, dedupeKey) as Row | undefined;
        const existingRecord = existingOutbox ? mapOutbox(existingOutbox) : null;
        if (!existingRecord || existingRecord.eventKind !== eventKind ||
            existingRecord.maxAttempts !== positiveInteger(input.outbox.maxAttempts ?? 3, "maxAttempts") ||
            (input.outbox.availableAt !== undefined && input.outbox.availableAt !== null &&
              existingRecord.availableAt !== input.outbox.availableAt) ||
            !isDeepStrictEqual(existingRecord.payload, payload)) {
          fail("source_conflict", "Existing source reservation is not bound to the same atomic outbox payload.", {
            candidateId: candidate.id, itemId: item.id
          });
        }
      }
      return { candidate, item };
    }
    if (item.version !== input.expectedItemVersion) {
      fail("stale_version", "Production item version is stale.", { expected: input.expectedItemVersion, actual: item.version });
    }
    if (item.state !== "reserved" || item.sourceCandidateId) {
      fail("source_conflict", "Production item is not ready to reserve a source candidate.", { itemId: item.id, state: item.state });
    }
    const runChannel = requireRunChannel(db, item.runChannelId);
    const profileRow = readRow(db, "production_profiles", runChannel.profileId);
    if (!profileRow) fail("not_found", "Production profile not found for the run channel.");
    const candidateAttemptBudget = mapProfile(profileRow).candidateAttemptBudget;
    const attemptedCandidateIds = new Set(
      (db.prepare(`SELECT payload_json FROM production_events
        WHERE run_id = ? AND channel_id = ? AND event_type = 'production.source.reserved'`)
        .all(item.runId, item.channelId) as Row[])
        .map((row) => parseObject(row.payload_json).candidateId)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    );
    if (attemptedCandidateIds.has(candidate.id)) {
      fail("source_conflict", "Source candidate was already attempted by this run channel.", {
        candidateId: candidate.id,
        runChannelId: runChannel.id
      });
    }
    if (attemptedCandidateIds.size >= candidateAttemptBudget) {
      fail("source_budget_exhausted", "Run-channel source candidate budget is exhausted.", {
        runChannelId: runChannel.id,
        attemptedCandidates: attemptedCandidateIds.size,
        candidateAttemptBudget
      });
    }
    if (candidate.workspaceId !== item.workspaceId || candidate.channelId !== item.channelId || candidate.status !== "available") {
      fail("source_conflict", "Source candidate is unavailable or belongs to another channel.", {
        candidateId: candidate.id, status: candidate.status
      });
    }
    const candidateResult = db.prepare(`UPDATE channel_source_candidates
      SET status = 'reserved', reserved_item_id = ?, reserved_at = ?, last_error = NULL, updated_at = ?
      WHERE id = ? AND status = 'available' AND qualification_status = 'qualified'
        AND content_sha256 IS NOT NULL AND event_fingerprint IS NOT NULL
        AND qualification_evidence_sha256 IS NOT NULL`).run(item.id, stamp, stamp, candidate.id);
    if (Number(candidateResult.changes) !== 1) fail("source_conflict", "Source candidate was claimed concurrently.");
    const itemResult = db.prepare(`UPDATE production_items
      SET source_candidate_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
      .run(candidate.id, stamp, item.id, item.version);
    if (Number(itemResult.changes) !== 1) fail("stale_version", "Production item changed before source reservation commit.");
    appendEventTx(db, {
      workspaceId: item.workspaceId, runId: item.runId, channelId: item.channelId, productionItemId: item.id,
      eventType: "production.source.reserved", fromState: item.state, toState: item.state,
      payload: { candidateId: candidate.id }, createdAt: stamp
    });
    if (input.outbox) {
      appendOutboxTx(db, {
        ...input.outbox,
        workspaceId: item.workspaceId,
        runId: item.runId,
        channelId: item.channelId,
        productionItemId: item.id
      }, stamp);
    }
    return {
      candidate: mapCandidate(readRow(db, "channel_source_candidates", candidate.id)!),
      item: requireItem(db, item.id)
    };
}

export function getProductionRunChannelCandidateAttemptCount(runChannelId: string): number {
  const db = getDb();
  const runChannel = requireRunChannel(db, requiredText(runChannelId, "runChannelId", 64));
  return listProductionRunChannelAttemptedCandidateIds(runChannel.id).length;
}

export function listProductionRunChannelAttemptedCandidateIds(runChannelId: string): string[] {
  const db = getDb();
  const runChannel = requireRunChannel(db, requiredText(runChannelId, "runChannelId", 64));
  const rows = db.prepare(`SELECT payload_json FROM production_events
    WHERE run_id = ? AND channel_id = ? AND event_type = 'production.source.reserved'`)
    .all(runChannel.runId, runChannel.channelId) as Row[];
  return [...new Set(
    rows
      .map((row) => parseObject(row.payload_json).candidateId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  )].sort();
}

export function reserveChannelSourceCandidate(
  input: ReserveChannelSourceCandidateInput
): { candidate: ChannelSourceCandidateRecord; item: ProductionItemRecord } {
  return runInTransaction((db) => reserveChannelSourceCandidateTx(db, input, input.now ?? nowIso()));
}

export function reserveChannelSourceCandidatesAtomically(
  inputs: readonly ReserveChannelSourceCandidateInput[],
  options: { now?: string | null } = {}
): Array<{ candidate: ChannelSourceCandidateRecord; item: ProductionItemRecord }> {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) {
    fail("invalid_input", "Atomic source reservation batch must contain between 1 and 100 entries.");
  }
  const candidateIds = inputs.map((input) => requiredText(input.candidateId, "candidateId", 64));
  const itemIds = inputs.map((input) => requiredText(input.itemId, "itemId", 64));
  if (new Set(candidateIds).size !== candidateIds.length || new Set(itemIds).size !== itemIds.length) {
    fail("invalid_input", "Atomic source reservation batch requires unique candidate and item IDs.");
  }
  return runInTransaction((db) => {
    const stamp = options.now ?? nowIso();
    return inputs.map((input) => reserveChannelSourceCandidateTx(db, input, stamp));
  });
}

export function releaseChannelSourceCandidate(input: {
  candidateId: string;
  itemId: string;
  expectedItemVersion: number;
  reason: string;
}): { candidate: ChannelSourceCandidateRecord; item: ProductionItemRecord } {
  return runInTransaction((db) => {
    const candidateRow = readRow(db, "channel_source_candidates", requiredText(input.candidateId, "candidateId", 64));
    if (!candidateRow) fail("not_found", "Source candidate not found.");
    const candidate = mapCandidate(candidateRow);
    const item = requireItem(db, requiredText(input.itemId, "itemId", 64));
    if (item.version !== input.expectedItemVersion) fail("stale_version", "Production item version is stale.");
    if (candidate.status !== "reserved" || candidate.reservedItemId !== item.id || item.sourceCandidateId !== candidate.id) {
      fail("source_conflict", "Source reservation does not belong to this production item.");
    }
    const stamp = nowIso();
    db.prepare(`UPDATE channel_source_candidates SET status = 'available', reserved_item_id = NULL,
      reserved_at = NULL, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(requiredText(input.reason, "reason", 1000), stamp, candidate.id);
    db.prepare(`UPDATE production_items SET source_candidate_id = NULL, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?`).run(stamp, item.id, item.version);
    appendEventTx(db, {
      workspaceId: item.workspaceId, runId: item.runId, channelId: item.channelId, productionItemId: item.id,
      eventType: "production.source.released", fromState: item.state, toState: item.state,
      payload: { candidateId: candidate.id, reason: input.reason }, createdAt: stamp
    });
    return { candidate: mapCandidate(readRow(db, "channel_source_candidates", candidate.id)!), item: requireItem(db, item.id) };
  });
}

/**
 * Return a shadow-run source to the reusable buffer without erasing the
 * finished item's provenance. The append-only event is the idempotency fence:
 * once recorded, a later reconciliation must never release a reservation that
 * the same candidate acquired for another item.
 */
export function releaseShadowSourceCandidateReservation(input: {
  candidateId: string;
  itemId: string;
  expectedItemVersion: number;
}): { candidate: ChannelSourceCandidateRecord; item: ProductionItemRecord; released: boolean } {
  return runInTransaction((db) => {
    const candidateId = requiredText(input.candidateId, "candidateId", 64);
    const itemId = requiredText(input.itemId, "itemId", 64);
    const candidateRow = readRow(db, "channel_source_candidates", candidateId);
    if (!candidateRow) fail("not_found", "Source candidate not found.");
    const item = requireItem(db, itemId);
    const run = requireRun(db, item.runId);
    if (run.mode !== "shadow" || item.state !== "final_approved") {
      fail("invalid_transition", "Only a final_approved shadow item can release a reusable source reservation.", {
        runMode: run.mode,
        itemState: item.state
      });
    }
    if (item.sourceCandidateId !== candidateId) {
      fail("source_conflict", "Shadow item provenance does not reference this source candidate.");
    }

    const existingRelease = db.prepare(`SELECT id FROM production_events
      WHERE run_id = ? AND production_item_id = ?
        AND event_type = 'production.source.shadow_released'
      LIMIT 1`).get(run.id, item.id) as Row | undefined;
    if (existingRelease) {
      return {
        candidate: mapCandidate(readRow(db, "channel_source_candidates", candidateId)!),
        item,
        released: false
      };
    }
    if (item.version !== input.expectedItemVersion) {
      fail("stale_version", "Production item version is stale.", {
        expected: input.expectedItemVersion,
        actual: item.version
      });
    }

    const candidate = mapCandidate(candidateRow);
    if (candidate.status !== "reserved" || candidate.reservedItemId !== item.id) {
      fail("source_conflict", "Shadow source reservation no longer belongs to this production item.", {
        candidateStatus: candidate.status,
        reservedItemId: candidate.reservedItemId
      });
    }
    const stamp = nowIso();
    const released = db.prepare(`UPDATE channel_source_candidates
      SET status = 'available', reserved_item_id = NULL, reserved_at = NULL,
        last_error = NULL, updated_at = ?
      WHERE id = ? AND status = 'reserved' AND reserved_item_id = ?`)
      .run(stamp, candidate.id, item.id);
    if (Number(released.changes) !== 1) {
      fail("source_conflict", "Shadow source reservation changed before release.");
    }
    appendEventTx(db, {
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventType: "production.source.shadow_released",
      fromState: item.state,
      toState: item.state,
      payload: { candidateId: candidate.id, provenanceRetained: true },
      createdAt: stamp
    });
    return {
      candidate: mapCandidate(readRow(db, "channel_source_candidates", candidate.id)!),
      item,
      released: true
    };
  });
}

export function markChannelSourceCandidateConsumed(input: {
  candidateId: string;
  itemId: string;
}): ChannelSourceCandidateRecord {
  return runInTransaction((db) => {
    const candidateRow = readRow(db, "channel_source_candidates", requiredText(input.candidateId, "candidateId", 64));
    if (!candidateRow) fail("not_found", "Source candidate not found.");
    const candidate = mapCandidate(candidateRow);
    const item = requireItem(db, requiredText(input.itemId, "itemId", 64));
    if (item.state !== "public_verified" || candidate.status !== "reserved" || candidate.reservedItemId !== item.id) {
      fail("source_conflict", "A source candidate can be consumed only by its public_verified item.", {
        candidateStatus: candidate.status, itemState: item.state
      });
    }
    const stamp = nowIso();
    db.prepare(`UPDATE channel_source_candidates SET status = 'consumed', consumed_at = ?,
      reserved_item_id = NULL, reserved_at = NULL, updated_at = ? WHERE id = ?`)
      .run(stamp, stamp, candidate.id);
    return mapCandidate(readRow(db, "channel_source_candidates", candidate.id)!);
  });
}

export function quarantineChannelSourceCandidate(input: {
  candidateId: string;
  reason: string;
}): ChannelSourceCandidateRecord {
  return runInTransaction((db) => {
    const row = readRow(db, "channel_source_candidates", requiredText(input.candidateId, "candidateId", 64));
    if (!row) fail("not_found", "Source candidate not found.");
    const candidate = mapCandidate(row);
    if (candidate.status === "consumed") fail("source_conflict", "A consumed source candidate cannot be quarantined.");
    const stamp = nowIso();
    db.prepare(`UPDATE channel_source_candidates SET status = 'quarantined', qualification_status = 'quarantined',
      reserved_item_id = NULL,
      reserved_at = NULL, quarantined_at = ?, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(stamp, requiredText(input.reason, "reason", 1000), stamp, candidate.id);
    return mapCandidate(readRow(db, "channel_source_candidates", candidate.id)!);
  });
}

export function claimProductionRunLease(input: {
  runId: string;
  owner: string;
  leaseMs: number;
  now?: string | null;
}): { run: ProductionRunRecord; leaseToken: string } | null {
  return runInTransaction((db) => {
    const run = requireRun(db, requiredText(input.runId, "runId", 64));
    if (RUN_TERMINAL_STATES.has(run.status)) return null;
    const stamp = input.now ?? nowIso();
    if (run.leaseExpiresAt && run.leaseExpiresAt > stamp) return null;
    const token = newId();
    const result = db.prepare(`UPDATE production_runs SET lease_owner = ?, lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`)
      .run(requiredText(input.owner, "owner", 160), token, leaseExpiry(stamp, input.leaseMs), stamp, run.id, stamp);
    if (Number(result.changes) !== 1) return null;
    return { run: requireRun(db, run.id), leaseToken: token };
  });
}

export function renewProductionRunLease(input: {
  runId: string;
  leaseToken: string;
  leaseMs: number;
  now?: string | null;
}): ProductionRunRecord {
  return runInTransaction((db) => {
    const stamp = input.now ?? nowIso();
    const result = db.prepare(`UPDATE production_runs SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND lease_token = ? AND lease_expires_at > ?`)
      .run(leaseExpiry(stamp, input.leaseMs), stamp, requiredText(input.runId, "runId", 64),
        requiredText(input.leaseToken, "leaseToken", 64), stamp);
    if (Number(result.changes) !== 1) fail("lease_conflict", "Production run lease is missing, expired, or owned elsewhere.");
    return requireRun(db, input.runId);
  });
}

export function releaseProductionRunLease(input: { runId: string; leaseToken: string }): ProductionRunRecord {
  return runInTransaction((db) => {
    const result = db.prepare(`UPDATE production_runs SET lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      updated_at = ? WHERE id = ? AND lease_token = ?`)
      .run(nowIso(), requiredText(input.runId, "runId", 64), requiredText(input.leaseToken, "leaseToken", 64));
    if (Number(result.changes) !== 1) fail("lease_conflict", "Production run lease token does not match.");
    return requireRun(db, input.runId);
  });
}

export function claimProductionItemLease(input: {
  itemId: string;
  owner: string;
  leaseMs: number;
  now?: string | null;
}): { item: ProductionItemRecord; leaseToken: string } | null {
  return runInTransaction((db) => {
    const item = requireItem(db, requiredText(input.itemId, "itemId", 64));
    if (ITEM_LEASE_TERMINAL_STATES.has(item.state) || item.state === "cancel_requested") return null;
    const stamp = input.now ?? nowIso();
    if (item.leaseExpiresAt && item.leaseExpiresAt > stamp) return null;
    const token = newId();
    const result = db.prepare(`UPDATE production_items SET lease_owner = ?, lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`)
      .run(requiredText(input.owner, "owner", 160), token, leaseExpiry(stamp, input.leaseMs), stamp, item.id, stamp);
    if (Number(result.changes) !== 1) return null;
    return { item: requireItem(db, item.id), leaseToken: token };
  });
}

export function renewProductionItemLease(input: {
  itemId: string;
  leaseToken: string;
  leaseMs: number;
  now?: string | null;
}): ProductionItemRecord {
  return runInTransaction((db) => {
    const stamp = input.now ?? nowIso();
    const result = db.prepare(`UPDATE production_items SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND lease_token = ? AND lease_expires_at > ?`)
      .run(leaseExpiry(stamp, input.leaseMs), stamp, requiredText(input.itemId, "itemId", 64),
        requiredText(input.leaseToken, "leaseToken", 64), stamp);
    if (Number(result.changes) !== 1) fail("lease_conflict", "Production item lease is missing, expired, or owned elsewhere.");
    return requireItem(db, input.itemId);
  });
}

export function releaseProductionItemLease(input: { itemId: string; leaseToken: string }): ProductionItemRecord {
  return runInTransaction((db) => {
    const result = db.prepare(`UPDATE production_items SET lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      updated_at = ? WHERE id = ? AND lease_token = ?`)
      .run(nowIso(), requiredText(input.itemId, "itemId", 64), requiredText(input.leaseToken, "leaseToken", 64));
    if (Number(result.changes) !== 1) fail("lease_conflict", "Production item lease token does not match.");
    return requireItem(db, input.itemId);
  });
}

export type ProductionDeadLetterClassification = Readonly<{
  code: "outbox_policy_blocked" | "outbox_retry_exhausted";
  itemState: "policy_blocked" | "failed";
  channelStatus: "blocked" | "failed";
  message: string;
}>;

export function classifyProductionOutboxDeadLetter(input: {
  eventKind: string;
  error?: string | null;
}): ProductionDeadLetterClassification {
  const error = optionalText(input.error, 2000) ?? "Outbox retry budget exhausted without a recorded error.";
  const policyBlocked = /(?:oauth|credential|permission|forbidden|unauthorized|access denied|policy ambiguity|\b401\b|\b403\b)/i
    .test(error);
  if (policyBlocked) {
    return {
      code: "outbox_policy_blocked",
      itemState: "policy_blocked",
      channelStatus: "blocked",
      message: `${requiredText(input.eventKind, "eventKind", 160)} exhausted retries: ${error}`.slice(0, 2000)
    };
  }
  return {
    code: "outbox_retry_exhausted",
    itemState: "failed",
    channelStatus: "failed",
    message: `${requiredText(input.eventKind, "eventKind", 160)} exhausted retries: ${error}`.slice(0, 2000)
  };
}

function projectDeadProductionOutboxTx(db: DatabaseSync, outboxId: string, stamp: string): void {
  const row = readRow(db, "production_outbox", outboxId);
  if (!row) fail("not_found", "Dead outbox record not found.", { outboxId });
  const outbox = mapOutbox(row);
  if (outbox.status !== "dead" || outbox.projectedAt) return;
  let item = requireItem(db, outbox.productionItemId);
  if (
    outbox.eventKind === "production.item.cancel_requested" &&
    (item.state === "cancel_requested" || item.state === "upload_outcome_unknown")
  ) {
    const message = `${outbox.eventKind} exhausted one polling window: ${outbox.lastError ?? "external upload outcome is still unresolved"}`
      .slice(0, 2000);
    const result = db.prepare(`UPDATE production_items SET version = version + 1, last_error = ?, updated_at = ?
      WHERE id = ? AND version = ? AND state IN ('cancel_requested', 'upload_outcome_unknown')`)
      .run(message, stamp, item.id, item.version);
    if (Number(result.changes) !== 1) {
      fail("stale_version", "Cancellation reconciliation item changed before dead-letter projection.", {
        itemId: item.id,
        outboxId: outbox.id
      });
    }
    appendEventTx(db, {
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventType: "production.item.cancel_reconciliation_continues",
      fromState: item.state,
      toState: item.state,
      payload: { outboxId: outbox.id, dedupeKey: outbox.dedupeKey },
      createdAt: stamp
    });
    appendOutboxTx(db, {
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "production.item.cancel_requested",
      dedupeKey: `production.item.cancel_requested:reconcile:${outbox.id}`,
      payload: { predecessorOutboxId: outbox.id },
      availableAt: new Date(new Date(stamp).getTime() + 5 * 60_000).toISOString(),
      maxAttempts: 12
    }, stamp);
    db.prepare(`UPDATE production_outbox SET dead_letter_code = ?, projected_at = ?, updated_at = ?
      WHERE id = ? AND status = 'dead' AND projected_at IS NULL`)
      .run("cancel_reconciliation_continues", stamp, stamp, outbox.id);
    return;
  }
  const publicVerificationDeadlineAt = resolveProductionPublicVerificationDeadlineAt(outbox);
  const publicVerificationDeadlineMs = publicVerificationDeadlineAt
    ? Date.parse(publicVerificationDeadlineAt)
    : Number.NaN;
  const stampMs = Date.parse(stamp);
  const payloadPublicationId = typeof outbox.payload.publicationId === "string"
    ? outbox.payload.publicationId.trim()
    : "";
  const payloadYoutubeVideoId = typeof outbox.payload.youtubeVideoId === "string"
    ? outbox.payload.youtubeVideoId.trim()
    : "";
  const publicVerificationCanContinue =
    outbox.eventKind === "public_verify.requested" &&
    ["publication_scheduled", "upload_outcome_unknown", "cancel_requested"].includes(item.state) &&
    Boolean(publicVerificationDeadlineAt) &&
    Number.isFinite(stampMs) &&
    stampMs < publicVerificationDeadlineMs &&
    Boolean(item.publicationId) &&
    Boolean(item.youtubeVideoId) &&
    payloadPublicationId === item.publicationId &&
    payloadYoutubeVideoId === item.youtubeVideoId;
  if (publicVerificationCanContinue) {
    // A polling-window dead letter is not a failed upload. Requeue only the
    // frozen verification intent; never reopen publication.requested.
    appendEventTx(db, {
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventType: "production.item.public_verification_continues",
      fromState: item.state,
      toState: item.state,
      payload: {
        outboxId: outbox.id,
        dedupeKey: outbox.dedupeKey,
        publicationId: item.publicationId,
        youtubeVideoId: item.youtubeVideoId,
        publicVerificationDeadlineAt,
        lastError: outbox.lastError
      },
      createdAt: stamp
    });
    appendOutboxTx(db, {
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventKind: "public_verify.requested",
      dedupeKey: `public_verify.requested:continue:${outbox.id}`,
      payload: {
        ...outbox.payload,
        publicationId: item.publicationId,
        youtubeVideoId: item.youtubeVideoId,
        publicVerificationDeadlineAt,
        predecessorOutboxId: outbox.id
      },
      availableAt: new Date(Math.min(
        stampMs + PRODUCTION_PUBLIC_VERIFICATION_CONTINUATION_DELAY_MS,
        publicVerificationDeadlineMs
      )).toISOString(),
      maxAttempts: outbox.maxAttempts
    }, stamp);
    db.prepare(`UPDATE production_outbox SET dead_letter_code = ?, projected_at = ?, updated_at = ?
      WHERE id = ? AND status = 'dead' AND projected_at IS NULL`)
      .run("public_verification_continues", stamp, stamp, outbox.id);
    return;
  }
  const classification = classifyProductionOutboxDeadLetter({
    eventKind: outbox.eventKind,
    error: outbox.lastError
  });
  item = requireItem(db, outbox.productionItemId);
  const shouldProjectItem = !ITEM_LEASE_TERMINAL_STATES.has(item.state);
  if (shouldProjectItem) {
    item = applyProductionItemTransitionTx(db, {
      itemId: item.id,
      expectedVersion: item.version,
      toState: classification.itemState,
      eventType: "production.item.outbox_dead_lettered",
      eventPayload: {
        outboxId: outbox.id,
        eventKind: outbox.eventKind,
        dedupeKey: outbox.dedupeKey,
        classificationCode: classification.code
      },
      patch: { lastError: classification.message }
    }, stamp);
  }

  const itemRequiresChannelProjection =
    shouldProjectItem || item.state === "failed" || item.state === "policy_blocked";
  if (itemRequiresChannelProjection) {
    const channel = requireRunChannel(db, item.runChannelId);
    if (!RUN_TERMINAL_STATES.has(channel.status)) {
      const channelStatus = PRODUCTION_RUN_TRANSITIONS[channel.status].includes(classification.channelStatus)
        ? classification.channelStatus
        : "failed";
      const result = db.prepare(`UPDATE production_run_channels SET status = ?, blocker_code = ?,
        blocker_message = ?, version = version + 1, updated_at = ?, completed_at = ?
        WHERE id = ? AND version = ?`)
        .run(channelStatus, classification.code, classification.message, stamp, stamp, channel.id, channel.version);
      if (Number(result.changes) !== 1) {
        fail("stale_version", "Production run channel changed before dead-letter projection.", {
          runChannelId: channel.id
        });
      }
      appendEventTx(db, {
        workspaceId: channel.workspaceId,
        runId: channel.runId,
        channelId: channel.channelId,
        eventType: "production.channel.outbox_dead_lettered",
        fromState: channel.status,
        toState: channelStatus,
        payload: {
          outboxId: outbox.id,
          productionItemId: item.id,
          classificationCode: classification.code
        },
        createdAt: stamp
      });
    }
  }
  db.prepare(`UPDATE production_outbox SET dead_letter_code = ?, projected_at = ?, updated_at = ?
    WHERE id = ? AND status = 'dead' AND projected_at IS NULL`)
    .run(classification.code, stamp, stamp, outbox.id);
}

export function requeueProductionItemRevision(input: {
  itemId: string;
  expectedItemVersion: number;
  outboxId: string;
  reason: string;
  now?: string | null;
}): { item: ProductionItemRecord; outbox: ProductionOutboxRecord; requeued: boolean } {
  return runInTransaction((db) => {
    const item = requireItem(db, requiredText(input.itemId, "itemId", 64));
    if (item.version !== input.expectedItemVersion) {
      fail("stale_version", "Production item version is stale.", {
        expected: input.expectedItemVersion,
        actual: item.version
      });
    }
    if (item.state !== "rework" || !item.resumeState) {
      fail("invalid_transition", "Only an item still in rework can requeue its revision intent.", {
        itemId: item.id,
        state: item.state
      });
    }
    const row = readRow(db, "production_outbox", requiredText(input.outboxId, "outboxId", 64));
    if (!row) fail("not_found", "Revision outbox record not found.", { outboxId: input.outboxId });
    let outbox = mapOutbox(row);
    if (outbox.productionItemId !== item.id || outbox.eventKind !== "revision.requested") {
      fail("invalid_input", "Owner retry must reuse this item's exact revision intent.", {
        itemId: item.id,
        outboxId: outbox.id,
        eventKind: outbox.eventKind
      });
    }
    if (outbox.status === "pending" || outbox.status === "processing") {
      return { item, outbox, requeued: false };
    }
    if (outbox.status === "dead" && outbox.projectedAt) {
      fail("invalid_transition", "A projected dead revision must use item replacement, not state resurrection.", {
        itemId: item.id,
        outboxId: outbox.id,
        deadLetterCode: outbox.deadLetterCode
      });
    }
    const stamp = input.now ?? nowIso();
    const result = db.prepare(`UPDATE production_outbox SET status = 'pending', attempts = 0,
      available_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      last_error = NULL, dead_letter_code = NULL, projected_at = NULL, delivered_at = NULL, updated_at = ?
      WHERE id = ? AND (status = 'delivered' OR (status = 'dead' AND projected_at IS NULL))`)
      .run(stamp, stamp, outbox.id);
    if (Number(result.changes) !== 1) {
      fail("stale_version", "Revision outbox changed before owner requeue.", { outboxId: outbox.id });
    }
    appendEventTx(db, {
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventType: "production.item.owner_retry_requeued",
      fromState: item.state,
      toState: item.state,
      payload: {
        reason: requiredText(input.reason, "reason", 2000),
        outboxId: outbox.id,
        dedupeKey: outbox.dedupeKey,
        previousStatus: outbox.status,
        previousAttempts: outbox.attempts
      },
      createdAt: stamp
    });
    outbox = mapOutbox(readRow(db, "production_outbox", outbox.id)!);
    return { item: requireItem(db, item.id), outbox, requeued: true };
  });
}

export type ProductionOutboxDaemonFence = Readonly<{
  daemonId: string;
  daemonLeaseToken: string;
  dispatchToken: string;
  configSha256?: string | null;
}>;

function assertProductionOutboxDaemonFenceTx(
  db: DatabaseSync,
  workspaceId: string,
  fence: ProductionOutboxDaemonFence,
  stamp: string
): void {
  const configSha256 = fence.configSha256
    ? sha256(fence.configSha256, "daemonFence.configSha256")
    : null;
  const row = db.prepare(`SELECT 1 AS active FROM production_daemon_runtime
    WHERE workspace_id = ? AND daemon_id = ?
      AND lease_token = ? AND lease_expires_at > ? AND status = 'running'
      AND dispatch_token = ? AND dispatch_expires_at > ?
      AND (? IS NULL OR config_sha256 = ?)
    LIMIT 1`).get(
      workspaceId,
      requiredText(fence.daemonId, "daemonFence.daemonId", 160),
      requiredText(fence.daemonLeaseToken, "daemonFence.daemonLeaseToken", 64),
      stamp,
      requiredText(fence.dispatchToken, "daemonFence.dispatchToken", 64),
      stamp,
      configSha256,
      configSha256
    ) as { active?: number } | undefined;
  if (row?.active !== 1) {
    fail("lease_conflict", "Portfolio daemon/dispatch fence is missing, expired, or owned elsewhere.");
  }
}

function countProcessingLaneTx(
  db: DatabaseSync,
  workspaceId: string,
  eventKinds: readonly string[],
  channelId?: string | null
): number {
  const params: string[] = [workspaceId, ...eventKinds];
  const channelSql = channelId ? " AND channel_id = ?" : "";
  if (channelId) params.push(channelId);
  const row = db.prepare(`SELECT COUNT(*) AS count FROM production_outbox
    WHERE workspace_id = ? AND status = 'processing'
      AND event_kind IN (${eventKinds.map(() => "?").join(", ")})${channelSql}`)
    .get(...params) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function hasDurableOutboxCapacityTx(db: DatabaseSync, record: ProductionOutboxRecord): boolean {
  switch (classifyPortfolioDurableResourceLane(record.eventKind)) {
    case "source_ingest": {
      const profile = db.prepare(`SELECT profile_id FROM production_run_channels
        WHERE run_id = ? AND channel_id = ? LIMIT 1`)
        .get(record.runId, record.channelId) as { profile_id?: string } | undefined;
      if (!profile?.profile_id) return false;
      const row = db.prepare(`SELECT COUNT(*) AS count
        FROM production_outbox po
        JOIN production_run_channels prc
          ON prc.run_id = po.run_id AND prc.channel_id = po.channel_id
        WHERE po.workspace_id = ? AND po.status = 'processing'
          AND po.event_kind = 'source_ingest.requested'
          AND po.channel_id = ? AND prc.profile_id = ?`)
        .get(record.workspaceId, record.channelId, profile.profile_id) as { count?: number } | undefined;
      return Number(row?.count ?? 0) < PORTFOLIO_RESOURCE_LIMITS.sourceIngestPerProfileChannel;
    }
    case "semantic_model":
      return countProcessingLaneTx(
        db,
        record.workspaceId,
        PORTFOLIO_DURABLE_LANE_EVENT_KINDS.semanticModel
      ) < PORTFOLIO_RESOURCE_LIMITS.semanticModelGlobal;
    case "render":
      return countProcessingLaneTx(
        db,
        record.workspaceId,
        PORTFOLIO_DURABLE_LANE_EVENT_KINDS.render
      ) < PORTFOLIO_RESOURCE_LIMITS.renderGlobal;
    case "publication":
      return countProcessingLaneTx(
        db,
        record.workspaceId,
        PORTFOLIO_DURABLE_LANE_EVENT_KINDS.publication
      ) < PORTFOLIO_RESOURCE_LIMITS.publicationGlobal &&
        countProcessingLaneTx(
          db,
          record.workspaceId,
          PORTFOLIO_DURABLE_LANE_EVENT_KINDS.publication,
          record.channelId
        ) < PORTFOLIO_RESOURCE_LIMITS.publicationPerChannel;
    case "public_verification":
    case "unclassified":
      return true;
  }
}

export function claimProductionOutbox(input: {
  owner: string;
  leaseMs: number;
  limit?: number | null;
  workspaceId?: string | null;
  runIds?: string[] | null;
  daemonFence?: ProductionOutboxDaemonFence | null;
  now?: string | null;
}): ProductionOutboxRecord[] {
  return runInTransaction((db) => {
    const stamp = input.now ?? nowIso();
    const owner = requiredText(input.owner, "owner", 160);
    const limit = Math.min(100, positiveInteger(input.limit ?? 10, "limit"));
    const scopeClauses: string[] = [];
    const scopeParams: string[] = [];
    if (input.workspaceId) {
      scopeClauses.push("workspace_id = ?");
      scopeParams.push(requiredText(input.workspaceId, "workspaceId", 64));
    }
    const fencedWorkspaceId = input.workspaceId
      ? requiredText(input.workspaceId, "workspaceId", 64)
      : null;
    if (input.daemonFence && !fencedWorkspaceId) {
      fail("invalid_input", "A daemon-fenced outbox claim requires workspaceId.");
    }
    if (input.daemonFence && fencedWorkspaceId) {
      assertProductionOutboxDaemonFenceTx(db, fencedWorkspaceId, input.daemonFence, stamp);
    }
    if (input.runIds) {
      const runIds = [...new Set(input.runIds.map((runId) => requiredText(runId, "runId", 64)))];
      if (runIds.length === 0) return [];
      scopeClauses.push(`run_id IN (${runIds.map(() => "?").join(", ")})`);
      scopeParams.push(...runIds);
    }
    const scopeSql = scopeClauses.length ? ` AND ${scopeClauses.join(" AND ")}` : "";
    const claimableChannelSql = ` AND (event_kind = 'production.item.public_verified' OR EXISTS (
      SELECT 1 FROM production_run_channels AS claimable_channel
      WHERE claimable_channel.run_id = production_outbox.run_id
        AND claimable_channel.channel_id = production_outbox.channel_id
        AND claimable_channel.status NOT IN ('completed', 'blocked', 'canceled', 'failed')
    ))`;
    const expiredRows = db.prepare(`SELECT * FROM production_outbox
      WHERE status = 'processing' AND lease_expires_at <= ?${scopeSql}
      ORDER BY created_at ASC, id ASC`).all(stamp, ...scopeParams) as Row[];
    for (const expiredRow of expiredRows) {
      const expired = mapOutbox(expiredRow);
      const terminal = expired.attempts >= expired.maxAttempts ||
        productionPublicVerificationDeadlineReached(expired, stamp);
      db.prepare(`UPDATE production_outbox SET status = ?, lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, last_error = CASE WHEN ? THEN COALESCE(last_error, ?) ELSE last_error END,
        updated_at = ? WHERE id = ? AND status = 'processing'`)
        .run(
          terminal ? "dead" : "pending",
          terminal ? 1 : 0,
          "Outbox lease expired after the retry budget was exhausted.",
          stamp,
          expired.id
        );
      if (terminal) projectDeadProductionOutboxTx(db, expired.id, stamp);
    }
    const rows = db.prepare(`SELECT * FROM production_outbox
      WHERE status = 'pending' AND available_at <= ? AND attempts < max_attempts${scopeSql}${claimableChannelSql}
      ORDER BY available_at ASC, created_at ASC, channel_id ASC,
        COALESCE((SELECT item_slot FROM production_items
          WHERE production_items.id = production_outbox.production_item_id), 0) ASC,
        COALESCE((SELECT generation FROM production_items
          WHERE production_items.id = production_outbox.production_item_id), 0) ASC,
        event_kind ASC, id ASC LIMIT 1000`)
      .all(stamp, ...scopeParams) as Row[];
    const claimed: ProductionOutboxRecord[] = [];
    for (const row of rows) {
      if (claimed.length >= limit) break;
      const record = mapOutbox(row);
      if (!hasDurableOutboxCapacityTx(db, record)) continue;
      if (input.daemonFence && fencedWorkspaceId) {
        assertProductionOutboxDaemonFenceTx(db, fencedWorkspaceId, input.daemonFence, stamp);
      }
      const token = newId();
      const result = db.prepare(`UPDATE production_outbox SET status = 'processing', attempts = attempts + 1,
        lease_owner = ?, lease_token = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending' AND attempts < max_attempts`)
        .run(owner, token, leaseExpiry(stamp, input.leaseMs), stamp, record.id);
      if (Number(result.changes) === 1) {
        claimed.push(mapOutbox(readRow(db, "production_outbox", record.id)!));
      }
    }
    return claimed;
  });
}

export function renewProductionOutboxLease(input: {
  outboxId: string;
  leaseToken: string;
  leaseMs: number;
  daemonFence?: ProductionOutboxDaemonFence | null;
  now?: string | null;
}): ProductionOutboxRecord {
  return runInTransaction((db) => {
    const stamp = input.now ?? nowIso();
    const row = readRow(db, "production_outbox", requiredText(input.outboxId, "outboxId", 64));
    if (!row) fail("not_found", "Outbox record not found.");
    const outbox = mapOutbox(row);
    if (input.daemonFence) {
      assertProductionOutboxDaemonFenceTx(db, outbox.workspaceId, input.daemonFence, stamp);
    }
    const result = db.prepare(`UPDATE production_outbox SET lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'processing' AND lease_token = ? AND lease_expires_at > ?`)
      .run(
        leaseExpiry(stamp, input.leaseMs),
        stamp,
        requiredText(input.outboxId, "outboxId", 64),
        requiredText(input.leaseToken, "leaseToken", 64),
        stamp
      );
    if (Number(result.changes) !== 1) {
      fail("lease_conflict", "Outbox lease is missing, expired, or owned elsewhere.");
    }
    return mapOutbox(readRow(db, "production_outbox", input.outboxId)!);
  });
}

export function getNextProductionOutboxWakeAt(input: {
  workspaceId?: string | null;
  runIds?: string[] | null;
} = {}): string | null {
  const clauses = [`((status = 'pending' AND attempts < max_attempts AND
    (event_kind = 'production.item.public_verified' OR EXISTS (
    SELECT 1 FROM production_run_channels AS claimable_channel
    WHERE claimable_channel.run_id = production_outbox.run_id
      AND claimable_channel.channel_id = production_outbox.channel_id
      AND claimable_channel.status NOT IN ('completed', 'blocked', 'canceled', 'failed')
  ))) OR status = 'processing')`];
  const params: string[] = [];
  if (input.workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(requiredText(input.workspaceId, "workspaceId", 64));
  }
  if (input.runIds) {
    const runIds = [...new Set(input.runIds.map((runId) => requiredText(runId, "runId", 64)))];
    if (runIds.length === 0) return null;
    clauses.push(`run_id IN (${runIds.map(() => "?").join(", ")})`);
    params.push(...runIds);
  }
  const row = getDb().prepare(`SELECT MIN(
      CASE WHEN status = 'processing' THEN lease_expires_at ELSE available_at END
    ) AS wake_at FROM production_outbox WHERE ${clauses.join(" AND ")}`)
    .get(...params) as { wake_at?: string | null } | undefined;
  return row?.wake_at ? String(row.wake_at) : null;
}

export function listProductionOutbox(input: {
  runId: string;
  productionItemId?: string | null;
  status?: ProductionOutboxStatus | null;
}): ProductionOutboxRecord[] {
  const clauses = ["run_id = ?"];
  const params = [requiredText(input.runId, "runId", 64)];
  if (input.productionItemId) {
    clauses.push("production_item_id = ?");
    params.push(requiredText(input.productionItemId, "productionItemId", 64));
  }
  if (input.status) {
    clauses.push("status = ?");
    params.push(input.status);
  }
  return (getDb().prepare(`SELECT * FROM production_outbox WHERE ${clauses.join(" AND ")}
    ORDER BY created_at ASC, id ASC`).all(...params) as Row[]).map(mapOutbox);
}

export function ackProductionOutbox(input: {
  outboxId: string;
  leaseToken: string;
  daemonFence?: ProductionOutboxDaemonFence | null;
  now?: string | null;
}): ProductionOutboxRecord {
  return runInTransaction((db) => {
    const stamp = input.now ?? nowIso();
    const row = readRow(db, "production_outbox", requiredText(input.outboxId, "outboxId", 64));
    if (!row) fail("not_found", "Outbox record not found.");
    const outbox = mapOutbox(row);
    if (input.daemonFence) {
      assertProductionOutboxDaemonFenceTx(db, outbox.workspaceId, input.daemonFence, stamp);
    }
    const result = db.prepare(`UPDATE production_outbox SET status = 'delivered', delivered_at = ?,
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = ?
      WHERE id = ? AND status = 'processing' AND lease_token = ?`)
      .run(stamp, stamp, requiredText(input.outboxId, "outboxId", 64), requiredText(input.leaseToken, "leaseToken", 64));
    if (Number(result.changes) !== 1) fail("lease_conflict", "Outbox lease token does not match an active claim.");
    return mapOutbox(readRow(db, "production_outbox", input.outboxId)!);
  });
}

/**
 * A handler may finish the immutable replacement decision and create the next
 * generation before a later, recoverable step fails. Retrying the old event
 * against the terminal generation can never succeed. This atomic fence closes
 * that exact old intent only when a newer generation for the same logical slot
 * already exists; otherwise the original error still follows the normal retry
 * and dead-letter path.
 */
export function ackProductionOutboxAsSupersededGeneration(input: {
  outboxId: string;
  leaseToken: string;
  handlerError: string;
  now?: string | null;
}): { outbox: ProductionOutboxRecord; replacementItem: ProductionItemRecord } | null {
  return runInTransaction((db) => {
    const outboxId = requiredText(input.outboxId, "outboxId", 64);
    const leaseToken = requiredText(input.leaseToken, "leaseToken", 64);
    const row = readRow(db, "production_outbox", outboxId);
    if (!row) fail("not_found", "Outbox record not found.");
    const outbox = mapOutbox(row);
    if (outbox.status !== "processing" || outbox.leaseToken !== leaseToken) {
      fail("lease_conflict", "Outbox lease token does not match an active claim.");
    }
    const item = requireItem(db, outbox.productionItemId);
    if (!REPLACEABLE_ITEM_STATES.has(item.state)) return null;
    const replacementRow = db.prepare(`SELECT * FROM production_items
      WHERE run_channel_id = ? AND item_slot = ? AND generation > ?
      ORDER BY generation DESC LIMIT 1`)
      .get(item.runChannelId, item.itemSlot, item.generation) as Row | undefined;
    if (!replacementRow) return null;
    const replacementItem = mapItem(replacementRow);
    const stamp = input.now ?? nowIso();
    const result = db.prepare(`UPDATE production_outbox SET status = 'delivered', delivered_at = ?,
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = NULL,
      updated_at = ? WHERE id = ? AND status = 'processing' AND lease_token = ?`)
      .run(stamp, stamp, outbox.id, leaseToken);
    if (Number(result.changes) !== 1) {
      fail("lease_conflict", "Outbox changed before its superseded-generation acknowledgement.");
    }
    appendEventTx(db, {
      workspaceId: item.workspaceId,
      runId: item.runId,
      channelId: item.channelId,
      productionItemId: item.id,
      eventType: "production.outbox.superseded_by_generation",
      fromState: item.state,
      toState: item.state,
      payload: {
        outboxId: outbox.id,
        eventKind: outbox.eventKind,
        failedGeneration: item.generation,
        replacementItemId: replacementItem.id,
        replacementGeneration: replacementItem.generation,
        handlerError: requiredText(input.handlerError, "handlerError", 2000)
      },
      createdAt: stamp
    });
    return {
      outbox: mapOutbox(readRow(db, "production_outbox", outbox.id)!),
      replacementItem
    };
  });
}

export function retryProductionOutbox(input: {
  outboxId: string;
  leaseToken: string;
  error: string;
  daemonFence?: ProductionOutboxDaemonFence | null;
  availableAt?: string | null;
  now?: string | null;
}): ProductionOutboxRecord {
  return runInTransaction((db) => {
    const row = readRow(db, "production_outbox", requiredText(input.outboxId, "outboxId", 64));
    if (!row) fail("not_found", "Outbox record not found.");
    const record = mapOutbox(row);
    const stamp = input.now ?? nowIso();
    if (input.daemonFence) {
      assertProductionOutboxDaemonFenceTx(db, record.workspaceId, input.daemonFence, stamp);
    }
    if (record.status !== "processing" || record.leaseToken !== input.leaseToken) {
      fail("lease_conflict", "Outbox lease token does not match an active claim.");
    }
    const terminal = record.attempts >= record.maxAttempts ||
      productionPublicVerificationDeadlineReached(record, stamp);
    const requestedAvailableAt = input.availableAt ?? stamp;
    const publicVerificationDeadlineAt = resolveProductionPublicVerificationDeadlineAt(record);
    const requestedAvailableAtMs = Date.parse(requestedAvailableAt);
    const retryAvailableAt = !terminal &&
      publicVerificationDeadlineAt &&
      Number.isFinite(requestedAvailableAtMs) &&
      requestedAvailableAtMs > Date.parse(publicVerificationDeadlineAt)
      ? publicVerificationDeadlineAt
      : requestedAvailableAt;
    db.prepare(`UPDATE production_outbox SET status = ?, available_at = ?, lease_owner = NULL,
      lease_token = NULL, lease_expires_at = NULL, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(terminal ? "dead" : "pending", retryAvailableAt,
        requiredText(input.error, "error", 2000), stamp, record.id);
    if (terminal) projectDeadProductionOutboxTx(db, record.id, stamp);
    return mapOutbox(readRow(db, "production_outbox", record.id)!);
  });
}

export type RecordAgentAttemptInput = {
  workspaceId: string;
  runId: string;
  productionItemId: string;
  stage3JobId?: string | null;
  role: string;
  attemptNo: number;
  model: string;
  reasoningLevel: string;
  promptHash: string;
  qualityBindingSha256?: string | null;
  outputHash?: string | null;
  artifactIds?: string[] | null;
  status: AgentAttemptRecord["status"];
  outcome?: string | null;
  verdict?: string | null;
  errorCode?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningOutputTokens?: number | null;
  costMicros?: number | null;
  costUnit?: "usd" | "codex_credits" | null;
  durationMs?: number | null;
  startedAt: string;
  finishedAt?: string | null;
};

function nullableNonNegativeInteger(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) fail("invalid_input", `${field} must be a non-negative integer.`, { field, value });
  return value;
}

export function recordAgentAttempt(input: RecordAgentAttemptInput): AgentAttemptRecord {
  return runInTransaction((db) => {
    const item = requireItem(db, requiredText(input.productionItemId, "productionItemId", 64));
    if (item.workspaceId !== input.workspaceId || item.runId !== input.runId) {
      fail("invalid_input", "Agent attempt does not match its production item scope.");
    }
    const role = requiredText(input.role, "role", 120);
    const stage3JobId = input.stage3JobId ? requiredText(input.stage3JobId, "stage3JobId", 64) : null;
    const attemptNo = positiveInteger(input.attemptNo, "attemptNo");
    const existingRow = db.prepare(`SELECT * FROM agent_attempts
      WHERE production_item_id = ? AND role = ? AND attempt_no = ? LIMIT 1`)
      .get(item.id, role, attemptNo) as Row | undefined;
    const model = requiredText(input.model, "model", 160);
    const reasoningLevel = requiredText(input.reasoningLevel, "reasoningLevel", 80);
    const promptHash = sha256(input.promptHash, "promptHash")!;
    const qualityBindingSha256 = sha256(input.qualityBindingSha256, "qualityBindingSha256", true);
    const outputHash = sha256(input.outputHash, "outputHash", true);
    const artifactIds = [...new Set(input.artifactIds ?? [])].map((id) => requiredText(id, "artifactId", 160));
    const inputTokens = nullableNonNegativeInteger(input.inputTokens, "inputTokens");
    const outputTokens = nullableNonNegativeInteger(input.outputTokens, "outputTokens");
    const cachedInputTokens = nullableNonNegativeInteger(input.cachedInputTokens, "cachedInputTokens");
    const reasoningOutputTokens = nullableNonNegativeInteger(input.reasoningOutputTokens, "reasoningOutputTokens");
    const costMicros = nullableNonNegativeInteger(input.costMicros, "costMicros");
    const costUnit = input.costUnit ?? null;
    if (costUnit !== null && costUnit !== "usd" && costUnit !== "codex_credits") {
      fail("invalid_input", "costUnit must be usd or codex_credits.", { costUnit });
    }
    if ((costMicros === null) !== (costUnit === null)) {
      fail("invalid_input", "costMicros and costUnit must be supplied together.");
    }
    const durationMs = nullableNonNegativeInteger(input.durationMs, "durationMs");
    const outcome = optionalText(input.outcome, 1000);
    const verdict = optionalText(input.verdict, 160);
    const errorCode = optionalText(input.errorCode, 160);
    const startedAt = requiredText(input.startedAt, "startedAt", 64);
    const finishedAt = input.finishedAt ? requiredText(input.finishedAt, "finishedAt", 64) : null;
    if (stage3JobId) {
      const semanticJob = db.prepare(
        `SELECT workspace_id, user_id, kind, status, payload_json, result_json
           FROM stage3_jobs WHERE id = ? LIMIT 1`
      ).get(stage3JobId) as Row | undefined;
      if (!semanticJob || semanticJob.workspace_id !== item.workspaceId || semanticJob.kind !== "production-semantic" ||
          semanticJob.status !== "completed" || typeof semanticJob.result_json !== "string") {
        fail("invalid_input", "stage3JobId must reference a completed production-semantic job in the same workspace.");
      }
      try {
        const semanticPayload = parseProductionSemanticJobPayloadJson(String(semanticJob.payload_json));
        const semanticResult = parseProductionSemanticJobResultJson(String(semanticJob.result_json), semanticPayload);
        if (semanticPayload.runId !== item.runId || semanticPayload.itemId !== item.id || semanticPayload.role !== role) {
          fail("invalid_input", "Stage 3 semantic payload does not match the agent attempt scope.");
        }
        if (semanticPayload.qualityBindingSha256 !== qualityBindingSha256) {
          fail("invalid_input", "Stage 3 semantic quality binding does not match the agent attempt.");
        }
        const matchingTelemetry = semanticResult.attempts.filter((attempt) =>
          attempt.role === role &&
          attempt.model === model &&
          attempt.reasoningEffort === reasoningLevel &&
          attempt.promptSha256 === promptHash &&
          attempt.outputSha256 === outputHash
        );
        if (matchingTelemetry.length !== 1) {
          fail("invalid_input", "Stage 3 semantic result does not contain matching attempt telemetry.");
        }
        const exact = matchingTelemetry[0]!;
        const expectedStatus: AgentAttemptRecord["status"] = exact.outcome === "passed" ? "passed" : "failed";
        const expectedVerdict = exact.outcome === "passed" ? "pass" : "fail";
        const expectedError = optionalText(exact.error, 160);
        const expectedFinishedAt = new Date(Date.parse(exact.startedAt) + exact.durationMs).toISOString();
        const expectedCostMicros = exact.provider === "codex" && exact.usage
          ? calculateProjectKingsCodexCreditMicros({ model: exact.model, usage: exact.usage })
          : null;
        const expectedCostUnit = expectedCostMicros === null ? null : "codex_credits";
        const expectedArtifactIds = [...new Set(semanticPayload.packet.artifacts.map((artifact) => artifact.id))].sort();
        if (
          input.status !== expectedStatus ||
          outcome !== exact.outcome ||
          verdict !== expectedVerdict ||
          errorCode !== expectedError ||
          inputTokens !== (exact.usage?.inputTokens ?? null) ||
          outputTokens !== (exact.usage?.outputTokens ?? null) ||
          cachedInputTokens !== (exact.usage?.cachedInputTokens ?? null) ||
          reasoningOutputTokens !== (exact.usage?.reasoningOutputTokens ?? null) ||
          durationMs !== Math.round(exact.durationMs) ||
          startedAt !== exact.startedAt ||
          finishedAt !== expectedFinishedAt ||
          costMicros !== expectedCostMicros ||
          costUnit !== expectedCostUnit ||
          !isDeepStrictEqual([...artifactIds].sort(), expectedArtifactIds) ||
          (exact.outcome === "passed" && exact.routeId !== semanticResult.selectedRouteId)
        ) {
          fail("invalid_input", "Agent attempt metrics do not exactly match the bound Stage 3 telemetry.");
        }
        const duplicateBinding = db.prepare(
          `SELECT id FROM agent_attempts
            WHERE stage3_job_id = ?
              AND role = ?
              AND model = ?
              AND reasoning_level = ?
              AND prompt_hash = ?
              AND output_hash IS ?
              AND outcome = ?
              AND id != ?
            LIMIT 1`
        ).get(
          stage3JobId,
          role,
          model,
          reasoningLevel,
          promptHash,
          outputHash,
          outcome,
          existingRow ? String(existingRow.id) : ""
        ) as Row | undefined;
        if (duplicateBinding) {
          fail("uniqueness_conflict", "This exact Stage 3 attempt telemetry is already recorded.");
        }
      } catch (error) {
        if (error instanceof ProductionStoreError) throw error;
        fail("invalid_input", error instanceof Error ? error.message : "Stage 3 semantic binding is invalid.");
      }
    }
    if (existingRow) {
      const existing = mapAgentAttempt(existingRow);
      if (existing.status !== "running" || input.status === "running" || existing.model !== model ||
          existing.reasoningLevel !== reasoningLevel || existing.promptHash !== promptHash ||
          existing.stage3JobId !== stage3JobId ||
          (existing.qualityBindingSha256 !== null && existing.qualityBindingSha256 !== qualityBindingSha256)) {
        fail("uniqueness_conflict", "Agent attempt is immutable except for running -> terminal completion.", {
          productionItemId: item.id, role, attemptNo
        });
      }
      db.prepare(`UPDATE agent_attempts SET stage3_job_id = ?, quality_binding_sha256 = ?, output_hash = ?, artifact_ids_json = ?, status = ?, outcome = ?, verdict = ?,
        error_code = ?, input_tokens = ?, output_tokens = ?, cached_input_tokens = ?, reasoning_output_tokens = ?,
        cost_micros = ?, cost_unit = ?, duration_ms = ?, finished_at = ? WHERE id = ?`)
        .run(stage3JobId, qualityBindingSha256, outputHash, stringify(artifactIds), input.status, outcome, verdict,
          errorCode, inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens, costMicros, costUnit, durationMs,
          finishedAt ?? nowIso(), existing.id);
      return mapAgentAttempt(readRow(db, "agent_attempts", existing.id)!);
    }
    const id = newId();
    const createdAt = nowIso();
    db.prepare(`INSERT INTO agent_attempts
      (id, workspace_id, run_id, production_item_id, stage3_job_id, role, attempt_no, model, reasoning_level, prompt_hash,
       quality_binding_sha256, output_hash, artifact_ids_json, status, outcome, verdict, error_code, input_tokens, output_tokens,
       cached_input_tokens, reasoning_output_tokens, cost_micros, cost_unit, duration_ms, started_at, finished_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, item.workspaceId, item.runId, item.id, stage3JobId, role, attemptNo, model, reasoningLevel, promptHash, qualityBindingSha256, outputHash,
        stringify(artifactIds), input.status, outcome, verdict,
        errorCode, inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens, costMicros, costUnit, durationMs,
        startedAt, finishedAt, createdAt);
    return mapAgentAttempt(readRow(db, "agent_attempts", id)!);
  });
}

export function listAgentAttempts(input: {
  runId: string;
  productionItemId?: string | null;
}): AgentAttemptRecord[] {
  const clauses = ["run_id = ?"];
  const params = [requiredText(input.runId, "runId", 64)];
  if (input.productionItemId) {
    clauses.push("production_item_id = ?");
    params.push(requiredText(input.productionItemId, "productionItemId", 64));
  }
  return (getDb().prepare(`SELECT * FROM agent_attempts WHERE ${clauses.join(" AND ")}
    ORDER BY created_at ASC, role ASC, attempt_no ASC`).all(...params) as Row[]).map(mapAgentAttempt);
}

export type RecordQualityVerdictInput = {
  workspaceId: string;
  runId: string;
  productionItemId: string;
  gateType: QualityGateType;
  judgeKind: PersistedQualityJudgeKind;
  verdict: QualityVerdictValue;
  attemptNo: number;
  artifactSha256: string;
  sourceSha256?: string | null;
  previewSha256?: string | null;
  templateSha256?: string | null;
  settingsSha256?: string | null;
  agentAttemptId?: string | null;
  evidenceSha256: string;
  evidenceArtifactPath: string;
  defects?: Array<Record<string, unknown>> | null;
};

function normalizeVerdictBindings(input: RecordQualityVerdictInput): {
  artifactSha256: string;
  sourceSha256: string | null;
  previewSha256: string | null;
  templateSha256: string | null;
  settingsSha256: string | null;
} {
  const bindings = {
    artifactSha256: sha256(input.artifactSha256, "artifactSha256")!,
    sourceSha256: sha256(input.sourceSha256, "sourceSha256", true),
    previewSha256: sha256(input.previewSha256, "previewSha256", true),
    templateSha256: sha256(input.templateSha256, "templateSha256", true),
    settingsSha256: sha256(input.settingsSha256, "settingsSha256", true)
  };
  if (!bindings.sourceSha256) fail("invalid_input", "Every quality verdict must bind the exact source hash.");
  if (input.gateType === "source" && bindings.artifactSha256 !== bindings.sourceSha256) {
    fail("invalid_input", "Source verdict artifact hash must equal sourceSha256.");
  }
  if (input.gateType === "preview" &&
      (!bindings.previewSha256 || !bindings.templateSha256 || !bindings.settingsSha256 ||
       bindings.artifactSha256 !== bindings.previewSha256)) {
    fail("invalid_input", "Preview verdict must bind source, preview, template, and settings hashes.");
  }
  if (input.gateType === "final" &&
      (!bindings.previewSha256 || !bindings.templateSha256 || !bindings.settingsSha256)) {
    fail("invalid_input", "Final verdict must bind source, preview, template, settings, and final artifact hashes.");
  }
  return bindings;
}

export function calculateQualityVerdictBindingSha256(input: {
  gateType: QualityGateType;
  artifactSha256: string;
  sourceSha256?: string | null;
  previewSha256?: string | null;
  templateSha256?: string | null;
  settingsSha256?: string | null;
}): string {
  const bindings = normalizeVerdictBindings({
    workspaceId: "binding",
    runId: "binding",
    productionItemId: "binding",
    judgeKind: "deterministic",
    verdict: "pass",
    attemptNo: 1,
    evidenceSha256: "0".repeat(64),
    evidenceArtifactPath: "/binding",
    ...input
  });
  return createHash("sha256").update(canonicalJson({ gateType: input.gateType, ...bindings })).digest("hex");
}

function validatePersistedQualityPrerequisite(
  db: DatabaseSync,
  verdict: QualityVerdictRecord
): boolean {
  if (!verdict.persisted || !verdict.evidenceSha256 || !verdict.evidenceArtifactPath) return false;
  if (verdict.judgeKind === "deterministic") return verdict.agentAttemptId === null;
  if (verdict.judgeKind !== "semantic" && verdict.judgeKind !== "vision") return false;
  if (!verdict.agentAttemptId) return false;
  const row = readRow(db, "agent_attempts", verdict.agentAttemptId);
  if (!row) return false;
  const attempt = mapAgentAttempt(row);
  const expectedRole = verdict.judgeKind === "semantic" ? "source_fit" : "vision_qa";
  const expectedGate = verdict.judgeKind === "semantic" ? "source" : verdict.gateType;
  if (
    verdict.gateType !== expectedGate ||
    attempt.productionItemId !== verdict.productionItemId ||
    attempt.role !== expectedRole ||
    attempt.status !== "passed" ||
    !attempt.outputHash
  ) {
    return false;
  }
  return attempt.qualityBindingSha256 === calculateQualityVerdictBindingSha256(verdict);
}

function findLatestValidQualityPrerequisite(
  db: DatabaseSync,
  input: {
    productionItemId: string;
    gateType: QualityGateType;
    judgeKind: PersistedQualityJudgeKind;
    artifactSha256: string;
    sourceSha256: string | null;
    previewSha256: string | null;
    templateSha256: string | null;
    settingsSha256: string | null;
  }
): QualityVerdictRecord | null {
  const rows = db.prepare(`SELECT * FROM quality_verdicts
    WHERE production_item_id = ? AND gate_type = ? AND judge_kind = ? AND verdict = 'pass'
      AND artifact_sha256 = ? AND source_sha256 IS ? AND preview_sha256 IS ?
      AND template_sha256 IS ? AND settings_sha256 IS ?
    ORDER BY created_at DESC, attempt_no DESC`)
    .all(input.productionItemId, input.gateType, input.judgeKind, input.artifactSha256,
      input.sourceSha256, input.previewSha256, input.templateSha256, input.settingsSha256) as Row[];
  for (const row of rows) {
    const verdict = mapVerdict(row);
    if (validatePersistedQualityPrerequisite(db, verdict)) return verdict;
  }
  return null;
}

function deriveCombinedQualityPass(
  db: DatabaseSync,
  input: {
    productionItemId: string;
    gateType: QualityGateType;
    artifactSha256: string;
    sourceSha256: string | null;
    previewSha256: string | null;
    templateSha256: string | null;
    settingsSha256: string | null;
  }
): QualityVerdictRecord | null {
  const secondKind: PersistedQualityJudgeKind = input.gateType === "source" ? "semantic" : "vision";
  const deterministic = findLatestValidQualityPrerequisite(db, { ...input, judgeKind: "deterministic" });
  const independent = findLatestValidQualityPrerequisite(db, { ...input, judgeKind: secondKind });
  if (!deterministic || !independent) return null;
  const prerequisiteIds = [deterministic.id, independent.id];
  const createdAt = [deterministic.createdAt, independent.createdAt].sort().at(-1)!;
  return {
    id: `derived:${createHash("sha256").update(canonicalJson(prerequisiteIds)).digest("hex")}`,
    workspaceId: deterministic.workspaceId,
    runId: deterministic.runId,
    productionItemId: input.productionItemId,
    gateType: input.gateType,
    judgeKind: "combined",
    verdict: "pass",
    attemptNo: Math.max(deterministic.attemptNo, independent.attemptNo),
    artifactSha256: input.artifactSha256,
    sourceSha256: input.sourceSha256,
    previewSha256: input.previewSha256,
    templateSha256: input.templateSha256,
    settingsSha256: input.settingsSha256,
    agentAttemptId: null,
    evidenceSha256: createHash("sha256").update(canonicalJson({
      prerequisiteIds,
      evidence: [deterministic.evidenceSha256, independent.evidenceSha256]
    })).digest("hex"),
    evidenceArtifactPath: null,
    defects: [],
    persisted: false,
    derivedFromVerdictIds: prerequisiteIds,
    createdAt
  };
}

export function recordQualityVerdict(input: RecordQualityVerdictInput): QualityVerdictRecord {
  return runInTransaction((db) => {
    const item = requireItem(db, requiredText(input.productionItemId, "productionItemId", 64));
    if (item.workspaceId !== input.workspaceId || item.runId !== input.runId) {
      fail("invalid_input", "Quality verdict does not match its production item scope.");
    }
    if (!(["deterministic", "semantic", "vision"] as const).includes(input.judgeKind)) {
      fail("invalid_input", "Combined quality is derived from prerequisites and cannot be recorded directly.");
    }
    const bindings = normalizeVerdictBindings(input);
    const evidenceSha256 = sha256(input.evidenceSha256, "evidenceSha256")!;
    const evidenceArtifactPath = requiredText(input.evidenceArtifactPath, "evidenceArtifactPath", 4096);
    if (input.judgeKind === "semantic" && input.gateType !== "source") {
      fail("invalid_input", "Semantic Source Fit verdicts are only valid for the source gate.");
    }
    if (input.judgeKind === "vision" && input.gateType === "source") {
      fail("invalid_input", "The source gate requires semantic Source Fit, not a synthetic Vision verdict.");
    }
    if (input.judgeKind === "deterministic" && input.agentAttemptId) {
      fail("invalid_input", "Deterministic verdicts must point to saved probe evidence, not an agent attempt.");
    }
    let agentAttemptId: string | null = null;
    if (input.judgeKind !== "deterministic") {
      agentAttemptId = requiredText(input.agentAttemptId, "agentAttemptId", 64);
      const attemptRow = readRow(db, "agent_attempts", agentAttemptId);
      if (!attemptRow || String(attemptRow.production_item_id) !== item.id) {
        fail("invalid_input", "Quality verdict agent attempt belongs to another item.");
      }
      const attempt = mapAgentAttempt(attemptRow);
      const expectedRole = input.judgeKind === "semantic" ? "source_fit" : "vision_qa";
      const expectedBinding = calculateQualityVerdictBindingSha256({ gateType: input.gateType, ...bindings });
      if (attempt.role !== expectedRole || attempt.status !== "passed" || !attempt.outputHash ||
          attempt.qualityBindingSha256 !== expectedBinding) {
        fail("invalid_input", "Quality verdict is not linked to the exact successful semantic agent attempt.", {
          expectedRole,
          attemptId: attempt.id,
          expectedBinding
        });
      }
    }
    const defects = input.defects ?? [];
    if (input.verdict === "pass" && defects.length > 0) {
      fail("invalid_input", "A PASS verdict cannot contain defects.");
    }
    const attemptNo = positiveInteger(input.attemptNo, "attemptNo");
    const existingRow = db.prepare(`SELECT * FROM quality_verdicts
      WHERE production_item_id = ? AND gate_type = ? AND judge_kind = ?
        AND artifact_sha256 = ? AND attempt_no = ? LIMIT 1`)
      .get(item.id, input.gateType, input.judgeKind, bindings.artifactSha256, attemptNo) as Row | undefined;
    if (existingRow) {
      const existing = mapVerdict(existingRow);
      const identical = existing.workspaceId === item.workspaceId && existing.runId === item.runId &&
        existing.verdict === input.verdict && existing.sourceSha256 === bindings.sourceSha256 &&
        existing.previewSha256 === bindings.previewSha256 && existing.templateSha256 === bindings.templateSha256 &&
        existing.settingsSha256 === bindings.settingsSha256 && existing.agentAttemptId === agentAttemptId &&
        existing.evidenceSha256 === evidenceSha256 && existing.evidenceArtifactPath === evidenceArtifactPath &&
        isDeepStrictEqual(existing.defects, defects);
      if (identical) return existing;
      fail("uniqueness_conflict", "This quality verdict attempt already exists with different evidence.");
    }
    const id = newId();
    try {
      db.prepare(`INSERT INTO quality_verdicts
        (id, workspace_id, run_id, production_item_id, gate_type, judge_kind, verdict, attempt_no,
         artifact_sha256, source_sha256, preview_sha256, template_sha256, settings_sha256,
         agent_attempt_id, evidence_sha256, evidence_artifact_path, defects_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, item.workspaceId, item.runId, item.id, input.gateType, input.judgeKind, input.verdict,
          attemptNo, bindings.artifactSha256, bindings.sourceSha256,
          bindings.previewSha256, bindings.templateSha256, bindings.settingsSha256,
          agentAttemptId, evidenceSha256, evidenceArtifactPath, stringify(defects), nowIso());
    } catch (error) {
      if (isConstraintError(error)) fail("uniqueness_conflict", "This exact quality verdict attempt already exists.");
      throw error;
    }
    return mapVerdict(readRow(db, "quality_verdicts", id)!);
  });
}

export function getLatestQualityVerdictForArtifact(input: {
  productionItemId: string;
  gateType: QualityGateType;
  judgeKind: QualityJudgeKind;
  artifactSha256: string;
  sourceSha256?: string | null;
  previewSha256?: string | null;
  templateSha256?: string | null;
  settingsSha256?: string | null;
}): QualityVerdictRecord | null {
  const normalized = {
    productionItemId: requiredText(input.productionItemId, "productionItemId", 64),
    gateType: input.gateType,
    artifactSha256: sha256(input.artifactSha256, "artifactSha256")!,
    sourceSha256: sha256(input.sourceSha256, "sourceSha256", true),
    previewSha256: sha256(input.previewSha256, "previewSha256", true),
    templateSha256: sha256(input.templateSha256, "templateSha256", true),
    settingsSha256: sha256(input.settingsSha256, "settingsSha256", true)
  };
  const db = getDb();
  if (input.judgeKind === "combined") return deriveCombinedQualityPass(db, normalized);
  const row = db.prepare(`SELECT * FROM quality_verdicts
    WHERE production_item_id = ? AND gate_type = ? AND judge_kind = ? AND artifact_sha256 = ?
      AND source_sha256 IS ? AND preview_sha256 IS ? AND template_sha256 IS ? AND settings_sha256 IS ?
    ORDER BY created_at DESC, attempt_no DESC LIMIT 1`)
    .get(normalized.productionItemId, normalized.gateType, input.judgeKind, normalized.artifactSha256,
      normalized.sourceSha256, normalized.previewSha256, normalized.templateSha256, normalized.settingsSha256) as Row | undefined;
  return row ? mapVerdict(row) : null;
}

export function listQualityVerdicts(input: {
  productionItemId: string;
  gateType?: QualityGateType | null;
}): QualityVerdictRecord[] {
  const clauses = ["production_item_id = ?"];
  const params = [requiredText(input.productionItemId, "productionItemId", 64)];
  if (input.gateType) {
    clauses.push("gate_type = ?");
    params.push(input.gateType);
  }
  return (getDb().prepare(`SELECT * FROM quality_verdicts WHERE ${clauses.join(" AND ")}
    ORDER BY created_at ASC, gate_type ASC, attempt_no ASC`).all(...params) as Row[]).map(mapVerdict);
}

export type RecordPublicVerificationInput = {
  productionItemId: string;
  expectedItemVersion: number;
  publicationId: string;
  expectedYoutubeChannelId: string;
  youtubeVideoId: string;
  attemptNo: number;
  clipsStatus: string;
  clipsMatches: boolean;
  rssSeen: boolean;
  shortsHttpStatus?: number | null;
  pagePlayable: boolean;
  pageCanonicalVideoId?: string | null;
  pageChannelId?: string | null;
  failureCode?: string | null;
  evidence: Record<string, unknown>;
  // Optional caller clock (ISO); see TransitionProductionItemInput.now.
  now?: string | null;
};

export function recordPublicVerification(input: RecordPublicVerificationInput): {
  verification: PublicVerificationRecord;
  item: ProductionItemRecord;
} {
  return runInTransaction((db) => {
    const item = requireItem(db, requiredText(input.productionItemId, "productionItemId", 64));
    if (item.version !== input.expectedItemVersion) {
      fail("stale_version", "Production item version is stale.", { expected: input.expectedItemVersion, actual: item.version });
    }
    const publicationId = requiredText(input.publicationId, "publicationId", 64);
    const expectedChannelId = requiredText(input.expectedYoutubeChannelId, "expectedYoutubeChannelId", 128);
    const youtubeVideoId = requiredText(input.youtubeVideoId, "youtubeVideoId", 128);
    if (item.publicationId !== publicationId || item.expectedYoutubeChannelId !== expectedChannelId || item.youtubeVideoId !== youtubeVideoId) {
      fail("external_effect_conflict", "Public verification evidence is not bound to the item's frozen publication destination and video ID.", {
        itemId: item.id
      });
    }
    const canonicalId = optionalText(input.pageCanonicalVideoId, 128);
    const pageChannelId = optionalText(input.pageChannelId, 128);
    const httpOk = input.shortsHttpStatus !== null && input.shortsHttpStatus !== undefined &&
      input.shortsHttpStatus >= 200 && input.shortsHttpStatus < 300;
    const verified = input.clipsMatches && input.rssSeen && httpOk && input.pagePlayable &&
      canonicalId === youtubeVideoId && pageChannelId === expectedChannelId && !optionalText(input.failureCode, 160);
    if (verified && !["publication_scheduled", "upload_outcome_unknown", "cancel_requested"].includes(item.state)) {
      fail("invalid_transition", "Only a scheduled or upload-unknown item can become public_verified.", { state: item.state });
    }
    if (verified && item.sourceCandidateId) {
      const sourceRow = readRow(db, "channel_source_candidates", item.sourceCandidateId);
      const source = sourceRow ? mapCandidate(sourceRow) : null;
      if (!source || source.status !== "reserved" || source.reservedItemId !== item.id) {
        fail("source_conflict", "The public item no longer owns its exact source reservation.", {
          itemId: item.id, sourceCandidateId: item.sourceCandidateId
        });
      }
    }
    const id = newId();
    const stamp = input.now ?? nowIso();
    try {
      db.prepare(`INSERT INTO public_verifications
        (id, workspace_id, run_id, production_item_id, publication_id, expected_youtube_channel_id,
         youtube_video_id, attempt_no, clips_status, clips_matches, rss_seen, shorts_http_status,
         page_playable, page_canonical_video_id, page_channel_id, verified, failure_code, evidence_json, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, item.workspaceId, item.runId, item.id, publicationId, expectedChannelId, youtubeVideoId,
          positiveInteger(input.attemptNo, "attemptNo"), requiredText(input.clipsStatus, "clipsStatus", 80),
          input.clipsMatches ? 1 : 0, input.rssSeen ? 1 : 0, input.shortsHttpStatus ?? null,
          input.pagePlayable ? 1 : 0, canonicalId, pageChannelId, verified ? 1 : 0,
          optionalText(input.failureCode, 160), stringify(input.evidence), stamp);
    } catch (error) {
      if (isConstraintError(error)) fail("uniqueness_conflict", "Public verification attempt or successful verdict already exists.");
      throw error;
    }
    if (verified) {
      const result = db.prepare(`UPDATE production_items SET state = 'public_verified', version = version + 1,
        completed_at = ?, updated_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE id = ? AND version = ?`)
        .run(stamp, stamp, item.id, item.version);
      if (Number(result.changes) !== 1) fail("stale_version", "Production item changed before verification commit.");
      appendEventTx(db, {
        workspaceId: item.workspaceId, runId: item.runId, channelId: item.channelId, productionItemId: item.id,
        eventType: "production.item.public_verified", fromState: item.state, toState: "public_verified",
        payload: { verificationId: id, publicationId, youtubeVideoId }, createdAt: stamp
      });
      appendOutboxTx(db, {
        workspaceId: item.workspaceId, runId: item.runId, channelId: item.channelId, productionItemId: item.id,
        eventKind: "production.item.public_verified", payload: { verificationId: id, publicationId, youtubeVideoId }
      }, stamp);
      db.prepare(`UPDATE production_run_channels SET public_verified_count = (
        SELECT COUNT(*) FROM production_items
        WHERE run_channel_id = ? AND state = 'public_verified'
      ), version = version + 1, updated_at = ? WHERE id = ?`)
        .run(item.runChannelId, stamp, item.runChannelId);
      if (item.sourceCandidateId) {
        db.prepare(`UPDATE channel_source_candidates SET status = 'consumed', consumed_at = ?,
          reserved_item_id = NULL, reserved_at = NULL, updated_at = ?
          WHERE id = ? AND status = 'reserved' AND reserved_item_id = ?`)
          .run(stamp, stamp, item.sourceCandidateId, item.id);
      }
    }
    return {
      verification: mapVerification(readRow(db, "public_verifications", id)!),
      item: requireItem(db, item.id)
    };
  });
}

export function listPublicVerifications(productionItemId: string): PublicVerificationRecord[] {
  return (getDb().prepare(`SELECT * FROM public_verifications WHERE production_item_id = ?
    ORDER BY attempt_no ASC, checked_at ASC`).all(requiredText(productionItemId, "productionItemId", 64)) as Row[])
    .map(mapVerification);
}

export function listProductionEvents(input: {
  runId: string;
  productionItemId?: string | null;
}): ProductionEventRecord[] {
  const clauses = ["run_id = ?"];
  const params = [requiredText(input.runId, "runId", 64)];
  if (input.productionItemId) {
    clauses.push("production_item_id = ?");
    params.push(requiredText(input.productionItemId, "productionItemId", 64));
  }
  return (getDb().prepare(`SELECT * FROM production_events WHERE ${clauses.join(" AND ")}
    ORDER BY created_at ASC, id ASC`).all(...params) as Row[]).map(mapEvent);
}

export function cancelProductionRun(input: {
  runId: string;
  expectedVersion: number;
  reason: string;
  // Optional caller clock (ISO); see TransitionProductionItemInput.now.
  now?: string | null;
}): {
  run: ProductionRunRecord;
  canceledItemIds: string[];
  conflicts: Array<{ itemId: string; reason: string }>;
} {
  return runInTransaction((db) => {
    const run = requireRun(db, requiredText(input.runId, "runId", 64));
    if (run.version !== input.expectedVersion) {
      fail("stale_version", "Production run version is stale.", { expected: input.expectedVersion, actual: run.version });
    }
    if (run.status === "canceled" || run.status === "cancel_requested") {
      return { run, canceledItemIds: [], conflicts: [] };
    }
    if (!PRODUCTION_RUN_TRANSITIONS[run.status].includes("cancel_requested")) {
      fail("invalid_transition", `Production run in ${run.status} cannot accept cancellation.`);
    }
    const reason = requiredText(input.reason, "reason", 1000);
    const items = (db.prepare("SELECT * FROM production_items WHERE run_id = ? ORDER BY channel_id, item_slot, generation")
      .all(run.id) as Row[]).map(mapItem);
    const canceledItemIds: string[] = [];
    const conflicts: Array<{ itemId: string; reason: string }> = [];
    const stamp = input.now ?? nowIso();
    for (const item of items) {
      if (ITEM_COMPLETED_STATES.has(item.state) || item.state === "cancel_requested") continue;
      const publication = item.publicationId
        ? db.prepare(`SELECT status, upload_session_url, youtube_video_id
            FROM channel_publications WHERE id = ? LIMIT 1`).get(item.publicationId) as {
              status?: string;
              upload_session_url?: string | null;
              youtube_video_id?: string | null;
            } | undefined
        : undefined;
      const possibleExternalEffect = Boolean(
        item.publicationId ||
        item.uploadSessionUrl ||
        item.youtubeVideoId ||
        item.state === "upload_outcome_unknown" ||
        publication?.status === "uploading" ||
        publication?.status === "scheduled" ||
        publication?.status === "published" ||
        publication?.upload_session_url ||
        publication?.youtube_video_id
      );
      if (possibleExternalEffect) {
        conflicts.push({ itemId: item.id, reason: "upload_started_or_outcome_unknown" });
      }
      if (!isAllowedProductionItemTransition(item.state, "cancel_requested")) {
        conflicts.push({ itemId: item.id, reason: `state_${item.state}_cannot_cancel` });
        continue;
      }
      db.prepare(`UPDATE production_items SET state = 'cancel_requested', version = version + 1,
        lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = ?, updated_at = ?
        WHERE id = ? AND version = ?`).run(reason, stamp, item.id, item.version);
      appendEventTx(db, {
        workspaceId: item.workspaceId, runId: item.runId, channelId: item.channelId, productionItemId: item.id,
        eventType: "production.item.cancel_requested", fromState: item.state, toState: "cancel_requested",
        payload: { reason }, createdAt: stamp
      });
      appendOutboxTx(db, {
        workspaceId: item.workspaceId, runId: item.runId, channelId: item.channelId, productionItemId: item.id,
        eventKind: "production.item.cancel_requested", payload: { reason }, maxAttempts: 12
      }, stamp);
      canceledItemIds.push(item.id);
    }
    const result = db.prepare(`UPDATE production_runs SET status = 'cancel_requested', version = version + 1,
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, last_error = ?, updated_at = ?, completed_at = NULL
      WHERE id = ? AND version = ?`).run(reason, stamp, run.id, run.version);
    if (Number(result.changes) !== 1) fail("stale_version", "Production run changed before cancellation commit.");
    appendEventTx(db, {
      workspaceId: run.workspaceId, runId: run.id, eventType: "production.run.cancel_requested",
      fromState: run.status, toState: "cancel_requested", payload: { reason, conflicts }, createdAt: stamp
    });
    return { run: requireRun(db, run.id), canceledItemIds, conflicts };
  });
}
