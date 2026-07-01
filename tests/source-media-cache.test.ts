import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  ensureSourceMediaCached,
  getCachedSourceMedia,
  getSourceMediaCacheKey,
  pruneSourceMediaCacheForTests,
  storeDownloadedSourceMediaCacheArtifact
} from "../lib/source-media-cache";
import { POST as completeWorkerStage3Job } from "../app/api/stage3/worker/jobs/[id]/complete/route";
import { getDb, newId, nowIso } from "../lib/db/client";
import { setSourceAcquisitionDownloadersForTests } from "../lib/source-acquisition";
import {
  claimNextQueuedStage3JobForWorker,
  completeStage3Job,
  enqueueStage3Job,
  getStage3Job
} from "../lib/stage3-job-store";
import { exchangeStage3WorkerPairingToken, issueStage3WorkerPairingToken } from "../lib/stage3-worker-store";

const execFileAsync = promisify(execFile);

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

function resetDbAndStage3Globals(): void {
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsStage3JobRuntimeState__?: unknown }).__clipsStage3JobRuntimeState__;
}

function seedWorkspaceUser(workspaceId = "w1", userId = "u1"): void {
  const db = getDb();
  const stamp = nowIso();
  db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    workspaceId,
    "Source Cache Workspace",
    `source-cache-${workspaceId}`,
    stamp,
    stamp
  );
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, `${userId}@example.com`, "hash", "Source User", "active", stamp, stamp);
  db.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newId(), workspaceId, userId, "owner", stamp, stamp);
}

async function waitForWorkerClaim(input: {
  workspaceId: string;
  userId: string;
  workerId: string;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (input.timeoutMs ?? 2_000);
  while (Date.now() <= deadline) {
    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: input.workerId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      supportedKinds: ["source-download"]
    });
    if (claimed) {
      return claimed;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for source-download worker job.");
}

test("ensureSourceMediaCached reuses the cached source artifact instead of redownloading", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-media-cache-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let downloadCalls = 0;

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async (_rawUrl, tmpDir) => {
      downloadCalls += 1;
      const filePath = path.join(tmpDir, "source.mp4");
      await fs.writeFile(filePath, "video");
      return {
        provider: "ytDlp",
        filePath,
        fileName: "cached-source",
        title: "Cached source",
        durationSec: 12,
        videoSizeBytes: 5
      };
    }
  });

  process.env.APP_DATA_DIR = appDataDir;

  try {
    const url = "https://www.instagram.com/reel/cache-hit-test/";
    const first = await ensureSourceMediaCached(url);
    const second = await ensureSourceMediaCached(url);

    assert.equal(first.cacheState, "miss");
    assert.equal(second.cacheState, "hit");
    assert.equal(downloadCalls, 1);
    assert.equal(second.sourceKey, first.sourceKey);
    assert.equal(second.sourcePath, first.sourcePath);
    assert.equal(second.fileName, "cached-source");
    assert.equal(second.downloadProvider, "ytDlp");
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
});

