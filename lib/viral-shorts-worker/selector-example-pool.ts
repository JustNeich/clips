import type { Stage2CorpusExample } from "../stage2-channel-config";
import type {
  Stage2ExampleGuidanceRole,
  Stage2ExamplesAssessment
} from "./types";
import { scoreTextMatch } from "./analysis";

export const MAX_SELECTOR_PROMPT_EXAMPLES = 24;
export const MAX_SELECTOR_PROMPT_EXAMPLES_PER_SOURCE = 4;

export type SelectorExamplePoolStats = {
  activeCorpusCount: number;
  selectorCandidateCount: number;
  filteredOutForSignalCount: number;
  trimmedByLimitCount: number;
  semanticGuidanceCount: number;
  formGuidanceCount: number;
  weakSupportCount: number;
};

export type SelectorExamplePoolExampleInsight = {
  exampleId: string;
  retrievalScore: number;
  retrievalReasons: string[];
  guidanceRole: Stage2ExampleGuidanceRole;
  semanticFit: number;
  structuralFit: number;
  highSignalOverlap: number;
  isMetadataRich: boolean;
  isWeakGeneric: boolean;
};

export type SelectorExamplePool = {
  selectorExamples: Stage2CorpusExample[];
  stats: SelectorExamplePoolStats;
  assessment: Stage2ExamplesAssessment;
  exampleInsights: SelectorExamplePoolExampleInsight[];
};

