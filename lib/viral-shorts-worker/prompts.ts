import {
  AnalyzerOutput,
  CandidateCaption,
  CriticScore,
  PreparedGenerationContext,
  PromptPacket,
  SelectorOutput,
  Stage2RuntimeChannelConfig,
  ViralShortsVideoContext
} from "./types";
import { Stage2PromptConfig } from "../stage2-pipeline";
import {
  STAGE2_DEFAULT_REASONING_EFFORTS,
  STAGE2_DEFAULT_STAGE_PROMPTS,
  Stage2PromptConfigStageId,
  Stage2ReasoningEffort
} from "../stage2-prompt-specs";

const BASE_STYLE_RULES = [
  "Role:",
  "You are building viral Shorts overlay candidates for a US audience.",
  "Stay visually anchored, channel-aware, and specific.",
  "",
  "Core rules:",
  "- Match what the paused frame visibly shows right now.",
  "- Use concrete nouns and actions, not abstractions.",
  "- Never use emojis.",
  "- Respect hard constraints exactly.",
  "- Use examples as conditioning, not as lines to copy."
].join("\n");

export type Stage2PromptTemplateKind = "llm_system";

export type ResolvedStage2PromptTemplate = {
  stageId: Stage2PromptConfigStageId;
  stageType: "llm_prompt";
  templateKind: Stage2PromptTemplateKind;
  defaultPrompt: string;
  configuredPrompt: string;
  reasoningEffort: Stage2ReasoningEffort;
  isCustomPrompt: boolean;
};

function renderPrompt(system: string, payload: unknown): string {
  return [`SYSTEM`, system.trim(), ``, `USER CONTEXT JSON`, JSON.stringify(payload, null, 2)].join(
    "\n"
  );
}

function renderTemplate(template: string, bindings: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => bindings[key] ?? "");
}

export function resolveStage2PromptTemplate(
  stageId: Stage2PromptConfigStageId,
  promptConfig?: Stage2PromptConfig | null
): ResolvedStage2PromptTemplate {
  const defaultPrompt = STAGE2_DEFAULT_STAGE_PROMPTS[stageId];
  const stageConfig = promptConfig?.stages[stageId];
  const configuredPrompt = stageConfig?.prompt?.trim() || defaultPrompt;
  const reasoningEffort =
    stageConfig?.reasoningEffort ?? STAGE2_DEFAULT_REASONING_EFFORTS[stageId];
  return {
    stageId,
    stageType: "llm_prompt",
    templateKind: "llm_system",
    defaultPrompt,
    configuredPrompt,
    reasoningEffort,
    isCustomPrompt: configuredPrompt !== defaultPrompt
  };
}

function buildChannelPayload(channelConfig: Stage2RuntimeChannelConfig) {
  return {
    channel: channelConfig.name,
    channelId: channelConfig.channelId,
    username: channelConfig.username,
    examplesSource: channelConfig.examplesSource,
    constraints: channelConfig.hardConstraints
  };
}

function buildSystemPrompt(
  stageId: Stage2PromptConfigStageId,
  promptConfig: Stage2PromptConfig | null | undefined
): string {
  const resolved = resolveStage2PromptTemplate(stageId, promptConfig);
  return renderTemplate(resolved.configuredPrompt, {
    baseStyleRules: BASE_STYLE_RULES
  }).trim();
}

function buildSelectorContext(selectorOutput: SelectorOutput): string {
  return [
    `clip_type: ${selectorOutput.clipType}`,
    `primary_angle: ${selectorOutput.primaryAngle}`,
    `secondary_angles: ${selectorOutput.secondaryAngles.join(", ")}`,
    `core_trigger: ${selectorOutput.coreTrigger}`,
    `human_stake: ${selectorOutput.humanStake}`,
    `narrative_frame: ${selectorOutput.narrativeFrame}`,
    `why_viewer_cares: ${selectorOutput.whyViewerCares}`,
    `top_strategy: ${selectorOutput.topStrategy}`,
    `bottom_energy: ${selectorOutput.bottomEnergy}`,
    `why_old_v6_would_work_here: ${selectorOutput.whyOldV6WouldWorkHere}`,
    `failure_modes: ${selectorOutput.failureModes.join("; ")}`,
    `ranked_angles: ${selectorOutput.rankedAngles
      .map((item) => `${item.angle} (${item.score.toFixed(1)}: ${item.why})`)
      .join("; ")}`,
    `selected_example_ids: ${(selectorOutput.selectedExampleIds ?? []).join(", ")}`,
    `rejected_example_ids: ${(selectorOutput.rejectedExampleIds ?? []).join(", ")}`,
    `selection_rationale: ${selectorOutput.rationale ?? ""}`,
    `confidence: ${selectorOutput.confidence ?? ""}`,
    `writer_brief: ${selectorOutput.writerBrief}`
  ].join("\n");
}

export function buildAnalyzerPrompt(
  channelConfig: Stage2RuntimeChannelConfig,
  videoContext: ViralShortsVideoContext,
  heuristicAnalyzer: AnalyzerOutput,
  promptConfig?: Stage2PromptConfig | null
): string {
  return renderPrompt(buildSystemPrompt("analyzer", promptConfig), {
    ...buildChannelPayload(channelConfig),
    videoContext,
    heuristicAnalyzer
  });
}

