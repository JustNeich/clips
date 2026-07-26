import { requireConnectorAuth } from "../../../../lib/auth/guards";
import {
  listChannelAccessForUserByChannelIds,
  listVisibleChannelsWithStats
} from "../../../../lib/chat-history";
import { getChannelPublishIntegration } from "../../../../lib/publication-store";

export const runtime = "nodejs";

function publicIntegration(channelId: string) {
  const integration = getChannelPublishIntegration(channelId);
  if (!integration) {
    return null;
  }
  return {
    status: integration.status,
    selectedGoogleAccountEmail: integration.selectedGoogleAccountEmail,
    selectedYoutubeChannelId: integration.selectedYoutubeChannelId,
    selectedYoutubeChannelTitle: integration.selectedYoutubeChannelTitle,
    selectedYoutubeChannelCustomUrl: integration.selectedYoutubeChannelCustomUrl,
    availableChannels: integration.availableChannels,
    updatedAt: integration.updatedAt,
    lastError: integration.lastError
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = requireConnectorAuth(request);
    const visible = await listVisibleChannelsWithStats({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      role: auth.membership.role
    });
    const grants = await listChannelAccessForUserByChannelIds(
      visible.map((channel) => channel.id),
      auth.user.id
    );
    const channels = visible
      .filter((channel) => grants.get(channel.id)?.accessRole === "connect")
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        username: channel.username,
        integration: publicIntegration(channel.id)
      }));
    return Response.json(
      { user: auth.user, channels },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Не удалось загрузить назначенные каналы." }, { status: 500 });
  }
}
