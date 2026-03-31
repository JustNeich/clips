export type ExampleMode = "semantic_guided" | "structural_guided" | "disabled";

export interface RetrievedExample {
  exampleId: string;
  semanticFit: number;
  structuralFit: number;
  marketFit: number;
  languageQuality: number;
  rationale: string[];
}

export interface ExampleRoutingDecision {
  mode: ExampleMode;
  confidence: number;
  selectedExampleIds: string[];
  blockedExampleIds: string[];
  reasons: string[];
}
