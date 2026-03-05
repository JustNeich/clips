import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  ChannelAssetKind,
  createChannelAsset,
  getChannelById,
  listChannelAssets,
  updateChannelById
} from "../../../../../lib/chat-history";
import {
  buildChannelAssetUrl,
  saveChannelAssetFile,
  validateChannelAssetMime
} from "../../../../../lib/channel-assets";

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
  const channel = await getChannelById(id);
  if (!channel) {
    return Response.json({ error: "Channel not found." }, { status: 404 });
  }

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
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const channel = await getChannelById(id);
  if (!channel) {
    return Response.json({ error: "Channel not found." }, { status: 404 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const kind = parseKind(String(formData?.get("kind") ?? ""));

  if (!(file instanceof File)) {
    return Response.json({ error: "Передайте файл в поле file." }, { status: 400 });
  }
  if (!kind) {
    return Response.json({ error: "Передайте kind: avatar|background|music." }, { status: 400 });
  }
  if (file.size <= 0) {
    return Response.json({ error: "Файл пустой." }, { status: 400 });
  }

  const maxBytes = maxSizeByKind(kind);
  if (file.size > maxBytes) {
    return Response.json(
      { error: `Файл слишком большой. Максимум ${Math.round(maxBytes / (1024 * 1024))} MB.` },
      { status: 400 }
    );
  }

  const mimeType = file.type?.trim().toLowerCase() ?? "";
  if (!validateChannelAssetMime(kind, mimeType)) {
    return Response.json({ error: "Неподдерживаемый тип файла для выбранного kind." }, { status: 400 });
  }

  try {
    const assetId = randomUUID().replace(/-/g, "");
    const buffer = Buffer.from(await file.arrayBuffer());
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
      sizeBytes: file.size
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
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить ассет." },
      { status: 500 }
    );
  }
}

