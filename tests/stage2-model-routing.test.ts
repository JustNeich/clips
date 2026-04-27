import assert from "node:assert/strict";
import test from "node:test";

import type { Stage2Response } from "../app/components/types";
import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS
} from "../lib/stage2-channel-config";
import {
  runQuickRegenerateModel
} from "../lib/stage2-quick-regenerate";
import { runStage2StyleDiscovery } from "../lib/stage2-style-discovery";
import {
  buildVideoContext,
  ViralShortsWorkerService
} from "../lib/viral-shorts-worker/service";
import {
  HybridJsonStageExecutor,
  type JsonStageExecutor
} from "../lib/viral-shorts-worker/executor";

type ExecutorCall = {
  stageId: string;
  model: string | null;
  prompt: string;
  imagePaths: string[];
};

class CaptureQueueExecutor implements JsonStageExecutor {
  readonly calls: ExecutorCall[] = [];

  constructor(private readonly responses: unknown[]) {}

  async runJson<T>(input: {
    stageId: string;
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T> {
    this.calls.push({
      stageId: input.stageId,
      model: input.model ?? null,
      prompt: input.prompt,
      imagePaths: input.imagePaths ?? []
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

function makeCandidate(index: number) {
  return {
    candidate_id: `candidate_${index}`,
    angle: `angle_${index}`,
    top: `Specific grounded top line ${index} keeps the clip concrete and visual.`,
    bottom: `Specific grounded bottom line ${index} keeps the reaction sharp and natural.`,
    top_ru: `Конкретный верх ${index}`,
    bottom_ru: `Конкретный низ ${index}`
  };
}

function makeTranslationEntries(candidateIds: string[]) {
  return candidateIds.map((candidateId, index) => ({
    candidate_id: candidateId,
    top_ru: `Перевод верх ${index + 1}`,
    bottom_ru: `Перевод низ ${index + 1}`
  }));
}

function makeClassicOneShotResponse(prefix = "cand") {
  return {
    formatPipeline: "classic_top_bottom",
    analysis: {
      visual_anchors: [
        "the tool stops mid-action",
        "the room turns toward the pause",
        "the reaction lands before anyone explains it"
      ],
      comment_vibe: "dry impressed side-eye",
      key_phrase_to_adapt: "that pause said enough"
    },
    classicOptions: Array.from({ length: 5 }, (_, index) => ({
      candidate_id: `${prefix}_${index + 1}`,
      top: `That pause makes the whole setup readable before anyone explains the repair ${index + 1}.`,
      bottom: `The room already understood the outcome before the next move arrived ${index + 1}.`,
      retained_handle: index < 2,
      rationale: `Keeps the visual read grounded ${index + 1}.`
    })),
    winner_candidate_id: `${prefix}_1`,
    titles: Array.from({ length: 5 }, (_, index) => ({
      title: `WHY DID THE ROOM FREEZE ${index + 1}`,
      title_ru: `ПОЧЕМУ ВСЕ ЗАМЕРЛИ ${index + 1}`
    }))
  };
}

function makeSeoResponse() {
  return {
    description:
      "Garage bay, no stated speed, mechanic pause, workshop reaction\nThe tool stops before anyone explains the moment, and the room reads the outcome off the silence alone.\nSearch terms and topics covered:\nmechanic pause, garage reaction moment\nHashtags:\n#mechanic, #garage, #shorts",
    tags: "Mechanic, Garage, Reaction"
  };
}

const RELAXED_HARD_CONSTRAINTS = {
  ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
  topLengthMin: 10,
  topLengthMax: 200,
  bottomLengthMin: 10,
  bottomLengthMax: 200
};

function buildBaseStage2Response(): Stage2Response {
  return {
    source: {
      url: "https://example.com/short",
      title: "Base quick regenerate clip",
      totalComments: 1,
      commentsUsedForPrompt: 1,
      topComments: [
        {
          id: "comment_1",
          author: "viewer",
          text: "The whole room is just watching in silence.",
          likes: 12,
          postedAt: null
        }
      ],
      allComments: [
        {
          id: "comment_1",
          author: "viewer",
          text: "The whole room is just watching in silence.",
          likes: 12,
          postedAt: null
        }
      ],
      frameDescriptions: ["frame one", "frame two"]
    },
    output: {
      inputAnalysis: {
        visualAnchors: ["frame one"],
        commentVibe: "dry disbelief",
        keyPhraseToAdapt: "quiet disbelief"
      },
      captionOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        candidateId: `candidate_${index + 1}`,
        angle: `angle_${index + 1}`,
        top: `Specific grounded top line ${index + 1} keeps the clip concrete and visual.`,
        bottom: `Specific grounded bottom line ${index + 1} keeps the reaction sharp and natural.`,
        topRu: `Конкретный верх ${index + 1}`,
        bottomRu: `Конкретный низ ${index + 1}`
      })),
      titleOptions: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        title: `Base title ${index + 1}`,
        titleRu: `Базовый заголовок ${index + 1}`
      })),
      finalPick: {
        option: 1,
        reason: "Base final pick."
      },
      pipeline: {
        channelId: "channel_1",
        mode: "codex_pipeline",
        selectorOutput: {
          clipType: "payoff_reveal",
          primaryAngle: "quiet disbelief",
          secondaryAngles: ["dry_social_read"],
          rankedAngles: [
            {
              angle: "quiet disbelief",
              score: 10,
              why: "Base selector output."
            }
          ],
          coreTrigger: "quiet disbelief",
          humanStake: "why this works at all",
          narrativeFrame: "Base selector frame.",
          whyViewerCares: "Base viewer care.",
          topStrategy: "Base top strategy.",
          bottomEnergy: "Base bottom energy.",
          whyOldV6WouldWorkHere: "Base explanation.",
          failureModes: [],
          writerBrief: "Base writer brief.",
          rationale: "Base selector rationale."
        },
        availableExamplesCount: 0,
        selectedExamplesCount: 0
      }
    },
    seo: null,
    warnings: []
  };
}

