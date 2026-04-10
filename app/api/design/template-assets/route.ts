import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  MultipartUploadError,
  parseMultipartSingleFileRequest
} from "../../../../lib/multipart-upload";
import {
  buildManagedTemplateAssetUrl,
  saveManagedTemplateBackgroundAsset,
  validateManagedTemplateBackgroundMime
} from "../../../../lib/managed-template-assets";
import { requireAuth } from "../../../../lib/auth/guards";

export const runtime = "nodejs";

const MAX_BACKGROUND_IMAGE_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  let parsedUpload: Awaited<ReturnType<typeof parseMultipartSingleFileRequest>>;
  try {
    parsedUpload = await parseMultipartSingleFileRequest(request, {
      fileFieldName: "file",
      maxFileBytes: MAX_BACKGROUND_IMAGE_BYTES,
      parseErrorMessage: "Не удалось разобрать upload фона. Повторите попытку.",
      missingBodyMessage: "Передайте multipart/form-data с полем file."
    });
  } catch (error) {
    const message =
      error instanceof MultipartUploadError
        ? error.message
        : "Не удалось разобрать upload фона. Повторите попытку.";
    return Response.json({ error: message }, { status: 400 });
  }

  const file = parsedUpload.file;
  if (!file) {
    return Response.json({ error: "Передайте файл в поле file." }, { status: 400 });
  }
  if (file.sizeBytes <= 0) {
    return Response.json({ error: "Файл пустой." }, { status: 400 });
  }

  const mimeType = file.mimeType.trim().toLowerCase();
  if (!validateManagedTemplateBackgroundMime(mimeType)) {
    return Response.json(
      { error: "Поддерживаются JPG, PNG, WebP, GIF, AVIF и SVG." },
      { status: 400 }
    );
  }

  try {
    const auth = await requireAuth(request);
    const assetId = randomUUID().replace(/-/g, "");
    const asset = await saveManagedTemplateBackgroundAsset({
      assetId,
      mimeType,
      buffer: Buffer.from(file.bytes),
      originalName: file.name,
      sizeBytes: file.sizeBytes,
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      creatorDisplayName: auth.user.displayName
    });

    return Response.json(
      {
        asset: {
          id: asset.id,
          kind: asset.kind,
          mimeType: asset.mimeType,
          originalName: asset.originalName,
          sizeBytes: asset.sizeBytes,
          createdAt: asset.createdAt,
          url: buildManagedTemplateAssetUrl(asset.id)
        }
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить фон." },
      { status: 500 }
    );
  }
}
