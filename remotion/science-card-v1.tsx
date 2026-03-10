import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import {
  SCIENCE_CARD,
  SCIENCE_CARD_TEMPLATE_ID,
  TURBO_FACE,
  TURBO_FACE_TEMPLATE_ID,
  getTemplateComputed
} from "../lib/stage3-template";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "../lib/stage3-constants";

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
};

function OverlayText({
  text,
  fontSize,
  maxLines,
  paddingX,
  paddingY,
  paddingTop,
  paddingBottom,
  paddingLeft,
  paddingRight,
  lineHeight,
  fontWeight,
  textAlign = "center",
  verticalAlign = "center",
  fontFamily = '"Arial","Helvetica Neue",Helvetica,sans-serif',
  color = "#0b1018",
  letterSpacing
}: {
  text: string;
  fontSize: number;
  maxLines: number;
  paddingX: number;
  paddingY: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  lineHeight: number;
  fontWeight: number;
  textAlign?: "left" | "center";
  verticalAlign?: "start" | "center";
  fontFamily?: string;
  color?: string;
  letterSpacing?: string;
}) {
  const resolvedPaddingTop = paddingTop ?? paddingY;
  const resolvedPaddingBottom = paddingBottom ?? paddingY;
  const resolvedPaddingLeft = paddingLeft ?? paddingX;
  const resolvedPaddingRight = paddingRight ?? paddingX;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: verticalAlign === "start" ? "flex-start" : "center",
        justifyContent: "center",
        boxSizing: "border-box",
        overflow: "hidden",
        padding: `${resolvedPaddingTop}px ${resolvedPaddingRight}px ${resolvedPaddingBottom}px ${resolvedPaddingLeft}px`
      }}
    >
      <p
        style={{
          margin: 0,
          width: "100%",
          color,
          fontSize,
          lineHeight,
          fontWeight,
          textAlign,
          fontFamily,
          letterSpacing: letterSpacing ?? (textAlign === "center" ? "-0.015em" : "-0.005em"),
          textWrap: textAlign === "center" ? "pretty" : "pretty",
          overflowWrap: "break-word",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: maxLines,
          overflow: "hidden"
        }}
      >
        {text}
      </p>
    </div>
  );
}

function avatarInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) {
    return "SS";
  }
  return parts.map((item) => item[0]?.toUpperCase() ?? "").join("") || "SS";
}

function easeInOutSine(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return 0.5 - Math.cos(clamped * Math.PI) / 2;
}

function resolveLoopFriendlyMotionProgress(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  const eased = easeInOutSine(clamped);
  return clamped * 0.72 + eased * 0.28;
}

