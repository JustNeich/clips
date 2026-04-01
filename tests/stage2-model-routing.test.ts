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
import type { JsonStageExecutor } from "../lib/viral-shorts-worker/executor";

type ExecutorCall = {
  model: string | null;
  imagePaths: string[];
};

class CaptureQueueExecutor implements JsonStageExecutor {
  readonly calls: ExecutorCall[] = [];

  constructor(private readonly responses: unknown[]) {}

  async runJson<T>(input: {
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T> {
    this.calls.push({
      model: input.model ?? null,
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

test("runNativeCaptionPipeline routes native stage models and keeps translation outside the hot path", async () => {
  const service = new ViralShortsWorkerService();
  const executor = new CaptureQueueExecutor([
    {
      grounding: {
        observed_facts: ["two people pause before reacting"],
        visible_actions: ["one freezes", "the other looks over"],
        micro_turn: "the pause lands harder than the action",
        first_seconds_signal: "the room goes quiet immediately",
        uncertainties: [],
        forbidden_claims: ["do not invent dialogue"],
        safe_inferences: ["awkward energy", "shared hesitation"]
      },
      audience: {
        consensus_read: "everyone clocked the hesitation",
        joke_lane: "that pause said enough",
        dissent_exists: false,
        safe_reusable_cues: ["that pause said enough"],
        blocked_cues: [],
        toxic_or_low_value_patterns: []
      },
      strategy: {
        primary_angle: "awkward_pause",
        secondary_angles: ["quiet_social_read"],
        hook_seeds: ["the pause said enough"],
        bottom_functions: ["sharpen the social read"],
        must_do: ["land why-care immediately"],
        must_avoid: ["inventory openings"],
        quality_bar: ["native human feel"]
      }
    },
    Array.from({ length: 8 }, (_, index) => ({
      candidate_id: `cand_${index + 1}`,
      angle: index === 0 ? "awkward_pause" : "quiet_social_read",
      hook_family: "social_read",
      cue_used: "that pause said enough",
      top: `That pause told the whole room what was happening ${index + 1}.`,
      bottom: `Nobody needed the follow-up once that look landed ${index + 1}.`
    })),
    {
      kept: [
        {
          candidate_id: "cand_1",
          scores: {
            hook_immediacy: 9,
            native_fluency: 9,
            visual_defensibility: 9,
            audience_authenticity: 8,
            human_warmth: 8,
            bottom_usefulness: 8
          },
          why_it_works: ["It lands the social read fast."]
        },
        {
          candidate_id: "cand_2",
          scores: {
            hook_immediacy: 8,
            native_fluency: 8,
            visual_defensibility: 8,
            audience_authenticity: 8,
            human_warmth: 7,
            bottom_usefulness: 8
          },
          why_it_works: ["Still feels lived-in."]
        }
      ],
      rejected: [
        {
          candidate_id: "cand_3",
          hard_fail_reasons: ["too abstract"],
          offending_phrases: ["social geometry"]
        }
      ],
      winner_candidate_id: "cand_1",
      winner_reason: "Candidate 1 is the cleanest winner.",
      needs_repair: false,
      repair_briefs: []
    },
    Array.from({ length: 5 }, (_, index) => ({
      option: index + 1,
      title: `Winner title ${index + 1}`
    }))
  ]);

  const result = await service.runNativeCaptionPipeline({
    channel: {
      id: "channel_1",
      name: "Channel 1",
      username: "channel_1",
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
      contextPacket: "gpt-5.4",
      candidateGenerator: "gpt-5.4-mini",
      qualityCourt: "gpt-5.3-codex-spark",
      targetedRepair: "gpt-5.4-mini",
      titleWriter: "gpt-5.4"
    }
  });

  assert.equal(result.output.pipeline.execution?.pipelineVersion, "native_caption_v3");
  assert.equal(result.output.finalists?.length, 2);
  assert.equal(result.output.winner?.candidateId, "cand_1");
  assert.equal(result.output.titleOptions.length, 5);
  assert.equal(result.output.captionOptions[0]?.topRu, undefined);
  assert.deepEqual(
    executor.calls.map((call) => call.model),
    ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark", "gpt-5.4"]
  );
  assert.deepEqual(executor.calls[0]?.imagePaths, ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"]);
  assert.deepEqual(executor.calls.slice(1).map((call) => call.imagePaths), [[], [], []]);
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

test("translateNativeCaptionFinalists is off-hot-path, text-only, and returns finalist translations only", async () => {
  const service = new ViralShortsWorkerService();
  const executor = new CaptureQueueExecutor([
    [
      {
        candidate_id: "cand_1",
        top_ru: "Эта пауза всё сказала без слов.",
        bottom_ru: "После этого взгляда продолжение уже было не нужно."
      },
      {
        candidate_id: "stray_candidate",
        top_ru: "Лишний",
        bottom_ru: "Перевод"
      }
    ]
  ]);

  const translation = await service.translateNativeCaptionFinalists({
    finalists: [
      {
        option: 1,
        candidateId: "cand_1",
        angle: "awkward_pause",
        hookFamily: "social_read",
        cueUsed: "that pause said enough",
        top: "That pause told the whole room what was happening.",
        bottom: "Nobody needed the follow-up once that look landed.",
        constraintCheck: {
          passed: true,
          repaired: false,
          topLength: 48,
          bottomLength: 51,
          issues: []
        }
      }
    ],
    executor,
    model: "gpt-5.4",
    reasoningEffort: "low"
  });

  assert.equal(executor.calls.length, 1);
  assert.equal(executor.calls[0]?.model, "gpt-5.4");
  assert.deepEqual(executor.calls[0]?.imagePaths, []);
  assert.equal(translation?.items.length, 1);
  assert.equal(translation?.items[0]?.candidateId, "cand_1");
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
