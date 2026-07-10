import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  PROJECT_KINGS_PILOT_CANDIDATE_OBSERVATIONS,
  type ProjectKingsPilotCandidateObservation
} from "../lib/project-kings/pilot-source-candidate-catalog";
import {
  PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
  PROJECT_KINGS_SOURCE_POLICY,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION,
  createProjectKingsSensitiveContentAssessment,
  createProjectKingsSourceDesignationEvidence,
  createProjectKingsSourcePolicyApproval,
  evaluateProjectKingsSourcePolicy,
  hashProjectKingsSourcePolicyArtifact,
  type ProjectKingsRightsEvidenceStatus,
  type ProjectKingsSensitiveContentAssessment,
  type ProjectKingsSourcePolicyApproval,
  type ProjectKingsSourcePolicyCandidate
} from "../lib/project-kings/source-rights-sensitive-policy";

const EVALUATED_AT = "2026-07-10T12:00:00.000Z";
const APPROVED_AT = "2026-07-10T11:55:00.000Z";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredObservation(candidateId: string): ProjectKingsPilotCandidateObservation {
  const observation = PROJECT_KINGS_PILOT_CANDIDATE_OBSERVATIONS.find(
    (candidate) => candidate.candidateId === candidateId
  );
  if (!observation) throw new Error(`Frozen catalog observation ${candidateId} is missing`);
  return observation;
}

const frozenCopObservation = requiredObservation("cop-donor-DWnxlyIDcoK");
const secondFrozenCopObservation = requiredObservation("cop-donor-DXNBoz7jYmd");

const policyApproval = createProjectKingsSourcePolicyApproval({
  approvalId: "project-kings-source-policy-v2-owner-approval",
  ownerPrincipalId: "clips-owner",
  ownerAuthorizationEvidenceSha256: sha256("authenticated-owner-control-event"),
  approvedAt: APPROVED_AT
});

function cleanSignals(): ProjectKingsSensitiveContentAssessment["signals"] {
  return {
    graphicViolence: "absent",
    unsupportedAllegation: "absent",
    minorInSensitiveIncident: "absent",
    realisticPoliticalOrPublicFigureDeepfake: "absent"
  };
}

function buildFrozenCopCandidate(input?: {
  observation?: ProjectKingsPilotCandidateObservation;
  contentSeed?: string;
  rightsEvidenceStatus?: ProjectKingsRightsEvidenceStatus;
  donorUsername?: string;
  discoveryState?: ProjectKingsSourcePolicyCandidate["discoveryState"];
  signals?: ProjectKingsSensitiveContentAssessment["signals"];
}): ProjectKingsSourcePolicyCandidate {
  const observation = input?.observation ?? frozenCopObservation;
  const contentSha256 = sha256(input?.contentSeed ?? "exact-cop-donor-media-bytes");
  const sourceDesignation = createProjectKingsSourceDesignationEvidence({
    candidateId: observation.candidateId,
    profileKey: observation.profileKey,
    provider: observation.provider,
    route: "instagram_donor_pool",
    donorUsername: input?.donorUsername ?? "copscopes",
    canonicalSourceUrl: observation.sourceUrl,
    rightsEvidenceStatus:
      input?.rightsEvidenceStatus ?? "covered_by_approved_source_policy",
    upstreamDiscoveryEvidenceSha256: sha256(
      `frozen-catalog-donor-evidence:${observation.candidateId}`
    )
  });
  const sensitiveAssessment = createProjectKingsSensitiveContentAssessment({
    candidateId: observation.candidateId,
    contentSha256,
    upstreamEvidenceSha256: sha256(
      `decoded-frames-asr-and-metadata:${observation.candidateId}`
    ),
    signals: input?.signals ?? cleanSignals()
  });
  return {
    candidateId: observation.candidateId,
    profileKey: observation.profileKey,
    canonicalSourceUrl: observation.sourceUrl,
    contentSha256,
    discoveryState: input?.discoveryState ?? "frozen_catalog",
    sourceDesignation,
    sensitiveAssessment
  };
}

function evaluate(
  candidate: ProjectKingsSourcePolicyCandidate,
  approval: ProjectKingsSourcePolicyApproval | null = policyApproval
) {
  return evaluateProjectKingsSourcePolicy(candidate, {
    evaluatedAt: EVALUATED_AT,
    policyApproval: approval
  });
}

function rehashApproval(value: Record<string, unknown>): ProjectKingsSourcePolicyApproval {
  const { approvalSha256: ignored, ...payload } = value;
  void ignored;
  return {
    ...payload,
    approvalSha256: hashProjectKingsSourcePolicyArtifact(payload)
  } as unknown as ProjectKingsSourcePolicyApproval;
}

