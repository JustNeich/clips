export const STAGE3_TEMPLATE_ID = "science-card-v1";

export const SCIENCE_CARD = {
  frame: { width: 1080, height: 1920 },
  card: {
    x: 78,
    y: 198,
    width: 924,
    height: 1518,
    radius: 30,
    borderWidth: 5,
    borderColor: "#0a1119",
    fill: "#f9fafc"
  },
  slot: {
    topHeight: 486,
    bottomHeight: 294,
    topPaddingX: 42,
    topPaddingY: 26,
    bottomMetaHeight: 112,
    bottomMetaPaddingX: 24,
    bottomMetaPaddingY: 14,
    bottomTextPaddingX: 24,
    bottomTextPaddingY: 16
  },
  author: {
    name: "Science Snack",
    handle: "@Science_Snack_1",
    avatarSize: 78,
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
      font: 53,
      lineHeight: 1.06
    },
    authorHandle: {
      font: 49,
      lineHeight: 1.04
    }
  }
} as const;

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

const AVERAGE_GLYPH_FACTOR = 0.56;
const HORIZONTAL_SAFETY = 0.96;
const VERTICAL_SAFETY = 0.97;
const FILLER_WORDS = new Set([
  "really",
  "very",
  "quite",
  "basically",
  "actually",
  "just",
  "literally"
]);

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

export function getScienceCardComputed(topText: string, bottomText: string): {
  top: string;
  bottom: string;
  topFont: number;
  bottomFont: number;
  topLines: number;
  bottomLines: number;
  topCompacted: boolean;
  bottomCompacted: boolean;
  videoHeight: number;
  bottomBodyHeight: number;
} {
  const topSlot: SlotSize = {
    width: SCIENCE_CARD.card.width - SCIENCE_CARD.slot.topPaddingX * 2,
    height: SCIENCE_CARD.slot.topHeight - SCIENCE_CARD.slot.topPaddingY * 2
  };
  const bottomBodyHeight = Math.max(
    80,
    SCIENCE_CARD.slot.bottomHeight - SCIENCE_CARD.slot.bottomMetaHeight
  );
  const bottomSlot: SlotSize = {
    width: SCIENCE_CARD.card.width - SCIENCE_CARD.slot.bottomTextPaddingX * 2,
    height: bottomBodyHeight - SCIENCE_CARD.slot.bottomTextPaddingY * 2
  };

  const topFit = optimizeTextForSlot(topText, topSlot, SCIENCE_CARD.typography.top, "Top text");
  const bottomFit = optimizeTextForSlot(
    bottomText,
    bottomSlot,
    SCIENCE_CARD.typography.bottom,
    "Bottom text"
  );

  const videoHeight =
    SCIENCE_CARD.card.height - SCIENCE_CARD.slot.topHeight - SCIENCE_CARD.slot.bottomHeight;

  return {
    top: topFit.text,
    bottom: bottomFit.text,
    topFont: topFit.font,
    bottomFont: bottomFit.font,
    topLines: topFit.lines,
    bottomLines: bottomFit.lines,
    topCompacted: topFit.compacted,
    bottomCompacted: bottomFit.compacted,
    videoHeight,
    bottomBodyHeight
  };
}
