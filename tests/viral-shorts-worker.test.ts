import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Step2PickCaption } from "../app/components/Step2PickCaption";
import type { Stage2Response, Stage2RunSummary } from "../app/components/types";
import {
  createStage2ProgressSnapshot,
  markStage2ProgressStageCompleted,
  markStage2ProgressStageRunning,
  normalizeStage2PromptConfig
} from "../lib/stage2-pipeline";
import {
  issueScopedRequestVersion,
  matchesScopedRequestVersion,
  pickPreferredStage2RunId
} from "../lib/stage2-run-client";
import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  getBundledStage2ExamplesSeed,
  getBundledStage2ExamplesSeedJson,
  resolveStage2ExamplesCorpus,
  Stage2CorpusExample,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "../lib/stage2-channel-config";
import {
  buildPromptPacket,
  resolveStage2PromptTemplate
} from "../lib/viral-shorts-worker/prompts";
import { prepareCodexSchemaTransport } from "../lib/viral-shorts-worker/executor";
import {
  buildVideoContext,
  ViralShortsWorkerService
} from "../lib/viral-shorts-worker/service";
import type { JsonStageExecutor } from "../lib/viral-shorts-worker/executor";

function nowIso(): string {
  return new Date().toISOString();
}

function makeExample(input: {
  id: string;
  ownerChannelId: string;
  ownerChannelName: string;
  title: string;
  clipType?: string;
  overlayTop?: string;
  overlayBottom?: string;
  whyItWorks?: string[];
  qualityScore?: number | null;
}): Stage2CorpusExample {
  return {
    id: input.id,
    ownerChannelId: input.ownerChannelId,
    ownerChannelName: input.ownerChannelName,
    sourceChannelId: input.ownerChannelId,
    sourceChannelName: input.ownerChannelName,
    title: input.title,
    overlayTop: input.overlayTop ?? `${input.title} top`,
    overlayBottom: input.overlayBottom ?? `${input.title} bottom`,
    transcript: `${input.title} transcript`,
    clipType: input.clipType ?? "mechanical_failure",
    whyItWorks: input.whyItWorks ?? ["clear visual hook"],
    qualityScore: input.qualityScore ?? 0.9
  };
}

function toExamplesJson(examples: Stage2CorpusExample[]): string {
  return JSON.stringify(examples, null, 2);
}

function makeCandidate(candidateId: string, angle: string, index: number) {
  return {
    candidate_id: candidateId,
    angle,
    top: `The frame catches the axle snapping sideways ${index}`,
    bottom: `"He knew it was bad," and the whole crowd hears it ${index}`,
    top_ru: `В кадре видно, как мост уходит набок ${index}`,
    bottom_ru: `"Он уже понял, что это конец", и вся толпа это слышит ${index}`,
    rationale: `Candidate ${index} leans into ${angle}.`
  };
}

type ExecutorCall = {
  prompt: string;
  schema: unknown;
  imagePaths?: string[];
  reasoningEffort?: string | null;
};

class QueueExecutor implements JsonStageExecutor {
  readonly calls: ExecutorCall[] = [];

  constructor(private readonly responses: unknown[]) {}

  async runJson<T>(input: {
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T> {
    this.calls.push({
      prompt: input.prompt,
      schema: input.schema,
      imagePaths: input.imagePaths,
      reasoningEffort: input.reasoningEffort ?? null
    });
    if (this.responses.length === 0) {
      throw new Error("No queued executor response.");
    }
    const next = this.responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next as T;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage2-runtime-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousConcurrency = process.env.STAGE2_MAX_CONCURRENT_RUNS;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.STAGE2_MAX_CONCURRENT_RUNS = "4";
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsStage2RuntimeState__?: unknown }).__clipsStage2RuntimeState__;
  delete (globalThis as { __clipsStage2RunProcessorOverride__?: unknown }).__clipsStage2RunProcessorOverride__;

  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    delete (globalThis as { __clipsStage2RuntimeState__?: unknown }).__clipsStage2RuntimeState__;
    delete (globalThis as { __clipsStage2RunProcessorOverride__?: unknown }).__clipsStage2RunProcessorOverride__;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousConcurrency === undefined) {
      delete process.env.STAGE2_MAX_CONCURRENT_RUNS;
    } else {
      process.env.STAGE2_MAX_CONCURRENT_RUNS = previousConcurrency;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await sleep(20);
  }
  throw new Error("Timed out waiting for condition.");
}

function makeRuntimeStage2Response(runId: string, label: string): Stage2Response {
  return {
    source: {
      url: "https://example.com/clip",
      title: `Clip ${label}`,
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0
    },
    output: {
      inputAnalysis: {
        visualAnchors: ["anchor"],
        commentVibe: "observational",
        keyPhraseToAdapt: label
      },
      captionOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        top: `${label} top ${index + 1}`,
        bottom: `"${label}" bottom ${index + 1}`,
        topRu: `${label} верх ${index + 1}`,
        bottomRu: `"${label}" низ ${index + 1}`
      })),
      titleOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `${label.toUpperCase()} ${index + 1}`,
        titleRu: `${label.toUpperCase()} ${index + 1}`
      })),
      finalPick: {
        option: 1,
        reason: `Final pick for ${label}`
      }
    },
    warnings: [],
    stage2Run: {
      runId,
      mode: "manual",
      createdAt: nowIso()
    },
    userInstructionUsed: label
  };
}

