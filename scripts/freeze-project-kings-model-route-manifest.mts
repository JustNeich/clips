import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import manifestModule from "../lib/project-kings/production-model-route-manifest";
import contractsModule from "../lib/project-kings/production-agent-contracts";
import routingModule from "../lib/project-kings/model-routing";
import type { ProductionModelAgentRole } from "../lib/project-kings/production-agent-contracts";
import type { ModelSelectionPolicy } from "../lib/project-kings/model-routing";
import type { ProductionAgentModelSelection } from "../lib/project-kings/production-agent-runtime";

const {
  calculateProductionAgentRouteManifestSha256,
  parseFrozenProductionAgentRouteManifest
} = manifestModule;
const { PRODUCTION_MODEL_AGENT_ROLES } = contractsModule;
const { PROJECT_KINGS_V1_MODEL_REGISTRY } = routingModule;

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const EVIDENCE_ROOT = path.join(REPO_ROOT, "docs/project-kings-production-pipeline-v1/evidence");
const OUTPUT_PATH = path.join(EVIDENCE_ROOT, "project-kings-model-routes-v3.json");

// Real-30 evidence for the five production roles benchmarked on real media
// (2026-07-11, gpt-5.6-luna only). vision_qa intentionally stays on its
// synthetic v7 evidence: its real launch gate is the 120-case blind corpus,
// which by design requires campaign-scoped final_approved materials that only
// exist after shadow runs.
const INPUTS: Record<ProductionModelAgentRole, string> = {
  source_search: "model-benchmark-source_search-2026-07-10-real-30-v5-search-boundary.json",
  source_fit: "model-benchmark-source_fit-2026-07-10-real-30-v2.json",
  source_policy: "model-benchmark-source_policy-2026-07-10-real-30-v9.json",
  caption: "model-benchmark-caption-2026-07-10-real-30-v2.json",
  montage_planner: "model-benchmark-montage_planner-2026-07-10-real-30-v2.json",
  vision_qa: "model-benchmark-vision_qa-2026-07-10-v7.json"
};

// These MUST mirror the policies the real-30 runs were selected under
// (owner gate decisions 2026-07-10/11: source_policy decision boundary
// floor 0.83; source_search floor 0.93; fail-closed single-route allowed).
const POLICIES: Record<ProductionModelAgentRole, ModelSelectionPolicy> = {
  source_search: { requiresVision: false, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 30, minimumQualityScore: 0.93, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 300_000, allowFailClosedSingleRoute: true },
  source_fit: { requiresVision: true, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 30, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 90_000, allowFailClosedSingleRoute: true },
  source_policy: { requiresVision: true, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 30, minimumQualityScore: 0.83, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 90_000, allowFailClosedSingleRoute: true },
  caption: { requiresVision: true, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 30, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 240_000, allowFailClosedSingleRoute: true },
  montage_planner: { requiresVision: true, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 30, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 240_000, allowFailClosedSingleRoute: true },
  vision_qa: { requiresVision: true, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 3, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 45_000 }
};

type BenchmarkEvidence = {
  benchmarkVersion: string;
  stageRole: string;
  evidenceSha256: string;
  selection: {
    primary: { routeId: string; model: string; reasoningEffort: string };
    fallback: { routeId: string; model: string; reasoningEffort: string } | null;
    fallbackMode: "distinct_route" | "same_route_reasoning" | "fail_closed_none";
  } | null;
  candidates: Array<{
    routeId: string;
    model: string;
    reasoningEffort: string;
    aggregate: { selectorBenchmark: ProductionAgentModelSelection["primary"]["benchmark"] };
  }>;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(canonicalize(value))
  ).digest("hex");
}

async function readEvidence(role: ProductionModelAgentRole): Promise<BenchmarkEvidence> {
  const filePath = path.join(EVIDENCE_ROOT, INPUTS[role]);
  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as BenchmarkEvidence;
  const { evidenceSha256, ...payload } = raw;
  if (sha256(payload) !== evidenceSha256) throw new Error(`${INPUTS[role]} evidence hash mismatch.`);
  if (raw.stageRole !== role || !raw.selection) throw new Error(`${INPUTS[role]} has no PASS selection for ${role}.`);
  return raw;
}

function selectedRoute(
  evidence: BenchmarkEvidence,
  selected: NonNullable<BenchmarkEvidence["selection"]>["primary"]
): ProductionAgentModelSelection["primary"] {
  const registryRoute = PROJECT_KINGS_V1_MODEL_REGISTRY.routes.find((route) => route.routeId === selected.routeId);
  const candidate = evidence.candidates.find((entry) =>
    entry.routeId === selected.routeId && entry.reasoningEffort === selected.reasoningEffort
  );
  if (!registryRoute || !candidate || candidate.model !== selected.model) {
    throw new Error(`Frozen selection ${selected.routeId}/${selected.reasoningEffort} is not backed by registry evidence.`);
  }
  return {
    route: {
      routeId: registryRoute.routeId,
      provider: registryRoute.provider,
      model: registryRoute.model,
      capabilities: {
        vision: registryRoute.capabilities.vision,
        jsonSchema: registryRoute.capabilities.jsonSchema,
        reasoningEfforts: registryRoute.capabilities.reasoningEfforts,
        timeoutMs: registryRoute.capabilities.timeoutMs,
        fallbackRouteIds: registryRoute.capabilities.fallbackRouteIds
      }
    },
    benchmark: candidate.aggregate.selectorBenchmark
  };
}

const evidenceEntries = {} as Record<ProductionModelAgentRole, {
  role: ProductionModelAgentRole;
  benchmarkVersion: string;
  evidenceSha256: string;
}>;
const selections = {} as Record<ProductionModelAgentRole, ProductionAgentModelSelection>;

for (const role of PRODUCTION_MODEL_AGENT_ROLES) {
  const evidence = await readEvidence(role);
  const selected = evidence.selection!;
  evidenceEntries[role] = {
    role,
    benchmarkVersion: evidence.benchmarkVersion,
    evidenceSha256: evidence.evidenceSha256
  };
  // Evidence written before the fallbackMode field existed derives the mode
  // from the recorded selection itself: same routeId with different efforts is
  // the labeled same-route degraded pair; distinct routeIds are distinct.
  const fallbackMode = selected.fallbackMode
    ?? (selected.fallback
      ? (selected.fallback.routeId === selected.primary.routeId ? "same_route_reasoning" : "distinct_route")
      : "fail_closed_none");
  selections[role] = {
    primary: selectedRoute(evidence, selected.primary),
    fallback: selected.fallback ? selectedRoute(evidence, selected.fallback) : null,
    fallbackMode,
    policy: POLICIES[role]
  };
}

const payload = {
  schemaVersion: 3 as const,
  manifestId: "project-kings-model-routes-v3",
  createdAt: new Date().toISOString(),
  evidence: evidenceEntries,
  selections
};
const manifest = parseFrozenProductionAgentRouteManifest({
  ...payload,
  manifestSha256: calculateProductionAgentRouteManifestSha256(payload)
});
await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx"
});
process.stdout.write(`${path.relative(REPO_ROOT, OUTPUT_PATH)} ${manifest.manifestSha256}\n`);
