import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  validateProductionAgentModelSelection,
  type ProductionAgentModelSelection
} from "./production-agent-runtime";
import {
  PRODUCTION_MODEL_AGENT_ROLES,
  type ProductionModelAgentRole
} from "./production-agent-contracts";

export const PROJECT_KINGS_ROUTE_MANIFEST_ENV = "PORTFOLIO_PIPELINE_ROUTE_MANIFEST_PATH";

export type ProductionAgentRouteManifestEvidence = Readonly<{
  role: ProductionModelAgentRole;
  benchmarkVersion: string;
  evidenceSha256: string;
}>;

export type LegacyProductionModelAgentRole = Exclude<
  ProductionModelAgentRole,
  "source_policy"
>;

export const LEGACY_PRODUCTION_MODEL_AGENT_ROLES = [
  "source_search",
  "source_fit",
  "caption",
  "montage_planner",
  "vision_qa"
] as const satisfies readonly LegacyProductionModelAgentRole[];

export type FrozenProductionAgentRouteManifest = Readonly<{
  schemaVersion: 1 | 2;
  manifestId: string;
  createdAt: string;
  evidence: Readonly<
    Record<LegacyProductionModelAgentRole, ProductionAgentRouteManifestEvidence> &
      Partial<Record<"source_policy", ProductionAgentRouteManifestEvidence>>
  >;
  selections: Readonly<
    Record<LegacyProductionModelAgentRole, ProductionAgentModelSelection> &
      Partial<Record<"source_policy", ProductionAgentModelSelection>>
  >;
  manifestSha256: string;
}>;

export type ProductionReadyAgentRouteManifest = Readonly<{
  schemaVersion: 2;
  manifestId: string;
  createdAt: string;
  evidence: Readonly<Record<ProductionModelAgentRole, ProductionAgentRouteManifestEvidence>>;
  selections: Readonly<Record<ProductionModelAgentRole, ProductionAgentModelSelection>>;
  manifestSha256: string;
}>;

export class ProductionAgentRouteManifestError extends Error {
  readonly code:
    | "manifest_path_missing"
    | "manifest_read_failed"
    | "manifest_invalid"
    | "manifest_hash_mismatch"
    | "manifest_id_mismatch"
    | "manifest_legacy_read_only";

