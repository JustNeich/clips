import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  GHOSTFACE_WORKSHOP,
  GHOSTFACE_WORKSHOP_TEMPLATE_ID,
  getTemplateById
} from "../lib/stage3-template";
import { resolveStage3BackgroundMode } from "../lib/stage3-background-mode";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import { resolveTemplateBackdropNode } from "../lib/stage3-template-runtime";
import { getTemplateVariant } from "../lib/stage3-template-registry";

test("Ghostface Workshop template is registered as its own classic card", () => {
  const template = getTemplateById(GHOSTFACE_WORKSHOP_TEMPLATE_ID);

  assert.equal(template.author.name, "GHOSTFACE WORKSHOP");
  assert.equal(template.author.handle, "@ghostfaceworkshop");
  assert.equal(template.author.checkAssetPath, "/stage3-template-badges/twitter-verified-badge.png");
  assert.equal(getTemplateVariant(GHOSTFACE_WORKSHOP_TEMPLATE_ID).label, "Ghostface Workshop");
});

test("Ghostface Workshop keeps top-bottom layout with built-in backdrop", () => {
  const snapshot = buildTemplateRenderSnapshot({
    templateId: GHOSTFACE_WORKSHOP_TEMPLATE_ID,
    templateConfigOverride: GHOSTFACE_WORKSHOP,
    content: {
      topText: "THE CLAMP HAD ONE JOB",
      bottomText: "And took it personally.",
      channelName: "GHOSTFACE WORKSHOP",
      channelHandle: "@ghostfaceworkshop",
      highlights: { top: [], bottom: [] },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  assert.equal(snapshot.layout.card.radius, 8);
  assert.equal(snapshot.fit.topLines <= 5, true);
  assert.equal(snapshot.fit.bottomLines <= 3, true);
  assert.equal(
    resolveStage3BackgroundMode(GHOSTFACE_WORKSHOP_TEMPLATE_ID, {
      hasCustomBackground: false,
      hasSourceVideo: true
    }),
    "built-in"
  );
});

test("Ghostface Workshop backdrop uses the dark smoky channel background", () => {
  const markup = renderToStaticMarkup(resolveTemplateBackdropNode(GHOSTFACE_WORKSHOP_TEMPLATE_ID));

  assert.match(markup, /#182f3a/);
  assert.match(markup, /radial-gradient/);
  assert.doesNotMatch(markup, /rgba\(160, 199, 252/);
});
