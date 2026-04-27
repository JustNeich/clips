import { requireOwnerOrMcpFlowRead } from "../../../../../../lib/auth/guards";
import { buildChatTraceExportFileName } from "../../../../../../lib/chat-trace-export-shared";
import { exportFlowTrace } from "../../../../../../lib/flow-observability";

export const runtime = "nodejs";

type Context = { params: Promise<{ chatId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { chatId } = await context.params;
  const url = new URL(request.url);
  const selectedRunId = url.searchParams.get("selectedRunId")?.trim() || null;
  try {
    const auth = await requireOwnerOrMcpFlowRead(request);
    const trace = await exportFlowTrace({
      workspace: auth.workspace,
      userId: auth.user.id,
      chatId,
      selectedRunId
    });
    if (!trace) {
      return Response.json({ error: "Trace export is unavailable for this flow." }, { status: 404 });
    }
    const exportedAt =
      typeof trace === "object" && trace && "exportedAt" in trace && typeof trace.exportedAt === "string"
        ? trace.exportedAt
        : new Date().toISOString();
    const fileName = buildChatTraceExportFileName({
      channelUsername: null,
      chatId,
      exportedAt
    });
    return new Response(JSON.stringify(trace, null, 2), {
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
      { error: error instanceof Error ? error.message : "Не удалось выгрузить trace." },
      { status: 500 }
    );
  }
}
