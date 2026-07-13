import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  buildPortfolioProductionAgentPacketBase,
  buildPortfolioProductionVisionBinding,
  createPortfolioLiveDispatcher,
  decidePortfolioLiveRecoveryBudget,
  extractBoundSourceKeyFrames,
  resolvePortfolioProductionAgentChannelId,
  resolvePortfolioPublicVerificationPollingBudget,
  type PortfolioLiveEventHandler,
  type PortfolioLiveEventKind,
  type PortfolioLiveRuntimeOptions,
  type ProductionAgentSelections
} from "../lib/portfolio-production-live-runtime";
import type {
  ProductionItemRecord,
  ProductionItemState,
  ProductionOutboxRecord
} from "../lib/portfolio-production-store";
import { validateProductionAgentPacket } from "../lib/project-kings/production-agent-contracts";
import { probeFinalProductionMp4 } from "../lib/production-quality-gate";

const WORKSPACE_ID = "workspace-live-runtime-test";
const ITEM_ID = "item-live-runtime-test";
const execFileAsync = promisify(execFile);

function itemFixture(state: ProductionItemState = "reserved"): ProductionItemRecord {
  return {
    id: ITEM_ID,
    runId: "run-live-runtime-test",
    runChannelId: "run-channel-live-runtime-test",
    workspaceId: WORKSPACE_ID,
    channelId: "channel-live-runtime-test",
    itemSlot: 1,
    generation: 1,
    state,
    resumeState: null,
    sourceCandidateId: "candidate-live-runtime-test",
    sourceSha256: null,
    previewSha256: null,
    templateSha256: null,
    settingsSha256: null,
    finalArtifactSha256: null,
    chatId: null,
    stage2RunId: null,
    stage3JobId: null,
    publicationId: null,
    expectedYoutubeChannelId: "UC1234567890123456789012",
    youtubeVideoId: null,
    uploadSessionUrl: null,
    attempts: 0,
    attemptBudget: 3,
    version: 1,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastError: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    completedAt: null
  };
}

function eventFixture(eventKind: PortfolioLiveEventKind): ProductionOutboxRecord {
  return {
    id: `event-${eventKind}`,
    workspaceId: WORKSPACE_ID,
    runId: "run-live-runtime-test",
    channelId: "channel-live-runtime-test",
    productionItemId: ITEM_ID,
    eventKind,
    dedupeKey: `dedupe-${eventKind}`,
    payload: {},
    status: "processing",
    attempts: 1,
    maxAttempts: 3,
    availableAt: "2026-07-10T00:00:00.000Z",
    leaseOwner: "test",
    leaseToken: "test-token",
    leaseExpiresAt: "2026-07-10T00:05:00.000Z",
    lastError: null,
    deadLetterCode: null,
    projectedAt: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    deliveredAt: null
  };
}

function optionsFixture(): PortfolioLiveRuntimeOptions {
  return {
    workspaceId: WORKSPACE_ID,
    userId: "user-live-runtime-test",
    routeManifestId: "project-kings-model-routes-v2",
    routeManifestSha256: "a".repeat(64),
    selections: {} as ProductionAgentSelections
  };
}

