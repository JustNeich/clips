import type { Stage2Response } from "../app/components/types";
import type { Stage2HardConstraints } from "./stage2-channel-config";
import { validateStage2Output } from "./stage2-output-validation";
import { buildStage2Spec } from "./stage2-spec";
import {
  createEmptyStage2EditorialMemorySummary,
  DEFAULT_STAGE2_STYLE_PROFILE,
  type Stage2EditorialMemorySummary,
  type Stage2StyleProfile
} from "./stage2-channel-learning";
import type { JsonStageExecutor } from "./viral-shorts-worker/executor";
import {
  buildInternalFinalSelectorReason,
  buildOperatorFacingFinalReason,
  evaluateCandidateHardConstraints,
  repairCandidateForHardConstraints,
  sanitizeFinalSelectorModelRationale
} from "./viral-shorts-worker/service";
import type {
  CandidateCaption,
  SelectorOutput,
  Stage2DebugMode,
  Stage2Diagnostics,
  Stage2RegenerateBaseSnapshot,
  Stage2RunDebugArtifact,
  Stage2TokenUsage
} from "./viral-shorts-worker/types";

const QUICK_REGENERATE_PROMPT = [
  "Role:",
  "You are performing a fast Stage 2 regenerate for a viral Shorts workflow.",
  "",
  "Goal:",
  "- Rewrite the CURRENT visible caption and title options quickly without re-running the full pipeline.",
  "- Use the saved source context, the current visible options, and the user's instruction.",
  "",
  "Hard rules:",
  "- Keep exactly the same number of options as provided.",
  "- Keep the same option numbers.",
  "- Keep the same candidate_id values.",
  "- Keep the same angle labels.",
  "- Return one revised title paired with each revised caption option.",
  "- final_pick_option must point to one of the visible options.",
  "- Stay specific, visual, and grounded in the provided video-first source context.",
  "- Respect hard constraints exactly.",
  "- Keep final top, bottom, and title text in English only, even if user_instruction is written in Russian.",
  "- Use Russian only in top_ru, bottom_ru, and title_ru.",
  "- Do not mention hidden candidates or rerunning the pipeline.",
  "- Titles should feel like export-safe file titles, not subtitles.",
  "- Keep titles compact: 3-7 words, not the opening fragment of top/bottom.",
  "",
  "Tone rules:",
  "- Improve sharpness, specificity, pacing, and variety across the visible options.",
  "- If the user asks for a shorter/longer/funnier/more serious version, apply that request directly.",
  "- Preserve diversity across options instead of making five near-duplicates.",
  "- Do not smooth every bottom into the same continuation logic.",
  "- Remove stock tails like 'the reaction basically writes itself' or 'the whole room feels it immediately'.",
  "- Weak comments hints may help with harmless phrasing, but the video remains the main authority.",
  "- If a quoted opener is not earning its place, replace it with a more natural clip-specific start.",
  "- Never leave broken fragments after tightening."
].join("\n");

export const QUICK_REGENERATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["options", "final_pick_option", "selection_rationale"],
  properties: {
    options: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "option",
          "candidate_id",
          "angle",
          "top",
          "bottom",
          "top_ru",
          "bottom_ru",
          "title",
          "title_ru"
        ],
        properties: {
          option: { type: "integer", minimum: 1 },
          candidate_id: { type: "string", minLength: 1 },
          angle: { type: "string", minLength: 1 },
          top: { type: "string", minLength: 0 },
          bottom: { type: "string", minLength: 1 },
          top_ru: { type: "string", minLength: 0 },
          bottom_ru: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          title_ru: { type: "string", minLength: 1 }
        }
      }
    },
    final_pick_option: { type: "integer", minimum: 1 },
    selection_rationale: { type: "string", minLength: 1 }
  }
} as const;

export type QuickRegenerateModelOutput = {
  options?: Array<{
    option?: number;
    candidate_id?: string;
    angle?: string;
    top?: string;
    bottom?: string;
    top_ru?: string;
    bottom_ru?: string;
    title?: string;
    title_ru?: string;
  }>;
  final_pick_option?: number;
  selection_rationale?: string;
};

