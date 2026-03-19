import type { Stage2Output } from "../app/components/types";
import type { Stage2HardConstraints } from "./stage2-channel-config";

export type Stage2ValidationWarning = {
  field: string;
  message: string;
};

export function validateStage2Output(
  output: Stage2Output,
  constraints?: Stage2HardConstraints | null
): Stage2ValidationWarning[] {
  const warnings: Stage2ValidationWarning[] = [];
  const resolved = constraints ?? {
    topLengthMin: 140,
    topLengthMax: 210,
    bottomLengthMin: 80,
    bottomLengthMax: 160,
    bottomQuoteRequired: false,
    bannedWords: [],
    bannedOpeners: []
  };

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
    if (resolved.bottomQuoteRequired && !option.bottom.includes("\"")) {
      warnings.push({
        field: `captionOptions.option${option.option}.bottom`,
        message: "BOTTOM must contain a quoted phrase."
      });
    }
  }

  return warnings;
}
