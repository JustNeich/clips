"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import { ChannelAsset, Stage3Version } from "./types";
import { StepWorkspace } from "./StepWorkspace";
import {
  SCIENCE_CARD,
  STAGE3_TEMPLATE_ID,
  getScienceCardComputed
} from "../../lib/stage3-template";

type Step3RenderTemplateProps = {
  sourceUrl: string | null;
  templateId: string;
  channelName: string;
  channelUsername: string;
  avatarUrl: string | null;
  previewVideoUrl: string | null;
  backgroundAssetUrl: string | null;
  backgroundAssetMimeType: string | null;
  backgroundOptions: ChannelAsset[];
  musicOptions: ChannelAsset[];
  selectedBackgroundAssetId: string | null;
  selectedMusicAssetId: string | null;
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
  isUploadingBackground: boolean;
  clipStartSec: number;
  clipDurationSec: number;
  sourceDurationSec: number | null;
  focusY: number;
  videoZoom: number;
  onRender: () => void;
  onExport: () => void;
  onOptimize: () => void;
  onReset: () => void;
  onUploadBackground: (file: File) => Promise<void>;
  onUploadMusic: (file: File) => Promise<void>;
  onClearBackground: () => void;
  onClearMusic: () => void;
  onSelectBackgroundAssetId: (value: string | null) => void;
  onSelectMusicAssetId: (value: string | null) => void;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function PreviewClipVideo({
  sourceUrl,
  clipDurationSec,
  className,
  objectPosition,
  videoZoom,
  videoRef,
  isPlaying,
  loopEnabled,
  onPositionChange,
  onClipEnd
}: {
  sourceUrl: string;
  clipDurationSec: number;
  className: string;
  objectPosition?: string;
  videoZoom?: number;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  loopEnabled: boolean;
  onPositionChange?: (sec: number) => void;
  onClipEnd?: () => void;
}) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const seekToStart = () => {
      video.currentTime = 0;
      if (isPlaying) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };

    if (video.readyState >= 1) {
      seekToStart();
      return;
    }

    video.addEventListener("loadedmetadata", seekToStart, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", seekToStart);
    };
  }, [sourceUrl, isPlaying, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (isPlaying) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [isPlaying, videoRef]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    onPositionChange?.(video.currentTime);

    if (video.currentTime >= clipDurationSec - 0.02) {
      if (loopEnabled) {
        video.currentTime = 0;
        onPositionChange?.(0);
        if (isPlaying) {
          void video.play().catch(() => undefined);
        }
      } else {
        video.pause();
        onClipEnd?.();
      }
    }
  };

  return (
    <video
      ref={videoRef}
      className={className}
      src={sourceUrl}
      muted
      playsInline
      preload="metadata"
      onTimeUpdate={handleTimeUpdate}
      style={{
        ...(objectPosition ? { objectPosition } : {}),
        transform: `scale(${Math.min(1.6, Math.max(1, videoZoom ?? 1)).toFixed(3)})`,
        transformOrigin: "center center"
      }}
    />
  );
}

