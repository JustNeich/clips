import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureSourceMediaCached } from "../lib/source-media-cache";
import { setSourceAcquisitionDownloadersForTests } from "../lib/source-acquisition";

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
