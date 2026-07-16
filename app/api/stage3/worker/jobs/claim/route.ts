import { requireStage3WorkerAuth } from "../../../../../../lib/auth/stage3-worker";
import { buildStage3JobEnvelope } from "../../../../../../lib/stage3-job-http";
import {
  DEFAULT_LOCAL_STAGE3_WORKER_LEASE_MS,
  appendStage3JobEvent,
  claimNextQueuedStage3JobForWorker,
  failQueuedLocalStage3JobsForWorkerUpdateRequired
} from "../../../../../../lib/stage3-job-store";
import {
  getExpectedStage3WorkerRuntimeVersion,
  isStage3WorkerRuntimeVersionCompatible
} from "../../../../../../lib/stage3-worker-runtime-manifest";
import { resolveStage3LocalWorkerReadiness } from "../../../../../../lib/stage3-worker-readiness";
import { touchStage3WorkerHeartbeat } from "../../../../../../lib/stage3-worker-store";
import type { Stage3LocalResourceProfile } from "../../../../../../lib/stage3-local-scheduler";

export const runtime = "nodejs";

type ClaimBody = {
  supportedKinds?: Array<"preview" | "render" | "editing-proxy" | "source-download" | "agent-media-step">;
  resourceProfiles?: Stage3LocalResourceProfile[];
  appVersion?: string | null;
  capabilities?: Record<string, unknown> | null;
};

function schedulerResourceEvidence(capabilities: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const admission = capabilities?.admission && typeof capabilities.admission === "object"
    ? capabilities.admission as Record<string, unknown>
    : {};
  const telemetry = admission.telemetry && typeof admission.telemetry === "object"
    ? admission.telemetry as Record<string, unknown>
    : {};
  const finite = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    resourceClass: typeof admission.resourceClass === "string" ? admission.resourceClass : null,
    normalizedLoad1m: finite(telemetry.normalizedLoad1m),
    availableMemoryPercent: finite(telemetry.availableMemoryPercent),
    diskFreeBytes: finite(telemetry.diskFreeBytes),
    swapUsedBytes: finite(telemetry.swapUsedBytes),
    swapGrowthBytes5m: finite(admission.swapGrowthBytes5m)
  };
}

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
      const readiness = await resolveStage3LocalWorkerReadiness({
        workspaceId: auth.workspaceId,
        userId: auth.userId
      });
      const failedQueuedJobs =
        readiness.compatibleOnlineWorkers === 0
          ? failQueuedLocalStage3JobsForWorkerUpdateRequired({
              workspaceId: auth.workspaceId,
              userId: auth.userId,
              supportedKinds: body?.supportedKinds,
              workerId: auth.worker.id,
              workerAppVersion,
              expectedRuntimeVersion
            })
          : 0;
      const expected = expectedRuntimeVersion || "latest";
      return Response.json(
        {
          error:
            `Local Stage 3 worker is outdated (worker: ${workerAppVersion ?? "unknown"}, expected: ${expected}). ` +
            "Run Stage 3 bootstrap command again to update executor runtime.",
          code: "worker_update_required",
          requiredAppVersion: expectedRuntimeVersion,
          failedQueuedJobs
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
      resourceProfiles: body?.resourceProfiles,
      leaseDurationMs: DEFAULT_LOCAL_STAGE3_WORKER_LEASE_MS
    });
    if (!job) {
      return new Response(null, { status: 204 });
    }
    appendStage3JobEvent(job.id, "info", "Local scheduler admitted job.", {
      resourceProfile: job.resourceProfile,
      ...schedulerResourceEvidence(body?.capabilities)
    });
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
