import { requireStage3WorkerAuth } from "../../../../../../../lib/auth/stage3-worker";
import { buildStage3JobEnvelope } from "../../../../../../../lib/stage3-job-http";
import { finishStage3Job, getStage3Job } from "../../../../../../../lib/stage3-job-store";
import { touchStage3WorkerHeartbeat } from "../../../../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type FailBody = {
  errorCode?: string | null;
  message?: string | null;
  recoverable?: boolean;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const body = (await request.json().catch(() => null)) as FailBody | null;

  try {
    const auth = requireStage3WorkerAuth(request);
    const { id } = await context.params;
    const current = getStage3Job(id);
    if (!current || current.workspaceId !== auth.workspaceId || current.userId !== auth.userId) {
      return Response.json({ error: "Stage 3 job not found." }, { status: 404 });
    }
    if (current.assignedWorkerId !== auth.worker.id) {
      return Response.json({ error: "Stage 3 job is not leased by this worker." }, { status: 409 });
    }

    touchStage3WorkerHeartbeat({
      workerId: auth.worker.id
    });

    const failed = finishStage3Job(id, {
      status: "failed",
      errorCode: body?.errorCode?.trim() || "worker_failed",
      errorMessage: body?.message?.trim() || "Локальный executor завершил Stage 3 job с ошибкой.",
      recoverable: body?.recoverable !== false
    });
    return Response.json(buildStage3JobEnvelope(failed, null), { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось пометить Stage 3 job ошибкой." },
      { status: 500 }
    );
  }
}
