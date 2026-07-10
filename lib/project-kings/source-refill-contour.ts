import { createHash } from "node:crypto";

import {
  buildProjectKingsSourceQualificationEvidence,
  canonicalizeProjectKingsSourceUrl,
  type ProjectKingsSourceFitAttestation,
  type ProjectKingsSourceMediaInspection
} from "./source-buffer-readiness";
import {
  decideProjectKingsSourceRefill
} from "./source-buffer-refill";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "./pilot-production-profiles";
import {
  ProductionAgentRunError,
  validateProductionAgentModelSelection,
  type ProductionAgentAttemptTelemetry,
  type ProductionAgentModelSelection
} from "./production-agent-runtime";
import { calculateProjectKingsCodexCreditMicros } from "./codex-credit-cost";
import type { ProductionReadyAgentRouteManifest } from "./production-model-route-manifest";
import {
  createProjectKingsSourceDesignationEvidence,
  evaluateProjectKingsSourcePolicy,
  hashProjectKingsSourcePolicyArtifact,
  PROJECT_KINGS_SOURCE_POLICY,
  type ProjectKingsSensitiveContentAssessment,
  type ProjectKingsSourcePolicyApproval,
  type ProjectKingsSourceRoute
} from "./source-rights-sensitive-policy";
import {
  hashProjectKingsSourceRefillLedgerValue,
  type FileProjectKingsSourceRefillLedgerStore,
  type ProjectKingsSourceRefillCandidateStage,
  type ProjectKingsSourceRefillAgentAttempt,
  type ProjectKingsSourceRefillLedgerCandidate,
  type ProjectKingsSourceRefillLedgerChannel,
  type ProjectKingsSourceRefillLedgerRequest,
  type ProjectKingsSourceRefillMode
} from "./source-refill-ledger";
import type { ProjectKingsSourceFitArtifact } from "./source-fit-assessment-runner";
import type { ProjectKingsSourcePolicyTextEvidence } from "./source-policy-assessment-runner";

export const PROJECT_KINGS_AUTONOMOUS_REFILL_VERSION =
  "project-kings-autonomous-source-refill-v1" as const;
export const PROJECT_KINGS_REFILL_READY_MIN = 6;
export const PROJECT_KINGS_REFILL_READY_CAP = 12;
export const PROJECT_KINGS_REFILL_CANDIDATE_BUDGET = 9;

export type ProjectKingsSourceBufferRuntimeCandidate = Readonly<{
  id: string;
  canonicalUrl: string;
  contentSha256: string | null;
  eventFingerprint: string | null;
  rightsStatus: string;
  status: string;
  qualificationStatus: string;
}>;

export type ProjectKingsSourceBufferRuntimeChannel = Readonly<{
  profileKey: ProjectKingsPilotProfileKey;
  channelId: string;
  qualifiedAvailable: number;
  refill: Readonly<{
    shouldRefill: boolean;
    readyBufferMin: number;
    readyBufferCap: number;
    candidateAttemptBudget: number;
    candidatesToRequest: number;
  }>;
  candidates: readonly ProjectKingsSourceBufferRuntimeCandidate[];
}>;

export type ProjectKingsSourceBufferRuntimeSnapshot = Readonly<{
  schemaVersion: "project-kings-source-buffer-runtime-v1";
  workspaceId: string;
  ready: boolean;
  sourcePolicyApproval: ProjectKingsSourcePolicyApproval | null;
  sourcePolicyApprovalSha256: string | null;
  channels: readonly ProjectKingsSourceBufferRuntimeChannel[];
}>;

export type ProjectKingsDiscoveredSourceCandidate = Readonly<{
  candidateId: string;
  profileKey: ProjectKingsPilotProfileKey;
  provider: "instagram" | "youtube_ask";
  route: ProjectKingsSourceRoute;
  donorUsername: string | null;
  sourceUrl: string;
  canonicalUrl: string;
  caption: string;
  provisionalStoryEventId: string;
  discoveryEvidenceSha256: string;
}>;

export type ProjectKingsDiscoveryIssue = Readonly<{
  providerId: string;
  code: string;
  retryable: boolean;
  detail: string;
}>;

export type ProjectKingsSourceDiscoveryProvider = Readonly<{
  providerId: string;
  strategy: "instagram" | "youtube_ask" | "reserve_pool";
  discover(input: Readonly<{
    profileKey: ProjectKingsPilotProfileKey;
    targetCandidateCount: number;
    knownCanonicalUrls: readonly string[];
    knownContentSha256: readonly string[];
    knownStoryEventIds: readonly string[];
    capturedAt: string;
  }>): Promise<Readonly<{
    candidates: readonly ProjectKingsDiscoveredSourceCandidate[];
    issues: readonly ProjectKingsDiscoveryIssue[];
    evidenceSha256: string;
  }>>;
}>;

export type ProjectKingsDownloadedSource = Readonly<{
  candidateId: string;
  sourceUrl: string;
  mediaPath: string;
  acquisitionPath: "public_ephemeral" | "owner_clips_cdp_fallback" | "approved_provider";
  acquisitionEvidenceSha256: string;
}>;

export type ProjectKingsSourceDownloadProvider = Readonly<{
  download(input: Readonly<{
    requestId: string;
    candidate: ProjectKingsDiscoveredSourceCandidate;
  }>): Promise<ProjectKingsDownloadedSource>;
}>;

