import {
  STAGE2_DEFAULT_REASONING_EFFORTS,
  STAGE2_DEFAULT_STAGE_PROMPTS,
  STAGE2_PROMPT_STAGE_IDS,
  Stage2PromptConfigStageId,
  Stage2ReasoningEffort
} from "./stage2-prompt-specs";
import {
  isReferenceOneShotExecutionMode,
  resolveStage2WorkerProfile
} from "./stage2-worker-profile";
import {
  DEFAULT_STAGE2_SYSTEM_PROMPT_PRESET_ID,
  findStage2SystemPromptPresetByPrompt,
  getStage2SystemPromptPreset,
  isStage2SystemPromptPresetId,
  type Stage2SystemPromptPresetId
} from "./stage2-system-presets";

export {
  STAGE2_DEFAULT_REASONING_EFFORTS,
  STAGE2_DEFAULT_STAGE_PROMPTS,
  STAGE2_PROMPT_STAGE_IDS,
  STAGE2_REASONING_EFFORT_OPTIONS
} from "./stage2-prompt-specs";
export type { Stage2PromptConfigStageId, Stage2ReasoningEffort } from "./stage2-prompt-specs";

export const STAGE2_PROMPT_CONFIG_VERSION = 5 as const;
export const STAGE2_PROMPT_COMPATIBILITY_FAMILY_LEGACY = "stage2_legacy";
export const STAGE2_PROMPT_COMPATIBILITY_FAMILY_NATIVE = "native_caption_v3";
export const STAGE2_LEGACY_PROMPT_BUNDLE_VERSION = "stage2_legacy@2026-04-01";
export const STAGE2_NATIVE_PROMPT_BUNDLE_VERSION =
  "native_caption_v3@2026-04-07-caption-highlighting";

export type Stage2PromptCompatibilityFamily =
  | typeof STAGE2_PROMPT_COMPATIBILITY_FAMILY_LEGACY
  | typeof STAGE2_PROMPT_COMPATIBILITY_FAMILY_NATIVE;

export type Stage2PromptCompatibility = {
  family: Stage2PromptCompatibilityFamily;
  bundleVersion: string;
  defaultPromptHash: string;
};

const STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS = [
  {
    id: "oneShotReference",
    label: "Running one-shot reference baseline",
    shortLabel: "One-shot",
    description:
      "Configurable one-shot prompt reads video truth, bounded comments hints, examples, template semantics, hard constraints, and user instruction in one pass.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "contextPacket",
    label: "Building context packet",
    shortLabel: "Контекст",
    description: "Собираем observed fact, uncertainty, audience wave и lane strategy в единый packet.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "candidateGenerator",
    label: "Generating lane batch",
    shortLabel: "Кандидаты",
    description: "Writer генерирует ровно 8 кандидатов по lane plan без generic safe sludge.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "hardValidator",
    label: "Running hard validator",
    shortLabel: "Валидатор",
    description: "Детерминированно режем все объективно невалидные кандидаты до редакторского выбора.",
    promptConfigurable: false,
    promptStageType: "deterministic"
  },
  {
    id: "qualityCourt",
    label: "Running editorial court",
    shortLabel: "Суд",
    description: "Редакторский court выбирает finalists, display-safe extras и recovery plan.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "targetedRepair",
    label: "Running targeted recovery",
    shortLabel: "Recovery",
    description: "Генерируем только недостающие варианты по recovery briefs, без полного рерана.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "templateBackfill",
    label: "Applying template backfill",
    shortLabel: "Backfill",
    description: "Детерминированный template backfill гарантирует 5 валидных display options при деградации.",
    promptConfigurable: false,
    promptStageType: "deterministic"
  },
  {
    id: "captionHighlighting",
    label: "Tagging caption highlights",
    shortLabel: "Подсветка",
    description: "Размечаем точные spans для template-driven color highlighting без изменения текста.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "captionTranslation",
    label: "Translating display captions",
    shortLabel: "Перевод",
    description: "Переводим все 5 display options на русский с одним retry только для missing items.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "titleWriter",
    label: "Writing winner titles",
    shortLabel: "Тайтлы",
    description: "Пишем 5 bilingual title options только для финального winner-кандидата.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "assemble",
    label: "Assembling result",
    shortLabel: "Сборка",
    description:
      "Собираем совместимый Stage 2 output, приводим bilingual поля к финальному виду и сохраняем diagnostics.",
    promptConfigurable: false,
    promptStageType: "deterministic"
  }
] as const;

