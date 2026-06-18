import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { Stage3TemplateRenderer } from "../lib/stage3-template-renderer";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import {
  CHANNEL_STORY,
  CHANNEL_STORY_TEMPLATE_ID,
  SCIENCE_CARD,
  cloneStage3TemplateConfig,
  resolveChannelStoryBodyContentHeight
} from "../lib/stage3-template";
import {
  buildStage3TemplateFontFaceCss,
  buildStage3TemplateFontLoadDescriptors,
  resolveStage3TemplateDefaultTextScales,
  waitForStage3TemplateFonts
} from "../lib/stage3-template-fonts";
import { buildScienceCardRenderSnapshot } from "../remotion/science-card-v1";
import type { TemplateContentFixture } from "../lib/template-calibration-types";

function buildDemoContent(): TemplateContentFixture {
  return {
    topText: "Scientists found a way to splice two living plant stems into one system.",
    bottomText: "The joined tissue starts rerouting fluids almost immediately after the cut heals.",
    sourceOverlayText: "Let people love out loud.",
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

test("template scene renders source-video overlay text and template watermark inside media", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  templateConfig.sourceOverlay.enabled = true;
  templateConfig.sourceOverlay.xPct = 6;
  templateConfig.sourceOverlay.yPct = 7;
  templateConfig.sourceOverlay.fontFamily =
    '"Arial Rounded MT Bold","Arial",sans-serif';
  templateConfig.sourceWatermark.enabled = true;
  templateConfig.sourceWatermark.textMode = "custom";
  templateConfig.sourceWatermark.customText = "@clipsmind";
  templateConfig.sourceWatermark.opacity = 0.35;
  templateConfig.sourceWatermark.fontFamily =
    '"SFMono-Regular","Courier New",monospace';

  const content = buildDemoContent();
  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: "science-card-v1",
      content,
      templateConfigOverride: templateConfig
    })
  );

  assert.match(markup, /Let people love out loud\./);
  assert.match(markup, /@clipsmind/);
  assert.match(markup, /left:6%;top:7%;/);
  assert.match(markup, /opacity:0\.35/);
  assert.match(markup, /data-source-video-text-layer="generated-source-overlay-stroke"/);
  assert.match(markup, /data-source-video-text-layer="generated-source-overlay-fill"/);
  assert.match(markup, /-webkit-text-fill-color:transparent/);
  assert.match(markup, /-webkit-text-stroke:2px #000000/);
  assert.match(markup, /font-family:&quot;Arial Rounded MT Bold&quot;,&quot;Arial&quot;,sans-serif/);
  assert.match(markup, /font-family:&quot;SFMono-Regular&quot;,&quot;Courier New&quot;,monospace/);
});

test("template snapshot hash includes source overlay text and watermark config", () => {
  const content = buildDemoContent();
  const baseConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  const baseSnapshot = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content,
    templateConfigOverride: baseConfig
  });

  const changedTextSnapshot = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      ...content,
      sourceOverlayText: "No shame in caring this hard."
    },
    templateConfigOverride: baseConfig
  });
  const watermarkConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  watermarkConfig.sourceWatermark.enabled = true;
  watermarkConfig.sourceWatermark.textMode = "custom";
  watermarkConfig.sourceWatermark.customText = "@clipsmind";
  const watermarkSnapshot = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content,
    templateConfigOverride: watermarkConfig
  });

  assert.notEqual(baseSnapshot.snapshotHash, changedTextSnapshot.snapshotHash);
  assert.notEqual(baseSnapshot.snapshotHash, watermarkSnapshot.snapshotHash);
});

test("template scene markup wires uploaded top and bottom fonts into the rendered text", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  templateConfig.typography.top.fontAsset = {
    id: "fonttop123456",
    family: "Stage3TemplateFont_fonttop123456",
    url: "/api/design/template-assets/fonttop123456",
    originalName: "LeadDisplay-BlackItalic.woff2",
    mimeType: "font/woff2",
    sizeBytes: 32100
  };
  templateConfig.typography.top.fontFamily = '"Stage3TemplateFont_fonttop123456",sans-serif';
  templateConfig.typography.bottom.fontAsset = {
    id: "fontbody123456",
    family: "Stage3TemplateFont_fontbody123456",
    url: "/api/design/template-assets/fontbody123456",
    originalName: "MainText.otf",
    mimeType: "font/otf",
    sizeBytes: 45600
  };
  templateConfig.typography.bottom.fontFamily = '"Stage3TemplateFont_fontbody123456",sans-serif';

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: "science-card-v1",
      content: buildDemoContent(),
      templateConfigOverride: templateConfig
    })
  );

  assert.match(markup, /data-stage3-template-fonts/);
  assert.match(markup, /@font-face\{font-family:"Stage3TemplateFont_fonttop123456"/);
  assert.match(markup, /font-weight:900;font-style:italic;font-display:swap/);
  assert.match(markup, /\/api\/design\/template-assets\/fonttop123456/);
  assert.match(markup, /@font-face\{font-family:"Stage3TemplateFont_fontbody123456"/);
  assert.match(markup, /font-weight:400;font-style:normal;font-display:swap/);
  assert.doesNotMatch(markup, /font-weight:100 900/);
  assert.match(markup, /font-family:&quot;Stage3TemplateFont_fonttop123456&quot;,sans-serif/);
  assert.match(markup, /font-family:&quot;Stage3TemplateFont_fontbody123456&quot;,sans-serif/);
});