export type ProjectKingsExtractedSourceEvidence = Readonly<{
  candidateId: string;
  mediaPath: string;
  media: ProjectKingsSourceMediaInspection;
  ocr: ProjectKingsSourcePolicyTextEvidence;
  asr: ProjectKingsSourcePolicyTextEvidence;
  sourceFitArtifacts: readonly ProjectKingsSourceFitArtifact[];
  extractionEvidenceSha256: string;
}>;

export type ProjectKingsSourceMediaEvidenceProvider = Readonly<{
  extract(input: Readonly<{
    requestId: string;
    candidate: ProjectKingsDiscoveredSourceCandidate;
    downloaded: ProjectKingsDownloadedSource;
  }>): Promise<ProjectKingsExtractedSourceEvidence>;
}>;

export type ProjectKingsSourcePolicyAssessor = Readonly<{
  assess(input: Readonly<{
    requestId: string;
    candidate: ProjectKingsDiscoveredSourceCandidate;
    extracted: ProjectKingsExtractedSourceEvidence;
    selection: ProductionAgentModelSelection;
  }>): Promise<Readonly<{
    assessment: ProjectKingsSensitiveContentAssessment;
    attemptEvidenceSha256: string;
    attempts: readonly ProductionAgentAttemptTelemetry[];
  }>>;
}>;

export type ProjectKingsSourceFitAssessor = Readonly<{
  assess(input: Readonly<{
    requestId: string;
    candidate: ProjectKingsDiscoveredSourceCandidate;
    extracted: ProjectKingsExtractedSourceEvidence;
    liveInventorySha256: string;
    knownSourceSha256: readonly string[];
    knownStoryEventIds: readonly string[];
    selection: ProductionAgentModelSelection;
  }>): Promise<Readonly<{
    attestation: ProjectKingsSourceFitAttestation;
    attempts: readonly ProductionAgentAttemptTelemetry[];
  }>>;
}>;

export type ProjectKingsSourceUploadProvider = Readonly<{
  upload(input: Readonly<{
    requestId: string;
    profileKey: ProjectKingsPilotProfileKey;
    mediaPath: string;
    requestEvidenceSha256: string;
    qualificationEvidence: NonNullable<ReturnType<typeof buildProjectKingsSourceQualificationEvidence>["evidence"]>;
  }>): Promise<Readonly<{
    created: boolean;
    durableCandidateId: string;
    responseEvidenceSha256: string;
  }>>;
}>;

export type RunProjectKingsAutonomousSourceRefillInput = Readonly<{
  mode: ProjectKingsSourceRefillMode;
  logicalDate: string;
  capturedAt: string;
  runtime: ProjectKingsSourceBufferRuntimeSnapshot;
  routeManifest: ProductionReadyAgentRouteManifest;
  ledger: FileProjectKingsSourceRefillLedgerStore;
  discoveryProviders: readonly ProjectKingsSourceDiscoveryProvider[];
  downloadProvider: ProjectKingsSourceDownloadProvider;
  mediaEvidenceProvider: ProjectKingsSourceMediaEvidenceProvider;
  policyAssessor: ProjectKingsSourcePolicyAssessor;
  sourceFitAssessor: ProjectKingsSourceFitAssessor;
  uploadProvider: ProjectKingsSourceUploadProvider;
}>;

export type ProjectKingsAutonomousSourceRefillResult = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_AUTONOMOUS_REFILL_VERSION;
  requestId: string;
  mode: ProjectKingsSourceRefillMode;
  status: ProjectKingsSourceRefillLedgerRequest["status"];
  readyBefore: boolean;
  channels: readonly Readonly<{
    profileKey: ProjectKingsPilotProfileKey;
    status: ProjectKingsSourceRefillLedgerChannel["status"];
    qualifiedAvailableBefore: number;
    targetQualifiedAvailable: number;
    attempts: number;
    qualified: number;
    uploaded: number;
    blockerCode: string | null;
  }>[];
  requestSha256: string;
}>;

const PROFILE_KEYS = Object.keys(PROJECT_KINGS_PILOT_PROFILES) as ProjectKingsPilotProfileKey[];
const SHA256 = /^[a-f0-9]{64}$/;
const TERMINAL_CANDIDATE_STAGES = new Set<ProjectKingsSourceRefillCandidateStage>([
  "duplicate_rejected",
  "policy_blocked",
  "source_fit_failed",
  "qualified_shadow",
  "uploaded",
  "failed"
]);

function stableHash(value: unknown): string {
  return hashProjectKingsSourceRefillLedgerValue(value);
}

function sourceRefillAgentAttempts(input: {
  attempts: readonly ProductionAgentAttemptTelemetry[];
  selection: ProductionAgentModelSelection;
}): ProjectKingsSourceRefillAgentAttempt[] {
  return input.attempts.map((attempt) => {
    const benchmark =
      input.selection.primary.route.routeId === attempt.routeId
        ? input.selection.primary.benchmark
        : input.selection.fallback.route.routeId === attempt.routeId
          ? input.selection.fallback.benchmark
          : null;
    let costMicros: number | null = null;
    let costUnit: "usd" | "codex_credits" | null = null;
    let costSource: "rate_card" | "benchmark_mean" | null = null;
    if (attempt.usage && attempt.provider === "codex") {
      try {
        costMicros = calculateProjectKingsCodexCreditMicros({
          model: attempt.model,
          usage: attempt.usage
        });
        costUnit = "codex_credits";
        costSource = "rate_card";
      } catch {
        // A newly benchmarked model may precede a frozen local rate card. The
        // same benchmark snapshot remains an explicit, bounded cost source.
      }
    }
    if (costMicros === null && benchmark) {
      costMicros = Math.round(benchmark.meanCost * 1_000_000);
      costUnit = benchmark.costUnit;
      costSource = "benchmark_mean";
    }
    return {
      role: attempt.role as "source_policy" | "source_fit",
      attempt: attempt.attempt,
      routeId: attempt.routeId,
      provider: attempt.provider,
      model: attempt.model,
      reasoningLevel: attempt.reasoningEffort,
      benchmarkVersion: attempt.benchmarkVersion,
      startedAt: attempt.startedAt,
      durationMs: Math.round(attempt.durationMs),
      promptSha256: attempt.promptSha256,
      outputSha256: attempt.outputSha256,
      inputTokens: attempt.usage?.inputTokens ?? null,
      cachedInputTokens: attempt.usage?.cachedInputTokens ?? null,
      outputTokens: attempt.usage?.outputTokens ?? null,
      reasoningOutputTokens: attempt.usage?.reasoningOutputTokens ?? null,
      costMicros,
      costUnit,
      costSource,
      outcome: attempt.outcome,
      error: attempt.error
    };
  });
}

function normalizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function validateRuntime(input: ProjectKingsSourceBufferRuntimeSnapshot): void {
  if (
    input.schemaVersion !== "project-kings-source-buffer-runtime-v1" ||
    !input.workspaceId.trim() ||
    input.channels.length !== PROFILE_KEYS.length
  ) {
    throw new Error("Project Kings source-buffer runtime snapshot is invalid.");
  }
  const keys = new Set<ProjectKingsPilotProfileKey>();
  for (const channel of input.channels) {
    if (keys.has(channel.profileKey)) throw new Error("Runtime repeats a Project Kings profile.");
    keys.add(channel.profileKey);
    const profile = PROJECT_KINGS_PILOT_PROFILES[channel.profileKey];
    if (
      channel.channelId !== profile.profileId ||
      channel.refill.readyBufferMin !== PROJECT_KINGS_REFILL_READY_MIN ||
      channel.refill.readyBufferCap !== PROJECT_KINGS_REFILL_READY_CAP ||
      channel.refill.candidateAttemptBudget !== PROJECT_KINGS_REFILL_CANDIDATE_BUDGET ||
      !Number.isInteger(channel.qualifiedAvailable) ||
      channel.qualifiedAvailable < 0 ||
      channel.qualifiedAvailable > PROJECT_KINGS_REFILL_READY_CAP
    ) {
      throw new Error(`Runtime source-buffer policy mismatch for ${channel.profileKey}.`);
    }
  }
}

function validateManifest(manifest: ProductionReadyAgentRouteManifest): void {
  if (
    manifest.schemaVersion !== 2 ||
    !manifest.manifestId.trim() ||
    !SHA256.test(manifest.manifestSha256) ||
    !manifest.selections.source_policy ||
    !manifest.selections.source_fit
  ) {
    throw new Error("A production-ready schema-v2 route manifest is required for source refill.");
  }
  validateProductionAgentModelSelection(manifest.selections.source_policy, "source_policy");
  validateProductionAgentModelSelection(manifest.selections.source_fit, "source_fit");
}

function providerOrderForProfile(profileKey: ProjectKingsPilotProfileKey): readonly string[] {
  const route = PROJECT_KINGS_SOURCE_POLICY.sourceDesignations[profileKey];
  return Object.freeze([
    "instagram",
    ...(route.youtubeAsk ? ["youtube_ask"] : []),
    "reserve_pool"
  ]);
}

function providerAllowed(
  profileKey: ProjectKingsPilotProfileKey,
  provider: ProjectKingsSourceDiscoveryProvider
): boolean {
  if (provider.strategy === "instagram" || provider.strategy === "reserve_pool") return true;
  return PROJECT_KINGS_SOURCE_POLICY.sourceDesignations[profileKey].youtubeAsk;
}

function initialChannel(
  runtime: ProjectKingsSourceBufferRuntimeChannel,
  capturedAt: string
): ProjectKingsSourceRefillLedgerChannel {
  const decision = decideProjectKingsSourceRefill({
    qualifiedAvailable: runtime.qualifiedAvailable,
    readyBufferMin: PROJECT_KINGS_REFILL_READY_MIN,
    readyBufferCap: PROJECT_KINGS_REFILL_READY_CAP,
    candidateAttemptBudget: PROJECT_KINGS_REFILL_CANDIDATE_BUDGET
  });
  return {
    profileKey: runtime.profileKey,
    profileVersion: PROJECT_KINGS_PILOT_PROFILES[runtime.profileKey].profileVersion,
    qualifiedAvailableBefore: runtime.qualifiedAvailable,
    targetQualifiedAvailable: decision.shouldRefill
      ? Math.min(PROJECT_KINGS_REFILL_READY_CAP, runtime.qualifiedAvailable + decision.candidatesToRequest)
      : runtime.qualifiedAvailable,
    // Attempt budget is independent from cap room: rejected/duplicate candidates
    // must not consume one of the seven successful admissions needed for 5 -> 12.
    candidateBudget: decision.shouldRefill ? PROJECT_KINGS_REFILL_CANDIDATE_BUDGET : 0,
    providerOrder: providerOrderForProfile(runtime.profileKey),
    status: decision.shouldRefill ? "planned" : "complete",
    attempts: 0,
    qualified: 0,
    uploaded: 0,
    blockerCode: null,
    blocker: null,
    candidates: [],
    updatedAt: capturedAt
  };
}

function createRequest(input: RunProjectKingsAutonomousSourceRefillInput): Omit<
  ProjectKingsSourceRefillLedgerRequest,
  "requestSha256"
