import {
  getChannelById
} from "../../../../../lib/chat-history";
import {
  createChannelEditorialFeedbackEvent,
  deleteChannelEditorialFeedbackEvent,
  listChannelEditorialPassiveSelectionEvents,
  listChannelEditorialRatingEvents
} from "../../../../../lib/channel-editorial-feedback-store";
import {
  buildStage2EditorialMemorySummary,
  type ChannelEditorialFeedbackKind,
  type ChannelEditorialFeedbackNoteMode,
  type ChannelEditorialFeedbackScope,
  type Stage2StyleProfile
} from "../../../../../lib/stage2-channel-learning";
import {
  requireAuth,
  requireChannelOperate,
  requireChannelVisibility
} from "../../../../../lib/auth/guards";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

type ChannelFeedbackBody = {
  eventId?: string;
  chatId?: string | null;
  stage2RunId?: string | null;
  kind?: ChannelEditorialFeedbackKind;
  scope?: ChannelEditorialFeedbackScope;
  noteMode?: ChannelEditorialFeedbackNoteMode;
  note?: string | null;
  optionSnapshot?: unknown;
};

function loadChannelFeedbackState(
  channelId: string,
  stage2StyleProfile: Stage2StyleProfile | null | undefined
) {
  const historyEvents = listChannelEditorialRatingEvents(channelId, 30);
  const editorialMemory = buildStage2EditorialMemorySummary({
    profile: stage2StyleProfile,
    feedbackEvents: [
      ...historyEvents,
      ...listChannelEditorialPassiveSelectionEvents(channelId, 12)
    ]
  });

  return {
    historyEvents,
    editorialMemory
  };
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;

  try {
    const auth = await requireAuth();
    await requireChannelVisibility(auth, id);
    const channel = await getChannelById(id);
    if (!channel) {
      return Response.json({ error: "Channel not found." }, { status: 404 });
    }

    return Response.json(loadChannelFeedbackState(id, channel.stage2StyleProfile), { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load channel editorial feedback."
      },
      { status: 400 }
    );
  }
}

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
      scope: body?.scope ?? "option",
      noteMode: body?.noteMode ?? "soft_preference",
      note: body?.note ?? null,
      optionSnapshot: body?.optionSnapshot
    });
    const { historyEvents, editorialMemory } = loadChannelFeedbackState(id, channel.stage2StyleProfile);

    return Response.json({ event, historyEvents, editorialMemory }, { status: 200 });
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

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as ChannelFeedbackBody | null;

  try {
    const auth = await requireAuth();
    await requireChannelOperate(auth, id);
    const channel = await getChannelById(id);
    if (!channel) {
      return Response.json({ error: "Channel not found." }, { status: 404 });
    }

    const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
    if (!eventId) {
      return Response.json({ error: "Feedback event id is required." }, { status: 400 });
    }

    const deleted = deleteChannelEditorialFeedbackEvent(id, eventId);
    if (!deleted) {
      return Response.json({ error: "Feedback event not found." }, { status: 404 });
    }

    const { historyEvents, editorialMemory } = loadChannelFeedbackState(id, channel.stage2StyleProfile);
    return Response.json({ deletedEventId: eventId, historyEvents, editorialMemory }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete channel editorial feedback."
      },
      { status: 400 }
    );
  }
}
