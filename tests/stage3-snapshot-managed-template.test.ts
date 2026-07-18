import assert from "node:assert/strict";
import test from "node:test";

import type { Stage3RenderPlan } from "../app/components/types";
import {
  CHANNEL_STORY_TEMPLATE_ID,
  SCIENCE_CARD,
  SCIENCE_CARD_V7,
  STAGE3_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  getTemplateById
} from "../lib/stage3-template";
import { resolveManagedTemplateRuntimeSync } from "../lib/managed-template-runtime";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import {
  ORACLE_TEMPLATE_POOL_MANAGED_TEMPLATE_IDS,
  applyStage3AuthoritativePreviewContent,
  canonicalizeStage3SnapshotManagedTemplateState,
  hasResolvedStage3ManagedTemplateState,
  resolveStage3SnapshotManagedTemplateState
} from "../lib/stage3-snapshot-managed-template";

const ORACLE_TEMPLATE_POOL_NAMES = [
  "oracle-pool-top-bottom-observation-v1",
  "oracle-pool-lead-body-incident-v1",
  "oracle-pool-lead-body-evidence-v1",
  "oracle-pool-lead-body-compact-v1",
  "oracle-pool-body-visual-v1"
] as const;

function buildFullOraclePoolTemplateState(
  templateId: string,
  name: string,
  templateConfig = cloneStage3TemplateConfig(getTemplateById(CHANNEL_STORY_TEMPLATE_ID))
) {
  return {
    id: templateId,
    name,
    description: "Published Oracle template-pool entry",
    layoutFamily: CHANNEL_STORY_TEMPLATE_ID,
    baseTemplateId: CHANNEL_STORY_TEMPLATE_ID,
    workspaceId: "oracle-workspace",
    creatorUserId: null,
    creatorDisplayName: null,
    createdAt: "2026-07-18T14:20:00.000Z",
    updatedAt: "2026-07-18T14:21:24.000Z",
    archivedAt: null,
    content: {
      topText: "",
      bottomText: "",
      channelName: "Oracle",
      channelHandle: "@oracle",
      highlights: { top: [], bottom: [] },
      topHighlightPhrases: [],
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    },
    templateConfig,
    shadowLayers: [],
    versions: []
  };
}

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
      highlights: { top: [], bottom: [] },
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
      highlights: { top: [], bottom: [] },
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
      highlights: { top: [], bottom: [] },
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

