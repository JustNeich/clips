import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeYoutubeDescription,
  youtubeDescriptionContainsLink
} from "../lib/youtube-description-policy";

test("YouTube descriptions strip URLs and dangling source labels", () => {
  assert.equal(sanitizeYoutubeDescription("Source: https://instagram.com/reel/a"), "");
  assert.equal(sanitizeYoutubeDescription("Источник: www.instagram.com/reel/a"), "");
  assert.equal(sanitizeYoutubeDescription("Context https://example.com/a remains"), "Context remains");
  assert.equal(youtubeDescriptionContainsLink("plain text"), false);
  assert.equal(youtubeDescriptionContainsLink("http://example.com"), true);
});
