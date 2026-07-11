import { createHash } from "node:crypto";
import {
  appendProductionOutbox,
  ackProductionOutboxAsSupersededGeneration,
  buildProductionOutboxDedupeKey,
  claimProductionOutbox,
  claimProductionRunLease,
  createOrGetProductionRun,
  findProductionRunByIdempotencyKey,
  createProductionItem,
  getProductionItem,
  getProductionProfile,
  getProductionRun,
  isProductionProfileExplicitlyApproved,
  isChannelSourceCandidateQualified,
  listChannelSourceCandidates,
  listProductionItems,
  listProductionRunChannelAttemptedCandidateIds,
  listProductionRunChannels,
  releaseShadowSourceCandidateReservation,
  releaseProductionRunLease,
  reserveChannelSourceCandidate,
  reserveChannelSourceCandidatesAtomically,
  retryProductionOutbox,
  ackProductionOutbox,
  transitionProductionRun,
  transitionProductionRunChannel,
  ProductionStoreError,
  type ProductionItemRecord,
  type ProductionOutboxRecord,
  type ProductionProfileRecord,
  type ProductionRunMode,
  type ProductionRunRecord
} from "./portfolio-production-store";
import { validateChannelProductionProfile } from "./project-kings/channel-production-profile";
import { getActiveProjectKingsSourcePolicyApproval } from "./project-kings/source-policy-approval-store";
import { PROJECT_KINGS_PRODUCTION_QUALITY_POLICY } from "./project-kings/production-quality-policy";

export const PROJECT_KINGS_PUBLISH_POLICY_ID = "project-kings-daily-3x3-v1";
export const PORTFOLIO_PIPELINE_FEATURE_FLAG = "portfolio_pipeline_v1";
export const PORTFOLIO_PIPELINE_POST_CANARY_FEATURE_FLAG = "portfolio_pipeline_post_canary";

export type ProductionCanaryPolicy = "first_item_per_channel_public_verified" | "none";

export type ProductionPreflightCheck = {
  code: string;
  pass: boolean;
  blocking: boolean;
  expected?: unknown;
  actual?: unknown;
  detail: string;
};

export type ProductionProfilePreflight = {
  profileId: string;
  valid: boolean;
  profileHash: string;
  liveFactsHash: string;
  checks: ProductionPreflightCheck[];
  blockers: string[];
};

export type PortfolioRunSummary = {
  run: ProductionRunRecord;
  channels: Array<{
    id: string;
    channelId: string;
    status: string;
    target: number;
    publicVerified: number;
    nextSlotAt: string | null;
    blocker: string | null;
    stateCounts: Record<string, number>;
  }>;
  items: ProductionItemRecord[];
  counts: {
    target: number;
    publicVerified: number;
    terminal: number;
  };
  blockers: string[];
  youtubeVideoIds: string[];
  canaryPolicy: ProductionCanaryPolicy;
  canaryItemId: string | null;
  canaryItemIds: string[];
};

export type PortfolioOrchestratorDependencies = {
  validateLiveProfile: (
    profile: ProductionProfileRecord
  ) => Promise<{
    liveFactsHash: string;
    checks: ProductionPreflightCheck[];
  }>;
  featureFlagEnabled?: (flag: string) => boolean;
  now?: () => Date;
};

export type StartPortfolioRunInput = {
  workspaceId: string;
  profileIds: string[];
  logicalDate: string;
  mode: ProductionRunMode;
  targetPerChannel: number;
  publishPolicyId: string;
  canaryPolicy?: ProductionCanaryPolicy | null;
  idempotencyKey?: string | null;
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
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstItemIdsByChannel(items: readonly ProductionItemRecord[]): string[] {
  const firstByChannel = new Map<string, string>();
  for (const item of [...items].sort(
    (left, right) =>
      left.channelId.localeCompare(right.channelId) ||
      left.itemSlot - right.itemSlot ||
      left.generation - right.generation
  )) {
    if (!firstByChannel.has(item.channelId)) firstByChannel.set(item.channelId, item.id);
  }
  return [...firstByChannel.values()];
}

function requireProfile(profileId: string, workspaceId: string): ProductionProfileRecord {
  const profile = getProductionProfile(profileId);
  if (!profile || profile.workspaceId !== workspaceId) {
    throw new Error(`Production profile not found in this workspace: ${profileId}`);
  }
  return profile;
}

function assertStartInput(input: StartPortfolioRunInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.logicalDate)) {
    throw new Error("logicalDate must use YYYY-MM-DD.");
  }
  if (!Number.isInteger(input.targetPerChannel) || input.targetPerChannel < 1 || input.targetPerChannel > 3) {
    throw new Error("targetPerChannel must be an integer between 1 and 3.");
  }
  if (input.publishPolicyId !== PROJECT_KINGS_PUBLISH_POLICY_ID) {
    throw new Error(`Unsupported publish policy: ${input.publishPolicyId}`);
  }
  if (input.profileIds.length !== 3 || new Set(input.profileIds).size !== 3) {
    throw new Error("Project Kings portfolio run requires exactly three unique profiles.");
  }
  if (input.canaryPolicy && input.canaryPolicy !== "first_item_per_channel_public_verified" && input.canaryPolicy !== "none") {
    throw new Error(`Unsupported canary policy: ${String(input.canaryPolicy)}`);
  }
}

