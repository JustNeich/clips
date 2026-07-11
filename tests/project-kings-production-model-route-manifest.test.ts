import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  calculateProductionAgentRouteManifestSha256,
  loadFrozenProductionAgentRouteManifest,
  parseFrozenProductionAgentRouteManifest,
  ProductionAgentRouteManifestError
} from "../lib/project-kings/production-model-route-manifest";
import {
  PRODUCTION_MODEL_AGENT_ROLES,
  type ProductionModelAgentRole
} from "../lib/project-kings/production-agent-contracts";
import type { ProductionAgentModelSelection } from "../lib/project-kings/production-agent-runtime";

function selection(role: ProductionModelAgentRole): ProductionAgentModelSelection {
  const requiresVision = role === "vision_qa" || role === "source_policy";
  const minimumSampleSize = role === "source_policy" ? 30 : 3;
  const policy = {
    requiresVision,
    requiresJsonSchema: true,
    minimumReasoning: "low" as const,
    minimumContextTokens: 8_000,
    minimumSampleSize,
    minimumQualityScore: 0.8,
    minimumSchemaSuccessRate: 0.9,
    maximumP95LatencyMs: 120_000
  };
  return {
    primary: {
      route: {
        routeId: "codex:primary",
        provider: "codex",
        model: "verified-primary",
        capabilities: {
          vision: true,
          jsonSchema: true,
          reasoningEfforts: ["low", "medium", "high", "x-high"],
          timeoutMs: 120_000,
          fallbackRouteIds: ["codex:fallback"]
        }
      },
      benchmark: {
        benchmarkVersion: "frozen-v5",
        routeId: "codex:primary",
        reasoningEffort: "low",
        sampleSize: role === "source_policy" ? 30 : 5,
        qualityScore: 0.95,
        schemaSuccessRate: 1,
        p95LatencyMs: 10_000,
        meanCost: 2,
        costUnit: "codex_credits"
      }
    },
    fallback: {
      route: {
        routeId: "codex:fallback",
        provider: "codex",
        model: "verified-fallback",
        capabilities: {
          vision: true,
          jsonSchema: true,
          reasoningEfforts: ["low", "medium", "high", "x-high"],
          timeoutMs: 120_000,
          fallbackRouteIds: ["codex:primary"]
        }
      },
      benchmark: {
        benchmarkVersion: "frozen-v5",
        routeId: "codex:fallback",
        reasoningEffort: "low",
        sampleSize: role === "source_policy" ? 30 : 5,
        qualityScore: 0.94,
        schemaSuccessRate: 1,
        p95LatencyMs: 11_000,
        meanCost: 3,
        costUnit: "codex_credits"
      }
    },
    policy
  };
}

function manifestFixture() {
  const payload = {
    schemaVersion: 2 as const,
    manifestId: "project-kings-model-routes-v3",
    createdAt: "2026-07-10T12:00:00.000Z",
    evidence: Object.fromEntries(
      PRODUCTION_MODEL_AGENT_ROLES.map((role, index) => [role, {
        role,
        benchmarkVersion: "frozen-v5",
        evidenceSha256: String(index + 1).repeat(64)
      }])
    ) as Record<ProductionModelAgentRole, {
      role: ProductionModelAgentRole;
      benchmarkVersion: string;
      evidenceSha256: string;
    }>,
    selections: Object.fromEntries(
      PRODUCTION_MODEL_AGENT_ROLES.map((role) => [role, selection(role)])
    ) as Record<ProductionModelAgentRole, ProductionAgentModelSelection>
  };
  return {
    ...payload,
    manifestSha256: calculateProductionAgentRouteManifestSha256(payload)
  };
}

test("frozen route manifest requires hash-bound benchmark selections for every production role", () => {
  const parsed = parseFrozenProductionAgentRouteManifest(manifestFixture(), {
    expectedManifestId: "project-kings-model-routes-v3"
  });
  assert.deepEqual(Object.keys(parsed.selections).sort(), [...PRODUCTION_MODEL_AGENT_ROLES].sort());
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.selections.vision_qa), true);
});

test("frozen route manifest fails closed when a role is missing or the content hash drifts", () => {
  const missingRole = structuredClone(manifestFixture()) as Record<string, unknown> & {
    selections: Record<string, unknown>;
  };
  delete missingRole.selections.source_fit;
  assert.throws(
    () => parseFrozenProductionAgentRouteManifest(missingRole),
    (error: unknown) => error instanceof ProductionAgentRouteManifestError && error.code === "manifest_invalid"
  );

  const original = manifestFixture();
  const tampered = {
    ...original,
    selections: {
      ...original.selections,
      caption: {
        ...original.selections.caption,
        primary: {
          ...original.selections.caption.primary,
          benchmark: {
            ...original.selections.caption.primary.benchmark,
            qualityScore: 0.96
          }
        }
      }
    }
  };
  assert.throws(
    () => parseFrozenProductionAgentRouteManifest(tampered),
    (error: unknown) => error instanceof ProductionAgentRouteManifestError && error.code === "manifest_hash_mismatch"
  );
});

