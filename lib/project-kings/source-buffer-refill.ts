import { createHash } from "node:crypto";
import path from "node:path";

import {
  isChannelSourceCandidateQualified,
  listChannelSourceCandidates,
  transitionChannelSourceCandidateQualification,
  upsertChannelSourceCandidate,
  type ChannelSourceCandidateRecord
} from "../portfolio-production-store";
import {
  inspectProjectKingsSourceMedia,
  verifyProjectKingsSourceBufferReadinessEvidence,
  verifyProjectKingsSourceQualificationEvidence,
  type ProjectKingsSourceBufferReadinessEvidence,
  type ProjectKingsSourceQualificationEvidence,
  type ProjectKingsSourceMediaInspection
} from "./source-buffer-readiness";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "./pilot-production-profiles";
import { getCachedSourceMedia } from "../source-media-cache";
import { isUploadedSourceUrl } from "../uploaded-source";
import { getActiveProjectKingsSourcePolicyApproval } from "./source-policy-approval-store";

export const PROJECT_KINGS_SOURCE_REFILL_REQUEST_VERSION =
  "project-kings-source-refill-request-v1" as const;
export const PROJECT_KINGS_SOURCE_REFILL_RESULT_VERSION =
  "project-kings-source-refill-result-v1" as const;
export const PROJECT_KINGS_IMPORTED_SOURCE_EVIDENCE_VERSION =
  "project-kings-imported-source-evidence-v2" as const;

export type ProjectKingsSourceRefillDecision = Readonly<{
  shouldRefill: boolean;
  qualifiedAvailable: number;
  readyBufferMin: number;
  readyBufferCap: number;
  candidateAttemptBudget: number;
  candidatesToRequest: number;
}>;

export type ProjectKingsSourceRefillRequest = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_SOURCE_REFILL_REQUEST_VERSION;
  requestId: string;
  workspaceId: string;
  channelId: string;
  profileKey: ProjectKingsPilotProfileKey;
  profileVersion: string;
  requestedAt: string;
  reason: "ready_buffer_below_minimum";
  currentQualifiedAvailable: number;
  readyBufferMin: number;
  readyBufferCap: number;
  candidateAttemptBudget: number;
  candidatesToRequest: number;
}>;

export type ProjectKingsSourceRefillResult = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_SOURCE_REFILL_RESULT_VERSION;
  sourceBufferEvidenceSha256: string;
  imported: number;
  existing: number;
  failed: number;
  channels: readonly Readonly<{
    profileKey: ProjectKingsPilotProfileKey;
    channelId: string;
    qualifiedAvailableBefore: number;
    qualifiedAvailableAfter: number;
    readyBufferMin: number;
    readyBufferCap: number;
    deficitAfter: number;
  }>[];
  failures: readonly Readonly<{
    candidateId: string;
    profileKey: ProjectKingsPilotProfileKey;
    error: string;
  }>[];
}>;

type SourceMediaInspector = (
  absolutePath: string,
  relativePath: string
) => Promise<ProjectKingsSourceMediaInspection>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeArtifactPath(repoRoot: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Qualified source artifact path must be relative to the repository root.");
  }
  const absolutePath = path.resolve(repoRoot, relativePath);
  const boundary = path.relative(path.resolve(repoRoot), absolutePath);
  if (!boundary || boundary.startsWith("..") || path.isAbsolute(boundary)) {
    throw new Error("Qualified source artifact path escapes the repository root.");
  }
  return absolutePath;
}

export function isProjectKingsSourceCandidateProductionReady(
  candidate: ChannelSourceCandidateRecord
): boolean {
  if (!isChannelSourceCandidateQualified(candidate)) return false;
  const imported = candidate.evidence as Record<string, unknown>;
  if (imported.schemaVersion !== PROJECT_KINGS_IMPORTED_SOURCE_EVIDENCE_VERSION) {
    return false;
  }
  const qualification = imported.qualification;
  if (!qualification || typeof qualification !== "object" || Array.isArray(qualification)) {
    return false;
  }
  try {
    verifyProjectKingsSourceQualificationEvidence(
      qualification as ProjectKingsSourceQualificationEvidence
    );
    const activeApproval = getActiveProjectKingsSourcePolicyApproval(candidate.workspaceId);
    const sourcePolicy = (
      qualification as ProjectKingsSourceQualificationEvidence
    ).sourcePolicy;
    return Boolean(activeApproval) &&
      activeApproval?.approvalSha256 === sourcePolicy.approvalSha256;
  } catch {
    return false;
  }
}