test("template scene markup applies configured text glow to lead and body slots", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.typography.top.textShadow =
    "0 0 6px rgba(255,255,255,0.94), 0 0 18px rgba(58,149,255,0.96)";
  templateConfig.typography.bottom.textShadow = "0 0 10px rgba(255,255,255,0.44)";

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: CHANNEL_STORY_TEMPLATE_ID,
      content: {
        topText: "Did they tell you...",
        bottomText: "The mother watched it happen from the couch.",
        channelName: "COP SCOPES",
        channelHandle: "@copscopes-x2e",
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

  assert.match(markup, /data-template-slot="top-text"/);
  assert.match(markup, /text-shadow:0 0 6px rgba\(255,255,255,0\.94\),\s*0 0 18px rgba\(58,149,255,0\.96\)/);
  assert.match(markup, /text-shadow:0 0 10px rgba\(255,255,255,0\.44\)/);
});

test("uploaded font slots use neutral default text scale and expose browser load descriptors", async () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  templateConfig.typography.top.fontAsset = {
    id: "fonttop123456",
    family: "Stage3TemplateFont_fonttop123456",
    url: "/api/design/template-assets/fonttop123456",
    originalName: "LeadDisplay.woff2",
    mimeType: "font/woff2",
    sizeBytes: 32100
  };
  templateConfig.typography.top.fontFamily = '"Stage3TemplateFont_fonttop123456",sans-serif';

  assert.deepEqual(resolveStage3TemplateDefaultTextScales(templateConfig, 1.25), {
    topFontScale: 1,
    bottomFontScale: 1.25
  });
  assert.deepEqual(buildStage3TemplateFontLoadDescriptors(templateConfig), [
    'normal 400 16px "Stage3TemplateFont_fonttop123456"'
  ]);

  templateConfig.typography.top.fontAsset.url = "/stage3-assets/render-check/font.ttf";
  const windowHolder = globalThis as unknown as { window?: unknown };
  const previousWindow = windowHolder.window;
  windowHolder.window = { remotion_staticBase: "/public" };
  try {
    assert.match(
      buildStage3TemplateFontFaceCss(templateConfig),
      /url\("\/public\/stage3-assets\/render-check\/font\.ttf"\)/
    );
  } finally {
    windowHolder.window = previousWindow;
  }

  const documentHolder = globalThis as unknown as { document?: unknown };
  const previousDocument = documentHolder.document;
  const loadedDescriptors: string[] = [];
  documentHolder.document = {
    fonts: {
      load: async (descriptor: string) => {
        loadedDescriptors.push(descriptor);
        return [];
      },
      ready: Promise.resolve({} as FontFaceSet)
    }
  };
  try {
    await waitForStage3TemplateFonts(templateConfig, { timeoutMs: 1000 });
  } finally {
    documentHolder.document = previousDocument;
  }

  assert.deepEqual(loadedDescriptors, ['normal 400 16px "Stage3TemplateFont_fonttop123456"']);
});

test("uploaded font face metadata is inferred from static font file names without declaring a full weight range", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);
  templateConfig.typography.top.fontAsset = {
    id: "fonttop123456",
    family: "Stage3TemplateFont_fonttop123456",
    url: "/api/design/template-assets/fonttop123456",
    originalName: "LeadDisplay-ExtraBoldItalic.woff2",
    mimeType: "font/woff2",
    sizeBytes: 32100
  };
  templateConfig.typography.bottom.fontAsset = {
    id: "fontbody123456",
    family: "Stage3TemplateFont_fontbody123456",
    url: "/api/design/template-assets/fontbody123456",
    originalName: "MainText-Light.otf",
    mimeType: "font/otf",
    sizeBytes: 45600
  };

  const css = buildStage3TemplateFontFaceCss(templateConfig);

  assert.match(css, /font-family:"Stage3TemplateFont_fonttop123456"/);
  assert.match(css, /font-weight:800;font-style:italic;font-display:swap/);
  assert.match(css, /font-family:"Stage3TemplateFont_fontbody123456"/);
  assert.match(css, /font-weight:300;font-style:normal;font-display:swap/);
  assert.doesNotMatch(css, /font-weight:100 900/);
  assert.deepEqual(buildStage3TemplateFontLoadDescriptors(templateConfig), [
    'italic 800 16px "Stage3TemplateFont_fonttop123456"',
    'normal 300 16px "Stage3TemplateFont_fontbody123456"'
  ]);
});

