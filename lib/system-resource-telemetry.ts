import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SystemMemoryTelemetry = {
  totalMemoryBytes: number | null;
  availableMemoryBytes: number | null;
  provider: "memory_pressure" | "vm_stat" | "os_freemem" | null;
  error: string | null;
};

type CommandRunner = (command: string, args: string[]) => Promise<string>;

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseMacOsMemoryPressureAvailableBytes(
  output: string,
  fallbackTotalMemoryBytes: number
): { totalMemoryBytes: number; availableMemoryBytes: number } | null {
  const totalMatch = output.match(/system has\s+(\d+)\s+\(/i);
  const percentMatch = output.match(/memory free percentage:\s*([\d.]+)%/i);
  const totalMemoryBytes = finitePositive(Number(totalMatch?.[1] ?? fallbackTotalMemoryBytes));
  const freePercent = Number(percentMatch?.[1]);
  if (!totalMemoryBytes || !Number.isFinite(freePercent) || freePercent < 0 || freePercent > 100) {
    return null;
  }
  return {
    totalMemoryBytes,
    availableMemoryBytes: Math.round(totalMemoryBytes * (freePercent / 100))
  };
}

export function parseMacOsVmStatAvailableBytes(
  output: string,
  fallbackTotalMemoryBytes: number
): { totalMemoryBytes: number; availableMemoryBytes: number } | null {
  const pageSize = Number(output.match(/page size of\s+(\d+)\s+bytes/i)?.[1]);
  const readPages = (label: string) => {
    const match = output.match(new RegExp(`^${label}:\\s+(\\d+)\\.?$`, "im"));
    return match ? Number(match[1]) : Number.NaN;
  };
  const free = readPages("Pages free");
  const inactive = readPages("Pages inactive");
  const speculative = readPages("Pages speculative");
  const purgeable = readPages("Pages purgeable");
  const totalMemoryBytes = finitePositive(fallbackTotalMemoryBytes);
  if (
    !totalMemoryBytes ||
    !Number.isFinite(pageSize) ||
    pageSize <= 0 ||
    ![free, inactive, speculative, purgeable].every((value) => Number.isFinite(value) && value >= 0)
  ) {
    return null;
  }
  const availableMemoryBytes = Math.round((free + inactive + speculative + purgeable) * pageSize);
  if (availableMemoryBytes < 0 || availableMemoryBytes > totalMemoryBytes) {
    return null;
  }
  return { totalMemoryBytes, availableMemoryBytes };
}

async function defaultCommandRunner(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024
  });
  return stdout;
}

export async function readSystemMemoryTelemetry(input: {
  platform?: NodeJS.Platform;
  totalMemoryBytes?: number;
  freeMemoryBytes?: number;
  commandRunner?: CommandRunner;
} = {}): Promise<SystemMemoryTelemetry> {
  const platform = input.platform ?? process.platform;
  const totalMemoryBytes = input.totalMemoryBytes ?? os.totalmem();
  if (platform !== "darwin") {
    const availableMemoryBytes = input.freeMemoryBytes ?? os.freemem();
    if (!finitePositive(totalMemoryBytes) || !Number.isFinite(availableMemoryBytes) || availableMemoryBytes < 0) {
      return { totalMemoryBytes: null, availableMemoryBytes: null, provider: null, error: "invalid_os_memory_metrics" };
    }
    return { totalMemoryBytes, availableMemoryBytes, provider: "os_freemem", error: null };
  }

  const run = input.commandRunner ?? defaultCommandRunner;
  const errors: string[] = [];
  try {
    const parsed = parseMacOsMemoryPressureAvailableBytes(
      await run("/usr/bin/memory_pressure", ["-Q"]),
      totalMemoryBytes
    );
    if (parsed) return { ...parsed, provider: "memory_pressure", error: null };
    errors.push("memory_pressure_invalid");
  } catch (error) {
    errors.push(`memory_pressure_failed:${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const parsed = parseMacOsVmStatAvailableBytes(await run("/usr/bin/vm_stat", []), totalMemoryBytes);
    if (parsed) return { ...parsed, provider: "vm_stat", error: null };
    errors.push("vm_stat_invalid");
  } catch (error) {
    errors.push(`vm_stat_failed:${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    totalMemoryBytes: null,
    availableMemoryBytes: null,
    provider: null,
    error: errors.join(";") || "darwin_memory_telemetry_unavailable"
  };
}
