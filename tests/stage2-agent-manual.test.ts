import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { Stage2Output } from "../app/components/types";
import {
  agentManualCaptionIssues,
  applyAgentManualCaption,
  parseAgentManualCaption
} from "../lib/stage2-agent-manual";
import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS
} from "../lib/stage2-channel-config";
import { createStage2Run, getStage2Run } from "../lib/stage2-progress-store";
import { buildStage2RunRequestSnapshot } from "../lib/stage2-run-request";
import { bootstrapOwner } from "../lib/team-store";
import { createChannel } from "../lib/chat-history";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage2-agent-manual-test-"));
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

function buildRequestSnapshotWithCaption(
  channelId: string,
  channelUsername: string,
  agentCaption: { top: string; bottom: string; topRu?: string; bottomRu?: string } | undefined
) {
  return buildStage2RunRequestSnapshot({
    sourceUrl: "https://example.com/source-reel",
    userInstruction: null,
    mode: "manual",
    agentCaption,
    channel: {
      id: channelId,
      name: "Agent Manual Roundtrip",
      username: channelUsername,
      stage2WorkerProfileId: null,
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
    }
  });
}

const constraints = DEFAULT_STAGE2_HARD_CONSTRAINTS;

function makeOutput(): Stage2Output {
  return {
    inputAnalysis: { visualAnchors: [], commentVibe: "", keyPhraseToAdapt: "" },
    captionOptions: [
      {
        option: 1,
        candidateId: "c1",
        top: "ORIGINAL TOP CAPTION TEXT",
        bottom: "Original bottom caption text that is comfortably long enough.",
        topRu: "СТАРЫЙ ВЕРХ ПОДПИСИ",
        bottomRu: "Старый русский низ подписи.",
        highlights: { top: [{ start: 0, end: 8 }], bottom: [{ start: 0, end: 4 }] }
      },
      {
        option: 2,
        candidateId: "c2",
        top: "SECOND OPTION TOP CAPTION",
        bottom: "Second option bottom caption text for the runner-up."
      }
    ],
    titleOptions: [{ option: 1, title: "Title" }],
    finalPick: { option: 1, reason: "winner" },
    winner: {
      candidateId: "c1",
      option: 1,
      reason: "winner",
      displayTier: "finalist",
      sourceStage: "classicOneShot"
    }
  } as unknown as Stage2Output;
}

test("parseAgentManualCaption requires top and bottom", () => {
  assert.equal(parseAgentManualCaption({ top: "only top" }), null);
  assert.equal(parseAgentManualCaption(null), null);
  const caption = parseAgentManualCaption({ top: "A", bottom: "B", topRu: "А", bottomRu: "Б" });
  assert.ok(caption);
  assert.equal(caption?.top, "A");
  assert.equal(caption?.bottomRu, "Б");
});

test("applyAgentManualCaption overwrites the winning option and marks constraintCheck passed", () => {
  const output = makeOutput();
  const top = "MEMORY IS THE NEXT AI LEAP";
  const bottom = "Altman says the next jump is memory, not raw reasoning power.";
  const result = applyAgentManualCaption(
    output,
    { top, bottom, topRu: "ПАМЯТЬ — СЛЕДУЮЩИЙ СКАЧОК", bottomRu: "Олтман о памяти, а не о мощности." },
    constraints
  );
  assert.equal(result.applied, true);
  const winningOption = output.captionOptions.find((option) => option.option === output.finalPick.option)!;
  assert.equal(winningOption.top, top);
  assert.equal(winningOption.bottom, bottom);
  assert.equal(winningOption.topRu, "ПАМЯТЬ — СЛЕДУЮЩИЙ СКАЧОК");
  assert.equal(winningOption.constraintCheck?.passed, true);
  assert.equal(output.winner?.constraintCheck?.passed, true);
  // stale highlight spans (positions into the OLD text) must be replaced, not kept.
  assert.deepEqual(winningOption.highlights?.top, []);
  assert.deepEqual(winningOption.highlights?.bottom, []);
  // the non-winning option is left untouched
  assert.equal(output.captionOptions[1].top, "SECOND OPTION TOP CAPTION");
});

