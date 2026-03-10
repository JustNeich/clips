import { requireAuth } from "../../../../../../lib/auth/guards";
import { revokeStage3Worker } from "../../../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requireAuth();
    const { id } = await context.params;
    const worker = revokeStage3Worker({
      workerId: id,
      workspaceId: auth.workspace.id,
      userId: auth.user.id
    });
    return Response.json({ worker }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const message = error instanceof Error ? error.message : "Не удалось отключить Stage 3 worker.";
    return Response.json(
      { error: message },
      { status: message === "Stage 3 worker not found." ? 404 : 500 }
    );
  }
}
