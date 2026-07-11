import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel } from "../lib/chat-history";
import { getDb, nowIso } from "../lib/db/client";
import {
  approveProjectKingsPilotProfile,
  buildProjectKingsPilotProfileSnapshot,
  ensureProjectKingsPilotProfiles,
  prepareProjectKingsPilotProfiles,
  PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID,
  PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256,
  PROJECT_KINGS_PUBLISH_POLICY_ID
} from "../lib/project-kings/pilot-profile-store";
import {
  PROJECT_KINGS_QUALITY_POLICY_SHA256,
  PROJECT_KINGS_QUALITY_POLICY_VERSION
} from "../lib/project-kings/production-quality-policy";
import {
  PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION
} from "../lib/project-kings/source-rights-sensitive-policy";
import { loadFrozenProductionAgentRouteManifest } from "../lib/project-kings/production-model-route-manifest";
import { isProductionProfileExplicitlyApproved } from "../lib/portfolio-production-store";
import { PROJECT_KINGS_PILOT_PROFILES } from "../lib/project-kings/pilot-production-profiles";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-pilot-profile-store-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("all Project Kings production bindings resolve the exact schema-v3 route manifest v4", async () => {
  const repoRoot = process.cwd();
  const manifestPath = path.join(
    repoRoot,
    "docs/project-kings-production-pipeline-v1/evidence/project-kings-model-routes-v4.json"
  );
  const manifest = await loadFrozenProductionAgentRouteManifest({
    repoCwd: repoRoot,
    manifestPath,
    expectedManifestId: PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID
  });
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.manifestId, PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID);
  assert.equal(manifest.manifestSha256, PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256);
  assert.ok(manifest.selections.source_policy);
  assert.ok(manifest.selections.vision_qa);

  const snapshotEvidence = JSON.parse(await readFile(path.join(
    repoRoot,
    "docs/project-kings-production-pipeline-v1/evidence/project-kings-production-profiles-v2.json"
  ), "utf8")) as {
    schemaVersion: string;
    profiles: Array<ReturnType<typeof buildProjectKingsPilotProfileSnapshot>>;
  };
  assert.equal(snapshotEvidence.schemaVersion, "project-kings-production-profile-snapshots-v2");
  assert.equal(snapshotEvidence.profiles.length, 3);
  for (const key of Object.keys(PROJECT_KINGS_PILOT_PROFILES) as Array<keyof typeof PROJECT_KINGS_PILOT_PROFILES>) {
    const expected = buildProjectKingsPilotProfileSnapshot(key);
    const stored = snapshotEvidence.profiles.find((entry) => entry.key === key);
    assert.ok(stored, `missing frozen profile ${key}`);
    assert.equal(stored.modelRouteManifestId, PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID);
    assert.equal(stored.modelRouteManifestSha256, PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256);
    assert.equal(stored.profileHash, expected.profileHash);
  }

  const productionSurfaces = [
    ".env.example",
    "scripts/install-project-kings-semantic-worker-launchd.mjs",
    "scripts/run-project-kings-source-fit-attestations.mts",
    "scripts/freeze-project-kings-production-profiles.mts",
    "scripts/freeze-project-kings-production-release.mts"
  ];
  for (const relativePath of productionSurfaces) {
    const content = await readFile(path.join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(content, /project-kings-model-routes-v2/);
  }
});

