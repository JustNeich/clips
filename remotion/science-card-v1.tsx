import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile } from "remotion";
import {
  SCIENCE_CARD,
  SCIENCE_CARD_TEMPLATE_ID,
  TURBO_FACE,
  TURBO_FACE_TEMPLATE_ID,
  getTemplateComputed
} from "../lib/stage3-template";

type ScienceCardV1Props = {
  templateId?: string;
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
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
  verticalAlign = "center"
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
          color: "#0b1018",
          fontSize,
          lineHeight,
          fontWeight,
          textAlign,
          fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
          letterSpacing: textAlign === "center" ? "-0.015em" : "-0.005em",
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
  avatarAssetFileName,
  avatarAssetMimeType,
  backgroundAssetFileName,
  backgroundAssetMimeType
}: ScienceCardV1Props): React.JSX.Element {
  const sourceUrl = staticFile("source.mp4");
  const isTurbo = templateId === TURBO_FACE_TEMPLATE_ID;
  const frame = isTurbo ? TURBO_FACE.frame : SCIENCE_CARD.frame;
  const hasCustomBackground = Boolean(backgroundAssetFileName);
  const customBackgroundSrc = hasCustomBackground ? staticFile(backgroundAssetFileName as string) : null;
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
  const objectPosition = `50% ${Math.round(Math.min(88, Math.max(12, focusY * 100)))}%`;
  const normalizedZoom = Math.min(1.6, Math.max(1, Number.isFinite(videoZoom) ? videoZoom : 1));

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
              filter: "blur(16px) brightness(0.82) saturate(1.05)"
            }}
            volume={0}
          />
        )}
      </AbsoluteFill>

      {isTurbo ? (
        <>
          <AbsoluteFill
            style={{
              left: TURBO_FACE.top.x,
              top: TURBO_FACE.top.y,
              width: TURBO_FACE.top.width,
              height: computed.topBlockHeight,
              borderRadius: TURBO_FACE.top.radius,
              backgroundColor: "#ffffff",
              boxShadow: "0 14px 32px rgba(0,0,0,0.22)",
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
          />
          </AbsoluteFill>

          <AbsoluteFill
            style={{
              left: computed.videoX,
              top: computed.videoY,
              width: computed.videoWidth,
              height: computed.videoHeight,
              overflow: "hidden"
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
                transform: `scale(${normalizedZoom})`,
                transformOrigin: "center center"
              }}
              volume={1}
            />
          </AbsoluteFill>

          <AbsoluteFill
            style={{
              left: TURBO_FACE.bottom.x,
              top: frame.height - TURBO_FACE.bottom.bottom - computed.bottomBlockHeight,
              width: TURBO_FACE.bottom.width,
              height: computed.bottomBlockHeight,
              borderRadius: TURBO_FACE.bottom.radius,
              backgroundColor: "#ffffff",
              boxShadow: "0 16px 36px rgba(0,0,0,0.26)",
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
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {avatarAssetFileName && (avatarAssetMimeType ?? "").toLowerCase().startsWith("image/") ? (
                  <Img
                    src={staticFile(avatarAssetFileName)}
                    style={{
                      width: TURBO_FACE.author.avatarSize,
                      height: TURBO_FACE.author.avatarSize,
                      borderRadius: 999,
                      border: `${TURBO_FACE.author.avatarBorder}px solid rgba(0,0,0,0.18)`,
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
                      border: `${TURBO_FACE.author.avatarBorder}px solid rgba(0,0,0,0.18)`,
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        color: "#0c1018",
                        fontWeight: 700,
                        fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
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
                        background: "#bf5cf4",
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
                      color: "#666666",
                      fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
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
              lineHeight={computed.bottomLineHeight}
              fontWeight={400}
              textAlign="left"
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
              transform: `scale(${normalizedZoom})`,
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
