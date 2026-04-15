import assert from "node:assert/strict";
import test from "node:test";

import { solveMeasuredSlotForMeasurements, type MeasuredSlotSpec } from "../lib/auto-fit-template-scene";

test("auto-fit solver finds a high-fill result without exhaustive probing", () => {
  const spec: MeasuredSlotSpec = {
    text: "Measured text",
    width: 720,
    height: 180,
    minFont: 16,
    maxFont: 60,
    preferredFont: 42,
    maxLines: 4,
    baseLineHeight: 1,
    fillTargetMin: 0.9,
    fillTargetMax: 0.96,
    fontFamily: "Inter",
    fontWeight: 700,
    fontStyle: "normal",
    letterSpacing: "0",
    textAlign: "center",
    scale: 1.08,
    lineHeightFloor: 0.96,
    lineHeightCeil: 1.06
  };

  let calls = 0;
  const result = solveMeasuredSlotForMeasurements(spec, (font, lineHeight) => {
    calls += 1;
    const lines = font > 44 ? 5 : font > 32 ? 4 : 3;
    return {
      height: lines * font * lineHeight,
      lines
    };
  });

  assert.ok(calls < 120, `expected optimized probing budget, got ${calls} measurements`);
  assert.ok(result.font >= 40 && result.font <= 44, `expected a high-fill fitting font, got ${result.font}`);
  assert.ok(
    result.lineHeight >= spec.lineHeightFloor && result.lineHeight <= spec.lineHeightCeil,
    `expected line height within slot bounds, got ${result.lineHeight}`
  );
});
