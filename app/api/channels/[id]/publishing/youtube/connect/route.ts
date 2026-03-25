import { requireAuth, requireChannelSetupEdit } from "../../../../../../../lib/auth/guards";
import { createChannelYoutubeOAuthState } from "../../../../../../../lib/publication-store";
import { buildYouTubeOAuthUrl } from "../../../../../../../lib/youtube-publishing";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    await requireChannelSetupEdit(auth, id);
    const state = createChannelYoutubeOAuthState({
      workspaceId: auth.workspace.id,
      channelId: id,
      userId: auth.user.id
    });
    return Response.json(
      {
        url: buildYouTubeOAuthUrl(request, state.state),
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

