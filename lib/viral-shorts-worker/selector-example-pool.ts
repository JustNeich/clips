import type { Stage2CorpusExample } from "../stage2-channel-config";
import { scoreTextMatch } from "./analysis";

export const MAX_SELECTOR_PROMPT_EXAMPLES = 24;
export const MAX_SELECTOR_PROMPT_EXAMPLES_PER_SOURCE = 4;

export type SelectorExamplePoolStats = {
  activeCorpusCount: number;
  selectorCandidateCount: number;
  filteredOutForSignalCount: number;
  trimmedByLimitCount: number;
};

export type SelectorExamplePool = {
  selectorExamples: Stage2CorpusExample[];
  stats: SelectorExamplePoolStats;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeSerializedJson(value: string): boolean {
  const trimmed = value.trim();
  return /^[\[{]/.test(trimmed) && /"[^"]+"\s*:/.test(trimmed);
}

function countWords(value: string): number {
  return normalizeWhitespace(value).split(" ").filter(Boolean).length;
}

const GENERIC_QUERY_TOKENS = new Set([
  "about",
  "after",
  "before",
  "being",
  "because",
  "between",
  "change",
  "comments",
  "description",
  "during",
  "every",
  "everyone",
  "frame",
  "frames",
  "going",
  "guy",
  "guys",
  "later",
  "moment",
  "normal",
  "people",
  "really",
  "reaction",
  "scene",
  "sequence",
  "starts",
  "still",
  "suddenly",
  "their",
  "there",
  "these",
  "thing",
  "title",
  "transcript",
  "video",
  "viewer",
  "watch",
  "whole",
  "with"
]);

function hasSuspiciousTokenNoise(value: string): boolean {
  const tokens = normalizeWhitespace(value)
    .split(" ")
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);

  const suspiciousCount = tokens.filter((token) => {
    if (token.length < 5) {
      return false;
    }
    const hasLetters = /[A-Za-z]/.test(token);
    const hasDigits = /\d/.test(token);
    const mixedLetterDigit = hasLetters && hasDigits;
    const weirdInternalCaps = /[a-z][A-Z]{2,}|[A-Z]{2,}[a-z]{2,}/.test(token);
    const nonAscii = /[^\x00-\x7F]/.test(token);
    return mixedLetterDigit || weirdInternalCaps || nonAscii;
  }).length;

  return suspiciousCount >= 2;
}

function hasEnoughSignal(value: string, minimumLength: number, minimumWords: number): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return false;
  }
  if (normalized.length < minimumLength) {
    return false;
  }
  if (countWords(normalized) < minimumWords) {
    return false;
  }
  return !looksLikeSerializedJson(normalized);
}

function isPromptReadyExample(example: Stage2CorpusExample): boolean {
  return (
    hasEnoughSignal(example.overlayTop, 12, 3) &&
    hasEnoughSignal(example.overlayBottom, 18, 4) &&
    !looksLikeSerializedJson(example.title)
  );
}

function hasMetadataRichness(example: Stage2CorpusExample): boolean {
  return (
    example.clipType !== "general" ||
    example.whyItWorks.length > 0 ||
    (typeof example.qualityScore === "number" && example.qualityScore >= 0.55)
  );
}

function isWeakGenericExample(example: Stage2CorpusExample): boolean {
  return (
    example.clipType === "general" &&
    example.whyItWorks.length === 0 &&
    !(typeof example.qualityScore === "number" && example.qualityScore >= 0.55)
  );
}

function hasSuspiciousOverlayNoise(example: Stage2CorpusExample): boolean {
  return (
    hasSuspiciousTokenNoise(example.overlayTop) ||
    hasSuspiciousTokenNoise(example.overlayBottom)
  );
}

function tokenizeHighSignalText(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]*/g)
    ?.filter((token) => token.length >= 4 && !GENERIC_QUERY_TOKENS.has(token)) ?? [];
}

function extractHighSignalQueryTokens(queryText: string): string[] {
  return Array.from(new Set(tokenizeHighSignalText(queryText))).slice(0, 24);
}

