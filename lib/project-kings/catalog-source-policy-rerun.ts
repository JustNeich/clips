import {
  type ProjectKingsReadinessCandidate,
  type ProjectKingsSourceBufferReadinessEvidence,
  type ProjectKingsSourceMediaInspection,
  type ProjectKingsSourcePolicyCandidateArtifacts
} from "./source-buffer-readiness";
import {
  assertProjectKingsSourcePolicyArtifactsBoundToReadiness,
  parseProjectKingsSourcePolicyCandidateArtifactsStructure
} from "./source-buffer-policy-inputs";
import {
  createProjectKingsSourceDesignationEvidence,
  hashProjectKingsSourcePolicyArtifact,
  type ProjectKingsSensitiveContentAssessment,
  type ProjectKingsSourceDesignationEvidence,
  type ProjectKingsSourceRoute
} from "./source-rights-sensitive-policy";

export const PROJECT_KINGS_CATALOG_SOURCE_POLICY_RERUN_VERSION =
  "project-kings-catalog-source-policy-rerun-v1" as const;
const SHA256 = /^[a-f0-9]{64}$/;

export type ProjectKingsResolvedCatalogPolicyCandidate = Readonly<{
  candidateId: string;
  profileKey: ProjectKingsReadinessCandidate["profileKey"];
  provider: ProjectKingsReadinessCandidate["provider"];
  route: ProjectKingsSourceRoute;
  donorUsername: string | null;
  sourceUrl: string;
  canonicalUrl: string;
  storyEventId: string;
  media: ProjectKingsSourceMediaInspection;
  discoveryEvidenceSha256: string;
  designation: ProjectKingsSourceDesignationEvidence;
}>;

export type ProjectKingsCatalogSourcePolicyRerunResult = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_CATALOG_SOURCE_POLICY_RERUN_VERSION;
  requestedCandidateIds: readonly string[];
  resumedCandidateIds: readonly string[];
  assessedCandidateIds: readonly string[];
  artifacts: readonly ProjectKingsSourcePolicyCandidateArtifacts[];
  resultSha256: string;
}>;

function routeForCandidate(candidate: ProjectKingsReadinessCandidate): Readonly<{
  route: ProjectKingsSourceRoute;
  donorUsername: string | null;
}> {
  if (candidate.provider === "youtube_ask") {
    if (candidate.profileKey !== "light-kingdom") {
      throw new Error(
        `Candidate ${candidate.candidateId} uses YouTube Ask outside the explicit Light Kingdom policy.`
      );
    }
    return { route: "youtube_ask_v3", donorUsername: null };
  }
  if (candidate.profileKey === "light-kingdom") {
    return { route: "instagram_donor_pool", donorUsername: "learnaifaster" };
  }
  if (candidate.profileKey === "copscopes-x2e") {
    return { route: "instagram_donor_pool", donorUsername: "copscopes" };
  }
  throw new Error(
    `Candidate ${candidate.candidateId} has ambiguous Dark Instagram donor provenance; explicit donor evidence is required before any model call.`
  );
}

