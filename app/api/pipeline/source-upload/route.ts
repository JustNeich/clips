import path from "node:path";
import { createOrGetChatBySource } from "../../../../lib/chat-history";
import { requireAuth, requireChannelOperate } from "../../../../lib/auth/guards";
import { getRuntimeCapabilities } from "../../../../lib/runtime-capabilities";
import { enqueueAndScheduleSourceJob } from "../../../../lib/source-job-runtime";
import type { SourceJobDetail, SourceJobResult } from "../../../components/types";
import { getWorkspaceCodexIntegration } from "../../../../lib/team-store";
import { newId } from "../../../../lib/db/client";
import { MultipartUploadError, parseMultipartFilesRequest } from "../../../../lib/multipart-upload";
import { buildUploadedSourceUrl } from "../../../../lib/uploaded-source";
import {
  storeUploadedCompositeSourceMedia,
  storeUploadedSourceMedia
} from "../../../../lib/source-media-cache";

export const runtime = "nodejs";

const MAX_UPLOADED_SOURCE_BYTES = 512 * 1024 * 1024;

function readRequiredHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim();
  return value ? value : null;
}

function decodeHeaderFileName(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeAutoRunHeader(request: Request): boolean {
  return normalizeAutoRunValue(request.headers.get("X-Auto-Run-Stage2") ?? undefined);
}

function normalizeAutoRunValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function sanitizeUploadedFileName(fileName: string): string {
  return path.basename(fileName).replace(/["\r\n]/g, "_");
}

function isAcceptedUploadedVideoMime(mimeType: string | null | undefined): boolean {
  const normalized = mimeType?.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "application/octet-stream" ||
    normalized.includes("mp4")
  );
}

function buildCompositeUploadFileName(fileNames: string[]): string {
  const labels = fileNames
    .map((name) => path.parse(name).name)
    .filter(Boolean);
  const base = labels.length > 0 ? labels.join(" + ") : `composite-${fileNames.length}`;
  return `${base.slice(0, 100).replace(/["\r\n]/g, "_")}.mp4`;
}

function normalizeMultipartAutoRunField(fields: Record<string, string>): boolean {
  return normalizeAutoRunValue(fields.autoRunStage2 ?? fields.auto_run_stage2);
}

function createReadableStreamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

function serializeSourceJobDetail(job: {
  jobId: string;
  chatId: string;
  channelId: string;
  sourceUrl: string;
  status: SourceJobDetail["status"];
  progress: SourceJobDetail["progress"];
  errorMessage: string | null;
  resultData: SourceJobResult | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
}): SourceJobDetail {
  return {
    jobId: job.jobId,
    chatId: job.chatId,
    channelId: job.channelId,
    sourceUrl: job.sourceUrl,
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage ?? job.progress.error ?? null,
    hasResult: Boolean(job.resultData),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    result: job.resultData
  };
}

async function enqueueUploadedSourceJob(input: {
  auth: Awaited<ReturnType<typeof requireAuth>>;
  operate: Awaited<ReturnType<typeof requireChannelOperate>>;
  channelId: string;
  sourceUrl: string;
  title: string;
  eventText: string;
  autoRunStage2Requested: boolean;
}): Promise<Response> {
  const chat = await createOrGetChatBySource({
    rawUrl: input.sourceUrl,
    channelIdRaw: input.channelId,
    title: input.title,
    eventText: input.eventText
  });

  const capabilities = await getRuntimeCapabilities();
  const integration = getWorkspaceCodexIntegration(input.auth.workspace.id);
  const autoRunStage2 =
    input.autoRunStage2Requested &&
    Boolean(integration?.status === "connected" && integration.codexHomePath) &&
    capabilities.features.stage2;

  const job = enqueueAndScheduleSourceJob({
    workspaceId: input.auth.workspace.id,
    creatorUserId: input.auth.user.id,
    request: {
      sourceUrl: input.sourceUrl,
      autoRunStage2,
      trigger: "fetch",
      chat: {
        id: chat.id,
        channelId: chat.channelId
      },
      channel: {
        id: chat.channelId,
        name: input.operate.channel.name,
        username: input.operate.channel.username
      }
    }
  });

  return Response.json({ chat, job: serializeSourceJobDetail(job) }, { status: 202 });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth(request);
    const rawContentType = request.headers.get("Content-Type")?.trim().toLowerCase() ?? "";
    const contentType = rawContentType.split(";")[0] ?? "";
    if (rawContentType.includes("multipart/form-data")) {
      const parsed = await parseMultipartFilesRequest(request, {
        fileFieldName: "files",
        maxTotalFileBytes: MAX_UPLOADED_SOURCE_BYTES,
        fileTooLargeMessage: `Файл слишком большой. Максимум ${Math.round(
          MAX_UPLOADED_SOURCE_BYTES / (1024 * 1024)
        )} MB.`,
        totalFilesTooLargeMessage: `Суммарный размер файлов слишком большой. Максимум ${Math.round(
          MAX_UPLOADED_SOURCE_BYTES / (1024 * 1024)
        )} MB.`,
        parseErrorMessage: "Не удалось разобрать batch upload mp4. Повторите загрузку.",
        missingBodyMessage: "Передайте multipart/form-data с полями channelId и files."
      });
      const channelId = parsed.fields.channelId?.trim();
      if (!channelId) {
        return Response.json({ error: "Передайте channelId." }, { status: 400 });
      }
      if (parsed.files.length < 1) {
        return Response.json({ error: "Передайте минимум 1 mp4." }, { status: 400 });
      }

      const invalidFile = parsed.files.find(
        (file) =>
          !file.name.toLowerCase().endsWith(".mp4") ||
          !isAcceptedUploadedVideoMime(file.mimeType)
      );
      if (invalidFile) {
        return Response.json({ error: "Загружать можно только готовые mp4 файлы." }, { status: 400 });
      }

      const operate = await requireChannelOperate(auth, channelId);
      if (parsed.files.length === 1) {
        const singleFile = parsed.files[0]!;
        const fileName = sanitizeUploadedFileName(singleFile.name);
        const title = path.parse(fileName).name;
        const sourceUrl = buildUploadedSourceUrl(newId(), fileName);
        await storeUploadedSourceMedia({
          sourceUrl,
          fileName,
          title,
          sourceStream: createReadableStreamFromBytes(singleFile.bytes),
          maxBytes: MAX_UPLOADED_SOURCE_BYTES
        });

        return enqueueUploadedSourceJob({
          auth,
          operate,
          channelId,
          sourceUrl,
          title,
          eventText: `Видео загружено: ${fileName}`,
          autoRunStage2Requested: normalizeMultipartAutoRunField(parsed.fields)
        });
      }

      const fileName = buildCompositeUploadFileName(parsed.files.map((file) => file.name));
      const sourceUrl = buildUploadedSourceUrl(newId(), fileName);
      await storeUploadedCompositeSourceMedia({
        sourceUrl,
        fileName,
        title: path.parse(fileName).name,
        parts: parsed.files.map((file) => ({
          fileName: file.name,
          bytes: file.bytes
        })),
        maxBytes: MAX_UPLOADED_SOURCE_BYTES
      });

      return enqueueUploadedSourceJob({
        auth,
        operate,
        channelId,
        sourceUrl,
        title: path.parse(fileName).name,
        eventText: `Видео собрано из ${parsed.files.length} mp4: ${path.parse(fileName).name}`,
        autoRunStage2Requested: normalizeMultipartAutoRunField(parsed.fields)
      });
    }

    const channelId = readRequiredHeader(request, "X-Channel-Id");
    const fileNameHeader = readRequiredHeader(request, "X-File-Name");

    if (!channelId) {
      return Response.json({ error: "Передайте X-Channel-Id." }, { status: 400 });
    }
    if (!fileNameHeader) {
      return Response.json({ error: "Передайте X-File-Name." }, { status: 400 });
    }
    if (!request.body) {
      return Response.json({ error: "Тело запроса пустое." }, { status: 400 });
    }

    const fileName = sanitizeUploadedFileName(decodeHeaderFileName(fileNameHeader));
    if (!fileName.toLowerCase().endsWith(".mp4")) {
      return Response.json({ error: "Загружать можно только готовый mp4 файл." }, { status: 400 });
    }

    if (!isAcceptedUploadedVideoMime(contentType)) {
      return Response.json({ error: "Загрузите mp4 с Content-Type video/mp4." }, { status: 400 });
    }

    const operate = await requireChannelOperate(auth, channelId);
    const uploadId = newId();
    const sourceUrl = buildUploadedSourceUrl(uploadId, fileName);

    await storeUploadedSourceMedia({
      sourceUrl,
      fileName,
      title: path.parse(fileName).name,
      sourceStream: request.body,
      maxBytes: MAX_UPLOADED_SOURCE_BYTES
    });

    return enqueueUploadedSourceJob({
      auth,
      operate,
      channelId,
      sourceUrl,
      title: path.parse(fileName).name,
      eventText: `Видео загружено: ${fileName}`,
      autoRunStage2Requested: normalizeAutoRunHeader(request)
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof MultipartUploadError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Не удалось загрузить mp4.";
    if (message === "Файл слишком большой.") {
      return Response.json(
        { error: `Файл слишком большой. Максимум ${Math.round(MAX_UPLOADED_SOURCE_BYTES / (1024 * 1024))} MB.` },
        { status: 413 }
      );
    }
    if (message === "Файл пустой.") {
      return Response.json({ error: "Загруженный файл пустой." }, { status: 400 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
