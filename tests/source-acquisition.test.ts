import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  downloadSourceMedia,
  setSourceAcquisitionDownloadersForTests,
  summarizeProviderTextResponse
} from "../lib/source-acquisition";

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

test("downloadSourceMedia keeps the primary provider error when yt-dlp fallback succeeds", { concurrency: false }, async () => {
  const previousVisolixApiKey = process.env.VISOLIX_API_KEY;
  process.env.VISOLIX_API_KEY = "test-visolix-key";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-acquisition-test-"));

  setSourceAcquisitionDownloadersForTests({
    visolix: async () => {
      throw new Error("upstream вернул HTTP 502 (Bad gateway).");
    },
    ytDlp: async (_rawUrl, dir) => {
      const filePath = path.join(dir, "source.mp4");
      await fs.writeFile(filePath, "video");
      return {
        provider: "ytDlp",
        filePath,
        fileName: "source",
        title: "Recovered via yt-dlp",
        durationSec: 12,
        videoSizeBytes: 5
      };
    }
  });

  try {
    const result = await downloadSourceMedia("https://www.youtube.com/watch?v=abc123XYZ89", tmpDir);
    assert.equal(result.provider, "ytDlp");
    assert.equal(result.downloadFallbackUsed, true);
    assert.equal(result.primaryProviderError, "Visolix: upstream вернул HTTP 502 (Bad gateway).");
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    if (previousVisolixApiKey === undefined) {
      delete process.env.VISOLIX_API_KEY;
    } else {
      process.env.VISOLIX_API_KEY = previousVisolixApiKey;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
