import test from "node:test";
import assert from "node:assert/strict";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import { STAGE3_TEMPLATE_ID, getTemplateById } from "../lib/stage3-template";
import { buildStage3TextFitHash, createStage3TextFitSnapshot } from "../lib/stage3-text-fit";
import { assertStage3RenderTemplateSnapshotFresh } from "../lib/stage3-render-template-snapshot";

test("measured text fit can change render snapshot without invalidating the base preview snapshot hash", () => {
  const content = {
    topText:
      "Scientists found a way to splice two living plant stems, and the joined tissue starts acting like a single working system almost immediately.",
    bottomText:
      "You can watch the wound knit together, the fluids reroute, and the whole graft behave like the plant decided the surgery was always part of the plan.",
    channelName: "Science Snack",
    channelHandle: "@Science_Snack_1",
    highlights: { top: [], bottom: [] },
    topFontScale: 1.32,
    bottomFontScale: 1.18,
    previewScale: 1,
    mediaAsset: null,
    backgroundAsset: null,
    avatarAsset: null
  };

  const baseSnapshot = buildTemplateRenderSnapshot({
    templateId: STAGE3_TEMPLATE_ID,
    templateConfigOverride: getTemplateById(STAGE3_TEMPLATE_ID),
    content
  });

  const renderSnapshot = buildTemplateRenderSnapshot({
    templateId: STAGE3_TEMPLATE_ID,
    templateConfigOverride: getTemplateById(STAGE3_TEMPLATE_ID),
    content,
    fitOverride: {
      topFontPx: Math.max(12, baseSnapshot.fit.topFontPx - 2),
      bottomFontPx: Math.max(12, baseSnapshot.fit.bottomFontPx - 1),
      topLineHeight: baseSnapshot.fit.topLineHeight,
      bottomLineHeight: baseSnapshot.fit.bottomLineHeight,
      topLines: baseSnapshot.fit.topLines,
      bottomLines: baseSnapshot.fit.bottomLines,
      topCompacted: baseSnapshot.fit.topCompacted,
      bottomCompacted: baseSnapshot.fit.bottomCompacted
    }
  });

  assert.notEqual(
    baseSnapshot.snapshotHash,
    renderSnapshot.snapshotHash,
    "render-time fit overrides must not be compared to the authoritative preview snapshot hash"
  );

  const fitHash = buildStage3TextFitHash({
    templateId: baseSnapshot.templateId,
    snapshotHash: baseSnapshot.snapshotHash,
    topText: baseSnapshot.content.topText,
    bottomText: baseSnapshot.content.bottomText,
    topFontScale: baseSnapshot.content.topFontScale,
    bottomFontScale: baseSnapshot.content.bottomFontScale
  });

  assert.ok(fitHash, "text-fit validation should stay anchored to the base snapshot hash");
});

test("render drift validation accepts a legacy text-fit snapshot hash for the same template state", () => {
  const content = {
    topText:
      "A small camera caught the exact second the riverbank started moving, and the whole edge folded like wet paper.",
    bottomText:
      "The strange part is how calm it looks right before the ground opens and pulls the trees down with it.",
    channelName: "Science Snack",
    channelHandle: "@Science_Snack_1",
    highlights: { top: [], bottom: [] },
    topFontScale: 1.2,
    bottomFontScale: 1.12,
    previewScale: 1,
    mediaAsset: null,
    backgroundAsset: null,
    avatarAsset: null
  };
  const baseSnapshot = buildTemplateRenderSnapshot({
    templateId: STAGE3_TEMPLATE_ID,
    templateConfigOverride: getTemplateById(STAGE3_TEMPLATE_ID),
    content
  });
  const textFitSnapshot = buildTemplateRenderSnapshot({
    templateId: STAGE3_TEMPLATE_ID,
    templateConfigOverride: getTemplateById(STAGE3_TEMPLATE_ID),
    content,
    fitOverride: {
      topFontPx: Math.max(12, baseSnapshot.fit.topFontPx - 3),
      bottomFontPx: Math.max(12, baseSnapshot.fit.bottomFontPx - 2),
      topLineHeight: baseSnapshot.fit.topLineHeight,
      bottomLineHeight: baseSnapshot.fit.bottomLineHeight,
      topLines: baseSnapshot.fit.topLines,
      bottomLines: baseSnapshot.fit.bottomLines,
      topCompacted: baseSnapshot.fit.topCompacted,
      bottomCompacted: baseSnapshot.fit.bottomCompacted
    }
  });
  const legacyTextFit = createStage3TextFitSnapshot(
    {
      templateId: textFitSnapshot.templateId,
      snapshotHash: textFitSnapshot.snapshotHash,
      topText: textFitSnapshot.content.topText,
      bottomText: textFitSnapshot.content.bottomText,
      topFontScale: textFitSnapshot.content.topFontScale,
      bottomFontScale: textFitSnapshot.content.bottomFontScale
    },
    {
      topFontPx: textFitSnapshot.fit.topFontPx,
      bottomFontPx: textFitSnapshot.fit.bottomFontPx,
      topLineHeight: textFitSnapshot.fit.topLineHeight,
      bottomLineHeight: textFitSnapshot.fit.bottomLineHeight,
      topLines: textFitSnapshot.fit.topLines,
      bottomLines: textFitSnapshot.fit.bottomLines,
      topCompacted: textFitSnapshot.fit.topCompacted,
      bottomCompacted: textFitSnapshot.fit.bottomCompacted
    }
  );

  assertStage3RenderTemplateSnapshotFresh({
    snapshot: {
      templateSnapshot: {
        templateId: textFitSnapshot.templateId,
        specRevision: textFitSnapshot.specRevision,
        snapshotHash: textFitSnapshot.snapshotHash,
        fitRevision: textFitSnapshot.fitRevision
      },
      textFit: legacyTextFit
    },
    baseTemplateSnapshot: baseSnapshot,
    textFitTemplateSnapshot: textFitSnapshot
  });
});

test("render drift validation still rejects unrelated snapshot hashes", () => {
  const baseSnapshot = buildTemplateRenderSnapshot({
    templateId: STAGE3_TEMPLATE_ID,
    templateConfigOverride: getTemplateById(STAGE3_TEMPLATE_ID),
    content: {
      topText: "Top",
      bottomText: "Bottom",
      channelName: "Science Snack",
      channelHandle: "@Science_Snack_1",
      highlights: { top: [], bottom: [] },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  assert.throws(
    () =>
      assertStage3RenderTemplateSnapshotFresh({
        snapshot: {
          templateSnapshot: {
            templateId: baseSnapshot.templateId,
            specRevision: baseSnapshot.specRevision,
            snapshotHash: "unrelated-snapshot-hash",
            fitRevision: baseSnapshot.fitRevision
          }
        },
        baseTemplateSnapshot: baseSnapshot
      }),
    /Template snapshot drift detected/
  );
});
