import {
  getChannelById
} from "../../../../../lib/chat-history";
import {
  createChannelEditorialFeedbackEvent,
  deleteChannelEditorialFeedbackEvent
} from "../../../../../lib/channel-editorial-feedback-store";
import {
  type ChannelEditorialFeedbackKind,
  type ChannelEditorialFeedbackNoteMode,
  type ChannelEditorialFeedbackScope,
  type Stage2StyleProfile
} from "../../../../../lib/stage2-channel-learning";
import { resolveChannelEditorialMemory } from "../../../../../lib/stage2-editorial-memory-resolution";
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
  stage2StyleProfile: Stage2StyleProfile | null | undefined,
  stage2WorkerProfileId?: string | null
) {
  const resolution = resolveChannelEditorialMemory({
    channelId,
    stage2StyleProfile,
    stage2WorkerProfileId
  });

  return {
    historyEvents: resolution.historyEvents,
    editorialMemory: resolution.editorialMemory,
    editorialMemorySource: resolution.source
  };
}

function getRequestedWorkerProfileId(request: Request): string | null {
  const value = new URL(request.url).searchParams.get("stage2WorkerProfileId");
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;

  try {
    const auth = await requireAuth();
    await requireChannelVisibility(auth, id);
    const channel = await getChannelById(id);
    if (!channel) {
      return Response.json({ error: "Channel not found." }, { status: 404 });
    }

    return Response.json(
      loadChannelFeedbackState(
        id,
        channel.stage2StyleProfile,
        getRequestedWorkerProfileId(request)
      ),
      { status: 200 }
    );
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
    const {
      historyEvents,
      editorialMemory,
      editorialMemorySource
    } = loadChannelFeedbackState(
      id,
      channel.stage2StyleProfile,
      getRequestedWorkerProfileId(request)
    );

    return Response.json({ event, historyEvents, editorialMemory, editorialMemorySource }, { status: 200 });
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

    const {
      historyEvents,
      editorialMemory,
      editorialMemorySource
    } = loadChannelFeedbackState(
      id,
      channel.stage2StyleProfile,
      getRequestedWorkerProfileId(request)
    );
    return Response.json(
      { deletedEventId: eventId, historyEvents, editorialMemory, editorialMemorySource },
      { status: 200 }
    );
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