test("ensureSourceMediaCached evicts cached external media with truncated audio before reuse", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-media-cache-bad-audio-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const url = "https://www.instagram.com/reel/cache-bad-audio/";
  let downloadCalls = 0;

  process.env.APP_DATA_DIR = appDataDir;

  const cacheDir = path.join(appDataDir, "source-media-cache", "sources");
  const sourceKey = getSourceMediaCacheKey(url);
  await fs.mkdir(cacheDir, { recursive: true });
  await writeVideoWithAudio(path.join(cacheDir, `${sourceKey}.mp4`), 6, 3);
  await fs.writeFile(
    path.join(cacheDir, `${sourceKey}.json`),
    `${JSON.stringify({
      fileName: "bad-visolix-source",
      title: "Bad Visolix Source",
      videoSizeBytes: 1,
      downloadProvider: "visolix",
      primaryProviderError: null,
      downloadFallbackUsed: false,
      providerErrorSummary: null
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
        fileName: "recovered-source",
        title: "Recovered source",
        durationSec: 6,
        videoSizeBytes: stat.size
      };
    }
  });

  try {
    const cached = await ensureSourceMediaCached(url);
    assert.equal(cached.cacheState, "miss");
    assert.equal(cached.fileName, "recovered-source");
    assert.equal(cached.downloadProvider, "ytDlp");
    assert.equal(downloadCalls, 1);
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
});

test("hosted source media cache keeps only the tighter hosted entry budget", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-media-cache-hosted-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousRender = process.env.RENDER;
  let downloadCalls = 0;

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async (_rawUrl, tmpDir) => {
      downloadCalls += 1;
      const filePath = path.join(tmpDir, "source.mp4");
      await fs.writeFile(filePath, "video");
      return {
        provider: "ytDlp",
        filePath,
        fileName: `cached-${downloadCalls}`,
        title: `Cached ${downloadCalls}`,
        durationSec: 12,
        videoSizeBytes: 5
      };
    }
  });

  process.env.APP_DATA_DIR = appDataDir;
  process.env.RENDER = "true";

  try {
    for (let index = 0; index < 10; index += 1) {
      await ensureSourceMediaCached(`https://www.instagram.com/reel/cache-limit-${index}/`);
    }
    await pruneSourceMediaCacheForTests();

    const cacheDir = path.join(appDataDir, "source-media-cache", "sources");
    const entries = await fs.readdir(cacheDir);
    assert.equal(entries.filter((name) => name.endsWith(".mp4")).length, 8);
    assert.equal(downloadCalls, 10);
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
});

test("ensureSourceMediaCached prunes before writing and retries once after ENOSPC", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-media-cache-enospc-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousRender = process.env.RENDER;

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async (_rawUrl, tmpDir) => {
      const filePath = path.join(tmpDir, "source.mp4");
      await fs.writeFile(filePath, "new-video");
      return {
        provider: "ytDlp",
        filePath,
        fileName: "new-source",
        title: "New Source",
        durationSec: 12,
        videoSizeBytes: 9
      };
    }
  });

  process.env.APP_DATA_DIR = appDataDir;
  process.env.RENDER = "true";

  const cacheDir = path.join(appDataDir, "source-media-cache", "sources");
  await fs.mkdir(cacheDir, { recursive: true });
  const expiredSource = path.join(cacheDir, "expired.mp4");
  const expiredMeta = path.join(cacheDir, "expired.json");
  const retainedBeforeRetrySource = path.join(cacheDir, "retained-before-retry.mp4");
  const retainedBeforeRetryMeta = path.join(cacheDir, "retained-before-retry.json");
  await fs.writeFile(expiredSource, "expired-video");
  await fs.writeFile(expiredMeta, "{}\n", "utf-8");
  await fs.writeFile(retainedBeforeRetrySource, "recent-video");
  await fs.writeFile(retainedBeforeRetryMeta, "{}\n", "utf-8");
  const expiredDate = new Date(Date.now() - 7 * 60 * 60_000);
  await fs.utimes(expiredSource, expiredDate, expiredDate);
  await fs.utimes(expiredMeta, expiredDate, expiredDate);

  const originalCopyFile = fs.copyFile;
  let attempts = 0;
  fs.copyFile = async (source, destination, mode) => {
    attempts += 1;
    if (attempts === 1) {
      assert.equal(existsSync(expiredSource), false, "expired cache entries must be pruned before copy");
      assert.equal(
        existsSync(retainedBeforeRetrySource),
        true,
        "normal pre-write pruning should keep fresh source cache entries"
      );
      const error = new Error("ENOSPC: no space left on device, copyfile") as NodeJS.ErrnoException;
      error.code = "ENOSPC";
      throw error;
    }
    assert.equal(
      existsSync(retainedBeforeRetrySource),
      false,
      "emergency retry should clear non-sticky source cache entries"
    );
    return originalCopyFile(source, destination, mode);
  };

  try {
    const cached = await ensureSourceMediaCached("https://www.instagram.com/reel/source-cache-enospc/");
    assert.equal(attempts, 2);
    assert.equal(cached.cacheState, "miss");
    assert.equal(cached.videoSizeBytes, 9);
    assert.equal(await fs.readFile(cached.sourcePath, "utf-8"), "new-video");
    assert.equal(existsSync(path.join(cacheDir, `${cached.sourceKey}.json`)), true);
    const mp4Files = (await fs.readdir(cacheDir)).filter((name) => name.endsWith(".mp4"));
    assert.deepEqual(mp4Files, [`${cached.sourceKey}.mp4`]);
  } finally {
    fs.copyFile = originalCopyFile;
    setSourceAcquisitionDownloadersForTests(null);
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
});

