import { constants, promises as fs } from "node:fs";

const DEFAULT_CODEX_CANDIDATES = [
  process.env.CODEX_BIN?.trim(),
  "/Applications/Codex.app/Contents/Resources/codex",
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  "codex"
].filter((value): value is string => Boolean(value && value.trim()));

let cachedCodexPath: string | null = null;

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/");
}

async function fileExistsAndExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function codexNotFoundMessage(): string {
  return "Codex CLI не найден. Установите Codex или задайте CODEX_BIN (например /Applications/Codex.app/Contents/Resources/codex), затем перезапустите сервер.";
}

export function isCodexNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

export async function resolveCodexExecutable(): Promise<string> {
  if (cachedCodexPath) {
    return cachedCodexPath;
  }

  for (const candidate of DEFAULT_CODEX_CANDIDATES) {
    if (!candidate.trim()) {
      continue;
    }

    if (!isAbsolutePath(candidate)) {
      cachedCodexPath = candidate;
      return candidate;
    }

    if (await fileExistsAndExecutable(candidate)) {
      cachedCodexPath = candidate;
      return candidate;
    }
  }

  throw new Error(codexNotFoundMessage());
}
