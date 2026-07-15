import assert from "node:assert/strict";
import test from "node:test";

import {
  clipsOwnerRenderVideoInputSchema,
  clipsOwnerRunVideoPipelineInputSchema,
  clipsOwnerUpdateChannelInputSchema,
  clipsOwnerUpdateChannelPublishSettingsInputSchema,
  clipsOwnerUploadChannelAssetInputSchema
} from "../scripts/clips-owner-mcp";

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

test("clips_owner_render_video keeps generic compatibility but strict agent render requires explicit final timing", () => {
  assert.equal(clipsOwnerRenderVideoInputSchema.safeParse({ channelId: "c", chatId: "h" }).success, true);
  assert.equal(
    clipsOwnerRenderVideoInputSchema.safeParse({
      channelId: "c",
      chatId: "h",
      strictAgentRender: true,
      requiredWorkerId: "macbook-worker",
      sourceDurationSec: 42,
      snapshot: { renderPlan: {} }
    }).success,
    false
  );
  assert.equal(
    clipsOwnerRenderVideoInputSchema.safeParse({
      channelId: "c",
      chatId: "h",
      strictAgentRender: true,
      sourceDurationSec: 42,
      snapshot: { clipDurationSec: 8, renderPlan: { segments: [{ startSec: 0, endSec: 8 }] } }
    }).success,
    false
  );
  const strict = clipsOwnerRenderVideoInputSchema.parse({
    channelId: "c",
    chatId: "h",
    strictAgentRender: true,
    requiredWorkerId: "macbook-worker",
    sourceDurationSec: 42,
    snapshot: {
      clipDurationSec: 11.25,
      renderPlan: { segments: [{ startSec: 4, endSec: 15.25, speed: 1 }] }
    }
  });
  assert.equal((strict.snapshot as { clipDurationSec: number }).clipDurationSec, 11.25);
  assert.equal(
    clipsOwnerRenderVideoInputSchema.safeParse({
      ...strict,
      publishAfterRender: true
    }).success,
    false
  );
});

test("clips_owner_run_video_pipeline schema requires caption for explicit agent_manual mode", () => {
  const missingSource = clipsOwnerRunVideoPipelineInputSchema.safeParse({
    channelId: "channel-1",
    mode: "agent_manual",
    agentCaption: { top: "VALID MANUAL TOP", bottom: "Valid manual bottom copy." }
  });
  assert.equal(missingSource.success, false);

  const missing = clipsOwnerRunVideoPipelineInputSchema.safeParse({
    channelId: "channel-1",
    sourceUrl: "https://www.instagram.com/reel/agent-manual-1/",
    mode: "agent_manual"
  });
  assert.equal(missing.success, false);

  const valid = clipsOwnerRunVideoPipelineInputSchema.safeParse({
    channelId: "channel-1",
    sourceUrl: "https://www.instagram.com/reel/agent-manual-1/",
    mode: "agent_manual",
    agentCaption: { top: "VALID MANUAL TOP", bottom: "Valid manual bottom copy." }
  });
  assert.equal(valid.success, true);
});

test("owner channel schemas expose setup, asset, and publish-setting operations", () => {
  const channel = clipsOwnerUpdateChannelInputSchema.parse({
    channelId: "channel-1",
    stage2HardConstraints: { topMinChars: 18 },
    stage2PromptConfig: { useWorkspaceDefault: false },
    defaultBackgroundAssetId: null
  });
  assert.deepEqual(channel.stage2HardConstraints, { topMinChars: 18 });
  assert.equal(channel.defaultBackgroundAssetId, null);

  const asset = clipsOwnerUploadChannelAssetInputSchema.parse({
    channelId: "channel-1",
    kind: "background",
    mimeType: "image/png",
    dataBase64: "aW1hZ2U=",
    setAsDefault: true
  });
  assert.equal(asset.kind, "background");

  const settings = clipsOwnerUpdateChannelPublishSettingsInputSchema.parse({
    channelId: "channel-1",
    autoQueueEnabled: false,
    dailySlotCount: 3
  });
  assert.equal(settings.autoQueueEnabled, false);
  assert.equal(settings.dailySlotCount, 3);
});
