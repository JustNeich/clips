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
  getSourceMediaCacheKey,
  pruneSourceMediaCacheForTests
} from "../lib/source-media-cache";
import { setSourceAcquisitionDownloadersForTests } from "../lib/source-acquisition";

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
