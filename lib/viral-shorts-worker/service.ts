import {
  AnalyzerOutput,
  CandidateCaption,
  CriticScore,
  FinalSelectorOutput,
  PreparedGenerationContext,
  PromptPacket,
  SelectorOutput,
  Stage2Diagnostics,
  Stage2DiagnosticsExample,
  Stage2DiagnosticsPromptStage,
  Stage2RuntimeChannelConfig,
  ViralShortsStage2Result,
  ViralShortsVideoContext
} from "./types";
import {
  buildAnalyzerPrompt,
  buildCriticPrompt,
  buildFinalSelectorPrompt,
  buildPromptPacket,
  buildRewriterPrompt,
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
import { normalizeStage2TitleOptionsValue } from "../stage2-title-options";
import {
  STAGE2_PIPELINE_STAGES,
  Stage2PipelineStageId,
  Stage2PromptConfig,
  normalizeStage2PromptConfig
} from "../stage2-pipeline";
import { Stage2PromptConfigStageId } from "../stage2-prompt-specs";
import { CommentItem } from "../comments";
import { JsonStageExecutor } from "./executor";
import { buildSelectorExamplePool } from "./selector-example-pool";

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
    slang_to_adapt: { type: "array", items: { type: "string", minLength: 1 } },
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

const SUPPORTED_SELECTOR_ANGLES = new Set([
  "insider_expertise",
  "awe_scale",
  "tension_danger",
  "absurdity_chaos",
  "competence_process",
  "shared_experience",
  "warmth_reverence",
  "payoff_reveal"
]);

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
          top: { type: "string", minLength: 1 },
          bottom: { type: "string", minLength: 1 },
          top_ru: { type: "string", minLength: 1 },
          bottom_ru: { type: "string", minLength: 1 },
          rationale: { type: "string", minLength: 1 }
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

type StageWarning = {
  field: string;
  message: string;
};

type RunPipelineResult = {
  output: ViralShortsStage2Result;
  warnings: StageWarning[];
  promptPacket: PromptPacket;
  diagnostics: Stage2Diagnostics;
};

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
  hiddenDetail: string | null;
  commentVibe: string | null;
  genericRisks: string[];
};

