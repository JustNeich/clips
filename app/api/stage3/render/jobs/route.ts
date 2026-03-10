import { requireAuth, requireChannelVisibility } from "../../../../../lib/auth/guards";
import { resolveStage3ExecutionTarget } from "../../../../../lib/stage3-execution";
import { buildStage3JobEnvelope, buildStage3JobErrorBody } from "../../../../../lib/stage3-job-http";
import { enqueueAndScheduleStage3Job } from "../../../../../lib/stage3-job-runtime";
import { Stage3RenderRequestBody } from "../../../../../lib/stage3-render-service";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../../../lib/ytdlp";

export const runtime = "nodejs";

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
          message: "Не удалось подготовить исходное видео для рендера. Проверьте ссылку на ролик из Шага 1.",
          recoverable: false
        }),
        { status: 400 }
      );
    }

    const job = enqueueAndScheduleStage3Job({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      kind: "render",
      executionTarget: resolveStage3ExecutionTarget(),
      payloadJson: JSON.stringify({
        ...(body ?? {}),
        sourceUrl
      })
    });

    return Response.json(buildStage3JobEnvelope(job, null), {
      status: job.status === "completed" ? 200 : 202
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const message = error instanceof Error ? error.message : "Не удалось поставить render в очередь.";
    return Response.json(
      buildStage3JobErrorBody({
        message,
        recoverable: !isRenderInputError(message)
      }),
      { status: isRenderInputError(message) ? 400 : 500 }
    );
  }
}
