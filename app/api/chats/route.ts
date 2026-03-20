import { createOrGetChatByUrl, listChatListItems } from "../../../lib/chat-history";
import { requireAuth, requireChannelOperate, requireChannelVisibility } from "../../../lib/auth/guards";
import { normalizeSupportedUrl } from "../../../lib/ytdlp";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth();
    const url = new URL(request.url);
    const channelId = url.searchParams.get("channelId")?.trim() || undefined;

    if (channelId) {
      await requireChannelVisibility(auth, channelId);
      const chats = await listChatListItems(auth.user.id, channelId, auth.workspace.id);
      return Response.json({ chats }, { status: 200 });
    }

    const chats = await listChatListItems(auth.user.id, undefined, auth.workspace.id);
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

  let normalizedUrl = "";
  try {
    normalizedUrl = normalizeSupportedUrl(url);
    void new URL(normalizedUrl);
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
    const chat = await createOrGetChatByUrl(normalizedUrl, channelId);
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
