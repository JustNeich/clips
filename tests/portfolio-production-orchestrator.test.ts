import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel } from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import {
  approveProductionProfile,
  cancelProductionRun,
  createProductionProfile,
  getProductionItem,
  listAgentAttempts,
  listChannelSourceCandidates,
  listProductionEvents,
  listProductionOutbox,
  releaseShadowSourceCandidateReservation,
  transitionProductionItem,
  transitionChannelSourceCandidateQualification,
  upsertChannelSourceCandidate,
  type ProductionProfileRecord
} from "../lib/portfolio-production-store";
import {
  dispatchPortfolioProductionOutbox,
  getPortfolioProductionRun,
  PORTFOLIO_PIPELINE_FEATURE_FLAG,
  PROJECT_KINGS_PUBLISH_POLICY_ID,
  reconcilePortfolioProductionRun,
  startPortfolioProductionRun,
  validatePortfolioProductionProfile,
  type PortfolioOrchestratorDependencies
} from "../lib/portfolio-production-orchestrator";
import {
  createPortfolioSimulationDispatcher,
  runPortfolioSimulationUntilSettled
} from "../lib/portfolio-production-simulation";
import { approveCurrentProjectKingsSourcePolicy } from "../lib/project-kings/source-policy-approval-store";
import {
  PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION,
  createProjectKingsSensitiveContentAssessment,
  createProjectKingsSourceDesignationEvidence,
  hashProjectKingsSourcePolicyArtifact,
  type ProjectKingsSourcePolicyApproval
} from "../lib/project-kings/source-rights-sensitive-policy";
import {
  buildProjectKingsSourceQualificationEvidence,
  calculateProjectKingsLiveInventorySha256,
  canonicalizeProjectKingsSourceUrl,
  type ProjectKingsLivePublicationInventory
} from "../lib/project-kings/source-buffer-readiness";
import { PROJECT_KINGS_IMPORTED_SOURCE_EVIDENCE_VERSION } from "../lib/project-kings/source-buffer-refill";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "../lib/project-kings/pilot-production-profiles";
import { buildProjectKingsPilotProfileSnapshot } from "../lib/project-kings/pilot-profile-store";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-portfolio-orchestrator-"));
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

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const PILOT_PROFILE_KEYS: readonly ProjectKingsPilotProfileKey[] = [
  "dark-joy-boy",
  "light-kingdom",
  "copscopes-x2e"
];

