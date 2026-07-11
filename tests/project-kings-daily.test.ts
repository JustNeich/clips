import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendProjectKingsLedgerEvent,
  assertExactProjectKingsTarget,
  buildProjectKingsJudgePacket,
  buildProjectKingsPreflight,
  normalizeProjectKingsSourceKey,
  readProjectKingsLedger,
  resolveProjectKingsSemanticVerdict,
  resolveProjectKingsUnknownUpload,
  runProjectKingsChannelsInParallel,
  summarizeProjectKingsProgress,
  withProjectKingsExternalRetry,
  type ProjectKingsLedgerEvent
} from "../lib/project-kings-daily";

const channelIds = {
  dark: "UCwO37rtHMhHX8caUr5Rc0Bw",
  light: "UC0LWZYpYuYAWK55WmvDqxbg",
  cop: "UCJhBMXXQ5GrTbrhqjwT1leg"
};

function preflightChannel(key: "dark" | "light" | "cop", count = 6) {
  return {
    key,
    channelId: `${key}-clips`,
    expectedYoutubeChannelId: channelIds[key],
    actualYoutubeChannelId: channelIds[key],
    publishingReady: true,
    timezone: "Europe/Moscow",
    candidates: Array.from({ length: count }, (_, index) => ({
      sourceUrl: `https://www.instagram.com/reel/${key}-${index}/`
    }))
  };
}

function verifiedEvent(input: {
  runId?: string;
  channelKey: "dark" | "light" | "cop";
  slot: number;
  youtubeVideoId?: string;
}): ProjectKingsLedgerEvent {
  return {
    runId: input.runId ?? "run-001",
    channelKey: input.channelKey,
    slot: input.slot,
    stage: "public_verified",
    sourceUrl: `https://example.com/${input.channelKey}/${input.slot}`,
    youtubeVideoId: input.youtubeVideoId ?? `${input.channelKey}-video-${input.slot}`,
    at: "2026-07-11T00:00:00.000Z"
  };
}

test("source key normalizes YouTube and Instagram aliases", () => {
  assert.equal(normalizeProjectKingsSourceKey("https://youtu.be/AbCdEf12345?si=x"), "youtube:AbCdEf12345");
  assert.equal(normalizeProjectKingsSourceKey("https://www.youtube.com/shorts/AbCdEf12345?feature=share"), "youtube:AbCdEf12345");
  assert.equal(normalizeProjectKingsSourceKey("https://instagram.com/reel/DW7IFS5jU0_/?igsh=x"), "instagram:DW7IFS5jU0_");
});

test("preflight passes with six distinct available sources per exact binding", () => {
  const result = buildProjectKingsPreflight({
    channels: [preflightChannel("dark"), preflightChannel("light"), preflightChannel("cop")],
    ledger: []
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.channels.map((item) => item.availableDistinct), [6, 6, 6]);
});

test("preflight fails closed on five sources and binding drift", () => {
  const dark = preflightChannel("dark", 5);
  dark.actualYoutubeChannelId = "UC-wrong";
  const result = buildProjectKingsPreflight({
    channels: [dark, preflightChannel("light"), preflightChannel("cop")],
    ledger: []
  });
  assert.equal(result.ready, false);
  assert.ok(result.errors.some((error) => error.includes("buffer 5/6")));
  assert.ok(result.errors.some((error) => error.includes("binding mismatch")));
});

test("queued or published source is removed from the available buffer", () => {
  const dark = preflightChannel("dark", 6);
  const result = buildProjectKingsPreflight({
    channels: [dark, preflightChannel("light"), preflightChannel("cop")],
    ledger: [],
    publications: [{ sourceUrl: dark.candidates[0]!.sourceUrl, status: "scheduled" }]
  });
  assert.equal(result.ready, false);
  assert.equal(result.channels[0]?.availableDistinct, 5);
});

test("progress counts only unique public_verified slots and requires exact 3x3", () => {
  const events = (["dark", "light", "cop"] as const).flatMap((channelKey) =>
    [1, 2, 3].map((slot) => verifiedEvent({ channelKey, slot }))
  );
  events.push({
    runId: "run-001",
    channelKey: "dark",
    slot: 1,
    stage: "publication_queued",
    youtubeVideoId: "not-counted",
    at: "2026-07-11T00:00:00.000Z"
  });
  assert.deepEqual(summarizeProjectKingsProgress(events, "run-001"), { dark: 3, light: 3, cop: 3 });
  assert.doesNotThrow(() => assertExactProjectKingsTarget(events, "run-001"));
});

test("duplicate public video or fourth slot is an invariant failure", () => {
  assert.throws(
    () => summarizeProjectKingsProgress([
      verifiedEvent({ channelKey: "dark", slot: 1, youtubeVideoId: "same-video" }),
      verifiedEvent({ channelKey: "dark", slot: 2, youtubeVideoId: "same-video" })
    ], "run-001"),
    /duplicate/
  );
  assert.throws(() => summarizeProjectKingsProgress([verifiedEvent({ channelKey: "cop", slot: 4 })], "run-001"), /invalid/);
});

test("three channels start in parallel and one failure does not cancel the others", async () => {
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  const promise = runProjectKingsChannelsInParallel(async (channel) => {
    started.push(channel);
    await new Promise<void>((resolve) => releases.set(channel, resolve));
    if (channel === "dark") throw new Error("dark failed");
    return channel;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(new Set(started), new Set(["dark", "light", "cop"]));
  for (const release of releases.values()) release();
  const result = await promise;
  assert.equal(result.dark.status, "rejected");
  assert.equal(result.light.status, "fulfilled");
  assert.equal(result.cop.status, "fulfilled");
});

test("external retry stops after attempt three and never retries auth errors", async () => {
  let attempts = 0;
  const value = await withProjectKingsExternalRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("transient"), { status: 503 });
      return "ok";
    },
    { isRetryable: (error) => (error as { status?: number }).status === 503, sleep: async () => undefined }
  );
  assert.equal(value, "ok");
  assert.equal(attempts, 3);

  attempts = 0;
  await assert.rejects(
    withProjectKingsExternalRetry(
      async () => {
        attempts += 1;
        throw Object.assign(new Error("auth"), { status: 401 });
      },
      { isRetryable: (error) => (error as { status?: number }).status === 503, sleep: async () => undefined }
    )
  );
  assert.equal(attempts, 1);
});