function resolveStartCanaryPolicy(
  input: StartPortfolioRunInput,
  dependencies: PortfolioOrchestratorDependencies
): ProductionCanaryPolicy {
  if (input.mode !== "live") {
    if (input.canaryPolicy && input.canaryPolicy !== "none") {
      throw new Error(`${input.mode} runs always require canaryPolicy=none.`);
    }
    return "none";
  }
  const policy = input.canaryPolicy ?? "first_item_per_channel_public_verified";
  if (
    policy === "none" &&
    !(dependencies.featureFlagEnabled?.(PORTFOLIO_PIPELINE_POST_CANARY_FEATURE_FLAG) ?? false)
  ) {
    throw new Error(
      "Live canaryPolicy=none requires PORTFOLIO_PIPELINE_POST_CANARY_ENABLED=1."
    );
  }
  return policy;
}

export function resolveRunCanaryPolicy(run: ProductionRunRecord): ProductionCanaryPolicy {
  const stored = run.manifest.canaryPolicy;
  if (stored === "none") return "none";
  if (
    stored === "first_item_per_channel_public_verified" ||
    stored === "first_item_public_verified" ||
    stored === "first-item-must-public-verify"
  ) {
    return "first_item_per_channel_public_verified";
  }
  return run.mode === "live" ? "first_item_per_channel_public_verified" : "none";
}

export async function validatePortfolioProductionProfile(
  profile: ProductionProfileRecord,
  dependencies: PortfolioOrchestratorDependencies
): Promise<ProductionProfilePreflight> {
  const checks: ProductionPreflightCheck[] = [];
  const configIssues = validateChannelProductionProfile(profile.config);
  checks.push({
    code: "profile_contract",
    pass: configIssues.length === 0,
    blocking: true,
    expected: "valid ChannelProductionProfile v1",
    actual: configIssues,
    detail: configIssues.length ? configIssues.map((issue) => `${issue.path}: ${issue.code}`).join("; ") : "Profile contract is valid."
  });
  checks.push({
    code: "profile_status",
    pass: profile.status === "active" || profile.status === "shadow",
    blocking: true,
    expected: "shadow|active",
    actual: profile.status,
    detail: `Stored profile status is ${profile.status}.`
  });
  const approvalScope = profile.status === "active" ? "live" : "shadow";
  checks.push({
    code: "profile_explicit_approval",
    pass: isProductionProfileExplicitlyApproved(profile, approvalScope),
    blocking: true,
    expected: `${approvalScope} approval bound to this profile id/version/hash`,
    actual: {
      status: profile.status,
      approvalScope: profile.approvalScope,
      approvalBindingSha256: profile.approvalBindingSha256
    },
    detail: isProductionProfileExplicitlyApproved(profile, approvalScope)
      ? `Profile has a valid explicit ${approvalScope} approval binding.`
      : "Profile has no valid explicit owner approval binding for its current status."
  });
  const available = listChannelSourceCandidates({
    workspaceId: profile.workspaceId,
    channelId: profile.channelId,
    status: "available",
    qualificationStatus: "qualified",
    limit: profile.readyBufferCap
  });
  const approved = available.filter(
    (candidate) =>
      candidate.rightsStatus === "owner_approved_source_pool" &&
      isChannelSourceCandidateQualified(candidate)
  );
  checks.push({
    code: "source_buffer",
    pass: approved.length >= profile.readyBufferMin,
    blocking: true,
    expected: profile.readyBufferMin,
    actual: approved.length,
    detail: `${approved.length} owner-approved, hash-bound qualified source candidates are ready.`
  });
  let liveFactsHash = hash({ unavailable: true, profileId: profile.id });
  try {
    const live = await dependencies.validateLiveProfile(profile);
    liveFactsHash = live.liveFactsHash;
    checks.push(...live.checks);
  } catch (error) {
    checks.push({
      code: "live_preflight",
      pass: false,
      blocking: true,
      detail: asErrorMessage(error)
    });
  }
  const blockers = checks
    .filter((check) => check.blocking && !check.pass)
    .map((check) => `${check.code}: ${check.detail}`);
  return {
    profileId: profile.id,
    valid: blockers.length === 0,
    profileHash: profile.profileHash,
    liveFactsHash,
    checks,
    blockers
  };
}