test("applyAgentManualCaption mirrors English into RU when the agent omits translations", () => {
  const output = makeOutput();
  const top = "THE SMALL TOOL DID THE LIFTING";
  const bottom = "A tiny utility quietly carried the entire workflow this week.";
  const result = applyAgentManualCaption(output, { top, bottom }, constraints);
  assert.equal(result.applied, true);
  const winningOption = output.captionOptions.find((option) => option.option === output.finalPick.option)!;
  // bilingual fields stay present (rollout audit requires them) and are NOT stale.
  assert.equal(winningOption.topRu, top);
  assert.equal(winningOption.bottomRu, bottom);
});

test("applyAgentManualCaption falls back (no mutation) when text violates hard constraints", () => {
  const output = makeOutput();
  const before = output.captionOptions[0].top;
  const result = applyAgentManualCaption(output, { top: "SHORT", bottom: "tiny" }, constraints);
  assert.equal(result.applied, false);
  assert.ok(result.issues.length > 0);
  assert.equal(output.captionOptions[0].top, before);
});

test("agentManualCaptionIssues flags length violations", () => {
  const longBottom = "x".repeat(constraints.bottomLengthMax + 40);
  const issues = agentManualCaptionIssues({ top: "OK LENGTH TOP CAPTION HERE", bottom: longBottom }, constraints);
  assert.ok(issues.some((issue) => issue.includes("BOTTOM length")));
});

test("agentCaption survives the createStage2Run DB persist/read round-trip", async () => {
  // Regression: normalizeRequest used to rebuild the request from the persisted
  // JSON without re-reading agentCaption, so saveRecord's read-back silently
  // stripped it and the stage2-runner never applied the agent text. The platform
  // winner then always shipped, with no rejection warning.
  await withIsolatedAppData(async () => {
    const agentCaption = {
      top: "AGENT TOP CAPTION THAT IS COMFORTABLY IN RANGE",
      bottom: "Agent bottom caption text written by the external copywriter agent here.",
      topRu: "ВЕРХ ОТ АГЕНТА",
      bottomRu: "Низ от агента."
    };
    const owner = await bootstrapOwner({
      workspaceName: "Agent Manual Roundtrip",
      email: "owner-agent-manual-roundtrip@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Agent Manual Roundtrip",
      username: "agent_manual_roundtrip"
    });
    const request = buildRequestSnapshotWithCaption(channel.id, channel.username, agentCaption);
    // The freshly built in-memory snapshot carries the caption...
    assert.deepEqual(request.agentCaption, agentCaption);

    const created = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: null,
      request
    });
    // ...and so must the record returned by createStage2Run (which is mapped
    // back from the persisted row inside saveRecord).
    assert.deepEqual(
      created.request.agentCaption,
      agentCaption,
      "agentCaption must survive saveRecord's read-back"
    );

    // A fresh independent read from the DB must also carry it.
    const reread = getStage2Run(created.runId);
    assert.ok(reread);
    assert.deepEqual(
      reread?.request.agentCaption,
      agentCaption,
      "agentCaption must survive a fresh getStage2Run read"
    );
  });
});

test("requests without agentCaption stay agentCaption-free after the round-trip (human path unchanged)", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Human Manual Roundtrip",
      email: "owner-human-manual-roundtrip@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Human Manual Roundtrip",
      username: "human_manual_roundtrip"
    });
    const request = buildRequestSnapshotWithCaption(channel.id, channel.username, undefined);
    assert.equal("agentCaption" in request, false);

    const created = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: null,
      request
    });
    assert.equal(created.request.agentCaption, undefined);

    const reread = getStage2Run(created.runId);
    assert.ok(reread);
    assert.equal(reread?.request.agentCaption, undefined);
  });
});
