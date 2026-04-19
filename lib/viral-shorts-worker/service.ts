import {
  AnalyzerOutput,
  CandidateCaption,
  CriticScore,
  FinalSelectorOutput,
  PreparedGenerationContext,
  PromptPacket,
  SelectorOutput,
  Stage2DebugMode,
  Stage2ExamplesAssessment,
  Stage2ExampleGuidanceRole,
  Stage2HumanPhrasingSignals,
  Stage2PipelineExecution,
  Stage2CandidateTopSignalSummary,
  Stage2Diagnostics,
  Stage2DiagnosticsExample,
  Stage2DiagnosticsPromptStage,
  Stage2RunDebugArtifact,
  NativeCaptionCandidate,
  NativeCaptionContextPacket,
  NativeCaptionFinalist,
  NativeCaptionGuardSummary,
  NativeCaptionHardValidatorResult,
  NativeCaptionQualityCourt,
  NativeCaptionRepairResult,
  NativeCaptionTemplateBackfillCandidate,
  NativeCaptionTitleOption,
  NativeCaptionTranslationArtifact,
  NativeCaptionWinner,
  Stage2TopQualitySignals,
  Stage2TopSignalSummary,
  Stage2TokenUsage,
  Stage2RuntimeChannelConfig,
  ViralShortsStage2Result,
  ViralShortsVideoContext
} from "./types";
import {
  buildAnalyzerPrompt,
  buildCommentCarryProfile,
  buildCommentPromptDigest,
  buildStage2PromptInputManifestMap,
  buildStage2SourceContextSummary,
  buildCriticPrompt,
  evaluateHumanPhrasingSignals,
  evaluateTopHookSignals,
  evaluateCandidateCommentCarry,
  buildFinalSelectorPrompt,
  buildPromptPacket,
  buildRewriterPrompt,
  resolveTopGuidance,
  buildSelectorPrompt,
  buildTitlePrompt,
  buildWriterPrompt,
  resolveStage2PromptTemplate
} from "./prompts";
import {
  classifyClipType,
  heuristicAnalyzer,
  scoreTextMatch
} from "./analysis";
import {
  resolveStage2ExamplesCorpus,
  Stage2CorpusExample,
  Stage2ExamplesConfig,
  Stage2HardConstraints
} from "../stage2-channel-config";
import {
  type AudiencePacket,
  CandidateLifecycle,
  buildStage2VNextTrace,
  type ClipTruthPacket,
  type ExampleRoutingDecision,
  type Stage2VNextExampleUsage,
  type FinalSelection as Stage2VNextFinalSelection,
  type JudgeScoreCard,
  type PackedCandidate as Stage2VNextPackedCandidate,
  type SemanticDraft as Stage2VNextSemanticDraft,
  type SourcePacket,
  type StrategyPacket,
  applyExampleRoutingDecision,
  buildRetrievedExamples,
  decideExampleRouting,
  resolveStage2VNextFlagSnapshot,
  getStage2WorkerBuildInfo,
  resolveStage2StageChainVersion,
  validateBannedPatterns,
  validateExampleRoutingDecisionSchema,
  validateFinalSelectionObjectSchema,
  validateJudgeScoreCardListSchema,
  validateLengthWindow,
  validatePackedCandidateListSchema,
  validateSemanticDraftListSchema,
  validateTitle
} from "../stage2-vnext";
import { normalizeStage2TitleOptionsValue } from "../stage2-title-options";
import {
  STAGE2_PIPELINE_STAGES,
  Stage2PipelineStageId,
  Stage2PromptConfig,
  computeStage2PromptHash,
  normalizeStage2PromptConfig
} from "../stage2-pipeline";
import {
  STAGE2_REFERENCE_ONE_SHOT_EXPERIMENTAL_PROMPT,
  STAGE2_REFERENCE_ONE_SHOT_EXPERIMENTAL_PROMPT_VERSION,
  STAGE2_REFERENCE_ONE_SHOT_PROMPT,
  STAGE2_REFERENCE_ONE_SHOT_PROMPT_VERSION,
  Stage2PromptConfigStageId
} from "../stage2-prompt-specs";
import { CommentItem } from "../comments";
import {
  buildStage2SeoPrompt,
  parseStage2SeoOutput,
  STAGE2_SEO_OUTPUT_SCHEMA,
  type Stage2SeoOutput
} from "../stage2-seo";
import { JsonStageExecutor } from "./executor";
import { buildSelectorExamplePool } from "./selector-example-pool";
import {
  buildStage2LearningPromptContext,
  createEmptyStage2EditorialMemorySummary,
  DEFAULT_STAGE2_STYLE_PROFILE,
  normalizeStage2StyleProfile
} from "../stage2-channel-learning";
import {
  buildStage2WorkerProfilePromptPayload,
  buildStage2WorkerProfileRequiredLanes,
  isReferenceOneShotExecutionMode,
  resolveStage2WorkerProfile
} from "../stage2-worker-profile";
import {
  buildDistributedTemplateHighlightSpansFromPhrases,
  createEmptyTemplateCaptionHighlights,
  getEnabledTemplateHighlightSlots,
  hasEnabledTemplateHighlights,
  normalizeTemplateHighlightPhraseAnnotations,
  type TemplateCaptionHighlightPhraseMap,
  type TemplateCaptionHighlights
} from "../template-highlights";

const ANALYZER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "visual_anchors",
    "subject",
    "setting",
    "scene_beats",
    "reveal_moment",
    "late_clip_change",
    "stakes",
    "payoff",
    "core_trigger",
    "human_stake",
    "narrative_frame",
    "why_viewer_cares",
    "best_bottom_energy",
    "comment_vibe",
    "raw_summary"
  ],
  properties: {
    visual_anchors: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string", minLength: 1 }
    },
    specific_nouns: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    visible_actions: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    subject: { type: "string", minLength: 1 },
    action: { type: "string", minLength: 1 },
    setting: { type: "string", minLength: 1 },
    first_seconds_signal: { type: "string", minLength: 1 },
    scene_beats: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    reveal_moment: { type: "string", minLength: 1 },
    late_clip_change: { type: "string", minLength: 1 },
    stakes: { type: "array", items: { type: "string", minLength: 1 } },
    payoff: { type: "string", minLength: 1 },
    core_trigger: { type: "string", minLength: 1 },
    human_stake: { type: "string", minLength: 1 },
    narrative_frame: { type: "string", minLength: 1 },
    why_viewer_cares: { type: "string", minLength: 1 },
    best_bottom_energy: { type: "string", minLength: 1 },
    comment_vibe: { type: "string", minLength: 1 },
    comment_consensus_lane: { type: "string" },
    comment_joke_lane: { type: "string" },
    comment_dissent_lane: { type: "string" },
    comment_suspicion_lane: { type: "string" },
    slang_to_adapt: { type: "array", items: { type: "string", minLength: 1 } },
    comment_language_cues: { type: "array", items: { type: "string", minLength: 1 } },
    extractable_slang: { type: "array", items: { type: "string", minLength: 1 } },
    hidden_detail: { type: "string", minLength: 1 },
    generic_risks: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    uncertainty_notes: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    raw_summary: { type: "string", minLength: 1 }
  }
} as const;

const SELECTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "clip_type",
    "primary_angle",
    "secondary_angles",
    "selected_example_ids",
    "core_trigger",
    "human_stake",
    "narrative_frame",
    "why_viewer_cares",
    "top_strategy",
    "bottom_energy",
    "why_old_v6_would_work_here",
    "failure_modes",
    "selection_rationale",
    "writer_brief",
    "confidence"
  ],
  properties: {
    clip_type: { type: "string", minLength: 1 },
    primary_angle: { type: "string", minLength: 1 },
    secondary_angles: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string", minLength: 1 }
    },
    ranked_angles: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["angle", "score", "why"],
        properties: {
          angle: { type: "string", minLength: 1 },
          score: { type: "number" },
          why: { type: "string", minLength: 1 }
        }
      }
    },
    selected_example_ids: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 1 }
    },
    rejected_example_ids: {
      type: "array",
      maxItems: 5,
      items: { type: "string", minLength: 1 }
    },
    core_trigger: { type: "string", minLength: 1 },
    human_stake: { type: "string", minLength: 1 },
    narrative_frame: { type: "string", minLength: 1 },
    why_viewer_cares: { type: "string", minLength: 1 },
    top_strategy: { type: "string", minLength: 1 },
    bottom_energy: { type: "string", minLength: 1 },
    why_old_v6_would_work_here: { type: "string", minLength: 1 },
    failure_modes: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 1 }
    },
    selection_rationale: { type: "string", minLength: 1 },
    rationale: { type: "string", minLength: 1 },
    writer_brief: { type: "string", minLength: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;

const CANDIDATES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      minItems: 8,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_id", "angle", "top", "bottom", "top_ru", "bottom_ru", "rationale"],
        properties: {
          candidate_id: { type: "string", minLength: 1 },
          angle: { type: "string", minLength: 1 },
          top: { type: "string", minLength: 0 },
          bottom: { type: "string", minLength: 1 },
          top_ru: { type: "string", minLength: 0 },
          bottom_ru: { type: "string", minLength: 1 },
          rationale: { type: "string", minLength: 1 },
          style_direction_ids: {
            type: "array",
            maxItems: 3,
            items: { type: "string", minLength: 1 }
          },
          exploration_mode: {
            type: "string",
            enum: ["aligned", "exploratory"]
          }
        }
      }
    }
  }
} as const;

const CRITIC_SCORE_KEYS = [
  "visual_anchor",
  "hook_strength",
  "naturalness",
  "brand_fit",
  "specificity",
  "top_bottom_synergy",
  "readability",
  "non_ai_feel",
  "paused_frame_accuracy",
  "comment_vibe_authenticity",
  "length_compliance",
  "narrative_trigger_strength",
  "context_compression_quality"
] as const;

const CRITIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores"],
  properties: {
    scores: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_id", "scores", "total", "issues", "keep"],
        properties: {
          candidate_id: { type: "string", minLength: 1 },
          scores: {
            type: "object",
            additionalProperties: false,
            required: [...CRITIC_SCORE_KEYS],
            properties: Object.fromEntries(
              CRITIC_SCORE_KEYS.map((key) => [key, { type: "number" }])
            )
          },
          total: { type: "number" },
          issues: {
            type: "array",
            items: { type: "string" }
          },
          keep: { type: "boolean" }
        }
      }
    }
  }
} as const;

const FINAL_SELECTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["final_candidates", "final_pick", "rationale"],
  properties: {
    final_candidates: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string", minLength: 1 }
    },
    final_pick: { type: "string", minLength: 1 },
    rationale: { type: "string", minLength: 1 }
  }
} as const;

const TITLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titleOptions"],
  properties: {
    titleOptions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["option", "title", "title_ru"],
        properties: {
          option: { type: "integer", minimum: 1, maximum: 5 },
          title: { type: "string", minLength: 1 },
          titleRu: { type: "string", minLength: 1 },
          title_ru: { type: "string", minLength: 1 }
        }
      }
    }
  }
} as const;

function getResolvedStage2WorkerProfile(channelConfig: Stage2RuntimeChannelConfig) {
  return channelConfig.workerProfile ?? resolveStage2WorkerProfile(channelConfig.stage2WorkerProfileId);
}

function buildNativeCaptionStyleCard(channelConfig: Stage2RuntimeChannelConfig) {
  return getResolvedStage2WorkerProfile(channelConfig).styleCard;
}

const NATIVE_CONTEXT_PACKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["grounding", "audience_wave", "strategy"],
  properties: {
    grounding: {
      type: "object",
      additionalProperties: false,
      required: [
        "observed_facts",
        "visible_sequence",
        "micro_turn",
        "first_seconds_signal",
        "uncertainties",
        "forbidden_claims",
        "safe_inferences"
      ],
      properties: {
        observed_facts: { type: "array", items: { type: "string", minLength: 1 } },
        visible_sequence: { type: "array", items: { type: "string", minLength: 1 } },
        micro_turn: { type: "string", minLength: 1 },
        first_seconds_signal: { type: "string", minLength: 1 },
        uncertainties: { type: "array", items: { type: "string", minLength: 1 } },
        forbidden_claims: { type: "array", items: { type: "string", minLength: 1 } },
        safe_inferences: { type: "array", items: { type: "string", minLength: 1 } }
      }
    },
    audience_wave: {
      type: "object",
      additionalProperties: false,
      required: [
        "exists",
        "emotional_temperature",
        "dominant_harmless_handle",
        "consensus_lane",
        "joke_lane",
        "dissent_lane",
        "safe_reusable_cues",
        "blocked_cues",
        "flattening_risks",
        "must_not_lose"
      ],
      properties: {
        exists: { type: "boolean" },
        emotional_temperature: { type: "string", minLength: 1 },
        dominant_harmless_handle: { type: ["string", "null"] },
        consensus_lane: { type: "string" },
        joke_lane: { type: "string" },
        dissent_lane: { type: "string" },
        safe_reusable_cues: { type: "array", items: { type: "string", minLength: 1 } },
        blocked_cues: { type: "array", items: { type: "string", minLength: 1 } },
        flattening_risks: { type: "array", items: { type: "string", minLength: 1 } },
        must_not_lose: { type: "array", items: { type: "string", minLength: 1 } }
      }
    },
    strategy: {
      type: "object",
      additionalProperties: false,
      required: [
        "primary_angle",
        "secondary_angles",
        "hook_seeds",
        "bottom_functions",
        "required_lanes",
        "must_do",
        "must_avoid"
      ],
      properties: {
        primary_angle: { type: "string", minLength: 1 },
        secondary_angles: { type: "array", items: { type: "string", minLength: 1 } },
        hook_seeds: { type: "array", items: { type: "string", minLength: 1 } },
        bottom_functions: { type: "array", items: { type: "string", minLength: 1 } },
        required_lanes: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["lane_id", "count", "purpose"],
            properties: {
              lane_id: { type: "string", minLength: 1 },
              count: { type: "integer", minimum: 1, maximum: 8 },
              purpose: { type: "string", minLength: 1 }
            }
          }
        },
        must_do: { type: "array", items: { type: "string", minLength: 1 } },
        must_avoid: { type: "array", items: { type: "string", minLength: 1 } }
      }
    }
  }
} as const;

const NATIVE_CANDIDATE_BATCH_SCHEMA = {
  type: "array",
  minItems: 8,
  maxItems: 8,
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "candidate_id",
      "lane_id",
      "top",
      "bottom",
      "retained_handle",
      "display_intent"
    ],
    properties: {
      candidate_id: { type: "string", minLength: 1 },
      lane_id: { type: "string", minLength: 1 },
      top: { type: "string", minLength: 0 },
      bottom: { type: "string", minLength: 1 },
      retained_handle: { type: "boolean" },
      display_intent: { type: "string", const: "finalist_or_display_safe" }
    }
  }
} as const;

const NATIVE_QUALITY_COURT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "finalists",
    "display_safe_extras",
    "hard_rejected",
    "winner_candidate_id",
    "recovery_plan"
  ],
  properties: {
    finalists: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_id", "why_chosen", "preserved_handle"],
        properties: {
          candidate_id: { type: "string", minLength: 1 },
          why_chosen: { type: "array", items: { type: "string", minLength: 1 } },
          preserved_handle: { type: "boolean" }
        }
      }
    },
    display_safe_extras: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_id", "why_display_safe"],
        properties: {
          candidate_id: { type: "string", minLength: 1 },
          why_display_safe: { type: "array", items: { type: "string", minLength: 1 } }
        }
      }
    },
    hard_rejected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_id", "reasons", "offending_phrases"],
        properties: {
          candidate_id: { type: "string", minLength: 1 },
          reasons: { type: "array", items: { type: "string", minLength: 1 } },
          offending_phrases: { type: "array", items: { type: "string" } }
        }
      }
    },
    winner_candidate_id: { type: ["string", "null"] },
    recovery_plan: {
      type: "object",
      additionalProperties: false,
      required: ["required", "missing_count", "briefs"],
      properties: {
        required: { type: "boolean" },
        missing_count: { type: "integer", minimum: 0, maximum: 8 },
        briefs: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["lane_id", "goal", "must_keep", "must_avoid"],
            properties: {
              lane_id: { type: "string", minLength: 1 },
              goal: { type: "string", minLength: 1 },
              must_keep: { type: "array", items: { type: "string", minLength: 1 } },
              must_avoid: { type: "array", items: { type: "string", minLength: 1 } }
            }
          }
        }
      }
    }
  }
} as const;

const NATIVE_TARGETED_REPAIR_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "candidate_id",
      "lane_id",
      "top",
      "bottom",
      "retained_handle",
      "display_intent"
    ],
    properties: {
      candidate_id: { type: "string", minLength: 1 },
      lane_id: { type: "string", minLength: 1 },
      top: { type: "string", minLength: 0 },
      bottom: { type: "string", minLength: 1 },
      retained_handle: { type: "boolean" },
      display_intent: { type: "string", const: "recovery" }
    }
  }
} as const;

const NATIVE_TITLE_WRITER_SCHEMA = {
  type: "array",
  minItems: 5,
  maxItems: 5,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["option", "title", "title_ru"],
    properties: {
      option: { type: "integer", minimum: 1, maximum: 5 },
      title: { type: "string", minLength: 1 },
      title_ru: { type: "string", minLength: 1 }
    }
  }
} as const;

const NATIVE_TRANSLATION_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["candidate_id", "top_ru", "bottom_ru"],
    properties: {
      candidate_id: { type: "string", minLength: 1 },
      top_ru: { type: "string", minLength: 0 },
      bottom_ru: { type: "string", minLength: 1 }
    }
  }
} as const;

const NATIVE_CAPTION_HIGHLIGHTING_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["candidate_id", "top", "bottom"],
    properties: {
      candidate_id: { type: "string", minLength: 1 },
      top: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["phrase", "slot_id"],
          properties: {
            phrase: { type: "string", minLength: 1 },
            slot_id: { type: "string", minLength: 1 }
          }
        }
      },
      bottom: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["phrase", "slot_id"],
          properties: {
            phrase: { type: "string", minLength: 1 },
            slot_id: { type: "string", minLength: 1 }
          }
        }
      }
    }
  }
} as const;

const NATIVE_REFERENCE_ONE_SHOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["analysis", "candidates", "winner_candidate_id", "titles"],
  properties: {
    analysis: {
      type: "object",
      additionalProperties: false,
      required: ["visual_anchors", "comment_vibe", "key_phrase_to_adapt"],
      properties: {
        visual_anchors: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: { type: "string", minLength: 1 }
        },
        comment_vibe: { type: "string", minLength: 1 },
        key_phrase_to_adapt: { type: "string", minLength: 1 }
      }
    },
    candidates: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_id", "top", "bottom", "retained_handle"],
        properties: {
          candidate_id: { type: "string", minLength: 1 },
          top: { type: "string", minLength: 0 },
          bottom: { type: "string", minLength: 1 },
          retained_handle: { type: "boolean" },
          rationale: { type: "string", minLength: 1 }
        }
      }
    },
    winner_candidate_id: { type: "string", minLength: 1 },
    titles: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: {
          title: { type: "string", minLength: 1 },
          title_ru: { type: "string", minLength: 1 }
        }
      }
    }
  }
} as const;

type NativeReferenceOneShotResult = {
  analysis: {
    visualAnchors: string[];
    commentVibe: string;
    keyPhraseToAdapt: string;
  };
  candidates: Array<
    NativeCaptionCandidate & {
      rationale?: string | null;
    }
  >;
  winnerCandidateId: string | null;
  titles: NativeCaptionTitleOption[];
};

type StageWarning = {
  field: string;
  message: string;
};

type RunPipelineResult = {
  output: ViralShortsStage2Result;
  seo: Stage2SeoOutput | null;
  warnings: StageWarning[];
  diagnostics: Stage2Diagnostics;
  rawDebugArtifact: Stage2RunDebugArtifact | null;
  tokenUsage: Stage2TokenUsage;
};

type ExecutedPromptStageRecord = {
  stageId: Stage2PipelineStageId;
  promptText: string;
  usesImages?: boolean;
  model?: string | null;
  summary: string;
  serializedResultBytes: number | null;
  estimatedOutputTokens: number | null;
};

type Stage2PipelineModelMap = Record<Stage2PromptConfigStageId, string | null>;

type PipelineProgressEvent = {
  stageId: Stage2PipelineStageId;
  state: "running" | "completed" | "failed";
  summary?: string | null;
  detail?: string | null;
  durationMs?: number | null;
  promptChars?: number | null;
  reasoningEffort?: string | null;
};

function resolveStageReasoningEffort(
  stageId: Stage2PipelineStageId,
  promptConfig: Stage2PromptConfig
): string | null {
  const stageConfig = promptConfig.stages[stageId as Stage2PromptConfigStageId];
  return stageConfig?.reasoningEffort ?? null;
}

function formatStageFailure(stageLabel: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) {
    return `${stageLabel} timed out. ${message}`;
  }
  return `${stageLabel} failed. ${message}`;
}

function normalizeWhyItWorks(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

const NULLISH_ANALYZER_VALUES = new Set([
  "",
  "[]",
  "{}",
  "n/a",
  "na",
  "nil",
  "none",
  "null",
  "unknown"
]);

function isNullishAnalyzerText(value: string | null | undefined): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[\s"'`([{]+|[\s"'`)\]}.,:;!?]+$/g, "");
  return NULLISH_ANALYZER_VALUES.has(normalized);
}

function splitMergedAnalyzerListItem(value: string): string[] {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }
  const merged = normalized
    .replace(/['"]\s*,\s*['"]/g, "\n")
    .replace(/\]\s*,\s*\[/g, "\n")
    .replace(/\s+\|\s+/g, "\n");
  return merged
    .split(/\n+/)
    .map((item) => item.replace(/^[\s"'`[\],]+|[\s"'`[\],]+$/g, "").trim())
    .filter(Boolean);
}

function normalizeAnalyzerStringList(
  value: unknown,
  fallback: string[],
  maxItems: number
): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : fallback;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of rawItems) {
    for (const part of splitMergedAnalyzerListItem(String(item ?? ""))) {
      if (isNullishAnalyzerText(part)) {
        continue;
      }
      const dedupeKey = part.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      normalized.push(part);
      if (normalized.length >= maxItems) {
        return normalized;
      }
    }
  }
  return normalized;
}

function normalizeAnalyzerStringValue(value: unknown, fallback: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || isNullishAnalyzerText(normalized)) {
    return fallback;
  }
  return normalized;
}

function mergeUniqueAnalyzerStrings(...groups: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const item of group ?? []) {
      const normalized = String(item ?? "").trim();
      if (!normalized || isNullishAnalyzerText(normalized)) {
        continue;
      }
      const dedupeKey = normalized.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      merged.push(normalized);
    }
  }
  return merged;
}

type CommentIntelligence = {
  slangToAdapt: string[];
  commentLanguageCues: string[];
  hiddenDetail: string | null;
  commentVibe: string | null;
  commentConsensusLane: string | null;
  commentJokeLane: string | null;
  commentDissentLane: string | null;
  commentSuspicionLane: string | null;
  genericRisks: string[];
};

type ScoredComment = {
  likes: number;
  text: string;
  lower: string;
};

type RankedCommentCue = {
  phrase: string;
  score: number;
  mentions: number;
};

const COMMENT_CUE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "get",
  "got",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "too",
  "was",
  "we",
  "were",
  "what",
  "when",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your"
]);

function truncateWords(value: string, maxWords: number): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function truncateCommentLaneText(value: string, maxLength = 120): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildCommentLaneSummary(comments: ScoredComment[], fallbackLead: string): string | null {
  const topComments = comments
    .map((comment) => truncateCommentLaneText(comment.text))
    .filter(Boolean)
    .slice(0, 2);
  if (topComments.length === 0) {
    return null;
  }
  return topComments.length === 1
    ? `${fallbackLead}: ${topComments[0]}.`
    : `${fallbackLead}: ${topComments[0]} | ${topComments[1]}.`;
}

function extractLeadingCommentClause(text: string, maxWords: number): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const firstClause =
    normalized.split(/(?:\.{2,}|[.!?]+|[,;]+|\u2026|\s[-\u2014]\s)/)[0] ?? normalized;
  return truncateWords(firstClause, maxWords).replace(/^"+|"+$/g, "").trim();
}

function extractCommentCueText(text: string): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const quoted = normalized.match(/"([^"]{2,60})"/)?.[1];
  if (quoted) {
    return quoted.trim();
  }
  return extractLeadingCommentClause(normalized, 7);
}

function tokenizeCommentCueWords(text: string): Array<{
  raw: string;
  normalized: string;
  isAcronym: boolean;
}> {
  return Array.from(text.matchAll(/#?[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*/g)).map((match) => {
    const raw = match[0] ?? "";
    const normalized = raw.replace(/^#/, "").toLowerCase();
    return {
      raw: raw.replace(/^#/, ""),
      normalized,
      isAcronym: /^[A-Z]{2,6}$/.test(raw.replace(/^#/, ""))
    };
  });
}

function trimCueStopwordEdges(
  tokens: Array<{
    raw: string;
    normalized: string;
    isAcronym: boolean;
  }>
): Array<{
  raw: string;
  normalized: string;
  isAcronym: boolean;
}> {
  let start = 0;
  let end = tokens.length;
  while (
    start < end &&
    COMMENT_CUE_STOPWORDS.has(tokens[start]?.normalized ?? "") &&
    !tokens[start]?.isAcronym
  ) {
    start += 1;
  }
  while (
    end > start &&
    COMMENT_CUE_STOPWORDS.has(tokens[end - 1]?.normalized ?? "") &&
    !tokens[end - 1]?.isAcronym
  ) {
    end -= 1;
  }
  return tokens.slice(start, end);
}

function hasUsefulCommentCueSignal(
  tokens: Array<{
    raw: string;
    normalized: string;
    isAcronym: boolean;
  }>
): boolean {
  const contentTokens = tokens.filter(
    (token) => token.isAcronym || !COMMENT_CUE_STOPWORDS.has(token.normalized)
  );
  if (contentTokens.length === 0) {
    return false;
  }
  if (contentTokens.some((token) => token.isAcronym)) {
    return true;
  }
  return contentTokens.length >= 2 || contentTokens.some((token) => token.normalized.length >= 6);
}

function extractCommentCueVariants(text: string): string[] {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const variants: string[] = [];
  const seen = new Set<string>();
  const pushVariant = (value: string) => {
    const phrase = value.trim().replace(/^"+|"+$/g, "");
    const dedupeKey = normalizeTextKey(phrase);
    if (!phrase || !dedupeKey || seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    variants.push(phrase);
  };

  const quoted = normalized.match(/"([^"]{2,80})"/)?.[1];
  if (quoted) {
    pushVariant(quoted);
  }

  const primaryClause = extractLeadingCommentClause(normalized, 9);
  if (primaryClause) {
    pushVariant(primaryClause);
  }

  const clauseTokens = trimCueStopwordEdges(tokenizeCommentCueWords(primaryClause || normalized));
  if (clauseTokens.length === 0) {
    return variants;
  }

  for (let index = 0; index < clauseTokens.length; index += 1) {
    if (!clauseTokens[index]?.isAcronym) {
      continue;
    }
    const start = Math.max(0, index - 3);
    const end = Math.min(clauseTokens.length, index + 3);
    const span = trimCueStopwordEdges(clauseTokens.slice(start, end));
    if (span.length > 0 && hasUsefulCommentCueSignal(span)) {
      pushVariant(span.map((token) => token.raw).join(" "));
    }
  }

  for (let size = Math.min(5, clauseTokens.length); size >= 2; size -= 1) {
    for (let index = 0; index <= clauseTokens.length - size; index += 1) {
      const span = trimCueStopwordEdges(clauseTokens.slice(index, index + size));
      if (!span.length || !hasUsefulCommentCueSignal(span)) {
        continue;
      }
      pushVariant(span.map((token) => token.raw).join(" "));
    }
  }

  return variants.slice(0, 6);
}

function scoreRankedCommentCue(phrase: string): number {
  let score = 0;
  if (/[A-Z]{2,6}/.test(phrase)) {
    score += 3;
  }
  const words = phrase.split(/\s+/).filter(Boolean);
  if (words.length === 2) {
    score += 4;
  } else if (words.length === 3) {
    score += 3;
  } else if (words.length === 4) {
    score += 2;
  } else if (words.length === 5) {
    score += 1;
  }
  if (/['"]/.test(phrase)) {
    score += 1;
  }
  if (/\b(?:mode|energy|driver|enemy|elite|normal day)\b/i.test(phrase)) {
    score += 1;
  }
  return score;
}

function buildRankedCommentCues(comments: ScoredComment[]): RankedCommentCue[] {
  const cueMap = new Map<string, { phrase: string; score: number; mentions: number }>();
  for (const comment of comments) {
    const baseWeight = Math.max(1, Math.min(8, Math.floor(Math.log10(comment.likes + 10))));
    const cueVariants = extractCommentCueVariants(comment.text);
    for (const [index, cue] of cueVariants.entries()) {
      const key = normalizeTextKey(cue);
      if (!key || key.length < 4) {
        continue;
      }
      const entry = cueMap.get(key) ?? {
        phrase: cue,
        score: 0,
        mentions: 0
      };
      entry.phrase =
        cue.length < entry.phrase.length || /^[A-Z]{2,6}\b/.test(cue) ? cue : entry.phrase;
      entry.score += baseWeight + scoreRankedCommentCue(cue) + (index === 0 ? 2 : 0);
      entry.mentions += 1;
      cueMap.set(key, entry);
    }
  }
  return Array.from(cueMap.values())
    .sort((left, right) => {
      const leftWordCount = left.phrase.split(/\s+/).filter(Boolean).length;
      const rightWordCount = right.phrase.split(/\s+/).filter(Boolean).length;
      return (
        right.score - left.score ||
        right.mentions - left.mentions ||
        leftWordCount - rightWordCount ||
        left.phrase.length - right.phrase.length ||
        left.phrase.localeCompare(right.phrase)
      );
    })
    .slice(0, 12);
}

function computeCommentPunchlineScore(comment: ScoredComment): number {
  const cue = extractCommentCueText(comment.text);
  const baseWeight = Math.max(1, Math.min(8, Math.floor(Math.log10(comment.likes + 10))));
  let score = baseWeight;
  if (/\b(lol|lmao|lmfao|haha|ahah|bro)\b|[😂🤣😭💀😅]/i.test(comment.text)) {
    score += 2;
  }
  if (/\.{2,}|!{2,}|#+/.test(comment.text)) {
    score += 1;
  }
  if (/[A-Z]{2,6}/.test(comment.text)) {
    score += 2;
  }
  if (cue && cue.split(/\s+/).filter(Boolean).length <= 7) {
    score += 1;
  }
  return score;
}

function deriveCommentIntelligence(
  comments: ViralShortsVideoContext["comments"]
): CommentIntelligence {
  const sortedComments = [...comments]
    .sort((left, right) => right.likes - left.likes)
    .slice(0, 40)
    .map((comment) => ({
      likes: comment.likes,
      text: String(comment.text ?? "").replace(/\s+/g, " ").trim(),
      lower: String(comment.text ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
    }))
    .filter((comment) => comment.text);

  if (sortedComments.length === 0) {
    return {
      slangToAdapt: [],
      commentLanguageCues: [],
      hiddenDetail: null,
      commentVibe: null,
      commentConsensusLane: null,
      commentJokeLane: null,
      commentDissentLane: null,
      commentSuspicionLane: null,
      genericRisks: []
    };
  }

  const rankedCues = buildRankedCommentCues(sortedComments);
  const suspicionComments: ScoredComment[] = [];
  const dissentComments: ScoredComment[] = [];
  const jokeCandidates: Array<ScoredComment & { punchlineScore: number }> = [];
  const consensusComments: ScoredComment[] = [];
  const dissentPattern =
    /\b(cringe|corny|overrated|staged|scripted|setup|set up|manufactured|fake|pre[- ]?opened|resealed|tampered|not that deep|not that serious|it'?s a movie|from a movie|just acting|equality)\b/;
  const suspicionPattern =
    /\b(fake|pre[- ]?opened|already open(?:ed)?|resealed|tampered|cut and switch|planted|staged|scripted|cgi|setup|set up)\b/;
  const jokePattern =
    /\b(lol|lmao|lmfao|haha|ahah|😭|😂|💀|bro|ahh|mode|queen|lady|what\b)\b|[:]{1,}/;

  for (const comment of sortedComments) {
    const lower = comment.text.toLowerCase();

    const suspicious = suspicionPattern.test(lower);
    const dissenting = dissentPattern.test(lower);
    const punchlineScore = computeCommentPunchlineScore(comment);
    const joking = jokePattern.test(lower) || punchlineScore >= 5;

    if (suspicious) {
      suspicionComments.push(comment);
    }
    if (dissenting && !suspicious) {
      dissentComments.push(comment);
    }
    if (joking && !suspicious) {
      jokeCandidates.push({
        ...comment,
        punchlineScore
      });
    }
    if (!suspicious && !dissenting) {
      consensusComments.push(comment);
    }
  }

  const jokeComments = jokeCandidates
    .sort((left, right) => right.punchlineScore - left.punchlineScore || right.likes - left.likes)
    .slice(0, 8)
    .map(({ punchlineScore: _punchlineScore, ...comment }) => comment);
  const slangToAdapt = rankedCues.map((cue) => cue.phrase).slice(0, 5);
  const commentLanguageCues = mergeUniqueAnalyzerStrings(
    rankedCues.map((cue) => cue.phrase).slice(0, 6),
    sortedComments.map((comment) => extractCommentCueText(comment.text))
  ).slice(0, 6);

  const dominantCue = rankedCues[0]?.phrase ?? null;
  const hasSuspicion = suspicionComments.length > 0;
  const hasJokes = jokeComments.length > 0;
  const hasDissent = dissentComments.length > 0;

  let hiddenDetail: string | null = null;
  const genericRisks: string[] = [];
  if (hasSuspicion) {
    hiddenDetail =
      "A noticeable chunk of the comments reads hidden incompetence, staging, tampering, or fakery into the clip instead of taking it at face value.";
    genericRisks.push(
      "treating audience suspicion as confirmed fact when the clip itself only supports a read, joke, or accusation"
    );
  } else if (hasDissent) {
    hiddenDetail =
      "Some viewers push back on the easy interpretation, which means later stages should not flatten the audience into one fake consensus.";
  } else if (dominantCue) {
    hiddenDetail =
      `The audience keeps circling one compact read or punchline: "${dominantCue}".`;
  }

  const commentVibe =
    hasSuspicion && hasJokes
      ? "Mocking punchlines and suspicious self-own reads are both active in the comments."
      : hasSuspicion
        ? "Comments keep reading the moment as incompetence, staging, or a hidden self-own."
        : hasJokes && hasDissent
          ? "Comments split between lived-in jokes and pushback against the obvious read."
          : hasJokes
            ? "Comments lean into punchline-style, lived-in reactions more than dry explanation."
            : hasDissent
              ? "Comments are visibly split instead of agreeing on one clean reaction."
              : dominantCue
                ? `Comments keep orbiting one compact audience read: "${dominantCue}".`
                : "Comments mostly reinforce the main visible beat without much resistance.";

  if (hasJokes && hasDissent) {
    genericRisks.push("flattening mixed joke and pushback lanes into one neat consensus");
  }
  if (hasJokes && dominantCue) {
    genericRisks.push("missing the dominant audience shorthand when it would sharpen the bottom naturally");
  }

  return {
    slangToAdapt,
    commentLanguageCues,
    hiddenDetail,
    commentVibe,
    commentConsensusLane:
      buildCommentLaneSummary(
        consensusComments,
        "Consensus lane keeps gravitating toward the main visible reaction"
      ) ??
      buildCommentLaneSummary(
        sortedComments.slice(0, 2),
        "Consensus lane stays close to the most replayable visible beat"
      ),
    commentJokeLane: buildCommentLaneSummary(
      jokeComments,
      "Joke or meme lane keeps phrasing the moment like a lived-in punchline"
    ),
    commentDissentLane: buildCommentLaneSummary(
      dissentComments,
      "Dissent lane pushes back on the easy read instead of fully buying the main reaction"
    ),
    commentSuspicionLane: buildCommentLaneSummary(
      suspicionComments,
      "Suspicion lane reads a hidden motive, fake setup, or off-screen explanation into the clip"
    ),
    genericRisks
  };
}

function isGenericCommentVibe(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "unknown" ||
    normalized === "observational reaction" ||
    normalized === "comment reaction" ||
    normalized === "general audience reaction"
  );
}

function applyCommentIntelligenceBoost(
  analyzerOutput: AnalyzerOutput,
  comments: ViralShortsVideoContext["comments"]
): AnalyzerOutput {
  if (comments.length === 0) {
    return analyzerOutput;
  }

  const intelligence = deriveCommentIntelligence(comments);
  const slangToAdapt = mergeUniqueAnalyzerStrings(
    intelligence.slangToAdapt,
    analyzerOutput.slangToAdapt,
    analyzerOutput.extractableSlang
  ).slice(0, 5);
  const hiddenDetail = intelligence.hiddenDetail
    ? intelligence.hiddenDetail
    : analyzerOutput.hiddenDetail;
  const commentVibe =
    intelligence.commentVibe && isGenericCommentVibe(analyzerOutput.commentVibe)
      ? intelligence.commentVibe
      : analyzerOutput.commentVibe;
  const commentConsensusLane = intelligence.commentConsensusLane
    ? intelligence.commentConsensusLane
    : analyzerOutput.commentConsensusLane;
  const commentJokeLane = intelligence.commentJokeLane
    ? intelligence.commentJokeLane
    : analyzerOutput.commentJokeLane;
  const commentDissentLane = intelligence.commentDissentLane
    ? intelligence.commentDissentLane
    : analyzerOutput.commentDissentLane;
  const commentSuspicionLane = intelligence.commentSuspicionLane
    ? intelligence.commentSuspicionLane
    : analyzerOutput.commentSuspicionLane;
  const genericRisks = mergeUniqueAnalyzerStrings(
    analyzerOutput.genericRisks,
    intelligence.genericRisks
  ).slice(0, 6);
  const commentLanguageCues = mergeUniqueAnalyzerStrings(
    intelligence.commentLanguageCues,
    analyzerOutput.commentLanguageCues,
    analyzerOutput.slangToAdapt
  ).slice(0, 6);

  return {
    ...analyzerOutput,
    commentVibe,
    commentConsensusLane,
    commentJokeLane,
    commentDissentLane,
    commentSuspicionLane,
    slangToAdapt,
    commentLanguageCues,
    extractableSlang: slangToAdapt,
    hiddenDetail,
    genericRisks
  };
}

function normalizeAnalyzerOutput(raw: unknown, fallback: AnalyzerOutput): AnalyzerOutput {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const visualAnchorsRaw = Array.isArray(obj.visual_anchors)
    ? obj.visual_anchors
    : Array.isArray(obj.visualAnchors)
      ? obj.visualAnchors
      : fallback.visualAnchors;
  const specificNounsRaw = Array.isArray(obj.specific_nouns)
    ? obj.specific_nouns
    : Array.isArray(obj.specificNouns)
      ? obj.specificNouns
      : fallback.specificNouns;
  const visibleActionsRaw = Array.isArray(obj.visible_actions)
    ? obj.visible_actions
    : Array.isArray(obj.visibleActions)
      ? obj.visibleActions
      : fallback.visibleActions;
  const sceneBeatsRaw = Array.isArray(obj.scene_beats)
    ? obj.scene_beats
    : Array.isArray(obj.sceneBeats)
      ? obj.sceneBeats
      : fallback.sceneBeats;
  const slangToAdaptRaw = Array.isArray(obj.slang_to_adapt)
    ? obj.slang_to_adapt
    : Array.isArray(obj.extractable_slang)
      ? obj.extractable_slang
      : Array.isArray(obj.slangToAdapt)
        ? obj.slangToAdapt
        : Array.isArray(obj.extractableSlang)
        ? obj.extractableSlang
          : fallback.slangToAdapt;
  const commentLanguageCuesRaw = Array.isArray(obj.comment_language_cues)
    ? obj.comment_language_cues
    : Array.isArray(obj.commentLanguageCues)
      ? obj.commentLanguageCues
      : fallback.commentLanguageCues;
  const stakesRaw = Array.isArray(obj.stakes) ? obj.stakes : fallback.stakes;
  const genericRisksRaw = Array.isArray(obj.generic_risks)
    ? obj.generic_risks
    : Array.isArray(obj.genericRisks)
      ? obj.genericRisks
      : fallback.genericRisks;
  const uncertaintyNotesRaw = Array.isArray(obj.uncertainty_notes)
    ? obj.uncertainty_notes
    : Array.isArray(obj.uncertaintyNotes)
      ? obj.uncertaintyNotes
      : fallback.uncertaintyNotes;

  return {
    visualAnchors: normalizeAnalyzerStringList(visualAnchorsRaw, fallback.visualAnchors, 5),
    specificNouns: normalizeAnalyzerStringList(specificNounsRaw, fallback.specificNouns, 8),
    visibleActions: normalizeAnalyzerStringList(visibleActionsRaw, fallback.visibleActions, 5),
    subject: normalizeAnalyzerStringValue(obj.subject, fallback.subject),
    action: normalizeAnalyzerStringValue(obj.action ?? visibleActionsRaw[0], fallback.action),
    setting: normalizeAnalyzerStringValue(obj.setting, fallback.setting),
    firstSecondsSignal: normalizeAnalyzerStringValue(
      obj.first_seconds_signal ?? obj.firstSecondsSignal,
      fallback.firstSecondsSignal
    ),
    sceneBeats: normalizeAnalyzerStringList(sceneBeatsRaw, fallback.sceneBeats, 8),
    revealMoment: normalizeAnalyzerStringValue(
      obj.reveal_moment ?? obj.revealMoment,
      fallback.revealMoment
    ),
    lateClipChange: normalizeAnalyzerStringValue(
      obj.late_clip_change ?? obj.lateClipChange,
      fallback.lateClipChange
    ),
    stakes: normalizeAnalyzerStringList(stakesRaw, fallback.stakes, 6),
    payoff: normalizeAnalyzerStringValue(obj.payoff, fallback.payoff),
    coreTrigger: normalizeAnalyzerStringValue(
      obj.core_trigger ?? obj.coreTrigger,
      fallback.coreTrigger
    ),
    humanStake: normalizeAnalyzerStringValue(
      obj.human_stake ?? obj.humanStake,
      fallback.humanStake
    ),
    narrativeFrame: normalizeAnalyzerStringValue(
      obj.narrative_frame ?? obj.narrativeFrame,
      fallback.narrativeFrame
    ),
    whyViewerCares: normalizeAnalyzerStringValue(
      obj.why_viewer_cares ?? obj.whyViewerCares,
      fallback.whyViewerCares
    ),
    bestBottomEnergy: normalizeAnalyzerStringValue(
      obj.best_bottom_energy ?? obj.bestBottomEnergy,
      fallback.bestBottomEnergy
    ),
    commentVibe: normalizeAnalyzerStringValue(
      obj.comment_vibe ?? obj.commentVibe,
      fallback.commentVibe
    ),
    commentConsensusLane: normalizeAnalyzerStringValue(
      obj.comment_consensus_lane ?? obj.commentConsensusLane,
      fallback.commentConsensusLane
    ),
    commentJokeLane: normalizeAnalyzerStringValue(
      obj.comment_joke_lane ?? obj.commentJokeLane,
      fallback.commentJokeLane
    ),
    commentDissentLane: normalizeAnalyzerStringValue(
      obj.comment_dissent_lane ?? obj.commentDissentLane,
      fallback.commentDissentLane
    ),
    commentSuspicionLane: normalizeAnalyzerStringValue(
      obj.comment_suspicion_lane ?? obj.commentSuspicionLane,
      fallback.commentSuspicionLane
    ),
    slangToAdapt: normalizeAnalyzerStringList(slangToAdaptRaw, fallback.slangToAdapt, 5),
    commentLanguageCues: normalizeAnalyzerStringList(
      commentLanguageCuesRaw,
      fallback.commentLanguageCues,
      6
    ),
    extractableSlang: normalizeAnalyzerStringList(
      slangToAdaptRaw,
      fallback.extractableSlang,
      5
    ),
    hiddenDetail: normalizeAnalyzerStringValue(
      obj.hidden_detail ?? obj.hiddenDetail,
      fallback.hiddenDetail
    ),
    genericRisks: normalizeAnalyzerStringList(genericRisksRaw, fallback.genericRisks, 6),
    uncertaintyNotes: normalizeAnalyzerStringList(
      uncertaintyNotesRaw,
      fallback.uncertaintyNotes,
      5
    ),
    rawSummary: normalizeAnalyzerStringValue(
      obj.raw_summary ?? obj.rawSummary,
      fallback.rawSummary
    )
  };
}

function applyNoCommentsTruthfulnessGuard(
  analyzerOutput: AnalyzerOutput,
  commentsAvailable: boolean
): AnalyzerOutput {
  if (commentsAvailable) {
    return analyzerOutput;
  }

  const noCommentsNote =
    "Comments were unavailable for this run, so audience vibe should be inferred from the visuals, title, description, and transcript rather than a real comment consensus.";
  const genericRisks = analyzerOutput.genericRisks.includes(
    "inventing comment-section consensus when comments are unavailable"
  )
    ? analyzerOutput.genericRisks
    : [
        ...analyzerOutput.genericRisks,
        "inventing comment-section consensus when comments are unavailable"
      ].slice(0, 6);
  const uncertaintyNotes = analyzerOutput.uncertaintyNotes.includes(noCommentsNote)
    ? analyzerOutput.uncertaintyNotes
    : [...analyzerOutput.uncertaintyNotes, noCommentsNote].slice(0, 5);

  return {
    ...analyzerOutput,
    commentVibe:
      "Comments unavailable; lean on the clip's visual sequence and transcript instead of pretending there was a real crowd consensus.",
    commentConsensusLane: "Comments unavailable, so there is no reliable consensus lane to quote.",
    commentJokeLane: "",
    commentDissentLane: "",
    commentSuspicionLane: "",
    commentLanguageCues: [],
    genericRisks,
    uncertaintyNotes
  };
}

function buildCorpusQueryText(videoContext: ViralShortsVideoContext, analyzerOutput: AnalyzerOutput): string {
  return [
    videoContext.title,
    videoContext.description,
    videoContext.transcript,
    analyzerOutput.rawSummary,
    analyzerOutput.visualAnchors.join(" "),
    analyzerOutput.specificNouns.join(" "),
    analyzerOutput.visibleActions.join(" "),
    analyzerOutput.firstSecondsSignal,
    analyzerOutput.sceneBeats.join(" "),
    analyzerOutput.revealMoment,
    analyzerOutput.lateClipChange,
    analyzerOutput.stakes.join(" "),
    analyzerOutput.payoff,
    analyzerOutput.coreTrigger,
    analyzerOutput.humanStake,
    analyzerOutput.narrativeFrame,
    analyzerOutput.whyViewerCares,
    analyzerOutput.bestBottomEnergy,
    analyzerOutput.hiddenDetail,
    analyzerOutput.uncertaintyNotes.join(" "),
    analyzerOutput.slangToAdapt.join(" ")
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
}

function scoreExampleMatch(queryText: string, example: Stage2CorpusExample): number {
  return (
    scoreTextMatch(queryText, {
      title: example.title,
      overlayTop: example.overlayTop,
      overlayBottom: example.overlayBottom,
      transcript: example.transcript,
      clipType: example.clipType
    }) + (typeof example.qualityScore === "number" ? example.qualityScore : 0)
  );
}

function pickExamplesForMode(input: {
  availableExamples: Stage2CorpusExample[];
  assessment: Stage2ExamplesAssessment;
  exampleInsights: Array<{
    exampleId: string;
    guidanceRole: Stage2ExampleGuidanceRole;
  }>;
}): Stage2CorpusExample[] {
  const insightById = new Map(
    input.exampleInsights.map((entry) => [entry.exampleId, entry.guidanceRole] as const)
  );
  const preferredRoles =
    input.assessment.examplesMode === "domain_guided"
      ? (["semantic_guidance", "form_guidance", "weak_support"] as const)
      : input.assessment.examplesMode === "form_guided"
        ? (["form_guidance", "semantic_guidance", "weak_support"] as const)
        : (["form_guidance", "weak_support", "semantic_guidance"] as const);
  const targetCount =
    input.assessment.examplesMode === "domain_guided"
      ? 6
      : input.assessment.examplesMode === "form_guided"
        ? 4
        : 3;
  const ordered = preferredRoles.flatMap((role) =>
    input.availableExamples.filter((example) => (insightById.get(example.id) ?? "weak_support") === role)
  );
  return ordered.slice(0, Math.min(targetCount, ordered.length));
}

function applyExamplesAssessmentToSelectorOutput(
  selectorOutput: SelectorOutput,
  assessment: Stage2ExamplesAssessment
): SelectorOutput {
  return {
    ...selectorOutput,
    retrievalConfidence: assessment.retrievalConfidence,
    examplesMode: assessment.examplesMode,
    retrievalExplanation: assessment.explanation,
    retrievalEvidence: assessment.evidence,
    retrievalWarning: assessment.retrievalWarning,
    examplesRoleSummary: assessment.examplesRoleSummary,
    primaryDriverSummary: assessment.primaryDriverSummary
  };
}

function buildLegacyFallbackReason(
  featureFlags: Stage2PipelineExecution["featureFlags"],
  pipelineVersion: Stage2PipelineExecution["pipelineVersion"]
): string | null {
  if (pipelineVersion === "native_caption_v3" || pipelineVersion === "vnext") {
    return null;
  }
  if (featureFlags.STAGE2_VNEXT_ENABLED) {
    return null;
  }
  if (featureFlags.source === "override") {
    return "stage2VNextEnabled override explicitly forced legacy mode in the worker path.";
  }
  if (featureFlags.source === "env") {
    return `Worker env resolved STAGE2_VNEXT_ENABLED=${featureFlags.rawValue ?? "false"}, so the pipeline stayed on legacy mode.`;
  }
  return "STAGE2_VNEXT_ENABLED was absent in the worker environment, so Stage 2 resolved to legacy mode by default.";
}

function buildStage2PipelineExecutionSnapshot(input: {
  featureFlags: Stage2PipelineExecution["featureFlags"];
  pipelineVersion: Stage2PipelineExecution["pipelineVersion"];
  pathVariant?: Stage2PipelineExecution["pathVariant"];
  stageChainVersion: string;
  workerBuild: Stage2PipelineExecution["workerBuild"];
  resolvedAt: string;
}): Stage2PipelineExecution {
  return {
    featureFlags: input.featureFlags,
    pipelineVersion: input.pipelineVersion,
    pathVariant: input.pathVariant,
    stageChainVersion: input.stageChainVersion,
    workerBuild: input.workerBuild,
    resolvedAt: input.resolvedAt,
    legacyFallbackReason: buildLegacyFallbackReason(input.featureFlags, input.pipelineVersion),
    promptPolicyVersion: STAGE2_PROMPT_POLICY_VERSION,
    selectorOutputAuthority:
      input.pipelineVersion === "native_caption_v3"
        ? "derived_non_authoritative"
        : "authoritative"
  };
}

const NATIVE_CAPTION_MINIMUM_VALID_FINALISTS = 2;
const STAGE2_PROMPT_POLICY_VERSION = "native_defaults_authoritative_v2_platform_lines";
const STAGE2_ONE_SHOT_PROMPT_COMPATIBILITY_FAMILY = "native_caption_v3_product_owned";

function buildNativeCaptionExamplesAssessment(
  channelConfig: Stage2RuntimeChannelConfig
): Stage2ExamplesAssessment {
  return {
    retrievalConfidence: "low",
    examplesMode: "style_guided",
    explanation: "Examples are disabled in native_caption_v3 by default.",
    evidence: [],
    retrievalWarning: null,
    examplesRoleSummary: "Examples are disabled for native_caption_v3.",
    primaryDriverSummary:
      "Primary driver is the clip context packet, the selected platform line, and channel learning.",
    primaryDrivers: ["clip_context", "platform_line", "style_card", "channel_learning"],
    channelStylePriority: "primary",
    editorialMemoryPriority: "supporting"
  };
}

function buildNativeCaptionChannelLearningPayload(
  channelConfig: Stage2RuntimeChannelConfig,
  detail: "minimal" | "compact"
) {
  const channelLearning = buildStage2LearningPromptContext({
    profile: channelConfig.styleProfile,
    editorialMemory: channelConfig.editorialMemory,
    detail
  });
  return {
    payload: channelLearning,
    usage: {
      detail,
      selectedDirectionCount: channelLearning.bootstrap.selectedDirectionCount,
      highlightedDirectionIds: channelLearning.bootstrap.directionHighlights.map((entry) => entry.id),
      explorationShare:
        typeof channelLearning.bootstrap.explorationShare === "number"
          ? channelLearning.bootstrap.explorationShare
          : null,
      recentFeedbackCount: channelLearning.editorialMemory.recentFeedbackCount,
      recentSelectionCount: channelLearning.editorialMemory.recentSelectionCount,
      promptSummary:
        channelLearning.editorialMemory.promptSummary ||
        channelLearning.bootstrap.lessons.summary ||
        channelLearning.bootstrap.selectionSummary ||
        null
    }
  };
}

type ReferenceOneShotVariantConfig = {
  label: string;
  promptText: string;
  promptVersion: string;
  pathVariant: Stage2PipelineExecution["pathVariant"];
  stageSummary: string;
  stageFlags: string[];
  commentsLimit: number;
  weakGroundingCommentsLimit: number;
  failLabel: string;
  antiMetaValidation: boolean;
};

function isWeakReferenceOneShotSourceGrounding(videoContext: ViralShortsVideoContext): boolean {
  const sourceSummary = buildStage2SourceContextSummary(videoContext);
  return (
    videoContext.description.trim().length === 0 &&
    videoContext.transcript.trim().length === 0 &&
    sourceSummary.speechGroundingStatus !== "transcript_present"
  );
}

function resolveReferenceOneShotVariantConfig(
  channelConfig: Stage2RuntimeChannelConfig
): ReferenceOneShotVariantConfig {
  if (channelConfig.workerProfile?.executionMode === "one_shot_reference_v1_experimental") {
    return {
      label: "Reference one-shot experimental",
      promptText: STAGE2_REFERENCE_ONE_SHOT_EXPERIMENTAL_PROMPT,
      promptVersion: STAGE2_REFERENCE_ONE_SHOT_EXPERIMENTAL_PROMPT_VERSION,
      pathVariant: "reference_one_shot_v1_experimental",
      stageSummary:
        "Product-owned experimental one-shot baseline: returns the final 5 publishable reference-style options with anti-meta guardrails, context-first paraphrase, and stronger editorial-memory steering.",
      stageFlags: [
        "one-shot baseline",
        "product-owned prompt",
        "context-first anti-meta contract",
        "weak-grounding comment rebalance",
        "same-line editorial memory promoted",
        "quality-first fail hard",
        "no deterministic backfill"
      ],
      commentsLimit: 14,
      weakGroundingCommentsLimit: 8,
      failLabel: "Reference one-shot experimental",
      antiMetaValidation: true
    };
  }

  return {
    label: "Reference one-shot",
    promptText: STAGE2_REFERENCE_ONE_SHOT_PROMPT,
    promptVersion: STAGE2_REFERENCE_ONE_SHOT_PROMPT_VERSION,
    pathVariant: "reference_one_shot_v1",
    stageSummary:
      "Product-owned one-shot baseline: returns the final 5 publishable reference-style options directly from video truth, comments, line policy, channel narrative, and editorial memory.",
    stageFlags: [
      "one-shot baseline",
      "product-owned prompt",
      "video truth first",
      "current comment wave",
      "channel narrative",
      "editorial memory",
      "quality-first fail hard",
      "no deterministic backfill"
    ],
    commentsLimit: 18,
    weakGroundingCommentsLimit: 18,
    failLabel: "Reference one-shot",
    antiMetaValidation: false
  };
}

function buildReferenceOneShotVideoTruthPayload(input: {
  videoContext: ViralShortsVideoContext;
  analyzerOutput: AnalyzerOutput;
}) {
  const sourceSummary = buildStage2SourceContextSummary(input.videoContext);
  return {
    title: input.videoContext.title,
    description_or_null: input.videoContext.description.trim() || null,
    transcript_status: sourceSummary.speechGroundingStatus,
    transcript_or_null: input.videoContext.transcript.trim() || null,
    frames: input.videoContext.frameDescriptions,
    visible_facts_seed: {
      visual_anchors: input.analyzerOutput.visualAnchors.slice(0, 5),
      specific_nouns: input.analyzerOutput.specificNouns.slice(0, 8),
      visible_actions: input.analyzerOutput.visibleActions.slice(0, 8),
      first_seconds_signal: input.analyzerOutput.firstSecondsSignal,
      scene_beats: input.analyzerOutput.sceneBeats.slice(0, 5),
      reveal_moment: input.analyzerOutput.revealMoment,
      late_clip_change: input.analyzerOutput.lateClipChange,
      hidden_detail: input.analyzerOutput.hiddenDetail,
      generic_risks: input.analyzerOutput.genericRisks.slice(0, 6),
      uncertainty_notes: input.analyzerOutput.uncertaintyNotes.slice(0, 5)
    }
  };
}

function buildReferenceOneShotCommentWavePayload(input: {
  videoContext: ViralShortsVideoContext;
  analyzerOutput: AnalyzerOutput;
  variant: ReferenceOneShotVariantConfig;
}) {
  const commentLimit =
    input.variant.weakGroundingCommentsLimit < input.variant.commentsLimit &&
    isWeakReferenceOneShotSourceGrounding(input.videoContext)
      ? input.variant.weakGroundingCommentsLimit
      : input.variant.commentsLimit;
  return {
    comments: input.videoContext.comments.slice(0, commentLimit).map((comment) => ({
      author: comment.author,
      likes: comment.likes,
      text: comment.text
    })),
    comment_digest_json: buildCommentPromptDigest(input.videoContext.comments),
    consensus_lane: input.analyzerOutput.commentConsensusLane,
    joke_lane: input.analyzerOutput.commentJokeLane,
    dissent_lane: input.analyzerOutput.commentDissentLane,
    suspicion_lane: input.analyzerOutput.commentSuspicionLane,
    comment_vibe_seed: input.analyzerOutput.commentVibe,
    language_cues: input.analyzerOutput.commentLanguageCues.slice(0, 6),
    slang_to_adapt: input.analyzerOutput.slangToAdapt.slice(0, 5)
  };
}

function buildReferenceOneShotChannelNarrativePayload(
  channelConfig: Stage2RuntimeChannelConfig
) {
  const styleProfile = normalizeStage2StyleProfile(channelConfig.styleProfile);
  const channelLearning = buildStage2LearningPromptContext({
    profile: styleProfile,
    editorialMemory: channelConfig.editorialMemory,
    detail: "compact"
  });
  const selectedDirections = styleProfile.candidateDirections
    .filter((direction) => styleProfile.selectedDirectionIds.includes(direction.id))
    .slice(0, 4);
  return {
    selected_directions: selectedDirections.map((direction) => ({
      id: direction.id,
      name: direction.name,
      fit_band: direction.fitBand,
      voice: direction.voice,
      top_pattern: direction.topPattern,
      bottom_pattern: direction.bottomPattern,
      best_for: direction.bestFor,
      avoids: direction.avoids
    })),
    reference_influence_summary: channelLearning.bootstrap.referenceInfluenceSummary,
    bootstrap_confidence: channelLearning.bootstrap.bootstrapConfidence,
    audience_portrait_summary: channelLearning.bootstrap.audiencePortraitSummary,
    packaging_portrait_summary: channelLearning.bootstrap.packagingPortraitSummary,
    selection_summary: channelLearning.bootstrap.selectionSummary,
    lessons_summary: channelLearning.bootstrap.lessons.summary,
    top_narrator_lessons: channelLearning.bootstrap.lessons.topMoves,
    bottom_narrator_lessons: channelLearning.bootstrap.lessons.bottomMoves
  };
}

function buildReferenceOneShotEditorialMemoryPayload(
  channelConfig: Stage2RuntimeChannelConfig
) {
  const editorialMemory = buildStage2LearningPromptContext({
    profile: channelConfig.styleProfile,
    editorialMemory: channelConfig.editorialMemory,
    detail: "compact"
  }).editorialMemory;
  const positiveDirectionPull = editorialMemory.directionScores
    .filter((entry) => entry.score > 0)
    .slice(0, 3);
  const negativeDirectionPull = [...editorialMemory.directionScores]
    .reverse()
    .filter((entry) => entry.score < 0)
    .slice(0, 3);
  const positiveAnglePull = editorialMemory.angleScores
    .filter((entry) => entry.score > 0)
    .slice(0, 3);
  const negativeAnglePull = [...editorialMemory.angleScores]
    .reverse()
    .filter((entry) => entry.score < 0)
    .slice(0, 3);
  return {
    active_hard_rules: editorialMemory.hardRuleNotes,
    recent_positive_pull: {
      directions: positiveDirectionPull,
      angles: positiveAnglePull
    },
    recent_negative_pull: {
      directions: negativeDirectionPull,
      angles: negativeAnglePull
    },
    recent_notes: editorialMemory.recentNotes,
    passive_selection_count: editorialMemory.recentSelectionCount,
    normalized_tone_axes: editorialMemory.normalizedAxes,
    prompt_summary: editorialMemory.promptSummary
  };
}

function buildReferenceOneShotPrompt(input: {
  videoContext: ViralShortsVideoContext;
  channelConfig: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  variant: ReferenceOneShotVariantConfig;
}): string {
  const basePayload = {
    video_truth_json: buildReferenceOneShotVideoTruthPayload(input),
    current_comment_wave_json: buildReferenceOneShotCommentWavePayload(input),
    line_profile_json: buildStage2WorkerProfilePromptPayload(
      getResolvedStage2WorkerProfile(input.channelConfig)
    ),
    channel_narrative_json: buildReferenceOneShotChannelNarrativePayload(
      input.channelConfig
    ),
    editorial_memory_json: buildReferenceOneShotEditorialMemoryPayload(
      input.channelConfig
    ),
    publishability_contract_json: {
      top_window: {
        min: input.channelConfig.hardConstraints.topLengthMin,
        max: input.channelConfig.hardConstraints.topLengthMax
      },
      bottom_window: {
        min: input.channelConfig.hardConstraints.bottomLengthMin,
        max: input.channelConfig.hardConstraints.bottomLengthMax
      },
      exact_length_required: true,
      fail_closed_if_any_candidate_misses_window: true,
      must_count_every_candidate_before_return: true
    },
    hard_constraints_json: input.channelConfig.hardConstraints,
    user_instruction: input.videoContext.userInstruction?.trim() || null
  };
  if (!input.variant.antiMetaValidation) {
    return renderJsonPrompt(input.variant.promptText, basePayload);
  }
  return renderJsonPrompt(input.variant.promptText, {
    ...basePayload,
    experimental_contract_json: {
      mode: "context_first_antimeta_reference",
      weak_grounding_mode: isWeakReferenceOneShotSourceGrounding(input.videoContext)
        ? "comments_secondary_hints_only"
        : "comments_can_supply_harmless_phrasing",
      anti_meta_bans: [
        "the clip",
        "the video",
        "the edit",
        "the footage",
        "the comments",
        "comment sections",
        "viewers"
      ],
      editorial_memory_priority: "active_hard_rules_override_comment_wave_style"
    }
  });
}

function normalizeReferenceOneShotResult(
  raw: unknown
): NativeReferenceOneShotResult {
  const candidate = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const analysisCandidate =
    candidate.analysis && typeof candidate.analysis === "object"
      ? (candidate.analysis as Record<string, unknown>)
      : {};
  const candidateEntries = Array.isArray(candidate.candidates) ? candidate.candidates : [];
  const usedIds = new Set<string>();
  const normalizedCandidates = candidateEntries
    .map((entry, index) => {
      const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const top = String(item.top ?? "").trim();
      const bottom = String(item.bottom ?? "").trim();
      if (!bottom) {
        return null;
      }
      const baseId = String(item.candidate_id ?? item.candidateId ?? `cand_${index + 1}`)
        .trim()
        .replace(/\s+/g, "_");
      let candidateId = baseId || `cand_${index + 1}`;
      let suffix = 1;
      while (usedIds.has(candidateId)) {
        candidateId = `${baseId}_${suffix}`;
        suffix += 1;
      }
      usedIds.add(candidateId);
      const retainedHandle =
        typeof (item.retained_handle ?? item.retainedHandle) === "boolean"
          ? Boolean(item.retained_handle ?? item.retainedHandle)
          : false;
      return {
        candidateId,
        laneId: retainedHandle ? "audience_locked_reference" : "explanatory_paradox",
        angle: retainedHandle ? "audience_locked_reference" : "explanatory_paradox",
        top,
        bottom,
        retainedHandle,
        displayIntent: "finalist_or_display_safe" as const,
        rationale:
          typeof item.rationale === "string" && item.rationale.trim()
            ? item.rationale.trim()
            : null
      };
    })
    .filter((entry) => entry !== null) as NativeReferenceOneShotResult["candidates"];
  const titleEntries = Array.isArray(candidate.titles) ? candidate.titles : [];
  const normalizedTitles = titleEntries
    .map((entry, index) => {
      const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const title = String(item.title ?? "").trim();
      if (!title) {
        return null;
      }
      const titleRu = String(item.title_ru ?? item.titleRu ?? "").trim();
      return {
        option: index + 1,
        title,
        titleRu: titleRu || undefined,
        titleRuSource: titleRu ? ("llm" as const) : ("fallback" as const)
      };
    })
    .filter((entry) => entry !== null) as NativeCaptionTitleOption[];
  const winnerCandidateIdRaw = String(
    candidate.winner_candidate_id ?? candidate.winnerCandidateId ?? ""
  ).trim();
  return {
    analysis: {
      visualAnchors: Array.isArray(analysisCandidate.visual_anchors)
        ? analysisCandidate.visual_anchors
            .map((item) => String(item ?? "").trim())
            .filter(Boolean)
            .slice(0, 3)
        : [],
      commentVibe:
        String(
          analysisCandidate.comment_vibe ?? analysisCandidate.commentVibe ?? ""
        ).trim(),
      keyPhraseToAdapt:
        String(
          analysisCandidate.key_phrase_to_adapt ??
            analysisCandidate.keyPhraseToAdapt ??
            ""
        ).trim()
    },
    candidates: normalizedCandidates,
    winnerCandidateId: winnerCandidateIdRaw || null,
    titles: normalizedTitles
  };
}

const REFERENCE_ONE_SHOT_META_LEAKAGE_RULES = [
  {
    regex: /\bframe\s*#?\d+\b/i,
    reason: "mentions a frame index"
  },
  {
    regex: /\bshot\s*#?\d+\b/i,
    reason: "mentions a shot index"
  },
  {
    regex: /\b(?:lane|candidate|option|comment)\s*[_#-]?\d+\b/i,
    reason: "mentions a pipeline slot or manifest index"
  },
  {
    regex: /\b\d{1,2}(?:\.\d{1,2})?s\b/i,
    reason: "mentions a seconds timestamp"
  },
  {
    regex: /\b\d{1,2}:\d{2}\b/,
    reason: "mentions a clock-style timestamp"
  },
  {
    regex: /\b(?:manifest|debug|schema|json)\b/i,
    reason: "contains debug or schema wording"
  },
  {
    regex: /\b(?:visual_anchors|comment_vibe|key_phrase_to_adapt|winner_candidate_id|candidate_id)\b/i,
    reason: "leaks contract field names"
  }
] as const;

const REFERENCE_ONE_SHOT_EXPERIMENTAL_META_COMMENTARY_RULES = [
  {
    regex: /\b(?:this|the)\s+(?:clip|video|edit|footage|scene|sequence)\b/i,
    reason: "contains media-object commentary"
  },
  {
    regex: /\bcomments?\b|\bcomment sections?\b/i,
    reason: "contains comment-section commentary"
  },
  {
    regex: /\bviewers?\b|\bpeople (?:watching|react(?:ing)?|aren't watching)\b/i,
    reason: "contains audience-reaction commentary"
  },
  {
    regex: /\bwhat makes this hit\b|\bthe part people react to\b|\bthe comments keep\b/i,
    reason: "contains meta framing about how the clip plays"
  }
] as const;

function findReferenceOneShotMetaLeakage(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  for (const rule of REFERENCE_ONE_SHOT_META_LEAKAGE_RULES) {
    if (rule.regex.test(normalized)) {
      return rule.reason;
    }
  }
  return null;
}

function findReferenceOneShotExperimentalMetaCommentary(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  for (const rule of REFERENCE_ONE_SHOT_EXPERIMENTAL_META_COMMENTARY_RULES) {
    if (rule.regex.test(normalized)) {
      return rule.reason;
    }
  }
  return null;
}

function isReferenceOneShotLengthConstraintIssue(issue: string): boolean {
  return /^(TOP|BOTTOM) length \d+ вне диапазона \d+-\d+\.$/u.test(issue.trim());
}

function collectReferenceOneShotContractDiagnostics(input: {
  result: NativeReferenceOneShotResult;
  hardConstraints: Stage2HardConstraints;
  variant: ReferenceOneShotVariantConfig;
}): {
  fatalIssues: string[];
  lengthWindowWarnings: string[];
} {
  const fatalIssues: string[] = [];
  const lengthWindowWarnings: string[] = [];

  if (input.result.analysis.visualAnchors.length !== 3) {
    fatalIssues.push(
      `analysis.visual_anchors must contain exactly 3 items, received ${input.result.analysis.visualAnchors.length}`
    );
  }
  if (!input.result.analysis.commentVibe.trim()) {
    fatalIssues.push("analysis.comment_vibe must be non-empty");
  }
  if (!input.result.analysis.keyPhraseToAdapt.trim()) {
    fatalIssues.push("analysis.key_phrase_to_adapt must be non-empty");
  }

  if (input.result.candidates.length !== 5) {
    fatalIssues.push(`candidates must contain exactly 5 items, received ${input.result.candidates.length}`);
  }
  if (input.result.titles.length !== 5) {
    fatalIssues.push(`titles must contain exactly 5 items, received ${input.result.titles.length}`);
  }

  const candidateIds = new Set<string>();
  const candidatePairs = new Set<string>();
  for (const candidate of input.result.candidates) {
    if (candidateIds.has(candidate.candidateId)) {
      fatalIssues.push(`candidate_id "${candidate.candidateId}" is duplicated`);
    }
    candidateIds.add(candidate.candidateId);

    const pairKey = `${candidate.top.trim().toLowerCase()}|${candidate.bottom.trim().toLowerCase()}`;
    if (candidatePairs.has(pairKey)) {
      fatalIssues.push(`candidate "${candidate.candidateId}" duplicates another top/bottom pair`);
    }
    candidatePairs.add(pairKey);

    if (candidate.top.includes("\n") || candidate.bottom.includes("\n")) {
      fatalIssues.push(`candidate "${candidate.candidateId}" must stay single-line in both top and bottom`);
    }

    const topMetaLeakage = findReferenceOneShotMetaLeakage(candidate.top);
    if (topMetaLeakage) {
      fatalIssues.push(`candidate "${candidate.candidateId}" top ${topMetaLeakage}`);
    }
    const bottomMetaLeakage = findReferenceOneShotMetaLeakage(candidate.bottom);
    if (bottomMetaLeakage) {
      fatalIssues.push(`candidate "${candidate.candidateId}" bottom ${bottomMetaLeakage}`);
    }
    if (input.variant.antiMetaValidation) {
      const topExperimentalMeta = findReferenceOneShotExperimentalMetaCommentary(candidate.top);
      if (topExperimentalMeta) {
        fatalIssues.push(`candidate "${candidate.candidateId}" top ${topExperimentalMeta}`);
      }
      const bottomExperimentalMeta = findReferenceOneShotExperimentalMetaCommentary(
        candidate.bottom
      );
      if (bottomExperimentalMeta) {
        fatalIssues.push(`candidate "${candidate.candidateId}" bottom ${bottomExperimentalMeta}`);
      }
    }

    const constraintCheck = evaluateNativeCaptionConstraintCheck(candidate, input.hardConstraints);
    if (!constraintCheck.passed) {
      const blockingConstraintIssues = constraintCheck.issues.filter(
        (issue) => !isReferenceOneShotLengthConstraintIssue(issue)
      );
      const lengthConstraintIssues = constraintCheck.issues.filter(isReferenceOneShotLengthConstraintIssue);
      if (blockingConstraintIssues.length > 0) {
        fatalIssues.push(
          `candidate "${candidate.candidateId}" violates hard constraints: ${blockingConstraintIssues.join(", ")}`
        );
      }
      if (lengthConstraintIssues.length > 0) {
        lengthWindowWarnings.push(
          `candidate "${candidate.candidateId}" stayed outside the configured length window: ${lengthConstraintIssues.join(", ")}`
        );
      }
    }
  }

  const titleValues = new Set<string>();
  for (const [index, title] of input.result.titles.entries()) {
    const titleLabel = `title ${index + 1}`;
    if (!title.title.trim()) {
      fatalIssues.push(`${titleLabel} must be non-empty`);
      continue;
    }
    if (title.title.includes("\n")) {
      fatalIssues.push(`${titleLabel} must stay single-line`);
    }
    const titleMetaLeakage = findReferenceOneShotMetaLeakage(title.title);
    if (titleMetaLeakage) {
      fatalIssues.push(`${titleLabel} ${titleMetaLeakage}`);
    }
    const normalizedTitle = title.title.trim().toLowerCase();
    if (titleValues.has(normalizedTitle)) {
      fatalIssues.push(`${titleLabel} duplicates another English title`);
    }
    titleValues.add(normalizedTitle);
  }

  if (!input.result.winnerCandidateId || !candidateIds.has(input.result.winnerCandidateId)) {
    fatalIssues.push("winner_candidate_id must point to one of the 5 candidates");
  }

  return {
    fatalIssues,
    lengthWindowWarnings
  };
}

const REFERENCE_ONE_SHOT_MAX_OVERFLOW_POLISH_CHARS = 12;

function attemptReferenceOneShotLineLengthPolish(input: {
  text: string;
  minimum: number;
  maximum: number;
}): { text: string; repaired: boolean } {
  let value = input.text.replace(/\s+/g, " ").trim();
  let repaired = value !== input.text.trim();

  if (value.length >= input.minimum && value.length <= input.maximum) {
    return { text: value, repaired };
  }

  const overflow = value.length - input.maximum;
  if (overflow <= 0 || overflow > REFERENCE_ONE_SHOT_MAX_OVERFLOW_POLISH_CHARS) {
    return { text: value, repaired };
  }

  const strippedTerminalPunctuation = value.replace(/[.!?]["']?$/u, "").trim();
  if (
    strippedTerminalPunctuation &&
    strippedTerminalPunctuation !== value &&
    strippedTerminalPunctuation.length >= input.minimum &&
    strippedTerminalPunctuation.length <= input.maximum &&
    !looksLikeBrokenCaptionEnding(strippedTerminalPunctuation)
  ) {
    return {
      text: strippedTerminalPunctuation,
      repaired: true
    };
  }

  let tightened = truncateToWordBoundary(value, input.maximum).trim();
  if (!tightened) {
    return { text: value, repaired };
  }
  const withoutFragment = trimTrailingIncompleteFragment(tightened);
  if (withoutFragment && withoutFragment.trim().length >= input.minimum) {
    tightened = withoutFragment.trim();
  }
  const withoutBrokenEnding = trimTrailingBrokenEndingWords(tightened);
  if (withoutBrokenEnding && withoutBrokenEnding.trim().length >= input.minimum) {
    tightened = withoutBrokenEnding.trim();
  }
  tightened = ensureTerminalPunctuation(tightened, input.maximum).trim();
  if (
    tightened.length < input.minimum ||
    tightened.length > input.maximum ||
    looksLikeBrokenCaptionEnding(tightened)
  ) {
    return { text: value, repaired };
  }
  return {
    text: tightened,
    repaired: true
  };
}

function applyReferenceOneShotLengthPolish(input: {
  result: NativeReferenceOneShotResult;
  hardConstraints: Stage2HardConstraints;
}): {
  result: NativeReferenceOneShotResult;
  polishedCandidateIds: string[];
} {
  const polishedCandidateIds: string[] = [];
  const candidates = input.result.candidates.map((candidate) => {
    const top = attemptReferenceOneShotLineLengthPolish({
      text: candidate.top,
      minimum: input.hardConstraints.topLengthMin,
      maximum: input.hardConstraints.topLengthMax
    });
    const bottom = attemptReferenceOneShotLineLengthPolish({
      text: candidate.bottom,
      minimum: input.hardConstraints.bottomLengthMin,
      maximum: input.hardConstraints.bottomLengthMax
    });
    if (!top.repaired && !bottom.repaired) {
      return candidate;
    }
    polishedCandidateIds.push(candidate.candidateId);
    return {
      ...candidate,
      top: top.text,
      bottom: bottom.text,
      rationale: candidate.rationale
        ? `${candidate.rationale} Exact-length polish tightened the final wording without changing the angle.`
        : "Exact-length polish tightened the final wording without changing the angle."
    };
  });
  return {
    result: {
      ...input.result,
      candidates
    },
    polishedCandidateIds
  };
}

function renderJsonPrompt(system: string, payload: unknown): string {
  return ["SYSTEM", system.trim(), "", "USER CONTEXT JSON", JSON.stringify(payload, null, 2)].join(
    "\n"
  );
}

class NativeCaptionFailClosedError extends Error {
  constructor(
    message: string,
    readonly guardSummary: NativeCaptionGuardSummary
  ) {
    super(message);
    this.name = "NativeCaptionFailClosedError";
  }
}

function buildDefaultNativeRequiredLanes(
  audienceWave: NativeCaptionContextPacket["audienceWave"],
  channelConfig: Stage2RuntimeChannelConfig
): NativeCaptionContextPacket["strategy"]["requiredLanes"] {
  const dominantWave =
    audienceWave.exists &&
    (Boolean(audienceWave.dominantHarmlessHandle) ||
      audienceWave.safeReusableCues.length > 0 ||
      audienceWave.mustNotLose.length > 0);
  const weakWave =
    !audienceWave.exists ||
    (!audienceWave.dominantHarmlessHandle &&
      audienceWave.safeReusableCues.length === 0 &&
      !audienceWave.consensusLane.trim() &&
      !audienceWave.jokeLane.trim());
  return buildStage2WorkerProfileRequiredLanes({
    profileId: getResolvedStage2WorkerProfile(channelConfig).resolvedId,
    dominantWave,
    weakWave
  });
}

function buildNativeCaptionFallbackContextPacket(input: {
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  videoContext: ViralShortsVideoContext;
  channelConfig: Stage2RuntimeChannelConfig;
}): NativeCaptionContextPacket {
  const blockedCommentCues = input.videoContext.comments
    .map((comment) => comment.text.trim())
    .filter((text) => /racist|demonic|too old|polic|slur|hate/i.test(text))
    .slice(0, 4);
  const safeReusableCues = [
    ...input.analyzerOutput.slangToAdapt,
    ...input.analyzerOutput.commentLanguageCues
  ]
    .map((cue) => cue.trim())
    .filter(Boolean)
    .slice(0, 5);
  const dominantHarmlessHandle = safeReusableCues[0] ?? null;
  const audienceWave: NativeCaptionContextPacket["audienceWave"] = {
    exists: Boolean(
      input.videoContext.comments.length > 0 ||
        input.analyzerOutput.commentConsensusLane.trim() ||
        input.analyzerOutput.commentJokeLane.trim() ||
        input.analyzerOutput.commentDissentLane.trim()
    ),
    emotionalTemperature:
      input.analyzerOutput.commentVibe.trim() ||
      input.analyzerOutput.bestBottomEnergy.trim() ||
      "watchful reaction",
    dominantHarmlessHandle,
    consensusLane: input.analyzerOutput.commentConsensusLane || input.analyzerOutput.commentVibe,
    jokeLane: input.analyzerOutput.commentJokeLane,
    dissentLane: input.analyzerOutput.commentDissentLane,
    safeReusableCues,
    blockedCues: blockedCommentCues,
    flatteningRisks: [
      "flattening the clip into generic safe copy",
      ...(dominantHarmlessHandle ? [`erasing the handle "${dominantHarmlessHandle}"`] : []),
      ...input.analyzerOutput.genericRisks
    ]
      .filter(Boolean)
      .slice(0, 6),
    mustNotLose: [
      dominantHarmlessHandle,
      input.analyzerOutput.commentJokeLane,
      input.analyzerOutput.commentConsensusLane
    ]
      .filter((value): value is string => Boolean(value && value.trim()))
      .slice(0, 4)
  };
  return {
    grounding: {
      observedFacts: [
        input.analyzerOutput.subject,
        input.analyzerOutput.action,
        input.analyzerOutput.setting,
        input.analyzerOutput.payoff
      ].filter(Boolean),
      visibleSequence:
        input.analyzerOutput.sceneBeats.length > 0
          ? input.analyzerOutput.sceneBeats.slice(0, 5)
          : input.analyzerOutput.visibleActions.slice(0, 5),
      microTurn:
        input.analyzerOutput.revealMoment ||
        input.analyzerOutput.lateClipChange ||
        input.analyzerOutput.rawSummary,
      firstSecondsSignal: input.analyzerOutput.firstSecondsSignal,
      uncertainties: input.analyzerOutput.uncertaintyNotes.slice(0, 5),
      forbiddenClaims: [
        ...input.analyzerOutput.genericRisks,
        ...input.analyzerOutput.uncertaintyNotes
      ]
        .filter(Boolean)
        .slice(0, 6),
      safeInferences: [
        input.analyzerOutput.humanStake,
        input.analyzerOutput.narrativeFrame,
        input.analyzerOutput.whyViewerCares
      ]
        .filter(Boolean)
        .slice(0, 4)
    },
    audienceWave,
    strategy: {
      primaryAngle: input.selectorOutput.primaryAngle,
      secondaryAngles: input.selectorOutput.secondaryAngles.slice(0, 3),
      hookSeeds: [
        input.selectorOutput.whyViewerCares,
        input.selectorOutput.topStrategy,
        input.analyzerOutput.revealMoment
      ]
        .filter(Boolean)
        .slice(0, 4),
      bottomFunctions: [
        input.selectorOutput.bottomEnergy,
        input.analyzerOutput.bestBottomEnergy,
        input.analyzerOutput.commentVibe
      ]
        .filter(Boolean)
        .slice(0, 4),
      mustDo: [
        "land the hook in the first clause",
        "stay visually defensible",
        "use plain native English"
      ],
      mustAvoid: [
        ...input.analyzerOutput.genericRisks,
        "inventory openings",
        "editorial phrasing",
        "quoted speech without transcript support"
      ]
        .filter(Boolean)
        .slice(0, 6),
      requiredLanes: buildDefaultNativeRequiredLanes(audienceWave, input.channelConfig)
    }
  };
}

function buildNativeCaptionContextPacketPrompt(input: {
  videoContext: ViralShortsVideoContext;
  channelConfig: Stage2RuntimeChannelConfig;
  promptConfig: Stage2PromptConfig;
}): string {
  const channelLearning = buildNativeCaptionChannelLearningPayload(input.channelConfig, "minimal");
  return renderJsonPrompt(
    resolveStage2PromptTemplate("contextPacket", input.promptConfig).configuredPrompt,
    {
      title: input.videoContext.title,
      description: input.videoContext.description,
      transcript_status: buildStage2SourceContextSummary(input.videoContext).speechGroundingStatus,
      transcript_or_null: input.videoContext.transcript.trim() || null,
      frames: input.videoContext.frameDescriptions,
      comments: input.videoContext.comments.slice(0, 15).map((comment) => ({
        author: comment.author,
        likes: comment.likes,
        text: comment.text
      })),
      comment_digest_json: buildCommentPromptDigest(input.videoContext.comments),
      line_profile_json: buildStage2WorkerProfilePromptPayload(
        getResolvedStage2WorkerProfile(input.channelConfig)
      ),
      style_card_json: buildNativeCaptionStyleCard(input.channelConfig),
      channel_learning_json: channelLearning.payload,
      hard_constraints_json: input.channelConfig.hardConstraints,
      user_instruction: input.videoContext.userInstruction?.trim() || null
    }
  );
}

function normalizeNativeCaptionContextPacket(
  raw: unknown,
  fallback: NativeCaptionContextPacket
): NativeCaptionContextPacket {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const grounding = (obj.grounding && typeof obj.grounding === "object"
    ? obj.grounding
    : {}) as Record<string, unknown>;
  const audienceWave = ((obj.audience_wave ??
    obj.audienceWave ??
    obj.audience) &&
  typeof (obj.audience_wave ?? obj.audienceWave ?? obj.audience) === "object"
    ? (obj.audience_wave ?? obj.audienceWave ?? obj.audience)
    : {}) as Record<string, unknown>;
  const strategy = (obj.strategy && typeof obj.strategy === "object"
    ? obj.strategy
    : {}) as Record<string, unknown>;
  const asList = (value: unknown, fallbackList: string[], maxItems = 6) =>
    (Array.isArray(value) ? value : fallbackList)
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .slice(0, maxItems);
  return {
    grounding: {
      observedFacts: asList(grounding.observed_facts, fallback.grounding.observedFacts),
      visibleSequence: asList(
        grounding.visible_sequence ?? grounding.visible_actions,
        fallback.grounding.visibleSequence
      ),
      microTurn: String(grounding.micro_turn ?? fallback.grounding.microTurn).trim() || fallback.grounding.microTurn,
      firstSecondsSignal:
        String(grounding.first_seconds_signal ?? fallback.grounding.firstSecondsSignal).trim() ||
        fallback.grounding.firstSecondsSignal,
      uncertainties: asList(grounding.uncertainties, fallback.grounding.uncertainties),
      forbiddenClaims: asList(grounding.forbidden_claims, fallback.grounding.forbiddenClaims),
      safeInferences: asList(grounding.safe_inferences, fallback.grounding.safeInferences)
    },
    audienceWave: {
      exists:
        typeof audienceWave.exists === "boolean"
          ? audienceWave.exists
          : typeof audienceWave.dissent_exists === "boolean"
            ? audienceWave.dissent_exists || fallback.audienceWave.exists
            : fallback.audienceWave.exists,
      emotionalTemperature:
        String(
          audienceWave.emotional_temperature ??
            audienceWave.emotionalTemperature ??
            fallback.audienceWave.emotionalTemperature
        ).trim() || fallback.audienceWave.emotionalTemperature,
      dominantHarmlessHandle:
        typeof (audienceWave.dominant_harmless_handle ?? audienceWave.dominantHarmlessHandle) === "string"
          ? String(audienceWave.dominant_harmless_handle ?? audienceWave.dominantHarmlessHandle).trim() || null
          : fallback.audienceWave.dominantHarmlessHandle,
      consensusLane:
        String(
          audienceWave.consensus_lane ??
            audienceWave.consensus_read ??
            audienceWave.consensusLane ??
            fallback.audienceWave.consensusLane
        ).trim() || fallback.audienceWave.consensusLane,
      jokeLane:
        String(audienceWave.joke_lane ?? audienceWave.jokeLane ?? fallback.audienceWave.jokeLane).trim() ||
        fallback.audienceWave.jokeLane,
      dissentLane:
        String(
          audienceWave.dissent_lane ??
            audienceWave.dissentLane ??
            fallback.audienceWave.dissentLane
        ).trim() || fallback.audienceWave.dissentLane,
      safeReusableCues: asList(
        audienceWave.safe_reusable_cues,
        fallback.audienceWave.safeReusableCues
      ),
      blockedCues: asList(audienceWave.blocked_cues, fallback.audienceWave.blockedCues),
      flatteningRisks: asList(
        audienceWave.flattening_risks ?? audienceWave.toxic_or_low_value_patterns,
        fallback.audienceWave.flatteningRisks
      ),
      mustNotLose: asList(audienceWave.must_not_lose, fallback.audienceWave.mustNotLose)
    },
    strategy: {
      primaryAngle:
        String(strategy.primary_angle ?? fallback.strategy.primaryAngle).trim() ||
        fallback.strategy.primaryAngle,
      secondaryAngles: asList(strategy.secondary_angles, fallback.strategy.secondaryAngles),
      hookSeeds: asList(strategy.hook_seeds, fallback.strategy.hookSeeds),
      bottomFunctions: asList(strategy.bottom_functions, fallback.strategy.bottomFunctions),
      requiredLanes:
        (() => {
          const normalized = (Array.isArray(strategy.required_lanes) ? strategy.required_lanes : [])
            .map((entry) => {
              const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
              const laneId = String(item.lane_id ?? item.laneId ?? "").trim();
              const count = Number(item.count ?? 0);
              const purpose = String(item.purpose ?? "").trim();
              if (!laneId || !Number.isFinite(count) || count < 1 || !purpose) {
                return null;
              }
              return {
                laneId,
                count: Math.max(1, Math.min(8, Math.floor(count))),
                purpose
              };
            })
            .filter(
              (
                entry
              ): entry is NativeCaptionContextPacket["strategy"]["requiredLanes"][number] => Boolean(entry)
            );
          return normalized.length > 0 ? normalized : fallback.strategy.requiredLanes;
        })(),
      mustDo: asList(strategy.must_do, fallback.strategy.mustDo),
      mustAvoid: asList(strategy.must_avoid, fallback.strategy.mustAvoid)
    }
  };
}

function buildNativeCaptionCandidateGeneratorPrompt(input: {
  contextPacket: NativeCaptionContextPacket;
  channelConfig: Stage2RuntimeChannelConfig;
  promptConfig: Stage2PromptConfig;
  userInstruction?: string | null;
}): string {
  const channelLearning = buildNativeCaptionChannelLearningPayload(input.channelConfig, "compact");
  return renderJsonPrompt(
    resolveStage2PromptTemplate("candidateGenerator", input.promptConfig).configuredPrompt,
    {
      context_packet_json: input.contextPacket,
      line_profile_json: buildStage2WorkerProfilePromptPayload(
        getResolvedStage2WorkerProfile(input.channelConfig)
      ),
      style_card_json: buildNativeCaptionStyleCard(input.channelConfig),
      channel_learning_json: channelLearning.payload,
      hard_constraints_json: input.channelConfig.hardConstraints,
      user_instruction: input.userInstruction?.trim() || null
    }
  );
}

function normalizeNativeCaptionCandidateBatch(raw: unknown): NativeCaptionCandidate[] {
  const entries = Array.isArray(raw) ? raw : [];
  const usedIds = new Set<string>();
  return entries
    .map((entry, index) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const top = String(item.top ?? "").trim();
      const bottom = String(item.bottom ?? "").trim();
      if (!bottom) {
        return null;
      }
      const baseId = String(item.candidate_id ?? item.candidateId ?? `cand_${index + 1}`)
        .trim()
        .replace(/\s+/g, "_");
      let candidateId = baseId || `cand_${index + 1}`;
      let suffix = 1;
      while (usedIds.has(candidateId)) {
        candidateId = `${baseId}_${suffix}`;
        suffix += 1;
      }
      usedIds.add(candidateId);
      const laneId = String(item.lane_id ?? item.laneId ?? item.angle ?? "balanced_clean").trim() || "balanced_clean";
      const retainedHandle =
        typeof (item.retained_handle ?? item.retainedHandle) === "boolean"
          ? Boolean(item.retained_handle ?? item.retainedHandle)
          : false;
      const displayIntentRaw = String(
        item.display_intent ?? item.displayIntent ?? "finalist_or_display_safe"
      ).trim();
      return {
        candidateId,
        laneId,
        angle: laneId,
        top,
        bottom,
        retainedHandle,
        displayIntent:
          displayIntentRaw === "recovery" || displayIntentRaw === "template_backfill"
            ? displayIntentRaw
            : "finalist_or_display_safe"
      };
    })
    .filter((entry): entry is NativeCaptionCandidate => Boolean(entry))
    .slice(0, 8);
}

function toLegacyCandidate(candidate: NativeCaptionCandidate): CandidateCaption {
  return {
    candidateId: candidate.candidateId,
    angle: candidate.angle,
    top: candidate.top,
    bottom: candidate.bottom,
    topRu: candidate.top,
    bottomRu: candidate.bottom,
    rationale: `${candidate.laneId}:${candidate.displayIntent}`
  };
}

function evaluateNativeCaptionConstraintCheck(
  candidate: NativeCaptionCandidate,
  constraints: Stage2HardConstraints
): NativeCaptionFinalist["constraintCheck"] {
  const base = evaluateCandidateHardConstraints(toLegacyCandidate(candidate), constraints, false);
  const extraIssues: string[] = [];
  const combinedText = `${candidate.top}\n${candidate.bottom}`;
  if (!candidate.top.trim() && constraints.topLengthMin > 0) {
    extraIssues.push("TOP is empty.");
  }
  if (!candidate.bottom.trim()) {
    extraIssues.push("BOTTOM is empty.");
  }
  if (/\b(top_ru|bottom_ru|translation|candidate_id|lane_id)\b/i.test(combinedText)) {
    extraIssues.push("Output leaked translation or schema fields into caption text.");
  }
  if (/^(top|bottom)\s*:/i.test(candidate.top) || /^(top|bottom)\s*:/i.test(candidate.bottom)) {
    extraIssues.push("Output leaked meta labels into caption text.");
  }
  if (/\b(placeholder|your text here|insert caption|same as above)\b/i.test(combinedText)) {
    extraIssues.push("Output contains placeholder text.");
  }
  const issues = [...base.issues, ...extraIssues];
  return {
    ...base,
    passed: issues.length === 0,
    issues
  };
}

function buildNativeCaptionConstraintCheckMap(
  candidates: NativeCaptionCandidate[],
  constraints: Stage2HardConstraints
): Map<string, NativeCaptionFinalist["constraintCheck"]> {
  return new Map(
    candidates.map((candidate) => [
      candidate.candidateId,
      evaluateNativeCaptionConstraintCheck(candidate, constraints)
    ])
  );
}

function buildNativeCaptionConstraintChecksForPrompt(
  candidates: NativeCaptionCandidate[],
  constraintChecks: Map<string, NativeCaptionFinalist["constraintCheck"]>
) {
  return candidates.map((candidate) => {
    const constraintCheck = constraintChecks.get(candidate.candidateId);
    return {
      candidate_id: candidate.candidateId,
      passed: constraintCheck?.passed ?? false,
      repaired: constraintCheck?.repaired ?? false,
      top_length: constraintCheck?.topLength ?? candidate.top.length,
      bottom_length: constraintCheck?.bottomLength ?? candidate.bottom.length,
      issues: constraintCheck?.issues ?? []
    };
  });
}

function buildNativeCaptionHardValidator(input: {
  candidates: NativeCaptionCandidate[];
  constraintChecks: Map<string, NativeCaptionFinalist["constraintCheck"]>;
}): NativeCaptionHardValidatorResult {
  return input.candidates.reduce<NativeCaptionHardValidatorResult>(
    (accumulator, candidate) => {
      const constraintCheck = input.constraintChecks.get(candidate.candidateId);
      if (constraintCheck?.passed) {
        accumulator.validPool.push(candidate.candidateId);
      } else {
        accumulator.invalidPool.push({
          candidateId: candidate.candidateId,
          hardIssues: constraintCheck?.issues ?? ["failed hard validation"]
        });
      }
      return accumulator;
    },
    {
      validPool: [],
      invalidPool: []
    }
  );
}

function buildNativeCaptionRecoveryPlan(input: {
  contextPacket: NativeCaptionContextPacket;
  finalists: NativeCaptionQualityCourt["finalists"];
  displaySafeExtras: NativeCaptionQualityCourt["displaySafeExtras"];
  winnerCandidateId: string | null;
  validCandidates: NativeCaptionCandidate[];
}): NativeCaptionQualityCourt["recoveryPlan"] {
  const displayedCount = input.finalists.length + input.displaySafeExtras.length;
  const handleAvailable = input.validCandidates.some((candidate) => candidate.retainedHandle);
  const handlePreserved = input.finalists.some((entry) => entry.preservedHandle);
  const missingCount = Math.max(
    0,
    3 - input.finalists.length,
    5 - displayedCount,
    input.winnerCandidateId ? 0 : 1,
    handleAvailable && !handlePreserved ? 1 : 0
  );
  if (missingCount === 0) {
    return {
      required: false,
      missingCount: 0,
      briefs: []
    };
  }

  const laneCounts = new Map<string, number>();
  for (const candidate of input.validCandidates) {
    laneCounts.set(candidate.laneId, (laneCounts.get(candidate.laneId) ?? 0) + 1);
  }
  const briefs = input.contextPacket.strategy.requiredLanes
    .filter((lane) => lane.count > (laneCounts.get(lane.laneId) ?? 0) || lane.laneId === "audience_locked")
    .map((lane) => ({
      laneId: lane.laneId,
      goal:
        lane.laneId === "audience_locked" &&
        input.contextPacket.audienceWave.dominantHarmlessHandle &&
        !handlePreserved
          ? `Restore the harmless public handle "${input.contextPacket.audienceWave.dominantHarmlessHandle}" naturally.`
          : lane.purpose,
      mustKeep: [
        ...input.contextPacket.audienceWave.mustNotLose,
        ...input.contextPacket.strategy.mustDo
      ].slice(0, 6),
      mustAvoid: [
        ...input.contextPacket.audienceWave.flatteningRisks,
        ...input.contextPacket.strategy.mustAvoid
      ].slice(0, 6)
    }))
    .slice(0, Math.max(1, missingCount));

  return {
    required: true,
    missingCount,
    briefs:
      briefs.length > 0
        ? briefs
        : [
            {
              laneId: "balanced_clean",
              goal: "Generate additional display-safe options without flattening the clip.",
              mustKeep: [...input.contextPacket.strategy.mustDo].slice(0, 4),
              mustAvoid: [...input.contextPacket.strategy.mustAvoid].slice(0, 4)
            }
          ]
  };
}

function buildNativeCaptionQualityCourtFallback(input: {
  candidates: NativeCaptionCandidate[];
  contextPacket: NativeCaptionContextPacket;
}): NativeCaptionQualityCourt {
  const scored = input.candidates.map((candidate) => {
    const legacyCandidate = toLegacyCandidate(candidate);
    const topSignals = evaluateTopHookSignals(legacyCandidate.top);
    const humanSignals = evaluateHumanPhrasingSignals(legacyCandidate);
    const hardReasons = [
      ...(humanSignals.syntheticPhrasing || humanSignals.inventedCompound
        ? ["H1 invented_or_non_native"]
        : []),
      ...(topSignals.inventoryOpening || topSignals.pureBeatNarration ? ["H2 beat_log_or_inventory_opening"] : []),
      ...(/report|editorial|spokesperson|statement/i.test(`${candidate.top} ${candidate.bottom}`)
        ? ["H3 analyst_or_reporting_tone"]
        : []),
      ...(!candidate.retainedHandle &&
      Boolean(input.contextPacket.audienceWave.dominantHarmlessHandle) &&
      input.candidates.some((entry) => entry.retainedHandle)
        ? ["H5 flattened_audience_wave_or_erased_handle"]
        : []),
      ...(!topSignals.earlyHookPresent ? ["H6 dead_generic_clean_english"] : [])
    ];
    return {
      candidate,
      topSignals,
      humanSignals,
      hardReasons,
      softReasons: [
        ...(!topSignals.earlyHookPresent ? ["S4 slightly_weaker_hook"] : []),
        ...(!candidate.retainedHandle &&
        Boolean(input.contextPacket.audienceWave.dominantHarmlessHandle) &&
        !hardReasons.includes("H5 flattened_audience_wave_or_erased_handle")
          ? ["S3 emotionally_flatter_than_handle_preserving_option"]
          : [])
      ],
      sortScore:
        (candidate.retainedHandle ? 100 : 0) +
        (topSignals.earlyHookPresent ? 10 : 0) -
        hardReasons.length * 20 -
        humanSignals.suspiciousPhrases.length
    };
  });
  const survivors = scored
    .filter((entry) => entry.hardReasons.length === 0)
    .sort((left, right) => right.sortScore - left.sortScore)
    .map((entry) => entry.candidate);
  const finalists = survivors.slice(0, 3).map((candidate) => ({
    candidateId: candidate.candidateId,
    whyChosen: [
      candidate.retainedHandle
        ? "Preserves the dominant harmless public handle without sounding forced."
        : "Keeps the clip readable without generic safe language.",
      "Feels human and gets to why-care early."
    ],
    preservedHandle: candidate.retainedHandle
  }));
  const displaySafeExtras = survivors
    .slice(3, 5)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      whyDisplaySafe: ["Valid and human, but less distinctive than the finalists."]
    }));
  const hardRejected = scored
    .filter((entry) => entry.hardReasons.length > 0)
    .map((entry) => ({
      candidateId: entry.candidate.candidateId,
      reasons: entry.hardReasons,
      offendingPhrases: entry.humanSignals.suspiciousPhrases.slice(0, 3)
    }));
  return {
    finalists,
    displaySafeExtras,
    hardRejected,
    winnerCandidateId: finalists[0]?.candidateId ?? null,
    recoveryPlan: buildNativeCaptionRecoveryPlan({
      contextPacket: input.contextPacket,
      finalists,
      displaySafeExtras,
      winnerCandidateId: finalists[0]?.candidateId ?? null,
      validCandidates: input.candidates
    })
  };
}

function applyRuntimeSelectionToQualityCourt(input: {
  qualityCourt: NativeCaptionQualityCourt;
  validCandidates: NativeCaptionCandidate[];
  hardValidator: NativeCaptionHardValidatorResult;
  contextPacket: NativeCaptionContextPacket;
}): NativeCaptionQualityCourt {
  const validById = new Map(input.validCandidates.map((candidate) => [candidate.candidateId, candidate] as const));
  const hardRejectedIds = new Set(input.qualityCourt.hardRejected.map((entry) => entry.candidateId));
  const safeValidCandidates = input.validCandidates.filter(
    (candidate) => !hardRejectedIds.has(candidate.candidateId)
  );
  let finalists = input.qualityCourt.finalists
    .filter((entry) => validById.has(entry.candidateId))
    .slice(0, 3);
  let displaySafeExtras = input.qualityCourt.displaySafeExtras.filter(
    (entry) => validById.has(entry.candidateId) && !hardRejectedIds.has(entry.candidateId)
  );

  const handleCandidate = safeValidCandidates.find((candidate) => candidate.retainedHandle) ?? null;
  if (
    handleCandidate &&
    !finalists.some((entry) => entry.candidateId === handleCandidate.candidateId || entry.preservedHandle)
  ) {
    const promoted = {
      candidateId: handleCandidate.candidateId,
      whyChosen: [
        "Preserves the dominant harmless handle the audience is clearly using.",
        "Keeps the public read alive instead of sanding it into generic safe copy."
      ],
      preservedHandle: true
    };
    finalists = [promoted, ...finalists.filter((entry) => entry.candidateId !== handleCandidate.candidateId)].slice(0, 3);
    displaySafeExtras = displaySafeExtras.filter((entry) => entry.candidateId !== handleCandidate.candidateId);
  }

  const finalistIds = new Set(finalists.map((entry) => entry.candidateId));
  displaySafeExtras = displaySafeExtras.filter((entry) => !finalistIds.has(entry.candidateId));
  for (const candidate of safeValidCandidates) {
    if (finalistIds.has(candidate.candidateId) || hardRejectedIds.has(candidate.candidateId)) {
      continue;
    }
    if (!displaySafeExtras.some((entry) => entry.candidateId === candidate.candidateId)) {
      displaySafeExtras.push({
        candidateId: candidate.candidateId,
        whyDisplaySafe: ["Valid and display-safe, but not strong enough to beat the finalists."]
      });
    }
  }
  displaySafeExtras = displaySafeExtras.slice(0, Math.max(0, 5 - finalists.length));

  const winnerCandidateId =
    input.qualityCourt.winnerCandidateId && finalistIds.has(input.qualityCourt.winnerCandidateId)
      ? input.qualityCourt.winnerCandidateId
      : finalists[0]?.candidateId ?? null;
  return {
    finalists,
    displaySafeExtras,
    hardRejected: input.qualityCourt.hardRejected.filter((entry) => !validById.has(entry.candidateId) || hardRejectedIds.has(entry.candidateId)),
    winnerCandidateId,
    recoveryPlan: buildNativeCaptionRecoveryPlan({
      contextPacket: input.contextPacket,
      finalists,
      displaySafeExtras,
      winnerCandidateId,
      validCandidates: safeValidCandidates
    })
  };
}

function buildNativeCaptionQualityCourtPrompt(input: {
  contextPacket: NativeCaptionContextPacket;
  channelConfig: Stage2RuntimeChannelConfig;
  candidates: NativeCaptionCandidate[];
  hardConstraints: Stage2HardConstraints;
  candidateConstraintChecks: Map<string, NativeCaptionFinalist["constraintCheck"]>;
  hardValidator: NativeCaptionHardValidatorResult;
  promptConfig: Stage2PromptConfig;
}): string {
  const channelLearning = buildNativeCaptionChannelLearningPayload(input.channelConfig, "compact");
  return renderJsonPrompt(
    resolveStage2PromptTemplate("qualityCourt", input.promptConfig).configuredPrompt,
    {
      context_packet_json: input.contextPacket,
      candidate_batch_json: input.candidates,
      hard_validator_json: input.hardValidator,
      line_profile_json: buildStage2WorkerProfilePromptPayload(
        getResolvedStage2WorkerProfile(input.channelConfig)
      ),
      channel_learning_json: channelLearning.payload,
      hard_constraints_json: input.hardConstraints,
      candidate_constraint_checks_json: buildNativeCaptionConstraintChecksForPrompt(
        input.candidates,
        input.candidateConstraintChecks
      )
    }
  );
}

function normalizeNativeCaptionQualityCourt(
  raw: unknown,
  candidates: NativeCaptionCandidate[],
  contextPacket: NativeCaptionContextPacket
): NativeCaptionQualityCourt {
  const fallback = buildNativeCaptionQualityCourtFallback({ candidates, contextPacket });
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));

  if (Array.isArray(obj.kept)) {
    const kept = (obj.kept as Array<Record<string, unknown>>)
      .map((entry) => {
        const candidateId = String(entry.candidate_id ?? entry.candidateId ?? "").trim();
        if (!candidateIds.has(candidateId)) {
          return null;
        }
        return {
          candidateId,
          whyChosen: (Array.isArray(entry.why_it_works) ? entry.why_it_works : [])
            .map((reason) => String(reason ?? "").trim())
            .filter(Boolean),
          preservedHandle: Boolean(candidates.find((candidate) => candidate.candidateId === candidateId)?.retainedHandle)
        };
      })
      .filter((entry): entry is NativeCaptionQualityCourt["finalists"][number] => Boolean(entry));
    return {
      finalists: kept.length > 0 ? kept : fallback.finalists,
      displaySafeExtras: [],
      hardRejected: [],
      winnerCandidateId:
        String(obj.winner_candidate_id ?? obj.winnerCandidateId ?? kept[0]?.candidateId ?? "").trim() ||
        kept[0]?.candidateId ||
        null,
      recoveryPlan: fallback.recoveryPlan
    };
  }

  const finalists = (Array.isArray(obj.finalists) ? obj.finalists : [])
    .map((entry) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const candidateId = String(item.candidate_id ?? item.candidateId ?? "").trim();
      if (!candidateIds.has(candidateId)) {
        return null;
      }
      return {
        candidateId,
        whyChosen: (Array.isArray(item.why_chosen) ? item.why_chosen : [])
          .map((reason) => String(reason ?? "").trim())
          .filter(Boolean),
        preservedHandle: typeof item.preserved_handle === "boolean" ? item.preserved_handle : false
      };
    })
    .filter((entry): entry is NativeCaptionQualityCourt["finalists"][number] => Boolean(entry));
  const displaySafeExtras = (Array.isArray(obj.display_safe_extras) ? obj.display_safe_extras : [])
    .map((entry) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const candidateId = String(item.candidate_id ?? item.candidateId ?? "").trim();
      if (!candidateIds.has(candidateId)) {
        return null;
      }
      return {
        candidateId,
        whyDisplaySafe: (Array.isArray(item.why_display_safe) ? item.why_display_safe : [])
          .map((reason) => String(reason ?? "").trim())
          .filter(Boolean)
      };
    })
    .filter((entry): entry is NativeCaptionQualityCourt["displaySafeExtras"][number] => Boolean(entry));
  const hardRejected = (Array.isArray(obj.hard_rejected) ? obj.hard_rejected : [])
    .map((entry) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const candidateId = String(item.candidate_id ?? item.candidateId ?? "").trim();
      if (!candidateIds.has(candidateId)) {
        return null;
      }
      return {
        candidateId,
        reasons: (Array.isArray(item.reasons) ? item.reasons : [])
          .map((reason) => String(reason ?? "").trim())
          .filter(Boolean),
        offendingPhrases: (Array.isArray(item.offending_phrases) ? item.offending_phrases : [])
          .map((phrase) => String(phrase ?? "").trim())
          .filter(Boolean)
      };
    })
    .filter((entry): entry is NativeCaptionQualityCourt["hardRejected"][number] => Boolean(entry));
  const recoveryPlanRaw =
    obj.recovery_plan && typeof obj.recovery_plan === "object"
      ? (obj.recovery_plan as Record<string, unknown>)
      : null;

  if (finalists.length === 0 && displaySafeExtras.length === 0 && hardRejected.length === 0) {
    return fallback;
  }

  return {
    finalists,
    displaySafeExtras,
    hardRejected,
    winnerCandidateId:
      String(obj.winner_candidate_id ?? obj.winnerCandidateId ?? finalists[0]?.candidateId ?? "").trim() ||
      finalists[0]?.candidateId ||
      null,
    recoveryPlan:
      recoveryPlanRaw
        ? {
            required: Boolean(recoveryPlanRaw.required),
            missingCount: Math.max(0, Math.min(8, Number(recoveryPlanRaw.missing_count ?? 0) || 0)),
            briefs: (Array.isArray(recoveryPlanRaw.briefs) ? recoveryPlanRaw.briefs : [])
              .map((entry) => {
                const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
                const laneId = String(item.lane_id ?? item.laneId ?? "").trim();
                const goal = String(item.goal ?? "").trim();
                if (!laneId || !goal) {
                  return null;
                }
                return {
                  laneId,
                  goal,
                  mustKeep: (Array.isArray(item.must_keep) ? item.must_keep : [])
                    .map((value) => String(value ?? "").trim())
                    .filter(Boolean),
                  mustAvoid: (Array.isArray(item.must_avoid) ? item.must_avoid : [])
                    .map((value) => String(value ?? "").trim())
                    .filter(Boolean)
                };
              })
              .filter((entry): entry is NativeCaptionQualityCourt["recoveryPlan"]["briefs"][number] => Boolean(entry))
          }
        : fallback.recoveryPlan
  };
}

function buildNativeCaptionTargetedRepairPrompt(input: {
  contextPacket: NativeCaptionContextPacket;
  channelConfig: Stage2RuntimeChannelConfig;
  repairBriefs: NativeCaptionQualityCourt["recoveryPlan"]["briefs"];
  candidates: NativeCaptionCandidate[];
  hardConstraints: Stage2HardConstraints;
  candidateConstraintChecks: Map<string, NativeCaptionFinalist["constraintCheck"]>;
  promptConfig: Stage2PromptConfig;
}): string {
  const channelLearning = buildNativeCaptionChannelLearningPayload(input.channelConfig, "compact");
  return renderJsonPrompt(
    resolveStage2PromptTemplate("targetedRepair", input.promptConfig).configuredPrompt,
    {
      context_packet_json: input.contextPacket,
      recovery_briefs_json: input.repairBriefs,
      existing_display_candidates_json: input.candidates,
      line_profile_json: buildStage2WorkerProfilePromptPayload(
        getResolvedStage2WorkerProfile(input.channelConfig)
      ),
      channel_learning_json: channelLearning.payload,
      hard_constraints_json: input.hardConstraints,
      candidate_constraint_checks_json: buildNativeCaptionConstraintChecksForPrompt(
        input.candidates,
        input.candidateConstraintChecks
      )
    }
  );
}

function normalizeNativeCaptionRecoveryResult(raw: unknown): NativeCaptionRepairResult | null {
  const candidates = normalizeNativeCaptionCandidateBatch(raw).map((candidate) => ({
    ...candidate,
    displayIntent: "recovery" as const
  }));
  return candidates.length > 0
    ? {
        recoveredCandidates: candidates
      }
    : null;
}

function normalizeNativeCaptionPhrase(value: string | null | undefined, fallback: string): string {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preserveReplacementCase(source: string, replacement: string): string {
  if (!source) {
    return replacement;
  }
  if (source.toUpperCase() === source) {
    return replacement.toUpperCase();
  }
  if (source.toLowerCase() === source) {
    return replacement.toLowerCase();
  }
  return replacement.charAt(0).toUpperCase() + replacement.slice(1);
}

function sanitizeNativeCaptionTemplateLine(line: string, constraints: Stage2HardConstraints): string {
  const replacementMap = new Map<string, string>([
    ["clip", "moment"],
    ["clips", "moments"],
    ["caption", "line"],
    ["captions", "lines"]
  ]);
  let sanitized = normalizeNativeCaptionPhrase(line, "");
  for (const bannedWord of constraints.bannedWords) {
    const normalizedWord = normalizeNativeCaptionPhrase(bannedWord, "").toLowerCase();
    if (!normalizedWord) {
      continue;
    }
    const replacement = replacementMap.get(normalizedWord) ?? "";
    sanitized = sanitized.replace(new RegExp(`\\b${escapeRegExp(normalizedWord)}\\b`, "gi"), (match) =>
      replacement ? preserveReplacementCase(match, replacement) : ""
    );
  }
  return sanitized
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

function padNativeCaptionLineToMinLength(input: {
  line: string;
  minLength: number;
  maxLength: number;
  fillerPhrases: string[];
}): string {
  let line = normalizeNativeCaptionPhrase(input.line, "");
  if (line.length >= input.minLength) {
    return line;
  }
  const fillerWords = input.fillerPhrases
    .map((phrase) => normalizeNativeCaptionPhrase(phrase, ""))
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (fillerWords.length === 0) {
    return line;
  }
  let index = 0;
  while (line.length < input.minLength && index < fillerWords.length * 8) {
    const nextWord = fillerWords[index % fillerWords.length];
    const candidate = `${line} ${nextWord}`.trim();
    if (candidate.length > input.maxLength) {
      break;
    }
    line = candidate;
    index += 1;
  }
  return line;
}

function composeNativeCaptionLineWithinWindow(input: {
  fragments: string[];
  minLength: number;
  maxLength: number;
}): string {
  const words = input.fragments
    .map((fragment) => normalizeNativeCaptionPhrase(fragment, ""))
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) {
    return "";
  }
  let line = "";
  let index = 0;
  while (line.length < input.minLength && index < words.length * 20) {
    const nextWord = words[index % words.length];
    const candidate = `${line} ${nextWord}`.trim();
    if (candidate.length > input.maxLength) {
      break;
    }
    line = candidate;
    index += 1;
  }
  return line;
}

function buildNativeCaptionTemplateBackfill(input: {
  contextPacket: NativeCaptionContextPacket;
  constraints: Stage2HardConstraints;
  missingCount: number;
  existingCandidates: NativeCaptionCandidate[];
}): { backfilledCandidates: NativeCaptionTemplateBackfillCandidate[] } | null {
  if (input.missingCount <= 0) {
    return null;
  }
  const observed =
    input.contextPacket.grounding.observedFacts[0] ??
    input.contextPacket.grounding.visibleSequence[0] ??
    "the visible turn";
  const secondaryObserved =
    input.contextPacket.grounding.visibleSequence[1] ??
    input.contextPacket.grounding.safeInferences[0] ??
    observed;
  const microTurn = normalizeNativeCaptionPhrase(
    input.contextPacket.grounding.microTurn,
    "the whole read locks in"
  );
  const firstSignal = normalizeNativeCaptionPhrase(
    input.contextPacket.grounding.firstSecondsSignal,
    "the reaction starts early"
  );
  const consensus = normalizeNativeCaptionPhrase(
    input.contextPacket.audienceWave.consensusLane ||
      input.contextPacket.audienceWave.jokeLane ||
      input.contextPacket.strategy.bottomFunctions[0],
    "the audience read is already doing the work"
  );
  const uncertainty = normalizeNativeCaptionPhrase(
    input.contextPacket.grounding.uncertainties[0] ||
      input.contextPacket.audienceWave.dissentLane ||
      "viewers are reading more into it without proving hidden facts",
    "viewers are reading more into it without proving hidden facts"
  );
  const handle = input.contextPacket.audienceWave.dominantHarmlessHandle;
  const seen = new Set(
    input.existingCandidates.map((candidate) => `${candidate.top.toLowerCase()}|${candidate.bottom.toLowerCase()}`)
  );
  const templates: Array<{
    templateFamily: NativeCaptionTemplateBackfillCandidate["templateFamily"];
    laneId: string;
    retainedHandle: boolean;
    top: string;
    bottom: string;
  }> = [
    {
      templateFamily: "handle_first",
      laneId: handle ? "audience_locked" : "balanced_clean",
      retainedHandle: Boolean(handle),
      top: handle
        ? `${handle} becomes the whole public read once ${microTurn.toLowerCase()} happens.`
        : `${observed} becomes the whole public read once ${microTurn.toLowerCase()} happens.`,
      bottom: `${consensus} lands because ${firstSignal.toLowerCase()}.`
    },
    {
      templateFamily: "contrast_first",
      laneId: "balanced_clean",
      retainedHandle: false,
      top: `${observed} should read ordinary until ${microTurn.toLowerCase()} turns it into the why-care.`,
      bottom: `${consensus} makes sense because ${secondaryObserved.toLowerCase()}.`
    },
    {
      templateFamily: "reaction_first",
      laneId: "human_observational",
      retainedHandle: false,
      top: `The reaction explains the whole moment before the full sequence even finishes.`,
      bottom: `${consensus} works because ${observed.toLowerCase()} is already visible.`
    },
    {
      templateFamily: "plain_observed",
      laneId: "backup_simple",
      retainedHandle: false,
      top: `${observed} is the visible fact that makes the moment work immediately.`,
      bottom: `${consensus} keeps the social read clean without inventing anything extra.`
    },
    {
      templateFamily: "uncertainty_safe",
      laneId: "skeptic_or_precision",
      retainedHandle: false,
      top: `${observed} is what the moment clearly gives you before viewers read anything deeper into it.`,
      bottom: `${uncertainty} stays a public read, not a claim of hidden fact.`
    }
  ];

  const backfilledCandidates: NativeCaptionTemplateBackfillCandidate[] = [];
  for (const [index, template] of templates.entries()) {
    const paddedTop = padNativeCaptionLineToMinLength({
      line: sanitizeNativeCaptionTemplateLine(template.top, input.constraints),
      minLength: input.constraints.topLengthMin,
      maxLength: input.constraints.topLengthMax,
      fillerPhrases: [
        observed,
        secondaryObserved,
        microTurn,
        firstSignal,
        consensus,
        handle ?? ""
      ]
    });
    const paddedBottom = padNativeCaptionLineToMinLength({
      line: sanitizeNativeCaptionTemplateLine(template.bottom, input.constraints),
      minLength: input.constraints.bottomLengthMin,
      maxLength: input.constraints.bottomLengthMax,
      fillerPhrases: [
        consensus,
        uncertainty,
        observed,
        secondaryObserved,
        microTurn,
        handle ?? ""
      ]
    });
    const repaired = repairCandidateForHardConstraints(
      {
        candidateId: `template_backfill_${index + 1}`,
        angle: template.laneId,
        top: paddedTop,
        bottom: paddedBottom,
        topRu: paddedTop,
        bottomRu: paddedBottom,
        rationale: template.templateFamily
      },
      input.constraints
    );
    const dedupeKey = `${repaired.candidate.top.toLowerCase()}|${repaired.candidate.bottom.toLowerCase()}`;
    if (!repaired.valid || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    backfilledCandidates.push({
      candidateId: repaired.candidate.candidateId,
      laneId: template.laneId,
      angle: template.laneId,
      top: repaired.candidate.top,
      bottom: repaired.candidate.bottom,
      retainedHandle: template.retainedHandle,
      displayIntent: "template_backfill",
      templateFamily: template.templateFamily
    });
    if (backfilledCandidates.length >= input.missingCount) {
      break;
    }
  }

  const deterministicVariants = [
    {
      laneId: "backup_simple",
      templateFamily: "plain_observed" as const,
      retainedHandle: false,
      top: `${observed} is the whole reason the moment keeps its hold even before anything bigger is proven.`,
      bottom: `${consensus} stays readable because ${microTurn.toLowerCase()} never really loosens its grip.`
    },
    {
      laneId: "balanced_clean",
      templateFamily: "contrast_first" as const,
      retainedHandle: false,
      top: `${observed} looks ordinary for a second and then the room tone shifts into the real why-care.`,
      bottom: `${consensus} lands because ${firstSignal.toLowerCase()} shows up so early.`
    },
    {
      laneId: handle ? "audience_locked" : "human_observational",
      templateFamily: handle ? ("handle_first" as const) : ("reaction_first" as const),
      retainedHandle: Boolean(handle),
      top: handle
        ? `${handle} is the public read because ${observed.toLowerCase()} never stops feeding it.`
        : `The visible reaction is already enough to tell you why viewers lock onto this moment.`,
      bottom: `${consensus} works because ${secondaryObserved.toLowerCase()} keeps backing it up.`
    },
    {
      laneId: "skeptic_or_precision",
      templateFamily: "uncertainty_safe" as const,
      retainedHandle: false,
      top: `${observed} is the clear part, and everything louder than that is still just a viewer read.`,
      bottom: `${uncertainty} keeps the read honest without killing the social meaning.`
    },
    {
      laneId: "backup_simple",
      templateFamily: "plain_observed" as const,
      retainedHandle: false,
      top: `${observed} keeps the moment interesting because the visible turn lands before anyone needs extra context.`,
      bottom: `${consensus} is enough reaction on its own without inventing more than the moment gives you.`
    },
    {
      laneId: "balanced_clean",
      templateFamily: "reaction_first" as const,
      retainedHandle: false,
      top: `The whole moment starts making sense once the reaction and the pause line up in the same beat.`,
      bottom: `${consensus} follows naturally because ${observed.toLowerCase()} is already on screen.`
    }
  ];

  for (const [index, template] of deterministicVariants.entries()) {
    if (backfilledCandidates.length >= input.missingCount) {
      break;
    }
    const paddedTop = padNativeCaptionLineToMinLength({
      line: sanitizeNativeCaptionTemplateLine(template.top, input.constraints),
      minLength: input.constraints.topLengthMin,
      maxLength: input.constraints.topLengthMax,
      fillerPhrases: [
        observed,
        secondaryObserved,
        microTurn,
        firstSignal,
        consensus,
        handle ?? ""
      ]
    });
    const paddedBottom = padNativeCaptionLineToMinLength({
      line: sanitizeNativeCaptionTemplateLine(template.bottom, input.constraints),
      minLength: input.constraints.bottomLengthMin,
      maxLength: input.constraints.bottomLengthMax,
      fillerPhrases: [
        consensus,
        uncertainty,
        observed,
        secondaryObserved,
        microTurn,
        handle ?? ""
      ]
    });
    const repaired = repairCandidateForHardConstraints(
      {
        candidateId: `template_backfill_variant_${index + 1}`,
        angle: template.laneId,
        top: paddedTop,
        bottom: paddedBottom,
        topRu: paddedTop,
        bottomRu: paddedBottom,
        rationale: `${template.templateFamily}_variant`
      },
      input.constraints
    );
    const dedupeKey = `${repaired.candidate.top.toLowerCase()}|${repaired.candidate.bottom.toLowerCase()}`;
    if (!repaired.valid || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    backfilledCandidates.push({
      candidateId: repaired.candidate.candidateId,
      laneId: template.laneId,
      angle: template.laneId,
      top: repaired.candidate.top,
      bottom: repaired.candidate.bottom,
      retainedHandle: template.retainedHandle,
      displayIntent: "template_backfill",
      templateFamily: template.templateFamily
    });
  }

  const guardrailVariants = [
    {
      laneId: handle ? "audience_locked" : "balanced_clean",
      templateFamily: handle ? ("handle_first" as const) : ("plain_observed" as const),
      retainedHandle: Boolean(handle),
      topFragments: [handle ?? observed, observed, microTurn, firstSignal, consensus, secondaryObserved],
      bottomFragments: [consensus, uncertainty, observed, secondaryObserved, microTurn, firstSignal]
    },
    {
      laneId: "balanced_clean",
      templateFamily: "contrast_first" as const,
      retainedHandle: false,
      topFragments: [observed, secondaryObserved, firstSignal, microTurn, consensus, observed],
      bottomFragments: [consensus, observed, microTurn, uncertainty, secondaryObserved, consensus]
    },
    {
      laneId: "human_observational",
      templateFamily: "reaction_first" as const,
      retainedHandle: false,
      topFragments: [firstSignal, observed, microTurn, secondaryObserved, consensus, observed],
      bottomFragments: [observed, consensus, uncertainty, microTurn, secondaryObserved, consensus]
    },
    {
      laneId: "backup_simple",
      templateFamily: "plain_observed" as const,
      retainedHandle: false,
      topFragments: [observed, consensus, firstSignal, microTurn, observed, secondaryObserved],
      bottomFragments: [consensus, observed, uncertainty, firstSignal, microTurn, consensus]
    },
    {
      laneId: "skeptic_or_precision",
      templateFamily: "uncertainty_safe" as const,
      retainedHandle: false,
      topFragments: [observed, uncertainty, firstSignal, microTurn, observed, consensus],
      bottomFragments: [uncertainty, consensus, observed, secondaryObserved, microTurn, firstSignal]
    }
  ];

  for (const [index, variant] of guardrailVariants.entries()) {
    if (backfilledCandidates.length >= input.missingCount) {
      break;
    }
    const candidate: NativeCaptionTemplateBackfillCandidate = {
      candidateId: `template_backfill_guardrail_${index + 1}`,
      laneId: variant.laneId,
      angle: variant.laneId,
      top: composeNativeCaptionLineWithinWindow({
        fragments: variant.topFragments,
        minLength: input.constraints.topLengthMin,
        maxLength: input.constraints.topLengthMax
      }),
      bottom: composeNativeCaptionLineWithinWindow({
        fragments: variant.bottomFragments,
        minLength: input.constraints.bottomLengthMin,
        maxLength: input.constraints.bottomLengthMax
      }),
      retainedHandle: variant.retainedHandle,
      displayIntent: "template_backfill",
      templateFamily: variant.templateFamily
    };
    const dedupeKey = `${candidate.top.toLowerCase()}|${candidate.bottom.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    const constraintCheck = evaluateNativeCaptionConstraintCheck(candidate, input.constraints);
    if (!constraintCheck.passed) {
      continue;
    }
    seen.add(dedupeKey);
    backfilledCandidates.push(candidate);
  }

  return backfilledCandidates.length > 0 ? { backfilledCandidates } : null;
}

function buildNativeCaptionTitleWriterPrompt(input: {
  contextPacket: NativeCaptionContextPacket;
  channelConfig: Stage2RuntimeChannelConfig;
  winner: NativeCaptionCandidate | null;
  promptConfig: Stage2PromptConfig;
}): string {
  const channelLearning = buildNativeCaptionChannelLearningPayload(input.channelConfig, "compact");
  return renderJsonPrompt(
    resolveStage2PromptTemplate("titleWriter", input.promptConfig).configuredPrompt,
    {
      context_packet_json: input.contextPacket,
      line_profile_json: buildStage2WorkerProfilePromptPayload(
        getResolvedStage2WorkerProfile(input.channelConfig)
      ),
      channel_learning_json: channelLearning.payload,
      winner_candidate_json: input.winner
    }
  );
}

function normalizeNativeCaptionTitleOptions(raw: unknown): NativeCaptionTitleOption[] {
  const entries = Array.isArray(raw) ? raw : [];
  const normalized: NativeCaptionTitleOption[] = [];
  entries.forEach((entry, index) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const title = normalizeAllCapsTitleText(String(item.title ?? "").trim());
      const titleRu = normalizeAllCapsTitleText(String(item.title_ru ?? item.titleRu ?? "").trim());
      if (!title) {
        return;
      }
      normalized.push({
        option: Number(item.option ?? index + 1) || index + 1,
        title,
        ...(titleRu ? { titleRu, titleRuSource: "llm" as const } : {})
      });
    });
  return normalized.slice(0, 5);
}

function shouldRunStage2SeoGeneration(stageModels?: Partial<Stage2PipelineModelMap>): boolean {
  return Object.prototype.hasOwnProperty.call(stageModels ?? {}, "seo");
}

function buildStage2SeoComments(
  comments: ViralShortsVideoContext["comments"]
): CommentItem[] {
  return comments.map((comment, index) => ({
    id: `comment_${index + 1}`,
    author: comment.author,
    text: comment.text,
    likes: comment.likes,
    timestamp: null,
    postedAt: null
  }));
}

async function runStage2SeoStage(input: {
  enabled: boolean;
  sourceUrl: string;
  title: string;
  comments: ViralShortsVideoContext["comments"];
  omittedCommentsCount: number;
  userInstruction?: string | null;
  stage2Output: Pick<ViralShortsStage2Result, "inputAnalysis" | "captionOptions" | "finalPick">;
  executor: JsonStageExecutor;
  stageModels?: Partial<Stage2PipelineModelMap>;
  promptConfig: Stage2PromptConfig;
  warnings: StageWarning[];
  promptInputManifests: Partial<
    Record<Stage2PipelineStageId, Stage2DiagnosticsPromptStage["inputManifest"]>
  >;
  reportProgress: (event: PipelineProgressEvent) => Promise<void>;
  recordExecutedStage: (
    stageId: Stage2PipelineStageId,
    promptText: string,
    summary: string,
    resultPayload: unknown,
    options?: { usesImages?: boolean; model?: string | null }
  ) => void;
}): Promise<Stage2SeoOutput | null> {
  if (!input.enabled) {
    return null;
  }

  const seoPrompt = buildStage2SeoPrompt({
    sourceUrl: input.sourceUrl,
    title: input.title,
    comments: buildStage2SeoComments(input.comments),
    omittedCommentsCount: input.omittedCommentsCount,
    stage2Output: input.stage2Output,
    descriptionPrompt: resolveStage2PromptTemplate("seo", input.promptConfig).configuredPrompt,
    userInstruction: input.userInstruction
  });
  const seoReasoningEffort = resolveStageReasoningEffort("seo", input.promptConfig);
  input.promptInputManifests.seo = {
    learningDetail: "none",
    description: null,
    transcript: null,
    frames: null,
    comments: {
      availableCount: input.comments.length,
      passedCount: Math.min(24, input.comments.length),
      omittedCount: Math.max(0, input.omittedCommentsCount + Math.max(0, input.comments.length - 24)),
      truncated: input.omittedCommentsCount > 0 || input.comments.length > 24,
      limit: 24,
      passedCommentIds: input.comments
        .slice(0, 24)
        .map((_, index) => `comment_${index + 1}`)
    },
    examples: null,
    channelLearning: null,
    candidates: {
      passedCount: input.stage2Output.captionOptions.length,
      passedCandidateIds: input.stage2Output.captionOptions
        .map((option) => option.candidateId ?? `option_${option.option}`)
        .filter(Boolean),
      criticScoreCount: null,
      shortlistCount: input.stage2Output.captionOptions.length
    },
    stageFlags: [
      "seo description",
      "17 english tags",
      "15 long-tail search phrases",
      "12 hashtags"
    ]
  };

  await input.reportProgress({
    stageId: "seo",
    state: "running",
    promptChars: seoPrompt.length,
    reasoningEffort: seoReasoningEffort,
    detail: "Generating SEO description and tags."
  });
  const seoStartedAt = Date.now();

  try {
    const rawSeo = await input.executor.runJson<unknown>({
      prompt: seoPrompt,
      schema: STAGE2_SEO_OUTPUT_SCHEMA,
      model: input.stageModels?.seo ?? null,
      reasoningEffort: seoReasoningEffort
    });
    const seo = parseStage2SeoOutput(rawSeo);
    await input.reportProgress({
      stageId: "seo",
      state: "completed",
      durationMs: Date.now() - seoStartedAt,
      promptChars: seoPrompt.length,
      reasoningEffort: seoReasoningEffort,
      detail: "SEO description and tags generated."
    });
    input.recordExecutedStage(
      "seo",
      seoPrompt,
      "LLM stage: writes one SEO description block plus comma-separated YouTube tags.",
      seo,
      { model: input.stageModels?.seo ?? null }
    );
    return seo;
  } catch (error) {
    const message =
      error instanceof Error ? `SEO fallback used: ${error.message}` : "SEO fallback used.";
    input.warnings.push({
      field: "seo",
      message
    });
    await input.reportProgress({
      stageId: "seo",
      state: "completed",
      durationMs: Date.now() - seoStartedAt,
      promptChars: seoPrompt.length,
      reasoningEffort: seoReasoningEffort,
      detail: message
    });
    input.recordExecutedStage(
      "seo",
      seoPrompt,
      "LLM stage: writes one SEO description block plus comma-separated YouTube tags.",
      { fallback: true, message },
      { model: input.stageModels?.seo ?? null }
    );
    return null;
  }
}

function buildNativeCaptionTranslationPrompt(input: {
  displayOptions: Array<{
    candidateId: string;
    top: string;
    bottom: string;
  }>;
  promptConfig: Stage2PromptConfig;
}): string {
  return renderJsonPrompt(
    resolveStage2PromptTemplate("captionTranslation", input.promptConfig).configuredPrompt,
    {
      display_options_json: input.displayOptions.map((option) => ({
        candidate_id: option.candidateId,
        top: option.top,
        bottom: option.bottom
      }))
    }
  );
}

type NativeCaptionHighlightingArtifact = {
  highlightedAt: string;
  items: Array<{
    candidateId: string;
    top: TemplateCaptionHighlightPhraseMap["top"];
    bottom: TemplateCaptionHighlightPhraseMap["bottom"];
    source: "llm" | "fallback";
  }>;
  coverage: {
    requestedCount: number;
    highlightedCount: number;
    fallbackCount: number;
    fallbackCandidateIds: string[];
  };
};

function buildNativeCaptionHighlightingPrompt(input: {
  displayOptions: Array<{
    candidateId: string;
    top: string;
    bottom: string;
  }>;
  highlightProfile: NonNullable<Stage2RuntimeChannelConfig["templateHighlightProfile"]>;
  promptConfig: Stage2PromptConfig;
}): string {
  return renderJsonPrompt(
    resolveStage2PromptTemplate("captionHighlighting", input.promptConfig).configuredPrompt,
    {
      template_highlight_profile_json: {
        enabled: input.highlightProfile.enabled,
        top_enabled: input.highlightProfile.topEnabled,
        bottom_enabled: input.highlightProfile.bottomEnabled,
        slots: getEnabledTemplateHighlightSlots(input.highlightProfile).map((slot) => ({
          slot_id: slot.slotId,
          label: slot.label,
          guidance: slot.guidance
        }))
      },
      display_options_json: input.displayOptions.map((option) => ({
        candidate_id: option.candidateId,
        top: option.top,
        bottom: option.bottom
      }))
    }
  );
}

function normalizeNativeCaptionHighlightingArtifact(
  raw: unknown,
  displayOptions: Array<{
    candidateId: string;
    top: string;
    bottom: string;
  }>
): NativeCaptionHighlightingArtifact | null {
  const optionIds = new Set(displayOptions.map((option) => option.candidateId));
  const entries = Array.isArray(raw) ? raw : [];
  const items: NativeCaptionHighlightingArtifact["items"] = [];
  entries.forEach((entry) => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const candidateId = String(item.candidate_id ?? item.candidateId ?? "").trim();
    if (!optionIds.has(candidateId)) {
      return;
    }
    items.push({
      candidateId,
      top: normalizeTemplateHighlightPhraseAnnotations({ top: item.top, bottom: [] }).top,
      bottom: normalizeTemplateHighlightPhraseAnnotations({ top: [], bottom: item.bottom }).bottom,
      source: "llm"
    });
  });
  const highlightedIds = new Set(items.map((entry) => entry.candidateId));
  const fallbackCandidateIds = displayOptions
    .map((option) => option.candidateId)
    .filter((candidateId) => !highlightedIds.has(candidateId));
  return {
    highlightedAt: new Date().toISOString(),
    items: [
      ...items,
      ...fallbackCandidateIds.map((candidateId) => ({
        candidateId,
        top: [],
        bottom: [],
        source: "fallback" as const
      }))
    ],
    coverage: {
      requestedCount: displayOptions.length,
      highlightedCount: items.length,
      fallbackCount: fallbackCandidateIds.length,
      fallbackCandidateIds
    }
  };
}

function buildCaptionHighlightsFromPhraseMap(input: {
  topText: string;
  bottomText: string;
  phrases?: TemplateCaptionHighlightPhraseMap | null;
}): TemplateCaptionHighlights {
  return {
    top: buildDistributedTemplateHighlightSpansFromPhrases({
      text: input.topText,
      annotations: input.phrases?.top ?? []
    }),
    bottom: buildDistributedTemplateHighlightSpansFromPhrases({
      text: input.bottomText,
      annotations: input.phrases?.bottom ?? []
    })
  };
}

function normalizeNativeCaptionTranslationArtifact(
  raw: unknown,
  displayOptions: Array<{
    candidateId: string;
    top: string;
    bottom: string;
  }>,
  retriedCandidateIds: string[] = []
): NativeCaptionTranslationArtifact | null {
  const optionIds = new Set(displayOptions.map((option) => option.candidateId));
  const entries = Array.isArray(raw) ? raw : [];
  const items: NativeCaptionTranslationArtifact["items"] = [];
  entries.forEach((entry) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const candidateId = String(item.candidate_id ?? item.candidateId ?? "").trim();
      const topRu = String(item.top_ru ?? item.topRu ?? "").trim();
      const bottomRu = String(item.bottom_ru ?? item.bottomRu ?? "").trim();
      if (!optionIds.has(candidateId) || !bottomRu) {
        return;
      }
      items.push({
        candidateId,
        topRu,
        bottomRu,
        source: "llm" as const
      });
    });
  const translatedIds = new Set(items.map((entry) => entry.candidateId));
  const fallbackCandidateIds = displayOptions
    .map((option) => option.candidateId)
    .filter((candidateId) => !translatedIds.has(candidateId));
  return items.length > 0
    ? {
        translatedAt: new Date().toISOString(),
        items,
        coverage: {
          requestedCount: displayOptions.length,
          translatedCount: items.length,
          fallbackCount: fallbackCandidateIds.length,
          fallbackCandidateIds,
          retriedCandidateIds
        }
      }
    : null;
}

function applyExampleRoutingToSelectorOutput(input: {
  selectorOutput: SelectorOutput;
  availableExamples: Stage2CorpusExample[];
  exampleRouting: ExampleRoutingDecision | null;
}): SelectorOutput {
  if (!input.exampleRouting) {
    return input.selectorOutput;
  }

  if (input.exampleRouting.mode === "disabled") {
    return {
      ...input.selectorOutput,
      selectedExampleIds: [],
      selectedExamples: [],
      rejectedExampleIds: input.availableExamples.map((example) => example.id)
    };
  }

  const allowedExamples = applyExampleRoutingDecision({
    availableExamples: input.availableExamples,
    decision: input.exampleRouting
  });
  const allowedIds = new Set(allowedExamples.map((example) => example.id));
  const selectedExampleIds = (input.selectorOutput.selectedExampleIds ?? []).filter((exampleId) =>
    allowedIds.has(exampleId)
  );
  const selectedExamples = allowedExamples.filter((example) => selectedExampleIds.includes(example.id));
  const blockedExampleIds = input.availableExamples
    .filter((example) => !allowedIds.has(example.id))
    .map((example) => example.id);
  const rejectedExampleIds = Array.from(
    new Set([...(input.selectorOutput.rejectedExampleIds ?? []), ...blockedExampleIds])
  );

  return {
    ...input.selectorOutput,
    selectedExampleIds,
    selectedExamples,
    rejectedExampleIds
  };
}

function buildModeAwareWriterBrief(input: {
  baseBrief: string;
  assessment: Stage2ExamplesAssessment;
  analyzerOutput: AnalyzerOutput;
}): string {
  const diversityGuardrail =
    "Keep the batch varied in bottom openings and continuation logic, and avoid stock tails that could fit unrelated clips.";
  const plainLanguageGuardrail =
    "Keep it plain. If the clip/comments sound simple, stay simple. No pseudo-slang.";
  const commentCarryProfile = buildCommentCarryProfile(input.analyzerOutput);
  const dominantCuePreview = commentCarryProfile.dominantCues.slice(0, 2).join(" | ");
  const commentCarryGuardrail =
    commentCarryProfile.expectation === "high"
      ? ` High-signal shorthand is available (${dominantCuePreview}). Keep at least 2 candidates cashing one cue in naturally instead of sanding everything into generic reaction English.`
      : commentCarryProfile.expectation === "medium"
        ? ` Usable shorthand is available (${dominantCuePreview}). Let at least 1 candidate carry it naturally when it sharpens the bottom.`
        : "";
  if (input.assessment.examplesMode === "domain_guided") {
    return `${input.baseBrief} The retrieval pool is domain-near enough to help with framing and trigger logic, but clip truth still outranks example mimicry. ${plainLanguageGuardrail} ${diversityGuardrail}${commentCarryGuardrail}`;
  }
  if (input.assessment.examplesMode === "form_guided") {
    return `${input.baseBrief} Examples are for form guidance only: use them for rhythm, density, and top/bottom construction, not for borrowed nouns or domain assumptions. ${plainLanguageGuardrail} ${diversityGuardrail}${commentCarryGuardrail}`;
  }
  return `${input.baseBrief} Retrieval is weak here, so let the clip, bootstrap style directions, and editorial memory drive the narrative. Examples are weak support only. ${plainLanguageGuardrail} ${diversityGuardrail}${commentCarryGuardrail}`;
}

function isSupportedSelectorAngle(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 80;
}

function buildFallbackRankedAngleReason(angle: string, index: number, fallback: SelectorOutput): string {
  return (
    fallback.rankedAngles.find((item) => item.angle === angle)?.why ??
    (index === 0
      ? "Primary selector angle chosen by the LLM."
      : "Backup selector angle kept as a viable alternative.")
  );
}

function fallbackSelectorOutput(
  channelConfig: Stage2RuntimeChannelConfig,
  analyzerOutput: AnalyzerOutput,
  availableExamples: Stage2CorpusExample[],
  videoContext: ViralShortsVideoContext,
  examplesAssessment: Stage2ExamplesAssessment,
  exampleInsights: Array<{
    exampleId: string;
    guidanceRole: Stage2ExampleGuidanceRole;
  }>
): SelectorOutput {
  const queryText = buildCorpusQueryText(videoContext, analyzerOutput);
  const commentCarryProfile = buildCommentCarryProfile(analyzerOutput);
  const stakes = analyzerOutput.stakes.map((stake) => stake.toLowerCase());
  const chosenExamples = pickExamplesForMode({
    availableExamples: [...availableExamples].sort(
      (left, right) => scoreExampleMatch(queryText, right) - scoreExampleMatch(queryText, left)
    ),
    assessment: examplesAssessment,
    exampleInsights
  });

  const clipType =
    chosenExamples[0]?.clipType || classifyClipType("general", analyzerOutput.rawSummary || videoContext.title);

  const rankedAngles = Array.from(
    new Map(
      [
        analyzerOutput.stakes.some((stake) => /danger/i.test(stake))
          ? {
              angle: "tension_danger",
              score: 9.3,
              why: "Visible strain or risk is the clearest framing."
            }
          : {
              angle: "payoff_reveal",
              score: 9.3,
              why: "The clip has a visible turn or payoff the overlay can set up cleanly."
            },
        analyzerOutput.commentVibe.toLowerCase().includes("respect")
          ? {
              angle: "warmth_reverence",
              score: 8.7,
              why: `Comment vibe leans ${analyzerOutput.commentVibe}.`
            }
          : {
              angle: "shared_experience",
              score: 8.7,
              why: `Comment vibe leans ${analyzerOutput.commentVibe}.`
            },
        analyzerOutput.stakes.some((stake) => /scale|awe/i.test(stake))
          ? {
              angle: "awe_scale",
              score: 8.1,
              why: "The footage reads as scale or spectacle."
            }
          : {
              angle: "competence_process",
              score: 8.1,
              why: "The clip benefits from concrete scene logic and visible process."
            },
        {
          angle: "absurdity_chaos",
          score: 7.8,
          why: "Fallback option if the scene plays more weird or chaotic than technical."
        }
      ].map((item) => [item.angle, item] as const)
    ).values()
  ).slice(0, 3);

  return {
    clipType,
    primaryAngle: rankedAngles[0]?.angle ?? "payoff_reveal",
    secondaryAngles: rankedAngles.slice(1, 3).map((item) => item.angle),
    rankedAngles,
    coreTrigger: analyzerOutput.coreTrigger,
    humanStake: analyzerOutput.humanStake,
    narrativeFrame: analyzerOutput.narrativeFrame,
    whyViewerCares: analyzerOutput.whyViewerCares,
    topStrategy: stakes.includes("danger")
      ? "danger-first setup"
      : stakes.includes("competence")
        ? "competence-first setup"
        : stakes.includes("absurdity")
          ? "paradox-first setup"
          : "contrast-first context compression",
    bottomEnergy: analyzerOutput.bestBottomEnergy,
    whyOldV6WouldWorkHere:
      "Old v6 would anchor on the strongest visible trigger fast, compress why the moment matters into the TOP, and use the BOTTOM for an immediate human reaction instead of explanation.",
    failureModes: [
      "literal camera-log description",
      "object inventory instead of trigger framing",
      "bottom repeating top",
      "overly clean AI wording",
      ...(commentCarryProfile.expectation !== "low"
        ? ["sanding down strong audience shorthand into generic reaction copy"]
        : []),
      ...(examplesAssessment.examplesMode === "domain_guided"
        ? []
        : ["borrowing nouns or market logic from weak examples instead of the actual clip"])
    ],
    selectedExampleIds: chosenExamples.map((example) => example.id),
    selectedExamples: chosenExamples,
    rejectedExampleIds: [],
    confidence: chosenExamples.length > 0 ? 0.54 : 0.3,
    rationale:
      chosenExamples.length > 0
        ? `Fallback selector used the ${examplesAssessment.examplesMode} retrieval assessment instead of treating every example as equally semantic.`
        : "Fallback selector had no examples available and relied on the analyzer output only.",
    writerBrief: buildModeAwareWriterBrief({
      baseBrief: `Write for ${channelConfig.name}. Lead with the visible scene, then react like a human viewer.`,
      assessment: examplesAssessment,
      analyzerOutput
    })
  };
}

function normalizeSelectorOutput(
  raw: unknown,
  fallback: SelectorOutput,
  availableExamples: Stage2CorpusExample[],
  examplesAssessment: Stage2ExamplesAssessment,
  exampleInsights: Array<{
    exampleId: string;
    guidanceRole: Stage2ExampleGuidanceRole;
  }>,
  analyzerOutput: AnalyzerOutput
): SelectorOutput {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const commentCarryProfile = buildCommentCarryProfile(analyzerOutput);
  const rankedAnglesRaw = Array.isArray(obj.ranked_angles)
    ? obj.ranked_angles
    : Array.isArray(obj.rankedAngles)
      ? obj.rankedAngles
      : fallback.rankedAngles;
  const selectedIdsRaw = Array.isArray(obj.selected_example_ids)
    ? obj.selected_example_ids
    : Array.isArray(obj.selectedExampleIds)
      ? obj.selectedExampleIds
      : fallback.selectedExampleIds ?? [];
  const selectedExampleIds = selectedIdsRaw
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const selectedExamplesByModel = availableExamples.filter((example) => selectedExampleIds.includes(example.id));
  const selectedExamples =
    pickExamplesForMode({
      availableExamples:
        selectedExamplesByModel.length > 0 ? selectedExamplesByModel : availableExamples,
      assessment: examplesAssessment,
      exampleInsights
    }).slice(
      0,
      examplesAssessment.examplesMode === "domain_guided"
        ? 6
        : examplesAssessment.examplesMode === "form_guided"
          ? 4
          : 3
    );
  const requestedPrimaryAngle = String(
    obj.primary_angle ??
      obj.primaryAngle ??
      (Array.isArray(rankedAnglesRaw) ? (rankedAnglesRaw[0] as Record<string, unknown> | undefined)?.angle : null) ??
      fallback.primaryAngle ??
      fallback.rankedAngles[0]?.angle ??
      "payoff_reveal"
  ).trim();
  const primaryAngle =
    (requestedPrimaryAngle && isSupportedSelectorAngle(requestedPrimaryAngle)
      ? requestedPrimaryAngle
      : fallback.primaryAngle) || fallback.primaryAngle;
  const secondaryAnglesRaw = Array.isArray(obj.secondary_angles)
    ? obj.secondary_angles
    : Array.isArray(obj.secondaryAngles)
      ? obj.secondaryAngles
      : fallback.secondaryAngles;
  const secondaryAngles = secondaryAnglesRaw
    .map((value) => String(value ?? "").trim())
    .filter((value) => Boolean(value) && value !== primaryAngle && isSupportedSelectorAngle(value))
    .slice(0, 3);
  const rejectedExampleIds = (Array.isArray(obj.rejected_example_ids)
    ? obj.rejected_example_ids
    : Array.isArray(obj.rejectedExampleIds)
      ? obj.rejectedExampleIds
      : fallback.rejectedExampleIds ?? []
  )
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);
  const rankedAnglesNormalized =
    rankedAnglesRaw
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const item = entry as Record<string, unknown>;
        const angle = String(item.angle ?? "").trim();
        const why = String(item.why ?? "").trim();
        const score = Number(item.score);
        if (!angle || !why || !Number.isFinite(score) || !isSupportedSelectorAngle(angle)) {
          return null;
        }
        return { angle, why, score };
      })
      .filter((item): item is SelectorOutput["rankedAngles"][number] => item !== null)
      .slice(0, 3);
  const synthesizedRankedAngles = [primaryAngle, ...secondaryAngles]
    .filter(Boolean)
    .slice(0, 3)
    .map((angle, index) => ({
      angle,
      score: Number((9.4 - index * 0.6).toFixed(1)),
      why: buildFallbackRankedAngleReason(angle, index, fallback)
    }));
  const rankedAngles = (() => {
    const rankedMap = new Map<string, SelectorOutput["rankedAngles"][number]>();
    rankedMap.set(primaryAngle, {
      angle: primaryAngle,
      score: Number((rankedAnglesNormalized[0]?.score ?? 9.4).toFixed(1)),
      why: buildFallbackRankedAngleReason(primaryAngle, 0, fallback)
    });
    for (const item of rankedAnglesNormalized) {
      if (!rankedMap.has(item.angle)) {
        rankedMap.set(item.angle, item);
      }
    }
    for (const item of synthesizedRankedAngles) {
      if (!rankedMap.has(item.angle)) {
        rankedMap.set(item.angle, item);
      }
    }
    for (const item of fallback.rankedAngles.filter((entry) => isSupportedSelectorAngle(entry.angle))) {
      if (!rankedMap.has(item.angle)) {
        rankedMap.set(item.angle, item);
      }
    }
    return Array.from(rankedMap.values()).slice(0, 3);
  })();
  const resolvedSecondaryAngles = secondaryAngles.length >= 1
    ? secondaryAngles
    : fallback.secondaryAngles.filter((angle) => angle !== primaryAngle && isSupportedSelectorAngle(angle)).slice(0, 3);

  return {
    clipType: String(obj.clip_type ?? obj.clipType ?? fallback.clipType).trim() || fallback.clipType,
    primaryAngle,
    secondaryAngles: rankedAngles
      .map((item) => item.angle)
      .filter((angle) => angle !== primaryAngle)
      .slice(0, 3)
      .concat(resolvedSecondaryAngles.filter((angle) => !rankedAngles.some((item) => item.angle === angle)))
      .slice(0, 3),
    rankedAngles,
    coreTrigger:
      String(obj.core_trigger ?? obj.coreTrigger ?? fallback.coreTrigger ?? "").trim() ||
      fallback.coreTrigger,
    humanStake:
      String(obj.human_stake ?? obj.humanStake ?? fallback.humanStake ?? "").trim() ||
      fallback.humanStake,
    narrativeFrame:
      String(obj.narrative_frame ?? obj.narrativeFrame ?? fallback.narrativeFrame ?? "").trim() ||
      fallback.narrativeFrame,
    whyViewerCares:
      String(obj.why_viewer_cares ?? obj.whyViewerCares ?? fallback.whyViewerCares ?? "").trim() ||
      fallback.whyViewerCares,
    topStrategy:
      String(obj.top_strategy ?? obj.topStrategy ?? fallback.topStrategy ?? "").trim() ||
      fallback.topStrategy,
    bottomEnergy:
      String(obj.bottom_energy ?? obj.bottomEnergy ?? fallback.bottomEnergy ?? "").trim() ||
      fallback.bottomEnergy,
    whyOldV6WouldWorkHere:
      String(
        obj.why_old_v6_would_work_here ??
          obj.whyOldV6WouldWorkHere ??
          fallback.whyOldV6WouldWorkHere ??
          ""
      ).trim() || fallback.whyOldV6WouldWorkHere,
    failureModes: (Array.isArray(obj.failure_modes)
      ? obj.failure_modes
      : Array.isArray(obj.failureModes)
        ? obj.failureModes
        : fallback.failureModes
    )
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .concat(
        commentCarryProfile.expectation !== "low"
          ? ["sanding down strong audience shorthand into generic reaction copy"]
          : []
      )
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 8),
    selectedExampleIds:
      selectedExamples.length >= 1 ? selectedExamples.map((example) => example.id) : fallback.selectedExampleIds,
    rejectedExampleIds,
    selectedExamples: selectedExamples.length >= 1 ? selectedExamples : fallback.selectedExamples,
    rationale:
      String(obj.selection_rationale ?? obj.rationale ?? fallback.rationale ?? "").trim() ||
      fallback.rationale,
    writerBrief: buildModeAwareWriterBrief({
      baseBrief:
        String(obj.writer_brief ?? obj.writerBrief ?? fallback.writerBrief).trim() || fallback.writerBrief,
      assessment: examplesAssessment,
      analyzerOutput
    }),
    confidence:
      Number.isFinite(Number(obj.confidence)) ? Number(obj.confidence) : fallback.confidence
  };
}

function normalizeCandidates(
  raw: unknown,
  selectorOutput: SelectorOutput,
  options?: {
    candidateIdPrefix?: string;
    forbiddenCandidateIds?: Set<string>;
  }
): CandidateCaption[] {
  const candidatesRaw = Array.isArray((raw as { candidates?: unknown })?.candidates)
    ? ((raw as { candidates: unknown[] }).candidates ?? [])
    : Array.isArray(raw)
      ? raw
      : [];
  const forbiddenCandidateIds = options?.forbiddenCandidateIds ?? new Set<string>();
  const emittedCandidateIds = new Set<string>();

  return candidatesRaw
    .map((entry, index): CandidateCaption | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const item = entry as Record<string, unknown>;
      const fallbackAngle = selectorOutput.rankedAngles[0]?.angle ?? "payoff_reveal";
      const rawCandidateId =
        String(item.candidate_id ?? item.candidateId ?? `cand_${index + 1}`).trim() ||
        `cand_${index + 1}`;
      const prefixedCandidateId = options?.candidateIdPrefix
        ? `${options.candidateIdPrefix}${rawCandidateId}`
        : rawCandidateId;
      let candidateId = prefixedCandidateId;
      let collisionIndex = 1;
      while (forbiddenCandidateIds.has(candidateId) || emittedCandidateIds.has(candidateId)) {
        candidateId = `${prefixedCandidateId}_${collisionIndex}`;
        collisionIndex += 1;
      }
      const top = String(item.top ?? "").trim();
      const bottom = String(item.bottom ?? "").trim();
      if (!bottom) {
        return null;
      }
      emittedCandidateIds.add(candidateId);
      return {
        candidateId,
        angle: String(item.angle ?? fallbackAngle).trim() || fallbackAngle,
        top,
        bottom,
        topRu: String(item.top_ru ?? item.topRu ?? top).trim() || top,
        bottomRu: String(item.bottom_ru ?? item.bottomRu ?? bottom).trim() || bottom,
        rationale: String(item.rationale ?? "").trim() || "Generated by writer stage.",
        styleDirectionIds: (Array.isArray(item.style_direction_ids)
          ? item.style_direction_ids
          : Array.isArray(item.styleDirectionIds)
            ? item.styleDirectionIds
            : []
        )
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
          .slice(0, 3),
        explorationMode:
          String(item.exploration_mode ?? item.explorationMode ?? "").trim() === "exploratory"
            ? "exploratory"
            : "aligned"
      };
    })
    .filter((candidate): candidate is CandidateCaption => candidate !== null);
}

type Stage2VNextPackedBridgeEntry = {
  candidate: CandidateCaption;
  packedCandidate: Stage2VNextPackedCandidate;
  valid: boolean;
  issues: string[];
};

type Stage2VNextRecoveryContext = {
  reason: "critic_survivor_shortfall";
  passNumber: number;
  targetAdditionalSurvivors: number;
  existingCandidateIds: string[];
  survivingCandidateIds: string[];
  blockedCandidateIds: string[];
  blockedPatterns: string[];
};

function summarizeUniqueIssueNotes(issues: string[], maxItems = 8): string[] {
  return Array.from(
    new Set(
      issues
        .map((issue) => issue.trim())
        .filter(Boolean)
    )
  ).slice(0, maxItems);
}

function buildCriticShortfallRecoveryContext(input: {
  passNumber: number;
  targetAdditionalSurvivors: number;
  candidates: CandidateCaption[];
  criticScores: CriticScore[];
}): Stage2VNextRecoveryContext {
  const rejectedScores = input.criticScores.filter((score) => !score.keep);
  return {
    reason: "critic_survivor_shortfall",
    passNumber: input.passNumber,
    targetAdditionalSurvivors: input.targetAdditionalSurvivors,
    existingCandidateIds: input.candidates.map((candidate) => candidate.candidateId),
    survivingCandidateIds: input.criticScores
      .filter((score) => score.keep)
      .map((score) => score.candidateId),
    blockedCandidateIds: rejectedScores.map((score) => score.candidateId),
    blockedPatterns: summarizeUniqueIssueNotes(
      rejectedScores.flatMap((score) => score.issues)
    )
  };
}

function joinPromptPasses(prompts: string[]): string {
  return prompts.filter((prompt) => prompt.trim().length > 0).join("\n\n----- RECOVERY PASS -----\n\n");
}

async function runNativeCaptionHighlightingStage(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  captionOptions: Array<{
    candidateId: string;
    top: string;
    bottom: string;
  }>;
  executor: JsonStageExecutor;
  stageModels?: Partial<Stage2PipelineModelMap>;
  promptConfig: Stage2PromptConfig;
  warnings: StageWarning[];
  promptInputManifests: Partial<Record<Stage2PipelineStageId, Stage2DiagnosticsPromptStage["inputManifest"]>>;
  reportProgress: (event: PipelineProgressEvent) => Promise<void>;
  recordExecutedStage: (
    stageId: Stage2PipelineStageId,
    promptText: string,
    summary: string,
    resultPayload: unknown,
    options?: { usesImages?: boolean; model?: string | null }
  ) => void;
}): Promise<Map<string, TemplateCaptionHighlights>> {
  const emptyByCandidate = new Map(
    input.captionOptions.map((option) => [option.candidateId, createEmptyTemplateCaptionHighlights()] as const)
  );
  const highlightProfile = input.channelConfig.templateHighlightProfile;
  if (!highlightProfile || !hasEnabledTemplateHighlights(highlightProfile)) {
    await input.reportProgress({
      stageId: "captionHighlighting",
      state: "completed",
      detail: "Template highlighting disabled for this channel; skipped."
    });
    return emptyByCandidate;
  }

  const reasoningEffort = resolveStageReasoningEffort("captionHighlighting", input.promptConfig);
  const model = input.stageModels?.captionHighlighting ?? input.stageModels?.captionTranslation ?? null;
  input.promptInputManifests.captionHighlighting = {
    learningDetail: "none",
    description: null,
    transcript: null,
    frames: null,
    comments: null,
    examples: null,
    channelLearning: null,
    candidates: {
      passedCount: input.captionOptions.length,
      passedCandidateIds: input.captionOptions.map((option) => option.candidateId),
      criticScoreCount: 0,
      shortlistCount: input.captionOptions.length
    },
    stageFlags: ["template highlight tagging", "exact substring spans", "fail open"]
  };

  const promptText = buildNativeCaptionHighlightingPrompt({
    displayOptions: input.captionOptions,
    highlightProfile,
    promptConfig: input.promptConfig
  });
  await input.reportProgress({
    stageId: "captionHighlighting",
    state: "running",
    promptChars: promptText.length,
    reasoningEffort,
    detail: "Tagging exact highlight spans for the display shortlist."
  });

  const startedAt = Date.now();
  let artifact: NativeCaptionHighlightingArtifact;
  try {
    const raw = await input.executor.runJson<unknown>({
      prompt: promptText,
      schema: NATIVE_CAPTION_HIGHLIGHTING_SCHEMA,
      model,
      reasoningEffort
    });
    artifact =
      normalizeNativeCaptionHighlightingArtifact(raw, input.captionOptions) ?? {
        highlightedAt: new Date().toISOString(),
        items: input.captionOptions.map((option) => ({
          candidateId: option.candidateId,
          top: [],
          bottom: [],
          source: "fallback" as const
        })),
        coverage: {
          requestedCount: input.captionOptions.length,
          highlightedCount: 0,
          fallbackCount: input.captionOptions.length,
          fallbackCandidateIds: input.captionOptions.map((option) => option.candidateId)
        }
      };
  } catch (error) {
    input.warnings.push({
      field: "captionHighlighting",
      message:
        error instanceof Error
          ? `Caption highlighting fallback used: ${error.message}`
          : "Caption highlighting fallback used."
    });
    artifact = {
      highlightedAt: new Date().toISOString(),
      items: input.captionOptions.map((option) => ({
        candidateId: option.candidateId,
        top: [],
        bottom: [],
        source: "fallback" as const
      })),
      coverage: {
        requestedCount: input.captionOptions.length,
        highlightedCount: 0,
        fallbackCount: input.captionOptions.length,
        fallbackCandidateIds: input.captionOptions.map((option) => option.candidateId)
      }
    };
  }

  await input.reportProgress({
    stageId: "captionHighlighting",
    state: "completed",
    durationMs: Date.now() - startedAt,
    promptChars: promptText.length,
    reasoningEffort,
    detail:
      artifact.coverage.highlightedCount > 0
        ? `Caption highlighting tagged ${artifact.coverage.highlightedCount}/${artifact.coverage.requestedCount} option(s); ${artifact.coverage.fallbackCount} used empty fallback metadata.`
        : "Caption highlighting returned no valid matches; empty metadata used."
  });
  input.recordExecutedStage(
    "captionHighlighting",
    promptText,
    "LLM stage: tags exact highlight substrings for enabled template color slots and falls back to empty metadata on failure.",
    artifact,
    { model }
  );

  const byCandidate = new Map<string, TemplateCaptionHighlights>();
  for (const option of input.captionOptions) {
    const item = artifact.items.find((entry) => entry.candidateId === option.candidateId);
    byCandidate.set(
      option.candidateId,
      item
        ? buildCaptionHighlightsFromPhraseMap({
            topText: option.top,
            bottomText: option.bottom,
            phrases: {
              top: item.top,
              bottom: item.bottom
            }
          })
        : createEmptyTemplateCaptionHighlights()
    );
  }
  return byCandidate;
}

function resolveStage2VNextFrameRole(
  index: number,
  total: number
): SourcePacket["frames"][number]["role"] {
  if (index === 0) {
    return "setup";
  }
  if (index === total - 1) {
    return "payoff";
  }
  if (index >= Math.max(1, total - 2)) {
    return "turn";
  }
  return "extra";
}

function buildStage2VNextSourcePacket(videoContext: ViralShortsVideoContext): SourcePacket {
  return {
    sourceId: videoContext.sourceUrl,
    sourceUrl: videoContext.sourceUrl,
    title: videoContext.title,
    description: videoContext.description,
    transcript: videoContext.transcript || null,
    durationSec: null,
    frames: videoContext.frameDescriptions.map((description, index, frames) => ({
      frameId: `frame_${index + 1}`,
      tsSec: index,
      role: resolveStage2VNextFrameRole(index, frames.length),
      imageRef: description
    })),
    comments: videoContext.comments.map((comment, index) => ({
      id: comment.id?.trim() || `comment_${index + 1}`,
      author: comment.author,
      text: comment.text,
      likes: comment.likes,
      postedAt: comment.postedAt ?? null
    })),
    metadata: {
      provider: "stage2-vnext",
      downloadedAt: new Date().toISOString(),
      totalComments: videoContext.comments.length
    }
  };
}

function buildStage2VNextClipTruthPacket(
  analyzerOutput: AnalyzerOutput,
  selectorOutput: SelectorOutput
): ClipTruthPacket {
  return {
    observedFacts: [
      analyzerOutput.subject,
      analyzerOutput.action,
      analyzerOutput.setting,
      analyzerOutput.payoff
    ].filter(Boolean),
    visibleAnchors: analyzerOutput.visualAnchors,
    visibleActions: analyzerOutput.visibleActions,
    sceneBeats: analyzerOutput.sceneBeats,
    revealMoment: analyzerOutput.revealMoment,
    lateClipChange: analyzerOutput.lateClipChange,
    pauseSafeTopFacts: [
      ...analyzerOutput.visualAnchors,
      ...analyzerOutput.specificNouns,
      ...analyzerOutput.visibleActions
    ]
      .filter(Boolean)
      .slice(0, 8),
    inferredReads: [selectorOutput.narrativeFrame, selectorOutput.humanStake].filter(Boolean),
    uncertaintyNotes: analyzerOutput.uncertaintyNotes,
    claimGuardrails: [...analyzerOutput.genericRisks, ...analyzerOutput.uncertaintyNotes]
      .filter(Boolean)
      .slice(0, 8),
    firstSecondsSignal: analyzerOutput.firstSecondsSignal,
    whyViewerCares: selectorOutput.whyViewerCares || analyzerOutput.whyViewerCares
  };
}

function resolveAudienceShorthandPressure(
  analyzerOutput: AnalyzerOutput
): AudiencePacket["shorthandPressure"] {
  const cueCount = new Set(
    [...analyzerOutput.slangToAdapt, ...analyzerOutput.commentLanguageCues]
      .map((cue) => cue.trim().toLowerCase())
      .filter(Boolean)
  ).size;
  if (cueCount >= 3 || analyzerOutput.commentSuspicionLane.trim().length > 0) {
    return "high";
  }
  if (cueCount >= 1) {
    return "medium";
  }
  return "low";
}

function buildStage2VNextAudiencePacket(analyzerOutput: AnalyzerOutput): AudiencePacket {
  return {
    sentimentSummary: analyzerOutput.commentVibe,
    consensusLane: analyzerOutput.commentConsensusLane,
    jokeLane: analyzerOutput.commentJokeLane,
    dissentLane: analyzerOutput.commentDissentLane,
    suspicionLane: analyzerOutput.commentSuspicionLane,
    shorthandPressure: resolveAudienceShorthandPressure(analyzerOutput),
    allowedCues: analyzerOutput.slangToAdapt.slice(0, 6),
    bannedCues: analyzerOutput.uncertaintyNotes
      .filter((note) => /do not|not confirmed|not a fact|avoid/i.test(note))
      .slice(0, 6),
    normalizedSlang: analyzerOutput.slangToAdapt.slice(0, 6).map((cue) => ({
      raw: cue,
      safeNativeEquivalent: cue,
      keepRawAllowed: true
    })),
    moderationFindings: analyzerOutput.genericRisks
      .filter((risk) => /racist|slur|toxic|junk|bait|insult|off-policy/i.test(risk))
      .slice(0, 6)
  };
}

function buildStage2VNextSemanticDrafts(
  candidates: CandidateCaption[]
): Stage2VNextSemanticDraft[] {
  return candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    angleId: candidate.angle,
    explorationMode:
      candidate.explorationMode === "exploratory" ? "exploratory" : "aligned",
    semanticTop: candidate.top,
    semanticBottom: candidate.bottom,
    cuesUsed: candidate.styleDirectionIds ?? [],
    rationale: candidate.rationale
  }));
}

function buildStage2VNextStrategyPacket(
  selectorOutput: SelectorOutput,
  exampleRouting: ExampleRoutingDecision
): StrategyPacket {
  const rankedAngles = selectorOutput.rankedAngles.length > 0
    ? selectorOutput.rankedAngles
    : [{ angle: selectorOutput.primaryAngle, score: 1, why: selectorOutput.rationale ?? "vNext fallback." }];
  const toStrategyAngle = (angle: SelectorOutput["rankedAngles"][number]) => ({
    angleId: angle.angle,
    label: angle.angle,
    rationale: angle.why,
    hookMode: "hook_first" as const,
    bottomEnergy: selectorOutput.bottomEnergy,
    claimPolicy: [],
    rejectPatterns: selectorOutput.failureModes.slice(0, 4)
  });

  return {
    primaryAngle: toStrategyAngle(rankedAngles[0]!),
    secondaryAngles: rankedAngles.slice(1, 3).map(toStrategyAngle),
    rankedAngleIds: rankedAngles.map((angle) => angle.angle),
    revealPolicy: "hint_only",
    commentUsagePolicy: [],
    exampleMode: exampleRouting.mode,
    writerDo: [selectorOutput.writerBrief],
    writerDont: selectorOutput.failureModes.slice(0, 6)
  };
}

function buildStage2VNextPackedBridgeEntries(input: {
  candidates: CandidateCaption[];
  constraints: Stage2HardConstraints;
}): Stage2VNextPackedBridgeEntry[] {
  return input.candidates.map((candidate) => {
    const repaired = repairCandidateForHardConstraints(candidate, input.constraints);
    const lengthValidation = validateLengthWindow({
      top: repaired.candidate.top,
      bottom: repaired.candidate.bottom,
      constraints: input.constraints
    });
    const bannedPatternValidation = validateBannedPatterns({
      top: repaired.candidate.top,
      bottom: repaired.candidate.bottom,
      constraints: input.constraints
    });
    const schemaPass =
      repaired.candidate.top.trim().length > 0 && repaired.candidate.bottom.trim().length > 0;
    const valid =
      repaired.valid &&
      schemaPass &&
      lengthValidation.topLengthPass &&
      lengthValidation.bottomLengthPass &&
      bannedPatternValidation.passed;

    return {
      candidate: repaired.candidate,
      packedCandidate: {
        candidateId: repaired.candidate.candidateId,
        parentCandidateId: candidate.candidateId,
        angleId: repaired.candidate.angle,
        top: repaired.candidate.top,
        bottom: repaired.candidate.bottom,
        topRu: repaired.candidate.topRu,
        bottomRu: repaired.candidate.bottomRu,
        topLength: lengthValidation.topLength,
        bottomLength: lengthValidation.bottomLength,
        repairCount: repaired.repaired ? 1 : 0,
        validations: {
          schemaPass,
          topLengthPass: lengthValidation.topLengthPass,
          bottomLengthPass: lengthValidation.bottomLengthPass,
          bannedPatternPass: bannedPatternValidation.passed
        }
      },
      valid,
      issues: [...lengthValidation.issues, ...bannedPatternValidation.issues]
    };
  });
}

function buildStage2VNextJudgeCards(criticScores: CriticScore[]): JudgeScoreCard[] {
  return criticScores.map((score) => ({
    candidateId: score.candidateId,
    hardPass: score.keep,
    hardFailReasons: score.keep ? [] : score.issues.length > 0 ? score.issues : ["legacy_critic_reject"],
    scores: {
      visualFaithfulness: score.scores.paused_frame_accuracy ?? 0,
      hookStrength: score.scores.hook_strength ?? 0,
      nativeFluency: score.scores.naturalness ?? 0,
      audienceAuthenticity: score.scores.comment_vibe_authenticity ?? 0,
      styleFit: score.scores.brand_fit ?? 0,
      riskSafety: score.scores.visual_anchor ?? 0
    },
    notes: score.issues
  }));
}

function buildStage2VNextExampleUsage(input: {
  exampleRouting: ExampleRoutingDecision;
  selectedExampleIds: string[];
}): Stage2VNextExampleUsage[] {
  return [
    {
      stageId: "example_router",
      exampleMode: input.exampleRouting.mode,
      passedExampleIds: input.exampleRouting.selectedExampleIds
    },
    {
      stageId: "strategy_search",
      exampleMode: input.exampleRouting.mode,
      passedExampleIds: input.exampleRouting.selectedExampleIds
    },
    {
      stageId: "semantic_draft_generator",
      exampleMode: input.exampleRouting.mode,
      passedExampleIds: input.selectedExampleIds
    },
    {
      stageId: "quality_court",
      exampleMode: input.exampleRouting.mode,
      passedExampleIds: input.selectedExampleIds
    },
    {
      stageId: "ranked_final_selector",
      exampleMode: input.exampleRouting.mode,
      passedExampleIds: input.selectedExampleIds
    },
    {
      stageId: "title_and_seo",
      exampleMode: input.exampleRouting.mode,
      passedExampleIds: input.selectedExampleIds
    }
  ];
}

const HARD_EDITORIAL_TASTE_PATTERNS = [
  /\bhidden script\b/i,
  /\bquiet courtroom\b/i,
  /\bsoft courtroom\b/i,
  /\banti-confirmation\b/i,
  /\bfandom detective mode\b/i,
  /\bmicro-drama\b/i,
  /\bin ten seconds\b/i,
  /\bcast(?:-|\s)and(?:-|\s)deny\b/i,
  /\bsocial boundaries\b/i,
  /\britual\b/i
];

const PROCESS_VOICE_PATTERNS = [
  /\bexecuted cleanly\b/i,
  /\bcalibration\b/i,
  /\bdemo\b/i,
  /\bprocess\b/i,
  /\btiming\b/i
];

function collectMatchedTastePhrases(text: string, patterns: RegExp[]): string[] {
  return Array.from(
    new Set(
      patterns.flatMap((pattern) => {
        const globalPattern = new RegExp(
          pattern.source,
          pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
        );
        return Array.from(text.matchAll(globalPattern)).map((match) => String(match[0] ?? "").trim());
      }).filter(Boolean)
    )
  );
}

function applyStage2VNextEditorialTasteGate(input: {
  criticScores: CriticScore[];
  candidates: CandidateCaption[];
}): CriticScore[] {
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.candidateId, candidate]));
  return input.criticScores.map((score) => {
    const candidate = candidateById.get(score.candidateId);
    if (!candidate) {
      return score;
    }

    const text = `${candidate.top} ${candidate.bottom}`.trim();
    const humanSignals = evaluateHumanPhrasingSignals(candidate);
    const hardEditorialMatches = collectMatchedTastePhrases(text, HARD_EDITORIAL_TASTE_PATTERNS);
    const processVoiceMatches =
      candidate.angle === "competence_process"
        ? collectMatchedTastePhrases(text, PROCESS_VOICE_PATTERNS)
        : [];

    const extraIssues = [
      ...hardEditorialMatches.map((phrase) => `editor_like_explanation: ${phrase}`),
      ...hardEditorialMatches
        .filter((phrase) => /quiet courtroom|hidden script|micro-drama|ritual/i.test(phrase))
        .map((phrase) => `stylized_metaphor_overreach: ${phrase}`),
      ...hardEditorialMatches
        .filter((phrase) => /anti-confirmation|fandom detective mode|social boundaries|cast-and-deny/i.test(phrase))
        .map((phrase) => `conceptual_abstraction: ${phrase}`),
      ...((hardEditorialMatches.length > 0 || humanSignals.syntheticPhrasing)
        ? [`not_comment_native: ${humanSignals.suspiciousPhrases[0] ?? hardEditorialMatches[0] ?? "editorialized phrasing"}`]
        : []),
      ...processVoiceMatches.map((phrase) => `process_voice_overreach: ${phrase}`)
    ];

    const penalty =
      hardEditorialMatches.length * 1.25 +
      (humanSignals.syntheticPhrasing ? 0.55 : humanSignals.inventedCompound ? 0.25 : 0) +
      processVoiceMatches.length * 0.45;
    const total = Number((score.total - penalty).toFixed(3));
    const hardReject = hardEditorialMatches.length > 0;
    const processReject = processVoiceMatches.length >= 2;

    return {
      ...score,
      total,
      keep: hardReject || processReject ? false : score.keep,
      issues: Array.from(new Set([...score.issues, ...extraIssues]))
    };
  });
}

function buildStage2VNextCriticGate(input: {
  criticScores: CriticScore[];
  rewriteCandidates: CandidateCaption[];
  validatedShortlistPoolCandidateIds: string[];
  visibleShortlistCandidateIds: string[];
  invalidDroppedCandidateIds: string[];
}): NonNullable<NonNullable<ViralShortsStage2Result["pipeline"]["vnext"]>["criticGate"]> {
  return {
    evaluatedCandidateIds: input.criticScores.map((score) => score.candidateId),
    criticKeptCandidateIds: input.criticScores
      .filter((score) => score.keep)
      .map((score) => score.candidateId),
    criticRejectedCandidateIds: input.criticScores
      .filter((score) => !score.keep)
      .map((score) => score.candidateId),
    rewriteCandidateIds: input.rewriteCandidates.map((candidate) => candidate.candidateId),
    validatedShortlistPoolIds: input.validatedShortlistPoolCandidateIds,
    visibleShortlistCandidateIds: input.visibleShortlistCandidateIds,
    invalidDroppedCandidateIds: input.invalidDroppedCandidateIds,
    reserveBackfillCount: 0
  };
}

function extractLeadingExcerpt(text: string, maxWords: number): string {
  const firstSentence = text.split(/(?<=[.!?]["']?)\s+/)[0] ?? text;
  const firstClause = firstSentence.split(/[,:;]/)[0] ?? firstSentence;
  return firstClause
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ")
    .replace(/^"+|"+$/g, "")
    .trim();
}

function extractQuotedReaction(text: string): string {
  const quoted = text.match(/^"[^"]+[.!?]?"/)?.[0];
  return quoted ?? `"${extractLeadingExcerpt(text, 8)}"`;
}

export function buildOperatorFacingFinalReason(input: {
  shortlist: CandidateCaption[];
  shortlistOptionMap: Array<{ candidateId: string; option: number }>;
  finalPickCandidateId: string;
}): { operatorReason: string; sanitizedRationaleRaw: string } {
  const finalPickOption =
    input.shortlistOptionMap.find((item) => item.candidateId === input.finalPickCandidateId)?.option ?? 1;
  const finalPickCandidate =
    input.shortlist.find((candidate) => candidate.candidateId === input.finalPickCandidateId) ??
    input.shortlist[0] ??
    null;
  const finalPickLabel = `option ${finalPickOption}`;
  if (!finalPickCandidate) {
    const fallback = `${finalPickLabel} is the strongest visible pick in this shortlist.`;
    return {
      operatorReason: fallback,
      sanitizedRationaleRaw: fallback
    };
  }

  const describeAngle = (angle: string): string => {
    switch (angle) {
      case "payoff_reveal":
        return "the clean payoff lane";
      case "absurdity_chaos":
        return "the absurdity read";
      case "tension_danger":
        return "the danger read";
      case "shared_experience":
        return "the crowd-reaction read";
      case "competence_process":
        return "the process read";
      case "insider_expertise":
        return "the insider read";
      case "warmth_reverence":
        return "the respect read";
      case "awe_scale":
        return "the awe read";
      default:
        return "a different read";
    }
  };

  const otherVisibleOptions = input.shortlistOptionMap
    .filter((item) => item.candidateId !== finalPickCandidate.candidateId)
    .map((item) => ({
      option: item.option,
      candidate: input.shortlist.find((candidate) => candidate.candidateId === item.candidateId) ?? null
    }))
    .filter(
      (
        item
      ): item is {
        option: number;
        candidate: CandidateCaption;
      } => item.candidate !== null
    );
  const angleAlternatives = Array.from(
    new Map(
      otherVisibleOptions
        .filter((item) => item.candidate.angle !== finalPickCandidate.angle)
        .map((item) => [item.candidate.angle, item])
    ).values()
  ).slice(0, 2);

  const topExcerpt = extractLeadingExcerpt(finalPickCandidate.top, 10);
  const bottomExcerpt = extractQuotedReaction(finalPickCandidate.bottom);
  const operatorReasonBase =
    `${finalPickLabel} is the strongest visible pick because it opens with "${topExcerpt}" ` +
    `and lands the reaction with ${bottomExcerpt}.`;
  const operatorReason =
    angleAlternatives.length > 0
      ? `${operatorReasonBase} The rest of the visible shortlist still gives real alternates: ${angleAlternatives
          .map((item) => `option ${item.option} keeps ${describeAngle(item.candidate.angle)}`)
          .join(", ")}.`
      : `${operatorReasonBase} The other visible options stay in the same lane, but this one has the cleanest hook-to-reaction path in the visible shortlist.`;
  const rewritten = operatorReason.trim();
  return {
    operatorReason: rewritten,
    sanitizedRationaleRaw: rewritten
  };
}

function normalizeCriticScores(raw: unknown, candidates: CandidateCaption[]): CriticScore[] {
  const allowedCandidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const rawScores = Array.isArray((raw as { scores?: unknown })?.scores)
    ? ((raw as { scores: unknown[] }).scores ?? [])
    : Array.isArray(raw)
      ? raw
      : [];

  const normalized = rawScores
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const item = entry as Record<string, unknown>;
      const candidateId = String(item.candidate_id ?? item.candidateId ?? "").trim();
      if (!candidateId || !allowedCandidateIds.has(candidateId)) {
        return null;
      }
      const scoreMapRaw =
        item.scores && typeof item.scores === "object"
          ? (item.scores as Record<string, unknown>)
          : {};
      const scores = Object.fromEntries(
        Object.entries(scoreMapRaw)
          .map(([key, value]) => [key, Number(value)])
          .filter((entry) => Number.isFinite(entry[1]))
      );
      return {
        candidateId,
        scores,
        total: Number.isFinite(Number(item.total)) ? Number(item.total) : 0,
        issues: Array.isArray(item.issues)
          ? item.issues.map((value) => String(value ?? "").trim()).filter(Boolean)
          : [],
        keep: Boolean(item.keep)
      };
    })
    .filter((item): item is CriticScore => item !== null);

  if (normalized.length > 0) {
    return normalized;
  }

  return candidates.map((candidate, index) => ({
    candidateId: candidate.candidateId,
    scores: {},
    total: candidates.length - index,
    issues: [],
    keep: index < 8
  }));
}

function normalizeFinalSelector(raw: unknown, candidates: CandidateCaption[]): FinalSelectorOutput {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const finalCandidatesRaw = Array.isArray(obj.final_candidates)
    ? obj.final_candidates
    : Array.isArray(obj.finalCandidates)
      ? obj.finalCandidates
      : [];
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const finalCandidates = finalCandidatesRaw
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && candidateIds.has(value))
    .slice(0, 5);
  const finalPick = String(obj.final_pick ?? obj.finalPick ?? finalCandidates[0] ?? "").trim();

  return {
    finalCandidates:
      finalCandidates.length > 0 ? finalCandidates : candidates.slice(0, 5).map((candidate) => candidate.candidateId),
    finalPick: finalPick || candidates[0]?.candidateId || "",
    rationale: String(obj.rationale ?? "").trim() || "Chosen by final selector."
  };
}

function containsBannedContent(text: string, constraints: Stage2HardConstraints): boolean {
  const lower = text.toLowerCase();
  return constraints.bannedWords.some((word) => lower.includes(word.toLowerCase()));
}

function startsWithBannedOpener(text: string, constraints: Stage2HardConstraints): boolean {
  const lower = text.trim().toLowerCase();
  return constraints.bannedOpeners.some((opener) => lower.startsWith(opener.toLowerCase()));
}

function containsCyrillicCharacters(text: string): boolean {
  return /[\u0400-\u04FF]/u.test(text);
}

type CandidateConstraintCheck = {
  passed: boolean;
  repaired: boolean;
  topLength: number;
  bottomLength: number;
  issues: string[];
};

const TERMINAL_PUNCTUATION_PATTERN = /[.!?]["']?$/;
const DANGLING_END_WORDS = new Set([
  "a",
  "an",
  "and",
  "anybody",
  "anyone",
  "anything",
  "as",
  "at",
  "because",
  "being",
  "but",
  "by",
  "do",
  "everybody",
  "everyone",
  "everything",
  "feels",
  "for",
  "from",
  "gets",
  "how",
  "in",
  "into",
  "just",
  "keeps",
  "like",
  "looks",
  "nobody",
  "nothing",
  "of",
  "on",
  "or",
  "somebody",
  "someone",
  "something",
  "sounds",
  "stays",
  "stop",
  "than",
  "that",
  "the",
  "then",
  "to",
  "turns",
  "until",
  "when",
  "while",
  "why",
  "with",
  "reads",
  "said",
  "says",
  "screamed",
  "screams",
  "seems",
  "showed",
  "shows",
  "signaled",
  "signals",
  "tells",
  "told",
  "means",
  "meant",
  "proved",
  "proves"
]);
// Keep repair semantic-light: invalid short lines should drop out instead of
// getting rescued by canned filler that changes the meaning of the clip.
const TOP_PADDING_OPTIONS: string[] = [];
const BOTTOM_PADDING_OPTIONS: string[] = [];
const GENERIC_BOTTOM_TAIL_PATTERNS = [
  /reaction basically writes itself/i,
  /whole room feels it immediately/i,
  /nobody there can shrug (?:it|that) off/i,
  /everybody in the shot gets the same message/i,
  /the whole room feels it/i
];

function stableTextHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function extractSentenceParts(text: string): string[] {
  return text
    .split(/(?<=[.!?]["']?)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractBottomTailSegment(text: string): string {
  const quoted = text.match(/^"[^"]+[.!?]?"/)?.[0];
  if (quoted) {
    const remainder = text.slice(quoted.length).trim();
    if (remainder) {
      return remainder;
    }
  }
  const parts = extractSentenceParts(text);
  return parts.length >= 2 ? parts[parts.length - 1] ?? text.trim() : text.trim();
}

function extractBottomLeadSegment(text: string): string {
  const quoted = text.match(/^"[^"]+[.!?]?"/)?.[0];
  if (quoted) {
    return quoted.trim();
  }
  const parts = extractSentenceParts(text);
  return parts.length >= 2 ? parts.slice(0, -1).join(" ").trim() : text.trim();
}

function normalizeTextKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBottomTailKey(text: string): string {
  const segment = normalizeTextKey(extractBottomTailSegment(text));
  return segment.length >= 20 ? segment : "";
}

function truncateToWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const sliced = text.slice(0, maxLength + 1);
  const sentenceBoundaryMatch = Array.from(sliced.matchAll(/[.!?]["']?(?=\s|$)/g)).at(-1);
  if (sentenceBoundaryMatch && sentenceBoundaryMatch.index !== undefined) {
    const boundaryEnd = sentenceBoundaryMatch.index + sentenceBoundaryMatch[0].length;
    if (boundaryEnd >= Math.floor(maxLength * 0.6)) {
      return sliced.slice(0, boundaryEnd).trim();
    }
  }
  const clauseBoundaries = [",", ";", ":", " -", " —"]
    .map((marker) => sliced.lastIndexOf(marker))
    .filter((index) => index >= Math.floor(maxLength * 0.6));
  const clauseBoundary = clauseBoundaries.length > 0 ? Math.max(...clauseBoundaries) : -1;
  if (clauseBoundary >= 0) {
    return sliced.slice(0, clauseBoundary).trim();
  }
  const boundary = sliced.lastIndexOf(" ");
  const trimmed = (boundary >= Math.floor(maxLength * 0.7) ? sliced.slice(0, boundary) : sliced.slice(0, maxLength)).trim();
  return trimmed.slice(0, maxLength).trim();
}

function extractLeadingCompleteSentences(text: string): string {
  const matches = text.match(/.+?[.!?]["']?(?=\s|$)/g);
  return matches ? matches.join(" ").trim() : "";
}

function extractNormalizedWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase())
    .filter(Boolean);
}

function looksLikeBrokenCaptionEnding(text: string): boolean {
  const value = text.trim();
  if (!value) {
    return true;
  }
  const completePrefix = extractLeadingCompleteSentences(value);
  if (completePrefix && completePrefix.length < value.length) {
    return true;
  }
  const words = extractNormalizedWords(value);
  if (words.length <= 4) {
    return !TERMINAL_PUNCTUATION_PATTERN.test(value);
  }
  const last = words.at(-1) ?? "";
  return DANGLING_END_WORDS.has(last);
}

function trimTrailingBrokenEndingWords(text: string): string {
  let value = text.trim();
  while (value && looksLikeBrokenCaptionEnding(value)) {
    const shortened = value.replace(/\s+[^\s]+[.!?,"']*$/u, "").trim();
    if (!shortened || shortened === value) {
      break;
    }
    value = shortened.replace(/[,:;]+$/, "").trim();
  }
  return value;
}

function trimTrailingIncompleteFragment(text: string): string {
  let value = text.trim();
  const patterns = [
    /\b(?:it|this|that|he|she|they|we|you)\s+(?:looks|looked|looking|feels|felt|feeling|sounds|seems|seemed|reads|read)\s+like\b(?:\s+\w+){0,4}$/i,
    /\b(?:like|because|when|while|until|if|as|than|that)\s+(?:\w+\s+){0,4}\w+$/i
  ];
  while (value) {
    const fragmentMatch = patterns
      .map((pattern) => value.match(pattern))
      .find((match) => match?.index !== undefined);
    if (!fragmentMatch || fragmentMatch.index === undefined || fragmentMatch.index <= 0) {
      break;
    }
    const shortened = value.slice(0, fragmentMatch.index).replace(/[,:;\s]+$/g, "").trim();
    if (!shortened || shortened === value) {
      break;
    }
    value = shortened;
  }
  return value;
}

function hasBrokenSentencePart(text: string): boolean {
  return extractSentenceParts(text).some((part) => looksLikeBrokenCaptionEnding(part));
}

function hasGenericBottomTail(text: string): boolean {
  return GENERIC_BOTTOM_TAIL_PATTERNS.some((pattern) => pattern.test(text));
}

function isCompromisedShortlistEntry(entry: ShortlistEntry): boolean {
  return (
    hasBrokenSentencePart(entry.candidate.bottom) ||
    (entry.constraintCheck.repaired && hasGenericBottomTail(entry.candidate.bottom))
  );
}

function ensureTerminalPunctuation(text: string, maxLength: number): string {
  let value = text.trim();
  if (!value || TERMINAL_PUNCTUATION_PATTERN.test(value)) {
    return value;
  }
  value = value.replace(/[,:;]+$/, "").trim();
  if (!value) {
    return value;
  }
  if (value.length >= maxLength) {
    value = truncateToWordBoundary(value, maxLength - 1).replace(/[,:;]+$/, "").trim();
  }
  return value ? `${value}.` : value;
}

function padTextToMinimum(
  text: string,
  minimum: number,
  maxLength: number,
  suffixOptions: string[],
  disallowedTailKeys?: Set<string>
): string | null {
  let value = text.trim();
  if (value.length >= minimum) {
    return ensureTerminalPunctuation(value, maxLength);
  }
  if (suffixOptions.length === 0) {
    return null;
  }
  const glue = TERMINAL_PUNCTUATION_PATTERN.test(value) ? " " : ". ";
  const currentTailKey = buildBottomTailKey(value);
  const filteredSuffixOptions = suffixOptions.filter(
    (suffix) => buildBottomTailKey(suffix) !== currentTailKey
  );
  const usableSuffixOptions = filteredSuffixOptions.length > 0 ? filteredSuffixOptions : suffixOptions;
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    const tailKey = buildBottomTailKey(normalized);
    if (
      !normalized ||
      seen.has(normalized) ||
      normalized.length > maxLength ||
      (tailKey && disallowedTailKeys?.has(tailKey))
    ) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };
  for (const suffix of usableSuffixOptions) {
    pushCandidate(`${value}${glue}${suffix.trim()}`);
  }
  if (candidates.every((candidate) => candidate.length < minimum)) {
    for (const firstSuffix of usableSuffixOptions) {
      const firstCandidate = `${value}${glue}${firstSuffix.trim()}`.trim();
      if (firstCandidate.length >= maxLength) {
        continue;
      }
      for (const secondSuffix of usableSuffixOptions) {
        if (firstSuffix === secondSuffix) {
          continue;
        }
        pushCandidate(`${firstCandidate} ${secondSuffix.trim()}`);
      }
    }
  }
  const viableCandidates = candidates.filter(
    (candidate) => candidate.length >= minimum && candidate.length <= maxLength
  );
  if (viableCandidates.length === 0) {
    return null;
  }
  const sortedCandidates = [...viableCandidates].sort((left, right) => left.length - right.length);
  const shortestLength = sortedCandidates[0]?.length ?? 0;
  const closeCandidates = sortedCandidates.filter((candidate) => candidate.length <= shortestLength + 18);
  if (closeCandidates.length === 0) {
    return sortedCandidates[0] ?? null;
  }
  return closeCandidates[stableTextHash(value) % closeCandidates.length] ?? closeCandidates[0] ?? null;
}

function repairCaptionLineForHardConstraints(input: {
  text: string;
  minimum: number;
  maximum: number;
  suffixOptions: string[];
  disallowedTailKeys?: Set<string>;
}): { text: string; repaired: boolean; valid: boolean } {
  let value = input.text.trim();
  let repaired = false;
  let repairedBrokenEnding = false;
  if (value.length > input.maximum) {
    value = truncateToWordBoundary(value, input.maximum);
    repaired = true;
  }
  if (looksLikeBrokenCaptionEnding(value)) {
    const prefix = extractLeadingCompleteSentences(value);
    if (prefix && prefix.length < value.length) {
      value = prefix;
      repaired = true;
      repairedBrokenEnding = true;
    } else {
      const trimmed = trimTrailingBrokenEndingWords(value);
      if (trimmed && trimmed !== value) {
        value = trimmed;
        repaired = true;
        repairedBrokenEnding = true;
      }
    }
    const trimmedFragment = trimTrailingIncompleteFragment(value);
    if (trimmedFragment && trimmedFragment !== value) {
      value = trimmedFragment;
      repaired = true;
      repairedBrokenEnding = true;
    }
    const retrimmed = trimTrailingBrokenEndingWords(value);
    if (retrimmed && retrimmed !== value) {
      value = retrimmed;
      repaired = true;
      repairedBrokenEnding = true;
    }
    if (extractNormalizedWords(value).length <= 4 || looksLikeBrokenCaptionEnding(value)) {
      return {
        text: value,
        repaired,
        valid: false
      };
    }
  }
  if (repairedBrokenEnding && value.length < input.minimum) {
    return {
      text: value,
      repaired,
      valid: false
    };
  }
  if (value.length < input.minimum) {
    const padded = padTextToMinimum(
      value,
      input.minimum,
      input.maximum,
      input.suffixOptions,
      input.disallowedTailKeys
    );
    if (!padded) {
      return {
        text: value,
        repaired,
        valid: false
      };
    }
    value = padded;
    repaired = true;
  }
  value = ensureTerminalPunctuation(value, input.maximum);
  return {
    text: value,
    repaired,
    valid:
      Boolean(value) &&
      value.length >= input.minimum &&
      value.length <= input.maximum &&
      !looksLikeBrokenCaptionEnding(value)
  };
}

export function repairCandidateForHardConstraints(
  candidate: CandidateCaption,
  constraints: Stage2HardConstraints
): { candidate: CandidateCaption; repaired: boolean; valid: boolean } {
  const repairedTop = repairCaptionLineForHardConstraints({
    text: candidate.top,
    minimum: constraints.topLengthMin,
    maximum: constraints.topLengthMax,
    suffixOptions: TOP_PADDING_OPTIONS
  });
  const repairedBottom = repairCaptionLineForHardConstraints({
    text: candidate.bottom,
    minimum: constraints.bottomLengthMin,
    maximum: constraints.bottomLengthMax,
    suffixOptions: BOTTOM_PADDING_OPTIONS
  });

  return {
    candidate:
      repairedTop.repaired || repairedBottom.repaired
        ? {
            ...candidate,
            top: repairedTop.text,
            bottom: repairedBottom.text
          }
        : candidate,
    repaired: repairedTop.repaired || repairedBottom.repaired,
    valid: repairedTop.valid && repairedBottom.valid
  };
}

export function evaluateCandidateHardConstraints(
  candidate: CandidateCaption,
  constraints: Stage2HardConstraints,
  repaired = false
): CandidateConstraintCheck {
  const topLength = candidate.top.length;
  const bottomLength = candidate.bottom.length;
  const issues: string[] = [];
  if (topLength < constraints.topLengthMin || topLength > constraints.topLengthMax) {
    issues.push(`TOP length ${topLength} вне диапазона ${constraints.topLengthMin}-${constraints.topLengthMax}.`);
  }
  if (bottomLength < constraints.bottomLengthMin || bottomLength > constraints.bottomLengthMax) {
    issues.push(
      `BOTTOM length ${bottomLength} вне диапазона ${constraints.bottomLengthMin}-${constraints.bottomLengthMax}.`
    );
  }
  if (containsBannedContent(candidate.top, constraints) || containsBannedContent(candidate.bottom, constraints)) {
    issues.push("Найдены banned words.");
  }
  if (startsWithBannedOpener(candidate.top, constraints)) {
    issues.push("TOP начинается с banned opener.");
  }
  if (containsCyrillicCharacters(candidate.top) || containsCyrillicCharacters(candidate.bottom)) {
    issues.push("TOP/BOTTOM must stay English-only; Russian belongs only in topRu/bottomRu.");
  }
  return {
    passed: issues.length === 0,
    repaired,
    topLength,
    bottomLength,
    issues
  };
}

type ShortlistEntry = {
  candidate: CandidateCaption;
  constraintCheck: CandidateConstraintCheck;
  criticTotal: number;
  commentCarryScore: number;
  usesDominantCommentCue: boolean;
  matchedCommentCues: string[];
  topSignals: Stage2TopQualitySignals;
  humanPhrasingSignals: Stage2HumanPhrasingSignals;
  selectionScore: number;
  valid: boolean;
};

type ShortlistStats = {
  targetCount: number;
  requestedCount: number;
  validatedCount: number;
  visibleCount: number;
  repairedCount: number;
  droppedAfterValidationCount: number;
  topSignalSummary?: Stage2TopSignalSummary;
  invalidReasonSummary?: string | null;
};

const REQUIRED_FINAL_SHORTLIST_COUNT = 5;
const MAX_REWRITER_CANDIDATE_COUNT = 8;
const MAX_STRICT_REWRITER_CANDIDATE_COUNT = 12;

function usesStrictShortlistConstraintWindow(constraints: Stage2HardConstraints): boolean {
  return (
    constraints.topLengthMin >= 120 ||
    constraints.bottomLengthMin >= 120 ||
    constraints.topLengthMax - constraints.topLengthMin <= 24 ||
    constraints.bottomLengthMax - constraints.bottomLengthMin <= 16
  );
}

function buildShortlistFailureMessage(stats: ShortlistStats): string {
  const base =
    `Stage 2 final shortlist could not produce ${stats.targetCount} valid options after constraint-safe ` +
    `repair and reserve backfill. Only ${stats.visibleCount}/${stats.targetCount} visible option(s) remained ` +
    `from ${stats.validatedCount} validated candidate(s) and ${stats.requestedCount} requested finalist pick(s).`;
  return stats.invalidReasonSummary ? `${base} ${stats.invalidReasonSummary}` : base;
}

function assertCompletedShortlistContract(input: {
  captionOptions: Array<{ candidateId?: string }>;
  candidateOptionMap: Array<{ option: number; candidateId: string }>;
  shortlistCandidateIds: string[];
  finalPickCandidateId: string;
}): void {
  const captionCandidateIds = input.captionOptions.map((option) => option.candidateId ?? "").filter(Boolean);
  const mapCandidateIds = input.candidateOptionMap.map((entry) => entry.candidateId);
  const shortlistCandidateIds = input.shortlistCandidateIds;

  if (
    captionCandidateIds.length !== REQUIRED_FINAL_SHORTLIST_COUNT ||
    mapCandidateIds.length !== REQUIRED_FINAL_SHORTLIST_COUNT ||
    shortlistCandidateIds.length !== REQUIRED_FINAL_SHORTLIST_COUNT
  ) {
    throw new Error(
      `Stage 2 completed shortlist contract drifted after assembly. Expected ${REQUIRED_FINAL_SHORTLIST_COUNT} ` +
      `visible options but got captionOptions=${captionCandidateIds.length}, ` +
      `candidateOptionMap=${mapCandidateIds.length}, shortlistCandidateIds=${shortlistCandidateIds.length}.`
    );
  }

  const captionIdsJson = JSON.stringify(captionCandidateIds);
  if (captionIdsJson !== JSON.stringify(mapCandidateIds) || captionIdsJson !== JSON.stringify(shortlistCandidateIds)) {
    throw new Error("Stage 2 completed shortlist contract drifted after assembly. Final selector state no longer matches the visible caption shortlist.");
  }

  if (!captionCandidateIds.includes(input.finalPickCandidateId)) {
    throw new Error("Stage 2 completed shortlist contract drifted after assembly. Final pick is not part of the persisted visible shortlist.");
  }
}

function computeShortlistSelectionScore(entry: {
  criticTotal: number;
  constraintCheck: CandidateConstraintCheck;
  candidate: CandidateCaption;
  commentCarryScore: number;
  usesDominantCommentCue: boolean;
  topSignals: Stage2TopQualitySignals;
  humanPhrasingSignals: Stage2HumanPhrasingSignals;
}): number {
  const genericTailPenalty = hasGenericBottomTail(entry.candidate.bottom)
    ? entry.constraintCheck.repaired
      ? 1.35
      : 0.55
    : 0;
  const repairedPenalty = entry.constraintCheck.repaired ? 0.12 : 0;
  const commentCarryBonus =
    entry.commentCarryScore >= 3
      ? 0.7
      : entry.commentCarryScore >= 2
        ? 0.45
        : entry.commentCarryScore > 0
          ? 0.2
          : 0;
  const dominantCueBonus = entry.usesDominantCommentCue ? 0.15 : 0;
  return Number(
    (
      entry.criticTotal +
      commentCarryBonus +
      dominantCueBonus +
      entry.topSignals.scoreAdjustment +
      entry.humanPhrasingSignals.scoreAdjustment -
      genericTailPenalty -
      repairedPenalty
    ).toFixed(3)
  );
}

function buildCandidateTopSignalSummary(entry: ShortlistEntry): Stage2CandidateTopSignalSummary {
  return {
    candidateId: entry.candidate.candidateId,
    inventoryOpening: entry.topSignals.inventoryOpening,
    lateHook: entry.topSignals.lateHook,
    pureBeatNarration: entry.topSignals.pureBeatNarration,
    earlyHookPresent: entry.topSignals.earlyHookPresent,
    notes: entry.topSignals.notes,
    scoreAdjustment: entry.topSignals.scoreAdjustment
  };
}

function buildTopSignalSummary(
  validatedEntries: ShortlistEntry[],
  visibleEntries: ShortlistEntry[]
): Stage2TopSignalSummary {
  const countFlags = (entries: ShortlistEntry[]) => ({
    inventoryOpening: entries.filter((entry) => entry.topSignals.inventoryOpening).length,
    lateHook: entries.filter((entry) => entry.topSignals.lateHook).length,
    pureBeatNarration: entries.filter((entry) => entry.topSignals.pureBeatNarration).length,
    earlyHookPresent: entries.filter((entry) => entry.topSignals.earlyHookPresent).length
  });

  return {
    validatedCounts: countFlags(validatedEntries),
    visibleCandidateSignals: visibleEntries.map(buildCandidateTopSignalSummary)
  };
}

function countDirectCommentCueMatches(entry: ShortlistEntry): number {
  const normalizedText = normalizeTextKey(`${entry.candidate.top} ${entry.candidate.bottom}`);
  return entry.matchedCommentCues.filter((cue) => {
    const normalizedCue = normalizeTextKey(cue);
    return Boolean(normalizedCue) && normalizedText.includes(normalizedCue);
  }).length;
}

function compareCommentNativeStrength(left: ShortlistEntry, right: ShortlistEntry): number {
  return (
    countDirectCommentCueMatches(right) - countDirectCommentCueMatches(left) ||
    right.commentCarryScore - left.commentCarryScore ||
    right.matchedCommentCues.length - left.matchedCommentCues.length ||
    right.criticTotal - left.criticTotal ||
    right.selectionScore - left.selectionScore
  );
}

function findCommentNativeUpgradeCandidate(
  entries: ShortlistEntry[],
  baselineEntry: ShortlistEntry,
  excludeCandidateId?: string
): ShortlistEntry | null {
  return (
    [...entries]
      .filter(
        (entry) =>
          entry.candidate.candidateId !== excludeCandidateId &&
          entry.usesDominantCommentCue &&
          !isCompromisedShortlistEntry(entry) &&
          entry.criticTotal >= baselineEntry.criticTotal - 0.35 &&
          entry.selectionScore >= baselineEntry.selectionScore - 1.25
      )
      .sort(compareCommentNativeStrength)[0] ?? null
  );
}

function shouldUpgradeTopHook(current: ShortlistEntry, replacement: ShortlistEntry): boolean {
  if (replacement.candidate.candidateId === current.candidate.candidateId) {
    return false;
  }
  const currentPenaltyScore =
    Number(current.topSignals.inventoryOpening) +
    Number(current.topSignals.lateHook) +
    Number(current.topSignals.pureBeatNarration);
  const replacementPenaltyScore =
    Number(replacement.topSignals.inventoryOpening) +
    Number(replacement.topSignals.lateHook) +
    Number(replacement.topSignals.pureBeatNarration);
  return (
    replacement.selectionScore >= current.selectionScore - 0.35 &&
    (replacement.topSignals.scoreAdjustment > current.topSignals.scoreAdjustment ||
      replacementPenaltyScore < currentPenaltyScore ||
      (replacement.topSignals.earlyHookPresent && !current.topSignals.earlyHookPresent))
  );
}

function shouldUpgradeHumanPhrasing(current: ShortlistEntry, replacement: ShortlistEntry): boolean {
  if (replacement.candidate.candidateId === current.candidate.candidateId) {
    return false;
  }
  const currentPenaltyScore =
    Number(current.humanPhrasingSignals.syntheticPhrasing) * 2 +
    Number(current.humanPhrasingSignals.inventedCompound);
  const replacementPenaltyScore =
    Number(replacement.humanPhrasingSignals.syntheticPhrasing) * 2 +
    Number(replacement.humanPhrasingSignals.inventedCompound);
  return (
    replacement.selectionScore >= current.selectionScore - 0.45 &&
    (replacement.humanPhrasingSignals.scoreAdjustment > current.humanPhrasingSignals.scoreAdjustment ||
      replacementPenaltyScore < currentPenaltyScore)
  );
}

function improveAcceptedTopHookEntries(
  accepted: ShortlistEntry[],
  remaining: ShortlistEntry[],
  protectedFinalPickId: string
): void {
  while (true) {
    const weakestHookEntry = accepted
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          (entry.candidate.candidateId !== protectedFinalPickId ||
            entry.topSignals.scoreAdjustment < 0) &&
          (entry.topSignals.scoreAdjustment < 0 ||
            entry.topSignals.inventoryOpening ||
            entry.topSignals.lateHook ||
            entry.topSignals.pureBeatNarration)
      )
      .sort(
        (left, right) =>
          left.entry.topSignals.scoreAdjustment - right.entry.topSignals.scoreAdjustment ||
          left.entry.selectionScore - right.entry.selectionScore
      )[0];
    if (!weakestHookEntry) {
      return;
    }

    const replacementIndex = remaining.findIndex((entry) =>
      shouldUpgradeTopHook(weakestHookEntry.entry, entry)
    );
    if (replacementIndex < 0) {
      return;
    }
    const [replacement] = remaining.splice(replacementIndex, 1);
    if (!replacement) {
      return;
    }
    accepted.splice(weakestHookEntry.index, 1, replacement);
    remaining.push(weakestHookEntry.entry);
    remaining.sort((left, right) => right.selectionScore - left.selectionScore);
  }
}

function buildRewriterCandidatePool(input: {
  candidates: CandidateCaption[];
  criticScores: CriticScore[];
  constraints: Stage2HardConstraints;
  allowReserveBackfill?: boolean;
}): {
  candidates: CandidateCaption[];
  criticApprovedCount: number;
  reserveBackfillCount: number;
} {
  const byId = new Map(input.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const criticApprovedIds = input.criticScores
    .filter((score) => score.keep && byId.has(score.candidateId))
    .map((score) => score.candidateId);

  if (criticApprovedIds.length === 0) {
    return {
      candidates: input.allowReserveBackfill === false ? [] : input.candidates,
      criticApprovedCount: 0,
      reserveBackfillCount: 0
    };
  }

  const selectedIds: string[] = [];
  const seen = new Set<string>();
  const pushCandidateId = (candidateId: string) => {
    if (!candidateId || seen.has(candidateId) || !byId.has(candidateId)) {
      return;
    }
    seen.add(candidateId);
    selectedIds.push(candidateId);
  };

  for (const candidateId of criticApprovedIds.slice(0, MAX_REWRITER_CANDIDATE_COUNT)) {
    pushCandidateId(candidateId);
  }

  const maxCandidateCount = usesStrictShortlistConstraintWindow(input.constraints)
    ? MAX_STRICT_REWRITER_CANDIDATE_COUNT
    : MAX_REWRITER_CANDIDATE_COUNT;
  const targetCount = Math.min(
    maxCandidateCount,
    Math.min(
      input.candidates.length,
      Math.max(
        REQUIRED_FINAL_SHORTLIST_COUNT,
        selectedIds.length,
        usesStrictShortlistConstraintWindow(input.constraints) ? MAX_STRICT_REWRITER_CANDIDATE_COUNT : selectedIds.length
      )
    )
  );

  if (selectedIds.length < targetCount && input.allowReserveBackfill !== false) {
    const reserveScores = [...input.criticScores]
      .filter((score) => !score.keep && byId.has(score.candidateId))
      .sort((left, right) => right.total - left.total);
    for (const score of reserveScores) {
      if (selectedIds.length >= targetCount) {
        break;
      }
      pushCandidateId(score.candidateId);
    }
  }

  if (selectedIds.length < targetCount && input.allowReserveBackfill !== false) {
    for (const candidate of input.candidates) {
      if (selectedIds.length >= targetCount) {
        break;
      }
      pushCandidateId(candidate.candidateId);
    }
  }

  return {
    candidates: selectedIds.map((candidateId) => byId.get(candidateId)!),
    criticApprovedCount: criticApprovedIds.length,
    reserveBackfillCount: Math.max(0, selectedIds.length - Math.min(criticApprovedIds.length, MAX_REWRITER_CANDIDATE_COUNT))
  };
}

function mergeRewriterCandidates(inputCandidates: CandidateCaption[], rewrites: CandidateCaption[]): {
  candidates: CandidateCaption[];
  appliedRewriteCount: number;
} {
  const allowedIds = new Set(inputCandidates.map((candidate) => candidate.candidateId));
  const rewriteById = new Map<string, CandidateCaption>();
  for (const rewrite of rewrites) {
    if (!allowedIds.has(rewrite.candidateId) || rewriteById.has(rewrite.candidateId)) {
      continue;
    }
    rewriteById.set(rewrite.candidateId, rewrite);
  }
  return {
    candidates: inputCandidates.map((candidate) => rewriteById.get(candidate.candidateId) ?? candidate),
    appliedRewriteCount: rewriteById.size
  };
}

export function buildInternalFinalSelectorReason(input: {
  evaluatedShortlist: CandidateCaption[];
  visibleShortlist: CandidateCaption[];
  finalPickCandidateId: string;
  shortlistStats?: ShortlistStats | null;
}): string {
  const evaluatedIds = Array.from(new Set(input.evaluatedShortlist.map((candidate) => candidate.candidateId)));
  const shortlistIds = input.visibleShortlist.map((candidate) => candidate.candidateId);
  const shortlistAngles = Array.from(new Set(input.visibleShortlist.map((candidate) => candidate.angle)));
  const pickId =
    input.visibleShortlist.find((candidate) => candidate.candidateId === input.finalPickCandidateId)?.candidateId ??
    shortlistIds[0] ??
    input.finalPickCandidateId;

  const base =
    `Final selector evaluated ${evaluatedIds.length} shortlist candidate${evaluatedIds.length === 1 ? "" : "s"}: ` +
    `${evaluatedIds.join(", ") || "none"}. ` +
    `Final visible shortlist is ${shortlistIds.join(", ") || "empty"} with ${pickId || "no final pick"} as the final pick.`;
  const angleNote =
    shortlistAngles.length > 0
      ? ` Visible angles: ${shortlistAngles.join(", ")}.`
      : "";
  return `${base}${angleNote}`.trim();
}

function extractCandidateLikeIds(value: string): string[] {
  return Array.from(
    new Set((value.match(/\b(?:cand_\d+|c\d{2,})\b/gi) ?? []).map((item) => item.toLowerCase()))
  );
}

function parseWordOrDigitCount(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }
  const numberWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };
  return numberWords[normalized] ?? null;
}

function parseClaimedUniqueCandidateCount(value: string): number | null {
  const match = value.match(/\bonly\s+([a-z0-9]+)\s+unique\s+candidates?\b/i);
  return match?.[1] ? parseWordOrDigitCount(match[1]) : null;
}

export function sanitizeFinalSelectorModelRationale(input: {
  rawRationale: string | null | undefined;
  visibleShortlist: CandidateCaption[];
  finalPickCandidateId: string;
}): string {
  const rawRationale = String(input.rawRationale ?? "").trim();
  const truthfulSummary = buildInternalFinalSelectorReason({
    evaluatedShortlist: input.visibleShortlist,
    visibleShortlist: input.visibleShortlist,
    finalPickCandidateId: input.finalPickCandidateId
  });

  if (!rawRationale) {
    return truthfulSummary;
  }

  const visibleIds = new Set(input.visibleShortlist.map((candidate) => candidate.candidateId.toLowerCase()));
  const mentionedIds = extractCandidateLikeIds(rawRationale);
  const mentionsOutsideVisibleShortlist = mentionedIds.some((candidateId) => !visibleIds.has(candidateId));
  const claimedUniqueCount = parseClaimedUniqueCandidateCount(rawRationale);
  const contradictsVisibleCount =
    typeof claimedUniqueCount === "number" &&
    claimedUniqueCount !== new Set(input.visibleShortlist.map((candidate) => candidate.candidateId)).size;

  if (mentionsOutsideVisibleShortlist || contradictsVisibleCount) {
    return `Sanitized because the model rationale contradicted the persisted shortlist. ${truthfulSummary}`;
  }

  return rawRationale;
}

function buildResolvedFinalSelectorState(input: {
  visibleShortlistEntries: ShortlistEntry[];
  requestedFinalPickCandidateId: string;
  shortlistStats?: ShortlistStats | null;
  commentCarryExpectation?: "low" | "medium" | "high";
}): {
  candidateOptionMap: Array<{
    option: number;
    candidateId: string;
  }>;
  shortlistCandidateIds: string[];
  finalPickCandidateId: string;
  progressSummary: string;
  progressDetail: string;
  rationaleInternalRaw: string;
} {
  const visibleShortlist = input.visibleShortlistEntries.map((entry) => entry.candidate);
  const shortlistCandidateIds = visibleShortlist.map((candidate) => candidate.candidateId);
  const candidateOptionMap = shortlistCandidateIds.map((candidateId, index) => ({
    option: index + 1,
    candidateId
  }));
  const requestedEntry = input.visibleShortlistEntries.find(
    (entry) => entry.candidate.candidateId === input.requestedFinalPickCandidateId
  );
  const requestedEntryCompromised = requestedEntry ? isCompromisedShortlistEntry(requestedEntry) : false;
  const fallbackFinalPickEntry = [...input.visibleShortlistEntries]
    .sort((left, right) => {
      const leftPenalty = Number(isCompromisedShortlistEntry(left));
      const rightPenalty = Number(isCompromisedShortlistEntry(right));
      return leftPenalty - rightPenalty || right.selectionScore - left.selectionScore;
    })
    .find((entry) => {
      if (!requestedEntryCompromised) {
        return true;
      }
      const cleanEnough = !isCompromisedShortlistEntry(entry);
      return cleanEnough && (!requestedEntry || entry.selectionScore >= requestedEntry.selectionScore - 0.75);
    });
  const commentNativeBaselineEntry = requestedEntry ?? fallbackFinalPickEntry;
  const strongerCommentNativeEntry =
    input.commentCarryExpectation === "high" &&
    commentNativeBaselineEntry &&
    !commentNativeBaselineEntry.usesDominantCommentCue
      ? findCommentNativeUpgradeCandidate(
          input.visibleShortlistEntries,
          commentNativeBaselineEntry,
          commentNativeBaselineEntry.candidate.candidateId
        )
      : null;
  const strongerTopHookEntry =
    requestedEntry &&
    (requestedEntry.topSignals.scoreAdjustment < 0 ||
      requestedEntry.topSignals.inventoryOpening ||
      requestedEntry.topSignals.lateHook ||
      requestedEntry.topSignals.pureBeatNarration)
      ? [...input.visibleShortlistEntries]
          .filter(
            (entry) =>
              entry.candidate.candidateId !== requestedEntry.candidate.candidateId &&
              !isCompromisedShortlistEntry(entry) &&
              shouldUpgradeTopHook(requestedEntry, entry)
          )
          .sort(
            (left, right) =>
              right.topSignals.scoreAdjustment - left.topSignals.scoreAdjustment ||
              right.selectionScore - left.selectionScore
          )[0]
      : null;
  const strongerPlainLanguageEntry =
    requestedEntry &&
    (requestedEntry.humanPhrasingSignals.syntheticPhrasing ||
      requestedEntry.humanPhrasingSignals.inventedCompound)
      ? [...input.visibleShortlistEntries]
          .filter(
            (entry) =>
              entry.candidate.candidateId !== requestedEntry.candidate.candidateId &&
              !isCompromisedShortlistEntry(entry) &&
              shouldUpgradeHumanPhrasing(requestedEntry, entry)
          )
          .sort(
            (left, right) =>
              right.humanPhrasingSignals.scoreAdjustment - left.humanPhrasingSignals.scoreAdjustment ||
              right.selectionScore - left.selectionScore
          )[0]
      : null;
  const resolvedRequestedEntry =
    requestedEntryCompromised
      ? fallbackFinalPickEntry
      : strongerCommentNativeEntry ??
        strongerPlainLanguageEntry ??
        strongerTopHookEntry ??
        requestedEntry ??
        fallbackFinalPickEntry;
  const commentNativeFinalPickEntry =
    input.commentCarryExpectation === "high" && resolvedRequestedEntry
      ? findCommentNativeUpgradeCandidate(
          input.visibleShortlistEntries,
          resolvedRequestedEntry,
          resolvedRequestedEntry.usesDominantCommentCue
            ? resolvedRequestedEntry.candidate.candidateId
            : undefined
        )
      : null;
  const finalResolvedEntry =
    commentNativeFinalPickEntry &&
    (!resolvedRequestedEntry || !resolvedRequestedEntry.usesDominantCommentCue)
      ? commentNativeFinalPickEntry
      : resolvedRequestedEntry;
  const finalPickCandidateId =
    finalResolvedEntry?.candidate.candidateId ??
    requestedEntry?.candidate.candidateId ??
    shortlistCandidateIds[0] ??
    input.requestedFinalPickCandidateId;
  const progressSummary = `Shortlist ${shortlistCandidateIds.length} / pick ${finalPickCandidateId || "none"}.`;

  return {
    candidateOptionMap,
    shortlistCandidateIds,
    finalPickCandidateId,
    progressSummary,
    progressDetail: progressSummary,
    rationaleInternalRaw: buildInternalFinalSelectorReason({
      evaluatedShortlist: visibleShortlist,
      visibleShortlist,
      finalPickCandidateId,
      shortlistStats: input.shortlistStats
    })
  };
}

function diversifyAcceptedBottomTails(
  accepted: ShortlistEntry[],
  remaining: ShortlistEntry[],
  protectedFinalPickId: string
): void {
  const findDuplicateTailIndices = () => {
    const seen = new Map<string, number>();
    const duplicates: number[] = [];
    for (let index = 0; index < accepted.length; index += 1) {
      const entry = accepted[index];
      if (!entry) {
        continue;
      }
      const tailKey = buildBottomTailKey(entry.candidate.bottom);
      if (!tailKey) {
        continue;
      }
      if (seen.has(tailKey)) {
        duplicates.push(index);
        continue;
      }
      seen.set(tailKey, index);
    }
    return duplicates;
  };

  while (true) {
    const duplicateIndices = findDuplicateTailIndices();
    if (duplicateIndices.length === 0) {
      break;
    }
    const duplicateIndex = duplicateIndices.find((index) => {
      const entry = accepted[index];
      return entry?.candidate.candidateId !== protectedFinalPickId;
    });
    if (duplicateIndex === undefined) {
      break;
    }
    const duplicateEntry = accepted[duplicateIndex];
    if (!duplicateEntry) {
      break;
    }

    const acceptedTailKeys = new Set(
      accepted
        .map((entry) => buildBottomTailKey(entry.candidate.bottom))
        .filter(Boolean)
    );
    const replacementIndex = remaining.findIndex((entry) => {
      const tailKey = buildBottomTailKey(entry.candidate.bottom);
      return (
        Boolean(tailKey) &&
        !acceptedTailKeys.has(tailKey) &&
        entry.selectionScore >= duplicateEntry.selectionScore - 0.75
      );
    });
    if (replacementIndex < 0) {
      break;
    }
    const [replacement] = remaining.splice(replacementIndex, 1);
    if (!replacement) {
      break;
    }
    accepted.splice(duplicateIndex, 1, replacement);
    remaining.push(duplicateEntry);
    remaining.sort((left, right) => right.selectionScore - left.selectionScore);
  }
}

function promoteCommentNativeShortlistEntry(
  accepted: ShortlistEntry[],
  remaining: ShortlistEntry[],
  protectedFinalPickId: string,
  commentCarryExpectation: "low" | "medium" | "high"
): void {
  const targetCommentNativeCount =
    commentCarryExpectation === "high" ? 2 : commentCarryExpectation === "medium" ? 1 : 0;
  if (targetCommentNativeCount === 0) {
    return;
  }

  const countStrongCommentNativeEntries = () =>
    accepted.filter((entry) => entry.commentCarryScore >= 2).length;

  while (countStrongCommentNativeEntries() < targetCommentNativeCount) {
    const replacement = [...remaining]
      .filter((entry) => entry.commentCarryScore >= 2 && !isCompromisedShortlistEntry(entry))
      .sort(compareCommentNativeStrength)[0];
    if (!replacement) {
      return;
    }
    const weakestReplaceable = accepted
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          entry.candidate.candidateId !== protectedFinalPickId &&
          entry.commentCarryScore < 2
      )
      .sort((left, right) => left.entry.selectionScore - right.entry.selectionScore)[0];
    if (!weakestReplaceable) {
      return;
    }
    if (replacement.selectionScore < weakestReplaceable.entry.selectionScore - 0.75) {
      return;
    }
    accepted.splice(weakestReplaceable.index, 1, replacement);
    const replacementCandidateIndex = remaining.findIndex(
      (entry) => entry.candidate.candidateId === replacement.candidate.candidateId
    );
    if (replacementCandidateIndex >= 0) {
      remaining.splice(replacementCandidateIndex, 1);
    }
    remaining.push(weakestReplaceable.entry);
    remaining.sort((left, right) => right.selectionScore - left.selectionScore);
  }
}

function cleanupDuplicateBottomTails(
  accepted: ShortlistEntry[],
  constraints: Stage2HardConstraints,
  protectedFinalPickId: string
): void {
  const seen = new Set<string>();
  for (const entry of accepted) {
    const tailKey = buildBottomTailKey(entry.candidate.bottom);
    if (!tailKey || !seen.has(tailKey)) {
      if (tailKey) {
        seen.add(tailKey);
      }
      continue;
    }
    if (entry.candidate.candidateId === protectedFinalPickId && !hasGenericBottomTail(entry.candidate.bottom)) {
      continue;
    }
    const strippedBottom = extractBottomLeadSegment(entry.candidate.bottom);
    const cleanupSuffixOptions = BOTTOM_PADDING_OPTIONS.filter(
      (option) => buildBottomTailKey(option) !== tailKey
    );
    if (!strippedBottom || strippedBottom === entry.candidate.bottom) {
      continue;
    }
    const repairedBottom = repairCaptionLineForHardConstraints({
      text: strippedBottom,
      minimum: constraints.bottomLengthMin,
      maximum: constraints.bottomLengthMax,
      suffixOptions: cleanupSuffixOptions,
      disallowedTailKeys: seen
    });
    let resolvedBottom = repairedBottom;
    let repairedTailKey = buildBottomTailKey(resolvedBottom.text);
    if ((!resolvedBottom.valid || !repairedTailKey || seen.has(repairedTailKey)) && strippedBottom.length < constraints.bottomLengthMax) {
      const forcedMinimum = Math.min(
        constraints.bottomLengthMax,
        Math.max(constraints.bottomLengthMin, strippedBottom.length + 18)
      );
      if (forcedMinimum > strippedBottom.length) {
        const diversifiedBottom = repairCaptionLineForHardConstraints({
          text: strippedBottom,
          minimum: forcedMinimum,
          maximum: constraints.bottomLengthMax,
          suffixOptions: cleanupSuffixOptions,
          disallowedTailKeys: seen
        });
        const diversifiedTailKey = buildBottomTailKey(diversifiedBottom.text);
        if (diversifiedBottom.valid && diversifiedTailKey && !seen.has(diversifiedTailKey)) {
          resolvedBottom = diversifiedBottom;
          repairedTailKey = diversifiedTailKey;
        }
      }
    }
    if (!resolvedBottom.valid || !repairedTailKey || seen.has(repairedTailKey)) {
      continue;
    }
    entry.candidate = {
      ...entry.candidate,
      bottom: resolvedBottom.text
    };
    entry.constraintCheck = evaluateCandidateHardConstraints(
      entry.candidate,
      constraints,
      entry.constraintCheck.repaired || resolvedBottom.repaired
    );
    seen.add(repairedTailKey);
  }
}

function buildShortlist(input: {
  constraints: Stage2HardConstraints;
  analyzerOutput: AnalyzerOutput;
  finalSelector: FinalSelectorOutput;
  rewrittenCandidates: CandidateCaption[];
  fallbackCandidates: CandidateCaption[];
  criticScores: CriticScore[];
}): {
  entries: ShortlistEntry[];
  stats: ShortlistStats;
  validatedPoolCandidateIds: string[];
  invalidDroppedCandidateIds: string[];
} {
  const targetCount = REQUIRED_FINAL_SHORTLIST_COUNT;
  const commentCarryProfile = buildCommentCarryProfile(input.analyzerOutput);
  const scoreMap = new Map(input.criticScores.map((score) => [score.candidateId, score.total]));
  const byId = new Map(
    [...input.fallbackCandidates, ...input.rewrittenCandidates].map((candidate) => [candidate.candidateId, candidate])
  );
  const orderedIds = [
    ...input.finalSelector.finalCandidates,
    ...input.rewrittenCandidates.map((candidate) => candidate.candidateId),
    ...input.fallbackCandidates.map((candidate) => candidate.candidateId)
  ];
  const seen = new Set<string>();
  const orderedPool = orderedIds
    .filter((candidateId) => {
      if (!candidateId || seen.has(candidateId)) {
        return false;
      }
      seen.add(candidateId);
      return byId.has(candidateId);
    })
    .map((candidateId) => byId.get(candidateId)!);

  const repairedEntries = orderedPool
    .map((candidate) => {
      const repaired = repairCandidateForHardConstraints(candidate, input.constraints);
      const constraintCheck = evaluateCandidateHardConstraints(
        repaired.candidate,
        input.constraints,
        repaired.repaired
      );
      const commentCarry = evaluateCandidateCommentCarry({
        candidate: repaired.candidate,
        commentCarryProfile
      });
      const topSignals = evaluateTopHookSignals(repaired.candidate.top);
      const humanPhrasingSignals = evaluateHumanPhrasingSignals(repaired.candidate);
      const baseEntry = {
        candidate: repaired.candidate,
        constraintCheck,
        criticTotal: scoreMap.get(candidate.candidateId) ?? 0,
        commentCarryScore: commentCarry.score,
        usesDominantCommentCue: commentCarry.usesDominantCue,
        matchedCommentCues: commentCarry.matchedCues,
        topSignals,
        humanPhrasingSignals,
        selectionScore: 0,
        valid: repaired.valid
      };
      return {
        ...baseEntry,
        selectionScore: computeShortlistSelectionScore(baseEntry)
      };
    });
  const repairedPool = repairedEntries.filter((entry) => entry.valid && entry.constraintCheck.passed);
  const invalidEntries = repairedEntries.filter((entry) => !(entry.valid && entry.constraintCheck.passed));
  const invalidReasonParts = [
    invalidEntries.filter((entry) => entry.candidate.top.length < input.constraints.topLengthMin).length > 0
      ? `TOP short: ${invalidEntries.filter((entry) => entry.candidate.top.length < input.constraints.topLengthMin).length}`
      : null,
    invalidEntries.filter((entry) => entry.candidate.top.length > input.constraints.topLengthMax).length > 0
      ? `TOP long: ${invalidEntries.filter((entry) => entry.candidate.top.length > input.constraints.topLengthMax).length}`
      : null,
    invalidEntries.filter((entry) => entry.candidate.bottom.length < input.constraints.bottomLengthMin).length > 0
      ? `BOTTOM short: ${invalidEntries.filter((entry) => entry.candidate.bottom.length < input.constraints.bottomLengthMin).length}`
      : null,
    invalidEntries.filter((entry) => entry.candidate.bottom.length > input.constraints.bottomLengthMax).length > 0
      ? `BOTTOM long: ${invalidEntries.filter((entry) => entry.candidate.bottom.length > input.constraints.bottomLengthMax).length}`
      : null,
    invalidEntries.filter((entry) =>
      entry.constraintCheck.issues.some((issue) => /banned words/i.test(issue))
    ).length > 0
      ? `banned words: ${invalidEntries.filter((entry) =>
          entry.constraintCheck.issues.some((issue) => /banned words/i.test(issue))
        ).length}`
      : null,
    invalidEntries.filter((entry) =>
      entry.constraintCheck.issues.some((issue) => /banned opener/i.test(issue))
    ).length > 0
      ? `banned openers: ${invalidEntries.filter((entry) =>
          entry.constraintCheck.issues.some((issue) => /banned opener/i.test(issue))
        ).length}`
      : null,
    invalidEntries.filter((entry) => hasBrokenSentencePart(entry.candidate.top) || hasBrokenSentencePart(entry.candidate.bottom)).length > 0
      ? `broken endings: ${invalidEntries.filter((entry) => hasBrokenSentencePart(entry.candidate.top) || hasBrokenSentencePart(entry.candidate.bottom)).length}`
      : null
  ].filter((value): value is string => Boolean(value));

  const preferredIds = new Set(input.finalSelector.finalCandidates);
  const protectedFinalPickId = input.finalSelector.finalPick;
  const accepted = repairedPool.filter((entry) => preferredIds.has(entry.candidate.candidateId)).slice(0, targetCount);
  const remaining = repairedPool
    .filter((entry) => !preferredIds.has(entry.candidate.candidateId))
    .sort((left, right) => right.selectionScore - left.selectionScore);

  const diversifyAcceptedShortlist = () => {
    const possibleAngles = new Set(repairedPool.map((entry) => entry.candidate.angle));
    const targetUniqueAngles = Math.min(3, possibleAngles.size);
    while (new Set(accepted.map((entry) => entry.candidate.angle)).size < targetUniqueAngles && remaining.length > 0) {
      const acceptedAngles = new Set(accepted.map((entry) => entry.candidate.angle));
      const alternativeIndex = remaining.findIndex((entry) => !acceptedAngles.has(entry.candidate.angle));
      if (alternativeIndex < 0) {
        break;
      }
      const [alternative] = remaining.splice(alternativeIndex, 1);
      if (!alternative) {
        break;
      }
      const replaceable = accepted
        .map((entry, index) => ({ entry, index }))
        .filter(
          ({ entry }) =>
            entry.candidate.candidateId !== protectedFinalPickId &&
            accepted.filter((item) => item.candidate.angle === entry.candidate.angle).length > 1
        )
        .sort((left, right) => left.entry.selectionScore - right.entry.selectionScore)[0];
      if (!replaceable) {
        remaining.unshift(alternative);
        break;
      }
      if (alternative.selectionScore < replaceable.entry.selectionScore - 0.75) {
        remaining.unshift(alternative);
        break;
      }
      const [removed] = accepted.splice(replaceable.index, 1, alternative);
      if (removed) {
        remaining.push(removed);
        remaining.sort((left, right) => right.selectionScore - left.selectionScore);
      }
    }
  };

  while (accepted.length < targetCount && remaining.length > 0) {
    const acceptedAngles = new Set(accepted.map((entry) => entry.candidate.angle));
    const acceptedTailKeys = new Set(
      accepted
        .map((entry) => buildBottomTailKey(entry.candidate.bottom))
        .filter(Boolean)
    );
    const strongestRemainingScore = remaining[0]?.selectionScore ?? 0;
    const diverseIndex = remaining.findIndex(
      (entry) =>
        !acceptedAngles.has(entry.candidate.angle) &&
        entry.selectionScore >= strongestRemainingScore - 0.75
    );
    const uniqueTailIndex = remaining.findIndex((entry) => {
      const tailKey = buildBottomTailKey(entry.candidate.bottom);
      return (
        Boolean(tailKey) &&
        !acceptedTailKeys.has(tailKey) &&
        entry.selectionScore >= strongestRemainingScore - 0.75
      );
    });
    const pickedIndex =
      uniqueTailIndex >= 0 ? uniqueTailIndex : diverseIndex >= 0 ? diverseIndex : 0;
    const [next] = remaining.splice(pickedIndex, 1);
    if (!next) {
      break;
    }
    accepted.push(next);
  }

  improveAcceptedTopHookEntries(accepted, remaining, protectedFinalPickId);
  diversifyAcceptedShortlist();
  improveAcceptedTopHookEntries(accepted, remaining, protectedFinalPickId);
  diversifyAcceptedBottomTails(accepted, remaining, protectedFinalPickId);
  cleanupDuplicateBottomTails(accepted, input.constraints, protectedFinalPickId);
  promoteCommentNativeShortlistEntry(
    accepted,
    remaining,
    protectedFinalPickId,
    commentCarryProfile.expectation
  );
  const entries = accepted.slice(0, targetCount);
  return {
    entries,
    validatedPoolCandidateIds: repairedPool.map((entry) => entry.candidate.candidateId),
    invalidDroppedCandidateIds: invalidEntries.map((entry) => entry.candidate.candidateId),
    stats: {
      targetCount,
      requestedCount: Math.min(targetCount, input.finalSelector.finalCandidates.length || targetCount),
      validatedCount: repairedPool.length,
      visibleCount: entries.length,
      repairedCount: repairedEntries.filter((entry) => entry.constraintCheck.repaired).length,
      droppedAfterValidationCount: Math.max(0, repairedEntries.length - repairedPool.length),
      topSignalSummary: buildTopSignalSummary(repairedPool, entries),
      invalidReasonSummary:
        invalidReasonParts.length > 0
          ? `Likely invalidation mix: ${invalidReasonParts.join(", ")}.`
          : null
    }
  };
}

function validateVisibleShortlistQuality(stats: ShortlistStats): string[] {
  const visibleSignals = stats.topSignalSummary?.visibleCandidateSignals ?? [];
  if (visibleSignals.length === 0) {
    return ["Visible shortlist quality gate ran with no visible candidates."];
  }

  const weakPatternCount = visibleSignals.filter(
    (signal) => signal.inventoryOpening || signal.lateHook || signal.pureBeatNarration
  ).length;
  const earlyHookCount = visibleSignals.filter((signal) => signal.earlyHookPresent).length;

  const issues: string[] = [];
  if (
    earlyHookCount === 0 &&
    weakPatternCount >= Math.max(3, Math.ceil(visibleSignals.length * 0.6))
  ) {
    issues.push(
      "Visible shortlist is still dominated by inventory-opening, delayed-hook, or beat-narration TOP patterns."
    );
  }

  return issues;
}

function buildFallbackTitleOption(candidate: CandidateCaption, option: number): { option: number; title: string; titleRu: string } {
  const source = candidate.top || candidate.bottom || `Option ${option}`;
  const title = source
    .replace(/[".,!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ")
    .trim();
  return {
    option,
    title: title || `Option ${option}`,
    titleRu: title || `Option ${option}`
  };
}

function normalizeAllCapsTitleText(value: string): string {
  return sanitizeTitleText(value).toUpperCase();
}

function sanitizeTitleText(value: string): string {
  return value
    .replace(/[|]{2,}/g, "|")
    .replace(/!{2,}/g, "!")
    .replace(/\?{2,}/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitleOptions(
  raw: unknown,
  shortlist: CandidateCaption[]
): Array<{ option: number; title: string; titleRu: string }> {
  const normalized = (normalizeStage2TitleOptionsValue(raw) ?? []).slice(0, 5);
  const baseOptions =
    normalized.length === 5
      ? normalized.map((item, index) => ({ ...item, option: index + 1 }))
      : shortlist.slice(0, 5).map((candidate, index) => buildFallbackTitleOption(candidate, index + 1));
  const policy = {
    forceAllCaps: true
  };

  return baseOptions.map((item, index) => {
    const fallback = shortlist[index]
      ? buildFallbackTitleOption(shortlist[index]!, index + 1)
      : buildFallbackTitleOption(shortlist[0]!, index + 1);
    const validation = validateTitle(sanitizeTitleText(item.title), policy);
    const fallbackValidation = validateTitle(sanitizeTitleText(fallback.title), policy);
    return {
      option: index + 1,
      title: validation.passed ? validation.normalizedTitle : fallbackValidation.normalizedTitle,
      titleRu: normalizeAllCapsTitleText(item.titleRu || fallback.titleRu)
    };
  });
}

function estimateTokensFromChars(chars: number | null | undefined): number | null {
  if (typeof chars !== "number" || !Number.isFinite(chars) || chars <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil(chars / 4));
}

function measureSerializedBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return null;
  }
}

function buildPromptStageDiagnostics(input: {
  stageId: Stage2PipelineStageId;
  promptConfig: Stage2PromptConfig | null;
  promptText: string | null;
  includePromptText?: boolean;
  promptConfigSource?: "workspace_override" | "channel_override";
  usesImages?: boolean;
  model?: string | null;
  summary: string;
  serializedResultBytes?: number | null;
  estimatedOutputTokens?: number | null;
  persistedPayloadBytes?: number | null;
  inputManifest?: Stage2DiagnosticsPromptStage["inputManifest"];
}): Stage2DiagnosticsPromptStage {
  const stageMeta = STAGE2_PIPELINE_STAGES.find((stage) => stage.id === input.stageId);
  const resolved = resolveStage2PromptTemplate(
    input.stageId as keyof Stage2PromptConfig["stages"],
    input.promptConfig,
    {
      overrideSource: input.promptConfigSource ?? "workspace_override"
    }
  );
  return {
    stageId: input.stageId,
    label: stageMeta?.shortLabel ?? input.stageId,
    stageType: "llm_prompt",
    defaultPrompt: resolved.defaultPrompt,
    configuredPrompt: resolved.configuredPrompt,
    promptSource: resolved.promptSource,
    promptCompatibilityFamily: resolved.promptCompatibilityFamily,
    promptCompatibilityVersion: resolved.promptCompatibilityVersion,
    defaultPromptHash: resolved.defaultPromptHash,
    configuredPromptHash: resolved.configuredPromptHash,
    overrideAccepted: resolved.overrideAccepted,
    overrideRejectedReason: resolved.overrideRejectedReason,
    overrideCandidatePresent: resolved.overrideCandidatePresent,
    overrideCandidatePromptHash: resolved.overrideCandidatePromptHash,
    legacyFallbackBypassed: resolved.legacyFallbackBypassed,
    model: input.model ?? null,
    reasoningEffort: resolved.reasoningEffort,
    isCustomPrompt: resolved.isCustomPrompt,
    promptText: input.includePromptText ? input.promptText : null,
    promptTextAvailable: Boolean(input.promptText),
    promptChars: input.promptText ? input.promptText.length : null,
    estimatedInputTokens: estimateTokensFromChars(input.promptText ? input.promptText.length : null),
    estimatedOutputTokens: input.estimatedOutputTokens ?? null,
    serializedResultBytes: input.serializedResultBytes ?? null,
    persistedPayloadBytes: input.persistedPayloadBytes ?? null,
    usesImages: Boolean(input.usesImages),
    summary: input.summary,
    ...(input.inputManifest ? { inputManifest: input.inputManifest } : {})
  };
}

function buildProductOwnedPromptStageDiagnostics(input: {
  stageId: Stage2PipelineStageId;
  promptText: string | null;
  includePromptText?: boolean;
  usesImages?: boolean;
  model?: string | null;
  reasoningEffort?: string | null;
  summary: string;
  serializedResultBytes?: number | null;
  estimatedOutputTokens?: number | null;
  persistedPayloadBytes?: number | null;
  inputManifest?: Stage2DiagnosticsPromptStage["inputManifest"];
  defaultPrompt: string;
  promptCompatibilityVersion: string;
}): Stage2DiagnosticsPromptStage {
  const stageMeta = STAGE2_PIPELINE_STAGES.find((stage) => stage.id === input.stageId);
  const promptHash = computeStage2PromptHash(input.defaultPrompt);
  return {
    stageId: input.stageId,
    label: stageMeta?.shortLabel ?? input.stageId,
    stageType: "llm_prompt",
    defaultPrompt: input.defaultPrompt,
    configuredPrompt: input.defaultPrompt,
    promptSource: "default",
    promptCompatibilityFamily: STAGE2_ONE_SHOT_PROMPT_COMPATIBILITY_FAMILY,
    promptCompatibilityVersion: input.promptCompatibilityVersion,
    defaultPromptHash: promptHash,
    configuredPromptHash: promptHash,
    overrideAccepted: false,
    overrideRejectedReason: "product_owned_prompt_not_workspace_editable",
    overrideCandidatePresent: false,
    legacyFallbackBypassed: true,
    model: input.model ?? null,
    reasoningEffort: input.reasoningEffort ?? null,
    isCustomPrompt: false,
    promptText: input.includePromptText ? input.promptText : null,
    promptTextAvailable: Boolean(input.promptText),
    promptChars: input.promptText ? input.promptText.length : null,
    estimatedInputTokens: estimateTokensFromChars(input.promptText ? input.promptText.length : null),
    estimatedOutputTokens: input.estimatedOutputTokens ?? null,
    serializedResultBytes: input.serializedResultBytes ?? null,
    persistedPayloadBytes: input.persistedPayloadBytes ?? null,
    usesImages: Boolean(input.usesImages),
    summary: input.summary,
    ...(input.inputManifest ? { inputManifest: input.inputManifest } : {})
  };
}

function buildDiagnosticsExample(
  bucket: Stage2DiagnosticsExample["bucket"],
  example: Stage2CorpusExample,
  queryText: string,
  selectedExampleIds: string[],
  insight: {
    guidanceRole: Stage2ExampleGuidanceRole;
    retrievalScore: number;
    retrievalReasons: string[];
  } | null
): Stage2DiagnosticsExample {
  const reasons = [];
  if (selectedExampleIds.includes(example.id)) {
    reasons.push("selected by selector");
  }
  return {
    id: example.id,
    bucket,
    channelName: example.sourceChannelName,
    sourceChannelId: example.sourceChannelId,
    sourceChannelName: example.sourceChannelName,
    videoId: null,
    title: example.title,
    clipType: example.clipType,
    overlayTop: example.overlayTop,
    overlayBottom: example.overlayBottom,
    whyItWorks: example.whyItWorks,
    qualityScore: typeof example.qualityScore === "number" ? example.qualityScore : null,
    retrievalScore: insight?.retrievalScore ?? scoreExampleMatch(queryText, example),
    retrievalReasons:
      insight?.retrievalReasons && insight.retrievalReasons.length > 0
        ? [...reasons, ...insight.retrievalReasons]
        : reasons,
    guidanceRole: insight?.guidanceRole ?? "weak_support",
    sampleKind: example.ownerChannelId,
    isOwnedAnchor: example.ownerChannelId === example.sourceChannelId,
    isAntiExample: false,
    publishedAt: null,
    views: null,
    ageHours: null,
    anomalyScore: null
  };
}

function buildRunDiagnosticsBundle(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  videoContext: ViralShortsVideoContext;
  analyzerOutput: AnalyzerOutput;
  promptConfig: Stage2PromptConfig | null;
  debugMode: Stage2DebugMode;
  executedPromptStages: ExecutedPromptStageRecord[];
  workspaceCorpusCount: number;
  activeExamplesCount: number;
  selectorExamples: Stage2CorpusExample[];
  examplesAssessment: Stage2ExamplesAssessment;
  exampleInsights: Array<{
    exampleId: string;
    guidanceRole: Stage2ExampleGuidanceRole;
    retrievalScore: number;
    retrievalReasons: string[];
  }>;
  selectorOutput: SelectorOutput;
  queryText: string;
  writerCandidates: CandidateCaption[];
  criticScores: CriticScore[];
  rewrittenCandidates: CandidateCaption[];
  shortlist: CandidateCaption[];
}): {
  diagnostics: Stage2Diagnostics;
  rawDebugArtifact: Stage2RunDebugArtifact | null;
  tokenUsage: Stage2TokenUsage;
} {
  const selectedExampleIds = input.selectorOutput.selectedExampleIds ?? [];
  const insightById = new Map(input.exampleInsights.map((entry) => [entry.exampleId, entry]));
  const promptInputManifests = buildStage2PromptInputManifestMap({
    channelConfig: input.channelConfig,
    videoContext: input.videoContext,
    activeExamplesCount: input.activeExamplesCount,
    selectorPromptPool: input.selectorExamples,
    selectorOutput: input.selectorOutput,
    examplesAssessment: input.examplesAssessment,
    writerCandidates: input.writerCandidates,
    criticScores: input.criticScores,
    rewriteCandidates: input.rewrittenCandidates,
    shortlist: input.shortlist
  });
  const rawPromptStages = input.executedPromptStages.map((stage) =>
    buildPromptStageDiagnostics({
      stageId: stage.stageId,
      promptConfig: input.promptConfig,
      promptText: stage.promptText,
      includePromptText: true,
      usesImages: stage.usesImages,
      model: stage.model,
      summary: stage.summary,
      serializedResultBytes: stage.serializedResultBytes,
      estimatedOutputTokens: stage.estimatedOutputTokens,
      inputManifest: promptInputManifests[stage.stageId]
    })
  );
  const summaryPromptStages = input.executedPromptStages.map((stage) =>
    buildPromptStageDiagnostics({
      stageId: stage.stageId,
      promptConfig: input.promptConfig,
      promptText: stage.promptText,
      includePromptText: false,
      usesImages: stage.usesImages,
      model: stage.model,
      summary: stage.summary,
      serializedResultBytes: stage.serializedResultBytes,
      estimatedOutputTokens: stage.estimatedOutputTokens,
      inputManifest: promptInputManifests[stage.stageId]
    })
  );
  const tokenUsageStages = summaryPromptStages.map((stage) => ({
    stageId: stage.stageId,
    promptChars: stage.promptChars,
    estimatedInputTokens: stage.estimatedInputTokens ?? null,
    estimatedOutputTokens: stage.estimatedOutputTokens ?? null,
    serializedResultBytes: stage.serializedResultBytes ?? null,
    persistedPayloadBytes: stage.persistedPayloadBytes ?? null
  }));
  const topGuidance = resolveTopGuidance({
    analyzerOutput: input.analyzerOutput,
    selectorOutput: input.selectorOutput
  });
  const resolvedWorkerProfile = getResolvedStage2WorkerProfile(input.channelConfig);
  const diagnostics: Stage2Diagnostics = {
    channel: {
      channelId: input.channelConfig.channelId,
      name: input.channelConfig.name,
      username: input.channelConfig.username,
      workerProfile: {
        requestedId: resolvedWorkerProfile.requestedId,
        resolvedId: resolvedWorkerProfile.resolvedId,
        label: resolvedWorkerProfile.label,
        description: resolvedWorkerProfile.description,
        summary: resolvedWorkerProfile.summary,
        origin: resolvedWorkerProfile.origin
      },
      examplesSource: input.channelConfig.examplesSource,
      hardConstraints: input.channelConfig.hardConstraints,
      styleProfile: input.channelConfig.styleProfile,
      editorialMemory: input.channelConfig.editorialMemory,
      workspaceCorpusCount: input.workspaceCorpusCount,
      activeCorpusCount: input.activeExamplesCount
    },
    selection: {
      clipType: input.selectorOutput.clipType,
      primaryAngle: input.selectorOutput.primaryAngle,
      secondaryAngles: input.selectorOutput.secondaryAngles,
      rankedAngles: input.selectorOutput.rankedAngles,
      coreTrigger: input.selectorOutput.coreTrigger,
      humanStake: input.selectorOutput.humanStake,
      narrativeFrame: input.selectorOutput.narrativeFrame,
      whyViewerCares: input.selectorOutput.whyViewerCares,
      topStrategy: input.selectorOutput.topStrategy,
      topHookMode: topGuidance.topHookMode,
      revealPolicy: topGuidance.revealPolicy,
      topAvoidPatterns: topGuidance.topAvoidPatterns,
      topMustDo: topGuidance.topMustDo,
      bottomEnergy: input.selectorOutput.bottomEnergy,
      whyOldV6WouldWorkHere: input.selectorOutput.whyOldV6WouldWorkHere,
      failureModes: input.selectorOutput.failureModes,
      writerBrief: input.selectorOutput.writerBrief,
      rationale: input.selectorOutput.rationale ?? null,
      selectedExampleIds
    },
    analysis: {
      visualAnchors: input.analyzerOutput.visualAnchors,
      specificNouns: input.analyzerOutput.specificNouns,
      visibleActions: input.analyzerOutput.visibleActions,
      firstSecondsSignal: input.analyzerOutput.firstSecondsSignal,
      sceneBeats: input.analyzerOutput.sceneBeats,
      revealMoment: input.analyzerOutput.revealMoment,
      lateClipChange: input.analyzerOutput.lateClipChange,
      whyViewerCares: input.analyzerOutput.whyViewerCares,
      bestBottomEnergy: input.analyzerOutput.bestBottomEnergy,
      commentVibe: input.analyzerOutput.commentVibe,
      commentConsensusLane: input.analyzerOutput.commentConsensusLane,
      commentJokeLane: input.analyzerOutput.commentJokeLane,
      commentDissentLane: input.analyzerOutput.commentDissentLane,
      commentSuspicionLane: input.analyzerOutput.commentSuspicionLane,
      slangToAdapt: input.analyzerOutput.slangToAdapt,
      commentLanguageCues: input.analyzerOutput.commentLanguageCues,
      hiddenDetail: input.analyzerOutput.hiddenDetail,
      genericRisks: input.analyzerOutput.genericRisks,
      uncertaintyNotes: input.analyzerOutput.uncertaintyNotes,
      rawSummary: input.analyzerOutput.rawSummary
    },
    sourceContext: buildStage2SourceContextSummary(input.videoContext),
    effectivePrompting: {
      promptStages: summaryPromptStages
    },
    examples: {
      source: input.channelConfig.examplesSource,
      workspaceCorpusCount: input.workspaceCorpusCount,
      activeCorpusCount: input.activeExamplesCount,
      selectorCandidateCount: input.selectorExamples.length,
      retrievalConfidence: input.examplesAssessment.retrievalConfidence,
      examplesMode: input.examplesAssessment.examplesMode,
      explanation: input.examplesAssessment.explanation,
      evidence: input.examplesAssessment.evidence,
      retrievalWarning: input.examplesAssessment.retrievalWarning,
      examplesRoleSummary: input.examplesAssessment.examplesRoleSummary,
      primaryDriverSummary: input.examplesAssessment.primaryDriverSummary,
      primaryDrivers: input.examplesAssessment.primaryDrivers,
      channelStylePriority: input.examplesAssessment.channelStylePriority,
      editorialMemoryPriority: input.examplesAssessment.editorialMemoryPriority,
      availableExamples: input.selectorExamples.slice(0, 8).map((example) =>
        buildDiagnosticsExample(
          "available",
          example,
          input.queryText,
          selectedExampleIds,
          insightById.get(example.id) ?? null
        )
      ),
      selectedExamples: (input.selectorOutput.selectedExamples ?? []).slice(0, 5).map((example) =>
        buildDiagnosticsExample(
          "selected",
          example,
          input.queryText,
          selectedExampleIds,
          insightById.get(example.id) ?? null
        )
      )
    }
  };
  const tokenUsage: Stage2TokenUsage = {
    stages: tokenUsageStages,
    totalPromptChars: tokenUsageStages.reduce((sum, stage) => sum + (stage.promptChars ?? 0), 0),
    totalEstimatedInputTokens: tokenUsageStages.reduce(
      (sum, stage) => sum + (stage.estimatedInputTokens ?? 0),
      0
    ),
    totalEstimatedOutputTokens: tokenUsageStages.reduce(
      (sum, stage) => sum + (stage.estimatedOutputTokens ?? 0),
      0
    ),
    totalSerializedResultBytes: tokenUsageStages.reduce(
      (sum, stage) => sum + (stage.serializedResultBytes ?? 0),
      0
    ),
    totalPersistedPayloadBytes: tokenUsageStages.reduce(
      (sum, stage) => sum + (stage.persistedPayloadBytes ?? 0),
      0
    )
  };
  return {
    diagnostics,
    rawDebugArtifact:
      input.debugMode === "raw"
        ? {
            kind: "stage2-run-debug",
            runId: "pending",
            createdAt: new Date().toISOString(),
            promptStages: rawPromptStages
          }
        : null,
    tokenUsage
  };
}

function normalizeChannelConfig(input: {
  id: string;
  name: string;
  username: string;
  stage2WorkerProfileId?: string | null;
  stage2HardConstraints: Stage2HardConstraints;
  stage2ExamplesConfig: Stage2ExamplesConfig;
  stage2StyleProfile?: Stage2RuntimeChannelConfig["styleProfile"];
  editorialMemory?: Stage2RuntimeChannelConfig["editorialMemory"];
  templateHighlightProfile?: Stage2RuntimeChannelConfig["templateHighlightProfile"];
  resolvedExamplesSource?: Stage2RuntimeChannelConfig["examplesSource"];
}): Stage2RuntimeChannelConfig {
  const styleProfile = input.stage2StyleProfile ?? DEFAULT_STAGE2_STYLE_PROFILE;
  const workerProfile = resolveStage2WorkerProfile(input.stage2WorkerProfileId);
  return {
    channelId: input.id,
    name: input.name,
    username: input.username,
    stage2WorkerProfileId: workerProfile.requestedId,
    workerProfile,
    hardConstraints: input.stage2HardConstraints,
    styleProfile,
    editorialMemory: input.editorialMemory ?? createEmptyStage2EditorialMemorySummary(styleProfile),
    templateHighlightProfile: input.templateHighlightProfile ?? null,
    examplesSource:
      input.resolvedExamplesSource ??
      (input.stage2ExamplesConfig.useWorkspaceDefault ? "workspace_default" : "channel_custom")
  };
}

async function runReferenceOneShotNativeCaptionPipeline(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  workspaceCorpusCount: number;
  videoContext: ViralShortsVideoContext;
  imagePaths: string[];
  executor: JsonStageExecutor;
  stageModels?: Partial<Stage2PipelineModelMap>;
  promptConfig: Stage2PromptConfig;
  debugMode: Stage2DebugMode;
  onProgress?: (event: PipelineProgressEvent) => void | Promise<void>;
  reusedContextPacket: NativeCaptionContextPacket | null;
  pipelineExecution: Stage2PipelineExecution;
  analyzerOutput: AnalyzerOutput;
  selectorFallback: SelectorOutput;
  nativeExamplesAssessment: Stage2ExamplesAssessment;
}): Promise<RunPipelineResult> {
  const warnings: StageWarning[] = [];
  const executedPromptStages: ExecutedPromptStageRecord[] = [];
  const variantConfig = resolveReferenceOneShotVariantConfig(input.channelConfig);
  const promptInputManifests: Partial<
    Record<Stage2PipelineStageId, Stage2DiagnosticsPromptStage["inputManifest"]>
  > = {};
  const reportProgress = async (event: PipelineProgressEvent): Promise<void> => {
    try {
      await input.onProgress?.(event);
    } catch {
      return;
    }
  };
  const recordExecutedStage = (
    stageId: Stage2PipelineStageId,
    promptText: string,
    summary: string,
    resultPayload: unknown,
    options?: { usesImages?: boolean; model?: string | null }
  ) => {
    const serializedResultBytes = measureSerializedBytes(resultPayload);
    executedPromptStages.push({
      stageId,
      promptText,
      summary,
      usesImages: options?.usesImages,
      model: options?.model ?? null,
      serializedResultBytes,
      estimatedOutputTokens: estimateTokensFromChars(serializedResultBytes)
    });
  };

  const compactChannelLearning = buildNativeCaptionChannelLearningPayload(
    input.channelConfig,
    "compact"
  );
  const oneShotCommentLimit =
    variantConfig.weakGroundingCommentsLimit < variantConfig.commentsLimit &&
    isWeakReferenceOneShotSourceGrounding(input.videoContext)
      ? variantConfig.weakGroundingCommentsLimit
      : variantConfig.commentsLimit;
  const contextPacket =
    input.reusedContextPacket ??
    buildNativeCaptionFallbackContextPacket({
      analyzerOutput: input.analyzerOutput,
      selectorOutput: input.selectorFallback,
      videoContext: input.videoContext,
      channelConfig: input.channelConfig
    });
  const oneShotPrompt = buildReferenceOneShotPrompt({
    videoContext: input.videoContext,
    channelConfig: input.channelConfig,
    analyzerOutput: input.analyzerOutput,
    variant: variantConfig
  });
  const oneShotReasoningEffort = resolveStageReasoningEffort(
    "oneShotReference",
    input.promptConfig
  );
  const oneShotModel =
    input.stageModels?.oneShotReference ??
    input.stageModels?.candidateGenerator ??
    input.stageModels?.contextPacket ??
    null;
  promptInputManifests.oneShotReference = {
    learningDetail: "compact",
    description: {
      availableChars: input.videoContext.description.trim().length,
      passedChars: input.videoContext.description.trim().length,
      omittedChars: 0,
      truncated: false,
      limit: null
    },
    transcript: {
      availableChars: input.videoContext.transcript.trim().length,
      passedChars: input.videoContext.transcript.trim().length,
      omittedChars: 0,
      truncated: false,
      limit: null
    },
    frames: {
      availableCount: input.videoContext.frameDescriptions.length,
      passedCount: input.videoContext.frameDescriptions.length,
      omittedCount: 0,
      truncated: false,
      limit: null
    },
    comments: {
      availableCount: input.videoContext.comments.length,
      passedCount: Math.min(oneShotCommentLimit, input.videoContext.comments.length),
      omittedCount: Math.max(0, input.videoContext.comments.length - oneShotCommentLimit),
      truncated: input.videoContext.comments.length > oneShotCommentLimit,
      limit: oneShotCommentLimit,
      passedCommentIds: input.videoContext.comments
        .slice(0, oneShotCommentLimit)
        .map((comment, index) => comment.id ?? `comment_${index + 1}`)
    },
    examples: null,
    channelLearning: compactChannelLearning.usage,
    candidates: null,
    stageFlags: variantConfig.stageFlags
  };
  await reportProgress({
    stageId: "oneShotReference",
    state: "running",
    promptChars: oneShotPrompt.length,
    reasoningEffort: oneShotReasoningEffort,
    detail: `Running the ${variantConfig.label.toLowerCase()} baseline.`
  });
  const oneShotStartedAt = Date.now();
  let oneShotResult: NativeReferenceOneShotResult;
  let polishedCandidateIds: string[] = [];
  let oneShotLengthWindowWarnings: string[] = [];
  try {
    const rawOneShot = await input.executor.runJson<unknown>({
      prompt: oneShotPrompt,
      schema: NATIVE_REFERENCE_ONE_SHOT_SCHEMA,
      imagePaths: input.imagePaths,
      model: oneShotModel,
      reasoningEffort: oneShotReasoningEffort
    });
    const polished = applyReferenceOneShotLengthPolish({
      result: normalizeReferenceOneShotResult(rawOneShot),
      hardConstraints: input.channelConfig.hardConstraints
    });
    oneShotResult = polished.result;
    polishedCandidateIds = polished.polishedCandidateIds;
    const contractDiagnostics = collectReferenceOneShotContractDiagnostics({
      result: oneShotResult,
      hardConstraints: input.channelConfig.hardConstraints,
      variant: variantConfig
    });
    oneShotLengthWindowWarnings = contractDiagnostics.lengthWindowWarnings;
    if (contractDiagnostics.fatalIssues.length > 0) {
      throw new Error(contractDiagnostics.fatalIssues.join("; "));
    }
  } catch (error) {
    const failureMessage = formatStageFailure(variantConfig.failLabel, error);
    await reportProgress({
      stageId: "oneShotReference",
      state: "failed",
      durationMs: Date.now() - oneShotStartedAt,
      promptChars: oneShotPrompt.length,
      reasoningEffort: oneShotReasoningEffort,
      detail: failureMessage
    });
    throw new Error(failureMessage);
  }
  await reportProgress({
    stageId: "oneShotReference",
    state: "completed",
    durationMs: Date.now() - oneShotStartedAt,
    promptChars: oneShotPrompt.length,
    reasoningEffort: oneShotReasoningEffort,
    detail:
      oneShotLengthWindowWarnings.length > 0
        ? `${variantConfig.label} produced 5 finalist options; ${oneShotLengthWindowWarnings.length} option(s) stayed outside the configured length window and were kept with warnings.`
        : polishedCandidateIds.length > 0
          ? `${variantConfig.label} produced 5 publishable finalists; exact-length polish tightened ${polishedCandidateIds.length} candidate(s) without repair or backfill.`
          : `${variantConfig.label} produced 5 publishable finalists without repair or backfill.`
  });
  recordExecutedStage(
    "oneShotReference",
    oneShotPrompt,
    polishedCandidateIds.length > 0
      ? `${variantConfig.stageSummary} Exact-length polish tightened the final wording for near-miss overflows without repair or backfill.`
      : variantConfig.stageSummary,
    oneShotResult,
    { usesImages: input.imagePaths.length > 0, model: oneShotModel }
  );

  const candidates = oneShotResult.candidates;
  const candidateConstraintChecks = buildNativeCaptionConstraintCheckMap(
    candidates,
    input.channelConfig.hardConstraints
  );
  const captionOptions = candidates.map((candidate, index) => {
    const isPolished = polishedCandidateIds.includes(candidate.candidateId);
    const baseConstraintCheck =
      candidateConstraintChecks.get(candidate.candidateId) ??
      evaluateNativeCaptionConstraintCheck(candidate, input.channelConfig.hardConstraints);
    const constraintCheck = isPolished
      ? {
          ...baseConstraintCheck,
          repaired: true
        }
      : baseConstraintCheck;
    return {
      option: index + 1,
      candidateId: candidate.candidateId,
      laneId: candidate.laneId,
      angle: candidate.angle,
      top: candidate.top,
      bottom: candidate.bottom,
      displayTier: "finalist" as const,
      sourceStage: "oneShotReference" as const,
      displayReason:
        candidate.rationale?.trim() ||
        (isPolished
          ? "Reference one-shot baseline kept this option publishable after exact-length polish."
          : "Reference one-shot baseline kept this option publishable without repair or backfill."),
      retainedHandle: candidate.retainedHandle,
      constraintCheck
    };
  });
  const validCaptionOptions = captionOptions.filter((option) => option.constraintCheck.passed);
  const invalidCaptionOptions = captionOptions.filter((option) => !option.constraintCheck.passed);
  const finalists = captionOptions.map((option) => ({
    option: option.option,
    candidateId: option.candidateId,
    laneId: option.laneId ?? option.candidateId,
    angle: option.angle,
    top: option.top,
    bottom: option.bottom,
    displayTier: "finalist" as const,
    sourceStage: "oneShotReference" as const,
    displayReason: option.displayReason,
    retainedHandle: Boolean(option.retainedHandle),
    preservedHandle: Boolean(option.retainedHandle),
    constraintCheck: option.constraintCheck,
    whyChosen: [option.displayReason]
  }));
  const requestedWinnerCandidate =
    candidates.find((candidate) => candidate.candidateId === oneShotResult.winnerCandidateId) ??
    candidates[0] ??
    null;
  const requestedWinnerOption =
    requestedWinnerCandidate
      ? captionOptions.find((option) => option.candidateId === requestedWinnerCandidate.candidateId) ?? null
      : null;
  const resolvedWinnerOption =
    requestedWinnerOption?.constraintCheck.passed === false && validCaptionOptions.length > 0
      ? validCaptionOptions[0] ?? requestedWinnerOption
      : requestedWinnerOption;
  const winnerFallbackWarning =
    requestedWinnerOption &&
    resolvedWinnerOption &&
    requestedWinnerOption.candidateId !== resolvedWinnerOption.candidateId
      ? `One-shot baseline winner "${requestedWinnerOption.candidateId}" missed the configured length window, so runtime promoted valid finalist "${resolvedWinnerOption.candidateId}" as final pick.`
      : null;
  if (oneShotLengthWindowWarnings.length > 0) {
    warnings.push({
      field: "oneShotReference",
      message:
        `${oneShotLengthWindowWarnings.length} one-shot finalist(s) stayed outside the configured length window and were kept for review instead of failing the run. ` +
        oneShotLengthWindowWarnings.join(" ")
    });
  }
  if (winnerFallbackWarning) {
    warnings.push({
      field: "oneShotReference",
      message: winnerFallbackWarning
    });
  }
  const winnerCandidate =
    resolvedWinnerOption
      ? candidates.find((candidate) => candidate.candidateId === resolvedWinnerOption.candidateId) ?? null
      : requestedWinnerCandidate;
  const winner =
    winnerCandidate && resolvedWinnerOption
      ? {
          candidateId: winnerCandidate.candidateId,
          option: resolvedWinnerOption.option,
          reason: resolvedWinnerOption.displayReason,
          displayTier: "finalist" as const,
          sourceStage: "oneShotReference" as const,
          constraintCheck: resolvedWinnerOption.constraintCheck
        }
      : undefined;
  const finalPick = {
    option: winner?.option ?? 1,
    reason:
      winnerFallbackWarning ??
      winner?.reason ??
      "Reference one-shot baseline selected the strongest publishable option."
  };
  const guardSummary: NativeCaptionGuardSummary = {
    totalCandidateCount: candidates.length,
    validPoolCount: validCaptionOptions.length,
    invalidPoolCount: invalidCaptionOptions.length,
    finalistCount: finalists.length,
    displaySafeExtraCount: 0,
    recoveryCount: 0,
    templateBackfillCount: 0,
    displayShortlistCount: captionOptions.length,
    winnerCandidateId: winner?.candidateId ?? null,
    winnerTier: winner?.displayTier ?? "missing",
    winnerValidity: winner?.constraintCheck?.passed ? "valid" : winner ? "invalid" : "missing",
    degradedSuccess: false,
    dominantHarmlessHandle: contextPacket.audienceWave.dominantHarmlessHandle,
    audienceHandlePreservedInFinalists: finalists.some((finalist) => finalist.preservedHandle),
    recoveryTriggered: false,
    recoveryReason: null,
    failClosedReason: null
  };

  const captionHighlightsById = await runNativeCaptionHighlightingStage({
    channelConfig: input.channelConfig,
    captionOptions: captionOptions.map((option) => ({
      candidateId: option.candidateId,
      top: option.top,
      bottom: option.bottom
    })),
    executor: input.executor,
    stageModels: input.stageModels,
    promptConfig: input.promptConfig,
    warnings,
    promptInputManifests,
    reportProgress,
    recordExecutedStage
  });

  const displayOptionsForTranslation = captionOptions.map((option) => ({
    candidateId: option.candidateId,
    top: option.top,
    bottom: option.bottom
  }));
  const captionTranslationReasoningEffort = resolveStageReasoningEffort(
    "captionTranslation",
    input.promptConfig
  );
  promptInputManifests.captionTranslation = {
    learningDetail: "none",
    description: null,
    transcript: null,
    frames: null,
    comments: null,
    examples: null,
    channelLearning: null,
    candidates: {
      passedCount: captionOptions.length,
      passedCandidateIds: captionOptions.map((option) => option.candidateId),
      criticScoreCount: finalists.length,
      shortlistCount: captionOptions.length
    },
    stageFlags: ["display shortlist translation", "retry missing items once", "ru review"]
  };
  await reportProgress({
    stageId: "captionTranslation",
    state: "running",
    promptChars: 0,
    reasoningEffort: captionTranslationReasoningEffort,
    detail: "Translating the 5 display captions into Russian."
  });
  const captionTranslationStartedAt = Date.now();
  const captionTranslationPromptTexts: string[] = [];
  const captionTranslationById = new Map<
    string,
    NativeCaptionTranslationArtifact["items"][number]
  >();
  let retriedCaptionCandidateIds: string[] = [];
  let captionTranslationArtifact: NativeCaptionTranslationArtifact | null = null;
  try {
    const translationPrompt = buildNativeCaptionTranslationPrompt({
      displayOptions: displayOptionsForTranslation,
      promptConfig: input.promptConfig
    });
    captionTranslationPromptTexts.push(translationPrompt);
    const rawTranslation = await input.executor.runJson<unknown>({
      prompt: translationPrompt,
      schema: NATIVE_TRANSLATION_SCHEMA,
      model: input.stageModels?.captionTranslation ?? null,
      reasoningEffort: captionTranslationReasoningEffort
    });
    normalizeNativeCaptionTranslationArtifact(rawTranslation, displayOptionsForTranslation)?.items.forEach(
      (item) => {
        captionTranslationById.set(item.candidateId, item);
      }
    );

    const missingDisplayOptions = displayOptionsForTranslation.filter(
      (option) => !captionTranslationById.has(option.candidateId)
    );
    if (missingDisplayOptions.length > 0) {
      retriedCaptionCandidateIds = missingDisplayOptions.map((option) => option.candidateId);
      try {
        const retryPrompt = buildNativeCaptionTranslationPrompt({
          displayOptions: missingDisplayOptions,
          promptConfig: input.promptConfig
        });
        captionTranslationPromptTexts.push(retryPrompt);
        const retryRawTranslation = await input.executor.runJson<unknown>({
          prompt: retryPrompt,
          schema: NATIVE_TRANSLATION_SCHEMA,
          model: input.stageModels?.captionTranslation ?? null,
          reasoningEffort: captionTranslationReasoningEffort
        });
        normalizeNativeCaptionTranslationArtifact(retryRawTranslation, missingDisplayOptions)?.items.forEach(
          (item) => {
            captionTranslationById.set(item.candidateId, item);
          }
        );
      } catch (error) {
        warnings.push({
          field: "captionTranslation",
          message:
            error instanceof Error
              ? `Caption translation retry used English fallback for some options: ${error.message}`
              : "Caption translation retry used English fallback for some options."
        });
      }
    }
  } catch (error) {
    warnings.push({
      field: "captionTranslation",
      message:
        error instanceof Error
          ? `Caption translation fallback used: ${error.message}`
          : "Caption translation fallback used."
    });
  }
  const captionTranslationItems = displayOptionsForTranslation.map((option) => {
    const translated = captionTranslationById.get(option.candidateId);
    if (translated) {
      return translated;
    }
    return {
      candidateId: option.candidateId,
      topRu: option.top,
      bottomRu: option.bottom,
      source: "fallback" as const
    };
  });
  const captionFallbackCandidateIds = captionTranslationItems
    .filter((item) => item.source === "fallback")
    .map((item) => item.candidateId);
  captionTranslationArtifact = {
    translatedAt: new Date().toISOString(),
    items: captionTranslationItems,
    coverage: {
      requestedCount: displayOptionsForTranslation.length,
      translatedCount: captionTranslationItems.length - captionFallbackCandidateIds.length,
      fallbackCount: captionFallbackCandidateIds.length,
      fallbackCandidateIds: captionFallbackCandidateIds,
      retriedCandidateIds: retriedCaptionCandidateIds
    }
  };
  await reportProgress({
    stageId: "captionTranslation",
    state: "completed",
    durationMs: Date.now() - captionTranslationStartedAt,
    promptChars: captionTranslationPromptTexts.reduce((sum, prompt) => sum + prompt.length, 0),
    reasoningEffort: captionTranslationReasoningEffort,
    detail:
      captionTranslationArtifact.coverage.fallbackCount > 0
        ? `${captionTranslationArtifact.coverage.translatedCount}/${captionTranslationArtifact.coverage.requestedCount} captions translated; ${captionTranslationArtifact.coverage.fallbackCount} used English fallback.`
        : "All 5 display captions translated into Russian."
  });
  recordExecutedStage(
    "captionTranslation",
    joinPromptPasses(captionTranslationPromptTexts),
    "LLM stage: translates the 5 display captions into Russian with one retry for missing items.",
    captionTranslationArtifact,
    { model: input.stageModels?.captionTranslation ?? null }
  );
  const localizedCaptionOptions = captionOptions.map((option) => {
    const translation =
      captionTranslationArtifact?.items.find((item) => item.candidateId === option.candidateId) ??
      null;
    return {
      ...option,
      highlights: captionHighlightsById.get(option.candidateId) ?? createEmptyTemplateCaptionHighlights(),
      topRu: translation?.topRu ?? option.top,
      bottomRu: translation?.bottomRu ?? option.bottom
    };
  });
  const localizedFinalists = finalists.map((finalist) => {
    const translation =
      captionTranslationArtifact?.items.find((item) => item.candidateId === finalist.candidateId) ??
      null;
    return {
      ...finalist,
      translation: {
        topRu: translation?.topRu ?? finalist.top,
        bottomRu: translation?.bottomRu ?? finalist.bottom,
        translatedAt: captionTranslationArtifact?.translatedAt ?? new Date().toISOString()
      }
    };
  });

  const titleByOption = new Map(
    oneShotResult.titles.map((entry, index) => [entry.option ?? index + 1, entry] as const)
  );
  const titleFallbackOptions: number[] = [];
  const titleOptions = Array.from({ length: 5 }, (_, index) => {
    const option = index + 1;
    const existing = titleByOption.get(option) ?? null;
    const seedTitle =
      input.videoContext.title.trim() ||
      oneShotResult.analysis.keyPhraseToAdapt ||
      "Reference title";
    const title = normalizeAllCapsTitleText(
      existing?.title?.trim() || `${seedTitle.slice(0, 70)}${option === 1 ? "" : ` ${option}`}`.trim()
    );
    const titleRu = normalizeAllCapsTitleText(existing?.titleRu?.trim() || title);
    const titleRuSource = existing?.titleRu?.trim() ? existing.titleRuSource ?? "llm" : "fallback";
    if (titleRuSource === "fallback") {
      titleFallbackOptions.push(option);
    }
    return {
      option,
      title,
      titleRu,
      titleRuSource
    };
  });
  const titleTranslationCoverage = {
    requestedCount: 5,
    translatedCount: 5 - titleFallbackOptions.length,
    fallbackCount: titleFallbackOptions.length,
    fallbackOptions: titleFallbackOptions,
    retriedOptions: [] as number[]
  };
  if (titleTranslationCoverage.fallbackCount > 0) {
    warnings.push({
      field: "oneShotReference",
      message: `Russian title fallback used for ${titleTranslationCoverage.fallbackCount} title option${titleTranslationCoverage.fallbackCount === 1 ? "" : "s"}.`
    });
  }

  const seo = await runStage2SeoStage({
    enabled: shouldRunStage2SeoGeneration(input.stageModels),
    sourceUrl: input.videoContext.sourceUrl,
    title: input.videoContext.title,
    comments: input.videoContext.comments,
    omittedCommentsCount: 0,
    userInstruction: input.videoContext.userInstruction,
    stage2Output: {
      inputAnalysis: {
        visualAnchors: oneShotResult.analysis.visualAnchors,
        commentVibe: oneShotResult.analysis.commentVibe,
        keyPhraseToAdapt: oneShotResult.analysis.keyPhraseToAdapt
      },
      captionOptions: localizedCaptionOptions,
      finalPick
    },
    executor: input.executor,
    stageModels: input.stageModels,
    promptConfig: input.promptConfig,
    warnings,
    promptInputManifests,
    reportProgress,
    recordExecutedStage
  });

  await reportProgress({
    stageId: "assemble",
    state: "running",
    promptChars: 0,
    reasoningEffort: null,
    detail: "Assembling the one-shot baseline result."
  });

  const rawPromptStages = executedPromptStages.map((stage) =>
    stage.stageId === "oneShotReference"
      ? buildProductOwnedPromptStageDiagnostics({
          stageId: stage.stageId,
          promptText: stage.promptText,
          includePromptText: true,
          usesImages: stage.usesImages,
          model: stage.model,
          reasoningEffort: oneShotReasoningEffort,
          summary: stage.summary,
          serializedResultBytes: stage.serializedResultBytes,
          estimatedOutputTokens: stage.estimatedOutputTokens,
          inputManifest: promptInputManifests[stage.stageId],
          defaultPrompt: variantConfig.promptText,
          promptCompatibilityVersion: variantConfig.promptVersion
        })
      : buildPromptStageDiagnostics({
          stageId: stage.stageId,
          promptConfig: input.promptConfig,
          promptText: stage.promptText,
          includePromptText: true,
          usesImages: stage.usesImages,
          model: stage.model,
          summary: stage.summary,
          serializedResultBytes: stage.serializedResultBytes,
          estimatedOutputTokens: stage.estimatedOutputTokens,
          inputManifest: promptInputManifests[stage.stageId]
        })
  );
  const summaryPromptStages = executedPromptStages.map((stage) =>
    stage.stageId === "oneShotReference"
      ? buildProductOwnedPromptStageDiagnostics({
          stageId: stage.stageId,
          promptText: stage.promptText,
          includePromptText: false,
          usesImages: stage.usesImages,
          model: stage.model,
          reasoningEffort: oneShotReasoningEffort,
          summary: stage.summary,
          serializedResultBytes: stage.serializedResultBytes,
          estimatedOutputTokens: stage.estimatedOutputTokens,
          inputManifest: promptInputManifests[stage.stageId],
          defaultPrompt: variantConfig.promptText,
          promptCompatibilityVersion: variantConfig.promptVersion
        })
      : buildPromptStageDiagnostics({
          stageId: stage.stageId,
          promptConfig: input.promptConfig,
          promptText: stage.promptText,
          includePromptText: false,
          usesImages: stage.usesImages,
          model: stage.model,
          summary: stage.summary,
          serializedResultBytes: stage.serializedResultBytes,
          estimatedOutputTokens: stage.estimatedOutputTokens,
          inputManifest: promptInputManifests[stage.stageId]
        })
  );
  const tokenUsageStages = rawPromptStages.map((stage) => ({
    stageId: stage.stageId,
    promptChars: stage.promptChars,
    estimatedInputTokens: stage.estimatedInputTokens ?? null,
    estimatedOutputTokens: stage.estimatedOutputTokens ?? null,
    serializedResultBytes: stage.serializedResultBytes ?? null,
    persistedPayloadBytes: stage.persistedPayloadBytes ?? null
  }));
  const tokenUsage: Stage2TokenUsage = {
    stages: tokenUsageStages,
    totalPromptChars: tokenUsageStages.reduce((sum, stage) => sum + (stage.promptChars ?? 0), 0),
    totalEstimatedInputTokens: tokenUsageStages.reduce(
      (sum, stage) => sum + (stage.estimatedInputTokens ?? 0),
      0
    ),
    totalEstimatedOutputTokens: tokenUsageStages.reduce(
      (sum, stage) => sum + (stage.estimatedOutputTokens ?? 0),
      0
    ),
    totalSerializedResultBytes: tokenUsageStages.reduce(
      (sum, stage) => sum + (stage.serializedResultBytes ?? 0),
      0
    ),
    totalPersistedPayloadBytes: tokenUsageStages.reduce(
      (sum, stage) => sum + (stage.persistedPayloadBytes ?? 0),
      0
    )
  };
  const resolvedWorkerProfile = getResolvedStage2WorkerProfile(input.channelConfig);
  const diagnostics: Stage2Diagnostics = {
    channel: {
      channelId: input.channelConfig.channelId,
      name: input.channelConfig.name,
      username: input.channelConfig.username,
      workerProfile: {
        requestedId: resolvedWorkerProfile.requestedId,
        resolvedId: resolvedWorkerProfile.resolvedId,
        label: resolvedWorkerProfile.label,
        description: resolvedWorkerProfile.description,
        summary: resolvedWorkerProfile.summary,
        origin: resolvedWorkerProfile.origin
      },
      examplesSource: input.channelConfig.examplesSource,
      hardConstraints: input.channelConfig.hardConstraints,
      styleProfile: input.channelConfig.styleProfile,
      editorialMemory: input.channelConfig.editorialMemory,
      workspaceCorpusCount: input.workspaceCorpusCount,
      activeCorpusCount: 0
    },
    selection: {
      clipType: input.selectorFallback.clipType,
      primaryAngle: input.selectorFallback.primaryAngle,
      secondaryAngles: input.selectorFallback.secondaryAngles,
      rankedAngles: input.selectorFallback.rankedAngles,
      coreTrigger: input.selectorFallback.coreTrigger,
      humanStake: input.selectorFallback.humanStake,
      narrativeFrame: input.selectorFallback.narrativeFrame,
      whyViewerCares: input.selectorFallback.whyViewerCares,
      topStrategy: input.selectorFallback.topStrategy,
      bottomEnergy: input.selectorFallback.bottomEnergy,
      whyOldV6WouldWorkHere: input.selectorFallback.whyOldV6WouldWorkHere,
      failureModes: input.selectorFallback.failureModes,
      writerBrief: input.selectorFallback.writerBrief,
      rationale: input.selectorFallback.rationale ?? null,
      selectedExampleIds: []
    },
    analysis: {
      visualAnchors: input.analyzerOutput.visualAnchors,
      specificNouns: input.analyzerOutput.specificNouns,
      visibleActions: input.analyzerOutput.visibleActions,
      firstSecondsSignal: input.analyzerOutput.firstSecondsSignal,
      sceneBeats: input.analyzerOutput.sceneBeats,
      revealMoment: input.analyzerOutput.revealMoment,
      lateClipChange: input.analyzerOutput.lateClipChange,
      whyViewerCares: input.analyzerOutput.whyViewerCares,
      bestBottomEnergy: input.analyzerOutput.bestBottomEnergy,
      commentVibe: input.analyzerOutput.commentVibe,
      commentConsensusLane: input.analyzerOutput.commentConsensusLane,
      commentJokeLane: input.analyzerOutput.commentJokeLane,
      commentDissentLane: input.analyzerOutput.commentDissentLane,
      commentSuspicionLane: input.analyzerOutput.commentSuspicionLane,
      slangToAdapt: input.analyzerOutput.slangToAdapt,
      commentLanguageCues: input.analyzerOutput.commentLanguageCues,
      hiddenDetail: input.analyzerOutput.hiddenDetail,
      genericRisks: input.analyzerOutput.genericRisks,
      uncertaintyNotes: input.analyzerOutput.uncertaintyNotes,
      rawSummary: input.analyzerOutput.rawSummary
    },
    sourceContext: buildStage2SourceContextSummary(input.videoContext),
    effectivePrompting: {
      promptStages: input.debugMode === "raw" ? rawPromptStages : summaryPromptStages
    },
    examples: {
      source: input.channelConfig.examplesSource,
      workspaceCorpusCount: input.workspaceCorpusCount,
      activeCorpusCount: 0,
      selectorCandidateCount: 0,
      retrievalConfidence: input.nativeExamplesAssessment.retrievalConfidence,
      examplesMode: input.nativeExamplesAssessment.examplesMode,
      explanation: input.nativeExamplesAssessment.explanation,
      evidence: input.nativeExamplesAssessment.evidence,
      retrievalWarning: input.nativeExamplesAssessment.retrievalWarning,
      examplesRoleSummary: input.nativeExamplesAssessment.examplesRoleSummary,
      primaryDriverSummary: input.nativeExamplesAssessment.primaryDriverSummary,
      primaryDrivers: input.nativeExamplesAssessment.primaryDrivers,
      channelStylePriority: input.nativeExamplesAssessment.channelStylePriority,
      editorialMemoryPriority: input.nativeExamplesAssessment.editorialMemoryPriority,
      availableExamples: [],
      selectedExamples: []
    },
    nativeCaptionV3: {
      contextPacket,
      candidateBatch: candidates,
      hardValidator: null,
      qualityCourt: null,
      repair: null,
      templateBackfill: null,
      guardSummary,
      displayOptions: localizedCaptionOptions,
      titleWriter: {
        titleOptions,
        translationCoverage: titleTranslationCoverage
      },
      translation: captionTranslationArtifact
    }
  };
  const output: ViralShortsStage2Result = {
    inputAnalysis: {
      visualAnchors: oneShotResult.analysis.visualAnchors,
      commentVibe: oneShotResult.analysis.commentVibe,
      keyPhraseToAdapt: oneShotResult.analysis.keyPhraseToAdapt
    },
    captionOptions: localizedCaptionOptions,
    finalists: localizedFinalists,
    titleOptions,
    finalPick,
    winner,
    pipeline: {
      channelId: input.channelConfig.channelId,
      workerProfile: {
        requestedId: resolvedWorkerProfile.requestedId,
        resolvedId: resolvedWorkerProfile.resolvedId,
        label: resolvedWorkerProfile.label,
        description: resolvedWorkerProfile.description,
        summary: resolvedWorkerProfile.summary,
        origin: resolvedWorkerProfile.origin
      },
      mode: input.reusedContextPacket ? "regenerate" : "codex_pipeline",
      execution: input.pipelineExecution,
      selectorOutput: input.selectorFallback,
      availableExamplesCount: 0,
      selectedExamplesCount: 0,
      retrievalConfidence: input.nativeExamplesAssessment.retrievalConfidence,
      examplesMode: input.nativeExamplesAssessment.examplesMode,
      retrievalExplanation: input.nativeExamplesAssessment.explanation,
      contextPacket,
      nativeCaptionV3: {
        contextPacket,
        candidateBatch: candidates,
        hardValidator: null,
        qualityCourt: null,
        repair: null,
        templateBackfill: null,
        guardSummary,
        displayOptions: localizedCaptionOptions,
        titleWriter: {
          titleOptions,
          translationCoverage: titleTranslationCoverage
        },
        translation: captionTranslationArtifact
      }
    },
    diagnostics
  };
  await reportProgress({
    stageId: "assemble",
    state: "completed",
    promptChars: 0,
    reasoningEffort: null,
    detail: "One-shot baseline result assembled."
  });

  return {
    output,
    seo,
    warnings,
    diagnostics,
    rawDebugArtifact:
      input.debugMode === "raw"
        ? {
            kind: "stage2-run-debug",
            runId: "pending",
            createdAt: new Date().toISOString(),
            promptStages: rawPromptStages
          }
        : null,
    tokenUsage
  };
}

export function normalizeComments(comments: CommentItem[]): ViralShortsVideoContext["comments"] {
  return comments.map((comment) => ({
    author: comment.author,
    likes: comment.likes,
    text: comment.text
  }));
}

export function buildVideoContext(input: {
  sourceUrl: string;
  title: string;
  description?: string | null;
  transcript?: string | null;
  comments?: ViralShortsVideoContext["comments"];
  frameDescriptions?: string[];
  userInstruction?: string | null;
}): ViralShortsVideoContext {
  return {
    sourceUrl: input.sourceUrl,
    title: input.title.trim() || "Untitled video",
    description: input.description?.trim() || "",
    transcript: input.transcript?.trim() || "",
    frameDescriptions: input.frameDescriptions?.map((item) => item.trim()).filter(Boolean) ?? [],
    comments: input.comments ?? [],
    userInstruction: input.userInstruction?.trim() || null
  };
}

export class ViralShortsWorkerService {
  resolveExamplesCorpus(input: {
    channel: {
      id: string;
      name: string;
      stage2ExamplesConfig: Stage2ExamplesConfig;
    };
    workspaceStage2ExamplesCorpusJson: string | null | undefined;
  }): {
    source: Stage2RuntimeChannelConfig["examplesSource"];
    corpus: Stage2CorpusExample[];
    workspaceCorpusCount: number;
  } {
    return resolveStage2ExamplesCorpus(input);
  }

  buildPromptPacket(input: {
    channel: {
      id: string;
      name: string;
      username: string;
      stage2WorkerProfileId?: string | null;
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
      stage2StyleProfile?: Stage2RuntimeChannelConfig["styleProfile"];
      editorialMemory?: Stage2RuntimeChannelConfig["editorialMemory"];
      templateHighlightProfile?: Stage2RuntimeChannelConfig["templateHighlightProfile"];
    };
    workspaceStage2ExamplesCorpusJson: string | null | undefined;
    videoContext: ViralShortsVideoContext;
    promptConfig?: Stage2PromptConfig | null;
  }): PromptPacket {
    const { corpus, source } = this.resolveExamplesCorpus({
      channel: {
        id: input.channel.id,
        name: input.channel.name,
        stage2ExamplesConfig: input.channel.stage2ExamplesConfig
      },
      workspaceStage2ExamplesCorpusJson: input.workspaceStage2ExamplesCorpusJson
    });
    const channelConfig = normalizeChannelConfig({
      ...input.channel,
      resolvedExamplesSource: source
    });
    const heuristicOutput = heuristicAnalyzer({
      title: input.videoContext.title,
      description: input.videoContext.description,
      transcript: input.videoContext.transcript,
      comments: input.videoContext.comments.map((comment) => comment.text),
      visualAnchors: input.videoContext.frameDescriptions
    });
    const analyzedHeuristicOutput =
      input.videoContext.comments.length > 0
        ? applyCommentIntelligenceBoost(heuristicOutput, input.videoContext.comments)
        : applyNoCommentsTruthfulnessGuard(heuristicOutput, false);
    const queryText = buildCorpusQueryText(input.videoContext, analyzedHeuristicOutput);
    const selectorPool = buildSelectorExamplePool({
      examples: corpus,
      queryText
    });
    const selectorOutput = applyExamplesAssessmentToSelectorOutput(
      fallbackSelectorOutput(
        channelConfig,
        analyzedHeuristicOutput,
        selectorPool.selectorExamples,
        input.videoContext,
        selectorPool.assessment,
        selectorPool.exampleInsights
      ),
      selectorPool.assessment
    );
    return buildPromptPacket({
      channelConfig,
      videoContext: input.videoContext,
      analyzerOutput: analyzedHeuristicOutput,
      selectorOutput,
      examplesAssessment: selectorPool.assessment,
      availableExamples: selectorPool.selectorExamples,
      promptConfig: normalizeStage2PromptConfig(input.promptConfig)
    });
  }

  async runNativeCaptionPipeline(input: {
    channel: {
      id: string;
      name: string;
      username: string;
      stage2WorkerProfileId?: string | null;
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
      stage2StyleProfile?: Stage2RuntimeChannelConfig["styleProfile"];
      editorialMemory?: Stage2RuntimeChannelConfig["editorialMemory"];
      templateHighlightProfile?: Stage2RuntimeChannelConfig["templateHighlightProfile"];
    };
    workspaceStage2ExamplesCorpusJson: string | null | undefined;
    videoContext: ViralShortsVideoContext;
    imagePaths: string[];
    executor: JsonStageExecutor;
    stageModels?: Partial<Stage2PipelineModelMap>;
    promptConfig?: Stage2PromptConfig | null;
    debugMode?: Stage2DebugMode;
    onProgress?: (event: PipelineProgressEvent) => void | Promise<void>;
  }): Promise<RunPipelineResult> {
    return this.runNativeCaptionPipelineInternal({
      ...input,
      reusedContextPacket: null
    });
  }

  async runNativeCaptionPipelineFromContext(input: {
    channel: {
      id: string;
      name: string;
      username: string;
      stage2WorkerProfileId?: string | null;
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
      stage2StyleProfile?: Stage2RuntimeChannelConfig["styleProfile"];
      editorialMemory?: Stage2RuntimeChannelConfig["editorialMemory"];
      templateHighlightProfile?: Stage2RuntimeChannelConfig["templateHighlightProfile"];
    };
    workspaceStage2ExamplesCorpusJson: string | null | undefined;
    videoContext: ViralShortsVideoContext;
    contextPacket: NativeCaptionContextPacket;
    executor: JsonStageExecutor;
    stageModels?: Partial<Stage2PipelineModelMap>;
    promptConfig?: Stage2PromptConfig | null;
    debugMode?: Stage2DebugMode;
    onProgress?: (event: PipelineProgressEvent) => void | Promise<void>;
  }): Promise<RunPipelineResult> {
    return this.runNativeCaptionPipelineInternal({
      ...input,
      imagePaths: [],
      reusedContextPacket: input.contextPacket
    });
  }

  async runNativeCaptionHighlighting(input: {
    channel: {
      id: string;
      name: string;
      username: string;
      stage2WorkerProfileId?: string | null;
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
      stage2StyleProfile?: Stage2RuntimeChannelConfig["styleProfile"];
      editorialMemory?: Stage2RuntimeChannelConfig["editorialMemory"];
      templateHighlightProfile?: Stage2RuntimeChannelConfig["templateHighlightProfile"];
    };
    captionOptions: Array<{
      candidateId: string;
      top: string;
      bottom: string;
    }>;
    executor: JsonStageExecutor;
    stageModels?: Partial<Stage2PipelineModelMap>;
    promptConfig?: Stage2PromptConfig | null;
  }): Promise<Map<string, TemplateCaptionHighlights>> {
    const channelConfig = normalizeChannelConfig({
      ...input.channel,
      resolvedExamplesSource: "workspace_default"
    });
    return runNativeCaptionHighlightingStage({
      channelConfig,
      captionOptions: input.captionOptions,
      executor: input.executor,
      stageModels: input.stageModels,
      promptConfig: normalizeStage2PromptConfig(input.promptConfig),
      warnings: [],
      promptInputManifests: {},
      reportProgress: async () => undefined,
      recordExecutedStage: () => undefined
    });
  }

  private async runNativeCaptionPipelineInternal(input: {
    channel: {
      id: string;
      name: string;
      username: string;
      stage2WorkerProfileId?: string | null;
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
      stage2StyleProfile?: Stage2RuntimeChannelConfig["styleProfile"];
      editorialMemory?: Stage2RuntimeChannelConfig["editorialMemory"];
      templateHighlightProfile?: Stage2RuntimeChannelConfig["templateHighlightProfile"];
    };
    workspaceStage2ExamplesCorpusJson: string | null | undefined;
    videoContext: ViralShortsVideoContext;
    imagePaths: string[];
    executor: JsonStageExecutor;
    stageModels?: Partial<Stage2PipelineModelMap>;
    promptConfig?: Stage2PromptConfig | null;
    debugMode?: Stage2DebugMode;
    onProgress?: (event: PipelineProgressEvent) => void | Promise<void>;
    reusedContextPacket: NativeCaptionContextPacket | null;
  }): Promise<RunPipelineResult> {
    const warnings: StageWarning[] = [];
    const promptConfig = normalizeStage2PromptConfig(input.promptConfig);
    const debugMode: Stage2DebugMode = input.debugMode === "raw" ? "raw" : "summary";
    const { source, workspaceCorpusCount } = this.resolveExamplesCorpus({
      channel: {
        id: input.channel.id,
        name: input.channel.name,
        stage2ExamplesConfig: input.channel.stage2ExamplesConfig
      },
      workspaceStage2ExamplesCorpusJson: input.workspaceStage2ExamplesCorpusJson
    });
    const channelConfig = normalizeChannelConfig({
      ...input.channel,
      resolvedExamplesSource: source
    });
    const resolvedNativeWorkerProfile = getResolvedStage2WorkerProfile(channelConfig);
    const workerBuild = getStage2WorkerBuildInfo();
    const pathVariant = isReferenceOneShotExecutionMode(resolvedNativeWorkerProfile.executionMode)
      ? resolveReferenceOneShotVariantConfig(channelConfig).pathVariant
      : "modular_native_v1";
    const pipelineExecution = buildStage2PipelineExecutionSnapshot({
      featureFlags: resolveStage2VNextFlagSnapshot(false),
      pipelineVersion: "native_caption_v3",
      pathVariant,
      stageChainVersion: resolveStage2StageChainVersion("native_caption_v3"),
      workerBuild,
      resolvedAt: new Date().toISOString()
    });
    const executedPromptStages: ExecutedPromptStageRecord[] = [];
    const promptInputManifests: Partial<
      Record<Stage2PipelineStageId, Stage2DiagnosticsPromptStage["inputManifest"]>
    > = {};
    const reportProgress = async (event: PipelineProgressEvent): Promise<void> => {
      try {
        await input.onProgress?.(event);
      } catch {
        return;
      }
    };
    const recordExecutedStage = (
      stageId: Stage2PipelineStageId,
      promptText: string,
      summary: string,
      resultPayload: unknown,
      options?: { usesImages?: boolean; model?: string | null }
    ) => {
      const serializedResultBytes = measureSerializedBytes(resultPayload);
      executedPromptStages.push({
        stageId,
        promptText,
        summary,
        usesImages: options?.usesImages,
        model: options?.model ?? null,
        serializedResultBytes,
        estimatedOutputTokens: estimateTokensFromChars(serializedResultBytes)
      });
    };

    const analyzerFallback = heuristicAnalyzer({
      title: input.videoContext.title,
      description: input.videoContext.description,
      transcript: input.videoContext.transcript,
      comments: input.videoContext.comments.map((comment) => comment.text),
      visualAnchors: input.videoContext.frameDescriptions
    });
    const analyzerOutput =
      input.videoContext.comments.length > 0
        ? applyCommentIntelligenceBoost(analyzerFallback, input.videoContext.comments)
        : applyNoCommentsTruthfulnessGuard(analyzerFallback, false);
    const nativeExamplesAssessment = buildNativeCaptionExamplesAssessment(channelConfig);
    const selectorFallback = fallbackSelectorOutput(
      channelConfig,
      analyzerOutput,
      [],
      input.videoContext,
      nativeExamplesAssessment,
      []
    );

    if (pathVariant === "reference_one_shot_v1" || pathVariant === "reference_one_shot_v1_experimental") {
      return runReferenceOneShotNativeCaptionPipeline({
        channelConfig,
        workspaceCorpusCount,
        videoContext: input.videoContext,
        imagePaths: input.imagePaths,
        executor: input.executor,
        stageModels: input.stageModels,
        promptConfig,
        debugMode,
        onProgress: input.onProgress,
        reusedContextPacket: input.reusedContextPacket,
        pipelineExecution,
        analyzerOutput,
        selectorFallback,
        nativeExamplesAssessment
      });
    }

    let contextPacket = input.reusedContextPacket;
    if (!contextPacket) {
      const contextPacketPrompt = buildNativeCaptionContextPacketPrompt({
        videoContext: input.videoContext,
        channelConfig,
        promptConfig
      });
      const contextReasoningEffort = resolveStageReasoningEffort("contextPacket", promptConfig);
      const contextLearning = buildNativeCaptionChannelLearningPayload(channelConfig, "minimal");
      promptInputManifests.contextPacket = {
        learningDetail: "minimal",
        description: {
          availableChars: input.videoContext.description.trim().length,
          passedChars: input.videoContext.description.trim().length,
          omittedChars: 0,
          truncated: false,
          limit: null
        },
        transcript: {
          availableChars: input.videoContext.transcript.trim().length,
          passedChars: input.videoContext.transcript.trim().length,
          omittedChars: 0,
          truncated: false,
          limit: null
        },
        frames: {
          availableCount: input.videoContext.frameDescriptions.length,
          passedCount: input.videoContext.frameDescriptions.length,
          omittedCount: 0,
          truncated: false,
          limit: null
        },
        comments: {
          availableCount: input.videoContext.comments.length,
          passedCount: Math.min(15, input.videoContext.comments.length),
          omittedCount: Math.max(0, input.videoContext.comments.length - 15),
          truncated: input.videoContext.comments.length > 15,
          limit: 15,
          passedCommentIds: input.videoContext.comments
            .slice(0, 15)
            .map((comment, index) => comment.id ?? `comment_${index + 1}`)
        },
        examples: null,
        channelLearning: contextLearning.usage,
        candidates: null,
        stageFlags: ["style card", "channel learning", "comment digest", "examples disabled", "multimodal packet"]
      };
      await reportProgress({
        stageId: "contextPacket",
        state: "running",
        promptChars: contextPacketPrompt.length,
        reasoningEffort: contextReasoningEffort,
        detail: "Building the context packet from frames, transcript, and comments."
      });
      const startedAt = Date.now();
      const fallbackPacket = buildNativeCaptionFallbackContextPacket({
        analyzerOutput,
        selectorOutput: selectorFallback,
        videoContext: input.videoContext,
        channelConfig
      });
      try {
        const rawContextPacket = await input.executor.runJson<unknown>({
          prompt: contextPacketPrompt,
          schema: NATIVE_CONTEXT_PACKET_SCHEMA,
          imagePaths: input.imagePaths,
          model: input.stageModels?.contextPacket ?? null,
          reasoningEffort: contextReasoningEffort
        });
        contextPacket = normalizeNativeCaptionContextPacket(rawContextPacket, fallbackPacket);
        await reportProgress({
          stageId: "contextPacket",
          state: "completed",
          durationMs: Date.now() - startedAt,
          promptChars: contextPacketPrompt.length,
          reasoningEffort: contextReasoningEffort,
          detail: "Context packet built."
        });
      } catch (error) {
        contextPacket = fallbackPacket;
        warnings.push({
          field: "contextPacket",
          message:
            error instanceof Error
              ? `Context packet fallback used: ${error.message}`
              : "Context packet fallback used."
        });
        await reportProgress({
          stageId: "contextPacket",
          state: "completed",
          durationMs: Date.now() - startedAt,
          promptChars: contextPacketPrompt.length,
          reasoningEffort: contextReasoningEffort,
          detail: "Fallback context packet used."
        });
      }
      recordExecutedStage(
        "contextPacket",
        contextPacketPrompt,
        "LLM stage: builds the shared context packet for native caption generation.",
        contextPacket,
        { usesImages: input.imagePaths.length > 0, model: input.stageModels?.contextPacket ?? null }
      );
    } else {
      await reportProgress({
        stageId: "contextPacket",
        state: "completed",
        detail: "Reused the saved context packet.",
        promptChars: 0,
        reasoningEffort: null
      });
    }

    const candidatePrompt = buildNativeCaptionCandidateGeneratorPrompt({
      contextPacket,
      channelConfig,
      promptConfig,
      userInstruction: input.videoContext.userInstruction
    });
    const candidateReasoningEffort = resolveStageReasoningEffort("candidateGenerator", promptConfig);
    const compactChannelLearning = buildNativeCaptionChannelLearningPayload(channelConfig, "compact");
    promptInputManifests.candidateGenerator = {
      learningDetail: "compact",
      description: null,
      transcript: null,
      frames: null,
      comments: null,
      examples: null,
      channelLearning: compactChannelLearning.usage,
      candidates: null,
      stageFlags: ["8 candidates", "english only", "examples disabled", "style card", "channel learning"]
    };
    await reportProgress({
      stageId: "candidateGenerator",
      state: "running",
      promptChars: candidatePrompt.length,
      reasoningEffort: candidateReasoningEffort,
      detail: "Drafting the native candidate batch."
    });
    const candidateStartedAt = Date.now();
    let candidates: NativeCaptionCandidate[];
    try {
      const rawCandidates = await input.executor.runJson<unknown>({
        prompt: candidatePrompt,
        schema: NATIVE_CANDIDATE_BATCH_SCHEMA,
        model: input.stageModels?.candidateGenerator ?? null,
        reasoningEffort: candidateReasoningEffort
      });
      candidates = normalizeNativeCaptionCandidateBatch(rawCandidates);
    } catch (error) {
      throw new Error(formatStageFailure("Candidate generator", error));
    }
    if (candidates.length === 0) {
      throw new Error("Candidate generator returned no usable candidates.");
    }
    await reportProgress({
      stageId: "candidateGenerator",
      state: "completed",
      durationMs: Date.now() - candidateStartedAt,
      promptChars: candidatePrompt.length,
      reasoningEffort: candidateReasoningEffort,
      detail: `${candidates.length} candidates drafted.`
    });
    recordExecutedStage(
      "candidateGenerator",
      candidatePrompt,
      "LLM stage: drafts the 8-candidate native caption batch.",
      candidates,
      { model: input.stageModels?.candidateGenerator ?? null }
    );
    let candidateConstraintChecks = buildNativeCaptionConstraintCheckMap(
      candidates,
      channelConfig.hardConstraints
    );
    await reportProgress({
      stageId: "hardValidator",
      state: "running",
      promptChars: 0,
      reasoningEffort: null,
      detail: "Checking deterministic hard constraints."
    });
    const hardValidationStartedAt = Date.now();
    const hardValidator = buildNativeCaptionHardValidator({
      candidates,
      constraintChecks: candidateConstraintChecks
    });
    const validCandidateIds = new Set(hardValidator.validPool);
    const validCandidates = candidates.filter((candidate) => validCandidateIds.has(candidate.candidateId));
    await reportProgress({
      stageId: "hardValidator",
      state: "completed",
      durationMs: Date.now() - hardValidationStartedAt,
      promptChars: 0,
      reasoningEffort: null,
      detail: `${hardValidator.validPool.length} valid and ${hardValidator.invalidPool.length} invalid candidates after deterministic checks.`
    });

    const qualityCourtPrompt = buildNativeCaptionQualityCourtPrompt({
      contextPacket,
      channelConfig,
      candidates,
      hardConstraints: channelConfig.hardConstraints,
      candidateConstraintChecks,
      hardValidator,
      promptConfig
    });
    const qualityCourtReasoningEffort = resolveStageReasoningEffort("qualityCourt", promptConfig);
    promptInputManifests.qualityCourt = {
      learningDetail: "compact",
      description: null,
      transcript: null,
      frames: null,
      comments: null,
      examples: null,
      channelLearning: compactChannelLearning.usage,
      candidates: {
        passedCount: hardValidator.validPool.length,
        passedCandidateIds: hardValidator.validPool,
        criticScoreCount: null,
        shortlistCount: null
      },
      stageFlags: [
        "editorial court",
        "pairwise choice",
        "finalists plus display-safe extras",
        "channel learning"
      ]
    };
    await reportProgress({
      stageId: "qualityCourt",
      state: "running",
      promptChars: qualityCourtPrompt.length,
      reasoningEffort: qualityCourtReasoningEffort,
      detail: "Running the editorial court on the valid pool."
    });
    const courtStartedAt = Date.now();
    let qualityCourt: NativeCaptionQualityCourt;
    try {
      const rawQualityCourt = await input.executor.runJson<unknown>({
        prompt: qualityCourtPrompt,
        schema: NATIVE_QUALITY_COURT_SCHEMA,
        model: input.stageModels?.qualityCourt ?? null,
        reasoningEffort: qualityCourtReasoningEffort
      });
      qualityCourt = normalizeNativeCaptionQualityCourt(rawQualityCourt, candidates, contextPacket);
    } catch (error) {
      warnings.push({
        field: "qualityCourt",
        message:
          error instanceof Error
            ? `Quality court fallback used: ${error.message}`
            : "Quality court fallback used."
      });
      qualityCourt = buildNativeCaptionQualityCourtFallback({
        candidates: validCandidates.length > 0 ? validCandidates : candidates,
        contextPacket
      });
    }
    qualityCourt = applyRuntimeSelectionToQualityCourt({
      qualityCourt,
      validCandidates,
      hardValidator,
      contextPacket
    });
    await reportProgress({
      stageId: "qualityCourt",
      state: "completed",
      durationMs: Date.now() - courtStartedAt,
      promptChars: qualityCourtPrompt.length,
      reasoningEffort: qualityCourtReasoningEffort,
      detail: `${qualityCourt.finalists.length} finalists and ${qualityCourt.displaySafeExtras.length} display-safe extras survived editorial review.`
    });
    recordExecutedStage(
      "qualityCourt",
      qualityCourtPrompt,
      "LLM stage: applies editorial hard-fail logic, keeps up to 3 finalists, and marks display-safe extras.",
      qualityCourt,
      { model: input.stageModels?.qualityCourt ?? null }
    );

    const recoveryReasonParts: string[] = [];
    if (qualityCourt.finalists.length < 3) {
      recoveryReasonParts.push(`finalists_below_target:${qualityCourt.finalists.length}/3`);
    }
    if (qualityCourt.finalists.length + qualityCourt.displaySafeExtras.length < 5) {
      recoveryReasonParts.push(
        `displayable_below_target:${qualityCourt.finalists.length + qualityCourt.displaySafeExtras.length}/5`
      );
    }
    if (!qualityCourt.winnerCandidateId) {
      recoveryReasonParts.push("winner_missing");
    }
    if (
      contextPacket.audienceWave.dominantHarmlessHandle &&
      validCandidates.some((candidate) => candidate.retainedHandle) &&
      !qualityCourt.finalists.some((entry) => entry.preservedHandle)
    ) {
      recoveryReasonParts.push("audience_handle_missing_in_finalists");
    }
    const recoveryReason = recoveryReasonParts.join(",") || null;

    const validById = new Map(validCandidates.map((candidate) => [candidate.candidateId, candidate] as const));
    const dedupeKeyForCandidate = (candidate: NativeCaptionCandidate) =>
      `${candidate.top.toLowerCase()}|${candidate.bottom.toLowerCase()}`;
    const seedUsedIds = new Set<string>();
    const seedUsedTexts = new Set<string>();

    type NativeDisplayEntry = {
      candidate: NativeCaptionCandidate;
      displayTier: "finalist" | "display_safe_extra" | "recovery" | "template_backfill";
      sourceStage: "qualityCourt" | "targetedRepair" | "templateBackfill";
      displayReason: string;
      constraintCheck?: NativeCaptionFinalist["constraintCheck"];
      preservedHandle?: boolean;
      whyChosen?: string[];
    };

    const resolveDisplayConstraintCheck = (
      entry: NativeDisplayEntry
    ): NativeCaptionFinalist["constraintCheck"] => {
      if (entry.constraintCheck) {
        return entry.constraintCheck;
      }
      const constraintCheck =
        candidateConstraintChecks.get(entry.candidate.candidateId) ??
        evaluateNativeCaptionConstraintCheck(entry.candidate, channelConfig.hardConstraints);
      candidateConstraintChecks.set(entry.candidate.candidateId, constraintCheck);
      entry.constraintCheck = constraintCheck;
      return constraintCheck;
    };

    const pushUniqueSeedEntry = (
      target: NativeDisplayEntry[],
      entry: NativeDisplayEntry | null
    ): void => {
      if (!entry) {
        return;
      }
      const dedupeKey = dedupeKeyForCandidate(entry.candidate);
      if (seedUsedIds.has(entry.candidate.candidateId) || seedUsedTexts.has(dedupeKey)) {
        return;
      }
      seedUsedIds.add(entry.candidate.candidateId);
      seedUsedTexts.add(dedupeKey);
      target.push(entry);
    };

    const finalistEntries: NativeDisplayEntry[] = [];
    for (const finalist of qualityCourt.finalists) {
      const candidate = validById.get(finalist.candidateId);
      pushUniqueSeedEntry(
        finalistEntries,
        candidate
          ? {
              candidate,
              displayTier: "finalist",
              sourceStage: "qualityCourt",
              displayReason:
                finalist.whyChosen[0] ??
                (candidate.retainedHandle
                  ? "Preserves the audience handle without flattening the clip."
                  : "Won the editorial court on truth, wave, and naturalness."),
              preservedHandle: finalist.preservedHandle,
              whyChosen: finalist.whyChosen
            }
          : null
      );
    }

    const displaySafeExtraEntries: NativeDisplayEntry[] = [];
    for (const extra of qualityCourt.displaySafeExtras) {
      const candidate = validById.get(extra.candidateId);
      pushUniqueSeedEntry(
        displaySafeExtraEntries,
        candidate
          ? {
              candidate,
              displayTier: "display_safe_extra",
              sourceStage: "qualityCourt",
              displayReason:
                extra.whyDisplaySafe[0] ??
                "Display-safe and human, but weaker than the finalists.",
              preservedHandle: candidate.retainedHandle
            }
          : null
      );
    }

    let repairResult: NativeCaptionRepairResult | null = null;
    let recoveryEntries: NativeDisplayEntry[] = [];
    if (qualityCourt.recoveryPlan.required && qualityCourt.recoveryPlan.briefs.length > 0) {
      const repairPrompt = buildNativeCaptionTargetedRepairPrompt({
        contextPacket,
        channelConfig,
        repairBriefs: qualityCourt.recoveryPlan.briefs,
        candidates: [
          ...finalistEntries.map((entry) => entry.candidate),
          ...displaySafeExtraEntries.map((entry) => entry.candidate)
        ],
        hardConstraints: channelConfig.hardConstraints,
        candidateConstraintChecks,
        promptConfig
      });
      const repairReasoningEffort = resolveStageReasoningEffort("targetedRepair", promptConfig);
      promptInputManifests.targetedRepair = {
        learningDetail: "compact",
        description: null,
        transcript: null,
        frames: null,
        comments: null,
        examples: null,
        channelLearning: compactChannelLearning.usage,
        candidates: {
          passedCount: qualityCourt.recoveryPlan.briefs.length,
          passedCandidateIds: qualityCourt.recoveryPlan.briefs.map((brief) => brief.laneId),
          criticScoreCount: qualityCourt.finalists.length,
          shortlistCount: finalistEntries.length + displaySafeExtraEntries.length
        },
        stageFlags: ["conditional recovery", "fills missing lanes only", "channel learning"]
      };
      await reportProgress({
        stageId: "targetedRepair",
        state: "running",
        promptChars: repairPrompt.length,
        reasoningEffort: repairReasoningEffort,
        detail: "Generating only the missing recovery candidates."
      });
      const repairStartedAt = Date.now();
      try {
        const rawRepair = await input.executor.runJson<unknown>({
          prompt: repairPrompt,
          schema: NATIVE_TARGETED_REPAIR_SCHEMA,
          model: input.stageModels?.targetedRepair ?? null,
          reasoningEffort: repairReasoningEffort
        });
        repairResult = normalizeNativeCaptionRecoveryResult(rawRepair);
      } catch (error) {
        warnings.push({
          field: "targetedRepair",
          message:
            error instanceof Error
              ? `Targeted recovery fallback used: ${error.message}`
              : "Targeted recovery fallback used."
        });
      }

      if (repairResult?.recoveredCandidates.length) {
        const recoveryConstraintChecks = buildNativeCaptionConstraintCheckMap(
          repairResult.recoveredCandidates,
          channelConfig.hardConstraints
        );
        for (const candidate of repairResult.recoveredCandidates) {
          candidateConstraintChecks.set(
            candidate.candidateId,
            recoveryConstraintChecks.get(candidate.candidateId) ??
              evaluateNativeCaptionConstraintCheck(candidate, channelConfig.hardConstraints)
          );
        }
        recoveryEntries = repairResult.recoveredCandidates
          .filter(
            (candidate) =>
              candidateConstraintChecks.get(candidate.candidateId)?.passed === true &&
              !seedUsedIds.has(candidate.candidateId) &&
              !seedUsedTexts.has(dedupeKeyForCandidate(candidate))
          )
          .map((candidate, index) => {
            const brief = qualityCourt.recoveryPlan.briefs[index] ?? qualityCourt.recoveryPlan.briefs[0] ?? null;
            return {
              candidate,
              displayTier: "recovery" as const,
              sourceStage: "targetedRepair" as const,
              displayReason:
                brief?.goal ??
                (candidate.retainedHandle
                  ? "Recovery restored the missing audience-locked read."
                  : "Recovery filled a missing slot without flattening the clip.")
            };
          });
      }

      await reportProgress({
        stageId: "targetedRepair",
        state: "completed",
        durationMs: Date.now() - repairStartedAt,
        promptChars: repairPrompt.length,
        reasoningEffort: repairReasoningEffort,
        detail:
          recoveryEntries.length > 0
            ? `${recoveryEntries.length} valid recovery candidates added.`
            : "Recovery did not yield additional valid display options."
      });
      recordExecutedStage(
        "targetedRepair",
        repairPrompt,
        "LLM stage: writes only the missing candidates requested by the editorial court.",
        repairResult ?? { recoveredCandidates: [] },
        { model: input.stageModels?.targetedRepair ?? null }
      );
    } else {
      promptInputManifests.targetedRepair = {
        learningDetail: "none",
        description: null,
        transcript: null,
        frames: null,
        comments: null,
        examples: null,
        channelLearning: null,
        candidates: {
          passedCount: 0,
          passedCandidateIds: [],
          criticScoreCount: qualityCourt.finalists.length,
          shortlistCount: finalistEntries.length + displaySafeExtraEntries.length
        },
        stageFlags: ["skipped"]
      };
      await reportProgress({
        stageId: "targetedRepair",
        state: "completed",
        detail: "Skipped because the editorial court already produced enough displayable options.",
        promptChars: 0,
        reasoningEffort: null
      });
    }

    const displayEntries: NativeDisplayEntry[] = [];
    const displayUsedIds = new Set<string>();
    const displayUsedTexts = new Set<string>();
    const syncDisplayDedupes = (): void => {
      displayUsedIds.clear();
      displayUsedTexts.clear();
      for (const entry of displayEntries) {
        displayUsedIds.add(entry.candidate.candidateId);
        displayUsedTexts.add(dedupeKeyForCandidate(entry.candidate));
      }
    };
    const pushUniqueDisplayEntry = (
      target: NativeDisplayEntry[],
      entry: NativeDisplayEntry | null
    ): void => {
      if (!entry) {
        return;
      }
      const dedupeKey = dedupeKeyForCandidate(entry.candidate);
      if (displayUsedIds.has(entry.candidate.candidateId) || displayUsedTexts.has(dedupeKey)) {
        return;
      }
      displayUsedIds.add(entry.candidate.candidateId);
      displayUsedTexts.add(dedupeKey);
      target.push(entry);
    };
    for (const entry of finalistEntries) {
      pushUniqueDisplayEntry(displayEntries, entry);
    }
    for (const entry of displaySafeExtraEntries) {
      if (displayEntries.length >= 5) {
        break;
      }
      pushUniqueDisplayEntry(displayEntries, entry);
    }
    for (const entry of recoveryEntries) {
      if (displayEntries.length >= 5) {
        break;
      }
      pushUniqueDisplayEntry(displayEntries, entry);
    }

    let templateBackfill: { backfilledCandidates: NativeCaptionTemplateBackfillCandidate[] } | null = null;
    const needsTemplateWinnerSeed = !displayEntries.some(
      (entry) => entry.displayTier === "finalist" || entry.displayTier === "recovery"
    );
    const templateSlotsNeeded = Math.max(0, 5 - displayEntries.length, needsTemplateWinnerSeed ? 1 : 0);
    let templateDisplayCount = 0;
    if (templateSlotsNeeded > 0) {
      await reportProgress({
        stageId: "templateBackfill",
        state: "running",
        promptChars: 0,
        reasoningEffort: null,
        detail: "Deterministically backfilling the missing display slots."
      });
      const templateBackfillStartedAt = Date.now();
      if (needsTemplateWinnerSeed && displayEntries.length >= 5) {
        while (displayEntries.length > 4) {
          const removableIndex = [...displayEntries]
            .map((entry, index) => ({ entry, index }))
            .reverse()
            .find((item) => item.entry.displayTier === "display_safe_extra")?.index;
          if (removableIndex === undefined) {
            break;
          }
          displayEntries.splice(removableIndex, 1);
        }
        syncDisplayDedupes();
      }
      templateBackfill = buildNativeCaptionTemplateBackfill({
        contextPacket,
        constraints: channelConfig.hardConstraints,
        missingCount: templateSlotsNeeded,
        existingCandidates: [
          ...candidates,
          ...(repairResult?.recoveredCandidates ?? [])
        ]
      });
      for (const candidate of templateBackfill?.backfilledCandidates ?? []) {
        candidateConstraintChecks.set(
          candidate.candidateId,
          evaluateNativeCaptionConstraintCheck(candidate, channelConfig.hardConstraints)
        );
        if (displayEntries.length >= 5) {
          break;
        }
        pushUniqueDisplayEntry(displayEntries, {
          candidate,
          constraintCheck: candidateConstraintChecks.get(candidate.candidateId),
          displayTier: "template_backfill",
          sourceStage: "templateBackfill",
          displayReason: `Deterministic ${candidate.templateFamily.replace(/_/g, " ")} backfill kept the slot valid.`
        });
      }
      templateDisplayCount = displayEntries.filter((entry) => entry.displayTier === "template_backfill").length;
      await reportProgress({
        stageId: "templateBackfill",
        state: "completed",
        durationMs: Date.now() - templateBackfillStartedAt,
        promptChars: 0,
        reasoningEffort: null,
        detail:
          templateDisplayCount > 0
            ? `${templateDisplayCount} template options added.`
            : "Template backfill could not add new display options."
      });
    } else {
      await reportProgress({
        stageId: "templateBackfill",
        state: "completed",
        detail: "Skipped because recovery already filled the five display slots.",
        promptChars: 0,
        reasoningEffort: null
      });
    }

    const finalizeDisplayEntries = (entries: NativeDisplayEntry[], limit: number): NativeDisplayEntry[] => {
      const finalized: NativeDisplayEntry[] = [];
      const usedIds = new Set<string>();
      const usedTexts = new Set<string>();
      for (const entry of entries) {
        const constraintCheck = resolveDisplayConstraintCheck(entry);
        if (!constraintCheck.passed) {
          continue;
        }
        const dedupeKey = dedupeKeyForCandidate(entry.candidate);
        if (usedIds.has(entry.candidate.candidateId) || usedTexts.has(dedupeKey)) {
          continue;
        }
        usedIds.add(entry.candidate.candidateId);
        usedTexts.add(dedupeKey);
        finalized.push({
          ...entry,
          constraintCheck
        });
        if (finalized.length >= limit) {
          break;
        }
      }
      return finalized;
    };

    const appendTemplateBackfillEntries = (target: NativeDisplayEntry[], limit: number): NativeDisplayEntry[] => {
      let attemptsRemaining = 3;
      while (target.length < limit && attemptsRemaining > 0) {
        const missingCount = limit - target.length;
        const extraBackfill = buildNativeCaptionTemplateBackfill({
          contextPacket,
          constraints: channelConfig.hardConstraints,
          missingCount,
          existingCandidates: [
            ...candidates,
            ...(repairResult?.recoveredCandidates ?? []),
            ...target.map((entry) => entry.candidate)
          ]
        });
        if (!extraBackfill?.backfilledCandidates.length) {
          break;
        }
        if (templateBackfill === null) {
          templateBackfill = {
            backfilledCandidates: []
          };
        }
        let addedAny = false;
        templateBackfill.backfilledCandidates.push(...extraBackfill.backfilledCandidates);
        const usedIds = new Set(target.map((entry) => entry.candidate.candidateId));
        const usedTexts = new Set(target.map((entry) => dedupeKeyForCandidate(entry.candidate)));
        for (const candidate of extraBackfill.backfilledCandidates) {
          if (target.length >= limit) {
            break;
          }
          const dedupeKey = dedupeKeyForCandidate(candidate);
          if (usedIds.has(candidate.candidateId) || usedTexts.has(dedupeKey)) {
            continue;
          }
          const constraintCheck = evaluateNativeCaptionConstraintCheck(candidate, channelConfig.hardConstraints);
          candidateConstraintChecks.set(candidate.candidateId, constraintCheck);
          if (!constraintCheck.passed) {
            continue;
          }
          usedIds.add(candidate.candidateId);
          usedTexts.add(dedupeKey);
          target.push({
            candidate,
            constraintCheck,
            displayTier: "template_backfill",
            sourceStage: "templateBackfill",
            displayReason: `Deterministic ${candidate.templateFamily.replace(/_/g, " ")} backfill kept the slot valid.`
          });
          addedAny = true;
        }
        if (!addedAny) {
          break;
        }
        attemptsRemaining -= 1;
      }
      return target;
    };

    let shortlistedDisplayEntries = finalizeDisplayEntries(displayEntries, 5);
    shortlistedDisplayEntries = appendTemplateBackfillEntries(shortlistedDisplayEntries, 5);
    shortlistedDisplayEntries = finalizeDisplayEntries(shortlistedDisplayEntries, 5);
    const winnerEntry =
      shortlistedDisplayEntries.find(
        (entry) =>
          entry.displayTier === "finalist" &&
          entry.candidate.candidateId === qualityCourt.winnerCandidateId
      ) ??
      shortlistedDisplayEntries.find((entry) => entry.displayTier === "finalist") ??
      shortlistedDisplayEntries.find((entry) => entry.displayTier === "recovery") ??
      shortlistedDisplayEntries.find((entry) => entry.displayTier === "template_backfill") ??
      null;

    const captionOptions = shortlistedDisplayEntries.map((entry, index) => {
      const constraintCheck = resolveDisplayConstraintCheck(entry);
      return {
        option: index + 1,
        candidateId: entry.candidate.candidateId,
        laneId: entry.candidate.laneId,
        angle: entry.candidate.angle,
        top: entry.candidate.top,
        bottom: entry.candidate.bottom,
        displayTier: entry.displayTier,
        sourceStage: entry.sourceStage,
        displayReason: entry.displayReason,
        retainedHandle: entry.candidate.retainedHandle,
        constraintCheck
      };
    });
    const captionOptionById = new Map(captionOptions.map((option) => [option.candidateId, option] as const));
    const finalists = shortlistedDisplayEntries.reduce<NativeCaptionFinalist[]>((accumulator, entry) => {
      if (entry.displayTier !== "finalist") {
        return accumulator;
      }
      const optionRecord = captionOptionById.get(entry.candidate.candidateId);
      if (!optionRecord) {
        return accumulator;
      }
      accumulator.push({
        option: optionRecord.option,
        candidateId: entry.candidate.candidateId,
        laneId: entry.candidate.laneId,
        angle: entry.candidate.angle,
        top: entry.candidate.top,
        bottom: entry.candidate.bottom,
        displayTier: "finalist",
        sourceStage: "qualityCourt",
        displayReason: entry.displayReason,
        retainedHandle: entry.candidate.retainedHandle,
        preservedHandle: Boolean(entry.preservedHandle),
        constraintCheck: optionRecord.constraintCheck,
        ...(entry.whyChosen ? { whyChosen: entry.whyChosen } : {})
      });
      return accumulator;
    }, []);

    const winnerOptionRecord = winnerEntry
      ? captionOptionById.get(winnerEntry.candidate.candidateId) ?? null
      : null;
    const winnerTier =
      winnerEntry?.displayTier === "finalist" ||
      winnerEntry?.displayTier === "recovery" ||
      winnerEntry?.displayTier === "template_backfill"
        ? winnerEntry.displayTier
        : null;
    const winner: NativeCaptionWinner | undefined =
      winnerEntry && winnerOptionRecord && winnerTier
        ? {
            candidateId: winnerEntry.candidate.candidateId,
            option: winnerOptionRecord.option,
            reason: winnerEntry.displayReason,
            displayTier: winnerTier,
            sourceStage: winnerEntry.sourceStage,
            constraintCheck: winnerOptionRecord.constraintCheck
          }
        : undefined;
    const finalPick = {
      option: winner?.option ?? 1,
      reason: winner?.reason ?? "Fallback winner selected from the valid display shortlist."
    };
    const winnerCandidateForTitles =
      winner && winnerEntry
        ? {
            candidateId: winnerEntry.candidate.candidateId,
            laneId: winnerEntry.candidate.laneId,
            angle: winnerEntry.candidate.angle,
            top: winnerEntry.candidate.top,
            bottom: winnerEntry.candidate.bottom,
            retainedHandle: winnerEntry.candidate.retainedHandle,
            displayIntent: winnerEntry.candidate.displayIntent
          }
        : null;

    const guardSummary: NativeCaptionGuardSummary = {
      totalCandidateCount:
        candidates.length +
        (repairResult?.recoveredCandidates.length ?? 0) +
        (templateBackfill?.backfilledCandidates.length ?? 0),
      validPoolCount: hardValidator.validPool.length,
      invalidPoolCount: hardValidator.invalidPool.length,
      finalistCount: finalists.length,
      displaySafeExtraCount: captionOptions.filter((option) => option.displayTier === "display_safe_extra").length,
      recoveryCount: captionOptions.filter((option) => option.displayTier === "recovery").length,
      templateBackfillCount: captionOptions.filter((option) => option.displayTier === "template_backfill").length,
      displayShortlistCount: captionOptions.length,
      winnerCandidateId: winner?.candidateId ?? null,
      winnerTier: winner?.displayTier ?? "missing",
      winnerValidity: winner?.constraintCheck?.passed ? "valid" : winner ? "invalid" : "missing",
      degradedSuccess: Boolean(winner && winner.displayTier !== "finalist"),
      dominantHarmlessHandle: contextPacket.audienceWave.dominantHarmlessHandle,
      audienceHandlePreservedInFinalists: finalists.some((finalist) => finalist.preservedHandle),
      recoveryTriggered: qualityCourt.recoveryPlan.required,
      recoveryReason,
      failClosedReason: null
    };

    const captionHighlightsById = await runNativeCaptionHighlightingStage({
      channelConfig,
      captionOptions: captionOptions.map((option) => ({
        candidateId: option.candidateId,
        top: option.top,
        bottom: option.bottom
      })),
      executor: input.executor,
      stageModels: input.stageModels,
      promptConfig,
      warnings,
      promptInputManifests,
      reportProgress,
      recordExecutedStage
    });

    const displayOptionsForTranslation = captionOptions.map((option) => ({
      candidateId: option.candidateId,
      top: option.top,
      bottom: option.bottom
    }));
    const captionTranslationReasoningEffort = resolveStageReasoningEffort(
      "captionTranslation",
      promptConfig
    );
    promptInputManifests.captionTranslation = {
      learningDetail: "none",
      description: null,
      transcript: null,
      frames: null,
      comments: null,
      examples: null,
      channelLearning: null,
      candidates: {
        passedCount: captionOptions.length,
        passedCandidateIds: captionOptions.map((option) => option.candidateId),
        criticScoreCount: finalists.length,
        shortlistCount: captionOptions.length
      },
      stageFlags: ["display shortlist translation", "retry missing items once", "ru review"]
    };
    await reportProgress({
      stageId: "captionTranslation",
      state: "running",
      promptChars: 0,
      reasoningEffort: captionTranslationReasoningEffort,
      detail: "Translating the 5 display captions into Russian."
    });
    const captionTranslationStartedAt = Date.now();
    const captionTranslationPromptTexts: string[] = [];
    const captionTranslationById = new Map<
      string,
      NativeCaptionTranslationArtifact["items"][number]
    >();
    let retriedCaptionCandidateIds: string[] = [];
    let captionTranslationArtifact: NativeCaptionTranslationArtifact | null = null;
    try {
      const translationPrompt = buildNativeCaptionTranslationPrompt({
        displayOptions: displayOptionsForTranslation,
        promptConfig
      });
      captionTranslationPromptTexts.push(translationPrompt);
      const rawTranslation = await input.executor.runJson<unknown>({
        prompt: translationPrompt,
        schema: NATIVE_TRANSLATION_SCHEMA,
        model: input.stageModels?.captionTranslation ?? null,
        reasoningEffort: captionTranslationReasoningEffort
      });
      normalizeNativeCaptionTranslationArtifact(rawTranslation, displayOptionsForTranslation)?.items.forEach(
        (item) => {
          captionTranslationById.set(item.candidateId, item);
        }
      );

      const missingDisplayOptions = displayOptionsForTranslation.filter(
        (option) => !captionTranslationById.has(option.candidateId)
      );
      if (missingDisplayOptions.length > 0) {
        retriedCaptionCandidateIds = missingDisplayOptions.map((option) => option.candidateId);
        try {
          const retryPrompt = buildNativeCaptionTranslationPrompt({
            displayOptions: missingDisplayOptions,
            promptConfig
          });
          captionTranslationPromptTexts.push(retryPrompt);
          const retryRawTranslation = await input.executor.runJson<unknown>({
            prompt: retryPrompt,
            schema: NATIVE_TRANSLATION_SCHEMA,
            model: input.stageModels?.captionTranslation ?? null,
            reasoningEffort: captionTranslationReasoningEffort
          });
          normalizeNativeCaptionTranslationArtifact(retryRawTranslation, missingDisplayOptions)?.items.forEach(
            (item) => {
              captionTranslationById.set(item.candidateId, item);
            }
          );
        } catch (error) {
          warnings.push({
            field: "captionTranslation",
            message:
              error instanceof Error
                ? `Caption translation retry used English fallback for some options: ${error.message}`
                : "Caption translation retry used English fallback for some options."
          });
        }
      }
    } catch (error) {
      warnings.push({
        field: "captionTranslation",
        message:
          error instanceof Error
            ? `Caption translation fallback used: ${error.message}`
            : "Caption translation fallback used."
      });
    }

    const captionTranslationItems = displayOptionsForTranslation.map((option) => {
      const translated = captionTranslationById.get(option.candidateId);
      if (translated) {
        return translated;
      }
      return {
        candidateId: option.candidateId,
        topRu: option.top,
        bottomRu: option.bottom,
        source: "fallback" as const
      };
    });
    const captionFallbackCandidateIds = captionTranslationItems
      .filter((item) => item.source === "fallback")
      .map((item) => item.candidateId);
    captionTranslationArtifact = {
      translatedAt: new Date().toISOString(),
      items: captionTranslationItems,
      coverage: {
        requestedCount: displayOptionsForTranslation.length,
        translatedCount: captionTranslationItems.length - captionFallbackCandidateIds.length,
        fallbackCount: captionFallbackCandidateIds.length,
        fallbackCandidateIds: captionFallbackCandidateIds,
        retriedCandidateIds: retriedCaptionCandidateIds
      }
    };
    if (captionTranslationArtifact.coverage.fallbackCount > 0) {
      warnings.push({
        field: "captionTranslation",
        message: `Russian caption fallback used for ${captionTranslationArtifact.coverage.fallbackCount} display option${captionTranslationArtifact.coverage.fallbackCount === 1 ? "" : "s"}.`
      });
    }
    await reportProgress({
      stageId: "captionTranslation",
      state: "completed",
      durationMs: Date.now() - captionTranslationStartedAt,
      promptChars: captionTranslationPromptTexts.reduce((sum, prompt) => sum + prompt.length, 0),
      reasoningEffort: captionTranslationReasoningEffort,
      detail:
        captionTranslationArtifact.coverage.fallbackCount > 0
          ? `${captionTranslationArtifact.coverage.translatedCount}/${captionTranslationArtifact.coverage.requestedCount} captions translated; ${captionTranslationArtifact.coverage.fallbackCount} used English fallback.`
          : "All 5 display captions translated into Russian."
    });
    recordExecutedStage(
      "captionTranslation",
      joinPromptPasses(captionTranslationPromptTexts),
      "LLM stage: translates the 5 display captions into Russian with one retry for missing items.",
      captionTranslationArtifact,
      { model: input.stageModels?.captionTranslation ?? null }
    );

    const localizedCaptionOptions = captionOptions.map((option) => {
      const translation =
        captionTranslationArtifact?.items.find((item) => item.candidateId === option.candidateId) ?? null;
      return {
        ...option,
        highlights: captionHighlightsById.get(option.candidateId) ?? createEmptyTemplateCaptionHighlights(),
        topRu: translation?.topRu ?? option.top,
        bottomRu: translation?.bottomRu ?? option.bottom
      };
    });
    const localizedFinalists = finalists.map((finalist) => {
      const translation =
        captionTranslationArtifact?.items.find((item) => item.candidateId === finalist.candidateId) ?? null;
      return {
        ...finalist,
        translation: {
          topRu: translation?.topRu ?? finalist.top,
          bottomRu: translation?.bottomRu ?? finalist.bottom,
          translatedAt: captionTranslationArtifact?.translatedAt ?? new Date().toISOString()
        }
      };
    });

    const titlePrompt = buildNativeCaptionTitleWriterPrompt({
      contextPacket,
      channelConfig,
      winner: winnerCandidateForTitles,
      promptConfig
    });
    const titleReasoningEffort = resolveStageReasoningEffort("titleWriter", promptConfig);
    promptInputManifests.titleWriter = {
      learningDetail: "compact",
      description: null,
      transcript: null,
      frames: null,
      comments: null,
      examples: null,
      channelLearning: compactChannelLearning.usage,
      candidates: {
        passedCount: finalists.length,
        passedCandidateIds: finalists.map((finalist) => finalist.candidateId),
        criticScoreCount: finalists.length,
        shortlistCount: captionOptions.length
      },
      stageFlags: ["winner-only titles", "bilingual output", "retry missing items once", "channel learning"]
    };
    await reportProgress({
      stageId: "titleWriter",
      state: "running",
      promptChars: titlePrompt.length,
      reasoningEffort: titleReasoningEffort,
      detail: "Writing winner titles."
    });
    const titleStartedAt = Date.now();
    const titlePromptTexts: string[] = [titlePrompt];
    let titleOptions: NativeCaptionTitleOption[] = [];
    let retriedTitleOptions: number[] = [];
    try {
      const rawTitles = await input.executor.runJson<unknown>({
        prompt: titlePrompt,
        schema: NATIVE_TITLE_WRITER_SCHEMA,
        model: input.stageModels?.titleWriter ?? null,
        reasoningEffort: titleReasoningEffort
      });
      titleOptions = normalizeNativeCaptionTitleOptions(rawTitles);
      const missingTitleOptions = Array.from({ length: 5 }, (_, index) => index + 1).filter((option) => {
        const titleOption = titleOptions.find((entry) => entry.option === option);
        return !titleOption?.title || !titleOption?.titleRu;
      });
      if (missingTitleOptions.length > 0) {
        retriedTitleOptions = missingTitleOptions;
        try {
          titlePromptTexts.push(titlePrompt);
          const retryRawTitles = await input.executor.runJson<unknown>({
            prompt: titlePrompt,
            schema: NATIVE_TITLE_WRITER_SCHEMA,
            model: input.stageModels?.titleWriter ?? null,
            reasoningEffort: titleReasoningEffort
          });
          const retriedOptions = normalizeNativeCaptionTitleOptions(retryRawTitles);
          const retryByOption = new Map(retriedOptions.map((entry) => [entry.option, entry] as const));
          titleOptions = titleOptions.map((entry) => {
            if (entry.titleRu) {
              return entry;
            }
            const retried = retryByOption.get(entry.option);
            return retried?.titleRu ? retried : entry;
          });
          for (const option of missingTitleOptions) {
            if (!titleOptions.some((entry) => entry.option === option)) {
              const retried = retryByOption.get(option);
              if (retried) {
                titleOptions.push(retried);
              }
            }
          }
        } catch (error) {
          warnings.push({
            field: "titleWriter",
            message:
              error instanceof Error
                ? `Title translation fallback used for some options: ${error.message}`
                : "Title translation fallback used for some options."
          });
        }
      }
    } catch (error) {
      warnings.push({
        field: "titleWriter",
        message:
          error instanceof Error ? `Title writer fallback used: ${error.message}` : "Title writer fallback used."
      });
    }
    const seedTitle = input.videoContext.title.trim() || winnerCandidateForTitles?.top || "What changed here";
    const titleByOption = new Map(titleOptions.map((entry) => [entry.option, entry] as const));
    const titleFallbackOptions: number[] = [];
    titleOptions = Array.from({ length: 5 }, (_, index) => {
      const option = index + 1;
      const existing = titleByOption.get(option) ?? null;
      const fallbackTitle = `${seedTitle.replace(/\s+/g, " ").trim().slice(0, 70)}${index === 0 ? "" : ` ${option}`}`.trim();
      const title = normalizeAllCapsTitleText(existing?.title?.trim() || fallbackTitle || `Option ${option}`);
      const titleRu = normalizeAllCapsTitleText(existing?.titleRu?.trim() || title);
      const titleRuSource = existing?.titleRu?.trim() ? existing.titleRuSource ?? "llm" : "fallback";
      if (titleRuSource === "fallback") {
        titleFallbackOptions.push(option);
      }
      return {
        option,
        title,
        titleRu,
        titleRuSource
      };
    });
    const titleTranslationCoverage = {
      requestedCount: 5,
      translatedCount: 5 - titleFallbackOptions.length,
      fallbackCount: titleFallbackOptions.length,
      fallbackOptions: titleFallbackOptions,
      retriedOptions: retriedTitleOptions
    };
    if (titleTranslationCoverage.fallbackCount > 0) {
      warnings.push({
        field: "titleWriter",
        message: `Russian title fallback used for ${titleTranslationCoverage.fallbackCount} title option${titleTranslationCoverage.fallbackCount === 1 ? "" : "s"}.`
      });
    }
    await reportProgress({
      stageId: "titleWriter",
      state: "completed",
      durationMs: Date.now() - titleStartedAt,
      promptChars: titlePromptTexts.reduce((sum, prompt) => sum + prompt.length, 0),
      reasoningEffort: titleReasoningEffort,
      detail:
        titleTranslationCoverage.fallbackCount > 0
          ? `${titleTranslationCoverage.translatedCount}/5 bilingual titles generated; ${titleTranslationCoverage.fallbackCount} used English fallback.`
          : "Winner titles generated in English and Russian."
    });
    recordExecutedStage(
      "titleWriter",
      joinPromptPasses(titlePromptTexts),
      "LLM stage: writes 5 titles for the winning native caption.",
      {
        titleOptions,
        translationCoverage: titleTranslationCoverage
      },
      { model: input.stageModels?.titleWriter ?? null }
    );

    const seo = await runStage2SeoStage({
      enabled: shouldRunStage2SeoGeneration(input.stageModels),
      sourceUrl: input.videoContext.sourceUrl,
      title: input.videoContext.title,
      comments: input.videoContext.comments,
      omittedCommentsCount: 0,
      userInstruction: input.videoContext.userInstruction,
      stage2Output: {
        inputAnalysis: {
          visualAnchors: analyzerOutput.visualAnchors.slice(0, 3),
          commentVibe: analyzerOutput.commentVibe,
          keyPhraseToAdapt:
            analyzerOutput.commentLanguageCues[0] ??
            contextPacket.audienceWave.safeReusableCues[0] ??
            contextPacket.strategy.hookSeeds[0] ??
            analyzerOutput.visualAnchors[0] ??
            input.videoContext.title
        },
        captionOptions: localizedCaptionOptions,
        finalPick
      },
      executor: input.executor,
      stageModels: input.stageModels,
      promptConfig,
      warnings,
      promptInputManifests,
      reportProgress,
      recordExecutedStage
    });

    const rawPromptStages = executedPromptStages.map((stage) =>
      buildPromptStageDiagnostics({
        stageId: stage.stageId,
        promptConfig,
        promptText: stage.promptText,
        includePromptText: true,
        usesImages: stage.usesImages,
        model: stage.model,
        summary: stage.summary,
        serializedResultBytes: stage.serializedResultBytes,
        estimatedOutputTokens: stage.estimatedOutputTokens,
        inputManifest: promptInputManifests[stage.stageId]
      })
    );
    const summaryPromptStages = executedPromptStages.map((stage) =>
      buildPromptStageDiagnostics({
        stageId: stage.stageId,
        promptConfig,
        promptText: stage.promptText,
        includePromptText: false,
        usesImages: stage.usesImages,
        model: stage.model,
        summary: stage.summary,
        serializedResultBytes: stage.serializedResultBytes,
        estimatedOutputTokens: stage.estimatedOutputTokens,
        inputManifest: promptInputManifests[stage.stageId]
      })
    );
    const tokenUsageStages = rawPromptStages.map((stage) => ({
      stageId: stage.stageId,
      promptChars: stage.promptChars,
      estimatedInputTokens: stage.estimatedInputTokens ?? null,
      estimatedOutputTokens: stage.estimatedOutputTokens ?? null,
      serializedResultBytes: stage.serializedResultBytes ?? null,
      persistedPayloadBytes: stage.persistedPayloadBytes ?? null
    }));
    const tokenUsage: Stage2TokenUsage = {
      stages: tokenUsageStages,
      totalPromptChars: tokenUsageStages.reduce((sum, stage) => sum + (stage.promptChars ?? 0), 0),
      totalEstimatedInputTokens: tokenUsageStages.reduce(
        (sum, stage) => sum + (stage.estimatedInputTokens ?? 0),
        0
      ),
      totalEstimatedOutputTokens: tokenUsageStages.reduce(
        (sum, stage) => sum + (stage.estimatedOutputTokens ?? 0),
        0
      ),
      totalSerializedResultBytes: tokenUsageStages.reduce(
        (sum, stage) => sum + (stage.serializedResultBytes ?? 0),
        0
      ),
      totalPersistedPayloadBytes: tokenUsageStages.reduce(
        (sum, stage) => sum + (stage.persistedPayloadBytes ?? 0),
        0
      )
    };
    const resolvedWorkerProfile = getResolvedStage2WorkerProfile(channelConfig);
    const diagnostics: Stage2Diagnostics = {
      channel: {
        channelId: channelConfig.channelId,
        name: channelConfig.name,
        username: channelConfig.username,
        workerProfile: {
          requestedId: resolvedWorkerProfile.requestedId,
          resolvedId: resolvedWorkerProfile.resolvedId,
          label: resolvedWorkerProfile.label,
          description: resolvedWorkerProfile.description,
          summary: resolvedWorkerProfile.summary,
          origin: resolvedWorkerProfile.origin
        },
        examplesSource: channelConfig.examplesSource,
        hardConstraints: channelConfig.hardConstraints,
        styleProfile: channelConfig.styleProfile,
        editorialMemory: channelConfig.editorialMemory,
        workspaceCorpusCount,
        activeCorpusCount: 0
      },
      selection: {
        clipType: selectorFallback.clipType,
        primaryAngle: selectorFallback.primaryAngle,
        secondaryAngles: selectorFallback.secondaryAngles,
        rankedAngles: selectorFallback.rankedAngles,
        coreTrigger: selectorFallback.coreTrigger,
        humanStake: selectorFallback.humanStake,
        narrativeFrame: selectorFallback.narrativeFrame,
        whyViewerCares: selectorFallback.whyViewerCares,
        topStrategy: selectorFallback.topStrategy,
        bottomEnergy: selectorFallback.bottomEnergy,
        whyOldV6WouldWorkHere: selectorFallback.whyOldV6WouldWorkHere,
        failureModes: selectorFallback.failureModes,
        writerBrief: selectorFallback.writerBrief,
        rationale: selectorFallback.rationale ?? null,
        selectedExampleIds: []
      },
      analysis: {
        visualAnchors: analyzerOutput.visualAnchors,
        specificNouns: analyzerOutput.specificNouns,
        visibleActions: analyzerOutput.visibleActions,
        firstSecondsSignal: analyzerOutput.firstSecondsSignal,
        sceneBeats: analyzerOutput.sceneBeats,
        revealMoment: analyzerOutput.revealMoment,
        lateClipChange: analyzerOutput.lateClipChange,
        whyViewerCares: analyzerOutput.whyViewerCares,
        bestBottomEnergy: analyzerOutput.bestBottomEnergy,
        commentVibe: analyzerOutput.commentVibe,
        commentConsensusLane: analyzerOutput.commentConsensusLane,
        commentJokeLane: analyzerOutput.commentJokeLane,
        commentDissentLane: analyzerOutput.commentDissentLane,
        commentSuspicionLane: analyzerOutput.commentSuspicionLane,
        slangToAdapt: analyzerOutput.slangToAdapt,
        commentLanguageCues: analyzerOutput.commentLanguageCues,
        hiddenDetail: analyzerOutput.hiddenDetail,
        genericRisks: analyzerOutput.genericRisks,
        uncertaintyNotes: analyzerOutput.uncertaintyNotes,
        rawSummary: analyzerOutput.rawSummary
      },
      sourceContext: buildStage2SourceContextSummary(input.videoContext),
      effectivePrompting: {
        promptStages: debugMode === "raw" ? rawPromptStages : summaryPromptStages
      },
      examples: {
        source: channelConfig.examplesSource,
        workspaceCorpusCount,
        activeCorpusCount: 0,
        selectorCandidateCount: 0,
        retrievalConfidence: nativeExamplesAssessment.retrievalConfidence,
        examplesMode: nativeExamplesAssessment.examplesMode,
        explanation: nativeExamplesAssessment.explanation,
        evidence: nativeExamplesAssessment.evidence,
        retrievalWarning: nativeExamplesAssessment.retrievalWarning,
        examplesRoleSummary: nativeExamplesAssessment.examplesRoleSummary,
        primaryDriverSummary: nativeExamplesAssessment.primaryDriverSummary,
        primaryDrivers: nativeExamplesAssessment.primaryDrivers,
        channelStylePriority: nativeExamplesAssessment.channelStylePriority,
        editorialMemoryPriority: nativeExamplesAssessment.editorialMemoryPriority,
        availableExamples: [],
        selectedExamples: []
      },
      nativeCaptionV3: {
        contextPacket,
        candidateBatch: candidates,
        hardValidator,
        qualityCourt,
        repair: repairResult,
        templateBackfill,
        guardSummary,
        displayOptions: localizedCaptionOptions,
        titleWriter: {
          titleOptions,
          translationCoverage: titleTranslationCoverage
        },
        translation: captionTranslationArtifact
      }
    };
    const output: ViralShortsStage2Result = {
      inputAnalysis: {
        visualAnchors: analyzerOutput.visualAnchors.slice(0, 3),
        commentVibe: analyzerOutput.commentVibe,
        keyPhraseToAdapt:
          analyzerOutput.commentLanguageCues[0] ??
          contextPacket.audienceWave.safeReusableCues[0] ??
          contextPacket.strategy.hookSeeds[0] ??
          analyzerOutput.visualAnchors[0] ??
          input.videoContext.title
      },
      captionOptions: localizedCaptionOptions,
      finalists: localizedFinalists,
      titleOptions,
      finalPick,
      winner,
      pipeline: {
        channelId: channelConfig.channelId,
        workerProfile: {
          requestedId: resolvedWorkerProfile.requestedId,
          resolvedId: resolvedWorkerProfile.resolvedId,
          label: resolvedWorkerProfile.label,
          description: resolvedWorkerProfile.description,
          summary: resolvedWorkerProfile.summary,
          origin: resolvedWorkerProfile.origin
        },
        mode: input.reusedContextPacket ? "regenerate" : "codex_pipeline",
        execution: pipelineExecution,
        selectorOutput: selectorFallback,
        availableExamplesCount: 0,
        selectedExamplesCount: 0,
        retrievalConfidence: nativeExamplesAssessment.retrievalConfidence,
        examplesMode: nativeExamplesAssessment.examplesMode,
        retrievalExplanation: nativeExamplesAssessment.explanation,
        contextPacket,
        nativeCaptionV3: {
          contextPacket,
          candidateBatch: candidates,
          hardValidator,
          qualityCourt,
          repair: repairResult,
          templateBackfill,
          guardSummary,
          displayOptions: localizedCaptionOptions,
          titleWriter: {
            titleOptions,
            translationCoverage: titleTranslationCoverage
          },
          translation: captionTranslationArtifact
        }
      },
      diagnostics
    };
    return {
      output,
      seo,
      warnings,
      diagnostics,
      rawDebugArtifact:
        debugMode === "raw"
          ? {
              kind: "stage2-run-debug",
              runId: "pending",
              createdAt: new Date().toISOString(),
              promptStages: rawPromptStages
            }
          : null,
      tokenUsage
    };
  }

  async runPipeline(input: {
    channel: {
      id: string;
      name: string;
      username: string;
      stage2WorkerProfileId?: string | null;
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
      stage2StyleProfile?: Stage2RuntimeChannelConfig["styleProfile"];
      editorialMemory?: Stage2RuntimeChannelConfig["editorialMemory"];
      templateHighlightProfile?: Stage2RuntimeChannelConfig["templateHighlightProfile"];
    };
    workspaceStage2ExamplesCorpusJson: string | null | undefined;
    videoContext: ViralShortsVideoContext;
    imagePaths: string[];
    executor: JsonStageExecutor;
    stageModels?: Partial<Stage2PipelineModelMap>;
    promptConfig?: Stage2PromptConfig | null;
    debugMode?: Stage2DebugMode;
    stage2VNextEnabled?: boolean;
    onProgress?: (event: PipelineProgressEvent) => void | Promise<void>;
  }): Promise<RunPipelineResult> {
    const warnings: StageWarning[] = [];
    const promptConfig = normalizeStage2PromptConfig(input.promptConfig);
    const debugMode: Stage2DebugMode = input.debugMode === "raw" ? "raw" : "summary";
    const featureFlags = resolveStage2VNextFlagSnapshot(input.stage2VNextEnabled);
    const stage2VNextEnabled = featureFlags.STAGE2_VNEXT_ENABLED;
    const pipelineVersion = stage2VNextEnabled ? "vnext" : "legacy";
    const workerBuild = getStage2WorkerBuildInfo();
    const stageChainVersion = resolveStage2StageChainVersion(pipelineVersion);
    const pipelineExecution = buildStage2PipelineExecutionSnapshot({
      featureFlags,
      pipelineVersion,
      pathVariant:
        pipelineVersion === "vnext" ? "vnext_pipeline_v1" : "legacy_multistage_v1",
      stageChainVersion,
      workerBuild,
      resolvedAt: new Date().toISOString()
    });
    if (pipelineExecution.legacyFallbackReason) {
      warnings.push({
        field: "stage2_pipeline_mode",
        message: pipelineExecution.legacyFallbackReason
      });
    }
    const candidateLifecycle = stage2VNextEnabled ? new CandidateLifecycle() : null;
    const executedPromptStages: ExecutedPromptStageRecord[] = [];
    const promptInputManifests: Partial<
      Record<Stage2PipelineStageId, Stage2DiagnosticsPromptStage["inputManifest"]>
    > = {};
    const recordExecutedStage = (
      stageId: Stage2PipelineStageId,
      promptText: string,
      summary: string,
      resultPayload: unknown,
      options?: { usesImages?: boolean; model?: string | null }
    ) => {
      const serializedResultBytes = measureSerializedBytes(resultPayload);
      const nextRecord = {
        stageId,
        promptText,
        summary,
        usesImages: options?.usesImages,
        model: options?.model ?? null,
        serializedResultBytes,
        estimatedOutputTokens: estimateTokensFromChars(serializedResultBytes)
      };
      const existingIndex = executedPromptStages.findIndex((stage) => stage.stageId === stageId);
      if (existingIndex >= 0) {
        executedPromptStages.splice(existingIndex, 1, nextRecord);
        return;
      }
      executedPromptStages.push(nextRecord);
    };
    const reportProgress = async (event: PipelineProgressEvent): Promise<void> => {
      try {
        await input.onProgress?.(event);
      } catch {
        return;
      }
    };

    const { corpus: availableExamples, workspaceCorpusCount, source } = this.resolveExamplesCorpus({
      channel: {
        id: input.channel.id,
        name: input.channel.name,
        stage2ExamplesConfig: input.channel.stage2ExamplesConfig
      },
      workspaceStage2ExamplesCorpusJson: input.workspaceStage2ExamplesCorpusJson
    });
    const channelConfig = normalizeChannelConfig({
      ...input.channel,
      resolvedExamplesSource: source
    });

    const heuristicOutput = heuristicAnalyzer({
      title: input.videoContext.title,
      description: input.videoContext.description,
      transcript: input.videoContext.transcript,
      comments: input.videoContext.comments.map((comment) => comment.text),
      visualAnchors: input.videoContext.frameDescriptions
    });

    const analyzerPrompt = buildAnalyzerPrompt(
      channelConfig,
      input.videoContext,
      heuristicOutput,
      promptConfig
    );
    const analyzerReasoningEffort = resolveStageReasoningEffort("analyzer", promptConfig);
    await reportProgress({
      stageId: "analyzer",
      state: "running",
      promptChars: analyzerPrompt.length,
      reasoningEffort: analyzerReasoningEffort,
      detail: `Разбираем ${input.imagePaths.length} sampled frames, transcript и комментарии как короткую последовательность.`
    });

    let analyzerOutput = heuristicOutput;
    const analyzerStartedAt = Date.now();
    try {
      const analyzerRaw = await input.executor.runJson<unknown>({
        prompt: analyzerPrompt,
        schema: ANALYZER_SCHEMA,
        imagePaths: input.imagePaths,
        model: input.stageModels?.analyzer ?? null,
        reasoningEffort: analyzerReasoningEffort
      });
      analyzerOutput = normalizeAnalyzerOutput(analyzerRaw, heuristicOutput);
      await reportProgress({
        stageId: "analyzer",
        state: "completed",
        durationMs: Date.now() - analyzerStartedAt,
        promptChars: analyzerPrompt.length,
        reasoningEffort: analyzerReasoningEffort,
        detail: `Нашли ${analyzerOutput.visualAnchors.length} visual anchors across ${input.imagePaths.length} sampled beats.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analyzer fallback used.";
      warnings.push({
        field: "analyzer",
        message: error instanceof Error ? `Analyzer fallback used: ${error.message}` : "Analyzer fallback used."
      });
      await reportProgress({
        stageId: "analyzer",
        state: "completed",
        durationMs: Date.now() - analyzerStartedAt,
        promptChars: analyzerPrompt.length,
        reasoningEffort: analyzerReasoningEffort,
        detail: `Fallback used: ${message}`
      });
    }
    if (input.videoContext.comments.length > 0) {
      analyzerOutput = applyCommentIntelligenceBoost(
        analyzerOutput,
        input.videoContext.comments
      );
    } else {
      analyzerOutput = applyNoCommentsTruthfulnessGuard(analyzerOutput, false);
      warnings.push({
        field: "comments",
        message:
          "Comments were unavailable for this run, so Stage 2 leaned on the visual sequence, transcript, title, and description instead of a real audience-comment read."
      });
    }
    recordExecutedStage(
      "analyzer",
      analyzerPrompt,
      "LLM stage: reads frames, comments, title and description to produce the visual analysis.",
      analyzerOutput,
      { usesImages: true, model: input.stageModels?.analyzer ?? null }
    );

    const queryText = buildCorpusQueryText(input.videoContext, analyzerOutput);
    const selectorPool = buildSelectorExamplePool({
      examples: availableExamples,
      queryText
    });
    const exampleRouting =
      stage2VNextEnabled
        ? decideExampleRouting({
            availableExamples: selectorPool.selectorExamples,
            assessment: selectorPool.assessment
          })
        : null;
    if (exampleRouting) {
      const routingIssues = validateExampleRoutingDecisionSchema(exampleRouting);
      if (routingIssues.length > 0) {
        throw new Error(
          `Stage 2 vNext example router emitted an invalid contract: ${routingIssues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join(" ")}`
        );
      }
    }
    const selectorPromptExamples =
      exampleRouting === null
        ? selectorPool.selectorExamples
        : applyExampleRoutingDecision({
            availableExamples: selectorPool.selectorExamples,
            decision: exampleRouting
          });
    if (selectorPool.selectorExamples.length < availableExamples.length) {
      const poolNotes = [
        `Selector prompt used ${selectorPool.selectorExamples.length} curated examples out of ${availableExamples.length} active corpus entries.`
      ];
      if (selectorPool.stats.filteredOutForSignalCount > 0) {
        poolNotes.push(`${selectorPool.stats.filteredOutForSignalCount} low-signal examples were excluded.`);
      }
      if (selectorPool.stats.trimmedByLimitCount > 0) {
        poolNotes.push(`${selectorPool.stats.trimmedByLimitCount} more examples stayed outside the prompt pool to keep latency bounded.`);
      }
      warnings.push({
        field: "examples",
        message: poolNotes.join(" ")
      });
    }
    if (selectorPool.assessment.retrievalWarning) {
      warnings.push({
        field: "retrieval",
        message: selectorPool.assessment.retrievalWarning
      });
    }
    if (exampleRouting?.mode === "disabled") {
      warnings.push({
        field: "examples",
        message:
          "Stage 2 vNext disabled downstream example usage for this run because retrieval confidence was below threshold."
      });
    }

    const selectorPrompt = buildSelectorPrompt({
      channelConfig,
      videoContext: input.videoContext,
      analyzerOutput,
      availableExamples: selectorPromptExamples,
      examplesAssessment: selectorPool.assessment,
      promptConfig
    });
    const selectorReasoningEffort = resolveStageReasoningEffort("selector", promptConfig);
    await reportProgress({
      stageId: "selector",
      state: "running",
      promptChars: selectorPrompt.length,
      reasoningEffort: selectorReasoningEffort,
      detail: "Selector выбирает angle и релевантные examples."
    });
    const selectorStartedAt = Date.now();
    const selectorFallback = fallbackSelectorOutput(
      channelConfig,
      analyzerOutput,
      selectorPromptExamples,
      input.videoContext,
      selectorPool.assessment,
      selectorPool.exampleInsights
    );
    let selectorOutput = applyExamplesAssessmentToSelectorOutput(
      selectorFallback,
      selectorPool.assessment
    );
    try {
      const selectorRaw = await input.executor.runJson<unknown>({
        prompt: selectorPrompt,
        schema: SELECTOR_SCHEMA,
        model: input.stageModels?.selector ?? null,
        reasoningEffort: selectorReasoningEffort
      });
      selectorOutput = applyExamplesAssessmentToSelectorOutput(
        normalizeSelectorOutput(
          selectorRaw,
          selectorFallback,
          selectorPromptExamples,
          selectorPool.assessment,
          selectorPool.exampleInsights,
          analyzerOutput
        ),
        selectorPool.assessment
      );
      await reportProgress({
        stageId: "selector",
        state: "completed",
        durationMs: Date.now() - selectorStartedAt,
        promptChars: selectorPrompt.length,
        reasoningEffort: selectorReasoningEffort,
        detail: `${selectorOutput.clipType} -> ${selectorOutput.rankedAngles.map((item) => item.angle).join(", ")}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Selector fallback used.";
      warnings.push({
        field: "selector",
        message: error instanceof Error ? `Selector fallback used: ${error.message}` : "Selector fallback used."
      });
      await reportProgress({
        stageId: "selector",
        state: "completed",
        durationMs: Date.now() - selectorStartedAt,
        promptChars: selectorPrompt.length,
        reasoningEffort: selectorReasoningEffort,
        detail: `Fallback used: ${message}`
      });
    }
    selectorOutput = applyExampleRoutingToSelectorOutput({
      selectorOutput,
      availableExamples: selectorPool.selectorExamples,
      exampleRouting
    });
    recordExecutedStage(
      "selector",
      selectorPrompt,
      "LLM stage: chooses clip angle(s) and the most relevant examples from the active corpus.",
      selectorOutput,
      { model: input.stageModels?.selector ?? null }
    );

    const writerPrompt = buildWriterPrompt({
      channelConfig,
      analyzerOutput,
      selectorOutput,
      examplesAssessment: selectorPool.assessment,
      userInstruction: input.videoContext.userInstruction,
      promptConfig
    });
    const writerReasoningEffort = resolveStageReasoningEffort("writer", promptConfig);
    await reportProgress({
      stageId: "writer",
      state: "running",
      promptChars: writerPrompt.length,
      reasoningEffort: writerReasoningEffort,
      detail: "Drafting 20 caption candidates."
    });
    const writerStartedAt = Date.now();
    let writerRaw: unknown;
    try {
      writerRaw = await input.executor.runJson<unknown>({
        prompt: writerPrompt,
        schema: CANDIDATES_SCHEMA,
        model: input.stageModels?.writer ?? null,
        reasoningEffort: writerReasoningEffort
      });
    } catch (error) {
      const message = formatStageFailure("Writer stage", error);
      await reportProgress({
        stageId: "writer",
        state: "failed",
        durationMs: Date.now() - writerStartedAt,
        promptChars: writerPrompt.length,
        reasoningEffort: writerReasoningEffort,
        detail: message
      });
      throw new Error(message);
    }
    const writerPromptTexts = [writerPrompt];
    const writerPassCandidateCounts: number[] = [];
    let allGeneratedCandidates = normalizeCandidates(writerRaw, selectorOutput);
    writerPassCandidateCounts.push(allGeneratedCandidates.length);
    if (allGeneratedCandidates.length === 0) {
      const message = "Writer stage returned no usable caption candidates.";
      await reportProgress({
        stageId: "writer",
        state: "failed",
        durationMs: Date.now() - writerStartedAt,
        promptChars: writerPrompt.length,
        reasoningEffort: writerReasoningEffort,
        detail: message
      });
      throw new Error(message);
    }
    await reportProgress({
      stageId: "writer",
      state: "completed",
      durationMs: Date.now() - writerStartedAt,
      promptChars: writerPrompt.length,
      reasoningEffort: writerReasoningEffort,
      detail: `${allGeneratedCandidates.length} candidates drafted.`
    });
    recordExecutedStage(
      "writer",
      joinPromptPasses(writerPromptTexts),
      "LLM stage: drafts 20 caption options using selector-chosen examples.",
      allGeneratedCandidates,
      { model: input.stageModels?.writer ?? null }
    );

    let activeCandidates = allGeneratedCandidates;
    let vnextSemanticDrafts: Stage2VNextSemanticDraft[] = [];
    let vnextPackedBridgeEntries: Stage2VNextPackedBridgeEntry[] = [];
    if (stage2VNextEnabled) {
      const transitionTimestamp = new Date().toISOString();
      vnextSemanticDrafts = buildStage2VNextSemanticDrafts(allGeneratedCandidates);
      const semanticIssues = validateSemanticDraftListSchema(vnextSemanticDrafts);
      if (semanticIssues.length > 0) {
        throw new Error(
          `Stage 2 vNext semantic draft contract failed: ${semanticIssues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join(" ")}`
        );
      }
      for (const draft of vnextSemanticDrafts) {
        candidateLifecycle?.registerSemanticDraft({
          candidateId: draft.candidateId,
          createdAt: transitionTimestamp
        });
      }

      vnextPackedBridgeEntries = buildStage2VNextPackedBridgeEntries({
        candidates: allGeneratedCandidates,
        constraints: channelConfig.hardConstraints
      });
      const packedIssues = validatePackedCandidateListSchema(
        vnextPackedBridgeEntries.map((entry) => entry.packedCandidate)
      );
      if (packedIssues.length > 0) {
        throw new Error(
          `Stage 2 vNext packed candidate contract failed: ${packedIssues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join(" ")}`
        );
      }

      for (const entry of vnextPackedBridgeEntries) {
        candidateLifecycle?.transition({
          candidateId: entry.packedCandidate.candidateId,
          toState: entry.valid ? "packed_valid" : "packed_invalid",
          stageId: "constraint_packer",
          at: transitionTimestamp,
          reason: entry.valid ? null : entry.issues.join(" "),
          repairCount: entry.packedCandidate.repairCount
        });
        if (!entry.valid) {
          candidateLifecycle?.transition({
            candidateId: entry.packedCandidate.candidateId,
            toState: "hard_rejected",
            stageId: "constraint_packer",
            at: transitionTimestamp,
            reason: entry.issues.join(" "),
            repairCount: entry.packedCandidate.repairCount
          });
        }
      }

      activeCandidates = vnextPackedBridgeEntries
        .filter((entry) => entry.valid)
        .map((entry) => entry.candidate);
      if (activeCandidates.length < REQUIRED_FINAL_SHORTLIST_COUNT) {
        warnings.push({
          field: "constraint_packer",
          message:
            `Stage 2 vNext initial pass produced only ${activeCandidates.length} packed-valid candidates. ` +
            "A regeneration pass will run if critic survivors stay below the minimum shortlist."
        });
      }
    }

    const criticPrompt = buildCriticPrompt({
      channelConfig,
      analyzerOutput,
      selectorOutput,
      examplesAssessment: selectorPool.assessment,
      candidates: activeCandidates,
      promptConfig
    });
    const criticReasoningEffort = resolveStageReasoningEffort("critic", promptConfig);
    await reportProgress({
      stageId: "critic",
      state: "running",
      promptChars: criticPrompt.length,
      reasoningEffort: criticReasoningEffort,
      detail: "Оцениваем и режем слабые варианты."
    });
    const criticStartedAt = Date.now();
    const criticPromptTexts = [criticPrompt];
    let criticScores: CriticScore[];
    try {
      const criticRaw = await input.executor.runJson<unknown>({
        prompt: criticPrompt,
        schema: CRITIC_SCHEMA,
        model: input.stageModels?.critic ?? null,
        reasoningEffort: criticReasoningEffort
      });
      criticScores = normalizeCriticScores(criticRaw, activeCandidates);
      if (stage2VNextEnabled) {
        criticScores = applyStage2VNextEditorialTasteGate({
          criticScores,
          candidates: activeCandidates
        });
      }
      await reportProgress({
        stageId: "critic",
        state: "completed",
        durationMs: Date.now() - criticStartedAt,
        promptChars: criticPrompt.length,
        reasoningEffort: criticReasoningEffort,
        detail: `${criticScores.filter((score) => score.keep).length} candidates kept for rewrite.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Critic fallback used.";
      warnings.push({
        field: "critic",
        message: error instanceof Error ? `Critic fallback used: ${error.message}` : "Critic fallback used."
      });
      criticScores = normalizeCriticScores([], activeCandidates);
      if (stage2VNextEnabled) {
        criticScores = applyStage2VNextEditorialTasteGate({
          criticScores,
          candidates: activeCandidates
        });
      }
      await reportProgress({
        stageId: "critic",
        state: "completed",
        durationMs: Date.now() - criticStartedAt,
        promptChars: criticPrompt.length,
        reasoningEffort: criticReasoningEffort,
        detail: `Fallback used: ${message}`
      });
    }
    const summarizeWriterStage = () =>
      writerPassCandidateCounts.length <= 1
        ? "LLM stage: drafts 20 caption options using selector-chosen examples."
        : `LLM stage: drafts caption options using selector-chosen examples, then runs ${writerPassCandidateCounts.length - 1} regeneration pass to replace critic shortfall without reserve backfill.`;
    const summarizeCriticStage = () =>
      criticPromptTexts.length <= 1
        ? "LLM stage: scores the writer candidates and decides what survives."
        : `LLM stage: scores the writer candidates and reruns the quality court on regeneration output before rewrite.`;
    recordExecutedStage("writer", joinPromptPasses(writerPromptTexts), summarizeWriterStage(), allGeneratedCandidates, {
      model: input.stageModels?.writer ?? null
    });
    recordExecutedStage("critic", joinPromptPasses(criticPromptTexts), summarizeCriticStage(), criticScores, {
      model: input.stageModels?.critic ?? null
    });

    let vnextJudgeCards: JudgeScoreCard[] = [];
    if (stage2VNextEnabled) {
      const transitionTimestamp = new Date().toISOString();
      vnextJudgeCards = buildStage2VNextJudgeCards(criticScores);
      const judgeIssues = validateJudgeScoreCardListSchema(vnextJudgeCards);
      if (judgeIssues.length > 0) {
        throw new Error(
          `Stage 2 vNext judge card contract failed: ${judgeIssues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join(" ")}`
        );
      }

      for (const score of criticScores) {
        candidateLifecycle?.transition({
          candidateId: score.candidateId,
          toState: "judged",
          stageId: "quality_court",
          at: transitionTimestamp,
          reason: null
        });
        candidateLifecycle?.transition({
          candidateId: score.candidateId,
          toState: score.keep ? "survivor" : "hard_rejected",
          stageId: "quality_court",
          at: transitionTimestamp,
          reason: score.keep ? null : score.issues.join(" ") || "legacy_critic_reject"
        });
      }
    }

    let rewriterCandidatePool = buildRewriterCandidatePool({
      candidates: activeCandidates,
      criticScores,
      constraints: channelConfig.hardConstraints,
      allowReserveBackfill: !stage2VNextEnabled
    });
    if (stage2VNextEnabled && rewriterCandidatePool.candidates.length < REQUIRED_FINAL_SHORTLIST_COUNT) {
      const recoveryContext = buildCriticShortfallRecoveryContext({
        passNumber: 1,
        targetAdditionalSurvivors: REQUIRED_FINAL_SHORTLIST_COUNT - rewriterCandidatePool.candidates.length,
        candidates: activeCandidates,
        criticScores
      });
      warnings.push({
        field: "quality_court",
        message:
          `Stage 2 vNext quality court kept only ${rewriterCandidatePool.candidates.length} candidates on the initial pass. ` +
          "Running one regeneration pass instead of using reserve backfill."
      });

      const recoveryWriterPrompt = buildWriterPrompt({
        channelConfig,
        analyzerOutput,
        selectorOutput,
        examplesAssessment: selectorPool.assessment,
        userInstruction: input.videoContext.userInstruction,
        recoveryContext,
        promptConfig
      });
      writerPromptTexts.push(recoveryWriterPrompt);
      let recoveryWriterRaw: unknown;
      try {
        recoveryWriterRaw = await input.executor.runJson<unknown>({
          prompt: recoveryWriterPrompt,
          schema: CANDIDATES_SCHEMA,
          model: input.stageModels?.writer ?? null,
          reasoningEffort: writerReasoningEffort
        });
      } catch (error) {
        throw new Error(formatStageFailure("Stage 2 vNext recovery writer stage", error));
      }
      const recoveryCandidates = normalizeCandidates(recoveryWriterRaw, selectorOutput, {
        candidateIdPrefix: `regen_${recoveryContext.passNumber}_`,
        forbiddenCandidateIds: new Set(allGeneratedCandidates.map((candidate) => candidate.candidateId))
      });
      writerPassCandidateCounts.push(recoveryCandidates.length);
      if (recoveryCandidates.length === 0) {
        throw new Error("Stage 2 vNext recovery writer stage returned no usable caption candidates.");
      }
      allGeneratedCandidates = [...allGeneratedCandidates, ...recoveryCandidates];
      recordExecutedStage("writer", joinPromptPasses(writerPromptTexts), summarizeWriterStage(), allGeneratedCandidates, {
        model: input.stageModels?.writer ?? null
      });

      const recoveryTransitionTimestamp = new Date().toISOString();
      const recoverySemanticDrafts = buildStage2VNextSemanticDrafts(recoveryCandidates);
      const recoverySemanticIssues = validateSemanticDraftListSchema(recoverySemanticDrafts);
      if (recoverySemanticIssues.length > 0) {
        throw new Error(
          `Stage 2 vNext recovery semantic draft contract failed: ${recoverySemanticIssues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join(" ")}`
        );
      }
      for (const draft of recoverySemanticDrafts) {
        candidateLifecycle?.registerSemanticDraft({
          candidateId: draft.candidateId,
          createdAt: recoveryTransitionTimestamp
        });
      }
      vnextSemanticDrafts = [...vnextSemanticDrafts, ...recoverySemanticDrafts];

      const recoveryPackedEntries = buildStage2VNextPackedBridgeEntries({
        candidates: recoveryCandidates,
        constraints: channelConfig.hardConstraints
      });
      const recoveryPackedIssues = validatePackedCandidateListSchema(
        recoveryPackedEntries.map((entry) => entry.packedCandidate)
      );
      if (recoveryPackedIssues.length > 0) {
        throw new Error(
          `Stage 2 vNext recovery packed candidate contract failed: ${recoveryPackedIssues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join(" ")}`
        );
      }
      for (const entry of recoveryPackedEntries) {
        candidateLifecycle?.transition({
          candidateId: entry.packedCandidate.candidateId,
          toState: entry.valid ? "packed_valid" : "packed_invalid",
          stageId: "constraint_packer",
          at: recoveryTransitionTimestamp,
          reason: entry.valid ? null : entry.issues.join(" "),
          repairCount: entry.packedCandidate.repairCount
        });
        if (!entry.valid) {
          candidateLifecycle?.transition({
            candidateId: entry.packedCandidate.candidateId,
            toState: "hard_rejected",
            stageId: "constraint_packer",
            at: recoveryTransitionTimestamp,
            reason: entry.issues.join(" "),
            repairCount: entry.packedCandidate.repairCount
          });
        }
      }
      vnextPackedBridgeEntries = [...vnextPackedBridgeEntries, ...recoveryPackedEntries];

      const recoveryValidCandidates = recoveryPackedEntries
        .filter((entry) => entry.valid)
        .map((entry) => entry.candidate);
      activeCandidates = [...activeCandidates, ...recoveryValidCandidates];

      let recoveryCriticScores: CriticScore[] = [];
      if (recoveryValidCandidates.length > 0) {
        const recoveryCriticPrompt = buildCriticPrompt({
          channelConfig,
          analyzerOutput,
          selectorOutput,
          examplesAssessment: selectorPool.assessment,
          candidates: recoveryValidCandidates,
          promptConfig
        });
        criticPromptTexts.push(recoveryCriticPrompt);
        try {
          const recoveryCriticRaw = await input.executor.runJson<unknown>({
            prompt: recoveryCriticPrompt,
            schema: CRITIC_SCHEMA,
            model: input.stageModels?.critic ?? null,
            reasoningEffort: criticReasoningEffort
          });
          recoveryCriticScores = normalizeCriticScores(recoveryCriticRaw, recoveryValidCandidates);
          recoveryCriticScores = applyStage2VNextEditorialTasteGate({
            criticScores: recoveryCriticScores,
            candidates: recoveryValidCandidates
          });
        } catch (error) {
          warnings.push({
            field: "critic",
            message:
              error instanceof Error
                ? `Critic fallback used during regeneration: ${error.message}`
                : "Critic fallback used during regeneration."
          });
          recoveryCriticScores = normalizeCriticScores([], recoveryValidCandidates);
          recoveryCriticScores = applyStage2VNextEditorialTasteGate({
            criticScores: recoveryCriticScores,
            candidates: recoveryValidCandidates
          });
        }

        const recoveryJudgeCards = buildStage2VNextJudgeCards(recoveryCriticScores);
        const recoveryJudgeIssues = validateJudgeScoreCardListSchema(recoveryJudgeCards);
        if (recoveryJudgeIssues.length > 0) {
          throw new Error(
            `Stage 2 vNext recovery judge card contract failed: ${recoveryJudgeIssues
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join(" ")}`
          );
        }
        vnextJudgeCards = [...vnextJudgeCards, ...recoveryJudgeCards];
        for (const score of recoveryCriticScores) {
          candidateLifecycle?.transition({
            candidateId: score.candidateId,
            toState: "judged",
            stageId: "quality_court",
            at: recoveryTransitionTimestamp,
            reason: null
          });
          candidateLifecycle?.transition({
            candidateId: score.candidateId,
            toState: score.keep ? "survivor" : "hard_rejected",
            stageId: "quality_court",
            at: recoveryTransitionTimestamp,
            reason: score.keep ? null : score.issues.join(" ") || "recovery_critic_reject"
          });
        }
      }

      criticScores = [...criticScores, ...recoveryCriticScores];
      recordExecutedStage("critic", joinPromptPasses(criticPromptTexts), summarizeCriticStage(), criticScores, {
        model: input.stageModels?.critic ?? null
      });
      rewriterCandidatePool = buildRewriterCandidatePool({
        candidates: activeCandidates,
        criticScores,
        constraints: channelConfig.hardConstraints,
        allowReserveBackfill: false
      });
      if (rewriterCandidatePool.candidates.length < REQUIRED_FINAL_SHORTLIST_COUNT) {
        throw new Error(
          `Stage 2 vNext produced only ${rewriterCandidatePool.candidates.length} critic survivors after one regeneration pass; failing closed.`
        );
      }
    }
    const topCandidates = rewriterCandidatePool.candidates;

    let rewrittenCandidates = topCandidates;
    let appliedRewriteCount = 0;
    const rewriterPrompt = buildRewriterPrompt({
      channelConfig,
      analyzerOutput,
      selectorOutput,
      examplesAssessment: selectorPool.assessment,
      candidates: topCandidates,
      criticScores,
      userInstruction: input.videoContext.userInstruction,
      promptConfig
    });
    const rewriterReasoningEffort = resolveStageReasoningEffort("rewriter", promptConfig);
    await reportProgress({
      stageId: "rewriter",
      state: "running",
      promptChars: rewriterPrompt.length,
      reasoningEffort: rewriterReasoningEffort,
      detail: "Шлифуем сильнейшие варианты."
    });
    const rewriterStartedAt = Date.now();
    try {
      const rewriterRaw = await input.executor.runJson<unknown>({
        prompt: rewriterPrompt,
        schema: CANDIDATES_SCHEMA,
        model: input.stageModels?.rewriter ?? null,
        reasoningEffort: rewriterReasoningEffort
      });
      const normalizedRewrites = normalizeCandidates(rewriterRaw, selectorOutput);
      if (normalizedRewrites.length > 0) {
        const merged = mergeRewriterCandidates(topCandidates, normalizedRewrites);
        if (stage2VNextEnabled) {
          const validatedMerged = buildStage2VNextPackedBridgeEntries({
            candidates: merged.candidates,
            constraints: channelConfig.hardConstraints
          });
          const validMergedById = new Map(
            validatedMerged
              .filter((entry) => entry.valid)
              .map((entry) => [entry.candidate.candidateId, entry.candidate] as const)
          );
          rewrittenCandidates = topCandidates.map(
            (candidate) => validMergedById.get(candidate.candidateId) ?? candidate
          );
          appliedRewriteCount = rewrittenCandidates.filter((candidate, index) => {
            const original = topCandidates[index];
            return candidate.top !== original?.top || candidate.bottom !== original?.bottom;
          }).length;
        } else {
          rewrittenCandidates = merged.candidates;
          appliedRewriteCount = merged.appliedRewriteCount;
        }
      }
      await reportProgress({
        stageId: "rewriter",
        state: "completed",
        durationMs: Date.now() - rewriterStartedAt,
        promptChars: rewriterPrompt.length,
        reasoningEffort: rewriterReasoningEffort,
        detail:
          rewriterCandidatePool.reserveBackfillCount > 0
            ? `${topCandidates.length} finalists sent to rewrite (${rewriterCandidatePool.criticApprovedCount} critic-approved + ${rewriterCandidatePool.reserveBackfillCount} reserve), ${appliedRewriteCount} usable rewrites applied.`
            : `${topCandidates.length} finalists sent to rewrite, ${appliedRewriteCount} usable rewrites applied.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Rewriter fallback used.";
      warnings.push({
        field: "rewriter",
        message: error instanceof Error ? `Rewriter fallback used: ${error.message}` : "Rewriter fallback used."
      });
      await reportProgress({
        stageId: "rewriter",
        state: "completed",
        durationMs: Date.now() - rewriterStartedAt,
        promptChars: rewriterPrompt.length,
        reasoningEffort: rewriterReasoningEffort,
        detail: `Fallback used: ${message}`
      });
    }
    if (stage2VNextEnabled) {
      const transitionTimestamp = new Date().toISOString();
      for (const candidate of topCandidates) {
        candidateLifecycle?.transition({
          candidateId: candidate.candidateId,
          toState: "rewritten",
          stageId: "rewriter",
          at: transitionTimestamp
        });
      }
    }
    recordExecutedStage(
      "rewriter",
      rewriterPrompt,
      "LLM stage: rewrites the strongest candidates without dropping hard constraints.",
      rewrittenCandidates,
      { model: input.stageModels?.rewriter ?? null }
    );

    const finalSelectorPrompt = buildFinalSelectorPrompt({
      channelConfig,
      analyzerOutput,
      selectorOutput,
      examplesAssessment: selectorPool.assessment,
      candidates: rewrittenCandidates,
      promptConfig
    });
    const finalSelectorReasoningEffort = resolveStageReasoningEffort("finalSelector", promptConfig);
    await reportProgress({
      stageId: "finalSelector",
      state: "running",
      promptChars: finalSelectorPrompt.length,
      reasoningEffort: finalSelectorReasoningEffort,
      detail: "Собираем shortlist и финальный pick."
    });
    const finalSelectorStartedAt = Date.now();
    let finalSelector: FinalSelectorOutput;
    try {
      const finalRaw = await input.executor.runJson<unknown>({
        prompt: finalSelectorPrompt,
        schema: FINAL_SELECTOR_SCHEMA,
        model: input.stageModels?.finalSelector ?? null,
        reasoningEffort: finalSelectorReasoningEffort
      });
      finalSelector = normalizeFinalSelector(finalRaw, rewrittenCandidates);
    } catch (error) {
      warnings.push({
        field: "finalSelector",
        message:
          error instanceof Error
            ? `Final selector fallback used: ${error.message}`
            : "Final selector fallback used."
      });
      finalSelector = {
        finalCandidates: rewrittenCandidates.slice(0, 5).map((candidate) => candidate.candidateId),
        finalPick: rewrittenCandidates[0]?.candidateId ?? allGeneratedCandidates[0]?.candidateId ?? "",
        rationale: "Fallback shortlist based on critic ranking."
      };
    }

    const shortlistResult = buildShortlist({
      constraints: channelConfig.hardConstraints,
      analyzerOutput,
      finalSelector,
      rewrittenCandidates,
      fallbackCandidates: stage2VNextEnabled ? rewrittenCandidates : allGeneratedCandidates,
      criticScores
    });
    if (shortlistResult.stats.visibleCount !== shortlistResult.stats.targetCount) {
      throw new Error(buildShortlistFailureMessage(shortlistResult.stats));
    }
    if (stage2VNextEnabled) {
      const visibleShortlistQualityIssues = validateVisibleShortlistQuality(shortlistResult.stats);
      if (visibleShortlistQualityIssues.length > 0) {
        throw new Error(
          `Stage 2 vNext visible shortlist quality gate failed: ${visibleShortlistQualityIssues.join(" ")}`
        );
      }
    }
    const shortlistEntries = shortlistResult.entries;
    const shortlist = shortlistEntries.map((entry) => entry.candidate);
    const resolvedFinalSelectorState = buildResolvedFinalSelectorState({
      visibleShortlistEntries: shortlistEntries,
      requestedFinalPickCandidateId: finalSelector.finalPick,
      shortlistStats: shortlistResult.stats,
      commentCarryExpectation: buildCommentCarryProfile(analyzerOutput).expectation
    });
    await reportProgress({
      stageId: "finalSelector",
      state: "completed",
      durationMs: Date.now() - finalSelectorStartedAt,
      promptChars: finalSelectorPrompt.length,
      reasoningEffort: finalSelectorReasoningEffort,
      summary: resolvedFinalSelectorState.progressSummary,
      detail: resolvedFinalSelectorState.progressDetail
    });
    recordExecutedStage(
      "finalSelector",
      finalSelectorPrompt,
      "LLM stage: assembles the shortlist and chooses the recommended final pick.",
      finalSelector,
      { model: input.stageModels?.finalSelector ?? null }
    );

    const titlePrompt = buildTitlePrompt({
      channelConfig,
      videoContext: input.videoContext,
      selectorOutput,
      examplesAssessment: selectorPool.assessment,
      shortlist,
      userInstruction: input.videoContext.userInstruction,
      promptConfig
    });
    const titleReasoningEffort = resolveStageReasoningEffort("titles", promptConfig);
    await reportProgress({
      stageId: "titles",
      state: "running",
      promptChars: titlePrompt.length,
      reasoningEffort: titleReasoningEffort,
      detail: "Генерируем title options."
    });
    const titleStartedAt = Date.now();
    const titleOptions = await input.executor
      .runJson<unknown>({
        prompt: titlePrompt,
        schema: TITLE_SCHEMA,
        model: input.stageModels?.titles ?? null,
        reasoningEffort: titleReasoningEffort
      })
      .then(async (raw) => {
        await reportProgress({
          stageId: "titles",
          state: "completed",
          durationMs: Date.now() - titleStartedAt,
          promptChars: titlePrompt.length,
          reasoningEffort: titleReasoningEffort,
          detail: "Title options generated."
        });
        return normalizeTitleOptions(raw, shortlist);
      })
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : "Title fallback used.";
        warnings.push({
          field: "titles",
          message: error instanceof Error ? `Title fallback used: ${error.message}` : "Title fallback used."
        });
        await reportProgress({
          stageId: "titles",
          state: "completed",
          durationMs: Date.now() - titleStartedAt,
          promptChars: titlePrompt.length,
          reasoningEffort: titleReasoningEffort,
          detail: `Fallback used: ${message}`
        });
        return normalizeTitleOptions({}, shortlist);
      });
    recordExecutedStage(
      "titles",
      titlePrompt,
      "LLM stage: generates the 5 title options for the shortlist.",
      titleOptions,
      { model: input.stageModels?.titles ?? null }
    );

    const shortlistOptionMap = resolvedFinalSelectorState.candidateOptionMap;
    const captionOptions = shortlistEntries.map((entry, index) => {
      const candidate = entry.candidate;
      return {
        option: index + 1,
        candidateId: candidate.candidateId,
        angle: candidate.angle,
        top: candidate.top,
        bottom: candidate.bottom,
        displayTier: "finalist" as const,
        sourceStage: "qualityCourt" as const,
        displayReason: "Selected for the visible shortlist.",
        topRu: candidate.topRu,
        bottomRu: candidate.bottomRu,
        styleDirectionIds: candidate.styleDirectionIds,
        explorationMode: candidate.explorationMode,
        constraintCheck: entry.constraintCheck
      };
    });
    const resolvedFinalPickCandidateId = resolvedFinalSelectorState.finalPickCandidateId;
    const finalPickOption = Math.max(
      1,
      shortlistOptionMap.findIndex((option) => option.candidateId === resolvedFinalPickCandidateId) + 1
    );
    const { operatorReason: operatorFacingFinalReason, sanitizedRationaleRaw } =
      buildOperatorFacingFinalReason({
        shortlist,
        shortlistOptionMap,
        finalPickCandidateId: resolvedFinalPickCandidateId
      });
    const internalFinalSelectorReason = resolvedFinalSelectorState.rationaleInternalRaw;
    const sanitizedModelFinalSelectorReason = sanitizeFinalSelectorModelRationale({
      rawRationale: finalSelector.rationale,
      visibleShortlist: shortlist,
      finalPickCandidateId: resolvedFinalPickCandidateId
    });
    assertCompletedShortlistContract({
      captionOptions,
      candidateOptionMap: shortlistOptionMap,
      shortlistCandidateIds: resolvedFinalSelectorState.shortlistCandidateIds,
      finalPickCandidateId: resolvedFinalPickCandidateId
    });
    const finalPick = {
      option: finalPickOption,
      reason: operatorFacingFinalReason
    };
    const seo = await runStage2SeoStage({
      enabled: shouldRunStage2SeoGeneration(input.stageModels),
      sourceUrl: input.videoContext.sourceUrl,
      title: input.videoContext.title,
      comments: input.videoContext.comments,
      omittedCommentsCount: 0,
      userInstruction: input.videoContext.userInstruction,
      stage2Output: {
        inputAnalysis: {
          visualAnchors: analyzerOutput.visualAnchors.slice(0, 3),
          commentVibe: analyzerOutput.commentVibe,
          keyPhraseToAdapt:
            analyzerOutput.slangToAdapt[0] ??
            analyzerOutput.extractableSlang[0] ??
            analyzerOutput.payoff ??
            analyzerOutput.subject
        },
        captionOptions,
        finalPick
      },
      executor: input.executor,
      stageModels: input.stageModels,
      promptConfig,
      warnings,
      promptInputManifests,
      reportProgress,
      recordExecutedStage
    });

    const diagnosticsBundle = buildRunDiagnosticsBundle({
      channelConfig,
      videoContext: input.videoContext,
      analyzerOutput,
      promptConfig,
      debugMode,
      executedPromptStages,
      workspaceCorpusCount,
      activeExamplesCount: availableExamples.length,
      selectorExamples: selectorPromptExamples,
      examplesAssessment: selectorPool.assessment,
      exampleInsights: selectorPool.exampleInsights,
      selectorOutput,
      queryText,
      writerCandidates: activeCandidates,
      criticScores,
      rewrittenCandidates,
      shortlist
    });

    let vnextPipeline:
      | NonNullable<ViralShortsStage2Result["pipeline"]["vnext"]>
      | undefined;
    if (stage2VNextEnabled && exampleRouting) {
      const transitionTimestamp = new Date().toISOString();
      const vnextSelection: Stage2VNextFinalSelection = {
        visibleCandidateIds: resolvedFinalSelectorState.shortlistCandidateIds,
        winnerCandidateId: resolvedFinalPickCandidateId,
        rankingMatches: [],
        rationale: sanitizedRationaleRaw
      };
      const selectionIssues = validateFinalSelectionObjectSchema(vnextSelection);
      if (selectionIssues.length > 0) {
        throw new Error(
          `Stage 2 vNext final selection contract failed: ${selectionIssues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join(" ")}`
        );
      }

      for (const candidateId of resolvedFinalSelectorState.shortlistCandidateIds) {
        candidateLifecycle?.transition({
          candidateId,
          toState: "ranked_shortlist",
          stageId: "ranked_final_selector",
          at: transitionTimestamp
        });
        candidateLifecycle?.transition({
          candidateId,
          toState: "visible_shortlist",
          stageId: "ranked_final_selector",
          at: transitionTimestamp
        });
      }
      candidateLifecycle?.transition({
        candidateId: resolvedFinalPickCandidateId,
        toState: "winner",
        stageId: "ranked_final_selector",
        at: transitionTimestamp
      });
      const vnextCriticGate = buildStage2VNextCriticGate({
        criticScores,
        rewriteCandidates: topCandidates,
        validatedShortlistPoolCandidateIds: shortlistResult.validatedPoolCandidateIds,
        visibleShortlistCandidateIds: resolvedFinalSelectorState.shortlistCandidateIds,
        invalidDroppedCandidateIds: shortlistResult.invalidDroppedCandidateIds
      });

      const vnextTraceBundle = buildStage2VNextTrace({
        source: buildStage2VNextSourcePacket(input.videoContext),
        clipTruth: buildStage2VNextClipTruthPacket(analyzerOutput, selectorOutput),
        audience: buildStage2VNextAudiencePacket(analyzerOutput),
        channel: {
          channelId: channelConfig.channelId,
          name: channelConfig.name,
          username: channelConfig.username,
          hardConstraints: channelConfig.hardConstraints,
          userInstruction: input.videoContext.userInstruction?.trim() || null
        },
        exampleRouting: {
          decision: exampleRouting,
          retrievedExamples: buildRetrievedExamples(selectorPool.selectorExamples),
          passedExamples: buildRetrievedExamples(selectorPromptExamples),
          blockedExamples: buildRetrievedExamples(
            selectorPool.selectorExamples.filter(
              (example) => !selectorPromptExamples.some((allowed) => allowed.id === example.id)
            )
          )
        },
        strategy: buildStage2VNextStrategyPacket(selectorOutput, exampleRouting),
        semanticDrafts: vnextSemanticDrafts,
        packedCandidates: vnextPackedBridgeEntries.map((entry) => entry.packedCandidate),
        judgeCards: vnextJudgeCards,
        selection: vnextSelection,
        titles: titleOptions,
        seo,
        candidateLineage: candidateLifecycle?.list() ?? [],
        criticGate: vnextCriticGate,
        featureFlags: pipelineExecution.featureFlags,
        pipelineVersion: pipelineExecution.pipelineVersion,
        stageChainVersion: pipelineExecution.stageChainVersion,
        workerBuild: pipelineExecution.workerBuild,
        exampleUsage: buildStage2VNextExampleUsage({
          exampleRouting,
          selectedExampleIds: selectorOutput.selectedExampleIds ?? []
        }),
        cost: {
          totalPromptChars: diagnosticsBundle.tokenUsage.totalPromptChars,
          totalEstimatedInputTokens: diagnosticsBundle.tokenUsage.totalEstimatedInputTokens,
          totalEstimatedOutputTokens: diagnosticsBundle.tokenUsage.totalEstimatedOutputTokens
        }
      });
      if (!vnextTraceBundle.validation.ok) {
        throw new Error(
          `Stage 2 vNext trace validation failed: ${vnextTraceBundle.validation.issues.join(" ")}`
        );
      }
      vnextPipeline = {
        phase: 1,
        exampleRouting,
        criticGate: vnextCriticGate,
        canonicalCounters: vnextTraceBundle.trace.canonicalCounters,
        candidateLineage: candidateLifecycle?.list() ?? [],
        trace: vnextTraceBundle.trace,
        validation: vnextTraceBundle.validation
      };
    }

    const output: ViralShortsStage2Result = {
      inputAnalysis: {
        visualAnchors: analyzerOutput.visualAnchors.slice(0, 3),
        commentVibe: analyzerOutput.commentVibe,
        keyPhraseToAdapt:
          analyzerOutput.slangToAdapt[0] ??
          analyzerOutput.extractableSlang[0] ??
          analyzerOutput.payoff ??
          analyzerOutput.subject
      },
      captionOptions,
      titleOptions,
      finalPick,
      pipeline: {
        channelId: channelConfig.channelId,
        workerProfile: {
          requestedId: getResolvedStage2WorkerProfile(channelConfig).requestedId,
          resolvedId: getResolvedStage2WorkerProfile(channelConfig).resolvedId,
          label: getResolvedStage2WorkerProfile(channelConfig).label,
          description: getResolvedStage2WorkerProfile(channelConfig).description,
          summary: getResolvedStage2WorkerProfile(channelConfig).summary,
          origin: getResolvedStage2WorkerProfile(channelConfig).origin
        },
        mode: "codex_pipeline",
        execution: pipelineExecution,
        selectorOutput,
        availableExamplesCount: availableExamples.length,
        selectedExamplesCount:
          selectorOutput.selectedExampleIds?.length ?? selectorOutput.selectedExamples?.length ?? 0,
        retrievalConfidence: selectorPool.assessment.retrievalConfidence,
        examplesMode: selectorPool.assessment.examplesMode,
        retrievalExplanation: selectorPool.assessment.explanation,
        finalSelector: {
          candidateOptionMap: shortlistOptionMap,
          shortlistCandidateIds: resolvedFinalSelectorState.shortlistCandidateIds,
          finalPickCandidateId: resolvedFinalPickCandidateId,
          rationaleRaw: sanitizedRationaleRaw,
          rationaleInternalRaw: internalFinalSelectorReason,
          rationaleInternalModelRaw: sanitizedModelFinalSelectorReason,
          shortlistStats: shortlistResult.stats
        },
        ...(vnextPipeline ? { vnext: vnextPipeline } : {})
      },
      diagnostics: diagnosticsBundle.diagnostics
    };

    return {
      output,
      seo,
      warnings,
      diagnostics: diagnosticsBundle.diagnostics,
      rawDebugArtifact: diagnosticsBundle.rawDebugArtifact,
      tokenUsage: diagnosticsBundle.tokenUsage
    };
  }
}
