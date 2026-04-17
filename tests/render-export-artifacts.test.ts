import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  createRenderExport,
  ensureRenderExportArtifactAvailable,
  getRenderExportById
} from "../lib/publication-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-render-export-artifacts-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    return await run();
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

test("ensureRenderExportArtifactAvailable recovers a legacy render export from the stage3 job artifact", async () => {
  await withIsolatedAppData(async () => {
    const db = getDb();
    const stamp = nowIso();
    const workspaceId = "w1";
    const userId = "u1";

    db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      workspaceId,
      "Test workspace",
      "test-workspace",
      stamp,
      stamp
    );
    db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(userId, "u@example.com", "hash", "User", "active", stamp, stamp);
    db.prepare(
      "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(newId(), workspaceId, userId, "owner", stamp, stamp);

    const channel = await createChannel({
      workspaceId,
      creatorUserId: userId,
      name: "Daily Dopamine",
      username: "dailydopamine"
    });
    const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=legacy-recover", channel.id);

    const stage3JobId = newId();
    db.prepare(
      `INSERT INTO stage3_jobs
        (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`
    ).run(
      stage3JobId,
      workspaceId,
      userId,
      "render",
      "completed",
      JSON.stringify({ chatId: chat.id, channelId: channel.id }),
      1,
      1,
      stamp,
      stamp,
      stamp,
      stamp
    );

    const artifactDir = path.join(process.env.APP_DATA_DIR!, "stage3-job-artifacts", "render");
    await mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, `${stage3JobId}.mp4`);
    await writeFile(artifactPath, "legacy-render-bytes");
    db.prepare(
      `INSERT INTO stage3_job_artifacts
        (id, job_id, kind, file_name, mime_type, file_path, size_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newId(), stage3JobId, "video", "legacy.mp4", "video/mp4", artifactPath, 19, stamp);

    const renderExport = createRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: chat.id,
      stage3JobId,
      artifactFileName: "legacy.mp4",
      artifactFilePath: "/tmp/missing-legacy.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 19,
      renderTitle: "Legacy",
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: userId
    });

    const recovered = await ensureRenderExportArtifactAvailable(renderExport.id);

    assert.ok(recovered, "expected a recovered render export");
    assert.match(recovered?.artifactFilePath ?? "", /render-exports/);
    assert.equal(await readFile(recovered?.artifactFilePath ?? "", "utf-8"), "legacy-render-bytes");

    const stored = getRenderExportById(renderExport.id);
    assert.equal(stored?.artifactFilePath, recovered?.artifactFilePath);
    assert.equal(stored?.artifactSizeBytes, 19);
  });
});
