import { requireAuth, requireChannelOperate } from "../../../../lib/auth/guards";
import { scheduleChannelPublicationProcessing } from "../../../../lib/channel-publication-runtime";
import { updateChannelPublicationFromEditor } from "../../../../lib/channel-publication-service";
import { getChannelPublicationById } from "../../../../lib/publication-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type PatchBody = Partial<{
  title: string;
  description: string;
  tags: string[];
  slotDate: string;
  slotIndex: number;
  notifySubscribers: boolean;
}>;

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    const publication = getChannelPublicationById(id);
    if (!publication) {
      return Response.json({ error: "Publication not found." }, { status: 404 });
    }
    await requireChannelOperate(auth, publication.channelId);
    const updated = await updateChannelPublicationFromEditor({
      publicationId: id,
      patch: body
    });
    scheduleChannelPublicationProcessing();
    return Response.json({ publication: updated }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось обновить публикацию." },
      { status: 400 }
    );
  }
}
