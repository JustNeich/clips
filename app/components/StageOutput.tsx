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
  lines.push("Stage 2 Output");
  lines.push(`Source: ${stage2.source.url}`);
  lines.push(`Title: ${stage2.source.title}`);
  lines.push(`Model: ${stage2.model ?? "default"}`);
  lines.push(`Reasoning: ${stage2.reasoningEffort ?? "default"}`);
  if (stage2.userInstructionUsed) {
    lines.push(`User Instruction: ${stage2.userInstructionUsed}`);
  }
  lines.push("");
  lines.push("Input Analysis");
  lines.push(`Visual Anchors: ${stage2.output.inputAnalysis.visualAnchors.join(" | ")}`);
  lines.push(`Comment Vibe: ${stage2.output.inputAnalysis.commentVibe}`);
  lines.push(`Key Phrase: ${stage2.output.inputAnalysis.keyPhraseToAdapt}`);
  lines.push("");
  lines.push("Caption Options");
  for (const option of stage2.output.captionOptions) {
    lines.push(`Option ${option.option}`);
    lines.push(`TOP: ${option.top}`);
    lines.push(`BOTTOM: ${option.bottom}`);
    lines.push("");
  }
  lines.push("Title Options");
  stage2.output.titleOptions.forEach((title, index) => {
    lines.push(`${index + 1}. ${title}`);
  });
  lines.push("");
  lines.push(`Final Pick: Option ${stage2.output.finalPick.option}`);
  lines.push(`Reason: ${stage2.output.finalPick.reason}`);
  if (stage2.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings");
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
    <aside className="stage-panel" aria-label="Stage 2 output">
      <header className="stage-panel-header">
        <div>
          <p className="stage-kicker">Main output</p>
          <h3>Stage 2 Output</h3>
          {stageCreatedAt ? <p className="subtle-text">Updated {formatDate(stageCreatedAt)}</p> : null}
        </div>

        <div className="stage-header-actions">
          <div className="toggle-group" role="tablist" aria-label="Output view mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "pretty"}
              className={`toggle-btn ${viewMode === "pretty" ? "active" : ""}`}
              onClick={() => setViewMode("pretty")}
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

          <button
            type="button"
            className="icon-btn"
            disabled={!stage2}
            onClick={() =>
              stage2
                ? onCopyText(buildStage2PlainText(stage2), "Stage 2 output copied.")
                : undefined
            }
            aria-label="Copy full stage output"
            title="Copy full output"
          >
            ⧉
          </button>
        </div>
      </header>

      <div className="stage-panel-body">
        {!stage2 ? (
          <div className="empty-state large">
            <h3>No Stage 2 result yet</h3>
            <p>{isRunning ? "Stage 2 is running..." : "Run Stage 2 to see final pick, analysis, and captions."}</p>
          </div>
        ) : viewMode === "json" ? (
          <pre className="json-view">{JSON.stringify(stage2, null, 2)}</pre>
        ) : (
          <div className="stage-sections">
            <section className="stage-section final-pick">
              <div className="section-head">
                <h4>FINAL PICK</h4>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() =>
                    onCopyText(
                      `Option ${stage2.output.finalPick.option}\n${stage2.output.finalPick.reason}`,
                      "Final pick copied."
                    )
                  }
                  aria-label="Copy final pick"
                >
                  ⧉
                </button>
              </div>
              <p className="final-pick-option">Option {stage2.output.finalPick.option}</p>
              <p>{stage2.output.finalPick.reason}</p>
              <p className="subtle-text">
                Model {stage2.model ?? "default"} · Reasoning {stage2.reasoningEffort ?? "default"}
              </p>
            </section>

            <section className="stage-section">
              <div className="section-head">
                <h4>INPUT ANALYSIS</h4>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() =>
                    onCopyText(
                      [
                        `Visual Anchors: ${stage2.output.inputAnalysis.visualAnchors.join(" | ")}`,
                        `Comment Vibe: ${stage2.output.inputAnalysis.commentVibe}`,
                        `Key Phrase: ${stage2.output.inputAnalysis.keyPhraseToAdapt}`
                      ].join("\n"),
                      "Input analysis copied."
                    )
                  }
                  aria-label="Copy input analysis"
                >
                  ⧉
                </button>
              </div>
              <ul className="analysis-list">
                <li>
                  <strong>Visual Anchors:</strong> {stage2.output.inputAnalysis.visualAnchors.join(" | ")}
                </li>
                <li>
                  <strong>Comment Vibe:</strong> {stage2.output.inputAnalysis.commentVibe}
                </li>
                <li>
                  <strong>Key Phrase:</strong> {stage2.output.inputAnalysis.keyPhraseToAdapt}
                </li>
              </ul>
            </section>

            <section className="stage-section">
              <h4>CAPTION OPTIONS</h4>
              <div className="caption-grid" role="list" aria-label="Caption options">
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
                        <span className="caption-label">Option {option.option}</span>
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
                            `Option ${option.option} copied.`
                          )
                        }
                        aria-label={`Copy option ${option.option}`}
                      >
                        ⧉
                      </button>
                    </div>
                  );
                })}
              </div>

              {selectedCaption ? (
                <p className="subtle-text">
                  Selected Option {selectedCaption.option} · tap card to switch
                </p>
              ) : null}
            </section>

            <section className="stage-section">
              <h4>TITLE OPTIONS</h4>
              <ol className="title-list">
                {stage2.output.titleOptions.map((title, index) => (
                  <li key={`${title}_${index}`}>{title}</li>
                ))}
              </ol>
            </section>

          </div>
        )}
      </div>
    </aside>
  );
}
