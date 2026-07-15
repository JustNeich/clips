import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { downloadStage3ArtifactToTemp } from "../scripts/clips-owner-mcp";

async function makeArtifactDir(t: TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clips-owner-artifact-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function listFilesIfPresent(dir: string): Promise<string[]> {
  return fs.readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
}

test("downloads a Stage 3 artifact atomically and sanitizes the server filename", async (t) => {
  const artifactDir = await makeArtifactDir(t);
  const bytes = Buffer.from("completed-preview-mp4");
  let requestedUrl = "";
  let authorization = "";

  const result = await downloadStage3ArtifactToTemp("job/../preview-1", {
    appUrl: "https://clips.example/",
    artifactDir,
    token: "test-machine-secret",
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(bytes, {
        headers: {
          "Content-Disposition": 'attachment; filename="../../unsafe-preview.mp4"',
          "Content-Length": String(bytes.byteLength),
          "Content-Type": "video/mp4"
        }
      });
    }
  });

  assert.equal(
    requestedUrl,
    "https://clips.example/api/admin/render-exports/job%2F..%2Fpreview-1"
  );
  assert.equal(authorization, "Bearer test-machine-secret");
  assert.equal(path.dirname(result.localPath), path.resolve(artifactDir));
  assert.equal(path.basename(result.localPath), result.fileName);
  assert.match(result.fileName, /^[a-f0-9]{12}-[a-f0-9]{12}-unsafe-preview\.mp4$/);
  assert.equal(result.sizeBytes, bytes.byteLength);
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.mimeType, "video/mp4");
  assert.deepEqual(await fs.readFile(result.localPath), bytes);
  assert.equal(JSON.stringify(result).includes("test-machine-secret"), false);
  assert.equal((await listFilesIfPresent(artifactDir)).some((name) => name.endsWith(".part")), false);
});

test("reports an HTTP error without creating a partial artifact", async (t) => {
  const artifactDir = await makeArtifactDir(t);

  await assert.rejects(
    downloadStage3ArtifactToTemp("not-ready", {
      appUrl: "https://clips.example",
      artifactDir,
      token: "secret-not-in-error",
      fetchImpl: async () =>
        Response.json({ error: "Render job has not completed yet." }, { status: 409 })
    }),
    (error: Error) => {
      assert.match(error.message, /HTTP 409: Render job has not completed yet\./);
      assert.equal(error.message.includes("secret-not-in-error"), false);
      return true;
    }
  );

  assert.deepEqual(await listFilesIfPresent(artifactDir), []);
});

test("enforces the streaming size limit and removes the .part file", async (t) => {
  const artifactDir = await makeArtifactDir(t);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("1234"));
      controller.enqueue(Buffer.from("5678"));
      controller.close();
    }
  });

  await assert.rejects(
    downloadStage3ArtifactToTemp("too-large", {
      appUrl: "https://clips.example",
      artifactDir,
      maxBytes: 6,
      token: "test-machine-secret",
      fetchImpl: async () =>
        new Response(body, {
          headers: {
            "Content-Disposition": 'attachment; filename="large.mp4"',
            "Content-Type": "video/mp4"
          }
        })
    }),
    /exceeds the 6-byte download limit/
  );

  assert.deepEqual(await listFilesIfPresent(artifactDir), []);
});