export function buildSelectorPrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  videoContext: ViralShortsVideoContext;
  analyzerOutput: AnalyzerOutput;
  availableExamples: PreparedGenerationContext["availableExamples"];
  promptConfig?: Stage2PromptConfig | null;
}): string {
  return renderPrompt(buildSystemPrompt("selector", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig),
    videoContext: {
      sourceUrl: input.videoContext.sourceUrl,
      title: input.videoContext.title,
      description: input.videoContext.description,
      transcript: input.videoContext.transcript,
      frameDescriptions: input.videoContext.frameDescriptions,
      comments: input.videoContext.comments
    },
    analyzerOutput: input.analyzerOutput,
    availableExamples: input.availableExamples ?? []
  });
}

export function buildWriterPrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  userInstruction?: string | null;
  promptConfig?: Stage2PromptConfig | null;
}): string {
  return renderPrompt(buildSystemPrompt("writer", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig),
    analyzerOutput: input.analyzerOutput,
    selectorOutput: {
      ...input.selectorOutput,
      selectorContext: buildSelectorContext(input.selectorOutput)
    },
    selectedExamples: input.selectorOutput.selectedExamples ?? [],
    userInstruction: input.userInstruction?.trim() || null
  });
}

export function buildCriticPrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  candidates: CandidateCaption[];
  promptConfig?: Stage2PromptConfig | null;
}): string {
  return renderPrompt(buildSystemPrompt("critic", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig),
    analyzerOutput: input.analyzerOutput,
    selectorOutput: {
      ...input.selectorOutput,
      selectorContext: buildSelectorContext(input.selectorOutput)
    },
    candidates: input.candidates
  });
}

export function buildRewriterPrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  candidates: CandidateCaption[];
  criticScores: CriticScore[];
  userInstruction?: string | null;
  promptConfig?: Stage2PromptConfig | null;
}): string {
  return renderPrompt(buildSystemPrompt("rewriter", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig),
    analyzerOutput: input.analyzerOutput,
    selectorOutput: {
      ...input.selectorOutput,
      selectorContext: buildSelectorContext(input.selectorOutput)
    },
    selectedExamples: input.selectorOutput.selectedExamples ?? [],
    criticScores: input.criticScores,
    candidates: input.candidates,
    userInstruction: input.userInstruction?.trim() || null
  });
}

export function buildFinalSelectorPrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  candidates: CandidateCaption[];
  promptConfig?: Stage2PromptConfig | null;
}): string {
  return renderPrompt(buildSystemPrompt("finalSelector", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig),
    analyzerOutput: input.analyzerOutput,
    selectorOutput: {
      ...input.selectorOutput,
      selectorContext: buildSelectorContext(input.selectorOutput)
    },
    candidates: input.candidates
  });
}

export function buildTitlePrompt(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  videoContext: ViralShortsVideoContext;
  selectorOutput: SelectorOutput;
  shortlist: CandidateCaption[];
  userInstruction?: string | null;
  promptConfig?: Stage2PromptConfig | null;
}): string {
  return renderPrompt(buildSystemPrompt("titles", input.promptConfig), {
    ...buildChannelPayload(input.channelConfig),
    videoContext: {
      sourceUrl: input.videoContext.sourceUrl,
      title: input.videoContext.title,
      frameDescriptions: input.videoContext.frameDescriptions
    },
    selectorOutput: {
      ...input.selectorOutput,
      selectorContext: buildSelectorContext(input.selectorOutput)
    },
    shortlist: input.shortlist,
    userInstruction: input.userInstruction?.trim() || null
  });
}

export function buildPromptPacket(input: {
  channelConfig: Stage2RuntimeChannelConfig;
  videoContext: ViralShortsVideoContext;
  analyzerOutput: AnalyzerOutput;
  selectorOutput: SelectorOutput;
  availableExamples: NonNullable<PreparedGenerationContext["availableExamples"]>;
  promptConfig?: Stage2PromptConfig | null;
}): PromptPacket {
  return {
    context: {
      channelConfig: input.channelConfig,
      analyzerOutput: input.analyzerOutput,
      selectorOutput: input.selectorOutput,
      availableExamples: input.availableExamples
    },
    prompts: {
      analyzer: buildAnalyzerPrompt(
        input.channelConfig,
        input.videoContext,
        input.analyzerOutput,
        input.promptConfig
      ),
      selector: buildSelectorPrompt({
        channelConfig: input.channelConfig,
        videoContext: input.videoContext,
        analyzerOutput: input.analyzerOutput,
        availableExamples: input.availableExamples,
        promptConfig: input.promptConfig
      }),
      writer: buildWriterPrompt({
        channelConfig: input.channelConfig,
        analyzerOutput: input.analyzerOutput,
        selectorOutput: input.selectorOutput,
        userInstruction: input.videoContext.userInstruction,
        promptConfig: input.promptConfig
      }),
      critic: buildCriticPrompt({
        channelConfig: input.channelConfig,
        analyzerOutput: input.analyzerOutput,
        selectorOutput: input.selectorOutput,
        candidates: [],
        promptConfig: input.promptConfig
      }),
      rewriter: buildRewriterPrompt({
        channelConfig: input.channelConfig,
        analyzerOutput: input.analyzerOutput,
        selectorOutput: input.selectorOutput,
        candidates: [],
        criticScores: [],
        userInstruction: input.videoContext.userInstruction,
        promptConfig: input.promptConfig
      }),
      finalSelector: buildFinalSelectorPrompt({
        channelConfig: input.channelConfig,
        analyzerOutput: input.analyzerOutput,
        selectorOutput: input.selectorOutput,
        candidates: [],
        promptConfig: input.promptConfig
      }),
      titles: buildTitlePrompt({
        channelConfig: input.channelConfig,
        videoContext: input.videoContext,
        selectorOutput: input.selectorOutput,
        shortlist: [],
        userInstruction: input.videoContext.userInstruction,
        promptConfig: input.promptConfig
      })
    }
  };
}
