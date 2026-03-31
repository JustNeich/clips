import type { Stage2CorpusExample } from "../../stage2-channel-config";
import type { Stage2ExamplesAssessment } from "../../viral-shorts-worker/types";
import type {
  ExampleMode,
  ExampleRoutingDecision,
  RetrievedExample
} from "../contracts";

const EXAMPLE_MODE_LIMITS: Record<ExampleMode, number> = {
  semantic_guided: 6,
  structural_guided: 4,
  disabled: 0
};

function mapAssessmentToExampleMode(assessment: Stage2ExamplesAssessment): ExampleMode {
  if (assessment.retrievalConfidence === "high") {
    return "semantic_guided";
  }
  if (assessment.retrievalConfidence === "medium") {
    return "structural_guided";
  }
  return "disabled";
}

function buildReasonLines(assessment: Stage2ExamplesAssessment, mode: ExampleMode): string[] {
  const reasons = [assessment.explanation, ...assessment.evidence].filter(Boolean);
  if (mode === "disabled") {
    reasons.push(
      "Retrieval confidence is below the vNext threshold, so no examples may flow into downstream stages."
    );
  } else if (mode === "structural_guided") {
    reasons.push("Examples may guide rhythm and compression only.");
  } else {
    reasons.push("Examples are strong enough to guide framing, structure, and trigger logic.");
  }
  return reasons.slice(0, 6);
}

export function buildRetrievedExamples(
  examples: Stage2CorpusExample[]
): RetrievedExample[] {
  return examples.map((example) => ({
    exampleId: example.id,
    semanticFit: typeof example.qualityScore === "number" ? example.qualityScore : 0,
    structuralFit: typeof example.qualityScore === "number" ? example.qualityScore : 0,
    marketFit: example.clipType === "general" ? 0.3 : 0.8,
    languageQuality: typeof example.qualityScore === "number" ? example.qualityScore : 0.4,
    rationale: example.whyItWorks.slice(0, 3)
  }));
}

export function decideExampleRouting(input: {
  availableExamples: Stage2CorpusExample[];
  assessment: Stage2ExamplesAssessment;
}): ExampleRoutingDecision {
  const mode = mapAssessmentToExampleMode(input.assessment);
  const limit = EXAMPLE_MODE_LIMITS[mode];
  const selectedExampleIds =
    mode === "disabled" ? [] : input.availableExamples.slice(0, limit).map((example) => example.id);
  const selectedSet = new Set(selectedExampleIds);

  return {
    mode,
    confidence:
      input.assessment.retrievalConfidence === "high"
        ? 0.85
        : input.assessment.retrievalConfidence === "medium"
          ? 0.6
          : 0.25,
    selectedExampleIds,
    blockedExampleIds: input.availableExamples
      .map((example) => example.id)
      .filter((exampleId) => !selectedSet.has(exampleId)),
    reasons: buildReasonLines(input.assessment, mode)
  };
}

export function applyExampleRoutingDecision(input: {
  availableExamples: Stage2CorpusExample[];
  decision: ExampleRoutingDecision;
}): Stage2CorpusExample[] {
  if (input.decision.mode === "disabled") {
    return [];
  }
  const allowed = new Set(input.decision.selectedExampleIds);
  return input.availableExamples.filter((example) => allowed.has(example.id));
}
