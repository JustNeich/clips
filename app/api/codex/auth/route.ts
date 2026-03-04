import { ensureCodexHomeForSession, normalizeCodexSessionId } from "../../../../lib/codex-session";
import {
  cancelDeviceAuth,
  getCombinedCodexAuthState,
  startDeviceAuth
} from "../../../../lib/codex-auth";

export const runtime = "nodejs";

function isClientErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("missing or invalid") || lower.includes("unsupported action");
}

function errorResponse(error: unknown, fallback: string): Response {
  const message = error instanceof Error ? error.message : fallback;
  const status = isClientErrorMessage(message) ? 400 : 500;
  return Response.json({ error: message }, { status });
}

function extractSessionId(request: Request): string {
  const sessionId = normalizeCodexSessionId(request.headers.get("x-codex-session-id"));
  if (!sessionId) {
    throw new Error("Missing or invalid x-codex-session-id.");
  }
  return sessionId;
}

async function buildStatusResponse(request: Request): Promise<Response> {
  const sessionId = extractSessionId(request);
  const codexHome = await ensureCodexHomeForSession(sessionId);
  const state = await getCombinedCodexAuthState(sessionId, codexHome);

  return Response.json(
    {
      sessionId,
      loggedIn: state.loggedIn,
      loginStatusText: state.loginStatusText,
      deviceAuth: state.deviceAuth
    },
    { status: 200 }
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await buildStatusResponse(request);
  } catch (error) {
    return errorResponse(error, "Unable to read Codex auth status.");
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const sessionId = extractSessionId(request);
    const codexHome = await ensureCodexHomeForSession(sessionId);
    const body = (await request.json().catch(() => null)) as { action?: string } | null;
    const action = body?.action?.trim();

    if (action === "start") {
      await startDeviceAuth(sessionId, codexHome);
      return await buildStatusResponse(request);
    }

    if (action === "cancel") {
      cancelDeviceAuth(sessionId);
      return await buildStatusResponse(request);
    }

    return Response.json(
      { error: "Unsupported action. Use action=start or action=cancel." },
      { status: 400 }
    );
  } catch (error) {
    return errorResponse(error, "Unable to perform Codex auth action.");
  }
}
