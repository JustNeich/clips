import assert from "node:assert/strict";
import test from "node:test";

import type { Stage2Output } from "../app/components/types";
import {
  captionContainsBannedWord,
  captionTextContainsBannedWord,
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  type Stage2HardConstraints
} from "../lib/stage2-channel-config";
import { validateStage2Output } from "../lib/stage2-output-validation";
import { validateBannedPatterns } from "../lib/stage2-vnext/validators/banned-pattern-validator";

// Regression for the СОФТ "banned words по кругу" report (Катя, 2026-06): a
// configured banned word like "vibe" was matched as a SUBSTRING, so ordinary
// words such as "describe"/"archive"/"revive" were rejected as banned. The
// cleanup step only strips whole words, so it could never repair these
// captions, and Stage 2 looped (~11 re-runs) before any candidate passed.
// Banned-word detection must be whole-word, matching the cleanup semantics.

const WIDE_CONSTRAINTS: Stage2HardConstraints = {
  topLengthMin: 1,
  topLengthMax: 500,
  bottomLengthMin: 1,
  bottomLengthMax: 500,
  bannedWords: ["vibe"],
  bannedOpeners: []
};

function bannedWarningCount(output: Stage2Output, constraints: Stage2HardConstraints): number {
  return validateStage2Output(output, constraints).filter((warning) =>
    /banned words/i.test(warning.message)
  ).length;
}

function makeOutput(top: string, bottom: string): Stage2Output {
  return {
    inputAnalysis: { visualAnchors: [], commentVibe: "", keyPhraseToAdapt: "" },
    captionOptions: [{ option: 1, top, bottom }],
    titleOptions: [],
    finalPick: { option: 1, reason: "" }
  };
}

test("captionTextContainsBannedWord matches whole words only, case-insensitively", () => {
  // The banned word as a substring of a legitimate word must NOT match.
  assert.equal(captionTextContainsBannedWord("Describe the quiet moment", "vibe"), false);
  assert.equal(captionTextContainsBannedWord("Pulled from the archive", "vibe"), false);
  assert.equal(captionTextContainsBannedWord("They revive the old plan", "vibe"), false);

  // The banned word as a standalone word must match, any case.
  assert.equal(captionTextContainsBannedWord("the vibe is unreal", "vibe"), true);
  assert.equal(captionTextContainsBannedWord("THE VIBE IS UNREAL", "vibe"), true);
  assert.equal(captionTextContainsBannedWord("punctuated. vibe, here", "vibe"), true);

  // Empty / whitespace banned entries never match.
  assert.equal(captionTextContainsBannedWord("anything at all", "   "), false);
});

test("captionContainsBannedWord scans a list with whole-word semantics", () => {
  const list = ["vibe", "as a closer"];
  assert.equal(captionContainsBannedWord("Describe the archive briefly", list), false);
  // Multi-word banned phrase still matches as a contiguous phrase.
  assert.equal(captionContainsBannedWord("Saved as a closer for later", list), true);
  assert.equal(captionContainsBannedWord("the vibe shifts", list), true);
});

test("validateStage2Output no longer flags substring matches of banned words", () => {
  // Caption that only contains the banned substring inside real words.
  assert.equal(bannedWarningCount(makeOutput("Describe the moment", "Pulled from the archive"), WIDE_CONSTRAINTS), 0);
  // Caption that contains the actual banned word as a standalone word.
  assert.equal(bannedWarningCount(makeOutput("The vibe is unreal here", "A clean and grounded bottom line"), WIDE_CONSTRAINTS), 1);
});

test("validateBannedPatterns (vnext) flags whole banned words but not substrings", () => {
  const clean = validateBannedPatterns({
    top: "Describe the moment",
    bottom: "Pulled from the archive",
    constraints: WIDE_CONSTRAINTS
  });
  assert.equal(clean.passed, true);
  assert.equal(clean.issues.some((issue) => /banned word/i.test(issue)), false);

  const flagged = validateBannedPatterns({
    top: "The vibe is unreal",
    bottom: "A grounded bottom line",
    constraints: WIDE_CONSTRAINTS
  });
  assert.equal(flagged.passed, false);
  assert.equal(flagged.issues.some((issue) => /banned word "vibe"/i.test(issue)), true);
});

test("empty banned-word list leaves captions untouched", () => {
  assert.equal(
    bannedWarningCount(makeOutput("Describe the moment", "Pulled from the archive"), DEFAULT_STAGE2_HARD_CONSTRAINTS),
    0
  );
});
