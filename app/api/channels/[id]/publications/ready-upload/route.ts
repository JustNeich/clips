import path from "node:path";
import { requireAuth, requireChannelOperate } from "../../../../../../lib/auth/guards";
import { isChannelPublishIntegrationReady } from "../../../../../../lib/channel-publish-state";
import { getChannelPublishIntegration } from "../../../../../../lib/publication-store";
import { createReadyVideoPublication } from "../../../../../../lib/ready-video-publication";
import { MultipartUploadError, parseMultipartSingleFileRequest } from "../../../../../../lib/multipart-upload";
import { newId } from "../../../../../../lib/db/client";
import { buildUploadedSourceUrl } from "../../../../../../lib/uploaded-source";
import { storeUploadedSourceMedia } from "../../../../../../lib/source-media-cache";

export const runtime = "nodejs";

const MAX_READY_UPLOAD_BYTES = 512 * 1024 * 1024;

type Context = { params: Promise<{ id: string }> };

function sanitizeUploadedFileName(fileName: string): string {
  return path.basename(fileName).replace(/["\r\n]/g, "_");
}

function isAcceptedUploadedVideoMime(mimeType: string | null | undefined): boolean {
  const normalized = mimeType?.trim().toLowerCase();
  return normalized === "video/mp4" || normalized === "application/mp4";
}

function looksLikeMp4(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) {
    return false;
  }
  const signature = new TextDecoder("ascii").decode(bytes.slice(4, 8));
  return signature === "ftyp";
}

function createReadableStreamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id: channelId } = await context.params;
    const auth = await requireAuth(request);
    await requireChannelOperate(auth, channelId);
    if (!isChannelPublishIntegrationReady(getChannelPublishIntegration(channelId))) {
      return Response.json(
        { error: "Подключите YouTube и выберите канал назначения перед загрузкой готового mp4." },
        { status: 400 }
      );
    }

    const parsed = await parseMultipartSingleFileRequest(request, {
      fileFieldName: "file",
      maxFileBytes: MAX_READY_UPLOAD_BYTES,
      fileTooLargeMessage: `Файл слишком большой. Максимум ${Math.round(
        MAX_READY_UPLOAD_BYTES / (1024 * 1024)
      )} MB.`,
      parseErrorMessage: "Не удалось разобрать upload готового mp4. Повторите загрузку.",
      missingBodyMessage: "Передайте multipart/form-data с полем file."
    });
    const file = parsed.file;
    if (!file) {
      return Response.json({ error: "Передайте готовый mp4." }, { status: 400 });
    }
    if (
      !file.name.toLowerCase().endsWith(".mp4") ||
      !isAcceptedUploadedVideoMime(file.mimeType) ||
      !looksLikeMp4(file.bytes)
    ) {
      return Response.json({ error: "Загружать можно только готовые mp4 файлы." }, { status: 400 });
    }

    const fileName = sanitizeUploadedFileName(file.name);
    const title = parsed.fields.title?.trim() || path.parse(fileName).name || "Готовый ролик";
    const sourceUrl = buildUploadedSourceUrl(newId(), fileName);
    const cached = await storeUploadedSourceMedia({
      sourceUrl,
      fileName,
      title,
      sourceStream: createReadableStreamFromBytes(file.bytes),
      maxBytes: MAX_READY_UPLOAD_BYTES,
      requireMp4Signature: true
    });
    const result = await createReadyVideoPublication({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      channelId,
      sourceUrl,
      title,
      fileName,
      sourcePath: cached.sourcePath
    });

    return Response.json(
      {
        chat: result.chat,
        renderExport: {
          id: result.renderExport.id,
          fileName: result.renderExport.artifactFileName
        },
        publication: result.publication
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof MultipartUploadError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Не удалось поставить готовый mp4 в очередь YouTube.";
    if (message === "Файл слишком большой.") {
      return Response.json(
        { error: `Файл слишком большой. Максимум ${Math.round(MAX_READY_UPLOAD_BYTES / (1024 * 1024))} MB.` },
        { status: 413 }
      );
    }
    if (message === "Файл пустой.") {
      return Response.json({ error: "Загруженный файл пустой." }, { status: 400 });
    }
    if (message === "Загружать можно только готовый mp4 файл.") {
      return Response.json({ error: "Загружать можно только готовые mp4 файлы." }, { status: 400 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
