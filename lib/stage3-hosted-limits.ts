type Stage3RuntimeOptions = {
  maxIterations?: number;
  targetScore?: number;
  minGain?: number;
  operationBudget?: number;
};

export type Stage3HostedTuning = {
  options?: Stage3RuntimeOptions;
  plannerReasoningEffort?: string;
  plannerTimeoutMs?: number;
};

const RENDER_STAGE3_LIMITS = {
  maxIterations: 1,
  operationBudget: 2,
  plannerTimeoutMs: 30_000
} as const;

function isRenderRuntime(): boolean {
  return process.env.RENDER === "true" || process.env.RENDER === "1";
}

function clampFiniteNumber(value: number | undefined, min: number, max: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(max, Math.max(min, value as number));
}

function normalizePlannerReasoningEffort(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!isRenderRuntime()) {
    return trimmed || undefined;
  }
  if (!trimmed) {
    return "high";
  }
  if (trimmed === "extra-high") {
    return "high";
  }
  return trimmed;
}

export function applyHostedStage3Limits<T extends Stage3HostedTuning>(input: T): T {
  if (!isRenderRuntime()) {
    return input;
  }

  return {
    ...input,
    options: {
      ...input.options,
      maxIterations:
        clampFiniteNumber(input.options?.maxIterations, 1, RENDER_STAGE3_LIMITS.maxIterations) ??
        RENDER_STAGE3_LIMITS.maxIterations,
      operationBudget:
        clampFiniteNumber(input.options?.operationBudget, 1, RENDER_STAGE3_LIMITS.operationBudget) ??
        RENDER_STAGE3_LIMITS.operationBudget
    },
    plannerReasoningEffort: normalizePlannerReasoningEffort(input.plannerReasoningEffort),
    plannerTimeoutMs:
      clampFiniteNumber(input.plannerTimeoutMs, 1_000, RENDER_STAGE3_LIMITS.plannerTimeoutMs) ??
      RENDER_STAGE3_LIMITS.plannerTimeoutMs
  };
}
