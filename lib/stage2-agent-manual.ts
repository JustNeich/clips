import type { Stage2Output } from "../app/components/types";
import { captionContainsBannedWord, type Stage2HardConstraints } from "./stage2-channel-config";
import { resolveStage2VNextFlagSnapshot } from "./stage2-vnext/feature-flags";
import { getStage2WorkerBuildInfo } from "./stage2-vnext/worker-build";
import {
  normalizeTemplateCaptionHighlights,
  type TemplateCaptionHighlights
} from "./template-highlights";

export const AGENT_MANUAL_CAPTION_SOURCE = "agent_manual" as const;
export const AGENT_MANUAL_CAPTION_ERROR_CODE = "agent_manual_caption_invalid" as const;

/**
 * Agent-supplied final caption text for the `agent_manual` Stage 2 mode.
 * This is an alternative to platform caption generation, not an override of a
 * platform-generated winner.
 */
export type AgentManualCaption = {
  top: string;
  bottom: string;
  topRu?: string;
  bottomRu?: string;
  highlights?: Stage2Output["captionOptions"][number]["highlights"];
};

export type AgentManualCaptionTrace = {
  captionSource: typeof AGENT_MANUAL_CAPTION_SOURCE;
  validation: {
    passed: true;
    issues: [];
    topLength: number;
    bottomLength: number;
  };
  platformGeneration: {
    skipped: true;
    runNativeCaptionPipelineCalled: false;
  };
  examples: {
    loaded: false;
    availableCount: 0;
    selectedCount: 0;
  };
  completedAt: string;
};

type AgentManualPipeline = NonNullable<Stage2Output["pipeline"]> & {
  captionSource: typeof AGENT_MANUAL_CAPTION_SOURCE;
  agentManualTrace: AgentManualCaptionTrace;
};

export type AgentManualStage2Output = Stage2Output & {
  pipeline: AgentManualPipeline;
};

export class AgentManualCaptionValidationError extends Error {
  readonly code = AGENT_MANUAL_CAPTION_ERROR_CODE;
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      `agent_manual caption failed hard constraints; platform fallback is forbidden: ${issues.join(" ")}`
    );
    this.name = "AgentManualCaptionValidationError";
    this.issues = [...issues];
  }
}

export function parseAgentManualCaption(value: unknown): AgentManualCaption | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const top = typeof record.top === "string" ? record.top : null;
  const bottom = typeof record.bottom === "string" ? record.bottom : null;
  if (top === null || bottom === null) {
    return null;
  }
  const caption: AgentManualCaption = { top, bottom };
  if (typeof record.topRu === "string") {
    caption.topRu = record.topRu;
  }
  if (typeof record.bottomRu === "string") {
    caption.bottomRu = record.bottomRu;
  }
  if (record.highlights && typeof record.highlights === "object") {
    caption.highlights = record.highlights as AgentManualCaption["highlights"];
  }
  return caption;
}

/** Returns the hard-constraint issues for an agent caption (empty array = passes). */
export function agentManualCaptionIssues(
  caption: AgentManualCaption,
  constraints: Stage2HardConstraints
): string[] {
  const issues: string[] = [];
  const topLength = caption.top.length;
  const bottomLength = caption.bottom.length;
  if (topLength < constraints.topLengthMin || topLength > constraints.topLengthMax) {
    issues.push(`TOP length ${topLength} outside ${constraints.topLengthMin}-${constraints.topLengthMax}.`);
  }
  if (bottomLength < constraints.bottomLengthMin || bottomLength > constraints.bottomLengthMax) {
    issues.push(
      `BOTTOM length ${bottomLength} outside ${constraints.bottomLengthMin}-${constraints.bottomLengthMax}.`
    );
  }
  if (
    captionContainsBannedWord(caption.top, constraints.bannedWords) ||
    captionContainsBannedWord(caption.bottom, constraints.bannedWords)
  ) {
    issues.push("Caption contains a banned word.");
  }
  const lowerTop = caption.top.trim().toLowerCase();
  if (constraints.bannedOpeners.some((opener) => lowerTop.startsWith(opener.toLowerCase()))) {
    issues.push("TOP starts with a banned opener.");
  }
  return issues;
}

