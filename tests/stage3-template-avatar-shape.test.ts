import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SCIENCE_CARD_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  getTemplateById,
  resolveStage3TemplateAvatarBorderRadius
} from "../lib/stage3-template";
import { Stage3TemplateRenderer } from "../lib/stage3-template-renderer";

const content = {
  topText: "Top",
  bottomText: "Bottom",
  channelName: "Barracks Chronicles",
  channelHandle: "@barracks",
  highlights: { top: [], bottom: [] },
  topFontScale: 1,
  bottomFontScale: 1,
  previewScale: 1,
  mediaAsset: null,
  backgroundAsset: null,
  avatarAsset: null
};

test("stage 3 avatar defaults to the existing circular shape", () => {
  const templateConfig = getTemplateById(SCIENCE_CARD_TEMPLATE_ID);

  assert.equal(
    resolveStage3TemplateAvatarBorderRadius({
      avatarShape: templateConfig.author.avatarShape,
      avatarSize: templateConfig.author.avatarSize
    }),
    999
  );
});

test("stage 3 avatar rounded-square shape reaches the template renderer", () => {
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(SCIENCE_CARD_TEMPLATE_ID));
  templateConfig.author.avatarShape = "rounded-square";
  templateConfig.author.avatarSize = 100;

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: SCIENCE_CARD_TEMPLATE_ID,
      templateConfigOverride: templateConfig,
      content
    })
  );

  assert.equal(
    resolveStage3TemplateAvatarBorderRadius({
      avatarShape: templateConfig.author.avatarShape,
      avatarSize: templateConfig.author.avatarSize
    }),
    14
  );
  assert.match(markup, /border-radius:14px/);
});
