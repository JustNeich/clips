import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Stage3WorkerNpmInvocation = {
  command: string;
  args: string[];
};

function isWindowsCommandShim(command: string): boolean {
  const normalizedCommand = command.replace(/\\/g, "/");
  const name = path.posix.basename(normalizedCommand).toLowerCase();
  return (
    name === "npm" ||
    name === "npm.cmd" ||
    name === "npm.bat" ||
    name.endsWith(".cmd") ||
    name.endsWith(".bat")
  );
}

export function buildStage3WorkerNpmInvocation(input: {
  npmCommand?: string;
  npmArgs: string[];
  platform?: NodeJS.Platform;
}): Stage3WorkerNpmInvocation {
  const platform = input.platform ?? process.platform;
  const npmCommand = input.npmCommand ?? (platform === "win32" ? "npm.cmd" : "npm");
  if (platform === "win32" && isWindowsCommandShim(npmCommand)) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", npmCommand, ...input.npmArgs]
    };
  }
  return {
    command: npmCommand,
    args: input.npmArgs
  };
}

export async function runStage3WorkerNpm(input: {
  installRoot: string;
  npmArgs: string[];
  npmCommand?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const invocation = buildStage3WorkerNpmInvocation({
    npmCommand: input.npmCommand,
    npmArgs: input.npmArgs
  });
  await execFileAsync(invocation.command, invocation.args, {
    cwd: input.installRoot,
    env: input.env ?? process.env,
    windowsHide: true
  });
}
