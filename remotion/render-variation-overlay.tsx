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

  // Pre-bake the static fractal-noise SVG into a single data-URL <img>. The seed
  // is fixed, so the noise is byte-identical on every frame; rendering it as an
  // <img> makes the browser rasterize the feTurbulence filter ONCE during decode
  // and reuse the cached bitmap for all captured frames, instead of re-rasterizing
  // a live inline SVG filter region on every painted frame. Visually equivalent.
  const noiseSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920" preserveAspectRatio="none">` +
    `<defs><filter id="${filterId}">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${profile.signal.baseFrequencyX} ${profile.signal.baseFrequencyY}" numOctaves="${profile.signal.numOctaves}" seed="${profile.signal.seed}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `</filter></defs>` +
    `<rect x="0" y="0" width="1080" height="1920" filter="url(#${filterId})"/>` +
    `</svg>`;
  const noiseDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(noiseSvg)}`;

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity: profile.signal.opacity,
        mixBlendMode: profile.signal.blendMode
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={noiseDataUrl}
        width={1080}
        height={1920}
        style={{ width: "100%", height: "100%", display: "block" }}
        alt=""
      />
    </AbsoluteFill>
  );
}
