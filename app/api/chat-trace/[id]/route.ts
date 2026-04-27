import { getChatById } from "../../../../lib/chat-history";
import { requireAuth, requireChannelVisibility } from "../../../../lib/auth/guards";
import { buildChatTraceExport } from "../../../../lib/chat-trace-export";
import { buildChatTraceExportFileName } from "../../../../lib/chat-trace-export-shared";
import { redactForFlowExport } from "../../../../lib/flow-redaction";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const url = new URL(request.url);
  const selectedRunId = url.searchParams.get("selectedRunId")?.trim() || null;

  try {
    const auth = await requireAuth(request);
    const chat = await getChatById(id);
    if (!chat || chat.workspaceId !== auth.workspace.id) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }

    const { channel } = await requireChannelVisibility(auth, chat.channelId);
    const payload = await buildChatTraceExport({
      workspace: auth.workspace,
      userId: auth.user.id,
      chatId: chat.id,
      selectedRunId
    });

    if (!payload) {
      return Response.json({ error: "Trace export is unavailable for this chat." }, { status: 404 });
    }

    const fileName = buildChatTraceExportFileName({
      channelUsername: channel.username,
      chatId: chat.id,
      exportedAt: payload.exportedAt
    });

    return new Response(JSON.stringify(redactForFlowExport(payload), null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось собрать trace export." },
      { status: 500 }
    );
  }
}
