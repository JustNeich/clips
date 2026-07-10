import assert from "node:assert/strict";
import test from "node:test";

import { selectProjectKingsSourceBufferUploads } from "../scripts/sync-project-kings-source-buffer.mjs";

function candidate(index) {
  const contentSha256 = String(index).padStart(64, "0");
  const approvalSha256 = String(index + 100).padStart(64, "0");
  const designationEvidenceSha256 = String(index + 200).padStart(64, "0");
  const sensitiveAssessmentSha256 = String(index + 300).padStart(64, "0");
  return {
    candidateId: `candidate-${index}`,
    canonicalUrl: `https://www.instagram.com/reel/C${index}/`,
    qualificationStatus: "qualified",
    rightsStatus: "owner_approved_source_pool",
    qualificationEvidence: {
      schemaVersion: "project-kings-source-qualification-v2",
      contentSha256,
      eventFingerprint: `event-${index}`,
      sourcePolicy: {
        discoveryState: "frozen_catalog",
        policyVersion: "project-kings-source-rights-sensitive-policy-v2",
        policySha256: "b6664c4364c4a3b172a1f1d653e3d100604e98f5ef1b33857324691fa894eb39",
        approvalSha256,
        designationEvidenceSha256,
        sensitiveAssessmentSha256,
        policyVerdict: {
          disposition: "pass",
          eligibleForSourceFit: true,
          policySha256: "b6664c4364c4a3b172a1f1d653e3d100604e98f5ef1b33857324691fa894eb39",
          policyApprovalSha256: approvalSha256,
          sourceDesignationEvidenceSha256: designationEvidenceSha256,
          sensitiveAssessmentSha256,
          verdictSha256: String(index + 400).padStart(64, "0")
        }
      }
    },
    localMedia: { selected: { relativePath: `.data/candidate-${index}.mp4` } }
  };
}

test("sync selection fills only remaining cap room and skips existing identities", () => {
  const evidence = {
    channels: [{
      profileKey: "light-kingdom",
      candidates: Array.from({ length: 15 }, (_, index) => candidate(index + 1))
    }]
  };
  const runtime = {
    channels: [{
      profileKey: "light-kingdom",
      qualifiedAvailable: 2,
      refill: { shouldRefill: true, readyBufferCap: 12 },
      candidates: [{
        canonicalUrl: candidate(1).canonicalUrl,
        contentSha256: candidate(1).qualificationEvidence.contentSha256,
        eventFingerprint: candidate(1).qualificationEvidence.eventFingerprint
      }]
    }]
  };
  const selected = selectProjectKingsSourceBufferUploads(evidence, runtime);
  assert.equal(selected.length, 10);
  assert.equal(selected[0].candidate.candidateId, "candidate-2");
  assert.equal(selected.at(-1).candidate.candidateId, "candidate-11");
});

test("sync selection does nothing when refill is not requested", () => {
  const selected = selectProjectKingsSourceBufferUploads(
    { channels: [{ profileKey: "dark-joy-boy", candidates: [candidate(1)] }] },
    {
      channels: [{
        profileKey: "dark-joy-boy",
        qualifiedAvailable: 6,
        refill: { shouldRefill: false, readyBufferCap: 12 },
        candidates: []
      }]
    }
  );
  assert.deepEqual(selected, []);
});

test("sync rejects legacy qualified evidence without a PASS policy_verdict v2", () => {
  const legacy = candidate(1);
  legacy.qualificationEvidence = {
    contentSha256: "1".padStart(64, "0"),
    eventFingerprint: "event-1",
    schemaVersion: "project-kings-source-qualification-v1"
  };
  assert.throws(
    () => selectProjectKingsSourceBufferUploads(
      { channels: [{ profileKey: "dark-joy-boy", candidates: [legacy] }] },
      {
        channels: [{
          profileKey: "dark-joy-boy",
          qualifiedAvailable: 0,
          refill: { shouldRefill: true, readyBufferCap: 12 },
          candidates: []
        }]
      }
    ),
    /lacks an exact PASS policy_verdict v2/i
  );
});
