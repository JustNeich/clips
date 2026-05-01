import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveMeasuredScaledFontCeiling,
  solveMeasuredSlotForMeasurements,
  type MeasuredSlotSpec
} from "../lib/auto-fit-template-scene";

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

test("measured font ceiling scales smoothly around neutral size", () => {
  const input = {
    baseFont: 45.5,
    configuredMaxFont: 56,
    minFont: 16.25,
    maxScaleBoost: 1.4
  };

  const at99 = resolveMeasuredScaledFontCeiling({ ...input, scale: 0.99 });
  const at100 = resolveMeasuredScaledFontCeiling({ ...input, scale: 1 });
  const at101 = resolveMeasuredScaledFontCeiling({ ...input, scale: 1.01 });

  assert.ok(at100 >= at99, `expected 100% to stay monotonic, got ${at99} -> ${at100}`);
  assert.ok(at101 >= at100, `expected 101% to stay monotonic, got ${at100} -> ${at101}`);
  assert.ok(
    at100 - at99 <= 0.75,
    `expected 99% -> 100% to avoid unlocking template max, got ${at99} -> ${at100}`
  );
  assert.ok(
    at101 - at100 <= 0.75,
    `expected 100% -> 101% to avoid a font cliff, got ${at100} -> ${at101}`
  );
  assert.ok(at100 < input.configuredMaxFont, `expected neutral ceiling to remain local, got ${at100}`);
});
