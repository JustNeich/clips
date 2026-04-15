import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STAGE3_VIDEO_ADJUSTMENTS,
  applyStage3VideoAdjustmentsToRenderPlan,
  buildStage3VideoFilterCss,
  normalizeStage3VideoAdjustments,
  readStage3VideoAdjustmentsFromRenderPlan
} from "../lib/stage3-video-adjustments";

test("normalizeStage3VideoAdjustments clamps all controls into the supported range", () => {
  const normalized = normalizeStage3VideoAdjustments({
    brightness: 2.4,
    exposure: -2,
    contrast: 0.2,
    saturation: 3.1
  });

  assert.deepEqual(normalized, {
    brightness: 1.8,
    exposure: -1,
    contrast: 0.5,
    saturation: 2
  });
});

test("buildStage3VideoFilterCss combines brightness, exposure, contrast, saturation and blur", () => {
  const filter = buildStage3VideoFilterCss(
    {
      brightness: 1.1,
      exposure: 0.5,
      contrast: 1.2,
      saturation: 0.9
    },
    {
      blurPx: 12,
      baseBrightness: 0.8,
      baseSaturation: 1.05
    }
  );

  assert.equal(filter, "blur(12px) brightness(1.245) contrast(1.200) saturate(0.945)");
});

test("render-plan helpers round-trip template defaults into Stage 3 fields", () => {
  const defaults = {
    brightness: 1.18,
    exposure: -0.25,
    contrast: 1.14,
    saturation: 0.88
  };
  const applied = applyStage3VideoAdjustmentsToRenderPlan(
    {
      templateId: "science-card-v1"
    },
    defaults
  );
  const roundTripped = readStage3VideoAdjustmentsFromRenderPlan(applied, DEFAULT_STAGE3_VIDEO_ADJUSTMENTS);

  assert.deepEqual(roundTripped, defaults);
});
