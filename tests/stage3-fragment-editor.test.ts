import test from "node:test";
import assert from "node:assert/strict";
import {
  fallbackRenderPlan,
  getEditingPolicy,
  normalizeClientSegments,
  normalizeRenderPlan,
  resolveNormalizedTimingMode,
  trimClientSegmentsToDuration
} from "../app/home-page-support";

test("empty fragment editor state always resolves to fixed_segments in the rewritten editor", () => {
  assert.equal(getEditingPolicy([], true), "fixed_segments");
  assert.equal(getEditingPolicy([], false), "fixed_segments");
});

test("normalizeRenderPlan canonicalizes stale no-fragment normalize state on init", () => {
  const normalized = normalizeRenderPlan(
    {
      ...fallbackRenderPlan(),
      normalizeToTargetEnabled: true,
      timingMode: "auto",
      policy: "fixed_segments",
      segments: []
    },
    fallbackRenderPlan()
  );

  assert.equal(normalized.normalizeToTargetEnabled, true);
  assert.equal(normalized.policy, "full_source_normalize");
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

test("client fragment normalization preserves per-fragment framing overrides", () => {
  const normalized = normalizeClientSegments(
    [
      {
        startSec: 0,
        endSec: 1.6,
        speed: 1,
        label: "A",
        focusY: 0.21,
        videoZoom: 1.22,
        mirrorEnabled: false
      }
    ],
    12
  );

  assert.equal(normalized[0]?.focusY, 0.21);
  assert.equal(normalized[0]?.videoZoom, 1.22);
  assert.equal(normalized[0]?.mirrorEnabled, false);
});

test("trimClientSegmentsToDuration no longer truncates selected fragments and keeps framing overrides", () => {
  const trimmed = trimClientSegmentsToDuration(
    [
      {
        startSec: 0,
        endSec: 5,
        speed: 1,
        label: "A",
        focusY: 0.24,
        videoZoom: 1.28,
        mirrorEnabled: true
      },
      {
        startSec: 8,
        endSec: 11,
        speed: 1,
        label: "B",
        focusY: 0.74,
        videoZoom: 1.36,
        mirrorEnabled: false
      }
    ],
    6,
    12
  );

  assert.equal(trimmed.length, 2);
  assert.equal(trimmed[0]?.endSec, 5);
  assert.equal(trimmed[1]?.endSec, 11);
  assert.equal(trimmed[0]?.focusY, 0.24);
  assert.equal(trimmed[0]?.videoZoom, 1.28);
  assert.equal(trimmed[0]?.mirrorEnabled, true);
  assert.equal(trimmed[1]?.focusY, 0.74);
  assert.equal(trimmed[1]?.videoZoom, 1.36);
  assert.equal(trimmed[1]?.mirrorEnabled, false);
});

test("normalizeRenderPlan sorts fragments by time so preview and render use the same order", () => {
  const normalized = normalizeRenderPlan(
    {
      ...fallbackRenderPlan(),
      segments: [
        { startSec: 9, endSec: 10, speed: 1, label: "B" },
        { startSec: 2, endSec: 3, speed: 1, label: "A" }
      ],
      policy: "full_source_normalize"
    },
    fallbackRenderPlan()
  );

  assert.equal(normalized.segments.length, 2);
  assert.equal(normalized.segments[0]?.label, "A");
  assert.equal(normalized.segments[1]?.label, "B");
  assert.equal(normalized.policy, "fixed_segments");
});

test("normalizeRenderPlan preserves a whole-window selection stored as a single explicit segment", () => {
  const normalized = normalizeRenderPlan(
    {
      ...fallbackRenderPlan(),
      segments: [{ startSec: 10, endSec: 30, speed: 1, label: "Window" }],
      editorSelectionMode: "window",
      policy: "fixed_segments",
      timingMode: "compress"
    },
    fallbackRenderPlan()
  );

  assert.equal(normalized.editorSelectionMode, "window");
  assert.equal(normalized.segments.length, 1);
  assert.equal(normalized.segments[0]?.startSec, 10);
  assert.equal(normalized.segments[0]?.endSec, 30);
  assert.equal(normalized.policy, "fixed_segments");
});

test("normalizeRenderPlan widens too-short fragments to the editor minimum", () => {
  const normalized = normalizeRenderPlan(
    {
      ...fallbackRenderPlan(),
      segments: [{ startSec: 9.1, endSec: 9.3, speed: 1, label: "Tiny" }],
      editorSelectionMode: "fragments",
      policy: "fixed_segments"
    },
    fallbackRenderPlan()
  );

  assert.equal(normalized.segments.length, 1);
  assert.equal(normalized.segments[0]?.startSec, 9.1);
  assert.equal(normalized.segments[0]?.endSec, 10.1);
});
