import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PROJECT_KINGS_SOURCE_QUALIFICATION_EVIDENCE_VERSION,
  auditProjectKingsSourceBufferReadiness,
  buildProjectKingsSourceQualificationEvidence,
  calculateProjectKingsLiveInventorySha256,
  canonicalizeProjectKingsSourceUrl,
  parseProjectKingsLivePublicationInventory,
  verifyProjectKingsSourceBufferReadinessEvidence,
  verifyProjectKingsSourceQualificationEvidence,
  type ProjectKingsLivePublicationInventory,
  type ProjectKingsSourceMediaInspection
} from "../lib/project-kings/source-buffer-readiness";
import { buildProjectKingsPilotProfileSnapshot } from "../lib/project-kings/pilot-profile-store";
import type { ProjectKingsPilotCandidateObservation } from "../lib/project-kings/pilot-source-candidate-catalog";
import {
  createProjectKingsSensitiveContentAssessment,
  createProjectKingsSourceDesignationEvidence,
  createProjectKingsSourcePolicyApproval
} from "../lib/project-kings/source-rights-sensitive-policy";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(canonicalize(value)))
    .digest("hex");
}

const sourcePolicyApproval = createProjectKingsSourcePolicyApproval({
  approvalId: "source-readiness-synthetic-policy-approval",
  ownerPrincipalId: "test-owner",
  ownerAuthorizationEvidenceSha256: hash("synthetic-owner-approval-event"),
  approvedAt: "2026-07-10T10:00:00.000Z"
});

function sourcePolicyArtifacts(input: {
  candidateId: string;
  profileKey: "dark-joy-boy" | "light-kingdom" | "copscopes-x2e";
  sourceUrl: string;
  provider: "instagram" | "youtube_ask";
  contentSha256: string;
}) {
  const route = input.provider === "instagram" ? "instagram_donor_pool" : "youtube_ask_v3";
  const donorUsername = input.provider === "instagram"
    ? input.profileKey === "light-kingdom"
      ? "learnaifaster"
      : input.profileKey === "copscopes-x2e"
        ? "copscopes"
        : "kodyantle"
    : null;
  return {
    discoveryState: "frozen_catalog" as const,
    sourcePolicyApproval,
    sourceDesignation: createProjectKingsSourceDesignationEvidence({
      candidateId: input.candidateId,
      profileKey: input.profileKey,
      provider: input.provider,
      route,
      donorUsername,
      canonicalSourceUrl: canonicalizeProjectKingsSourceUrl(input.sourceUrl),
      rightsEvidenceStatus: "covered_by_approved_source_policy",
      upstreamDiscoveryEvidenceSha256: hash(`provenance:${input.candidateId}`)
    }),
    sensitiveAssessment: createProjectKingsSensitiveContentAssessment({
      candidateId: input.candidateId,
      contentSha256: input.contentSha256,
      upstreamEvidenceSha256: hash(`sensitive-assessment:${input.candidateId}`),
      signals: {
        graphicViolence: "absent",
        unsupportedAllegation: "absent",
        minorInSensitiveIncident: "absent",
        realisticPoliticalOrPublicFigureDeepfake: "absent"
      }
    })
  };
}

function emptyInventory(): ProjectKingsLivePublicationInventory {
  return {
    schemaVersion: 1,
    capturedAt: "2026-07-10T11:00:00.000Z",
    surface: "test fixture",
    channels: [
      {
        channelId: "4b59c5cf412e4c07b192f3312361c2eb",
        youtubeChannelId: "UCwO37rtHMhHX8caUr5Rc0Bw",
        recentPublications: []
      },
      {
        channelId: "43923d42c1c0495282f29d4c6e09b0b4",
        youtubeChannelId: "UC0LWZYpYuYAWK55WmvDqxbg",
        recentPublications: []
      },
      {
        channelId: "6187aeeea7bd47188e08089c5916edc1",
        youtubeChannelId: "UCJhBMXXQ5GrTbrhqjwT1leg",
        recentPublications: []
      }
    ]
  };
}

