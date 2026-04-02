import type {
  Stage3RenderPlan,
  Stage3SnapshotManagedTemplateState
} from "../app/components/types";
import type { TemplateRenderSnapshot } from "./stage3-template-core";
import { getTemplateRegistryEntry } from "./stage3-template-registry";

export type Stage3SnapshotAuthoritativePreview = {
  templateSnapshot: TemplateRenderSnapshot | null;
};

export function isBuiltInStage3TemplateId(templateId: string | null | undefined): boolean {
  const candidate = templateId?.trim();
  if (!candidate) {
    return false;
  }
  return getTemplateRegistryEntry(candidate).variant.id === candidate;
}

export function hasResolvedStage3ManagedTemplateState(
  state: Pick<Stage3SnapshotManagedTemplateState, "managedId" | "updatedAt"> | null | undefined,
  templateId: string | null | undefined
): boolean {
  const candidate = templateId?.trim();
  if (!candidate) {
    return false;
  }
  if (isBuiltInStage3TemplateId(candidate)) {
    return true;
  }
  return state?.managedId === candidate && typeof state.updatedAt === "string" && state.updatedAt.length > 0;
}

export function toSnapshotManagedTemplateState(
  state: Stage3SnapshotManagedTemplateState | null | undefined,
  templateId: string | null | undefined
): Stage3SnapshotManagedTemplateState | null {
  const candidate = templateId?.trim();
  if (!candidate) {
    return null;
  }
  if (state?.managedId !== candidate) {
    return null;
  }
  if (!state.updatedAt?.trim()) {
    return null;
  }
  return {
    managedId: state.managedId,
    baseTemplateId: state.baseTemplateId,
    templateConfig: state.templateConfig,
    updatedAt: state.updatedAt
  };
}

export function resolveStage3SnapshotManagedTemplateState(params: {
  templateId: string;
  pageState?: Stage3SnapshotManagedTemplateState | null;
  previewState?: Stage3SnapshotManagedTemplateState | null;
}): Stage3SnapshotManagedTemplateState | null {
  if (params.previewState?.managedId === params.templateId) {
    return params.previewState;
  }
  if (params.pageState?.managedId === params.templateId) {
    return params.pageState;
  }
  return null;
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
