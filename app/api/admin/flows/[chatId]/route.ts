import { requireOwnerOrMcpFlowRead } from "../../../../../lib/auth/guards";
import { getFlowObservabilityDetail } from "../../../../../lib/flow-observability";

export const runtime = "nodejs";

type Context = { params: Promise<{ chatId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { chatId } = await context.params;
  const url = new URL(request.url);
  const selectedRunId = url.searchParams.get("selectedRunId")?.trim() || null;
  try {
    const auth = await requireOwnerOrMcpFlowRead(request);
    const detail = await getFlowObservabilityDetail({
      workspace: auth.workspace,
      userId: auth.user.id,
      chatId,
      selectedRunId
    });
    if (!detail) {
      return Response.json({ error: "Flow not found." }, { status: 404 });
    }
    return Response.json(detail, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить процесс." },
      { status: 500 }
    );
  }
}
