import { createHash } from "node:crypto";

import type { ProjectKingsPilotProfileKey } from "./pilot-production-profiles";

export const PROJECT_KINGS_SOURCE_POLICY_VERSION =
  "project-kings-source-rights-sensitive-policy-v2" as const;
export const PROJECT_KINGS_SOURCE_POLICY_APPROVAL_VERSION =
  "project-kings-source-policy-approval-v1" as const;
export const PROJECT_KINGS_SOURCE_DESIGNATION_VERSION =
  "project-kings-source-designation-evidence-v2" as const;
export const PROJECT_KINGS_SENSITIVE_ASSESSMENT_VERSION =
  "project-kings-sensitive-content-assessment-v1" as const;
export const PROJECT_KINGS_SOURCE_POLICY_VERDICT_VERSION =
  "project-kings-source-policy-verdict-v1" as const;

export type ProjectKingsSourceDesignationPolicy = Readonly<
  Record<
    ProjectKingsPilotProfileKey,
    Readonly<{
      instagramDonors: readonly string[];
      youtubeAsk: boolean;
    }>
  >
>;

const SOURCE_DESIGNATIONS = Object.freeze({
  "dark-joy-boy": Object.freeze({
    instagramDonors: Object.freeze([
      "kodyantle",
      "spidermonkeywinston",
      "myrtlebeachsafari",
      "realdiddykong"
    ]),
    youtubeAsk: false
  }),
  "light-kingdom": Object.freeze({
    instagramDonors: Object.freeze(["learnaifaster"]),
    youtubeAsk: true
  }),
  "copscopes-x2e": Object.freeze({
    instagramDonors: Object.freeze(["copscopes"]),
    youtubeAsk: false
  })
} as const satisfies ProjectKingsSourceDesignationPolicy);

