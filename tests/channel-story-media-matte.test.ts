import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveChannelStoryContainedMediaMatteStyles,
  resolveChannelStoryFullFrameSourceMatteStyles
} from "../lib/channel-story-media-matte";

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type MatteStyles = ReturnType<typeof resolveChannelStoryContainedMediaMatteStyles>;

const REPRESENTATIVE_SOURCE_EDGE: Rgb = { r: 96, g: 152, b: 214 };
const CLIP_TO_MATTE_SEAM_PERCENT = 42;
const BOTTOM_STRIP_PERCENT = 99;

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    assert.fail(`expected ${label} to be a string, got ${typeof value}`);
  }
  return value;
}

function parseHexRgb(value: unknown): Rgb {
  const color = expectString(value, "hex color");
  const match = color.match(/^#([0-9a-f]{6})$/i);
  assert.ok(match, `expected a 6-digit hex color, got ${color}`);
  const hex = match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
}

function parseFilterNumber(filter: unknown, name: string): number {
  const filterValue = expectString(filter, "filter");
  const match = filterValue.match(new RegExp(`${name}\\(([0-9.]+)\\)`));
  assert.ok(match, `expected ${name}() in filter ${filterValue}`);
  return Number(match[1]);
}

function sampleGradient(background: unknown, percent: number): { rgb: Rgb; alpha: number } {
  const gradient = expectString(background, "density overlay background");
  const stops = Array.from(
    gradient.matchAll(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)\s+([0-9.]+)%/g)
  )
    .map((match) => ({
      rgb: {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3])
      },
      alpha: Number(match[4]),
      percent: Number(match[5])
    }))
    .sort((a, b) => a.percent - b.percent);

  assert.ok(stops.length >= 2, `expected at least two rgba gradient stops in ${gradient}`);

  const after = stops.find((stop) => stop.percent >= percent) ?? stops[stops.length - 1];
  const before = [...stops].reverse().find((stop) => stop.percent <= percent) ?? stops[0];
  const span = after.percent - before.percent;
  const t = span === 0 ? 0 : (percent - before.percent) / span;

  return {
    rgb: {
      r: before.rgb.r + (after.rgb.r - before.rgb.r) * t,
      g: before.rgb.g + (after.rgb.g - before.rgb.g) * t,
      b: before.rgb.b + (after.rgb.b - before.rgb.b) * t
    },
    alpha: before.alpha + (after.alpha - before.alpha) * t
  };
}

function applyMatteFilters(rgb: Rgb, filter: unknown): Rgb {
  const brightness = parseFilterNumber(filter, "brightness");
  const contrast = parseFilterNumber(filter, "contrast");
  const saturate = parseFilterNumber(filter, "saturate");
  let r = rgb.r * brightness;
  let g = rgb.g * brightness;
  let b = rgb.b * brightness;

  r = (r - 128) * contrast + 128;
  g = (g - 128) * contrast + 128;
  b = (b - 128) * contrast + 128;

  const luma = luminance({ r, g, b });
  return {
    r: luma + (r - luma) * saturate,
    g: luma + (g - luma) * saturate,
    b: luma + (b - luma) * saturate
  };
}

function blendOver(overlay: Rgb, base: Rgb, alpha: number): Rgb {
  return {
    r: overlay.r * alpha + base.r * (1 - alpha),
    g: overlay.g * alpha + base.g * (1 - alpha),
    b: overlay.b * alpha + base.b * (1 - alpha)
  };
}