function productionReadySourceEvidence(input: {
  profileKey: ProjectKingsPilotProfileKey;
  candidateId: string;
  sourceUrl: string;
  contentSha256: string;
  eventFingerprint: string;
  policyApproval: ProjectKingsSourcePolicyApproval;
}) {
  const donorUsername = input.profileKey === "dark-joy-boy"
    ? "kodyantle"
    : input.profileKey === "light-kingdom"
      ? "learnaifaster"
      : "copscopes";
  const canonicalUrl = canonicalizeProjectKingsSourceUrl(input.sourceUrl);
  const designation = createProjectKingsSourceDesignationEvidence({
    candidateId: input.candidateId,
    profileKey: input.profileKey,
    provider: "instagram",
    route: "instagram_donor_pool",
    donorUsername,
    canonicalSourceUrl: canonicalUrl,
    rightsEvidenceStatus: "covered_by_approved_source_policy",
    upstreamDiscoveryEvidenceSha256: sha(`designation:${input.candidateId}`)
  });
  const sensitiveAssessment = createProjectKingsSensitiveContentAssessment({
    candidateId: input.candidateId,
    contentSha256: input.contentSha256,
    upstreamEvidenceSha256: sha(`sensitive:${input.candidateId}`),
    signals: {
      graphicViolence: "absent",
      unsupportedAllegation: "absent",
      minorInSensitiveIncident: "absent",
      realisticPoliticalOrPublicFigureDeepfake: "absent"
    }
  });
  const output = {
    decision: "PASS" as const,
    candidateId: input.candidateId,
    storyEventId: input.eventFingerprint,
    conceptMatch: true,
    factualFit: true,
    duplicateVideo: false,
    duplicateEvent: false,
    sourceUsable: true,
    reason: "Deterministic fixture matches the frozen pilot concept.",
    factualClaims: []
  };
  const inventory: ProjectKingsLivePublicationInventory = {
    schemaVersion: 1,
    capturedAt: "2026-07-10T08:00:00.000Z",
    surface: "portfolio orchestrator test fixture",
    channels: []
  };
  const liveInventorySha256 = calculateProjectKingsLiveInventorySha256(inventory);
  const media = {
    resolvedCopies: [`.data/${input.candidateId}.mp4`],
    duplicateCopiesIgnored: [],
    uniqueContentHashes: [input.contentSha256],
    selected: {
      relativePath: `.data/${input.candidateId}.mp4`,
      sizeBytes: 1024,
      contentSha256: input.contentSha256,
      durationMs: 8_000,
      width: 1080,
      height: 1920,
      videoCodec: "h264",
      audioCodec: "aac",
      decodeComplete: true,
      decodeError: null
    },
    ambiguous: false
  };
  const result = buildProjectKingsSourceQualificationEvidence({
    capturedAt: "2026-07-10T08:01:00.000Z",
    candidateId: input.candidateId,
    profileKey: input.profileKey,
    sourceUrl: canonicalUrl,
    provider: "instagram",
    provisionalStoryEventId: input.eventFingerprint,
    rightsStatus: "owner_approved_source_pool",
    media,
    liveInventorySha256,
    discoveryState: "frozen_catalog",
    sourcePolicyApproval: input.policyApproval,
    sourceDesignation: designation,
    sensitiveAssessment,
    sourceFitAttestation: {
      candidateId: input.candidateId,
      profileKey: input.profileKey,
      sourceUrl: canonicalUrl,
      contentSha256: input.contentSha256,
      profileHash: buildProjectKingsPilotProfileSnapshot(input.profileKey).profileHash,
      liveInventorySha256,
      agentAttemptId: `source-fit-${input.candidateId}`,
      model: "test:deterministic",
      reasoningLevel: "none",
      promptSha256: sha(`prompt:${input.candidateId}`),
      artifactSetSha256: sha(`artifacts:${input.candidateId}`),
      rawOutputSha256: sha(`raw:${input.candidateId}`),
      outputSha256: hashProjectKingsSourcePolicyArtifact(output),
      finishedAt: "2026-07-10T08:00:59.000Z",
      output
    }
  });
  assert.equal(result.status, "qualified", JSON.stringify(result.blockers));
  return {
    schemaVersion: PROJECT_KINGS_IMPORTED_SOURCE_EVIDENCE_VERSION,
    sourceBufferEvidenceSha256: sha(`buffer:${input.candidateId}`),
    qualification: result.evidence
  };
}

function profileConfig(input: {
  channelId: string;
  youtubeChannelId: string;
  index: number;
}) {
  const events = Array.from({ length: 6 }, (_, index) => `event-${input.index}-${index + 1}`);
  const examples = events.map((storyEventId, index) => ({
    id: `positive-${input.index}-${index + 1}`,
    url: `https://instagram.com/reel/P${input.index}${index + 1}/`,
    storyEventId,
    reason: "Visible single event matches the narrow channel promise."
  }));
  return {
    profileVersion: "project-kings-profile-v1",
    profileId: input.channelId,
    youtube: {
      channelId: input.youtubeChannelId,
      titleAdvisory: `Pilot channel ${input.index}`
    },
    templateIdentity: {
      channelId: input.channelId,
      templateSha: String(input.index).repeat(64)
    },
    concept: {
      contractVersion: "concept-v2",
      conceptId: `pilot-concept-${input.index}`,
      label: `Narrow pilot concept ${input.index}`,
      conceptShape: "channel",
      instagramCoherence: "pass",
      channelPromise: "Every clip shows the same narrow type of visible event and payoff.",
      axes: {
        audience: "Viewers who want this exact visible event.",
        source: {
          platform: "instagram",
          mediaType: "reel",
          description: "Owner-approved Instagram donor reels."
        },
        event: "One clearly visible narrow event.",
        emotion: "Tension followed by a visual payoff.",
        reasonToWatch: "The viewer waits for the visible payoff.",
        format: "Hook, action, payoff in one vertical short."
      },
      inclusions: ["Visible event", "Single coherent source", "Clear visual payoff"],
      exclusions: ["Unrelated event", "Compilation", "Donor UI"],
      adjacentCategories: Array.from({ length: 3 }, (_, index) => ({
        categoryId: `adjacent-${input.index}-${index + 1}`,
        difference: `Adjacent category ${index + 1} has a different core event.`
      })),
      positiveExamples: examples,
      negativeExamples: Array.from({ length: 5 }, (_, index) => ({
        id: `negative-${input.index}-${index + 1}`,
        url: `https://instagram.com/reel/N${input.index}${index + 1}/`,
        storyEventId: `negative-event-${input.index}-${index + 1}`,
        reason: "Different event and audience promise."
      })),
      evidenceBoundary: {
        categoryAuthority: "instagram",
        youtubeRole: "market-validation-only",
        youtubeCanWidenCategory: false
      },
      continuityBuffer: {
        uniqueStoryEventIds: events
      }
    },
    publication: {
      timezone: "Europe/Moscow",
      slots: [
        { slotId: "slot-1", localTime: "21:00" },
        { slotId: "slot-2", localTime: "21:15" },
        { slotId: "slot-3", localTime: "21:30" }
      ],
      limits: {
        dailyPublicationLimit: 3,
        maxCandidatesPerRun: 9,
        maxConcurrentSourceJobs: 1,
        maxConcurrentModelCalls: 3,
        maxConcurrentRenders: 1
      },
      retryPolicy: {
        strategy: "exponential",
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 15000,
        retryableErrorCodes: ["network", "provider_429", "provider_5xx"],
        nonRetryableErrorCodes: ["oauth", "policy"]
      }
    },
    credentialRefs: {
      youtubePublishing: `credential-ref://youtube/channel-${input.index}`,
      instagramSource: `credential-ref://instagram/profile-${input.index}`
    }
  };
}

