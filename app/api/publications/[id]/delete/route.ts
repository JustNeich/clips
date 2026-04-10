import { requireAuth, requireChannelOperate } from "../../../../../lib/auth/guards";
import { deleteChannelPublicationWithRemoteSync } from "../../../../../lib/channel-publication-service";
import {
  PublicationMutationError,
  toPublicationMutationErrorPayload
} from "../../../../../lib/publication-mutation-errors";
import { getChannelPublicationById } from "../../../../../lib/publication-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth(request);
    const publication = getChannelPublicationById(id);
    if (!publication) {
      const payload = toPublicationMutationErrorPayload(
        new PublicationMutationError("Публикация не найдена.", {
          code: "PUBLICATION_NOT_FOUND",
          status: 404
        }),
        "Не удалось удалить публикацию."
      );
      return Response.json(payload.body, { status: payload.status });
    }
    await requireChannelOperate(auth, publication.channelId);
    const next = await deleteChannelPublicationWithRemoteSync(id);
    return Response.json({ publication: next }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const payload = toPublicationMutationErrorPayload(error, "Не удалось удалить публикацию.");
    return Response.json(payload.body, { status: payload.status });
  }
}
