import { createReadStream, promises as fs } from "node:fs";
import { requireAuth } from "../../../lib/auth/guards";
import { createNodeStreamResponse } from "../../../lib/node-stream-response";
import { ensureSourceMediaCached } from "../../../lib/source-media-cache";
import { isSupportedUrl, normalizeSupportedUrl, SUPPORTED_SOURCE_ERROR_MESSAGE } from "../../../lib/ytdlp";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAuth(request);
    const body = (await request.json().catch(() => null)) as { url?: string } | null;
    const rawUrl = body?.url?.trim();

    if (!rawUrl) {
      return Response.json({ error: "Передайте URL в теле запроса." }, { status: 400 });
    }

    const sourceUrl = normalizeSupportedUrl(rawUrl);

    if (!isSupportedUrl(sourceUrl)) {
      return Response.json(
        {
          error: SUPPORTED_SOURCE_ERROR_MESSAGE
        },
        { status: 400 }
      );
    }

    const cached = await ensureSourceMediaCached(sourceUrl);
    const fileStat = await fs.stat(cached.sourcePath);
    const fileName = cached.fileName.toLowerCase().endsWith(".mp4") ? cached.fileName : `${cached.fileName}.mp4`;
    const stream = createReadStream(cached.sourcePath);

    return createNodeStreamResponse({
      stream,
      signal: request.signal,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileStat.size),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Source-Provider": cached.downloadProvider
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось скачать исходное видео." },
      { status: 503 }
    );
  }
}
