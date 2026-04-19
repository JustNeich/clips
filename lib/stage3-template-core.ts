import type { TemplateContentFixture } from "./template-calibration-types";
import { normalizeTemplateCaptionHighlights } from "./template-highlights";
import {
  isClassicScienceCardTemplateId,
  SCIENCE_CARD_TEMPLATE_ID,
  STAGE3_TEMPLATE_ID,
  Stage3TemplateComputed,
  Stage3TemplateConfig,
  getTemplateById,
  getTemplateComputedForConfig
} from "./stage3-template";
import { resolveTemplateRenderText } from "./stage3-template-semantics";
import {
  TemplateCardSpec,
  TemplateFigmaSpec,
  TemplateRect,
  TemplateShellSpec,
  getTemplateFigmaSpec,
  getTemplateSpecRevision
} from "./stage3-template-spec";

export type TemplateLayoutInput = {
  templateId: string;
  content: TemplateContentFixture;
  templateConfigOverride?: Stage3TemplateConfig;
  fitOverride?: Partial<
    Pick<
      TemplateTextFitResult,
      | "topFontPx"
      | "bottomFontPx"
      | "topLineHeight"
      | "bottomLineHeight"
      | "topLines"
      | "bottomLines"
      | "topCompacted"
      | "bottomCompacted"
    >
  >;
};

export type TemplateTextFitResult = {
  topText: string;
  bottomText: string;
  topFontPx: number;
  bottomFontPx: number;
  topLineHeight: number;
  bottomLineHeight: number;
  topLines: number;
  bottomLines: number;
  topCompacted: boolean;
  bottomCompacted: boolean;
  fitRevision: string;
};

export type TemplateLayoutModel = {
  frame: {
    width: number;
    height: number;
  };
  shell: TemplateShellSpec;
  card: TemplateCardSpec;
  top: TemplateRect;
  media: TemplateRect;
  bottom: TemplateRect;
  author: TemplateRect;
  avatar: TemplateRect;
  bottomText: TemplateRect;
};

export type TemplateRenderSnapshot = {
  templateId: string;
  spec: TemplateFigmaSpec;
  specRevision: string;
  snapshotHash: string;
  fitRevision: string;
  content: TemplateContentFixture;
  fit: TemplateTextFitResult;
  layout: TemplateLayoutModel;
  computed: Stage3TemplateComputed;
};

export type TemplateLayoutOutput = Stage3TemplateComputed;

const TEMPLATE_FIT_REVISION = "template-fit-v1";

export type TemplateChromeMetrics = {
  cardRadius: number;
  cardBorderWidth: number;
  topPaddingX: number;
  topPaddingTop: number;
  topPaddingBottom: number;
};

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getBottomTextPaddingTop(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingTop ?? template.slot.bottomTextPaddingY;
}

function getBottomTextPaddingBottom(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingBottom ?? template.slot.bottomTextPaddingY;
}

function getBottomTextPaddingLeft(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingLeft ?? template.slot.bottomTextPaddingX;
}

function getBottomTextPaddingRight(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingRight ?? template.slot.bottomTextPaddingX;
}

function getTopPaddingTop(template: Stage3TemplateConfig): number {
  return template.slot.topPaddingTop ?? template.slot.topPaddingY;
}

function getTopPaddingBottom(template: Stage3TemplateConfig): number {
  return template.slot.topPaddingBottom ?? template.slot.topPaddingY;
}

