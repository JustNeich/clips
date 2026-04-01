import type {
  ExampleRoutingDecision,
  FinalSelection,
  JudgeScoreCard,
  PackedCandidate,
  SemanticDraft
} from "../contracts";

export type Stage2VNextSchemaValidationIssue = {
  path: string;
  message: string;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pushIssue(
  issues: Stage2VNextSchemaValidationIssue[],
  path: string,
  condition: boolean,
  message: string
) {
  if (!condition) {
    issues.push({ path, message });
  }
}

export function validateExampleRoutingDecisionSchema(
  value: unknown
): Stage2VNextSchemaValidationIssue[] {
  const issues: Stage2VNextSchemaValidationIssue[] = [];
  const candidate = isObjectRecord(value) ? value : null;
  pushIssue(issues, "root", candidate !== null, "Example routing decision must be an object.");
  if (!candidate) {
    return issues;
  }

  pushIssue(
    issues,
    "mode",
    candidate.mode === "semantic_guided" ||
      candidate.mode === "structural_guided" ||
      candidate.mode === "disabled",
    "Mode must be semantic_guided, structural_guided, or disabled."
  );
  pushIssue(
    issues,
    "confidence",
    typeof candidate.confidence === "number" &&
      Number.isFinite(candidate.confidence) &&
      candidate.confidence >= 0 &&
      candidate.confidence <= 1,
    "Confidence must be a number between 0 and 1."
  );
  pushIssue(
    issues,
    "selectedExampleIds",
    Array.isArray(candidate.selectedExampleIds),
    "selectedExampleIds must be an array."
  );
  pushIssue(
    issues,
    "blockedExampleIds",
    Array.isArray(candidate.blockedExampleIds),
    "blockedExampleIds must be an array."
  );
  pushIssue(issues, "reasons", Array.isArray(candidate.reasons), "reasons must be an array.");
  return issues;
}

export function validateSemanticDraftSchema(value: unknown): Stage2VNextSchemaValidationIssue[] {
  const issues: Stage2VNextSchemaValidationIssue[] = [];
  const candidate = isObjectRecord(value) ? value : null;
  pushIssue(issues, "root", candidate !== null, "Semantic draft must be an object.");
  if (!candidate) {
    return issues;
  }

  pushIssue(
    issues,
    "candidateId",
    typeof candidate.candidateId === "string" && candidate.candidateId.trim().length > 0,
    "candidateId must be a non-empty string."
  );
  pushIssue(
    issues,
    "angleId",
    typeof candidate.angleId === "string" && candidate.angleId.trim().length > 0,
    "angleId must be a non-empty string."
  );
  pushIssue(
    issues,
    "explorationMode",
    candidate.explorationMode === "aligned" ||
      candidate.explorationMode === "adjacent" ||
      candidate.explorationMode === "exploratory",
    "explorationMode must be aligned, adjacent, or exploratory."
  );
  pushIssue(
    issues,
    "semanticTop",
    typeof candidate.semanticTop === "string" && candidate.semanticTop.trim().length > 0,
    "semanticTop must be a non-empty string."
  );
  pushIssue(
    issues,
    "semanticBottom",
    typeof candidate.semanticBottom === "string" && candidate.semanticBottom.trim().length > 0,
    "semanticBottom must be a non-empty string."
  );
  pushIssue(issues, "cuesUsed", Array.isArray(candidate.cuesUsed), "cuesUsed must be an array.");
  pushIssue(
    issues,
    "rationale",
    typeof candidate.rationale === "string" && candidate.rationale.trim().length > 0,
    "rationale must be a non-empty string."
  );
  return issues;
}

export function validatePackedCandidateSchema(value: unknown): Stage2VNextSchemaValidationIssue[] {
  const issues: Stage2VNextSchemaValidationIssue[] = [];
  const candidate = isObjectRecord(value) ? value : null;
  pushIssue(issues, "root", candidate !== null, "Packed candidate must be an object.");
  if (!candidate) {
    return issues;
  }

  const stringFields = [
    "candidateId",
    "parentCandidateId",
    "angleId",
    "top",
    "bottom",
    "topRu",
    "bottomRu"
  ] as const;
  for (const field of stringFields) {
    pushIssue(
      issues,
      field,
      typeof candidate[field] === "string" && String(candidate[field]).trim().length > 0,
      `${field} must be a non-empty string.`
    );
  }
  pushIssue(
    issues,
    "topLength",
    typeof candidate.topLength === "number" && Number.isFinite(candidate.topLength),
    "topLength must be a finite number."
  );
  pushIssue(
    issues,
    "bottomLength",
    typeof candidate.bottomLength === "number" && Number.isFinite(candidate.bottomLength),
    "bottomLength must be a finite number."
  );
  pushIssue(
    issues,
    "repairCount",
    typeof candidate.repairCount === "number" &&
      Number.isFinite(candidate.repairCount) &&
      candidate.repairCount >= 0,
    "repairCount must be a non-negative number."
  );
  pushIssue(
    issues,
    "validations",
    isObjectRecord(candidate.validations),
    "validations must be an object."
  );
  return issues;
}

export function validateJudgeScoreCardSchema(value: unknown): Stage2VNextSchemaValidationIssue[] {
  const issues: Stage2VNextSchemaValidationIssue[] = [];
  const candidate = isObjectRecord(value) ? value : null;
  pushIssue(issues, "root", candidate !== null, "Judge score card must be an object.");
  if (!candidate) {
    return issues;
  }

  pushIssue(
    issues,
    "candidateId",
    typeof candidate.candidateId === "string" && candidate.candidateId.trim().length > 0,
    "candidateId must be a non-empty string."
  );
  pushIssue(
    issues,
    "hardPass",
    typeof candidate.hardPass === "boolean",
    "hardPass must be a boolean."
  );
  pushIssue(
    issues,
    "hardFailReasons",
    Array.isArray(candidate.hardFailReasons),
    "hardFailReasons must be an array."
  );
  pushIssue(issues, "scores", isObjectRecord(candidate.scores), "scores must be an object.");
  pushIssue(issues, "notes", Array.isArray(candidate.notes), "notes must be an array.");
  return issues;
}

export function validateFinalSelectionSchema(value: unknown): Stage2VNextSchemaValidationIssue[] {
  const issues: Stage2VNextSchemaValidationIssue[] = [];
  const candidate = isObjectRecord(value) ? value : null;
  pushIssue(issues, "root", candidate !== null, "Final selection must be an object.");
  if (!candidate) {
    return issues;
  }

  pushIssue(
    issues,
    "visibleCandidateIds",
    Array.isArray(candidate.visibleCandidateIds),
    "visibleCandidateIds must be an array."
  );
  pushIssue(
    issues,
    "winnerCandidateId",
    typeof candidate.winnerCandidateId === "string" && candidate.winnerCandidateId.trim().length > 0,
    "winnerCandidateId must be a non-empty string."
  );
  pushIssue(
    issues,
    "rankingMatches",
    Array.isArray(candidate.rankingMatches),
    "rankingMatches must be an array."
  );
  pushIssue(
    issues,
    "rationale",
    typeof candidate.rationale === "string" && candidate.rationale.trim().length > 0,
    "rationale must be a non-empty string."
  );
  return issues;
}

export function validateSemanticDraftListSchema(
  drafts: SemanticDraft[]
): Stage2VNextSchemaValidationIssue[] {
  return drafts.flatMap((draft, index) =>
    validateSemanticDraftSchema(draft).map((issue) => ({
      ...issue,
      path: `drafts[${index}].${issue.path}`
    }))
  );
}

export function validatePackedCandidateListSchema(
  packedCandidates: PackedCandidate[]
): Stage2VNextSchemaValidationIssue[] {
  return packedCandidates.flatMap((candidate, index) =>
    validatePackedCandidateSchema(candidate).map((issue) => ({
      ...issue,
      path: `packedCandidates[${index}].${issue.path}`
    }))
  );
}

export function validateJudgeScoreCardListSchema(
  judgeCards: JudgeScoreCard[]
): Stage2VNextSchemaValidationIssue[] {
  return judgeCards.flatMap((judgeCard, index) =>
    validateJudgeScoreCardSchema(judgeCard).map((issue) => ({
      ...issue,
      path: `judgeCards[${index}].${issue.path}`
    }))
  );
}

export function validateFinalSelectionObjectSchema(
  selection: FinalSelection | null
): Stage2VNextSchemaValidationIssue[] {
  if (!selection) {
    return [];
  }
  return validateFinalSelectionSchema(selection);
}