function countHighSignalTokenOverlap(
  queryTokens: string[],
  example: Stage2CorpusExample
): number {
  if (queryTokens.length === 0) {
    return 0;
  }
  const exampleTokens = new Set(
    tokenizeHighSignalText(
      [
        example.title,
        example.overlayTop,
        example.overlayBottom,
        example.transcript,
        example.clipType,
        example.whyItWorks.join(" ")
      ].join(" ")
    )
  );
  let overlap = 0;
  for (const token of queryTokens) {
    if (exampleTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function scorePromptReadyExample(queryText: string, example: Stage2CorpusExample): number {
  const highSignalQueryTokens = extractHighSignalQueryTokens(queryText);
  const highSignalOverlap = countHighSignalTokenOverlap(highSignalQueryTokens, example);
  const whyItWorksBonus = Math.min(0.6, example.whyItWorks.length * 0.22);
  const qualityScore = typeof example.qualityScore === "number" ? example.qualityScore : 0;
  const ownedExampleBonus = example.ownerChannelId === example.sourceChannelId ? 0.12 : 0;
  const clipTypeBonus = example.clipType !== "general" ? 0.24 : 0;
  const titleBonus = example.title.trim().length > 0 ? 0.04 : 0;
  const transcriptBonus = hasEnoughSignal(example.transcript, 24, 5) ? 0.05 : 0;
  const highSignalOverlapBonus = Math.min(0.84, highSignalOverlap * 0.16);
  const highSignalMismatchPenalty =
    highSignalQueryTokens.length >= 6
      ? highSignalOverlap === 0
        ? 0.95
        : highSignalOverlap === 1
          ? 0.28
          : 0
      : 0;
  const weakGenericPenalty = isWeakGenericExample(example)
    ? highSignalQueryTokens.length >= 6
      ? 1.05
      : 0.65
    : 0;
  const genericDomainPenalty =
    example.clipType === "general" && highSignalQueryTokens.length >= 6 && highSignalOverlap === 0
      ? 0.35
      : 0;
  const noisePenalty = hasSuspiciousOverlayNoise(example) ? 1.1 : 0;

  return (
    scoreTextMatch(queryText, {
      title: example.title,
      overlayTop: example.overlayTop,
      overlayBottom: example.overlayBottom,
      transcript: example.transcript,
      clipType: example.clipType
    }) +
    whyItWorksBonus +
    qualityScore +
    ownedExampleBonus +
    clipTypeBonus +
    titleBonus +
    transcriptBonus +
    highSignalOverlapBonus -
    highSignalMismatchPenalty -
    weakGenericPenalty -
    genericDomainPenalty -
    noisePenalty
  );
}

function pickDiverseExamples(
  scoredExamples: Array<{ example: Stage2CorpusExample; score: number }>,
  limit: number,
  perSourceLimit: number
): Stage2CorpusExample[] {
  const selected: Array<{ example: Stage2CorpusExample; score: number }> = [];
  const overflow: Array<{ example: Stage2CorpusExample; score: number }> = [];
  const sourceCounts = new Map<string, number>();

  for (const entry of scoredExamples) {
    const sourceId = entry.example.sourceChannelId || entry.example.ownerChannelId || "unknown-source";
    const currentCount = sourceCounts.get(sourceId) ?? 0;
    if (selected.length < limit && currentCount < perSourceLimit) {
      selected.push(entry);
      sourceCounts.set(sourceId, currentCount + 1);
      continue;
    }
    overflow.push(entry);
  }

  if (selected.length < limit) {
    for (const entry of overflow) {
      if (selected.length >= limit) {
        break;
      }
      selected.push(entry);
    }
  }

  return selected.slice(0, limit).map((entry) => entry.example);
}

export function buildSelectorExamplePool(input: {
  examples: Stage2CorpusExample[];
  queryText: string;
  limit?: number;
  perSourceLimit?: number;
}): SelectorExamplePool {
  const limit = input.limit ?? MAX_SELECTOR_PROMPT_EXAMPLES;
  const perSourceLimit = input.perSourceLimit ?? MAX_SELECTOR_PROMPT_EXAMPLES_PER_SOURCE;
  const promptReadyExamples = input.examples.filter((example) => isPromptReadyExample(example));
  const cleanPromptReadyExamples = promptReadyExamples.filter((example) => !hasSuspiciousOverlayNoise(example));
  const metadataRichExamples = cleanPromptReadyExamples.filter((example) => hasMetadataRichness(example));
  const rankingPool =
    metadataRichExamples.length >= Math.min(8, limit)
      ? metadataRichExamples
      : cleanPromptReadyExamples.length > 0
        ? cleanPromptReadyExamples
      : promptReadyExamples.length > 0
        ? promptReadyExamples
        : input.examples;
  const ranked = [...rankingPool]
    .map((example) => ({
      example,
      score: scorePromptReadyExample(input.queryText, example)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.example.id.localeCompare(right.example.id);
    });
  const selectorExamples = pickDiverseExamples(ranked, limit, perSourceLimit);

  return {
    selectorExamples,
    stats: {
      activeCorpusCount: input.examples.length,
      selectorCandidateCount: selectorExamples.length,
      filteredOutForSignalCount:
        rankingPool.length > 0 ? Math.max(0, input.examples.length - rankingPool.length) : 0,
      trimmedByLimitCount: Math.max(0, rankingPool.length - selectorExamples.length)
    }
  };
}