test("ViralShortsWorkerService routes per-stage models and only analyzer receives images", async () => {
  const service = new ViralShortsWorkerService();
  const executor = new CaptureQueueExecutor([
    {},
    {},
    {
      candidates: Array.from({ length: 6 }, (_, index) => makeCandidate(index + 1))
    },
    new Error("critic fallback"),
    new Error("rewriter fallback"),
    new Error("final selector fallback"),
    new Error("title fallback")
  ]);

  const result = await service.runPipeline({
    channel: {
      id: "channel_1",
      name: "Channel 1",
      username: "channel_1",
      stage2WorkerProfileId: "stable_social_wave_v1",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/short",
      title: "A grounded clip",
      description: "Description",
      transcript: "Transcript",
      comments: [],
      frameDescriptions: ["frame one", "frame two"],
      userInstruction: "keep it dry"
    }),
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    stageModels: {
      analyzer: "gpt-5.4",
      selector: "gpt-5.3-codex-spark",
      writer: "gpt-5.4-mini",
      critic: "gpt-5.3-codex-spark",
      rewriter: "gpt-5.4-mini",
      finalSelector: "gpt-5.3-codex-spark",
      titles: "gpt-5.4-mini"
    }
  });

  assert.equal(result.output.captionOptions.length, 5);
  assert.deepEqual(
    executor.calls.map((call) => call.model),
    [
      "gpt-5.4",
      "gpt-5.3-codex-spark",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
      "gpt-5.4-mini"
    ]
  );
  assert.deepEqual(executor.calls[0]?.imagePaths, ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"]);
  assert.deepEqual(executor.calls.slice(1).map((call) => call.imagePaths), [[], [], [], [], [], []]);
});

