export const STAGE3_TEMPLATE_ID = "science-card-v1";

export const SCIENCE_CARD = {
  frame: { width: 1080, height: 1920 },
  card: {
    x: 82,
    y: 83,
    width: 917,
    height: 1766,
    radius: 26,
    borderWidth: 6,
    borderColor: "rgba(255,255,255,0.06)",
    fill: "#ffffff"
  },
  slot: {
    topHeight: 442,
    bottomHeight: 353,
    topPaddingX: 28,
    topPaddingY: 18,
    bottomPaddingX: 28,
    bottomPaddingY: 18
  },
  typography: {
    top: {
      min: 36,
      max: 70,
      softLimit: 120,
      penalty: 0.22,
      lineHeight: 1.12,
      maxLines: 6,
      maxChars: 460
    },
    bottom: {
      min: 30,
      max: 56,
      softLimit: 110,
      penalty: 0.24,
      lineHeight: 1.12,
      maxLines: 5,
      maxChars: 390
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

const AVERAGE_GLYPH_FACTOR = 0.53;
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

  const maxCharsPerLine = Math.max(3, Math.floor(widthPx / Math.max(1, fontPx * AVERAGE_GLYPH_FACTOR)));
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
    if (lines <= config.maxLines && contentHeight <= slot.height) {
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
} {
  const topSlot: SlotSize = {
    width: SCIENCE_CARD.card.width - SCIENCE_CARD.slot.topPaddingX * 2,
    height: SCIENCE_CARD.slot.topHeight - SCIENCE_CARD.slot.topPaddingY * 2
  };
  const bottomSlot: SlotSize = {
    width: SCIENCE_CARD.card.width - SCIENCE_CARD.slot.bottomPaddingX * 2,
    height: SCIENCE_CARD.slot.bottomHeight - SCIENCE_CARD.slot.bottomPaddingY * 2
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
    videoHeight
  };
}
