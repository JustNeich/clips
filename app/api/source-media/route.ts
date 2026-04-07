import { createReadStream, promises as fs } from "node:fs";
import { requireAuth } from "../../../lib/auth/guards";
import { createNodeStreamResponse } from "../../../lib/node-stream-response";
import { ensureSourceMediaCached } from "../../../lib/source-media-cache";
import { isUploadedSourceUrl } from "../../../lib/uploaded-source";
import { normalizeSupportedUrl } from "../../../lib/ytdlp";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAuth(request);
    const url = new URL(request.url);
    const rawSourceUrl = url.searchParams.get("sourceUrl")?.trim();

    if (!rawSourceUrl) {
      return Response.json({ error: "Передайте sourceUrl." }, { status: 400 });
    }

    const sourceUrl = normalizeSupportedUrl(rawSourceUrl);
    if (!isUploadedSourceUrl(sourceUrl)) {
      return Response.json({ error: "Preview доступен только для загруженных mp4." }, { status: 400 });
    }

    const cached = await ensureSourceMediaCached(sourceUrl);
    const stat = await fs.stat(cached.sourcePath);
    const stream = createReadStream(cached.sourcePath);

    return createNodeStreamResponse({
      stream,
      signal: request.signal,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(stat.size),
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
