import assert from "node:assert/strict";
import test from "node:test";

import {
  queueThrottledBackgroundTask,
  resetThrottledBackgroundTaskStateForTests
} from "../lib/throttled-background-task";

test("queueThrottledBackgroundTask dedupes inflight work and throttles immediate repeats", async () => {
  resetThrottledBackgroundTaskStateForTests();
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const firstQueued = queueThrottledBackgroundTask("asset-prune", 50, async () => {
    runs += 1;
    await gate;
  });
  const secondQueued = queueThrottledBackgroundTask("asset-prune", 50, async () => {
    runs += 1;
  });

  assert.equal(firstQueued, true);
  assert.equal(secondQueued, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runs, 1);

  release();
  await new Promise((resolve) => setTimeout(resolve, 5));

  const throttled = queueThrottledBackgroundTask("asset-prune", 50, async () => {
    runs += 1;
  });
  assert.equal(throttled, false);

  await new Promise((resolve) => setTimeout(resolve, 60));
  const queuedAfterCooldown = queueThrottledBackgroundTask("asset-prune", 50, async () => {
    runs += 1;
  });
  assert.equal(queuedAfterCooldown, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 2);
});
