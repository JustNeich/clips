export const WORKSPACE_CODEX_MODEL_OPTIONS = [
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" }
] as const;

const SPARK_MODEL = "gpt-5.3-codex-spark";
const MULTIMODAL_FALLBACK_MODEL = "gpt-5.4";

export type WorkspaceCodexModel = (typeof WORKSPACE_CODEX_MODEL_OPTIONS)[number]["value"];
export type WorkspaceCodexModelSetting = WorkspaceCodexModel | "deploy_default";

export const STAGE2_MULTIMODAL_MODEL_STAGE_IDS = [
  "classicOneShot",
  "storyOneShot",
  "oneShotReference",
  "analyzer",
  "contextPacket",
  "styleDiscovery"
] as const;
export const STAGE2_TEXT_ONLY_MODEL_STAGE_IDS = [
  "selector",
  "writer",
  "critic",
  "rewriter",
  "finalSelector",
  "titles",
  "seo",
  "candidateGenerator",
  "qualityCourt",
  "targetedRepair",
  "captionHighlighting",
  "captionTranslation",
  "titleWriter",
  "regenerate"
] as const;
export const STAGE2_NATIVE_PIPELINE_EXECUTION_MODEL_STAGE_IDS = [
  "classicOneShot",
  "storyOneShot",
  "oneShotReference",
  "contextPacket",
  "candidateGenerator",
  "qualityCourt",
  "targetedRepair",
  "captionHighlighting",
  "captionTranslation",
  "titleWriter"
] as const;
export const STAGE2_LEGACY_PIPELINE_EXECUTION_MODEL_STAGE_IDS = [
  "analyzer",
  "selector",
  "writer",
  "critic",
  "rewriter",
  "finalSelector",
  "titles"
] as const;
export const STAGE2_PIPELINE_EXECUTION_MODEL_STAGE_IDS = [
  ...STAGE2_NATIVE_PIPELINE_EXECUTION_MODEL_STAGE_IDS,
  ...STAGE2_LEGACY_PIPELINE_EXECUTION_MODEL_STAGE_IDS
] as const;
export const STAGE2_PROMPT_MODEL_STAGE_IDS = [
  ...STAGE2_NATIVE_PIPELINE_EXECUTION_MODEL_STAGE_IDS,
  "seo"
] as const;
export const STAGE2_MODEL_STAGE_IDS = [
  ...STAGE2_MULTIMODAL_MODEL_STAGE_IDS,
  ...STAGE2_TEXT_ONLY_MODEL_STAGE_IDS
] as const;
export const WORKSPACE_CODEX_MODEL_STAGE_IDS = [
  ...STAGE2_MODEL_STAGE_IDS,
  "stage3Planner"
] as const;

export type Stage2CodexModelStageId = (typeof STAGE2_MODEL_STAGE_IDS)[number];
export type Stage2PromptCodexModelStageId = (typeof STAGE2_PROMPT_MODEL_STAGE_IDS)[number];
export type Stage2PipelineExecutionModelStageId =
  (typeof STAGE2_PIPELINE_EXECUTION_MODEL_STAGE_IDS)[number];
export type WorkspaceCodexModelStageId = (typeof WORKSPACE_CODEX_MODEL_STAGE_IDS)[number];

export type WorkspaceCodexModelConfig = Partial<Record<
  WorkspaceCodexModelStageId,
  WorkspaceCodexModelSetting
>>;
type NormalizedWorkspaceCodexModelConfig = Record<
  WorkspaceCodexModelStageId,
  WorkspaceCodexModelSetting
>;

export type ResolvedWorkspaceCodexModelConfig = Record<Stage2CodexModelStageId, string | null> & {
  stage3Planner: string;
};

export type WorkspaceCodexModelStageField = {
  id: WorkspaceCodexModelStageId;
  label: string;
  description: string;
  allowsImages: boolean;
};

