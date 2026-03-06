import {
  createChannel,
  getChannelAccessForUser,
  listChannelsWithStats
} from "../../../lib/chat-history";
import { requireAuth } from "../../../lib/auth/guards";
import { resolveChannelPermissions } from "../../../lib/acl";

export const runtime = "nodejs";

type CreateChannelBody = {
  name?: string;
  username?: string;
  systemPrompt?: string;
  descriptionPrompt?: string;
  examplesJson?: string;
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
          isVisibleToCurrentUser: permissions.isVisible
        };
      })
    );

    return Response.json({ channels: visibleChannels.filter(Boolean) }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load channels." },
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
    const channel = await createChannel({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      name: body?.name,
      username: body?.username,
      systemPrompt: body?.systemPrompt,
      descriptionPrompt: body?.descriptionPrompt,
      examplesJson: body?.examplesJson,
      templateId: body?.templateId
    });
    return Response.json({ channel }, { status: 200 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create channel." },
      { status: 400 }
    );
  }
}
