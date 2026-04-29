import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PATCH as patchPublicationRoute } from "../app/api/publications/[id]/route";
import { POST as shiftPublicationRoute } from "../app/api/publications/[id]/shift/route";
import { APP_SESSION_COOKIE } from "../lib/auth/cookies";
import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import {
  buildCustomPublicationCandidateFromLocalDateTime,
  buildPublicationSlotCandidateFromDateAndIndex,
  DEFAULT_CHANNEL_PUBLISH_SETTINGS
} from "../lib/channel-publishing";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  createChannelPublication,
  createRenderExport,
  markChannelPublicationScheduled
} from "../lib/publication-store";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-publication-api-route-test-"));
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

async function seedPublicationRouteScenario() {
  const owner = await bootstrapOwner({
    workspaceName: "Publication Route Workspace",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });

  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "Publishing Channel",
    username: "publishing_channel"
  });

  const createPublication = async (suffix: string, slotDate: string, slotIndex: number) => {
    const chat = await createOrGetChatByUrl(
      `https://youtube.com/watch?v=route-${suffix}`,
      channel.id
    );
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
        owner.workspace.id,
        owner.user.id,
        "render",
        "completed",
        JSON.stringify({ chatId: chat.id, channelId: channel.id }),
        1,
        0,
        stamp,
        stamp
      );
    const renderExport = createRenderExport({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      chatId: chat.id,
      stage3JobId,
      artifactFileName: `route-${suffix}.mp4`,
      artifactFilePath: `/tmp/route-${suffix}.mp4`,
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 1024,
      renderTitle: `Route ${suffix}`,
      sourceUrl: chat.url,
      snapshotJson: "{}",
      createdByUserId: owner.user.id
    });
    const slot = buildPublicationSlotCandidateFromDateAndIndex({
      settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
      slotDate,
      slotIndex
    });
    return createChannelPublication({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      chatId: chat.id,
      renderExportId: renderExport.id,
      scheduleMode: "slot",
      scheduledAt: slot.scheduledAt,
      uploadReadyAt: slot.uploadReadyAt,
      slotDate: slot.slotDate,
      slotIndex: slot.slotIndex,
      title: `Publication ${suffix}`,
      description: "",
      tags: [],
      notifySubscribers: true,
      needsReview: false,
      createdByUserId: owner.user.id
    });
  };

  return {
    owner,
    channel,
    firstPublication: await createPublication("first", "2040-05-05", 0),
    secondPublication: await createPublication("second", "2040-05-05", 1)
  };
}

test("publication PATCH route returns typed field error when notifySubscribers is locked after upload", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedPublicationRouteScenario();
    markChannelPublicationScheduled({
      publicationId: scenario.firstPublication.id,
      youtubeVideoId: "youtube-video-1",
      youtubeVideoUrl: "https://www.youtube.com/watch?v=youtube-video-1"
    });

    const response = await patchPublicationRoute(
      new Request(`http://localhost/api/publications/${scenario.firstPublication.id}`, {
        method: "PATCH",
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${scenario.owner.sessionToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ notifySubscribers: false })
      }),
      { params: Promise.resolve({ id: scenario.firstPublication.id }) }
    );

    const body = (await response.json()) as { error?: string; code?: string; field?: string };
    assert.equal(response.status, 400);
    assert.equal(body.code, "NOTIFY_SUBSCRIBERS_LOCKED", JSON.stringify(body));
    assert.equal(body.field, "notifySubscribers");
    assert.match(body.error ?? "", /только при первой загрузке/i);
  });
});

test("publication PATCH route returns typed field error when custom time is already in the past", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedPublicationRouteScenario();
    const pastSchedule = buildCustomPublicationCandidateFromLocalDateTime({
      settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
      localDateTime: "2000-01-01T10:00"
    });
    assert.ok(new Date(pastSchedule.scheduledAt).getTime() < Date.now());

    const response = await patchPublicationRoute(
      new Request(`http://localhost/api/publications/${scenario.firstPublication.id}`, {
        method: "PATCH",
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${scenario.owner.sessionToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          scheduleMode: "custom",
          scheduledAtLocal: "2000-01-01T10:00"
        })
      }),
      { params: Promise.resolve({ id: scenario.firstPublication.id }) }
    );

    const body = (await response.json()) as { error?: string; code?: string; field?: string };
    assert.equal(response.status, 400);
    assert.equal(body.code, "CUSTOM_TIME_IN_PAST", JSON.stringify(body));
    assert.equal(body.field, "scheduledAtLocal");
    assert.match(body.error ?? "", /уже в прошлом/i);
  });
});

test("publication PATCH route rejects a title already used by the channel", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedPublicationRouteScenario();

    const response = await patchPublicationRoute(
      new Request(`http://localhost/api/publications/${scenario.secondPublication.id}`, {
        method: "PATCH",
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${scenario.owner.sessionToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          title: scenario.firstPublication.title.toUpperCase()
        })
      }),
      { params: Promise.resolve({ id: scenario.secondPublication.id }) }
    );

    const body = (await response.json()) as { error?: string; code?: string; field?: string };
    assert.equal(response.status, 400);
    assert.equal(body.code, "DUPLICATE_PUBLICATION_TITLE", JSON.stringify(body));
    assert.equal(body.field, "title");
    assert.match(body.error ?? "", /таким же названием/i);
  });
});

test("publication shift route returns typed field error when moving a custom-time publication by slot", async () => {
  await withIsolatedAppData(async () => {
    const scenario = await seedPublicationRouteScenario();
    const customSchedule = buildCustomPublicationCandidateFromLocalDateTime({
      settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
      localDateTime: "2040-05-06T21:07"
    });

    const customPublication = createChannelPublication({
      workspaceId: scenario.owner.workspace.id,
      channelId: scenario.channel.id,
      chatId: scenario.secondPublication.chatId,
      renderExportId: scenario.secondPublication.renderExportId,
      scheduleMode: "custom",
      scheduledAt: customSchedule.scheduledAt,
      uploadReadyAt: customSchedule.uploadReadyAt,
      slotDate: customSchedule.slotDate,
      slotIndex: customSchedule.slotIndex,
      title: "Custom publication",
      description: "",
      tags: [],
      notifySubscribers: true,
      needsReview: false,
      createdByUserId: scenario.owner.user.id
    });

    const response = await shiftPublicationRoute(
      new Request(`http://localhost/api/publications/${customPublication.id}/shift`, {
        method: "POST",
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${scenario.owner.sessionToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ axis: "slot", direction: "next" })
      }),
      { params: Promise.resolve({ id: customPublication.id }) }
    );

    const body = (await response.json()) as { error?: string; code?: string; field?: string };
    assert.equal(response.status, 400);
    assert.equal(body.code, "PUBLICATION_MOVE_FORBIDDEN", JSON.stringify(body));
    assert.equal(body.field, "slot");
    assert.match(body.error ?? "", /Кастомное время/i);
  });
});
