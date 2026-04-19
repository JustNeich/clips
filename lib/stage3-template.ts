import {
  ceilStage3TextFontPx,
  clampStage3TextScaleUi,
  snapStage3TextFontPx,
  STAGE3_TEXT_FONT_STEP_PX
} from "./stage3-text-fit";
import {
  cloneTemplateHighlightConfig,
  createDefaultTemplateHighlightConfig,
  type TemplateHighlightConfig
} from "./template-highlights";
import {
  cloneStage3VideoAdjustments,
  DEFAULT_STAGE3_VIDEO_ADJUSTMENTS,
  type Stage3VideoAdjustments
} from "./stage3-video-adjustments";
import type {
  Stage3TemplateLayoutKind,
  Stage3TemplateLeadMode
} from "./stage3-template-semantics";

export const SCIENCE_CARD_TEMPLATE_ID = "science-card-v1";
export const SCIENCE_CARD_BLUE_TEMPLATE_ID = "science-card-blue-v1";
export const SCIENCE_CARD_RED_TEMPLATE_ID = "science-card-red-v1";
export const SCIENCE_CARD_GREEN_TEMPLATE_ID = "science-card-green-v1";
export const AMERICAN_NEWS_TEMPLATE_ID = "american-news-v1";
export const SCIENCE_CARD_V7_TEMPLATE_ID = "science-card-v7";
export const HEDGES_OF_HONOR_TEMPLATE_ID = "hedges-of-honor-v1";
export const CHANNEL_STORY_TEMPLATE_ID = "channel-story-v1";
export const STAGE3_TEMPLATE_ID = SCIENCE_CARD_TEMPLATE_ID;

const SHARED_STAGE3_CARD_METRICS = {
  x: 90,
  y: 160,
  width: 901,
  height: 1600
} as const;

const SCIENCE_CARD_SECTION_METRICS = {
  topHeight: 419,
  bottomHeight: 292
} as const;

const SCIENCE_CARD_AUTHOR_METRICS = {
  bottomMetaHeight: 132,
  bottomMetaPaddingX: 23,
  bottomMetaPaddingY: 0,
  avatarSize: 101,
  checkSize: 54,
  authorNameFont: 40,
  authorHandleFont: 34,
  gap: 8,
  copyGap: 0,
  nameCheckGap: 2
} as const;

const SCIENCE_CARD_BORDER_VARIANT_BORDER_WIDTH = 16 as const;

export const SCIENCE_CARD = {
  layoutKind: "classic_top_bottom",
  frame: { width: 1080, height: 1920 },
  card: {
    x: 83,
    y: 192,
    width: 907,
    height: 1461,
    radius: 12,
    borderWidth: 8,
    borderColor: "#000000",
    fill: "#ffffff",
    shadow: "0 4px 4px rgba(0,0,0,0.25)"
  },
  slot: {
    topHeight: SCIENCE_CARD_SECTION_METRICS.topHeight,
    bottomHeight: SCIENCE_CARD_SECTION_METRICS.bottomHeight,
    topPaddingX: 6,
    topPaddingY: 15,
    topPaddingTop: 15,
    topPaddingBottom: 15,
    bottomMetaHeight: SCIENCE_CARD_AUTHOR_METRICS.bottomMetaHeight,
    bottomMetaPaddingX: SCIENCE_CARD_AUTHOR_METRICS.bottomMetaPaddingX,
    bottomMetaPaddingY: SCIENCE_CARD_AUTHOR_METRICS.bottomMetaPaddingY,
    bottomTextPaddingX: 23,
    bottomTextPaddingY: 0,
    bottomTextPaddingTop: 0,
    bottomTextPaddingBottom: 0,
    bottomTextPaddingLeft: 23,
    bottomTextPaddingRight: 46
  },
  palette: {
    cardFill: "#ffffff",
    topSectionFill: "#ffffff",
    bottomSectionFill: "#ffffff",
    topTextColor: "#000000",
    bottomTextColor: "#0b0d10",
    authorNameColor: "#000000",
    authorHandleColor: "#acacac",
    checkBadgeColor: "#e985d6",
    borderColor: "#000000"
  },
  videoAdjustments: DEFAULT_STAGE3_VIDEO_ADJUSTMENTS,
  highlights: createDefaultTemplateHighlightConfig(),
  author: {
    name: "Science Snack",
    handle: "@Science_Snack_1",
    avatarSize: SCIENCE_CARD_AUTHOR_METRICS.avatarSize,
    avatarBorder: 0,
    checkSize: SCIENCE_CARD_AUTHOR_METRICS.checkSize,
    gap: SCIENCE_CARD_AUTHOR_METRICS.gap,
    copyGap: SCIENCE_CARD_AUTHOR_METRICS.copyGap,
    nameCheckGap: SCIENCE_CARD_AUTHOR_METRICS.nameCheckGap,
    checkAssetPath: "/stage3-template-badges/science-card-v1-check.png"
  },
  typography: {
    top: {
      min: 40,
      max: 56,
      softLimit: 220,
      penalty: 0.14,
      lineHeight: 0.938,
      maxLines: 7,
      maxChars: 420,
      horizontalSafety: 0.975,
      glyphFactor: 0.53,
      fillTargetMin: 0.9,
      fillTargetMax: 0.95,
      weight: 900,
      letterSpacing: "-0.04em"
    },
    bottom: {
      min: 24,
      max: 34,
      softLimit: 190,
      penalty: 0.16,
      lineHeight: 1.08,
      maxLines: 4,
      maxChars: 320,
      fillTargetMin: 0.8,
      fillTargetMax: 0.88,
      weight: 500,
      letterSpacing: "-0.01em",
      fontStyle: "normal"
    },
    authorName: {
      font: SCIENCE_CARD_AUTHOR_METRICS.authorNameFont,
      lineHeight: 1,
      weight: 800,
      letterSpacing: "-0.03em"
    },
    authorHandle: {
      font: SCIENCE_CARD_AUTHOR_METRICS.authorHandleFont,
      lineHeight: 1,
      weight: 300,
      letterSpacing: "-0.022em"
    }
  }
} as const;

