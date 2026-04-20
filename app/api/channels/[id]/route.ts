import {
  deleteChannelById,
  listChannelAssets,
  updateChannelById
} from "../../../../lib/chat-history";
import { deleteChannelAssetDir } from "../../../../lib/channel-assets";
import { getChannelPublishIntegration, getChannelPublishSettings } from "../../../../lib/publication-store";
import {
  requireAuth,
  requireChannelSetupEdit,
  requireChannelVisibility
} from "../../../../lib/auth/guards";
import { getRestrictedChannelEditError } from "../../../../lib/channel-edit-permissions";
import { readManagedTemplate } from "../../../../lib/managed-template-store";
import { Stage2PromptConfig } from "../../../../lib/stage2-pipeline";
import { Stage2ExamplesConfig, Stage2HardConstraints } from "../../../../lib/stage2-channel-config";
import { Stage2StyleProfile } from "../../../../lib/stage2-channel-learning";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type PatchBody = Partial<{
  name: string;
  username: string;
  systemPrompt: string;
  descriptionPrompt: string;
  examplesJson: string;
  stage2WorkerProfileId: string | null;
  stage2ExamplesConfig: Stage2ExamplesConfig;
  stage2HardConstraints: Stage2HardConstraints;
  stage2PromptConfig: Stage2PromptConfig;
  stage2StyleProfile: Stage2StyleProfile;
  templateId: string;
  avatarAssetId: string | null;
  defaultBackgroundAssetId: string | null;
  defaultMusicAssetId: string | null;
}>;

async function ensureChannelTemplateSelectable(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  templateId: string | null | undefined
): Promise<string | null> {
  const candidate = templateId?.trim();
  if (!candidate) {
    return null;
  }
  const template = await readManagedTemplate(candidate, { workspaceId: auth.workspace.id });
  return template ? template.id : null;
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth(_request);
    const { channel, permissions } = await requireChannelVisibility(auth, id);
    const assets = await listChannelAssets(id);
    return Response.json(
      {
        channel: {
          ...channel,
          publishSettings: getChannelPublishSettings(channel.id),
          publishIntegration: getChannelPublishIntegration(channel.id),
          currentUserCanOperate: permissions.canOperate,
          currentUserCanEditSetup: permissions.canEditSetup,
          currentUserCanManageAccess: permissions.canManageAccess,
          currentUserCanDelete: permissions.canDelete,
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
      { error: error instanceof Error ? error.message : "Не удалось загрузить канал." },
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
    const auth = await requireAuth(request);
    await requireChannelSetupEdit(auth, id);
    const restrictedError = getRestrictedChannelEditError(auth.membership.role, body);
    if (restrictedError) {
      return Response.json({ error: restrictedError }, { status: 403 });
    }
    if (typeof body.templateId === "string" && !(await ensureChannelTemplateSelectable(auth, body.templateId))) {
      return Response.json({ error: "Template not found." }, { status: 404 });
    }
    const channel = await updateChannelById(id, {
      name: body.name,
      username: body.username,
      systemPrompt: body.systemPrompt,
      descriptionPrompt: body.descriptionPrompt,
      examplesJson: body.examplesJson,
      stage2HardConstraints: body.stage2HardConstraints,
      templateId: body.templateId,
      avatarAssetId: body.avatarAssetId,
      defaultBackgroundAssetId: body.defaultBackgroundAssetId,
      defaultMusicAssetId: body.defaultMusicAssetId
    });
    return Response.json({ channel }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось обновить канал." },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth(_request);
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
      { error: error instanceof Error ? error.message : "Не удалось удалить канал." },
      { status: 400 }
    );
  }
}