test("runNativeCaptionPipeline routes the prompt-first classic stage and downstream Codex stages", async () => {
  const service = new ViralShortsWorkerService();
  const executor = new CaptureQueueExecutor([
    makeClassicOneShotResponse("cand"),
    makeTranslationEntries(["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"]),
    makeSeoResponse()
  ]);

  const result = await service.runNativeCaptionPipeline({
    channel: {
      id: "channel_1",
      name: "Channel 1",
      username: "channel_1",
      stage2WorkerProfileId: "stable_social_wave_v1",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/short",
      title: "A grounded clip",
      description: "Description",
      transcript: "Transcript",
      comments: [],
      frameDescriptions: ["frame one", "frame two"],
      userInstruction: "keep it dry"
    }),
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    stageModels: {
      classicOneShot: "gpt-5.4",
      captionTranslation: "gpt-5.4-mini",
      seo: "gpt-5.4-mini"
    }
  });

  assert.equal(result.output.pipeline.execution?.pipelineVersion, "native_caption_v3");
  assert.equal(result.output.pipeline.execution?.pathVariant, "classic_one_shot_v1");
  assert.equal(result.output.formatPipeline, "classic_top_bottom");
  assert.equal(result.output.finalists?.length, 5);
  assert.equal(result.output.winner?.candidateId, "cand_1");
  assert.equal(result.output.titleOptions.length, 5);
  assert.equal(result.output.titleOptions[0]?.title, "WHY DID THE ROOM FREEZE 1");
  assert.equal(result.output.titleOptions[0]?.titleRu, "ПОЧЕМУ ВСЕ ЗАМЕРЛИ 1");
  assert.equal(result.seo?.description.includes("Search terms and topics covered:"), true);
  assert.equal(Boolean(result.output.captionOptions[0]?.topRu?.trim()), true);
  assert.equal(Boolean(result.output.titleOptions[0]?.titleRu?.trim()), true);
  assert.deepEqual(
    executor.calls.map((call) => call.model),
    ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-mini"]
  );
  assert.deepEqual(
    executor.calls.map((call) => call.stageId),
    ["classicOneShot", "captionTranslation", "seo"]
  );
  assert.deepEqual(executor.calls[0]?.imagePaths, ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"]);
  assert.deepEqual(executor.calls.slice(1).map((call) => call.imagePaths), [[], []]);
});

test("historical stable_reference_v6 requests still run through active classicOneShot", async () => {
  const service = new ViralShortsWorkerService();
  const executor = new CaptureQueueExecutor([
    makeClassicOneShotResponse("ref"),
    makeTranslationEntries(["ref_1", "ref_2", "ref_3", "ref_4", "ref_5"]),
    makeSeoResponse()
  ]);

  const result = await service.runNativeCaptionPipeline({
    channel: {
      id: "channel_ref",
      name: "Reference Channel",
      username: "reference_channel",
      stage2WorkerProfileId: "stable_reference_v6",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/reference",
      title: "A wrench pause says enough",
      description: "Description",
      transcript: "Transcript",
      comments: [
        {
          author: "viewer",
          likes: 10,
          text: "that pause said enough"
        }
      ],
      frameDescriptions: ["frame one", "frame two"],
      userInstruction: "keep the benchmark density"
    }),
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    stageModels: {
      oneShotReference: "gpt-5.4-mini",
      contextPacket: "gpt-5.4",
      candidateGenerator: "gpt-5.3-codex-spark",
      qualityCourt: "gpt-5.4",
      targetedRepair: "gpt-5.4",
      captionTranslation: "gpt-5.4",
      titleWriter: "gpt-5.3-codex-spark",
      seo: "gpt-5.4-mini"
    }
  });

  assert.equal(result.output.pipeline.execution?.pathVariant, "classic_one_shot_v1");
  assert.equal(result.output.pipeline.workerProfile?.resolvedId, "stable_reference_v7");
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.seo?.tags.includes("Mechanic"), true);
  assert.deepEqual(
    executor.calls.map((call) => call.model),
    ["gpt-5.4-mini", "gpt-5.4", "gpt-5.4-mini"]
  );
  assert.deepEqual(
    executor.calls.map((call) => call.stageId),
    ["classicOneShot", "captionTranslation", "seo"]
  );
  assert.deepEqual(executor.calls[0]?.imagePaths, ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"]);
  assert.deepEqual(executor.calls.slice(1).map((call) => call.imagePaths), [[], []]);
});

