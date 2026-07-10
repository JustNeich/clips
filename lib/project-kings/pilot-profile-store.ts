import { createHash } from "node:crypto";
import {
  approveProductionProfile,
  createProductionProfile,
  getProductionProfile,
  isProductionProfileExplicitlyApproved,
  listProductionProfiles,
  ProductionStoreError,
  type ProductionProfileRecord,
  type ProductionRunMode
} from "../portfolio-production-store";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "./pilot-production-profiles";
import {
  PROJECT_KINGS_QUALITY_POLICY_ID,
  PROJECT_KINGS_QUALITY_POLICY_SHA256,
  PROJECT_KINGS_QUALITY_POLICY_VERSION
} from "./production-quality-policy";
import {
  PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION
} from "./source-rights-sensitive-policy";

export { PROJECT_KINGS_QUALITY_POLICY_ID } from "./production-quality-policy";

export const PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID = "project-kings-model-routes-v2";
export const PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256 =
  "f29362a09c0e1a3c98c24a9585759259455703ab8c1c879bc36f8643f2a411de";
export const PROJECT_KINGS_PUBLISH_POLICY_ID = "project-kings-daily-3x3-v1";

export const PROJECT_KINGS_TEMPLATE_ID_BY_PROFILE: Record<ProjectKingsPilotProfileKey, string> = {
  "dark-joy-boy": "science-card-red-1cbf5e07",
  "light-kingdom": "science-card-red-1cbf5e07",
  "copscopes-x2e": "cop-scopes-darkwall-glow-bb4319ef"
};

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

export function calculateProductionProfileHash(profile: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(profile)))
    .digest("hex");
}

export function buildProjectKingsPilotProfileSnapshot(key: ProjectKingsPilotProfileKey) {
  const channelProfile = PROJECT_KINGS_PILOT_PROFILES[key];
  const snapshot = {
    channelProfile,
    templateId: PROJECT_KINGS_TEMPLATE_ID_BY_PROFILE[key],
    publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID,
    qualityPolicyId: PROJECT_KINGS_QUALITY_POLICY_ID,
    qualityPolicyVersion: PROJECT_KINGS_QUALITY_POLICY_VERSION,
    qualityPolicySha256: PROJECT_KINGS_QUALITY_POLICY_SHA256,
    sourcePolicyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
    sourcePolicySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
    sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
    modelRouteManifestId: PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID,
    modelRouteManifestSha256: PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256
  };
  return Object.freeze({
    key,
    profileHash: calculateProductionProfileHash(snapshot),
    ...snapshot
  });
}

function assertStoredProfileMatchesFrozenSnapshot(
  profile: ProductionProfileRecord,
  key: ProjectKingsPilotProfileKey
): void {
  const snapshot = buildProjectKingsPilotProfileSnapshot(key);
  const reconstructedHash = calculateProductionProfileHash({
    channelProfile: profile.config,
    templateId: profile.templateId,
    publishPolicyId: profile.publishPolicyId,
    qualityPolicyId: profile.qualityPolicyId,
    qualityPolicyVersion: PROJECT_KINGS_QUALITY_POLICY_VERSION,
    qualityPolicySha256: PROJECT_KINGS_QUALITY_POLICY_SHA256,
    sourcePolicyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
    sourcePolicySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
    sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
    modelRouteManifestId: profile.modelRouteManifestId,
    modelRouteManifestSha256: profile.modelRouteManifestSha256
  });
  const exact =
    profile.profileHash === snapshot.profileHash &&
    reconstructedHash === snapshot.profileHash &&
    profile.expectedYoutubeChannelId === snapshot.channelProfile.youtube.channelId &&
    profile.expectedDestinationTitle === snapshot.channelProfile.youtube.titleAdvisory &&
    profile.templateId === snapshot.templateId &&
    profile.templateSnapshotSha256 === snapshot.channelProfile.templateIdentity.templateSha &&
    profile.publishPolicyId === snapshot.publishPolicyId &&
    profile.qualityPolicyId === snapshot.qualityPolicyId &&
    profile.modelRouteManifestId === snapshot.modelRouteManifestId &&
    profile.modelRouteManifestSha256 === snapshot.modelRouteManifestSha256 &&
    profile.targetPerLogicalDay === 3 &&
    profile.readyBufferMin === 6 &&
    profile.readyBufferCap === 12 &&
    profile.candidateAttemptBudget === 9;
  if (!exact) {
    throw new ProductionStoreError(
      "stale_version",
      "Stored Project Kings profile fields do not reconstruct the frozen snapshot hash.",
      {
        key,
        profileId: profile.id,
        storedProfileHash: profile.profileHash,
        reconstructedHash,
        frozenProfileHash: snapshot.profileHash
      }
    );
  }
}

