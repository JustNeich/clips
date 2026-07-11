import { createHash } from "node:crypto";

export const PROJECT_KINGS_RELEASE_MANIFEST_SCHEMA = "project-kings-production-release-v1";

export const PROJECT_KINGS_RELEASE_INCLUDED_PREFIXES = Object.freeze([
  "app/",
  "apps/",
  "docs/",
  "lib/",
  "scripts/",
  "support/",
  "tests/"
]);

export const PROJECT_KINGS_RELEASE_INCLUDED_ROOT_FILES = Object.freeze([
  ".env.example",
  ".gitignore",
  "instrumentation.ts",
  "package.json",
  "package-lock.json"
]);

export const PROJECT_KINGS_RELEASE_PROHIBITED_PATHS = Object.freeze([
  { pattern: "AGENTS.md", reason: "owner instructions are not a deployable application artifact" },
  { pattern: ".tmp/**", reason: "local scratch and secrets-adjacent cache material" },
  { pattern: "experiments/**", reason: "non-shipping experiments" }
]);

export type ProductionReleaseFile = Readonly<{
  path: string;
  state: "present" | "deleted";
  sha256: string | null;
  bytes: number | null;
}>;

export type ProductionReleaseEvidence = Readonly<{
  id: string;
  path: string;
  sha256: string;
  kind: "profile_snapshot" | "model_routes" | "source_buffer" | "rights_policy" | "test_output" | "audit" | "runtime_contract" | "other";
}>;

export type ProductionReleaseManifestInput = Readonly<{
  gitBase: string;
  gitHead: string;
  generatedAt: string;
  includedFiles: readonly ProductionReleaseFile[];
  excludedDirtyPaths: readonly string[];
  evidence: readonly ProductionReleaseEvidence[];
  schemaBindingSha256: string;
  migrationBindingSha256: string;
  featureFlags: Readonly<{
    portfolioPipelineV1: boolean;
    portfolioPipelinePostCanary: boolean;
    shadowOnly: boolean;
  }>;
}>;

export type ProductionReleaseManifest = Readonly<{
  schemaVersion: typeof PROJECT_KINGS_RELEASE_MANIFEST_SCHEMA;
  releaseCandidateSha256: string;
  generatedAt: string;
  gitBase: string;
  gitHead: string;
  includedFiles: readonly ProductionReleaseFile[];
  exclusions: {
    rules: typeof PROJECT_KINGS_RELEASE_PROHIBITED_PATHS;
    dirtyPaths: readonly string[];
  };
  evidence: readonly ProductionReleaseEvidence[];
  bindings: {
    schemaSha256: string;
    migrationSha256: string;
  };
  featureFlags: ProductionReleaseManifestInput["featureFlags"];
}>;

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

