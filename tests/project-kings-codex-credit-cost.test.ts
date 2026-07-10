import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateProjectKingsCodexCreditMicros,
  getProjectKingsCodexCreditRate
} from "../lib/project-kings/codex-credit-cost";

test("calculates microcredits without double-counting cached or reasoning tokens", () => {
  assert.equal(
    calculateProjectKingsCodexCreditMicros({
      model: "gpt-5.4-mini",
      usage: {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 20,
        reasoningOutputTokens: 5
      }
    }),
    3_460
  );
});

test("uses the frozen official Codex credit rate per model", () => {
  assert.deepEqual(getProjectKingsCodexCreditRate("gpt-5.4"), {
    inputPerMillionTokens: 62.5,
    cachedInputPerMillionTokens: 6.25,
    outputPerMillionTokens: 375
  });
  assert.throws(() => getProjectKingsCodexCreditRate("gpt-5.6-luna"), /No frozen Codex credit rate/);
});

test("rejects internally inconsistent usage", () => {
  assert.throws(
    () =>
      calculateProjectKingsCodexCreditMicros({
        model: "gpt-5.4",
        usage: {
          inputTokens: 10,
          cachedInputTokens: 11,
          outputTokens: 5,
          reasoningOutputTokens: 0
        }
      }),
    /internally inconsistent/
  );
});
