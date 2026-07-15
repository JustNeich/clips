import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AGENT_MANUAL_CAPTION_SOURCE,
  AgentManualCaptionValidationError,
  agentManualCaptionIssues,
  buildAgentManualStage2Output,
  parseAgentManualCaption
} from "../lib/stage2-agent-manual";
import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS
} from "../lib/stage2-channel-config";
import {
  createStage2Run,
  getStage2Run,
  type Stage2RunRecord,
  type Stage2RunRequest
} from "../lib/stage2-progress-store";
import { buildStage2RunRequestSnapshot } from "../lib/stage2-run-request";
import { auditStage2WorkerRollout, processStage2Run } from "../lib/stage2-runner";
import { bootstrapOwner } from "../lib/team-store";
import { createChannel } from "../lib/chat-history";
import { getDb } from "../lib/db/client";

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
const validAgentCaption = {
  top: "MEMORY IS THE NEXT AI LEAP",
  bottom: "Altman says the next jump is memory, not raw reasoning power.",
  topRu: "ПАМЯТЬ — СЛЕДУЮЩИЙ СКАЧОК",
  bottomRu: "Олтман говорит о памяти, а не о чистой мощности."
};

test("parseAgentManualCaption requires top and bottom", () => {
  assert.equal(parseAgentManualCaption({ top: "only top" }), null);
  assert.equal(parseAgentManualCaption(null), null);
  const caption = parseAgentManualCaption({ top: "A", bottom: "B", topRu: "А", bottomRu: "Б" });
  assert.ok(caption);
  assert.equal(caption?.top, "A");
  assert.equal(caption?.bottomRu, "Б");
});

test("buildAgentManualStage2Output creates one honest agent_manual result with no examples or platform trace", () => {
  const output = buildAgentManualStage2Output({
    caption: validAgentCaption,
    constraints,
    channel: { id: "channel-1", formatPipeline: "classic_top_bottom" },
    completedAt: "2026-07-14T12:00:00.000Z"
  });

  assert.equal(output.captionOptions.length, 1);
  assert.equal(output.captionOptions[0]?.top, validAgentCaption.top);
  assert.equal(output.captionOptions[0]?.bottom, validAgentCaption.bottom);
  assert.equal(output.captionOptions[0]?.constraintCheck?.passed, true);
  assert.equal(output.finalPick.option, 1);
  assert.equal(output.winner, undefined, "manual output must not invent a platform winner");
  assert.equal(output.pipeline.captionSource, AGENT_MANUAL_CAPTION_SOURCE);
  assert.equal(output.pipeline.execution?.pipelineVersion, "agent_manual");
  assert.equal(output.pipeline.availableExamplesCount, 0);
  assert.equal(output.pipeline.selectedExamplesCount, 0);
  assert.equal(output.pipeline.nativeCaptionV3, undefined);
  assert.deepEqual(output.pipeline.agentManualTrace.examples, {
    loaded: false,
    availableCount: 0,
    selectedCount: 0
  });
  assert.deepEqual(output.pipeline.agentManualTrace.platformGeneration, {
    skipped: true,
    runNativeCaptionPipelineCalled: false
  });
  assert.equal(output.classicOptions?.length, 1);
  assert.equal(output.storyOptions, undefined);
  assert.deepEqual(auditStage2WorkerRollout(output), { ok: true });
});

test("buildAgentManualStage2Output mirrors English into RU and maps story fields without generation", () => {
  const top = "THE SMALL TOOL DID THE LIFTING";
  const bottom = "A tiny utility quietly carried the entire workflow this week.";
  const output = buildAgentManualStage2Output({
    caption: { top, bottom },
    constraints,
    channel: { id: "channel-story", formatPipeline: "story_lead_main_caption" }
  });
  const winningOption = output.captionOptions[0]!;
  // bilingual fields stay present (rollout audit requires them) and are NOT stale.
  assert.equal(winningOption.topRu, top);
  assert.equal(winningOption.bottomRu, bottom);
  assert.equal(output.storyOptions?.[0]?.lead, top);
  assert.equal(output.storyOptions?.[0]?.mainCaption, bottom);
  assert.equal(output.classicOptions, undefined);
});

test("agent_manual trace records the actual Stage 2 feature flag snapshot", () => {
  const previous = process.env.STAGE2_VNEXT_ENABLED;
  process.env.STAGE2_VNEXT_ENABLED = "true";
  try {
    const output = buildAgentManualStage2Output({
      caption: validAgentCaption,
      constraints,
      channel: { id: "channel-1", formatPipeline: "classic_top_bottom" }
    });
    assert.deepEqual(output.pipeline.execution?.featureFlags, {
      STAGE2_VNEXT_ENABLED: true,
      source: "env",
      rawValue: "true"
    });
  } finally {
    if (previous === undefined) {
      delete process.env.STAGE2_VNEXT_ENABLED;
    } else {
      process.env.STAGE2_VNEXT_ENABLED = previous;
    }
  }
});

test("processStage2Run rejects agent_manual regenerate before any regenerate pipeline can start", async () => {
  await assert.rejects(
    processStage2Run({
      mode: "regenerate",
      request: { agentCaption: validAgentCaption }
    } as unknown as Stage2RunRecord),
    /agent_manual caption cannot run in regenerate mode; platform fallback is forbidden/i
  );
});

