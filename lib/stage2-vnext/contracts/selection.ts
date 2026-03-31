export interface PairwiseMatch {
  leftCandidateId: string;
  rightCandidateId: string;
  winnerCandidateId: string;
  rationale: string;
}

export interface FinalSelection {
  visibleCandidateIds: string[];
  winnerCandidateId: string;
  pairwiseMatches: PairwiseMatch[];
  rationale: string;
}

export interface TitleOption {
  option: number;
  title: string;
  titleRu?: string;
}

export interface SeoPayload {
  description: string;
  tags: string;
}