test("channel story author row does not inherit uploaded body font assets", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.typography.bottom.fontAsset = {
    id: "fontbody123456",
    family: "Stage3TemplateFont_fontbody123456",
    url: "/api/design/template-assets/fontbody123456",
    originalName: "MainText.woff2",
    mimeType: "font/woff2",
    sizeBytes: 45600
  };
  templateConfig.typography.bottom.fontFamily = '"Stage3TemplateFont_fontbody123456",sans-serif';

  const markup = renderToStaticMarkup(
    Stage3TemplateRenderer({
      templateId: CHANNEL_STORY_TEMPLATE_ID,
      content: {
        topText: "Did you know this?",
        bottomText: "Erica Marshall and the chamber accident still define this case.",
        channelName: "Human History",
        channelHandle: "@HISTORY.",
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

  const authorIndex = markup.indexOf("Human History");
  const authorSnippet = markup.slice(Math.max(0, authorIndex - 260), authorIndex + 80);
  const bottomIndex = markup.indexOf('data-template-slot="bottom-text"');
  const bottomSnippet = markup.slice(bottomIndex, bottomIndex + 360);

  assert.doesNotMatch(authorSnippet, /Stage3TemplateFont_fontbody123456/);
  assert.match(bottomSnippet, /font-family:&quot;Stage3TemplateFont_fontbody123456&quot;,sans-serif/);
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
  templateConfig.channelStory!.leadGlowEnabled = true;
  templateConfig.channelStory!.leadGlowColor = "rgba(42,132,255,0.9)";
  templateConfig.channelStory!.leadGlowHeight = 72;
  templateConfig.channelStory!.leadGlowBlur = 26;
  templateConfig.channelStory!.leadGlowOpacity = 0.82;
  templateConfig.channelStory!.leadGlowSpreadX = 230;

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
  assert.match(markup, /data-template-slot="lead-glow"/);
  assert.match(markup, /data-template-slot="lead-glow-core"/);
  assert.match(markup, /radial-gradient\(ellipse at center,\s*rgba\(255,255,255,0\.54\)\s*0%,\s*rgba\(42,132,255,0\.9\)/);
  assert.match(markup, /linear-gradient\(90deg,\s*rgba\(0,0,0,0\)\s*0%,\s*rgba\(42,132,255,0\.9\)\s*24%/);
  assert.match(markup, /mask-image:radial-gradient\(ellipse at center/);
  assert.match(markup, /filter:blur\(26px\)/);
  assert.match(markup, /left:-230px;right:-230px/);
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

test("channel story media stack follows measured body text after final text fit", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.channelStory!.leadMode = "off";
  templateConfig.channelStory!.bodyHeight = 360;
  templateConfig.channelStory!.bodyToMediaGap = 12;

  const content = {
    topText: "",
    bottomText: "The final caption should push the media only by the text it actually uses.",
    channelName: "Wisdom Stories",
    channelHandle: "@wisdomstories",
    highlights: { top: [], bottom: [] },
    topFontScale: 1,
    bottomFontScale: 1,
    previewScale: 1,
    mediaAsset: null,
    backgroundAsset: null,
    avatarAsset: null
  } satisfies TemplateContentFixture;

  const threeLineSnapshot = buildTemplateRenderSnapshot({
    templateId: CHANNEL_STORY_TEMPLATE_ID,
    content,
    templateConfigOverride: templateConfig,
    fitOverride: {
      bottomFontPx: 50,
      bottomLineHeight: 1,
      bottomLines: 3,
      bottomCompacted: false
    }
  });
  const fourLineSnapshot = buildTemplateRenderSnapshot({
    templateId: CHANNEL_STORY_TEMPLATE_ID,
    content,
    templateConfigOverride: templateConfig,
    fitOverride: {
      bottomFontPx: 50,
      bottomLineHeight: 1,
      bottomLines: 4,
      bottomCompacted: false
    }
  });
  const threeLineBodyHeight = resolveChannelStoryBodyContentHeight({
    lines: 3,
    fontPx: 50,
    lineHeight: 1,
    maxHeight: templateConfig.channelStory!.bodyHeight
  });
  const fourLineBodyHeight = resolveChannelStoryBodyContentHeight({
    lines: 4,
    fontPx: 50,
    lineHeight: 1,
    maxHeight: templateConfig.channelStory!.bodyHeight
  });

  assert.equal(threeLineSnapshot.layout.bottomText.height, threeLineBodyHeight);
  assert.equal(fourLineSnapshot.layout.bottomText.height, fourLineBodyHeight);
  assert.equal(
    threeLineSnapshot.layout.media.y,
    threeLineSnapshot.layout.bottomText.y + threeLineBodyHeight + templateConfig.channelStory!.bodyToMediaGap
  );
  assert.equal(
    fourLineSnapshot.layout.media.y - threeLineSnapshot.layout.media.y,
    fourLineBodyHeight - threeLineBodyHeight
  );
  assert.equal(threeLineSnapshot.computed.videoY, threeLineSnapshot.layout.media.y);
  assert.equal(fourLineSnapshot.computed.videoY, fourLineSnapshot.layout.media.y);
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