export function resolveTemplateChromeMetrics(
  templateId: string,
  templateConfig: Stage3TemplateConfig = getTemplateById(templateId),
  spec: TemplateFigmaSpec = getTemplateFigmaSpec(templateId)
): TemplateChromeMetrics {
  const baseTopPaddingTop = getTopPaddingTop(templateConfig);
  const baseTopPaddingBottom = getTopPaddingBottom(templateConfig);

  if (!isClassicScienceCardTemplateId(templateId)) {
    return {
      cardRadius: spec.card.radius,
      cardBorderWidth: spec.card.borderWidth,
      topPaddingX: templateConfig.slot.topPaddingX,
      topPaddingTop: baseTopPaddingTop,
      topPaddingBottom: baseTopPaddingBottom
    };
  }

  const widthScale = spec.card.width / Math.max(1, templateConfig.card.width);
  const heightScale = spec.card.height / Math.max(1, templateConfig.card.height);
  const chromeScale = Math.max(1, Number(((widthScale + heightScale) / 2).toFixed(3)));
  const scaledTopPaddingTop = Math.max(baseTopPaddingTop, Math.round(baseTopPaddingTop * chromeScale));
  const scaledTopPaddingBottom = Math.max(baseTopPaddingBottom, Math.round(baseTopPaddingBottom * chromeScale));
  const proportionalTopPaddingX = Math.max(
    Math.round(Math.max(scaledTopPaddingTop, scaledTopPaddingBottom) * 1.45),
    Math.round(templateConfig.slot.topPaddingX * chromeScale)
  );

  return {
    cardRadius: Math.max(spec.card.radius, Math.round(templateConfig.card.radius * chromeScale)),
    cardBorderWidth: Math.max(spec.card.borderWidth, Math.round(templateConfig.card.borderWidth * chromeScale)),
    topPaddingX: proportionalTopPaddingX,
    topPaddingTop: scaledTopPaddingTop,
    topPaddingBottom: scaledTopPaddingBottom
  };
}

function buildFallbackSectionRects(
  templateConfig: Stage3TemplateConfig,
  computed: Stage3TemplateComputed
) {
  if (templateConfig.layoutKind === "channel_story") {
    const channelStory = templateConfig.channelStory!;
    const contentX = templateConfig.card.x + channelStory.contentPaddingX;
    const contentWidth = templateConfig.card.width - channelStory.contentPaddingX * 2;
    const headerY = computed.headerY ?? templateConfig.card.y + channelStory.contentPaddingTop;
    const leadY =
      computed.topY ?? headerY + channelStory.headerHeight + channelStory.headerToLeadGap;
    const bodyY =
      computed.bottomTextY ??
      headerY +
        channelStory.headerHeight +
        (computed.leadVisible === false
          ? Math.max(channelStory.headerToLeadGap, 12)
          : channelStory.headerToLeadGap + channelStory.leadHeight + channelStory.leadToBodyGap);
    return {
      top: {
        x: contentX,
        y: leadY,
        width: contentWidth,
        height: computed.leadVisible === false ? 0 : channelStory.leadHeight
      },
      media: {
        x: computed.videoX,
        y: computed.videoY,
        width: computed.videoWidth,
        height: computed.videoHeight
      },
      bottom: {
        x: templateConfig.card.x,
        y: computed.videoY + computed.videoHeight,
        width: templateConfig.card.width,
        height: computed.bottomBlockHeight
      },
      author: {
        x: contentX,
        y: headerY,
        width: contentWidth,
        height: channelStory.headerHeight
      },
      avatar: {
        x: contentX,
        y: headerY + Math.max(0, Math.round((channelStory.headerHeight - templateConfig.author.avatarSize) / 2)),
        width: templateConfig.author.avatarSize,
        height: templateConfig.author.avatarSize
      },
      bottomText: {
        x: contentX,
        y: bodyY,
        width: contentWidth,
        height: channelStory.bodyHeight
      }
    };
  }
  return {
    top: {
      x: templateConfig.card.x,
      y: templateConfig.card.y,
      width: templateConfig.card.width,
      height: computed.topBlockHeight
    },
    media: {
      x: computed.videoX,
      y: computed.videoY,
      width: computed.videoWidth,
      height: computed.videoHeight
    },
    bottom: {
      x: templateConfig.card.x,
      y: templateConfig.card.y + templateConfig.card.height - computed.bottomBlockHeight,
      width: templateConfig.card.width,
      height: computed.bottomBlockHeight
    },
    author: {
      x: templateConfig.card.x,
      y: templateConfig.card.y + templateConfig.card.height - computed.bottomBlockHeight,
      width: templateConfig.card.width,
      height: computed.bottomMetaHeight
    },
    avatar: {
      x: templateConfig.card.x + templateConfig.slot.bottomMetaPaddingX,
      y:
        templateConfig.card.y +
        templateConfig.card.height -
        computed.bottomBlockHeight +
        Math.max(0, Math.round((computed.bottomMetaHeight - templateConfig.author.avatarSize) / 2)),
      width: templateConfig.author.avatarSize,
      height: templateConfig.author.avatarSize
    },
    bottomText: {
      x: templateConfig.card.x + getBottomTextPaddingLeft(templateConfig),
      y:
        templateConfig.card.y +
        templateConfig.card.height -
        computed.bottomBlockHeight +
        computed.bottomMetaHeight +
        getBottomTextPaddingTop(templateConfig),
      width:
        templateConfig.card.width -
        getBottomTextPaddingLeft(templateConfig) -
        getBottomTextPaddingRight(templateConfig),
      height:
        computed.bottomBodyHeight -
        getBottomTextPaddingTop(templateConfig) -
        getBottomTextPaddingBottom(templateConfig)
    }
  };
}