test("source policy v2 has frozen hashes, one-time approval and no legal-guarantee claim", () => {
  assert.equal(
    PROJECT_KINGS_SOURCE_POLICY_VERSION,
    "project-kings-source-rights-sensitive-policy-v2"
  );
  assert.equal(
    PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
    "a6452b6d6bd2e4721560df7238b47a3096c08ba978a4e1c614912612d547e4b4"
  );
  assert.equal(
    PROJECT_KINGS_SOURCE_POLICY_SHA256,
    "b6664c4364c4a3b172a1f1d653e3d100604e98f5ef1b33857324691fa894eb39"
  );
  assert.equal(
    hashProjectKingsSourcePolicyArtifact(PROJECT_KINGS_SOURCE_POLICY),
    PROJECT_KINGS_SOURCE_POLICY_SHA256
  );
  assert.equal(PROJECT_KINGS_SOURCE_POLICY.legalGuarantee, false);
  assert.equal(PROJECT_KINGS_SOURCE_POLICY.perCandidateOwnerDecisionRequired, false);
  assert.equal(policyApproval.policySha256, PROJECT_KINGS_SOURCE_POLICY_SHA256);
  assert.equal(
    policyApproval.sourceDesignationsSha256,
    PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256
  );
  assert.equal("candidateId" in policyApproval, false);
  assert.equal("contentSha256" in policyApproval, false);
});

test("one policy approval automatically authorizes verdict evaluation for multiple exact candidates", () => {
  const first = evaluate(buildFrozenCopCandidate());
  const second = evaluate(
    buildFrozenCopCandidate({
      observation: secondFrozenCopObservation,
      contentSeed: "second-exact-cop-source-bytes"
    })
  );

  assert.equal(first.disposition, "pass");
  assert.equal(second.disposition, "pass");
  assert.equal(first.automaticVerdict, true);
  assert.equal(second.automaticVerdict, true);
  assert.equal(first.policyApprovalSha256, policyApproval.approvalSha256);
  assert.equal(second.policyApprovalSha256, policyApproval.approvalSha256);
  assert.notEqual(first.inputBindingSha256, second.inputBindingSha256);
  assert.notEqual(first.verdictSha256, second.verdictSha256);
});

test("legacy source-pool label is insufficient without the one-time policy approval", () => {
  assert.equal(frozenCopObservation.rightsStatus, "owner_approved_source_pool");
  const result = evaluate(buildFrozenCopCandidate(), null);
  assert.equal(result.disposition, "policy_blocked");
  assert.equal(result.eligibleForSourceFit, false);
  assert.ok(result.issues.includes("policy_approval_missing"));
});

test("legacy per-candidate attestation is rejected fail-closed without crashing", () => {
  const legacyPerCandidateAttestation = {
    attestationVersion: "project-kings-source-owner-attestation-v1",
    attestationId: "legacy-candidate-decision",
    candidateId: frozenCopObservation.candidateId,
    contentSha256: sha256("exact-cop-donor-media-bytes"),
    attestationSha256: sha256("legacy-attestation")
  } as unknown as ProjectKingsSourcePolicyApproval;
  const result = evaluate(
    buildFrozenCopCandidate(),
    legacyPerCandidateAttestation
  );
  assert.equal(result.disposition, "policy_blocked");
  assert.ok(result.issues.includes("policy_approval_invalid"));
  assert.ok(result.issues.includes("policy_approval_binding_mismatch"));
});

test("unknown or rejected rights evidence fails closed", () => {
  for (const [rightsEvidenceStatus, expectedIssue] of [
    ["unknown", "rights_unknown"],
    ["rejected", "rights_rejected"]
  ] as const) {
    const result = evaluate(buildFrozenCopCandidate({ rightsEvidenceStatus }));
    assert.equal(result.disposition, "policy_blocked");
    assert.equal(result.eligibleForSourceFit, false);
    assert.ok(result.issues.includes(expectedIssue));
  }
});

test("automatic verdict and assessment are bound to the exact candidate bytes", () => {
  const candidate = buildFrozenCopCandidate();
  const changedBytes = {
    ...candidate,
    contentSha256: sha256("different-media-bytes")
  } satisfies ProjectKingsSourcePolicyCandidate;
  const result = evaluate(changedBytes);
  assert.equal(result.disposition, "policy_blocked");
  assert.ok(result.issues.includes("sensitive_assessment_binding_mismatch"));
  assert.notEqual(result.inputBindingSha256, evaluate(candidate).inputBindingSha256);
});

test("donor outside the approved routes is blocked without requesting a manual exception", () => {
  const result = evaluate(
    buildFrozenCopCandidate({ donorUsername: "unapproved-donor" })
  );
  assert.equal(result.disposition, "policy_blocked");
  assert.ok(result.issues.includes("donor_not_designated"));
});

