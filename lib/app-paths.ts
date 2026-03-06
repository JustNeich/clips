import path from "node:path";

function normalizeOverride(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isRenderRuntime(): boolean {
  return process.env.RENDER === "true" || process.env.RENDER === "1";
}

export function getAppDataDir(): string {
  const explicit = normalizeOverride(process.env.APP_DATA_DIR);
  if (explicit) {
    return explicit;
  }
  if (process.env.VERCEL === "1") {
    return path.join("/tmp", "clips-automations-data");
  }
  if (isRenderRuntime()) {
    return path.join("/var", "data", "app");
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
  if (isRenderRuntime()) {
    return path.join("/var", "data", "codex-sessions");
  }
  return path.join(process.cwd(), ".codex-user-sessions");
}
