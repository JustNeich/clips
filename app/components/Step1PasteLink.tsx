"use client";

import { FormEvent } from "react";

type Step1PasteLinkProps = {
  draftUrl: string;
  activeUrl: string | null;
  isBusy: boolean;
  onDraftUrlChange: (value: string) => void;
  onPaste: () => void;
  onFetch: () => void;
  onDownloadSource: () => void;
};

export function Step1PasteLink({
  draftUrl,
  activeUrl,
  isBusy,
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
    <section className="step-wrap" aria-label="Step 1 paste link">
      <article className="panel panel-main">
        <header className="panel-head">
          <p className="panel-kicker">Step 1</p>
          <h2>Paste Link</h2>
          <p>Insert a Shorts/Reels link and fetch source data.</p>
        </header>

        <form className="step-form" onSubmit={handleSubmit}>
          <label htmlFor="source-url" className="field-label">
            Video URL
          </label>
          <div className="input-row">
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

          <p className="subtle-text">Example: `https://www.youtube.com/shorts/...`</p>

          <div className="action-row">
            <button type="submit" className="btn btn-primary" disabled={isBusy} aria-busy={isBusy}>
              {isBusy ? "Fetching..." : "Run Stage 1 / Fetch"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onDownloadSource}
              disabled={isBusy}
            >
              Download source mp4
            </button>
          </div>
        </form>
      </article>

      <article className="panel panel-side">
        <h3>Current Source</h3>
        <p className="mono">{activeUrl ?? "No source selected yet."}</p>
        <p className="subtle-text">
          This step fetches comments and prepares data for Stage 2.
        </p>
      </article>
    </section>
  );
}

