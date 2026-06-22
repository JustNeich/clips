import type {
  Stage3RenderPlan,
  Stage3SnapshotManagedTemplateState
} from "../app/components/types";
import { createChannelStoryLowerSourceStripCrop, normalizeStage3SourceCrop } from "./stage3-source-crop";
import { CHANNEL_STORY_TEMPLATE_ID } from "./stage3-template";

export function isChannelStoryTemplate(
  templateId: string | null | undefined,
  managedTemplateState: Stage3SnapshotManagedTemplateState | null
): boolean {
  const resolvedTemplateId = typeof templateId === "string" ? templateId.trim() : "";
  if (!resolvedTemplateId) {
    return false;
  }
  if (managedTemplateState?.managedId === resolvedTemplateId) {
    return (
      managedTemplateState.baseTemplateId === CHANNEL_STORY_TEMPLATE_ID ||
      managedTemplateState.templateConfig.layoutKind === "channel_story"
    );
  }
  return resolvedTemplateId === CHANNEL_STORY_TEMPLATE_ID;
}

export function applyChannelStorySourceCropDefault(
  renderPlan: Stage3RenderPlan,
  managedTemplateState: Stage3SnapshotManagedTemplateState | null
): Stage3RenderPlan {
  if (!isChannelStoryTemplate(renderPlan.templateId, managedTemplateState)) {
    return renderPlan;
  }

  const normalizedCrop = normalizeStage3SourceCrop(renderPlan.sourceCrop, null);
  if (normalizedCrop) {
    return {
      ...renderPlan,
      sourceCrop: normalizedCrop
    };
  }

  return {
    ...renderPlan,
    videoFit: renderPlan.durationMode === "source_full" ? "contain" : renderPlan.videoFit,
    sourceCrop: createChannelStoryLowerSourceStripCrop()
  };
}