type QuickRegenerateBaseOption = {
  option: number;
  candidateId: string;
  angle: string;
  top: string;
  bottom: string;
  topRu: string;
  bottomRu: string;
  title: string;
  titleRu: string;
  styleDirectionIds: string[];
  explorationMode: "aligned" | "exploratory";
};

type QuickRegenerateChannelContext = {
  id: string;
  name: string;
  username: string;
  stage2HardConstraints: Stage2HardConstraints;
  stage2StyleProfile?: Stage2StyleProfile;
  editorialMemory?: Stage2EditorialMemorySummary;
};

const QUICK_REGENERATE_TITLE_MAX_WORDS = 7;
const QUICK_REGENERATE_TITLE_MAX_CHARS = 64;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeQuickRegenerateTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactQuickRegenerateTitle(value: string, fallback: string): string {
  const source = sanitizeQuickRegenerateTitle(value) || sanitizeQuickRegenerateTitle(fallback) || "Option";
  let words = source.split(/\s+/).filter(Boolean).slice(0, QUICK_REGENERATE_TITLE_MAX_WORDS);
  while (words.length > 3 && words.join(" ").length > QUICK_REGENERATE_TITLE_MAX_CHARS) {
    words = words.slice(0, -1);
  }
  return words.join(" ").trim() || "Option";
}

function buildFallbackSelectorOutput(
  stage2: Stage2Response,
  baseOptions: QuickRegenerateBaseOption[]
): SelectorOutput {
  const diagnostics = stage2.diagnostics;
  const selection = diagnostics?.selection;
  const primaryAngle = selection?.primaryAngle || baseOptions[0]?.angle || "regenerate";
  const rankedAngles =
    selection?.rankedAngles && selection.rankedAngles.length > 0
      ? selection.rankedAngles
      : Array.from(new Set(baseOptions.map((option) => option.angle)))
          .filter(Boolean)
          .map((angle, index) => ({
            angle,
            score: Math.max(1, 10 - index),
            why: index === 0 ? "Copied from the base run." : "Kept from the visible shortlist."
          }));
  return {
    clipType: selection?.clipType || "quick_regenerate",
    primaryAngle,
    secondaryAngles:
      selection?.secondaryAngles && selection.secondaryAngles.length > 0
        ? selection.secondaryAngles
        : rankedAngles.map((item) => item.angle).filter((angle) => angle !== primaryAngle).slice(0, 3),
    rankedAngles,
    coreTrigger: selection?.coreTrigger || stage2.output.inputAnalysis.keyPhraseToAdapt,
    humanStake: selection?.humanStake || stage2.output.inputAnalysis.commentVibe,
    narrativeFrame: selection?.narrativeFrame || "Quick regenerate from saved Stage 2 context.",
    whyViewerCares: selection?.whyViewerCares || "Viewer interest is inherited from the saved Stage 2 run.",
    topStrategy: selection?.topStrategy || "Sharpen the visible top lines without changing the shortlist size.",
    bottomEnergy: selection?.bottomEnergy || "Keep bottom lines quotable and reactive.",
    whyOldV6WouldWorkHere:
      selection?.whyOldV6WouldWorkHere || "Reuse the saved Stage 2 context instead of rebuilding it.",
    failureModes: selection?.failureModes ?? [],
    writerBrief: selection?.writerBrief || "Quick regenerate the visible shortlist only.",
    rationale: selection?.rationale ?? "Quick regenerate reused the saved selector context.",
    selectedExampleIds: selection?.selectedExampleIds ?? []
  };
}

function buildBaseOptions(stage2: Stage2Response): QuickRegenerateBaseOption[] {
  const titleByOption = new Map(stage2.output.titleOptions.map((option) => [option.option, option]));
  const diagnostics = stage2.diagnostics;
  const primaryAngle = diagnostics?.selection?.primaryAngle || "regenerate";
  return stage2.output.captionOptions.map((option, index) => {
    const titleOption = titleByOption.get(option.option);
    const fallbackCandidateId =
      typeof option.candidateId === "string" && option.candidateId.trim()
        ? option.candidateId.trim()
        : `option_${option.option}`;
    return {
      option: option.option,
      candidateId: fallbackCandidateId,
      angle:
        typeof option.angle === "string" && option.angle.trim()
          ? option.angle.trim()
          : index === 0
            ? primaryAngle
            : `${primaryAngle}_${option.option}`,
      top: option.top,
      bottom: option.bottom,
      topRu: option.topRu?.trim() || option.top,
      bottomRu: option.bottomRu?.trim() || option.bottom,
      title: titleOption?.title?.trim() || `Option ${option.option}`,
      titleRu: titleOption?.titleRu?.trim() || titleOption?.title?.trim() || `Option ${option.option}`,
      styleDirectionIds: option.styleDirectionIds ?? [],
      explorationMode: option.explorationMode === "exploratory" ? "exploratory" : "aligned"
    };
  });
}

