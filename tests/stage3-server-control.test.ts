import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pruneStage3SourceCache } from "../lib/stage3-server-control";

test("pruneStage3SourceCache removes oldest source entries together with metadata", { concurrency: false }, async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clips-stage3-cache-prune-test-"));
  const previousCacheRoot = process.env.CLIPS_STAGE3_CACHE_ROOT;
  process.env.CLIPS_STAGE3_CACHE_ROOT = cacheRoot;

  const sourceDir = path.join(cacheRoot, "sources");
  await fs.mkdir(sourceDir, { recursive: true });

  try {
    for (let index = 0; index < 10; index += 1) {
      const sourceKey = `source-${index}`;
      const videoPath = path.join(sourceDir, `${sourceKey}.mp4`);
      const metaPath = path.join(sourceDir, `${sourceKey}.json`);
      const stamp = new Date(Date.now() - (10 - index) * 1_000);

      await fs.writeFile(videoPath, `video-${index}`);
      await fs.writeFile(metaPath, JSON.stringify({ fileName: `${sourceKey}.mp4` }));
      await fs.utimes(videoPath, stamp, stamp);
      await fs.utimes(metaPath, stamp, stamp);
    }

    await pruneStage3SourceCache(8);

    const remainingEntries = await fs.readdir(sourceDir);
    const videoEntries = remainingEntries.filter((entry) => entry.endsWith(".mp4"));
    const metaEntries = remainingEntries.filter((entry) => entry.endsWith(".json"));

    assert.equal(videoEntries.length, 8);
    assert.equal(metaEntries.length, 8);
    assert.ok(!remainingEntries.includes("source-0.mp4"));
    assert.ok(!remainingEntries.includes("source-0.json"));
    assert.ok(!remainingEntries.includes("source-1.mp4"));
    assert.ok(!remainingEntries.includes("source-1.json"));
    assert.ok(remainingEntries.includes("source-9.mp4"));
    assert.ok(remainingEntries.includes("source-9.json"));
  } finally {
    if (previousCacheRoot === undefined) {
      delete process.env.CLIPS_STAGE3_CACHE_ROOT;
    } else {
      process.env.CLIPS_STAGE3_CACHE_ROOT = previousCacheRoot;
    }
    await fs.rm(cacheRoot, { recursive: true, force: true });
  }
});
