import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Stage3WorkerProcessRecord = {
  pid: number;
  parentPid: number;
  command: string;
};

export function parseStage3WorkerProcessList(output: string): Stage3WorkerProcessRecord[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      command: match[3] ?? ""
    }))
    .filter((record) => Number.isInteger(record.pid) && Number.isInteger(record.parentPid));
}

export function isOrphanedStage3BrowserProcess(
  record: Stage3WorkerProcessRecord,
  workerRoot: string
): boolean {
  if (record.parentPid !== 1) {
    return false;
  }
  const command = record.command.toLowerCase();
  const normalizedWorkerRoot = path.resolve(workerRoot).toLowerCase();
  const isHeadlessBrowser =
    command.includes("chrome-headless-shell") ||
    command.includes("headless_shell") ||
    command.includes("headless shell");
  const isWorkerOwned =
    command.includes(normalizedWorkerRoot) ||
    command.includes(`${path.sep}caches${path.sep}remotion${path.sep}`.toLowerCase());
  return isHeadlessBrowser && isWorkerOwned;
}

async function readProcessList(): Promise<Stage3WorkerProcessRecord[]> {
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
  return parseStage3WorkerProcessList(stdout);
}

export async function cleanupOrphanedStage3BrowserProcesses(input: {
  workerRoot: string;
  log?: (message: string) => void;
  processListReader?: () => Promise<Stage3WorkerProcessRecord[]>;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  delay?: (ms: number) => Promise<void>;
}): Promise<number> {
  if (process.platform === "win32") {
    return 0;
  }
  const readProcesses = input.processListReader ?? readProcessList;
  const killProcess = input.killProcess ?? ((pid, signal) => process.kill(pid, signal));
  const delay = input.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const candidates = (await readProcesses()).filter((record) =>
    isOrphanedStage3BrowserProcess(record, input.workerRoot)
  );
  if (candidates.length === 0) {
    return 0;
  }

  input.log?.(`Cleaning ${candidates.length} orphaned Stage 3 browser process(es).`);
  for (const candidate of candidates) {
    try {
      killProcess(candidate.pid, "SIGTERM");
    } catch {
      // The process may have exited between inspection and cleanup.
    }
  }
  await delay(1_000);

  const remaining = new Map(
    (await readProcesses())
      .filter((record) => isOrphanedStage3BrowserProcess(record, input.workerRoot))
      .map((record) => [record.pid, record])
  );
  for (const candidate of candidates) {
    if (!remaining.has(candidate.pid)) {
      continue;
    }
    try {
      killProcess(candidate.pid, "SIGKILL");
    } catch {
      // The process may have exited after the second inspection.
    }
  }
  return candidates.length;
}
