import type { ChannelPublishIntegrationOption } from "../../../../../../../app/components/types";
import { appendFlowAuditEvent } from "../../../../../../../lib/audit-log-store";
import { requireConnectorChannelAccess } from "../../../../../../../lib/auth/guards";
import {
  buildConnectorChannelIdentity,
  importConnectorChannelAvatar
} from "../../../../../../../lib/connector-channel-onboarding";
import {
  getChannelPublishIntegration,
  updateChannelPublishIntegrationSelection,
  YouTubeDestinationConflictError
} from "../../../../../../../lib/publication-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
type Body = { selectedYoutubeChannelId?: string };

function findSelected(
  available: ChannelPublishIntegrationOption[],
  selectedYoutubeChannelId: string
): ChannelPublishIntegrationOption | null {
  return available.find((item) => item.id === selectedYoutubeChannelId) ?? null;
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const selectedYoutubeChannelId = body?.selectedYoutubeChannelId?.trim() ?? "";
  if (!selectedYoutubeChannelId) {
    return Response.json({ error: "Выберите YouTube-канал." }, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const { auth } = await requireConnectorChannelAccess(request, id);
    const integration = getChannelPublishIntegration(id);
    if (!integration) {
      return Response.json({ error: "Сначала подключите Google-аккаунт." }, { status: 404 });
    }
    const selected = findSelected(integration.availableChannels, selectedYoutubeChannelId);
    if (!selected) {
      return Response.json({ error: "Этот канал недоступен для подключённого Google-аккаунта." }, { status: 400 });
    }
    const identity = buildConnectorChannelIdentity(selected);
    const updated = updateChannelPublishIntegrationSelection({
      channelId: id,
      selectedYoutubeChannelId: selected.id,
      selectedYoutubeChannelTitle: selected.title,
      selectedYoutubeChannelCustomUrl: selected.customUrl ?? null,
      channelIdentity: identity
    });
    const avatar = await importConnectorChannelAvatar({
      channelId: id,
      thumbnailUrl: selected.thumbnailUrl
    }).catch(() => ({ imported: false, reason: "avatar_import_failed" }));
    appendFlowAuditEvent({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      channelId: id,
      action: "channel_connector.youtube_selected",
      entityType: "channel_publish_integration",
      entityId: id,
      stage: "auth",
      status: "connected",
      payload: {
        youtubeChannelId: selected.id,
        onboardingStatus: identity.onboardingStatus,
        avatarImported: avatar.imported
      }
    });
    return Response.json({
      integration: {
        status: updated.status,
        selectedYoutubeChannelId: updated.selectedYoutubeChannelId,
        selectedYoutubeChannelTitle: updated.selectedYoutubeChannelTitle,
        selectedYoutubeChannelCustomUrl: updated.selectedYoutubeChannelCustomUrl
      },
      channel: {
        name: identity.name,
        username: identity.username,
        onboardingStatus: identity.onboardingStatus,
        confirmedHandle: identity.confirmedHandle
      },
      avatar
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof YouTubeDestinationConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: "Не удалось выбрать YouTube-канал." }, { status: 500 });
  }
}
