import { RetrievalBundle, RetrievalExample, SelectorOutput } from "./types";
import { scoreTextMatch } from "./analysis";

export type RetrievalScoreBreakdown = {
  baseBonus: number;
  clipType: number;
  archetype: number;
  textMatch: number;
  qualityScore: number;
  total: number;
};

export function getRetrievalScoreBreakdown(
  example: RetrievalExample,
  selectorOutput: SelectorOutput,
  queryText: string,
  baseBonus = 0
): RetrievalScoreBreakdown {
  const clipType = example.clipType === selectorOutput.clipType ? 2 : 0;
  const archetype = example.archetype === selectorOutput.archetype ? 1 : 0;
  const textMatch = scoreTextMatch(queryText, example);
  const qualityScore = Number(example.qualityScore ?? 0);
  const total = Math.round((baseBonus + clipType + archetype + textMatch + qualityScore) * 10000) / 10000;
  return {
    baseBonus,
    clipType,
    archetype,
    textMatch,
    qualityScore,
    total
  };
}

export function buildRetrievalSelectionReasons(
  example: RetrievalExample,
  selectorOutput: SelectorOutput,
  breakdown: RetrievalScoreBreakdown
): string[] {
  const reasons: string[] = [];
  if (breakdown.baseBonus > 0) {
    reasons.push("hot-pool freshness bonus");
  }
  if (breakdown.clipType > 0) {
    reasons.push(`clip type matched ${selectorOutput.clipType}`);
  }
  if (breakdown.archetype > 0) {
    reasons.push(`archetype matched ${selectorOutput.archetype}`);
  }
  if (breakdown.textMatch > 0) {
    reasons.push(`query overlap ${breakdown.textMatch.toFixed(2)}`);
  }
  if (breakdown.qualityScore > 0) {
    reasons.push(`quality score ${breakdown.qualityScore.toFixed(2)}`);
  }
  if (example.isOwnedAnchor) {
    reasons.push("owned anchor example");
  }
  if (example.isAntiExample) {
    reasons.push("anti-example retained for negative conditioning");
  }
  return reasons;
}

export function buildRetrievalBundle(
  stableCandidates: RetrievalExample[],
  hotCandidates: RetrievalExample[],
  antiCandidates: RetrievalExample[],
  selectorOutput: SelectorOutput,
  queryText: string,
  limits?: {
    stable?: number;
    hot?: number;
    anti?: number;
  }
): RetrievalBundle {
  const stableLimit = limits?.stable ?? 6;
  const hotLimit = limits?.hot ?? 4;
  const antiLimit = limits?.anti ?? 2;

  const stableExamples = [...stableCandidates]
    .sort(
      (left, right) =>
        getRetrievalScoreBreakdown(right, selectorOutput, queryText).total -
        getRetrievalScoreBreakdown(left, selectorOutput, queryText).total
    )
    .slice(0, stableLimit);

  const hotExamples = [...hotCandidates]
    .sort(
      (left, right) =>
        getRetrievalScoreBreakdown(right, selectorOutput, queryText, 0.5).total -
        getRetrievalScoreBreakdown(left, selectorOutput, queryText, 0.5).total
    )
    .slice(0, hotLimit);

  const antiExamples = [...antiCandidates]
    .sort(
      (left, right) =>
        getRetrievalScoreBreakdown(right, selectorOutput, queryText).total -
        getRetrievalScoreBreakdown(left, selectorOutput, queryText).total
    )
    .slice(0, antiLimit);

  return {
    stableExamples,
    hotExamples,
    antiExamples
  };
}
