import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireStage3WorkerAuth } from "../../../../../lib/auth/stage3-worker";
import { createNodeStreamResponse } from "../../../../../lib/node-stream-response";
import { ensureSourceMediaCached, getCachedSourceMedia } from "../../../../../lib/source-media-cache";
import { isUploadedSourceUrl } from "../../../../../lib/uploaded-source";
import { isSupportedUrl, normalizeSupportedUrl, SUPPORTED_SOURCE_ERROR_MESSAGE } from "../../../../../lib/ytdlp";

export const runtime = "nodejs";

function encodeStage3SourceFileNameHeader(fileName: string): string {
  return encodeURIComponent(fileName);
}

function scheduleDirectoryCleanup(dirPath: string): void {
  const timer = setTimeout(() => {
    void fs.rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
  }, 120_000);
  timer.unref?.();
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireStage3WorkerAuth(request);
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

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-worker-source-"));
    let cleanupScheduled = false;

    try {
      const cached = isUploadedSourceUrl(sourceUrl)
        ? await getCachedSourceMedia(sourceUrl)
        : await ensureSourceMediaCached(sourceUrl);
      if (!cached) {
        throw new Error("Загруженный mp4 не найден в локальном хранилище. Загрузите файл заново.");
      }
      const fileStat = await fs.stat(cached.sourcePath);
      const stream = createReadStream(cached.sourcePath);

      scheduleDirectoryCleanup(tmpDir);
      cleanupScheduled = true;

      return createNodeStreamResponse({
        stream,
        signal: request.signal,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(fileStat.size),
          "Cache-Control": "private, no-store",
          "x-stage3-source-file-name": encodeStage3SourceFileNameHeader(cached.fileName),
          "x-stage3-source-provider": cached.downloadProvider
        }
      });
    } finally {
      if (!cleanupScheduled) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось скачать source для Stage 3 worker." },
      { status: 503 }
    );
  }
}
