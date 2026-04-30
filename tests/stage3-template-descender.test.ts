import assert from "node:assert/strict";
import test from "node:test";

import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import {
  CHANNEL_STORY,
  CHANNEL_STORY_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  resolveTemplateDescenderSafetyPx
} from "../lib/stage3-template";

test("resolveTemplateDescenderSafetyPx grows for tighter line heights and stays bounded", () => {
  const compact = resolveTemplateDescenderSafetyPx(56, 0.938);
  const relaxed = resolveTemplateDescenderSafetyPx(34, 1.08);

  assert.ok(compact >= relaxed);
  assert.ok(compact >= 3);
  assert.ok(compact <= 8);
  assert.ok(relaxed >= 3);
  assert.ok(relaxed <= 8);
});

test("channel story body sizing reserves descender safety inside the body slot", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.typography.bottom.lineHeight = 0.88;
  const snapshot = buildTemplateRenderSnapshot({
    templateId: CHANNEL_STORY_TEMPLATE_ID,
    content: {
      topText: "Did you know?",
      bottomText:
        "Gary kept dragging the heavy rig through foggy ground, then the lower edge of every y, g, p, and q still has to survive the tight body box.",
      channelName: "History Explained",
      channelHandle: "@HistoryExplained13",
      highlights: { top: [], bottom: [] },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    },
    templateConfigOverride: templateConfig
  });
  const descenderSafety = resolveTemplateDescenderSafetyPx(
    snapshot.computed.bottomFont,
    snapshot.computed.bottomLineHeight
  );
  const reservedContentHeight =
    snapshot.computed.bottomFont * snapshot.computed.bottomLineHeight * snapshot.computed.bottomLines +
    descenderSafety;

  assert.ok(
    reservedContentHeight <= snapshot.layout.bottomText.height,
    `expected body text plus descender safety to fit ${snapshot.layout.bottomText.height}px, got ${reservedContentHeight.toFixed(
      2
    )}px`
  );
});

test("channel story body scale does not rewrap abruptly between 99 and 100 percent", () => {
  const bodyText =
    "In 2019 Tom Holland wears his Spider Man suit while Samuel Jackson speaks off camera abandons the script to tell him pick up food before returning set stares ahead losing composure laughing real hunger took over Far From Home production.";
  const makeSnapshot = (bottomFontScale: number) =>
    buildTemplateRenderSnapshot({
      templateId: CHANNEL_STORY_TEMPLATE_ID,
      templateConfigOverride: CHANNEL_STORY,
      content: {
        topText: "",
        bottomText: bodyText,
        channelName: "Channel",
        channelHandle: "+ Story",
        highlights: { top: [], bottom: [] },
        topFontScale: 1,
        bottomFontScale,
        previewScale: 1,
        mediaAsset: null,
        backgroundAsset: null,
        avatarAsset: null
      }
    });

  const at99 = makeSnapshot(0.99);
  const at100 = makeSnapshot(1);

  assert.equal(at100.fit.bottomLines, at99.fit.bottomLines);
  assert.ok(
    at100.fit.bottomFontPx >= at99.fit.bottomFontPx,
    `expected 100% font to stay at or above 99%, got ${at99.fit.bottomFontPx}px -> ${at100.fit.bottomFontPx}px`
  );
  assert.ok(
    at100.fit.bottomFontPx - at99.fit.bottomFontPx <= 0.5,
    `expected a small 99% -> 100% font delta, got ${at99.fit.bottomFontPx}px -> ${at100.fit.bottomFontPx}px`
  );
  assert.ok(
    Math.abs(at100.fit.bottomLineHeight - at99.fit.bottomLineHeight) <= 0.01,
    `expected line-height to stay visually stable, got ${at99.fit.bottomLineHeight} -> ${at100.fit.bottomLineHeight}`
  );
});
