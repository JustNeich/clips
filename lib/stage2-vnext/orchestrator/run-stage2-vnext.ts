import type {
  CandidateLineageRecord,
  ExampleRoutingDecision,
  FinalSelection,
  JudgeScoreCard,
  PackedCandidate,
  RetrievedExample,
  SemanticDraft,
  SeoPayload,
  SourcePacket,
  Stage2PipelineVersion,
  Stage2VNextCriticGate,
  Stage2VNextFeatureFlagSnapshot,
  Stage2VNextTraceV3,
  Stage2VNextWorkerBuild,
  StrategyPacket,
  TitleOption
} from "../contracts";
import type { Stage2HardConstraints } from "../../stage2-channel-config";
import { buildTraceV3 } from "../trace/build-trace-v3";
import { validateTraceV3, type Stage2VNextTraceValidationResult } from "../validators";

export function buildStage2VNextBridgeTrace(input: {
  source: SourcePacket;
  channel: {
    channelId: string;
    name: string;
    username: string;
    hardConstraints: Stage2HardConstraints;
    userInstruction: string | null;
  };
  exampleRouting: {
    decision: ExampleRoutingDecision;
    retrievedExamples: RetrievedExample[];
    passedExamples: RetrievedExample[];
    blockedExamples: RetrievedExample[];
  };
  strategy: StrategyPacket | null;
  semanticDrafts: SemanticDraft[];
  packedCandidates: PackedCandidate[];
  judgeCards: JudgeScoreCard[];
  selection: FinalSelection | null;
  titles: TitleOption[];
  seo: SeoPayload | null;
  candidateLineage: CandidateLineageRecord[];
  exampleUsage: Stage2VNextTraceV3["stageOutputs"]["exampleUsage"];
  criticGate: Stage2VNextCriticGate;
  featureFlags: Stage2VNextFeatureFlagSnapshot;
  pipelineVersion: Stage2PipelineVersion;
  stageChainVersion: string;
  workerBuild: Stage2VNextWorkerBuild;
  cost?: Partial<Stage2VNextTraceV3["cost"]>;
}): {
  trace: Stage2VNextTraceV3;
  validation: Stage2VNextTraceValidationResult;
} {
  const trace = buildTraceV3({
    meta: {
      version: "stage2-vnext-trace-v3",
      generatedAt: new Date().toISOString(),
      featureFlag: "STAGE2_VNEXT_ENABLED",
      featureFlags: input.featureFlags,
      pipelineVersion: input.pipelineVersion,
      stageChainVersion: input.stageChainVersion,
      workerBuild: input.workerBuild,
      compatibilityMode: "legacy_bridge",
      implementedStages: [
        "example_router",
        "semantic_draft_generator",
        "constraint_packer",
        "quality_court",
        "pairwise_final_selector",
        "title_and_seo"
      ]
    },
    inputs: {
      source: input.source,
      channel: input.channel
    },
    stageOutputs: {
      clipTruthExtractor: null,
      audienceMiner: null,
      exampleRouter: input.exampleRouting,
      strategySearch: input.strategy,
      semanticDraftGenerator: {
        drafts: input.semanticDrafts
      },
      constraintPacker: {
        packedCandidates: input.packedCandidates
      },
      qualityCourt: {
        judgeCards: input.judgeCards
      },
      pairwiseFinalSelector: input.selection,
      titleAndSeo: {
        titles: input.titles,
        seo: input.seo
      },
      exampleUsage: input.exampleUsage
    },
    candidateLineage: input.candidateLineage,
    criticGate: input.criticGate,
    validation: {
      validatorsRun: [
        "schemaValidator",
        "lengthValidator",
        "bannedPatternValidator",
        "traceValidator"
      ],
      issues: []
    },
    selection: input.selection,
    memory: {
      status: "not_implemented"
    },
    cost: {
      totalPromptChars: input.cost?.totalPromptChars ?? 0,
      totalEstimatedInputTokens: input.cost?.totalEstimatedInputTokens ?? 0,
      totalEstimatedOutputTokens: input.cost?.totalEstimatedOutputTokens ?? 0
    }
  });

  const validation = validateTraceV3(trace);
  if (!validation.ok) {
    trace.validation.issues.push(...validation.issues);
  }
  return {
    trace,
    validation
  };
}
