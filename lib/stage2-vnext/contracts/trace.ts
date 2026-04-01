import type { Stage2HardConstraints } from "../../stage2-channel-config";
import type { AudiencePacket } from "./audience";
import type { CandidateLineageRecord, PackedCandidate, SemanticDraft } from "./candidate";
import type { ExampleMode, ExampleRoutingDecision, RetrievedExample } from "./examples";
import type { JudgeScoreCard } from "./judges";
import type { FinalSelection, SeoPayload, TitleOption } from "./selection";
import type { SourcePacket } from "./source";
import type { StrategyPacket } from "./strategy";
import type { ClipTruthPacket } from "./truth";

export type Stage2VNextStageId =
  | "source_ingest"
  | "clip_truth_extractor"
  | "audience_miner"
  | "example_router"
  | "strategy_search"
  | "semantic_draft_generator"
  | "constraint_packer"
  | "quality_court"
  | "ranked_final_selector"
  | "title_and_seo"
  | "feedback_capture";

export type Stage2PipelineVersion = "legacy" | "vnext" | "native_caption_v3";

export type Stage2VNextFlagResolutionSource = "override" | "env" | "default_false";

export interface Stage2VNextFeatureFlagSnapshot {
  STAGE2_VNEXT_ENABLED: boolean;
  source: Stage2VNextFlagResolutionSource;
  rawValue: string | null;
}

export interface Stage2VNextWorkerBuild {
  buildId: string;
  startedAt: string;
  pid: number | null;
}

export interface Stage2VNextCriticGate {
  evaluatedCandidateIds: string[];
  criticKeptCandidateIds: string[];
  criticRejectedCandidateIds: string[];
  rewriteCandidateIds: string[];
  validatedShortlistPoolIds: string[];
  visibleShortlistCandidateIds: string[];
  invalidDroppedCandidateIds: string[];
  reserveBackfillCount: number;
}

export interface Stage2VNextCanonicalCounters {
  sourceCommentsAvailable: number;
  sourceCommentsPassedToAudienceMiner: number;
  sourceCommentsPassedToTruthExtractor: number;
  examplesRetrieved: number;
  examplesPassedDownstream: number;
  semanticDraftsGenerated: number;
  packedCandidatesGenerated: number;
  packedCandidatesValid: number;
  hardRejectedCount: number;
  survivorCount: number;
  visibleShortlistCount: number;
  winnerCount: number;
}

export interface Stage2VNextExampleUsage {
  stageId: Stage2VNextStageId;
  exampleMode: ExampleMode;
  passedExampleIds: string[];
}

export interface Stage2VNextTraceV3 {
  meta: {
    version: "stage2-vnext-trace-v3";
    generatedAt: string;
    featureFlag: "STAGE2_VNEXT_ENABLED";
    featureFlags: Stage2VNextFeatureFlagSnapshot;
    pipelineVersion: Stage2PipelineVersion;
    stageChainVersion: string;
    workerBuild: Stage2VNextWorkerBuild;
    compatibilityMode: "none";
    implementedStages: Stage2VNextStageId[];
  };
  inputs: {
    source: SourcePacket;
    channel: {
      channelId: string;
      name: string;
      username: string;
      hardConstraints: Stage2HardConstraints;
      userInstruction: string | null;
    };
  };
  stageOutputs: {
    clipTruthExtractor: ClipTruthPacket | null;
    audienceMiner: AudiencePacket | null;
    exampleRouter: {
      decision: ExampleRoutingDecision;
      retrievedExamples: RetrievedExample[];
      passedExamples: RetrievedExample[];
      blockedExamples: RetrievedExample[];
    };
    strategySearch: StrategyPacket | null;
    semanticDraftGenerator: {
      drafts: SemanticDraft[];
    };
    constraintPacker: {
      packedCandidates: PackedCandidate[];
    };
    qualityCourt: {
      judgeCards: JudgeScoreCard[];
    };
    rankedFinalSelector: FinalSelection | null;
    titleAndSeo: {
      titles: TitleOption[];
      seo: SeoPayload | null;
    };
    exampleUsage: Stage2VNextExampleUsage[];
  };
  candidateLineage: CandidateLineageRecord[];
  criticGate: Stage2VNextCriticGate;
  canonicalCounters: Stage2VNextCanonicalCounters;
  validation: {
    validatorsRun: string[];
    issues: string[];
  };
  selection: FinalSelection | null;
  memory: {
    status: "disabled";
    reason: string;
  };
  cost: {
    totalPromptChars: number;
    totalEstimatedInputTokens: number;
    totalEstimatedOutputTokens: number;
  };
}
