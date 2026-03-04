"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import { Stage3Version } from "./types";
import {
  SCIENCE_CARD,
  STAGE3_TEMPLATE_ID,
  getScienceCardComputed
} from "../../lib/stage3-template";

type Step3RenderTemplateProps = {
  sourceUrl: string | null;
  previewVideoUrl: string | null;
  versions: Stage3Version[];
  selectedVersionId: string | null;
  selectedPassIndex: number;
  isPreviewLoading: boolean;
  previewNotice: string | null;
  agentPrompt: string;
  topText: string;
  bottomText: string;
  isRendering: boolean;
  isOptimizing: boolean;
  clipStartSec: number;
  clipDurationSec: number;
  sourceDurationSec: number | null;
  focusY: number;
  onRender: () => void;
  onExport: () => void;
  onOptimize: () => void;
  onSelectVersionId: (runId: string) => void;
  onSelectPassIndex: (index: number) => void;
  onAgentPromptChange: (value: string) => void;
  onClipStartChange: (value: number) => void;
  onFocusYChange: (value: number) => void;
};

function formatTimeSec(value: number): string {
  const total = Math.max(0, value);
  const min = Math.floor(total / 60);
  const sec = Math.floor(total % 60);
  const ms = Math.floor((total - Math.floor(total)) * 10);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${ms}`;
}

function formatDateShort(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function shortPrompt(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "Без доп. инструкции";
  }
  if (normalized.length <= 84) {
    return normalized;
  }
  return `${normalized.slice(0, 83)}...`;
}

function PreviewClipVideo({
  sourceUrl,
  clipStartSec,
  clipDurationSec,
  className,
  objectPosition,
  videoRef,
  onPositionChange
}: {
  sourceUrl: string;
  clipStartSec: number;
  clipDurationSec: number;
  className: string;
  objectPosition?: string;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  onPositionChange?: (sec: number) => void;
}) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const seekToStart = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const maxSeek = Math.max(0, video.duration - 0.05);
        video.currentTime = Math.min(clipStartSec, maxSeek);
      } else {
        video.currentTime = clipStartSec;
      }
      void video.play().catch(() => undefined);
    };

    if (video.readyState >= 1) {
      seekToStart();
      return;
    }

    video.addEventListener("loadedmetadata", seekToStart, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", seekToStart);
    };
  }, [sourceUrl, clipStartSec, videoRef]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    onPositionChange?.(video.currentTime);
    const endSec = clipStartSec + clipDurationSec;
    if (video.currentTime >= endSec - 0.02) {
      video.currentTime = clipStartSec;
      onPositionChange?.(clipStartSec);
      void video.play().catch(() => undefined);
    }
  };

  return (
    <video
      ref={videoRef}
      className={className}
      src={sourceUrl}
      muted
      playsInline
      autoPlay
      preload="metadata"
      onTimeUpdate={handleTimeUpdate}
      style={objectPosition ? { objectPosition } : undefined}
    />
  );
}

export function Step3RenderTemplate({
  sourceUrl,
  previewVideoUrl,
  versions,
  selectedVersionId,
  selectedPassIndex,
  isPreviewLoading,
  previewNotice,
  agentPrompt,
  topText,
  bottomText,
  isRendering,
  isOptimizing,
  clipStartSec,
  clipDurationSec,
  sourceDurationSec,
  focusY,
  onRender,
  onExport,
  onOptimize,
  onSelectVersionId,
  onSelectPassIndex,
  onAgentPromptChange,
  onClipStartChange,
  onFocusYChange
}: Step3RenderTemplateProps) {
  const slotPreviewRef = useRef<HTMLVideoElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const clipCommitTimerRef = useRef<number | null>(null);
  const focusCommitTimerRef = useRef<number | null>(null);
  const [isTimelineScrubbing, setIsTimelineScrubbing] = useState(false);
  const [timelineSec, setTimelineSec] = useState(0);
  const computed = getScienceCardComputed(topText, bottomText);
  const selectedVersion =
    selectedVersionId !== null ? versions.find((version) => version.runId === selectedVersionId) ?? null : null;
  const selectedPass = selectedVersion?.internalPasses[selectedPassIndex] ?? null;
  const displayVersions = useMemo(
    () => [...versions].sort((a, b) => (a.versionNo < b.versionNo ? 1 : -1)),
    [versions]
  );

  const phoneWidth = 420;
  const scale = phoneWidth / SCIENCE_CARD.frame.width;
  const phoneHeight = Math.round(SCIENCE_CARD.frame.height * scale);

  const cardLeft = Math.round(SCIENCE_CARD.card.x * scale);
  const cardTop = Math.round(SCIENCE_CARD.card.y * scale);
  const cardWidth = Math.round(SCIENCE_CARD.card.width * scale);
  const cardHeight = Math.round(SCIENCE_CARD.card.height * scale);
  const topHeight = Math.round(SCIENCE_CARD.slot.topHeight * scale);
  const bottomHeight = Math.round(SCIENCE_CARD.slot.bottomHeight * scale);
  const videoHeight = Math.round(computed.videoHeight * scale);

  const maxStartSec = Math.max(0, (sourceDurationSec ?? clipDurationSec) - clipDurationSec);
  const [localClipStartSec, setLocalClipStartSec] = useState(Math.min(clipStartSec, maxStartSec));
  const [localFocusY, setLocalFocusY] = useState(focusY);
  const clipEndSec = localClipStartSec + clipDurationSec;
  const focusPercent = Math.round(localFocusY * 100);
  const objectPosition = `50% ${Math.round(localFocusY * 100)}%`;
  const timelinePercent = Math.max(0, Math.min(100, (timelineSec / Math.max(0.1, clipDurationSec)) * 100));

  useEffect(() => {
    setLocalClipStartSec(Math.min(clipStartSec, maxStartSec));
  }, [clipStartSec, maxStartSec]);

  useEffect(() => {
    setLocalFocusY(focusY);
  }, [focusY]);

  useEffect(() => {
    return () => {
      if (clipCommitTimerRef.current !== null) {
        window.clearTimeout(clipCommitTimerRef.current);
      }
      if (focusCommitTimerRef.current !== null) {
        window.clearTimeout(focusCommitTimerRef.current);
      }
    };
  }, []);

  const flushClipCommit = (value: number) => {
    if (clipCommitTimerRef.current !== null) {
      window.clearTimeout(clipCommitTimerRef.current);
      clipCommitTimerRef.current = null;
    }
    onClipStartChange(Math.max(0, Math.min(maxStartSec, value)));
  };

  const flushFocusCommit = (value: number) => {
    if (focusCommitTimerRef.current !== null) {
      window.clearTimeout(focusCommitTimerRef.current);
      focusCommitTimerRef.current = null;
    }
    onFocusYChange(Math.max(0.12, Math.min(0.88, value)));
  };

  const scheduleClipCommit = (value: number) => {
    const next = Math.max(0, Math.min(maxStartSec, value));
    setLocalClipStartSec(next);
    if (clipCommitTimerRef.current !== null) {
      window.clearTimeout(clipCommitTimerRef.current);
    }
    clipCommitTimerRef.current = window.setTimeout(() => {
      onClipStartChange(next);
      clipCommitTimerRef.current = null;
    }, 550);
  };

  const scheduleFocusCommit = (value: number) => {
    const next = Math.max(0.12, Math.min(0.88, value));
    setLocalFocusY(next);
    if (focusCommitTimerRef.current !== null) {
      window.clearTimeout(focusCommitTimerRef.current);
    }
    focusCommitTimerRef.current = window.setTimeout(() => {
      onFocusYChange(next);
      focusCommitTimerRef.current = null;
    }, 550);
  };

  useEffect(() => {
    setTimelineSec(0);
  }, [previewVideoUrl]);

  const seekTimelineAtClientX = useCallback(
    (clientX: number) => {
      const track = timelineTrackRef.current;
      if (!track) {
        return;
      }
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const nextSec = ratio * clipDurationSec;
      setTimelineSec(nextSec);

      const video = slotPreviewRef.current;
      if (video) {
        video.currentTime = nextSec;
        void video.play().catch(() => undefined);
      }
    },
    [clipDurationSec]
  );

  useEffect(() => {
    if (!isTimelineScrubbing) {
      return;
    }
    const handleMove = (event: PointerEvent) => {
      seekTimelineAtClientX(event.clientX);
    };
    const handleEnd = (event: PointerEvent) => {
      seekTimelineAtClientX(event.clientX);
      setIsTimelineScrubbing(false);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [isTimelineScrubbing, seekTimelineAtClientX]);

  return (
    <section className="step-wrap" aria-label="Step 3 render">
      <article className="panel panel-main">
        <header className="panel-head">
          <p className="panel-kicker">Step 3</p>
          <h2>Render Video</h2>
          <p>
            Версионный агент-монтажер: v1 это стартовая инициализация, а каждый Optimize создает новую
            версию (v2, v3...). Выберите лучший вариант и рендерьте его.
          </p>
        </header>

        <div className="single-template-line">
          <span className="pill">Template</span>
          <strong>Science Card v1</strong>
          <small className="subtle-text">ID: {STAGE3_TEMPLATE_ID}</small>
        </div>

        <div className="agent-instruction-card">
          <label className="field-label" htmlFor="agentPrompt">
            Как вы видите итоговый ролик
          </label>
          <textarea
            id="agentPrompt"
            className="text-area"
            rows={6}
            value={agentPrompt}
            onChange={(event) => onAgentPromptChange(event.target.value)}
            placeholder={`Пример:\n❗️ровно 6 секунд\n❗️только звук (отключить музыку)\nфрагменты:\n0:00-0:02\n0:08-конец`}
          />
          <p className="subtle-text">
            Поддерживаются команды для длительности, фрагментов, аудио и slo-mo.
          </p>
        </div>

        <div className="editor-grid">
          <div className="editor-card">
            <label className="field-label" htmlFor="clipStartRange">
              Segment start ({formatTimeSec(localClipStartSec)} - {formatTimeSec(clipEndSec)})
            </label>
            <input
              id="clipStartRange"
              type="range"
              min={0}
              max={Math.max(0, maxStartSec)}
              step={0.1}
              value={localClipStartSec}
              disabled={!sourceUrl || maxStartSec <= 0}
              onChange={(event) => scheduleClipCommit(Number.parseFloat(event.target.value))}
              onMouseUp={() => flushClipCommit(localClipStartSec)}
              onTouchEnd={() => flushClipCommit(localClipStartSec)}
              onBlur={() => flushClipCommit(localClipStartSec)}
            />
            <p className="subtle-text">
              {sourceDurationSec
                ? `Длительность исходника: ${formatTimeSec(sourceDurationSec)}`
                : "Длительность исходника: неизвестно"}
            </p>
          </div>

          <div className="editor-card">
            <label className="field-label" htmlFor="focusRange">
              Vertical focus ({focusPercent}%)
            </label>
            <input
              id="focusRange"
              type="range"
              min={0.12}
              max={0.88}
              step={0.01}
              value={localFocusY}
              onChange={(event) => scheduleFocusCommit(Number.parseFloat(event.target.value))}
              onMouseUp={() => flushFocusCommit(localFocusY)}
              onTouchEnd={() => flushFocusCommit(localFocusY)}
              onBlur={() => flushFocusCommit(localFocusY)}
            />
            <p className="subtle-text">12% = верх, 50% = центр, 88% = низ.</p>
          </div>
        </div>

        <div className="preview-wrap preview-wrap-centered">
          <div className="phone-preview" style={{ width: phoneWidth, height: phoneHeight }}>
            <div className="preview-bg-video preview-bg-fallback" />

            <div
              className="preview-card"
              style={{
                left: cardLeft,
                top: cardTop,
                width: cardWidth,
                height: cardHeight,
                borderRadius: Math.max(12, Math.round(SCIENCE_CARD.card.radius * scale)),
                borderWidth: Math.max(2, Math.round(SCIENCE_CARD.card.borderWidth * scale)),
                borderColor: SCIENCE_CARD.card.borderColor
              }}
            >
              <div
                className="preview-top"
                style={{
                  height: topHeight,
                  padding: `${Math.round(SCIENCE_CARD.slot.topPaddingY * scale)}px ${Math.round(SCIENCE_CARD.slot.topPaddingX * scale)}px`
                }}
              >
                <p
                  className="preview-text"
                  style={{
                    fontSize: Math.max(14, Math.round(computed.topFont * scale)),
                    WebkitLineClamp: SCIENCE_CARD.typography.top.maxLines,
                    lineHeight: SCIENCE_CARD.typography.top.lineHeight
                  }}
                >
                  {computed.top || "TOP text from Step 2 will appear here."}
                </p>
              </div>

              <div className="preview-video" style={{ height: videoHeight }}>
                {previewVideoUrl ? (
                  <PreviewClipVideo
                    sourceUrl={previewVideoUrl}
                    clipStartSec={0}
                    clipDurationSec={clipDurationSec}
                    className="preview-slot-video"
                    objectPosition={objectPosition}
                    videoRef={slotPreviewRef}
                    onPositionChange={(sec) => {
                      if (!isTimelineScrubbing) {
                        setTimelineSec(sec);
                      }
                    }}
                  />
                ) : (
                  <span>VIDEO SLOT</span>
                )}
              </div>

              <div
                className="preview-bottom"
                style={{
                  height: bottomHeight,
                  padding: `${Math.round(SCIENCE_CARD.slot.bottomPaddingY * scale)}px ${Math.round(SCIENCE_CARD.slot.bottomPaddingX * scale)}px`
                }}
              >
                <p
                  className="preview-text"
                  style={{
                    fontSize: Math.max(13, Math.round(computed.bottomFont * scale)),
                    WebkitLineClamp: SCIENCE_CARD.typography.bottom.maxLines,
                    lineHeight: SCIENCE_CARD.typography.bottom.lineHeight
                  }}
                >
                  {computed.bottom || "BOTTOM text from Step 2 will appear here."}
                </p>
              </div>
            </div>
          </div>
          <div className="timeline-shell" aria-label="Таймлайн предпросмотра">
            <div className="timeline-ruler">
              {Array.from({ length: 7 }).map((_, index) => {
                const ratio = index / 6;
                return (
                  <span
                    key={`tick-${index}`}
                    className="timeline-ruler-mark"
                    style={{ left: `${ratio * 100}%` }}
                  >
                    {index}s
                  </span>
                );
              })}
            </div>
            <div
              ref={timelineTrackRef}
              className="timeline-track"
              role="slider"
              aria-label="Позиция воспроизведения"
              aria-valuemin={0}
              aria-valuemax={clipDurationSec}
              aria-valuenow={Number(timelineSec.toFixed(2))}
              tabIndex={0}
              onPointerDown={(event) => {
                setIsTimelineScrubbing(true);
                seekTimelineAtClientX(event.clientX);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  seekTimelineAtClientX(
                    (timelineTrackRef.current?.getBoundingClientRect().left ?? 0) +
                      (Math.max(0, timelinePercent - 1) / 100) *
                        (timelineTrackRef.current?.getBoundingClientRect().width ?? 1)
                  );
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  seekTimelineAtClientX(
                    (timelineTrackRef.current?.getBoundingClientRect().left ?? 0) +
                      (Math.min(100, timelinePercent + 1) / 100) *
                        (timelineTrackRef.current?.getBoundingClientRect().width ?? 1)
                  );
                }
              }}
            >
              <div className="timeline-playhead" style={{ left: `${timelinePercent}%` }} />
            </div>
            <div className="timeline-time">
              <span>{formatTimeSec(timelineSec)}</span>
              <span>{formatTimeSec(clipDurationSec)}</span>
            </div>
          </div>
          {isPreviewLoading ? <p className="subtle-text">Обновляем предпросмотр...</p> : null}
          {previewNotice ? <p className="subtle-text">{previewNotice}</p> : null}
        </div>

        <div className="action-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onOptimize}
            disabled={!sourceUrl || isOptimizing || isRendering}
            aria-busy={isOptimizing}
          >
            {isOptimizing ? "Оптимизация..." : "Optimize with editor agent"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRender}
            disabled={!sourceUrl || isRendering}
            aria-busy={isRendering}
          >
            {isRendering ? "Рендер..." : "Render video"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onExport} disabled={!sourceUrl}>
            Export config JSON
          </button>
        </div>
      </article>

      <article className="panel panel-side">
        <div className="runs-head">
          <h3>История версий</h3>
          <small className="subtle-text">{versions.length ? `Всего: ${versions.length}` : "Пока нет версий"}</small>
        </div>

        {displayVersions.length === 0 ? (
          <p className="subtle-text">Создаем стартовую версию v1 на основе текущего варианта Stage 2...</p>
        ) : (
          <>
            <div className="runs-list side-runs-list">
              {displayVersions.map((version) => {
                const active = version.runId === selectedVersionId;
                return (
                  <button
                    key={version.runId}
                    type="button"
                    className={`run-item ${active ? "active" : ""}`}
                    onClick={() => onSelectVersionId(version.runId)}
                  >
                    <div className="run-item-head">
                      <strong>v{version.versionNo}</strong>
                      <small>{formatDateShort(version.createdAt)}</small>
                    </div>
                    <p className="run-prompt">{shortPrompt(version.prompt)}</p>
                    <div className="run-meta">
                      <span>{version.internalPasses.length} проходов</span>
                      <span>{version.diff.summary.length} изменений</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="runs-content side-runs-content">
              {selectedVersion ? (
                <>
                  <div className="preview-mode-row">
                    <strong>Версия v{selectedVersion.versionNo}</strong>
                  </div>

                  <ul className="version-diff-list">
                    {selectedVersion.diff.summary.map((line, index) => (
                      <li key={`${selectedVersion.runId}-${index}`}>{line}</li>
                    ))}
                  </ul>

                  <details className="internal-passes">
                    <summary>Внутренние проходы агента ({selectedVersion.internalPasses.length})</summary>
                    <div className="pass-tabs-scroll">
                      <div className="passes-tabs">
                        {selectedVersion.internalPasses.map((pass, index) => (
                          <button
                            key={`${selectedVersion.runId}-${pass.pass}`}
                            type="button"
                            className={`pass-tab ${index === selectedPassIndex ? "active" : ""}`}
                            onClick={() => onSelectPassIndex(index)}
                          >
                            {pass.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {selectedPass ? (
                      <div className="pass-details">
                        <p className="run-summary">
                          <strong>{selectedPass.summary}</strong>
                        </p>
                        <ul className="pass-changes">
                          {selectedPass.changes.map((change, index) => (
                            <li key={`${selectedVersion.runId}-${selectedPass.pass}-${index}`}>{change}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </details>
                </>
              ) : (
                <p className="subtle-text pass-empty">Выберите версию в списке.</p>
              )}
            </div>
          </>
        )}
      </article>
    </section>
  );
}
