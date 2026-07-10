import type { CodexExecUsage } from "../codex-runner";

export type CodexCreditRate = Readonly<{
  inputPerMillionTokens: number;
  cachedInputPerMillionTokens: number;
  outputPerMillionTokens: number;
}>;

export const PROJECT_KINGS_CODEX_CREDIT_RATE_CARD = Object.freeze({
  evidenceDate: "2026-07-10",
  source: "https://help.openai.com/en/articles/20001106-codex-rate-card-2",
  unit: "codex_credits" as const,
  models: Object.freeze({
    "gpt-5.4": Object.freeze({
      inputPerMillionTokens: 62.5,
      cachedInputPerMillionTokens: 6.25,
      outputPerMillionTokens: 375
    }),
    "gpt-5.4-mini": Object.freeze({
      inputPerMillionTokens: 18.75,
      cachedInputPerMillionTokens: 1.875,
      outputPerMillionTokens: 113
    })
  })
});

function assertUsage(usage: CodexExecUsage): void {
  const values = [
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
    usage.reasoningOutputTokens
  ];
  if (
    values.some((value) => !Number.isInteger(value) || value < 0) ||
    usage.cachedInputTokens > usage.inputTokens ||
    usage.reasoningOutputTokens > usage.outputTokens
  ) {
    throw new Error("Codex usage is incomplete or internally inconsistent.");
  }
}

export function getProjectKingsCodexCreditRate(model: string): CodexCreditRate {
  const rate = PROJECT_KINGS_CODEX_CREDIT_RATE_CARD.models[
    model as keyof typeof PROJECT_KINGS_CODEX_CREDIT_RATE_CARD.models
  ];
  if (!rate) {
    throw new Error(`No frozen Codex credit rate is registered for model: ${model}`);
  }
  return rate;
}

export function calculateProjectKingsCodexCreditMicros(input: {
  model: string;
  usage: CodexExecUsage;
}): number {
  assertUsage(input.usage);
  const rate = getProjectKingsCodexCreditRate(input.model);
  const uncachedInputTokens = input.usage.inputTokens - input.usage.cachedInputTokens;
  const credits =
    (uncachedInputTokens * rate.inputPerMillionTokens +
      input.usage.cachedInputTokens * rate.cachedInputPerMillionTokens +
      input.usage.outputTokens * rate.outputPerMillionTokens) /
    1_000_000;
  return Math.round(credits * 1_000_000);
}
