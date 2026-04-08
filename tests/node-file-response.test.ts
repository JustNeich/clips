import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __testOnlyParseByteRange, createNodeFileResponse } from "../lib/node-file-response";

async function withTempFile(
  contents: string,
  run: (filePath: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clips-node-file-response-"));
  const filePath = path.join(dir, "sample.txt");
  await writeFile(filePath, contents, "utf8");
  try {
    await run(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("parseByteRange handles explicit, open-ended, and suffix ranges", () => {
  assert.deepEqual(__testOnlyParseByteRange("bytes=5-9", 26), { start: 5, end: 9 });
  assert.deepEqual(__testOnlyParseByteRange("bytes=20-", 26), { start: 20, end: 25 });
  assert.deepEqual(__testOnlyParseByteRange("bytes=-4", 26), { start: 22, end: 25 });
});

test("createNodeFileResponse returns partial content for byte ranges", async () => {
  await withTempFile("abcdefghijklmnopqrstuvwxyz", async (filePath) => {
    const response = await createNodeFileResponse({
      request: new Request("http://localhost/test", {
        headers: {
          range: "bytes=5-9"
        }
      }),
      filePath,
      headers: {
        "Content-Type": "text/plain"
      }
    });

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Accept-Ranges"), "bytes");
    assert.equal(response.headers.get("Content-Range"), "bytes 5-9/26");
    assert.equal(response.headers.get("Content-Length"), "5");
    assert.equal(await response.text(), "fghij");
  });
});

test("createNodeFileResponse returns the whole file when no range is present", async () => {
  await withTempFile("abcdefghijklmnopqrstuvwxyz", async (filePath) => {
    const response = await createNodeFileResponse({
      request: new Request("http://localhost/test"),
      filePath,
      headers: {
        "Content-Type": "text/plain"
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Accept-Ranges"), "bytes");
    assert.equal(response.headers.get("Content-Length"), "26");
    assert.equal(await response.text(), "abcdefghijklmnopqrstuvwxyz");
  });
});

test("createNodeFileResponse rejects invalid byte ranges with 416", async () => {
  await withTempFile("abcdefghijklmnopqrstuvwxyz", async (filePath) => {
    const response = await createNodeFileResponse({
      request: new Request("http://localhost/test", {
        headers: {
          range: "bytes=40-50"
        }
      }),
      filePath,
      headers: {
        "Content-Type": "text/plain"
      }
    });

    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */26");
    assert.equal(await response.text(), "");
  });
});
