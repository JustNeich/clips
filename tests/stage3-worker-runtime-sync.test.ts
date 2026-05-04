import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveStage3WorkerAdvertisedVersion,
  shouldRestartStage3WorkerAfterSync
} from "../lib/stage3-worker-runtime-sync";
import {
  isStage3WorkerRuntimeDependenciesArchiveCompatible,
  resolveStage3WorkerRuntimeDependenciesPlatform
} from "../lib/stage3-worker-runtime";

test("worker advertises the bundled runtime version instead of the downloaded manifest version", () => {
  assert.equal(
    resolveStage3WorkerAdvertisedVersion({
      bundledRuntimeVersion: "1.0.0+20260413170000",
      packageVersion: "1.0.0"
    }),
    "1.0.0+20260413170000"
  );
});

test("worker falls back to package version when the bundle has no embedded runtime version", () => {
  assert.equal(
    resolveStage3WorkerAdvertisedVersion({
      bundledRuntimeVersion: null,
      packageVersion: "1.0.0"
    }),
    "1.0.0"
  );
});

test("worker must restart after syncing a newer runtime than the currently running bundle", () => {
  assert.equal(
    shouldRestartStage3WorkerAfterSync({
      bundledRuntimeVersion: "1.0.0+20260413170000",
      syncResult: {
        updated: true,
        runtimeVersion: "1.0.0+20260413180500"
      }
    }),
    true
  );
});

test("worker does not restart when sync confirms the currently running runtime", () => {
  assert.equal(
    shouldRestartStage3WorkerAfterSync({
      bundledRuntimeVersion: "1.0.0+20260413180500",
      syncResult: {
        updated: false,
        runtimeVersion: "1.0.0+20260413180500"
      }
    }),
    false
  );
});

test("runtime dependency archive is used only for the matching OS and CPU", () => {
  assert.equal(
    resolveStage3WorkerRuntimeDependenciesPlatform({ platform: "win32", arch: "x64" }),
    "win32-x64"
  );
  assert.equal(
    isStage3WorkerRuntimeDependenciesArchiveCompatible({
      manifestPlatform: "linux-x64",
      workerPlatform: "win32-x64"
    }),
    false
  );
  assert.equal(
    isStage3WorkerRuntimeDependenciesArchiveCompatible({
      manifestPlatform: "WIN32-X64",
      workerPlatform: "win32-x64"
    }),
    true
  );
  assert.equal(
    isStage3WorkerRuntimeDependenciesArchiveCompatible({
      manifestPlatform: "",
      workerPlatform: "darwin-arm64"
    }),
    false
  );
});