export const PROJECT_KINGS_SOURCE_POLICY = Object.freeze({
  policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
  legalGuarantee: false,
  conceptFitIsSeparate: true,
  perCandidateOwnerDecisionRequired: false,
  ownerApprovalBoundary: "one_time_versioned_policy_and_routes",
  candidateVerdictMode: "automatic_exact_artifact_binding",
  frozenCatalogRule: "approved_policy_and_exact_provenance_required",
  dynamicDiscoveryDisposition: "discovery_only",
  unknownRightsDisposition: "policy_blocked",
  unknownSensitiveSignalDisposition: "policy_blocked",
  sourceDesignations: SOURCE_DESIGNATIONS,
  blockedSensitiveSignals: Object.freeze([
    "graphic_violence",
    "unsupported_allegation",
    "minor_in_sensitive_incident",
    "realistic_political_or_public_figure_deepfake"
  ])
} as const);

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export function hashProjectKingsSourcePolicyArtifact(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

// These literals are intentionally not calculated at runtime. Any policy edit
// must receive a new version and newly reviewed frozen hashes.
export const PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256 =
  "a6452b6d6bd2e4721560df7238b47a3096c08ba978a4e1c614912612d547e4b4" as const;
export const PROJECT_KINGS_SOURCE_POLICY_SHA256 =
  "b6664c4364c4a3b172a1f1d653e3d100604e98f5ef1b33857324691fa894eb39" as const;

const calculatedSourceDesignationsSha256 = hashProjectKingsSourcePolicyArtifact(
  PROJECT_KINGS_SOURCE_POLICY.sourceDesignations
);
const calculatedPolicySha256 = hashProjectKingsSourcePolicyArtifact(
  PROJECT_KINGS_SOURCE_POLICY
);
if (
  calculatedSourceDesignationsSha256 !== PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256 ||
  calculatedPolicySha256 !== PROJECT_KINGS_SOURCE_POLICY_SHA256
) {
  throw new Error(
    "Project Kings source policy hash mismatch: " +
      `designations expected ${PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256}, calculated ${calculatedSourceDesignationsSha256}; ` +
      `policy expected ${PROJECT_KINGS_SOURCE_POLICY_SHA256}, calculated ${calculatedPolicySha256}`
  );
}

export type ProjectKingsSourcePolicyApproval = Readonly<{
  approvalVersion: typeof PROJECT_KINGS_SOURCE_POLICY_APPROVAL_VERSION;
  approvalId: string;
  ownerPrincipalId: string;
  ownerAuthorizationEvidenceSha256: string;
  decision: "approved_policy_and_designated_source_routes";
  policyVersion: typeof PROJECT_KINGS_SOURCE_POLICY_VERSION;
  policySha256: typeof PROJECT_KINGS_SOURCE_POLICY_SHA256;
  sourceDesignations: ProjectKingsSourceDesignationPolicy;
  sourceDesignationsSha256: typeof PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256;
  approvedAt: string;
  approvalSha256: string;
}>;

export type ProjectKingsSourceRoute =
  | "instagram_donor_pool"
  | "youtube_ask_v3";

export type ProjectKingsRightsEvidenceStatus =
  | "covered_by_approved_source_policy"
  | "unknown"
  | "rejected";

export type ProjectKingsSourceDesignationEvidence = Readonly<{
  evidenceVersion: typeof PROJECT_KINGS_SOURCE_DESIGNATION_VERSION;
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  provider: "instagram" | "youtube_ask";
  route: ProjectKingsSourceRoute;
  donorUsername: string | null;
  canonicalSourceUrl: string;
  rightsEvidenceStatus: ProjectKingsRightsEvidenceStatus;
  upstreamDiscoveryEvidenceSha256: string;
  evidenceSha256: string;
}>;

export type ProjectKingsSensitiveSignal = "absent" | "present" | "unknown";

export type ProjectKingsSensitiveContentAssessment = Readonly<{
  assessmentVersion: typeof PROJECT_KINGS_SENSITIVE_ASSESSMENT_VERSION;
  candidateId: string;
  contentSha256: string;
  assessorKind: "independent_policy_agent";
  upstreamEvidenceSha256: string;
  signals: Readonly<{
    graphicViolence: ProjectKingsSensitiveSignal;
    unsupportedAllegation: ProjectKingsSensitiveSignal;
    minorInSensitiveIncident: ProjectKingsSensitiveSignal;
    realisticPoliticalOrPublicFigureDeepfake: ProjectKingsSensitiveSignal;
  }>;
  assessmentSha256: string;
}>;

export type ProjectKingsSourcePolicyCandidate = Readonly<{
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  canonicalSourceUrl: string;
  contentSha256: string;
  discoveryState: "frozen_catalog" | "discovery_only";
  sourceDesignation: ProjectKingsSourceDesignationEvidence;
  sensitiveAssessment?: ProjectKingsSensitiveContentAssessment | null;
}>;

export type ProjectKingsSourcePolicyIssueCode =
  | "dynamic_discovery_not_qualified"
  | "candidate_identity_invalid"
  | "source_url_invalid"
  | "content_hash_invalid"
  | "source_designation_invalid"
  | "source_designation_binding_mismatch"
  | "source_route_not_designated"
  | "donor_not_designated"
  | "rights_unknown"
  | "rights_rejected"
  | "policy_approval_missing"
  | "policy_approval_invalid"
  | "policy_approval_binding_mismatch"
  | "sensitive_assessment_missing"
  | "sensitive_assessment_invalid"
  | "sensitive_assessment_binding_mismatch"
  | "sensitive_classification_unknown"
  | "graphic_violence"
  | "unsupported_allegation"
  | "minor_in_sensitive_incident"
  | "realistic_political_or_public_figure_deepfake";

export type ProjectKingsSourcePolicyVerdict = Readonly<{
  verdictVersion: typeof PROJECT_KINGS_SOURCE_POLICY_VERDICT_VERSION;
  policyVersion: typeof PROJECT_KINGS_SOURCE_POLICY_VERSION;
  policySha256: typeof PROJECT_KINGS_SOURCE_POLICY_SHA256;
  legalGuarantee: false;
  conceptFitEvaluated: false;
  automaticVerdict: true;
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  contentSha256: string;
  policyApprovalSha256: string | null;
  sourceDesignationEvidenceSha256: string;
  sensitiveAssessmentSha256: string | null;
  inputBindingSha256: string;
  disposition: "pass" | "policy_blocked" | "discovery_only";
  eligibleForSourceFit: boolean;
  issues: readonly ProjectKingsSourcePolicyIssueCode[];
  evaluatedAt: string;
  verdictSha256: string;
}>;

/** @deprecated Use ProjectKingsSourcePolicyVerdict. */
export type ProjectKingsSourcePolicyEvaluation = ProjectKingsSourcePolicyVerdict;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function artifactPayload(
  artifact: Readonly<Record<string, unknown>>,
  hashKey: string
): Record<string, unknown> {
  const payload = { ...artifact };
  delete payload[hashKey];
  return payload;
}

function assertArtifactInput(condition: boolean, message: string): void {
  if (!condition) throw new TypeError(message);
}

function snapshotSourceDesignations(): ProjectKingsSourceDesignationPolicy {
  return Object.freeze({
    "dark-joy-boy": Object.freeze({
      instagramDonors: Object.freeze([
        ...PROJECT_KINGS_SOURCE_POLICY.sourceDesignations["dark-joy-boy"]
          .instagramDonors
      ]),
      youtubeAsk:
        PROJECT_KINGS_SOURCE_POLICY.sourceDesignations["dark-joy-boy"].youtubeAsk
    }),
    "light-kingdom": Object.freeze({
      instagramDonors: Object.freeze([
        ...PROJECT_KINGS_SOURCE_POLICY.sourceDesignations["light-kingdom"]
          .instagramDonors
      ]),
      youtubeAsk:
        PROJECT_KINGS_SOURCE_POLICY.sourceDesignations["light-kingdom"].youtubeAsk
    }),
    "copscopes-x2e": Object.freeze({
      instagramDonors: Object.freeze([
        ...PROJECT_KINGS_SOURCE_POLICY.sourceDesignations["copscopes-x2e"]
          .instagramDonors
      ]),
      youtubeAsk:
        PROJECT_KINGS_SOURCE_POLICY.sourceDesignations["copscopes-x2e"].youtubeAsk
    })
  });
}

export function createProjectKingsSourcePolicyApproval(input: {
  approvalId: string;
  ownerPrincipalId: string;
  ownerAuthorizationEvidenceSha256: string;
  approvedAt: string;
}): ProjectKingsSourcePolicyApproval {
  assertArtifactInput(isNonEmpty(input.approvalId), "approvalId is required");
  assertArtifactInput(isNonEmpty(input.ownerPrincipalId), "ownerPrincipalId is required");
  assertArtifactInput(
    isSha256(input.ownerAuthorizationEvidenceSha256),
    "ownerAuthorizationEvidenceSha256 must be a lowercase SHA-256"
  );
  assertArtifactInput(isIsoTimestamp(input.approvedAt), "approvedAt must be an ISO timestamp");
  const payload = {
    approvalVersion: PROJECT_KINGS_SOURCE_POLICY_APPROVAL_VERSION,
    approvalId: input.approvalId,
    ownerPrincipalId: input.ownerPrincipalId,
    ownerAuthorizationEvidenceSha256: input.ownerAuthorizationEvidenceSha256,
    decision: "approved_policy_and_designated_source_routes" as const,
    policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
    policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
    sourceDesignations: snapshotSourceDesignations(),
    sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
    approvedAt: input.approvedAt
  };
  return Object.freeze({
    ...payload,
    approvalSha256: hashProjectKingsSourcePolicyArtifact(payload)
  });
}

export function createProjectKingsSourceDesignationEvidence(input: {
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  provider: "instagram" | "youtube_ask";
  route: ProjectKingsSourceRoute;
  donorUsername: string | null;
  canonicalSourceUrl: string;
  rightsEvidenceStatus: ProjectKingsRightsEvidenceStatus;
  upstreamDiscoveryEvidenceSha256: string;
}): ProjectKingsSourceDesignationEvidence {
  assertArtifactInput(isNonEmpty(input.candidateId), "candidateId is required");
  assertArtifactInput(
    isSha256(input.upstreamDiscoveryEvidenceSha256),
    "upstreamDiscoveryEvidenceSha256 must be a lowercase SHA-256"
  );
  const payload = {
    evidenceVersion: PROJECT_KINGS_SOURCE_DESIGNATION_VERSION,
    candidateId: input.candidateId,
    profileKey: input.profileKey,
    provider: input.provider,
    route: input.route,
    donorUsername: input.donorUsername,
    canonicalSourceUrl: input.canonicalSourceUrl,
    rightsEvidenceStatus: input.rightsEvidenceStatus,
    upstreamDiscoveryEvidenceSha256: input.upstreamDiscoveryEvidenceSha256
  } as const;
  return Object.freeze({
    ...payload,
    evidenceSha256: hashProjectKingsSourcePolicyArtifact(payload)
  });
}

export function createProjectKingsSensitiveContentAssessment(input: {
  candidateId: string;
  contentSha256: string;
  upstreamEvidenceSha256: string;
  signals: ProjectKingsSensitiveContentAssessment["signals"];
}): ProjectKingsSensitiveContentAssessment {
  assertArtifactInput(isNonEmpty(input.candidateId), "candidateId is required");
  assertArtifactInput(isSha256(input.contentSha256), "contentSha256 must be a lowercase SHA-256");
  assertArtifactInput(
    isSha256(input.upstreamEvidenceSha256),
    "upstreamEvidenceSha256 must be a lowercase SHA-256"
  );
  const payload = {
    assessmentVersion: PROJECT_KINGS_SENSITIVE_ASSESSMENT_VERSION,
    candidateId: input.candidateId,
    contentSha256: input.contentSha256,
    assessorKind: "independent_policy_agent" as const,
    upstreamEvidenceSha256: input.upstreamEvidenceSha256,
    signals: Object.freeze({ ...input.signals })
  };
  return Object.freeze({
    ...payload,
    assessmentSha256: hashProjectKingsSourcePolicyArtifact(payload)
  });
}

function sourceUrlMatchesRoute(
  sourceUrl: string,
  route: ProjectKingsSourceRoute
): boolean {
  try {
    const url = new URL(sourceUrl);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      return false;
    }
    if (route === "instagram_donor_pool") {
      return (
        url.hostname === "www.instagram.com" &&
        /^\/reel\/[A-Za-z0-9_-]+\/$/.test(url.pathname) &&
        url.search === ""
      );
    }
    return (
      url.hostname === "www.youtube.com" &&
      url.pathname === "/watch" &&
      /^[A-Za-z0-9_-]{6,}$/.test(url.searchParams.get("v") ?? "") &&
      [...url.searchParams.keys()].every((key) => key === "v")
    );
  } catch {
    return false;
  }
}

