import type { Stage2VNextTraceV3 } from "../contracts";
import { buildCanonicalCounters } from "./canonical-counters";

export function buildTraceV3(
  trace: Omit<Stage2VNextTraceV3, "canonicalCounters">
): Stage2VNextTraceV3 {
  return {
    ...trace,
    canonicalCounters: buildCanonicalCounters(trace)
  };
}
