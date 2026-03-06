import path from "node:path";

function normalizeOverride(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getAppDataDir(): string {
  const explicit = normalizeOverride(process.env.APP_DATA_DIR);
  if (explicit) {
    return explicit;
  }
  if (process.env.VERCEL === "1") {
    return path.join("/tmp", "clips-automations-data");
  }
  return path.join(process.cwd(), ".data");
}

export function getCodexSessionsDir(): string {
  const explicit = normalizeOverride(process.env.CODEX_SESSIONS_DIR);
  if (explicit) {
    return explicit;
  }
  if (process.env.VERCEL === "1") {
    return path.join("/tmp", "clips-automations-codex-sessions");
  }
  return path.join(process.cwd(), ".codex-user-sessions");
}
