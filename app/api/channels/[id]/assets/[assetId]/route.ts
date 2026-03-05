import {
  deleteChannelAssetById,
  getChannelAssetById,
  getChannelById,
  updateChannelById
} from "../../../../../../lib/chat-history";
import { deleteChannelAssetFile, readChannelAssetFile } from "../../../../../../lib/channel-assets";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; assetId: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id, assetId } = await context.params;
  const channel = await getChannelById(id);
  if (!channel) {
    return Response.json({ error: "Channel not found." }, { status: 404 });
  }

  const asset = await getChannelAssetById(id, assetId);
  if (!asset) {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }
  const file = await readChannelAssetFile({ channelId: id, fileName: asset.fileName });
  if (!file) {
    return Response.json({ error: "Asset file unavailable." }, { status: 404 });
  }

  return new Response(file.buffer, {
    status: 200,
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "public, max-age=86400, immutable"
    }
  });
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { id, assetId } = await context.params;
  const channel = await getChannelById(id);
  if (!channel) {
    return Response.json({ error: "Channel not found." }, { status: 404 });
  }

  const asset = await deleteChannelAssetById(id, assetId);
  if (!asset) {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }
  await deleteChannelAssetFile({ channelId: id, fileName: asset.fileName });

  // Keep defaults clean.
  await updateChannelById(id, {
    avatarAssetId: channel.avatarAssetId === assetId ? null : channel.avatarAssetId,
    defaultBackgroundAssetId:
      channel.defaultBackgroundAssetId === assetId ? null : channel.defaultBackgroundAssetId,
    defaultMusicAssetId: channel.defaultMusicAssetId === assetId ? null : channel.defaultMusicAssetId
  }).catch(() => undefined);

  return Response.json({ deletedId: assetId }, { status: 200 });
}

