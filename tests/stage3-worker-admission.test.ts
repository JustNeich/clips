import assert from "node:assert/strict";
import test from "node:test";

import {
  collectStage3WorkerAdmissionReport,
  evaluateStage3WorkerAdmission,
  type Stage3WorkerAdmissionTelemetry
} from "../lib/stage3-worker-runtime";

const GIB = 1024 * 1024 * 1024;

function telemetry(
  patch: Partial<Stage3WorkerAdmissionTelemetry> = {}
): Stage3WorkerAdmissionTelemetry {
  return {
    capturedAt: "2026-07-15T09:00:00.000Z",
    cpuCount: 10,
    loadAverage1m: 2,
    normalizedLoad1m: 0.2,
    totalMemoryBytes: 16 * GIB,
    freeMemoryBytes: 8 * GIB,
    freeMemoryRatio: 0.5,
    activeRenderProcesses: 0,
    activeWorkerJobs: 0,
    telemetryError: null,
    ...patch
  };
}

async function withDefaultAdmissionEnv<T>(run: () => T | Promise<T>): Promise<T> {
  const previousLoad = process.env.STAGE3_WORKER_MAX_NORMALIZED_LOAD;
  const previousMemory = process.env.STAGE3_WORKER_MIN_FREE_MEMORY_GB;
  delete process.env.STAGE3_WORKER_MAX_NORMALIZED_LOAD;
  delete process.env.STAGE3_WORKER_MIN_FREE_MEMORY_GB;
  try {
    return await run();
  } finally {
    if (previousLoad === undefined) delete process.env.STAGE3_WORKER_MAX_NORMALIZED_LOAD;
    else process.env.STAGE3_WORKER_MAX_NORMALIZED_LOAD = previousLoad;
    if (previousMemory === undefined) delete process.env.STAGE3_WORKER_MIN_FREE_MEMORY_GB;
    else process.env.STAGE3_WORKER_MIN_FREE_MEMORY_GB = previousMemory;
  }
}

test("Stage 3 worker admits a claim only with complete healthy telemetry", async () => {
  await withDefaultAdmissionEnv(() => {
    const report = evaluateStage3WorkerAdmission(telemetry());
    assert.equal(report.admitted, true);
    assert.equal(report.decision, "admit");
    assert.deepEqual(report.reasons, []);
  });
});

test("Stage 3 worker defers claims for load, memory, render processes, or an active job", async () => {
  await withDefaultAdmissionEnv(() => {
    assert.ok(
      evaluateStage3WorkerAdmission(
        telemetry({ loadAverage1m: 9, normalizedLoad1m: 0.9 })
      ).reasons.includes("system_load_above_limit")
    );
    assert.ok(
      evaluateStage3WorkerAdmission(
        telemetry({ freeMemoryBytes: 2 * GIB, freeMemoryRatio: 0.125 })
      ).reasons.includes("free_memory_below_limit")
    );
    assert.ok(
      evaluateStage3WorkerAdmission(telemetry({ activeRenderProcesses: 1 })).reasons.includes(
        "active_render_process_detected"
      )
    );
    assert.ok(
      evaluateStage3WorkerAdmission(telemetry({ activeWorkerJobs: 1 })).reasons.includes(
        "worker_job_active"
      )
    );
  });
});

test("Stage 3 worker fails closed when required telemetry cannot be collected", async () => {
  await withDefaultAdmissionEnv(async () => {
    const report = await collectStage3WorkerAdmissionReport({
      activeWorkerJobs: 0,
      systemSnapshot: {
        cpuCount: 10,
        loadAverage1m: 2,
        totalMemoryBytes: 16 * GIB,
        freeMemoryBytes: 8 * GIB
      },
      processCountReader: async () => {
        throw new Error("process_list_unavailable");
      }
    });
    assert.equal(report.admitted, false);
    assert.equal(report.decision, "defer");
    assert.match(report.reasons.join(" "), /telemetry_unavailable:process_list_unavailable/);
    assert.equal(report.telemetry.activeRenderProcesses, null);
  });
});

test("collected active render process count blocks pre-claim admission", async () => {
  await withDefaultAdmissionEnv(async () => {
    const report = await collectStage3WorkerAdmissionReport({
      systemSnapshot: {
        cpuCount: 10,
        loadAverage1m: 2,
        totalMemoryBytes: 16 * GIB,
        freeMemoryBytes: 8 * GIB
      },
      processCountReader: async () => 2
    });
    assert.equal(report.admitted, false);
    assert.equal(report.telemetry.activeRenderProcesses, 2);
    assert.ok(report.reasons.includes("active_render_process_detected"));
  });
});
