import type { Stage3JobKind } from "../app/components/types";
import { isProductionSemanticExecutorReadiness } from "./project-kings/production-semantic-job-contract";

const KNOWN_STAGE3_WORKER_KINDS: readonly Stage3JobKind[] = [
  "preview",
  "render",
  "editing-proxy",
  "source-download",
  "agent-media-step",
  "production-semantic"
];

export function resolveClaimableStage3WorkerKinds(
  supportedKinds: readonly Stage3JobKind[] | null | undefined,
  capabilities: Record<string, unknown> | null | undefined
): Stage3JobKind[] | null {
  if (!supportedKinds) return null;
  const unique = [...new Set(supportedKinds)].filter((kind) =>
    KNOWN_STAGE3_WORKER_KINDS.includes(kind)
  );
  const semanticReadiness = capabilities?.productionSemantic;
  return unique.filter(
    (kind) =>
      kind !== "production-semantic" ||
      (isProductionSemanticExecutorReadiness(semanticReadiness) &&
        semanticReadiness.ready &&
        semanticReadiness.code === "ready")
  );
}
