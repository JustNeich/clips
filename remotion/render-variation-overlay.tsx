import React from "react";
import { AbsoluteFill } from "remotion";
import type { Stage3VariationProfile } from "../lib/stage3-render-variation";

type RenderVariationOverlayProps = {
  profile: Stage3VariationProfile | null | undefined;
};

export function RenderVariationOverlay({
  profile
}: RenderVariationOverlayProps): React.JSX.Element | null {
  if (!profile?.signal.enabled || profile.appliedMode !== "hybrid") {
    return null;
  }

  const filterId = `stage3-variation-noise-${profile.seed.slice(0, 8)}`;

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: profile.signal.opacity,
        mixBlendMode: profile.signal.blendMode
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1080 1920"
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%" }}
      >
        <defs>
          <filter id={filterId}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency={`${profile.signal.baseFrequencyX} ${profile.signal.baseFrequencyY}`}
              numOctaves={profile.signal.numOctaves}
              seed={profile.signal.seed}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <rect x="0" y="0" width="1080" height="1920" filter={`url(#${filterId})`} />
      </svg>
    </AbsoluteFill>
  );
}
