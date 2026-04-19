import scienceCardV1SpecJson from "../design/templates/science-card-v1/figma-spec.json";
import scienceCardV7SpecJson from "../design/templates/science-card-v7/figma-spec.json";
import hedgesOfHonorV1SpecJson from "../design/templates/hedges-of-honor-v1/figma-spec.json";
import {
  SCIENCE_CARD_BLUE_TEMPLATE_ID,
  SCIENCE_CARD_GREEN_TEMPLATE_ID,
  SCIENCE_CARD_RED_TEMPLATE_ID,
  SCIENCE_CARD_TEMPLATE_ID,
  STAGE3_TEMPLATE_SHELL,
  STAGE3_TEMPLATE_ID,
  Stage3TemplateConfig,
  getTemplateById,
  getTemplateComputed
} from "./stage3-template";

export type TemplateRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TemplateFrameSpec = {
  width: number;
  height: number;
};

export type TemplateShellSpec = TemplateRect & {
  radius: number;
  background?: string;
  border?: string;
};

export type TemplateCardSpec = TemplateRect & {
  radius: number;
  borderWidth: number;
  borderColor: string;
  fill: string;
  shadow?: string;
};

export type TemplateSectionRects = {
  top: TemplateRect;
  media: TemplateRect;
  bottom: TemplateRect;
  author: TemplateRect;
  avatar: TemplateRect;
  bottomText: TemplateRect;
};

export type TemplateTypographyVisualSpec = {
  fontSize?: number;
  lineHeightPx?: number;
  fontWeight?: number;
};

export type TemplateFigmaSpec = {
  templateId: string;
  source: "figma-locked" | "generated";
  figma?: {
    fileKey: string;
    nodeId: string;
    nodeName?: string;
  };
  frame: TemplateFrameSpec;
  shell: TemplateShellSpec;
  card: TemplateCardSpec;
  sections: TemplateSectionRects;
  typography?: {
    topText?: TemplateTypographyVisualSpec;
    bottomText?: TemplateTypographyVisualSpec;
    authorName?: TemplateTypographyVisualSpec;
    authorHandle?: TemplateTypographyVisualSpec;
    badge?: {
      size?: number;
    };
  };
};

const SCIENCE_CARD_V1_FIGMA_SPEC = scienceCardV1SpecJson as TemplateFigmaSpec;

function createScienceCardBorderVariantSpec(
  templateId: string,
  borderColor: string,
  borderWidth: number
): TemplateFigmaSpec {
  return {
    ...SCIENCE_CARD_V1_FIGMA_SPEC,
    templateId,
    source: "generated",
    card: {
      ...SCIENCE_CARD_V1_FIGMA_SPEC.card,
      borderColor,
      borderWidth
    }
  };
}

const REPO_BACKED_TEMPLATE_SPECS = new Map<string, TemplateFigmaSpec>([
  [SCIENCE_CARD_TEMPLATE_ID, SCIENCE_CARD_V1_FIGMA_SPEC],
  [
    SCIENCE_CARD_BLUE_TEMPLATE_ID,
    createScienceCardBorderVariantSpec(SCIENCE_CARD_BLUE_TEMPLATE_ID, "#2057d6", 16)
  ],
  [
    SCIENCE_CARD_RED_TEMPLATE_ID,
    createScienceCardBorderVariantSpec(SCIENCE_CARD_RED_TEMPLATE_ID, "#d33f49", 16)
  ],
  [
    SCIENCE_CARD_GREEN_TEMPLATE_ID,
    createScienceCardBorderVariantSpec(SCIENCE_CARD_GREEN_TEMPLATE_ID, "#20a35a", 16)
  ],
  ["science-card-v7", scienceCardV7SpecJson as TemplateFigmaSpec],
  ["hedges-of-honor-v1", hedgesOfHonorV1SpecJson as TemplateFigmaSpec]
]);

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

function getGeneratedTemplateShell(templateId: string, template: Stage3TemplateConfig): TemplateShellSpec {
  if (templateId === SCIENCE_CARD_TEMPLATE_ID) {
    return {
      ...STAGE3_TEMPLATE_SHELL
    };
  }
  if (templateId === "science-card-v7") {
    return {
      ...STAGE3_TEMPLATE_SHELL,
      background: "#177fa6"
    };
  }
  return {
    x: template.card.x,
    y: template.card.y,
    width: template.card.width,
    height: template.card.height,
    radius: Math.max(template.card.radius, 18)
  };
}

