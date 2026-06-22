import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeAutoGeometry,
  resolveStage3AutoGeometry,
  resolveTemplateMediaSlot,
  selectStage3AutoGeometryPatch,
  shouldApplyStage3AutoGeometryBaseline
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

test("agent wrapper crop -> aspect from POST-crop region, exact region_height (THE LIGHT KINGDOM)", async () => {
  // The real L/R-bar bug: agent eyeballed mediaRegionHeightPx slightly too small so
  // the slot was wider than the content -> pillarbox. Deterministic computes the
  // EXACT slot height from the post-crop aspect, so slot aspect == content aspect.
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    sourceCrop: { enabled: true, x: 0.0185, y: 0.3375, width: 0.963, height: 0.407 },
    probeDimensions: stubProbe(1080, 1920),
    detectContentRect: async () => {
      throw new Error("cropdetect must NOT run when a non-full agent crop is provided");
    }
  });
  assert.ok(result);
  const expectedAspect = (0.963 * 1080) / (0.407 * 1920); // ~1.33, wider than slot 1.21
  assert.ok(Math.abs(result!.contentAspect - expectedAspect) < 0.001, `got ${result!.contentAspect}`);
  assert.equal(result!.decision.mode, "region_height");
  // slot height set so slotWidth/height == content aspect (no L/R bars under contain OR cover)
  const expectedHeight = SLOT.slotWidthPx / expectedAspect;
  assert.ok(
    Math.abs(result!.patch.mediaRegionHeightPx! - expectedHeight) <= 2,
    `got ${result!.patch.mediaRegionHeightPx}, expected ~${Math.round(expectedHeight)}`
  );
  assert.equal(result!.patch.sourceCrop, undefined); // agent crop wins via mergeAutoGeometry
});

test("agent full-frame crop (0,0,1,1) falls back to cropdetect", async () => {
  let called = false;
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    sourceCrop: { enabled: true, x: 0, y: 0, width: 1, height: 1 },
    probeDimensions: stubProbe(960, 720), // clean 4:3 boxing source (King Leo)
    detectContentRect: async () => {
      called = true;
      return NO_BARS;
    }
  });
  assert.ok(result);
  assert.equal(called, true);
  // 4:3 full frame (1.33) wider than slot 1.21 -> region_height
  assert.equal(result!.decision.mode, "region_height");
  assert.ok(Math.abs(result!.contentAspect - 960 / 720) < 0.001);
});

test("channel-story fallback crop still allows cropdetect to replace top/bottom bars", async () => {
  let called = false;
  const detected: DetectedSourceContent = {
    hasBars: true,
    rect: { x: 0, y: 0.16, width: 1, height: 0.68 },
    pixelCrop: { w: 1080, h: 1306, x: 0, y: 307 }
  };
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    sourceCrop: {
      enabled: true,
      x: 0,
      y: 0,
      width: 1,
      height: 0.84,
      confidence: 0.86,
      source: "channel-story-lower-source-strip-v1"
    },
    probeDimensions: stubProbe(1080, 1920),
    detectContentRect: async () => {
      called = true;
      return detected;
    }
  });

  assert.ok(result);
  assert.equal(called, true);
  assert.equal(result!.patch.sourceCrop?.source, "auto-aspect-fit");
  assert.equal(result!.patch.sourceCrop?.y, 0.16);
  assert.equal(result!.patch.sourceCrop?.height, 0.68);
});