function buildEffectiveTemplateConfig(
  templateId: string,
  templateConfig: Stage3TemplateConfig,
  spec: TemplateFigmaSpec
): Stage3TemplateConfig {
  const chromeMetrics = resolveTemplateChromeMetrics(templateId, templateConfig, spec);
  return {
    ...templateConfig,
    frame: {
      width: spec.frame.width,
      height: spec.frame.height
    },
    card: {
      ...templateConfig.card,
      radius: chromeMetrics.cardRadius,
      borderWidth: chromeMetrics.cardBorderWidth
    },
    slot: {
      ...templateConfig.slot,
      topHeight: spec.sections.top.height,
      topPaddingX: chromeMetrics.topPaddingX,
      topPaddingTop: chromeMetrics.topPaddingTop,
      topPaddingBottom: chromeMetrics.topPaddingBottom,
      bottomHeight: spec.sections.bottom.height,
      bottomMetaHeight: spec.sections.author.height,
      bottomMetaPaddingX: templateConfig.slot.bottomMetaPaddingX,
      bottomMetaPaddingY: templateConfig.slot.bottomMetaPaddingY,
      bottomTextPaddingX: templateConfig.slot.bottomTextPaddingX,
      bottomTextPaddingY: templateConfig.slot.bottomTextPaddingY,
      bottomTextPaddingTop: templateConfig.slot.bottomTextPaddingTop,
      bottomTextPaddingBottom: templateConfig.slot.bottomTextPaddingBottom,
      bottomTextPaddingLeft: templateConfig.slot.bottomTextPaddingLeft,
      bottomTextPaddingRight: templateConfig.slot.bottomTextPaddingRight
    },
    author: {
      ...templateConfig.author
    },
    typography: {
      ...templateConfig.typography
    }
  };
}

export function buildTemplateLayoutModel(
  templateId: string,
  computed: Stage3TemplateComputed,
  templateConfig?: Stage3TemplateConfig
): TemplateLayoutModel {
  const resolvedTemplateId = templateId?.trim() || STAGE3_TEMPLATE_ID;
  const resolvedTemplate = templateConfig ?? getTemplateById(resolvedTemplateId);
  const spec = getTemplateFigmaSpec(resolvedTemplateId);
  const fallback = buildFallbackSectionRects(resolvedTemplate, computed);

  return {
    frame: {
      width: spec.frame.width,
      height: spec.frame.height
    },
    shell: spec.shell,
    card: {
      ...spec.card,
      x: resolvedTemplate.card.x,
      y: resolvedTemplate.card.y,
      width: resolvedTemplate.card.width,
      height: resolvedTemplate.card.height,
      radius: resolvedTemplate.card.radius,
      borderWidth: resolvedTemplate.card.borderWidth,
      borderColor: resolvedTemplate.card.borderColor,
      fill: resolvedTemplate.card.fill,
      shadow: resolvedTemplate.card.shadow
    },
    top: fallback.top,
    media: fallback.media,
    bottom: fallback.bottom,
    author: fallback.author,
    avatar: fallback.avatar,
    bottomText: fallback.bottomText
  };
}

