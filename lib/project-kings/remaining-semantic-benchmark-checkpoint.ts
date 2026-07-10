import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

import type { CodexExecUsage } from "../codex-runner";
import type { ModelReasoningEffort } from "./model-routing";

export const REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION =
  "project-kings-remaining-semantic-benchmark-checkpoint-v1" as const;

export type RemainingSemanticBenchmarkInvocationIdentity = Readonly<{
  benchmarkVersion: string;
  annotationsSha256: string;
  caseId: string;
  routeId: string;
  model: string;
  reasoningEffort: ModelReasoningEffort;
  promptSha256: string;
  outputSchemaSha256: string;
}>;

export type RemainingSemanticBenchmarkCheckpointCall = Readonly<
  RemainingSemanticBenchmarkInvocationIdentity & {
    schemaVersion: typeof REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION;
    invocationKey: string;
    startedAt: string;
    durationMs: number;
    outcome: "returned" | "invoke_error";
    rawOutput: string | null;
    outputSha256: string | null;
    usage: CodexExecUsage | null;
    error: string | null;
  }
>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

export function remainingSemanticBenchmarkInvocationKey(
  input: RemainingSemanticBenchmarkInvocationIdentity
): string {
  return sha256Json({
    benchmarkVersion: input.benchmarkVersion,
    annotationsSha256: input.annotationsSha256,
    caseId: input.caseId,
    routeId: input.routeId,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    promptSha256: input.promptSha256,
    outputSchemaSha256: input.outputSchemaSha256
  });
}

export function hasCompleteRemainingSemanticCheckpointUsage(
  value: CodexExecUsage | null
): value is CodexExecUsage {
  return Boolean(
    value &&
      [value.inputTokens, value.cachedInputTokens, value.outputTokens, value.reasoningOutputTokens].every(
        (entry) => Number.isInteger(entry) && entry >= 0
      ) &&
      value.cachedInputTokens <= value.inputTokens &&
      value.reasoningOutputTokens <= value.outputTokens
  );
}

export function isReusableRemainingSemanticCheckpoint(
  call: RemainingSemanticBenchmarkCheckpointCall
): boolean {
  return Boolean(
    call.outcome === "returned" &&
      call.rawOutput !== null &&
      call.outputSha256 === sha256(call.rawOutput) &&
      hasCompleteRemainingSemanticCheckpointUsage(call.usage) &&
      Number.isFinite(call.durationMs) &&
      call.durationMs >= 0 &&
      Number.isFinite(Date.parse(call.startedAt))
  );
}

export async function loadSuccessfulRemainingSemanticCheckpoints(
  filePath: string
): Promise<Map<string, RemainingSemanticBenchmarkCheckpointCall>> {
  const content = await fs.readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const successful = new Map<string, RemainingSemanticBenchmarkCheckpointCall>();
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let call: RemainingSemanticBenchmarkCheckpointCall;
    try {
      call = JSON.parse(line) as RemainingSemanticBenchmarkCheckpointCall;
    } catch {
      throw new Error(`Benchmark checkpoint line ${index + 1} is not valid JSON.`);
    }
    if (call.schemaVersion !== REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION) {
      throw new Error(`Benchmark checkpoint line ${index + 1} has an unsupported schema.`);
    }
    if (call.invocationKey !== remainingSemanticBenchmarkInvocationKey(call)) {
      throw new Error(`Benchmark checkpoint line ${index + 1} has an invalid invocation key.`);
    }
    if (isReusableRemainingSemanticCheckpoint(call)) {
      successful.set(call.invocationKey, call);
    }
  }
  return successful;
}

export async function appendRemainingSemanticBenchmarkCheckpoint(
  filePath: string,
  call: RemainingSemanticBenchmarkCheckpointCall
): Promise<void> {
  if (call.schemaVersion !== REMAINING_SEMANTIC_BENCHMARK_CHECKPOINT_VERSION) {
    throw new Error("Cannot append a checkpoint with an unsupported schema.");
  }
  if (call.invocationKey !== remainingSemanticBenchmarkInvocationKey(call)) {
    throw new Error("Cannot append a checkpoint with an invalid invocation key.");
  }
  await fs.appendFile(filePath, `${JSON.stringify(call)}\n`, "utf8");
}

