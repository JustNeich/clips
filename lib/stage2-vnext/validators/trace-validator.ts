import type { Stage2VNextTraceV3 } from "../contracts";
import { buildCanonicalCounters } from "../trace/canonical-counters";
import {
  hasHardRejectedCandidateReentry,
  validateCandidateLineageRecords
} from "../trace/lineage";

export type Stage2VNextTraceValidationResult = {
  ok: boolean;
  issues: string[];
};

export function validateTraceV3(trace: Stage2VNextTraceV3): Stage2VNextTraceValidationResult {
  const issues: string[] = [];
  const expectedCounters = buildCanonicalCounters(trace);

  for (const [key, value] of Object.entries(expectedCounters)) {
    const actual = trace.canonicalCounters[key as keyof typeof expectedCounters];
    if (actual !== value) {
      issues.push(`Canonical counter mismatch for ${key}: expected ${value}, got ${actual}.`);
    }
  }

  issues.push(...validateCandidateLineageRecords(trace.candidateLineage));

  const disabledUsageLeak = trace.stageOutputs.exampleUsage.some(
    (usage) => usage.exampleMode === "disabled" && usage.passedExampleIds.length > 0
  );
  if (disabledUsageLeak) {
    issues.push("Disabled example mode still passed examples to a downstream stage.");
  }

  if (
    hasHardRejectedCandidateReentry(
      trace.candidateLineage,
      trace.selection?.visibleCandidateIds ?? []
    )
  ) {
    issues.push("A hard-rejected candidate re-entered the visible shortlist.");
  }

  if (
    trace.selection?.winnerCandidateId &&
    hasHardRejectedCandidateReentry(trace.candidateLineage, [trace.selection.winnerCandidateId])
  ) {
    issues.push("A hard-rejected candidate was promoted to winner.");
  }

  if (trace.meta.pipelineVersion === "vnext" && !trace.meta.featureFlags.STAGE2_VNEXT_ENABLED) {
    issues.push("Trace claims vNext pipeline version while STAGE2_VNEXT_ENABLED is false.");
  }

  if (!trace.meta.stageChainVersion.trim()) {
    issues.push("Trace is missing stageChainVersion.");
  }

  if (!trace.meta.workerBuild.buildId.trim() || !trace.meta.workerBuild.startedAt.trim()) {
    issues.push("Trace is missing worker build metadata.");
  }

  if (trace.stageOutputs.exampleRouter.decision.mode === "disabled") {
    if (trace.stageOutputs.exampleRouter.passedExamples.length > 0) {
      issues.push("Example router is disabled but still exposes passed examples.");
    }
    if (trace.stageOutputs.exampleRouter.decision.selectedExampleIds.length > 0) {
      issues.push("Example router is disabled but still selected example ids.");
    }
  }

  const rewriteIds = new Set(trace.criticGate.rewriteCandidateIds);
  const criticKeptIds = new Set(trace.criticGate.criticKeptCandidateIds);
  if (
    trace.criticGate.rewriteCandidateIds.length !== trace.criticGate.criticKeptCandidateIds.length ||
    trace.criticGate.rewriteCandidateIds.some((candidateId) => !criticKeptIds.has(candidateId))
  ) {
    issues.push("Rewrite pool diverged from critic-kept candidates.");
  }

  if (trace.criticGate.reserveBackfillCount !== 0) {
    issues.push("Reserve backfill is still present in the vNext critic gate.");
  }

  const validatedPoolIds = new Set(trace.criticGate.validatedShortlistPoolIds);
  const visibleShortlistIds = trace.selection?.visibleCandidateIds ?? [];
  if (visibleShortlistIds.some((candidateId) => !validatedPoolIds.has(candidateId))) {
    issues.push("Visible shortlist includes a candidate outside the validated shortlist pool.");
  }

  if (trace.selection?.winnerCandidateId && !validatedPoolIds.has(trace.selection.winnerCandidateId)) {
    issues.push("Winner is outside the validated shortlist pool.");
  }

  return {
    ok: issues.length === 0,
    issues
  };
}