function createScienceCardBorderVariant(borderColor: string) {
  return {
    ...SCIENCE_CARD,
    card: {
      ...SCIENCE_CARD.card,
      borderWidth: SCIENCE_CARD_BORDER_VARIANT_BORDER_WIDTH,
      borderColor
    },
    palette: {
      ...SCIENCE_CARD.palette,
      borderColor
    },
    highlights: createDefaultTemplateHighlightConfig({
      accentColor: borderColor
    })
  } as const;
}

export const SCIENCE_CARD_BLUE = createScienceCardBorderVariant("#2057d6");
export const SCIENCE_CARD_RED = createScienceCardBorderVariant("#d33f49");
export const SCIENCE_CARD_GREEN = createScienceCardBorderVariant("#20a35a");

export const AMERICAN_NEWS = {
  ...SCIENCE_CARD,
  card: {
    ...SCIENCE_CARD.card,
    radius: 0,
    borderWidth: 4,
    borderColor: "#f3b31f",
    fill: "#121820",
    shadow: "0 10px 24px rgba(0, 0, 0, 0.22)"
  },
  slot: {
    ...SCIENCE_CARD.slot,
    topPaddingX: 26,
    topPaddingY: 22,
    topPaddingTop: 22,
    topPaddingBottom: 18,
    bottomTextPaddingX: 22,
    bottomTextPaddingY: 0,
    bottomTextPaddingTop: 0,
    bottomTextPaddingBottom: 0,
    bottomTextPaddingLeft: 22,
    bottomTextPaddingRight: 22
  },
  author: {
    ...SCIENCE_CARD.author,
    name: "American News",
    handle: "@amnnews9",
    checkAssetPath: "/stage3-template-badges/american-news-badge.svg",
    nameCheckGap: 10
  },
  typography: {
    ...SCIENCE_CARD.typography,
    top: {
      ...SCIENCE_CARD.typography.top,
      min: 38,
      max: 58,
      softLimit: 260,
      penalty: 0.16,
      lineHeight: 0.96,
      maxLines: 7,
      maxChars: 360,
      horizontalSafety: 0.985,
      glyphFactor: 0.51,
      fillTargetMin: 0.9,
      fillTargetMax: 0.96,
      weight: 700,
      letterSpacing: "-0.025em"
    },
    bottom: {
      ...SCIENCE_CARD.typography.bottom,
      min: 26,
      max: 38,
      softLimit: 220,
      penalty: 0.18,
      lineHeight: 1.02,
      maxLines: 4,
      maxChars: 260,
      fillTargetMin: 0.84,
      fillTargetMax: 0.92,
      weight: 500,
      letterSpacing: "-0.015em",
      fontStyle: "italic"
    },
    authorName: {
      ...SCIENCE_CARD.typography.authorName,
      weight: 800,
      letterSpacing: "-0.03em"
    },
    authorHandle: {
      ...SCIENCE_CARD.typography.authorHandle,
      weight: 700,
      letterSpacing: "-0.015em"
    }
  },
  palette: {
    cardFill: "#121820",
    topSectionFill: "#121820",
    bottomSectionFill: "#121820",
    topTextColor: "#f7f8fb",
    bottomTextColor: "#f4f6fb",
    authorNameColor: "#f7f8fb",
    authorHandleColor: "#c3c8d1",
    checkBadgeColor: "#f3b31f",
    borderColor: "#f3b31f",
    accentColor: "#f3b31f"
  },
  highlights: createDefaultTemplateHighlightConfig({
    accentColor: "#f3b31f"
  })
} as const;

export const SCIENCE_CARD_V7 = {
  ...SCIENCE_CARD,
  card: {
    ...SCIENCE_CARD.card,
    radius: 0,
    borderWidth: 2,
    borderColor: "#000000",
    fill: "#ffffff",
    shadow:
      "20px 20px 0 rgba(35, 40, 47, 0.52), inset 0 0 0 1px rgba(255,255,255,0.58), inset 0 10px 18px rgba(17, 25, 34, 0.028), inset 0 -12px 18px rgba(17, 25, 34, 0.05)"
  },
  slot: {
    ...SCIENCE_CARD.slot,
    topHeight: SCIENCE_CARD_SECTION_METRICS.topHeight,
    topPaddingX: 8,
    topPaddingY: 8,
    topPaddingTop: 8,
    topPaddingBottom: 4,
    bottomHeight: SCIENCE_CARD_SECTION_METRICS.bottomHeight,
    bottomMetaHeight: SCIENCE_CARD_AUTHOR_METRICS.bottomMetaHeight,
    bottomMetaPaddingX: SCIENCE_CARD_AUTHOR_METRICS.bottomMetaPaddingX,
    bottomMetaPaddingY: SCIENCE_CARD_AUTHOR_METRICS.bottomMetaPaddingY,
    bottomTextPaddingX: SCIENCE_CARD.slot.bottomTextPaddingX,
    bottomTextPaddingY: SCIENCE_CARD.slot.bottomTextPaddingY,
    bottomTextPaddingTop: SCIENCE_CARD.slot.bottomTextPaddingTop,
    bottomTextPaddingBottom: SCIENCE_CARD.slot.bottomTextPaddingBottom,
    bottomTextPaddingLeft: SCIENCE_CARD.slot.bottomTextPaddingLeft,
    bottomTextPaddingRight: SCIENCE_CARD.slot.bottomTextPaddingRight
  },
  author: {
    ...SCIENCE_CARD.author,
    name: "Echoes Of Honor",
    handle: "@EchoesOfHonor50",
    avatarSize: SCIENCE_CARD_AUTHOR_METRICS.avatarSize,
    avatarBorder: 0,
    checkSize: SCIENCE_CARD_AUTHOR_METRICS.checkSize,
    gap: SCIENCE_CARD_AUTHOR_METRICS.gap,
    copyGap: SCIENCE_CARD_AUTHOR_METRICS.copyGap,
    nameCheckGap: 10,
    checkAssetPath: "/stage3-template-badges/honor-verified-badge.svg"
  },
  typography: {
    ...SCIENCE_CARD.typography,
    top: {
      ...SCIENCE_CARD.typography.top,
      min: 50,
      max: 74,
      softLimit: 320,
      penalty: 0.2,
      lineHeight: 0.84,
      maxLines: 7,
      maxChars: 420,
      horizontalSafety: 0.985,
      glyphFactor: 0.54,
      fillTargetMin: 0.97,
      fillTargetMax: 0.995,
      weight: 900,
      letterSpacing: "-0.075em"
    },
    bottom: {
      ...SCIENCE_CARD.typography.bottom,
      min: 24,
      max: 34,
      softLimit: 190,
      penalty: 0.16,
      lineHeight: 1.08,
      maxLines: 4,
      maxChars: 260,
      fillTargetMin: 0.82,
      fillTargetMax: 0.9,
      weight: 500,
      letterSpacing: "-0.04em",
      fontStyle: "normal"
    },
    authorName: {
      ...SCIENCE_CARD.typography.authorName,
      font: SCIENCE_CARD_AUTHOR_METRICS.authorNameFont,
      lineHeight: 1,
      weight: 800,
      letterSpacing: "-0.03em"
    },
    authorHandle: {
      ...SCIENCE_CARD.typography.authorHandle,
      font: SCIENCE_CARD_AUTHOR_METRICS.authorHandleFont,
      lineHeight: 1,
      weight: 300,
      letterSpacing: "-0.022em"
    }
  },
  palette: {
    cardFill: "#ffffff",
    topSectionFill: "#ffffff",
    bottomSectionFill: "#ffffff",
    topTextColor: "#0d0f12",
    bottomTextColor: "#17191d",
    authorNameColor: "#0c0f13",
    authorHandleColor: "#7c8085",
    checkBadgeColor: "#33a9eb",
    borderColor: "#000000",
    accentColor: "#0d0f12"
  }
} as const;

