import { requireAuth } from "../../../lib/auth/guards";
import { createNodeFileResponse } from "../../../lib/node-file-response";
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
