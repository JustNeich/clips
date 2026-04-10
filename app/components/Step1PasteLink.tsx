"use client";

import React, { FormEvent, useMemo, useRef, useState } from "react";
import type { SourceJobDetail, SourceProviderErrorSummary, SourceProviderId } from "./types";
import { StepWorkspace } from "./StepWorkspace";
import { getUploadedSourceDisplayName, isUploadedSourceUrl } from "../../lib/uploaded-source";

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
  uploadBusy: boolean;
  uploadAvailable: boolean;
  uploadBlockedReason?: string | null;
  autoRunStage2Enabled: boolean;
  downloadAvailable: boolean;
  downloadBlockedReason?: string | null;
  showCreateNextChatShortcut?: boolean;
  onDraftUrlChange: (value: string) => void;
  onPaste: () => void;
  onFetch: () => void;
  onUploadFile: (file: File) => void;
  onAutoRunStage2Change: (value: boolean) => void;
  onDownloadSource: () => void;
  onCreateNextChat?: () => void;
};

type SourcePreview =
  | {
      kind: "youtube";
      href: string;
      embedUrl: string;
      label: string;
    }
  | {
      kind: "video";
      href: string;
      videoUrl: string;
      label: string;
    }
  | {
      kind: "external";
      href: string;
      label: string;
    };

