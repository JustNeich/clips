import assert from "node:assert/strict";
import test from "node:test";

import { buildStage3RenderRequestDedupeKey } from "../lib/stage3-render-request";

test("buildStage3RenderRequestDedupeKey is stable for the same scoped request id fallback", () => {
  const keyA = buildStage3RenderRequestDedupeKey(
    { requestId: "render-req-1" },
    { workspaceId: "w1", userId: "u1" }
  );
  const keyB = buildStage3RenderRequestDedupeKey(
    { requestId: "render-req-1" },
    { workspaceId: "w1", userId: "u1" }
  );
  const otherUser = buildStage3RenderRequestDedupeKey(
    { requestId: "render-req-1" },
    { workspaceId: "w1", userId: "u2" }
  );

  assert.equal(keyA, keyB);
  assert.notEqual(keyA, otherUser);
});

test("buildStage3RenderRequestDedupeKey is stable for identical render content", () => {
  const keyA = buildStage3RenderRequestDedupeKey(
    {
      requestId: "first-click",
      sourceUrl: "https://www.instagram.com/reel/abc/",
      chatId: "chat-1",
      channelId: "channel-1",
      publishAfterRender: true,
      renderTitle: "Title",
      templateId: "animals1",
      topText: "top",
      bottomText: "bottom",
      renderPlan: { focusY: 0.3, segments: [{ startSec: 0, endSec: 2, speed: 1 }] },
      snapshot: { clipStartSec: 0, focusY: 0.3 }
    },
    { workspaceId: "w1", userId: "u1" }
  );
  const keyB = buildStage3RenderRequestDedupeKey(
    {
      requestId: "second-click",
      sourceUrl: "https://www.instagram.com/reel/abc/",
      chatId: "chat-1",
      channelId: "channel-1",
      publishAfterRender: true,
      renderTitle: "Title",
      templateId: "animals1",
      topText: "top",
      bottomText: "bottom",
      renderPlan: { segments: [{ speed: 1, endSec: 2, startSec: 0 }], focusY: 0.3 },
      snapshot: { focusY: 0.3, clipStartSec: 0 }
    },
    { workspaceId: "w1", userId: "u1" }
  );
  const changedContent = buildStage3RenderRequestDedupeKey(
    {
      sourceUrl: "https://www.instagram.com/reel/abc/",
      chatId: "chat-1",
      channelId: "channel-1",
      publishAfterRender: true,
      renderTitle: "Title",
      templateId: "animals1",
      topText: "changed",
      bottomText: "bottom",
      renderPlan: { focusY: 0.3, segments: [{ startSec: 0, endSec: 2, speed: 1 }] },
      snapshot: { clipStartSec: 0, focusY: 0.3 }
    },
    { workspaceId: "w1", userId: "u1" }
  );

  assert.equal(keyA, keyB);
  assert.notEqual(keyA, changedContent);
});

test("buildStage3RenderRequestDedupeKey returns null without requestId or render content", () => {
  assert.equal(buildStage3RenderRequestDedupeKey({}), null);
});
