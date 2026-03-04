"use client";

import { useEffect, useMemo, useState } from "react";
import { Stage2Response } from "./types";
import { StepWorkspace } from "./StepWorkspace";

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

  return (
    <StepWorkspace
      editLabel="Edit"
      previewLabel="Preview"
      left={
        <div className="step-panel-stack">
          <header className="step-head">
            <p className="kicker">Step 2</p>
            <h2>Pick</h2>
            <p>Run Stage 2, compare all options at once, then choose one for render.</p>
          </header>

          <section className="control-card">
            <label className="field-label" htmlFor="instruction">
              Regeneration instruction (optional)
            </label>
            <textarea
              id="instruction"
              className="text-area"
              rows={3}
              value={instruction}
              onChange={(event) => onInstructionChange(event.target.value.slice(0, 2000))}
              placeholder="Example: make it shorter, add one dry joke, avoid slang."
            />
            <p className="subtle-text">Use this if the model misunderstood context or tone.</p>
            <div className="control-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onRunStage2}
                disabled={!canRunStage2 || isRunning}
                aria-busy={isRunning}
              >
                {isRunning ? "Running Stage 2..." : "Run Stage 2"}
              </button>
            </div>
          </section>

          {!stage2 ? (
            <div className="empty-box">Stage 2 output is empty. Run Stage 2 first.</div>
          ) : (
            <section className="options-grid">
              {stage2.output.captionOptions.map((option) => {
                const selected = activeOption?.option === option.option;
                const finalPick = stage2.output.finalPick.option === option.option;

                return (
                  <article
                    key={option.option}
                    className={`option-card ${selected ? "selected" : ""}`}
                    aria-label={`Caption option ${option.option}`}
                  >
                    <div className="option-card-head">
                      <div className="option-title-row">
                        <h3>Option {option.option}</h3>
                        {finalPick ? <span className="badge">Final pick</span> : null}
                        {selected ? <span className="badge muted">Selected</span> : null}
                      </div>
                      <div className="option-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => onSelectOption(option.option)}
                        >
                          Use
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            onCopy(`TOP: ${option.top}\nBOTTOM: ${option.bottom}`, `Option ${option.option} copied.`)
                          }
                        >
                          Copy
                        </button>
                      </div>
                    </div>

                    <div className="field-stack">
                      <span className="field-label">TOP</span>
                      <p className="text-block">{option.top}</p>
                    </div>
                    <div className="field-stack">
                      <span className="field-label">BOTTOM</span>
                      <p className="text-block">{option.bottom}</p>
                    </div>
                  </article>
                );
              })}
            </section>
          )}

          {stage2 ? (
            <details className="advanced-block" open={jsonOpen} onToggle={(event) => setJsonOpen(event.currentTarget.open)}>
              <summary>Advanced</summary>
              <div className="advanced-content">
                <pre className="json-view">{JSON.stringify(stage2, null, 2)}</pre>
              </div>
            </details>
          ) : null}
        </div>
      }
      right={
        <div className="preview-shell">
          <header className="preview-header">
            <h3>Stage 2 output</h3>
            <span className="preview-meta">{stageCreatedAt ? `Updated ${formatDate(stageCreatedAt)}` : "No run yet"}</span>
          </header>

          <div className="preview-stage">
            <div className="caption-preview-card">
              <div className="caption-preview-top">{activeOption?.top ?? "TOP text appears here"}</div>
              <div className="caption-preview-slot">VIDEO SLOT</div>
              <div className="caption-preview-bottom">{activeOption?.bottom ?? "BOTTOM text appears here"}</div>
            </div>
          </div>

          <div className="summary-card">
            <p>
              Selected: <strong>{activeOption ? `Option ${activeOption.option}` : "—"}</strong>
            </p>
            <p>
              Final pick: <strong>{stage2 ? `Option ${stage2.output.finalPick.option}` : "—"}</strong>
            </p>
            <p>
              Model: <strong>{stage2?.model ?? "—"}</strong>
            </p>
          </div>
        </div>
      }
    />
  );
}