async function seedPortfolio(input: {
  sourceQualification?: "discovered" | "pending" | "qualified";
} = {}): Promise<{
  workspaceId: string;
  profiles: ProductionProfileRecord[];
}> {
  const owner = await bootstrapOwner({
    workspaceName: "Portfolio Workspace",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const youtubeIds = [
    "UC1234567890123456789012",
    "UC2234567890123456789012",
    "UC3234567890123456789012"
  ];
  const sourcePolicyApproval = approveCurrentProjectKingsSourcePolicy({
    workspaceId: owner.workspace.id,
    ownerUserId: owner.user.id,
    policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
    policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
    sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
    ownerAuthorizationEvidenceSha256: sha("portfolio-orchestrator-source-policy-approval"),
    approvedAt: "2026-07-10T07:59:00.000Z"
  }).approval.approval;
  const profiles: ProductionProfileRecord[] = [];
  for (let index = 0; index < 3; index += 1) {
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: `Pilot ${index + 1}`,
      username: `pilot_${index + 1}`
    });
    const config = profileConfig({
      channelId: channel.id,
      youtubeChannelId: youtubeIds[index]!,
      index: index + 1
    });
    const unboundProfile = createProductionProfile({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      version: 1,
      status: "active",
      profileHash: sha(config),
      expectedYoutubeChannelId: youtubeIds[index]!,
      expectedDestinationTitle: `Pilot ${index + 1}`,
      templateId: `template-${index + 1}`,
      templateSnapshotSha256: String(index + 1).repeat(64),
      publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID,
      qualityPolicyId: "project-kings-quality-v1",
      modelRouteManifestId: "project-kings-models-v1",
      modelRouteManifestSha256: "1".repeat(64),
      targetPerLogicalDay: 3,
      readyBufferMin: 6,
      readyBufferCap: 12,
      candidateAttemptBudget: 9,
      config,
      approvedAt: "2026-07-10T08:00:00.000Z",
      approvedByUserId: owner.user.id
    });
    const profile = approveProductionProfile({
      workspaceId: owner.workspace.id,
      profileId: unboundProfile.id,
      expectedVersion: unboundProfile.version,
      expectedProfileHash: unboundProfile.profileHash,
      targetStatus: "active",
      approvedByUserId: owner.user.id,
      approvedAt: "2026-07-10T08:00:00.000Z"
    });
    profiles.push(profile);
    for (let sourceIndex = 0; sourceIndex < 6; sourceIndex += 1) {
      const profileKey = PILOT_PROFILE_KEYS[index]!;
      const candidateId = `fixture-${profileKey}-${sourceIndex + 1}`;
      const sourceUrl = `https://www.instagram.com/reel/S${index + 1}${sourceIndex + 1}/`;
      const contentSha256 = sha(`content-${index + 1}-${sourceIndex + 1}`);
      const eventFingerprint = `event-${index + 1}-${sourceIndex + 1}`;
      const evidence = productionReadySourceEvidence({
        profileKey,
        candidateId,
        sourceUrl,
        contentSha256,
        eventFingerprint,
        policyApproval: sourcePolicyApproval
      });
      const discovered = upsertChannelSourceCandidate({
        workspaceId: owner.workspace.id,
        channelId: channel.id,
        provider: "instagram",
        sourceUrl,
        canonicalUrl: sourceUrl,
        contentSha256,
        eventFingerprint,
        categoryKey: `pilot-concept-${index + 1}`,
        rightsStatus: "owner_approved_source_pool",
        evidence: { origin: "instagram", discoveredBy: "fixture" }
      }).candidate;
      if (input.sourceQualification === "pending") {
        transitionChannelSourceCandidateQualification({
          candidateId: discovered.id,
          toStatus: "pending"
        });
      } else if (input.sourceQualification !== "discovered") {
        transitionChannelSourceCandidateQualification({
          candidateId: discovered.id,
          toStatus: "qualified",
          contentSha256: discovered.contentSha256,
          eventFingerprint: discovered.eventFingerprint,
          evidence
        });
      }
    }
  }
  return { workspaceId: owner.workspace.id, profiles };
}