function makeBaseChannels() {
  const alphaExamples = [
    makeExample({
      id: "alpha_1",
      ownerChannelId: "alpha",
      ownerChannelName: "Alpha Channel",
      title: "Truck axle snaps in the mud"
    }),
    makeExample({
      id: "alpha_2",
      ownerChannelId: "alpha",
      ownerChannelName: "Alpha Channel",
      title: "Driver keeps rolling after the first wobble"
    })
  ];
  const betaExamples = [
    makeExample({
      id: "beta_1",
      ownerChannelId: "beta",
      ownerChannelName: "Beta Channel",
      title: "Crowd reacts when the wheel folds"
    }),
    makeExample({
      id: "beta_2",
      ownerChannelId: "beta",
      ownerChannelName: "Beta Channel",
      title: "Mechanic points at the exact failure"
    })
  ];
  const targetExamples = [
    makeExample({
      id: "target_1",
      ownerChannelId: "target",
      ownerChannelName: "Target Channel",
      title: "Old pickup bounces into a deep rut"
    })
  ];

  return {
    alphaExamples,
    betaExamples,
    targetExamples,
    workspaceExamples: [...alphaExamples, ...betaExamples, ...targetExamples],
    workspaceExamplesJson: toExamplesJson([...alphaExamples, ...betaExamples, ...targetExamples]),
    allChannels: [
      {
        id: "alpha",
        name: "Alpha Channel",
        examplesJson: toExamplesJson(alphaExamples),
        stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
      },
      {
        id: "beta",
        name: "Beta Channel",
        examplesJson: toExamplesJson(betaExamples),
        stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
      },
      {
        id: "target",
        name: "Target Channel",
        examplesJson: toExamplesJson(targetExamples),
        stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
      }
    ]
  };
}

async function runSuccessfulPipeline(options?: {
  promptConfig?: ReturnType<typeof normalizeStage2PromptConfig>;
  stage2ExamplesConfig?: Stage2ExamplesConfig;
  workspaceStage2ExamplesCorpusJson?: string;
  stage2HardConstraints?: Stage2HardConstraints;
  selectedExampleIds?: string[];
  userInstruction?: string | null;
}) {
  const service = new ViralShortsWorkerService();
  const promptConfig = options?.promptConfig ?? normalizeStage2PromptConfig({});
  const {
    allChannels,
    alphaExamples,
    betaExamples,
    targetExamples,
    workspaceExamplesJson
  } = makeBaseChannels();
  const stage2ExamplesConfig =
    options?.stage2ExamplesConfig ??
    {
      version: 1,
      useWorkspaceDefault: false,
      customExamples: [...alphaExamples, ...betaExamples, ...targetExamples]
    };
  const stage2HardConstraints = options?.stage2HardConstraints ?? DEFAULT_STAGE2_HARD_CONSTRAINTS;
  const channel = {
    id: "target",
    name: "Target Channel",
    username: "target_channel",
    stage2ExamplesConfig,
    stage2HardConstraints
  };
  const resolved = service.resolveExamplesCorpus({
    channel: {
      id: channel.id,
      name: channel.name,
      stage2ExamplesConfig
    },
    workspaceStage2ExamplesCorpusJson:
      options?.workspaceStage2ExamplesCorpusJson ?? workspaceExamplesJson
  });
  const selectedExampleIds =
    options?.selectedExampleIds ?? resolved.corpus.slice(0, Math.min(3, resolved.corpus.length)).map((item) => item.id);
  const rankedAngles = [
    { angle: "payoff_reveal", score: 9.4, why: "Visible mechanical payoff is immediate." },
    { angle: "shared_experience", score: 8.7, why: "Audience reaction makes the failure land." },
    { angle: "competence_process", score: 7.9, why: "There is enough detail to narrate the sequence." }
  ];
  const writerCandidates = Array.from({ length: 8 }, (_, index) =>
    makeCandidate(`cand_${index + 1}`, rankedAngles[index % rankedAngles.length]!.angle, index + 1)
  );
  const rewrittenCandidates = writerCandidates.map((candidate, index) => ({
    ...candidate,
    top: `The frame catches the axle twisting harder ${index + 1}`,
    rationale: `Rewrite ${index + 1} sharpened the visual hook.`
  }));
  const executor = new QueueExecutor([
    {
      visual_anchors: ["axle swings sideways", "mud kicks up", "driver leans forward"],
      specific_nouns: ["pickup", "axle", "rut", "wheel"],
      visible_actions: ["bucks through the rut", "axle twists sideways", "mud kicks up"],
      subject: "old pickup",
      setting: "muddy field",
      first_seconds_signal: "The truck lunges into the rut and the axle already looks wrong.",
      stakes: ["the truck may break completely", "everyone sees it happen"],
      payoff: "the wheel almost folds under the truck",
      core_trigger: "the axle visibly gives way while the truck is still under load",
      human_stake: "everyone watching knows the driver is about to pay for one more push",
      narrative_frame: "a real mechanical failure that feels inevitable once you notice it",
      why_viewer_cares: "the clip turns a common bad decision into an immediate visible payoff",
      best_bottom_energy: "dry humor",
      comment_vibe: "dry reaction",
      slang_to_adapt: ["cooked"],
      hidden_detail: "Several viewers noticed the axle was already bent before the last push.",
      generic_risks: ["calling it just a tool failure", "describing it as vague chaos"],
      raw_summary: "An old pickup bucks through a muddy rut until the axle twists sideways."
    },
    {
      clip_type: "mechanical_failure",
      primary_angle: "payoff_reveal",
      secondary_angles: ["shared_experience", "competence_process"],
      selected_example_ids: selectedExampleIds,
      rejected_example_ids: ["beta_2"],
      selection_rationale: "These examples match the visible failure and the grounded crowd reaction.",
      writer_brief: "Lead with the axle twisting sideways, then land the crowd reaction in plain language.",
      confidence: 0.86
    },
    writerCandidates,
    writerCandidates.map((candidate, index) => ({
        candidate_id: candidate.candidate_id,
        scores: {
          visual_anchor: 9 - index * 0.1,
          hook_strength: 8.5 - index * 0.1
        },
        total: 9 - index * 0.2,
        issues: [],
        keep: true
      })),
    rewrittenCandidates,
    {
      final_candidates: ["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"],
      final_pick: "cand_2",
      rationale: "Candidate 2 has the cleanest hook-to-quote transition."
    },
    Array.from({ length: 5 }, (_, index) => ({
      title_id: `title_${index + 1}`,
      title: `HOW AXLE FAILS ${index + 1}`,
      title_ru: `КАК ЛОМАЕТСЯ МОСТ ${index + 1}`,
      rationale: `Title ${index + 1} leans into the failure mystery.`
    }))
  ]);
  const progressEvents: Array<{ stageId: string; state: string; detail: string | null | undefined }> = [];
  const videoContext = buildVideoContext({
    sourceUrl: "https://example.com/short",
    title: "Old pickup bucks through a muddy rut",
    description: "The axle starts twisting while the crowd sees the truck sink sideways.",
    transcript: "The driver tries one more time and the wheel almost folds under him.",
    comments: [
      {
        author: "user1",
        likes: 12,
        text: "That axle was cooked before he even hit the rut."
      }
    ],
    frameDescriptions: ["mud splashes around the tire", "axle leans hard to the left"],
    userInstruction: options?.userInstruction ?? "Keep it grounded and avoid slang overload."
  });

  const result = await service.runPipeline({
    channel,
    workspaceStage2ExamplesCorpusJson:
      options?.workspaceStage2ExamplesCorpusJson ?? workspaceExamplesJson,
    videoContext,
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    promptConfig,
    onProgress: async (event) => {
      progressEvents.push({
        stageId: event.stageId,
        state: event.state,
        detail: event.detail ?? null
      });
    }
  });

  return {
    service,
    promptConfig,
    channel,
    allChannels,
    videoContext,
    executor,
    progressEvents,
    result
  };
}

