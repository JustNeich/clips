export type Stage2VNextTitleValidationPolicy = {
  requireQuestionWordOpener?: boolean;
  forceAllCaps?: boolean;
  bannedPunctuationPatterns?: RegExp[];
};

export type Stage2VNextTitleValidation = {
  normalizedTitle: string;
  passed: boolean;
  issues: string[];
};

const QUESTION_WORD_OPENERS = ["what", "why", "how", "when", "who", "which"] as const;
const DEFAULT_BANNED_PUNCTUATION_PATTERNS = [/!!+/, /\?\?+/, /[|]{2,}/];

export function normalizeTitleForPolicy(
  title: string,
  policy?: Stage2VNextTitleValidationPolicy
): string {
  const trimmed = title.trim();
  return policy?.forceAllCaps ? trimmed.toUpperCase() : trimmed;
}

export function validateTitle(
  title: string,
  policy?: Stage2VNextTitleValidationPolicy
): Stage2VNextTitleValidation {
  const normalizedTitle = normalizeTitleForPolicy(title, policy);
  const issues: string[] = [];
  const lower = normalizedTitle.toLowerCase();

  if (!normalizedTitle) {
    issues.push("Title must not be empty.");
  }
  if (policy?.requireQuestionWordOpener) {
    const hasQuestionWordOpener = QUESTION_WORD_OPENERS.some((word) => lower.startsWith(`${word} `));
    if (!hasQuestionWordOpener) {
      issues.push("Title must start with a question-word opener.");
    }
  }
  if (policy?.forceAllCaps && normalizedTitle !== normalizedTitle.toUpperCase()) {
    issues.push("Title must be uppercase.");
  }

  const punctuationPatterns = policy?.bannedPunctuationPatterns ?? DEFAULT_BANNED_PUNCTUATION_PATTERNS;
  for (const pattern of punctuationPatterns) {
    if (pattern.test(normalizedTitle)) {
      issues.push(`Title matches banned punctuation pattern ${pattern}.`);
    }
  }

  return {
    normalizedTitle,
    passed: issues.length === 0,
    issues
  };
}
