import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMacOsMemoryPressureAvailableBytes,
  parseMacOsVmStatAvailableBytes,
  readSystemMemoryTelemetry
} from "../lib/system-resource-telemetry";

const GIB = 1024 * 1024 * 1024;

test("macOS memory_pressure output yields pressure-aware available memory", () => {
  const parsed = parseMacOsMemoryPressureAvailableBytes(
    "The system has 17179869184 (1048576 pages with a page size of 16384).\nSystem-wide memory free percentage: 38%\n",
    16 * GIB
  );
  assert.ok(parsed);
  assert.equal(parsed.totalMemoryBytes, 16 * GIB);
  assert.equal(parsed.availableMemoryBytes, Math.round(16 * GIB * 0.38));
});

test("macOS vm_stat is a valid fallback provider", () => {
  const parsed = parseMacOsVmStatAvailableBytes(
    [
      "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
      "Pages free: 6749.",
      "Pages inactive: 185085.",
      "Pages speculative: 4927.",
      "Pages purgeable: 5."
    ].join("\n"),
    16 * GIB
  );
  assert.ok(parsed);
  assert.equal(parsed.availableMemoryBytes, (6749 + 185085 + 4927 + 5) * 16384);
});

test("Darwin memory telemetry fails closed when both providers fail", async () => {
  const result = await readSystemMemoryTelemetry({
    platform: "darwin",
    totalMemoryBytes: 16 * GIB,
    commandRunner: async () => {
      throw new Error("command unavailable");
    }
  });
  assert.equal(result.availableMemoryBytes, null);
  assert.equal(result.provider, null);
  assert.match(result.error ?? "", /memory_pressure_failed/);
  assert.match(result.error ?? "", /vm_stat_failed/);
});