test("frozen route manifest rejects an unbenchmarked or policy-ineligible selection before dispatch", () => {
  const original = manifestFixture();
  const invalidWithoutHash = {
    schemaVersion: original.schemaVersion,
    manifestId: original.manifestId,
    createdAt: original.createdAt,
    evidence: original.evidence,
    selections: {
      ...original.selections,
      vision_qa: {
        ...original.selections.vision_qa,
        primary: {
          ...original.selections.vision_qa.primary,
          route: {
            ...original.selections.vision_qa.primary.route,
            capabilities: {
              ...original.selections.vision_qa.primary.route.capabilities,
              vision: false
            }
          }
        }
      }
    }
  };
  const invalid = {
    ...invalidWithoutHash,
    manifestSha256: calculateProductionAgentRouteManifestSha256(invalidWithoutHash)
  };
  assert.throws(
    () => parseFrozenProductionAgentRouteManifest(invalid),
    (error: unknown) =>
      error instanceof ProductionAgentRouteManifestError &&
      error.code === "manifest_invalid" &&
      /Vision QA/.test(error.message)
  );
});

test("frozen route manifest v3 accepts an explicit fail-closed single-route selection", () => {
  const original = manifestFixture();
  const failClosedVisionQa = {
    ...original.selections.vision_qa,
    fallback: null,
    fallbackMode: "fail_closed_none" as const
  };
  const payload = {
    schemaVersion: 3 as const,
    manifestId: original.manifestId,
    createdAt: original.createdAt,
    evidence: original.evidence,
    selections: {
      ...original.selections,
      vision_qa: failClosedVisionQa
    }
  };
  const manifest = parseFrozenProductionAgentRouteManifest(
    {
      ...payload,
      manifestSha256: calculateProductionAgentRouteManifestSha256(payload)
    },
    { expectedManifestId: "project-kings-model-routes-v3" }
  );
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.selections.vision_qa.fallback, null);
  assert.equal(manifest.selections.vision_qa.fallbackMode, "fail_closed_none");
});

test("frozen route manifest rejects a null fallback that omits explicit fail-closed mode", () => {
  const original = manifestFixture();
  const holeWithoutHash = {
    schemaVersion: 3 as const,
    manifestId: original.manifestId,
    createdAt: original.createdAt,
    evidence: original.evidence,
    selections: {
      ...original.selections,
      vision_qa: { ...original.selections.vision_qa, fallback: null }
    }
  };
  const hole = {
    ...holeWithoutHash,
    manifestSha256: calculateProductionAgentRouteManifestSha256(holeWithoutHash)
  };
  assert.throws(
    () => parseFrozenProductionAgentRouteManifest(hole),
    (error: unknown) =>
      error instanceof ProductionAgentRouteManifestError &&
      error.code === "manifest_invalid" &&
      /fail_closed_none/.test(error.message)
  );
});

test("route-specific benchmark evidence cannot be relabeled as another agent role", () => {
  const original = manifestFixture();
  const relabeledWithoutHash = {
    schemaVersion: original.schemaVersion,
    manifestId: original.manifestId,
    createdAt: original.createdAt,
    selections: original.selections,
    evidence: {
      ...original.evidence,
      caption: {
        ...original.evidence.caption,
        role: "source_fit" as const
      }
    }
  };
  const relabeled = {
    ...relabeledWithoutHash,
    manifestSha256: calculateProductionAgentRouteManifestSha256(relabeledWithoutHash)
  };
  assert.throws(
    () => parseFrozenProductionAgentRouteManifest(relabeled),
    (error: unknown) =>
      error instanceof ProductionAgentRouteManifestError &&
      error.code === "manifest_invalid" &&
      /must equal caption/.test(error.message)
  );
});

test("route manifest loader returns a clear fail-closed blocker when deployment did not configure a file", async () => {
  const previous = process.env.PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH;
  delete process.env.PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH;
  try {
    await assert.rejects(
      loadFrozenProductionAgentRouteManifest({ repoCwd: process.cwd() }),
      (error: unknown) =>
        error instanceof ProductionAgentRouteManifestError && error.code === "manifest_path_missing"
    );
  } finally {
    if (previous === undefined) delete process.env.PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH;
    else process.env.PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH = previous;
  }
});

test("the checked-in v1 Project Kings manifest remains parseable only as historical evidence", async () => {
  const manifestPath = path.resolve(
    "docs/project-kings-production-pipeline-v1/evidence/project-kings-model-routes-v2.json"
  );
  const manifest = parseFrozenProductionAgentRouteManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.manifestId, "project-kings-model-routes-v2");
  assert.equal(manifest.manifestSha256, "f29362a09c0e1a3c98c24a9585759259455703ab8c1c879bc36f8643f2a411de");
  assert.equal(manifest.selections.source_policy, undefined);
  assert.equal(manifest.selections.vision_qa.primary.route.model, "gpt-5.4-mini");
  assert.equal(manifest.selections.vision_qa.fallback?.route.model, "gpt-5.4");
  await assert.rejects(
    loadFrozenProductionAgentRouteManifest({
      repoCwd: process.cwd(),
      manifestPath,
      expectedManifestId: "project-kings-model-routes-v2"
    }),
    (error: unknown) =>
      error instanceof ProductionAgentRouteManifestError &&
      error.code === "manifest_legacy_read_only" &&
      /real source_policy benchmark/i.test(error.message)
  );
});
