import { requireAuth, requireChannelAccessManage, requireChannelVisibility } from "../../../../../lib/auth/guards";
import { listChannelAccess, revokeChannelAccess, setChannelAccess } from "../../../../../lib/channel-access";
import { getMembership, getUserById } from "../../../../../lib/team-store";
import { asErrorResponse } from "../../../../../lib/http";

export const runtime = "nodejs";

type Body = {
  grantUserIds?: string[];
  revokeUserIds?: string[];
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const auth = await requireAuth();
    const { id } = await context.params;
    const { channel } = await requireChannelVisibility(auth, id);
    if (auth.membership.role !== "owner" && auth.membership.role !== "manager" && channel.creatorUserId !== auth.user.id) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const grants = listChannelAccess(id).map((grant) => ({
      ...grant,
      user: getUserById(grant.userId)
    }));
    return Response.json({ grants }, { status: 200 });
  } catch (error) {
    return asErrorResponse(error, "Unable to load channel access.");
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  try {
    const auth = await requireAuth();
    const { id } = await context.params;
    await requireChannelAccessManage(auth, id);

    const grants = Array.isArray(body?.grantUserIds) ? body?.grantUserIds : [];
    const revokes = Array.isArray(body?.revokeUserIds) ? body?.revokeUserIds : [];

    for (const userId of grants) {
      const normalizedUserId = userId?.trim();
      if (!normalizedUserId) {
        continue;
      }
      const membership = getMembership(normalizedUserId, auth.workspace.id);
      if (!membership) {
        return Response.json({ error: "Cannot grant access to a user outside this workspace." }, { status: 400 });
      }
      setChannelAccess({ channelId: id, userId: normalizedUserId, grantedByUserId: auth.user.id });
    }
    for (const userId of revokes) {
      if (userId?.trim()) {
        revokeChannelAccess(id, userId.trim());
      }
    }

    const updated = listChannelAccess(id).map((grant) => ({
      ...grant,
      user: getUserById(grant.userId)
    }));
    return Response.json({ grants: updated }, { status: 200 });
  } catch (error) {
    return asErrorResponse(error, "Unable to update channel access.");
  }
}
