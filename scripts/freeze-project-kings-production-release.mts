import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  buildProjectKingsProductionReleaseManifest,
  isProjectKingsReleaseIncludedPath,
  isProjectKingsReleaseProhibitedPath,
  normalizeProductionReleasePath,
  verifyProjectKingsProductionReleaseManifest,
  type ProductionReleaseEvidence,
  type ProductionReleaseFile
} from "../lib/project-kings/production-release-manifest";

const repoRoot = path.resolve(import.meta.dirname, "..");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function boolArgument(name: string, fallback: boolean): boolean {
  const raw = argument(name);
  if (raw === null) return fallback;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new Error(`${name} must be true|false|1|0.`);
}

function relativeToRepo(value: string): string {
  const absolute = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
  const relative = normalizeProductionReleasePath(path.relative(repoRoot, absolute));
  if (relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`Release artifact escapes repository root: ${value}`);
  }
  return relative;
}

function gitLines(args: string[]): string[] {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function sha256File(relativePath: string): Promise<{ sha256: string; bytes: number }> {
  const bytes = await fs.readFile(path.join(repoRoot, relativePath));
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength
  };
}

async function releaseFile(relativePath: string): Promise<ProductionReleaseFile> {
  const pathName = normalizeProductionReleasePath(relativePath);
  try {
    const value = await sha256File(pathName);
    return { path: pathName, state: "present", ...value };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: pathName, state: "deleted", sha256: null, bytes: null };
    }
    throw error;
  }
}

async function evidence(
  id: string,
  kind: ProductionReleaseEvidence["kind"],
  value: string
): Promise<ProductionReleaseEvidence> {
  const relativePath = relativeToRepo(value);
  const { sha256 } = await sha256File(relativePath);
  return { id, kind, path: relativePath, sha256 };
}

const outputPath = relativeToRepo(
  argument("--out") ??
    "docs/project-kings-production-pipeline-v1/evidence/production-release-manifest.json"
);
const gitBase = execFileSync("git", ["rev-parse", requiredArgument("--base-ref")], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim();
const testOutputPath = requiredArgument("--test-output");
const profileSnapshotPath = argument("--profiles") ??
  "docs/project-kings-production-pipeline-v1/evidence/project-kings-production-profiles-v1.json";
const modelRoutesPath = argument("--model-routes") ??
  "docs/project-kings-production-pipeline-v1/evidence/project-kings-model-routes-v2.json";
const sourceBufferPath = argument("--source-buffer") ??
  "docs/project-kings-production-pipeline-v1/evidence/source-buffer-readiness-2026-07-10-v13.json";
const rightsPolicyPath = argument("--rights-policy") ??
  "docs/project-kings-production-pipeline-v1/source-rights-sensitive-content-policy.md";
const auditPath = argument("--audit") ??
  ".assistant/audits/2026-07-10-project-kings-v1/audit_packet.md";
const runtimeContractPath = argument("--runtime-contract") ??
  "docs/project-kings-production-pipeline-v1/persistent-runtime.md";

const changedPaths = new Set<string>([
  ...gitLines(["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${gitBase}..HEAD`]),
  ...gitLines(["diff", "--name-only", "--diff-filter=ACDMRTUXB", "HEAD"]),
  ...gitLines(["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB", "HEAD"]),
  ...gitLines(["ls-files", "--others", "--exclude-standard"])
].map(normalizeProductionReleasePath));
changedPaths.delete(outputPath);

const excludedDirtyPaths: string[] = [];
const shippingPaths: string[] = [];
for (const changedPath of [...changedPaths].sort()) {
  if (isProjectKingsReleaseProhibitedPath(changedPath)) {
    excludedDirtyPaths.push(changedPath);
  } else if (isProjectKingsReleaseIncludedPath(changedPath)) {
    shippingPaths.push(changedPath);
  } else {
    throw new Error(`Dirty path is neither shipping nor explicitly prohibited: ${changedPath}`);
  }
}

const includedFiles = await Promise.all(shippingPaths.map(releaseFile));
const evidenceEntries = await Promise.all([
  evidence("profile-snapshot", "profile_snapshot", profileSnapshotPath),
  evidence("model-route-manifest", "model_routes", modelRoutesPath),
  evidence("source-buffer-readiness", "source_buffer", sourceBufferPath),
  evidence("source-rights-policy", "rights_policy", rightsPolicyPath),
  evidence("critical-test-output", "test_output", testOutputPath),
  evidence("first-pass-audit", "audit", auditPath),
  evidence("persistent-runtime-contract", "runtime_contract", runtimeContractPath)
]);
const schemaBinding = await sha256File("lib/db/schema.ts");
const migrationBinding = await sha256File("lib/db/client.ts");
const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim();

const manifest = buildProjectKingsProductionReleaseManifest({
  gitBase,
  gitHead,
  generatedAt: new Date().toISOString(),
  includedFiles,
  excludedDirtyPaths,
  evidence: evidenceEntries,
  schemaBindingSha256: schemaBinding.sha256,
  migrationBindingSha256: migrationBinding.sha256,
  featureFlags: {
    portfolioPipelineV1: boolArgument("--portfolio-flag", false),
    portfolioPipelinePostCanary: boolArgument("--post-canary-flag", false),
    shadowOnly: boolArgument("--shadow-only", true)
  }
});
verifyProjectKingsProductionReleaseManifest(manifest);

const absoluteOutput = path.join(repoRoot, outputPath);
await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
const temporary = `${absoluteOutput}.${process.pid}.tmp`;
await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await fs.rename(temporary, absoluteOutput);
process.stdout.write(`${JSON.stringify({
  outputPath,
  releaseCandidateSha256: manifest.releaseCandidateSha256,
  includedFileCount: manifest.includedFiles.length,
  excludedDirtyPaths: manifest.exclusions.dirtyPaths,
  evidenceCount: manifest.evidence.length,
  featureFlags: manifest.featureFlags
}, null, 2)}\n`);
