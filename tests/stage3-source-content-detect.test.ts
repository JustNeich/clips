import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCropdetectCrop,
  resolveDetectedContent
} from "../lib/stage3-source-content-detect";

test("parseCropdetectCrop returns the LAST crop box", () => {
  const stderr = [
    "[Parsed_cropdetect_1 @ 0x1] x1:0 x2:575 y1:300 y2:700 w:576 h:400 x:0 y:300 crop=576:400:0:300",
    "[Parsed_cropdetect_1 @ 0x1] x1:0 x2:575 y1:208 y2:815 w:576 h:608 x:0 y:208 crop=576:608:0:208"
  ].join("\n");
  assert.deepEqual(parseCropdetectCrop(stderr), { w: 576, h: 608, x: 0, y: 208 });
});

test("parseCropdetectCrop returns null when no crop present / empty", () => {
  assert.equal(parseCropdetectCrop(""), null);
  assert.equal(parseCropdetectCrop("no crop here"), null);
  assert.equal(parseCropdetectCrop(undefined as unknown as string), null);
});

test("resolveDetectedContent: baked-in top/bottom bars (real GGG 4:3 in 9:16) -> crop", () => {
  // Real cropdetect on the GGG reel: 576x1024 frame, content 576x432 centered
  // (296px black bars top & bottom).
  const res = resolveDetectedContent({ w: 576, h: 432, x: 0, y: 296 }, 576, 1024);
  assert.equal(res.hasBars, true);
  assert.ok(res.rect);
  assert.equal(res.rect!.x, 0);
  assert.equal(res.rect!.width, 1);
  assert.ok(Math.abs(res.rect!.y - 296 / 1024) < 1e-6);
  assert.ok(Math.abs(res.rect!.height - 432 / 1024) < 1e-6);
  // After stripping the source's own bars the content is 4:3 (~1.33), wider than
  // the 1.21 media region -> this is the Option A (top/bottom) case.
  const aspect = (res.rect!.width * 576) / (res.rect!.height * 1024);
  assert.ok(aspect > 1.2 && aspect < 1.5, `expected ~4:3 content, got ${aspect}`);
});

test("resolveDetectedContent: full-bleed source -> no crop", () => {
  const res = resolveDetectedContent({ w: 720, h: 720, x: 0, y: 0 }, 720, 720);
  assert.equal(res.hasBars, false);
  assert.equal(res.rect, null);
});

test("resolveDetectedContent: tiny 1-2px inset is ignored as noise", () => {
  const res = resolveDetectedContent({ w: 718, h: 1278, x: 1, y: 1 }, 720, 1280);
  assert.equal(res.hasBars, false);
});

test("resolveDetectedContent: invalid dims -> null", () => {
  assert.equal(resolveDetectedContent({ w: 100, h: 100, x: 0, y: 0 }, 0, 0).rect, null);
  assert.equal(resolveDetectedContent(null, 720, 720).rect, null);
});
