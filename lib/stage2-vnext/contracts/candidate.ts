export type CandidateState =
  | "semantic_draft"
  | "packed_valid"
  | "packed_invalid"
  | "judged"
  | "hard_rejected"
  | "survivor"
  | "rewritten"
  | "ranked_shortlist"
  | "visible_shortlist"
  | "winner";

export type CandidateOriginStage =
  | "semantic_draft_generator"
  | "constraint_packer"
  | "quality_court"
  | "rewriter"
  | "ranked_final_selector";

export interface CandidateLineageTransition {
  at: string;
  stageId: CandidateOriginStage;
  fromState: CandidateState | null;
  toState: CandidateState;
  reason: string | null;
}

export interface CandidateLineageRecord {
  candidateId: string;
  parentCandidateId: string | null;
  originStage: CandidateOriginStage;
  currentStage: CandidateOriginStage;
  state: CandidateState;
  eliminationReason: string | null;
  repairCount: number;
  transitions: CandidateLineageTransition[];
}

export interface SemanticDraft {
  candidateId: string;
  angleId: string;
  explorationMode: "aligned" | "adjacent" | "exploratory";
  semanticTop: string;
  semanticBottom: string;
  cuesUsed: string[];
  rationale: string;
}

export interface PackedCandidate {
  candidateId: string;
  parentCandidateId: string;
  angleId: string;
  top: string;
  bottom: string;
  topRu: string;
  bottomRu: string;
  topLength: number;
  bottomLength: number;
  repairCount: number;
  validations: {
    schemaPass: boolean;
    topLengthPass: boolean;
    bottomLengthPass: boolean;
    bannedPatternPass: boolean;
  };
}
