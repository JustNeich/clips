"use client";

import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  normalizeStage2ExamplesConfig,
  normalizeStage2HardConstraints,
  type Stage2ExamplesConfig,
  type Stage2HardConstraints
} from "../../lib/stage2-channel-config";
import {
  normalizeStage2StyleProfile,
  STAGE2_EDITORIAL_EXPLORATION_SHARE,
  STAGE2_STYLE_MIN_REFERENCE_LINKS,
  type Stage2StyleProfile
} from "../../lib/stage2-channel-learning";
import {
  DEFAULT_STAGE2_WORKER_PROFILE_ID,
  normalizeStage2WorkerProfileId,
  type Stage2WorkerProfileId
} from "../../lib/stage2-worker-profile";
import { normalizeStage2StyleDiscoveryReferenceUrls } from "../../lib/stage2-style-reference-links";

export const CHANNEL_ONBOARDING_STEPS = [
  {
    id: "identity",
    label: "Основа",
    description: "Название, username, аватар."
  },
  {
    id: "baseline",
    label: "База Stage 2",
    description: "Корпус, лимиты, стоп-слова."
  },
  {
    id: "references",
    label: "Референсы",
    description: "Добавьте 10+ клипов."
  },
  {
    id: "styles",
    label: "Стартовый стиль",
    description: "Отметьте всё, что реально подходит."
  }
] as const;

export type ChannelOnboardingStepId = (typeof CHANNEL_ONBOARDING_STEPS)[number]["id"];
export type ChannelOnboardingProgressStepState = "current" | "completed" | "available" | "locked";
export type ChannelOnboardingStyleDiscoveryStatus = "missing" | "fresh" | "stale";

export type ChannelOnboardingDraft = {
  name: string;
  username: string;
  stage2WorkerProfileId: Stage2WorkerProfileId;
  useWorkspaceExamples: boolean;
  customExamplesJson: string;
  customExamplesError: string | null;
  stage2HardConstraints: Stage2HardConstraints;
  referenceLinksText: string;
  styleProfile: Stage2StyleProfile | null;
  selectedStyleDirectionIds: string[];
  explorationShare: number;
};

export type PersistedChannelOnboardingState = {
  step: ChannelOnboardingStepId;
  furthestUnlockedStep: ChannelOnboardingStepId;
  draft: ChannelOnboardingDraft;
  activeStyleDiscoveryRunId: string | null;
};

export type ChannelStyleProfileEditorDraft = {
  referenceLinksText: string;
  styleProfile: Stage2StyleProfile;
  selectedStyleDirectionIds: string[];
  explorationShare: number;
};

export type PersistedChannelStyleProfileEditorState = {
  draft: ChannelStyleProfileEditorDraft;
  activeStyleDiscoveryRunId: string | null;
};

export function createChannelOnboardingDraft(input: {
  workspaceStage2HardConstraints: Stage2HardConstraints;
}): ChannelOnboardingDraft {
  return {
    name: "",
    username: "",
    stage2WorkerProfileId: DEFAULT_STAGE2_WORKER_PROFILE_ID,
    useWorkspaceExamples: true,
    customExamplesJson: "[]",
    customExamplesError: null,
    stage2HardConstraints: normalizeStage2HardConstraints(input.workspaceStage2HardConstraints),
    referenceLinksText: "",
    styleProfile: null,
    selectedStyleDirectionIds: [],
    explorationShare: STAGE2_EDITORIAL_EXPLORATION_SHARE
  };
}

