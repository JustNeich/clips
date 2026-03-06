import { requireAuth } from "../../../../../lib/auth/guards";
import {
  getWorkspaceCodexStatus,
  mutateWorkspaceCodexIntegration
} from "../../../../../lib/workspace-codex";
import { asErrorResponse } from "../../../../../lib/http";

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
        integration: integration
          ? ownerView
            ? integration
            : {
                status: integration.status,
                loginStatusText: integration.loginStatusText,
                connectedAt: integration.connectedAt
              }
          : {
              status: "disconnected",
              loginStatusText: "Disconnected",
              connectedAt: null
            }
      },
      { status: 200 }
    );
  } catch (error) {
    return asErrorResponse(error, "Unable to load shared Codex status.");
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
    return Response.json({ integration }, { status: 200 });
  } catch (error) {
    return asErrorResponse(error, "Unable to update shared Codex integration.", 403);
  }
}