function buildQuickRegeneratePromptPayload(
  stage2: Stage2Response,
  channel: QuickRegenerateChannelContext,
  baseOptions: QuickRegenerateBaseOption[],
  userInstruction: string | null
): Stage2RegenerateBaseSnapshot {
  const passedComments = stage2.source.topComments.slice(0, 6);
  return {
    channel: {
      id: channel.id,
      name: channel.name,
      username: channel.username,
      constraints: channel.stage2HardConstraints
    },
    source: {
      url: stage2.source.url,
      title: stage2.source.title,
      frameDescriptions: (stage2.source.frameDescriptions ?? []).slice(0, 4),
      topComments: passedComments.map((comment) => ({
        author: comment.author,
        likes: comment.likes,
        text: comment.text
      }))
    },
    analysis: {
      keyPhraseToAdapt: stage2.output.inputAnalysis.keyPhraseToAdapt,
      commentVibe: stage2.output.inputAnalysis.commentVibe,
      whyViewerCares: stage2.diagnostics?.selection?.whyViewerCares ?? "",
      weakCommentHints: passedComments.slice(0, 4).map((comment) => comment.text)
    },
    currentOptions: baseOptions,
    currentFinalPick: {
      option: stage2.output.finalPick.option,
      reason: stage2.output.finalPick.reason
    },
    userInstruction: userInstruction?.trim() || null
  };
}

export function buildQuickRegeneratePrompt(input: {
  stage2: Stage2Response;
  channel: QuickRegenerateChannelContext;
  userInstruction: string | null;
}): string {
  const baseOptions = buildBaseOptions(input.stage2);
  const promptPayload = buildQuickRegeneratePromptPayload(
    input.stage2,
    input.channel,
    baseOptions,
    input.userInstruction
  );
  return [
    "SYSTEM",
    QUICK_REGENERATE_PROMPT,
    "",
    "video_truth_json",
    JSON.stringify(promptPayload.source, null, 2),
    "",
    "comments_hint_json",
    JSON.stringify(
      {
        topComments: promptPayload.source.topComments,
        weakCommentHints: promptPayload.analysis.weakCommentHints ?? []
      },
      null,
      2
    ),
    "",
    "hard_constraints_json",
    JSON.stringify(promptPayload.channel.constraints, null, 2),
    "",
    "regenerate_context_json",
    JSON.stringify(
      {
        channel: {
          id: promptPayload.channel.id,
          name: promptPayload.channel.name,
          username: promptPayload.channel.username
        },
        analysis: {
          keyPhraseToAdapt: promptPayload.analysis.keyPhraseToAdapt,
          commentVibe: promptPayload.analysis.commentVibe,
          whyViewerCares: promptPayload.analysis.whyViewerCares
        },
        currentOptions: promptPayload.currentOptions,
        currentFinalPick: promptPayload.currentFinalPick
      },
      null,
      2
    ),
    "",
    "user_instruction",
    JSON.stringify(promptPayload.userInstruction)
  ].join("\n");
}

