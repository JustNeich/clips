import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveDynamicLongRenderRemotionConcurrency,
  resolveRemotionRenderConcurrency,
  shouldUseMemorySafeRenderOptions
} from "../lib/stage3-render-service";

const lowLoadMacBook = {
  cpuCount: 10,
  loadAverage1m: 2,
  availableMemoryBytes: 8 * 1024 * 1024 * 1024
};

// These tests run with RENDER unset, i.e. the local (non-hosted) Mac worker path,
// which is exactly where long renders used to crash Chrome with "Target closed".

test("short local renders keep Remotion's fast unbounded concurrency", () => {
  assert.equal(resolveRemotionRenderConcurrency(8), null);
  assert.equal(resolveRemotionRenderConcurrency(0), null);
  assert.equal(shouldUseMemorySafeRenderOptions(8), false);
});

test("long local renders are bounded and memory-safe", () => {
  // 40.913s is the exact clip that crash-looped the worker; 54s/93.3s are common Wisdom lengths.
  assert.equal(resolveRemotionRenderConcurrency(40.913, lowLoadMacBook), 2);
  assert.equal(resolveRemotionRenderConcurrency(54, lowLoadMacBook), 2);
  assert.equal(resolveRemotionRenderConcurrency(93.3, lowLoadMacBook), 2);
  assert.equal(shouldUseMemorySafeRenderOptions(40.913), true);
  assert.equal(shouldUseMemorySafeRenderOptions(93.3), true);
});

test("the long-render threshold is the boundary (18s)", () => {
  assert.equal(resolveRemotionRenderConcurrency(18, lowLoadMacBook), null);
  assert.equal(resolveRemotionRenderConcurrency(18.01, lowLoadMacBook), 2);
  assert.equal(shouldUseMemorySafeRenderOptions(18), false);
  assert.equal(shouldUseMemorySafeRenderOptions(18.01), true);
});

test("long-render concurrency adapts to current CPU load and free memory", () => {
  assert.equal(
    resolveDynamicLongRenderRemotionConcurrency({
      cpuCount: 10,
      loadAverage1m: 1,
      availableMemoryBytes: 13 * 1024 * 1024 * 1024
    }),
    4
  );
  assert.equal(
    resolveDynamicLongRenderRemotionConcurrency({
      cpuCount: 10,
      loadAverage1m: 8,
      availableMemoryBytes: 13 * 1024 * 1024 * 1024
    }),
    1
  );
  assert.equal(
    resolveDynamicLongRenderRemotionConcurrency({
      cpuCount: 10,
      loadAverage1m: 1,
      availableMemoryBytes: 4 * 1024 * 1024 * 1024
    }),
    1
  );
  assert.equal(
    resolveDynamicLongRenderRemotionConcurrency({
      cpuCount: Number.NaN,
      loadAverage1m: 0,
      availableMemoryBytes: 8 * 1024 * 1024 * 1024
    }),
    1
  );
});

test("non-finite durations fall back to the fast path, never crash the resolver", () => {
  assert.equal(resolveRemotionRenderConcurrency(Number.NaN), null);
  assert.equal(resolveRemotionRenderConcurrency(Number.POSITIVE_INFINITY), null);
  assert.equal(shouldUseMemorySafeRenderOptions(Number.NaN), false);
});
