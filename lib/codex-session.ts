import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SESSION_DIR = path.join(process.cwd(), ".codex-user-sessions");

export function normalizeCodexSessionId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{16,96}$/.test(value)) {
    return null;
  }

  return value;
}

export function createCodexSessionId(): string {
  return randomUUID().replace(/-/g, "");
}

export async function ensureCodexHomeForSession(sessionId: string): Promise<string> {
  const codexHome = path.join(SESSION_DIR, sessionId);
  await fs.mkdir(codexHome, { recursive: true });
  return codexHome;
}
