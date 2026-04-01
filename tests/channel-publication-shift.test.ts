import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import {
  buildCustomPublicationCandidateFromLocalDateTime,
  buildPublicationSlotCandidateFromDateAndIndex,
  DEFAULT_CHANNEL_PUBLISH_SETTINGS
} from "../lib/channel-publishing";
import {
  completeRenderExportAndMaybeQueue,
  moveChannelPublicationToSlot,
  updateChannelPublicationFromEditor
} from "../lib/channel-publication-service";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  claimNextReadyChannelPublication,
  createChannelPublication,
  createRenderExport,
  findLatestPublicationForRenderExport,
  listChannelPublications,
  markChannelPublicationScheduled,
  publishNowChannelPublication,
  saveChannelPublishIntegration
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
      scheduleMode: "slot",
      scheduledAt: slot.scheduledAt,
      uploadReadyAt: slot.uploadReadyAt,
      slotDate: slot.slotDate,
      slotIndex: slot.slotIndex,
      title: `Publication ${slotIndex}`,
      description: "",
      tags: [],
      notifySubscribers: true,
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

function connectChannelPublishing(channelId: string): void {
  saveChannelPublishIntegration({
    workspaceId: "w1",
    channelId,
    userId: "u1",
    status: "connected",
    credential: null,
    googleAccountEmail: "u@example.com",
    selectedYoutubeChannelId: "youtube-channel-1",
    selectedYoutubeChannelTitle: "Daily Dopamine",
    selectedYoutubeChannelCustomUrl: "@dailydopamine",
    availableChannels: [
      {
        id: "youtube-channel-1",
        title: "Daily Dopamine",
        customUrl: "@dailydopamine"
      }
    ],
    scopes: ["youtube.upload"]
  });
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

test("updateChannelPublicationFromEditor persists notifySubscribers for queued publications", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([0]);
    const publicationId = scenario.publications[0]!.id;

    const updated = await updateChannelPublicationFromEditor({
      publicationId,
      patch: {
        notifySubscribers: false
      }
    });

    assert.equal(updated.notifySubscribers, false);
    assert.equal(listChannelPublications(scenario.channelId)[0]?.notifySubscribers, false);
  });
});

test("updateChannelPublicationFromEditor blocks notifySubscribers changes after the video is already uploaded", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([0]);
    const publicationId = scenario.publications[0]!.id;

    markChannelPublicationScheduled({
      publicationId,
      youtubeVideoId: "youtube-video-1",
      youtubeVideoUrl: "https://www.youtube.com/watch?v=youtube-video-1"
    });

    await assert.rejects(
      () =>
        updateChannelPublicationFromEditor({
          publicationId,
          patch: {
            notifySubscribers: false
          }
        }),
      /только при первой загрузке видео/i
    );
  });
});

test("updateChannelPublicationFromEditor persists a custom exact publication time", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([0]);
    const publicationId = scenario.publications[0]!.id;
    const customSchedule = buildCustomPublicationCandidateFromLocalDateTime({
      settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
      localDateTime: "2040-05-05T21:07"
    });

    const updated = await updateChannelPublicationFromEditor({
      publicationId,
      patch: {
        scheduleMode: "custom",
        scheduledAtLocal: "2040-05-05T21:07"
      }
    });

    assert.equal(updated.scheduleMode, "custom");
    assert.equal(updated.scheduledAt, customSchedule.scheduledAt);
    assert.equal(updated.uploadReadyAt, customSchedule.uploadReadyAt);
    assert.equal(updated.slotDate, "2040-05-05");
    assert.equal(updated.slotIndex, -1);

    const stored = listChannelPublications(scenario.channelId).find((item) => item.id === publicationId);
    assert.equal(stored?.scheduleMode, "custom");
    assert.equal(stored?.slotIndex, -1);
  });
});

