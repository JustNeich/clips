import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import {
  validateProductionAgentOutput,
  type SourceFitOutput
} from "./production-agent-contracts";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "./pilot-production-profiles";
import { calculateProductionProfileHash } from "./pilot-profile-store";
import {
  PROJECT_KINGS_PROFILE_MEDIA_OVERRIDES,
  PROJECT_KINGS_PILOT_CANDIDATE_OBSERVATIONS,
  type ProjectKingsCandidateRightsStatus,
  type ProjectKingsLocalMediaReference,
  type ProjectKingsPilotCandidateObservation
} from "./pilot-source-candidate-catalog";
import {
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION,
  evaluateProjectKingsSourcePolicy,
  type ProjectKingsSensitiveContentAssessment,
  type ProjectKingsSourceDesignationEvidence,
  type ProjectKingsSourcePolicyApproval,
  type ProjectKingsSourcePolicyVerdict
} from "./source-rights-sensitive-policy";

export const PROJECT_KINGS_SOURCE_QUALIFICATION_EVIDENCE_VERSION =
  "project-kings-source-qualification-v2" as const;
export const PROJECT_KINGS_SOURCE_BUFFER_READINESS_VERSION =
  "project-kings-source-buffer-readiness-v1" as const;
export const PROJECT_KINGS_READY_BUFFER_TARGET = 6;

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;

type UnknownRecord = Record<string, unknown>;

export type ProjectKingsLivePublication = Readonly<{
  youtubeVideoId: string;
  sourceUrl: string;
  title: string;
}>;

export type ProjectKingsLivePublicationChannel = Readonly<{
  channelId: string;
  youtubeChannelId: string;
  recentPublications: readonly ProjectKingsLivePublication[];
  preexistingQueuedPublication?: Readonly<{
    publicationId: string;
    scheduledAt: string;
    sourceUrl: string;
    title: string;
    portfolioPipelineOwned: boolean;
    conceptV2Fit: string;
    actionTaken: string;
  }>;
}>;

export type ProjectKingsLivePublicationInventory = Readonly<{
  schemaVersion: 1;
  capturedAt: string;
  surface: string;
  channels: readonly ProjectKingsLivePublicationChannel[];
}>;

export type ProjectKingsSourceMediaInspection = Readonly<{
  relativePath: string;
  sizeBytes: number;
  contentSha256: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  decodeComplete: boolean;
  decodeError: string | null;
}>;

export type ProjectKingsSourceFitAttestation = Readonly<{
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  sourceUrl: string;
  contentSha256: string;
  profileHash: string;
  liveInventorySha256: string;
  agentAttemptId: string;
  model: string;
  reasoningLevel: string;
  promptSha256: string;
  artifactSetSha256: string;
  rawOutputSha256: string;
  outputSha256: string;
  finishedAt: string;
  output: SourceFitOutput;
}>;

export type ProjectKingsQualificationBlockerCode =
  | "missing_local_media"
  | "ambiguous_local_media_copies"
  | "media_decode_failed"
  | "missing_source_fit_attestation"
  | "invalid_source_fit_attestation"
  | "source_fit_failed"
  | "missing_source_policy_approval"
  | "missing_source_designation_provenance"
  | "missing_sensitive_content_assessment"
  | "source_policy_discovery_only"
  | "source_policy_blocked";

export type ProjectKingsQualificationBlocker = Readonly<{
  code: ProjectKingsQualificationBlockerCode;
  detail: string;
}>;

export type ProjectKingsSourceQualificationEvidence = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_SOURCE_QUALIFICATION_EVIDENCE_VERSION;
  qualifiedAt: string;
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  profileId: string;
  profileVersion: string;
  profileHash: string;
  conceptId: string;
  sourceUrl: string;
  canonicalUrl: string;
  provider: "instagram" | "youtube_ask";
  contentSha256: string;
  eventFingerprint: string;
  rightsStatus: "owner_approved_source_pool";
  media: ProjectKingsSourceMediaInspection;
  liveInventorySha256: string;
  sourcePolicy: Readonly<{
    discoveryState: "frozen_catalog";
    policyVersion: typeof PROJECT_KINGS_SOURCE_POLICY_VERSION;
    policySha256: typeof PROJECT_KINGS_SOURCE_POLICY_SHA256;
    approvalSha256: string;
    designationEvidenceSha256: string;
    sensitiveAssessmentSha256: string;
    approval: ProjectKingsSourcePolicyApproval;
    designation: ProjectKingsSourceDesignationEvidence;
    sensitiveAssessment: ProjectKingsSensitiveContentAssessment;
    policyVerdict: ProjectKingsSourcePolicyVerdict;
  }>;
  sourceFit: Readonly<{
    agentAttemptId: string;
    model: string;
    reasoningLevel: string;
    promptSha256: string;
    artifactSetSha256: string;
    rawOutputSha256: string;
    outputSha256: string;
    finishedAt: string;
    output: SourceFitOutput;
  }>;
  evidenceSha256: string;
}>;

export type ProjectKingsSourceQualificationResult = Readonly<{
  status: "pending" | "qualified";
  blockers: readonly ProjectKingsQualificationBlocker[];
  evidence: ProjectKingsSourceQualificationEvidence | null;
}>;

export type ProjectKingsReadinessCandidate = Readonly<{
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  sourceUrl: string;
  canonicalUrl: string;
  provider: "instagram" | "youtube_ask";
  discoveryRoutes: readonly string[];
  storyEventId: string | null;
  findings: readonly string[];
  rightsStatus: ProjectKingsCandidateRightsStatus;
  localMedia: Readonly<{
    resolvedCopies: readonly string[];
    duplicateCopiesIgnored: readonly string[];
    uniqueContentHashes: readonly string[];
    selected: ProjectKingsSourceMediaInspection | null;
  }>;
  qualificationStatus: "pending" | "qualified";
  blockers: readonly ProjectKingsQualificationBlocker[];
  qualificationEvidence: ProjectKingsSourceQualificationEvidence | null;
}>;

export type ProjectKingsExcludedCandidateCode =
  | "explicit_profile_reject"
  | "local_visual_reject"
  | "already_published"
  | "preexisting_queued_off_concept"
  | "duplicate_event"
  | "duplicate_content";

