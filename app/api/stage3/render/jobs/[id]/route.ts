import { createReadStream, promises as fs } from "node:fs";
import { requireAuth } from "../../../../../../lib/auth/guards";
import { buildStage3JobEnvelope, buildStage3JobErrorBody } from "../../../../../../lib/stage3-job-http";
import {
  findLatestPublicationForRenderExport,
  getRenderExportByStage3JobId
} from "../../../../../../lib/publication-store";
import { appendStage3JobEvent } from "../../../../../../lib/stage3-job-store";
import { getStage3JobOrThrow, recoverRenderExportCompletion } from "../../../../../../lib/stage3-job-runtime";
import { createNodeStreamResponse } from "../../../../../../lib/node-stream-response";

export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store"
} as const;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requireAuth();
    const { id } = await context.params;
    const job = getStage3JobOrThrow(id);
    if (job.workspaceId !== auth.workspace.id || job.userId !== auth.user.id) {
      return Response.json(
        { error: "Stage 3 job not found." },
        {
          status: 404,
          headers: NO_STORE_HEADERS
        }
      );
    }
    const renderExport = job.kind === "render" ? getRenderExportByStage3JobId(job.id) : null;
    const recoveredPublication = renderExport ? findLatestPublicationForRenderExport(renderExport.id) : null;
    if (job.kind === "render" && job.status === "completed" && job.artifact && job.artifactFilePath && (!renderExport || !recoveredPublication)) {
      await recoverRenderExportCompletion(job, {
        jobId: job.id,
        artifactFileName: job.artifact.fileName,
        artifactFilePath: job.artifactFilePath,
        artifactMimeType: job.artifact.mimeType,
        artifactSizeBytes: job.artifact.sizeBytes,
        completedAt: job.completedAt ?? new Date().toISOString()
      }).catch((error) => {
        appendStage3JobEvent(
          job.id,
          "warn",
          error instanceof Error
            ? error.message
            : "Не удалось восстановить render export и queued-публикацию."
        );
      });
    }

    const url = new URL(request.url);
    if (url.searchParams.get("download") === "1") {
      if (!job.artifactFilePath || !job.artifact) {
        return Response.json(
          buildStage3JobErrorBody({
            message: job.errorMessage ?? "Render artifact is not ready yet.",
            jobId: job.id,
            recoverable: job.recoverable
          }),
          {
            status: job.status === "completed" ? 410 : 409,
            headers: NO_STORE_HEADERS
          }
        );
      }
      const stat = await fs.stat(job.artifactFilePath);
      const stream = createReadStream(job.artifactFilePath);
      return createNodeStreamResponse({
        stream,
        signal: request.signal,
        headers: {
          "Content-Type": job.artifact.mimeType,
          "Content-Length": String(stat.size),
          "Content-Disposition": `attachment; filename="${job.artifact.fileName}"`,
          "Cache-Control": "private, max-age=900"
        }
      });
    }

    return Response.json(
      buildStage3JobEnvelope(job, job.artifact ? `/api/stage3/render/jobs/${job.id}?download=1` : null),
      {
        headers: NO_STORE_HEADERS
      }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof Error && error.message === "Stage 3 job not found.") {
      return Response.json(
        { error: error.message },
        {
          status: 404,
          headers: NO_STORE_HEADERS
        }
      );
    }
    return Response.json(
      buildStage3JobErrorBody({
        message: error instanceof Error ? error.message : "Не удалось получить статус render job.",
        recoverable: true
      }),
      {
        status: 500,
        headers: NO_STORE_HEADERS
      }
    );
  }
}