function buildQuickPromptStageDiagnostics(input: {
  baseResult: Stage2Response;
  channel: QuickRegenerateChannelContext;
  promptText: string;
  model: string | null;
  reasoningEffort: string | null;
  includePromptText?: boolean;
}): NonNullable<Stage2Diagnostics["effectivePrompting"]>["promptStages"][number] {
  const visibleOptions = input.baseResult.output.captionOptions ?? [];
  const passedQuickComments = input.baseResult.source.topComments.slice(0, 6);
  return {
    stageId: "regenerate",
    label: "Quick regenerate",
    stageType: "llm_prompt",
    defaultPrompt: QUICK_REGENERATE_PROMPT,
    configuredPrompt: QUICK_REGENERATE_PROMPT,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    isCustomPrompt: false,
    promptText: input.includePromptText ? input.promptText : null,
    promptTextAvailable: Boolean(input.promptText),
    promptChars: input.promptText.length,
    usesImages: false,
    summary: "Single LLM stage: rewrites the visible shortlist and paired titles from the saved Stage 2 run.",
    inputManifest: {
      learningDetail: "none",
      description: null,
      transcript: null,
      frames: {
        availableCount: input.baseResult.source.frameDescriptions?.length ?? 0,
        passedCount: input.baseResult.source.frameDescriptions?.length ?? 0,
        omittedCount: 0,
        truncated: false,
        limit: null
      },
      comments: {
        availableCount: input.baseResult.source.commentsUsedForPrompt ?? input.baseResult.source.topComments.length,
        passedCount: passedQuickComments.length,
        omittedCount: Math.max(
          0,
          (input.baseResult.source.commentsUsedForPrompt ?? input.baseResult.source.topComments.length) -
            passedQuickComments.length
        ),
        truncated:
          (input.baseResult.source.commentsUsedForPrompt ?? input.baseResult.source.topComments.length) >
          passedQuickComments.length,
        limit: null,
        passedCommentIds: passedQuickComments.map((comment) => comment.id)
      },
      examples: {
        availableCount: 0,
        passedCount: 0,
        omittedCount: 0,
        truncated: false,
        limit: null,
        activeCorpusCount: 0,
        promptPoolCount: 0,
        passedExampleIds: [],
        selectedExampleIds: [],
        rejectedExampleIds: [],
        retrievalConfidence: "low",
        examplesMode: "style_guided",
        examplesRoleSummary: "",
        primaryDriverSummary: ""
      },
      channelLearning: null,
      candidates: {
        passedCount: visibleOptions.length,
        passedCandidateIds: visibleOptions.map((option) => option.candidateId ?? `option_${option.option}`),
        criticScoreCount: null,
        shortlistCount: visibleOptions.length
      },
      stageFlags: [
        "single-stage quick regenerate",
        "video-first base context",
        "weak comments hints only",
        "rewrites only the visible shortlist and paired titles"
      ]
    }
  };
}

function upsertPromptStageByStageId(
  promptStages: NonNullable<Stage2Diagnostics["effectivePrompting"]>["promptStages"],
  nextStage: NonNullable<Stage2Diagnostics["effectivePrompting"]>["promptStages"][number]
): NonNullable<Stage2Diagnostics["effectivePrompting"]>["promptStages"] {
  const mergedStages = [...promptStages];
  const existingIndex = mergedStages.findIndex((stage) => stage.stageId === nextStage.stageId);
  if (existingIndex >= 0) {
    mergedStages.splice(existingIndex, 1, nextStage);
    return mergedStages;
  }
  mergedStages.push(nextStage);
  return mergedStages;
}

