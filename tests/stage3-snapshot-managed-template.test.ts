import assert from "node:assert/strict";
import test from "node:test";

import type { Stage3RenderPlan } from "../app/components/types";
import { SCIENCE_CARD, SCIENCE_CARD_V7 } from "../lib/stage3-template";
import { resolveManagedTemplateRuntimeSync } from "../lib/managed-template-runtime";
import {
  createManagedTemplate,
  deleteManagedTemplate
} from "../lib/managed-template-store";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import {
  applyStage3AuthoritativePreviewContent,
  hasResolvedStage3ManagedTemplateState,
  resolveStage3SnapshotManagedTemplateState
} from "../lib/stage3-snapshot-managed-template";

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

test("authoritative preview snapshot wins for author and font scales", () => {
  const basePlan = {
    templateId: "managed-template-1",
    authorName: "Page Author",
    authorHandle: "@page",
    topFontScale: 1.1,
    bottomFontScale: 1.2
  } as Stage3RenderPlan;
  const templateSnapshot = buildTemplateRenderSnapshot({
    templateId: "science-card-v7",
    templateConfigOverride: SCIENCE_CARD_V7,
    content: {
      topText: "Top",
      bottomText: "Bottom",
      channelName: "Preview Author",
      channelHandle: "@preview",
      topFontScale: 1.44,
      bottomFontScale: 0.93,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  const resolved = applyStage3AuthoritativePreviewContent(basePlan, { templateSnapshot });

  assert.equal(resolved.authorName, "Preview Author");
  assert.equal(resolved.authorHandle, "@preview");
  assert.equal(resolved.topFontScale, 1.44);
  assert.equal(resolved.bottomFontScale, 0.93);
});

test("missing authoritative preview snapshot leaves render plan unchanged", () => {
  const basePlan = {
    templateId: "managed-template-1",
    authorName: "Page Author",
    authorHandle: "@page",
    topFontScale: 1.1,
    bottomFontScale: 1.2
  } as Stage3RenderPlan;

  const resolved = applyStage3AuthoritativePreviewContent(basePlan, { templateSnapshot: null });

  assert.deepEqual(resolved, basePlan);
});

test("authoritative preview content preserves preview snapshot hash", () => {
  const stalePagePlan = {
    templateId: "managed-template-1",
    authorName: "Stale Author",
    authorHandle: "@stale",
    topFontScale: 1.02,
    bottomFontScale: 1.08
  } as Stage3RenderPlan;
  const authoritativePreview = buildTemplateRenderSnapshot({
    templateId: "science-card-v7",
    templateConfigOverride: SCIENCE_CARD_V7,
    content: {
      topText: "Preview top",
      bottomText: "Preview bottom",
      channelName: "Fresh Author",
      channelHandle: "@fresh",
      topFontScale: 1.37,
      bottomFontScale: 0.91,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  const effectivePlan = applyStage3AuthoritativePreviewContent(stalePagePlan, {
    templateSnapshot: authoritativePreview
  });
  const rebuiltSnapshot = buildTemplateRenderSnapshot({
    templateId: authoritativePreview.templateId,
    templateConfigOverride: SCIENCE_CARD_V7,
    content: {
      topText: authoritativePreview.content.topText,
      bottomText: authoritativePreview.content.bottomText,
      channelName: effectivePlan.authorName,
      channelHandle: effectivePlan.authorHandle,
      topFontScale: effectivePlan.topFontScale,
      bottomFontScale: effectivePlan.bottomFontScale,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    },
    fitOverride: {
      topFontPx: authoritativePreview.fit.topFontPx,
      bottomFontPx: authoritativePreview.fit.bottomFontPx,
      topLineHeight: authoritativePreview.fit.topLineHeight,
      bottomLineHeight: authoritativePreview.fit.bottomLineHeight,
      topLines: authoritativePreview.fit.topLines,
      bottomLines: authoritativePreview.fit.bottomLines,
      topCompacted: authoritativePreview.fit.topCompacted,
      bottomCompacted: authoritativePreview.fit.bottomCompacted
    }
  });

  assert.equal(rebuiltSnapshot.snapshotHash, authoritativePreview.snapshotHash);
});

test("snapshot-backed managed template runtime wins without reading the local store", () => {
  const runtime = resolveManagedTemplateRuntimeSync("managed-template-1", {
    managedId: "managed-template-1",
    baseTemplateId: "science-card-v7",
    templateConfig: SCIENCE_CARD_V7,
    updatedAt: "2026-04-02T10:00:00.000Z"
  });

  assert.equal(runtime.managedTemplateId, "managed-template-1");
  assert.equal(runtime.baseTemplateId, "science-card-v7");
  assert.equal(runtime.updatedAt, "2026-04-02T10:00:00.000Z");
  assert.deepEqual(runtime.templateConfig, SCIENCE_CARD_V7);
});

test("custom managed template state is not considered resolved until it has a revision", () => {
  assert.equal(
    hasResolvedStage3ManagedTemplateState(
      {
        managedId: "managed-template-1",
        updatedAt: null
      },
      "managed-template-1"
    ),
    false
  );
});

test("missing requested managed template falls back to built-in default instead of another saved template", async () => {
  const created = await createManagedTemplate(
    {
      name: "Unrelated template",
      description: "Should not be auto-selected for another template id.",
      baseTemplateId: "science-card-v7",
      content: {
        topText: "Top",
        bottomText: "Bottom",
        channelName: "Runtime",
        channelHandle: "@runtime",
        topHighlightPhrases: [],
        topFontScale: 1,
        bottomFontScale: 1,
        previewScale: 0.34,
        mediaAsset: null,
        backgroundAsset: null,
        avatarAsset: null
      },
      templateConfig: SCIENCE_CARD_V7,
      shadowLayers: []
    },
    {
      workspaceId: "workspace-test",
      creatorUserId: "user-test",
      creatorDisplayName: "Runtime Test"
    }
  );

  try {
    const runtime = resolveManagedTemplateRuntimeSync("missing-template-id");
    assert.equal(runtime.managedTemplateId, "science-card-v1");
    assert.equal(runtime.baseTemplateId, "science-card-v1");
    assert.notEqual(runtime.managedTemplateId, created.id);
  } finally {
    await deleteManagedTemplate(created.id);
  }
});