function verifyPolicyApproval(
  approval: ProjectKingsSourcePolicyApproval | null | undefined,
  issues: Set<ProjectKingsSourcePolicyIssueCode>
): void {
  if (!approval || typeof approval !== "object") {
    issues.add("policy_approval_missing");
    return;
  }
  let sourceDesignationsSha256: string | null = null;
  let approvalSha256: string | null = null;
  try {
    sourceDesignationsSha256 = hashProjectKingsSourcePolicyArtifact(
      approval.sourceDesignations
    );
    approvalSha256 = hashProjectKingsSourcePolicyArtifact(
      artifactPayload(
        approval as unknown as Readonly<Record<string, unknown>>,
        "approvalSha256"
      )
    );
  } catch {
    // Malformed or legacy artifacts fail closed below; they never crash a run.
  }
  if (
    approval.approvalVersion !== PROJECT_KINGS_SOURCE_POLICY_APPROVAL_VERSION ||
    approval.decision !== "approved_policy_and_designated_source_routes" ||
    !isNonEmpty(approval.approvalId) ||
    !isNonEmpty(approval.ownerPrincipalId) ||
    !isSha256(approval.ownerAuthorizationEvidenceSha256) ||
    !isIsoTimestamp(approval.approvedAt) ||
    !isSha256(approval.approvalSha256) ||
    approvalSha256 !== approval.approvalSha256
  ) {
    issues.add("policy_approval_invalid");
  }
  if (
    approval.policyVersion !== PROJECT_KINGS_SOURCE_POLICY_VERSION ||
    approval.policySha256 !== PROJECT_KINGS_SOURCE_POLICY_SHA256 ||
    approval.sourceDesignationsSha256 !==
      PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256 ||
    sourceDesignationsSha256 !== PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256 ||
    sourceDesignationsSha256 !== approval.sourceDesignationsSha256
  ) {
    issues.add("policy_approval_binding_mismatch");
  }
}