test("workspace default corpus uses the workspace corpus instead of per-channel legacy examplesJson", () => {
  const { workspaceExamples, workspaceExamplesJson } = makeBaseChannels();
  const resolved = resolveStage2ExamplesCorpus({
    channel: {
      id: "target",
      name: "Target Channel",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
    },
    workspaceStage2ExamplesCorpusJson: workspaceExamplesJson
  });

  assert.equal(resolved.source, "workspace_default");
  assert.equal(resolved.workspaceCorpusCount, workspaceExamples.length);
  assert.equal(resolved.corpus.length, workspaceExamples.length);
  assert.deepEqual(
    resolved.corpus.slice(0, 3).map((example) => example.title),
    workspaceExamples.slice(0, 3).map((example: Stage2CorpusExample) => example.title)
  );
});

test("channel custom corpus replaces the workspace default corpus for the channel", () => {
  const { workspaceExamplesJson, workspaceExamples } = makeBaseChannels();
  const customExamples = [
    makeExample({
      id: "manual_1",
      ownerChannelId: "target",
      ownerChannelName: "Target Channel",
      title: "Only this curated example should be used"
    })
  ];
  const resolved = resolveStage2ExamplesCorpus({
    channel: {
      id: "target",
      name: "Target Channel",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: false,
        customExamples
      }
    },
    workspaceStage2ExamplesCorpusJson: workspaceExamplesJson
  });

  assert.equal(resolved.source, "channel_custom");
  assert.equal(resolved.workspaceCorpusCount, workspaceExamples.length);
  assert.deepEqual(
    resolved.corpus.map((example) => example.id),
    ["manual_1"]
  );
});

test("new channels no longer auto-populate a viral worker profile", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Simplified",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    assert.equal(owner.workspace.stage2ExamplesCorpusJson, getBundledStage2ExamplesSeedJson());

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Fresh Channel",
      username: "fresh_channel"
    });

    assert.equal(channel.stage2WorkerProfileId, null);
    assert.equal(channel.stage2ExamplesConfig.useWorkspaceDefault, true);
    assert.equal(channel.systemPrompt, "");
    assert.equal(channel.descriptionPrompt, "");
  });
});