function dependencies(
  invalidProfileId?: string
): PortfolioOrchestratorDependencies {
  return {
    featureFlagEnabled: () => true,
    validateLiveProfile: async (profile) => ({
      liveFactsHash: sha({ profileId: profile.id, live: true }),
      checks: [
        {
          code: "live_identity",
          pass: profile.id !== invalidProfileId,
          blocking: true,
          expected: profile.expectedYoutubeChannelId,
          actual: profile.id === invalidProfileId ? "wrong-channel" : profile.expectedYoutubeChannelId,
          detail: profile.id === invalidProfileId ? "Destination drift." : "Destination matches."
        }
      ]
    })
  };
}

test("discovered and pending sources never satisfy the ready-buffer preflight", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio({ sourceQualification: "discovered" });
    for (const profile of seeded.profiles) {
      const discovered = await validatePortfolioProductionProfile(profile, dependencies());
      const discoveredBuffer = discovered.checks.find((check) => check.code === "source_buffer")!;
      assert.equal(discoveredBuffer.pass, false);
      assert.equal(discoveredBuffer.actual, 0);
      for (const candidate of listChannelSourceCandidates({
        workspaceId: profile.workspaceId,
        channelId: profile.channelId
      })) {
        transitionChannelSourceCandidateQualification({
          candidateId: candidate.id,
          toStatus: "pending"
        });
      }
      const pending = await validatePortfolioProductionProfile(profile, dependencies());
      const pendingBuffer = pending.checks.find((check) => check.code === "source_buffer")!;
      assert.equal(pendingBuffer.pass, false);
      assert.equal(pendingBuffer.actual, 0);
    }
    const result = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-10",
        mode: "simulation",
        targetPerChannel: 3,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies()
    );
    assert.equal(result.run.status, "blocked");
    assert.equal(result.items.length, 0);
    assert.ok(result.preflight.every((entry) =>
      entry.blockers.some((blocker) => blocker.startsWith("source_buffer:"))
    ));
  });
});

test("simulation start creates one idempotent 3x3 run and dispatches all nine source ingests", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const input = {
      workspaceId: seeded.workspaceId,
      profileIds: seeded.profiles.map((profile) => profile.id),
      logicalDate: "2026-07-10",
      mode: "simulation" as const,
      targetPerChannel: 3,
      publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID,
      idempotencyKey: "request-one"
    };
    const first = await startPortfolioProductionRun(input, dependencies());
    assert.equal(first.existing, false);
    assert.equal(first.run.status, "running", JSON.stringify(first.preflight, null, 2));
    assert.equal(first.canaryPolicy, "none");
    assert.equal(first.canaryItemId, null);
    assert.equal(first.items.length, 9);
    assert.ok(first.items.every((item) => item.attemptBudget === 5));
    assert.equal(first.items.filter((item) => item.sourceCandidateId).length, 9);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM production_outbox").get() as { count: number }).count,
      9
    );

    const lostResponseRetry = await startPortfolioProductionRun(input, {
      featureFlagEnabled: () => true,
      validateLiveProfile: async () => {
        throw new Error("repeat must return before volatile live preflight");
      }
    });
    assert.equal(lostResponseRetry.existing, true);
    assert.equal(lostResponseRetry.run.id, first.run.id);

    const second = await startPortfolioProductionRun(
      { ...input, idempotencyKey: "request-two" },
      dependencies()
    );
    assert.equal(second.existing, true);
    assert.equal(second.run.id, first.run.id);
    assert.equal(second.items.length, 9);
  });
});