test("historical stable_reference_v6_experimental requests do not resurrect the experimental prompt path", async () => {
  const service = new ViralShortsWorkerService();
  const executor = new CaptureQueueExecutor([
    makeClassicOneShotResponse("ref_exp"),
    makeTranslationEntries(["ref_exp_1", "ref_exp_2", "ref_exp_3", "ref_exp_4", "ref_exp_5"]),
    makeSeoResponse()
  ]);

  const result = await service.runNativeCaptionPipeline({
    channel: {
      id: "channel_ref_exp",
      name: "Reference Channel Experimental",
      username: "reference_channel_experimental",
      stage2WorkerProfileId: "stable_reference_v6_experimental",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/reference-experimental",
      title: "A wrench pause says enough",
      description: "",
      transcript: "",
      comments: [
        {
          author: "viewer",
          likes: 10,
          text: "that pause said enough"
        }
      ],
      frameDescriptions: ["frame one", "frame two"],
      userInstruction: "keep the benchmark density"
    }),
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    stageModels: {
      oneShotReference: "gpt-5.4-mini",
      contextPacket: "gpt-5.4",
      candidateGenerator: "gpt-5.3-codex-spark",
      qualityCourt: "gpt-5.4",
      targetedRepair: "gpt-5.4",
      captionTranslation: "gpt-5.4",
      titleWriter: "gpt-5.3-codex-spark",
      seo: "gpt-5.4-mini"
    }
  });

  assert.equal(result.output.pipeline.execution?.pathVariant, "classic_one_shot_v1");
  assert.equal(result.output.pipeline.workerProfile?.resolvedId, "stable_reference_v7");
  assert.deepEqual(
    executor.calls.map((call) => call.model),
    ["gpt-5.4-mini", "gpt-5.4", "gpt-5.4-mini"]
  );
  assert.deepEqual(
    executor.calls.map((call) => call.stageId),
    ["classicOneShot", "captionTranslation", "seo"]
  );
  assert.doesNotMatch(executor.calls[0]?.prompt ?? "", /experimental_contract_json/);
});

test("runQuickRegenerateModel forwards the dedicated regenerate model without images", async () => {
  const executor = new CaptureQueueExecutor([
    {
      options: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        candidate_id: `candidate_${index + 1}`,
        angle: `angle_${index + 1}`,
        top: `New top ${index + 1}`,
        bottom: `New bottom ${index + 1}`,
        top_ru: `Новый верх ${index + 1}`,
        bottom_ru: `Новый низ ${index + 1}`,
        title: `New title ${index + 1}`,
        title_ru: `Новый заголовок ${index + 1}`
      })),
      final_pick_option: 1,
      selection_rationale: "Keep option 1."
    }
  ]);

  await runQuickRegenerateModel({
    stage2: buildBaseStage2Response(),
    channel: {
      id: "channel_1",
      name: "Channel 1",
      username: "channel_1",
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    userInstruction: "make it shorter",
    executor,
    model: "gpt-5.3-codex-spark",
    reasoningEffort: "medium"
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]?.model, "gpt-5.3-codex-spark");
  assert.deepEqual(executor.calls[0]?.imagePaths, []);
});

