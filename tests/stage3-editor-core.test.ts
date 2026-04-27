import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGE3_EDITOR_MIN_SELECTION_DURATION_SEC,
  buildStage3EditorSession,
  normalizeStage3EditorFragments
} from "../lib/stage3-editor-core";

test("single window without manual fragments produces an exact 6 second output plan", () => {
  const session = buildStage3EditorSession({
    rawSegments: [],
    selectionMode: "window",
    clipStartSec: 18.3,
    clipDurationSec: 6,
    targetDurationSec: 6,
    sourceDurationSec: 85.4
  });

  assert.equal(session.source.selectionMode, "window");
  assert.equal(session.renderPlanPatch.policy, "fixed_segments");
  assert.equal(session.renderPlanPatch.segments.length, 1);
  assert.equal(session.renderPlanPatch.segments[0]?.startSec, 18.3);
  assert.equal(session.renderPlanPatch.segments[0]?.endSec, 24.3);
  assert.equal(session.output.totalOutputDurationSec, 6);
  assert.equal(session.output.timingMode, "auto");
});

test("window mode preserves a longer per-channel target duration instead of snapping back to 6 seconds", () => {
  const session = buildStage3EditorSession({
    rawSegments: [],
    selectionMode: "window",
    clipStartSec: 4,
    clipDurationSec: 9,
    targetDurationSec: 9,
    sourceDurationSec: 85.4
  });

  assert.equal(session.source.selectionMode, "window");
  assert.equal(session.renderPlanPatch.segments[0]?.startSec, 4);
  assert.equal(session.renderPlanPatch.segments[0]?.endSec, 13);
  assert.equal(session.output.totalOutputDurationSec, 9);
  assert.equal(session.output.targetDurationSec, 9);
  assert.equal(session.output.timingMode, "auto");
});

test("window mode can keep an explicit source window longer than 6 seconds and compress it into the fixed output", () => {
  const session = buildStage3EditorSession({
    rawSegments: [{ startSec: 10, endSec: 30, speed: 1, label: "Main window" }],
    selectionMode: "window",
    clipStartSec: 10,
    clipDurationSec: 6,
    targetDurationSec: 6,
    sourceDurationSec: 85.4
  });

  assert.equal(session.source.selectionMode, "window");
  assert.equal(session.source.windowStartSec, 10);
  assert.equal(session.source.windowEndSec, 30);
  assert.equal(session.source.totalSelectedSourceDurationSec, 20);
  assert.equal(session.renderPlanPatch.segments.length, 1);
  assert.equal(session.renderPlanPatch.segments[0]?.startSec, 10);
  assert.equal(session.renderPlanPatch.segments[0]?.endSec, 30);
  assert.equal(session.output.totalOutputDurationSec, 6);
  assert.equal(session.output.timingMode, "compress");
  assert.equal(Number(session.output.segments[0]!.resolvedPlaybackRate.toFixed(3)), Number((20 / 6).toFixed(3)));
});

test("manual fragments are sorted, clamped, and de-overlapped before output planning", () => {
  const normalized = normalizeStage3EditorFragments({
    segments: [
      { startSec: 12.4, endSec: 14.4, speed: 1, label: "B" },
      { startSec: 10, endSec: 13, speed: 1, label: "A", focusX: 0.62, focusY: 0.28 },
      { startSec: 13.8, endSec: 16, speed: 1, label: "C" }
    ],
    sourceDurationSec: 20
  });

  assert.equal(normalized.length, 3);
  assert.equal(normalized[0]?.startSec, 10);
  assert.equal(normalized[0]?.endSec, 13);
  assert.equal(normalized[0]?.focusXOverride, 0.62);
  assert.equal(normalized[0]?.focusYOverride, 0.28);
  assert.equal(normalized[1]?.startSec, 13);
  assert.equal(normalized[1]?.endSec, 14.4);
  assert.equal(normalized[2]?.startSec, 14.4);
  assert.equal(normalized[2]?.endSec, 16);
});

test("manual fragments cannot collapse below the editor minimum after normalization", () => {
  const normalized = normalizeStage3EditorFragments({
    segments: [{ startSec: 9.1, endSec: 9.3, speed: 1, label: "Too short" }],
    sourceDurationSec: 26.7
  });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.startSec, 9.1);
  assert.equal(normalized[0]?.endSec, 10.1);
  assert.equal(normalized[0]?.sourceDurationSec, STAGE3_EDITOR_MIN_SELECTION_DURATION_SEC);
});

