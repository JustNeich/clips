import assert from "node:assert/strict";
import test from "node:test";

import {
  Stage3WorkerControlPlaneError,
  createStage3WorkerControlPlaneError,
  initialStage3WorkerControlRetryState,
  resolveStage3WorkerControlRetry,
  resolveStage3WorkerRestartGuardDelayMs
} from "../lib/stage3-worker-connectivity";
import { runStage3WorkerStartCommand } from "../lib/stage3-worker-runtime";

test("worker stops immediately on rejected authentication", () => {
  const error = new Stage3WorkerControlPlaneError({
    message: "Worker token is invalid.",
    status: 401,
    phase: "job-claim"
  });
  const decision = resolveStage3WorkerControlRetry({
    error,
    state: initialStage3WorkerControlRetryState(),
    random: () => 0.5
  });

  assert.equal(decision.action, "stop");
  assert.equal(decision.kind, "authentication");
  assert.equal(resolveStage3WorkerRestartGuardDelayMs(error), 15 * 60_000);
});

test("transient failures use exponential backoff and open the circuit", () => {
  let state = initialStage3WorkerControlRetryState();
  const delays: number[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const decision = resolveStage3WorkerControlRetry({
      error: new TypeError("fetch failed"),
      state,
      random: () => 0.5
    });
    assert.equal(decision.action, "retry");
    state = decision.nextState;
    delays.push(decision.delayMs);
  }

  assert.deepEqual(delays.slice(0, 5), [4_000, 8_000, 16_000, 32_000, 60_000]);
  assert.equal(delays[7], 15 * 60_000);
});

test("worker honors Retry-After for a transient server response", async () => {
  const response = Response.json(
    { error: "Too many requests." },
    { status: 429, headers: { "Retry-After": "120" } }
  );
  const error = await createStage3WorkerControlPlaneError({
    response,
    phase: "job-claim",
    fallbackMessage: "Failed to claim Stage 3 job"
  });
  const decision = resolveStage3WorkerControlRetry({
    error,
    state: initialStage3WorkerControlRetryState(),
    random: () => 0.5
  });

  assert.equal(error.message, "Too many requests.");
  assert.equal(decision.action, "retry");
  assert.equal(decision.delayMs, 120_000);
});

test("start command guard holds an auth failure before launchd can restart it", async () => {
  const delays: number[] = [];
  const error = new Stage3WorkerControlPlaneError({
    message: "Worker token is invalid.",
    status: 403,
    phase: "runtime-manifest"
  });
  await assert.rejects(
    runStage3WorkerStartCommand({
      startLoop: async () => {
        throw error;
      },
      delay: async (ms) => {
        delays.push(ms);
      }
    }),
    error
  );
  assert.deepEqual(delays, [15 * 60_000]);
});
