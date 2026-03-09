import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { downloadSourceMedia } from "../../../lib/source-acquisition";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../lib/ytdlp";

export const runtime = "nodejs";

function scheduleDirectoryCleanup(dirPath: string): void {
  const timer = setTimeout(() => {
    void fs.rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
  }, 120_000);
  timer.unref?.();
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  const rawUrl = body?.url?.trim();

  if (!rawUrl) {
    return Response.json({ error: "Передайте URL в теле запроса." }, { status: 400 });
  }

  const sourceUrl = normalizeSupportedUrl(rawUrl);

  if (!isSupportedUrl(sourceUrl)) {
    return Response.json(
      {
        error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels."
      },
      { status: 400 }
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-dl-"));
  let cleanupScheduled = false;

  try {
    const downloaded = await downloadSourceMedia(sourceUrl, tmpDir);
    const fileStat = await fs.stat(downloaded.filePath);
    const fileName = `${downloaded.fileName}.mp4`;
    const stream = createReadStream(downloaded.filePath);

    scheduleDirectoryCleanup(tmpDir);
    cleanupScheduled = true;

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileStat.size),
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
    if (!cleanupScheduled) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
