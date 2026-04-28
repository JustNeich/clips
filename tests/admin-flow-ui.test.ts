import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdminFlowMcpHint,
  getAdminFlowDisplayTitle,
  getAdminFlowUrlDisplay,
  truncateMiddle
} from "../app/admin/flows/view-model";

test("admin flow URL display keeps source links readable", () => {
  const display = getAdminFlowUrlDisplay(
    "https://www.youtube.com/shorts/THIS_IS_A_VERY_LONG_SOURCE_IDENTIFIER_WITH_CAMPAIGN_PARAMETERS_1234567890abcdefghijklmnopqrstuvwxyz?utm_source=telegram&utm_campaign=long_admin_review"
  );

  assert.equal(display.href?.startsWith("https://www.youtube.com/shorts/"), true);
  assert.equal(display.host, "www.youtube.com");
  assert.match(display.path, /^shorts\/THIS_IS_A_VERY_LONG_SOURCE_IDENTIFIER/);
  assert.match(display.path, /\.\.\./);
  assert.ok(display.label.length < display.original.length);
});

test("admin flow display title normalizes URL-like titles", () => {
  const title = getAdminFlowDisplayTitle({
    title: "https://instagram.com/reel/CODEX-ADMIN-URL-LIKE-TITLE-WITH-A-LOT-OF-QUERY-LIKE-PARTS-and-no-human-spacing-at-all-1234567890/?igsh=ZWxvbmdhdGVkX3VybF9saWtlX3RpdGxl",
    sourceUrl: "https://instagram.com/reel/CODEX-ADMIN-URL-LIKE-TITLE-WITH-A-LOT-OF-QUERY-LIKE-PARTS-and-no-human-spacing-at-all-1234567890/"
  });

  assert.match(title, /^instagram\.com \/ reel\/CODEX-ADMIN-URL-LIKE-TITLE/);
  assert.ok(title.length < 120);
});

test("admin flow helpers preserve human titles and MCP hints", () => {
  assert.equal(
    getAdminFlowDisplayTitle({
      title: "Human title with client, channel and render status",
      sourceUrl: "https://example.com/watch?v=1"
    }),
    "Human title with client, channel and render status"
  );
  assert.equal(buildAdminFlowMcpHint("chat_123"), 'clips_get_flow({ "chatId": "chat_123" })');
  assert.equal(truncateMiddle("short", 12), "short");
});

test("admin flow URL display tolerates malformed escaped paths", () => {
  const display = getAdminFlowUrlDisplay("https://example.com/%E0%A4%A");

  assert.equal(display.host, "example.com");
  assert.equal(display.href, "https://example.com/%E0%A4%A");
  assert.equal(display.path, "%E0%A4%A");
});