export function resolveProjectKingsCatalogPolicyCandidates(input: {
  readiness: ProjectKingsSourceBufferReadinessEvidence;
  candidateIds: readonly string[];
}): readonly ProjectKingsResolvedCatalogPolicyCandidate[] {
  if (input.candidateIds.length === 0) throw new Error("At least one candidate ID is required.");
  const candidateIds = input.candidateIds.map((candidateId, index) => {
    if (!candidateId.trim() || candidateId !== candidateId.trim()) {
      throw new Error(`candidateIds[${index}] must be a non-empty trimmed string.`);
    }
    return candidateId;
  });
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("candidateIds must not contain duplicates.");
  }
  const catalog = new Map(
    input.readiness.channels.flatMap((channel) => channel.candidates.map((candidate) => [
      candidate.candidateId,
      candidate
    ] as const))
  );
  return Object.freeze(candidateIds.map((candidateId) => {
    const candidate = catalog.get(candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${candidateId} is absent from the current exact readiness catalog.`);
    }
    if (candidate.rightsStatus !== "owner_approved_source_pool") {
      throw new Error(`Candidate ${candidateId} is not in the approved source pool.`);
    }
    if (!candidate.storyEventId) {
      throw new Error(`Candidate ${candidateId} has no frozen story-event identity.`);
    }
    const media = candidate.localMedia.selected;
    if (!media || !media.decodeComplete || !SHA256.test(media.contentSha256)) {
      throw new Error(`Candidate ${candidateId} has no exact fully decoded local MP4.`);
    }
    const route = routeForCandidate(candidate);
    const discoveryEvidenceSha256 = hashProjectKingsSourcePolicyArtifact({
      evidenceVersion: "project-kings-catalog-source-policy-provenance-v1",
      liveInventorySha256: input.readiness.liveInventorySha256,
      candidateId,
      profileKey: candidate.profileKey,
      provider: candidate.provider,
      route: route.route,
      donorUsername: route.donorUsername,
      sourceUrl: candidate.sourceUrl,
      canonicalUrl: candidate.canonicalUrl,
      storyEventId: candidate.storyEventId,
      rightsStatus: candidate.rightsStatus,
      discoveryRoutes: candidate.discoveryRoutes,
      findings: candidate.findings,
      media: {
        relativePath: media.relativePath,
        contentSha256: media.contentSha256,
        sizeBytes: media.sizeBytes,
        durationMs: media.durationMs,
        width: media.width,
        height: media.height,
        videoCodec: media.videoCodec,
        audioCodec: media.audioCodec,
        decodeComplete: media.decodeComplete
      }
    });
    const designation = createProjectKingsSourceDesignationEvidence({
      candidateId,
      profileKey: candidate.profileKey,
      provider: candidate.provider,
      route: route.route,
      donorUsername: route.donorUsername,
      canonicalSourceUrl: candidate.canonicalUrl,
      rightsEvidenceStatus: "covered_by_approved_source_policy",
      upstreamDiscoveryEvidenceSha256: discoveryEvidenceSha256
    });
    return Object.freeze({
      candidateId,
      profileKey: candidate.profileKey,
      provider: candidate.provider,
      route: route.route,
      donorUsername: route.donorUsername,
      sourceUrl: candidate.sourceUrl,
      canonicalUrl: candidate.canonicalUrl,
      storyEventId: candidate.storyEventId,
      media,
      discoveryEvidenceSha256,
      designation
    });
  }));
}

export async function runProjectKingsCatalogSourcePolicyRerun(input: {
  readiness: ProjectKingsSourceBufferReadinessEvidence;
  candidateIds: readonly string[];
  existingArtifacts?: unknown;
  concurrency?: number;
  assessCandidate: (
    candidate: ProjectKingsResolvedCatalogPolicyCandidate
  ) => Promise<ProjectKingsSensitiveContentAssessment>;
  onArtifactsUpdated?: (
    artifacts: readonly ProjectKingsSourcePolicyCandidateArtifacts[]
  ) => Promise<void>;
}): Promise<ProjectKingsCatalogSourcePolicyRerunResult> {
  const concurrency = input.concurrency ?? 3;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new Error("Catalog source-policy concurrency must be an integer between 1 and 3.");
  }
  const resolved = resolveProjectKingsCatalogPolicyCandidates({
    readiness: input.readiness,
    candidateIds: input.candidateIds
  });
  const existing = input.existingArtifacts === undefined
    ? []
    : parseProjectKingsSourcePolicyCandidateArtifactsStructure(input.existingArtifacts);
  if (existing.some((artifact) =>
    artifact.discoveryState !== "frozen_catalog" ||
    artifact.designation.rightsEvidenceStatus !== "covered_by_approved_source_policy"
  )) {
    throw new Error(
      "Existing catalog source-policy output contains non-frozen or non-designated artifacts."
    );
  }
  assertProjectKingsSourcePolicyArtifactsBoundToReadiness(input.readiness, existing);
  const byCandidateId = new Map(existing.map((artifact) => [artifact.candidateId, artifact]));
  const resumedCandidateIds = resolved
    .filter((candidate) => byCandidateId.has(candidate.candidateId))
    .map((candidate) => candidate.candidateId);
  const pending = resolved.filter((candidate) => !byCandidateId.has(candidate.candidateId));
  const assessedCandidateIds: string[] = [];
  let cursor = 0;
  let failure: unknown = null;
  let persistQueue = Promise.resolve();
  const worker = async () => {
    while (cursor < pending.length && failure === null) {
      const candidate = pending[cursor++]!;
      try {
        const sensitiveAssessment = await input.assessCandidate(candidate);
        const artifact = {
          candidateId: candidate.candidateId,
          discoveryState: "frozen_catalog" as const,
          designation: candidate.designation,
          sensitiveAssessment
        };
        const parsed = parseProjectKingsSourcePolicyCandidateArtifactsStructure([artifact]);
        assertProjectKingsSourcePolicyArtifactsBoundToReadiness(input.readiness, parsed);
        byCandidateId.set(candidate.candidateId, parsed[0]!);
        assessedCandidateIds.push(candidate.candidateId);
        if (input.onArtifactsUpdated) {
          const snapshot = Object.freeze(
            [...byCandidateId.values()].sort((left, right) =>
              left.candidateId.localeCompare(right.candidateId)
            )
          );
          persistQueue = persistQueue.then(() => input.onArtifactsUpdated!(snapshot));
          await persistQueue;
        }
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, pending.length)) }, worker)
  );
  await persistQueue;
  if (failure !== null) throw failure;
  const artifacts = Object.freeze(
    [...byCandidateId.values()].sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId)
    )
  );
  parseProjectKingsSourcePolicyCandidateArtifactsStructure(artifacts);
  assertProjectKingsSourcePolicyArtifactsBoundToReadiness(input.readiness, artifacts);
  const payload = {
    schemaVersion: PROJECT_KINGS_CATALOG_SOURCE_POLICY_RERUN_VERSION,
    requestedCandidateIds: Object.freeze([...input.candidateIds]),
    resumedCandidateIds: Object.freeze([...resumedCandidateIds].sort()),
    assessedCandidateIds: Object.freeze([...assessedCandidateIds].sort()),
    artifacts
  };
  return Object.freeze({
    ...payload,
    resultSha256: hashProjectKingsSourcePolicyArtifact(payload)
  });
}
