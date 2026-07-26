import { requireConnectorChannelAccess } from "../../../../../../../lib/auth/guards";
import { createChannelYoutubeOAuthState } from "../../../../../../../lib/publication-store";
import {
  getDefaultYouTubeOAuthClientKey,
  listPublicYouTubeOAuthClients
} from "../../../../../../../lib/youtube-oauth-clients";
import {
  assertYouTubePublishingConnectReady,
  buildYouTubeOAuthUrl
} from "../../../../../../../lib/youtube-publishing";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };
type Body = { oauthClientKey?: string };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    await requireConnectorChannelAccess(request, id);
    return Response.json({
      oauthClients: listPublicYouTubeOAuthClients(),
      defaultOauthClientKey: getDefaultYouTubeOAuthClientKey()
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Не удалось подготовить подключение Google." }, { status: 500 });
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  try {
    const { id } = await context.params;
    const { auth } = await requireConnectorChannelAccess(request, id);
    const oauthClientKey = body?.oauthClientKey?.trim() || getDefaultYouTubeOAuthClientKey();
    assertYouTubePublishingConnectReady(oauthClientKey);
    const state = createChannelYoutubeOAuthState({
      workspaceId: auth.workspace.id,
      channelId: id,
      userId: auth.user.id,
      oauthClientKey
    });
    return Response.json({
      url: buildYouTubeOAuthUrl(request, state.state, oauthClientKey),
      expiresAt: state.expiresAt
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось начать подключение YouTube." },
      { status: 500 }
    );
  }
}