  constructor(code: ProductionAgentRouteManifestError["code"], message: string) {
    super(message);
    this.name = "ProductionAgentRouteManifestError";
    this.code = code;
  }
}

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

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProductionAgentRouteManifestError("manifest_invalid", `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ProductionAgentRouteManifestError(
      "manifest_invalid",
      `${field} must contain exactly: ${wanted.join(", ")}.`
    );
  }
}

export function calculateProductionAgentRouteManifestSha256(
  manifest: Omit<FrozenProductionAgentRouteManifest, "manifestSha256"> | Record<string, unknown>
): string {
  const payload = { ...(manifest as Record<string, unknown>) };
  delete payload.manifestSha256;
  return createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");
}

export function parseFrozenProductionAgentRouteManifest(
  raw: unknown,
  input: { expectedManifestId?: string | null } = {}
): FrozenProductionAgentRouteManifest {
  if (!isRecord(raw)) {
    throw new ProductionAgentRouteManifestError("manifest_invalid", "Route manifest must be a JSON object.");
  }
  exactKeys(
    raw,
    ["schemaVersion", "manifestId", "createdAt", "evidence", "selections", "manifestSha256"],
    "manifest"
  );
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) {
    throw new ProductionAgentRouteManifestError(
      "manifest_invalid",
      "manifest.schemaVersion must equal 1 (legacy read-only) or 2 (production)."
    );
  }
  const schemaVersion = raw.schemaVersion;
  const manifestRoles = schemaVersion === 1
    ? LEGACY_PRODUCTION_MODEL_AGENT_ROLES
    : PRODUCTION_MODEL_AGENT_ROLES;
  const manifestId = requiredText(raw.manifestId, "manifest.manifestId");
  if (input.expectedManifestId && manifestId !== input.expectedManifestId) {
    throw new ProductionAgentRouteManifestError(
      "manifest_id_mismatch",
      `Frozen route manifest ${manifestId} does not match expected ${input.expectedManifestId}.`
    );
  }
  const createdAt = requiredText(raw.createdAt, "manifest.createdAt");
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new ProductionAgentRouteManifestError("manifest_invalid", "manifest.createdAt must be an ISO timestamp.");
  }
  if (!isRecord(raw.selections)) {
    throw new ProductionAgentRouteManifestError("manifest_invalid", "manifest.selections must be an object.");
  }
  if (!isRecord(raw.evidence)) {
    throw new ProductionAgentRouteManifestError("manifest_invalid", "manifest.evidence must be an object.");
  }
  exactKeys(raw.selections, manifestRoles, "manifest.selections");
  exactKeys(raw.evidence, manifestRoles, "manifest.evidence");
  const selections: Partial<Record<ProductionModelAgentRole, ProductionAgentModelSelection>> = {};
  const evidence: Partial<Record<ProductionModelAgentRole, ProductionAgentRouteManifestEvidence>> = {};
  for (const role of manifestRoles) {
    const selection = raw.selections[role];
    if (!isRecord(selection)) {
      throw new ProductionAgentRouteManifestError(
        "manifest_invalid",
        `manifest.selections.${role} must be an object.`
      );
    }
    try {
      validateProductionAgentModelSelection(selection as ProductionAgentModelSelection, role);
    } catch (error) {
      throw new ProductionAgentRouteManifestError(
        "manifest_invalid",
        `manifest.selections.${role} failed production validation: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    selections[role] = structuredClone(selection) as ProductionAgentModelSelection;
    const roleEvidence = raw.evidence[role];
    if (!isRecord(roleEvidence)) {
      throw new ProductionAgentRouteManifestError(
        "manifest_invalid",
        `manifest.evidence.${role} must be an object.`
      );
    }
    exactKeys(roleEvidence, ["role", "benchmarkVersion", "evidenceSha256"], `manifest.evidence.${role}`);
    if (roleEvidence.role !== role) {
      throw new ProductionAgentRouteManifestError(
        "manifest_invalid",
        `manifest.evidence.${role}.role must equal ${role}.`
      );
    }
    const benchmarkVersion = requiredText(
      roleEvidence.benchmarkVersion,
      `manifest.evidence.${role}.benchmarkVersion`
    );
    if (
      benchmarkVersion !== selections[role].primary.benchmark.benchmarkVersion ||
      benchmarkVersion !== selections[role].fallback.benchmark.benchmarkVersion
    ) {
      throw new ProductionAgentRouteManifestError(
        "manifest_invalid",
        `manifest.evidence.${role}.benchmarkVersion does not match its frozen primary/fallback selection.`
      );
    }
    const evidenceSha256 = requiredText(
      roleEvidence.evidenceSha256,
      `manifest.evidence.${role}.evidenceSha256`
    ).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(evidenceSha256)) {
      throw new ProductionAgentRouteManifestError(
        "manifest_invalid",
        `manifest.evidence.${role}.evidenceSha256 must be a lowercase SHA-256 digest.`
      );
    }
    evidence[role] = { role, benchmarkVersion, evidenceSha256 };
  }
  const manifestSha256 = requiredText(raw.manifestSha256, "manifest.manifestSha256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(manifestSha256)) {
    throw new ProductionAgentRouteManifestError(
      "manifest_invalid",
      "manifest.manifestSha256 must be a lowercase SHA-256 digest."
    );
  }
  const calculated = calculateProductionAgentRouteManifestSha256({
    schemaVersion,
    manifestId,
    createdAt,
    evidence,
    selections
  });
  if (calculated !== manifestSha256) {
    throw new ProductionAgentRouteManifestError(
      "manifest_hash_mismatch",
      `Frozen route manifest hash mismatch: expected ${manifestSha256}, calculated ${calculated}.`
    );
  }
  return deepFreeze({
    schemaVersion,
    manifestId,
    createdAt,
    evidence,
    selections,
    manifestSha256
  }) as FrozenProductionAgentRouteManifest;
}

export async function loadFrozenProductionAgentRouteManifest(input: {
  repoCwd: string;
  manifestPath?: string | null;
  expectedManifestId?: string | null;
}): Promise<ProductionReadyAgentRouteManifest> {
  const configuredPath = input.manifestPath?.trim() || process.env[PROJECT_KINGS_ROUTE_MANIFEST_ENV]?.trim();
  if (!configuredPath) {
    throw new ProductionAgentRouteManifestError(
      "manifest_path_missing",
      `${PROJECT_KINGS_ROUTE_MANIFEST_ENV} is not configured; live background dispatch remains disabled.`
    );
  }
  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(input.repoCwd, configuredPath);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new ProductionAgentRouteManifestError(
      "manifest_read_failed",
      `Cannot read frozen route manifest at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parsed = parseFrozenProductionAgentRouteManifest(raw, {
    expectedManifestId: input.expectedManifestId
  });
  if (
    parsed.schemaVersion !== 2 ||
    !parsed.selections.source_policy ||
    !parsed.evidence.source_policy
  ) {
    throw new ProductionAgentRouteManifestError(
      "manifest_legacy_read_only",
      "Route manifest schema v1 is historical read-only evidence. Production remains blocked until a schema v2 manifest includes a real source_policy benchmark selection."
    );
  }
  return parsed as ProductionReadyAgentRouteManifest;
}
