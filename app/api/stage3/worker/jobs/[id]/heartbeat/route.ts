import { requireStage3WorkerAuth } from "../../../../../../../lib/auth/stage3-worker";
import { buildStage3JobEnvelope } from "../../../../../../../lib/stage3-job-http";
import { heartbeatStage3Job } from "../../../../../../../lib/stage3-job-store";
import { touchStage3WorkerHeartbeat } from "../../../../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type HeartbeatBody = {
  appVersion?: string | null;
  capabilities?: Record<string, unknown> | null;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const body = (await request.json().catch(() => null)) as HeartbeatBody | null;

  try {
    const auth = requireStage3WorkerAuth(request);
    const { id } = await context.params;
    touchStage3WorkerHeartbeat({
      workerId: auth.worker.id,
      appVersion: body?.appVersion ?? null,
      capabilitiesJson: body?.capabilities ? JSON.stringify(body.capabilities) : null
    });
    const job = heartbeatStage3Job(id, auth.worker.id, 30_000);
    return Response.json(buildStage3JobEnvelope(job, null), { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const message = error instanceof Error ? error.message : "Не удалось продлить Stage 3 lease.";
    return Response.json(
      { error: message },
      { status: message === "Stage 3 job is not leased by this worker." ? 409 : 500 }
    );
  }
}