function buildSummary(runId: string): PortfolioRunSummary {
  const run = getProductionRun(runId);
  if (!run) throw new Error(`Production run not found: ${runId}`);
  const runChannels = listProductionRunChannels(run.id);
  const items = listProductionItems({ runId: run.id });
  const channels = runChannels.map((channel) => {
    const channelItems = items.filter((item) => item.channelId === channel.channelId);
    const stateCounts: Record<string, number> = {};
    for (const item of channelItems) stateCounts[item.state] = (stateCounts[item.state] ?? 0) + 1;
    return {
      id: channel.id,
      channelId: channel.channelId,
      status: channel.status,
      target: channel.targetCount,
      publicVerified: channel.publicVerifiedCount,
      nextSlotAt: channel.nextSlotAt,
      blocker: channel.blockerMessage,
      stateCounts
    };
  });
  const terminalStates = new Set([
    "public_verified",
    "replaced",
    "quarantined",
    "policy_blocked",
    "canceled",
    "failed"
  ]);
  const sortedItems = [...items].sort(
    (left, right) =>
      left.channelId.localeCompare(right.channelId) ||
      left.itemSlot - right.itemSlot ||
      left.generation - right.generation
  );
  const canaryPolicy = resolveRunCanaryPolicy(run);
  const canaryItemIds = canaryPolicy === "first_item_per_channel_public_verified"
    ? firstItemIdsByChannel(sortedItems)
    : [];
  return {
    run,
    channels,
    items: sortedItems,
    counts: {
      target: runChannels.reduce((total, channel) => total + channel.targetCount, 0),
      publicVerified: items.filter((item) => item.state === "public_verified").length,
      terminal: items.filter((item) => terminalStates.has(item.state)).length
    },
    blockers: runChannels
      .filter((channel) => channel.blockerMessage)
      .map((channel) => `${channel.channelId}: ${channel.blockerMessage}`),
    youtubeVideoIds: items
      .map((item) => item.youtubeVideoId)
      .filter((videoId): videoId is string => Boolean(videoId)),
    canaryPolicy,
    // Compatibility field for older owner clients. The policy now means one
    // canary per channel; new clients must use canaryItemIds.
    canaryItemId: canaryItemIds[0] ?? null,
    canaryItemIds
  };
}

export function getPortfolioProductionRun(runId: string): PortfolioRunSummary {
  return buildSummary(runId);
}

function findOrCreateItems(run: ProductionRunRecord): ProductionItemRecord[] {
  const channels = listProductionRunChannels(run.id);
  for (const channel of channels) {
    if (channel.status === "blocked") continue;
    for (let itemSlot = 1; itemSlot <= channel.targetCount; itemSlot += 1) {
      const existing = listProductionItems({
        runId: run.id,
        channelId: channel.channelId,
        includeHistorical: true
      }).filter((item) => item.itemSlot === itemSlot);
      if (!existing.length) {
        createProductionItem({
          runId: run.id,
          runChannelId: channel.id,
          itemSlot,
          // Candidate supply is bounded at nine distinct sources per channel.
          // Rework/replacement uses the separate quality-policy ceiling.
          attemptBudget:
            PROJECT_KINGS_PRODUCTION_QUALITY_POLICY.revisions.maximumTotalAttempts
        });
      }
    }
  }
  return listProductionItems({ runId: run.id });
}

function orderSourceCandidatesForRun(
  run: ProductionRunRecord,
  candidates: ReturnType<typeof listChannelSourceCandidates>
): ReturnType<typeof listChannelSourceCandidates> {
  if (run.mode !== "shadow") return candidates;
  return [...candidates].sort(
    (left, right) =>
      left.updatedAt.localeCompare(right.updatedAt) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
  );
}

