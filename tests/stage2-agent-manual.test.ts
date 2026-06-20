import assert from "node:assert/strict";
import test from "node:test";

import type { Stage2Output } from "../app/components/types";
import {
  agentManualCaptionIssues,
  applyAgentManualCaption,
  parseAgentManualCaption
} from "../lib/stage2-agent-manual";
import { DEFAULT_STAGE2_HARD_CONSTRAINTS } from "../lib/stage2-channel-config";

const constraints = DEFAULT_STAGE2_HARD_CONSTRAINTS;

function makeOutput(): Stage2Output {
  return {
    inputAnalysis: { visualAnchors: [], commentVibe: "", keyPhraseToAdapt: "" },
    captionOptions: [
      {
        option: 1,
        candidateId: "c1",
        top: "ORIGINAL TOP CAPTION TEXT",
        bottom: "Original bottom caption text that is comfortably long enough.",
        topRu: "СТАРЫЙ ВЕРХ ПОДПИСИ",
        bottomRu: "Старый русский низ подписи.",
        highlights: { top: [{ start: 0, end: 8 }], bottom: [{ start: 0, end: 4 }] }
      },
      {
        option: 2,
        candidateId: "c2",
        top: "SECOND OPTION TOP CAPTION",
        bottom: "Second option bottom caption text for the runner-up."
      }
    ],
    titleOptions: [{ option: 1, title: "Title" }],
    finalPick: { option: 1, reason: "winner" },
    winner: {
      candidateId: "c1",
      option: 1,
      reason: "winner",
      displayTier: "finalist",
      sourceStage: "classicOneShot"
    }
  } as unknown as Stage2Output;
}

test("parseAgentManualCaption requires top and bottom", () => {
  assert.equal(parseAgentManualCaption({ top: "only top" }), null);
  assert.equal(parseAgentManualCaption(null), null);
  const caption = parseAgentManualCaption({ top: "A", bottom: "B", topRu: "А", bottomRu: "Б" });
  assert.ok(caption);
  assert.equal(caption?.top, "A");
  assert.equal(caption?.bottomRu, "Б");
});

test("applyAgentManualCaption overwrites the winning option and marks constraintCheck passed", () => {
  const output = makeOutput();
  const top = "MEMORY IS THE NEXT AI LEAP";
  const bottom = "Altman says the next jump is memory, not raw reasoning power.";
  const result = applyAgentManualCaption(
    output,
    { top, bottom, topRu: "ПАМЯТЬ — СЛЕДУЮЩИЙ СКАЧОК", bottomRu: "Олтман о памяти, а не о мощности." },
    constraints
  );
  assert.equal(result.applied, true);
  const winningOption = output.captionOptions.find((option) => option.option === output.finalPick.option)!;
  assert.equal(winningOption.top, top);
  assert.equal(winningOption.bottom, bottom);
  assert.equal(winningOption.topRu, "ПАМЯТЬ — СЛЕДУЮЩИЙ СКАЧОК");
  assert.equal(winningOption.constraintCheck?.passed, true);
  assert.equal(output.winner?.constraintCheck?.passed, true);
  // stale highlight spans (positions into the OLD text) must be replaced, not kept.
  assert.deepEqual(winningOption.highlights?.top, []);
  assert.deepEqual(winningOption.highlights?.bottom, []);
  // the non-winning option is left untouched
  assert.equal(output.captionOptions[1].top, "SECOND OPTION TOP CAPTION");
});

test("applyAgentManualCaption mirrors English into RU when the agent omits translations", () => {
  const output = makeOutput();
  const top = "THE SMALL TOOL DID THE LIFTING";
  const bottom = "A tiny utility quietly carried the entire workflow this week.";
  const result = applyAgentManualCaption(output, { top, bottom }, constraints);
  assert.equal(result.applied, true);
  const winningOption = output.captionOptions.find((option) => option.option === output.finalPick.option)!;
  // bilingual fields stay present (rollout audit requires them) and are NOT stale.
  assert.equal(winningOption.topRu, top);
  assert.equal(winningOption.bottomRu, bottom);
});

test("applyAgentManualCaption falls back (no mutation) when text violates hard constraints", () => {
  const output = makeOutput();
  const before = output.captionOptions[0].top;
  const result = applyAgentManualCaption(output, { top: "SHORT", bottom: "tiny" }, constraints);
  assert.equal(result.applied, false);
  assert.ok(result.issues.length > 0);
  assert.equal(output.captionOptions[0].top, before);
});

test("agentManualCaptionIssues flags length violations", () => {
  const longBottom = "x".repeat(constraints.bottomLengthMax + 40);
  const issues = agentManualCaptionIssues({ top: "OK LENGTH TOP CAPTION HERE", bottom: longBottom }, constraints);
  assert.ok(issues.some((issue) => issue.includes("BOTTOM length")));
});
