import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  MultipartUploadError,
  parseMultipartSingleFileRequest
} from "../../../../lib/multipart-upload";
import {
  buildManagedTemplateAssetUrl,
  saveManagedTemplateBackgroundAsset,
  saveManagedTemplateFontAsset,
  validateManagedTemplateBackgroundMime,
  validateManagedTemplateFontUpload
} from "../../../../lib/managed-template-assets";
import { requireAuth } from "../../../../lib/auth/guards";

export const runtime = "nodejs";

const MAX_BACKGROUND_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_FONT_BYTES = 12 * 1024 * 1024;

type TemplateAssetUploadKind = "background" | "font";

function resolveUploadKind(raw: string | undefined): TemplateAssetUploadKind | null {
  if (!raw?.trim()) {
    return "background";
  }
  const value = raw.trim().toLowerCase();
  return value === "background" || value === "font" ? value : null;
}

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

  const uploadKind = resolveUploadKind(parsedUpload.fields.kind);
  if (!uploadKind) {
    return Response.json({ error: "Неизвестный тип ассета." }, { status: 400 });
  }

  const mimeType = file.mimeType.trim().toLowerCase();
  if (uploadKind === "background") {
    if (!validateManagedTemplateBackgroundMime(mimeType)) {
      return Response.json(
        { error: "Поддерживаются JPG, PNG, WebP, GIF, AVIF и SVG." },
        { status: 400 }
      );
    }
  } else {
    if (file.sizeBytes > MAX_FONT_BYTES) {
      return Response.json({ error: "Шрифт слишком большой. Максимум 12 MB." }, { status: 400 });
    }
    if (!validateManagedTemplateFontUpload({ mimeType, originalName: file.name })) {
      return Response.json(
        { error: "Поддерживаются только TTF, OTF, WOFF и WOFF2." },
        { status: 400 }
      );
    }
  }

  try {
    const auth = await requireAuth(request);
    const assetId = randomUUID().replace(/-/g, "");
    const asset =
      uploadKind === "font"
        ? await saveManagedTemplateFontAsset({
            assetId,
            mimeType,
            buffer: Buffer.from(file.bytes),
            originalName: file.name,
            sizeBytes: file.sizeBytes,
            workspaceId: auth.workspace.id,
            creatorUserId: auth.user.id,
            creatorDisplayName: auth.user.displayName
          })
        : await saveManagedTemplateBackgroundAsset({
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
          fontFamily: asset.fontFamily,
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
      { error: error instanceof Error ? error.message : "Не удалось загрузить ассет." },
      { status: 500 }
    );
  }
}
