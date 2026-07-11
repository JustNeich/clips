import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  resolveProjectKingsCatalogPolicyCandidates,
  runProjectKingsCatalogSourcePolicyRerun
} from "../lib/project-kings/catalog-source-policy-rerun";
import type {
  ProjectKingsReadinessCandidate,
  ProjectKingsSourceBufferReadinessEvidence
} from "../lib/project-kings/source-buffer-readiness";
import { createProjectKingsSensitiveContentAssessment } from "../lib/project-kings/source-rights-sensitive-policy";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidate(input: {
  candidateId: string;
  profileKey: "dark-joy-boy" | "light-kingdom" | "copscopes-x2e";
  provider?: "instagram" | "youtube_ask";
  sourceId: string;
}): ProjectKingsReadinessCandidate {
  const provider = input.provider ?? "instagram";
  const sourceUrl = provider === "instagram"
    ? `https://www.instagram.com/reel/${input.sourceId}/`
    : `https://www.youtube.com/watch?v=${input.sourceId}`;
  const contentSha256 = hash(`media:${input.candidateId}`);
  return {
    candidateId: input.candidateId,
    profileKey: input.profileKey,
    sourceUrl,
    canonicalUrl: sourceUrl,
    provider,
    discoveryRoutes: provider === "instagram" ? ["instagram_donor_pool"] : ["youtube_ask_v3"],
    storyEventId: `event-${input.sourceId}`,
    findings: ["Frozen exact catalog test candidate."],
    rightsStatus: "owner_approved_source_pool",
    localMedia: {
      resolvedCopies: [`.data/${input.sourceId}.mp4`],
      duplicateCopiesIgnored: [],
      uniqueContentHashes: [contentSha256],
      selected: {
        relativePath: `.data/${input.sourceId}.mp4`,
        sizeBytes: 1_024,
        contentSha256,
        durationMs: 8_000,
        width: 1080,
        height: 1920,
        videoCodec: "h264",
        audioCodec: "aac",
        decodeComplete: true,
        decodeError: null
      }
    },
    qualificationStatus: "pending",
    blockers: [],
    qualificationEvidence: null
  };
}

const lightInstagram = candidate({
  candidateId: "light-donor-DaADZ3AxOqO",
  profileKey: "light-kingdom",
  sourceId: "DaADZ3AxOqO"
});
const copInstagram = candidate({
  candidateId: "cop-positive-DW5oCZGjPCs",
  profileKey: "copscopes-x2e",
  sourceId: "DW5oCZGjPCs"
});
const lightYoutube = candidate({
  candidateId: "light-ask-BwIaEb5vGDo",
  profileKey: "light-kingdom",
  provider: "youtube_ask",
  sourceId: "BwIaEb5vGDo"
});
const darkInstagram = candidate({
  candidateId: "dark-positive-BtDnmx6HRr_",
  profileKey: "dark-joy-boy",
  sourceId: "BtDnmx6HRr_"
});

function readiness(candidates: readonly ProjectKingsReadinessCandidate[]): ProjectKingsSourceBufferReadinessEvidence {
  return {
    liveInventorySha256: hash("current-live-inventory"),
    channels: [
      { candidates: candidates.filter((entry) => entry.profileKey === "dark-joy-boy") },
      { candidates: candidates.filter((entry) => entry.profileKey === "light-kingdom") },
      { candidates: candidates.filter((entry) => entry.profileKey === "copscopes-x2e") }
    ]
  } as unknown as ProjectKingsSourceBufferReadinessEvidence;
}

function assessment(candidateValue: ProjectKingsReadinessCandidate) {
  return createProjectKingsSensitiveContentAssessment({
    candidateId: candidateValue.candidateId,
    contentSha256: candidateValue.localMedia.selected!.contentSha256,
    upstreamEvidenceSha256: hash(`assessment:${candidateValue.candidateId}`),
    signals: {
      graphicViolence: "absent",
      unsupportedAllegation: "absent",
      minorInSensitiveIncident: "absent",
      realisticPoliticalOrPublicFigureDeepfake: "absent"
    }
  });
}

