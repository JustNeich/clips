import { deleteChatById, getChatById, getChatDraft } from "../../../../lib/chat-history";
import { requireAuth, requireChannelOperate, requireChannelVisibility } from "../../../../lib/auth/guards";
import { tryAppendFlowAuditEvent } from "../../../../lib/audit-log-store";
import { sanitizeChatForRole } from "../../../../lib/sensitive-access";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth(request);
    const chat = await getChatById(id);
    if (!chat) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    await requireChannelVisibility(auth, chat.channelId);
    const draft = await getChatDraft(id, auth.user.id);

    return Response.json({ chat: sanitizeChatForRole(chat, auth.membership.role), draft }, { status: 200 });
  } catch (error) {
    return error instanceof Response
      ? error
      : Response.json(
          { error: error instanceof Error ? error.message : "Не удалось загрузить чат." },
          { status: 500 }
        );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireAuth();
    const chat = await getChatById(id);
    if (!chat) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    await requireChannelOperate(auth, chat.channelId);
    const deleted = await deleteChatById(id);
    if (!deleted) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    tryAppendFlowAuditEvent({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      action: "chat.deleted",
      entityType: "chat",
      entityId: chat.id,
      channelId: chat.channelId,
      chatId: chat.id,
      stage: "chat",
      status: "deleted",
      payload: {
        title: chat.title,
        sourceUrl: chat.url
      }
    });
    return Response.json({ deletedId: id }, { status: 200 });
  } catch (error) {
    return error instanceof Response
      ? error
      : Response.json(
          { error: error instanceof Error ? error.message : "Не удалось удалить чат." },
          { status: 500 }
        );
  }
}
