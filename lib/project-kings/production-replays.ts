import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { getDb } from "../db/client";
import {
  approveProductionProfile,
  ProductionStoreError,
  calculateQualityVerdictBindingSha256,
  claimProductionOutbox,
  createReplacementProductionItem,
  getLatestQualityVerdictForArtifact,
  getProductionItem,
  getProductionProfile,
  listAgentAttempts,
  listChannelSourceCandidates,
  listProductionEvents,
  listProductionItems,
  listProductionOutbox,
  listProductionRunChannelAttemptedCandidateIds,
  quarantineChannelSourceCandidate,
  recordAgentAttempt,
  recordQualityVerdict,
  releaseChannelSourceCandidate,
  reserveChannelSourceCandidate,
  transitionChannelSourceCandidateQualification,
  transitionProductionItem,
  upsertChannelSourceCandidate,
  type AgentAttemptRecord,
  type ProductionItemRecord,
  type ProductionProfileRecord
} from "../portfolio-production-store";
import { approveCurrentProjectKingsSourcePolicy } from "./source-policy-approval-store";
import {
  PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION,
  createProjectKingsSensitiveContentAssessment,
  createProjectKingsSourceDesignationEvidence,
  hashProjectKingsSourcePolicyArtifact,
  type ProjectKingsSourcePolicyApproval
} from "./source-rights-sensitive-policy";
import {
  buildProjectKingsSourceQualificationEvidence,
  calculateProjectKingsLiveInventorySha256,
  canonicalizeProjectKingsSourceUrl,
  type ProjectKingsLivePublicationInventory
} from "./source-buffer-readiness";
import { PROJECT_KINGS_IMPORTED_SOURCE_EVIDENCE_VERSION } from "./source-buffer-refill";
import {
  PROJECT_KINGS_PUBLISH_POLICY_ID,
  dispatchPortfolioProductionOutbox,
  getPortfolioProductionRun,
  reconcilePortfolioProductionRun,
  startPortfolioProductionRun,
  type PortfolioOrchestratorDependencies,
  type PortfolioOutboxDispatcher,
  type PortfolioRunSummary
} from "../portfolio-production-orchestrator";
import {
  createPortfolioSimulationDispatcher,
  runPortfolioSimulationUntilSettled
} from "../portfolio-production-simulation";
import {
  buildProductionArtifactBindingSha256,
  decideProductionRevision,
  evaluateProductionQualityGate,
  type FinalMp4Probe,
  type ProductionArtifactBinding,
  type ProductionQualityDefect,
  type ProductionVisionVerdict
} from "../production-quality-gate";
import { decidePortfolioLiveRecoveryBudget } from "../portfolio-production-live-runtime";
import { validateProductionAgentOutput } from "./production-agent-contracts";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "./pilot-production-profiles";
import {
  PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID,
  PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256,
  PROJECT_KINGS_QUALITY_POLICY_ID,
  calculateProductionProfileHash
} from "./pilot-profile-store";

export type ProjectKingsReplayAssertion = {
  name: string;
  pass: true;
  expected: unknown;
  actual: unknown;
};

export type ProjectKingsReplayEvidence = {
  schemaVersion: "project-kings-replay-evidence-v1";
  scenarioId: "historical-july-9" | "infrastructure-recovery" | "content-rework";
  runId: string;
  runIdKind: "deterministic-business-alias";
  logicalDate: string;
  clock: {
    startedAt: string;
    finishedAt: string;
    logicalDurationMs: number;
    ticks: number;
  };
  sourceEvidence: Record<string, unknown>;
  injections: Array<Record<string, unknown>>;
  assertions: ProjectKingsReplayAssertion[];
  metrics: Record<string, unknown>;
  externalEffects: {
    networkRequests: 0;
    youtubeUploadRequests: 0;
    publicVideosCreated: 0;
  };
  outcome: "pass";
  evidenceSha256: string;
};

export type ProjectKingsReplaySuite = {
  historical: ProjectKingsReplayEvidence;
  infrastructure: ProjectKingsReplayEvidence;
  content: ProjectKingsReplayEvidence;
};

// Test-observability snapshot: the isolated replay DB is torn down when the
// scenario returns, so the outbox must be captured before teardown to prove the
// virtual clock (not the real wall clock) stamped every availableAt.
export type ProjectKingsReplayOutboxAudit = {
  scenarioId: ReplayScenarioId;
  finishedAt: string;
  outbox: Array<{ id: string; eventKind: string; status: string; availableAt: string }>;
};

type ReplayScenarioId = ProjectKingsReplayEvidence["scenarioId"];

// Mutable virtual clock (epoch ms) owned by each scenario runner. The same
// object is shared with run-start dependencies, the simulation dispatcher, the
// outbox dispatch loop, and reconcile so replay time stays fully coherent.
type ReplayClock = { ms: number };