function deriveCommentIntelligence(
  comments: ViralShortsVideoContext["comments"]
): CommentIntelligence {
  const sortedComments = [...comments]
    .sort((left, right) => right.likes - left.likes)
    .slice(0, 40)
    .map((comment) => ({
      likes: comment.likes,
      text: String(comment.text ?? "").replace(/\s+/g, " ").trim()
    }))
    .filter((comment) => comment.text);

  if (sortedComments.length === 0) {
    return {
      slangToAdapt: [],
      hiddenDetail: null,
      commentVibe: null,
      genericRisks: []
    };
  }

  const scoreByPhrase = new Map<string, number>();
  const boost = (phrase: string, score: number) => {
    scoreByPhrase.set(phrase, (scoreByPhrase.get(phrase) ?? 0) + score);
  };

  let suspicionScore = 0;
  let laughScore = 0;
  let hypeScore = 0;
  let artScore = 0;

  for (const comment of sortedComments) {
    const lower = comment.text.toLowerCase();
    const weight = Math.max(1, Math.min(8, Math.floor(Math.log10(comment.likes + 10))));

    if (/\bgod ?pack\b|\bdemon pack\b/.test(lower)) {
      boost("god pack", weight + 3);
      hypeScore += weight + 2;
    }
    if (/\bscooby(?:[- ]?doo)?\b|\bhorse sounds?\b|\bturned into scooby\b/.test(lower)) {
      boost("Scooby laugh", weight + 2);
      laughScore += weight + 2;
    }
    if (/\b(fake|pre[- ]?opened|already open(?:ed)?|resealed|tampered|cut and switch)\b/.test(lower)) {
      boost("pre-opened suspicion", weight + 2);
      suspicionScore += weight + 2;
    }
    if (/\b(art goes hard|cards? look|cards? are|texture is insane|beautiful cards|sick art|art style)\b/.test(lower)) {
      boost("art goes hard", weight + 1);
      artScore += weight + 1;
    }
  }

  const slangToAdapt = Array.from(scoreByPhrase.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([phrase]) => phrase)
    .slice(0, 5);

  let hiddenDetail: string | null = null;
  const genericRisks: string[] = [];
  if (suspicionScore > 0) {
    hiddenDetail =
      "Several commenters suspect the pack looked pre-opened, resealed, or fake instead of treating it like a normal clean rip.";
    genericRisks.push(
      "treating fake or pre-opened accusations as confirmed fact when the clip itself only supports suspicion"
    );
  } else if (laughScore > 0) {
    hiddenDetail =
      "A lot of the comments fixate on the Scooby-Doo laugh and the reaction noises, not just the cards themselves.";
  } else if (hypeScore > 0) {
    hiddenDetail =
      "Multiple commenters frame it as a literal god pack, not just one lucky pull.";
  } else if (artScore > 0) {
    hiddenDetail =
      "A noticeable chunk of the comments care about how insane the card art and texture look, not only the value.";
  }

  const commentVibe =
    suspicionScore > 0 && (laughScore > 0 || hypeScore > 0)
      ? "Hype, laugh jokes, and fake-pack suspicion all show up at once."
      : suspicionScore > 0
        ? "Excitement mixed with real suspicion that the pack looked tampered or pre-opened."
        : laughScore > 0 && hypeScore > 0
          ? "Awe and collector hype mixed with jokes about the Scooby-Doo laugh."
          : hypeScore > 0
            ? "Collector disbelief and god-pack hype."
            : laughScore > 0
              ? "Mostly amused reaction focused on the laugh and the shock."
              : artScore > 0
                ? "Fans are impressed by the card art as much as the pull itself."
                : null;

  return {
    slangToAdapt,
    hiddenDetail,
    commentVibe,
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
  const genericRisks = mergeUniqueAnalyzerStrings(
    analyzerOutput.genericRisks,
    intelligence.genericRisks
  ).slice(0, 6);

  return {
    ...analyzerOutput,
    commentVibe,
    slangToAdapt,
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
    slangToAdapt: normalizeAnalyzerStringList(slangToAdaptRaw, fallback.slangToAdapt, 5),
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

function isSupportedSelectorAngle(value: string): boolean {
  return SUPPORTED_SELECTOR_ANGLES.has(value);
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
  videoContext: ViralShortsVideoContext
): SelectorOutput {
  const queryText = buildCorpusQueryText(videoContext, analyzerOutput);
  const stakes = analyzerOutput.stakes.map((stake) => stake.toLowerCase());
  const chosenExamples = [...availableExamples]
    .sort((left, right) => scoreExampleMatch(queryText, right) - scoreExampleMatch(queryText, left))
    .slice(0, Math.min(6, availableExamples.length));

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
      "overly clean AI wording"
    ],
    selectedExampleIds: chosenExamples.map((example) => example.id),
    selectedExamples: chosenExamples,
    rejectedExampleIds: [],
    confidence: chosenExamples.length > 0 ? 0.54 : 0.3,
    rationale:
      chosenExamples.length > 0
        ? "Fallback selector used text-match similarity against the available corpus."
        : "Fallback selector had no examples available and relied on the analyzer output only.",
    writerBrief: `Write for ${channelConfig.name}. Lead with the visible scene, then react like a human viewer.`
  };
}

function normalizeSelectorOutput(
  raw: unknown,
  fallback: SelectorOutput,
  availableExamples: Stage2CorpusExample[]
): SelectorOutput {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
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
  const selectedExamples = availableExamples.filter((example) => selectedExampleIds.includes(example.id));
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
      .slice(0, 8),
    selectedExampleIds:
      selectedExamples.length >= 1 ? selectedExamples.map((example) => example.id) : fallback.selectedExampleIds,
    rejectedExampleIds,
    selectedExamples: selectedExamples.length >= 1 ? selectedExamples : fallback.selectedExamples,
    rationale:
      String(obj.selection_rationale ?? obj.rationale ?? fallback.rationale ?? "").trim() ||
      fallback.rationale,
    writerBrief:
      String(obj.writer_brief ?? obj.writerBrief ?? fallback.writerBrief).trim() || fallback.writerBrief,
    confidence:
      Number.isFinite(Number(obj.confidence)) ? Number(obj.confidence) : fallback.confidence
  };
}