test("source URL canonicalization collapses Shorts/watch and Instagram query variants", () => {
  assert.equal(
    canonicalizeProjectKingsSourceUrl("https://youtube.com/shorts/BwIaEb5vGDo?si=abc"),
    "https://www.youtube.com/watch?v=BwIaEb5vGDo"
  );
  assert.equal(
    canonicalizeProjectKingsSourceUrl("https://www.instagram.com/reel/DYuu2CVJc3G/?utm_source=test"),
    "https://www.instagram.com/reel/DYuu2CVJc3G/"
  );
});

test("qualification is hash-bound and cannot PASS from a URL or a non-empty note", () => {
  const sourceUrl = "https://www.instagram.com/reel/DYuu2CVJc3G/";
  const candidateId = "light-positive-DYuu2CVJc3G";
  const contentSha256 = hash("exact-source-bytes");
  const liveInventorySha256 = hash("live-inventory");
  const output = {
    decision: "PASS" as const,
    candidateId,
    storyEventId: "event-michael-scott-onboards-karpathy",
    conceptMatch: true,
    factualFit: true,
    duplicateVideo: false,
    duplicateEvent: false,
    sourceUsable: true,
    reason: "Visible AI-fiction turn matches the frozen concept.",
    factualClaims: []
  };
  const selected: ProjectKingsSourceMediaInspection = {
    relativePath: ".data/source.mp4",
    sizeBytes: 100,
    contentSha256,
    durationMs: 8_000,
    width: 1080,
    height: 1920,
    videoCodec: "h264",
    audioCodec: "aac",
    decodeComplete: true,
    decodeError: null
  };
  const media = {
    resolvedCopies: [selected.relativePath],
    duplicateCopiesIgnored: [],
    uniqueContentHashes: [contentSha256],
    selected,
    ambiguous: false
  };
  const policyArtifacts = sourcePolicyArtifacts({
    candidateId,
    profileKey: "light-kingdom",
    sourceUrl,
    provider: "instagram",
    contentSha256
  });
  const missing = buildProjectKingsSourceQualificationEvidence({
    capturedAt: "2026-07-10T11:00:00.000Z",
    candidateId,
    profileKey: "light-kingdom",
    sourceUrl,
    provider: "instagram",
    provisionalStoryEventId: output.storyEventId,
    rightsStatus: "owner_approved_source_pool",
    media,
    liveInventorySha256,
    sourceFitAttestation: null,
    ...policyArtifacts
  });
  assert.equal(missing.status, "pending");
  assert.deepEqual(missing.blockers.map((entry) => entry.code), ["missing_source_fit_attestation"]);

  const attestation = {
    candidateId,
    profileKey: "light-kingdom" as const,
    sourceUrl,
    contentSha256,
    profileHash: buildProjectKingsPilotProfileSnapshot("light-kingdom").profileHash,
    liveInventorySha256,
    agentAttemptId: "attempt-source-fit-1",
    model: "codex:gpt-test",
    reasoningLevel: "low",
    promptSha256: hash("prompt"),
    artifactSetSha256: hash("artifacts"),
    rawOutputSha256: hash("raw-output"),
    outputSha256: hash(output),
    finishedAt: "2026-07-10T10:59:00.000Z",
    output
  };
  const withoutPolicyArtifacts = buildProjectKingsSourceQualificationEvidence({
    capturedAt: "2026-07-10T11:00:00.000Z",
    candidateId,
    profileKey: "light-kingdom",
    sourceUrl,
    provider: "instagram",
    provisionalStoryEventId: output.storyEventId,
    rightsStatus: "owner_approved_source_pool",
    media,
    liveInventorySha256,
    sourceFitAttestation: attestation,
    discoveryState: "frozen_catalog"
  });
  assert.equal(withoutPolicyArtifacts.status, "pending");
  assert.deepEqual(
    withoutPolicyArtifacts.blockers.map((entry) => entry.code),
    [
      "missing_source_policy_approval",
      "missing_source_designation_provenance",
      "missing_sensitive_content_assessment"
    ]
  );
  const qualified = buildProjectKingsSourceQualificationEvidence({
    capturedAt: "2026-07-10T11:00:00.000Z",
    candidateId,
    profileKey: "light-kingdom",
    sourceUrl,
    provider: "instagram",
    provisionalStoryEventId: output.storyEventId,
    rightsStatus: "owner_approved_source_pool",
    media,
    liveInventorySha256,
    sourceFitAttestation: attestation,
    ...policyArtifacts
  });
  assert.equal(qualified.status, "qualified");
  assert.equal(qualified.evidence?.schemaVersion, PROJECT_KINGS_SOURCE_QUALIFICATION_EVIDENCE_VERSION);
  verifyProjectKingsSourceQualificationEvidence(qualified.evidence!);

  const discoveryOnly = buildProjectKingsSourceQualificationEvidence({
    capturedAt: "2026-07-10T11:00:00.000Z",
    candidateId,
    profileKey: "light-kingdom",
    sourceUrl,
    provider: "instagram",
    provisionalStoryEventId: output.storyEventId,
    rightsStatus: "owner_approved_source_pool",
    media,
    liveInventorySha256,
    sourceFitAttestation: attestation,
    ...policyArtifacts,
    discoveryState: "discovery_only"
  });
  assert.equal(discoveryOnly.status, "pending");
  assert.deepEqual(discoveryOnly.blockers.map((entry) => entry.code), [
    "source_policy_discovery_only"
  ]);

  const wrongHash = buildProjectKingsSourceQualificationEvidence({
    capturedAt: "2026-07-10T11:00:00.000Z",
    candidateId,
    profileKey: "light-kingdom",
    sourceUrl,
    provider: "instagram",
    provisionalStoryEventId: output.storyEventId,
    rightsStatus: "owner_approved_source_pool",
    media,
    liveInventorySha256,
    sourceFitAttestation: { ...attestation, contentSha256: hash("other bytes") },
    ...policyArtifacts
  });
  assert.equal(wrongHash.status, "pending");
  assert.equal(wrongHash.blockers[0]?.code, "invalid_source_fit_attestation");

  const tampered = {
    ...qualified.evidence!,
    eventFingerprint: "event-tampered"
  };
  assert.throws(() => verifyProjectKingsSourceQualificationEvidence(tampered));
});

