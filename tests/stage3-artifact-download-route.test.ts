import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GET as downloadStage3Artifact } from "../app/api/admin/render-exports/[jobId]/route";
import { createMcpMachineCredential } from "../lib/mcp-machine-credential-store";
import {
  completeStage3Job,
  enqueueStage3Job,
  finishStage3Job
} from "../lib/stage3-job-store";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "stage3-artifact-download-route-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run(appDataDir);
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function callDownload(token: string, jobId: string): Promise<Response> {
  return downloadStage3Artifact(
    new Request(`http://localhost/api/admin/render-exports/${jobId}`, {
      headers: { authorization: `Bearer ${token}` }
    }),
    { params: Promise.resolve({ jobId }) }
  );
}

test("an older completed preview remains downloadable after a newer preview fails", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const owner = await bootstrapOwner({
      workspaceName: "Artifact download",
      email: "artifact@example.com",
      password: "Password123!",
      displayName: "Artifact Owner"
    });
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "artifact-download-agent",
      scopes: ["flow:read"]
    });
    const bytes = Buffer.from("older-completed-preview");
    const artifactPath = path.join(appDataDir, "older-preview.mp4");
    await writeFile(artifactPath, bytes);
    const older = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "preview",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/shorts/older" })
    });
    completeStage3Job(older.id, {
      artifact: {
        fileName: "older-preview.mp4",
        mimeType: "video/mp4",
        filePath: artifactPath,
        sizeBytes: bytes.byteLength
      }
    });
    const newer = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "preview",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/shorts/newer" })
    });
    finishStage3Job(newer.id, {
      status: "failed",
      errorCode: "preview_failed",
      errorMessage: "Newer preview failed.",
      recoverable: true
    });

    const response = await callDownload(machine.secret, older.id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.match(response.headers.get("content-disposition") ?? "", /older-preview\.mp4/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  });
});

test("a completed job with pruned bytes returns immutable_artifact_unavailable, not not-completed", { concurrency: false }, async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const owner = await bootstrapOwner({
      workspaceName: "Artifact unavailable",
      email: "artifact-unavailable@example.com",
      password: "Password123!",
      displayName: "Artifact Owner"
    });
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "artifact-unavailable-agent",
      scopes: ["flow:read"]
    });
    const artifactPath = path.join(appDataDir, "pruned-preview.mp4");
    await writeFile(artifactPath, "preview");
    const completed = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "preview",
      payloadJson: JSON.stringify({ sourceUrl: "https://youtube.com/shorts/pruned" })
    });
    completeStage3Job(completed.id, {
      artifact: {
        fileName: "pruned-preview.mp4",
        mimeType: "video/mp4",
        filePath: artifactPath,
        sizeBytes: 7
      }
    });
    await rm(artifactPath, { force: true });

    const response = await callDownload(machine.secret, completed.id);
    assert.equal(response.status, 410);
    const body = (await response.json()) as {
      code: string;
      status: string;
      artifactId: string | null;
    };
    assert.equal(body.code, "immutable_artifact_unavailable");
    assert.equal(body.status, "completed");
    assert.ok(body.artifactId);
  });
});
