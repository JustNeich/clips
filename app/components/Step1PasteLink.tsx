"use client";

import { FormEvent } from "react";
import type { SourceJobDetail } from "./types";
import { StepWorkspace } from "./StepWorkspace";

type Step1PasteLinkProps = {
  draftUrl: string;
  activeUrl: string | null;
  sourceJob: SourceJobDetail | null;
  sourceJobElapsedMs: number;
  commentsFallbackActive?: boolean;
  fetchBusy: boolean;
  downloadBusy: boolean;
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
  sourceJob,
  sourceJobElapsedMs,
  commentsFallbackActive,
  fetchBusy,
  downloadBusy,
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
                <button type="button" className="btn btn-ghost" onClick={onPaste} disabled={fetchBusy}>
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
                  disabled={fetchBusy || !fetchAvailable}
                  aria-busy={fetchBusy}
                  title={!fetchAvailable ? fetchBlockedReason ?? undefined : undefined}
                >
                  {fetchBusy ? "Получаем..." : "Получить источник"}
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
              {sourceJob ? (
                <div className="step-status-card">
                  <p className="field-label">Текущий Step 1 job</p>
                  <p className="step-status-title">
                    Job {sourceJob.jobId.slice(0, 8)} · {sourceJob.status === "running"
                      ? "в работе"
                      : sourceJob.status === "queued"
                        ? "в очереди"
                        : sourceJob.status === "completed"
                          ? "завершен"
                          : "ошибка"}
                  </p>
                  <p className="subtle-text">
                    {sourceJob.progress.detail ?? "Источник обрабатывается в фоне."}
                  </p>
                  {sourceJob.status === "running" ? (
                    <p className="subtle-text">Прошло: {(sourceJobElapsedMs / 1000).toFixed(1)}с</p>
                  ) : null}
                  {sourceJob.status === "failed" && sourceJob.errorMessage ? (
                    <p className="subtle-text danger-text">{sourceJob.errorMessage}</p>
                  ) : null}
                  {sourceJob.result ? (
                    <p className="subtle-text">
                      {sourceJob.result.commentsAvailable
                        ? `Комментарии готовы: ${sourceJob.result.commentsPayload?.totalComments ?? 0}`
                        : sourceJob.result.commentsError
                          ? `Продолжили без комментариев: ${sourceJob.result.commentsError}`
                          : "Продолжили без комментариев."}
                    </p>
                  ) : null}
                </div>
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
                disabled={fetchBusy || downloadBusy || !downloadAvailable}
                title={!downloadAvailable ? downloadBlockedReason ?? undefined : undefined}
              >
                {downloadBusy ? "Скачиваем..." : "Скачать исходный mp4"}
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
              {sourceJob ? (
                <div className="source-placeholder-meta">
                  <p className="subtle-text">
                    Step 1: {sourceJob.progress.detail ?? "Фоновая обработка активна."}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      }
    />
  );
}
