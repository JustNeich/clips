import path from "node:path";
import { createOrGetChatBySource } from "../../../../lib/chat-history";
import { requireAuth, requireChannelOperate } from "../../../../lib/auth/guards";
import { getRuntimeCapabilities } from "../../../../lib/runtime-capabilities";
import { enqueueAndScheduleSourceJob } from "../../../../lib/source-job-runtime";
import type { SourceJobDetail, SourceJobResult } from "../../../components/types";
import { getWorkspaceCodexIntegration } from "../../../../lib/team-store";
import { newId } from "../../../../lib/db/client";
import { buildUploadedSourceUrl } from "../../../../lib/uploaded-source";
import { storeUploadedSourceMedia } from "../../../../lib/source-media-cache";

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
  const value = request.headers.get("X-Auto-Run-Stage2")?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
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

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth(request);
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

    const fileName = path.basename(decodeHeaderFileName(fileNameHeader)).replace(/["\r\n]/g, "_");
    if (!fileName.toLowerCase().endsWith(".mp4")) {
      return Response.json({ error: "Загружать можно только готовый mp4 файл." }, { status: 400 });
    }

    const contentType = (request.headers.get("Content-Type")?.trim().toLowerCase() ?? "").split(";")[0] ?? "";
    if (contentType && contentType !== "video/mp4" && contentType !== "application/octet-stream") {
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

    const chat = await createOrGetChatBySource({
      rawUrl: sourceUrl,
      channelIdRaw: channelId,
      title: path.parse(fileName).name,
      eventText: `Видео загружено: ${fileName}`
    });

    const capabilities = await getRuntimeCapabilities();
    const autoRunStage2Requested = normalizeAutoRunHeader(request);
    const integration = getWorkspaceCodexIntegration(auth.workspace.id);
    const autoRunStage2 =
      autoRunStage2Requested &&
      Boolean(integration?.status === "connected" && integration.codexHomePath) &&
      capabilities.features.stage2;

    const job = enqueueAndScheduleSourceJob({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      request: {
        sourceUrl,
        autoRunStage2,
        trigger: "fetch",
        chat: {
          id: chat.id,
          channelId: chat.channelId
        },
        channel: {
          id: chat.channelId,
          name: operate.channel.name,
          username: operate.channel.username
        }
      }
    });

    return Response.json({ chat, job: serializeSourceJobDetail(job) }, { status: 202 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
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
