import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CHANNEL_STORY_TEMPLATE_ID,
  SCIENCE_CARD_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  getTemplateById,
  resolveStage3TemplateAvatarBorderRadius
} from "../lib/stage3-template";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
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

test("channel-story header keeps a 102px square avatar fully inside the Unit 01 frame geometry", () => {
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(CHANNEL_STORY_TEMPLATE_ID));
  templateConfig.card = {
    ...templateConfig.card,
    x: 0,
    y: 0,
    width: 1080,
    height: 1920,
    borderWidth: 0
  };
  templateConfig.author.avatarSize = 102;
  templateConfig.author.avatarShape = "rounded-square";
  templateConfig.channelStory = {
    ...templateConfig.channelStory!,
    contentPaddingX: 64,
    contentPaddingTop: 220,
    headerHeight: 136,
    leadMode: "off",
    leadHeight: 0,
    bodyHeight: 220,
    headerToLeadGap: 27,
    leadToBodyGap: 0,
    bodyToMediaGap: 12,
    contentPaddingBottom: 0,
    footerHeight: 0
  };

  const snapshot = buildTemplateRenderSnapshot({
    templateId: CHANNEL_STORY_TEMPLATE_ID,
    templateConfigOverride: templateConfig,
    content: {
      ...content,
      topText: "",
      bottomText:
        "AI FOOTBALL WHAT-IF: HARRY KANE STEPS INTO GOAL, AND THE 5-0 SCORELINE MAKES A CONCESSION FEEL LIKE A SMALL PRICE FOR THE EXPERIMENT."
    }
  });

  assert.deepEqual(snapshot.layout.avatar, {
    x: 64,
    y: 237,
    width: 102,
    height: 102
  });
  assert.equal(snapshot.layout.author.y, 220);
  assert.equal(snapshot.layout.author.height, 136);
  assert.ok(snapshot.layout.avatar.y >= snapshot.layout.author.y);
  assert.ok(
    snapshot.layout.avatar.y + snapshot.layout.avatar.height <=
      snapshot.layout.author.y + snapshot.layout.author.height
  );
  assert.ok(snapshot.layout.avatar.x >= 0);
  assert.ok(snapshot.layout.avatar.x + snapshot.layout.avatar.width <= snapshot.layout.frame.width);
  assert.ok(snapshot.layout.avatar.y + snapshot.layout.avatar.height <= snapshot.layout.frame.height);
});

test("stage 3 template can hide the author handle without leaving rendered username text", () => {
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(SCIENCE_CARD_TEMPLATE_ID));
  templateConfig.author.showHandle = false;

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: SCIENCE_CARD_TEMPLATE_ID,
      templateConfigOverride: templateConfig,
      content
    })
  );

  assert.doesNotMatch(markup, /@barracks/);
});

test("stage 3 template renders highlight font weight from slot config", () => {
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(SCIENCE_CARD_TEMPLATE_ID));
  templateConfig.highlights.slots[0].color = "#ffffff";
  templateConfig.highlights.slots[0].fontWeight = 800;

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: SCIENCE_CARD_TEMPLATE_ID,
      templateConfigOverride: templateConfig,
      content: {
        ...content,
        highlights: {
          top: [{ start: 0, end: 3, slotId: "slot1" }],
          bottom: []
        }
      }
    })
  );

  assert.match(markup, /font-weight:800/);
});