test("catalog selection derives only the explicit Light, Cop and YouTube Ask routes", () => {
  const resolved = resolveProjectKingsCatalogPolicyCandidates({
    readiness: readiness([lightInstagram, copInstagram, lightYoutube]),
    candidateIds: [
      lightInstagram.candidateId,
      copInstagram.candidateId,
      lightYoutube.candidateId
    ]
  });
  assert.deepEqual(resolved.map((entry) => ({
    candidateId: entry.candidateId,
    route: entry.route,
    donorUsername: entry.donorUsername
  })), [
    {
      candidateId: lightInstagram.candidateId,
      route: "instagram_donor_pool",
      donorUsername: "learnaifaster"
    },
    {
      candidateId: copInstagram.candidateId,
      route: "instagram_donor_pool",
      donorUsername: "copscopes"
    },
    {
      candidateId: lightYoutube.candidateId,
      route: "youtube_ask_v3",
      donorUsername: null
    }
  ]);
  assert.ok(resolved.every((entry) =>
    entry.designation.upstreamDiscoveryEvidenceSha256 === entry.discoveryEvidenceSha256
  ));
});

test("ambiguous Dark provenance and suffix-only aliases fail before any model callback", async () => {
  let calls = 0;
  await assert.rejects(
    runProjectKingsCatalogSourcePolicyRerun({
      readiness: readiness([darkInstagram]),
      candidateIds: [darkInstagram.candidateId],
      assessCandidate: async () => {
        calls += 1;
        return assessment(darkInstagram);
      }
    }),
    /ambiguous Dark Instagram donor provenance/i
  );
  await assert.rejects(
    runProjectKingsCatalogSourcePolicyRerun({
      readiness: readiness([lightInstagram]),
      candidateIds: ["alias-DaADZ3AxOqO"],
      assessCandidate: async () => {
        calls += 1;
        return assessment(lightInstagram);
      }
    }),
    /absent from the current exact readiness catalog/i
  );
  assert.equal(calls, 0);
});

test("catalog rerun caps concurrency at three and rejects a mismatched assessment", async () => {
  const candidates = Array.from({ length: 7 }, (_, index) => candidate({
    candidateId: `light-donor-test-${index}`,
    profileKey: "light-kingdom",
    sourceId: `LightTest${index}`
  }));
  let active = 0;
  let maximum = 0;
  const persistedSizes: number[] = [];
  const result = await runProjectKingsCatalogSourcePolicyRerun({
    readiness: readiness(candidates),
    candidateIds: candidates.map((entry) => entry.candidateId),
    concurrency: 3,
    onArtifactsUpdated: async (artifacts) => {
      persistedSizes.push(artifacts.length);
    },
    assessCandidate: async (resolved) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return assessment(candidates.find((entry) => entry.candidateId === resolved.candidateId)!);
    }
  });
  assert.equal(maximum, 3);
  assert.equal(result.assessedCandidateIds.length, 7);
  assert.equal(result.artifacts.length, 7);
  assert.equal(persistedSizes.at(-1), 7);

  await assert.rejects(
    runProjectKingsCatalogSourcePolicyRerun({
      readiness: readiness([lightInstagram]),
      candidateIds: [lightInstagram.candidateId],
      assessCandidate: async () => createProjectKingsSensitiveContentAssessment({
        candidateId: lightInstagram.candidateId,
        contentSha256: hash("other-media"),
        upstreamEvidenceSha256: hash("wrong-assessment"),
        signals: {
          graphicViolence: "absent",
          unsupportedAllegation: "absent",
          minorInSensitiveIncident: "absent",
          realisticPoliticalOrPublicFigureDeepfake: "absent"
        }
      })
    }),
    /profileKey \+ canonicalUrl \+ contentSha256/i
  );
});

test("exact existing artifacts resume without another assessment call", async () => {
  const current = readiness([lightInstagram]);
  const first = await runProjectKingsCatalogSourcePolicyRerun({
    readiness: current,
    candidateIds: [lightInstagram.candidateId],
    assessCandidate: async () => assessment(lightInstagram)
  });
  let calls = 0;
  const resumed = await runProjectKingsCatalogSourcePolicyRerun({
    readiness: current,
    candidateIds: [lightInstagram.candidateId],
    existingArtifacts: first.artifacts,
    assessCandidate: async () => {
      calls += 1;
      return assessment(lightInstagram);
    }
  });
  assert.equal(calls, 0);
  assert.deepEqual(resumed.resumedCandidateIds, [lightInstagram.candidateId]);
  assert.deepEqual(resumed.assessedCandidateIds, []);
  assert.deepEqual(resumed.artifacts, first.artifacts);
});
