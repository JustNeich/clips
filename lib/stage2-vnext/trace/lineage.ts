import type {
  CandidateLineageRecord,
  CandidateOriginStage,
  CandidateState
} from "../contracts";

export const STAGE2_VNEXT_ALLOWED_STATE_TRANSITIONS: Record<
  CandidateState,
  CandidateState[]
> = {
  semantic_draft: ["packed_valid", "packed_invalid", "judged", "hard_rejected"],
  packed_valid: ["judged", "hard_rejected", "survivor"],
  packed_invalid: ["hard_rejected"],
  judged: ["hard_rejected", "survivor"],
  hard_rejected: [],
  survivor: ["rewritten", "pairwise_ranked", "visible_shortlist"],
  rewritten: ["pairwise_ranked", "visible_shortlist"],
  pairwise_ranked: ["visible_shortlist", "winner"],
  visible_shortlist: ["winner"],
  winner: []
};

export function canTransitionCandidateState(
  fromState: CandidateState | null,
  toState: CandidateState
): boolean {
  if (fromState === null) {
    return toState === "semantic_draft";
  }
  return STAGE2_VNEXT_ALLOWED_STATE_TRANSITIONS[fromState].includes(toState);
}

export function validateCandidateLineageRecords(
  records: CandidateLineageRecord[]
): string[] {
  const issues: string[] = [];
  const seenCandidateIds = new Set<string>();

  for (const record of records) {
    if (!record.candidateId) {
      issues.push("Candidate lineage record is missing candidateId.");
      continue;
    }
    if (seenCandidateIds.has(record.candidateId)) {
      issues.push(`Duplicate lineage record for candidate ${record.candidateId}.`);
    }
    seenCandidateIds.add(record.candidateId);

    if (record.transitions.length === 0) {
      issues.push(`Candidate ${record.candidateId} has no lineage transitions.`);
      continue;
    }

    let previousState: CandidateState | null = null;
    for (const transition of record.transitions) {
      if (!canTransitionCandidateState(previousState, transition.toState)) {
        issues.push(
          `Candidate ${record.candidateId} has invalid transition ${previousState ?? "null"} -> ${transition.toState}.`
        );
      }
      previousState = transition.toState;
    }

    const finalTransition = record.transitions[record.transitions.length - 1];
    if (finalTransition?.toState !== record.state) {
      issues.push(
        `Candidate ${record.candidateId} final state ${record.state} does not match last transition ${finalTransition?.toState}.`
      );
    }
    if (finalTransition?.stageId !== record.currentStage) {
      issues.push(
        `Candidate ${record.candidateId} current stage ${record.currentStage} does not match last transition stage ${finalTransition?.stageId}.`
      );
    }
  }

  return issues;
}

export function collectCandidatesInState(
  records: CandidateLineageRecord[],
  state: CandidateState
): string[] {
  return records.filter((record) => record.state === state).map((record) => record.candidateId);
}

export function hasHardRejectedCandidateReentry(
  records: CandidateLineageRecord[],
  selectedCandidateIds: string[]
): boolean {
  const hardRejected = new Set(collectCandidatesInState(records, "hard_rejected"));
  return selectedCandidateIds.some((candidateId) => hardRejected.has(candidateId));
}

export function buildInitialCandidateLineageRecord(input: {
  candidateId: string;
  parentCandidateId?: string | null;
  stageId: CandidateOriginStage;
  repairCount?: number;
  createdAt: string;
}): CandidateLineageRecord {
  return {
    candidateId: input.candidateId,
    parentCandidateId: input.parentCandidateId ?? null,
    originStage: input.stageId,
    currentStage: input.stageId,
    state: "semantic_draft",
    eliminationReason: null,
    repairCount: input.repairCount ?? 0,
    transitions: [
      {
        at: input.createdAt,
        stageId: input.stageId,
        fromState: null,
        toState: "semantic_draft",
        reason: null
      }
    ]
  };
}
