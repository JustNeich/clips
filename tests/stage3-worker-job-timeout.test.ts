import assert from "node:assert/strict";
import test from "node:test";

import {
  Stage3WorkerJobTimeoutError,
  isStage3WorkerJobTimeoutError,
  resolveStage3WorkerJobTimeoutMs
} from "../lib/stage3-worker-job-timeout";
import { classifyStage3HeavyJobError } from "../lib/stage3-job-executor";

test("worker job timeout defaults keep preview responsive without killing normal renders", () => {
  assert.equal(resolveStage3WorkerJobTimeoutMs("editing-proxy", {}), 5 * 60_000);
  assert.equal(resolveStage3WorkerJobTimeoutMs("preview", {}), 150_000);
  assert.equal(resolveStage3WorkerJobTimeoutMs("render", {}), 10 * 60_000);
});

test("worker job timeout supports global and kind-specific overrides", () => {
  assert.equal(
    resolveStage3WorkerJobTimeoutMs("preview", {
      STAGE3_WORKER_JOB_TIMEOUT_MS: "1234"
    }),
    1234
  );
  assert.equal(
    resolveStage3WorkerJobTimeoutMs("preview", {
      STAGE3_WORKER_JOB_TIMEOUT_MS: "1234",
      STAGE3_WORKER_PREVIEW_TIMEOUT_MS: "4567"
    }),
    4567
  );
});

test("worker timeout error is classifiable", () => {
  const error = new Stage3WorkerJobTimeoutError("editing-proxy", 5 * 60_000);
  assert.equal(isStage3WorkerJobTimeoutError(error), true);
  assert.equal(error.kind, "editing-proxy");
  assert.match(error.message, /timed out/i);

  const classified = classifyStage3HeavyJobError("editing-proxy", error);
  assert.equal(classified.code, "editing_proxy_timeout");
  assert.equal(classified.recoverable, true);
});
