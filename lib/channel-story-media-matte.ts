import type { CSSProperties } from "react";

export type ChannelStoryContainedMediaMatteStyles = {
  containerStyle: CSSProperties;
  underlayVideoStyle: CSSProperties;
  densityOverlayStyle: CSSProperties;
};

export type ChannelStoryFullFrameSourceMatteStyles = {
  containerStyle: CSSProperties;
  underlayVideoStyle: CSSProperties;
  densityOverlayStyle: CSSProperties;
};

export type ChannelStoryEncodeEdgeFallbackStyles = {
  rootStyle: CSSProperties;
  physicalBottomEdgeStyle: CSSProperties;
};

export const CHANNEL_STORY_ENCODE_EDGE_FALLBACK_COLOR = "#121416";
export const CHANNEL_STORY_PHYSICAL_BOTTOM_EDGE_FALLBACK_HEIGHT_PX = 48;

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

export function resolveChannelStoryFullFrameSourceMatteStyles(): ChannelStoryFullFrameSourceMatteStyles {
  return {
    containerStyle: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      background: CHANNEL_STORY_ENCODE_EDGE_FALLBACK_COLOR,
      overflow: "hidden",
      pointerEvents: "none"
    },
    underlayVideoStyle: {
      position: "absolute",
      left: -36,
      top: -36,
      width: "calc(100% + 72px)",
      height: "calc(100% + 72px)",
      objectFit: "cover",
      objectPosition: "center center",
      filter: "blur(34px) brightness(0.32) contrast(1.08) saturate(0.78)",
      transform: "scale(1.18)",
      transformOrigin: "center center"
    },
    densityOverlayStyle: {
      position: "absolute",
      inset: -1,
      background:
        "linear-gradient(180deg, rgba(5,6,7,0.16) 0%, rgba(7,8,9,0.38) 58%, rgba(12,14,16,0.62) 100%)",
      pointerEvents: "none"
    }
  };
}

export function resolveChannelStoryEncodeEdgeFallbackStyles(): ChannelStoryEncodeEdgeFallbackStyles {
  return {
    rootStyle: {
      backgroundColor: CHANNEL_STORY_ENCODE_EDGE_FALLBACK_COLOR
    },
    physicalBottomEdgeStyle: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      width: "100%",
      height: CHANNEL_STORY_PHYSICAL_BOTTOM_EDGE_FALLBACK_HEIGHT_PX,
      backgroundColor: CHANNEL_STORY_ENCODE_EDGE_FALLBACK_COLOR,
      zIndex: 2147483647,
      pointerEvents: "none"
    }
  };
}