const STAGE2_NATIVE_REFERENCE_ONE_SHOT_PROGRESS_STAGES = [
  {
    id: "oneShotReference",
    label: "Running one-shot reference baseline",
    shortLabel: "One-shot",
    description:
      "Product-owned one-shot baseline extracts analysis, options, and winner ranking in one pass."
  },
  {
    id: "captionHighlighting",
    label: "Tagging caption highlights",
    shortLabel: "Подсветка",
    description: "Размечаем точные spans для финального shortlist без изменения текста."
  },
  {
    id: "captionTranslation",
    label: "Translating display captions",
    shortLabel: "Перевод",
    description: "Переводим display shortlist на русский с fallback для missing items."
  },
  {
    id: "assemble",
    label: "Assembling result",
    shortLabel: "Сборка",
    description: "Собираем итоговый совместимый Stage 2 output и diagnostics."
  }
] as const;

const STAGE2_LEGACY_PIPELINE_STAGE_DEFINITIONS = [
  {
    id: "analyzer",
    label: "Analyzing video",
    shortLabel: "Анализ видео",
    description: "Кадры, title и комментарии собираются в первичный разбор.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "selector",
    label: "Selecting clip angle",
    shortLabel: "Выбор угла",
    description: "LLM выбирает angle, clip type и релевантные examples из доступного corpus.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "writer",
    label: "Drafting 20 options",
    shortLabel: "Черновики",
    description: "Writer пишет 20 overlay-кандидатов под выбранные angle.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "critic",
    label: "Critic scoring",
    shortLabel: "Скоринг",
    description: "Critic оценивает кандидатов и режет слабые варианты.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "rewriter",
    label: "Rewriting finalists",
    shortLabel: "Переписывание",
    description: "Лучшие варианты переписываются в более sharp форму.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "finalSelector",
    label: "Selecting shortlist",
    shortLabel: "Шортлист",
    description: "Финальный селектор собирает shortlist для human pick.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "titles",
    label: "Generating titles",
    shortLabel: "Заголовки",
    description: "Генерируем отдельные title options для shortlist.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "seo",
    label: "Generating SEO",
    shortLabel: "SEO",
    description: "Собираем описание и tags для публикации.",
    promptConfigurable: true,
    promptStageType: "llm"
  }
] as const;

export const STAGE2_PIPELINE_STAGES = [
  ...STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS,
  ...STAGE2_LEGACY_PIPELINE_STAGE_DEFINITIONS
] as const;

const STAGE2_REGENERATE_STAGE_DEFINITIONS = [
  {
    id: "base",
    label: "Loading base run",
    shortLabel: "База",
    description: "Берём текущий сохранённый Stage 2 run как основу для быстрой правки."
  },
  {
    id: "regenerate",
    label: "Quick regenerate",
    shortLabel: "Перегенерация",
    description: "Один LLM-запрос быстро переписывает текущие visible options."
  },
  {
    id: "assemble",
    label: "Assembling result",
    shortLabel: "Сборка",
    description: "Нормализуем output, проверяем ограничения и сохраняем новый run."
  }
] as const;

export const STAGE2_REGENERATE_PROGRESS_STAGES = STAGE2_REGENERATE_STAGE_DEFINITIONS;

export type Stage2PipelineStageId = (typeof STAGE2_PIPELINE_STAGES)[number]["id"];
export type Stage2RegenerateStageId = (typeof STAGE2_REGENERATE_PROGRESS_STAGES)[number]["id"];
export type Stage2ProgressStageId = Stage2PipelineStageId | Stage2RegenerateStageId;

export type Stage2PromptStageConfig = {
  prompt: string;
  reasoningEffort: Stage2ReasoningEffort;
  compatibility: Stage2PromptCompatibility | null;
};

export type Stage2PromptSourceMode = "system" | "custom";

export type Stage2PromptConfig = {
  version: typeof STAGE2_PROMPT_CONFIG_VERSION;
  useWorkspaceDefault?: boolean;
  sourceMode?: Stage2PromptSourceMode;
  systemPresetId?: Stage2SystemPromptPresetId;
  stages: Record<Stage2PromptConfigStageId, Stage2PromptStageConfig>;
};

export type Stage2ProgressStatus = "queued" | "running" | "completed" | "failed";

export type Stage2ProgressStepState = "pending" | "running" | "completed" | "failed";

export type Stage2ProgressStep = {
  id: Stage2ProgressStageId;
  label: string;
  shortLabel: string;
  description: string;
  status: Stage2ProgressStepState;
  state: Stage2ProgressStepState;
  summary: string | null;
  detail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  promptChars: number | null;
  reasoningEffort: string | null;
};

export type Stage2ProgressSnapshot = {
  runId: string;
  status: Stage2ProgressStatus;
  activeStageId: Stage2ProgressStageId | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  error: string | null;
  steps: Stage2ProgressStep[];
};

type Stage2ProgressStepPatch = Partial<
  Pick<Stage2ProgressStep, "summary" | "detail" | "promptChars" | "reasoningEffort" | "durationMs">
>;

