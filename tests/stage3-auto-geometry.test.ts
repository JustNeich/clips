import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeAutoGeometry,
  resolveStage3AutoGeometry,
  resolveTemplateMediaSlot
} from "../lib/stage3-auto-geometry";
import type { DetectedSourceContent } from "../lib/stage3-source-content-detect";
import { STAGE3_TEMPLATE_ID } from "../lib/stage3-template";

// King Leo / science-card media slot.
const SLOT = { slotWidthPx: 907, slotHeightPx: 750 };

function stubProbe(width: number, height: number) {
  return async () => ({ width, height });
}

const NO_BARS: DetectedSourceContent = { rect: null, hasBars: false, pixelCrop: null };
async function stubDetectNoBars(): Promise<DetectedSourceContent> {
  return NO_BARS;
}

test("16:9 source (wider than slot) -> region_height shrink, card shorter, cover", async () => {
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    probeDimensions: stubProbe(1920, 1080),
    detectContentRect: stubDetectNoBars
  });
  assert.ok(result);
  assert.equal(result!.decision.mode, "region_height");
  assert.equal(result!.patch.videoFit, "cover");
  assert.ok(result!.patch.mediaRegionHeightPx! < SLOT.slotHeightPx);
  assert.equal(result!.escalateToJudge, false);
});

test("1:1 source (narrower) -> bounded zoom (cover), no region shrink, no escalation", async () => {
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    probeDimensions: stubProbe(1080, 1080),
    detectContentRect: stubDetectNoBars
  });
  assert.ok(result);
  assert.equal(result!.decision.mode, "zoom");
  assert.equal(result!.patch.videoFit, "cover");
  assert.equal(result!.patch.mediaRegionHeightPx, undefined);
  assert.equal(result!.escalateToJudge, false);
});

test("9:16 ultra-narrow source -> zoom flagged for judge (no over-cap stretch)", async () => {
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    probeDimensions: stubProbe(1080, 1920),
    detectContentRect: stubDetectNoBars
  });
  assert.ok(result);
  assert.equal(result!.decision.mode, "zoom");
  assert.equal(result!.patch.videoScaleX, undefined);
  assert.equal(result!.escalateToJudge, true);
  assert.ok(result!.escalationReason);
});

test("5:1 ultra-wide source -> region_height floor-clamped, escalated", async () => {
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    probeDimensions: stubProbe(2500, 500),
    detectContentRect: stubDetectNoBars
  });
  assert.ok(result);
  assert.equal(result!.decision.mode, "region_height");
  assert.ok(result!.patch.mediaRegionHeightPx! >= SLOT.slotHeightPx * 0.45);
  assert.equal(result!.escalateToJudge, true);
});

test("baked-in bars detected -> sourceCrop set, aspect from inner rect", async () => {
  // A 1000x1080 source whose real picture is a 16:9 band (1000x562) centered.
  const detected: DetectedSourceContent = {
    hasBars: true,
    rect: { x: 0, y: 0.24, width: 1, height: 0.52 },
    pixelCrop: { w: 1000, h: 562, x: 0, y: 259 }
  };
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    probeDimensions: stubProbe(1000, 1080),
    detectContentRect: async () => detected
  });
  assert.ok(result);
  // inner content is ~16:9 (wider) -> region_height + sourceCrop carrying the band.
  assert.equal(result!.decision.mode, "region_height");
  assert.ok(result!.patch.sourceCrop);
  assert.equal(result!.patch.sourceCrop!.enabled, true);
  assert.ok(Math.abs(result!.contentAspect - 1000 / 562) < 0.01);
});

test("unprobeable source -> null (never blocks the render)", async () => {
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    probeDimensions: async () => null,
    detectContentRect: stubDetectNoBars
  });
  assert.equal(result, null);
});

test("degenerate slot -> null", async () => {
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    slotWidthPx: 0,
    slotHeightPx: 750,
    probeDimensions: stubProbe(1920, 1080),
    detectContentRect: stubDetectNoBars
  });
  assert.equal(result, null);
});

test("mergeAutoGeometry fills unset fields", () => {
  const merged = mergeAutoGeometry(
    {},
    { mediaRegionHeightPx: 510, videoFit: "cover" }
  );
  assert.equal(merged.mediaRegionHeightPx, 510);
  assert.equal(merged.videoFit, "cover");
});

test("mergeAutoGeometry: explicit agent override wins", () => {
  const merged = mergeAutoGeometry(
    { mediaRegionHeightPx: 600, videoFit: "contain" },
    { mediaRegionHeightPx: 510, videoFit: "cover" }
  );
  assert.equal(merged.mediaRegionHeightPx, 600);
  assert.equal(merged.videoFit, "contain");
});

test("mergeAutoGeometry: agent sourceCrop kept, other baseline fields still filled", () => {
  const agentCrop = {
    enabled: true,
    x: 0,
    y: 0.1,
    width: 1,
    height: 0.6,
    confidence: 0.9,
    source: "editor"
  };
  const merged = mergeAutoGeometry(
    { sourceCrop: agentCrop },
    {
      mediaRegionHeightPx: 510,
      videoFit: "cover",
      sourceCrop: { enabled: true, x: 0, y: 0.3, width: 1, height: 0.4, confidence: null, source: "auto-aspect-fit" }
    }
  );
  assert.deepEqual(merged.sourceCrop, agentCrop);
  assert.equal(merged.mediaRegionHeightPx, 510);
});

test("mergeAutoGeometry: no patch returns a copy of the raw plan", () => {
  const raw = { videoFit: "contain" as const };
  const merged = mergeAutoGeometry(raw, null);
  assert.deepEqual(merged, raw);
  assert.notEqual(merged, raw);
});

test("resolveTemplateMediaSlot returns positive slot dimensions for the default template", () => {
  const slot = resolveTemplateMediaSlot({
    templateId: STAGE3_TEMPLATE_ID,
    topText: "Top line",
    bottomText: "Bottom line"
  });
  assert.ok(slot.slotWidthPx > 0);
  assert.ok(slot.slotHeightPx > 0);
});
