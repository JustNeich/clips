import type { Stage3TemplateConfig } from "./stage3-template";

export type Stage3SnapshotManagedTemplateState = {
  managedId: string;
  baseTemplateId: string;
  templateConfig: Stage3TemplateConfig;
  updatedAt: string | null;
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