function verifySourceDesignation(
  candidate: ProjectKingsSourcePolicyCandidate,
  issues: Set<ProjectKingsSourcePolicyIssueCode>
): void {
  const designation = candidate.sourceDesignation;
  if (
    designation.evidenceVersion !== PROJECT_KINGS_SOURCE_DESIGNATION_VERSION ||
    !isSha256(designation.upstreamDiscoveryEvidenceSha256) ||
    !isSha256(designation.evidenceSha256) ||
    hashProjectKingsSourcePolicyArtifact(
      artifactPayload(
        designation as unknown as Readonly<Record<string, unknown>>,
        "evidenceSha256"
      )
    ) !== designation.evidenceSha256
  ) {
    issues.add("source_designation_invalid");
  }
  if (
    designation.candidateId !== candidate.candidateId ||
    designation.profileKey !== candidate.profileKey ||
    designation.canonicalSourceUrl !== candidate.canonicalSourceUrl
  ) {
    issues.add("source_designation_binding_mismatch");
  }
  if (designation.rightsEvidenceStatus === "unknown") {
    issues.add("rights_unknown");
  } else if (designation.rightsEvidenceStatus === "rejected") {
    issues.add("rights_rejected");
  }

  const providerMatchesRoute =
    (designation.route === "instagram_donor_pool" && designation.provider === "instagram") ||
    (designation.route === "youtube_ask_v3" && designation.provider === "youtube_ask");
  if (
    !providerMatchesRoute ||
    !sourceUrlMatchesRoute(candidate.canonicalSourceUrl, designation.route)
  ) {
    issues.add("source_url_invalid");
  }

  const profilePolicy = PROJECT_KINGS_SOURCE_POLICY.sourceDesignations[candidate.profileKey];
  if (designation.route === "youtube_ask_v3") {
    if (!profilePolicy.youtubeAsk || designation.donorUsername !== null) {
      issues.add("source_route_not_designated");
    }
    return;
  }
  if (!isNonEmpty(designation.donorUsername)) {
    issues.add("donor_not_designated");
    return;
  }
  const normalizedDonor = designation.donorUsername.toLowerCase();
  if (
    normalizedDonor !== designation.donorUsername ||
    !(profilePolicy.instagramDonors as readonly string[]).includes(normalizedDonor)
  ) {
    issues.add("donor_not_designated");
  }
}

