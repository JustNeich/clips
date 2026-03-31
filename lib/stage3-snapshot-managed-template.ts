import type { Stage3RenderPlan } from "../app/components/types";
import type { Stage3TemplateConfig } from "./stage3-template";
import type { TemplateRenderSnapshot } from "./stage3-template-core";

export type Stage3SnapshotManagedTemplateState = {
  managedId: string;
  baseTemplateId: string;
  templateConfig: Stage3TemplateConfig;
  updatedAt: string | null;
};

export type Stage3SnapshotAuthoritativePreview = {
  templateSnapshot: TemplateRenderSnapshot | null;
};

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