export function prepareProjectKingsPilotProfiles(input: {
  workspaceId: string;
}): Record<ProjectKingsPilotProfileKey, ProductionProfileRecord> {
  const output = {} as Record<ProjectKingsPilotProfileKey, ProductionProfileRecord>;
  for (const [key, profile] of Object.entries(PROJECT_KINGS_PILOT_PROFILES) as Array<
    [ProjectKingsPilotProfileKey, (typeof PROJECT_KINGS_PILOT_PROFILES)[ProjectKingsPilotProfileKey]]
  >) {
    const snapshot = buildProjectKingsPilotProfileSnapshot(key);
    const profileHash = snapshot.profileHash;
    const existing = listProductionProfiles({
      workspaceId: input.workspaceId,
      channelId: profile.profileId
    }).find((record) => record.profileHash === profileHash);
    if (existing) {
      assertStoredProfileMatchesFrozenSnapshot(existing, key);
      output[key] = existing;
      continue;
    }
    const versions = listProductionProfiles({
      workspaceId: input.workspaceId,
      channelId: profile.profileId
    }).map((record) => record.version);
    output[key] = createProductionProfile({
      workspaceId: input.workspaceId,
      channelId: profile.profileId,
      version: Math.max(0, ...versions) + 1,
      status: "draft",
      profileHash,
      expectedYoutubeChannelId: profile.youtube.channelId,
      expectedDestinationTitle: profile.youtube.titleAdvisory,
      templateId: snapshot.templateId,
      templateSnapshotSha256: profile.templateIdentity.templateSha,
      publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID,
      qualityPolicyId: PROJECT_KINGS_QUALITY_POLICY_ID,
      modelRouteManifestId: PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID,
      modelRouteManifestSha256: PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256,
      targetPerLogicalDay: 3,
      readyBufferMin: 6,
      readyBufferCap: 12,
      candidateAttemptBudget: 9,
      config: profile as unknown as Record<string, unknown>
    });
  }
  return output;
}

/**
 * Compatibility name for old callers. The former approval arguments are
 * rejected instead of silently manufacturing an approval during seeding.
 */
export function ensureProjectKingsPilotProfiles(input: {
  workspaceId: string;
  approvedByUserId?: string;
  status?: "shadow" | "active";
  approvedAt?: string;
}): Record<ProjectKingsPilotProfileKey, ProductionProfileRecord> {
  if (input.approvedByUserId || input.status || input.approvedAt) {
    throw new ProductionStoreError(
      "invalid_transition",
      "Implicit Project Kings profile approval was removed. Prepare drafts, then use the explicit owner approval command."
    );
  }
  return prepareProjectKingsPilotProfiles({ workspaceId: input.workspaceId });
}

function pilotKeyForChannelId(channelId: string): ProjectKingsPilotProfileKey | null {
  return (Object.entries(PROJECT_KINGS_PILOT_PROFILES) as Array<
    [ProjectKingsPilotProfileKey, (typeof PROJECT_KINGS_PILOT_PROFILES)[ProjectKingsPilotProfileKey]]
  >).find(([, profile]) => profile.profileId === channelId)?.[0] ?? null;
}

export function approveProjectKingsPilotProfile(input: {
  workspaceId: string;
  approvedByUserId: string;
  profileId: string;
  expectedVersion: number;
  expectedProfileHash: string;
  targetStatus: "shadow" | "active";
  approvedAt?: string;
}): ProductionProfileRecord {
  const profile = getProductionProfile(input.profileId);
  const key = profile ? pilotKeyForChannelId(profile.channelId) : null;
  if (!profile || profile.workspaceId !== input.workspaceId || !key) {
    throw new ProductionStoreError("not_found", "Project Kings pilot profile not found in this workspace.", {
      profileId: input.profileId
    });
  }
  const frozenSnapshot = buildProjectKingsPilotProfileSnapshot(key);
  assertStoredProfileMatchesFrozenSnapshot(profile, key);
  if (
    frozenSnapshot.profileHash !== profile.profileHash ||
    input.expectedProfileHash.toLowerCase() !== frozenSnapshot.profileHash
  ) {
    throw new ProductionStoreError(
      "stale_version",
      "Approval hash does not match the current frozen Project Kings profile snapshot.",
      {
        profileId: profile.id,
        expectedProfileHash: input.expectedProfileHash,
        frozenProfileHash: frozenSnapshot.profileHash
      }
    );
  }
  return approveProductionProfile({
    workspaceId: input.workspaceId,
    profileId: profile.id,
    expectedVersion: input.expectedVersion,
    expectedProfileHash: input.expectedProfileHash,
    targetStatus: input.targetStatus,
    approvedByUserId: input.approvedByUserId,
    approvedAt: input.approvedAt
  });
}

export function resolveProjectKingsPilotProfilesForRun(input: {
  workspaceId: string;
  mode: ProductionRunMode;
}): Record<ProjectKingsPilotProfileKey, ProductionProfileRecord> {
  const output = {} as Record<ProjectKingsPilotProfileKey, ProductionProfileRecord>;
  for (const key of Object.keys(PROJECT_KINGS_PILOT_PROFILES) as ProjectKingsPilotProfileKey[]) {
    const snapshot = buildProjectKingsPilotProfileSnapshot(key);
    const profile = listProductionProfiles({
      workspaceId: input.workspaceId,
      channelId: snapshot.channelProfile.profileId
    }).find((record) => record.profileHash === snapshot.profileHash);
    if (!profile) {
      throw new ProductionStoreError(
        "invalid_transition",
        "Project Kings profiles must be prepared before a portfolio run can start.",
        { key, expectedProfileHash: snapshot.profileHash }
      );
    }
    assertStoredProfileMatchesFrozenSnapshot(profile, key);
    const requiredScope = input.mode === "live" ? "live" : "shadow";
    if (
      input.mode !== "simulation" &&
      !isProductionProfileExplicitlyApproved(profile, requiredScope)
    ) {
      throw new ProductionStoreError(
        "invalid_transition",
        `${input.mode} run requires an explicitly approved ${requiredScope} profile.`,
        {
          key,
          profileId: profile.id,
          version: profile.version,
          profileHash: profile.profileHash,
          status: profile.status,
          approvalScope: profile.approvalScope
        }
      );
    }
    output[key] = profile;
  }
  return output;
}