test("approval hash, policy and approved-route drift all invalidate the approval", () => {
  const candidate = buildFrozenCopCandidate();
  const hashDrift = {
    ...policyApproval,
    approvalSha256: sha256("corrupted-approval")
  } as ProjectKingsSourcePolicyApproval;
  const policyDrift = rehashApproval({
    ...policyApproval,
    policyVersion: "project-kings-source-rights-sensitive-policy-v3"
  });
  const routeDriftDesignations = {
    ...policyApproval.sourceDesignations,
    "copscopes-x2e": {
      instagramDonors: ["copscopes", "unapproved-donor"],
      youtubeAsk: false
    }
  };
  const routeDrift = rehashApproval({
    ...policyApproval,
    sourceDesignations: routeDriftDesignations,
    sourceDesignationsSha256: hashProjectKingsSourcePolicyArtifact(
      routeDriftDesignations
    )
  });

  const hashResult = evaluate(candidate, hashDrift);
  const policyResult = evaluate(candidate, policyDrift);
  const routeResult = evaluate(candidate, routeDrift);
  assert.equal(hashResult.disposition, "policy_blocked");
  assert.ok(hashResult.issues.includes("policy_approval_invalid"));
  assert.equal(policyResult.disposition, "policy_blocked");
  assert.ok(policyResult.issues.includes("policy_approval_binding_mismatch"));
  assert.equal(routeResult.disposition, "policy_blocked");
  assert.ok(routeResult.issues.includes("policy_approval_binding_mismatch"));
});

test("dynamic discovery remains discovery_only even under an approved policy", () => {
  const result = evaluate(
    buildFrozenCopCandidate({ discoveryState: "discovery_only" })
  );
  assert.equal(result.disposition, "discovery_only");
  assert.equal(result.eligibleForSourceFit, false);
  assert.deepEqual(result.issues, ["dynamic_discovery_not_qualified"]);
});

test("all four prohibited sensitive-content classes independently block the source", () => {
  const cases = [
    ["graphicViolence", "graphic_violence"],
    ["unsupportedAllegation", "unsupported_allegation"],
    ["minorInSensitiveIncident", "minor_in_sensitive_incident"],
    [
      "realisticPoliticalOrPublicFigureDeepfake",
      "realistic_political_or_public_figure_deepfake"
    ]
  ] as const;

  for (const [signal, expectedIssue] of cases) {
    const result = evaluate(
      buildFrozenCopCandidate({
        signals: { ...cleanSignals(), [signal]: "present" }
      })
    );
    assert.equal(result.disposition, "policy_blocked", signal);
    assert.ok(result.issues.includes(expectedIssue), signal);
  }
});

test("unknown sensitive classification fails closed", () => {
  const result = evaluate(
    buildFrozenCopCandidate({
      signals: { ...cleanSignals(), graphicViolence: "unknown" }
    })
  );
  assert.equal(result.disposition, "policy_blocked");
  assert.ok(result.issues.includes("sensitive_classification_unknown"));
});

test("frozen Trump-in-Harry-Potter source is blocked independently of concept fit", () => {
  const observation = requiredObservation("light-ask-WkEyab1jINA");
  const contentSha256 = sha256("exact-ai-trump-source-bytes");
  const sourceDesignation = createProjectKingsSourceDesignationEvidence({
    candidateId: observation.candidateId,
    profileKey: observation.profileKey,
    provider: observation.provider,
    route: "youtube_ask_v3",
    donorUsername: null,
    canonicalSourceUrl: observation.sourceUrl,
    rightsEvidenceStatus: "covered_by_approved_source_policy",
    upstreamDiscoveryEvidenceSha256: sha256(
      "youtube-ask-approved-route-provenance"
    )
  });
  const sensitiveAssessment = createProjectKingsSensitiveContentAssessment({
    candidateId: observation.candidateId,
    contentSha256,
    upstreamEvidenceSha256: sha256("deepfake-frame-assessment"),
    signals: {
      ...cleanSignals(),
      realisticPoliticalOrPublicFigureDeepfake: "present"
    }
  });
  const result = evaluate({
    candidateId: observation.candidateId,
    profileKey: observation.profileKey,
    canonicalSourceUrl: observation.sourceUrl,
    contentSha256,
    discoveryState: "frozen_catalog",
    sourceDesignation,
    sensitiveAssessment
  });
  assert.equal(result.disposition, "policy_blocked");
  assert.equal(result.conceptFitEvaluated, false);
  assert.ok(
    result.issues.includes("realistic_political_or_public_figure_deepfake")
  );
});

test("automatic policy_verdict is an independently verifiable hash-bound artifact", () => {
  const result = evaluate(buildFrozenCopCandidate());
  const { verdictSha256, ...payload } = result;
  assert.equal(hashProjectKingsSourcePolicyArtifact(payload), verdictSha256);
  assert.equal(result.policySha256, PROJECT_KINGS_SOURCE_POLICY_SHA256);
  assert.equal(result.policyApprovalSha256, policyApproval.approvalSha256);
  assert.match(result.inputBindingSha256, /^[a-f0-9]{64}$/);
});
