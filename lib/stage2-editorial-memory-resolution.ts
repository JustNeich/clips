import {
  listChannelEditorialPassiveSelectionEvents,
  listChannelEditorialRatingEvents
} from "./channel-editorial-feedback-store";
import {
  buildStage2EditorialMemorySummary,
  normalizeStage2StyleProfile,
  type ChannelEditorialFeedbackEvent,
  type Stage2EditorialMemorySummary,
  type Stage2StyleProfile
} from "./stage2-channel-learning";
import { getStage2Run } from "./stage2-progress-store";
import {
  resolveStage2WorkerProfile,
  type Stage2WorkerProfileId
} from "./stage2-worker-profile";

export const STAGE2_EDITORIAL_MEMORY_EXPLICIT_LIMIT = 30;
export const STAGE2_EDITORIAL_MEMORY_SELECTION_LIMIT = 12;
export const STAGE2_EDITORIAL_MEMORY_SAME_LINE_EXPLICIT_MINIMUM = 6;
const STAGE2_EDITORIAL_MEMORY_EXPERIMENTAL_SIGNAL_THRESHOLD = 3;
const STAGE2_EDITORIAL_MEMORY_EXPERIMENTAL_PASSIVE_WEIGHT = 0.55;

export type Stage2EditorialMemorySourceStrategy =
  | "channel_wide"
  | "same_line_only"
  | "same_line_plus_channel_fallback"
  | "channel_fallback_only";

export type Stage2EditorialMemorySource = {
  strategy: Stage2EditorialMemorySourceStrategy;
  requestedWorkerProfileId: string | null;
  resolvedWorkerProfileId: Stage2WorkerProfileId | null;
  sameLineExplicitCount: number;
  fallbackExplicitCount: number;
  sameLineSelectionCount: number;
  fallbackSelectionCount: number;
  supplementedWithFallback: boolean;
  explicitThreshold: number;
};

export type Stage2ResolvedChannelEditorialMemory = {
  historyEvents: ChannelEditorialFeedbackEvent[];
  editorialMemory: Stage2EditorialMemorySummary;
  source: Stage2EditorialMemorySource;
};

function sortNewestFirst<T extends { createdAt: string }>(events: T[]): T[] {
  return [...events].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function isHardRule(event: ChannelEditorialFeedbackEvent): boolean {
  return event.kind !== "selected_option" && event.noteMode === "hard_rule";
}

function resolveRunWorkerProfileId(stage2RunId: string | null | undefined): Stage2WorkerProfileId | null {
  if (!stage2RunId) {
    return null;
  }
  const run = getStage2Run(stage2RunId);
  if (!run) {
    return null;
  }
  return resolveStage2WorkerProfile(run.request.channel.stage2WorkerProfileId).resolvedId;
}

function matchesWorkerProfile(
  event: ChannelEditorialFeedbackEvent,
  resolvedWorkerProfileId: Stage2WorkerProfileId
): boolean {
  if (!event.stage2RunId) {
    return false;
  }
  return resolveRunWorkerProfileId(event.stage2RunId) === resolvedWorkerProfileId;
}

export function normalizeStage2EditorialMemorySource(
  value: unknown
): Stage2EditorialMemorySource | null {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!candidate) {
    return null;
  }
  const strategy = typeof candidate.strategy === "string" ? candidate.strategy.trim() : "";
  if (
    strategy !== "channel_wide" &&
    strategy !== "same_line_only" &&
    strategy !== "same_line_plus_channel_fallback" &&
    strategy !== "channel_fallback_only"
  ) {
    return null;
  }
  const resolvedWorkerProfileId =
    typeof candidate.resolvedWorkerProfileId === "string" &&
    candidate.resolvedWorkerProfileId.trim()
      ? resolveStage2WorkerProfile(candidate.resolvedWorkerProfileId).resolvedId
      : null;
  const toCount = (entry: unknown) => {
    const parsed = Number(entry);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  };
  return {
    strategy,
    requestedWorkerProfileId:
      typeof candidate.requestedWorkerProfileId === "string" &&
      candidate.requestedWorkerProfileId.trim()
        ? candidate.requestedWorkerProfileId.trim()
        : null,
    resolvedWorkerProfileId,
    sameLineExplicitCount: toCount(candidate.sameLineExplicitCount),
    fallbackExplicitCount: toCount(candidate.fallbackExplicitCount),
    sameLineSelectionCount: toCount(candidate.sameLineSelectionCount),
    fallbackSelectionCount: toCount(candidate.fallbackSelectionCount),
    supplementedWithFallback: candidate.supplementedWithFallback === true,
    explicitThreshold: Math.max(
      1,
      toCount(candidate.explicitThreshold) || STAGE2_EDITORIAL_MEMORY_SAME_LINE_EXPLICIT_MINIMUM
    )
  };
}

