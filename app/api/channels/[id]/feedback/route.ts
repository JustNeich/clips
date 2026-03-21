import {
  getChannelById
} from "../../../../../lib/chat-history";
import {
  createChannelEditorialFeedbackEvent,
  listChannelEditorialFeedbackEvents
} from "../../../../../lib/channel-editorial-feedback-store";
import {
  buildStage2EditorialMemorySummary,
  type ChannelEditorialFeedbackKind
} from "../../../../../lib/stage2-channel-learning";
import {
  requireAuth,
  requireChannelOperate
} from "../../../../../lib/auth/guards";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type ChannelFeedbackBody = {
  chatId?: string | null;
  stage2RunId?: string | null;
  kind?: ChannelEditorialFeedbackKind;
  note?: string | null;
  optionSnapshot?: unknown;
};

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as ChannelFeedbackBody | null;

  try {
    const auth = await requireAuth();
    await requireChannelOperate(auth, id);
    const channel = await getChannelById(id);
    if (!channel) {
      return Response.json({ error: "Channel not found." }, { status: 404 });
    }

    const kind = body?.kind;
    if (
      kind !== "more_like_this" &&
      kind !== "less_like_this" &&
      kind !== "selected_option"
    ) {
      return Response.json({ error: "Invalid feedback kind." }, { status: 400 });
    }

    const event = createChannelEditorialFeedbackEvent({
      workspaceId: auth.workspace.id,
      channelId: id,
      userId: auth.user.id,
      chatId: body?.chatId ?? null,
      stage2RunId: body?.stage2RunId ?? null,
      kind,
      note: body?.note ?? null,
      optionSnapshot: body?.optionSnapshot
    });
    const feedbackEvents = listChannelEditorialFeedbackEvents(id, 30);
    const editorialMemory = buildStage2EditorialMemorySummary({
      profile: channel.stage2StyleProfile,
      feedbackEvents
    });

    return Response.json({ event, editorialMemory }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save channel editorial feedback."
      },
      { status: 400 }
    );
  }
}
