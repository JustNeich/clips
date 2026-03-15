import { requireStage3WorkerAuth } from "../../../../../../lib/auth/stage3-worker";
import { buildStage3JobEnvelope } from "../../../../../../lib/stage3-job-http";
import { claimNextQueuedStage3JobForWorker } from "../../../../../../lib/stage3-job-store";
import {
  getExpectedStage3WorkerRuntimeVersion,
  isStage3WorkerRuntimeVersionCompatible
} from "../../../../../../lib/stage3-worker-runtime-manifest";
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
    const expectedRuntimeVersion = await getExpectedStage3WorkerRuntimeVersion();
    const workerAppVersion = body?.appVersion?.trim() || null;
    touchStage3WorkerHeartbeat({
      workerId: auth.worker.id,
      appVersion: workerAppVersion,
      capabilitiesJson: body?.capabilities ? JSON.stringify(body.capabilities) : null
    });
    if (
      !isStage3WorkerRuntimeVersionCompatible({
        workerAppVersion,
        expectedRuntimeVersion
      })
    ) {
      const expected = expectedRuntimeVersion || "latest";
      return Response.json(
        {
          error:
            `Local Stage 3 worker is outdated (worker: ${workerAppVersion ?? "unknown"}, expected: ${expected}). ` +
            "Run Stage 3 bootstrap command again to update executor runtime.",
          code: "worker_update_required",
          requiredAppVersion: expectedRuntimeVersion
        },
        {
          status: 409,
          headers: {
            "x-stage3-worker-update-required": "1",
            ...(expectedRuntimeVersion
              ? { "x-stage3-worker-required-version": expectedRuntimeVersion }
              : {})
          }
        }
      );
    }
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
