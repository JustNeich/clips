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
  Stage3CameraMotion,
  Stage3EditorDraftOverrides,
  Stage3PreviewState,
  Stage3RenderState,
  Stage3Segment,
  STAGE3_SEGMENT_SPEED_OPTIONS,
  Stage3SessionRecord,
  Stage3TextFitSnapshot,
  TemplateContentFixture,
  Stage3Version,
  Stage3WorkerPairingResponse,
  Stage3WorkerStatus
} from "./types";
import { StepWorkspace } from "./StepWorkspace";
import { Stage3TemplateRenderer } from "../../lib/stage3-template-renderer";
import { getTemplateById } from "../../lib/stage3-template";
import {
  TemplateRenderSnapshot,
  buildTemplateRenderSnapshot
} from "../../lib/stage3-template-core";
import {
  Stage3TemplateViewport,
  getTemplatePreviewViewportMetrics
} from "../../lib/stage3-template-viewport";
import {
  resolveTemplateAvatarBorderColor,
  resolveTemplateOverlayTint,
  templateUsesBuiltInBackdropFromRegistry
} from "../../lib/stage3-template-registry";
import { resolveTemplateBackdropNode } from "../../lib/stage3-template-runtime";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "../../lib/stage3-constants";
import { getStage3DesignLabLabel } from "../../lib/stage3-design-lab";
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
  previewState: Stage3PreviewState;
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
  renderState: Stage3RenderState;
  workerState: Stage3WorkerStatus | "not_paired";
  workerLabel: string | null;
  workerPlatform: string | null;
  workerLastSeenAt: string | null;
  workerPairing: Stage3WorkerPairingResponse | null;
  isWorkerPairing: boolean;
  showWorkerControls: boolean;
  isOptimizing: boolean;
  isUploadingBackground: boolean;
  clipStartSec: number;
  clipDurationSec: number;
  sourceDurationSec: number | null;
  focusY: number;
  cameraMotion: Stage3CameraMotion;
  mirrorEnabled: boolean;
  videoZoom: number;
  topFontScale: number;
  bottomFontScale: number;
  sourceAudioEnabled: boolean;
  musicGain: number;
  onRender: (overrides?: Stage3EditorDraftOverrides, textFitOverride?: Stage3TextFitSnapshot | null) => void;
  onExport: () => void;
  onOptimize: (overrides?: Stage3EditorDraftOverrides, textFitOverride?: Stage3TextFitSnapshot | null) => void;
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
  onCameraMotionChange: (value: Stage3CameraMotion) => void;
  onMirrorEnabledChange: (value: boolean) => void;
  onVideoZoomChange: (value: number) => void;
  onTopFontScaleChange: (value: number) => void;
  onBottomFontScaleChange: (value: number) => void;
  onSourceAudioEnabledChange: (value: boolean) => void;
  onMusicGainChange: (value: number) => void;
  onCreateWorkerPairing: () => void;
};

const SEGMENT_SPEED_SET = new Set<number>(STAGE3_SEGMENT_SPEED_OPTIONS);
type WorkerGuidePlatform = "darwin" | "windows";
type WorkerInstallLink = {
  label: string;
  href: string;
  description: string;
};

