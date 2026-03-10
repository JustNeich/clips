export const SCIENCE_CARD_TEMPLATE_ID = "science-card-v1";
export const TURBO_FACE_TEMPLATE_ID = "turbo-face-v1";
export const STAGE3_TEMPLATE_ID = SCIENCE_CARD_TEMPLATE_ID;

export const SCIENCE_CARD = {
  frame: { width: 1080, height: 1920 },
  card: {
    x: 78,
    y: 198,
    width: 924,
    height: 1458,
    radius: 30,
    borderWidth: 8,
    borderColor: "#0a1119",
    fill: "#f9fafc"
  },
  slot: {
    topHeight: 392,
    bottomHeight: 322,
    topPaddingX: 8,
    topPaddingY: 5,
    topPaddingTop: 3,
    topPaddingBottom: 8,
    bottomMetaHeight: 118,
    bottomMetaPaddingX: 22,
    bottomMetaPaddingY: 8,
    bottomTextPaddingX: 14,
    bottomTextPaddingY: 0,
    bottomTextPaddingTop: 7,
    bottomTextPaddingBottom: 1,
    bottomTextPaddingLeft: 18,
    bottomTextPaddingRight: 12
  },
  author: {
    name: "Science Snack",
    handle: "@Science_Snack_1",
    avatarSize: 96,
    avatarBorder: 3,
    checkSize: 30
  },
  typography: {
    top: {
      min: 38,
      max: 68,
      softLimit: 128,
      penalty: 0.22,
      lineHeight: 1.05,
      maxLines: 7,
      maxChars: 460
    },
    bottom: {
      min: 24,
      max: 38,
      softLimit: 110,
      penalty: 0.24,
      lineHeight: 1.12,
      maxLines: 4,
      maxChars: 390
    },
    authorName: {
      font: 40,
      lineHeight: 1.04
    },
    authorHandle: {
      font: 36,
      lineHeight: 1.02
    }
  }
} as const;

export const TURBO_FACE = {
  frame: { width: 1080, height: 1920 },
  top: {
    x: 84,
    y: 152,
    width: 912,
    radius: 30,
    paddingX: 38,
    paddingY: 26,
    minHeight: 240,
    maxHeight: 500
  },
  video: {
    x: 84,
    minHeight: 760
  },
  bottom: {
    x: 84,
    bottom: 168,
    width: 912,
    radius: 30,
    paddingX: 28,
    paddingY: 20,
    metaHeight: 100,
    metaGap: 14,
    minHeight: 248,
    maxHeight: 392
  },
  author: {
    name: "Stone Face Turbo",
    handle: "@StoneFaceTurbo",
    avatarSize: 74,
    avatarBorder: 2,
    checkSize: 24
  },
  typography: {
    top: {
      min: 44,
      max: 66,
      softLimit: 220,
      penalty: 0.17,
      lineHeight: 1.03,
      maxLines: 7,
      maxChars: 500
    },
    bottom: {
      min: 22,
      max: 32,
      softLimit: 165,
      penalty: 0.18,
      lineHeight: 1.18,
      maxLines: 5,
      maxChars: 340
    },
    authorName: {
      font: 33,
      lineHeight: 1.05
    },
    authorHandle: {
      font: 23,
      lineHeight: 1.05
    }
  }
} as const;

const TURBO_FACE_COMPAT = {
  frame: TURBO_FACE.frame,
  card: {
    x: 84,
    y: 152,
    width: 912,
    height: 1600,
    radius: 30,
    borderWidth: 2,
    borderColor: "#0a1119",
    fill: "#fbfbf8"
  },
  slot: {
    topHeight: 420,
    bottomHeight: 312,
    topPaddingX: 38,
    topPaddingY: 26,
    bottomMetaHeight: 110,
    bottomMetaPaddingX: 28,
    bottomMetaPaddingY: 18,
    bottomTextPaddingX: 28,
    bottomTextPaddingY: 12,
    bottomTextPaddingTop: 10,
    bottomTextPaddingBottom: 14
  },
  author: TURBO_FACE.author,
  typography: TURBO_FACE.typography
} as const;

export type Stage3TemplateConfig = {
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
    };
    bottom: {
      min: number;
      max: number;
      softLimit: number;
      penalty: number;
      lineHeight: number;
      maxLines: number;
      maxChars: number;
    };
    authorName: {
      font: number;
      lineHeight: number;
    };
    authorHandle: {
      font: number;
      lineHeight: number;
    };
  };
};

type TypographyConfig = {
  min: number;
  max: number;
  lineHeight: number;
  maxLines: number;
  maxChars: number;
};

type SlotSize = {
  width: number;
  height: number;
};

