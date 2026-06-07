import { requireAuth, requireChannelOperate } from "../../../lib/auth/guards";
import { findChatsBySourceUrl } from "../../../lib/chat-history";
import { createNodeFileResponse } from "../../../lib/node-file-response";
import { ensureSourceMediaCached, getCachedSourceMedia } from "../../../lib/source-media-cache";
import { isUploadedSourceUrl } from "../../../lib/uploaded-source";
import { normalizeSupportedUrl } from "../../../lib/ytdlp";

export const runtime = "nodejs";

async function requireSourceMediaAccess(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  sourceUrl: string,
  channelId: string | null
): Promise<Response | null> {
  if (channelId) {
    await requireChannelOperate(auth, channelId);
    return null;
  }

  const chats = await findChatsBySourceUrl({
    workspaceId: auth.workspace.id,
    sourceUrl
  });
  if (chats.length === 0) {
    return Response.json({ error: "Source media не привязан к доступному чату." }, { status: 404 });
  }

  for (const chat of chats) {
    try {
      await requireChannelOperate(auth, chat.channelId);
      return null;
    } catch (error) {
      if (!(error instanceof Response)) {
        throw error;
      }
    }
  }

  return Response.json({ error: "Доступ запрещен." }, { status: 403 });
}

async function handleSourceMediaRequest(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth(request);
    const url = new URL(request.url);
    const rawSourceUrl = url.searchParams.get("sourceUrl")?.trim();
    const cacheOnly = url.searchParams.get("cacheOnly") === "1";
    const channelId = url.searchParams.get("channelId")?.trim() || null;

    if (!rawSourceUrl) {
      return Response.json({ error: "Передайте sourceUrl." }, { status: 400 });
    }

    const sourceUrl = normalizeSupportedUrl(rawSourceUrl);
    if (!sourceUrl) {
      return Response.json({ error: "Source URL некорректен." }, { status: 400 });
    }
    const accessError = await requireSourceMediaAccess(auth, sourceUrl, channelId);
    if (accessError) {
      return accessError;
    }

    if (!cacheOnly && !isUploadedSourceUrl(sourceUrl)) {
      return Response.json({ error: "Preview доступен только для загруженных mp4." }, { status: 400 });
    }

    const cached = cacheOnly ? await getCachedSourceMedia(sourceUrl) : await ensureSourceMediaCached(sourceUrl);
    if (!cached) {
      return Response.json({ error: "Source media ещё не готов в cache." }, { status: 404 });
    }

    return createNodeFileResponse({
      request,
      filePath: cached.sourcePath,
      signal: request.signal,
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${cached.fileName}"`
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось отдать source media." },
      { status: 503 }
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleSourceMediaRequest(request);
}

export async function HEAD(request: Request): Promise<Response> {
  return handleSourceMediaRequest(request);
}