function formatTimeSec(value: number): string {
  const total = Math.max(0, value);
  const min = Math.floor(total / 60);
  const sec = Math.floor(total % 60);
  const ms = Math.floor((total - Math.floor(total)) * 10);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${ms}`;
}

function detectWorkerGuidePlatform(): WorkerGuidePlatform {
  if (typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent)) {
    return "windows";
  }
  return "darwin";
}

function getWorkerInstallLinks(platform: WorkerGuidePlatform): WorkerInstallLink[] {
  if (platform === "windows") {
    return [
      {
        label: "Скачать Node.js",
        href: "https://nodejs.org/en/download",
        description: "Откройте страницу и скачайте версию LTS."
      },
      {
        label: "Скачать FFmpeg",
        href: "https://ffmpeg.org/download.html#build-windows",
        description: "Официальная страница со сборками FFmpeg для Windows."
      },
      {
        label: "Скачать yt-dlp",
        href: "https://github.com/yt-dlp/yt-dlp/releases/latest",
        description: "Страница последнего релиза yt-dlp."
      },
      {
        label: "Справка по winget",
        href: "https://learn.microsoft.com/en-us/windows/package-manager/winget/",
        description: "Откройте, если команда winget не запускается."
      }
    ];
  }

  return [
    {
      label: "Скачать Node.js",
      href: "https://nodejs.org/en/download",
      description: "Откройте страницу и скачайте версию LTS."
    },
    {
      label: "Установить Homebrew",
      href: "https://brew.sh/",
      description: "Самый простой способ поставить ffmpeg и yt-dlp на Mac."
    },
    {
      label: "FFmpeg для Mac",
      href: "https://ffmpeg.org/download.html#build-mac",
      description: "Официальная страница загрузок FFmpeg для macOS."
    },
    {
      label: "Установка yt-dlp",
      href: "https://github.com/yt-dlp/yt-dlp/wiki/Installation",
      description: "Официальная инструкция по установке yt-dlp."
    }
  ];
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

function toTextFitSnapshot(
  computed: {
    topFont: number;
    bottomFont: number;
    topLineHeight: number;
    bottomLineHeight: number;
    topLines: number;
    bottomLines: number;
  },
  templateSnapshot: TemplateRenderSnapshot
): Stage3TextFitSnapshot {
  return {
    topFontPx: computed.topFont,
    bottomFontPx: computed.bottomFont,
    topLineHeight: computed.topLineHeight,
    bottomLineHeight: computed.bottomLineHeight,
    topLines: computed.topLines,
    bottomLines: computed.bottomLines,
    topCompacted: templateSnapshot.fit.topCompacted,
    bottomCompacted: templateSnapshot.fit.bottomCompacted
  };
}

function areTextFitSnapshotsEqual(
  left: Stage3TextFitSnapshot | null | undefined,
  right: Stage3TextFitSnapshot | null | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.topFontPx === right.topFontPx &&
    left.bottomFontPx === right.bottomFontPx &&
    left.topLineHeight === right.topLineHeight &&
    left.bottomLineHeight === right.bottomLineHeight &&
    left.topLines === right.topLines &&
    left.bottomLines === right.bottomLines &&
    left.topCompacted === right.topCompacted &&
    left.bottomCompacted === right.bottomCompacted
  );
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeSegmentSpeed(value: unknown): Stage3Segment["speed"] {
  if (typeof value === "number" && Number.isFinite(value) && SEGMENT_SPEED_SET.has(value)) {
    return value as Stage3Segment["speed"];
  }
  return 1;
}

function formatSegmentSpeed(speed: Stage3Segment["speed"]): string {
  return Number.isInteger(speed) ? `x${speed}` : `x${speed.toFixed(1)}`;
}

function resolveAnimatedFocusY(
  baseFocusY: number,
  cameraMotion: Stage3CameraMotion,
  progress: number
): number {
  const focus = clamp(baseFocusY, 0.12, 0.88);
  if (cameraMotion === "disabled") {
    return focus;
  }

  const sweep = 0.28;
  const start = clamp(focus - sweep / 2, 0.12, 0.88 - sweep);
  const end = clamp(start + sweep, 0.12, 0.88);
  const t = clamp(progress, 0, 1);
  const easedT = 0.5 - Math.cos(t * Math.PI) / 2;
  // Blend eased motion with linear drift so the camera starts moving immediately
  // and does not visually "stall" at loop boundaries.
  const motionT = t * 0.72 + easedT * 0.28;
  return cameraMotion === "top_to_bottom"
    ? start + (end - start) * motionT
    : end - (end - start) * motionT;
}

function formatCameraMotion(value: Stage3CameraMotion): string {
  switch (value) {
    case "top_to_bottom":
      return "Сверху вниз";
    case "bottom_to_top":
      return "Снизу вверх";
    default:
      return "Отключено";
  }
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
        speed: normalizeSegmentSpeed(segment.speed),
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
    return total + Math.max(0, endSec - segment.startSec) / normalizeSegmentSpeed(segment.speed);
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
    const keepDuration = Math.min(segmentDuration, remaining * segment.speed);
    trimmed.push({
      ...segment,
      endSec: roundToTenth(segment.startSec + keepDuration)
    });
    remaining -= keepDuration / segment.speed;
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
  mirrorEnabled,
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
  mirrorEnabled: boolean;
  muted: boolean;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  loopEnabled: boolean;
  onPositionChange?: (sec: number) => void;
  onClipEnd?: () => void;
}) {
  const frameLoopTokenRef = useRef<number | null>(null);
  const lastPublishedTimeRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const seekToStart = () => {
      lastPublishedTimeRef.current = 0;
      video.currentTime = 0;
      onPositionChange?.(0);
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
  }, [isPlaying, onPositionChange, sourceUrl, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (isPlaying) {
      if (video.ended || video.currentTime >= Math.max(0, clipDurationSec - 0.02)) {
        lastPublishedTimeRef.current = 0;
        video.currentTime = 0;
        onPositionChange?.(0);
      }
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [clipDurationSec, isPlaying, onPositionChange, sourceUrl, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleEnded = () => {
      lastPublishedTimeRef.current = 0;
      if (loopEnabled && isPlaying) {
        video.currentTime = 0;
        onPositionChange?.(0);
        void video.play().catch(() => undefined);
        return;
      }
      onClipEnd?.();
    };

    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("ended", handleEnded);
    };
  }, [isPlaying, loopEnabled, onClipEnd, onPositionChange, videoRef]);

  const publishPosition = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return false;
    }
    const currentTime = video.currentTime;
    const previousTime = lastPublishedTimeRef.current;
    lastPublishedTimeRef.current = currentTime;

    if (loopEnabled && currentTime + 1 / 60 < previousTime) {
      onPositionChange?.(0);
    }
    onPositionChange?.(currentTime);

    if (!loopEnabled && currentTime >= clipDurationSec - 0.02) {
      video.pause();
      lastPublishedTimeRef.current = 0;
      onClipEnd?.();
      return false;
    }
    return true;
  }, [clipDurationSec, loopEnabled, onClipEnd, onPositionChange, videoRef]);

  useEffect(() => {
    const video = videoRef.current as
      | (HTMLVideoElement & {
          requestVideoFrameCallback?: (callback: () => void) => number;
          cancelVideoFrameCallback?: (handle: number) => void;
        })
      | null;
    if (!video || !isPlaying) {
      return;
    }

    let rafId: number | null = null;
    let cancelled = false;

    const cleanupScheduled = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (frameLoopTokenRef.current !== null && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(frameLoopTokenRef.current);
        frameLoopTokenRef.current = null;
      }
    };

    const schedule = () => {
      if (cancelled || video.paused) {
        return;
      }
      if (video.requestVideoFrameCallback) {
        frameLoopTokenRef.current = video.requestVideoFrameCallback(() => {
          frameLoopTokenRef.current = null;
          if (!publishPosition()) {
            return;
          }
          schedule();
        });
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (!publishPosition()) {
          return;
        }
        schedule();
      });
    };

    schedule();

    return () => {
      cancelled = true;
      cleanupScheduled();
    };
  }, [isPlaying, publishPosition, sourceUrl, videoRef]);

  return (
    <video
      ref={videoRef}
      className={className}
      src={sourceUrl}
      muted={muted}
      loop={loopEnabled}
      playsInline
      preload="metadata"
      style={{
        ...(objectPosition ? { objectPosition } : {}),
        transform: `scale(${(
          Math.min(STAGE3_MAX_VIDEO_ZOOM, Math.max(STAGE3_MIN_VIDEO_ZOOM, videoZoom ?? 1)) *
            (mirrorEnabled ? -1 : 1)
        ).toFixed(3)}, ${Math.min(STAGE3_MAX_VIDEO_ZOOM, Math.max(STAGE3_MIN_VIDEO_ZOOM, videoZoom ?? 1)).toFixed(3)})`,
        transformOrigin: "center center"
      }}
    />
  );
}

type Stage3InternalPass = Stage3Version["internalPasses"][number];

type Stage3LivePreviewPanelProps = {
  templateId: string;
  channelName: string;
  channelUsername: string;
  avatarUrl: string | null;
  previewVideoUrl: string | null;
  backgroundAssetUrl: string | null;
  backgroundAssetMimeType: string | null;
  previewVersion: Stage3Version | null;
  selectedVersion: Stage3Version | null;
  selectedVersionId: string | null;
  selectedPass: Stage3InternalPass | null;
  selectedPassIndex: number;
  displayVersions: Stage3Version[];
  summaryLines: string[];
  previewState: Stage3PreviewState;
  previewNotice: string | null;
  previewTemplateSnapshot: TemplateRenderSnapshot;
  previewTopText: string;
  previewBottomText: string;
  clipDurationSec: number;
  focusY: number;
  cameraMotion: Stage3CameraMotion;
  mirrorEnabled: boolean;
  videoZoom: number;
  topFontScale: number;
  bottomFontScale: number;
  templateConfig: ReturnType<typeof getTemplateById>;
  onMeasuredTextFitChange?: (fit: Stage3TextFitSnapshot) => void;
  onSelectVersionId: (runId: string) => void;
  onSelectPassIndex: (index: number) => void;
};

function Stage3LivePreviewPanel({
  templateId,
  channelName,
  channelUsername,
  avatarUrl,
  previewVideoUrl,
  backgroundAssetUrl,
  backgroundAssetMimeType,
  previewVersion,
  selectedVersion,
  selectedVersionId,
  selectedPass,
  selectedPassIndex,
  displayVersions,
  summaryLines,
  previewState,
  previewNotice,
  previewTemplateSnapshot,
  previewTopText,
  previewBottomText,
  clipDurationSec,
  focusY,
  cameraMotion,
  mirrorEnabled,
  videoZoom,
  topFontScale,
  bottomFontScale,
  templateConfig,
  onMeasuredTextFitChange,
  onSelectVersionId,
  onSelectPassIndex
}: Stage3LivePreviewPanelProps) {
  const slotPreviewRef = useRef<HTMLVideoElement | null>(null);
  const backgroundPreviewRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const isPlayingRef = useRef(true);
  const isTimelineScrubbingRef = useRef(false);

  const [isTimelineScrubbing, setIsTimelineScrubbing] = useState(false);
  const [timelineSec, setTimelineSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [zoomMode, setZoomMode] = useState<"fit" | 75 | 100>("fit");
  const [versionsDrawerOpen, setVersionsDrawerOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 720, height: 1280 });

  const previewViewport = useMemo(
    () => getTemplatePreviewViewportMetrics(templateId, "full-frame"),
    [templateId]
  );
  const previewViewportWidth = previewViewport.width;
  const previewViewportHeight = previewViewport.height;

  const fitScale = useMemo(() => {
    const width = canvasSize.width;
    const height = canvasSize.height;
    if (!width || !height) {
      return 0.01;
    }
    const usableWidth = Math.max(1, width - 20);
    const usableHeight = Math.max(1, height - 20);
    return clamp(Math.min(usableWidth / previewViewportWidth, usableHeight / previewViewportHeight), 0.01, 1);
  }, [canvasSize.height, canvasSize.width, previewViewportHeight, previewViewportWidth]);

  const previewScaleMultiplier = useMemo(() => {
    if (zoomMode === "fit") {
      return 1;
    }
    return zoomMode / 100;
  }, [zoomMode]);

  const layoutScale = fitScale * previewScaleMultiplier;
  const previewProgress = clipDurationSec > 0 ? clamp(timelineSec / clipDurationSec, 0, 1) : 0;
  const animatedFocusY = resolveAnimatedFocusY(focusY, cameraMotion, previewProgress);
  const objectPosition = `50% ${(animatedFocusY * 100).toFixed(3)}%`;
  const timelinePercent = clamp((timelineSec / Math.max(0.01, clipDurationSec)) * 100, 0, 100);
  const backgroundIsVideo =
    Boolean(backgroundAssetUrl) &&
    ((backgroundAssetMimeType ?? "").toLowerCase().startsWith("video/") ||
      /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(backgroundAssetUrl ?? ""));
  const overlayTint = useMemo(() => resolveTemplateOverlayTint(templateId), [templateId]);
  const summaryLine = summaryLines[0] ?? "Используется текущий live draft без сохраненной версии.";
  const sceneContent = useMemo<TemplateContentFixture>(
    () => previewTemplateSnapshot.content,
    [previewTemplateSnapshot]
  );
  const handleMeasuredTextFitChange = useCallback(
    (nextFit: Stage3TextFitSnapshot) => {
      onMeasuredTextFitChange?.(nextFit);
    },
    [onMeasuredTextFitChange]
  );

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isTimelineScrubbingRef.current = isTimelineScrubbing;
  }, [isTimelineScrubbing]);

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
      setCanvasSize((prev) => {
        if (Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1) {
          return prev;
        }
        return {
          width: rect.width,
          height: rect.height
        };
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
    if (!bg || bg.readyState < 1) {
      return;
    }
    const duration = Number.isFinite(bg.duration) && bg.duration > 0 ? bg.duration : null;
    const next = duration ? sec % duration : sec;
    if (Math.abs(bg.currentTime - next) > 0.08) {
      bg.currentTime = next;
    }
    if (isPlayingRef.current && bg.paused) {
      void bg.play().catch(() => undefined);
    }
  }, []);

  const handlePreviewPositionChange = useCallback(
    (sec: number) => {
      if (!isTimelineScrubbingRef.current) {
        setTimelineSec((prev) => (Math.abs(prev - sec) >= 1 / 240 ? sec : prev));
      }
      syncBackgroundTo(sec);
    },
    [syncBackgroundTo]
  );

  const handlePreviewClipEnd = useCallback(() => {
    setIsPlaying(false);
  }, []);

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

  const handleTogglePlay = useCallback(() => {
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
  }, []);

  const handleFrameStep = useCallback(
    (direction: -1 | 1) => {
      const frame = 1 / 30;
      setIsPlaying(false);
      const video = slotPreviewRef.current;
      if (video) {
        video.pause();
      }
      seekTimeline(timelineSec + frame * direction);
    },
    [seekTimeline, timelineSec]
  );

  const versionsDrawer = useMemo(() => {
    if (!versionsDrawerOpen) {
      return null;
    }

    return (
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
                  onClick={() => onSelectVersionId(version.runId)}
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
    );
  }, [
    displayVersions,
    onSelectPassIndex,
    onSelectVersionId,
    selectedPass,
    selectedPassIndex,
    selectedVersion,
    selectedVersionId,
    versionsDrawerOpen
  ]);

  return (
    <div className="preview-shell preview-shell-stage3">
      <header className="preview-header preview-header-wrap">
        <div>
          <h3>Живой предпросмотр</h3>
          <p className="subtle-text">
            {previewVersion ? `Версия v${previewVersion.versionNo}` : "Черновой живой предпросмотр"}
          </p>
          <p className="subtle-text preview-summary-inline">{summaryLine}</p>
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
          <button
            type="button"
            className={`btn btn-ghost ${loopEnabled ? "is-active" : ""}`}
            onClick={() => setLoopEnabled((prev) => !prev)}
          >
            Цикл
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => handleFrameStep(-1)}
            aria-label="Предыдущий кадр"
          >
            −1f
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => handleFrameStep(1)}
            aria-label="Следующий кадр"
          >
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

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setVersionsDrawerOpen((prev) => !prev)}
          >
            Версии ({displayVersions.length})
          </button>
        </div>
      </header>

      <div className="stage3-main">
        <div className="preview-stage stage3-preview-stage">
          <div ref={previewCanvasRef} className="stage3-canvas">
            <div
              className="stage3-zoom-wrap"
              style={{
                width: previewViewportWidth,
                height: previewViewportHeight,
                transform: `scale(${layoutScale})`
              }}
            >
              <Stage3TemplateViewport
                templateId={templateId}
                modeOverride="full-frame"
                className={previewViewport.mode === "full-frame" ? "phone-preview" : undefined}
              >
                <Stage3TemplateRenderer
                  templateId={templateId}
                  content={sceneContent}
                  snapshot={previewTemplateSnapshot}
                  onComputedChange={(nextComputed) => {
                    handleMeasuredTextFitChange(toTextFitSnapshot(nextComputed, previewTemplateSnapshot));
                  }}
                  runtime={{
                    showSafeArea: false,
                    backgroundNode: templateUsesBuiltInBackdropFromRegistry(templateId)
                      ? resolveTemplateBackdropNode(templateId)
                      : backgroundAssetUrl
                        ? backgroundIsVideo
                          ? (
                            <video
                              ref={backgroundPreviewRef}
                              className="preview-bg-video preview-bg-custom"
                              src={backgroundAssetUrl}
                              muted
                              loop
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
                          )
                          : (
                            <div
                              className="preview-bg-video preview-bg-custom-image"
                              style={{ backgroundImage: `url(${backgroundAssetUrl})` }}
                            />
                          )
                        : previewVideoUrl
                          ? (
                            <video
                              ref={backgroundPreviewRef}
                              className="preview-bg-video"
                              src={previewVideoUrl}
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              style={{
                                objectPosition,
                                transform: mirrorEnabled ? "scaleX(-1)" : undefined,
                                transformOrigin: "center center"
                              }}
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
                          )
                          : <div className="preview-bg-video preview-bg-fallback" />,
                    overlayNode: overlayTint ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: overlayTint,
                          pointerEvents: "none"
                        }}
                      />
                    ) : undefined,
                    mediaNode: previewVideoUrl ? (
                      <PreviewClipVideo
                        sourceUrl={previewVideoUrl}
                        clipDurationSec={clipDurationSec}
                        className="preview-slot-video"
                        objectPosition={objectPosition}
                        videoZoom={videoZoom}
                        mirrorEnabled={mirrorEnabled}
                        muted={isMuted}
                        videoRef={slotPreviewRef}
                        isPlaying={isPlaying}
                        loopEnabled={loopEnabled}
                        onPositionChange={handlePreviewPositionChange}
                        onClipEnd={handlePreviewClipEnd}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "grid",
                          placeItems: "center",
                          background: "#dfe5ef",
                          color: "rgba(17, 23, 33, 0.55)",
                          fontWeight: 700,
                          letterSpacing: "0.12em"
                        }}
                      >
                        ВИДЕО
                      </div>
                    ),
                    avatarNode: avatarUrl ? (
                      <div
                        className="preview-author-avatar"
                        style={{
                          width: previewTemplateSnapshot.layout.avatar.width,
                          height: previewTemplateSnapshot.layout.avatar.height,
                          borderWidth: templateConfig.author.avatarBorder,
                          borderColor: resolveTemplateAvatarBorderColor(templateId),
                          backgroundImage: `url(${avatarUrl})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center"
                        }}
                      />
                    ) : undefined
                  }}
                />
              </Stage3TemplateViewport>
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
            {previewNotice ? <p className="subtle-text">{sanitizeDisplayText(previewNotice)}</p> : null}
          </div>
        </div>
      </div>

      {versionsDrawer}
    </div>
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
  previewState,
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
  renderState,
  workerState,
  workerLabel,
  workerPlatform,
  workerLastSeenAt,
  workerPairing,
  isWorkerPairing,
  showWorkerControls,
  isOptimizing,
  isUploadingBackground,
  clipStartSec,
  clipDurationSec,
  sourceDurationSec,
  focusY,
  cameraMotion,
  mirrorEnabled,
  videoZoom,
  topFontScale,
  bottomFontScale,
  sourceAudioEnabled,
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
  onCameraMotionChange,
  onMirrorEnabledChange,
  onVideoZoomChange,
  onTopFontScaleChange,
  onBottomFontScaleChange,
  onSourceAudioEnabledChange,
  onMusicGainChange,
  onCreateWorkerPairing
}: Step3RenderTemplateProps) {
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
  const [workerSetupOpen, setWorkerSetupOpen] = useState(false);
  const [workerGuidePlatform, setWorkerGuidePlatform] = useState<WorkerGuidePlatform>(() => detectWorkerGuidePlatform());
  const [workerCopyState, setWorkerCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [workerInstallCopyState, setWorkerInstallCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [segmentDraftInputs, setSegmentDraftInputs] = useState<
    Record<string, { startSec: string; endSec: string }>
  >({});
  const [previewMeasuredFitState, setPreviewMeasuredFitState] = useState<{
    snapshotHash: string;
    fit: Stage3TextFitSnapshot;
    measured: boolean;
  } | null>(null);

  const templateConfig = getTemplateById(templateId);
  const previewTemplateSnapshot = useMemo(
    () =>
      buildTemplateRenderSnapshot({
        templateId,
        content: {
          topText,
          bottomText,
          channelName,
          channelHandle: `@${channelUsername}`,
          topFontScale: localTopFontScale,
          bottomFontScale: localBottomFontScale,
          previewScale: 1,
          mediaAsset: previewVideoUrl,
          backgroundAsset: backgroundAssetUrl,
          avatarAsset: avatarUrl
        }
      }),
    [
      avatarUrl,
      backgroundAssetUrl,
      bottomText,
      channelName,
      channelUsername,
      localBottomFontScale,
      localTopFontScale,
      previewVideoUrl,
      templateId,
      topText
    ]
  );
  const computed = previewTemplateSnapshot.computed;

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
  const previewTopText = previewTemplateSnapshot.content.topText;
  const previewBottomText = previewTemplateSnapshot.content.bottomText;
  const previewVideoZoom = clamp(localVideoZoom ?? 1, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM);
  const activePreviewTextFit = useMemo(() => {
    if (previewMeasuredFitState?.snapshotHash === previewTemplateSnapshot.snapshotHash) {
      return previewMeasuredFitState.fit;
    }
    return toTextFitSnapshot(previewTemplateSnapshot.computed, previewTemplateSnapshot);
  }, [previewMeasuredFitState, previewTemplateSnapshot]);
  const isPreviewTextFitReady =
    previewMeasuredFitState?.snapshotHash === previewTemplateSnapshot.snapshotHash &&
    previewMeasuredFitState.measured;

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
  const isPreviewBusy =
    previewState === "debouncing" || previewState === "loading" || previewState === "retrying";
  const isRendering = renderState === "queued" || renderState === "rendering";
  const remainingSegmentsDurationSec = Math.max(0, clipDurationSec - explicitSegmentsDurationSec);
  const focusPercent = Math.round(localFocusY * 100);
  const audioModeLabel = selectedMusicAssetId
    ? sourceAudioEnabled
      ? "Музыка + исходник"
      : "Только музыка"
    : sourceAudioEnabled
      ? "Только исходник"
      : "Без звука";
  const handlePreviewMeasuredTextFitChange = useCallback(
    (nextFit: Stage3TextFitSnapshot) => {
      setPreviewMeasuredFitState((current) => {
        const nextState = {
          snapshotHash: previewTemplateSnapshot.snapshotHash,
          fit: nextFit,
          measured: true
        };
        if (
          current?.snapshotHash === nextState.snapshotHash &&
          current.measured === nextState.measured &&
          areTextFitSnapshotsEqual(current.fit, nextState.fit)
        ) {
          return current;
        }
        return nextState;
      });
    },
    [previewTemplateSnapshot.snapshotHash]
  );

  useEffect(() => {
    setLocalClipStartSec(clamp(clipStartSec, 0, maxStartSec));
  }, [clipStartSec, maxStartSec]);

  useEffect(() => {
    setPreviewMeasuredFitState({
      snapshotHash: previewTemplateSnapshot.snapshotHash,
      fit: toTextFitSnapshot(previewTemplateSnapshot.computed, previewTemplateSnapshot),
      measured: false
    });
  }, [previewTemplateSnapshot.snapshotHash]);

  useEffect(() => {
    setLocalFocusY(clamp(focusY, 0.12, 0.88));
  }, [focusY]);

  useEffect(() => {
    setLocalVideoZoom(clamp(videoZoom, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM));
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
      let changed = false;
      normalizedSegments.forEach((segment, index) => {
        const key = `${index}:${segment.startSec}:${segment.endSec ?? "end"}:${segment.speed}`;
        const fallbackDraft = {
          startSec: segment.startSec.toFixed(1),
          endSec: (segment.endSec ?? sourceDurationSec ?? segment.startSec + 0.5).toFixed(1)
        };
        next[key] = prev[key] ?? fallbackDraft;
        if (
          !prev[key] ||
          prev[key].startSec !== next[key]?.startSec ||
          prev[key].endSec !== next[key]?.endSec
        ) {
          changed = true;
        }
      });
      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev;
      }
      return next;
    });
  }, [normalizedSegments, sourceDurationSec]);

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
    onVideoZoomChange(clamp(value, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM));
  };

  const scheduleVideoZoomCommit = (value: number) => {
    const next = clamp(value, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM);
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

  const summaryLines = previewVersion?.diff.summary ?? ["Используется текущий live draft без сохраненной версии."];
  const pairCommand =
    workerPairing
      ? workerGuidePlatform === "windows"
        ? workerPairing.commands.powershell
        : workerPairing.commands.shell
      : null;
  const workerInstallLinks = getWorkerInstallLinks(workerGuidePlatform);
  const workerInstallCommand =
    workerGuidePlatform === "windows"
      ? "winget install OpenJS.NodeJS.LTS Gyan.FFmpeg yt-dlp.yt-dlp"
      : "brew install ffmpeg yt-dlp";
  const workerGuideSteps =
    workerGuidePlatform === "windows"
      ? [
          "Нажмите «Скопировать команду».",
          "Откройте PowerShell. Быстрый способ: откройте «Пуск», напишите PowerShell и нажмите Enter.",
          "Вставьте команду в окно PowerShell и нажмите Enter.",
          "Дождитесь текста Starting Clips Stage 3 worker.",
          "Не закрывайте окно PowerShell, пока делаете предпросмотр или рендер."
        ]
      : [
          "Нажмите «Скопировать команду».",
          "Откройте Terminal. Быстрый способ: нажмите Command + Space, напишите Terminal и нажмите Enter.",
          "Вставьте команду в окно Terminal и нажмите Enter.",
          "Дождитесь текста Starting Clips Stage 3 worker.",
          "Не закрывайте окно Terminal, пока делаете предпросмотр или рендер."
        ];

  const commitAdvancedControls = (): Stage3EditorDraftOverrides => {
    const overrides: Stage3EditorDraftOverrides = {
      clipStartSec: clamp(localClipStartSec, 0, maxStartSec),
      focusY: clamp(localFocusY, 0.12, 0.88),
      videoZoom: clamp(localVideoZoom, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM),
      topFontScale: clamp(localTopFontScale, 0.7, 1.9),
      bottomFontScale: clamp(localBottomFontScale, 0.7, 1.9),
      musicGain: clamp(localMusicGain, 0, 1)
    };
    flushClipCommit(overrides.clipStartSec);
    flushFocusCommit(overrides.focusY);
    flushVideoZoomCommit(overrides.videoZoom);
    flushTopFontScaleCommit(overrides.topFontScale);
    flushBottomFontScaleCommit(overrides.bottomFontScale);
    flushMusicGainCommit(overrides.musicGain);
    return overrides;
  };

  useEffect(() => {
    setWorkerCopyState("idle");
  }, [pairCommand]);

  useEffect(() => {
    setWorkerInstallCopyState("idle");
  }, [workerGuidePlatform]);

  useEffect(() => {
    if (!workerSetupOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorkerSetupOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [workerSetupOpen]);

  const handleCopyWorkerCommand = async () => {
    if (!pairCommand) {
      return;
    }
    try {
      await navigator.clipboard.writeText(pairCommand);
      setWorkerCopyState("copied");
    } catch {
      setWorkerCopyState("error");
    }
  };

  const handleCopyWorkerInstallCommand = async () => {
    if (!workerInstallCommand) {
      return;
    }
    try {
      await navigator.clipboard.writeText(workerInstallCommand);
      setWorkerInstallCopyState("copied");
    } catch {
      setWorkerInstallCopyState("error");
    }
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
    const next = clamp(value, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM);
    setLocalVideoZoom(next);
    flushVideoZoomCommit(next);
  };

  const workerStatusLabel =
    workerState === "not_paired"
      ? "Не подключен"
      : workerState === "online"
        ? "Online"
        : workerState === "busy"
          ? "Busy"
          : "Offline";

  const workerStatusDescription =
    workerState === "not_paired"
      ? "Локальный помощник еще не подключен."
      : workerLabel
        ? `${workerLabel}${workerPlatform ? ` · ${workerPlatform}` : ""}${
            workerLastSeenAt ? ` · последний heartbeat ${formatDateShort(workerLastSeenAt)}` : ""
          }`
        : "Локальный executor зарегистрирован.";

  const workerSetupModal = showWorkerControls && workerSetupOpen ? (
    <div
      className="worker-setup-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Подключение локального executor"
      onClick={() => setWorkerSetupOpen(false)}
    >
      <div className="worker-setup-modal" onClick={(event) => event.stopPropagation()}>
        <header className="worker-setup-head">
          <div>
            <p className="kicker">Local Executor</p>
            <h3>Подключение локального помощника</h3>
            <p className="subtle-text">
              Это делается один раз. После подключения предпросмотр и рендер будут выполняться на компьютере пользователя.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setWorkerSetupOpen(false)}>
            Закрыть
          </button>
        </header>

        <section className="control-card executor-guide-card">
          <div className="control-section-head">
            <div>
              <h3>Статус</h3>
              <p className="subtle-text">{workerStatusDescription}</p>
            </div>
            <span className={`meta-pill ${workerState === "online" ? "ok" : workerState === "busy" ? "warn" : ""}`}>
              {workerStatusLabel}
            </span>
          </div>
        </section>

        <section className="control-card executor-guide-card">
          <div className="control-section-head">
            <div>
              <h3>Шаг 1. Выберите свой компьютер</h3>
              <p className="subtle-text">Выберите систему, на которой будет работать предпросмотр и рендер.</p>
            </div>
            <div className="executor-guide-platforms" role="tablist" aria-label="Операционная система">
              <button
                type="button"
                className={`btn ${workerGuidePlatform === "darwin" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setWorkerGuidePlatform("darwin")}
              >
                Mac
              </button>
              <button
                type="button"
                className={`btn ${workerGuidePlatform === "windows" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setWorkerGuidePlatform("windows")}
              >
                Windows
              </button>
            </div>
          </div>
        </section>

        <section className="control-card executor-guide-card">
          <div className="control-section-head">
            <div>
              <h3>Шаг 2. Подготовьте команду</h3>
              <p className="subtle-text">Нажмите кнопку ниже. Мы подготовим для вас готовую команду запуска.</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void onCreateWorkerPairing();
              }}
              disabled={isWorkerPairing}
              aria-busy={isWorkerPairing}
            >
              {isWorkerPairing ? "Готовлю команду..." : pairCommand ? "Обновить команду" : "Подготовить команду"}
            </button>
          </div>
          {pairCommand ? (
            <>
              <ol className="executor-guide-list">
                {workerGuideSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="executor-guide-actions">
                <button type="button" className="btn btn-primary" onClick={() => void handleCopyWorkerCommand()}>
                  Скопировать команду
                </button>
                <span className="subtle-text">
                  {workerCopyState === "copied"
                    ? "Команда скопирована."
                    : workerCopyState === "error"
                      ? "Не удалось скопировать. Скопируйте текст вручную."
                      : workerGuidePlatform === "windows"
                        ? "После копирования откройте PowerShell."
                        : "После копирования откройте Terminal."}
                </span>
              </div>
              <code className="executor-guide-command">{pairCommand}</code>
              <div className="executor-guide-note">
                <strong>Ожидаемый результат:</strong> через несколько секунд статус в браузере должен стать <strong>Online</strong>.
              </div>
            </>
          ) : (
            <div className="executor-guide-note">
              Нажмите <strong>Подготовить команду</strong>, затем скопируйте и запустите ее на своем компьютере.
            </div>
          )}
        </section>

        <section className="control-card executor-guide-card">
          <div className="control-section-head">
            <div>
              <h3>Если компьютер пишет, что чего-то не хватает</h3>
              <p className="subtle-text">Откройте нужные страницы по кнопкам ниже. Они ведут на официальные страницы загрузки или установки.</p>
            </div>
          </div>
          <div className="executor-link-grid">
            {workerInstallLinks.map((link) => (
              <a
                key={link.href}
                className="executor-link-card"
                href={link.href}
                target="_blank"
                rel="noreferrer"
              >
                <strong>{link.label}</strong>
                <span>{link.description}</span>
              </a>
            ))}
          </div>
          <div className="executor-guide-note">
            <strong>Быстрый способ:</strong> если у вас уже есть {workerGuidePlatform === "windows" ? "PowerShell" : "Terminal"}, можно сначала попробовать эту команду установки.
          </div>
          <div className="executor-guide-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void handleCopyWorkerInstallCommand()}>
              Скопировать команду установки
            </button>
            <span className="subtle-text">
              {workerInstallCopyState === "copied"
                ? "Команда установки скопирована."
                : workerInstallCopyState === "error"
                  ? "Не удалось скопировать. Скопируйте текст вручную."
                  : workerGuidePlatform === "windows"
                    ? "Она установит Node.js LTS, FFmpeg и yt-dlp через winget."
                    : "Она установит ffmpeg и yt-dlp через Homebrew."}
            </span>
          </div>
          <code className="executor-guide-command">{workerInstallCommand}</code>
        </section>
      </div>
    </div>
  ) : null;

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
        label: `Фрагмент ${normalizedSegments.length + 1}`,
        speed: 1
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

  const updateFragmentSpeed = useCallback(
    (index: number, speed: Stage3Segment["speed"]) => {
      commitFragments(
        normalizedSegments.map((segment, itemIndex) =>
          itemIndex === index
            ? {
                ...segment,
                speed
              }
            : segment
        )
      );
    },
    [commitFragments, normalizedSegments]
  );

  const setFragmentDraftField = (
    index: number,
    segment: Stage3Segment,
    field: "startSec" | "endSec",
    value: string
  ) => {
    const key = `${index}:${segment.startSec}:${segment.endSec ?? "end"}:${segment.speed}`;
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
    const key = `${index}:${segment.startSec}:${segment.endSec ?? "end"}:${segment.speed}`;
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
      : Math.max(0.1, (clipDurationSec - otherDuration) * segment.speed);
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
          const overrides = commitAdvancedControls();
          window.setTimeout(() => {
            onOptimize(overrides, activePreviewTextFit);
          }, 0);
        }}
        disabled={!sourceUrl || isOptimizing || isRendering || !isPreviewTextFitReady}
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
          const overrides = commitAdvancedControls();
          window.setTimeout(() => {
            onRender(overrides, activePreviewTextFit);
          }, 0);
        }}
        disabled={!sourceUrl || isRendering || !isPreviewTextFitReady}
        aria-busy={isRendering}
      >
        {renderState === "queued" ? "В очереди..." : isRendering ? "Рендер..." : "Рендер"}
      </button>
    </div>
  );

  return (
    <>
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
              <span className="meta-pill">{getStage3DesignLabLabel(templateId)}</span>
              <span className="meta-pill mono">{templateId}</span>
              <span className="meta-pill">
                {channelName} (@{channelUsername})
              </span>
              <span className="meta-pill">
                Исходник {sourceDurationSec ? formatTimeSec(sourceDurationSec) : "н/д"}
              </span>
              <span className="meta-pill">Версий {displayVersions.length}</span>
            </div>
            {showWorkerControls ? (
              <div className="executor-summary-row">
                <div className="executor-summary-copy">
                  <span className={`meta-pill ${workerState === "online" ? "ok" : workerState === "busy" ? "warn" : ""}`}>
                    Executor: {workerStatusLabel}
                  </span>
                  <span className="subtle-text">
                    {workerState === "not_paired"
                      ? "Подключается один раз, затем работает в фоне через отдельное окно Terminal или PowerShell."
                      : workerStatusDescription}
                  </span>
                </div>
                <button
                  type="button"
                  className={`btn ${workerState === "not_paired" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setWorkerSetupOpen(true)}
                >
                  {workerState === "not_paired" ? "Подключить executor" : "Executor"}
                </button>
              </div>
            ) : null}
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
                <span className="meta-pill">Камера {formatCameraMotion(cameraMotion)}</span>
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
                      const rowKey = `${index}:${segment.startSec}:${segment.endSec ?? "end"}:${segment.speed}`;
                      const draft = segmentDraftInputs[rowKey] ?? {
                        startSec: segment.startSec.toFixed(1),
                        endSec: (segment.endSec ?? sourceDurationSec ?? segment.startSec + 0.5).toFixed(1)
                      };
                      const endValue = segment.endSec ?? sourceDurationSec ?? segment.startSec + 0.5;
                      const rawDuration = Math.max(0, endValue - segment.startSec);
                      const outputDuration = rawDuration / segment.speed;
                      return (
                        <article key={rowKey} className="fragment-row">
                          <div className="fragment-row-head">
                            <div className="fragment-row-meta">
                              <span className="meta-pill mono">{index + 1}</span>
                              <span className="meta-pill">{formatSegmentSpeed(segment.speed)}</span>
                              <span className="quick-edit-value">{formatTimeSec(outputDuration)}</span>
                              {segment.speed > 1 ? (
                                <span className="subtle-text">
                                  {formatTimeSec(rawDuration)} → {formatTimeSec(outputDuration)}
                                </span>
                              ) : null}
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
                            <label className="field-stack">
                              <span className="field-label">Сжатие</span>
                              <select
                                className="text-input segment-input"
                                value={segment.speed}
                                onChange={(event) =>
                                  updateFragmentSpeed(
                                    index,
                                    normalizeSegmentSpeed(Number.parseFloat(event.target.value))
                                  )
                                }
                              >
                                {STAGE3_SEGMENT_SPEED_OPTIONS.map((speed) => (
                                  <option key={`segment-speed-${speed}`} value={speed}>
                                    {formatSegmentSpeed(speed)}
                                  </option>
                                ))}
                              </select>
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

              <div className="quick-edit-card">
                <div className="quick-edit-label-row">
                  <span className="field-label">Отзеркаливание</span>
                  <span className="quick-edit-value">{mirrorEnabled ? "Включено" : "Выключено"}</span>
                </div>
                <label className="field-label fragment-toggle">
                  <input
                    type="checkbox"
                    checked={mirrorEnabled}
                    onChange={(event) => onMirrorEnabledChange(event.target.checked)}
                  />
                  <span>Горизонтально</span>
                </label>
                <p className="subtle-text">По умолчанию включено для слота с исходным видео.</p>
              </div>

              <div className="quick-edit-card">
                <div className="quick-edit-label-row">
                  <label className="field-label" htmlFor="cameraMotionSelect">
                    Движение камеры
                  </label>
                  <span className="quick-edit-value">{formatCameraMotion(cameraMotion)}</span>
                </div>
                <select
                  id="cameraMotionSelect"
                  className="text-input"
                  value={cameraMotion}
                  onChange={(event) => onCameraMotionChange(event.target.value as Stage3CameraMotion)}
                >
                  <option value="disabled">Отключено</option>
                  <option value="top_to_bottom">Сверху вниз</option>
                  <option value="bottom_to_top">Снизу вверх</option>
                </select>
                <p className="subtle-text">Движение использует текущий вертикальный фокус как центр траектории.</p>
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
                  max={STAGE3_MAX_VIDEO_ZOOM}
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
                  <span className="quick-edit-value">{audioModeLabel}</span>
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
                <label className="field-label fragment-toggle">
                  <input
                    type="checkbox"
                    checked={sourceAudioEnabled}
                    onChange={(event) => onSourceAudioEnabledChange(event.target.checked)}
                  />
                  <span>Оставить звук исходника</span>
                </label>
                <p className="subtle-text">
                  Если отключить, из preview и финального render убирается звук исходника. Без музыки клип будет беззвучным.
                </p>
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
                    onClick={() => {
                      const overrides = commitAdvancedControls();
                      window.setTimeout(() => {
                        onOptimize(overrides, activePreviewTextFit);
                      }, 0);
                    }}
                    disabled={!sourceUrl || isOptimizing || isRendering || !isPreviewTextFitReady}
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
          <Stage3LivePreviewPanel
            templateId={templateId}
            channelName={channelName}
            channelUsername={channelUsername}
            avatarUrl={avatarUrl}
            previewVideoUrl={previewVideoUrl}
            backgroundAssetUrl={backgroundAssetUrl}
            backgroundAssetMimeType={backgroundAssetMimeType}
            previewVersion={previewVersion}
            selectedVersion={selectedVersion}
            selectedVersionId={selectedVersionId}
            selectedPass={selectedPass}
            selectedPassIndex={selectedPassIndex}
            displayVersions={displayVersions}
            summaryLines={summaryLines}
            previewState={previewState}
            previewNotice={previewNotice ?? (isPreviewBusy ? "Обновляю предпросмотр..." : null)}
            previewTemplateSnapshot={previewTemplateSnapshot}
            onMeasuredTextFitChange={handlePreviewMeasuredTextFitChange}
            previewTopText={previewTopText}
            previewBottomText={previewBottomText}
            clipDurationSec={clipDurationSec}
            focusY={localFocusY}
            cameraMotion={cameraMotion}
            mirrorEnabled={mirrorEnabled}
            videoZoom={previewVideoZoom}
            topFontScale={localTopFontScale}
            bottomFontScale={localBottomFontScale}
            templateConfig={templateConfig}
            onSelectVersionId={onSelectVersionId}
            onSelectPassIndex={onSelectPassIndex}
          />
        }
      />
      {workerSetupModal}
    </>
  );
}
