import assert from "node:assert/strict";
import test from "node:test";
import { buildStage3PreviewDedupeKey } from "../lib/stage3-preview-service";
import { buildStage3RenderRequestDedupeKey } from "../lib/stage3-render-request";
import type { Stage3CompletedSourceBinding } from "../lib/stage3-source-binding";

function binding(sha: string): Stage3CompletedSourceBinding {
  return {
    kind: "completed-source-job",
    sourceJobId: "source-job-1",
    sourceCacheKey: "source-cache-1",
    sourceUrl: "https://www.instagram.com/reel/exact-media/",
    sourceDurationSec: 17.069,
    sourceWidth: 720,
    sourceHeight: 1280,
    sourceSizeBytes: 123_456,
    sourceSha256: sha.repeat(64)
  };
}

test("preview dedupe reuses the same completed media binding and separates changed bytes", async () => {
  const scope = { workspaceId: "workspace-1", userId: "user-1" };
  const body = {
    channelId: "channel-1",
    chatId: "chat-1",
    sourceUrl: "https://www.instagram.com/reel/exact-media/",
    sourceBinding: binding("a"),
    snapshot: { renderPlan: { videoFit: "cover" as const } }
  };
  const first = await buildStage3PreviewDedupeKey(body, scope);
  const repeated = await buildStage3PreviewDedupeKey(body, scope);
  const changedBytes = await buildStage3PreviewDedupeKey(
    {
      ...body,
      sourceBinding: binding("b")
    },
    scope
  );

  assert.equal(first, repeated);
  assert.notEqual(first, changedBytes);
});

test("render dedupe includes the completed media binding", () => {
  const scope = { workspaceId: "workspace-1", userId: "user-1" };
  const base = {
    channelId: "channel-1",
    chatId: "chat-1",
    sourceUrl: "https://www.instagram.com/reel/exact-media/",
    sourceBinding: binding("a"),
    snapshot: { topText: "EXACT SOURCE" }
  };
  const first = buildStage3RenderRequestDedupeKey(base, scope);
  const repeated = buildStage3RenderRequestDedupeKey(base, scope);
  const changedBytes = buildStage3RenderRequestDedupeKey(
    {
      ...base,
      sourceBinding: binding("b")
    },
    scope
  );

  assert.equal(first, repeated);
  assert.notEqual(first, changedBytes);
});