test("shadow owner contour accepts one item per channel while live remains exact 3x3", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const shadow = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-10",
        mode: "shadow",
        targetPerChannel: 1,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies()
    );
    assert.equal(shadow.run.targetPerChannel, 1);
    assert.equal(shadow.canaryPolicy, "none");
    assert.equal(shadow.items.length, 3);
    assert.equal(shadow.channels.length, 3);
    assert.ok(shadow.channels.every((channel) => channel.target === 1));
    assert.equal(new Set(shadow.items.map((item) => item.channelId)).size, 3);
    assert.equal(listProductionOutbox({ runId: shadow.run.id }).length, 3);
    assert.ok(listProductionOutbox({ runId: shadow.run.id }).every(
      (event) => event.eventKind === "source_ingest.requested"
    ));

    await assert.rejects(
      () => startPortfolioProductionRun(
        {
          workspaceId: seeded.workspaceId,
          profileIds: seeded.profiles.map((profile) => profile.id),
          logicalDate: "2026-07-11",
          mode: "live",
          targetPerChannel: 1,
          publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
        },
        dependencies()
      ),
      /Live Project Kings runs require targetPerChannel=3/
    );
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM production_runs WHERE mode = 'live'").get() as { count: number }).count,
      0
    );
  });
});

test("live start releases one canary per channel before the remaining six", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const result = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-10",
        mode: "live",
        targetPerChannel: 3,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies()
    );
    assert.equal(result.items.length, 9, JSON.stringify(result.preflight, null, 2));
    assert.equal(result.canaryPolicy, "first_item_per_channel_public_verified");
    assert.equal(result.run.manifest.canaryPolicy, "first_item_per_channel_public_verified");
    const sourcePolicyApproval = result.run.manifest.sourcePolicyApproval as {
      approvalSha256?: string;
      policySha256?: string;
    };
    assert.match(sourcePolicyApproval.approvalSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(sourcePolicyApproval.policySha256, PROJECT_KINGS_SOURCE_POLICY_SHA256);
    assert.ok(result.canaryItemId);
    assert.equal(result.canaryItemIds.length, 3);
    assert.equal(new Set(result.canaryItemIds.map((id) => result.items.find((item) => item.id === id)!.channelId)).size, 3);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM production_outbox").get() as { count: number }).count,
      3
    );
  });
});

test("shadow/live require current source-policy approval while simulation remains offline-safe", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    getDb().prepare("DELETE FROM project_kings_source_policy_approvals WHERE workspace_id = ?")
      .run(seeded.workspaceId);
    await assert.rejects(() => startPortfolioProductionRun({
      workspaceId: seeded.workspaceId,
      profileIds: seeded.profiles.map((profile) => profile.id),
      logicalDate: "2040-01-10",
      mode: "live",
      targetPerChannel: 3,
      publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
    }, dependencies()), /requires an active owner approval.*source policy/);
    const simulation = await startPortfolioProductionRun({
      workspaceId: seeded.workspaceId,
      profileIds: seeded.profiles.map((profile) => profile.id),
      logicalDate: "2040-01-10",
      mode: "simulation",
      targetPerChannel: 3,
      publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
    }, dependencies());
    assert.equal(simulation.run.manifest.sourcePolicyApproval, null);
    assert.equal(simulation.run.status, "running");
    assert.equal(simulation.items.length, 9);
  });
});

test("live start rejects an active profile that has only legacy approval fields", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    getDb().prepare(`UPDATE production_profiles
      SET approval_scope = NULL, approval_binding_sha256 = NULL
      WHERE id = ?`).run(seeded.profiles[0]!.id);
    await assert.rejects(() => startPortfolioProductionRun({
      workspaceId: seeded.workspaceId,
      profileIds: seeded.profiles.map((profile) => profile.id),
      logicalDate: "2040-01-09",
      mode: "live",
      targetPerChannel: 3,
      publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID,
      canaryPolicy: "first_item_per_channel_public_verified"
    }, dependencies()), /explicitly approved, hash-bound active/);
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM production_runs").get() as { count: number }).count,
      0
    );
  });
});

