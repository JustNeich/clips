import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStage3WatermarkBlurs,
  buildStage3WatermarkBlurFilterComplex,
  buildStage3WatermarkBlurFfmpegArgs
} from "../lib/stage3-watermark-blur";

test("no boxes => no blur (pipeline stays byte-identical)", () => {
  assert.deepEqual(normalizeStage3WatermarkBlurs(undefined), []);
  assert.deepEqual(normalizeStage3WatermarkBlurs([]), []);
  assert.deepEqual(normalizeStage3WatermarkBlurs("nope"), []);
  assert.equal(buildStage3WatermarkBlurFilterComplex([]), null);
  assert.equal(
    buildStage3WatermarkBlurFfmpegArgs({
      sourcePath: "in.mp4",
      outputPath: "out.mp4",
      boxes: [],
      sourceHasAudio: true
    }),
    null
  );
});

test("a box is clamped, defaulted, and rounded", () => {
  const [box] = normalizeStage3WatermarkBlurs([
    { x: -0.2, y: 0.8, width: 0.5, height: 0.5 }
  ]);
  assert.equal(box.x, 0); // clamped up from -0.2
  assert.equal(box.y, 0.8);
  assert.equal(box.width, 0.5);
  // height clamped to remaining space below y (1 - 0.8 = 0.2)
  assert.equal(box.height, 0.2);
  assert.equal(box.strength, 14); // default radius
});

test("disabled boxes and junk entries are dropped; max 4 kept", () => {
  const boxes = normalizeStage3WatermarkBlurs([
    { x: 0.1, y: 0.1, width: 0.1, height: 0.1, enabled: false },
    null,
    { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
    { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
    { x: 0.3, y: 0.3, width: 0.1, height: 0.1 },
    { x: 0.4, y: 0.4, width: 0.1, height: 0.1 },
    { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }
  ]);
  assert.equal(boxes.length, 4);
});

test("strength is clamped into the safe blur-radius band", () => {
  assert.equal(normalizeStage3WatermarkBlurs([{ x: 0, y: 0, width: 0.1, height: 0.1, strength: 999 }])[0].strength, 40);
  assert.equal(normalizeStage3WatermarkBlurs([{ x: 0, y: 0, width: 0.1, height: 0.1, strength: 1 }])[0].strength, 4);
});

test("one box builds a split/crop/boxblur/overlay graph ending in [vwm]", () => {
  const graph = buildStage3WatermarkBlurFilterComplex([
    { x: 0.7, y: 0.88, width: 0.25, height: 0.1, strength: 16 }
  ]);
  assert.ok(graph);
  assert.match(graph as string, /\[0:v\]split=2\[wmbase\]\[wmsrc0\]/);
  assert.match(graph as string, /gblur=sigma=16\[wmblur0\]/);
  // overlay must position with main_w/main_h, never iw/ih (which yields 0 frames)
  assert.match(graph as string, /\[wmbase\]\[wmblur0\]overlay=trunc\(main_w.*\[vwm\]$/);
  assert.doesNotMatch(graph as string, /overlay=trunc\(iw/);
});

test("two boxes chain overlays and still terminate in [vwm]", () => {
  const graph = buildStage3WatermarkBlurFilterComplex([
    { x: 0.0, y: 0.0, width: 0.3, height: 0.1, strength: 14 },
    { x: 0.7, y: 0.9, width: 0.3, height: 0.1, strength: 14 }
  ]) as string;
  assert.match(graph, /\[0:v\]split=3\[wmbase\]\[wmsrc0\]\[wmsrc1\]/);
  assert.match(graph, /\[wmbase\]\[wmblur0\]overlay=.*\[wmstage0\]/);
  assert.match(graph, /\[wmstage0\]\[wmblur1\]overlay=.*\[vwm\]$/);
});

test("ffmpeg args map the blurred video pad and keep audio when present", () => {
  const withAudio = buildStage3WatermarkBlurFfmpegArgs({
    sourcePath: "in.mp4",
    outputPath: "out.mp4",
    boxes: [{ x: 0.7, y: 0.88, width: 0.25, height: 0.1, strength: 16 }],
    sourceHasAudio: true
  }) as string[];
  assert.ok(withAudio.includes("-filter_complex"));
  assert.deepEqual(withAudio.slice(withAudio.indexOf("-map"), withAudio.indexOf("-map") + 2), ["-map", "[vwm]"]);
  assert.ok(withAudio.includes("0:a:0"));

  const noAudio = buildStage3WatermarkBlurFfmpegArgs({
    sourcePath: "in.mp4",
    outputPath: "out.mp4",
    boxes: [{ x: 0.7, y: 0.88, width: 0.25, height: 0.1, strength: 16 }],
    sourceHasAudio: false
  }) as string[];
  assert.ok(noAudio.includes("-an"));
  assert.ok(!noAudio.includes("0:a:0"));
});
