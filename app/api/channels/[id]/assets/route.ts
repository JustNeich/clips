import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  ChannelAssetKind,
  createChannelAsset,
  listChannelAssets,
  updateChannelById
} from "../../../../../lib/chat-history";
import {
  buildChannelAssetUrl,
  saveChannelAssetFile,
  validateChannelAssetMime
} from "../../../../../lib/channel-assets";
import {
  MultipartUploadError,
  parseMultipartSingleFileRequest
} from "../../../../../lib/multipart-upload";
import {
  requireAuth,
  requireChannelSetupEdit,
  requireChannelVisibility
} from "../../../../../lib/auth/guards";

export const runtime = "nodejs";

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const MAX_BACKGROUND_BYTES = 50 * 1024 * 1024;
const MAX_MUSIC_BYTES = 80 * 1024 * 1024;

type Context = { params: Promise<{ id: string }> };

function parseKind(raw: string | null): ChannelAssetKind | null {
  if (raw === "avatar" || raw === "background" || raw === "music") {
    return raw;
  }
  return null;
}

function maxSizeByKind(kind: ChannelAssetKind): number {
  if (kind === "avatar") {
    return MAX_AVATAR_BYTES;
  }
  if (kind === "background") {
    return MAX_BACKGROUND_BYTES;
  }
  return MAX_MUSIC_BYTES;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    await requireChannelVisibility(auth, id);

    const url = new URL(request.url);
    const kind = parseKind(url.searchParams.get("kind"));
    const assets = await listChannelAssets(id, kind ?? undefined);

    return Response.json(
      {
        assets: assets.map((asset) => ({
          ...asset,
          url: buildChannelAssetUrl(asset.channelId, asset.id)
        }))
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить ассеты канала." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  let parsedUpload: Awaited<ReturnType<typeof parseMultipartSingleFileRequest>>;
  try {
    parsedUpload = await parseMultipartSingleFileRequest(request, {
      fileFieldName: "file",
      maxFileBytes: MAX_MUSIC_BYTES,
      parseErrorMessage: "Не удалось разобрать upload ассета. Повторите загрузку файла.",
      missingBodyMessage: "Передайте multipart/form-data с полями file и kind."
    });
  } catch (error) {
    const message =
      error instanceof MultipartUploadError
        ? error.message
        : "Не удалось разобрать upload ассета. Повторите загрузку файла.";
    return Response.json({ error: message }, { status: 400 });
  }

  const file = parsedUpload.file;
  const kind = parseKind(parsedUpload.fields.kind ?? null);

  if (!file) {
    return Response.json({ error: "Передайте файл в поле file." }, { status: 400 });
  }
  if (!kind) {
    return Response.json({ error: "Передайте kind: avatar|background|music." }, { status: 400 });
  }
  if (file.sizeBytes <= 0) {
    return Response.json({ error: "Файл пустой." }, { status: 400 });
  }

  const maxBytes = maxSizeByKind(kind);
  if (file.sizeBytes > maxBytes) {
    return Response.json(
      { error: `Файл слишком большой. Максимум ${Math.round(maxBytes / (1024 * 1024))} MB.` },
      { status: 400 }
    );
  }

  const mimeType = file.mimeType.trim().toLowerCase();
  if (!validateChannelAssetMime(kind, mimeType)) {
    return Response.json({ error: "Неподдерживаемый тип файла для выбранного kind." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    await requireChannelSetupEdit(auth, id);
    const assetId = randomUUID().replace(/-/g, "");
    const buffer = Buffer.from(file.bytes);
    const saved = await saveChannelAssetFile({
      channelId: id,
      assetId,
      mimeType,
      buffer
    });

    const asset = await createChannelAsset({
      channelId: id,
      kind,
      assetId,
      fileName: saved.fileName,
      originalName: file.name || `${kind}-asset`,
      mimeType,
      sizeBytes: file.sizeBytes
    });

    if (kind === "avatar") {
      await updateChannelById(id, { avatarAssetId: asset.id });
    }

    return Response.json(
      {
        asset: {
          ...asset,
          url: buildChannelAssetUrl(asset.channelId, asset.id)
        }
      },
      { status: 200 }
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