test("template snapshot hash changes when highlight spans change", () => {
  const baseSnapshot = buildTemplateRenderSnapshot({
    templateId: "science-card-v7",
    templateConfigOverride: SCIENCE_CARD_V7,
    content: {
      topText: "John Lennon signed the album in 1980.",
      bottomText: "The autograph came back hours later.",
      channelName: "Fresh Author",
      channelHandle: "@fresh",
      highlights: { top: [], bottom: [] },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });
  const highlightedSnapshot = buildTemplateRenderSnapshot({
    templateId: "science-card-v7",
    templateConfigOverride: SCIENCE_CARD_V7,
    content: {
      topText: "John Lennon signed the album in 1980.",
      bottomText: "The autograph came back hours later.",
      channelName: "Fresh Author",
      channelHandle: "@fresh",
      highlights: {
        top: [
          { start: 0, end: 11, slotId: "slot1" },
          { start: 32, end: 36, slotId: "slot2" }
        ],
        bottom: [{ start: 4, end: 13, slotId: "slot3" }]
      },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  assert.notEqual(baseSnapshot.snapshotHash, highlightedSnapshot.snapshotHash);
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
  assert.equal(runtime.templateConfig.layoutKind, SCIENCE_CARD_V7.layoutKind);
  assert.equal(runtime.templateConfig.card.width, SCIENCE_CARD_V7.card.width);
  assert.equal(runtime.templateConfig.author.checkAssetPath, SCIENCE_CARD_V7.author.checkAssetPath);
  assert.equal(runtime.templateConfig.channelStory, undefined);
});

test("the five published Oracle template-pool states canonicalize to compact worker state", () => {
  assert.equal(ORACLE_TEMPLATE_POOL_MANAGED_TEMPLATE_IDS.length, 5);
  for (const [index, templateId] of ORACLE_TEMPLATE_POOL_MANAGED_TEMPLATE_IDS.entries()) {
    const rawState = buildFullOraclePoolTemplateState(
      templateId,
      ORACLE_TEMPLATE_POOL_NAMES[index]
    );
    const canonicalState = canonicalizeStage3SnapshotManagedTemplateState(
      rawState,
      templateId
    );

    assert.ok(canonicalState, templateId);
    assert.equal(canonicalState.managedId, templateId);
    assert.equal(canonicalState.baseTemplateId, CHANNEL_STORY_TEMPLATE_ID);
    assert.equal(canonicalState.updatedAt, rawState.updatedAt);
    assert.equal(
      Object.prototype.hasOwnProperty.call(canonicalState, "id"),
      false,
      `${templateId} must not keep the raw id field`
    );
  }
});

test("Incident full state preserves strict bottom highlight configuration and spans", () => {
  const templateId = "oracle-pool-lead-body-incident-v1-babca826";
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(CHANNEL_STORY_TEMPLATE_ID));
  templateConfig.highlights = {
    enabled: true,
    topEnabled: false,
    bottomEnabled: true,
    slots: [
      {
        slotId: "slot1",
        enabled: true,
        color: "#f4df36",
        label: "Incident",
        guidance: "Highlight the incident evidence."
      },
      {
        slotId: "slot2",
        enabled: false,
        color: "#2cc8c3",
        label: "Disabled support",
        guidance: ""
      },
      {
        slotId: "slot3",
        enabled: false,
        color: "#ff5f6d",
        label: "Disabled urgency",
        guidance: ""
      }
    ]
  };
  const fullState = buildFullOraclePoolTemplateState(
    templateId,
    "oracle-pool-lead-body-incident-v1",
    templateConfig
  );

  const runtime = resolveManagedTemplateRuntimeSync(templateId, fullState);
  assert.equal(runtime.managedTemplateId, templateId);
  assert.equal(runtime.baseTemplateId, CHANNEL_STORY_TEMPLATE_ID);
  assert.equal(runtime.templateConfig.highlights.enabled, true);
  assert.equal(runtime.templateConfig.highlights.topEnabled, false);
  assert.equal(runtime.templateConfig.highlights.bottomEnabled, true);
  assert.equal(runtime.templateConfig.highlights.slots[0].color, "#f4df36");

  const bottomText =
    "The bill passes close as it drifts under fish thrashes before the line snap away.";
  assert.equal(bottomText.length, 81);
  assert.equal(bottomText.slice(4, 21), "bill passes close");
  assert.equal(bottomText.slice(41, 54), "fish thrashes");
  const bottomHighlights = [
    { start: 4, end: 21, slotId: "slot1" as const },
    { start: 41, end: 54, slotId: "slot1" as const }
  ];
  const snapshot = buildTemplateRenderSnapshot({
    templateId: runtime.baseTemplateId,
    templateConfigOverride: runtime.templateConfig,
    content: {
      topText: "Close call",
      bottomText,
      channelName: "Nature Nearmiss",
      channelHandle: "@nature",
      highlights: { top: [], bottom: bottomHighlights },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  assert.deepEqual(snapshot.content.highlights.top, []);
  assert.deepEqual(snapshot.content.highlights.bottom, bottomHighlights);
});

test("unknown or mismatched full managed template state fails closed", () => {
  const incidentId = "oracle-pool-lead-body-incident-v1-babca826";
  const incidentState = buildFullOraclePoolTemplateState(
    incidentId,
    "oracle-pool-lead-body-incident-v1"
  );
  const unknownId = "oracle-pool-unknown-v1-deadbeef";
  const unknownState = buildFullOraclePoolTemplateState(unknownId, "oracle-pool-unknown-v1");

  assert.throws(
    () => resolveManagedTemplateRuntimeSync(unknownId, unknownState),
    /managed_template_state_invalid/
  );
  assert.throws(
    () =>
      resolveManagedTemplateRuntimeSync(
        "oracle-pool-lead-body-evidence-v1-4bf5cc09",
        incidentState
      ),
    /managed_template_state_invalid/
  );
});

test("incomplete full managed template state fails closed", () => {
  const templateId = "oracle-pool-lead-body-incident-v1-babca826";
  const invalidState = {
    ...buildFullOraclePoolTemplateState(
      templateId,
      "oracle-pool-lead-body-incident-v1"
    ),
    templateConfig: {
      layoutKind: "channel_story",
      highlights: {
        enabled: true,
        topEnabled: false,
        bottomEnabled: true,
        slots: []
      }
    }
  };

  assert.throws(
    () => resolveManagedTemplateRuntimeSync(templateId, invalidState),
    /managed_template_state_invalid/
  );
});

test("caller state cannot override a built-in template", () => {
  const runtime = resolveManagedTemplateRuntimeSync(STAGE3_TEMPLATE_ID, {
    managedId: STAGE3_TEMPLATE_ID,
    baseTemplateId: "science-card-v7",
    templateConfig: SCIENCE_CARD_V7,
    updatedAt: "2026-07-15T12:00:00.000Z"
  });

  assert.equal(runtime.managedTemplateId, STAGE3_TEMPLATE_ID);
  assert.equal(runtime.baseTemplateId, STAGE3_TEMPLATE_ID);
  assert.notEqual(runtime.updatedAt, "2026-07-15T12:00:00.000Z");
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

test("missing requested managed template resolves away from the broken id", () => {
  const runtime = resolveManagedTemplateRuntimeSync("missing-template-id");

  assert.notEqual(runtime.managedTemplateId, "missing-template-id");
  assert.equal(runtime.baseTemplateId, "science-card-v1");
});