function buildQuickDiagnostics(input: {
  baseResult: Stage2Response;
  channel: QuickRegenerateChannelContext;
  promptText: string;
  model: string | null;
  reasoningEffort: string | null;
  selectorOutput: SelectorOutput;
  debugMode: Stage2DebugMode;
}): Stage2Diagnostics {
  const syntheticPromptStage = buildQuickPromptStageDiagnostics({
    baseResult: input.baseResult,
    channel: input.channel,
    promptText: input.promptText,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    includePromptText: false
  });
  if (input.baseResult.diagnostics) {
    return {
      ...input.baseResult.diagnostics,
      channel: {
        ...input.baseResult.diagnostics.channel,
        channelId: input.channel.id,
        name: input.channel.name,
        username: input.channel.username,
        hardConstraints: input.channel.stage2HardConstraints,
        styleProfile: DEFAULT_STAGE2_STYLE_PROFILE,
        editorialMemory: createEmptyStage2EditorialMemorySummary(DEFAULT_STAGE2_STYLE_PROFILE)
      },
      selection: input.baseResult.diagnostics.selection ?? {
        ...input.selectorOutput,
        rationale: input.selectorOutput.rationale ?? null
      },
      analysis:
        input.baseResult.diagnostics.analysis ?? {
          visualAnchors: [],
          specificNouns: [],
          visibleActions: [],
          firstSecondsSignal: "",
          sceneBeats: [],
          revealMoment: "",
          lateClipChange: "",
          whyViewerCares: "",
          bestBottomEnergy: "",
          commentVibe: "",
          commentConsensusLane: "",
          commentJokeLane: "",
          commentDissentLane: "",
          commentSuspicionLane: "",
          commentLanguageCues: [],
          uncertaintyNotes: [],
          rawSummary: ""
        },
      sourceContext:
        input.baseResult.diagnostics.sourceContext ?? {
          sourceUrl: input.baseResult.source.url,
          title: input.baseResult.source.title,
          descriptionChars: 0,
          transcriptChars: 0,
          speechGroundingStatus: "speech_uncertain",
          frameCount: input.baseResult.source.frameDescriptions?.length ?? 0,
          runtimeCommentCount:
            input.baseResult.source.commentsUsedForPrompt ?? input.baseResult.source.topComments.length,
          runtimeCommentIds: input.baseResult.source.allComments.map((comment) => comment.id),
          userInstructionChars: input.baseResult.userInstructionUsed?.trim().length ?? 0
        },
      effectivePrompting: {
        promptStages: upsertPromptStageByStageId(
          input.baseResult.diagnostics.effectivePrompting?.promptStages ?? [],
          syntheticPromptStage
        )
      },
      examples: input.baseResult.diagnostics.examples
        ? {
            ...input.baseResult.diagnostics.examples,
            source: "workspace_default",
            workspaceCorpusCount: 0,
            activeCorpusCount: 0,
            selectorCandidateCount: 0,
            retrievalConfidence: "low",
            examplesMode: "style_guided",
            explanation: "",
            evidence: [],
            retrievalWarning: null,
            examplesRoleSummary: "",
            primaryDriverSummary: "",
            primaryDrivers: [],
            channelStylePriority: "supporting",
            editorialMemoryPriority: "supporting",
            availableExamples: [],
            selectedExamples: []
          }
        : {
            source: "workspace_default",
            workspaceCorpusCount: 0,
            activeCorpusCount: 0,
            selectorCandidateCount: 0,
            retrievalConfidence: "low",
            examplesMode: "style_guided",
            explanation: "",
            evidence: [],
            retrievalWarning: null,
            examplesRoleSummary: "",
            primaryDriverSummary: "",
            primaryDrivers: [],
            channelStylePriority: "supporting",
            editorialMemoryPriority: "supporting",
            availableExamples: [],
            selectedExamples: []
          }
    };
  }

  return {
      channel: {
        channelId: input.channel.id,
        name: input.channel.name,
        username: input.channel.username,
        examplesSource: "workspace_default",
        hardConstraints: input.channel.stage2HardConstraints,
        styleProfile: DEFAULT_STAGE2_STYLE_PROFILE,
        editorialMemory: createEmptyStage2EditorialMemorySummary(DEFAULT_STAGE2_STYLE_PROFILE),
        workspaceCorpusCount: 0,
        activeCorpusCount: 0
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
      selectedExampleIds: input.selectorOutput.selectedExampleIds ?? []
    },
    analysis: {
      visualAnchors: [],
      specificNouns: [],
      visibleActions: [],
      firstSecondsSignal: "",
      sceneBeats: [],
      revealMoment: "",
      lateClipChange: "",
      whyViewerCares: "",
      bestBottomEnergy: "",
      commentVibe: "",
      commentConsensusLane: "",
      commentJokeLane: "",
      commentDissentLane: "",
      commentSuspicionLane: "",
      commentLanguageCues: [],
      uncertaintyNotes: [],
      rawSummary: ""
    },
    sourceContext: {
      sourceUrl: input.baseResult.source.url,
      title: input.baseResult.source.title,
      descriptionChars: 0,
      transcriptChars: 0,
      speechGroundingStatus: "speech_uncertain",
      frameCount: input.baseResult.source.frameDescriptions?.length ?? 0,
      runtimeCommentCount:
        input.baseResult.source.commentsUsedForPrompt ?? input.baseResult.source.topComments.length,
      runtimeCommentIds: input.baseResult.source.allComments.map((comment) => comment.id),
      userInstructionChars: input.baseResult.userInstructionUsed?.trim().length ?? 0
    },
    effectivePrompting: {
      promptStages: [syntheticPromptStage]
    },
    examples: {
      source: "workspace_default",
      workspaceCorpusCount: 0,
      activeCorpusCount: 0,
      selectorCandidateCount: 0,
      retrievalConfidence: "low",
      examplesMode: "style_guided",
      explanation: "",
      evidence: [],
      retrievalWarning: null,
      examplesRoleSummary: "",
      primaryDriverSummary: "",
      primaryDrivers: [],
      channelStylePriority: "supporting",
      editorialMemoryPriority: "supporting",
      availableExamples: [],
      selectedExamples: []
    }
  };
}

