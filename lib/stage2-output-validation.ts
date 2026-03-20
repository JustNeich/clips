import type { Stage2Output } from "../app/components/types";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  type Stage2HardConstraints
} from "./stage2-channel-config";

export type Stage2ValidationWarning = {
  field: string;
  message: string;
};

function containsBannedContent(text: string, constraints: Stage2HardConstraints): boolean {
  const lower = text.toLowerCase();
  return constraints.bannedWords.some((word) => lower.includes(word.toLowerCase()));
}

function startsWithBannedOpener(text: string, constraints: Stage2HardConstraints): boolean {
  const lower = text.trim().toLowerCase();
  return constraints.bannedOpeners.some((opener) => lower.startsWith(opener.toLowerCase()));
}

export function validateStage2Output(
  output: Stage2Output,
  constraints?: Stage2HardConstraints | null
): Stage2ValidationWarning[] {
  const warnings: Stage2ValidationWarning[] = [];
  const resolved = constraints ?? DEFAULT_STAGE2_HARD_CONSTRAINTS;

  for (const option of output.captionOptions) {
    const topLength = option.top.length;
    const bottomLength = option.bottom.length;
    if (option.constraintCheck && !option.constraintCheck.passed) {
      warnings.push({
        field: `captionOptions.option${option.option}.constraintCheck`,
        message: option.constraintCheck.issues.join(" ") || "Caption option failed hard constraints."
      });
    }

    if (topLength < resolved.topLengthMin || topLength > resolved.topLengthMax) {
      warnings.push({
        field: `captionOptions.option${option.option}.top`,
        message: `TOP length is ${topLength}, expected ${resolved.topLengthMin}-${resolved.topLengthMax}.`
      });
    }
    if (bottomLength < resolved.bottomLengthMin || bottomLength > resolved.bottomLengthMax) {
      warnings.push({
        field: `captionOptions.option${option.option}.bottom`,
        message: `BOTTOM length is ${bottomLength}, expected ${resolved.bottomLengthMin}-${resolved.bottomLengthMax}.`
      });
    }
    if (containsBannedContent(option.top, resolved) || containsBannedContent(option.bottom, resolved)) {
      warnings.push({
        field: `captionOptions.option${option.option}.constraintCheck`,
        message: "Caption contains banned words."
      });
    }
    if (startsWithBannedOpener(option.top, resolved)) {
      warnings.push({
        field: `captionOptions.option${option.option}.top`,
        message: "TOP starts with a banned opener."
      });
    }
  }

  return warnings;
}
