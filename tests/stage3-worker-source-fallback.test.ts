import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { POST as postStage3WorkerSource } from "../app/api/stage3/worker/source/route";
import { getDb, newId, nowIso } from "../lib/db/client";
import { ensureSourceMediaCached } from "../lib/source-media-cache";
import { downloadSourceVideo } from "../lib/stage3-media-agent";
import { setSourceAcquisitionDownloadersForTests } from "../lib/source-acquisition";
import { exchangeStage3WorkerPairingToken, issueStage3WorkerPairingToken } from "../lib/stage3-worker-store";
import { buildUploadedSourceUrl } from "../lib/uploaded-source";
import { storeUploadedSourceMedia } from "../lib/source-media-cache";

test("downloadSourceVideo falls back to host source cache for local Stage 3 workers", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-worker-source-cache-"));
  const previousServerOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN;
  const previousSessionToken = process.env.STAGE3_WORKER_SESSION_TOKEN;
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const originalFetch = globalThis.fetch;
  const url = "https://www.youtube.com/watch?v=abc123XYZ89";

  process.env.APP_DATA_DIR = appDataDir;
  const db = getDb();
  const stamp = nowIso();
  db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "ws_stage3",
    "Stage 3 Workspace",
    "stage3-workspace",
    stamp,
    stamp
  );
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("user_stage3", "stage3@example.com", "hash", "Stage 3 User", "active", stamp, stamp);
  db.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newId(), "ws_stage3", "user_stage3", "owner", stamp, stamp);
  const { token: pairingToken } = issueStage3WorkerPairingToken({
    workspaceId: "ws_stage3",
    userId: "user_stage3"
  });
  const { sessionToken } = exchangeStage3WorkerPairingToken({
    pairingToken,
    label: "Worker",
    platform: "win32-x64"
  });

  process.env.STAGE3_WORKER_SERVER_ORIGIN = "https://clips.example.com";
  process.env.STAGE3_WORKER_SESSION_TOKEN = sessionToken;

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async (_rawUrl, tmpDir) => {
      const filePath = path.join(tmpDir, "source.mp4");
      await fs.writeFile(filePath, "cached-video");
      return {
        provider: "ytDlp",
        filePath,
        fileName: "cached-source",
        title: "Cached source",
        durationSec: 12,
        videoSizeBytes: 12
      };
    }
  });
  await ensureSourceMediaCached(url);

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async () => {
      throw new Error("host route should serve the cached source artifact");
    }
  });

  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://clips.example.com/api/stage3/worker/source");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${sessionToken}`);
    assert.equal((init?.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.equal(init?.body, JSON.stringify({ url }));

    return postStage3WorkerSource(
      new Request(String(input), {
        method: "POST",
        headers: init?.headers,
        body: String(init?.body ?? "")
      })
    );
  }) as typeof fetch;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-worker-source-fallback-"));

  try {
    const downloaded = await downloadSourceVideo(url, tmpDir);
    assert.equal(downloaded.fileName, "cached-source");
    assert.equal(path.basename(downloaded.filePath), "worker-source-cached-source.mp4");
    assert.equal(await fs.readFile(downloaded.filePath, "utf-8"), "cached-video");
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    globalThis.fetch = originalFetch;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
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
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
});

test("downloadSourceVideo reuses shared source cache on server-side Stage 3 runs", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-source-cache-server-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousServerOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN;
  const previousSessionToken = process.env.STAGE3_WORKER_SESSION_TOKEN;
  const url = "https://www.instagram.com/reel/stage3-cache-hit/";

  process.env.APP_DATA_DIR = appDataDir;
  delete process.env.STAGE3_WORKER_SERVER_ORIGIN;
  delete process.env.STAGE3_WORKER_SESSION_TOKEN;

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async (_rawUrl, tmpDir) => {
      const filePath = path.join(tmpDir, "source.mp4");
      await fs.writeFile(filePath, "server-cached-video");
      return {
        provider: "ytDlp",
        filePath,
        fileName: "server-cache-source",
        title: "Server cached source",
        durationSec: 9,
        videoSizeBytes: 19
      };
    }
  });
  const cached = await ensureSourceMediaCached(url);

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async () => {
      throw new Error("server-side Stage 3 should reuse shared source cache");
    }
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-source-download-"));
  try {
    const downloaded = await downloadSourceVideo(url, tmpDir);
    assert.equal(downloaded.fileName, "server-cache-source");
    assert.equal(downloaded.filePath, cached.sourcePath);
    assert.equal(await fs.readFile(downloaded.filePath, "utf-8"), "server-cached-video");
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
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
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
});

test("downloadSourceVideo falls back to host cache for uploaded mp4 sources with non-ASCII filenames", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-worker-upload-source-cache-"));
  const previousServerOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN;
  const previousSessionToken = process.env.STAGE3_WORKER_SESSION_TOKEN;
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const originalFetch = globalThis.fetch;
  const fileName = "хайлайт тест.mp4";
  const url = buildUploadedSourceUrl(`upload-${Date.now()}`, fileName);

  process.env.APP_DATA_DIR = appDataDir;
  const db = getDb();
  const stamp = nowIso();
  db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "ws_stage3_upload",
    "Stage 3 Upload Workspace",
    "stage3-upload-workspace",
    stamp,
    stamp
  );
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run("user_stage3_upload", "stage3-upload@example.com", "hash", "Stage 3 Upload User", "active", stamp, stamp);
  db.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newId(), "ws_stage3_upload", "user_stage3_upload", "owner", stamp, stamp);
  const { token: pairingToken } = issueStage3WorkerPairingToken({
    workspaceId: "ws_stage3_upload",
    userId: "user_stage3_upload"
  });
  const { sessionToken } = exchangeStage3WorkerPairingToken({
    pairingToken,
    label: "Worker",
    platform: "darwin-arm64"
  });

  process.env.STAGE3_WORKER_SERVER_ORIGIN = "https://clips.example.com";
  process.env.STAGE3_WORKER_SESSION_TOKEN = sessionToken;

  await storeUploadedSourceMedia({
    sourceUrl: url,
    fileName,
    title: "Uploaded source",
    sourceStream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("uploaded-video"));
        controller.close();
      }
    })
  });

  globalThis.fetch = (async (input, init) => {
    const response = await postStage3WorkerSource(
      new Request(String(input), {
        method: "POST",
        headers: init?.headers,
        body: String(init?.body ?? "")
      })
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-stage3-source-file-name"), encodeURIComponent(fileName));
    return response;
  }) as typeof fetch;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-worker-upload-source-fallback-"));

  try {
    const downloaded = await downloadSourceVideo(url, tmpDir);
    assert.equal(downloaded.fileName, "_.mp4");
    assert.equal(path.basename(downloaded.filePath), "worker-source-_.mp4.mp4");
    assert.equal(await fs.readFile(downloaded.filePath, "utf-8"), "uploaded-video");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
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
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
});
