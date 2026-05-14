import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel } from "../lib/chat-history";
import {
  importCopscopesSourcePool,
  listCopscopesSourcePool,
  setActiveCopscopesCategory
} from "../lib/copscopes-source-pool";
import {
  runCopscopesDailyPool,
  shouldQueueCopscopesStage3Render,
  type CopscopesDailyExecutor
} from "../lib/copscopes-daily-runner";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-copscopes-daily-runner-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousManagedTemplatesRoot = process.env.MANAGED_TEMPLATES_ROOT;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.MANAGED_TEMPLATES_ROOT = path.join(appDataDir, "managed-templates");
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousManagedTemplatesRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_ROOT = previousManagedTemplatesRoot;
    }
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

async function seedDailyScenario() {
  const owner = await bootstrapOwner({
    workspaceName: "CopScopes Daily",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "CopScopes",
    username: "copscopes"
  });
  importCopscopesSourcePool({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    items: Array.from({ length: 5 }, (_, index) => ({
      url: `https://www.instagram.com/copscopes/reel/D${index + 1}/`,
      categorySlug: "vehicle-pursuit",
      title: `Vehicle pursuit ${index + 1}`,
      viewCount: 1000 + index
    }))
  });
  setActiveCopscopesCategory({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    categorySlug: "vehicle-pursuit"
  });
  return { owner, channel };
}

test("CopScopes quality gate allows queue only after crop and review pass", () => {
  assert.equal(
    shouldQueueCopscopesStage3Render({
      status: "queued",
      qualityGatePassed: true,
      review: {
        qualityGatePassed: true,
        cropPassed: true,
        sourceMetaLeakDetected: false,
        finalDurationSec: 6,
        notes: []
      }
    }),
    true
  );
  assert.equal(
    shouldQueueCopscopesStage3Render({
      status: "queued",
      qualityGatePassed: true,
      review: {
        qualityGatePassed: true,
        cropPassed: false,
        sourceMetaLeakDetected: false,
        finalDurationSec: 6,
        notes: ["source border visible"]
      }
    }),
    false
  );
  assert.equal(
    shouldQueueCopscopesStage3Render({
      status: "queued",
      qualityGatePassed: true,
      review: {
        qualityGatePassed: true,
        cropPassed: true,
        sourceMetaLeakDetected: false,
        finalDurationSec: 6.2,
        notes: []
      }
    }),
    false
  );
});

test("CopScopes daily run processes up to 3 queued items in isolated DB", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedDailyScenario();
    const executor: CopscopesDailyExecutor = async ({ reel }) => ({
      status: "queued",
      qualityGatePassed: true,
      chatId: `chat-${reel.shortcode}`,
      stage2RunId: `stage2-${reel.shortcode}`,
      stage3JobId: `stage3-${reel.shortcode}`,
      publicationId: `pub-${reel.shortcode}`,
      review: {
        qualityGatePassed: true,
        cropPassed: true,
        sourceMetaLeakDetected: false,
        finalDurationSec: 6,
        notes: ["pass"]
      }
    });

    const result = await runCopscopesDailyPool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      limit: 3,
      attemptBudget: 3,
      executor
    });

    assert.equal(result.queuedCount, 3);
    assert.equal(result.reviewedCount, 0);
    assert.equal(result.failedCount, 0);
    const listed = listCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      categorySlug: "vehicle-pursuit"
    });
    assert.equal(listed.reels.filter((reel) => reel.status === "in_progress").length, 3);
    assert.equal(listed.reels.filter((reel) => reel.status === "available").length, 2);
  });
});

test("CopScopes daily run keeps failed crop reviews out of publication queue and tries next item", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedDailyScenario();
    let calls = 0;
    const executor: CopscopesDailyExecutor = async ({ reel }) => {
      calls += 1;
      if (calls === 1) {
        return {
          status: "queued",
          qualityGatePassed: true,
          chatId: `chat-${reel.shortcode}`,
          review: {
            qualityGatePassed: true,
            cropPassed: false,
            sourceMetaLeakDetected: true,
            finalDurationSec: 6,
            notes: ["CopScopes black frame leaked into source window."]
          }
        };
      }
      return {
        status: "queued",
        qualityGatePassed: true,
        chatId: `chat-${reel.shortcode}`,
        stage3JobId: `stage3-${reel.shortcode}`,
        review: {
          qualityGatePassed: true,
          cropPassed: true,
          sourceMetaLeakDetected: false,
          finalDurationSec: 6,
          notes: ["pass"]
        }
      };
    };

    const result = await runCopscopesDailyPool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      limit: 3,
      attemptBudget: 4,
      executor
    });

    assert.equal(result.queuedCount, 3);
    assert.equal(result.reviewedCount, 1);
    assert.equal(calls, 4);
    const listed = listCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      categorySlug: "vehicle-pursuit"
    });
    assert.equal(listed.reels.filter((reel) => reel.status === "in_progress").length, 3);
    assert.equal(listed.reels.filter((reel) => reel.status === "needs_review").length, 1);
  });
});

test("CopScopes daily run preserves skipped status for duplicate story candidates", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedDailyScenario();
    let calls = 0;
    const executor: CopscopesDailyExecutor = async ({ reel }) => {
      calls += 1;
      if (calls === 1) {
        return {
          status: "skipped",
          qualityGatePassed: false,
          chatId: `chat-${reel.shortcode}`,
          error: "duplicate_copscopes_story_against_active_publication:publication=pub-1"
        };
      }
      return {
        status: "queued",
        qualityGatePassed: true,
        chatId: `chat-${reel.shortcode}`,
        stage3JobId: `stage3-${reel.shortcode}`,
        review: {
          qualityGatePassed: true,
          cropPassed: true,
          sourceMetaLeakDetected: false,
          finalDurationSec: 6,
          notes: ["pass"]
        }
      };
    };

    const result = await runCopscopesDailyPool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      limit: 3,
      attemptBudget: 4,
      executor
    });

    assert.equal(result.queuedCount, 3);
    assert.equal(result.reviewedCount, 1);
    assert.equal(calls, 4);
    const listed = listCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      categorySlug: "vehicle-pursuit"
    });
    assert.equal(listed.reels.filter((reel) => reel.status === "skipped").length, 1);
    assert.match(
      listed.reels.find((reel) => reel.status === "skipped")?.lastError ?? "",
      /duplicate_copscopes_story/
    );
  });
});
