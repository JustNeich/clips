"use client";

import React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import {
  ChannelPublication,
  ChannelAsset,
  Stage3AgentConversationItem,
  Stage3CameraMotion,
  Stage3EditorDraftOverrides,
  Stage3PositionKeyframe,
  Stage3PreviewState,
  Stage3RenderPolicy,
  Stage3RenderState,
  Stage3ScaleKeyframe,
  Stage3Segment,
  STAGE3_SEGMENT_SPEED_OPTIONS,
  Stage3SessionRecord,
  Stage3TextFitSnapshot,
  Stage3TimingMode,
  TemplateContentFixture,
  Stage3Version,
  Stage2Response,
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
  resolveTemplateOverlayTint
} from "../../lib/stage3-template-registry";
import { resolveStage3BackgroundMode } from "../../lib/stage3-background-mode";
import { resolveTemplateBackdropNode } from "../../lib/stage3-template-runtime";
import {
  STAGE3_TEXT_SCALE_UI_MAX,
  STAGE3_TEXT_SCALE_UI_MIN,
  STAGE3_TEXT_SCALE_UI_PRESETS,
  buildStage3TextFitHash,
  clampStage3TextScaleUi,
  createStage3TextFitSnapshot
} from "../../lib/stage3-text-fit";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "../../lib/stage3-constants";
import {
  buildLegacyPositionKeyframes,
  clampStage3CameraZoom,
  clampStage3FocusY,
  normalizeStage3PositionKeyframes,
  normalizeStage3ScaleKeyframes,
  resolveCameraStateAtTime,
  resolveStage3EffectiveCameraTracks
} from "../../lib/stage3-camera";
import { getStage3DesignLabLabel } from "../../lib/stage3-design-lab";
import { sanitizeDisplayText } from "../../lib/ui-error";
import {
  applyStage3PlaybackPositionToVideo,
  buildStage3PlaybackPlan,
  mapStage3SourceTimeToOutputTime,
  resolveStage3PlaybackPosition
} from "../../lib/stage3-preview-playback";
import type {
  Stage2ToStage3HandoffSummary,
  Stage3CaptionApplyMode
} from "../../lib/stage2-stage3-handoff";

type Step3RenderTemplateProps = {
  sourceUrl: string | null;
  templateId: string;
  channelName: string;
  channelUsername: string;
  avatarUrl: string | null;
  previewVideoUrl: string | null;
  accuratePreviewVideoUrl?: string | null;
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
  accuratePreviewState?: Stage3PreviewState;
  accuratePreviewNotice?: string | null;
  agentPrompt: string;
  agentSession: Stage3SessionRecord | null;
  agentMessages: Stage3AgentConversationItem[];
  agentCurrentScore: number | null;
  isAgentTimelineLoading: boolean;
  canResumeAgent: boolean;
  canRollbackSelectedVersion: boolean;
  topText: string;
  bottomText: string;
  captionSources: Stage2Response["output"]["captionOptions"];
  selectedCaptionOption: number | null;
  handoffSummary: Stage2ToStage3HandoffSummary | null;
  segments: Stage3Segment[];
  compressionEnabled: boolean;
  timingMode?: Stage3TimingMode;
  renderPolicy?: Stage3RenderPolicy;
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
  cameraKeyframes: Array<{ id: string; timeSec: number; focusY: number; zoom: number }>;
  cameraPositionKeyframes: Stage3PositionKeyframe[];
  cameraScaleKeyframes: Stage3ScaleKeyframe[];
  mirrorEnabled: boolean;
  videoZoom: number;
  topFontScale: number;
  bottomFontScale: number;
  sourceAudioEnabled: boolean;
  musicGain: number;
  publication?: ChannelPublication | null;
  onRender: (overrides?: Stage3EditorDraftOverrides, textFitOverride?: Stage3TextFitSnapshot | null) => void;
  onExport: () => void;
  onOptimize: (overrides?: Stage3EditorDraftOverrides, textFitOverride?: Stage3TextFitSnapshot | null) => void;
  onResumeAgent: () => void;
  onRollbackSelectedVersion: () => void;
  onReset: () => void;
  onTopTextChange: (value: string) => void;
  onBottomTextChange: (value: string) => void;
  onApplyCaptionSource: (option: number, mode: Stage3CaptionApplyMode) => void;
  onResetCaptionText: (mode: Stage3CaptionApplyMode) => void;
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
  onCameraPositionKeyframesChange: (value: Stage3PositionKeyframe[]) => void;
  onCameraScaleKeyframesChange: (value: Stage3ScaleKeyframe[]) => void;
  onMirrorEnabledChange: (value: boolean) => void;
  onVideoZoomChange: (value: number) => void;
  onTopFontScaleChange: (value: number) => void;
  onBottomFontScaleChange: (value: number) => void;
  onSourceAudioEnabledChange: (value: boolean) => void;
  onMusicGainChange: (value: number) => void;
  onCreateWorkerPairing: () => void;
  onOpenPlanner?: () => void;
};

const SEGMENT_SPEED_SET = new Set<number>(STAGE3_SEGMENT_SPEED_OPTIONS);
type WorkerGuidePlatform = "darwin" | "windows";
type WorkerInstallLink = {
  label: string;
  href: string;
  description: string;
};

type PendingTextFitAction = {
  kind: "render" | "optimize";
  overrides: Stage3EditorDraftOverrides;
  snapshotHash: string;
  fitHash: string;
};

