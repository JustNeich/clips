import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { Stage3TemplateRenderer } from "../lib/stage3-template-renderer";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import {
  CHANNEL_STORY,
  CHANNEL_STORY_TEMPLATE_ID,
  SCIENCE_CARD,
  cloneStage3TemplateConfig
} from "../lib/stage3-template";
import { buildScienceCardRenderSnapshot } from "../remotion/science-card-v1";
import type { TemplateContentFixture } from "../lib/template-calibration-types";

function buildDemoContent(): TemplateContentFixture {
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

test("classic science-card markup renders highlight spans for live preview text", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  const content = buildDemoContent();
  content.topText = "Marine officers rush in while Ace shields Luffy.";
  content.bottomText = "Fans still call Ace and Luffy completely unfair.";
  content.highlights = {
    top: [
      { start: 0, end: 15, slotId: "slot1" as const },
      { start: 30, end: 33, slotId: "slot1" as const },
      { start: 42, end: 47, slotId: "slot1" as const }
    ],
    bottom: [
      { start: 17, end: 20, slotId: "slot1" as const },
      { start: 25, end: 30, slotId: "slot1" as const }
    ]
  };

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: "science-card-v1",
      content,
      templateConfigOverride: templateConfig
    })
  );

  assert.match(markup, /<span[^>]*>Marine officers<\/span>/);
  assert.match(markup, /<span[^>]*>Ace<\/span>/);
  assert.match(markup, /<span[^>]*>Luffy<\/span>/);
});

test("remotion science-card render snapshot preserves caption highlight spans", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  const snapshot = buildScienceCardRenderSnapshot({
    templateId: "science-card-v1",
    templateConfigOverride: templateConfig,
    topText: "Marine officers rush in while Ace shields Luffy.",
    bottomText: "Fans still call Ace and Luffy completely unfair.",
    captionHighlights: {
      top: [
        { start: 0, end: 15, slotId: "slot1" as const },
        { start: 30, end: 33, slotId: "slot1" as const },
        { start: 42, end: 47, slotId: "slot1" as const }
      ],
      bottom: [
        { start: 17, end: 20, slotId: "slot1" as const },
        { start: 25, end: 30, slotId: "slot1" as const }
      ]
    },
    topFontScale: 1,
    bottomFontScale: 1,
    authorName: "Science Snack",
    authorHandle: "@Science_Snack_1"
  });

  assert.deepEqual(snapshot.content.highlights.top, [
    { start: 0, end: 15, slotId: "slot1" },
    { start: 30, end: 33, slotId: "slot1" },
    { start: 42, end: 47, slotId: "slot1" }
  ]);
  assert.deepEqual(snapshot.content.highlights.bottom, [
    { start: 17, end: 20, slotId: "slot1" },
    { start: 25, end: 30, slotId: "slot1" }
  ]);
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

test("channel story snapshot injects template default lead text when lead mode is template_default", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.channelStory!.leadMode = "template_default";
  templateConfig.channelStory!.defaultLeadText = "Did you know?";

  const snapshot = buildTemplateRenderSnapshot({
    templateId: CHANNEL_STORY_TEMPLATE_ID,
    content: {
      topText: "",
      bottomText: "The search is still active and the sealed chambers changed the story.",
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

  assert.equal(snapshot.content.topText, "Did you know?");
  assert.equal(snapshot.computed.leadVisible, true);
  assert.ok(snapshot.layout.top.height > 1);
  assert.ok(snapshot.layout.bottomText.y > snapshot.layout.author.y);
});

test("channel story snapshot drops lead layout when lead mode is off", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.channelStory!.leadMode = "off";

  const snapshot = buildTemplateRenderSnapshot({
    templateId: CHANNEL_STORY_TEMPLATE_ID,
    content: {
      topText: "This lead should be ignored.",
      bottomText: "Only the body should remain visible above the source video.",
      channelName: "History Explained",
      channelHandle: "@HistoryExplained13",
      highlights: {
        top: [{ start: 0, end: 4, slotId: "slot1" }],
        bottom: []
      },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    },
    templateConfigOverride: templateConfig
  });

  assert.equal(snapshot.content.topText, "");
  assert.equal(snapshot.computed.leadVisible, false);
  assert.ok(snapshot.layout.top.height <= 1);
  assert.deepEqual(snapshot.content.highlights.top, []);
});

test("channel story markup renders highlight spans and media chrome", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.channelStory!.leadMode = "clip_custom";
  templateConfig.channelStory!.mediaRadius = 28;
  templateConfig.channelStory!.mediaBorderWidth = 3;
  templateConfig.channelStory!.mediaBorderColor = "#ff0033";
  templateConfig.channelStory!.accentTopLineWidth = 5;
  templateConfig.channelStory!.accentTopLineColor = "#20df49";

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: CHANNEL_STORY_TEMPLATE_ID,
      content: {
        topText: "Did you know this?",
        bottomText: "Erica Marshall and the chamber accident still define this case.",
        channelName: "Human History",
        channelHandle: "@HISTORY.",
        highlights: {
          top: [{ start: 0, end: 12, slotId: "slot1" }],
          bottom: [{ start: 0, end: 14, slotId: "slot1" }]
        },
        topFontScale: 1,
        bottomFontScale: 1,
        previewScale: 1,
        mediaAsset: null,
        backgroundAsset: null,
        avatarAsset: null
      },
      templateConfigOverride: templateConfig
    })
  );

  assert.match(markup, /data-template-slot="top-text"/);
  assert.match(markup, /data-template-slot="bottom-text"/);
  assert.match(markup, /<span[^>]*>Did you know<\/span>/);
  assert.match(markup, /<span[^>]*>Erica Marshall<\/span>/);
  assert.match(markup, /border-radius:28px/);
  assert.match(markup, /border:3px solid #ff0033/);
  assert.match(markup, /height:5px;background:#20df49/);
});

