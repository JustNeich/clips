import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { Stage3TemplateRenderer } from "../lib/stage3-template-renderer";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import type { Stage3VariationProfile } from "../lib/stage3-render-variation";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  getTemplateById,
  type Stage3TemplateConfig
} from "../lib/stage3-template";
import {
  resolveTemplateAvatarBorderColor,
  resolveTemplateBuiltInBackdropAssetPath,
} from "../lib/stage3-template-registry";
import { resolveStage3BackgroundMode } from "../lib/stage3-background-mode";
import { resolveTemplateBackdropNode } from "../lib/stage3-template-runtime";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "../lib/stage3-constants";
import { buildStage3VideoFilterCss } from "../lib/stage3-video-adjustments";
import { buildStage3VideoPlacementStyle } from "../lib/stage3-video-placement";
import {
  cloneTemplateCaptionHighlights,
  createEmptyTemplateCaptionHighlights,
  type TemplateCaptionHighlights
} from "../lib/template-highlights";
import { RenderVariationOverlay } from "./render-variation-overlay";
import { resolveCameraStateAtTime } from "../lib/stage3-camera";
import type {
  Stage3CameraKeyframe,
  Stage3PositionKeyframe,
  Stage3ScaleKeyframe
} from "../lib/stage3-camera";

type RemotionStage3TimingMode = "auto" | "compress" | "stretch";
type RemotionStage3Segment = {
  startSec: number;
  endSec: number | null;
  label: string;
  speed: number;
  focusX?: number | null;
  focusY?: number | null;
  videoZoom?: number | null;
  mirrorEnabled?: boolean | null;
};

type RemotionSegmentTransformState = {
  focusX: number;
  focusY: number;
  videoZoom: number;
  mirrorEnabled: boolean;
};

type ScienceCardV1Props = {
  templateId?: string;
  templateConfigOverride?: Stage3TemplateConfig | null;
  sourceVideoFileName?: string | null;
  topText: string;
  bottomText: string;
  captionHighlights: TemplateCaptionHighlights;
  clipStartSec: number;
  clipDurationSec: number;
  focusX: number;
  focusY: number;
  mirrorEnabled: boolean;
  timingMode: RemotionStage3TimingMode;
  segments: RemotionStage3Segment[];
  cameraMotion: "disabled" | "top_to_bottom" | "bottom_to_top";
  cameraKeyframes: Stage3CameraKeyframe[];
  cameraPositionKeyframes: Stage3PositionKeyframe[];
  cameraScaleKeyframes: Stage3ScaleKeyframe[];
  videoZoom: number;
  videoBrightness: number;
  videoExposure: number;
  videoContrast: number;
  videoSaturation: number;
  topFontScale: number;
  bottomFontScale: number;
  authorName: string;
  authorHandle: string;
  avatarAssetFileName?: string | null;
  avatarAssetMimeType?: string | null;
  backgroundAssetFileName?: string | null;
  backgroundAssetMimeType?: string | null;
  textFit?: {
    topFontPx: number;
    bottomFontPx: number;
    topLineHeight: number;
    bottomLineHeight: number;
    topLines: number;
    bottomLines: number;
    topCompacted: boolean;
    bottomCompacted: boolean;
  } | null;
  variationProfile?: Stage3VariationProfile | null;
};