export function assertProjectKingsSourceQualificationApprovalActive(input: {
  workspaceId: string;
  qualificationEvidence: ProjectKingsSourceQualificationEvidence;
}): void {
  const activeApproval = getActiveProjectKingsSourcePolicyApproval(input.workspaceId);
  if (
    !activeApproval ||
    activeApproval.approvalSha256 !==
      input.qualificationEvidence.sourcePolicy.approvalSha256
  ) {
    throw new Error(
      "Qualification evidence is not bound to the active Project Kings source policy approval."
    );
  }
}

function availableQualified(workspaceId: string, channelId: string): ChannelSourceCandidateRecord[] {
  return listChannelSourceCandidates({
    workspaceId,
    channelId,
    status: "available",
    qualificationStatus: "qualified",
    limit: 1000
  }).filter((candidate) =>
    candidate.rightsStatus === "owner_approved_source_pool" &&
    isProjectKingsSourceCandidateProductionReady(candidate)
  );
}

export function decideProjectKingsSourceRefill(input: {
  qualifiedAvailable: number;
  readyBufferMin?: number;
  readyBufferCap?: number;
  candidateAttemptBudget?: number;
}): ProjectKingsSourceRefillDecision {
  if (!Number.isInteger(input.qualifiedAvailable) || input.qualifiedAvailable < 0) {
    throw new Error("qualifiedAvailable must be a non-negative integer.");
  }
  const readyBufferMin = positiveInteger(input.readyBufferMin ?? 6, "readyBufferMin");
  const readyBufferCap = positiveInteger(input.readyBufferCap ?? 12, "readyBufferCap");
  const candidateAttemptBudget = positiveInteger(
    input.candidateAttemptBudget ?? 9,
    "candidateAttemptBudget"
  );
  if (readyBufferCap < readyBufferMin) {
    throw new Error("readyBufferCap cannot be smaller than readyBufferMin.");
  }
  const shouldRefill = input.qualifiedAvailable < readyBufferMin;
  return {
    shouldRefill,
    qualifiedAvailable: input.qualifiedAvailable,
    readyBufferMin,
    readyBufferCap,
    candidateAttemptBudget,
    candidatesToRequest: shouldRefill
      ? Math.min(candidateAttemptBudget, Math.max(0, readyBufferCap - input.qualifiedAvailable))
      : 0
  };
}

export function createProjectKingsSourceRefillRequest(input: {
  workspaceId: string;
  profileKey: ProjectKingsPilotProfileKey;
  profileVersion: string;
  requestedAt: string;
  qualifiedAvailable: number;
  readyBufferMin?: number;
  readyBufferCap?: number;
  candidateAttemptBudget?: number;
}): ProjectKingsSourceRefillRequest | null {
  const profile = PROJECT_KINGS_PILOT_PROFILES[input.profileKey];
  const decision = decideProjectKingsSourceRefill(input);
  if (!decision.shouldRefill) return null;
  const identity = [
    input.workspaceId,
    profile.profileId,
    input.profileVersion,
    input.requestedAt.slice(0, 10),
    decision.qualifiedAvailable,
    decision.readyBufferCap,
    decision.candidateAttemptBudget
  ].join(":");
  return {
    schemaVersion: PROJECT_KINGS_SOURCE_REFILL_REQUEST_VERSION,
    requestId: `source-refill-${sha256(identity).slice(0, 32)}`,
    workspaceId: input.workspaceId,
    channelId: profile.profileId,
    profileKey: input.profileKey,
    profileVersion: input.profileVersion,
    requestedAt: input.requestedAt,
    reason: "ready_buffer_below_minimum",
    currentQualifiedAvailable: decision.qualifiedAvailable,
    readyBufferMin: decision.readyBufferMin,
    readyBufferCap: decision.readyBufferCap,
    candidateAttemptBudget: decision.candidateAttemptBudget,
    candidatesToRequest: decision.candidatesToRequest
  };
}

/**
 * Bridges frozen, hash-bound readiness evidence into the generic durable source pool.
 * It never upgrades rights, invents qualification, or trusts a path without decoding
 * and hashing the exact bytes again.
 */