const FIXED_APPROVED_AT = "2026-07-10T08:00:00.000Z";
const TEMPLATE_ID_BY_PROFILE: Record<ProjectKingsPilotProfileKey, string> = {
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

function hash(value: unknown): string {
  const content = typeof value === "string" ? value : JSON.stringify(canonicalize(value));
  return createHash("sha256").update(content).digest("hex");
}

function replayQualifiedSourceEvidence(input: {
  scenarioId: ReplayScenarioId;
  profileKey: ProjectKingsPilotProfileKey;
  candidateId: string;
  sourceUrl: string;
  contentSha256: string;
  eventFingerprint: string;
  policyApproval: ProjectKingsSourcePolicyApproval;
}) {
  const profile = PROJECT_KINGS_PILOT_PROFILES[input.profileKey];
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
    upstreamDiscoveryEvidenceSha256: hash({
      scenarioId: input.scenarioId,
      candidateId: input.candidateId,
      evidence: "designation"
    })
  });
  const sensitiveAssessment = createProjectKingsSensitiveContentAssessment({
    candidateId: input.candidateId,
    contentSha256: input.contentSha256,
    upstreamEvidenceSha256: hash({
      scenarioId: input.scenarioId,
      candidateId: input.candidateId,
      evidence: "sensitive-assessment"
    }),
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
    reason: "Frozen deterministic replay source matches the channel contract.",
    factualClaims: []
  };
  const inventory: ProjectKingsLivePublicationInventory = {
    schemaVersion: 1,
    capturedAt: FIXED_APPROVED_AT,
    surface: "deterministic replay fixture",
    channels: []
  };
  const liveInventorySha256 = calculateProjectKingsLiveInventorySha256(inventory);
  const relativePath = `.data/replays/${input.candidateId}.mp4`;
  const result = buildProjectKingsSourceQualificationEvidence({
    capturedAt: FIXED_APPROVED_AT,
    candidateId: input.candidateId,
    profileKey: input.profileKey,
    sourceUrl: canonicalUrl,
    provider: "instagram",
    provisionalStoryEventId: input.eventFingerprint,
    rightsStatus: "owner_approved_source_pool",
    discoveryState: "frozen_catalog",
    sourcePolicyApproval: input.policyApproval,
    sourceDesignation: designation,
    sensitiveAssessment,
    liveInventorySha256,
    media: {
      resolvedCopies: [relativePath],
      duplicateCopiesIgnored: [],
      uniqueContentHashes: [input.contentSha256],
      selected: {
        relativePath,
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
    },
    sourceFitAttestation: {
      candidateId: input.candidateId,
      profileKey: input.profileKey,
      sourceUrl: canonicalUrl,
      contentSha256: input.contentSha256,
      profileHash: calculateProductionProfileHash(profile),
      liveInventorySha256,
      agentAttemptId: `replay-source-fit-${input.candidateId}`,
      model: "replay:deterministic",
      reasoningLevel: "none",
      promptSha256: hash({ candidateId: input.candidateId, input: "prompt" }),
      artifactSetSha256: hash({ candidateId: input.candidateId, input: "artifacts" }),
      rawOutputSha256: hash({ candidateId: input.candidateId, input: "raw-output" }),
      outputSha256: hashProjectKingsSourcePolicyArtifact(output),
      finishedAt: FIXED_APPROVED_AT,
      output
    }
  });
  if (result.status !== "qualified" || !result.evidence) {
    throw new Error(`Replay source policy fixture failed: ${JSON.stringify(result.blockers)}`);
  }
  return {
    schemaVersion: PROJECT_KINGS_IMPORTED_SOURCE_EVIDENCE_VERSION,
    sourceBufferEvidenceSha256: hash({ scenarioId: input.scenarioId, candidateId: input.candidateId }),
    qualification: result.evidence,
    localArtifact: result.evidence.media
  };
}

function replayAlias(scenarioId: ReplayScenarioId, logicalDate: string): string {
  return `pk-replay-${scenarioId}-${logicalDate}-v1`;
}

function closeReplayDb(): void {
  const scope = globalThis as typeof globalThis & { __clipsAppDb?: DatabaseSync };
  if (scope.__clipsAppDb) {
    try {
      scope.__clipsAppDb.close();
    } catch {
      // A prior restart injection may already have closed this handle.
    }
  }
  delete scope.__clipsAppDb;
}

async function withIsolatedReplayDb<T>(scenarioId: ReplayScenarioId, run: () => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), `clips-${scenarioId}-`));
  const previous = process.env.APP_DATA_DIR;
  closeReplayDb();
  process.env.APP_DATA_DIR = dataDir;
  try {
    return await run();
  } finally {
    closeReplayDb();
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    await rm(dataDir, { recursive: true, force: true });
  }
}