function reserveInitialSources(input: {
  run: ProductionRunRecord;
  canaryPolicy: ProductionCanaryPolicy;
  canaryItemIds: readonly string[];
  // Optional caller clock (ISO). Deterministic replay/simulation contours run
  // on a virtual clock; the store must stamp outbox availableAt with it, or the
  // reservation events land in the virtual future and never become claimable.
  now?: string;
}): void {
  const items = listProductionItems({ runId: input.run.id }).sort(
    (left, right) => left.channelId.localeCompare(right.channelId) || left.itemSlot - right.itemSlot
  );
  const attemptedByRunChannel = new Map<string, Set<string>>();
  const attemptedCandidateIds = (item: ProductionItemRecord): Set<string> => {
    let attempted = attemptedByRunChannel.get(item.runChannelId);
    if (!attempted) {
      attempted = new Set(listProductionRunChannelAttemptedCandidateIds(item.runChannelId));
      attemptedByRunChannel.set(item.runChannelId, attempted);
    }
    return attempted;
  };
  if (input.run.mode === "live" && input.canaryPolicy === "none") {
    const expectedCount = listProductionRunChannels(input.run.id)
      .reduce((sum, channel) => sum + channel.targetCount, 0);
    if (items.length !== expectedCount || expectedCount !== 9) {
      throw new Error(
        `Live canaryPolicy=none requires all nine production items before atomic source release; found ${items.length}.`
      );
    }
    const availableByChannel = new Map<string, ReturnType<typeof listChannelSourceCandidates>>();
    const claimed = new Set<string>();
    const reservations = items.flatMap((initialItem) => {
      const item = getProductionItem(initialItem.id);
      if (!item || item.state !== "reserved") return [];
      let candidateId = item.sourceCandidateId;
      if (!candidateId) {
        let available = availableByChannel.get(item.channelId);
        if (!available) {
          available = orderSourceCandidatesForRun(input.run, listChannelSourceCandidates({
            workspaceId: item.workspaceId,
            channelId: item.channelId,
            status: "available",
            qualificationStatus: "qualified",
            limit: 100
          }).filter(
            (entry) =>
              entry.rightsStatus === "owner_approved_source_pool" &&
              isChannelSourceCandidateQualified(entry) &&
              !attemptedCandidateIds(item).has(entry.id)
          ));
          availableByChannel.set(item.channelId, available);
        }
        candidateId = available.find((entry) => !claimed.has(entry.id))?.id ?? null;
      }
      if (!candidateId) {
        throw new Error(`Atomic post-canary release has no qualified source for item ${item.id}.`);
      }
      claimed.add(candidateId);
      return [{
        candidateId,
        itemId: item.id,
        expectedItemVersion: item.version,
        outbox: {
          eventKind: "source_ingest.requested",
          dedupeKey: buildProductionOutboxDedupeKey("source_ingest.requested", {
            gate: "source_ingest",
            candidateId
          }),
          payload: { candidateId },
          maxAttempts: 3
        }
      }];
    });
    if (reservations.length > 0) {
      reserveChannelSourceCandidatesAtomically(reservations, { now: input.now });
    }
    return;
  }
  const claimed = new Set<string>();
  const canaryItemIds = new Set(input.canaryItemIds);
  for (const initialItem of items) {
    const item = getProductionItem(initialItem.id);
    if (!item || item.sourceCandidateId || item.state !== "reserved") continue;
    const candidate = orderSourceCandidatesForRun(input.run, listChannelSourceCandidates({
      workspaceId: item.workspaceId,
      channelId: item.channelId,
      status: "available",
      qualificationStatus: "qualified",
      limit: 100
    }).filter(
      (entry) =>
        entry.rightsStatus === "owner_approved_source_pool" &&
        isChannelSourceCandidateQualified(entry) &&
        !attemptedCandidateIds(item).has(entry.id)
    )).find(
      (entry) =>
        !claimed.has(entry.id)
    );
    if (!candidate) continue;
    claimed.add(candidate.id);
    const releaseNow = input.run.mode !== "live" || canaryItemIds.has(item.id);
    reserveChannelSourceCandidate({
      candidateId: candidate.id,
      itemId: item.id,
      expectedItemVersion: item.version,
      now: input.now,
      ...(releaseNow
        ? {
            outbox: {
              eventKind: "source_ingest.requested",
              dedupeKey: buildProductionOutboxDedupeKey("source_ingest.requested", {
                gate: "source_ingest",
                candidateId: candidate.id
              }),
              payload: {
                candidateId: candidate.id,
                sourceUrl: candidate.sourceUrl,
                canonicalUrl: candidate.canonicalUrl
              },
              maxAttempts: 3
            }
          }
        : {})
    });
  }
}

