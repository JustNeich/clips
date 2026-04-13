import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveStage3WorkerAdvertisedVersion,
  shouldRestartStage3WorkerAfterSync
} from "../lib/stage3-worker-runtime-sync";

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

