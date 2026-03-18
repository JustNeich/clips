import {
  STAGE2_DEFAULT_REASONING_EFFORTS,
  STAGE2_DEFAULT_STAGE_PROMPTS,
  STAGE2_PROMPT_STAGE_IDS,
  Stage2PromptConfigStageId,
  Stage2ReasoningEffort
} from "./stage2-prompt-specs";

export {
  STAGE2_DEFAULT_REASONING_EFFORTS,
  STAGE2_DEFAULT_STAGE_PROMPTS,
  STAGE2_PROMPT_STAGE_IDS,
  STAGE2_REASONING_EFFORT_OPTIONS
} from "./stage2-prompt-specs";
export type { Stage2PromptConfigStageId, Stage2ReasoningEffort } from "./stage2-prompt-specs";

const STAGE2_PIPELINE_STAGE_DEFINITIONS = [
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

export const STAGE2_PIPELINE_STAGES = STAGE2_PIPELINE_STAGE_DEFINITIONS;

export type Stage2PipelineStageId = (typeof STAGE2_PIPELINE_STAGES)[number]["id"];

export type Stage2PromptStageConfig = {
  prompt: string;
  reasoningEffort: Stage2ReasoningEffort;
};

export type Stage2PromptConfig = {
  version: 2;
  stages: Record<Stage2PromptConfigStageId, Stage2PromptStageConfig>;
};

export type Stage2ProgressStatus = "queued" | "running" | "completed" | "failed";

export type Stage2ProgressStepState = "pending" | "running" | "completed" | "failed";

export type Stage2ProgressStep = {
  id: Stage2PipelineStageId;
  label: string;
  shortLabel: string;
  description: string;
  state: Stage2ProgressStepState;
  detail: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  promptChars: number | null;
  reasoningEffort: string | null;
};

export type Stage2ProgressSnapshot = {
  runId: string;
  status: Stage2ProgressStatus;
  activeStageId: Stage2PipelineStageId | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  error: string | null;
  steps: Stage2ProgressStep[];
};

function nowIso(): string {
  return new Date().toISOString();
}

export const DEFAULT_STAGE2_PROMPT_CONFIG: Stage2PromptConfig = {
  version: 2,
  stages: Object.fromEntries(
    STAGE2_PROMPT_STAGE_IDS.map((stageId) => [
      stageId,
      {
        prompt: STAGE2_DEFAULT_STAGE_PROMPTS[stageId],
        reasoningEffort: STAGE2_DEFAULT_REASONING_EFFORTS[stageId]
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
  return STAGE2_PIPELINE_STAGES.filter((stage) => stage.promptConfigurable).map((stage) => ({
    id: stage.id as Stage2PromptConfigStageId,
    label: stage.label,
    shortLabel: stage.shortLabel,
    description: stage.description,
    promptStageType: stage.promptStageType
  }));
}

function sanitizePrompt(value: unknown, fallback: string): string {
  const normalized =
    typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  return normalized || fallback;
}

function sanitizeLegacyPrompt(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
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
              }
            >
          >
        >)
      : undefined;

  const stages = Object.fromEntries(
    STAGE2_PROMPT_STAGE_IDS.map((stageId) => {
      const stageCandidate = stagesCandidate?.[stageId];
      const defaultPrompt = STAGE2_DEFAULT_STAGE_PROMPTS[stageId];
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
          )
        }
      ];
    })
  ) as Record<Stage2PromptConfigStageId, Stage2PromptStageConfig>;

  return {
    version: 2,
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

export function hasStage2PromptOverrides(config: Stage2PromptConfig): boolean {
  const normalized = normalizeStage2PromptConfig(config);
  return STAGE2_PROMPT_STAGE_IDS.some((stageId) => {
    const stage = normalized.stages[stageId];
    return (
      stage.prompt !== STAGE2_DEFAULT_STAGE_PROMPTS[stageId] ||
      stage.reasoningEffort !== STAGE2_DEFAULT_REASONING_EFFORTS[stageId]
    );
  });
}

export function createStage2ProgressSnapshot(runId: string): Stage2ProgressSnapshot {
  const timestamp = nowIso();
  return {
    runId,
    status: "queued",
    activeStageId: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    error: null,
    steps: STAGE2_PIPELINE_STAGES.map((stage) => ({
      id: stage.id,
      label: stage.label,
      shortLabel: stage.shortLabel,
      description: stage.description,
      state: "pending" as const,
      detail: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      promptChars: null,
      reasoningEffort: null
    }))
  };
}

type Stage2ProgressPatch = Partial<
  Pick<Stage2ProgressStep, "detail" | "promptChars" | "reasoningEffort" | "durationMs">
>;

function patchStep(step: Stage2ProgressStep, patch?: Stage2ProgressPatch): Stage2ProgressStep {
  if (!patch) {
    return step;
  }
  return {
    ...step,
    detail: patch.detail !== undefined ? patch.detail : step.detail,
    promptChars: patch.promptChars !== undefined ? patch.promptChars : step.promptChars,
    reasoningEffort:
      patch.reasoningEffort !== undefined ? patch.reasoningEffort : step.reasoningEffort,
    durationMs: patch.durationMs !== undefined ? patch.durationMs : step.durationMs
  };
}

export function markStage2ProgressStageRunning(
  snapshot: Stage2ProgressSnapshot,
  stageId: Stage2PipelineStageId,
  patch?: Stage2ProgressPatch
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
              state: "running",
              startedAt: step.startedAt ?? timestamp
            },
            patch
          )
        : step
    )
  };
}

export function markStage2ProgressStageCompleted(
  snapshot: Stage2ProgressSnapshot,
  stageId: Stage2PipelineStageId,
  patch?: Stage2ProgressPatch
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
              state: "completed",
              startedAt: step.startedAt ?? timestamp,
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
  stageId: Stage2PipelineStageId,
  error: string,
  patch?: Stage2ProgressPatch
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
              state: "failed",
              detail: error,
              startedAt: step.startedAt ?? timestamp,
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
    error: null
  };
}

export function resetStage2ProgressForRetry(
  snapshot: Stage2ProgressSnapshot,
  detail?: string | null
): Stage2ProgressSnapshot {
  const restarted = createStage2ProgressSnapshot(snapshot.runId);
  if (!detail) {
    return restarted;
  }

  return {
    ...restarted,
    steps: restarted.steps.map((step) =>
      step.id === "analyzer"
        ? {
            ...step,
            detail
          }
        : step
    )
  };
}
