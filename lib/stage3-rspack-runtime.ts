import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type PlatformInput = {
  platform?: NodeJS.Platform;
  arch?: string;
  musl?: boolean;
};

export type Stage3RspackRepairPlan = {
  coreVersion: string | null;
  bindingVersion: string | null;
  platformPackageName: string;
  platformPackageVersion: string | null;
  installPackages: string[];
};

export type Stage3RspackRuntimeStatus = {
  ready: boolean;
  repaired: boolean;
  error: string | null;
  repairPlan: Stage3RspackRepairPlan | null;
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

function detectMusl(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  const report = process.report?.getReport?.() as
    | { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] }
    | undefined;
  if (report?.header?.glibcVersionRuntime) {
    return false;
  }
  return Array.isArray(report?.sharedObjects)
    ? report.sharedObjects.some((entry) => entry.includes("musl"))
    : false;
}

export function resolveRspackPlatformPackageName(input?: PlatformInput): string | null {
  const platform = input?.platform ?? process.platform;
  const arch = input?.arch ?? process.arch;
  const musl = input?.musl ?? detectMusl();

  if (platform === "darwin" && arch === "arm64") {
    return "@rspack/binding-darwin-arm64";
  }
  if (platform === "darwin" && arch === "x64") {
    return "@rspack/binding-darwin-x64";
  }
  if (platform === "win32" && arch === "x64") {
    return "@rspack/binding-win32-x64-msvc";
  }
  if (platform === "win32" && arch === "arm64") {
    return "@rspack/binding-win32-arm64-msvc";
  }
  if (platform === "win32" && arch === "ia32") {
    return "@rspack/binding-win32-ia32-msvc";
  }
  if (platform === "linux" && arch === "x64") {
    return musl ? "@rspack/binding-linux-x64-musl" : "@rspack/binding-linux-x64-gnu";
  }
  if (platform === "linux" && arch === "arm64") {
    return musl ? "@rspack/binding-linux-arm64-musl" : "@rspack/binding-linux-arm64-gnu";
  }
  return null;
}

export function isRspackNativeBindingError(value: unknown): boolean {
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
    lower.includes("cannot find native binding") ||
    lower.includes("@rspack/binding") ||
    lower.includes("rspack.darwin") ||
    lower.includes("rspack.win32") ||
    lower.includes("rspack.linux")
  );
}

async function verifyRspackRuntime(installRoot: string): Promise<string | null> {
  const verificationScript = `
const path = require("node:path");
const { createRequire } = require("node:module");
const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"));
requireFromRoot("@rspack/core");
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

export async function readRspackRepairPlan(
  installRoot: string,
  input?: PlatformInput
): Promise<Stage3RspackRepairPlan | null> {
  const bindingPackageName = "@rspack/binding";
  const corePackage = (await readJson<{
    version?: string;
    dependencies?: Record<string, string>;
  }>(path.join(installRoot, "node_modules", "@rspack", "core", "package.json"))) ?? {
    version: null,
    dependencies: {} as Record<string, string>
  };
  const bindingPackage = (await readJson<{
    version?: string;
    optionalDependencies?: Record<string, string>;
  }>(path.join(installRoot, "node_modules", "@rspack", "binding", "package.json"))) ?? {
    version: null,
    optionalDependencies: {} as Record<string, string>
  };
  const coreDependencies = corePackage.dependencies ?? {};
  const bindingOptionalDependencies = bindingPackage.optionalDependencies ?? {};

  const platformPackageName = resolveRspackPlatformPackageName(input);
  if (!platformPackageName) {
    return null;
  }

  const coreVersion = normalizeVersion(corePackage.version);
  const bindingVersion =
    normalizeVersion(bindingPackage.version) ??
    normalizeVersion(coreDependencies[bindingPackageName]) ??
    null;
  const platformPackageVersion =
    normalizeVersion(bindingOptionalDependencies[platformPackageName]) ?? bindingVersion;

  if (!bindingVersion || !platformPackageVersion) {
    return null;
  }

  const installPackages = [
    coreVersion ? `@rspack/core@${coreVersion}` : null,
    `@rspack/binding@${bindingVersion}`,
    `${platformPackageName}@${platformPackageVersion}`
  ].filter((value): value is string => Boolean(value));

  return {
    coreVersion,
    bindingVersion,
    platformPackageName,
    platformPackageVersion,
    installPackages
  };
}

export async function ensureRspackRuntimeAvailable(input: {
  installRoot: string;
  repair?: boolean;
  npmCommand?: string;
  log?: (message: string) => void;
}): Promise<Stage3RspackRuntimeStatus> {
  const initialError = await verifyRspackRuntime(input.installRoot);
  if (!initialError) {
    return { ready: true, repaired: false, error: null, repairPlan: null };
  }

  if (input.repair === false || !isRspackNativeBindingError(initialError)) {
    return {
      ready: false,
      repaired: false,
      error: initialError,
      repairPlan: null
    };
  }

  const repairPlan = await readRspackRepairPlan(input.installRoot);
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
    `Repairing missing rspack native runtime by reinstalling ${repairPlan.platformPackageName}.`
  );
  await execFileAsync(
    npmCommand,
    ["install", "--omit=dev", "--no-fund", "--no-audit", "--no-save", ...repairPlan.installPackages],
    {
      cwd: input.installRoot
    }
  );

  const repairedError = await verifyRspackRuntime(input.installRoot);
  return {
    ready: repairedError === null,
    repaired: true,
    error: repairedError,
    repairPlan
  };
}
