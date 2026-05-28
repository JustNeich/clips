import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  GHOSTFACE_COUNTRY,
  GHOSTFACE_COUNTRY_TEMPLATE_ID
} from "../lib/stage3-template";
import { resolveStage3BackgroundMode } from "../lib/stage3-background-mode";
import { getTemplateFigmaSpec } from "../lib/stage3-template-spec";
import { resolveTemplateBackdropNode } from "../lib/stage3-template-runtime";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import {
  GHOSTFACE_COUNTRY_BOTTOM_TEXT,
  GHOSTFACE_COUNTRY_TOP_HIGHLIGHT,
  GHOSTFACE_COUNTRY_TOP_TEXT,
  createGhostfaceCountryManagedTemplateSnapshot
} from "../lib/ghostface-country-channel-preset";
import { getTemplateVariant } from "../lib/stage3-template-registry";

test("Ghostface Country template geometry matches the screenshot-derived layout", () => {
  const snapshot = buildTemplateRenderSnapshot({
    templateId: GHOSTFACE_COUNTRY_TEMPLATE_ID,
    templateConfigOverride: GHOSTFACE_COUNTRY,
    content: {
      topText: GHOSTFACE_COUNTRY_TOP_TEXT,
      bottomText: GHOSTFACE_COUNTRY_BOTTOM_TEXT,
      channelName: "GHOSTFACE COUNTRY",
      channelHandle: "@ghostfacecountry",
      highlights: {
        top: [
          {
            start: 0,
            end: GHOSTFACE_COUNTRY_TOP_HIGHLIGHT.length,
            slotId: "slot1"
          }
        ],
        bottom: []
      },
      topHighlightPhrases: [GHOSTFACE_COUNTRY_TOP_HIGHLIGHT],
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  assert.deepEqual(snapshot.layout.card, {
    x: 84,
    y: 0,
    width: 912,
    height: 1920,
    radius: 0,
    borderWidth: 0,
    borderColor: "#000000",
    fill: "#000000",
    shadow: "none"
  });
  assert.deepEqual(snapshot.layout.media, {
    x: 84,
    y: 601,
    width: 912,
    height: 758
  });
  assert.deepEqual(snapshot.layout.author, {
    x: 84,
    y: 1359,
    width: 912,
    height: 150
  });
  assert.deepEqual(snapshot.layout.avatar, {
    x: 84,
    y: 1385,
    width: 98,
    height: 98
  });
  assert.deepEqual(snapshot.layout.bottomText, {
    x: 84,
    y: 1509,
    width: 912,
    height: 411
  });
  assert.equal(snapshot.fit.topLines, 6);
  assert.ok(snapshot.fit.topFontPx >= 52);
  assert.ok(snapshot.fit.topFontPx <= 62);
  assert.ok(snapshot.fit.bottomLines <= 3);
});

test("Ghostface Country managed snapshot keeps the yellow top phrase highlight", () => {
  const snapshot = createGhostfaceCountryManagedTemplateSnapshot();

  assert.equal(snapshot.baseTemplateId, GHOSTFACE_COUNTRY_TEMPLATE_ID);
  assert.equal(snapshot.layoutFamily, GHOSTFACE_COUNTRY_TEMPLATE_ID);
  assert.equal(snapshot.templateConfig.palette.accentColor, "#ffd433");
  assert.deepEqual(snapshot.content.highlights.top, [
    {
      start: 0,
      end: GHOSTFACE_COUNTRY_TOP_HIGHLIGHT.length,
      slotId: "slot1"
    }
  ]);
  assert.equal(getTemplateVariant(GHOSTFACE_COUNTRY_TEMPLATE_ID).label, "Ghostface Country");
});

test("Ghostface Country backdrop is solid black instead of the default gradient", () => {
  const markup = renderToStaticMarkup(resolveTemplateBackdropNode(GHOSTFACE_COUNTRY_TEMPLATE_ID));

  assert.match(markup, /background:#000000/);
  assert.doesNotMatch(markup, /radial-gradient/);
});

test("Ghostface Country shell and runtime background stay full-frame black", () => {
  const spec = getTemplateFigmaSpec(GHOSTFACE_COUNTRY_TEMPLATE_ID);

  assert.deepEqual(spec.shell, {
    x: 0,
    y: 0,
    width: 1080,
    height: 1920,
    radius: 0,
    background: "#000000",
    border: "none"
  });
  assert.equal(
    resolveStage3BackgroundMode(GHOSTFACE_COUNTRY_TEMPLATE_ID, {
      hasCustomBackground: false,
      hasSourceVideo: true
    }),
    "built-in"
  );
});

test("Ghostface Country auto-highlights the opening top phrase when generated text has no spans", () => {
  const topText =
    "You think that black pile is just dirty grease. It is actually a country workshop trick.";
  const snapshot = buildTemplateRenderSnapshot({
    templateId: GHOSTFACE_COUNTRY_TEMPLATE_ID,
    templateConfigOverride: GHOSTFACE_COUNTRY,
    content: {
      topText,
      bottomText: GHOSTFACE_COUNTRY_BOTTOM_TEXT,
      channelName: "GHOSTFACE COUNTRY",
      channelHandle: "@ghostfacecountry",
      highlights: {
        top: [],
        bottom: []
      },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  assert.deepEqual(snapshot.content.highlights.top, [
    {
      start: 0,
      end: "You think that black pile is just dirty grease.".length,
      slotId: "slot1"
    }
  ]);
});