export function normalizePersistedChannelOnboardingState(
  value: unknown,
  workspaceStage2HardConstraints: Stage2HardConstraints
): PersistedChannelOnboardingState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const step =
    typeof candidate.step === "string" &&
    CHANNEL_ONBOARDING_STEPS.some((item) => item.id === candidate.step)
      ? (candidate.step as ChannelOnboardingStepId)
      : "identity";
  const furthestUnlockedStep =
    typeof candidate.furthestUnlockedStep === "string" &&
    CHANNEL_ONBOARDING_STEPS.some((item) => item.id === candidate.furthestUnlockedStep)
      ? (candidate.furthestUnlockedStep as ChannelOnboardingStepId)
      : step;
  const draftCandidate =
    candidate.draft && typeof candidate.draft === "object"
      ? (candidate.draft as Partial<ChannelOnboardingDraft>)
      : null;
  const fallbackDraft = createChannelOnboardingDraft({ workspaceStage2HardConstraints });
  const draft: ChannelOnboardingDraft = {
    name: typeof draftCandidate?.name === "string" ? draftCandidate.name : fallbackDraft.name,
    username:
      typeof draftCandidate?.username === "string" ? draftCandidate.username : fallbackDraft.username,
    stage2WorkerProfileId:
      normalizeStage2WorkerProfileId(draftCandidate?.stage2WorkerProfileId) ??
      fallbackDraft.stage2WorkerProfileId,
    useWorkspaceExamples:
      typeof draftCandidate?.useWorkspaceExamples === "boolean"
        ? draftCandidate.useWorkspaceExamples
        : fallbackDraft.useWorkspaceExamples,
    customExamplesJson:
      typeof draftCandidate?.customExamplesJson === "string"
        ? draftCandidate.customExamplesJson
        : fallbackDraft.customExamplesJson,
    customExamplesError:
      typeof draftCandidate?.customExamplesError === "string"
        ? draftCandidate.customExamplesError
        : null,
    stage2HardConstraints: normalizeStage2HardConstraints(
      draftCandidate?.stage2HardConstraints ?? fallbackDraft.stage2HardConstraints
    ),
    referenceLinksText:
      typeof draftCandidate?.referenceLinksText === "string"
        ? draftCandidate.referenceLinksText
        : fallbackDraft.referenceLinksText,
    styleProfile: draftCandidate?.styleProfile
      ? normalizeStage2StyleProfile(draftCandidate.styleProfile)
      : null,
    selectedStyleDirectionIds: Array.isArray(draftCandidate?.selectedStyleDirectionIds)
      ? draftCandidate.selectedStyleDirectionIds
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : fallbackDraft.selectedStyleDirectionIds,
    explorationShare:
      typeof draftCandidate?.explorationShare === "number"
        ? Math.max(0.1, Math.min(0.4, draftCandidate.explorationShare))
        : fallbackDraft.explorationShare
  };

  return {
    step,
    furthestUnlockedStep,
    draft,
    activeStyleDiscoveryRunId:
      typeof candidate.activeStyleDiscoveryRunId === "string" &&
      candidate.activeStyleDiscoveryRunId.trim()
        ? candidate.activeStyleDiscoveryRunId.trim()
        : null
  };
}

export function normalizeChannelOnboardingUsername(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function parseChannelOnboardingCustomExamples(input: {
  json: string;
  channelName: string;
}): { config: Stage2ExamplesConfig; error: string | null } {
  const trimmed = input.json.trim();
  if (!trimmed) {
    return {
      config: {
        ...DEFAULT_STAGE2_EXAMPLES_CONFIG,
        useWorkspaceDefault: false,
        customExamples: []
      },
      error: null
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Кастомный корпус должен быть JSON-массивом.");
    }
    return {
      config: normalizeStage2ExamplesConfig(
        {
          version: 1,
          useWorkspaceDefault: false,
          customExamples: parsed
        },
        {
          channelId: "onboarding",
          channelName: input.channelName.trim() || "Канал"
        }
      ),
      error: null
    };
  } catch {
    return {
      config: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      error: "Кастомные examples должны быть валидным JSON."
    };
  }
}

export function parseChannelOnboardingReferenceLinks(text: string): string[] {
  return normalizeStage2StyleDiscoveryReferenceUrls(text.split(/\r?\n/));
}

function getChannelOnboardingStepIndex(step: ChannelOnboardingStepId): number {
  return CHANNEL_ONBOARDING_STEPS.findIndex((item) => item.id === step);
}

function getChannelOnboardingDiscoveredReferenceLinks(
  styleProfile: Stage2StyleProfile | null | undefined
): string[] {
  if (!styleProfile) {
    return [];
  }
  return normalizeStage2StyleDiscoveryReferenceUrls(
    styleProfile.referenceLinks.map((reference) => reference.normalizedUrl || reference.url)
  );
}

function areSameReferenceLinkSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftSet = new Set(left);
  return right.every((value) => leftSet.has(value));
}