function luminance(rgb: Rgb): number {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function describeRgb(rgb: Rgb): string {
  return `rgb(${rgb.r.toFixed(1)}, ${rgb.g.toFixed(1)}, ${rgb.b.toFixed(1)})`;
}

function sampleContainedMatte(styles: MatteStyles, percent: number): Rgb {
  const underlay = applyMatteFilters(REPRESENTATIVE_SOURCE_EDGE, styles.underlayVideoStyle.filter);
  const overlay = sampleGradient(styles.densityOverlayStyle.background, percent);
  return blendOver(overlay.rgb, underlay, overlay.alpha);
}

function assertContainedMediaMatteVisualContract(styles: MatteStyles): void {
  const background = parseHexRgb(styles.containerStyle.background);
  const seam = sampleContainedMatte(styles, CLIP_TO_MATTE_SEAM_PERCENT);
  const bottom = sampleContainedMatte(styles, BOTTOM_STRIP_PERCENT);
  const bottomLuma = luminance(bottom);
  const seamLuma = luminance(seam);

  assert.ok(
    bottomLuma >= 8,
    `contained media matte collapsed into a pure black bottom strip: ${describeRgb(bottom)}`
  );
  assert.ok(
    colorDistance(bottom, background) >= 4,
    `bottom strip only shows the container background instead of source-video matte: ${describeRgb(bottom)}`
  );
  assert.ok(
    seamLuma >= bottomLuma + 5,
    `matte does not fade away from the clip edge; this creates a hard seam (${describeRgb(seam)} -> ${describeRgb(
      bottom
    )})`
  );
  assert.ok(
    seam.b >= seam.r + 4,
    `clip-edge matte lost the source hue and will read as a hard neutral seam: ${describeRgb(seam)}`
  );
}

test("channel-story contained media matte is a dense non-black underlay contract", () => {
  const styles = resolveChannelStoryContainedMediaMatteStyles();

  assert.equal(styles.containerStyle.background, "#050607");
  assert.notEqual(styles.containerStyle.background, "#000000");
  assert.equal(styles.containerStyle.overflow, "hidden");
  assert.equal(styles.underlayVideoStyle.left, -18);
  assert.equal(styles.underlayVideoStyle.top, -18);
  assert.equal(styles.underlayVideoStyle.width, "calc(100% + 36px)");
  assert.equal(styles.underlayVideoStyle.height, "calc(100% + 36px)");
  assert.match(String(styles.underlayVideoStyle.filter), /blur\(24px\)/);
  assert.match(String(styles.underlayVideoStyle.filter), /brightness\(0\.28\)/);
  assert.match(String(styles.underlayVideoStyle.filter), /saturate\(0\.72\)/);
  assert.equal(styles.underlayVideoStyle.transform, "scale(1.14)");
  assert.match(String(styles.densityOverlayStyle.background), /rgba\(5,6,7,0\.82\) 100%/);
});

test("channel-story full-frame source matte covers non-card frame edges", () => {
  const styles = resolveChannelStoryFullFrameSourceMatteStyles();

  assert.equal(styles.containerStyle.position, "absolute");
  assert.equal(styles.containerStyle.inset, 0);
  assert.equal(styles.containerStyle.background, "#08090a");
  assert.ok(luminance(parseHexRgb(styles.containerStyle.background)) >= 8);
  assert.equal(styles.containerStyle.overflow, "hidden");
  assert.equal(styles.containerStyle.pointerEvents, "none");
  assert.equal(styles.underlayVideoStyle.left, -36);
  assert.equal(styles.underlayVideoStyle.top, -36);
  assert.equal(styles.underlayVideoStyle.width, "calc(100% + 72px)");
  assert.equal(styles.underlayVideoStyle.height, "calc(100% + 72px)");
  assert.match(String(styles.underlayVideoStyle.filter), /blur\(34px\)/);
  assert.match(String(styles.underlayVideoStyle.filter), /brightness\(0\.32\)/);
  assert.match(String(styles.underlayVideoStyle.filter), /saturate\(0\.78\)/);
  assert.equal(styles.underlayVideoStyle.transform, "scale(1.18)");
  assert.match(String(styles.densityOverlayStyle.background), /rgba\(8,9,10,0\.66\) 100%/);
  assertContainedMediaMatteVisualContract(styles);
});

test("channel-story contained media matte model rejects black bottom strip and hard seam regressions", () => {
  const styles = resolveChannelStoryContainedMediaMatteStyles();

  assertContainedMediaMatteVisualContract(styles);
  assert.throws(
    () =>
      assertContainedMediaMatteVisualContract({
        ...styles,
        containerStyle: {
          ...styles.containerStyle,
          background: "#000000"
        },
        underlayVideoStyle: {
          ...styles.underlayVideoStyle,
          filter: "blur(0px) brightness(0) contrast(1) saturate(0)"
        },
        densityOverlayStyle: {
          ...styles.densityOverlayStyle,
          background: "linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 58%, rgba(0,0,0,1) 100%)"
        }
      }),
    /pure black bottom strip/
  );
  assert.throws(
    () =>
      assertContainedMediaMatteVisualContract({
        ...styles,
        densityOverlayStyle: {
          ...styles.densityOverlayStyle,
          background:
            "linear-gradient(180deg, rgba(5,6,7,0.82) 0%, rgba(5,6,7,0.82) 58%, rgba(5,6,7,0.82) 100%)"
        }
      }),
    /hard seam/
  );
});

test("template scene does not emit an over-media channel-story matte overlay", () => {
  const templateScene = readFileSync("lib/template-scene.tsx", "utf8");

  assert.doesNotMatch(templateScene, /channel-story-media-bottom-matte/);
  assert.doesNotMatch(templateScene, /channel-story-media-edge-guard/);
  assert.doesNotMatch(templateScene, /resolveChannelStoryContainedMediaMatteStyles/);
});

test("render and live preview use the shared contained media matte helper", () => {
  const renderSource = readFileSync("remotion/science-card-v1.tsx", "utf8");
  const previewSource = readFileSync("app/components/Step3RenderTemplate.tsx", "utf8");

  for (const source of [renderSource, previewSource]) {
    assert.match(source, /resolveChannelStoryContainedMediaMatteStyles/);
    assert.match(source, /resolveChannelStoryFullFrameSourceMatteStyles/);
    assert.doesNotMatch(source, /blur\(18px\) brightness\(0\.48\) saturate\(0\.85\)/);
    assert.doesNotMatch(source, /rgba\(0,0,0,0\.26\)/);
  }
  assert.match(renderSource, /shouldUseChannelStoryFullFrameMatte/);
  assert.match(previewSource, /shouldUseChannelStoryPreviewFullFrameMatte/);
  assert.match(renderSource, /shouldUseContainedMediaMatte && backgroundMode !== "custom"/);
  assert.match(previewSource, /shouldUseContainedPreviewMediaMatte && previewBackgroundMode !== "custom"/);
  assert.match(renderSource, /backgroundColor: shouldUseChannelStoryFullFrameMatte \? "#08090a" : "#060606"/);
});
