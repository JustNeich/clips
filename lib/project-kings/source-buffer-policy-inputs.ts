import {
  createProjectKingsSensitiveContentAssessment,
  createProjectKingsSourceDesignationEvidence,
  createProjectKingsSourcePolicyApproval,
  evaluateProjectKingsSourcePolicy,
  type ProjectKingsSensitiveContentAssessment,
  type ProjectKingsSensitiveSignal,
  type ProjectKingsSourceDesignationEvidence,
  type ProjectKingsSourcePolicyApproval
} from "./source-rights-sensitive-policy";
import type {
  ProjectKingsSourceBufferReadinessEvidence,
  ProjectKingsSourcePolicyCandidateArtifacts
} from "./source-buffer-readiness";

type UnknownRecord = Record<string, unknown>;

const SHA256 = /^[a-f0-9]{64}$/;
const PROFILE_KEYS = ["dark-joy-boy", "light-kingdom", "copscopes-x2e"] as const;
const PROVIDERS = ["instagram", "youtube_ask"] as const;
const ROUTES = ["instagram_donor_pool", "youtube_ask_v3"] as const;
const RIGHTS_STATUSES = ["covered_by_approved_source_policy", "unknown", "rejected"] as const;
const SENSITIVE_SIGNALS = ["absent", "present", "unknown"] as const;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${label} must contain exactly: ${required.join(", ")}.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  const result = text(value, label);
  if (!SHA256.test(result)) throw new Error(`${label} must be a lowercase SHA-256.`);
  return result;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string
): T[number] {
  if (!allowed.includes(value as T[number])) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T[number];
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as UnknownRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function assertExactArtifact(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error(`${label} is not a valid hash-bound artifact for the active source policy.`);
  }
}

export function parseProjectKingsSourcePolicyApprovalArtifact(
  raw: unknown
): ProjectKingsSourcePolicyApproval {
  const value = record(raw, "policy approval");
  exactKeys(value, [
    "approvalVersion",
    "approvalId",
    "ownerPrincipalId",
    "ownerAuthorizationEvidenceSha256",
    "decision",
    "policyVersion",
    "policySha256",
    "sourceDesignations",
    "sourceDesignationsSha256",
    "approvedAt",
    "approvalSha256"
  ], "policy approval");
  const expected = createProjectKingsSourcePolicyApproval({
    approvalId: text(value.approvalId, "policy approval.approvalId"),
    ownerPrincipalId: text(value.ownerPrincipalId, "policy approval.ownerPrincipalId"),
    ownerAuthorizationEvidenceSha256: sha256(
      value.ownerAuthorizationEvidenceSha256,
      "policy approval.ownerAuthorizationEvidenceSha256"
    ),
    approvedAt: text(value.approvedAt, "policy approval.approvedAt")
  });
  assertExactArtifact(value, expected, "policy approval");
  return expected;
}

function parseDesignation(raw: unknown, label: string): ProjectKingsSourceDesignationEvidence {
  const value = record(raw, label);
  exactKeys(value, [
    "evidenceVersion",
    "candidateId",
    "profileKey",
    "provider",
    "route",
    "donorUsername",
    "canonicalSourceUrl",
    "rightsEvidenceStatus",
    "upstreamDiscoveryEvidenceSha256",
    "evidenceSha256"
  ], label);
  const expected = createProjectKingsSourceDesignationEvidence({
    candidateId: text(value.candidateId, `${label}.candidateId`),
    profileKey: oneOf(value.profileKey, PROFILE_KEYS, `${label}.profileKey`),
    provider: oneOf(value.provider, PROVIDERS, `${label}.provider`),
    route: oneOf(value.route, ROUTES, `${label}.route`),
    donorUsername: nullableText(value.donorUsername, `${label}.donorUsername`),
    canonicalSourceUrl: text(value.canonicalSourceUrl, `${label}.canonicalSourceUrl`),
    rightsEvidenceStatus: oneOf(
      value.rightsEvidenceStatus,
      RIGHTS_STATUSES,
      `${label}.rightsEvidenceStatus`
    ),
    upstreamDiscoveryEvidenceSha256: sha256(
      value.upstreamDiscoveryEvidenceSha256,
      `${label}.upstreamDiscoveryEvidenceSha256`
    )
  });
  assertExactArtifact(value, expected, label);
  return expected;
}

function parseSignal(value: unknown, label: string): ProjectKingsSensitiveSignal {
  return oneOf(value, SENSITIVE_SIGNALS, label);
}