export type ProjectKingsExcludedCandidate = Readonly<{
  candidateId: string;
  sourceUrl: string;
  canonicalUrl: string;
  code: ProjectKingsExcludedCandidateCode;
  detail: string;
  duplicateOfCandidateId: string | null;
}>;

export type ProjectKingsChannelSourceBufferReadiness = Readonly<{
  profileKey: ProjectKingsPilotProfileKey;
  profileId: string;
  youtubeChannelId: string;
  profileHash: string;
  conceptId: string;
  targetQualified: number;
  unusedCandidateCount: number;
  qualifiedCount: number;
  pendingCount: number;
  candidateSupplyDeficit: number;
  qualifiedBufferDeficit: number;
  candidates: readonly ProjectKingsReadinessCandidate[];
  excludedCandidates: readonly ProjectKingsExcludedCandidate[];
}>;

export type ProjectKingsSourceBufferReadinessEvidence = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_SOURCE_BUFFER_READINESS_VERSION;
  capturedAt: string;
  liveInventorySha256: string;
  targetQualifiedPerChannel: number;
  channels: readonly ProjectKingsChannelSourceBufferReadiness[];
  summary: Readonly<{
    unusedCandidates: number;
    qualified: number;
    pending: number;
    qualifiedBufferDeficit: number;
    ready: boolean;
  }>;
  evidenceSha256: string;
}>;

type CandidateDraft = {
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  sourceUrl: string;
  canonicalUrl: string;
  provider: "instagram" | "youtube_ask";
  discoveryRoutes: Set<string>;
  storyEventId: string | null;
  localMedia: ProjectKingsLocalMediaReference[];
  disposition: "pending_semantic_review" | "rejected";
  rightsStatus: ProjectKingsCandidateRightsStatus;
  findings: string[];
};

type ResolvedCandidateMedia = Readonly<{
  resolvedCopies: readonly string[];
  duplicateCopiesIgnored: readonly string[];
  uniqueContentHashes: readonly string[];
  selected: ProjectKingsSourceMediaInspection | null;
  ambiguous: boolean;
}>;

export type ProjectKingsSourcePolicyCandidateArtifacts = Readonly<{
  candidateId: string;
  discoveryState: "frozen_catalog" | "discovery_only";
  designation: ProjectKingsSourceDesignationEvidence;
  sensitiveAssessment: ProjectKingsSensitiveContentAssessment;
}>;

export type ProjectKingsSourceBufferReadinessOptions = Readonly<{
  repoRoot: string;
  liveInventory: ProjectKingsLivePublicationInventory;
  capturedAt?: string;
  observations?: readonly ProjectKingsPilotCandidateObservation[];
  sourceFitAttestations?: readonly ProjectKingsSourceFitAttestation[];
  sourcePolicyApproval?: ProjectKingsSourcePolicyApproval | null;
  sourcePolicyCandidateArtifacts?: readonly ProjectKingsSourcePolicyCandidateArtifacts[];
  inspectMedia?: (
    absolutePath: string,
    relativePath: string
  ) => Promise<ProjectKingsSourceMediaInspection>;
}>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
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

async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function normalizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

export function canonicalizeProjectKingsSourceUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "instagram.com") {
    const match = url.pathname.match(/^\/reel\/([^/]+)/i);
    if (!match) throw new Error(`Unsupported Instagram source URL: ${rawUrl}`);
    return `https://www.instagram.com/reel/${match[1]}/`;
  }
  if (host === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    if (!videoId) throw new Error(`Unsupported YouTube source URL: ${rawUrl}`);
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const shortMatch = url.pathname.match(/^\/shorts\/([^/]+)/i);
    const videoId = shortMatch?.[1] ?? url.searchParams.get("v");
    if (!videoId) throw new Error(`Unsupported YouTube source URL: ${rawUrl}`);
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  throw new Error(`Unsupported source provider URL: ${rawUrl}`);
}

export function parseProjectKingsLivePublicationInventory(
  raw: unknown
): ProjectKingsLivePublicationInventory {
  const value = record(raw, "live inventory");
  if (value.schemaVersion !== 1) throw new Error("live inventory schemaVersion must equal 1.");
  if (!Array.isArray(value.channels)) throw new Error("live inventory channels must be an array.");
  const channels = value.channels.map((entry, channelIndex) => {
    const channel = record(entry, `channels[${channelIndex}]`);
    if (!Array.isArray(channel.recentPublications)) {
      throw new Error(`channels[${channelIndex}].recentPublications must be an array.`);
    }
    const recentPublications = channel.recentPublications.map((publicationEntry, publicationIndex) => {
      const publication = record(
        publicationEntry,
        `channels[${channelIndex}].recentPublications[${publicationIndex}]`
      );
      const sourceUrl = text(publication.sourceUrl, "publication.sourceUrl");
      canonicalizeProjectKingsSourceUrl(sourceUrl);
      return {
        youtubeVideoId: text(publication.youtubeVideoId, "publication.youtubeVideoId"),
        sourceUrl,
        title: text(publication.title, "publication.title")
      };
    });
    const queuedRaw = channel.preexistingQueuedPublication;
    const preexistingQueuedPublication = queuedRaw === undefined
      ? undefined
      : (() => {
          const queued = record(queuedRaw, "preexistingQueuedPublication");
          const sourceUrl = text(queued.sourceUrl, "preexistingQueuedPublication.sourceUrl");
          canonicalizeProjectKingsSourceUrl(sourceUrl);
          if (typeof queued.portfolioPipelineOwned !== "boolean") {
            throw new Error("preexistingQueuedPublication.portfolioPipelineOwned must be boolean.");
          }
          return {
            publicationId: text(queued.publicationId, "preexistingQueuedPublication.publicationId"),
            scheduledAt: text(queued.scheduledAt, "preexistingQueuedPublication.scheduledAt"),
            sourceUrl,
            title: text(queued.title, "preexistingQueuedPublication.title"),
            portfolioPipelineOwned: queued.portfolioPipelineOwned,
            conceptV2Fit: text(queued.conceptV2Fit, "preexistingQueuedPublication.conceptV2Fit"),
            actionTaken: text(queued.actionTaken, "preexistingQueuedPublication.actionTaken")
          };
        })();
    return {
      channelId: text(channel.channelId, "channel.channelId"),
      youtubeChannelId: text(channel.youtubeChannelId, "channel.youtubeChannelId"),
      recentPublications,
      ...(preexistingQueuedPublication ? { preexistingQueuedPublication } : {})
    };
  });
  return {
    schemaVersion: 1,
    capturedAt: text(value.capturedAt, "live inventory capturedAt"),
    surface: text(value.surface, "live inventory surface"),
    channels
  };
}