export async function importQualifiedProjectKingsSourceBuffer(input: {
  workspaceId: string;
  repoRoot: string;
  evidence: ProjectKingsSourceBufferReadinessEvidence;
  inspectMedia?: SourceMediaInspector;
  readyBufferMin?: number;
  readyBufferCap?: number;
}): Promise<ProjectKingsSourceRefillResult> {
  verifyProjectKingsSourceBufferReadinessEvidence(input.evidence);
  const inspectMedia = input.inspectMedia ?? inspectProjectKingsSourceMedia;
  const readyBufferMin = positiveInteger(input.readyBufferMin ?? 6, "readyBufferMin");
  const readyBufferCap = positiveInteger(input.readyBufferCap ?? 12, "readyBufferCap");
  if (readyBufferCap < readyBufferMin) {
    throw new Error("readyBufferCap cannot be smaller than readyBufferMin.");
  }

  let imported = 0;
  let existing = 0;
  const failures: Array<{
    candidateId: string;
    profileKey: ProjectKingsPilotProfileKey;
    error: string;
  }> = [];
  const channels: Array<ProjectKingsSourceRefillResult["channels"][number]> = [];

  for (const channel of input.evidence.channels) {
    const profile = PROJECT_KINGS_PILOT_PROFILES[channel.profileKey];
    if (channel.profileId !== profile.profileId || channel.youtubeChannelId !== profile.youtube.channelId) {
      throw new Error(`Source-buffer channel identity mismatch for ${channel.profileKey}.`);
    }
    const before = availableQualified(input.workspaceId, profile.profileId).length;
    let current = before;
    for (const candidate of channel.candidates) {
      if (current >= readyBufferCap) break;
      if (
        candidate.qualificationStatus !== "qualified" ||
        candidate.rightsStatus !== "owner_approved_source_pool" ||
        !candidate.qualificationEvidence ||
        !candidate.localMedia.selected
      ) {
        continue;
      }
      try {
        assertProjectKingsSourceQualificationApprovalActive({
          workspaceId: input.workspaceId,
          qualificationEvidence: candidate.qualificationEvidence
        });
        const selected = candidate.localMedia.selected;
        const absolutePath = safeArtifactPath(input.repoRoot, selected.relativePath);
        const inspected = await inspectMedia(absolutePath, selected.relativePath);
        if (!inspected.decodeComplete) {
          throw new Error(`Exact source does not fully decode: ${inspected.decodeError ?? "unknown error"}`);
        }
        if (inspected.contentSha256 !== selected.contentSha256 ||
            inspected.contentSha256 !== candidate.qualificationEvidence.contentSha256) {
          throw new Error("Exact source SHA-256 differs from qualification evidence.");
        }
        if (candidate.storyEventId !== candidate.qualificationEvidence.eventFingerprint) {
          throw new Error("Candidate event fingerprint differs from qualification evidence.");
        }
        const qualificationEvidence = {
          schemaVersion: PROJECT_KINGS_IMPORTED_SOURCE_EVIDENCE_VERSION,
          sourceBufferEvidenceSha256: input.evidence.evidenceSha256,
          qualification: candidate.qualificationEvidence,
          localArtifact: inspected
        };
        const upserted = upsertChannelSourceCandidate({
          workspaceId: input.workspaceId,
          channelId: profile.profileId,
          provider: candidate.provider,
          sourceUrl: candidate.sourceUrl,
          canonicalUrl: candidate.canonicalUrl,
          contentSha256: inspected.contentSha256,
          eventFingerprint: candidate.qualificationEvidence.eventFingerprint,
          categoryKey: profile.concept.conceptId,
          rightsStatus: "owner_approved_source_pool",
          evidence: qualificationEvidence
        });
        if (!upserted.created) {
          const stored = upserted.candidate;
          if (
            stored.rightsStatus !== "owner_approved_source_pool" ||
            stored.contentSha256 !== inspected.contentSha256 ||
            stored.eventFingerprint !== candidate.qualificationEvidence.eventFingerprint
          ) {
            throw new Error(
              `Existing ${upserted.duplicateBy ?? "source"} record has a different immutable binding or rights status.`
            );
          }
          if (!isProjectKingsSourceCandidateProductionReady(stored)) {
            if (stored.canonicalUrl !== candidate.canonicalUrl) {
              throw new Error("An unqualified duplicate cannot inherit evidence from another canonical URL.");
            }
            transitionChannelSourceCandidateQualification({
              candidateId: stored.id,
              toStatus: "qualified",
              contentSha256: inspected.contentSha256,
              eventFingerprint: candidate.qualificationEvidence.eventFingerprint,
              evidence: qualificationEvidence
            });
            imported += 1;
            current += 1;
          } else {
            existing += 1;
          }
          continue;
        }
        transitionChannelSourceCandidateQualification({
          candidateId: upserted.candidate.id,
          toStatus: "qualified",
          contentSha256: inspected.contentSha256,
          eventFingerprint: candidate.qualificationEvidence.eventFingerprint,
          evidence: qualificationEvidence
        });
        imported += 1;
        current += 1;
      } catch (error) {
        failures.push({
          candidateId: candidate.candidateId,
          profileKey: channel.profileKey,
          error: asErrorMessage(error)
        });
      }
    }
    const after = availableQualified(input.workspaceId, profile.profileId).length;
    channels.push({
      profileKey: channel.profileKey,
      channelId: profile.profileId,
      qualifiedAvailableBefore: before,
      qualifiedAvailableAfter: after,
      readyBufferMin,
      readyBufferCap,
      deficitAfter: Math.max(0, readyBufferMin - after)
    });
  }

  return {
    schemaVersion: PROJECT_KINGS_SOURCE_REFILL_RESULT_VERSION,
    sourceBufferEvidenceSha256: input.evidence.evidenceSha256,
    imported,
    existing,
    failed: failures.length,
    channels,
    failures
  };
}

