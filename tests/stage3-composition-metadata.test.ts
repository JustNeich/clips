import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGE3_REMOTION_FPS,
  buildStage3CompositionMetadata,
  resolveStage3CompositionDurationInFrames
} from "../remotion/stage3-composition-metadata";

test("stage3 remotion metadata uses the requested channel render duration", () => {
  const metadata = buildStage3CompositionMetadata({
    clipDurationSec: 9
  });

  assert.equal(metadata.fps, STAGE3_REMOTION_FPS);
  assert.equal(metadata.durationInFrames, 9 * STAGE3_REMOTION_FPS);
});

test("stage3 composition duration clamps to supported channel duration bounds", () => {
  assert.equal(resolveStage3CompositionDurationInFrames(2), 3 * STAGE3_REMOTION_FPS);
  assert.equal(resolveStage3CompositionDurationInFrames(7), 7 * STAGE3_REMOTION_FPS);
  assert.equal(resolveStage3CompositionDurationInFrames(16), 15 * STAGE3_REMOTION_FPS);
  assert.equal(resolveStage3CompositionDurationInFrames(undefined), 6 * STAGE3_REMOTION_FPS);
});