test("global canary barrier blocks at 1/3 and 2/3, then releases exactly six once at unambiguous 3/3", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const started = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-10",
        mode: "live",
        targetPerChannel: 3,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies()
    );
    const canaryItemIds = new Set(started.canaryItemIds);
    const canaries = started.canaryItemIds.map(
      (itemId) => started.items.find((item) => item.id === itemId)!
    );
    assert.equal(canaries.length, 3);
    const postCanaryItems = started.items.filter((item) => !canaryItemIds.has(item.id));
    assert.equal(postCanaryItems.length, 6);
    const releasedSourceIngests = () => listProductionOutbox({ runId: started.run.id })
      .filter((event) =>
        event.eventKind === "source_ingest.requested" &&
        !canaryItemIds.has(event.productionItemId)
      );
    const markPublicVerified = (index: number, youtubeVideoId: string) => {
      getDb().prepare(`UPDATE production_items
        SET state = 'public_verified', youtube_video_id = ?, version = version + 1
        WHERE id = ?`).run(youtubeVideoId, canaries[index]!.id);
    };

    markPublicVerified(0, "YT_CANARY_1");
    reconcilePortfolioProductionRun({
      runId: started.run.id,
      leaseOwner: "global-canary-one"
    });
    assert.equal(releasedSourceIngests().length, 0, "1/3 canaries must release no post-canary work");

    markPublicVerified(1, "YT_CANARY_2");
    reconcilePortfolioProductionRun({
      runId: started.run.id,
      leaseOwner: "global-canary-two"
    });
    assert.equal(releasedSourceIngests().length, 0, "2/3 canaries must release no post-canary work");

    markPublicVerified(2, "YT_CANARY_2");
    reconcilePortfolioProductionRun({
      runId: started.run.id,
      leaseOwner: "global-canary-ambiguous"
    });
    assert.equal(
      releasedSourceIngests().length,
      0,
      "duplicate public IDs make the 3/3 state ambiguous and must fail closed"
    );

    getDb().prepare("UPDATE production_items SET youtube_video_id = ?, version = version + 1 WHERE id = ?")
      .run("YT_CANARY_3", canaries[2]!.id);
    reconcilePortfolioProductionRun({
      runId: started.run.id,
      leaseOwner: "global-canary-three"
    });
    const released = releasedSourceIngests();
    assert.equal(released.length, 6);
    assert.equal(new Set(released.map((event) => event.productionItemId)).size, 6);
    assert.deepEqual(
      [...new Set(released.map((event) => event.productionItemId))].sort(),
      postCanaryItems.map((item) => item.id).sort()
    );
    assert.deepEqual(
      [...released.reduce((counts, event) => {
        counts.set(event.channelId, (counts.get(event.channelId) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()).values()].sort(),
      [2, 2, 2]
    );

    reconcilePortfolioProductionRun({
      runId: started.run.id,
      leaseOwner: "global-canary-idempotent-restart"
    });
    assert.equal(releasedSourceIngests().length, 6, "reconcile must not duplicate the six released intents");
  });
});

test("live start rejects canaryPolicy none without the explicit post-canary flag", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    await assert.rejects(
      () => startPortfolioProductionRun(
        {
          workspaceId: seeded.workspaceId,
          profileIds: seeded.profiles.map((profile) => profile.id),
          logicalDate: "2026-07-10",
          mode: "live",
          canaryPolicy: "none",
          targetPerChannel: 3,
          publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
        },
        {
          ...dependencies(),
          featureFlagEnabled: (flag) => flag === PORTFOLIO_PIPELINE_FEATURE_FLAG
        }
      ),
      /PORTFOLIO_PIPELINE_POST_CANARY_ENABLED=1/
    );
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM production_runs").get() as { count: number }).count,
      0
    );
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM production_outbox").get() as { count: number }).count,
      0
    );
  });
});

test("approved live canaryPolicy none atomically releases all nine and stays idempotent after restart", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const input = {
      workspaceId: seeded.workspaceId,
      profileIds: seeded.profiles.map((profile) => profile.id),
      logicalDate: "2026-07-10",
      mode: "live" as const,
      canaryPolicy: "none" as const,
      targetPerChannel: 3,
      publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID,
      idempotencyKey: "approved-post-canary-none"
    };
    const started = await startPortfolioProductionRun(input, dependencies());
    assert.equal(started.existing, false);
    assert.equal(started.canaryPolicy, "none");
    assert.equal(started.canaryItemId, null);
    assert.equal(started.run.manifest.canaryPolicy, "none");
    assert.equal(started.items.length, 9);
    assert.equal(started.items.filter((item) => item.sourceCandidateId).length, 9);
    assert.equal(listProductionOutbox({ runId: started.run.id }).length, 9);
    assert.ok(listProductionOutbox({ runId: started.run.id }).every(
      (entry) => entry.eventKind === "source_ingest.requested" && entry.status === "pending"
    ));

    const restarted = await startPortfolioProductionRun(input, {
      featureFlagEnabled: () => true,
      validateLiveProfile: async () => {
        throw new Error("idempotent restart must use frozen preflight");
      }
    });
    assert.equal(restarted.existing, true);
    assert.equal(restarted.run.id, started.run.id);
    assert.equal(restarted.canaryPolicy, "none");
    assert.equal(restarted.canaryItemId, null);
    assert.equal(listProductionOutbox({ runId: started.run.id }).length, 9);

    const reconciled = reconcilePortfolioProductionRun({
      runId: started.run.id,
      leaseOwner: "post-canary-restart"
    });
    assert.equal(reconciled.canaryPolicy, "none");
    assert.equal(reconciled.canaryItemId, null);
    assert.equal(listProductionOutbox({ runId: started.run.id }).length, 9);

    await assert.rejects(
      () => startPortfolioProductionRun({
        ...input,
        canaryPolicy: "first_item_per_channel_public_verified"
      }, dependencies()),
      /Idempotency key is already bound to a different immutable portfolio request/
    );
  });
});

