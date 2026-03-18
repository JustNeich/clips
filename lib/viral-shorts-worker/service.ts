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
import {
  STAGE2_PIPELINE_STAGES,
  Stage2PipelineStageId,
  Stage2PromptConfig,
  normalizeStage2PromptConfig
} from "../stage2-pipeline";
import { Stage2PromptConfigStageId } from "../stage2-prompt-specs";
import { CommentItem } from "../comments";
import { JsonStageExecutor } from "./executor";

const ANALYZER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "visual_anchors",
    "subject",
    "setting",
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
    raw_summary: { type: "string", minLength: 1 }
  }
} as const;

const SELECTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clip_type", "selected_example_ids", "writer_brief"],
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
    selection_rationale: { type: "string", minLength: 1 },
    rationale: { type: "string", minLength: 1 },
    writer_brief: { type: "string", minLength: 1 }
    ,
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;

const CANDIDATES_SCHEMA = {
  type: ["array", "object"],
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
  },
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

const CRITIC_SCHEMA = {
  type: ["array", "object"],
  items: {
    type: "object",
    additionalProperties: false,
    required: ["candidate_id", "scores", "total", "issues", "keep"],
    properties: {
      candidate_id: { type: "string", minLength: 1 },
      scores: {
        type: "object",
        additionalProperties: { type: "number" }
      },
      total: { type: "number" },
      issues: {
        type: "array",
        items: { type: "string" }
      },
      keep: { type: "boolean" }
    }
  },
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
            additionalProperties: { type: "number" }
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
  type: ["array", "object"],
  minItems: 5,
  maxItems: 5,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["title_id", "title", "title_ru", "rationale"],
    properties: {
      title_id: { type: "string", minLength: 1 },
      option: { type: "integer", minimum: 1, maximum: 5 },
      title: { type: "string", minLength: 1 },
      titleRu: { type: "string", minLength: 1 },
      title_ru: { type: "string", minLength: 1 },
      rationale: { type: "string", minLength: 1 }
    }
  },
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
  const slangToAdaptRaw = Array.isArray(obj.slang_to_adapt)
    ? obj.slang_to_adapt
    : Array.isArray(obj.extractable_slang)
      ? obj.extractable_slang
      : Array.isArray(obj.slangToAdapt)
        ? obj.slangToAdapt
        : Array.isArray(obj.extractableSlang)
          ? obj.extractableSlang
          : fallback.slangToAdapt;

  return {
    visualAnchors: visualAnchorsRaw
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .slice(0, 5),
    specificNouns: specificNounsRaw
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .slice(0, 8),
    visibleActions: visibleActionsRaw
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .slice(0, 5),
    subject: String(obj.subject ?? fallback.subject).trim() || fallback.subject,
    action:
      String(obj.action ?? visibleActionsRaw[0] ?? fallback.action).trim() ||
      fallback.action,
    setting: String(obj.setting ?? fallback.setting).trim() || fallback.setting,
    firstSecondsSignal:
      String(obj.first_seconds_signal ?? obj.firstSecondsSignal ?? fallback.firstSecondsSignal).trim() ||
      fallback.firstSecondsSignal,
    stakes: (Array.isArray(obj.stakes) ? obj.stakes : fallback.stakes)
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
    payoff: String(obj.payoff ?? fallback.payoff).trim() || fallback.payoff,
    coreTrigger:
      String(obj.core_trigger ?? obj.coreTrigger ?? fallback.coreTrigger).trim() ||
      fallback.coreTrigger,
    humanStake:
      String(obj.human_stake ?? obj.humanStake ?? fallback.humanStake).trim() ||
      fallback.humanStake,
    narrativeFrame:
      String(obj.narrative_frame ?? obj.narrativeFrame ?? fallback.narrativeFrame).trim() ||
      fallback.narrativeFrame,
    whyViewerCares:
      String(obj.why_viewer_cares ?? obj.whyViewerCares ?? fallback.whyViewerCares).trim() ||
      fallback.whyViewerCares,
    bestBottomEnergy:
      String(obj.best_bottom_energy ?? obj.bestBottomEnergy ?? fallback.bestBottomEnergy).trim() ||
      fallback.bestBottomEnergy,
    commentVibe:
      String(obj.comment_vibe ?? obj.commentVibe ?? fallback.commentVibe).trim() ||
      fallback.commentVibe,
    slangToAdapt: slangToAdaptRaw
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .slice(0, 5),
    extractableSlang: slangToAdaptRaw
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .slice(0, 5),
    hiddenDetail:
      String(obj.hidden_detail ?? obj.hiddenDetail ?? fallback.hiddenDetail).trim() ||
      fallback.hiddenDetail,
    genericRisks: (Array.isArray(obj.generic_risks) ? obj.generic_risks : fallback.genericRisks)
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .slice(0, 6),
    rawSummary:
      String(obj.raw_summary ?? obj.rawSummary ?? fallback.rawSummary).trim() ||
      fallback.rawSummary
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
    analyzerOutput.stakes.join(" "),
    analyzerOutput.payoff,
    analyzerOutput.coreTrigger,
    analyzerOutput.humanStake,
    analyzerOutput.narrativeFrame,
    analyzerOutput.whyViewerCares,
    analyzerOutput.bestBottomEnergy,
    analyzerOutput.hiddenDetail,
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

function fallbackSelectorOutput(
  channelConfig: Stage2RuntimeChannelConfig,
  analyzerOutput: AnalyzerOutput,
  availableExamples: Stage2CorpusExample[],
  videoContext: ViralShortsVideoContext
): SelectorOutput {
  const queryText = buildCorpusQueryText(videoContext, analyzerOutput);
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
  const primaryAngle =
    String(
      obj.primary_angle ??
        obj.primaryAngle ??
        (Array.isArray(rankedAnglesRaw) ? (rankedAnglesRaw[0] as Record<string, unknown> | undefined)?.angle : null) ??
        fallback.primaryAngle ??
        fallback.rankedAngles[0]?.angle ??
        "payoff_reveal"
    ).trim() || fallback.primaryAngle;
  const secondaryAnglesRaw = Array.isArray(obj.secondary_angles)
    ? obj.secondary_angles
    : Array.isArray(obj.secondaryAngles)
      ? obj.secondaryAngles
      : fallback.secondaryAngles;
  const secondaryAngles = secondaryAnglesRaw
    .map((value) => String(value ?? "").trim())
    .filter((value) => Boolean(value) && value !== primaryAngle)
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
        if (!angle || !why || !Number.isFinite(score)) {
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
      why:
        fallback.rankedAngles.find((item) => item.angle === angle)?.why ??
        (index === 0
          ? "Primary selector angle chosen by the LLM."
          : "Backup selector angle kept as a viable alternative.")
    }));

  return {
    clipType: String(obj.clip_type ?? obj.clipType ?? fallback.clipType).trim() || fallback.clipType,
    primaryAngle,
    secondaryAngles:
      secondaryAngles.length >= 1
        ? secondaryAngles
        : fallback.secondaryAngles.filter((angle) => angle !== primaryAngle).slice(0, 3),
    rankedAngles:
      rankedAnglesNormalized.length >= 1
        ? rankedAnglesNormalized
        : synthesizedRankedAngles.length >= 1
          ? synthesizedRankedAngles
          : fallback.rankedAngles,
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
      const fallbackAngle = selectorOutput.rankedAngles[0]?.angle ?? "visual_payoff";
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

function candidateMeetsHardConstraints(
  candidate: CandidateCaption,
  constraints: Stage2HardConstraints
): boolean {
  const topLength = candidate.top.length;
  const bottomLength = candidate.bottom.length;
  if (topLength < constraints.topLengthMin || topLength > constraints.topLengthMax) {
    return false;
  }
  if (bottomLength < constraints.bottomLengthMin || bottomLength > constraints.bottomLengthMax) {
    return false;
  }
  if (constraints.bottomQuoteRequired && !candidate.bottom.includes("\"")) {
    return false;
  }
  if (containsBannedContent(candidate.top, constraints) || containsBannedContent(candidate.bottom, constraints)) {
    return false;
  }
  if (startsWithBannedOpener(candidate.top, constraints)) {
    return false;
  }
  return true;
}

function buildShortlist(input: {
  constraints: Stage2HardConstraints;
  finalSelector: FinalSelectorOutput;
  rewrittenCandidates: CandidateCaption[];
  fallbackCandidates: CandidateCaption[];
  criticScores: CriticScore[];
}): CandidateCaption[] {
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
    .map((candidateId) => byId.get(candidateId)!)
    .sort((left, right) => (scoreMap.get(right.candidateId) ?? 0) - (scoreMap.get(left.candidateId) ?? 0));

  const strict = orderedPool.filter((candidate) => candidateMeetsHardConstraints(candidate, input.constraints));
  const shortlist = strict.slice(0, 5);
  if (shortlist.length >= 5) {
    return shortlist;
  }
  for (const candidate of orderedPool) {
    if (shortlist.some((item) => item.candidateId === candidate.candidateId)) {
      continue;
    }
    shortlist.push(candidate);
    if (shortlist.length === 5) {
      break;
    }
  }
  return shortlist.slice(0, 5);
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
  const titleOptionsRaw = Array.isArray((raw as { titleOptions?: unknown })?.titleOptions)
    ? ((raw as { titleOptions: unknown[] }).titleOptions ?? [])
    : Array.isArray(raw)
      ? raw
      : [];

  const normalized = titleOptionsRaw
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const item = entry as Record<string, unknown>;
      const titleId = String(item.title_id ?? item.titleId ?? "").trim();
      const parsedOption = titleId.match(/(\d+)/)?.[1];
      return {
        option:
          Number.isFinite(Number(item.option))
            ? Number(item.option)
            : Number.isFinite(Number(parsedOption))
              ? Number(parsedOption)
              : index + 1,
        title: String(item.title ?? "").trim(),
        titleRu: String(item.titleRu ?? item.title_ru ?? item.title ?? "").trim()
      };
    })
    .filter(
      (item): item is { option: number; title: string; titleRu: string } =>
        item !== null && Boolean(item.title) && Boolean(item.titleRu)
    )
    .slice(0, 5);

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
  if (typeof example.qualityScore === "number") {
    reasons.push(`quality ${example.qualityScore.toFixed(2)}`);
  }
  return {
    bucket,
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
  promptConfig: Stage2PromptConfig | null;
  promptPacket: PromptPacket;
  titlePrompt: string;
  workspaceCorpusCount: number;
  availableExamples: Stage2CorpusExample[];
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
      activeCorpusCount: input.availableExamples.length
    },
    selection: {
      clipType: input.selectorOutput.clipType,
      rankedAngles: input.selectorOutput.rankedAngles,
      writerBrief: input.selectorOutput.writerBrief,
      rationale: input.selectorOutput.rationale ?? null,
      selectedExampleIds
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
      activeCorpusCount: input.availableExamples.length,
      availableExamples: input.availableExamples.map((example) =>
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
    const selectorOutput = fallbackSelectorOutput(channelConfig, heuristicOutput, corpus, input.videoContext);
    return buildPromptPacket({
      channelConfig,
      videoContext: input.videoContext,
      analyzerOutput: heuristicOutput,
      selectorOutput,
      availableExamples: corpus,
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
      detail: "Разбираем кадры, title и комментарии."
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
        detail: `Нашли ${analyzerOutput.visualAnchors.length} visual anchors.`
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

    const selectorPrompt = buildSelectorPrompt({
      channelConfig,
      videoContext: input.videoContext,
      analyzerOutput,
      availableExamples,
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
    const selectorFallback = fallbackSelectorOutput(channelConfig, analyzerOutput, availableExamples, input.videoContext);
    let selectorOutput = selectorFallback;
    try {
      const selectorRaw = await input.executor.runJson<unknown>({
        prompt: selectorPrompt,
        schema: SELECTOR_SCHEMA,
        reasoningEffort: selectorReasoningEffort
      });
      selectorOutput = normalizeSelectorOutput(selectorRaw, selectorFallback, availableExamples);
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
      availableExamples,
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
        rewrittenCandidates = normalizedRewrites;
      }
      await reportProgress({
        stageId: "rewriter",
        state: "completed",
        durationMs: Date.now() - rewriterStartedAt,
        promptChars: rewriterPrompt.length,
        reasoningEffort: rewriterReasoningEffort,
        detail: `${rewrittenCandidates.length} finalists polished.`
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
      await reportProgress({
        stageId: "finalSelector",
        state: "completed",
        durationMs: Date.now() - finalSelectorStartedAt,
        promptChars: finalSelectorPrompt.length,
        reasoningEffort: finalSelectorReasoningEffort,
        detail: `Shortlist ${finalSelector.finalCandidates.length} / pick ${finalSelector.finalPick}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Final selector fallback used.";
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
      await reportProgress({
        stageId: "finalSelector",
        state: "completed",
        durationMs: Date.now() - finalSelectorStartedAt,
        promptChars: finalSelectorPrompt.length,
        reasoningEffort: finalSelectorReasoningEffort,
        detail: `Fallback used: ${message}`
      });
    }

    const shortlist = buildShortlist({
      constraints: channelConfig.hardConstraints,
      finalSelector,
      rewrittenCandidates,
      fallbackCandidates: candidates,
      criticScores
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

    const queryText = buildCorpusQueryText(input.videoContext, analyzerOutput);
    const diagnostics = buildRunDiagnostics({
      channelConfig,
      promptConfig,
      promptPacket,
      titlePrompt,
      workspaceCorpusCount,
      availableExamples,
      selectorOutput,
      queryText
    });

    const captionOptions = shortlist.map((candidate, index) => ({
      option: index + 1,
      top: candidate.top,
      bottom: candidate.bottom,
      topRu: candidate.topRu,
      bottomRu: candidate.bottomRu
    }));
    const finalPickOption = Math.max(
      1,
      captionOptions.findIndex((option) => shortlist[option.option - 1]?.candidateId === finalSelector.finalPick) + 1
    );

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
        reason: finalSelector.rationale
      },
      pipeline: {
        channelId: channelConfig.channelId,
        mode: "codex_pipeline",
        selectorOutput,
        availableExamplesCount: availableExamples.length,
        selectedExamplesCount: selectorOutput.selectedExamples?.length ?? 0
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
