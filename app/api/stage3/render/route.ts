import { createReadStream, promises as fs } from "node:fs";
import { requireAuth, requireChannelVisibility } from "../../../../lib/auth/guards";
import { resolveStage3ExecutionTarget } from "../../../../lib/stage3-execution";
import { createNodeStreamResponse } from "../../../../lib/node-stream-response";
import { resolveStage3LocalWorkerReadiness } from "../../../../lib/stage3-worker-readiness";
import {
  enqueueAndScheduleStage3Job,
  waitForStage3Job
} from "../../../../lib/stage3-job-runtime";
import {
  RENDER_WAIT_TIMEOUT_MS,
  Stage3RenderRequestBody
} from "../../../../lib/stage3-render-service";
import { buildStage3RenderRequestDedupeKey } from "../../../../lib/stage3-render-request";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../../lib/ytdlp";

export const runtime = "nodejs";

const RENDER_BUSY_RETRY_AFTER_SEC = "10";

function isRenderInputError(message: string): boolean {
  return message.includes("sourceUrl") || message.includes("Проверьте ссылку");
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Stage3RenderRequestBody | null;

  try {
    const auth = await requireAuth();
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
          error: "Не удалось подготовить исходное видео для рендера. Проверьте ссылку на ролик из Шага 1."
        },
        { status: 400 }
      );
    }

    const normalizedBody = {
      ...(body ?? {}),
      sourceUrl
    } satisfies Stage3RenderRequestBody;
    const executionTarget = resolveStage3ExecutionTarget();
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
              "Retry-After": RENDER_BUSY_RETRY_AFTER_SEC,
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
      kind: "render",
      executionTarget,
      dedupeKey: buildStage3RenderRequestDedupeKey(normalizedBody, {
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      }),
      payloadJson: JSON.stringify(normalizedBody)
    });
    const resolved =
      job.status === "completed"
        ? job
        : await waitForStage3Job(job.id, {
            timeoutMs: RENDER_WAIT_TIMEOUT_MS + 90_000,
            signal: request.signal
          });

    if (request.signal.aborted) {
      return new Response(null, { status: 204 });
    }
    if (resolved.status === "completed" && resolved.artifactFilePath && resolved.artifact) {
      const stat = await fs.stat(resolved.artifactFilePath);
      const stream = createReadStream(resolved.artifactFilePath);
      return createNodeStreamResponse({
        stream,
        signal: request.signal,
        headers: {
          "Content-Type": resolved.artifact.mimeType,
          "Content-Length": String(stat.size),
          "Content-Disposition": `attachment; filename="${resolved.artifact.fileName}"`,
          "x-stage3-job": resolved.id
        }
      });
    }

    return Response.json(
      {
        error: resolved.errorMessage ?? "Render export failed."
      },
      {
        status: resolved.recoverable ? 503 : 500,
        headers: resolved.recoverable
          ? {
              "Retry-After": RENDER_BUSY_RETRY_AFTER_SEC,
              "x-stage3-busy": "1",
              "x-stage3-job": resolved.id
            }
          : { "x-stage3-job": resolved.id }
      }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Response(null, { status: 204 });
    }
    const message = error instanceof Error ? error.message : "Render export failed.";
    return Response.json(
      {
        error: message
      },
      {
        status: isRenderInputError(message) ? 400 : 503,
        headers: isRenderInputError(message)
          ? undefined
          : {
              "Retry-After": RENDER_BUSY_RETRY_AFTER_SEC,
              "x-stage3-busy": "1"
            }
      }
    );
  }
}
