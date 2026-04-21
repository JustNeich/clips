import { requireAuth } from "../../../../../lib/auth/guards";
import { resolveStage3Execution } from "../../../../../lib/stage3-execution";
import { buildStage3JobEnvelope, buildStage3JobErrorBody } from "../../../../../lib/stage3-job-http";
import { enqueueAndScheduleStage3Job } from "../../../../../lib/stage3-job-runtime";
import {
  buildStage3EditingProxyDedupeKey,
  Stage3EditingProxyRequestBody
} from "../../../../../lib/stage3-editing-proxy-service";
import { resolveStage3LocalWorkerReadiness } from "../../../../../lib/stage3-worker-readiness";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../../../lib/ytdlp";

export const runtime = "nodejs";

function isEditingProxyInputError(message: string): boolean {
  return message.includes("sourceUrl") || message.includes("Проверьте ссылку");
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Stage3EditingProxyRequestBody | null;

  try {
    const auth = await requireAuth(request);
    const sourceUrl = normalizeSupportedUrl(body?.sourceUrl?.trim() ?? "");
    if (!sourceUrl) {
      return Response.json(
        buildStage3JobErrorBody({
          message: "Передайте sourceUrl в теле запроса.",
          recoverable: false
        }),
        { status: 400 }
      );
    }
    if (!isSupportedUrl(sourceUrl)) {
      return Response.json(
        buildStage3JobErrorBody({
          message: "Не удалось подготовить proxy-видео для редактора. Проверьте ссылку на ролик из Шага 1.",
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

    const job = enqueueAndScheduleStage3Job({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      kind: "editing-proxy",
      executionTarget,
      payloadJson: JSON.stringify({ sourceUrl }),
      dedupeKey: await buildStage3EditingProxyDedupeKey(
        { sourceUrl },
        {
          workspaceId: auth.workspace.id,
          userId: auth.user.id
        }
      )
    });

    return Response.json(
      buildStage3JobEnvelope(
        job,
        job.artifact ? `/api/stage3/editing-proxy/jobs/${job.id}?download=1` : null
      ),
      { status: job.status === "completed" ? 200 : 202 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const message = error instanceof Error ? error.message : "Не удалось подготовить editing proxy.";
    return Response.json(
      buildStage3JobErrorBody({
        message,
        recoverable: !isEditingProxyInputError(message)
      }),
      { status: isEditingProxyInputError(message) ? 400 : 500 }
    );
  }
}
