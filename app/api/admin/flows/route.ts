import { requireOwnerOrMcpFlowRead } from "../../../../lib/auth/guards";
import { listFlowObservability } from "../../../../lib/flow-observability";

export const runtime = "nodejs";

function parseLimit(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireOwnerOrMcpFlowRead(request);
    const url = new URL(request.url);
    const payload = listFlowObservability({
      workspaceId: auth.workspace.id,
      filters: {
        channelId: url.searchParams.get("channelId")?.trim() || null,
        stage: url.searchParams.get("stage")?.trim() || null,
        status: url.searchParams.get("status")?.trim() || null,
        provider: url.searchParams.get("provider")?.trim() || null,
        model: url.searchParams.get("model")?.trim() || null,
        search: url.searchParams.get("search")?.trim() || null,
        from: url.searchParams.get("from")?.trim() || null,
        to: url.searchParams.get("to")?.trim() || null,
        limit: parseLimit(url.searchParams.get("limit"))
      }
    });
    return Response.json(payload, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить журнал процессов." },
      { status: 500 }
    );
  }
}
