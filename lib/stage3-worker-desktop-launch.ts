import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MIN_NODE_MAJOR = 22;

export type Stage3DesktopWorkerNodeResolution =
  | {
      ok: true;
      command: string;
      version: string;
      checked: string[];
    }
  | {
      ok: false;
      error: string;
      checked: string[];
    };

function getEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const match = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return match ? env[match] : undefined;
}

function pushUnique(target: string[], value: string | null | undefined): void {
  const trimmed = value?.trim();
  if (trimmed && !target.includes(trimmed)) {
    target.push(trimmed);
  }
}

export function buildStage3DesktopWorkerNodeCandidates(options?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}): string[] {
  const env = options?.env ?? process.env;
  const platform = options?.platform ?? process.platform;
  const homeDir = options?.homeDir ?? os.homedir();
  const candidates: string[] = [];

  pushUnique(candidates, getEnvValue(env, "CLIPS_STAGE3_WORKER_NODE_PATH"));
  pushUnique(candidates, getEnvValue(env, "CLIPS_STAGE3_WORKER_NODE"));

  if (platform === "win32") {
    const pathApi = path.win32;
    pushUnique(candidates, "node.exe");
    pushUnique(candidates, getEnvValue(env, "NVM_SYMLINK") ? pathApi.join(getEnvValue(env, "NVM_SYMLINK")!, "node.exe") : null);
    pushUnique(candidates, pathApi.join(getEnvValue(env, "PROGRAMFILES") || "C:\\Program Files", "nodejs", "node.exe"));
    pushUnique(candidates, pathApi.join(getEnvValue(env, "PROGRAMFILES(X86)") || "C:\\Program Files (x86)", "nodejs", "node.exe"));
    pushUnique(
      candidates,
      pathApi.join(getEnvValue(env, "LOCALAPPDATA") || pathApi.join(homeDir, "AppData", "Local"), "Programs", "nodejs", "node.exe")
    );
    return candidates;
  }

  pushUnique(candidates, "node");
  pushUnique(candidates, "/opt/homebrew/bin/node");
  pushUnique(candidates, "/usr/local/bin/node");
  pushUnique(candidates, "/usr/bin/node");
  return candidates;
}

function parseNodeMajor(version: string): number | null {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

async function readNodeVersion(command: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync(command, ["-p", "process.versions.node"], {
    env,
    timeout: 5000,
    windowsHide: true
  });
  return String(stdout).trim();
}

export async function resolveStage3DesktopWorkerNode(options?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}): Promise<Stage3DesktopWorkerNodeResolution> {
  const env = options?.env ?? process.env;
  const candidates = buildStage3DesktopWorkerNodeCandidates(options);
  const checked: string[] = [];

  for (const candidate of candidates) {
    try {
      const version = await readNodeVersion(candidate, env);
      checked.push(`${candidate} (${version || "unknown version"})`);
      const major = parseNodeMajor(version);
      if (major !== null && major >= MIN_NODE_MAJOR) {
        return {
          ok: true,
          command: candidate,
          version,
          checked
        };
      }
    } catch (error) {
      checked.push(`${candidate} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  return {
    ok: false,
    error:
      "Node.js 22+ is required to run Stage 3 preview/render jobs. " +
      "Install Node.js LTS, then reopen Clips Worker.",
    checked
  };
}

function prependPath(env: NodeJS.ProcessEnv, directory: string | null): NodeJS.ProcessEnv {
  if (!directory) {
    return { ...env };
  }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const current = env[pathKey]?.trim();
  return {
    ...env,
    [pathKey]: current ? `${directory}${path.delimiter}${current}` : directory
  };
}

export function buildStage3DesktopWorkerChildLaunch(input: {
  nodeCommand: string;
  installRoot: string;
  env?: NodeJS.ProcessEnv;
}): {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
} {
  const nodeDir = path.isAbsolute(input.nodeCommand) ? path.dirname(input.nodeCommand) : null;
  const env = prependPath(input.env ?? process.env, nodeDir);
  return {
    command: input.nodeCommand,
    args: [path.join(input.installRoot, "bin", "clips-stage3-worker.cjs"), "start"],
    cwd: input.installRoot,
    env: {
      ...env,
      STAGE3_WORKER_INSTALL_ROOT: input.installRoot
    }
  };
}
