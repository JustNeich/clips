import { requireAuth } from "../../../../lib/auth/guards";
import { getWorkspaceCodexStatus, mutateWorkspaceCodexIntegration } from "../../../../lib/workspace-codex";
import { asErrorResponse } from "../../../../lib/http";

export const runtime = "nodejs";

type Body = {
  action?: "start" | "cancel" | "refresh" | "disconnect";
};

export async function GET(): Promise<Response> {
  try {
    const auth = await requireAuth();
    const integration = await getWorkspaceCodexStatus(auth);
    const ownerView = auth.membership.role === "owner";

    return Response.json(
      {
        sessionId: integration?.codexSessionId ?? null,
        loggedIn: integration?.status === "connected",
        loginStatusText: integration?.loginStatusText ?? "Disconnected",
        deviceAuth: ownerView
          ? {
              status: integration?.deviceAuthStatus ?? "idle",
              output: integration?.deviceAuthOutput ?? "",
              loginUrl: integration?.deviceAuthLoginUrl ?? null,
              userCode: integration?.deviceAuthUserCode ?? null
            }
          : {
              status: integration?.status === "connecting" ? "running" : "idle",
              output: "",
              loginUrl: null,
              userCode: null
            }
      },
      { status: 200 }
    );
  } catch (error) {
    return asErrorResponse(error, "Unable to read shared Codex auth status.");
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const action = body?.action;
  if (action !== "start" && action !== "cancel" && action !== "refresh" && action !== "disconnect") {
    return Response.json({ error: "Unsupported action." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    const integration = await mutateWorkspaceCodexIntegration({ auth, action });
    return Response.json(
      {
        sessionId: integration?.codexSessionId ?? null,
        loggedIn: integration?.status === "connected",
        loginStatusText: integration?.loginStatusText ?? "Disconnected",
        deviceAuth: {
          status: integration?.deviceAuthStatus ?? "idle",
          output: auth.membership.role === "owner" ? integration?.deviceAuthOutput ?? "" : "",
          loginUrl:
            auth.membership.role === "owner" ? integration?.deviceAuthLoginUrl ?? null : null,
          userCode:
            auth.membership.role === "owner" ? integration?.deviceAuthUserCode ?? null : null
        }
      },
      { status: 200 }
    );
  } catch (error) {
    return asErrorResponse(error, "Unable to update shared Codex auth.", 403);
  }
}