type FontScaleOverrides = {
  topFontScale?: number;
  bottomFontScale?: number;
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

const AVERAGE_GLYPH_FACTOR = 0.56;
const HORIZONTAL_SAFETY = 0.96;
const VERTICAL_SAFETY = 0.995;
const FONT_SCALE_MIN = 0.7;
const FONT_SCALE_MAX = 1.9;
const FILLER_WORDS = new Set([
  "really",
  "very",
  "quite",
  "basically",
  "actually",
  "just",
  "literally"
]);

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeFontScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return clampNumber(value, FONT_SCALE_MIN, FONT_SCALE_MAX);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s([,.:;!?])/g, "$1").trim();
}

function estimateLineCount(text: string, fontPx: number, widthPx: number): number {
  const normalized = normalizeText(text);
  if (!normalized) {
    return 1;
  }

  const maxCharsPerLine = Math.max(
    3,
    Math.floor((widthPx * HORIZONTAL_SAFETY) / Math.max(1, fontPx * AVERAGE_GLYPH_FACTOR))
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
  let fallbackFont = config.min;
  let fallbackLines = estimateLineCount(text, fallbackFont, slot.width);

  for (let font = config.max; font >= config.min; font -= 1) {
    const lines = estimateLineCount(text, font, slot.width);
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
  const minFont = Math.max(16, Math.floor(params.config.min * 0.7));
  const maxFont = Math.max(
    params.config.max,
    Math.round(params.config.max * Math.max(1, normalizedScale))
  );
  const minLineHeight = clampNumber(params.config.lineHeight * 0.82, 0.82, params.config.lineHeight);
  const maxHeight = params.slot.height * VERTICAL_SAFETY;
  let font = clampNumber(Math.round(params.baseFont * normalizedScale), minFont, maxFont);
  let effectiveLineHeight = params.config.lineHeight;
  let lines = estimateLineCount(params.text, font, params.slot.width);
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

    font -= 1;
    effectiveLineHeight = params.config.lineHeight;
    lines = estimateLineCount(params.text, font, params.slot.width);
    contentHeight = lines * font * effectiveLineHeight;
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
  if (candidate.length > config.maxChars) {
    candidate = compactText(candidate, config.maxChars);
    compacted = true;
  }

  const minCapacity = Math.max(
    24,
    Math.floor((slot.width / Math.max(1, config.min * AVERAGE_GLYPH_FACTOR)) * config.maxLines * 0.92)
  );

  for (let attempt = 0; attempt < 8; attempt += 1) {
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
  fontOverrides?: FontScaleOverrides
): {
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
  bottomBodyHeight: number;
  topBlockHeight: number;
  bottomBlockHeight: number;
  videoY: number;
  videoX: number;
  videoWidth: number;
} {
  const topScale = normalizeFontScale(fontOverrides?.topFontScale);
  const bottomScale = normalizeFontScale(fontOverrides?.bottomFontScale);
  const topPaddingTop = getTopPaddingTop(SCIENCE_CARD);
  const topPaddingBottom = getTopPaddingBottom(SCIENCE_CARD);

  const topSlot: SlotSize = {
    width: SCIENCE_CARD.card.width - SCIENCE_CARD.slot.topPaddingX * 2,
    height: SCIENCE_CARD.slot.topHeight - topPaddingTop - topPaddingBottom
  };
  const bottomBodyHeightLimit = Math.max(
    80,
    SCIENCE_CARD.slot.bottomHeight - SCIENCE_CARD.slot.bottomMetaHeight
  );
  const bottomTextPaddingTop = getBottomTextPaddingTop(SCIENCE_CARD);
  const bottomTextPaddingBottom = getBottomTextPaddingBottom(SCIENCE_CARD);
  const bottomTextPaddingLeft = getBottomTextPaddingLeft(SCIENCE_CARD);
  const bottomTextPaddingRight = getBottomTextPaddingRight(SCIENCE_CARD);
  const bottomSlot: SlotSize = {
    width: SCIENCE_CARD.card.width - bottomTextPaddingLeft - bottomTextPaddingRight,
    height: bottomBodyHeightLimit - bottomTextPaddingTop - bottomTextPaddingBottom
  };

  const topFit = optimizeTextForSlot(topText, topSlot, SCIENCE_CARD.typography.top, "Top text");
  const topSized = applyFontScaleWithSafety({
    text: topFit.text,
    baseFont: topFit.font,
    slot: topSlot,
    config: SCIENCE_CARD.typography.top,
    scale: topScale
  });
  const bottomFit = optimizeTextForSlot(
    bottomText,
    bottomSlot,
    SCIENCE_CARD.typography.bottom,
    "Bottom text"
  );
  const bottomSized = applyFontScaleWithSafety({
    text: bottomFit.text,
    baseFont: bottomFit.font,
    slot: bottomSlot,
    config: SCIENCE_CARD.typography.bottom,
    scale: bottomScale
  });
  const bottomBodyHeight = bottomBodyHeightLimit;
  const topBlockHeight = SCIENCE_CARD.slot.topHeight;
  const bottomBlockHeight = SCIENCE_CARD.slot.bottomHeight;
  const videoHeight = SCIENCE_CARD.card.height - topBlockHeight - bottomBlockHeight;

  return {
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
    bottomBodyHeight,
    topBlockHeight,
    bottomBlockHeight,
    videoY: SCIENCE_CARD.card.y + topBlockHeight,
    videoX: SCIENCE_CARD.card.x,
    videoWidth: SCIENCE_CARD.card.width
  };
}

export function getTurboFaceComputed(
  topText: string,
  bottomText: string,
  fontOverrides?: FontScaleOverrides
): {
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
  bottomBodyHeight: number;
  topBlockHeight: number;
  bottomBlockHeight: number;
  videoY: number;
  videoX: number;
  videoWidth: number;
} {
  const topScale = normalizeFontScale(fontOverrides?.topFontScale);
  const bottomScale = normalizeFontScale(fontOverrides?.bottomFontScale);

  const topSlot: SlotSize = {
    width: TURBO_FACE.top.width - TURBO_FACE.top.paddingX * 2,
    height: TURBO_FACE.top.maxHeight - TURBO_FACE.top.paddingY * 2
  };
  const topFit = optimizeTextForSlot(topText, topSlot, TURBO_FACE.typography.top, "Top text");
  const topSized = applyFontScaleWithSafety({
    text: topFit.text,
    baseFont: topFit.font,
    slot: topSlot,
    config: TURBO_FACE.typography.top,
    scale: topScale
  });
  const topContentHeight = Math.ceil(
    topSized.lines * topSized.font * topSized.lineHeight
  );
  const topBlockHeight = clampNumber(
    topContentHeight + TURBO_FACE.top.paddingY * 2,
    TURBO_FACE.top.minHeight,
    TURBO_FACE.top.maxHeight
  );

  const bottomQuoteSlot: SlotSize = {
    width: TURBO_FACE.bottom.width - TURBO_FACE.bottom.paddingX * 2,
    height:
      TURBO_FACE.bottom.maxHeight -
      TURBO_FACE.bottom.paddingY * 2 -
      TURBO_FACE.bottom.metaHeight -
      TURBO_FACE.bottom.metaGap
  };
  const bottomFit = optimizeTextForSlot(
    bottomText,
    bottomQuoteSlot,
    TURBO_FACE.typography.bottom,
    "Bottom text"
  );
  const bottomSized = applyFontScaleWithSafety({
    text: bottomFit.text,
    baseFont: bottomFit.font,
    slot: bottomQuoteSlot,
    config: TURBO_FACE.typography.bottom,
    scale: bottomScale
  });
  const bottomQuoteHeight = Math.ceil(
    bottomSized.lines * bottomSized.font * bottomSized.lineHeight
  );
  const bottomBodyHeight = Math.max(56, bottomQuoteHeight + TURBO_FACE.bottom.metaGap);
  const bottomBlockHeight = clampNumber(
    TURBO_FACE.bottom.paddingY * 2 + TURBO_FACE.bottom.metaHeight + bottomBodyHeight,
    TURBO_FACE.bottom.minHeight,
    TURBO_FACE.bottom.maxHeight
  );

  const videoY = TURBO_FACE.top.y + topBlockHeight;
  const availableVideoHeight =
    TURBO_FACE.frame.height - videoY - TURBO_FACE.bottom.bottom - bottomBlockHeight;
  const videoHeight = Math.max(260, availableVideoHeight);
  const videoX = TURBO_FACE.video.x;
  const videoWidth = TURBO_FACE.frame.width - TURBO_FACE.video.x * 2;

  return {
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
    bottomBodyHeight,
    topBlockHeight,
    bottomBlockHeight,
    videoY,
    videoX,
    videoWidth
  };
}

export function getTemplateComputed(
  templateId: string,
  topText: string,
  bottomText: string,
  fontOverrides?: FontScaleOverrides
): ReturnType<typeof getScienceCardComputed> {
  if (templateId === TURBO_FACE_TEMPLATE_ID) {
    return getTurboFaceComputed(topText, bottomText, fontOverrides);
  }
  return getScienceCardComputed(topText, bottomText, fontOverrides);
}

export function getTemplateById(templateId: string): Stage3TemplateConfig {
  if (templateId === TURBO_FACE_TEMPLATE_ID) {
    return TURBO_FACE_COMPAT;
  }
  return SCIENCE_CARD;
}