test("processStage2Run rejects an invalid agent caption before source download", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Agent Manual Ordering",
      email: "owner-agent-manual-ordering@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Agent Manual Ordering",
      username: "agent_manual_ordering"
    });
    const request = buildRequestSnapshotWithCaption(channel.id, channel.username, {
      top: "SHORT",
      bottom: "tiny"
    });
    const run = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: null,
      request
    });
    let downloadCalls = 0;
    await assert.rejects(
      processStage2Run(run, {
        downloadVideoAndMetadata: async () => {
          downloadCalls += 1;
          throw new Error("source download must not run");
        }
      }),
      (error: unknown) => {
        assert.ok(error instanceof AgentManualCaptionValidationError);
        assert.equal(error.code, "agent_manual_caption_invalid");
        return true;
      }
    );
    assert.equal(downloadCalls, 0);
  });
});

test("processStage2Run completes a valid agent_manual handoff without platform generation", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Agent Manual Valid Run",
      email: "owner-agent-manual-valid@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Agent Manual Valid Run",
      username: "agent_manual_valid"
    });
    const run = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: null,
      request: buildRequestSnapshotWithCaption(
        channel.id,
        channel.username,
        validAgentCaption
      )
    });
    let downloadCalls = 0;
    const response = await processStage2Run(run, {
      downloadVideoAndMetadata: async () => {
        downloadCalls += 1;
        return {
          videoPath: "/tmp/agent-manual-source.mp4",
          videoFileName: "agent-manual-source.mp4",
          title: "Agent manual source",
          infoJson: {
            title: "Agent manual source",
            description: "",
            transcript: "",
            comments: []
          },
          videoSizeBytes: 123,
          sourceCacheKey: "agent-manual-source-key",
          sourceCacheState: "hit",
          downloadProvider: "upload",
          primaryProviderError: null,
          downloadFallbackUsed: false,
          providerErrorSummary: null,
          commentsExtractionFallbackUsed: false,
          commentsAcquisition: {
            status: "unavailable",
            provider: null,
            note: null,
            error: null
          }
        };
      }
    });

    assert.equal(downloadCalls, 1);
    assert.equal(
      (response.output.pipeline as { captionSource?: string } | undefined)?.captionSource,
      AGENT_MANUAL_CAPTION_SOURCE
    );
    assert.equal(response.output.pipeline?.execution?.pipelineVersion, "agent_manual");
    assert.equal(response.output.captionOptions.length, 1);
    assert.equal(response.output.captionOptions[0]?.top, validAgentCaption.top);
    assert.equal(response.output.pipeline?.selectedExamplesCount, 0);
    assert.equal(response.output.pipeline?.nativeCaptionV3, undefined);
  });
});

test("agent_manual rollout audit rejects a trace that claims the native pipeline ran", () => {
  const output = buildAgentManualStage2Output({
    caption: validAgentCaption,
    constraints,
    channel: { id: "channel-1", formatPipeline: "classic_top_bottom" }
  });
  (
    output.pipeline.agentManualTrace.platformGeneration as {
      skipped: boolean;
      runNativeCaptionPipelineCalled: boolean;
    }
  ).runNativeCaptionPipelineCalled = true;
  const audit = auditStage2WorkerRollout(output);
  assert.equal(audit.ok, false);
  if (!audit.ok) {
    assert.match(audit.message, /platform generation or examples activity/i);
  }
});

test("agentManualCaptionIssues flags length violations", () => {
  const longBottom = "x".repeat(constraints.bottomLengthMax + 40);
  const issues = agentManualCaptionIssues({ top: "OK LENGTH TOP CAPTION HERE", bottom: longBottom }, constraints);
  assert.ok(issues.some((issue) => issue.includes("BOTTOM length")));
});

test("malformed agentCaption fails on create and persisted read instead of becoming a platform run", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Agent Manual Malformed Payload",
      email: "owner-agent-manual-malformed@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Agent Manual Malformed Payload",
      username: "agent_manual_malformed"
    });
    const validRequest = buildRequestSnapshotWithCaption(
      channel.id,
      channel.username,
      validAgentCaption
    );
    const countRuns = () =>
      (
        getDb()
          .prepare("SELECT COUNT(*) AS count FROM stage2_runs")
          .get() as { count: number }
      ).count;

    const beforeCreate = countRuns();
    assert.throws(
      () =>
        createStage2Run({
          workspaceId: owner.workspace.id,
          creatorUserId: owner.user.id,
          chatId: null,
          request: {
            ...validRequest,
            agentCaption: { top: "MISSING BOTTOM" }
          } as unknown as Stage2RunRequest
        }),
      /Stage 2 request contains malformed agentCaption; platform fallback is forbidden/i
    );
    assert.equal(
      countRuns(),
      beforeCreate,
      "malformed input must fail before a Stage 2 row is inserted"
    );

    const created = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: null,
      request: validRequest
    });
    getDb()
      .prepare("UPDATE stage2_runs SET request_json = ? WHERE run_id = ?")
      .run(
        JSON.stringify({
          ...created.request,
          agentCaption: { top: "MISSING BOTTOM" }
        }),
        created.runId
      );

    assert.throws(
      () => getStage2Run(created.runId),
      /Persisted Stage 2 request contains malformed agentCaption; platform fallback is forbidden/i
    );
  });
});

test("agentCaption survives the createStage2Run DB persist/read round-trip", async () => {
  // Regression: normalizeRequest used to rebuild the request from the persisted
  // JSON without re-reading agentCaption, so saveRecord's read-back silently
  // stripped it and the stage2-runner never entered the isolated manual path.
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