function normalizeCandidates(raw: unknown, selectorOutput: SelectorOutput): CandidateCaption[] {
  const candidatesRaw = Array.isArray((raw as { candidates?: unknown })?.candidates)
    ? ((raw as { candidates: unknown[] }).candidates ?? [])
    : Array.isArray(raw)
      ? raw
      : [];

  return candidatesRaw
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const item = entry as Record<string, unknown>;
      const fallbackAngle = selectorOutput.rankedAngles[0]?.angle ?? "payoff_reveal";
      const candidateId =
        String(item.candidate_id ?? item.candidateId ?? `cand_${index + 1}`).trim() ||
        `cand_${index + 1}`;
      const top = String(item.top ?? "").trim();
      const bottom = String(item.bottom ?? "").trim();
      if (!top || !bottom) {
        return null;
      }
      return {
        candidateId,
        angle: String(item.angle ?? fallbackAngle).trim() || fallbackAngle,
        top,
        bottom,
        topRu: String(item.top_ru ?? item.topRu ?? top).trim() || top,
        bottomRu: String(item.bottom_ru ?? item.bottomRu ?? bottom).trim() || bottom,
        rationale: String(item.rationale ?? "").trim() || "Generated by writer stage."
      };
    })
    .filter((candidate): candidate is CandidateCaption => candidate !== null);
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
      if (!candidateId) {
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
  "seems"
]);
const TOP_PADDING_OPTIONS = [
  "It is already over.",
  "You can feel the winner coming.",
  "The road already looks like it knows how this ends."
];
const BOTTOM_PADDING_OPTIONS = [
  "And yeah, the whole room feels it immediately.",
  "That is the part nobody there can shrug off.",
  "Once that lands, the reaction basically writes itself.",
  "At that point, everybody in the shot gets the same message."
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
  if (value.length > input.maximum) {
    value = truncateToWordBoundary(value, input.maximum);
    repaired = true;
  }
  if (looksLikeBrokenCaptionEnding(value)) {
    const prefix = extractLeadingCompleteSentences(value);
    if (prefix && prefix.length < value.length) {
      value = prefix;
      repaired = true;
    } else {
      const trimmed = trimTrailingBrokenEndingWords(value);
      if (trimmed && trimmed !== value) {
        value = trimmed;
        repaired = true;
      }
    }
    const trimmedFragment = trimTrailingIncompleteFragment(value);
    if (trimmedFragment && trimmedFragment !== value) {
      value = trimmedFragment;
      repaired = true;
    }
    const retrimmed = trimTrailingBrokenEndingWords(value);
    if (retrimmed && retrimmed !== value) {
      value = retrimmed;
      repaired = true;
    }
    if (extractNormalizedWords(value).length <= 4 || looksLikeBrokenCaptionEnding(value)) {
      return {
        text: value,
        repaired,
        valid: false
      };
    }
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
};

type ShortlistStats = {
  targetCount: number;
  requestedCount: number;
  validatedCount: number;
  visibleCount: number;
  repairedCount: number;
  droppedAfterValidationCount: number;
};

const REQUIRED_FINAL_SHORTLIST_COUNT = 5;

function buildShortlistFailureMessage(stats: ShortlistStats): string {
  return (
    `Stage 2 final shortlist could not produce ${stats.targetCount} valid options after constraint-safe ` +
    `repair and reserve backfill. Only ${stats.visibleCount}/${stats.targetCount} visible option(s) remained ` +
    `from ${stats.validatedCount} validated candidate(s) and ${stats.requestedCount} requested finalist pick(s).`
  );
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

function buildResolvedFinalSelectorState(input: {
  visibleShortlist: CandidateCaption[];
  requestedFinalPickCandidateId: string;
  shortlistStats?: ShortlistStats | null;
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
  const shortlistCandidateIds = input.visibleShortlist.map((candidate) => candidate.candidateId);
  const candidateOptionMap = shortlistCandidateIds.map((candidateId, index) => ({
    option: index + 1,
    candidateId
  }));
  const finalPickCandidateId =
    input.visibleShortlist.find((candidate) => candidate.candidateId === input.requestedFinalPickCandidateId)?.candidateId ??
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
      evaluatedShortlist: input.visibleShortlist,
      visibleShortlist: input.visibleShortlist,
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
        entry.criticTotal >= duplicateEntry.criticTotal - 0.75
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
    remaining.sort((left, right) => right.criticTotal - left.criticTotal);
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
    if (entry.candidate.candidateId === protectedFinalPickId) {
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
  finalSelector: FinalSelectorOutput;
  rewrittenCandidates: CandidateCaption[];
  fallbackCandidates: CandidateCaption[];
  criticScores: CriticScore[];
}): { entries: ShortlistEntry[]; stats: ShortlistStats } {
  const targetCount = REQUIRED_FINAL_SHORTLIST_COUNT;
  const scoreMap = new Map(input.criticScores.map((score) => [score.candidateId, score.total]));
  const byId = new Map(
    [...input.rewrittenCandidates, ...input.fallbackCandidates].map((candidate) => [candidate.candidateId, candidate])
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
    return {
      candidate: repaired.candidate,
      constraintCheck,
      criticTotal: scoreMap.get(candidate.candidateId) ?? 0,
      valid: repaired.valid
    };
    });
  const repairedPool = repairedEntries.filter((entry) => entry.valid && entry.constraintCheck.passed);

  const preferredIds = new Set(input.finalSelector.finalCandidates);
  const protectedFinalPickId = input.finalSelector.finalPick;
  const accepted = repairedPool.filter((entry) => preferredIds.has(entry.candidate.candidateId)).slice(0, targetCount);
  const remaining = repairedPool
    .filter((entry) => !preferredIds.has(entry.candidate.candidateId))
    .sort((left, right) => right.criticTotal - left.criticTotal);

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
        .sort((left, right) => left.entry.criticTotal - right.entry.criticTotal)[0];
      if (!replaceable) {
        remaining.unshift(alternative);
        break;
      }
      if (alternative.criticTotal < replaceable.entry.criticTotal - 0.75) {
        remaining.unshift(alternative);
        break;
      }
      const [removed] = accepted.splice(replaceable.index, 1, alternative);
      if (removed) {
        remaining.push(removed);
        remaining.sort((left, right) => right.criticTotal - left.criticTotal);
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
    const strongestRemainingScore = remaining[0]?.criticTotal ?? 0;
    const diverseIndex = remaining.findIndex(
      (entry) =>
        !acceptedAngles.has(entry.candidate.angle) &&
        entry.criticTotal >= strongestRemainingScore - 0.75
    );
    const uniqueTailIndex = remaining.findIndex((entry) => {
      const tailKey = buildBottomTailKey(entry.candidate.bottom);
      return (
        Boolean(tailKey) &&
        !acceptedTailKeys.has(tailKey) &&
        entry.criticTotal >= strongestRemainingScore - 0.75
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

  diversifyAcceptedShortlist();
  diversifyAcceptedBottomTails(accepted, remaining, protectedFinalPickId);
  cleanupDuplicateBottomTails(accepted, input.constraints, protectedFinalPickId);
  const entries = accepted.slice(0, targetCount);
  return {
    entries,
    stats: {
      targetCount,
      requestedCount: Math.min(targetCount, input.finalSelector.finalCandidates.length || targetCount),
      validatedCount: repairedPool.length,
      visibleCount: entries.length,
      repairedCount: repairedEntries.filter((entry) => entry.constraintCheck.repaired).length,
      droppedAfterValidationCount: Math.max(0, repairedEntries.length - repairedPool.length)
    }
  };
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

function normalizeTitleOptions(
  raw: unknown,
  shortlist: CandidateCaption[]
): Array<{ option: number; title: string; titleRu: string }> {
  const normalized = (normalizeStage2TitleOptionsValue(raw) ?? []).slice(0, 5);

  if (normalized.length === 5) {
    return normalized.map((item, index) => ({ ...item, option: index + 1 }));
  }

  return shortlist.slice(0, 5).map((candidate, index) => buildFallbackTitleOption(candidate, index + 1));
}

function buildPromptStageDiagnostics(input: {
  stageId: Stage2PipelineStageId;
  promptConfig: Stage2PromptConfig | null;
  promptText: string | null;
  usesImages?: boolean;
  summary: string;
}): Stage2DiagnosticsPromptStage {
  const stageMeta = STAGE2_PIPELINE_STAGES.find((stage) => stage.id === input.stageId);
  const resolved = resolveStage2PromptTemplate(
    input.stageId as keyof Stage2PromptConfig["stages"],
    input.promptConfig
  );
  return {
    stageId: input.stageId,
    label: stageMeta?.shortLabel ?? input.stageId,
    stageType: "llm_prompt",
    defaultPrompt: resolved.defaultPrompt,
    configuredPrompt: resolved.configuredPrompt,
    reasoningEffort: resolved.reasoningEffort,
    isCustomPrompt: resolved.isCustomPrompt,
    promptText: input.promptText,
    promptChars: input.promptText ? input.promptText.length : null,
    usesImages: Boolean(input.usesImages),
    summary: input.summary
  };
}

function buildDiagnosticsExample(
  bucket: Stage2DiagnosticsExample["bucket"],
  example: Stage2CorpusExample,
  queryText: string,
  selectedExampleIds: string[]
): Stage2DiagnosticsExample {
  const overlapScore = scoreExampleMatch(queryText, example);
  const reasons = [];
  if (selectedExampleIds.includes(example.id)) {
    reasons.push("selected by selector");
  }
  if (example.clipType) {
    reasons.push(`clip type ${example.clipType}`);
  }
  if (example.whyItWorks.length > 0) {
    reasons.push("why-it-works notes present");
  }
  if (typeof example.qualityScore === "number") {
    reasons.push(`quality ${example.qualityScore.toFixed(2)}`);
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
    retrievalScore: overlapScore,
    retrievalReasons: reasons,
    sampleKind: example.ownerChannelId,
    isOwnedAnchor: example.ownerChannelId === example.sourceChannelId,
    isAntiExample: false,
    publishedAt: null,
    views: null,
    ageHours: null,
    anomalyScore: null
  };
}

function buildRunDiagnostics(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  promptConfig: Stage2PromptConfig | null;
  promptPacket: PromptPacket;
  titlePrompt: string;
  workspaceCorpusCount: number;
  activeExamplesCount: number;
  selectorExamples: Stage2CorpusExample[];
  selectorOutput: SelectorOutput;
  queryText: string;
}): Stage2Diagnostics {
  const selectedExampleIds = input.selectorOutput.selectedExampleIds ?? [];
  return {
    channel: {
      channelId: input.channelConfig.channelId,
      name: input.channelConfig.name,
      username: input.channelConfig.username,
      examplesSource: input.channelConfig.examplesSource,
      hardConstraints: input.channelConfig.hardConstraints,
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
      commentVibe: input.analyzerOutput.commentVibe,
      slangToAdapt: input.analyzerOutput.slangToAdapt,
      hiddenDetail: input.analyzerOutput.hiddenDetail,
      genericRisks: input.analyzerOutput.genericRisks,
      uncertaintyNotes: input.analyzerOutput.uncertaintyNotes,
      rawSummary: input.analyzerOutput.rawSummary
    },
    effectivePrompting: {
      promptStages: [
        buildPromptStageDiagnostics({
          stageId: "analyzer",
          promptConfig: input.promptConfig,
          promptText: input.promptPacket.prompts.analyzer,
          usesImages: true,
          summary: "LLM stage: reads frames, comments, title and description to produce the visual analysis."
        }),
        buildPromptStageDiagnostics({
          stageId: "selector",
          promptConfig: input.promptConfig,
          promptText: input.promptPacket.prompts.selector,
          summary: "LLM stage: chooses clip angle(s) and the most relevant examples from the active corpus."
        }),
        buildPromptStageDiagnostics({
          stageId: "writer",
          promptConfig: input.promptConfig,
          promptText: input.promptPacket.prompts.writer,
          summary: "LLM stage: drafts 20 caption options using selector-chosen examples."
        }),
        buildPromptStageDiagnostics({
          stageId: "critic",
          promptConfig: input.promptConfig,
          promptText: input.promptPacket.prompts.critic,
          summary: "LLM stage: scores the writer candidates and decides what survives."
        }),
        buildPromptStageDiagnostics({
          stageId: "rewriter",
          promptConfig: input.promptConfig,
          promptText: input.promptPacket.prompts.rewriter,
          summary: "LLM stage: rewrites the strongest candidates without dropping hard constraints."
        }),
        buildPromptStageDiagnostics({
          stageId: "finalSelector",
          promptConfig: input.promptConfig,
          promptText: input.promptPacket.prompts.finalSelector,
          summary: "LLM stage: assembles the shortlist and chooses the recommended final pick."
        }),
        buildPromptStageDiagnostics({
          stageId: "titles",
          promptConfig: input.promptConfig,
          promptText: input.titlePrompt,
          summary: "LLM stage: generates the 5 title options for the shortlist."
        })
      ]
    },
    examples: {
      source: input.channelConfig.examplesSource,
      workspaceCorpusCount: input.workspaceCorpusCount,
      activeCorpusCount: input.activeExamplesCount,
      selectorCandidateCount: input.selectorExamples.length,
      availableExamples: input.selectorExamples.map((example) =>
        buildDiagnosticsExample("available", example, input.queryText, selectedExampleIds)
      ),
      selectedExamples: (input.selectorOutput.selectedExamples ?? []).map((example) =>
        buildDiagnosticsExample("selected", example, input.queryText, selectedExampleIds)
      )
    }
  };
}

function normalizeChannelConfig(input: {
  id: string;
  name: string;
  username: string;
  stage2HardConstraints: Stage2HardConstraints;
  stage2ExamplesConfig: Stage2ExamplesConfig;
  resolvedExamplesSource?: Stage2RuntimeChannelConfig["examplesSource"];
}): Stage2RuntimeChannelConfig {
  return {
    channelId: input.id,
    name: input.name,
    username: input.username,
    hardConstraints: input.stage2HardConstraints,
    examplesSource:
      input.resolvedExamplesSource ??
      (input.stage2ExamplesConfig.useWorkspaceDefault ? "workspace_default" : "channel_custom")
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
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
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
    const selectorOutput = fallbackSelectorOutput(
      channelConfig,
      analyzedHeuristicOutput,
      selectorPool.selectorExamples,
      input.videoContext
    );
    return buildPromptPacket({
      channelConfig,
      videoContext: input.videoContext,
      analyzerOutput: analyzedHeuristicOutput,
      selectorOutput,
      availableExamples: selectorPool.selectorExamples,
      promptConfig: normalizeStage2PromptConfig(input.promptConfig)
    });
  }

  async runPipeline(input: {
    channel: {
      id: string;
      name: string;
      username: string;
      stage2ExamplesConfig: Stage2ExamplesConfig;
      stage2HardConstraints: Stage2HardConstraints;
    };
    workspaceStage2ExamplesCorpusJson: string | null | undefined;
    videoContext: ViralShortsVideoContext;
    imagePaths: string[];
    executor: JsonStageExecutor;
    promptConfig?: Stage2PromptConfig | null;
    onProgress?: (event: PipelineProgressEvent) => void | Promise<void>;
  }): Promise<RunPipelineResult> {
    const warnings: StageWarning[] = [];
    const promptConfig = normalizeStage2PromptConfig(input.promptConfig);
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

    const queryText = buildCorpusQueryText(input.videoContext, analyzerOutput);
    const selectorPool = buildSelectorExamplePool({
      examples: availableExamples,
      queryText
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

    const selectorPrompt = buildSelectorPrompt({
      channelConfig,
      videoContext: input.videoContext,
      analyzerOutput,
      availableExamples: selectorPool.selectorExamples,
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
      selectorPool.selectorExamples,
      input.videoContext
    );
    let selectorOutput = selectorFallback;
    try {
      const selectorRaw = await input.executor.runJson<unknown>({
        prompt: selectorPrompt,
        schema: SELECTOR_SCHEMA,
        reasoningEffort: selectorReasoningEffort
      });
      selectorOutput = normalizeSelectorOutput(
        selectorRaw,
        selectorFallback,
        selectorPool.selectorExamples
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

    const promptPacket = buildPromptPacket({
      channelConfig,
      videoContext: input.videoContext,
      analyzerOutput,
      selectorOutput,
      availableExamples: selectorPool.selectorExamples,
      promptConfig
    });

    const writerPrompt = buildWriterPrompt({
      channelConfig,
      analyzerOutput,
      selectorOutput,
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
    const candidates = normalizeCandidates(writerRaw, selectorOutput);
    if (candidates.length === 0) {
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
      detail: `${candidates.length} candidates drafted.`
    });

    const criticPrompt = buildCriticPrompt({
      channelConfig,
      analyzerOutput,
      selectorOutput,
      candidates,
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
    let criticScores: CriticScore[];
    try {
      const criticRaw = await input.executor.runJson<unknown>({
        prompt: criticPrompt,
        schema: CRITIC_SCHEMA,
        reasoningEffort: criticReasoningEffort
      });
      criticScores = normalizeCriticScores(criticRaw, candidates);
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
      criticScores = normalizeCriticScores([], candidates);
      await reportProgress({
        stageId: "critic",
        state: "completed",
        durationMs: Date.now() - criticStartedAt,
        promptChars: criticPrompt.length,
        reasoningEffort: criticReasoningEffort,
        detail: `Fallback used: ${message}`
      });
    }

    const keptIds = new Set(
      criticScores
        .filter((score) => score.keep)
        .slice(0, 8)
        .map((score) => score.candidateId)
    );
    const topCandidates = candidates.filter((candidate) =>
      keptIds.size > 0 ? keptIds.has(candidate.candidateId) : true
    );

    let rewrittenCandidates = topCandidates;
    let appliedRewriteCount = 0;
    const rewriterPrompt = buildRewriterPrompt({
      channelConfig,
      analyzerOutput,
      selectorOutput,
      candidates: topCandidates,
      criticScores: criticScores.slice(0, 8),
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
        reasoningEffort: rewriterReasoningEffort
      });
      const normalizedRewrites = normalizeCandidates(rewriterRaw, selectorOutput);
      if (normalizedRewrites.length > 0) {
        const merged = mergeRewriterCandidates(topCandidates, normalizedRewrites);
        rewrittenCandidates = merged.candidates;
        appliedRewriteCount = merged.appliedRewriteCount;
      }
      await reportProgress({
        stageId: "rewriter",
        state: "completed",
        durationMs: Date.now() - rewriterStartedAt,
        promptChars: rewriterPrompt.length,
        reasoningEffort: rewriterReasoningEffort,
        detail: `${topCandidates.length} finalists sent to rewrite, ${appliedRewriteCount} usable rewrites applied.`
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

    const finalSelectorPrompt = buildFinalSelectorPrompt({
      channelConfig,
      analyzerOutput,
      selectorOutput,
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
        finalPick: rewrittenCandidates[0]?.candidateId ?? candidates[0]?.candidateId ?? "",
        rationale: "Fallback shortlist based on critic ranking."
      };
    }

    const shortlistResult = buildShortlist({
      constraints: channelConfig.hardConstraints,
      finalSelector,
      rewrittenCandidates,
      fallbackCandidates: candidates,
      criticScores
    });
    if (shortlistResult.stats.visibleCount !== shortlistResult.stats.targetCount) {
      throw new Error(buildShortlistFailureMessage(shortlistResult.stats));
    }
    const shortlistEntries = shortlistResult.entries;
    const shortlist = shortlistEntries.map((entry) => entry.candidate);
    const resolvedFinalSelectorState = buildResolvedFinalSelectorState({
      visibleShortlist: shortlist,
      requestedFinalPickCandidateId: finalSelector.finalPick,
      shortlistStats: shortlistResult.stats
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

    const titlePrompt = buildTitlePrompt({
      channelConfig,
      videoContext: input.videoContext,
      selectorOutput,
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

    const diagnostics = buildRunDiagnostics({
      channelConfig,
      analyzerOutput,
      promptConfig,
      promptPacket,
      titlePrompt,
      workspaceCorpusCount,
      activeExamplesCount: availableExamples.length,
      selectorExamples: selectorPool.selectorExamples,
      selectorOutput,
      queryText
    });

    const shortlistOptionMap = resolvedFinalSelectorState.candidateOptionMap;
    const captionOptions = shortlistEntries.map((entry, index) => {
      const candidate = entry.candidate;
      return {
        option: index + 1,
        candidateId: candidate.candidateId,
        angle: candidate.angle,
        top: candidate.top,
        bottom: candidate.bottom,
        topRu: candidate.topRu,
        bottomRu: candidate.bottomRu,
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
    assertCompletedShortlistContract({
      captionOptions,
      candidateOptionMap: shortlistOptionMap,
      shortlistCandidateIds: resolvedFinalSelectorState.shortlistCandidateIds,
      finalPickCandidateId: resolvedFinalPickCandidateId
    });

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
      finalPick: {
        option: finalPickOption,
        reason: operatorFacingFinalReason
      },
      pipeline: {
        channelId: channelConfig.channelId,
        mode: "codex_pipeline",
        selectorOutput,
        availableExamplesCount: availableExamples.length,
        selectedExamplesCount: selectorOutput.selectedExamples?.length ?? 0,
        finalSelector: {
          candidateOptionMap: shortlistOptionMap,
          shortlistCandidateIds: resolvedFinalSelectorState.shortlistCandidateIds,
          finalPickCandidateId: resolvedFinalPickCandidateId,
          rationaleRaw: sanitizedRationaleRaw,
          rationaleInternalRaw: internalFinalSelectorReason,
          rationaleInternalModelRaw: finalSelector.rationale,
          shortlistStats: shortlistResult.stats
        }
      },
      diagnostics
    };

    return {
      output,
      warnings,
      promptPacket,
      diagnostics
    };
  }
}
