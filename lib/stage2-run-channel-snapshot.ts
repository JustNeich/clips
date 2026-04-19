import type { Channel } from "./chat-history";
import { resolveManagedTemplateRuntimeSync } from "./managed-template-runtime";
import { resolveChannelEditorialMemory } from "./stage2-editorial-memory-resolution";
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
  const templateHighlightProfile = resolveManagedTemplateRuntimeSync(channel.templateId, null, {
    workspaceId: options?.workspaceId ?? channel.workspaceId
  }).templateConfig.highlights;

  return {
    id: channel.id,
    name: channel.name,
    username: channel.username,
    templateId: channel.templateId,
    stage2WorkerProfileId: channel.stage2WorkerProfileId,
    stage2ExamplesConfig: channel.stage2ExamplesConfig,
    stage2HardConstraints: channel.stage2HardConstraints,
    stage2StyleProfile: channel.stage2StyleProfile,
    editorialMemory: editorialMemoryResolution.editorialMemory,
    editorialMemorySource: editorialMemoryResolution.source,
    templateHighlightProfile
  };
}