function addAssertion(
  assertions: ProjectKingsReplayAssertion[],
  name: string,
  actual: unknown,
  expected: unknown,
  pass: boolean
): void {
  if (!pass) {
    throw new Error(`Replay assertion failed: ${name}; expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
  assertions.push({ name, pass: true, expected, actual });
}

function finalizeEvidence(
  evidence: Omit<ProjectKingsReplayEvidence, "evidenceSha256">
): ProjectKingsReplayEvidence {
  return {
    ...evidence,
    evidenceSha256: hash(evidence)
  };
}

function seedReplayPortfolio(scenarioId: ReplayScenarioId): {
  workspaceId: string;
  userId: string;
  profiles: ProductionProfileRecord[];
} {
  const db = getDb();
  const workspaceId = `replay-workspace-${scenarioId}`;
  const userId = `replay-owner-${scenarioId}`;
  db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(workspaceId, `Replay ${scenarioId}`, `replay-${scenarioId}`, FIXED_APPROVED_AT, FIXED_APPROVED_AT);
  db.prepare(`INSERT INTO users
    (id, email, password_hash, display_name, status, created_at, updated_at)
    VALUES (?, ?, 'replay-no-login', 'Replay Owner', 'active', ?, ?)`)
    .run(userId, `${scenarioId}@replay.invalid`, FIXED_APPROVED_AT, FIXED_APPROVED_AT);
  db.prepare(`INSERT INTO workspace_members
    (id, workspace_id, user_id, role, created_at, updated_at)
    VALUES (?, ?, ?, 'owner', ?, ?)`)
    .run(`replay-member-${scenarioId}`, workspaceId, userId, FIXED_APPROVED_AT, FIXED_APPROVED_AT);

  const sourcePolicyApproval = approveCurrentProjectKingsSourcePolicy({
    workspaceId,
    ownerUserId: userId,
    policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
    policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
    sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
    ownerAuthorizationEvidenceSha256: hash({ scenarioId, decision: "replay-source-policy-approval" }),
    approvalId: `replay-source-policy-approval-${scenarioId}`,
    approvedAt: FIXED_APPROVED_AT
  }).approval.approval;

  const profiles: ProductionProfileRecord[] = [];
  for (const [key, profile] of Object.entries(PROJECT_KINGS_PILOT_PROFILES) as Array<
    [ProjectKingsPilotProfileKey, (typeof PROJECT_KINGS_PILOT_PROFILES)[ProjectKingsPilotProfileKey]]
  >) {
    db.prepare(`INSERT INTO channels
      (id, workspace_id, creator_user_id, name, username, system_prompt, description_prompt,
       examples_json, template_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', '', '[]', ?, ?, ?)`)
      .run(profile.profileId, workspaceId, userId, profile.youtube.titleAdvisory, key,
        TEMPLATE_ID_BY_PROFILE[key], FIXED_APPROVED_AT, FIXED_APPROVED_AT);
    const profileId = `replay-profile-${key}-v1`;
    const profileHash = calculateProductionProfileHash(profile);
    db.prepare(`INSERT INTO production_profiles
      (id, workspace_id, channel_id, version, status, profile_hash, expected_youtube_channel_id,
       expected_destination_title, template_id, template_snapshot_sha256, publish_policy_id,
       quality_policy_id, model_route_manifest_id, model_route_manifest_sha256,
       target_per_logical_day, ready_buffer_min,
       ready_buffer_cap, candidate_attempt_budget, config_json, created_at, approved_at, approved_by_user_id)
      VALUES (?, ?, ?, 1, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, 6, 12, 9, ?, ?, ?, ?)`)
      .run(profileId, workspaceId, profile.profileId, profileHash, profile.youtube.channelId,
        profile.youtube.titleAdvisory, TEMPLATE_ID_BY_PROFILE[key], profile.templateIdentity.templateSha,
        PROJECT_KINGS_PUBLISH_POLICY_ID, PROJECT_KINGS_QUALITY_POLICY_ID,
        PROJECT_KINGS_MODEL_ROUTE_MANIFEST_ID, PROJECT_KINGS_MODEL_ROUTE_MANIFEST_SHA256,
        JSON.stringify(profile), FIXED_APPROVED_AT,
        FIXED_APPROVED_AT, userId);
    const stored = getProductionProfile(profileId);
    if (!stored) throw new Error(`Replay profile was not stored: ${profileId}`);
    profiles.push(approveProductionProfile({
      workspaceId,
      profileId: stored.id,
      expectedVersion: stored.version,
      expectedProfileHash: stored.profileHash,
      targetStatus: "active",
      approvedByUserId: userId,
      approvedAt: FIXED_APPROVED_AT
    }));

    profile.concept.continuityBuffer.uniqueStoryEventIds.slice(0, 8).forEach((eventFingerprint, index) => {
      const candidateId = `replay-${key}-${index + 1}`;
      const sourceUrl = `https://www.instagram.com/reel/REPLAY_${key}_${index + 1}/`;
      const contentSha256 = hash({ scenarioId, key, eventFingerprint, index });
      const evidence = replayQualifiedSourceEvidence({
        scenarioId,
        profileKey: key,
        candidateId,
        sourceUrl,
        contentSha256,
        eventFingerprint,
        policyApproval: sourcePolicyApproval
      });
      const discovered = upsertChannelSourceCandidate({
        workspaceId,
        channelId: profile.profileId,
        provider: "instagram-replay-fixture",
        sourceUrl,
        canonicalUrl: sourceUrl,
        contentSha256,
        eventFingerprint,
        categoryKey: profile.concept.conceptId,
        rightsStatus: "owner_approved_source_pool",
        evidence
      }).candidate;
      transitionChannelSourceCandidateQualification({
        candidateId: discovered.id,
        toStatus: "qualified",
        contentSha256: discovered.contentSha256,
        eventFingerprint: discovered.eventFingerprint,
        evidence
      });
    });
  }
  return { workspaceId, userId, profiles };
}

function replayDependencies(
  scenarioId: ReplayScenarioId,
  clock: ReplayClock
): PortfolioOrchestratorDependencies {
  return {
    featureFlagEnabled: () => true,
    // One virtual clock drives run-start store writes (source reservation
    // availableAt), the outbox dispatch, and reconcile. Reading a frozen
    // FIXED_APPROVED_AT here while dispatch advanced a different clock is what
    // made replay outbox events land in the virtual future and stall forever.
    now: () => new Date(clock.ms),
    validateLiveProfile: async (profile) => ({
      liveFactsHash: hash({ scenarioId, profileId: profile.id, status: "frozen-local-replay" }),
      checks: [
        {
          code: "replay_destination_identity",
          pass: true,
          blocking: true,
          expected: profile.expectedYoutubeChannelId,
          actual: profile.expectedYoutubeChannelId,
          detail: "Stable destination identity comes from the frozen profile; no live request was made."
        },
        {
          code: "replay_external_side_effects",
          pass: true,
          blocking: true,
          expected: 0,
          actual: 0,
          detail: "Replay adapters cannot access publication or network surfaces."
        }
      ]
    })
  };
}

async function startReplayRun(input: {
  scenarioId: ReplayScenarioId;
  logicalDate: string;
  mode: "simulation" | "shadow";
  clock: ReplayClock;
}): Promise<PortfolioRunSummary> {
  const seeded = seedReplayPortfolio(input.scenarioId);
  return startPortfolioProductionRun(
    {
      workspaceId: seeded.workspaceId,
      profileIds: seeded.profiles.map((profile) => profile.id),
      logicalDate: input.logicalDate,
      mode: input.mode,
      targetPerChannel: 3,
      publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID,
      idempotencyKey: replayAlias(input.scenarioId, input.logicalDate)
    },
    replayDependencies(input.scenarioId, input.clock)
  );
}

async function dispatchUntilTerminal(input: {
  runId: string;
  dispatcher: PortfolioOutboxDispatcher;
  startedAtMs: number;
  clock: ReplayClock;
  maxTicks?: number;
}): Promise<{
  summary: PortfolioRunSummary;
  ticks: number;
  logicalFinishedAtMs: number;
  delivered: number;
  retried: number;
  dead: number;
}> {
  const clock = input.clock;
  clock.ms = input.startedAtMs;
  let delivered = 0;
  let retried = 0;
  let dead = 0;
  for (let tick = 1; tick <= (input.maxTicks ?? 100); tick += 1) {
    const batch = await dispatchPortfolioProductionOutbox({
      owner: `replay-dispatch-${tick}`,
      dispatcher: input.dispatcher,
      limit: 100,
      leaseMs: 5_000,
      retryDelayMs: 1_000,
      now: new Date(clock.ms)
    });
    delivered += batch.delivered;
    retried += batch.retried;
    dead += batch.dead;
    const summary = reconcilePortfolioProductionRun({
      runId: input.runId,
      leaseOwner: `replay-reconcile-${tick}`,
      now: new Date(clock.ms)
    });
    if (["completed", "blocked", "failed"].includes(summary.run.status)) {
      let drainTicks = 0;
      while (listProductionOutbox({ runId: input.runId, status: "pending" }).length > 0 && drainTicks < 10) {
        drainTicks += 1;
        clock.ms += 1_000;
        const drain = await dispatchPortfolioProductionOutbox({
          owner: `replay-terminal-drain-${drainTicks}`,
          dispatcher: input.dispatcher,
          limit: 100,
          leaseMs: 5_000,
          retryDelayMs: 1_000,
          now: new Date(clock.ms)
        });
        delivered += drain.delivered;
        retried += drain.retried;
        dead += drain.dead;
        if (drain.claimed === 0) break;
      }
      return {
        summary,
        ticks: tick + drainTicks,
        logicalFinishedAtMs: clock.ms,
        delivered,
        retried,
        dead
      };
    }
    clock.ms += 1_000;
  }
  throw new Error(`Replay did not settle in ${input.maxTicks ?? 100} ticks.`);
}

function zeroExternalEffects(): ProjectKingsReplayEvidence["externalEffects"] {
  return { networkRequests: 0, youtubeUploadRequests: 0, publicVideosCreated: 0 };
}

function canReplaceFromBudget(
  budget: ReturnType<typeof decidePortfolioLiveRecoveryBudget> | null
): boolean | null {
  return budget?.canReplace ?? null;
}

export async function runHistoricalJuly9Replay(options: {
  repoRoot?: string;
} = {}): Promise<ProjectKingsReplayEvidence> {
  return withIsolatedReplayDb("historical-july-9", async () => {
    const repoRoot = options.repoRoot ?? process.cwd();
    const baselinePath = path.join(
      repoRoot,
      "docs/project-kings-production-pipeline-v1/evidence/baseline-2026-07-09.json"
    );
    const baselineRaw = await readFile(baselinePath, "utf8");
    const baseline = JSON.parse(baselineRaw) as {
      operatorIntensiveWindow: { from: string; to: string; usage: { logicalTokenEvents: number } };
      acceptedOutput: { publicVerifiedVideos: number; targetVideos: number; logicalTokenEventsPerPublicVideo: number };
      sourceSession: { sessionId: string; rootTranscriptSha256: string; subagentTranscriptSetSha256: string };
    };
    const startedAt = "2026-07-11T10:00:00.000Z";
    const clock: ReplayClock = { ms: new Date(startedAt).getTime() };
    const started = await startReplayRun({
      scenarioId: "historical-july-9",
      logicalDate: "2026-07-09",
      mode: "shadow",
      clock
    });
    const replay = await runPortfolioSimulationUntilSettled({
      runId: started.run.id,
      startTime: new Date(startedAt),
      maxTicks: 100,
      clock
    });
    const summary = replay.summary;
    if (summary.run.status !== "completed") {
      throw new Error(JSON.stringify({
        message: "Historical replay did not complete.",
        runStatus: summary.run.status,
        channelStates: summary.channels,
        itemStates: summary.items.map((item) => item.state),
        outbox: listProductionOutbox({ runId: started.run.id }).map((event) => ({
          eventKind: event.eventKind,
          status: event.status,
          attempts: event.attempts,
          lastError: event.lastError
        }))
      }));
    }
    const attempts = listAgentAttempts({ runId: started.run.id });
    const reasoningTokens = attempts.reduce(
      (total, attempt) => total + (attempt.reasoningOutputTokens ?? 0),
      0
    );
    const pollingTokens = attempts.reduce(
      (total, attempt) => total + (attempt.inputTokens ?? 0) + (attempt.outputTokens ?? 0) +
        (attempt.cachedInputTokens ?? 0) + (attempt.reasoningOutputTokens ?? 0),
      0
    );
    const operatorWindowMs =
      new Date(baseline.operatorIntensiveWindow.to).getTime() -
      new Date(baseline.operatorIntensiveWindow.from).getTime();
    // Random durable row IDs and millisecond creation boundaries may change
    // how many scheduler polling loops are needed while producing the exact
    // same outbox history. Evidence therefore uses one deterministic logical
    // tick per durable outbox attempt, not process-scheduler loop count.
    const logicalTicks = replay.delivered + replay.retried + replay.dead;
    const logicalDurationMs = logicalTicks * 1_000;
    const finishedAt = new Date(new Date(startedAt).getTime() + logicalDurationMs).toISOString();
    const assertions: ProjectKingsReplayAssertion[] = [];
    addAssertion(assertions, "baseline accepted output", baseline.acceptedOutput.publicVerifiedVideos, 2,
      baseline.acceptedOutput.publicVerifiedVideos === 2);
    addAssertion(assertions, "baseline target", baseline.acceptedOutput.targetVideos, 9,
      baseline.acceptedOutput.targetVideos === 9);
    addAssertion(assertions, "baseline operator-intensive duration", operatorWindowMs, 6 * 60 * 60_000,
      operatorWindowMs === 6 * 60 * 60_000);
    addAssertion(assertions, "replay created nine logical items", started.items.length, 9, started.items.length === 9);
    addAssertion(assertions, "shadow replay completed", summary.run.status, "completed", summary.run.status === "completed");
    addAssertion(assertions, "all nine reached final approval", summary.items.filter((item) => item.state === "final_approved").length,
      9, summary.items.every((item) => item.state === "final_approved"));
    addAssertion(assertions, "no publication identity", summary.items.filter((item) => item.publicationId).length,
      0, summary.items.every((item) => !item.publicationId && !item.youtubeVideoId));
    addAssertion(assertions, "zero replay model or polling tokens", pollingTokens, 0, pollingTokens === 0);
    addAssertion(assertions, "zero dead outbox records", replay.dead, 0, replay.dead === 0);

    return finalizeEvidence({
      schemaVersion: "project-kings-replay-evidence-v1",
      scenarioId: "historical-july-9",
      runId: replayAlias("historical-july-9", "2026-07-09"),
      runIdKind: "deterministic-business-alias",
      logicalDate: "2026-07-09",
      clock: { startedAt, finishedAt, logicalDurationMs, ticks: logicalTicks },
      sourceEvidence: {
        baselineFile: "docs/project-kings-production-pipeline-v1/evidence/baseline-2026-07-09.json",
        baselineFileSha256: hash(baselineRaw),
        sourceSessionId: baseline.sourceSession.sessionId,
        rootTranscriptSha256: baseline.sourceSession.rootTranscriptSha256,
        subagentTranscriptSetSha256: baseline.sourceSession.subagentTranscriptSetSha256,
        logicalClockBasis: "one_tick_per_durable_outbox_attempt"
      },
      injections: [
        {
          at: startedAt,
          kind: "historical-input-replay",
          detail: "July 9 evidence is replayed through a shadow 3x3 run; upload adapters are absent."
        }
      ],
      assertions,
      metrics: {
        historical: {
          operatorIntensiveWindowMs: operatorWindowMs,
          logicalTokenEvents: baseline.operatorIntensiveWindow.usage.logicalTokenEvents,
          acceptedPublicVideos: baseline.acceptedOutput.publicVerifiedVideos,
          targetVideos: baseline.acceptedOutput.targetVideos,
          logicalTokenEventsPerPublicVideo: baseline.acceptedOutput.logicalTokenEventsPerPublicVideo
        },
        replay: {
          targetItems: summary.counts.target,
          finalApprovedItems: summary.items.filter((item) => item.state === "final_approved").length,
          agentAttempts: attempts.length,
          reasoningTokens,
          pollingAndModelTokens: pollingTokens,
          deliveredOutboxEvents: replay.delivered,
          retriedOutboxEvents: replay.retried,
          deadOutboxEvents: replay.dead
        }
      },
      externalEffects: zeroExternalEffects(),
      outcome: "pass"
    });
  });
}

export async function runInfrastructureRecoveryReplay(): Promise<ProjectKingsReplayEvidence> {
  return withIsolatedReplayDb("infrastructure-recovery", async () => {
    const startedAt = "2026-07-11T11:00:00.000Z";
    const startedAtMs = new Date(startedAt).getTime();
    const clock: ReplayClock = { ms: startedAtMs };
    const started = await startReplayRun({
      scenarioId: "infrastructure-recovery",
      logicalDate: "2026-07-10",
      mode: "simulation",
      clock
    });
    const lostClaim = claimProductionOutbox({
      owner: "replay-lost-worker",
      leaseMs: 1_000,
      limit: 1,
      now: startedAt
    })[0];
    if (!lostClaim) throw new Error("Infrastructure replay could not claim a worker-loss event.");
    const stateBeforeRestart = getPortfolioProductionRun(started.run.id);
    closeReplayDb();
    const stateAfterRestart = getPortfolioProductionRun(started.run.id);

    let provider429Count = 0;
    let completion502Count = 0;
    const base = createPortfolioSimulationDispatcher({
      faults: { uploadOutcomeUnknownOnce: true },
      now: () => new Date(clock.ms)
    });
    const dispatcher: PortfolioOutboxDispatcher = async (event) => {
      if (event.eventKind === "source_fit.requested" && provider429Count === 0) {
        provider429Count += 1;
        throw new Error("provider_429: injected retryable rate limit");
      }
      if (event.eventKind === "final_render.requested" && completion502Count === 0) {
        completion502Count += 1;
        throw new Error("completion_502: injected retryable completion failure");
      }
      await base(event);
    };
    const settled = await dispatchUntilTerminal({
      runId: started.run.id,
      dispatcher,
      startedAtMs: startedAtMs + 1_001,
      clock,
      maxTicks: 100
    });
    const events = listProductionEvents({ runId: started.run.id });
    const outbox = listProductionOutbox({ runId: started.run.id });
    const recoveredLostEvent = outbox.find((event) => event.id === lostClaim.id);
    const publicationIds = settled.summary.items
      .map((item) => item.publicationId)
      .filter((value): value is string => Boolean(value));
    const videoIds = settled.summary.items
      .map((item) => item.youtubeVideoId)
      .filter((value): value is string => Boolean(value));
    const unknownCount = events.filter((event) => event.eventType === "simulation.upload_outcome_unknown").length;
    const reconciledCount = events.filter((event) => event.eventType === "simulation.upload_reconciled").length;
    const scheduledCount = events.filter((event) => event.eventType === "simulation.publication_scheduled").length;
    const logicalDurationMs = settled.logicalFinishedAtMs - startedAtMs;
    const assertions: ProjectKingsReplayAssertion[] = [];
    addAssertion(assertions, "durable run survived process restart", stateAfterRestart.counts.target,
      stateBeforeRestart.counts.target, stateAfterRestart.run.status === stateBeforeRestart.run.status &&
      stateAfterRestart.items.length === stateBeforeRestart.items.length);
    addAssertion(assertions, "expired worker lease was reclaimed", recoveredLostEvent?.attempts ?? null, 2,
      recoveredLostEvent?.status === "delivered" && recoveredLostEvent.attempts === 2);
    addAssertion(assertions, "429 injected exactly once", provider429Count, 1, provider429Count === 1);
    addAssertion(assertions, "502 injected exactly once", completion502Count, 1, completion502Count === 1);
    addAssertion(assertions, "retryable failures used durable outbox", settled.retried, 2, settled.retried === 2);
    addAssertion(assertions, "upload outcome became unknown once", unknownCount, 1, unknownCount === 1);
    addAssertion(assertions, "unknown upload reconciled once", reconciledCount, 1, reconciledCount === 1);
    addAssertion(assertions, "one publication intent per item", new Set(publicationIds).size, 9,
      publicationIds.length === 9 && new Set(publicationIds).size === 9);
    addAssertion(assertions, "one YouTube identity per item", new Set(videoIds).size, 9,
      videoIds.length === 9 && new Set(videoIds).size === 9);
    addAssertion(assertions, "no second publication schedule after upload uncertainty", scheduledCount, 9,
      scheduledCount === 9);
    addAssertion(assertions, "infrastructure replay completed 3x3", settled.summary.counts.publicVerified, 9,
      settled.summary.run.status === "completed" && settled.summary.counts.publicVerified === 9);
    addAssertion(assertions, "no dead outbox record", outbox.filter((event) => event.status === "dead").length,
      0, outbox.every((event) => event.status === "delivered"));

    return finalizeEvidence({
      schemaVersion: "project-kings-replay-evidence-v1",
      scenarioId: "infrastructure-recovery",
      runId: replayAlias("infrastructure-recovery", "2026-07-10"),
      runIdKind: "deterministic-business-alias",
      logicalDate: "2026-07-10",
      clock: {
        startedAt,
        finishedAt: new Date(settled.logicalFinishedAtMs).toISOString(),
        logicalDurationMs,
        ticks: settled.ticks
      },
      sourceEvidence: {
        durableStore: "production_runs + production_items + production_outbox",
        simulationAdapter: "createPortfolioSimulationDispatcher",
        externalNetworkEnabled: false
      },
      injections: [
        { at: startedAt, kind: "worker-lease-loss", eventKind: lostClaim.eventKind, leaseMs: 1_000 },
        { at: new Date(startedAtMs + 500).toISOString(), kind: "process-restart", persistedItems: stateBeforeRestart.items.length },
        { at: new Date(startedAtMs + 2_001).toISOString(), kind: "provider-429", attempts: 1 },
        { at: new Date(startedAtMs + 3_001).toISOString(), kind: "completion-502", attempts: 1 },
        { at: new Date(startedAtMs + 4_001).toISOString(), kind: "upload-outcome-unknown", attempts: 1 }
      ],
      assertions,
      metrics: {
        targetItems: settled.summary.counts.target,
        publicVerifiedItems: settled.summary.counts.publicVerified,
        deliveredOutboxEvents: settled.delivered,
        retryCalls: settled.retried,
        deadOutboxEvents: settled.dead,
        outboxRecordsWithMultipleClaims: outbox.filter((event) => event.attempts > 1).length,
        lostLeaseEventAttempts: recoveredLostEvent?.attempts ?? null,
        publicationIntentCount: publicationIds.length,
        uniquePublicationIntentCount: new Set(publicationIds).size,
        uniqueVideoIdentityCount: new Set(videoIds).size,
        uploadOutcomeUnknownCount: unknownCount,
        uploadReconcileCount: reconciledCount
      },
      externalEffects: zeroExternalEffects(),
      outcome: "pass"
    });
  });
}

function recordReplayAgent(input: {
  item: ProductionItemRecord;
  role: string;
  attemptNo: number;
  output: unknown;
  verdict: "pass" | "fail";
  startedAt: string;
  qualityBindingSha256: string;
}): AgentAttemptRecord {
  return recordAgentAttempt({
    workspaceId: input.item.workspaceId,
    runId: input.item.runId,
    productionItemId: input.item.id,
    role: input.role,
    attemptNo: input.attemptNo,
    model: "deterministic-replay",
    reasoningLevel: "none",
    promptHash: hash({ role: input.role, attemptNo: input.attemptNo, replay: "content-rework" }),
    qualityBindingSha256: input.qualityBindingSha256,
    outputHash: hash(input.output),
    artifactIds: [],
    status: "passed",
    outcome: "content-replay",
    verdict: input.verdict,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
    costMicros: 0,
    costUnit: "codex_credits",
    durationMs: 1,
    startedAt: input.startedAt,
    finishedAt: new Date(new Date(input.startedAt).getTime() + 1).toISOString()
  });
}

function recordReplayGate(input: {
  item: ProductionItemRecord;
  gateType: "source" | "preview" | "final";
  artifactSha256: string;
  attemptNo: number;
  deterministicVerdict: "pass" | "fail";
  visionVerdict: "pass" | "fail";
  agentAttempt: AgentAttemptRecord;
  defects: ProductionQualityDefect[];
}): void {
  const common = {
    workspaceId: input.item.workspaceId,
    runId: input.item.runId,
    productionItemId: input.item.id,
    gateType: input.gateType,
    attemptNo: input.attemptNo,
    artifactSha256: input.artifactSha256,
    sourceSha256: input.item.sourceSha256,
    previewSha256: input.item.previewSha256,
    templateSha256: input.item.templateSha256,
    settingsSha256: input.item.settingsSha256
  };
  recordQualityVerdict({
    ...common,
    judgeKind: "deterministic",
    verdict: input.deterministicVerdict,
    evidenceSha256: hash({ ...common, kind: "deterministic-replay-probe" }),
    evidenceArtifactPath: `/replay/${input.item.id}/${input.gateType}-deterministic-${input.attemptNo}.json`,
    defects: input.deterministicVerdict === "pass" ? [] : input.defects
  });
  recordQualityVerdict({
    ...common,
    judgeKind: input.gateType === "source" ? "semantic" : "vision",
    verdict: input.visionVerdict,
    agentAttemptId: input.agentAttempt.id,
    evidenceSha256: hash({ ...common, kind: "agent-replay-verdict" }),
    evidenceArtifactPath: `/replay/${input.item.id}/${input.gateType}-agent-${input.attemptNo}.json`,
    defects: input.visionVerdict === "pass" ? [] : input.defects
  });
}

function reserveReplacementSource(item: ProductionItemRecord, now?: string): ProductionItemRecord {
  const attemptedCandidateIds = new Set(
    listProductionRunChannelAttemptedCandidateIds(item.runChannelId)
  );
  const candidate = listChannelSourceCandidates({
    workspaceId: item.workspaceId,
    channelId: item.channelId,
    status: "available",
    limit: 100
  }).find((entry) =>
    entry.rightsStatus === "owner_approved_source_pool" &&
    !attemptedCandidateIds.has(entry.id)
  );
  if (!candidate) throw new Error("Content replay exhausted its frozen source buffer.");
  return reserveChannelSourceCandidate({
    candidateId: candidate.id,
    itemId: item.id,
    expectedItemVersion: item.version,
    now,
    outbox: {
      eventKind: "source_ingest.requested",
      payload: { candidateId: candidate.id, replay: "content-rework" },
      maxAttempts: 3
    }
  }).item;
}

export async function runContentReworkReplay(options: {
  onOutboxAudit?: (audit: ProjectKingsReplayOutboxAudit) => void;
} = {}): Promise<ProjectKingsReplayEvidence> {
  return withIsolatedReplayDb("content-rework", async () => {
    const startedAt = "2026-07-11T12:00:00.000Z";
    const startedAtMs = new Date(startedAt).getTime();
    const clock: ReplayClock = { ms: startedAtMs };
    const nowIso = () => new Date(clock.ms).toISOString();
    const started = await startReplayRun({
      scenarioId: "content-rework",
      logicalDate: "2026-07-10",
      mode: "shadow",
      clock
    });
    const initialTarget = [...started.items].sort(
      (left, right) => left.channelId.localeCompare(right.channelId) || left.itemSlot - right.itemSlot
    )[0];
    if (!initialTarget) throw new Error("Content replay has no target item.");
    const faultChannelId = initialTarget.channelId;
    const faultItemSlot = initialTarget.itemSlot;
    let firstGenerationId = initialTarget.id;
    let secondGenerationId: string | null = null;
    let thirdGenerationId: string | null = null;
    let sourceContractResult: ReturnType<typeof validateProductionAgentOutput<"source_fit">> | null = null;
    let staleApprovalErrorCode: string | null = null;
    const revisionActions: string[] = [];
    let unsafeCropDefectCodes: string[] = [];
    let replacementBudgetBeforeFinal: ReturnType<typeof decidePortfolioLiveRecoveryBudget> | null = null;
    let replacementBudgetAtGenerationThree: ReturnType<typeof decidePortfolioLiveRecoveryBudget> | null = null;
    const base = createPortfolioSimulationDispatcher({ now: () => new Date(clock.ms) });

    const handleSourceContentFault = async (item: ProductionItemRecord): Promise<void> => {
      sourceContractResult = validateProductionAgentOutput("source_fit", {
        decision: "FAIL",
        candidateId: item.sourceCandidateId!,
        storyEventId: "known-duplicate-event",
        conceptMatch: false,
        factualFit: false,
        duplicateVideo: true,
        duplicateEvent: true,
        sourceUsable: false,
        reason: "The same video and event were already used, and the event is outside the channel concept.",
        factualClaims: []
      });
      const defects: ProductionQualityDefect[] = [
        { code: "duplicate_video", severity: "major", message: "Duplicate source video." },
        { code: "duplicate_event", severity: "major", message: "Duplicate story event." },
        { code: "concept_mismatch", severity: "critical", message: "Wrong channel concept." }
      ];
      const sourceBindingSha256 = calculateQualityVerdictBindingSha256({
        gateType: "source",
        artifactSha256: item.sourceSha256!,
        sourceSha256: item.sourceSha256
      });
      const sourceAttempt = recordReplayAgent({
        item,
        role: "source_fit",
        attemptNo: 1,
        output: sourceContractResult,
        verdict: "fail",
        startedAt: "2026-07-11T12:00:01.000Z",
        qualityBindingSha256: sourceBindingSha256
      });
      recordReplayGate({
        item,
        gateType: "source",
        artifactSha256: item.sourceSha256!,
        attemptNo: 1,
        deterministicVerdict: "fail",
        visionVerdict: "fail",
        agentAttempt: sourceAttempt,
        defects
      });
      const quarantinedItem = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "quarantined",
        eventType: "replay.source.quarantined",
        eventPayload: { defectCodes: defects.map((defect) => defect.code) },
        patch: { lastError: "duplicate_video+duplicate_event+concept_mismatch" },
        now: nowIso()
      });
      quarantineChannelSourceCandidate({
        candidateId: item.sourceCandidateId!,
        reason: "Replay source failed duplicate and concept gates."
      });
      const replacement = createReplacementProductionItem({
        replacedItemId: quarantinedItem.id,
        expectedVersion: quarantinedItem.version,
        attemptBudget: 3
      });
      secondGenerationId = replacement.id;
      reserveReplacementSource(replacement, nowIso());
    };

    const handlePreviewContentFaults = async (initialItem: ProductionItemRecord): Promise<void> => {
      let item = transitionProductionItem({
        itemId: initialItem.id,
        expectedVersion: initialItem.version,
        toState: "preview_ready",
        eventType: "replay.preview.ready",
        patch: {
          previewSha256: hash("content-approved-preview-v1"),
          templateSha256: hash("content-template-v1"),
          settingsSha256: hash("content-settings-v1")
        },
        now: nowIso()
      });
      const approvedBindingSha256 = calculateQualityVerdictBindingSha256({
        gateType: "preview",
        artifactSha256: item.previewSha256!,
        sourceSha256: item.sourceSha256,
        previewSha256: item.previewSha256,
        templateSha256: item.templateSha256,
        settingsSha256: item.settingsSha256
      });
      const approvedAttempt = recordReplayAgent({
        item,
        role: "vision_qa",
        attemptNo: 1,
        output: { decision: "PASS", artifactSha256: item.previewSha256 },
        verdict: "pass",
        startedAt: "2026-07-11T12:00:02.000Z",
        qualityBindingSha256: approvedBindingSha256
      });
      recordReplayGate({
        item,
        gateType: "preview",
        artifactSha256: item.previewSha256!,
        attemptNo: 1,
        deterministicVerdict: "pass",
        visionVerdict: "pass",
        agentAttempt: approvedAttempt,
        defects: []
      });
      item = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "preview_approved",
        eventType: "replay.preview.approved",
        now: nowIso()
      });
      item = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "rework",
        resumeState: "preview_ready",
        eventType: "replay.preview.binding_changed",
        now: nowIso()
      });
      item = transitionProductionItem({
        itemId: item.id,
        expectedVersion: item.version,
        toState: "preview_ready",
        eventType: "replay.preview.rebuilt",
        patch: {
          previewSha256: hash("content-stale-preview-v2"),
          settingsSha256: hash("content-settings-v2")
        },
        now: nowIso()
      });
      const staleVerdict = getLatestQualityVerdictForArtifact({
        productionItemId: item.id,
        gateType: "preview",
        judgeKind: "combined",
        artifactSha256: item.previewSha256!,
        sourceSha256: item.sourceSha256,
        previewSha256: item.previewSha256,
        templateSha256: item.templateSha256,
        settingsSha256: item.settingsSha256
      });
      if (staleVerdict !== null) throw new Error("Stale approval unexpectedly matched changed hashes.");
      try {
        transitionProductionItem({
          itemId: item.id,
          expectedVersion: item.version,
          toState: "preview_approved",
          eventType: "replay.preview.unsafe_approval"
        });
      } catch (error) {
        staleApprovalErrorCode = error instanceof ProductionStoreError ? error.code : "unexpected_error";
      }
      if (staleApprovalErrorCode !== "quality_gate_missing") {
        throw new Error(`Expected stale approval rejection, got ${staleApprovalErrorCode ?? "no error"}.`);
      }

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        item = getProductionItem(item.id)!;
        const binding: ProductionArtifactBinding = {
          channelId: item.channelId,
          sourceSha256: item.sourceSha256!,
          previewSha256: item.previewSha256!,
          templateSha256: item.templateSha256!,
          settingsSha256: item.settingsSha256!
        };
        const finalProbe: FinalMp4Probe = {
          artifactSha256: hash({ finalProbe: attempt }),
          fullyDecodable: true,
          decodeError: null,
          container: "mov,mp4,m4a,3gp,3g2,mj2",
          videoCodec: "h264",
          width: 1080,
          height: 1920,
          durationSec: 30,
          audioStreamCount: 1,
          flashFrameIndexes: []
        };
        const vision: ProductionVisionVerdict = {
          decision: "FAIL",
          channelId: item.channelId,
          templateSha256: item.templateSha256!,
          conceptMatch: true,
          duplicateVideo: false,
          duplicateEvent: false,
          hookPresent: true,
          actionPresent: true,
          payoffPresent: true,
          donorUiVisible: false,
          ctaVisible: false,
          handleVisible: false,
          watermarkVisible: false,
          foreignCaptionsVisible: false,
          mainEventPreserved: true,
          cropSafe: false,
          factualClaimsVerified: true,
          bannedWordsPresent: false,
          defects: []
        };
        const verdict = evaluateProductionQualityGate({
          binding,
          recordedApprovalBindingSha256: buildProductionArtifactBindingSha256(binding),
          finalProbe,
          finalExpectations: {
            artifactSha256: finalProbe.artifactSha256,
            width: 1080,
            height: 1920,
            durationSec: 30
          },
          vision
        });
        unsafeCropDefectCodes = verdict.defects.map((defect) => defect.code).sort();
        const failedBindingSha256 = calculateQualityVerdictBindingSha256({
          gateType: "preview",
          artifactSha256: item.previewSha256!,
          sourceSha256: item.sourceSha256,
          previewSha256: item.previewSha256,
          templateSha256: item.templateSha256,
          settingsSha256: item.settingsSha256
        });
        const failedAttempt = recordReplayAgent({
          item,
          role: "vision_qa",
          attemptNo: attempt + 1,
          output: verdict,
          verdict: "fail",
          startedAt: new Date(startedAtMs + 2_000 + attempt * 1_000).toISOString(),
          qualityBindingSha256: failedBindingSha256
        });
        recordReplayGate({
          item,
          gateType: "preview",
          artifactSha256: item.previewSha256!,
          attemptNo: attempt + 1,
          deterministicVerdict: "pass",
          visionVerdict: "fail",
          agentAttempt: failedAttempt,
          defects: verdict.defects
        });
        const decision = decideProductionRevision({
          defects: verdict.defects,
          totalAttempts: attempt,
          textAttempts: 0,
          visualAttempts: attempt
        });
        revisionActions.push(decision.action);
        if (attempt < 3) {
          if (decision.action !== "targeted_visual_revision") {
            throw new Error(`Unexpected visual revision decision: ${decision.action}`);
          }
          item = transitionProductionItem({
            itemId: item.id,
            expectedVersion: item.version,
            toState: "rework",
            resumeState: "preview_ready",
            eventType: "replay.preview.targeted_revision",
            eventPayload: { attempt },
            patch: { incrementAttempts: true },
            now: nowIso()
          });
          item = transitionProductionItem({
            itemId: item.id,
            expectedVersion: item.version,
            toState: "preview_ready",
            eventType: "replay.preview.revision_ready",
            eventPayload: { attempt },
            patch: {
              previewSha256: hash({ contentPreviewRevision: attempt + 2 }),
              settingsSha256: hash({ contentSettingsRevision: attempt + 2 })
            },
            now: nowIso()
          });
        } else {
          if (decision.action !== "replace_source") {
            throw new Error(`Expected replace_source after three revisions, got ${decision.action}.`);
          }
          replacementBudgetBeforeFinal = decidePortfolioLiveRecoveryBudget({
            attempts: attempt,
            attemptBudget: item.attemptBudget,
            generation: item.generation
          });
          item = transitionProductionItem({
            itemId: item.id,
            expectedVersion: item.version,
            toState: "replaced",
            eventType: "replay.preview.replacement_budget_exhausted",
            eventPayload: { attempt, decision: decision.action },
            patch: { incrementAttempts: true, lastError: "unsafe_crop_after_three_revisions" },
            now: nowIso()
          });
        }
      }
      const released = releaseChannelSourceCandidate({
        candidateId: item.sourceCandidateId!,
        itemId: item.id,
        expectedItemVersion: item.version,
        reason: "Visual revision budget exhausted; source returned after non-source crop failure."
      });
      const replacement = createReplacementProductionItem({
        replacedItemId: released.item.id,
        expectedVersion: released.item.version,
        attemptBudget: 3
      });
      thirdGenerationId = replacement.id;
      replacementBudgetAtGenerationThree = decidePortfolioLiveRecoveryBudget({
        attempts: replacement.attempts,
        attemptBudget: replacement.attemptBudget,
        generation: replacement.generation
      });
      reserveReplacementSource(replacement, nowIso());
    };

    const dispatcher: PortfolioOutboxDispatcher = async (event) => {
      const item = getProductionItem(event.productionItemId);
      if (!item) throw new Error("Content replay outbox item disappeared.");
      if (event.eventKind === "source_fit.requested" && item.id === firstGenerationId) {
        await handleSourceContentFault(item);
        return;
      }
      if (event.eventKind === "preview.requested" && item.id === secondGenerationId) {
        await handlePreviewContentFaults(item);
        return;
      }
      await base(event);
    };
    const settled = await dispatchUntilTerminal({
      runId: started.run.id,
      dispatcher,
      startedAtMs,
      clock,
      maxTicks: 150
    });
    if (!secondGenerationId || !thirdGenerationId || !sourceContractResult) {
      throw new Error("Content replay did not exercise every required generation.");
    }
    const history = listProductionItems({
      runId: started.run.id,
      channelId: faultChannelId,
      includeHistorical: true
    }).filter((item) => item.itemSlot === faultItemSlot);
    const generationStates = history
      .sort((left, right) => left.generation - right.generation)
      .map((item) => ({ generation: item.generation, state: item.state }));
    const sourceOutput = sourceContractResult as ReturnType<typeof validateProductionAgentOutput<"source_fit">>;
    const quarantinedSources = listChannelSourceCandidates({
      workspaceId: started.run.workspaceId,
      channelId: faultChannelId,
      status: "quarantined",
      limit: 100
    });
    const logicalDurationMs = settled.logicalFinishedAtMs - startedAtMs;
    const assertions: ProjectKingsReplayAssertion[] = [];
    addAssertion(assertions, "duplicate video rejected", sourceOutput.duplicateVideo, true, sourceOutput.duplicateVideo === true);
    addAssertion(assertions, "duplicate event rejected", sourceOutput.duplicateEvent, true, sourceOutput.duplicateEvent === true);
    addAssertion(assertions, "wrong concept rejected", sourceOutput.conceptMatch, false, sourceOutput.conceptMatch === false);
    addAssertion(assertions, "unsafe crop detected", unsafeCropDefectCodes.includes("unsafe_crop"), true,
      unsafeCropDefectCodes.includes("unsafe_crop"));
    addAssertion(assertions, "stale approval rejected by exact hash binding", staleApprovalErrorCode,
      "quality_gate_missing", staleApprovalErrorCode === "quality_gate_missing");
    addAssertion(assertions, "visual revision budget is bounded", revisionActions,
      ["targeted_visual_revision", "targeted_visual_revision", "replace_source"],
      JSON.stringify(revisionActions) === JSON.stringify(["targeted_visual_revision", "targeted_visual_revision", "replace_source"]));
    addAssertion(assertions, "two bounded replacements preserve slot history", generationStates,
      [
        { generation: 1, state: "quarantined" },
        { generation: 2, state: "replaced" },
        { generation: 3, state: "final_approved" }
      ], JSON.stringify(generationStates) === JSON.stringify([
        { generation: 1, state: "quarantined" },
        { generation: 2, state: "replaced" },
        { generation: 3, state: "final_approved" }
      ]));
    addAssertion(assertions, "generation two still allowed one replacement",
      canReplaceFromBudget(replacementBudgetBeforeFinal), true,
      canReplaceFromBudget(replacementBudgetBeforeFinal) === true);
    addAssertion(assertions, "generation three cannot be replaced again",
      canReplaceFromBudget(replacementBudgetAtGenerationThree), false,
      canReplaceFromBudget(replacementBudgetAtGenerationThree) === false);
    addAssertion(assertions, "bad source was quarantined", quarantinedSources.length, 1, quarantinedSources.length === 1);
    addAssertion(assertions, "content replay completed all current items", settled.summary.items.filter((item) => item.state === "final_approved").length,
      9, settled.summary.run.status === "completed" && settled.summary.items.every((item) => item.state === "final_approved"));
    addAssertion(assertions, "content replay created no publication", settled.summary.items.filter((item) => item.publicationId).length,
      0, settled.summary.items.every((item) => !item.publicationId && !item.youtubeVideoId));
    addAssertion(assertions, "no dead outbox record", settled.dead, 0, settled.dead === 0);

    const evidence = finalizeEvidence({
      schemaVersion: "project-kings-replay-evidence-v1",
      scenarioId: "content-rework",
      runId: replayAlias("content-rework", "2026-07-10"),
      runIdKind: "deterministic-business-alias",
      logicalDate: "2026-07-10",
      clock: {
        startedAt,
        finishedAt: new Date(settled.logicalFinishedAtMs).toISOString(),
        logicalDurationMs,
        ticks: settled.ticks
      },
      sourceEvidence: {
        channelProfiles: "PROJECT_KINGS_PILOT_PROFILES",
        sourceFitSchema: "production-agent-packet-v1/source_fit",
        qualityGate: "evaluateProductionQualityGate",
        externalNetworkEnabled: false
      },
      injections: [
        {
          at: "2026-07-11T12:00:01.000Z",
          kind: "source-fit-failure",
          defects: ["duplicate_video", "duplicate_event", "concept_mismatch"]
        },
        {
          at: "2026-07-11T12:00:02.000Z",
          kind: "approval-binding-change",
          expectedError: "quality_gate_missing"
        },
        {
          at: "2026-07-11T12:00:03.000Z",
          kind: "unsafe-crop",
          revisionBudget: 3
        }
      ],
      assertions,
      metrics: {
        targetItems: settled.summary.counts.target,
        finalApprovedItems: settled.summary.items.filter((item) => item.state === "final_approved").length,
        historicalGenerationsForFaultedSlot: generationStates,
        revisionActions,
        unsafeCropDefectCodes,
        quarantinedSourceCount: quarantinedSources.length,
        agentAttempts: listAgentAttempts({ runId: started.run.id }).length,
        deliveredOutboxEvents: settled.delivered,
        retriedOutboxEvents: settled.retried,
        deadOutboxEvents: settled.dead
      },
      externalEffects: zeroExternalEffects(),
      outcome: "pass"
    });
    // Capture the isolated-DB outbox before withIsolatedReplayDb tears it down,
    // so a regression test can prove every availableAt was stamped on the
    // virtual clock and never leaked past the virtual finishedAt.
    options.onOutboxAudit?.({
      scenarioId: "content-rework",
      finishedAt: evidence.clock.finishedAt,
      outbox: listProductionOutbox({ runId: started.run.id }).map((event) => ({
        id: event.id,
        eventKind: event.eventKind,
        status: event.status,
        availableAt: event.availableAt
      }))
    });
    return evidence;
  });
}

export async function runProjectKingsReplaySuite(options: {
  repoRoot?: string;
} = {}): Promise<ProjectKingsReplaySuite> {
  const historical = await runHistoricalJuly9Replay({ repoRoot: options.repoRoot });
  const infrastructure = await runInfrastructureRecoveryReplay();
  const content = await runContentReworkReplay();
  return { historical, infrastructure, content };
}
