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
  Stage3Segment,
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
import { sanitizeDisplayText } from "../../lib/ui-error";

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
  segments: Stage3Segment[];
  compressionEnabled: boolean;
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
  onFragmentStateChange: (value: { segments: Stage3Segment[]; compressionEnabled: boolean }) => void;
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

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeEditorSegments(
  segments: Stage3Segment[],
  sourceDurationSec: number | null
): Stage3Segment[] {
  const normalized = segments
    .map((segment, index) => {
      const startSec = Number.isFinite(segment.startSec) ? Math.max(0, segment.startSec) : null;
      if (startSec === null) {
        return null;
      }
      const maxEnd = sourceDurationSec ?? Number.POSITIVE_INFINITY;
      const rawEnd =
        segment.endSec === null
          ? sourceDurationSec ?? startSec + 0.5
          : Number.isFinite(segment.endSec)
            ? segment.endSec
            : startSec + 0.5;
      const endSec = clamp(rawEnd, startSec + 0.1, maxEnd);
      return {
        startSec: roundToTenth(startSec),
        endSec: roundToTenth(endSec),
        label:
          typeof segment.label === "string" && segment.label.trim()
            ? segment.label.trim()
            : `Фрагмент ${index + 1}`
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
    .sort((a, b) => a.startSec - b.startSec)
    .slice(0, 12);

  return normalized.map((segment, index) => ({
    ...segment,
    label: segment.label || `Фрагмент ${index + 1}`
  }));
}

function sumSegmentsDuration(segments: Stage3Segment[], sourceDurationSec: number | null): number {
  return segments.reduce((total, segment) => {
    const endSec = segment.endSec ?? sourceDurationSec ?? segment.startSec;
    return total + Math.max(0, endSec - segment.startSec);
  }, 0);
}

function trimSegmentsToDuration(
  segments: Stage3Segment[],
  targetDurationSec: number,
  sourceDurationSec: number | null
): Stage3Segment[] {
  let remaining = targetDurationSec;
  const trimmed: Stage3Segment[] = [];

  for (const segment of normalizeEditorSegments(segments, sourceDurationSec)) {
    if (remaining <= 0.05) {
      break;
    }
    const segmentEnd = segment.endSec ?? sourceDurationSec ?? segment.startSec;
    const segmentDuration = Math.max(0.1, segmentEnd - segment.startSec);
    const keepDuration = Math.min(segmentDuration, remaining);
    trimmed.push({
      ...segment,
      endSec: roundToTenth(segment.startSec + keepDuration)
    });
    remaining -= keepDuration;
  }

  return normalizeEditorSegments(trimmed, sourceDurationSec);
}

function formatScore(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "н/д";
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
      return "Лучший результат";
    case "failed":
      return "Остановлено";
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
  segments,
  compressionEnabled,
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
  onFragmentStateChange,
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
  const [segmentDraftInputs, setSegmentDraftInputs] = useState<
    Record<string, { startSec: string; endSec: string }>
  >({});

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
  const normalizedSegments = useMemo(
    () => normalizeEditorSegments(segments, sourceDurationSec),
    [segments, sourceDurationSec]
  );
  const explicitSegmentsDurationSec = useMemo(
    () => sumSegmentsDuration(normalizedSegments, sourceDurationSec),
    [normalizedSegments, sourceDurationSec]
  );
  const remainingSegmentsDurationSec = Math.max(0, clipDurationSec - explicitSegmentsDurationSec);
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
  const bottomMetaHeight = templateConfig.slot.bottomMetaHeight;
  const topPaddingTop = templateConfig.slot.topPaddingTop ?? templateConfig.slot.topPaddingY;
  const topPaddingBottom = templateConfig.slot.topPaddingBottom ?? templateConfig.slot.topPaddingY;
  const bottomTextPaddingTop =
    templateConfig.slot.bottomTextPaddingTop ?? templateConfig.slot.bottomTextPaddingY;
  const bottomTextPaddingBottom =
    templateConfig.slot.bottomTextPaddingBottom ?? templateConfig.slot.bottomTextPaddingY;
  const bottomTextPaddingLeft =
    templateConfig.slot.bottomTextPaddingLeft ?? templateConfig.slot.bottomTextPaddingX;
  const bottomTextPaddingRight =
    templateConfig.slot.bottomTextPaddingRight ?? templateConfig.slot.bottomTextPaddingX;
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
    setSegmentDraftInputs((prev) => {
      const next: Record<string, { startSec: string; endSec: string }> = {};
      normalizedSegments.forEach((segment, index) => {
        const key = `${index}:${segment.startSec}:${segment.endSec ?? "end"}`;
        next[key] = prev[key] ?? {
          startSec: segment.startSec.toFixed(1),
          endSec: (segment.endSec ?? sourceDurationSec ?? segment.startSec + 0.5).toFixed(1)
        };
      });
      return next;
    });
  }, [normalizedSegments, sourceDurationSec]);

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

  const applyClipStartImmediate = (value: number) => {
    const next = clamp(value, 0, maxStartSec);
    setLocalClipStartSec(next);
    flushClipCommit(next);
  };

  const applyFocusImmediate = (value: number) => {
    const next = clamp(value, 0.12, 0.88);
    setLocalFocusY(next);
    flushFocusCommit(next);
  };

  const applyVideoZoomImmediate = (value: number) => {
    const next = clamp(value, 1, 1.6);
    setLocalVideoZoom(next);
    flushVideoZoomCommit(next);
  };

  const applyTopFontScaleImmediate = (value: number) => {
    const next = clamp(value, 0.7, 1.9);
    setLocalTopFontScale(next);
    flushTopFontScaleCommit(next);
  };

  const applyBottomFontScaleImmediate = (value: number) => {
    const next = clamp(value, 0.7, 1.9);
    setLocalBottomFontScale(next);
    flushBottomFontScaleCommit(next);
  };

  const applyMusicGainImmediate = (value: number) => {
    const next = clamp(value, 0, 1);
    setLocalMusicGain(next);
    flushMusicGainCommit(next);
  };

  const commitFragments = useCallback(
    (nextSegments: Stage3Segment[], nextCompressionEnabled = compressionEnabled) => {
      const normalized = normalizeEditorSegments(nextSegments, sourceDurationSec);
      const bounded = nextCompressionEnabled
        ? normalized
        : trimSegmentsToDuration(normalized, clipDurationSec, sourceDurationSec);
      onFragmentStateChange({
        segments: bounded,
        compressionEnabled: nextCompressionEnabled
      });
    },
    [clipDurationSec, compressionEnabled, onFragmentStateChange, sourceDurationSec]
  );

  const createFragment = useCallback(() => {
    if (!compressionEnabled && remainingSegmentsDurationSec < 0.1) {
      return;
    }

    const defaultDuration = compressionEnabled
      ? 1
      : Math.min(1, Math.max(0.1, remainingSegmentsDurationSec));
    const lastSegment = normalizedSegments[normalizedSegments.length - 1] ?? null;
    const suggestedStart = lastSegment?.endSec ?? localClipStartSec;
    const sourceMaxStart =
      sourceDurationSec !== null ? Math.max(0, sourceDurationSec - 0.1) : suggestedStart;
    const startSec = roundToTenth(clamp(suggestedStart, 0, sourceMaxStart));
    const endSec = roundToTenth(
      clamp(
        startSec + defaultDuration,
        startSec + 0.1,
        sourceDurationSec ?? startSec + defaultDuration
      )
    );

    commitFragments([
      ...normalizedSegments,
      {
        startSec,
        endSec,
        label: `Фрагмент ${normalizedSegments.length + 1}`
      }
    ]);
  }, [
    commitFragments,
    compressionEnabled,
    localClipStartSec,
    normalizedSegments,
    remainingSegmentsDurationSec,
    sourceDurationSec
  ]);

  const removeFragment = useCallback(
    (index: number) => {
      commitFragments(normalizedSegments.filter((_, itemIndex) => itemIndex !== index));
    },
    [commitFragments, normalizedSegments]
  );

  const setFragmentDraftField = (
    index: number,
    segment: Stage3Segment,
    field: "startSec" | "endSec",
    value: string
  ) => {
    const key = `${index}:${segment.startSec}:${segment.endSec ?? "end"}`;
    setSegmentDraftInputs((prev) => ({
      ...prev,
      [key]: {
        startSec: field === "startSec" ? value : (prev[key]?.startSec ?? segment.startSec.toFixed(1)),
        endSec:
          field === "endSec"
            ? value
            : (prev[key]?.endSec ?? (segment.endSec ?? sourceDurationSec ?? segment.startSec + 0.5).toFixed(1))
      }
    }));
  };

  const commitFragmentDraft = (index: number, segment: Stage3Segment) => {
    const key = `${index}:${segment.startSec}:${segment.endSec ?? "end"}`;
    const draft = segmentDraftInputs[key];
    if (!draft) {
      return;
    }

    const parsedStart = Number.parseFloat(draft.startSec);
    const parsedEnd = Number.parseFloat(draft.endSec);
    if (!Number.isFinite(parsedStart) || !Number.isFinite(parsedEnd)) {
      setSegmentDraftInputs((prev) => ({
        ...prev,
        [key]: {
          startSec: segment.startSec.toFixed(1),
          endSec: (segment.endSec ?? sourceDurationSec ?? segment.startSec + 0.5).toFixed(1)
        }
      }));
      return;
    }

    const nextStart = roundToTenth(clamp(parsedStart, 0, sourceDurationSec ?? parsedStart));
    const sourceMaxEnd = sourceDurationSec ?? parsedEnd;
    const otherSegments = normalizedSegments.filter((_, itemIndex) => itemIndex !== index);
    const otherDuration = sumSegmentsDuration(otherSegments, sourceDurationSec);
    const maxOwnDuration = compressionEnabled
      ? Number.POSITIVE_INFINITY
      : Math.max(0.1, clipDurationSec - otherDuration);
    const requestedEnd = clamp(parsedEnd, nextStart + 0.1, sourceMaxEnd);
    const nextEnd = roundToTenth(
      clamp(requestedEnd, nextStart + 0.1, Math.min(sourceMaxEnd, nextStart + maxOwnDuration))
    );

    const nextSegments = normalizedSegments.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            startSec: nextStart,
            endSec: nextEnd
          }
        : item
    );

    commitFragments(nextSegments);
  };

  const leftFooter = (
    <div className="sticky-action-bar">
      <button type="button" className="btn btn-ghost" onClick={onReset}>
        Сбросить
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
        {isOptimizing ? "Оптимизация..." : "Оптимизировать"}
      </button>
      <button type="button" className="btn btn-secondary" onClick={onExport} disabled={!sourceUrl}>
        Экспорт JSON
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
        {isRendering ? "Рендер..." : "Рендер"}
      </button>
    </div>
  );

  return (
    <StepWorkspace
      editLabel="Редактирование"
      previewLabel="Предпросмотр"
      previewViewportHeight
      leftFooter={leftFooter}
      left={
        <div className="step-panel-stack">
          <header className="step-head">
            <p className="kicker">Шаг 3</p>
            <h2>Рендер</h2>
            <p>Финализируйте тайминг и кадрирование, затем отрендерите mp4 из выбранной версии.</p>
            <div className="render-meta-strip">
              <span className="meta-pill">
                {templateId === STAGE3_TEMPLATE_ID
                  ? "Science Card v1"
                  : templateId === TURBO_FACE_TEMPLATE_ID
                    ? "Turbo Face v1"
                    : templateId}
              </span>
              <span className="meta-pill mono">{templateId}</span>
              <span className="meta-pill">
                {channelName} (@{channelUsername})
              </span>
              <span className="meta-pill">
                Исходник {sourceDurationSec ? formatTimeSec(sourceDurationSec) : "н/д"}
              </span>
              <span className="meta-pill">Версий {displayVersions.length}</span>
            </div>
          </header>

          <section className="control-card control-card-priority">
            <div className="control-section-head">
              <div>
                <h3>Editing</h3>
                <p className="subtle-text">
                  Частые действия вынесены сюда: тайминг, фокус, зум и размеры текста.
                </p>
              </div>
              <div className="editing-status-row">
                <span className="meta-pill">
                  {normalizedSegments.length > 0 ? `Курсор ${formatTimeSec(localClipStartSec)}` : `Старт ${formatTimeSec(localClipStartSec)}`}
                </span>
                <span className="meta-pill">
                  {normalizedSegments.length > 0
                    ? `Фрагменты ${normalizedSegments.length} · ${formatTimeSec(explicitSegmentsDurationSec)}`
                    : `Окно ${formatTimeSec(clipDurationSec)}`}
                </span>
                <span className="meta-pill">Фокус {focusPercent}%</span>
                <span className="meta-pill">Зум x{localVideoZoom.toFixed(2)}</span>
              </div>
            </div>

            <div className="quick-edit-grid">
              <div className="quick-edit-card quick-edit-span-2 fragment-card">
                <div className="fragment-toolbar">
                  <label className="field-label fragment-toggle">
                    <input
                      type="checkbox"
                      checked={compressionEnabled}
                      onChange={(event) => commitFragments(normalizedSegments, event.target.checked)}
                    />
                    <span>Сжать до 6с</span>
                  </label>
                  <div className="fragment-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!sourceUrl || (!compressionEnabled && remainingSegmentsDurationSec < 0.1)}
                      onClick={createFragment}
                    >
                      + Фрагмент
                    </button>
                    {normalizedSegments.length > 0 ? (
                      <button type="button" className="btn btn-ghost" onClick={() => commitFragments([])}>
                        Очистить
                      </button>
                    ) : null}
                  </div>
                </div>

                {normalizedSegments.length > 0 ? (
                  <div className="fragment-list">
                    {normalizedSegments.map((segment, index) => {
                      const rowKey = `${index}:${segment.startSec}:${segment.endSec ?? "end"}`;
                      const draft = segmentDraftInputs[rowKey] ?? {
                        startSec: segment.startSec.toFixed(1),
                        endSec: (segment.endSec ?? sourceDurationSec ?? segment.startSec + 0.5).toFixed(1)
                      };
                      const endValue = segment.endSec ?? sourceDurationSec ?? segment.startSec + 0.5;
                      return (
                        <article key={rowKey} className="fragment-row">
                          <div className="fragment-row-head">
                            <div className="fragment-row-meta">
                              <span className="meta-pill mono">{index + 1}</span>
                              <span className="quick-edit-value">
                                {formatTimeSec(Math.max(0, endValue - segment.startSec))}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost btn-danger-soft"
                              onClick={() => removeFragment(index)}
                            >
                              ×
                            </button>
                          </div>
                          <div className="fragment-input-grid">
                            <label className="field-stack">
                              <span className="field-label">От</span>
                              <input
                                type="number"
                                min={0}
                                max={sourceDurationSec ?? undefined}
                                step={0.1}
                                className="text-input segment-input"
                                value={draft.startSec}
                                onChange={(event) =>
                                  setFragmentDraftField(index, segment, "startSec", event.target.value)
                                }
                                onBlur={() => commitFragmentDraft(index, segment)}
                              />
                            </label>
                            <label className="field-stack">
                              <span className="field-label">До</span>
                              <input
                                type="number"
                                min={0.1}
                                max={sourceDurationSec ?? undefined}
                                step={0.1}
                                className="text-input segment-input"
                                value={draft.endSec}
                                onChange={(event) =>
                                  setFragmentDraftField(index, segment, "endSec", event.target.value)
                                }
                                onBlur={() => commitFragmentDraft(index, segment)}
                              />
                            </label>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="fragment-empty subtle-text">Нет фрагментов</div>
                )}
              </div>

              <div className="quick-edit-card slider-field">
                <div className="quick-edit-label-row">
                  <label className="field-label" htmlFor="clipStartRange">
                    Начало клипа
                  </label>
                  <span className="quick-edit-value">
                    {normalizedSegments.length > 0
                      ? formatTimeSec(localClipStartSec)
                      : `${formatTimeSec(localClipStartSec)} → ${formatTimeSec(clipEndSec)}`}
                  </span>
                </div>
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
                <div className="preset-row">
                  <button type="button" className="preset-chip" onClick={() => applyClipStartImmediate(localClipStartSec - 1)}>
                    -1.0s
                  </button>
                  <button type="button" className="preset-chip" onClick={() => applyClipStartImmediate(localClipStartSec - 0.25)}>
                    -0.25s
                  </button>
                  <button type="button" className="preset-chip" onClick={() => applyClipStartImmediate(localClipStartSec + 0.25)}>
                    +0.25s
                  </button>
                  <button type="button" className="preset-chip" onClick={() => applyClipStartImmediate(localClipStartSec + 1)}>
                    +1.0s
                  </button>
                </div>
              </div>

              <div className="quick-edit-card slider-field">
                <div className="quick-edit-label-row">
                  <label className="field-label" htmlFor="focusRange">
                    Вертикальный фокус
                  </label>
                  <span className="quick-edit-value">{focusPercent}%</span>
                </div>
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
                <div className="preset-row">
                  <button type="button" className="preset-chip" onClick={() => applyFocusImmediate(0.18)}>
                    Верх
                  </button>
                  <button type="button" className="preset-chip" onClick={() => applyFocusImmediate(0.5)}>
                    Центр
                  </button>
                  <button type="button" className="preset-chip" onClick={() => applyFocusImmediate(0.82)}>
                    Низ
                  </button>
                </div>
              </div>

              <div className="quick-edit-card slider-field">
                <div className="quick-edit-label-row">
                  <label className="field-label" htmlFor="videoZoomRange">
                    Масштаб видео
                  </label>
                  <span className="quick-edit-value">x{localVideoZoom.toFixed(2)}</span>
                </div>
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
                <div className="preset-row">
                  {[1, 1.1, 1.25, 1.4].map((value) => (
                    <button
                      key={`zoom-${value}`}
                      type="button"
                      className="preset-chip"
                      onClick={() => applyVideoZoomImmediate(value)}
                    >
                      x{value.toFixed(2)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="quick-edit-card slider-field">
                <div className="quick-edit-label-row">
                  <label className="field-label" htmlFor="topFontScaleRange">
                    Размер верхнего текста
                  </label>
                  <span className="quick-edit-value">{Math.round(localTopFontScale * 100)}%</span>
                </div>
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
                <div className="preset-row">
                  {[0.9, 1, 1.15, 1.3].map((value) => (
                    <button
                      key={`top-font-${value}`}
                      type="button"
                      className="preset-chip"
                      onClick={() => applyTopFontScaleImmediate(value)}
                    >
                      {Math.round(value * 100)}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="quick-edit-card slider-field">
                <div className="quick-edit-label-row">
                  <label className="field-label" htmlFor="bottomFontScaleRange">
                    Размер нижнего текста
                  </label>
                  <span className="quick-edit-value">{Math.round(localBottomFontScale * 100)}%</span>
                </div>
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
                <div className="preset-row">
                  {[0.9, 1, 1.15, 1.3].map((value) => (
                    <button
                      key={`bottom-font-${value}`}
                      type="button"
                      className="preset-chip"
                      onClick={() => applyBottomFontScaleImmediate(value)}
                    >
                      {Math.round(value * 100)}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="control-card">
            <div className="control-section-head">
              <div>
                <h3>Музыка и фон</h3>
                <p className="subtle-text">
                  Меняются реже, поэтому вынесены после editing.
                </p>
              </div>
            </div>

            <div className="asset-grid">
              <div className="asset-card">
                <div className="quick-edit-label-row">
                  <span className="field-label">Фон</span>
                  <span className="quick-edit-value">
                    {backgroundAssetUrl ? "Custom" : "Blur source"}
                  </span>
                </div>
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
                    {isUploadingBackground ? "Загрузка..." : "Upload"}
                  </label>
                  <select
                    className="text-input"
                    value={selectedBackgroundAssetId ?? ""}
                    onChange={(event) => onSelectBackgroundAssetId(event.target.value || null)}
                  >
                    <option value="">Размытый фон из исходника</option>
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
                      Clear
                    </button>
                  ) : null}
                </div>
                <p className="subtle-text">
                  {backgroundAssetUrl
                    ? `Кастомный фон: ${(backgroundAssetMimeType ?? "asset").toLowerCase()}`
                    : "Фон по умолчанию: blur исходного видео."}
                </p>
              </div>

              <div className="asset-card">
                <div className="quick-edit-label-row">
                  <span className="field-label">Музыка</span>
                  <span className="quick-edit-value">
                    {selectedMusicAssetId ? "Enabled" : "Off"}
                  </span>
                </div>
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
                    Upload
                  </label>
                  <select
                    className="text-input"
                    value={selectedMusicAssetId ?? ""}
                    onChange={(event) => onSelectMusicAssetId(event.target.value || null)}
                  >
                    <option value="">Без музыки</option>
                    {musicOptions.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.originalName}
                      </option>
                    ))}
                  </select>
                  {selectedMusicAssetId ? (
                    <button type="button" className="btn btn-ghost" onClick={onClearMusic}>
                      Clear
                    </button>
                  ) : null}
                </div>
                <div className="slider-field">
                  <div className="quick-edit-label-row">
                    <label className="field-label" htmlFor="musicGainRange">
                      Громкость музыки
                    </label>
                    <span className="quick-edit-value">{Math.round(localMusicGain * 100)}%</span>
                  </div>
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
                  <div className="preset-row">
                    {[0, 0.2, 0.35, 0.5].map((value) => (
                      <button
                        key={`music-${value}`}
                        type="button"
                        className="preset-chip"
                        onClick={() => applyMusicGainImmediate(value)}
                      >
                        {Math.round(value * 100)}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <details className="advanced-block">
            <summary>Advanced: AI redactor, versions, редкие действия</summary>
            <div className="advanced-content">
              <section className="control-card control-card-subtle">
                <div className="agent-chat-header">
                  <div>
                    <label className="field-label" htmlFor="agentPrompt">
                      AI redactor
                    </label>
                    <p className="subtle-text">
                      Автономные итерации и timeline версий. Убрано ниже, чтобы не тормозить ручной цикл.
                    </p>
                  </div>
                  {agentSession ? (
                    <div className="agent-session-badges">
                      <span className="agent-badge">{formatSessionStatus(agentSession.status)}</span>
                      <span className="agent-badge">оценка {formatScore(agentCurrentScore)}</span>
                    </div>
                  ) : null}
                </div>

                {agentSession ? (
                  <div className="agent-session-summary">
                    <span>цель: {agentSession.goalType}</span>
                    <span>цель {agentSession.targetScore.toFixed(2)}</span>
                    <span>макс. итераций: {agentSession.maxIterations}</span>
                    <span>бюджет: {agentSession.operationBudget} оп.</span>
                    <span>
                      текущая {currentSessionVersion ? `v${currentSessionVersion.versionNo}` : "н/д"}
                    </span>
                    <span>лучшая {bestSessionVersion ? `v${bestSessionVersion.versionNo}` : "н/д"}</span>
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
                        <p>{sanitizeDisplayText(message.text)}</p>
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
                <div className="control-actions agent-chat-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onOptimize}
                    disabled={!sourceUrl || isOptimizing || isRendering}
                    aria-busy={isOptimizing}
                  >
                    {isOptimizing ? "Агент выполняет итерации..." : "Отправить в AI redactor"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={onResumeAgent}
                    disabled={!canResumeAgent}
                  >
                    Продолжить сессию
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={onRollbackSelectedVersion}
                    disabled={!canRollbackSelectedVersion}
                  >
                    Откат к версии
                  </button>
                </div>
              </section>
            </div>
          </details>
        </div>
      }
      right={
        <div className="preview-shell preview-shell-stage3">
          <header className="preview-header preview-header-wrap">
            <div>
              <h3>Живой предпросмотр</h3>
              <p className="subtle-text">
                {previewVersion ? `Версия v${previewVersion.versionNo}` : "Черновой живой предпросмотр"}
              </p>
              <p className="subtle-text preview-summary-inline">{summaryLines[0]}</p>
            </div>

            <div className="preview-toolbar">
              <button type="button" className="btn btn-ghost" onClick={handleTogglePlay}>
                {isPlaying ? "Пауза" : "Пуск"}
              </button>
              <button
                type="button"
                className={`btn btn-ghost ${!isMuted ? "is-active" : ""}`}
                onClick={() => setIsMuted((prev) => !prev)}
              >
                {!isMuted ? "Звук включен" : "Звук выключен"}
              </button>
              <button type="button" className={`btn btn-ghost ${loopEnabled ? "is-active" : ""}`} onClick={() => setLoopEnabled((prev) => !prev)}>
                Цикл
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => handleFrameStep(-1)} aria-label="Предыдущий кадр">
                −1f
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => handleFrameStep(1)} aria-label="Следующий кадр">
                +1f
              </button>

              <div className="zoom-group" role="group" aria-label="Масштаб предпросмотра">
                {(["fit", 75, 100] as const).map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    className={`zoom-btn ${zoomMode === value ? "active" : ""}`}
                    onClick={() => setZoomMode(value)}
                  >
                    {value === "fit" ? "Вписать" : `${value}%`}
                  </button>
                ))}
              </div>

              <button type="button" className="btn btn-secondary" onClick={() => setVersionsDrawerOpen((prev) => !prev)}>
                Версии ({displayVersions.length})
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
                      <span>БЕЗОПАСНАЯ ОБЛАСТЬ</span>
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
                            {previewComputed.top || "Верхний текст из Stage 2 появится здесь."}
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
                            <span>ВИДЕО</span>
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
                              {previewComputed.bottom || "Нижний текст из Stage 2 появится здесь."}
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
                            height: previewComputed.topBlockHeight,
                            padding: `${topPaddingTop}px ${templateConfig.slot.topPaddingX}px ${topPaddingBottom}px`
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
                            {previewComputed.top || "Верхний текст из Stage 2 появится здесь."}
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
                            <span>ВИДЕО</span>
                          )}
                        </div>

                        <div
                          className="preview-bottom"
                          style={{
                            height: previewComputed.bottomBlockHeight
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
                              padding: `${bottomTextPaddingTop}px ${bottomTextPaddingRight}px ${bottomTextPaddingBottom}px ${bottomTextPaddingLeft}px`
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
                              {previewComputed.bottom || "Нижний текст из Stage 2 появится здесь."}
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
              <div className="timeline-shell" aria-label="Предпросмотр timeline">
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
                {isPreviewLoading ? <p className="subtle-text">Обновляю предпросмотр...</p> : null}
                {previewNotice ? <p className="subtle-text">{sanitizeDisplayText(previewNotice)}</p> : null}
              </div>
            </div>
          </div>

          {versionsDrawerOpen ? (
            <aside className="versions-drawer" aria-label="Панель истории версий">
              <header className="versions-drawer-head">
                <h4>История версий</h4>
                <button type="button" className="btn btn-ghost" onClick={() => setVersionsDrawerOpen(false)}>
                  Закрыть
                </button>
              </header>

              <div className="versions-drawer-list">
                {displayVersions.length === 0 ? (
                  <p className="subtle-text">Версий пока нет.</p>
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
