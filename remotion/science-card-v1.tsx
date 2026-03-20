import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { Stage3TemplateRenderer } from "../lib/stage3-template-renderer";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import type { Stage3VariationProfile } from "../lib/stage3-render-variation";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  getTemplateById
} from "../lib/stage3-template";
import {
  resolveTemplateAvatarBorderColor,
  resolveTemplateBuiltInBackdropAssetPath,
} from "../lib/stage3-template-registry";
import { resolveStage3BackgroundMode } from "../lib/stage3-background-mode";
import { resolveTemplateBackdropNode } from "../lib/stage3-template-runtime";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "../lib/stage3-constants";
import { RenderVariationOverlay } from "./render-variation-overlay";

type ScienceCardV1Props = {
  templateId?: string;
  sourceVideoFileName?: string | null;
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  mirrorEnabled: boolean;
  cameraMotion: "disabled" | "top_to_bottom" | "bottom_to_top";
  videoZoom: number;
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

function easeInOutSine(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return 0.5 - Math.cos(clamped * Math.PI) / 2;
}

function resolveLoopFriendlyMotionProgress(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  const eased = easeInOutSine(clamped);
  return clamped * 0.72 + eased * 0.28;
}

export function ScienceCardV1({
  templateId,
  topText,
  bottomText,
  clipStartSec,
  clipDurationSec,
  focusY,
  videoZoom,
  topFontScale,
  bottomFontScale,
  authorName,
  authorHandle,
  sourceVideoFileName,
  mirrorEnabled,
  cameraMotion,
  avatarAssetFileName,
  avatarAssetMimeType,
  backgroundAssetFileName,
  backgroundAssetMimeType,
  textFit,
  variationProfile
}: ScienceCardV1Props): React.JSX.Element {
  const resolvedTemplateId = templateId ?? SCIENCE_CARD_TEMPLATE_ID;
  const templateConfig = getTemplateById(resolvedTemplateId);
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
  const progress = clipFrames <= 1 ? 0 : Math.min(1, Math.max(0, frameNumber / Math.max(1, clipFrames - 1)));
  const baseFocus = Math.min(0.88, Math.max(0.12, focusY));
  const sweepStart = Math.min(0.88 - 0.28, Math.max(0.12, baseFocus - 0.14));
  const sweepEnd = Math.min(0.88, Math.max(0.12, sweepStart + 0.28));
  const easedProgress = resolveLoopFriendlyMotionProgress(progress);
  const animatedFocus =
    cameraMotion === "top_to_bottom"
      ? sweepStart + (sweepEnd - sweepStart) * easedProgress
      : cameraMotion === "bottom_to_top"
        ? sweepEnd - (sweepEnd - sweepStart) * easedProgress
        : baseFocus;
  const objectPosition = `50% ${(Math.min(88, Math.max(12, animatedFocus * 100))).toFixed(3)}%`;
  const normalizedZoom = Math.min(
    STAGE3_MAX_VIDEO_ZOOM,
    Math.max(STAGE3_MIN_VIDEO_ZOOM, Number.isFinite(videoZoom) ? videoZoom : 1)
  );
  const renderSnapshot = buildTemplateRenderSnapshot({
    templateId: resolvedTemplateId,
    content: {
      topText,
      bottomText,
      channelName: authorName,
      channelHandle: authorHandle,
      topFontScale,
      bottomFontScale,
      previewScale: 1,
      mediaAsset: sourceVideoFileName ?? null,
      backgroundAsset: backgroundAssetFileName ?? null,
      avatarAsset: avatarAssetFileName ?? null
    },
    fitOverride: textFit ?? undefined
  });
  const mirroredScale = mirrorEnabled ? -normalizedZoom : normalizedZoom;
  const slotTransform = `scale(${mirroredScale.toFixed(3)}, ${normalizedZoom.toFixed(3)})`;
  const backgroundScale = 1.08;
  const bgTransform = mirrorEnabled
    ? `scale(${(-backgroundScale).toFixed(3)}, ${backgroundScale.toFixed(3)})`
    : `scale(${backgroundScale.toFixed(3)})`;
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
            objectPosition,
            filter: "blur(12px) brightness(0.8) saturate(1.05)",
            transform: bgTransform,
            transformOrigin: "center center"
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
        objectPosition,
        transform: slotTransform,
        transformOrigin: "center center"
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
