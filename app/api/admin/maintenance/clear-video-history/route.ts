import { requireOwnerOrMcpFlowRead } from "../../../../../lib/auth/guards";
import { clearVideoHistoryForMaintenance } from "../../../../../lib/maintenance-video-history";

export const runtime = "nodejs";

const CLEAR_VIDEO_HISTORY_CONFIRMATION = "clear-video-history-2026-05-02";

type ClearVideoHistoryBody = {
  confirm?: string | null;
  dryRun?: boolean;
  resetWorkers?: boolean;
  removeLegacyJson?: boolean;
};

export async function POST(request: Request): Promise<Response> {
  try {
    await requireOwnerOrMcpFlowRead(request);
    const body = (await request.json().catch(() => null)) as ClearVideoHistoryBody | null;
    if (body?.confirm !== CLEAR_VIDEO_HISTORY_CONFIRMATION) {
      return Response.json({ error: "Maintenance confirmation mismatch." }, { status: 400 });
    }
    const result = await clearVideoHistoryForMaintenance({
      dryRun: body.dryRun === true,
      resetWorkers: body.resetWorkers !== false,
      removeLegacyJson: body.removeLegacyJson !== false
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось очистить историю роликов." },
      { status: 500 }
    );
  }
}