test("existing workspace access seeds the workspace default corpus from bundled examples", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const { getDb, newId, nowIso } = await import("../lib/db/client");
    const teamStore = await import("../lib/team-store");
    const db = getDb();
    const stamp = nowIso();
    const workspaceId = newId();

    db.prepare(
      "INSERT INTO workspaces (id, name, slug, stage2_examples_corpus_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(workspaceId, "Legacy Workspace", "legacy-workspace", "", stamp, stamp);

    const corpusJson = teamStore.getWorkspaceStage2ExamplesCorpusJson(workspaceId);
    assert.equal(corpusJson, getBundledStage2ExamplesSeedJson());
  });
});

test("workspace corpus update becomes the effective default corpus for Stage 2 runtime", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Workspace Corpus Update",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const customWorkspaceExamples = [
      makeExample({
        id: "workspace_custom_1",
        ownerChannelId: "workspace-default",
        ownerChannelName: "Workspace default",
        title: "Workspace-level corpus example"
      })
    ];

    teamStore.updateWorkspaceStage2ExamplesCorpusJson(
      owner.workspace.id,
      JSON.stringify(customWorkspaceExamples, null, 2)
    );

    const service = new ViralShortsWorkerService();
    const resolved = service.resolveExamplesCorpus({
      channel: {
        id: "target",
        name: "Target Channel",
        stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
      },
      workspaceStage2ExamplesCorpusJson:
        teamStore.getWorkspaceStage2ExamplesCorpusJson(owner.workspace.id)
    });

    assert.equal(resolved.source, "workspace_default");
    assert.deepEqual(resolved.corpus.map((example) => example.id), ["workspace_custom_1"]);
  });
});

test("selector prompt is LLM-driven and receives the active examples corpus plus per-stage prompt config", async () => {
  const promptConfig = normalizeStage2PromptConfig({
    stages: {
      selector: {
        prompt:
          "Custom selector template: inspect available_examples carefully and choose ids from them only.",
        reasoningEffort: "high"
      },
      writer: {
        prompt: "Custom writer template: stay concrete and grounded.",
        reasoningEffort: "x-high"
      }
    }
  });

  const { executor, result } = await runSuccessfulPipeline({ promptConfig });
  const selectorCall = executor.calls[1];
  const writerCall = executor.calls[2];

  assert.ok(selectorCall);
  assert.match(selectorCall!.prompt, /Custom selector template/);
  assert.match(selectorCall!.prompt, /availableExamples/);
  assert.match(selectorCall!.prompt, /Truck axle snaps in the mud/);
  assert.match(selectorCall!.prompt, /Crowd reacts when the wheel folds/);
  assert.ok(!/retrieval stage role/i.test(selectorCall!.prompt));
  assert.equal(selectorCall!.reasoningEffort, "high");
  assert.ok(writerCall);
  assert.match(writerCall!.prompt, /Custom writer template/);
  assert.equal(writerCall!.reasoningEffort, "x-high");
  assert.equal(
    result.diagnostics.effectivePrompting.promptStages.find((stage) => stage.stageId === "selector")
      ?.configuredPrompt,
    "Custom selector template: inspect available_examples carefully and choose ids from them only."
  );
});

test("executor wraps non-object root schemas for Codex transport and unwraps the result payload", () => {
  const transport = prepareCodexSchemaTransport({
    prompt: "Return strict JSON array.",
    schema: {
      type: ["array", "object"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["value"],
        properties: {
          value: { type: "string" },
          note: { type: "string" }
        }
      }
    }
  });

  assert.deepEqual(transport.schema, {
    type: "object",
    additionalProperties: false,
    required: ["result"],
    properties: {
      result: {
        type: ["array", "object"],
        items: {
          type: "object",
          additionalProperties: false,
          required: ["value", "note"],
          properties: {
            value: { type: "string" },
            note: { type: ["string", "null"] }
          }
        }
      }
    }
  });
  assert.match(transport.prompt, /single JSON object with exactly one key: "result"/);
  assert.deepEqual(transport.unwrap({ result: [{ value: "ok" }] }), [{ value: "ok" }]);
});

test("executor strictifies object schemas so every property is required for Codex structured output", () => {
  const transport = prepareCodexSchemaTransport({
    prompt: "Return strict JSON object.",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "string" },
        meta: {
          type: "object",
          additionalProperties: false,
          required: ["label"],
          properties: {
            label: { type: "string" },
            optionalScore: { type: "number" }
          }
        }
      }
    }
  });

  assert.deepEqual(transport.schema, {
    type: "object",
    additionalProperties: false,
    required: ["id", "meta"],
    properties: {
      id: { type: "string" },
      meta: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["label", "optionalScore"],
        properties: {
          label: { type: "string" },
          optionalScore: { type: ["number", "null"] }
        }
      }
    }
  });
});

