import { buildChatListItem, normalizeChatDraft } from "../../../../../lib/chat-workflow";
import { getChatById, upsertChatDraft } from "../../../../../lib/chat-history";
import { requireAuth, requireChannelOperate } from "../../../../../lib/auth/guards";

export const runtime = "nodejs";

type DraftBody = {
  lastOpenStep?: 1 | 2 | 3;
  stage2?: {
    instruction?: string;
    selectedCaptionOption?: number | null;
    selectedTitleOption?: number | null;
  };
  stage3?: {
    topText?: string | null;
    bottomText?: string | null;
    captionHighlights?: unknown;
    clipStartSec?: number | null;
    focusY?: number | null;
    renderPlan?: unknown;
    agentPrompt?: string;
    selectedVersionId?: string | null;
    passSelectionByVersion?: Record<string, number>;
  };
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as DraftBody | null;

  try {
    const auth = await requireAuth();
    const chat = await getChatById(id);
    if (!chat) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    await requireChannelOperate(auth, chat.channelId);

    const normalized = normalizeChatDraft({
      threadId: id,
      userId: auth.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenStep: body?.lastOpenStep ?? 1,
      stage2: {
        instruction: body?.stage2?.instruction ?? "",
        selectedCaptionOption: body?.stage2?.selectedCaptionOption ?? null,
        selectedTitleOption: body?.stage2?.selectedTitleOption ?? null
      },
      stage3: {
        topText: body?.stage3?.topText ?? null,
        bottomText: body?.stage3?.bottomText ?? null,
        captionHighlights: body?.stage3?.captionHighlights ?? null,
        clipStartSec: body?.stage3?.clipStartSec ?? null,
        focusY: body?.stage3?.focusY ?? null,
        renderPlan: body?.stage3?.renderPlan ?? null,
        agentPrompt: body?.stage3?.agentPrompt ?? "",
        selectedVersionId: body?.stage3?.selectedVersionId ?? null,
        passSelectionByVersion: body?.stage3?.passSelectionByVersion ?? {}
      }
    });

    if (!normalized) {
      return Response.json({ error: "Draft payload is invalid." }, { status: 400 });
    }

    const draft = await upsertChatDraft(id, auth.user.id, {
      lastOpenStep: normalized.lastOpenStep,
      stage2: normalized.stage2,
      stage3: normalized.stage3
    });
    const refreshedChat = await getChatById(id);
    if (!refreshedChat) {
      return Response.json({ error: "Chat not found after draft save." }, { status: 404 });
    }

    return Response.json(
      {
        draft,
        summary: buildChatListItem(refreshedChat, draft)
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить draft." },
      { status: 500 }
    );
  }
}
