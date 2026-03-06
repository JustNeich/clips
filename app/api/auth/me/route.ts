import { requireAuth } from "../../../../lib/auth/guards";
import { getEffectivePermissions } from "../../../../lib/team-store";
import { getWorkspaceCodexStatus } from "../../../../lib/workspace-codex";
import { asErrorResponse } from "../../../../lib/http";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const auth = await requireAuth();
    const integration = await getWorkspaceCodexStatus(auth);
    const ownerView = auth.membership.role === "owner";

    return Response.json(
      {
        user: auth.user,
        workspace: auth.workspace,
        membership: auth.membership,
        sharedCodexStatus: integration
          ? {
              status: integration.status,
              connected: integration.status === "connected",
              loginStatusText: integration.loginStatusText,
              deviceAuth: ownerView
                ? {
                    status: integration.deviceAuthStatus,
                    output: integration.deviceAuthOutput,
                    loginUrl: integration.deviceAuthLoginUrl,
                    userCode: integration.deviceAuthUserCode
                  }
                : null
            }
          : {
              status: "disconnected",
              connected: false,
              loginStatusText: "Disconnected",
              deviceAuth: ownerView
                ? { status: "idle", output: "", loginUrl: null, userCode: null }
                : null
            },
        effectivePermissions: getEffectivePermissions(auth.membership.role)
      },
      { status: 200 }
    );
  } catch (error) {
    return asErrorResponse(error, "Unable to resolve session.");
  }
}
