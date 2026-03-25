import type { ChannelPublishIntegrationOption } from "../../../../../../../app/components/types";
import {
  requireAuth,
  requireChannelSetupEdit,
  requireChannelVisibility
} from "../../../../../../../lib/auth/guards";
import {
  deleteChannelPublishIntegration,
  getChannelPublishIntegration,
  updateChannelPublishIntegrationSelection
} from "../../../../../../../lib/publication-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type PatchBody = {
  selectedYoutubeChannelId?: string;
};

function findSelectedChannel(
  availableChannels: ChannelPublishIntegrationOption[],
  selectedYoutubeChannelId: string
): ChannelPublishIntegrationOption | null {
  return availableChannels.find((item) => item.id === selectedYoutubeChannelId) ?? null;
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    await requireChannelVisibility(auth, id);
    return Response.json(
      {
        integration: getChannelPublishIntegration(id)
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить YouTube интеграцию." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as PatchBody | null;
  const selectedYoutubeChannelId = body?.selectedYoutubeChannelId?.trim() ?? "";
  if (!selectedYoutubeChannelId) {
    return Response.json({ error: "selectedYoutubeChannelId is required." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    await requireChannelSetupEdit(auth, id);
    const integration = getChannelPublishIntegration(id);
    if (!integration) {
      return Response.json({ error: "YouTube integration not found." }, { status: 404 });
    }
    const selected = findSelectedChannel(integration.availableChannels, selectedYoutubeChannelId);
    if (!selected) {
      return Response.json({ error: "Выбранный канал недоступен для этого Google identity." }, { status: 400 });
    }
    const next = updateChannelPublishIntegrationSelection({
      channelId: id,
      selectedYoutubeChannelId: selected.id,
      selectedYoutubeChannelTitle: selected.title,
      selectedYoutubeChannelCustomUrl: selected.customUrl ?? null
    });
    return Response.json({ integration: next }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось выбрать целевой YouTube канал." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    await requireChannelSetupEdit(auth, id);
    deleteChannelPublishIntegration(id);
    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось отключить YouTube интеграцию." },
      { status: 400 }
    );
  }
}

