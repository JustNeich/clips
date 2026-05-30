import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDb, newId, nowIso } from "../lib/db/client";
import { createChannelPublication, createRenderExport } from "../lib/publication-store";
import { getSourceMediaCacheKey } from "../lib/source-media-cache";
import { cleanupAppStorageForWrite } from "../lib/storage-maintenance";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-storage-maintenance-test-"));
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

function seedWorkspace(): {
  workspaceId: string;
  userId: string;
  channelId: string;
  chatId: string;
} {
  const db = getDb();
  const stamp = nowIso();
  const workspaceId = `workspace-${newId()}`;
  const userId = `user-${newId()}`;
  const channelId = `channel-${newId()}`;
  const chatId = `chat-${newId()}`;

  db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    workspaceId,
    "Storage workspace",
    `storage-${workspaceId}`,
    stamp,
    stamp
  );
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, `${userId}@example.com`, "hash", "User", "active", stamp, stamp);
  db.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newId(), workspaceId, userId, "owner", stamp, stamp);
  db.prepare(
    `INSERT INTO channels
      (id, workspace_id, creator_user_id, name, username, system_prompt, description_prompt, examples_json, template_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    channelId,
    workspaceId,
    userId,
    "Storage Channel",
    "storagechannel",
    "",
    "",
    "[]",
    "template",
    stamp,
    stamp
  );
  db.prepare(
    "INSERT INTO chat_threads (id, workspace_id, channel_id, url, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(chatId, workspaceId, channelId, "https://www.instagram.com/reel/storage-chat/", "Storage chat", stamp, stamp);

  return {
    workspaceId,
    userId,
    channelId,
    chatId
  };
}

async function writeOldFile(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  const old = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  await utimes(filePath, old, old);
}

test("storage cleanup removes old inactive uploaded sources but keeps recent chat sources", async () => {
  await withIsolatedAppData(async () => {
    const { workspaceId, userId, channelId } = seedWorkspace();
    const db = getDb();
    const activeUrl = "upload://active-source.mp4";
    const oldUrl = "upload://inactive-source.mp4";
    const activeKey = getSourceMediaCacheKey(activeUrl);
    const oldKey = getSourceMediaCacheKey(oldUrl);
    const cacheDir = path.join(process.env.APP_DATA_DIR!, "source-media-cache", "sources");

    const activePath = path.join(cacheDir, `${activeKey}.mp4`);
    const oldPath = path.join(cacheDir, `${oldKey}.mp4`);
    await writeOldFile(activePath, "active-video");
    await writeOldFile(oldPath, "old-video");
    await writeFile(path.join(cacheDir, `${activeKey}.json`), JSON.stringify({ sticky: true, downloadProvider: "upload" }));
    await writeFile(path.join(cacheDir, `${oldKey}.json`), JSON.stringify({ sticky: true, downloadProvider: "upload" }));

    const stamp = nowIso();
    db.prepare(
      "INSERT INTO chat_threads (id, workspace_id, channel_id, url, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(`chat-${newId()}`, workspaceId, channelId, activeUrl, "Active upload", stamp, stamp);
    db.prepare(
      `INSERT INTO stage3_jobs
        (id, workspace_id, user_id, kind, status, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, 'render', 'queued', ?, ?, ?)`
    ).run(`job-${newId()}`, workspaceId, userId, JSON.stringify({ sourceUrl: activeUrl }), stamp, stamp);

    const result = await cleanupAppStorageForWrite({
      reason: "test-upload-cleanup",
      incomingBytes: 1024,
      mode: "emergency"
    });

    assert.equal(existsSync(activePath), true, "active uploaded source must be kept");
    assert.equal(existsSync(oldPath), false, "inactive old uploaded source must be deleted");
    assert.equal(existsSync(path.join(cacheDir, `${oldKey}.json`)), false, "deleted upload meta must be removed too");
    assert.ok(result.removedFiles.some((file) => file.path === oldPath));
  });
});

test("storage cleanup removes old inactive render exports but keeps queued publication artifacts", async () => {
  await withIsolatedAppData(async () => {
    const { workspaceId, userId, channelId, chatId } = seedWorkspace();
    const db = getDb();
    const stamp = nowIso();
    const renderExportDir = path.join(process.env.APP_DATA_DIR!, "render-exports");
    const activePath = path.join(renderExportDir, "active.mp4");
    const inactivePath = path.join(renderExportDir, "inactive.mp4");
    await writeOldFile(activePath, "active-render");
    await writeOldFile(inactivePath, "inactive-render");

    const activeJobId = `job-${newId()}`;
    const inactiveJobId = `job-${newId()}`;
    for (const jobId of [activeJobId, inactiveJobId]) {
      db.prepare(
        `INSERT INTO stage3_jobs
          (id, workspace_id, user_id, kind, status, payload_json, created_at, updated_at, completed_at)
          VALUES (?, ?, ?, 'render', 'completed', ?, ?, ?, ?)`
      ).run(jobId, workspaceId, userId, JSON.stringify({ chatId, channelId }), stamp, stamp, stamp);
    }

    const activeExport = createRenderExport({
      workspaceId,
      channelId,
      chatId,
      stage3JobId: activeJobId,
      artifactFileName: "active.mp4",
      artifactFilePath: activePath,
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 13,
      renderTitle: "Active",
      sourceUrl: "https://www.instagram.com/reel/active-render/",
      snapshotJson: "{}",
      createdByUserId: userId
    });
    createRenderExport({
      workspaceId,
      channelId,
      chatId,
      stage3JobId: inactiveJobId,
      artifactFileName: "inactive.mp4",
      artifactFilePath: inactivePath,
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 15,
      renderTitle: "Inactive",
      sourceUrl: "https://www.instagram.com/reel/inactive-render/",
      snapshotJson: "{}",
      createdByUserId: userId
    });
    createChannelPublication({
      workspaceId,
      channelId,
      chatId,
      renderExportId: activeExport.id,
      scheduleMode: "slot",
      scheduledAt: stamp,
      uploadReadyAt: stamp,
      slotDate: "2026-05-30",
      slotIndex: 0,
      title: "Active",
      description: "",
      tags: [],
      notifySubscribers: false,
      needsReview: false,
      createdByUserId: userId
    });

    const result = await cleanupAppStorageForWrite({
      reason: "test-render-export-cleanup",
      incomingBytes: 1024,
      mode: "emergency"
    });

    assert.equal(existsSync(activePath), true, "queued publication render export must be kept");
    assert.equal(existsSync(inactivePath), false, "inactive old render export must be deleted");
    assert.ok(result.removedFiles.some((file) => file.path === inactivePath));
  });
});
