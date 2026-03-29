import assert from "node:assert/strict";
import test from "node:test";

import { buildStage3RenderRequestDedupeKey } from "../lib/stage3-render-request";

test("buildStage3RenderRequestDedupeKey is stable for the same scoped request", () => {
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

test("buildStage3RenderRequestDedupeKey returns null without requestId", () => {
  assert.equal(buildStage3RenderRequestDedupeKey({}), null);
});