export function canonicalProductionReleaseJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256ProductionReleaseValue(value: unknown): string {
  return createHash("sha256").update(canonicalProductionReleaseJson(value)).digest("hex");
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256.`);
}

export function normalizeProductionReleasePath(value: string): string {
  const path = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").includes("..") || path.includes("\0")) {
    throw new Error(`Unsafe release path: ${value}`);
  }
  return path;
}

export function isProjectKingsReleaseProhibitedPath(value: string): boolean {
  const path = normalizeProductionReleasePath(value);
  return path === "AGENTS.md" || path === ".tmp" || path.startsWith(".tmp/") ||
    path === "experiments" || path.startsWith("experiments/");
}

export function isProjectKingsReleaseIncludedPath(value: string): boolean {
  const path = normalizeProductionReleasePath(value);
  return PROJECT_KINGS_RELEASE_INCLUDED_ROOT_FILES.includes(
    path as (typeof PROJECT_KINGS_RELEASE_INCLUDED_ROOT_FILES)[number]
  ) || PROJECT_KINGS_RELEASE_INCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function normalizeIncludedFile(file: ProductionReleaseFile): ProductionReleaseFile {
  const path = normalizeProductionReleasePath(file.path);
  if (isProjectKingsReleaseProhibitedPath(path)) {
    throw new Error(`Prohibited path cannot enter release manifest: ${path}`);
  }
  if (!isProjectKingsReleaseIncludedPath(path)) {
    throw new Error(`Path is outside the release allow-list: ${path}`);
  }
  if (file.state === "present") {
    if (file.sha256 === null || file.bytes === null || file.bytes < 0) {
      throw new Error(`Present release file is missing hash or size: ${path}`);
    }
    assertSha256(file.sha256, `${path}.sha256`);
  } else if (file.sha256 !== null || file.bytes !== null) {
    throw new Error(`Deleted release file must use null hash and size: ${path}`);
  }
  return { ...file, path };
}

function normalizeEvidence(entry: ProductionReleaseEvidence): ProductionReleaseEvidence {
  const path = normalizeProductionReleasePath(entry.path);
  assertSha256(entry.sha256, `${entry.id}.sha256`);
  if (!entry.id.trim()) throw new Error("Release evidence id is required.");
  return { ...entry, id: entry.id.trim(), path };
}

export function buildProjectKingsProductionReleaseManifest(
  input: ProductionReleaseManifestInput
): ProductionReleaseManifest {
  if (!/^[a-f0-9]{40,64}$/.test(input.gitBase)) {
    throw new Error("gitBase must be a lowercase Git object id.");
  }
  if (!/^[a-f0-9]{40,64}$/.test(input.gitHead)) {
    throw new Error("gitHead must be a lowercase Git object id.");
  }
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error("generatedAt must be ISO-8601.");
  assertSha256(input.schemaBindingSha256, "schemaBindingSha256");
  assertSha256(input.migrationBindingSha256, "migrationBindingSha256");

  const includedFiles = input.includedFiles.map(normalizeIncludedFile)
    .sort((left, right) => left.path.localeCompare(right.path));
  if (!includedFiles.length) throw new Error("Release manifest requires included files.");
  if (new Set(includedFiles.map((file) => file.path)).size !== includedFiles.length) {
    throw new Error("Release manifest contains duplicate included paths.");
  }

  const evidence = input.evidence.map(normalizeEvidence)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(evidence.map((entry) => entry.id)).size !== evidence.length) {
    throw new Error("Release manifest contains duplicate evidence ids.");
  }
  const requiredEvidenceKinds = new Set([
    "profile_snapshot",
    "model_routes",
    "source_buffer",
    "rights_policy",
    "test_output",
    "audit",
    "runtime_contract"
  ]);
  for (const entry of evidence) requiredEvidenceKinds.delete(entry.kind);
  if (requiredEvidenceKinds.size) {
    throw new Error(`Release manifest is missing evidence kinds: ${[...requiredEvidenceKinds].sort().join(", ")}`);
  }

  const excludedDirtyPaths = [...new Set(input.excludedDirtyPaths.map(normalizeProductionReleasePath))].sort();
  if (excludedDirtyPaths.some((path) => !isProjectKingsReleaseProhibitedPath(path))) {
    throw new Error("Only explicitly prohibited owner/scratch paths may be excluded from a dirty release tree.");
  }

  const identity = {
    schemaVersion: PROJECT_KINGS_RELEASE_MANIFEST_SCHEMA,
    gitBase: input.gitBase,
    gitHead: input.gitHead,
    includedFiles,
    exclusions: {
      rules: PROJECT_KINGS_RELEASE_PROHIBITED_PATHS,
      dirtyPaths: excludedDirtyPaths
    },
    evidence,
    bindings: {
      schemaSha256: input.schemaBindingSha256,
      migrationSha256: input.migrationBindingSha256
    },
    featureFlags: input.featureFlags
  } as const;
  return {
    ...identity,
    generatedAt: new Date(input.generatedAt).toISOString(),
    releaseCandidateSha256: sha256ProductionReleaseValue(identity)
  };
}

export function verifyProjectKingsProductionReleaseManifest(manifest: ProductionReleaseManifest): void {
  const rebuilt = buildProjectKingsProductionReleaseManifest({
    gitBase: manifest.gitBase,
    gitHead: manifest.gitHead,
    generatedAt: manifest.generatedAt,
    includedFiles: manifest.includedFiles,
    excludedDirtyPaths: manifest.exclusions.dirtyPaths,
    evidence: manifest.evidence,
    schemaBindingSha256: manifest.bindings.schemaSha256,
    migrationBindingSha256: manifest.bindings.migrationSha256,
    featureFlags: manifest.featureFlags
  });
  if (rebuilt.releaseCandidateSha256 !== manifest.releaseCandidateSha256) {
    throw new Error("Release candidate hash does not match the manifest payload.");
  }
}
