import {
  deleteChannelAssetById,
  getChannelAssetById,
  updateChannelById
} from "../../../../../../lib/chat-history";
import { deleteChannelAssetFile, readChannelAssetFile } from "../../../../../../lib/channel-assets";
import {
  requireAuth,
  requireChannelSetupEdit,
  requireChannelVisibility
} from "../../../../../../lib/auth/guards";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; assetId: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id, assetId } = await context.params;
  try {
    const auth = await requireAuth();
    await requireChannelVisibility(auth, id);

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
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to read asset." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { id, assetId } = await context.params;
  try {
    const auth = await requireAuth();
    const { channel } = await requireChannelSetupEdit(auth, id);

    const asset = await deleteChannelAssetById(id, assetId);
    if (!asset) {
      return Response.json({ error: "Asset not found." }, { status: 404 });
    }
    await deleteChannelAssetFile({ channelId: id, fileName: asset.fileName });

    await updateChannelById(id, {
      avatarAssetId: channel.avatarAssetId === assetId ? null : channel.avatarAssetId,
      defaultBackgroundAssetId:
        channel.defaultBackgroundAssetId === assetId ? null : channel.defaultBackgroundAssetId,
      defaultMusicAssetId:
        channel.defaultMusicAssetId === assetId ? null : channel.defaultMusicAssetId
    }).catch(() => undefined);

    return Response.json({ deletedId: assetId }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to delete asset." },
      { status: 500 }
    );
  }
}
