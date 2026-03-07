import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadSourceMedia } from "../../../lib/source-acquisition";
import { isSupportedUrl } from "../../../lib/ytdlp";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  const rawUrl = body?.url?.trim();

  if (!rawUrl) {
    return Response.json({ error: "Передайте URL в теле запроса." }, { status: 400 });
  }

  if (!isSupportedUrl(rawUrl)) {
    return Response.json(
      {
        error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels."
      },
      { status: 400 }
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-dl-"));

  try {
    const downloaded = await downloadSourceMedia(rawUrl, tmpDir);
    const fileBuffer = await fs.readFile(downloaded.filePath);
    const fileName = `${downloaded.fileName}.mp4`;

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Source-Provider": downloaded.provider
      }
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось скачать исходное видео." },
      { status: 503 }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
