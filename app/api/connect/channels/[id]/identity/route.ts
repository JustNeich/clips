import { appendFlowAuditEvent } from "../../../../../../lib/audit-log-store";
import { requireConnectorChannelAccess } from "../../../../../../lib/auth/guards";
import { updateChannelById } from "../../../../../../lib/chat-history";
import { getChannelPublishIntegration } from "../../../../../../lib/publication-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
type Body = { name?: string; username?: string };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const name = body?.name?.trim() ?? "";
  const username = body?.username?.trim() ?? "";
  if (!name) {
    return Response.json({ error: "Укажите название канала." }, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const { auth, channel } = await requireConnectorChannelAccess(request, id);
    const integration = getChannelPublishIntegration(id);
    if (!integration?.selectedYoutubeChannelId) {
      return Response.json({ error: "Сначала подключите YouTube-канал." }, { status: 409 });
    }
    const updated = await updateChannelById(id, {
      name,
      ...(username ? { username } : {}),
      onboardingStatus: "ready"
    });
    appendFlowAuditEvent({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      channelId: id,
      action: "channel_connector.identity_completed",
      entityType: "channel",
      entityId: id,
      stage: "auth",
      status: "ready",
      payload: { previousOnboardingStatus: channel.onboardingStatus }
    });
    return Response.json({
      channel: {
        id: updated.id,
        name: updated.name,
        username: updated.username,
        onboardingStatus: updated.onboardingStatus
      },
      previousOnboardingStatus: channel.onboardingStatus
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Не удалось сохранить данные канала." }, { status: 500 });
  }
}