> {
  const runtimeSnapshotSha256 = stableHash({
    schemaVersion: input.runtime.schemaVersion,
    workspaceId: input.runtime.workspaceId,
    ready: input.runtime.ready,
    sourcePolicyApprovalSha256: input.runtime.sourcePolicyApprovalSha256,
    channels: input.runtime.channels
      .map((channel) => ({
        profileKey: channel.profileKey,
        channelId: channel.channelId,
        qualifiedAvailable: channel.qualifiedAvailable,
        refill: channel.refill,
        candidates: channel.candidates
          .map((candidate) => ({
            id: candidate.id,
            canonicalUrl: candidate.canonicalUrl,
            contentSha256: candidate.contentSha256,
            eventFingerprint: candidate.eventFingerprint,
            rightsStatus: candidate.rightsStatus,
            status: candidate.status,
            qualificationStatus: candidate.qualificationStatus
          }))
          .sort((left, right) => left.id.localeCompare(right.id))
      }))
      .sort((left, right) => left.profileKey.localeCompare(right.profileKey))
  });
  const identity = stableHash({
    workspaceId: input.runtime.workspaceId,
    logicalDate: input.logicalDate,
    mode: input.mode,
    routeManifestSha256: input.routeManifest.manifestSha256,
    runtimeSnapshotSha256
  });
  const channels = input.runtime.channels
    .map((channel) => initialChannel(channel, input.capturedAt))
    .sort((left, right) => left.profileKey.localeCompare(right.profileKey));
  return {
    requestId: `source-refill-${identity.slice(0, 32)}`,
    workspaceId: input.runtime.workspaceId,
    logicalDate: input.logicalDate,
    mode: input.mode,
    routeManifestId: input.routeManifest.manifestId,
    routeManifestSha256: input.routeManifest.manifestSha256,
    runtimeSnapshotSha256,
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt,
    status: channels.every((channel) => channel.status === "complete") ? "complete" : "planned",
    channels
  };
}

function requestResult(
  request: ProjectKingsSourceRefillLedgerRequest,
  readyBefore: boolean
): ProjectKingsAutonomousSourceRefillResult {
  return Object.freeze({
    schemaVersion: PROJECT_KINGS_AUTONOMOUS_REFILL_VERSION,
    requestId: request.requestId,
    mode: request.mode,
    status: request.status,
    readyBefore,
    channels: request.channels.map((channel) => ({
      profileKey: channel.profileKey,
      status: channel.status,
      qualifiedAvailableBefore: channel.qualifiedAvailableBefore,
      targetQualifiedAvailable: channel.targetQualifiedAvailable,
      attempts: channel.attempts,
      qualified: channel.qualified,
      uploaded: channel.uploaded,
      blockerCode: channel.blockerCode
    })),
    requestSha256: request.requestSha256
  });
}

async function mutateChannel(input: {
  ledger: FileProjectKingsSourceRefillLedgerStore;
  requestId: string;
  profileKey: ProjectKingsPilotProfileKey;
  capturedAt: string;
  mutate: (channel: ProjectKingsSourceRefillLedgerChannel) => ProjectKingsSourceRefillLedgerChannel;
}): Promise<ProjectKingsSourceRefillLedgerRequest> {
  return input.ledger.mutateRequest(input.requestId, (request) => ({
    ...request,
    updatedAt: input.capturedAt,
    channels: request.channels.map((channel) =>
      channel.profileKey === input.profileKey ? input.mutate(channel) : channel
    )
  }));
}

function candidateLedgerRecord(input: {
  candidate: ProjectKingsDiscoveredSourceCandidate;
  stage: ProjectKingsSourceRefillCandidateStage;
  capturedAt: string;
  contentSha256?: string | null;
  storyEventId?: string | null;
  evidence: unknown;
  agentAttempts?: readonly ProjectKingsSourceRefillAgentAttempt[];
  blockerCode?: string | null;
  blocker?: string | null;
}): ProjectKingsSourceRefillLedgerCandidate {
  return {
    candidateId: input.candidate.candidateId,
    profileKey: input.candidate.profileKey,
    provider: input.candidate.provider,
    route: input.candidate.route,
    donorUsername: input.candidate.donorUsername,
    sourceUrl: input.candidate.sourceUrl,
    canonicalUrl: input.candidate.canonicalUrl,
    caption: input.candidate.caption,
    provisionalStoryEventId: input.candidate.provisionalStoryEventId,
    discoveryEvidenceSha256: input.candidate.discoveryEvidenceSha256,
    stage: input.stage,
    contentSha256: input.contentSha256 ?? null,
    storyEventId: input.storyEventId ?? null,
    agentAttempts: [...(input.agentAttempts ?? [])],
    evidenceSha256: stableHash(input.evidence),
    updatedAt: input.capturedAt,
    blockerCode: input.blockerCode ?? null,
    blocker: input.blocker ?? null
  };
}

