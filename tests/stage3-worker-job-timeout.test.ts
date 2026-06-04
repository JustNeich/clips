import assert from "node:assert/strict";
import test from "node:test";

import {
  Stage3WorkerJobTimeoutError,
  isStage3WorkerJobTimeoutError,
  resolveStage3HostJobTimeoutMs,
  resolveStage3HostedRenderEngineTimeoutMs,
  resolveStage3WorkerJobTimeoutMs
} from "../lib/stage3-worker-job-timeout";
import { classifyStage3HeavyJobError } from "../lib/stage3-job-executor";
import { runClaimedJobWithTimeout } from "../lib/stage3-worker-runtime";

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

test("worker render timeout is duration-aware for short output payloads", () => {
  assert.equal(
    resolveStage3WorkerJobTimeoutMs(
      "render",
      {},
      JSON.stringify({
        renderPlan: {
          targetDurationSec: 6
        }
      })
    ),
    3 * 60_000
  );
  assert.equal(
    resolveStage3WorkerJobTimeoutMs(
      "render",
      {},
      JSON.stringify({
        renderPlan: {
          targetDurationSec: 120
        }
      })
    ),
    10 * 60_000
  );
});

test("host render timeout has a longer floor than local worker renders", () => {
  const shortRenderPayload = JSON.stringify({
    renderPlan: {
      targetDurationSec: 6
    }
  });
  const longRenderPayload = JSON.stringify({
    renderPlan: {
      targetDurationSec: 120
    }
  });

  assert.equal(resolveStage3HostJobTimeoutMs("render", {}, shortRenderPayload), 6 * 60_000);
  assert.equal(resolveStage3HostJobTimeoutMs("render", {}, longRenderPayload), 12 * 60_000);
});

test("host render timeout ignores dangerously small render caps", () => {
  assert.equal(
    resolveStage3HostJobTimeoutMs(
      "render",
      {
        STAGE3_HOST_RENDER_TIMEOUT_MS: "420000"
      },
      JSON.stringify({
        renderPlan: {
          targetDurationSec: 30
        }
      })
    ),
    420_000
  );
  assert.equal(
    resolveStage3HostJobTimeoutMs(
      "render",
      {
        STAGE3_HOST_RENDER_TIMEOUT_MS: "20000"
      },
      JSON.stringify({
        renderPlan: {
          targetDurationSec: 6
        }
      })
    ),
    6 * 60_000
  );
});

test("hosted Remotion engine timeout is lifted above the host watchdog floor", () => {
  assert.equal(
    resolveStage3HostedRenderEngineTimeoutMs(
      {
        REMOTION_RENDER_TIMEOUT_MS: "180000"
      },
      JSON.stringify({
        renderPlan: {
          targetDurationSec: 6
        }
      }),
      9 * 60_000
    ),
    330_000
  );
});

test("claimed worker job timeout aborts the running task", async () => {
  const previous = process.env.STAGE3_WORKER_RENDER_TIMEOUT_MS;
  process.env.STAGE3_WORKER_RENDER_TIMEOUT_MS = "20";
  try {
    await assert.rejects(
      runClaimedJobWithTimeout(
        {
          id: "job-timeout",
          kind: "render",
          status: "running"
        },
        JSON.stringify({
          renderPlan: {
            targetDurationSec: 6
          }
        }),
        (signal) =>
          new Promise((resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                reject(signal.reason);
              },
              { once: true }
            );
            setTimeout(resolve, 1_000).unref();
          })
      ),
      Stage3WorkerJobTimeoutError
    );
  } finally {
    if (previous === undefined) {
      delete process.env.STAGE3_WORKER_RENDER_TIMEOUT_MS;
    } else {
      process.env.STAGE3_WORKER_RENDER_TIMEOUT_MS = previous;
    }
  }
});

test("claimed worker job stops when the server-side lease is revoked", async () => {
  const controller = new AbortController();
  const promise = runClaimedJobWithTimeout(
    {
      id: "job-lease-lost",
      kind: "render",
      status: "running"
    },
    JSON.stringify({
      renderPlan: {
        targetDurationSec: 6
      }
    }),
    () => new Promise((resolve) => setTimeout(resolve, 1_000).unref()),
    controller.signal
  );
  const reason = new Error("lease revoked");
  controller.abort(reason);
  await assert.rejects(promise, /lease revoked/);
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