function verifySensitiveAssessment(
  candidate: ProjectKingsSourcePolicyCandidate,
  issues: Set<ProjectKingsSourcePolicyIssueCode>
): void {
  const assessment = candidate.sensitiveAssessment;
  if (!assessment) {
    issues.add("sensitive_assessment_missing");
    return;
  }
  const validSignals = new Set<ProjectKingsSensitiveSignal>([
    "absent",
    "present",
    "unknown"
  ]);
  const signalValues = Object.values(assessment.signals);
  if (
    assessment.assessmentVersion !== PROJECT_KINGS_SENSITIVE_ASSESSMENT_VERSION ||
    assessment.assessorKind !== "independent_policy_agent" ||
    !isSha256(assessment.upstreamEvidenceSha256) ||
    !isSha256(assessment.assessmentSha256) ||
    signalValues.length !== 4 ||
    signalValues.some((signal) => !validSignals.has(signal)) ||
    hashProjectKingsSourcePolicyArtifact(
      artifactPayload(
        assessment as unknown as Readonly<Record<string, unknown>>,
        "assessmentSha256"
      )
    ) !== assessment.assessmentSha256
  ) {
    issues.add("sensitive_assessment_invalid");
  }
  if (
    assessment.candidateId !== candidate.candidateId ||
    assessment.contentSha256 !== candidate.contentSha256
  ) {
    issues.add("sensitive_assessment_binding_mismatch");
  }
  if (signalValues.some((signal) => signal === "unknown")) {
    issues.add("sensitive_classification_unknown");
  }
  if (assessment.signals.graphicViolence === "present") {
    issues.add("graphic_violence");
  }
  if (assessment.signals.unsupportedAllegation === "present") {
    issues.add("unsupported_allegation");
  }
  if (assessment.signals.minorInSensitiveIncident === "present") {
    issues.add("minor_in_sensitive_incident");
  }
  if (assessment.signals.realisticPoliticalOrPublicFigureDeepfake === "present") {
    issues.add("realistic_political_or_public_figure_deepfake");
  }
}

