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
  prompt: string;
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

test("runNativeCaptionPipeline routes native stage models and translates captions inside the hot path", async () => {
  const service = new ViralShortsWorkerService();
  const executor = new CaptureQueueExecutor([
    {
      grounding: {
        observed_facts: ["two people pause before reacting"],
        visible_sequence: ["one freezes", "the other looks over"],
        micro_turn: "the pause lands harder than the action",
        first_seconds_signal: "the room goes quiet immediately",
        uncertainties: [],
        forbidden_claims: ["do not invent dialogue"],
        safe_inferences: ["awkward energy", "shared hesitation"]
      },
      audience_wave: {
        exists: true,
        emotional_temperature: "quiet disbelief",
        dominant_harmless_handle: "that pause said enough",
        consensus_lane: "everyone clocked the hesitation",
        joke_lane: "that pause said enough",
        dissent_lane: "",
        safe_reusable_cues: ["that pause said enough"],
        blocked_cues: [],
        flattening_risks: ["generic awkward pause copy"],
        must_not_lose: ["that pause said enough"]
      },
      strategy: {
        primary_angle: "awkward_pause",
        secondary_angles: ["quiet_social_read"],
        hook_seeds: ["the pause said enough"],
        bottom_functions: ["sharpen the social read"],
        required_lanes: [
          {
            lane_id: "audience_locked",
            count: 2,
            purpose: "Preserve the harmless public handle."
          },
          {
            lane_id: "balanced_clean",
            count: 2,
            purpose: "Keep strong native phrasing."
          },
          {
            lane_id: "backup_simple",
            count: 1,
            purpose: "Hold a plain live backup."
          }
        ],
        must_do: ["land why-care immediately"],
        must_avoid: ["inventory openings"]
      }
    },
    Array.from({ length: 8 }, (_, index) => ({
      candidate_id: `cand_${index + 1}`,
      lane_id: index < 2 ? "audience_locked" : "balanced_clean",
      top: `That pause told the whole room what was happening ${index + 1}.`,
      bottom: `Nobody needed the follow-up once that look landed ${index + 1}.`
      ,
      retained_handle: index < 2,
      display_intent: "finalist_or_display_safe"
    })),
    {
      finalists: [
        {
          candidate_id: "cand_1",
          why_chosen: ["It lands the social read fast."],
          preserved_handle: true
        },
        {
          candidate_id: "cand_2",
          why_chosen: ["Still feels lived-in."],
          preserved_handle: false
        },
        {
          candidate_id: "cand_3",
          why_chosen: ["Still readable without losing the wave."],
          preserved_handle: false
        }
      ],
      display_safe_extras: [
        {
          candidate_id: "cand_5",
          why_display_safe: ["Keeps a cleaner reserve alive."]
        },
        {
          candidate_id: "cand_6",
          why_display_safe: ["Still visible without flattening the clip."]
        }
      ],
      hard_rejected: [
        {
          candidate_id: "cand_4",
          reasons: ["dead generic clean English"],
          offending_phrases: ["generic reaction"]
        }
      ],
      winner_candidate_id: "cand_1",
      recovery_plan: {
        required: false,
        missing_count: 0,
        briefs: []
      }
    },
    ["cand_1", "cand_2", "cand_3", "cand_5", "cand_6"].map((candidateId, index) => ({
      candidate_id: candidateId,
      top_ru: `Эта пауза все объяснила ${index + 1}.`,
      bottom_ru: `После этого взгляда продолжение уже было не нужно ${index + 1}.`
    })),
    Array.from({ length: 5 }, (_, index) => ({
      option: index + 1,
      title: `Winner title ${index + 1}`,
      title_ru: `Заголовок победителя ${index + 1}`
    })),
    {
      description:
        "Detroit, 25 MPH, Ford pickup, muddy axle failure\nThe truck bucks through the rut before the axle folds sideways under load, turning the whole clip into a visible mechanical breakdown. Viewers track the wobble, the mud spray, and the late collapse as the failure becomes impossible to miss.\nSearch terms and topics covered:\nford pickup axle failure, muddy rut truck breakdown, axle twists sideways under load, wheel collapse in mud, truck suspension failure clip, visible axle damage, mechanical failure caught on camera, pickup wheel folds sideways, off road truck failure, ford truck axle bend, muddy field breakdown, vehicle under load collapse, truck wheel wobble signs, axle failure reaction video, real mechanical failure short\nHashtags:\n#truck, #mechanicalfailure, #shorts, #fordpickup, #axlefailure, #mudrut, #wheelcollapse, #suspensiondamage, #caughtoncamera, #viralshorts, #mechaniclife, #fyp",
      tags:
        "Truck Failure, Mechanical Failure, Off Road Incident, axle bending, wheel collapse, truck under load, muddy rut, suspension damage, late mechanical failure, caught on camera, Ford, Ford pickup, axle, wheel, mud field, Detroit, 25 mph"
    }
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
      contextPacket: "gpt-5.4",
      candidateGenerator: "gpt-5.4-mini",
      qualityCourt: "gpt-5.3-codex-spark",
      targetedRepair: "gpt-5.4-mini",
      captionTranslation: "gpt-5.4-mini",
      titleWriter: "gpt-5.4",
      seo: "gpt-5.4-mini"
    }
  });

  assert.equal(result.output.pipeline.execution?.pipelineVersion, "native_caption_v3");
  assert.equal(result.output.finalists?.length, 3);
  assert.equal(result.output.winner?.candidateId, "cand_1");
  assert.equal(result.output.titleOptions.length, 5);
  assert.equal(result.output.titleOptions[0]?.title, "WINNER TITLE 1");
  assert.equal(result.output.titleOptions[0]?.titleRu, "ЗАГОЛОВОК ПОБЕДИТЕЛЯ 1");
  assert.equal(result.seo?.description.includes("Search terms and topics covered:"), true);
  assert.equal(Boolean(result.output.captionOptions[0]?.topRu?.trim()), true);
  assert.equal(Boolean(result.output.titleOptions[0]?.titleRu?.trim()), true);
  assert.deepEqual(
    executor.calls.map((call) => call.model),
    ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark", "gpt-5.4-mini", "gpt-5.4", "gpt-5.4-mini"]
  );
  assert.deepEqual(executor.calls[0]?.imagePaths, ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"]);
  assert.deepEqual(executor.calls.slice(1).map((call) => call.imagePaths), [[], [], [], [], []]);
});