export const STAGE2_PROMPT_MODEL_STAGE_FIELDS: readonly WorkspaceCodexModelStageField[] = [
  {
    id: "classicOneShot",
    label: "Classic one-shot",
    description:
      "Prompt-first caption generation for classic Top/Bottom templates. Receives all active examples.",
    allowsImages: true
  },
  {
    id: "storyOneShot",
    label: "Story one-shot",
    description:
      "Prompt-first caption generation for Lead/Main Caption templates. Receives all active examples.",
    allowsImages: true
  },
  {
    id: "oneShotReference",
    label: "Reference one-shot",
    description:
      "Продуктовый one-shot baseline для Stable Reference v6: сразу собирает финальные 5 publishable options без repair/backfill.",
    allowsImages: true
  },
  {
    id: "contextPacket",
    label: "Context packet",
    description: "Мультимодальный packet из кадров, title, transcript и comments.",
    allowsImages: true
  },
  {
    id: "candidateGenerator",
    label: "Candidate generator",
    description: "Текстовая генерация batch из 8 английских caption-кандидатов.",
    allowsImages: false
  },
  {
    id: "qualityCourt",
    label: "Quality court",
    description: "Строгий text-only judge, который режет слабые и synthetic варианты.",
    allowsImages: false
  },
  {
    id: "targetedRepair",
    label: "Targeted repair",
    description: "Текстовый repair только для near-miss кандидатов по briefs суда.",
    allowsImages: false
  },
  {
    id: "captionHighlighting",
    label: "Caption highlighting",
    description: "Текстовая разметка exact highlight spans для template-driven color slots.",
    allowsImages: false
  },
  {
    id: "captionTranslation",
    label: "Caption translation",
    description: "Текстовый перевод уже собранных 5 display options на русский с retry missing items.",
    allowsImages: false
  },
  {
    id: "titleWriter",
    label: "Title writer",
    description: "Текстовая генерация 5 bilingual title options для финального winner.",
    allowsImages: false
  },
  {
    id: "analyzer",
    label: "Legacy analyzer",
    description: "Старый мультимодальный Stage 2 analyzer для legacy/vnext совместимости.",
    allowsImages: true
  },
  {
    id: "selector",
    label: "Legacy selector",
    description: "Старый text-only selector для legacy/vnext совместимости.",
    allowsImages: false
  },
  {
    id: "writer",
    label: "Legacy writer",
    description: "Старый text-only writer для legacy/vnext совместимости.",
    allowsImages: false
  },
  {
    id: "critic",
    label: "Legacy critic",
    description: "Старый text-only critic для legacy/vnext совместимости.",
    allowsImages: false
  },
  {
    id: "rewriter",
    label: "Legacy rewriter",
    description: "Старый text-only rewriter для legacy/vnext совместимости.",
    allowsImages: false
  },
  {
    id: "finalSelector",
    label: "Legacy final selector",
    description: "Старый финальный селектор shortlist для legacy/vnext совместимости.",
    allowsImages: false
  },
  {
    id: "titles",
    label: "Legacy titles",
    description: "Старый title writer для legacy/vnext совместимости.",
    allowsImages: false
  },
  {
    id: "seo",
    label: "SEO",
    description: "Текстовая генерация description и tags для публикации.",
    allowsImages: false
  }
] as const;

export const STAGE2_AUX_MODEL_STAGE_FIELDS: readonly WorkspaceCodexModelStageField[] = [
  {
    id: "regenerate",
    label: "Quick regenerate",
    description: "Быстрая перегенерация видимого shortlist без полного pipeline.",
    allowsImages: false
  },
  {
    id: "styleDiscovery",
    label: "Style discovery",
    description: "Мультимодальный onboarding и bootstrap style profile по референсам.",
    allowsImages: true
  }
] as const;

export const STAGE3_MODEL_STAGE_FIELDS: readonly WorkspaceCodexModelStageField[] = [
  {
    id: "stage3Planner",
    label: "Stage 3 planner",
    description: "Модель автономного planner в Stage 3 для run, resume и optimize.",
    allowsImages: false
  }
] as const;

export const DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG: NormalizedWorkspaceCodexModelConfig = {
  classicOneShot: "deploy_default",
  storyOneShot: "deploy_default",
  oneShotReference: "deploy_default",
  analyzer: "deploy_default",
  contextPacket: "deploy_default",
  selector: "deploy_default",
  writer: "deploy_default",
  critic: "deploy_default",
  rewriter: "deploy_default",
  finalSelector: "deploy_default",
  titles: "deploy_default",
  seo: "deploy_default",
  candidateGenerator: "deploy_default",
  qualityCourt: "deploy_default",
  targetedRepair: "deploy_default",
  captionHighlighting: "deploy_default",
  captionTranslation: "deploy_default",
  titleWriter: "deploy_default",
  regenerate: "deploy_default",
  styleDiscovery: "deploy_default",
  stage3Planner: "deploy_default"
};

type LegacyWorkspaceCodexModelConfig = {
  stage2Pipeline?: unknown;
  stage2Seo?: unknown;
  stage3Planner?: unknown;
};

