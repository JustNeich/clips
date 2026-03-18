"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Stage2Response, Stage2RunStatus, Stage2RunSummary } from "./types";
import { StepWorkspace } from "./StepWorkspace";

type Step2PickCaptionProps = {
  channelName?: string | null;
  channelUsername?: string | null;
  stage2: Stage2Response | null;
  progress: Stage2Response["progress"] | null;
  stageCreatedAt: string | null;
  commentsAvailable?: boolean;
  instruction: string;
  runs: Stage2RunSummary[];
  selectedRunId: string | null;
  currentRunStatus: Stage2RunStatus | null;
  currentRunError: string | null;
  canRunStage2: boolean;
  runBlockedReason?: string | null;
  isLaunching: boolean;
  isRunning: boolean;
  expectedDurationMs: number;
  elapsedMs: number;
  selectedOption: number | null;
  selectedTitleOption: number | null;
  onInstructionChange: (value: string) => void;
  onRunStage2: () => void;
  onSelectRun: (runId: string) => void;
  onSelectOption: (option: number) => void;
  onSelectTitleOption: (option: number) => void;
  onCopy: (value: string, successMessage: string) => void;
};

type DiagnosticsView = NonNullable<Stage2Response["diagnostics"]>;
type DiagnosticsPromptStage = DiagnosticsView["effectivePrompting"]["promptStages"][number];
type DiagnosticsExample = DiagnosticsView["examples"]["availableExamples"][number];

