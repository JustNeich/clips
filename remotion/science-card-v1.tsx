import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile } from "remotion";
import { SCIENCE_CARD, getScienceCardComputed } from "../lib/stage3-template";

type ScienceCardV1Props = {
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  backgroundAssetFileName?: string | null;
  backgroundAssetMimeType?: string | null;
};

function OverlayText({
  text,
  fontSize,
  maxLines,
  paddingX,
  paddingY,
  lineHeight,
  fontWeight,
  textAlign = "center"
}: {
  text: string;
  fontSize: number;
  maxLines: number;
  paddingX: number;
  paddingY: number;
  lineHeight: number;
  fontWeight: number;
  textAlign?: "left" | "center";
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        overflow: "hidden",
        padding: `${paddingY}px ${paddingX}px`
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

function AuthorBlock(): React.JSX.Element {
  return (
    <div
      style={{
        width: "100%",
        height: SCIENCE_CARD.slot.bottomMetaHeight,
        padding: `${SCIENCE_CARD.slot.bottomMetaPaddingY}px ${SCIENCE_CARD.slot.bottomMetaPaddingX}px`,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 16,
        backgroundColor: "#ffffff",
        borderTop: "1px solid rgba(8, 12, 19, 0.12)",
        borderBottom: "1px solid rgba(8, 12, 19, 0.12)"
      }}
    >
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
        SS
      </div>
      <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
            {SCIENCE_CARD.author.name}
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
          {SCIENCE_CARD.author.handle}
        </span>
      </div>
    </div>
  );
}

export function ScienceCardV1({
  topText,
  bottomText,
  clipStartSec,
  clipDurationSec,
  focusY,
  backgroundAssetFileName,
  backgroundAssetMimeType
}: ScienceCardV1Props): React.JSX.Element {
  const sourceUrl = staticFile("source.mp4");
  const hasCustomBackground = Boolean(backgroundAssetFileName);
  const customBackgroundSrc = hasCustomBackground ? staticFile(backgroundAssetFileName as string) : null;
  const customBackgroundIsVideo =
    hasCustomBackground && (backgroundAssetMimeType ?? "").toLowerCase().startsWith("video/");
  const computed = getScienceCardComputed(topText, bottomText);
  const fps = 30;
  const startFrom = Math.max(0, Math.round(clipStartSec * fps));
  const clipFrames = Math.max(1, Math.round(clipDurationSec * fps));
  const endAt = startFrom + clipFrames;
  const objectPosition = `50% ${Math.round(Math.min(88, Math.max(12, focusY * 100)))}%`;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#060606",
        width: SCIENCE_CARD.frame.width,
        height: SCIENCE_CARD.frame.height
      }}
    >
      <AbsoluteFill>
        {customBackgroundSrc ? (
          customBackgroundIsVideo ? (
            <OffthreadVideo
              src={customBackgroundSrc}
              style={{
                width: SCIENCE_CARD.frame.width,
                height: SCIENCE_CARD.frame.height,
                objectFit: "cover",
                objectPosition: "center center"
              }}
              volume={0}
            />
          ) : (
            <Img
              src={customBackgroundSrc}
              style={{
                width: SCIENCE_CARD.frame.width,
                height: SCIENCE_CARD.frame.height,
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
              width: SCIENCE_CARD.frame.width,
              height: SCIENCE_CARD.frame.height,
              objectFit: "cover",
              objectPosition,
              filter: "blur(16px) brightness(0.82) saturate(1.05)"
            }}
            volume={0}
          />
        )}
      </AbsoluteFill>

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
          boxSizing: "border-box"
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: SCIENCE_CARD.card.width,
            height: SCIENCE_CARD.slot.topHeight,
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
            lineHeight={SCIENCE_CARD.typography.top.lineHeight}
            fontWeight={800}
            textAlign="center"
          />
        </div>

        <div
          style={{
            position: "absolute",
            left: 0,
            top: SCIENCE_CARD.slot.topHeight,
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
              objectPosition
            }}
            volume={1}
          />
        </div>

        <div
          style={{
            position: "absolute",
            left: 0,
            top: SCIENCE_CARD.card.height - SCIENCE_CARD.slot.bottomHeight,
            width: SCIENCE_CARD.card.width,
            height: SCIENCE_CARD.slot.bottomHeight,
            backgroundColor: SCIENCE_CARD.card.fill,
            zIndex: 2,
            display: "grid",
            gridTemplateRows: `${SCIENCE_CARD.slot.bottomMetaHeight}px minmax(0, 1fr)`
          }}
        >
          <AuthorBlock />

          <OverlayText
            text={computed.bottom}
            fontSize={computed.bottomFont}
            maxLines={SCIENCE_CARD.typography.bottom.maxLines}
            paddingX={SCIENCE_CARD.slot.bottomTextPaddingX}
            paddingY={SCIENCE_CARD.slot.bottomTextPaddingY}
            lineHeight={SCIENCE_CARD.typography.bottom.lineHeight}
            fontWeight={500}
            textAlign="left"
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
