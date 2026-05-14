import assert from "node:assert/strict";
import test from "node:test";

import {
  compareCopscopesStoryTexts,
  findCopscopesDuplicateStory
} from "../lib/copscopes-story-dedupe";

test("CopScopes story dedupe catches the same incident behind different Reel shortcodes", () => {
  const first =
    "Police in California have released dashcam footage after a domestic violence suspect jumped onto a moving car. The blue sedan kept rolling through traffic while officers tried to stop it.";
  const second =
    "Dashcam video released in California shows a domestic violence suspect jumping onto a moving car before the blue sedan kept rolling through traffic as officers closed in.";

  const match = compareCopscopesStoryTexts(first, second);

  assert.equal(match.duplicate, true);
  assert.equal(match.reason, "token_overlap");
  assert.equal(match.sharedTokenCount >= 10, true);
});

test("CopScopes story dedupe does not collapse unrelated police clips", () => {
  const match = findCopscopesDuplicateStory({
    candidate: {
      id: "traffic-stop",
      caption:
        "A deputy walks up to a parked pickup during a traffic stop and finds a hidden warrant after the passenger keeps reaching under the seat."
    },
    existing: [
      {
        id: "rescue-fire",
        caption:
          "Officers sprint toward a burning flipped car and pull the trapped passenger out before the flames reach the cabin."
      }
    ]
  });

  assert.equal(match, null);
});
