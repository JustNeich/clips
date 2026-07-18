import assert from "node:assert/strict";
import test from "node:test";
import type { SourceJobRecord } from "../lib/source-job-store";
import {
  resolveCompletedSourceBindingForEnqueue,
  Stage3SourceBindingError,
  type Stage3CompletedSourceExpectation
} from "../lib/stage3-source-binding";

const expectation: Stage3CompletedSourceExpectation = {
  jobId: "source-job-1",
  expectedCacheKey: "cache-key-1",
  expectedDurationSec: 17.069,
  expectedWidth: 720,
  expectedHeight: 1280,
  expectedSizeBytes: 1_234
};

const sourceJob = {
  jobId: "source-job-1",
  workspaceId: "workspace-1",
  creatorUserId: "user-1",
  channelId: "channel-1",
  chatId: "chat-1",
  sourceUrl: "https://www.instagram.com/reel/exact-media/",
  status: "completed",
  resultData: {
    chatId: "chat-1",
    channelId: "channel-1",
    sourceUrl: "https://www.instagram.com/reel/exact-media/",
    stage1Ready: true,
    title: "Exact source",
    videoFileName: "exact.mp4",
    videoSizeBytes: 1_234,
    sourceCacheKey: "cache-key-1",
    commentsAvailable: false,
    commentsError: null,
    commentsPayload: null,
    autoStage2RunId: null
  },
  request: {
    sourceUrl: "https://www.instagram.com/reel/exact-media/",
    autoRunStage2: false,
    trigger: "fetch",
    chat: { id: "chat-1", channelId: "channel-1" },
    channel: { id: "channel-1", name: "Channel", username: "channel" }
  },
  progress: {
    status: "completed",
    activeStageId: "stage2",
    detail: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    startedAt: "2026-07-18T00:00:01.000Z",
    updatedAt: "2026-07-18T00:00:02.000Z",
    finishedAt: "2026-07-18T00:00:02.000Z",
    error: null
  },
  errorMessage: null,
  createdAt: "2026-07-18T00:00:00.000Z",
  startedAt: "2026-07-18T00:00:01.000Z",
  updatedAt: "2026-07-18T00:00:02.000Z",
  finishedAt: "2026-07-18T00:00:02.000Z"
} satisfies SourceJobRecord;

const cachedSource = {
  sourcePath: "/tmp/exact.mp4",
  sourceKey: "cache-key-1",
  fileName: "exact.mp4",
  title: "Exact source",
  videoSizeBytes: 1_234,
  downloadProvider: "instagramEmbed" as const,
  primaryProviderError: null,
  downloadFallbackUsed: false,
  providerErrorSummary: null,
  cacheState: "hit" as const
};

function dependencies(overrides?: {
  job?: SourceJobRecord | null;
  cacheKey?: string;
  durationSec?: number;
  width?: number;
  height?: number;
}) {
  return {
    getSourceJob: () => (overrides && "job" in overrides ? overrides.job ?? null : sourceJob),
    getCachedSourceMedia: async () => ({
      ...cachedSource,
      sourceKey: overrides?.cacheKey ?? cachedSource.sourceKey
    }),
    inspectSourceFile: async () => ({
      durationSec: overrides?.durationSec ?? 17.069,
      width: overrides?.width ?? 720,
      height: overrides?.height ?? 1280,
      sizeBytes: 1_234,
      sha256: "a".repeat(64)
    })
  };
}

test("completed source binding resolves exact owned media identity", async () => {
  const binding = await resolveCompletedSourceBindingForEnqueue(
    {
      workspaceId: "workspace-1",
      channelId: "channel-1",
      chatId: "chat-1",
      sourceUrl: "https://www.instagram.com/reel/exact-media/",
      expectation
    },
    dependencies()
  );

  assert.equal(binding.kind, "completed-source-job");
  assert.equal(binding.sourceJobId, "source-job-1");
  assert.equal(binding.sourceCacheKey, "cache-key-1");
  assert.equal(binding.sourceDurationSec, 17.069);
  assert.equal(binding.sourceWidth, 720);
  assert.equal(binding.sourceHeight, 1280);
  assert.equal(binding.sourceSizeBytes, 1_234);
  assert.equal(binding.sourceSha256, "a".repeat(64));
});

test("completed source binding rejects workspace, channel and chat ownership mismatches", async () => {
  for (const input of [
    { workspaceId: "workspace-other", channelId: "channel-1", chatId: "chat-1" },
    { workspaceId: "workspace-1", channelId: "channel-other", chatId: "chat-1" },
    { workspaceId: "workspace-1", channelId: "channel-1", chatId: "chat-other" }
  ]) {
    await assert.rejects(
      resolveCompletedSourceBindingForEnqueue(
        {
          ...input,
          expectation
        },
        dependencies()
      ),
      (error: unknown) =>
        error instanceof Stage3SourceBindingError &&
        [
          "completed_source_job_not_found",
          "completed_source_channel_mismatch",
          "completed_source_chat_mismatch"
        ].includes(error.code)
    );
  }
});

test("completed source binding rejects cache, duration and dimensions instead of falling back", async () => {
  const cases = [
    {
      deps: dependencies({ cacheKey: "other-cache" }),
      code: "completed_source_cache_key_mismatch"
    },
    {
      deps: dependencies({ durationSec: 6 }),
      code: "completed_source_duration_mismatch"
    },
    {
      deps: dependencies({ width: 540, height: 960 }),
      code: "completed_source_dimensions_mismatch"
    }
  ];
  for (const item of cases) {
    await assert.rejects(
      resolveCompletedSourceBindingForEnqueue(
        {
          workspaceId: "workspace-1",
          channelId: "channel-1",
          chatId: "chat-1",
          expectation
        },
        item.deps
      ),
      (error: unknown) => error instanceof Stage3SourceBindingError && error.code === item.code
    );
  }
});
