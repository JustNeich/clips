import {
  parseStage2ExamplesConfigJson,
  parseStage2HardConstraintsJson,
  stringifyStage2ExamplesConfig,
  stringifyStage2HardConstraints,
  type Stage2ExamplesConfig,
  type Stage2HardConstraints
} from "./stage2-channel-config";
import type { Stage2RunMode, Stage2RunRequest } from "./stage2-progress-store";

type Stage2RunChannelSnapshotInput = {
  id: string;
  name: string;
  username: string;
  stage2ExamplesConfig: Stage2ExamplesConfig;
  stage2HardConstraints: Stage2HardConstraints;
};

export function buildStage2RunRequestSnapshot(input: {
  sourceUrl: string;
  userInstruction: string | null;
  mode: Stage2RunMode;
  baseRunId?: string | null;
  channel: Stage2RunChannelSnapshotInput;
}): Stage2RunRequest {
  const channelName = input.channel.name.trim() || "Channel";
  const fallbackOwner = {
    channelId: input.channel.id,
    channelName
  };

  return {
    sourceUrl: input.sourceUrl,
    userInstruction: input.userInstruction,
    mode: input.mode,
    ...(input.baseRunId !== undefined ? { baseRunId: input.baseRunId ?? null } : {}),
    channel: {
      id: input.channel.id,
      name: channelName,
      username: input.channel.username.trim(),
      stage2ExamplesConfig: parseStage2ExamplesConfigJson(
        stringifyStage2ExamplesConfig(input.channel.stage2ExamplesConfig, fallbackOwner),
        fallbackOwner
      ),
      stage2HardConstraints: parseStage2HardConstraintsJson(
        stringifyStage2HardConstraints(input.channel.stage2HardConstraints)
      )
    }
  };
}
