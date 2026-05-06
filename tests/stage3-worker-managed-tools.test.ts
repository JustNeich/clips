import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureManagedStage3WorkerTools } from "../lib/stage3-worker-managed-tools";

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildFetch(manifest: unknown, files: Record<string, Buffer>) {
  return async (url: string) => {
    if (url.endsWith("/stage3-worker/tool-manifest.json")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return manifest;
        },
        async arrayBuffer() {
          return Buffer.from(JSON.stringify(manifest)).buffer;
        }
      };
    }
    const bytes = files[url];
    return {
      ok: Boolean(bytes),
      status: bytes ? 200 : 404,
      async json() {
        return {};
      },
      async arrayBuffer() {
        return bytes?.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) ?? new ArrayBuffer(0);
      }
    };
  };
}

test("managed worker tools install pinned file downloads", async () => {
  const toolsRoot = await mkdtemp(path.join(os.tmpdir(), "stage3-managed-tools-"));
  try {
    const bytes = Buffer.from("fake-yt-dlp");
    const url = "https://tools.example/yt-dlp";
    const results = await ensureManagedStage3WorkerTools({
      serverOrigin: "https://clips.example",
      toolsRoot,
      platform: "darwin-arm64",
      fetchImpl: buildFetch(
        {
          version: 1,
          platforms: {
            "darwin-arm64": {
              "yt-dlp": {
                url,
                sha256: hash(bytes),
                type: "file"
              }
            }
          }
        },
        { [url]: bytes }
      )
    });

    const ytDlp = results.find((result) => result.tool === "yt-dlp");
    assert.equal(ytDlp?.status, "installed");
    assert.equal(await readFile(ytDlp?.path ?? "", "utf-8"), "fake-yt-dlp");
  } finally {
    await rm(toolsRoot, { recursive: true, force: true });
  }
});

test("managed worker tools refuse downloads with mismatched sha256", async () => {
  const toolsRoot = await mkdtemp(path.join(os.tmpdir(), "stage3-managed-tools-hash-"));
  try {
    const url = "https://tools.example/yt-dlp";
    await assert.rejects(
      () =>
        ensureManagedStage3WorkerTools({
          serverOrigin: "https://clips.example",
          toolsRoot,
          platform: "darwin-arm64",
          fetchImpl: buildFetch(
            {
              version: 1,
              platforms: {
                "darwin-arm64": {
                  "yt-dlp": {
                    url,
                    sha256: "0".repeat(64),
                    type: "file"
                  }
                }
              }
            },
            { [url]: Buffer.from("tampered") }
          )
        }),
      /sha256 verification/i
    );
  } finally {
    await rm(toolsRoot, { recursive: true, force: true });
  }
});
