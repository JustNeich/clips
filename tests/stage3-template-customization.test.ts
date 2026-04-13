import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { Stage3TemplateRenderer } from "../lib/stage3-template-renderer";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import { SCIENCE_CARD, cloneStage3TemplateConfig } from "../lib/stage3-template";

function buildDemoContent() {
  return {
    topText: "Scientists found a way to splice two living plant stems into one system.",
    bottomText: "The joined tissue starts rerouting fluids almost immediately after the cut heals.",
    channelName: "Science Snack",
    channelHandle: "@Science_Snack_1",
    highlights: { top: [], bottom: [] },
    topFontScale: 1,
    bottomFontScale: 1,
    previewScale: 1,
    mediaAsset: null,
    backgroundAsset: null,
    avatarAsset: null
  };
}

test("template snapshot layout respects managed card geometry overrides", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  templateConfig.card.x = 110;
  templateConfig.card.y = 240;
  templateConfig.card.width = 703;
  templateConfig.card.height = 1388;

  const snapshot = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: buildDemoContent(),
    templateConfigOverride: templateConfig
  });

  assert.equal(snapshot.layout.card.x, 110);
  assert.equal(snapshot.layout.card.y, 240);
  assert.equal(snapshot.layout.card.width, 703);
  assert.equal(snapshot.layout.card.height, 1388);
  assert.equal(snapshot.layout.top.width, 703);
  assert.equal(snapshot.layout.media.width, 703);
  assert.equal(snapshot.layout.bottom.width, 703);
  assert.equal(
    snapshot.layout.media.height,
    templateConfig.card.height - snapshot.computed.topBlockHeight - snapshot.computed.bottomBlockHeight
  );
});

test("template scene markup uses managed card geometry instead of locked spec geometry", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  templateConfig.card.x = 110;
  templateConfig.card.y = 240;
  templateConfig.card.width = 703;
  templateConfig.card.height = 1388;

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: "science-card-v1",
      content: buildDemoContent(),
      templateConfigOverride: templateConfig
    })
  );

  assert.match(markup, /left:105px;top:235px;width:713px;height:1398px/);
  assert.match(markup, /width:703px;height:1388px/);
  assert.doesNotMatch(markup, /width:907px;height:1461px/);
});

test("color badge mode renders a twitter-style vector instead of a round text fallback", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  templateConfig.author.checkAssetPath = "";
  templateConfig.palette.checkBadgeColor = "#11aa77";

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: "science-card-v1",
      content: buildDemoContent(),
      templateConfigOverride: templateConfig
    })
  );

  assert.match(markup, /data-template-badge-kind="twitter-color"/);
  assert.doesNotMatch(markup, />✓</);
});