test("channel story snapshot measures inner content from the bordered card safe area", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.card.x = 110;
  templateConfig.card.width = 860;
  templateConfig.card.borderWidth = 14;
  templateConfig.channelStory!.contentPaddingX = 60;
  templateConfig.channelStory!.mediaInsetX = 22;

  const snapshot = buildTemplateRenderSnapshot({
    templateId: CHANNEL_STORY_TEMPLATE_ID,
    content: {
      topText: "Did you know?",
      bottomText: "This body block should stay optically centered inside the bordered shell.",
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

  assert.equal(snapshot.layout.author.x, 184);
  assert.equal(snapshot.layout.author.width, 712);
  assert.equal(snapshot.layout.media.x, 146);
  assert.equal(snapshot.layout.media.width, 788);
});

test("channel story body-to-video gap reaches zero without changing separate media frame controls", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.channelStory!.bodyToMediaGap = 0;
  templateConfig.channelStory!.mediaInsetX = 10;
  templateConfig.channelStory!.footerHeight = 86;

  const snapshot = buildTemplateRenderSnapshot({
    templateId: CHANNEL_STORY_TEMPLATE_ID,
    content: {
      topText: "Did you know?",
      bottomText: "This body block should touch the source video when the vertical gap is zero.",
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

  assert.equal(snapshot.layout.media.y, snapshot.layout.bottomText.y + snapshot.layout.bottomText.height);
  assert.equal(snapshot.layout.media.x, snapshot.layout.card.x + templateConfig.card.borderWidth + 10);
  assert.equal(snapshot.computed.bottomBlockHeight, templateConfig.card.borderWidth + 86 + 40);
});

test("channel story scene markup keeps localized content inside the centered card shell", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.card.x = 110;
  templateConfig.card.width = 860;
  templateConfig.card.borderWidth = 14;
  templateConfig.channelStory!.contentPaddingX = 60;
  templateConfig.channelStory!.mediaInsetX = 22;

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: CHANNEL_STORY_TEMPLATE_ID,
      content: {
        topText: "Did you know?",
        bottomText: "This body block should stay optically centered inside the bordered shell.",
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
    })
  );

  assert.match(markup, /left:110px;top:24px;width:860px;height:1848px/);
  assert.match(markup, /data-template-slot="top-text"/);
  assert.match(markup, /left:60px;top:34px;width:712px;height:118px/);
  assert.match(markup, /left:22px;top:[0-9.]+px;width:788px;height:[0-9.]+px/);
});
