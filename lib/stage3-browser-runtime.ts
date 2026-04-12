import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnsureBrowserOptions } from "@remotion/renderer";

type SupportedPlatform = NodeJS.Platform;

type FileExistsFn = (filePath: string) => Promise<boolean>;
type EnsureBrowserStatus =
  | {
      type: "user-defined-path";
      path: string;
    }
  | {
      type: "local-puppeteer-browser";
      path: string;
    }
  | {
      type: "no-browser";
    }
  | {
      type: "version-mismatch";
      actualVersion: string | null;
    };

type EnsureBrowserFn = (options?: EnsureBrowserOptions) => Promise<EnsureBrowserStatus>;

type DetectBrowserOptions = {
  env?: NodeJS.ProcessEnv;
  fileExists?: FileExistsFn;
  homeDir?: string;
  platform?: SupportedPlatform;
};

type EnsureStage3BrowserOptions = DetectBrowserOptions & {
  chromeMode?: "chrome-for-testing" | "headless-shell";
  ensureBrowserImpl?: EnsureBrowserFn;
  logLevel?: EnsureBrowserOptions["logLevel"];
};

type BrowserCandidate = {
  executablePath: string;
  label: string;
};

export type Stage3DetectedBrowser = {
  browserExecutable: string;
  label: string;
  source: "configured-path" | "local-install";
};

export type Stage3PreparedBrowser = {
  browserExecutable: string;
  description: string;
  source: "configured-path" | "local-install" | "remotion-managed";
};

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const match = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return match ? env[match] : undefined;
}

function getPathApi(platform: SupportedPlatform): typeof path.posix | typeof path.win32 {
  return platform === "win32" ? path.win32 : path.posix;
}

function splitPathEnv(env: NodeJS.ProcessEnv, platform: SupportedPlatform): string[] {
  const raw = getEnvValue(env, "PATH") ?? "";
  return raw.split(platform === "win32" ? ";" : ":").filter(Boolean);
}

function isPathLike(candidate: string, platform: SupportedPlatform): boolean {
  if (path.isAbsolute(candidate)) {
    return true;
  }
  return platform === "win32" ? candidate.includes("\\") || candidate.includes("/") : candidate.includes("/");
}

async function resolveCandidateExecutable(
  candidate: BrowserCandidate,
  options: Required<Pick<DetectBrowserOptions, "env" | "fileExists" | "platform">>
): Promise<string | null> {
  if (isPathLike(candidate.executablePath, options.platform)) {
    return (await options.fileExists(candidate.executablePath)) ? candidate.executablePath : null;
  }

  const pathApi = getPathApi(options.platform);
  for (const directory of splitPathEnv(options.env, options.platform)) {
    const filePath = pathApi.join(directory, candidate.executablePath);
    if (await options.fileExists(filePath)) {
      return filePath;
    }
  }

  return null;
}