test("historical v13 readiness evidence is not production-ready without policy verdict v2", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const legacy = JSON.parse(
    await fs.readFile(
      path.join(
        repoRoot,
        "docs/project-kings-production-pipeline-v1/evidence/source-buffer-readiness-2026-07-10-v13.json"
      ),
      "utf8"
    )
  );
  assert.equal(legacy.summary.ready, true);
  assert.throws(
    () => verifyProjectKingsSourceBufferReadinessEvidence(legacy),
    /requires policy-bound v2 evidence/i
  );
});

test("live inventory, profile rejects and duplicate events produce the exact fail-closed 11/22/17 supply", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const inventory = parseProjectKingsLivePublicationInventory(JSON.parse(
    await fs.readFile(
      path.join(repoRoot, "docs/project-kings-production-pipeline-v1/evidence/live-publication-inventory-2026-07-10.json"),
      "utf8"
    )
  ));
  const evidence = await auditProjectKingsSourceBufferReadiness({
    repoRoot,
    liveInventory: inventory,
    capturedAt: "2026-07-10T11:38:00.000Z"
  });
  verifyProjectKingsSourceBufferReadinessEvidence(evidence);
  assert.deepEqual(
    evidence.channels.map((channel) => ({
      profileKey: channel.profileKey,
      unused: channel.unusedCandidateCount,
      qualified: channel.qualifiedCount,
      deficit: channel.qualifiedBufferDeficit
    })),
    [
      { profileKey: "dark-joy-boy", unused: 11, qualified: 0, deficit: 6 },
      { profileKey: "light-kingdom", unused: 22, qualified: 0, deficit: 6 },
      { profileKey: "copscopes-x2e", unused: 17, qualified: 0, deficit: 6 }
    ]
  );
  assert.equal(evidence.summary.qualifiedBufferDeficit, 18);
  assert.equal(evidence.summary.ready, false);
  const light = evidence.channels.find((channel) => channel.profileKey === "light-kingdom")!;
  const extractedLight = light.candidates.find(
    (candidate) => candidate.candidateId === "light-positive-DYuu2CVJc3G"
  )!;
  assert.equal(extractedLight.localMedia.uniqueContentHashes.length, 1);
  assert.equal(
    extractedLight.localMedia.selected?.contentSha256,
    "828426a0685428deedf26b197a51b32a0113e99340b0ac461a1f4b931493dc52"
  );
  assert.ok(light.excludedCandidates.some((entry) =>
    entry.candidateId === "light-positive-DYWIdjSxbb7" && entry.code === "already_published"
  ));
  assert.ok(light.excludedCandidates.some((entry) =>
    entry.candidateId === "light-ask-oA7rziyGv8s" && entry.code === "local_visual_reject"
  ));
  const cop = evidence.channels.find((channel) => channel.profileKey === "copscopes-x2e")!;
  assert.ok(cop.excludedCandidates.some((entry) =>
    entry.candidateId === "cop-positive-DYRVHZIN0ta" &&
    entry.code === "duplicate_event" &&
    entry.duplicateOfCandidateId === "cop-positive-DWwSVVOjMqO"
  ));
  assert.ok(evidence.channels.flatMap((channel) => channel.candidates)
    .every((candidate) => candidate.qualificationStatus === "pending"));
});

