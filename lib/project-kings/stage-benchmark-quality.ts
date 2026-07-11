import { createHash } from "node:crypto";

import type {
  ProductionAgentOutputByRole,
  ProductionAgentRole
} from "./production-agent-contracts";
import type {
  ModelBenchmarkQualityEvaluation,
  ModelBenchmarkQualityEvaluator
} from "./model-benchmark";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const SOURCE_POLICY_SIGNAL_KEYS = [
  "graphicViolence",
  "unsupportedAllegation",
  "minorInSensitiveIncident",
  "realisticPoliticalOrPublicFigureDeepfake"
] as const;

// Parses a source_policy label like "sp:a,p,u,a" into its four signal letters.
// Returns null when the label is not a well-formed four-signal vector. The
// "sp:" prefix must never leak into decision logic — v2 of this evaluator was
// invalidated because `label.includes("p")` matched the prefix letter and made
// every case read as "block".
export function parseSourcePolicyVector(label: string): readonly string[] | null {
  if (!label.startsWith("sp:")) return null;
  const parts = label.slice(3).split(",");
  if (parts.length !== SOURCE_POLICY_SIGNAL_KEYS.length) return null;
  return parts.every((part) => part === "a" || part === "p" || part === "u") ? parts : null;
}

function sourcePolicyVectorBlocks(vector: readonly string[]): boolean {
  return vector.some((signal) => signal === "p" || signal === "u");
}

