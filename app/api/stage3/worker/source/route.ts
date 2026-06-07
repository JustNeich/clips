import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireStage3WorkerAuth } from "../../../../../lib/auth/stage3-worker";
import { createNodeStreamResponse } from "../../../../../lib/node-stream-response";
import { getStage3Job } from "../../../../../lib/stage3-job-store";
import { ensureSourceMediaCached, getCachedSourceMedia } from "../../../../../lib/source-media-cache";
import { isUploadedSourceUrl } from "../../../../../lib/uploaded-source";
import { isSupportedUrl, normalizeSupportedUrl, SUPPORTED_SOURCE_ERROR_MESSAGE } from "../../../../../lib/ytdlp";

export const runtime = "nodejs";

function readJobPayloadSourceUrl(payloadJson: string): string | null {
  try {
    const parsed = JSON.parse(payloadJson) as { sourceUrl?: unknown };
    return typeof parsed.sourceUrl === "string" && parsed.sourceUrl.trim()
      ? normalizeSupportedUrl(parsed.sourceUrl.trim())
      : null;
  } catch {
    return null;
  }
}

function requireLeasedJobSourceAccess(input: {
  workspaceId: string;
  workerId: string;
  jobId: string | null | undefined;
  sourceUrl: string;
}): Response | null {
  const jobId = input.jobId?.trim();
  if (!jobId) {
    return Response.json({ error: "Передайте jobId для source request." }, { status: 400 });
  }
  const job = getStage3Job(jobId);
  if (!job || job.workspaceId !== input.workspaceId) {
    return Response.json({ error: "Stage 3 job not found." }, { status: 404 });
  }
  if (job.assignedWorkerId !== input.workerId || job.status !== "running") {
    return Response.json({ error: "Stage 3 job is not leased by this worker." }, { status: 409 });
  }
  const jobSourceUrl = readJobPayloadSourceUrl(job.payloadJson);
  if (!jobSourceUrl || jobSourceUrl !== input.sourceUrl) {
    return Response.json({ error: "Source URL is not assigned to this worker job." }, { status: 403 });
  }
  return null;
}

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
    const auth = requireStage3WorkerAuth(request);
    const body = (await request.json().catch(() => null)) as { url?: string; cacheOnly?: boolean; jobId?: string } | null;
    const rawUrl = body?.url?.trim();
    const cacheOnly = body?.cacheOnly === true;

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
    const jobAccessError = requireLeasedJobSourceAccess({
      workspaceId: auth.workspaceId,
      workerId: auth.worker.id,
      jobId: body?.jobId,
      sourceUrl
    });
    if (jobAccessError) {
      return jobAccessError;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-worker-source-"));
    let cleanupScheduled = false;

    try {
      const cached = cacheOnly || isUploadedSourceUrl(sourceUrl)
        ? await getCachedSourceMedia(sourceUrl)
        : await ensureSourceMediaCached(sourceUrl);
      if (!cached) {
        return Response.json(
          {
            error: cacheOnly
              ? "Source media ещё не готов в cache."
              : "Загруженный mp4 не найден в локальном хранилище. Загрузите файл заново."
          },
          { status: 404 }
        );
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