export function calculateProjectKingsLiveInventorySha256(
  inventory: ProjectKingsLivePublicationInventory
): string {
  return sha256(stableJson(inventory));
}

function validateSha(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 hash.`);
}

function qualificationEvidenceHash(
  evidence: Omit<ProjectKingsSourceQualificationEvidence, "evidenceSha256">
): string {
  return sha256(stableJson(evidence));
}

export function verifyProjectKingsSourceQualificationEvidence(
  evidence: ProjectKingsSourceQualificationEvidence
): void {
  if (evidence.schemaVersion !== PROJECT_KINGS_SOURCE_QUALIFICATION_EVIDENCE_VERSION) {
    throw new Error(
      "Unsupported source qualification evidence version; production import requires policy-bound v2 evidence."
    );
  }
  validateSha(evidence.profileHash, "profileHash");
  validateSha(evidence.contentSha256, "contentSha256");
  validateSha(evidence.liveInventorySha256, "liveInventorySha256");
  validateSha(evidence.sourceFit.promptSha256, "sourceFit.promptSha256");
  validateSha(evidence.sourceFit.artifactSetSha256, "sourceFit.artifactSetSha256");
  validateSha(evidence.sourceFit.rawOutputSha256, "sourceFit.rawOutputSha256");
  validateSha(evidence.sourceFit.outputSha256, "sourceFit.outputSha256");
  validateSha(evidence.sourcePolicy.approvalSha256, "sourcePolicy.approvalSha256");
  validateSha(
    evidence.sourcePolicy.designationEvidenceSha256,
    "sourcePolicy.designationEvidenceSha256"
  );
  validateSha(
    evidence.sourcePolicy.sensitiveAssessmentSha256,
    "sourcePolicy.sensitiveAssessmentSha256"
  );
  validateSha(
    evidence.sourcePolicy.policyVerdict.verdictSha256,
    "sourcePolicy.policyVerdict.verdictSha256"
  );
  validateSha(evidence.evidenceSha256, "evidenceSha256");
  if (
    evidence.sourcePolicy.discoveryState !== "frozen_catalog" ||
    evidence.sourcePolicy.policyVersion !== PROJECT_KINGS_SOURCE_POLICY_VERSION ||
    evidence.sourcePolicy.policySha256 !== PROJECT_KINGS_SOURCE_POLICY_SHA256
  ) {
    throw new Error("Qualified evidence is not bound to the frozen source policy v2.");
  }
  if (
    evidence.sourcePolicy.approvalSha256 !==
      evidence.sourcePolicy.approval.approvalSha256 ||
    evidence.sourcePolicy.designationEvidenceSha256 !==
      evidence.sourcePolicy.designation.evidenceSha256 ||
    evidence.sourcePolicy.sensitiveAssessmentSha256 !==
      evidence.sourcePolicy.sensitiveAssessment.assessmentSha256
  ) {
    throw new Error("Source-policy artifact hashes do not match qualification evidence.");
  }
  const recomputedPolicyVerdict = evaluateProjectKingsSourcePolicy(
    {
      candidateId: evidence.candidateId,
      profileKey: evidence.profileKey,
      canonicalSourceUrl: evidence.canonicalUrl,
      contentSha256: evidence.contentSha256,
      discoveryState: evidence.sourcePolicy.discoveryState,
      sourceDesignation: evidence.sourcePolicy.designation,
      sensitiveAssessment: evidence.sourcePolicy.sensitiveAssessment
    },
    {
      evaluatedAt: evidence.sourcePolicy.policyVerdict.evaluatedAt,
      policyApproval: evidence.sourcePolicy.approval
    }
  );
  if (
    recomputedPolicyVerdict.disposition !== "pass" ||
    !recomputedPolicyVerdict.eligibleForSourceFit ||
    stableJson(recomputedPolicyVerdict) !==
      stableJson(evidence.sourcePolicy.policyVerdict)
  ) {
    throw new Error("Qualified evidence requires an exact reproducible PASS policy_verdict.");
  }
  if (
    recomputedPolicyVerdict.policySha256 !== evidence.sourcePolicy.policySha256 ||
    recomputedPolicyVerdict.policyApprovalSha256 !==
      evidence.sourcePolicy.approvalSha256 ||
    recomputedPolicyVerdict.sourceDesignationEvidenceSha256 !==
      evidence.sourcePolicy.designationEvidenceSha256 ||
    recomputedPolicyVerdict.sensitiveAssessmentSha256 !==
      evidence.sourcePolicy.sensitiveAssessmentSha256
  ) {
    throw new Error("PASS policy_verdict hashes are not bound to qualification evidence.");
  }
  if (
    evidence.sourcePolicy.designation.provider !== evidence.provider ||
    evidence.sourcePolicy.designation.candidateId !== evidence.candidateId ||
    evidence.sourcePolicy.designation.canonicalSourceUrl !== evidence.canonicalUrl ||
    evidence.sourcePolicy.sensitiveAssessment.candidateId !== evidence.candidateId ||
    evidence.sourcePolicy.sensitiveAssessment.contentSha256 !== evidence.contentSha256
  ) {
    throw new Error("Source-policy artifacts belong to another source candidate.");
  }
  const validatedOutput = validateProductionAgentOutput("source_fit", evidence.sourceFit.output);
  if (validatedOutput.decision !== "PASS") throw new Error("Qualified evidence requires Source Fit PASS.");
  if (validatedOutput.candidateId !== evidence.candidateId) {
    throw new Error("Source Fit candidateId is not bound to qualification evidence.");
  }
  if (validatedOutput.storyEventId !== evidence.eventFingerprint) {
    throw new Error("Source Fit storyEventId is not bound to qualification evidence.");
  }
  if (sha256(stableJson(validatedOutput)) !== evidence.sourceFit.outputSha256) {
    throw new Error("Source Fit output hash does not match its structured output.");
  }
  if (evidence.media.contentSha256 !== evidence.contentSha256 || !evidence.media.decodeComplete) {
    throw new Error("Media inspection is not bound to a fully decoded content hash.");
  }
  if (canonicalizeProjectKingsSourceUrl(evidence.sourceUrl) !== evidence.canonicalUrl) {
    throw new Error("Canonical source URL does not match qualification evidence.");
  }
  const { evidenceSha256: ignored, ...payload } = evidence;
  void ignored;
  if (qualificationEvidenceHash(payload) !== evidence.evidenceSha256) {
    throw new Error("Source qualification evidence hash mismatch.");
  }
}

export function buildProjectKingsSourceQualificationEvidence(input: {
  capturedAt: string;
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  sourceUrl: string;
  provider: "instagram" | "youtube_ask";
  provisionalStoryEventId: string | null;
  rightsStatus: ProjectKingsCandidateRightsStatus;
  media: ResolvedCandidateMedia;
  liveInventorySha256: string;
  sourceFitAttestation?: ProjectKingsSourceFitAttestation | null;
  discoveryState: "frozen_catalog" | "discovery_only";
  sourcePolicyApproval?: ProjectKingsSourcePolicyApproval | null;
  sourceDesignation?: ProjectKingsSourceDesignationEvidence | null;
  sensitiveAssessment?: ProjectKingsSensitiveContentAssessment | null;
}): ProjectKingsSourceQualificationResult {
  const blockers: ProjectKingsQualificationBlocker[] = [];
  if (!input.media.selected) {
    blockers.push({ code: "missing_local_media", detail: "No local MP4 is bound to this source URL." });
  }
  if (input.media.ambiguous) {
    blockers.push({
      code: "ambiguous_local_media_copies",
      detail: `Local copies resolve to ${input.media.uniqueContentHashes.length} different content hashes.`
    });
  }
  if (input.media.selected && !input.media.selected.decodeComplete) {
    blockers.push({
      code: "media_decode_failed",
      detail: input.media.selected.decodeError ?? "Full media decode failed."
    });
  }
  if (!input.sourcePolicyApproval) {
    blockers.push({
      code: "missing_source_policy_approval",
      detail: "No exact owner approval exists for the frozen source policy and designated routes."
    });
  }
  if (!input.sourceDesignation) {
    blockers.push({
      code: "missing_source_designation_provenance",
      detail: "No hash-bound donor/source-route provenance exists for this candidate."
    });
  }
  if (!input.sensitiveAssessment) {
    blockers.push({
      code: "missing_sensitive_content_assessment",
      detail: "No independent sensitive-content assessment is bound to these exact media bytes."
    });
  }
  let policyVerdict: ProjectKingsSourcePolicyVerdict | null = null;
  if (
    input.media.selected &&
    input.sourcePolicyApproval &&
    input.sourceDesignation &&
    input.sensitiveAssessment
  ) {
    try {
      policyVerdict = evaluateProjectKingsSourcePolicy(
        {
          candidateId: input.candidateId,
          profileKey: input.profileKey,
          canonicalSourceUrl: canonicalizeProjectKingsSourceUrl(input.sourceUrl),
          contentSha256: input.media.selected.contentSha256,
          discoveryState: input.discoveryState,
          sourceDesignation: input.sourceDesignation,
          sensitiveAssessment: input.sensitiveAssessment
        },
        {
          evaluatedAt: input.capturedAt,
          policyApproval: input.sourcePolicyApproval
        }
      );
      if (policyVerdict.disposition === "discovery_only") {
        blockers.push({
          code: "source_policy_discovery_only",
          detail: "Dynamic discovery remains discovery_only until exact provenance and qualification are frozen."
        });
      } else if (policyVerdict.disposition !== "pass") {
        blockers.push({
          code: "source_policy_blocked",
          detail: `Source policy blocked the candidate: ${policyVerdict.issues.join(", ") || "unknown policy issue"}.`
        });
      }
    } catch (error) {
      blockers.push({ code: "source_policy_blocked", detail: normalizeError(error) });
      policyVerdict = null;
    }
  }
  const attestation = input.sourceFitAttestation;
  let output: SourceFitOutput | null = null;
  if (!attestation) {
    blockers.push({
      code: "missing_source_fit_attestation",
      detail: "No hash-bound independent Source Fit attestation exists for this exact media/profile/inventory tuple."
    });
  } else {
    try {
      const profile = PROJECT_KINGS_PILOT_PROFILES[input.profileKey];
      const profileHash = calculateProductionProfileHash(profile);
      const canonicalUrl = canonicalizeProjectKingsSourceUrl(input.sourceUrl);
      const mediaHash = input.media.selected?.contentSha256 ?? "";
      validateSha(attestation.contentSha256, "attestation.contentSha256");
      validateSha(attestation.profileHash, "attestation.profileHash");
      validateSha(attestation.liveInventorySha256, "attestation.liveInventorySha256");
      validateSha(attestation.promptSha256, "attestation.promptSha256");
      validateSha(attestation.artifactSetSha256, "attestation.artifactSetSha256");
      validateSha(attestation.rawOutputSha256, "attestation.rawOutputSha256");
      validateSha(attestation.outputSha256, "attestation.outputSha256");
      if (
        attestation.candidateId !== input.candidateId ||
        attestation.profileKey !== input.profileKey ||
        canonicalizeProjectKingsSourceUrl(attestation.sourceUrl) !== canonicalUrl ||
        attestation.contentSha256 !== mediaHash ||
        attestation.profileHash !== profileHash ||
        attestation.liveInventorySha256 !== input.liveInventorySha256
      ) {
        throw new Error("Source Fit attestation identity binding does not match the candidate.");
      }
      output = validateProductionAgentOutput("source_fit", attestation.output);
      if (sha256(stableJson(output)) !== attestation.outputSha256) {
        throw new Error("Source Fit structured output hash mismatch.");
      }
      if (output.candidateId !== input.candidateId) {
        throw new Error("Source Fit output candidateId mismatch.");
      }
      if (input.provisionalStoryEventId && output.storyEventId !== input.provisionalStoryEventId) {
        throw new Error("Source Fit story event conflicts with the discovered event identity.");
      }
      if (output.decision !== "PASS") {
        blockers.push({ code: "source_fit_failed", detail: output.reason });
      }
    } catch (error) {
      blockers.push({ code: "invalid_source_fit_attestation", detail: normalizeError(error) });
      output = null;
    }
  }
  if (
    blockers.length > 0 ||
    !input.media.selected ||
    !attestation ||
    !output ||
    !policyVerdict ||
    policyVerdict.disposition !== "pass" ||
    !input.sourcePolicyApproval ||
    !input.sourceDesignation ||
    !input.sensitiveAssessment
  ) {
    return { status: "pending", blockers, evidence: null };
  }
  const profile = PROJECT_KINGS_PILOT_PROFILES[input.profileKey];
  const payload: Omit<ProjectKingsSourceQualificationEvidence, "evidenceSha256"> = {
    schemaVersion: PROJECT_KINGS_SOURCE_QUALIFICATION_EVIDENCE_VERSION,
    qualifiedAt: input.capturedAt,
    candidateId: input.candidateId,
    profileKey: input.profileKey,
    profileId: profile.profileId,
    profileVersion: profile.profileVersion,
    profileHash: calculateProductionProfileHash(profile),
    conceptId: profile.concept.conceptId,
    sourceUrl: input.sourceUrl,
    canonicalUrl: canonicalizeProjectKingsSourceUrl(input.sourceUrl),
    provider: input.provider,
    contentSha256: input.media.selected.contentSha256,
    eventFingerprint: output.storyEventId,
    rightsStatus: "owner_approved_source_pool",
    media: input.media.selected,
    liveInventorySha256: input.liveInventorySha256,
    sourcePolicy: {
      discoveryState: "frozen_catalog",
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      approvalSha256: input.sourcePolicyApproval.approvalSha256,
      designationEvidenceSha256: input.sourceDesignation.evidenceSha256,
      sensitiveAssessmentSha256: input.sensitiveAssessment.assessmentSha256,
      approval: input.sourcePolicyApproval,
      designation: input.sourceDesignation,
      sensitiveAssessment: input.sensitiveAssessment,
      policyVerdict
    },
    sourceFit: {
      agentAttemptId: attestation.agentAttemptId,
      model: attestation.model,
      reasoningLevel: attestation.reasoningLevel,
      promptSha256: attestation.promptSha256,
      artifactSetSha256: attestation.artifactSetSha256,
      rawOutputSha256: attestation.rawOutputSha256,
      outputSha256: attestation.outputSha256,
      finishedAt: attestation.finishedAt,
      output
    }
  };
  const evidence: ProjectKingsSourceQualificationEvidence = {
    ...payload,
    evidenceSha256: qualificationEvidenceHash(payload)
  };
  verifyProjectKingsSourceQualificationEvidence(evidence);
  return { status: "qualified", blockers: [], evidence };
}

export async function inspectProjectKingsSourceMedia(
  absolutePath: string,
  relativePath = absolutePath
): Promise<ProjectKingsSourceMediaInspection> {
  const stat = await fs.stat(absolutePath);
  const contentSha256 = await sha256File(absolutePath);
  let durationMs: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  let decodeComplete = false;
  let decodeError: string | null = null;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
      "-of", "json",
      absolutePath
    ], { maxBuffer: 4 * 1024 * 1024 });
    const probe = record(JSON.parse(stdout), "ffprobe output");
    const format = probe.format && typeof probe.format === "object"
      ? probe.format as UnknownRecord
      : {};
    const duration = Number(format.duration);
    if (Number.isFinite(duration)) durationMs = Math.round(duration * 1_000);
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    for (const streamRaw of streams) {
      if (!streamRaw || typeof streamRaw !== "object" || Array.isArray(streamRaw)) continue;
      const stream = streamRaw as UnknownRecord;
      if (stream.codec_type === "video" && videoCodec === null) {
        videoCodec = typeof stream.codec_name === "string" ? stream.codec_name : null;
        width = Number.isInteger(stream.width) ? Number(stream.width) : null;
        height = Number.isInteger(stream.height) ? Number(stream.height) : null;
      }
      if (stream.codec_type === "audio" && audioCodec === null) {
        audioCodec = typeof stream.codec_name === "string" ? stream.codec_name : null;
      }
    }
    await execFileAsync("ffmpeg", [
      "-v", "error",
      "-i", absolutePath,
      "-map", "0",
      "-f", "null",
      "-"
    ], { maxBuffer: 8 * 1024 * 1024 });
    decodeComplete = true;
  } catch (error) {
    decodeError = normalizeError(error);
  }
  return {
    relativePath,
    sizeBytes: stat.size,
    contentSha256,
    durationMs,
    width,
    height,
    videoCodec,
    audioCodec,
    decodeComplete,
    decodeError
  };
}

async function sourceCacheIndex(repoRoot: string): Promise<Map<string, string[]>> {
  const directory = path.join(repoRoot, ".data/source-media-cache/sources");
  const index = new Map<string, string[]>();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(directory);
  } catch {
    return index;
  }
  for (const fileName of entries.filter((entry) => entry.endsWith(".json")).sort()) {
    try {
      const metadataPath = path.join(directory, fileName);
      const metadata = record(JSON.parse(await fs.readFile(metadataPath, "utf8")), metadataPath);
      if (typeof metadata.fileName !== "string") continue;
      const mediaPath = metadataPath.replace(/\.json$/i, ".mp4");
      await fs.access(mediaPath);
      const relativePath = path.relative(repoRoot, mediaPath);
      const paths = index.get(metadata.fileName) ?? [];
      paths.push(relativePath);
      index.set(metadata.fileName, paths);
    } catch {
      // A broken cache metadata entry is not silently treated as usable media.
    }
  }
  return index;
}

async function resolveCandidateMedia(input: {
  repoRoot: string;
  references: readonly ProjectKingsLocalMediaReference[];
  cacheIndex: Map<string, string[]>;
  inspectMedia: (
    absolutePath: string,
    relativePath: string
  ) => Promise<ProjectKingsSourceMediaInspection>;
}): Promise<ResolvedCandidateMedia> {
  const paths = new Set<string>();
  for (const reference of input.references) {
    if (reference.kind === "direct") paths.add(reference.relativePath);
    else for (const relativePath of input.cacheIndex.get(reference.fileName) ?? []) paths.add(relativePath);
  }
  const existing: string[] = [];
  for (const relativePath of [...paths].sort()) {
    try {
      await fs.access(path.join(input.repoRoot, relativePath));
      existing.push(relativePath);
    } catch {
      // Missing media remains a blocking absence below.
    }
  }
  if (existing.length === 0) {
    return {
      resolvedCopies: [],
      duplicateCopiesIgnored: [],
      uniqueContentHashes: [],
      selected: null,
      ambiguous: false
    };
  }
  const hashes = await Promise.all(
    existing.map(async (relativePath) => ({
      relativePath,
      hash: await sha256File(path.join(input.repoRoot, relativePath))
    }))
  );
  const byHash = new Map<string, string[]>();
  for (const entry of hashes) {
    const group = byHash.get(entry.hash) ?? [];
    group.push(entry.relativePath);
    byHash.set(entry.hash, group);
  }
  const uniqueContentHashes = [...byHash.keys()].sort();
  if (uniqueContentHashes.length !== 1) {
    return {
      resolvedCopies: existing,
      duplicateCopiesIgnored: [],
      uniqueContentHashes,
      selected: null,
      ambiguous: true
    };
  }
  const selectedPath = [...(byHash.get(uniqueContentHashes[0]!) ?? [])].sort()[0]!;
  const selected = await input.inspectMedia(
    path.join(input.repoRoot, selectedPath),
    selectedPath
  );
  if (selected.contentSha256 !== uniqueContentHashes[0]) {
    throw new Error(`Media inspector returned a different hash for ${selectedPath}.`);
  }
  return {
    resolvedCopies: existing,
    duplicateCopiesIgnored: existing.filter((entry) => entry !== selectedPath),
    uniqueContentHashes,
    selected,
    ambiguous: false
  };
}

function initialDrafts(
  observations: readonly ProjectKingsPilotCandidateObservation[]
): {
  candidates: Map<string, CandidateDraft>;
  excluded: Map<ProjectKingsPilotProfileKey, ProjectKingsExcludedCandidate[]>;
} {
  const candidates = new Map<string, CandidateDraft>();
  const excluded = new Map<ProjectKingsPilotProfileKey, ProjectKingsExcludedCandidate[]>();
  for (const key of Object.keys(PROJECT_KINGS_PILOT_PROFILES) as ProjectKingsPilotProfileKey[]) {
    excluded.set(key, []);
    const profile = PROJECT_KINGS_PILOT_PROFILES[key];
    const pilotFolder = key === "dark-joy-boy" ? "dark" : key === "light-kingdom" ? "light" : "cop";
    for (const example of profile.concept.positiveExamples) {
      const canonicalUrl = canonicalizeProjectKingsSourceUrl(example.url);
      const reelId = new URL(canonicalUrl).pathname.split("/").filter(Boolean).at(-1)!;
      candidates.set(`${key}:${canonicalUrl}`, {
        candidateId: example.id,
        profileKey: key,
        sourceUrl: example.url,
        canonicalUrl,
        provider: "instagram",
        discoveryRoutes: new Set(["profile_v2_positive_example"]),
        storyEventId: example.storyEventId,
        localMedia: [PROJECT_KINGS_PROFILE_MEDIA_OVERRIDES[example.id] ?? {
          kind: "direct",
          relativePath: `.data/project-kings/source-candidates/${pilotFolder}/instagram/${reelId}.mp4`
        }],
        disposition: "pending_semantic_review",
        rightsStatus: "owner_approved_source_pool",
        findings: [example.reason]
      });
    }
    for (const example of profile.concept.negativeExamples) {
      const canonicalUrl = canonicalizeProjectKingsSourceUrl(example.url);
      excluded.get(key)!.push({
        candidateId: example.id,
        sourceUrl: example.url,
        canonicalUrl,
        code: "explicit_profile_reject",
        detail: example.reason,
        duplicateOfCandidateId: null
      });
    }
  }
  for (const observation of observations) {
    const canonicalUrl = canonicalizeProjectKingsSourceUrl(observation.sourceUrl);
    const key = `${observation.profileKey}:${canonicalUrl}`;
    const existing = candidates.get(key);
    const profileNegative = excluded.get(observation.profileKey)!
      .find((entry) => entry.canonicalUrl === canonicalUrl && entry.code === "explicit_profile_reject");
    if (observation.disposition === "rejected" || profileNegative) {
      if (!profileNegative) {
        excluded.get(observation.profileKey)!.push({
          candidateId: observation.candidateId,
          sourceUrl: observation.sourceUrl,
          canonicalUrl,
          code: "local_visual_reject",
          detail: observation.findings.join(" "),
          duplicateOfCandidateId: null
        });
      }
      candidates.delete(key);
      continue;
    }
    if (existing) {
      existing.discoveryRoutes.add(observation.discoveryRoute);
      existing.localMedia.push(observation.localMedia);
      existing.findings.push(...observation.findings);
      if (!existing.storyEventId) existing.storyEventId = observation.storyEventId;
      if (observation.rightsStatus === "owner_approved_source_pool") {
        existing.rightsStatus = "owner_approved_source_pool";
      }
    } else {
      candidates.set(key, {
        candidateId: observation.candidateId,
        profileKey: observation.profileKey,
        sourceUrl: observation.sourceUrl,
        canonicalUrl,
        provider: observation.provider,
        discoveryRoutes: new Set([observation.discoveryRoute]),
        storyEventId: observation.storyEventId,
        localMedia: [observation.localMedia],
        disposition: observation.disposition,
        rightsStatus: observation.rightsStatus,
        findings: [...observation.findings]
      });
    }
  }
  return { candidates, excluded };
}

function removePublishedAndEventDuplicates(input: {
  drafts: Map<string, CandidateDraft>;
  excluded: Map<ProjectKingsPilotProfileKey, ProjectKingsExcludedCandidate[]>;
  liveInventory: ProjectKingsLivePublicationInventory;
}): CandidateDraft[] {
  const remaining = [...input.drafts.values()];
  const publishedByChannel = new Map<string, Set<string>>();
  for (const channel of input.liveInventory.channels) {
    publishedByChannel.set(
      channel.channelId,
      new Set(channel.recentPublications.map((entry) => canonicalizeProjectKingsSourceUrl(entry.sourceUrl)))
    );
    const queued = channel.preexistingQueuedPublication;
    if (queued && queued.conceptV2Fit === "fail") {
      const profileKey = (Object.keys(PROJECT_KINGS_PILOT_PROFILES) as ProjectKingsPilotProfileKey[])
        .find((key) => PROJECT_KINGS_PILOT_PROFILES[key].profileId === channel.channelId);
      if (profileKey) {
        input.excluded.get(profileKey)!.push({
          candidateId: `queued-${queued.publicationId}`,
          sourceUrl: queued.sourceUrl,
          canonicalUrl: canonicalizeProjectKingsSourceUrl(queued.sourceUrl),
          code: "preexisting_queued_off_concept",
          detail: `Queued publication is outside concept v2: ${queued.title}. No mutation was performed.`,
          duplicateOfCandidateId: null
        });
      }
    }
  }
  const afterPublished: CandidateDraft[] = [];
  for (const draft of remaining) {
    const channelId = PROJECT_KINGS_PILOT_PROFILES[draft.profileKey].profileId;
    if (publishedByChannel.get(channelId)?.has(draft.canonicalUrl)) {
      input.excluded.get(draft.profileKey)!.push({
        candidateId: draft.candidateId,
        sourceUrl: draft.sourceUrl,
        canonicalUrl: draft.canonicalUrl,
        code: "already_published",
        detail: "The exact source URL already appears in the live publication inventory.",
        duplicateOfCandidateId: null
      });
    } else {
      afterPublished.push(draft);
    }
  }
  const keep: CandidateDraft[] = [];
  for (const profileKey of Object.keys(PROJECT_KINGS_PILOT_PROFILES) as ProjectKingsPilotProfileKey[]) {
    const profileDrafts = afterPublished.filter((entry) => entry.profileKey === profileKey);
    const eventGroups = new Map<string, CandidateDraft[]>();
    for (const draft of profileDrafts) {
      if (!draft.storyEventId) {
        keep.push(draft);
        continue;
      }
      const group = eventGroups.get(draft.storyEventId) ?? [];
      group.push(draft);
      eventGroups.set(draft.storyEventId, group);
    }
    for (const group of eventGroups.values()) {
      group.sort((left, right) => {
        const localDelta = Number(right.localMedia.length > 0) - Number(left.localMedia.length > 0);
        return localDelta || left.candidateId.localeCompare(right.candidateId);
      });
      const selected = group[0]!;
      keep.push(selected);
      for (const duplicate of group.slice(1)) {
        input.excluded.get(profileKey)!.push({
          candidateId: duplicate.candidateId,
          sourceUrl: duplicate.sourceUrl,
          canonicalUrl: duplicate.canonicalUrl,
          code: "duplicate_event",
          detail: `Same story event as ${selected.candidateId}: ${duplicate.storyEventId}.`,
          duplicateOfCandidateId: selected.candidateId
        });
      }
    }
  }
  return keep.sort((left, right) =>
    left.profileKey.localeCompare(right.profileKey) || left.candidateId.localeCompare(right.candidateId)
  );
}

function readinessEvidenceHash(
  evidence: Omit<ProjectKingsSourceBufferReadinessEvidence, "evidenceSha256">
): string {
  return sha256(stableJson(evidence));
}

export function verifyProjectKingsSourceBufferReadinessEvidence(
  evidence: ProjectKingsSourceBufferReadinessEvidence
): void {
  if (evidence.schemaVersion !== PROJECT_KINGS_SOURCE_BUFFER_READINESS_VERSION) {
    throw new Error("Unsupported source-buffer readiness evidence version.");
  }
  validateSha(evidence.liveInventorySha256, "liveInventorySha256");
  validateSha(evidence.evidenceSha256, "evidenceSha256");
  for (const channel of evidence.channels) {
    if (channel.targetQualified !== PROJECT_KINGS_READY_BUFFER_TARGET) {
      throw new Error("Unexpected ready-buffer target.");
    }
    if (channel.qualifiedBufferDeficit !== Math.max(0, channel.targetQualified - channel.qualifiedCount)) {
      throw new Error(`Qualified deficit mismatch for ${channel.profileKey}.`);
    }
    if (channel.candidateSupplyDeficit !== Math.max(0, channel.targetQualified - channel.unusedCandidateCount)) {
      throw new Error(`Candidate supply deficit mismatch for ${channel.profileKey}.`);
    }
    for (const candidate of channel.candidates) {
      if (candidate.qualificationStatus === "qualified" && !candidate.qualificationEvidence) {
        throw new Error(
          `Qualified candidate ${candidate.candidateId} is missing policy-bound qualification evidence v2.`
        );
      }
      if (candidate.qualificationEvidence) {
        verifyProjectKingsSourceQualificationEvidence(candidate.qualificationEvidence);
      }
    }
    const actualQualified = channel.candidates.filter(
      (candidate) => candidate.qualificationStatus === "qualified"
    ).length;
    if (actualQualified !== channel.qualifiedCount) {
      throw new Error(`Qualified candidate count mismatch for ${channel.profileKey}.`);
    }
  }
  const { evidenceSha256: ignored, ...payload } = evidence;
  void ignored;
  if (readinessEvidenceHash(payload) !== evidence.evidenceSha256) {
    throw new Error("Source-buffer readiness evidence hash mismatch.");
  }
}

export async function auditProjectKingsSourceBufferReadiness(
  options: ProjectKingsSourceBufferReadinessOptions
): Promise<ProjectKingsSourceBufferReadinessEvidence> {
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  const liveInventory = parseProjectKingsLivePublicationInventory(options.liveInventory);
  const liveInventorySha256 = calculateProjectKingsLiveInventorySha256(liveInventory);
  const observations = options.observations ?? PROJECT_KINGS_PILOT_CANDIDATE_OBSERVATIONS;
  const sourceFitAttestations = options.sourceFitAttestations ?? [];
  const sourcePolicyCandidateArtifacts = options.sourcePolicyCandidateArtifacts ?? [];
  const cacheIndex = await sourceCacheIndex(options.repoRoot);
  const initial = initialDrafts(observations);
  const drafts = removePublishedAndEventDuplicates({
    drafts: initial.candidates,
    excluded: initial.excluded,
    liveInventory
  });
  const inspected = await Promise.all(drafts.map(async (draft) => ({
    draft,
    media: await resolveCandidateMedia({
      repoRoot: options.repoRoot,
      references: draft.localMedia,
      cacheIndex,
      inspectMedia: options.inspectMedia ?? inspectProjectKingsSourceMedia
    })
  })));
  const contentGroups = new Map<string, typeof inspected>();
  const noHash: typeof inspected = [];
  for (const entry of inspected) {
    const hash = entry.media.selected?.contentSha256;
    if (!hash) {
      noHash.push(entry);
      continue;
    }
    const group = contentGroups.get(`${entry.draft.profileKey}:${hash}`) ?? [];
    group.push(entry);
    contentGroups.set(`${entry.draft.profileKey}:${hash}`, group);
  }
  const deduplicated: typeof inspected = [...noHash];
  for (const group of contentGroups.values()) {
    group.sort((left, right) => left.draft.candidateId.localeCompare(right.draft.candidateId));
    const selected = group[0]!;
    deduplicated.push(selected);
    for (const duplicate of group.slice(1)) {
      initial.excluded.get(duplicate.draft.profileKey)!.push({
        candidateId: duplicate.draft.candidateId,
        sourceUrl: duplicate.draft.sourceUrl,
        canonicalUrl: duplicate.draft.canonicalUrl,
        code: "duplicate_content",
        detail: `Exact content SHA-256 duplicates ${selected.draft.candidateId}.`,
        duplicateOfCandidateId: selected.draft.candidateId
      });
    }
  }
  const channels: ProjectKingsChannelSourceBufferReadiness[] = [];
  for (const profileKey of Object.keys(PROJECT_KINGS_PILOT_PROFILES) as ProjectKingsPilotProfileKey[]) {
    const profile = PROJECT_KINGS_PILOT_PROFILES[profileKey];
    const candidates: ProjectKingsReadinessCandidate[] = [];
    for (const entry of deduplicated
      .filter((candidate) => candidate.draft.profileKey === profileKey)
      .sort((left, right) => left.draft.candidateId.localeCompare(right.draft.candidateId))) {
      const attestation = sourceFitAttestations.find((candidate) =>
        candidate.candidateId === entry.draft.candidateId &&
        candidate.profileKey === profileKey &&
        canonicalizeProjectKingsSourceUrl(candidate.sourceUrl) === entry.draft.canonicalUrl
      );
      const policyArtifacts = sourcePolicyCandidateArtifacts.find(
        (candidate) => candidate.candidateId === entry.draft.candidateId
      );
      const qualification = buildProjectKingsSourceQualificationEvidence({
        capturedAt,
        candidateId: entry.draft.candidateId,
        profileKey,
        sourceUrl: entry.draft.sourceUrl,
        provider: entry.draft.provider,
        provisionalStoryEventId: entry.draft.storyEventId,
        rightsStatus: entry.draft.rightsStatus,
        media: entry.media,
        liveInventorySha256,
        sourceFitAttestation: attestation,
        discoveryState: policyArtifacts?.discoveryState ?? "frozen_catalog",
        sourcePolicyApproval: options.sourcePolicyApproval,
        sourceDesignation: policyArtifacts?.designation,
        sensitiveAssessment: policyArtifacts?.sensitiveAssessment
      });
      candidates.push({
        candidateId: entry.draft.candidateId,
        profileKey,
        sourceUrl: entry.draft.sourceUrl,
        canonicalUrl: entry.draft.canonicalUrl,
        provider: entry.draft.provider,
        discoveryRoutes: [...entry.draft.discoveryRoutes].sort(),
        storyEventId: entry.draft.storyEventId,
        findings: [...new Set(entry.draft.findings)],
        rightsStatus: entry.draft.rightsStatus,
        localMedia: {
          resolvedCopies: entry.media.resolvedCopies,
          duplicateCopiesIgnored: entry.media.duplicateCopiesIgnored,
          uniqueContentHashes: entry.media.uniqueContentHashes,
          selected: entry.media.selected
        },
        qualificationStatus: qualification.status,
        blockers: qualification.blockers,
        qualificationEvidence: qualification.evidence
      });
    }
    const qualifiedCount = candidates.filter((entry) => entry.qualificationStatus === "qualified").length;
    channels.push({
      profileKey,
      profileId: profile.profileId,
      youtubeChannelId: profile.youtube.channelId,
      profileHash: calculateProductionProfileHash(profile),
      conceptId: profile.concept.conceptId,
      targetQualified: PROJECT_KINGS_READY_BUFFER_TARGET,
      unusedCandidateCount: candidates.length,
      qualifiedCount,
      pendingCount: candidates.length - qualifiedCount,
      candidateSupplyDeficit: Math.max(0, PROJECT_KINGS_READY_BUFFER_TARGET - candidates.length),
      qualifiedBufferDeficit: Math.max(0, PROJECT_KINGS_READY_BUFFER_TARGET - qualifiedCount),
      candidates,
      excludedCandidates: initial.excluded.get(profileKey)!
        .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
    });
  }
  const payload: Omit<ProjectKingsSourceBufferReadinessEvidence, "evidenceSha256"> = {
    schemaVersion: PROJECT_KINGS_SOURCE_BUFFER_READINESS_VERSION,
    capturedAt,
    liveInventorySha256,
    targetQualifiedPerChannel: PROJECT_KINGS_READY_BUFFER_TARGET,
    channels,
    summary: {
      unusedCandidates: channels.reduce((sum, channel) => sum + channel.unusedCandidateCount, 0),
      qualified: channels.reduce((sum, channel) => sum + channel.qualifiedCount, 0),
      pending: channels.reduce((sum, channel) => sum + channel.pendingCount, 0),
      qualifiedBufferDeficit: channels.reduce((sum, channel) => sum + channel.qualifiedBufferDeficit, 0),
      ready: channels.every((channel) => channel.qualifiedBufferDeficit === 0)
    }
  };
  const evidence: ProjectKingsSourceBufferReadinessEvidence = {
    ...payload,
    evidenceSha256: readinessEvidenceHash(payload)
  };
  verifyProjectKingsSourceBufferReadinessEvidence(evidence);
  return evidence;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, filePath);
}

export async function writeProjectKingsSourceBufferReadiness(input: {
  outputPath: string;
  evidence: ProjectKingsSourceBufferReadinessEvidence;
}): Promise<void> {
  verifyProjectKingsSourceBufferReadinessEvidence(input.evidence);
  await atomicWrite(input.outputPath, `${JSON.stringify(input.evidence, null, 2)}\n`);
}
