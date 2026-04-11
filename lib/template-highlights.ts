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
    enabled: false,
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
        const slotId = TEMPLATE_HIGHLIGHT_SLOT_IDS.find((candidateSlot) => candidateSlot === item.slotId);
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
