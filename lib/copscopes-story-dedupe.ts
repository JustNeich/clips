const STORY_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "along",
  "also",
  "another",
  "around",
  "because",
  "before",
  "being",
  "bodycam",
  "camera",
  "caption",
  "caught",
  "channel",
  "could",
  "county",
  "dashcam",
  "department",
  "during",
  "every",
  "first",
  "footage",
  "from",
  "have",
  "into",
  "just",
  "more",
  "officer",
  "officers",
  "police",
  "released",
  "reel",
  "said",
  "seen",
  "shows",
  "their",
  "there",
  "these",
  "they",
  "this",
  "through",
  "video",
  "watch",
  "when",
  "where",
  "while",
  "with",
  "would"
]);

export type CopscopesStoryDuplicateMatch = {
  duplicate: boolean;
  reason: "exact_text" | "contained_text" | "token_overlap" | null;
  sharedTokenCount: number;
  overlapCoefficient: number;
  jaccard: number;
};

export type CopscopesStoryCandidate = {
  id: string;
  shortcode?: string | null;
  title?: string | null;
  caption?: string | null;
  text?: string | null;
};

function normalizeToken(token: string): string {
  return token
    .replace(/'s$/i, "")
    .replace(/(?:ing|ed)$/i, "")
    .replace(/s$/i, "");
}

export function normalizeCopscopesStoryText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[@#][a-z0-9_.-]+/gi, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function buildCopscopesStoryText(input: {
  title?: string | null;
  caption?: string | null;
  text?: string | null;
}): string {
  return normalizeCopscopesStoryText([input.text, input.title, input.caption].filter(Boolean).join(" "));
}

export function getCopscopesStoryTokens(value: string | null | undefined): Set<string> {
  const normalized = normalizeCopscopesStoryText(value);
  const tokens = normalized
    .split(" ")
    .map(normalizeToken)
    .filter((token) => token.length >= 4 && !STORY_STOP_WORDS.has(token));
  return new Set(tokens);
}

export function compareCopscopesStoryTexts(
  left: string | null | undefined,
  right: string | null | undefined
): CopscopesStoryDuplicateMatch {
  const leftText = normalizeCopscopesStoryText(left);
  const rightText = normalizeCopscopesStoryText(right);
  if (!leftText || !rightText) {
    return {
      duplicate: false,
      reason: null,
      sharedTokenCount: 0,
      overlapCoefficient: 0,
      jaccard: 0
    };
  }

  if (leftText.length >= 80 && leftText === rightText) {
    return {
      duplicate: true,
      reason: "exact_text",
      sharedTokenCount: getCopscopesStoryTokens(leftText).size,
      overlapCoefficient: 1,
      jaccard: 1
    };
  }

  const shorter = leftText.length <= rightText.length ? leftText : rightText;
  const longer = leftText.length > rightText.length ? leftText : rightText;
  if (shorter.length >= 140 && longer.includes(shorter)) {
    return {
      duplicate: true,
      reason: "contained_text",
      sharedTokenCount: getCopscopesStoryTokens(shorter).size,
      overlapCoefficient: 1,
      jaccard: Number((shorter.length / longer.length).toFixed(3))
    };
  }

  const leftTokens = getCopscopesStoryTokens(leftText);
  const rightTokens = getCopscopesStoryTokens(rightText);
  if (leftTokens.size < 8 || rightTokens.size < 8) {
    return {
      duplicate: false,
      reason: null,
      sharedTokenCount: 0,
      overlapCoefficient: 0,
      jaccard: 0
    };
  }

  let sharedTokenCount = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      sharedTokenCount += 1;
    }
  }
  const minSize = Math.min(leftTokens.size, rightTokens.size);
  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  const overlapCoefficient = sharedTokenCount / minSize;
  const jaccard = sharedTokenCount / unionSize;
  const duplicate = sharedTokenCount >= 10 && overlapCoefficient >= 0.76 && jaccard >= 0.5;

  return {
    duplicate,
    reason: duplicate ? "token_overlap" : null,
    sharedTokenCount,
    overlapCoefficient: Number(overlapCoefficient.toFixed(3)),
    jaccard: Number(jaccard.toFixed(3))
  };
}

export function findCopscopesDuplicateStory(input: {
  candidate: CopscopesStoryCandidate;
  existing: CopscopesStoryCandidate[];
}): {
  candidateText: string;
  existing: CopscopesStoryCandidate;
  match: CopscopesStoryDuplicateMatch;
} | null {
  const candidateText = buildCopscopesStoryText(input.candidate);
  if (!candidateText) {
    return null;
  }
  for (const existing of input.existing) {
    if (existing.id === input.candidate.id) {
      continue;
    }
    const existingText = buildCopscopesStoryText(existing);
    const match = compareCopscopesStoryTexts(candidateText, existingText);
    if (match.duplicate) {
      return {
        candidateText,
        existing,
        match
      };
    }
  }
  return null;
}
