export interface JudgeScoreCard {
  candidateId: string;
  hardPass: boolean;
  hardFailReasons: string[];
  scores: {
    visualFaithfulness: number;
    hookStrength: number;
    nativeFluency: number;
    audienceAuthenticity: number;
    styleFit: number;
    riskSafety: number;
  };
  notes: string[];
}
