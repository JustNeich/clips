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

function formatSourceProviderLabel(provider: Stage2Response["source"]["downloadProvider"]): string | null {
  if (provider === "visolix") {
    return "Visolix";
  }
  if (provider === "ytDlp") {
    return "Local downloader fallback";
  }
  return null;
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
  const sourceProviderLabel = formatSourceProviderLabel(stage2?.source.downloadProvider);

  return (
    <StepWorkspace
      editLabel="Edit"
      previewLabel="Preview"
      left={
        <div className="step-panel-stack">
          <header className="step-head">
            <p className="kicker">Step 2</p>
            <h2>Pick</h2>
            <p>Generate caption options, compare them side by side, then choose one for render.</p>
            {channelName ? (
              <p className="subtle-text">
                Channel: <strong>{channelName}</strong>
                {channelUsername ? ` (@${channelUsername})` : ""}
              </p>
            ) : null}
            {stageCreatedAt ? (
              <p className="subtle-text">Updated: {formatDate(stageCreatedAt)}</p>
            ) : null}
            {sourceProviderLabel ? (
              <p className="subtle-text">Source media: {sourceProviderLabel}</p>
            ) : null}
            {!commentsAvailable ? (
              <p className="subtle-text">
                Comments are unavailable on this server. Stage 2 is using video-only context.
              </p>
            ) : null}
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
                title={!canRunStage2 ? runBlockedReason ?? undefined : undefined}
              >
                {isRunning ? "Generating..." : "Generate options"}
              </button>
            </div>
            {!canRunStage2 && runBlockedReason ? (
              <p className="subtle-text danger-text">{runBlockedReason}</p>
            ) : null}
          </section>

          {!stage2 ? (
            <div className="empty-box">
              Stage 2 output is empty. Run Stage 2 first.
              {!commentsAvailable ? " Comments are optional for this run." : ""}
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
                              onCopy(
                                [
                                  `TOP EN: ${option.top}`,
                                  `TOP RU: ${topRu}`,
                                  `BOTTOM EN: ${option.bottom}`,
                                  `BOTTOM RU: ${bottomRu}`
                                ].join("\n"),
                                `Option ${option.option} copied.`
                              )
                            }
                          >
                            Copy
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
                        Copy description
                      </button>
                      {stage2.seo?.tags ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => onCopy(stage2.seo?.tags ?? "", "Tags скопированы.")}
                        >
                          Copy tags
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <pre className="seo-description-view">{stage2.seo.description}</pre>
                  {stage2.seo.tags ? (
                    <div className="translation-row">
                      <span className="field-label">Tags</span>
                      <p className="text-block seo-tags-view">{stage2.seo.tags}</p>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
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
    />
  );
}
