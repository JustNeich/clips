export const PROJECT_KINGS_ACCEPTANCE_MATRIX_VERSION =
  "project-kings-acceptance-matrix-v1" as const;

export type ProjectKingsAcceptanceItem = Readonly<{
  itemId: string;
  channelId: string;
  state: string;
  sourceCandidateId: string | null;
  eventFingerprint: string | null;
  youtubeVideoId: string | null;
  publicationScheduledAt: string | null;
  scheduledSlotAt: string | null;
  publicVerifiedAt: string | null;
  clipsMatched: boolean;
  rssSeen: boolean;
  exactPagePlayable: boolean;
  criticalDefectCount: number;
  visualRevisionCount: number;
  technicalRetryCount: number;
  semanticCallCount: number;
  llmTokens: number;
  waitingReasoningTokens: number;
  preparedSourceCacheEligible: boolean;
  preparedSourceCacheHit: boolean;
  telemetryComplete: boolean;
}>;

export type ProjectKingsAcceptanceInput = Readonly<{
  releaseCandidateSha256: string;
  runId: string;
  runStartedAt: string;
  expectedChannelIds: readonly string[];
  targetPerChannel: number;
  items: readonly ProjectKingsAcceptanceItem[];
  july9BaselineTokensPerVideo: number | null;
  july9BaselineKind: "raw" | "estimated" | "missing";
  oneChannelFailureIsolationProven: boolean;
  restartResumeProven: boolean;
}>;

export type ProjectKingsAcceptanceGate = Readonly<{
  id: string;
  status: "pass" | "fail" | "not_measured";
  formula: string;
  raw: unknown;
  threshold: string;
}>;

export type ProjectKingsAcceptanceMatrix = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_ACCEPTANCE_MATRIX_VERSION;
  releaseCandidateSha256: string;
  runId: string;
  target: number;
  gates: readonly ProjectKingsAcceptanceGate[];
  status: "pass" | "blocked";
}>;

