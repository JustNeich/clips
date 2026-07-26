import { appendFlowAuditEvent } from "../../../../lib/audit-log-store";
import { requireAuth, requireOwnerOrMcpControlWrite } from "../../../../lib/auth/guards";
import { getChannelById } from "../../../../lib/chat-history";
import { asErrorResponse } from "../../../../lib/http";
import { resolvePublicAppOrigin } from "../../../../lib/public-app-origin";
import { provisionChannelConnector } from "../../../../lib/team-store";

export const runtime = "nodejs";

type Body = {
  email?: string;
  displayName?: string;
  channelId?: string;
  channelIds?: string[];
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const email = body?.email?.trim() ?? "";
  const displayName = body?.displayName?.trim() ?? "";
  const channelIds = Array.from(
    new Set(
      (Array.isArray(body?.channelIds) ? body.channelIds : body?.channelId ? [body.channelId] : [])
        .map((channelId) => channelId.trim())
        .filter(Boolean)
    )
  );
  if (!email || channelIds.length === 0) {
    return Response.json(
      { error: "Передайте email и выберите хотя бы один канал." },
      { status: 400 }
    );
  }

  try {
    const usesBearer = /^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "");
    const auth = usesBearer
      ? await requireOwnerOrMcpControlWrite(request)
      : await requireAuth(request);
    const sessionRole = "membership" in auth ? auth.membership?.role ?? null : null;
    if (
      sessionRole &&
      sessionRole !== "owner" &&
      sessionRole !== "manager"
    ) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const channels = await Promise.all(channelIds.map((channelId) => getChannelById(channelId)));
    if (channels.some((channel) => !channel || channel.workspaceId !== auth.workspace.id)) {
      return Response.json(
        { error: "Один или несколько каналов не найдены." },
        { status: 404 }
      );
    }

    const result = await provisionChannelConnector({
      workspaceId: auth.workspace.id,
      email,
      displayName,
      channelIds,
      createdByUserId: auth.user.id
    });
    appendFlowAuditEvent({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      action: "channel_connector.provisioned",
      entityType: "workspace_member",
      entityId: result.membership.id,
      stage: "auth",
      status: "created",
      payload: {
        connectorUserId: result.user.id,
        connectorEmail: result.user.email,
        channelIds,
        channelCount: channelIds.length,
        accessRole: "connect"
      }
    });

    return Response.json(
      {
        member: { user: result.user, membership: result.membership },
        channels: channels.map((channel) => ({
          id: channel!.id,
          name: channel!.name,
          username: channel!.username
        })),
        credentials: {
          email: result.user.email,
          password: result.initialPassword,
          portalUrl: `${resolvePublicAppOrigin(request)}/connect/login`
        }
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return asErrorResponse(error, "Не удалось создать аккаунт подключения.", 400);
  }
}
