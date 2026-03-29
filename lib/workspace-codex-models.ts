export const WORKSPACE_CODEX_MODEL_OPTIONS = [
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" }
] as const;

const SPARK_MODEL = "gpt-5.3-codex-spark";
const MULTIMODAL_FALLBACK_MODEL = "gpt-5.4";

export type WorkspaceCodexModel = (typeof WORKSPACE_CODEX_MODEL_OPTIONS)[number]["value"];
export type WorkspaceCodexModelSetting = WorkspaceCodexModel | "deploy_default";

export const STAGE2_MULTIMODAL_MODEL_STAGE_IDS = ["analyzer", "styleDiscovery"] as const;
export const STAGE2_TEXT_ONLY_MODEL_STAGE_IDS = [
  "selector",
  "writer",
  "critic",
  "rewriter",
  "finalSelector",
  "titles",
  "seo",
  "regenerate"
] as const;
export const STAGE2_PIPELINE_EXECUTION_MODEL_STAGE_IDS = [
  "analyzer",
  "selector",
  "writer",
  "critic",
  "rewriter",
  "finalSelector",
  "titles"
] as const;
export const STAGE2_PROMPT_MODEL_STAGE_IDS = [
  ...STAGE2_PIPELINE_EXECUTION_MODEL_STAGE_IDS,
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

export type WorkspaceCodexModelConfig = Record<
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
    id: "analyzer",
    label: "Анализ видео",
    description: "Мультимодальный разбор sampled frames, title, transcript и комментариев.",
    allowsImages: true
  },
  {
    id: "selector",
    label: "Выбор угла",
    description: "Текстовый селектор angle, clip type и релевантных examples.",
    allowsImages: false
  },
  {
    id: "writer",
    label: "Черновики",
    description: "Текстовый writer, который пишет основной пул caption options.",
    allowsImages: false
  },
  {
    id: "critic",
    label: "Скоринг",
    description: "Текстовый critic для оценки и отсечения слабых кандидатов.",
    allowsImages: false
  },
  {
    id: "rewriter",
    label: "Переписывание",
    description: "Текстовый rewriter, который шлифует финалистов без потери ограничений.",
    allowsImages: false
  },
  {
    id: "finalSelector",
    label: "Шортлист",
    description: "Текстовый финальный селектор shortlist и recommended pick.",
    allowsImages: false
  },
  {
    id: "titles",
    label: "Заголовки",
    description: "Текстовая генерация title options для shortlist.",
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

export const DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG: WorkspaceCodexModelConfig = {
  analyzer: "deploy_default",
  selector: "deploy_default",
  writer: "deploy_default",
  critic: "deploy_default",
  rewriter: "deploy_default",
  finalSelector: "deploy_default",
  titles: "deploy_default",
  seo: "deploy_default",
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
): WorkspaceCodexModelConfig {
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
  ) as WorkspaceCodexModelConfig;
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
        normalized[stageId] === "deploy_default" ? deployFallback : normalized[stageId];
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
