import { appendFlowAuditEvent } from "../../../../../lib/audit-log-store";
import { requireConnectorChannelAccess } from "../../../../../lib/auth/guards";
import { deleteChannelAssetDir } from "../../../../../lib/channel-assets";
import { deleteChannelById } from "../../../../../lib/chat-history";
import { getChannelPublishIntegration } from "../../../../../lib/publication-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const { auth, channel } = await requireConnectorChannelAccess(request, id);
    const integration = getChannelPublishIntegration(id);
    if (channel.onboardingStatus !== "draft" || integration?.selectedYoutubeChannelId) {
      return Response.json(
        { error: "Подключённый канал нельзя удалить из этого портала." },
        { status: 409 }
      );
    }
    const result = await deleteChannelById(id);
    if (!result.deleted) {
      return Response.json({ error: "Канал не найден." }, { status: 404 });
    }
    await deleteChannelAssetDir(id);
    appendFlowAuditEvent({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      channelId: id,
      action: "channel_connector.draft_deleted",
      entityType: "channel",
      entityId: id,
      stage: "auth",
      status: "deleted",
      payload: { onboardingStatus: channel.onboardingStatus }
    });
    return Response.json({ deleted: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Не удалось удалить черновик канала." }, { status: 500 });
  }
}