test("semantic packet identity uses stable YouTube UC id, never the Clips database id", () => {
  const item = itemFixture();
  const packet = buildPortfolioProductionAgentPacketBase("source_fit", item, 1, [
    {
      id: "source-metadata",
      kind: "source_metadata",
      mediaType: "json",
      path: "/tmp/source-metadata.json",
      sha256: "a".repeat(64)
    }
  ]);

  assert.equal(packet.channelId, item.expectedYoutubeChannelId);
  assert.notEqual(packet.channelId, item.channelId);
  assert.equal(
    validateProductionAgentPacket("source_fit", {
      ...packet,
      task: {
        candidateId: "candidate-1",
        sourceUrl: "https://www.youtube.com/shorts/source1",
        sourceSha256: "b".repeat(64),
        claimedStoryEventId: "story-event-1",
        knownSourceSha256: [],
        knownStoryEventIds: []
      }
    }).channelId,
    item.expectedYoutubeChannelId
  );
  assert.equal(resolvePortfolioProductionAgentChannelId(item), "UC1234567890123456789012");
  assert.equal(
    buildPortfolioProductionVisionBinding({
      item,
      sourceSha256: "b".repeat(64),
      previewSha256: "c".repeat(64),
      templateSha256: "d".repeat(64),
      settingsSha256: "e".repeat(64)
    }).channelId,
    item.expectedYoutubeChannelId
  );
  assert.throws(
    () =>
      resolvePortfolioProductionAgentChannelId({
        expectedYoutubeChannelId: item.channelId
      }),
    /24-character YouTube UC channel ID/
  );
});

test("public verification polling cannot cross its immutable 24-hour deadline", () => {
  const event = {
    ...eventFixture("public_verify.requested"),
    payload: {
      publicationId: "publication-deadline",
      youtubeVideoId: "youtube-video-deadline",
      publicVerificationStartedAt: "2040-01-01T00:00:00.000Z",
      publicVerificationDeadlineAt: "2040-01-02T00:00:00.000Z"
    }
  };
  assert.deepEqual(
    resolvePortfolioPublicVerificationPollingBudget(
      event,
      new Date("2040-01-01T23:58:00.000Z")
    ),
    {
      deadlineAt: "2040-01-02T00:00:00.000Z",
      maxElapsedMs: 2 * 60_000
    }
  );
  assert.throws(
    () => resolvePortfolioPublicVerificationPollingBudget(
      event,
      new Date("2040-01-02T00:00:00.000Z")
    ),
    /deadline reached/
  );
  assert.throws(
    () => resolvePortfolioPublicVerificationPollingBudget(
      {
        ...event,
        payload: {
          ...event.payload,
          publicVerificationDeadlineAt: "2040-01-02T00:00:00.001Z"
        }
      },
      new Date("2040-01-01T23:58:00.000Z")
    ),
    /missing its immutable 24-hour deadline/
  );
});