test("pilot profile preparation is immutable, exact, idempotent and never implicit approval", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Pilot Profiles",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    for (const profile of Object.values(PROJECT_KINGS_PILOT_PROFILES)) {
      const channel = await createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: profile.youtube.titleAdvisory,
        username: `pilot_${profile.profileId.slice(0, 6)}`
      });
      getDb().prepare("UPDATE channels SET id = ? WHERE id = ?").run(profile.profileId, channel.id);
    }
    const first = prepareProjectKingsPilotProfiles({ workspaceId: owner.workspace.id });
    const second = prepareProjectKingsPilotProfiles({ workspaceId: owner.workspace.id });

    assert.equal(Object.keys(first).length, 3);
    assert.equal(first["dark-joy-boy"].id, second["dark-joy-boy"].id);
    assert.equal(first["light-kingdom"].expectedYoutubeChannelId, "UC0LWZYpYuYAWK55WmvDqxbg");
    assert.equal(first["copscopes-x2e"].publishPolicyId, PROJECT_KINGS_PUBLISH_POLICY_ID);
    assert.equal(first["dark-joy-boy"].readyBufferMin, 6);
    assert.equal(first["dark-joy-boy"].readyBufferCap, 12);
    assert.equal(first["dark-joy-boy"].candidateAttemptBudget, 9);
    const frozen = buildProjectKingsPilotProfileSnapshot("dark-joy-boy");
    assert.equal(frozen.qualityPolicyVersion, PROJECT_KINGS_QUALITY_POLICY_VERSION);
    assert.equal(frozen.qualityPolicySha256, PROJECT_KINGS_QUALITY_POLICY_SHA256);
    assert.equal(frozen.sourcePolicyVersion, PROJECT_KINGS_SOURCE_POLICY_VERSION);
    assert.equal(frozen.sourcePolicySha256, PROJECT_KINGS_SOURCE_POLICY_SHA256);
    assert.equal(frozen.sourceDesignationsSha256, PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256);
    assert.equal(frozen.modelRouteManifestSha256, PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256);
    assert.equal(first["dark-joy-boy"].status, "draft");
    assert.equal(first["dark-joy-boy"].approvedAt, null);
    assert.equal(first["dark-joy-boy"].approvalBindingSha256, null);
    assert.equal(
      first["dark-joy-boy"].profileHash,
      buildProjectKingsPilotProfileSnapshot("dark-joy-boy").profileHash
    );
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM production_profiles").get() as { count: number }).count,
      3
    );
    assert.throws(() => ensureProjectKingsPilotProfiles({
      workspaceId: owner.workspace.id,
      approvedByUserId: owner.user.id,
      approvedAt: nowIso()
    }), /Implicit Project Kings profile approval was removed/);
    getDb().prepare("UPDATE production_profiles SET template_id = ? WHERE id = ?")
      .run("tampered-template", first["dark-joy-boy"].id);
    assert.throws(
      () => prepareProjectKingsPilotProfiles({ workspaceId: owner.workspace.id }),
      /do not reconstruct the frozen snapshot hash/
    );
  });
});

test("exact hash-bound owner approval promotes draft to shadow and then active", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Pilot Profile Approval",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    for (const profile of Object.values(PROJECT_KINGS_PILOT_PROFILES)) {
      const channel = await createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: profile.youtube.titleAdvisory,
        username: `approval_${profile.profileId.slice(0, 6)}`
      });
      getDb().prepare("UPDATE channels SET id = ? WHERE id = ?").run(profile.profileId, channel.id);
    }
    const draft = prepareProjectKingsPilotProfiles({ workspaceId: owner.workspace.id })["dark-joy-boy"];
    assert.throws(() => approveProjectKingsPilotProfile({
      workspaceId: owner.workspace.id,
      approvedByUserId: owner.user.id,
      profileId: draft.id,
      expectedVersion: draft.version,
      expectedProfileHash: draft.profileHash,
      targetStatus: "active"
    }), /requires an explicitly approved shadow profile/);
    assert.throws(() => approveProjectKingsPilotProfile({
      workspaceId: owner.workspace.id,
      approvedByUserId: owner.user.id,
      profileId: draft.id,
      expectedVersion: draft.version,
      expectedProfileHash: "f".repeat(64),
      targetStatus: "shadow"
    }), /does not match the current frozen/);

    const shadow = approveProjectKingsPilotProfile({
      workspaceId: owner.workspace.id,
      approvedByUserId: owner.user.id,
      profileId: draft.id,
      expectedVersion: draft.version,
      expectedProfileHash: draft.profileHash,
      targetStatus: "shadow",
      approvedAt: "2026-07-10T12:00:00.000Z"
    });
    assert.equal(shadow.status, "shadow");
    assert.equal(shadow.approvalScope, "shadow");
    assert.ok(shadow.approvalBindingSha256);
    assert.equal(isProductionProfileExplicitlyApproved(shadow, "shadow"), true);
    assert.equal(isProductionProfileExplicitlyApproved(shadow, "live"), false);

    const repeated = approveProjectKingsPilotProfile({
      workspaceId: owner.workspace.id,
      approvedByUserId: owner.user.id,
      profileId: shadow.id,
      expectedVersion: shadow.version,
      expectedProfileHash: shadow.profileHash,
      targetStatus: "shadow",
      approvedAt: "2026-07-10T13:00:00.000Z"
    });
    assert.equal(repeated.approvalBindingSha256, shadow.approvalBindingSha256);
    assert.equal(repeated.approvedAt, shadow.approvedAt);

    const active = approveProjectKingsPilotProfile({
      workspaceId: owner.workspace.id,
      approvedByUserId: owner.user.id,
      profileId: shadow.id,
      expectedVersion: shadow.version,
      expectedProfileHash: shadow.profileHash,
      targetStatus: "active",
      approvedAt: "2026-07-10T14:00:00.000Z"
    });
    assert.equal(active.status, "active");
    assert.equal(active.approvalScope, "live");
    assert.equal(isProductionProfileExplicitlyApproved(active, "shadow"), true);
    assert.equal(isProductionProfileExplicitlyApproved(active, "live"), true);
  });
});
