import assert from "node:assert/strict";
import test from "node:test";

import { clipsOwnerRenderVideoInputSchema } from "../scripts/clips-owner-mcp";

test("clips_owner_render_video schema preserves caller snapshot media controls", () => {
  const parsed = clipsOwnerRenderVideoInputSchema.parse({
    channelId: "channel-1",
    chatId: "chat-1",
    sourceDurationSec: 54,
    snapshot: {
      topText: "Caller top",
      clipStartSec: 3.25,
      focusY: 0.42,
      renderPlan: {
        durationMode: "source_full",
        sourceCrop: {
          enabled: true,
          x: 0,
          y: 0,
          width: 1,
          height: 0.82,
          confidence: 0.91,
          source: "editor-controlled-crop"
        },
        videoZoom: 1.12,
        mirrorEnabled: false
      }
    }
  });

  const snapshot = parsed.snapshot as Record<string, unknown>;
  const renderPlan = snapshot.renderPlan as Record<string, unknown>;
  const sourceCrop = renderPlan.sourceCrop as Record<string, unknown>;

  assert.equal(snapshot.topText, "Caller top");
  assert.equal(snapshot.clipStartSec, 3.25);
  assert.equal(snapshot.focusY, 0.42);
  assert.equal(renderPlan.videoZoom, 1.12);
  assert.equal(renderPlan.mirrorEnabled, false);
  assert.equal(sourceCrop.height, 0.82);
  assert.equal(sourceCrop.source, "editor-controlled-crop");
});