export function buildTemplateRenderSnapshot(input: TemplateLayoutInput): TemplateRenderSnapshot {
  const resolvedTemplateId = input.templateId?.trim() || STAGE3_TEMPLATE_ID;
  const baseTemplateConfig = input.templateConfigOverride ?? getTemplateById(resolvedTemplateId);
  const spec = getTemplateFigmaSpec(resolvedTemplateId);
  const effectiveTemplateConfig = buildEffectiveTemplateConfig(
    resolvedTemplateId,
    baseTemplateConfig,
    spec
  );
  const resolvedText = resolveTemplateRenderText({
    templateConfig: effectiveTemplateConfig,
    topText: input.content.topText,
    bottomText: input.content.bottomText,
    highlights: input.content.highlights
  });
  const computed = getTemplateComputedForConfig(
    resolvedText.topText,
    resolvedText.bottomText,
    {
      topFontScale: input.content.topFontScale,
      bottomFontScale: input.content.bottomFontScale
    },
    effectiveTemplateConfig
  );
  const specRevision = getTemplateSpecRevision(resolvedTemplateId);
  const content: TemplateContentFixture = {
    ...input.content,
    topText: computed.top,
    bottomText: computed.bottom,
    highlights: normalizeTemplateCaptionHighlights(resolvedText.highlights, {
      top: computed.top,
      bottom: computed.bottom
    })
  };
  const fitOverride = input.fitOverride;
  const fit: TemplateTextFitResult = {
    topText: computed.top,
    bottomText: computed.bottom,
    topFontPx: fitOverride?.topFontPx ?? computed.topFont,
    bottomFontPx: fitOverride?.bottomFontPx ?? computed.bottomFont,
    topLineHeight: fitOverride?.topLineHeight ?? computed.topLineHeight,
    bottomLineHeight: fitOverride?.bottomLineHeight ?? computed.bottomLineHeight,
    topLines: fitOverride?.topLines ?? computed.topLines,
    bottomLines: fitOverride?.bottomLines ?? computed.bottomLines,
    topCompacted: fitOverride?.topCompacted ?? computed.topCompacted,
    bottomCompacted: fitOverride?.bottomCompacted ?? computed.bottomCompacted,
    fitRevision: TEMPLATE_FIT_REVISION
  };
  const snapshotComputed = {
    ...computed,
    topFont: fit.topFontPx,
    bottomFont: fit.bottomFontPx,
    topLineHeight: fit.topLineHeight,
    bottomLineHeight: fit.bottomLineHeight,
    topLines: fit.topLines,
    bottomLines: fit.bottomLines,
    topCompacted: fit.topCompacted,
    bottomCompacted: fit.bottomCompacted
  };
  const layout = buildTemplateLayoutModel(resolvedTemplateId, snapshotComputed, effectiveTemplateConfig);
  const snapshotHash = stableHash(
    JSON.stringify({
      templateId: resolvedTemplateId,
      specRevision,
      fitRevision: TEMPLATE_FIT_REVISION,
      content: {
        topText: content.topText,
        bottomText: content.bottomText,
        channelName: content.channelName,
        channelHandle: content.channelHandle,
        highlights: content.highlights,
        topFontScale: content.topFontScale,
        bottomFontScale: content.bottomFontScale
      },
      fit,
      layout
    })
  );

  return {
    templateId: resolvedTemplateId,
    spec,
    specRevision,
    snapshotHash,
    fitRevision: TEMPLATE_FIT_REVISION,
    content,
    fit,
    layout,
    computed: snapshotComputed
  };
}

export function computeTemplateLayout(input: TemplateLayoutInput): TemplateLayoutOutput {
  return buildTemplateRenderSnapshot(input).computed;
}

export function getTemplateGeometry(templateId: string) {
  return getTemplateById(templateId);
}