test("identical cache copies are one source, not two buffer entries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-kings-source-buffer-"));
  try {
    const cacheDirectory = path.join(root, ".data/source-media-cache/sources");
    await fs.mkdir(cacheDirectory, { recursive: true });
    const bytes = Buffer.from("same-local-source");
    for (const id of ["cache-a", "cache-b"]) {
      await fs.writeFile(path.join(cacheDirectory, `${id}.json`), JSON.stringify({
        fileName: "v3-light-kingdom-DYuu2CVJc3G"
      }));
      await fs.writeFile(path.join(cacheDirectory, `${id}.mp4`), bytes);
    }
    const observation: ProjectKingsPilotCandidateObservation = {
      candidateId: "light-local-DYuu2CVJc3G",
      profileKey: "light-kingdom",
      sourceUrl: "https://www.instagram.com/reel/DYuu2CVJc3G/",
      provider: "instagram",
      discoveryRoute: "local_source_cache",
      storyEventId: "event-michael-scott-onboards-karpathy",
      localMedia: {
        kind: "source_cache_file_name",
        fileName: "v3-light-kingdom-DYuu2CVJc3G"
      },
      disposition: "pending_semantic_review",
      rightsStatus: "owner_approved_source_pool",
      findings: ["test fixture"]
    };
    const inspectMedia = async (
      _absolutePath: string,
      relativePath: string
    ): Promise<ProjectKingsSourceMediaInspection> => ({
      relativePath,
      sizeBytes: bytes.length,
      contentSha256: hash(bytes.toString()),
      durationMs: 5_000,
      width: 1080,
      height: 1920,
      videoCodec: "h264",
      audioCodec: "aac",
      decodeComplete: true,
      decodeError: null
    });
    const evidence = await auditProjectKingsSourceBufferReadiness({
      repoRoot: root,
      liveInventory: emptyInventory(),
      capturedAt: "2026-07-10T11:00:00.000Z",
      observations: [observation],
      inspectMedia
    });
    const candidate = evidence.channels
      .find((channel) => channel.profileKey === "light-kingdom")!
      .candidates.find((entry) => entry.candidateId === "light-positive-DYuu2CVJc3G")!;
    assert.equal(candidate.localMedia.resolvedCopies.length, 2);
    assert.equal(candidate.localMedia.duplicateCopiesIgnored.length, 1);
    assert.equal(candidate.localMedia.uniqueContentHashes.length, 1);
    assert.equal(candidate.qualificationStatus, "pending");
    assert.ok(candidate.blockers.some((entry) => entry.code === "missing_source_fit_attestation"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("readiness evidence hash detects report tampering", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-kings-source-buffer-empty-"));
  try {
    const evidence = await auditProjectKingsSourceBufferReadiness({
      repoRoot: root,
      liveInventory: emptyInventory(),
      capturedAt: "2026-07-10T11:00:00.000Z",
      observations: []
    });
    assert.equal(calculateProjectKingsLiveInventorySha256(emptyInventory()), evidence.liveInventorySha256);
    assert.throws(() => verifyProjectKingsSourceBufferReadinessEvidence({
      ...evidence,
      summary: { ...evidence.summary, ready: true }
    }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
