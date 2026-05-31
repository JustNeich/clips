import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { POST as postStage3WorkerSource } from "../app/api/stage3/worker/source/route";
import { getDb, newId, nowIso } from "../lib/db/client";
import { ensureSourceMediaCached, storeUploadedSourceMedia } from "../lib/source-media-cache";
import { downloadSourceVideo } from "../lib/stage3-media-agent";
import { ensureStage3SourceCached } from "../lib/stage3-server-control";
import { setSourceAcquisitionDownloadersForTests } from "../lib/source-acquisition";
import { exchangeStage3WorkerPairingToken, issueStage3WorkerPairingToken } from "../lib/stage3-worker-store";
import { buildUploadedSourceUrl } from "../lib/uploaded-source";
import { normalizeSupportedUrl } from "../lib/supported-url";

const execFileAsync = promisify(execFile);

function getStage3SourceCacheKey(rawUrl: string): string {
  return createHash("sha1").update(normalizeSupportedUrl(rawUrl)).digest("hex");
}

async function writeVideoWithAudio(filePath: string, durationSec: number, audioDurationSec = durationSec): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=s=64x64:r=30:d=${durationSec}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${audioDurationSec}`,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    filePath
  ]);
}

async function probeAudioDuration(filePath: string): Promise<number | null> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  const parsed = Number.parseFloat(stdout.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

test("downloadSourceVideo prefers host source cache for local Stage 3 workers", { concurrency: false }, async () => {
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
    assert.equal(init?.body, JSON.stringify({ url, cacheOnly: true }));

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

test("downloadSourceVideo keeps local acquisition when host cache is cold", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-worker-source-local-after-cold-cache-"));
  const previousServerOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN;
  const previousSessionToken = process.env.STAGE3_WORKER_SESSION_TOKEN;
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const originalFetch = globalThis.fetch;
  const url = "https://www.instagram.com/reel/host-cache-cold/";
  let localDownloadCalls = 0;

  process.env.APP_DATA_DIR = appDataDir;
  process.env.STAGE3_WORKER_SERVER_ORIGIN = "https://clips.example.com";
  process.env.STAGE3_WORKER_SESSION_TOKEN = "worker-session";

  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://clips.example.com/api/stage3/worker/source");
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, JSON.stringify({ url, cacheOnly: true }));
    return Response.json({ error: "Source media ещё не готов в cache." }, { status: 404 });
  }) as typeof fetch;

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async (_rawUrl, tmpDir) => {
      localDownloadCalls += 1;
      const filePath = path.join(tmpDir, "source.mp4");
      await fs.writeFile(filePath, "local-video");
      return {
        provider: "ytDlp",
        filePath,
        fileName: "local-source",
        title: "Local source",
        durationSec: 7,
        videoSizeBytes: 11
      };
    }
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-worker-source-local-download-"));

  try {
    const downloaded = await downloadSourceVideo(url, tmpDir);
    assert.equal(downloaded.fileName, "local-source");
    assert.equal(await fs.readFile(downloaded.filePath, "utf-8"), "local-video");
    assert.equal(localDownloadCalls, 1);
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

test("ensureStage3SourceCached evicts stale stage3 cache with truncated audio before reuse", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-source-cache-bad-audio-app-"));
  const stage3CacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-source-cache-bad-audio-stage3-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousStage3CacheRoot = process.env.CLIPS_STAGE3_CACHE_ROOT;
  const previousServerOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN;
  const previousSessionToken = process.env.STAGE3_WORKER_SESSION_TOKEN;
  const previousVisolixApiKey = process.env.VISOLIX_API_KEY;
  const url = "https://www.instagram.com/reel/stage3-cache-bad-audio/";
  const sourceKey = getStage3SourceCacheKey(url);
  const cacheDir = path.join(stage3CacheRoot, "sources");
  let downloadCalls = 0;

  process.env.APP_DATA_DIR = appDataDir;
  process.env.CLIPS_STAGE3_CACHE_ROOT = stage3CacheRoot;
  delete process.env.STAGE3_WORKER_SERVER_ORIGIN;
  delete process.env.STAGE3_WORKER_SESSION_TOKEN;
  delete process.env.VISOLIX_API_KEY;

  await fs.mkdir(cacheDir, { recursive: true });
  await writeVideoWithAudio(path.join(cacheDir, `${sourceKey}.mp4`), 6, 3);
  await fs.writeFile(
    path.join(cacheDir, `${sourceKey}.json`),
    `${JSON.stringify({
      fileName: "stale-stage3-source",
      sourceDurationSec: 6,
      normalizationVersion: 2
    })}\n`,
    "utf-8"
  );

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async (_rawUrl, tmpDir) => {
      downloadCalls += 1;
      const filePath = path.join(tmpDir, "source.mp4");
      await writeVideoWithAudio(filePath, 6);
      const stat = await fs.stat(filePath);
      return {
        provider: "ytDlp",
        filePath,
        fileName: "fresh-stage3-source",
        title: "Fresh Stage 3 Source",
        durationSec: 6,
        videoSizeBytes: stat.size
      };
    }
  });

  try {
    const cached = await ensureStage3SourceCached(url);
    const audioDuration = await probeAudioDuration(cached.sourcePath);

    assert.equal(cached.fileName, "fresh-stage3-source");
    assert.equal(downloadCalls, 1);
    assert.ok((audioDuration ?? 0) >= 5.8, `expected fresh full-length audio, got ${audioDuration}`);
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousStage3CacheRoot === undefined) {
      delete process.env.CLIPS_STAGE3_CACHE_ROOT;
    } else {
      process.env.CLIPS_STAGE3_CACHE_ROOT = previousStage3CacheRoot;
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
    if (previousVisolixApiKey === undefined) {
      delete process.env.VISOLIX_API_KEY;
    } else {
      process.env.VISOLIX_API_KEY = previousVisolixApiKey;
    }
    await fs.rm(appDataDir, { recursive: true, force: true });
    await fs.rm(stage3CacheRoot, { recursive: true, force: true });
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