function hasOwnKey(value: unknown, key: string): boolean {
  return Boolean(value) && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);
}

function isWorkspaceCodexModel(value: unknown): value is WorkspaceCodexModel {
  return WORKSPACE_CODEX_MODEL_OPTIONS.some((option) => option.value === value);
}

export function isStage2MultimodalModelStage(
  value: WorkspaceCodexModelStageId
): value is (typeof STAGE2_MULTIMODAL_MODEL_STAGE_IDS)[number] {
  return (STAGE2_MULTIMODAL_MODEL_STAGE_IDS as readonly string[]).includes(value);
}

function normalizeModelSetting(value: unknown): WorkspaceCodexModelSetting {
  if (value === "deploy_default") {
    return "deploy_default";
  }
  return isWorkspaceCodexModel(value) ? value : "deploy_default";
}

function normalizeDeployModel(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

function sanitizeStageSetting(
  stageId: WorkspaceCodexModelStageId,
  setting: WorkspaceCodexModelSetting
): WorkspaceCodexModelSetting {
  if (isStage2MultimodalModelStage(stageId) && setting === SPARK_MODEL) {
    return "deploy_default";
  }
  return setting;
}

function sanitizeResolvedStageModel(
  stageId: Stage2CodexModelStageId,
  model: string | null
): string | null {
  if (isStage2MultimodalModelStage(stageId) && model === SPARK_MODEL) {
    return MULTIMODAL_FALLBACK_MODEL;
  }
  return model;
}

function readStageSettingCandidate(
  candidate: Partial<Record<WorkspaceCodexModelStageId, unknown>> & LegacyWorkspaceCodexModelConfig,
  stageId: WorkspaceCodexModelStageId
): unknown {
  if (hasOwnKey(candidate, stageId)) {
    return candidate[stageId];
  }
  if (stageId === "contextPacket") {
    if (hasOwnKey(candidate, "analyzer")) {
      return candidate.analyzer;
    }
    if (hasOwnKey(candidate, "selector")) {
      return candidate.selector;
    }
  }
  if (stageId === "oneShotReference") {
    if (hasOwnKey(candidate, "candidateGenerator")) {
      return candidate.candidateGenerator;
    }
    if (hasOwnKey(candidate, "contextPacket")) {
      return candidate.contextPacket;
    }
  }
  if (stageId === "classicOneShot" || stageId === "storyOneShot") {
    if (hasOwnKey(candidate, stageId)) {
      return candidate[stageId];
    }
    if (hasOwnKey(candidate, "oneShotReference")) {
      return candidate.oneShotReference;
    }
    if (hasOwnKey(candidate, "candidateGenerator")) {
      return candidate.candidateGenerator;
    }
    if (hasOwnKey(candidate, "contextPacket")) {
      return candidate.contextPacket;
    }
  }
  if (stageId === "candidateGenerator" && hasOwnKey(candidate, "writer")) {
    return candidate.writer;
  }
  if (stageId === "qualityCourt") {
    if (hasOwnKey(candidate, "critic")) {
      return candidate.critic;
    }
    if (hasOwnKey(candidate, "finalSelector")) {
      return candidate.finalSelector;
    }
  }
  if (stageId === "targetedRepair" && hasOwnKey(candidate, "rewriter")) {
    return candidate.rewriter;
  }
  if (stageId === "captionTranslation") {
    if (hasOwnKey(candidate, "titleWriter")) {
      return candidate.titleWriter;
    }
    if (hasOwnKey(candidate, "titles")) {
      return candidate.titles;
    }
  }
  if (stageId === "captionHighlighting") {
    if (hasOwnKey(candidate, "captionTranslation")) {
      return candidate.captionTranslation;
    }
    if (hasOwnKey(candidate, "titleWriter")) {
      return candidate.titleWriter;
    }
    if (hasOwnKey(candidate, "titles")) {
      return candidate.titles;
    }
  }
  if (stageId === "titleWriter" && hasOwnKey(candidate, "titles")) {
    return candidate.titles;
  }
  if (stageId === "seo") {
    if (hasOwnKey(candidate, "stage2Seo")) {
      return candidate.stage2Seo;
    }
    if (hasOwnKey(candidate, "stage2Pipeline")) {
      return candidate.stage2Pipeline;
    }
    return undefined;
  }
  if (stageId === "stage3Planner") {
    return candidate.stage3Planner;
  }
  if (hasOwnKey(candidate, "stage2Pipeline")) {
    return candidate.stage2Pipeline;
  }
  return undefined;
}

export function getWorkspaceCodexModelOptionsForStage(
  stageId: WorkspaceCodexModelStageId
): readonly { value: WorkspaceCodexModel; label: string }[] {
  if (!isStage2MultimodalModelStage(stageId)) {
    return WORKSPACE_CODEX_MODEL_OPTIONS;
  }
  return WORKSPACE_CODEX_MODEL_OPTIONS.filter((option) => option.value !== SPARK_MODEL);
}

export function normalizeWorkspaceCodexModelConfig(
  value: unknown
): NormalizedWorkspaceCodexModelConfig {
  const candidate = value && typeof value === "object"
    ? (value as Partial<Record<WorkspaceCodexModelStageId, unknown>> & LegacyWorkspaceCodexModelConfig)
    : {};
  return Object.fromEntries(
    WORKSPACE_CODEX_MODEL_STAGE_IDS.map((stageId) => [
      stageId,
      sanitizeStageSetting(
        stageId,
        normalizeModelSetting(readStageSettingCandidate(candidate, stageId))
      )
    ])
  ) as NormalizedWorkspaceCodexModelConfig;
}

export function parseWorkspaceCodexModelConfigJson(
  raw: string | null | undefined
): WorkspaceCodexModelConfig {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) {
    return DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG;
  }
  try {
    return normalizeWorkspaceCodexModelConfig(JSON.parse(trimmed));
  } catch {
    return DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG;
  }
}