export async function startPortfolioProductionRun(
  input: StartPortfolioRunInput,
  dependencies: PortfolioOrchestratorDependencies
): Promise<PortfolioRunSummary & { existing: boolean; preflight: ProductionProfilePreflight[] }> {
  assertStartInput(input);
  // Caller-provided virtual clock (deterministic replay/simulation). Undefined
  // in production, so the store falls back to the real wall clock.
  const startNow = dependencies.now?.().toISOString();
  if (
    input.mode === "live" &&
    !(dependencies.featureFlagEnabled?.(PORTFOLIO_PIPELINE_FEATURE_FLAG) ?? false)
  ) {
    throw new Error(`Feature flag ${PORTFOLIO_PIPELINE_FEATURE_FLAG} is disabled.`);
  }
  const canaryPolicy = resolveStartCanaryPolicy(input, dependencies);
  const sourcePolicyApproval = input.mode === "simulation"
    ? null
    : getActiveProjectKingsSourcePolicyApproval(input.workspaceId);
  if (input.mode !== "simulation" && !sourcePolicyApproval) {
    throw new ProductionStoreError(
      "invalid_transition",
      `${input.mode} run requires an active owner approval for the exact current Project Kings source policy.`
    );
  }
  const profiles = input.profileIds
    .map((profileId) => requireProfile(profileId, input.workspaceId))
    .sort((left, right) => left.channelId.localeCompare(right.channelId));
  if (profiles.some((profile) => profile.publishPolicyId !== input.publishPolicyId)) {
    throw new Error("A profile is bound to a different publish policy.");
  }
  if (input.mode === "live" && profiles.some((profile) => !isProductionProfileExplicitlyApproved(profile, "live"))) {
    throw new Error("Live run requires explicitly approved, hash-bound active production profiles.");
  }
  if (input.mode === "shadow" && profiles.some((profile) => !isProductionProfileExplicitlyApproved(profile, "shadow"))) {
    throw new Error("Shadow run requires explicitly approved, hash-bound shadow or active production profiles.");
  }
  const portfolioProfileHash = hash({
    publishPolicyId: input.publishPolicyId,
    profiles: profiles.map((profile) => ({
      channelId: profile.channelId,
      profileId: profile.id,
      version: profile.version,
      profileHash: profile.profileHash,
      modelRouteManifestId: profile.modelRouteManifestId,
      modelRouteManifestSha256: profile.modelRouteManifestSha256
    }))
  });
  const requestIdentity = {
    schemaVersion: 4,
    workspaceId: input.workspaceId,
    logicalDate: input.logicalDate,
    mode: input.mode,
    targetPerChannel: input.targetPerChannel,
    publishPolicyId: input.publishPolicyId,
    portfolioProfileHash,
    profiles: profiles.map((profile) => ({
      profileId: profile.id,
      profileVersion: profile.version,
      profileHash: profile.profileHash,
      channelId: profile.channelId,
      modelRouteManifestId: profile.modelRouteManifestId,
      modelRouteManifestSha256: profile.modelRouteManifestSha256,
      approvalScope: profile.approvalScope,
      approvalBindingSha256: profile.approvalBindingSha256,
      approvedAt: profile.approvedAt,
      approvedByUserId: profile.approvedByUserId
    })),
    sourcePolicyApproval: sourcePolicyApproval
      ? {
          approvalId: sourcePolicyApproval.id,
          policyVersion: sourcePolicyApproval.policyVersion,
          policySha256: sourcePolicyApproval.policySha256,
          sourceDesignationsSha256: sourcePolicyApproval.sourceDesignationsSha256,
          approvalSha256: sourcePolicyApproval.approvalSha256,
          ownerUserId: sourcePolicyApproval.ownerUserId,
          approvedAt: sourcePolicyApproval.approvedAt
        }
      : null,
    canaryPolicy
  };
  const manifestHash = hash(requestIdentity);
  if (input.idempotencyKey) {
    const existing = findProductionRunByIdempotencyKey({
      workspaceId: input.workspaceId,
      idempotencyKey: input.idempotencyKey
    });
    if (existing) {
      if (
        existing.portfolioProfileHash !== portfolioProfileHash ||
        existing.logicalDate !== input.logicalDate ||
        existing.mode !== input.mode ||
        existing.targetPerChannel !== input.targetPerChannel ||
        existing.manifestHash !== manifestHash
      ) {
        throw new Error("Idempotency key is already bound to a different immutable portfolio request.");
      }
      const storedPreflight = Array.isArray(existing.manifest.preflight)
        ? existing.manifest.preflight as ProductionProfilePreflight[]
        : [];
      if (
        canaryPolicy === "none" &&
        ["ready", "running", "waiting_public"].includes(existing.status)
      ) {
        findOrCreateItems(existing);
        reserveInitialSources({ run: existing, canaryPolicy, canaryItemIds: [], now: startNow });
      }
      return { ...buildSummary(existing.id), existing: true, preflight: storedPreflight };
    }
  }

  const preflight = await Promise.all(
    profiles.map((profile) => validatePortfolioProductionProfile(profile, dependencies))
  );
  if (input.mode === "live" && canaryPolicy === "none" && preflight.some((entry) => !entry.valid)) {
    throw new Error(
      "Live canaryPolicy=none requires all three production profiles to pass preflight before run creation."
    );
  }
  const manifestWithoutCanary = {
    ...requestIdentity,
    profileFacts: profiles.map((profile) => {
      const validation = preflight.find((entry) => entry.profileId === profile.id)!;
      return {
        profileId: profile.id,
        profileVersion: profile.version,
        profileHash: profile.profileHash,
        channelId: profile.channelId,
        expectedYoutubeChannelId: profile.expectedYoutubeChannelId,
        templateSnapshotSha256: profile.templateSnapshotSha256,
        modelRouteManifestId: profile.modelRouteManifestId,
        modelRouteManifestSha256: profile.modelRouteManifestSha256,
        approvalScope: profile.approvalScope,
        approvalBindingSha256: profile.approvalBindingSha256,
        approvedAt: profile.approvedAt,
        approvedByUserId: profile.approvedByUserId,
        liveFactsHash: validation.liveFactsHash
      };
    }),
    preflight
  };
  const created = createOrGetProductionRun({
    workspaceId: input.workspaceId,
    portfolioProfileHash,
    logicalDate: input.logicalDate,
    mode: input.mode,
    targetPerChannel: input.targetPerChannel,
    manifestHash,
    manifest: manifestWithoutCanary,
    idempotencyKey: input.idempotencyKey,
    channels: profiles.map((profile) => ({
      channelId: profile.channelId,
      profileId: profile.id,
      profileVersion: profile.version,
      profileHash: profile.profileHash,
      expectedYoutubeChannelId: profile.expectedYoutubeChannelId,
      targetCount: input.targetPerChannel
    }))
  });
  if (created.existing) {
    if (
      canaryPolicy === "none" &&
      ["ready", "running", "waiting_public"].includes(created.run.status)
    ) {
      findOrCreateItems(created.run);
      reserveInitialSources({ run: created.run, canaryPolicy, canaryItemIds: [], now: startNow });
    }
    return { ...buildSummary(created.run.id), existing: true, preflight };
  }

  let run = transitionProductionRun({
    runId: created.run.id,
    expectedVersion: created.run.version,
    toStatus: "preflight",
    eventType: "production.run.preflight"
  });
  let validChannelCount = 0;
  for (const runChannel of listProductionRunChannels(run.id)) {
    const validation = preflight.find(
      (entry) => profiles.find((profile) => profile.id === entry.profileId)?.channelId === runChannel.channelId
    );
    let channel = transitionProductionRunChannel({
      runChannelId: runChannel.id,
      expectedVersion: runChannel.version,
      toStatus: "preflight",
      eventType: "production.channel.preflight"
    });
    if (!validation?.valid) {
      transitionProductionRunChannel({
        runChannelId: channel.id,
        expectedVersion: channel.version,
        toStatus: "blocked",
        eventType: "production.channel.blocked",
        blockerCode: "preflight_failed",
        blockerMessage: validation?.blockers.join("; ") || "Profile preflight failed."
      });
      continue;
    }
    channel = transitionProductionRunChannel({
      runChannelId: channel.id,
      expectedVersion: channel.version,
      toStatus: "ready",
      eventType: "production.channel.ready"
    });
    transitionProductionRunChannel({
      runChannelId: channel.id,
      expectedVersion: channel.version,
      toStatus: "running",
      eventType: "production.channel.started"
    });
    validChannelCount += 1;
  }
  if (validChannelCount === 0) {
    run = transitionProductionRun({
      runId: run.id,
      expectedVersion: run.version,
      toStatus: "blocked",
      eventType: "production.run.blocked",
      lastError: "All channel preflight checks failed."
    });
    return { ...buildSummary(run.id), existing: false, preflight };
  }
  run = transitionProductionRun({
    runId: run.id,
    expectedVersion: run.version,
    toStatus: "ready",
    eventType: "production.run.ready"
  });
  run = transitionProductionRun({
    runId: run.id,
    expectedVersion: run.version,
    toStatus: "running",
    eventType: "production.run.started"
  });
  const items = findOrCreateItems(run).sort(
    (left, right) => left.channelId.localeCompare(right.channelId) || left.itemSlot - right.itemSlot
  );
  const canaryItemIds = canaryPolicy === "first_item_per_channel_public_verified"
    ? firstItemIdsByChannel(items)
    : [];
  reserveInitialSources({ run, canaryPolicy, canaryItemIds, now: startNow });
  const summary = buildSummary(run.id);
  return {
    ...summary,
    canaryItemId: canaryItemIds[0] ?? null,
    canaryItemIds,
    existing: false,
    preflight
  };
}