export const HEDGES_OF_HONOR = {
  ...SCIENCE_CARD,
  card: {
    ...SCIENCE_CARD.card,
    radius: 0,
    borderWidth: 2,
    borderColor: "#000000",
    shadow:
      "20px 20px 0 rgba(35, 40, 47, 0.52), inset 0 0 0 1px rgba(10, 14, 20, 0.1), inset 0 0 18px rgba(17, 25, 34, 0.045), inset 0 4px 10px rgba(17, 25, 34, 0.075), inset 0 -7px 14px rgba(17, 25, 34, 0.095)"
  },
  palette: {
    ...SCIENCE_CARD_V7.palette,
    borderColor: "#000000"
  },
  author: {
    ...SCIENCE_CARD_V7.author
  },
  highlights: createDefaultTemplateHighlightConfig({
    accentColor: SCIENCE_CARD_V7.palette.topTextColor
  })
} as const;

export const CHANNEL_STORY = {
  layoutKind: "channel_story",
  frame: { width: 1080, height: 1920 },
  card: {
    x: 14,
    y: 24,
    width: 1052,
    height: 1848,
    radius: 34,
    borderWidth: 6,
    borderColor: "#20df49",
    fill: "#050607",
    shadow: "0 14px 40px rgba(0,0,0,0.45)"
  },
  slot: {
    topHeight: 96,
    bottomHeight: 86,
    topPaddingX: 34,
    topPaddingY: 0,
    topPaddingTop: 0,
    topPaddingBottom: 0,
    bottomMetaHeight: 126,
    bottomMetaPaddingX: 34,
    bottomMetaPaddingY: 0,
    bottomTextPaddingX: 34,
    bottomTextPaddingY: 0,
    bottomTextPaddingTop: 0,
    bottomTextPaddingBottom: 0,
    bottomTextPaddingLeft: 34,
    bottomTextPaddingRight: 34
  },
  author: {
    name: "History Explained",
    handle: "@HistoryExplained13",
    avatarSize: 112,
    avatarBorder: 0,
    checkSize: 58,
    gap: 18,
    copyGap: 2,
    nameCheckGap: 12,
    checkAssetPath: "/stage3-template-badges/science-card-v1-check.png"
  },
  typography: {
    top: {
      min: 34,
      max: 88,
      softLimit: 70,
      penalty: 0.12,
      lineHeight: 0.92,
      maxLines: 2,
      maxChars: 56,
      horizontalSafety: 0.98,
      glyphFactor: 0.51,
      fillTargetMin: 0.84,
      fillTargetMax: 0.95,
      weight: 900,
      letterSpacing: "-0.04em"
    },
    bottom: {
      min: 28,
      max: 56,
      softLimit: 260,
      penalty: 0.14,
      lineHeight: 0.95,
      maxLines: 8,
      maxChars: 360,
      horizontalSafety: 0.985,
      glyphFactor: 0.5,
      fillTargetMin: 0.88,
      fillTargetMax: 0.97,
      weight: 800,
      letterSpacing: "-0.025em",
      fontStyle: "normal"
    },
    authorName: {
      font: 32,
      lineHeight: 0.98,
      weight: 800,
      letterSpacing: "-0.03em"
    },
    authorHandle: {
      font: 24,
      lineHeight: 1,
      weight: 500,
      letterSpacing: "-0.02em"
    }
  },
  palette: {
    cardFill: "#050607",
    topSectionFill: "#050607",
    bottomSectionFill: "#050607",
    topTextColor: "#22ff29",
    bottomTextColor: "#f5f7f8",
    authorNameColor: "#f5f7f8",
    authorHandleColor: "#d4d7dc",
    checkBadgeColor: "#22b8ff",
    borderColor: "#20df49",
    accentColor: "#20df49"
  },
  videoAdjustments: DEFAULT_STAGE3_VIDEO_ADJUSTMENTS,
  highlights: createDefaultTemplateHighlightConfig({
    accentColor: "#f4df36"
  }),
  channelStory: {
    leadMode: "clip_custom",
    defaultLeadText: "Did you know?",
    contentPaddingX: 34,
    contentPaddingTop: 34,
    contentPaddingBottom: 40,
    headerHeight: 118,
    leadHeight: 96,
    bodyHeight: 356,
    headerToLeadGap: 18,
    leadToBodyGap: 14,
    bodyToMediaGap: 28,
    footerHeight: 86,
    mediaInsetX: 10,
    mediaRadius: 30,
    mediaBorderWidth: 0,
    mediaBorderColor: "rgba(255,255,255,0)",
    headerAlign: "left",
    bodyTextAlign: "center",
    accentTopLineWidth: 0,
    accentTopLineColor: "#20df49",
    accentBottomLineWidth: 0,
    accentBottomLineColor: "#20df49"
  }
} as const;