function AuthorBlock({
  authorName,
  authorHandle,
  avatarAssetFileName,
  avatarAssetMimeType
}: {
  authorName: string;
  authorHandle: string;
  avatarAssetFileName?: string | null;
  avatarAssetMimeType?: string | null;
}): React.JSX.Element {
  const avatarSrc = avatarAssetFileName ? staticFile(avatarAssetFileName) : null;
  const avatarIsImage = Boolean(avatarSrc) && (avatarAssetMimeType ?? "").toLowerCase().startsWith("image/");
  const initials = avatarInitials(authorName);

  return (
    <div
      style={{
        width: "100%",
        height: SCIENCE_CARD.slot.bottomMetaHeight,
        padding: `${SCIENCE_CARD.slot.bottomMetaPaddingY}px ${SCIENCE_CARD.slot.bottomMetaPaddingX}px`,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 11,
        backgroundColor: "#ffffff"
      }}
    >
      {avatarIsImage && avatarSrc ? (
        <Img
          src={avatarSrc}
          style={{
            width: SCIENCE_CARD.author.avatarSize,
            height: SCIENCE_CARD.author.avatarSize,
            borderRadius: 999,
            border: `${SCIENCE_CARD.author.avatarBorder}px solid rgba(7, 13, 23, 0.25)`,
            objectFit: "cover",
            boxSizing: "border-box",
            flex: "0 0 auto"
          }}
        />
      ) : (
        <div
          style={{
            width: SCIENCE_CARD.author.avatarSize,
            height: SCIENCE_CARD.author.avatarSize,
            borderRadius: 999,
            border: `${SCIENCE_CARD.author.avatarBorder}px solid rgba(7, 13, 23, 0.25)`,
            background: "radial-gradient(circle at 30% 30%, #f4dc96, #2f86bb 70%, #20506f)",
            color: "rgba(255,255,255,0.92)",
            display: "grid",
            placeItems: "center",
            fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
            fontWeight: 800,
            fontSize: Math.round(SCIENCE_CARD.author.avatarSize * 0.32),
            letterSpacing: "0.02em",
            boxSizing: "border-box",
            flex: "0 0 auto"
          }}
        >
          {initials}
        </div>
      )}
      <div style={{ minWidth: 0, display: "grid", gap: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              color: "#0c1018",
              fontWeight: 700,
              fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
              fontSize: SCIENCE_CARD.typography.authorName.font,
              lineHeight: SCIENCE_CARD.typography.authorName.lineHeight,
              whiteSpace: "nowrap"
            }}
          >
            {authorName}
          </span>
          <span
            style={{
              width: SCIENCE_CARD.author.checkSize,
              height: SCIENCE_CARD.author.checkSize,
              borderRadius: 999,
              background: "#bf5cf4",
              color: "#ffffff",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
              fontSize: Math.round(SCIENCE_CARD.author.checkSize * 0.56),
              lineHeight: 1
            }}
          >
            ✓
          </span>
        </div>
        <span
          style={{
            color: "#8d96a8",
            fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
            fontSize: SCIENCE_CARD.typography.authorHandle.font,
            lineHeight: SCIENCE_CARD.typography.authorHandle.lineHeight,
            letterSpacing: "-0.005em"
          }}
        >
          {authorHandle}
        </span>
      </div>
    </div>
  );
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
  backgroundAssetMimeType
}: ScienceCardV1Props): React.JSX.Element {
  const frameNumber = useCurrentFrame();
  const sourceUrl = sourceVideoFileName ? staticFile(sourceVideoFileName) : "";
  const isTurbo = templateId === TURBO_FACE_TEMPLATE_ID;
  const frame = isTurbo ? TURBO_FACE.frame : SCIENCE_CARD.frame;
  const customBackgroundSrc = backgroundAssetFileName ? staticFile(backgroundAssetFileName) : null;
  const hasCustomBackground = Boolean(customBackgroundSrc);
  const customBackgroundIsVideo =
    hasCustomBackground && (backgroundAssetMimeType ?? "").toLowerCase().startsWith("video/");
  const computed = getTemplateComputed(templateId ?? SCIENCE_CARD_TEMPLATE_ID, topText, bottomText, {
    topFontScale,
    bottomFontScale
  });
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
  const mirroredScale = mirrorEnabled ? -normalizedZoom : normalizedZoom;
  const slotTransform = `scale(${mirroredScale.toFixed(3)}, ${normalizedZoom.toFixed(3)})`;
  const bgTransform = mirrorEnabled ? "scaleX(-1)" : undefined;
  const turboBottomTop = frame.height - TURBO_FACE.bottom.bottom - computed.bottomBlockHeight;
  const turboShellHeight = turboBottomTop + computed.bottomBlockHeight - TURBO_FACE.top.y;
  const turboShellStyle = {
    left: TURBO_FACE.top.x,
    top: TURBO_FACE.top.y,
    width: TURBO_FACE.top.width,
    height: turboShellHeight,
    borderRadius: 34,
    background: "rgba(252, 252, 249, 0.035)",
    border: "1px solid rgba(255,255,255,0.1)",
    boxShadow:
      "0 30px 80px rgba(4, 10, 20, 0.36), 0 12px 28px rgba(4, 10, 20, 0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
    overflow: "hidden",
    backdropFilter: "blur(10px)"
  } as const;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#060606",
        width: frame.width,
        height: frame.height
      }}
    >
      <AbsoluteFill>
        {customBackgroundSrc ? (
          customBackgroundIsVideo ? (
            <OffthreadVideo
              src={customBackgroundSrc}
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
              src={customBackgroundSrc}
              style={{
                width: frame.width,
                height: frame.height,
                objectFit: "cover",
                objectPosition: "center center"
              }}
            />
          )
        ) : (
          <OffthreadVideo
            src={sourceUrl}
            startFrom={startFrom}
            endAt={endAt}
            style={{
              width: frame.width,
              height: frame.height,
              objectFit: "cover",
              objectPosition,
              filter: "blur(16px) brightness(0.82) saturate(1.05)",
              transform: bgTransform,
              transformOrigin: "center center"
            }}
            volume={0}
          />
        )}
      </AbsoluteFill>

      {isTurbo ? (
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, rgba(9, 20, 44, 0.08) 0%, rgba(9, 20, 44, 0.18) 26%, rgba(7, 12, 20, 0.12) 60%, rgba(7, 12, 20, 0.26) 100%)"
          }}
        />
      ) : null}

      {isTurbo ? (
        <>
          <AbsoluteFill style={turboShellStyle} />

          <AbsoluteFill
            style={{
              left: TURBO_FACE.top.x,
              top: TURBO_FACE.top.y,
              width: TURBO_FACE.top.width,
              height: computed.topBlockHeight,
              borderRadius: `${TURBO_FACE.top.radius}px ${TURBO_FACE.top.radius}px 0 0`,
              backgroundColor: "rgba(255,255,255,0.975)",
              borderBottom: "1px solid rgba(6, 13, 22, 0.08)",
              overflow: "hidden"
            }}
          >
            <OverlayText
              text={computed.top}
              fontSize={computed.topFont}
              maxLines={TURBO_FACE.typography.top.maxLines}
              paddingX={TURBO_FACE.top.paddingX}
              paddingY={TURBO_FACE.top.paddingY}
              lineHeight={computed.topLineHeight}
              fontWeight={900}
              textAlign="center"
              fontFamily={'"Trebuchet MS","Arial",sans-serif'}
              letterSpacing="-0.03em"
            />
          </AbsoluteFill>

          <AbsoluteFill
            style={{
              left: computed.videoX,
              top: computed.videoY,
              width: computed.videoWidth,
              height: computed.videoHeight,
              overflow: "hidden",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(7,12,20,0.12)"
            }}
          >
            <OffthreadVideo
              src={sourceUrl}
              startFrom={startFrom}
              endAt={endAt}
              style={{
                width: computed.videoWidth,
                height: computed.videoHeight,
                objectFit: "cover",
                objectPosition,
                transform: slotTransform,
                transformOrigin: "center center"
              }}
              volume={1}
            />
          </AbsoluteFill>

          <AbsoluteFill
            style={{
              left: TURBO_FACE.bottom.x,
              top: turboBottomTop,
              width: TURBO_FACE.bottom.width,
              height: computed.bottomBlockHeight,
              borderRadius: `0 0 ${TURBO_FACE.bottom.radius}px ${TURBO_FACE.bottom.radius}px`,
              backgroundColor: "rgba(250,249,246,0.985)",
              borderTop: "1px solid rgba(6, 13, 22, 0.09)",
              overflow: "hidden",
              display: "grid",
              gridTemplateRows: `${TURBO_FACE.bottom.metaHeight + TURBO_FACE.bottom.paddingY * 2}px minmax(0, 1fr)`
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                boxSizing: "border-box",
                padding: `${TURBO_FACE.bottom.paddingY}px ${TURBO_FACE.bottom.paddingX}px`
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {avatarAssetFileName && (avatarAssetMimeType ?? "").toLowerCase().startsWith("image/") ? (
                  <Img
                    src={staticFile(avatarAssetFileName)}
                    style={{
                      width: TURBO_FACE.author.avatarSize,
                      height: TURBO_FACE.author.avatarSize,
                      borderRadius: 999,
                      border: `${TURBO_FACE.author.avatarBorder}px solid rgba(8,12,18,0.12)`,
                      objectFit: "cover",
                      boxSizing: "border-box",
                      flex: "0 0 auto"
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: TURBO_FACE.author.avatarSize,
                      height: TURBO_FACE.author.avatarSize,
                      borderRadius: 999,
                      border: `${TURBO_FACE.author.avatarBorder}px solid rgba(8,12,18,0.12)`,
                      background: "radial-gradient(circle at 30% 30%, #f6db98, #2f86bb 70%, #20506f)",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
                      fontWeight: 800,
                      fontSize: Math.round(TURBO_FACE.author.avatarSize * 0.32),
                      letterSpacing: "0.02em",
                      boxSizing: "border-box",
                      flex: "0 0 auto"
                    }}
                  >
                    {avatarInitials(authorName)}
                  </div>
                )}
                <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span
                      style={{
                        color: "#11161f",
                        fontWeight: 700,
                        fontFamily: '"Trebuchet MS","Arial",sans-serif',
                        fontSize: TURBO_FACE.typography.authorName.font,
                        lineHeight: TURBO_FACE.typography.authorName.lineHeight,
                        whiteSpace: "nowrap"
                      }}
                    >
                      {authorName}
                    </span>
                    <span
                      style={{
                        width: TURBO_FACE.author.checkSize,
                        height: TURBO_FACE.author.checkSize,
                        borderRadius: 999,
                        background: "#72b6e6",
                        color: "#ffffff",
                        display: "grid",
                        placeItems: "center",
                        fontWeight: 800,
                        fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
                        fontSize: Math.round(TURBO_FACE.author.checkSize * 0.56),
                        lineHeight: 1
                      }}
                    >
                      ✓
                    </span>
                  </div>
                  <span
                    style={{
                      color: "#8b919a",
                      fontFamily: '"Trebuchet MS","Arial",sans-serif',
                      fontSize: TURBO_FACE.typography.authorHandle.font,
                      lineHeight: TURBO_FACE.typography.authorHandle.lineHeight
                    }}
                  >
                    {authorHandle}
                  </span>
                </div>
              </div>
            </div>

            <OverlayText
              text={computed.bottom}
              fontSize={computed.bottomFont}
              maxLines={TURBO_FACE.typography.bottom.maxLines}
              paddingX={TURBO_FACE.bottom.paddingX}
              paddingY={0}
              paddingTop={8}
              paddingBottom={TURBO_FACE.bottom.paddingY}
              paddingLeft={TURBO_FACE.bottom.paddingX}
              paddingRight={TURBO_FACE.bottom.paddingX}
              lineHeight={computed.bottomLineHeight}
              fontWeight={500}
              textAlign="left"
              verticalAlign="start"
              fontFamily={'"Trebuchet MS","Arial",sans-serif'}
              color="#181b22"
              letterSpacing="-0.015em"
            />
          </AbsoluteFill>
        </>
      ) : (
      <AbsoluteFill
        style={{
          left: SCIENCE_CARD.card.x,
          top: SCIENCE_CARD.card.y,
          width: SCIENCE_CARD.card.width,
          height: SCIENCE_CARD.card.height,
          borderRadius: SCIENCE_CARD.card.radius,
          border: `${SCIENCE_CARD.card.borderWidth}px solid ${SCIENCE_CARD.card.borderColor}`,
          backgroundColor: SCIENCE_CARD.card.fill,
          overflow: "hidden",
          boxSizing: "border-box",
          boxShadow: "13px 16px 0 rgba(10, 12, 16, 0.74), 0 24px 48px rgba(0, 0, 0, 0.42)"
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: SCIENCE_CARD.card.width,
            height: computed.topBlockHeight,
            backgroundColor: SCIENCE_CARD.card.fill,
            zIndex: 2
          }}
        >
          <OverlayText
            text={computed.top}
            fontSize={computed.topFont}
            maxLines={SCIENCE_CARD.typography.top.maxLines}
            paddingX={SCIENCE_CARD.slot.topPaddingX}
            paddingY={SCIENCE_CARD.slot.topPaddingY}
            paddingTop={SCIENCE_CARD.slot.topPaddingTop}
            paddingBottom={SCIENCE_CARD.slot.topPaddingBottom}
            lineHeight={computed.topLineHeight}
            fontWeight={800}
            textAlign="center"
          />
        </div>

        <div
          style={{
            position: "absolute",
            left: 0,
            top: computed.topBlockHeight,
            width: SCIENCE_CARD.card.width,
            height: computed.videoHeight,
            zIndex: 1
          }}
        >
          <OffthreadVideo
            src={sourceUrl}
            startFrom={startFrom}
            endAt={endAt}
            style={{
              width: SCIENCE_CARD.card.width,
              height: computed.videoHeight,
              objectFit: "cover",
              objectPosition,
              transform: slotTransform,
              transformOrigin: "center center"
            }}
            volume={1}
          />
        </div>

        <div
          style={{
            position: "absolute",
            left: 0,
            top: SCIENCE_CARD.card.height - computed.bottomBlockHeight,
            width: SCIENCE_CARD.card.width,
            height: computed.bottomBlockHeight,
            backgroundColor: SCIENCE_CARD.card.fill,
            zIndex: 2,
            display: "grid",
            gridTemplateRows: `${SCIENCE_CARD.slot.bottomMetaHeight}px minmax(0, 1fr)`
          }}
        >
        <AuthorBlock
          authorName={authorName}
          authorHandle={authorHandle}
          avatarAssetFileName={avatarAssetFileName}
          avatarAssetMimeType={avatarAssetMimeType}
        />

          <OverlayText
            text={computed.bottom}
            fontSize={computed.bottomFont}
            maxLines={SCIENCE_CARD.typography.bottom.maxLines}
            paddingX={SCIENCE_CARD.slot.bottomTextPaddingX}
            paddingY={SCIENCE_CARD.slot.bottomTextPaddingY}
            paddingTop={SCIENCE_CARD.slot.bottomTextPaddingTop}
            paddingBottom={SCIENCE_CARD.slot.bottomTextPaddingBottom}
            paddingLeft={SCIENCE_CARD.slot.bottomTextPaddingLeft}
            paddingRight={SCIENCE_CARD.slot.bottomTextPaddingRight}
            lineHeight={computed.bottomLineHeight}
            fontWeight={500}
            textAlign="left"
            verticalAlign="start"
          />
        </div>
      </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
