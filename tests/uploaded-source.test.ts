import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ensureSourceMediaCached, storeUploadedSourceMedia } from "../lib/source-media-cache";
import {
  buildUploadedSourceUrl,
  extractUploadedSourceId,
  getUploadedSourceDisplayName,
  isUploadedSourceUrl
} from "../lib/uploaded-source";

test("uploaded source helpers keep a readable file identity", () => {
  const sourceUrl = buildUploadedSourceUrl("upload-123", "final cut.mp4");
  assert.equal(isUploadedSourceUrl(sourceUrl), true);
  assert.equal(extractUploadedSourceId(sourceUrl), "upload-123");
  assert.equal(getUploadedSourceDisplayName(sourceUrl), "final cut.mp4");
});

test("storeUploadedSourceMedia persists an uploaded mp4 into the shared source cache", async () => {
  const sourceUrl = buildUploadedSourceUrl(`upload-${Date.now()}`, "final-cut.mp4");
  const stored = await storeUploadedSourceMedia({
    sourceUrl,
    fileName: "final-cut.mp4",
    title: "Final Cut",
    sourceStream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("video"));
        controller.close();
      }
    })
  });

  const cached = await ensureSourceMediaCached(sourceUrl);
  const metaPath = path.join(path.dirname(cached.sourcePath), `${cached.sourceKey}.json`);

  try {
    assert.equal(stored.downloadProvider, "upload");
    assert.equal(cached.cacheState, "hit");
    assert.equal(cached.downloadProvider, "upload");
    assert.equal(cached.fileName, "final-cut.mp4");
    assert.equal(cached.title, "Final Cut");
    assert.equal(cached.videoSizeBytes, 5);
    assert.equal(await fs.readFile(cached.sourcePath, "utf-8"), "video");
  } finally {
    await fs.rm(cached.sourcePath, { force: true }).catch(() => undefined);
    await fs.rm(metaPath, { force: true }).catch(() => undefined);
  }
});
