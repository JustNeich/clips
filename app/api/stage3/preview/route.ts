import { requireAuth, requireChannelVisibility } from "../../../../lib/auth/guards";
import {
  enqueueAndScheduleStage3Job,
  waitForStage3Job
} from "../../../../lib/stage3-job-runtime";
import {
  buildStage3PreviewDedupeKey,
  PREVIEW_WAIT_TIMEOUT_MS,
  Stage3PreviewRequestBody,
  tryCreateStage3PreviewResponse
} from "../../../../lib/stage3-preview-service";

export const runtime = "nodejs";

const PREVIEW_BUSY_RETRY_AFTER_SEC = "6";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Stage3PreviewRequestBody | null;

  try {
    const auth = await requireAuth();
    if (body?.channelId?.trim()) {
      await requireChannelVisibility(auth, body.channelId.trim());
    }
    const executionTarget = "host" as const;

    const job = enqueueAndScheduleStage3Job({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      kind: "preview",
      executionTarget,
      payloadJson: JSON.stringify(body ?? {}),
      dedupeKey: await buildStage3PreviewDedupeKey(body ?? {}, {
        workspaceId: auth.workspace.id,
        userId: auth.user.id
      })
    });
    const resolved =
      job.status === "completed"
        ? job
        : await waitForStage3Job(job.id, {
            timeoutMs: PREVIEW_WAIT_TIMEOUT_MS + 15_000,
            signal: request.signal
          });

    if (request.signal.aborted) {
      return new Response(null, { status: 204 });
    }
    if (resolved.status === "completed" && resolved.artifactFilePath) {
      const response = await tryCreateStage3PreviewResponse(resolved.artifactFilePath, {
        "Cache-Control": "private, max-age=300",
        "x-stage3-preview": "1",
        "x-stage3-job": resolved.id
      });
      if (response) {
        return response;
      }
      return Response.json(
        {
          error: "Черновой предпросмотр не удалось подготовить. Повторите ещё раз."
        },
        { status: 503 }
      );
    }

    return Response.json(
      {
        error: resolved.errorMessage ?? "Черновой предпросмотр не удалось подготовить. Повторите ещё раз."
      },
      {
        status: resolved.recoverable ? 503 : 500,
        headers: resolved.recoverable
          ? {
              "Retry-After": PREVIEW_BUSY_RETRY_AFTER_SEC,
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
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Не удалось загрузить предпросмотр Stage 3."
      },
      {
        status: 503,
        headers: {
          "Retry-After": PREVIEW_BUSY_RETRY_AFTER_SEC,
          "x-stage3-busy": "1"
        }
      }
    );
  }
}
