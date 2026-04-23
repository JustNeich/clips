import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pruneStage3SourceCache, runHostedStage3HeavyJob } from "../lib/stage3-server-control";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

test("runHostedStage3HeavyJob honors configured hosted concurrency", { concurrency: false }, async () => {
  const previousRender = process.env.RENDER;
  const previousLimit = process.env.STAGE3_HOSTED_HEAVY_JOB_MAX_CONCURRENT;
  const previousCpuLimit = process.env.HOSTED_CPU_CONCURRENCY_LIMIT;
  process.env.RENDER = "1";
  process.env.STAGE3_HOSTED_HEAVY_JOB_MAX_CONCURRENT = "2";
  process.env.HOSTED_CPU_CONCURRENCY_LIMIT = "2";

  try {
    let active = 0;
    let maxActive = 0;

    const results = await Promise.all(
      ["job-1", "job-2", "job-3"].map((jobId) =>
        runHostedStage3HeavyJob(
          async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            try {
              await delay(40);
              return jobId;
            } finally {
              active = Math.max(0, active - 1);
            }
          },
          { waitTimeoutMs: 500 }
        )
      )
    );

    assert.equal(maxActive, 2);
    assert.deepEqual(results, ["job-1", "job-2", "job-3"]);
  } finally {
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }
    if (previousLimit === undefined) {
      delete process.env.STAGE3_HOSTED_HEAVY_JOB_MAX_CONCURRENT;
    } else {
      process.env.STAGE3_HOSTED_HEAVY_JOB_MAX_CONCURRENT = previousLimit;
    }
    if (previousCpuLimit === undefined) {
      delete process.env.HOSTED_CPU_CONCURRENCY_LIMIT;
    } else {
      process.env.HOSTED_CPU_CONCURRENCY_LIMIT = previousCpuLimit;
    }
  }
});

test("runHostedStage3HeavyJob clamps hosted concurrency to CPU budget", { concurrency: false }, async () => {
  const previousRender = process.env.RENDER;
  const previousLimit = process.env.STAGE3_HOSTED_HEAVY_JOB_MAX_CONCURRENT;
  const previousCpuLimit = process.env.HOSTED_CPU_CONCURRENCY_LIMIT;
  process.env.RENDER = "1";
  process.env.STAGE3_HOSTED_HEAVY_JOB_MAX_CONCURRENT = "4";
  process.env.HOSTED_CPU_CONCURRENCY_LIMIT = "1";

  try {
    let active = 0;
    let maxActive = 0;

    const results = await Promise.all(
      ["job-1", "job-2", "job-3"].map((jobId) =>
        runHostedStage3HeavyJob(
          async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            try {
              await delay(20);
              return jobId;
            } finally {
              active = Math.max(0, active - 1);
            }
          },
          { waitTimeoutMs: 500 }
        )
      )
    );

    assert.equal(maxActive, 1);
    assert.deepEqual(results, ["job-1", "job-2", "job-3"]);
  } finally {
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }
    if (previousLimit === undefined) {
      delete process.env.STAGE3_HOSTED_HEAVY_JOB_MAX_CONCURRENT;
    } else {
      process.env.STAGE3_HOSTED_HEAVY_JOB_MAX_CONCURRENT = previousLimit;
    }
    if (previousCpuLimit === undefined) {
      delete process.env.HOSTED_CPU_CONCURRENCY_LIMIT;
    } else {
      process.env.HOSTED_CPU_CONCURRENCY_LIMIT = previousCpuLimit;
    }
  }
});
