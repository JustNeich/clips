import assert from "node:assert/strict";
import test from "node:test";

import {
  collectStage3WorkerAdmissionReport,
  evaluateStage3WorkerAdmission,
  type Stage3WorkerAdmissionTelemetry
} from "../lib/stage3-worker-runtime";
import { updateStage3SwapHistory } from "../lib/stage3-resource-telemetry";

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
    availableMemoryPercent: 0.5,
    availableMemoryBytes: 8 * GIB,
    diskFreeBytes: 100 * GIB,
    swapUsedBytes: 2 * GIB,
    activeWorkerJobs: 0,
    telemetryError: null,
    ...patch
  };
}

test("Stage 3 worker admits a heavy claim only with complete healthy telemetry", () => {
  const report = evaluateStage3WorkerAdmission(telemetry(), "heavy");
  assert.equal(report.admitted, true);
  assert.equal(report.decision, "admit");
  assert.deepEqual(report.reasons, []);
});

test("heavy admission defers for load, memory pressure, disk, or swap growth", () => {
  assert.ok(
    evaluateStage3WorkerAdmission(
      telemetry({ loadAverage1m: 8, normalizedLoad1m: 0.8 }),
      "heavy"
    ).reasons.includes("system_load_above_limit")
  );
  assert.ok(
    evaluateStage3WorkerAdmission(
      telemetry({ availableMemoryPercent: 0.2, availableMemoryBytes: 3.2 * GIB }),
      "heavy"
    ).reasons.includes("available_memory_below_limit")
  );
  assert.ok(
    evaluateStage3WorkerAdmission(telemetry({ diskFreeBytes: 19 * GIB }), "heavy").reasons.includes(
      "disk_space_below_limit"
    )
  );
  assert.ok(
    evaluateStage3WorkerAdmission(telemetry(), "heavy", 513 * 1024 * 1024).reasons.includes(
      "swap_growth_above_limit"
    )
  );
});

test("worker-owned active jobs do not block another eligible lane", () => {
  const report = evaluateStage3WorkerAdmission(telemetry({ activeWorkerJobs: 3 }), "light");
  assert.equal(report.admitted, true);
  assert.deepEqual(report.reasons, []);
});

test("light admission keeps the documented lower memory and disk thresholds", () => {
  const light = evaluateStage3WorkerAdmission(
    telemetry({
      loadAverage1m: 8.5,
      normalizedLoad1m: 0.85,
      availableMemoryPercent: 0.2,
      availableMemoryBytes: 3.2 * GIB,
      diskFreeBytes: 12 * GIB
    }),
    "light"
  );
  assert.equal(light.admitted, true);
  assert.equal(evaluateStage3WorkerAdmission(telemetry({ diskFreeBytes: 9 * GIB }), "light").admitted, false);
});

test("Stage 3 worker fails closed when macOS memory telemetry is unavailable", async () => {
  const report = await collectStage3WorkerAdmissionReport({
    activeWorkerJobs: 0,
    availableMemoryReader: async () => {
      throw new Error("memory_pressure_unavailable");
    },
    diskFreeReader: async () => 100 * GIB,
    swapReader: async () => 2 * GIB
  });
  assert.equal(report.admitted, false);
  assert.equal(report.decision, "defer");
  assert.match(report.reasons.join(" "), /telemetry_unavailable:memory_pressure_unavailable/);
});

test("collected telemetry uses available memory percentage instead of process names", async () => {
  const report = await collectStage3WorkerAdmissionReport({
    systemSnapshot: {
      cpuCount: 10,
      loadAverage1m: 2,
      totalMemoryBytes: 16 * GIB,
      availableMemoryPercent: 0.37,
      diskFreeBytes: 100 * GIB,
      swapUsedBytes: 7 * GIB
    }
  });
  assert.equal(report.admitted, true);
  assert.equal(report.telemetry.availableMemoryBytes, 16 * GIB * 0.37);
});

test("swap growth is measured over the retained five-minute window", () => {
  const now = Date.parse("2026-07-15T09:05:00.000Z");
  const updated = updateStage3SwapHistory(
    [
      { capturedAtMs: now - 6 * 60_000, usedBytes: 1 * GIB },
      { capturedAtMs: now - 4 * 60_000, usedBytes: 2 * GIB }
    ],
    telemetry({ swapUsedBytes: 2.25 * GIB }),
    now
  );
  assert.equal(updated.history.length, 2);
  assert.equal(updated.growthBytes5m, 0.25 * GIB);
});
