import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTemplateHighlightSpansFromPhrases,
  countEnabledTemplateHighlightSlots,
  countTemplateHighlightSpans,
  clearTemplateCaptionHighlightsBlock,
  isTemplateHighlightingActive,
  normalizeTemplateHighlightConfig
} from "../lib/template-highlights";

test("highlight config defaults stay disabled and seed slot1 from accent color", () => {
  const config = normalizeTemplateHighlightConfig(undefined, {
    accentColor: "#47c96f"
  });

  assert.equal(config.enabled, false);
  assert.equal(config.topEnabled, true);
  assert.equal(config.bottomEnabled, true);
  assert.equal(config.slots[0].slotId, "slot1");
  assert.equal(config.slots[0].enabled, true);
  assert.equal(config.slots[0].color, "#47c96f");
  assert.equal(config.slots[1].slotId, "slot2");
  assert.equal(config.slots[2].slotId, "slot3");
});

test("highlight spans keep the earliest longest non-overlapping matches", () => {
  const spans = buildTemplateHighlightSpansFromPhrases({
    text: "John Lennon signed the album in 1980 and John smiled.",
    annotations: [
      { phrase: "John Lennon", slotId: "slot1" },
      { phrase: "John", slotId: "slot2" },
      { phrase: "1980", slotId: "slot3" }
    ]
  });

  assert.deepEqual(spans, [
    { start: 0, end: 11, slotId: "slot1" },
    { start: 32, end: 36, slotId: "slot3" },
    { start: 41, end: 45, slotId: "slot2" }
  ]);
});

test("clearing one highlight block preserves the other block", () => {
  const cleared = clearTemplateCaptionHighlightsBlock(
    {
      top: [{ start: 0, end: 4, slotId: "slot1" }],
      bottom: [{ start: 5, end: 9, slotId: "slot2" }]
    },
    "top"
  );

  assert.deepEqual(cleared.top, []);
  assert.deepEqual(cleared.bottom, [{ start: 5, end: 9, slotId: "slot2" }]);
});

test("highlight status helpers distinguish configured profile from active runtime usage", () => {
  const config = normalizeTemplateHighlightConfig(undefined, {
    accentColor: "#47c96f"
  });

  assert.equal(countEnabledTemplateHighlightSlots(config), 1);
  assert.equal(isTemplateHighlightingActive(config), false);

  config.enabled = true;
  assert.equal(isTemplateHighlightingActive(config), true);

  config.topEnabled = false;
  config.bottomEnabled = false;
  assert.equal(isTemplateHighlightingActive(config), false);
});

test("highlight span counter reports both aggregate and per-block totals", () => {
  const highlights = {
    top: [
      { start: 0, end: 4, slotId: "slot1" as const },
      { start: 5, end: 9, slotId: "slot2" as const }
    ],
    bottom: [{ start: 2, end: 7, slotId: "slot3" as const }]
  };

  assert.equal(countTemplateHighlightSpans(highlights), 3);
  assert.equal(countTemplateHighlightSpans(highlights, "top"), 2);
  assert.equal(countTemplateHighlightSpans(highlights, "bottom"), 1);
  assert.equal(countTemplateHighlightSpans(null), 0);
});
