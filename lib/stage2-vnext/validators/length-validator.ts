import type { Stage2HardConstraints } from "../../stage2-channel-config";

export type Stage2VNextLengthValidation = {
  topLength: number;
  bottomLength: number;
  topLengthPass: boolean;
  bottomLengthPass: boolean;
  issues: string[];
};

export function validateLengthWindow(input: {
  top: string;
  bottom: string;
  constraints: Stage2HardConstraints;
}): Stage2VNextLengthValidation {
  const topLength = input.top.length;
  const bottomLength = input.bottom.length;
  const issues: string[] = [];
  const topLengthPass =
    topLength >= input.constraints.topLengthMin && topLength <= input.constraints.topLengthMax;
  const bottomLengthPass =
    bottomLength >= input.constraints.bottomLengthMin &&
    bottomLength <= input.constraints.bottomLengthMax;

  if (!topLengthPass) {
    issues.push(
      `TOP length ${topLength} outside ${input.constraints.topLengthMin}-${input.constraints.topLengthMax}.`
    );
  }
  if (!bottomLengthPass) {
    issues.push(
      `BOTTOM length ${bottomLength} outside ${input.constraints.bottomLengthMin}-${input.constraints.bottomLengthMax}.`
    );
  }

  return {
    topLength,
    bottomLength,
    topLengthPass,
    bottomLengthPass,
    issues
  };
}
