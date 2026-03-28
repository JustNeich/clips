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
  buildStage3PlaybackTimingKey,
  buildStage3PlaybackPlan,
  mapStage3SourceTimeToOutputTime,
  resolveStage3PlaybackPosition,
  resolveStage3PlaybackTransformState
} from "../../lib/stage3-preview-playback";
import {
  normalizeStage3SegmentFocusOverride,
  normalizeStage3SegmentMirrorOverride,
  normalizeStage3SegmentZoomOverride,
  resolveStage3SegmentTransformState
} from "../../lib/stage3-segment-transforms";
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
  onSurfaceModeChange?: (mode: Stage3SurfaceMode) => void;
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
type FragmentDraftField = "startSec" | "endSec" | "speed" | "focusY" | "videoZoom";
type FragmentDraftInputs = {
  startSec: string;
  endSec: string;
  focusY: string;
  videoZoom: string;
};
type FragmentFocusTarget = {
  rowKey: string;
  field: FragmentDraftField;
};
type FragmentTimelineDragMode = "move" | "resize-start" | "resize-end";
type FragmentTimelineDragState =
  | {
      target: "fragment";
      index: number;
      mode: FragmentTimelineDragMode;
      startSec: number;
      endSec: number;
      durationSec: number;
      speed: Stage3Segment["speed"];
      pointerOffsetSec: number;
    }
  | {
      target: "window";
      startSec: number;
      endSec: number;
      durationSec: number;
      pointerOffsetSec: number;
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
    timeZone: "Europe/Moscow",
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

function formatFragmentFocusPercent(value: number): string {
  return String(Math.round(clampStage3FocusY(value) * 100));
}

function formatFragmentVideoZoom(value: number): string {
  return clampStage3CameraZoom(value).toFixed(2);
}

function buildFragmentDraftInputs(params: {
  segment: Stage3Segment;
  sourceDurationSec: number | null;
  fallbackFocusY: number;
  fallbackVideoZoom: number;
}): FragmentDraftInputs {
  const resolvedTransform = resolveStage3SegmentTransformState({
    segment: params.segment,
    fallbackFocusY: params.fallbackFocusY,
    fallbackVideoZoom: params.fallbackVideoZoom,
    fallbackMirrorEnabled: true
  });
  return {
    startSec: params.segment.startSec.toFixed(1),
    endSec: (params.segment.endSec ?? params.sourceDurationSec ?? params.segment.startSec + 0.5).toFixed(1),
    focusY: formatFragmentFocusPercent(resolvedTransform.focusY),
    videoZoom: formatFragmentVideoZoom(resolvedTransform.videoZoom)
  };
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
            : `Фрагмент ${index + 1}`,
        focusY: normalizeStage3SegmentFocusOverride(segment.focusY),
        videoZoom: normalizeStage3SegmentZoomOverride(segment.videoZoom),
        mirrorEnabled: normalizeStage3SegmentMirrorOverride(segment.mirrorEnabled)
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

function sumSegmentCoverageDuration(segments: Stage3Segment[], sourceDurationSec: number | null): number {
  const normalized = normalizeEditorSegments(segments, sourceDurationSec);
  if (!normalized.length) {
    return 0;
  }

  let total = 0;
  let cursorStart = normalized[0].startSec;
  let cursorEnd = normalized[0].endSec ?? sourceDurationSec ?? normalized[0].startSec;

  for (const segment of normalized.slice(1)) {
    const segmentEnd = segment.endSec ?? sourceDurationSec ?? segment.startSec;
    if (segment.startSec <= cursorEnd + 0.001) {
      cursorEnd = Math.max(cursorEnd, segmentEnd);
      continue;
    }
    total += Math.max(0, cursorEnd - cursorStart);
    cursorStart = segment.startSec;
    cursorEnd = segmentEnd;
  }

  return total + Math.max(0, cursorEnd - cursorStart);
}

function buildFragmentRowKey(index: number, segment: Stage3Segment): string {
  return `${index}:${segment.startSec}:${segment.endSec ?? "end"}:${segment.speed}`;
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
  playbackTimingKey,
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
  playbackTimingKey: string;
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
  const playbackPlanRef = useRef(playbackPlan);

  useEffect(() => {
    // Keep transport math current without treating transform-only overrides as a new playback session.
    playbackPlanRef.current = playbackPlan;
  }, [playbackPlan]);

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
      const position = resolveStage3PlaybackPosition(playbackPlanRef.current, outputSec);
      if (!position) {
        return null;
      }
      activeSegmentIndexRef.current = position.segmentIndex;
      lastPublishedOutputRef.current = position.outputTimeSec;
      applyStage3PlaybackPositionToVideo(video, position, toleranceSec);
      onPositionChange?.(position.outputTimeSec, position.sourceTimeSec);
      return position;
    },
    [mediaMode, onPositionChange, playbackDurationSec, videoRef]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const seekToPlaybackAnchor = () => {
      const mediaDurationSec =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      onSourceDurationChange?.(mediaDurationSec);
      const anchorOutputSec = clamp(lastPublishedOutputRef.current, 0, playbackDurationSec);
      const initialPosition = seekToOutputTime(anchorOutputSec, 0);
      if (isPlaying) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
      if (!initialPosition) {
        video.currentTime = anchorOutputSec;
        onPositionChange?.(anchorOutputSec, anchorOutputSec);
      }
    };

    if (video.readyState >= 1) {
      seekToPlaybackAnchor();
      return;
    }

    video.addEventListener("loadedmetadata", seekToPlaybackAnchor, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", seekToPlaybackAnchor);
    };
  }, [
    isPlaying,
    mediaMode,
    onPositionChange,
    onSourceDurationChange,
    playbackDurationSec,
    playbackTimingKey,
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
    const currentPlaybackPlan = playbackPlanRef.current;
    const segment =
      currentPlaybackPlan.segments[activeSegmentIndexRef.current] ?? currentPlaybackPlan.segments[0];
    if (!segment) {
      return false;
    }
    const currentTime = video.currentTime;
    const transitionThresholdSec = 0.02;

    if (currentTime >= segment.sourceEndSec - transitionThresholdSec) {
      const nextSegment = currentPlaybackPlan.segments[activeSegmentIndexRef.current + 1];
      if (nextSegment) {
        const nextPosition = resolveStage3PlaybackPosition(currentPlaybackPlan, nextSegment.outputStartSec);
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
  onSourceDurationResolved?: (sec: number | null) => void;
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
  onSourceDurationResolved,
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

  const handleSourceDurationChange = useCallback(
    (sec: number | null) => {
      setProxySourceDurationSec(sec);
      onSourceDurationResolved?.(sec);
    },
    [onSourceDurationResolved]
  );

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
  // Preview transport should react only to timing changes, not per-fragment framing overrides.
  const playbackTimingKey = useMemo(() => buildStage3PlaybackTimingKey(playbackPlan), [playbackPlan]);
  const layoutScale = fitScale * previewScaleMultiplier;
  const playbackTransformState = useMemo(
    () =>
      resolveStage3PlaybackTransformState({
        plan: playbackPlan,
        outputTimeSec: timelineSec,
        fallbackFocusY: focusY,
        fallbackVideoZoom: videoZoom,
        fallbackMirrorEnabled: mirrorEnabled
      }),
    [focusY, mirrorEnabled, playbackPlan, timelineSec, videoZoom]
  );
  const cameraState = useMemo(
    () =>
      resolveCameraStateAtTime({
        timeSec: timelineSec,
        cameraPositionKeyframes,
        cameraScaleKeyframes,
        cameraKeyframes,
        cameraMotion,
        clipDurationSec: playbackDurationSec,
        baseFocusY: playbackTransformState.focusY,
        baseZoom: playbackTransformState.videoZoom
      }),
    [
      cameraKeyframes,
      cameraMotion,
      cameraPositionKeyframes,
      cameraScaleKeyframes,
      playbackDurationSec,
      playbackTransformState.focusY,
      playbackTransformState.videoZoom,
      timelineSec
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
  const previewBackgroundMode = backgroundMode;
  const effectivePreviewNotice = !editorMode ? accuratePreviewNotice ?? previewNotice : previewNotice;
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
  }, [activePreviewVideoUrl, backgroundAssetUrl, isPlaying, previewBackgroundMode]);

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
                                  transform: playbackTransformState.mirrorEnabled ? "scaleX(-1)" : undefined,
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
                        playbackTimingKey={playbackTimingKey}
                        mediaMode={activePreviewMediaMode}
                        className="preview-slot-video"
                        objectPosition={objectPosition}
                        videoZoom={cameraState.zoom}
                        mirrorEnabled={playbackTransformState.mirrorEnabled}
                        muted={isMuted || !sourceAudioEnabled}
                        videoRef={slotPreviewRef}
                        isPlaying={isPlaying}
                        loopEnabled={loopEnabled}
                        onPositionChange={handlePreviewPositionChange}
                        onSourceDurationChange={handleSourceDurationChange}
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
                    Position Y · {Math.round(cameraState.focusY * 100)}%
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
  onOpenPlanner = () => undefined,
  onSurfaceModeChange
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
  const [segmentDraftInputs, setSegmentDraftInputs] = useState<Record<string, FragmentDraftInputs>>({});
  const didSimplifyDynamicCameraRef = useRef(false);
  const fragmentFieldRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});
  const fragmentSourceRailRef = useRef<HTMLDivElement | null>(null);
  const fragmentTimelineDragRef = useRef<FragmentTimelineDragState | null>(null);
  const [activeFragmentIndex, setActiveFragmentIndex] = useState<number | null>(null);
  const [isFragmentTimelineDragging, setIsFragmentTimelineDragging] = useState(false);
  const [pendingFragmentFocus, setPendingFragmentFocus] = useState<FragmentFocusTarget | null>(null);
  const [resolvedFragmentSourceDurationSec, setResolvedFragmentSourceDurationSec] = useState<number | null>(
    sourceDurationSec
  );
  const [previewMeasuredFitState, setPreviewMeasuredFitState] = useState<{
    snapshotHash: string;
    fitHash: string;
    fit: Stage3TextFitSnapshot;
    measured: boolean;
  } | null>(null);
  const [pendingTextFitAction, setPendingTextFitAction] = useState<PendingTextFitAction | null>(null);

  useEffect(() => {
    setResolvedFragmentSourceDurationSec(sourceDurationSec);
  }, [sourceDurationSec, sourceUrl]);

  const fragmentSourceDurationSec = sourceDurationSec ?? resolvedFragmentSourceDurationSec;

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
        hasSourceVideo: Boolean(previewVideoUrl || accuratePreviewVideoUrl)
      }),
    [accuratePreviewVideoUrl, backgroundAssetUrl, previewVideoUrl, templateId]
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

  const maxStartSec = Math.max(0, (fragmentSourceDurationSec ?? clipDurationSec) - clipDurationSec);
  const clipEndSec = localClipStartSec + clipDurationSec;
  const normalizedSegments = useMemo(
    () => normalizeEditorSegments(segments, fragmentSourceDurationSec),
    [fragmentSourceDurationSec, segments]
  );
  const explicitSegmentsDurationSec = useMemo(
    () => sumSegmentsDuration(normalizedSegments, fragmentSourceDurationSec),
    [fragmentSourceDurationSec, normalizedSegments]
  );
  const fragmentPlaybackPlan = useMemo(
    () =>
      buildStage3PlaybackPlan({
        segments: normalizedSegments,
        sourceDurationSec: fragmentSourceDurationSec,
        clipStartSec: localClipStartSec,
        clipDurationSec,
        targetDurationSec: clipDurationSec,
        timingMode,
        policy: renderPolicy
      }),
    [clipDurationSec, fragmentSourceDurationSec, localClipStartSec, normalizedSegments, renderPolicy, timingMode]
  );
  const effectiveOutputDurationSec =
    normalizedSegments.length > 0 ? fragmentPlaybackPlan.totalOutputDurationSec : clipDurationSec;
  const sourceSelectionDurationSec = useMemo(
    () => sumSegmentCoverageDuration(normalizedSegments, fragmentSourceDurationSec),
    [fragmentSourceDurationSec, normalizedSegments]
  );
  const playbackPlanSourceDurationSec = useMemo(
    () =>
      fragmentPlaybackPlan.segments.reduce((total, segment) => {
        return total + Math.max(0.05, segment.sourceEndSec - segment.sourceStartSec);
      }, 0),
    [fragmentPlaybackPlan.segments]
  );
  const hasFragmentSourceTimelineData = fragmentSourceDurationSec !== null && fragmentSourceDurationSec > 0;
  const isFragmentTimelineLoading =
    !hasFragmentSourceTimelineData && (Boolean(sourceUrl) || normalizedSegments.length > 0 || compressionEnabled);
  const isPreviewBusy =
    previewState === "debouncing" || previewState === "loading" || previewState === "retrying";
  const isRendering = renderState === "queued" || renderState === "rendering";
  const remainingSegmentsDurationSec = Math.max(0, clipDurationSec - explicitSegmentsDurationSec);
  const normalizationModeLabel = compressionEnabled
    ? fragmentPlaybackPlan.durationScale > 1.02
      ? "Растягиваем до 6с"
      : fragmentPlaybackPlan.durationScale < 0.98
        ? "Сжимаем до 6с"
        : "Ровно 6с"
    : null;
  const sourceDisplayDurationSec =
    normalizedSegments.length > 0
      ? sourceSelectionDurationSec
      : playbackPlanSourceDurationSec > 0
        ? playbackPlanSourceDurationSec
        : clipDurationSec;
  const wholeClipWindowLabel =
    normalizedSegments.length === 0 && renderPolicy === "fixed_segments"
      ? `${formatTimeSec(localClipStartSec)} → ${formatTimeSec(clipEndSec)}`
      : null;
  const sourceCoveragePercent =
    fragmentSourceDurationSec && fragmentSourceDurationSec > 0
      ? clamp((sourceDisplayDurationSec / fragmentSourceDurationSec) * 100, 0, 100)
      : 0;
  const unusedSourceDurationSec =
    fragmentSourceDurationSec !== null ? Math.max(0, fragmentSourceDurationSec - sourceDisplayDurationSec) : null;
  const sourceTimelineRanges = useMemo(() => {
    if (fragmentSourceDurationSec === null || fragmentSourceDurationSec <= 0) {
      return [];
    }
    const baseRanges =
      normalizedSegments.length > 0
        ? normalizedSegments.map((segment) => ({
            startSec: segment.startSec,
            endSec: segment.endSec ?? fragmentSourceDurationSec ?? segment.startSec + 0.5
          }))
        : fragmentPlaybackPlan.segments.length > 0
          ? fragmentPlaybackPlan.segments.map((segment) => ({
              startSec: segment.sourceStartSec,
              endSec: segment.sourceEndSec
            }))
          : [
              {
                startSec: localClipStartSec,
                endSec: clipEndSec
              }
            ];
    if (!baseRanges.length) {
      return [];
    }

    const normalizedRanges = baseRanges
      .map((range) => {
        const startSec = clamp(range.startSec, 0, fragmentSourceDurationSec ?? range.startSec);
        const endSec = clamp(
          range.endSec,
          startSec + 0.1,
          fragmentSourceDurationSec ?? Math.max(startSec + 0.1, range.endSec)
        );
        return { startSec, endSec };
      })
      .sort((left, right) => left.startSec - right.startSec);

    if (!normalizedRanges.length) {
      return [];
    }

    const merged: Array<{ startSec: number; endSec: number }> = [];
    for (const range of normalizedRanges) {
      const lastRange = merged[merged.length - 1];
      if (lastRange && range.startSec <= lastRange.endSec + 0.001) {
        lastRange.endSec = Math.max(lastRange.endSec, range.endSec);
        continue;
      }
      merged.push({ ...range });
    }

    return merged.map((range) => {
      const duration = Math.max(0.1, range.endSec - range.startSec);
      const offsetPercent =
        fragmentSourceDurationSec && fragmentSourceDurationSec > 0
          ? clamp((range.startSec / fragmentSourceDurationSec) * 100, 0, 100)
          : 0;
      const widthPercent =
        fragmentSourceDurationSec && fragmentSourceDurationSec > 0
          ? clamp((duration / fragmentSourceDurationSec) * 100, 1, 100 - offsetPercent)
          : 100;
      return {
        ...range,
        offsetPercent,
        widthPercent
      };
    });
  }, [clipEndSec, fragmentPlaybackPlan.segments, fragmentSourceDurationSec, localClipStartSec, normalizedSegments]);
  const wholeClipWindowRange =
    normalizedSegments.length === 0 && renderPolicy === "fixed_segments" ? sourceTimelineRanges[0] ?? null : null;
  const canDragWholeClipWindow = Boolean(wholeClipWindowRange && maxStartSec > 0 && hasFragmentSourceTimelineData);
  const sourceTimelineScaleMarks = useMemo(() => {
    if (fragmentSourceDurationSec === null || fragmentSourceDurationSec <= 0) {
      return ["0с", "источник"];
    }
    if (fragmentSourceDurationSec <= 6.05) {
      return ["0с", formatTimeSec(fragmentSourceDurationSec)];
    }
    return [
      "0с",
      formatTimeSec(roundToTenth(fragmentSourceDurationSec / 2)),
      formatTimeSec(fragmentSourceDurationSec)
    ];
  }, [fragmentSourceDurationSec]);
  const hasDynamicCameraState =
    cameraMotion !== "disabled" ||
    cameraKeyframes.length > 0 ||
    cameraPositionKeyframes.length > 0 ||
    cameraScaleKeyframes.length > 0;
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
  const cameraModeLabel = "База";
  const cameraFocusPercent = Math.round(localFocusY * 100);
  const isFinishMode = stage3Mode === "finish";
  useEffect(() => {
    onSurfaceModeChange?.(stage3Mode);
  }, [onSurfaceModeChange, stage3Mode]);
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
  const finishTextStatusLabel = hasManualCaptionOverride
    ? "Текст: manual draft"
    : selectedCaptionOption
      ? `Текст: option ${selectedCaptionOption}`
      : "Текст: вручную";
  const manualTimingLabel =
    normalizedSegments.length > 0
      ? `Фрагменты ${normalizedSegments.length} · выход ${formatTimeSec(effectiveOutputDurationSec)}`
      : `Окно ${formatTimeSec(clipDurationSec)}`;
  const editorZoomLabel = `x${localVideoZoom.toFixed(2)}`;
  const nextFragmentSuggestion = useMemo(() => {
    if (!sourceUrl) {
      return null;
    }
    if (!compressionEnabled && remainingSegmentsDurationSec < 0.1) {
      return null;
    }

    const defaultDuration = compressionEnabled
      ? 1
      : Math.min(1, Math.max(0.1, remainingSegmentsDurationSec));
    const lastSegment = normalizedSegments[normalizedSegments.length - 1] ?? null;
    const suggestedStart = lastSegment?.endSec ?? localClipStartSec;
    const sourceMaxStart =
      fragmentSourceDurationSec !== null ? Math.max(0, fragmentSourceDurationSec - 0.1) : suggestedStart;
    const startSec = roundToTenth(clamp(suggestedStart, 0, sourceMaxStart));
    const endSec = roundToTenth(
      clamp(
        startSec + defaultDuration,
        startSec + 0.1,
        fragmentSourceDurationSec ?? startSec + defaultDuration
      )
    );

    return {
      startSec,
      endSec,
      speed: 1 as Stage3Segment["speed"]
    };
  }, [
    compressionEnabled,
    localClipStartSec,
    normalizedSegments,
    remainingSegmentsDurationSec,
    fragmentSourceDurationSec,
    sourceUrl
  ]);
  const canAppendFragment = Boolean(nextFragmentSuggestion);
  const fragmentRows = useMemo(
    () =>
      normalizedSegments.map((segment, index) => {
        const rowKey = buildFragmentRowKey(index, segment);
        const resolvedTransform = resolveStage3SegmentTransformState({
          segment,
          fallbackFocusY: localFocusY,
          fallbackVideoZoom: localVideoZoom,
          fallbackMirrorEnabled: mirrorEnabled
        });
        const draft =
          segmentDraftInputs[rowKey] ??
          buildFragmentDraftInputs({
            segment,
            sourceDurationSec: fragmentSourceDurationSec,
            fallbackFocusY: localFocusY,
            fallbackVideoZoom: localVideoZoom
          });
        const endValue = segment.endSec ?? fragmentSourceDurationSec ?? segment.startSec + 0.5;
        const rawDuration = Math.max(0, endValue - segment.startSec);
        const playbackSegment = fragmentPlaybackPlan.segments[index] ?? null;
        const outputDuration = playbackSegment?.outputDurationSec ?? rawDuration / segment.speed;
        const outputStartSec = playbackSegment?.outputStartSec ?? 0;
        const draftFocusPercent = clamp(
          Number.isFinite(Number.parseFloat(draft.focusY))
            ? Number.parseFloat(draft.focusY)
            : Math.round(resolvedTransform.focusY * 100),
          12,
          88
        );
        const draftVideoZoom = clamp(
          Number.isFinite(Number.parseFloat(draft.videoZoom))
            ? Number.parseFloat(draft.videoZoom)
            : resolvedTransform.videoZoom,
          STAGE3_MIN_VIDEO_ZOOM,
          STAGE3_MAX_VIDEO_ZOOM
        );
        const sourceOffsetPercent =
          fragmentSourceDurationSec && fragmentSourceDurationSec > 0
            ? clamp((segment.startSec / fragmentSourceDurationSec) * 100, 0, 100)
            : 0;
        const sourceWidthPercent =
          fragmentSourceDurationSec && fragmentSourceDurationSec > 0
            ? clamp((rawDuration / fragmentSourceDurationSec) * 100, 1, 100 - sourceOffsetPercent)
            : 0;

        return {
          index,
          rowKey,
          draft,
          endValue,
          rawDuration,
          outputDuration,
          outputStartSec,
          draftFocusPercent,
          draftVideoZoom,
          sourceOffsetPercent,
          sourceWidthPercent,
          resolvedTransform,
          segment
        };
      }),
    [
      fragmentPlaybackPlan.segments,
      fragmentSourceDurationSec,
      localFocusY,
      localVideoZoom,
      mirrorEnabled,
      normalizedSegments,
      segmentDraftInputs
    ]
  );
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
    if (!hasDynamicCameraState) {
      didSimplifyDynamicCameraRef.current = false;
      return;
    }
    if (didSimplifyDynamicCameraRef.current) {
      return;
    }

    didSimplifyDynamicCameraRef.current = true;
    setSelectedPositionKeyframeId(null);
    setSelectedScaleKeyframeId(null);
    setLocalPositionKeyframes([]);
    setLocalScaleKeyframes([]);
    onCameraPositionKeyframesChange([]);
    onCameraScaleKeyframesChange([]);
  }, [
    hasDynamicCameraState,
    onCameraPositionKeyframesChange,
    onCameraScaleKeyframesChange
  ]);

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
      const next: Record<string, FragmentDraftInputs> = {};
      let changed = false;
      normalizedSegments.forEach((segment, index) => {
        const key = buildFragmentRowKey(index, segment);
        const fallbackDraft = buildFragmentDraftInputs({
          segment,
          sourceDurationSec: fragmentSourceDurationSec,
          fallbackFocusY: localFocusY,
          fallbackVideoZoom: localVideoZoom
        });
        next[key] = prev[key] ?? fallbackDraft;
        if (!prev[key] || JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
          changed = true;
        }
      });
      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev;
      }
      return next;
    });
  }, [fragmentSourceDurationSec, localFocusY, localVideoZoom, normalizedSegments]);

  useEffect(() => {
    if (activeFragmentIndex === null) {
      return;
    }
    if (fragmentRows.length === 0) {
      setActiveFragmentIndex(null);
      return;
    }
    if (activeFragmentIndex < fragmentRows.length) {
      return;
    }
    setActiveFragmentIndex(fragmentRows.length - 1);
  }, [activeFragmentIndex, fragmentRows]);

  useEffect(() => {
    if (!pendingFragmentFocus) {
      return;
    }

    const target = fragmentFieldRefs.current[`${pendingFragmentFocus.rowKey}:${pendingFragmentFocus.field}`];
    if (!target) {
      return;
    }

    target.focus();
    if (
      target instanceof HTMLInputElement &&
      ["text", "search", "tel", "url", "password"].includes(target.type)
    ) {
      const caretPosition = target.value.length;
      window.requestAnimationFrame(() => {
        target.setSelectionRange(caretPosition, caretPosition);
      });
    }
    setPendingFragmentFocus(null);
  }, [fragmentRows, pendingFragmentFocus]);

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

  const flushClipCommit = useCallback(
    (value: number) => {
      if (clipCommitTimerRef.current !== null) {
        window.clearTimeout(clipCommitTimerRef.current);
        clipCommitTimerRef.current = null;
      }
      onClipStartChange(clamp(value, 0, maxStartSec));
    },
    [maxStartSec, onClipStartChange]
  );

  const flushFocusCommit = (value: number) => {
    if (focusCommitTimerRef.current !== null) {
      window.clearTimeout(focusCommitTimerRef.current);
      focusCommitTimerRef.current = null;
    }
    onFocusYChange(clamp(value, 0.12, 0.88));
  };

  const scheduleClipCommit = useCallback(
    (value: number) => {
      const next = clamp(value, 0, maxStartSec);
      setLocalClipStartSec(next);
      if (clipCommitTimerRef.current !== null) {
        window.clearTimeout(clipCommitTimerRef.current);
      }
      clipCommitTimerRef.current = window.setTimeout(() => {
        onClipStartChange(next);
        clipCommitTimerRef.current = null;
      }, 450);
    },
    [maxStartSec, onClipStartChange]
  );

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
    const fragmentOverrides = commitPendingFragmentDrafts();
    const overrides: Stage3EditorDraftOverrides = {
      clipStartSec: clamp(localClipStartSec, 0, maxStartSec),
      focusY: clampStage3FocusY(localFocusY),
      videoZoom: clampStage3CameraZoom(localVideoZoom),
      cameraKeyframes: [],
      cameraPositionKeyframes: [],
      cameraScaleKeyframes: [],
      segments: fragmentOverrides.segments,
      timingMode: fragmentOverrides.timingMode,
      renderPolicy: fragmentOverrides.renderPolicy,
      normalizeToTargetEnabled: fragmentOverrides.normalizeToTargetEnabled,
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
    scheduleFocusCommit(next);
  };

  const flushFocusValue = (value: number) => {
    const next = clampStage3FocusY(value);
    flushFocusCommit(next);
  };

  const scheduleZoomValue = (value: number) => {
    const next = clampStage3CameraZoom(value);
    scheduleVideoZoomCommit(next);
  };

  const flushZoomValue = (value: number) => {
    const next = clampStage3CameraZoom(value);
    flushVideoZoomCommit(next);
  };

  const applyFocusImmediate = (value: number) => {
    const next = clampStage3FocusY(value);
    setLocalFocusY(next);
    flushFocusCommit(next);
  };

  const applyVideoZoomImmediate = (value: number) => {
    const next = clampStage3CameraZoom(value);
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
      const normalized = normalizeEditorSegments(nextSegments, fragmentSourceDurationSec);
      const bounded = nextCompressionEnabled
        ? normalized
        : trimSegmentsToDuration(normalized, clipDurationSec, fragmentSourceDurationSec);
      onFragmentStateChange({
        segments: bounded,
        compressionEnabled: nextCompressionEnabled
      });
    },
    [clipDurationSec, compressionEnabled, fragmentSourceDurationSec, onFragmentStateChange]
  );

  const buildCommittedSegmentsFromDrafts = useCallback((): Stage3Segment[] => {
    const draftedSegments = normalizedSegments.map((segment, index) => {
      const key = buildFragmentRowKey(index, segment);
      const draft = segmentDraftInputs[key];
      const parsedStart = Number.parseFloat(draft?.startSec ?? "");
      const parsedEnd = Number.parseFloat(draft?.endSec ?? "");
      const parsedFocusPercent = Number.parseFloat(draft?.focusY ?? "");
      const parsedVideoZoom = Number.parseFloat(draft?.videoZoom ?? "");
      const nextStart = roundToTenth(
        clamp(
          Number.isFinite(parsedStart) ? parsedStart : segment.startSec,
          0,
          fragmentSourceDurationSec ?? (Number.isFinite(parsedStart) ? parsedStart : segment.startSec)
        )
      );
      const sourceMaxEnd =
        fragmentSourceDurationSec ??
        (Number.isFinite(parsedEnd) ? parsedEnd : segment.endSec ?? segment.startSec + 0.5);
      const nextEnd = roundToTenth(
        clamp(
          Number.isFinite(parsedEnd) ? parsedEnd : segment.endSec ?? sourceMaxEnd,
          nextStart + 0.1,
          sourceMaxEnd
        )
      );
      return {
        ...segment,
        startSec: nextStart,
        endSec: nextEnd,
        focusY: normalizeStage3SegmentFocusOverride(
          Number.isFinite(parsedFocusPercent) ? parsedFocusPercent / 100 : segment.focusY
        ),
        videoZoom: normalizeStage3SegmentZoomOverride(
          Number.isFinite(parsedVideoZoom) ? parsedVideoZoom : segment.videoZoom
        )
      };
    });

    const normalized = normalizeEditorSegments(draftedSegments, fragmentSourceDurationSec);
    return compressionEnabled
      ? normalized
      : trimSegmentsToDuration(normalized, clipDurationSec, fragmentSourceDurationSec);
  }, [clipDurationSec, compressionEnabled, fragmentSourceDurationSec, normalizedSegments, segmentDraftInputs]);

  const commitPendingFragmentDrafts = useCallback(() => {
    const committedSegments = buildCommittedSegmentsFromDrafts();
    const hasChanges = JSON.stringify(committedSegments) !== JSON.stringify(normalizedSegments);
    const nextTimingMode =
      compressionEnabled
        ? committedSegments.length === 0
          ? "auto"
          : (() => {
              const explicitDurationSec = sumSegmentsDuration(committedSegments, fragmentSourceDurationSec);
              if (explicitDurationSec > clipDurationSec + 0.05) {
                return "compress" as const;
              }
              if (explicitDurationSec < clipDurationSec - 0.05) {
                return "stretch" as const;
              }
              return "auto" as const;
            })()
        : "auto";
    const nextRenderPolicy: Stage3RenderPolicy =
      committedSegments.length > 0 ? "fixed_segments" : compressionEnabled ? "full_source_normalize" : "fixed_segments";

    if (hasChanges) {
      commitFragments(committedSegments, compressionEnabled);
    }

    return {
      segments: committedSegments,
      timingMode: nextTimingMode,
      renderPolicy: nextRenderPolicy,
      normalizeToTargetEnabled: compressionEnabled
    };
  }, [
    buildCommittedSegmentsFromDrafts,
    clipDurationSec,
    commitFragments,
    compressionEnabled,
    normalizedSegments,
    fragmentSourceDurationSec
  ]);

  const appendFragmentFromDraft = useCallback(
    (field: FragmentDraftField, value: string) => {
      if (!nextFragmentSuggestion) {
        return;
      }
      if (field !== "speed" && !Number.isFinite(Number.parseFloat(value))) {
        return;
      }

      const nextSpeed =
        field === "speed"
          ? normalizeSegmentSpeed(Number.parseFloat(value))
          : nextFragmentSuggestion.speed;
      const nextStartInput =
        field === "startSec" ? value : nextFragmentSuggestion.startSec.toFixed(1);
      const nextEndInput = field === "endSec" ? value : nextFragmentSuggestion.endSec.toFixed(1);
      const parsedStart = Number.parseFloat(nextStartInput);
      const parsedEnd = Number.parseFloat(nextEndInput);
      const nextStart = roundToTenth(
        clamp(
          Number.isFinite(parsedStart) ? parsedStart : nextFragmentSuggestion.startSec,
          0,
          fragmentSourceDurationSec ??
            (Number.isFinite(parsedStart) ? parsedStart : nextFragmentSuggestion.startSec)
        )
      );
      const sourceMaxEnd = fragmentSourceDurationSec ?? nextFragmentSuggestion.endSec;
      const maxOwnDuration = compressionEnabled
        ? Number.POSITIVE_INFINITY
        : Math.max(0.1, remainingSegmentsDurationSec * nextSpeed);
      const nextEnd = roundToTenth(
        clamp(
          Number.isFinite(parsedEnd) ? parsedEnd : nextFragmentSuggestion.endSec,
          nextStart + 0.1,
          Math.min(sourceMaxEnd, nextStart + maxOwnDuration)
        )
      );
      const nextSegments = normalizeEditorSegments(
        [
          ...normalizedSegments,
          {
            startSec: nextStart,
            endSec: nextEnd,
            label: `Фрагмент ${normalizedSegments.length + 1}`,
            speed: nextSpeed,
            focusY: localFocusY,
            videoZoom: localVideoZoom,
            mirrorEnabled
          }
        ],
        fragmentSourceDurationSec
      );
      const boundedSegments = compressionEnabled
        ? nextSegments
        : trimSegmentsToDuration(nextSegments, clipDurationSec, fragmentSourceDurationSec);
      const nextIndex = boundedSegments.findIndex(
        (segment) =>
          Math.abs(segment.startSec - nextStart) <= 0.001 &&
          Math.abs((segment.endSec ?? nextEnd) - nextEnd) <= 0.001 &&
          segment.speed === nextSpeed
      );
      const focusedIndex = nextIndex >= 0 ? nextIndex : boundedSegments.length - 1;
      const focusedSegment = boundedSegments[focusedIndex];
      if (!focusedSegment) {
        return;
      }
      const rowKey = buildFragmentRowKey(focusedIndex, focusedSegment);

      setSegmentDraftInputs((prev) => ({
        ...prev,
        [rowKey]: {
          startSec:
            field === "startSec" && value.trim() ? value : focusedSegment.startSec.toFixed(1),
          endSec:
            field === "endSec" && value.trim()
              ? value
              : (focusedSegment.endSec ?? fragmentSourceDurationSec ?? focusedSegment.startSec + 0.5).toFixed(1),
          focusY: formatFragmentFocusPercent(
            normalizeStage3SegmentFocusOverride(focusedSegment.focusY) ?? localFocusY
          ),
          videoZoom: formatFragmentVideoZoom(
            normalizeStage3SegmentZoomOverride(focusedSegment.videoZoom) ?? localVideoZoom
          )
        }
      }));
      setActiveFragmentIndex(focusedIndex);
      setPendingFragmentFocus({
        rowKey,
        field
      });
      commitFragments(boundedSegments);
    },
    [
      clipDurationSec,
      commitFragments,
      compressionEnabled,
      nextFragmentSuggestion,
      normalizedSegments,
      remainingSegmentsDurationSec,
      fragmentSourceDurationSec,
      localFocusY,
      localVideoZoom,
      mirrorEnabled
    ]
  );

  const removeFragment = useCallback(
    (index: number) => {
      const nextSegments = normalizedSegments.filter((_, itemIndex) => itemIndex !== index);
      setActiveFragmentIndex(nextSegments.length > 0 ? Math.min(index, nextSegments.length - 1) : null);
      commitFragments(nextSegments);
    },
    [commitFragments, normalizedSegments]
  );

  const updateFragmentSpeed = useCallback(
    (index: number, speed: Stage3Segment["speed"]) => {
      setActiveFragmentIndex(index);
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

  const updateFragmentTransform = useCallback(
    (
      index: number,
      updates: {
        focusY?: number | null;
        videoZoom?: number | null;
        mirrorEnabled?: boolean | null;
      }
    ) => {
      setActiveFragmentIndex(index);
      commitFragments(
        normalizedSegments.map((segment, itemIndex) =>
          itemIndex === index
            ? {
                ...segment,
                focusY:
                  updates.focusY === undefined
                    ? segment.focusY ?? null
                    : normalizeStage3SegmentFocusOverride(updates.focusY),
                videoZoom:
                  updates.videoZoom === undefined
                    ? segment.videoZoom ?? null
                    : normalizeStage3SegmentZoomOverride(updates.videoZoom),
                mirrorEnabled:
                  updates.mirrorEnabled === undefined
                    ? segment.mirrorEnabled ?? null
                    : normalizeStage3SegmentMirrorOverride(updates.mirrorEnabled)
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
    field: "startSec" | "endSec" | "focusY" | "videoZoom",
    value: string
  ) => {
    const key = buildFragmentRowKey(index, segment);
    setSegmentDraftInputs((prev) => ({
      ...prev,
      [key]: {
        startSec:
          field === "startSec"
            ? value
            : (prev[key]?.startSec ?? segment.startSec.toFixed(1)),
        endSec:
          field === "endSec"
            ? value
            : (prev[key]?.endSec ??
                (segment.endSec ?? fragmentSourceDurationSec ?? segment.startSec + 0.5).toFixed(1)),
        focusY:
          field === "focusY"
            ? value
            : (prev[key]?.focusY ??
                formatFragmentFocusPercent(
                  normalizeStage3SegmentFocusOverride(segment.focusY) ?? localFocusY
                )),
        videoZoom:
          field === "videoZoom"
            ? value
            : (prev[key]?.videoZoom ??
                formatFragmentVideoZoom(
                  normalizeStage3SegmentZoomOverride(segment.videoZoom) ?? localVideoZoom
                ))
      }
    }));
  };

  const commitFragmentDraft = (index: number, segment: Stage3Segment) => {
    const key = buildFragmentRowKey(index, segment);
    const draft = segmentDraftInputs[key];
    if (!draft) {
      return;
    }

    const parsedStart = Number.parseFloat(draft.startSec);
    const parsedEnd = Number.parseFloat(draft.endSec);
    const parsedFocusPercent = Number.parseFloat(draft.focusY);
    const parsedVideoZoom = Number.parseFloat(draft.videoZoom);
    if (
      !Number.isFinite(parsedStart) ||
      !Number.isFinite(parsedEnd) ||
      !Number.isFinite(parsedFocusPercent) ||
      !Number.isFinite(parsedVideoZoom)
    ) {
      setSegmentDraftInputs((prev) => ({
        ...prev,
        [key]: buildFragmentDraftInputs({
          segment,
          sourceDurationSec: fragmentSourceDurationSec,
          fallbackFocusY: localFocusY,
          fallbackVideoZoom: localVideoZoom
        })
      }));
      return;
    }

    const nextStart = roundToTenth(clamp(parsedStart, 0, fragmentSourceDurationSec ?? parsedStart));
    const sourceMaxEnd = fragmentSourceDurationSec ?? parsedEnd;
    const otherSegments = normalizedSegments.filter((_, itemIndex) => itemIndex !== index);
    const otherDuration = sumSegmentsDuration(otherSegments, fragmentSourceDurationSec);
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
            endSec: nextEnd,
            focusY: normalizeStage3SegmentFocusOverride(parsedFocusPercent / 100),
            videoZoom: normalizeStage3SegmentZoomOverride(parsedVideoZoom)
          }
        : item
    );
    const boundedSegments = compressionEnabled
      ? normalizeEditorSegments(nextSegments, fragmentSourceDurationSec)
      : trimSegmentsToDuration(nextSegments, clipDurationSec, fragmentSourceDurationSec);
    const nextIndex = boundedSegments.findIndex(
      (item) =>
        Math.abs(item.startSec - nextStart) <= 0.001 &&
        Math.abs((item.endSec ?? nextEnd) - nextEnd) <= 0.001 &&
        item.speed === segment.speed
    );
    setActiveFragmentIndex(nextIndex >= 0 ? nextIndex : Math.min(index, Math.max(0, boundedSegments.length - 1)));
    commitFragments(boundedSegments);
  };

  const updateFragmentTimelineFromClientX = useCallback(
    (clientX: number, commitMode: "schedule" | "flush" = "schedule") => {
      const dragState = fragmentTimelineDragRef.current;
      const rail = fragmentSourceRailRef.current;
      if (!dragState || !rail || !fragmentSourceDurationSec || fragmentSourceDurationSec <= 0) {
        return;
      }
      const rect = rail.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const pointerRatio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const pointerSec = pointerRatio * fragmentSourceDurationSec;
      if (dragState.target === "window") {
        const nextStart = roundToTenth(
          clamp(pointerSec - dragState.pointerOffsetSec, 0, Math.max(0, fragmentSourceDurationSec - dragState.durationSec))
        );
        setLocalClipStartSec(nextStart);
        if (commitMode === "flush") {
          flushClipCommit(nextStart);
        } else {
          scheduleClipCommit(nextStart);
        }
        return;
      }
      const otherSegments = normalizedSegments.filter((_, itemIndex) => itemIndex !== dragState.index);
      const otherDuration = sumSegmentsDuration(otherSegments, fragmentSourceDurationSec);
      const maxOwnDuration = compressionEnabled
        ? Number.POSITIVE_INFINITY
        : Math.max(0.1, (clipDurationSec - otherDuration) * dragState.speed);

      let nextStart = dragState.startSec;
      let nextEnd = dragState.endSec;

      if (dragState.mode === "move") {
        nextStart = clamp(pointerSec - dragState.pointerOffsetSec, 0, fragmentSourceDurationSec - dragState.durationSec);
        nextEnd = nextStart + dragState.durationSec;
      } else if (dragState.mode === "resize-start") {
        const minStartByDuration = dragState.endSec - maxOwnDuration;
        nextStart = clamp(pointerSec, Math.max(0, minStartByDuration), dragState.endSec - 0.1);
      } else {
        nextEnd = clamp(pointerSec, dragState.startSec + 0.1, fragmentSourceDurationSec);
        nextEnd = Math.min(nextEnd, dragState.startSec + maxOwnDuration);
      }

      nextStart = roundToTenth(nextStart);
      nextEnd = roundToTenth(nextEnd);
      if (nextEnd <= nextStart) {
        nextEnd = roundToTenth(nextStart + 0.1);
      }

      commitFragments(
        normalizedSegments.map((segment, itemIndex) =>
          itemIndex === dragState.index
            ? {
                ...segment,
                startSec: nextStart,
                endSec: nextEnd
              }
            : segment
        )
      );
    },
    [
      clipDurationSec,
      commitFragments,
      compressionEnabled,
      fragmentSourceDurationSec,
      normalizedSegments,
      flushClipCommit,
      scheduleClipCommit
    ]
  );

  useEffect(() => {
    if (!isFragmentTimelineDragging) {
      return;
    }

    const handleMove = (event: PointerEvent) => {
      updateFragmentTimelineFromClientX(event.clientX, "schedule");
    };
    const handleEnd = (event: PointerEvent) => {
      updateFragmentTimelineFromClientX(event.clientX, "flush");
      fragmentTimelineDragRef.current = null;
      setIsFragmentTimelineDragging(false);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [isFragmentTimelineDragging, updateFragmentTimelineFromClientX]);

  const startFragmentTimelineDrag = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      row: (typeof fragmentRows)[number],
      mode: FragmentTimelineDragMode
    ) => {
      if (!fragmentSourceDurationSec || fragmentSourceDurationSec <= 0) {
        return;
      }
      const rail = fragmentSourceRailRef.current;
      if (!rail) {
        return;
      }
      const rect = rail.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pointerRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const pointerSec = pointerRatio * fragmentSourceDurationSec;
      const startSec = row.segment.startSec;
      const endSec = row.endValue;
      setActiveFragmentIndex(row.index);
      fragmentTimelineDragRef.current = {
        target: "fragment",
        index: row.index,
        mode,
        startSec,
        endSec,
        durationSec: Math.max(0.1, endSec - startSec),
        speed: row.segment.speed,
        pointerOffsetSec: clamp(pointerSec - startSec, 0, Math.max(0.1, endSec - startSec))
      };
      setIsFragmentTimelineDragging(true);
    },
    [fragmentSourceDurationSec]
  );

  const startWholeClipWindowDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!fragmentSourceDurationSec || fragmentSourceDurationSec <= 0 || maxStartSec <= 0) {
        return;
      }
      const rail = fragmentSourceRailRef.current;
      if (!rail) {
        return;
      }
      const rect = rail.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pointerRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const pointerSec = pointerRatio * fragmentSourceDurationSec;
      fragmentTimelineDragRef.current = {
        target: "window",
        startSec: localClipStartSec,
        endSec: clipEndSec,
        durationSec: clipDurationSec,
        pointerOffsetSec: clamp(pointerSec - localClipStartSec, 0, clipDurationSec)
      };
      setIsFragmentTimelineDragging(true);
    },
    [clipDurationSec, clipEndSec, fragmentSourceDurationSec, localClipStartSec, maxStartSec]
  );

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

  const finishCaptionEditorCard = (
    <section className="control-card control-card-priority stage3-caption-editor-card">
      <div className="control-section-head">
        <div>
          <h3>Финальный текст</h3>
          <p className="subtle-text">
            Здесь редактируется итоговый TOP/BOTTOM, который реально уйдет в preview и render.
          </p>
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

      <details className="advanced-block">
        <summary>Источники и быстрый mix</summary>
        <div className="advanced-content">
          <div className="editing-status-row">
            <span className="meta-pill">TOP: {topTextSourceLabel}</span>
            <span className="meta-pill">BOTTOM: {bottomTextSourceLabel}</span>
            {selectedCaptionSource ? (
              <span className="subtle-text">База сейчас: option {selectedCaptionSource.option}</span>
            ) : null}
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
        </div>
      </details>
    </section>
  );

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
                  ? "Проверьте итоговый текст и быстро доведите ролик до рендера. Редкие настройки и контекст спрятаны ниже."
                  : "Ручной монтаж тайминга и камеры. Вернитесь в финализацию, когда кадр и движение готовы."}
              </p>
              {showWorkerControls ? (
                <div className="executor-summary-row executor-summary-row-compact">
                  <div className="executor-summary-copy">
                    <span
                      className={`meta-pill ${workerState === "online" ? "ok" : workerState === "busy" ? "warn" : ""}`}
                    >
                      Executor: {workerStatusLabel}
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
              <details className="advanced-block">
                <summary>Контекст шага</summary>
                <div className="advanced-content">
                  <div className="render-meta-strip">
                    <span className="meta-pill">{getStage3DesignLabLabel(templateId)}</span>
                    <span className="meta-pill mono">{templateId}</span>
                    <span className="meta-pill">
                      {channelName} (@{channelUsername})
                    </span>
                    <span className="meta-pill">
                      Исходник {fragmentSourceDurationSec ? formatTimeSec(fragmentSourceDurationSec) : "н/д"}
                    </span>
                    <span className="meta-pill">Версий {displayVersions.length}</span>
                  </div>
                  {showWorkerControls ? (
                    <p className="subtle-text">
                      {workerState === "not_paired"
                        ? "Executor подключается один раз, затем работает в фоне через отдельное окно Terminal или PowerShell."
                        : workerStatusDescription}
                    </p>
                  ) : null}
                </div>
              </details>
            </header>

            <section
              className={`control-card stage3-surface-card ${isFinishMode ? "control-card-priority" : "stage3-surface-card-compact"}`}
            >
              <div className={`control-section-head ${isFinishMode ? "" : "stage3-surface-head-compact"}`}>
                {isFinishMode ? (
                  <div>
                    <h3>Финал</h3>
                    <p className="subtle-text">Основной путь: финальный TOP/BOTTOM, звук, фон, версии и экспорт.</p>
                  </div>
                ) : null}
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

              {isFinishMode ? (
                <>
                  <div className="editing-status-row">
                    <span className={`meta-pill ${hasManualCaptionOverride ? "warn" : ""}`}>{finishTextStatusLabel}</span>
                    <span className="meta-pill">Фон {backgroundModeLabel}</span>
                    <span className="meta-pill">Звук {audioModeLabel}</span>
                  </div>

                  <div className="stage3-surface-actions">
                    <p className="subtle-text">Редактор открывайте только для ручного монтажа тайминга и кадра.</p>
                    <button type="button" className="btn btn-secondary" onClick={() => setStage3Mode("editor")}>
                      Открыть редактор
                    </button>
                  </div>
                </>
              ) : null}
            </section>

            {isFinishMode ? (
              <>
                <details className="advanced-block">
                  <summary>Оформление и звук</summary>
                  <div className="advanced-content stage3-secondary-stack">
                    <section className="stage3-secondary-panel">
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

                    <section className="stage3-secondary-panel">
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
                            Если отключить, из preview и финального render убирается звук исходника. Без музыки
                            клип будет беззвучным.
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
                  </div>
                </details>
                {finishCaptionEditorCard}
              </>
            ) : (
              <section className="control-card control-card-priority">
                <div className="control-section-head">
                  <div>
                    <h3>Тайминг и камера</h3>
                    <p className="subtle-text">Соберите фрагменты и при необходимости поправьте общий кадр клипа.</p>
                  </div>
                </div>

                <div className="quick-edit-grid">
                  <div className="quick-edit-card quick-edit-span-2 fragment-card">
                    <div className="fragment-toolbar">
                      <label className="field-label fragment-toggle">
                        <input
                          type="checkbox"
                          checked={compressionEnabled}
                          onChange={(event) => {
                            if (normalizedSegments.length > 0) {
                              setActiveFragmentIndex((current) =>
                                current === null ? 0 : Math.min(current, normalizedSegments.length - 1)
                              );
                            }
                            commitFragments(normalizedSegments, event.target.checked);
                          }}
                        />
                        <span>Подогнать к 6с</span>
                      </label>
                      {normalizedSegments.length > 0 ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setActiveFragmentIndex(null);
                            commitFragments([]);
                          }}
                        >
                          Вернуть цельный клип
                        </button>
                      ) : null}
                    </div>

	                    <div className="fragment-summary-strip">
	                      <span className="meta-pill">
	                        {normalizedSegments.length > 0
	                          ? `${normalizedSegments.length} фрагм.`
	                          : wholeClipWindowLabel
	                            ? `Окно ${wholeClipWindowLabel}`
	                            : "Цельное окно"}
	                      </span>
	                      <span className="meta-pill fragment-summary-primary">
	                        Выход {formatTimeSec(effectiveOutputDurationSec)} / {formatTimeSec(clipDurationSec)}
	                      </span>
                      {fragmentSourceDurationSec !== null ? (
                        <span className="meta-pill">Исходник {formatTimeSec(fragmentSourceDurationSec)}</span>
                      ) : null}
                      <span className="meta-pill">Выбрано {formatTimeSec(sourceDisplayDurationSec)}</span>
                      {unusedSourceDurationSec !== null ? (
                        <span className="meta-pill">Свободно {formatTimeSec(unusedSourceDurationSec)}</span>
                      ) : null}
                      <span className="meta-pill">
                        {compressionEnabled
                          ? normalizationModeLabel ?? "Подгоняем к 6с"
                          : `Осталось ${formatTimeSec(remainingSegmentsDurationSec)}`}
                      </span>
                    </div>

	                    <section className="fragment-source-overview">
	                      <div className="fragment-source-head">
	                        <div>
	                          <strong>Лента исходника</strong>
	                          <p className="subtle-text">
	                            {isFragmentTimelineLoading
	                              ? "Подтягиваем точную длительность исходника, после чего покажем реальное покрытие и позиции фрагментов."
	                              : fragmentSourceDurationSec !== null
	                                ? normalizedSegments.length === 0 && renderPolicy === "fixed_segments"
	                                  ? canDragWholeClipWindow
	                                    ? "Перетаскивайте синее окно по линии, чтобы быстро выбрать нужный 6-секундный диапазон."
	                                    : "Сейчас доступен один цельный 6-секундный диапазон без смещения."
	                                  : normalizedSegments.length === 0
	                                    ? "Сейчас весь исходник участвует в рендере и будет подогнан под целевую длительность."
	                                    : "Лента показывает весь MP4-источник: синие участки задействованы, тёмные будут пропущены."
	                                : "Длительность исходника появится, когда источник полностью определится."}
	                          </p>
	                        </div>
                        <div className="fragment-source-badges">
                          {fragmentSourceDurationSec !== null ? (
                            <span className="meta-pill fragment-source-primary-pill">
                              Исходник {formatTimeSec(fragmentSourceDurationSec)}
                            </span>
                          ) : null}
                          {fragmentSourceDurationSec !== null ? (
                            <span className="meta-pill">Использовано {Math.round(sourceCoveragePercent)}%</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="fragment-source-track">
	                        <div
	                          ref={fragmentSourceRailRef}
	                          className={`fragment-source-rail ${isFragmentTimelineDragging ? "is-dragging" : ""}`}
	                          aria-label="Весь исходный ролик"
	                        >
	                          {hasFragmentSourceTimelineData ? (
	                            <>
	                              {(wholeClipWindowRange ? [] : sourceTimelineRanges).map((range, index) => (
	                                <span
	                                  key={`source-coverage-${index}`}
	                                  className="fragment-source-selection fragment-source-selection-coverage"
	                                  style={{
	                                    left: `${range.offsetPercent}%`,
	                                    width: `${range.widthPercent}%`
	                                  }}
	                                />
	                              ))}
	                              {wholeClipWindowRange ? (
	                                <button
	                                  type="button"
	                                  className={`fragment-source-selection fragment-source-selection-window ${
	                                    canDragWholeClipWindow ? "is-draggable" : ""
	                                  }`}
	                                  style={{
	                                    left: `${wholeClipWindowRange.offsetPercent}%`,
	                                    width: `${wholeClipWindowRange.widthPercent}%`
	                                  }}
	                                  aria-label={`Активное окно: ${wholeClipWindowLabel ?? `${formatTimeSec(localClipStartSec)} → ${formatTimeSec(clipEndSec)}`}`}
	                                  onPointerDown={canDragWholeClipWindow ? startWholeClipWindowDrag : undefined}
	                                >
	                                  <span className="fragment-source-window-grip" aria-hidden="true" />
	                                </button>
	                              ) : (
	                                fragmentRows.map((row) => (
	                                  <button
	                                    key={`source-fragment-${row.rowKey}`}
	                                    type="button"
	                                    className={`fragment-source-selection fragment-source-selection-fragment ${
	                                      activeFragmentIndex === row.index ? "active" : ""
	                                    }`}
	                                    style={{
	                                      left: `${row.sourceOffsetPercent}%`,
	                                      width: `${row.sourceWidthPercent}%`
	                                    }}
	                                    aria-label={`Фрагмент ${row.index + 1}: ${formatTimeSec(row.segment.startSec)} → ${formatTimeSec(row.endValue)}`}
	                                    onClick={() => setActiveFragmentIndex(row.index)}
	                                    onPointerDown={(event) => startFragmentTimelineDrag(event, row, "move")}
	                                  >
	                                    <span
	                                      className="fragment-source-handle fragment-source-handle-start"
	                                      onPointerDown={(event) => startFragmentTimelineDrag(event, row, "resize-start")}
	                                    />
	                                    <span className="fragment-source-selection-label">{row.index + 1}</span>
	                                    <span
	                                      className="fragment-source-handle fragment-source-handle-end"
	                                      onPointerDown={(event) => startFragmentTimelineDrag(event, row, "resize-end")}
	                                    />
	                                  </button>
	                                ))
	                              )}
	                            </>
	                          ) : isFragmentTimelineLoading ? (
	                            <div className="fragment-source-loading" aria-hidden="true">
	                              <span className="fragment-source-loading-bar fragment-source-loading-bar-wide" />
	                              <span className="fragment-source-loading-bar fragment-source-loading-bar-mid" />
	                              <span className="fragment-source-loading-bar fragment-source-loading-bar-short" />
	                            </div>
	                          ) : null}
	                        </div>
	                      </div>
                      <div className="fragment-source-scale">
                        {sourceTimelineScaleMarks.map((label) => (
                          <span key={`source-mark-${label}`}>{label}</span>
                        ))}
                      </div>
                    </section>

	                    <div className="fragment-list">
	                      {fragmentRows.map((row) => (
	                        <article
	                          key={row.rowKey}
	                          className={`fragment-row ${activeFragmentIndex === row.index ? "active" : ""}`}
	                          onClick={() => setActiveFragmentIndex(row.index)}
	                        >
	                          <div className={`fragment-rail ${hasFragmentSourceTimelineData ? "" : "is-loading"}`} aria-hidden="true">
	                            {hasFragmentSourceTimelineData ? (
	                              <span
	                                className="fragment-rail-fill"
	                                style={{
	                                  left: `${row.sourceOffsetPercent}%`,
	                                  width: `${row.sourceWidthPercent}%`
	                                }}
	                              />
	                            ) : (
	                              <span
	                                className="fragment-rail-fill fragment-rail-fill-loading"
	                                style={{
	                                  left: `${10 + (row.index % 3) * 12}%`,
	                                  width: `${28 + (row.index % 2) * 10}%`
	                                }}
	                              />
	                            )}
	                          </div>
	                          <div className="fragment-row-top">
	                            <div className="fragment-row-meta">
	                              <span className="meta-pill mono">{row.index + 1}</span>
	                              <span className="meta-pill fragment-summary-primary">
	                                {formatTimeSec(row.segment.startSec)} → {formatTimeSec(row.endValue)}
	                              </span>
	                              <span className="meta-pill">Выход {formatTimeSec(row.outputDuration)}</span>
	                            </div>
	                            <div className="fragment-row-top-actions">
	                              <button
	                                type="button"
	                                className={`btn btn-ghost segment-toggle-btn fragment-toggle-chip ${
	                                  row.resolvedTransform.mirrorEnabled ? "is-active" : ""
	                                }`}
	                                aria-pressed={row.resolvedTransform.mirrorEnabled}
	                                onClick={(event) => {
	                                  event.stopPropagation();
	                                  updateFragmentTransform(row.index, {
	                                    mirrorEnabled: !row.resolvedTransform.mirrorEnabled
	                                  });
	                                }}
	                              >
	                                Mirror
	                              </button>
	                              <button
	                                type="button"
	                                className="btn fragment-remove-button"
	                                aria-label={`Удалить фрагмент ${row.index + 1}`}
	                                title="Удалить фрагмент"
	                                onClick={(event) => {
	                                  event.stopPropagation();
	                                  removeFragment(row.index);
	                                }}
	                              >
	                                <span className="fragment-remove-icon" aria-hidden="true">
	                                  ✕
	                                </span>
	                              </button>
	                            </div>
	                          </div>
	                          <div className="fragment-control-grid">
	                            <section className="fragment-control-card fragment-control-timing">
	                              <div className="fragment-control-card-head">
	                                <span className="field-label">Тайминг</span>
	                                <span className="subtle-text">
	                                  {formatTimeSec(row.segment.startSec)} → {formatTimeSec(row.endValue)}
	                                </span>
	                              </div>
	                              <div className="fragment-control-fields">
	                                <label className="field-stack">
	                                  <span className="field-label">От</span>
	                                  <input
	                                    ref={(node) => {
	                                      fragmentFieldRefs.current[`${row.rowKey}:startSec`] = node;
	                                    }}
	                                    type="number"
	                                    min={0}
	                                    max={fragmentSourceDurationSec ?? undefined}
	                                    step={0.1}
	                                    className="text-input segment-input"
	                                    value={row.draft.startSec}
	                                    onFocus={() => setActiveFragmentIndex(row.index)}
	                                    onChange={(event) =>
	                                      setFragmentDraftField(row.index, row.segment, "startSec", event.target.value)
	                                    }
	                                    onKeyDown={(event) => {
	                                      if (event.key === "Enter") {
	                                        event.currentTarget.blur();
	                                      }
	                                    }}
	                                    onBlur={() => commitFragmentDraft(row.index, row.segment)}
	                                  />
	                                </label>
	                                <label className="field-stack">
	                                  <span className="field-label">До</span>
	                                  <input
	                                    ref={(node) => {
	                                      fragmentFieldRefs.current[`${row.rowKey}:endSec`] = node;
	                                    }}
	                                    type="number"
	                                    min={0.1}
	                                    max={fragmentSourceDurationSec ?? undefined}
	                                    step={0.1}
	                                    className="text-input segment-input"
	                                    value={row.draft.endSec}
	                                    onFocus={() => setActiveFragmentIndex(row.index)}
	                                    onChange={(event) =>
	                                      setFragmentDraftField(row.index, row.segment, "endSec", event.target.value)
	                                    }
	                                    onKeyDown={(event) => {
	                                      if (event.key === "Enter") {
	                                        event.currentTarget.blur();
	                                      }
	                                    }}
	                                    onBlur={() => commitFragmentDraft(row.index, row.segment)}
	                                  />
	                                </label>
	                                <label className="field-stack">
	                                  <span className="field-label">Сжатие</span>
	                                  <select
	                                    ref={(node) => {
	                                      fragmentFieldRefs.current[`${row.rowKey}:speed`] = node;
	                                    }}
	                                    className="text-input segment-input"
	                                    value={row.segment.speed}
	                                    onFocus={() => setActiveFragmentIndex(row.index)}
	                                    onChange={(event) =>
	                                      updateFragmentSpeed(
	                                        row.index,
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
	                            </section>
	                            <section className="fragment-control-card fragment-control-framing">
	                              <div className="fragment-control-card-head">
	                                <span className="field-label">Кадрирование</span>
	                                <span className="subtle-text">Индивидуально для этого фрагмента</span>
	                              </div>
	                              <div className="fragment-slider-stack">
	                                <label className="slider-field fragment-slider-card">
	                                  <div className="quick-edit-label-row">
	                                    <span className="field-label">Position Y</span>
	                                    <span className="quick-edit-value">{row.draftFocusPercent}%</span>
	                                  </div>
	                                  <input
	                                    ref={(node) => {
	                                      fragmentFieldRefs.current[`${row.rowKey}:focusY`] = node;
	                                    }}
	                                    type="range"
	                                    min={12}
	                                    max={88}
	                                    step={1}
	                                    value={row.draftFocusPercent}
	                                    onFocus={() => setActiveFragmentIndex(row.index)}
	                                    onChange={(event) =>
	                                      setFragmentDraftField(row.index, row.segment, "focusY", event.target.value)
	                                    }
	                                    onMouseUp={() => commitFragmentDraft(row.index, row.segment)}
	                                    onTouchEnd={() => commitFragmentDraft(row.index, row.segment)}
	                                    onBlur={() => commitFragmentDraft(row.index, row.segment)}
	                                  />
	                                </label>
	                                <label className="slider-field fragment-slider-card">
	                                  <div className="quick-edit-label-row">
	                                    <span className="field-label">Zoom</span>
	                                    <span className="quick-edit-value">x{formatFragmentVideoZoom(row.draftVideoZoom)}</span>
	                                  </div>
	                                  <input
	                                    ref={(node) => {
	                                      fragmentFieldRefs.current[`${row.rowKey}:videoZoom`] = node;
	                                    }}
	                                    type="range"
	                                    min={STAGE3_MIN_VIDEO_ZOOM}
	                                    max={STAGE3_MAX_VIDEO_ZOOM}
	                                    step={0.01}
	                                    value={row.draftVideoZoom}
	                                    onFocus={() => setActiveFragmentIndex(row.index)}
	                                    onChange={(event) =>
	                                      setFragmentDraftField(row.index, row.segment, "videoZoom", event.target.value)
	                                    }
	                                    onMouseUp={() => commitFragmentDraft(row.index, row.segment)}
	                                    onTouchEnd={() => commitFragmentDraft(row.index, row.segment)}
	                                    onBlur={() => commitFragmentDraft(row.index, row.segment)}
	                                  />
	                                </label>
	                              </div>
	                            </section>
	                          </div>
	                        </article>
	                      ))}

                      <article
                        className={`fragment-row fragment-row-placeholder ${canAppendFragment ? "" : "disabled"}`}
                      >
                        <div className="fragment-row-head">
                          <div className="fragment-row-meta">
                            <span className="meta-pill mono">{normalizedSegments.length + 1}</span>
                            <span className="meta-pill">Следующий</span>
                            <span className="subtle-text">
                              {canAppendFragment && nextFragmentSuggestion
                                ? `По умолчанию ${formatTimeSec(nextFragmentSuggestion.startSec)} → ${formatTimeSec(nextFragmentSuggestion.endSec)}`
                                : "Лимит заполнен"}
                            </span>
                          </div>
                          <span className="subtle-text">
                            {canAppendFragment
                              ? "Начните вводить время, и строка сразу станет активной."
                              : "Удалите один фрагмент или включите подгонку к 6с, чтобы добавить новый."}
                          </span>
                        </div>
                        <div className="fragment-rail fragment-rail-placeholder" aria-hidden="true">
                          {nextFragmentSuggestion ? (
                            <span
                              className="fragment-rail-fill ghost"
                              style={{
                                left: `${
                                  (fragmentSourceDurationSec ?? 0) > 0
                                    ? clamp(
                                        (nextFragmentSuggestion.startSec / (fragmentSourceDurationSec ?? 1)) * 100,
                                        0,
                                        100
                                      )
                                    : 0
                                }%`,
                                width: `${
                                  (fragmentSourceDurationSec ?? 0) > 0
                                    ? clamp(
                                        ((nextFragmentSuggestion.endSec - nextFragmentSuggestion.startSec) /
                                          (fragmentSourceDurationSec ?? 1)) *
                                          100,
                                        1,
                                        100
                                      )
                                    : 0
                                }%`
                              }}
                            />
                          ) : null}
                        </div>
                        <div className="fragment-input-grid">
                          <label className="field-stack">
                            <span className="field-label">От</span>
                            <input
                              type="number"
                              min={0}
                              max={fragmentSourceDurationSec ?? undefined}
                              step={0.1}
                              className="text-input segment-input"
                              value=""
                              disabled={!canAppendFragment}
                              placeholder={nextFragmentSuggestion ? nextFragmentSuggestion.startSec.toFixed(1) : ""}
                              onChange={(event) => appendFragmentFromDraft("startSec", event.target.value)}
                            />
                          </label>
                          <label className="field-stack">
                            <span className="field-label">До</span>
                            <input
                              type="number"
                              min={0.1}
                              max={fragmentSourceDurationSec ?? undefined}
                              step={0.1}
                              className="text-input segment-input"
                              value=""
                              disabled={!canAppendFragment}
                              placeholder={nextFragmentSuggestion ? nextFragmentSuggestion.endSec.toFixed(1) : ""}
                              onChange={(event) => appendFragmentFromDraft("endSec", event.target.value)}
                            />
                          </label>
                          <label className="field-stack">
                            <span className="field-label">Сжатие</span>
                            <select
                              className="text-input segment-input"
                              value=""
                              disabled={!canAppendFragment}
                              onChange={(event) => appendFragmentFromDraft("speed", event.target.value)}
                            >
                              <option value="">По умолчанию</option>
                              {STAGE3_SEGMENT_SPEED_OPTIONS.map((speed) => (
                                <option key={`placeholder-segment-speed-${speed}`} value={speed}>
                                  {formatSegmentSpeed(speed)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </article>
                    </div>
                  </div>

                  {normalizedSegments.length === 0 ? (
                    <>
                      <div className="quick-edit-card slider-field">
                        <div className="quick-edit-label-row">
                          <label className="field-label" htmlFor="focusRange">
                            Position Y
                          </label>
                          <span className="quick-edit-value">{cameraFocusPercent}%</span>
                        </div>
                        <input
                          id="focusRange"
                          type="range"
                          min={0.12}
                          max={0.88}
                          step={0.01}
                          value={localFocusY}
                          onChange={(event) => scheduleFocusValue(Number.parseFloat(event.target.value))}
                          onMouseUp={() => flushFocusValue(localFocusY)}
                          onTouchEnd={() => flushFocusValue(localFocusY)}
                          onBlur={() => flushFocusValue(localFocusY)}
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

                      <div className="quick-edit-card slider-field">
                        <div className="quick-edit-label-row">
                          <label className="field-label" htmlFor="videoZoomRange">
                            Zoom
                          </label>
                          <span className="quick-edit-value">{editorZoomLabel}</span>
                        </div>
                        <input
                          id="videoZoomRange"
                          type="range"
                          min={1}
                          max={STAGE3_MAX_VIDEO_ZOOM}
                          step={0.01}
                          value={localVideoZoom}
                          onChange={(event) => scheduleZoomValue(Number.parseFloat(event.target.value))}
                          onMouseUp={() => flushZoomValue(localVideoZoom)}
                          onTouchEnd={() => flushZoomValue(localVideoZoom)}
                          onBlur={() => flushZoomValue(localVideoZoom)}
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
                        <p className="subtle-text">Масштаб применяется ко всему клипу целиком.</p>
                      </div>
                    </>
                  ) : (
                    <div className="quick-edit-card quick-edit-span-2">
                      <div className="quick-edit-label-row">
                        <span className="field-label">Покадровый кадринг по фрагментам</span>
                        <span className="quick-edit-value">
                          {activeFragmentIndex === null ? "Выберите фрагмент" : `Фрагмент ${activeFragmentIndex + 1}`}
                        </span>
                      </div>
                      <p className="subtle-text">
                        Перетаскивайте и тяните фрагменты прямо на ленте исходника. Для каждого фрагмента отдельно
                        доступны свои Y, Zoom и Mirror.
                      </p>
                    </div>
                  )}
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
            sourceDurationSec={fragmentSourceDurationSec}
            segments={normalizedSegments}
            timingMode={timingMode}
            renderPolicy={renderPolicy}
            focusY={localFocusY}
            cameraMotion="disabled"
            cameraKeyframes={[]}
            cameraPositionKeyframes={[]}
            cameraScaleKeyframes={[]}
            mirrorEnabled={mirrorEnabled}
            videoZoom={previewVideoZoom}
            topFontScale={localTopFontScale}
            bottomFontScale={localBottomFontScale}
            sourceAudioEnabled={sourceAudioEnabled}
            templateConfig={templateConfig}
            selectedPositionKeyframeId={null}
            selectedScaleKeyframeId={null}
            requestedTimelineSec={requestedTimelineSec}
            onRequestedTimelineHandled={() => setRequestedTimelineSec(null)}
            onSourceDurationResolved={setResolvedFragmentSourceDurationSec}
            onSelectVersionId={onSelectVersionId}
            onSelectPassIndex={onSelectPassIndex}
            onTimelineSecChange={(value) => {
              previewTimelineSecRef.current = value;
            }}
            onSelectPositionKeyframeId={() => undefined}
            onSelectScaleKeyframeId={() => undefined}
            onPositionKeyframeTimeChange={() => undefined}
            onScaleKeyframeTimeChange={() => undefined}
            onCameraPreviewFocusChange={handleCameraPreviewFocusChange}
          />
        }
      />
      {workerSetupModal}
    </>
  );
}