function timestamp(value: string | null, label: string): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be ISO-8601 or null.`);
  return parsed;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function percentileNearestRank(values: readonly number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? null;
}

function gate(input: Omit<ProjectKingsAcceptanceGate, "status"> & {
  pass: boolean | null;
}): ProjectKingsAcceptanceGate {
  return {
    id: input.id,
    status: input.pass === null ? "not_measured" : input.pass ? "pass" : "fail",
    formula: input.formula,
    raw: input.raw,
    threshold: input.threshold
  };
}

export function buildProjectKingsAcceptanceMatrix(
  input: ProjectKingsAcceptanceInput
): ProjectKingsAcceptanceMatrix {
  if (!/^[a-f0-9]{64}$/.test(input.releaseCandidateSha256)) {
    throw new Error("releaseCandidateSha256 must be a lowercase SHA-256.");
  }
  const runStartedAtMs = timestamp(input.runStartedAt, "runStartedAt")!;
  if (!Number.isInteger(input.targetPerChannel) || input.targetPerChannel < 1) {
    throw new Error("targetPerChannel must be a positive integer.");
  }
  if (new Set(input.expectedChannelIds).size !== input.expectedChannelIds.length) {
    throw new Error("expectedChannelIds must be unique.");
  }
  const target = input.expectedChannelIds.length * input.targetPerChannel;
  for (const item of input.items) {
    for (const [field, value] of [
      ["criticalDefectCount", item.criticalDefectCount],
      ["visualRevisionCount", item.visualRevisionCount],
      ["technicalRetryCount", item.technicalRetryCount],
      ["semanticCallCount", item.semanticCallCount],
      ["llmTokens", item.llmTokens],
      ["waitingReasoningTokens", item.waitingReasoningTokens]
    ] as const) nonNegativeInteger(value, `${item.itemId}.${field}`);
  }

  const publicItems = input.items.filter((item) => item.state === "public_verified");
  const countsByChannel = Object.fromEntries(input.expectedChannelIds.map((channelId) => [
    channelId,
    publicItems.filter((item) => item.channelId === channelId).length
  ]));
  const youtubeIds = publicItems.map((item) => item.youtubeVideoId).filter((value): value is string => Boolean(value));
  const sourceIds = publicItems.map((item) => item.sourceCandidateId).filter((value): value is string => Boolean(value));
  const eventIds = publicItems.map((item) => item.eventFingerprint).filter((value): value is string => Boolean(value));
  const scheduledDurations = input.items.flatMap((item) => {
    const at = timestamp(item.publicationScheduledAt, `${item.itemId}.publicationScheduledAt`);
    return at === null ? [] : [Math.max(0, at - runStartedAtMs)];
  });
  const publicLatencies = publicItems.flatMap((item) => {
    const slot = timestamp(item.scheduledSlotAt, `${item.itemId}.scheduledSlotAt`);
    const verified = timestamp(item.publicVerifiedAt, `${item.itemId}.publicVerifiedAt`);
    return slot === null || verified === null ? [] : [Math.max(0, verified - slot)];
  });
  const cacheEligible = publicItems.filter((item) => item.preparedSourceCacheEligible);
  const tokensPerVideo = publicItems.length
    ? publicItems.reduce((sum, item) => sum + item.llmTokens, 0) / publicItems.length
    : null;
  const tokenReduction =
    input.july9BaselineKind === "raw" &&
    typeof input.july9BaselineTokensPerVideo === "number" &&
    input.july9BaselineTokensPerVideo > 0 &&
    tokensPerVideo !== null
      ? 1 - tokensPerVideo / input.july9BaselineTokensPerVideo
      : null;

  const gates: ProjectKingsAcceptanceGate[] = [
    gate({
      id: "public_verified_9_of_9",
      formula: "count(state=public_verified)",
      raw: publicItems.length,
      threshold: `=${target}`,
      pass: publicItems.length === target && input.items.length === target
    }),
    gate({
      id: "three_per_channel",
      formula: "public_verified grouped by expected channel",
      raw: countsByChannel,
      threshold: `each=${input.targetPerChannel}`,
      pass: input.expectedChannelIds.every((channelId) => countsByChannel[channelId] === input.targetPerChannel)
    }),
    gate({
      id: "public_identity_unique",
      formula: "non-null unique youtubeVideoId / target",
      raw: { nonNull: youtubeIds.length, unique: new Set(youtubeIds).size },
      threshold: `nonNull=unique=${target}`,
      pass: youtubeIds.length === target && new Set(youtubeIds).size === target
    }),
    gate({
      id: "no_source_or_event_duplicates",
      formula: "unique sourceCandidateId and eventFingerprint / target",
      raw: {
        sourceNonNull: sourceIds.length,
        sourceUnique: new Set(sourceIds).size,
        eventNonNull: eventIds.length,
        eventUnique: new Set(eventIds).size
      },
      threshold: `all=${target}`,
      pass: sourceIds.length === target && eventIds.length === target &&
        new Set(sourceIds).size === target && new Set(eventIds).size === target
    }),
    gate({
      id: "three_surface_public_proof",
      formula: "all public items Clips match AND RSS seen AND exact page playable",
      raw: publicItems.map((item) => ({
        itemId: item.itemId,
        clipsMatched: item.clipsMatched,
        rssSeen: item.rssSeen,
        exactPagePlayable: item.exactPagePlayable
      })),
      threshold: "100% true",
      pass: publicItems.length === target && publicItems.every((item) =>
        item.clipsMatched && item.rssSeen && item.exactPagePlayable
      )
    }),
    gate({
      id: "zero_critical_defects",
      formula: "sum(criticalDefectCount)",
      raw: publicItems.reduce((sum, item) => sum + item.criticalDefectCount, 0),
      threshold: "=0",
      pass: publicItems.length === target && publicItems.every((item) => item.criticalDefectCount === 0)
    }),
    gate({
      id: "creation_p50",
      formula: "nearest-rank p50(publicationScheduledAt - runStartedAt)",
      raw: percentileNearestRank(scheduledDurations, 0.5),
      threshold: "<=2700000ms",
      pass: scheduledDurations.length === target
        ? percentileNearestRank(scheduledDurations, 0.5)! <= 45 * 60_000
        : false
    }),
    gate({
      id: "creation_p95",
      formula: "nearest-rank p95-of-9(publicationScheduledAt - runStartedAt)",
      raw: percentileNearestRank(scheduledDurations, 0.95),
      threshold: "<=3600000ms",
      pass: scheduledDurations.length === target
        ? percentileNearestRank(scheduledDurations, 0.95)! <= 60 * 60_000
        : false
    }),
    gate({
      id: "public_verification_latency",
      formula: "max(publicVerifiedAt - scheduledSlotAt)",
      raw: publicLatencies.length ? Math.max(...publicLatencies) : null,
      threshold: "<=300000ms",
      pass: publicLatencies.length === target && Math.max(...publicLatencies) <= 5 * 60_000
    }),
    gate({
      id: "mean_visual_revisions",
      formula: "sum(visualRevisionCount) / public videos",
      raw: publicItems.length
        ? publicItems.reduce((sum, item) => sum + item.visualRevisionCount, 0) / publicItems.length
        : null,
      threshold: "<=1.5",
      pass: publicItems.length === target &&
        publicItems.reduce((sum, item) => sum + item.visualRevisionCount, 0) / publicItems.length <= 1.5
    }),
    gate({
      id: "technical_retries",
      formula: "sum(technicalRetryCount) / public videos",
      raw: publicItems.length
        ? publicItems.reduce((sum, item) => sum + item.technicalRetryCount, 0) / publicItems.length
        : null,
      threshold: "<0.3",
      pass: publicItems.length === target &&
        publicItems.reduce((sum, item) => sum + item.technicalRetryCount, 0) / publicItems.length < 0.3
    }),
    gate({
      id: "prepared_source_cache_hit",
      formula: "cache hits / eligible rerenders",
      raw: cacheEligible.length
        ? cacheEligible.filter((item) => item.preparedSourceCacheHit).length / cacheEligible.length
        : null,
      threshold: ">=0.8",
      pass: cacheEligible.length
        ? cacheEligible.filter((item) => item.preparedSourceCacheHit).length / cacheEligible.length >= 0.8
        : null
    }),
    gate({
      id: "semantic_calls",
      formula: "sum(primary + failed + fallback semantic calls) / public videos",
      raw: publicItems.length
        ? publicItems.reduce((sum, item) => sum + item.semanticCallCount, 0) / publicItems.length
        : null,
      threshold: "<=8",
      pass: publicItems.length === target &&
        publicItems.reduce((sum, item) => sum + item.semanticCallCount, 0) / publicItems.length <= 8
    }),
    gate({
      id: "token_reduction_vs_july9",
      formula: "1 - current raw tokens/video / July 9 raw tokens/video",
      raw: {
        baselineKind: input.july9BaselineKind,
        baselineTokensPerVideo: input.july9BaselineTokensPerVideo,
        currentTokensPerVideo: tokensPerVideo,
        reduction: tokenReduction
      },
      threshold: ">=0.5 using raw baseline",
      pass: tokenReduction === null ? null : tokenReduction >= 0.5
    }),
    gate({
      id: "waiting_reasoning_tokens",
      formula: "sum(waitingReasoningTokens)",
      raw: publicItems.reduce((sum, item) => sum + item.waitingReasoningTokens, 0),
      threshold: "=0",
      pass: publicItems.length === target && publicItems.every((item) => item.waitingReasoningTokens === 0)
    }),
    gate({
      id: "telemetry_coverage",
      formula: "items with complete stage telemetry / target",
      raw: input.items.filter((item) => item.telemetryComplete).length,
      threshold: `=${target}`,
      pass: input.items.length === target && input.items.every((item) => item.telemetryComplete)
    }),
    gate({
      id: "channel_failure_isolation",
      formula: "fault replay proves one channel blocker does not stop two peers",
      raw: input.oneChannelFailureIsolationProven,
      threshold: "true",
      pass: input.oneChannelFailureIsolationProven
    }),
    gate({
      id: "restart_resume",
      formula: "fault replay/live evidence resumes same run from durable state",
      raw: input.restartResumeProven,
      threshold: "true",
      pass: input.restartResumeProven
    })
  ];
  return {
    schemaVersion: PROJECT_KINGS_ACCEPTANCE_MATRIX_VERSION,
    releaseCandidateSha256: input.releaseCandidateSha256,
    runId: input.runId,
    target,
    gates,
    status: gates.every((entry) => entry.status === "pass") ? "pass" : "blocked"
  };
}
