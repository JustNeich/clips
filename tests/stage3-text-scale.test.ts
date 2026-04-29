import assert from "node:assert/strict";
import test from "node:test";

import * as stage3TemplateCoreModule from "../lib/stage3-template-core";

const stage3TemplateCore =
  (stage3TemplateCoreModule as { default?: unknown; "module.exports"?: unknown }).default ??
  (stage3TemplateCoreModule as { default?: unknown; "module.exports"?: unknown })["module.exports"] ??
  stage3TemplateCoreModule;

const { buildTemplateRenderSnapshot } = stage3TemplateCore as {
  buildTemplateRenderSnapshot: typeof import("../lib/stage3-template-core").buildTemplateRenderSnapshot;
};

test("science-card-v1 top text scale below 100% reduces the computed font size", () => {
  const topText =
    "You don't need to know who he is to get the appeal: sweaty chest, sauna hat, snow piled outside, hot tub in the yard, then a packed table indoors.";

  const atDefault = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      topText,
      bottomText:
        "Bro made a regular night look under-equipped. It's the kind of sequence that makes your own plans feel like microwaved leftovers and weak excuses.",
      channelName: "Echoes Of Honor",
      channelHandle: "@EchoesOfHonor50",
      highlights: { top: [], bottom: [] },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  const reduced = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      ...atDefault.content,
      topFontScale: 0.85
    }
  });

  const nearDefault = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      ...atDefault.content,
      topFontScale: 0.99
    }
  });

  const increased = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      ...atDefault.content,
      topFontScale: 1.15
    }
  });
  const defaultTopHeight =
    atDefault.computed.topFont * atDefault.computed.topLineHeight * atDefault.computed.topLines;
  const nearDefaultTopHeight =
    nearDefault.computed.topFont * nearDefault.computed.topLineHeight * nearDefault.computed.topLines;

  assert.ok(
    reduced.computed.topFont < atDefault.computed.topFont,
    `expected 85% to reduce top font, got ${reduced.computed.topFont} vs ${atDefault.computed.topFont}`
  );
  assert.ok(
    nearDefault.computed.topFont >= atDefault.computed.topFont - 1,
    `expected 99% to stay close to 100%, got ${nearDefault.computed.topFont} vs ${atDefault.computed.topFont}`
  );
  assert.ok(
    nearDefault.computed.topLines === atDefault.computed.topLines,
    `expected 99% to preserve line count, got ${nearDefault.computed.topLines} vs ${atDefault.computed.topLines}`
  );
  assert.ok(
    nearDefaultTopHeight >= defaultTopHeight * 0.97,
    `expected 99% height to remain close to 100%, got ${nearDefaultTopHeight.toFixed(2)} vs ${defaultTopHeight.toFixed(2)}`
  );
  assert.ok(
    increased.computed.topFont > atDefault.computed.topFont,
    `expected 115% to increase top font, got ${increased.computed.topFont} vs ${atDefault.computed.topFont}`
  );
});

