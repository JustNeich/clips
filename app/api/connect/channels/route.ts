import { appendFlowAuditEvent } from "../../../../lib/audit-log-store";
import { requireConnectorAuth } from "../../../../lib/auth/guards";
import {
  createConnectorChannelDraft,
  listChannelsCreatedByUser
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
    const ownChannels = await listChannelsCreatedByUser({
      workspaceId: auth.workspace.id,
      userId: auth.user.id
    });
    const channels = ownChannels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        username: channel.username,
        onboardingStatus: channel.onboardingStatus,
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
    return Response.json({ error: "Не удалось загрузить созданные каналы." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = requireConnectorAuth(request);
    const result = await createConnectorChannelDraft({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id
    });
    if (result.created) {
      appendFlowAuditEvent({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        channelId: result.channel.id,
        action: "channel_connector.draft_created",
        entityType: "channel",
        entityId: result.channel.id,
        stage: "auth",
        status: "created",
        payload: { onboardingStatus: result.channel.onboardingStatus }
      });
    }
    return Response.json(
      {
        channel: {
          id: result.channel.id,
          name: result.channel.name,
          username: result.channel.username,
          onboardingStatus: result.channel.onboardingStatus,
          integration: publicIntegration(result.channel.id)
        },
        created: result.created
      },
      {
        status: result.created ? 201 : 200,
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Не удалось создать канал." }, { status: 500 });
  }
}
