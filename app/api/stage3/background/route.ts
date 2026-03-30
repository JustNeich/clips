import { Buffer } from "node:buffer";
import { requireAuth } from "../../../../lib/auth/guards";
import {
  buildStage3BackgroundUrl,
  saveStage3BackgroundAsset
} from "../../../../lib/stage3-background";
import {
  MultipartUploadError,
  parseMultipartSingleFileRequest
} from "../../../../lib/multipart-upload";

export const runtime = "nodejs";

const MAX_BACKGROUND_SIZE_BYTES = 40 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAuth(request);
    const parsedUpload = await parseMultipartSingleFileRequest(request, {
      fileFieldName: "file",
      maxFileBytes: MAX_BACKGROUND_SIZE_BYTES,
      parseErrorMessage: "Не удалось разобрать background upload. Повторите загрузку файла.",
      missingBodyMessage: "Передайте multipart/form-data с полем file."
    });
    const maybeFile = parsedUpload.file;

    if (!maybeFile) {
      return Response.json({ error: "Передайте background файл в поле file." }, { status: 400 });
    }

    if (maybeFile.sizeBytes <= 0) {
      return Response.json({ error: "Файл пустой." }, { status: 400 });
    }
    if (maybeFile.sizeBytes > MAX_BACKGROUND_SIZE_BYTES) {
      return Response.json(
        { error: `Файл слишком большой. Максимум ${Math.round(MAX_BACKGROUND_SIZE_BYTES / (1024 * 1024))} MB.` },
        { status: 400 }
      );
    }

    const mimeType = maybeFile.mimeType.trim().toLowerCase();
    if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
      return Response.json({ error: "Поддерживаются только image/* и video/* файлы." }, { status: 400 });
    }

    const buffer = Buffer.from(maybeFile.bytes);
    const asset = await saveStage3BackgroundAsset({
      buffer,
      mimeType,
      originalName: maybeFile.name
    });
    return Response.json(
      {
        asset: {
          ...asset,
          url: buildStage3BackgroundUrl(asset.id)
        }
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      {
        error:
          error instanceof MultipartUploadError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Не удалось сохранить background."
      },
      { status: error instanceof MultipartUploadError ? 400 : 500 }
    );
  }
}
