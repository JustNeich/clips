import type { ChannelPublishIntegrationOption } from "../../../../../../../app/components/types";
import { requireConnectorChannelAccess } from "../../../../../../../lib/auth/guards";
import {
  getChannelPublishIntegration,
  updateChannelPublishIntegrationSelection
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
    await requireConnectorChannelAccess(request, id);
    const integration = getChannelPublishIntegration(id);
    if (!integration) {
      return Response.json({ error: "Сначала подключите Google-аккаунт." }, { status: 404 });
    }
    const selected = findSelected(integration.availableChannels, selectedYoutubeChannelId);
    if (!selected) {
      return Response.json({ error: "Этот канал недоступен для подключённого Google-аккаунта." }, { status: 400 });
    }
    const updated = updateChannelPublishIntegrationSelection({
      channelId: id,
      selectedYoutubeChannelId: selected.id,
      selectedYoutubeChannelTitle: selected.title,
      selectedYoutubeChannelCustomUrl: selected.customUrl ?? null
    });
    return Response.json({
      integration: {
        status: updated.status,
        selectedYoutubeChannelId: updated.selectedYoutubeChannelId,
        selectedYoutubeChannelTitle: updated.selectedYoutubeChannelTitle,
        selectedYoutubeChannelCustomUrl: updated.selectedYoutubeChannelCustomUrl
      }
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Не удалось выбрать YouTube-канал." }, { status: 500 });
  }
}