test("runStage2StyleDiscovery forwards the dedicated multimodal model and reference images", async () => {
  const executor = new CaptureQueueExecutor([
    {
      reference_influence_summary: "Grounded and dry.",
      directions: Array.from({ length: 20 }, (_, index) => ({
        id: `direction_${index + 1}`,
        fitBand: index < 8 ? "core" : index < 16 ? "adjacent" : "exploratory",
        name: `Direction ${index + 1}`,
        description: `Description ${index + 1}`,
        voice: `Voice ${index + 1}`,
        topPattern: `Top ${index + 1}`,
        bottomPattern: `Bottom ${index + 1}`,
        humorLevel: "medium",
        sarcasmLevel: "low",
        warmthLevel: "low",
        insiderDensityLevel: "medium",
        bestFor: `Best ${index + 1}`,
        avoids: `Avoid ${index + 1}`,
        microExample: `Example ${index + 1}`,
        sourceReferenceIds: ["reference_1"],
        internalPromptNotes: `Notes ${index + 1}`,
        axes: {
          humor: 0.4,
          sarcasm: 0.3,
          warmth: 0.2,
          insiderDensity: 0.6,
          intensity: 0.5,
          explanationDensity: 0.4,
          quoteDensity: 0.2,
          topCompression: 0.7
        }
      }))
    }
  ]);

  await runStage2StyleDiscovery({
    executor,
    channelName: "Channel 1",
    username: "channel_1",
    hardConstraints: RELAXED_HARD_CONSTRAINTS,
    referenceLinks: [
      {
        id: "reference_1",
        url: "https://example.com/ref",
        normalizedUrl: "https://example.com/ref",
        title: "Reference",
        description: "Reference description",
        transcriptExcerpt: "Reference transcript",
        commentHighlights: ["comment one"],
        totalCommentCount: 1,
        selectedCommentCount: 1,
        audienceSignalSummary: "Audience signal",
        frameMoments: ["moment one"],
        framesUsed: true,
        sourceHint: "source"
      }
    ],
    imagePaths: ["/tmp/ref-1.jpg", "/tmp/ref-2.jpg"],
    model: "gpt-5.4-mini",
    reasoningEffort: "high"
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]?.model, "gpt-5.4-mini");
  assert.deepEqual(executor.calls[0]?.imagePaths, ["/tmp/ref-1.jpg", "/tmp/ref-2.jpg"]);
});

test("HybridJsonStageExecutor routes prompt-first classic caption generation through Anthropic only", async () => {
  const service = new ViralShortsWorkerService();
  const codexExecutor = new CaptureQueueExecutor([
    makeTranslationEntries(["ref_1", "ref_2", "ref_3", "ref_4", "ref_5"]),
    {
      description:
        "Garage bay, no stated speed, mechanic wrench pause, workshop reaction\nThe wrench stops mid-air before anyone says a word, and the room reads the repair outcome off the silence alone.\nSearch terms and topics covered:\nmechanic wrench pause, garage reaction moment\nHashtags:\n#mechanic, #garage, #shorts",
      tags: "Mechanic, Garage, Reaction"
    }
  ]);
  const anthropicExecutor = new CaptureQueueExecutor([makeClassicOneShotResponse("ref")]);

  const executor = new HybridJsonStageExecutor({
    captionProviderConfig: {
      provider: "anthropic",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    },
    codexExecutor,
    anthropicExecutor,
    openRouterExecutor: null
  });

  const result = await service.runNativeCaptionPipeline({
    channel: {
      id: "channel_ref_hybrid",
      name: "Reference Channel",
      username: "reference_channel",
      stage2WorkerProfileId: "stable_reference_v6",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/reference",
      title: "A wrench pause says enough",
      description: "Description",
      transcript: "Transcript",
      comments: [
        {
          author: "viewer",
          likes: 10,
          text: "that pause said enough"
        }
      ],
      frameDescriptions: ["frame one", "frame two"],
      userInstruction: "keep the benchmark density"
    }),
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    stageModels: {
      oneShotReference: "gpt-5.4-mini",
      contextPacket: "gpt-5.4",
      candidateGenerator: "gpt-5.3-codex-spark",
      qualityCourt: "gpt-5.4",
      targetedRepair: "gpt-5.4",
      captionTranslation: "gpt-5.4",
      titleWriter: "gpt-5.3-codex-spark",
      seo: "gpt-5.4-mini"
    }
  });

  assert.equal(result.output.winner?.candidateId, "ref_1");
  assert.deepEqual(anthropicExecutor.calls.map((call) => call.stageId), ["classicOneShot"]);
  assert.equal(anthropicExecutor.calls[0]?.model, null);
  assert.deepEqual(anthropicExecutor.calls[0]?.imagePaths, ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"]);
  assert.deepEqual(codexExecutor.calls.map((call) => call.stageId), ["captionTranslation", "seo"]);
  assert.deepEqual(codexExecutor.calls.map((call) => call.model), ["gpt-5.4", "gpt-5.4-mini"]);
});

