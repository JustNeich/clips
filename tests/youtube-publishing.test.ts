import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertYouTubePublishingConnectReady, uploadYouTubeVideo } from "../lib/youtube-publishing";

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("YouTube connect readiness fails fast when OAuth client config is missing", () => {
  assert.throws(
    () =>
      withEnv(
        {
          NODE_ENV: "production",
          APP_ENCRYPTION_KEY: "test-encryption-key",
          GOOGLE_OAUTH_CLIENT_ID: undefined,
          GOOGLE_OAUTH_CLIENT_SECRET: undefined
        },
        () => assertYouTubePublishingConnectReady()
      ),
    /GOOGLE_OAUTH_CLIENT_ID/
  );
});

test("YouTube connect readiness fails fast when credential storage encryption is unavailable", () => {
  assert.throws(
    () =>
      withEnv(
        {
          NODE_ENV: "production",
          APP_ENCRYPTION_KEY: undefined,
          GOOGLE_OAUTH_CLIENT_ID: "client-id",
          GOOGLE_OAUTH_CLIENT_SECRET: "client-secret"
        },
        () => assertYouTubePublishingConnectReady()
      ),
    /APP_ENCRYPTION_KEY is required in production/
  );
});

test("uploadYouTubeVideo streams the artifact body instead of buffering the whole file in memory", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "clips-youtube-upload-test-"));
  const filePath = path.join(tmpDir, "video.mp4");
  await writeFile(filePath, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

  const originalFetch = globalThis.fetch;
  let uploadBody: unknown = null;
  let uploadLength = "";

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("upload/youtube/v3/videos?uploadType=resumable")) {
      return new Response(null, {
        status: 200,
        headers: {
          location: "https://upload.example/session"
        }
      });
    }
    if (url === "https://upload.example/session") {
      uploadBody = init?.body ?? null;
      uploadLength = init?.headers
        ? String((init.headers as Record<string, string>)["Content-Length"] ?? "")
        : "";
      return Response.json({ id: "youtube-video-1" }, { status: 200 });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const result = await uploadYouTubeVideo({
      accessToken: "token",
      filePath,
      mimeType: "video/mp4",
      title: "Clip",
      description: "Desc",
      tags: ["tag"],
      notifySubscribers: false,
      publishAt: "2040-05-05T18:00:00.000Z"
    });

    assert.equal(result.videoId, "youtube-video-1");
    assert.equal(uploadLength, "8");
    assert.ok(uploadBody, "expected upload request body to be present");
    assert.equal(uploadBody instanceof Uint8Array, false);
    assert.equal(Buffer.isBuffer(uploadBody), false);
    assert.equal(typeof (uploadBody as { getReader?: unknown }).getReader, "function");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tmpDir, { recursive: true, force: true });
  }
});