const CLASSIC_SCIENCE_CARD_TEMPLATE_IDS = new Set([
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_BLUE_TEMPLATE_ID,
  SCIENCE_CARD_RED_TEMPLATE_ID,
  SCIENCE_CARD_GREEN_TEMPLATE_ID
]);

export const STAGE3_TEMPLATE_SHELL = {
  x: SHARED_STAGE3_CARD_METRICS.x,
  y: SHARED_STAGE3_CARD_METRICS.y,
  width: SHARED_STAGE3_CARD_METRICS.width,
  height: SHARED_STAGE3_CARD_METRICS.height,
  radius: 30
} as const;

export type Stage3TemplateChannelStoryConfig = {
  leadMode: Stage3TemplateLeadMode;
  defaultLeadText?: string;
  contentPaddingX: number;
  contentPaddingTop: number;
  contentPaddingBottom: number;
  headerHeight: number;
  leadHeight: number;
  bodyHeight: number;
  headerToLeadGap: number;
  leadToBodyGap: number;
  bodyToMediaGap: number;
  footerHeight: number;
  mediaInsetX: number;
  mediaRadius: number;
  mediaBorderWidth: number;
  mediaBorderColor: string;
  headerAlign?: "left" | "center";
  bodyTextAlign?: "left" | "center";
  accentTopLineWidth?: number;
  accentTopLineColor?: string;
  accentBottomLineWidth?: number;
  accentBottomLineColor?: string;
};

export type Stage3CardInnerRect = {
  inset: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Stage3TemplateConfig = {
  layoutKind: Stage3TemplateLayoutKind;
  frame: { width: number; height: number };
  card: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    borderWidth: number;
    borderColor: string;
    fill: string;
    shadow?: string;
  };
  slot: {
    topHeight: number;
    bottomHeight: number;
    topPaddingX: number;
    topPaddingY: number;
    topPaddingTop?: number;
    topPaddingBottom?: number;
    bottomMetaHeight: number;
    bottomMetaPaddingX: number;
    bottomMetaPaddingY: number;
    bottomTextPaddingX: number;
    bottomTextPaddingY: number;
    bottomTextPaddingTop?: number;
    bottomTextPaddingBottom?: number;
    bottomTextPaddingLeft?: number;
    bottomTextPaddingRight?: number;
  };
  author: {
    name: string;
    handle: string;
    avatarSize: number;
    avatarBorder: number;
    checkSize: number;
    gap?: number;
    copyGap?: number;
    nameCheckGap?: number;
    checkAssetPath?: string;
  };
  typography: {
    top: {
      min: number;
      max: number;
      softLimit: number;
      penalty: number;
      lineHeight: number;
      maxLines: number;
      maxChars: number;
      horizontalSafety?: number;
      glyphFactor?: number;
      fillTargetMin?: number;
      fillTargetMax?: number;
      weight?: number;
      letterSpacing?: string;
      fontStyle?: "normal" | "italic";
      fontFamily?: string;
    };
    bottom: {
      min: number;
      max: number;
      softLimit: number;
      penalty: number;
      lineHeight: number;
      maxLines: number;
      maxChars: number;
      horizontalSafety?: number;
      glyphFactor?: number;
      fillTargetMin?: number;
      fillTargetMax?: number;
      weight?: number;
      letterSpacing?: string;
      fontStyle?: "normal" | "italic";
      fontFamily?: string;
    };
    authorName: {
      font: number;
      lineHeight: number;
      weight?: number;
      letterSpacing?: string;
      fontFamily?: string;
    };
    authorHandle: {
      font: number;
      lineHeight: number;
      weight?: number;
      letterSpacing?: string;
      fontFamily?: string;
    };
  };
  palette: {
    cardFill: string;
    topSectionFill: string;
    bottomSectionFill: string;
    topTextColor: string;
    bottomTextColor: string;
    authorNameColor: string;
    authorHandleColor: string;
    checkBadgeColor: string;
    borderColor: string;
    accentColor?: string;
  };
  videoAdjustments: Stage3VideoAdjustments;
  highlights: TemplateHighlightConfig;
  channelStory?: Stage3TemplateChannelStoryConfig;
};

export function getStage3CardInnerRect(
  templateConfig: Pick<Stage3TemplateConfig, "card">
): Stage3CardInnerRect {
  const inset = Math.max(0, Math.round(templateConfig.card.borderWidth));
  return {
    inset,
    x: templateConfig.card.x + inset,
    y: templateConfig.card.y + inset,
    width: Math.max(0, templateConfig.card.width - inset * 2),
    height: Math.max(0, templateConfig.card.height - inset * 2)
  };
}

export function cloneStage3TemplateConfig(config: Stage3TemplateConfig): Stage3TemplateConfig {
  return {
    layoutKind: config.layoutKind,
    frame: { ...config.frame },
    card: { ...config.card },
    slot: { ...config.slot },
    author: { ...config.author },
    typography: {
      top: { ...config.typography.top },
      bottom: { ...config.typography.bottom },
      authorName: { ...config.typography.authorName },
      authorHandle: { ...config.typography.authorHandle }
    },
    palette: { ...config.palette },
    videoAdjustments: cloneStage3VideoAdjustments(config.videoAdjustments),
    highlights: cloneTemplateHighlightConfig(config.highlights),
    channelStory: config.channelStory ? { ...config.channelStory } : undefined
  };
}

type TypographyConfig = {
  min: number;
  max: number;
  lineHeight: number;
  maxLines: number;
  maxChars: number;
  horizontalSafety?: number;
  glyphFactor?: number;
  fillTargetMin?: number;
  fillTargetMax?: number;
};

type SlotSize = {
  width: number;
  height: number;
};

type FontScaleOverrides = {
  topFontScale?: number;
  bottomFontScale?: number;
};

