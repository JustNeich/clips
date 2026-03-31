import assert from "node:assert/strict";
import test from "node:test";

import { resolveStage3WorkerRefreshIntervalMs } from "../lib/stage3-worker-polling";

test("worker polling is aggressive while waiting for pairing to complete", () => {
  assert.equal(
    resolveStage3WorkerRefreshIntervalMs({
      workerState: "not_paired",
      pairingActive: true
    }),
    1500
  );
  assert.equal(
    resolveStage3WorkerRefreshIntervalMs({
      workerState: "offline",
      pairingActive: true
    }),
    1500
  );
});

test("worker polling relaxes once executor is connected", () => {
  assert.equal(
    resolveStage3WorkerRefreshIntervalMs({
      workerState: "online",
      pairingActive: true
    }),
    10000
  );
  assert.equal(
    resolveStage3WorkerRefreshIntervalMs({
      workerState: "busy",
      pairingActive: false
    }),
    10000
  );
});

test("worker polling checks disconnected executors more often than stable online ones", () => {
  assert.equal(
    resolveStage3WorkerRefreshIntervalMs({
      workerState: "offline",
      pairingActive: false
    }),
    5000
  );
});