test("stage 2 pipeline returns a shortlist for human pick using selector-chosen examples", async () => {
  const { progressEvents, result } = await runSuccessfulPipeline();
  const runningStages = progressEvents
    .filter((event) => event.state === "running")
    .map((event) => event.stageId);

  assert.deepEqual(runningStages, [
    "analyzer",
    "selector",
    "writer",
    "critic",
    "rewriter",
    "finalSelector",
    "titles"
  ]);
  assert.ok(!runningStages.includes("retrieval"));
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.output.titleOptions.length, 5);
  assert.equal(result.output.finalPick.option, 2);
  assert.equal(result.output.pipeline.mode, "codex_pipeline");
  assert.equal(result.output.pipeline.availableExamplesCount, 5);
  assert.equal(result.output.pipeline.selectedExamplesCount, 3);
  assert.equal(result.diagnostics.examples.activeCorpusCount, 5);
  assert.equal(result.diagnostics.examples.selectedExamples.length, 3);
  assert.deepEqual(
    result.diagnostics.examples.selectedExamples.map((example) => example.title),
    [
      "Truck axle snaps in the mud",
      "Driver keeps rolling after the first wobble",
      "Crowd reacts when the wheel folds"
    ]
  );
});

test("prompt config exposes one direct per-stage prompt and reasoning mode", () => {
  const config = normalizeStage2PromptConfig({
    stages: {
      writer: {
        prompt: "Writer override template",
        reasoningEffort: "medium"
      }
    }
  });

  const resolved = resolveStage2PromptTemplate("writer", config);
  assert.equal(resolved.configuredPrompt, "Writer override template");
  assert.equal(resolved.reasoningEffort, "medium");
  assert.equal(resolved.isCustomPrompt, true);
});

test("seo prompt is part of the same direct per-stage prompt model", () => {
  const config = normalizeStage2PromptConfig({
    stages: {
      seo: {
        prompt: "Custom SEO template",
        reasoningEffort: "high"
      }
    }
  });

  const resolved = resolveStage2PromptTemplate("seo", config);
  assert.equal(resolved.configuredPrompt, "Custom SEO template");
  assert.equal(resolved.reasoningEffort, "high");
  assert.equal(resolved.isCustomPrompt, true);
});

test("legacy stage prompt configs still migrate into the new direct prompt field", () => {
  const config = normalizeStage2PromptConfig({
    stages: {
      writer: {
        templateOverride: "Writer override template",
        guidance: "Legacy note from older config"
      }
    }
  });

  const resolved = resolveStage2PromptTemplate("writer", config);
  assert.match(resolved.configuredPrompt, /Writer override template/);
  assert.match(resolved.configuredPrompt, /Legacy note from older config/);
  assert.equal(resolved.isCustomPrompt, true);
});

test("buildPromptPacket keeps the selector stage as a real prompt stage with active corpus context", () => {
  const service = new ViralShortsWorkerService();
  const { alphaExamples, betaExamples, targetExamples, workspaceExamplesJson } = makeBaseChannels();
  const packet = service.buildPromptPacket({
    channel: {
      id: "target",
      name: "Target Channel",
      username: "target_channel",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: false,
        customExamples: [...alphaExamples, ...betaExamples, ...targetExamples]
      },
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: workspaceExamplesJson,
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/short",
      title: "Old pickup bucks through a muddy rut",
      description: "The axle starts twisting while the crowd sees the truck sink sideways.",
      comments: [
        {
          author: "viewer",
          likes: 4,
          text: "That axle was cooked."
        }
      ],
      frameDescriptions: ["axle leans hard"]
    }),
    promptConfig: normalizeStage2PromptConfig({})
  });

  assert.ok(packet.prompts.selector.length > 0);
  assert.match(packet.prompts.selector, /selected_example_ids/);
  assert.match(packet.prompts.selector, /primary_angle/);
  assert.match(packet.prompts.selector, /availableExamples/);
  assert.equal(packet.context.availableExamples?.length, 5);
  assert.ok(packet.context.selectorOutput.selectedExampleIds?.length);
});

test("default prompt templates expose the new analyzer and selector contracts", () => {
  const analyzerResolved = resolveStage2PromptTemplate("analyzer", normalizeStage2PromptConfig({}));
  const selectorResolved = resolveStage2PromptTemplate("selector", normalizeStage2PromptConfig({}));
  const writerResolved = resolveStage2PromptTemplate("writer", normalizeStage2PromptConfig({}));
  const rewriterResolved = resolveStage2PromptTemplate("rewriter", normalizeStage2PromptConfig({}));
  const titlesResolved = resolveStage2PromptTemplate("titles", normalizeStage2PromptConfig({}));
  const seoResolved = resolveStage2PromptTemplate("seo", normalizeStage2PromptConfig({}));

  assert.match(analyzerResolved.defaultPrompt, /specific_nouns/);
  assert.match(analyzerResolved.defaultPrompt, /visible_actions/);
  assert.match(analyzerResolved.defaultPrompt, /core_trigger/);
  assert.match(analyzerResolved.defaultPrompt, /best_bottom_energy/);
  assert.match(selectorResolved.defaultPrompt, /primary_angle/);
  assert.match(selectorResolved.defaultPrompt, /selection_rationale/);
  assert.match(writerResolved.defaultPrompt, /Context Compression Rule/);
  assert.match(writerResolved.defaultPrompt, /Must explain why the viewer should care/);
  assert.match(writerResolved.defaultPrompt, /top_ru/);
  assert.match(writerResolved.defaultPrompt, /bottom_ru/);
  assert.match(rewriterResolved.defaultPrompt, /top_ru/);
  assert.match(rewriterResolved.defaultPrompt, /bottom_ru/);
  assert.match(titlesResolved.defaultPrompt, /title_ru/);
  assert.match(titlesResolved.defaultPrompt, /real Russian/);
  assert.match(seoResolved.defaultPrompt, /Search terms and topics covered:/);
  assert.match(seoResolved.defaultPrompt, /Exactly 17 tags/);
});

