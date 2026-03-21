import type { Stage2HardConstraints } from "./stage2-channel-config";

type Stage2Spec = {
  name: string;
  outputSections: string[];
  topLengthRule: string;
  bottomLengthRule: string;
  enforcedVia: string;
};

function formatLengthRule(minimum: number, maximum: number): string {
  return `${minimum}-${maximum} chars`;
}

export function buildStage2Spec(input: {
  name: string;
  outputSections: string[];
  hardConstraints: Stage2HardConstraints;
  enforcedVia: string;
}): Stage2Spec {
  return {
    name: input.name,
    outputSections: input.outputSections,
    topLengthRule: formatLengthRule(
      input.hardConstraints.topLengthMin,
      input.hardConstraints.topLengthMax
    ),
    bottomLengthRule: formatLengthRule(
      input.hardConstraints.bottomLengthMin,
      input.hardConstraints.bottomLengthMax
    ),
    enforcedVia: input.enforcedVia
  };
}