test("stable_reference_v6 routes the dedicated oneShotReference model and skips modular native judges", async () => {
  const service = new ViralShortsWorkerService();
  const executor = new CaptureQueueExecutor([
    {
      analysis: {
        visual_anchors: [
          "wrench stops mid-air",
          "everyone turns toward the pause",
          "the room reads it before he speaks"
        ],
        comment_vibe: "dry impressed side-eye",
        key_phrase_to_adapt: "that pause said enough"
      },
      candidates: Array.from({ length: 5 }, (_, index) => ({
        candidate_id: `ref_${index + 1}`,
        top:
          index === 0
            ? "That wrench stops mid-air because the whole bay already knows what he just heard, and the clip turns into the second every mechanic in there reads the pause before the repair even moves again."
            : `The whole bay stops watching the part and starts watching him because that frozen wrench already tells everybody what went wrong before he can smooth it over ${index + 1}.`,
        bottom:
          index === 0
            ? "That isn't dead air, that's every mechanic in there hearing the repair bill at the exact same time."
            : `That pause said enough, and the room answered it before he ever got the follow-up out ${index + 1}.`,
        retained_handle: index < 2
      })),
      winner_candidate_id: "ref_1",
      titles: Array.from({ length: 5 }, (_, index) => ({
        title: `WHY DID THE ROOM FREEZE ${index + 1}`,
        title_ru: `ПОЧЕМУ ВСЕ ЗАМЕРЛИ ${index + 1}`
      }))
    },
    Array.from({ length: 5 }, (_, index) => ({
      candidate_id: `ref_${index + 1}`,
      top_ru: `Русский верх ${index + 1}`,
      bottom_ru: `Русский низ ${index + 1}`
    })),
    {
      description:
        "Garage bay, no stated speed, mechanic wrench pause, workshop reaction\nThe wrench stops mid-air before anyone says a word, and the room reads the repair outcome off the silence alone. The pause, the faces turning, and the unfinished motion make the social read land before the explanation does.\nSearch terms and topics covered:\nmechanic wrench pause, garage reaction moment, workshop silence reaction, repair bill realization, mechanic room freeze, wrench stops mid air, automotive shop reaction, visible awkward pause, repair gone wrong reaction, garage bay silence, mechanic social read, workshop tension moment, repair estimate reaction, automotive bay short, wrench pause caught on camera\nHashtags:\n#mechanic, #garage, #shorts, #wrenchpause, #workshopreaction, #repairbill, #automotiveshop, #awkwardsilence, #caughtoncamera, #viralvideo, #mechaniclife, #fyp",
      tags:
        "Mechanic, Garage Reaction, Auto Repair, wrench pause, room freeze, workshop silence, repair realization, social read, caught on camera, awkward pause, garage bay, mechanic shop, wrench, repair bill, automotive bay, workshop, reaction clip"
    }
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

  assert.equal(result.output.pipeline.execution?.pathVariant, "reference_one_shot_v1");
  assert.equal(result.output.captionOptions.length, 5);
  assert.equal(result.seo?.tags.includes("Mechanic"), true);
  assert.deepEqual(
    executor.calls.map((call) => call.model),
    ["gpt-5.4-mini", "gpt-5.4", "gpt-5.4-mini"]
  );
  assert.deepEqual(executor.calls[0]?.imagePaths, ["/tmp/frame-1.jpg", "/tmp/frame-2.jpg"]);
  assert.deepEqual(executor.calls.slice(1).map((call) => call.imagePaths), [[], []]);
});

test("stable_reference_v6_experimental routes the dedicated oneShotReference model through the experimental path variant", async () => {
  const service = new ViralShortsWorkerService();
  const executor = new CaptureQueueExecutor([
    {
      analysis: {
        visual_anchors: [
          "wrench stops mid-air",
          "everyone turns toward the pause",
          "the room reads it before he speaks"
        ],
        comment_vibe: "dry impressed side-eye",
        key_phrase_to_adapt: "that pause said enough"
      },
      candidates: Array.from({ length: 5 }, (_, index) => ({
        candidate_id: `ref_exp_${index + 1}`,
        top:
          index === 0
            ? "The wrench freezes mid-air after the mistake lands, and the whole bay reads the cost of it before anybody there needs to say the next word out loud."
            : `The mistake lands before the explanation does, and the whole bay starts reading his face instead of the part the second that wrench stops ${index + 1}.`,
        bottom:
          index === 0
            ? "That pause turns a normal repair beat into the exact second everybody in the room realizes what the bill is about to become."
            : `The room doesn't need extra narration after that pause, because the silence already cashes out the repair cost for everybody there ${index + 1}.`,
        retained_handle: index < 2
      })),
      winner_candidate_id: "ref_exp_1",
      titles: Array.from({ length: 5 }, (_, index) => ({
        title: `WHY DID THE ROOM FREEZE ${index + 1}`,
        title_ru: `ПОЧЕМУ ВСЕ ЗАМЕРЛИ ${index + 1}`
      }))
    },
    Array.from({ length: 5 }, (_, index) => ({
      candidate_id: `ref_exp_${index + 1}`,
      top_ru: `Русский верх ${index + 1}`,
      bottom_ru: `Русский низ ${index + 1}`
    })),
    {
      description:
        "Garage bay, no stated speed, mechanic wrench pause, workshop reaction\nThe wrench stops mid-air before anyone says a word, and the room reads the repair outcome off the silence alone. The pause, the faces turning, and the unfinished motion make the social read land before the explanation does.\nSearch terms and topics covered:\nmechanic wrench pause, garage reaction moment, workshop silence reaction, repair bill realization, mechanic room freeze, wrench stops mid air, automotive shop reaction, visible awkward pause, repair gone wrong reaction, garage bay silence, mechanic social read, workshop tension moment, repair estimate reaction, automotive bay short, wrench pause caught on camera\nHashtags:\n#mechanic, #garage, #shorts, #wrenchpause, #workshopreaction, #repairbill, #automotiveshop, #awkwardsilence, #caughtoncamera, #viralvideo, #mechaniclife, #fyp",
      tags:
        "Mechanic, Garage Reaction, Auto Repair, wrench pause, room freeze, workshop silence, repair realization, social read, caught on camera, awkward pause, garage bay, mechanic shop, wrench, repair bill, automotive bay, workshop, reaction clip"
    }
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

  assert.equal(result.output.pipeline.execution?.pathVariant, "reference_one_shot_v1_experimental");
  assert.equal(result.output.pipeline.workerProfile?.resolvedId, "stable_reference_v6_experimental");
  assert.deepEqual(
    executor.calls.map((call) => call.model),
    ["gpt-5.4-mini", "gpt-5.4", "gpt-5.4-mini"]
  );
  assert.match(executor.calls[0]?.prompt ?? "", /experimental_contract_json/);
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