test("ensureSourceMediaCached falls back to a local source-download job after hosted source failure", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-media-local-worker-fallback-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousRender = process.env.RENDER;
  const previousVisolixApiKey = process.env.VISOLIX_API_KEY;
  const previousRetryDelay = process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS;
  const workspaceId = "w1";
  const userId = "u1";
  const workerId = "worker-1";
  const url = "https://www.instagram.com/reel/local-worker-fallback/";

  resetDbAndStage3Globals();
  process.env.APP_DATA_DIR = appDataDir;
  process.env.RENDER = "true";
  process.env.VISOLIX_API_KEY = "test-visolix-key";
  process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS = "1";
  seedWorkspaceUser(workspaceId, userId);

  setSourceAcquisitionDownloadersForTests({
    visolix: async () => {
      throw new Error("Visolix не вернул download_url, progress_url или id для download job.");
    },
    ytDlp: async () => {
      throw new Error("Instagram отклонил запрос на этом сервере (anti-bot/auth).");
    }
  });

  try {
    const workerCompletion = (async () => {
      const claimed = await waitForWorkerClaim({ workspaceId, userId, workerId });
      assert.equal(claimed.kind, "source-download");
      const payload = JSON.parse(claimed.payloadJson) as {
        sourceUrl?: string;
        sourceMediaFallback?: {
          primaryProviderError?: string;
          providerErrorSummary?: { fallbackProviderError?: string };
        };
      };
      assert.equal(payload.sourceUrl, url);
      assert.match(payload.sourceMediaFallback?.primaryProviderError ?? "", /Visolix/);
      assert.match(payload.sourceMediaFallback?.providerErrorSummary?.fallbackProviderError ?? "", /Instagram/);

      const workerSourcePath = path.join(appDataDir, "worker-source.mp4");
      await writeVideoWithAudio(workerSourcePath, 2);
      const cached = await storeDownloadedSourceMediaCacheArtifact({
        sourceUrl: url,
        filePath: workerSourcePath,
        fileName: "worker-source.mp4",
        downloadProvider: "ytDlp",
        primaryProviderError: payload.sourceMediaFallback?.primaryProviderError ?? null,
        downloadFallbackUsed: true,
        providerErrorSummary: {
          primaryProvider: "visolix",
          primaryProviderError: "Visolix не вернул download_url, progress_url или id для download job.",
          primaryRetryEligible: true,
          fallbackProvider: "ytDlp",
          fallbackProviderError: "Instagram отклонил запрос на этом сервере (anti-bot/auth).",
          hostedFallbackSkippedReason: null
        }
      });
      completeStage3Job(claimed.id, {
        resultJson: JSON.stringify({
          sourceKey: cached.sourceKey,
          fileName: cached.fileName,
          sourceMediaCache: true
        }),
        artifact: null
      });
    })();

    const keepAlive = setInterval(() => undefined, 50);
    try {
      const [cached] = await Promise.all([
        ensureSourceMediaCached(url, {
          localWorkerFallback: {
            workspaceId,
            userId,
            waitTimeoutMs: 3_000
          }
        }),
        workerCompletion
      ]);

      assert.equal(cached.cacheState, "miss");
      assert.equal(cached.fileName, "worker-source.mp4");
      assert.equal(cached.downloadProvider, "ytDlp");
      assert.equal(cached.downloadFallbackUsed, true);
      assert.match(cached.primaryProviderError ?? "", /Visolix/);
      assert.equal(await fs.readFile(cached.sourcePath).then((buffer) => buffer.length > 0), true);
    } finally {
      clearInterval(keepAlive);
    }
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    resetDbAndStage3Globals();
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }
    if (previousVisolixApiKey === undefined) {
      delete process.env.VISOLIX_API_KEY;
    } else {
      process.env.VISOLIX_API_KEY = previousVisolixApiKey;
    }
    if (previousRetryDelay === undefined) {
      delete process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS;
    } else {
      process.env.SOURCE_DOWNLOAD_RETRY_DELAY_MS = previousRetryDelay;
    }
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
});

