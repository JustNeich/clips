import { deleteChatById, getChatById } from "../../../../lib/chat-history";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const chat = await getChatById(id);
  if (!chat) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  return Response.json({ chat }, { status: 200 });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const deleted = await deleteChatById(id);
  if (!deleted) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }
  return Response.json({ deletedId: id }, { status: 200 });
}