export type Stage3TemplateComputed = {
  layoutKind: Stage3TemplateLayoutKind;
  top: string;
  bottom: string;
  topFont: number;
  bottomFont: number;
  topLineHeight: number;
  bottomLineHeight: number;
  topLines: number;
  bottomLines: number;
  topCompacted: boolean;
  bottomCompacted: boolean;
  videoHeight: number;
  bottomMetaHeight: number;
  bottomBodyHeight: number;
  topBlockHeight: number;
  bottomBlockHeight: number;
  videoY: number;
  videoX: number;
  videoWidth: number;
  topY?: number;
  bottomTextY?: number;
  headerY?: number;
  mediaRadius?: number;
  mediaBorderWidth?: number;
  mediaBorderColor?: string;
  leadVisible?: boolean;
};

function getBottomTextPaddingTop(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingTop ?? template.slot.bottomTextPaddingY;
}

function getBottomTextPaddingBottom(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingBottom ?? template.slot.bottomTextPaddingY;
}

function getTopPaddingTop(template: Stage3TemplateConfig): number {
  return template.slot.topPaddingTop ?? template.slot.topPaddingY;
}

function getTopPaddingBottom(template: Stage3TemplateConfig): number {
  return template.slot.topPaddingBottom ?? template.slot.topPaddingY;
}

function getBottomTextPaddingLeft(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingLeft ?? template.slot.bottomTextPaddingX;
}

function getBottomTextPaddingRight(template: Stage3TemplateConfig): number {
  return template.slot.bottomTextPaddingRight ?? template.slot.bottomTextPaddingX;
}

function getSectionBorderLosses(template: Stage3TemplateConfig): {
  topWidth: number;
  topHeight: number;
  bottomWidth: number;
  bottomHeight: number;
} {
  if (
    template === SCIENCE_CARD ||
    template === SCIENCE_CARD_BLUE ||
    template === SCIENCE_CARD_RED ||
    template === SCIENCE_CARD_GREEN
  ) {
    return {
      topWidth: template.card.borderWidth * 2,
      topHeight: template.card.borderWidth,
      bottomWidth: template.card.borderWidth * 2,
      bottomHeight: template.card.borderWidth
    };
  }
  return {
    topWidth: 0,
    topHeight: 0,
    bottomWidth: 0,
    bottomHeight: 0
  };
}

const DEFAULT_AVERAGE_GLYPH_FACTOR = 0.56;
const DEFAULT_HORIZONTAL_SAFETY = 0.92;
const VERTICAL_SAFETY = 0.995;
const MIN_FONT_FALLBACK_RATIO = 0.58;
const FILLER_WORDS = new Set([
  "really",
  "very",
  "quite",
  "basically",
  "actually",
  "just",
  "literally"
]);

export function resolveScaledMaxLines(baseMaxLines: number, scale: number, slot: "top" | "bottom"): number {
  if (!Number.isFinite(scale) || scale <= 1.05) {
    return baseMaxLines;
  }
  if (slot === "bottom") {
    if (scale >= 1.6) {
      return baseMaxLines + 2;
    }
    if (scale >= 1.22) {
      return baseMaxLines + 1;
    }
  }
  return baseMaxLines;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeFontScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return clampStage3TextScaleUi(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s([,.:;!?])/g, "$1").trim();
}

function getSafeMinimumFont(config: TypographyConfig): number {
  return Math.max(14, Math.floor(config.min * MIN_FONT_FALLBACK_RATIO));
}

function resolveGlyphFactor(config: TypographyConfig): number {
  return clampNumber(config.glyphFactor ?? DEFAULT_AVERAGE_GLYPH_FACTOR, 0.45, 0.7);
}

function resolveHorizontalSafety(config: TypographyConfig): number {
  return clampNumber(config.horizontalSafety ?? DEFAULT_HORIZONTAL_SAFETY, 0.86, 1);
}

function estimateLineCount(
  text: string,
  fontPx: number,
  widthPx: number,
  config: TypographyConfig
): number {
  const normalized = normalizeText(text);
  if (!normalized) {
    return 1;
  }
  const horizontalSafety = resolveHorizontalSafety(config);
  const glyphFactor = resolveGlyphFactor(config);

  const maxCharsPerLine = Math.max(
    3,
    Math.floor((widthPx * horizontalSafety) / Math.max(1, fontPx * glyphFactor))
  );
  const words = normalized.split(" ");
  let lines = 1;
  let currentLen = 0;

  for (const word of words) {
    const len = word.length;
    if (len > maxCharsPerLine) {
      const chunkLines = Math.ceil(len / maxCharsPerLine);
      if (currentLen > 0) {
        lines += 1;
        currentLen = 0;
      }
      lines += chunkLines - 1;
      currentLen = len % maxCharsPerLine;
      continue;
    }

    const nextLen = currentLen === 0 ? len : currentLen + 1 + len;
    if (nextLen <= maxCharsPerLine) {
      currentLen = nextLen;
      continue;
    }

    lines += 1;
    currentLen = len;
  }

  return lines;
}

function findBestFontForSlot(
  text: string,
  slot: SlotSize,
  config: TypographyConfig
): { font: number; lines: number; fits: boolean } {
  const minFont = ceilStage3TextFontPx(getSafeMinimumFont(config));
  const maxFont = snapStage3TextFontPx(config.max);
  let fallbackFont = minFont;
  let fallbackLines = estimateLineCount(text, fallbackFont, slot.width, config);

  for (
    let font = maxFont;
    font >= minFont - 0.0001;
    font = snapStage3TextFontPx(font - STAGE3_TEXT_FONT_STEP_PX)
  ) {
    const lines = estimateLineCount(text, font, slot.width, config);
    const contentHeight = lines * font * config.lineHeight;
    if (lines <= config.maxLines && contentHeight <= slot.height * VERTICAL_SAFETY) {
      return { font, lines, fits: true };
    }

    if (lines < fallbackLines || (lines === fallbackLines && font > fallbackFont)) {
      fallbackFont = font;
      fallbackLines = lines;
    }
  }

  return { font: fallbackFont, lines: fallbackLines, fits: false };
}

