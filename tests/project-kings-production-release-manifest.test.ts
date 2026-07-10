import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectKingsProductionReleaseManifest,
  isProjectKingsReleaseIncludedPath,
  isProjectKingsReleaseProhibitedPath,
  verifyProjectKingsProductionReleaseManifest
} from "../lib/project-kings/production-release-manifest";

const HASH = "a".repeat(64);

function validInput() {
  return {
    gitBase: "c".repeat(40),
    gitHead: "b".repeat(40),
    generatedAt: "2026-07-10T12:00:00.000Z",
    includedFiles: [
      { path: "lib/project-kings/example.ts", state: "present" as const, sha256: HASH, bytes: 42 },
      { path: "tests/removed.test.ts", state: "deleted" as const, sha256: null, bytes: null }
    ],
    excludedDirtyPaths: ["AGENTS.md", ".tmp/cache-keys.mts", "experiments/probe.ts"],
    evidence: [
      { id: "profiles", path: "docs/profiles.json", sha256: HASH, kind: "profile_snapshot" as const },
      { id: "models", path: "docs/models.json", sha256: HASH, kind: "model_routes" as const },
      { id: "sources", path: "docs/sources.json", sha256: HASH, kind: "source_buffer" as const },
      { id: "rights", path: "docs/rights.json", sha256: HASH, kind: "rights_policy" as const },
      { id: "tests", path: "docs/tests.txt", sha256: HASH, kind: "test_output" as const },
      { id: "audit", path: "docs/audit.md", sha256: HASH, kind: "audit" as const },
      { id: "runtime", path: "docs/runtime.md", sha256: HASH, kind: "runtime_contract" as const }
    ],
    schemaBindingSha256: HASH,
    migrationBindingSha256: HASH,
    featureFlags: {
      portfolioPipelineV1: false,
      portfolioPipelinePostCanary: false,
      shadowOnly: true
    }
  };
}

test("release manifest is canonical, verifiable and insensitive to generation time", () => {
  const first = buildProjectKingsProductionReleaseManifest(validInput());
  const second = buildProjectKingsProductionReleaseManifest({
    ...validInput(),
    generatedAt: "2026-07-10T13:00:00.000Z",
    includedFiles: [...validInput().includedFiles].reverse(),
    evidence: [...validInput().evidence].reverse()
  });
  assert.equal(first.releaseCandidateSha256, second.releaseCandidateSha256);
  verifyProjectKingsProductionReleaseManifest(first);
});

test("release path policy includes shipping surfaces and excludes owner scratch", () => {
  assert.equal(isProjectKingsReleaseIncludedPath("lib/project-kings/a.ts"), true);
  assert.equal(isProjectKingsReleaseIncludedPath("package.json"), true);
  assert.equal(isProjectKingsReleaseProhibitedPath("AGENTS.md"), true);
  assert.equal(isProjectKingsReleaseProhibitedPath(".tmp/cache-keys.mts"), true);
  assert.equal(isProjectKingsReleaseProhibitedPath("experiments/probe.ts"), true);
});

test("release manifest fails closed on prohibited and undeclared paths", () => {
  assert.throws(
    () => buildProjectKingsProductionReleaseManifest({
      ...validInput(),
      includedFiles: [{ path: ".tmp/cache-keys.mts", state: "present", sha256: HASH, bytes: 1 }]
    }),
    /Prohibited path/
  );
  assert.throws(
    () => buildProjectKingsProductionReleaseManifest({
      ...validInput(),
      includedFiles: [{ path: "random.txt", state: "present", sha256: HASH, bytes: 1 }]
    }),
    /outside the release allow-list/
  );
  assert.throws(
    () => buildProjectKingsProductionReleaseManifest({
      ...validInput(),
      excludedDirtyPaths: ["lib/secret-change.ts"]
    }),
    /Only explicitly prohibited/
  );
});

test("release manifest requires every critical evidence kind", () => {
  assert.throws(
    () => buildProjectKingsProductionReleaseManifest({
      ...validInput(),
      evidence: validInput().evidence.filter((entry) => entry.kind !== "rights_policy")
    }),
    /rights_policy/
  );
});

test("release manifest detects payload tampering", () => {
  const manifest = buildProjectKingsProductionReleaseManifest(validInput());
  assert.throws(
    () => verifyProjectKingsProductionReleaseManifest({
      ...manifest,
      includedFiles: manifest.includedFiles.map((file, index) =>
        index === 0 ? { ...file, bytes: 43 } : file
      )
    }),
    /does not match/
  );
});
