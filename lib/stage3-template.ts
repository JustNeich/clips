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
    topHeight: 414,
    bottomHeight: 300,
    topPaddingX: 2,
    topPaddingY: 1,
    bottomMetaHeight: 130,
    bottomMetaPaddingX: 18,
    bottomMetaPaddingY: 6,
    bottomTextPaddingX: 18,
    bottomTextPaddingY: 5,
    bottomTextPaddingTop: 2,
    bottomTextPaddingBottom: 5
  },
  author: {
    name: "Science Snack",
    handle: "@Science_Snack_1",
    avatarSize: 114,
    avatarBorder: 3,
    checkSize: 35
  },
  typography: {
    top: {
      min: 42,
      max: 74,
      softLimit: 128,
      penalty: 0.22,
      lineHeight: 1.1,
      maxLines: 7,
      maxChars: 460
    },
    bottom: {
      min: 24,
      max: 40,
      softLimit: 110,
      penalty: 0.24,
      lineHeight: 1.16,
      maxLines: 4,
      maxChars: 390
    },
    authorName: {
      font: 46,
      lineHeight: 1.06
    },
    authorHandle: {
      font: 41,
      lineHeight: 1.04
    }
  }
} as const;

export const TURBO_FACE = {
  frame: { width: 1080, height: 1920 },
  top: {
    x: 32,
    y: 64,
    width: 1016,
    radius: 18,
    paddingX: 32,
    paddingY: 32,
    minHeight: 220,
    maxHeight: 520
  },
  video: {
    x: 36,
    minHeight: 860
  },
  bottom: {
    x: 36,
    bottom: 64,
    width: 1008,
    radius: 24,
    paddingX: 24,
    paddingY: 24,
    metaHeight: 80,
    metaGap: 16,
    minHeight: 250,
    maxHeight: 360
  },
  author: {
    name: "Stone Face Turbo",
    handle: "@StoneFaceTurbo",
    avatarSize: 80,
    avatarBorder: 2,
    checkSize: 36
  },
  typography: {
    top: {
      min: 44,
      max: 52,
      softLimit: 190,
      penalty: 0.2,
      lineHeight: 1.2,
      maxLines: 7,
      maxChars: 420
    },
    bottom: {
      min: 28,
      max: 36,
      softLimit: 180,
      penalty: 0.22,
      lineHeight: 1.4,
      maxLines: 5,
      maxChars: 360
    },
    authorName: {
      font: 36,
      lineHeight: 1.2
    },
    authorHandle: {
      font: 28,
      lineHeight: 1.2
    }
  }
} as const;

const TURBO_FACE_COMPAT = {
  frame: TURBO_FACE.frame,
  card: {
    x: 36,
    y: 64,
    width: 1008,
    height: 1792,
    radius: 26,
    borderWidth: 3,
    borderColor: "#0a1119",
    fill: "#f9fafc"
  },
  slot: {
    topHeight: 460,
    bottomHeight: 330,
    topPaddingX: 34,
    topPaddingY: 28,
    bottomMetaHeight: 120,
    bottomMetaPaddingX: 24,
    bottomMetaPaddingY: 16,
    bottomTextPaddingX: 24,
    bottomTextPaddingY: 14,
    bottomTextPaddingTop: 14,
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
    bottomMetaHeight: number;
    bottomMetaPaddingX: number;
    bottomMetaPaddingY: number;
    bottomTextPaddingX: number;
    bottomTextPaddingY: number;
    bottomTextPaddingTop?: number;
    bottomTextPaddingBottom?: number;
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

  const topSlot: SlotSize = {
    width: SCIENCE_CARD.card.width - SCIENCE_CARD.slot.topPaddingX * 2,
    height: SCIENCE_CARD.slot.topHeight - SCIENCE_CARD.slot.topPaddingY * 2
  };
  const bottomBodyHeight = Math.max(
    80,
    SCIENCE_CARD.slot.bottomHeight - SCIENCE_CARD.slot.bottomMetaHeight
  );
  const bottomTextPaddingTop = getBottomTextPaddingTop(SCIENCE_CARD);
  const bottomTextPaddingBottom = getBottomTextPaddingBottom(SCIENCE_CARD);
  const bottomSlot: SlotSize = {
    width: SCIENCE_CARD.card.width - SCIENCE_CARD.slot.bottomTextPaddingX * 2,
    height: bottomBodyHeight - bottomTextPaddingTop - bottomTextPaddingBottom
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

  const videoHeight =
    SCIENCE_CARD.card.height - SCIENCE_CARD.slot.topHeight - SCIENCE_CARD.slot.bottomHeight;

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
    topBlockHeight: SCIENCE_CARD.slot.topHeight,
    bottomBlockHeight: SCIENCE_CARD.slot.bottomHeight,
    videoY: SCIENCE_CARD.card.y + SCIENCE_CARD.slot.topHeight,
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
