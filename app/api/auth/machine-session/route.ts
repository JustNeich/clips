import { requireOwnerOrMcpMachineScope } from "../../../../lib/auth/guards";
import { buildAppSessionSetCookieHeader } from "../../../../lib/auth/cookies";
import {
  createAuthSession,
  getAuthContextByToken,
  getEffectivePermissions,
  getRequestMetadata
} from "../../../../lib/team-store";
import { asErrorResponse } from "../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireOwnerOrMcpMachineScope(request, "control:write");
    const meta = getRequestMetadata(request);
    const session = createAuthSession({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      ...meta
    });
    const context = getAuthContextByToken(session.token);
    if (!context) {
      throw new Error("Machine credential owner cannot create an app session.");
    }
    const expiresAt = new Date(session.record.expiresAt);
    return Response.json(
      {
        workspace: context.workspace,
        user: context.user,
        membership: context.membership,
        effectivePermissions: getEffectivePermissions(context.membership.role)
      },
      {
        status: 200,
        headers: {
          "Set-Cookie": buildAppSessionSetCookieHeader(session.token, expiresAt)
        }
      }
    );
  } catch (error) {
    return asErrorResponse(error, "Не удалось создать machine session.");
  }
}
