import type {
  Stage3RenderPlan,
  Stage3SnapshotManagedTemplateState
} from "../app/components/types";
import {
  CHANNEL_STORY_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  type Stage3TemplateConfig
} from "./stage3-template";
import type { TemplateRenderSnapshot } from "./stage3-template-core";
import { getTemplateRegistryEntry } from "./stage3-template-registry";

export type Stage3SnapshotAuthoritativePreview = {
  templateSnapshot: TemplateRenderSnapshot | null;
};

export const ORACLE_TEMPLATE_POOL_MANAGED_TEMPLATE_IDS = [
  "oracle-pool-top-bottom-observation-v1-42b5a5b6",
  "oracle-pool-lead-body-incident-v1-babca826",
  "oracle-pool-lead-body-evidence-v1-4bf5cc09",
  "oracle-pool-lead-body-compact-v1-8cd2ab78",
  "oracle-pool-body-visual-v1-d6759b63"
] as const;

type OracleTemplatePoolManagedTemplateId =
  (typeof ORACLE_TEMPLATE_POOL_MANAGED_TEMPLATE_IDS)[number];

const ORACLE_TEMPLATE_POOL_NAMES: Record<OracleTemplatePoolManagedTemplateId, string> = {
  "oracle-pool-top-bottom-observation-v1-42b5a5b6":
    "oracle-pool-top-bottom-observation-v1",
  "oracle-pool-lead-body-incident-v1-babca826":
    "oracle-pool-lead-body-incident-v1",
  "oracle-pool-lead-body-evidence-v1-4bf5cc09":
    "oracle-pool-lead-body-evidence-v1",
  "oracle-pool-lead-body-compact-v1-8cd2ab78":
    "oracle-pool-lead-body-compact-v1",
  "oracle-pool-body-visual-v1-d6759b63":
    "oracle-pool-body-visual-v1"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasValidHighlightConfig(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.enabled !== "boolean" ||
    typeof value.topEnabled !== "boolean" ||
    typeof value.bottomEnabled !== "boolean" ||
    !Array.isArray(value.slots) ||
    value.slots.length !== 3
  ) {
    return false;
  }
  const expectedSlotIds = ["slot1", "slot2", "slot3"];
  return value.slots.every((slot, index) => {
    return (
      isRecord(slot) &&
      slot.slotId === expectedSlotIds[index] &&
      typeof slot.enabled === "boolean" &&
      Boolean(readNonEmptyString(slot.color)) &&
      Boolean(readNonEmptyString(slot.label)) &&
      typeof slot.guidance === "string"
    );
  });
}

function cloneValidTemplateConfig(value: unknown): Stage3TemplateConfig | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.layoutKind !== "classic_top_bottom" && value.layoutKind !== "channel_story") {
    return null;
  }
  if (
    !isRecord(value.frame) ||
    !isFiniteNumber(value.frame.width) ||
    value.frame.width <= 0 ||
    !isFiniteNumber(value.frame.height) ||
    value.frame.height <= 0 ||
    !isRecord(value.card) ||
    !isRecord(value.slot) ||
    !isRecord(value.author) ||
    !isRecord(value.typography) ||
    !isRecord(value.typography.top) ||
    !isRecord(value.typography.bottom) ||
    !isRecord(value.typography.authorName) ||
    !isRecord(value.typography.authorHandle) ||
    !isRecord(value.palette) ||
    !isRecord(value.videoAdjustments) ||
    !isRecord(value.sourceOverlay) ||
    !isRecord(value.sourceWatermark) ||
    !hasValidHighlightConfig(value.highlights)
  ) {
    return null;
  }
  if (
    !isFiniteNumber(value.videoAdjustments.brightness) ||
    !isFiniteNumber(value.videoAdjustments.exposure) ||
    !isFiniteNumber(value.videoAdjustments.contrast) ||
    !isFiniteNumber(value.videoAdjustments.saturation)
  ) {
    return null;
  }
  if (value.layoutKind === "channel_story" && !isRecord(value.channelStory)) {
    return null;
  }
  try {
    return cloneStage3TemplateConfig(value as Stage3TemplateConfig);
  } catch {
    return null;
  }
}