export function getChannelOnboardingStyleDiscoveryStatus(
  draft: Pick<ChannelOnboardingDraft, "referenceLinksText" | "styleProfile">
): ChannelOnboardingStyleDiscoveryStatus {
  if (!draft.styleProfile) {
    return "missing";
  }
  const currentReferenceLinks = parseChannelOnboardingReferenceLinks(draft.referenceLinksText);
  const discoveredReferenceLinks = getChannelOnboardingDiscoveredReferenceLinks(draft.styleProfile);
  return areSameReferenceLinkSet(currentReferenceLinks, discoveredReferenceLinks) ? "fresh" : "stale";
}

export function updateChannelOnboardingReferenceLinks(
  draft: ChannelOnboardingDraft,
  referenceLinksText: string
): ChannelOnboardingDraft {
  return {
    ...draft,
    referenceLinksText
  };
}

export function applyChannelOnboardingStyleDiscoveryResult(
  draft: ChannelOnboardingDraft,
  styleProfile: Stage2StyleProfile
): ChannelOnboardingDraft {
  const normalizedProfile = normalizeStage2StyleProfile(styleProfile);
  return {
    ...draft,
    styleProfile: normalizedProfile,
    explorationShare: draft.explorationShare,
    selectedStyleDirectionIds: draft.selectedStyleDirectionIds.filter((id) =>
      normalizedProfile.candidateDirections.some((direction) => direction.id === id)
    )
  };
}

export function setChannelOnboardingExplorationShare(
  draft: ChannelOnboardingDraft,
  explorationShare: number
): ChannelOnboardingDraft {
  return {
    ...draft,
    explorationShare: Math.max(0.1, Math.min(0.4, explorationShare))
  };
}

export function toggleChannelOnboardingStyleDirectionSelection(
  draft: ChannelOnboardingDraft,
  directionId: string
): ChannelOnboardingDraft {
  const profile = normalizeStage2StyleProfile(draft.styleProfile);
  if (!profile.candidateDirections.some((direction) => direction.id === directionId)) {
    return draft;
  }
  const alreadySelected = draft.selectedStyleDirectionIds.includes(directionId);
  return {
    ...draft,
    selectedStyleDirectionIds: alreadySelected
      ? draft.selectedStyleDirectionIds.filter((id) => id !== directionId)
      : [...draft.selectedStyleDirectionIds, directionId]
  };
}

export function selectAllChannelOnboardingStyleDirections(
  draft: ChannelOnboardingDraft,
  options?: {
    fitBands?: Array<NonNullable<Stage2StyleProfile["candidateDirections"][number]["fitBand"]>>;
  }
): ChannelOnboardingDraft {
  const profile = normalizeStage2StyleProfile(draft.styleProfile);
  const allowedFitBands = options?.fitBands ?? null;
  return {
    ...draft,
    selectedStyleDirectionIds: profile.candidateDirections
      .filter((direction) => !allowedFitBands || allowedFitBands.includes(direction.fitBand))
      .map((direction) => direction.id)
  };
}

export function clearChannelOnboardingStyleDirectionSelection(
  draft: ChannelOnboardingDraft
): ChannelOnboardingDraft {
  return {
    ...draft,
    selectedStyleDirectionIds: []
  };
}

export function canContinueChannelOnboardingStep(
  step: ChannelOnboardingStepId,
  draft: ChannelOnboardingDraft
): boolean {
  if (step === "identity") {
    return Boolean(draft.name.trim() && draft.username.trim());
  }
  if (step === "baseline") {
    return draft.useWorkspaceExamples || draft.customExamplesError === null;
  }
  if (step === "references") {
    return parseChannelOnboardingReferenceLinks(draft.referenceLinksText).length >= STAGE2_STYLE_MIN_REFERENCE_LINKS;
  }
  return Boolean(draft.styleProfile) &&
    getChannelOnboardingStyleDiscoveryStatus(draft) === "fresh" &&
    draft.selectedStyleDirectionIds.length >= 1;
}

export function canSubmitChannelOnboardingDraft(draft: ChannelOnboardingDraft): boolean {
  return CHANNEL_ONBOARDING_STEPS.every((step) => canContinueChannelOnboardingStep(step.id, draft));
}