test("window selections near the source edge stay at least one second wide after rounding", () => {
  const session = buildStage3EditorSession({
    rawSegments: [{ startSec: 25.8, endSec: 26.7, speed: 1, label: "Late window" }],
    selectionMode: "window",
    clipStartSec: 25.8,
    clipDurationSec: 6,
    targetDurationSec: 6,
    sourceDurationSec: 26.7
  });

  assert.equal(session.source.windowStartSec, 25.7);
  assert.equal(session.source.windowEndSec, 26.7);
  assert.equal(
    Number((session.source.windowEndSec - session.source.windowStartSec).toFixed(1)),
    STAGE3_EDITOR_MIN_SELECTION_DURATION_SEC
  );
});

test("underfilled selections stretch to 6 seconds with a lower resolved playback rate", () => {
  const session = buildStage3EditorSession({
    rawSegments: [
      { startSec: 10, endSec: 12, speed: 1, label: "A" },
      { startSec: 20, endSec: 21, speed: 1, label: "B" }
    ],
    selectionMode: "fragments",
    clipStartSec: 0,
    clipDurationSec: 6,
    targetDurationSec: 6,
    sourceDurationSec: 40
  });

  assert.equal(session.output.totalBaseOutputDurationSec, 3);
  assert.equal(session.output.totalOutputDurationSec, 6);
  assert.equal(session.output.timingMode, "stretch");
  assert.equal(Number(session.output.segments[0]!.resolvedPlaybackRate.toFixed(3)), 0.5);
});

test("overfilled selections compress to 6 seconds with a faster resolved playback rate", () => {
  const session = buildStage3EditorSession({
    rawSegments: [
      { startSec: 0, endSec: 4, speed: 1, label: "A" },
      { startSec: 8, endSec: 12, speed: 1, label: "B" }
    ],
    selectionMode: "fragments",
    clipStartSec: 0,
    clipDurationSec: 6,
    targetDurationSec: 6,
    sourceDurationSec: 20
  });

  assert.equal(session.output.totalBaseOutputDurationSec, 8);
  assert.equal(session.output.totalOutputDurationSec, 6);
  assert.equal(session.output.timingMode, "compress");
  assert.equal(Number(session.output.segments[0]!.resolvedPlaybackRate.toFixed(3)), Number((4 / 3).toFixed(3)));
  assert.equal(session.output.segments[1]?.outputEndSec, 6);
});

test("per-fragment speed and global normalization stay deterministic", () => {
  const session = buildStage3EditorSession({
    rawSegments: [
      { startSec: 10, endSec: 12, speed: 1, label: "A" },
      { startSec: 20, endSec: 24, speed: 2, label: "B" }
    ],
    selectionMode: "fragments",
    clipStartSec: 0,
    clipDurationSec: 6,
    targetDurationSec: 6,
    sourceDurationSec: 40
  });

  assert.equal(session.output.totalBaseOutputDurationSec, 4);
  assert.equal(session.output.totalOutputDurationSec, 6);
  assert.equal(session.output.timingMode, "stretch");
  assert.equal(Number(session.output.segments[0]!.outputDurationSec.toFixed(3)), 3);
  assert.equal(Number(session.output.segments[1]!.outputDurationSec.toFixed(3)), 3);
  assert.equal(Number(session.output.segments[0]!.resolvedPlaybackRate.toFixed(3)), Number((2 / 3).toFixed(3)));
  assert.equal(Number(session.output.segments[1]!.resolvedPlaybackRate.toFixed(3)), Number((4 / 3).toFixed(3)));
});

test("no canonical output plan can exceed 6 seconds", () => {
  const session = buildStage3EditorSession({
    rawSegments: [
      { startSec: 0, endSec: 10, speed: 1, label: "A" },
      { startSec: 15, endSec: 25, speed: 1, label: "B" }
    ],
    selectionMode: "fragments",
    clipStartSec: 0,
    clipDurationSec: 6,
    targetDurationSec: 6,
    sourceDurationSec: 40
  });

  assert.equal(session.output.totalOutputDurationSec, 6);
  assert.ok(session.output.segments.every((segment) => segment.outputEndSec <= 6));
});
