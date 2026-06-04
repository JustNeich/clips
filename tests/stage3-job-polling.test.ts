import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveStage3JobPollIntervalMs,
  resolveStage3JobStatusTransientRetryMs,
  shouldContinueStage3JobStatusPollingAfterTransient
} from "../lib/stage3-job-polling";

test("job polling stays responsive for fresh hosted preview work", () => {
  assert.equal(
    resolveStage3JobPollIntervalMs({
      kind: "editing-proxy",
      status: "running",
      executionTarget: "host"
    }),
    950
  );
  assert.equal(
    resolveStage3JobPollIntervalMs({
      kind: "preview",
      status: "queued",
      executionTarget: "host"
    }),
    1300
  );
});

test("job polling backs off for long local render work", () => {
  assert.equal(
    resolveStage3JobPollIntervalMs({
      kind: "render",
      status: "running",
      executionTarget: "local",
      elapsedMs: 60_000
    }),
    3600
  );
});

test("job polling slows down when the tab is hidden", () => {
  assert.equal(
    resolveStage3JobPollIntervalMs({
      kind: "preview",
      status: "running",
      executionTarget: "host",
      hidden: true
    }),
    3000
  );
  assert.equal(
    resolveStage3JobPollIntervalMs({
      kind: "render",
      status: "queued",
      executionTarget: "host",
      hidden: true
    }),
    5000
  );
});

test("render status polling tolerates long transient control-plane failures", () => {
  assert.equal(
    shouldContinueStage3JobStatusPollingAfterTransient({
      kind: "render",
      elapsedMs: 12 * 60_000
    }),
    true
  );
  assert.equal(
    shouldContinueStage3JobStatusPollingAfterTransient({
      kind: "render",
      elapsedMs: 46 * 60_000
    }),
    false
  );
  assert.equal(
    resolveStage3JobStatusTransientRetryMs({
      kind: "render",
      transientFailures: 5
    }),
    7000
  );
  assert.equal(
    resolveStage3JobStatusTransientRetryMs({
      kind: "render",
      transientFailures: 50,
      hidden: true
    }),
    15000
  );
});
