import test from "node:test";
import assert from "node:assert/strict";
import { buildStage3EditingProxyDedupeKey } from "../lib/stage3-editing-proxy-service";
import {
  buildStage3PlaybackPlan,
  resolveStage3PlaybackPosition
} from "../lib/stage3-preview-playback";

test("buildStage3PlaybackPlan uses clip window when there are no explicit segments", () => {
  const plan = buildStage3PlaybackPlan({
    segments: [],
    sourceDurationSec: 40,
    clipStartSec: 12,
    clipDurationSec: 6,
    targetDurationSec: 6,
    timingMode: "auto",
    policy: "fixed_segments"
  });

  assert.equal(plan.segments.length, 1);
  assert.equal(plan.segments[0]?.sourceStartSec, 12);
  assert.equal(plan.segments[0]?.sourceEndSec, 18);
  assert.equal(plan.totalOutputDurationSec, 6);
});

test("buildStage3PlaybackPlan maps multi-segment auto timing into a 6 second editor timeline", () => {
  const plan = buildStage3PlaybackPlan({
    segments: [
      { startSec: 10, endSec: 12, speed: 1, label: "A" },
      { startSec: 20, endSec: 22, speed: 2, label: "B" }
    ],
    sourceDurationSec: 40,
    clipStartSec: 0,
    clipDurationSec: 6,
    targetDurationSec: 6,
    timingMode: "auto",
    policy: "fixed_segments"
  });

  assert.equal(plan.segments.length, 2);
  assert.equal(Number(plan.totalOutputDurationSec.toFixed(3)), 6);
  assert.equal(Number(plan.segments[0]!.outputDurationSec.toFixed(3)), 4);
  assert.equal(Number(plan.segments[1]!.outputDurationSec.toFixed(3)), 2);

  const position = resolveStage3PlaybackPosition(plan, 5);
  assert.ok(position);
  assert.equal(position?.segment.label, "B");
  assert.equal(Number(position?.sourceTimeSec.toFixed(3)), 21);
});

test("compress mode preserves shorter segment output instead of stretching it", () => {
  const plan = buildStage3PlaybackPlan({
    segments: [
      { startSec: 5, endSec: 7, speed: 1, label: "A" },
      { startSec: 9, endSec: 10, speed: 1, label: "B" }
    ],
    sourceDurationSec: 20,
    clipStartSec: 0,
    clipDurationSec: 6,
    targetDurationSec: 6,
    timingMode: "compress",
    policy: "fixed_segments"
  });

  assert.equal(Number(plan.totalOutputDurationSec.toFixed(3)), 3);
  const position = resolveStage3PlaybackPosition(plan, 2.5);
  assert.ok(position);
  assert.equal(position?.segment.label, "B");
  assert.equal(Number(position?.sourceTimeSec.toFixed(3)), 9.5);
});

test("buildStage3EditingProxyDedupeKey is stable for the same scoped source", async () => {
  const keyA = await buildStage3EditingProxyDedupeKey(
    { sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { workspaceId: "ws_1", userId: "user_1" }
  );
  const keyB = await buildStage3EditingProxyDedupeKey(
    { sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { workspaceId: "ws_1", userId: "user_1" }
  );
  const keyOtherUser = await buildStage3EditingProxyDedupeKey(
    { sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { workspaceId: "ws_1", userId: "user_2" }
  );

  assert.equal(keyA, keyB);
  assert.notEqual(keyA, keyOtherUser);
});