test("stage 2 ui surfaces active corpus and selector picks instead of profile or hot-pool internals", async () => {
  const { result } = await runSuccessfulPipeline();
  let progress = createStage2ProgressSnapshot("run_ui");
  for (const stageId of ["analyzer", "selector", "writer", "critic", "rewriter", "finalSelector", "titles", "seo"] as const) {
    progress = markStage2ProgressStageRunning(progress, stageId, {
      detail: `${stageId} running`
    });
    progress = markStage2ProgressStageCompleted(progress, stageId, {
      detail: `${stageId} done`
    });
  }

  const stage2: Stage2Response = {
    source: {
      url: "https://example.com/short",
      title: "Old pickup bucks through a muddy rut",
      totalComments: 1,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 1
    },
    output: result.output,
    warnings: result.warnings,
    diagnostics: result.diagnostics,
    progress,
    stage2Run: {
      runId: "run_ui",
      mode: "manual",
      createdAt: nowIso()
    }
  };

  const html = renderToStaticMarkup(
    React.createElement(Step2PickCaption, {
      channelName: "Target Channel",
      channelUsername: "target_channel",
      stage2,
      progress,
      stageCreatedAt: nowIso(),
      commentsAvailable: true,
      instruction: "",
      runs: [
        {
          runId: "run_ui",
          chatId: "chat_1",
          channelId: "target",
          sourceUrl: "https://example.com/short",
          userInstruction: null,
          mode: "manual",
          status: "completed",
          progress,
          errorMessage: null,
          hasResult: true,
          createdAt: nowIso(),
          startedAt: nowIso(),
          updatedAt: nowIso(),
          finishedAt: nowIso()
        }
      ],
      selectedRunId: "run_ui",
      currentRunStatus: "completed",
      currentRunError: null,
      canRunStage2: true,
      runBlockedReason: null,
      isLaunching: false,
      isRunning: false,
      expectedDurationMs: 40_000,
      elapsedMs: 12_000,
      selectedOption: 2,
      selectedTitleOption: 1,
      onInstructionChange: () => undefined,
      onRunStage2: () => undefined,
      onSelectRun: () => undefined,
      onSelectOption: () => undefined,
      onSelectTitleOption: () => undefined,
      onCopy: () => undefined
    })
  );

  assert.match(html, /Как этот run реально устроен/);
  assert.match(html, /Active corpus \+ selector picks/);
  assert.match(html, /selector picked 3/);
  assert.match(html, /Target Channel/);
  assert.match(html, /Truck axle snaps in the mud/);
  assert.match(html, /Selector rationale/);
  assert.ok(!/hot pool/i.test(html));
  assert.ok(!/stable \+ hot \+ anti/i.test(html));
});