function formatDate(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatSourceProviderLabel(provider: Stage2Response["source"]["downloadProvider"]): string | null {
  if (provider === "visolix") {
    return "Visolix";
  }
  if (provider === "ytDlp") {
    return "Локальный резервный загрузчик";
  }
  return null;
}

function formatDurationMs(value: number): string {
  const safe = Math.max(0, value);
  if (safe < 60_000) {
    return `${(safe / 1000).toFixed(2)}с`;
  }
  const minutes = Math.floor(safe / 60_000);
  const seconds = ((safe % 60_000) / 1000).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}

function getStage2ProgressRatio(elapsedMs: number, expectedDurationMs: number): number {
  if (expectedDurationMs <= 0) {
    return 0;
  }
  const ratio = elapsedMs / expectedDurationMs;
  if (ratio <= 1) {
    return Math.min(0.96, ratio * 0.96);
  }
  const overflow = ratio - 1;
  return Math.min(0.995, 0.96 + (1 - Math.exp(-overflow * 1.6)) * 0.035);
}

function formatReasoningEffort(value: string | null | undefined): string {
  if (!value) {
    return "Not set";
  }
  if (value === "x-high" || value === "xhigh") {
    return "X-High";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatRunStatusLabel(status: Stage2RunStatus): string {
  switch (status) {
    case "queued":
      return "В очереди";
    case "running":
      return "Идёт";
    case "completed":
      return "Готов";
    case "failed":
      return "Ошибка";
    default:
      return status;
  }
}

function formatExamplesSourceLabel(value: "workspace_default" | "channel_custom"): string {
  return value === "channel_custom" ? "channel custom" : "workspace default";
}

function truncateText(value: string, maxLength = 140): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function isVerboseStageDetail(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 220 || trimmed.includes("\n");
}

function summarizeStageDetail(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const firstMeaningfulLine =
    value
      .split("\n")
      .map((item) => item.trim())
      .find(Boolean) ?? value.trim();
  return firstMeaningfulLine ? truncateText(firstMeaningfulLine, 120) : null;
}

function formatNullableNumber(value: number | null | undefined, digits = 2): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
}

function normalizeDiagnosticsExample(input: unknown, bucket: DiagnosticsExample["bucket"]): DiagnosticsExample {
  const candidate = asObject(input);
  return {
    bucket,
    sourceChannelId:
      asString(candidate?.sourceChannelId) ||
      asString(candidate?.ownerChannelId) ||
      asString(candidate?.videoId) ||
      "unknown-source",
    sourceChannelName:
      asString(candidate?.sourceChannelName) ||
      asString(candidate?.ownerChannelName) ||
      "Unknown source",
    videoId: asOptionalString(candidate?.videoId),
    title:
      asString(candidate?.title) ||
      asString(candidate?.overlayTop) ||
      asString(candidate?.overlayBottom) ||
      "Untitled example",
    clipType: asString(candidate?.clipType, "unknown"),
    overlayTop: asString(candidate?.overlayTop),
    overlayBottom: asString(candidate?.overlayBottom),
    whyItWorks: Array.isArray(candidate?.whyItWorks)
      ? candidate!.whyItWorks
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      : typeof candidate?.whyItWorks === "string" && candidate.whyItWorks.trim()
        ? [candidate.whyItWorks.trim()]
        : [],
    qualityScore: asNumber(candidate?.qualityScore),
    retrievalScore: asNumber(candidate?.retrievalScore),
    retrievalReasons: asStringArray(candidate?.retrievalReasons),
    sampleKind: asOptionalString(candidate?.sampleKind),
    isOwnedAnchor: Boolean(candidate?.isOwnedAnchor),
    isAntiExample: Boolean(candidate?.isAntiExample),
    publishedAt: asOptionalString(candidate?.publishedAt),
    views: asNumber(candidate?.views),
    ageHours: asNumber(candidate?.ageHours),
    anomalyScore: asNumber(candidate?.anomalyScore)
  };
}

function normalizePromptStage(input: unknown, index: number): DiagnosticsPromptStage | null {
  const candidate = asObject(input);
  if (!candidate) {
    return null;
  }

  const stageId = asString(candidate.stageId) || `stage_${index + 1}`;
  const defaultPrompt =
    asString(candidate.defaultPrompt) || asString(candidate.defaultTemplate);
  const configuredPrompt =
    asString(candidate.configuredPrompt) ||
    asString(candidate.effectiveTemplate) ||
    asString(candidate.channelOverride) ||
    defaultPrompt;
  return {
    stageId,
    label: asString(candidate.label) || stageId,
    stageType: "llm_prompt",
    defaultPrompt,
    configuredPrompt,
    reasoningEffort: asOptionalString(candidate.reasoningEffort),
    isCustomPrompt:
      typeof candidate.isCustomPrompt === "boolean"
        ? candidate.isCustomPrompt
        : configuredPrompt !== defaultPrompt,
    promptText: asOptionalString(candidate.promptText),
    promptChars: asNumber(candidate.promptChars),
    usesImages: Boolean(candidate.usesImages),
    summary: asString(candidate.summary)
  };
}

function normalizeStage2DiagnosticsForView(
  input: Stage2Response["diagnostics"] | null | undefined,
  fallback: {
    channelName?: string | null;
    channelUsername?: string | null;
  }
): DiagnosticsView | null {
  const candidate = asObject(input);
  if (!candidate) {
    return null;
  }

  const currentChannel = asObject(candidate.channel);
  const legacyProfile = asObject(candidate.profile);
  const selectionCandidate = asObject(candidate.selection);
  const promptingCandidate = asObject(candidate.effectivePrompting);
  const examplesCandidate = asObject(candidate.examples);
  const legacyRetrieval = asObject(candidate.retrieval);

  const promptStages = Array.isArray(promptingCandidate?.promptStages)
    ? promptingCandidate.promptStages
        .map((stage, index) => normalizePromptStage(stage, index))
        .filter((stage): stage is DiagnosticsPromptStage => stage !== null)
    : [];

  const availableExamples =
    Array.isArray(examplesCandidate?.availableExamples) && examplesCandidate.availableExamples.length > 0
      ? examplesCandidate.availableExamples.map((item) => normalizeDiagnosticsExample(item, "available"))
      : [
          ...(Array.isArray(legacyRetrieval?.stableExamples) ? legacyRetrieval.stableExamples : []),
          ...(Array.isArray(legacyRetrieval?.hotExamples) ? legacyRetrieval.hotExamples : []),
          ...(Array.isArray(legacyRetrieval?.antiExamples) ? legacyRetrieval.antiExamples : [])
        ].map((item) => normalizeDiagnosticsExample(item, "available"));

  const selectedExamples =
    Array.isArray(examplesCandidate?.selectedExamples) && examplesCandidate.selectedExamples.length > 0
      ? examplesCandidate.selectedExamples.map((item) => normalizeDiagnosticsExample(item, "selected"))
      : availableExamples.slice(0, Math.min(3, availableExamples.length)).map((item) => ({
          ...item,
          bucket: "selected" as const
        }));

  const rankedAnglesRaw = Array.isArray(selectionCandidate?.rankedAngles)
    ? selectionCandidate.rankedAngles
    : [];
  const rankedAngles = rankedAnglesRaw
    .map((item) => {
      const ranked = asObject(item);
      const angle = asString(ranked?.angle);
      const why = asString(ranked?.why);
      const score = asNumber(ranked?.score);
      if (!angle || !why || score === null) {
        return null;
      }
      return { angle, why, score };
    })
    .filter(
      (
        item
      ): item is DiagnosticsView["selection"]["rankedAngles"][number] => item !== null
    );

  return {
    channel: {
      channelId:
        asString(currentChannel?.channelId) ||
        asString(currentChannel?.id) ||
        asString(legacyProfile?.profileId) ||
        "current-channel",
      name: asString(currentChannel?.name) || asString(legacyProfile?.name) || fallback.channelName || "Current channel",
      username: asString(currentChannel?.username) || fallback.channelUsername || "",
      examplesSource:
        currentChannel?.examplesSource === "channel_custom" ? "channel_custom" : "workspace_default",
      hardConstraints:
        asObject(currentChannel?.hardConstraints) && currentChannel?.hardConstraints
          ? (currentChannel.hardConstraints as DiagnosticsView["channel"]["hardConstraints"])
          : {
              topLengthMin: 0,
              topLengthMax: 0,
              bottomLengthMin: 0,
              bottomLengthMax: 0,
              bottomQuoteRequired: false,
              bannedWords: [],
              bannedOpeners: []
            },
      workspaceCorpusCount: asNumber(currentChannel?.workspaceCorpusCount) ?? availableExamples.length,
      activeCorpusCount: asNumber(currentChannel?.activeCorpusCount) ?? availableExamples.length
    },
    selection: {
      clipType:
        asString(selectionCandidate?.clipType) ||
        availableExamples[0]?.clipType ||
        "unknown",
      rankedAngles,
      coreTrigger: asString(selectionCandidate?.coreTrigger),
      humanStake: asString(selectionCandidate?.humanStake),
      narrativeFrame: asString(selectionCandidate?.narrativeFrame),
      whyViewerCares: asString(selectionCandidate?.whyViewerCares),
      topStrategy: asString(selectionCandidate?.topStrategy),
      bottomEnergy: asString(selectionCandidate?.bottomEnergy),
      whyOldV6WouldWorkHere: asString(selectionCandidate?.whyOldV6WouldWorkHere),
      failureModes: Array.isArray(selectionCandidate?.failureModes)
        ? selectionCandidate.failureModes
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [],
      writerBrief: asString(selectionCandidate?.writerBrief),
      rationale: asOptionalString(selectionCandidate?.rationale),
      selectedExampleIds: Array.isArray(selectionCandidate?.selectedExampleIds)
        ? selectionCandidate.selectedExampleIds
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : []
    },
    effectivePrompting: {
      promptStages
    },
    examples: {
      source:
        examplesCandidate?.source === "channel_custom" ? "channel_custom" : "workspace_default",
      workspaceCorpusCount:
        asNumber(examplesCandidate?.workspaceCorpusCount) ?? availableExamples.length,
      activeCorpusCount: asNumber(examplesCandidate?.activeCorpusCount) ?? availableExamples.length,
      availableExamples,
      selectedExamples
    }
  };
}

export function Step2PickCaption({
  channelName,
  channelUsername,
  stage2,
  progress,
  stageCreatedAt,
  commentsAvailable = true,
  instruction,
  runs,
  selectedRunId,
  currentRunStatus,
  currentRunError,
  canRunStage2,
  runBlockedReason,
  isLaunching,
  isRunning,
  expectedDurationMs,
  elapsedMs,
  selectedOption,
  selectedTitleOption,
  onInstructionChange,
  onRunStage2,
  onSelectRun,
  onSelectOption,
  onSelectTitleOption,
  onCopy
}: Step2PickCaptionProps) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const selectedRun = useMemo(
    () => runs.find((run) => run.runId === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  useEffect(() => {
    if (!stage2) {
      return;
    }
    if (!selectedOption) {
      onSelectOption(stage2.output.finalPick.option);
    }
  }, [onSelectOption, selectedOption, stage2]);

  const activeOption = useMemo(() => {
    if (!stage2) {
      return null;
    }
    const preferred = selectedOption ?? stage2.output.finalPick.option;
    return (
      stage2.output.captionOptions.find((item) => item.option === preferred) ??
      stage2.output.captionOptions[0] ??
      null
    );
  }, [selectedOption, stage2]);
  const activeTitleOption = useMemo(() => {
    if (!stage2) {
      return null;
    }
    const preferred = selectedTitleOption ?? stage2.output.titleOptions[0]?.option ?? 1;
    return (
      stage2.output.titleOptions.find((item) => item.option === preferred) ??
      stage2.output.titleOptions[0] ??
      null
    );
  }, [selectedTitleOption, stage2]);
  const sourceProviderLabel = formatSourceProviderLabel(stage2?.source.downloadProvider);
  const visibleProgress = progress ?? stage2?.progress ?? null;
  const diagnostics = useMemo(
    () =>
      normalizeStage2DiagnosticsForView(stage2?.diagnostics ?? null, {
        channelName,
        channelUsername
      }),
    [stage2?.diagnostics, channelName, channelUsername]
  );
  const activeProgressStep = useMemo(() => {
    if (!visibleProgress) {
      return null;
    }
    return (
      visibleProgress.steps.find((step) => step.id === visibleProgress.activeStageId) ??
      visibleProgress.steps.find((step) => step.state === "running") ??
      null
    );
  }, [visibleProgress]);
  const progressRatio = useMemo(
    () => getStage2ProgressRatio(elapsedMs, expectedDurationMs),
    [elapsedMs, expectedDurationMs]
  );
  const overrideCount = useMemo(() => {
    if (!diagnostics) {
      return 0;
    }
    return diagnostics.effectivePrompting.promptStages.filter((stage) => stage.isCustomPrompt).length;
  }, [diagnostics]);

  return (
    <StepWorkspace
      editLabel="Редактирование"
      previewLabel="Предпросмотр"
      left={
        <div className="step-panel-stack">
          <header className="step-head">
            <p className="kicker">Шаг 2</p>
            <h2>Выбор</h2>
            <p>Сгенерируйте варианты подписей, сравните их рядом и затем выберите один для рендера.</p>
            {channelName ? (
              <p className="subtle-text">
                Канал: <strong>{channelName}</strong>
                {channelUsername ? ` (@${channelUsername})` : ""}
              </p>
            ) : null}
            {stageCreatedAt ? (
              <p className="subtle-text">Обновлено: {formatDate(stageCreatedAt)}</p>
            ) : null}
            {sourceProviderLabel ? (
              <p className="subtle-text">Источник медиа: {sourceProviderLabel}</p>
            ) : null}
            {!commentsAvailable ? (
              <p className="subtle-text">
                Комментарии недоступны на этом сервере. Второй этап использует только видеоконтекст.
              </p>
            ) : null}
          </header>

          <section className="control-card">
            <label className="field-label" htmlFor="instruction">
              Инструкция для перегенерации (необязательно)
            </label>
            <textarea
              id="instruction"
              className="text-area"
              rows={3}
              value={instruction}
              onChange={(event) => onInstructionChange(event.target.value.slice(0, 2000))}
              placeholder="Например: сделай короче, добавь одну сухую шутку, избегай сленга."
            />
            <p className="subtle-text">Используйте это, если модель неверно поняла контекст или тон.</p>
            <div className="control-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onRunStage2}
                disabled={!canRunStage2}
                aria-busy={isLaunching}
                title={!canRunStage2 ? runBlockedReason ?? undefined : undefined}
              >
                {isLaunching
                  ? "Запускаем..."
                  : isRunning
                    ? "Запустить ещё одну генерацию"
                    : "Сгенерировать варианты"}
              </button>
            </div>
            <section className="stage2-timing-card" aria-live="polite">
              <div className="stage2-timing-row">
                <span className="field-label">Обычно занимает</span>
                <strong>{formatDurationMs(expectedDurationMs)}</strong>
              </div>
              <div className="stage2-timing-row">
                <span className="field-label">{isRunning ? "Прошло" : "Последний ориентир"}</span>
                <strong>{formatDurationMs(isRunning ? elapsedMs : expectedDurationMs)}</strong>
              </div>
              <div className="stage2-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressRatio * 100)}>
                <div className="stage2-progress-fill" style={{ width: `${(progressRatio * 100).toFixed(1)}%` }} />
              </div>
              <p className="subtle-text">
                {isRunning
                  ? elapsedMs > expectedDurationMs
                    ? "Уже дольше обычного, но процесс продолжается."
                    : activeProgressStep
                      ? `Сейчас: ${activeProgressStep.shortLabel}.`
                      : "Идет генерация. Оценка основана на предыдущем успешном запуске."
                  : visibleProgress?.status === "completed"
                    ? "Последний запуск завершился по шагам ниже."
                    : "Оценка обновляется после каждого успешного запуска второго этапа."}
              </p>
              {selectedRun ? (
                <p className={`subtle-text ${currentRunStatus === "failed" ? "danger-text" : ""}`}>
                  Run {selectedRun.runId.slice(0, 8)} · {formatRunStatusLabel(selectedRun.status)}
                  {selectedRun.mode === "auto" ? " · auto" : ""}
                  {currentRunError ? ` · ${currentRunError}` : ""}
                </p>
              ) : null}
              {visibleProgress ? (
                <ol className="stage2-stage-list" aria-label="Прогресс Stage 2 pipeline">
                  {visibleProgress.steps.map((step, index) => {
                    const isActive = visibleProgress.activeStageId === step.id || step.state === "running";
                    return (
                      <li
                        key={step.id}
                        className={`stage2-stage-item state-${step.state} ${isActive ? "is-active" : ""}`}
                        aria-current={isActive ? "step" : undefined}
                      >
                        <div className="stage2-stage-index">{index + 1}</div>
                        <div className="stage2-stage-body">
                          <div className="stage2-stage-head">
                            <strong>{step.shortLabel}</strong>
                            <span className="subtle-text">{step.label}</span>
                          </div>
                          <p className="subtle-text">{step.description}</p>
                          {step.detail && step.detail !== step.description ? (
                            isVerboseStageDetail(step.detail) ? (
                              <details className="stage2-stage-detail-toggle">
                                <summary>
                                  <span>
                                    {step.state === "failed" ? "Показать лог ошибки" : "Показать детали этапа"}
                                  </span>
                                  {summarizeStageDetail(step.detail) ? (
                                    <small>{summarizeStageDetail(step.detail)}</small>
                                  ) : null}
                                </summary>
                                <div className="stage2-stage-detail-panel">
                                  <pre className="stage2-stage-detail-log">{step.detail}</pre>
                                </div>
                              </details>
                            ) : (
                              <p className="subtle-text">{step.detail}</p>
                            )
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </section>
            {runs.length > 0 ? (
              <section className="stage2-run-picker" aria-label="История Stage 2 runs">
                <div className="stage2-run-picker-head">
                  <span className="field-label">Runs</span>
                  <span className="subtle-text">Текущий экран привязан к durable run state, а не к открытому tab.</span>
                </div>
                <div className="stage2-run-pill-list">
                  {runs.map((run) => (
                    <button
                      key={run.runId}
                      type="button"
                      className={`stage2-run-pill ${selectedRunId === run.runId ? "is-active" : ""} status-${run.status}`}
                      onClick={() => onSelectRun(run.runId)}
                    >
                      <strong>{formatRunStatusLabel(run.status)}</strong>
                      <span>{formatDate(run.createdAt)}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {!canRunStage2 && runBlockedReason ? (
              <p className="subtle-text danger-text">{runBlockedReason}</p>
            ) : null}
          </section>

          {diagnostics ? (
            <>
              <section className="control-card control-card-subtle">
                <div className="option-card-head">
                  <div>
                    <h3>Как этот run реально устроен</h3>
                    <p className="subtle-text">
                      Channel config, active examples corpus и selector output ниже отражают реальную
                      Stage 2 конфигурацию этого запуска.
                    </p>
                  </div>
                </div>
                <div className="stage2-insight-grid">
                  <article className="stage2-insight-card">
                    <span className="field-label">Channel</span>
                    <strong>{diagnostics.channel.name}</strong>
                    <p className="subtle-text">
                      @{diagnostics.channel.username} · source{" "}
                      {formatExamplesSourceLabel(diagnostics.channel.examplesSource)}
                    </p>
                  </article>
                  <article className="stage2-insight-card">
                    <span className="field-label">Selection</span>
                    <strong>{diagnostics.selection.clipType}</strong>
                    <p className="subtle-text">
                      {diagnostics.selection.rankedAngles.map((item) => item.angle).slice(0, 3).join(", ")}
                    </p>
                  </article>
                  <article className="stage2-insight-card">
                    <span className="field-label">Examples</span>
                    <strong>
                      active {diagnostics.examples.activeCorpusCount} / workspace{" "}
                      {diagnostics.examples.workspaceCorpusCount}
                    </strong>
                    <p className="subtle-text">
                      selector picked {diagnostics.examples.selectedExamples.length}
                    </p>
                  </article>
                  <article className="stage2-insight-card">
                    <span className="field-label">Custom prompts</span>
                    <strong>{overrideCount}</strong>
                    <p className="subtle-text">stage prompts отличаются от базовых defaults</p>
                  </article>
                </div>
              </section>

              <details className="details-drawer">
                <summary>
                  <span>Effective prompts</span>
                  <small>Что реально driving Stage 2</small>
                </summary>
                <div className="details-content">
                  <p className="subtle-text">
                    Здесь видно, какой конкретный prompt и какой reasoning реально были настроены
                    для каждого Stage 2 этапа.
                  </p>
                  <div className="stage2-prompt-stage-list">
                    {diagnostics.effectivePrompting.promptStages.map((stage) => (
                      <article key={stage.stageId} className="stage2-prompt-stage-card">
                        <div className="stage2-prompt-stage-head">
                          <div>
                            <strong>{stage.label}</strong>
                            <p className="subtle-text">
                              LLM stage
                              {" · system prompt"}
                              {stage.usesImages ? " · uses extracted frames" : ""}
                              {stage.promptChars ? ` · ${stage.promptChars} chars` : ""}
                            </p>
                          </div>
                          {stage.isCustomPrompt ? (
                            <span className="badge">Custom prompt</span>
                          ) : (
                            <span className="badge muted">Default prompt</span>
                          )}
                        </div>
                        <p className="subtle-text">{stage.summary}</p>
                        <div className="stage2-prompt-meta-row">
                          <div className="stage2-prompt-meta">
                            <span className="field-label">Reasoning</span>
                            <p className="text-block">{formatReasoningEffort(stage.reasoningEffort)}</p>
                          </div>
                          <div className="stage2-prompt-meta">
                            <span className="field-label">Prompt source</span>
                            <p className="text-block">
                              {stage.isCustomPrompt ? "Channel-specific prompt" : "Default prompt"}
                            </p>
                          </div>
                        </div>
                        <div className="stage2-prompt-meta">
                          <span className="field-label">Configured prompt</span>
                          <p className="text-block">{stage.configuredPrompt}</p>
                        </div>
                        <details className="advanced-block">
                          <summary>Показать полный prompt с контекстом</summary>
                          <div className="advanced-content">
                            <pre className="json-view">{stage.promptText}</pre>
                          </div>
                        </details>
                      </article>
                    ))}
                  </div>
                </div>
              </details>

              <details className="details-drawer">
                <summary>
                  <span>Examples used</span>
                  <small>Active corpus + selector picks</small>
                </summary>
                <div className="details-content">
                  <section className="details-section">
                    <h3>Selection context</h3>
                    <p className="subtle-text">Writer brief: {diagnostics.selection.writerBrief}</p>
                    <p className="subtle-text">
                      Ranked angles: {diagnostics.selection.rankedAngles.map((item) => `${item.angle} (${item.score.toFixed(1)})`).join(", ")}
                    </p>
                    {diagnostics.selection.rationale ? (
                      <p className="subtle-text">Selector rationale: {diagnostics.selection.rationale}</p>
                    ) : null}
                    <p className="subtle-text">
                      Corpus source: {formatExamplesSourceLabel(diagnostics.examples.source)} · active{" "}
                      {diagnostics.examples.activeCorpusCount} / workspace{" "}
                      {diagnostics.examples.workspaceCorpusCount}
                    </p>
                  </section>

                  {([
                    ["selectedExamples", "Selector picks"],
                    ["availableExamples", "Available corpus"]
                  ] as const).map(([key, label]) => {
                    const items = diagnostics.examples[key];
                    return (
                      <section key={key} className="details-section">
                        <h3>
                          {label} ({items.length})
                        </h3>
                        {items.length === 0 ? (
                          <p className="subtle-text">В этом запуске элементов не было.</p>
                        ) : (
                          <ul className="stage2-example-list">
                            {items.map((item, index) => (
                              <li key={`${key}-${item.sourceChannelId}-${item.title}-${index}`} className="stage2-example-card">
                                <div className="stage2-example-head">
                                  <strong>{item.title}</strong>
                                  <span className="subtle-text">
                                    {item.sourceChannelName} · {item.clipType}
                                  </span>
                                </div>
                                <p className="subtle-text">
                                  TOP: {truncateText(item.overlayTop)}
                                </p>
                                <p className="subtle-text">
                                  BOTTOM: {truncateText(item.overlayBottom)}
                                </p>
                                <p className="subtle-text">
                                  quality {formatNullableNumber(item.qualityScore) ?? "n/a"} · score {formatNullableNumber(item.retrievalScore) ?? "n/a"} · {item.sampleKind ?? "n/a"}
                                </p>
                                {item.whyItWorks.length > 0 ? (
                                  <p className="subtle-text">
                                    Why it works: {item.whyItWorks.join(", ")}
                                  </p>
                                ) : null}
                                {item.retrievalReasons.length > 0 ? (
                                  <p className="subtle-text">
                                    Picked because: {item.retrievalReasons.join(", ")}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    );
                  })}
                </div>
              </details>
            </>
          ) : null}

          {!stage2 ? (
            <div className="empty-box">
              Результат второго этапа пуст. Сначала запустите второй этап.
              {!commentsAvailable ? " Комментарии необязательны для этого запуска." : ""}
            </div>
          ) : (
            <>
              <section className="options-grid options-grid-stage2">
                {stage2.output.captionOptions.map((option) => {
                  const selected = activeOption?.option === option.option;
                  const finalPick = stage2.output.finalPick.option === option.option;
                  const topRu = option.topRu?.trim() || option.top;
                  const bottomRu = option.bottomRu?.trim() || option.bottom;

                  return (
                    <article
                      key={option.option}
                      className={`option-card ${selected ? "selected" : ""}`}
                      aria-label={`Caption option ${option.option}`}
                    >
                      <div className="option-card-head">
                        <div className="option-title-row">
                          <h3>Вариант {option.option}</h3>
                          {finalPick ? <span className="badge">Финальный выбор</span> : null}
                          {selected ? <span className="badge muted">Выбран</span> : null}
                        </div>
                        <div className="option-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => onSelectOption(option.option)}
                          >
                            Выбрать
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() =>
                              onCopy(
                                [
                                  `TOP EN: ${option.top}`,
                                  `TOP RU: ${topRu}`,
                                  `BOTTOM EN: ${option.bottom}`,
                                  `BOTTOM RU: ${bottomRu}`
                                ].join("\n"),
                                `Вариант ${option.option} скопирован.`
                              )
                            }
                          >
                            Копировать
                          </button>
                        </div>
                      </div>

                      <div className="translation-row">
                        <span className="field-label">TOP</span>
                        <div className="translation-grid">
                          <div className="translation-col">
                            <span className="translation-label">EN</span>
                            <p className="text-block">{option.top}</p>
                          </div>
                          <div className="translation-col">
                            <span className="translation-label">RU</span>
                            <p className="text-block">{topRu}</p>
                          </div>
                        </div>
                      </div>
                      <div className="translation-row">
                        <span className="field-label">BOTTOM</span>
                        <div className="translation-grid">
                          <div className="translation-col">
                            <span className="translation-label">EN</span>
                            <p className="text-block">{option.bottom}</p>
                          </div>
                          <div className="translation-col">
                            <span className="translation-label">RU</span>
                            <p className="text-block">{bottomRu}</p>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>

              <section className="control-card">
                <div className="option-card-head">
                  <div>
                    <h3>Title options</h3>
                    <p className="subtle-text">
                      Выбранный title используется в имени экспортируемого файла.
                    </p>
                  </div>
                </div>
                <div className="options-grid options-grid-stage2">
                  {stage2.output.titleOptions.map((titleOption) => {
                    const selected = activeTitleOption?.option === titleOption.option;
                    const titleRu = titleOption.titleRu?.trim() || titleOption.title;

                    return (
                      <article
                        key={titleOption.option}
                        className={`option-card ${selected ? "selected" : ""}`}
                        aria-label={`Title option ${titleOption.option}`}
                      >
                        <div className="option-card-head">
                          <div className="option-title-row">
                            <h3>Title {titleOption.option}</h3>
                            {selected ? <span className="badge muted">Выбран для файла</span> : null}
                          </div>
                          <div className="option-actions">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => onSelectTitleOption(titleOption.option)}
                            >
                              Pick
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                onCopy(
                                  [`TITLE EN: ${titleOption.title}`, `TITLE RU: ${titleRu}`].join("\n"),
                                  `Title ${titleOption.option} скопирован.`
                                )
                              }
                            >
                              Копировать
                            </button>
                          </div>
                        </div>

                        <div className="translation-row">
                          <span className="field-label">TITLE</span>
                          <div className="translation-grid">
                            <div className="translation-col">
                              <span className="translation-label">EN</span>
                              <p className="text-block">{titleOption.title}</p>
                            </div>
                            <div className="translation-col">
                              <span className="translation-label">RU</span>
                              <p className="text-block">{titleRu}</p>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              {stage2.seo?.description ? (
                <section className="control-card seo-card">
                  <div className="option-card-head">
                    <div>
                      <h3 className="seo-card-title">Описание ролика</h3>
                      <p className="subtle-text">Сгенерировано отдельным SEO-запросом после опций.</p>
                    </div>
                    <div className="option-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => onCopy(stage2.seo?.description ?? "", "Описание скопировано.")}
                      >
                        Копировать описание
                      </button>
                      {stage2.seo?.tags ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => onCopy(stage2.seo?.tags ?? "", "Tags скопированы.")}
                        >
                          Копировать теги
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <pre className="seo-description-view">{stage2.seo.description}</pre>
                  {stage2.seo.tags ? (
                    <div className="translation-row">
                      <span className="field-label">Теги</span>
                      <p className="text-block seo-tags-view">{stage2.seo.tags}</p>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          )}

          {stage2 ? (
            <details className="advanced-block" open={jsonOpen} onToggle={(event) => setJsonOpen(event.currentTarget.open)}>
              <summary>Дополнительно</summary>
              <div className="advanced-content">
                <pre className="json-view">{JSON.stringify(stage2, null, 2)}</pre>
              </div>
            </details>
          ) : null}
        </div>
      }
    />
  );
}