async function persistCandidate(input: {
  ledger: FileProjectKingsSourceRefillLedgerStore;
  requestId: string;
  profileKey: ProjectKingsPilotProfileKey;
  capturedAt: string;
  record: ProjectKingsSourceRefillLedgerCandidate;
  incrementAttempt?: boolean;
  incrementQualified?: boolean;
  incrementUploaded?: boolean;
}): Promise<void> {
  await mutateChannel({
    ledger: input.ledger,
    requestId: input.requestId,
    profileKey: input.profileKey,
    capturedAt: input.capturedAt,
    mutate: (channel) => {
      const exists = channel.candidates.some(
        (candidate) => candidate.candidateId === input.record.candidateId
      );
      return {
        ...channel,
        status: "running",
        attempts: channel.attempts + (input.incrementAttempt && !exists ? 1 : 0),
        qualified: channel.qualified + (input.incrementQualified ? 1 : 0),
        uploaded: channel.uploaded + (input.incrementUploaded ? 1 : 0),
        candidates: exists
          ? channel.candidates.map((candidate) =>
              candidate.candidateId === input.record.candidateId ? input.record : candidate
            )
          : [...channel.candidates, input.record],
        updatedAt: input.capturedAt
      };
    }
  });
}

function knownSets(runtime: ProjectKingsSourceBufferRuntimeChannel): {
  canonicalUrls: Set<string>;
  sourceHashes: Set<string>;
  eventIds: Set<string>;
} {
  return {
    canonicalUrls: new Set(runtime.candidates.map((candidate) => candidate.canonicalUrl).filter(Boolean)),
    sourceHashes: new Set(runtime.candidates.map((candidate) => candidate.contentSha256).filter((value): value is string => Boolean(value))),
    eventIds: new Set(runtime.candidates.map((candidate) => candidate.eventFingerprint).filter((value): value is string => Boolean(value)))
  };
}

async function discoverCandidates(input: {
  profileKey: ProjectKingsPilotProfileKey;
  budget: number;
  capturedAt: string;
  providers: readonly ProjectKingsSourceDiscoveryProvider[];
  known: ReturnType<typeof knownSets>;
}): Promise<{ candidates: ProjectKingsDiscoveredSourceCandidate[]; issues: ProjectKingsDiscoveryIssue[] }> {
  const candidates: ProjectKingsDiscoveredSourceCandidate[] = [];
  const issues: ProjectKingsDiscoveryIssue[] = [];
  for (const strategy of providerOrderForProfile(input.profileKey)) {
    if (candidates.length >= input.budget) break;
    const provider = input.providers.find((entry) => entry.strategy === strategy);
    if (!provider || !providerAllowed(input.profileKey, provider)) continue;
    let result: Awaited<ReturnType<ProjectKingsSourceDiscoveryProvider["discover"]>>;
    try {
      result = await provider.discover({
        profileKey: input.profileKey,
        targetCandidateCount: input.budget - candidates.length,
        knownCanonicalUrls: [...input.known.canonicalUrls],
        knownContentSha256: [...input.known.sourceHashes],
        knownStoryEventIds: [...input.known.eventIds],
        capturedAt: input.capturedAt
      });
    } catch (error) {
      issues.push({
        providerId: provider.providerId,
        code: "source_provider_failed",
        retryable: true,
        detail: normalizeError(error)
      });
      continue;
    }
    issues.push(...result.issues);
    for (const candidate of result.candidates) {
      if (candidate.profileKey !== input.profileKey) {
        issues.push({
          providerId: provider.providerId,
          code: "candidate_profile_mismatch",
          retryable: false,
          detail: "Discovery provider returned a candidate for another profile."
        });
        continue;
      }
      let canonicalUrl: string;
      try {
        canonicalUrl = canonicalizeProjectKingsSourceUrl(candidate.canonicalUrl);
      } catch (error) {
        issues.push({
          providerId: provider.providerId,
          code: "candidate_url_invalid",
          retryable: false,
          detail: normalizeError(error)
        });
        continue;
      }
      if (canonicalUrl !== candidate.canonicalUrl || input.known.canonicalUrls.has(canonicalUrl)) continue;
      if (
        candidate.provider === "youtube_ask" &&
        !PROJECT_KINGS_SOURCE_POLICY.sourceDesignations[input.profileKey].youtubeAsk
      ) {
        issues.push({
          providerId: provider.providerId,
          code: "youtube_ask_not_designated",
          retryable: false,
          detail: "Frozen profile policy does not permit YouTube Ask for this channel."
        });
        continue;
      }
      if (
        candidate.provider === "instagram" &&
        (!candidate.donorUsername ||
          !(PROJECT_KINGS_SOURCE_POLICY.sourceDesignations[input.profileKey]
            .instagramDonors as readonly string[]).includes(candidate.donorUsername))
      ) {
        issues.push({
          providerId: provider.providerId,
          code: "instagram_donor_not_designated",
          retryable: false,
          detail: "Instagram discovery returned a donor outside the approved profile routes."
        });
        continue;
      }
      if (!SHA256.test(candidate.discoveryEvidenceSha256)) {
        issues.push({
          providerId: provider.providerId,
          code: "discovery_evidence_invalid",
          retryable: false,
          detail: "Candidate discovery evidence is not hash-bound."
        });
        continue;
      }
      input.known.canonicalUrls.add(canonicalUrl);
      candidates.push(candidate);
      if (candidates.length >= input.budget) break;
    }
  }
  return { candidates, issues };
}

