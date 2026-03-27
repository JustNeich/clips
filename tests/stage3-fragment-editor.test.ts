import test from "node:test";
import assert from "node:assert/strict";
import { getEditingPolicy, resolveNormalizedTimingMode } from "../app/home-page-support";

test("empty fragment editor state keeps fixed_segments policy even when normalize toggle is on", () => {
  assert.equal(getEditingPolicy([], true), "fixed_segments");
  assert.equal(getEditingPolicy([], false), "fixed_segments");
});

test("multi-fragment normalize mode resolves to compress when total source exceeds 6 seconds", () => {
  const timingMode = resolveNormalizedTimingMode({
    segments: [
      { startSec: 0, endSec: 5, speed: 1, label: "A" },
      { startSec: 19, endSec: 24, speed: 1, label: "B" }
    ],
    targetDurationSec: 6,
    sourceDurationSec: 24
  });

  assert.equal(timingMode, "compress");
});
