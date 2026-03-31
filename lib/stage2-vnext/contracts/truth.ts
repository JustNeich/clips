export interface ClipTruthPacket {
  observedFacts: string[];
  visibleAnchors: string[];
  visibleActions: string[];
  sceneBeats: string[];
  revealMoment: string;
  lateClipChange: string;
  pauseSafeTopFacts: string[];
  inferredReads: string[];
  uncertaintyNotes: string[];
  claimGuardrails: string[];
  firstSecondsSignal: string;
  whyViewerCares: string;
}