test("two semantic reworks are allowed, then the source is replaced", () => {
  assert.equal(resolveProjectKingsSemanticVerdict({ verdict: "REWORK", reworksDone: 0 }), "rework");
  assert.equal(resolveProjectKingsSemanticVerdict({ verdict: "REWORK", reworksDone: 1 }), "rework");
  assert.equal(resolveProjectKingsSemanticVerdict({ verdict: "REWORK", reworksDone: 2 }), "replace");
  assert.equal(resolveProjectKingsSemanticVerdict({ verdict: "PASS", reworksDone: 2 }), "advance");
});

test("judge packet physically excludes maker reasoning", () => {
  const packet = buildProjectKingsJudgePacket({
    sourceInput: { source: "input" },
    artifact: { top: "artifact" },
    criteria: { qa: "strict" }
  });
  assert.deepEqual(Object.keys(packet), ["sourceInput", "artifact", "criteria"]);
  assert.equal("makerReasoning" in packet, false);
});

test("unknown upload always reconciles before retry", () => {
  assert.equal(resolveProjectKingsUnknownUpload({ publication: { youtubeVideoId: "abc123" } }), "reconcile_video_id");
  assert.equal(resolveProjectKingsUnknownUpload({ uploadSessionUrl: "https://upload/session" }), "reconcile_session");
  assert.equal(resolveProjectKingsUnknownUpload({}), "lookup_publication");
  assert.equal(resolveProjectKingsUnknownUpload({ lookupFound: false }), "retry_upload");
});

test("JSONL append repairs a truncated final line before appending", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "project-kings-ledger-"));
  const filePath = path.join(directory, "ledger.jsonl");
  try {
    const first = verifiedEvent({ channelKey: "light", slot: 1 });
    const second = verifiedEvent({ channelKey: "cop", slot: 2 });
    writeFileSync(filePath, `${JSON.stringify(first)}\n{\"runId\":`, "utf8");
    appendProjectKingsLedgerEvent(filePath, second);

    assert.deepEqual(readProjectKingsLedger(filePath), [first, second]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("JSONL ledger fails closed on a malformed complete line", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "project-kings-ledger-"));
  const filePath = path.join(directory, "ledger.jsonl");
  try {
    writeFileSync(filePath, `{bad}\n${JSON.stringify(verifiedEvent({ channelKey: "light", slot: 1 }))}\n`, "utf8");
    assert.throws(() => readProjectKingsLedger(filePath), /line 1/);
    assert.throws(
      () => appendProjectKingsLedgerEvent(filePath, verifiedEvent({ channelKey: "cop", slot: 2 })),
      /line 1/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
