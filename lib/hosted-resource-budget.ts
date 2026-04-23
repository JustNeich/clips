import os from "node:os";

const MAX_HOSTED_CPU_CONCURRENCY_LIMIT = 16;

export function isHostedRenderRuntime(): boolean {
  return process.env.RENDER === "true" || process.env.RENDER === "1";
}

function parsePositiveInteger(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function getAvailableParallelism(): number {
  try {
    const available =
      typeof os.availableParallelism === "function"
        ? os.availableParallelism()
        : os.cpus().length;
    if (Number.isFinite(available) && available > 0) {
      return Math.floor(available);
    }
  } catch {
    // Fail closed on hosted runtime if Node cannot report the CPU budget.
  }
  return 1;
}

export function getHostedCpuConcurrencyBudget(): number {
  if (!isHostedRenderRuntime()) {
    return Number.POSITIVE_INFINITY;
  }

  const override = parsePositiveInteger(process.env.HOSTED_CPU_CONCURRENCY_LIMIT);
  const detected = override ?? getAvailableParallelism();
  return Math.max(1, Math.min(MAX_HOSTED_CPU_CONCURRENCY_LIMIT, detected));
}

export function clampHostedConcurrencyLimit(limit: number): number {
  const normalized = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  if (!isHostedRenderRuntime()) {
    return Math.max(1, normalized);
  }
  return Math.max(1, Math.min(normalized, getHostedCpuConcurrencyBudget()));
}
