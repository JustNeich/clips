import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ensureSourceMediaCached,
  storeUploadedCompositeSourceMedia,
  storeUploadedSourceMedia
} from "../lib/source-media-cache";
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

test("storeUploadedCompositeSourceMedia combines multipart-uploaded parts into one composite source", async () => {
  const compositeSourceUrl = buildUploadedSourceUrl(`upload-${Date.now()}-composite`, "combo-cut.mp4");
  let probeCallIndex = 0;
  const normalizeCalls: Array<{
    sourcePath: string;
    outputPath: string;
    targetWidth: number;
    targetHeight: number;
    includeAudio: boolean;
    sourceHasAudio: boolean;
  }> = [];

  const composite = await storeUploadedCompositeSourceMedia({
    sourceUrl: compositeSourceUrl,
    fileName: "combo-cut.mp4",
    title: "Combo Cut",
    parts: [
      {
        fileName: "first.mp4",
        bytes: new TextEncoder().encode("one")
      },
      {
        fileName: "second.mp4",
        bytes: new TextEncoder().encode("two")
      }
    ],
    probeMediaInfo: async () => ({
      width: 720,
      height: 1280,
      hasAudio: probeCallIndex++ === 1
    }),
    normalizePartMedia: async (input) => {
      normalizeCalls.push(input);
      await fs.writeFile(input.outputPath, path.basename(input.sourcePath));
    },
    concatMedia: async ({ sourcePaths, outputPath, hasAudio }) => {
      assert.equal(hasAudio, true);
      assert.equal(sourcePaths.length, 2);
      assert.match(sourcePaths[0] ?? "", /normalized-01\.mp4$/);
      assert.match(sourcePaths[1] ?? "", /normalized-02\.mp4$/);
      await fs.writeFile(outputPath, "combo");
    }
  });

  const cached = await ensureSourceMediaCached(compositeSourceUrl);
  const metaPath = path.join(path.dirname(cached.sourcePath), `${cached.sourceKey}.json`);

  try {
    assert.equal(composite.downloadProvider, "upload");
    assert.equal(cached.cacheState, "hit");
    assert.equal(cached.fileName, "combo-cut.mp4");
    assert.equal(cached.title, "Combo Cut");
    assert.equal(normalizeCalls.length, 2);
    assert.equal(normalizeCalls[0]?.targetWidth, 720);
    assert.equal(normalizeCalls[0]?.targetHeight, 1280);
    assert.equal(normalizeCalls[0]?.includeAudio, true);
    assert.equal(normalizeCalls[0]?.sourceHasAudio, false);
    assert.equal(normalizeCalls[1]?.sourceHasAudio, true);
    assert.equal(await fs.readFile(cached.sourcePath, "utf-8"), "combo");
  } finally {
    await fs.rm(cached.sourcePath, { force: true }).catch(() => undefined);
    await fs.rm(metaPath, { force: true }).catch(() => undefined);
  }
});
