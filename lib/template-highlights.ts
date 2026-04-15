export const TEMPLATE_HIGHLIGHT_SLOT_IDS = ["slot1", "slot2", "slot3"] as const;

export type TemplateHighlightSlotId = (typeof TEMPLATE_HIGHLIGHT_SLOT_IDS)[number];

export type TemplateHighlightSlotConfig = {
  slotId: TemplateHighlightSlotId;
  enabled: boolean;
  color: string;
  label: string;
  guidance: string;
};

export type TemplateHighlightConfig = {
  enabled: boolean;
  topEnabled: boolean;
  bottomEnabled: boolean;
  slots: [
    TemplateHighlightSlotConfig,
    TemplateHighlightSlotConfig,
    TemplateHighlightSlotConfig
  ];
};

export type TemplateHighlightSpan = {
  start: number;
  end: number;
  slotId: TemplateHighlightSlotId;
};

export type TemplateCaptionHighlights = {
  top: TemplateHighlightSpan[];
  bottom: TemplateHighlightSpan[];
};

export type CaptionHighlightSourceLike = {
  option: number;
  highlights?: TemplateCaptionHighlights | null;
};

export type CaptionHighlightSourceSummary = {
  option: number;
  count: number;
};

export type TemplateHighlightPhraseAnnotation = {
  phrase: string;
  slotId: TemplateHighlightSlotId;
};

export type TemplateCaptionHighlightPhraseMap = {
  top: TemplateHighlightPhraseAnnotation[];
  bottom: TemplateHighlightPhraseAnnotation[];
};

const DEFAULT_SLOT_COLORS: Record<TemplateHighlightSlotId, string> = {
  slot1: "#f3b31f",
  slot2: "#2cc8c3",
  slot3: "#ff5f6d"
};

const DEFAULT_SLOT_LABELS: Record<TemplateHighlightSlotId, string> = {
  slot1: "Key nouns",
  slot2: "Support facts",
  slot3: "Urgency / contrast"
};

