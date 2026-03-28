import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import {
  buildPublicationSlotCandidateFromDateAndIndex,
  DEFAULT_CHANNEL_PUBLISH_SETTINGS
} from "../lib/channel-publishing";
import { moveChannelPublicationToSlot } from "../lib/channel-publication-service";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  createChannelPublication,
  createRenderExport,
  listChannelPublications
} from "../lib/publication-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-publication-shift-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsChannelPublicationRuntimeState__?: unknown })
    .__clipsChannelPublicationRuntimeState__;

  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    delete (globalThis as { __clipsChannelPublicationRuntimeState__?: unknown })
      .__clipsChannelPublicationRuntimeState__;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

async function seedChannelPublicationScenario(slotIndexes: number[]): Promise<{
  channelId: string;
  publications: Array<{ id: string; slotIndex: number }>;
  slotDate: string;
}> {
  const db = getDb();
  const stamp = nowIso();
  const workspaceId = "w1";
  const userId = "u1";
  const slotDate = "2040-05-05";

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

  const publications = [];
  for (const slotIndex of slotIndexes) {
    const chat = await createOrGetChatByUrl(
      `https://youtube.com/watch?v=${slotIndex}${slotIndex}${slotIndex}`,
      channel.id
    );
    const stage3JobId = newId();
    db.prepare(
      `INSERT INTO stage3_jobs
        (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL)`
    ).run(
      stage3JobId,
      workspaceId,
      userId,
      "render",
      "completed",
      JSON.stringify({ chatId: chat.id, channelId: channel.id }),
      1,
      0,
      stamp,
      stamp
    );
    const renderExport = createRenderExport({
      workspaceId,
      channelId: channel.id,
      chatId: chat.id,
      stage3JobId,
      artifactFileName: `slot-${slotIndex}.mp4`,
      artifactFilePath: `/tmp/slot-${slotIndex}.mp4`,
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: `Render ${slotIndex}`,
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: userId
    });
    const slot = buildPublicationSlotCandidateFromDateAndIndex({
      settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
      slotDate,
      slotIndex
    });
    const publication = createChannelPublication({
      workspaceId,
      channelId: channel.id,
      chatId: chat.id,
      renderExportId: renderExport.id,
      scheduledAt: slot.scheduledAt,
      uploadReadyAt: slot.uploadReadyAt,
      slotDate: slot.slotDate,
      slotIndex: slot.slotIndex,
      title: `Publication ${slotIndex}`,
      description: "",
      tags: [],
      needsReview: false,
      createdByUserId: userId
    });
    publications.push({
      id: publication.id,
      slotIndex: publication.slotIndex
    });
  }

  return {
    channelId: channel.id,
    publications,
    slotDate
  };
}

test("moveChannelPublicationToSlot moves a publication into an empty slot within the same day", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([0, 1]);
    const firstPublicationId = scenario.publications[0]!.id;

    const result = await moveChannelPublicationToSlot({
      publicationId: firstPublicationId,
      slotDate: scenario.slotDate,
      slotIndex: 2
    });

    assert.equal(result.mode, "moved");
    assert.equal(result.swappedPublication, null);
    assert.equal(result.publication.slotDate, scenario.slotDate);
    assert.equal(result.publication.slotIndex, 2);

    const publications = listChannelPublications(scenario.channelId);
    assert.equal(publications.length, 2);
    assert.equal(publications.find((item) => item.id === firstPublicationId)?.slotIndex, 2);
    assert.equal(
      publications.find((item) => item.id === scenario.publications[1]!.id)?.slotIndex,
      1
    );
  });
});

test("moveChannelPublicationToSlot swaps publications when the target slot is occupied", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([0, 1]);
    const firstPublicationId = scenario.publications[0]!.id;
    const secondPublicationId = scenario.publications[1]!.id;

    const result = await moveChannelPublicationToSlot({
      publicationId: firstPublicationId,
      slotDate: scenario.slotDate,
      slotIndex: 1
    });

    assert.equal(result.mode, "swapped");
    assert.ok(result.swappedPublication);
    assert.equal(result.publication.slotIndex, 1);
    assert.equal(result.swappedPublication?.slotIndex, 0);

    const publications = listChannelPublications(scenario.channelId);
    assert.equal(publications.find((item) => item.id === firstPublicationId)?.slotIndex, 1);
    assert.equal(publications.find((item) => item.id === secondPublicationId)?.slotIndex, 0);
  });
});
