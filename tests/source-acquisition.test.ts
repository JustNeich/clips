import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  downloadSourceMedia,
  fetchSourceMetadata,
  fetchOptionalYtDlpInfo,
  getSourceDownloadErrorContext,
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
    assert.deepEqual(result.providerErrorSummary, {
      primaryProvider: "visolix",
      primaryProviderError: "upstream вернул HTTP 502 (Bad gateway).",
      primaryRetryEligible: false,
      fallbackProvider: "ytDlp",
      fallbackProviderError: null,
      hostedFallbackSkippedReason: null
    });
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

test("downloadSourceMedia retries hosted YouTube Visolix once after transient provider failure", { concurrency: false }, async () => {
  const previousVisolixApiKey = process.env.VISOLIX_API_KEY;
  const previousRender = process.env.RENDER;
  const previousRetryDelay = process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS;
  process.env.VISOLIX_API_KEY = "test-visolix-key";
  process.env.RENDER = "true";
  process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS = "10";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-acquisition-hosted-retry-test-"));
  let visolixCalls = 0;
  let ytDlpCalls = 0;
  let retryNotice:
    | {
        attempt: number;
        maxAttempts: number;
        retryAt: string;
      }
    | null = null;

  setSourceAcquisitionDownloadersForTests({
    visolix: async (_rawUrl, dir) => {
      visolixCalls += 1;
      if (visolixCalls === 1) {
        throw new Error("Database connection unavailable");
      }
      const filePath = path.join(dir, "source.mp4");
      await fs.writeFile(filePath, "video");
      return {
        provider: "visolix",
        filePath,
        fileName: "source",
        title: "Recovered via retry",
        durationSec: 14,
        videoSizeBytes: 5
      };
    },
    ytDlp: async () => {
      ytDlpCalls += 1;
      throw new Error("yt-dlp should not run on hosted YouTube retry path");
    }
  });

  try {
    const startedAt = Date.now();
    const result = await downloadSourceMedia("https://www.youtube.com/watch?v=abc123XYZ89", tmpDir, {
      onRetryScheduled: (notice) => {
        retryNotice = {
          attempt: notice.attempt,
          maxAttempts: notice.maxAttempts,
          retryAt: notice.retryAt
        };
      }
    });

    assert.equal(result.provider, "visolix");
    assert.equal(result.primaryProviderError, null);
    assert.equal(result.downloadFallbackUsed, false);
    assert.equal(result.providerErrorSummary, null);
    assert.equal(visolixCalls, 2);
    assert.equal(ytDlpCalls, 0);
    const scheduledRetry = retryNotice as { attempt: number; maxAttempts: number; retryAt: string } | null;
    assert.ok(scheduledRetry);
    assert.equal(scheduledRetry.attempt, 1);
    assert.equal(scheduledRetry.maxAttempts, 2);
    assert.ok(new Date(scheduledRetry.retryAt).getTime() >= startedAt + 5);
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    if (previousVisolixApiKey === undefined) {
      delete process.env.VISOLIX_API_KEY;
    } else {
      process.env.VISOLIX_API_KEY = previousVisolixApiKey;
    }
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }
    if (previousRetryDelay === undefined) {
      delete process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS;
    } else {
      process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS = previousRetryDelay;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("downloadSourceMedia fails hosted YouTube with Visolix-only diagnostics after two transient errors", { concurrency: false }, async () => {
  const previousVisolixApiKey = process.env.VISOLIX_API_KEY;
  const previousRender = process.env.RENDER;
  const previousRetryDelay = process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS;
  process.env.VISOLIX_API_KEY = "test-visolix-key";
  process.env.RENDER = "true";
  process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS = "10";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-acquisition-hosted-fail-test-"));
  let visolixCalls = 0;
  let ytDlpCalls = 0;

  setSourceAcquisitionDownloadersForTests({
    visolix: async () => {
      visolixCalls += 1;
      throw new Error("Bad gateway");
    },
    ytDlp: async () => {
      ytDlpCalls += 1;
      throw new Error("yt-dlp should not run for hosted YouTube media");
    }
  });

  try {
    await assert.rejects(
      () => downloadSourceMedia("https://www.youtube.com/watch?v=abc123XYZ89", tmpDir),
      (error: unknown) => {
        assert.equal(error instanceof Error ? error.message : "", "Visolix: Bad gateway");
        const context = getSourceDownloadErrorContext(error);
        assert.deepEqual(context, {
          attempt: 2,
          maxAttempts: 2,
          providerErrorSummary: {
            primaryProvider: "visolix",
            primaryProviderError: "Bad gateway",
            primaryRetryEligible: true,
            fallbackProvider: null,
            fallbackProviderError: null,
            hostedFallbackSkippedReason:
              "Hosted policy: yt-dlp fallback для YouTube source download пропущен на этом runtime."
          }
        });
        return true;
      }
    );
    assert.equal(visolixCalls, 2);
    assert.equal(ytDlpCalls, 0);
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    if (previousVisolixApiKey === undefined) {
      delete process.env.VISOLIX_API_KEY;
    } else {
      process.env.VISOLIX_API_KEY = previousVisolixApiKey;
    }
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }
    if (previousRetryDelay === undefined) {
      delete process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS;
    } else {
      process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS = previousRetryDelay;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("downloadSourceMedia does not retry hosted YouTube when Visolix error is not retryable", { concurrency: false }, async () => {
  const previousVisolixApiKey = process.env.VISOLIX_API_KEY;
  const previousRender = process.env.RENDER;
  process.env.VISOLIX_API_KEY = "test-visolix-key";
  process.env.RENDER = "true";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-acquisition-hosted-no-retry-test-"));
  let visolixCalls = 0;

  setSourceAcquisitionDownloadersForTests({
    visolix: async () => {
      visolixCalls += 1;
      throw new Error("YouTube отклонил запрос на этом сервере (anti-bot/auth).");
    }
  });

  try {
    await assert.rejects(
      () => downloadSourceMedia("https://www.youtube.com/watch?v=abc123XYZ89", tmpDir),
      (error: unknown) => {
        assert.equal(
          error instanceof Error ? error.message : "",
          "Visolix: YouTube отклонил запрос на этом сервере (anti-bot/auth)."
        );
        const context = getSourceDownloadErrorContext(error);
        assert.equal(context?.attempt, 1);
        assert.equal(context?.maxAttempts, 1);
        assert.equal(context?.providerErrorSummary.primaryRetryEligible, false);
        return true;
      }
    );
    assert.equal(visolixCalls, 1);
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    if (previousVisolixApiKey === undefined) {
      delete process.env.VISOLIX_API_KEY;
    } else {
      process.env.VISOLIX_API_KEY = previousVisolixApiKey;
    }
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
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
