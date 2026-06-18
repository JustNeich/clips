import type { CSSProperties } from "react";

export type ChannelStoryContainedMediaMatteStyles = {
  containerStyle: CSSProperties;
  underlayVideoStyle: CSSProperties;
  densityOverlayStyle: CSSProperties;
};

export function resolveChannelStoryContainedMediaMatteStyles(): ChannelStoryContainedMediaMatteStyles {
  return {
    containerStyle: {
      position: "relative",
      width: "100%",
      height: "100%",
      background: "#050607",
      overflow: "hidden"
    },
    underlayVideoStyle: {
      position: "absolute",
      left: -18,
      top: -18,
      width: "calc(100% + 36px)",
      height: "calc(100% + 36px)",
      objectFit: "cover",
      objectPosition: "center center",
      filter: "blur(24px) brightness(0.28) contrast(1.08) saturate(0.72)",
      transform: "scale(1.14)",
      transformOrigin: "center center"
    },
    densityOverlayStyle: {
      position: "absolute",
      inset: -1,
      background:
        "linear-gradient(180deg, rgba(5,6,7,0.22) 0%, rgba(5,6,7,0.54) 58%, rgba(5,6,7,0.82) 100%)",
      pointerEvents: "none"
    }
  };
}