export function evaluateProjectKingsSourcePolicy(
  candidate: ProjectKingsSourcePolicyCandidate,
  options: Readonly<{
    evaluatedAt: string;
    policyApproval: ProjectKingsSourcePolicyApproval | null;
  }>
): ProjectKingsSourcePolicyVerdict {
  if (!isIsoTimestamp(options.evaluatedAt)) {
    throw new TypeError("evaluatedAt must be an ISO timestamp");
  }
  const issues = new Set<ProjectKingsSourcePolicyIssueCode>();
  if (!isNonEmpty(candidate.candidateId)) issues.add("candidate_identity_invalid");
  if (!isSha256(candidate.contentSha256)) issues.add("content_hash_invalid");

  verifyPolicyApproval(options.policyApproval, issues);
  verifySourceDesignation(candidate, issues);
  verifySensitiveAssessment(candidate, issues);

  let disposition: ProjectKingsSourcePolicyVerdict["disposition"];
  if (candidate.discoveryState === "discovery_only") {
    issues.add("dynamic_discovery_not_qualified");
    disposition = "discovery_only";
  } else {
    disposition = issues.size === 0 ? "pass" : "policy_blocked";
  }

  const policyApprovalSha256 = isSha256(options.policyApproval?.approvalSha256)
    ? options.policyApproval.approvalSha256
    : null;
  const inputBindingSha256 = hashProjectKingsSourcePolicyArtifact({
    policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
    policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
    candidateId: candidate.candidateId,
    profileKey: candidate.profileKey,
    canonicalSourceUrl: candidate.canonicalSourceUrl,
    contentSha256: candidate.contentSha256,
    discoveryState: candidate.discoveryState,
    policyApprovalSha256,
    sourceDesignationEvidenceSha256: candidate.sourceDesignation.evidenceSha256,
    sensitiveAssessmentSha256: candidate.sensitiveAssessment?.assessmentSha256 ?? null
  });
  const payload = {
    verdictVersion: PROJECT_KINGS_SOURCE_POLICY_VERDICT_VERSION,
    policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
    policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
    legalGuarantee: false as const,
    conceptFitEvaluated: false as const,
    automaticVerdict: true as const,
    candidateId: candidate.candidateId,
    profileKey: candidate.profileKey,
    contentSha256: candidate.contentSha256,
    policyApprovalSha256,
    sourceDesignationEvidenceSha256: candidate.sourceDesignation.evidenceSha256,
    sensitiveAssessmentSha256: candidate.sensitiveAssessment?.assessmentSha256 ?? null,
    inputBindingSha256,
    disposition,
    eligibleForSourceFit: disposition === "pass",
    issues: Object.freeze([...issues].sort()),
    evaluatedAt: options.evaluatedAt
  };
  return Object.freeze({
    ...payload,
    verdictSha256: hashProjectKingsSourcePolicyArtifact(payload)
  });
}
