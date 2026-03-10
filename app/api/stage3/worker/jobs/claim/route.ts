import { requireStage3WorkerAuth } from "../../../../../../lib/auth/stage3-worker";
import { buildStage3JobEnvelope } from "../../../../../../lib/stage3-job-http";
import { claimNextQueuedStage3JobForWorker } from "../../../../../../lib/stage3-job-store";
import { touchStage3WorkerHeartbeat } from "../../../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

type ClaimBody = {
  supportedKinds?: Array<"preview" | "render" | "source-download" | "agent-media-step">;
  appVersion?: string | null;
  capabilities?: Record<string, unknown> | null;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as ClaimBody | null;

  try {
    const auth = requireStage3WorkerAuth(request);
    touchStage3WorkerHeartbeat({
      workerId: auth.worker.id,
      appVersion: body?.appVersion ?? null,
      capabilitiesJson: body?.capabilities ? JSON.stringify(body.capabilities) : null
    });
    const job = claimNextQueuedStage3JobForWorker({
      workerId: auth.worker.id,
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      supportedKinds: body?.supportedKinds,
      leaseDurationMs: 30_000
    });
    if (!job) {
      return new Response(null, { status: 204 });
    }
    return Response.json(
      {
        ...buildStage3JobEnvelope(job, null),
        payloadJson: job.payloadJson
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось получить Stage 3 job." },
      { status: 500 }
    );
  }
}