export function canNavigateChannelOnboardingStep(
  step: ChannelOnboardingStepId,
  furthestUnlockedStep: ChannelOnboardingStepId
): boolean {
  return getChannelOnboardingStepIndex(step) <= getChannelOnboardingStepIndex(furthestUnlockedStep);
}

export function getChannelOnboardingFurthestStep(
  current: ChannelOnboardingStepId,
  candidate: ChannelOnboardingStepId
): ChannelOnboardingStepId {
  return getChannelOnboardingStepIndex(candidate) > getChannelOnboardingStepIndex(current)
    ? candidate
    : current;
}

export function getChannelOnboardingProgressStepState(input: {
  step: ChannelOnboardingStepId;
  currentStep: ChannelOnboardingStepId;
  furthestUnlockedStep: ChannelOnboardingStepId;
  draft: ChannelOnboardingDraft;
}): ChannelOnboardingProgressStepState {
  if (input.step === input.currentStep) {
    return "current";
  }
  if (!canNavigateChannelOnboardingStep(input.step, input.furthestUnlockedStep)) {
    return "locked";
  }
  return canContinueChannelOnboardingStep(input.step, input.draft) ? "completed" : "available";
}

export function buildChannelOnboardingCreatePayload(draft: ChannelOnboardingDraft): {
  name: string;
  username: string;
  stage2WorkerProfileId: Stage2WorkerProfileId;
  stage2ExamplesConfig: Stage2ExamplesConfig;
  stage2HardConstraints: Stage2HardConstraints;
  referenceUrls: string[];
  stage2StyleProfile: Stage2StyleProfile;
} {
  const referenceUrls = parseChannelOnboardingReferenceLinks(draft.referenceLinksText);
  const normalizedStyleProfile = normalizeStage2StyleProfile(draft.styleProfile);
  const now = new Date().toISOString();
  const customExamples = parseChannelOnboardingCustomExamples({
    json: draft.customExamplesJson,
    channelName: draft.name
  });
  return {
    name: draft.name.trim() || "Новый канал",
    username: normalizeChannelOnboardingUsername(draft.username) || "kanal",
    stage2WorkerProfileId: draft.stage2WorkerProfileId,
    stage2ExamplesConfig: draft.useWorkspaceExamples
      ? DEFAULT_STAGE2_EXAMPLES_CONFIG
      : customExamples.config,
    stage2HardConstraints: normalizeStage2HardConstraints(draft.stage2HardConstraints),
    referenceUrls,
    stage2StyleProfile: normalizeStage2StyleProfile({
      ...normalizedStyleProfile,
      createdAt: normalizedStyleProfile.createdAt ?? now,
      updatedAt: now,
      onboardingCompletedAt: now,
      explorationShare: draft.explorationShare,
      selectedDirectionIds: draft.selectedStyleDirectionIds
    })
  };
}

export function createChannelStyleProfileEditorDraft(
  profile: Stage2StyleProfile | null | undefined
): ChannelStyleProfileEditorDraft {
  const normalizedProfile = normalizeStage2StyleProfile(profile);
  return {
    referenceLinksText: normalizeStage2StyleDiscoveryReferenceUrls(
      normalizedProfile.referenceLinks.map((reference) => reference.normalizedUrl || reference.url)
    ).join("\n"),
    styleProfile: normalizedProfile,
    selectedStyleDirectionIds: [...normalizedProfile.selectedDirectionIds],
    explorationShare: normalizedProfile.explorationShare
  };
}

export function normalizePersistedChannelStyleProfileEditorState(
  value: unknown,
  fallbackProfile: Stage2StyleProfile | null | undefined
): PersistedChannelStyleProfileEditorState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const fallbackDraft = createChannelStyleProfileEditorDraft(fallbackProfile);
  const draftCandidate =
    candidate.draft && typeof candidate.draft === "object"
      ? (candidate.draft as Partial<ChannelStyleProfileEditorDraft>)
      : null;

  return {
    draft: {
      referenceLinksText:
        typeof draftCandidate?.referenceLinksText === "string"
          ? draftCandidate.referenceLinksText
          : fallbackDraft.referenceLinksText,
      styleProfile: draftCandidate?.styleProfile
        ? normalizeStage2StyleProfile(draftCandidate.styleProfile)
        : fallbackDraft.styleProfile,
      selectedStyleDirectionIds: Array.isArray(draftCandidate?.selectedStyleDirectionIds)
        ? draftCandidate.selectedStyleDirectionIds
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : fallbackDraft.selectedStyleDirectionIds,
      explorationShare:
        typeof draftCandidate?.explorationShare === "number"
          ? Math.max(0.1, Math.min(0.4, draftCandidate.explorationShare))
          : fallbackDraft.explorationShare
    },
    activeStyleDiscoveryRunId:
      typeof candidate.activeStyleDiscoveryRunId === "string" &&
      candidate.activeStyleDiscoveryRunId.trim()
        ? candidate.activeStyleDiscoveryRunId.trim()
        : null
  };
}

