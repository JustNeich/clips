import { requireAuth, requireChannelVisibility } from "../../../../lib/auth/guards";
import { resolveStage3Execution } from "../../../../lib/stage3-execution";
import { buildStage3JobEnvelope, buildStage3JobErrorBody } from "../../../../lib/stage3-job-http";
import { enqueueAndScheduleStage3Job } from "../../../../lib/stage3-job-runtime";
import {
  buildStage3PreviewDedupeKey,
  Stage3PreviewRequestBody
} from "../../../../lib/stage3-preview-service";
import { resolveStage3LocalWorkerReadiness } from "../../../../lib/stage3-worker-readiness";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../../lib/ytdlp";

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
    if (body?.channelId?.trim()) {
      await requireChannelVisibility(auth, body.channelId.trim());
    }
    const sourceUrl = normalizeSupportedUrl(body?.sourceUrl?.trim() ?? "");
    if (!sourceUrl) {
      return Response.json({ error: "Передайте sourceUrl в теле запроса." }, { status: 400 });
    }
    if (!isSupportedUrl(sourceUrl)) {
      return Response.json(
        {
          error: "Не удалось подготовить исходное видео для предпросмотра. Проверьте ссылку на ролик из Шага 1."
        },
        { status: 400 }
      );
    }

    const normalizedBody = {
      ...(body ?? {}),
      sourceUrl,
      workspaceId: auth.workspace.id
    } satisfies Stage3PreviewRequestBody;
    const executionTarget = resolveStage3Execution(auth.workspace.stage3ExecutionTarget).resolvedTarget;
    if (executionTarget === "local") {
      const readiness = await resolveStage3LocalWorkerReadiness({
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      });
      if (!readiness.ready) {
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
      payloadJson: JSON.stringify(normalizedBody),
      dedupeKey: await buildStage3PreviewDedupeKey(normalizedBody, {
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      })
    });
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
