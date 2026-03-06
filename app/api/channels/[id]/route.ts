import {
  deleteChannelById,
  listChannelAssets,
  updateChannelById
} from "../../../../lib/chat-history";
import { deleteChannelAssetDir } from "../../../../lib/channel-assets";
import {
  requireAuth,
  requireChannelSetupEdit,
  requireChannelVisibility
} from "../../../../lib/auth/guards";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type PatchBody = Partial<{
  name: string;
  username: string;
  systemPrompt: string;
  descriptionPrompt: string;
  examplesJson: string;
  templateId: string;
  avatarAssetId: string | null;
  defaultBackgroundAssetId: string | null;
  defaultMusicAssetId: string | null;
}>;

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    const { channel, permissions } = await requireChannelVisibility(auth, id);
    const assets = await listChannelAssets(id);
    return Response.json(
      {
        channel: {
          ...channel,
          currentUserCanOperate: permissions.canOperate,
          currentUserCanEditSetup: permissions.canEditSetup,
          currentUserCanManageAccess: permissions.canManageAccess,
          isVisibleToCurrentUser: permissions.isVisible
        },
        assets: {
          avatar: assets.filter((asset) => asset.kind === "avatar"),
          backgrounds: assets.filter((asset) => asset.kind === "background"),
          music: assets.filter((asset) => asset.kind === "music")
        }
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load channel." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    await requireChannelSetupEdit(auth, id);
    const channel = await updateChannelById(id, body);
    return Response.json({ channel }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update channel." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    const { permissions } = await requireChannelVisibility(auth, id);
    if (!permissions.canDelete) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const result = await deleteChannelById(id);
    if (!result.deleted) {
      return Response.json({ error: "Channel not found." }, { status: 404 });
    }
    await deleteChannelAssetDir(id);
    return Response.json({ deletedId: id }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete channel." },
      { status: 400 }
    );
  }
}
