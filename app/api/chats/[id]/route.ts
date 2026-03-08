import { deleteChatById, getChatById } from "../../../../lib/chat-history";
import { requireAuth, requireChannelOperate, requireChannelVisibility } from "../../../../lib/auth/guards";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    const chat = await getChatById(id);
    if (!chat) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    await requireChannelVisibility(auth, chat.channelId);

    return Response.json({ chat }, { status: 200 });
  } catch (error) {
    return error instanceof Response
      ? error
      : Response.json(
          { error: error instanceof Error ? error.message : "Не удалось загрузить чат." },
          { status: 500 }
        );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    const chat = await getChatById(id);
    if (!chat) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    await requireChannelOperate(auth, chat.channelId);
    const deleted = await deleteChatById(id);
    if (!deleted) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    return Response.json({ deletedId: id }, { status: 200 });
  } catch (error) {
    return error instanceof Response
      ? error
      : Response.json(
          { error: error instanceof Error ? error.message : "Не удалось удалить чат." },
          { status: 500 }
        );
  }
}