function parseSensitiveAssessment(
  raw: unknown,
  label: string
): ProjectKingsSensitiveContentAssessment {
  const value = record(raw, label);
  exactKeys(value, [
    "assessmentVersion",
    "candidateId",
    "contentSha256",
    "assessorKind",
    "upstreamEvidenceSha256",
    "signals",
    "assessmentSha256"
  ], label);
  const signals = record(value.signals, `${label}.signals`);
  exactKeys(signals, [
    "graphicViolence",
    "unsupportedAllegation",
    "minorInSensitiveIncident",
    "realisticPoliticalOrPublicFigureDeepfake"
  ], `${label}.signals`);
  const expected = createProjectKingsSensitiveContentAssessment({
    candidateId: text(value.candidateId, `${label}.candidateId`),
    contentSha256: sha256(value.contentSha256, `${label}.contentSha256`),
    upstreamEvidenceSha256: sha256(
      value.upstreamEvidenceSha256,
      `${label}.upstreamEvidenceSha256`
    ),
    signals: {
      graphicViolence: parseSignal(signals.graphicViolence, `${label}.signals.graphicViolence`),
      unsupportedAllegation: parseSignal(
        signals.unsupportedAllegation,
        `${label}.signals.unsupportedAllegation`
      ),
      minorInSensitiveIncident: parseSignal(
        signals.minorInSensitiveIncident,
        `${label}.signals.minorInSensitiveIncident`
      ),
      realisticPoliticalOrPublicFigureDeepfake: parseSignal(
        signals.realisticPoliticalOrPublicFigureDeepfake,
        `${label}.signals.realisticPoliticalOrPublicFigureDeepfake`
      )
    }
  });
  assertExactArtifact(value, expected, label);
  return expected;
}

function parseCandidateArtifacts(
  raw: unknown,
  approval: ProjectKingsSourcePolicyApproval | null
): readonly ProjectKingsSourcePolicyCandidateArtifacts[] {
  if (!Array.isArray(raw)) throw new Error("policy artifacts must be a JSON array.");
  const seenCandidateIds = new Set<string>();
  return Object.freeze(raw.map((entry, index) => {
    const label = `policy artifacts[${index}]`;
    const value = record(entry, label);
    exactKeys(value, ["candidateId", "discoveryState", "designation", "sensitiveAssessment"], label);
    const candidateId = text(value.candidateId, `${label}.candidateId`);
    if (seenCandidateIds.has(candidateId)) {
      throw new Error(`policy artifacts contains duplicate candidateId ${candidateId}.`);
    }
    seenCandidateIds.add(candidateId);
    const discoveryState = oneOf(
      value.discoveryState,
      ["frozen_catalog", "discovery_only"] as const,
      `${label}.discoveryState`
    );
    const designation = parseDesignation(value.designation, `${label}.designation`);
    const sensitiveAssessment = parseSensitiveAssessment(
      value.sensitiveAssessment,
      `${label}.sensitiveAssessment`
    );
    if (designation.candidateId !== candidateId || sensitiveAssessment.candidateId !== candidateId) {
      throw new Error(`${label} candidateId is not bound to both nested artifacts.`);
    }
    const verdict = evaluateProjectKingsSourcePolicy({
      candidateId,
      profileKey: designation.profileKey,
      canonicalSourceUrl: designation.canonicalSourceUrl,
      contentSha256: sensitiveAssessment.contentSha256,
      discoveryState,
      sourceDesignation: designation,
      sensitiveAssessment
    }, {
      evaluatedAt: approval?.approvedAt ?? "1970-01-01T00:00:00.000Z",
      policyApproval: approval
    });
    const invalidIssues = verdict.issues.filter((issue) =>
      issue.endsWith("_invalid") ||
      issue.endsWith("_binding_mismatch") ||
      issue === "candidate_identity_invalid" ||
      issue === "source_url_invalid" ||
      issue === "content_hash_invalid" ||
      issue === "source_route_not_designated" ||
      issue === "donor_not_designated"
    );
    if (invalidIssues.length > 0) {
      throw new Error(`${label} is structurally invalid: ${invalidIssues.join(", ")}.`);
    }
    return Object.freeze({ candidateId, discoveryState, designation, sensitiveAssessment });
  }));
}

export function parseProjectKingsSourcePolicyCandidateArtifactsStructure(
  raw: unknown
): readonly ProjectKingsSourcePolicyCandidateArtifacts[] {
  return parseCandidateArtifacts(raw, null);
}

export function parseProjectKingsSourcePolicyCandidateArtifacts(
  raw: unknown,
  approval: ProjectKingsSourcePolicyApproval
): readonly ProjectKingsSourcePolicyCandidateArtifacts[] {
  return parseCandidateArtifacts(raw, approval);
}

export function assertProjectKingsSourcePolicyArtifactsBoundToReadiness(
  evidence: ProjectKingsSourceBufferReadinessEvidence,
  artifacts: readonly ProjectKingsSourcePolicyCandidateArtifacts[]
): void {
  const candidates = new Map(
    evidence.channels.flatMap((channel) => channel.candidates.map((candidate) => [
      candidate.candidateId,
      candidate
    ] as const))
  );
  for (const artifact of artifacts) {
    const candidate = candidates.get(artifact.candidateId);
    if (!candidate) {
      throw new Error(
        `policy artifact ${artifact.candidateId} has no exact candidateId match in source-buffer readiness.`
      );
    }
    if (
      artifact.designation.profileKey !== candidate.profileKey ||
      artifact.designation.canonicalSourceUrl !== candidate.canonicalUrl ||
      artifact.sensitiveAssessment.contentSha256 !== candidate.localMedia.selected?.contentSha256
    ) {
      throw new Error(
        `policy artifact ${artifact.candidateId} does not match readiness profileKey + canonicalUrl + contentSha256.`
      );
    }
  }
}