test("missing decomposition frames are extracted only from the exact hash-bound source MP4", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clips-source-frame-fallback-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = root;
  try {
    const videoPath = path.join(root, "source.mp4");
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=blue:s=360x640:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath
    ]);
    const sourceSha256 = createHash("sha256").update(await readFile(videoPath)).digest("hex");
    const item = { ...itemFixture("source_ingested"), sourceSha256 };
    const frames = await extractBoundSourceKeyFrames({ item, videoPath });
    assert.equal(frames.length, 9);
    assert.ok(frames.every((frame) =>
      frame.kind === "key_frame" && frame.mediaType === "image" && frame.sha256.length === 64
    ));
    await assert.rejects(
      () => extractBoundSourceKeyFrames({
        item: { ...item, sourceSha256: "f".repeat(64) },
        videoPath
      }),
      /different SHA-256/
    );

    const staleProbe = await probeFinalProductionMp4(videoPath);
    const replacementPath = path.join(root, "replacement.mp4");
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=red:s=360x640:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", replacementPath
    ]);
    await copyFile(replacementPath, videoPath);
    await assert.rejects(
      () => extractBoundSourceKeyFrames({ item, videoPath, sourceProbe: staleProbe, count: 1 }),
      /different SHA-256/
    );

    const corruptPath = path.join(root, "corrupt.mp4");
    await writeFile(corruptPath, "not an mp4");
    const corruptSha256 = createHash("sha256").update(await readFile(corruptPath)).digest("hex");
    await assert.rejects(
      () => extractBoundSourceKeyFrames({
        item: { ...item, sourceSha256: corruptSha256 },
        videoPath: corruptPath,
        count: 1
      }),
      /Invalid data|ffprobe|moov atom|fully decodable/i
    );
  } finally {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("injected live dispatcher preserves the complete source-to-public order", async () => {
  let item = itemFixture();
  const calls: string[] = [];
  const advance = (
    labels: string[],
    toState: ProductionItemState
  ): PortfolioLiveEventHandler => async () => {
    calls.push(...labels);
    item = { ...item, state: toState, version: item.version + 1 };
  };
  const handlers: Partial<Record<PortfolioLiveEventKind, PortfolioLiveEventHandler>> = {
    "source_ingest.requested": advance(["source"], "source_ingested"),
    "source_fit.requested": advance(["semantic:source_fit"], "source_qualified"),
    "brief.requested": advance(
      ["semantic:caption", "semantic:montage_planner"],
      "brief_ready"
    ),
    "preview.requested": advance(["preview_render", "preview_qa"], "preview_approved"),
    "final_render.requested": advance(["final_render", "final_qa"], "final_approved"),
    "publication.requested": advance(["publication"], "publication_scheduled"),
    "public_verify.requested": advance(["public_verify"], "public_verified")
  };
  const dispatch = createPortfolioLiveDispatcher(optionsFixture(), {
    getItem: () => item,
    handlers
  });

  for (const eventKind of [
    "source_ingest.requested",
    "source_fit.requested",
    "brief.requested",
    "preview.requested",
    "final_render.requested",
    "publication.requested",
    "public_verify.requested"
  ] as const) {
    await dispatch(eventFixture(eventKind));
  }

  assert.deepEqual(calls, [
    "source",
    "semantic:source_fit",
    "semantic:caption",
    "semantic:montage_planner",
    "preview_render",
    "preview_qa",
    "final_render",
    "final_qa",
    "publication",
    "public_verify"
  ]);
  assert.equal(item.state, "public_verified");
});

test("publication handler is never invoked before final approval", async () => {
  let item = itemFixture("preview_approved");
  let finalQaCalls = 0;
  let publicationCalls = 0;
  const dispatch = createPortfolioLiveDispatcher(optionsFixture(), {
    getItem: () => item,
    handlers: {
      "final_render.requested": async () => {
        finalQaCalls += 1;
        item = { ...item, state: "final_approved" };
      },
      "publication.requested": async () => {
        publicationCalls += 1;
        item = { ...item, state: "publication_scheduled" };
      }
    }
  });

  await dispatch(eventFixture("publication.requested"));
  assert.equal(publicationCalls, 0);

  item = { ...item, state: "final_rendered" };
  await dispatch(eventFixture("publication.requested"));
  assert.equal(publicationCalls, 0);

  item = { ...item, state: "preview_approved" };
  await dispatch(eventFixture("final_render.requested"));
  await dispatch(eventFixture("publication.requested"));
  assert.equal(finalQaCalls, 1);
  assert.equal(publicationCalls, 1);
});

test("cancel and upload-unknown events remain dispatchable until the external outcome is reconciled", async () => {
  let item = {
    ...itemFixture("cancel_requested"),
    publicationId: "publication-race-1"
  };
  const calls: string[] = [];
  const authlessOptions: PortfolioLiveRuntimeOptions = {
    workspaceId: WORKSPACE_ID,
    userId: "user-live-runtime-test",
    routeManifestId: "project-kings-model-routes-v2",
    routeManifestSha256: "a".repeat(64),
    selections: {} as ProductionAgentSelections
  };
  const dispatch = createPortfolioLiveDispatcher(authlessOptions, {
    getItem: () => item,
    handlers: {
      "production.item.cancel_requested": async () => {
        calls.push("cancel_fence");
        item = { ...item, state: "upload_outcome_unknown", version: item.version + 1 };
      },
      "publication.requested": async () => {
        calls.push("publication_reconcile");
        item = { ...item, state: "publication_scheduled", version: item.version + 1 };
      },
      "public_verify.requested": async () => {
        calls.push("public_verify");
        item = { ...item, state: "public_verified", version: item.version + 1 };
      }
    }
  });

  await dispatch(eventFixture("production.item.cancel_requested"));
  await dispatch(eventFixture("publication.requested"));
  await dispatch(eventFixture("public_verify.requested"));

  assert.deepEqual(calls, ["cancel_fence", "publication_reconcile", "public_verify"]);
  assert.equal(item.state, "public_verified");
});

test("partial preview and final QA states remain retryable without opening publication", async () => {
  let item = itemFixture("preview_ready");
  const calls: string[] = [];
  const dispatch = createPortfolioLiveDispatcher(optionsFixture(), {
    getItem: () => item,
    handlers: {
      "preview.requested": async () => {
        calls.push("preview_qa_retry");
        item = { ...item, state: "preview_approved" };
      },
      "final_render.requested": async () => {
        calls.push(item.state === "final_rendered" ? "final_qa_retry" : "final_render");
        item = { ...item, state: "final_approved" };
      },
      "publication.requested": async () => {
        calls.push("publication");
      }
    }
  });

  await dispatch({ ...eventFixture("preview.requested"), attempts: 2 });
  item = { ...item, state: "final_rendered" };
  await dispatch({ ...eventFixture("final_render.requested"), attempts: 2 });
  await dispatch(eventFixture("publication.requested"));

  assert.deepEqual(calls, ["preview_qa_retry", "final_qa_retry", "publication"]);
});

test("revision dispatch requires a ledger-backed application before the next preview", async () => {
  let item: ProductionItemRecord = {
    ...itemFixture("rework"),
    resumeState: "preview_ready",
    attempts: 1
  };
  const calls: string[] = [];
  const dispatch = createPortfolioLiveDispatcher(optionsFixture(), {
    getItem: () => item,
    handlers: {
      "revision.requested": async (event) => {
        assert.equal(event.payload.expectedRevisionAction, "targeted_visual_revision");
        calls.push("persist_and_apply_revision_ledger");
        item = { ...item, state: "preview_ready", resumeState: null };
      },
      "preview_revision.requested": async (event) => {
        assert.equal(event.payload.revisionLedgerEntryId, "revision-ledger-entry-1");
        calls.push("render_changed_snapshot");
        item = { ...item, state: "preview_approved" };
      }
    }
  });

  await dispatch({
    ...eventFixture("revision.requested"),
    payload: { expectedRevisionAction: "targeted_visual_revision" }
  });
  await dispatch({
    ...eventFixture("preview_revision.requested"),
    payload: { revisionLedgerEntryId: "revision-ledger-entry-1" }
  });

  assert.deepEqual(calls, ["persist_and_apply_revision_ledger", "render_changed_snapshot"]);
  assert.equal(item.state, "preview_approved");
});

test("rework and replacement budgets are bounded and invalid counters fail closed", () => {
  assert.deepEqual(
    decidePortfolioLiveRecoveryBudget({ attempts: 0, attemptBudget: 3, generation: 1 }),
    {
      canRework: true,
      canReplace: true,
      remainingReworks: 3,
      remainingReplacements: 2
    }
  );
  assert.deepEqual(
    decidePortfolioLiveRecoveryBudget({ attempts: 3, attemptBudget: 3, generation: 2 }),
    {
      canRework: false,
      canReplace: true,
      remainingReworks: 0,
      remainingReplacements: 1
    }
  );
  assert.deepEqual(
    decidePortfolioLiveRecoveryBudget({ attempts: 2, attemptBudget: 3, generation: 3 }),
    {
      canRework: true,
      canReplace: false,
      remainingReworks: 1,
      remainingReplacements: 0
    }
  );
  assert.deepEqual(
    decidePortfolioLiveRecoveryBudget({ attempts: -1, attemptBudget: 0, generation: 0 }),
    {
      canRework: false,
      canReplace: false,
      remainingReworks: 0,
      remainingReplacements: 0
    }
  );
});
