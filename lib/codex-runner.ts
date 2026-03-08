import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  codexNotFoundMessage,
  isCodexNotFoundError,
  resolveCodexExecutable
} from "./codex-binary";

const execFileAsync = promisify(execFile);

type RunCodexExecInput = {
  prompt: string;
  imagePaths: string[];
  outputSchemaPath: string;
  outputMessagePath: string;
  cwd: string;
  codexHome: string;
  timeoutMs?: number;
  model?: string | null;
  reasoningEffort?: string | null;
};

type RunCodexExecResult = {
  stdout: string;
  stderr: string;
};

export async function getCodexLoginStatus(
  codexHome: string
): Promise<{ loggedIn: boolean; raw: string }> {
  let raw = "Unknown";
  try {
    const codexBin = await resolveCodexExecutable();
    const { stdout, stderr } = await execFileAsync(codexBin, ["login", "status"], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        CODEX_HOME: codexHome
      }
    });
    raw = `${stdout}${stderr}`.trim() || "Unknown";
  } catch (error) {
    if (isCodexNotFoundError(error)) {
      throw new Error(codexNotFoundMessage());
    }
    // codex login status exits non-zero when user is not logged in.
    if (typeof error === "object" && error !== null && "stdout" in error) {
      const stdout = String((error as { stdout?: string }).stdout ?? "");
      const stderr = String((error as { stderr?: string }).stderr ?? "");
      raw = `${stdout}${stderr}`.trim() || "Not logged in";
    }
    if (raw.toLowerCase().includes("not logged in")) {
      return { loggedIn: false, raw };
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Не удалось проверить статус Codex login.");
  }

  return {
    loggedIn: raw.toLowerCase().includes("logged in"),
    raw
  };
}

export async function ensureCodexLoggedIn(codexHome: string): Promise<void> {
  try {
    const status = await getCodexLoginStatus(codexHome);
    if (!status.loggedIn) {
      throw new Error(
        "Codex не авторизован для этой сессии. Нажмите «Подключить Codex» и завершите вход."
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Для этой сессии требуется вход в Codex.");
  }
}

export async function runCodexExec(input: RunCodexExecInput): Promise<RunCodexExecResult> {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--cd",
    input.cwd,
    "--ephemeral",
    "--output-schema",
    input.outputSchemaPath,
    "--output-last-message",
    input.outputMessagePath
  ];

  if (input.model && input.model.trim()) {
    args.push("--model", input.model.trim());
  }
  if (input.reasoningEffort && input.reasoningEffort.trim()) {
    args.push("-c", `model_reasoning_effort="${input.reasoningEffort.trim()}"`);
  }

  for (const imagePath of input.imagePaths) {
    args.push("--image", imagePath);
  }

  // Read prompt from stdin to avoid command length limits.
  args.push("-");

  const timeoutMs = input.timeoutMs ?? 8 * 60_000;
  const codexBin = await resolveCodexExecutable();

  return new Promise((resolve, reject) => {
    const child = spawn(codexBin, args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        CODEX_HOME: input.codexHome
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex generation timed out."));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (isCodexNotFoundError(error)) {
        reject(new Error(codexNotFoundMessage()));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || "Codex exec failed."));
        return;
      }

      resolve({ stdout, stderr });
    });

    child.stdin.write(input.prompt);
    child.stdin.end();
  });
}