function resolveOracleTemplatePoolName(templateId: string): string | null {
  return Object.prototype.hasOwnProperty.call(ORACLE_TEMPLATE_POOL_NAMES, templateId)
    ? ORACLE_TEMPLATE_POOL_NAMES[templateId as OracleTemplatePoolManagedTemplateId]
    : null;
}

export function isBuiltInStage3TemplateId(templateId: string | null | undefined): boolean {
  const candidate = templateId?.trim();
  if (!candidate) {
    return false;
  }
  return getTemplateRegistryEntry(candidate).variant.id === candidate;
}

export function canonicalizeStage3SnapshotManagedTemplateState(
  state: unknown,
  templateId: string | null | undefined
): Stage3SnapshotManagedTemplateState | null {
  const candidate = templateId?.trim();
  if (!candidate || isBuiltInStage3TemplateId(candidate) || !isRecord(state)) {
    return null;
  }

  const compactManagedId = readNonEmptyString(state.managedId);
  if (compactManagedId) {
    if (compactManagedId !== candidate) {
      return null;
    }
    const baseTemplateId = readNonEmptyString(state.baseTemplateId);
    const updatedAt = readNonEmptyString(state.updatedAt);
    const templateConfig = cloneValidTemplateConfig(state.templateConfig);
    if (
      !baseTemplateId ||
      !isBuiltInStage3TemplateId(baseTemplateId) ||
      !updatedAt ||
      !templateConfig
    ) {
      return null;
    }
    return {
      managedId: candidate,
      baseTemplateId,
      templateConfig,
      updatedAt
    };
  }

  const rawManagedId = readNonEmptyString(state.id);
  const expectedName = resolveOracleTemplatePoolName(candidate);
  const baseTemplateId = readNonEmptyString(state.baseTemplateId);
  const updatedAt = readNonEmptyString(state.updatedAt);
  const templateConfig = cloneValidTemplateConfig(state.templateConfig);
  if (
    rawManagedId !== candidate ||
    !expectedName ||
    state.name !== expectedName ||
    state.layoutFamily !== CHANNEL_STORY_TEMPLATE_ID ||
    baseTemplateId !== CHANNEL_STORY_TEMPLATE_ID ||
    state.archivedAt !== undefined && state.archivedAt !== null ||
    !updatedAt ||
    !templateConfig ||
    templateConfig.layoutKind !== "channel_story"
  ) {
    return null;
  }
  return {
    managedId: candidate,
    baseTemplateId,
    templateConfig,
    updatedAt
  };
}

export function hasResolvedStage3ManagedTemplateState(
  state: unknown,
  templateId: string | null | undefined
): boolean {
  const candidate = templateId?.trim();
  if (!candidate) {
    return false;
  }
  if (isBuiltInStage3TemplateId(candidate)) {
    return true;
  }
  return canonicalizeStage3SnapshotManagedTemplateState(state, candidate) !== null;
}

export function toSnapshotManagedTemplateState(
  state: unknown,
  templateId: string | null | undefined
): Stage3SnapshotManagedTemplateState | null {
  return canonicalizeStage3SnapshotManagedTemplateState(state, templateId);
}

export function resolveStage3SnapshotManagedTemplateState(params: {
  templateId: string;
  pageState?: unknown;
  previewState?: unknown;
}): Stage3SnapshotManagedTemplateState | null {
  return (
    canonicalizeStage3SnapshotManagedTemplateState(params.previewState, params.templateId) ??
    canonicalizeStage3SnapshotManagedTemplateState(params.pageState, params.templateId)
  );
}

export function applyStage3AuthoritativePreviewContent(
  renderPlan: Stage3RenderPlan,
  authoritativePreview?: Stage3SnapshotAuthoritativePreview | null
): Stage3RenderPlan {
  if (!authoritativePreview) {
    return renderPlan;
  }
  if (!authoritativePreview.templateSnapshot) {
    return renderPlan;
  }
  return {
    ...renderPlan,
    authorName: authoritativePreview.templateSnapshot.content.channelName,
    authorHandle: authoritativePreview.templateSnapshot.content.channelHandle,
    topFontScale: authoritativePreview.templateSnapshot.content.topFontScale,
    bottomFontScale: authoritativePreview.templateSnapshot.content.bottomFontScale
  };
}