function applyFontScaleWithSafety(params: {
  text: string;
  baseFont: number;
  slot: SlotSize;
  config: TypographyConfig;
  scale: number;
}): { font: number; lines: number; lineHeight: number } {
  const normalizedScale = normalizeFontScale(params.scale);
  const minFont = ceilStage3TextFontPx(getSafeMinimumFont(params.config));
  const scaledBaseFont = clampNumber(
    snapStage3TextFontPx(params.baseFont * normalizedScale),
    minFont,
    Math.max(
      params.config.max,
      snapStage3TextFontPx(params.config.max * Math.max(1, normalizedScale))
    )
  );
  const maxFont = normalizedScale < 1
    ? scaledBaseFont
    : Math.max(
        snapStage3TextFontPx(params.config.max),
        snapStage3TextFontPx(params.config.max * Math.max(1, normalizedScale))
      );
  const minLineHeight = clampNumber(params.config.lineHeight * 0.82, 0.82, params.config.lineHeight);
  const maxHeight = params.slot.height * VERTICAL_SAFETY;
  let font = scaledBaseFont;
  let effectiveLineHeight = params.config.lineHeight;
  let lines = estimateLineCount(params.text, font, params.slot.width, params.config);
  let contentHeight = lines * font * effectiveLineHeight;

  while (
    font > minFont &&
    (lines > params.config.maxLines || contentHeight > params.slot.height * VERTICAL_SAFETY)
  ) {
    if (lines <= params.config.maxLines && contentHeight > maxHeight && effectiveLineHeight > minLineHeight) {
      effectiveLineHeight = Math.max(
        minLineHeight,
        Number((effectiveLineHeight - 0.02).toFixed(3))
      );
      contentHeight = lines * font * effectiveLineHeight;
      continue;
    }

    const nextFont = snapStage3TextFontPx(font - STAGE3_TEXT_FONT_STEP_PX);
    if (nextFont >= font) {
      break;
    }
    font = nextFont;
    effectiveLineHeight = params.config.lineHeight;
    lines = estimateLineCount(params.text, font, params.slot.width, params.config);
    contentHeight = lines * font * effectiveLineHeight;
  }

  const fillTargetMin =
    normalizedScale < 1
      ? clampNumber((params.config.fillTargetMin ?? 0) * normalizedScale, 0, VERTICAL_SAFETY)
      : clampNumber(params.config.fillTargetMin ?? 0, 0, VERTICAL_SAFETY);
  if (fillTargetMin > 0) {
    const targetContentHeight = params.slot.height * fillTargetMin;
    const maxLineHeight = Math.min(1.35, Math.max(params.config.lineHeight, params.config.lineHeight + 0.18));
    let growIterations = 0;

    while (contentHeight < targetContentHeight && growIterations < 64) {
      growIterations += 1;
      let expanded = false;

      if (font < maxFont) {
        const candidateFont = Math.min(maxFont, snapStage3TextFontPx(font + STAGE3_TEXT_FONT_STEP_PX));
        const candidateLines = estimateLineCount(params.text, candidateFont, params.slot.width, params.config);
        const candidateHeight = candidateLines * candidateFont * effectiveLineHeight;
        if (
          candidateFont > font &&
          candidateLines <= params.config.maxLines &&
          candidateHeight <= maxHeight
        ) {
          font = candidateFont;
          lines = candidateLines;
          contentHeight = candidateHeight;
          expanded = true;
        }
      }

      if (!expanded && effectiveLineHeight < maxLineHeight) {
        const candidateLineHeight = Number(Math.min(maxLineHeight, effectiveLineHeight + 0.01).toFixed(3));
        const candidateHeight = lines * font * candidateLineHeight;
        if (candidateHeight <= maxHeight) {
          effectiveLineHeight = candidateLineHeight;
          contentHeight = candidateHeight;
          expanded = true;
        }
      }

      if (!expanded) {
        break;
      }
    }
  }

  return { font, lines, lineHeight: Number(effectiveLineHeight.toFixed(3)) };
}

function compactText(value: string, targetChars: number): string {
  let text = normalizeText(value);
  if (!text) {
    return text;
  }

  text = text.replace(/\([^)]*\)/g, " ");
  text = text.replace(/\[[^\]]*]/g, " ");
  text = normalizeText(text);

  const withoutFillers = text
    .split(" ")
    .filter((word) => !FILLER_WORDS.has(word.toLowerCase()))
    .join(" ");
  text = normalizeText(withoutFillers || text);

  if (text.length <= targetChars) {
    return text;
  }

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  if (sentences.length > 1) {
    let summary = "";
    for (const sentence of sentences) {
      const candidate = summary ? `${summary} ${sentence}` : sentence;
      if (candidate.length > targetChars) {
        break;
      }
      summary = candidate;
    }
    if (summary && summary.length >= Math.min(40, targetChars)) {
      return summary;
    }
  }

  const words = text.split(" ");
  while (words.length > 5 && words.join(" ").length > targetChars) {
    words.pop();
  }
  return normalizeText(words.join(" "));
}

function optimizeTextForSlot(
  value: string,
  slot: SlotSize,
  config: TypographyConfig,
  fallbackText: string
): { text: string; font: number; lines: number; compacted: boolean } {
  let candidate = normalizeText(value || fallbackText);
  if (!candidate) {
    candidate = fallbackText;
  }

  let compacted = false;
  const horizontalSafety = resolveHorizontalSafety(config);
  const glyphFactor = resolveGlyphFactor(config);
  const minCapacity = Math.max(
    24,
    Math.floor((slot.width * horizontalSafety) / Math.max(1, config.min * glyphFactor) * config.maxLines * 0.92)
  );

  const directFit = findBestFontForSlot(candidate, slot, config);
  if (directFit.fits) {
    return { text: candidate, font: directFit.font, lines: directFit.lines, compacted };
  }

  const shouldCompactAsLastResort = candidate.length > Math.max(config.maxChars * 2, minCapacity * 1.6);
  if (!shouldCompactAsLastResort) {
    const fallback = findBestFontForSlot(candidate, slot, config);
    return { text: candidate, font: fallback.font, lines: fallback.lines, compacted };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const fit = findBestFontForSlot(candidate, slot, config);
    if (fit.fits) {
      return { text: candidate, font: fit.font, lines: fit.lines, compacted };
    }

    const targetChars = Math.max(24, Math.min(config.maxChars, minCapacity - attempt * 10));
    const next = compactText(candidate, targetChars);
    if (next === candidate) {
      return { text: candidate, font: fit.font, lines: fit.lines, compacted };
    }
    candidate = next;
    compacted = true;
  }

  const fallback = findBestFontForSlot(candidate, slot, config);
  return { text: candidate, font: fallback.font, lines: fallback.lines, compacted };
}

