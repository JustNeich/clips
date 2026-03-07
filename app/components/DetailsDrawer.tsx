"use client";

import { CommentsPayload, ChatEvent } from "./types";
import { sanitizeDisplayText } from "../../lib/ui-error";

type DetailsDrawerProps = {
  events: ChatEvent[];
  comments: CommentsPayload | null;
  isBusyComments: boolean;
  onLoadComments: () => void;
  onDownloadCommentsJson: (payload: CommentsPayload) => void;
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

export function DetailsDrawer({
  events,
  comments,
  isBusyComments,
  onLoadComments,
  onDownloadCommentsJson
}: DetailsDrawerProps) {
  const ordered = [...events].reverse();
  const formatEventText = (event: ChatEvent): string => {
    return sanitizeDisplayText(event.text);
  };

  return (
    <details className="details-drawer">
      <summary>
        <span>Details</span>
        <small>Logs, comments, diagnostics</small>
      </summary>

      <div className="details-content">
        <div className="details-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onLoadComments}
            disabled={isBusyComments}
            aria-busy={isBusyComments}
          >
            {isBusyComments ? "Loading comments..." : "Fetch comments"}
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            disabled={!comments}
            onClick={() => {
              if (comments) {
                onDownloadCommentsJson(comments);
              }
            }}
          >
            Download comments JSON
          </button>
        </div>

        <section className="details-section" aria-label="Comments summary">
          <h3>Comments</h3>
          {!comments ? (
            <p className="subtle-text">No comments fetched yet.</p>
          ) : (
            <>
              <p className="subtle-text">Total: {comments.totalComments}</p>
              <ol className="comments-preview">
                {comments.topComments.slice(0, 5).map((item) => (
                  <li key={item.id}>
                    <strong>@{item.author}</strong>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <section className="details-section" aria-label="Event logs">
          <h3>Event log</h3>
          {ordered.length === 0 ? (
            <p className="subtle-text">No events yet.</p>
          ) : (
            <ul className="details-log-list">
              {ordered.map((event) => (
                <li key={event.id} className={`log-item tone-${event.type === "error" ? "error" : "default"}`}>
                  <div className="log-meta">
                    <span>{event.role}</span>
                    <span>{event.type}</span>
                    <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
                  </div>
                  <p>{formatEventText(event)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}
