import assert from "node:assert/strict";
import test from "node:test";

import {
  createProjectKingsStageQualityEvaluator,
  evaluateProjectKingsStageBenchmarkQuality,
  parseSourcePolicyVector
} from "../lib/project-kings/stage-benchmark-quality";
import type { ProductionAgentOutputByRole } from "../lib/project-kings/production-agent-contracts";

type SourcePolicyOutput = ProductionAgentOutputByRole["source_policy"];

function sourcePolicyOutput(input: {
  caseId: string;
  signals: Record<string, string>;
}): SourcePolicyOutput {
  return {
    candidateId: input.caseId,
    signals: input.signals
  } as unknown as SourcePolicyOutput;
}

const CASE_ID = "cop-instagram-test-case";

function evaluateSourcePolicy(expected: string, signals: Record<string, string>) {
  return evaluateProjectKingsStageBenchmarkQuality({
    role: "source_policy",
    caseId: CASE_ID,
    expectedQualityLabel: expected,
    output: sourcePolicyOutput({ caseId: CASE_ID, signals })
  });
}

const ALL_ABSENT = {
  graphicViolence: "absent",
  unsupportedAllegation: "absent",
  minorInSensitiveIncident: "absent",
  realisticPoliticalOrPublicFigureDeepfake: "absent"
};

test("sp: prefix never leaks into the decision (evaluator-v2 regression)", () => {
  // v2 of the evaluator matched the letter p inside the "sp:" prefix, which
  // turned every all-absent case into block-vs-block and passed everything.
  assert.deepEqual(parseSourcePolicyVector("sp:a,a,a,a"), ["a", "a", "a", "a"]);
  assert.equal(parseSourcePolicyVector("sp:a,a,a"), null);
  assert.equal(parseSourcePolicyVector("a,a,a,a"), null);
  assert.equal(parseSourcePolicyVector("sp:a,x,a,a"), null);

  const allowAllow = evaluateSourcePolicy("sp:a,a,a,a", ALL_ABSENT);
  assert.equal(allowAllow.passed, true);
  assert.ok(allowAllow.evidence.includes("expectedDecision=allow"));
  assert.ok(allowAllow.evidence.includes("actualDecision=allow"));

  const allowBlock = evaluateSourcePolicy("sp:a,a,a,a", {
    ...ALL_ABSENT,
    unsupportedAllegation: "present"
  });
  assert.equal(allowBlock.passed, false);
  assert.notEqual(allowBlock.critical, true);
  assert.ok(allowBlock.evidence.includes("expectedDecision=allow"));
  assert.ok(allowBlock.evidence.includes("actualDecision=block"));
});

test("false-allow is a critical failure; p/u confusion inside block is not", () => {
  const falseAllow = evaluateSourcePolicy("sp:a,p,a,a", ALL_ABSENT);
  assert.equal(falseAllow.passed, false);
  assert.equal(falseAllow.critical, true);

  const blockBlock = evaluateSourcePolicy("sp:a,a,a,u", {
    ...ALL_ABSENT,
    realisticPoliticalOrPublicFigureDeepfake: "present"
  });
  assert.equal(blockBlock.passed, true);
  assert.notEqual(blockBlock.critical, true);
});

test("structurally invalid source_policy output fails without counting as false-allow on allow cases", () => {
  const wrongBinding = evaluateProjectKingsStageBenchmarkQuality({
    role: "source_policy",
    caseId: CASE_ID,
    expectedQualityLabel: "sp:a,a,a,a",
    output: sourcePolicyOutput({ caseId: "some-other-case", signals: ALL_ABSENT })
  });
  assert.equal(wrongBinding.passed, false);
  assert.ok(wrongBinding.evidence.includes("actualDecision=invalid"));

  const invalidSignal = evaluateSourcePolicy("sp:a,p,a,a", {
    ...ALL_ABSENT,
    unsupportedAllegation: "not-a-signal"
  });
  assert.equal(invalidSignal.passed, false);
  // An unparseable answer on a block case is a failure but not a false-allow.
  assert.notEqual(invalidSignal.critical, true);
});

test("malformed expected labels crash loudly instead of scoring silently", () => {
  assert.throws(
    () => evaluateSourcePolicy("block", ALL_ABSENT),
    /not a four-signal vector/
  );
});

test("evaluator identity is v3 and binds the parser implementation", () => {
  const evaluator = createProjectKingsStageQualityEvaluator();
  assert.equal(evaluator.evaluatorId, "project-kings-stage-quality");
  assert.equal(evaluator.evaluatorVersion, "v3");
  assert.match(evaluator.implementationSha256, /^[a-f0-9]{64}$/);
  assert.ok(JSON.stringify(evaluator.config).includes("prefix"));
});