test("legacy diagnostics payload from older runs does not crash the Stage 2 UI", () => {
  const stage2: Stage2Response = {
    source: {
      url: "https://example.com/short",
      title: "Legacy run",
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0
    },
    output: {
      inputAnalysis: {
        visualAnchors: ["anchor"],
        commentVibe: "dry",
        keyPhraseToAdapt: "legacy"
      },
      captionOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        top: `legacy top ${index + 1}`,
        bottom: `"legacy" bottom ${index + 1}`,
        topRu: `legacy верх ${index + 1}`,
        bottomRu: `"legacy" низ ${index + 1}`
      })),
      titleOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Legacy ${index + 1}`,
        titleRu: `Legacy ${index + 1}`
      })),
      finalPick: {
        option: 1,
        reason: "legacy winner"
      }
    },
    warnings: [],
    diagnostics: {
      profile: {
        profileId: "science_snack",
        name: "Science Snack"
      },
      selection: {
        clipType: "engineering_oddity",
        rankedAngles: [{ angle: "visual_payoff", score: 9.1, why: "best fit" }],
        writerBrief: "Stay grounded."
      },
      effectivePrompting: {
        promptStages: [
          {
            stageId: "writer",
            label: "Writer",
            stageType: "llm_prompt",
            defaultTemplate: "writer default",
            channelOverride: null,
            effectiveTemplate: "writer default",
            promptText: "writer prompt",
            promptChars: 42,
            usesImages: false,
            summary: "writer stage"
          }
        ]
      },
      retrieval: {
        stableExamples: [
          {
            sourceChannelId: "alpha",
            sourceChannelName: "Alpha Channel",
            title: "Legacy stable example",
            clipType: "engineering_oddity",
            overlayTop: "legacy top",
            overlayBottom: "legacy bottom",
            whyItWorks: ["legacy why"]
          }
        ],
        hotExamples: [],
        antiExamples: []
      }
    } as never,
    stage2Run: {
      runId: "legacy_run",
      mode: "manual",
      createdAt: nowIso()
    }
  };

  const html = renderToStaticMarkup(
    React.createElement(Step2PickCaption, {
      channelName: "Legacy Channel",
      channelUsername: "legacy_channel",
      stage2,
      progress: null,
      stageCreatedAt: nowIso(),
      commentsAvailable: true,
      instruction: "",
      runs: [],
      selectedRunId: null,
      currentRunStatus: null,
      currentRunError: null,
      canRunStage2: true,
      runBlockedReason: null,
      isLaunching: false,
      isRunning: false,
      expectedDurationMs: 40_000,
      elapsedMs: 12_000,
      selectedOption: 1,
      selectedTitleOption: 1,
      onInstructionChange: () => undefined,
      onRunStage2: () => undefined,
      onSelectRun: () => undefined,
      onSelectOption: () => undefined,
      onSelectTitleOption: () => undefined,
      onCopy: () => undefined
    })
  );

  assert.match(html, /Science Snack|Legacy Channel/);
  assert.match(html, /Legacy stable example/);
  assert.match(html, /Effective prompts/);
});

test("pickPreferredStage2RunId reconnects the UI to the active durable run first", () => {
  const runs: Stage2RunSummary[] = [
    {
      runId: "run_done",
      chatId: "chat_1",
      channelId: "target",
      sourceUrl: "https://example.com/done",
      userInstruction: null,
      mode: "manual",
      status: "completed",
      progress: createStage2ProgressSnapshot("run_done"),
      errorMessage: null,
      hasResult: true,
      createdAt: nowIso(),
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: nowIso()
    },
    {
      runId: "run_active",
      chatId: "chat_1",
      channelId: "target",
      sourceUrl: "https://example.com/active",
      userInstruction: null,
      mode: "manual",
      status: "running",
      progress: createStage2ProgressSnapshot("run_active"),
      errorMessage: null,
      hasResult: false,
      createdAt: nowIso(),
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finishedAt: null
    }
  ];

  assert.equal(pickPreferredStage2RunId(runs, null), "run_active");
  assert.equal(pickPreferredStage2RunId(runs, "run_done"), "run_done");
});

test("scoped Stage 2 request versions do not let one chat invalidate another chat response", () => {
  const first = issueScopedRequestVersion({}, "chat_a");
  const second = issueScopedRequestVersion(first.nextVersions, "chat_b");
  const third = issueScopedRequestVersion(second.nextVersions, "chat_a");

  assert.equal(first.version, 1);
  assert.equal(second.version, 1);
  assert.equal(third.version, 2);
  assert.equal(matchesScopedRequestVersion(third.nextVersions, "chat_a", first.version), false);
  assert.equal(matchesScopedRequestVersion(third.nextVersions, "chat_b", second.version), true);
  assert.equal(matchesScopedRequestVersion(third.nextVersions, "chat_a", third.version), true);
});

test("stage 2 runtime keeps parallel runs isolated and durable across reload-style rereads", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const runtime = await import("../lib/stage2-run-runtime");
    const store = await import("../lib/stage2-progress-store");
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    const promptConfig = normalizeStage2PromptConfig({});
    let activeCount = 0;
    let maxActiveCount = 0;

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Runtime",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Parallel Channel",
      username: "parallel_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/parallel-runtime-check",
      channel.id
    );

    runtime.setStage2RunProcessorForTests(async (run) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);

      try {
        store.markStage2RunStageRunning(run.runId, "analyzer", {
          detail: `analyzer ${run.userInstruction ?? run.runId}`
        });
        await sleep(40);
        store.markStage2RunStageCompleted(run.runId, "analyzer", {
          detail: "analyzer done"
        });
        store.markStage2RunStageRunning(run.runId, "writer", {
          detail: `writer ${run.userInstruction ?? run.runId}`
        });
        await sleep(80);
        store.markStage2RunStageCompleted(run.runId, "writer", {
          detail: "writer done"
        });
        store.markStage2RunStageRunning(run.runId, "finalSelector", {
          detail: "final selector"
        });
        await sleep(30);
        store.markStage2RunStageCompleted(run.runId, "finalSelector", {
          detail: "shortlist ready"
        });
        return makeRuntimeStage2Response(run.runId, run.userInstruction ?? run.runId);
      } finally {
        activeCount -= 1;
      }
    });

    try {
      const runs = Array.from({ length: 4 }, (_, index) =>
        runtime.enqueueAndScheduleStage2Run({
          workspaceId: owner.workspace.id,
          creatorUserId: owner.user.id,
          chatId: chat.id,
          request: {
            sourceUrl: `https://example.com/clip-${index + 1}`,
            userInstruction: `instruction ${index + 1}`,
            mode: "manual",
            channel: {
              id: channel.id,
              name: channel.name,
              username: channel.username,
              descriptionPrompt: "",
              examplesJson: channel.examplesJson,
              stage2WorkerProfileId: null,
              stage2ExamplesConfig: channel.stage2ExamplesConfig,
              stage2HardConstraints: channel.stage2HardConstraints,
              stage2PromptConfig: promptConfig
            }
          }
        })
      );

      await waitFor(() =>
        runs.every((run) => store.getStage2Run(run.runId)?.status === "completed")
      );

      assert.ok(maxActiveCount >= 2);

      delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
      const reloadedRuns = store.listStage2RunsForChat(chat.id, owner.workspace.id, 10);
      assert.equal(reloadedRuns.length, 4);

      const instructionSet = new Set<string>();
      for (const run of reloadedRuns) {
        assert.equal(run.status, "completed");
        assert.equal(run.snapshot.status, "completed");
        assert.ok(run.snapshot.finishedAt);
        const result = run.resultData as Stage2Response | null;
        assert.ok(result);
        assert.equal(result?.output.captionOptions.length, 5);
        assert.ok(result?.stage2Run?.runId);
        if (result?.userInstructionUsed) {
          instructionSet.add(result.userInstructionUsed);
        }
      }

      assert.equal(instructionSet.size, 4);
    } finally {
      runtime.setStage2RunProcessorForTests(null);
    }
  });
});

