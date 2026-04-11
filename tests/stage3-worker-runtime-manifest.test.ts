import assert from "node:assert/strict";
import test from "node:test";

import { isStage3WorkerRuntimeVersionCompatible } from "../lib/stage3-worker-runtime-manifest";

test("stage3 worker runtime compatibility accepts an exact manifest match", () => {
  assert.equal(
    isStage3WorkerRuntimeVersionCompatible({
      workerAppVersion: "1.0.0+20260411172347",
      expectedRuntimeVersion: "1.0.0+20260411172347"
    }),
    true
  );
});

test("stage3 worker runtime compatibility accepts a newer build from the same release", () => {
  assert.equal(
    isStage3WorkerRuntimeVersionCompatible({
      workerAppVersion: "1.0.0+20260411193140",
      expectedRuntimeVersion: "1.0.0+20260411172347"
    }),
    true
  );
});

test("stage3 worker runtime compatibility still rejects an older build from the same release", () => {
  assert.equal(
    isStage3WorkerRuntimeVersionCompatible({
      workerAppVersion: "1.0.0+20260411150000",
      expectedRuntimeVersion: "1.0.0+20260411172347"
    }),
    false
  );
});

test("stage3 worker runtime compatibility rejects a different release even with a newer build", () => {
  assert.equal(
    isStage3WorkerRuntimeVersionCompatible({
      workerAppVersion: "1.1.0+20260411193140",
      expectedRuntimeVersion: "1.0.0+20260411172347"
    }),
    false
  );
});
