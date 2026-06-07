export type Stage2ProgressStatus = "queued" | "running" | "completed" | "failed";
export type Stage2ProgressStepState = "pending" | "running" | "completed" | "failed";

const STAGE2_NATIVE_REFERENCE_ONE_SHOT_PROGRESS_STAGES = [
  {
    id: "oneShotReference",
    label: "Running one-shot reference baseline",
    shortLabel: "One-shot",
    description: "One-shot baseline creates analysis, options, and winner ranking from the current clip context."
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
    id: "sourceOverlayCaption",
    label: "Writing source-video overlay text",
    shortLabel: "Текст",
    description: "Генерируем отдельный текст внутри исходного видео."
  },
  {
    id: "assemble",
    label: "Assembling result",
    shortLabel: "Сборка",
    description: "Собираем итоговый совместимый Stage 2 output и diagnostics."
  }
] as const;

const STAGE2_NATIVE_CLASSIC_PROMPT_FIRST_PROGRESS_STAGES = [
  {
    id: "classicOneShot",
    label: "Running classic prompt-first one-shot",
    shortLabel: "Classic",
    description: "Classic Top/Bottom provider call with active channel context."
  },
  ...STAGE2_NATIVE_REFERENCE_ONE_SHOT_PROGRESS_STAGES.slice(1)
] as const;

const STAGE2_NATIVE_STORY_PROMPT_FIRST_PROGRESS_STAGES = [
  {
    id: "storyOneShot",
    label: "Running story prompt-first one-shot",
    shortLabel: "Story",
    description: "Story Lead/Main Caption provider call with active channel context."
  },
  ...STAGE2_NATIVE_REFERENCE_ONE_SHOT_PROGRESS_STAGES.slice(1)
] as const;

const STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS = [
  ...STAGE2_NATIVE_REFERENCE_ONE_SHOT_PROGRESS_STAGES,
  { id: "contextPacket", label: "Building context packet", shortLabel: "Контекст", description: "Собираем единый packet для caption pipeline." },
  { id: "candidateGenerator", label: "Generating lane batch", shortLabel: "Кандидаты", description: "Генерируем candidate batch." },
  { id: "hardValidator", label: "Running hard validator", shortLabel: "Валидатор", description: "Детерминированно проверяем кандидатов." },
  { id: "qualityCourt", label: "Running editorial court", shortLabel: "Суд", description: "Выбираем finalists и recovery plan." },
  { id: "targetedRepair", label: "Running targeted recovery", shortLabel: "Recovery", description: "Генерируем недостающие варианты." },
  { id: "templateBackfill", label: "Applying template backfill", shortLabel: "Backfill", description: "Гарантируем валидные display options при деградации." },
  { id: "titleWriter", label: "Writing winner titles", shortLabel: "Тайтлы", description: "Пишем title options для финального winner." },
  ...STAGE2_NATIVE_CLASSIC_PROMPT_FIRST_PROGRESS_STAGES.slice(0, 1),
  ...STAGE2_NATIVE_STORY_PROMPT_FIRST_PROGRESS_STAGES.slice(0, 1)
] as const;

const STAGE2_LEGACY_PIPELINE_STAGE_DEFINITIONS = [
  { id: "analyzer", label: "Analyzing video", shortLabel: "Анализ видео", description: "Собираем первичный разбор." },
  { id: "selector", label: "Selecting clip angle", shortLabel: "Выбор угла", description: "Выбираем angle и clip type." },
  { id: "writer", label: "Drafting 20 options", shortLabel: "Черновики", description: "Пишем overlay-кандидатов." },
  { id: "critic", label: "Critic scoring", shortLabel: "Скоринг", description: "Оцениваем кандидатов." },
  { id: "rewriter", label: "Rewriting finalists", shortLabel: "Переписывание", description: "Переписываем finalists." },
  { id: "finalSelector", label: "Selecting shortlist", shortLabel: "Шортлист", description: "Собираем shortlist." },
  { id: "titles", label: "Generating titles", shortLabel: "Заголовки", description: "Генерируем title options." },
  { id: "seo", label: "Generating SEO", shortLabel: "SEO", description: "Собираем описание и tags." }
] as const;

const STAGE2_REGENERATE_PROGRESS_STAGES = [
  { id: "base", label: "Loading base run", shortLabel: "База", description: "Берём текущий Stage 2 run как основу." },
  { id: "regenerate", label: "Quick regenerate", shortLabel: "Перегенерация", description: "Быстро переписываем visible options." },
  { id: "assemble", label: "Assembling result", shortLabel: "Сборка", description: "Нормализуем output и сохраняем run." }
] as const;

const STAGE2_PIPELINE_STAGES = [
  ...STAGE2_NATIVE_PIPELINE_STAGE_DEFINITIONS,
  ...STAGE2_LEGACY_PIPELINE_STAGE_DEFINITIONS
] as const;

export type Stage2PipelineStageId = (typeof STAGE2_PIPELINE_STAGES)[number]["id"];
export type Stage2RegenerateStageId = (typeof STAGE2_REGENERATE_PROGRESS_STAGES)[number]["id"];
export type Stage2ProgressStageId = Stage2PipelineStageId | Stage2RegenerateStageId;

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

type Stage2ProgressStageDefinition = {
  id: Stage2ProgressStageId;
  label: string;
  shortLabel: string;
  description: string;
};

function nowIso(): string {
  return new Date().toISOString();
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
    if (candidateIds.has("storyOneShot")) {
      return STAGE2_NATIVE_STORY_PROMPT_FIRST_PROGRESS_STAGES;
    }
    if (candidateIds.has("classicOneShot")) {
      return STAGE2_NATIVE_CLASSIC_PROMPT_FIRST_PROGRESS_STAGES;
    }
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

  return STAGE2_NATIVE_REFERENCE_ONE_SHOT_PROGRESS_STAGES;
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
  return `${firstMeaningfulLine.slice(0, 139).trimEnd()}...`;
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