function releasePostCanaryItems(run: ProductionRunRecord, items: ProductionItemRecord[], now?: string): void {
  if (run.mode !== "live" || resolveRunCanaryPolicy(run) !== "first_item_per_channel_public_verified") return;
  const sorted = [...items].sort(
    (left, right) => left.channelId.localeCompare(right.channelId) || left.itemSlot - right.itemSlot
  );
  const canaryByChannel = new Map<string, ProductionItemRecord>();
  for (const item of sorted) {
    if (!canaryByChannel.has(item.channelId)) canaryByChannel.set(item.channelId, item);
  }
  for (const item of sorted) {
    const canary = canaryByChannel.get(item.channelId);
    if (!canary || canary.state !== "public_verified" || item.id === canary.id) continue;
    if (item.state !== "reserved" || !item.sourceCandidateId) continue;
    try {
      appendProductionOutbox({
        workspaceId: item.workspaceId,
        runId: item.runId,
        channelId: item.channelId,
        productionItemId: item.id,
        eventKind: "source_ingest.requested",
        dedupeKey: buildProductionOutboxDedupeKey("source_ingest.requested", {
          gate: "source_ingest",
          candidateId: item.sourceCandidateId
        }),
        payload: { candidateId: item.sourceCandidateId },
        maxAttempts: 3,
        now
      });
    } catch (error) {
      if (!asErrorMessage(error).includes("already exists")) throw error;
    }
  }
}

