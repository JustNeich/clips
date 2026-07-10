import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectKingsAcceptanceMatrix,
  type ProjectKingsAcceptanceItem
} from "../lib/project-kings/production-acceptance-metrics";

const CHANNELS = ["dark", "light", "cop"];

function items(): ProjectKingsAcceptanceItem[] {
  return CHANNELS.flatMap((channelId, channelIndex) => Array.from({ length: 3 }, (_, slotIndex) => {
    const index = channelIndex * 3 + slotIndex;
    return {
      itemId: `item-${index}`,
      channelId,
      state: "public_verified",
      sourceCandidateId: `source-${index}`,
      eventFingerprint: `event-${index}`,
      youtubeVideoId: `youtube-${index}`,
      publicationScheduledAt: new Date(Date.parse("2026-07-10T12:00:00.000Z") + (index + 1) * 60_000).toISOString(),
      scheduledSlotAt: new Date(Date.parse("2026-07-10T13:00:00.000Z") + index * 60_000).toISOString(),
      publicVerifiedAt: new Date(Date.parse("2026-07-10T13:00:00.000Z") + index * 60_000 + 60_000).toISOString(),
      clipsMatched: true,
      rssSeen: true,
      exactPagePlayable: true,
      criticalDefectCount: 0,
      visualRevisionCount: 1,
      technicalRetryCount: 0,
      semanticCallCount: 6,
      llmTokens: 500,
      waitingReasoningTokens: 0,
      preparedSourceCacheEligible: true,
      preparedSourceCacheHit: index !== 0,
      telemetryComplete: true
    };
  }));
}

function input() {
  return {
    releaseCandidateSha256: "a".repeat(64),
    runId: "run-live-3x3",
    runStartedAt: "2026-07-10T12:00:00.000Z",
    expectedChannelIds: CHANNELS,
    targetPerChannel: 3,
    items: items(),
    july9BaselineTokensPerVideo: 1_200,
    july9BaselineKind: "raw" as const,
    oneChannelFailureIsolationProven: true,
    restartResumeProven: true
  };
}

test("acceptance matrix passes only when every measured 3x3 gate passes", () => {
  const matrix = buildProjectKingsAcceptanceMatrix(input());
  assert.equal(matrix.status, "pass", JSON.stringify(matrix.gates.filter((gate) => gate.status !== "pass"), null, 2));
  assert.equal(matrix.target, 9);
  assert.ok(matrix.gates.every((gate) => gate.status === "pass"));
});

test("estimated July 9 baseline remains NOT_MEASURED and blocks acceptance", () => {
  const matrix = buildProjectKingsAcceptanceMatrix({
    ...input(),
    july9BaselineKind: "estimated",
    july9BaselineTokensPerVideo: 1_200
  });
  assert.equal(matrix.status, "blocked");
  assert.equal(
    matrix.gates.find((gate) => gate.id === "token_reduction_vs_july9")?.status,
    "not_measured"
  );
});

test("duplicate event and a late exact page fail their exact gates", () => {
  const changed = items();
  changed[8] = {
    ...changed[8]!,
    eventFingerprint: changed[0]!.eventFingerprint,
    publicVerifiedAt: new Date(Date.parse(changed[8]!.scheduledSlotAt!) + 301_000).toISOString()
  };
  const matrix = buildProjectKingsAcceptanceMatrix({ ...input(), items: changed });
  assert.equal(matrix.status, "blocked");
  assert.equal(matrix.gates.find((gate) => gate.id === "no_source_or_event_duplicates")?.status, "fail");
  assert.equal(matrix.gates.find((gate) => gate.id === "public_verification_latency")?.status, "fail");
});

test("cache gate is NOT_MEASURED when no rerender was eligible", () => {
  const matrix = buildProjectKingsAcceptanceMatrix({
    ...input(),
    items: items().map((item) => ({
      ...item,
      preparedSourceCacheEligible: false,
      preparedSourceCacheHit: false
    }))
  });
  assert.equal(matrix.status, "blocked");
  assert.equal(matrix.gates.find((gate) => gate.id === "prepared_source_cache_hit")?.status, "not_measured");
});
