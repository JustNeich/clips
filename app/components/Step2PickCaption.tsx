"use client";

import { useEffect, useMemo, useState } from "react";
import { Stage2Response } from "./types";

type Step2PickCaptionProps = {
  stage2: Stage2Response | null;
  stageCreatedAt: string | null;
  instruction: string;
  canRunStage2: boolean;
  isRunning: boolean;
  selectedOption: number | null;
  onInstructionChange: (value: string) => void;
  onRunStage2: () => void;
  onSelectOption: (option: number) => void;
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

export function Step2PickCaption({
  stage2,
  stageCreatedAt,
  instruction,
  canRunStage2,
  isRunning,
  selectedOption,
  onInstructionChange,
  onRunStage2,
  onSelectOption,
  onCopy
}: Step2PickCaptionProps) {
  const [viewMode, setViewMode] = useState<"read" | "json">("read");

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

  return (
    <section className="step-wrap" aria-label="Step 2 pick caption">
      <article className="panel panel-main">
        <header className="panel-head">
          <p className="panel-kicker">Step 2</p>
          <h2>Review & Pick</h2>
          <p>Запусти Stage 2 и сразу сравни все варианты TOP/BOTTOM без переключений.</p>
        </header>

        <label className="field-label" htmlFor="instruction">
          Regeneration instruction (optional)
        </label>
        <textarea
          id="instruction"
          className="text-area"
          rows={3}
          value={instruction}
          onChange={(event) => onInstructionChange(event.target.value.slice(0, 2000))}
          placeholder="Example: keep it shorter, add one dry joke, avoid slang."
        />

        <div className="action-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRunStage2}
            disabled={!canRunStage2 || isRunning}
            aria-busy={isRunning}
          >
            {isRunning ? "Running Stage 2..." : "Run Stage 2"}
          </button>
          <div className="toggle-row" role="tablist" aria-label="Stage 2 view mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "read"}
              className={`toggle-btn ${viewMode === "read" ? "active" : ""}`}
              onClick={() => setViewMode("read")}
            >
              Read
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
        </div>

        {!stage2 ? (
          <div className="empty-box">Stage 2 output is empty. Run Stage 2 after Step 1.</div>
        ) : viewMode === "json" ? (
          <pre className="json-view">{JSON.stringify(stage2, null, 2)}</pre>
        ) : (
          <div className="captions-list">
            {stage2.output.captionOptions.map((option) => {
              const selected = activeOption?.option === option.option;
              const finalPick = stage2.output.finalPick.option === option.option;

              return (
                <article
                  key={option.option}
                  className={`caption-full-card ${selected ? "selected" : ""}`}
                  aria-label={`Caption option ${option.option}`}
                >
                  <div className="caption-full-head">
                    <div className="caption-full-title">
                      <h3>Option {option.option}</h3>
                      {finalPick ? <span className="pill">Final pick</span> : null}
                      {selected ? <span className="pill muted">Used in Step 3</span> : null}
                    </div>
                    <div className="caption-card-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => onSelectOption(option.option)}
                      >
                        Use for render
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          onCopy(
                            `TOP: ${option.top}\nBOTTOM: ${option.bottom}`,
                            `Option ${option.option} copied.`
                          )
                        }
                      >
                        Copy both
                      </button>
                    </div>
                  </div>

                  <div className="caption-field">
                    <span className="field-label">TOP</span>
                    <div className="text-block">{option.top}</div>
                  </div>

                  <div className="caption-field">
                    <span className="field-label">BOTTOM</span>
                    <div className="text-block">{option.bottom}</div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </article>

      <article className="panel panel-side">
        <h3>Stage 2 Output</h3>
        {stageCreatedAt ? <p className="subtle-text">Updated {formatDate(stageCreatedAt)}</p> : null}
        <p className="subtle-text">Selected option: {activeOption?.option ?? "—"}</p>
        <p className="subtle-text">Final pick: Option {stage2?.output.finalPick.option ?? "—"}</p>
        <p className="subtle-text">
          Model: {stage2?.model ?? "—"} · Reasoning: {stage2?.reasoningEffort ?? "—"}
        </p>
      </article>
    </section>
  );
}