export function reconcilePortfolioProductionRun(input: {
  runId: string;
  leaseOwner: string;
  leaseMs?: number;
  // Optional caller clock (Date or ISO). Deterministic replay/simulation
  // contours pass their virtual clock so any outbox the reconcile creates
  // (source reservation, post-canary release) stays claimable on that clock.
  now?: Date | string;
}): PortfolioRunSummary & { acquired: boolean } {
  const reconcileNow = input.now === undefined
    ? undefined
    : typeof input.now === "string" ? input.now : input.now.toISOString();
  const claimed = claimProductionRunLease({
    runId: input.runId,
    owner: input.leaseOwner,
    leaseMs: input.leaseMs ?? 30_000
  });
  if (!claimed) return { ...buildSummary(input.runId), acquired: false };
  try {
    let run = getProductionRun(input.runId)!;
    let items = listProductionItems({ runId: run.id });
    const cancellationRequested = run.status === "cancel_requested";
    const canaryPolicy = resolveRunCanaryPolicy(run);
    const canaryItemIds =
      canaryPolicy === "first_item_per_channel_public_verified"
        ? firstItemIdsByChannel(items)
        : [];
    if (!cancellationRequested) {
      reserveInitialSources({ run, canaryPolicy, canaryItemIds, now: reconcileNow });
      items = listProductionItems({ runId: run.id });
      releasePostCanaryItems(run, items, reconcileNow);
    }
    items = listProductionItems({ runId: run.id });
    const cancellationItems = cancellationRequested
      ? [...listProductionItems({ runId: run.id, includeHistorical: true })]
          .sort((left, right) => left.generation - right.generation)
          .reduce<ProductionItemRecord[]>((latest, candidate) => {
            const index = latest.findIndex((entry) =>
              entry.channelId === candidate.channelId && entry.itemSlot === candidate.itemSlot
            );
            if (index === -1) latest.push(candidate);
            else latest[index] = candidate;
            return latest;
          }, [])
      : items;
    const channels = listProductionRunChannels(run.id);
    for (const initialChannel of channels) {
      if (["blocked", "canceled", "failed", "completed"].includes(initialChannel.status)) continue;
      const channelItems = (cancellationRequested ? cancellationItems : items)
        .filter((item) => item.channelId === initialChannel.channelId);
      const cancellationSettled =
        cancellationRequested &&
        channelItems.length === initialChannel.targetCount &&
        channelItems.every((item) =>
          ["canceled", "public_verified", "policy_blocked", "failed", "replaced", "quarantined"].includes(item.state)
        );
      const allPublic =
        channelItems.length === initialChannel.targetCount &&
        channelItems.every((item) => item.state === "public_verified");
      const shadowApproved =
        run.mode === "shadow" &&
        channelItems.length === initialChannel.targetCount &&
        channelItems.every((item) => item.state === "final_approved");
      const allScheduled =
        channelItems.length === initialChannel.targetCount &&
        channelItems.every((item) => item.state === "publication_scheduled" || item.state === "public_verified");
      let channel = initialChannel;
      if (shadowApproved) {
        for (const item of channelItems) {
          if (!item.sourceCandidateId) {
            throw new Error(`Shadow item ${item.id} lost its source provenance before release.`);
          }
          releaseShadowSourceCandidateReservation({
            candidateId: item.sourceCandidateId,
            itemId: item.id,
            expectedItemVersion: item.version
          });
        }
      }
      if (cancellationSettled) {
        transitionProductionRunChannel({
          runChannelId: channel.id,
          expectedVersion: channel.version,
          toStatus: "canceled",
          eventType: "production.channel.canceled_after_reconciliation",
          eventPayload: {
            publicVerified: channelItems.filter((item) => item.state === "public_verified").length,
            canceledBeforeUpload: channelItems.filter((item) => item.state === "canceled").length
          }
        });
      } else if (!cancellationRequested && (allPublic || shadowApproved)) {
        if (channel.status === "running") {
          channel = transitionProductionRunChannel({
            runChannelId: channel.id,
            expectedVersion: channel.version,
            toStatus: "waiting_public",
            eventType: "production.channel.waiting_public"
          });
        }
        if (channel.status === "waiting_public") {
          transitionProductionRunChannel({
            runChannelId: channel.id,
            expectedVersion: channel.version,
            toStatus: "completed",
            eventType: "production.channel.completed"
          });
        }
      } else if (!cancellationRequested && allScheduled && channel.status === "running") {
        transitionProductionRunChannel({
          runChannelId: channel.id,
          expectedVersion: channel.version,
          toStatus: "waiting_public",
          eventType: "production.channel.waiting_public"
        });
      }
    }
    const refreshedChannels = listProductionRunChannels(run.id);
    const allCompleted = refreshedChannels.every((channel) => channel.status === "completed");
    const anyBlocked = refreshedChannels.some((channel) => channel.status === "blocked");
    const anyFailed = refreshedChannels.some((channel) => channel.status === "failed");
    const allTerminal = refreshedChannels.every((channel) =>
      ["completed", "blocked", "canceled", "failed"].includes(channel.status)
    );
    if (cancellationRequested && allTerminal) {
      run = getProductionRun(run.id)!;
      if (run.status === "cancel_requested") {
        transitionProductionRun({
          runId: run.id,
          expectedVersion: run.version,
          toStatus: "canceled",
          eventType: "production.run.canceled_after_reconciliation",
          eventPayload: {
            publicVerified: cancellationItems.filter((item) => item.state === "public_verified").length,
            canceledBeforeUpload: cancellationItems.filter((item) => item.state === "canceled").length
          },
          lastError: run.lastError
        });
      }
    } else if (allCompleted) {
      run = getProductionRun(run.id)!;
      if (run.status === "running") {
        run = transitionProductionRun({
          runId: run.id,
          expectedVersion: run.version,
          toStatus: "waiting_public",
          eventType: "production.run.waiting_public"
        });
      }
      if (run.status === "waiting_public") {
        transitionProductionRun({
          runId: run.id,
          expectedVersion: run.version,
          toStatus: "completed",
          eventType: "production.run.completed"
        });
      }
    } else if ((anyBlocked || anyFailed) && allTerminal) {
      run = getProductionRun(run.id)!;
      const terminalStatus = anyBlocked ? "blocked" : "failed";
      if (["created", "preflight", "ready", "running", "waiting_public"].includes(run.status)) {
        transitionProductionRun({
          runId: run.id,
          expectedVersion: run.version,
          toStatus: terminalStatus,
          eventType: terminalStatus === "blocked" ? "production.run.blocked" : "production.run.failed",
          lastError: terminalStatus === "blocked"
            ? "One or more channels are blocked."
            : "One or more channels failed after exhausting their retry budget."
        });
      }
    }
    return { ...buildSummary(run.id), acquired: true };
  } finally {
    const current = getProductionRun(input.runId);
    if (current?.leaseOwner === input.leaseOwner) {
      releaseProductionRunLease({
        runId: input.runId,
        leaseToken: claimed.leaseToken
      });
    }
  }
}