test("source-download worker completion stores the uploaded artifact in source media cache", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-media-worker-complete-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const workspaceId = "w1";
  const userId = "u1";
  const url = "https://www.instagram.com/reel/source-download-complete/";

  resetDbAndStage3Globals();
  process.env.APP_DATA_DIR = appDataDir;
  seedWorkspaceUser(workspaceId, userId);

  try {
    const pairing = issueStage3WorkerPairingToken({ workspaceId, userId });
    const exchanged = exchangeStage3WorkerPairingToken({
      pairingToken: pairing.token,
      label: "worker",
      platform: "darwin-arm64"
    });
    const job = enqueueStage3Job({
      workspaceId,
      userId,
      kind: "source-download",
      executionTarget: "local",
      payloadJson: JSON.stringify({
        sourceUrl: url,
        sourceMediaFallback: {
          primaryProviderError: "Visolix: incomplete response",
          providerErrorSummary: {
            primaryProvider: "visolix",
            primaryProviderError: "incomplete response",
            primaryRetryEligible: true,
            fallbackProvider: "ytDlp",
            fallbackProviderError: "anti-bot",
            hostedFallbackSkippedReason: null
          }
        }
      })
    });
    const claimed = claimNextQueuedStage3JobForWorker({
      workerId: exchanged.worker.id,
      workspaceId,
      userId,
      supportedKinds: ["source-download"]
    });
    assert.equal(claimed?.id, job.id);

    const workerSourcePath = path.join(appDataDir, "completed-worker-source.mp4");
    await writeVideoWithAudio(workerSourcePath, 2);
    const response = await completeWorkerStage3Job(
      new Request(`http://localhost/api/stage3/worker/jobs/${job.id}/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${exchanged.sessionToken}`,
          "Content-Type": "video/mp4",
          "x-stage3-artifact-name": encodeURIComponent("completed-worker-source.mp4"),
          "x-stage3-artifact-mime-type": encodeURIComponent("video/mp4"),
          "x-stage3-result-json": Buffer.from(JSON.stringify({ workerCache: true }), "utf-8").toString("base64url")
        },
        body: await fs.readFile(workerSourcePath)
      }),
      { params: Promise.resolve({ id: job.id }) }
    );
    const body = (await response.json()) as { job?: { status?: string; resultJson?: string | null } };

    assert.equal(response.status, 200);
    assert.equal(body.job?.status, "completed");
    const cached = await getCachedSourceMedia(url);
    assert.ok(cached);
    assert.equal(cached.fileName, "completed-worker-source.mp4");
    assert.equal(cached.downloadProvider, "ytDlp");
    assert.equal(cached.downloadFallbackUsed, true);
    assert.match(cached.primaryProviderError ?? "", /Visolix/);
    const completed = getStage3Job(job.id);
    assert.equal(completed?.artifact, null);
    assert.equal(JSON.parse(completed?.resultJson ?? "{}").sourceMediaCache, true);
  } finally {
    resetDbAndStage3Globals();
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
});
