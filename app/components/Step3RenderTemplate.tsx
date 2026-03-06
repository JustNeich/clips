"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import {
  ChannelAsset,
  Stage3AgentConversationItem,
  Stage3SessionRecord,
  Stage3Version
} from "./types";
import { StepWorkspace } from "./StepWorkspace";
import {
  TURBO_FACE,
  TURBO_FACE_TEMPLATE_ID,
  getTemplateComputed,
  STAGE3_TEMPLATE_ID,
  getTemplateById
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
  agentSession: Stage3SessionRecord | null;
  agentMessages: Stage3AgentConversationItem[];
  agentCurrentScore: number | null;
  isAgentTimelineLoading: boolean;
  canResumeAgent: boolean;
  canRollbackSelectedVersion: boolean;
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
  topFontScale: number;
  bottomFontScale: number;
  musicGain: number;
  onRender: () => void;
  onExport: () => void;
  onOptimize: () => void;
  onResumeAgent: () => void;
  onRollbackSelectedVersion: () => void;
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
  onVideoZoomChange: (value: number) => void;
  onTopFontScaleChange: (value: number) => void;
  onBottomFontScaleChange: (value: number) => void;
  onMusicGainChange: (value: number) => void;
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

function formatScore(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(2);
}

function formatSessionStatus(value: Stage3SessionRecord["status"]): string {
  switch (value) {
    case "running":
      return "В работе";
    case "completed":
      return "Готово";
    case "partiallyApplied":
      return "Best attempt";
    case "failed":
      return "Stopped";
    default:
      return value;
  }
}

function PreviewClipVideo({
  sourceUrl,
  clipDurationSec,
  className,
  objectPosition,
  videoZoom,
  muted,
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
  muted: boolean;
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
      muted={muted}
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
  agentSession,
  agentMessages,
  agentCurrentScore,
  isAgentTimelineLoading,
  canResumeAgent,
  canRollbackSelectedVersion,
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
  topFontScale,
  bottomFontScale,
  musicGain,
  onRender,
  onExport,
  onOptimize,
  onResumeAgent,
  onRollbackSelectedVersion,
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
  onFocusYChange,
  onVideoZoomChange,
  onTopFontScaleChange,
  onBottomFontScaleChange,
  onMusicGainChange
}: Step3RenderTemplateProps) {
  const slotPreviewRef = useRef<HTMLVideoElement | null>(null);
  const backgroundPreviewRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const clipCommitTimerRef = useRef<number | null>(null);
  const focusCommitTimerRef = useRef<number | null>(null);
  const videoZoomCommitTimerRef = useRef<number | null>(null);
  const topFontScaleCommitTimerRef = useRef<number | null>(null);
  const bottomFontScaleCommitTimerRef = useRef<number | null>(null);
  const musicGainCommitTimerRef = useRef<number | null>(null);

  const [localClipStartSec, setLocalClipStartSec] = useState(clipStartSec);
  const [localFocusY, setLocalFocusY] = useState(focusY);
  const [localVideoZoom, setLocalVideoZoom] = useState(videoZoom);
  const [localTopFontScale, setLocalTopFontScale] = useState(topFontScale);
  const [localBottomFontScale, setLocalBottomFontScale] = useState(bottomFontScale);
  const [localMusicGain, setLocalMusicGain] = useState(musicGain);
  const [isTimelineScrubbing, setIsTimelineScrubbing] = useState(false);
  const [timelineSec, setTimelineSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [zoomMode, setZoomMode] = useState<"fit" | 75 | 100>("fit");
  const [versionsDrawerOpen, setVersionsDrawerOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 720, height: 1280 });

  const templateConfig = getTemplateById(templateId);
  const isTurboTemplate = templateId === TURBO_FACE_TEMPLATE_ID;
  const computed = getTemplateComputed(templateId, topText, bottomText, {
    topFontScale: localTopFontScale,
    bottomFontScale: localBottomFontScale
  });

  const displayVersions = useMemo(
    () => [...versions].sort((a, b) => (a.versionNo < b.versionNo ? 1 : -1)),
    [versions]
  );

  const selectedVersion = useMemo(
    () => (selectedVersionId ? versions.find((version) => version.runId === selectedVersionId) ?? null : null),
    [versions, selectedVersionId]
  );

  const selectedPass = selectedVersion?.internalPasses[selectedPassIndex] ?? null;
  const currentSessionVersion = useMemo(
    () =>
      agentSession?.currentVersionId
        ? versions.find((version) => version.runId === agentSession.currentVersionId) ?? null
        : null,
    [agentSession?.currentVersionId, versions]
  );
  const bestSessionVersion = useMemo(
    () =>
      agentSession?.bestVersionId
        ? versions.find((version) => version.runId === agentSession.bestVersionId) ?? null
        : null,
    [agentSession?.bestVersionId, versions]
  );

  const previewVersion = selectedVersion;
  const previewTopText = previewVersion?.final.topText ?? computed.top;
  const previewBottomText = previewVersion?.final.bottomText ?? computed.bottom;
  const previewVideoZoom = clamp(localVideoZoom ?? 1, 1, 1.6);

  const previewComputed = getTemplateComputed(templateId, previewTopText, previewBottomText, {
    topFontScale: localTopFontScale,
    bottomFontScale: localBottomFontScale
  });

  const maxStartSec = Math.max(0, (sourceDurationSec ?? clipDurationSec) - clipDurationSec);
  const clipEndSec = localClipStartSec + clipDurationSec;
  const focusPercent = Math.round(localFocusY * 100);
  const objectPosition = `50% ${focusPercent}%`;

  const frameWidth = templateConfig.frame.width;
  const frameHeight = templateConfig.frame.height;

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
  const cardLeft = templateConfig.card.x;
  const cardTop = templateConfig.card.y;
  const cardWidth = templateConfig.card.width;
  const cardHeight = templateConfig.card.height;
  const topHeight = templateConfig.slot.topHeight;
  const bottomHeight = templateConfig.slot.bottomHeight;
  const bottomMetaHeight = templateConfig.slot.bottomMetaHeight;
  const bottomTextPaddingTop =
    templateConfig.slot.bottomTextPaddingTop ?? templateConfig.slot.bottomTextPaddingY;
  const bottomTextPaddingBottom =
    templateConfig.slot.bottomTextPaddingBottom ?? templateConfig.slot.bottomTextPaddingY;
  const videoHeight = previewComputed.videoHeight;

  const timelinePercent = clamp((timelineSec / Math.max(0.01, clipDurationSec)) * 100, 0, 100);
  const backgroundIsVideo =
    Boolean(backgroundAssetUrl) &&
    ((backgroundAssetMimeType ?? "").toLowerCase().startsWith("video/") ||
      /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(backgroundAssetUrl ?? ""));

  useEffect(() => {
    setLocalClipStartSec(clamp(clipStartSec, 0, maxStartSec));
  }, [clipStartSec, maxStartSec]);

  useEffect(() => {
    setLocalFocusY(clamp(focusY, 0.12, 0.88));
  }, [focusY]);

  useEffect(() => {
    setLocalVideoZoom(clamp(videoZoom, 1, 1.6));
  }, [videoZoom]);

  useEffect(() => {
    setLocalTopFontScale(clamp(topFontScale, 0.7, 1.9));
  }, [topFontScale]);

  useEffect(() => {
    setLocalBottomFontScale(clamp(bottomFontScale, 0.7, 1.9));
  }, [bottomFontScale]);

  useEffect(() => {
    setLocalMusicGain(clamp(musicGain, 0, 1));
  }, [musicGain]);

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
    setTimelineSec(0);
  }, [previewVideoUrl]);

  const syncBackgroundTo = useCallback((sec: number) => {
    const bg = backgroundPreviewRef.current;
    if (!bg) {
      return;
    }
    if (bg.readyState < 1) {
      return;
    }
    const duration = Number.isFinite(bg.duration) && bg.duration > 0 ? bg.duration : null;
    const next = duration ? sec % duration : sec;
    if (Math.abs(bg.currentTime - next) > 0.08) {
      bg.currentTime = next;
    }
    if (isPlaying && bg.paused) {
      void bg.play().catch(() => undefined);
    }
  }, [isPlaying]);

  useEffect(() => {
    const bg = backgroundPreviewRef.current;
    if (!bg) {
      return;
    }
    if (isPlaying) {
      void bg.play().catch(() => undefined);
    } else {
      bg.pause();
    }
  }, [isPlaying, backgroundAssetUrl, previewVideoUrl]);

  useEffect(() => {
    return () => {
      if (clipCommitTimerRef.current !== null) {
        window.clearTimeout(clipCommitTimerRef.current);
      }
      if (focusCommitTimerRef.current !== null) {
        window.clearTimeout(focusCommitTimerRef.current);
      }
      if (videoZoomCommitTimerRef.current !== null) {
        window.clearTimeout(videoZoomCommitTimerRef.current);
      }
      if (topFontScaleCommitTimerRef.current !== null) {
        window.clearTimeout(topFontScaleCommitTimerRef.current);
      }
      if (bottomFontScaleCommitTimerRef.current !== null) {
        window.clearTimeout(bottomFontScaleCommitTimerRef.current);
      }
      if (musicGainCommitTimerRef.current !== null) {
        window.clearTimeout(musicGainCommitTimerRef.current);
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

  const flushVideoZoomCommit = (value: number) => {
    if (videoZoomCommitTimerRef.current !== null) {
      window.clearTimeout(videoZoomCommitTimerRef.current);
      videoZoomCommitTimerRef.current = null;
    }
    onVideoZoomChange(clamp(value, 1, 1.6));
  };

  const scheduleVideoZoomCommit = (value: number) => {
    const next = clamp(value, 1, 1.6);
    setLocalVideoZoom(next);
    if (videoZoomCommitTimerRef.current !== null) {
      window.clearTimeout(videoZoomCommitTimerRef.current);
    }
    videoZoomCommitTimerRef.current = window.setTimeout(() => {
      onVideoZoomChange(next);
      videoZoomCommitTimerRef.current = null;
    }, 320);
  };

  const flushTopFontScaleCommit = (value: number) => {
    if (topFontScaleCommitTimerRef.current !== null) {
      window.clearTimeout(topFontScaleCommitTimerRef.current);
      topFontScaleCommitTimerRef.current = null;
    }
    onTopFontScaleChange(clamp(value, 0.7, 1.9));
  };

  const scheduleTopFontScaleCommit = (value: number) => {
    const next = clamp(value, 0.7, 1.9);
    setLocalTopFontScale(next);
    if (topFontScaleCommitTimerRef.current !== null) {
      window.clearTimeout(topFontScaleCommitTimerRef.current);
    }
    topFontScaleCommitTimerRef.current = window.setTimeout(() => {
      onTopFontScaleChange(next);
      topFontScaleCommitTimerRef.current = null;
    }, 320);
  };

  const flushBottomFontScaleCommit = (value: number) => {
    if (bottomFontScaleCommitTimerRef.current !== null) {
      window.clearTimeout(bottomFontScaleCommitTimerRef.current);
      bottomFontScaleCommitTimerRef.current = null;
    }
    onBottomFontScaleChange(clamp(value, 0.7, 1.9));
  };

  const scheduleBottomFontScaleCommit = (value: number) => {
    const next = clamp(value, 0.7, 1.9);
    setLocalBottomFontScale(next);
    if (bottomFontScaleCommitTimerRef.current !== null) {
      window.clearTimeout(bottomFontScaleCommitTimerRef.current);
    }
    bottomFontScaleCommitTimerRef.current = window.setTimeout(() => {
      onBottomFontScaleChange(next);
      bottomFontScaleCommitTimerRef.current = null;
    }, 320);
  };

  const flushMusicGainCommit = (value: number) => {
    if (musicGainCommitTimerRef.current !== null) {
      window.clearTimeout(musicGainCommitTimerRef.current);
      musicGainCommitTimerRef.current = null;
    }
    onMusicGainChange(clamp(value, 0, 1));
  };

  const scheduleMusicGainCommit = (value: number) => {
    const next = clamp(value, 0, 1);
    setLocalMusicGain(next);
    if (musicGainCommitTimerRef.current !== null) {
      window.clearTimeout(musicGainCommitTimerRef.current);
    }
    musicGainCommitTimerRef.current = window.setTimeout(() => {
      onMusicGainChange(next);
      musicGainCommitTimerRef.current = null;
    }, 320);
  };

  const seekTimeline = useCallback(
    (value: number) => {
      const clamped = clamp(value, 0, clipDurationSec);
      setTimelineSec(clamped);
      const video = slotPreviewRef.current;
      if (video) {
        video.currentTime = clamped;
      }
      syncBackgroundTo(clamped);
    },
    [clipDurationSec, syncBackgroundTo]
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
  };

  const summaryLines = previewVersion?.diff.summary ?? ["Используется текущий live draft без сохраненной версии."];

  const commitAdvancedControls = () => {
    flushClipCommit(localClipStartSec);
    flushFocusCommit(localFocusY);
    flushVideoZoomCommit(localVideoZoom);
    flushTopFontScaleCommit(localTopFontScale);
    flushBottomFontScaleCommit(localBottomFontScale);
    flushMusicGainCommit(localMusicGain);
  };

  const leftFooter = (
    <div className="sticky-action-bar">
      <button type="button" className="btn btn-ghost" onClick={onReset}>
        Reset
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          commitAdvancedControls();
          onOptimize();
        }}
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
        onClick={() => {
          commitAdvancedControls();
          onRender();
        }}
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
              <strong>
                {templateId === STAGE3_TEMPLATE_ID
                  ? "Science Card v1"
                  : templateId === TURBO_FACE_TEMPLATE_ID
                    ? "Turbo Face v1"
                    : templateId}
              </strong>
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
            <div className="agent-chat-header">
              <div>
                <label className="field-label" htmlFor="agentPrompt">
                  Redactor agent
                </label>
                <p className="subtle-text">
                  Агент сам итерирует изменения, сверяет результат и сохраняет timeline версий.
                </p>
              </div>
              {agentSession ? (
                <div className="agent-session-badges">
                  <span className="agent-badge">{formatSessionStatus(agentSession.status)}</span>
                  <span className="agent-badge">score {formatScore(agentCurrentScore)}</span>
                </div>
              ) : null}
            </div>

            {agentSession ? (
              <div className="agent-session-summary">
                <span>goal: {agentSession.goalType}</span>
                <span>target {agentSession.targetScore.toFixed(2)}</span>
                <span>{agentSession.maxIterations} iter max</span>
                <span>budget {agentSession.operationBudget} ops</span>
                <span>
                  current {currentSessionVersion ? `v${currentSessionVersion.versionNo}` : "n/a"}
                </span>
                <span>best {bestSessionVersion ? `v${bestSessionVersion.versionNo}` : "n/a"}</span>
              </div>
            ) : null}

            <div className="agent-chat-shell" aria-live="polite">
              {isAgentTimelineLoading ? (
                <p className="subtle-text">Загружаю timeline сессии...</p>
              ) : null}

              {!agentMessages.length && !isAgentTimelineLoading ? (
                <div className="agent-empty-state">
                  <strong>Чат появится после первого запуска.</strong>
                  <p>
                    Напишите общую цель вроде "собери так, чтобы было видно только модель", затем агент
                    сам применит несколько итераций и опишет фактические изменения.
                  </p>
                </div>
              ) : (
                agentMessages.map((message) => (
                  <article
                    key={message.id}
                    className={`agent-message agent-message-${message.role} agent-tone-${message.tone ?? "neutral"}`}
                  >
                    <div className="agent-message-head">
                      <strong>{message.title}</strong>
                      <span>{formatDateShort(message.createdAt)}</span>
                    </div>
                    <p>{message.text}</p>
                    {message.meta.length ? (
                      <div className="agent-message-meta">
                        {message.meta.map((meta, index) => (
                          <span key={`${message.id}-meta-${index}`}>{meta}</span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>

            <textarea
              id="agentPrompt"
              className="text-area"
              rows={5}
              value={agentPrompt}
              onChange={(event) => onAgentPromptChange(event.target.value)}
              placeholder={`Примеры:\nСожми исходное видео до 6с.\nРастяни исходное видео до 6с без резких jump cut.\nФрагменты: 1. 3-6с 2. 9-12с.\nСмонтируй так, чтобы было видно только модель.`}
            />
            <p className="subtle-text">
              Можно писать общую цель. Агент сам выберет шаги, оценит результат и продолжит цикл без
              ручной паузы. Поддерживаются запросы на сжатие/растягивание до 6с, нарезку по фрагментам,
              зум, позиционирование, audio mode и смешанные инструкции.
            </p>
            <div className="control-actions agent-chat-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onOptimize}
                disabled={!sourceUrl || isOptimizing || isRendering}
                aria-busy={isOptimizing}
              >
                {isOptimizing ? "Agent is iterating..." : "Send to redactor agent"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onResumeAgent}
                disabled={!canResumeAgent}
              >
                Continue current session
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onRollbackSelectedVersion}
                disabled={!canRollbackSelectedVersion}
              >
                Rollback to selected version
              </button>
            </div>
          </section>

          <details className="advanced-block">
            <summary>Advanced</summary>
            <div className="advanced-content advanced-grid">
              <div className="slider-field advanced-span-2">
                <label className="field-label" htmlFor="clipStartRange">
                  Clip start ({formatTimeSec(localClipStartSec)} → {formatTimeSec(clipEndSec)})
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
                <p className="subtle-text">12% = top, 50% = center, 88% = bottom</p>
              </div>

              <div className="slider-field advanced-span-2">
                <label className="field-label" htmlFor="videoZoomRange">
                  Video zoom (x{localVideoZoom.toFixed(2)})
                </label>
                <input
                  id="videoZoomRange"
                  type="range"
                  min={1}
                  max={1.6}
                  step={0.01}
                  value={localVideoZoom}
                  onChange={(event) => scheduleVideoZoomCommit(Number.parseFloat(event.target.value))}
                  onMouseUp={() => flushVideoZoomCommit(localVideoZoom)}
                  onTouchEnd={() => flushVideoZoomCommit(localVideoZoom)}
                  onBlur={() => flushVideoZoomCommit(localVideoZoom)}
                />
              </div>

              <div className="slider-field advanced-span-2">
                <label className="field-label" htmlFor="topFontScaleRange">
                  Top text size ({Math.round(localTopFontScale * 100)}%)
                </label>
                <input
                  id="topFontScaleRange"
                  type="range"
                  min={0.7}
                  max={1.9}
                  step={0.01}
                  value={localTopFontScale}
                  onChange={(event) => scheduleTopFontScaleCommit(Number.parseFloat(event.target.value))}
                  onMouseUp={() => flushTopFontScaleCommit(localTopFontScale)}
                  onTouchEnd={() => flushTopFontScaleCommit(localTopFontScale)}
                  onBlur={() => flushTopFontScaleCommit(localTopFontScale)}
                />
              </div>

              <div className="slider-field advanced-span-2">
                <label className="field-label" htmlFor="bottomFontScaleRange">
                  Bottom text size ({Math.round(localBottomFontScale * 100)}%)
                </label>
                <input
                  id="bottomFontScaleRange"
                  type="range"
                  min={0.7}
                  max={1.9}
                  step={0.01}
                  value={localBottomFontScale}
                  onChange={(event) => scheduleBottomFontScaleCommit(Number.parseFloat(event.target.value))}
                  onMouseUp={() => flushBottomFontScaleCommit(localBottomFontScale)}
                  onTouchEnd={() => flushBottomFontScaleCommit(localBottomFontScale)}
                  onBlur={() => flushBottomFontScaleCommit(localBottomFontScale)}
                />
              </div>

              <div className="slider-field advanced-span-2">
                <label className="field-label" htmlFor="musicGainRange">
                  Music gain ({Math.round(localMusicGain * 100)}%)
                </label>
                <input
                  id="musicGainRange"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={localMusicGain}
                  onChange={(event) => scheduleMusicGainCommit(Number.parseFloat(event.target.value))}
                  onMouseUp={() => flushMusicGainCommit(localMusicGain)}
                  onTouchEnd={() => flushMusicGainCommit(localMusicGain)}
                  onBlur={() => flushMusicGainCommit(localMusicGain)}
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
              <button
                type="button"
                className={`btn btn-ghost ${!isMuted ? "is-active" : ""}`}
                onClick={() => setIsMuted((prev) => !prev)}
              >
                {!isMuted ? "Sound on" : "Sound off"}
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

              <button type="button" className="btn btn-secondary" onClick={() => setVersionsDrawerOpen((prev) => !prev)}>
                Versions ({displayVersions.length})
              </button>
            </div>
          </header>

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
                          ref={backgroundPreviewRef}
                          className="preview-bg-video preview-bg-custom"
                          src={backgroundAssetUrl}
                          muted
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={() => {
                            syncBackgroundTo(timelineSec);
                            if (isPlaying) {
                              const bg = backgroundPreviewRef.current;
                              if (bg) {
                                void bg.play().catch(() => undefined);
                              }
                            }
                          }}
                        />
                      ) : (
                        <div
                          className="preview-bg-video preview-bg-custom-image"
                          style={{ backgroundImage: `url(${backgroundAssetUrl})` }}
                        />
                      )
                    ) : previewVideoUrl ? (
                      <video
                        ref={backgroundPreviewRef}
                        className="preview-bg-video"
                        src={previewVideoUrl}
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={() => {
                          syncBackgroundTo(timelineSec);
                          if (isPlaying) {
                            const bg = backgroundPreviewRef.current;
                            if (bg) {
                              void bg.play().catch(() => undefined);
                            }
                          }
                        }}
                      />
                    ) : (
                      <div className="preview-bg-video preview-bg-fallback" />
                    )}

                    <div className="safe-area-guide" aria-hidden="true">
                      <span>SAFE AREA</span>
                    </div>

                    {isTurboTemplate ? (
                      <>
                        <div
                          className="preview-top"
                          style={{
                            position: "absolute",
                            left: TURBO_FACE.top.x,
                            top: TURBO_FACE.top.y,
                            width: TURBO_FACE.top.width,
                            height: previewComputed.topBlockHeight,
                            borderRadius: TURBO_FACE.top.radius,
                            backgroundColor: "#ffffff",
                            boxShadow: "0 14px 32px rgba(0,0,0,0.22)",
                            border: "2px solid rgba(0,0,0,0.18)",
                            padding: `${TURBO_FACE.top.paddingY}px ${TURBO_FACE.top.paddingX}px`
                          }}
                        >
                          <p
                            className="preview-text preview-text-top"
                              style={{
                                fontSize: previewComputed.topFont,
                                WebkitLineClamp: TURBO_FACE.typography.top.maxLines,
                                lineHeight: previewComputed.topLineHeight
                              }}
                          >
                            {previewComputed.top || "TOP text from Step 2 will appear here."}
                          </p>
                        </div>

                        <div
                          className="preview-video"
                          style={{
                            position: "absolute",
                            left: previewComputed.videoX,
                            top: previewComputed.videoY,
                            width: previewComputed.videoWidth,
                            height: previewComputed.videoHeight
                          }}
                        >
                          {previewVideoUrl ? (
                            <PreviewClipVideo
                              sourceUrl={previewVideoUrl}
                              clipDurationSec={clipDurationSec}
                              className="preview-slot-video"
                              objectPosition={objectPosition}
                              videoZoom={previewVideoZoom}
                              muted={isMuted}
                              videoRef={slotPreviewRef}
                              isPlaying={isPlaying}
                              loopEnabled={loopEnabled}
                              onPositionChange={(sec) => {
                                if (!isTimelineScrubbing) {
                                  setTimelineSec(sec);
                                }
                                syncBackgroundTo(sec);
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
                            position: "absolute",
                            left: TURBO_FACE.bottom.x,
                            top: TURBO_FACE.frame.height - TURBO_FACE.bottom.bottom - previewComputed.bottomBlockHeight,
                            width: TURBO_FACE.bottom.width,
                            height: previewComputed.bottomBlockHeight,
                            borderRadius: TURBO_FACE.bottom.radius,
                            backgroundColor: "#ffffff",
                            boxShadow: "0 16px 36px rgba(0,0,0,0.26)",
                            border: "2px solid rgba(0,0,0,0.18)"
                          }}
                        >
                          <div
                            className="preview-author"
                            style={{
                              height: TURBO_FACE.bottom.metaHeight + TURBO_FACE.bottom.paddingY * 2,
                              padding: `${TURBO_FACE.bottom.paddingY}px ${TURBO_FACE.bottom.paddingX}px`
                            }}
                          >
                            <div
                              className="preview-author-avatar"
                              style={{
                                width: TURBO_FACE.author.avatarSize,
                                height: TURBO_FACE.author.avatarSize,
                                borderWidth: TURBO_FACE.author.avatarBorder,
                                fontSize: Math.round(TURBO_FACE.author.avatarSize * 0.32),
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
                                    fontSize: TURBO_FACE.typography.authorName.font,
                                    lineHeight: TURBO_FACE.typography.authorName.lineHeight
                                  }}
                                >
                                  {channelName}
                                </span>
                                <span
                                  className="preview-author-check"
                                  style={{
                                    width: TURBO_FACE.author.checkSize,
                                    height: TURBO_FACE.author.checkSize,
                                    fontSize: Math.round(TURBO_FACE.author.checkSize * 0.56)
                                  }}
                                >
                                  ✓
                                </span>
                              </div>
                              <span
                                className="preview-author-handle"
                                style={{
                                  fontSize: TURBO_FACE.typography.authorHandle.font,
                                  lineHeight: TURBO_FACE.typography.authorHandle.lineHeight,
                                  color: "#666666"
                                }}
                              >
                                @{channelUsername}
                              </span>
                            </div>
                          </div>

                          <div
                            className="preview-bottom-body"
                            style={{
                              height:
                                previewComputed.bottomBlockHeight -
                                (TURBO_FACE.bottom.metaHeight + TURBO_FACE.bottom.paddingY * 2),
                              padding: `0 ${TURBO_FACE.bottom.paddingX}px ${TURBO_FACE.bottom.paddingY}px ${TURBO_FACE.bottom.paddingX}px`
                            }}
                          >
                            <p
                              className="preview-text preview-text-bottom"
                              style={{
                                fontSize: previewComputed.bottomFont,
                                WebkitLineClamp: TURBO_FACE.typography.bottom.maxLines,
                                lineHeight: previewComputed.bottomLineHeight
                              }}
                            >
                              {previewComputed.bottom || "BOTTOM text from Step 2 will appear here."}
                            </p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div
                        className="preview-card"
                        style={{
                          left: cardLeft,
                          top: cardTop,
                          width: cardWidth,
                          height: cardHeight,
                          borderRadius: templateConfig.card.radius,
                          borderWidth: templateConfig.card.borderWidth,
                          borderColor: templateConfig.card.borderColor
                        }}
                      >
                        <div
                          className="preview-top"
                          style={{
                            height: topHeight,
                            padding: `${templateConfig.slot.topPaddingY}px ${templateConfig.slot.topPaddingX}px`
                          }}
                        >
                          <p
                            className="preview-text preview-text-top"
                            style={{
                              fontSize: previewComputed.topFont,
                              WebkitLineClamp: templateConfig.typography.top.maxLines,
                              lineHeight: previewComputed.topLineHeight
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
                              muted={isMuted}
                              videoRef={slotPreviewRef}
                              isPlaying={isPlaying}
                              loopEnabled={loopEnabled}
                              onPositionChange={(sec) => {
                                if (!isTimelineScrubbing) {
                                  setTimelineSec(sec);
                                }
                                syncBackgroundTo(sec);
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
                              padding: `${templateConfig.slot.bottomMetaPaddingY}px ${templateConfig.slot.bottomMetaPaddingX}px`
                            }}
                          >
                            <div
                              className="preview-author-avatar"
                              style={{
                                width: templateConfig.author.avatarSize,
                                height: templateConfig.author.avatarSize,
                                borderWidth: templateConfig.author.avatarBorder,
                                fontSize: Math.round(templateConfig.author.avatarSize * 0.32),
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
                                    fontSize: templateConfig.typography.authorName.font,
                                    lineHeight: templateConfig.typography.authorName.lineHeight
                                  }}
                                >
                                  {channelName}
                                </span>
                                <span
                                  className="preview-author-check"
                                  style={{
                                    width: templateConfig.author.checkSize,
                                    height: templateConfig.author.checkSize,
                                    fontSize: Math.round(templateConfig.author.checkSize * 0.56)
                                  }}
                                >
                                  ✓
                                </span>
                              </div>
                              <span
                                className="preview-author-handle"
                                style={{
                                  fontSize: templateConfig.typography.authorHandle.font,
                                  lineHeight: templateConfig.typography.authorHandle.lineHeight
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
                              padding: `${bottomTextPaddingTop}px ${templateConfig.slot.bottomTextPaddingX}px ${bottomTextPaddingBottom}px`
                            }}
                          >
                            <p
                              className="preview-text preview-text-bottom"
                            style={{
                              fontSize: previewComputed.bottomFont,
                              WebkitLineClamp: templateConfig.typography.bottom.maxLines,
                              lineHeight: previewComputed.bottomLineHeight
                            }}
                            >
                              {previewComputed.bottom || "BOTTOM text from Step 2 will appear here."}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
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
