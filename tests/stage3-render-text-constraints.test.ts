import assert from "node:assert/strict";
import test from "node:test";

import { agentManualCaptionIssues } from "../lib/stage2-agent-manual";
import type { Stage2HardConstraints } from "../lib/stage2-channel-config";

// Per-channel hard constraints the render-time gate (control route) enforces on
// snapshot.topText/bottomText, mirroring what the Stage 2 agent_manual path runs.
const KING_LEO: Stage2HardConstraints = {
  topLengthMin: 160,
  topLengthMax: 180,
  bottomLengthMin: 140,
  bottomLengthMax: 150,
  bannedWords: [],
  bannedOpeners: []
};

const FINAL_WHISTLE: Stage2HardConstraints = {
  topLengthMin: 6,
  topLengthMax: 56,
  bottomLengthMin: 185,
  bottomLengthMax: 340,
  bannedWords: ["clickbait"],
  bannedOpeners: ["You won't believe"]
};

test("in-range caption passes (no issues)", () => {
  const issues = agentManualCaptionIssues(
    { top: "x".repeat(170), bottom: "y".repeat(145) },
    KING_LEO
  );
  assert.deepEqual(issues, []);
});

test("top below min is flagged", () => {
  const issues = agentManualCaptionIssues(
    { top: "x".repeat(150), bottom: "y".repeat(145) },
    KING_LEO
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0], /TOP length 150 outside 160-180/);
});

test("top above max is flagged", () => {
  const issues = agentManualCaptionIssues(
    { top: "x".repeat(200), bottom: "y".repeat(145) },
    KING_LEO
  );
  assert.match(issues[0], /TOP length 200 outside 160-180/);
});

test("bottom out of range is flagged", () => {
  const issues = agentManualCaptionIssues(
    { top: "x".repeat(170), bottom: "y".repeat(100) },
    KING_LEO
  );
  assert.match(issues[0], /BOTTOM length 100 outside 140-150/);
});

test("final-whistle ranges differ per channel and are enforced", () => {
  // 40-char top + 250-char bottom is in-range for final-whistle but would be
  // out-of-range for King Leo — proving per-channel resolution matters.
  assert.deepEqual(
    agentManualCaptionIssues({ top: "x".repeat(40), bottom: "y".repeat(250) }, FINAL_WHISTLE),
    []
  );
  assert.ok(
    agentManualCaptionIssues({ top: "x".repeat(40), bottom: "y".repeat(250) }, KING_LEO).length > 0
  );
});

test("banned word and banned opener are flagged", () => {
  const banned = agentManualCaptionIssues(
    { top: "You won't believe this clip about something", bottom: "y".repeat(250) },
    FINAL_WHISTLE
  );
  assert.ok(banned.some((issue) => /banned opener/i.test(issue)));

  const bannedWord = agentManualCaptionIssues(
    { top: "A clean clickbait headline here", bottom: "y".repeat(250) },
    FINAL_WHISTLE
  );
  assert.ok(bannedWord.some((issue) => /banned word/i.test(issue)));
});
