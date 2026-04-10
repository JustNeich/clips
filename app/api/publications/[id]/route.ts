import { requireAuth, requireChannelOperate } from "../../../../lib/auth/guards";
import { scheduleChannelPublicationProcessing } from "../../../../lib/channel-publication-runtime";
import { updateChannelPublicationFromEditor } from "../../../../lib/channel-publication-service";
import {
  PublicationMutationError,
  toPublicationMutationErrorPayload
} from "../../../../lib/publication-mutation-errors";
import { getChannelPublicationById } from "../../../../lib/publication-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type PatchBody = Partial<{
  title: string;
  description: string;
  tags: string[];
  scheduleMode: "slot" | "custom";
  scheduledAtLocal: string;
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
    const auth = await requireAuth(request);
    const publication = getChannelPublicationById(id);
    if (!publication) {
      const payload = toPublicationMutationErrorPayload(
        new PublicationMutationError("Публикация не найдена.", {
          code: "PUBLICATION_NOT_FOUND",
          status: 404
        }),
        "Не удалось обновить публикацию."
      );
      return Response.json(payload.body, { status: payload.status });
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
    const payload = toPublicationMutationErrorPayload(error, "Не удалось обновить публикацию.");
    return Response.json(payload.body, { status: payload.status });
  }
}
