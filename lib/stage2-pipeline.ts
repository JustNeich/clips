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

const STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS = [
  {
    id: "contextPacket",
    label: "Building context packet",
    shortLabel: "Контекст",
    description: "Собираем observed facts, audience temperature и strategy в единый packet.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "candidateGenerator",
    label: "Drafting candidate batch",
    shortLabel: "Кандидаты",
    description: "Writer генерирует ровно 8 сильных английских caption-кандидатов.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "qualityCourt",
    label: "Running quality court",
    shortLabel: "Суд",
    description: "Строгий judge режет слабые варианты и выбирает лучших финалистов.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "targetedRepair",
    label: "Repairing near-misses",
    shortLabel: "Ремонт",
    description: "Точечный repair почти-годных кандидатов запускается только при необходимости.",
    promptConfigurable: true,
    promptStageType: "llm"
  },
  {
    id: "titleWriter",
    label: "Writing winner titles",
    shortLabel: "Тайтлы",
    description: "Пишем 5 title options только для финального winner-кандидата.",
    promptConfigurable: true,
    promptStageType: "llm"
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
};

export type Stage2PromptConfig = {
  version: 3;
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
  version: 3,
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
  return STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS.filter((stage) => stage.promptConfigurable).map((stage) => ({
    id: stage.id as Stage2PromptConfigStageId,
    label: stage.label,
    shortLabel: stage.shortLabel,
    description: stage.description,
    promptStageType: stage.promptStageType
  }));
}

function isRegenerateMode(value: string | null | undefined): boolean {
  return value === "regenerate";
}

function resolveStage2ProgressDefinitions(
  mode?: string | null,
  stepCandidates?: Record<string, unknown>[]
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
        STAGE2_LEGACY_PIPELINE_STAGE_DEFINITIONS.some((stage) => stage.id === id)
      ) &&
      !Array.from(candidateIds).some((id) =>
        STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS.some((stage) => stage.id === id)
      )
    ) {
      return STAGE2_LEGACY_PIPELINE_STAGE_DEFINITIONS;
    }
  }

  return STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS;
}

export function getStage2ProgressStartStageId(mode?: string | null): Stage2ProgressStageId {
  return resolveStage2ProgressDefinitions(mode)[0]?.id ?? "contextPacket";
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

  const legacyStageFallbacks: Partial<Record<Stage2PromptConfigStageId, Stage2PromptConfigStageId[]>> = {
    contextPacket: ["analyzer", "selector"],
    candidateGenerator: ["writer"],
    qualityCourt: ["critic", "finalSelector"],
    targetedRepair: ["rewriter"],
    titleWriter: ["titles"]
  };

  const stages = Object.fromEntries(
    STAGE2_PROMPT_STAGE_IDS.map((stageId) => {
      const stageCandidate =
        stagesCandidate?.[stageId] ??
        legacyStageFallbacks[stageId]?.map((fallbackId) => stagesCandidate?.[fallbackId]).find(Boolean);
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
    version: 3,
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

export function createStage2ProgressSnapshot(
  runId: string,
  mode: string | null | undefined = "manual"
): Stage2ProgressSnapshot {
  const timestamp = nowIso();
  const stageDefinitions = resolveStage2ProgressDefinitions(mode);
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
  mode: string | null | undefined = "manual"
): Stage2ProgressSnapshot {
  const restarted = createStage2ProgressSnapshot(snapshot.runId, mode);
  if (!detail) {
    return restarted;
  }

  return {
    ...restarted,
    steps: restarted.steps.map((step) =>
      step.id === getStage2ProgressStartStageId(mode)
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
