import type {
  CandidateLineageRecord,
  CandidateOriginStage,
  CandidateState
} from "../contracts";
import {
  buildInitialCandidateLineageRecord,
  canTransitionCandidateState
} from "../trace/lineage";

export class CandidateLifecycle {
  private readonly records = new Map<string, CandidateLineageRecord>();

  registerSemanticDraft(input: {
    candidateId: string;
    parentCandidateId?: string | null;
    createdAt: string;
  }) {
    if (this.records.has(input.candidateId)) {
      return;
    }
    this.records.set(
      input.candidateId,
      buildInitialCandidateLineageRecord({
        candidateId: input.candidateId,
        parentCandidateId: input.parentCandidateId,
        stageId: "semantic_draft_generator",
        createdAt: input.createdAt
      })
    );
  }

  transition(input: {
    candidateId: string;
    toState: CandidateState;
    stageId: CandidateOriginStage;
    at: string;
    reason?: string | null;
    repairCount?: number;
  }) {
    const current = this.records.get(input.candidateId);
    if (!current) {
      throw new Error(`Unknown candidate lifecycle id: ${input.candidateId}`);
    }
    if (!canTransitionCandidateState(current.state, input.toState)) {
      throw new Error(
        `Invalid candidate lifecycle transition for ${input.candidateId}: ${current.state} -> ${input.toState}`
      );
    }
    const nextRepairCount =
      typeof input.repairCount === "number" ? input.repairCount : current.repairCount;
    this.records.set(input.candidateId, {
      ...current,
      currentStage: input.stageId,
      state: input.toState,
      eliminationReason: input.toState === "hard_rejected" ? input.reason ?? null : current.eliminationReason,
      repairCount: nextRepairCount,
      transitions: [
        ...current.transitions,
        {
          at: input.at,
          stageId: input.stageId,
          fromState: current.state,
          toState: input.toState,
          reason: input.reason ?? null
        }
      ]
    });
  }

  list(): CandidateLineageRecord[] {
    return Array.from(this.records.values());
  }
}