export function clampText(value: string, maxChars: number): string {
  if (!value) {
    return "";
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1)}...`;
}

export function getScienceCardComputed(
  topText: string,
  bottomText: string,
  fontOverrides?: FontScaleOverrides,
  templateConfig: Stage3TemplateConfig = SCIENCE_CARD
): Stage3TemplateComputed {
  const topScale = normalizeFontScale(fontOverrides?.topFontScale);
  const bottomScale = normalizeFontScale(fontOverrides?.bottomFontScale);
  const topTypography = {
    ...templateConfig.typography.top,
    maxLines: resolveScaledMaxLines(templateConfig.typography.top.maxLines, topScale, "top")
  };
  const bottomTypography = {
    ...templateConfig.typography.bottom,
    maxLines: resolveScaledMaxLines(templateConfig.typography.bottom.maxLines, bottomScale, "bottom")
  };
  const topPaddingTop = getTopPaddingTop(templateConfig);
  const topPaddingBottom = getTopPaddingBottom(templateConfig);
  const topBlockHeight = templateConfig.slot.topHeight;
  const bottomBlockHeight = templateConfig.slot.bottomHeight;
  const bottomMetaHeight = templateConfig.slot.bottomMetaHeight;
  const sectionBorderLosses = getSectionBorderLosses(templateConfig);
  const bottomBodyHeight = Math.max(80, bottomBlockHeight - sectionBorderLosses.bottomHeight - bottomMetaHeight);

  const topSlot: SlotSize = {
    width: templateConfig.card.width - sectionBorderLosses.topWidth - templateConfig.slot.topPaddingX * 2,
    height: topBlockHeight - sectionBorderLosses.topHeight - topPaddingTop - topPaddingBottom
  };
  const bottomTextPaddingTop = getBottomTextPaddingTop(templateConfig);
  const bottomTextPaddingBottom = getBottomTextPaddingBottom(templateConfig);
  const bottomTextPaddingLeft = getBottomTextPaddingLeft(templateConfig);
  const bottomTextPaddingRight = getBottomTextPaddingRight(templateConfig);
  const bottomSlot: SlotSize = {
    width: templateConfig.card.width - sectionBorderLosses.bottomWidth - bottomTextPaddingLeft - bottomTextPaddingRight,
    height: bottomBodyHeight - bottomTextPaddingTop - bottomTextPaddingBottom
  };

  const topFit = optimizeTextForSlot(topText, topSlot, topTypography, "Top text");
  const topSized = applyFontScaleWithSafety({
    text: topFit.text,
    baseFont: topFit.font,
    slot: topSlot,
    config: topTypography,
    scale: topScale
  });
  const bottomFit = optimizeTextForSlot(
    bottomText,
    bottomSlot,
    bottomTypography,
    "Bottom text"
  );
  const bottomSized = applyFontScaleWithSafety({
    text: bottomFit.text,
    baseFont: bottomFit.font,
    slot: bottomSlot,
    config: bottomTypography,
    scale: bottomScale
  });
  const videoHeight = templateConfig.card.height - topBlockHeight - bottomBlockHeight;

  return {
    layoutKind: "classic_top_bottom",
    top: topFit.text,
    bottom: bottomFit.text,
    topFont: topSized.font,
    bottomFont: bottomSized.font,
    topLineHeight: topSized.lineHeight,
    bottomLineHeight: bottomSized.lineHeight,
    topLines: topSized.lines,
    bottomLines: bottomSized.lines,
    topCompacted: topFit.compacted,
    bottomCompacted: bottomFit.compacted,
    videoHeight,
    bottomMetaHeight,
    bottomBodyHeight,
    topBlockHeight,
    bottomBlockHeight,
    videoY: templateConfig.card.y + topBlockHeight,
    videoX: templateConfig.card.x,
    videoWidth: templateConfig.card.width
  };
}

export function getChannelStoryComputed(
  topText: string,
  bottomText: string,
  fontOverrides?: FontScaleOverrides,
  templateConfig: Stage3TemplateConfig = CHANNEL_STORY
): Stage3TemplateComputed {
  const topScale = normalizeFontScale(fontOverrides?.topFontScale);
  const bottomScale = normalizeFontScale(fontOverrides?.bottomFontScale);
  const channelStory = templateConfig.channelStory ?? CHANNEL_STORY.channelStory!;
  const cardInnerRect = getStage3CardInnerRect(templateConfig);
  const contentWidth = Math.max(120, cardInnerRect.width - channelStory.contentPaddingX * 2);
  const leadVisible = topText.trim().length > 0 && channelStory.leadMode !== "off";
  const topTypography = {
    ...templateConfig.typography.top,
    maxLines: resolveScaledMaxLines(templateConfig.typography.top.maxLines, topScale, "top")
  };
  const bottomTypography = {
    ...templateConfig.typography.bottom,
    maxLines: resolveScaledMaxLines(templateConfig.typography.bottom.maxLines, bottomScale, "bottom")
  };
  const leadSlot: SlotSize = {
    width: contentWidth,
    height: leadVisible ? Math.max(1, channelStory.leadHeight) : 1
  };
  const bodySlot: SlotSize = {
    width: contentWidth,
    height: Math.max(1, channelStory.bodyHeight)
  };
  const headerY = cardInnerRect.y + channelStory.contentPaddingTop;
  const leadY = headerY + channelStory.headerHeight + channelStory.headerToLeadGap;
  const bodyY = leadVisible
    ? leadY + channelStory.leadHeight + channelStory.leadToBodyGap
    : headerY + channelStory.headerHeight + Math.max(channelStory.headerToLeadGap, 12);
  const topFit = leadVisible
    ? optimizeTextForSlot(topText, leadSlot, topTypography, "Lead text")
    : {
        text: "",
        font: ceilStage3TextFontPx(templateConfig.typography.top.min),
        lines: 0,
        compacted: false
      };
  const topSized = leadVisible
    ? applyFontScaleWithSafety({
        text: topFit.text,
        baseFont: topFit.font,
        slot: leadSlot,
        config: topTypography,
        scale: topScale
      })
    : {
        font: ceilStage3TextFontPx(templateConfig.typography.top.min),
        lines: 0,
        lineHeight: Number(templateConfig.typography.top.lineHeight.toFixed(3))
      };
  const bottomFit = optimizeTextForSlot(bottomText, bodySlot, bottomTypography, "Body text");
  const bottomSized = applyFontScaleWithSafety({
    text: bottomFit.text,
    baseFont: bottomFit.font,
    slot: bodySlot,
    config: bottomTypography,
    scale: bottomScale
  });
  const topContentHeight =
    bodyY + channelStory.bodyHeight + channelStory.bodyToMediaGap - cardInnerRect.y;
  const bottomContentHeight = channelStory.footerHeight + channelStory.contentPaddingBottom;
  const topBlockHeight = cardInnerRect.inset + topContentHeight;
  const bottomBlockHeight = cardInnerRect.inset + bottomContentHeight;
  const videoX = cardInnerRect.x + channelStory.mediaInsetX;
  const videoWidth = Math.max(120, cardInnerRect.width - channelStory.mediaInsetX * 2);
  const videoHeight = Math.max(120, cardInnerRect.height - topContentHeight - bottomContentHeight);

  return {
    layoutKind: "channel_story",
    top: topFit.text,
    bottom: bottomFit.text,
    topFont: topSized.font,
    bottomFont: bottomSized.font,
    topLineHeight: topSized.lineHeight,
    bottomLineHeight: bottomSized.lineHeight,
    topLines: topSized.lines,
    bottomLines: bottomSized.lines,
    topCompacted: topFit.compacted,
    bottomCompacted: bottomFit.compacted,
    videoHeight,
    bottomMetaHeight: channelStory.headerHeight,
    bottomBodyHeight: channelStory.bodyHeight,
    topBlockHeight,
    bottomBlockHeight,
    videoY: cardInnerRect.y + topContentHeight,
    videoX,
    videoWidth,
    topY: leadY,
    bottomTextY: bodyY,
    headerY,
    mediaRadius: channelStory.mediaRadius,
    mediaBorderWidth: channelStory.mediaBorderWidth,
    mediaBorderColor: channelStory.mediaBorderColor,
    leadVisible
  };
}

export function getTemplateComputed(
  templateId: string,
  topText: string,
  bottomText: string,
  fontOverrides?: FontScaleOverrides
): Stage3TemplateComputed {
  if (templateId === CHANNEL_STORY_TEMPLATE_ID) {
    return getChannelStoryComputed(topText, bottomText, fontOverrides, CHANNEL_STORY);
  }
  if (templateId === AMERICAN_NEWS_TEMPLATE_ID) {
    return getScienceCardComputed(topText, bottomText, fontOverrides, AMERICAN_NEWS);
  }
  if (templateId === SCIENCE_CARD_BLUE_TEMPLATE_ID) {
    return getScienceCardComputed(topText, bottomText, fontOverrides, SCIENCE_CARD_BLUE);
  }
  if (templateId === SCIENCE_CARD_RED_TEMPLATE_ID) {
    return getScienceCardComputed(topText, bottomText, fontOverrides, SCIENCE_CARD_RED);
  }
  if (templateId === SCIENCE_CARD_GREEN_TEMPLATE_ID) {
    return getScienceCardComputed(topText, bottomText, fontOverrides, SCIENCE_CARD_GREEN);
  }
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID) {
    return getScienceCardComputed(topText, bottomText, fontOverrides, SCIENCE_CARD_V7);
  }
  if (templateId === HEDGES_OF_HONOR_TEMPLATE_ID) {
    return getScienceCardComputed(topText, bottomText, fontOverrides, HEDGES_OF_HONOR);
  }
  return getScienceCardComputed(topText, bottomText, fontOverrides, SCIENCE_CARD);
}

export function getTemplateComputedForConfig(
  topText: string,
  bottomText: string,
  fontOverrides: FontScaleOverrides | undefined,
  templateConfig: Stage3TemplateConfig
): Stage3TemplateComputed {
  if (templateConfig.layoutKind === "channel_story") {
    return getChannelStoryComputed(topText, bottomText, fontOverrides, templateConfig);
  }
  return getScienceCardComputed(topText, bottomText, fontOverrides, templateConfig);
}

export function getTemplateById(templateId: string): Stage3TemplateConfig {
  if (templateId === CHANNEL_STORY_TEMPLATE_ID) {
    return CHANNEL_STORY;
  }
  if (templateId === AMERICAN_NEWS_TEMPLATE_ID) {
    return AMERICAN_NEWS;
  }
  if (templateId === SCIENCE_CARD_BLUE_TEMPLATE_ID) {
    return SCIENCE_CARD_BLUE;
  }
  if (templateId === SCIENCE_CARD_RED_TEMPLATE_ID) {
    return SCIENCE_CARD_RED;
  }
  if (templateId === SCIENCE_CARD_GREEN_TEMPLATE_ID) {
    return SCIENCE_CARD_GREEN;
  }
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID) {
    return SCIENCE_CARD_V7;
  }
  if (templateId === HEDGES_OF_HONOR_TEMPLATE_ID) {
    return HEDGES_OF_HONOR;
  }
  return SCIENCE_CARD;
}

export function templateUsesBuiltInBackdrop(templateId: string | null | undefined): boolean {
  return templateId === SCIENCE_CARD_V7_TEMPLATE_ID || templateId === HEDGES_OF_HONOR_TEMPLATE_ID;
}

export function isClassicScienceCardTemplateId(templateId: string | null | undefined): boolean {
  const candidate = templateId?.trim();
  return candidate ? CLASSIC_SCIENCE_CARD_TEMPLATE_IDS.has(candidate) : false;
}

export function isChannelStoryTemplateId(templateId: string | null | undefined): boolean {
  return templateId?.trim() === CHANNEL_STORY_TEMPLATE_ID;
}
