import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { SCIENCE_CARD, getScienceCardComputed } from "../lib/stage3-template";

type ScienceCardV1Props = {
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
};

function OverlayText({
  text,
  fontSize,
  maxLines,
  paddingX,
  paddingY
}: {
  text: string;
  fontSize: number;
  maxLines: number;
  paddingX: number;
  paddingY: number;
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
          color: "black",
          fontSize,
          lineHeight: SCIENCE_CARD.typography.top.lineHeight,
          fontWeight: 700,
          textAlign: "center",
          fontFamily: '"Arial","Helvetica Neue",Helvetica,sans-serif',
          letterSpacing: "-0.005em",
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

export function ScienceCardV1({
  topText,
  bottomText,
  clipStartSec,
  clipDurationSec,
  focusY
}: ScienceCardV1Props): React.JSX.Element {
  const sourceUrl = staticFile("source.mp4");
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
            zIndex: 2
          }}
        >
          <OverlayText
            text={computed.bottom}
            fontSize={computed.bottomFont}
            maxLines={SCIENCE_CARD.typography.bottom.maxLines}
            paddingX={SCIENCE_CARD.slot.bottomPaddingX}
            paddingY={SCIENCE_CARD.slot.bottomPaddingY}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
