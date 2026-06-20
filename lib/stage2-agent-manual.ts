import type { Stage2Output } from "../app/components/types";
import { captionContainsBannedWord, type Stage2HardConstraints } from "./stage2-channel-config";
import {
  cloneTemplateCaptionHighlights,
  createEmptyTemplateCaptionHighlights,
  type TemplateCaptionHighlights
} from "./template-highlights";

function isValidTemplateCaptionHighlights(value: unknown): value is TemplateCaptionHighlights {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { top?: unknown }).top) &&
    Array.isArray((value as { bottom?: unknown }).bottom)
  );
}

/**
 * Agent-supplied final caption text for the `agent_manual` Stage 2 mode. When a
 * request carries this, the platform skips caption GENERATION and uses this exact
 * text as the winner — but the deterministic hard-constraint validator still runs.
 */
export type AgentManualCaption = {
  top: string;
  bottom: string;
  topRu?: string;
  bottomRu?: string;
  highlights?: Stage2Output["captionOptions"][number]["highlights"];
};

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

/**
 * Overwrite the WINNING display caption with agent-provided final text. The winner
 * is a pointer; the text lives in the captionOption resolved by `finalPick.option`.
 * We overwrite that option's text/bilingual/highlights and mark its constraintCheck
 * (and the winner's) as passed. The generator is bypassed, NOT the validator — the
 * caller still runs `validateStage2Output` afterwards. Returns `applied=false` (no
 * mutation) when the agent text fails hard constraints, so the caller falls back to
 * the LLM-generated winner.
 */
export function applyAgentManualCaption(
  output: Stage2Output,
  caption: AgentManualCaption,
  constraints: Stage2HardConstraints
): { applied: boolean; issues: string[] } {
  const issues = agentManualCaptionIssues(caption, constraints);
  if (issues.length > 0) {
    return { applied: false, issues };
  }
  const targetOption =
    output.captionOptions.find((option) => option.option === output.finalPick.option) ??
    output.captionOptions[0];
  if (!targetOption) {
    return { applied: false, issues: ["No caption option available to override."] };
  }
  targetOption.top = caption.top;
  targetOption.bottom = caption.bottom;
  // Keep the bilingual fields present and consistent with the NEW English text.
  // The rollout audit hard-fails when a visible option is missing topRu/bottomRu,
  // and a leftover RU from the old winner would describe different text — so mirror
  // the English when the agent omits a translation.
  targetOption.topRu = caption.topRu !== undefined ? caption.topRu : caption.top;
  targetOption.bottomRu = caption.bottomRu !== undefined ? caption.bottomRu : caption.bottom;
  // Highlights are character-position spans into the text. The old winner's spans
  // point into the OLD text, so always replace them: use the agent's (validated)
  // highlights, or clear to empty. Never carry stale spans onto the new text.
  targetOption.highlights = isValidTemplateCaptionHighlights(caption.highlights)
    ? cloneTemplateCaptionHighlights(caption.highlights)
    : createEmptyTemplateCaptionHighlights();
  const passedCheck = {
    passed: true,
    repaired: false,
    topLength: caption.top.length,
    bottomLength: caption.bottom.length,
    issues: [] as string[]
  };
  targetOption.constraintCheck = passedCheck;
  if (output.winner) {
    output.winner.constraintCheck = { ...passedCheck };
  }
  return { applied: true, issues: [] };
}
