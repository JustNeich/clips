import { createOrGetChatByUrl, listChats } from "../../../lib/chat-history";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channelId")?.trim() || undefined;
  const chats = await listChats(channelId);
  return Response.json({ chats }, { status: 200 });
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

  const chat = await createOrGetChatByUrl(url, body?.channelId?.trim());
  return Response.json({ chat }, { status: 200 });
}
