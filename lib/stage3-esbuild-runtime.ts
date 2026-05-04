import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type PlatformInput = {
  platform?: NodeJS.Platform;
  arch?: string;
};

export type Stage3EsbuildRepairPlan = {
  esbuildVersion: string | null;
  platformPackageName: string;
  platformPackageVersion: string | null;
  installPackages: string[];
};

export type Stage3EsbuildRuntimeStatus = {
  ready: boolean;
  repaired: boolean;
  error: string | null;
  repairPlan: Stage3EsbuildRepairPlan | null;
};

function normalizeVersion(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function resolveEsbuildPlatformPackageName(input?: PlatformInput): string | null {
  const platform = input?.platform ?? process.platform;
  const arch = input?.arch ?? process.arch;

  if (platform === "darwin" && arch === "arm64") {
    return "@esbuild/darwin-arm64";
  }
  if (platform === "darwin" && arch === "x64") {
    return "@esbuild/darwin-x64";
  }
  if (platform === "win32" && arch === "x64") {
    return "@esbuild/win32-x64";
  }
  if (platform === "win32" && arch === "arm64") {
    return "@esbuild/win32-arm64";
  }
  if (platform === "win32" && arch === "ia32") {
    return "@esbuild/win32-ia32";
  }
  if (platform === "linux" && arch === "x64") {
    return "@esbuild/linux-x64";
  }
  if (platform === "linux" && arch === "arm64") {
    return "@esbuild/linux-arm64";
  }
  if (platform === "linux" && arch === "arm") {
    return "@esbuild/linux-arm";
  }
  return null;
}

export function isEsbuildNativeBinaryError(value: unknown): boolean {
  const text =
    value instanceof Error
      ? `${value.message}\n${value.stack ?? ""}`
      : typeof value === "string"
        ? value
        : value === null || value === undefined
          ? ""
          : String(value);
  const lower = text.toLowerCase();
  return (
    lower.includes("you installed esbuild for another platform") ||
    lower.includes("needs the \"@esbuild/") ||
    lower.includes("package is present but this platform") ||
    lower.includes("generatebinpath") ||
    lower.includes("@esbuild/")
  );
}

async function verifyEsbuildRuntime(installRoot: string): Promise<string | null> {
  const verificationScript = `
const path = require("node:path");
const { createRequire } = require("node:module");
const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"));
const esbuild = requireFromRoot("esbuild");
esbuild.transformSync("const stage3WorkerEsbuildCheck = true;", { loader: "js" });
`;
  try {
    await execFileAsync(process.execPath, ["-e", verificationScript], {
      cwd: installRoot
    });
    return null;
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout ?? "") : "";
    const message = error instanceof Error ? error.message : String(error);
    return [message, stderr, stdout].filter(Boolean).join("\n");
  }
}

export async function readEsbuildRepairPlan(
  installRoot: string,
  input?: PlatformInput
): Promise<Stage3EsbuildRepairPlan | null> {
  const esbuildPackage = (await readJson<{
    version?: string;
    optionalDependencies?: Record<string, string>;
  }>(path.join(installRoot, "node_modules", "esbuild", "package.json"))) ?? {
    version: null,
    optionalDependencies: {} as Record<string, string>
  };
  const platformPackageName = resolveEsbuildPlatformPackageName(input);
  if (!platformPackageName) {
    return null;
  }

  const optionalDependencies = esbuildPackage.optionalDependencies ?? {};
  const esbuildVersion = normalizeVersion(esbuildPackage.version);
  const platformPackageVersion =
    normalizeVersion(optionalDependencies[platformPackageName]) ?? esbuildVersion;
  if (!esbuildVersion || !platformPackageVersion) {
    return null;
  }

  return {
    esbuildVersion,
    platformPackageName,
    platformPackageVersion,
    installPackages: [
      `esbuild@${esbuildVersion}`,
      `${platformPackageName}@${platformPackageVersion}`
    ]
  };
}

export async function ensureEsbuildRuntimeAvailable(input: {
  installRoot: string;
  repair?: boolean;
  npmCommand?: string;
  log?: (message: string) => void;
}): Promise<Stage3EsbuildRuntimeStatus> {
  const initialError = await verifyEsbuildRuntime(input.installRoot);
  if (!initialError) {
    return { ready: true, repaired: false, error: null, repairPlan: null };
  }

  if (input.repair === false || !isEsbuildNativeBinaryError(initialError)) {
    return {
      ready: false,
      repaired: false,
      error: initialError,
      repairPlan: null
    };
  }

  const repairPlan = await readEsbuildRepairPlan(input.installRoot);
  if (!repairPlan) {
    return {
      ready: false,
      repaired: false,
      error: initialError,
      repairPlan: null
    };
  }

  const npmCommand = input.npmCommand ?? (process.platform === "win32" ? "npm.cmd" : "npm");
  input.log?.(
    `Repairing esbuild native runtime by reinstalling ${repairPlan.platformPackageName}.`
  );
  await execFileAsync(
    npmCommand,
    ["install", "--omit=dev", "--no-fund", "--no-audit", "--no-save", ...repairPlan.installPackages],
    {
      cwd: input.installRoot
    }
  );

  const repairedError = await verifyEsbuildRuntime(input.installRoot);
  return {
    ready: repairedError === null,
    repaired: true,
    error: repairedError,
    repairPlan
  };
}