test("HybridJsonStageExecutor keeps prompt-first classic and story one-shots on Codex when provider is Codex", async () => {
  const codexExecutor = new CaptureQueueExecutor(["classic", "story"]);
  const executor = new HybridJsonStageExecutor({
    captionProviderConfig: {
      provider: "codex",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    },
    codexExecutor,
    anthropicExecutor: null,
    openRouterExecutor: null
  });

  await executor.runJson({
    stageId: "classicOneShot",
    prompt: "classic",
    schema: {},
    imagePaths: ["/tmp/classic.jpg"]
  });
  await executor.runJson({
    stageId: "storyOneShot",
    prompt: "story",
    schema: {},
    imagePaths: ["/tmp/story.jpg"]
  });

  assert.deepEqual(codexExecutor.calls.map((call) => call.stageId), [
    "classicOneShot",
    "storyOneShot"
  ]);
});

test("HybridJsonStageExecutor routes prompt-first classic and story one-shots through Anthropic", async () => {
  const codexExecutor = new CaptureQueueExecutor(["codex"]);
  const anthropicExecutor = new CaptureQueueExecutor(["classic", "story"]);
  const executor = new HybridJsonStageExecutor({
    captionProviderConfig: {
      provider: "anthropic",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    },
    codexExecutor,
    anthropicExecutor,
    openRouterExecutor: null
  });

  await executor.runJson({
    stageId: "classicOneShot",
    prompt: "classic",
    schema: {},
    imagePaths: ["/tmp/classic.jpg"]
  });
  await executor.runJson({
    stageId: "storyOneShot",
    prompt: "story",
    schema: {},
    imagePaths: ["/tmp/story.jpg"]
  });

  assert.deepEqual(anthropicExecutor.calls.map((call) => call.stageId), [
    "classicOneShot",
    "storyOneShot"
  ]);
  assert.deepEqual(codexExecutor.calls, []);
});

test("HybridJsonStageExecutor keeps downstream Codex stages while routing prompt-first classic through Anthropic", async () => {
  const service = new ViralShortsWorkerService();
  const codexExecutor = new CaptureQueueExecutor([
    makeTranslationEntries(["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"]),
    makeSeoResponse()
  ]);
  const anthropicExecutor = new CaptureQueueExecutor([makeClassicOneShotResponse("cand")]);

  const executor = new HybridJsonStageExecutor({
    captionProviderConfig: {
      provider: "anthropic",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    },
    codexExecutor,
    anthropicExecutor,
    openRouterExecutor: null
  });

  const result = await service.runNativeCaptionPipeline({
    channel: {
      id: "channel_native_hybrid",
      name: "Channel 1",
      username: "channel_1",
      stage2WorkerProfileId: "stable_social_wave_v1",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/short",
      title: "A grounded clip",
      description: "Description",
      transcript: "Transcript",
      comments: [],
      frameDescriptions: ["frame one", "frame two"],
      userInstruction: "keep it dry"
    }),
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    stageModels: {
      classicOneShot: "gpt-5.4-mini",
      captionTranslation: "gpt-5.4-mini",
      seo: "gpt-5.4-mini"
    }
  });

  assert.equal(result.output.captionOptions.length, 5);
  assert.deepEqual(
    anthropicExecutor.calls.map((call) => call.stageId),
    ["classicOneShot"]
  );
  assert.deepEqual(anthropicExecutor.calls.map((call) => call.model), [null]);
  assert.deepEqual(
    codexExecutor.calls.map((call) => call.stageId),
    ["captionTranslation", "seo"]
  );
  assert.deepEqual(
    codexExecutor.calls.map((call) => call.model),
    ["gpt-5.4-mini", "gpt-5.4-mini"]
  );
});

