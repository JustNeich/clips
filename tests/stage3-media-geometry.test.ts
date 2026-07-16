import assert from "node:assert/strict";
import test from "node:test";

import { applyStage3MediaGeometryToTemplateSnapshot } from "../lib/stage3-media-geometry";
import type { TemplateRenderSnapshot } from "../lib/stage3-template-core";

function fakeSnapshot(): TemplateRenderSnapshot {
  return {
    snapshotHash: "hash",
    computed: { videoHeight: 750 },
    layout: {
      card: { x: 83, y: 192, width: 907, height: 1461 },
      top: { x: 83, y: 192, width: 907, height: 419 },
      media: { x: 83, y: 611, width: 907, height: 750 },
      bottom: { x: 83, y: 1361, width: 907, height: 292 },
      author: { x: 83, y: 1361, width: 600, height: 132 },
      avatar: { x: 106, y: 1380, width: 101, height: 101 },
      bottomText: { x: 106, y: 1493, width: 861, height: 160 }
    }
  } as unknown as TemplateRenderSnapshot;
}

test("region-height shrink: media shorter, card shorter + re-centered (whole card smaller)", () => {
  const out = applyStage3MediaGeometryToTemplateSnapshot(fakeSnapshot(), 510);
  const delta = 750 - 510; // 240
  const half = delta / 2; // 120

  // media region shrinks to the target height
  assert.equal(out.layout.media.height, 510);
  assert.equal(out.computed.videoHeight, 510);

  // the CARD itself gets shorter by the freed media height (no empty white band)
  assert.equal(out.layout.card.height, 1461 - delta);

  // re-centered: card frame + top panel + media slide DOWN by half...
  assert.equal(out.layout.card.y, 192 + half);
  assert.equal(out.layout.top.y, 192 + half);
  assert.equal(out.layout.media.y, 611 + half);

  // ...and the bottom group slides UP by half (panels move closer together)
  assert.equal(out.layout.bottom.y, 1361 - half);
  assert.equal(out.layout.author.y, 1361 - half);
  assert.equal(out.layout.avatar.y, 1380 - half);
  assert.equal(out.layout.bottomText.y, 1493 - half);

  // bottom panel height is NOT grown
  assert.equal(out.layout.bottom.height, 292);

  // card stays vertically centered: its center is unchanged
  const oldCenter = 192 + 1461 / 2;
  const newCenter = out.layout.card.y + out.layout.card.height / 2;
  assert.ok(Math.abs(newCenter - oldCenter) <= 1, `center moved: ${oldCenter} -> ${newCenter}`);
});

test("channel-story shrink keeps author and body inside the re-centered card", () => {
  const snap = fakeSnapshot();
  snap.computed.layoutKind = "channel_story";
  snap.layout.card = { x: 0, y: 0, width: 1080, height: 1920 };
  snap.layout.top = { x: 64, y: 383, width: 952, height: 0 };
  snap.layout.author = { x: 64, y: 220, width: 952, height: 136 };
  snap.layout.avatar = { x: 64, y: 237, width: 102, height: 102 };
  snap.layout.bottomText = { x: 64, y: 383, width: 952, height: 218 };
  snap.layout.media = { x: 0, y: 613, width: 1080, height: 1307 };
  snap.layout.bottom = { x: 0, y: 1920, width: 1080, height: 0 };
  snap.computed.videoHeight = 1307;

  const out = applyStage3MediaGeometryToTemplateSnapshot(snap, 773);
  const delta = 1307 - 773;
  const half = delta / 2;

  assert.equal(out.layout.card.y, half);
  assert.equal(out.layout.card.height, 1920 - delta);
  assert.equal(out.layout.author.y, 220 + half);
  assert.equal(out.layout.avatar.y, 237 + half);
  assert.equal(out.layout.bottomText.y, 383 + half);
  assert.equal(out.layout.media.y, 613 + half);
  assert.equal(out.layout.media.height, 773);
  assert.equal(out.layout.bottom.y, 1920 - half);

  assert.ok(out.layout.author.y >= out.layout.card.y);
  assert.ok(out.layout.bottomText.y >= out.layout.card.y);
  assert.ok(out.layout.bottomText.y + out.layout.bottomText.height <= out.layout.media.y);
});

test("no-op when target height equals the default media height", () => {
  const snap = fakeSnapshot();
  assert.equal(applyStage3MediaGeometryToTemplateSnapshot(snap, 750), snap);
});

test("no-op when mediaRegionHeightPx is not a number", () => {
  const snap = fakeSnapshot();
  assert.equal(applyStage3MediaGeometryToTemplateSnapshot(snap, undefined), snap);
  assert.equal(applyStage3MediaGeometryToTemplateSnapshot(snap, null), snap);
});
