"use client";

import { FormEvent } from "react";
import { StepWorkspace } from "./StepWorkspace";

type Step1PasteLinkProps = {
  draftUrl: string;
  activeUrl: string | null;
  commentsFallbackActive?: boolean;
  isBusy: boolean;
  fetchAvailable: boolean;
  fetchBlockedReason?: string | null;
  downloadAvailable: boolean;
  downloadBlockedReason?: string | null;
  onDraftUrlChange: (value: string) => void;
  onPaste: () => void;
  onFetch: () => void;
  onDownloadSource: () => void;
};

export function Step1PasteLink({
  draftUrl,
  activeUrl,
  commentsFallbackActive,
  isBusy,
  fetchAvailable,
  fetchBlockedReason,
  downloadAvailable,
  downloadBlockedReason,
  onDraftUrlChange,
  onPaste,
  onFetch,
  onDownloadSource
}: Step1PasteLinkProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onFetch();
  };

  return (
    <StepWorkspace
      editLabel="Edit"
      previewLabel="Preview"
      left={
        <div className="step-panel-stack">
          <header className="step-head">
            <p className="kicker">Step 1</p>
            <h2>Source</h2>
            <p>Paste a Shorts or Reels link to fetch the source. Comments are optional and never block the flow.</p>
          </header>

          <section className="control-card">
            <form className="step-form" onSubmit={handleSubmit}>
              <label htmlFor="source-url" className="field-label">
                Video URL
              </label>
              <div className="input-with-action">
                <input
                  id="source-url"
                  className="text-input"
                  value={draftUrl}
                  onChange={(event) => onDraftUrlChange(event.target.value)}
                  placeholder="https://www.youtube.com/shorts/..."
                  autoComplete="off"
                />
                <button type="button" className="btn btn-ghost" onClick={onPaste} disabled={isBusy}>
                  Paste
                </button>
              </div>

              <p className="subtle-text">Examples: YouTube Shorts, Instagram Reels, Facebook Reels.</p>

              <div className="control-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isBusy || !fetchAvailable}
                  aria-busy={isBusy}
                  title={!fetchAvailable ? fetchBlockedReason ?? undefined : undefined}
                >
                  {isBusy ? "Fetching..." : "Fetch source"}
                </button>
              </div>
              {!fetchAvailable && fetchBlockedReason ? (
                <p className="subtle-text danger-text">{fetchBlockedReason}</p>
              ) : null}
              {commentsFallbackActive ? (
                <p className="subtle-text">
                  Comments were skipped on this server. Step 2 will continue with video-only context.
                </p>
              ) : null}
            </form>
          </section>

          <details className="advanced-block">
            <summary>Advanced</summary>
            <div className="advanced-content">
              <p className="subtle-text">Download original source mp4 for local backup.</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onDownloadSource}
                disabled={isBusy || !downloadAvailable}
                title={!downloadAvailable ? downloadBlockedReason ?? undefined : undefined}
              >
                Download source mp4
              </button>
              {!downloadAvailable && downloadBlockedReason ? (
                <p className="subtle-text danger-text">{downloadBlockedReason}</p>
              ) : null}
            </div>
          </details>
        </div>
      }
      right={
        <div className="preview-shell">
          <header className="preview-header">
            <h3>Live context</h3>
            <span className="preview-meta">Step 1 of 3</span>
          </header>

          <div className="preview-stage static">
            <div className="source-placeholder">
              <p className="placeholder-title">Source link</p>
              <p className="mono source-link-text">{activeUrl ?? "No source selected"}</p>
              <p className="subtle-text">
                After fetch completes, Step 2 will show caption options generated from the video, with comments if available.
              </p>
            </div>
          </div>
        </div>
      }
    />
  );
}
