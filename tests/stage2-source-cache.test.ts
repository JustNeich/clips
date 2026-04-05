import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setSourceAcquisitionDownloadersForTests } from "../lib/source-acquisition";
import { downloadVideoAndMetadata } from "../lib/stage2-runner";

test("downloadVideoAndMetadata reuses the durable source cache across repeated Stage 2 attempts", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-source-cache-test-"));
  const firstTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-source-cache-first-"));
  const secondTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-source-cache-second-"));
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
        fileName: "stage2-source",
        title: "Stage 2 Source",
        durationSec: 13,
        videoSizeBytes: 5
      };
    }
  });

  process.env.APP_DATA_DIR = appDataDir;

  try {
    const fetchOptionalInfo = async () => ({
      infoJson: {
        title: "Stage 2 Source",
        description: "desc",
        transcript: "transcript",
        comments: []
      },
      commentsExtractionFallbackUsed: false,
      commentsAcquisition: {
        status: "unavailable" as const,
        provider: null,
        note: "no comments",
        error: "comments unavailable"
      }
    });
    const url = "https://www.instagram.com/reel/stage2-cache-hit-test/";

    const first = await downloadVideoAndMetadata(url, firstTmpDir, { fetchOptionalInfo });
    const second = await downloadVideoAndMetadata(url, secondTmpDir, { fetchOptionalInfo });

    assert.equal(first.sourceCacheState, "miss");
    assert.equal(second.sourceCacheState, "hit");
    assert.equal(downloadCalls, 1);
    assert.equal(first.sourceCacheKey, second.sourceCacheKey);
    assert.equal(first.videoPath, second.videoPath);
    assert.equal(first.downloadProvider, "ytDlp");
    assert.equal(second.videoFileName, "stage2-source.mp4");
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await fs.rm(appDataDir, { recursive: true, force: true });
    await fs.rm(firstTmpDir, { recursive: true, force: true });
    await fs.rm(secondTmpDir, { recursive: true, force: true });
  }
});
