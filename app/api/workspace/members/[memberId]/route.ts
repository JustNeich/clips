import { requireAuth } from "../../../../../lib/auth/guards";
import {
  canManageMemberRoleTransition,
  getWorkspaceMember,
  updateWorkspaceMemberRole,
  validateInviteRole
} from "../../../../../lib/team-store";
import { asErrorResponse } from "../../../../../lib/http";

export const runtime = "nodejs";

type Body = {
  role?: string;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ memberId: string }> }
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const role = validateInviteRole(body?.role);
  if (!role) {
    return Response.json({ error: "Передайте валидную role." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    const { memberId } = await context.params;
    const currentMember = getWorkspaceMember(auth.workspace.id, memberId);
    if (!currentMember) {
      return Response.json({ error: "Member not found." }, { status: 404 });
    }

    if (
      !canManageMemberRoleTransition(auth.membership.role, currentMember.role, role)
    ) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const member = updateWorkspaceMemberRole(auth.workspace.id, memberId, role);
    return Response.json({ member }, { status: 200 });
  } catch (error) {
    return asErrorResponse(error, "Не удалось обновить роль участника.", 400);
  }
}
