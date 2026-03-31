import type { Stage2HardConstraints } from "../../stage2-channel-config";

export const STAGE2_VNEXT_AI_STOCK_PHRASES = [
  "the reaction says it all",
  "you can feel the tension",
  "the whole room felt that",
  "the energy shifts instantly",
  "everybody there knows exactly what this means"
] as const;

const RUMOR_LANGUAGE_PATTERNS = [
  /\brumou?r has it\b/i,
  /\bpeople are saying\b/i,
  /\bit looks like confirmation\b/i,
  /\bthis confirms\b/i,
  /\bmust mean\b/i
];

export type Stage2VNextBannedPatternValidation = {
  passed: boolean;
  issues: string[];
};

function containsIgnoreCase(text: string, phrase: string): boolean {
  return text.toLowerCase().includes(phrase.toLowerCase());
}

export function validateBannedPatterns(input: {
  top: string;
  bottom: string;
  constraints: Stage2HardConstraints;
  disallowRumorLanguage?: boolean;
  extraBannedPhrases?: string[];
}): Stage2VNextBannedPatternValidation {
  const issues: string[] = [];
  const top = input.top.trim();
  const bottom = input.bottom.trim();
  const full = `${top}\n${bottom}`;
  const lowerTop = top.toLowerCase();
  const lowerFull = full.toLowerCase();

  for (const opener of input.constraints.bannedOpeners) {
    if (lowerTop.startsWith(opener.toLowerCase())) {
      issues.push(`TOP starts with banned opener "${opener}".`);
    }
  }

  for (const bannedWord of input.constraints.bannedWords) {
    if (lowerFull.includes(bannedWord.toLowerCase())) {
      issues.push(`Caption contains banned word "${bannedWord}".`);
    }
  }

  for (const phrase of [...STAGE2_VNEXT_AI_STOCK_PHRASES, ...(input.extraBannedPhrases ?? [])]) {
    if (containsIgnoreCase(full, phrase)) {
      issues.push(`Caption contains stock phrase "${phrase}".`);
    }
  }

  if (input.disallowRumorLanguage) {
    for (const pattern of RUMOR_LANGUAGE_PATTERNS) {
      if (pattern.test(full)) {
        issues.push("Caption uses rumor language while claim policy forbids it.");
        break;
      }
    }
  }

  return {
    passed: issues.length === 0,
    issues
  };
}
