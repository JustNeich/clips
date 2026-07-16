import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIB = 1024 * 1024 * 1024;

export type Stage3ResourceTelemetry = {
  capturedAt: string;
  cpuCount: number | null;
  loadAverage1m: number | null;
  normalizedLoad1m: number | null;
  totalMemoryBytes: number | null;
  availableMemoryPercent: number | null;
  availableMemoryBytes: number | null;
  diskFreeBytes: number | null;
  swapUsedBytes: number | null;
  telemetryError: string | null;
};

export type Stage3ResourceClass = "heavy" | "light";

export type Stage3ResourceAdmissionReport = {
  admitted: boolean;
  reasons: string[];
  thresholds: {
    maxNormalizedLoad1m: number;
    minAvailableMemoryPercent: number;
    minDiskFreeBytes: number;
    maxSwapGrowthBytes5m: number;
  };
  telemetry: Stage3ResourceTelemetry;
  swapGrowthBytes5m: number;
};

export type Stage3SwapSample = { capturedAtMs: number; usedBytes: number };

function parseMemoryPressurePercent(output: string): number {
  const match = output.match(/System-wide memory free percentage:\s*([0-9]+(?:\.[0-9]+)?)%/i);
  const percent = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error("invalid_memory_pressure_output");
  }
  return percent / 100;
}

function parseSwapUsedBytes(output: string): number {
  const match = output.match(/used\s*=\s*([0-9]+(?:\.[0-9]+)?)([MG])?/i);
  const value = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("invalid_swap_output");
  }
  return value * (match?.[2]?.toUpperCase() === "G" ? GIB : 1024 * 1024);
}

