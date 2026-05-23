import { requireAuth, requireChannelSetupEdit, requireChannelVisibility } from "../../../../../../../lib/auth/guards";
import { createChannelYoutubeOAuthState } from "../../../../../../../lib/publication-store";
import {
  assertYouTubePublishingConnectReady,
  buildYouTubeOAuthUrl
} from "../../../../../../../lib/youtube-publishing";
import { getDefaultYouTubeOAuthClientKey, listPublicYouTubeOAuthClients } from "../../../../../../../lib/youtube-oauth-clients";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type ConnectBody = {
  oauthClientKey?: string;
};

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    await requireChannelVisibility(auth, id);
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
    const auth = await requireAuth();
    await requireChannelSetupEdit(auth, id);
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
