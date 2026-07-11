import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assertProjectKingsSourcePolicyArtifactsBoundToReadiness,
  parseProjectKingsSourcePolicyApprovalArtifact,
  parseProjectKingsSourcePolicyCandidateArtifacts
} from "../lib/project-kings/source-buffer-policy-inputs";
import type {
  ProjectKingsSourceBufferReadinessEvidence,
  ProjectKingsSourcePolicyCandidateArtifacts
} from "../lib/project-kings/source-buffer-readiness";
import {
  createProjectKingsSensitiveContentAssessment,
  createProjectKingsSourceDesignationEvidence,
  createProjectKingsSourcePolicyApproval
} from "../lib/project-kings/source-rights-sensitive-policy";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const approval = createProjectKingsSourcePolicyApproval({
  approvalId: "source-buffer-policy-input-test",
  ownerPrincipalId: "test-owner",
  ownerAuthorizationEvidenceSha256: hash("test-owner-authorization"),
  approvedAt: "2026-07-11T10:00:00.000Z"
});
const candidateId = "light-positive-DYuu2CVJc3G";
const sourceUrl = "https://www.instagram.com/reel/DYuu2CVJc3G/";
const contentSha256 = hash("exact-candidate-bytes");

function artifacts(input: {
  candidateId?: string;
  contentSha256?: string;
  route?: "instagram_donor_pool" | "youtube_ask_v3";
} = {}): ProjectKingsSourcePolicyCandidateArtifacts {
  const boundCandidateId = input.candidateId ?? candidateId;
  const route = input.route ?? "instagram_donor_pool";
  return {
    candidateId: boundCandidateId,
    discoveryState: "frozen_catalog",
    designation: createProjectKingsSourceDesignationEvidence({
      candidateId: boundCandidateId,
      profileKey: "light-kingdom",
      provider: "instagram",
      route,
      donorUsername: route === "instagram_donor_pool" ? "learnaifaster" : null,
      canonicalSourceUrl: sourceUrl,
      rightsEvidenceStatus: "covered_by_approved_source_policy",
      upstreamDiscoveryEvidenceSha256: hash(`designation:${boundCandidateId}`)
    }),
    sensitiveAssessment: createProjectKingsSensitiveContentAssessment({
      candidateId: boundCandidateId,
      contentSha256: input.contentSha256 ?? contentSha256,
      upstreamEvidenceSha256: hash(`assessment:${boundCandidateId}`),
      signals: {
        graphicViolence: "absent",
        unsupportedAllegation: "absent",
        minorInSensitiveIncident: "absent",
        realisticPoliticalOrPublicFigureDeepfake: "absent"
      }
    })
  };
}

function readinessSurface(): ProjectKingsSourceBufferReadinessEvidence {
  return {
    channels: [{
      candidates: [{
        candidateId,
        profileKey: "light-kingdom",
        canonicalUrl: sourceUrl,
        localMedia: { selected: { contentSha256 } }
      }]
    }]
  } as unknown as ProjectKingsSourceBufferReadinessEvidence;
}

test("strict policy inputs accept exact hash-bound approval and candidate artifacts", () => {
  const parsedApproval = parseProjectKingsSourcePolicyApprovalArtifact(
    JSON.parse(JSON.stringify(approval))
  );
  const parsedArtifacts = parseProjectKingsSourcePolicyCandidateArtifacts(
    JSON.parse(JSON.stringify([artifacts()])),
    parsedApproval
  );
  assert.equal(parsedApproval.approvalSha256, approval.approvalSha256);
  assert.equal(parsedArtifacts.length, 1);
  assert.doesNotThrow(() =>
    assertProjectKingsSourcePolicyArtifactsBoundToReadiness(
      readinessSurface(),
      parsedArtifacts
    )
  );
});

