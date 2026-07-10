import { requireStage3WorkerAuth } from "../../../../../../lib/auth/stage3-worker";
import { buildStage3JobEnvelope } from "../../../../../../lib/stage3-job-http";
import {
  DEFAULT_LOCAL_STAGE3_WORKER_LEASE_MS,
  claimNextQueuedStage3JobForWorker,
  failQueuedLocalStage3JobsForWorkerUpdateRequired
} from "../../../../../../lib/stage3-job-store";
import {
  getExpectedStage3WorkerRuntimeVersion,
  isStage3WorkerRuntimeVersionCompatible
} from "../../../../../../lib/stage3-worker-runtime-manifest";
import { resolveStage3LocalWorkerReadiness } from "../../../../../../lib/stage3-worker-readiness";
import { touchStage3WorkerHeartbeat } from "../../../../../../lib/stage3-worker-store";
import type { Stage3JobKind } from "../../../../../../app/components/types";
import { isProductionSemanticExecutorReadiness } from "../../../../../../lib/project-kings/production-semantic-job-contract";

export const runtime = "nodejs";

type ClaimBody = {
  supportedKinds?: Stage3JobKind[];
  appVersion?: string | null;
  capabilities?: Record<string, unknown> | null;
};

const KNOWN_STAGE3_WORKER_KINDS: readonly Stage3JobKind[] = [
  "preview",
  "render",
  "editing-proxy",
  "source-download",
  "agent-media-step",
  "production-semantic"
];

export function resolveClaimableStage3WorkerKinds(
  supportedKinds: readonly Stage3JobKind[] | null | undefined,
  capabilities: Record<string, unknown> | null | undefined
): Stage3JobKind[] | null {
  if (!supportedKinds) return null;
  const unique = [...new Set(supportedKinds)].filter((kind) =>
    KNOWN_STAGE3_WORKER_KINDS.includes(kind)
  );
  const semanticReadiness = capabilities?.productionSemantic;
  return unique.filter(
    (kind) =>
      kind !== "production-semantic" ||
      (isProductionSemanticExecutorReadiness(semanticReadiness) &&
        semanticReadiness.ready &&
        semanticReadiness.code === "ready")
  );
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
    const supportedKinds = resolveClaimableStage3WorkerKinds(
      body?.supportedKinds,
      body?.capabilities
    );
    if (body?.supportedKinds && supportedKinds?.length === 0) {
      return new Response(null, { status: 204 });
    }
    const job = claimNextQueuedStage3JobForWorker({
      workerId: auth.worker.id,
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      supportedKinds: supportedKinds ?? undefined,
      leaseDurationMs: DEFAULT_LOCAL_STAGE3_WORKER_LEASE_MS
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
