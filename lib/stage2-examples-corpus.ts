import {
  collectWorkspaceStage2Examples,
  dedupeStage2CorpusExamples,
  normalizeStage2ExamplesConfig,
  type Stage2CorpusExample,
  type Stage2ExamplesConfig,
  type Stage2ExamplesCorpusSource
} from "./stage2-channel-config";
import { getStage2SystemExamplesPresetJson } from "./stage2-system-presets";

const WORKSPACE_STAGE2_CORPUS_OWNER = {
  channelId: "workspace-default",
  channelName: "Workspace default"
} as const;

export function resolveStage2ExamplesCorpus(input: {
  channel: {
    id: string;
    name: string;
    stage2ExamplesConfig: Stage2ExamplesConfig;
  };
  workspaceStage2ExamplesCorpusJson: string | null | undefined;
}): {
  source: Stage2ExamplesCorpusSource;
  corpus: Stage2CorpusExample[];
  workspaceCorpusCount: number;
  effectiveConfig: Stage2ExamplesConfig;
} {
  const workspaceCorpus = collectWorkspaceStage2Examples(input.workspaceStage2ExamplesCorpusJson);
  const stage2ExamplesConfig = normalizeStage2ExamplesConfig(
    input.channel.stage2ExamplesConfig,
    {
      channelId: input.channel.id,
      channelName: input.channel.name
    }
  );
  if (!stage2ExamplesConfig.useWorkspaceDefault) {
    if (stage2ExamplesConfig.sourceMode === "system") {
      return {
        source: "system_preset",
        corpus: collectWorkspaceStage2Examples(
          getStage2SystemExamplesPresetJson(stage2ExamplesConfig.systemPresetId)
        ),
        workspaceCorpusCount: workspaceCorpus.length,
        effectiveConfig: normalizeStage2ExamplesConfig(
          {
            useWorkspaceDefault: false,
            sourceMode: "system",
            systemPresetId: stage2ExamplesConfig.systemPresetId
          },
          {
            channelId: input.channel.id,
            channelName: input.channel.name
          }
        )
      };
    }
    return {
      source: "channel_custom",
      corpus: dedupeStage2CorpusExamples(stage2ExamplesConfig.customExamples),
      workspaceCorpusCount: workspaceCorpus.length,
      effectiveConfig: stage2ExamplesConfig
    };
  }

  return {
    source: "workspace_default",
    corpus: workspaceCorpus,
    workspaceCorpusCount: workspaceCorpus.length,
    effectiveConfig: normalizeStage2ExamplesConfig(
      {
        useWorkspaceDefault: false,
        sourceMode: "custom",
        customInputMode: "json",
        customExamplesJson:
          input.workspaceStage2ExamplesCorpusJson?.trim() ||
          JSON.stringify(workspaceCorpus, null, 2),
        customExamples: workspaceCorpus
      },
      WORKSPACE_STAGE2_CORPUS_OWNER
    )
  };
}