test("HybridJsonStageExecutor routes quick regenerate through Anthropic only", async () => {
  const codexExecutor = new CaptureQueueExecutor([]);
  const anthropicExecutor = new CaptureQueueExecutor([
    {
      options: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        candidate_id: `candidate_${index + 1}`,
        angle: `angle_${index + 1}`,
        top: `New top ${index + 1}`,
        bottom: `New bottom ${index + 1}`,
        top_ru: `Новый верх ${index + 1}`,
        bottom_ru: `Новый низ ${index + 1}`,
        title: `New title ${index + 1}`,
        title_ru: `Новый заголовок ${index + 1}`
      })),
      final_pick_option: 1,
      selection_rationale: "Keep option 1."
    }
  ]);

  const executor = new HybridJsonStageExecutor({
    captionProviderConfig: {
      provider: "anthropic",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    },
    codexExecutor,
    anthropicExecutor,
    openRouterExecutor: null
  });

  await runQuickRegenerateModel({
    stage2: buildBaseStage2Response(),
    channel: {
      id: "channel_regen_hybrid",
      name: "Channel 1",
      username: "channel_1",
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    userInstruction: "make it shorter",
    executor,
    model: "gpt-5.3-codex-spark",
    reasoningEffort: "medium"
  });

  assert.deepEqual(anthropicExecutor.calls.map((call) => call.stageId), ["regenerate"]);
  assert.equal(anthropicExecutor.calls[0]?.model, null);
  assert.deepEqual(anthropicExecutor.calls[0]?.imagePaths, []);
  assert.equal(codexExecutor.calls.length, 0);
});

test("HybridJsonStageExecutor routes prompt-first classic caption generation through OpenRouter only", async () => {
  const service = new ViralShortsWorkerService();
  const codexExecutor = new CaptureQueueExecutor([
    makeTranslationEntries(["ref_1", "ref_2", "ref_3", "ref_4", "ref_5"]),
    makeSeoResponse()
  ]);
  const openRouterExecutor = new CaptureQueueExecutor([makeClassicOneShotResponse("ref")]);

  const executor = new HybridJsonStageExecutor({
    captionProviderConfig: {
      provider: "openrouter",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    },
    codexExecutor,
    anthropicExecutor: null,
    openRouterExecutor
  });

  const result = await service.runNativeCaptionPipeline({
    channel: {
      id: "channel_ref_openrouter",
      name: "Reference Channel",
      username: "reference_channel",
      stage2WorkerProfileId: "stable_reference_v6",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/reference",
      title: "A wrench pause says enough",
      description: "Description",
      transcript: "Transcript",
      comments: [
        {
          author: "viewer",
          likes: 10,
          text: "that pause said enough"
        }
      ],
      frameDescriptions: ["frame one", "frame two"],
      userInstruction: "keep the benchmark density"
    }),
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    stageModels: {
      oneShotReference: "gpt-5.4-mini",
      contextPacket: "gpt-5.4",
      candidateGenerator: "gpt-5.3-codex-spark",
      qualityCourt: "gpt-5.4",
      targetedRepair: "gpt-5.4",
      captionTranslation: "gpt-5.4",
      titleWriter: "gpt-5.3-codex-spark",
      seo: "gpt-5.4-mini"
    }
  });

  assert.equal(result.output.winner?.candidateId, "ref_1");
  assert.deepEqual(openRouterExecutor.calls.map((call) => call.stageId), ["classicOneShot"]);
  assert.equal(openRouterExecutor.calls[0]?.model, null);
  assert.deepEqual(openRouterExecutor.calls[0]?.imagePaths, ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"]);
  assert.deepEqual(codexExecutor.calls.map((call) => call.stageId), ["captionTranslation", "seo"]);
  assert.deepEqual(codexExecutor.calls.map((call) => call.model), ["gpt-5.4", "gpt-5.4-mini"]);
});

test("HybridJsonStageExecutor routes prompt-first classic and story one-shots through OpenRouter", async () => {
  const codexExecutor = new CaptureQueueExecutor(["codex"]);
  const openRouterExecutor = new CaptureQueueExecutor(["classic", "story"]);
  const executor = new HybridJsonStageExecutor({
    captionProviderConfig: {
      provider: "openrouter",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    },
    codexExecutor,
    anthropicExecutor: null,
    openRouterExecutor
  });

  await executor.runJson({
    stageId: "classicOneShot",
    prompt: "classic",
    schema: {},
    imagePaths: ["/tmp/classic.jpg"]
  });
  await executor.runJson({
    stageId: "storyOneShot",
    prompt: "story",
    schema: {},
    imagePaths: ["/tmp/story.jpg"]
  });

  assert.deepEqual(openRouterExecutor.calls.map((call) => call.stageId), [
    "classicOneShot",
    "storyOneShot"
  ]);
  assert.deepEqual(codexExecutor.calls, []);
});

