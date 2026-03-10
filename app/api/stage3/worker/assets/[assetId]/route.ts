import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getMembership } from "../../../../../../lib/team-store";
import {
  getChannelAccessForUser,
  getChannelAssetById,
  getChannelById
} from "../../../../../../lib/chat-history";
import { resolveChannelPermissions } from "../../../../../../lib/acl";
import { resolveChannelAssetFile } from "../../../../../../lib/channel-assets";
import { requireStage3WorkerAuth } from "../../../../../../lib/auth/stage3-worker";

export const runtime = "nodejs";

type Context = { params: Promise<{ assetId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { assetId } = await context.params;
    const channelId = new URL(request.url).searchParams.get("channelId")?.trim() ?? "";
    if (!channelId) {
      return Response.json({ error: "Передайте channelId." }, { status: 400 });
    }

    const auth = requireStage3WorkerAuth(request);
    const membership = getMembership(auth.userId, auth.workspaceId);
    if (!membership) {
      return Response.json({ error: "Worker membership not found." }, { status: 403 });
    }

    const channel = await getChannelById(channelId);
    if (!channel || channel.workspaceId !== auth.workspaceId) {
      return Response.json({ error: "Channel not found." }, { status: 404 });
    }

    const explicitAccess = await getChannelAccessForUser(channelId, auth.userId);
    const permissions = resolveChannelPermissions({
      membership,
      channel: { id: channel.id, creatorUserId: channel.creatorUserId },
      explicitAccess
    });
    if (!permissions.isVisible) {
      return Response.json({ error: "Доступ запрещен." }, { status: 403 });
    }

    const asset = await getChannelAssetById(channelId, assetId);
    if (!asset) {
      return Response.json({ error: "Asset not found." }, { status: 404 });
    }

    const file = await resolveChannelAssetFile({
      channelId,
      fileName: asset.fileName
    });
    if (!file) {
      return Response.json({ error: "Asset file unavailable." }, { status: 404 });
    }

    return new Response(Readable.toWeb(createReadStream(file.filePath)) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(file.size),
        "Cache-Control": "private, max-age=300",
        "x-stage3-asset-file-name": asset.fileName
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось прочитать worker asset." },
      { status: 500 }
    );
  }
}
