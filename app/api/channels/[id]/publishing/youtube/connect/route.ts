import {
  requireAuth,
  requireChannelSetupEdit,
  requireChannelVisibility,
  requireOwnerOrMcpControlWrite
} from "../../../../../../../lib/auth/guards";
import { requireSensitiveArtifactAccess } from "../../../../../../../lib/sensitive-access";
import { createChannelYoutubeOAuthState } from "../../../../../../../lib/publication-store";
import {
  assertYouTubePublishingConnectReady,
  buildYouTubeOAuthUrl
} from "../../../../../../../lib/youtube-publishing";
import { getDefaultYouTubeOAuthClientKey, listPublicYouTubeOAuthClients } from "../../../../../../../lib/youtube-oauth-clients";
import { getChannelById } from "../../../../../../../lib/chat-history";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type ConnectBody = {
  oauthClientKey?: string;
};

function hasBearerToken(request: Request): boolean {
  return /^Bearer\s+.+$/i.test(request.headers.get("authorization") ?? "");
}

async function requireMcpControlChannel(request: Request, channelId: string) {
  const auth = await requireOwnerOrMcpControlWrite(request);
  const channel = await getChannelById(channelId);
  if (!channel || channel.workspaceId !== auth.workspace.id) {
    throw new Response(JSON.stringify({ error: "Канал не найден." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  return auth;
}

async function authorizeConnectOptions(request: Request, channelId: string) {
  if (hasBearerToken(request)) {
    return requireMcpControlChannel(request, channelId);
  }

  const auth = await requireAuth(request);
  requireSensitiveArtifactAccess(auth);
  await requireChannelVisibility(auth, channelId);
  return auth;
}

async function authorizeConnectStart(request: Request, channelId: string) {
  if (hasBearerToken(request)) {
    return requireMcpControlChannel(request, channelId);
  }

  const auth = await requireAuth(request);
  requireSensitiveArtifactAccess(auth);
  await requireChannelSetupEdit(auth, channelId);
  return auth;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    await authorizeConnectOptions(request, id);
    return Response.json(
      {
        oauthClients: listPublicYouTubeOAuthClients(),
        defaultOauthClientKey: getDefaultYouTubeOAuthClientKey()
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить Google OAuth projects." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as ConnectBody | null;
  try {
    const oauthClientKey = body?.oauthClientKey?.trim() || getDefaultYouTubeOAuthClientKey();
    const auth = await authorizeConnectStart(request, id);
    assertYouTubePublishingConnectReady(oauthClientKey);
    const state = createChannelYoutubeOAuthState({
      workspaceId: auth.workspace.id,
      channelId: id,
      userId: auth.user.id,
      oauthClientKey
    });
    return Response.json(
      {
        url: buildYouTubeOAuthUrl(request, state.state, oauthClientKey),
        expiresAt: state.expiresAt
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось начать YouTube OAuth подключение." },
      { status: 500 }
    );
  }
}