async function processChannel(input: {
  request: ProjectKingsSourceRefillLedgerRequest;
  channel: ProjectKingsSourceRefillLedgerChannel;
  runtime: ProjectKingsSourceBufferRuntimeChannel;
  contour: RunProjectKingsAutonomousSourceRefillInput;
}): Promise<void> {
  const { contour, channel, runtime, request } = input;
  const profileKey = channel.profileKey;
  if (channel.status === "complete" || channel.candidateBudget === 0) return;
  if (!contour.runtime.sourcePolicyApproval) {
    await mutateChannel({
      ledger: contour.ledger,
      requestId: request.requestId,
      profileKey,
      capturedAt: contour.capturedAt,
      mutate: (current) => ({
        ...current,
        status: "blocked",
        blockerCode: "source_policy_approval_missing",
        blocker: "The exact one-time Project Kings source policy approval is missing.",
        updatedAt: contour.capturedAt
      })
    });
    return;
  }
  if (
    contour.runtime.sourcePolicyApprovalSha256 !==
    contour.runtime.sourcePolicyApproval.approvalSha256
  ) {
    await mutateChannel({
      ledger: contour.ledger,
      requestId: request.requestId,
      profileKey,
      capturedAt: contour.capturedAt,
      mutate: (current) => ({
        ...current,
        status: "blocked",
        blockerCode: "source_policy_approval_mismatch",
        blocker: "Runtime source policy approval hash does not match the approval artifact.",
        updatedAt: contour.capturedAt
      })
    });
    return;
  }
  if (contour.mode === "dry_run") {
    await mutateChannel({
      ledger: contour.ledger,
      requestId: request.requestId,
      profileKey,
      capturedAt: contour.capturedAt,
      mutate: (current) => ({
        ...current,
        status: "complete",
        updatedAt: contour.capturedAt
      })
    });
    return;
  }

  const known = knownSets(runtime);
  const currentLedger = await contour.ledger.read();
  const resumedChannel = currentLedger.requests
    .find((entry) => entry.requestId === request.requestId)
    ?.channels.find((entry) => entry.profileKey === profileKey);
  const resumableCandidates: ProjectKingsDiscoveredSourceCandidate[] = [];
  for (const candidate of resumedChannel?.candidates ?? []) {
    if (["qualified_shadow", "uploaded"].includes(candidate.stage)) {
      if (candidate.contentSha256) known.sourceHashes.add(candidate.contentSha256);
      if (candidate.storyEventId) known.eventIds.add(candidate.storyEventId);
    }
    if (TERMINAL_CANDIDATE_STAGES.has(candidate.stage)) {
      known.canonicalUrls.add(candidate.canonicalUrl);
      continue;
    }
    resumableCandidates.push({
      candidateId: candidate.candidateId,
      profileKey: candidate.profileKey,
      provider: candidate.provider,
      route: candidate.route,
      donorUsername: candidate.donorUsername,
      sourceUrl: candidate.sourceUrl,
      canonicalUrl: candidate.canonicalUrl,
      caption: candidate.caption,
      provisionalStoryEventId: candidate.provisionalStoryEventId,
      discoveryEvidenceSha256: candidate.discoveryEvidenceSha256
    });
  }
  let discovered: Awaited<ReturnType<typeof discoverCandidates>>;
  try {
    discovered = await discoverCandidates({
      profileKey,
      budget: Math.max(0, channel.candidateBudget - (resumedChannel?.attempts ?? 0)),
      capturedAt: contour.capturedAt,
      providers: contour.discoveryProviders,
      known
    });
  } catch (error) {
    await mutateChannel({
      ledger: contour.ledger,
      requestId: request.requestId,
      profileKey,
      capturedAt: contour.capturedAt,
      mutate: (current) => ({
        ...current,
        status: "blocked",
        blockerCode: "source_discovery_failed",
        blocker: normalizeError(error),
        updatedAt: contour.capturedAt
      })
    });
    return;
  }

  const workCandidates = [
    ...resumableCandidates,
    ...discovered.candidates.filter((candidate) =>
      !resumableCandidates.some((resumed) => resumed.candidateId === candidate.candidateId)
    )
  ];
  for (const candidate of workCandidates) {
    const latest = (await contour.ledger.read()).requests
      .find((entry) => entry.requestId === request.requestId)
      ?.channels.find((entry) => entry.profileKey === profileKey);
    if (!latest) break;
    if (
      latest.qualifiedAvailableBefore + latest.qualified >=
      latest.targetQualifiedAvailable
    ) break;
    const existing = latest.candidates.find((entry) => entry.candidateId === candidate.candidateId);
    const agentAttempts = [...(existing?.agentAttempts ?? [])];
    if (existing && TERMINAL_CANDIDATE_STAGES.has(existing.stage)) continue;
    if (!existing && latest.attempts >= latest.candidateBudget) break;
    if (!existing) {
      await persistCandidate({
        ledger: contour.ledger,
        requestId: request.requestId,
        profileKey,
        capturedAt: contour.capturedAt,
        incrementAttempt: true,
        record: candidateLedgerRecord({
          candidate,
          stage: "discovered",
          capturedAt: contour.capturedAt,
          evidence: candidate
        })
      });
    }

    try {
      const downloaded = await contour.downloadProvider.download({
        requestId: request.requestId,
        candidate
      });
      await persistCandidate({
        ledger: contour.ledger,
        requestId: request.requestId,
        profileKey,
        capturedAt: contour.capturedAt,
        record: candidateLedgerRecord({
          candidate,
          stage: "downloaded",
          capturedAt: contour.capturedAt,
          evidence: downloaded
        })
      });
      const extracted = await contour.mediaEvidenceProvider.extract({
        requestId: request.requestId,
        candidate,
        downloaded
      });
      if (!extracted.media.decodeComplete) {
        throw new Error(extracted.media.decodeError ?? "Downloaded MP4 did not fully decode.");
      }
      await persistCandidate({
        ledger: contour.ledger,
        requestId: request.requestId,
        profileKey,
        capturedAt: contour.capturedAt,
        record: candidateLedgerRecord({
          candidate,
          stage: "media_extracted",
          capturedAt: contour.capturedAt,
          contentSha256: extracted.media.contentSha256,
          evidence: extracted
        })
      });
      if (known.sourceHashes.has(extracted.media.contentSha256)) {
        await persistCandidate({
          ledger: contour.ledger,
          requestId: request.requestId,
          profileKey,
          capturedAt: contour.capturedAt,
          record: candidateLedgerRecord({
            candidate,
            stage: "duplicate_rejected",
            capturedAt: contour.capturedAt,
            contentSha256: extracted.media.contentSha256,
            evidence: { duplicateDimension: "content_sha256", extracted },
            blockerCode: "duplicate_content",
            blocker: "Exact source bytes already exist in the channel source ledger."
          })
        });
        continue;
      }
      const designation = createProjectKingsSourceDesignationEvidence({
        candidateId: candidate.candidateId,
        profileKey,
        provider: candidate.provider,
        route: candidate.route,
        donorUsername: candidate.donorUsername,
        canonicalSourceUrl: candidate.canonicalUrl,
        rightsEvidenceStatus: "covered_by_approved_source_policy",
        upstreamDiscoveryEvidenceSha256: candidate.discoveryEvidenceSha256
      });
      const assessed = await contour.policyAssessor.assess({
        requestId: request.requestId,
        candidate,
        extracted,
        selection: contour.routeManifest.selections.source_policy
      });
      agentAttempts.push(...sourceRefillAgentAttempts({
        attempts: assessed.attempts,
        selection: contour.routeManifest.selections.source_policy
      }));
      const verdict = evaluateProjectKingsSourcePolicy(
        {
          candidateId: candidate.candidateId,
          profileKey,
          canonicalSourceUrl: candidate.canonicalUrl,
          contentSha256: extracted.media.contentSha256,
          discoveryState: "frozen_catalog",
          sourceDesignation: designation,
          sensitiveAssessment: assessed.assessment
        },
        {
          evaluatedAt: contour.capturedAt,
          policyApproval: contour.runtime.sourcePolicyApproval
        }
      );
      if (verdict.disposition !== "pass" || !verdict.eligibleForSourceFit) {
        await persistCandidate({
          ledger: contour.ledger,
          requestId: request.requestId,
          profileKey,
          capturedAt: contour.capturedAt,
          record: candidateLedgerRecord({
            candidate,
            stage: "policy_blocked",
            capturedAt: contour.capturedAt,
            contentSha256: extracted.media.contentSha256,
            evidence: { designation, assessed, verdict },
            agentAttempts,
            blockerCode: "source_policy_blocked",
            blocker: verdict.issues.join(", ") || "Source policy did not PASS."
          })
        });
        continue;
      }
      const fit = await contour.sourceFitAssessor.assess({
        requestId: request.requestId,
        candidate,
        extracted,
        liveInventorySha256: request.runtimeSnapshotSha256,
        knownSourceSha256: [...known.sourceHashes],
        knownStoryEventIds: [...known.eventIds],
        selection: contour.routeManifest.selections.source_fit
      });
      agentAttempts.push(...sourceRefillAgentAttempts({
        attempts: fit.attempts,
        selection: contour.routeManifest.selections.source_fit
      }));
      const output = fit.attestation.output;
      if (
        output.decision !== "PASS" ||
        known.eventIds.has(output.storyEventId) ||
        known.sourceHashes.has(extracted.media.contentSha256)
      ) {
        const duplicate = known.eventIds.has(output.storyEventId) || output.duplicateEvent;
        await persistCandidate({
          ledger: contour.ledger,
          requestId: request.requestId,
          profileKey,
          capturedAt: contour.capturedAt,
          record: candidateLedgerRecord({
            candidate,
            stage: duplicate ? "duplicate_rejected" : "source_fit_failed",
            capturedAt: contour.capturedAt,
            contentSha256: extracted.media.contentSha256,
            storyEventId: output.storyEventId,
            evidence: fit,
            agentAttempts,
            blockerCode: duplicate ? "duplicate_event" : "source_fit_failed",
            blocker: output.reason
          })
        });
        continue;
      }
      const qualification = buildProjectKingsSourceQualificationEvidence({
        capturedAt: contour.capturedAt,
        candidateId: candidate.candidateId,
        profileKey,
        sourceUrl: candidate.sourceUrl,
        provider: candidate.provider,
        provisionalStoryEventId: null,
        rightsStatus: "owner_approved_source_pool",
        media: {
          resolvedCopies: [extracted.media.relativePath],
          duplicateCopiesIgnored: [],
          uniqueContentHashes: [extracted.media.contentSha256],
          selected: extracted.media,
          ambiguous: false
        },
        liveInventorySha256: request.runtimeSnapshotSha256,
        sourceFitAttestation: fit.attestation,
        discoveryState: "frozen_catalog",
        sourcePolicyApproval: contour.runtime.sourcePolicyApproval,
        sourceDesignation: designation,
        sensitiveAssessment: assessed.assessment
      });
      if (qualification.status !== "qualified" || !qualification.evidence) {
        throw new Error(
          `Qualification failed closed: ${qualification.blockers.map((entry) => entry.code).join(", ")}`
        );
      }
      known.sourceHashes.add(extracted.media.contentSha256);
      known.eventIds.add(output.storyEventId);
      if (contour.mode === "shadow") {
        await persistCandidate({
          ledger: contour.ledger,
          requestId: request.requestId,
          profileKey,
          capturedAt: contour.capturedAt,
          incrementQualified: true,
          record: candidateLedgerRecord({
            candidate,
            stage: "qualified_shadow",
            capturedAt: contour.capturedAt,
            contentSha256: extracted.media.contentSha256,
            storyEventId: output.storyEventId,
            evidence: qualification.evidence,
            agentAttempts
          })
        });
        continue;
      }
      const uploaded = await contour.uploadProvider.upload({
        requestId: request.requestId,
        profileKey,
        mediaPath: extracted.mediaPath,
        requestEvidenceSha256: request.requestSha256,
        qualificationEvidence: qualification.evidence
      });
      await persistCandidate({
        ledger: contour.ledger,
        requestId: request.requestId,
        profileKey,
        capturedAt: contour.capturedAt,
        incrementQualified: true,
        incrementUploaded: true,
        record: candidateLedgerRecord({
          candidate,
          stage: "uploaded",
          capturedAt: contour.capturedAt,
          contentSha256: extracted.media.contentSha256,
          storyEventId: output.storyEventId,
          evidence: { qualification: qualification.evidence, uploaded },
          agentAttempts
        })
      });
    } catch (error) {
      if (error instanceof ProductionAgentRunError) {
        const selection = error.role === "source_policy"
          ? contour.routeManifest.selections.source_policy
          : error.role === "source_fit"
            ? contour.routeManifest.selections.source_fit
            : null;
        if (selection) {
          const seen = new Set(agentAttempts.map((attempt) =>
            `${attempt.role}:${attempt.routeId}:${attempt.attempt}:${attempt.promptSha256}`
          ));
          for (const attempt of sourceRefillAgentAttempts({ attempts: error.attempts, selection })) {
            const identity = `${attempt.role}:${attempt.routeId}:${attempt.attempt}:${attempt.promptSha256}`;
            if (!seen.has(identity)) agentAttempts.push(attempt);
          }
        }
      }
      await persistCandidate({
        ledger: contour.ledger,
        requestId: request.requestId,
        profileKey,
        capturedAt: contour.capturedAt,
        record: candidateLedgerRecord({
          candidate,
          stage: "failed",
          capturedAt: contour.capturedAt,
          evidence: { error: normalizeError(error) },
          agentAttempts,
          blockerCode: "candidate_processing_failed",
          blocker: normalizeError(error)
        })
      });
    }
  }

  const finished = (await contour.ledger.read()).requests
    .find((entry) => entry.requestId === request.requestId)
    ?.channels.find((entry) => entry.profileKey === profileKey);
  if (!finished) throw new Error(`Source-refill channel vanished: ${profileKey}.`);
  const complete = finished.qualifiedAvailableBefore + finished.qualified >=
    finished.targetQualifiedAvailable;
  const noSupply = workCandidates.length === 0;
  const issueSummary = discovered.issues.map((issue) => issue.code).join(", ");
  await mutateChannel({
    ledger: contour.ledger,
    requestId: request.requestId,
    profileKey,
    capturedAt: contour.capturedAt,
    mutate: (current) => ({
      ...current,
      status: complete ? "complete" : "blocked",
      blockerCode: complete ? null : noSupply ? "source_discovery_exhausted" : "source_refill_budget_exhausted",
      blocker: complete
        ? null
        : noSupply
          ? `No designated source candidate was discovered${issueSummary ? `: ${issueSummary}` : "."}`
          : "The bounded nine-candidate budget ended before the buffer target was reached.",
      updatedAt: contour.capturedAt
    })
  });
}