test("cancel request remains nonterminal until every item is reconciled, then closes once", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const started = await startPortfolioProductionRun({
      workspaceId: seeded.workspaceId,
      profileIds: seeded.profiles.map((profile) => profile.id),
      logicalDate: "2026-07-10",
      mode: "simulation",
      targetPerChannel: 3,
      publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
    }, dependencies());
    const cancelRequested = cancelProductionRun({
      runId: started.run.id,
      expectedVersion: started.run.version,
      reason: "owner cancellation regression"
    });
    assert.equal(cancelRequested.run.status, "cancel_requested");
    assert.equal(cancelRequested.run.completedAt, null);

    const stillReconciling = reconcilePortfolioProductionRun({
      runId: started.run.id,
      leaseOwner: "cancel-regression-before"
    });
    assert.equal(stillReconciling.run.status, "cancel_requested");

    for (const original of stillReconciling.items) {
      const item = getProductionItem(original.id)!;
      transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "canceled",
        eventType: "test.cancel_reconciled"
      });
    }
    const settled = reconcilePortfolioProductionRun({
      runId: started.run.id,
      leaseOwner: "cancel-regression-after"
    });
    assert.equal(settled.run.status, "canceled");
    assert.ok(settled.channels.every((channel) => channel.status === "canceled"));
  });
});

test("one blocked channel does not stop the other two channel runs", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const blocked = seeded.profiles[1]!;
    const result = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-10",
        mode: "shadow",
        targetPerChannel: 3,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies(blocked.id)
    );
    assert.equal(result.run.status, "running", JSON.stringify(result.preflight, null, 2));
    assert.equal(result.channels.filter((channel) => channel.status === "blocked").length, 1);
    assert.equal(result.channels.filter((channel) => channel.status === "running").length, 2);
    assert.equal(result.items.length, 6);
    assert.equal(getPortfolioProductionRun(result.run.id).items.length, 6);
  });
});

test("simulation runs all nine items through public_verified with zero polling tokens", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const started = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-10",
        mode: "simulation",
        targetPerChannel: 3,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies()
    );
    const replay = await runPortfolioSimulationUntilSettled({ runId: started.run.id });

    assert.equal(replay.summary.run.status, "completed");
    assert.equal(replay.summary.counts.publicVerified, 9);
    assert.equal(new Set(replay.summary.youtubeVideoIds).size, 9);
    assert.equal(replay.dead, 0);
    assert.ok(listProductionOutbox({ runId: started.run.id }).every((event) => event.status === "delivered"));
    const attempts = listAgentAttempts({ runId: started.run.id });
    assert.equal(attempts.length, 45);
    assert.ok(attempts.every((attempt) => attempt.inputTokens === 0 && attempt.outputTokens === 0));
    assert.equal(
      (getDb().prepare("SELECT COUNT(*) AS count FROM channel_source_candidates WHERE status = 'consumed'")
        .get() as { count: number }).count,
      9
    );
  });
});

test("simulation recovers two transient final-render failures through durable outbox", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const started = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-10",
        mode: "simulation",
        targetPerChannel: 3,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies()
    );
    const replay = await runPortfolioSimulationUntilSettled({
      runId: started.run.id,
      dispatcher: createPortfolioSimulationDispatcher({
        faults: { failBeforeEvent: { "final_render.requested": 2 } }
      })
    });

    assert.equal(replay.summary.run.status, "completed");
    assert.equal(replay.summary.counts.publicVerified, 9);
    assert.equal(replay.retried, 2);
    assert.equal(replay.dead, 0);
    assert.ok(listProductionOutbox({ runId: started.run.id }).every((event) => event.status === "delivered"));
  });
});

