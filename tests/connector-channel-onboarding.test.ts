import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildConnectorChannelIdentity,
  importConnectorChannelAvatar
} from "../lib/connector-channel-onboarding";
import { createChannel, getChannelById } from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import {
  saveChannelPublishIntegration,
  YouTubeDestinationConflictError
} from "../lib/publication-store";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-connector-onboarding-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("connector identity uses verified YouTube metadata without inventing a public handle", () => {
  assert.deepEqual(
    buildConnectorChannelIdentity({
      id: "UC-ready-123",
      title: "Ready Channel",
      customUrl: "@ready.channel",
      thumbnailUrl: "https://yt3.ggpht.com/avatar"
    }),
    {
      name: "Ready Channel",
      username: "ready.channel",
      onboardingStatus: "ready",
      confirmedHandle: "ready.channel"
    }
  );

  const missing = buildConnectorChannelIdentity({
    id: "UC-no-title-987",
    title: "",
    customUrl: null,
    thumbnailUrl: null
  });
  assert.equal(missing.name, "Новый YouTube-канал");
  assert.equal(missing.onboardingStatus, "needs_identity");
  assert.equal(missing.confirmedHandle, null);
  assert.match(missing.username, /^youtube_/);
});

test("YouTube selection updates connector identity atomically and rejects duplicate destinations", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Connector identity",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const first = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Новый канал",
      username: "pending_first"
    });
    const second = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Новый канал",
      username: "pending_second",
      onboardingStatus: "draft"
    });
    const identity = buildConnectorChannelIdentity({
      id: "UC-unique-destination",
      title: "Atomic Channel",
      customUrl: "@atomic",
      thumbnailUrl: null
    });

    saveChannelPublishIntegration({
      workspaceId: owner.workspace.id,
      channelId: first.id,
      userId: owner.user.id,
      status: "connected",
      credential: null,
      googleAccountEmail: "connector@example.com",
      selectedYoutubeChannelId: "UC-unique-destination",
      selectedYoutubeChannelTitle: "Atomic Channel",
      selectedYoutubeChannelCustomUrl: "@atomic",
      availableChannels: [
        {
          id: "UC-unique-destination",
          title: "Atomic Channel",
          customUrl: "@atomic",
          thumbnailUrl: null
        }
      ],
      scopes: ["youtube.upload"],
      channelIdentity: identity
    });
    const updated = await getChannelById(first.id);
    assert.equal(updated?.name, "Atomic Channel");
    assert.equal(updated?.username, "atomic");
    assert.equal(updated?.onboardingStatus, "ready");

    assert.throws(
      () =>
        saveChannelPublishIntegration({
          workspaceId: owner.workspace.id,
          channelId: second.id,
          userId: owner.user.id,
          status: "connected",
          credential: null,
          googleAccountEmail: "other@example.com",
          selectedYoutubeChannelId: "UC-unique-destination",
          selectedYoutubeChannelTitle: "Atomic Channel",
          selectedYoutubeChannelCustomUrl: "@atomic",
          availableChannels: [],
          scopes: ["youtube.upload"]
        }),
      YouTubeDestinationConflictError
    );
    const unchanged = await getChannelById(second.id);
    assert.equal(unchanged?.onboardingStatus, "draft");
    const secondIntegrationCount = getDb()
      .prepare("SELECT COUNT(*) AS count FROM channel_publish_integrations WHERE channel_id = ?")
      .get(second.id) as { count: number };
    assert.equal(secondIntegrationCount.count, 0);
  });
});

test("connector avatar importer rejects non-Google hosts before downloading", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("unexpected fetch");
  }) as typeof fetch;
  try {
    const result = await importConnectorChannelAvatar({
      channelId: "channel_not_needed",
      thumbnailUrl: "https://example.com/avatar.png"
    });
    assert.deepEqual(result, { imported: false, reason: "avatar_host_not_allowed" });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