test("neighboring bottom text scale values move smoothly for hedges-of-honor-v1", () => {
  const topText =
    "A whole wall of marine officers comes in with rifles up, and Ace just drops in front of Luffy, eats the bullet volley, then turns the firing line into airborne laundry.";
  const bottomText =
    "\"Yeah, this is why nobody got over Ace.\" They finally look like the broken tag team fans wanted, and the story gives us about five seconds of it.";

  const at103 = buildTemplateRenderSnapshot({
    templateId: "hedges-of-honor-v1",
    content: {
      topText,
      bottomText,
      channelName: "Stone Face Turbo",
      channelHandle: "@StoneFaceTurbo",
      highlights: { top: [], bottom: [] },
      topFontScale: 1.17,
      bottomFontScale: 1.03,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });
  const at104 = buildTemplateRenderSnapshot({
    templateId: "hedges-of-honor-v1",
    content: {
      ...at103.content,
      bottomFontScale: 1.04
    }
  });
  const at105 = buildTemplateRenderSnapshot({
    templateId: "hedges-of-honor-v1",
    content: {
      ...at103.content,
      bottomFontScale: 1.05
    }
  });

  assert.ok(at104.computed.bottomFont >= at103.computed.bottomFont);
  assert.ok(at105.computed.bottomFont >= at104.computed.bottomFont);
  assert.ok(
    at104.computed.bottomFont - at103.computed.bottomFont <= 0.5,
    `expected 103% -> 104% to avoid a 1px cliff, got ${at103.computed.bottomFont} -> ${at104.computed.bottomFont}`
  );
  assert.ok(
    at105.computed.bottomFont - at104.computed.bottomFont <= 0.5,
    `expected 104% -> 105% to avoid a 1px cliff, got ${at104.computed.bottomFont} -> ${at105.computed.bottomFont}`
  );
});

test("neighboring top text scale values move smoothly for science-card-v1", () => {
  const topText =
    "You don't need to know who he is to get the appeal: sweaty chest, sauna hat, snow piled outside, hot tub in the yard, then a packed table indoors.";
  const bottomText =
    "Bro made a regular night look under-equipped. It's the kind of sequence that makes your own plans feel like microwaved leftovers and weak excuses.";

  const at100 = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      topText,
      bottomText,
      channelName: "Echoes Of Honor",
      channelHandle: "@EchoesOfHonor50",
      highlights: { top: [], bottom: [] },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });
  const at101 = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      ...at100.content,
      topFontScale: 1.01
    }
  });
  const at102 = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      ...at100.content,
      topFontScale: 1.02
    }
  });

  assert.ok(at101.computed.topFont >= at100.computed.topFont);
  assert.ok(at102.computed.topFont >= at101.computed.topFont);
  assert.ok(
    at101.computed.topFont - at100.computed.topFont <= 0.5,
    `expected 100% -> 101% to avoid a 1px cliff, got ${at100.computed.topFont} -> ${at101.computed.topFont}`
  );
  assert.ok(
    at102.computed.topFont - at101.computed.topFont <= 0.5,
    `expected 101% -> 102% to avoid a 1px cliff, got ${at101.computed.topFont} -> ${at102.computed.topFont}`
  );
});

test("neighboring bottom text scale values move smoothly around 100% for science-card-v1", () => {
  const topText =
    "You don't need to know who he is to get the appeal: sweaty chest, sauna hat, snow piled outside, hot tub in the yard, then a packed table indoors.";
  const bottomText =
    "Bro made a regular night look under-equipped. It's the kind of sequence that makes your own plans feel like microwaved leftovers and weak excuses.";

  const at99 = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      topText,
      bottomText,
      channelName: "Echoes Of Honor",
      channelHandle: "@EchoesOfHonor50",
      highlights: { top: [], bottom: [] },
      topFontScale: 1,
      bottomFontScale: 0.99,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });
  const at100 = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      ...at99.content,
      bottomFontScale: 1
    }
  });
  const at101 = buildTemplateRenderSnapshot({
    templateId: "science-card-v1",
    content: {
      ...at99.content,
      bottomFontScale: 1.01
    }
  });

  assert.ok(at100.computed.bottomFont >= at99.computed.bottomFont);
  assert.ok(at101.computed.bottomFont >= at100.computed.bottomFont);
  assert.ok(
    at100.computed.bottomFont - at99.computed.bottomFont <= 0.5,
    `expected 99% -> 100% to avoid a 1px cliff, got ${at99.computed.bottomFont} -> ${at100.computed.bottomFont}`
  );
  assert.ok(
    at101.computed.bottomFont - at100.computed.bottomFont <= 0.5,
    `expected 100% -> 101% to avoid a 1px cliff, got ${at100.computed.bottomFont} -> ${at101.computed.bottomFont}`
  );
});

test("channel-story body text keeps descender-safe line height and responds to scale", () => {
  const bottomText =
    "A gray fox keeps dropping low by the icy river, then pops up again with a quiet little jog that makes every lowercase g, q, p, and y visible.";

  const atDefault = buildTemplateRenderSnapshot({
    templateId: "channel-story-v1",
    content: {
      topText: "",
      bottomText,
      channelName: "Marine Corps",
      channelHandle: "@marinesdoingthings",
      highlights: { top: [], bottom: [] },
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });
  const reduced = buildTemplateRenderSnapshot({
    templateId: "channel-story-v1",
    content: {
      ...atDefault.content,
      bottomFontScale: 0.85
    }
  });
  const increased = buildTemplateRenderSnapshot({
    templateId: "channel-story-v1",
    content: {
      ...atDefault.content,
      bottomFontScale: 1.15
    }
  });

  assert.ok(
    atDefault.computed.bottomLineHeight >= 1.05,
    `expected descender-safe line-height, got ${atDefault.computed.bottomLineHeight}`
  );
  assert.ok(reduced.computed.bottomFont < atDefault.computed.bottomFont);
  assert.ok(increased.computed.bottomFont >= atDefault.computed.bottomFont);
});