const DEFAULT_SLOT_GUIDANCE: Record<TemplateHighlightSlotId, string> = {
  slot1: "Use for the most important specific nouns, names, or entities.",
  slot2: "Use for supporting facts like dates, places, roles, or measurable details.",
  slot3: "Use for the sharpest action words, conflict words, or tension-driving cues."
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createEmptyTemplateCaptionHighlights(): TemplateCaptionHighlights {
  return {
    top: [],
    bottom: []
  };
}

export function cloneTemplateCaptionHighlights(
  highlights: TemplateCaptionHighlights | null | undefined
): TemplateCaptionHighlights {
  return {
    top: [...(highlights?.top ?? [])].map((item) => ({ ...item })),
    bottom: [...(highlights?.bottom ?? [])].map((item) => ({ ...item }))
  };
}

export function clearTemplateCaptionHighlightsBlock(
  highlights: TemplateCaptionHighlights | null | undefined,
  block: keyof TemplateCaptionHighlights
): TemplateCaptionHighlights {
  const next = cloneTemplateCaptionHighlights(highlights);
  next[block] = [];
  return next;
}

export function mergeTemplateCaptionHighlightsByMode(input: {
  current: TemplateCaptionHighlights | null | undefined;
  next: TemplateCaptionHighlights | null | undefined;
  mode: "all" | "top" | "bottom";
}): TemplateCaptionHighlights {
  if (input.mode === "all") {
    return cloneTemplateCaptionHighlights(input.next);
  }
  if (input.mode === "top") {
    return {
      top: cloneTemplateCaptionHighlights(input.next).top,
      bottom: cloneTemplateCaptionHighlights(input.current).bottom
    };
  }
  return {
    top: cloneTemplateCaptionHighlights(input.current).top,
    bottom: cloneTemplateCaptionHighlights(input.next).bottom
  };
}

export function createDefaultTemplateHighlightConfig(options?: {
  accentColor?: string | null;
}): TemplateHighlightConfig {
  const slot1Color = options?.accentColor?.trim() || DEFAULT_SLOT_COLORS.slot1;
  return {
    enabled: true,
    topEnabled: true,
    bottomEnabled: true,
    slots: TEMPLATE_HIGHLIGHT_SLOT_IDS.map((slotId) => ({
      slotId,
      enabled: slotId === "slot1",
      color: slotId === "slot1" ? slot1Color : DEFAULT_SLOT_COLORS[slotId],
      label: DEFAULT_SLOT_LABELS[slotId],
      guidance: DEFAULT_SLOT_GUIDANCE[slotId]
    })) as TemplateHighlightConfig["slots"]
  };
}

export function cloneTemplateHighlightConfig(config: TemplateHighlightConfig): TemplateHighlightConfig {
  return {
    enabled: config.enabled,
    topEnabled: config.topEnabled,
    bottomEnabled: config.bottomEnabled,
    slots: config.slots.map((slot) => ({ ...slot })) as TemplateHighlightConfig["slots"]
  };
}

export function countEnabledTemplateHighlightSlots(
  config: TemplateHighlightConfig | null | undefined
): number {
  return config?.slots.filter((slot) => slot.enabled).length ?? 0;
}

export function isTemplateHighlightingActive(
  config: TemplateHighlightConfig | null | undefined
): boolean {
  return Boolean(
    config &&
      config.enabled &&
      (config.topEnabled || config.bottomEnabled) &&
      countEnabledTemplateHighlightSlots(config) > 0
  );
}

export function countTemplateHighlightSpans(
  highlights: TemplateCaptionHighlights | null | undefined,
  block?: keyof TemplateCaptionHighlights
): number {
  if (block) {
    return highlights?.[block]?.length ?? 0;
  }
  return (highlights?.top.length ?? 0) + (highlights?.bottom.length ?? 0);
}

export function buildCaptionHighlightSourceState(
  captionSources: ReadonlyArray<CaptionHighlightSourceLike> | null | undefined,
  selectedOption?: number | null
): {
  highlightedSources: CaptionHighlightSourceSummary[];
  selectedHighlightedSource: CaptionHighlightSourceSummary | null;
  suggestedHighlightedSource: CaptionHighlightSourceSummary | null;
} {
  const highlightedSources = (captionSources ?? [])
    .map((source) => ({
      option: source.option,
      count: countTemplateHighlightSpans(source.highlights)
    }))
    .filter((source) => source.count > 0);
  const selectedHighlightedSource =
    highlightedSources.find((source) => source.option === (selectedOption ?? null)) ?? null;
  return {
    highlightedSources,
    selectedHighlightedSource,
    suggestedHighlightedSource: selectedHighlightedSource ?? highlightedSources[0] ?? null
  };
}

export function normalizeTemplateHighlightConfig(
  raw: unknown,
  options?: { accentColor?: string | null }
): TemplateHighlightConfig {
  const defaults = createDefaultTemplateHighlightConfig(options);
  if (!isRecord(raw)) {
    return defaults;
  }

  const rawSlots = Array.isArray(raw.slots) ? raw.slots : [];
  const slots = TEMPLATE_HIGHLIGHT_SLOT_IDS.map((slotId, index) => {
    const rawSlot = isRecord(rawSlots[index]) ? rawSlots[index] : null;
    return {
      slotId,
      enabled: normalizeBoolean(rawSlot?.enabled, defaults.slots[index].enabled),
      color: normalizeString(rawSlot?.color, defaults.slots[index].color),
      label: normalizeString(rawSlot?.label, defaults.slots[index].label),
      guidance: normalizeString(rawSlot?.guidance, defaults.slots[index].guidance)
    };
  }) as TemplateHighlightConfig["slots"];

  return {
    enabled: normalizeBoolean(raw.enabled, defaults.enabled),
    topEnabled: normalizeBoolean(raw.topEnabled, defaults.topEnabled),
    bottomEnabled: normalizeBoolean(raw.bottomEnabled, defaults.bottomEnabled),
    slots
  };
}

function normalizeHighlightSpan(
  raw: unknown,
  textLength: number
): TemplateHighlightSpan | null {
  if (!isRecord(raw)) {
    return null;
  }
  const slotId = TEMPLATE_HIGHLIGHT_SLOT_IDS.find((candidate) => candidate === raw.slotId);
  const start = normalizeNumber(raw.start);
  const end = normalizeNumber(raw.end);
  if (!slotId || start === null || end === null) {
    return null;
  }
  const boundedStart = Math.max(0, Math.min(textLength, Math.floor(start)));
  const boundedEnd = Math.max(0, Math.min(textLength, Math.floor(end)));
  if (boundedEnd <= boundedStart) {
    return null;
  }
  return {
    slotId,
    start: boundedStart,
    end: boundedEnd
  };
}

export function normalizeTemplateHighlightSpans(
  raw: unknown,
  text: string
): TemplateHighlightSpan[] {
  const spans = Array.isArray(raw)
    ? raw
        .map((item) => normalizeHighlightSpan(item, text.length))
        .filter((item): item is TemplateHighlightSpan => item !== null)
    : [];

  spans.sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    const leftLength = left.end - left.start;
    const rightLength = right.end - right.start;
    if (leftLength !== rightLength) {
      return rightLength - leftLength;
    }
    return left.slotId.localeCompare(right.slotId);
  });

  const normalized: TemplateHighlightSpan[] = [];
  let lastAcceptedEnd = -1;
  for (const span of spans) {
    if (span.start < lastAcceptedEnd) {
      continue;
    }
    normalized.push(span);
    lastAcceptedEnd = span.end;
  }
  return normalized;
}

