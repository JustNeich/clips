import {
  parseStage2ExamplesConfigJson,
  parseStage2HardConstraintsJson,
  stringifyStage2ExamplesConfig,
  stringifyStage2HardConstraints,
  type Stage2ExamplesConfig,
  type Stage2HardConstraints
} from "./stage2-channel-config";
import {
  createEmptyStage2EditorialMemorySummary,
  normalizeStage2EditorialMemorySummary,
  normalizeStage2StyleProfile,
  type Stage2EditorialMemorySummary,
  type Stage2StyleProfile
} from "./stage2-channel-learning";
import type { Stage2RunMode, Stage2RunRequest } from "./stage2-progress-store";
import type { Stage2DebugMode } from "./viral-shorts-worker/types";

type Stage2RunChannelSnapshotInput = {
  id: string;
  name: string;
  username: string;
  stage2ExamplesConfig: Stage2ExamplesConfig;
  stage2HardConstraints: Stage2HardConstraints;
  stage2StyleProfile?: Stage2StyleProfile;
  editorialMemory?: Stage2EditorialMemorySummary;
};

export function buildStage2RunRequestSnapshot(input: {
  sourceUrl: string;
  userInstruction: string | null;
  mode: Stage2RunMode;
  baseRunId?: string | null;
  debugMode?: Stage2DebugMode;
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
    debugMode: input.debugMode === "raw" ? "raw" : "summary",
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
      ),
      stage2StyleProfile: normalizeStage2StyleProfile(
        input.channel.stage2StyleProfile
      ),
      editorialMemory: normalizeStage2EditorialMemorySummary(
        input.channel.editorialMemory ?? createEmptyStage2EditorialMemorySummary(
          input.channel.stage2StyleProfile
            ? normalizeStage2StyleProfile(input.channel.stage2StyleProfile)
            : undefined
        ),
        input.channel.stage2StyleProfile
      )
    }
  };
}
