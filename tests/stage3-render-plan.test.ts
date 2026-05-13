import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStage3SourceCrop,
  normalizeStage3RenderPlanSegments,
  resolveCanonicalStage3RenderPolicy
} from "../lib/stage3-render-plan";
import { buildStage3SourceCropFfmpegFilter } from "../lib/stage3-source-crop";
import { fallbackRenderPlan, normalizeRenderPlan } from "../app/home-page-support";

test("normalizeStage3RenderPlanSegments sorts fragments by source timing", () => {
  const normalized = normalizeStage3RenderPlanSegments([
    {
      startSec: 8,
      endSec: 9.5,
      speed: 1,
      label: "B"
    },
    {
      startSec: 1.2,
      endSec: 2.4,
      speed: 1,
      label: "A",
      focusX: 0.73,
      focusY: 0.21,
      videoZoom: 1.16
    }
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0]?.label, "A");
  assert.equal(normalized[0]?.focusX, 0.73);
  assert.equal(normalized[0]?.focusY, 0.21);
  assert.equal(normalized[1]?.label, "B");
});

test("resolveCanonicalStage3RenderPolicy forces fixed_segments when fragments exist", () => {
  const policy = resolveCanonicalStage3RenderPolicy({
    segments: normalizeStage3RenderPlanSegments([
      {
        startSec: 5,
        endSec: 6,
        speed: 1,
        label: "Only"
      }
    ]),
    normalizeToTargetEnabled: true,
    requestedPolicy: "full_source_normalize"
  });

  assert.equal(policy, "fixed_segments");
});

test("resolveCanonicalStage3RenderPolicy clears stale full_source_normalize when normalize mode is off", () => {
  const policy = resolveCanonicalStage3RenderPolicy({
    segments: [],
    normalizeToTargetEnabled: false,
    requestedPolicy: "full_source_normalize"
  });

  assert.equal(policy, "fixed_segments");
});

test("normalizeStage3SourceCrop clamps crop and preserves render-plan crop metadata", () => {
  const crop = normalizeStage3SourceCrop({
    enabled: true,
    x: 0.1,
    y: 0.2,
    width: 0.95,
    height: 0.9,
    confidence: 0.72,
    source: "copscopes-default-inner-frame"
  });

  assert.deepEqual(crop, {
    enabled: true,
    x: 0.1,
    y: 0.2,
    width: 0.9,
    height: 0.8,
    confidence: 0.72,
    source: "copscopes-default-inner-frame",
    reviewedAt: null,
    notes: null
  });
  assert.equal(
    buildStage3SourceCropFfmpegFilter(crop),
    "crop=trunc(iw*0.900000/2)*2:trunc(ih*0.800000/2)*2:trunc(iw*0.100000/2)*2:trunc(ih*0.200000/2)*2"
  );
});

test("normalizeRenderPlan preserves Stage 3 source crop", () => {
  const base = fallbackRenderPlan();
  const normalized = normalizeRenderPlan(
    {
      ...base,
      sourceCrop: {
        enabled: true,
        x: 0.08,
        y: 0.16,
        width: 0.84,
        height: 0.66,
        confidence: 0.62,
        source: "copscopes-default-inner-frame"
      }
    },
    base
  );

  assert.equal(normalized.sourceCrop?.enabled, true);
  assert.equal(normalized.sourceCrop?.x, 0.08);
  assert.equal(normalized.sourceCrop?.height, 0.66);
  assert.equal(normalized.sourceCrop?.confidence, 0.62);
});
