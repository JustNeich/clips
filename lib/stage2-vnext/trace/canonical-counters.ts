import type { Stage2VNextCanonicalCounters, Stage2VNextTraceV3 } from "../contracts";
import { collectCandidatesInState } from "./lineage";

export function buildCanonicalCounters(trace: Pick<
  Stage2VNextTraceV3,
  "inputs" | "stageOutputs" | "candidateLineage" | "selection"
>): Stage2VNextCanonicalCounters {
  const uniqueDownstreamExampleIds = new Set(
    trace.stageOutputs.exampleUsage.flatMap((usage) =>
      usage.stageId === "example_router" ? [] : usage.passedExampleIds
    )
  );

  return {
    sourceCommentsAvailable: trace.inputs.source.comments.length,
    sourceCommentsPassedToAudienceMiner: trace.inputs.source.comments.length,
    sourceCommentsPassedToTruthExtractor: trace.inputs.source.comments.length,
    examplesRetrieved: trace.stageOutputs.exampleRouter.retrievedExamples.length,
    examplesPassedDownstream: uniqueDownstreamExampleIds.size,
    semanticDraftsGenerated: trace.stageOutputs.semanticDraftGenerator.drafts.length,
    packedCandidatesGenerated: trace.stageOutputs.constraintPacker.packedCandidates.length,
    packedCandidatesValid: trace.stageOutputs.constraintPacker.packedCandidates.filter(
      (candidate) =>
        candidate.validations.schemaPass &&
        candidate.validations.topLengthPass &&
        candidate.validations.bottomLengthPass &&
        candidate.validations.bannedPatternPass
    ).length,
    hardRejectedCount: collectCandidatesInState(trace.candidateLineage, "hard_rejected").length,
    survivorCount: trace.candidateLineage.filter((record) =>
      record.state === "survivor" ||
      record.state === "rewritten" ||
      record.state === "ranked_shortlist" ||
      record.state === "visible_shortlist" ||
      record.state === "winner"
    ).length,
    visibleShortlistCount: trace.selection?.visibleCandidateIds.length ?? 0,
    winnerCount: trace.selection?.winnerCandidateId ? 1 : 0
  };
}
