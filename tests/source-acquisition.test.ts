import assert from "node:assert/strict";
import test from "node:test";
import { summarizeProviderTextResponse } from "../lib/source-acquisition";

test("summarizeProviderTextResponse compresses HTML gateway pages into a concise message", () => {
  const message = summarizeProviderTextResponse(`<!DOCTYPE html>
  <html lang="en-US">
    <head>
      <title>savenow.to | 502: Bad gateway</title>
    </head>
    <body>bad gateway</body>
  </html>`);

  assert.equal(message, "upstream вернул HTTP 502 (Bad gateway).");
});

test("summarizeProviderTextResponse preserves plain text responses", () => {
  const message = summarizeProviderTextResponse(" YouTube отклонил запрос на этом сервере (anti-bot/auth). ");
  assert.equal(message, "YouTube отклонил запрос на этом сервере (anti-bot/auth).");
});