export function getChannelStyleProfileEditorDiscoveryStatus(
  draft: Pick<ChannelStyleProfileEditorDraft, "referenceLinksText" | "styleProfile">
): ChannelOnboardingStyleDiscoveryStatus {
  return getChannelOnboardingStyleDiscoveryStatus({
    referenceLinksText: draft.referenceLinksText,
    styleProfile: draft.styleProfile
  });
}

export function updateChannelStyleProfileEditorReferenceLinks(
  draft: ChannelStyleProfileEditorDraft,
  referenceLinksText: string
): ChannelStyleProfileEditorDraft {
  return {
    ...draft,
    referenceLinksText
  };
}

export function applyChannelStyleProfileEditorDiscoveryResult(
  draft: ChannelStyleProfileEditorDraft,
  styleProfile: Stage2StyleProfile
): ChannelStyleProfileEditorDraft {
  const normalizedProfile = normalizeStage2StyleProfile(styleProfile);
  return {
    ...draft,
    styleProfile: {
      ...normalizedProfile,
      explorationShare: draft.explorationShare
    },
    selectedStyleDirectionIds: draft.selectedStyleDirectionIds.filter((id) =>
      normalizedProfile.candidateDirections.some((direction) => direction.id === id)
    )
  };
}

export function toggleChannelStyleProfileEditorDirectionSelection(
  draft: ChannelStyleProfileEditorDraft,
  directionId: string
): ChannelStyleProfileEditorDraft {
  const profile = normalizeStage2StyleProfile(draft.styleProfile);
  if (!profile.candidateDirections.some((direction) => direction.id === directionId)) {
    return draft;
  }
  const alreadySelected = draft.selectedStyleDirectionIds.includes(directionId);
  return {
    ...draft,
    selectedStyleDirectionIds: alreadySelected
      ? draft.selectedStyleDirectionIds.filter((id) => id !== directionId)
      : [...draft.selectedStyleDirectionIds, directionId]
  };
}

export function selectAllChannelStyleProfileEditorDirections(
  draft: ChannelStyleProfileEditorDraft,
  options?: {
    fitBands?: Array<NonNullable<Stage2StyleProfile["candidateDirections"][number]["fitBand"]>>;
  }
): ChannelStyleProfileEditorDraft {
  const profile = normalizeStage2StyleProfile(draft.styleProfile);
  const allowedFitBands = options?.fitBands ?? null;
  return {
    ...draft,
    selectedStyleDirectionIds: profile.candidateDirections
      .filter((direction) => !allowedFitBands || allowedFitBands.includes(direction.fitBand))
      .map((direction) => direction.id)
  };
}

export function clearChannelStyleProfileEditorDirectionSelection(
  draft: ChannelStyleProfileEditorDraft
): ChannelStyleProfileEditorDraft {
  return {
    ...draft,
    selectedStyleDirectionIds: []
  };
}

export function setChannelStyleProfileEditorExplorationShare(
  draft: ChannelStyleProfileEditorDraft,
  explorationShare: number
): ChannelStyleProfileEditorDraft {
  return {
    ...draft,
    explorationShare: Math.max(0.1, Math.min(0.4, explorationShare))
  };
}

export function buildChannelStyleProfileFromEditorDraft(
  draft: ChannelStyleProfileEditorDraft
): Stage2StyleProfile {
  const normalizedStyleProfile = normalizeStage2StyleProfile(draft.styleProfile);
  return normalizeStage2StyleProfile({
    ...normalizedStyleProfile,
    updatedAt: new Date().toISOString(),
    selectedDirectionIds: draft.selectedStyleDirectionIds,
    explorationShare: draft.explorationShare
  });
}