function buildGeneratedSpec(templateId: string): TemplateFigmaSpec {
  const template = getTemplateById(templateId);
  const computed = getTemplateComputed(templateId, "Top text", "Bottom text");
  if (template.layoutKind === "channel_story") {
    const channelStory = template.channelStory!;
    const contentWidth = template.card.width - channelStory.contentPaddingX * 2;
    const headerY = computed.headerY ?? template.card.y + channelStory.contentPaddingTop;
    const leadY =
      computed.topY ?? headerY + channelStory.headerHeight + channelStory.headerToLeadGap;
    const bodyY =
      computed.bottomTextY ??
      leadY +
        (computed.leadVisible === false ? 0 : channelStory.leadHeight + channelStory.leadToBodyGap);
    return {
      templateId,
      source: "generated",
      frame: {
        width: template.frame.width,
        height: template.frame.height
      },
      shell: {
        x: template.card.x,
        y: template.card.y,
        width: template.card.width,
        height: template.card.height,
        radius: Math.max(template.card.radius, 18)
      },
      card: {
        ...template.card
      },
      sections: {
        top: {
          x: template.card.x + channelStory.contentPaddingX,
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
          x: template.card.x,
          y: computed.videoY + computed.videoHeight,
          width: template.card.width,
          height: computed.bottomBlockHeight
        },
        author: {
          x: template.card.x + channelStory.contentPaddingX,
          y: headerY,
          width: contentWidth,
          height: channelStory.headerHeight
        },
        avatar: {
          x: template.card.x + channelStory.contentPaddingX,
          y: headerY + Math.max(0, Math.round((channelStory.headerHeight - template.author.avatarSize) / 2)),
          width: template.author.avatarSize,
          height: template.author.avatarSize
        },
        bottomText: {
          x: template.card.x + channelStory.contentPaddingX,
          y: bodyY,
          width: contentWidth,
          height: channelStory.bodyHeight
        }
      }
    };
  }
  const shell = getGeneratedTemplateShell(templateId, template);
  const bottomTextTop =
    template.card.y +
    template.card.height -
    computed.bottomBlockHeight +
    computed.bottomMetaHeight +
    getBottomTextPaddingTop(template);
  const bottomTextHeight =
    computed.bottomBodyHeight -
    getBottomTextPaddingTop(template) -
    getBottomTextPaddingBottom(template);

  return {
    templateId,
    source: "generated",
    frame: {
      width: template.frame.width,
      height: template.frame.height
    },
    shell,
    card: {
      ...template.card
    },
    sections: {
      top: {
        x: template.card.x,
        y: template.card.y,
        width: template.card.width,
        height: computed.topBlockHeight
      },
      media: {
        x: computed.videoX,
        y: computed.videoY,
        width: computed.videoWidth,
        height: computed.videoHeight
      },
      bottom: {
        x: template.card.x,
        y: template.card.y + template.card.height - computed.bottomBlockHeight,
        width: template.card.width,
        height: computed.bottomBlockHeight
      },
      author: {
        x: template.card.x,
        y: template.card.y + template.card.height - computed.bottomBlockHeight,
        width: template.card.width,
        height: computed.bottomMetaHeight
      },
      avatar: {
        x: template.card.x + template.slot.bottomMetaPaddingX,
        y:
          template.card.y +
          template.card.height -
          computed.bottomBlockHeight +
          Math.max(0, Math.round((computed.bottomMetaHeight - template.author.avatarSize) / 2)),
        width: template.author.avatarSize,
        height: template.author.avatarSize
      },
      bottomText: {
        x: template.card.x + getBottomTextPaddingLeft(template),
        y: bottomTextTop,
        width:
          template.card.width -
          getBottomTextPaddingLeft(template) -
          getBottomTextPaddingRight(template),
        height: bottomTextHeight
      }
    }
  };
}

const GENERATED_SPEC_CACHE = new Map<string, TemplateFigmaSpec>();

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getTemplateFigmaSpec(templateId: string | null | undefined): TemplateFigmaSpec {
  const resolvedTemplateId = templateId?.trim() || STAGE3_TEMPLATE_ID;
  const repoBacked = REPO_BACKED_TEMPLATE_SPECS.get(resolvedTemplateId);
  if (repoBacked) {
    return repoBacked;
  }
  const next = buildGeneratedSpec(resolvedTemplateId);
  GENERATED_SPEC_CACHE.set(resolvedTemplateId, next);
  return next;
}

export function getTemplateSpecRevision(templateId: string | null | undefined): string {
  return stableHash(JSON.stringify(getTemplateFigmaSpec(templateId)));
}
