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

function getRoleLabel(role: ChatEvent["role"]): string {
  if (role === "user") {
    return "Вы";
  }
  if (role === "assistant") {
    return "Ассистент";
  }
  return "Система";
}

function getEventTypeLabel(type: ChatEvent["type"]): string {
  switch (type) {
    case "note":
      return "Заметка";
    case "error":
      return "Ошибка";
    case "comments":
      return "Комментарии";
    case "stage2":
      return "Этап 2";
    default:
      return type;
  }
}

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
        <span>Логи и комментарии</span>
        <small>редко нужно в ежедневном цикле</small>
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
            {isBusyComments ? "Загрузка комментариев..." : "Загрузить комментарии"}
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
            Скачать JSON комментариев
          </button>
        </div>

        <section className="details-section" aria-label="Сводка по комментариям">
          <h3>Комментарии</h3>
          {!comments ? (
            <p className="subtle-text">Комментарии еще не загружены.</p>
          ) : (
            <>
              <p className="subtle-text">Всего: {comments.totalComments}</p>
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

        <section className="details-section" aria-label="Логи событий">
          <h3>Журнал событий</h3>
          {ordered.length === 0 ? (
            <p className="subtle-text">Событий пока нет.</p>
          ) : (
            <ul className="details-log-list">
              {ordered.map((event) => (
                <li key={event.id} className={`log-item tone-${event.type === "error" ? "error" : "default"}`}>
                  <div className="log-meta">
                    <span>{getRoleLabel(event.role)}</span>
                    <span>{getEventTypeLabel(event.type)}</span>
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