export type PortfolioOutboxDispatcher = (
  event: ProductionOutboxRecord
) => Promise<void>;

export async function dispatchPortfolioProductionOutbox(input: {
  owner: string;
  dispatcher: PortfolioOutboxDispatcher;
  limit?: number;
  leaseMs?: number;
  retryDelayMs?: number;
  now?: Date;
}): Promise<{
  claimed: number;
  delivered: number;
  retried: number;
  dead: number;
}> {
  const now = input.now ?? new Date();
  const claimed = claimProductionOutbox({
    owner: input.owner,
    leaseMs: input.leaseMs ?? 5 * 60_000,
    limit: input.limit ?? 10,
    now: now.toISOString()
  });
  let delivered = 0;
  let retried = 0;
  let dead = 0;
  for (const event of claimed) {
    try {
      await input.dispatcher(event);
      ackProductionOutbox({
        outboxId: event.id,
        leaseToken: event.leaseToken!,
        now: now.toISOString()
      });
      delivered += 1;
    } catch (error) {
      const handlerError = asErrorMessage(error);
      const superseded = ackProductionOutboxAsSupersededGeneration({
        outboxId: event.id,
        leaseToken: event.leaseToken!,
        handlerError,
        now: now.toISOString()
      });
      if (superseded) {
        delivered += 1;
        continue;
      }
      const next = retryProductionOutbox({
        outboxId: event.id,
        leaseToken: event.leaseToken!,
        error: handlerError,
        availableAt: new Date(now.getTime() + (input.retryDelayMs ?? 1_000)).toISOString(),
        now: now.toISOString()
      });
      if (next.status === "dead") dead += 1;
      else retried += 1;
    }
  }
  return { claimed: claimed.length, delivered, retried, dead };
}
