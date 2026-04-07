import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  downloadSourceMedia,
  fetchSourceMetadata,
  fetchOptionalYtDlpInfo,
  setSourceAcquisitionDownloadersForTests,
  summarizeProviderTextResponse
} from "../lib/source-acquisition";
import { normalizeSupportedUrl } from "../lib/supported-url";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

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

test("downloadSourceMedia exhausts raw instagram reel variants before trying encoded Visolix fallbacks", { concurrency: false }, async () => {
  const previousVisolixApiKey = process.env.VISOLIX_API_KEY;
  const previousVisolixBaseUrl = process.env.VISOLIX_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.VISOLIX_API_KEY = "test-visolix-key";
  process.env.VISOLIX_BASE_URL = "https://visolix.test";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-acquisition-instagram-visolix-test-"));
  const sourceUrl = "https://www.instagram.com/memeflickofficial/reel/DWCau2xDLz6/";
  const canonicalUrl = "https://www.instagram.com/reel/DWCau2xDLz6/";
  const seenHeaders: Array<{ platform: string | null; url: string | null; format: string | null }> = [];

  globalThis.fetch = (async (input, init) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (requestUrl === "https://visolix.test/api/download") {
      const headers = new Headers(init?.headers);
      seenHeaders.push({
        platform: headers.get("X-PLATFORM"),
        url: headers.get("URL"),
        format: headers.get("X-FORMAT")
      });

      if (seenHeaders.length < 4) {
        return jsonResponse({
          success: false,
          message: "Platform mismatch. Detected: other, Provided: instagram"
        });
      }

      return jsonResponse({
        success: true,
        title: "Instagram source",
        download_url: "https://downloads.visolix.test/source.mp4"
      });
    }

    if (requestUrl === "https://downloads.visolix.test/source.mp4") {
      return new Response(Buffer.from("video"), {
        status: 200,
        headers: { "content-type": "video/mp4" }
      });
    }

    throw new Error(`Unexpected fetch call during Visolix test: ${requestUrl}`);
  }) as typeof fetch;

  try {
    const result = await downloadSourceMedia(sourceUrl, tmpDir);

    assert.equal(result.provider, "visolix");
    assert.equal(result.downloadFallbackUsed, false);
    assert.equal(result.primaryProviderError, null);
    assert.deepEqual(seenHeaders, [
      {
        platform: "instagram",
        url: canonicalUrl,
        format: null
      },
      {
        platform: "instagram",
        url: "https://www.instagram.com/reel/DWCau2xDLz6",
        format: null
      },
      {
        platform: "instagram",
        url: "https://instagram.com/reel/DWCau2xDLz6",
        format: null
      },
      {
        platform: "instagram",
        url: "https://instagram.com/reel/DWCau2xDLz6/",
        format: null
      }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousVisolixApiKey === undefined) {
      delete process.env.VISOLIX_API_KEY;
    } else {
      process.env.VISOLIX_API_KEY = previousVisolixApiKey;
    }
    if (previousVisolixBaseUrl === undefined) {
      delete process.env.VISOLIX_BASE_URL;
    } else {
      process.env.VISOLIX_BASE_URL = previousVisolixBaseUrl;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("normalizeSupportedUrl collapses instagram username reel links to the canonical reel path", () => {
  assert.equal(
    normalizeSupportedUrl("https://www.instagram.com/memeflickofficial/reel/DV-jLoyDPJG/?igsh=123"),
    "https://www.instagram.com/reel/DV-jLoyDPJG/"
  );
});

test("downloadSourceMedia sends the canonical instagram reel path to Visolix before trying the original username path", { concurrency: false }, async () => {
  const previousVisolixApiKey = process.env.VISOLIX_API_KEY;
  const previousVisolixBaseUrl = process.env.VISOLIX_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.VISOLIX_API_KEY = "test-visolix-key";
  process.env.VISOLIX_BASE_URL = "https://visolix.test";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-acquisition-instagram-canonical-visolix-test-"));
  const sourceUrl = "https://www.instagram.com/memeflickofficial/reel/DV-jLoyDPJG/";
  const canonicalUrl = "https://www.instagram.com/reel/DV-jLoyDPJG/";
  const seenHeaders: Array<{ platform: string | null; url: string | null }> = [];

  globalThis.fetch = (async (input, init) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (requestUrl === "https://visolix.test/api/download") {
      const headers = new Headers(init?.headers);
      seenHeaders.push({
        platform: headers.get("X-PLATFORM"),
        url: headers.get("URL")
      });

      return jsonResponse({
        success: true,
        title: "Instagram source",
        download_url: "https://downloads.visolix.test/source.mp4"
      });
    }

    if (requestUrl === "https://downloads.visolix.test/source.mp4") {
      return new Response(Buffer.from("video"), {
        status: 200,
        headers: { "content-type": "video/mp4" }
      });
    }

    throw new Error(`Unexpected fetch call during canonical Visolix test: ${requestUrl}`);
  }) as typeof fetch;

  try {
    const result = await downloadSourceMedia(sourceUrl, tmpDir);

    assert.equal(result.provider, "visolix");
    assert.equal(result.downloadFallbackUsed, false);
    assert.equal(result.primaryProviderError, null);
    assert.deepEqual(seenHeaders, [
      {
        platform: "instagram",
        url: canonicalUrl
      }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousVisolixApiKey === undefined) {
      delete process.env.VISOLIX_API_KEY;
    } else {
      process.env.VISOLIX_API_KEY = previousVisolixApiKey;
    }
    if (previousVisolixBaseUrl === undefined) {
      delete process.env.VISOLIX_BASE_URL;
    } else {
      process.env.VISOLIX_BASE_URL = previousVisolixBaseUrl;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("uploaded mp4 metadata exposes upload provider without comments", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-acquisition-upload-meta-test-"));
  try {
    const metadata = await fetchSourceMetadata("upload://abc123/final-cut.mp4");
    const optionalInfo = await fetchOptionalYtDlpInfo("upload://abc123/final-cut.mp4", tmpDir);
    assert.equal(metadata.provider, "upload");
    assert.equal(metadata.title, "final-cut.mp4");
    assert.equal(metadata.durationSec, null);
    assert.equal(optionalInfo.infoJson?.title, "final-cut.mp4");
    assert.equal(optionalInfo.commentsAcquisition.provider, null);
    assert.equal(optionalInfo.commentsAcquisition.status, "unavailable");
    assert.equal(optionalInfo.commentsAcquisition.error, "Комментарии для загруженного mp4 недоступны.");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
