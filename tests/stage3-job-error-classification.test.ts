import assert from "node:assert/strict";
import test from "node:test";

import { classifyStage3HeavyJobError } from "../lib/stage3-job-executor";

test("editing proxy anti-bot failures are marked as non-recoverable", () => {
  const classified = classifyStage3HeavyJobError(
    "editing-proxy",
    new Error("sign in to confirm you're not a bot")
  );

  assert.equal(classified.code, "editing_proxy_failed");
  assert.equal(classified.recoverable, false);
  assert.equal(
    classified.message,
    "Источник отклонил запрос на этом сервере (anti-bot/auth). Если YTDLP_COOKIES уже заданы, проблема может быть в IP или репутации runtime."
  );
});

test("generic render failures stay recoverable", () => {
  const classified = classifyStage3HeavyJobError("render", new Error("Remotion crashed"));

  assert.equal(classified.code, "render_failed");
  assert.equal(classified.recoverable, true);
  assert.equal(classified.message, "Remotion crashed");
});
