import {
  deleteChannelAssetById,
  getChannelAssetById,
  updateChannelById
} from "../../../../../../lib/chat-history";
import {
  deleteChannelAssetFile,
  resolveChannelAssetFile
} from "../../../../../../lib/channel-assets";
import {
  requireAuth,
  requireChannelSetupEdit,
  requireChannelVisibility
} from "../../../../../../lib/auth/guards";
import { createNodeFileResponse } from "../../../../../../lib/node-file-response";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; assetId: string }> };

function sanitizeAttachmentFileName(raw: string): string {
  const value = raw.replace(/[\r\n"]/g, "").replace(/[\\/]/g, "_").trim();
  return value || "channel-asset";
}

function buildAttachmentDisposition(fileNameRaw: string): string {
  const fileName = sanitizeAttachmentFileName(fileNameRaw);
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id, assetId } = await context.params;
  try {
    const auth = await requireAuth(request);
    await requireChannelVisibility(auth, id);

    const asset = await getChannelAssetById(id, assetId);
    if (!asset) {
      return Response.json({ error: "Asset not found." }, { status: 404 });
    }
    const file = await resolveChannelAssetFile({ channelId: id, fileName: asset.fileName });
    if (!file) {
      return Response.json({ error: "Asset file unavailable." }, { status: 404 });
    }
    const isDownload = new URL(request.url).searchParams.get("download") === "1";
    const headers: Record<string, string> = {
      "Content-Type": asset.mimeType,
      "Cache-Control": isDownload ? "private, max-age=0" : "public, max-age=86400, immutable"
    };
    if (isDownload) {
      headers["Content-Disposition"] = buildAttachmentDisposition(asset.originalName || asset.fileName);
    }

    return createNodeFileResponse({
      request,
      filePath: file.filePath,
      signal: request.signal,
      headers
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось прочитать ассет." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { id, assetId } = await context.params;
  try {
    const auth = await requireAuth(_request);
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
      { error: error instanceof Error ? error.message : "Не удалось удалить ассет." },
      { status: 500 }
    );
  }
}
