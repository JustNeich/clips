export const STAGE2_PROMPT_CONFIG_VERSION = 5 as const;

export const STAGE2_PROMPT_STAGE_IDS = [
  "classicOneShot",
  "storyOneShot",
  "oneShotReference",
  "analyzer",
  "selector",
  "writer",
  "critic",
  "rewriter",
  "finalSelector",
  "titles",
  "seo",
  "contextPacket",
  "candidateGenerator",
  "qualityCourt",
  "targetedRepair",
  "captionHighlighting",
  "captionTranslation",
  "titleWriter"
] as const;

export type Stage2PromptConfigStageId = (typeof STAGE2_PROMPT_STAGE_IDS)[number];

export const STAGE2_REASONING_EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "x-high", label: "X-High" }
] as const;

export type Stage2ReasoningEffort = (typeof STAGE2_REASONING_EFFORT_OPTIONS)[number]["value"];
export type Stage2PromptSourceMode = "system" | "custom";
export type Stage2SystemPromptPresetId = "system_prompt" | "animals_system_prompt";
export type Stage2PromptCompatibilityFamily = "stage2_legacy" | "native_caption_v3";

export type Stage2PromptCompatibility = {
  family: Stage2PromptCompatibilityFamily;
  bundleVersion: string;
  defaultPromptHash: string;
};

export type Stage2PromptStageConfig = {
  prompt: string;
  reasoningEffort: Stage2ReasoningEffort;
  compatibility: Stage2PromptCompatibility | null;
};

export type Stage2PromptConfig = {
  version: typeof STAGE2_PROMPT_CONFIG_VERSION;
  useWorkspaceDefault?: boolean;
  sourceMode?: Stage2PromptSourceMode;
  systemPresetId?: Stage2SystemPromptPresetId;
  stages: Record<Stage2PromptConfigStageId, Stage2PromptStageConfig>;
};

export const STAGE2_DEFAULT_REASONING_EFFORTS: Record<
  Stage2PromptConfigStageId,
  Stage2ReasoningEffort
> = {
  classicOneShot: "high",
  storyOneShot: "high",
  oneShotReference: "high",
  analyzer: "low",
  selector: "low",
  writer: "low",
  critic: "low",
  rewriter: "low",
  finalSelector: "low",
  titles: "low",
  seo: "low",
  contextPacket: "low",
  candidateGenerator: "low",
  qualityCourt: "low",
  targetedRepair: "low",
  captionHighlighting: "low",
  captionTranslation: "low",
  titleWriter: "low"
};

export const DEFAULT_STAGE2_PROMPT_CONFIG: Stage2PromptConfig = {
  version: STAGE2_PROMPT_CONFIG_VERSION,
  sourceMode: "system",
  systemPresetId: "system_prompt",
  stages: Object.fromEntries(
    STAGE2_PROMPT_STAGE_IDS.map((stageId) => [
      stageId,
      {
        prompt: "",
        reasoningEffort: STAGE2_DEFAULT_REASONING_EFFORTS[stageId],
        compatibility: null
      }
    ])
  ) as Record<Stage2PromptConfigStageId, Stage2PromptStageConfig>
};

function normalizeReasoningEffort(value: unknown, fallback: Stage2ReasoningEffort): Stage2ReasoningEffort {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "xhigh" || normalized === "extra-high") {
    return "x-high";
  }
  return normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "x-high"
    ? normalized
    : fallback;
}

function normalizePrompt(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeSystemPresetId(value: unknown): Stage2SystemPromptPresetId {
  return value === "animals_system_prompt" ? "animals_system_prompt" : "system_prompt";
}

export function normalizeStage2PromptConfig(input: unknown): Stage2PromptConfig {
  const candidate =
    input && typeof input === "object" ? (input as Partial<Stage2PromptConfig>) : undefined;
  const stagesCandidate =
    candidate?.stages && typeof candidate.stages === "object"
      ? (candidate.stages as Partial<Record<Stage2PromptConfigStageId, Partial<Stage2PromptStageConfig>>>)
      : {};
  const useWorkspaceDefault =
    typeof candidate?.useWorkspaceDefault === "boolean" ? candidate.useWorkspaceDefault : undefined;
  const sourceMode = candidate?.sourceMode === "custom" ? "custom" : "system";
  const systemPresetId = normalizeSystemPresetId(candidate?.systemPresetId);
  const stages = Object.fromEntries(
    STAGE2_PROMPT_STAGE_IDS.map((stageId) => {
      const stage = stagesCandidate[stageId];
      return [
        stageId,
        {
          prompt: normalizePrompt(stage?.prompt),
          reasoningEffort: normalizeReasoningEffort(
            stage?.reasoningEffort,
            STAGE2_DEFAULT_REASONING_EFFORTS[stageId]
          ),
          compatibility:
            stage?.compatibility && typeof stage.compatibility === "object"
              ? (stage.compatibility as Stage2PromptCompatibility)
              : null
        }
      ];
    })
  ) as Record<Stage2PromptConfigStageId, Stage2PromptStageConfig>;

  return {
    version: STAGE2_PROMPT_CONFIG_VERSION,
    ...(useWorkspaceDefault === undefined ? {} : { useWorkspaceDefault }),
    sourceMode,
    systemPresetId,
    stages
  };
}

export function hasStage2PromptOverrides(config: Stage2PromptConfig): boolean {
  const normalized = normalizeStage2PromptConfig(config);
  if (normalized.useWorkspaceDefault === true) {
    return false;
  }
  if (normalized.useWorkspaceDefault === false) {
    return true;
  }
  return STAGE2_PROMPT_STAGE_IDS.some((stageId) => {
    const stage = normalized.stages[stageId];
    return (
      Boolean(stage.prompt.trim()) ||
      stage.reasoningEffort !== STAGE2_DEFAULT_REASONING_EFFORTS[stageId]
    );
  });
}
