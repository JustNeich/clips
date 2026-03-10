import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { requireAuth, requireChannelVisibility } from "../../../../lib/auth/guards";
import { resolveStage3ExecutionTarget } from "../../../../lib/stage3-execution";
import {
  enqueueAndScheduleStage3Job,
  waitForStage3Job
} from "../../../../lib/stage3-job-runtime";
import {
  RENDER_WAIT_TIMEOUT_MS,
  Stage3RenderRequestBody
} from "../../../../lib/stage3-render-service";

export const runtime = "nodejs";

const RENDER_BUSY_RETRY_AFTER_SEC = "10";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Stage3RenderRequestBody | null;

  try {
    const auth = await requireAuth();
    if (body?.channelId?.trim()) {
      await requireChannelVisibility(auth, body.channelId.trim());
    }

    const job = enqueueAndScheduleStage3Job({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      kind: "render",
      executionTarget: resolveStage3ExecutionTarget(),
      payloadJson: JSON.stringify(body ?? {})
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
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
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
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Render export failed."
      },
      {
        status: 503,
        headers: {
          "Retry-After": RENDER_BUSY_RETRY_AFTER_SEC,
          "x-stage3-busy": "1"
        }
      }
    );
  }
}
