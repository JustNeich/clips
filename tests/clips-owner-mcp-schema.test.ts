import assert from "node:assert/strict";
import test from "node:test";

import {
  clipsOwnerInspectChannelAssetInputSchema,
  clipsOwnerPreflightCompletedSourceInputSchema,
  clipsOwnerRenderPreviewInputSchema,
  clipsOwnerRenderVideoInputSchema,
  clipsOwnerRunVideoPipelineInputSchema,
  clipsOwnerUpdateChannelInputSchema,
  clipsOwnerUpdateChannelPublishSettingsInputSchema,
  clipsOwnerUploadChannelAssetInputSchema
} from "../scripts/clips-owner-mcp";

const completedSource = {
  jobId: "source-job-1",
  expectedCacheKey: "cache-key-1",
  expectedDurationSec: 17.069,
  expectedWidth: 720,
  expectedHeight: 1280
};

test("Stage 3 owner schemas reject pixel sourceCrop before enqueue", () => {
  const pixelCrop = {
    enabled: true,
    x: 0,
    y: 465,
    width: 720,
    height: 552
  };
  const preview = clipsOwnerRenderPreviewInputSchema.safeParse({
    channelId: "channel-1",
    sourceUrl: "https://www.instagram.com/reel/example/",
    snapshot: { renderPlan: { sourceCrop: pixelCrop } }
  });
  const render = clipsOwnerRenderVideoInputSchema.safeParse({
    channelId: "channel-1",
    chatId: "chat-1",
    snapshot: { renderPlan: { sourceCrop: pixelCrop } }
  });

  assert.equal(preview.success, false);
  assert.equal(render.success, false);
});

test("Stage 3 owner schemas accept bounded normalized sourceCrop", () => {
  const sourceCrop = {
    enabled: true,
    x: 0.05,
    y: 0.2,
    width: 0.9,
    height: 0.65
  };
  const preview = clipsOwnerRenderPreviewInputSchema.safeParse({
    channelId: "channel-1",
    sourceUrl: "https://www.instagram.com/reel/example/",
    snapshot: { renderPlan: { sourceCrop } }
  });
  const render = clipsOwnerRenderVideoInputSchema.safeParse({
    channelId: "channel-1",
    chatId: "chat-1",
    snapshot: { renderPlan: { sourceCrop } }
  });

  assert.equal(preview.success, true);
  assert.equal(render.success, true);
});

test("owner completed-source contract accepts exact binding and keeps the URL path compatible", () => {
  const legacyPreview = clipsOwnerRenderPreviewInputSchema.safeParse({
    channelId: "channel-1",
    sourceUrl: "https://www.instagram.com/reel/example/"
  });
  const boundPreview = clipsOwnerRenderPreviewInputSchema.safeParse({
    channelId: "channel-1",
    chatId: "chat-1",
    completedSource
  });
  const boundRender = clipsOwnerRenderVideoInputSchema.safeParse({
    channelId: "channel-1",
    chatId: "chat-1",
    completedSource,
    sourceDurationSec: 17.069
  });
  const preflight = clipsOwnerPreflightCompletedSourceInputSchema.safeParse({
    channelId: "channel-1",
    chatId: "chat-1",
    completedSource
  });

  assert.equal(legacyPreview.success, true);
  assert.equal(boundPreview.success, true);
  assert.equal(boundRender.success, true);
  assert.equal(preflight.success, true);
});

test("owner completed-source contract fails closed on incomplete or inconsistent expectations", () => {
  const missingChat = clipsOwnerRenderPreviewInputSchema.safeParse({
    channelId: "channel-1",
    completedSource
  });
  const incomplete = clipsOwnerRenderPreviewInputSchema.safeParse({
    channelId: "channel-1",
    chatId: "chat-1",
    completedSource: {
      jobId: "source-job-1",
      expectedCacheKey: "cache-key-1"
    }
  });
  const mismatchedDuration = clipsOwnerRenderVideoInputSchema.safeParse({
    channelId: "channel-1",
    chatId: "chat-1",
    sourceDurationSec: 6,
    completedSource
  });

  assert.equal(missingChat.success, false);
  assert.equal(incomplete.success, false);
  assert.equal(mismatchedDuration.success, false);
});

test("clips_owner_render_video schema preserves caller snapshot media controls", () => {
  const parsed = clipsOwnerRenderVideoInputSchema.parse({
    channelId: "channel-1",
    chatId: "chat-1",
    workItemId: "dark-2026-07-16-1",
    revision: 2,
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
  assert.equal(parsed.workItemId, "dark-2026-07-16-1");
  assert.equal(parsed.revision, 2);
  assert.equal(snapshot.clipStartSec, 3.25);
  assert.equal(snapshot.focusY, 0.42);
  assert.equal(renderPlan.videoZoom, 1.12);
  assert.equal(renderPlan.mirrorEnabled, false);
  assert.equal(sourceCrop.height, 0.82);
  assert.equal(sourceCrop.source, "editor-controlled-crop");
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

  const inspection = clipsOwnerInspectChannelAssetInputSchema.parse({
    channelId: "channel-1",
    assetId: "asset-1"
  });
  assert.equal(inspection.assetId, "asset-1");

  const settings = clipsOwnerUpdateChannelPublishSettingsInputSchema.parse({
    channelId: "channel-1",
    autoQueueEnabled: false,
    dailySlotCount: 3
  });
  assert.equal(settings.autoQueueEnabled, false);
  assert.equal(settings.dailySlotCount, 3);
});
