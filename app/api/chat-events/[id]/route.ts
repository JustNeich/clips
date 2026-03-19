import { appendChatEvent, getChatById } from "../../../../lib/chat-history";
import { requireAuth, requireChannelOperate } from "../../../../lib/auth/guards";

export const runtime = "nodejs";

type AppendEventBody = {
  role?: "user" | "assistant" | "system";
  type?: "link" | "download" | "comments" | "stage2" | "error" | "note";
  text?: string;
  data?: unknown;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as AppendEventBody | null;
  const role = body?.role;
  const type = body?.type;
  const text = body?.text?.trim();

  if (!role || !type || !text) {
    return Response.json({ error: "Передайте role, type и text." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    const existingChat = await getChatById(id);
    if (!existingChat) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    await requireChannelOperate(auth, existingChat.channelId);
    const chat = await appendChatEvent(id, {
      role,
      type,
      text,
      data: body?.data
    });
    return Response.json({ chat }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось записать событие." },
      { status: 500 }
    );
  }
}
