import test from "node:test";
import assert from "node:assert/strict";

import {
  assertGhostfaceExactChannelId,
  assertGhostfaceSourceDuration,
  buildGhostfacePreviewBatchItemFromRequest
} from "../scripts/run-ghostface-preview-batch";

test("Ghostface preview batch maps Workshop into native Clips render request without publication", () => {
  const item = buildGhostfacePreviewBatchItemFromRequest({
    requestPath: "/tmp/workshop-01.json",
    renderId: "workshop-01-source",
    previewPath: "/tmp/workshop-01.mp4",
    request: {
      channel: {
        key: "workshop",
        name: "Ghostface Workshop",
        clips_username: "ghostfaceworkshop",
        clips_channel_id: "clips_channel_workshop_real"
      },
      template: {
        template_id: "ghostface-workshop-v1",
        duration_sec: 6
      },
      source: {
        url: "https://www.youtube.com/watch?v=source",
        title: "Clamp locks in on a tiny workshop rail",
        crop_safe_center_pct: 70
      },
      copy: {
        title: "CLAMP LOCKED IN",
        top_text:
          "This clamp looked like a quick shop check until one tiny contact point started carrying the whole job alone.",
        bottom_text:
          "The funny part is how quiet it starts. One bad angle, one small slip, and the clamp becomes the repair bill."
      }
    }
  });

  assert.equal(item.channelKey, "workshop");
  assert.equal(item.channelId, "clips_channel_workshop_real");
  assert.equal(item.channelUsername, "ghostfaceworkshop");
  assert.equal(item.stage3Body.templateId, "ghostface-workshop-v1");
  assert.equal(item.stage3Body.publishAfterRender, false);
  assert.equal(item.stage3Body.clipDurationSec, 6);
  assert.equal(item.stage3Body.renderPlan?.templateId, "ghostface-workshop-v1");
  assert.equal(item.stage3Body.renderPlan?.timingMode, "compress");
  assert.equal(item.stage3Body.renderPlan?.normalizeToTargetEnabled, false);
  assert.equal(item.stage3Body.renderPlan?.sourceAudioEnabled, true);
  assert.equal(item.stage3Body.renderPlan?.audioMode, "source_only");
  assert.equal(item.stage3Body.renderPlan?.musicAssetId, null);
  assert.equal(item.stage3Body.renderPlan?.topFontScale, 1.8);
  assert.equal(item.stage3Body.renderPlan?.bottomFontScale, 1.8);
  assert.deepEqual(item.stage3Body.renderPlan?.sourceCrop, {
    enabled: true,
    x: 0.15,
    y: 0,
    width: 0.7,
    height: 1,
    confidence: 0.72,
    source: "channel-operator-center-safe",
    notes: "Center crop from source cleanliness score; prevents side template/text artifacts in Ghostface media slot."
  });
  assert.equal("renderPlan" in (item.stage3Body.snapshot ?? {}), false);
});

test("Ghostface preview batch keeps exact Clips channel identity mandatory", () => {
  const item = buildGhostfacePreviewBatchItemFromRequest({
    requestPath: "/tmp/country-01.json",
    renderId: "country-01-source",
    previewPath: "/tmp/country-01.mp4",
    request: {
      channel: {
        key: "country",
        name: "Ghostface Country",
        clips_username: "ghostfacecountry"
      },
      template: {
        template_id: "ghostface-country-v1",
        duration_sec: 20
      },
      source: {
        url: "https://www.youtube.com/watch?v=source",
        title: "Tractor check goes wrong"
      },
      copy: {
        title: "TRACTOR CHECK WENT QUIET",
        top_text: "The old tractor gave one clean warning before the whole field heard the next problem.",
        bottom_text: "A loose bearing can sound harmless until it starts moving the parts around it."
      }
    }
  });

  assert.equal(item.channelKey, "country");
  assert.equal(item.channelId, "");
  assert.equal(item.channelUsername, "ghostfacecountry");
  assert.equal(item.stage3Body.renderPlan?.topFontScale, 1.8);
  assert.equal(item.stage3Body.renderPlan?.bottomFontScale, 1);
  assert.throws(
    () => assertGhostfaceExactChannelId({ channelKey: item.channelKey, channelId: item.channelId }),
    /missing exact clips_channel_id/
  );
});

test("Ghostface preview batch blocks short sources instead of stretching them", () => {
  assert.throws(
    () =>
      assertGhostfaceSourceDuration({
        channelKey: "country",
        sourceDurationSec: 6,
        targetDurationSec: 20,
        sourceUrl: "https://www.youtube.com/watch?v=short"
      }),
    /Choose a longer native-speed source instead of stretching/
  );
});