export function stringifyWorkspaceCodexModelConfig(
  config: WorkspaceCodexModelConfig
): string {
  return JSON.stringify(normalizeWorkspaceCodexModelConfig(config));
}

export function summarizeResolvedStage2ModelUsage(input: {
  resolvedConfig: ResolvedWorkspaceCodexModelConfig;
  stageIds: readonly Stage2CodexModelStageId[];
}): string | null {
  const values = input.stageIds.map((stageId) => input.resolvedConfig[stageId] ?? "__default__");
  const uniqueValues = Array.from(new Set(values));
  if (uniqueValues.length !== 1) {
    return "per-stage policy";
  }
  return uniqueValues[0] === "__default__" ? null : uniqueValues[0];
}

export function resolveWorkspaceCodexModelConfig(input: {
  config: WorkspaceCodexModelConfig | null | undefined;
  deployStage2Model?: string | null;
  deployStage2SeoModel?: string | null;
  deployStage3Model?: string | null;
}): ResolvedWorkspaceCodexModelConfig {
  const normalized = normalizeWorkspaceCodexModelConfig(input.config);
  const deployStage2Model = normalizeDeployModel(input.deployStage2Model);
  const deployStage2SeoModel = normalizeDeployModel(input.deployStage2SeoModel);
  const deployStage3Model = normalizeDeployModel(input.deployStage3Model);

  const resolvedStage2Config = Object.fromEntries(
    STAGE2_MODEL_STAGE_IDS.map((stageId) => {
      const deployFallback =
        stageId === "seo" ? deployStage2SeoModel ?? deployStage2Model : deployStage2Model;
      const selectedModel =
        stageId === "classicOneShot"
          ? normalized.classicOneShot === "deploy_default"
            ? normalized.oneShotReference === "deploy_default"
              ? deployFallback
              : normalized.oneShotReference
            : normalized.classicOneShot
          : stageId === "storyOneShot"
            ? normalized.storyOneShot === "deploy_default"
              ? normalized.oneShotReference === "deploy_default"
                ? deployFallback
                : normalized.oneShotReference
              : normalized.storyOneShot
        : stageId === "oneShotReference"
          ? normalized.oneShotReference === "deploy_default"
            ? deployFallback
            : normalized.oneShotReference
          : stageId === "regenerate"
            ? normalized.regenerate === "deploy_default"
              ? normalized.oneShotReference === "deploy_default"
                ? deployFallback
                : normalized.oneShotReference
              : normalized.regenerate
            : deployFallback;
      return [stageId, sanitizeResolvedStageModel(stageId, selectedModel)];
    })
  ) as Record<Stage2CodexModelStageId, string | null>;

  return {
    ...resolvedStage2Config,
    stage3Planner:
      normalized.stage3Planner === "deploy_default"
        ? deployStage3Model ?? "gpt-5.2"
        : normalized.stage3Planner
  };
}