test("HybridJsonStageExecutor keeps downstream Codex stages while routing prompt-first classic through OpenRouter", async () => {
  const service = new ViralShortsWorkerService();
  const codexExecutor = new CaptureQueueExecutor([
    makeTranslationEntries(["cand_1", "cand_2", "cand_3", "cand_4", "cand_5"]),
    makeSeoResponse()
  ]);
  const openRouterExecutor = new CaptureQueueExecutor([makeClassicOneShotResponse("cand")]);

  const executor = new HybridJsonStageExecutor({
    captionProviderConfig: {
      provider: "openrouter",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    },
    codexExecutor,
    anthropicExecutor: null,
    openRouterExecutor
  });

  const result = await service.runNativeCaptionPipeline({
    channel: {
      id: "channel_native_openrouter",
      name: "Channel 1",
      username: "channel_1",
      stage2WorkerProfileId: "stable_social_wave_v1",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/short",
      title: "A grounded clip",
      description: "Description",
      transcript: "Transcript",
      comments: [],
      frameDescriptions: ["frame one", "frame two"],
      userInstruction: "keep it dry"
    }),
    imagePaths: ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"],
    executor,
    stageModels: {
      classicOneShot: "gpt-5.4-mini",
      captionTranslation: "gpt-5.4-mini",
      seo: "gpt-5.4-mini"
    }
  });

  assert.equal(result.output.captionOptions.length, 5);
  assert.deepEqual(
    openRouterExecutor.calls.map((call) => call.stageId),
    ["classicOneShot"]
  );
  assert.deepEqual(openRouterExecutor.calls.map((call) => call.model), [null]);
  assert.deepEqual(
    codexExecutor.calls.map((call) => call.stageId),
    ["captionTranslation", "seo"]
  );
  assert.deepEqual(
    codexExecutor.calls.map((call) => call.model),
    ["gpt-5.4-mini", "gpt-5.4-mini"]
  );
});

test("HybridJsonStageExecutor routes quick regenerate through OpenRouter only", async () => {
  const codexExecutor = new CaptureQueueExecutor([]);
  const openRouterExecutor = new CaptureQueueExecutor([
    {
      options: Array.from({ length: 5 }, (_, index) => ({
        option: index + 1,
        candidate_id: `candidate_${index + 1}`,
        angle: `angle_${index + 1}`,
        top: `New top ${index + 1}`,
        bottom: `New bottom ${index + 1}`,
        top_ru: `Новый верх ${index + 1}`,
        bottom_ru: `Новый низ ${index + 1}`,
        title: `New title ${index + 1}`,
        title_ru: `Новый заголовок ${index + 1}`
      })),
      final_pick_option: 1,
      selection_rationale: "Keep option 1."
    }
  ]);

  const executor = new HybridJsonStageExecutor({
    captionProviderConfig: {
      provider: "openrouter",
      anthropicModel: "claude-opus-4-6",
      openrouterModel: "anthropic/claude-opus-4.7"
    },
    codexExecutor,
    anthropicExecutor: null,
    openRouterExecutor
  });

  await runQuickRegenerateModel({
    stage2: buildBaseStage2Response(),
    channel: {
      id: "channel_regen_openrouter",
      name: "Channel 1",
      username: "channel_1",
      stage2HardConstraints: RELAXED_HARD_CONSTRAINTS
    },
    userInstruction: "make it shorter",
    executor,
    model: "gpt-5.3-codex-spark",
    reasoningEffort: "medium"
  });

  assert.deepEqual(openRouterExecutor.calls.map((call) => call.stageId), ["regenerate"]);
  assert.equal(openRouterExecutor.calls[0]?.model, null);
  assert.deepEqual(openRouterExecutor.calls[0]?.imagePaths, []);
  assert.equal(codexExecutor.calls.length, 0);
});
