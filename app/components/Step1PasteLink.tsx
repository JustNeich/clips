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
      editLabel="Редактирование"
      previewLabel="Предпросмотр"
      left={
        <div className="step-panel-stack">
          <header className="step-head">
            <p className="kicker">Шаг 1</p>
            <h2>Источник</h2>
            <p>Вставьте ссылку на Shorts или Reels, чтобы получить исходник. Комментарии необязательны и не блокируют процесс.</p>
          </header>

          <section className="control-card">
            <form className="step-form" onSubmit={handleSubmit}>
              <label htmlFor="source-url" className="field-label">
                Ссылка на видео
              </label>
              <div className="input-with-action">
                <input
                  id="source-url"
                  className="text-input"
                  value={draftUrl}
                  onChange={(event) => onDraftUrlChange(event.target.value)}
                  placeholder="https://www.instagram.com/reel/... или https://www.youtube.com/shorts/..."
                  autoComplete="off"
                />
                <button type="button" className="btn btn-ghost" onClick={onPaste} disabled={isBusy}>
                  Вставить
                </button>
              </div>

              <p className="subtle-text">
                Примеры: `instagram.com/reel/...`, `instagram.com/share/reel/...`, `youtube.com/shorts/...`,
                `facebook.com/reel/...`
              </p>

              <div className="control-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isBusy || !fetchAvailable}
                  aria-busy={isBusy}
                  title={!fetchAvailable ? fetchBlockedReason ?? undefined : undefined}
                >
                  {isBusy ? "Получаем..." : "Получить источник"}
                </button>
              </div>
              {!fetchAvailable && fetchBlockedReason ? (
                <p className="subtle-text danger-text">{fetchBlockedReason}</p>
              ) : null}
              {commentsFallbackActive ? (
                <p className="subtle-text">
                  Комментарии пропущены на этом сервере. Второй этап продолжит работу только с видеоконтекстом.
                </p>
              ) : null}
            </form>
          </section>

          <details className="advanced-block">
            <summary>Дополнительно</summary>
            <div className="advanced-content">
              <p className="subtle-text">Скачайте исходный mp4 для локального бэкапа.</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onDownloadSource}
                disabled={isBusy || !downloadAvailable}
                title={!downloadAvailable ? downloadBlockedReason ?? undefined : undefined}
              >
                Скачать исходный mp4
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
            <h3>Текущий контекст</h3>
            <span className="preview-meta">Шаг 1 из 3</span>
          </header>

          <div className="preview-stage static">
            <div className="source-placeholder">
              <p className="placeholder-title">Ссылка на источник</p>
              <p className="mono source-link-text">{activeUrl ?? "Источник не выбран"}</p>
              <p className="subtle-text">
                После завершения загрузки второй этап покажет варианты подписей, сгенерированные по видео, и комментарии, если они доступны.
              </p>
            </div>
          </div>
        </div>
      }
    />
  );
}
