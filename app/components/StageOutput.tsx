"use client";

import { useEffect, useMemo, useState } from "react";
import { Stage2Response } from "./types";

type StageOutputProps = {
  stage2: Stage2Response | null;
  stageCreatedAt: string | null;
  isRunning: boolean;
  onCopyText: (value: string, successMessage: string) => void;
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

function buildStage2PlainText(stage2: Stage2Response): string {
  const lines: string[] = [];
  lines.push("Результат этапа 2");
  lines.push(`Источник: ${stage2.source.url}`);
  lines.push(`Заголовок: ${stage2.source.title}`);
  lines.push(`Модель: ${stage2.model ?? "по умолчанию"}`);
  lines.push(`Режим рассуждения: ${stage2.reasoningEffort ?? "по умолчанию"}`);
  if (stage2.userInstructionUsed) {
    lines.push(`Инструкция пользователя: ${stage2.userInstructionUsed}`);
  }
  lines.push("");
  lines.push("Анализ входных данных");
  lines.push(`Визуальные опоры: ${stage2.output.inputAnalysis.visualAnchors.join(" | ")}`);
  lines.push(`Настроение комментариев: ${stage2.output.inputAnalysis.commentVibe}`);
  lines.push(`Ключевая фраза: ${stage2.output.inputAnalysis.keyPhraseToAdapt}`);
  lines.push("");
  lines.push("Варианты подписей");
  for (const option of stage2.output.captionOptions) {
    lines.push(`Вариант ${option.option}`);
    lines.push(`TOP: ${option.top}`);
    lines.push(`BOTTOM: ${option.bottom}`);
    lines.push("");
  }
  lines.push("Варианты заголовка");
  stage2.output.titleOptions.forEach((titleOption) => {
    lines.push(`${titleOption.option}. EN: ${titleOption.title}`);
    lines.push(`   RU: ${titleOption.titleRu ?? titleOption.title}`);
  });
  lines.push("");
  lines.push(`Финальный выбор: вариант ${stage2.output.finalPick.option}`);
  lines.push(`Причина: ${stage2.output.finalPick.reason}`);
  if (stage2.warnings.length > 0) {
    lines.push("");
    lines.push("Предупреждения");
    for (const warning of stage2.warnings) {
      lines.push(`- ${warning.field}: ${warning.message}`);
    }
  }
  return lines.join("\n");
}

export function StageOutput({
  stage2,
  stageCreatedAt,
  isRunning,
  onCopyText
}: StageOutputProps) {
  const [viewMode, setViewMode] = useState<"pretty" | "json">("pretty");
  const [selectedOption, setSelectedOption] = useState<number>(1);

  useEffect(() => {
    if (!stage2) {
      setSelectedOption(1);
      return;
    }
    setSelectedOption(stage2.output.finalPick.option);
  }, [stage2]);

  const selectedCaption = useMemo(() => {
    if (!stage2) {
      return null;
    }
    return (
      stage2.output.captionOptions.find((item) => item.option === selectedOption) ??
      stage2.output.captionOptions[0] ??
      null
    );
  }, [selectedOption, stage2]);

  return (
    <aside className="stage-panel" aria-label="Результат этапа 2">
      <header className="stage-panel-header">
        <div>
          <p className="stage-kicker">Основной результат</p>
          <h3>Результат этапа 2</h3>
          {stageCreatedAt ? <p className="subtle-text">Обновлено {formatDate(stageCreatedAt)}</p> : null}
        </div>

        <div className="stage-header-actions">
          <div className="toggle-group" role="tablist" aria-label="Режим просмотра результата">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "pretty"}
              className={`toggle-btn ${viewMode === "pretty" ? "active" : ""}`}
              onClick={() => setViewMode("pretty")}
            >
              Просмотр
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "json"}
              className={`toggle-btn ${viewMode === "json" ? "active" : ""}`}
              onClick={() => setViewMode("json")}
            >
              JSON
            </button>
          </div>

          <button
            type="button"
            className="icon-btn"
            disabled={!stage2}
            onClick={() =>
              stage2
                ? onCopyText(buildStage2PlainText(stage2), "Результат этапа 2 скопирован.")
                : undefined
            }
            aria-label="Скопировать весь результат этапа"
            title="Скопировать весь результат"
          >
            ⧉
          </button>
        </div>
      </header>

      <div className="stage-panel-body">
        {!stage2 ? (
          <div className="empty-state large">
            <h3>Результата второго этапа пока нет</h3>
            <p>{isRunning ? "Второй этап выполняется..." : "Запустите второй этап, чтобы увидеть финальный выбор, анализ и подписи."}</p>
          </div>
        ) : viewMode === "json" ? (
          <pre className="json-view">{JSON.stringify(stage2, null, 2)}</pre>
        ) : (
          <div className="stage-sections">
            <section className="stage-section final-pick">
              <div className="section-head">
                <h4>ФИНАЛЬНЫЙ ВЫБОР</h4>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() =>
                    onCopyText(
                      `Вариант ${stage2.output.finalPick.option}\n${stage2.output.finalPick.reason}`,
                      "Финальный выбор скопирован."
                    )
                  }
                  aria-label="Скопировать финальный выбор"
                >
                  ⧉
                </button>
              </div>
              <p className="final-pick-option">Вариант {stage2.output.finalPick.option}</p>
              <p>{stage2.output.finalPick.reason}</p>
              <p className="subtle-text">
                Модель {stage2.model ?? "по умолчанию"} · Рассуждение {stage2.reasoningEffort ?? "по умолчанию"}
              </p>
            </section>

            <section className="stage-section">
              <div className="section-head">
                <h4>АНАЛИЗ ВХОДНЫХ ДАННЫХ</h4>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() =>
                    onCopyText(
                      [
                        `Визуальные опоры: ${stage2.output.inputAnalysis.visualAnchors.join(" | ")}`,
                        `Настроение комментариев: ${stage2.output.inputAnalysis.commentVibe}`,
                        `Ключевая фраза: ${stage2.output.inputAnalysis.keyPhraseToAdapt}`
                      ].join("\n"),
                      "Анализ входных данных скопирован."
                    )
                  }
                  aria-label="Скопировать анализ входных данных"
                >
                  ⧉
                </button>
              </div>
              <ul className="analysis-list">
                <li>
                  <strong>Визуальные опоры:</strong> {stage2.output.inputAnalysis.visualAnchors.join(" | ")}
                </li>
                <li>
                  <strong>Настроение комментариев:</strong> {stage2.output.inputAnalysis.commentVibe}
                </li>
                <li>
                  <strong>Ключевая фраза:</strong> {stage2.output.inputAnalysis.keyPhraseToAdapt}
                </li>
              </ul>
            </section>

            <section className="stage-section">
              <h4>ВАРИАНТЫ ПОДПИСЕЙ</h4>
              <div className="caption-grid" role="list" aria-label="Варианты подписей">
                {stage2.output.captionOptions.map((option) => {
                  const selected = option.option === selectedOption;
                  return (
                    <div
                      key={option.option}
                      className={`caption-card ${selected ? "selected" : ""}`}
                      role="listitem"
                    >
                      <button
                        type="button"
                        className="caption-select"
                        onClick={() => setSelectedOption(option.option)}
                        aria-pressed={selected}
                      >
                        <span className="caption-label">Вариант {option.option}</span>
                        <p>
                          <strong>TOP:</strong> {option.top}
                        </p>
                        <p>
                          <strong>BOTTOM:</strong> {option.bottom}
                        </p>
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() =>
                          onCopyText(
                            `TOP: ${option.top}\nBOTTOM: ${option.bottom}`,
                            `Вариант ${option.option} скопирован.`
                          )
                        }
                        aria-label={`Скопировать вариант ${option.option}`}
                      >
                        ⧉
                      </button>
                    </div>
                  );
                })}
              </div>

              {selectedCaption ? (
                <p className="subtle-text">
                  Выбран вариант {selectedCaption.option} · нажмите на карточку, чтобы переключить
                </p>
              ) : null}
            </section>

            <section className="stage-section">
              <h4>ВАРИАНТЫ ЗАГОЛОВКА</h4>
              <ol className="title-list">
                {stage2.output.titleOptions.map((titleOption) => (
                  <li key={`${titleOption.option}_${titleOption.title}`}>
                    <strong>{titleOption.title}</strong>
                    <br />
                    <span className="subtle-text">{titleOption.titleRu ?? titleOption.title}</span>
                  </li>
                ))}
              </ol>
            </section>

          </div>
        )}
      </div>
    </aside>
  );
}