function resolveSourcePreview(rawUrl: string | null): SourcePreview | null {
  const trimmed = rawUrl?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  try {
    if (isUploadedSourceUrl(trimmed)) {
      const previewUrl = `/api/source-media?sourceUrl=${encodeURIComponent(trimmed)}`;
      return {
        kind: "video",
        href: previewUrl,
        videoUrl: previewUrl,
        label: getUploadedSourceDisplayName(trimmed) ?? "uploaded.mp4"
      };
    }

    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith(".mp4") || pathname.endsWith(".webm") || pathname.endsWith(".mov")) {
      return {
        kind: "video",
        href: parsed.toString(),
        videoUrl: parsed.toString(),
        label: parsed.toString()
      };
    }

    const hostname = parsed.hostname.toLowerCase();
    const youtubeId =
      hostname === "youtu.be"
        ? parsed.pathname.split("/").filter(Boolean)[0] ?? ""
        : hostname.includes("youtube.com") && parsed.pathname === "/watch"
          ? parsed.searchParams.get("v")?.trim() ?? ""
          : hostname.includes("youtube.com") && parsed.pathname.startsWith("/shorts/")
            ? parsed.pathname.split("/").filter(Boolean)[1] ?? ""
            : "";

    if (youtubeId) {
      return {
        kind: "youtube",
        href: parsed.toString(),
        embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(
          youtubeId
        )}?rel=0&modestbranding=1&playsinline=1`,
        label: parsed.toString()
      };
    }

    return {
      kind: "external",
      href: parsed.toString(),
      label: parsed.toString()
    };
  } catch {
    return null;
  }
}

function formatProviderLabel(provider: SourceProviderId | null | undefined): string {
  return provider === "visolix" ? "Visolix" : provider === "ytDlp" ? "yt-dlp" : "не задан";
}

function formatRetryCountdown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${seconds} с`;
}

function resolveProviderErrorSummary(sourceJob: SourceJobDetail | null): SourceProviderErrorSummary | null {
  return sourceJob?.progress.providerErrorSummary ?? sourceJob?.result?.providerErrorSummary ?? null;
}

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
  uploadBusy,
  uploadAvailable,
  uploadBlockedReason,
  autoRunStage2Enabled,
  downloadAvailable,
  downloadBlockedReason,
  onDraftUrlChange,
  onPaste,
  onFetch,
  onUploadFile,
  onAutoRunStage2Change,
  onDownloadSource
}: Step1PasteLinkProps) {
  const sourcePreview = resolveSourcePreview(activeUrl);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedUploadFileName, setSelectedUploadFileName] = useState<string | null>(null);
  const isAttachedSourceJob =
    Boolean(sourceJob) &&
    (sourceJob?.status === "queued" || sourceJob?.status === "running") &&
    fetchBlockedReason === "Для этого чата уже идёт получение источника.";
  const isAttachedStage2Run =
    typeof fetchBlockedReason === "string" &&
    fetchBlockedReason.startsWith("Для этого чата уже идёт Stage 2.");
  const inlineFetchMessage = isAttachedSourceJob
    ? "Источник уже обрабатывается в фоне. Ниже показан текущий Step 1 job."
    : isAttachedStage2Run
      ? "Второй этап уже выполняется для этого чата. Прогресс подключён на шаге 2."
      : fetchBlockedReason ?? null;
  const providerErrorSummary = resolveProviderErrorSummary(sourceJob);
  const retryCountdownMs = sourceJob?.progress.nextRetryAt
    ? Math.max(0, new Date(sourceJob.progress.nextRetryAt).getTime() - Date.now())
    : null;
  const retryCountdownLabel =
    typeof retryCountdownMs === "number" ? formatRetryCountdown(retryCountdownMs) : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onFetch();
  };

  const handleChooseFile = (): void => {
    fileInputRef.current?.click();
  };

  const uploadSummary = useMemo(() => {
    if (uploadBusy) {
      return {
        title: selectedUploadFileName ?? "Готовим загрузку",
        detail: "MP4 загружается и сразу попадёт в Step 1."
      };
    }
    if (selectedUploadFileName) {
      return {
        title: selectedUploadFileName,
        detail: "Файл выбран и будет загружен в Stage 1."
      };
    }
    if (sourcePreview?.kind === "video" && isUploadedSourceUrl(activeUrl ?? "")) {
      return {
        title: sourcePreview.label,
        detail: "Этот mp4 уже загружен и используется как текущий источник."
      };
    }
    return {
      title: "Готовый mp4 не выбран",
      detail: "Можно загрузить готовое видео вместо ссылки на Shorts или Reels."
    };
  }, [activeUrl, selectedUploadFileName, sourcePreview, uploadBusy]);

  return (
    <StepWorkspace
      editLabel="Редактирование"
      previewLabel="Предпросмотр"
      left={
        <div className="step-panel-stack">
          <header className="step-head">
            <p className="kicker">Шаг 1</p>
            <h2>Источник</h2>
            <p>
              Вставьте ссылку на YouTube Shorts, Instagram/Facebook Reels или загрузите готовый mp4.
              Комментарии необязательны и не блокируют процесс.
            </p>
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
                `facebook.com/reel/...` или загрузка готового `mp4`
              </p>

              <div className="source-upload-row" aria-label="Загрузка готового mp4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,.mp4"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = "";
                    if (file) {
                      setSelectedUploadFileName(file.name);
                      onUploadFile(file);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary source-upload-trigger"
                  onClick={handleChooseFile}
                  disabled={uploadBusy || !uploadAvailable}
                  title={!uploadAvailable ? uploadBlockedReason ?? undefined : undefined}
                >
                  {uploadBusy ? "Загружаем..." : "Выбрать mp4"}
                </button>
                <div className={`source-upload-summary${selectedUploadFileName || uploadBusy ? " is-active" : ""}`}>
                  <p className="source-upload-summary-title">{uploadSummary.title}</p>
                  <p className="source-upload-summary-detail">{uploadSummary.detail}</p>
                </div>
              </div>

              <div className="control-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={fetchBusy || !fetchAvailable}
                  aria-busy={fetchBusy}
                  title={
                    !fetchAvailable && !isAttachedSourceJob && !isAttachedStage2Run
                      ? fetchBlockedReason ?? undefined
                      : undefined
                  }
                >
                  {fetchBusy ? "Получаем..." : "Получить источник"}
                </button>
              </div>
              <div className="source-stage-toggle">
                <label className="field-label fragment-toggle">
                  <input
                    type="checkbox"
                    checked={autoRunStage2Enabled}
                    onChange={(event) => onAutoRunStage2Change(event.target.checked)}
                  />
                  <span>Автоматически запускать Stage 2 после завершения Step 1</span>
                </label>
                <p className="subtle-text">
                  Если чекбокс выключен, второй этап стартует только после кнопки «Генерировать варианты».
                  Если Shared Codex не подключен, автозапуск не сработает даже при включённом чекбоксе.
                </p>
              </div>
              {!fetchAvailable && inlineFetchMessage ? (
                <p className={`subtle-text${isAttachedSourceJob || isAttachedStage2Run ? "" : " danger-text"}`}>
                  {inlineFetchMessage}
                </p>
              ) : null}
              {!uploadAvailable && uploadBlockedReason ? (
                <p className="subtle-text danger-text">{uploadBlockedReason}</p>
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
                  {sourceJob.progress.activeStageId === "retry" &&
                  sourceJob.progress.attempt &&
                  sourceJob.progress.maxAttempts ? (
                    <p className="subtle-text">
                      Попытка {sourceJob.progress.attempt} из {sourceJob.progress.maxAttempts}
                      {retryCountdownLabel ? ` · следующий запрос через ${retryCountdownLabel}` : ""}
                    </p>
                  ) : null}
                  {sourceJob.progress.activeStageId === "retry" &&
                  providerErrorSummary?.primaryProviderError ? (
                    <p className="subtle-text danger-text">
                      {formatProviderLabel(providerErrorSummary.primaryProvider)}:{" "}
                      {providerErrorSummary.primaryProviderError}
                    </p>
                  ) : null}
                  {sourceJob.status === "failed" && sourceJob.errorMessage && !providerErrorSummary ? (
                    <p className="subtle-text danger-text">{sourceJob.errorMessage}</p>
                  ) : null}
                  {sourceJob.status === "failed" && providerErrorSummary?.primaryProviderError ? (
                    <p className="subtle-text danger-text">
                      Основной провайдер: {formatProviderLabel(providerErrorSummary.primaryProvider)}.{" "}
                      {providerErrorSummary.primaryProviderError}
                    </p>
                  ) : null}
                  {sourceJob.status === "failed" && providerErrorSummary?.fallbackProviderError ? (
                    <p className="subtle-text danger-text">
                      Fallback: {formatProviderLabel(providerErrorSummary.fallbackProvider)}.{" "}
                      {providerErrorSummary.fallbackProviderError}
                    </p>
                  ) : null}
                  {sourceJob.status === "failed" && providerErrorSummary?.hostedFallbackSkippedReason ? (
                    <p className="subtle-text">{providerErrorSummary.hostedFallbackSkippedReason}</p>
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
              {sourcePreview?.kind === "youtube" ? (
                <div className="source-player-shell">
                  <iframe
                    className="source-embed-frame"
                    src={sourcePreview.embedUrl}
                    title="Source video preview"
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              ) : sourcePreview?.kind === "video" ? (
                <div className="source-player-shell">
                  <video
                    className="source-video-player"
                    controls
                    playsInline
                    preload="metadata"
                    src={sourcePreview.videoUrl}
                  />
                </div>
              ) : null}

              <p className="placeholder-title">Ссылка на источник</p>
              {sourcePreview ? (
                <a
                  className="mono source-link-text source-link-anchor"
                  href={sourcePreview.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {sourcePreview.label}
                </a>
              ) : (
                <p className="mono source-link-text">{activeUrl ?? "Источник не выбран"}</p>
              )}
              <p className="subtle-text">
                После завершения загрузки второй этап покажет варианты подписей, сгенерированные по видео, и комментарии, если они доступны.
              </p>
              {sourcePreview?.kind === "external" ? (
                <p className="subtle-text">
                  Для этого источника встроенный player пока недоступен. Откройте ссылку выше в новой вкладке для просмотра исходного видео.
                </p>
              ) : null}
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
