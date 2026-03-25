import { requireAuth, requireChannelOperate } from "../../../../../lib/auth/guards";
import { scheduleChannelPublicationProcessing } from "../../../../../lib/channel-publication-runtime";
import { getChannelPublicationById, publishNowChannelPublication } from "../../../../../lib/publication-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    const publication = getChannelPublicationById(id);
    if (!publication) {
      return Response.json({ error: "Publication not found." }, { status: 404 });
    }
    await requireChannelOperate(auth, publication.channelId);
    const next = publishNowChannelPublication(id);
    scheduleChannelPublicationProcessing();
    return Response.json({ publication: next }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось перевести публикацию в publish now." },
      { status: 400 }
    );
  }
}

