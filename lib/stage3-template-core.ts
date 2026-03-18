import type { TemplateContentFixture } from "./template-calibration-types";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  STAGE3_TEMPLATE_ID,
  Stage3TemplateConfig,
  getTemplateById,
  getScienceCardComputed,
  getTemplateComputed
} from "./stage3-template";
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
  computed: ReturnType<typeof getTemplateComputed>;
};

export type TemplateLayoutOutput = ReturnType<typeof getTemplateComputed>;

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

  if (templateId !== SCIENCE_CARD_TEMPLATE_ID) {
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
  computed: ReturnType<typeof getTemplateComputed>
) {
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
  const bottomTextPaddingLeft = Math.max(0, spec.sections.bottomText.x - spec.card.x);
  const bottomTextPaddingRight = Math.max(
    0,
    spec.card.x + spec.card.width - (spec.sections.bottomText.x + spec.sections.bottomText.width)
  );
  const bottomTextPaddingTop = Math.max(
    0,
    spec.sections.bottomText.y - (spec.sections.bottom.y + spec.sections.author.height)
  );
  const bottomTextPaddingBottom = Math.max(
    0,
    spec.sections.bottom.y +
      spec.sections.bottom.height -
      (spec.sections.bottomText.y + spec.sections.bottomText.height)
  );

  return {
    ...templateConfig,
    frame: {
      width: spec.frame.width,
      height: spec.frame.height
    },
    card: {
      ...templateConfig.card,
      ...spec.card,
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
      bottomMetaPaddingX: Math.max(0, spec.sections.avatar.x - spec.card.x),
      bottomMetaPaddingY: templateConfig.slot.bottomMetaPaddingY,
      bottomTextPaddingX: templateConfig.slot.bottomTextPaddingX,
      bottomTextPaddingY: templateConfig.slot.bottomTextPaddingY,
      bottomTextPaddingTop,
      bottomTextPaddingBottom,
      bottomTextPaddingLeft,
      bottomTextPaddingRight
    },
    author: {
      ...templateConfig.author,
      avatarSize: spec.sections.avatar.width,
      checkSize: spec.typography?.badge?.size ?? templateConfig.author.checkSize
    },
    typography: {
      ...templateConfig.typography,
      authorName: {
        ...templateConfig.typography.authorName,
        font: spec.typography?.authorName?.fontSize ?? templateConfig.typography.authorName.font,
        weight: spec.typography?.authorName?.fontWeight ?? templateConfig.typography.authorName.weight
      },
      authorHandle: {
        ...templateConfig.typography.authorHandle,
        font: spec.typography?.authorHandle?.fontSize ?? templateConfig.typography.authorHandle.font,
        weight:
          spec.typography?.authorHandle?.fontWeight ?? templateConfig.typography.authorHandle.weight
      }
    }
  };
}

export function buildTemplateLayoutModel(
  templateId: string,
  computed: ReturnType<typeof getTemplateComputed>,
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
    card: spec.card,
    top: spec.sections?.top ?? fallback.top,
    media: spec.sections?.media ?? fallback.media,
    bottom: spec.sections?.bottom ?? fallback.bottom,
    author: spec.sections?.author ?? fallback.author,
    avatar: spec.sections?.avatar ?? fallback.avatar,
    bottomText: spec.sections?.bottomText ?? fallback.bottomText
  };
}

export function buildTemplateRenderSnapshot(input: TemplateLayoutInput): TemplateRenderSnapshot {
  const resolvedTemplateId = input.templateId?.trim() || STAGE3_TEMPLATE_ID;
  const baseTemplateConfig = getTemplateById(resolvedTemplateId);
  const spec = getTemplateFigmaSpec(resolvedTemplateId);
  const effectiveTemplateConfig = buildEffectiveTemplateConfig(
    resolvedTemplateId,
    baseTemplateConfig,
    spec
  );
  const computed = getScienceCardComputed(
    input.content.topText,
    input.content.bottomText,
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
    bottomText: computed.bottom
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
  const layout = buildTemplateLayoutModel(resolvedTemplateId, computed, effectiveTemplateConfig);
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
