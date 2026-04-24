import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  parseStage2ExamplesConfigJson,
  parseStage2HardConstraintsJson,
  stringifyStage2ExamplesConfig,
  stringifyStage2HardConstraints,
  type Stage2ExamplesConfig,
  type Stage2HardConstraints
} from "./stage2-channel-config";
import {
  normalizeStage2PromptConfig,
  type Stage2PromptConfig
} from "./stage2-pipeline";
import {
  type Stage2EditorialMemorySummary,
  type Stage2StyleProfile
} from "./stage2-channel-learning";
import {
  type Stage2EditorialMemorySource
} from "./stage2-editorial-memory-resolution";
import type { Stage2RunMode, Stage2RunRequest } from "./stage2-progress-store";
import { cloneTemplateHighlightConfig, type TemplateHighlightConfig } from "./template-highlights";
import type { Stage2TemplateSemanticsSnapshot } from "./stage2-template-contract";
import type { Stage3TemplateFormatGroup } from "./stage3-template-semantics";
import type { Stage2DebugMode } from "./viral-shorts-worker/types";

type Stage2RunChannelSnapshotInput = {
  id: string;
  name: string;
  username: string;
  templateId?: string | null;
  stage2WorkerProfileId?: string | null;
  stage2ExamplesConfig: Stage2ExamplesConfig;
  stage2HardConstraints: Stage2HardConstraints;
  stage2PromptConfig?: Stage2PromptConfig | null;
  stage2StyleProfile?: Stage2StyleProfile;
  editorialMemory?: Stage2EditorialMemorySummary;
  editorialMemorySource?: Stage2EditorialMemorySource | null;
  templateHighlightProfile?: TemplateHighlightConfig | null;
  templateFormatGroup?: Stage3TemplateFormatGroup | null;
  templateTextSemantics?: Stage2TemplateSemanticsSnapshot | null;
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
      templateId: input.channel.templateId ?? null,
      stage2WorkerProfileId: null,
      stage2ExamplesConfig: parseStage2ExamplesConfigJson(
        stringifyStage2ExamplesConfig(input.channel.stage2ExamplesConfig ?? DEFAULT_STAGE2_EXAMPLES_CONFIG, fallbackOwner),
        fallbackOwner
      ),
      stage2HardConstraints: parseStage2HardConstraintsJson(
        stringifyStage2HardConstraints(input.channel.stage2HardConstraints)
      ),
      stage2PromptConfig: input.channel.stage2PromptConfig
        ? normalizeStage2PromptConfig(input.channel.stage2PromptConfig)
        : undefined,
      stage2StyleProfile: undefined,
      editorialMemory: undefined,
      editorialMemorySource: null,
      templateHighlightProfile: input.channel.templateHighlightProfile
        ? cloneTemplateHighlightConfig(input.channel.templateHighlightProfile)
        : null,
      templateFormatGroup: input.channel.templateFormatGroup ?? null,
      templateTextSemantics: input.channel.templateTextSemantics ?? null
    }
  };
}
