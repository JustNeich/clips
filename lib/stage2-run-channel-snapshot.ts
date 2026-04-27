import type { Channel } from "./chat-history";
import { resolveManagedTemplateRuntimeSync } from "./managed-template-runtime";
import { resolveChannelEditorialMemory } from "./stage2-editorial-memory-resolution";
import { resolveStage2TemplateTextSemantics } from "./stage2-template-contract";
import type { Stage2RunRequest } from "./stage2-progress-store";

type Stage2RunChannelSnapshot = Stage2RunRequest["channel"];

type Stage2RuntimeChannelSource = Pick<
  Channel,
  | "id"
  | "workspaceId"
  | "name"
  | "username"
  | "stage2WorkerProfileId"
  | "stage2ExamplesConfig"
  | "stage2HardConstraints"
  | "stage2PromptConfig"
  | "stage2StyleProfile"
  | "templateId"
>;

export function buildStage2RunChannelSnapshot(
  channel: Stage2RuntimeChannelSource,
  options?: { workspaceId?: string | null }
): Stage2RunChannelSnapshot {
  const editorialMemoryResolution = resolveChannelEditorialMemory({
    channelId: channel.id,
    stage2StyleProfile: channel.stage2StyleProfile,
    stage2WorkerProfileId: channel.stage2WorkerProfileId
  });
  const templateRuntime = resolveManagedTemplateRuntimeSync(channel.templateId, null, {
    workspaceId: options?.workspaceId ?? channel.workspaceId
  });
  const templateTextSemantics = resolveStage2TemplateTextSemantics({
    templateId: channel.templateId,
    workspaceId: options?.workspaceId ?? channel.workspaceId,
    hardConstraints: channel.stage2HardConstraints
  });
  const formatPipeline =
    templateTextSemantics.formatGroup === "channel_story"
      ? "story_lead_main_caption"
      : "classic_top_bottom";
  const templateHighlightProfile = templateRuntime.templateConfig.highlights;

  return {
    id: channel.id,
    name: channel.name,
    username: channel.username,
    templateId: channel.templateId,
    formatPipeline,
    stage2WorkerProfileId: channel.stage2WorkerProfileId,
    stage2ExamplesConfig: channel.stage2ExamplesConfig,
    stage2HardConstraints: channel.stage2HardConstraints,
    stage2PromptConfig: channel.stage2PromptConfig,
    stage2StyleProfile: channel.stage2StyleProfile,
    editorialMemory: editorialMemoryResolution.editorialMemory,
    editorialMemorySource: editorialMemoryResolution.source,
    templateHighlightProfile,
    templateFormatGroup: templateTextSemantics.formatGroup,
    templateTextSemantics
  };
}
