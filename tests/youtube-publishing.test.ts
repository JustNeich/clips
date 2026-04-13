import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertYouTubePublishingConnectReady,
  updateYouTubeScheduledVideo,
  uploadYouTubeVideo
} from "../lib/youtube-publishing";

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
  let uploadRange = "";
  let inspectedSession = false;
  let startSessionPayload: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("upload/youtube/v3/videos?uploadType=resumable")) {
      startSessionPayload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(null, {
        status: 200,
        headers: {
          location: "https://upload.example/session"
        }
      });
    }
    if (url === "https://upload.example/session") {
      const contentRange = init?.headers
        ? String((init.headers as Record<string, string>)["Content-Range"] ?? "")
        : "";
      if (contentRange === "bytes */8") {
        inspectedSession = true;
        return new Response(null, { status: 308 });
      }
      uploadBody = init?.body ?? null;
      uploadLength = init?.headers
        ? String((init.headers as Record<string, string>)["Content-Length"] ?? "")
        : "";
      uploadRange = contentRange;
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
    assert.equal(inspectedSession, true);
    assert.equal(uploadLength, "8");
    assert.equal(uploadRange, "bytes 0-7/8");
    const startSessionPayloadRecord = startSessionPayload as { snippet?: Record<string, unknown> } | null;
    const startSessionSnippet = startSessionPayloadRecord?.snippet ?? null;
    assert.equal(startSessionSnippet?.categoryId, "22");
    assert.ok(uploadBody, "expected upload request body to be present");
    assert.equal(uploadBody instanceof Uint8Array, false);
    assert.equal(Buffer.isBuffer(uploadBody), false);
    assert.equal(typeof (uploadBody as { getReader?: unknown }).getReader, "function");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("updateYouTubeScheduledVideo preserves the existing category id during metadata sync", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: string | null }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    requests.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : null
    });

    if (url.includes("/videos?part=snippet&id=youtube-video-1")) {
      return Response.json(
        {
          items: [
            {
              snippet: {
                categoryId: "27"
              }
            }
          ]
        },
        { status: 200 }
      );
    }

    if (url.includes("/videos?part=snippet,status") && method === "PUT") {
      return Response.json({ ok: true }, { status: 200 });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    await updateYouTubeScheduledVideo({
      accessToken: "token",
      videoId: "youtube-video-1",
      title: "Updated title",
      description: "Updated description",
      tags: ["alpha", "beta"],
      publishAt: "2040-05-05T18:00:00.000Z"
    });

    const updateRequest = requests.find(
      (request) => request.url.includes("/videos?part=snippet,status") && request.method === "PUT"
    );
    assert.ok(updateRequest, "expected metadata update request");
    const payload = JSON.parse(updateRequest?.body ?? "{}") as {
      snippet?: { categoryId?: string };
    };
    assert.equal(payload.snippet?.categoryId, "27");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updateYouTubeScheduledVideo falls back to the default category when YouTube omits it", async () => {
  const originalFetch = globalThis.fetch;
  let updatePayload: { snippet?: { categoryId?: string } } | null = null;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";

    if (url.includes("/videos?part=snippet&id=youtube-video-2")) {
      return Response.json({ items: [{ snippet: {} }] }, { status: 200 });
    }

    if (url.includes("/videos?part=snippet,status") && method === "PUT") {
      updatePayload = JSON.parse(String(init?.body ?? "{}")) as { snippet?: { categoryId?: string } };
      return Response.json({ ok: true }, { status: 200 });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    await updateYouTubeScheduledVideo({
      accessToken: "token",
      videoId: "youtube-video-2",
      title: "Updated title",
      description: "Updated description",
      tags: ["alpha"],
      publishAt: "2040-05-05T18:00:00.000Z"
    });

    assert.ok(updatePayload, "expected metadata update payload");
    const finalUpdatePayload = updatePayload as { snippet?: { categoryId?: string } };
    assert.equal(finalUpdatePayload.snippet?.categoryId, "22");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uploadYouTubeVideo resumes an existing upload session instead of opening a duplicate session", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "clips-youtube-resume-test-"));
  const filePath = path.join(tmpDir, "video.mp4");
  await writeFile(filePath, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

  const originalFetch = globalThis.fetch;
  let openedNewSession = false;
  let resumedRange = "";
  let resumedLength = "";

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("upload/youtube/v3/videos?uploadType=resumable")) {
      openedNewSession = true;
      throw new Error("should not open a new upload session");
    }
    if (url === "https://upload.example/session") {
      const headers = init?.headers as Record<string, string> | undefined;
      const contentRange = String(headers?.["Content-Range"] ?? "");
      if (contentRange === "bytes */8") {
        return new Response(null, {
          status: 308,
          headers: {
            range: "bytes=0-3"
          }
        });
      }
      resumedRange = contentRange;
      resumedLength = String(headers?.["Content-Length"] ?? "");
      return Response.json({ id: "youtube-video-resumed" }, { status: 200 });
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
      publishAt: "2040-05-05T18:00:00.000Z",
      sessionUrl: "https://upload.example/session"
    });

    assert.equal(result.videoId, "youtube-video-resumed");
    assert.equal(openedNewSession, false);
    assert.equal(resumedRange, "bytes 4-7/8");
    assert.equal(resumedLength, "4");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tmpDir, { recursive: true, force: true });
  }
});
