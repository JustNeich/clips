import { requireAuth, requireChannelVisibility } from "../../../../../lib/auth/guards";
import { scheduleChannelPublicationProcessing } from "../../../../../lib/channel-publication-runtime";
import { listChannelPublications } from "../../../../../lib/publication-store";

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
        publications: listChannelPublications(id)
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить очередь публикаций." },
      { status: 500 }
    );
  }
}