export function Step3RenderTemplate({
  sourceUrl,
  templateId,
  channelName,
  channelUsername,
  avatarUrl,
  previewVideoUrl,
  backgroundAssetUrl,
  backgroundAssetMimeType,
  backgroundOptions,
  musicOptions,
  selectedBackgroundAssetId,
  selectedMusicAssetId,
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
  isUploadingBackground,
  clipStartSec,
  clipDurationSec,
  sourceDurationSec,
  focusY,
  videoZoom,
  onRender,
  onExport,
  onOptimize,
  onReset,
  onUploadBackground,
  onUploadMusic,
  onClearBackground,
  onClearMusic,
  onSelectBackgroundAssetId,
  onSelectMusicAssetId,
  onSelectVersionId,
  onSelectPassIndex,
  onAgentPromptChange,
  onClipStartChange,
  onFocusYChange
}: Step3RenderTemplateProps) {
  const slotPreviewRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const clipCommitTimerRef = useRef<number | null>(null);
  const focusCommitTimerRef = useRef<number | null>(null);

  const [localClipStartSec, setLocalClipStartSec] = useState(clipStartSec);
  const [localFocusY, setLocalFocusY] = useState(focusY);
  const [isTimelineScrubbing, setIsTimelineScrubbing] = useState(false);
  const [timelineSec, setTimelineSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [zoomMode, setZoomMode] = useState<"fit" | 75 | 100>("fit");
  const [versionsDrawerOpen, setVersionsDrawerOpen] = useState(false);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareSide, setCompareSide] = useState<"A" | "B">("A");
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 720, height: 1280 });

  const computed = getScienceCardComputed(topText, bottomText);

  const displayVersions = useMemo(
    () => [...versions].sort((a, b) => (a.versionNo < b.versionNo ? 1 : -1)),
    [versions]
  );

  const selectedVersion = useMemo(
    () => (selectedVersionId ? versions.find((version) => version.runId === selectedVersionId) ?? null : null),
    [versions, selectedVersionId]
  );

  const selectedPass = selectedVersion?.internalPasses[selectedPassIndex] ?? null;

  const versionA = useMemo(
    () => (compareAId ? versions.find((version) => version.runId === compareAId) ?? null : null),
    [versions, compareAId]
  );
  const versionB = useMemo(
    () => (compareBId ? versions.find((version) => version.runId === compareBId) ?? null : null),
    [versions, compareBId]
  );

  const previewVersion = compareEnabled ? (compareSide === "A" ? versionA : versionB) : selectedVersion;

  const previewTopText = previewVersion?.final.topText ?? computed.top;
  const previewBottomText = previewVersion?.final.bottomText ?? computed.bottom;
  const previewVideoZoom = clamp(previewVersion?.final.renderPlan.videoZoom ?? videoZoom ?? 1, 1, 1.6);

  const previewComputed = getScienceCardComputed(previewTopText, previewBottomText);

  const maxStartSec = Math.max(0, (sourceDurationSec ?? clipDurationSec) - clipDurationSec);
  const clipEndSec = localClipStartSec + clipDurationSec;
  const focusPercent = Math.round(localFocusY * 100);
  const objectPosition = `50% ${focusPercent}%`;

  const frameWidth = SCIENCE_CARD.frame.width;
  const frameHeight = SCIENCE_CARD.frame.height;

  const fitScale = useMemo(() => {
    const width = canvasSize.width;
    const height = canvasSize.height;
    if (!width || !height) {
      return 0.01;
    }
    const usableWidth = Math.max(1, width - 20);
    const usableHeight = Math.max(1, height - 20);
    return clamp(Math.min(usableWidth / frameWidth, usableHeight / frameHeight), 0.01, 1);
  }, [canvasSize.height, canvasSize.width, frameHeight, frameWidth]);

  const previewScaleMultiplier = useMemo(() => {
    if (zoomMode === "fit") {
      return 1;
    }
    return zoomMode / 100;
  }, [zoomMode]);

  const layoutScale = fitScale * previewScaleMultiplier;
  const cardLeft = SCIENCE_CARD.card.x;
  const cardTop = SCIENCE_CARD.card.y;
  const cardWidth = SCIENCE_CARD.card.width;
  const cardHeight = SCIENCE_CARD.card.height;
  const topHeight = SCIENCE_CARD.slot.topHeight;
  const bottomHeight = SCIENCE_CARD.slot.bottomHeight;
  const bottomMetaHeight = SCIENCE_CARD.slot.bottomMetaHeight;
  const videoHeight = previewComputed.videoHeight;

  const timelinePercent = clamp((timelineSec / Math.max(0.01, clipDurationSec)) * 100, 0, 100);
  const backgroundIsVideo =
    Boolean(backgroundAssetUrl) && (backgroundAssetMimeType ?? "").toLowerCase().startsWith("video/");

  useEffect(() => {
    setLocalClipStartSec(clamp(clipStartSec, 0, maxStartSec));
  }, [clipStartSec, maxStartSec]);

  useEffect(() => {
    setLocalFocusY(clamp(focusY, 0.12, 0.88));
  }, [focusY]);

  useEffect(() => {
    const element = previewCanvasRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 120) {
        return;
      }
      setCanvasSize({
        width: rect.width,
        height: rect.height
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!displayVersions.length) {
      setCompareAId(null);
      setCompareBId(null);
      return;
    }

    setCompareAId((prev) => {
      if (prev && displayVersions.some((version) => version.runId === prev)) {
        return prev;
      }
      return selectedVersionId ?? displayVersions[0].runId;
    });

    setCompareBId((prev) => {
      if (prev && displayVersions.some((version) => version.runId === prev)) {
        return prev;
      }
      return displayVersions[1]?.runId ?? displayVersions[0].runId;
    });
  }, [displayVersions, selectedVersionId]);

  useEffect(() => {
    if (!compareEnabled) {
      return;
    }
    const targetId = compareSide === "A" ? compareAId : compareBId;
    if (targetId && targetId !== selectedVersionId) {
      onSelectVersionId(targetId);
    }
  }, [compareEnabled, compareSide, compareAId, compareBId, selectedVersionId, onSelectVersionId]);

  useEffect(() => {
    setTimelineSec(0);
  }, [previewVideoUrl]);

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
    onClipStartChange(clamp(value, 0, maxStartSec));
  };

  const flushFocusCommit = (value: number) => {
    if (focusCommitTimerRef.current !== null) {
      window.clearTimeout(focusCommitTimerRef.current);
      focusCommitTimerRef.current = null;
    }
    onFocusYChange(clamp(value, 0.12, 0.88));
  };

  const scheduleClipCommit = (value: number) => {
    const next = clamp(value, 0, maxStartSec);
    setLocalClipStartSec(next);
    if (clipCommitTimerRef.current !== null) {
      window.clearTimeout(clipCommitTimerRef.current);
    }
    clipCommitTimerRef.current = window.setTimeout(() => {
      onClipStartChange(next);
      clipCommitTimerRef.current = null;
    }, 450);
  };

  const scheduleFocusCommit = (value: number) => {
    const next = clamp(value, 0.12, 0.88);
    setLocalFocusY(next);
    if (focusCommitTimerRef.current !== null) {
      window.clearTimeout(focusCommitTimerRef.current);
    }
    focusCommitTimerRef.current = window.setTimeout(() => {
      onFocusYChange(next);
      focusCommitTimerRef.current = null;
    }, 450);
  };

  const seekTimeline = useCallback(
    (value: number) => {
      const clamped = clamp(value, 0, clipDurationSec);
      setTimelineSec(clamped);
      const video = slotPreviewRef.current;
      if (video) {
        video.currentTime = clamped;
      }
    },
    [clipDurationSec]
  );

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
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      seekTimeline(ratio * clipDurationSec);
    },
    [clipDurationSec, seekTimeline]
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

  const handleTogglePlay = () => {
    const video = slotPreviewRef.current;
    if (!video) {
      setIsPlaying((prev) => !prev);
      return;
    }

    if (video.paused) {
      setIsPlaying(true);
      void video.play().catch(() => undefined);
      return;
    }

    video.pause();
    setIsPlaying(false);
  };

  const handleFrameStep = (direction: -1 | 1) => {
    const frame = 1 / 30;
    setIsPlaying(false);
    const video = slotPreviewRef.current;
    if (video) {
      video.pause();
    }
    seekTimeline(timelineSec + frame * direction);
  };

  const handleSelectVersion = (runId: string) => {
    onSelectVersionId(runId);
    if (compareEnabled) {
      if (compareSide === "A") {
        setCompareAId(runId);
      } else {
        setCompareBId(runId);
      }
    }
  };

  const summaryLines = previewVersion?.diff.summary ?? ["Используется текущий live draft без сохраненной версии."];

  const leftFooter = (
    <div className="sticky-action-bar">
      <button type="button" className="btn btn-ghost" onClick={onReset}>
        Reset
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onOptimize}
        disabled={!sourceUrl || isOptimizing || isRendering}
        aria-busy={isOptimizing}
      >
        {isOptimizing ? "Optimizing..." : "Optimize"}
      </button>
      <button type="button" className="btn btn-secondary" onClick={onExport} disabled={!sourceUrl}>
        Export JSON
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onRender}
        disabled={!sourceUrl || isRendering}
        aria-busy={isRendering}
      >
        {isRendering ? "Rendering..." : "Render"}
      </button>
    </div>
  );

  return (
    <StepWorkspace
      editLabel="Edit"
      previewLabel="Preview"
      previewViewportHeight
      leftFooter={leftFooter}
      left={
        <div className="step-panel-stack">
          <header className="step-head">
            <p className="kicker">Step 3</p>
            <h2>Render</h2>
            <p>Finalize clip timing and framing, then render mp4 from the chosen version.</p>
          </header>

          <section className="control-card">
            <div className="template-inline">
              <span className="badge">Template</span>
              <strong>{templateId === STAGE3_TEMPLATE_ID ? "Science Card v1" : templateId}</strong>
              <span className="subtle-text mono">{templateId}</span>
            </div>
            <p className="subtle-text">
              Channel brand: <strong>{channelName}</strong> (@{channelUsername})
            </p>
            <div className="background-upload-row">
              <label className="btn btn-ghost background-upload-btn">
                <input
                  type="file"
                  accept="image/*,video/*"
                  className="background-upload-input"
                  disabled={isUploadingBackground}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      return;
                    }
                    void onUploadBackground(file);
                    event.currentTarget.value = "";
                  }}
                />
                {isUploadingBackground ? "Uploading..." : "Upload background"}
              </label>
              <select
                className="text-input"
                value={selectedBackgroundAssetId ?? ""}
                onChange={(event) => onSelectBackgroundAssetId(event.target.value || null)}
              >
                <option value="">Blur source background</option>
                {backgroundOptions.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.originalName}
                  </option>
                ))}
              </select>
              {backgroundAssetUrl ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onClearBackground}
                  disabled={isUploadingBackground}
                >
                  Clear background
                </button>
              ) : null}
            </div>
            <p className="subtle-text">
              {backgroundAssetUrl
                ? `Кастомный фон: ${(backgroundAssetMimeType ?? "asset").toLowerCase()}`
                : "Фон по умолчанию: blur исходного видео."}
            </p>
            <div className="background-upload-row">
              <label className="btn btn-ghost background-upload-btn">
                <input
                  type="file"
                  accept="audio/*"
                  className="background-upload-input"
                  disabled={isUploadingBackground}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      return;
                    }
                    void onUploadMusic(file);
                    event.currentTarget.value = "";
                  }}
                />
                Upload music
              </label>
              <select
                className="text-input"
                value={selectedMusicAssetId ?? ""}
                onChange={(event) => onSelectMusicAssetId(event.target.value || null)}
              >
                <option value="">No music</option>
                {musicOptions.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.originalName}
                  </option>
                ))}
              </select>
              {selectedMusicAssetId ? (
                <button type="button" className="btn btn-ghost" onClick={onClearMusic}>
                  Clear music
                </button>
              ) : null}
            </div>
          </section>

          <section className="control-card">
            <label className="field-label" htmlFor="agentPrompt">
              Optimize with editor agent
            </label>
            <textarea
              id="agentPrompt"
              className="text-area"
              rows={5}
              value={agentPrompt}
              onChange={(event) => onAgentPromptChange(event.target.value)}
              placeholder={`Пример:\n❗️ровно 6 секунд\n❗️только звук\nфрагменты:\n0:00-0:02\n0:08-конец`}
            />
            <p className="subtle-text">
              Опишите целевой монтаж: длительность, фрагменты, audio mode, slow-mo.
            </p>
            <div className="control-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onOptimize}
                disabled={!sourceUrl || isOptimizing || isRendering}
                aria-busy={isOptimizing}
              >
                {isOptimizing ? "Optimizing..." : "Optimize with editor agent"}
              </button>
            </div>
          </section>

          <details className="advanced-block">
            <summary>Advanced</summary>
            <div className="advanced-content advanced-grid">
              <div className="compact-field">
                <label className="field-label" htmlFor="clipStartInput">
                  Clip start
                </label>
                <div className="number-stepper">
                  <input
                    id="clipStartInput"
                    type="number"
                    className="text-input"
                    min={0}
                    max={maxStartSec}
                    step={0.1}
                    value={Number.isFinite(localClipStartSec) ? localClipStartSec : 0}
                    onChange={(event) => {
                      const next = Number.parseFloat(event.target.value);
                      if (!Number.isFinite(next)) {
                        return;
                      }
                      scheduleClipCommit(next);
                    }}
                    onBlur={() => flushClipCommit(localClipStartSec)}
                  />
                  <div className="stepper-buttons">
                    <button
                      type="button"
                      aria-label="Decrease clip start"
                      onClick={() => {
                        const next = localClipStartSec - 0.1;
                        scheduleClipCommit(next);
                        flushClipCommit(next);
                      }}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label="Increase clip start"
                      onClick={() => {
                        const next = localClipStartSec + 0.1;
                        scheduleClipCommit(next);
                        flushClipCommit(next);
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
                <p className="subtle-text">
                  {formatTimeSec(localClipStartSec)} → {formatTimeSec(clipEndSec)}
                </p>
              </div>

              <div className="compact-field">
                <label className="field-label" htmlFor="focusInput">
                  Vertical focus
                </label>
                <div className="number-stepper">
                  <input
                    id="focusInput"
                    type="number"
                    className="text-input"
                    min={12}
                    max={88}
                    step={1}
                    value={focusPercent}
                    onChange={(event) => {
                      const nextPercent = Number.parseInt(event.target.value, 10);
                      if (!Number.isFinite(nextPercent)) {
                        return;
                      }
                      scheduleFocusCommit(nextPercent / 100);
                    }}
                    onBlur={() => flushFocusCommit(localFocusY)}
                  />
                  <div className="stepper-buttons">
                    <button
                      type="button"
                      aria-label="Decrease vertical focus"
                      onClick={() => {
                        const next = localFocusY - 0.01;
                        scheduleFocusCommit(next);
                        flushFocusCommit(next);
                      }}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label="Increase vertical focus"
                      onClick={() => {
                        const next = localFocusY + 0.01;
                        scheduleFocusCommit(next);
                        flushFocusCommit(next);
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
                <p className="subtle-text">{focusPercent}% (12% top, 50% center, 88% bottom)</p>
              </div>

              <div className="slider-field advanced-span-2">
                <label className="field-label" htmlFor="clipStartRange">
                  Clip start slider ({formatTimeSec(localClipStartSec)})
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
              </div>
              <div className="slider-field advanced-span-2">
                <label className="field-label" htmlFor="focusRange">
                  Vertical focus slider ({focusPercent}%)
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
              </div>
              <div className="advanced-span-2">
                <p className="subtle-text">
                  Source duration: {sourceDurationSec ? formatTimeSec(sourceDurationSec) : "unknown"}
                </p>
              </div>
            </div>
          </details>
        </div>
      }
      right={
        <div className="preview-shell preview-shell-stage3">
          <header className="preview-header preview-header-wrap">
            <div>
              <h3>Live preview</h3>
              <p className="subtle-text">
                {previewVersion ? `Version v${previewVersion.versionNo}` : "Live draft preview"}
              </p>
              <p className="subtle-text preview-summary-inline">{summaryLines[0]}</p>
            </div>

            <div className="preview-toolbar">
              <button type="button" className="btn btn-ghost" onClick={handleTogglePlay}>
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button type="button" className={`btn btn-ghost ${loopEnabled ? "is-active" : ""}`} onClick={() => setLoopEnabled((prev) => !prev)}>
                Loop
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => handleFrameStep(-1)} aria-label="Previous frame">
                −1f
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => handleFrameStep(1)} aria-label="Next frame">
                +1f
              </button>

              <div className="zoom-group" role="group" aria-label="Preview zoom">
                {(["fit", 75, 100] as const).map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    className={`zoom-btn ${zoomMode === value ? "active" : ""}`}
                    onClick={() => setZoomMode(value)}
                  >
                    {value === "fit" ? "Fit" : `${value}%`}
                  </button>
                ))}
              </div>

              <button type="button" className={`btn btn-ghost ${compareEnabled ? "is-active" : ""}`} onClick={() => setCompareEnabled((prev) => !prev)}>
                A/B
              </button>

              <button type="button" className="btn btn-secondary" onClick={() => setVersionsDrawerOpen((prev) => !prev)}>
                Versions ({displayVersions.length})
              </button>
            </div>
          </header>

          {compareEnabled ? (
            <div className="compare-strip">
              <div className="compare-side-toggle" role="group" aria-label="Compare side">
                <button
                  type="button"
                  className={compareSide === "A" ? "active" : ""}
                  onClick={() => setCompareSide("A")}
                >
                  A
                </button>
                <button
                  type="button"
                  className={compareSide === "B" ? "active" : ""}
                  onClick={() => setCompareSide("B")}
                >
                  B
                </button>
              </div>
              <span className="subtle-text">
                {compareSide === "A"
                  ? `Showing A (${versionA ? `v${versionA.versionNo}` : "—"})`
                  : `Showing B (${versionB ? `v${versionB.versionNo}` : "—"})`}
              </span>
            </div>
          ) : null}

          <div className="stage3-main">
            <div className="preview-stage stage3-preview-stage">
              <div ref={previewCanvasRef} className="stage3-canvas">
                <div
                  className="stage3-zoom-wrap"
                  style={{ width: frameWidth, height: frameHeight, transform: `scale(${layoutScale})` }}
                >
                  <div className="phone-preview" style={{ width: frameWidth, height: frameHeight }}>
                    {backgroundAssetUrl ? (
                      backgroundIsVideo ? (
                        <video
                          className="preview-bg-video preview-bg-custom"
                          src={backgroundAssetUrl}
                          muted
                          autoPlay
                          loop
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <div
                          className="preview-bg-video preview-bg-custom-image"
                          style={{ backgroundImage: `url(${backgroundAssetUrl})` }}
                        />
                      )
                    ) : previewVideoUrl ? (
                      <video
                        className="preview-bg-video"
                        src={previewVideoUrl}
                        muted
                        autoPlay
                        loop
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <div className="preview-bg-video preview-bg-fallback" />
                    )}

                    <div className="safe-area-guide" aria-hidden="true">
                      <span>SAFE AREA</span>
                    </div>

                    <div
                      className="preview-card"
                      style={{
                        left: cardLeft,
                        top: cardTop,
                        width: cardWidth,
                        height: cardHeight,
                        borderRadius: SCIENCE_CARD.card.radius,
                        borderWidth: SCIENCE_CARD.card.borderWidth,
                        borderColor: SCIENCE_CARD.card.borderColor
                      }}
                    >
                      <div
                        className="preview-top"
                        style={{
                          height: topHeight,
                          padding: `${SCIENCE_CARD.slot.topPaddingY}px ${SCIENCE_CARD.slot.topPaddingX}px`
                        }}
                      >
                        <p
                          className="preview-text preview-text-top"
                          style={{
                            fontSize: previewComputed.topFont,
                            WebkitLineClamp: SCIENCE_CARD.typography.top.maxLines,
                            lineHeight: SCIENCE_CARD.typography.top.lineHeight
                          }}
                        >
                          {previewComputed.top || "TOP text from Step 2 will appear here."}
                        </p>
                      </div>

                      <div className="preview-video" style={{ height: videoHeight }}>
                        {previewVideoUrl ? (
                          <PreviewClipVideo
                            sourceUrl={previewVideoUrl}
                            clipDurationSec={clipDurationSec}
                            className="preview-slot-video"
                            objectPosition={objectPosition}
                            videoZoom={previewVideoZoom}
                            videoRef={slotPreviewRef}
                            isPlaying={isPlaying}
                            loopEnabled={loopEnabled}
                            onPositionChange={(sec) => {
                              if (!isTimelineScrubbing) {
                                setTimelineSec(sec);
                              }
                            }}
                            onClipEnd={() => {
                              setIsPlaying(false);
                            }}
                          />
                        ) : (
                          <span>VIDEO SLOT</span>
                        )}
                      </div>

                      <div
                        className="preview-bottom"
                        style={{
                          height: bottomHeight
                        }}
                      >
                        <div
                          className="preview-author"
                          style={{
                            height: bottomMetaHeight,
                            padding: `${SCIENCE_CARD.slot.bottomMetaPaddingY}px ${SCIENCE_CARD.slot.bottomMetaPaddingX}px`
                          }}
                        >
                          <div
                            className="preview-author-avatar"
                            style={{
                              width: SCIENCE_CARD.author.avatarSize,
                              height: SCIENCE_CARD.author.avatarSize,
                              borderWidth: SCIENCE_CARD.author.avatarBorder,
                              fontSize: Math.round(SCIENCE_CARD.author.avatarSize * 0.32),
                              backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
                              backgroundSize: avatarUrl ? "cover" : undefined,
                              backgroundPosition: avatarUrl ? "center" : undefined
                            }}
                          >
                            {avatarUrl ? "" : channelName.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="preview-author-copy">
                            <div className="preview-author-name-row">
                              <span
                                className="preview-author-name"
                                style={{
                                  fontSize: SCIENCE_CARD.typography.authorName.font,
                                  lineHeight: SCIENCE_CARD.typography.authorName.lineHeight
                                }}
                              >
                                {channelName}
                              </span>
                              <span
                                className="preview-author-check"
                                style={{
                                  width: SCIENCE_CARD.author.checkSize,
                                  height: SCIENCE_CARD.author.checkSize,
                                  fontSize: Math.round(SCIENCE_CARD.author.checkSize * 0.56)
                                }}
                              >
                                ✓
                              </span>
                            </div>
                            <span
                              className="preview-author-handle"
                                style={{
                                  fontSize: SCIENCE_CARD.typography.authorHandle.font,
                                  lineHeight: SCIENCE_CARD.typography.authorHandle.lineHeight
                                }}
                              >
                                @{channelUsername}
                              </span>
                          </div>
                        </div>

                        <div
                          className="preview-bottom-body"
                          style={{
                            height: previewComputed.bottomBodyHeight,
                            padding: `${SCIENCE_CARD.slot.bottomTextPaddingY}px ${SCIENCE_CARD.slot.bottomTextPaddingX}px`
                          }}
                        >
                          <p
                            className="preview-text preview-text-bottom"
                            style={{
                              fontSize: previewComputed.bottomFont,
                              WebkitLineClamp: SCIENCE_CARD.typography.bottom.maxLines,
                              lineHeight: SCIENCE_CARD.typography.bottom.lineHeight
                            }}
                          >
                            {previewComputed.bottom || "BOTTOM text from Step 2 will appear here."}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="timeline-dock">
              <div className="timeline-shell" aria-label="Timeline preview">
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
                  aria-label="Playback position"
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
                      seekTimeline(timelineSec - 1 / 30);
                    }
                    if (event.key === "ArrowRight") {
                      event.preventDefault();
                      seekTimeline(timelineSec + 1 / 30);
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
              <div className="timeline-notice">
                {isPreviewLoading ? <p className="subtle-text">Updating preview...</p> : null}
                {previewNotice ? <p className="subtle-text">{previewNotice}</p> : null}
              </div>
            </div>
          </div>

          {versionsDrawerOpen ? (
            <aside className="versions-drawer" aria-label="Version history drawer">
              <header className="versions-drawer-head">
                <h4>Version history</h4>
                <button type="button" className="btn btn-ghost" onClick={() => setVersionsDrawerOpen(false)}>
                  Close
                </button>
              </header>

              {compareEnabled ? (
                <div className="compare-selects">
                  <label className="field-label" htmlFor="compareA">Version A</label>
                  <select
                    id="compareA"
                    className="text-input"
                    value={compareAId ?? ""}
                    onChange={(event) => setCompareAId(event.target.value || null)}
                  >
                    {displayVersions.map((version) => (
                      <option key={`a-${version.runId}`} value={version.runId}>
                        v{version.versionNo} · {shortPrompt(version.prompt)}
                      </option>
                    ))}
                  </select>
                  <label className="field-label" htmlFor="compareB">Version B</label>
                  <select
                    id="compareB"
                    className="text-input"
                    value={compareBId ?? ""}
                    onChange={(event) => setCompareBId(event.target.value || null)}
                  >
                    {displayVersions.map((version) => (
                      <option key={`b-${version.runId}`} value={version.runId}>
                        v{version.versionNo} · {shortPrompt(version.prompt)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="versions-drawer-list">
                {displayVersions.length === 0 ? (
                  <p className="subtle-text">No versions yet.</p>
                ) : (
                  displayVersions.map((version) => {
                    const active = version.runId === selectedVersionId;
                    return (
                      <button
                        key={version.runId}
                        type="button"
                        className={`version-item ${active ? "active" : ""}`}
                        onClick={() => handleSelectVersion(version.runId)}
                      >
                        <div className="version-item-head">
                          <strong>v{version.versionNo}</strong>
                          <small>{formatDateShort(version.createdAt)}</small>
                        </div>
                        <p>{shortPrompt(version.prompt)}</p>
                      </button>
                    );
                  })
                )}
              </div>

              {selectedVersion ? (
                <details className="advanced-block internal-passes-inline">
                  <summary>Internal passes ({selectedVersion.internalPasses.length})</summary>
                  <div className="advanced-content">
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
                  </div>
                </details>
              ) : null}
            </aside>
          ) : null}
        </div>
      }
    />
  );
}
