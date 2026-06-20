import assert from "node:assert/strict";
import test from "node:test";

import { applyStage3MediaGeometryToTemplateSnapshot } from "../lib/stage3-media-geometry";
import type { TemplateRenderSnapshot } from "../lib/stage3-template-core";

function fakeSnapshot(): TemplateRenderSnapshot {
  return {
    snapshotHash: "hash",
    computed: { videoHeight: 750 },
    layout: {
      media: { x: 0, y: 200, width: 907, height: 750 },
      bottom: { x: 0, y: 950, width: 907, height: 100 },
      author: { x: 0, y: 960, width: 600, height: 40 },
      avatar: { x: 0, y: 960, width: 80, height: 80 },
      bottomText: { x: 0, y: 1000, width: 907, height: 60 }
    }
  } as unknown as TemplateRenderSnapshot;
}

test("region-height shrink: media gets shorter, bottom block rides UP (whole card shorter)", () => {
  const out = applyStage3MediaGeometryToTemplateSnapshot(fakeSnapshot(), 510);
  const delta = 750 - 510;
  // media region shrinks
  assert.equal(out.layout.media.height, 510);
  assert.equal(out.computed.videoHeight, 510);
  // media TOP is unchanged: the top panel and media start stay put...
  assert.equal(out.layout.media.y, 200);
  // ...and the entire bottom group shifts UP by the delta (not the bottom panel growing).
  assert.equal(out.layout.bottom.y, 950 - delta);
  assert.equal(out.layout.author.y, 960 - delta);
  assert.equal(out.layout.avatar.y, 960 - delta);
  assert.equal(out.layout.bottomText.y, 1000 - delta);
  // bottom panel height is NOT increased.
  assert.equal(out.layout.bottom.height, 100);
});

test("no-op when target height equals the default media height", () => {
  const snap = fakeSnapshot();
  const out = applyStage3MediaGeometryToTemplateSnapshot(snap, 750);
  assert.equal(out, snap);
});

test("no-op when mediaRegionHeightPx is not a number", () => {
  const snap = fakeSnapshot();
  assert.equal(applyStage3MediaGeometryToTemplateSnapshot(snap, undefined), snap);
  assert.equal(applyStage3MediaGeometryToTemplateSnapshot(snap, null), snap);
});
