import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publishStage3VideoArtifact } from "../lib/stage3-job-artifacts";

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-artifacts-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;

  try {
    return await run(appDataDir);
  } finally {
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("publishStage3VideoArtifact prunes stale artifacts before writing and retries once after ENOSPC", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const artifactDir = path.join(appDataDir, "stage3-job-artifacts", "editing-proxy");
    await mkdir(artifactDir, { recursive: true });

    const sourcePath = path.join(appDataDir, "source.mp4");
    const expiredArtifact = path.join(artifactDir, "old-job.mp4");
    const stalePart = path.join(artifactDir, "old-job.part-1.mp4");
    const previousFinal = path.join(artifactDir, "job-1.mp4");
    await writeFile(sourcePath, "new-video");
    await writeFile(expiredArtifact, "expired-video");
    await writeFile(stalePart, "stale-temp");
    await writeFile(previousFinal, "previous-video");

    const oldDate = new Date(Date.now() - 4 * 60 * 60_000);
    await utimes(expiredArtifact, oldDate, oldDate);
    await utimes(stalePart, oldDate, oldDate);

    const originalCopyFile = fs.copyFile;
    let attempts = 0;
    fs.copyFile = async (source, destination, mode) => {
      attempts += 1;
      if (attempts === 1) {
        assert.equal(existsSync(expiredArtifact), false, "expired artifacts must be pruned before copy");
        assert.equal(existsSync(stalePart), false, "stale temp artifacts must be pruned before copy");
        assert.equal(existsSync(previousFinal), false, "same-job final artifact must be removed before copy");
        const error = new Error("ENOSPC: no space left on device, copyfile") as NodeJS.ErrnoException;
        error.code = "ENOSPC";
        throw error;
      }
      return originalCopyFile(source, destination, mode);
    };

    try {
      const published = await publishStage3VideoArtifact("editing-proxy", "job-1", sourcePath);
      assert.equal(attempts, 2);
      assert.equal(await readFile(published.filePath, "utf-8"), "new-video");
      assert.equal(published.sizeBytes, 9);

      const files = await readdir(artifactDir);
      assert.deepEqual(files, ["job-1.mp4"]);
    } finally {
      fs.copyFile = originalCopyFile;
    }
  });
});