test("strict policy inputs reject wrong hashes and invalid designated routes", () => {
  assert.throws(
    () => parseProjectKingsSourcePolicyApprovalArtifact({
      ...approval,
      approvalSha256: hash("wrong-approval")
    }),
    /not a valid hash-bound artifact/i
  );
  const wrongAssessmentHash = artifacts();
  assert.throws(
    () => parseProjectKingsSourcePolicyCandidateArtifacts([{
      ...wrongAssessmentHash,
      sensitiveAssessment: {
        ...wrongAssessmentHash.sensitiveAssessment,
        assessmentSha256: hash("wrong-assessment")
      }
    }], approval),
    /not a valid hash-bound artifact/i
  );
  assert.throws(
    () => parseProjectKingsSourcePolicyCandidateArtifacts([
      artifacts({ route: "youtube_ask_v3" })
    ], approval),
    /source_url_invalid|source_route_not_designated/i
  );
});

test("readiness binding is exact and never accepts suffix aliases or other media bytes", () => {
  assert.throws(
    () => assertProjectKingsSourcePolicyArtifactsBoundToReadiness(
      readinessSurface(),
      [artifacts({ candidateId: "benchmark-alias-DYuu2CVJc3G" })]
    ),
    /no exact candidateId match/i
  );
  assert.throws(
    () => assertProjectKingsSourcePolicyArtifactsBoundToReadiness(
      readinessSurface(),
      [artifacts({ contentSha256: hash("other-candidate-bytes") })]
    ),
    /profileKey \+ canonicalUrl \+ contentSha256/i
  );
});

test("source-buffer audit CLI requires explicit policy files and passes approval into audit", async () => {
  const scriptPath = path.join(repoRoot, "scripts/audit-project-kings-source-buffer.mts");
  await assert.rejects(
    execFileAsync(process.execPath, ["--import", "tsx", scriptPath], {
      cwd: repoRoot,
      timeout: 30_000
    }),
    /--policy-approval is required/i
  );

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-kings-policy-cli-"));
  try {
    const approvalPath = path.join(temporaryRoot, "approval.json");
    const artifactsPath = path.join(temporaryRoot, "artifacts.json");
    const outputPath = path.join(temporaryRoot, "readiness.json");
    await Promise.all([
      fs.writeFile(approvalPath, `${JSON.stringify(approval)}\n`, "utf8"),
      fs.writeFile(artifactsPath, "[]\n", "utf8")
    ]);
    const { stdout } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      scriptPath,
      "--policy-approval",
      approvalPath,
      "--policy-artifacts",
      artifactsPath,
      "--attestations",
      path.join(
        repoRoot,
        "docs/project-kings-production-pipeline-v1/evidence/source-fit-attestations-2026-07-10-v18.json"
      ),
      "--output",
      outputPath,
      "--captured-at",
      "2026-07-11T10:30:00.000Z"
    ], {
      cwd: repoRoot,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024
    });
    const result = JSON.parse(stdout) as { schemaVersion: string };
    assert.equal(result.schemaVersion, "project-kings-source-buffer-audit-result-v1");
    const evidence = JSON.parse(await fs.readFile(outputPath, "utf8")) as {
      channels: Array<{ candidates: Array<{ blockers: Array<{ code: string }> }> }>;
    };
    const candidateWithMedia = evidence.channels
      .flatMap((channel) => channel.candidates)
      .find((candidate) => candidate.blockers.some((blocker) =>
        blocker.code === "missing_source_designation_provenance"
      ));
    assert.ok(candidateWithMedia);
    assert.equal(
      candidateWithMedia.blockers.some((blocker) =>
        blocker.code === "missing_source_policy_approval"
      ),
      false
    );
    assert.ok(evidence.channels
      .flatMap((channel) => channel.candidates)
      .some((candidate) => candidate.blockers.some((blocker) =>
        blocker.code === "invalid_source_fit_attestation"
      )), "v18 attestations must stay blocked after the v4 profile-hash change");
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
