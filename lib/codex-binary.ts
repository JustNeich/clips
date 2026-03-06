import { resolveExecutableFromCandidates } from "./command-path";

const DEFAULT_CODEX_CANDIDATES = [
  process.env.CODEX_BIN?.trim(),
  "/Applications/Codex.app/Contents/Resources/codex",
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  "codex"
].filter((value): value is string => Boolean(value && value.trim()));

let cachedCodexPath: string | null = null;

export function codexNotFoundMessage(): string {
  if (process.env.VERCEL === "1") {
    return "Codex CLI недоступен на этом Vercel deployment. Shared Codex device auth здесь не заработает без внешнего runtime/worker.";
  }
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

  const resolved = await resolveExecutableFromCandidates(DEFAULT_CODEX_CANDIDATES);
  if (resolved) {
    cachedCodexPath = resolved;
    return resolved;
  }

  throw new Error(codexNotFoundMessage());
}
