import assert from "node:assert/strict";
import test from "node:test";

import { resolveStage3AspectFit } from "../lib/stage3-aspect-fit";
import { resolveStage3EffectiveMediaGeometry } from "../lib/stage3-media-geometry";
import { computeViewportBox } from "../lib/stage3-media-agent";
import type { Stage3StateSnapshot } from "../app/components/types";

// science-card media region geometry.
const REGION = { regionWidthPx: 907, regionHeightPx: 750 }; // aspect ~1.209

test("content ~ region aspect -> cover, no change", () => {
  const d = resolveStage3AspectFit({ contentAspect: 1.21, ...REGION });
  assert.equal(d.mode, "cover");
  assert.equal(d.patch.videoFit, "cover");
  assert.equal(d.patch.mediaRegionHeightPx, undefined);
});

test("GGG: 16:9 content (wider) -> Option A region-height shrink", () => {
  const d = resolveStage3AspectFit({ contentAspect: 16 / 9, ...REGION });
  assert.equal(d.mode, "region_height");
  assert.equal(d.patch.videoFit, "cover");
  assert.ok(d.patch.mediaRegionHeightPx);
  // 907 / 1.778 ≈ 510 px
  assert.ok(Math.abs(d.patch.mediaRegionHeightPx! - 510) <= 4, `got ${d.patch.mediaRegionHeightPx}`);
  // shorter than the default region height
  assert.ok(d.patch.mediaRegionHeightPx! < REGION.regionHeightPx);

  const geometry = resolveStage3EffectiveMediaGeometry({
    regionWidthPx: REGION.regionWidthPx,
    regionHeightPx: REGION.regionHeightPx,
    mediaRegionHeightPx: d.patch.mediaRegionHeightPx,
    videoScaleX: d.patch.videoScaleX
  });
  assert.equal(geometry.regionHeightPx, d.patch.mediaRegionHeightPx);
  assert.ok(Math.abs(geometry.cropAspect - 16 / 9) < 0.01, `got ${geometry.cropAspect}`);
});

test("mediaRegionHeightPx makes offline viewport keep a 16:9 source without top/bottom crop", () => {
  const d = resolveStage3AspectFit({ contentAspect: 16 / 9, ...REGION });
  const snapshot = {
    topText: "Top",
    bottomText: "Bottom",
    focusY: 0.5,
    renderPlan: {
      templateId: "science-card-v1",
      topFontScale: 1.25,
      bottomFontScale: 1.25,
      videoZoom: 1,
      mediaRegionHeightPx: d.patch.mediaRegionHeightPx,
      videoScaleX: 1,
      videoScaleY: 1
    }
  } as Stage3StateSnapshot;

  const viewport = computeViewportBox(snapshot, { width: 1920, height: 1080 });
  assert.equal(viewport.width, 1920);
  assert.ok(viewport.height >= 1078, `got ${viewport.height}`);
  assert.ok(Math.abs(viewport.slotAspect - 16 / 9) < 0.01, `got ${viewport.slotAspect}`);
});

test("Beterbiev: 1:1 content (narrower) -> bounded zoom (cover), ~17% crop", () => {
  const d = resolveStage3AspectFit({ contentAspect: 1.0, ...REGION });
  assert.equal(d.mode, "zoom");
  assert.equal(d.patch.videoFit, "cover");
  assert.ok(d.estimatedCoverCropFraction! > 0.15 && d.estimatedCoverCropFraction! < 0.2);
});

test("very narrow 9:16 content -> zoom flagged (no over-cap stretch)", () => {
  const d = resolveStage3AspectFit({ contentAspect: 9 / 16, ...REGION });
  assert.equal(d.mode, "zoom");
  assert.equal(d.patch.videoFit, "cover");
  assert.equal(d.patch.videoScaleX, undefined);
  assert.ok(d.estimatedCoverCropFraction! > 0.4);
});

test("region-height never grows beyond default and respects the floor", () => {
  // extremely wide content would shrink a lot; floor clamps it.
  const d = resolveStage3AspectFit({ contentAspect: 5.0, ...REGION });
  assert.equal(d.mode, "region_height");
  assert.ok(d.patch.mediaRegionHeightPx! >= 750 * 0.45);
  assert.ok(d.patch.mediaRegionHeightPx! <= 750);
});

test("slight stretch path triggers when cover crop is too big but stretch is small", () => {
  // square region, slightly narrow content, strict cover cap -> stretch under 1.08.
  const d = resolveStage3AspectFit({
    contentAspect: 0.93,
    regionWidthPx: 1000,
    regionHeightPx: 1000,
    caps: { maxCoverCrop: 0.05 }
  });
  assert.equal(d.mode, "stretch");
  assert.equal(d.patch.videoFit, "contain");
  assert.ok(d.patch.videoScaleX! > 1 && d.patch.videoScaleX! <= 1.08);
});

test("4:3 content in a 16:9 region uses zoom-fill instead of over-cap stretch", () => {
  const d = resolveStage3AspectFit({
    contentAspect: 4 / 3,
    regionWidthPx: 1600,
    regionHeightPx: 900
  });
  assert.equal(d.mode, "zoom");
  assert.equal(d.patch.videoFit, "cover");
  assert.equal(d.patch.videoScaleX, undefined);
  assert.ok(d.estimatedCoverCropFraction! > 0.2);
});

test("stretch cap is enforced at 1.08", () => {
  const d = resolveStage3AspectFit({
    contentAspect: 0.92,
    regionWidthPx: 1000,
    regionHeightPx: 1000,
    caps: { maxCoverCrop: 0.05 }
  });
  assert.equal(d.mode, "zoom");
  assert.equal(d.patch.videoFit, "cover");
  assert.equal(d.patch.videoScaleX, undefined);
});
