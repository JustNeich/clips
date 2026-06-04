import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Stage3RenderProgressEvent } from "./stage3-render-service";

export const STAGE3_HOST_RENDER_PROGRESS_PREFIX = "__STAGE3_RENDER_PROGRESS__";

export type Stage3HostRenderChildResult = {
  resultJson: string;
  artifact: {
    filePath: string;
    fileName: string;
    mimeType: string;
  };
  cleanupDir: string;
};

type Stage3HostRenderChildOutput =
  | ({
      ok: true;
    } & Stage3HostRenderChildResult)
  | {
      ok: false;
      errorName?: string;
      errorMessage?: string;
      errorStack?: string;
    };

type Stage3HostRenderChildOptions = {
  signal?: AbortSignal | null;
  onProgress?: (event: Stage3RenderProgressEvent) => void;
};

const MAX_CAPTURED_CHILD_OUTPUT = 64 * 1024;

export function resolveStage3HostRenderChildBundlePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.STAGE3_HOST_RENDER_CHILD_BUNDLE?.trim();
  return override ? path.resolve(override) : path.join(process.cwd(), "output", "stage3-host-render-child.cjs");
}

export function shouldUseStage3HostRenderChildProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.RENDER !== "true" && env.RENDER !== "1") {
    return false;
  }
  const raw = env.STAGE3_HOST_RENDER_CHILD_PROCESS?.trim().toLowerCase();
  if (raw === "0" || raw === "false") {
    return false;
  }
  if (raw === "1" || raw === "true") {
    return true;
  }
  return existsSync(resolveStage3HostRenderChildBundlePath(env));
}

function appendCaptured(current: string, chunk: string): string {
  const next = current + chunk;
  if (next.length <= MAX_CAPTURED_CHILD_OUTPUT) {
    return next;
  }
  return next.slice(next.length - MAX_CAPTURED_CHILD_OUTPUT);
}

function killChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to killing the direct child below.
    }
  }
  child.kill(signal);
}

function parseProgressLine(line: string): Stage3RenderProgressEvent | null {
  if (!line.startsWith(STAGE3_HOST_RENDER_PROGRESS_PREFIX)) {
    return null;
  }
  try {
    return JSON.parse(line.slice(STAGE3_HOST_RENDER_PROGRESS_PREFIX.length)) as Stage3RenderProgressEvent;
  } catch {
    return null;
  }
}

function consumeProgressBuffer(
  buffer: string,
  onProgress: ((event: Stage3RenderProgressEvent) => void) | undefined,
  flush = false
): string {
  let remaining = buffer;
  let newlineIndex = remaining.indexOf("\n");
  while (newlineIndex >= 0) {
    const line = remaining.slice(0, newlineIndex).trim();
    remaining = remaining.slice(newlineIndex + 1);
    const event = parseProgressLine(line);
    if (event) {
      onProgress?.(event);
    }
    newlineIndex = remaining.indexOf("\n");
  }
  if (flush && remaining.trim()) {
    const event = parseProgressLine(remaining.trim());
    if (event) {
      onProgress?.(event);
      return "";
    }
  }
  return remaining;
}

export async function renderStage3VideoInChildProcess(
  payloadJson: string,
  options: Stage3HostRenderChildOptions = {}
): Promise<Stage3HostRenderChildResult> {
  const bundlePath = resolveStage3HostRenderChildBundlePath();
  if (!existsSync(bundlePath)) {
    throw new Error(`Stage 3 host render child bundle is missing: ${bundlePath}`);
  }

  const controlDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-host-render-child-"));
  const inputPath = path.join(controlDir, "input.json");
  const outputPath = path.join(controlDir, "output.json");
  await fs.writeFile(inputPath, payloadJson, "utf-8");

  return new Promise<Stage3HostRenderChildResult>((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let progressBuffer = "";
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let abortHandler: (() => void) | null = null;

    const child = spawn(process.execPath, [bundlePath, "--input", inputPath, "--output", outputPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STAGE3_HOST_RENDER_CHILD: "1"
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const cleanupControlDir = () => {
      void fs.rm(controlDir, { recursive: true, force: true }).catch(() => undefined);
    };

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (killTimer) {
        clearTimeout(killTimer);
      }
      if (abortHandler) {
        options.signal?.removeEventListener("abort", abortHandler);
      }
      fn();
    };

    abortHandler = () => {
      killChildProcess(child, "SIGTERM");
      killTimer = setTimeout(() => killChildProcess(child, "SIGKILL"), 5_000);
      const reason = options.signal?.reason;
      finish(() => {
        cleanupControlDir();
        reject(reason instanceof Error ? reason : new DOMException("The operation was aborted.", "AbortError"));
      });
    };

    if (options.signal?.aborted) {
      abortHandler();
      return;
    }
    options.signal?.addEventListener("abort", abortHandler, { once: true });

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout = appendCaptured(stdout, text);
      progressBuffer = consumeProgressBuffer(progressBuffer + text, options.onProgress);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = appendCaptured(stderr, chunk.toString());
    });
    child.once("error", (error) => {
      finish(() => {
        cleanupControlDir();
        reject(error);
      });
    });
    child.once("close", async (code, signal) => {
      progressBuffer = consumeProgressBuffer(progressBuffer, options.onProgress, true);
      try {
        const rawOutput = await fs.readFile(outputPath, "utf-8").catch(() => "");
        const output = rawOutput ? (JSON.parse(rawOutput) as Stage3HostRenderChildOutput) : null;
        if (code === 0 && output?.ok) {
          finish(() => {
            cleanupControlDir();
            resolve({
              resultJson: output.resultJson,
              artifact: output.artifact,
              cleanupDir: output.cleanupDir
            });
          });
          return;
        }

        const message =
          output && !output.ok
            ? output.errorMessage ?? output.errorName ?? "Stage 3 host render child failed."
            : `Stage 3 host render child exited with code ${code ?? "null"} signal ${signal ?? "null"}.`;
        const error = new Error([message, stderr.trim(), stdout.trim()].filter(Boolean).join("\n"));
        finish(() => {
          cleanupControlDir();
          reject(error);
        });
      } catch (error) {
        finish(() => {
          cleanupControlDir();
          reject(error);
        });
      }
    });
  });
}
