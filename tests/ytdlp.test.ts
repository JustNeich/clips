import assert from "node:assert/strict";
import test from "node:test";
import { extractYtDlpErrorFromUnknown } from "../lib/ytdlp";

test("yt-dlp anti-bot errors mention Instagram for instagram sources", () => {
  const message = extractYtDlpErrorFromUnknown(new Error("Sign in to confirm you're not a bot"), {
    sourceUrl: "https://www.instagram.com/reel/DWCau2xDLz6/"
  });

  assert.equal(
    message,
    "Instagram отклонил запрос на этом сервере (anti-bot/auth). Если YTDLP_COOKIES уже заданы, проблема может быть в IP или репутации runtime."
  );
});

test("yt-dlp anti-bot errors keep YouTube wording for youtube sources", () => {
  const message = extractYtDlpErrorFromUnknown(new Error("Sign in to confirm you're not a bot"), {
    sourceUrl: "https://www.youtube.com/watch?v=abc123XYZ89"
  });

  assert.equal(
    message,
    "YouTube отклонил запрос на этом сервере (anti-bot/auth). Если YTDLP_COOKIES уже заданы, проблема может быть в IP или репутации runtime."
  );
});