/**
 * Production-side equivalent of the local evidence importer. Zoro uploads the
 * exact approved bytes first; the server then re-reads, fully decodes and hashes
 * that durable upload before admitting it. The canonical URL remains the donor
 * URL, while sourceUrl is the sticky upload used by the production runtime.
 */
export async function importUploadedQualifiedProjectKingsSource(input: {
  workspaceId: string;
  profileKey: ProjectKingsPilotProfileKey;
  uploadedSourceUrl: string;
  sourceBufferEvidenceSha256: string;
  qualificationEvidence: ProjectKingsSourceQualificationEvidence;
  inspectMedia?: SourceMediaInspector;
}): Promise<{ candidate: ChannelSourceCandidateRecord; created: boolean }> {
  if (!isUploadedSourceUrl(input.uploadedSourceUrl)) {
    throw new Error("uploadedSourceUrl must use the upload: protocol.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.sourceBufferEvidenceSha256)) {
    throw new Error("sourceBufferEvidenceSha256 must be a lowercase SHA-256 digest.");
  }
  verifyProjectKingsSourceQualificationEvidence(input.qualificationEvidence);
  assertProjectKingsSourceQualificationApprovalActive({
    workspaceId: input.workspaceId,
    qualificationEvidence: input.qualificationEvidence
  });
  const profile = PROJECT_KINGS_PILOT_PROFILES[input.profileKey];
  if (
    input.qualificationEvidence.profileKey !== input.profileKey ||
    input.qualificationEvidence.profileId !== profile.profileId ||
    input.qualificationEvidence.rightsStatus !== "owner_approved_source_pool"
  ) {
    throw new Error("Qualification evidence belongs to another profile or source policy.");
  }
  const cached = await getCachedSourceMedia(input.uploadedSourceUrl);
  if (!cached) throw new Error("Uploaded source is missing from durable source storage.");
  const inspected = await (input.inspectMedia ?? inspectProjectKingsSourceMedia)(
    cached.sourcePath,
    input.uploadedSourceUrl
  );
  if (!inspected.decodeComplete) {
    throw new Error(`Uploaded source does not fully decode: ${inspected.decodeError ?? "unknown error"}`);
  }
  if (inspected.contentSha256 !== input.qualificationEvidence.contentSha256) {
    throw new Error("Uploaded source SHA-256 differs from qualification evidence.");
  }
  const storedEvidence = {
    schemaVersion: PROJECT_KINGS_IMPORTED_SOURCE_EVIDENCE_VERSION,
    sourceBufferEvidenceSha256: input.sourceBufferEvidenceSha256,
    qualification: input.qualificationEvidence,
    durableSourceUrl: input.uploadedSourceUrl,
    originalSourceUrl: input.qualificationEvidence.sourceUrl,
    localArtifact: inspected
  };
  const upserted = upsertChannelSourceCandidate({
    workspaceId: input.workspaceId,
    channelId: profile.profileId,
    provider: input.qualificationEvidence.provider,
    sourceUrl: input.uploadedSourceUrl,
    canonicalUrl: input.qualificationEvidence.canonicalUrl,
    contentSha256: inspected.contentSha256,
    eventFingerprint: input.qualificationEvidence.eventFingerprint,
    categoryKey: profile.concept.conceptId,
    rightsStatus: "owner_approved_source_pool",
    evidence: storedEvidence
  });
  if (!upserted.created) {
    if (
      upserted.candidate.rightsStatus !== "owner_approved_source_pool" ||
      upserted.candidate.contentSha256 !== inspected.contentSha256 ||
      upserted.candidate.eventFingerprint !== input.qualificationEvidence.eventFingerprint ||
      !isProjectKingsSourceCandidateProductionReady(upserted.candidate)
    ) {
      throw new Error(
        `Existing ${upserted.duplicateBy ?? "source"} record is not the same qualified immutable source.`
      );
    }
    return { candidate: upserted.candidate, created: false };
  }
  const candidate = transitionChannelSourceCandidateQualification({
    candidateId: upserted.candidate.id,
    toStatus: "qualified",
    contentSha256: inspected.contentSha256,
    eventFingerprint: input.qualificationEvidence.eventFingerprint,
    evidence: storedEvidence
  });
  return { candidate, created: true };
}