type Stage2ProgressStageDefinition = {
  id: Stage2ProgressStageId;
  label: string;
  shortLabel: string;
  description: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export const DEFAULT_STAGE2_PROMPT_CONFIG: Stage2PromptConfig = {
  version: STAGE2_PROMPT_CONFIG_VERSION,
  sourceMode: "system",
  systemPresetId: DEFAULT_STAGE2_SYSTEM_PROMPT_PRESET_ID,
  stages: Object.fromEntries(
    STAGE2_PROMPT_STAGE_IDS.map((stageId) => [
      stageId,
      {
        prompt: STAGE2_DEFAULT_STAGE_PROMPTS[stageId],
        reasoningEffort: STAGE2_DEFAULT_REASONING_EFFORTS[stageId],
        compatibility: getStage2DefaultPromptCompatibility(stageId)
      }
    ])
  ) as Record<Stage2PromptConfigStageId, Stage2PromptStageConfig>
};

export function listStage2PromptConfigStages(): Array<{
  id: Stage2PromptConfigStageId;
  label: string;
  shortLabel: string;
  description: string;
  promptStageType: "llm" | "deterministic";
}> {
  return STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS.filter((stage) => stage.id === "oneShotReference").map((stage) => ({
    id: stage.id as Stage2PromptConfigStageId,
    label: stage.label,
    shortLabel: stage.shortLabel,
    description:
      "Единственный редактируемый Stage 2 prompt: video-first stable one-shot baseline.",
    promptStageType: stage.promptStageType
  }));
}

function isRegenerateMode(value: string | null | undefined): boolean {
  return value === "regenerate";
}

function resolveStage2ProgressDefinitions(
  mode?: string | null,
  stepCandidates?: Record<string, unknown>[],
  workerProfileId?: string | null
): readonly Stage2ProgressStageDefinition[] {
  if (isRegenerateMode(mode)) {
    return STAGE2_REGENERATE_PROGRESS_STAGES;
  }

  if (stepCandidates && stepCandidates.length > 0) {
    const candidateIds = new Set(
      stepCandidates
        .map((step) => (typeof step.id === "string" ? step.id.trim() : ""))
        .filter(Boolean)
    );
    if (
      Array.from(candidateIds).some((id) =>
        STAGE2_REGENERATE_PROGRESS_STAGES.some((stage) => stage.id === id)
      ) &&
      !Array.from(candidateIds).some((id) => STAGE2_PIPELINE_STAGES.some((stage) => stage.id === id))
    ) {
      return STAGE2_REGENERATE_PROGRESS_STAGES;
    }
  }

  if (stepCandidates && stepCandidates.length > 0) {
    const candidateIds = new Set(
      stepCandidates
        .map((step) => (typeof step.id === "string" ? step.id.trim() : ""))
        .filter(Boolean)
    );
    if (
      Array.from(candidateIds).some((id) =>
        STAGE2_NATIVE_REFERENCE_ONE_SHOT_PROGRESS_STAGES.some((stage) => stage.id === id)
      ) &&
      !Array.from(candidateIds).some((id) =>
        ["contextPacket", "candidateGenerator", "qualityCourt", "targetedRepair", "titleWriter"].includes(id)
      )
    ) {
      return STAGE2_NATIVE_REFERENCE_ONE_SHOT_PROGRESS_STAGES;
    }
    if (
      Array.from(candidateIds).some((id) =>
        STAGE2_LEGACY_PIPELINE_STAGE_DEFINITIONS.some((stage) => stage.id === id)
      ) &&
      !Array.from(candidateIds).some((id) =>
        STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS.some((stage) => stage.id === id)
      )
    ) {
      return STAGE2_LEGACY_PIPELINE_STAGE_DEFINITIONS;
    }
  }

  if (
    workerProfileId !== undefined &&
    isReferenceOneShotExecutionMode(resolveStage2WorkerProfile(workerProfileId).executionMode)
  ) {
    return STAGE2_NATIVE_REFERENCE_ONE_SHOT_PROGRESS_STAGES;
  }

  return STAGE2_NATIVE_REFERENCE_ONE_SHOT_PROGRESS_STAGES;
}

export function getStage2ProgressStartStageId(
  mode?: string | null,
  workerProfileId?: string | null
): Stage2ProgressStageId {
  return resolveStage2ProgressDefinitions(mode, undefined, workerProfileId)[0]?.id ?? "oneShotReference";
}

function sanitizePrompt(value: unknown, fallback: string): string {
  const normalized =
    typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  return normalized || fallback;
}

function sanitizeLegacyPrompt(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

export function computeStage2PromptHash(prompt: string): string {
  let hash = 2166136261;
  for (let index = 0; index < prompt.length; index += 1) {
    hash ^= prompt.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function isNativeStage2PromptStage(stageId: Stage2PromptConfigStageId): boolean {
  return STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS.some((stage) => stage.id === stageId);
}

export function getStage2PromptCompatibilityFamily(
  stageId: Stage2PromptConfigStageId
): Stage2PromptCompatibilityFamily {
  return isNativeStage2PromptStage(stageId)
    ? STAGE2_PROMPT_COMPATIBILITY_FAMILY_NATIVE
    : STAGE2_PROMPT_COMPATIBILITY_FAMILY_LEGACY;
}

export function getStage2PromptBundleVersion(stageId: Stage2PromptConfigStageId): string {
  return isNativeStage2PromptStage(stageId)
    ? STAGE2_NATIVE_PROMPT_BUNDLE_VERSION
    : STAGE2_LEGACY_PROMPT_BUNDLE_VERSION;
}

export function getStage2DefaultPromptCompatibility(
  stageId: Stage2PromptConfigStageId
): Stage2PromptCompatibility {
  return {
    family: getStage2PromptCompatibilityFamily(stageId),
    bundleVersion: getStage2PromptBundleVersion(stageId),
    defaultPromptHash: computeStage2PromptHash(STAGE2_DEFAULT_STAGE_PROMPTS[stageId])
  };
}

function normalizePromptCompatibility(
  _stageId: Stage2PromptConfigStageId,
  value: unknown
): Stage2PromptCompatibility | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<Stage2PromptCompatibility>;
  const family =
    candidate.family === STAGE2_PROMPT_COMPATIBILITY_FAMILY_NATIVE ||
    candidate.family === STAGE2_PROMPT_COMPATIBILITY_FAMILY_LEGACY
      ? candidate.family
      : null;
  const bundleVersion =
    typeof candidate.bundleVersion === "string" && candidate.bundleVersion.trim()
      ? candidate.bundleVersion.trim()
      : null;
  const defaultPromptHash =
    typeof candidate.defaultPromptHash === "string" && candidate.defaultPromptHash.trim()
      ? candidate.defaultPromptHash.trim()
      : null;
  if (!family || !bundleVersion || !defaultPromptHash) {
    return null;
  }
  return {
    family,
    bundleVersion,
    defaultPromptHash
  };
}

export function getStage2PromptOverrideCompatibility(input: {
  stageId: Stage2PromptConfigStageId;
  stageConfig: Stage2PromptStageConfig | null | undefined;
}):
  | {
      accepted: true;
      family: Stage2PromptCompatibilityFamily;
      bundleVersion: string;
      defaultPromptHash: string;
      reason: null;
    }
  | {
      accepted: false;
      family: Stage2PromptCompatibilityFamily;
      bundleVersion: string | null;
      defaultPromptHash: string | null;
      reason: string | null;
    } {
  const expected = getStage2DefaultPromptCompatibility(input.stageId);
  const stageConfig = input.stageConfig;
  if (!stageConfig) {
    return {
      accepted: false,
      family: expected.family,
      bundleVersion: null,
      defaultPromptHash: null,
      reason: null
    };
  }
  const isDefaultPrompt = stageConfig.prompt === STAGE2_DEFAULT_STAGE_PROMPTS[input.stageId];
  const isDefaultReasoning =
    stageConfig.reasoningEffort === STAGE2_DEFAULT_REASONING_EFFORTS[input.stageId];
  if (!isNativeStage2PromptStage(input.stageId)) {
    return {
      accepted: true,
      family: expected.family,
      bundleVersion: stageConfig.compatibility?.bundleVersion ?? expected.bundleVersion,
      defaultPromptHash: stageConfig.compatibility?.defaultPromptHash ?? expected.defaultPromptHash,
      reason: null
    };
  }
  if (isDefaultPrompt && isDefaultReasoning) {
    return {
      accepted: true,
      family: expected.family,
      bundleVersion: expected.bundleVersion,
      defaultPromptHash: expected.defaultPromptHash,
      reason: null
    };
  }
  if (!stageConfig.compatibility) {
    return {
      accepted: false,
      family: expected.family,
      bundleVersion: null,
      defaultPromptHash: null,
      reason: "missing_native_compatibility_metadata"
    };
  }
  if (stageConfig.compatibility.family !== expected.family) {
    return {
      accepted: false,
      family: stageConfig.compatibility.family,
      bundleVersion: stageConfig.compatibility.bundleVersion,
      defaultPromptHash: stageConfig.compatibility.defaultPromptHash,
      reason: "stage_family_mismatch"
    };
  }
  if (stageConfig.compatibility.bundleVersion !== expected.bundleVersion) {
    return {
      accepted: false,
      family: stageConfig.compatibility.family,
      bundleVersion: stageConfig.compatibility.bundleVersion,
      defaultPromptHash: stageConfig.compatibility.defaultPromptHash,
      reason: "bundle_version_mismatch"
    };
  }
  if (stageConfig.compatibility.defaultPromptHash !== expected.defaultPromptHash) {
    return {
      accepted: false,
      family: stageConfig.compatibility.family,
      bundleVersion: stageConfig.compatibility.bundleVersion,
      defaultPromptHash: stageConfig.compatibility.defaultPromptHash,
      reason: "default_prompt_hash_mismatch"
    };
  }
  return {
    accepted: true,
    family: stageConfig.compatibility.family,
    bundleVersion: stageConfig.compatibility.bundleVersion,
    defaultPromptHash: stageConfig.compatibility.defaultPromptHash,
    reason: null
  };
}

function normalizeReasoningEffort(
  value: unknown,
  fallback: Stage2ReasoningEffort
): Stage2ReasoningEffort {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
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

export function normalizeStage2PromptConfig(input: unknown): Stage2PromptConfig {
  const candidate =
    input && typeof input === "object" ? (input as Partial<Stage2PromptConfig>) : undefined;
  const stagesCandidate =
    candidate?.stages && typeof candidate.stages === "object"
      ? (candidate.stages as Partial<
          Record<
            Stage2PromptConfigStageId,
            Partial<
              Stage2PromptStageConfig & {
                templateOverride?: unknown;
                guidance?: unknown;
                template?: unknown;
                compatibility?: unknown;
              }
            >
          >
        >)
      : undefined;

  const oneShotCandidate = stagesCandidate?.oneShotReference;
  const candidatePrompt = sanitizePrompt(
    oneShotCandidate?.prompt,
    STAGE2_DEFAULT_STAGE_PROMPTS.oneShotReference
  );
  const inferredPresetId =
    (isStage2SystemPromptPresetId((candidate as { systemPresetId?: unknown } | undefined)?.systemPresetId)
      ? ((candidate as { systemPresetId: Stage2SystemPromptPresetId }).systemPresetId)
      : findStage2SystemPromptPresetByPrompt(candidatePrompt)) ??
    DEFAULT_STAGE2_SYSTEM_PROMPT_PRESET_ID;
  const candidateSourceMode = (candidate as { sourceMode?: unknown } | undefined)?.sourceMode;
  const promptMatchesSystemPreset = Boolean(findStage2SystemPromptPresetByPrompt(candidatePrompt));
  const sourceMode: Stage2PromptSourceMode =
    candidateSourceMode === "custom"
      ? "custom"
      : candidateSourceMode === "system" ||
          promptMatchesSystemPreset ||
          candidatePrompt === STAGE2_DEFAULT_STAGE_PROMPTS.oneShotReference
        ? "system"
        : "custom";
  const useWorkspaceDefault =
    typeof (candidate as { useWorkspaceDefault?: unknown } | undefined)?.useWorkspaceDefault === "boolean"
      ? Boolean((candidate as { useWorkspaceDefault: boolean }).useWorkspaceDefault)
      : undefined;

  const stages = Object.fromEntries(
    STAGE2_PROMPT_STAGE_IDS.map((stageId) => {
      const stageCandidate = stagesCandidate?.[stageId];
      const defaultPrompt =
        stageId === "oneShotReference" && sourceMode === "system"
          ? getStage2SystemPromptPreset(inferredPresetId).prompt
          : STAGE2_DEFAULT_STAGE_PROMPTS[stageId];
      const legacyTemplateOverride = sanitizeLegacyPrompt(stageCandidate?.templateOverride);
      const legacyGuidance = sanitizeLegacyPrompt(stageCandidate?.guidance);
      const legacyTemplate = sanitizeLegacyPrompt(stageCandidate?.template);
      const prompt = sanitizePrompt(
        stageCandidate?.prompt ??
          [
            legacyTemplateOverride || legacyTemplate || defaultPrompt,
            legacyGuidance
          ]
            .filter(Boolean)
            .join("\n\n"),
        defaultPrompt
      );
      return [
        stageId,
        {
          prompt,
          reasoningEffort: normalizeReasoningEffort(
            stageCandidate?.reasoningEffort,
            STAGE2_DEFAULT_REASONING_EFFORTS[stageId]
          ),
          compatibility:
            normalizePromptCompatibility(stageId, stageCandidate?.compatibility) ??
            (prompt === defaultPrompt &&
            normalizeReasoningEffort(
              stageCandidate?.reasoningEffort,
              STAGE2_DEFAULT_REASONING_EFFORTS[stageId]
            ) === STAGE2_DEFAULT_REASONING_EFFORTS[stageId]
              ? getStage2DefaultPromptCompatibility(stageId)
              : null)
        }
      ];
    })
  ) as Record<Stage2PromptConfigStageId, Stage2PromptStageConfig>;

  return {
    version: STAGE2_PROMPT_CONFIG_VERSION,
    ...(useWorkspaceDefault === undefined ? {} : { useWorkspaceDefault }),
    sourceMode,
    systemPresetId: inferredPresetId,
    stages
  };
}

export function parseStage2PromptConfigJson(raw: string | null | undefined): Stage2PromptConfig {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) {
    return DEFAULT_STAGE2_PROMPT_CONFIG;
  }
  try {
    return normalizeStage2PromptConfig(JSON.parse(trimmed));
  } catch {
    return DEFAULT_STAGE2_PROMPT_CONFIG;
  }
}

export function stringifyStage2PromptConfig(config: Stage2PromptConfig): string {
  return JSON.stringify(normalizeStage2PromptConfig(config));
}

export function prepareStage2PromptConfigForExplicitSave(input: {
  nextConfig: Stage2PromptConfig;
  previousConfig?: Stage2PromptConfig | null;
}): Stage2PromptConfig {
  const nextConfig = normalizeStage2PromptConfig(input.nextConfig);
  const previousConfig = input.previousConfig ? normalizeStage2PromptConfig(input.previousConfig) : null;
  const stages = Object.fromEntries(
    STAGE2_PROMPT_STAGE_IDS.map((stageId) => {
      const nextStage = nextConfig.stages[stageId];
      const previousStage = previousConfig?.stages[stageId] ?? null;
      const defaultPrompt = STAGE2_DEFAULT_STAGE_PROMPTS[stageId];
      const defaultReasoning = STAGE2_DEFAULT_REASONING_EFFORTS[stageId];
      const usesDefault =
        nextStage.prompt === defaultPrompt && nextStage.reasoningEffort === defaultReasoning;
      const changedFromPrevious =
        !previousStage ||
        nextStage.prompt !== previousStage.prompt ||
        nextStage.reasoningEffort !== previousStage.reasoningEffort;
      if (!isNativeStage2PromptStage(stageId)) {
        return [stageId, nextStage];
      }
      if (usesDefault || changedFromPrevious) {
        return [
          stageId,
          {
            ...nextStage,
            compatibility: getStage2DefaultPromptCompatibility(stageId)
          }
        ];
      }
      return [stageId, nextStage];
    })
  ) as Record<Stage2PromptConfigStageId, Stage2PromptStageConfig>;
  return {
    version: STAGE2_PROMPT_CONFIG_VERSION,
    ...(nextConfig.useWorkspaceDefault === undefined
      ? {}
      : { useWorkspaceDefault: nextConfig.useWorkspaceDefault }),
    sourceMode: nextConfig.sourceMode,
    systemPresetId: nextConfig.systemPresetId,
    stages
  };
}

export function resetIncompatibleNativeStage2PromptOverrides(config: Stage2PromptConfig): {
  config: Stage2PromptConfig;
  removedStageIds: Stage2PromptConfigStageId[];
} {
  const normalized = normalizeStage2PromptConfig(config);
  const removedStageIds: Stage2PromptConfigStageId[] = [];
  const stages = Object.fromEntries(
    STAGE2_PROMPT_STAGE_IDS.map((stageId) => {
      const stage = normalized.stages[stageId];
      const compatibility = getStage2PromptOverrideCompatibility({
        stageId,
        stageConfig: stage
      });
      if (!isNativeStage2PromptStage(stageId) || compatibility.accepted) {
        return [stageId, stage];
      }
      removedStageIds.push(stageId);
      return [
        stageId,
        {
          prompt: STAGE2_DEFAULT_STAGE_PROMPTS[stageId],
          reasoningEffort: STAGE2_DEFAULT_REASONING_EFFORTS[stageId],
          compatibility: getStage2DefaultPromptCompatibility(stageId)
        }
      ];
    })
  ) as Record<Stage2PromptConfigStageId, Stage2PromptStageConfig>;
  return {
    config: {
      version: STAGE2_PROMPT_CONFIG_VERSION,
      stages
    },
    removedStageIds
  };
}

export function hasStage2PromptOverrides(config: Stage2PromptConfig): boolean {
  const normalized = normalizeStage2PromptConfig(config);
  if (normalized.useWorkspaceDefault === false) {
    return true;
  }
  return STAGE2_PROMPT_STAGE_IDS.some((stageId) => {
    const stage = normalized.stages[stageId];
    const compatibility = getStage2PromptOverrideCompatibility({
      stageId,
      stageConfig: stage
    });
    if (isNativeStage2PromptStage(stageId) && !compatibility.accepted) {
      return false;
    }
    return (
      stage.prompt !== STAGE2_DEFAULT_STAGE_PROMPTS[stageId] ||
      stage.reasoningEffort !== STAGE2_DEFAULT_REASONING_EFFORTS[stageId]
    );
  });
}

export function resolveEffectiveStage2PromptConfig(input: {
  workspacePromptConfig: Stage2PromptConfig;
  channelPromptConfig?: Stage2PromptConfig | null;
}): Stage2PromptConfig {
  const workspacePromptConfig = normalizeStage2PromptConfig(input.workspacePromptConfig);
  const channelPromptConfig = input.channelPromptConfig
    ? normalizeStage2PromptConfig(input.channelPromptConfig)
    : null;
  return channelPromptConfig?.useWorkspaceDefault === false
    ? channelPromptConfig
    : workspacePromptConfig;
}

export function createStage2ProgressSnapshot(
  runId: string,
  mode: string | null | undefined = "manual",
  options?: { workerProfileId?: string | null }
): Stage2ProgressSnapshot {
  const timestamp = nowIso();
  const stageDefinitions = resolveStage2ProgressDefinitions(mode, undefined, options?.workerProfileId);
  return {
    runId,
    status: "queued",
    activeStageId: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    error: null,
    steps: stageDefinitions.map((stage) => ({
      id: stage.id,
      label: stage.label,
      shortLabel: stage.shortLabel,
      description: stage.description,
      status: "pending" as const,
      state: "pending" as const,
      summary: null,
      detail: null,
      startedAt: null,
      finishedAt: null,
      completedAt: null,
      durationMs: null,
      promptChars: null,
      reasoningEffort: null
    }))
  };
}

function normalizeProgressTimestamp(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProgressNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeProgressState(value: unknown): Stage2ProgressStepState | null {
  return value === "pending" || value === "running" || value === "completed" || value === "failed"
    ? value
    : null;
}

function summarizeProgressDetail(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const firstMeaningfulLine =
    value
      .split("\n")
      .map((item) => item.trim())
      .find(Boolean) ?? value.trim();
  if (!firstMeaningfulLine) {
    return null;
  }
  if (firstMeaningfulLine.length <= 140) {
    return firstMeaningfulLine;
  }
  return `${firstMeaningfulLine.slice(0, 139).trimEnd()}…`;
}

function patchStep(step: Stage2ProgressStep, patch?: Stage2ProgressStepPatch): Stage2ProgressStep {
  if (!patch) {
    return step;
  }
  const nextDetail = patch.detail !== undefined ? patch.detail : step.detail;
  const nextSummary =
    patch.summary !== undefined ? patch.summary : summarizeProgressDetail(nextDetail) ?? step.summary;
  return {
    ...step,
    detail: nextDetail,
    summary: nextSummary,
    promptChars: patch.promptChars !== undefined ? patch.promptChars : step.promptChars,
    reasoningEffort:
      patch.reasoningEffort !== undefined ? patch.reasoningEffort : step.reasoningEffort,
    durationMs: patch.durationMs !== undefined ? patch.durationMs : step.durationMs
  };
}

export function markStage2ProgressStageRunning(
  snapshot: Stage2ProgressSnapshot,
  stageId: Stage2ProgressStageId,
  patch?: Stage2ProgressStepPatch
): Stage2ProgressSnapshot {
  const timestamp = nowIso();
  return {
    ...snapshot,
    status: "running",
    activeStageId: stageId,
    updatedAt: timestamp,
    error: null,
    steps: snapshot.steps.map((step) =>
      step.id === stageId
        ? patchStep(
            {
              ...step,
              status: "running",
              state: "running",
              startedAt: step.startedAt ?? timestamp,
              finishedAt: null,
              completedAt: null
            },
            patch
          )
        : step
    )
  };
}

export function markStage2ProgressStageCompleted(
  snapshot: Stage2ProgressSnapshot,
  stageId: Stage2ProgressStageId,
  patch?: Stage2ProgressStepPatch
): Stage2ProgressSnapshot {
  const timestamp = nowIso();
  return {
    ...snapshot,
    status: "running",
    activeStageId: snapshot.activeStageId === stageId ? null : snapshot.activeStageId,
    updatedAt: timestamp,
    steps: snapshot.steps.map((step) =>
      step.id === stageId
        ? patchStep(
            {
              ...step,
              status: "completed",
              state: "completed",
              startedAt: step.startedAt ?? timestamp,
              finishedAt: timestamp,
              completedAt: timestamp
            },
            patch
          )
        : step
    )
  };
}

export function markStage2ProgressStageFailed(
  snapshot: Stage2ProgressSnapshot,
  stageId: Stage2ProgressStageId,
  error: string,
  patch?: Stage2ProgressStepPatch
): Stage2ProgressSnapshot {
  const timestamp = nowIso();
  return {
    ...snapshot,
    status: "failed",
    activeStageId: stageId,
    updatedAt: timestamp,
    finishedAt: timestamp,
    error,
    steps: snapshot.steps.map((step) =>
      step.id === stageId
        ? patchStep(
            {
              ...step,
              status: "failed",
              state: "failed",
              summary: summarizeProgressDetail(error),
              detail: error,
              startedAt: step.startedAt ?? timestamp,
              finishedAt: timestamp,
              completedAt: timestamp
            },
            patch
          )
        : step
    )
  };
}

export function finalizeStage2ProgressSuccess(snapshot: Stage2ProgressSnapshot): Stage2ProgressSnapshot {
  const timestamp = nowIso();
  return {
    ...snapshot,
    status: "completed",
    activeStageId: null,
    updatedAt: timestamp,
    finishedAt: timestamp,
    error: null,
    steps: snapshot.steps.map((step) =>
      step.state === "completed"
        ? {
            ...step,
            status: "completed",
            summary: step.summary ?? summarizeProgressDetail(step.detail),
            finishedAt: step.finishedAt ?? step.completedAt ?? timestamp,
            completedAt: step.completedAt ?? step.finishedAt ?? timestamp
          }
        : step
    )
  };
}

export function resetStage2ProgressForRetry(
  snapshot: Stage2ProgressSnapshot,
  detail?: string | null,
  mode: string | null | undefined = "manual",
  workerProfileId?: string | null
): Stage2ProgressSnapshot {
  const restarted = createStage2ProgressSnapshot(snapshot.runId, mode, {
    workerProfileId
  });
  if (!detail) {
    return restarted;
  }

  return {
    ...restarted,
    steps: restarted.steps.map((step) =>
      step.id === getStage2ProgressStartStageId(mode, workerProfileId)
        ? {
            ...step,
            summary: summarizeProgressDetail(detail),
            detail
          }
        : step
    )
  };
}

export function normalizeStage2ProgressSnapshot(
  input: unknown,
  runId: string,
  mode: string | null | undefined = "manual"
): Stage2ProgressSnapshot {
  const candidate =
    input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  const rootStatus =
    candidate?.status === "queued" ||
    candidate?.status === "running" ||
    candidate?.status === "completed" ||
    candidate?.status === "failed"
      ? candidate.status
      : "queued";
  const snapshotStartedAt = normalizeProgressTimestamp(candidate?.startedAt) ?? nowIso();
  const snapshotUpdatedAt =
    normalizeProgressTimestamp(candidate?.updatedAt) ?? snapshotStartedAt;
  const snapshotFinishedAt =
    normalizeProgressTimestamp(candidate?.finishedAt) ??
    ((rootStatus === "completed" || rootStatus === "failed") ? snapshotUpdatedAt : null);
  const stepCandidates = Array.isArray(candidate?.steps)
    ? candidate.steps.filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === "object")
    : [];
  const stageDefinitions = resolveStage2ProgressDefinitions(mode, stepCandidates);
  const stepMap = new Map(
    stepCandidates
      .map((step) => {
        const id = typeof step.id === "string" ? step.id.trim() : "";
        return id ? [id, step] : null;
      })
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry))
  );

  return {
    runId: normalizeProgressTimestamp(candidate?.runId) ?? runId,
    status: rootStatus,
    activeStageId:
      typeof candidate?.activeStageId === "string" &&
      stageDefinitions.some((stage) => stage.id === candidate.activeStageId)
        ? (candidate.activeStageId as Stage2ProgressStageId)
        : null,
    startedAt: snapshotStartedAt,
    updatedAt: snapshotUpdatedAt,
    finishedAt: snapshotFinishedAt,
    error: typeof candidate?.error === "string" && candidate.error.trim() ? candidate.error.trim() : null,
    steps: stageDefinitions.map((stage) => {
      const raw = stepMap.get(stage.id);
      const normalizedStatus =
        normalizeProgressState(raw?.status) ??
        normalizeProgressState(raw?.state) ??
        (normalizeProgressTimestamp(raw?.finishedAt) || normalizeProgressTimestamp(raw?.completedAt)
          ? rootStatus === "failed" && (candidate?.activeStageId as string | undefined) === stage.id
            ? "failed"
            : "completed"
          : normalizeProgressTimestamp(raw?.startedAt) && (candidate?.activeStageId as string | undefined) === stage.id
            ? "running"
            : "pending");
      const finishedAt =
        normalizeProgressTimestamp(raw?.finishedAt) ??
        normalizeProgressTimestamp(raw?.completedAt) ??
        (normalizedStatus === "completed" || normalizedStatus === "failed" ? snapshotFinishedAt : null);
      const completedAt = normalizeProgressTimestamp(raw?.completedAt) ?? finishedAt;
      const detail = typeof raw?.detail === "string" && raw.detail.trim() ? raw.detail.trim() : null;
      const summary =
        typeof raw?.summary === "string" && raw.summary.trim()
          ? raw.summary.trim()
          : summarizeProgressDetail(detail);

      return {
        id: stage.id,
        label: stage.label,
        shortLabel: stage.shortLabel,
        description: stage.description,
        status: normalizedStatus,
        state: normalizedStatus,
        summary,
        detail,
        startedAt: normalizeProgressTimestamp(raw?.startedAt),
        finishedAt,
        completedAt,
        durationMs: normalizeProgressNumber(raw?.durationMs),
        promptChars: normalizeProgressNumber(raw?.promptChars),
        reasoningEffort:
          typeof raw?.reasoningEffort === "string" && raw.reasoningEffort.trim()
            ? raw.reasoningEffort.trim()
            : null
      };
    })
  };
}
