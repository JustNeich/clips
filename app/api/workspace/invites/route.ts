import { requireAuth } from "../../../../lib/auth/guards";
import { canManageInviteRole, createInvite, validateInviteRole } from "../../../../lib/team-store";
import { asErrorResponse } from "../../../../lib/http";

export const runtime = "nodejs";

type Body = {
  email?: string;
  role?: string;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const email = body?.email?.trim();
  const role = validateInviteRole(body?.role);

  if (!email || !role) {
    return Response.json({ error: "Передайте email и role." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    if (!canManageInviteRole(auth.membership.role, role)) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const invite = await createInvite({
      workspaceId: auth.workspace.id,
      email,
      role,
      createdByUserId: auth.user.id
    });
    return Response.json({ invite }, { status: 200 });
  } catch (error) {
    return asErrorResponse(error, "Не удалось создать приглашение.", 400);
  }
}
