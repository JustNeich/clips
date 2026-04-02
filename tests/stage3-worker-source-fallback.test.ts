import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadSourceVideo } from "../lib/stage3-media-agent";
import { setSourceAcquisitionDownloadersForTests } from "../lib/source-acquisition";

test("downloadSourceVideo falls back to host source fetch for local Stage 3 workers", { concurrency: false }, async () => {
  const previousServerOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN;
  const previousSessionToken = process.env.STAGE3_WORKER_SESSION_TOKEN;
  const originalFetch = globalThis.fetch;

  process.env.STAGE3_WORKER_SERVER_ORIGIN = "https://clips.example.com";
  process.env.STAGE3_WORKER_SESSION_TOKEN = "worker-session-token";

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async () => {
      throw new Error("YouTube отклонил запрос на этом сервере (anti-bot/auth).");
    }
  });

  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://clips.example.com/api/stage3/worker/source");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer worker-session-token");
    assert.equal((init?.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.equal(init?.body, JSON.stringify({ url: "https://www.youtube.com/watch?v=abc123XYZ89" }));

    return new Response(Buffer.from("hosted-video"), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "x-stage3-source-file-name": "server-source"
      }
    });
  }) as typeof fetch;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-worker-source-fallback-"));

  try {
    const downloaded = await downloadSourceVideo("https://www.youtube.com/watch?v=abc123XYZ89", tmpDir);
    assert.equal(downloaded.fileName, "server-source");
    assert.equal(path.basename(downloaded.filePath), "worker-source-server-source.mp4");
    assert.equal(await fs.readFile(downloaded.filePath, "utf-8"), "hosted-video");
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    globalThis.fetch = originalFetch;
    if (previousServerOrigin === undefined) {
      delete process.env.STAGE3_WORKER_SERVER_ORIGIN;
    } else {
      process.env.STAGE3_WORKER_SERVER_ORIGIN = previousServerOrigin;
    }
    if (previousSessionToken === undefined) {
      delete process.env.STAGE3_WORKER_SESSION_TOKEN;
    } else {
      process.env.STAGE3_WORKER_SESSION_TOKEN = previousSessionToken;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
