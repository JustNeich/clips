import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireStage3WorkerAuth } from "../../../../../lib/auth/stage3-worker";
import { createNodeStreamResponse } from "../../../../../lib/node-stream-response";
import { getStage3Job } from "../../../../../lib/stage3-job-store";
import { ensureSourceMediaCached, getCachedSourceMedia } from "../../../../../lib/source-media-cache";
import { isUploadedSourceUrl } from "../../../../../lib/uploaded-source";
import { isSupportedUrl, normalizeSupportedUrl, SUPPORTED_SOURCE_ERROR_MESSAGE } from "../../../../../lib/ytdlp";
import {
  assertStage3CompletedSourceFile,
  stage3SourceBindingsEqual,
  type Stage3CompletedSourceBinding
} from "../../../../../lib/stage3-source-binding";

export const runtime = "nodejs";

function readJobPayloadSourceRequest(payloadJson: string): {
  sourceUrl: string | null;
  sourceBinding: Stage3CompletedSourceBinding | null;
} {
  try {
    const parsed = JSON.parse(payloadJson) as {
      sourceUrl?: unknown;
      sourceBinding?: Stage3CompletedSourceBinding;
    };
    return {
      sourceUrl:
        typeof parsed.sourceUrl === "string" && parsed.sourceUrl.trim()
          ? normalizeSupportedUrl(parsed.sourceUrl.trim())
          : null,
      sourceBinding:
        parsed.sourceBinding?.kind === "completed-source-job"
          ? parsed.sourceBinding
          : null
    };
  } catch {
    return { sourceUrl: null, sourceBinding: null };
  }
}

function requireLeasedJobSourceAccess(input: {
  workspaceId: string;
  workerId: string;
  jobId: string | null | undefined;
  sourceUrl: string;
  sourceBinding: Stage3CompletedSourceBinding | null;
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
  const jobSource = readJobPayloadSourceRequest(job.payloadJson);
  if (!jobSource.sourceUrl || jobSource.sourceUrl !== input.sourceUrl) {
    return Response.json({ error: "Source URL is not assigned to this worker job." }, { status: 403 });
  }
  if (!stage3SourceBindingsEqual(jobSource.sourceBinding, input.sourceBinding)) {
    return Response.json({ error: "Completed source binding is not assigned to this worker job." }, { status: 403 });
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
    const body = (await request.json().catch(() => null)) as {
      url?: string;
      cacheOnly?: boolean;
      jobId?: string;
      sourceBinding?: Stage3CompletedSourceBinding;
    } | null;
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
    const sourceBinding =
      body?.sourceBinding?.kind === "completed-source-job"
        ? body.sourceBinding
        : null;
    const jobAccessError = requireLeasedJobSourceAccess({
      workspaceId: auth.workspaceId,
      workerId: auth.worker.id,
      jobId: body?.jobId,
      sourceUrl,
      sourceBinding
    });
    if (jobAccessError) {
      return jobAccessError;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-worker-source-"));
    let cleanupScheduled = false;

    try {
      const cached = sourceBinding
        ? await getCachedSourceMedia(sourceUrl)
        : cacheOnly || isUploadedSourceUrl(sourceUrl)
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
      if (sourceBinding) {
        if (cached.sourceKey !== sourceBinding.sourceCacheKey) {
          return Response.json(
            { error: "Bound completed source cache key does not match the host artifact." },
            { status: 409 }
          );
        }
        await assertStage3CompletedSourceFile(cached.sourcePath, sourceBinding);
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
