import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { describeChannelManagerSavePatch } from "../app/components/ChannelManager";
import { fallbackRenderPlan, normalizeRenderPlan } from "../app/home-page-support";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-channel-render-duration-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;

  process.env.APP_DATA_DIR = appDataDir;

  try {
    return await run();
  } finally {
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("channel render duration defaults to 6 seconds and persists an explicit 9 second override", async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Channel Duration",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Snack",
      username: "snack"
    });

    assert.equal(channel.defaultClipDurationSec, 6);

    const updated = await chatHistory.updateChannelById(channel.id, {
      defaultClipDurationSec: 9
    });

    assert.equal(updated.defaultClipDurationSec, 9);

    const reloaded = await chatHistory.getChannelById(channel.id);
    assert.equal(reloaded?.defaultClipDurationSec, 9);
  });
});

test("render plan normalization preserves a longer per-channel target duration", () => {
  const normalized = normalizeRenderPlan(
    {
      ...fallbackRenderPlan(),
      targetDurationSec: 9
    },
    fallbackRenderPlan()
  );

  assert.equal(normalized.targetDurationSec, 9);
});

test("channel manager classifies duration changes as render saves", () => {
  assert.deepEqual(describeChannelManagerSavePatch({ defaultClipDurationSec: 9 }), {
    saving: "Сохраняем настройки рендера…",
    saved: "Настройки рендера сохранены.",
    error: "Не удалось сохранить настройки рендера."
  });
});