test("channel-story fallback crop enables sparse overlay wrapper detection", async () => {
  let receivedParams: { detectSparseOverlayWrapper?: boolean } | null = null;
  const detected: DetectedSourceContent = {
    hasBars: true,
    rect: { x: 0.083333, y: 0.252336, width: 0.833333, height: 0.733645 },
    pixelCrop: { w: 600, h: 939, x: 60, y: 323 }
  };
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    sourceCrop: {
      enabled: true,
      x: 0,
      y: 0,
      width: 1,
      height: 0.84,
      confidence: 0.86,
      source: "channel-story-lower-source-strip-v1"
    },
    probeDimensions: stubProbe(720, 1280),
    detectContentRect: async (params) => {
      receivedParams = params;
      return detected;
    }
  });

  assert.ok(result);
  assert.ok(receivedParams);
  assert.equal((receivedParams as { detectSparseOverlayWrapper?: boolean }).detectSparseOverlayWrapper, true);
  assert.equal(result!.patch.sourceCrop?.source, "auto-aspect-fit");
  assert.equal(result!.patch.sourceCrop?.y, 0.252336);
  assert.equal(result!.patch.sourceCrop?.height, 0.733645);
});

test("non-fallback crop does not enable sparse overlay wrapper detection", async () => {
  let receivedParams: { detectSparseOverlayWrapper?: boolean } | null = null;
  const result = await resolveStage3AutoGeometry({
    sourcePath: "/tmp/fake.mp4",
    ...SLOT,
    probeDimensions: stubProbe(720, 1280),
    detectContentRect: async (params) => {
      receivedParams = params;
      return NO_BARS;
    }
  });

  assert.ok(result);
  assert.ok(receivedParams);
  assert.equal((receivedParams as { detectSparseOverlayWrapper?: boolean }).detectSparseOverlayWrapper, false);
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

test("mergeAutoGeometry: channel-story fallback crop is replaced by detected crop", () => {
  const merged = mergeAutoGeometry(
    {
      sourceCrop: {
        enabled: true,
        x: 0,
        y: 0,
        width: 1,
        height: 0.84,
        confidence: 0.86,
        source: "channel-story-lower-source-strip-v1"
      }
    },
    {
      sourceCrop: { enabled: true, x: 0, y: 0.18, width: 1, height: 0.66, confidence: null, source: "auto-aspect-fit" }
    }
  );
  assert.deepEqual(merged.sourceCrop, {
    enabled: true,
    x: 0,
    y: 0.18,
    width: 1,
    height: 0.66,
    confidence: null,
    source: "auto-aspect-fit"
  });
});

test("selectStage3AutoGeometryPatch keeps authoritative fallback replacement crop-only", () => {
  const selected = selectStage3AutoGeometryPatch({
    hasAuthoritativeSnapshot: true,
    sourceCrop: { enabled: true, x: 0, y: 0, width: 1, height: 0.84, source: "channel-story-lower-source-strip-v1" },
    patch: {
      mediaRegionHeightPx: 510,
      videoFit: "cover",
      sourceCrop: { enabled: true, x: 0, y: 0.18, width: 1, height: 0.66, confidence: null, source: "auto-aspect-fit" }
    }
  });

  assert.deepEqual(selected, {
    sourceCrop: { enabled: true, x: 0, y: 0.18, width: 1, height: 0.66, confidence: null, source: "auto-aspect-fit" }
  });
});

test("mergeAutoGeometry: no patch returns a copy of the raw plan", () => {
  const raw = { videoFit: "contain" as const };
  const merged = mergeAutoGeometry(raw, null);
  assert.deepEqual(merged, raw);
  assert.notEqual(merged, raw);
});

test("auto-geometry baseline does not override an authoritative live-preview snapshot", () => {
  assert.equal(
    shouldApplyStage3AutoGeometryBaseline({ hasAuthoritativeSnapshot: true }),
    false
  );
  assert.equal(
    shouldApplyStage3AutoGeometryBaseline({
      hasAuthoritativeSnapshot: true,
      sourceCrop: { enabled: true, x: 0, y: 0, width: 1, height: 0.84, source: "channel-story-lower-source-strip-v1" }
    }),
    true
  );
  assert.equal(
    shouldApplyStage3AutoGeometryBaseline({ hasAuthoritativeSnapshot: false }),
    true
  );
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
