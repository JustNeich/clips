import {
  createChannel,
  getChannelAccessForUser,
  listChannelsWithStats
} from "../../../lib/chat-history";
import { requireAuth } from "../../../lib/auth/guards";
import { resolveChannelPermissions } from "../../../lib/acl";
import { getRestrictedChannelEditError } from "../../../lib/channel-edit-permissions";
import { Stage2PromptConfig } from "../../../lib/stage2-pipeline";
import { Stage2ExamplesConfig, Stage2HardConstraints } from "../../../lib/stage2-channel-config";
import {
  getWorkspaceStage2ExamplesCorpusJson,
  getWorkspaceStage2HardConstraints
} from "../../../lib/team-store";

export const runtime = "nodejs";

type CreateChannelBody = {
  name?: string;
  username?: string;
  systemPrompt?: string;
  descriptionPrompt?: string;
  examplesJson?: string;
  stage2WorkerProfileId?: string | null;
  stage2ExamplesConfig?: Stage2ExamplesConfig;
  stage2HardConstraints?: Stage2HardConstraints;
  stage2PromptConfig?: Stage2PromptConfig;
  templateId?: string;
};

export async function GET(): Promise<Response> {
  try {
    const auth = await requireAuth();
    const channels = await listChannelsWithStats(auth.workspace.id);
    const visibleChannels = await Promise.all(
      channels.map(async (channel) => {
        const explicitAccess = await getChannelAccessForUser(channel.id, auth.user.id);
        const permissions = resolveChannelPermissions({
          membership: auth.membership,
          channel,
          explicitAccess
        });
        if (!permissions.isVisible) {
          return null;
        }
        return {
          ...channel,
          currentUserCanOperate: permissions.canOperate,
          currentUserCanEditSetup: permissions.canEditSetup,
          currentUserCanManageAccess: permissions.canManageAccess,
          currentUserCanDelete: permissions.canDelete,
          isVisibleToCurrentUser: permissions.isVisible
        };
      })
    );

    return Response.json(
      {
        channels: visibleChannels.filter(Boolean),
        workspaceStage2ExamplesCorpusJson: getWorkspaceStage2ExamplesCorpusJson(auth.workspace.id),
        workspaceStage2HardConstraints: getWorkspaceStage2HardConstraints(auth.workspace.id),
        workspaceStage2PromptConfig: auth.workspace.stage2PromptConfig
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить каналы." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as CreateChannelBody | null;
  try {
    const auth = await requireAuth();
    if (auth.membership.role === "redactor_limited") {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const restrictedError = getRestrictedChannelEditError(auth.membership.role, body);
    if (restrictedError) {
      return Response.json({ error: restrictedError }, { status: 403 });
    }
    const channel = await createChannel({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      name: body?.name,
      username: body?.username,
      systemPrompt: body?.systemPrompt,
      descriptionPrompt: body?.descriptionPrompt,
      examplesJson: body?.examplesJson,
      stage2WorkerProfileId: body?.stage2WorkerProfileId,
      stage2ExamplesConfig: body?.stage2ExamplesConfig,
      stage2HardConstraints: body?.stage2HardConstraints,
      stage2PromptConfig: body?.stage2PromptConfig,
      templateId: body?.templateId
    });
    return Response.json({ channel }, { status: 200 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось создать канал." },
      { status: 400 }
    );
  }
}
