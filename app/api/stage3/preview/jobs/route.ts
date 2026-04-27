import { requireAuth, requireChannelVisibility } from "../../../../../lib/auth/guards";
import { resolveStage3Execution } from "../../../../../lib/stage3-execution";
import { buildStage3JobEnvelope, buildStage3JobErrorBody } from "../../../../../lib/stage3-job-http";
import { enqueueAndScheduleStage3Job } from "../../../../../lib/stage3-job-runtime";
import {
  buildStage3PreviewDedupeKey,
  Stage3PreviewRequestBody
} from "../../../../../lib/stage3-preview-service";
import { resolveStage3LocalWorkerReadiness } from "../../../../../lib/stage3-worker-readiness";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../../../lib/ytdlp";
import { auditStage3RequestFailure } from "../../../../../lib/stage3-observability";

export const runtime = "nodejs";

function isPreviewInputError(message: string): boolean {
  return (
    message.includes("sourceUrl") ||
    message.includes("Проверьте ссылку") ||
    message.includes("предпросмотра")
  );
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Stage3PreviewRequestBody | null;

  try {
    const auth = await requireAuth(request);
    if (body?.channelId?.trim()) {
      await requireChannelVisibility(auth, body.channelId.trim());
    }
    const sourceUrl = normalizeSupportedUrl(body?.sourceUrl?.trim() ?? "");
    if (!sourceUrl) {
      auditStage3RequestFailure({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        kind: "preview",
        body,
        errorCode: "missing_source_url",
        errorMessage: "Передайте sourceUrl в теле запроса.",
        recoverable: false
      });
      return Response.json(
        buildStage3JobErrorBody({
          message: "Передайте sourceUrl в теле запроса.",
          recoverable: false
        }),
        { status: 400 }
      );
    }
    if (!isSupportedUrl(sourceUrl)) {
      auditStage3RequestFailure({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        kind: "preview",
        body: { ...(body ?? {}), sourceUrl },
        errorCode: "unsupported_source_url",
        errorMessage: "Не удалось подготовить исходное видео для предпросмотра. Проверьте ссылку на ролик из Шага 1.",
        recoverable: false
      });
      return Response.json(
        buildStage3JobErrorBody({
          message: "Не удалось подготовить исходное видео для предпросмотра. Проверьте ссылку на ролик из Шага 1.",
          recoverable: false
        }),
        { status: 400 }
      );
    }

    const executionTarget = resolveStage3Execution(auth.workspace.stage3ExecutionTarget).resolvedTarget;
    if (executionTarget === "local") {
      const readiness = await resolveStage3LocalWorkerReadiness({
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      });
      if (!readiness.ready) {
        const detail =
          readiness.onlineWorkers > 0 && readiness.expectedRuntimeVersion
            ? `Текущий локальный executor устарел. Требуется runtime ${readiness.expectedRuntimeVersion}.`
            : "Локальный executor Stage 3 недоступен.";
        auditStage3RequestFailure({
          workspaceId: auth.workspace.id,
          userId: auth.user.id,
          kind: "preview",
          body,
          errorCode: readiness.onlineWorkers > 0 ? "worker_runtime_outdated" : "worker_unavailable",
          errorMessage: `${detail} Обновите/перезапустите worker через bootstrap и повторите попытку.`,
          recoverable: true,
          executionTarget
        });
        return Response.json(
          buildStage3JobErrorBody({
            message: `${detail} Обновите/перезапустите worker через bootstrap и повторите попытку.`,
            recoverable: true,
            retryAfterSec: 10
          }),
          {
            status: 503,
            headers: {
              "Retry-After": "10",
              "x-stage3-worker-update-required": "1",
              ...(readiness.expectedRuntimeVersion
                ? { "x-stage3-worker-required-version": readiness.expectedRuntimeVersion }
                : {})
            }
          }
        );
      }
    }

    const dedupeKey = await buildStage3PreviewDedupeKey({ ...(body ?? {}), sourceUrl }, {
      workspaceId: auth.workspace.id,
      userId: auth.user.id
    });
    const job = enqueueAndScheduleStage3Job({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      kind: "preview",
      executionTarget,
      payloadJson: JSON.stringify({
        ...(body ?? {}),
        sourceUrl,
        workspaceId: auth.workspace.id
      }),
      dedupeKey
    });

    return Response.json(
      buildStage3JobEnvelope(job, job.artifact ? `/api/stage3/preview/jobs/${job.id}?download=1` : null),
      { status: job.status === "completed" ? 200 : 202 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const message = error instanceof Error ? error.message : "Не удалось поставить preview в очередь.";
    return Response.json(
      buildStage3JobErrorBody({
        message,
        recoverable: !isPreviewInputError(message)
      }),
      { status: isPreviewInputError(message) ? 400 : 500 }
    );
  }
}