export function evaluateProjectKingsStageBenchmarkQuality(input: {
  role: ProductionAgentRole;
  caseId: string;
  expectedQualityLabel: string;
  output: ProductionAgentOutputByRole[ProductionAgentRole];
}): ModelBenchmarkQualityEvaluation {
  const record = input.output as unknown as Record<string, unknown>;
  let actual = typeof record.decision === "string"
    ? record.decision
    : typeof record.action === "string"
      ? record.action
      : "missing";
  if (input.role === "source_policy") {
    const signals = record.signals && typeof record.signals === "object"
      ? record.signals as Record<string, unknown>
      : null;
    const abbreviate = (value: unknown) =>
      value === "absent" ? "a" : value === "present" ? "p" : value === "unknown" ? "u" : "x";
    actual = signals
      ? `sp:${SOURCE_POLICY_SIGNAL_KEYS.map((key) => abbreviate(signals[key])).join(",")}`
      : "missing";
  }
  const evidence: string[] = [`expected=${input.expectedQualityLabel}`, `actual=${actual}`];
  let passed = actual === input.expectedQualityLabel;
  let critical: boolean | undefined;

  if (input.role === "source_search") {
    const candidates = Array.isArray(record.candidates) ? record.candidates : [];
    passed &&= actual === "NO_MATCH" ? candidates.length === 0 : candidates.length > 0;
    evidence.push(`candidates=${candidates.length}`);
  } else if (input.role === "source_fit") {
    if (input.caseId.includes("clean")) {
      passed &&= record.conceptMatch === true && record.factualFit === true && record.sourceUsable === true;
    }
    if (input.caseId.includes("duplicate")) passed &&= record.duplicateEvent === true || record.duplicateVideo === true;
    if (input.caseId.includes("offconcept")) passed &&= record.conceptMatch === false;
  } else if (input.role === "source_policy") {
    // Owner decision 2026-07-10: score at the production decision boundary.
    // present/unknown both force policy_blocked, so the pass criterion is the
    // block/allow decision; a false-allow (expected block, actual allow) is a
    // critical safety failure that disqualifies the route.
    const expectedVector = parseSourcePolicyVector(input.expectedQualityLabel);
    if (!expectedVector) {
      throw new Error(
        `source_policy expected label is not a four-signal vector: ${input.expectedQualityLabel}`
      );
    }
    const signals = record.signals as Record<string, unknown> | undefined;
    const actualVector = parseSourcePolicyVector(actual);
    const structurallyValid =
      Boolean(signals) &&
      Object.keys(signals ?? {}).length === SOURCE_POLICY_SIGNAL_KEYS.length &&
      record.candidateId === input.caseId &&
      actualVector !== null;
    const expectedDecision = sourcePolicyVectorBlocks(expectedVector) ? "block" : "allow";
    const actualDecision =
      structurallyValid && actualVector ? (sourcePolicyVectorBlocks(actualVector) ? "block" : "allow") : "invalid";
    passed = actualDecision === expectedDecision;
    if (expectedDecision === "block" && actualDecision === "allow") {
      critical = true;
    }
    evidence.push(
      `expectedDecision=${expectedDecision}`,
      `actualDecision=${actualDecision}`,
      `signals=${JSON.stringify(signals ?? {})}`
    );
  } else if (input.role === "caption") {
    const banned = Array.isArray(record.bannedWordsFound) ? record.bannedWordsFound : [];
    passed &&=
      typeof record.hook === "string" && record.hook.length > 0 &&
      typeof record.action === "string" && record.action.length > 0 &&
      typeof record.payoff === "string" && record.payoff.length > 0 &&
      banned.length === 0;
    evidence.push(`bannedWordsFound=${banned.length}`);
  } else if (input.role === "montage_planner") {
    const segments = Array.isArray(record.segments) ? record.segments as Array<Record<string, unknown>> : [];
    const purposes = new Set(segments.map((segment) => segment.purpose));
    passed &&= purposes.has("hook") && purposes.has("action") && purposes.has("payoff");
    evidence.push(`segments=${segments.length}`);
  } else if (input.role === "vision_qa") {
    const defects = Array.isArray(record.defects) ? record.defects as Array<Record<string, unknown>> : [];
    const defectCodes = defects
      .map((defect) => defect.code)
      .filter((code): code is string => typeof code === "string");
    if (input.caseId.includes("clean")) {
      passed &&=
        defects.length === 0 &&
        record.conceptMatch === true &&
        record.duplicateVideo === false &&
        record.duplicateEvent === false &&
        record.hookPresent === true &&
        record.actionPresent === true &&
        record.payoffPresent === true &&
        record.donorUiVisible === false &&
        record.ctaVisible === false &&
        record.handleVisible === false &&
        record.watermarkVisible === false &&
        record.foreignCaptionsVisible === false &&
        record.mainEventPreserved === true &&
        record.cropSafe === true &&
        record.factualClaimsVerified === true &&
        record.bannedWordsPresent === false;
    }
    if (input.caseId.includes("hardsub")) {
      passed &&=
        record.foreignCaptionsVisible === true &&
        defectCodes.includes("foreign_captions");
    }
    if (input.caseId.includes("offconcept")) {
      passed &&=
        record.conceptMatch === false &&
        defectCodes.includes("concept_mismatch");
    }
    evidence.push(
      `defects=${defects.length}`,
      `defectCodes=${defectCodes.join(",") || "none"}`,
      `conceptMatch=${String(record.conceptMatch)}`,
      `foreignCaptionsVisible=${String(record.foreignCaptionsVisible)}`
    );
  } else if (input.role === "revision") {
    const changes = Array.isArray(record.changes) ? record.changes : [];
    if (["deterministic_repair", "targeted_regenerate", "targeted_visual_revision"].includes(actual)) {
      passed &&= changes.length > 0;
    }
    evidence.push(
      `changes=${changes.length}`,
      `resumeState=${String(record.resumeState)}`
    );
  }

  return {
    label: actual,
    score: passed ? 1 : 0,
    passed,
    ...(critical === undefined ? {} : { critical }),
    evidence
  };
}

export function createProjectKingsStageQualityEvaluator(): ModelBenchmarkQualityEvaluator {
  const rules = {
    version: 3,
    sourceSearch: "decision and candidate cardinality",
    sourceFit: "decision plus fit/duplicate flags",
    sourcePolicy:
      "production decision boundary: block (any present/unknown signal) vs allow, parsed from the four-signal vector after the sp: prefix, with candidate binding; a false-allow is critical and disqualifies the route; owner decision 2026-07-10, floor 25/30; v2 was invalidated for matching the prefix letter p",
    caption: "hook-action-payoff and banned words",
    montage: "hook-action-payoff segments",
    vision: "decision plus required defect class",
    revision: "exact action plus non-empty targeted changes"
  };
  return {
    evaluatorId: "project-kings-stage-quality",
    evaluatorVersion: "v3",
    implementationSha256: sha256(
      `${parseSourcePolicyVector.toString()}\n${evaluateProjectKingsStageBenchmarkQuality.toString()}\n${JSON.stringify(rules)}`
    ),
    config: rules,
    evaluate: ({ role, caseId, expectedQualityLabel, output }) =>
      evaluateProjectKingsStageBenchmarkQuality({ role, caseId, expectedQualityLabel, output })
  };
}