function sanitizeModelEntries(raw: QuickRegenerateModelOutput | null): Map<number, Record<string, unknown>> {
  const entries = new Map<number, Record<string, unknown>>();
  for (const entry of raw?.options ?? []) {
    const candidate = asRecord(entry);
    const option = asNumber(candidate?.option);
    if (!candidate || option === null || entries.has(option)) {
      continue;
    }
    entries.set(option, candidate);
  }
  return entries;
}

function buildFallbackBaseCandidate(option: QuickRegenerateBaseOption): CandidateCaption {
  return {
    candidateId: option.candidateId,
    angle: option.angle,
    top: option.top,
    bottom: option.bottom,
    topRu: option.topRu,
    bottomRu: option.bottomRu,
    rationale: "Reused from the base run.",
    styleDirectionIds: option.styleDirectionIds,
    explorationMode: option.explorationMode
  };
}

export function buildQuickRegenerateResult(input: {
  runId: string;
  createdAt: string;
  mode: "regenerate";
  baseRunId: string;
  baseResult: Stage2Response;
  channel: QuickRegenerateChannelContext;
  userInstruction: string | null;
  promptText: string;
  reasoningEffort: string | null;
  model: string | null;
  rawOutput: QuickRegenerateModelOutput | null;
  debugMode?: Stage2DebugMode;
}): {
  response: Stage2Response;
  rawDebugArtifact: Stage2RunDebugArtifact | null;
  tokenUsage: Stage2TokenUsage;
} {
  const baseOptions = buildBaseOptions(input.baseResult);
  const rawEntries = sanitizeModelEntries(input.rawOutput);
  const warnings: Stage2Response["warnings"] = [
    {
      field: "regenerate",
      message: "Quick regenerate reused the saved video-first base context and rewrote only the visible shortlist."
    }
  ];
  if (input.baseResult.seo) {
    warnings.push({
      field: "seo",
      message: "SEO reused from base run; запустите полный Stage 2 для refresh."
    });
  }
  if (rawEntries.size !== baseOptions.length) {
    warnings.push({
      field: "regenerate",
      message: `Quick regenerate returned ${rawEntries.size} options; restored missing options from the base run.`
    });
  }

  let fallbackCount = 0;
  const normalizedOptions = baseOptions.map((baseOption) => {
    const rawEntry = rawEntries.get(baseOption.option);
    const generatedCandidate: CandidateCaption = {
      candidateId: baseOption.candidateId,
      angle: baseOption.angle,
      top: asString(rawEntry?.top, baseOption.top) || baseOption.top,
      bottom: asString(rawEntry?.bottom, baseOption.bottom) || baseOption.bottom,
      topRu: asString(rawEntry?.top_ru, baseOption.topRu) || baseOption.topRu,
      bottomRu: asString(rawEntry?.bottom_ru, baseOption.bottomRu) || baseOption.bottomRu,
      rationale: "Quick regenerate revision.",
      styleDirectionIds: baseOption.styleDirectionIds,
      explorationMode: baseOption.explorationMode
    };
    const repaired = repairCandidateForHardConstraints(
      generatedCandidate,
      input.channel.stage2HardConstraints
    );
    const constraintCheck = evaluateCandidateHardConstraints(
      repaired.candidate,
      input.channel.stage2HardConstraints,
      repaired.repaired
    );
    if (repaired.valid && constraintCheck.passed) {
      return {
        option: baseOption.option,
        candidate: repaired.candidate,
        constraintCheck,
        title: compactQuickRegenerateTitle(asString(rawEntry?.title, baseOption.title), baseOption.title),
        titleRu: compactQuickRegenerateTitle(asString(rawEntry?.title_ru, baseOption.titleRu), baseOption.titleRu)
      };
    }

    fallbackCount += 1;
    const baseCandidate = buildFallbackBaseCandidate(baseOption);
    const baseRepaired = repairCandidateForHardConstraints(
      baseCandidate,
      input.channel.stage2HardConstraints
    );
    return {
      option: baseOption.option,
      candidate: baseRepaired.candidate,
      constraintCheck: evaluateCandidateHardConstraints(
        baseRepaired.candidate,
        input.channel.stage2HardConstraints,
        baseRepaired.repaired
      ),
      title: compactQuickRegenerateTitle(baseOption.title, `Option ${baseOption.option}`),
      titleRu: compactQuickRegenerateTitle(baseOption.titleRu, baseOption.title)
    };
  });
  if (fallbackCount > 0) {
    warnings.push({
      field: "regenerate",
      message: `${fallbackCount} option(s) failed quick-regenerate validation and were restored from the base run.`
    });
  }

  const visibleShortlist = normalizedOptions.map((entry) => entry.candidate);
  const candidateOptionMap = normalizedOptions.map((entry) => ({
    option: entry.option,
    candidateId: entry.candidate.candidateId
  }));
  const rawFinalPickOption = asNumber(input.rawOutput?.final_pick_option);
  const resolvedFinalPickOption =
    rawFinalPickOption !== null &&
    normalizedOptions.some((entry) => entry.option === rawFinalPickOption)
      ? rawFinalPickOption
      : normalizedOptions.some((entry) => entry.option === input.baseResult.output.finalPick.option)
        ? input.baseResult.output.finalPick.option
        : normalizedOptions[0]?.option ?? 1;
  const resolvedFinalPickCandidateId =
    normalizedOptions.find((entry) => entry.option === resolvedFinalPickOption)?.candidate.candidateId ??
    visibleShortlist[0]?.candidateId ??
    `option_${resolvedFinalPickOption}`;
  const { operatorReason } = buildOperatorFacingFinalReason({
    shortlist: visibleShortlist,
    shortlistOptionMap: candidateOptionMap,
    finalPickCandidateId: resolvedFinalPickCandidateId
  });
  const selectorOutput = buildFallbackSelectorOutput(input.baseResult, baseOptions);
  const diagnostics = buildQuickDiagnostics({
    baseResult: input.baseResult,
    channel: input.channel,
    promptText: input.promptText,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    selectorOutput,
    debugMode: input.debugMode === "raw" ? "raw" : "summary"
  });
  const basePipeline = asRecord((input.baseResult.output as Record<string, unknown>).pipeline);
  const availableExamplesCount =
    asNumber(basePipeline?.availableExamplesCount) ??
    diagnostics.examples.workspaceCorpusCount ??
    0;
  const selectedExamplesCount =
    asNumber(basePipeline?.selectedExamplesCount) ??
    diagnostics.examples.selectedExamples.length ??
    0;

  const output: Stage2Response["output"] = {
    ...input.baseResult.output,
    inputAnalysis: input.baseResult.output.inputAnalysis,
    captionOptions: normalizedOptions.map((entry) => ({
      option: entry.option,
      candidateId: entry.candidate.candidateId,
      angle: entry.candidate.angle,
      top: entry.candidate.top,
      bottom: entry.candidate.bottom,
      topRu: entry.candidate.topRu,
      bottomRu: entry.candidate.bottomRu,
      styleDirectionIds: entry.candidate.styleDirectionIds,
      explorationMode: entry.candidate.explorationMode,
      constraintCheck: entry.constraintCheck
    })),
    titleOptions: normalizedOptions.map((entry) => ({
      option: entry.option,
      title: entry.title,
      titleRu: entry.titleRu || entry.title
    })),
    finalPick: {
      option: resolvedFinalPickOption,
      reason: operatorReason
    },
    pipeline: {
      channelId: input.channel.id,
      mode: "regenerate",
      selectorOutput,
      availableExamplesCount,
      selectedExamplesCount,
      finalSelector: {
        candidateOptionMap,
        shortlistCandidateIds: visibleShortlist.map((candidate) => candidate.candidateId),
        finalPickCandidateId: resolvedFinalPickCandidateId,
        rationaleRaw: operatorReason,
        rationaleInternalRaw: buildInternalFinalSelectorReason({
          evaluatedShortlist: visibleShortlist,
          visibleShortlist,
          finalPickCandidateId: resolvedFinalPickCandidateId
        }),
        rationaleInternalModelRaw: sanitizeFinalSelectorModelRationale({
          rawRationale:
            asString(input.rawOutput?.selection_rationale) ||
            "Quick regenerate selection rationale unavailable.",
          visibleShortlist,
          finalPickCandidateId: resolvedFinalPickCandidateId
        })
      }
    }
  };

  warnings.push(...validateStage2Output(output, input.channel.stage2HardConstraints));

  const rawDebugArtifact =
    input.debugMode === "raw"
      ? {
          kind: "stage2-run-debug" as const,
          runId: input.runId,
          createdAt: input.createdAt,
          promptStages: [
            buildQuickPromptStageDiagnostics({
              baseResult: input.baseResult,
              channel: input.channel,
              promptText: input.promptText,
              model: input.model,
              reasoningEffort: input.reasoningEffort,
              includePromptText: true
            })
          ]
        }
      : null;
  const promptChars = input.promptText.length;
  const tokenUsage: Stage2TokenUsage = {
    stages: [
      {
        stageId: "regenerate",
        promptChars,
        estimatedInputTokens: Math.max(1, Math.ceil(promptChars / 4)),
        estimatedOutputTokens: Math.max(1, Math.ceil((JSON.stringify(input.rawOutput ?? {})?.length ?? 0) / 4)),
        serializedResultBytes: JSON.stringify(output).length,
        persistedPayloadBytes: 0
      }
    ],
    totalPromptChars: promptChars,
    totalEstimatedInputTokens: Math.max(1, Math.ceil(promptChars / 4)),
    totalEstimatedOutputTokens: Math.max(1, Math.ceil((JSON.stringify(input.rawOutput ?? {})?.length ?? 0) / 4)),
    totalSerializedResultBytes: JSON.stringify(output).length,
    totalPersistedPayloadBytes: 0
  };
  const response: Stage2Response = {
    source: { ...input.baseResult.source },
    stage2Spec: buildStage2Spec({
      name: "Viral Shorts Quick Regenerate",
      outputSections: [
        "inputAnalysis",
        `captionOptions(${output.captionOptions.length})`,
        `titleOptions(${output.titleOptions.length})`,
        "finalPick",
        "seo(reused)",
        "diagnostics(base provenance + regenerate prompt)"
      ],
      hardConstraints: input.channel.stage2HardConstraints,
      enforcedVia: "Saved Stage 2 base run + single-shot quick regenerate + post-validation"
    }),
    output,
    seo: input.baseResult.seo ?? null,
    warnings,
    diagnostics,
    progress: input.baseResult.progress ?? null,
    model: input.model ?? "default",
    reasoningEffort: input.reasoningEffort ?? undefined,
    userInstructionUsed: input.userInstruction,
    stage2Worker: {
      runId: input.runId
    },
    stage2Run: {
      runId: input.runId,
      mode: input.mode,
      baseRunId: input.baseRunId,
      createdAt: input.createdAt
    },
    channel: {
      id: input.channel.id,
      name: input.channel.name,
      username: input.channel.username
    }
  };
  return {
    response,
    rawDebugArtifact,
    tokenUsage
  };
}

export async function runQuickRegenerateModel(input: {
  stage2: Stage2Response;
  channel: QuickRegenerateChannelContext;
  userInstruction: string | null;
  executor: JsonStageExecutor;
  model?: string | null;
  reasoningEffort: string | null;
}): Promise<{
  promptText: string;
  rawOutput: QuickRegenerateModelOutput | null;
}> {
  const promptText = buildQuickRegeneratePrompt({
    stage2: input.stage2,
    channel: input.channel,
    userInstruction: input.userInstruction
  });
  const rawOutput = await input.executor.runJson<QuickRegenerateModelOutput>({
    stageId: "regenerate",
    prompt: promptText,
    schema: QUICK_REGENERATE_SCHEMA,
    model: input.model ?? null,
    reasoningEffort: input.reasoningEffort
  });
  return {
    promptText,
    rawOutput
  };
}
