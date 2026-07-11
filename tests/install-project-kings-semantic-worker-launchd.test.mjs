import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  buildProjectKingsSemanticWorkerLaunchdPlan,
  buildProjectKingsSemanticWorkerRollbackPlan
} from "../scripts/install-project-kings-semantic-worker-launchd.mjs";

const execFileAsync = promisify(execFile);
const installerPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/install-project-kings-semantic-worker-launchd.mjs"
);
const SAFE_LAUNCHD_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";

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

async function createSemanticWorkerCandidate(root) {
  const bundlePath = path.join(root, "project-kings-semantic-worker.cjs");
  const bundleManifestPath = path.join(root, "manifest.json");
  const routeManifestPath = path.join(root, "route-manifest.json");
  const workerConfigPath = path.join(root, "worker-config.json");
  const codexHome = path.join(root, "codex-home");
  const codexBin = path.join(root, "codex-0.144.1");
  const bundle = Buffer.from(
    `#!/usr/bin/env node\n` +
      `if (process.env.CODEX_BIN !== ${JSON.stringify(codexBin)}) process.exit(41);\n` +
      `console.log('semantic-only');\n`
  );
  await mkdir(codexHome, { recursive: true });
  await writeFile(bundlePath, bundle, { mode: 0o700 });
  await writeFile(codexBin, "#!/bin/sh\nprintf 'codex-cli 0.144.1\\n'\n", { mode: 0o700 });
  await chmod(codexBin, 0o700);
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
  return {
    bundlePath,
    bundleManifestPath,
    routeManifestPath,
    workerConfigPath,
    codexHome,
    codexBin,
    nodePath: process.execPath,
    homeDir: root
  };
}

test("semantic worker launchd dry-run creates one three-lane semantic-only supervisor without credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-launchd-plan-"));
  const installRoot = path.join(root, "install");
  const launchAgentsRoot = path.join(root, "LaunchAgents");
  try {
    const candidate = await createSemanticWorkerCandidate(root);

    const plan = await buildProjectKingsSemanticWorkerLaunchdPlan({
      ...candidate,
      action: "dry-run",
      installRoot,
      launchAgentsRoot
    });
    assert.equal(plan.liveDeployPerformed, false);
    assert.equal(plan.mutationAuthorized, false);
    assert.equal(plan.instanceCount, 1);
    assert.equal(plan.semanticConcurrency, 3);
    assert.equal(plan.renderKindsClaimed, false);
    assert.deepEqual(plan.supportedKinds, ["production-semantic"]);
    assert.equal(plan.credentialsEmbedded, false);
    assert.equal(plan.codexBin, candidate.codexBin);
    assert.equal(plan.codexVersion, "codex-cli 0.144.1");
    assert.equal(plan.routeManifestId, "routes-v3");
    assert.equal(plan.instances.length, 1);
    for (const instance of plan.instances) {
      assert.match(instance.plist, /project-kings-semantic-worker\.cjs/);
      assert.match(instance.plist, /PROJECT_KINGS_SEMANTIC_WORKER_CONFIG_PATH/);
      assert.match(instance.plist, /<key>CODEX_BIN<\/key>/);
      assert.ok(instance.plist.includes(`<string>${candidate.codexBin}</string>`));
      assert.match(
        instance.plist,
        new RegExp(`<key>HOME<\\/key>\\s*<string>${candidate.homeDir}<\\/string>`)
      );
      assert.match(
        instance.plist,
        new RegExp(`<key>PATH<\\/key>\\s*<string>${SAFE_LAUNCHD_PATH}<\\/string>`)
      );
      assert.doesNotMatch(instance.plist, /never-embed-this-token/);
      assert.doesNotMatch(instance.plist, /<string>render<\/string>|<string>preview<\/string>/);
    }
    await assert.rejects(access(installRoot));
    await assert.rejects(access(launchAgentsRoot));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic worker install fails closed without a pinned current Codex executable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-launchd-codex-"));
  try {
    const candidate = await createSemanticWorkerCandidate(root);
    const build = (override = {}) =>
      buildProjectKingsSemanticWorkerLaunchdPlan({
        ...candidate,
        ...override,
        action: "dry-run",
        skipRuntimePreflight: true
      });

    await assert.rejects(() => build({ codexBin: null }), /explicit --codex-bin or CODEX_BIN/);

    await writeFile(candidate.codexBin, "#!/bin/sh\nprintf 'codex-cli 0.131.0\\n'\n");
    await chmod(candidate.codexBin, 0o700);
    await assert.rejects(() => build(), /Codex CLI 0\.144\.1 or newer/);

    await writeFile(candidate.codexBin, "#!/bin/sh\nprintf 'not-a-codex-version\\n'\n");
    await chmod(candidate.codexBin, 0o700);
    await assert.rejects(() => build(), /unparseable version/);

    await chmod(candidate.codexBin, 0o600);
    await assert.rejects(() => build(), /existing executable regular non-symlink file/);

    await rm(candidate.codexBin);
    await assert.rejects(() => build(), /existing executable regular non-symlink file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic worker install creates a missing version store before staging the release", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantic-launchd-install-"));
  const installRoot = path.join(root, "missing-install-root");
  const launchAgentsRoot = path.join(root, "missing-launch-agents");
  const fakeBin = path.join(root, "fake-bin");
  try {
    const candidate = await createSemanticWorkerCandidate(root);
    await mkdir(fakeBin, { recursive: true });
    await writeFile(path.join(fakeBin, "launchctl"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        installerPath,
        "--install",
        "--install-root",
        installRoot,
        "--launch-agents-root",
        launchAgentsRoot,
        "--bundle",
        candidate.bundlePath,
        "--bundle-manifest",
        candidate.bundleManifestPath,
        "--route-manifest",
        candidate.routeManifestPath,
        "--worker-config",
        candidate.workerConfigPath,
        "--codex-home",
        candidate.codexHome,
        "--codex-bin",
        candidate.codexBin,
        "--node",
        candidate.nodePath
      ],
      {
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`
        },
        timeout: 30_000
      }
    );
    const result = JSON.parse(stdout);
    const versionsStat = await stat(result.versionsRoot);
    assert.equal(versionsStat.isDirectory(), true);
    assert.equal(versionsStat.mode & 0o777, 0o700);
    assert.equal((await stat(result.versionDir)).isDirectory(), true);
    assert.equal(await realpath(result.currentLink), await realpath(result.versionDir));
    const plist = await readFile(result.instances[0].plistPath, "utf-8");
    assert.ok(plist.includes(`<key>HOME</key>\n    <string>${os.homedir()}</string>`));
    assert.ok(plist.includes(`<key>PATH</key>\n    <string>${SAFE_LAUNCHD_PATH}</string>`));
    assert.doesNotMatch(plist, /never-embed-this-token/);
    if (process.platform === "darwin") {
      await execFileAsync("/usr/bin/plutil", ["-lint", result.instances[0].plistPath]);
    }
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
