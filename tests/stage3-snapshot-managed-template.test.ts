import assert from "node:assert/strict";
import test from "node:test";

import { SCIENCE_CARD, SCIENCE_CARD_V7 } from "../lib/stage3-template";
import { resolveStage3SnapshotManagedTemplateState } from "../lib/stage3-snapshot-managed-template";

test("preview managed template state wins over stale page state for the same template id", () => {
  const resolved = resolveStage3SnapshotManagedTemplateState({
    templateId: "managed-template-1",
    pageState: {
      managedId: "managed-template-1",
      baseTemplateId: "science-card-v1",
      templateConfig: SCIENCE_CARD,
      updatedAt: "2026-03-31T10:00:00.000Z"
    },
    previewState: {
      managedId: "managed-template-1",
      baseTemplateId: "science-card-v7",
      templateConfig: SCIENCE_CARD_V7,
      updatedAt: "2026-03-31T10:05:00.000Z"
    }
  });

  assert.equal(resolved?.baseTemplateId, "science-card-v7");
  assert.equal(resolved?.updatedAt, "2026-03-31T10:05:00.000Z");
});

test("mismatched preview managed template state is ignored", () => {
  const resolved = resolveStage3SnapshotManagedTemplateState({
    templateId: "managed-template-1",
    pageState: {
      managedId: "managed-template-1",
      baseTemplateId: "science-card-v1",
      templateConfig: SCIENCE_CARD,
      updatedAt: "2026-03-31T10:00:00.000Z"
    },
    previewState: {
      managedId: "managed-template-2",
      baseTemplateId: "science-card-v7",
      templateConfig: SCIENCE_CARD_V7,
      updatedAt: "2026-03-31T10:05:00.000Z"
    }
  });

  assert.equal(resolved?.baseTemplateId, "science-card-v1");
  assert.equal(resolved?.updatedAt, "2026-03-31T10:00:00.000Z");
});