export function normalizeTemplateCaptionHighlights(
  raw: unknown,
  text?: { top: string; bottom: string }
): TemplateCaptionHighlights {
  const candidate = isRecord(raw) ? raw : {};
  return {
    top: normalizeTemplateHighlightSpans(candidate.top, text?.top ?? ""),
    bottom: normalizeTemplateHighlightSpans(candidate.bottom, text?.bottom ?? "")
  };
}

export function normalizeTemplateHighlightPhraseAnnotations(
  raw: unknown
): TemplateCaptionHighlightPhraseMap {
  const candidate = isRecord(raw) ? raw : {};
  const normalizeBlock = (value: unknown): TemplateHighlightPhraseAnnotation[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }
        const rawSlotId =
          typeof item.slotId === "string"
            ? item.slotId
            : typeof item.slot_id === "string"
              ? item.slot_id
              : null;
        const slotId = TEMPLATE_HIGHLIGHT_SLOT_IDS.find((candidateSlot) => candidateSlot === rawSlotId);
        const phrase = typeof item.phrase === "string" ? item.phrase.trim() : "";
        if (!slotId || !phrase) {
          return null;
        }
        return {
          slotId,
          phrase
        };
      })
      .filter((item): item is TemplateHighlightPhraseAnnotation => item !== null);
  };

  return {
    top: normalizeBlock(candidate.top),
    bottom: normalizeBlock(candidate.bottom)
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HIGHLIGHT_WORD_RE = /[#$]?[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g;
const HIGHLIGHT_EDGE_STOPWORDS = new Set<string>([
  "a",
  "an",
  "and",
  "as",
  "at",
  "because",
  "before",
  "but",
  "for",
  "from",
  "if",
  "in",
  "into",
  "like",
  "of",
  "on",
  "or",
  "so",
  "than",
  "that",
  "the",
  "their",
  "then",
  "to",
  "until",
  "when",
  "while",
  "with"
]);

type HighlightWordMatch = {
  raw: string;
  normalized: string;
  start: number;
  end: number;
};

type HighlightCandidateSpan = TemplateHighlightSpan & {
  wordStart: number;
  wordEnd: number;
  wordCount: number;
  score: number;
};

function extractHighlightWordMatches(text: string): HighlightWordMatch[] {
  return Array.from(text.matchAll(HIGHLIGHT_WORD_RE)).map((match) => {
    const raw = match[0] ?? "";
    const start = match.index ?? 0;
    return {
      raw,
      normalized: raw.toLowerCase(),
      start,
      end: start + raw.length
    };
  });
}

function scoreHighlightWord(word: HighlightWordMatch): number {
  if (/\d/.test(word.raw)) {
    return 3;
  }
  if (/^[A-Z]{2,}$/.test(word.raw)) {
    return 2.5;
  }
  if (!HIGHLIGHT_EDGE_STOPWORDS.has(word.normalized) && word.raw.length >= 6) {
    return 2;
  }
  if (!HIGHLIGHT_EDGE_STOPWORDS.has(word.normalized)) {
    return 1;
  }
  return 0;
}

function compactHighlightPhrase(phrase: string, maxWords = 4): string {
  const words = extractHighlightWordMatches(phrase);
  if (words.length <= maxWords) {
    return phrase.trim();
  }
  let bestWindow: { start: number; end: number; score: number } | null = null;
  for (let index = 0; index <= words.length - maxWords; index += 1) {
    const window = words.slice(index, index + maxWords);
    const rawStart = window[0]?.start ?? 0;
    const rawEnd = window.at(-1)?.end ?? phrase.length;
    let score = window.reduce((total, word) => total + scoreHighlightWord(word), 0);
    if (!HIGHLIGHT_EDGE_STOPWORDS.has(window[0]?.normalized ?? "")) {
      score += 0.5;
    }
    if (!HIGHLIGHT_EDGE_STOPWORDS.has(window.at(-1)?.normalized ?? "")) {
      score += 0.5;
    }
    if (bestWindow === null || score > bestWindow.score) {
      bestWindow = {
        start: rawStart,
        end: rawEnd,
        score
      };
    }
  }
  return phrase.slice(bestWindow?.start ?? 0, bestWindow?.end ?? phrase.length).trim();
}

function findPhraseOccurrences(
  text: string,
  phrase: string
): Array<{ start: number; end: number }> {
  const trimmedPhrase = phrase.trim();
  if (!text || !trimmedPhrase) {
    return [];
  }
  const matcher = new RegExp(escapeRegExp(trimmedPhrase), "gi");
  const matches: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (end > start) {
      matches.push({ start, end });
    }
    if (matcher.lastIndex === match.index) {
      matcher.lastIndex += 1;
    }
  }
  return matches;
}

export function buildTemplateHighlightSpansFromPhrases(input: {
  text: string;
  annotations: TemplateHighlightPhraseAnnotation[];
}): TemplateHighlightSpan[] {
  const spans = input.annotations.flatMap((annotation) =>
    findPhraseOccurrences(input.text, annotation.phrase).map((match) => ({
      slotId: annotation.slotId,
      start: match.start,
      end: match.end
    }))
  );
  return normalizeTemplateHighlightSpans(spans, input.text);
}

function buildHighlightCandidateSpans(input: {
  text: string;
  annotations: TemplateHighlightPhraseAnnotation[];
}): HighlightCandidateSpan[] {
  const words = extractHighlightWordMatches(input.text);
  const rawCandidates = input.annotations.flatMap((annotation) => {
    const compactPhrase = compactHighlightPhrase(annotation.phrase);
    const compactWordCount = extractHighlightWordMatches(compactPhrase).length;
    return findPhraseOccurrences(input.text, compactPhrase).map((match) => {
      const wordStart = words.findIndex((word) => word.start >= match.start || word.end > match.start);
      const wordEndRaw = words.findIndex((word) => word.start < match.end && word.end >= match.end);
      const resolvedWordStart = wordStart >= 0 ? wordStart : 0;
      const resolvedWordEnd = wordEndRaw >= 0 ? wordEndRaw : Math.max(resolvedWordStart, words.length - 1);
      return {
        slotId: annotation.slotId,
        start: match.start,
        end: match.end,
        wordStart: resolvedWordStart,
        wordEnd: resolvedWordEnd,
        wordCount: Math.max(1, compactWordCount),
        score:
          Math.max(0, 5 - Math.abs(Math.min(4, compactWordCount) - 2)) +
          (/\d/.test(compactPhrase) ? 1 : 0) +
          compactPhrase.length / 100
      };
    });
  });

  const unique = new Map<string, HighlightCandidateSpan>();
  rawCandidates.forEach((candidate) => {
    const key = `${candidate.slotId}:${candidate.start}:${candidate.end}`;
    if (!unique.has(key)) {
      unique.set(key, candidate);
    }
  });

  return [...unique.values()].sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    return left.end - right.end;
  });
}

