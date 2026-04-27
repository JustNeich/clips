import { requireOwnerOrMcpFlowRead } from "../../../../lib/auth/guards";
import { listFlowAuditEvents } from "../../../../lib/audit-log-store";

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
    const events = listFlowAuditEvents({
      workspaceId: auth.workspace.id,
      channelId: url.searchParams.get("channelId")?.trim() || null,
      chatId: url.searchParams.get("chatId")?.trim() || null,
      entityId: url.searchParams.get("entityId")?.trim() || null,
      stage: url.searchParams.get("stage")?.trim() || null,
      status: url.searchParams.get("status")?.trim() || null,
      severity: url.searchParams.get("severity")?.trim() || null,
      search: url.searchParams.get("search")?.trim() || null,
      from: parseDateBoundary(url.searchParams.get("from"), "start"),
      to: parseDateBoundary(url.searchParams.get("to"), "end"),
      limit: parseLimit(url.searchParams.get("limit"))
    });
    return Response.json({ events }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить audit events." },
      { status: 500 }
    );
  }
}
