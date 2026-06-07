import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GET as getSourceMedia, HEAD as headSourceMedia } from "../app/api/source-media/route";
import { APP_SESSION_COOKIE } from "../lib/auth/cookies";
import { ensureSourceMediaCached } from "../lib/source-media-cache";
import { setSourceAcquisitionDownloadersForTests } from "../lib/source-acquisition";
import { bootstrapOwner } from "../lib/team-store";
import { createOrGetChatBySource } from "../lib/chat-history";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-media-route-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousManagedTemplatesRoot = process.env.MANAGED_TEMPLATES_ROOT;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.MANAGED_TEMPLATES_ROOT = path.join(appDataDir, "managed-templates");
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    return await run();
  } finally {
    setSourceAcquisitionDownloadersForTests(null);
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousManagedTemplatesRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_ROOT = previousManagedTemplatesRoot;
    }
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
}

async function createAuthCookie(): Promise<string> {
  const owner = await bootstrapOwner({
    workspaceName: "Source Media Route",
    email: "source-media@example.com",
    password: "password-123",
    displayName: "Source Media Owner"
  });
  return `${APP_SESSION_COOKIE}=${owner.sessionToken}`;
}

test("source media cache-only HEAD serves cached non-uploaded video without download", async () => {
  await withIsolatedAppData(async () => {
    const sourceUrl = "https://www.youtube.com/watch?v=cacheOnly123";
    const cookie = await createAuthCookie();
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

    await ensureSourceMediaCached(sourceUrl);
    await createOrGetChatBySource({
      rawUrl: sourceUrl,
      title: "Cached source"
    });
    setSourceAcquisitionDownloadersForTests({
      ytDlp: async () => {
        throw new Error("cache-only source media route must not download");
      }
    });

    const response = await headSourceMedia(
      new Request(
        `http://localhost/api/source-media?sourceUrl=${encodeURIComponent(sourceUrl)}&cacheOnly=1`,
        {
          method: "HEAD",
          headers: { cookie }
        }
      )
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(response.headers.get("content-length"), "5");
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(downloadCalls, 1);
  });
});

test("source media cache-only GET misses without triggering a source download", async () => {
  await withIsolatedAppData(async () => {
    const sourceUrl = "https://www.instagram.com/reel/not-cached-yet/";
    const cookie = await createAuthCookie();
    let downloadCalls = 0;

    setSourceAcquisitionDownloadersForTests({
      ytDlp: async () => {
        downloadCalls += 1;
        throw new Error("cache-only source media route must not download");
      }
    });

    await createOrGetChatBySource({
      rawUrl: sourceUrl,
      title: "Missing cached source"
    });

    const response = await getSourceMedia(
      new Request(
        `http://localhost/api/source-media?sourceUrl=${encodeURIComponent(sourceUrl)}&cacheOnly=1`,
        {
          headers: { cookie }
        }
      )
    );

    assert.equal(response.status, 404);
    assert.equal(downloadCalls, 0);
  });
});