export function resolveChannelEditorialMemory(input: {
  channelId: string;
  stage2StyleProfile: Stage2StyleProfile | null | undefined;
  stage2WorkerProfileId?: string | null;
  explicitLimit?: number;
  passiveLimit?: number;
  sameLineExplicitMinimum?: number;
}): Stage2ResolvedChannelEditorialMemory {
  const profile = normalizeStage2StyleProfile(input.stage2StyleProfile);
  const explicitLimit = Math.max(
    1,
    Math.floor(input.explicitLimit ?? STAGE2_EDITORIAL_MEMORY_EXPLICIT_LIMIT)
  );
  const passiveLimit = Math.max(
    1,
    Math.floor(input.passiveLimit ?? STAGE2_EDITORIAL_MEMORY_SELECTION_LIMIT)
  );
  const explicitThreshold = Math.max(
    1,
    Math.floor(
      input.sameLineExplicitMinimum ?? STAGE2_EDITORIAL_MEMORY_SAME_LINE_EXPLICIT_MINIMUM
    )
  );

  const explicitEvents = sortNewestFirst(listChannelEditorialRatingEvents(input.channelId, explicitLimit));
  const passiveEvents = sortNewestFirst(
    listChannelEditorialPassiveSelectionEvents(input.channelId, passiveLimit)
  );

  if (!input.stage2WorkerProfileId) {
    return {
      historyEvents: explicitEvents,
      editorialMemory: buildStage2EditorialMemorySummary({
        profile,
        feedbackEvents: [...explicitEvents, ...passiveEvents]
      }),
      source: {
        strategy: "channel_wide",
        requestedWorkerProfileId: null,
        resolvedWorkerProfileId: null,
        sameLineExplicitCount: 0,
        fallbackExplicitCount: explicitEvents.filter((event) => !isHardRule(event)).length,
        sameLineSelectionCount: 0,
        fallbackSelectionCount: passiveEvents.length,
        supplementedWithFallback: false,
        explicitThreshold
      }
    };
  }

  const resolvedWorkerProfile = resolveStage2WorkerProfile(input.stage2WorkerProfileId);
  const isExperimentalReference =
    resolvedWorkerProfile.executionMode === "one_shot_reference_v1_experimental";
  const hardRuleEvents = explicitEvents.filter(isHardRule);
  const sameLineHardRuleEvents = hardRuleEvents.filter((event) =>
    matchesWorkerProfile(event, resolvedWorkerProfile.resolvedId)
  );
  const softExplicitEvents = explicitEvents.filter((event) => !isHardRule(event));
  const sameLineExplicitEvents = softExplicitEvents.filter((event) =>
    matchesWorkerProfile(event, resolvedWorkerProfile.resolvedId)
  );
  const fallbackExplicitEvents = softExplicitEvents.filter(
    (event) => !matchesWorkerProfile(event, resolvedWorkerProfile.resolvedId)
  );

  const sameLinePassiveEvents = passiveEvents.filter((event) =>
    matchesWorkerProfile(event, resolvedWorkerProfile.resolvedId)
  );
  const fallbackPassiveEvents = passiveEvents.filter(
    (event) => !matchesWorkerProfile(event, resolvedWorkerProfile.resolvedId)
  );
  const effectiveExplicitThreshold = isExperimentalReference
    ? Math.min(explicitThreshold, STAGE2_EDITORIAL_MEMORY_EXPERIMENTAL_SIGNAL_THRESHOLD)
    : explicitThreshold;
  const sameLineSignalStrength = isExperimentalReference
    ? sameLineExplicitEvents.length +
      Math.min(2, sameLinePassiveEvents.length) +
      sameLineHardRuleEvents.length
    : sameLineExplicitEvents.length;
  const supplementedWithFallback = sameLineSignalStrength < effectiveExplicitThreshold;
  const selectedExplicitEvents = sameLineExplicitEvents.slice(0, explicitLimit);
  if (supplementedWithFallback) {
    const selectedIds = new Set(selectedExplicitEvents.map((event) => event.id));
    for (const event of fallbackExplicitEvents) {
      if (selectedExplicitEvents.length >= explicitLimit || selectedIds.has(event.id)) {
        break;
      }
      selectedIds.add(event.id);
      selectedExplicitEvents.push(event);
    }
  }
  const selectedPassiveEvents = sameLinePassiveEvents.slice(0, passiveLimit);
  if (supplementedWithFallback) {
    const selectedIds = new Set(selectedPassiveEvents.map((event) => event.id));
    for (const event of fallbackPassiveEvents) {
      if (selectedPassiveEvents.length >= passiveLimit || selectedIds.has(event.id)) {
        break;
      }
      selectedIds.add(event.id);
      selectedPassiveEvents.push(event);
    }
  }

  const historyEvents = sortNewestFirst([...hardRuleEvents, ...selectedExplicitEvents]);
  const feedbackEvents = sortNewestFirst([
    ...hardRuleEvents,
    ...selectedExplicitEvents,
    ...selectedPassiveEvents
  ]);
  const strategy: Stage2EditorialMemorySourceStrategy =
    (isExperimentalReference ? sameLineSignalStrength : sameLineExplicitEvents.length) === 0
      ? "channel_fallback_only"
      : supplementedWithFallback
        ? "same_line_plus_channel_fallback"
        : "same_line_only";

  return {
    historyEvents,
    editorialMemory: buildStage2EditorialMemorySummary({
      profile,
      feedbackEvents,
      passiveSelectionWeight: isExperimentalReference
        ? STAGE2_EDITORIAL_MEMORY_EXPERIMENTAL_PASSIVE_WEIGHT
        : undefined
    }),
    source: {
      strategy,
      requestedWorkerProfileId: resolvedWorkerProfile.requestedId,
      resolvedWorkerProfileId: resolvedWorkerProfile.resolvedId,
      sameLineExplicitCount: sameLineExplicitEvents.length,
      fallbackExplicitCount: fallbackExplicitEvents.length,
      sameLineSelectionCount: sameLinePassiveEvents.length,
      fallbackSelectionCount: fallbackPassiveEvents.length,
      supplementedWithFallback,
      explicitThreshold: effectiveExplicitThreshold
    }
  };
}
