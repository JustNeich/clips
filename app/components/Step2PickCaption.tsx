"use client";

import { useEffect, useMemo, useState } from "react";
import { Stage2Response } from "./types";
import { StepWorkspace } from "./StepWorkspace";

type Step2PickCaptionProps = {
  channelName?: string | null;
  channelUsername?: string | null;
  stage2: Stage2Response | null;
  stageCreatedAt: string | null;
  commentsAvailable?: boolean;
  instruction: string;
  canRunStage2: boolean;
  runBlockedReason?: string | null;
  isRunning: boolean;
  expectedDurationMs: number;
  elapsedMs: number;
  selectedOption: number | null;
  selectedTitleOption: number | null;
  onInstructionChange: (value: string) => void;
  onRunStage2: () => void;
  onSelectOption: (option: number) => void;
  onSelectTitleOption: (option: number) => void;
  onCopy: (value: string, successMessage: string) => void;
};

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

export function Step2PickCaption({
  channelName,
  channelUsername,
  stage2,
  stageCreatedAt,
  commentsAvailable = true,
  instruction,
  canRunStage2,
  runBlockedReason,
  isRunning,
  expectedDurationMs,
  elapsedMs,
  selectedOption,
  selectedTitleOption,
  onInstructionChange,
  onRunStage2,
  onSelectOption,
  onSelectTitleOption,
  onCopy
}: Step2PickCaptionProps) {
  const [jsonOpen, setJsonOpen] = useState(false);

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
  const progressRatio = useMemo(
    () => getStage2ProgressRatio(elapsedMs, expectedDurationMs),
    [elapsedMs, expectedDurationMs]
  );

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
                disabled={!canRunStage2 || isRunning}
                aria-busy={isRunning}
                title={!canRunStage2 ? runBlockedReason ?? undefined : undefined}
              >
                {isRunning ? "Генерируем..." : "Сгенерировать варианты"}
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
                    : "Идет генерация. Оценка основана на предыдущем успешном запуске."
                  : "Оценка обновляется после каждого успешного запуска второго этапа."}
              </p>
            </section>
            {!canRunStage2 && runBlockedReason ? (
              <p className="subtle-text danger-text">{runBlockedReason}</p>
            ) : null}
          </section>

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
