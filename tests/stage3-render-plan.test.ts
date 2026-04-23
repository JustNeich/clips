import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStage3RenderPlanSegments,
  resolveCanonicalStage3RenderPolicy
} from "../lib/stage3-render-plan";

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
