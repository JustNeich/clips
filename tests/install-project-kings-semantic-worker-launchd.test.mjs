import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildProjectKingsSemanticWorkerLaunchdPlan,
  buildProjectKingsSemanticWorkerRollbackPlan
} from "../scripts/install-project-kings-semantic-worker-launchd.mjs";

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  }
  return value;
}

test("semantic worker launchd dry-run creates one three-lane semantic-only supervisor without credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-launchd-plan-"));
  const bundlePath = path.join(root, "project-kings-semantic-worker.cjs");
  const bundleManifestPath = path.join(root, "manifest.json");
  const routeManifestPath = path.join(root, "route-manifest.json");
  const workerConfigPath = path.join(root, "worker-config.json");
  const installRoot = path.join(root, "install");
  const launchAgentsRoot = path.join(root, "LaunchAgents");
  const bundle = Buffer.from("#!/usr/bin/env node\nconsole.log('semantic-only');\n");
  try {
    await writeFile(bundlePath, bundle, { mode: 0o700 });
    const unsignedManifest = {
        schemaVersion: "project-kings-semantic-worker-bundle-v1",
        semanticRuntimeVersion: "project-kings-semantic-v1+test",
        stage3AppVersion: "1.0.0+runtime.test",
        bundleSha256: sha(bundle),
        bundleSizeBytes: bundle.byteLength,
        supportedKinds: ["production-semantic"],
        maxConcurrentJobsPerProcess: 3,
        intendedLaunchdInstances: 1,
        credentialsInBundle: false
      };
    await writeFile(
      bundleManifestPath,
      JSON.stringify({
        ...unsignedManifest,
        manifestSha256: sha(JSON.stringify(canonical(unsignedManifest)))
      })
    );
    await writeFile(
      routeManifestPath,
      JSON.stringify({
        schemaVersion: 3,
        manifestId: "routes-v3",
        manifestSha256: "b".repeat(64)
      })
    );
    await writeFile(
      workerConfigPath,
      JSON.stringify({
        serverOrigin: "https://clips.example.test",
        sessionToken: "never-embed-this-token",
        workerId: "worker-1",
        label: "Semantic"
      }),
      { mode: 0o600 }
    );
    await chmod(workerConfigPath, 0o600);

    const plan = await buildProjectKingsSemanticWorkerLaunchdPlan({
      action: "dry-run",
      bundlePath,
      bundleManifestPath,
      routeManifestPath,
      workerConfigPath,
      codexHome: path.join(root, "codex-home"),
      nodePath: process.execPath,
      homeDir: root,
      installRoot,
      launchAgentsRoot,
      skipRuntimePreflight: true
    });
    assert.equal(plan.liveDeployPerformed, false);
    assert.equal(plan.mutationAuthorized, false);
    assert.equal(plan.instanceCount, 1);
    assert.equal(plan.semanticConcurrency, 3);
    assert.equal(plan.renderKindsClaimed, false);
    assert.deepEqual(plan.supportedKinds, ["production-semantic"]);
    assert.equal(plan.credentialsEmbedded, false);
    assert.equal(plan.routeManifestId, "routes-v3");
    assert.equal(plan.instances.length, 1);
    for (const instance of plan.instances) {
      assert.match(instance.plist, /project-kings-semantic-worker\.cjs/);
      assert.match(instance.plist, /PROJECT_KINGS_SEMANTIC_WORKER_CONFIG_PATH/);
      assert.doesNotMatch(instance.plist, /never-embed-this-token/);
      assert.doesNotMatch(instance.plist, /<string>render<\/string>|<string>preview<\/string>/);
    }
    await assert.rejects(access(installRoot));
    await assert.rejects(access(launchAgentsRoot));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback planning uses installed state and does not depend on a new candidate or credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-launchd-rollback-"));
  const installRoot = path.join(root, "install");
  const currentVersion = path.join(installRoot, "versions", "current-version");
  const previousVersion = path.join(installRoot, "versions", "previous-version");
  try {
    await Promise.all([
      mkdir(currentVersion, { recursive: true }),
      mkdir(previousVersion, { recursive: true })
    ]);
    await symlink(currentVersion, path.join(installRoot, "current"));
    await writeFile(
      path.join(installRoot, "install-state.json"),
      JSON.stringify({
        schemaVersion: "project-kings-semantic-worker-install-state-v1",
        currentVersionDir: currentVersion,
        previousVersionDir: previousVersion
      }),
      { mode: 0o600 }
    );
    const plan = await buildProjectKingsSemanticWorkerRollbackPlan({
      homeDir: root,
      installRoot,
      launchAgentsRoot: path.join(root, "LaunchAgents")
    });
    assert.equal(plan.action, "rollback");
    assert.equal(plan.currentVersionDir, await realpath(currentVersion));
    assert.equal(plan.previousVersionDir, await realpath(previousVersion));
    assert.equal(plan.instances.length, 1);
    assert.equal(plan.semanticConcurrency, 3);
    assert.equal(plan.credentialsEmbedded, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