test("stale publication lease cannot overwrite a newer queued state", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([0]);
    connectChannelPublishing(scenario.channelId);
    const publicationId = scenario.publications[0]!.id;
    const readyAt = nowIso();
    getDb()
      .prepare("UPDATE channel_publications SET scheduled_at = ?, upload_ready_at = ?, updated_at = ? WHERE id = ?")
      .run(readyAt, readyAt, readyAt, publicationId);

    const claimed = claimNextReadyChannelPublication({});
    assert.ok(claimed, "expected a queued publication to be claimed");
    assert.equal(claimed?.publication.id, publicationId);

    const publishNow = publishNowChannelPublication(publicationId);
    assert.equal(publishNow.status, "queued");

    const result = markChannelPublicationScheduled({
      publicationId,
      youtubeVideoId: "youtube-video-1",
      youtubeVideoUrl: "https://www.youtube.com/watch?v=youtube-video-1",
      expectedLeaseToken: claimed?.leaseToken
    });

    assert.equal(result.status, "queued");
    assert.equal(result.youtubeVideoId, null);
    assert.equal(result.youtubeVideoUrl, null);
  });
});

test("completeRenderExportAndMaybeQueue recreates a queued publication when render export already exists", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([]);
    connectChannelPublishing(scenario.channelId);
    const workspaceId = "w1";
    const userId = "u1";
    const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=recover123", scenario.channelId);
    const stage3JobId = newId();
    const stamp = nowIso();
    getDb()
      .prepare(
        `INSERT INTO stage3_jobs
          (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        stage3JobId,
        workspaceId,
        userId,
        "render",
        "completed",
        JSON.stringify({ chatId: chat.id, channelId: scenario.channelId }),
        1,
        0,
        stamp,
        stamp
      );
    const renderExport = createRenderExport({
      workspaceId,
      channelId: scenario.channelId,
      chatId: chat.id,
      stage3JobId,
      artifactFileName: "recover.mp4",
      artifactFilePath: "/tmp/recover.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Recovered",
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: userId
    });

    const completion = completeRenderExportAndMaybeQueue({
      workspaceId,
      channelId: scenario.channelId,
      chatId: chat.id,
      chatTitle: "Recovered chat",
      stage3JobId,
      artifactFileName: "recover.mp4",
      artifactFilePath: "/tmp/recover.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Recovered",
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: userId,
      stage2Result: null
    });

    const publication = findLatestPublicationForRenderExport(renderExport.id);
    assert.equal(completion.renderExport.id, renderExport.id);
    assert.ok(completion.publication, "expected queued publication to be recreated");
    assert.equal(completion.publication?.id, publication?.id);
    assert.equal(publication?.status, "queued");
    assert.equal(listChannelPublications(scenario.channelId).length, 1);
  });
});

test("completeRenderExportAndMaybeQueue does not duplicate a scheduled publication for the same render export", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([]);
    connectChannelPublishing(scenario.channelId);
    const workspaceId = "w1";
    const userId = "u1";
    const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=stable123", scenario.channelId);
    const stage3JobId = newId();
    const stamp = nowIso();
    getDb()
      .prepare(
        `INSERT INTO stage3_jobs
          (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        stage3JobId,
        workspaceId,
        userId,
        "render",
        "completed",
        JSON.stringify({ chatId: chat.id, channelId: scenario.channelId }),
        1,
        0,
        stamp,
        stamp
      );

    const first = completeRenderExportAndMaybeQueue({
      workspaceId,
      channelId: scenario.channelId,
      chatId: chat.id,
      chatTitle: "Stable chat",
      stage3JobId,
      artifactFileName: "stable.mp4",
      artifactFilePath: "/tmp/stable.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Stable",
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: userId,
      stage2Result: null
    });
    assert.ok(first.publication, "expected initial publication to exist");

    markChannelPublicationScheduled({
      publicationId: first.publication!.id,
      youtubeVideoId: "youtube-video-stable",
      youtubeVideoUrl: "https://www.youtube.com/watch?v=youtube-video-stable"
    });

    const second = completeRenderExportAndMaybeQueue({
      workspaceId,
      channelId: scenario.channelId,
      chatId: chat.id,
      chatTitle: "Stable chat",
      stage3JobId,
      artifactFileName: "stable.mp4",
      artifactFilePath: "/tmp/stable.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Stable",
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: userId,
      stage2Result: null
    });

    assert.equal(second.renderExport.id, first.renderExport.id);
    assert.equal(second.publication?.id, first.publication?.id);
    assert.equal(second.publication?.status, "scheduled");
    assert.equal(listChannelPublications(scenario.channelId).length, 1);
  });
});