function buildConstraintCheck(caption: AgentManualCaption) {
  return {
    passed: true,
    repaired: false,
    topLength: caption.top.length,
    bottomLength: caption.bottom.length,
    issues: [] as string[]
  };
}

function buildManualHighlights(caption: AgentManualCaption): TemplateCaptionHighlights {
  return normalizeTemplateCaptionHighlights(caption.highlights, {
    top: caption.top,
    bottom: caption.bottom
  });
}

/**
 * Build the complete minimal Stage 2 handoff for an agent-authored caption.
 * It intentionally contains one visible option: no synthetic alternatives,
 * no platform winner, no examples corpus and no caption-model trace.
 */
export function buildAgentManualStage2Output(input: {
  caption: AgentManualCaption;
  constraints: Stage2HardConstraints;
  channel: {
    id: string;
    formatPipeline?: "classic_top_bottom" | "story_lead_main_caption" | null;
  };
  completedAt?: string;
}): AgentManualStage2Output {
  const issues = agentManualCaptionIssues(input.caption, input.constraints);
  if (issues.length > 0) {
    throw new AgentManualCaptionValidationError(issues);
  }

  const completedAt = input.completedAt ?? new Date().toISOString();
  const candidateId = "agent_manual_1";
  const formatPipeline =
    input.channel.formatPipeline === "story_lead_main_caption"
      ? "story_lead_main_caption"
      : "classic_top_bottom";
  const topRu = input.caption.topRu ?? input.caption.top;
  const bottomRu = input.caption.bottomRu ?? input.caption.bottom;
  const highlights = buildManualHighlights(input.caption);
  const constraintCheck = buildConstraintCheck(input.caption);
  const captionOption = {
    option: 1,
    candidateId,
    top: input.caption.top,
    bottom: input.caption.bottom,
    topRu,
    bottomRu,
    highlights,
    displayTier: "finalist" as const,
    displayReason: "Final text supplied by the production agent.",
    constraintCheck
  };
  const trace: AgentManualCaptionTrace = {
    captionSource: AGENT_MANUAL_CAPTION_SOURCE,
    validation: {
      passed: true,
      issues: [],
      topLength: input.caption.top.length,
      bottomLength: input.caption.bottom.length
    },
    platformGeneration: {
      skipped: true,
      runNativeCaptionPipelineCalled: false
    },
    examples: {
      loaded: false,
      availableCount: 0,
      selectedCount: 0
    },
    completedAt
  };

  const output = {
    formatPipeline,
    inputAnalysis: {
      visualAnchors: [],
      commentVibe: "",
      keyPhraseToAdapt: ""
    },
    captionOptions: [captionOption],
    ...(formatPipeline === "story_lead_main_caption"
      ? {
          storyOptions: [
            {
              option: 1,
              candidateId,
              lead: input.caption.top,
              mainCaption: input.caption.bottom,
              leadRu: topRu,
              mainCaptionRu: bottomRu,
              highlights,
              constraintCheck
            }
          ]
        }
      : {
          classicOptions: [
            {
              option: 1,
              candidateId,
              top: input.caption.top,
              bottom: input.caption.bottom,
              topRu,
              bottomRu,
              highlights,
              constraintCheck
            }
          ]
        }),
    titleOptions: [
      {
        option: 1,
        title: input.caption.top,
        titleRu: topRu
      }
    ],
    finalPick: {
      option: 1,
      reason: "Agent-authored final caption passed deterministic hard constraints."
    },
    pipeline: {
      channelId: input.channel.id,
      mode: "packet_only",
      captionSource: AGENT_MANUAL_CAPTION_SOURCE,
      selectorOutput: null,
      availableExamplesCount: 0,
      selectedExamplesCount: 0,
      execution: {
        featureFlags: resolveStage2VNextFlagSnapshot(),
        pipelineVersion: "agent_manual",
        stageChainVersion: "agent-manual-v1",
        workerBuild: getStage2WorkerBuildInfo(),
        resolvedAt: completedAt,
        legacyFallbackReason: null,
        promptPolicyVersion: "agent_manual@2026-07-14"
      },
      agentManualTrace: trace
    }
  } satisfies Omit<Stage2Output, "pipeline"> & { pipeline: AgentManualPipeline };

  return output;
}