export async function runProjectKingsAutonomousSourceRefill(
  input: RunProjectKingsAutonomousSourceRefillInput
): Promise<ProjectKingsAutonomousSourceRefillResult> {
  validateRuntime(input.runtime);
  validateManifest(input.routeManifest);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.logicalDate)) {
    throw new Error("logicalDate must use YYYY-MM-DD.");
  }
  if (new Date(input.capturedAt).toISOString() !== input.capturedAt) {
    throw new Error("capturedAt must be a canonical ISO timestamp.");
  }
  const draft = createRequest(input);
  const ledger = await input.ledger.read();
  let request = ledger.requests.find((entry) => entry.requestId === draft.requestId);
  if (!request) request = await input.ledger.upsertRequest(draft);
  if (request.status === "complete") return requestResult(request, input.runtime.ready);
  request = await input.ledger.mutateRequest(request.requestId, (current) => ({
    ...current,
    status: "running",
    updatedAt: input.capturedAt
  }));

  const runtimeByProfile = new Map(
    input.runtime.channels.map((channel) => [channel.profileKey, channel])
  );
  const activeRequest = request;
  await Promise.all(
    activeRequest.channels.map(async (channel) => {
      const runtime = runtimeByProfile.get(channel.profileKey);
      if (!runtime) throw new Error(`Runtime channel is missing: ${channel.profileKey}.`);
      await processChannel({ request: activeRequest, channel, runtime, contour: input });
    })
  );
  request = await input.ledger.mutateRequest(request.requestId, (current) => {
    const blocked = current.channels.filter((channel) => channel.status === "blocked").length;
    const complete = current.channels.filter((channel) => channel.status === "complete").length;
    return {
      ...current,
      status: blocked === 0
        ? "complete"
        : complete > 0
          ? "partial"
          : "blocked",
      updatedAt: input.capturedAt
    };
  });
  return requestResult(request, input.runtime.ready);
}

export function hashProjectKingsDiscoveredSourceCandidate(
  candidate: Omit<ProjectKingsDiscoveredSourceCandidate, "discoveryEvidenceSha256">
): string {
  return hashProjectKingsSourcePolicyArtifact(candidate);
}
