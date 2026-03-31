import type { Stage2VNextStageId } from "../contracts";

export const STAGE2_VNEXT_STAGE_REGISTRY: Array<{
  id: Stage2VNextStageId;
  label: string;
  implementedInPhase: number;
}> = [
  { id: "source_ingest", label: "Source ingest", implementedInPhase: 2 },
  { id: "clip_truth_extractor", label: "Clip truth extractor", implementedInPhase: 2 },
  { id: "audience_miner", label: "Audience miner", implementedInPhase: 2 },
  { id: "example_router", label: "Example router", implementedInPhase: 1 },
  { id: "strategy_search", label: "Strategy search", implementedInPhase: 3 },
  { id: "semantic_draft_generator", label: "Semantic draft generator", implementedInPhase: 4 },
  { id: "constraint_packer", label: "Constraint packer", implementedInPhase: 1 },
  { id: "quality_court", label: "Quality court", implementedInPhase: 5 },
  { id: "pairwise_final_selector", label: "Pairwise final selector", implementedInPhase: 5 },
  { id: "title_and_seo", label: "Title and SEO", implementedInPhase: 6 },
  { id: "feedback_capture", label: "Feedback capture", implementedInPhase: 6 }
];