test("completeRenderExportAndMaybeQueue skips queued publication when publishAfterRender is false", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([]);
    connectChannelPublishing(scenario.channelId);
    const workspaceId = "w1";
    const userId = "u1";
    const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=manualoff123", scenario.channelId);
    const stage3JobId = newId();
    const stamp = nowIso();
    getDb()
      .prepare(
        `INSERT INTO stage3_jobs
          (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        stage3JobId,
        workspaceId,
        userId,
        "render",
        "completed",
        JSON.stringify({ chatId: chat.id, channelId: scenario.channelId }),
        1,
        0,
        stamp,
        stamp
      );

    const completion = completeRenderExportAndMaybeQueue({
      workspaceId,
      channelId: scenario.channelId,
      chatId: chat.id,
      chatTitle: "Manual off chat",
      stage3JobId,
      artifactFileName: "manual-off.mp4",
      artifactFilePath: "/tmp/manual-off.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Manual off",
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: userId,
      stage2Result: null,
      publishAfterRender: false
    });

    assert.ok(completion.renderExport.id);
    assert.equal(completion.publication, null);
    assert.equal(listChannelPublications(scenario.channelId).length, 0);
  });
});

test("completeRenderExportAndMaybeQueue keeps render export but skips queued publication when YouTube is not connected", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([]);
    const workspaceId = "w1";
    const userId = "u1";
    const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=offline123", scenario.channelId);
    const stage3JobId = newId();
    const stamp = nowIso();
    getDb()
      .prepare(
        `INSERT INTO stage3_jobs
          (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        stage3JobId,
        workspaceId,
        userId,
        "render",
        "completed",
        JSON.stringify({ chatId: chat.id, channelId: scenario.channelId }),
        1,
        0,
        stamp,
        stamp
      );

    const completion = completeRenderExportAndMaybeQueue({
      workspaceId,
      channelId: scenario.channelId,
      chatId: chat.id,
      chatTitle: "Offline chat",
      stage3JobId,
      artifactFileName: "offline.mp4",
      artifactFilePath: "/tmp/offline.mp4",
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: "Offline",
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: userId,
      stage2Result: null
    });

    assert.ok(completion.renderExport.id);
    assert.equal(completion.publication, null);
    assert.equal(listChannelPublications(scenario.channelId).length, 0);
  });
});

test("moveChannelPublicationToSlot blocks drag-style moves for custom publications", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([0]);
    const publicationId = scenario.publications[0]!.id;

    await updateChannelPublicationFromEditor({
      publicationId,
      patch: {
        scheduleMode: "custom",
        scheduledAtLocal: "2040-05-05T21:07"
      }
    });

    await assert.rejects(
      () =>
        moveChannelPublicationToSlot({
          publicationId,
          slotDate: scenario.slotDate,
          slotIndex: 1
        }),
      /кастомное время/i
    );
  });
});

test("updateChannelPublicationFromEditor rejects an exact time that is already occupied", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedChannelPublicationScenario([0, 1]);
    const secondPublicationId = scenario.publications[1]!.id;

    await assert.rejects(
      () =>
        updateChannelPublicationFromEditor({
          publicationId: secondPublicationId,
          patch: {
            scheduleMode: "custom",
            scheduledAtLocal: "2040-05-05T21:00"
          }
        }),
      /время уже занято/i
    );
  });
});
