import test from "node:test";
import assert from "node:assert/strict";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import { STAGE3_TEMPLATE_ID, getTemplateById } from "../lib/stage3-template";
import { buildStage3TextFitHash } from "../lib/stage3-text-fit";

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
