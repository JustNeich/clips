import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel } from "../lib/chat-history";
import {
  importCopscopesSourcePool,
  listCopscopesDailyRuns,
  listCopscopesSourcePool,
  setActiveCopscopesCategory
} from "../lib/copscopes-source-pool";
import {
  hardenCopscopesRenderSnapshotForPublication,
  runCopscopesDailyPool,
  shouldQueueCopscopesStage3Render,
  type CopscopesDailyExecutor
} from "../lib/copscopes-daily-runner";
import {
  COPSCOPES_MAX_FOCUS_Y,
  COPSCOPES_MAX_VIDEO_ZOOM,
  COPSCOPES_TIGHT_SOURCE_CROP_SOURCE,
  createCopscopesTightSourceCrop
} from "../lib/copscopes-quality-gate";
import { bootstrapOwner } from "../lib/team-store";
import type { Stage3StateSnapshot } from "../app/components/types";

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
    username: "copscopes-x2e"
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

test("CopScopes daily run preserves caller run id for async control polling", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedDailyScenario();
    const executor: CopscopesDailyExecutor = async ({ reel }) => ({
      status: "queued",
      qualityGatePassed: true,
      chatId: `chat-${reel.shortcode}`,
      stage2RunId: `stage2-${reel.shortcode}`,
      stage3JobId: `stage3-${reel.shortcode}`,
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
      runId: "copscopes-fixed-run",
      limit: 1,
      attemptBudget: 1,
      executor
    });

    assert.equal(result.runId, "copscopes-fixed-run");
    const runs = listCopscopesDailyRuns({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      runId: "copscopes-fixed-run"
    });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "completed");
    assert.equal(runs[0].queuedCount, 1);
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

test("CopScopes daily run records concrete quality-gate failure reasons", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedDailyScenario();
    const executor: CopscopesDailyExecutor = async ({ reel }) => ({
      status: "needs_review",
      qualityGatePassed: false,
      chatId: `chat-${reel.shortcode}`,
      stage2RunId: `stage2-${reel.shortcode}`,
      review: {
        qualityGatePassed: false,
        cropPassed: false,
        sourceMetaLeakDetected: true,
        finalDurationSec: 6,
        notes: ["Stage 3 score 0.840 did not clear the CopScopes queue gate.", "source_crop_too_narrow_for_readability"]
      },
      report: {
        stage3Status: "applied",
        finalScore: 0.84
      }
    });

    const result = await runCopscopesDailyPool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      limit: 1,
      attemptBudget: 1,
      executor
    });

    assert.equal(result.queuedCount, 0);
    assert.equal(result.reviewedCount, 1);
    const listed = listCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      categorySlug: "vehicle-pursuit"
    });
    const reviewed = listed.reels.find((reel) => reel.status === "needs_review");
    assert.ok(reviewed?.lastError?.includes("stage3_score=0.840"));
    assert.ok(reviewed?.lastError?.includes("source_crop_too_narrow_for_readability"));
  });
});

test("CopScopes render snapshot hardening clamps unsafe zoom and focus before queueing", () => {
  const crop = createCopscopesTightSourceCrop(0.91);
  const snapshot = {
    topText: "THE STOP WENT WRONG",
    bottomText:
      "Police said the driver kept moving after the cruiser hit the intersection, forcing officers to box in the sedan before the suspect finally opened the door.",
    captionHighlights: { top: [], bottom: [] },
    clipStartSec: 0,
    clipDurationSec: 7.2,
    focusY: 0.82,
    sourceDurationSec: 44,
    textFit: {
      topFontPx: 40,
      bottomFontPx: 34,
      topCompacted: false,
      bottomCompacted: false
    },
    renderPlan: {
      targetDurationSec: 7.2,
      timingMode: "auto",
      normalizeToTargetEnabled: false,
      editorSelectionMode: "fragments",
      audioMode: "source_only",
      sourceAudioEnabled: true,
      smoothSlowMo: false,
      mirrorEnabled: true,
      cameraMotion: "disabled",
      cameraKeyframes: [],
      cameraPositionKeyframes: [],
      cameraScaleKeyframes: [],
      focusX: 0.5,
      videoZoom: 1.42,
      videoBrightness: 1,
      videoExposure: 0,
      videoContrast: 1,
      videoSaturation: 1,
      sourceCrop: null,
      topFontScale: 1.25,
      bottomFontScale: 1.25,
      musicGain: 0,
      textPolicy: "strict_fit",
      segments: [
        {
          startSec: 2,
          endSec: 8,
          label: "Impact",
          speed: 1,
          focusY: 0.9,
          videoZoom: 1.5,
          mirrorEnabled: true
        }
      ],
      policy: "fixed_segments",
      backgroundAssetId: null,
      backgroundAssetMimeType: null,
      musicAssetId: null,
      musicAssetMimeType: null,
      avatarAssetId: null,
      avatarAssetMimeType: null,
      authorName: "",
      authorHandle: "",
      templateId: "copscopes",
      prompt: ""
    }
  } as Stage3StateSnapshot;

  const hardened = hardenCopscopesRenderSnapshotForPublication(snapshot, {
    sourceCrop: crop,
    avatarAssetId: "avatar-1",
    avatarAssetMimeType: "image/png",
    authorName: "COP SCOPES",
    authorHandle: "@copscopes-x2e"
  });

  assert.equal(hardened.clipDurationSec, 6);
  assert.equal(hardened.focusY, COPSCOPES_MAX_FOCUS_Y);
  assert.equal(hardened.renderPlan.targetDurationSec, 6);
  assert.equal(hardened.renderPlan.videoZoom, COPSCOPES_MAX_VIDEO_ZOOM);
  assert.equal(hardened.renderPlan.mirrorEnabled, false);
  assert.equal(hardened.renderPlan.sourceCrop?.source, COPSCOPES_TIGHT_SOURCE_CROP_SOURCE);
  assert.equal(hardened.renderPlan.avatarAssetId, "avatar-1");
  assert.equal(hardened.renderPlan.segments[0]?.focusY, COPSCOPES_MAX_FOCUS_Y);
  assert.equal(hardened.renderPlan.segments[0]?.videoZoom, COPSCOPES_MAX_VIDEO_ZOOM);
  assert.equal(hardened.renderPlan.segments[0]?.mirrorEnabled, false);
});