type Stage3SurfaceMode = "finish" | "editor";
type Stage3PreviewMediaMode = "mapped" | "linear";

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
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatPublicationStatus(status: ChannelPublication["status"]): string {
  switch (status) {
    case "queued":
      return "В очереди";
    case "uploading":
      return "Загружается";
    case "scheduled":
      return "Запланировано";
    case "published":
      return "Опубликовано";
    case "failed":
      return "Ошибка";
    case "paused":
      return "На паузе";
    case "canceled":
      return "Удалено";
    default:
      return status;
  }
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

function formatCaptionSourceLabel(value: Stage2ToStage3HandoffSummary["topTextSource"]): string {
  switch (value) {
    case "selected_caption":
      return "из выбранного option";
    case "latest_version":
      return "из последней версии";
    case "draft_override":
      return "ручная правка";
    default:
      return "пусто";
  }
}

function truncateCaptionPreview(value: string, maxLength = 110): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function getTextFitHashForSnapshot(templateSnapshot: TemplateRenderSnapshot): string {
  return buildStage3TextFitHash({
    templateId: templateSnapshot.templateId,
    snapshotHash: templateSnapshot.snapshotHash,
    topText: templateSnapshot.content.topText,
    bottomText: templateSnapshot.content.bottomText,
    topFontScale: templateSnapshot.content.topFontScale,
    bottomFontScale: templateSnapshot.content.bottomFontScale
  });
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
  return createStage3TextFitSnapshot(
    {
      templateId: templateSnapshot.templateId,
      snapshotHash: templateSnapshot.snapshotHash,
      topText: templateSnapshot.content.topText,
      bottomText: templateSnapshot.content.bottomText,
      topFontScale: templateSnapshot.content.topFontScale,
      bottomFontScale: templateSnapshot.content.bottomFontScale
    },
    {
      topFontPx: computed.topFont,
      bottomFontPx: computed.bottomFont,
      topLineHeight: computed.topLineHeight,
      bottomLineHeight: computed.bottomLineHeight,
      topLines: computed.topLines,
      bottomLines: computed.bottomLines,
      topCompacted: templateSnapshot.fit.topCompacted,
      bottomCompacted: templateSnapshot.fit.bottomCompacted
    }
  );
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
    left.bottomCompacted === right.bottomCompacted &&
    left.snapshotHash === right.snapshotHash &&
    left.fitHash === right.fitHash
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

function formatTrackCountLabel(count: number): string {
  if (count > 0) {
    return `${count} точ${count === 1 ? "ка" : count < 5 ? "ки" : "ек"}`;
  }
  return "База";
}

function formatCameraTrackLabel(
  positionKeyframes: Stage3PositionKeyframe[],
  scaleKeyframes: Stage3ScaleKeyframe[],
  cameraMotion: Stage3CameraMotion
): string {
  const total = positionKeyframes.length + scaleKeyframes.length;
  if (total > 0) {
    return `${total} keyframes`;
  }
  switch (cameraMotion) {
    case "top_to_bottom":
      return "Legacy: сверху вниз";
    case "bottom_to_top":
      return "Legacy: снизу вверх";
    default:
      return "База";
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
  playbackDurationSec,
  playbackPlan,
  mediaMode,
  className,
  objectPosition,
  videoZoom,
  mirrorEnabled,
  muted,
  videoRef,
  isPlaying,
  loopEnabled,
  onPositionChange,
  onSourceDurationChange,
  onClipEnd
}: {
  sourceUrl: string;
  playbackDurationSec: number;
  playbackPlan: ReturnType<typeof buildStage3PlaybackPlan>;
  mediaMode: Stage3PreviewMediaMode;
  className: string;
  objectPosition?: string;
  videoZoom?: number;
  mirrorEnabled: boolean;
  muted: boolean;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  loopEnabled: boolean;
  onPositionChange?: (outputSec: number, sourceSec: number) => void;
  onSourceDurationChange?: (sec: number | null) => void;
  onClipEnd?: () => void;
}) {
  const frameLoopTokenRef = useRef<number | null>(null);
  const activeSegmentIndexRef = useRef(0);
  const lastPublishedOutputRef = useRef(0);

  const seekToOutputTime = useCallback(
    (outputSec: number, toleranceSec = 0.04) => {
      const video = videoRef.current;
      if (!video) {
        return null;
      }
      if (mediaMode === "linear") {
        const nextSec = clamp(outputSec, 0, playbackDurationSec);
        lastPublishedOutputRef.current = nextSec;
        video.currentTime = nextSec;
        onPositionChange?.(nextSec, nextSec);
        return {
          outputTimeSec: nextSec,
          sourceTimeSec: nextSec
        };
      }
      const position = resolveStage3PlaybackPosition(playbackPlan, outputSec);
      if (!position) {
        return null;
      }
      activeSegmentIndexRef.current = position.segmentIndex;
      lastPublishedOutputRef.current = position.outputTimeSec;
      applyStage3PlaybackPositionToVideo(video, position, toleranceSec);
      onPositionChange?.(position.outputTimeSec, position.sourceTimeSec);
      return position;
    },
    [mediaMode, onPositionChange, playbackDurationSec, playbackPlan, videoRef]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const seekToStart = () => {
      const mediaDurationSec =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      onSourceDurationChange?.(mediaDurationSec);
      const initialPosition = seekToOutputTime(0, 0);
      if (isPlaying) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
      if (!initialPosition) {
        video.currentTime = 0;
        onPositionChange?.(0, 0);
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
  }, [
    isPlaying,
    mediaMode,
    onPositionChange,
    onSourceDurationChange,
    playbackPlan,
    seekToOutputTime,
    sourceUrl,
    videoRef
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (isPlaying) {
      if (video.ended || lastPublishedOutputRef.current >= Math.max(0, playbackDurationSec - 0.02)) {
        seekToOutputTime(0, 0);
      }
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [isPlaying, mediaMode, playbackDurationSec, seekToOutputTime, sourceUrl, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleEnded = () => {
      if (loopEnabled && isPlaying) {
        seekToOutputTime(0, 0);
        void video.play().catch(() => undefined);
        return;
      }
      onClipEnd?.();
    };

    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("ended", handleEnded);
    };
  }, [isPlaying, loopEnabled, onClipEnd, seekToOutputTime, videoRef]);

  const publishPosition = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return false;
    }
    if (mediaMode === "linear") {
      const outputSec = clamp(video.currentTime, 0, playbackDurationSec);
      lastPublishedOutputRef.current = outputSec;
      onPositionChange?.(outputSec, outputSec);
      if (!loopEnabled && outputSec >= playbackDurationSec - 0.02) {
        video.pause();
        onClipEnd?.();
        return false;
      }
      return true;
    }
    const segment = playbackPlan.segments[activeSegmentIndexRef.current] ?? playbackPlan.segments[0];
    if (!segment) {
      return false;
    }
    const currentTime = video.currentTime;
    const transitionThresholdSec = 0.02;

    if (currentTime >= segment.sourceEndSec - transitionThresholdSec) {
      const nextSegment = playbackPlan.segments[activeSegmentIndexRef.current + 1];
      if (nextSegment) {
        const nextPosition = resolveStage3PlaybackPosition(playbackPlan, nextSegment.outputStartSec);
        if (nextPosition) {
          activeSegmentIndexRef.current = nextPosition.segmentIndex;
          lastPublishedOutputRef.current = nextPosition.outputTimeSec;
          applyStage3PlaybackPositionToVideo(video, nextPosition, 0);
          onPositionChange?.(nextPosition.outputTimeSec, nextPosition.sourceTimeSec);
          return true;
        }
      }

      if (loopEnabled && isPlaying) {
        const restartPosition = seekToOutputTime(0, 0);
        if (restartPosition) {
          void video.play().catch(() => undefined);
          return true;
        }
      }

      video.pause();
      lastPublishedOutputRef.current = playbackDurationSec;
      onPositionChange?.(playbackDurationSec, segment.sourceEndSec);
      onClipEnd?.();
      return false;
    }

    const outputSec = mapStage3SourceTimeToOutputTime(segment, currentTime);
    lastPublishedOutputRef.current = outputSec;
    onPositionChange?.(outputSec, currentTime);

    if (!loopEnabled && outputSec >= playbackDurationSec - 0.02) {
      video.pause();
      onClipEnd?.();
      return false;
    }
    return true;
  }, [
    isPlaying,
    loopEnabled,
    mediaMode,
    onClipEnd,
    onPositionChange,
    playbackDurationSec,
    playbackPlan,
    seekToOutputTime,
    videoRef
  ]);

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
  editorMode: boolean;
  templateId: string;
  channelName: string;
  channelUsername: string;
  avatarUrl: string | null;
  previewVideoUrl: string | null;
  accuratePreviewVideoUrl?: string | null;
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
  accuratePreviewState?: Stage3PreviewState;
  accuratePreviewNotice?: string | null;
  previewTemplateSnapshot: TemplateRenderSnapshot;
  clipStartSec: number;
  clipDurationSec: number;
  sourceDurationSec: number | null;
  segments: Stage3Segment[];
  timingMode: Stage3TimingMode;
  renderPolicy: Stage3RenderPolicy;
  focusY: number;
  cameraMotion: Stage3CameraMotion;
  cameraKeyframes: Array<{ id: string; timeSec: number; focusY: number; zoom: number }>;
  cameraPositionKeyframes: Stage3PositionKeyframe[];
  cameraScaleKeyframes: Stage3ScaleKeyframe[];
  mirrorEnabled: boolean;
  videoZoom: number;
  topFontScale: number;
  bottomFontScale: number;
  sourceAudioEnabled: boolean;
  templateConfig: ReturnType<typeof getTemplateById>;
  selectedPositionKeyframeId: string | null;
  selectedScaleKeyframeId: string | null;
  requestedTimelineSec: number | null;
  onRequestedTimelineHandled?: () => void;
  onMeasuredTextFitChange?: (fit: Stage3TextFitSnapshot) => void;
  onTimelineSecChange?: (value: number) => void;
  onSelectPositionKeyframeId: (id: string | null) => void;
  onSelectScaleKeyframeId: (id: string | null) => void;
  onPositionKeyframeTimeChange: (id: string, timeSec: number) => void;
  onScaleKeyframeTimeChange: (id: string, timeSec: number) => void;
  onCameraPreviewFocusChange: (focusY: number) => void;
  onSelectVersionId: (runId: string) => void;
  onSelectPassIndex: (index: number) => void;
};

function Stage3LivePreviewPanel({
  editorMode,
  templateId,
  channelName,
  channelUsername,
  avatarUrl,
  previewVideoUrl,
  accuratePreviewVideoUrl = null,
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
  accuratePreviewState = "idle",
  accuratePreviewNotice = null,
  previewTemplateSnapshot,
  clipStartSec,
  clipDurationSec,
  sourceDurationSec,
  segments,
  timingMode,
  renderPolicy,
  focusY,
  cameraMotion,
  cameraKeyframes,
  cameraPositionKeyframes,
  cameraScaleKeyframes,
  mirrorEnabled,
  videoZoom,
  topFontScale,
  bottomFontScale,
  sourceAudioEnabled,
  templateConfig,
  selectedPositionKeyframeId,
  selectedScaleKeyframeId,
  requestedTimelineSec,
  onRequestedTimelineHandled,
  onMeasuredTextFitChange,
  onTimelineSecChange,
  onSelectPositionKeyframeId,
  onSelectScaleKeyframeId,
  onPositionKeyframeTimeChange,
  onScaleKeyframeTimeChange,
  onCameraPreviewFocusChange,
  onSelectVersionId,
  onSelectPassIndex
}: Stage3LivePreviewPanelProps) {
  const slotPreviewRef = useRef<HTMLVideoElement | null>(null);
  const backgroundPreviewRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const previewSurfaceRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const positionTrackRef = useRef<HTMLDivElement | null>(null);
  const scaleTrackRef = useRef<HTMLDivElement | null>(null);
  const isPlayingRef = useRef(true);
  const isTimelineScrubbingRef = useRef(false);
  const previewAdjustPointerIdRef = useRef<number | null>(null);
  const draggingTransformKeyframeIdRef = useRef<string | null>(null);
  const draggingTransformTrackRef = useRef<"position" | "scale" | null>(null);

  const [isTimelineScrubbing, setIsTimelineScrubbing] = useState(false);
  const [timelineSec, setTimelineSec] = useState(0);
  const [isPreviewAdjustingCamera, setIsPreviewAdjustingCamera] = useState(false);
  const [isDraggingCameraKeyframe, setIsDraggingCameraKeyframe] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [zoomMode, setZoomMode] = useState<"fit" | 75 | 100>("fit");
  const [versionsDrawerOpen, setVersionsDrawerOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 720, height: 1280 });
  const [proxySourceDurationSec, setProxySourceDurationSec] = useState<number | null>(sourceDurationSec);

  useEffect(() => {
    setProxySourceDurationSec(sourceDurationSec);
  }, [sourceDurationSec]);

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

  const resolvedSourceDurationSec = sourceDurationSec ?? proxySourceDurationSec;
  const playbackPlan = useMemo(
    () =>
      buildStage3PlaybackPlan({
        segments,
        sourceDurationSec: resolvedSourceDurationSec,
        clipStartSec,
        clipDurationSec,
        targetDurationSec: clipDurationSec,
        timingMode,
        policy: renderPolicy
      }),
    [clipDurationSec, clipStartSec, renderPolicy, resolvedSourceDurationSec, segments, timingMode]
  );
  const playbackDurationSec =
    playbackPlan.totalOutputDurationSec > 0 ? playbackPlan.totalOutputDurationSec : clipDurationSec;
  const layoutScale = fitScale * previewScaleMultiplier;
  const cameraState = useMemo(
    () =>
      resolveCameraStateAtTime({
        timeSec: timelineSec,
        cameraPositionKeyframes,
        cameraScaleKeyframes,
        cameraKeyframes,
        cameraMotion,
        clipDurationSec: playbackDurationSec,
        baseFocusY: focusY,
        baseZoom: videoZoom
      }),
    [
      cameraKeyframes,
      cameraMotion,
      cameraPositionKeyframes,
      cameraScaleKeyframes,
      focusY,
      playbackDurationSec,
      timelineSec,
      videoZoom
    ]
  );
  const objectPosition = `50% ${(cameraState.focusY * 100).toFixed(3)}%`;
  const timelinePercent = clamp((timelineSec / Math.max(0.01, playbackDurationSec)) * 100, 0, 100);
  const activePositionKeyframes = cameraState.positionKeyframes;
  const activeScaleKeyframes = cameraState.scaleKeyframes;
  const selectedPositionKeyframe = selectedPositionKeyframeId
    ? activePositionKeyframes.find((keyframe) => keyframe.id === selectedPositionKeyframeId) ?? null
    : null;
  const selectedScaleKeyframe = selectedScaleKeyframeId
    ? activeScaleKeyframes.find((keyframe) => keyframe.id === selectedScaleKeyframeId) ?? null
    : null;
  const backgroundIsVideo =
    Boolean(backgroundAssetUrl) &&
    ((backgroundAssetMimeType ?? "").toLowerCase().startsWith("video/") ||
      /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(backgroundAssetUrl ?? ""));
  const backgroundMode = useMemo(
    () =>
      resolveStage3BackgroundMode(templateId, {
        hasCustomBackground: Boolean(backgroundAssetUrl),
        hasSourceVideo: Boolean(previewVideoUrl || accuratePreviewVideoUrl)
      }),
    [accuratePreviewVideoUrl, backgroundAssetUrl, previewVideoUrl, templateId]
  );
  const accuratePreviewReady = Boolean(accuratePreviewVideoUrl);
  const activePreviewMediaMode: Stage3PreviewMediaMode = !editorMode && accuratePreviewReady ? "linear" : "mapped";
  const activePreviewVideoUrl =
    activePreviewMediaMode === "linear" ? accuratePreviewVideoUrl : previewVideoUrl;
  const previewBackgroundMode = useMemo(() => {
    if (backgroundMode !== "source-blur") {
      return backgroundMode;
    }
    if (editorMode) {
      return resolveStage3BackgroundMode(templateId, {
        hasCustomBackground: Boolean(backgroundAssetUrl),
        hasSourceVideo: false
      });
    }
    return backgroundMode;
  }, [backgroundAssetUrl, backgroundMode, editorMode, templateId]);
  const effectivePreviewNotice =
    editorMode && backgroundMode === "source-blur" && !previewNotice
      ? "Быстрый preview использует лёгкий backdrop вместо blur-фона. Финальный export не меняется."
      : !editorMode
        ? accuratePreviewNotice ?? previewNotice
        : previewNotice;
  const effectivePreviewState = !editorMode ? accuratePreviewState : previewState;
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
    setTimelineSec((prev) => clamp(prev, 0, playbackDurationSec));
  }, [activePreviewMediaMode, activePreviewVideoUrl, playbackDurationSec, playbackPlan]);

  useEffect(() => {
    if (editorMode) {
      return;
    }
    previewAdjustPointerIdRef.current = null;
    draggingTransformKeyframeIdRef.current = null;
    draggingTransformTrackRef.current = null;
    setIsPreviewAdjustingCamera(false);
    setIsDraggingCameraKeyframe(false);
  }, [editorMode]);

  useEffect(() => {
    onTimelineSecChange?.(timelineSec);
  }, [onTimelineSecChange, timelineSec]);

  const syncBackgroundTo = useCallback((outputSec: number, sourceSec: number) => {
    const bg = backgroundPreviewRef.current;
    if (!bg || bg.readyState < 1) {
      return;
    }
    const duration = Number.isFinite(bg.duration) && bg.duration > 0 ? bg.duration : null;
    const desiredSec =
      previewBackgroundMode === "source-blur" && activePreviewMediaMode === "mapped"
        ? sourceSec
        : outputSec;
    const next = duration ? desiredSec % duration : desiredSec;
    if (Math.abs(bg.currentTime - next) > 0.08) {
      bg.currentTime = next;
    }
    if (isPlayingRef.current && bg.paused) {
      void bg.play().catch(() => undefined);
    }
  }, [activePreviewMediaMode, previewBackgroundMode]);

  const handlePreviewPositionChange = useCallback(
    (outputSec: number, sourceSec: number) => {
      if (!isTimelineScrubbingRef.current) {
        setTimelineSec((prev) => (Math.abs(prev - outputSec) >= 1 / 240 ? outputSec : prev));
      }
      syncBackgroundTo(outputSec, sourceSec);
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
  }, [activePreviewVideoUrl, backgroundAssetUrl, isPlaying]);

  const seekTimeline = useCallback(
    (value: number) => {
      const clamped = clamp(value, 0, playbackDurationSec);
      setTimelineSec(clamped);
      const video = slotPreviewRef.current;
      if (video) {
        if (activePreviewMediaMode === "linear") {
          video.currentTime = clamped;
          syncBackgroundTo(clamped, clamped);
          return;
        }
        const position = resolveStage3PlaybackPosition(playbackPlan, clamped);
        if (position) {
          applyStage3PlaybackPositionToVideo(video, position, 0);
          syncBackgroundTo(position.outputTimeSec, position.sourceTimeSec);
          return;
        }
      }
      syncBackgroundTo(clamped, clamped);
    },
    [activePreviewMediaMode, playbackDurationSec, playbackPlan, syncBackgroundTo]
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
      seekTimeline(ratio * playbackDurationSec);
    },
    [playbackDurationSec, seekTimeline]
  );

  useEffect(() => {
    if (typeof requestedTimelineSec !== "number" || !Number.isFinite(requestedTimelineSec)) {
      return;
    }
    if (Math.abs(timelineSec - requestedTimelineSec) <= 0.001) {
      onRequestedTimelineHandled?.();
      return;
    }
    seekTimeline(requestedTimelineSec);
    onRequestedTimelineHandled?.();
  }, [onRequestedTimelineHandled, requestedTimelineSec, seekTimeline, timelineSec]);

  const updateCameraFocusFromClientY = useCallback(
    (clientY: number) => {
      const canvas = previewSurfaceRef.current;
      if (!canvas) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.height <= 0) {
        return;
      }
      const focus = clampStage3FocusY((clientY - rect.top) / rect.height);
      onCameraPreviewFocusChange(focus);
    },
    [onCameraPreviewFocusChange]
  );

  const updateTransformKeyframeTimeFromClientX = useCallback(
    (clientX: number) => {
      const activeId = draggingTransformKeyframeIdRef.current;
      const activeTrack = draggingTransformTrackRef.current;
      const track = activeTrack === "position" ? positionTrackRef.current : activeTrack === "scale" ? scaleTrackRef.current : null;
      if (!activeId || !track || !activeTrack) {
        return;
      }
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const nextTimeSec = ratio * playbackDurationSec;
      if (activeTrack === "position") {
        onPositionKeyframeTimeChange(activeId, nextTimeSec);
      } else {
        onScaleKeyframeTimeChange(activeId, nextTimeSec);
      }
      seekTimeline(nextTimeSec);
    },
    [onPositionKeyframeTimeChange, onScaleKeyframeTimeChange, playbackDurationSec, seekTimeline]
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

  useEffect(() => {
    if (!isPreviewAdjustingCamera) {
      return;
    }

    const handleMove = (event: PointerEvent) => {
      updateCameraFocusFromClientY(event.clientY);
    };
    const handleEnd = (event: PointerEvent) => {
      if (
        previewAdjustPointerIdRef.current !== null &&
        event.pointerId !== previewAdjustPointerIdRef.current
      ) {
        return;
      }
      updateCameraFocusFromClientY(event.clientY);
      previewAdjustPointerIdRef.current = null;
      setIsPreviewAdjustingCamera(false);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [isPreviewAdjustingCamera, updateCameraFocusFromClientY]);

  useEffect(() => {
    if (!isDraggingCameraKeyframe) {
      return;
    }

    const handleMove = (event: PointerEvent) => {
      updateTransformKeyframeTimeFromClientX(event.clientX);
    };
    const handleEnd = (event: PointerEvent) => {
      updateTransformKeyframeTimeFromClientX(event.clientX);
      draggingTransformKeyframeIdRef.current = null;
      draggingTransformTrackRef.current = null;
      setIsDraggingCameraKeyframe(false);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [isDraggingCameraKeyframe, updateTransformKeyframeTimeFromClientX]);

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
              ref={previewSurfaceRef}
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
                    backgroundNode: previewBackgroundMode === "custom"
                        ? backgroundIsVideo
                          ? (
                            <video
                              key={backgroundAssetUrl}
                              ref={backgroundPreviewRef}
                              className="preview-bg-video preview-bg-custom"
                              src={backgroundAssetUrl ?? undefined}
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              onLoadedMetadata={() => {
                                const position = resolveStage3PlaybackPosition(playbackPlan, timelineSec);
                                syncBackgroundTo(
                                  position?.outputTimeSec ?? timelineSec,
                                  position?.sourceTimeSec ?? timelineSec
                                );
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
                        : previewBackgroundMode === "source-blur"
                          ? (
                            <video
                              key={activePreviewVideoUrl}
                              ref={backgroundPreviewRef}
                              className="preview-bg-video"
                              src={activePreviewVideoUrl ?? undefined}
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
                                const position = resolveStage3PlaybackPosition(playbackPlan, timelineSec);
                                syncBackgroundTo(
                                  position?.outputTimeSec ?? timelineSec,
                                  position?.sourceTimeSec ?? timelineSec
                                );
                                if (isPlaying) {
                                  const bg = backgroundPreviewRef.current;
                                  if (bg) {
                                    void bg.play().catch(() => undefined);
                                  }
                                }
                              }}
                            />
                          )
                          : previewBackgroundMode === "built-in"
                            ? resolveTemplateBackdropNode(templateId)
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
                    mediaNode: activePreviewVideoUrl ? (
                      <PreviewClipVideo
                        key={`${activePreviewMediaMode}:${activePreviewVideoUrl}`}
                        sourceUrl={activePreviewVideoUrl}
                        playbackDurationSec={playbackDurationSec}
                        playbackPlan={playbackPlan}
                        mediaMode={activePreviewMediaMode}
                        className="preview-slot-video"
                        objectPosition={objectPosition}
                        videoZoom={cameraState.zoom}
                        mirrorEnabled={mirrorEnabled}
                        muted={isMuted || !sourceAudioEnabled}
                        videoRef={slotPreviewRef}
                        isPlaying={isPlaying}
                        loopEnabled={loopEnabled}
                        onPositionChange={handlePreviewPositionChange}
                        onSourceDurationChange={setProxySourceDurationSec}
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
              {editorMode ? (
                <div
                  className={`camera-preview-overlay ${isPreviewAdjustingCamera ? "dragging" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label="Перетащите вверх или вниз, чтобы изменить вертикальный фокус камеры"
                  onPointerDown={(event) => {
                    previewAdjustPointerIdRef.current = event.pointerId;
                    setIsPreviewAdjustingCamera(true);
                    updateCameraFocusFromClientY(event.clientY);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      onCameraPreviewFocusChange(clampStage3FocusY(cameraState.focusY - 0.01));
                    }
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      onCameraPreviewFocusChange(clampStage3FocusY(cameraState.focusY + 0.01));
                    }
                  }}
                >
                  <span className="camera-preview-overlay-label">
                    {selectedPositionKeyframe ? "Точка Position Y" : "База Position Y"} · Y {Math.round(cameraState.focusY * 100)}%
                  </span>
                </div>
              ) : null}
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
              aria-valuemax={playbackDurationSec}
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
            {editorMode ? (
              <>
                <div
                  ref={positionTrackRef}
                  className="timeline-track camera-track"
                  aria-label="Дорожка keyframes position"
                  onPointerDown={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (target?.closest?.("[data-position-keyframe-id]")) {
                      return;
                    }
                    seekTimelineAtClientX(event.clientX);
                    onSelectPositionKeyframeId(null);
                    onSelectScaleKeyframeId(null);
                  }}
                >
                  <div className="camera-track-label">Position Y</div>
                  {activePositionKeyframes.map((keyframe) => {
                    const left = clamp((keyframe.timeSec / Math.max(0.01, playbackDurationSec)) * 100, 0, 100);
                    const active = keyframe.id === selectedPositionKeyframeId;
                    return (
                      <button
                        key={keyframe.id}
                        type="button"
                        data-position-keyframe-id={keyframe.id}
                        className={`camera-keyframe ${active ? "active" : ""}`}
                        style={{ left: `${left}%` }}
                        aria-label={`Keyframe Position Y ${formatTimeSec(keyframe.timeSec)}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          draggingTransformKeyframeIdRef.current = keyframe.id;
                          draggingTransformTrackRef.current = "position";
                          setIsDraggingCameraKeyframe(true);
                          onSelectPositionKeyframeId(keyframe.id);
                          onSelectScaleKeyframeId(null);
                          seekTimeline(keyframe.timeSec);
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectPositionKeyframeId(keyframe.id);
                          onSelectScaleKeyframeId(null);
                          seekTimeline(keyframe.timeSec);
                        }}
                      />
                    );
                  })}
                  <div className="timeline-playhead camera-track-playhead" style={{ left: `${timelinePercent}%` }} />
                </div>
                <div
                  ref={scaleTrackRef}
                  className="timeline-track camera-track"
                  aria-label="Дорожка keyframes scale"
                  onPointerDown={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (target?.closest?.("[data-scale-keyframe-id]")) {
                      return;
                    }
                    seekTimelineAtClientX(event.clientX);
                    onSelectScaleKeyframeId(null);
                    onSelectPositionKeyframeId(null);
                  }}
                >
                  <div className="camera-track-label">Scale</div>
                  {activeScaleKeyframes.map((keyframe) => {
                    const left = clamp((keyframe.timeSec / Math.max(0.01, playbackDurationSec)) * 100, 0, 100);
                    const active = keyframe.id === selectedScaleKeyframeId;
                    return (
                      <button
                        key={keyframe.id}
                        type="button"
                        data-scale-keyframe-id={keyframe.id}
                        className={`camera-keyframe ${active ? "active" : ""}`}
                        style={{ left: `${left}%` }}
                        aria-label={`Keyframe Scale ${formatTimeSec(keyframe.timeSec)}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          draggingTransformKeyframeIdRef.current = keyframe.id;
                          draggingTransformTrackRef.current = "scale";
                          setIsDraggingCameraKeyframe(true);
                          onSelectScaleKeyframeId(keyframe.id);
                          onSelectPositionKeyframeId(null);
                          seekTimeline(keyframe.timeSec);
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectScaleKeyframeId(keyframe.id);
                          onSelectPositionKeyframeId(null);
                          seekTimeline(keyframe.timeSec);
                        }}
                      />
                    );
                  })}
                  <div className="timeline-playhead camera-track-playhead" style={{ left: `${timelinePercent}%` }} />
                </div>
              </>
            ) : null}
          <div className="timeline-time">
            <span>{formatTimeSec(timelineSec)}</span>
            <span>{formatTimeSec(playbackDurationSec)}</span>
          </div>
        </div>
        <div className="timeline-notice">
            {effectivePreviewNotice ? (
              <p className="subtle-text">{sanitizeDisplayText(effectivePreviewNotice)}</p>
            ) : effectivePreviewState === "loading" || effectivePreviewState === "retrying" || effectivePreviewState === "debouncing" ? (
              <p className="subtle-text">Обновляю предпросмотр...</p>
            ) : null}
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
  accuratePreviewVideoUrl = null,
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
  accuratePreviewState = "idle",
  accuratePreviewNotice = null,
  agentPrompt,
  agentSession,
  agentMessages,
  agentCurrentScore,
  isAgentTimelineLoading,
  canResumeAgent,
  canRollbackSelectedVersion,
  topText,
  bottomText,
  captionSources,
  selectedCaptionOption,
  handoffSummary,
  segments,
  compressionEnabled,
  timingMode = compressionEnabled ? "compress" : "auto",
  renderPolicy = segments.length > 0 ? "fixed_segments" : compressionEnabled ? "full_source_normalize" : "fixed_segments",
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
  cameraKeyframes,
  cameraPositionKeyframes,
  cameraScaleKeyframes,
  mirrorEnabled,
  videoZoom,
  topFontScale,
  bottomFontScale,
  sourceAudioEnabled,
  musicGain,
  publication = null,
  onRender,
  onExport,
  onOptimize,
  onResumeAgent,
  onRollbackSelectedVersion,
  onReset,
  onTopTextChange,
  onBottomTextChange,
  onApplyCaptionSource,
  onResetCaptionText,
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
  onCameraPositionKeyframesChange,
  onCameraScaleKeyframesChange,
  onMirrorEnabledChange,
  onVideoZoomChange,
  onTopFontScaleChange,
  onBottomFontScaleChange,
  onSourceAudioEnabledChange,
  onMusicGainChange,
  onCreateWorkerPairing,
  onOpenPlanner = () => undefined
}: Step3RenderTemplateProps) {
  const clipCommitTimerRef = useRef<number | null>(null);
  const focusCommitTimerRef = useRef<number | null>(null);
  const videoZoomCommitTimerRef = useRef<number | null>(null);
  const positionKeyframesCommitTimerRef = useRef<number | null>(null);
  const scaleKeyframesCommitTimerRef = useRef<number | null>(null);
  const topFontScaleCommitTimerRef = useRef<number | null>(null);
  const bottomFontScaleCommitTimerRef = useRef<number | null>(null);
  const musicGainCommitTimerRef = useRef<number | null>(null);

  const [localClipStartSec, setLocalClipStartSec] = useState(clipStartSec);
  const [localFocusY, setLocalFocusY] = useState(focusY);
  const [localVideoZoom, setLocalVideoZoom] = useState(videoZoom);
  const [selectedPositionKeyframeId, setSelectedPositionKeyframeId] = useState<string | null>(null);
  const [selectedScaleKeyframeId, setSelectedScaleKeyframeId] = useState<string | null>(null);
  const previewTimelineSecRef = useRef(0);
  const [requestedTimelineSec, setRequestedTimelineSec] = useState<number | null>(null);
  const [localTopFontScale, setLocalTopFontScale] = useState(topFontScale);
  const [localBottomFontScale, setLocalBottomFontScale] = useState(bottomFontScale);
  const [localMusicGain, setLocalMusicGain] = useState(musicGain);
  const [stage3Mode, setStage3Mode] = useState<Stage3SurfaceMode>("finish");
  const [workerSetupOpen, setWorkerSetupOpen] = useState(false);
  const [workerGuidePlatform, setWorkerGuidePlatform] = useState<WorkerGuidePlatform>(() => detectWorkerGuidePlatform());
  const [workerCopyState, setWorkerCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [workerInstallCopyState, setWorkerInstallCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [segmentDraftInputs, setSegmentDraftInputs] = useState<
    Record<string, { startSec: string; endSec: string }>
  >({});
  const [previewMeasuredFitState, setPreviewMeasuredFitState] = useState<{
    snapshotHash: string;
    fitHash: string;
    fit: Stage3TextFitSnapshot;
    measured: boolean;
  } | null>(null);
  const [pendingTextFitAction, setPendingTextFitAction] = useState<PendingTextFitAction | null>(null);

  const templateConfig = getTemplateById(templateId);
  const effectiveCameraTracks = useMemo(
    () =>
      resolveStage3EffectiveCameraTracks({
        cameraPositionKeyframes,
        cameraScaleKeyframes,
        cameraKeyframes,
        cameraMotion,
        clipDurationSec,
        baseFocusY: focusY,
        baseZoom: videoZoom
      }),
    [cameraKeyframes, cameraMotion, cameraPositionKeyframes, cameraScaleKeyframes, clipDurationSec, focusY, videoZoom]
  );
  const [localPositionKeyframes, setLocalPositionKeyframes] = useState<Stage3PositionKeyframe[]>(
    effectiveCameraTracks.positionKeyframes
  );
  const [localScaleKeyframes, setLocalScaleKeyframes] = useState<Stage3ScaleKeyframe[]>(
    effectiveCameraTracks.scaleKeyframes
  );
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
  const backgroundMode = useMemo(
    () =>
      resolveStage3BackgroundMode(templateId, {
        hasCustomBackground: Boolean(backgroundAssetUrl),
        hasSourceVideo: Boolean(previewVideoUrl)
      }),
    [backgroundAssetUrl, previewVideoUrl, templateId]
  );

  const displayVersions = useMemo(
    () => [...versions].sort((a, b) => (a.versionNo < b.versionNo ? 1 : -1)),
    [versions]
  );

  const selectedVersion = useMemo(
    () => (selectedVersionId ? versions.find((version) => version.runId === selectedVersionId) ?? null : null),
    [versions, selectedVersionId]
  );

  const selectedPass = selectedVersion?.internalPasses[selectedPassIndex] ?? null;

  const previewVersion = selectedVersion;
  const selectedCaptionSource =
    captionSources.find((item) => item.option === selectedCaptionOption) ?? null;
  const topTextSourceLabel = formatCaptionSourceLabel(handoffSummary?.topTextSource ?? "empty");
  const bottomTextSourceLabel = formatCaptionSourceLabel(handoffSummary?.bottomTextSource ?? "empty");
  const hasManualCaptionOverride = Boolean(handoffSummary?.hasManualTextOverride);
  const previewVideoZoom = clamp(localVideoZoom ?? 1, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM);
  const previewFitHash = useMemo(
    () => getTextFitHashForSnapshot(previewTemplateSnapshot),
    [previewTemplateSnapshot]
  );
  const activePreviewTextFit = useMemo(() => {
    if (
      previewMeasuredFitState?.snapshotHash === previewTemplateSnapshot.snapshotHash &&
      previewMeasuredFitState.fitHash === previewFitHash
    ) {
      return previewMeasuredFitState.fit;
    }
    return toTextFitSnapshot(previewTemplateSnapshot.computed, previewTemplateSnapshot);
  }, [previewFitHash, previewMeasuredFitState, previewTemplateSnapshot]);
  const isPreviewTextFitReady =
    previewMeasuredFitState?.snapshotHash === previewTemplateSnapshot.snapshotHash &&
    previewMeasuredFitState.fitHash === previewFitHash &&
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
  const normalizedLocalPositionKeyframes = useMemo(
    () =>
      normalizeStage3PositionKeyframes(localPositionKeyframes, {
        clipDurationSec,
        fallbackFocusY: localFocusY
      }),
    [clipDurationSec, localFocusY, localPositionKeyframes]
  );
  const normalizedLocalScaleKeyframes = useMemo(
    () =>
      normalizeStage3ScaleKeyframes(localScaleKeyframes, {
        clipDurationSec,
        fallbackZoom: localVideoZoom
      }),
    [clipDurationSec, localScaleKeyframes, localVideoZoom]
  );
  const selectedPositionKeyframe = selectedPositionKeyframeId
    ? normalizedLocalPositionKeyframes.find((keyframe) => keyframe.id === selectedPositionKeyframeId) ?? null
    : null;
  const selectedScaleKeyframe = selectedScaleKeyframeId
    ? normalizedLocalScaleKeyframes.find((keyframe) => keyframe.id === selectedScaleKeyframeId) ?? null
    : null;
  const cameraModeLabel = formatCameraTrackLabel(
    normalizedLocalPositionKeyframes,
    normalizedLocalScaleKeyframes,
    cameraMotion
  );
  const cameraFocusPercent = Math.round((selectedPositionKeyframe?.focusY ?? localFocusY) * 100);
  const isFinishMode = stage3Mode === "finish";
  const backgroundModeLabel =
    backgroundMode === "custom"
      ? "Custom"
      : backgroundMode === "source-blur"
        ? "Blur source"
        : backgroundMode === "built-in"
          ? "Template backdrop"
          : "Fallback";
  const audioModeLabel = selectedMusicAssetId
    ? sourceAudioEnabled
      ? "Музыка + исходник"
      : "Только музыка"
    : sourceAudioEnabled
      ? "Только исходник"
      : "Без звука";
  const manualTimingLabel =
    normalizedSegments.length > 0
      ? `Фрагменты ${normalizedSegments.length} · ${formatTimeSec(explicitSegmentsDurationSec)}`
      : `Окно ${formatTimeSec(clipDurationSec)}`;
  const editorZoomLabel = `x${(selectedScaleKeyframe?.zoom ?? localVideoZoom).toFixed(2)}`;
  const handlePreviewMeasuredTextFitChange = useCallback(
    (nextFit: Stage3TextFitSnapshot) => {
      setPreviewMeasuredFitState((current) => {
        const nextState = {
          snapshotHash: previewTemplateSnapshot.snapshotHash,
          fitHash: previewFitHash,
          fit: nextFit,
          measured: true
        };
        if (
          current?.snapshotHash === nextState.snapshotHash &&
          current.fitHash === nextState.fitHash &&
          current.measured === nextState.measured &&
          areTextFitSnapshotsEqual(current.fit, nextState.fit)
        ) {
          return current;
        }
        return nextState;
      });
    },
    [previewFitHash, previewTemplateSnapshot.snapshotHash]
  );

  useEffect(() => {
    setLocalClipStartSec(clamp(clipStartSec, 0, maxStartSec));
  }, [clipStartSec, maxStartSec]);

  useEffect(() => {
    setPreviewMeasuredFitState((current) => {
      if (
        current?.snapshotHash === previewTemplateSnapshot.snapshotHash &&
        current.fitHash === previewFitHash
      ) {
        return current;
      }
      return {
        snapshotHash: previewTemplateSnapshot.snapshotHash,
        fitHash: previewFitHash,
        fit: toTextFitSnapshot(previewTemplateSnapshot.computed, previewTemplateSnapshot),
        measured: false
      };
    });
  }, [previewFitHash, previewTemplateSnapshot.computed, previewTemplateSnapshot.snapshotHash]);

  useEffect(() => {
    if (!pendingTextFitAction) {
      return;
    }
    if (
      pendingTextFitAction.snapshotHash !== previewTemplateSnapshot.snapshotHash ||
      pendingTextFitAction.fitHash !== previewFitHash
    ) {
      setPendingTextFitAction(null);
      return;
    }
    if (!isPreviewTextFitReady) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (pendingTextFitAction.kind === "optimize") {
        onOptimize(pendingTextFitAction.overrides, activePreviewTextFit);
      } else {
        onRender(pendingTextFitAction.overrides, activePreviewTextFit);
      }
      setPendingTextFitAction(null);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activePreviewTextFit,
    isPreviewTextFitReady,
    onOptimize,
    onRender,
    pendingTextFitAction,
    previewFitHash,
    previewTemplateSnapshot.snapshotHash
  ]);

  useEffect(() => {
    setLocalFocusY(clamp(focusY, 0.12, 0.88));
  }, [focusY]);

  useEffect(() => {
    setLocalVideoZoom(clamp(videoZoom, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM));
  }, [videoZoom]);

  useEffect(() => {
    setLocalPositionKeyframes(effectiveCameraTracks.positionKeyframes);
    setLocalScaleKeyframes(effectiveCameraTracks.scaleKeyframes);
  }, [effectiveCameraTracks]);

  useEffect(() => {
    setSelectedPositionKeyframeId((current) => {
      if (!normalizedLocalPositionKeyframes.length) {
        return null;
      }
      if (current === null) {
        return null;
      }
      if (current && normalizedLocalPositionKeyframes.some((keyframe) => keyframe.id === current)) {
        return current;
      }
      return normalizedLocalPositionKeyframes[normalizedLocalPositionKeyframes.length - 1]?.id ?? null;
    });
  }, [normalizedLocalPositionKeyframes]);

  useEffect(() => {
    setSelectedScaleKeyframeId((current) => {
      if (!normalizedLocalScaleKeyframes.length) {
        return null;
      }
      if (current === null) {
        return null;
      }
      if (current && normalizedLocalScaleKeyframes.some((keyframe) => keyframe.id === current)) {
        return current;
      }
      return normalizedLocalScaleKeyframes[normalizedLocalScaleKeyframes.length - 1]?.id ?? null;
    });
  }, [normalizedLocalScaleKeyframes]);

  useEffect(() => {
    setLocalTopFontScale(clampStage3TextScaleUi(topFontScale));
  }, [topFontScale]);

  useEffect(() => {
    setLocalBottomFontScale(clampStage3TextScaleUi(bottomFontScale));
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
      if (positionKeyframesCommitTimerRef.current !== null) {
        window.clearTimeout(positionKeyframesCommitTimerRef.current);
      }
      if (scaleKeyframesCommitTimerRef.current !== null) {
        window.clearTimeout(scaleKeyframesCommitTimerRef.current);
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

  const flushPositionKeyframesCommit = (value: Stage3PositionKeyframe[]) => {
    if (positionKeyframesCommitTimerRef.current !== null) {
      window.clearTimeout(positionKeyframesCommitTimerRef.current);
      positionKeyframesCommitTimerRef.current = null;
    }
    const next = normalizeStage3PositionKeyframes(value, {
      clipDurationSec,
      fallbackFocusY: localFocusY
    });
    setLocalPositionKeyframes(next);
    onCameraPositionKeyframesChange(next);
  };

  const schedulePositionKeyframesCommit = (value: Stage3PositionKeyframe[]) => {
    const next = normalizeStage3PositionKeyframes(value, {
      clipDurationSec,
      fallbackFocusY: localFocusY
    });
    setLocalPositionKeyframes(next);
    if (positionKeyframesCommitTimerRef.current !== null) {
      window.clearTimeout(positionKeyframesCommitTimerRef.current);
    }
    positionKeyframesCommitTimerRef.current = window.setTimeout(() => {
      onCameraPositionKeyframesChange(next);
      positionKeyframesCommitTimerRef.current = null;
    }, 180);
  };

  const flushScaleKeyframesCommit = (value: Stage3ScaleKeyframe[]) => {
    if (scaleKeyframesCommitTimerRef.current !== null) {
      window.clearTimeout(scaleKeyframesCommitTimerRef.current);
      scaleKeyframesCommitTimerRef.current = null;
    }
    const next = normalizeStage3ScaleKeyframes(value, {
      clipDurationSec,
      fallbackZoom: localVideoZoom
    });
    setLocalScaleKeyframes(next);
    onCameraScaleKeyframesChange(next);
  };

  const scheduleScaleKeyframesCommit = (value: Stage3ScaleKeyframe[]) => {
    const next = normalizeStage3ScaleKeyframes(value, {
      clipDurationSec,
      fallbackZoom: localVideoZoom
    });
    setLocalScaleKeyframes(next);
    if (scaleKeyframesCommitTimerRef.current !== null) {
      window.clearTimeout(scaleKeyframesCommitTimerRef.current);
    }
    scaleKeyframesCommitTimerRef.current = window.setTimeout(() => {
      onCameraScaleKeyframesChange(next);
      scaleKeyframesCommitTimerRef.current = null;
    }, 180);
  };

  const flushTopFontScaleCommit = (value: number) => {
    if (topFontScaleCommitTimerRef.current !== null) {
      window.clearTimeout(topFontScaleCommitTimerRef.current);
      topFontScaleCommitTimerRef.current = null;
    }
    onTopFontScaleChange(clampStage3TextScaleUi(value));
  };

  const scheduleTopFontScaleCommit = (value: number) => {
    const next = clampStage3TextScaleUi(value);
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
    onBottomFontScaleChange(clampStage3TextScaleUi(value));
  };

  const scheduleBottomFontScaleCommit = (value: number) => {
    const next = clampStage3TextScaleUi(value);
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
      focusY: clampStage3FocusY(localFocusY),
      videoZoom: clampStage3CameraZoom(localVideoZoom),
      cameraKeyframes: [],
      cameraPositionKeyframes: normalizedLocalPositionKeyframes,
      cameraScaleKeyframes: normalizedLocalScaleKeyframes,
      topFontScale: clampStage3TextScaleUi(localTopFontScale),
      bottomFontScale: clampStage3TextScaleUi(localBottomFontScale),
      musicGain: clamp(localMusicGain, 0, 1)
    };
    flushClipCommit(overrides.clipStartSec);
    flushFocusCommit(overrides.focusY);
    flushVideoZoomCommit(overrides.videoZoom);
    flushPositionKeyframesCommit(overrides.cameraPositionKeyframes);
    flushScaleKeyframesCommit(overrides.cameraScaleKeyframes);
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

  const buildTransformKeyframeId = (prefix: "position" | "scale") =>
    globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

  const updateSelectedPositionKeyframe = (
    updater: (keyframe: Stage3PositionKeyframe) => Stage3PositionKeyframe,
    options?: { immediate?: boolean }
  ) => {
    if (!selectedPositionKeyframe) {
      return;
    }
    const next = normalizedLocalPositionKeyframes.map((keyframe) =>
      keyframe.id === selectedPositionKeyframe.id ? updater(keyframe) : keyframe
    );
    setSelectedPositionKeyframeId(selectedPositionKeyframe.id);
    if (options?.immediate) {
      flushPositionKeyframesCommit(next);
      return;
    }
    schedulePositionKeyframesCommit(next);
  };

  const updateSelectedScaleKeyframe = (
    updater: (keyframe: Stage3ScaleKeyframe) => Stage3ScaleKeyframe,
    options?: { immediate?: boolean }
  ) => {
    if (!selectedScaleKeyframe) {
      return;
    }
    const next = normalizedLocalScaleKeyframes.map((keyframe) =>
      keyframe.id === selectedScaleKeyframe.id ? updater(keyframe) : keyframe
    );
    setSelectedScaleKeyframeId(selectedScaleKeyframe.id);
    if (options?.immediate) {
      flushScaleKeyframesCommit(next);
      return;
    }
    scheduleScaleKeyframesCommit(next);
  };

  const addPositionKeyframeAtPlayhead = () => {
    const currentState = resolveCameraStateAtTime({
      timeSec: previewTimelineSecRef.current,
      cameraPositionKeyframes: normalizedLocalPositionKeyframes,
      cameraScaleKeyframes: normalizedLocalScaleKeyframes,
      cameraMotion,
      clipDurationSec,
      baseFocusY: localFocusY,
      baseZoom: localVideoZoom
    });
    const nextKeyframe: Stage3PositionKeyframe = {
      id: buildTransformKeyframeId("position"),
      timeSec: previewTimelineSecRef.current,
      focusY: currentState.focusY
    };
    const next = [
      ...normalizedLocalPositionKeyframes.filter(
        (keyframe) => Math.abs(keyframe.timeSec - previewTimelineSecRef.current) > 0.001
      ),
      nextKeyframe
    ];
    setSelectedPositionKeyframeId(nextKeyframe.id);
    setSelectedScaleKeyframeId(null);
    flushPositionKeyframesCommit(next);
  };

  const addScaleKeyframeAtPlayhead = () => {
    const currentState = resolveCameraStateAtTime({
      timeSec: previewTimelineSecRef.current,
      cameraPositionKeyframes: normalizedLocalPositionKeyframes,
      cameraScaleKeyframes: normalizedLocalScaleKeyframes,
      cameraMotion,
      clipDurationSec,
      baseFocusY: localFocusY,
      baseZoom: localVideoZoom
    });
    const nextKeyframe: Stage3ScaleKeyframe = {
      id: buildTransformKeyframeId("scale"),
      timeSec: previewTimelineSecRef.current,
      zoom: currentState.zoom
    };
    const next = [
      ...normalizedLocalScaleKeyframes.filter(
        (keyframe) => Math.abs(keyframe.timeSec - previewTimelineSecRef.current) > 0.001
      ),
      nextKeyframe
    ];
    setSelectedScaleKeyframeId(nextKeyframe.id);
    setSelectedPositionKeyframeId(null);
    flushScaleKeyframesCommit(next);
  };

  const togglePositionKeyframeAtPlayhead = () => {
    const existing = normalizedLocalPositionKeyframes.find(
      (keyframe) => Math.abs(keyframe.timeSec - previewTimelineSecRef.current) <= 0.001
    );
    if (existing) {
      const next = normalizedLocalPositionKeyframes.filter((keyframe) => keyframe.id !== existing.id);
      setSelectedPositionKeyframeId(next[next.length - 1]?.id ?? null);
      flushPositionKeyframesCommit(next);
      return;
    }
    addPositionKeyframeAtPlayhead();
  };

  const toggleScaleKeyframeAtPlayhead = () => {
    const existing = normalizedLocalScaleKeyframes.find(
      (keyframe) => Math.abs(keyframe.timeSec - previewTimelineSecRef.current) <= 0.001
    );
    if (existing) {
      const next = normalizedLocalScaleKeyframes.filter((keyframe) => keyframe.id !== existing.id);
      setSelectedScaleKeyframeId(next[next.length - 1]?.id ?? null);
      flushScaleKeyframesCommit(next);
      return;
    }
    addScaleKeyframeAtPlayhead();
  };

  const removeSelectedPositionKeyframe = () => {
    if (!selectedPositionKeyframe) {
      return;
    }
    const next = normalizedLocalPositionKeyframes.filter((keyframe) => keyframe.id !== selectedPositionKeyframe.id);
    setSelectedPositionKeyframeId(next[next.length - 1]?.id ?? null);
    flushPositionKeyframesCommit(next);
  };

  const removeSelectedScaleKeyframe = () => {
    if (!selectedScaleKeyframe) {
      return;
    }
    const next = normalizedLocalScaleKeyframes.filter((keyframe) => keyframe.id !== selectedScaleKeyframe.id);
    setSelectedScaleKeyframeId(next[next.length - 1]?.id ?? null);
    flushScaleKeyframesCommit(next);
  };

  const clearCameraTracks = () => {
    setSelectedPositionKeyframeId(null);
    setSelectedScaleKeyframeId(null);
    setLocalPositionKeyframes([]);
    setLocalScaleKeyframes([]);
    flushPositionKeyframesCommit([]);
    flushScaleKeyframesCommit([]);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedPositionKeyframe && !selectedScaleKeyframe) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      event.preventDefault();
      if (selectedPositionKeyframe) {
        removeSelectedPositionKeyframe();
        return;
      }
      removeSelectedScaleKeyframe();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [removeSelectedPositionKeyframe, removeSelectedScaleKeyframe, selectedPositionKeyframe, selectedScaleKeyframe]);

  const applyCameraMotionPreset = (motion: Exclude<Stage3CameraMotion, "disabled">) => {
    const next = buildLegacyPositionKeyframes({
      cameraMotion: motion,
      clipDurationSec,
      baseFocusY: localFocusY
    }).map((keyframe, index) => ({
      ...keyframe,
      id: `${motion}-position-${index + 1}`
    }));
    setSelectedPositionKeyframeId(next[next.length - 1]?.id ?? null);
    setSelectedScaleKeyframeId(null);
    flushPositionKeyframesCommit(next);
  };

  const applyZoomPreset = (direction: "in" | "out") => {
    const startZoom = clampStage3CameraZoom(localVideoZoom);
    const endZoom = clampStage3CameraZoom(startZoom * 1.22);
    const next =
      direction === "in"
        ? [
            { id: "zoom-in-start", timeSec: 0, zoom: startZoom },
            { id: "zoom-in-end", timeSec: clipDurationSec, zoom: endZoom }
          ]
        : [
          { id: "zoom-out-start", timeSec: 0, zoom: endZoom },
          { id: "zoom-out-end", timeSec: clipDurationSec, zoom: startZoom }
        ];
    setSelectedScaleKeyframeId(next[next.length - 1]?.id ?? null);
    setSelectedPositionKeyframeId(null);
    flushScaleKeyframesCommit(next);
  };

  const handleCameraPreviewFocusChange = (value: number) => {
    const next = clampStage3FocusY(value);
    if (selectedPositionKeyframe) {
      updateSelectedPositionKeyframe((keyframe) => ({
        ...keyframe,
        focusY: next
      }));
      return;
    }
    scheduleFocusCommit(next);
  };

  const handlePositionKeyframeTimeChange = (id: string, timeSec: number) => {
    const next = normalizedLocalPositionKeyframes.map((keyframe) =>
      keyframe.id === id
        ? {
            ...keyframe,
            timeSec: clamp(timeSec, 0, clipDurationSec)
          }
        : keyframe
    );
    setSelectedPositionKeyframeId(id);
    setSelectedScaleKeyframeId(null);
    schedulePositionKeyframesCommit(next);
  };

  const handleScaleKeyframeTimeChange = (id: string, timeSec: number) => {
    const next = normalizedLocalScaleKeyframes.map((keyframe) =>
      keyframe.id === id
        ? {
            ...keyframe,
            timeSec: clamp(timeSec, 0, clipDurationSec)
          }
        : keyframe
    );
    setSelectedScaleKeyframeId(id);
    setSelectedPositionKeyframeId(null);
    scheduleScaleKeyframesCommit(next);
  };

  const scheduleFocusValue = (value: number) => {
    const next = clampStage3FocusY(value);
    if (selectedPositionKeyframe) {
      updateSelectedPositionKeyframe((keyframe) => ({
        ...keyframe,
        focusY: next
      }));
      return;
    }
    scheduleFocusCommit(next);
  };

  const flushFocusValue = (value: number) => {
    const next = clampStage3FocusY(value);
    if (selectedPositionKeyframe) {
      updateSelectedPositionKeyframe(
        (keyframe) => ({
          ...keyframe,
          focusY: next
        }),
        { immediate: true }
      );
      return;
    }
    flushFocusCommit(next);
  };

  const scheduleZoomValue = (value: number) => {
    const next = clampStage3CameraZoom(value);
    if (selectedScaleKeyframe) {
      updateSelectedScaleKeyframe((keyframe) => ({
        ...keyframe,
        zoom: next
      }));
      return;
    }
    scheduleVideoZoomCommit(next);
  };

  const flushZoomValue = (value: number) => {
    const next = clampStage3CameraZoom(value);
    if (selectedScaleKeyframe) {
      updateSelectedScaleKeyframe(
        (keyframe) => ({
          ...keyframe,
          zoom: next
        }),
        { immediate: true }
      );
      return;
    }
    flushVideoZoomCommit(next);
  };

  const applyClipStartImmediate = (value: number) => {
    const next = clamp(value, 0, maxStartSec);
    setLocalClipStartSec(next);
    flushClipCommit(next);
  };

  const applyFocusImmediate = (value: number) => {
    const next = clampStage3FocusY(value);
    if (selectedPositionKeyframe) {
      updateSelectedPositionKeyframe(
        (keyframe) => ({
          ...keyframe,
          focusY: next
        }),
        { immediate: true }
      );
      return;
    }
    setLocalFocusY(next);
    flushFocusCommit(next);
  };

  const applyVideoZoomImmediate = (value: number) => {
    const next = clampStage3CameraZoom(value);
    if (selectedScaleKeyframe) {
      updateSelectedScaleKeyframe(
        (keyframe) => ({
          ...keyframe,
          zoom: next
        }),
        { immediate: true }
      );
      return;
    }
    setLocalVideoZoom(next);
    flushVideoZoomCommit(next);
  };

  const positionKeyframeAtPlayhead = normalizedLocalPositionKeyframes.find(
    (keyframe) => Math.abs(keyframe.timeSec - previewTimelineSecRef.current) <= 0.001
  ) ?? null;
  const scaleKeyframeAtPlayhead = normalizedLocalScaleKeyframes.find(
    (keyframe) => Math.abs(keyframe.timeSec - previewTimelineSecRef.current) <= 0.001
  ) ?? null;

  const jumpToNeighborPositionKeyframe = (direction: "prev" | "next") => {
    const ordered = normalizedLocalPositionKeyframes;
    if (!ordered.length) {
      return;
    }
    const currentTime = selectedPositionKeyframe?.timeSec ?? previewTimelineSecRef.current;
    const target =
      direction === "prev"
        ? [...ordered].reverse().find((keyframe) => keyframe.timeSec < currentTime - 0.001) ?? ordered[0]
        : ordered.find((keyframe) => keyframe.timeSec > currentTime + 0.001) ?? ordered[ordered.length - 1];
    if (!target) {
      return;
    }
    setSelectedPositionKeyframeId(target.id);
    setSelectedScaleKeyframeId(null);
    previewTimelineSecRef.current = target.timeSec;
    setRequestedTimelineSec(target.timeSec);
  };

  const jumpToNeighborScaleKeyframe = (direction: "prev" | "next") => {
    const ordered = normalizedLocalScaleKeyframes;
    if (!ordered.length) {
      return;
    }
    const currentTime = selectedScaleKeyframe?.timeSec ?? previewTimelineSecRef.current;
    const target =
      direction === "prev"
        ? [...ordered].reverse().find((keyframe) => keyframe.timeSec < currentTime - 0.001) ?? ordered[0]
        : ordered.find((keyframe) => keyframe.timeSec > currentTime + 0.001) ?? ordered[ordered.length - 1];
    if (!target) {
      return;
    }
    setSelectedScaleKeyframeId(target.id);
    setSelectedPositionKeyframeId(null);
    previewTimelineSecRef.current = target.timeSec;
    setRequestedTimelineSec(target.timeSec);
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
    const next = clampStage3TextScaleUi(value);
    setLocalTopFontScale(next);
    flushTopFontScaleCommit(next);
  };

  const applyBottomFontScaleImmediate = (value: number) => {
    const next = clampStage3TextScaleUi(value);
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

  const startTextFitAction = (kind: PendingTextFitAction["kind"]) => {
    const overrides = commitAdvancedControls();
    const request: PendingTextFitAction = {
      kind,
      overrides,
      snapshotHash: previewTemplateSnapshot.snapshotHash,
      fitHash: previewFitHash
    };

    if (isPreviewTextFitReady) {
      window.setTimeout(() => {
        if (kind === "optimize") {
          onOptimize(overrides, activePreviewTextFit);
        } else {
          onRender(overrides, activePreviewTextFit);
        }
      }, 0);
      return;
    }

    setPendingTextFitAction(request);
  };

  const isPreparingRenderText = Boolean(pendingTextFitAction);

  const finishFooter = (
    <div className="sticky-action-bar">
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onReset}
        title="Очистить текущий flow и перейти к следующей ссылке"
      >
        Новый чат
      </button>
      <button type="button" className="btn btn-secondary" onClick={onExport} disabled={!sourceUrl}>
        Экспорт JSON
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => startTextFitAction("render")}
        disabled={!sourceUrl || isRendering || isPreparingRenderText}
        aria-busy={isRendering || isPreparingRenderText}
      >
        {pendingTextFitAction?.kind === "render"
          ? "Подготавливаю текст..."
          : renderState === "queued"
            ? "В очереди..."
            : isRendering
              ? "Рендер..."
              : "Рендер"}
      </button>
    </div>
  );

  const editorFooter = (
    <div className="sticky-action-bar">
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onReset}
        title="Очистить текущий flow и перейти к следующей ссылке"
      >
        Новый чат
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setStage3Mode("finish")}>
        Назад к финализации
      </button>
    </div>
  );

  const leftFooter = isFinishMode ? finishFooter : editorFooter;

  return (
    <>
      <StepWorkspace
        editLabel={isFinishMode ? "Финал" : "Редактор"}
        previewLabel="Предпросмотр"
        previewViewportHeight
        leftFooter={leftFooter}
        left={
          <div className="step-panel-stack">
            <header className="step-head">
              <p className="kicker">Шаг 3</p>
              <h2>{isFinishMode ? "Финализация" : "Редактор"}</h2>
              <p>
                {isFinishMode
                  ? "Проверьте итоговый текст, фон и звук, затем отрендерите mp4 из выбранной версии."
                  : "Ручной монтаж тайминга и камеры. Вернитесь в финализацию, когда кадр и движение готовы."}
              </p>
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

            <section className="control-card control-card-priority stage3-surface-card">
              <div className="control-section-head">
                <div>
                  <h3>{isFinishMode ? "Финал" : "Ручной редактор"}</h3>
                  <p className="subtle-text">
                    {isFinishMode
                      ? "Основной путь: финальный TOP/BOTTOM, звук, фон, версии и экспорт."
                      : "Здесь живут только тайминг и камера: fragments, фокус, zoom и keyframes."}
                  </p>
                </div>
                <div className="stage3-surface-switch" role="tablist" aria-label="Режим Step 3">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isFinishMode}
                    className={`stage3-surface-tab ${isFinishMode ? "active" : ""}`}
                    onClick={() => setStage3Mode("finish")}
                  >
                    Финал
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!isFinishMode}
                    className={`stage3-surface-tab ${!isFinishMode ? "active" : ""}`}
                    onClick={() => setStage3Mode("editor")}
                  >
                    Редактор
                  </button>
                </div>
              </div>

              <div className="editing-status-row">
                {isFinishMode ? (
                  <>
                    {selectedCaptionOption ? (
                      <span className="meta-pill">Stage 2 option {selectedCaptionOption}</span>
                    ) : (
                      <span className="meta-pill">Финальный текст вручную</span>
                    )}
                    <span className={`meta-pill ${hasManualCaptionOverride ? "warn" : ""}`}>
                      {hasManualCaptionOverride ? "Используется manual draft" : "Без ручных переопределений"}
                    </span>
                    <span className="meta-pill">Фон {backgroundModeLabel}</span>
                    <span className="meta-pill">Звук {audioModeLabel}</span>
                  </>
                ) : (
                  <>
                    <span className="meta-pill">
                      {normalizedSegments.length > 0
                        ? `Курсор ${formatTimeSec(localClipStartSec)}`
                        : `Старт ${formatTimeSec(localClipStartSec)}`}
                    </span>
                    <span className="meta-pill">{manualTimingLabel}</span>
                    <span className="meta-pill">Фокус {cameraFocusPercent}%</span>
                    <span className="meta-pill">Камера {cameraModeLabel}</span>
                    <span className="meta-pill">Зум {editorZoomLabel}</span>
                  </>
                )}
              </div>

              <div className="stage3-surface-actions">
                <p className="subtle-text">
                  {isFinishMode
                    ? "Открывайте редактор только когда нужно вручную подвинуть тайминг или нарисовать движение камеры."
                    : "Фон, музыка, текст и export остаются в режиме финализации."}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setStage3Mode(isFinishMode ? "editor" : "finish")}
                >
                  {isFinishMode ? "Открыть редактор" : "Назад к финализации"}
                </button>
              </div>
            </section>

            <section className="control-card stage3-publish-card">
              <div className="control-section-head">
                <div>
                  <h3>Публикация</h3>
                  <p className="subtle-text">
                    После успешного render сервер создаёт или обновляет queued-публикацию для этого ролика.
                  </p>
                </div>
                <button type="button" className="btn btn-secondary" onClick={onOpenPlanner}>
                  Открыть planner
                </button>
              </div>

              {publication ? (
                <div className="publishing-inline-summary">
                  <div className="editing-status-row">
                    <span className={`meta-pill ${publication.status === "scheduled" ? "ok" : publication.status === "failed" ? "warn" : ""}`}>
                      {formatPublicationStatus(publication.status)}
                    </span>
                    <span className="meta-pill">{formatDateShort(publication.scheduledAt)}</span>
                    {publication.needsReview ? <span className="meta-pill warn">needs review</span> : null}
                  </div>
                  <p className="publishing-inline-title">{publication.title}</p>
                  {publication.description ? <p className="subtle-text publishing-inline-description">{publication.description}</p> : null}
                  {publication.tags.length > 0 ? (
                    <div className="publishing-tag-row">
                      {publication.tags.map((tag) => (
                        <span key={`${publication.id}:${tag}`} className="meta-pill">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {publication.lastError ? <p className="danger-text subtle-text">{publication.lastError}</p> : null}
                </div>
              ) : (
                <p className="subtle-text">
                  Здесь появится draft публикации после первого успешного render, если для канала включён auto-queue.
                </p>
              )}
            </section>

            {isFinishMode ? (
              <>
                <section className="control-card control-card-priority stage3-caption-editor-card">
                  <div className="control-section-head">
                    <div>
                      <h3>Финальный текст</h3>
                      <p className="subtle-text">
                        Здесь редактируется итоговый TOP/BOTTOM, который реально уйдет в preview и render.
                      </p>
                    </div>
                    <div className="editing-status-row">
                      <span className="meta-pill">TOP: {topTextSourceLabel}</span>
                      <span className="meta-pill">BOTTOM: {bottomTextSourceLabel}</span>
                      {selectedCaptionSource ? (
                        <span className="subtle-text">База сейчас: option {selectedCaptionSource.option}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="stage3-caption-editor-grid">
                    <label className="field-stack">
                      <span className="field-label">TOP</span>
                      <textarea
                        className="text-area stage3-caption-textarea"
                        rows={4}
                        value={topText}
                        onChange={(event) => onTopTextChange(event.target.value)}
                        placeholder="Финальный TOP для рендера"
                      />
                    </label>
                    <label className="field-stack">
                      <span className="field-label">BOTTOM</span>
                      <textarea
                        className="text-area stage3-caption-textarea"
                        rows={4}
                        value={bottomText}
                        onChange={(event) => onBottomTextChange(event.target.value)}
                        placeholder="Финальный BOTTOM для рендера"
                      />
                    </label>
                  </div>

                  <div className="control-actions stage3-caption-editor-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onResetCaptionText("all")}
                      disabled={!handoffSummary?.canResetToSelectedCaption}
                    >
                      Сбросить к выбранному варианту
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => onResetCaptionText("top")}
                      disabled={!selectedCaptionSource || handoffSummary?.topText === selectedCaptionSource.top}
                    >
                      Сбросить TOP
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => onResetCaptionText("bottom")}
                      disabled={!selectedCaptionSource || handoffSummary?.bottomText === selectedCaptionSource.bottom}
                    >
                      Сбросить BOTTOM
                    </button>
                  </div>

                  {captionSources.length > 0 ? (
                    <div className="stage3-caption-source-list">
                      {captionSources.map((option) => {
                        const isSelectedSource = option.option === selectedCaptionOption;
                        return (
                          <article
                            key={`stage3-caption-source-${option.option}`}
                            className={`stage3-caption-source-card ${isSelectedSource ? "selected" : ""}`}
                          >
                            <div className="stage3-caption-source-head">
                              <div className="option-title-row">
                                <strong>Option {option.option}</strong>
                                {isSelectedSource ? <span className="badge muted">Выбран</span> : null}
                              </div>
                              <div className="stage3-caption-source-actions">
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => onApplyCaptionSource(option.option, "all")}
                                >
                                  Взять всё
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() => onApplyCaptionSource(option.option, "top")}
                                >
                                  Взять TOP
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() => onApplyCaptionSource(option.option, "bottom")}
                                >
                                  Взять BOTTOM
                                </button>
                              </div>
                            </div>
                            <p className="subtle-text">TOP: {truncateCaptionPreview(option.top)}</p>
                            <p className="subtle-text">BOTTOM: {truncateCaptionPreview(option.bottom)}</p>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="subtle-text">
                      Источник вариантов Stage 2 пока недоступен. Редактор всё равно работает по текущему draft.
                    </p>
                  )}
                </section>

                <section className="control-card">
                  <div className="control-section-head">
                    <div>
                      <h3>Типографика</h3>
                      <p className="subtle-text">
                        Масштаб текста применяется к финальному preview и render, без ручного монтажа камеры.
                      </p>
                    </div>
                  </div>

                  <div className="quick-edit-grid">
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
                        min={STAGE3_TEXT_SCALE_UI_MIN}
                        max={STAGE3_TEXT_SCALE_UI_MAX}
                        step={0.01}
                        value={localTopFontScale}
                        onChange={(event) => scheduleTopFontScaleCommit(Number.parseFloat(event.target.value))}
                        onMouseUp={() => flushTopFontScaleCommit(localTopFontScale)}
                        onTouchEnd={() => flushTopFontScaleCommit(localTopFontScale)}
                        onBlur={() => flushTopFontScaleCommit(localTopFontScale)}
                      />
                      <div className="preset-row">
                        {STAGE3_TEXT_SCALE_UI_PRESETS.map((value) => (
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
                        min={STAGE3_TEXT_SCALE_UI_MIN}
                        max={STAGE3_TEXT_SCALE_UI_MAX}
                        step={0.01}
                        value={localBottomFontScale}
                        onChange={(event) => scheduleBottomFontScaleCommit(Number.parseFloat(event.target.value))}
                        onMouseUp={() => flushBottomFontScaleCommit(localBottomFontScale)}
                        onTouchEnd={() => flushBottomFontScaleCommit(localBottomFontScale)}
                        onBlur={() => flushBottomFontScaleCommit(localBottomFontScale)}
                      />
                      <div className="preset-row">
                        {STAGE3_TEXT_SCALE_UI_PRESETS.map((value) => (
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
                      <h3>Фон и звук</h3>
                      <p className="subtle-text">
                        Финальные настройки фона и звука, которые пойдут в экспорт.
                      </p>
                    </div>
                  </div>

                  <div className="asset-grid">
                    <div className="asset-card">
                      <div className="quick-edit-label-row">
                        <span className="field-label">Фон</span>
                        <span className="quick-edit-value">{backgroundModeLabel}</span>
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
                        {backgroundMode === "custom"
                          ? `Кастомный фон: ${(backgroundAssetMimeType ?? "asset").toLowerCase()}`
                          : backgroundMode === "source-blur"
                            ? "Фон по умолчанию: blur исходного видео."
                            : backgroundMode === "built-in"
                              ? "Сейчас используется встроенный backdrop шаблона."
                              : "Источник фона недоступен, используется fallback."}
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
              </>
            ) : (
              <section className="control-card control-card-priority">
                <div className="control-section-head">
                  <div>
                    <h3>Тайминг и камера</h3>
                    <p className="subtle-text">
                      Здесь живут только ручные правки кадра и длительности: fragments, focus, zoom и keyframes.
                    </p>
                  </div>
                  <div className="editing-status-row">
                    <span className="meta-pill">
                      {normalizedSegments.length > 0 ? `Курсор ${formatTimeSec(localClipStartSec)}` : `Старт ${formatTimeSec(localClipStartSec)}`}
                    </span>
                    <span className="meta-pill">{manualTimingLabel}</span>
                    <span className="meta-pill">Фокус {cameraFocusPercent}%</span>
                    <span className="meta-pill">Камера {cameraModeLabel}</span>
                    <span className="meta-pill">Зум {editorZoomLabel}</span>
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
                        {selectedPositionKeyframe ? "Position Y выбранной точки" : "Базовый Position Y"}
                      </label>
                      <span className="quick-edit-value">{cameraFocusPercent}%</span>
                    </div>
                    <input
                      id="focusRange"
                      type="range"
                      min={0.12}
                      max={0.88}
                      step={0.01}
                      value={selectedPositionKeyframe?.focusY ?? localFocusY}
                      onChange={(event) => scheduleFocusValue(Number.parseFloat(event.target.value))}
                      onMouseUp={() => flushFocusValue(selectedPositionKeyframe?.focusY ?? localFocusY)}
                      onTouchEnd={() => flushFocusValue(selectedPositionKeyframe?.focusY ?? localFocusY)}
                      onBlur={() => flushFocusValue(selectedPositionKeyframe?.focusY ?? localFocusY)}
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
                      <span className="field-label">Камера</span>
                      <span className="quick-edit-value">{cameraModeLabel}</span>
                    </div>
                    <div className="preset-row">
                      <button type="button" className="preset-chip" onClick={clearCameraTracks}>
                        Очистить
                      </button>
                    </div>
                    <div className="preset-row">
                      <button type="button" className="preset-chip" onClick={() => applyCameraMotionPreset("top_to_bottom")}>
                        Пресет сверху вниз
                      </button>
                      <button type="button" className="preset-chip" onClick={() => applyCameraMotionPreset("bottom_to_top")}>
                        Пресет снизу вверх
                      </button>
                    </div>
                    <div className="preset-row">
                      <button type="button" className="preset-chip" onClick={() => applyZoomPreset("in")}>
                        Пресет zoom in
                      </button>
                      <button type="button" className="preset-chip" onClick={() => applyZoomPreset("out")}>
                        Пресет zoom out
                      </button>
                    </div>
                    <p className="subtle-text">
                      Поставьте playhead в нужный момент, нажмите ромб у свойства и меняйте Position Y или Scale отдельно.
                    </p>
                  </div>

                  <div className="quick-edit-card">
                    <div className="quick-edit-label-row">
                      <span className="field-label">Position Y</span>
                      <span className="quick-edit-value">{formatTrackCountLabel(normalizedLocalPositionKeyframes.length)}</span>
                    </div>
                    <div className="preset-row">
                      <button type="button" className="preset-chip" onClick={() => jumpToNeighborPositionKeyframe("prev")}>
                        ← Prev
                      </button>
                      <button type="button" className="preset-chip" onClick={togglePositionKeyframeAtPlayhead}>
                        {positionKeyframeAtPlayhead ? "◇ Удалить" : "◆ Ромб"}
                      </button>
                      <button type="button" className="preset-chip" onClick={() => jumpToNeighborPositionKeyframe("next")}>
                        Next →
                      </button>
                      <button
                        type="button"
                        className="preset-chip"
                        onClick={removeSelectedPositionKeyframe}
                        disabled={!selectedPositionKeyframe}
                      >
                        Удалить выбранную
                      </button>
                    </div>
                    {selectedPositionKeyframe ? (
                      <div className="field-stack">
                        <span className="field-label">Время выбранной точки Position Y</span>
                        <input
                          type="range"
                          min={0}
                          max={clipDurationSec}
                          step={0.01}
                          value={selectedPositionKeyframe.timeSec}
                          onChange={(event) =>
                            handlePositionKeyframeTimeChange(
                              selectedPositionKeyframe.id,
                              Number.parseFloat(event.target.value)
                            )
                          }
                        />
                        <span className="subtle-text">{formatTimeSec(selectedPositionKeyframe.timeSec)}</span>
                      </div>
                    ) : (
                      <p className="subtle-text">
                        Drag в preview меняет `Position Y` выбранной точки, а если точка не выбрана, базовую позицию.
                      </p>
                    )}
                    <p className="subtle-text">Стоп делается двумя соседними точками с одинаковым Y.</p>
                  </div>

                  <div className="quick-edit-card slider-field">
                    <div className="quick-edit-label-row">
                      <label className="field-label" htmlFor="videoZoomRange">
                        {selectedScaleKeyframe ? "Scale выбранной точки" : "Базовый масштаб видео"}
                      </label>
                      <span className="quick-edit-value">{editorZoomLabel}</span>
                    </div>
                    <input
                      id="videoZoomRange"
                      type="range"
                      min={1}
                      max={STAGE3_MAX_VIDEO_ZOOM}
                      step={0.01}
                      value={selectedScaleKeyframe?.zoom ?? localVideoZoom}
                      onChange={(event) => scheduleZoomValue(Number.parseFloat(event.target.value))}
                      onMouseUp={() => flushZoomValue(selectedScaleKeyframe?.zoom ?? localVideoZoom)}
                      onTouchEnd={() => flushZoomValue(selectedScaleKeyframe?.zoom ?? localVideoZoom)}
                      onBlur={() => flushZoomValue(selectedScaleKeyframe?.zoom ?? localVideoZoom)}
                    />
                    <div className="preset-row">
                      <button type="button" className="preset-chip" onClick={() => jumpToNeighborScaleKeyframe("prev")}>
                        ← Prev
                      </button>
                      <button type="button" className="preset-chip" onClick={toggleScaleKeyframeAtPlayhead}>
                        {scaleKeyframeAtPlayhead ? "◇ Удалить" : "◆ Ромб"}
                      </button>
                      <button type="button" className="preset-chip" onClick={() => jumpToNeighborScaleKeyframe("next")}>
                        Next →
                      </button>
                      <button
                        type="button"
                        className="preset-chip"
                        onClick={removeSelectedScaleKeyframe}
                        disabled={!selectedScaleKeyframe}
                      >
                        Удалить выбранную
                      </button>
                    </div>
                    {selectedScaleKeyframe ? (
                      <div className="field-stack">
                        <span className="field-label">Время выбранной точки Scale</span>
                        <input
                          type="range"
                          min={0}
                          max={clipDurationSec}
                          step={0.01}
                          value={selectedScaleKeyframe.timeSec}
                          onChange={(event) =>
                            handleScaleKeyframeTimeChange(
                              selectedScaleKeyframe.id,
                              Number.parseFloat(event.target.value)
                            )
                          }
                        />
                        <span className="subtle-text">{formatTimeSec(selectedScaleKeyframe.timeSec)}</span>
                      </div>
                    ) : null}
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
                    <p className="subtle-text">Стоп по масштабу делается двумя соседними точками с одинаковым Scale.</p>
                  </div>
                </div>
              </section>
            )}
          </div>
        }
        right={
          <Stage3LivePreviewPanel
            editorMode={!isFinishMode}
            templateId={templateId}
            channelName={channelName}
            channelUsername={channelUsername}
            avatarUrl={avatarUrl}
            previewVideoUrl={previewVideoUrl}
            accuratePreviewVideoUrl={accuratePreviewVideoUrl}
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
            accuratePreviewState={accuratePreviewState}
            accuratePreviewNotice={accuratePreviewNotice}
            previewTemplateSnapshot={previewTemplateSnapshot}
            onMeasuredTextFitChange={handlePreviewMeasuredTextFitChange}
            clipStartSec={localClipStartSec}
            clipDurationSec={clipDurationSec}
            sourceDurationSec={sourceDurationSec}
            segments={normalizedSegments}
            timingMode={timingMode}
            renderPolicy={renderPolicy}
            focusY={localFocusY}
            cameraMotion={cameraMotion}
            cameraKeyframes={cameraKeyframes}
            cameraPositionKeyframes={normalizedLocalPositionKeyframes}
            cameraScaleKeyframes={normalizedLocalScaleKeyframes}
            mirrorEnabled={mirrorEnabled}
            videoZoom={previewVideoZoom}
            topFontScale={localTopFontScale}
            bottomFontScale={localBottomFontScale}
            sourceAudioEnabled={sourceAudioEnabled}
            templateConfig={templateConfig}
            selectedPositionKeyframeId={selectedPositionKeyframeId}
            selectedScaleKeyframeId={selectedScaleKeyframeId}
            requestedTimelineSec={requestedTimelineSec}
            onRequestedTimelineHandled={() => setRequestedTimelineSec(null)}
            onSelectVersionId={onSelectVersionId}
            onSelectPassIndex={onSelectPassIndex}
            onTimelineSecChange={(value) => {
              previewTimelineSecRef.current = value;
            }}
            onSelectPositionKeyframeId={setSelectedPositionKeyframeId}
            onSelectScaleKeyframeId={setSelectedScaleKeyframeId}
            onPositionKeyframeTimeChange={handlePositionKeyframeTimeChange}
            onScaleKeyframeTimeChange={handleScaleKeyframeTimeChange}
            onCameraPreviewFocusChange={handleCameraPreviewFocusChange}
          />
        }
      />
      {workerSetupModal}
    </>
  );
}
