import type { ChannelPublishSettings } from "../../../../../../app/components/types";
import {
  requireAuth,
  requireChannelSetupEdit,
  requireChannelVisibility
} from "../../../../../../lib/auth/guards";
import { scheduleChannelPublicationProcessing } from "../../../../../../lib/channel-publication-runtime";
import {
  getChannelPublishSettings,
  upsertChannelPublishSettings
} from "../../../../../../lib/publication-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    await requireChannelVisibility(auth, id);
    scheduleChannelPublicationProcessing();
    return Response.json(
      {
        settings: getChannelPublishSettings(id)
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить настройки публикации." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Partial<ChannelPublishSettings> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    await requireChannelSetupEdit(auth, id);
    const settings = upsertChannelPublishSettings({
      workspaceId: auth.workspace.id,
      channelId: id,
      userId: auth.user.id,
      patch: body
    });
    scheduleChannelPublicationProcessing();
    return Response.json({ settings }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить настройки публикации." },
      { status: 400 }
    );
  }
}

