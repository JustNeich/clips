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

function parseDateBoundary(value: string | null, edge: "start" | "end"): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return edge === "start" ? `${raw}T00:00:00.000Z` : `${raw}T23:59:59.999Z`;
  }
  return raw;
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
        from: parseDateBoundary(url.searchParams.get("from"), "start"),
        to: parseDateBoundary(url.searchParams.get("to"), "end"),
        dateBasis: url.searchParams.get("dateBasis") === "lastActivity" ? "lastActivity" : "created",
        todayFrom: parseDateBoundary(url.searchParams.get("todayFrom"), "start"),
        todayTo: parseDateBoundary(url.searchParams.get("todayTo"), "end"),
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