type AssessedSelectorExample = {
  example: Stage2CorpusExample;
  score: number;
  retrievalReasons: string[];
  guidanceRole: Stage2ExampleGuidanceRole;
  semanticFit: number;
  structuralFit: number;
  highSignalOverlap: number;
  isMetadataRich: boolean;
  isWeakGeneric: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

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

function computeSemanticFit(input: {
  queryTokens: string[];
  example: Stage2CorpusExample;
  highSignalOverlap: number;
  isMetadataRich: boolean;
  isWeakGeneric: boolean;
  hasNoise: boolean;
}): number {
  const quality = typeof input.example.qualityScore === "number" ? input.example.qualityScore : 0;
  const overlapSignal =
    input.queryTokens.length === 0 ? 0 : Math.min(1, input.highSignalOverlap / 3);
  return Number(
    clamp(
      overlapSignal * 0.7 +
        (input.example.clipType !== "general" ? 0.08 : 0) +
        (input.isMetadataRich ? 0.08 : 0) +
        Math.min(0.1, input.example.whyItWorks.length * 0.04) +
        quality * 0.16 -
        (input.isWeakGeneric ? 0.22 : 0) -
        (input.hasNoise ? 0.18 : 0),
      0,
      1
    ).toFixed(3)
  );
}

function computeStructuralFit(input: {
  example: Stage2CorpusExample;
  promptReady: boolean;
  isMetadataRich: boolean;
  isWeakGeneric: boolean;
  hasNoise: boolean;
}): number {
  const quality = typeof input.example.qualityScore === "number" ? input.example.qualityScore : 0;
  return Number(
    clamp(
      (input.promptReady ? 0.38 : 0.12) +
        (input.isMetadataRich ? 0.14 : 0) +
        (input.example.clipType !== "general" ? 0.08 : 0) +
        Math.min(0.16, input.example.whyItWorks.length * 0.05) +
        quality * 0.24 -
        (input.isWeakGeneric ? 0.18 : 0) -
        (input.hasNoise ? 0.2 : 0),
      0,
      1
    ).toFixed(3)
  );
}

function determineGuidanceRole(input: {
  semanticFit: number;
  structuralFit: number;
  highSignalOverlap: number;
}): Stage2ExampleGuidanceRole {
  if (input.highSignalOverlap >= 2 && input.semanticFit >= 0.58) {
    return "semantic_guidance";
  }
  if (input.structuralFit >= 0.56) {
    return "form_guidance";
  }
  return "weak_support";
}

function buildRetrievalReasons(input: {
  example: Stage2CorpusExample;
  guidanceRole: Stage2ExampleGuidanceRole;
  highSignalOverlap: number;
  semanticFit: number;
  structuralFit: number;
}): string[] {
  const reasons: string[] = [];
  if (input.highSignalOverlap > 0) {
    reasons.push(
      `domain overlap on ${input.highSignalOverlap} high-signal token${input.highSignalOverlap === 1 ? "" : "s"}`
    );
  } else {
    reasons.push("little domain-near lexical overlap");
  }
  if (input.example.clipType !== "general") {
    reasons.push(`specific clip type ${input.example.clipType}`);
  } else {
    reasons.push("generic clip type");
  }
  if (input.example.whyItWorks.length > 0) {
    reasons.push("why-it-works notes present");
  }
  if (typeof input.example.qualityScore === "number") {
    reasons.push(`quality ${input.example.qualityScore.toFixed(2)}`);
  }
  if (input.guidanceRole === "semantic_guidance") {
    reasons.push(`semantic guidance fit ${input.semanticFit.toFixed(2)}`);
  } else if (input.guidanceRole === "form_guidance") {
    reasons.push(`form guidance fit ${input.structuralFit.toFixed(2)}`);
    reasons.push("use mainly for rhythm, density, and top/bottom structure");
  } else {
    reasons.push("weak support only; do not borrow domain assumptions from this example");
  }
  return reasons;
}

function assessExample(queryText: string, example: Stage2CorpusExample): AssessedSelectorExample {
  const queryTokens = extractHighSignalQueryTokens(queryText);
  const promptReady = isPromptReadyExample(example);
  const hasNoise = hasSuspiciousOverlayNoise(example);
  const isMetadataRich = hasMetadataRichness(example);
  const weakGeneric = isWeakGenericExample(example);
  const highSignalOverlap = countHighSignalTokenOverlap(queryTokens, example);
  const semanticFit = computeSemanticFit({
    queryTokens,
    example,
    highSignalOverlap,
    isMetadataRich,
    isWeakGeneric: weakGeneric,
    hasNoise
  });
  const structuralFit = computeStructuralFit({
    example,
    promptReady,
    isMetadataRich,
    isWeakGeneric: weakGeneric,
    hasNoise
  });
  const guidanceRole = determineGuidanceRole({
    semanticFit,
    structuralFit,
    highSignalOverlap
  });
  return {
    example,
    score: Number(scorePromptReadyExample(queryText, example).toFixed(3)),
    retrievalReasons: buildRetrievalReasons({
      example,
      guidanceRole,
      highSignalOverlap,
      semanticFit,
      structuralFit
    }),
    guidanceRole,
    semanticFit,
    structuralFit,
    highSignalOverlap,
    isMetadataRich,
    isWeakGeneric: weakGeneric
  };
}

function pickDiverseExamples(
  scoredExamples: AssessedSelectorExample[],
  limit: number,
  perSourceLimit: number
): Stage2CorpusExample[] {
  const selected: AssessedSelectorExample[] = [];
  const overflow: AssessedSelectorExample[] = [];
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

function buildPoolAssessment(
  assessedExamples: AssessedSelectorExample[]
): Stage2ExamplesAssessment {
  if (assessedExamples.length === 0) {
    return {
      retrievalConfidence: "low",
      examplesMode: "style_guided",
      explanation:
        "No prompt-ready examples were available, so Stage 2 should lean on clip truth and channel learning instead of pretending retrieval is strong.",
      evidence: ["no prompt-ready examples available"],
      retrievalWarning:
        "We did not find a usable example pool for this clip family. Examples should be treated as optional fallback only.",
      examplesRoleSummary: "Examples are effectively unavailable, so they cannot guide semantics or form in a trustworthy way.",
      primaryDriverSummary:
        "Primary driver is the actual clip, with bootstrap style directions and editorial memory filling the gap left by weak retrieval.",
      primaryDrivers: [
        "actual clip truth",
        "bootstrap channel style directions",
        "rolling editorial memory",
        "examples only as weak fallback"
      ],
      channelStylePriority: "primary",
      editorialMemoryPriority: "primary"
    };
  }

  const topExamples = assessedExamples.slice(0, Math.min(8, assessedExamples.length));
  const topFocusedExamples = topExamples.slice(0, Math.min(5, topExamples.length));
  const semanticGuidanceCount = topExamples.filter(
    (entry) => entry.guidanceRole === "semantic_guidance"
  ).length;
  const formGuidanceCount = topExamples.filter(
    (entry) => entry.guidanceRole === "form_guidance"
  ).length;
  const weakSupportCount = topExamples.filter(
    (entry) => entry.guidanceRole === "weak_support"
  ).length;
  const metadataRichShare = average(topExamples.map((entry) => (entry.isMetadataRich ? 1 : 0)));
  const weakGenericShare = average(topExamples.map((entry) => (entry.isWeakGeneric ? 1 : 0)));
  const averageSemanticFit = average(topFocusedExamples.map((entry) => entry.semanticFit));
  const averageStructuralFit = average(topFocusedExamples.map((entry) => entry.structuralFit));
  const averageHighSignalOverlap = average(
    topFocusedExamples.map((entry) => entry.highSignalOverlap)
  );
  const evidence = [
    `${semanticGuidanceCount}/${topExamples.length} top examples look domain-near enough to guide semantics`,
    `${formGuidanceCount}/${topExamples.length} top examples are structurally useful`,
    `${weakSupportCount}/${topExamples.length} top examples are weak or generic support only`,
    `metadata-rich share ${Math.round(metadataRichShare * 100)}%`,
    `weak generic share ${Math.round(weakGenericShare * 100)}%`,
    `avg semantic fit ${averageSemanticFit.toFixed(2)}`,
    `avg structural fit ${averageStructuralFit.toFixed(2)}`
  ];

  if (
    semanticGuidanceCount >= 2 &&
    averageSemanticFit >= 0.58 &&
    averageHighSignalOverlap >= 1.4 &&
    weakGenericShare <= 0.45
  ) {
    return {
      retrievalConfidence: "high",
      examplesMode: "domain_guided",
      explanation:
        "Top examples share real domain-near overlap with the clip and carry enough specific metadata to guide framing, trigger logic, and tone.",
      evidence,
      retrievalWarning: null,
      examplesRoleSummary:
        "Examples can legitimately guide narrative framing, structure, and tone because the pool is thematically strong.",
      primaryDriverSummary:
        "Primary driver is still the actual clip, but retrieval examples are strong enough to help with semantics and framing alongside channel learning.",
      primaryDrivers: [
        "actual clip truth",
        "retrieval examples as semantic guidance",
        "bootstrap channel style directions",
        "rolling editorial memory"
      ],
      channelStylePriority: "supporting",
      editorialMemoryPriority: "supporting"
    };
  }

  if (formGuidanceCount + semanticGuidanceCount >= 3 && averageStructuralFit >= 0.56) {
    return {
      retrievalConfidence: "medium",
      examplesMode: "form_guided",
      explanation:
        "The pool is structurally useful, but thematic overlap is only partial. Examples should help with top/bottom construction and pacing, not with imported domain assumptions.",
      evidence,
      retrievalWarning:
        "No strong domain-near example cluster was found. Examples are being used mainly for form guidance, not semantic truth.",
      examplesRoleSummary:
        "Examples are useful for structure, compression, narrator rhythm, and overlay density, but not as a source of clip-specific nouns or market logic.",
      primaryDriverSummary:
        "Primary drivers are clip truth plus channel learning. Retrieval examples remain useful, but mainly for form and pacing.",
      primaryDrivers: [
        "actual clip truth",
        "bootstrap channel style directions",
        "rolling editorial memory",
        "retrieval examples as form guidance"
      ],
      channelStylePriority: "elevated",
      editorialMemoryPriority: "elevated"
    };
  }

  return {
    retrievalConfidence: "low",
    examplesMode: "style_guided",
    explanation:
      "Top examples are weakly related, too generic, or only loosely useful. The run should lean on the actual clip and the channel learning layer instead of pretending retrieval is semantically strong.",
    evidence,
    retrievalWarning:
      "We did not find strong domain-near examples for this clip family. Examples are acting as weak support only.",
    examplesRoleSummary:
      "Examples should be treated as weak form references at most. Narrative framing should come from the clip, bootstrap style directions, and editorial memory.",
    primaryDriverSummary:
      "Primary driver is the actual clip, followed by bootstrap style directions and recent editorial memory; retrieval examples are secondary support only.",
    primaryDrivers: [
      "actual clip truth",
      "bootstrap channel style directions",
      "rolling editorial memory",
      "retrieval examples as weak support"
    ],
    channelStylePriority: "primary",
    editorialMemoryPriority: "primary"
  };
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
    .map((example) => assessExample(input.queryText, example))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.example.id.localeCompare(right.example.id);
    });
  const selectorExamples = pickDiverseExamples(ranked, limit, perSourceLimit);
  const selectedIds = new Set(selectorExamples.map((example) => example.id));
  const selectedInsights = ranked
    .filter((entry) => selectedIds.has(entry.example.id))
    .sort((left, right) => selectorExamples.findIndex((example) => example.id === left.example.id) - selectorExamples.findIndex((example) => example.id === right.example.id));
  const assessment = buildPoolAssessment(selectedInsights);

  return {
    selectorExamples,
    stats: {
      activeCorpusCount: input.examples.length,
      selectorCandidateCount: selectorExamples.length,
      filteredOutForSignalCount:
        rankingPool.length > 0 ? Math.max(0, input.examples.length - rankingPool.length) : 0,
      trimmedByLimitCount: Math.max(0, rankingPool.length - selectorExamples.length),
      semanticGuidanceCount: selectedInsights.filter((entry) => entry.guidanceRole === "semantic_guidance").length,
      formGuidanceCount: selectedInsights.filter((entry) => entry.guidanceRole === "form_guidance").length,
      weakSupportCount: selectedInsights.filter((entry) => entry.guidanceRole === "weak_support").length
    },
    assessment,
    exampleInsights: selectedInsights.map((entry) => ({
      exampleId: entry.example.id,
      retrievalScore: entry.score,
      retrievalReasons: entry.retrievalReasons,
      guidanceRole: entry.guidanceRole,
      semanticFit: entry.semanticFit,
      structuralFit: entry.structuralFit,
      highSignalOverlap: entry.highSignalOverlap,
      isMetadataRich: entry.isMetadataRich,
      isWeakGeneric: entry.isWeakGeneric
    }))
  };
}