test("upload outcome unknown reconciles the original identity without a duplicate upload", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const started = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-10",
        mode: "simulation",
        targetPerChannel: 3,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies()
    );
    const replay = await runPortfolioSimulationUntilSettled({
      runId: started.run.id,
      dispatcher: createPortfolioSimulationDispatcher({
        faults: { uploadOutcomeUnknownOnce: true }
      })
    });

    assert.equal(replay.summary.run.status, "completed");
    assert.equal(replay.summary.counts.publicVerified, 9);
    assert.equal(new Set(replay.summary.youtubeVideoIds).size, 9);
    const events = listProductionEvents({ runId: started.run.id });
    assert.equal(events.filter((event) => event.eventType === "simulation.upload_outcome_unknown").length, 1);
    assert.equal(events.filter((event) => event.eventType === "simulation.upload_reconciled").length, 1);
    assert.ok(listProductionOutbox({ runId: started.run.id }).every((event) => event.status === "delivered"));
  });
});

test("shadow mode completes at final_approved and creates no publication identity", async () => {
  await withIsolatedAppData(async () => {
    const seeded = await seedPortfolio();
    const started = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-10",
        mode: "shadow",
        targetPerChannel: 3,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies()
    );
    const replay = await runPortfolioSimulationUntilSettled({ runId: started.run.id });

    assert.equal(replay.summary.run.status, "completed");
    assert.equal(replay.summary.counts.publicVerified, 0);
    assert.ok(replay.summary.items.every((item) => item.state === "final_approved"));
    assert.ok(replay.summary.items.every((item) => item.sourceCandidateId));
    assert.ok(replay.summary.items.every((item) => !item.publicationId && !item.youtubeVideoId));
    assert.equal(
      seeded.profiles.flatMap((profile) => listChannelSourceCandidates({
        workspaceId: seeded.workspaceId,
        channelId: profile.channelId,
        status: "reserved"
      })).length,
      0
    );
    assert.equal(
      listProductionEvents({ runId: started.run.id })
        .filter((event) => event.eventType === "production.source.shadow_released").length,
      9
    );

    const beforeRepeat = listProductionEvents({ runId: started.run.id }).length;
    const repeated = reconcilePortfolioProductionRun({
      runId: started.run.id,
      leaseOwner: "shadow-repeat"
    });
    assert.equal(repeated.run.status, "completed");
    assert.equal(listProductionEvents({ runId: started.run.id }).length, beforeRepeat);

    const oldItem = replay.summary.items[0]!;
    const oldCandidateId = oldItem.sourceCandidateId!;
    const second = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-11",
        mode: "shadow",
        targetPerChannel: 3,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies()
    );
    const firstSourceIds = new Set(replay.summary.items.map((item) => item.sourceCandidateId));
    const secondSourceIds = new Set(second.items.map((item) => item.sourceCandidateId));
    assert.equal([...secondSourceIds].filter((candidateId) => firstSourceIds.has(candidateId)).length, 0);

    const secondReplay = await runPortfolioSimulationUntilSettled({ runId: second.run.id });
    assert.equal(secondReplay.summary.run.status, "completed");
    const third = await startPortfolioProductionRun(
      {
        workspaceId: seeded.workspaceId,
        profileIds: seeded.profiles.map((profile) => profile.id),
        logicalDate: "2026-07-12",
        mode: "shadow",
        targetPerChannel: 3,
        publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID
      },
      dependencies()
    );
    const reReserved = seeded.profiles.flatMap((profile) => listChannelSourceCandidates({
      workspaceId: seeded.workspaceId,
      channelId: profile.channelId,
      status: "reserved"
    })).find((candidate) => candidate.id === oldCandidateId)!;
    assert.ok(reReserved.reservedItemId);
    assert.notEqual(reReserved.reservedItemId, oldItem.id);

    const replayedRelease = releaseShadowSourceCandidateReservation({
      candidateId: oldCandidateId,
      itemId: oldItem.id,
      expectedItemVersion: oldItem.version
    });
    assert.equal(replayedRelease.released, false);
    const stillReserved = seeded.profiles.flatMap((profile) => listChannelSourceCandidates({
      workspaceId: seeded.workspaceId,
      channelId: profile.channelId,
      status: "reserved"
    })).find((candidate) => candidate.id === oldCandidateId)!;
    assert.equal(stillReserved.reservedItemId, reReserved.reservedItemId);
    assert.equal(third.run.status, "running");
    assert.ok(listProductionOutbox({ runId: started.run.id }).every((event) => event.status === "delivered"));
  });
});