async function readAvailableMemoryPercent(totalMemoryBytes: number): Promise<number> {
  if (process.platform !== "darwin") {
    return os.freemem() / totalMemoryBytes;
  }
  const { stdout } = await execFileAsync("/usr/bin/memory_pressure", ["-Q"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  return parseMemoryPressurePercent(stdout);
}

async function readSwapUsedBytes(): Promise<number> {
  if (process.platform !== "darwin") {
    return 0;
  }
  const { stdout } = await execFileAsync("/usr/sbin/sysctl", ["vm.swapusage"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  return parseSwapUsedBytes(stdout);
}

async function readDiskFreeBytes(targetPath: string): Promise<number> {
  const stats = await fs.statfs(targetPath);
  return Number(stats.bavail) * Number(stats.bsize);
}

export async function captureStage3ResourceTelemetry(input: {
  diskPath?: string;
  systemSnapshot?: {
    cpuCount: number;
    loadAverage1m: number;
    totalMemoryBytes: number;
    availableMemoryPercent: number;
    diskFreeBytes: number;
    swapUsedBytes: number;
  };
  availableMemoryReader?: (totalMemoryBytes: number) => Promise<number>;
  diskFreeReader?: (targetPath: string) => Promise<number>;
  swapReader?: () => Promise<number>;
} = {}): Promise<Stage3ResourceTelemetry> {
  const capturedAt = new Date().toISOString();
  try {
    const cpuCount = input.systemSnapshot?.cpuCount ?? os.cpus().length;
    const loadAverage1m = input.systemSnapshot?.loadAverage1m ?? (os.loadavg()[0] ?? Number.NaN);
    const totalMemoryBytes = input.systemSnapshot?.totalMemoryBytes ?? os.totalmem();
    const availableMemoryPercent = input.systemSnapshot?.availableMemoryPercent ?? await (
      input.availableMemoryReader ?? readAvailableMemoryPercent
    )(totalMemoryBytes);
    const diskFreeBytes = input.systemSnapshot?.diskFreeBytes ?? await (
      input.diskFreeReader ?? readDiskFreeBytes
    )(input.diskPath ?? path.parse(process.cwd()).root);
    const swapUsedBytes = input.systemSnapshot?.swapUsedBytes ?? await (
      input.swapReader ?? readSwapUsedBytes
    )();
    if (
      !Number.isFinite(cpuCount) || cpuCount <= 0 ||
      !Number.isFinite(loadAverage1m) || loadAverage1m < 0 ||
      !Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0 ||
      !Number.isFinite(availableMemoryPercent) || availableMemoryPercent < 0 || availableMemoryPercent > 1 ||
      !Number.isFinite(diskFreeBytes) || diskFreeBytes < 0 ||
      !Number.isFinite(swapUsedBytes) || swapUsedBytes < 0
    ) {
      throw new Error("invalid_system_metrics");
    }
    return {
      capturedAt,
      cpuCount,
      loadAverage1m,
      normalizedLoad1m: loadAverage1m / cpuCount,
      totalMemoryBytes,
      availableMemoryPercent,
      availableMemoryBytes: totalMemoryBytes * availableMemoryPercent,
      diskFreeBytes,
      swapUsedBytes,
      telemetryError: null
    };
  } catch (error) {
    return {
      capturedAt,
      cpuCount: null,
      loadAverage1m: null,
      normalizedLoad1m: null,
      totalMemoryBytes: null,
      availableMemoryPercent: null,
      availableMemoryBytes: null,
      diskFreeBytes: null,
      swapUsedBytes: null,
      telemetryError: error instanceof Error ? error.message : String(error)
    };
  }
}

export function updateStage3SwapHistory(
  history: Stage3SwapSample[],
  telemetry: Stage3ResourceTelemetry,
  nowMs = Date.now()
): { history: Stage3SwapSample[]; growthBytes5m: number } {
  const cutoff = nowMs - 5 * 60_000;
  const next = history.filter((sample) => sample.capturedAtMs >= cutoff);
  if (telemetry.swapUsedBytes !== null) {
    next.push({ capturedAtMs: nowMs, usedBytes: telemetry.swapUsedBytes });
  }
  const first = next[0]?.usedBytes ?? telemetry.swapUsedBytes ?? 0;
  const last = next[next.length - 1]?.usedBytes ?? first;
  return {
    history: next,
    growthBytes5m: Math.max(0, last - first)
  };
}

export function evaluateStage3ResourceAdmission(
  telemetry: Stage3ResourceTelemetry,
  resourceClass: Stage3ResourceClass,
  swapGrowthBytes5m = 0
): Stage3ResourceAdmissionReport {
  const heavy = resourceClass === "heavy";
  const thresholds = {
    maxNormalizedLoad1m: heavy ? 0.75 : 0.9,
    minAvailableMemoryPercent: heavy ? 0.25 : 0.15,
    minDiskFreeBytes: (heavy ? 20 : 10) * GIB,
    maxSwapGrowthBytes5m: 512 * 1024 * 1024
  };
  const reasons: string[] = [];
  if (
    telemetry.telemetryError ||
    telemetry.normalizedLoad1m === null ||
    telemetry.availableMemoryPercent === null ||
    telemetry.diskFreeBytes === null ||
    telemetry.swapUsedBytes === null
  ) {
    reasons.push(`telemetry_unavailable${telemetry.telemetryError ? `:${telemetry.telemetryError}` : ""}`);
  }
  if (telemetry.normalizedLoad1m !== null && telemetry.normalizedLoad1m > thresholds.maxNormalizedLoad1m) {
    reasons.push("system_load_above_limit");
  }
  if (
    telemetry.availableMemoryPercent !== null &&
    telemetry.availableMemoryPercent < thresholds.minAvailableMemoryPercent
  ) {
    reasons.push("available_memory_below_limit");
  }
  if (telemetry.diskFreeBytes !== null && telemetry.diskFreeBytes < thresholds.minDiskFreeBytes) {
    reasons.push("disk_space_below_limit");
  }
  if (swapGrowthBytes5m > thresholds.maxSwapGrowthBytes5m) {
    reasons.push("swap_growth_above_limit");
  }
  return {
    admitted: reasons.length === 0,
    reasons,
    thresholds,
    telemetry,
    swapGrowthBytes5m
  };
}

export function toStage3WorkerJobResourceContext(
  telemetry: Stage3ResourceTelemetry
): { cpuCount: number; loadAverage1m: number; availableMemoryBytes: number } | null {
  if (
    telemetry.cpuCount === null ||
    telemetry.loadAverage1m === null ||
    telemetry.availableMemoryBytes === null
  ) {
    return null;
  }
  return {
    cpuCount: telemetry.cpuCount,
    loadAverage1m: telemetry.loadAverage1m,
    availableMemoryBytes: telemetry.availableMemoryBytes
  };
}

export const STAGE3_RESOURCE_GIB = GIB;
