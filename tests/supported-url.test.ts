import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedUrl, normalizeSupportedUrl } from "../lib/supported-url";

test("normalizeSupportedUrl canonicalizes instagram username reel links", () => {
  assert.equal(
    normalizeSupportedUrl("https://www.instagram.com/memeflickofficial/reel/DV-jLoyDPJG/?igsh=123"),
    "https://www.instagram.com/reel/DV-jLoyDPJG/"
  );
});

test("upload scheme is accepted as a first-class Stage 1 source", () => {
  assert.equal(normalizeSupportedUrl("upload://abc123/final-cut.mp4"), "upload://abc123/final-cut.mp4");
  assert.equal(isSupportedUrl("upload://abc123/final-cut.mp4"), true);
});

test("unsupported hosts remain blocked", () => {
  assert.equal(isSupportedUrl("https://www.tiktok.com/@demo/video/123"), false);
  assert.equal(isSupportedUrl("https://example.com/video.mp4"), false);
});
