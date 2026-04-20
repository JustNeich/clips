import path from "node:path";

export type Stage3WorkerRestartLaunch = {
  command: string;
  args: string[];
  cwd: string;
};

type ResolveRestartLaunchInput = {
  platform?: NodeJS.Platform;
  execPath: string;
  argv: string[];
  cwd: string;
  installRoot: string;
  comspec?: string | null;
  wrapperExists?: boolean;
};

export function resolveStage3WorkerRestartLaunch(
  input: ResolveRestartLaunchInput
): Stage3WorkerRestartLaunch {
  const platform = input.platform ?? process.platform;
  if (platform === "win32" && input.wrapperExists) {
    const wrapperPath = path.win32.join(input.installRoot, "bin", "clips-stage3-worker.cmd");
    return {
      command: input.comspec?.trim() || "cmd.exe",
      args: ["/d", "/s", "/c", `"${wrapperPath}" start`],
      cwd: input.installRoot
    };
  }

  return {
    command: input.execPath,
    args: input.argv.slice(1),
    cwd: input.cwd
  };
}
