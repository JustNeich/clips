import { createOrGetChatByUrl, listChats } from "../../../lib/chat-history";
import { requireAuth, requireChannelOperate, requireChannelVisibility } from "../../../lib/auth/guards";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth();
    const url = new URL(request.url);
    const channelId = url.searchParams.get("channelId")?.trim() || undefined;

    if (channelId) {
      await requireChannelVisibility(auth, channelId);
      const chats = await listChats(channelId, auth.workspace.id);
      return Response.json({ chats }, { status: 200 });
    }

    const chats = await listChats(undefined, auth.workspace.id);
    const visibleChats = [];
    for (const chat of chats) {
      try {
        await requireChannelVisibility(auth, chat.channelId);
        visibleChats.push(chat);
      } catch {
        continue;
      }
    }
    return Response.json({ chats: visibleChats }, { status: 200 });
  } catch (error) {
    return error instanceof Response
      ? error
      : Response.json(
          { error: error instanceof Error ? error.message : "Не удалось загрузить чаты." },
          { status: 500 }
        );
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { url?: string; channelId?: string } | null;
  const url = body?.url?.trim() ?? "";
  if (!url) {
    return Response.json({ error: "Передайте url." }, { status: 400 });
  }

  try {
    // Validate URL format before creating chat.
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    return Response.json({ error: "Некорректный URL." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    const channelId = body?.channelId?.trim();
    if (!channelId) {
      return Response.json({ error: "Передайте channelId." }, { status: 400 });
    }
    await requireChannelOperate(auth, channelId);
    const chat = await createOrGetChatByUrl(url, channelId);
    return Response.json({ chat }, { status: 200 });
  } catch (error) {
    return error instanceof Response
      ? error
      : Response.json(
          { error: error instanceof Error ? error.message : "Не удалось создать чат." },
          { status: 500 }
        );
  }
}
