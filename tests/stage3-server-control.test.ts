import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { setSourceAcquisitionDownloadersForTests } from "../lib/source-acquisition";
import {
  ensureStage3SourceCached,
  pruneStage3SourceCache,
  runHostedStage3HeavyJob,
  shouldUseSourceMediaDirectForHostedFastRender
} from "../lib/stage3-server-control";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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

test("hosted fast render can bypass full Stage 3 source normalization only when requested", () => {
  withEnv(
    {
      RENDER: "true",
      STAGE3_HOSTED_FAST_RENDER_PROFILE: undefined
    },
    () => {
      assert.equal(shouldUseSourceMediaDirectForHostedFastRender({ allowSourceMediaDirect: true }), true);
      assert.equal(shouldUseSourceMediaDirectForHostedFastRender({ allowSourceMediaDirect: false }), false);
      assert.equal(shouldUseSourceMediaDirectForHostedFastRender(), false);
    }
  );
  withEnv(
    {
      RENDER: undefined,
      STAGE3_HOSTED_FAST_RENDER_PROFILE: undefined
    },
    () => {
      assert.equal(shouldUseSourceMediaDirectForHostedFastRender({ allowSourceMediaDirect: true }), false);
    }
  );
  withEnv(
    {
      RENDER: "true",
      STAGE3_HOSTED_FAST_RENDER_PROFILE: "0"
    },
    () => {
      assert.equal(shouldUseSourceMediaDirectForHostedFastRender({ allowSourceMediaDirect: true }), false);
    }
  );
});

test("hosted fast direct source persists temp worker downloads before tmp cleanup", { concurrency: false }, async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-direct-source-cache-"));
  const previousCacheRoot = process.env.CLIPS_STAGE3_CACHE_ROOT;
  const previousRender = process.env.RENDER;
  const previousFastProfile = process.env.STAGE3_HOSTED_FAST_RENDER_PROFILE;
  const previousWorkerOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN;
  const previousWorkerToken = process.env.STAGE3_WORKER_SESSION_TOKEN;
  const originalFetch = globalThis.fetch;
  const url = "https://www.instagram.com/reel/stage3-direct-source/";

  process.env.CLIPS_STAGE3_CACHE_ROOT = cacheRoot;
  process.env.RENDER = "true";
  delete process.env.STAGE3_HOSTED_FAST_RENDER_PROFILE;
  process.env.STAGE3_WORKER_SERVER_ORIGIN = "https://clips.example.com";
  process.env.STAGE3_WORKER_SESSION_TOKEN = "worker-session";

  globalThis.fetch = (async () => Response.json({ error: "Source media cache is cold." }, { status: 404 })) as typeof fetch;

  setSourceAcquisitionDownloadersForTests({
    ytDlp: async (_rawUrl, tmpDir) => {
      const filePath = path.join(tmpDir, "source.mp4");
      await fs.writeFile(filePath, "temporary-worker-source");
      return {
        provider: "ytDlp",
        filePath,
        fileName: "worker-temp-source",
        title: "Worker temp source",
        durationSec: 9,
        videoSizeBytes: 23
      };
    }
  });

  try {
    const cached = await ensureStage3SourceCached(url, { allowSourceMediaDirect: true });

    assert.equal(cached.cacheMode, "source-media-direct");
    assert.equal(path.dirname(cached.sourcePath), path.join(cacheRoot, "sources"));
    assert.equal(path.basename(cached.sourcePath).endsWith(".direct.mp4"), true);
    assert.equal(await fs.readFile(cached.sourcePath, "utf-8"), "temporary-worker-source");
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    globalThis.fetch = originalFetch;
    if (previousCacheRoot === undefined) {
      delete process.env.CLIPS_STAGE3_CACHE_ROOT;
    } else {
      process.env.CLIPS_STAGE3_CACHE_ROOT = previousCacheRoot;
    }
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }
    if (previousFastProfile === undefined) {
      delete process.env.STAGE3_HOSTED_FAST_RENDER_PROFILE;
    } else {
      process.env.STAGE3_HOSTED_FAST_RENDER_PROFILE = previousFastProfile;
    }
    if (previousWorkerOrigin === undefined) {
      delete process.env.STAGE3_WORKER_SERVER_ORIGIN;
    } else {
      process.env.STAGE3_WORKER_SERVER_ORIGIN = previousWorkerOrigin;
    }
    if (previousWorkerToken === undefined) {
      delete process.env.STAGE3_WORKER_SESSION_TOKEN;
    } else {
      process.env.STAGE3_WORKER_SESSION_TOKEN = previousWorkerToken;
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
