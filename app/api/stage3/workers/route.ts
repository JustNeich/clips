import { requireAuth } from "../../../../lib/auth/guards";
import { listStage3Workers } from "../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const auth = await requireAuth();
    return Response.json(
      {
        workers: listStage3Workers({
          workspaceId: auth.workspace.id,
          userId: auth.user.id
        })
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить Stage 3 workers." },
      { status: 500 }
    );
  }
}