test("failed stage 2 run remains inspectable after reload-style DB reopen", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const store = await import("../lib/stage2-progress-store");
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    const promptConfig = normalizeStage2PromptConfig({});
    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Failure",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Failure Channel",
      username: "failure_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/failure-runtime-check",
      channel.id
    );
    const run = store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: "https://example.com/failure",
        userInstruction: "force failure",
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          descriptionPrompt: "",
          examplesJson: channel.examplesJson,
          stage2WorkerProfileId: null,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints,
          stage2PromptConfig: promptConfig
        }
      }
    });

    store.markStage2RunStageRunning(run.runId, "writer", {
      detail: "Writing shortlist."
    });
    store.markStage2RunStageFailed(run.runId, "writer", "writer timeout");

    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    const reloaded = store.getStage2Run(run.runId);
    assert.equal(reloaded?.status, "failed");
    assert.equal(reloaded?.errorMessage, "writer timeout");
    assert.equal(reloaded?.snapshot.activeStageId, "writer");
    assert.match(reloaded?.snapshot.error ?? "", /writer timeout/);
    assert.equal(
      store.listStage2RunsForChat(chat.id, owner.workspace.id, 10)[0]?.runId,
      run.runId
    );
  });
});

test("running stage 2 run is re-queued after process restart and completes on the next runtime boot", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const runtime = await import("../lib/stage2-run-runtime");
    const store = await import("../lib/stage2-progress-store");
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");
    const promptConfig = normalizeStage2PromptConfig({});
    let observedRecoveredSnapshot = false;

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Stage 2 Recovery",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Recovery Channel",
      username: "recovery_channel"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/shorts/recovery-runtime-check",
      channel.id
    );
    const run = store.createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      chatId: chat.id,
      request: {
        sourceUrl: "https://example.com/recovery",
        userInstruction: "recover me",
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          descriptionPrompt: "",
          examplesJson: channel.examplesJson,
          stage2WorkerProfileId: null,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints,
          stage2PromptConfig: promptConfig
        }
      }
    });

    store.markStage2RunStageRunning(run.runId, "writer", {
      detail: "Writing before restart."
    });

    delete (globalThis as { __clipsStage2RuntimeState__?: unknown }).__clipsStage2RuntimeState__;

    runtime.setStage2RunProcessorForTests(async (claimedRun) => {
      const recovered = store.getStage2Run(claimedRun.runId);
      assert.equal(recovered?.status, "running");
      assert.equal(
        recovered?.snapshot.steps.find((step) => step.id === "writer")?.state,
        "pending"
      );
      assert.match(
        recovered?.snapshot.steps.find((step) => step.id === "analyzer")?.detail ?? "",
        /Recovered after process restart/
      );
      observedRecoveredSnapshot = true;

      store.markStage2RunStageRunning(claimedRun.runId, "analyzer", {
        detail: "Recovered analyzer rerun."
      });
      await sleep(25);
      store.markStage2RunStageCompleted(claimedRun.runId, "analyzer", {
        detail: "Recovered analyzer done."
      });
      store.markStage2RunStageRunning(claimedRun.runId, "finalSelector", {
        detail: "Recovered shortlist."
      });
      await sleep(25);
      store.markStage2RunStageCompleted(claimedRun.runId, "finalSelector", {
        detail: "Recovered shortlist ready."
      });
      return makeRuntimeStage2Response(claimedRun.runId, "recovered");
    });

    try {
      runtime.scheduleStage2RunProcessing();
      await waitFor(() => store.getStage2Run(run.runId)?.status === "completed");

      const recovered = store.getStage2Run(run.runId);
      assert.equal(observedRecoveredSnapshot, true);
      assert.equal(recovered?.status, "completed");
      assert.equal(recovered?.errorMessage, null);
      assert.ok(recovered?.resultData);
      assert.equal(
        (recovered?.resultData as Stage2Response | null)?.userInstructionUsed,
        "recovered"
      );
    } finally {
      runtime.setStage2RunProcessorForTests(null);
    }
  });
});
