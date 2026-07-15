import { requireAuth, requireChannelOperate } from "../../../../lib/auth/guards";
import { resolveStage3Execution } from "../../../../lib/stage3-execution";
import {
  buildStage3JobEnvelope,
  buildStage3JobErrorBody,
  buildTerminalStage3JobErrorBody
} from "../../../../lib/stage3-job-http";
import { enqueueAndScheduleStage3Job } from "../../../../lib/stage3-job-runtime";
import {
  buildStage3PreviewDedupeKey,
  Stage3PreviewRequestBody
} from "../../../../lib/stage3-preview-service";
import { resolveRequiredStage3WorkerReadiness, resolveStage3LocalWorkerReadiness } from "../../../../lib/stage3-worker-readiness";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../../lib/ytdlp";
import { auditStage3RequestFailure } from "../../../../lib/stage3-observability";

export const runtime = "nodejs";

const PREVIEW_BUSY_RETRY_AFTER_SEC = "6";

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
    const channelId = body?.channelId?.trim() ?? "";
    if (!channelId) {
      return Response.json({ error: "Передайте channelId в теле запроса." }, { status: 400 });
    }
    await requireChannelOperate(auth, channelId);
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
      return Response.json({ error: "Передайте sourceUrl в теле запроса." }, { status: 400 });
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
        {
          error: "Не удалось подготовить исходное видео для предпросмотра. Проверьте ссылку на ролик из Шага 1."
        },
        { status: 400 }
      );
    }

    const normalizedBody = {
      ...(body ?? {}),
      channelId,
      sourceUrl,
      workspaceId: auth.workspace.id
    } satisfies Stage3PreviewRequestBody;
    const executionTarget = resolveStage3Execution(auth.workspace.stage3ExecutionTarget).resolvedTarget;
    if (normalizedBody.requiredWorkerId) {
      const readiness = executionTarget === "local"
        ? await resolveRequiredStage3WorkerReadiness({ workspaceId: auth.workspace.id, userId: auth.user.id, workerId: normalizedBody.requiredWorkerId })
        : null;
      if (!readiness?.ready) {
        return Response.json({ status: "blocked", error: "required_worker_unavailable", code: readiness?.reason ?? "required_worker_requires_local_execution" }, { status: 503 });
      }
    }
    if (executionTarget === "local") {
      const readiness = await resolveStage3LocalWorkerReadiness({
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      });
      if (!readiness.ready) {
        auditStage3RequestFailure({
          workspaceId: auth.workspace.id,
          userId: auth.user.id,
          kind: "preview",
          body: { ...(body ?? {}), sourceUrl },
          errorCode: readiness.onlineWorkers > 0 ? "worker_runtime_outdated" : "worker_unavailable",
          errorMessage: "Локальный executor устарел или недоступен. Обновите worker через bootstrap и повторите попытку.",
          recoverable: true,
          executionTarget,
          readiness
        });
        return Response.json(
          {
            error:
              "Локальный executor устарел или недоступен. Обновите worker через bootstrap и повторите попытку."
          },
          {
            status: 503,
            headers: {
              "Retry-After": PREVIEW_BUSY_RETRY_AFTER_SEC,
              "x-stage3-busy": "1",
              "x-stage3-worker-update-required": "1",
              ...(readiness.expectedRuntimeVersion
                ? { "x-stage3-worker-required-version": readiness.expectedRuntimeVersion }
                : {})
            }
          }
        );
      }
    }

    const job = enqueueAndScheduleStage3Job({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      kind: "preview",
      executionTarget,
      requiredWorkerId: normalizedBody.requiredWorkerId,
      payloadJson: JSON.stringify(normalizedBody),
      dedupeKey: await buildStage3PreviewDedupeKey(normalizedBody, {
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      })
    });
    const terminalError = buildTerminalStage3JobErrorBody(job, "Не удалось загрузить предпросмотр Stage 3.");
    if (terminalError) {
      return Response.json(terminalError, { status: 409 });
    }
    return Response.json(
      buildStage3JobEnvelope(job, job.artifact ? `/api/stage3/preview/jobs/${job.id}?download=1` : null),
      { status: job.status === "completed" ? 200 : 202 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const message = error instanceof Error ? error.message : "Не удалось загрузить предпросмотр Stage 3.";
    return Response.json(
      buildStage3JobErrorBody({
        message,
        recoverable: !isPreviewInputError(message)
      }),
      { status: isPreviewInputError(message) ? 400 : 500 }
    );
  }
}