export function buildScienceCardRenderSnapshot(input: {
  templateId?: string;
  templateConfigOverride?: Stage3TemplateConfig | null;
  topText: string;
  bottomText: string;
  captionHighlights?: TemplateCaptionHighlights | null;
  topFontScale: number;
  bottomFontScale: number;
  authorName: string;
  authorHandle: string;
  sourceVideoFileName?: string | null;
  backgroundAssetFileName?: string | null;
  avatarAssetFileName?: string | null;
  textFit?: ScienceCardV1Props["textFit"];
}) {
  const resolvedTemplateId = input.templateId ?? SCIENCE_CARD_TEMPLATE_ID;
  const templateConfig = input.templateConfigOverride ?? getTemplateById(resolvedTemplateId);
  return buildTemplateRenderSnapshot({
    templateId: resolvedTemplateId,
    templateConfigOverride: templateConfig,
    content: {
      topText: input.topText,
      bottomText: input.bottomText,
      channelName: input.authorName,
      channelHandle: input.authorHandle,
      highlights: cloneTemplateCaptionHighlights(input.captionHighlights) ?? createEmptyTemplateCaptionHighlights(),
      topFontScale: input.topFontScale,
      bottomFontScale: input.bottomFontScale,
      previewScale: 1,
      mediaAsset: input.sourceVideoFileName ?? null,
      backgroundAsset: input.backgroundAssetFileName ?? null,
      avatarAsset: input.avatarAssetFileName ?? null
    },
    fitOverride: input.textFit ?? undefined
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function resolveDurationScale(
  totalOutputDurationSec: number,
  targetDurationSec: number,
  timingMode: RemotionStage3TimingMode
): number {
  if (Math.abs(totalOutputDurationSec - targetDurationSec) <= 0.005) {
    return 1;
  }
  const requiresCompression = totalOutputDurationSec > targetDurationSec + 0.005;
  const requiresStretch = totalOutputDurationSec < targetDurationSec - 0.005;
  if (timingMode === "compress" && !requiresCompression) {
    return 1;
  }
  if (timingMode === "stretch" && !requiresStretch) {
    return 1;
  }
  return targetDurationSec / Math.max(0.05, totalOutputDurationSec);
}

function resolveSegmentTransformAtOutputTime(params: {
  segments: RemotionStage3Segment[];
  clipDurationSec: number;
  timingMode: RemotionStage3TimingMode;
  outputTimeSec: number;
  fallbackFocusX: number;
  fallbackFocusY: number;
  fallbackVideoZoom: number;
  fallbackMirrorEnabled: boolean;
}): RemotionSegmentTransformState {
  if (!params.segments.length) {
    return {
      focusX: params.fallbackFocusX,
      focusY: params.fallbackFocusY,
      videoZoom: params.fallbackVideoZoom,
      mirrorEnabled: params.fallbackMirrorEnabled
    };
  }

  const normalizedSegments = params.segments
    .map((segment) => {
      const startSec =
        typeof segment.startSec === "number" && Number.isFinite(segment.startSec)
          ? Math.max(0, segment.startSec)
          : null;
      if (startSec === null) {
        return null;
      }
      const endRaw =
        segment.endSec === null
          ? startSec + 0.5
          : typeof segment.endSec === "number" && Number.isFinite(segment.endSec)
            ? segment.endSec
            : startSec + 0.5;
      const endSec = roundToTenth(Math.max(startSec + 0.1, endRaw));
      const speed =
        typeof segment.speed === "number" && Number.isFinite(segment.speed) && segment.speed > 0
          ? segment.speed
          : 1;
      return {
        ...segment,
        startSec: roundToTenth(startSec),
        endSec,
        speed
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
    .sort((left, right) => left.startSec - right.startSec);

  if (!normalizedSegments.length) {
    return {
      focusX: params.fallbackFocusX,
      focusY: params.fallbackFocusY,
      videoZoom: params.fallbackVideoZoom,
      mirrorEnabled: params.fallbackMirrorEnabled
    };
  }

  const totalOutputDurationSec = normalizedSegments.reduce((total, segment) => {
    return total + Math.max(0.05, segment.endSec - segment.startSec) / Math.max(0.1, segment.speed);
  }, 0);
  const durationScale = resolveDurationScale(totalOutputDurationSec, params.clipDurationSec, params.timingMode);
  const outputTimeSec = clamp(params.outputTimeSec, 0, Math.max(params.clipDurationSec, totalOutputDurationSec));

  let cursor = 0;
  for (const segment of normalizedSegments) {
    const sourceDurationSec = Math.max(0.05, segment.endSec - segment.startSec);
    const outputDurationSec = (sourceDurationSec / Math.max(0.1, segment.speed)) * durationScale;
    const outputEndSec = cursor + outputDurationSec;
    const isActive =
      segment === normalizedSegments[normalizedSegments.length - 1]
        ? outputTimeSec <= outputEndSec + 0.001
        : outputTimeSec >= cursor && outputTimeSec < outputEndSec;
    if (isActive) {
      return {
        focusX:
          typeof segment.focusX === "number" && Number.isFinite(segment.focusX)
            ? clamp(segment.focusX, 0.12, 0.88)
            : params.fallbackFocusX,
        focusY:
          typeof segment.focusY === "number" && Number.isFinite(segment.focusY)
            ? clamp(segment.focusY, 0.12, 0.88)
            : params.fallbackFocusY,
        videoZoom:
          typeof segment.videoZoom === "number" && Number.isFinite(segment.videoZoom)
            ? clamp(segment.videoZoom, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM)
            : params.fallbackVideoZoom,
        mirrorEnabled:
          typeof segment.mirrorEnabled === "boolean" ? segment.mirrorEnabled : params.fallbackMirrorEnabled
      };
    }
    cursor = outputEndSec;
  }

  return {
    focusX: params.fallbackFocusX,
    focusY: params.fallbackFocusY,
    videoZoom: params.fallbackVideoZoom,
    mirrorEnabled: params.fallbackMirrorEnabled
  };
}

export function ScienceCardV1({
  templateId,
  templateConfigOverride,
  topText,
  bottomText,
  captionHighlights,
  clipStartSec,
  clipDurationSec,
  focusX,
  focusY,
  videoZoom,
  videoBrightness,
  videoExposure,
  videoContrast,
  videoSaturation,
  topFontScale,
  bottomFontScale,
  authorName,
  authorHandle,
  sourceVideoFileName,
  mirrorEnabled,
  timingMode,
  segments,
  cameraMotion,
  cameraKeyframes,
  cameraPositionKeyframes,
  cameraScaleKeyframes,
  avatarAssetFileName,
  avatarAssetMimeType,
  backgroundAssetFileName,
  backgroundAssetMimeType,
  textFit,
  variationProfile
}: ScienceCardV1Props): React.JSX.Element {
  const resolvedTemplateId = templateId ?? SCIENCE_CARD_TEMPLATE_ID;
  const templateConfig = templateConfigOverride ?? getTemplateById(resolvedTemplateId);
  const videoFilter = buildStage3VideoFilterCss({
    brightness: videoBrightness,
    exposure: videoExposure,
    contrast: videoContrast,
    saturation: videoSaturation
  });
  const backgroundVideoFilter = buildStage3VideoFilterCss(
    {
      brightness: videoBrightness,
      exposure: videoExposure,
      contrast: videoContrast,
      saturation: videoSaturation
    },
    {
      blurPx: 12,
      baseBrightness: 0.8,
      baseSaturation: 1.05
    }
  );
  const frameNumber = useCurrentFrame();
  const frame = templateConfig.frame;
  const sourceUrl = sourceVideoFileName ? staticFile(sourceVideoFileName) : "";
  const avatarSrc =
    avatarAssetFileName && (avatarAssetMimeType ?? "").toLowerCase().startsWith("image/")
      ? staticFile(avatarAssetFileName)
      : null;
  const customBackgroundSrc = backgroundAssetFileName ? staticFile(backgroundAssetFileName) : null;
  const hasCustomBackground = Boolean(customBackgroundSrc);
  const customBackgroundIsVideo =
    hasCustomBackground && (backgroundAssetMimeType ?? "").toLowerCase().startsWith("video/");

  const fps = 30;
  const startFrom = Math.max(0, Math.round(clipStartSec * fps));
  const clipFrames = Math.max(1, Math.round(clipDurationSec * fps));
  const endAt = startFrom + clipFrames;
  const currentTimeSec = clipFrames <= 1 ? 0 : frameNumber / fps;
  const segmentTransform = React.useMemo(
    () =>
      resolveSegmentTransformAtOutputTime({
        segments,
        clipDurationSec,
        timingMode,
        outputTimeSec: currentTimeSec,
        fallbackFocusX: focusX,
        fallbackFocusY: focusY,
        fallbackVideoZoom: videoZoom,
        fallbackMirrorEnabled: mirrorEnabled
      }),
    [clipDurationSec, currentTimeSec, focusX, focusY, mirrorEnabled, segments, timingMode, videoZoom]
  );
  const cameraState = resolveCameraStateAtTime({
    timeSec: currentTimeSec,
    cameraPositionKeyframes,
    cameraScaleKeyframes,
    cameraKeyframes,
    cameraMotion,
    clipDurationSec,
    baseFocusY: segmentTransform.focusY,
    baseZoom: segmentTransform.videoZoom
  });
  const animatedFocus = cameraState.focusY;
  const normalizedZoom = Math.min(
    STAGE3_MAX_VIDEO_ZOOM,
    Math.max(STAGE3_MIN_VIDEO_ZOOM, Number.isFinite(cameraState.zoom) ? cameraState.zoom : 1)
  );
  const slotPlacementStyle = buildStage3VideoPlacementStyle({
    focusX: segmentTransform.focusX,
    focusY: animatedFocus,
    videoZoom: normalizedZoom,
    mirrorEnabled: segmentTransform.mirrorEnabled
  });
  const backgroundPlacementStyle = buildStage3VideoPlacementStyle({
    focusX: segmentTransform.focusX,
    focusY: animatedFocus,
    videoZoom: 1,
    mirrorEnabled: segmentTransform.mirrorEnabled,
    extraScale: 1.08
  });
  const renderSnapshot = buildScienceCardRenderSnapshot({
    templateId: resolvedTemplateId,
    templateConfigOverride: templateConfig,
    topText,
    bottomText,
    captionHighlights,
    topFontScale,
    bottomFontScale,
    authorName,
    authorHandle,
    sourceVideoFileName,
    backgroundAssetFileName,
    avatarAssetFileName,
    textFit
  });
  const backgroundMode = resolveStage3BackgroundMode(resolvedTemplateId, {
    hasCustomBackground: hasCustomBackground,
    hasSourceVideo: Boolean(sourceUrl)
  });

  const backgroundNode = (
    <AbsoluteFill>
      {backgroundMode === "custom" ? (
        customBackgroundIsVideo ? (
          <OffthreadVideo
            src={customBackgroundSrc!}
            style={{
              width: frame.width,
              height: frame.height,
              objectFit: "cover",
              objectPosition: "center center"
            }}
            volume={0}
          />
        ) : (
          <Img
            src={customBackgroundSrc!}
            style={{
              width: frame.width,
              height: frame.height,
              objectFit: "cover",
              objectPosition: "center center"
            }}
          />
        )
      ) : backgroundMode === "source-blur" ? (
        <OffthreadVideo
          src={sourceUrl}
          startFrom={startFrom}
          endAt={endAt}
          style={{
            width: frame.width,
            height: frame.height,
            objectFit: "cover",
            objectPosition: backgroundPlacementStyle.objectPosition,
            ...(backgroundVideoFilter ? { filter: backgroundVideoFilter } : {}),
            transform: backgroundPlacementStyle.transform,
            transformOrigin: backgroundPlacementStyle.transformOrigin
          }}
          volume={0}
        />
      ) : backgroundMode === "built-in" ? (
        resolveTemplateBackdropNode(
          resolvedTemplateId,
          resolveTemplateBuiltInBackdropAssetPath(resolvedTemplateId)
            ? staticFile(resolveTemplateBuiltInBackdropAssetPath(resolvedTemplateId)!.replace(/^\//, ""))
            : undefined
        )
      ) : (
        <AbsoluteFill style={{ background: "#060606" }} />
      )}
    </AbsoluteFill>
  );

  const mediaNode = sourceUrl ? (
    <OffthreadVideo
      src={sourceUrl}
      startFrom={startFrom}
      endAt={endAt}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: slotPlacementStyle.objectPosition,
        ...(videoFilter ? { filter: videoFilter } : {}),
        transform: slotPlacementStyle.transform,
        transformOrigin: slotPlacementStyle.transformOrigin
      }}
      volume={1}
    />
  ) : (
    <AbsoluteFill style={{ background: "#dfe5ef" }} />
  );

  const avatarNode = avatarSrc ? (
    <Img
      src={avatarSrc}
      style={{
        width: renderSnapshot.layout.avatar.width,
        height: renderSnapshot.layout.avatar.height,
        borderRadius: 999,
        border: `${templateConfig.author.avatarBorder}px solid ${resolveTemplateAvatarBorderColor(resolvedTemplateId)}`,
        objectFit: "cover",
        boxSizing: "border-box",
        flex: "0 0 auto"
      }}
    />
  ) : undefined;
  const verificationBadgeNode = templateConfig.author.checkAssetPath ? (
    <Img
      src={staticFile(templateConfig.author.checkAssetPath.replace(/^\//, ""))}
      style={{
        width: renderSnapshot.spec.typography?.badge?.size ?? templateConfig.author.checkSize,
        height: renderSnapshot.spec.typography?.badge?.size ?? templateConfig.author.checkSize,
        display: "block",
        flex: "0 0 auto"
      }}
    />
  ) : undefined;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#060606",
        width: frame.width,
        height: frame.height
      }}
    >
      <Stage3TemplateRenderer
        templateId={resolvedTemplateId}
        content={renderSnapshot.content}
        snapshot={renderSnapshot}
        templateConfigOverride={templateConfig}
        runtime={{
          backgroundNode,
          mediaNode,
          avatarNode,
          verificationBadgeNode
        }}
      />
      <RenderVariationOverlay profile={variationProfile} />
    </AbsoluteFill>
  );
}