function buildBrowserCandidates(platform: SupportedPlatform, env: NodeJS.ProcessEnv, homeDir: string): BrowserCandidate[] {
  if (platform === "win32") {
    const pathApi = path.win32;
    const programFiles = getEnvValue(env, "PROGRAMFILES")?.trim() || "C:\\Program Files";
    const programFilesX86 = getEnvValue(env, "PROGRAMFILES(X86)")?.trim() || "C:\\Program Files (x86)";
    const localAppData =
      getEnvValue(env, "LOCALAPPDATA")?.trim() || pathApi.join(homeDir, "AppData", "Local");

    return [
      {
        executablePath: pathApi.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        label: "Google Chrome"
      },
      {
        executablePath: pathApi.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        label: "Google Chrome"
      },
      {
        executablePath: pathApi.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        label: "Google Chrome"
      },
      {
        executablePath: pathApi.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
        label: "Microsoft Edge"
      },
      {
        executablePath: pathApi.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        label: "Microsoft Edge"
      },
      {
        executablePath: pathApi.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
        label: "Microsoft Edge"
      },
      {
        executablePath: pathApi.join(programFiles, "Chromium", "Application", "chrome.exe"),
        label: "Chromium"
      },
      {
        executablePath: "chrome.exe",
        label: "Google Chrome"
      },
      {
        executablePath: "msedge.exe",
        label: "Microsoft Edge"
      },
      {
        executablePath: "chromium.exe",
        label: "Chromium"
      }
    ];
  }

  if (platform === "darwin") {
    const pathApi = path.posix;
    return [
      {
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        label: "Google Chrome"
      },
      {
        executablePath: pathApi.join(homeDir, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
        label: "Google Chrome"
      },
      {
        executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        label: "Microsoft Edge"
      },
      {
        executablePath: pathApi.join(homeDir, "Applications", "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
        label: "Microsoft Edge"
      },
      {
        executablePath: "/Applications/Chromium.app/Contents/MacOS/Chromium",
        label: "Chromium"
      },
      {
        executablePath: "google-chrome",
        label: "Google Chrome"
      },
      {
        executablePath: "chromium",
        label: "Chromium"
      },
      {
        executablePath: "chromium-browser",
        label: "Chromium"
      }
    ];
  }

  return [
    {
      executablePath: "/usr/bin/google-chrome-stable",
      label: "Google Chrome"
    },
    {
      executablePath: "/usr/bin/google-chrome",
      label: "Google Chrome"
    },
    {
      executablePath: "/usr/bin/chromium-browser",
      label: "Chromium"
    },
    {
      executablePath: "/usr/bin/chromium",
      label: "Chromium"
    },
    {
      executablePath: "google-chrome-stable",
      label: "Google Chrome"
    },
    {
      executablePath: "google-chrome",
      label: "Google Chrome"
    },
    {
      executablePath: "chromium-browser",
      label: "Chromium"
    },
    {
      executablePath: "chromium",
      label: "Chromium"
    }
  ];
}

export async function detectPreferredStage3Browser(
  options: DetectBrowserOptions = {}
): Promise<Stage3DetectedBrowser | null> {
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? defaultFileExists;
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;

  const configuredPath = getEnvValue(env, "STAGE3_BROWSER_EXECUTABLE")?.trim();
  if (configuredPath) {
    if (!(await fileExists(configuredPath))) {
      throw new Error(
        `STAGE3_BROWSER_EXECUTABLE points to a missing file: ${configuredPath}. ` +
          "Update the path or unset it to let Stage 3 detect a local browser automatically."
      );
    }
    return {
      browserExecutable: configuredPath,
      label: "STAGE3_BROWSER_EXECUTABLE",
      source: "configured-path"
    };
  }

  for (const candidate of buildBrowserCandidates(platform, env, homeDir)) {
    const executablePath = await resolveCandidateExecutable(candidate, {
      env,
      fileExists,
      platform
    });
    if (executablePath) {
      return {
        browserExecutable: executablePath,
        label: candidate.label,
        source: "local-install"
      };
    }
  }

  return null;
}

export async function ensureStage3RenderBrowser(
  options: EnsureStage3BrowserOptions = {}
): Promise<Stage3PreparedBrowser> {
  const detected = await detectPreferredStage3Browser(options);
  const ensureBrowserImpl =
    options.ensureBrowserImpl ??
    ((await import("@remotion/renderer")).ensureBrowser as EnsureBrowserFn);
  const status = await ensureBrowserImpl({
    browserExecutable: detected?.browserExecutable ?? null,
    chromeMode: options.chromeMode ?? "headless-shell",
    logLevel: options.logLevel ?? "info"
  });

  if (status.type === "user-defined-path") {
    if (detected?.source === "configured-path") {
      return {
        browserExecutable: status.path,
        description: `Using configured Stage 3 browser: ${status.path}`,
        source: "configured-path"
      };
    }

    return {
      browserExecutable: status.path,
      description: `Using local Stage 3 browser (${detected?.label ?? "Chromium"}): ${status.path}`,
      source: "local-install"
    };
  }

  if (status.type === "local-puppeteer-browser") {
    return {
      browserExecutable: status.path,
      description: `Using Remotion-managed Stage 3 browser: ${status.path}`,
      source: "remotion-managed"
    };
  }

  throw new Error(
    "Stage 3 could not prepare a browser for Remotion rendering. " +
      "Install Google Chrome or Microsoft Edge locally, or allow the worker to download Remotion Headless Shell."
  );
}