function areHighlightCandidatesTooClose(
  candidate: HighlightCandidateSpan,
  selected: HighlightCandidateSpan
): boolean {
  return candidate.wordStart <= selected.wordEnd + 1 && candidate.wordEnd >= selected.wordStart - 1;
}

function pickBestHighlightCandidate(
  candidates: HighlightCandidateSpan[]
): HighlightCandidateSpan | null {
  if (!candidates.length) {
    return null;
  }
  return [...candidates].sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.wordCount !== right.wordCount) {
      return left.wordCount - right.wordCount;
    }
    return left.start - right.start;
  })[0] ?? null;
}

export function buildDistributedTemplateHighlightSpansFromPhrases(input: {
  text: string;
  annotations: TemplateHighlightPhraseAnnotation[];
  maxHighlights?: number;
}): TemplateHighlightSpan[] {
  const candidates = buildHighlightCandidateSpans(input);
  if (candidates.length <= 1) {
    return normalizeTemplateHighlightSpans(candidates, input.text);
  }

  const maxHighlights = Math.max(1, Math.min(input.maxHighlights ?? 6, candidates.length));
  const buckets = Array.from({ length: Math.min(4, Math.max(1, candidates.length)) }, () => [] as HighlightCandidateSpan[]);
  candidates.forEach((candidate) => {
    const midpoint = (candidate.start + candidate.end) / 2;
    const normalizedMidpoint = input.text.length > 0 ? midpoint / input.text.length : 0;
    const bucketIndex = Math.min(
      buckets.length - 1,
      Math.max(0, Math.floor(normalizedMidpoint * buckets.length))
    );
    buckets[bucketIndex]?.push(candidate);
  });

  const selected: HighlightCandidateSpan[] = [];
  buckets.forEach((bucket) => {
    const pick = pickBestHighlightCandidate(
      bucket.filter((candidate) => !selected.some((entry) => areHighlightCandidatesTooClose(candidate, entry)))
    );
    if (pick) {
      selected.push(pick);
    }
  });

  const leftovers = candidates.filter(
    (candidate) =>
      !selected.some(
        (entry) => entry.start === candidate.start && entry.end === candidate.end && entry.slotId === candidate.slotId
      )
  );
  while (selected.length < maxHighlights) {
    const next = [...leftovers]
      .filter((candidate) => !selected.some((entry) => areHighlightCandidatesTooClose(candidate, entry)))
      .sort((left, right) => {
        const leftDistance =
          selected.length === 0
            ? Number.POSITIVE_INFINITY
            : Math.min(...selected.map((entry) => Math.abs(left.wordStart - entry.wordStart)));
        const rightDistance =
          selected.length === 0
            ? Number.POSITIVE_INFINITY
            : Math.min(...selected.map((entry) => Math.abs(right.wordStart - entry.wordStart)));
        if (leftDistance !== rightDistance) {
          return rightDistance - leftDistance;
        }
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        return left.start - right.start;
      })[0];
    if (!next) {
      break;
    }
    selected.push(next);
  }

  return normalizeTemplateHighlightSpans(
    selected.map((candidate) => ({
      start: candidate.start,
      end: candidate.end,
      slotId: candidate.slotId
    })),
    input.text
  );
}

export function hasEnabledTemplateHighlights(config: TemplateHighlightConfig | null | undefined): boolean {
  if (!config?.enabled) {
    return false;
  }
  return config.slots.some((slot) => slot.enabled);
}

export function getEnabledTemplateHighlightSlots(
  config: TemplateHighlightConfig | null | undefined
): TemplateHighlightSlotConfig[] {
  if (!config?.enabled) {
    return [];
  }
  return config.slots.filter((slot) => slot.enabled);
}
