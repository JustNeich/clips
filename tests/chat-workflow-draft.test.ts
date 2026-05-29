import assert from "node:assert/strict";
import test from "node:test";

import { normalizeChatDraft } from "../lib/chat-workflow";

test("normalizeChatDraft preserves manual caption highlights when draft text is supplied", () => {
  const draft = normalizeChatDraft({
    threadId: "thread_1",
    userId: "user_1",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    lastOpenStep: 3,
    stage2: {
      instruction: "",
      selectedCaptionOption: null,
      selectedTitleOption: null
    },
    stage3: {
      topText: "THIS LINE CAN BE HIGHLIGHTED",
      bottomText: "manual bottom words need color",
      captionHighlights: {
        top: [{ start: 0, end: 4, slotId: "slot1" }],
        bottom: []
      },
      renderPlan: {
        targetDurationSec: 14,
        sourceAudioGain: 1.5
      }
    }
  });

  assert.deepEqual(draft?.stage3.captionHighlights, {
    top: [{ start: 0, end: 4, slotId: "slot1" }],
    bottom: []
  });
  assert.equal(draft?.stage3.renderPlan?.targetDurationSec, 14);
  assert.equal(draft?.stage3.renderPlan?.sourceAudioGain, 1.5);
});
